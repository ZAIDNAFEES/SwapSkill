import React, { useState, useRef, useEffect } from "react";
import { 
  Mic, 
  MicOff, 
  Video as VideoIcon, 
  VideoOff, 
  SwitchCamera,
  Volume2,
  VolumeX,
  Monitor, 
  MonitorOff, 
  PhoneOff, 
  MessageSquare, 
  MoreVertical, 
  FlipHorizontal,
  Users,
  Maximize2,
  Minimize2,
  Sparkles,
  ShieldCheck,
  Check,
  Settings,
  Headphones
} from "lucide-react";

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

export interface VideoDeviceOption {
  deviceId: string;
  label: string;
}

export interface CallControlsDockProps {
  isAudioMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  isMirrorLocal: boolean;
  facingMode: "user" | "environment";
  isSpeakerMuted?: boolean;
  audioOutputDevices?: AudioDeviceOption[];
  currentAudioOutputId?: string;
  videoDevices?: VideoDeviceOption[];
  currentVideoDeviceId?: string;
  showChat: boolean;
  chatUnreadCount: number;
  layoutMode: "pip" | "side-by-side";
  isFullscreen: boolean;
  isHdActive: boolean;
  videoQualityTier?: "1080p" | "720p" | "480p" | "360p" | "Auto";
  actualResolution?: { width: number; height: number } | null;
  isScreenShareSupported?: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onFlipCamera: () => void;
  onToggleSpeaker?: () => void;
  onSelectAudioOutput?: (deviceId: string) => void;
  onSelectVideoDevice?: (deviceId: string) => void;
  onToggleScreenShare: () => void;
  onToggleMirror: () => void;
  onToggleChat: () => void;
  onToggleLayout: () => void;
  onToggleFullscreen: () => void;
  onEndCall: () => void;
}

