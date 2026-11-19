import { Capacitor } from "@capacitor/core";
import { mobileForegroundService } from "../mobile/foregroundService";

export interface ScreenShareCapabilities {
  isAndroidNative: boolean;
  isIosNative: boolean;
  supportsBrowserDisplayMedia: boolean;
  supportsDeviceCapture: boolean;
}

export interface ActiveScreenShareSession {
  stream: MediaStream;
  mode: "android_native" | "browser_display";
  stop: () => Promise<void>;
}

export class ScreenCaptureUnavailableError extends Error {
  public readonly code = "SCREEN_CAPTURE_UNAVAILABLE_USE_STUDIO";
  constructor(message: string) {
    super(message);
    this.name = "ScreenCaptureUnavailableError";
  }
}

export function getBattleScreenShareCapabilities(): ScreenShareCapabilities {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  const isAndroidNative = isNative && platform === "android";
  const isIosNative = isNative && platform === "ios";
  const supportsBrowserDisplayMedia =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function");

  return {
    isAndroidNative,
    isIosNative,
    supportsBrowserDisplayMedia,
    supportsDeviceCapture: isAndroidNative || supportsBrowserDisplayMedia,
  };
}

export async function startBattleDeviceScreenShare(
  battleId: string,
  onUnexpectedEnded?: () => void
): Promise<ActiveScreenShareSession> {
  const caps = getBattleScreenShareCapabilities();

  // 1. Native Android APK: Use Capacitor CallForegroundPlugin MediaProjection HD MJPEG -> Canvas MediaStream bridge
  if (caps.isAndroidNative) {
    const res = await mobileForegroundService.startNativeScreenCapture();
    if (!res || !res.success || !res.streamUrl) {
      throw new Error("Android screen capture permission was cancelled or unavailable.");
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.style.position = "fixed";
    img.style.left = "-9999px";
    img.style.top = "-9999px";
    img.style.width = "1px";
    img.style.height = "1px";
    img.style.opacity = "0";
    img.style.pointerEvents = "none";
    try {
      document.body.appendChild(img);
    } catch (_) {}
    img.src = `${res.streamUrl}?t=${Date.now()}`;

    const canvas = document.createElement("canvas");
    canvas.width = res.width || 576;
    canvas.height = res.height || 1024;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
    }

    let isStreaming = true;
    let animFrameId: number | null = null;
    let intervalTimerId: ReturnType<typeof setInterval> | null = null;
    let lastDrawTime = 0;

    const drawFrame = () => {
      if (!isStreaming) return;
      const now = performance.now();
      if (now - lastDrawTime >= 30) {
        if (img.complete && img.naturalWidth > 0 && ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          lastDrawTime = now;
        }
      }
    };

    intervalTimerId = setInterval(drawFrame, 33);
    const renderLoop = () => {
      if (!isStreaming) return;
      drawFrame();
      animFrameId = requestAnimationFrame(renderLoop);
    };
    animFrameId = requestAnimationFrame(renderLoop);

    const stream: MediaStream | null = (canvas as any).captureStream
      ? (canvas as any).captureStream(30)
      : null;

    if (!stream || stream.getVideoTracks().length === 0) {
      isStreaming = false;
      if (intervalTimerId) clearInterval(intervalTimerId);
      if (animFrameId) cancelAnimationFrame(animFrameId);
      try {
        img.src = "";
        img.remove();
      } catch (_) {}
      await mobileForegroundService.stopNativeScreenCapture().catch(() => {});
      throw new Error("Could not initialize video stream from Android screen capture.");
    }

    const track = stream.getVideoTracks()[0];
    try {
      track.contentHint = "motion";
    } catch (_) {}

    await mobileForegroundService.setScreenShareState(true, battleId).catch(() => {});

    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      isStreaming = false;
      if (intervalTimerId) {
        clearInterval(intervalTimerId);
        intervalTimerId = null;
      }
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      try {
        img.src = "";
        img.remove();
      } catch (_) {}
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch (_) {}
      });
      await mobileForegroundService.setScreenShareState(false, battleId).catch(() => {});
      await mobileForegroundService.stopNativeScreenCapture().catch(() => {});
    };

    track.onended = () => {
      void stop().finally(() => onUnexpectedEnded?.());
    };

    return {
      stream,
      mode: "android_native",
      stop,
    };
  }

  // 2. Desktop / Mobile Browser with standard getDisplayMedia support
  if (caps.supportsBrowserDisplayMedia) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
    } catch (err: any) {
      // Retry relaxed constraints if device rejects 1080p
      if (err?.name === "OverconstrainedError") {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } else {
        throw err;
      }
    }

    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        track.contentHint = "detail";
      } catch (_) {}
    }

    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch (_) {}
      });
    };

    if (track) {
      track.onended = () => {
        void stop().finally(() => onUnexpectedEnded?.());
      };
    }

    return {
      stream,
      mode: "browser_display",
      stop,
    };
  }

  // 3. iOS / WebView without native MediaProjection or DisplayMedia -> route to Interactive Board Studio
  throw new ScreenCaptureUnavailableError(
    caps.isIosNative
      ? "iOS system WebView does not expose full-device screen broadcast directly. Use Interactive Whiteboard / Code / Slide Studio instead."
      : "System screen capture isn't exposed by this mobile browser. Use Interactive Whiteboard / Code / Slide Studio to share live!"
  );
}
