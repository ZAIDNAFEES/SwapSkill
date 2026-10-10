// Cross-Platform Notification & Alarm Adapter Architecture
// Bridges Web Browser (Notifications API + Service Worker) and Native Mobile (Android / iOS / Capacitor / Native Bridges)
// Sharing identical scheduling and reminder business logic.

import { Session } from "../types";
import { 
  playNotificationSound, 
  playSessionReminder10Min, 
  playSessionStarting,
  startIncomingCallRingtone,
  stopIncomingCallRingtone,
  playSessionRequestReceived,
  playSessionAccepted,
  playNewChatMessage,
  playCallEnded
} from "../utils/sound";
import { triggerHapticFeedback, soundService } from "./soundFeedbackService";
import { safeLocalStorage } from "../utils/safeStorage";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";

export type PlatformType = "web" | "pwa" | "android-native" | "ios-native" | "capacitor";
export type NotificationPermissionState = "granted" | "denied" | "default";

export interface ScheduledAlarmNotification {
  sessionId: string;
  sessionHash: string; // Hash of session ID + scheduledTime + duration to detect rescheduling
  scheduledTimeMs: number;
  triggerTimeMs: number; // 10 minutes before start time or immediate if <10m
  title: string;
  body: string;
  partnerName: string;
  skillName: string;
  duration: number;
  formattedTime: string;
  isImmediateFallback?: boolean;
}

export interface GenericNotificationOptions {
  id?: string | number;
  title: string;
  body: string;
  channelId?: "swapskill_session_alarms" | "swapskill_calls" | "swapskill_messages" | "swapskill_general";
  tag?: string;
  extra?: any;
  actionTypeId?: string;
  actions?: Array<{ id: string; title: string; foreground?: boolean; destructive?: boolean }>;
}

export interface INotificationAdapter {
  platform: PlatformType;
  checkPermission(): Promise<NotificationPermissionState>;
  requestPermission(): Promise<boolean>;
  scheduleAlarm(alarm: ScheduledAlarmNotification, session: Session): Promise<boolean>;
  cancelAlarm(sessionId: string): Promise<boolean>;
  triggerImmediateNotification(alarm: ScheduledAlarmNotification, session: Session, isLive: boolean): Promise<void>;
  sendNotification(options: GenericNotificationOptions): Promise<void>;
}

