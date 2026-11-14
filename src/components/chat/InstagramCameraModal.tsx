import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  RotateCcw,
  SwitchCamera,
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

  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [mediaType, setMediaType] = useState<EphemeralMediaType>("image");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMuted, setPreviewMuted] = useState(false);

  const [viewMode, setViewMode] = useState<ViewOnceMode>("view_once");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Video recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartedRecordingRef = useRef<boolean>(false);
  const previewUrlRef = useRef<string | null>(null);

  // Stop active recording timer cleanly
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

  // Stop camera stream tracks safely
  const stopStream = useCallback(() => {
    clearRecordingTimer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (_) {}
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [clearRecordingTimer]);

  // Start camera stream (with mic when available so video recording has audio)
  const startCamera = useCallback(async () => {
    stopStream();
    setCameraError(null);
    setIsRecording(false);
    setRecordingSeconds(0);
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (_) {
      // Fallback without audio or minimal video constraint
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        });
        streamRef.current = fallbackStream;
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          videoRef.current.play().catch(() => {});
        }
      } catch (e: any) {
        try {
          const basicStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          streamRef.current = basicStream;
          if (videoRef.current) {
            videoRef.current.srcObject = basicStream;
            videoRef.current.play().catch(() => {});
          }
        } catch (finalErr: any) {
          setCameraError(finalErr?.message || e?.message || "Camera access was denied or is unavailable.");
        }
      }
    }
  }, [facingMode, stopStream]);

  // Keep previewUrlRef synced for safe cleanup on unmount/close
  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  // Lifecycle when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setStep("camera");
      setCaptureMode("image");
      setMediaType("image");
      setViewMode("view_once");
      setCapturedBlob(null);
      setPreviewMuted(false);
      setUploadError(null);
      setIsUploading(false);
      setIsRecording(false);
      setRecordingSeconds(0);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        setPreviewUrl(null);
      }
      startCamera();
    } else {
      stopStream();
      setIsRecording(false);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        setPreviewUrl(null);
      }
    }
    return () => {
      stopStream();
    };
  }, [isOpen, startCamera, stopStream]);

  // Handle switching camera (Front / Back)
  const handleFlipCamera = () => {
    if (isRecording) return;
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  };

  // Capture photo from live feed
  const handleCapturePhoto = () => {
    if (!videoRef.current) return;
    try {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (facingMode === "user") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            stopStream();
            const url = URL.createObjectURL(blob);
            setCapturedBlob(blob);
            setMediaType("image");
            setPreviewUrl(url);
            setUploadError(null);
            setStep("preview");
          }
        },
        "image/jpeg",
        0.95
      );
    } catch (e) {
      console.error("[InstagramCamera] Failed to capture photo:", e);
    }
  };

  // Start live video recording
  const startVideoRecording = () => {
    if (!streamRef.current || isRecording) return;
    if (typeof MediaRecorder === "undefined") {
      setUploadError("Video recording is not supported on this browser. Try picking a video from gallery.");
      return;
    }

    try {
      const preferredTypes = [
        "video/mp4;codecs=avc1,mp4a",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ];
      const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: 1_500_000, // 1.5 Mbps crisp 720p clarity without HD/4K bloat
        audioBitsPerSecond: 96_000,
        ...(mimeType ? { mimeType } : {}),
      };
      const recorder = new MediaRecorder(streamRef.current, recorderOptions);

      recordedChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        clearRecordingTimer();
        setIsRecording(false);
        const chunks = recordedChunksRef.current;
        if (!chunks || chunks.length === 0) return;

        const outType = mimeType || chunks[0]?.type || "video/webm";
        const blob = new Blob(chunks, { type: outType });
        if (blob.size < 1024) return;

        stopStream();
        const url = URL.createObjectURL(blob);
        setCapturedBlob(blob);
        setMediaType("video");
        setPreviewMuted(false);
        setPreviewUrl(url);
        setUploadError(null);
        setStep("preview");
      };

      mediaRecorderRef.current = recorder;
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
      setUploadError(err?.message || "Could not start video recording.");
      setIsRecording(false);
    }
  };

  const stopVideoRecording = () => {
    clearRecordingTimer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (_) {}
    }
  };

  // Instagram Shutter Interactions:
  // - In Video mode: tap to start/stop recording
  // - In Photo mode: quick tap = photo, hold >= 280ms = record video until release
  const handleShutterPointerDown = () => {
    if (cameraError) return;
    if (captureMode === "video") return; // Handled on click for crisp toggle
    holdStartedRecordingRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      holdStartedRecordingRef.current = true;
      startVideoRecording();
    }, 280);
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
    if (cameraError) return;
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

  // Handle photo OR video selected from device gallery
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
      setPreviewMuted(false);
      setPreviewUrl(url);
      setUploadError(null);
      setStep("preview");
    }
    if (e.target) e.target.value = "";
  };

  // Cycle view mode toggle (Instagram Style: View Once -> Allow Replay -> Keep in Chat)
  const cycleViewMode = () => {
    setViewMode((current) => {
      if (current === "view_once") return "allow_replay";
      if (current === "allow_replay") return "keep_in_chat";
      return "view_once";
    });
  };

  // Retake / go back to camera
  const handleRetake = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      setPreviewUrl(null);
    }
    setCapturedBlob(null);
    setUploadError(null);
    setStep("camera");
    startCamera();
  };

  // Send photo or video
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
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden select-none">
      {/* Hidden file input for picking Photo OR Video from gallery */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleGallerySelect}
      />

      {/* FLASH SIMULATION SCREEN TINT */}
      {flashOn && step === "camera" && (
        <div className="absolute inset-0 bg-white/20 pointer-events-none z-10" />
      )}

      {/* TOP HEADER CONTROLS */}
      <div className="relative z-20 flex items-center justify-between p-4 pt-safe sm:p-5">
        <button
          type="button"
          onClick={step === "preview" ? handleRetake : onClose}
          disabled={isUploading}
          className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/10 disabled:opacity-50"
          title={step === "preview" ? "Retake" : "Close"}
          aria-label={step === "preview" ? "Retake" : "Close"}
        >
          <X size={20} />
        </button>

        {/* Center Mode Header / Live Recording Timer */}
        {isRecording ? (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-600/90 backdrop-blur-md border border-rose-400/40 text-white text-xs font-bold tracking-wider tabular-nums shadow-lg">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span>{formatTimer(recordingSeconds)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-white text-[11px] font-semibold tracking-wider uppercase">
            <span className="w-2 h-2 rounded-full bg-[#0095F6]" />
            <span>
              {step === "camera"
                ? `To ${recipientName}`
                : mediaType === "video"
                ? "Video Preview"
                : "Photo Preview"}
            </span>
          </div>
        )}

        {/* Right Top Action */}
        {step === "camera" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFlashOn((prev) => !prev)}
              className={`w-10 h-10 rounded-full backdrop-blur-md flex items-center justify-center transition active:scale-95 cursor-pointer border ${
                flashOn
                  ? "bg-amber-400 text-black border-amber-300"
                  : "bg-black/50 text-white hover:bg-black/70 border-white/10"
              }`}
              title="Flash"
              aria-label="Toggle Flash"
            >
              {flashOn ? <Zap size={18} /> : <ZapOff size={18} />}
            </button>
            <button
              type="button"
              onClick={handleFlipCamera}
              disabled={isRecording}
              className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/10 disabled:opacity-40"
              title="Flip Camera"
              aria-label="Flip Camera"
            >
              <SwitchCamera size={19} />
            </button>
          </div>
        ) : mediaType === "video" ? (
          <button
            type="button"
            onClick={() => setPreviewMuted((m) => !m)}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/10"
            title={previewMuted ? "Unmute" : "Mute"}
            aria-label={previewMuted ? "Unmute" : "Mute"}
          >
            {previewMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      {/* CENTER VIEWFINDER / PREVIEW AREA */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden w-full max-w-lg mx-auto px-2 sm:px-4">
        {step === "camera" ? (
          <div className="relative w-full h-full max-h-[76vh] rounded-3xl overflow-hidden bg-zinc-950 border border-white/10 shadow-2xl flex items-center justify-center">
            {cameraError ? (
              <div className="text-center p-6 text-white max-w-xs flex flex-col items-center">
                <AlertCircle className="w-10 h-10 text-rose-500 mb-3" />
                <p className="text-sm font-semibold mb-2">Camera Unavailable</p>
                <p className="text-xs text-zinc-400 mb-4">{cameraError}</p>
                <div className="flex flex-col gap-2 w-full">
                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-4 py-2 bg-white text-black text-xs font-semibold rounded-xl hover:bg-zinc-200 transition cursor-pointer"
                  >
                    Retry Camera
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-zinc-800 text-white text-xs font-semibold rounded-xl hover:bg-zinc-700 transition cursor-pointer"
                  >
                    Choose Photo / Video
                  </button>
                </div>
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${facingMode === "user" ? "-scale-x-100" : ""}`}
              />
            )}
          </div>
        ) : (
          <div className="relative w-full h-full max-h-[76vh] rounded-3xl overflow-hidden bg-black border border-white/10 shadow-2xl flex items-center justify-center">
            {previewUrl && mediaType === "video" && (
              <video
                src={previewUrl}
                autoPlay
                loop
                playsInline
                muted={previewMuted}
                className="w-full h-full object-contain sm:object-cover"
              />
            )}
            {previewUrl && mediaType === "image" && (
              <img
                src={previewUrl}
                alt="Captured Preview"
                className="w-full h-full object-contain sm:object-cover"
              />
            )}
          </div>
        )}
      </div>

      {/* INLINE ERROR BANNER IF ANY */}
      {uploadError && (
        <div className="relative z-20 mx-auto max-w-md px-4 mt-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs">
            <AlertCircle size={14} className="shrink-0 text-rose-400" />
            <span className="truncate">{uploadError}</span>
          </div>
        </div>
      )}

      {/* BOTTOM CONTROLS BAR */}
      <div className="relative z-20 p-4 pb-safe sm:p-6 w-full max-w-lg mx-auto">
        {step === "camera" ? (
          <div className="flex flex-col gap-3">
            {/* Photo / Video Switcher */}
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={isRecording}
                onClick={() => setCaptureMode("image")}
                className={`px-3.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer ${
                  captureMode === "image"
                    ? "bg-white text-black shadow-md"
                    : "bg-white/10 text-white/75 hover:bg-white/20"
                }`}
              >
                <CameraIcon size={12} />
                <span>Photo</span>
              </button>
              <button
                type="button"
                disabled={isRecording}
                onClick={() => setCaptureMode("video")}
                className={`px-3.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer ${
                  captureMode === "video"
                    ? "bg-rose-500 text-white shadow-md shadow-rose-500/30"
                    : "bg-white/10 text-white/75 hover:bg-white/20"
                }`}
              >
                <VideoIcon size={12} />
                <span>Video</span>
              </button>
            </div>

            <div className="flex items-center justify-between px-6">
              {/* Gallery Picker Button (Photo or Video) */}
              <button
                type="button"
                disabled={isRecording}
                onClick={() => fileInputRef.current?.click()}
                className="w-12 h-12 rounded-2xl bg-zinc-900/80 border border-white/15 flex items-center justify-center text-white hover:bg-zinc-800 transition active:scale-95 cursor-pointer shadow-md disabled:opacity-40"
                title="Pick Photo or Video from Gallery"
                aria-label="Pick Photo or Video from Gallery"
              >
                <ImageIcon size={22} className="text-white/80" />
              </button>

              {/* Instagram Style Shutter (Tap = Photo, Hold or Video mode = Record) */}
              <button
                type="button"
                onPointerDown={handleShutterPointerDown}
                onPointerUp={handleShutterPointerUp}
                onPointerCancel={handleShutterPointerUp}
                onPointerLeave={handleShutterPointerUp}
                onClick={handleShutterClick}
                className="relative w-20 h-20 rounded-full flex items-center justify-center cursor-pointer transition active:scale-95 touch-none"
                title={
                  captureMode === "video"
                    ? isRecording
                      ? "Stop Recording"
                      : "Start Recording Video"
                    : "Tap for Photo • Hold for Video"
                }
                aria-label="Capture Photo or Video"
              >
                {/* Animated Recording Progress SVG Ring */}
                <svg className="absolute inset-0 w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    fill="none"
                    stroke={isRecording ? "rgba(255,255,255,0.25)" : "white"}
                    strokeWidth="4"
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

                {/* Inner Disc / Stop Square */}
                {isRecording ? (
                  <div className="w-7 h-7 rounded-md bg-rose-500 shadow-lg flex items-center justify-center">
                    <Square size={14} className="text-white fill-white" />
                  </div>
                ) : (
                  <div
                    className={`w-14 h-14 rounded-full shadow-inner transition-transform ${
                      captureMode === "video" ? "bg-rose-500" : "bg-white"
                    }`}
                  />
                )}
              </button>

              {/* Flip Camera Button */}
              <button
                type="button"
                disabled={isRecording}
                onClick={handleFlipCamera}
                className="w-12 h-12 rounded-2xl bg-zinc-900/80 border border-white/15 flex items-center justify-center text-white hover:bg-zinc-800 transition active:scale-95 cursor-pointer shadow-md disabled:opacity-40"
                title="Flip Camera"
                aria-label="Flip Camera"
              >
                <RotateCcw size={21} className="text-white/80" />
              </button>
            </div>

            <p className="text-center text-[10.5px] text-zinc-400 font-medium">
              {captureMode === "video"
                ? isRecording
                  ? "Tap stop to finish recording"
                  : "Tap to record video (max 60s)"
                : "Tap for photo · Hold for video"}
            </p>
          </div>
        ) : (
          /* Preview Controls: Instagram View Mode Selector + Send Button */
          <div className="flex flex-col gap-3">
            {/* Quick Instagram 3-Mode Tab Strip */}
            <div className="flex items-center justify-center gap-1.5 bg-zinc-900/80 border border-white/10 rounded-full p-1">
              <button
                type="button"
                onClick={() => setViewMode("view_once")}
                className={`flex-1 py-1.5 px-2.5 rounded-full text-[11px] font-bold tracking-wide transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  viewMode === "view_once"
                    ? "bg-[#0095F6] text-white shadow-sm"
                    : "text-zinc-300 hover:text-white"
                }`}
              >
                <span className="w-4 h-4 rounded-full border border-dashed border-current flex items-center justify-center text-[9px] font-black">
                  1
                </span>
                <span>View once</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("allow_replay")}
                className={`flex-1 py-1.5 px-2.5 rounded-full text-[11px] font-bold tracking-wide transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  viewMode === "allow_replay"
                    ? "bg-amber-500 text-black shadow-sm"
                    : "text-zinc-300 hover:text-white"
                }`}
              >
                <RotateCcw size={12} />
                <span>Allow replay</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("keep_in_chat")}
                className={`flex-1 py-1.5 px-2.5 rounded-full text-[11px] font-bold tracking-wide transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  viewMode === "keep_in_chat"
                    ? "bg-white text-black shadow-sm"
                    : "text-zinc-300 hover:text-white"
                }`}
              >
                <MessageSquare size={12} />
                <span>Keep in chat</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              {/* Subtext explanation (Tap pill to cycle too) */}
              <button
                type="button"
                onClick={cycleViewMode}
                className="flex-1 text-left px-3 py-2 rounded-full bg-zinc-900/60 border border-white/10 text-[11.5px] text-zinc-200 font-medium cursor-pointer hover:bg-zinc-900/90 transition truncate"
              >
                {viewMode === "view_once" && `Recipient can view this ${noun} once`}
                {viewMode === "allow_replay" && `Recipient can replay this ${noun} once`}
                {viewMode === "keep_in_chat" && `${mediaType === "video" ? "Video" : "Photo"} stays in chat & gallery`}
              </button>

              {/* INSTAGRAM SEND BUTTON */}
              <button
                type="button"
                onClick={handleSend}
                disabled={isUploading}
                className="h-11 px-5 rounded-full bg-[#0095F6] hover:bg-[#1877F2] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-[#0095F6]/30 active:scale-95 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
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
  );
};
