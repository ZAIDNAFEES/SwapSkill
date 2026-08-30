import React, { useEffect, useRef, useState } from "react";
import { 
  Mic, 
  MicOff, 
  Video as VideoIcon, 
  VideoOff, 
  Clock, 
  Sparkles, 
  X, 
  ShieldCheck, 
  Radio, 
  ArrowRight,
  User
} from "lucide-react";
import { DEFAULT_AVATAR } from "../../types";

export interface PreCallLobbyProps {
  partnerName: string;
  partnerPhoto?: string;
  skillName?: string;
  sessionDuration?: number;
  currentUserName: string;
  currentUserPhoto?: string;
  isAudioMuted: boolean;
  isVideoOff: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onJoin: () => void;
  onClose: () => void;
}

export const PreCallLobby: React.FC<PreCallLobbyProps> = ({
  partnerName,
  partnerPhoto,
  skillName,
  sessionDuration = 30,
  currentUserName,
  currentUserPhoto,
  isAudioMuted,
  isVideoOff,
  onToggleAudio,
  onToggleVideo,
  onJoin,
  onClose,
}) => {
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Initialize Local Media Stream for Pre-Join Preview
  useEffect(() => {
    let isMounted = true;

    async function startPreviewStream() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: !isVideoOff
            ? {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 30 },
                facingMode: "user",
              }
            : false,
          audio: !isAudioMuted ? { echoCancellation: true, noiseSuppression: true } : false,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoPreviewRef.current && !isVideoOff) {
          videoPreviewRef.current.srcObject = stream;
        }

        // Set up Audio Level Meter
        if (!isAudioMuted && stream.getAudioTracks().length > 0) {
          try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioCtx) {
              const audioCtx = new AudioCtx();
              audioContextRef.current = audioCtx;
              const analyser = audioCtx.createAnalyser();
              analyser.fftSize = 64;
              analyserRef.current = analyser;

              const source = audioCtx.createMediaStreamSource(stream);
              source.connect(analyser);

              const dataArray = new Uint8Array(analyser.frequencyBinCount);

              const checkLevel = () => {
                if (!isMounted) return;
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                  sum += dataArray[i];
                }
                const average = sum / dataArray.length;
                const normalized = Math.min(100, Math.round((average / 128) * 100));
                setMicLevel(normalized);
                animationFrameRef.current = requestAnimationFrame(checkLevel);
              };
              checkLevel();
            }
          } catch (audioErr) {
            console.warn("[PreCallLobby] Could not set up audio analyzer:", audioErr);
          }
        }
      } catch (err) {
        console.warn("[PreCallLobby] Media preview access notice:", err);
      }
    }

    startPreviewStream();

    return () => {
      isMounted = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch (_) {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isAudioMuted, isVideoOff]);

  const handleJoinClick = () => {
    // Stop local preview tracks so LiveKit can seamlessly acquire clean device locks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    onJoin();
  };

  const handleCloseClick = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[99999] w-screen h-[100dvh] bg-[#0A0A0E] text-[#F7F4EE] flex flex-col justify-between overflow-y-auto select-none font-sans p-4 sm:p-6 md:p-8">
      {/* Background Subtle Ambient Aura */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_20%,rgba(201,169,110,0.06),transparent_60%)]" />

      {/* Top Bar: Brand & Close */}
      <header className="relative z-10 w-full max-w-5xl mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#14141A] border border-[#C9A96E]/30 flex items-center justify-center text-[#C9A96E]">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-[#F7F4EE]">SwapSkill</span>
            <span className="text-[10px] font-semibold text-[#C9A96E] bg-[#C9A96E]/10 px-2 py-0.5 rounded-full border border-[#C9A96E]/20">
              Live Room
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCloseClick}
          className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition active:scale-95 cursor-pointer border border-white/10"
          title="Close"
          aria-label="Close pre-call lobby"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      {/* Main Center Stage: Spacious & Focused Layout */}
      <main className="relative z-10 w-full max-w-4xl mx-auto my-auto py-6 sm:py-8 flex flex-col md:flex-row items-center justify-center gap-8 md:gap-12">
        
        {/* Left: Camera & Microphone Preview Card */}
        <div className="w-full max-w-sm sm:max-w-md flex flex-col items-center">
          <div className="relative w-full aspect-video rounded-3xl overflow-hidden bg-[#121217] border border-white/15 shadow-2xl shadow-black/80 flex items-center justify-center group">
            
            {/* Live Camera Video Feed */}
            {!isVideoOff ? (
              <video
                ref={videoPreviewRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-[#181820] to-[#0E0E14] text-center p-4">
                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3 ring-2 ring-[#C9A96E]/20">
                  <img
                    src={currentUserPhoto || DEFAULT_AVATAR}
                    alt={currentUserName}
                    className="w-full h-full rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <p className="text-xs font-semibold text-white/90">Camera is Off</p>
                <p className="text-[11px] text-white/50 mt-0.5">Toggle camera below to enable preview</p>
              </div>
            )}

            {/* Mic Level Live Visualizer Strip */}
            {!isAudioMuted && (
              <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center gap-1.5 text-[10px] font-mono text-white/80">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Mic Active</span>
                <div className="w-10 h-1.5 bg-white/20 rounded-full overflow-hidden ml-0.5">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-400 to-[#C9A96E] transition-all duration-75"
                    style={{ width: `${Math.max(10, micLevel)}%` }}
                  />
                </div>
              </div>
            )}

            {isAudioMuted && (
              <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-rose-500/20 backdrop-blur-md border border-rose-500/30 flex items-center gap-1.5 text-[10px] font-mono text-rose-300">
                <MicOff className="w-3 h-3" />
                <span>Muted</span>
              </div>
            )}

            {/* User label */}
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-semibold text-white/90">
              {currentUserName || "You"}
            </div>
          </div>

          {/* Media Device Quick Toggles */}
          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={onToggleAudio}
              className={`h-11 px-4 rounded-2xl flex items-center gap-2 text-xs font-semibold transition-all duration-200 active:scale-95 cursor-pointer border ${
                isAudioMuted
                  ? "bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30"
                  : "bg-white/10 hover:bg-white/15 text-[#F7F4EE] border-white/15 hover:border-white/30"
              }`}
              title={isAudioMuted ? "Unmute microphone" : "Mute microphone"}
            >
              {isAudioMuted ? <MicOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4 text-emerald-400" />}
              <span>{isAudioMuted ? "Muted" : "Mic On"}</span>
            </button>

            <button
              type="button"
              onClick={onToggleVideo}
              className={`h-11 px-4 rounded-2xl flex items-center gap-2 text-xs font-semibold transition-all duration-200 active:scale-95 cursor-pointer border ${
                isVideoOff
                  ? "bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30"
                  : "bg-white/10 hover:bg-white/15 text-[#F7F4EE] border-white/15 hover:border-white/30"
              }`}
              title={isVideoOff ? "Turn camera on" : "Turn camera off"}
            >
              {isVideoOff ? <VideoOff className="w-4 h-4 text-rose-400" /> : <VideoIcon className="w-4 h-4 text-[#C9A96E]" />}
              <span>{isVideoOff ? "Camera Off" : "Camera On"}</span>
            </button>
          </div>
        </div>

        {/* Right: Partner & Session Info Card */}
        <div className="w-full max-w-sm flex flex-col items-center md:items-start text-center md:text-left">
          
          {/* Partner Avatar & Status */}
          <div className="flex items-center gap-3.5 mb-4">
            <div className="relative">
              <img
                src={partnerPhoto || DEFAULT_AVATAR}
                alt={partnerName}
                className="w-14 h-14 rounded-2xl object-cover ring-2 ring-[#C9A96E]/40 shadow-lg"
                referrerPolicy="no-referrer"
              />
              <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 ring-2 ring-[#0A0A0E] animate-pulse" />
            </div>
            <div>
              <div className="text-xs text-white/50 font-medium">Ready to swap with</div>
              <h2 className="text-lg font-bold text-[#F7F4EE] tracking-tight truncate max-w-[220px]">
                {partnerName}
              </h2>
            </div>
          </div>

          {/* Session Overview Pills */}
          <div className="w-full bg-[#14141A] border border-white/10 rounded-2xl p-4 mb-6 space-y-2.5">
            {skillName && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/50 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#C9A96E]" /> Skill
                </span>
                <span className="font-semibold text-white/90 truncate max-w-[160px]">
                  {skillName}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs">
              <span className="text-white/50 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#C9A96E]" /> Duration
              </span>
              <span className="font-semibold text-[#C9A96E]">
                {sessionDuration} Minutes
              </span>
            </div>

            <div className="flex items-center justify-between text-xs pt-1 border-t border-white/5">
              <span className="text-white/50 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Security
              </span>
              <span className="text-emerald-400 font-mono text-[11px]">
                LiveKit Encrypted
              </span>
            </div>
          </div>

          {/* Primary Action Button */}
          <button
            id="join-live-swap-confirm-btn"
            type="button"
            onClick={handleJoinClick}
            className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#C9A96E] via-[#D5B980] to-[#C9A96E] hover:opacity-95 text-[#0A0A0E] font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-[#C9A96E]/20 transition-all duration-200 active:scale-98 cursor-pointer"
          >
            <span>Join Live Swap</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <p className="text-[11px] text-white/40 mt-3 text-center md:text-left">
            Camera and microphone can be toggled at any point during the session.
          </p>
        </div>

      </main>

      {/* Bottom Footer Note */}
      <footer className="relative z-10 w-full max-w-5xl mx-auto py-2 text-center text-[11px] text-white/40">
        SwapSkill Real-Time Video • Ultra-low latency LiveKit Cloud
      </footer>
    </div>
  );
};
