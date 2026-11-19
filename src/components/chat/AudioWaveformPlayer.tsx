import React, { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause } from "lucide-react";
import { safeLocalStorage } from "../../utils/safeStorage";

interface AudioWaveformPlayerProps {
  src: string;
  isSelf?: boolean;
}

// Global speed preference (saved across session just like WhatsApp)
const PLAYBACK_SPEEDS = [1, 1.5, 2];

export const AudioWaveformPlayer: React.FC<AudioWaveformPlayerProps> = ({ src, isSelf = false }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(() => {
    try {
      const saved = safeLocalStorage.getItem("swapskill_voice_speed");
      if (saved) {
        const parsed = parseFloat(saved);
        if (PLAYBACK_SPEEDS.includes(parsed)) return parsed;
      }
    } catch (_) {}
    return 1;
  });

  const [isScrubbing, setIsScrubbing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformContainerRef = useRef<HTMLDivElement | null>(null);

  // High-fidelity natural soundwave heights
  const waveBars = React.useMemo(() => [
    18, 32, 24, 45, 70, 42, 60, 48, 30, 36,
    55, 68, 38, 48, 26, 42, 60, 78, 55, 36,
    30, 48, 65, 42, 26, 52, 36, 20, 30, 48,
    34, 22
  ], []);

  // Sync audio element instance
  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.playbackRate = playbackRate;

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      if (!isScrubbing) {
        setCurrentTime(audio.currentTime);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    // Single-audio enforcement: pause this player if another audio starts playing
    const handleGlobalAudioPlay = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.audioId !== src && isPlaying) {
        audio.pause();
        setIsPlaying(false);
      }
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    window.addEventListener("swapskill_audio_play", handleGlobalAudioPlay);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      window.removeEventListener("swapskill_audio_play", handleGlobalAudioPlay);
    };
  }, [src]);

  // Apply playback rate changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
    safeLocalStorage.setItem("swapskill_voice_speed", playbackRate.toString());
  }, [playbackRate]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      window.dispatchEvent(
        new CustomEvent("swapskill_audio_play", { detail: { audioId: src } })
      );
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((e) => console.warn("Audio playback notice:", e));
    }
  };

  const handleCycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    const nextSpeed = PLAYBACK_SPEEDS[nextIndex];
    setPlaybackRate(nextSpeed);
  };

  // Interactive scrubbing / drag-to-seek
  const calculateSeekTime = useCallback(
    (clientX: number): number => {
      if (!waveformContainerRef.current || !duration) return 0;
      const rect = waveformContainerRef.current.getBoundingClientRect();
      const relativeX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const ratio = relativeX / rect.width;
      return ratio * duration;
    },
    [duration]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (!audioRef.current || !duration) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}

    setIsScrubbing(true);
    const newTime = calculateSeekTime(e.clientX);
    setCurrentTime(newTime);
    audioRef.current.currentTime = newTime;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing || !audioRef.current || !duration) return;
    e.stopPropagation();
    const newTime = calculateSeekTime(e.clientX);
    setCurrentTime(newTime);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}

    setIsScrubbing(false);
    if (audioRef.current && duration) {
      const newTime = calculateSeekTime(e.clientX);
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div
      className={`flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 rounded-2xl border transition-colors select-none w-full min-w-0 max-w-[270px] sm:max-w-xs mt-1 ${
        isSelf
          ? "bg-black/15 dark:bg-white/[0.08] border-black/10 dark:border-white/[0.08] text-inherit shadow-inner"
          : "bg-zinc-800/80 border-zinc-700/60 text-white shadow-xs"
      }`}
    >
      {/* Play / Pause Circular Button */}
      <button
        type="button"
        onClick={togglePlay}
        className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#D4AF37] hover:bg-[#c49f2e] active:scale-95 text-black flex items-center justify-center shrink-0 shadow-md shadow-[#D4AF37]/20 transition-all cursor-pointer"
        aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
      >
        {isPlaying ? (
          <Pause size={14} fill="currentColor" />
        ) : (
          <Play size={14} fill="currentColor" className="ml-0.5" />
        )}
      </button>

      {/* Waveform & Scrubber */}
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <div
          ref={waveformContainerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative flex items-center gap-[2.5px] h-7 w-full cursor-pointer touch-none py-1 group"
        >
          {waveBars.map((height, idx) => {
            const barPercent = (idx / waveBars.length) * 100;
            const isPlayed = barPercent <= progressPercent;

            return (
              <div
                key={idx}
                style={{ height: `${height}%` }}
                className={`flex-1 rounded-full transition-colors duration-100 min-w-[2px] ${
                  isPlayed
                    ? "bg-[#D4AF37]"
                    : isSelf
                    ? "bg-black/25 dark:bg-white/25"
                    : "bg-zinc-600"
                }`}
              />
            );
          })}
        </div>

        {/* Timers & Playback Speed Controls */}
        <div className="flex items-center justify-between text-[10.5px] font-mono tabular-nums opacity-80 mt-0.5 px-0.5">
          <span>{formatTime(currentTime)}</span>
          <div className="flex items-center gap-1.5">
            <span>{formatTime(duration)}</span>
            <button
              type="button"
              onClick={handleCycleSpeed}
              title="Change voice playback speed (1x, 1.5x, 2x)"
              className="px-1.5 py-0.5 rounded-full text-[9px] font-bold font-sans tracking-wide bg-black/20 dark:bg-white/20 hover:bg-black/30 dark:hover:bg-white/30 border border-white/10 active:scale-95 transition cursor-pointer"
            >
              {playbackRate}x
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioWaveformPlayer;
