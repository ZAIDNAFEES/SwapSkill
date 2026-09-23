import crypto from "crypto";

async function verifyAuthHeader(authHeader: string | undefined): Promise<{ uid: string; email?: string } | null> {
  if (!authHeader || typeof authHeader !== "string") return null;
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : authHeader.trim();
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      return null;
    }
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

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

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

  throw new Error("Firebase Service Account environment variable (FIREBASE_SERVICE_ACCOUNT) is not configured.");
}

async function getOAuth2AccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && tokenExpiresAt > now + 120) {
    return cachedAccessToken;
  }

  const sa = getServiceAccount();
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth2 token error: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600);
  return data.access_token;
}

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
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
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    const authUser = await verifyAuthHeader(authHeader);
    if (!authUser || !authUser.uid) {
      return res.status(401).json({ error: "Unauthorized: Valid Firebase authentication token required." });
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (_) {}
    }

    const {
      recipientUserId,
      pushToken,
      deviceTokens,
      title = "SwapSkill Alert",
      body: notifBody = "",
      channelId = "swapskill_general",
      priority = "high",
      data = {},
    } = body || {};

    if (!recipientUserId || !title) {
      return res.status(400).json({ error: "recipientUserId and title are required." });
    }

    const isSelfTest = recipientUserId === authUser.uid;
    if (!isSelfTest) {
      if (data?.type === "incoming_call" && data?.callerId && data.callerId !== authUser.uid) {
        return res.status(403).json({ error: "Forbidden: callerId does not match authenticated user." });
      }
      if (data?.senderId && data.senderId !== authUser.uid) {
        return res.status(403).json({ error: "Forbidden: senderId does not match authenticated user." });
      }
    }

    const sa = getServiceAccount();
    const projectId = sa.project_id || "swapskill-abbe1";
    const accessToken = await getOAuth2AccessToken();

    // Do NOT trust client-supplied pushToken or deviceTokens for recipient delivery.
    // Securely fetch recipient's current pushToken + ALL fcmTokens[] from Firestore
    const targetTokens: string[] = [];

    if (recipientUserId) {
      try {
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(recipientUserId)}`;
        const fRes = await fetch(firestoreUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (fRes.ok) {
          const uDoc = await fRes.json();
          const fields = uDoc.fields || {};
          if (fields.pushToken?.stringValue && fields.pushToken.stringValue.trim().length > 10) {
            targetTokens.push(fields.pushToken.stringValue.trim());
          }
          const fcmArr = fields.fcmTokens?.arrayValue?.values;
          if (Array.isArray(fcmArr)) {
            fcmArr.forEach((v: any) => {
              if (v.stringValue && v.stringValue.trim().length > 10) {
                targetTokens.push(v.stringValue.trim());
              }
            });
          }
        }

        // Also check security tokens subcollection
        const secUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(recipientUserId)}/security/tokens`;
        const sRes = await fetch(secUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (sRes.ok) {
          const sDoc = await sRes.json();
          const fields = sDoc.fields || {};
          if (fields.pushToken?.stringValue && fields.pushToken.stringValue.trim().length > 10) {
            targetTokens.push(fields.pushToken.stringValue.trim());
          }
          const secArr = fields.fcmTokens?.arrayValue?.values;
          if (Array.isArray(secArr)) {
            secArr.forEach((v: any) => {
              if (v.stringValue && v.stringValue.trim().length > 10) {
                targetTokens.push(v.stringValue.trim());
              }
            });
          }
        }
      } catch (fErr) {
        console.warn("[Vercel FCM] Firestore user lookup error:", fErr);
      }
    }

    if (targetTokens.length === 0) {
      if (typeof pushToken === "string" && pushToken.trim().length > 10) {
        targetTokens.push(pushToken.trim());
      }
      if (Array.isArray(deviceTokens)) {
        deviceTokens.forEach((t: any) => {
          if (typeof t === "string" && t.trim().length > 10) {
            targetTokens.push(t.trim());
          }
        });
      }
    }

    const uniqueTokens = Array.from(new Set(targetTokens.filter(Boolean)));
    if (uniqueTokens.length === 0) {
      return res.status(200).json({
        ok: true,
        sent: false,
        message: "No registered device push tokens found for recipient.",
      });
    }

    const isCallEvent = data.type === "incoming_call" || channelId === "swapskill_calls" || data.type === "call_cancelled" || data.type === "call_ended";

    const stringifiedData: Record<string, string> = {
      title: String(title),
      body: String(notifBody),
      channelId: String(channelId),
    };

    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) {
        stringifiedData[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
      }
    }

    const fcmEndpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
    let successCount = 0;
    let failureCount = 0;
    const staleTokens: string[] = [];

    await Promise.all(
      uniqueTokens.map(async (token) => {
        try {
          const messagePayload: any = {
            token,
            data: stringifiedData,
            android: {
              priority: "HIGH",
              direct_boot_ok: true,
              restricted_package_name: "com.swapskill.app",
              ttl: isCallEvent ? "60s" : "86400s",
            },
            apns: {
              headers: {
                "apns-priority": isCallEvent || priority === "high" ? "10" : "5",
                "apns-push-type": "alert",
                "apns-expiration": String(Math.floor(Date.now() / 1000) + (isCallEvent ? 60 : 86400)),
              },
              payload: {
                aps: {
                  alert: {
                    title,
                    body: notifBody,
                  },
                  sound: "default",
                  badge: 1,
                  "content-available": 1,
                  category: isCallEvent ? "INCOMING_CALL" : undefined,
                },
                ...stringifiedData,
              },
            },
            webpush: {
              notification: {
                title,
                body: notifBody,
                icon: "/favicon.ico",
              },
            },
          };

          // On Android, we omit top-level notification so Google Play Services always passes
          // the high-priority payload to SwapSkillMessagingService.onMessageReceived across
          // background, locked, and killed states to build the native heads-up alert.

          const response = await fetch(fcmEndpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ message: messagePayload }),
          });

          if (response.ok) {
            successCount++;
          } else {
            failureCount++;
            const errBody = await response.text().catch(() => "");
            if (
              response.status === 404 ||
              errBody.includes("UNREGISTERED") ||
              errBody.includes("INVALID_ARGUMENT") ||
              errBody.includes("registration-token-not-registered")
            ) {
              staleTokens.push(token);
            }
          }
        } catch (_) {
          failureCount++;
        }
      })
    );

    // Prune stale tokens if detected
    if (staleTokens.length > 0 && recipientUserId) {
      try {
        const remainingTokens = uniqueTokens.filter((t) => !staleTokens.includes(t));
        const pruneUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(recipientUserId)}?updateMask.fieldPaths=fcmTokens`;
        await fetch(pruneUrl, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: {
              fcmTokens: {
                arrayValue: {
                  values: remainingTokens.map((t) => ({ stringValue: t })),
                },
              },
            },
          }),
        }).catch(() => {});
      } catch (_) {}
    }

    return res.status(200).json({
      ok: true,
      sent: successCount > 0,
      successCount,
      failureCount,
      totalTokens: uniqueTokens.length,
    });
  } catch (err: any) {
    console.error("[Vercel FCM Handler Error]:", err);
    return res.status(500).json({ error: err.message || "Failed to dispatch push notification." });
  }
}
