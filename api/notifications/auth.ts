import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let adminApp: App | null = null;

function getServiceAccount() {
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

  return null;
}

export function getAdminApp(): App | null {
  if (adminApp) return adminApp;
  if (getApps().length > 0) {
    adminApp = getApps()[0];
    return adminApp;
  }
  const sa = getServiceAccount();
  if (sa) {
    try {
      adminApp = initializeApp({
        credential: cert(sa as any),
        projectId: sa.project_id,
      });
      return adminApp;
    } catch (e) {
      console.warn("[Auth] Failed to initialize Firebase Admin app:", e);
    }
  }
  return null;
}

export async function verifyAuthHeader(authHeader: string | undefined): Promise<{ uid: string; email?: string } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.substring(7).trim();
  if (!token) {
    return null;
  }

  const app = getAdminApp();
  if (app) {
    try {
      const auth = getAuth(app);
      const decoded = await auth.verifyIdToken(token);
      return { uid: decoded.uid, email: decoded.email };
    } catch (err) {
      console.warn("[Auth] Firebase Admin verifyIdToken failed:", err);
      return null;
    }
  }

  // Fallback: Verify cryptographically via Google tokeninfo
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    if (res.ok) {
      const info: any = await res.json();
      const expectedProj = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1";
      if ((info.aud === expectedProj || info.azp) && info.sub) {
        return { uid: info.sub, email: info.email };
      }
    }
  } catch (_) {}

  return null;
}

export async function verifyAuthRequest(req: any): Promise<{ uid: string; email?: string } | null> {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (header && typeof header === "string" && header.startsWith("Bearer ")) {
    return verifyAuthHeader(header);
  }
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {}
  }
  const token = body?.idToken || req.query?.idToken;
  if (token && typeof token === "string") {
    return verifyAuthHeader("Bearer " + token.trim());
  }
  return null;
}

