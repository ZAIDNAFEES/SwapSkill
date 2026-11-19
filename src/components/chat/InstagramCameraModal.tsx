import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  ArrowLeft,
  RotateCcw,
  RefreshCw,
  Zap,
  ZapOff,
  Image as ImageIcon,
  Send,
  Loader2,
  MessageSquare,
  AlertCircle,
  Volume2,
  VolumeX,
  Video as VideoIcon,
  Camera as CameraIcon,
  Square,
} from "lucide-react";

export type ViewOnceMode = "view_once" | "allow_replay" | "keep_in_chat";
export type EphemeralMediaType = "image" | "video";

interface InstagramCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipientName: string;
  onSend: (payload: { file: File; mediaType: EphemeralMediaType; viewMode: ViewOnceMode }) => Promise<void>;
}

const MAX_VIDEO_SECONDS = 60;

// 1x1 transparent GIF prevents Android System WebView from rendering its giant gray default <video> play icon
const TRANSPARENT_POSTER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const VIEW_MODE_META: Record<
  ViewOnceMode,
  { label: string; hint: (noun: string) => string }
> = {
  view_once: {
    label: "View once",
    hint: (noun) => `One view · ${noun} disappears after closing`,
  },
  allow_replay: {
    label: "Allow replay",
    hint: (noun) => `Replayable · can be viewed twice`,
  },
  keep_in_chat: {
    label: "Keep in chat",
    hint: (noun) => `Saved · stays in chat conversation`,
  },
};

