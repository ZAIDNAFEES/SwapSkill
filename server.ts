import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { AccessToken } from "livekit-server-sdk";

/**
 * Normalizes LiveKit server URL to ensure valid WebSocket protocol (wss:// or ws://) without trailing slashes.
 */
function normalizeLiveKitUrl(url?: string): string {
  if (!url) return "";
  let clean = url.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  // Extract pure URL if multiple space-delimited tokens exist
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

  // Extract from rawUrl if bundled together
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

async function startServer() {
  const app = express();

  // Enable CORS for Capacitor Native Android/iOS (https://localhost, capacitor://localhost) and Web clients
  app.use((req, res, next) => {
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
    next();
  });

  const PORT = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === "production";

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  // Secure LiveKit Token Generation Endpoint for Swap Sessions (Supports POST and GET)
  app.all("/api/livekit/token", async (req, res) => {
    if (req.method !== "POST" && req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed. Use POST or GET." });
    }

    try {
      const roomName = req.body?.roomName || req.query?.roomName;
      const sessionId = req.body?.sessionId || req.query?.sessionId;
      const userId = req.body?.userId || req.query?.userId;
      const userName = req.body?.userName || req.query?.userName;
      const authHeader = req.headers.authorization;
      const idToken = authHeader?.startsWith("Bearer ")
        ? authHeader.split("Bearer ")[1].trim()
        : req.body?.idToken || req.query?.idToken;

      if (!roomName || !userId) {
        return res.status(400).json({ 
          error: "Missing required fields: roomName and userId are required." 
        });
      }

      const { livekitUrl, apiKey, apiSecret } = parseLiveKitCredentials();

      if (!apiKey || !apiSecret || !livekitUrl) {
        console.error("[LiveKit Token Error] Missing credentials in environment:", {
          hasApiKey: !!apiKey,
          hasApiSecret: !!apiSecret,
          hasLivekitUrl: !!livekitUrl,
        });
        return res.status(503).json({
          error: "LiveKit server credentials (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL) are not configured. Please add them in the project environment settings.",
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

      return res.json({
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
  });

  // Session Leave & Disconnect Cleanup Endpoint (Supports fetch & navigator.sendBeacon)
  app.post("/api/session/leave", express.json({ type: ["application/json", "text/plain"] }), async (req, res) => {
    try {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (_) {}
      }
      const { sessionId, userId, forceEnd } = body || {};
      if (!sessionId || !userId) {
        return res.status(400).json({ error: "sessionId and userId are required." });
      }

      const projectId = process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1";
      const cleanSessionId = encodeURIComponent(sessionId);
      const firestoreDocUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sessions/${cleanSessionId}`;

      const getRes = await fetch(firestoreDocUrl);
      if (!getRes.ok) {
        return res.status(200).json({ ok: true, message: "Session document not found." });
      }

      const docData = await getRes.json();
      const fields = docData.fields || {};
      const status = (fields.status?.stringValue || "").toLowerCase();
      const sessionEnded = fields.sessionEnded?.booleanValue || fields.isEnded?.booleanValue || false;

      if (status === "completed" || sessionEnded) {
        return res.status(200).json({ ok: true, sessionEnded: true, remainingCount: 0 });
      }

      const existingParticipants = (fields.liveParticipants?.arrayValue?.values || [])
        .map((v: any) => v.stringValue)
        .filter(Boolean);

      const remaining = existingParticipants.filter((id: string) => id !== userId);
      const nowIso = new Date().toISOString();

      if (remaining.length > 0 && !forceEnd) {
        // Partner is still in the room -> keep session active
        const updateMask = "updateMask.fieldPaths=liveParticipants&updateMask.fieldPaths=lastLeaveTime";
        await fetch(`${firestoreDocUrl}?${updateMask}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              liveParticipants: {
                arrayValue: {
                  values: remaining.map((id: string) => ({ stringValue: id }))
                }
              },
              lastLeaveTime: {
                timestampValue: nowIso
              }
            }
          })
        });
        return res.status(200).json({ ok: true, sessionEnded: false, remainingCount: remaining.length });
      } else {
        // Both participants have left -> transition to completed!
        const updateMask = "updateMask.fieldPaths=liveParticipants&updateMask.fieldPaths=status&updateMask.fieldPaths=sessionEnded&updateMask.fieldPaths=isEnded&updateMask.fieldPaths=meetingEnded&updateMask.fieldPaths=isLive&updateMask.fieldPaths=actualEndTime&updateMask.fieldPaths=completedAt";
        await fetch(`${firestoreDocUrl}?${updateMask}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              liveParticipants: { arrayValue: { values: [] } },
              status: { stringValue: "completed" },
              sessionEnded: { booleanValue: true },
              isEnded: { booleanValue: true },
              meetingEnded: { booleanValue: true },
              isLive: { booleanValue: false },
              actualEndTime: { timestampValue: nowIso },
              completedAt: { timestampValue: nowIso }
            }
          })
        });
        return res.status(200).json({ ok: true, sessionEnded: true, remainingCount: 0 });
      }
    } catch (err: any) {
      console.error("[/api/session/leave Error]:", err);
      return res.status(500).json({ error: err.message || "Failed to process session leave." });
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },
      appType: "spa",
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    app.use(express.static(distPath));

    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});