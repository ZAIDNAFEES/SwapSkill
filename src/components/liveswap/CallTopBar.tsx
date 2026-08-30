import React from "react";
import { ConnectionQuality } from "livekit-client";
import { 
  Sparkles, 
  Maximize2, 
  Minimize2, 
  Users, 
  MessageSquare,
  Activity,
  ShieldCheck
} from "lucide-react";
import { DEFAULT_AVATAR } from "../../types";

export interface CallTopBarProps {
  partnerName: string;
  partnerPhoto?: string;
  skillName?: string;
  hasRemoteParticipant: boolean;
  isPartnerSpeaking: boolean;
  connectionState: string;
  connectionQuality: ConnectionQuality;
  isHdActive: boolean;
  videoQualityTier?: "1080p" | "720p" | "480p" | "360p" | "Auto";
  actualResolution?: { width: number; height: number } | null;
  formattedDuration: string;
  formattedRemaining: string;
  remainingSeconds: number;
  layoutMode: "pip" | "side-by-side";
  setLayoutMode: React.Dispatch<React.SetStateAction<"pip" | "side-by-side">>;
  showChat: boolean;
  setShowChat: React.Dispatch<React.SetStateAction<boolean>>;
  chatUnreadCount: number;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onEndCall: () => void;
}

export const CallTopBar: React.FC<CallTopBarProps> = ({
  partnerName,
  partnerPhoto,
  skillName,
  hasRemoteParticipant,
  isPartnerSpeaking,
  connectionState,
  connectionQuality,
  isHdActive,
  videoQualityTier = "1080p",
  actualResolution,
  formattedRemaining,
  remainingSeconds,
  layoutMode,
  setLayoutMode,
  showChat,
  setShowChat,
  chatUnreadCount,
  isFullscreen,
  onToggleFullscreen,
}) => {
  // Translate connection quality to clean human readable status
  const getConnectionBadge = () => {
    if (connectionState === "reconnecting") {
      return { dot: "bg-amber-400 animate-ping", label: "Reconnecting…", color: "text-amber-400" };
    }
    if (connectionState === "joining") {
      return { dot: "bg-[#C9A96E] animate-pulse", label: "Connecting…", color: "text-[#C9A96E]" };
    }

    switch (connectionQuality) {
      case ConnectionQuality.Excellent:
        return { dot: "bg-emerald-400", label: "Excellent", color: "text-emerald-400" };
      case ConnectionQuality.Good:
        return { dot: "bg-emerald-400", label: "Good", color: "text-emerald-400" };
      case ConnectionQuality.Poor:
        return { dot: "bg-amber-400", label: "Fair", color: "text-amber-400" };
      case ConnectionQuality.Lost:
        return { dot: "bg-rose-400 animate-pulse", label: "Poor", color: "text-rose-400" };
      default:
        return { dot: "bg-emerald-400", label: "Good", color: "text-emerald-400" };
    }
  };

  const conn = getConnectionBadge();
  const isExpiringSoon = remainingSeconds <= 300; // <= 5 minutes

  return (
    <header className="relative z-30 w-full px-3 sm:px-6 py-2.5 sm:py-3 bg-[#0A0A0E]/75 backdrop-blur-xl border-b border-white/10 flex items-center justify-between gap-3 pointer-events-auto select-none transition-all duration-200">
      
      {/* 1. Left: Partner Info & Live Swap Badge */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <div className="relative shrink-0">
          <img
            src={partnerPhoto || DEFAULT_AVATAR}
            alt={partnerName}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover ring-1.5 ring-[#C9A96E]/50 shadow-sm"
            referrerPolicy="no-referrer"
          />
          <span 
            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ring-2 ring-[#0A0A0E] ${
              hasRemoteParticipant ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
            }`} 
          />
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-xs sm:text-sm font-bold text-[#F7F4EE] tracking-tight truncate max-w-[110px] sm:max-w-[180px]">
              {partnerName}
            </span>
            
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#C9A96E] bg-[#C9A96E]/10 px-2 py-0.5 rounded-full border border-[#C9A96E]/20 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E] animate-ping" />
              Live Swap
            </span>

            {skillName && (
              <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-white/70 bg-white/5 px-2 py-0.5 rounded-full border border-white/10 truncate max-w-[140px]">
                <Sparkles className="w-2.5 h-2.5 text-[#C9A96E]" />
                <span className="truncate">{skillName}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-white/60 mt-0.5">
            {/* Speaking Status or Connection state */}
            {isPartnerSpeaking ? (
              <span className="text-emerald-400 flex items-center gap-1 font-medium animate-pulse">
                <Activity className="w-3 h-3" /> Speaking
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${conn.dot}`} />
                <span className={conn.color}>{conn.label}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Center: Elegant Live Timer (● Live  63:34 remaining) */}
      <div className="flex items-center justify-center shrink-0">
        <div 
          className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 rounded-full backdrop-blur-md border transition-all duration-300 ${
            isExpiringSoon
              ? "bg-amber-500/15 border-amber-500/40 text-amber-300 animate-pulse shadow-md shadow-amber-500/10"
              : "bg-white/5 border-white/10 text-[#F7F4EE]"
          }`}
          title={isExpiringSoon ? "Less than 5 minutes remaining in session" : "Scheduled duration countdown"}
        >
          <span className={`w-2 h-2 rounded-full ${isExpiringSoon ? "bg-amber-400 animate-ping" : "bg-emerald-400"}`} />
          <span className="text-[11px] sm:text-xs font-semibold text-[#C9A96E]">Live</span>
          <span className="text-[11px] sm:text-xs font-mono font-medium tracking-tight">
            {formattedRemaining}
          </span>
          <span className="hidden sm:inline text-[10px] text-white/50">remaining</span>
        </div>
      </div>

      {/* 3. Right: Controls & HD Badge */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        
        {/* Dynamic Quality Indicator Badge (1080p HD / 720p HD / 480p SD / 360p) */}
        <div 
          className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-semibold bg-white/5 border border-white/10 text-white/90 shadow-sm"
          title={`Adaptive Video Quality: ${
            actualResolution 
              ? `${actualResolution.width}x${actualResolution.height} @ 30fps` 
              : videoQualityTier === "1080p" ? "1920x1080 Full HD @ 30fps" : `${videoQualityTier} Adaptive`
          }`}
        >
          <span 
            className={`w-1.5 h-1.5 rounded-full ${
              videoQualityTier === "1080p" 
                ? "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" 
                : videoQualityTier === "720p" 
                  ? "bg-emerald-400" 
                  : "bg-amber-400"
            }`} 
          />
          <span className="font-mono font-medium tracking-tight">
            {videoQualityTier === "1080p" ? "1080p HD" : videoQualityTier === "720p" ? "720p HD" : videoQualityTier === "480p" ? "480p SD" : "360p"}
          </span>
        </div>

        {/* Layout Switcher (PiP vs Side-by-Side) */}
        <button
          type="button"
          onClick={() => setLayoutMode((prev) => (prev === "pip" ? "side-by-side" : "pip"))}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-white/70 hover:text-white border border-white/10 text-[11px] font-medium transition cursor-pointer"
          title={layoutMode === "pip" ? "Switch to Side-by-Side View" : "Switch to Picture-in-Picture"}
          aria-label="Toggle layout"
        >
          <Users className="w-3.5 h-3.5 text-[#C9A96E]" />
          <span>{layoutMode === "pip" ? "Grid" : "PiP"}</span>
        </button>

        {/* In-Call Chat Drawer Toggle */}
        <button
          type="button"
          onClick={() => setShowChat((prev) => !prev)}
          className={`relative p-2 rounded-xl border transition active:scale-95 cursor-pointer ${
            showChat 
              ? "bg-[#C9A96E] text-[#0A0A0E] border-[#C9A96E] shadow-md shadow-[#C9A96E]/20" 
              : "bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border-white/10"
          }`}
          title="Open in-call messages"
          aria-label="Toggle in-call chat"
        >
          <MessageSquare className="w-4 h-4" />
          {chatUnreadCount > 0 && !showChat && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-[#0A0A0E]">
              {chatUnreadCount}
            </span>
          )}
        </button>

        {/* Fullscreen Toggle */}
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="hidden sm:flex p-2 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-white/70 hover:text-white border border-white/10 transition cursor-pointer"
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          aria-label="Toggle fullscreen"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

    </header>
  );
};
