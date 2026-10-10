import { Capacitor, registerPlugin } from "@capacitor/core";

export type CallLifecycleState =
  | "ACTIVE_CALL_UI_VISIBLE"
  | "ACTIVE_CALL_MINIMIZED"
  | "APP_BACKGROUND"
  | "SCREEN_LOCKED"
  | "CALL_ENDED";

export interface PendingAcceptedCall {
  hasPendingCall: boolean;
  callId?: string;
  sessionId?: string;
  callerId?: string;
  callerName?: string;
  callerPhoto?: string;
  callType?: "video" | "audio";
  skillName?: string;
  conversationId?: string;
  alreadyAccepted?: boolean;
}

export interface CallPermissionsStatus {
  notificationsGranted: boolean;
  canUseFullScreenIntent: boolean;
  ignoringBatteryOptimizations: boolean;
  notificationsEnabled: boolean;
}

export interface CallForegroundPluginInterface {
  startCallForeground(options: {
    partnerName: string;
    callType: "video" | "audio";
    sessionId?: string;
    callId?: string;
  }): Promise<{ started: boolean }>;
  stopCallForeground(): Promise<{ stopped: boolean }>;
  getPendingAcceptedCall?(): Promise<PendingAcceptedCall>;
  clearPendingAcceptedCall?(): Promise<{ cleared: boolean }>;
  getFcmToken?(): Promise<{ token: string | null; platform: string }>;
  setPushUserId?(options: { userId: string; backendUrl?: string; idToken?: string }): Promise<{ success: boolean }>;
  checkCallPermissions?(): Promise<CallPermissionsStatus>;
  requestIgnoreBatteryOptimizations?(): Promise<{ success: boolean }>;
  openFullScreenIntentSettings?(): Promise<{ success: boolean }>;
  isPipSupported?(): Promise<{ supported: boolean }>;
  enterPip?(): Promise<{ success: boolean }>;
  addListener(eventName: "callEndedByNotification", listenerFunc: (data: any) => void): Promise<any>;
  addListener(eventName: "callAcceptedNatively", listenerFunc: (data: PendingAcceptedCall) => void): Promise<any>;
  addListener(eventName: "pipModeChanged", listenerFunc: (data: { inPip: boolean }) => void): Promise<any>;
  addListener(eventName: "screenLockStateChanged", listenerFunc: (data: { screenLocked: boolean }) => void): Promise<any>;
}

const CallForegroundPlugin = registerPlugin<CallForegroundPluginInterface>("CallForegroundPlugin");

class MobileForegroundService {
  private isRunning = false;
  private currentLifecycleState: CallLifecycleState = "ACTIVE_CALL_UI_VISIBLE";
  private lifecycleStateListeners: Set<(state: CallLifecycleState) => void> = new Set();

  public getLifecycleState(): CallLifecycleState {
    return this.currentLifecycleState;
  }

  public setLifecycleState(newState: CallLifecycleState): void {
    if (this.currentLifecycleState === newState) return;
    const previous = this.currentLifecycleState;
    this.currentLifecycleState = newState;
    console.log(`[CALL_LIFECYCLE] APP_STATE: ${previous} -> ${newState}`);
    this.lifecycleStateListeners.forEach((listener) => {
      try {
        listener(newState);
      } catch (err) {
        console.error("[MobileForegroundService] Error in lifecycle state listener:", err);
      }
    });
  }

  public onLifecycleStateChanged(callback: (state: CallLifecycleState) => void): () => void {
    this.lifecycleStateListeners.add(callback);
    return () => {
      this.lifecycleStateListeners.delete(callback);
    };
  }

  /**
   * Start native Android foreground service for active Live Swap calls.
   * This promotes the app process to a foreground service with TYPE_MICROPHONE/CAMERA,
   * keeping audio tracks, camera stream, microphone capture, and network sockets active across
   * Home, app switching, and screen lock.
   */
  public async startCallForegroundService(params: {
    partnerName: string;
    callType?: "video" | "audio";
    sessionId?: string;
    callId?: string;
  }): Promise<boolean> {
    if (Capacitor.getPlatform() !== "android") {
      return false;
    }

    try {
      console.log(`[CALL_LIFECYCLE] FOREGROUND_SERVICE_START requested for partner=${params.partnerName}, callType=${params.callType || "video"}`);
      await CallForegroundPlugin.startCallForeground({
        partnerName: params.partnerName || "Swap Partner",
        callType: params.callType || "video",
        sessionId: params.sessionId || "",
        callId: params.callId || "",
      });
      this.isRunning = true;
      console.log("[CALL_LIFECYCLE] Native Android call foreground service successfully running");
      return true;
    } catch (err) {
      console.warn("[CALL_LIFECYCLE] Failed to start native foreground service:", err);
      return false;
    }
  }

