import { useEffect } from "react";
import { User } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  serverTimestamp,
  increment,
  onSnapshot,
  deleteDoc
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { getOrCreateDeviceId, getLocalDeviceInfo, fetchIPAndGeo } from "../utils/security";
import { safeSessionStorage } from "../utils/safeStorage";

/**
 * Strips undefined properties to guarantee Firestore setDoc/updateDoc/addDoc never crash
 */
function sanitizeFirestoreObject<T extends Record<string, any>>(obj: T): T {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && typeof (value as any).toMillis !== "function" && !(value as any)?._methodName) {
        sanitized[key] = sanitizeFirestoreObject(value);
      } else {
        sanitized[key] = value;
      }
    }
  }
  return sanitized as T;
}

export function useSecurityTracker(user: User | null) {
  useEffect(() => {
    if (!user) return;

    let isSubscribed = true;
    let unsubscribeDeviceListener: (() => void) | null = null;

    async function trackLoginAndSession() {
      try {
        const deviceId = getOrCreateDeviceId() || "dev_default";
        const sessionCheckedKey = `swapskill_session_checked_${user.uid}`;
        const isSessionChecked = safeSessionStorage.getItem(sessionCheckedKey);

        // 1. Gather all local device and public IP details
        const deviceInfo: any = getLocalDeviceInfo() || {};
        const geoInfo: any = (await fetchIPAndGeo()) || {};

        if (!isSubscribed) return;

        // Resolved timezone and geolocation fallbacks
        let localFallbackTz = "UTC";
        try {
          localFallbackTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        } catch (_) {}

        const safeTimezone: string = (geoInfo && typeof geoInfo.timezone === "string" && geoInfo.timezone.trim())
          ? geoInfo.timezone.trim()
          : (deviceInfo && typeof deviceInfo.timezone === "string" && deviceInfo.timezone.trim())
          ? deviceInfo.timezone.trim()
          : (localFallbackTz || "UTC");

        const safeIp = (geoInfo?.ip && typeof geoInfo.ip === "string") ? geoInfo.ip : "127.0.0.1";
        const safeCountry = (geoInfo?.country && typeof geoInfo.country === "string") ? geoInfo.country : "Unknown";
        const safeRegion = (geoInfo?.region && typeof geoInfo.region === "string") ? geoInfo.region : "Unknown";
        const safeCity = (geoInfo?.city && typeof geoInfo.city === "string") ? geoInfo.city : "Unknown";
        const safeIsp = (geoInfo?.isp && typeof geoInfo.isp === "string") ? geoInfo.isp : "Unknown ISP";

        const safeBrowser = deviceInfo?.browser || "Other";
        const safeBrowserVersion = deviceInfo?.browserVersion || "Unknown";
        const safeOS = deviceInfo?.operatingSystem || "Other";
        const safeDeviceType = deviceInfo?.deviceType || "Desktop";
        const safeScreen = deviceInfo?.screenResolution || "Unknown";
        const safeLanguage = deviceInfo?.language || "en-US";
        const safeUA = deviceInfo?.userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "Unknown") || "Unknown";

        // 2. Manage Trusted Device record
        const trustedDocRef = doc(db, "users", user.uid, "trustedDevices", deviceId);
        const trustedSnap = await getDoc(trustedDocRef);

        let isTrusted = false;
        if (!trustedSnap.exists()) {
          // First time this device logs in, default to untrusted (User can approve in UI)
          await setDoc(trustedDocRef, sanitizeFirestoreObject({
            deviceId,
            trusted: false,
            browser: safeBrowser,
            os: safeOS,
            lastUsed: serverTimestamp(),
            addedAt: serverTimestamp()
          }));
        } else {
          isTrusted = trustedSnap.data()?.trusted || false;
          // Update last used timestamp
          await updateDoc(trustedDocRef, sanitizeFirestoreObject({
            lastUsed: serverTimestamp()
          }));
        }

        // 3. Increment login count and write to users/{uid}/security ONCE per session
        if (!isSessionChecked) {
          const securityDocRef = doc(db, "users", user.uid, "security", "stats");
          const securitySnap = await getDoc(securityDocRef);

          const rawSecurityData = {
            lastLogin: serverTimestamp(),
            lastIP: safeIp,
            country: safeCountry,
            region: safeRegion,
            city: safeCity,
            timezone: safeTimezone || "UTC",
            language: safeLanguage,
            browser: safeBrowser,
            browserVersion: safeBrowserVersion,
            operatingSystem: safeOS,
            deviceType: safeDeviceType,
            screenResolution: safeScreen,
            userAgent: safeUA,
            isp: safeIsp,
            loginCount: securitySnap.exists() ? increment(1) : 1
          };

          const securityData = sanitizeFirestoreObject(rawSecurityData);

          await setDoc(securityDocRef, securityData, { merge: true });

          // 4. Create an entry in loginHistory
          const historyCollectionRef = collection(db, "users", user.uid, "loginHistory");
          await addDoc(historyCollectionRef, sanitizeFirestoreObject({
            timestamp: serverTimestamp(),
            ip: safeIp,
            browser: safeBrowser,
            os: safeOS,
            city: safeCity,
            country: safeCountry,
            device: safeDeviceType,
            timezone: safeTimezone || "UTC"
          }));

          // Mark session as tracked in safeSessionStorage to avoid duplicate writes
          safeSessionStorage.setItem(sessionCheckedKey, "true");
        }

        // 5. Register/Update Active Device session in Firestore
        // This is always done on load to ensure the session remains active
        const activeDeviceDocRef = doc(db, "users", user.uid, "activeDevices", deviceId);
        await setDoc(activeDeviceDocRef, sanitizeFirestoreObject({
          deviceId,
          browser: safeBrowser,
          os: safeOS,
          lastActive: serverTimestamp(),
          ip: safeIp,
          city: safeCity,
          country: safeCountry,
          userAgent: safeUA,
          current: true
        }));

        // 6. Set up snapshot listener to detect if this device is logged out remotely
        unsubscribeDeviceListener = onSnapshot(activeDeviceDocRef, (snap) => {
          if (!snap.exists()) {
            // Document was deleted by another device (remote logout)! Force sign out
            console.log("This device session has been revoked remotely. Logging out...");
            auth.signOut();
          }
        });

      } catch (err) {
        console.error("Error in security login tracker:", err);
      }
    }

    trackLoginAndSession();

    return () => {
      isSubscribed = false;
      if (unsubscribeDeviceListener) {
        unsubscribeDeviceListener();
      }
    };
  }, [user]);
}
