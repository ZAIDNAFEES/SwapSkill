import { Capacitor } from "@capacitor/core";

// Default deployed Vercel backend URL used automatically by native Android/iOS APK builds
const DEFAULT_PRODUCTION_BACKEND_URL = "https://swap-skill-cnge.vercel.app";

/**
 * Retrieves the base URL for API requests.
 * 
 * - Web Browser:
 *   Returns `""` by default so requests use same-origin relative URLs (`/api/...`).
 *   If `VITE_API_URL` is explicitly configured, it uses that domain instead.
 * 
 * - Android / iOS Native APK (Capacitor):
 *   Runs in a local WebView container (`https://localhost` or `capacitor://localhost`).
 *   Relative URLs will fail because there is no API server on the device.
 *   Therefore, the APK requires the deployed HTTPS backend URL, which defaults to
 *   your Vercel deployment or can be overridden via `VITE_API_URL`.
 */
export function getApiBaseUrl(): string {
  const envApiUrl = (
    (import.meta.env.VITE_API_URL as string) ||
    (import.meta.env.VITE_BACKEND_URL as string) ||
    (import.meta.env.VITE_VERCEL_URL as string) ||
    ""
  ).trim().replace(/\/+$/, "");

  if (envApiUrl) {
    // Ensure protocol is present
    if (!envApiUrl.startsWith("http://") && !envApiUrl.startsWith("https://")) {
      return `https://${envApiUrl}`;
    }
    return envApiUrl;
  }

  // Web browser uses relative path to current origin
  if (!Capacitor.isNativePlatform()) {
    return "";
  }

  // Native Android/iOS builds: automatically use the deployed Vercel URL
  return DEFAULT_PRODUCTION_BACKEND_URL;
}

/**
 * Resolves the full URL for any API endpoint (e.g., `/api/session/leave`, `/api/health`).
 */
export function getApiUrl(endpoint: string): string {
  const cleanPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}${cleanPath}`;
}

/**
 * Resolves the public app origin/base URL for generating share links, deep links, etc.
 * Never returns localhost, 127.0.0.1, 192.168.x.x, 10.x.x.x, or Capacitor internal origins.
 * Dynamically uses the production web origin if running on a real domain, or falls back
 * to the configured production URL.
 */
export function getPublicAppOrigin(): string {
  // 1. Explicitly configured client-side public app URL or domain
  const explicitUrl = (
    (import.meta.env.VITE_PUBLIC_APP_URL as string) ||
    (import.meta.env.VITE_APP_URL as string) ||
    (import.meta.env.VITE_API_URL as string) ||
    (import.meta.env.VITE_BACKEND_URL as string) ||
    ""
  ).trim().replace(/\/+$/, "");

  if (explicitUrl) {
    if (!explicitUrl.startsWith("http://") && !explicitUrl.startsWith("https://")) {
      return `https://${explicitUrl}`;
    }
    return explicitUrl;
  }

  // 2. Check window.location.origin in web browser
  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    const hostname = window.location.hostname?.toLowerCase() || "";
    const isLocalOrInternal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.endsWith(".local") ||
      origin.startsWith("capacitor://") ||
      origin.startsWith("ionic://");

    // If running on a real web domain (production web or custom domain), dynamically use current origin!
    if (!isLocalOrInternal && origin.startsWith("http")) {
      return origin;
    }
  }

  // 3. Native APK or local development fallback to deployed production URL
  return DEFAULT_PRODUCTION_BACKEND_URL;
}

/**
 * Generates a public, shareable profile URL for any user.
 * Guaranteed to be a valid, production HTTPS link.
 */
export function getShareProfileUrl(userId: string): string {
  const base = getPublicAppOrigin();
  return `${base}/profile/${encodeURIComponent(userId)}`;
}