export const CallControlsDock: React.FC<CallControlsDockProps> = ({
  isAudioMuted,
  isVideoOff,
  isScreenSharing,
  isMirrorLocal,
  facingMode,
  isSpeakerMuted = false,
  audioOutputDevices = [],
  currentAudioOutputId,
  videoDevices = [],
  currentVideoDeviceId,
  showChat,
  chatUnreadCount,
  layoutMode,
  isFullscreen,
  isHdActive,
  videoQualityTier = "1080p",
  actualResolution,
  isScreenShareSupported = true,
  onToggleAudio,
  onToggleVideo,
  onFlipCamera,
  onToggleSpeaker,
  onSelectAudioOutput,
  onSelectVideoDevice,
  onToggleScreenShare,
  onToggleMirror,
  onToggleChat,
  onToggleLayout,
  onToggleFullscreen,
  onEndCall,
}) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
        setShowDeviceSettings(false);
      }
    };
    if (showMoreMenu || showDeviceSettings) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMoreMenu, showDeviceSettings]);

  return (
    <footer 
      className="w-full px-3 sm:px-6 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex items-center justify-center pointer-events-auto select-none transition-all duration-300"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Floating Glassmorphic Pill Dock */}
      <div 
        id="call-controls-dock"
        className="relative flex items-center gap-2 sm:gap-2.5 px-2.5 sm:px-4 py-2 rounded-full bg-[#101015]/85 backdrop-blur-2xl border border-white/15 shadow-2xl shadow-black/90 ring-1 ring-white/5 max-w-full overflow-x-auto no-scrollbar"
      >
        
        {/* 1. Microphone Toggle */}
        <div className="relative group">
          <button
            id="toggle-mic-btn"
            type="button"
            onClick={onToggleAudio}
            className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer shrink-0 ${
              isAudioMuted
                ? "bg-rose-500/25 text-rose-300 border border-rose-500/50 hover:bg-rose-500/35 shadow-md shadow-rose-500/15"
                : "bg-white/10 hover:bg-white/20 text-[#F7F4EE] border border-white/10 hover:border-white/25 shadow-sm"
            }`}
            title={isAudioMuted ? "Unmute microphone" : "Mute microphone"}
            aria-label={isAudioMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5 text-emerald-400" />}
          </button>
          <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-black/80 text-[10px] text-white opacity-0 group-hover:opacity-100 transition whitespace-nowrap shadow-sm">
            {isAudioMuted ? "Unmute" : "Mute"}
          </span>
        </div>

        {/* 2. Camera Toggle */}
        <div className="relative group">
          <button
            id="toggle-cam-btn"
            type="button"
            onClick={onToggleVideo}
            className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer shrink-0 ${
              isVideoOff
                ? "bg-rose-500/25 text-rose-300 border border-rose-500/50 hover:bg-rose-500/35 shadow-md shadow-rose-500/15"
                : "bg-white/10 hover:bg-white/20 text-[#F7F4EE] border border-white/10 hover:border-white/25 shadow-sm"
            }`}
            title={isVideoOff ? "Turn camera on" : "Turn camera off"}
            aria-label={isVideoOff ? "Turn camera on" : "Turn camera off"}
          >
            {isVideoOff ? <VideoOff className="w-5 h-5" /> : <VideoIcon className="w-5 h-5 text-[#C9A96E]" />}
          </button>
          <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-black/80 text-[10px] text-white opacity-0 group-hover:opacity-100 transition whitespace-nowrap shadow-sm">
            {isVideoOff ? "Start Video" : "Stop Video"}
          </span>
        </div>

        {/* 3. Flip Camera (Front / Rear) */}
        <div className="relative group">
          <button
            id="flip-camera-btn"
            type="button"
            onClick={onFlipCamera}
            disabled={isVideoOff}
            className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${
              facingMode === "environment"
                ? "bg-[#C9A96E]/25 text-[#C9A96E] border border-[#C9A96E]/40 shadow-sm"
                : "bg-white/10 hover:bg-white/20 text-[#F7F4EE] border border-white/10 hover:border-white/25 shadow-sm"
            }`}
            title={facingMode === "user" ? "Switch to Rear Camera" : "Switch to Front Camera"}
            aria-label="Flip Camera"
          >
            <SwitchCamera className="w-5 h-5" />
          </button>
          <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-black/80 text-[10px] text-white opacity-0 group-hover:opacity-100 transition whitespace-nowrap shadow-sm">
            Flip Camera
          </span>
        </div>

        {/* 4. Speaker / Audio Output Toggle */}
        {onToggleSpeaker && (
          <div className="relative group">
            <button
              id="toggle-speaker-btn"
              type="button"
              onClick={onToggleSpeaker}
              className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer shrink-0 ${
                isSpeakerMuted
                  ? "bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-sm"
                  : "bg-white/10 hover:bg-white/20 text-[#F7F4EE] border border-white/10 hover:border-white/25 shadow-sm"
              }`}
              title={isSpeakerMuted ? "Unmute partner audio" : "Mute partner audio"}
              aria-label={isSpeakerMuted ? "Unmute speaker" : "Mute speaker"}
            >
              {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-black/80 text-[10px] text-white opacity-0 group-hover:opacity-100 transition whitespace-nowrap shadow-sm">
              {isSpeakerMuted ? "Unmute Audio" : "Mute Audio"}
            </span>
          </div>
        )}

        {/* 5. Screen Share Toggle (Desktop / Supported Platforms) */}
        {isScreenShareSupported && (
          <div className="hidden sm:block relative group">
            <button
              id="toggle-screen-btn"
              type="button"
              onClick={onToggleScreenShare}
              className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer shrink-0 ${
                isScreenSharing
                  ? "bg-[#C9A96E] text-[#0A0A0E] border border-[#C9A96E] font-bold shadow-md shadow-[#C9A96E]/30"
                  : "bg-white/10 hover:bg-white/20 text-[#F7F4EE] border border-white/10 hover:border-white/25 shadow-sm"
              }`}
              title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
              aria-label={isScreenSharing ? "Stop sharing screen" : "Share screen"}
            >
              {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
            </button>
            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-black/80 text-[10px] text-white opacity-0 group-hover:opacity-100 transition whitespace-nowrap shadow-sm">
              {isScreenSharing ? "Stop Share" : "Share Screen"}
            </span>
          </div>
        )}

        {/* 6. In-Call Chat Drawer Toggle */}
        <div className="relative group">
          <button
            id="toggle-chat-btn"
            type="button"
            onClick={onToggleChat}
            className={`relative w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer shrink-0 ${
              showChat
                ? "bg-[#C9A96E] text-[#0A0A0E] border border-[#C9A96E] shadow-md shadow-[#C9A96E]/20"
                : "bg-white/10 hover:bg-white/20 text-[#F7F4EE] border border-white/10 hover:border-white/25 shadow-sm"
            }`}
            title="In-call chat"
            aria-label="In-call chat"
          >
            <MessageSquare className="w-5 h-5" />
            {chatUnreadCount > 0 && !showChat && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-[#101015]">
                {chatUnreadCount}
              </span>
            )}
          </button>
          <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-black/80 text-[10px] text-white opacity-0 group-hover:opacity-100 transition whitespace-nowrap shadow-sm">
            Chat
          </span>
        </div>

        {/* 7. More Options Dropdown */}
        <div ref={moreMenuRef} className="relative">
          <button
            id="more-call-options-btn"
            type="button"
            onClick={() => setShowMoreMenu((prev) => !prev)}
            className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer shrink-0 ${
              showMoreMenu
                ? "bg-white/25 text-white border border-white/30 shadow-md"
                : "bg-white/10 hover:bg-white/20 text-[#F7F4EE] border border-white/10 hover:border-white/25 shadow-sm"
            }`}
            title="More settings"
            aria-label="More settings"
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {/* More Menu Popover */}
          {showMoreMenu && (
            <div 
              className="absolute bottom-14 sm:bottom-16 right-0 sm:left-1/2 sm:-translate-x-1/2 w-64 bg-[#14141A]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150 text-xs select-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 border-b border-white/10 text-[10px] font-mono text-white/50 uppercase tracking-wider flex items-center justify-between">
                <span>Call Options</span>
                <span className="text-cyan-400 font-bold flex items-center gap-1 font-mono normal-case">
                  <Sparkles className="w-3 h-3 text-[#C9A96E]" />
                  <span>{videoQualityTier === "1080p" ? "1080p HD" : videoQualityTier === "720p" ? "720p HD" : videoQualityTier === "480p" ? "480p SD" : "360p"}</span>
                </span>
              </div>

              {/* Mobile Screen Share Option */}
              {isScreenShareSupported && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleScreenShare();
                    setShowMoreMenu(false);
                  }}
                  className="sm:hidden w-full px-3 py-2 mt-1 rounded-xl text-left text-white/90 hover:text-white hover:bg-white/10 flex items-center justify-between transition cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Monitor className="w-4 h-4 text-[#C9A96E]" />
                    <span>{isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}</span>
                  </div>
                </button>
              )}

              {/* Mirror Local Video */}
              <button
                type="button"
                onClick={() => {
                  onToggleMirror();
                  setShowMoreMenu(false);
                }}
                className="w-full px-3 py-2 mt-1 rounded-xl text-left text-white/90 hover:text-white hover:bg-white/10 flex items-center justify-between transition cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <FlipHorizontal className="w-4 h-4 text-[#C9A96E]" />
                  <span>Mirror Self View</span>
                </div>
                {isMirrorLocal && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </button>

              {/* Layout Switcher */}
              <button
                type="button"
                onClick={() => {
                  onToggleLayout();
                  setShowMoreMenu(false);
                }}
                className="w-full px-3 py-2 rounded-xl text-left text-white/90 hover:text-white hover:bg-white/10 flex items-center justify-between transition cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Users className="w-4 h-4 text-[#C9A96E]" />
                  <span>Layout: {layoutMode === "pip" ? "Grid View" : "PiP View"}</span>
                </div>
              </button>

              {/* Device Selector Submenu Toggle */}
              {(audioOutputDevices.length > 0 || videoDevices.length > 0) && (
                <button
                  type="button"
                  onClick={() => setShowDeviceSettings((prev) => !prev)}
                  className="w-full px-3 py-2 rounded-xl text-left text-white/90 hover:text-white hover:bg-white/10 flex items-center justify-between transition cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Settings className="w-4 h-4 text-[#C9A96E]" />
                    <span>Audio & Video Devices</span>
                  </div>
                </button>
              )}

              {/* Device Selector Expansion */}
              {showDeviceSettings && (
                <div className="p-2 bg-black/40 rounded-xl my-1 border border-white/10 space-y-2">
                  {audioOutputDevices.length > 0 && onSelectAudioOutput && (
                    <div>
                      <div className="text-[10px] text-white/50 mb-1 flex items-center gap-1 font-mono">
                        <Headphones className="w-3 h-3 text-[#C9A96E]" />
                        <span>Speaker / Output:</span>
                      </div>
                      <div className="space-y-1">
                        {audioOutputDevices.map((dev) => (
                          <button
                            key={dev.deviceId}
                            type="button"
                            onClick={() => {
                              onSelectAudioOutput(dev.deviceId);
                              setShowMoreMenu(false);
                            }}
                            className={`w-full text-left px-2 py-1 rounded text-[11px] truncate flex items-center justify-between ${
                              currentAudioOutputId === dev.deviceId
                                ? "bg-[#C9A96E]/20 text-[#C9A96E] font-medium"
                                : "text-white/70 hover:bg-white/10"
                            }`}
                          >
                            <span className="truncate">{dev.label || `Speaker ${dev.deviceId.slice(0, 5)}`}</span>
                            {currentAudioOutputId === dev.deviceId && <Check className="w-3 h-3 text-[#C9A96E] shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {videoDevices.length > 0 && onSelectVideoDevice && (
                    <div className="pt-1 border-t border-white/10">
                      <div className="text-[10px] text-white/50 mb-1 flex items-center gap-1 font-mono">
                        <VideoIcon className="w-3 h-3 text-[#C9A96E]" />
                        <span>Camera:</span>
                      </div>
                      <div className="space-y-1">
                        {videoDevices.map((dev) => (
                          <button
                            key={dev.deviceId}
                            type="button"
                            onClick={() => {
                              onSelectVideoDevice(dev.deviceId);
                              setShowMoreMenu(false);
                            }}
                            className={`w-full text-left px-2 py-1 rounded text-[11px] truncate flex items-center justify-between ${
                              currentVideoDeviceId === dev.deviceId
                                ? "bg-[#C9A96E]/20 text-[#C9A96E] font-medium"
                                : "text-white/70 hover:bg-white/10"
                            }`}
                          >
                            <span className="truncate">{dev.label || `Camera ${dev.deviceId.slice(0, 5)}`}</span>
                            {currentVideoDeviceId === dev.deviceId && <Check className="w-3 h-3 text-[#C9A96E] shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Fullscreen Toggle */}
              <button
                type="button"
                onClick={() => {
                  onToggleFullscreen();
                  setShowMoreMenu(false);
                }}
                className="w-full px-3 py-2 rounded-xl text-left text-white/90 hover:text-white hover:bg-white/10 flex items-center justify-between transition cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  {isFullscreen ? (
                    <>
                      <Minimize2 className="w-4 h-4 text-[#C9A96E]" />
                      <span>Exit Fullscreen</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-4 h-4 text-[#C9A96E]" />
                      <span>Fullscreen</span>
                    </>
                  )}
                </div>
              </button>

              <div className="px-3 py-2 mt-1 border-t border-white/10 text-[10px] text-white/40 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>LiveKit Encrypted</span>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/15 mx-0.5 shrink-0" />

        {/* 8. End Call Button (Visually separated, refined red pill/circular button) */}
        <div className="relative group">
          <button
            id="hangup-call-btn"
            type="button"
            onClick={onEndCall}
            className="h-11 sm:h-12 px-4 sm:px-5 rounded-full bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 shadow-lg shadow-rose-600/30 transition-all duration-200 active:scale-95 cursor-pointer border border-rose-400/40 shrink-0"
            title="End Live Swap"
            aria-label="End Live Swap"
          >
            <PhoneOff className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            <span>End</span>
          </button>
          <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-black/80 text-[10px] text-rose-300 opacity-0 group-hover:opacity-100 transition whitespace-nowrap shadow-sm">
            End Swap
          </span>
        </div>

      </div>
    </footer>
  );
};
