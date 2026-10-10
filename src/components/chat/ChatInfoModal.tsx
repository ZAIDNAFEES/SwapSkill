import React, { useEffect, useState } from "react";
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
  FileText, 
  Link2, 
  ShieldCheck, 
  Ban, 
  ShieldAlert, 
  ChevronRight,
  ExternalLink,
  Lock,
  UserCheck
} from "lucide-react";
import { SmartImage } from "../SmartImage";
import { UserProfile } from "../../types";

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
  isArchived = false,
  isBlocked = false,
  onTogglePin,
  onToggleMute,
  onToggleArchive,
  onToggleBlock,
  onReportUser,
  onViewProfile,
  sharedMediaThumbnails = [],
  totalMediaCount = 0,
  totalDocsCount = 0,
  totalLinksCount = 0,
  totalStarredCount = 0,
}) => {
  // Dismiss on Escape
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

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        role="dialog"
        aria-modal="true"
        aria-label="Chat Info"
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center sm:justify-end p-0 sm:p-4 overflow-hidden select-none"
      >
        {/* Soft luxury backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/65 backdrop-blur-md cursor-pointer"
        />

        {/* Modal / Slide-Over Card */}
        <motion.div
          initial={{ opacity: 0, x: 40, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className="relative z-10 w-full sm:max-w-md h-[90vh] sm:h-[95vh] max-h-[760px] bg-[#101114]/95 text-zinc-100 border border-white/[0.08] rounded-t-3xl sm:rounded-3xl shadow-[0_24px_64px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden backdrop-blur-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top Bar Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]" />
              <h3 className="text-sm font-semibold tracking-wide text-white">Contact Info</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-white/10 active:scale-90 text-zinc-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              aria-label="Close contact info"
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 scrollbar-none">
            {/* User Profile Hero */}
            <div className="flex flex-col items-center text-center pt-2">
              <div className="relative mb-3 group">
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full p-1 bg-gradient-to-tr from-[#D4AF37]/40 via-white/10 to-transparent">
                  <SmartImage
                    src={otherUserProfile?.photoUrl || otherUserProfile?.profilePhotoUrl}
                    alt={otherUserProfile?.fullName || "User"}
                    className="w-full h-full rounded-full object-cover border-2 border-[#101114] shadow-xl"
                    fallbackType="profile"
                    fullName={otherUserProfile?.fullName}
                  />
                </div>
                {isOnline && (
                  <span className="absolute bottom-1 right-2 w-4 h-4 rounded-full bg-emerald-500 ring-4 ring-[#101114]" />
                )}
              </div>

              <h2 className="text-lg font-bold text-white tracking-tight leading-tight">
                {otherUserProfile?.fullName || "SwapSkill Member"}
              </h2>

              {otherUserProfile?.username && (
                <p className="text-xs text-[#D4AF37] font-medium mt-0.5">
                  @{otherUserProfile.username}
                </p>
              )}

              <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1.5 font-medium">
                <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-zinc-500"}`} />
                <span>{statusLabel}</span>
              </p>

              {otherUserProfile?.bio && (
                <p className="text-xs text-zinc-300 mt-3 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05] leading-relaxed max-w-sm">
                  {otherUserProfile.bio}
                </p>
              )}
            </div>

            {/* Quick Action Buttons Grid */}
            <div className="grid grid-cols-4 gap-2 pt-1">
              {onVoiceCall && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onVoiceCall();
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] active:scale-95 border border-white/[0.06] transition group cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/15 text-[#D4AF37] flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    <Phone size={16} />
                  </div>
                  <span className="text-[11px] font-medium text-zinc-200">Voice</span>
                </button>
              )}

              {onVideoCall && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onVideoCall();
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] active:scale-95 border border-white/[0.06] transition group cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/15 text-[#D4AF37] flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    <Video size={16} />
                  </div>
                  <span className="text-[11px] font-medium text-zinc-200">Video</span>
                </button>
              )}

              {onSearchInChat && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSearchInChat();
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] active:scale-95 border border-white/[0.06] transition group cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-xl bg-white/[0.08] text-zinc-200 flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    <Search size={16} />
                  </div>
                  <span className="text-[11px] font-medium text-zinc-200">Search</span>
                </button>
              )}

              {onToggleMute && (
                <button
                  type="button"
                  onClick={onToggleMute}
                  className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] active:scale-95 border border-white/[0.06] transition group cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-xl bg-white/[0.08] text-zinc-200 flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                    {isMuted ? <BellOff size={16} className="text-amber-400" /> : <Bell size={16} />}
                  </div>
                  <span className="text-[11px] font-medium text-zinc-200">{isMuted ? "Unmute" : "Mute"}</span>
                </button>
              )}
            </div>

            {/* Shared Content Strip (Media, Docs & Links) */}
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
              <div 
                onClick={() => {
                  onClose();
                  onOpenGallery?.();
                }}
                className="flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <ImageIcon size={15} className="text-[#D4AF37]" />
                  <span className="text-xs font-semibold text-white">Media, Docs & Links</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-zinc-400 group-hover:text-white transition">
                  <span className="font-mono text-[11px]">
                    {totalMediaCount + totalDocsCount + totalLinksCount}
                  </span>
                  <ChevronRight size={14} />
                </div>
              </div>

              {/* Preview thumbnails if any */}
              {sharedMediaThumbnails && sharedMediaThumbnails.length > 0 ? (
                <div className="grid grid-cols-4 gap-2 mt-3">
                  {sharedMediaThumbnails.slice(0, 4).map((url, idx) => (
                    <div 
                      key={idx}
                      onClick={() => {
                        onClose();
                        onOpenGallery?.();
                      }}
                      className="aspect-square rounded-xl overflow-hidden bg-black/40 border border-white/10 cursor-pointer hover:border-[#D4AF37] transition"
                    >
                      <img src={url} alt="Shared preview" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500 mt-2 font-light">
                  No media shared recently in this conversation
                </p>
              )}
            </div>

            {/* Conversation Settings Section */}
            <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
              {/* Wallpaper */}
              {onOpenWallpaper && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenWallpaper();
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.03] transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/15 text-[#D4AF37] flex items-center justify-center">
                      <Palette size={15} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">Chat Wallpaper</p>
                      <p className="text-[10px] text-zinc-400">Custom theme and doodle backgrounds</p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-zinc-500" />
                </button>
              )}

              {/* Starred Messages */}
              {onOpenStarred && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenStarred();
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.03] transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
                      <Star size={15} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">Starred Messages</p>
                      <p className="text-[10px] text-zinc-400">{totalStarredCount} saved message{totalStarredCount === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-zinc-500" />
                </button>
              )}

              {/* Pin Chat */}
              {onTogglePin && (
                <button
                  type="button"
                  onClick={onTogglePin}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.03] transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-white/[0.06] text-zinc-300 flex items-center justify-center">
                      <Pin size={15} className={isPinned ? "text-[#D4AF37] rotate-45" : ""} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">{isPinned ? "Unpin Conversation" : "Pin Conversation"}</p>
                      <p className="text-[10px] text-zinc-400">Keep this chat at the top of your list</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-medium text-[#D4AF37]">
                    {isPinned ? "Pinned" : "Off"}
                  </span>
                </button>
              )}

              {/* View Full Profile */}
              {onViewProfile && otherUserProfile?.uid && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onViewProfile(otherUserProfile.uid);
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.03] transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/15 text-[#D4AF37] flex items-center justify-center">
                      <UserCheck size={15} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">View Full Profile</p>
                      <p className="text-[10px] text-zinc-400">Skills, reviews, portfolio & swaps</p>
                    </div>
                  </div>
                  <ExternalLink size={14} className="text-zinc-500" />
                </button>
              )}
            </div>

            {/* Privacy & Encryption Trust Banner */}
            <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>Peer-to-Peer Encryption</span>
                  <Lock size={11} className="text-emerald-400" />
                </p>
                <p className="text-[10.5px] text-zinc-400 leading-relaxed mt-0.5">
                  Messages, media, and voice calls are private and encrypted between participants.
                </p>
              </div>
            </div>

            {/* Danger Actions */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] overflow-hidden divide-y divide-white/[0.04]">
              {onToggleBlock && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onToggleBlock();
                  }}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-rose-500/10 text-rose-400 transition cursor-pointer"
                >
                  <Ban size={15} />
                  <span className="text-xs font-medium">{isBlocked ? "Unblock Contact" : "Block Contact"}</span>
                </button>
              )}

              {onReportUser && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onReportUser();
                  }}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.04] text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
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
