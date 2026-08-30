import React from "react";
import { Radio, Volume2, MicOff, Sparkles } from "lucide-react";
import { DEFAULT_AVATAR } from "../../types";

export interface CallAvatarViewProps {
  name: string;
  photo?: string;
  isSpeaking: boolean;
  isMuted?: boolean;
  isWaiting?: boolean;
  hasAudio?: boolean;
  customMessage?: string;
}

export const CallAvatarView: React.FC<CallAvatarViewProps> = ({
  name,
  photo,
  isSpeaking,
  isMuted = false,
  isWaiting = false,
  hasAudio = false,
  customMessage,
}) => {
  const avatarSrc = photo || DEFAULT_AVATAR;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center p-6 text-center overflow-hidden bg-radial from-[#15151B] via-[#0E0E12] to-[#08080A]">
      {/* Subtle ambient blurred color aura in background */}
      <div 
        className={`absolute inset-0 bg-gradient-to-tr from-[#C9A96E]/5 via-transparent to-cyan-500/5 pointer-events-none transition-opacity duration-700 ${
          isSpeaking ? "opacity-100 scale-105" : "opacity-40"
        }`} 
      />

      {/* Center Avatar Container with dynamic speaking ripples */}
      <div className="relative mb-4 flex items-center justify-center">
        {/* Active Speaking Ambient Wave Rings */}
        {isSpeaking && (
          <>
            <div className="absolute -inset-4 sm:-inset-6 rounded-full border border-emerald-400/40 animate-ping pointer-events-none" />
            <div className="absolute -inset-2 sm:-inset-3 rounded-full border border-emerald-400/60 animate-pulse pointer-events-none" />
          </>
        )}

        {isWaiting && (
          <div className="absolute -inset-3 sm:-inset-4 rounded-full border border-amber-400/30 animate-pulse pointer-events-none" />
        )}

        <div className={`relative w-24 h-24 sm:w-32 sm:h-32 rounded-full overflow-hidden shadow-2xl transition-all duration-300 ring-3 ${
          isSpeaking 
            ? "ring-emerald-400 scale-105 shadow-emerald-500/20" 
            : isWaiting 
            ? "ring-amber-400/60 shadow-amber-500/10" 
            : "ring-[#C9A96E]/30"
        }`}>
          <img
            src={avatarSrc}
            alt={name}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Audio Muted Micro-badge */}
        {isMuted && (
          <div className="absolute bottom-0 right-0 p-1.5 rounded-full bg-rose-600 text-white border-2 border-[#0A0A0E] shadow-md">
            <MicOff className="w-3.5 h-3.5" />
          </div>
        )}
      </div>

      {/* Name and State description */}
      <h3 className="text-base sm:text-lg font-bold text-[#F7F4EE] tracking-tight mb-1">
        {name}
      </h3>

      <div className="text-xs text-white/55 font-medium flex items-center justify-center gap-1.5 max-w-xs">
        {customMessage ? (
          <span>{customMessage}</span>
        ) : isWaiting ? (
          <span className="text-amber-400 flex items-center gap-1.5 animate-pulse">
            <Radio className="w-3.5 h-3.5" /> Waiting for partner to join...
          </span>
        ) : isSpeaking ? (
          <span className="text-emerald-400 flex items-center gap-1.5 font-semibold">
            <Volume2 className="w-3.5 h-3.5 animate-bounce" /> Speaking now
          </span>
        ) : hasAudio ? (
          <span className="text-white/70 flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> Camera off • Audio active
          </span>
        ) : (
          <span>Camera off</span>
        )}
      </div>
    </div>
  );
};
