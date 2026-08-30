/**
 * Mobile App & Call Lifecycle Manager
 * Handles Screen Wake Lock (preventing screen sleep during active calls)
 * and foreground/background state reconciliation.
 */

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

export type AppStateChangeListener = (isActive: boolean) => void;

export class MobileLifecycleService {
  private wakeLockSentinel: any = null;
  private appStateListeners: Set<AppStateChangeListener> = new Set();
  private isInitialized = false;

  public init() {
    if (this.isInitialized || typeof window === "undefined") return;
    this.isInitialized = true;

    // Listen to native Capacitor App state changes
    if (Capacitor.isNativePlatform()) {
      App.addListener("appStateChange", (state) => {
        console.log(`[MobileLifecycle] Native App state changed: isActive=${state.isActive}`);
        this.notifyListeners(state.isActive);
      });
    }

    // Web visibilitychange listener
    document.addEventListener("visibilitychange", () => {
      const isActive = document.visibilityState === "visible";
      console.log(`[MobileLifecycle] Document visibility changed: visible=${isActive}`);
      this.notifyListeners(isActive);
    });
  }

  public addAppStateListener(listener: AppStateChangeListener): () => void {
    this.appStateListeners.add(listener);
    return () => {
      this.appStateListeners.delete(listener);
    };
  }

  private notifyListeners(isActive: boolean) {
    this.appStateListeners.forEach((listener) => {
      try {
        listener(isActive);
      } catch (err) {
        console.error("[MobileLifecycle] Error in listener:", err);
      }
    });
  }

  /**
   * Acquire Screen Wake Lock during active LiveKit Call to keep screen awake
   */
  public async acquireCallWakeLock(): Promise<boolean> {
    if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
      try {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request("screen");
        this.wakeLockSentinel.addEventListener("release", () => {
          console.log("[MobileLifecycle] Screen Wake Lock was released");
        });
        console.log("[MobileLifecycle] Screen Wake Lock acquired for active call");
        return true;
      } catch (err) {
        console.warn("[MobileLifecycle] Could not acquire WakeLock:", err);
      }
    }
    return false;
  }

  /**
   * Release Screen Wake Lock when call terminates
   */
  public async releaseCallWakeLock(): Promise<void> {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch {}
      this.wakeLockSentinel = null;
      console.log("[MobileLifecycle] Screen Wake Lock released");
    }
  }
}

export const mobileLifecycleService = new MobileLifecycleService();
