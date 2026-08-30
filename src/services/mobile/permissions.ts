/**
 * Cross-Platform Mobile Permissions Manager
 * Handles Camera, Microphone, and Notification permissions cleanly across Web, Android, and iOS.
 */

import { Capacitor } from "@capacitor/core";
import { Camera, CameraPermissionType } from "@capacitor/camera";
import { LocalNotifications } from "@capacitor/local-notifications";

export interface PermissionStatusResult {
  camera: "granted" | "denied" | "prompt" | "unavailable";
  microphone: "granted" | "denied" | "prompt" | "unavailable";
  notifications: "granted" | "denied" | "prompt" | "unavailable";
}

export class MobilePermissionService {
  /**
   * Checks if running in a native mobile container (Capacitor Android / iOS)
   */
  public isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Returns the current platform ('android' | 'ios' | 'web')
   */
  public getPlatform(): string {
    return Capacitor.getPlatform();
  }

  /**
   * Check all media and notification permission statuses
   */
  public async checkPermissions(): Promise<PermissionStatusResult> {
    const result: PermissionStatusResult = {
      camera: "prompt",
      microphone: "prompt",
      notifications: "prompt",
    };

    // 1. Native Mobile Platform
    if (this.isNative()) {
      try {
        const cameraStatus = await Camera.checkPermissions();
        result.camera = cameraStatus.camera === "granted" ? "granted" : cameraStatus.camera === "denied" ? "denied" : "prompt";
      } catch {
        result.camera = "prompt";
      }

      try {
        const notifStatus = await LocalNotifications.checkPermissions();
        result.notifications = notifStatus.display === "granted" ? "granted" : notifStatus.display === "denied" ? "denied" : "prompt";
      } catch {
        result.notifications = "prompt";
      }

      return result;
    }

    // 2. Web Browser Fallback
    if (typeof navigator !== "undefined" && navigator.permissions) {
      try {
        const camPerm = await navigator.permissions.query({ name: "camera" as any }).catch(() => null);
        if (camPerm) result.camera = camPerm.state === "granted" ? "granted" : camPerm.state === "denied" ? "denied" : "prompt";

        const micPerm = await navigator.permissions.query({ name: "microphone" as any }).catch(() => null);
        if (micPerm) result.microphone = micPerm.state === "granted" ? "granted" : micPerm.state === "denied" ? "denied" : "prompt";
      } catch {
        // Ignored if browser doesn't support querying
      }
    }

    if (typeof window !== "undefined" && "Notification" in window) {
      result.notifications = Notification.permission === "granted" ? "granted" : Notification.permission === "denied" ? "denied" : "prompt";
    }

    return result;
  }

  /**
   * Requests camera and microphone permissions for a Live Swap Call
   */
  public async requestCallPermissions(): Promise<{ camera: boolean; microphone: boolean }> {
    let cameraGranted = false;
    let microphoneGranted = false;

    if (this.isNative()) {
      try {
        const camRes = await Camera.requestPermissions({ permissions: ["camera"] });
        cameraGranted = camRes.camera === "granted";
      } catch (err) {
        console.warn("[MobilePermissions] Native camera request fallback:", err);
      }
    }

    // Also trigger standard getUserMedia to initialize WebRTC permission stream
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        cameraGranted = true;
        microphoneGranted = true;
        // Release immediate test tracks
        stream.getTracks().forEach((track) => track.stop());
      } catch (mediaErr: any) {
        console.warn("[MobilePermissions] getUserMedia audio/video test failed, trying audio only:", mediaErr);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          microphoneGranted = true;
          audioStream.getTracks().forEach((track) => track.stop());
        } catch (audioErr) {
          console.error("[MobilePermissions] Microphone request completely denied:", audioErr);
        }
      }
    }

    return { camera: cameraGranted, microphone: microphoneGranted };
  }

  /**
   * Request Notification Permission
   */
  public async requestNotificationPermission(): Promise<boolean> {
    if (this.isNative()) {
      try {
        const res = await LocalNotifications.requestPermissions();
        return res.display === "granted";
      } catch (err) {
        console.warn("[MobilePermissions] Native notification permission failed:", err);
        return false;
      }
    }

    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") return true;
      if (Notification.permission === "denied") return false;
      try {
        const res = await Notification.requestPermission();
        return res === "granted";
      } catch {
        return false;
      }
    }

    return false;
  }
}

export const mobilePermissionService = new MobilePermissionService();
