import { 
  collection, 
  addDoc, 
  doc, 
  updateDoc, 
  increment, 
  serverTimestamp 
} from "firebase/firestore";
import { db } from "../firebase";
import { handleFirestoreError, OperationType } from "./firestoreError";
import { User } from "firebase/auth";
import { safeLocalStorage, safeSessionStorage } from "./safeStorage";

// Reusable fetch helper with abort timeout
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

// Fetch public IP address and location details with cache
const fetchIPAndLocation = async () => {
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

  try {
    const res = await fetchWithTimeout("https://ipwho.is/", {}, 1500);
    if (!res.ok) throw new Error("ipwho.is request failed");
    const data = await res.json();
    if (data && data.success) {
      const result = {
        ip: data.ip || "Unknown IP",
        country: data.country || "Unknown Country",
        region: data.region || "Unknown Region",
        city: data.city || "Unknown City",
        isp: data.connection?.isp || data.connection?.org || "Unknown ISP"
      };
      try {
        safeLocalStorage.setItem(cacheKey, JSON.stringify({
          timestamp: Date.now(),
          data: result
        }));
      } catch (_) {}
      return result;
    }
  } catch (e) {
    console.log("ipwho.is lookup bypassed or using local fallback.");
  }

  try {
    const res = await fetchWithTimeout("https://freeipapi.com/api/json", {}, 1500);
    if (res.ok) {
      const data = await res.json();
      return {
        ip: data.ipAddress || "Unknown IP",
        country: data.countryName || "Unknown Country",
        region: data.regionName || "Unknown Region",
        city: data.cityName || "Unknown City",
        isp: "Unknown ISP"
      };
    }
  } catch (e) {
    console.log("freeipapi lookup bypassed or using local fallback.");
  }

  return {
    ip: "Unknown IP",
    country: "Unknown Country",
    region: "Unknown Region",
    city: "Unknown City",
    isp: "Unknown ISP"
  };
};

// Retrieve browser and version info
const getBrowserInfo = () => {
  const ua = navigator.userAgent;
  let browser = "Unknown Browser";
  let version = "Unknown Version";

  if (ua.indexOf("Firefox") > -1) {
    browser = "Mozilla Firefox";
    const match = ua.match(/Firefox\/([0-9.]+)/);
    if (match) version = match[1];
  } else if (ua.indexOf("SamsungBrowser") > -1) {
    browser = "Samsung Internet";
    const match = ua.match(/SamsungBrowser\/([0-9.]+)/);
    if (match) version = match[1];
  } else if (ua.indexOf("Opera") > -1 || ua.indexOf("OPR") > -1) {
    browser = "Opera";
    const match = ua.match(/(?:Opera|OPR)\/([0-9.]+)/);
    if (match) version = match[1];
  } else if (ua.indexOf("Trident") > -1) {
    browser = "Microsoft Internet Explorer";
    const match = ua.match(/rv:([0-9.]+)/);
    if (match) version = match[1];
  } else if (ua.indexOf("Edge") > -1 || ua.indexOf("Edg") > -1) {
    browser = "Microsoft Edge";
    const match = ua.match(/(?:Edge|Edg)\/([0-9.]+)/);
    if (match) version = match[1];
  } else if (ua.indexOf("Chrome") > -1) {
    browser = "Google Chrome";
    const match = ua.match(/Chrome\/([0-9.]+)/);
    if (match) version = match[1];
  } else if (ua.indexOf("Safari") > -1) {
    browser = "Apple Safari";
    const match = ua.match(/Version\/([0-9.]+)/);
    if (match) version = match[1];
  }

  return { browser, version };
};

// Retrieve Operating System info
const getOSInfo = () => {
  const ua = navigator.userAgent;
  let os = "Unknown OS";

  if (ua.indexOf("Windows NT 10.0") > -1) os = "Windows 10/11";
  else if (ua.indexOf("Windows NT 6.3") > -1) os = "Windows 8.1";
  else if (ua.indexOf("Windows NT 6.2") > -1) os = "Windows 8";
  else if (ua.indexOf("Windows NT 6.1") > -1) os = "Windows 7";
  else if (ua.indexOf("Windows NT 6.0") > -1) os = "Windows Vista";
  else if (ua.indexOf("Windows NT 5.1") > -1) os = "Windows XP";
  else if (ua.indexOf("Macintosh") > -1) os = "macOS";
  else if (ua.indexOf("iPhone") > -1) os = "iOS";
  else if (ua.indexOf("iPad") > -1) os = "iPadOS";
  else if (ua.indexOf("Android") > -1) os = "Android";
  else if (ua.indexOf("Linux") > -1) os = "Linux";

  return os;
};

// Retrieve Device Type
const getDeviceType = () => {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return "Tablet";
  }
  if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
    return "Mobile";
  }
  return "Desktop";
};

// Track and write the login log
export const trackLoginSession = async (user: User, currentProfileName?: string) => {
  try {
    // 1. Prevent double logging in the same browser session/tab
    const sessionKey = `swap_tracked_session_${user.uid}`;
    let isTracked = null;
    try {
      isTracked = safeSessionStorage.getItem(sessionKey);
    } catch (_) {}
    if (isTracked) {
      return;
    }

    // Mark as tracked for this session instantly to avoid any parallel triggers
    try {
      safeSessionStorage.setItem(sessionKey, "true");
    } catch (_) {}

    // 2. Collect location & IP data
    const loc = await fetchIPAndLocation();

    // 3. Collect browser/device/screen metrics
    const { browser, version: browserVersion } = getBrowserInfo();
    const os = getOSInfo();
    const device = getDeviceType();
    const screen = `${window.screen.width}x${window.screen.height}`;
    const language = navigator.language || (navigator as any).userLanguage || "Unknown";
    let timezone = "UTC";
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (_) {}
    const userAgent = navigator.userAgent;

    const email = user.email || "";
    const displayName = user.displayName || currentProfileName || email.split("@")[0] || "User";

    // 4. Store in Firestore under 'loginLogs' (Auto-generated ID)
    const logData = {
      uid: user.uid,
      email,
      displayName,
      timestamp: serverTimestamp(),
      ip: loc.ip,
      country: loc.country,
      region: loc.region,
      city: loc.city,
      isp: loc.isp,
      browser,
      browserVersion,
      os,
      device,
      screen,
      language,
      timezone,
      userAgent
    };

    try {
      await addDoc(collection(db, "loginLogs"), logData);
    } catch (err) {
      // Catch and wrap errors using the mandatory handleFirestoreError
      handleFirestoreError(err, OperationType.CREATE, "loginLogs");
    }

    // 5. Update user profile details & increment count in users/{uid}
    const userUpdateData = {
      lastLogin: serverTimestamp(),
      lastIP: loc.ip,
      lastDevice: device,
      lastBrowser: browser,
      lastLocation: loc.city && loc.country ? `${loc.city}, ${loc.region}, ${loc.country}` : "Unknown Location",
      loginCount: increment(1)
    };

    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, userUpdateData);
    } catch (err) {
      // Catch and wrap errors using the mandatory handleFirestoreError
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }

  } catch (globalErr) {
    console.error("Login tracking error:", globalErr);
  }
};
