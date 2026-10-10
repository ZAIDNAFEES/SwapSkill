export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Authentication check
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : (req.query?.idToken || "");
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Valid authentication token required to access ICE credentials." });
  }

  const defaultStunServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ];

  const turnUrl = process.env.TURN_URL || process.env.COTURN_URL || process.env.VITE_TURN_URL || "";
  const turnUsername = process.env.TURN_USERNAME || process.env.COTURN_USERNAME || process.env.VITE_TURN_USERNAME || "";
  const turnCredential =
    process.env.TURN_CREDENTIAL ||
    process.env.TURN_PASSWORD ||
    process.env.COTURN_PASSWORD ||
    process.env.VITE_TURN_CREDENTIAL ||
    "";

  const iceServers = [...defaultStunServers];

  if (turnUrl && turnUsername && turnCredential) {
    const turnUrls = turnUrl.split(",").map((u) => u.trim()).filter(Boolean);
    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return res.status(200).json({
    iceServers,
    turnEnabled: Boolean(turnUrl && turnUsername && turnCredential),
    timestamp: Date.now(),
  });
}
