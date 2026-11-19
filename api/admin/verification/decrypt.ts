import { decryptVerificationEnvelope } from "../../../server/verificationCrypto.js";

const VERIFICATION_ADMIN_EMAIL = "zaidnafees8321@gmail.com";

async function verifyStrictAdminHeader(authHeader: string | undefined): Promise<{ uid: string; email: string } | null> {
  if (!authHeader || typeof authHeader !== "string") return null;
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : authHeader.trim();
  if (!token) return null;

  try {
    const apiKey = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBu-YUExO-0QrK_01QOA5-ai8LAe3enIAM";
    const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    if (!lookupRes.ok) return null;
    const data: any = await lookupRes.json();
    const user = data.users?.[0];
    if (
      user?.localId &&
      user?.email?.toLowerCase() === VERIFICATION_ADMIN_EMAIL &&
      user?.emailVerified === true
    ) {
      return { uid: user.localId, email: user.email };
    }
  } catch (err) {
    console.warn("[Vercel Admin Verify Error]:", err);
  }
  return null;
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const adminUser = await verifyStrictAdminHeader(req.headers?.authorization);
  if (!adminUser) {
    return res.status(403).json({
      error: "Forbidden: Verified admin credentials required to decrypt verification dossiers.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {}
  }

  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length > 50) {
    return res.status(400).json({ error: "Batch size limit exceeded (max 50 items)." });
  }

  const results = items.map((item: any) => {
    try {
      const decrypted = decryptVerificationEnvelope(item.encryptedEnvelope);
      return {
        id: String(item.id || ""),
        ok: true,
        dossier: decrypted.dossier,
        integrityVerified: decrypted.integrityVerified,
      };
    } catch (err: any) {
      return {
        id: String(item.id || ""),
        ok: false,
        error: err?.message || "Decryption failed",
      };
    }
  });

  return res.status(200).json({ ok: true, results });
}
