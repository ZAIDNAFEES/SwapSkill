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
  ExternalLink
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

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        role="dialog"
        aria-modal="true"
        aria-label="Contact Information"
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-5 overflow-hidden select-none"
      >
        {/* Apple-grade Clean Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          onClick={onClose}
          className="fixed inset-0 bg-black/40 backdrop-blur-md cursor-pointer"
        />

        {/* Modal / Slide-Over Sheet (Matches SwapSkill's White/Ivory Luxury Theme) */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="relative z-10 w-full sm:max-w-md h-[90vh] sm:h-[86vh] max-h-[760px] bg-white text-zinc-900 border border-[#E8E4DB] rounded-t-[32px] sm:rounded-[32px] shadow-[0_24px_80px_rgba(0,0,0,0.18)] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* iOS Grabber Pill */}
          <div className="w-full flex justify-center pt-2.5 pb-0.5 sm:hidden relative z-20">
            <div className="w-10 h-1.5 rounded-full bg-zinc-300 active:bg-zinc-400 cursor-grab" />
          </div>

          {/* Top Bar Header */}
          <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#E8E4DB] shrink-0 bg-white/90 backdrop-blur-md relative z-20">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#C9A96E]" />
              <h3 className="text-xs font-bold tracking-wider uppercase text-zinc-600">
                Contact Info
              </h3>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleShareContact}
                className="w-8 h-8 rounded-full bg-[#F7F4EE] hover:bg-[#EFEBE1] active:scale-90 text-zinc-600 hover:text-zinc-900 flex items-center justify-center transition cursor-pointer border border-[#E8E4DB]"
                title="Share Contact"
                aria-label="Share Contact"
              >
                {copiedLink ? <Check size={14} className="text-emerald-600" /> : <Share2 size={14} />}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-[#F7F4EE] hover:bg-[#EFEBE1] active:scale-90 text-zinc-600 hover:text-zinc-900 flex items-center justify-center transition cursor-pointer border border-[#E8E4DB]"
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
                className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 rounded-full bg-[#0D0D0F] text-white text-xs font-medium shadow-xl flex items-center gap-1.5 pointer-events-none"
              >
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                <span>{toastMessage}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-none relative z-10 pb-8 bg-[#FAF8F5]/60">
            
            {/* User Profile Hero */}
            <div className="flex flex-col items-center text-center pt-2">
              <div className="relative mb-3">
                <div className="w-24 h-24 sm:w-26 sm:h-26 rounded-full p-0.5 bg-gradient-to-b from-[#C9A96E]/50 to-zinc-200 shadow-md">
                  <SmartImage
                    src={otherUserProfile?.photoUrl || otherUserProfile?.profilePhotoUrl}
                    alt={otherUserProfile?.fullName || "User"}
                    className="w-full h-full rounded-full object-cover border-2 border-white"
                    fallbackType="profile"
                    fullName={otherUserProfile?.fullName}
                  />
                </div>

                {/* Online / Presence Badge */}
                {isOnline ? (
                  <span className="absolute bottom-1 right-1.5 flex items-center justify-center">
                    <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white shadow-sm" />
                  </span>
                ) : (
                  <span className="absolute bottom-1 right-1.5 w-3 h-3 rounded-full bg-zinc-400 ring-2 ring-white" />
                )}
              </div>

              {/* Full Name & Pro Badge */}
              <div className="flex items-center justify-center gap-1.5 flex-wrap px-2">
                <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight leading-snug">
                  {otherUserProfile?.fullName || "SwapSkill Member"}
                </h2>
                <span title="Verified Member">
                  <ShieldCheck size={17} className="text-[#C9A96E] shrink-0" />
                </span>
              </div>

              {/* Username Pill with Quick Copy */}
              {otherUserProfile?.username && (
                <button
                  type="button"
                  onClick={handleCopyUsername}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 font-medium mt-1 px-3 py-0.5 rounded-full bg-[#F2EFE8] hover:bg-[#EAE6DD] active:scale-95 border border-[#E8E4DB] transition cursor-pointer shadow-2xs group"
                  title="Click to copy username"
                >
                  <span>@{otherUserProfile.username}</span>
                  {copiedUsername ? (
                    <Check size={11} className="text-emerald-600" />
                  ) : (
                    <Copy size={11} className="text-zinc-400 group-hover:text-zinc-700 transition-colors" />
                  )}
                </button>
              )}

              {/* Presence Status & Location */}
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 mt-1.5 font-medium">
                <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-zinc-400"}`} />
                <span className={isOnline ? "text-emerald-700 font-semibold" : "text-zinc-500"}>{statusLabel}</span>
                {otherUserProfile?.city && (
                  <>
                    <span className="text-zinc-300">•</span>
                    <span className="flex items-center gap-0.5 text-zinc-500">
                      <MapPin size={11} className="text-zinc-400" />
                      <span>{otherUserProfile.city}</span>
                    </span>
                  </>
                )}
              </div>

              {/* Bio Card */}
              {otherUserProfile?.bio && (
                <div className="mt-3 px-4 py-2.5 rounded-2xl bg-white border border-[#E8E4DB] max-w-sm w-full text-center shadow-xs">
                  <p className="text-xs text-zinc-700 leading-relaxed italic">
                    "{otherUserProfile.bio}"
                  </p>
                </div>
              )}

              {/* Teaching & Learning Skill Tags (Subtle Warm Palette) */}
              {((otherUserProfile?.skillsToTeach && otherUserProfile.skillsToTeach.length > 0) ||
                (otherUserProfile?.skillsToLearn && otherUserProfile.skillsToLearn.length > 0)) && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2.5 max-w-sm">
                  {(otherUserProfile.skillsToTeach || []).slice(0, 3).map((skill, idx) => (
                    <span
                      key={`teach_${idx}`}
                      className="text-[10px] font-semibold text-zinc-800 bg-[#F2EFE8] px-2.5 py-0.5 rounded-full border border-[#E8E4DB]"
                    >
                      Teaches: {skill}
                    </span>
                  ))}
                  {(otherUserProfile.skillsToLearn || []).slice(0, 2).map((skill, idx) => (
                    <span
                      key={`learn_${idx}`}
                      className="text-[10px] font-medium text-zinc-600 bg-white px-2.5 py-0.5 rounded-full border border-[#E8E4DB]"
                    >
                      Wants: {skill}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Apple Unified Action Dock (Clean, Cohesive, MNC Style) */}
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
                  className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white hover:bg-[#F7F4EE] active:scale-95 border border-[#E8E4DB] transition group cursor-pointer shadow-xs"
                  title="Voice Call"
                >
                  <div className="w-10 h-10 rounded-full bg-[#F7F4EE] text-zinc-800 border border-[#E8E4DB] flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    <Phone size={17} />
                  </div>
                  <span className="text-[11px] font-semibold text-zinc-900">Voice</span>
                  <span className="text-[9px] text-zinc-500 font-medium">Free Call</span>
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
                  className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white hover:bg-[#F7F4EE] active:scale-95 border border-[#E8E4DB] transition group cursor-pointer shadow-xs"
                  title="Video Call"
                >
                  <div className="w-10 h-10 rounded-full bg-[#F7F4EE] text-zinc-800 border border-[#E8E4DB] flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    <Video size={17} />
                  </div>
                  <span className="text-[11px] font-semibold text-zinc-900">Video</span>
                  <span className="text-[9px] text-zinc-500 font-medium">1080p HD</span>
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
                  className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white hover:bg-[#F7F4EE] active:scale-95 border border-[#E8E4DB] transition group cursor-pointer shadow-xs"
                  title="Search Messages"
                >
                  <div className="w-10 h-10 rounded-full bg-[#F7F4EE] text-zinc-800 border border-[#E8E4DB] flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    <Search size={17} />
                  </div>
                  <span className="text-[11px] font-semibold text-zinc-900">Search</span>
                  <span className="text-[9px] text-zinc-500 font-medium">In Chat</span>
                </button>
              )}

              {/* Mute / Unmute Notifications */}
              {onToggleMute && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("light");
                    onToggleMute();
                    showToast(isMuted ? "Notifications unmuted" : "Notifications muted");
                  }}
                  className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white hover:bg-[#F7F4EE] active:scale-95 border border-[#E8E4DB] transition group cursor-pointer shadow-xs"
                  title={isMuted ? "Unmute Notifications" : "Mute Notifications"}
                >
                  <div className="w-10 h-10 rounded-full bg-[#F7F4EE] text-zinc-800 border border-[#E8E4DB] flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    {isMuted ? <BellOff size={17} className="text-amber-600" /> : <Bell size={17} />}
                  </div>
                  <span className="text-[11px] font-semibold text-zinc-900">
                    {isMuted ? "Unmute" : "Mute"}
                  </span>
                  <span className="text-[9px] text-zinc-500 font-medium">
                    {isMuted ? "Silenced" : "Alerts on"}
                  </span>
                </button>
              )}
            </div>

            {/* View Full Profile Hero Card (Elegant Apple Black Card) */}
            {onViewProfile && otherUserProfile?.uid && (
              <div
                onClick={handleOpenFullProfile}
                className="rounded-2xl bg-[#0D0D0F] text-white p-4 flex items-center justify-between cursor-pointer hover:bg-zinc-800 active:scale-[0.99] transition shadow-md group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-[#C9A96E] shrink-0 group-hover:scale-105 transition-transform">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-white group-hover:text-[#C9A96E] transition-colors">
                        View Full Profile
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded-full bg-white/15 text-zinc-300">
                        Instant
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Skills, swap reviews, ratings & portfolio
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/10 group-hover:bg-white/20 text-white text-xs font-semibold transition border border-white/10">
                  <span>View</span>
                  <ArrowUpRight size={13} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </div>
            )}

            {/* Media & Documents Card */}
            <div className="rounded-2xl bg-white border border-[#E8E4DB] overflow-hidden divide-y divide-[#E8E4DB] shadow-xs">
              <div 
                onClick={() => {
                  triggerHapticFeedback("light");
                  onClose();
                  onOpenGallery?.();
                }}
                className="p-3.5 flex flex-col cursor-pointer hover:bg-[#FAF8F5] transition group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] text-zinc-700 flex items-center justify-center">
                      <ImageIcon size={16} />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-zinc-900 group-hover:text-[#0D0D0F]">
                        Media, Docs & Links
                      </span>
                      <p className="text-[10px] text-zinc-500">Photos, shared videos & files</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500 group-hover:text-zinc-900 transition">
                    <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F2EFE8] text-zinc-700 border border-[#E8E4DB]">
                      {totalMediaCount + totalDocsCount + totalLinksCount}
                    </span>
                    <ChevronRight size={14} />
                  </div>
                </div>

                {/* Thumbnail Preview Strip */}
                {sharedMediaThumbnails && sharedMediaThumbnails.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2 mt-3 pt-2.5 border-t border-[#E8E4DB]">
                    {sharedMediaThumbnails.slice(0, 4).map((url, idx) => (
                      <div 
                        key={idx}
                        className="aspect-square rounded-xl overflow-hidden bg-zinc-100 border border-zinc-200 relative group/thumb"
                      >
                        <img 
                          src={url} 
                          alt="Shared preview" 
                          className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200" 
                        />
                        {idx === 3 && sharedMediaThumbnails.length > 4 && (
                          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center text-white text-xs font-bold">
                            +{sharedMediaThumbnails.length - 3}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-[10.5px] text-zinc-400 italic">
                    No shared photos or documents yet
                  </div>
                )}
              </div>
            </div>

            {/* Conversation Settings Group */}
            <div className="rounded-2xl bg-white border border-[#E8E4DB] overflow-hidden divide-y divide-[#E8E4DB] shadow-xs">
              {/* Chat Wallpaper */}
              {onOpenWallpaper && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("light");
                    onClose();
                    onOpenWallpaper();
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[#FAF8F5] transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] text-zinc-700 flex items-center justify-center">
                      <Palette size={15} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-zinc-900">Chat Wallpaper</p>
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded-full bg-[#F2EFE8] text-zinc-700 border border-[#E8E4DB]">
                          Shared
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500">Synced wallpaper theme for both users</p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-zinc-400" />
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
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[#FAF8F5] transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] text-zinc-700 flex items-center justify-center">
                      <Star size={15} className="text-amber-500" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-zinc-900">Starred Messages</p>
                      <p className="text-[10px] text-zinc-500">
                        {totalStarredCount} saved message{totalStarredCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-zinc-400" />
                </button>
              )}

              {/* Pin Chat */}
              {onTogglePin && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("light");
                    onTogglePin();
                    showToast(isPinned ? "Chat unpinned" : "Chat pinned to top");
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[#FAF8F5] transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] text-zinc-700 flex items-center justify-center">
                      <Pin size={15} className={isPinned ? "text-[#C9A96E] rotate-45" : ""} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-zinc-900">
                        {isPinned ? "Unpin Conversation" : "Pin Conversation"}
                      </p>
                      <p className="text-[10px] text-zinc-500">Keep this chat at the top of your list</p>
                    </div>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                    isPinned 
                      ? "bg-[#0D0D0F] text-white border-[#0D0D0F]" 
                      : "bg-[#F2EFE8] text-zinc-600 border-[#E8E4DB]"
                  }`}>
                    {isPinned ? "Pinned" : "Off"}
                  </span>
                </button>
              )}
            </div>

            {/* Privacy & Security Trust Banner */}
            <div className="p-3.5 rounded-2xl bg-[#F7F4EE] border border-[#E8E4DB] flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-white border border-[#E8E4DB] text-zinc-700 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                <ShieldCheck size={15} className="text-emerald-700" />
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
                  <span>Peer-to-Peer Encryption</span>
                  <Lock size={11} className="text-emerald-700" />
                </p>
                <p className="text-[10.5px] text-zinc-600 leading-relaxed mt-0.5">
                  Messages, media, and voice calls are private and securely transmitted between participants.
                </p>
              </div>
            </div>

            {/* Danger Actions Inset Group */}
            <div className="rounded-2xl bg-white border border-[#E8E4DB] overflow-hidden divide-y divide-[#E8E4DB]">
              {onToggleBlock && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("medium");
                    onClose();
                    onToggleBlock();
                  }}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-rose-50 text-rose-600 active:bg-rose-100/60 transition cursor-pointer"
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
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-zinc-50 text-zinc-600 hover:text-zinc-900 active:bg-zinc-100 transition cursor-pointer"
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
