import { auth } from "../firebase";
import { getApiUrl } from "./apiConfig";

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
 * Secure dispatcher for FCM push notifications across Web and native Android APK.
 * 
 * Strategy:
 * 1. Collects all recipient tokens (from payload + Firestore user record).
 * 2. Requests backend dispatch via `/api/notifications/send-push` and `/api/send-push`.
 * 3. Keeps all service-account credentials strictly protected on the backend environment.
 */
export async function dispatchPushNotification(payload: PushNotificationPayload): Promise<boolean> {
  const startTime = Date.now();
  console.log(`[TIMING] FCM_REQUEST_START: recipientUserId=${payload.recipientUserId} type=${payload.data?.type || "alert"} callId=${payload.data?.callId || ""} t=${startTime}`);

  try {
    const idToken = await auth.currentUser?.getIdToken().catch(() => undefined);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    };

    // Single verified production backend endpoint for push notification dispatch
    const endpointUrl = getApiUrl("/api/notifications/send-push");

    const requestBody = {
      recipientUserId: payload.recipientUserId,
      pushToken: payload.pushToken,
      deviceTokens: payload.deviceTokens,
      title: payload.title,
      body: payload.body,
      channelId: payload.channelId,
      priority: payload.priority || "high",
      sound: payload.sound || "default",
      data: payload.data,
    };

    const res = await fetch(endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      if (json.ok) {
        console.log(`[TIMING] FCM_SENT: recipientUserId=${payload.recipientUserId} callId=${payload.data?.callId || ""} totalTokens=${json.totalTokens || 0} elapsed=${Date.now() - startTime}ms t=${Date.now()}`);
        return true;
      }
    } else {
      console.warn(`[PushDispatch] Endpoint ${endpointUrl} returned status ${res.status}`);
    }
  } catch (err) {
    console.warn("[PushDispatch] Backend push dispatch error:", err);
  }

  return false;
}
