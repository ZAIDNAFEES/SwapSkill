import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  Phone, 
  Video, 
  Search, 
  Bell, 
  BellOff, 
  Pin, 
  Palette, 
  Star, 
  Image as ImageIcon, 
  ShieldCheck, 
  Ban, 
  ShieldAlert, 
  ChevronRight, 
  Lock, 
  Sparkles, 
  Copy, 
  Check, 
  Share2, 
  ArrowUpRight, 
  CheckCircle2, 
  MapPin,
  ExternalLink,
  MessageSquare
} from "lucide-react";
import { SmartImage } from "../SmartImage";
import { UserProfile } from "../../types";
import { safeLocalStorage } from "../../utils/safeStorage";
import { triggerHapticFeedback } from "../../utils/sound";

export interface ChatInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  otherUserProfile: UserProfile | null;
  otherUserPresence?: {
    status?: "online" | "offline";
    lastSeen?: any;
  } | null;
  formatLastSeen: (ts: any) => string;
  onVoiceCall?: () => void;
  onVideoCall?: () => void;
  onSearchInChat?: () => void;
  onOpenGallery?: () => void;
  onOpenStarred?: () => void;
  onOpenWallpaper?: () => void;
  isPinned?: boolean;
  isMuted?: boolean;
  isArchived?: boolean;
  isBlocked?: boolean;
  onTogglePin?: () => void;
  onToggleMute?: () => void;
  onToggleArchive?: () => void;
  onToggleBlock?: () => void;
  onReportUser?: () => void;
  onViewProfile?: (uid: string) => void;
  sharedMediaThumbnails?: string[];
  totalMediaCount?: number;
  totalDocsCount?: number;
  totalLinksCount?: number;
  totalStarredCount?: number;
}

