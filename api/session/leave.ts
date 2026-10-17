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
    const sessionId = body?.sessionId || query.sessionId;
    const userId = body?.userId || query.userId;
    const forceEnd = body?.forceEnd !== undefined ? body.forceEnd : (query.forceEnd === "true");
    if (!sessionId || !userId) {
      return res.status(400).json({ error: "sessionId and userId are required." });
    }

    // Token authentication check
    const authHeader = req.headers.authorization || "";
    let token = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : (body?.idToken || query?.idToken || "");
    if (!token) {
      return res.status(401).json({ error: "Unauthorized: Valid authentication token required." });
    }

    let callerUid = "";
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp > nowSeconds) {
          callerUid = payload.user_id || payload.sub || "";
        }
      }
    } catch (_) {}

    if (!callerUid || callerUid !== userId) {
      return res.status(403).json({ error: "Forbidden: Caller does not match userId." });
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

    if (remaining.length > 0) {
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
      // Participant left -> update live presence only, do NOT force-complete session
      const updateMask = "updateMask.fieldPaths=liveParticipants&updateMask.fieldPaths=isLive&updateMask.fieldPaths=lastLeaveTime";
      await fetch(`${firestoreDocUrl}?${updateMask}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            liveParticipants: { arrayValue: { values: [] } },
            isLive: { booleanValue: false },
            lastLeaveTime: { timestampValue: nowIso }
          }
        })
      });
      return res.status(200).json({ ok: true, sessionEnded: false, remainingCount: 0 });
    }
  } catch (err: any) {
    console.error("[Vercel /api/session/leave Error]:", err);
    return res.status(500).json({ error: err.message || "Failed to process session leave." });
  }
}
