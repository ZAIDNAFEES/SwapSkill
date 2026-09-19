/**
 * Push Notification & FCM Token Management Service
 * 
 * Bridges @capacitor/push-notifications for Native Android & iOS with Firestore token persistence,
 * channel setup, background message handling, and foreground sound triggering.
 */

import { PushNotifications, Token, PushNotificationSchema, ActionPerformed } from "@capacitor/push-notifications";
import { Capacitor } from "@capacitor/core";
import { doc, updateDoc, setDoc, arrayUnion, arrayRemove, serverTimestamp } from "firebase/firestore";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { app, db } from "../../firebase";
import { safeLocalStorage } from "../../utils/safeStorage";
import {
  startIncomingCallRingtone,
  stopIncomingCallRingtone,
  playNewChatMessage,
  playSessionReminder10Min,
  playSessionStarting,
} from "../../utils/sound";
import { mobileDeepLinkService } from "./deepLinks";
import { mobileCallKitService } from "./callKitService";
import { activeChatTrackingService } from "../activeChatTrackingService";
import { callSignalingService } from "../callSignalingService";

export class PushNotificationService {
  private isInitialized = false;
  private currentUserId: string | null = null;
  private currentToken: string | null = null;
  private webMessagingInstance: any = null;

  public isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Initializes Push Notifications for the authenticated user
   */
  public async init(userId: string): Promise<void> {
    if (!userId || typeof window === "undefined") return;
    const userChanged = this.currentUserId !== userId;
    this.currentUserId = userId;

    if (this.isInitialized && !userChanged) {
      if (this.currentToken) {
        await this.saveTokenToFirestore(userId, this.currentToken);
      }
      return;
    }
    this.isInitialized = true;

    if (this.isNative()) {
      await this.initNativePush(userId);
    } else {
      await this.initWebPush(userId);
    }
  }

  /**
   * Native Capacitor Push Notifications Setup (Android & iOS)
   */
  private async initNativePush(userId: string): Promise<void> {
    try {
      // 1. Create native Android notification channels
      if (Capacitor.getPlatform() === "android") {
        await this.createAndroidChannels();
      }

      // 2. Request permissions
      const permStatus = await PushNotifications.checkPermissions();
      let granted = permStatus.receive === "granted";

      if (!granted) {
        const req = await PushNotifications.requestPermissions();
        granted = req.receive === "granted";
      }

      if (!granted) {
        console.log("[PushNotification] Native push permissions not granted:", permStatus.receive);
        return;
      }

      // 3. Attach listeners BEFORE registering (prevents race condition on Android cold-start)
      PushNotifications.removeAllListeners().catch(() => {});

      PushNotifications.addListener("registration", async (token: Token) => {
        console.log("[PushNotification] FCM Device Token received and registered:", token.value);
        this.currentToken = token.value;
        await this.saveTokenToFirestore(userId, token.value);
        await mobileCallKitService.syncVoipTokenToFirestore(userId);
      });

      PushNotifications.addListener("registrationError", (err: any) => {
        console.warn("[PushNotification] Registration error:", err);
      });

      PushNotifications.addListener("pushNotificationReceived", (notification: PushNotificationSchema) => {
        console.log("[PushNotification] Foreground push received:", notification.title);
        this.handleForegroundPush(notification);
      });

      PushNotifications.addListener("pushNotificationActionPerformed", (action: ActionPerformed) => {
        console.log("[PushNotification] Push action performed:", action.actionId);
        this.handlePushAction(action);
      });

      // 4. Register with Apple APNs / Google FCM
      await PushNotifications.register();
    } catch (err) {
      console.warn("[PushNotification] Error initializing native push:", err);
    }
  }