// Convert string sessionId to stable 32-bit integer ID for native notification systems
export function getStableNotificationId(sessionId: string): number {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    const char = sessionId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

// Deduplication tracker for outgoing notifications to prevent double alerts
const sentNotificationsDedupe = new Map<string, number>();

function isNotificationDuplicate(key?: string): boolean {
  if (!key) return false;
  const now = Date.now();
  const lastTime = sentNotificationsDedupe.get(key);
  if (lastTime && now - lastTime < 5000) {
    return true;
  }
  sentNotificationsDedupe.set(key, now);

  if (sentNotificationsDedupe.size > 100) {
    sentNotificationsDedupe.forEach((time, k) => {
      if (now - time > 15000) sentNotificationsDedupe.delete(k);
    });
  }
  return false;
}

/**
 * 1. Capacitor Adapter (for modern Android & iOS Native Builds)
 */
export class CapacitorNotificationAdapter implements INotificationAdapter {
  platform: PlatformType = "capacitor";
  private channelCreated = false;

  isAvailable(): boolean {
    return Capacitor.isNativePlatform();
  }

  private async ensureChannelAndActionTypes() {
    if (this.channelCreated || !this.isAvailable()) return;
    try {
      if (Capacitor.getPlatform() === "android") {
        // Use native Android channels with system default sounds for 100% device compatibility
        await LocalNotifications.createChannel({
          id: "swapskill_session_alarms",
          name: "Session Reminders & Alarms",
          description: "High priority alarms for upcoming skill swap sessions",
          importance: 5, // IMPORTANCE_HIGH (heads-up display)
          visibility: 1, // VISIBILITY_PUBLIC
          vibration: true,
          lights: true,
          lightColor: "#C9A96E",
        });

        await LocalNotifications.createChannel({
          id: "swapskill_calls",
          name: "Live Swap Calls",
          description: "Incoming Live Swap video and audio calls",
          importance: 5, // Heads-up call alert
          visibility: 1,
          vibration: true,
          lights: true,
          lightColor: "#C9A96E",
        });

        await LocalNotifications.createChannel({
          id: "swapskill_messages",
          name: "Chat Messages",
          description: "Incoming chat messages from skill exchange partners",
          importance: 4, // IMPORTANCE_DEFAULT / HIGH
          visibility: 1,
          vibration: true,
          lights: true,
          lightColor: "#C9A96E",
        });

        await LocalNotifications.createChannel({
          id: "swapskill_general",
          name: "SwapSkill Notifications",
          description: "Session requests, confirmations, and updates",
          importance: 4,
          visibility: 1,
          vibration: true,
          lights: true,
          lightColor: "#C9A96E",
        });
      }

      await LocalNotifications.registerActionTypes({
        types: [
          {
            id: "SWAPSKILL_SESSION_REMINDER",
            actions: [
              {
                id: "join",
                title: "Join Session",
                foreground: true,
              },
              {
                id: "dismiss",
                title: "Dismiss",
                destructive: true,
              },
            ],
          },
          {
            id: "SWAPSKILL_CALL_INCOMING",
            actions: [
              {
                id: "accept",
                title: "Join Call",
                foreground: true,
              },
              {
                id: "decline",
                title: "Decline",
                destructive: true,
              },
            ],
          },
        ],
      });
      this.channelCreated = true;
    } catch (e) {
      console.warn("[CapacitorAdapter] ensureChannel error:", e);
    }
  }

  async checkPermission(): Promise<NotificationPermissionState> {
    if (!this.isAvailable()) return "default";
    try {
      const status = await LocalNotifications.checkPermissions();
      if (status.display === "granted") return "granted";
      if (status.display === "denied") return "denied";
      return "default";
    } catch {
      return "default";
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await LocalNotifications.requestPermissions();
      if (res.display === "granted") {
        await this.ensureChannelAndActionTypes();
        return true;
      }
      return false;
    } catch (e) {
      console.warn("[CapacitorAdapter] Permission request failed:", e);
      return false;
    }
  }

  async scheduleAlarm(alarm: ScheduledAlarmNotification, session: Session): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      // Respect user notification and session reminder preferences
      const prefs = soundService.getPreferences();
      if (!prefs.sessionReminderSounds && !prefs.notificationSounds) {
        console.log("[CapacitorAdapter] Session reminder sounds disabled by user preferences");
        return false;
      }

      await this.ensureChannelAndActionTypes();
      const baseId = getStableNotificationId(alarm.sessionId);
      const now = Date.now();
      const notificationsToSchedule: any[] = [];
      const scheduledIds: number[] = [];

      // 1. 10-minute prior reminder (if in future)
      if (alarm.triggerTimeMs > now + 2000) {
        const id10m = baseId;
        notificationsToSchedule.push({
          id: id10m,
          title: alarm.title,
          body: `Your ${alarm.skillName} Skill Swap with ${alarm.partnerName} starts in ${alarm.isImmediateFallback ? "< 10" : "10"} minutes.\n${alarm.formattedTime}`,
          schedule: { at: new Date(alarm.triggerTimeMs), allowWhileIdle: true },
          channelId: "swapskill_session_alarms",
          actionTypeId: "SWAPSKILL_SESSION_REMINDER",
          smallIcon: "ic_stat_swapskill",
          iconColor: "#C9A96E",
          extra: {
            sessionId: alarm.sessionId,
            sessionHash: alarm.sessionHash,
            isLive: false,
            type: "reminder_10m",
          },
        });
        scheduledIds.push(id10m);
      }

      // 2. Session start reminder (if in future)
      if (alarm.scheduledTimeMs > now + 2000) {
        const idStart = baseId + 1;
        notificationsToSchedule.push({
          id: idStart,
          title: "🔔 Live Session Starting Now!",
          body: `Your ${alarm.skillName} session with ${alarm.partnerName} is starting now. Tap to join.`,
          schedule: { at: new Date(alarm.scheduledTimeMs), allowWhileIdle: true },
          channelId: "swapskill_session_alarms",
          actionTypeId: "SWAPSKILL_SESSION_REMINDER",
          smallIcon: "ic_stat_swapskill",
          iconColor: "#C9A96E",
          extra: {
            sessionId: alarm.sessionId,
            sessionHash: alarm.sessionHash,
            isLive: true,
            type: "reminder_start",
          },
        });
        scheduledIds.push(idStart);
      }

      if (notificationsToSchedule.length > 0) {
        await LocalNotifications.schedule({ notifications: notificationsToSchedule });
        safeLocalStorage.setItem(
          `swap_scheduled_ids_${alarm.sessionId}`,
          JSON.stringify(scheduledIds)
        );
        console.log(
          `[CapacitorAdapter] Scheduled ${notificationsToSchedule.length} session alarms for ${alarm.sessionId}`
        );
      }

      return true;
    } catch (e) {
      console.warn("[CapacitorAdapter] Scheduling failed:", e);
      return false;
    }
  }

  async cancelAlarm(sessionId: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const baseId = getStableNotificationId(sessionId);
      const idsToCancel: number[] = [baseId, baseId + 1, baseId + 2];

      // Retrieve any persisted IDs for this session
      try {
        const stored = safeLocalStorage.getItem(`swap_scheduled_ids_${sessionId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            parsed.forEach((id: number) => {
              if (!idsToCancel.includes(id)) idsToCancel.push(id);
            });
          }
        }
      } catch (_) {}

      await LocalNotifications.cancel({
        notifications: idsToCancel.map((id) => ({ id })),
      });
      safeLocalStorage.removeItem(`swap_scheduled_ids_${sessionId}`);
      console.log(`[CapacitorAdapter] Cancelled alarms for session ${sessionId} (${idsToCancel.length} IDs)`);
      return true;
    } catch (e) {
      return false;
    }
  }

  async triggerImmediateNotification(alarm: ScheduledAlarmNotification, session: Session, isLive: boolean): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      const prefs = soundService.getPreferences();
      if (!prefs.sessionReminderSounds && !prefs.notificationSounds) return;

      await this.ensureChannelAndActionTypes();
      const notifId = getStableNotificationId(alarm.sessionId) + (isLive ? 2 : 1);
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title: isLive ? "🔔 Live Swap Session Now Active!" : alarm.title,
            body: isLive 
              ? `Your ${alarm.skillName} session with ${alarm.partnerName} is Live now. Tap to join.` 
              : `Your ${alarm.skillName} Skill Swap with ${alarm.partnerName} starts in 10 minutes.\n${alarm.formattedTime}`,
            schedule: { at: new Date(Date.now() + 200) },
            channelId: "swapskill_session_alarms",
            actionTypeId: "SWAPSKILL_SESSION_REMINDER",
            smallIcon: "ic_stat_swapskill",
            iconColor: "#C9A96E",
            extra: { sessionId: alarm.sessionId, isLive },
          },
        ],
      });
    } catch (e) {
      console.warn("[CapacitorAdapter] Immediate trigger failed:", e);
    }
  }

  async sendNotification(options: GenericNotificationOptions): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await this.ensureChannelAndActionTypes();
      const id = typeof options.id === "number" 
        ? options.id 
        : getStableNotificationId(String(options.id || options.tag || Date.now()));

      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: options.title,
            body: options.body,
            channelId: options.channelId || "swapskill_general",
            schedule: { at: new Date(Date.now() + 100) },
            smallIcon: "ic_stat_swapskill",
            iconColor: "#C9A96E",
            actionTypeId: options.actionTypeId,
            extra: options.extra,
          },
        ],
      });
    } catch (e) {
      console.warn("[CapacitorAdapter] sendNotification error:", e);
    }
  }
}

/**
 * 2. Native Mobile Bridge Adapter (Android / iOS WebView Bridges)
 */
export class NativeMobileBridgeAdapter implements INotificationAdapter {
  platform: PlatformType = "android-native";

  private get androidBridge() {
    if (typeof window !== "undefined") {
      return (window as any).AndroidNotificationBridge;
    }
    return null;
  }

  private get iosBridge() {
    if (typeof window !== "undefined") {
      return (window as any).webkit?.messageHandlers?.notificationBridge;
    }
    return null;
  }

  isAvailable(): boolean {
    return Boolean(this.androidBridge || this.iosBridge);
  }

  async checkPermission(): Promise<NotificationPermissionState> {
    if (this.androidBridge?.hasNotificationPermission) {
      try {
        const has = this.androidBridge.hasNotificationPermission();
        return has ? "granted" : "default";
      } catch {
        return "default";
      }
    }
    return "granted";
  }

  async requestPermission(): Promise<boolean> {
    if (this.androidBridge?.requestNotificationPermission) {
      try {
        return Boolean(this.androidBridge.requestNotificationPermission());
      } catch {
        return false;
      }
    }
    return true;
  }

  async scheduleAlarm(alarm: ScheduledAlarmNotification, session: Session): Promise<boolean> {
    const payload = JSON.stringify({
      sessionId: alarm.sessionId,
      sessionHash: alarm.sessionHash,
      isLive: Boolean(session.isLive),
    });

    if (this.androidBridge?.scheduleAlarm) {
      try {
        this.androidBridge.scheduleAlarm(
          alarm.sessionId,
          alarm.title,
          `Your ${alarm.skillName} Skill Swap with ${alarm.partnerName} starts in ${alarm.isImmediateFallback ? "< 10" : "10"} minutes.\n${alarm.formattedTime}`,
          alarm.triggerTimeMs,
          payload
        );
        return true;
      } catch (e) {
        console.warn("[NativeBridgeAdapter] Android schedule failed:", e);
      }
    }

    if (this.iosBridge?.postMessage) {
      try {
        this.iosBridge.postMessage({
          action: "scheduleAlarm",
          sessionId: alarm.sessionId,
          title: alarm.title,
          body: `Your ${alarm.skillName} Skill Swap with ${alarm.partnerName} starts in ${alarm.isImmediateFallback ? "< 10" : "10"} minutes.\n${alarm.formattedTime}`,
          triggerTimeMs: alarm.triggerTimeMs,
          payload,
        });
        return true;
      } catch (e) {
        console.warn("[NativeBridgeAdapter] iOS schedule failed:", e);
      }
    }

    return false;
  }

  async cancelAlarm(sessionId: string): Promise<boolean> {
    if (this.androidBridge?.cancelAlarm) {
      try {
        this.androidBridge.cancelAlarm(sessionId);
        return true;
      } catch {
        return false;
      }
    }
    if (this.iosBridge?.postMessage) {
      try {
        this.iosBridge.postMessage({ action: "cancelAlarm", sessionId });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async triggerImmediateNotification(alarm: ScheduledAlarmNotification, session: Session, isLive: boolean): Promise<void> {
    const body = isLive 
      ? `Your ${alarm.skillName} session with ${alarm.partnerName} is Live now. Tap to join.` 
      : `Your ${alarm.skillName} Skill Swap with ${alarm.partnerName} starts in 10 minutes.\n${alarm.formattedTime}`;

    if (this.androidBridge?.showAlarmNotification) {
      try {
        this.androidBridge.showAlarmNotification(
          alarm.sessionId,
          alarm.title,
          body,
          JSON.stringify({ sessionId: alarm.sessionId, isLive })
        );
      } catch (e) {
        console.warn("[NativeBridgeAdapter] Show notification failed:", e);
      }
    }
  }

  async sendNotification(options: GenericNotificationOptions): Promise<void> {
    if (this.androidBridge?.showAlarmNotification) {
      try {
        this.androidBridge.showAlarmNotification(
          String(options.id || Date.now()),
          options.title,
          options.body,
          JSON.stringify(options.extra || {})
        );
      } catch (_) {}
    } else if (this.iosBridge?.postMessage) {
      try {
        this.iosBridge.postMessage({
          action: "showNotification",
          id: String(options.id || Date.now()),
          title: options.title,
          body: options.body,
          extra: options.extra,
        });
      } catch (_) {}
    }
  }
}

/**
 * 3. Web Browser & PWA Adapter (ServiceWorker + Notification API + Web Audio)
 */
export class WebBrowserNotificationAdapter implements INotificationAdapter {
  platform: PlatformType = "web";

  async checkPermission(): Promise<NotificationPermissionState> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "denied";
    }
    return Notification.permission as NotificationPermissionState;
  }

  async requestPermission(): Promise<boolean> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return false;
    }
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;

    try {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    } catch (e) {
      console.warn("[WebBrowserAdapter] Permission request error:", e);
      return false;
    }
  }

  async scheduleAlarm(alarm: ScheduledAlarmNotification, session: Session): Promise<boolean> {
    // In Web/PWA, background alarms are managed via active client timers + Service Worker push fallback
    return true;
  }

  async cancelAlarm(sessionId: string): Promise<boolean> {
    return true;
  }

  async triggerImmediateNotification(alarm: ScheduledAlarmNotification, session: Session, isLive: boolean): Promise<void> {
    const title = isLive ? "🔔 SwapSkill: Session Live Now!" : alarm.title;
    const body = isLive
      ? `Your ${alarm.skillName} Skill Swap with ${alarm.partnerName} is live now. Click to join!`
      : `Your ${alarm.skillName} Skill Swap with ${alarm.partnerName} starts in ${alarm.isImmediateFallback ? "< 10" : "10"} minutes.\n${alarm.formattedTime}`;

    // 1. Try Service Worker with native action buttons
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) {
          await reg.showNotification(title, {
            body,
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            tag: `swap-alarm-${alarm.sessionId}-${isLive ? "live" : "10m"}`,
            renotify: true,
            requireInteraction: true,
            vibrate: [300, 100, 300, 100, 400],
            data: {
              sessionId: alarm.sessionId,
              session,
              isLive,
              url: window.location.origin,
            },
            actions: [
              {
                action: "join",
                title: "Join Session",
              },
              {
                action: "dismiss",
                title: "Dismiss",
              },
            ],
          } as any);
          return;
        }
      } catch (err) {
        console.warn("[WebBrowserAdapter] Service worker notification failed:", err);
      }
    }

    // 2. Fallback to standard Window Notification API
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        const notif = new Notification(title, {
          body,
          icon: "/favicon.ico",
          tag: `swap-alarm-${alarm.sessionId}-${isLive ? "live" : "10m"}`,
          requireInteraction: true,
        });

        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch (err) {
        console.warn("[WebBrowserAdapter] Window notification failed:", err);
      }
    }
  }

  async sendNotification(options: GenericNotificationOptions): Promise<void> {
    const tag = options.tag || (options.id ? `swap-${options.id}` : undefined);

    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) {
          await reg.showNotification(options.title, {
            body: options.body,
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            tag,
            renotify: true,
            data: options.extra,
            actions: options.actions?.map(a => ({ action: a.id, title: a.title })),
          } as any);
          return;
        }
      } catch (_) {}
    }

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        const notif = new Notification(options.title, {
          body: options.body,
          icon: "/favicon.ico",
          tag,
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch (_) {}
    }
  }
}

/**
 * 4. Composite Platform Orchestrator (Single shared interface for the entire app)
 */
export class CompositeCrossPlatformNotificationManager {
  private capacitorAdapter = new CapacitorNotificationAdapter();
  private nativeBridgeAdapter = new NativeMobileBridgeAdapter();
  private webBrowserAdapter = new WebBrowserNotificationAdapter();

  /**
   * Detect runtime platform and return best available adapter
   */
  public getActiveAdapter(): INotificationAdapter {
    if (this.capacitorAdapter.isAvailable()) {
      return this.capacitorAdapter;
    }
    if (this.nativeBridgeAdapter.isAvailable()) {
      return this.nativeBridgeAdapter;
    }
    return this.webBrowserAdapter;
  }

  public async checkPermission(): Promise<NotificationPermissionState> {
    return this.getActiveAdapter().checkPermission();
  }

  public async requestPermission(): Promise<boolean> {
    return this.getActiveAdapter().requestPermission();
  }

  public async scheduleAlarm(alarm: ScheduledAlarmNotification, session: Session): Promise<boolean> {
    if (this.capacitorAdapter.isAvailable()) {
      await this.capacitorAdapter.scheduleAlarm(alarm, session);
    }
    if (this.nativeBridgeAdapter.isAvailable()) {
      await this.nativeBridgeAdapter.scheduleAlarm(alarm, session);
    }
    return this.webBrowserAdapter.scheduleAlarm(alarm, session);
  }

  public async cancelAlarm(sessionId: string): Promise<boolean> {
    if (this.capacitorAdapter.isAvailable()) {
      await this.capacitorAdapter.cancelAlarm(sessionId);
    }
    if (this.nativeBridgeAdapter.isAvailable()) {
      await this.nativeBridgeAdapter.cancelAlarm(sessionId);
    }
    return this.webBrowserAdapter.cancelAlarm(sessionId);
  }

  public async triggerImmediateNotification(
    alarm: ScheduledAlarmNotification,
    session: Session,
    isLive: boolean
  ): Promise<void> {
    // 1. Play dedicated reminder tone based on session status
    try {
      if (isLive) {
        playSessionStarting(`alarm-start-${alarm.sessionId}`);
      } else {
        playSessionReminder10Min(`alarm-10m-${alarm.sessionId}`);
      }
    } catch {}

    // 2. Vibrate device if supported
    triggerHapticFeedback("pattern", isLive ? [80, 50, 80] : [60, 40, 60]);

    // 3. Dispatch native or browser notification
    const adapter = this.getActiveAdapter();
    await adapter.triggerImmediateNotification(alarm, session, isLive);
  }

  /**
   * Universal notification dispatcher with deduplication and channel routing
   */
  public async sendNotification(options: GenericNotificationOptions): Promise<void> {
    const dedupeKey = options.tag || (options.id ? String(options.id) : undefined);
    if (isNotificationDuplicate(dedupeKey)) return;

    const adapter = this.getActiveAdapter();
    await adapter.sendNotification(options);
  }

  // --- Dedicated High-Level Notification Helpers ---

  /**
   * 1. 10-Minute Prior Session Reminder
   */
  public async notifySessionReminder10Min(params: {
    sessionId: string;
    partnerName: string;
    skillName: string;
    formattedTime: string;
  }): Promise<void> {
    playSessionReminder10Min(`reminder_10m_${params.sessionId}`);
    triggerHapticFeedback("pattern", [60, 40, 60]);

    await this.sendNotification({
      id: `reminder_10m_${params.sessionId}`,
      tag: `swap-reminder-10m-${params.sessionId}`,
      title: "SwapSkill Session in 10 Minutes",
      body: `Your ${params.skillName} Skill Swap with ${params.partnerName} starts in 10 minutes.\n${params.formattedTime}`,
      channelId: "swapskill_session_alarms",
      extra: { sessionId: params.sessionId, type: "reminder_10m" },
    });
  }

  /**
   * 2. Session Starting Reminder (0 minutes / Live now)
   */
  public async notifySessionStarting(params: {
    sessionId: string;
    partnerName: string;
    skillName: string;
  }): Promise<void> {
    playSessionStarting(`reminder_start_${params.sessionId}`);
    triggerHapticFeedback("pattern", [80, 50, 80]);

    await this.sendNotification({
      id: `reminder_start_${params.sessionId}`,
      tag: `swap-reminder-start-${params.sessionId}`,
      title: "🔔 SwapSkill: Session Starting Now!",
      body: `Your ${params.skillName} session with ${params.partnerName} has started. Tap to join!`,
      channelId: "swapskill_session_alarms",
      extra: { sessionId: params.sessionId, isLive: true },
    });
  }

  /**
   * 3. Incoming Live Swap / Call Notification
   */
  public async notifyIncomingCall(params: {
    callId: string;
    callerName: string;
    skillName: string;
    callType?: string;
  }): Promise<void> {
    startIncomingCallRingtone(`call_${params.callId}`);

    await this.sendNotification({
      id: `call_${params.callId}`,
      tag: `swap-call-${params.callId}`,
      title: "Incoming Live Swap Call",
      body: `${params.callerName} is calling for ${params.skillName} (${params.callType || "Video"} Call)`,
      channelId: "swapskill_calls",
      actionTypeId: "SWAPSKILL_CALL_INCOMING",
      extra: { callId: params.callId, type: "call" },
    });
  }

  /**
   * 4. Session Request Received
   */
  public async notifySessionRequestReceived(params: {
    sessionId: string;
    partnerName: string;
    skillName: string;
  }): Promise<void> {
    playSessionRequestReceived(`session_req_${params.sessionId}`);
    triggerHapticFeedback("light");

    await this.sendNotification({
      id: `session_req_${params.sessionId}`,
      tag: `swap-req-${params.sessionId}`,
      title: "New Session Request",
      body: `${params.partnerName} requested a ${params.skillName} Skill Swap with you!`,
      channelId: "swapskill_general",
      extra: { sessionId: params.sessionId, type: "request" },
    });
  }

  /**
   * 5. Session Request Accepted
   */
  public async notifySessionAccepted(params: {
    sessionId: string;
    partnerName: string;
    skillName: string;
  }): Promise<void> {
    playSessionAccepted(`session_acc_${params.sessionId}`);
    triggerHapticFeedback("success");

    await this.sendNotification({
      id: `session_acc_${params.sessionId}`,
      tag: `swap-acc-${params.sessionId}`,
      title: "Session Confirmed!",
      body: `${params.partnerName} accepted your ${params.skillName} Skill Swap request!`,
      channelId: "swapskill_general",
      extra: { sessionId: params.sessionId, type: "accepted" },
    });
  }

  /**
   * 6. New Chat Message
   */
  public async notifyNewChatMessage(params: {
    chatId: string;
    senderName: string;
    messageText: string;
    messageId?: string;
  }): Promise<void> {
    const dedupeKey = params.messageId ? `msg_${params.messageId}` : `chat_${params.chatId}`;
    playNewChatMessage(dedupeKey);
    triggerHapticFeedback("light");

    await this.sendNotification({
      id: dedupeKey,
      tag: `swap-chat-${params.chatId}`,
      title: params.senderName,
      body: params.messageText,
      channelId: "swapskill_messages",
      extra: { chatId: params.chatId, messageId: params.messageId },
    });
  }

  /**
   * 7. Call Ended Tone & Notification Cleanup
   */
  public notifyCallEnded(params?: { partnerName?: string; callId?: string }): void {
    stopIncomingCallRingtone();
    playCallEnded(params?.callId ? `call_ended_${params.callId}` : undefined);
    triggerHapticFeedback("pattern", [50, 40, 30]);
  }
}

// Global Singleton Instance
export const crossPlatformNotificationManager = new CompositeCrossPlatformNotificationManager();

