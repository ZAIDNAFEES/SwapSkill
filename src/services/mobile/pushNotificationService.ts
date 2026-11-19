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
import { app, auth, db } from "../../firebase";
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
import { mobileForegroundService, PendingChatPush } from "./foregroundService";
import { mobileLifecycleService } from "./lifecycle";
import { activeChatTrackingService } from "../activeChatTrackingService";
import { callSignalingService } from "../callSignalingService";
import { getApiBaseUrl, getApiUrl } from "../../utils/apiConfig";
import { getMutedChatIds, isChatMuted } from "../../utils/mutedChats";

export class PushNotificationService {
  private isInitialized = false;
  private currentUserId: string | null = null;
  private currentToken: string | null = null;
  private webMessagingInstance: any = null;
  private webSyncInFlight = false;
  private swMessageListenerAttached = false;
  private visibilityListenerAttached = false;
  private lifecycleDrainUnsub: (() => void) | null = null;
  private drainInFlight = false;

  public isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Drains buffered chat push payloads from native Android preferences, Capacitor delivered tray notifications,
   * and Web Service Worker CacheStorage so launcher-icon opens hydrate latest messages at 0ms with 0 extra reads.
   */
  public async drainPendingChatPushes(): Promise<void> {
    if (typeof window === "undefined" || this.drainInFlight) return;
    this.drainInFlight = true;
    try {
      const collected: PendingChatPush[] = [];

      if (this.isNative()) {
        try {
          const nativePushes = await mobileForegroundService.consumePendingChatPushes();
          if (Array.isArray(nativePushes) && nativePushes.length > 0) {
            collected.push(...nativePushes);
          }
        } catch (_) {}

        try {
          const delivered = await PushNotifications.getDeliveredNotifications();
          const list = delivered?.notifications || [];
          for (const item of list) {
            const d: any = item?.data || {};
            const cId = d.chatId || d.referenceId;
            if (!cId) continue;
            const dType = String(d.type || "").toLowerCase();
            if (dType && dType !== "chat" && dType !== "message" && dType !== "message_request") continue;
            collected.push({
              chatId: cId,
              senderId: d.senderId || "",
              senderName: d.senderName || d.title || item.title || "",
              senderPhoto: d.senderPhoto || d.icon || "",
              message: d.body || d.message || item.body || "",
              fullMessage: d.fullMessage || d.body || d.message || item.body || "",
              messageId: d.messageId || "",
              createdAtMs: d.createdAtMs ? Number(d.createdAtMs) : Date.now(),
            });
          }
        } catch (_) {}
      } else if ("caches" in window) {
        try {
          const cache = await caches.open("swap-push-bridge-v1");
          const res = await cache.match("/swap-pending-chat-pushes");
          if (res) {
            const parsed = await res.json().catch(() => null);
            await cache.delete("/swap-pending-chat-pushes").catch(() => {});
            if (Array.isArray(parsed) && parsed.length > 0) {
              collected.push(...parsed);
            }
          }
        } catch (_) {}
      }

      if (collected.length > 0) {
        collected.sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
        for (const p of collected) {
          if (!p?.chatId) continue;
          const msgBody = p.fullMessage || p.message || "";
          if (!msgBody) continue;
          const ts = Number(p.createdAtMs);
          window.dispatchEvent(
            new CustomEvent("swapskill_sync_message_from_push", {
              detail: {
                chatId: p.chatId,
                senderId: p.senderId || "",
                senderName: p.senderName || "New Message",
                senderPhoto: p.senderPhoto || "",
                message: p.message || msgBody,
                fullMessage: p.fullMessage || msgBody,
                messageId: p.messageId || "",
                createdAtMs: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
              },
            })
          );
        }
      }
    } finally {
      this.drainInFlight = false;
    }
  }

