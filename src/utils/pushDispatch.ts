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

    // For chat and recipient-targeted notifications, send clean payload with recipientUserId
    // Backend server-side Firebase Admin SDK securely resolves all current device tokens from Firestore
    const isChat = payload.data?.type === "chat";
    const requestBody = isChat
      ? {
          recipientUserId: payload.recipientUserId,
          title: payload.title,
          body: payload.body,
          channelId: payload.channelId,
          priority: payload.priority,
          sound: payload.sound,
          data: payload.data,
        }
      : payload;

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        });

        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          if (json.ok) {
            return true;
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

  return false;
}
