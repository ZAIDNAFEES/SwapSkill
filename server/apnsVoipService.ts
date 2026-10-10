import http2 from "http2";
import crypto from "crypto";

export interface ApnsVoipCallOptions {
  voipToken: string;
  callId: string;
  sessionId: string;
  callerId: string;
  callerName: string;
  callerPhoto?: string;
  callType?: string;
  skillName?: string;
}

export interface ApnsResult {
  success: boolean;
  statusCode?: number;
  reason?: string;
  skipped?: boolean;
}

interface CachedJwt {
  token: string;
  expiresAt: number;
}

let cachedJwt: CachedJwt | null = null;

/**
 * Generates an APNs Provider Authentication Token (JWT) using ES256
 */
function getApnsJwt(keyId: string, teamId: string, privateKeyRaw: string): string {
  const now = Math.floor(Date.now() / 1000);

  // Return cached JWT if still valid for at least 5 minutes
  if (cachedJwt && cachedJwt.expiresAt > now + 300) {
    return cachedJwt.token;
  }

  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString("base64url");
  const data = `${header}.${claims}`;

  let normalizedKey = privateKeyRaw.trim();
  if (normalizedKey.includes("\\n")) {
    normalizedKey = normalizedKey.replace(/\\n/g, "\n");
  }
  if (!normalizedKey.includes("-----BEGIN PRIVATE KEY-----") && !normalizedKey.includes("-----BEGIN EC PRIVATE KEY-----")) {
    normalizedKey = `-----BEGIN PRIVATE KEY-----\n${normalizedKey}\n-----END PRIVATE KEY-----`;
  }

  const signature = crypto
    .sign("sha256", Buffer.from(data), {
      key: normalizedKey,
      dsaEncoding: "ieee-p1363",
    })
    .toString("base64url");

  const jwt = `${data}.${signature}`;
  cachedJwt = {
    token: jwt,
    expiresAt: now + 3000, // Valid for 50 minutes (APNs max 60 min)
  };

  return jwt;
}

/**
 * Sends a real Apple PushKit VoIP Push notification over HTTP/2 to api.push.apple.com
 */
export async function sendApnsVoipPush(options: ApnsVoipCallOptions): Promise<ApnsResult> {
  const apnsKeyId = process.env.APNS_KEY_ID;
  const apnsTeamId = process.env.APNS_TEAM_ID;
  const apnsPrivateKey = process.env.APNS_PRIVATE_KEY;
  const bundleId = process.env.APNS_BUNDLE_ID || "com.swapskill.app";
  const isSandbox = process.env.APNS_SANDBOX === "true" || process.env.NODE_ENV !== "production";

  if (!apnsKeyId || !apnsTeamId || !apnsPrivateKey) {
    console.log("[APNs VoIP] APNs signing credentials (APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY) not configured. Real APNs HTTP/2 push skipped.");
    return {
      success: false,
      skipped: true,
      reason: "APNs credentials not configured",
    };
  }

  // Clean hex token of spaces or < > brackets
  const cleanToken = options.voipToken.replace(/[^0-9a-fA-F]/g, "");
  if (!cleanToken || cleanToken.length < 32) {
    return {
      success: false,
      reason: `Invalid VoIP token format (${options.voipToken})`,
    };
  }

  let jwt: string;
  try {
    jwt = getApnsJwt(apnsKeyId, apnsTeamId, apnsPrivateKey);
  } catch (jwtErr: any) {
    console.error("[APNs VoIP] Failed to sign JWT with APNs private key:", jwtErr?.message);
    return {
      success: false,
      reason: `JWT signing failed: ${jwtErr?.message}`,
    };
  }

  const apnsHost = isSandbox
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";

  const payload = {
    aps: {},
    callId: options.callId,
    sessionId: options.sessionId,
    callerId: options.callerId,
    callerName: options.callerName,
    callerPhoto: options.callerPhoto || "",
    callType: options.callType || "video",
    skillName: options.skillName || "",
    timestamp: Date.now(),
  };

  const bodyData = Buffer.from(JSON.stringify(payload), "utf8");

  return new Promise<ApnsResult>((resolve) => {
    let client: http2.ClientHttp2Session | null = null;
    try {
      client = http2.connect(apnsHost);
    } catch (connErr: any) {
      console.error(`[APNs VoIP] Failed to connect to ${apnsHost}:`, connErr?.message);
      return resolve({
        success: false,
        reason: `Connection error: ${connErr?.message}`,
      });
    }

    client.on("error", (err) => {
      console.error(`[APNs VoIP] HTTP/2 client error:`, err?.message);
      if (client && !client.destroyed) {
        client.destroy();
      }
      resolve({
        success: false,
        reason: `HTTP/2 client error: ${err?.message}`,
      });
    });

    // Topic MUST end in .voip for PushKit notifications
    const apnsTopic = `${bundleId}.voip`;

    const req = client.request({
      [http2.constants.HTTP2_HEADER_METHOD]: http2.constants.HTTP2_METHOD_POST,
      [http2.constants.HTTP2_HEADER_PATH]: `/3/device/${cleanToken}`,
      authorization: `bearer ${jwt}`,
      "apns-push-type": "voip",
      "apns-topic": apnsTopic,
      "apns-priority": "10",
      "apns-expiration": "0", // Deliver immediately or discard
    });

    let resBody = "";
    let statusCode = 0;

    req.on("response", (headers) => {
      const statusVal = headers[http2.constants.HTTP2_HEADER_STATUS];
      statusCode = Number(Array.isArray(statusVal) ? statusVal[0] : statusVal) || 0;
    });

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      resBody += chunk;
    });

    req.on("end", () => {
      if (client && !client.destroyed) {
        client.close();
      }

      if (statusCode === 200) {
        console.log(`[APNs VoIP] Successfully delivered VoIP push to token ${cleanToken.substring(0, 10)}... (HTTP 200)`);
        resolve({
          success: true,
          statusCode: 200,
        });
      } else {
        console.error(`[APNs VoIP] APNs rejected VoIP push. Status: ${statusCode}, Body: ${resBody}`);
        resolve({
          success: false,
          statusCode,
          reason: resBody || `HTTP ${statusCode}`,
        });
      }
    });

    req.on("error", (reqErr) => {
      console.error(`[APNs VoIP] Request error:`, reqErr?.message);
      if (client && !client.destroyed) {
        client.destroy();
      }
      resolve({
        success: false,
        reason: `Request error: ${reqErr?.message}`,
      });
    });

    req.write(bodyData);
    req.end();
  });
}