  /**
   * Safe cross-browser Notification.requestPermission wrapper (supports Promise & legacy callback APIs)
   */
  private async requestWebNotificationPermissionSafe(): Promise<NotificationPermission> {
    if (typeof window === "undefined" || !("Notification" in window)) return "denied";
    try {
      if (Notification.permission === "granted" || Notification.permission === "denied") {
        return Notification.permission;
      }
      let cbResult: NotificationPermission | null = null;
      const maybePromise = (Notification as any).requestPermission((perm: NotificationPermission) => {
        cbResult = perm;
      });
      if (maybePromise && typeof maybePromise.then === "function") {
        return await maybePromise;
      }
      return cbResult || Notification.permission;
    } catch {
      return typeof Notification !== "undefined" ? Notification.permission : "denied";
    }
  }

  /**
   * Initializes Push Notifications for the authenticated user
   */
  public async init(userId: string): Promise<void> {
    if (!userId || typeof window === "undefined") return;
    const userChanged = this.currentUserId !== userId;
    this.currentUserId = userId;

    if (!this.lifecycleDrainUnsub) {
      this.lifecycleDrainUnsub = mobileLifecycleService.addAppStateListener((isActive) => {
        if (isActive && this.currentUserId) {
          void this.drainPendingChatPushes();
        }
      });
    }

    if (this.isNative()) {
      void mobileForegroundService.syncMutedChats(getMutedChatIds());
    }

    // Drain any buffered pushes on init/re-init immediately
    void this.drainPendingChatPushes();

    if (this.isInitialized && !userChanged) {
      if (this.currentToken) {
        const syncedKey = `fcm_token_synced_${userId}_${this.currentToken}`;
        if (!safeLocalStorage.getItem(syncedKey)) {
          await this.saveTokenToFirestore(userId, this.currentToken);
        }
      } else if (!this.isNative() && "Notification" in window && Notification.permission === "granted") {
        await this.syncWebFcmToken(userId);
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

  public getCurrentUserId(): string | null {
    return this.currentUserId || auth.currentUser?.uid || null;
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

      // 2. Attach listeners BEFORE registering (prevents race condition on Android cold-start)
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

      // 3. Cache userId into native SharedPreferences and sync existing native FCM token if present
      if (Capacitor.getPlatform() === "android") {
        const idToken = await auth.currentUser?.getIdToken().catch(() => undefined);
        const backendUrl = getApiBaseUrl() || (typeof window !== "undefined" && !window.location.hostname.includes("localhost") ? window.location.origin : "");
        const displayName = auth.currentUser?.displayName || undefined;
        await mobileForegroundService.setPushUserId(userId, backendUrl, idToken, displayName);

        // Keep ID token & displayName updated across token renewals
        auth.onIdTokenChanged(async (user) => {
          if (user && Capacitor.getPlatform() === "android") {
            try {
              const freshToken = await user.getIdToken();
              await mobileForegroundService.setPushUserId(user.uid, backendUrl, freshToken, user.displayName || undefined);
            } catch (err) {
              console.warn("[PushNotification] Failed to sync refreshed ID token:", err);
            }
          }
        });

        const nativeToken = await mobileForegroundService.getNativeFcmToken();
        if (nativeToken && nativeToken !== this.currentToken) {
          console.log("[PushNotification] Retrieved existing native FCM token:", nativeToken);
          this.currentToken = nativeToken;
          await this.saveTokenToFirestore(userId, nativeToken);
        } else if (!nativeToken) {
          // Retry once after Play Services finishes cold-booting on slower older Android phones
          setTimeout(() => {
            if (!this.currentToken && this.currentUserId === userId) {
              mobileForegroundService.getNativeFcmToken().then((delayedToken) => {
                if (delayedToken && !this.currentToken && this.currentUserId === userId) {
                  this.currentToken = delayedToken;
                  this.saveTokenToFirestore(userId, delayedToken).catch(() => {});
                }
              }).catch(() => {});
            }
          }, 3000);
        }

        // Listen for native call acceptance when user clicks Answer on the notification action button
        mobileForegroundService.onCallAcceptedNatively((callData) => {
          console.log("[PushNotification] onCallAcceptedNatively triggered in JS:", callData);
          if (callData && callData.callId) {
            const deepLinkUrl = `swapskill://call/${callData.callId}?sessionId=${callData.sessionId || ""}&autoAccept=true&alreadyAccepted=true&callerId=${encodeURIComponent(callData.callerId || "")}&callerName=${encodeURIComponent(callData.callerName || "")}&callerPhoto=${encodeURIComponent(callData.callerPhoto || "")}&callType=${encodeURIComponent(callData.callType || "")}&skillName=${encodeURIComponent(callData.skillName || "")}&conversationId=${encodeURIComponent(callData.conversationId || "")}`;
            mobileDeepLinkService.processDeepLinkUrl(deepLinkUrl);
          }
        });

        // Listen for native notification inline replies for instant local chat UI updates
        mobileForegroundService.onMessageRepliedNatively((replyData) => {
          console.log("[PushNotification] onMessageRepliedNatively triggered in JS:", replyData);
        });
      }

      // 4. Request notification display permissions (Android 13+ & iOS) before registration
      try {
        const permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === "granted") {
          safeLocalStorage.setItem("swap_push_notifications_enabled", "true");
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("swap_push_status_changed", { detail: { enabled: true } }));
          }
        } else {
          const req = await PushNotifications.requestPermissions();
          if (req.receive === "granted") {
            safeLocalStorage.setItem("swap_push_notifications_enabled", "true");
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("swap_push_status_changed", { detail: { enabled: true } }));
            }
          }
        }
      } catch (permErr) {
        console.warn("[PushNotification] Permission check/request error:", permErr);
      }

      // 5. Register with Google FCM / Apple APNs to obtain device token
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
      // Always register /sw.js early with updateViaCache: "none" so old phones flush stale cached workers
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          reg.update().catch(() => {});
        })
        .catch(() => {});

      if (!this.swMessageListenerAttached) {
        this.swMessageListenerAttached = true;
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
          } else if (msg.type === "CHAT_PUSH_RECEIVED" && msg.push?.chatId) {
            const p = msg.push;
            window.dispatchEvent(
              new CustomEvent("swapskill_sync_message_from_push", {
                detail: {
                  chatId: p.chatId,
                  senderId: p.senderId || "",
                  senderName: p.senderName || "New Message",
                  senderPhoto: p.senderPhoto || "",
                  message: p.message || p.fullMessage || "",
                  fullMessage: p.fullMessage || p.message || "",
                  messageId: p.messageId || "",
                  createdAtMs: Number(p.createdAtMs) || Date.now(),
                },
              })
            );
          } else if (msg.type === "CALL_CANCELLED_PUSH" && msg.callId) {
            callSignalingService.markCallTerminated(msg.callId);
            stopIncomingCallRingtone();
            window.dispatchEvent(
              new CustomEvent("swapskill_call_cancelled_notif", { detail: { callId: msg.callId } })
            );
          }
        });
      }
    }

    // Retry Web FCM token sync if permission was granted later or on tab focus when no token yet (0 Firestore reads)
    if (!this.visibilityListenerAttached) {
      this.visibilityListenerAttached = true;
      document.addEventListener("visibilitychange", () => {
        if (
          document.visibilityState === "visible" &&
          !this.currentToken &&
          this.currentUserId &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          this.syncWebFcmToken(this.currentUserId).catch(() => {});
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

      // Only sync automatically if permission is ALREADY granted.
      // When permission is "default", let NotificationPermissionExplainModal prompt cleanly on user tap
      // (older & newer Android Chrome/MIUI/Samsung browsers block non-gesture permission prompts).
      if ("Notification" in window && Notification.permission === "granted") {
        await this.syncWebFcmToken(userId);
        safeLocalStorage.setItem("swap_push_notifications_enabled", "true");
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("swap_push_status_changed", { detail: { enabled: true } }));
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
    if (this.webSyncInFlight) return this.currentToken;

    this.webSyncInFlight = true;
    try {
      if (!this.webMessagingInstance) {
        const supported = await isSupported();
        if (!supported) return null;
        this.webMessagingInstance = getMessaging(app);
      }

      const swReg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      swReg.update().catch(() => {});
      if (!swReg.active) {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      }

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
    } finally {
      this.webSyncInFlight = false;
    }
    return null;
  }

  /**
   * Request user permission and register device for Push Notifications
   */
  public async requestPermissionAndRegister(userId?: string): Promise<boolean> {
    const targetUserId = userId || this.currentUserId || auth.currentUser?.uid;
    if (!targetUserId || typeof window === "undefined") return false;

    if (this.isNative()) {
      try {
        const req = await PushNotifications.requestPermissions();
        if (req.receive === "granted") {
          await PushNotifications.register();
          safeLocalStorage.setItem("swap_push_notifications_enabled", "true");
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("swap_push_status_changed", { detail: { enabled: true } }));
          }
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
        const permission = await this.requestWebNotificationPermissionSafe();
        if (permission === "granted") {
          await this.syncWebFcmToken(targetUserId);
          safeLocalStorage.setItem("swap_push_notifications_enabled", "true");
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("swap_push_status_changed", { detail: { enabled: true } }));
          }
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
    const channels = [
      {
        id: "swapskill_calls",
        name: "Live Swap Calls",
        description: "Incoming audio and video Live Swap calls",
        importance: 5 as const,
        visibility: 1 as const,
        vibration: true,
        lights: true,
        lightColor: "#C9A96E",
      },
      {
        id: "swapskill_session_alarms",
        name: "Session Reminders & Alarms",
        description: "10-minute and session start notifications",
        importance: 5 as const,
        visibility: 1 as const,
        vibration: true,
        lights: true,
        lightColor: "#C9A96E",
      },
      {
        id: "swapskill_messages",
        name: "Chat Messages",
        description: "New direct messages from partners",
        importance: 4 as const,
        visibility: 1 as const,
        vibration: true,
      },
      {
        id: "swapskill_general",
        name: "General Notifications",
        description: "Session requests, confirmations, and announcements",
        importance: 4 as const,
        visibility: 1 as const,
      },
    ];
    for (const ch of channels) {
      try {
        await PushNotifications.createChannel(ch);
      } catch (err) {
        console.warn("[PushNotification] createAndroidChannels error for", ch.id, err);
      }
    }
  }

  /**
   * Saves FCM device token to the user's Firestore document
   */
  private async saveTokenToFirestore(userId: string, token: string): Promise<void> {
    if (!userId || !token) return;

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
      safeLocalStorage.setItem(`fcm_token_synced_${userId}_${token}`, "true");
      console.log("[PushNotification] Token successfully synced to Firestore for user:", userId);

      // 3. Redundant sync to serverless endpoint ensuring backend has token
      const idToken = await auth.currentUser?.getIdToken().catch(() => undefined);
      if (idToken) {
        fetch(getApiUrl("/api/notifications/sync-token"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ userId, token, platform: Capacitor.getPlatform() }),
        }).catch(() => {});
      }
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

    if (type === "incoming_call") {
      const callId = data.callId;
      const activeUid = this.currentUserId || auth.currentUser?.uid || "";
      const notifTs = data.timestamp ? Number(data.timestamp) : 0;

      if (!activeUid) {
        console.log("[PushNotification] Suppressing incoming call push: no active authenticated user.");
        return;
      }
      if (data.receiverId && data.receiverId !== activeUid) {
        console.log("[PushNotification] Suppressing incoming call push belonging to another account:", callId);
        return;
      }
      if (data.callerId && data.callerId === activeUid) {
        console.log("[PushNotification] Suppressing incoming call push where current user is caller:", callId);
        return;
      }
      if (notifTs > 0 && Date.now() - notifTs > 45000) {
        console.log("[PushNotification] Suppressing expired incoming call push:", callId);
        return;
      }
      if (
        callId &&
        (callSignalingService.isCallAccepted(callId) ||
          callSignalingService.isCallTerminated(callId) ||
          callSignalingService.isUserInCall())
      ) {
        console.log("[PushNotification] Suppressing foreground incoming call push - call already accepted or active:", callId);
        return;
      }
      console.log(`[TIMING] FCM_RECEIVED: callId=${data.callId} t=${Date.now()}`);
      console.log("[PushNotification] Incoming call received in foreground:", data.callId);
      startIncomingCallRingtone(`fcm_call_${data.callId || Date.now()}`);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("swapskill_incoming_call_notif", {
            detail: {
              ...data,
              callId: data.callId,
              sessionId: data.sessionId || "",
              callerId: data.callerId || "",
              receiverId: data.receiverId || "",
              callerName: data.callerName || data.title || "Partner",
              callerPhoto: data.callerPhoto || "",
              callType: data.callType || "video",
              skillName: data.skillName || "",
              timestamp: data.timestamp || String(Date.now()),
            },
          })
        );
      }
    } else if (type === "call_cancelled" || type === "call_ended" || type === "call_rejected" || type === "call_missed") {
      console.log("[PushNotification] Remote call cancelled/ended received in foreground:", data.callId);
      if (data.callId) {
        callSignalingService.markCallTerminated(data.callId, data.sessionId || undefined);
      }
      stopIncomingCallRingtone();
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("swapskill_call_cancelled_notif", {
            detail: { callId: data.callId },
          })
        );
      }
    } else if (type === "message" || type === "chat" || data.chatId) {
      const incomingChatId = data.chatId || data.referenceId;
      const senderId = data.senderId || "";
      const messageText = data.body || data.message || notification.body || "";
      const senderName = data.senderName || data.title || notification.title || "New Message";
      const createdAtMs = data.createdAtMs ? Number(data.createdAtMs) : Date.now();

      // Always hydrate chats & message cache immediately at 0ms (even if chat is currently open)
      if (typeof window !== "undefined" && incomingChatId) {
        window.dispatchEvent(
          new CustomEvent("swapskill_sync_message_from_push", {
            detail: {
              chatId: incomingChatId,
              senderId,
              message: messageText,
              senderName,
              senderPhoto: data.senderPhoto || data.icon || "",
              messageId: data.messageId || "",
              createdAtMs: Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : Date.now(),
            },
          })
        );
      }

      // Suppress notification sound and banner if the chat is currently open and visible OR muted
      if (activeChatTrackingService.isChatCurrentlyOpenAndVisible(incomingChatId, senderId) || isChatMuted(incomingChatId)) {
        console.log(`[PushNotification] Suppressed foreground chat alert because chat "${incomingChatId}" is open or muted.`);
        return;
      }
      // When native Android app is backgrounded, SwapSkillMessagingService already posted MessagingStyle + sound
      if (
        this.isNative() &&
        Capacitor.getPlatform() === "android" &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      playNewChatMessage(`fcm_msg_${data.messageId || Date.now()}`);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("swapskill_new_message_notif", {
            detail: {
              chatId: incomingChatId,
              senderId,
              message: messageText,
              fullMessage: data.fullMessage || messageText,
              senderName,
              senderPhoto: data.senderPhoto || data.icon || "",
              messageId: data.messageId || "",
              createdAtMs: Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : Date.now(),
            },
          })
        );
      }
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
      if (typeof window !== "undefined") {
        const createdAtMs = data.createdAtMs ? Number(data.createdAtMs) : Date.now();
        window.dispatchEvent(
          new CustomEvent("swapskill_sync_message_from_push", {
            detail: {
              chatId,
              senderId: data.senderId || "",
              message: data.body || data.message || action.notification.body || "",
              senderName: data.senderName || data.title || action.notification.title || "New Message",
              senderPhoto: data.senderPhoto || data.icon || "",
              messageId: data.messageId || "",
              createdAtMs: Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : Date.now(),
            },
          })
        );
      }
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
