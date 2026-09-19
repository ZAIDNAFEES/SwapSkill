import crypto from "crypto";

// Service Account Credentials for swapskill-abbe1
const DEFAULT_SERVICE_ACCOUNT = {
  project_id: "swapskill-abbe1",
  client_email: "firebase-adminsdk-fbsvc@swapskill-abbe1.iam.gserviceaccount.com",
  private_key: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDbXNgn8597HXPw
gzDYuH5C2q9C6QDhKHymTkgBkFwHzwfZ5VfCJdG6LCaqZtih8XLVxZJqAkmihkGO
J1hYZcpN37rLls9XnaVI1B9x/ohAMkeWrY+DYlNfO7v13Fb36p8uiwt6RG1cJPQP
5twAVdtooriDOZLMVj+cX+TMrkGuCedyJXF8kvdZ+0akJBA3Z03xA+z5iOjVOatZ
z/4/RWEABz2oQG+Mi0aOnlsbwMi4K4yLTNqwEZptP79zSR2Gff+sP7yCG4yJPLz9
NhvnGtpY0l3bt3b/ax+a71PeBKclTBsm5sUArJu7WmlCnri6ux0pQJSP8KbGS55q
Dzjo5a5XAgMBAAECggEAT3cBwu9JPbM8tcsAnfGvo45O4SFBNU+SYDiJcy+Vdyqz
gGbJdMZ4hEXMN/yLy5aI8BHjaU2s2RhjlRiBs3wkXjOHGotmTyoHnytgvM3lE8Rj
FJ2JGKI864nbHESWqLawtY6fOMqjBzdHxp7t4Z04n14bE0Z+/FDeOEqwuskBeAbo
nD/paPKgid1EXvRKacxFfJSR4tzAynTioKpWC7dj0zGfjRRvJew97JS7qZl29okz
wTxqIa7Zbntrt2xoIUNhVL8bIqTmFWNlfPyT2hq+wXirg/y7ECUk8pgRwXaeZg4+
ZvZtl+yT8SLdkxAwOJX6FxfbDUSZt6xV3OZ9Qax3OQKBgQD3X8inQLfXMMlnyyeC
RWuXV98GHkGa9LnsEKEO/vptdyUVHtQ49Heqeh20B2TBgoaeWZiZOU/+7eg8cx/l
08lAnS2JAtbYiqWbTudkP7TMivXrmP8n2m/yOPjEoDZJUJzcXiiLQB7wpL+J+taD
r1I+Cm322gQoyu+gPQl5K6WY0wKBgQDjAwM4D36BQb/3fseCPqSraDMIhv3Pj+6C
drApXD+czOtm88PgehW0B/cwG1Lul4UjkME2hJ+bdiU/9tUVFo0qivPha1zOXd/2
JUlp9G0bh1Mf4ccf33t2R186BzUkH56lLXgefSWUxT/COIxWNG/cyl7ekbqZY69D
s8u5Sgwh7QKBgQC814QoGgG95uJ5t96rVi9yU4RP+Vz/2/7qtS8ecYvfcOsAGo7M
A+QuYha2zkYea3Q1AhS6M8RbymZVb1VUb77c8qBGTcKRgBY4X53JK9DrrNFbT2rJ
k7mN4ewWvm9yvHVizQaKdyKndj06KiEEWhyge/nCTmCKe5E+dBn9RFKgPQKBgEqQ
NMB3JmAiToFmXPWEyeWbBhgo7rj8V6T2gwoyyJoiHLfmHVJgBzzo2OIuN2Ey14JF
C5FyolIXzkhiNL8GdzugBFboQsVtxCA/QwvQQv4lxsHUEOmBKDZDXx3aPDQvRpaO
hsPM60kgOL78f+vYsV1eAycrypSTT3/3UFT941pJAoGBAJLrPoTdRTxIToVFQ+7T
Nheq4IzWLh7V659EiYjnmWq8jFgSR+FdDT2RusJ5LM8A7KheRhPBdNUwq9KiYTvZ
LYpty90rs7raD2WpC3+ef7Pk+fnzfKOGduNHgy5fplrQjN6DdVgPUwk/xhtttHdW
6t6lq8/GQN3Sqm7UczziTFYn
-----END PRIVATE KEY-----`
};

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
  const envRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (envRaw) {
    try {
      const parsed = JSON.parse(envRaw);
      if (parsed.client_email && parsed.private_key) {
        return {
          project_id: parsed.project_id || DEFAULT_SERVICE_ACCOUNT.project_id,
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
            project_id: parsed.project_id || DEFAULT_SERVICE_ACCOUNT.project_id,
            client_email: parsed.client_email,
            private_key: parsed.private_key.replace(/\\n/g, "\n"),
          };
        }
      } catch (_) {}
    }
  }
  return DEFAULT_SERVICE_ACCOUNT;
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
      scope: "https://www.googleapis.com/auth/firebase.messaging",
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

    const targetTokens: string[] = [];
    if (pushToken && typeof pushToken === "string") {
      targetTokens.push(pushToken);
    }
    if (Array.isArray(deviceTokens)) {
      targetTokens.push(...deviceTokens.filter((t) => typeof t === "string" && t.length > 5));
    }

    const sa = getServiceAccount();
    const projectId = sa.project_id || "swapskill-abbe1";

    // If no tokens provided directly, query Firestore REST API
    if (targetTokens.length === 0 && recipientUserId) {
      try {
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(recipientUserId)}`;
        const fRes = await fetch(firestoreUrl);
        if (fRes.ok) {
          const uDoc = await fRes.json();
          const fields = uDoc.fields || {};
          if (fields.pushToken?.stringValue) {
            targetTokens.push(fields.pushToken.stringValue);
          }
          const fcmArr = fields.fcmTokens?.arrayValue?.values;
          if (Array.isArray(fcmArr)) {
            fcmArr.forEach((v: any) => {
              if (v.stringValue) targetTokens.push(v.stringValue);
            });
          }
        }
      } catch (fErr) {
        console.warn("[Vercel FCM] Firestore user lookup error:", fErr);
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

    const accessToken = await getOAuth2AccessToken();
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

    await Promise.all(
      uniqueTokens.map(async (token) => {
        try {
          const messagePayload: any = {
            token,
            data: stringifiedData,
            android: {
              priority: isCallEvent || priority === "high" ? "high" : "normal",
              ttl: isCallEvent ? "60s" : "86400s",
            },
          };

          // For calls, DO NOT attach top-level notification object so Android OS passes payload to onMessageReceived
          if (!isCallEvent) {
            messagePayload.notification = {
              title,
              body: notifBody,
            };
            messagePayload.android.notification = {
              channel_id: channelId,
              sound: "default",
              default_sound: true,
              default_vibrate_timings: true,
              notification_priority: "PRIORITY_HIGH",
            };
          }

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
          }
        } catch (_) {
          failureCount++;
        }
      })
    );

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
