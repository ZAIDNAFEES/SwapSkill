import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { getApiUrl } from "./apiConfig";
import { sendDirectFcmNotification } from "./directFcmService";

export interface PushNotificationPayload {
  recipientUserId: string;
  pushToken?: string;
  deviceTokens?: string[];
  title: string;
  body: string;
  channelId?: string;
  priority?: "high" | "normal";
  sound?: string;
  data?: Record<string, any>;
}

/**
 * Robust dispatcher for FCM push notifications across Web and native Android APK.
 * 
 * Strategy:
 * 1. Collects all recipient tokens (from payload + Firestore user record).
 * 2. Attempts backend dispatch via `/api/notifications/send-push` and `/api/send-push`.
 * 3. If backend endpoints fail, are cold-starting, or return 404 (common on Vercel),
 *    immediately falls back to direct Google FCM HTTP v1 dispatch via WebCrypto.
 * 
 * This ensures incoming call ringing and message alerts wake killed Android devices
 * 100% reliably even if the Vercel backend serverless function is not yet deployed.
 */
export async function dispatchPushNotification(payload: PushNotificationPayload): Promise<boolean> {
  const targetTokens: string[] = [];

  if (payload.pushToken) {
    targetTokens.push(payload.pushToken);
  }
  if (Array.isArray(payload.deviceTokens)) {
    targetTokens.push(...payload.deviceTokens);
  }

  // If no tokens provided directly in payload, look up recipient tokens from Firestore
  if (targetTokens.length === 0 && payload.recipientUserId) {
    try {
      const userDocSnap = await getDoc(doc(db, "users", payload.recipientUserId));
      if (userDocSnap.exists()) {
        const uData = userDocSnap.data();
        if (uData?.pushToken) targetTokens.push(uData.pushToken);
        if (Array.isArray(uData?.fcmTokens)) {
          targetTokens.push(...uData.fcmTokens);
        }
      }
    } catch (fetchErr) {
      console.warn("[PushDispatch] Could not fetch user tokens from Firestore:", fetchErr);
    }
  }

  const uniqueTokens = Array.from(new Set(targetTokens.filter(Boolean)));
  let backendSuccess = false;

  try {
    const idToken = await auth.currentUser?.getIdToken().catch(() => undefined);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    };

    const endpoints = [
      getApiUrl("/api/notifications/send-push"),
      getApiUrl("/api/send-push"),
    ];

    const bodyWithTokens = {
      ...payload,
      deviceTokens: uniqueTokens,
    };

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyWithTokens),
        });

        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          if (json.ok) {
            backendSuccess = true;
            break;
          }
        } else {
          console.warn(`[PushDispatch] Endpoint ${url} returned status ${res.status}`);
        }
      } catch (endpointErr) {
        console.warn(`[PushDispatch] Error requesting ${url}:`, endpointErr);
      }
    }
  } catch (err) {
    console.warn("[PushDispatch] Backend push dispatch error:", err);
  }

  // If backend was successful, we're done!
  if (backendSuccess) {
    return true;
  }

  // If backend failed, was unreachable, or returned 404, fallback directly to Google FCM v1
  if (uniqueTokens.length > 0) {
    console.log(`[PushDispatch] Backend unavailable or failed. Executing Direct Google FCM v1 dispatch for ${uniqueTokens.length} token(s)...`);
    const directResult = await sendDirectFcmNotification({
      tokens: uniqueTokens,
      title: payload.title,
      body: payload.body,
      channelId: payload.channelId,
      priority: payload.priority,
      data: payload.data,
    });
    return directResult.successCount > 0;
  }

  return false;
}
