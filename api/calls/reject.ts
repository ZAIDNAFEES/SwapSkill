import crypto from "crypto";

async function verifyAuthRequest(req: any): Promise<{ uid: string; email?: string } | null> {
  const header = req.headers?.authorization || req.headers?.Authorization;
  let token = "";
  if (header && typeof header === "string") {
    token = header.startsWith("Bearer ") ? header.substring(7).trim() : header.trim();
  }
  if (!token) {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (_) {}
    }
    token = body?.idToken || req.query?.idToken || "";
  }
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;
    const uid = payload.user_id || payload.sub;
    if (!uid) return null;

    const apiKey = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBu-YUExO-0QrK_01QOA5-ai8LAe3enIAM";
    const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });

    if (lookupRes.ok) {
      const data: any = await lookupRes.json();
      const user = data.users?.[0];
      if (user && user.localId === uid) {
        return { uid: user.localId, email: user.email };
      }
    } else {
      const expectedProj = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1";
      if (payload.aud === expectedProj || payload.iss === `https://securetoken.google.com/${expectedProj}`) {
        return { uid, email: payload.email };
      }
    }
  } catch (err) {
    console.warn("[Auth] Token verification error:", err);
  }
  return null;
}

function base64Url(str: string | Buffer): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getServiceAccount(): { project_id: string; client_email: string; private_key: string } {
  const envRaw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FCM_SERVICE_ACCOUNT_KEY;
  if (envRaw) {
    try {
      const parsed = JSON.parse(envRaw);
      if (parsed.client_email && parsed.private_key) {
        return {
          project_id: parsed.project_id || process.env.FIREBASE_PROJECT_ID || "swapskill-abbe1",
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch (_) {
      try {
        const decoded = Buffer.from(envRaw, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);
        if (parsed.client_email && parsed.private_key) {
          return {
            project_id: parsed.project_id || process.env.FIREBASE_PROJECT_ID || "swapskill-abbe1",
            client_email: parsed.client_email,
            private_key: parsed.private_key.replace(/\\n/g, "\n"),
          };
        }
      } catch (_) {}
    }
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1";

  if (clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  return {
    project_id: projectId,
    client_email: "firebase-adminsdk-fbsvc@swapskill-abbe1.iam.gserviceaccount.com",
    private_key: "",
  };
}

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

async function getOAuth2AccessToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && tokenExpiresAt > now + 120) {
    return cachedAccessToken;
  }

  try {
    const sa = getServiceAccount();
    if (!sa.private_key || !sa.client_email) return null;

    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claimSet = base64Url(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now,
      })
    );

    const sign = crypto.createSign("RSA-SHA256");
    sign.update(`${header}.${claimSet}`);
    const signature = base64Url(sign.sign(sa.private_key));
    const jwt = `${header}.${claimSet}.${signature}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!res.ok) return null;
    const data = await res.json();
    cachedAccessToken = data.access_token;
    tokenExpiresAt = now + (data.expires_in || 3600);
    return data.access_token;
  } catch (err) {
    console.warn("[api/calls/reject] Failed to get OAuth token:", err);
    return null;
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (_) {}
    }

    const { callId, sessionId, reason } = body || {};
    if (!callId) {
      return res.status(400).json({ error: "Missing callId parameter." });
    }

    // 1. Authenticate user
    const authUser = await verifyAuthRequest(req);
    if (!authUser || !authUser.uid) {
      return res.status(401).json({ error: "Unauthorized: Valid Firebase ID token required." });
    }

    const sa = getServiceAccount();
    const projectId = sa.project_id || "swapskill-abbe1";
    const token = await getOAuth2AccessToken();

    if (token) {
      // 2. Fetch call doc and verify authenticated user is a participant
      const getUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/calls/${encodeURIComponent(
        callId
      )}`;
      const getRes = await fetch(getUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!getRes.ok) {
        return res.status(404).json({ error: "Call not found." });
      }

      const docData = await getRes.json();
      const callerId = docData.fields?.callerId?.stringValue || "";
      const receiverId = docData.fields?.receiverId?.stringValue || "";

      if (authUser.uid !== callerId && authUser.uid !== receiverId) {
        console.warn(`[api/calls/reject] Forbidden: User ${authUser.uid} not in call ${callId}`);
        return res.status(403).json({ error: "Forbidden: Authenticated user is not a participant in this call." });
      }

      // 3. Update call document status in Firestore via REST API
      const patchUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/calls/${encodeURIComponent(
        callId
      )}?updateMask.fieldPaths=status&updateMask.fieldPaths=endedAt&updateMask.fieldPaths=endReason`;

      const patchPayload = {
        fields: {
          status: { stringValue: "rejected" },
          endedAt: { timestampValue: new Date().toISOString() },
          endReason: { stringValue: reason || "Declined by user" },
        },
      };

      await fetch(patchUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchPayload),
      });

      // 4. Send FCM push notification to other participant
      const otherParticipantId = authUser.uid === callerId ? receiverId : callerId;
      if (otherParticipantId) {
        const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(
          otherParticipantId
        )}`;
        const userRes = await fetch(userUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (userRes.ok) {
            const uDoc = await userRes.json();
            const callerTokens: string[] = [];
            const pushTok = uDoc.fields?.pushToken?.stringValue;
            if (pushTok) callerTokens.push(pushTok);
            const arr = uDoc.fields?.fcmTokens?.arrayValue?.values;
            if (Array.isArray(arr)) {
              arr.forEach((v: any) => {
                if (v.stringValue) callerTokens.push(v.stringValue);
              });
            }

            const uniqueTokens = Array.from(new Set(callerTokens.filter(Boolean)));
            await Promise.all(
              uniqueTokens.map(async (fcmToken) => {
                try {
                  await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${token}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      message: {
                        token: fcmToken,
                        data: {
                          type: "call_cancelled",
                          callId,
                          sessionId: sessionId || "",
                          reason: reason || "Declined by user",
                          timestamp: String(Date.now()),
                        },
                        android: {
                          priority: "high",
                          ttl: "60s",
                        },
                      },
                    }),
                  });
                } catch (_) {}
              })
            );
          }
        }
      }

    return res.status(200).json({ ok: true, callId });
  } catch (err: any) {
    console.error("[api/calls/reject] Error:", err);
    return res.status(500).json({ error: err?.message || "Failed to reject call." });
  }
}
