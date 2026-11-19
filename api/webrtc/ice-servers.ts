/**
 * WebRTC ICE Servers Configuration & Multi-Provider Resolver
 *
 * Robustly resolves STUN and TURN ICE servers for peer-to-peer audio, video,
 * and screen-sharing sessions with:
 * 1. Automatic TURN URL protocol normalization (fixes missing turn:/turns: and turn:// typos)
 * 2. Strict provider credential isolation (never mixes ExpressTurn and Metered credentials)
 * 3. High-availability STUN and Metered TURN fallback retention
 * 4. Token-based authentication protection
 */

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceServersResolutionResult {
  iceServers: IceServerConfig[];
  turnEnabled: boolean;
  timestamp: number;
}

/**
 * Standard Metered fallback relay credentials (isolated strictly to Metered hosts)
 */
export const DEFAULT_METERED_CONFIG: { urls: string[]; username: string; credential: string } = {
  urls: [
    "turn:global.relay.metered.ca:80",
    "turn:global.relay.metered.ca:80?transport=tcp",
    "turn:global.relay.metered.ca:443",
    "turns:global.relay.metered.ca:443?transport=tcp",
  ],
  username: "13748a1862f0e5316c1a9877",
  credential: "9cgHjuE4wpy1L/Dq",
};

/**
 * High-reliability multi-region STUN endpoints for initial direct peer NAT discovery
 */
export const DEFAULT_STUN_SERVERS: string[] = [
  "stun:stun.l.google.com:19302",
  "stun:stun.relay.metered.ca:80",
];

/**
 * Normalizes a single TURN URL:
 * - Strips accidental trailing slashes
 * - Converts invalid URI schemes like "turn://" or "turns://" to standard "turn:" or "turns:"
 * - Detects missing protocol and automatically prepends "turn:" or "turns:" (for port 5349 / TLS)
 * - Converts accidental "stun:"/"stuns:" prefixes on TURN URLs to "turn:"/"turns:"
 */
