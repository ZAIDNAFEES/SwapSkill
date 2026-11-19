import React, { useEffect, useState, useRef, useMemo } from "react";
import { X, Clock, RotateCcw, Volume2, VolumeX, Play, Loader2, AlertCircle } from "lucide-react";
import { getCloudinaryVideoPlaybackCandidates } from "../../utils/imageCompressor";

const TRANSPARENT_POSTER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

interface ViewOnceViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  mediaUrl: string;
  imageUrl?: string;
  mediaType?: "image" | "video";
  viewMode?: "view_once" | "allow_replay" | "keep_in_chat";
  isReplay?: boolean;
  senderName: string;
  senderPhoto?: string;
  durationSeconds?: number;
}

export const ViewOnceViewerModal: React.FC<ViewOnceViewerModalProps> = ({
  isOpen,
  onClose,
  mediaUrl,
  imageUrl,
  mediaType = "image",
  viewMode = "view_once",
  isReplay = false,
  senderName,
  senderPhoto,
  durationSeconds = 7,
}) => {
  const effectiveUrl = mediaUrl || imageUrl || "";
  const isVideo =
    mediaType === "video" ||
    /^data:video\//i.test(effectiveUrl) ||
    /\.(mp4|webm|mov|m4v|3gp)(\?|$)/i.test(effectiveUrl) ||
    effectiveUrl.includes("/video/upload/");

  const videoCandidates = useMemo(
    () => (isVideo ? getCloudinaryVideoPlaybackCandidates(effectiveUrl) : []),
    [isVideo, effectiveUrl]
  );

  const [sourceIndex, setSourceIndex] = useState(0);
  const [retrySeed, setRetrySeed] = useState(0);
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [needsPlayTap, setNeedsPlayTap] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [videoLoadError, setVideoLoadError] = useState(false);

  const startTimeRef = useRef<number>(0);
  const elapsedBeforePauseRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const activeVideoSrc = videoCandidates[sourceIndex] || effectiveUrl;

  // Escape key to close immediately
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Reset viewer state cleanly on open or media change
  useEffect(() => {
    if (!isOpen) return;
    setSourceIndex(0);
    setRetrySeed(0);
    setProgress(100);
    setIsPaused(false);
    setIsMuted(false);
    setNeedsPlayTap(false);
    setIsVideoLoaded(false);
    setVideoLoadError(false);
    elapsedBeforePauseRef.current = 0;
  }, [isOpen, effectiveUrl]);

  // Countdown bar for PHOTOS (with hold-to-pause like Instagram)
  useEffect(() => {
    if (!isOpen || isVideo) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    if (isPaused) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const durationMs = durationSeconds * 1000;
    startTimeRef.current = performance.now() - elapsedBeforePauseRef.current;

    const tick = (now: number) => {
      const elapsed = now - startTimeRef.current;
      elapsedBeforePauseRef.current = elapsed;
      const remainingPct = Math.max(0, 100 - (elapsed / durationMs) * 100);
      setProgress(remainingPct);

      if (elapsed >= durationMs) {
        onCloseRef.current();
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen, isVideo, isPaused, durationSeconds]);

  // Attempt smooth video start once media is ready
  const attemptVideoPlay = (vid: HTMLVideoElement) => {
    if (isPaused) return;
    vid.play().catch(() => {
      // Autoplay with audio may be restricted on mobile browsers; retry muted cleanly
      vid.muted = true;
      setIsMuted(true);
      vid.play().catch(() => {
        if (vid.readyState >= 2) {
          setNeedsPlayTap(true);
        }
      });
    });
  };

  // Hold-to-pause video playback ONLY after video has loaded
  useEffect(() => {
    const vid = videoElRef.current;
    if (!isOpen || !isVideo || !vid || !isVideoLoaded) return;
    if (isPaused) {
      vid.pause();
    } else if (!needsPlayTap) {
      attemptVideoPlay(vid);
    }
  }, [isOpen, isVideo, isPaused, needsPlayTap, isVideoLoaded]);

  const handleVideoReady = () => {
    const vid = videoElRef.current;
    setIsVideoLoaded(true);
    setVideoLoadError(false);
    if (vid && !isPaused) {
      attemptVideoPlay(vid);
    }
  };

  const handleVideoError = () => {
    if (sourceIndex + 1 < videoCandidates.length) {
      setIsVideoLoaded(false);
      setNeedsPlayTap(false);
      setSourceIndex((prev) => prev + 1);
    } else {
      setIsVideoLoaded(false);
      setVideoLoadError(true);
    }
  };

  const handleRetryVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoLoadError(false);
    setNeedsPlayTap(false);
    setIsVideoLoaded(false);
    setSourceIndex(0);
    setRetrySeed((s) => s + 1);
  };

  const handleVideoTimeUpdate = () => {
    const vid = videoElRef.current;
    if (!vid || !vid.duration || !isFinite(vid.duration)) return;
    const remainingPct = Math.max(0, 100 - (vid.currentTime / vid.duration) * 100);
    setProgress(remainingPct);
  };

  const handleVideoTapToStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    const vid = videoElRef.current;
    if (!vid) return;
    vid.muted = isMuted;
    vid.play().then(() => setNeedsPlayTap(false)).catch(() => {});
  };

  if (!isOpen || !effectiveUrl) return null;

  const isAllowReplay = viewMode === "allow_replay";
  const badgeText = isAllowReplay
    ? isReplay
      ? `Final replay ${isVideo ? "video" : "photo"}`
      : `Allow replay ${isVideo ? "video" : "photo"}`
    : `View once ${isVideo ? "video" : "photo"}`;

  const footerText = isAllowReplay
    ? isReplay
      ? `${isVideo ? "Video" : "Photo"} will expire after this replay`
      : `Hold to pause · Can be replayed once`
    : `Hold to pause · ${isVideo ? "Video" : "Photo"} will disappear after viewing`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden select-none touch-none"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={() => {
        if (!isVideo || isVideoLoaded) setIsPaused(true);
      }}
      onPointerUp={() => setIsPaused(false)}
      onPointerCancel={() => setIsPaused(false)}
      onPointerLeave={() => setIsPaused(false)}
    >
      {/* TOP COUNTDOWN PROGRESS BAR (Instagram Story Style) */}
      <div className="relative z-30 w-full pt-safe px-3 sm:px-4 pt-3">
        <div className="w-full h-1 bg-white/25 rounded-full overflow-hidden">
          <div
            className="h-full bg-white transition-[width] duration-75"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* TOP HEADER */}
      <div
        className="relative z-30 flex items-center justify-between p-4 sm:p-5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          {senderPhoto ? (
            <img
              src={senderPhoto}
              alt={senderName}
              draggable={false}
              className="w-9 h-9 rounded-full object-cover border border-white/20 shadow-md"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#0095F6] to-purple-600 text-white font-bold flex items-center justify-center text-xs shadow-md">
              {senderName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white leading-tight">{senderName}</span>
              {isAllowReplay ? (
                <span className="w-4 h-4 rounded-full border border-amber-400 text-amber-400 flex items-center justify-center shrink-0">
                  <RotateCcw size={9} />
                </span>
              ) : (
                <span className="w-4 h-4 rounded-full border border-dashed border-[#0095F6] text-[#0095F6] flex items-center justify-center text-[9px] font-black shrink-0">
                  1
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-400 font-medium">{badgeText}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isVideo && (
            <button
              type="button"
              onClick={() => {
                const next = !isMuted;
                setIsMuted(next);
                if (videoElRef.current) videoElRef.current.muted = next;
              }}
              className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/10"
              title={isMuted ? "Unmute" : "Mute"}
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/10"
            title="Close"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* CENTER PHOTO OR VIDEO VIEWPORT */}
      <div className="relative flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
        {isVideo ? (
          <div className="relative w-full max-w-lg h-full max-h-[82vh] flex items-center justify-center rounded-2xl overflow-hidden bg-black">
            <video
              key={`${activeVideoSrc}_${retrySeed}`}
              ref={videoElRef}
              src={activeVideoSrc}
              poster={TRANSPARENT_POSTER}
              autoPlay
              playsInline
              preload="auto"
              controls={false}
              muted={isMuted}
              disableRemotePlayback
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              onLoadedData={handleVideoReady}
              onCanPlay={handleVideoReady}
              onPlaying={() => setIsVideoLoaded(true)}
              onError={handleVideoError}
              onTimeUpdate={handleVideoTimeUpdate}
              onEnded={() => onCloseRef.current()}
              className={`w-full h-full max-h-[82vh] object-contain rounded-2xl pointer-events-none transition-opacity duration-200 ${
                isVideoLoaded ? "opacity-100" : "opacity-0"
              }`}
            />

            {/* Solid black curtain while buffering/decoding prevents WebKit gray video placeholder */}
            {!isVideoLoaded && (
              <div className="absolute inset-0 z-10 bg-black flex flex-col items-center justify-center gap-3 p-6 text-center">
                {videoLoadError ? (
                  <>
                    <div className="w-12 h-12 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/80">
                      <AlertCircle size={22} />
                    </div>
                    <p className="text-sm font-medium text-white/90">Couldn&apos;t load video</p>
                    <button
                      type="button"
                      onClick={handleRetryVideo}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="h-10 px-5 rounded-full bg-white text-black text-xs font-semibold hover:bg-zinc-200 active:scale-95 transition cursor-pointer"
                    >
                      Tap to retry
                    </button>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-8 h-8 text-white/80 animate-spin" />
                    <span className="text-xs font-medium text-white/60">Loading video...</span>
                  </>
                )}
              </div>
            )}

            {isVideoLoaded && needsPlayTap && (
              <button
                type="button"
                onClick={handleVideoTapToStart}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute inset-0 z-20 m-auto w-16 h-16 rounded-full bg-black/70 border border-white/25 text-white flex items-center justify-center shadow-2xl cursor-pointer hover:scale-105 transition"
                aria-label="Play Video"
              >
                <Play size={28} className="fill-white ml-1" />
              </button>
            )}
          </div>
        ) : (
          <img
            src={effectiveUrl}
            alt="View Once"
            draggable={false}
            className="max-h-[82vh] max-w-full object-contain rounded-2xl shadow-2xl transition-transform pointer-events-none"
          />
        )}
      </div>

      {/* BOTTOM FOOTER */}
      <div className="relative z-30 p-4 pb-safe text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-zinc-300 text-[11px] font-medium tracking-wide">
          {isAllowReplay ? (
            <RotateCcw size={13} className="text-amber-400" />
          ) : (
            <Clock size={13} className="text-[#0095F6]" />
          )}
          <span>{footerText}</span>
        </div>
      </div>
    </div>
  );
};