  /**
   * Web Push Setup & Service Worker Event Listeners
   */
  private async initWebPush(userId: string): Promise<void> {
    if (typeof window === "undefined") return;

    // Listen for Service Worker background notification actions (Answer call / Open session)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === "INCOMING_CALL_ACTION" && msg.callId) {
          mobileDeepLinkService.processDeepLinkUrl(
            `swapskill://call/${msg.callId}?sessionId=${msg.sessionId || ""}${msg.autoAccept ? "&autoAccept=true" : ""}`
          );
        } else if (msg.type === "NAVIGATE_NOTIFICATION") {
          if (msg.sessionId) {
            mobileDeepLinkService.processDeepLinkUrl(`swapskill://session/${msg.sessionId}`);
          } else if (msg.chatId) {
            mobileDeepLinkService.processDeepLinkUrl(`swapskill://chat/${msg.chatId}`);
          }
        }
      });
    }

    try {
      const supported = await isSupported();
      if (!supported) {
        console.log("[PushNotification] Firebase Web Messaging not supported in this browser environment.");
        return;
      }

      this.webMessagingInstance = getMessaging(app);

      // Foreground message listener
      onMessage(this.webMessagingInstance, (payload) => {
        console.log("[WebPush] Foreground push received:", payload);
        const data = payload.data || {};
        this.handleForegroundPush({
          title: payload.notification?.title || data.title || "SwapSkill",
          body: payload.notification?.body || data.body || "",
          data: data,
        } as any);
      });

      // Automatically prompt for permission on web on login/app open if default (like WhatsApp Web/IMO)
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          await this.syncWebFcmToken(userId);
        } else if (Notification.permission === "default") {
          try {
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
              await this.syncWebFcmToken(userId);
            }
          } catch (permErr) {
            console.warn("[PushNotification] Auto permission request error:", permErr);
          }
        }
      }
    } catch (err) {
      console.warn("[PushNotification] Web push init check:", err);
    }
  }

  /**
   * Syncs Web FCM registration token to Firestore
   */
  public async syncWebFcmToken(userId?: string): Promise<string | null> {
    const targetUserId = userId || this.currentUserId;
    if (!targetUserId || typeof window === "undefined" || !("serviceWorker" in navigator)) return null;

    try {
      if (!this.webMessagingInstance) {
        const supported = await isSupported();
        if (!supported) return null;
        this.webMessagingInstance = getMessaging(app);
      }

      const swReg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const vapidKey = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY || undefined;
      const token = await getToken(this.webMessagingInstance, {
        serviceWorkerRegistration: swReg,
        vapidKey,
      });

      if (token) {
        this.currentToken = token;
        await this.saveTokenToFirestore(targetUserId, token);
        console.log("[PushNotification] Web FCM token registered and saved to Firestore.");
        return token;
      }
    } catch (err) {
      console.warn("[PushNotification] Error syncing Web FCM token:", err);
    }
    return null;
  }

  /**
   * Request user permission and register device for Push Notifications
   */
  public async requestPermissionAndRegister(userId?: string): Promise<boolean> {
    const targetUserId = userId || this.currentUserId;
    if (!targetUserId || typeof window === "undefined") return false;

    if (this.isNative()) {
      try {
        const req = await PushNotifications.requestPermissions();
        if (req.receive === "granted") {
          await PushNotifications.register();
          return true;
        }
        return false;
      } catch (err) {
        console.warn("[PushNotification] Native request permission error:", err);
        return false;
      }
    } else {
      if (!("Notification" in window)) return false;
      try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          await this.syncWebFcmToken(targetUserId);
          return true;
        }
        return false;
      } catch (err) {
        console.warn("[PushNotification] Web request permission error:", err);
        return false;
      }
    }
  }

  /**
   * Create Android Notification Channels with sound and high importance
   */
  private async createAndroidChannels(): Promise<void> {
    try {
      await PushNotifications.createChannel({
        id: "swapskill_calls",
        name: "Live Swap Calls",
        description: "Incoming audio and video Live Swap calls",
        importance: 5, // High / Heads-up
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: "#C9A96E",
      });

      await PushNotifications.createChannel({
        id: "swapskill_session_alarms",
        name: "Session Reminders & Alarms",
        description: "10-minute and session start notifications",
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: "#C9A96E",
      });

      await PushNotifications.createChannel({
        id: "swapskill_messages",
        name: "Chat Messages",
        description: "New direct messages from partners",
        importance: 4,
        visibility: 1,
        vibration: true,
      });

      await PushNotifications.createChannel({
        id: "swapskill_general",
        name: "General Notifications",
        description: "Session requests, confirmations, and announcements",
        importance: 4,
        visibility: 1,
      });
    } catch (err) {
      console.warn("[PushNotification] createAndroidChannels error:", err);
    }
  }

  /**
   * Saves FCM device token to the user's Firestore document
   */
  private async saveTokenToFirestore(userId: string, token: string): Promise<void> {
    const cacheKey = `fcm_token_synced_${userId}_${token}`;
    if (safeLocalStorage.getItem(cacheKey) === "true") {
      return; // Token already synced
    }

    try {
      // 1. Secure isolation: Persist token to private subcollection accessible only to the owner
      const tokenDocRef = doc(db, "users", userId, "security", "tokens");
      await setDoc(tokenDocRef, {
        fcmTokens: arrayUnion(token),
        pushToken: token,
        pushPlatform: Capacitor.getPlatform(),
        lastPushTokenUpdate: serverTimestamp(),
      }, { merge: true }).catch(() => {});

      // 2. Backward compatibility: update root user doc
      const userDocRef = doc(db, "users", userId);
      await setDoc(userDocRef, {
        fcmTokens: arrayUnion(token),
        pushToken: token,
        pushPlatform: Capacitor.getPlatform(),
        lastPushTokenUpdate: serverTimestamp(),
      }, { merge: true });
      safeLocalStorage.setItem(cacheKey, "true");
      console.log("[PushNotification] Token saved to Firestore.");
    } catch (err) {
      console.warn("[PushNotification] Failed to save token to Firestore:", err);
    }
  }

  /**
   * Handles foreground push notifications (plays professional sounds and displays feedback)
   */
  private handleForegroundPush(notification: PushNotificationSchema): void {
    const data = notification.data || {};
    const type = data.type || "";

    if (type === "incoming_call" || data.callId) {
      startIncomingCallRingtone(`fcm_call_${data.callId || Date.now()}`);
    } else if (type === "message" || type === "chat" || data.chatId) {
      const incomingChatId = data.chatId || data.referenceId;
      const senderId = data.senderId;

      // Suppress notification if the chat is currently open and visible
      if (activeChatTrackingService.isChatCurrentlyOpenAndVisible(incomingChatId, senderId)) {
        console.log(`[PushNotification] Suppressed foreground chat alert because chat "${incomingChatId}" is open.`);
        return;
      }
      playNewChatMessage(`fcm_msg_${data.messageId || Date.now()}`);
    } else if (type === "reminder_10m" || data.sessionId) {
      playSessionReminder10Min(`fcm_rem10_${data.sessionId}`);
    } else if (type === "reminder_start") {
      playSessionStarting(`fcm_remstart_${data.sessionId}`);
    }
  }

  /**
   * Handles user tapping on a notification to deep-link directly into call/session/chat
   */
  private handlePushAction(action: ActionPerformed): void {
    const data = action.notification.data || {};
    const sessionId = data.sessionId;
    const callId = data.callId;
    const isCall = data.type === "incoming_call" || Boolean(callId);
    const isLive = data.isLive === "true" || data.isLive === true || isCall;
    const chatId = data.chatId || data.referenceId;

    if (isCall && callId) {
      if (action.actionId === "decline") {
        console.log("[PushNotification] Call declined via notification action:", callId);
        stopIncomingCallRingtone();
        callSignalingService.rejectCall(callId, "Call declined from notification", sessionId);
        return;
      }
      const isAutoAccept = action.actionId === "accept";
      mobileDeepLinkService.processDeepLinkUrl(
        `swapskill://call/${callId}?sessionId=${sessionId || ""}${isAutoAccept ? "&autoAccept=true" : ""}`
      );
    } else if (sessionId) {
      mobileDeepLinkService.processDeepLinkUrl(
        isLive ? `swapskill://live/${sessionId}` : `swapskill://session/${sessionId}`
      );
    } else if (chatId) {
      mobileDeepLinkService.processDeepLinkUrl(`swapskill://chat/${chatId}`);
    }
  }

  public getCurrentToken(): string | null {
    return this.currentToken;
  }

  /**
   * Remove token from Firestore and reset state on user sign-out
   */
  public async unregisterOrLogout(userId?: string): Promise<void> {
    const targetUserId = userId || this.currentUserId;
    const token = this.currentToken;

    if (targetUserId && token) {
      try {
        const userDocRef = doc(db, "users", targetUserId);
        await updateDoc(userDocRef, {
          fcmTokens: arrayRemove(token),
        }).catch(() => {});

        const tokenDocRef = doc(db, "users", targetUserId, "security", "tokens");
        await updateDoc(tokenDocRef, {
          fcmTokens: arrayRemove(token),
        }).catch(() => {});

        safeLocalStorage.removeItem(`fcm_token_synced_${targetUserId}_${token}`);
        console.log("[PushNotification] Removed FCM token from Firestore on logout.");
      } catch (err) {
        console.warn("[PushNotification] Error removing token on logout:", err);
      }
    }

    this.isInitialized = false;
    this.currentUserId = null;
  }
}

export const pushNotificationService = new PushNotificationService();
