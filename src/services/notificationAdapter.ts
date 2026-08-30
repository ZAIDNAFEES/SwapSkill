// Cross-Platform Notification & Alarm Adapter Architecture
// Bridges Web Browser (Notifications API + Service Worker) and Native Mobile (Android / iOS / Capacitor / Native Bridges)
// Sharing identical scheduling and reminder business logic.

import { Session } from "../types";
import { playNotificationSound } from "../utils/sound";
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

export interface INotificationAdapter {
  platform: PlatformType;
  checkPermission(): Promise<NotificationPermissionState>;
  requestPermission(): Promise<boolean>;
  scheduleAlarm(alarm: ScheduledAlarmNotification, session: Session): Promise<boolean>;
  cancelAlarm(sessionId: string): Promise<boolean>;
  triggerImmediateNotification(alarm: ScheduledAlarmNotification, session: Session, isLive: boolean): Promise<void>;
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
        await LocalNotifications.createChannel({
          id: "swapskill_session_alarms",
          name: "Session Reminders & Alarms",
          description: "High priority alarms for upcoming skill swap sessions",
          importance: 5, // IMPORTANCE_HIGH
          visibility: 1, // VISIBILITY_PUBLIC
          sound: "alarm.wav",
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
      await this.ensureChannelAndActionTypes();
      const targetDate = new Date(Math.max(Date.now() + 1000, alarm.triggerTimeMs));
      const notifId = getStableNotificationId(alarm.sessionId);

      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title: alarm.title,
            body: `Your ${alarm.skillName} Skill Swap with ${alarm.partnerName} starts in ${alarm.isImmediateFallback ? "< 10" : "10"} minutes.\n${alarm.formattedTime}`,
            schedule: { at: targetDate, allowWhileIdle: true },
            sound: "alarm.wav",
            channelId: "swapskill_session_alarms",
            actionTypeId: "SWAPSKILL_SESSION_REMINDER",
            smallIcon: "ic_stat_swapskill",
            iconColor: "#C9A96E",
            extra: {
              sessionId: alarm.sessionId,
              sessionHash: alarm.sessionHash,
              isLive: Boolean(session.isLive),
            },
          },
        ],
      });
      return true;
    } catch (e) {
      console.warn("[CapacitorAdapter] Scheduling failed:", e);
      return false;
    }
  }

  async cancelAlarm(sessionId: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const notifId = getStableNotificationId(sessionId);
      await LocalNotifications.cancel({ notifications: [{ id: notifId }] });
      return true;
    } catch (e) {
      return false;
    }
  }

  async triggerImmediateNotification(alarm: ScheduledAlarmNotification, session: Session, isLive: boolean): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await this.ensureChannelAndActionTypes();
      const notifId = getStableNotificationId(alarm.sessionId) + 1; // offset for immediate
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
            sound: "alarm.wav",
            actionTypeId: "SWAPSKILL_SESSION_REMINDER",
            extra: { sessionId: alarm.sessionId, isLive },
          },
        ],
      });
    } catch (e) {
      console.warn("[CapacitorAdapter] Immediate trigger failed:", e);
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
            tag: `swap-alarm-${alarm.sessionId}`,
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
          tag: `swap-alarm-${alarm.sessionId}`,
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
    // Schedule across mobile bridge if present
    if (this.capacitorAdapter.isAvailable()) {
      await this.capacitorAdapter.scheduleAlarm(alarm, session);
    }
    if (this.nativeBridgeAdapter.isAvailable()) {
      await this.nativeBridgeAdapter.scheduleAlarm(alarm, session);
    }
    // Also support web
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
    // Play dual alarm sound
    try {
      playNotificationSound();
      setTimeout(() => playNotificationSound(), 250);
    } catch {}

    // Vibrate device if supported
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([300, 100, 300, 100, 400]);
      } catch {}
    }

    const adapter = this.getActiveAdapter();
    await adapter.triggerImmediateNotification(alarm, session, isLive);
  }
}

// Global Singleton Instance
export const crossPlatformNotificationManager = new CompositeCrossPlatformNotificationManager();