  /**
   * Stop native Android foreground service when the call is explicitly ended.
   */
  public async stopCallForegroundService(): Promise<boolean> {
    if (Capacitor.getPlatform() !== "android") {
      return false;
    }

    try {
      console.log("[CALL_LIFECYCLE] FOREGROUND_SERVICE_STOP requested");
      await CallForegroundPlugin.stopCallForeground();
      this.isRunning = false;
      console.log("[CALL_LIFECYCLE] Native Android call foreground service stopped");
      return true;
    } catch (err) {
      console.warn("[CALL_LIFECYCLE] Failed to stop native foreground service:", err);
      return false;
    }
  }

  public isServiceRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Retrieves any pre-accepted call payload stored by the native layer
   * when the user clicked Answer on incoming call notification / activity while app was terminated.
   */
  public async getPendingAcceptedCall(): Promise<PendingAcceptedCall | null> {
    if (Capacitor.getPlatform() !== "android" || !CallForegroundPlugin.getPendingAcceptedCall) {
      return null;
    }
    try {
      const res = await CallForegroundPlugin.getPendingAcceptedCall();
      if (res && res.hasPendingCall && res.callId) {
        console.log("[MobileForegroundService] Found pending pre-accepted call:", res);
        return res;
      }
      return null;
    } catch (err) {
      console.warn("[MobileForegroundService] Failed to check pending accepted call:", err);
      return null;
    }
  }

  public async clearPendingAcceptedCall(): Promise<void> {
    if (Capacitor.getPlatform() !== "android" || !CallForegroundPlugin.clearPendingAcceptedCall) {
      return;
    }
    try {
      await CallForegroundPlugin.clearPendingAcceptedCall();
    } catch (err) {
      console.warn("[MobileForegroundService] Failed to clear pending accepted call:", err);
    }
  }

  /**
   * Check if Android Picture-in-Picture is supported on this device
   */
  public async isPipSupported(): Promise<boolean> {
    if (Capacitor.getPlatform() !== "android" || !CallForegroundPlugin.isPipSupported) {
      return false;
    }
    try {
      const res = await CallForegroundPlugin.isPipSupported();
      return !!res?.supported;
    } catch {
      return false;
    }
  }

  /**
   * Trigger native Android Picture-in-Picture window
   */
  public async enterPipMode(): Promise<boolean> {
    if (Capacitor.getPlatform() !== "android" || !CallForegroundPlugin.enterPip) {
      return false;
    }
    try {
      console.log("[CALL_LIFECYCLE] Requesting native Android Picture-in-Picture");
      const res = await CallForegroundPlugin.enterPip();
      return !!res?.success;
    } catch (err) {
      console.warn("[CALL_LIFECYCLE] Failed to enter PiP mode:", err);
      return false;
    }
  }

  /**
   * Listen for Picture-in-Picture mode transitions
   */
  public onPipModeChanged(callback: (inPip: boolean) => void): () => void {
    if (Capacitor.getPlatform() !== "android") return () => {};
    let sub: any = null;
    try {
      sub = CallForegroundPlugin.addListener("pipModeChanged", (data) => {
        console.log(`[CALL_LIFECYCLE] pipModeChanged received: inPip=${data.inPip}`);
        callback(data.inPip);
      });
    } catch (err) {
      console.warn("[ForegroundService] Failed to bind pipModeChanged listener:", err);
    }
    return () => {
      sub?.then?.((s: any) => s.remove?.());
    };
  }

  /**
   * Listen for screen lock / unlock state changes from native broadcast receiver
   */
  public onScreenLockStateChanged(callback: (screenLocked: boolean) => void): () => void {
    if (Capacitor.getPlatform() !== "android") return () => {};
    let sub: any = null;
    try {
      sub = CallForegroundPlugin.addListener("screenLockStateChanged", (data) => {
        console.log(`[CALL_LIFECYCLE] ${data.screenLocked ? "SCREEN_LOCK" : "SCREEN_UNLOCK"}`);
        callback(data.screenLocked);
      });
    } catch (err) {
      console.warn("[ForegroundService] Failed to bind screenLockStateChanged listener:", err);
    }
    return () => {
      sub?.then?.((s: any) => s.remove?.());
    };
  }