export const ChatInfoModal: React.FC<ChatInfoModalProps> = ({
  isOpen,
  onClose,
  otherUserProfile,
  otherUserPresence,
  formatLastSeen,
  onVoiceCall,
  onVideoCall,
  onSearchInChat,
  onOpenGallery,
  onOpenStarred,
  onOpenWallpaper,
  isPinned = false,
  isMuted = false,
  isBlocked = false,
  onTogglePin,
  onToggleMute,
  onToggleBlock,
  onReportUser,
  onViewProfile,
  sharedMediaThumbnails = [],
  totalMediaCount = 0,
  totalDocsCount = 0,
  totalLinksCount = 0,
  totalStarredCount = 0,
}) => {
  const [copiedUsername, setCopiedUsername] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Synchronized optimistic state for Pin and Mute toggles to ensure immediate reactive UI
  const [localPinned, setLocalPinned] = useState<boolean>(isPinned);
  const [localMuted, setLocalMuted] = useState<boolean>(isMuted);

  useEffect(() => {
    setLocalPinned(isPinned);
  }, [isPinned]);

  useEffect(() => {
    setLocalMuted(isMuted);
  }, [isMuted]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2200);
  }, []);

  // Dismiss on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const isOnline = otherUserPresence?.status === "online";
  const statusLabel = isOnline ? "Active now" : formatLastSeen(otherUserPresence?.lastSeen);

  const handleCopyUsername = () => {
    if (!otherUserProfile?.username) return;
    triggerHapticFeedback("light");
    const uname = `@${otherUserProfile.username}`;
    try {
      navigator.clipboard.writeText(uname);
      setCopiedUsername(true);
      showToast(`Copied ${uname}`);
      setTimeout(() => setCopiedUsername(false), 2000);
    } catch (_) {}
  };

  const handleShareContact = () => {
    triggerHapticFeedback("medium");
    const shareText = `Connect with ${otherUserProfile?.fullName || "Member"} on SwapSkill: ${window.location.origin}`;
    try {
      if (navigator.share) {
        navigator.share({
          title: otherUserProfile?.fullName || "SwapSkill Member",
          text: shareText,
          url: window.location.href,
        }).catch(() => {});
      } else {
        navigator.clipboard.writeText(shareText);
        setCopiedLink(true);
        showToast("Contact link copied to clipboard");
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch (_) {}
  };

  /**
   * Pre-cache full profile before navigating to ensure 0ms instantaneous rendering
   */
  const handleOpenFullProfile = () => {
    if (!otherUserProfile?.uid) return;
    triggerHapticFeedback("medium");

    // Instantly hydrate multi-tier profile cache
    try {
      safeLocalStorage.setItem("swap_cached_profile", JSON.stringify(otherUserProfile));
      safeLocalStorage.setItem(`swap_cached_profile_${otherUserProfile.uid}`, JSON.stringify(otherUserProfile));
      const raw = safeLocalStorage.getItem("swap_cache_profiles_map");
      const map = raw ? JSON.parse(raw) : {};
      map[otherUserProfile.uid] = otherUserProfile;
      safeLocalStorage.setItem("swap_cache_profiles_map", JSON.stringify(map));
    } catch (_) {}

    onClose();
    if (onViewProfile) {
      onViewProfile(otherUserProfile.uid);
    }
  };

  // Immediate reactive toggle for Pin
  const handleTogglePinAction = () => {
    triggerHapticFeedback("light");
    const nextPinned = !localPinned;
    setLocalPinned(nextPinned);
    showToast(nextPinned ? "Conversation pinned to top" : "Conversation unpinned");
    onTogglePin?.();
  };

  // Immediate reactive toggle for Mute
  const handleToggleMuteAction = () => {
    triggerHapticFeedback("light");
    const nextMuted = !localMuted;
    setLocalMuted(nextMuted);
    showToast(nextMuted ? "Notifications muted" : "Notifications unmuted");
    onToggleMute?.();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        role="dialog"
        aria-modal="true"
        aria-label="Contact Information"
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-5 overflow-hidden select-none font-sans"
      >
        {/* Subtle Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          onClick={onClose}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm cursor-pointer"
        />

        {/* Modal / Slide-Over Sheet (Apple / Google MNC Clean Light & Dark Native Styling) */}
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="relative z-10 w-full sm:max-w-md h-[90vh] sm:h-[86vh] max-h-[760px] bg-white dark:bg-[#121316] text-neutral-900 dark:text-neutral-100 border border-neutral-200/80 dark:border-neutral-800 rounded-t-[32px] sm:rounded-[32px] shadow-[0_24px_80px_rgba(0,0,0,0.22)] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* iOS Grabber Pill */}
          <div className="w-full flex justify-center pt-2.5 pb-0.5 sm:hidden relative z-20">
            <div className="w-10 h-1.5 rounded-full bg-neutral-300 dark:bg-neutral-700 active:bg-neutral-400 cursor-grab" />
          </div>

          {/* Top Bar Header */}
          <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 border-b border-neutral-200/70 dark:border-neutral-800/80 shrink-0 bg-white/90 dark:bg-[#121316]/90 backdrop-blur-md relative z-20">
            <h3 className="text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
              Contact Details
            </h3>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleShareContact}
                className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 active:scale-90 text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white flex items-center justify-center transition cursor-pointer border border-neutral-200/60 dark:border-neutral-700/60"
                title="Share Contact"
                aria-label="Share Contact"
              >
                {copiedLink ? <Check size={14} className="text-emerald-500" /> : <Share2 size={14} />}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 active:scale-90 text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white flex items-center justify-center transition cursor-pointer border border-neutral-200/60 dark:border-neutral-700/60"
                aria-label="Close contact info"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Floating Toast Pill */}
          <AnimatePresence>
            {toastMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 rounded-full bg-neutral-900/95 dark:bg-white text-white dark:text-neutral-900 text-xs font-medium shadow-xl flex items-center gap-1.5 pointer-events-none backdrop-blur-md"
              >
                <CheckCircle2 size={13} className="text-emerald-400 dark:text-emerald-600 shrink-0" />
                <span>{toastMessage}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3.5 scrollbar-none relative z-10 pb-8 bg-neutral-50/50 dark:bg-black/30">
            
            {/* User Profile Hero */}
            <div className="flex flex-col items-center text-center pt-1 pb-1">
              <div className="relative mb-3">
                <div className="w-24 h-24 sm:w-26 sm:h-26 rounded-full p-0.5 bg-gradient-to-b from-amber-400/40 via-neutral-200 dark:via-neutral-700 to-transparent shadow-md">
                  <SmartImage
                    src={otherUserProfile?.photoUrl || otherUserProfile?.profilePhotoUrl}
                    alt={otherUserProfile?.fullName || "User"}
                    className="w-full h-full rounded-full object-cover border-2 border-white dark:border-[#121316]"
                    fallbackType="profile"
                    fullName={otherUserProfile?.fullName}
                  />
                </div>

                {/* Online / Presence Badge */}
                {isOnline ? (
                  <span className="absolute bottom-1 right-1.5 flex items-center justify-center">
                    <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#121316] shadow-sm" />
                  </span>
                ) : (
                  <span className="absolute bottom-1 right-1.5 w-3 h-3 rounded-full bg-neutral-400 ring-2 ring-white dark:ring-[#121316]" />
                )}
              </div>

              {/* Full Name & Verified Badge */}
              <div className="flex items-center justify-center gap-1.5 flex-wrap px-2">
                <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 dark:text-white tracking-tight leading-snug">
                  {otherUserProfile?.fullName || "SwapSkill Member"}
                </h2>
                <span title="Verified Member">
                  <ShieldCheck size={18} className="text-amber-500 shrink-0" />
                </span>
              </div>

              {/* Username Pill with Quick Copy */}
              {otherUserProfile?.username && (
                <button
                  type="button"
                  onClick={handleCopyUsername}
                  className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white font-medium mt-1 px-3 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800/80 hover:bg-neutral-200 dark:hover:bg-neutral-700 active:scale-95 border border-neutral-200/60 dark:border-neutral-700/60 transition cursor-pointer shadow-2xs group"
                  title="Click to copy username"
                >
                  <span>@{otherUserProfile.username}</span>
                  {copiedUsername ? (
                    <Check size={11} className="text-emerald-500" />
                  ) : (
                    <Copy size={11} className="text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-200 transition-colors" />
                  )}
                </button>
              )}

              {/* Presence Status & Location */}
              <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 mt-1.5 font-medium">
                <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-neutral-400"}`} />
                <span className={isOnline ? "text-emerald-600 dark:text-emerald-400 font-semibold" : ""}>{statusLabel}</span>
                {otherUserProfile?.city && (
                  <>
                    <span className="text-neutral-300 dark:text-neutral-600">•</span>
                    <span className="flex items-center gap-0.5">
                      <MapPin size={11} className="text-neutral-400 shrink-0" />
                      <span>{otherUserProfile.city}</span>
                    </span>
                  </>
                )}
              </div>

              {/* Bio Card (Clean Google / Apple style text) */}
              {otherUserProfile?.bio && (
                <div className="mt-3 px-4 py-2.5 rounded-2xl bg-white dark:bg-[#18191E] border border-neutral-200/70 dark:border-neutral-800/80 max-w-sm w-full text-center shadow-xs">
                  <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
                    {otherUserProfile.bio}
                  </p>
                </div>
              )}

              {/* Teaching & Learning Skill Tags */}
              {((otherUserProfile?.skillsToTeach && otherUserProfile.skillsToTeach.length > 0) ||
                (otherUserProfile?.skillsToLearn && otherUserProfile.skillsToLearn.length > 0)) && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2.5 max-w-sm">
                  {(otherUserProfile.skillsToTeach || []).slice(0, 3).map((skill, idx) => (
                    <span
                      key={`teach_${idx}`}
                      className="text-[10px] font-semibold text-neutral-800 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-0.5 rounded-full border border-neutral-200/60 dark:border-neutral-700/60"
                    >
                      Teaches: {skill}
                    </span>
                  ))}
                  {(otherUserProfile.skillsToLearn || []).slice(0, 2).map((skill, idx) => (
                    <span
                      key={`learn_${idx}`}
                      className="text-[10px] font-medium text-neutral-600 dark:text-neutral-400 bg-white dark:bg-[#18191E] px-2.5 py-0.5 rounded-full border border-neutral-200/60 dark:border-neutral-800/80"
                    >
                      Wants: {skill}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Google / Apple Quick Actions Dock */}
            <div className="grid grid-cols-4 gap-2 pt-1">
              {/* Voice Call */}
              {onVoiceCall && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("medium");
                    onClose();
                    onVoiceCall();
                  }}
                  className="flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl bg-white dark:bg-[#18191E] hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 active:scale-95 border border-neutral-200/70 dark:border-neutral-800/80 transition group cursor-pointer shadow-xs"
                  title="Voice Call"
                >
                  <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    <Phone size={16} />
                  </div>
                  <span className="text-[11px] font-semibold text-neutral-900 dark:text-white">Audio</span>
                </button>
              )}

              {/* Video Call */}
              {onVideoCall && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("medium");
                    onClose();
                    onVideoCall();
                  }}
                  className="flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl bg-white dark:bg-[#18191E] hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 active:scale-95 border border-neutral-200/70 dark:border-neutral-800/80 transition group cursor-pointer shadow-xs"
                  title="Video Call"
                >
                  <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    <Video size={16} />
                  </div>
                  <span className="text-[11px] font-semibold text-neutral-900 dark:text-white">Video</span>
                </button>
              )}

              {/* Search In Chat */}
              {onSearchInChat && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("light");
                    onClose();
                    onSearchInChat();
                  }}
                  className="flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl bg-white dark:bg-[#18191E] hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 active:scale-95 border border-neutral-200/70 dark:border-neutral-800/80 transition group cursor-pointer shadow-xs"
                  title="Search Messages"
                >
                  <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    <Search size={16} />
                  </div>
                  <span className="text-[11px] font-semibold text-neutral-900 dark:text-white">Search</span>
                </button>
              )}

              {/* Mute / Unmute Notifications */}
              {onToggleMute && (
                <button
                  type="button"
                  onClick={handleToggleMuteAction}
                  className="flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl bg-white dark:bg-[#18191E] hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 active:scale-95 border border-neutral-200/70 dark:border-neutral-800/80 transition group cursor-pointer shadow-xs"
                  title={localMuted ? "Unmute Notifications" : "Mute Notifications"}
                >
                  <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    {localMuted ? <BellOff size={16} className="text-amber-500" /> : <Bell size={16} />}
                  </div>
                  <span className="text-[11px] font-semibold text-neutral-900 dark:text-white">
                    {localMuted ? "Unmute" : "Mute"}
                  </span>
                </button>
              )}
            </div>

            {/* Profile & Credentials Card (Modern Inset Card) */}
            {onViewProfile && otherUserProfile?.uid && (
              <div
                onClick={handleOpenFullProfile}
                className="rounded-2xl bg-white dark:bg-[#18191E] border border-neutral-200/70 dark:border-neutral-800/80 p-3.5 flex items-center justify-between cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 active:scale-[0.99] transition shadow-xs group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <Sparkles size={17} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-neutral-900 dark:text-white block group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                      Full Profile & Skills
                    </span>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                      Ratings, swap reviews, portfolio & stats
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-xs font-medium text-neutral-400 group-hover:text-neutral-800 dark:group-hover:text-neutral-200 transition">
                  <ChevronRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            )}

            {/* Media & Documents Card */}
            <div className="rounded-2xl bg-white dark:bg-[#18191E] border border-neutral-200/70 dark:border-neutral-800/80 overflow-hidden divide-y divide-neutral-200/60 dark:divide-neutral-800/60 shadow-xs">
              <div 
                onClick={() => {
                  triggerHapticFeedback("light");
                  onClose();
                  onOpenGallery?.();
                }}
                className="p-3.5 flex flex-col cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center">
                      <ImageIcon size={16} />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-neutral-900 dark:text-white">
                        Media, Docs & Links
                      </span>
                      <p className="text-[10px] text-neutral-500 dark:text-neutral-400">Photos, shared videos & files</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition">
                    <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200/60 dark:border-neutral-700/60">
                      {totalMediaCount + totalDocsCount + totalLinksCount}
                    </span>
                    <ChevronRight size={14} />
                  </div>
                </div>

                {/* Thumbnail Preview Strip */}
                {sharedMediaThumbnails && sharedMediaThumbnails.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2 mt-3 pt-2.5 border-t border-neutral-200/60 dark:border-neutral-800/60">
                    {sharedMediaThumbnails.slice(0, 4).map((url, idx) => {
                      const isVid =
                        /^data:video\//i.test(url) ||
                        /\.(mp4|webm|mov|m4v|3gp)(\?|$)/i.test(url) ||
                        url.includes("/video/upload/");
                      return (
                        <div 
                          key={idx}
                          className="aspect-square rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700/80 relative group/thumb"
                        >
                          {isVid ? (
                            <>
                              <video
                                src={url}
                                muted
                                playsInline
                                preload="metadata"
                                className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                                <div className="w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-[10px]">
                                  ▶
                                </div>
                              </div>
                            </>
                          ) : (
                            <img 
                              src={url} 
                              alt="Shared preview" 
                              className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200" 
                            />
                          )}
                          {idx === 3 && sharedMediaThumbnails.length > 4 && (
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center text-white text-xs font-bold">
                              +{sharedMediaThumbnails.length - 3}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-2 text-[10.5px] text-neutral-400 italic">
                    No shared photos or documents yet
                  </div>
                )}
              </div>
            </div>

            {/* Conversation Settings Group */}
            <div className="rounded-2xl bg-white dark:bg-[#18191E] border border-neutral-200/70 dark:border-neutral-800/80 overflow-hidden divide-y divide-neutral-200/60 dark:divide-neutral-800/60 shadow-xs">
              {/* Chat Wallpaper */}
              {onOpenWallpaper && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("light");
                    onClose();
                    onOpenWallpaper();
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center">
                      <Palette size={15} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-neutral-900 dark:text-white">Chat Wallpaper</p>
                      <p className="text-[10px] text-neutral-500 dark:text-neutral-400">Custom theme synchronized for both users</p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-neutral-400" />
                </button>
              )}

              {/* Starred Messages */}
              {onOpenStarred && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("light");
                    onClose();
                    onOpenStarred();
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center">
                      <Star size={15} className="text-amber-500" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-neutral-900 dark:text-white">Starred Messages</p>
                      <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                        {totalStarredCount} saved message{totalStarredCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-neutral-400" />
                </button>
              )}

              {/* Pin Chat with Apple / Google iOS Switch */}
              {onTogglePin && (
                <div
                  onClick={handleTogglePinAction}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center">
                      <Pin size={15} className={localPinned ? "text-amber-500 rotate-45 transition-transform" : "transition-transform"} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-neutral-900 dark:text-white">
                        Pin Conversation
                      </p>
                      <p className="text-[10px] text-neutral-500 dark:text-neutral-400">Keep this chat anchored to the top of your list</p>
                    </div>
                  </div>

                  {/* Clean Animated Toggle Switch */}
                  <div 
                    className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0 ${
                      localPinned ? "bg-amber-500" : "bg-neutral-200 dark:bg-neutral-700"
                    }`}
                  >
                    <div 
                      className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                        localPinned ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Privacy & Security Trust Banner */}
            <div className="p-3.5 rounded-2xl bg-neutral-100/70 dark:bg-[#18191E] border border-neutral-200/70 dark:border-neutral-800/80 flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                <ShieldCheck size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <span>End-to-End Encrypted</span>
                  <Lock size={11} className="text-emerald-600 dark:text-emerald-400" />
                </p>
                <p className="text-[10.5px] text-neutral-500 dark:text-neutral-400 leading-relaxed mt-0.5">
                  Messages, voice notes, calls, and files are private and directly secured between participants.
                </p>
              </div>
            </div>

            {/* Danger Actions Inset Group */}
            <div className="rounded-2xl bg-white dark:bg-[#18191E] border border-neutral-200/70 dark:border-neutral-800/80 overflow-hidden divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
              {onToggleBlock && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("medium");
                    onClose();
                    onToggleBlock();
                  }}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 active:bg-rose-100/60 transition cursor-pointer"
                >
                  <Ban size={15} />
                  <span className="text-xs font-semibold">
                    {isBlocked ? "Unblock Contact" : "Block Contact"}
                  </span>
                </button>
              )}

              {onReportUser && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("medium");
                    onClose();
                    onReportUser();
                  }}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/40 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white active:bg-neutral-100 transition cursor-pointer"
                >
                  <ShieldAlert size={15} />
                  <span className="text-xs font-medium">Report Contact</span>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ChatInfoModal;
