import { AccessToken } from "livekit-server-sdk";

/**
 * Normalizes LiveKit server URL to ensure valid WebSocket protocol (wss:// or ws://) without trailing slashes.
 */
function normalizeLiveKitUrl(url?: string): string {
  if (!url) return "";
  let clean = url.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  clean = clean.split(/\s+/)[0].trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (clean.startsWith("https://")) {
    clean = "wss://" + clean.slice(8);
  } else if (clean.startsWith("http://")) {
    clean = "ws://" + clean.slice(7);
  } else if (clean && !clean.startsWith("wss://") && !clean.startsWith("ws://")) {
    clean = "wss://" + clean;
  }
  return clean;
}

/**
 * Extracts and sanitizes LiveKit server credentials, with resilience against concatenated environment strings.
 */
function parseLiveKitCredentials() {
  let rawUrl = (process.env.LIVEKIT_URL || "").trim().replace(/^["']|["']$/g, "");
  let apiKey = (process.env.LIVEKIT_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  let apiSecret = (process.env.LIVEKIT_API_SECRET || "").trim().replace(/^["']|["']$/g, "");

  if (rawUrl.includes("LIVEKIT_API_KEY=") && !apiKey) {
    const keyMatch = rawUrl.match(/LIVEKIT_API_KEY=([^\s]+)/);
    if (keyMatch) apiKey = keyMatch[1].trim().replace(/^["']|["']$/g, "");
  }
  if (rawUrl.includes("LIVEKIT_API_SECRET=") && !apiSecret) {
    const secretMatch = rawUrl.match(/LIVEKIT_API_SECRET=([^\s]+)/);
    if (secretMatch) apiSecret = secretMatch[1].trim().replace(/^["']|["']$/g, "");
  }

  const livekitUrl = normalizeLiveKitUrl(rawUrl);

  return { livekitUrl, apiKey, apiSecret };
}

export default async function handler(req: any, res: any) {
  // CORS Configuration
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use POST or GET." });
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (_) {}
    }

    const query = req.query || {};
    const roomName = body?.roomName || query.roomName;
    const sessionId = body?.sessionId || query.sessionId;
    const userId = body?.userId || query.userId;
    const userName = body?.userName || query.userName;

    const authHeader = req.headers.authorization || req.headers.Authorization;
    const idToken = authHeader?.startsWith("Bearer ")
      ? authHeader.split("Bearer ")[1].trim()
      : body?.idToken || query.idToken;

    if (!roomName || !userId) {
      return res.status(400).json({ 
        error: "Missing required fields: roomName and userId are required." 
      });
    }

    const { livekitUrl, apiKey, apiSecret } = parseLiveKitCredentials();

    if (!apiKey || !apiSecret || !livekitUrl) {
      console.error("[LiveKit Vercel Token Error] Missing credentials in environment:", {
        hasApiKey: !!apiKey,
        hasApiSecret: !!apiSecret,
        hasLivekitUrl: !!livekitUrl,
      });
      return res.status(503).json({
        error: "LiveKit server credentials (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL) are not configured in Vercel Environment Variables.",
      });
    }

    // Security: Verify Firebase Authenticated Identity if ID token is supplied
    let verifiedUid = String(userId).trim();
    const firebaseApiKey = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBu-YUExO-0QrK_01QOA5-ai8LAe3enIAM";
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1";

    if (idToken) {
      try {
        const authVerifyRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
          }
        );
        if (authVerifyRes.ok) {
          const authData = await authVerifyRes.json();
          const firebaseUser = authData.users?.[0];
          if (firebaseUser?.localId) {
            verifiedUid = firebaseUser.localId;
          }
        }
      } catch (tokenErr) {
        console.warn("[LiveKit Token] Token inspection notice:", tokenErr);
      }
    }

    // Security: Validate Accepted Swap Session & Participant Membership in Firestore
    if (sessionId) {
      try {
        const cleanSessionId = encodeURIComponent(sessionId);
        const firestoreDocUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sessions/${cleanSessionId}`;
        const headers: Record<string, string> = {};
        if (idToken) {
          headers["Authorization"] = `Bearer ${idToken}`;
        }

        const sessionRes = await fetch(firestoreDocUrl, { headers });
        if (sessionRes.ok) {
          const doc = await sessionRes.json();
          const fields = doc.fields || {};
          const teacherId = fields.teacherId?.stringValue;
          const learnerId = fields.learnerId?.stringValue;
          const studentId = fields.studentId?.stringValue;
          const status = (fields.status?.stringValue || "").toLowerCase();
          const sessionEnded = fields.sessionEnded?.booleanValue || fields.isEnded?.booleanValue || false;

          // 1. Verify user is a confirmed participant in this swap session
          const isParticipant =
            verifiedUid === teacherId ||
            verifiedUid === learnerId ||
            verifiedUid === studentId ||
            userId === teacherId ||
            userId === learnerId ||
            userId === studentId;

          if (!isParticipant) {
            return res.status(403).json({
              error: "Unauthorized: You are not a registered participant in this Swap Session.",
            });
          }

          // 2. Reject if already completed/ended
          if (status === "completed" || sessionEnded) {
            return res.status(403).json({
              error: "This Swap Session has already completed and ended.",
            });
          }

          // 3. Verify session is in an active/accepted state
          const isAccepted =
            status === "accepted" ||
            status === "upcoming" ||
            status === "confirmed" ||
            status === "in_progress" ||
            status === "scheduled" ||
            status === "";

          if (!isAccepted) {
            return res.status(403).json({
              error: `Live Swap is not available for sessions in status "${status}". The swap must be accepted first.`,
            });
          }
        }
      } catch (firestoreErr) {
        console.warn("[LiveKit Token] Firestore validation check notice:", firestoreErr);
      }
    }

    // Generate Access Token scoped strictly to this Swap Session Room
    const at = new AccessToken(apiKey, apiSecret, {
      identity: verifiedUid,
      name: String(userName || verifiedUid),
      ttl: "3h",
    });

    at.addGrant({
      roomJoin: true,
      room: String(roomName),
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    console.log(`[LiveKit Token] Generated token for user "${verifiedUid}" in room "${roomName}" pointing to "${livekitUrl}"`);

    return res.status(200).json({
      token,
      serverUrl: livekitUrl,
      roomName,
    });
  } catch (error: any) {
    console.error("[LiveKit Token Error]:", error);
    return res.status(500).json({
      error: error.message || "Failed to generate LiveKit access token.",
    });
  }
}
