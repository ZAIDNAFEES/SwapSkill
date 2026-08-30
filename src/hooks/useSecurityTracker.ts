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

export function useSecurityTracker(user: User | null) {
  useEffect(() => {
    if (!user) return;

    let isSubscribed = true;
    let unsubscribeDeviceListener: (() => void) | null = null;

    async function trackLoginAndSession() {
      try {
        const deviceId = getOrCreateDeviceId();
        const sessionCheckedKey = `swapskill_session_checked_${user.uid}`;
        const isSessionChecked = safeSessionStorage.getItem(sessionCheckedKey);

        // 1. Gather all local device and public IP details
        const deviceInfo = getLocalDeviceInfo();
        const geoInfo = await fetchIPAndGeo();

        if (!isSubscribed) return;

        // 2. Manage Trusted Device record
        const trustedDocRef = doc(db, "users", user.uid, "trustedDevices", deviceId);
        const trustedSnap = await getDoc(trustedDocRef);

        let isTrusted = false;
        if (!trustedSnap.exists()) {
          // First time this device logs in, default to untrusted (User can approve in UI)
          // Exception: If this is the first device ever, we could make it trusted,
          // but to satisfy Feature 9 strictly: mark as untrusted first time ("New Device").
          await setDoc(trustedDocRef, {
            deviceId,
            trusted: false,
            browser: deviceInfo.browser,
            os: deviceInfo.operatingSystem,
            lastUsed: serverTimestamp(),
            addedAt: serverTimestamp()
          });
        } else {
          isTrusted = trustedSnap.data()?.trusted || false;
          // Update last used timestamp
          await updateDoc(trustedDocRef, {
            lastUsed: serverTimestamp()
          });
        }

        // 3. Increment login count and write to users/{uid}/security ONCE per session
        if (!isSessionChecked) {
          const securityDocRef = doc(db, "users", user.uid, "security", "stats");
          const securitySnap = await getDoc(securityDocRef);

          const securityData = {
            lastLogin: serverTimestamp(),
            lastIP: geoInfo.ip,
            country: geoInfo.country,
            region: geoInfo.region,
            city: geoInfo.city,
            timezone: geoInfo.timezone,
            language: deviceInfo.language,
            browser: deviceInfo.browser,
            browserVersion: deviceInfo.browserVersion,
            operatingSystem: deviceInfo.operatingSystem,
            deviceType: deviceInfo.deviceType,
            screenResolution: deviceInfo.screenResolution,
            userAgent: deviceInfo.userAgent,
            isp: geoInfo.isp,
            loginCount: securitySnap.exists() ? increment(1) : 1
          };

          await setDoc(securityDocRef, securityData, { merge: true });

          // 4. Create an entry in loginHistory
          const historyCollectionRef = collection(db, "users", user.uid, "loginHistory");
          await addDoc(historyCollectionRef, {
            timestamp: serverTimestamp(),
            ip: geoInfo.ip,
            browser: deviceInfo.browser,
            os: deviceInfo.operatingSystem,
            city: geoInfo.city,
            country: geoInfo.country,
            device: deviceInfo.deviceType,
            timezone: geoInfo.timezone
          });

          // Mark session as tracked in safeSessionStorage to avoid duplicate writes
          safeSessionStorage.setItem(sessionCheckedKey, "true");
        }

        // 5. Register/Update Active Device session in Firestore
        // This is always done on load to ensure the session remains active
        const activeDeviceDocRef = doc(db, "users", user.uid, "activeDevices", deviceId);
        await setDoc(activeDeviceDocRef, {
          deviceId,
          browser: deviceInfo.browser,
          os: deviceInfo.operatingSystem,
          lastActive: serverTimestamp(),
          ip: geoInfo.ip,
          city: geoInfo.city,
          country: geoInfo.country,
          userAgent: deviceInfo.userAgent,
          current: true
        });

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
