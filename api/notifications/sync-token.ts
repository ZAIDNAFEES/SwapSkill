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
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedClaim = base64Url(JSON.stringify(claim));
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureInput);
  const signature = base64Url(signer.sign(sa.private_key));
  const assertion = `${signatureInput}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Failed to obtain Google OAuth2 access token: ${tokenRes.status} ${errText}`);
  }

  const tokenJson = await tokenRes.json();
  cachedAccessToken = tokenJson.access_token;
  tokenExpiresAt = now + (tokenJson.expires_in || 3600);
  return cachedAccessToken!;
}

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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
      return res.status(401).json({ error: "Unauthorized: Missing, invalid, or expired Firebase ID token." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { userId, token, platform = "android" } = body;

    // Validate FCM token format/type and reject malformed input with HTTP 400
    if (!token || typeof token !== "string" || token.trim().length < 10) {
      return res.status(400).json({ error: "Bad Request: A valid non-empty FCM token string of at least 10 characters is required." });
    }

    // Require authenticatedUid === userId if userId is specified
    if (userId && typeof userId === "string" && userId.trim() !== authUser.uid) {
      return res.status(403).json({ error: "Forbidden: Cannot register or modify FCM tokens for another user." });
    }

    const cleanToken = token.trim();
    const targetUserId = authUser.uid;

    const sa = getServiceAccount();
    const projectId = sa.project_id || "swapskill-abbe1";
    const accessToken = await getOAuth2AccessToken();

    // 1. Fetch current user document to get existing tokens and append
    const userDocUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(targetUserId)}`;
    
    let existingTokens: string[] = [];
    try {
      const getRes = await fetch(userDocUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (getRes.ok) {
        const docJson = await getRes.json();
        const currentArr = docJson.fields?.fcmTokens?.arrayValue?.values;
        if (Array.isArray(currentArr)) {
          existingTokens = currentArr.map((v: any) => v.stringValue).filter(Boolean);
        }
        if (docJson.fields?.pushToken?.stringValue) {
          existingTokens.push(docJson.fields.pushToken.stringValue);
        }
      }
    } catch (_) {}

    // Deduplicate and append new token
    const updatedTokens = Array.from(new Set([...existingTokens, cleanToken]));

    // 2. Patch user document
    const patchUrl = `${userDocUrl}?updateMask.fieldPaths=pushToken&updateMask.fieldPaths=fcmTokens&updateMask.fieldPaths=pushPlatform&updateMask.fieldPaths=lastPushTokenUpdate`;
    const patchBody = {
      fields: {
        pushToken: { stringValue: cleanToken },
        pushPlatform: { stringValue: platform },
        lastPushTokenUpdate: { timestampValue: new Date().toISOString() },
        fcmTokens: {
          arrayValue: {
            values: updatedTokens.map((t) => ({ stringValue: t })),
          },
        },
      },
    };

    const patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patchBody),
    });

    // 3. Patch security subcollection document
    const securityDocUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(targetUserId)}/security/tokens?updateMask.fieldPaths=pushToken&updateMask.fieldPaths=fcmTokens&updateMask.fieldPaths=pushPlatform&updateMask.fieldPaths=lastPushTokenUpdate`;
    await fetch(securityDocUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patchBody),
    }).catch(() => {});

    return res.status(200).json({
      ok: true,
      synced: true,
      userId: targetUserId,
      totalTokens: updatedTokens.length,
      status: patchRes.ok ? "updated" : "partial",
    });
  } catch (err: any) {
    console.error("[SyncToken Handler Error]:", err);
    return res.status(500).json({ error: err.message || "Failed to sync push token" });
  }
}