  /**
   * Listen for user tapping "End Call" on the Android notification action button
   */
  public onCallEndedByNotification(callback: () => void): () => void {
    if (Capacitor.getPlatform() !== "android") return () => {};
    let sub: any = null;
    try {
      sub = CallForegroundPlugin.addListener("callEndedByNotification", () => {
        console.log("[ForegroundService] Received callEndedByNotification event from native service");
        callback();
      });
    } catch (err) {
      console.warn("[ForegroundService] Failed to bind callEndedByNotification listener:", err);
    }
    return () => {
      sub?.then?.((s: any) => s.remove?.());
    };
  }

  /**
   * Listen for native call acceptance when user taps Answer on incoming call banner/notification
   */
  public onCallAcceptedNatively(callback: (data: PendingAcceptedCall) => void): () => void {
    if (Capacitor.getPlatform() !== "android") return () => {};
    let sub: any = null;
    try {
      sub = CallForegroundPlugin.addListener("callAcceptedNatively", (data) => {
        console.log("[ForegroundService] Received callAcceptedNatively event from native service:", data);
        callback(data);
      });
    } catch (err) {
      console.warn("[ForegroundService] Failed to bind callAcceptedNatively listener:", err);
    }
    return () => {
      sub?.then?.((s: any) => s.remove?.());
    };
  }

  /**
   * Retrieves the current native FCM token cached by Android FirebaseMessagingService
   */
  public async getNativeFcmToken(): Promise<string | null> {
    if (Capacitor.getPlatform() !== "android" || !CallForegroundPlugin.getFcmToken) {
      return null;
    }
    try {
      const res = await CallForegroundPlugin.getFcmToken();
      return res?.token || null;
    } catch (err) {
      console.warn("[ForegroundService] Failed to get native FCM token:", err);
      return null;
    }
  }

  /**
   * Caches current authenticated user ID in native SharedPreferences so
   * background FCM token refreshes can sync directly to Firestore/backend
   */
  public async setPushUserId(userId: string, backendUrl?: string, idToken?: string): Promise<void> {
    if (Capacitor.getPlatform() !== "android" || !CallForegroundPlugin.setPushUserId) {
      return;
    }
    try {
      await CallForegroundPlugin.setPushUserId({ userId, backendUrl, idToken });
    } catch (err) {
      console.warn("[ForegroundService] Failed to setPushUserId in native layer:", err);
    }
  }

  /**
   * Verifies critical calling permissions: notifications, full-screen intent, battery optimization
   */
  public async checkCallPermissions(): Promise<CallPermissionsStatus | null> {
    if (Capacitor.getPlatform() !== "android" || !CallForegroundPlugin.checkCallPermissions) {
      return null;
    }
    try {
      return await CallForegroundPlugin.checkCallPermissions();
    } catch (err) {
      console.warn("[ForegroundService] Failed to check call permissions:", err);
      return null;
    }
  }

  /**
   * Prompts user to disable battery optimization (crucial for Infinix/XOS devices)
   */
  public async requestIgnoreBatteryOptimizations(): Promise<boolean> {
    if (Capacitor.getPlatform() !== "android" || !CallForegroundPlugin.requestIgnoreBatteryOptimizations) {
      return false;
    }
    try {
      const res = await CallForegroundPlugin.requestIgnoreBatteryOptimizations();
      return !!res?.success;
    } catch (err) {
      console.warn("[ForegroundService] Failed to request battery optimization ignore:", err);
      return false;
    }
  }

  /**
   * Opens Full Screen Intent permission screen on Android 14+
   */
  public async openFullScreenIntentSettings(): Promise<boolean> {
    if (Capacitor.getPlatform() !== "android" || !CallForegroundPlugin.openFullScreenIntentSettings) {
      return false;
    }
    try {
      const res = await CallForegroundPlugin.openFullScreenIntentSettings();
      return !!res?.success;
    } catch (err) {
      console.warn("[ForegroundService] Failed to open full screen intent settings:", err);
      return false;
    }
  }
}

export const mobileForegroundService = new MobileForegroundService();