export const InstagramCameraModal: React.FC<InstagramCameraModalProps> = ({
  isOpen,
  onClose,
  recipientName,
  onSend,
}) => {
  const [step, setStep] = useState<"camera" | "preview">("camera");
  const [captureMode, setCaptureMode] = useState<EphemeralMediaType>("image");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [flashOn, setFlashOn] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);

  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const [flipSpinCount, setFlipSpinCount] = useState(0);

  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [mediaType, setMediaType] = useState<EphemeralMediaType>("image");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(null);
  const [isPreviewVideoReady, setIsPreviewVideoReady] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);

  const [viewMode, setViewMode] = useState<ViewOnceMode>("view_once");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Video recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartedRecordingRef = useRef<boolean>(false);
  const previewUrlRef = useRef<string | null>(null);

  // Compositor canvas refs for seamless mid-recording Front <-> Back camera flip
  const compositorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositorRafRef = useRef<number | null>(null);
  const compositorStreamRef = useRef<MediaStream | null>(null);
  const facingModeRef = useRef<"user" | "environment">("user");
  const isRecordingRef = useRef<boolean>(false);
  const recordingPosterRef = useRef<string | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    facingModeRef.current = facingMode;
  }, [facingMode]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const stopCompositor = useCallback(() => {
    if (compositorRafRef.current !== null) {
      cancelAnimationFrame(compositorRafRef.current);
      compositorRafRef.current = null;
    }
    if (compositorStreamRef.current) {
      compositorStreamRef.current.getVideoTracks().forEach((t) => {
        try {
          t.stop();
        } catch (_) {}
      });
      compositorStreamRef.current = null;
    }
    compositorCanvasRef.current = null;
  }, []);

  const stopStream = useCallback(() => {
    clearRecordingTimer();
    stopCompositor();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (_) {}
    }
    mediaRecorderRef.current = null;
    isRecordingRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [clearRecordingTimer, stopCompositor]);

  // Apply hardware torch on back camera when supported
  const applyTorchConstraint = useCallback(async (stream: MediaStream | null, enabled: boolean, mode: "user" | "environment") => {
    if (!stream || mode !== "environment") return;
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    try {
      const caps = typeof videoTrack.getCapabilities === "function" ? (videoTrack.getCapabilities() as any) : null;
      if (caps?.torch) {
        await videoTrack.applyConstraints({ advanced: [{ torch: enabled } as any] });
      }
    } catch (_) {
      // Torch not supported on this device/WebView — fail silently
    }
  }, []);

  useEffect(() => {
    if (step === "camera" && streamRef.current) {
      applyTorchConstraint(streamRef.current, flashOn, facingMode);
    }
  }, [flashOn, facingMode, step, applyTorchConstraint]);

  // Acquire a camera stream with resilient constraint fallback
  const acquireCameraStream = useCallback(
    async (targetFacing: "user" | "environment", includeAudio: boolean): Promise<MediaStream> => {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { exact: targetFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: includeAudio,
        });
      } catch (_) {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: targetFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: includeAudio,
          });
        } catch (__) {
          if (includeAudio) {
            return await navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: targetFacing } },
              audio: false,
            });
          }
          return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      }
    },
    []
  );

  // Start camera stream (intentionally decoupled from facingMode so mid-recording flips never tear down MediaRecorder)
  const startCamera = useCallback(
    async (targetFacing?: "user" | "environment") => {
      const desiredFacing = targetFacing || facingModeRef.current;
      stopStream();
      setCameraError(null);
      setIsCameraReady(false);
      setIsRecording(false);
      setRecordingSeconds(0);

      try {
        const stream = await acquireCameraStream(desiredFacing, true);
        if (!isMountedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (finalErr: any) {
        setCameraError(finalErr?.message || "Camera access was denied or is unavailable.");
      }
    },
    [acquireCameraStream, stopStream]
  );

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  // Lifecycle strictly bound to isOpen (not facingMode)
  useEffect(() => {
    if (isOpen) {
      setStep("camera");
      setCaptureMode("image");
      setMediaType("image");
      setViewMode("view_once");
      setCapturedBlob(null);
      setVideoPosterUrl(null);
      setIsPreviewVideoReady(false);
      setPreviewMuted(false);
      setUploadError(null);
      setIsUploading(false);
      setIsRecording(false);
      setRecordingSeconds(0);
      setIsCameraReady(false);
      setIsSwitchingCamera(false);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        setPreviewUrl(null);
      }
      startCamera(facingModeRef.current);
    } else {
      stopStream();
      setIsRecording(false);
      setIsCameraReady(false);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        setPreviewUrl(null);
      }
    }
    return () => {
      stopStream();
    };
  }, [isOpen, startCamera, stopStream]);

  // Switch Front <-> Back camera seamlessly — works BOTH before AND during active video recording!
  const handleFlipCamera = useCallback(async () => {
    if (!isOpen || step !== "camera" || isSwitchingCamera || cameraError) return;

    const nextFacing: "user" | "environment" =
      facingModeRef.current === "user" ? "environment" : "user";

    setIsSwitchingCamera(true);
    setFlipSpinCount((c) => c + 1);

    try {
      const recordingActive = isRecordingRef.current;

      if (recordingActive && streamRef.current) {
        // Mid-recording hot-swap: keep audio tracks alive untouched so mic & MediaRecorder never cut out
        const existingAudioTracks = streamRef.current.getAudioTracks();
        const oldVideoTracks = streamRef.current.getVideoTracks();

        // Stop old video track first only if needed by single-camera hardware on Android WebView;
        // try concurrent acquire first for zero black gap, fall back to sequential release if device locks hardware
        let newVideoStream: MediaStream | null = null;
        try {
          newVideoStream = await acquireCameraStream(nextFacing, false);
        } catch (_) {
          oldVideoTracks.forEach((t) => {
            try {
              t.stop();
            } catch (__) {}
          });
          newVideoStream = await acquireCameraStream(nextFacing, false);
        }

        if (!isMountedRef.current) {
          newVideoStream.getTracks().forEach((t) => t.stop());
          return;
        }

        const newVideoTrack = newVideoStream.getVideoTracks()[0];
        const mergedStream = new MediaStream([
          ...(newVideoTrack ? [newVideoTrack] : []),
          ...existingAudioTracks,
        ]);

        // Update facing ref right as new feed attaches so canvas compositor mirrors correctly
        facingModeRef.current = nextFacing;
        setFacingMode(nextFacing);
        streamRef.current = mergedStream;

        if (videoRef.current) {
          videoRef.current.srcObject = mergedStream;
          await videoRef.current.play().catch(() => {});
        }

        oldVideoTracks.forEach((t) => {
          if (t !== newVideoTrack) {
            try {
              t.stop();
            } catch (_) {}
          }
        });

        applyTorchConstraint(mergedStream, flashOn, nextFacing);
      } else {
        // Idle camera swap: acquire new A/V stream, attach cleanly, stop old tracks
        const oldStream = streamRef.current;
        let nextStream: MediaStream;
        try {
          nextStream = await acquireCameraStream(nextFacing, true);
        } catch (_) {
          oldStream?.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch (__) {}
          });
          nextStream = await acquireCameraStream(nextFacing, true);
        }

        if (!isMountedRef.current) {
          nextStream.getTracks().forEach((t) => t.stop());
          return;
        }

        facingModeRef.current = nextFacing;
        setFacingMode(nextFacing);
        streamRef.current = nextStream;

        if (videoRef.current) {
          videoRef.current.srcObject = nextStream;
          await videoRef.current.play().catch(() => {});
        }

        oldStream?.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch (_) {}
        });

        applyTorchConstraint(nextStream, flashOn, nextFacing);
      }
    } catch (err: any) {
      console.warn("[InstagramCamera] Camera switch failed:", err);
      setUploadError("Could not switch camera right now.");
      window.setTimeout(() => setUploadError(null), 2600);
    } finally {
      if (isMountedRef.current) {
        setIsSwitchingCamera(false);
      }
    }
  }, [isOpen, step, isSwitchingCamera, cameraError, acquireCameraStream, applyTorchConstraint, flashOn]);

  // Draw the current <video> frame onto a canvas with proper aspect-cover scaling & selfie mirroring
  const drawVideoCoverFrame = (
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    width: number,
    height: number,
    mirror: boolean
  ) => {
    const vw = video.videoWidth || width;
    const vh = video.videoHeight || height;
    if (!vw || !vh) return;

    const canvasAspect = width / height;
    const videoAspect = vw / vh;
    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;

    if (videoAspect > canvasAspect) {
      sw = vh * canvasAspect;
      sx = (vw - sw) / 2;
    } else if (videoAspect < canvasAspect) {
      sh = vw / canvasAspect;
      sy = (vh - sh) / 2;
    }

    ctx.save();
    if (mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    ctx.restore();
  };

  // Capture JPEG snapshot from current live feed for instant video poster or photo capture
  const captureSnapshotDataUrl = (video: HTMLVideoElement, mirror: boolean): string | null => {
    try {
      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;
      const scale = Math.min(1, 720 / Math.max(vw, vh));
      const w = Math.max(2, Math.round(vw * scale) & ~1);
      const h = Math.max(2, Math.round(vh * scale) & ~1);
      const snapCanvas = document.createElement("canvas");
      snapCanvas.width = w;
      snapCanvas.height = h;
      const ctx = snapCanvas.getContext("2d");
      if (!ctx) return null;
      drawVideoCoverFrame(ctx, video, w, h, mirror);
      return snapCanvas.toDataURL("image/jpeg", 0.8);
    } catch (_) {
      return null;
    }
  };

  // Capture photo from live feed with brief shutter flash
  const handleCapturePhoto = () => {
    if (!videoRef.current || !isCameraReady) return;
    try {
      if (flashOn) {
        setShutterFlash(true);
        window.setTimeout(() => setShutterFlash(false), 160);
      }

      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (facingModeRef.current === "user") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            stopStream();
            if (previewUrlRef.current) {
              URL.revokeObjectURL(previewUrlRef.current);
            }
            const url = URL.createObjectURL(blob);
            setCapturedBlob(blob);
            setMediaType("image");
            setVideoPosterUrl(null);
            setPreviewUrl(url);
            setUploadError(null);
            setStep("preview");
          }
        },
        "image/jpeg",
        0.92
      );
    } catch (e) {
      console.error("[InstagramCamera] Failed to capture photo:", e);
    }
  };

  // Start live video recording using canvas-composited stream so mid-recording camera switches work seamlessly
  const startVideoRecording = () => {
    if (!streamRef.current || !videoRef.current || isRecordingRef.current) return;
    if (typeof MediaRecorder === "undefined") {
      setUploadError("Video recording is not supported on this browser. Pick a video from gallery.");
      return;
    }

    try {
      const video = videoRef.current;
      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;

      // Capture immediate poster frame for preview fallback
      recordingPosterRef.current = captureSnapshotDataUrl(video, facingModeRef.current === "user");

      // Build canvas compositor if supported (enables seamless live Front <-> Back flip mid-recording)
      let recordStream: MediaStream = streamRef.current;
      const tempCanvas = document.createElement("canvas");
      const canCaptureCanvas = typeof (tempCanvas as any).captureStream === "function";

      if (canCaptureCanvas) {
        const maxDim = 960;
        const scale = Math.min(1, maxDim / Math.max(vw, vh));
        const cw = Math.max(2, Math.round(vw * scale) & ~1);
        const ch = Math.max(2, Math.round(vh * scale) & ~1);

        tempCanvas.width = cw;
        tempCanvas.height = ch;
        compositorCanvasRef.current = tempCanvas;

        const ctx = tempCanvas.getContext("2d", { alpha: false });
        if (ctx) {
          drawVideoCoverFrame(ctx, video, cw, ch, facingModeRef.current === "user");

          let lastDrawTime = 0;
          const renderLoop = (now: number) => {
            if (!isRecordingRef.current) return;
            compositorRafRef.current = requestAnimationFrame(renderLoop);
            if (now - lastDrawTime < 30) return; // ~30fps cap for smooth lag-free CPU usage
            lastDrawTime = now;
            const liveVideo = videoRef.current;
            if (liveVideo && liveVideo.readyState >= 2) {
              drawVideoCoverFrame(ctx, liveVideo, cw, ch, facingModeRef.current === "user");
            }
          };

          const canvasStream = (tempCanvas as any).captureStream(30) as MediaStream;
          compositorStreamRef.current = canvasStream;
          const audioTracks = streamRef.current.getAudioTracks();
          recordStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioTracks,
          ]);

          isRecordingRef.current = true;
          compositorRafRef.current = requestAnimationFrame(renderLoop);
        }
      }

      // Prefer WebM VP8/VP9 on Chromium/Android WebView so <video src="blob:..."> never renders a black frame
      const preferredTypes = [
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp9,opus",
        "video/webm",
        "video/mp4;codecs=avc1,mp4a",
        "video/mp4",
      ];
      const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: 950_000, // Crisp mobile clarity & ~2x faster upload
        audioBitsPerSecond: 96_000,
        ...(mimeType ? { mimeType } : {}),
      };
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(recordStream, recorderOptions);
      } catch (_) {
        stopCompositor();
        recorder = mimeType
          ? new MediaRecorder(streamRef.current, { mimeType })
          : new MediaRecorder(streamRef.current);
      }

      recordedChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        clearRecordingTimer();
        stopCompositor();
        isRecordingRef.current = false;
        setIsRecording(false);

        const chunks = recordedChunksRef.current;
        if (!chunks || chunks.length === 0) return;

        const outType = mimeType || chunks[0]?.type || "video/webm";
        const blob = new Blob(chunks, { type: outType });
        if (blob.size < 1024) return;

        // Capture final poster frame if still playing before tearing down camera stream
        if (!recordingPosterRef.current && videoRef.current && videoRef.current.readyState >= 2) {
          recordingPosterRef.current = captureSnapshotDataUrl(
            videoRef.current,
            facingModeRef.current === "user"
          );
        }

        stopStream();
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
        }
        const url = URL.createObjectURL(blob);
        setCapturedBlob(blob);
        setMediaType("video");
        setVideoPosterUrl(recordingPosterRef.current);
        setIsPreviewVideoReady(false);
        setPreviewMuted(false);
        setPreviewUrl(url);
        setUploadError(null);
        setStep("preview");
      };

      mediaRecorderRef.current = recorder;
      isRecordingRef.current = true;
      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      setUploadError(null);

      const startTs = Date.now();
      recordingTimerRef.current = window.setInterval(() => {
        const secs = Math.floor((Date.now() - startTs) / 1000);
        setRecordingSeconds(secs);
        if (secs >= MAX_VIDEO_SECONDS) {
          stopVideoRecording();
        }
      }, 250);
    } catch (err: any) {
      console.error("[InstagramCamera] Video recording failed:", err);
      stopCompositor();
      isRecordingRef.current = false;
      setIsRecording(false);
      setUploadError(err?.message || "Could not start video recording.");
    }
  };

  const stopVideoRecording = () => {
    clearRecordingTimer();
    isRecordingRef.current = false;
    // Capture a fresh closing poster frame before stopping recorder
    if (videoRef.current && videoRef.current.readyState >= 2 && !recordingPosterRef.current) {
      recordingPosterRef.current = captureSnapshotDataUrl(
        videoRef.current,
        facingModeRef.current === "user"
      );
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (_) {}
    }
  };

  // Ensure preview video auto-plays cleanly in Android WebView (muted fallback if unmuted autoplay is blocked)
  useEffect(() => {
    if (step !== "preview" || mediaType !== "video" || !previewUrl) return;
    const vid = previewVideoRef.current;
    if (!vid) return;

    const tryPlay = () => {
      vid.play().catch(() => {
        vid.muted = true;
        setPreviewMuted(true);
        vid.play().catch(() => {});
      });
    };

    tryPlay();
  }, [step, mediaType, previewUrl]);

  // Shutter pointer interactions:
  // - Video mode: tap to start / tap to stop
  // - Photo mode: quick tap = photo, hold >= 260ms = record video until release
  const handleShutterPointerDown = () => {
    if (cameraError || !isCameraReady) return;
    if (captureMode === "video") return;
    holdStartedRecordingRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      holdStartedRecordingRef.current = true;
      startVideoRecording();
    }, 260);
  };

  const handleShutterPointerUp = () => {
    if (captureMode === "video") return;
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdStartedRecordingRef.current) {
      holdStartedRecordingRef.current = false;
      stopVideoRecording();
    }
  };

  const handleShutterClick = () => {
    if (cameraError || !isCameraReady) return;
    if (captureMode === "video") {
      if (isRecording) {
        stopVideoRecording();
      } else {
        startVideoRecording();
      }
      return;
    }
    if (holdStartedRecordingRef.current) {
      return;
    }
    handleCapturePhoto();
  };

  // Gallery picker handler (Photo or Video)
  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isVid =
        file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|3gp|mkv)$/i.test(file.name || "");
      if (isVid && file.size > 40 * 1024 * 1024) {
        setUploadError("Please select a video under 40 MB.");
        if (e.target) e.target.value = "";
        return;
      }
      stopStream();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      const url = URL.createObjectURL(file);
      setCapturedBlob(file);
      setMediaType(isVid ? "video" : "image");
      setVideoPosterUrl(null);
      setIsPreviewVideoReady(false);
      setPreviewMuted(false);
      setPreviewUrl(url);
      setUploadError(null);
      setStep("preview");
    }
    if (e.target) e.target.value = "";
  };

  const handleRetake = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      setPreviewUrl(null);
    }
    setCapturedBlob(null);
    setVideoPosterUrl(null);
    setIsPreviewVideoReady(false);
    setUploadError(null);
    setStep("camera");
    startCamera(facingModeRef.current);
  };

  const handleSend = async () => {
    if (!capturedBlob || isUploading) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      let file: File;
      if (capturedBlob instanceof File) {
        file = capturedBlob;
      } else if (mediaType === "video") {
        const ext = capturedBlob.type.includes("mp4") ? "mp4" : "webm";
        file = new File([capturedBlob], `view_once_vid_${Date.now()}.${ext}`, {
          type: capturedBlob.type || "video/webm",
        });
      } else {
        file = new File([capturedBlob], `view_once_${Date.now()}.jpg`, { type: "image/jpeg" });
      }
      await onSend({ file, mediaType, viewMode });
      onClose();
    } catch (err: any) {
      console.error("[InstagramCamera] Send failed:", err);
      setUploadError(err?.message || "Failed to send media. Please try again.");
      setIsUploading(false);
    }
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}:${rem < 10 ? "0" : ""}${rem}`;
  };

  if (!isOpen) return null;

  const noun = mediaType === "video" ? "video" : "photo";
  const ringCircumference = 2 * Math.PI * 36;
  const recordingPct = Math.min(1, recordingSeconds / MAX_VIDEO_SECONDS);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden select-none">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleGallerySelect}
      />

      {/* Full-bleed darkroom canvas container */}
      <div className="relative flex-1 w-full max-w-lg mx-auto overflow-hidden sm:my-3 sm:rounded-[32px] bg-zinc-950 flex flex-col justify-between">
        {/* LIVE CAMERA OR CAPTURED PREVIEW MEDIA LAYER */}
        <div className="absolute inset-0 bg-zinc-950 flex items-center justify-center overflow-hidden">
          {step === "camera" ? (
            cameraError ? (
              <div className="relative z-20 text-center p-6 text-white max-w-xs flex flex-col items-center">
                <div className="w-14 h-14 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mb-4">
                  <AlertCircle className="w-7 h-7 text-rose-400" />
                </div>
                <p className="text-base font-semibold mb-1.5">Camera Access Needed</p>
                <p className="text-xs text-zinc-400 mb-5 leading-relaxed">{cameraError}</p>
                <div className="flex flex-col gap-2.5 w-full">
                  <button
                    type="button"
                    onClick={() => startCamera(facingModeRef.current)}
                    className="h-11 px-4 bg-white text-black text-xs font-semibold rounded-full hover:bg-zinc-200 transition cursor-pointer"
                  >
                    Try Again
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-11 px-4 bg-white/10 text-white text-xs font-semibold rounded-full hover:bg-white/15 border border-white/10 transition cursor-pointer"
                  >
                    Choose from Gallery
                  </button>
                </div>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  poster={TRANSPARENT_POSTER}
                  onLoadedData={() => setIsCameraReady(true)}
                  onPlaying={() => setIsCameraReady(true)}
                  className={`w-full h-full object-cover transition-opacity duration-200 ${
                    isCameraReady ? (isSwitchingCamera ? "opacity-60" : "opacity-100") : "opacity-0"
                  } ${facingMode === "user" ? "-scale-x-100" : ""}`}
                />

                {/* Smooth darkroom shimmer while stream initializes — avoids WebView gray play icon */}
                {!isCameraReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 pointer-events-none">
                    <div className="w-10 h-10 rounded-full border-2 border-white/15 border-t-white/75 animate-spin" />
                  </div>
                )}

                {/* Selfie flash edge glow when flash is armed */}
                {flashOn && facingMode === "user" && isCameraReady && (
                  <div className="absolute inset-0 pointer-events-none border-[14px] border-amber-50/35 transition-opacity duration-200" />
                )}

                {/* Crisp shutter flash animation on capture */}
                {shutterFlash && (
                  <div className="absolute inset-0 bg-white/85 pointer-events-none z-30 transition-opacity duration-150" />
                )}
              </>
            )
          ) : (
            <div className="relative w-full h-full bg-black flex items-center justify-center">
              {previewUrl && mediaType === "video" && (
                <>
                  {videoPosterUrl && !isPreviewVideoReady && (
                    <img
                      src={videoPosterUrl}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  <video
                    key={previewUrl}
                    ref={previewVideoRef}
                    src={previewUrl}
                    poster={videoPosterUrl || TRANSPARENT_POSTER}
                    autoPlay
                    loop
                    playsInline
                    preload="auto"
                    muted={previewMuted}
                    onLoadedData={() => setIsPreviewVideoReady(true)}
                    onPlaying={() => setIsPreviewVideoReady(true)}
                    onError={() => setUploadError("Unable to play this video format on this device.")}
                    className={`w-full h-full object-contain sm:object-cover transition-opacity duration-200 ${
                      isPreviewVideoReady || videoPosterUrl ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  {!isPreviewVideoReady && !videoPosterUrl && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <Loader2 className="w-8 h-8 text-white/70 animate-spin" />
                    </div>
                  )}
                </>
              )}
              {previewUrl && mediaType === "image" && (
                <img
                  src={previewUrl}
                  alt="Captured preview"
                  className="w-full h-full object-contain sm:object-cover"
                />
              )}
            </div>
          )}
        </div>

        {/* TOP CONTRAST SCRIM + HEADER BAR */}
        <div className="relative z-20 bg-gradient-to-b from-black/75 via-black/35 to-transparent px-4 pt-safe pt-3 pb-8 flex items-center justify-between">
          <button
            type="button"
            onClick={step === "preview" ? handleRetake : onClose}
            disabled={isUploading}
            className="w-11 h-11 rounded-full bg-black/45 backdrop-blur-md text-white hover:bg-black/65 flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/10 disabled:opacity-50"
            title={step === "preview" ? "Retake" : "Close"}
            aria-label={step === "preview" ? "Retake" : "Close"}
          >
            {step === "preview" ? <ArrowLeft size={20} /> : <X size={20} />}
          </button>

          {/* Center Status: Clean Recipient Name OR Active Live Recording Clock */}
          {step === "camera" && isRecording ? (
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/65 backdrop-blur-md border border-white/15 text-white text-xs font-semibold tabular-nums shadow-lg">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <span>{formatTimer(recordingSeconds)}</span>
              <span className="text-white/40 text-[10px]">·</span>
              <span className="text-white/75 text-[11px] font-medium">
                {facingMode === "user" ? "Front" : "Back"}
              </span>
            </div>
          ) : (
            <div className="px-3.5 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white/95 text-xs font-semibold tracking-tight max-w-[180px] truncate">
              {step === "camera" ? `To ${recipientName}` : recipientName}
            </div>
          )}

          {/* Right Top Controls */}
          {step === "camera" ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFlashOn((prev) => !prev)}
                className={`w-11 h-11 rounded-full backdrop-blur-md flex items-center justify-center transition active:scale-95 cursor-pointer border ${
                  flashOn
                    ? "bg-amber-400 text-black border-amber-300"
                    : "bg-black/45 text-white hover:bg-black/65 border-white/10"
                }`}
                title={flashOn ? "Flash On" : "Flash Off"}
                aria-label="Toggle Flash"
              >
                {flashOn ? <Zap size={18} /> : <ZapOff size={18} />}
              </button>
              <button
                type="button"
                onClick={handleFlipCamera}
                disabled={isSwitchingCamera || Boolean(cameraError)}
                className="w-11 h-11 rounded-full bg-black/45 backdrop-blur-md text-white hover:bg-black/65 flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/10 disabled:opacity-50"
                title="Switch Camera"
                aria-label="Switch Camera"
              >
                <RefreshCw
                  size={18}
                  className="transition-transform duration-300"
                  style={{ transform: `rotate(${flipSpinCount * 180}deg)` }}
                />
              </button>
            </div>
          ) : mediaType === "video" ? (
            <button
              type="button"
              onClick={() => setPreviewMuted((m) => !m)}
              className="w-11 h-11 rounded-full bg-black/45 backdrop-blur-md text-white hover:bg-black/65 flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/10"
              title={previewMuted ? "Unmute" : "Mute"}
              aria-label={previewMuted ? "Unmute" : "Mute"}
            >
              {previewMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
          ) : (
            <div className="w-11" />
          )}
        </div>

        {/* BOTTOM CONTROL DECK */}
        <div className="relative z-20 bg-gradient-to-t from-black via-black/85 to-transparent pt-10 pb-safe pb-5 px-4">
          {uploadError && (
            <div className="mb-3 mx-auto max-w-md flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-100 text-xs">
              <AlertCircle size={14} className="shrink-0 text-rose-400" />
              <span className="truncate">{uploadError}</span>
            </div>
          )}

          {step === "camera" ? (
            <div className="flex flex-col gap-3.5">
              {/* Clean Photo / Video Segmented Mode Switcher (smoothly hides during active recording) */}
              <div
                className={`flex items-center justify-center transition-opacity duration-200 ${
                  isRecording ? "opacity-0 pointer-events-none" : "opacity-100"
                }`}
              >
                <div className="inline-flex items-center p-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10">
                  <button
                    type="button"
                    disabled={isRecording}
                    onClick={() => setCaptureMode("image")}
                    className={`h-8 px-4 rounded-full text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                      captureMode === "image"
                        ? "bg-white text-black shadow-sm"
                        : "text-white/80 hover:text-white"
                    }`}
                  >
                    <CameraIcon size={13} />
                    <span>Photo</span>
                  </button>
                  <button
                    type="button"
                    disabled={isRecording}
                    onClick={() => setCaptureMode("video")}
                    className={`h-8 px-4 rounded-full text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                      captureMode === "video"
                        ? "bg-rose-500 text-white shadow-sm"
                        : "text-white/80 hover:text-white"
                    }`}
                  >
                    <VideoIcon size={13} />
                    <span>Video</span>
                  </button>
                </div>
              </div>

              {/* Thumb-Zone Shutter Deck */}
              <div className="flex items-center justify-between px-4">
                {/* Gallery Picker */}
                <button
                  type="button"
                  disabled={isRecording}
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-12 h-12 rounded-2xl bg-white/12 border border-white/15 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/20 transition active:scale-95 cursor-pointer ${
                    isRecording ? "opacity-0 pointer-events-none" : "opacity-100"
                  }`}
                  title="Choose from Gallery"
                  aria-label="Choose from Gallery"
                >
                  <ImageIcon size={21} className="text-white/90" />
                </button>

                {/* Instagram Shutter Button */}
                <button
                  type="button"
                  disabled={!isCameraReady && !cameraError}
                  onPointerDown={handleShutterPointerDown}
                  onPointerUp={handleShutterPointerUp}
                  onPointerCancel={handleShutterPointerUp}
                  onPointerLeave={handleShutterPointerUp}
                  onClick={handleShutterClick}
                  className="relative w-20 h-20 rounded-full flex items-center justify-center cursor-pointer transition-transform active:scale-95 touch-none disabled:opacity-50"
                  title={
                    captureMode === "video"
                      ? isRecording
                        ? "Stop Recording"
                        : "Start Recording"
                      : "Tap for Photo · Hold for Video"
                  }
                  aria-label="Capture Photo or Video"
                >
                  <svg className="absolute inset-0 w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                    <circle
                      cx="40"
                      cy="40"
                      r="36"
                      fill="none"
                      stroke={isRecording ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.95)"}
                      strokeWidth="3.75"
                    />
                    {isRecording && (
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        fill="none"
                        stroke="#F43F5E"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                        strokeDasharray={ringCircumference}
                        strokeDashoffset={ringCircumference * (1 - recordingPct)}
                      />
                    )}
                  </svg>

                  {isRecording ? (
                    <div className="w-7 h-7 rounded-md bg-rose-500 shadow-lg flex items-center justify-center">
                      <Square size={13} className="text-white fill-white" />
                    </div>
                  ) : (
                    <div
                      className={`w-[60px] h-[60px] rounded-full transition-colors ${
                        captureMode === "video" ? "bg-rose-500" : "bg-white"
                      }`}
                    />
                  )}
                </button>

                {/* Live Flip Camera Button — stays enabled DURING active recording! */}
                <button
                  type="button"
                  disabled={isSwitchingCamera || Boolean(cameraError)}
                  onClick={handleFlipCamera}
                  className="w-12 h-12 rounded-full bg-white/12 border border-white/15 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/20 transition active:scale-95 cursor-pointer disabled:opacity-45"
                  title={isRecording ? "Switch Camera While Recording" : "Switch Camera"}
                  aria-label="Switch Camera"
                >
                  <RefreshCw
                    size={20}
                    className="text-white transition-transform duration-300"
                    style={{ transform: `rotate(${flipSpinCount * 180}deg)` }}
                  />
                </button>
              </div>

              <p className="text-center text-[11px] text-white/60 font-medium tracking-tight">
                {isRecording
                  ? "Tap flip anytime to switch front & back camera"
                  : captureMode === "video"
                  ? "Tap to record · Max 60s"
                  : "Tap for photo · Hold for video"}
              </p>
            </div>
          ) : (
            /* Preview Composer Dock */
            <div className="flex flex-col gap-3">
              {/* Cohesive Segmented Ephemeral Mode Selector */}
              <div className="grid grid-cols-3 gap-1 bg-zinc-900/90 border border-white/10 rounded-2xl p-1 backdrop-blur-xl">
                <button
                  type="button"
                  onClick={() => setViewMode("view_once")}
                  className={`h-9 px-2 rounded-xl text-[11.5px] font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    viewMode === "view_once"
                      ? "bg-[#0095F6] text-white shadow-sm"
                      : "text-zinc-300 hover:text-white"
                  }`}
                >
                  <span className="w-4 h-4 rounded-full border border-dashed border-current flex items-center justify-center text-[9px] font-black shrink-0">
                    1
                  </span>
                  <span className="truncate">View once</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("allow_replay")}
                  className={`h-9 px-2 rounded-xl text-[11.5px] font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    viewMode === "allow_replay"
                      ? "bg-white text-black shadow-sm"
                      : "text-zinc-300 hover:text-white"
                  }`}
                >
                  <RotateCcw size={12} className="shrink-0" />
                  <span className="truncate">Allow replay</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("keep_in_chat")}
                  className={`h-9 px-2 rounded-xl text-[11.5px] font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    viewMode === "keep_in_chat"
                      ? "bg-white text-black shadow-sm"
                      : "text-zinc-300 hover:text-white"
                  }`}
                >
                  <MessageSquare size={12} className="shrink-0" />
                  <span className="truncate">Keep in chat</span>
                </button>
              </div>

              {/* Clean Footer Bar: Mode Explanation + Send CTA */}
              <div className="flex items-center justify-between gap-3 pt-0.5">
                <span className="text-[12px] text-zinc-300 font-medium truncate pl-1">
                  {VIEW_MODE_META[viewMode].hint(noun)}
                </span>

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isUploading}
                  className="h-11 px-6 rounded-full bg-[#0095F6] hover:bg-[#1877F2] text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-[#0095F6]/25 active:scale-95 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
                >
                  {isUploading ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <span>Send</span>
                      <Send size={14} />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