export function normalizeTurnUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  let url = rawUrl.trim();
  if (!url) return "";

  // Strip trailing slashes that break RTCPeerConnection URL parsing
  url = url.replace(/\/+$/, "");

  // Fix common typo: protocol with double slashes (e.g., turn://host:3478 or turns://host:5349)
  if (/^turns?:\/\//i.test(url)) {
    url = url.replace(/^turn:\/\//i, "turn:").replace(/^turns:\/\//i, "turns:");
  }

  // Convert accidental stun: / stuns: prefix on a TURN configuration
  if (/^stuns?:\/\//i.test(url)) {
    url = url.replace(/^stun:\/\//i, "turn:").replace(/^stuns:\/\//i, "turns:");
    return url;
  }
  if (/^stuns?:/i.test(url)) {
    url = url.replace(/^stun:/i, "turn:").replace(/^stuns:/i, "turns:");
    return url;
  }

  // If already prefixed with valid turn: or turns: scheme
  if (/^turns?:/i.test(url)) {
    return url;
  }

  // Missing protocol entirely:
  // Standard RFC port 5349 or explicit TLS parameters indicate TURNS (TURN over TLS)
  const isSecure =
    /:5349\b/i.test(url) ||
    /transport=(tls|tcp-tls)/i.test(url) ||
    /\bturns\b/i.test(url);

  return `${isSecure ? "turns:" : "turn:"}${url}`;
}

/**
 * Normalizes an array or comma/newline/semicolon-separated string of TURN URLs
 */
export function normalizeTurnUrls(input: string | string[] | undefined | null): string[] {
  if (!input) return [];
  const rawList = Array.isArray(input)
    ? input
    : input.split(/[\n,;]+/).map((s) => s.trim());

  const result: string[] = [];
  for (const item of rawList) {
    const normalized = normalizeTurnUrl(item);
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Normalizes a single STUN URL:
 * - Fixes "stun://" or "stuns://" typos
 * - Adds "stun:" or "stuns:" if protocol is missing
 */
export function normalizeStunUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  let url = rawUrl.trim().replace(/\/+$/, "");
  if (!url) return "";

  if (/^stuns?:\/\//i.test(url)) {
    url = url.replace(/^stun:\/\//i, "stun:").replace(/^stuns:\/\//i, "stuns:");
  }
  if (/^stuns?:/i.test(url)) {
    return url;
  }
  const isSecure = /:5349\b/i.test(url);
  return `${isSecure ? "stuns:" : "stun:"}${url}`;
}

export function normalizeStunUrls(input: string | string[] | undefined | null): string[] {
  if (!input) return [];
  const rawList = Array.isArray(input)
    ? input
    : input.split(/[\n,;]+/).map((s) => s.trim());

  const result: string[] = [];
  for (const item of rawList) {
    const normalized = normalizeStunUrl(item);
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Resolves the complete, validated list of ICE servers with strict provider separation.
 *
 * Rules enforced:
 * 1. ExpressTurn URLs NEVER receive Metered credentials.
 * 2. Metered URLs NEVER receive ExpressTurn credentials.
 * 3. Default high-availability STUN servers and fallback Metered TURN are preserved.
 * 4. All URLs are normalized into valid RFC-compliant WebRTC RTCIceServer format.
 */
export function getResolvedIceServers(): IceServersResolutionResult {
  const iceServers: IceServerConfig[] = [];

  // 1. STUN Servers (always included for direct peer discovery)
  const defaultStuns = normalizeStunUrls(DEFAULT_STUN_SERVERS);
  const customStunRaw = process.env.STUN_URL || process.env.STUN_URLS;
  const customStuns = customStunRaw ? normalizeStunUrls(customStunRaw) : [];
  const combinedStuns = [...defaultStuns];
  for (const s of customStuns) {
    if (!combinedStuns.includes(s)) {
      combinedStuns.push(s);
    }
  }
  for (const stunUrl of combinedStuns) {
    iceServers.push({ urls: stunUrl });
  }

  // 2. Discover Provider Environment Variables
  const envExpressTurnUrl =
    process.env.EXPRESSTURN_URL ||
    process.env.EXPRESS_TURN_URL ||
    process.env.EXPRESSTURN_URLS ||
    process.env.EXPRESS_TURN_URLS ||
    "";
  const envExpressTurnUsername =
    process.env.EXPRESSTURN_USERNAME ||
    process.env.EXPRESS_TURN_USERNAME ||
    process.env.EXPRESSTURN_USER ||
    process.env.EXPRESS_TURN_USER ||
    "";
  const envExpressTurnCredential =
    process.env.EXPRESSTURN_CREDENTIAL ||
    process.env.EXPRESS_TURN_CREDENTIAL ||
    process.env.EXPRESSTURN_PASSWORD ||
    process.env.EXPRESS_TURN_PASSWORD ||
    process.env.EXPRESSTURN_SECRET ||
    process.env.EXPRESS_TURN_SECRET ||
    "";

  const envMeteredUrl =
    process.env.METERED_TURN_URL ||
    process.env.METERED_URL ||
    process.env.METERED_TURN_URLS ||
    process.env.METERED_URLS ||
    "";
  const envMeteredUsername =
    process.env.METERED_TURN_USERNAME ||
    process.env.METERED_USERNAME ||
    process.env.METERED_USER ||
    "";
  const envMeteredCredential =
    process.env.METERED_TURN_CREDENTIAL ||
    process.env.METERED_CREDENTIAL ||
    process.env.METERED_PASSWORD ||
    process.env.METERED_SECRET ||
    "";

  const envGenericTurnUrl =
    process.env.TURN_URL ||
    process.env.COTURN_URL ||
    process.env.VITE_TURN_URL ||
    "";
  const envGenericTurnUsername =
    process.env.TURN_USERNAME ||
    process.env.COTURN_USERNAME ||
    process.env.VITE_TURN_USERNAME ||
    "";
  const envGenericTurnCredential =
    process.env.TURN_CREDENTIAL ||
    process.env.TURN_PASSWORD ||
    process.env.COTURN_PASSWORD ||
    process.env.VITE_TURN_CREDENTIAL ||
    "";

  // Determine provider routing for generic TURN_URL:
  const isGenericExpressTurn = /expressturn/i.test(envGenericTurnUrl);
  const isGenericMetered = /metered\.ca|metered/i.test(envGenericTurnUrl);

  // 3. Resolve ExpressTurn Configuration
  let finalExpressUrls: string[] = [];
  let finalExpressUsername = envExpressTurnUsername;
  let finalExpressCredential = envExpressTurnCredential;

  if (envExpressTurnUrl) {
    finalExpressUrls = normalizeTurnUrls(envExpressTurnUrl);
  } else if (isGenericExpressTurn) {
    finalExpressUrls = normalizeTurnUrls(envGenericTurnUrl);
    if (!finalExpressUsername) finalExpressUsername = envGenericTurnUsername;
    if (!finalExpressCredential) finalExpressCredential = envGenericTurnCredential;
  }

  // Strictly verify ExpressTurn credentials (never use Metered credentials)
  if (finalExpressUrls.length > 0) {
    const isMeteredCred =
      finalExpressUsername === DEFAULT_METERED_CONFIG.username ||
      finalExpressCredential === DEFAULT_METERED_CONFIG.credential;

    if (finalExpressUsername && finalExpressCredential && !isMeteredCred) {
      iceServers.push({
        urls: finalExpressUrls,
        username: finalExpressUsername,
        credential: finalExpressCredential,
      });
      console.log(
        `[WebRTC ICE] Configured ${finalExpressUrls.length} ExpressTurn relay endpoints with isolated ExpressTurn credentials.`
      );
    } else {
      console.warn(
        `[WebRTC ICE] ExpressTurn URLs detected (${finalExpressUrls.join(
          ", "
        )}) but missing dedicated ExpressTurn credentials. Strictly isolated: Metered credentials will NOT be used for ExpressTurn.`
      );
    }
  }

  // 4. Resolve Custom Coturn / Third-Party Provider
  if (envGenericTurnUrl && !isGenericExpressTurn && !isGenericMetered) {
    const customCoturnUrls = normalizeTurnUrls(envGenericTurnUrl);
    if (customCoturnUrls.length > 0 && envGenericTurnUsername && envGenericTurnCredential) {
      iceServers.push({
        urls: customCoturnUrls,
        username: envGenericTurnUsername,
        credential: envGenericTurnCredential,
      });
      console.log(
        `[WebRTC ICE] Configured ${customCoturnUrls.length} custom Coturn relay endpoints with matching credentials.`
      );
    }
  }

  // 5. Resolve Metered Provider (Custom or Default High-Availability Fallback)
  let meteredUrls: string[] = [];
  let meteredUser = "";
  let meteredPass = "";

  if (envMeteredUrl) {
    meteredUrls = normalizeTurnUrls(envMeteredUrl);
    meteredUser = envMeteredUsername || envGenericTurnUsername || DEFAULT_METERED_CONFIG.username;
    meteredPass = envMeteredCredential || envGenericTurnCredential || DEFAULT_METERED_CONFIG.credential;
  } else if (isGenericMetered) {
    meteredUrls = normalizeTurnUrls(envGenericTurnUrl);
    meteredUser = envMeteredUsername || envGenericTurnUsername || DEFAULT_METERED_CONFIG.username;
    meteredPass = envMeteredCredential || envGenericTurnCredential || DEFAULT_METERED_CONFIG.credential;
  } else {
    // Preserve default Metered fallback relay for rock-solid mobile NAT traversal
    meteredUrls = DEFAULT_METERED_CONFIG.urls;
    meteredUser = envMeteredUsername || DEFAULT_METERED_CONFIG.username;
    meteredPass = envMeteredCredential || DEFAULT_METERED_CONFIG.credential;
  }

  if (meteredUrls.length > 0 && meteredUser && meteredPass) {
    iceServers.push({
      urls: meteredUrls,
      username: meteredUser,
      credential: meteredPass,
    });
  }

  const hasTurn = iceServers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => /^turns?:/i.test(u)) && Boolean(s.username && s.credential);
  });

  return {
    iceServers,
    turnEnabled: hasTurn,
    timestamp: Date.now(),
  };
}

/**
 * Serverless API Route Handler (/api/webrtc/ice-servers)
 */
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
  const authHeader = req.headers?.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.substring(7).trim()
    : req.query?.idToken || (req.body as any)?.idToken || "";

  if (!token) {
    return res.status(401).json({
      error: "Unauthorized: Valid authentication token required to access ICE credentials.",
    });
  }

  const resolved = getResolvedIceServers();
  return res.status(200).json(resolved);
}
