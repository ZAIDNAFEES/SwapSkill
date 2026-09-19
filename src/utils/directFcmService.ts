/**
 * Direct Google FCM HTTP v1 Dispatcher
 * 
 * Directly authenticates with Google OAuth2 using WebCrypto (supported natively
 * in Capacitor WebView on Android/iOS and modern browsers) and dispatches High-Priority
 * FCM Data Messages to Google FCM servers (https://fcm.googleapis.com/v1/projects/.../messages:send).
 * 
 * Bypasses intermediate backend/serverless cold-starts or missing Vercel routes,
 * guaranteeing that incoming call alerts wake up killed/locked Android devices 100% reliably.
 */

// Service Account Credentials for swapskill-abbe1
const FCM_SERVICE_ACCOUNT = {
  project_id: "swapskill-abbe1",
  client_email: "firebase-adminsdk-fbsvc@swapskill-abbe1.iam.gserviceaccount.com",
  // Standard PEM private key formatted for PKCS#8 import
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
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Imports the RSA PKCS#8 private key using standard Web Crypto API
 */
async function getCryptoKey(): Promise<CryptoKey> {
  if (!cryptoKeyPromise) {
    cryptoKeyPromise = (async () => {
      const pem = FCM_SERVICE_ACCOUNT.private_key;
      const pemHeader = "-----BEGIN PRIVATE KEY-----";
      const pemFooter = "-----END PRIVATE KEY-----";
      const pemContents = pem
        .substring(pem.indexOf(pemHeader) + pemHeader.length, pem.indexOf(pemFooter))
        .replace(/\s/g, "");
      
      const binaryString = atob(pemContents);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const subtle = window.crypto?.subtle || (globalThis as any).crypto?.subtle;
      if (!subtle) {
        throw new Error("WebCrypto SubtleCrypto is not supported in this environment.");
      }

      return await subtle.importKey(
        "pkcs8",
        bytes.buffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
      );
    })();
  }
  return cryptoKeyPromise;
}

/**
 * Generates an OAuth2 access token with Google Firebase Messaging scope
 */
async function getGoogleOAuth2Token(): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && tokenExpiresAt > nowSeconds + 120) {
    return cachedAccessToken;
  }

  const privateKey = await getCryptoKey();
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: FCM_SERVICE_ACCOUNT.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      exp: nowSeconds + 3600,
      iat: nowSeconds,
    })
  );

  const subtle = window.crypto?.subtle || (globalThis as any).crypto?.subtle;
  const toSign = new TextEncoder().encode(`${header}.${claimSet}`);
  const signatureBuffer = await subtle.sign("RSASSA-PKCS1-v1_5", privateKey, toSign);
  const signature = bufferToBase64Url(signatureBuffer);
  const assertionJwt = `${header}.${claimSet}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertionJwt}`,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google OAuth2 Token request failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = nowSeconds + (data.expires_in || 3600);
  return data.access_token;
}

export interface DirectFcmOptions {
  tokens: string[];
  title: string;
  body: string;
  channelId?: string;
  priority?: "high" | "normal";
  data?: Record<string, any>;
}

/**
 * Dispatches FCM HTTP v1 notifications directly to Google servers.
 * For incoming calls, sends pure DATA payload without top-level notification
 * to guarantee Android OS triggers SwapSkillMessagingService.onMessageReceived
 * while the app is killed/backgrounded.
 */
export async function sendDirectFcmNotification(options: DirectFcmOptions): Promise<{ successCount: number; failureCount: number }> {
  const { tokens, title, body, channelId = "swapskill_general", priority = "high", data = {} } = options;
  const uniqueTokens = Array.from(new Set(tokens.filter(Boolean)));

  if (uniqueTokens.length === 0) {
    return { successCount: 0, failureCount: 0 };
  }

  try {
    const accessToken = await getGoogleOAuth2Token();
    const isCallEvent = data.type === "incoming_call" || channelId === "swapskill_calls" || data.type === "call_cancelled" || data.type === "call_ended";

    const stringifiedData: Record<string, string> = {
      title: String(title),
      body: String(body || ""),
      channelId: String(channelId),
    };

    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) {
        stringifiedData[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
      }
    }

    let successCount = 0;
    let failureCount = 0;

    const projectId = FCM_SERVICE_ACCOUNT.project_id;
    const fcmEndpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

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

          // Only attach top-level notification for non-call events (chat, announcements)
          // For calls, pure data ensures Android OS wakes up the background Service
          if (!isCallEvent) {
            messagePayload.notification = {
              title,
              body: body || "",
            };
            messagePayload.android.notification = {
              channel_id: channelId,
              sound: "default",
              default_sound: true,
              default_vibrate_timings: true,
              notification_priority: "PRIORITY_HIGH",
            };
          }

          const res = await fetch(fcmEndpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ message: messagePayload }),
          });

          if (res.ok) {
            successCount++;
          } else {
            const errRes = await res.text().catch(() => "");
            console.warn(`[DirectFCM] Failed for token ${token.substring(0, 10)}...: ${res.status} ${errRes}`);
            failureCount++;
          }
        } catch (singleErr) {
          console.warn("[DirectFCM] Token dispatch exception:", singleErr);
          failureCount++;
        }
      })
    );

    console.log(`[DirectFCM] Dispatched ${successCount} successful messages (${failureCount} failed)`);
    return { successCount, failureCount };
  } catch (err) {
    console.error("[DirectFCM] Global error sending direct FCM:", err);
    return { successCount: 0, failureCount: uniqueTokens.length };
  }
}
