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

export interface MediaAcquisitionResult {
  success: boolean;
  stream: MediaStream | null;
  error: string | null;
  errorType: "denied" | "unavailable" | "in-use" | "unknown" | null;
}

export interface AcquireMediaOptions {
  video?: boolean;
  audio?: boolean;
  facingMode?: "user" | "environment";
  preferredVideoDeviceId?: string;
}

export class MobilePermissionService {
  private inFlightMediaPromise: Promise<MediaAcquisitionResult> | null = null;
  private activeStream: MediaStream | null = null;

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
   * Check all media and notification permission statuses and device availability
   */
  public async checkPermissions(): Promise<PermissionStatusResult> {
    const result: PermissionStatusResult = {
      camera: "prompt",
      microphone: "prompt",
      notifications: "prompt",
    };

    // 0. Enumerate hardware devices to determine physical availability
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some((d) => d.kind === "videoinput");
        const hasMic = devices.some((d) => d.kind === "audioinput");
        const hasGrantedLabels = devices.some(
          (d) => (d.kind === "videoinput" || d.kind === "audioinput") && d.label !== ""
        );

        console.log(`[MEDIA_DEBUG] camera availability: ${hasCamera}, microphone availability: ${hasMic}, hasGrantedLabels: ${hasGrantedLabels}`);

        if (!hasCamera) result.camera = "unavailable";
        if (!hasMic) result.microphone = "unavailable";

        if (hasGrantedLabels) {
          if (hasCamera) result.camera = "granted";
          if (hasMic) result.microphone = "granted";
        }
      } catch (enumErr) {
        console.warn("[MEDIA_DEBUG] enumerateDevices check failed:", enumErr);
      }
    }

    // 1. Native Mobile Platform Check
    if (this.isNative()) {
      try {
        const cameraStatus = await Camera.checkPermissions();
        if (result.camera !== "unavailable") {
          result.camera =
            cameraStatus.camera === "granted"
              ? "granted"
              : cameraStatus.camera === "denied"
              ? "denied"
              : "prompt";
        }
      } catch {
        // Keep current result
      }

      try {
        const notifStatus = await LocalNotifications.checkPermissions();
        result.notifications =
          notifStatus.display === "granted"
            ? "granted"
            : notifStatus.display === "denied"
            ? "denied"
            : "prompt";
      } catch {
        result.notifications = "prompt";
      }

      console.log(`[MEDIA_DEBUG] permission state (Native): camera=${result.camera}, microphone=${result.microphone}`);
      return result;
    }

    // 2. Web Browser Permissions API Fallback
    if (typeof navigator !== "undefined" && navigator.permissions) {
      try {
        if (result.camera !== "unavailable" && result.camera !== "granted") {
          const camPerm = await navigator.permissions.query({ name: "camera" as any }).catch(() => null);
          if (camPerm) {
            result.camera = camPerm.state === "granted" ? "granted" : camPerm.state === "denied" ? "denied" : "prompt";
          }
        }

        if (result.microphone !== "unavailable" && result.microphone !== "granted") {
          const micPerm = await navigator.permissions.query({ name: "microphone" as any }).catch(() => null);
          if (micPerm) {
            result.microphone = micPerm.state === "granted" ? "granted" : micPerm.state === "denied" ? "denied" : "prompt";
          }
        }
      } catch {
        // Permissions query not supported in all browsers
      }
    }

    if (typeof window !== "undefined" && "Notification" in window) {
      result.notifications =
        Notification.permission === "granted"
          ? "granted"
          : Notification.permission === "denied"
          ? "denied"
          : "prompt";
    }

    console.log(`[MEDIA_DEBUG] permission state (Web): camera=${result.camera}, microphone=${result.microphone}`);
    return result;
  }

  /**
   * Acquire local camera and microphone stream with automatic hardware detection,
   * single in-flight promise de-duplication, timeout handling, and progressive constraints.
   */
  public async acquireCallMediaStream(
    options: AcquireMediaOptions = {}
  ): Promise<MediaAcquisitionResult> {
    // 1. If an active, working stream is already held, return it immediately
    if (this.activeStream && this.activeStream.active) {
      const videoTracks = this.activeStream.getVideoTracks();
      const audioTracks = this.activeStream.getAudioTracks();
      const hasLiveVideo = videoTracks.some((t) => t.readyState === "live" && t.enabled);
      const hasLiveAudio = audioTracks.some((t) => t.readyState === "live" && t.enabled);

      if ((!options.video || hasLiveVideo) && (!options.audio || hasLiveAudio)) {
        console.log("[CALL_TRACE] Step 1: Media permission already granted, active stream reused immediately.");
        return {
          success: true,
          stream: this.activeStream,
          error: null,
          errorType: null,
        };
      }
    }

    // 2. If a request is already in-flight, return the existing Promise to avoid concurrent getUserMedia collisions
    if (this.inFlightMediaPromise) {
      console.log("[CALL_TRACE] Step 1: Awaiting already in-flight media acquisition request...");
      return this.inFlightMediaPromise;
    }

    this.inFlightMediaPromise = (async () => {
      try {
        const {
          video = true,
          audio = true,
          facingMode = "user",
          preferredVideoDeviceId,
        } = options;

        console.log(`[CALL_TRACE] Step 1: Permission request initiated: video=${video}, audio=${audio}, facingMode=${facingMode}`);

        // In native mobile container (Capacitor Android / iOS), ensure native camera permission is requested if needed
        if (this.isNative() && video) {
          try {
            const camStatus = await Camera.checkPermissions();
            if (camStatus.camera !== "granted") {
              await Camera.requestPermissions({ permissions: ["camera"] });
            }
          } catch (nativePermErr) {
            console.warn("[MobilePermissions] Native Camera permission pre-request notice:", nativePermErr);
          }
        }

        // Verify browser getUserMedia support
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          console.error("[CALL_TRACE] Step 1 FAILED: navigator.mediaDevices.getUserMedia is not supported on this platform.");
          return {
            success: false,
            stream: null,
            error: "Camera and microphone are not supported in this browser or environment.",
            errorType: "unavailable",
          };
        }

        // Helper: Call getUserMedia with a robust 10s timeout to prevent infinite hangs
        const getUserMediaWithTimeout = (constraints: MediaStreamConstraints, timeoutMs = 10000): Promise<MediaStream> => {
          let timer: any;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              const err = new Error(`Camera and microphone request timed out after ${timeoutMs / 1000} seconds.`);
              err.name = "TimeoutError";
              reject(err);
            }, timeoutMs);
          });
          return Promise.race([
            navigator.mediaDevices.getUserMedia(constraints),
            timeoutPromise,
          ]).finally(() => clearTimeout(timer));
        };

        let stream: MediaStream | null = null;

        // Step 8: Test fallback constraints:
        // video: { facingMode: "user" }
        // audio: true
        // Then progressively request higher quality.
        const level1Constraints: MediaStreamConstraints = {
          video: video
            ? preferredVideoDeviceId
              ? { deviceId: { exact: preferredVideoDeviceId } }
              : { facingMode: facingMode ? { ideal: facingMode } : "user" }
            : false,
          audio: audio
            ? {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              }
            : false,
        };

        console.log("[CALL_TRACE] Step 2: getUserMedia calling with primary constraints:", JSON.stringify(level1Constraints));

        try {
          stream = await getUserMediaWithTimeout(level1Constraints, 10000);
        } catch (level1Err: any) {
          console.warn("[CALL_TRACE] Step 2: Primary constraints failed, attempting relaxed fallback:", level1Err.name, level1Err.message);

          // Level 2: Try basic fallback constraints video: { facingMode: "user" }, audio: true
          try {
            const level2Constraints: MediaStreamConstraints = {
              video: video ? { facingMode: "user" } : false,
              audio: !!audio,
            };
            console.log("[CALL_TRACE] Step 2 (Fallback): Calling getUserMedia with user facingMode constraints:", JSON.stringify(level2Constraints));
            stream = await getUserMediaWithTimeout(level2Constraints, 8000);
          } catch (level2Err: any) {
            console.warn("[CALL_TRACE] Step 2 (Fallback) failed:", level2Err.name, level2Err.message);

            // If audio-only was explicitly requested (video === false), throw audio error
            // If video was requested, DO NOT silently downgrade to audio-only.
            // Throw the error so the user is informed of camera failure and can retry.
            throw level2Err;
          }
        }

        if (!stream) {
          throw new Error("Unable to obtain media stream.");
        }

        const vTracks = stream.getVideoTracks();
        const aTracks = stream.getAudioTracks();

        // Enforce that if video was requested, a live video track exists
        if (video && (vTracks.length === 0 || vTracks[0].readyState === "ended")) {
          const camErr = new Error("Camera track was not found or failed to start.");
          camErr.name = "NotFoundError";
          throw camErr;
        }

        console.log(`[CALL_TRACE] Step 3: Stream created successfully (id: ${stream.id}, active: ${stream.active})`);
        console.log(`[CALL_TRACE] Step 4: Local tracks created & verified: video=${vTracks.length}, audio=${aTracks.length}`);

        // Progressively upgrade quality if video is supported and active
        if (video && vTracks.length > 0) {
          try {
            vTracks[0]
              .applyConstraints({
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 },
              })
              .catch((e) => {
                console.log("[CALL_TRACE] Progressive quality upgrade not applied (keeping base):", e?.message);
              });
          } catch (_) {}
        }

        this.activeStream = stream;
        return {
          success: true,
          stream,
          error: null,
          errorType: null,
        };
      } catch (err: any) {
        console.error(`[CALL_TRACE] Step 2 FAILED: getUserMedia failure: name=${err.name}, message=${err.message}`);

        let errorType: "denied" | "unavailable" | "in-use" | "unknown" = "unknown";
        let userMessage = "Could not access camera and microphone.";

        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          errorType = "denied";
          userMessage = "Camera and microphone access was denied. Please allow permissions in your browser or device settings to continue.";
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          errorType = "unavailable";
          userMessage = "No camera or microphone found on this device.";
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          errorType = "in-use";
          userMessage = "Your camera or microphone is currently in use by another application. Please close other apps and retry.";
        } else if (err.name === "TimeoutError") {
          errorType = "unknown";
          userMessage = "Permission request timed out. Please grant camera and microphone access and try again.";
        } else if (err.name === "OverconstrainedError") {
          errorType = "unavailable";
          userMessage = "Camera could not satisfy requested video constraints.";
        } else {
          userMessage = err.message || userMessage;
        }

        return {
          success: false,
          stream: null,
          error: userMessage,
          errorType,
        };
      } finally {
        this.inFlightMediaPromise = null;
      }
    })();

    return this.inFlightMediaPromise;
  }

  /**
   * Release and stop any active media stream
   */
  public releaseActiveStream(): void {
    if (this.activeStream) {
      console.log("[MEDIA_DEBUG] Stopping and releasing active local media stream");
      this.activeStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      this.activeStream = null;
    }
  }

  /**
   * Requests camera and microphone permissions for a Live Swap Call
   */
  public async requestCallPermissions(): Promise<{ camera: boolean; microphone: boolean }> {
    const res = await this.acquireCallMediaStream({ video: true, audio: true });
    return {
      camera: res.success && (res.stream?.getVideoTracks().length ?? 0) > 0,
      microphone: res.success && (res.stream?.getAudioTracks().length ?? 0) > 0,
    };
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
