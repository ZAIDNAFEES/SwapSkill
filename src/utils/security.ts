import { safeLocalStorage } from "./safeStorage";

/**
 * Utility functions for user agent parsing, IP lookup, device ID generation, and trusted devices
 */

export interface DeviceInfo {
  browser: string;
  browserVersion: string;
  operatingSystem: string;
  deviceType: "Desktop" | "Mobile" | "Tablet";
  screenResolution: string;
  language: string;
  userAgent: string;
  timezone: string;
}

export interface GeoInfo {
  ip: string;
  country: string;
  region: string;
  city: string;
  isp: string;
  timezone: string;
}

/**
 * Generates or retrieves a unique device ID from safeLocalStorage
 */
export function getOrCreateDeviceId(): string {
  let deviceId = null;
  try {
    deviceId = safeLocalStorage.getItem("swapskill_device_id");
  } catch (_) {}
  if (!deviceId) {
    deviceId = "dev_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    try {
      safeLocalStorage.setItem("swapskill_device_id", deviceId);
    } catch (_) {}
  }
  return deviceId;
}

/**
 * Parses user agent string into browser, OS, and device type info
 */
export function parseUserAgent(ua: string): {
  browser: string;
  browserVersion: string;
  operatingSystem: string;
  deviceType: "Desktop" | "Mobile" | "Tablet";
} {
  let browser = "Other";
  let browserVersion = "Unknown";
  let operatingSystem = "Other";
  let deviceType: "Desktop" | "Mobile" | "Tablet" = "Desktop";

  // Device type detection
  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    deviceType = "Tablet";
  } else if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile|webos/i.test(ua)) {
    deviceType = "Mobile";
  } else {
    deviceType = "Desktop";
  }

  // OS detection
  if (/windows/i.test(ua)) {
    operatingSystem = "Windows";
    if (/windows nt 10/i.test(ua)) operatingSystem = "Windows 10/11";
    else if (/windows nt 6.3/i.test(ua)) operatingSystem = "Windows 8.1";
    else if (/windows nt 6.2/i.test(ua)) operatingSystem = "Windows 8";
    else if (/windows nt 6.1/i.test(ua)) operatingSystem = "Windows 7";
  } else if (/macintosh|mac os x/i.test(ua)) {
    operatingSystem = "macOS";
  } else if (/android/i.test(ua)) {
    operatingSystem = "Android";
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    operatingSystem = "iOS";
  } else if (/linux/i.test(ua)) {
    operatingSystem = "Linux";
  }

  // Browser detection
  if (/chrome|crios/i.test(ua) && !/edge|edg/i.test(ua) && !/opr|opera/i.test(ua)) {
    browser = "Chrome";
    const matches = ua.match(/(?:chrome|crios)\/([0-9.]+)/i);
    if (matches) browserVersion = matches[1];
  } else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua) && !/edge|edg/i.test(ua)) {
    browser = "Safari";
    const matches = ua.match(/version\/([0-9.]+)/i);
    if (matches) browserVersion = matches[1];
  } else if (/firefox|fxios/i.test(ua)) {
    browser = "Firefox";
    const matches = ua.match(/(?:firefox|fxios)\/([0-9.]+)/i);
    if (matches) browserVersion = matches[1];
  } else if (/edge|edg/i.test(ua)) {
    browser = "Edge";
    const matches = ua.match(/(?:edge|edg)\/([0-9.]+)/i);
    if (matches) browserVersion = matches[1];
  } else if (/opr|opera/i.test(ua)) {
    browser = "Opera";
    const matches = ua.match(/(?:opr|opera)\/([0-9.]+)/i);
    if (matches) browserVersion = matches[1];
  }

  return { browser, browserVersion, operatingSystem, deviceType };
}

/**
 * Gathers complete local device specifications
 */
export function getLocalDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent;
  const { browser, browserVersion, operatingSystem, deviceType } = parseUserAgent(ua);
  const screenResolution = `${window.screen.width}x${window.screen.height}`;
  const language = navigator.language || "en-US";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return {
    browser,
    browserVersion,
    operatingSystem,
    deviceType,
    screenResolution,
    language,
    userAgent: ua,
    timezone,
  };
}

/**
 * Reusable fetch helper with abort timeout
 */
async function fetchWithTimeout(url: string, options?: RequestInit, ms = 1500): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/**
 * Fetches public IP and details from ipify and ipapi with local caching
 */
export async function fetchIPAndGeo(): Promise<GeoInfo> {
  const cacheKey = "swapskill_geo_cache";
  try {
    const saved = safeLocalStorage.getItem(cacheKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Date.now() - parsed.timestamp < 3600000) { // 1 hour cache
        return parsed.data;
      }
    }
  } catch (_) {}

  const defaultGeo: GeoInfo = {
    ip: "127.0.0.1",
    country: "Unknown",
    region: "Unknown",
    city: "Unknown",
    isp: "Local Loopback",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };

  try {
    // 1. Fetch IP Address with 1.5s timeout
    const ipRes = await fetchWithTimeout("https://api.ipify.org?format=json", {}, 1500);
    if (!ipRes.ok) throw new Error("Failed to fetch public IP");
    const ipData = await ipRes.json();
    const ip = ipData.ip || "127.0.0.1";

    // 2. Fetch Geo & ISP using ipapi with 1.5s timeout
    const geoRes = await fetchWithTimeout(`https://ipapi.co/${ip}/json/`, {}, 1500);
    if (!geoRes.ok) throw new Error("Failed to fetch geolocation for IP");
    const geoData = await geoRes.json();

    const result: GeoInfo = {
      ip,
      country: geoData.country_name || "Unknown",
      region: geoData.region || "Unknown",
      city: geoData.city || "Unknown",
      isp: geoData.org || "Unknown ISP",
      timezone: geoData.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };

    try {
      safeLocalStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data: result
      }));
    } catch (_) {}

    return result;
  } catch (error) {
    console.log("Geo-location fetch bypassed or using local fallback.");
    return defaultGeo;
  }
}
