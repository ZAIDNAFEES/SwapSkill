import { Capacitor } from "@capacitor/core";

// Default deployed Vercel backend URL used automatically by native Android/iOS APK builds
const DEFAULT_PRODUCTION_BACKEND_URL = "https://swap-skill-zns.vercel.app";

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
 * Resolves the full URL for any API endpoint (e.g., `/api/livekit/token`, `/api/session/leave`).
 */
export function getApiUrl(endpoint: string): string {
  const cleanPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}${cleanPath}`;
}
