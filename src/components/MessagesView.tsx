import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  updateDoc, 
  orderBy, 
  limit, 
  limitToLast,
  addDoc, 
  where,
  getDocs,
  writeBatch,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  increment,
  FieldPath,
  deleteField
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { useApp } from "../context/AppContext";
import { Chat, Message, UserNote, UserProfile } from "../types";
import { searchUsers } from "../services/userSearchService";
import { getOrCreateConversation, getTimestampMs } from "../utils/conversationUtils";
import { SmartImage } from "./SmartImage";
import { PullToRefresh } from "./PullToRefresh";
import { useKeyboardViewport } from "../hooks/useKeyboardViewport";
import { 
  Search, 
  ChevronLeft, 
  MoreVertical, 
  Send, 
  Paperclip, 
  Mic, 
  Image as ImageIcon, 
  Camera, 
  Smile, 
  Check, 
  CheckCheck, 
  Pin, 
  Trash2, 
  Edit3, 
  Copy, 
  Reply, 
  Forward,
  CheckSquare,
  ArrowRight, 
  Archive, 
  Bell, 
  BellOff, 
  SearchIcon, 
  FileText, 
  Download, 
  Play, 
  Pause, 
  X, 
  MoreHorizontal, 
  CheckCircle,
  HelpCircle,
  Loader2,
  Lock,
  ArrowUpRight,
  ArrowDownLeft,
  Maximize2,
  User,
  Info,
  ShieldAlert,
  Ban,
  MessageSquare,
  ChevronRight,
  Inbox,
  Clock,
  Slash,
  ChevronDown,
  Phone,
  PhoneMissed,
  PhoneIncoming,
  PhoneOutgoing,
  Video,
  Star,
  Palette,
  UserCheck,
  SquarePen,
  Plus,
  RotateCcw,
  Keyboard
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import RecordRTC from "recordrtc";
import SkeletonLoader, { LoadingTransition, Skeleton } from "./SkeletonLoader";
import BlockUserConfirmModal from "./BlockUserConfirmModal";
import { PremiumToast } from "./PremiumConfirmSheets";
import { useBackHandler } from "../utils/navigationManager";
import { activeChatTrackingService } from "../services/activeChatTrackingService";
import { getApiUrl } from "../utils/apiConfig";
import { dispatchPushNotification } from "../utils/pushDispatch";
import { 
  DeleteMessageConfirmModal, 
  isMessageDeleted, 
  MessageDeleteTarget 
} from "./chat/DeleteMessageConfirmModal";
import { ForwardMessageModal, ForwardTargetChat } from "./chat/ForwardMessageModal";
import { SelectionHeader } from "./chat/SelectionHeader";
import { MessageContextMenu, ContextMenuMessage } from "./chat/MessageContextMenu";
import { AudioWaveformPlayer } from "./chat/AudioWaveformPlayer";
import { LinkPreviewCard } from "./chat/LinkPreviewCard";
import { extractFirstUrl } from "../utils/linkPreview";
import { ChatWallpaperModal, WALLPAPER_PRESETS } from "./chat/ChatWallpaperModal";
import { StarredMessagesModal } from "./chat/StarredMessagesModal";
import { MessageInfoModal } from "./chat/MessageInfoModal";
import { ChatGalleryModal } from "./chat/ChatGalleryModal";
import { ChatInfoModal } from "./chat/ChatInfoModal";
import { ReactionBurstEffect, emitReactionBurst } from "./chat/ReactionBurstEffect";
import { ChatEmojiPicker } from "./chat/ChatEmojiPicker";
import { InstagramCameraModal, ViewOnceMode, EphemeralMediaType } from "./chat/InstagramCameraModal";
import {
  InstagramNotesTray,
  InstagramNoteComposerModal,
  InstagramNoteViewerModal,
  NoteTrayContact,
  getValidActiveNote,
} from "./chat/InstagramNotes";
import { ViewOnceViewerModal } from "./chat/ViewOnceViewerModal";
import { formatChatText } from "../utils/textFormatter";
import { safeLocalStorage } from "../utils/safeStorage";
import { optimizeImage, applyCloudinaryAutoOptimization, applyCloudinaryVideoOptimization } from "../utils/imageCompressor";
import { uploadImageToCloudinary, isCloudinaryConfigured, getCloudinaryConfig } from "../utils/cloudinary";
import { isSafeUrl, sanitizeUrl } from "../utils/urlSecurity";

interface MessagesViewProps {
  currentUserId: string;
  initialChatId?: string | null;
  activeChatId?: string | null;
  onCloseChat?: () => void;
  onSelectUser?: (userId: string) => void;
  onChatSelect?: (chatId: string | null) => void;
  onActiveChatChange?: (hasActiveChat: boolean, chatId: string | null) => void;
  onStartCall?: (partnerUser: any, callType: "video" | "audio", conversationId: string) => void;
}

interface ExtendedMessage extends Message {
  id: string;
  sourceCollection?: string;
  sourceChatId?: string;
  createdAt?: any;
  clientTimestamp?: number;
  clientMsgId?: string;
  sendError?: boolean;
  _optimisticPending?: boolean;
  isRead?: boolean;
  replyToId?: string;
  replyToText?: string;
  replyToSenderName?: string;
  replyToMedia?: "image" | "video" | "audio" | "file";
  replyToImageUrl?: string;
  isEdited?: boolean;
  imageUrl?: string;
  videoUrl?: string;
  mediaType?: "image" | "video";
  audioUrl?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  deletedFor?: string[];
  deleted?: boolean;
  isDeleted?: boolean;
  reactions?: Record<string, string>;
  pinned?: boolean;
  isForwarded?: boolean;
  starredBy?: string[];
  deliveredAt?: any;
  readAt?: any;
  isViewOnce?: boolean;
  viewMode?: "view_once" | "allow_replay" | "keep_in_chat";
  openedBy?: string[];
  openedAt?: any;
  replayCount?: Record<string, number>;
  callData?: {
    callId?: string;
    callType?: "video" | "audio";
    status?: "completed" | "missed" | "declined" | "ended";
    durationSeconds?: number;
    callerId?: string;
    callerName?: string;
    receiverId?: string;
    receiverName?: string;
  };
}

export const getMessageTimeMs = (msg: any): number => {
  if (!msg) return 0;
  const parseTs = (val: any): number => {
    if (!val) return 0;
    if (typeof val === "number") return val < 1e11 ? val * 1000 : val;
    if (typeof val.toMillis === "function") return val.toMillis();
    if (val.seconds !== undefined) return val.seconds * 1000 + (val.nanoseconds || 0) / 1e6;
    if (val instanceof Date) return val.getTime();
    if (typeof val === "string") {
      const parsed = Date.parse(val);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };
  return parseTs(msg.createdAt) || parseTs(msg.timestamp) || parseTs(msg.clientTimestamp) || 0;
};

const compareMessagesAsc = (a: ExtendedMessage, b: ExtendedMessage): number => {
  const tA = getMessageTimeMs(a);
  const tB = getMessageTimeMs(b);
  if (tA !== tB) return tA - tB;
  const cA = a.clientTimestamp || 0;
  const cB = b.clientTimestamp || 0;
  if (cA !== cB) return cA - cB;
  return String(a.clientMsgId || a.id).localeCompare(String(b.clientMsgId || b.id));
};

const formatChatDateDivider = (timeMs: number): string => {
  if (!timeMs) return "";
  const d = new Date(timeMs);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};

const isEphemeralMediaMessage = (m?: { isViewOnce?: boolean; viewMode?: string } | null): boolean =>
  Boolean(m && (m.isViewOnce || m.viewMode === "view_once" || m.viewMode === "allow_replay"));

const getEffectiveViewMode = (m?: { viewMode?: string } | null): "view_once" | "allow_replay" =>
  m?.viewMode === "allow_replay" ? "allow_replay" : "view_once";

const getEphemeralViewsForUser = (m: ExtendedMessage, uid: string): number => {
  if (!uid) return 0;
  if (typeof m.replayCount?.[uid] === "number") return m.replayCount[uid];
  if (m.openedBy?.includes(uid)) return 1;
  return 0;
};

interface ExtendedChat extends Chat {
  id: string;
  otherUser?: UserProfile | null;
  isLegacy?: boolean;
  otherUserId?: string;
}

// Pure Helpers to reliably identify and resolve the other participant
export const getOtherParticipantId = (
  chat: { participantIds?: string[]; otherUserId?: string; requestedBy?: string; requestedTo?: string; id?: string } | null | undefined,
  currentUserId: string
): string | null => {
  if (!chat || !currentUserId) return null;
  const cleanCurrent = currentUserId.trim();

  if (Array.isArray(chat.participantIds)) {
    const other = chat.participantIds.find((id) => id && id.trim() !== cleanCurrent);
    if (other) return other.trim();
  }
  if (chat.otherUserId && chat.otherUserId.trim() !== cleanCurrent) {
    return chat.otherUserId.trim();
  }
  if (chat.requestedBy && chat.requestedBy.trim() !== cleanCurrent) {
    return chat.requestedBy.trim();
  }
  if (chat.requestedTo && chat.requestedTo.trim() !== cleanCurrent) {
    return chat.requestedTo.trim();
  }
  if (chat.id && chat.id.includes("_")) {
    const rawParts = chat.id.replace(/^chat_/, "").split("_").map((p) => p.trim()).filter(Boolean);
    const parts = rawParts.filter(
      (p) => p !== "direct" && p !== "chat" && p !== "legacy" && p !== "conv" && p !== "call" && p !== "sess"
    );
    const other = parts.find((p) => p !== cleanCurrent);
    if (other) return other;
  }
  return null;
};

export const resolveOtherUserProfile = (
  otherUserId: string | null | undefined,
  chat: ExtendedChat | null | undefined,
  profilesCache: Record<string, UserProfile> | undefined,
  chatProfiles: Record<string, UserProfile>
): UserProfile | null => {
  if (!otherUserId) return null;
  // 1. Check profilesCache
  if (profilesCache && profilesCache[otherUserId] && profilesCache[otherUserId].uid === otherUserId) {
    return profilesCache[otherUserId];
  }
  // 2. Check chatProfiles
  if (chatProfiles && chatProfiles[otherUserId] && chatProfiles[otherUserId].uid === otherUserId) {
    return chatProfiles[otherUserId];
  }
  // 3. Only use chat.otherUser if its UID strictly matches otherUserId (never if it's the current user)
  if (chat?.otherUser && chat.otherUser.uid === otherUserId) {
    return chat.otherUser;
  }
  return null;
};

// Memoized Chat Header Component

interface ChatHeaderProps {
  otherUserProfile: UserProfile | null;
  otherUserPresence: { status: string; lastSeen?: any } | null;
  onBackClick: () => void;
  onSearchInChatClick: () => void;
  onDropdownToggle: () => void;
  showOptionsDropdown: boolean;
  activeChat: ExtendedChat;
  currentUserId: string;
  handleTogglePinChat: () => void;
  handleToggleArchiveChat: () => void;
  handleToggleMuteChat: () => void;
  handleToggleBlockUser: () => void;
  setShowReportModal: (show: boolean) => void;
  blockedUsers: string[];
  formatLastSeen: (timestamp: any) => string;
  onSelectUser?: (userId: string) => void;
  hasExchangedMessages?: boolean;
  onVoiceCall?: () => void;
  onVideoCall?: () => void;
  otherUserTyping?: boolean;
  onOpenGallery?: () => void;
  onOpenStarred?: () => void;
  onOpenWallpaper?: () => void;
  onOpenChatInfo?: () => void;
}

const ChatHeader = React.memo(({
  otherUserProfile,
  otherUserPresence,
  onBackClick,
  onSearchInChatClick,
  onDropdownToggle,
  showOptionsDropdown,
  activeChat,
  currentUserId,
  handleTogglePinChat,
  handleToggleArchiveChat,
  handleToggleMuteChat,
  handleToggleBlockUser,
  setShowReportModal,
  blockedUsers,
  formatLastSeen,
  onSelectUser,
  hasExchangedMessages = true,
  onVoiceCall,
  onVideoCall,
  otherUserTyping = false,
  onOpenGallery,
  onOpenStarred,
  onOpenWallpaper,
  onOpenChatInfo,
}: ChatHeaderProps) => {
  const isOnline = otherUserPresence?.status === "online";
  const statusText = otherUserTyping 
    ? "typing..." 
    : isOnline 
    ? "Active now" 
    : formatLastSeen(otherUserPresence?.lastSeen);

  return (
    <div className="shrink-0 flex-none bg-[#FAF8F4]/95 dark:bg-[#101014]/95 backdrop-blur-md text-[#0D0D0F] dark:text-[#F7F4EE] border-b border-[#E8E4DB]/90 dark:border-white/[0.07] flex items-center justify-between px-2.5 sm:px-4 shadow-[0_1px_3px_rgba(13,13,15,0.05)] relative z-20 select-none w-full pt-[env(safe-area-inset-top,0px)] min-h-[calc(56px+env(safe-area-inset-top,0px))]">
      {/* Left: Back button + User Identity */}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <button 
          onClick={onBackClick}
          className="md:hidden w-9 h-9 -ml-0.5 rounded-full text-[#0D0D0F] dark:text-[#F7F4EE] hover:bg-[#C9A96E]/15 transition-colors shrink-0 cursor-pointer flex items-center justify-center active:scale-95"
          title="Back to conversations"
          aria-label="Back"
        >
          <ChevronLeft size={23} />
        </button>

        <div className="flex items-center min-w-0 flex-1">
          {!otherUserProfile ? (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-[#E8E4DB] dark:bg-neutral-800 animate-pulse shrink-0" />
              <div className="flex flex-col gap-1.5 justify-center min-w-0">
                <div className="w-24 h-3 bg-[#E8E4DB] dark:bg-neutral-800 rounded animate-pulse" />
                <div className="w-16 h-2 bg-[#E8E4DB] dark:bg-neutral-800 rounded animate-pulse" />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (onOpenChatInfo) onOpenChatInfo();
                else onSelectUser?.(otherUserProfile.uid);
              }}
              className="group flex items-center gap-2.5 text-left outline-none focus:outline-none cursor-pointer py-1 px-1 rounded-xl hover:bg-[#C9A96E]/10 active:bg-[#C9A96E]/15 transition-colors relative overflow-hidden min-w-0"
            >
              <div className="relative shrink-0 flex items-center">
                <SmartImage 
                  src={otherUserProfile.photoUrl || otherUserProfile.profilePhotoUrl} 
                  alt={otherUserProfile.fullName || "User"} 
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border border-[#C9A96E]/35 object-cover shrink-0" 
                  fallbackType="profile" 
                  fullName={otherUserProfile.fullName} 
                />
                {isOnline && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#FAF8F4] dark:border-[#101014] bg-[#C9A96E]" />
                )}
              </div>

              <div className="flex flex-col justify-center min-w-0">
                <h3 className="text-[15.5px] font-semibold text-[#0D0D0F] dark:text-[#F7F4EE] leading-tight truncate max-w-[165px] xs:max-w-[205px] sm:max-w-[280px]">
                  {otherUserProfile.fullName || "Member"}
                </h3>
                <div className="flex items-center gap-1 leading-none text-[11.5px] text-[#71717A] dark:text-[#A1A1AA] mt-0.5 min-w-0">
                  <span className={`truncate max-w-[155px] sm:max-w-[200px] ${otherUserTyping ? "text-[#B58E47] dark:text-[#C9A96E] font-medium italic" : isOnline ? "text-[#9A783A] dark:text-[#C9A96E] font-medium" : "font-normal"}`}>
                    {statusText}
                  </span>
                </div>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Right: Real Calling Actions & Options Menu */}
      <div className="relative flex items-center gap-0.5 sm:gap-1 shrink-0">
        {onVideoCall && (
          <button
            id="chat-header-video-call-btn"
            type="button"
            onClick={onVideoCall}
            className="w-9 h-9 rounded-full hover:bg-[#C9A96E]/15 text-[#0D0D0F] dark:text-[#F7F4EE] hover:text-[#9A783A] dark:hover:text-[#C9A96E] active:scale-95 transition-colors duration-150 cursor-pointer flex items-center justify-center shrink-0"
            title="Start video call"
            aria-label="Start video call"
          >
            <Video size={20} strokeWidth={1.9} />
          </button>
        )}

        {onVoiceCall && (
          <button
            id="chat-header-voice-call-btn"
            type="button"
            onClick={onVoiceCall}
            className="w-9 h-9 rounded-full hover:bg-[#C9A96E]/15 text-[#0D0D0F] dark:text-[#F7F4EE] hover:text-[#9A783A] dark:hover:text-[#C9A96E] active:scale-95 transition-colors duration-150 cursor-pointer flex items-center justify-center shrink-0"
            title="Start voice call"
            aria-label="Start voice call"
          >
            <Phone size={19} strokeWidth={1.9} />
          </button>
        )}

        <button 
          id="chat-header-options-btn"
          onClick={onDropdownToggle}
          className="w-8 h-8 rounded-full text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/10 active:scale-95 transition-all duration-150 cursor-pointer flex items-center justify-center shrink-0 border border-transparent hover:border-neutral-200/60 dark:hover:border-white/10"
          title="More options"
          aria-label="More options"
        >
          <MoreVertical size={17} />
        </button>
        
        <AnimatePresence>
          {showOptionsDropdown && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -6 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute right-0 top-[44px] w-52 bg-white dark:bg-[#18191f] border border-neutral-200/80 dark:border-neutral-800 rounded-2xl shadow-xl p-1.5 z-50 text-xs font-medium text-neutral-800 dark:text-neutral-100"
            >
              {onOpenChatInfo && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenChatInfo();
                    onDropdownToggle();
                  }}
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  <UserCheck size={14} className="text-amber-600 dark:text-amber-400" />
                  <span>Contact Info</span>
                </button>
              )}

              {onVoiceCall && (
                <button
                  type="button"
                  onClick={() => {
                    onVoiceCall();
                    onDropdownToggle();
                  }}
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  <Phone size={14} className="text-amber-600 dark:text-amber-400" />
                  <span>Start Voice Call</span>
                </button>
              )}

              {onVideoCall && (
                <button
                  type="button"
                  onClick={() => {
                    onVideoCall();
                    onDropdownToggle();
                  }}
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  <Video size={14} className="text-amber-600 dark:text-amber-400" />
                  <span>Start Video Call</span>
                </button>
              )}

              {(onVoiceCall || onVideoCall) && (
                <div className="border-t border-neutral-200/80 dark:border-white/10 my-1" />
              )}

              <button 
                onClick={() => {
                  onSearchInChatClick();
                  onDropdownToggle();
                }}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
              >
                <SearchIcon size={14} className="text-amber-600 dark:text-amber-400" />
                <span>Search in Conversation</span>
              </button>

              {onOpenGallery && (
                <button 
                  type="button"
                  onClick={() => {
                    onOpenGallery();
                    onDropdownToggle();
                  }}
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  <ImageIcon size={14} className="text-amber-600 dark:text-amber-400" />
                  <span>Media, Links & Docs</span>
                </button>
              )}

              {onOpenStarred && (
                <button 
                  type="button"
                  onClick={() => {
                    onOpenStarred();
                    onDropdownToggle();
                  }}
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  <Star size={14} className="text-amber-500" />
                  <span>Starred Messages</span>
                </button>
              )}

              {onOpenWallpaper && (
                <button 
                  type="button"
                  onClick={() => {
                    onOpenWallpaper();
                    onDropdownToggle();
                  }}
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  <Palette size={14} className="text-amber-600 dark:text-amber-400" />
                  <span>Chat Wallpaper</span>
                </button>
              )}

              <button 
                onClick={() => {
                  handleTogglePinChat();
                  onDropdownToggle();
                }}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
              >
                <Pin size={14} className="rotate-45 text-amber-600 dark:text-amber-400" />
                <span>{activeChat?.pinnedUsers?.includes(currentUserId) ? "Unpin Chat" : "Pin Chat"}</span>
              </button>
              
              <button 
                onClick={() => {
                  handleToggleArchiveChat();
                  onDropdownToggle();
                }}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
              >
                <Archive size={14} className="text-neutral-500 dark:text-neutral-400" />
                <span>{activeChat?.archivedUsers?.includes(currentUserId) ? "Unarchive" : "Archive"}</span>
              </button>

              <button 
                onClick={() => {
                  handleToggleMuteChat();
                  onDropdownToggle();
                }}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
              >
                {activeChat?.mutedUsers?.includes(currentUserId) ? <Bell size={14} className="text-amber-600 dark:text-amber-400" /> : <BellOff size={14} className="text-neutral-500 dark:text-neutral-400" />}
                <span>{activeChat?.mutedUsers?.includes(currentUserId) ? "Unmute Notifications" : "Mute Notifications"}</span>
              </button>

              <div className="border-t border-neutral-200/80 dark:border-white/10 my-1" />

              <button 
                onClick={() => {
                  handleToggleBlockUser();
                  onDropdownToggle();
                }}
                disabled={!(activeChat?.otherUserId || otherUserProfile?.uid)}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-rose-500 hover:bg-rose-500/10 rounded-xl transition cursor-pointer disabled:opacity-50"
              >
                <Ban size={14} className="text-rose-500" />
                <span>{(activeChat?.otherUserId || otherUserProfile?.uid) && blockedUsers.includes(activeChat?.otherUserId || otherUserProfile?.uid || "") ? "Unblock User" : "Block User"}</span>
              </button>

              <button 
                onClick={() => {
                  setShowReportModal(true);
                  onDropdownToggle();
                }}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
              >
                <ShieldAlert size={14} className="text-neutral-500 dark:text-neutral-400" />
                <span>Report Account</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});

ChatHeader.displayName = "ChatHeader";

export default function MessagesView({ 
  currentUserId, 
  initialChatId, 
  activeChatId, 
  onCloseChat, 
  onSelectUser,
  onChatSelect,
  onActiveChatChange,
  onStartCall,
}: MessagesViewProps) {
  const { currentUserProfile, chats: globalChats, loadingChats, refreshChats, messagesCache, setMessagesInCache, profilesCache, fetchProfile, updateProfile } = useApp();
  
  // Navigation & View States
  const [activeChat, setActiveChat] = useState<ExtendedChat | null>(null);
  const [displayChat, setDisplayChat] = useState<ExtendedChat | null>(null);

  // Retain active chat during the sliding exit animation to prevent unmount flashes
  useEffect(() => {
    if (activeChat) {
      setDisplayChat(activeChat);
    } else {
      const timer = setTimeout(() => {
        setDisplayChat(null);
      }, 320);
      return () => clearTimeout(timer);
    }
  }, [activeChat]);

  // Instagram-style Notes State (24h expiring + synced via UserProfile with 0 extra reads)
  const [userNoteObj, setUserNoteObj] = useState<UserNote | null>(() => {
    const profileNote = getValidActiveNote(currentUserProfile?.activeNote);
    if (profileNote) return profileNote;
    try {
      const savedV2 = safeLocalStorage.getItem(`swap_user_note_v2_${currentUserId}`);
      if (savedV2) {
        return getValidActiveNote(JSON.parse(savedV2));
      }
      const legacy = safeLocalStorage.getItem(`swap_user_note_${currentUserId}`);
      if (legacy && legacy.trim()) {
        const now = Date.now();
        return { text: legacy.trim(), createdAt: now, expiresAt: now + 24 * 60 * 60 * 1000 };
      }
    } catch {}
    return null;
  });
  const [isEditingNote, setIsEditingNote] = useState<boolean>(false);
  const [viewingContactNote, setViewingContactNote] = useState<NoteTrayContact | null>(null);

  useEffect(() => {
    if (currentUserProfile?.activeNote !== undefined) {
      const valid = getValidActiveNote(currentUserProfile.activeNote);
      setUserNoteObj(valid);
      try {
        if (valid) {
          safeLocalStorage.setItem(`swap_user_note_v2_${currentUserId}`, JSON.stringify(valid));
        } else {
          safeLocalStorage.removeItem(`swap_user_note_v2_${currentUserId}`);
          safeLocalStorage.removeItem(`swap_user_note_${currentUserId}`);
        }
      } catch {}
    }
  }, [currentUserProfile?.activeNote, currentUserId]);

  const [messages, setMessages] = useState<ExtendedMessage[]>([]);
  const [messageWindowLimit, setMessageWindowLimit] = useState<number>(60);
  const [hasOlderMessages, setHasOlderMessages] = useState<boolean>(false);
  const confirmedLocalSentIdsRef = useRef<Set<string>>(new Set());
  const seenRenderedMsgKeysRef = useRef<Set<string>>(new Set());
  const activeListeningChatIdRef = useRef<string | null>(null);
  
  // Load other user details for all filtered chats
  const [chatProfiles, setChatProfiles] = useState<Record<string, UserProfile>>({});

  const effectiveChat = activeChat || displayChat;

  const otherUserId = useMemo(() => {
    return getOtherParticipantId(effectiveChat, currentUserId);
  }, [effectiveChat, currentUserId]);

  const otherUserProfile = useMemo(() => {
    return resolveOtherUserProfile(otherUserId, effectiveChat, profilesCache, chatProfiles);
  }, [otherUserId, effectiveChat, profilesCache, chatProfiles]);

  // Synchronize active chat state to parent App (for responsive layout adaptation and bottom nav control)
  const isInitialMountRef = useRef(true);
  const prevReportedActiveRef = useRef<{ hasActive: boolean; id: string | null }>({
    hasActive: false,
    id: null,
  });

  useEffect(() => {
    const hasActive = Boolean(activeChat);
    const id = activeChat?.id || null;

    // If mounting and an activeChatId prop was provided, do not immediately broadcast false/null
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      if (!hasActive && activeChatId) {
        return;
      }
    }

    if (
      prevReportedActiveRef.current.hasActive === hasActive &&
      prevReportedActiveRef.current.id === id
    ) {
      return;
    }

    prevReportedActiveRef.current = { hasActive, id };

    if (onActiveChatChange) {
      onActiveChatChange(hasActive, id);
    }
  }, [activeChat?.id, onActiveChatChange]);

  // Synchronize active chat tracking for notification suppression
  useEffect(() => {
    if (activeChat && activeChat.id) {
      activeChatTrackingService.setActiveChat({
        chatId: activeChat.id,
        partnerId: otherUserId || null,
        participantIds: activeChat.participantIds || [],
      });
    } else {
      activeChatTrackingService.setActiveChat(null);
    }
  }, [activeChat?.id, otherUserId]);

  useEffect(() => {
    return () => {
      activeChatTrackingService.setActiveChat(null);
    };
  }, []);

  const handleInitiateVoiceCall = useCallback(() => {
    if (!activeChat) return;
    const resolvedOtherId = otherUserId || activeChat?.otherUserId || getOtherParticipantId(activeChat, currentUserId);
    const targetUser = otherUserProfile || (resolvedOtherId ? ({
      uid: resolvedOtherId,
      id: resolvedOtherId,
      fullName: (activeChat as any).otherUserName || (activeChat as any).name || (activeChat as any).partnerName || "Contact",
      photoUrl: (activeChat as any).otherUserPhoto || (activeChat as any).partnerPhoto || "",
      photoURL: (activeChat as any).otherUserPhoto || (activeChat as any).partnerPhoto || "",
    } as unknown as UserProfile) : null);
    if (!targetUser) return;
    if (onStartCall) {
      onStartCall(targetUser, "audio", activeChat.id);
    }
  }, [otherUserProfile, otherUserId, activeChat, currentUserId, onStartCall]);

  const handleInitiateVideoCall = useCallback(() => {
    if (!activeChat) return;
    const resolvedOtherId = otherUserId || activeChat?.otherUserId || getOtherParticipantId(activeChat, currentUserId);
    const targetUser = otherUserProfile || (resolvedOtherId ? ({
      uid: resolvedOtherId,
      id: resolvedOtherId,
      fullName: (activeChat as any).otherUserName || (activeChat as any).name || (activeChat as any).partnerName || "Contact",
      photoUrl: (activeChat as any).otherUserPhoto || (activeChat as any).partnerPhoto || "",
      photoURL: (activeChat as any).otherUserPhoto || (activeChat as any).partnerPhoto || "",
    } as unknown as UserProfile) : null);
    if (!targetUser) return;
    if (onStartCall) {
      onStartCall(targetUser, "video", activeChat.id);
    }
  }, [otherUserProfile, otherUserId, activeChat, currentUserId, onStartCall]);

  useEffect(() => {
    if (otherUserId && !otherUserProfile && fetchProfile) {
      fetchProfile(otherUserId).catch(err => {
        console.error("Error loading other user profile:", err);
      });
    }
  }, [otherUserId, otherUserProfile, fetchProfile]);

  // Search state for conversations and new contacts
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  
  // Chat list filter & Instagram-style requests state
  const [chatFilterText, setChatFilterText] = useState("");
  const [showRequestsView, setShowRequestsView] = useState(false);
  const [requestsSearchText, setRequestsSearchText] = useState("");

  // Camera Capture States & Instagram One-Time Camera
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [showInstagramCamera, setShowInstagramCamera] = useState(false);
  const [viewingViewOnceMessage, setViewingViewOnceMessage] = useState<ExtendedMessage | null>(null);

  // Block & Report States
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [blockedByUsers, setBlockedByUsers] = useState<string[]>([]);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockModalTarget, setBlockModalTarget] = useState<UserProfile | null>(null);
  const [blockModalMode, setBlockModalMode] = useState<"block" | "unblock">("block");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCategory, setReportCategory] = useState("Spam");
  const [reportComments, setReportComments] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  // Mobile Keyboard & Viewport Insets
  const { isKeyboardOpen, keyboardInset, visualViewportHeight, lastKeyboardHeight } = useKeyboardViewport();

  // Input & Edit States
  const [typedMessage, setTypedMessage] = useState("");
  const [editingMessage, setEditingMessage] = useState<ExtendedMessage | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<ExtendedMessage | null>(null);
  const [searchInChatText, setSearchInChatText] = useState("");
  const [showSearchInChat, setShowSearchInChat] = useState(false);

  // Real-time @ mention autocomplete states (Zero-quota priority using in-memory cache)
  const [mentionQuery, setMentionQuery] = useState<string>("");
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState<boolean>(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState<number>(0);
  const [remoteMentionUsers, setRemoteMentionUsers] = useState<UserProfile[]>([]);
  const mentionSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const viewportTransitionUntilRef = useRef<number>(0);
  const emojiCursorPosRef = useRef<number | null>(null);

  // Close mention popup and emoji keyboard if user switches chat
  useEffect(() => {
    setShowMentionSuggestions(false);
    setMentionQuery("");
    setMentionStartIndex(-1);
    setShowEmojiPicker(false);
    emojiCursorPosRef.current = null;
  }, [activeChat?.id]);

  // Zero-quota in-memory pool of potential mentions:
  // Combines active chat partner, all chat profiles in current conversations, cached profiles, and current user
  const knownMentionUsers = useMemo<UserProfile[]>(() => {
    const map = new Map<string, UserProfile>();
    if (otherUserProfile?.uid) {
      map.set(otherUserProfile.uid, otherUserProfile);
    }
    (Object.values(chatProfiles || {}) as UserProfile[]).forEach((p) => {
      if (p?.uid && !map.has(p.uid)) map.set(p.uid, p);
    });
    (Object.values(profilesCache || {}) as UserProfile[]).forEach((p) => {
      if (p?.uid && !map.has(p.uid)) map.set(p.uid, p);
    });
    if (currentUserProfile?.uid && !map.has(currentUserProfile.uid)) {
      map.set(currentUserProfile.uid, currentUserProfile);
    }
    remoteMentionUsers.forEach((p) => {
      if (p?.uid && !map.has(p.uid)) map.set(p.uid, p);
    });
    return Array.from(map.values()).filter(p => !p.isDeleted && !p.deleted && p.status !== "deleted");
  }, [otherUserProfile, chatProfiles, profilesCache, currentUserProfile, remoteMentionUsers]);

  const mentionSuggestions = useMemo<UserProfile[]>(() => {
    if (!showMentionSuggestions) return [];
    const q = (mentionQuery || "").toLowerCase().trim();
    if (!q) {
      // Suggest active chat partner first, then recent contacts
      return knownMentionUsers.slice(0, 6);
    }
    return knownMentionUsers
      .filter((u) => {
        const usernameMatch = (u.username || "").toLowerCase().includes(q);
        const nameMatch = (u.fullName || "").toLowerCase().includes(q);
        return usernameMatch || nameMatch;
      })
      .slice(0, 6);
  }, [showMentionSuggestions, mentionQuery, knownMentionUsers]);

  // Remote search fallback ONLY when local results are scarce and query is >= 2 chars, debounced to protect quota
  useEffect(() => {
    if (!showMentionSuggestions) return;
    const clean = (mentionQuery || "").toLowerCase().trim();
    if (clean.length < 2 || mentionSuggestions.length >= 3) {
      if (mentionSearchTimeoutRef.current) {
        clearTimeout(mentionSearchTimeoutRef.current);
        mentionSearchTimeoutRef.current = null;
      }
      return;
    }

    if (mentionSearchTimeoutRef.current) {
      clearTimeout(mentionSearchTimeoutRef.current);
    }

    mentionSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchUsers(clean, { currentUserId, limitCount: 4 });
        if (results && results.length > 0) {
          setRemoteMentionUsers((prev) => {
            const next = [...prev];
            results.forEach((r) => {
              if (!next.some((p) => p.uid === r.uid)) {
                next.push(r);
              }
            });
            return next;
          });
        }
      } catch (err) {
        console.warn("Mention remote search error:", err);
      }
    }, 350);

    return () => {
      if (mentionSearchTimeoutRef.current) {
        clearTimeout(mentionSearchTimeoutRef.current);
      }
    };
  }, [mentionQuery, showMentionSuggestions, mentionSuggestions.length, currentUserId]);

  // Auto-grow input textarea height based on typing text without layout thrashing
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const scrollH = el.scrollHeight;
    const minH = 36;
    const maxH = 110;
    const targetHeight = Math.min(Math.max(scrollH, minH), maxH);
    el.style.height = `${targetHeight}px`;
    el.style.overflowY = scrollH > maxH ? "auto" : "hidden";

    // If anchored to bottom, ensure container stays pinned when input grows
    if (isNearBottomRef.current && chatScrollContainerRef.current) {
      const container = chatScrollContainerRef.current;
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [typedMessage, adjustTextareaHeight]);

  // Insert selected mention into message input
  const handleSelectMention = useCallback((user: UserProfile) => {
    const handle = user.username || user.fullName?.replace(/\s+/g, "").toLowerCase() || user.uid;
    const replacement = `@${handle} `;

    const text = typedMessage;
    const atIdx = mentionStartIndex >= 0 ? mentionStartIndex : text.lastIndexOf("@");
    if (atIdx === -1) {
      setTypedMessage((prev) => prev + replacement);
      setShowMentionSuggestions(false);
      return;
    }

    const beforeMention = text.slice(0, atIdx);
    const afterMention = text.slice(atIdx + 1 + mentionQuery.length);

    const newText = `${beforeMention}${replacement}${afterMention}`;
    setTypedMessage(newText);
    setShowMentionSuggestions(false);
    setMentionQuery("");
    setMentionStartIndex(-1);
    setSelectedMentionIndex(0);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const cursorPosition = beforeMention.length + replacement.length;
        textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
        adjustTextareaHeight();
      }
    }, 20);
  }, [typedMessage, mentionStartIndex, mentionQuery, adjustTextareaHeight]);
  
  // Interactive Overlays & Actions
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [selectedMsgCoords, setSelectedMsgCoords] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  // Multi-message selection mode (WhatsApp style)
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());

  // Delete Confirmation Modal States
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [deleteTargetMessages, setDeleteTargetMessages] = useState<ExtendedMessage[]>([]);

  // Forward Modal States
  const [showForwardModal, setShowForwardModal] = useState<boolean>(false);
  const [forwardTargetMessages, setForwardTargetMessages] = useState<ExtendedMessage[]>([]);

  // Smooth scroll target pulse
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);

  // Swipe-to-reply states & gesture tracking
  const [swipingMsgId, setSwipingMsgId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const swipeThresholdCrossedRef = useRef<boolean>(false);
  const touchCoordRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);

  // Deletion idempotency locks & client tracking
  const isDeletingMsgRef = useRef<Set<string>>(new Set());
  const deletedForMeSetRef = useRef<Set<string>>(new Set());
  const deletedForEveryoneSetRef = useRef<Set<string>>(new Set());
  
  // Message Reactions States
  const [reactionsDetailMsg, setReactionsDetailMsg] = useState<ExtendedMessage | null>(null);
  const [bursts, setBursts] = useState<{ id: string; emoji: string; x: number; y: number }[]>([]);
  const [detailTab, setDetailTab] = useState<string>("All");
  const [activeReactionInfo, setActiveReactionInfo] = useState<{ msgId: string; emoji: string } | null>(null);

  const handleInsertEmoji = (emoji: string) => {
    setTypedMessage((prev) => {
      const textarea = textareaRef.current;
      const fallbackPos = emojiCursorPosRef.current !== null ? Math.min(emojiCursorPosRef.current, prev.length) : prev.length;
      const start = textarea && document.activeElement === textarea
        ? (textarea.selectionStart ?? fallbackPos)
        : fallbackPos;
      const end = textarea && document.activeElement === textarea
        ? (textarea.selectionEnd ?? start)
        : start;
      const next = prev.substring(0, start) + emoji + prev.substring(end);
      const nextCursor = start + emoji.length;
      emojiCursorPosRef.current = nextCursor;

      // Never call .focus() while docked emoji keyboard is open (otherwise Android Gboard pops up over it)
      if (textarea && !showEmojiPicker && document.activeElement === textarea) {
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = textareaRef.current.selectionEnd = nextCursor;
          }
        }, 0);
      }
      return next;
    });
  };

  const handleDeleteEmojiChar = () => {
    setTypedMessage((prev) => {
      if (!prev) {
        emojiCursorPosRef.current = 0;
        return "";
      }
      const textarea = textareaRef.current;
      const pos = textarea && document.activeElement === textarea
        ? (textarea.selectionStart ?? prev.length)
        : (emojiCursorPosRef.current !== null ? Math.min(emojiCursorPosRef.current, prev.length) : prev.length);

      const beforeCursor = prev.slice(0, pos);
      const afterCursor = prev.slice(pos);
      if (!beforeCursor) return prev;

      let nextBefore = "";
      if (typeof Intl !== "undefined" && (Intl as any).Segmenter) {
        const segmenter = new (Intl as any).Segmenter(undefined, { granularity: "grapheme" });
        const segments = Array.from(segmenter.segment(beforeCursor)) as Array<{ segment: string }>;
        segments.pop();
        nextBefore = segments.map((s) => s.segment).join("");
      } else {
        const chars = Array.from(beforeCursor);
        chars.pop();
        nextBefore = chars.join("");
      }

      emojiCursorPosRef.current = nextBefore.length;
      return nextBefore + afterCursor;
    });
  };

  // Measure message bubble coordinates when selected
  useEffect(() => {
    if (selectedMsgId) {
      const el = document.getElementById(`msg-bubble-${selectedMsgId}`);
      if (el) {
        const rect = el.getBoundingClientRect();
        setSelectedMsgCoords({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        });
        return;
      }
    }
    setSelectedMsgCoords(null);
  }, [selectedMsgId]);

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimeoutRef = useRef<any>(null);
  const hasMovedRef = useRef<boolean>(false);

  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [fullscreenVideo, setFullscreenVideo] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showOptionsDropdown, setShowOptionsDropdown] = useState(false);
  const [showChatInfoModal, setShowChatInfoModal] = useState(false);

  // Back button interception for overlays & open subviews in MessagesView
  useBackHandler(selectedMsgIds.size > 0, () => {
    setSelectedMsgIds(new Set());
  });
  useBackHandler(showDeleteModal, () => {
    setShowDeleteModal(false);
    setDeleteTargetMessages([]);
  });
  useBackHandler(showForwardModal, () => {
    setShowForwardModal(false);
  });
  useBackHandler(showBlockModal, () => {
    setShowBlockModal(false);
  });
  useBackHandler(showReportModal, () => {
    setShowReportModal(false);
  });
  useBackHandler(isEditingNote, () => {
    setIsEditingNote(false);
  });
  useBackHandler(Boolean(viewingContactNote), () => {
    setViewingContactNote(null);
  });
  useBackHandler(Boolean(fullscreenImage), () => {
    setFullscreenImage(null);
  });
  useBackHandler(Boolean(fullscreenVideo), () => {
    setFullscreenVideo(null);
  });
  useBackHandler(showEmojiPicker, () => {
    setShowEmojiPicker(false);
  });
  useBackHandler(showOptionsDropdown, () => {
    setShowOptionsDropdown(false);
  });
  useBackHandler(showSearchInChat, () => {
    setShowSearchInChat(false);
  });
  useBackHandler(showChatInfoModal, () => {
    setShowChatInfoModal(false);
  });
  useBackHandler(Boolean(selectedMsgId), () => {
    setSelectedMsgId(null);
  });
  useBackHandler(Boolean(activeChat), () => {
    setActiveChat(null);
    if (onChatSelect) onChatSelect(null);
    if (onCloseChat) onCloseChat();
  });
  useBackHandler(showRequestsView && !activeChat, () => {
    setShowRequestsView(false);
  });

  // Loading & Pagination States
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesLimit, setMessagesLimit] = useState(20);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  
  // Typing & Connection States
  const [isTyping, setIsTyping] = useState(false);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const [otherUserPresence, setOtherUserPresence] = useState<{ status: string; lastSeen?: any } | null>(null);
  
  // Upload State Tracking
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadError, setUploadError] = useState<Record<string, string>>({});
  
  // Voice Recording Live / Simulated State
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [voiceWaves, setVoiceWaves] = useState<number[]>([]);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);

  const [draftIsPlaying, setDraftIsPlaying] = useState(false);
  const [draftDuration, setDraftDuration] = useState(0);
  const [draftCurrentTime, setDraftCurrentTime] = useState(0);
  
  const draftAudioRef = useRef<HTMLAudioElement | null>(null);

  // New WhatsApp-style Features States
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [currentWallpaperId, setCurrentWallpaperId] = useState<string>("default");
  const [wallpaperCustomUrl, setWallpaperCustomUrl] = useState<string | null>(null);
  const [wallpaperDim, setWallpaperDim] = useState<number>(0.35);
  const [wallpaperBlur, setWallpaperBlur] = useState<boolean>(false);
  const [showStarredModal, setShowStarredModal] = useState(false);
  const [showGalleryModal, setShowGalleryModal] = useState(false);
  const [infoMessage, setInfoMessage] = useState<ExtendedMessage | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [unreadAwayCount, setUnreadAwayCount] = useState(0);

  // Sync wallpaper preference for active chat with real-time bidirectional Firestore sync
  useEffect(() => {
    if (!activeChat) {
      setCurrentWallpaperId("default");
      setWallpaperCustomUrl(null);
      setWallpaperDim(0.35);
      setWallpaperBlur(false);
      return;
    }

    const chatId = activeChat.id;

    // 1. Initial fast local cache recall
    const saved = safeLocalStorage.getItem(`swapskill_wallpaper_${chatId}`) ||
                  safeLocalStorage.getItem("swapskill_wallpaper_default") ||
                  "default";
    const customImg = safeLocalStorage.getItem(`swapskill_custom_wallpaper_${chatId}`) ||
                      safeLocalStorage.getItem("swapskill_custom_wallpaper_default") ||
                      null;
    const dimVal = safeLocalStorage.getItem(`swapskill_wallpaper_dim_${chatId}`) ||
                   safeLocalStorage.getItem("swapskill_wallpaper_dim_default");
    const blurVal = safeLocalStorage.getItem(`swapskill_wallpaper_blur_${chatId}`) ||
                    safeLocalStorage.getItem("swapskill_wallpaper_blur_default");

    setCurrentWallpaperId(saved);
    setWallpaperCustomUrl(customImg);
    if (dimVal) setWallpaperDim(parseFloat(dimVal));
    if (blurVal) setWallpaperBlur(blurVal === "true");

    // 2. Real-time Firestore synchronization listener for both chat participants
    const applyRemoteWallpaper = (data: any) => {
      if (data && data.wallpaper) {
        const wp = data.wallpaper;
        const newPresetId = wp.id || wp.presetId || "default";
        const newCustomUrl = wp.customUrl || null;
        const newDim = typeof wp.dim === "number" ? wp.dim : 0.35;
        const newBlur = Boolean(wp.blur);

        setCurrentWallpaperId(newPresetId);
        setWallpaperCustomUrl(newCustomUrl);
        setWallpaperDim(newDim);
        setWallpaperBlur(newBlur);

        safeLocalStorage.setItem(`swapskill_wallpaper_${chatId}`, newPresetId);
        safeLocalStorage.setItem(`swapskill_wallpaper_dim_${chatId}`, newDim.toString());
        safeLocalStorage.setItem(`swapskill_wallpaper_blur_${chatId}`, newBlur ? "true" : "false");
        if (newCustomUrl) {
          safeLocalStorage.setItem(`swapskill_custom_wallpaper_${chatId}`, newCustomUrl);
        }
      }
    };

    const convRef = doc(db, "conversations", chatId);
    const unsubConv = onSnapshot(convRef, (snap) => {
      if (snap.exists()) {
        applyRemoteWallpaper(snap.data());
      }
    }, () => {});

    const chatRef = doc(db, "chats", chatId);
    const unsubChat = onSnapshot(chatRef, (snap) => {
      if (snap.exists()) {
        applyRemoteWallpaper(snap.data());
      }
    }, () => {});

    return () => {
      unsubConv();
      unsubChat();
    };
  }, [activeChat?.id]);

  const activeWallpaperPreset = useMemo(() => {
    if (currentWallpaperId === "custom" && wallpaperCustomUrl) {
      return {
        id: "custom",
        name: "My Custom Photo",
        category: "photos" as const,
        description: "From gallery",
        previewBg: "bg-black",
        imageUrl: wallpaperCustomUrl,
        backgroundColor: "#0D0D10",
        textColor: "text-zinc-100",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      };
    }
    return WALLPAPER_PRESETS.find(p => p.id === currentWallpaperId) || WALLPAPER_PRESETS[0];
  }, [currentWallpaperId, wallpaperCustomUrl]);

  // Starred messages derived state
  const starredMessages = useMemo(() => {
    return messages.filter(m => m.starredBy?.includes(currentUserId) && !m.deleted && !m.isDeleted);
  }, [messages, currentUserId]);

  const handleToggleStarMessage = useCallback(async (msg: ExtendedMessage | ContextMenuMessage) => {
    if (!activeChat) return;
    const ext = msg as ExtendedMessage;
    if (isEphemeralMediaMessage(ext)) {
      setToast({ message: "View once & replay media cannot be starred.", type: "info" });
      return;
    }
    const isStarred = msg.starredBy?.includes(currentUserId);
    const collectionName = ext.sourceCollection || (activeChat.isLegacy ? "chats" : "conversations");
    const chatId = ext.sourceChatId || activeChat.id;
    const msgDocRef = doc(db, collectionName, chatId, "messages", msg.id);

    // Optimistic state update
    setMessages(prev => prev.map(m => {
      if (m.id === msg.id) {
        const currentStarred = m.starredBy || [];
        const updatedStarred = isStarred
          ? currentStarred.filter(id => id !== currentUserId)
          : [...currentStarred, currentUserId];
        return { ...m, starredBy: updatedStarred };
      }
      return m;
    }));

    try {
      await updateDoc(msgDocRef, {
        starredBy: isStarred ? arrayRemove(currentUserId) : arrayUnion(currentUserId)
      });
    } catch (err) {
      console.error("Failed to toggle starred status:", err);
    }
  }, [activeChat, currentUserId]);

  const recorderRef = useRef<RecordRTC | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const lastLoggedMsgId = useRef<string | null>(null);
  const isFirstLoadRef = useRef(true);
  const chatOpenedAtRef = useRef<number>(Date.now());
  const isNearBottomRef = useRef(true);
  const userInteractingRef = useRef(false);
  const interactionTimerRef = useRef<any>(null);
  const recordIntervalRef = useRef<any>(null);
  const typingTimeoutRef = useRef<any>(null);
  const otherTypingTimerRef = useRef<any>(null);
  const activeChatRef = useRef<ExtendedChat | null>(activeChat);
  activeChatRef.current = activeChat;
  const isTypingRef = useRef(false);
  isTypingRef.current = isTyping;
  const lastTypingHeartbeatRef = useRef(0);
  const latestTypingIntentRef = useRef(false);
  const typingSeqRef = useRef(0);
  const markedSeenIdsRef = useRef<Set<string>>(new Set());

  // Synchronize typing status to Firestore with monotonic sequence, timestamp, and race protection
  const updateTypingStatus = useCallback(async (typing: boolean, targetChatId?: string) => {
    const chatId = targetChatId || activeChatRef.current?.id;
    if (!chatId || !currentUserId) return;

    const seq = ++typingSeqRef.current;
    const writeTime = Date.now();
    latestTypingIntentRef.current = typing;

    // If setting typing to false, cancel any pending typing timeouts
    if (!typing && typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    try {
      // Race protection: If a newer intent has superseded this one, abort delayed write
      if (typing === true && latestTypingIntentRef.current === false) {
        return;
      }
      if (typing === true && seq < typingSeqRef.current) {
        return;
      }

      const typingDocRef = doc(db, "typingStatus", chatId);
      await setDoc(typingDocRef, {
        [currentUserId]: typing,
        [`${currentUserId}_typing`]: typing,
        [`${currentUserId}_updatedAt`]: writeTime,
        [`${currentUserId}_seq`]: seq,
        updatedAt: writeTime
      }, { merge: true });
    } catch (err) {
      console.error("Error setting typing status:", err);
    }
  }, [currentUserId]);

  // Message scroll tracking refs to preserve position when older messages load
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledChatIdRef = useRef<string | null>(null);
  const chatAnchorLockUntilRef = useRef<number>(0);
  const prevFirstMsgIdRef = useRef<string | null>(null);
  const prevLastMsgIdRef = useRef<string | null>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const prevScrollTopRef = useRef<number>(0);

  const checkIsNearBottom = useCallback((threshold = 160) => {
    const container = chatScrollContainerRef.current;
    if (!container) return true;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distance <= threshold;
  }, []);

  const pinToBottomInstant = useCallback(() => {
    const container = chatScrollContainerRef.current;
    if (!container) return;
    const targetScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = targetScrollTop;
    prevScrollHeightRef.current = container.scrollHeight;
    prevScrollTopRef.current = container.scrollTop;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = chatScrollContainerRef.current;
    if (!container) return;
    const targetScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);

    if (behavior === "auto") {
      container.scrollTop = targetScrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevScrollTopRef.current = container.scrollTop;
    } else {
      container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    }
  }, []);

  // Monitor BOTH viewport container resize (keyboard, input bar) AND inner content resize (images, audio, link previews loading)
  useEffect(() => {
    const container = chatScrollContainerRef.current;
    if (!container) return;
    const contentEl = messagesContentRef.current;

    const handleAnyResize = () => {
      const shouldStickToBottom =
        !userInteractingRef.current &&
        (isNearBottomRef.current || Date.now() < chatAnchorLockUntilRef.current);

      if (shouldStickToBottom) {
        isNearBottomRef.current = true;
        pinToBottomInstant();
        if (Date.now() < chatAnchorLockUntilRef.current) {
          setShowScrollBottom(false);
          setUnreadAwayCount(0);
        }
      }
    };

    const ro = new ResizeObserver(() => {
      handleAnyResize();
    });
    ro.observe(container);
    if (contentEl) {
      ro.observe(contentEl);
    }

    // Also listen to visualViewport for mobile soft keyboard in WebView/Capacitor
    const vv = window.visualViewport;
    const handleVisualViewportChange = () => {
      if (!userInteractingRef.current && isNearBottomRef.current && chatScrollContainerRef.current) {
        pinToBottomInstant();
      }
    };

    if (vv) {
      vv.addEventListener("resize", handleVisualViewportChange);
      vv.addEventListener("scroll", handleVisualViewportChange);
    }

    return () => {
      ro.disconnect();
      if (vv) {
        vv.removeEventListener("resize", handleVisualViewportChange);
        vv.removeEventListener("scroll", handleVisualViewportChange);
      }
    };
  }, [activeChat?.id, loadingMessages, pinToBottomInstant]);

  // Re-anchor to bottom when keyboard or docked emoji drawer opens/closes (only if user was already near bottom)
  useEffect(() => {
    if (!userInteractingRef.current && isNearBottomRef.current && chatScrollContainerRef.current) {
      viewportTransitionUntilRef.current = Date.now() + 500;
      pinToBottomInstant();

      const rAf = requestAnimationFrame(() => {
        if (!userInteractingRef.current && isNearBottomRef.current && chatScrollContainerRef.current) {
          pinToBottomInstant();
        }
      });
      const timer1 = setTimeout(() => {
        if (!userInteractingRef.current && isNearBottomRef.current && chatScrollContainerRef.current) {
          pinToBottomInstant();
        }
      }, 120);
      const timer2 = setTimeout(() => {
        if (!userInteractingRef.current && isNearBottomRef.current && chatScrollContainerRef.current) {
          pinToBottomInstant();
        }
      }, 280);

      return () => {
        cancelAnimationFrame(rAf);
        clearTimeout(timer1);
        clearTimeout(timer2);
      };
    }
  }, [isKeyboardOpen, visualViewportHeight, keyboardInset, showEmojiPicker, otherUserTyping, pinToBottomInstant]);

  // Synchronize scroll position synchronously before paint when activeChat or messages change
  useLayoutEffect(() => {
    const currentChatId = activeChat?.id || null;
    if (currentChatId !== lastScrolledChatIdRef.current) {
      lastScrolledChatIdRef.current = currentChatId;
      isFirstLoadRef.current = true;
      isNearBottomRef.current = true;
      userInteractingRef.current = false;
      chatAnchorLockUntilRef.current = Date.now() + 1400;
      prevFirstMsgIdRef.current = null;
      prevLastMsgIdRef.current = null;
      prevScrollHeightRef.current = 0;
      prevScrollTopRef.current = 0;
      setShowScrollBottom(false);
      setUnreadAwayCount(0);
    }

    const container = chatScrollContainerRef.current;
    if (!container || messages.length === 0) return;

    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];
    const firstStableKey = firstMsg ? (firstMsg.clientMsgId || firstMsg.id) : null;
    const lastStableKey = lastMsg ? (lastMsg.clientMsgId || lastMsg.id) : null;

    const prevFirstId = prevFirstMsgIdRef.current;
    const prevLastId = prevLastMsgIdRef.current;
    const prevHeight = prevScrollHeightRef.current;
    const prevTop = prevScrollTopRef.current;

    const isInitial = isFirstLoadRef.current || !prevLastId;

    if (isInitial) {
      isFirstLoadRef.current = false;
      isNearBottomRef.current = true;
      chatAnchorLockUntilRef.current = Date.now() + 1400;
      pinToBottomInstant();
      setShowScrollBottom(false);
      setUnreadAwayCount(0);
      requestAnimationFrame(() => {
        if (!userInteractingRef.current && isNearBottomRef.current) {
          pinToBottomInstant();
        }
      });
    } else if (lastStableKey && lastStableKey !== prevLastId) {
      // New message appended at bottom
      const isSentByMe = lastMsg.senderId === currentUserId;
      if (isSentByMe) {
        // I sent a message: always scroll down smoothly
        isNearBottomRef.current = true;
        scrollToBottom("smooth");
        setUnreadAwayCount(0);
        setShowScrollBottom(false);
      } else if (isNearBottomRef.current || (!userInteractingRef.current && Date.now() < chatAnchorLockUntilRef.current)) {
        // Incoming message or initial hydration update: pin smoothly or instantly if still opening
        if (Date.now() < chatAnchorLockUntilRef.current) {
          pinToBottomInstant();
        } else {
          scrollToBottom("smooth");
        }
        setUnreadAwayCount(0);
        setShowScrollBottom(false);
      } else {
        // If user was reading older messages, DO NOT force scroll, show unread count!
        setUnreadAwayCount((prev) => prev + 1);
        setShowScrollBottom(true);
      }
    } else if (firstStableKey && firstStableKey !== prevFirstId && prevHeight > 0) {
      // Older messages were prepended at top: PRESERVE exact scroll position
      const heightDiff = container.scrollHeight - prevHeight;
      if (heightDiff > 0 && !isNearBottomRef.current) {
        container.scrollTop = prevTop + heightDiff;
      }
    } else if (!userInteractingRef.current && (isNearBottomRef.current || Date.now() < chatAnchorLockUntilRef.current)) {
      // Content updated (reactions, edits, delivery status, optimistic confirmation) while anchored at bottom
      pinToBottomInstant();
    }

    // Update tracking refs using stable keys so optimistic->server confirmation never double-scrolls
    prevFirstMsgIdRef.current = firstStableKey;
    prevLastMsgIdRef.current = lastStableKey;
    prevScrollHeightRef.current = container.scrollHeight;
    prevScrollTopRef.current = container.scrollTop;
  }, [activeChat?.id, messages, currentUserId, scrollToBottom, pinToBottomInstant]);

  // Synchronize target chat from props
  const targetId = activeChatId || initialChatId;
  const lastTargetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (targetId) {
      const match = globalChats.find((c) => c.id === targetId);
      if (match) {
        setActiveChat(prev => {
          if (prev && prev.id === targetId) {
            const hasChanged = 
              prev.lastMessage !== match.lastMessage ||
              prev.lastMessageSenderId !== match.lastMessageSenderId ||
              prev.lastMessageTime?.toString() !== match.lastMessageTime?.toString() ||
              prev.unreadCount !== match.unreadCount ||
              (!prev.otherUser && (match as ExtendedChat).otherUser);

            if (!hasChanged) {
              return prev;
            }

            return {
              ...prev,
              ...match,
              otherUser: prev.otherUser || (match as ExtendedChat).otherUser
            };
          }
          return match as ExtendedChat;
        });
        lastTargetIdRef.current = targetId;
      } else if (lastTargetIdRef.current !== targetId) {
        lastTargetIdRef.current = targetId;
        // Immediate optimistic activeChat placeholder if canonical ID
        const parts = targetId.split("_");
        const guessedOtherId = parts.length === 2 ? parts.find(id => id !== currentUserId) : null;
        if (guessedOtherId) {
          setActiveChat(prev => {
            if (prev && prev.id === targetId) return prev;
            return {
              id: targetId,
              participantIds: [currentUserId, guessedOtherId],
              lastMessage: "",
              lastMessageSenderId: "",
              lastMessageTime: new Date(),
              unreadCount: { [currentUserId]: 0, [guessedOtherId]: 0 },
              isLegacy: false,
              otherUser: profilesCache[guessedOtherId] || null,
            };
          });
        }

        // Parallel / Fast load chat doc
        const loadChatSilently = async () => {
          try {
            const [convSnap, chatSnap] = await Promise.all([
              getDoc(doc(db, "conversations", targetId)).catch(() => null),
              getDoc(doc(db, "chats", targetId)).catch(() => null),
            ]);

            const docSnap = (convSnap && convSnap.exists()) ? convSnap : (chatSnap && chatSnap.exists()) ? chatSnap : null;
            const isLegacy = !convSnap?.exists() && !!chatSnap?.exists();

            if (docSnap && docSnap.exists()) {
              const data = docSnap.data() as Chat;
              const otherId = Array.isArray(data.participantIds) ? data.participantIds.find(id => id !== currentUserId) : guessedOtherId;
              let otherUser: UserProfile | null = otherId && profilesCache[otherId] ? profilesCache[otherId] : null;
              if (otherId && !otherUser) {
                otherUser = await fetchProfile(otherId);
              }
              setActiveChat(prev => ({
                ...(prev || {}),
                ...data,
                id: docSnap.id,
                isLegacy,
                otherUser: otherUser || prev?.otherUser
              }));
            } else if (guessedOtherId) {
              // Ensure otherUser profile is loaded for header
              const otherUser = await fetchProfile(guessedOtherId);
              if (otherUser) {
                setActiveChat(prev => prev ? { ...prev, otherUser } : null);
              }
            }
          } catch (e) {
            console.error("Error loading target chat silently:", e);
          }
        };
        loadChatSilently();
      }
    } else {
      // Only reset activeChat if it was explicitly loaded from props and is now cleared.
      // This prevents closing the chat when selected via the local list sidebar.
      if (lastTargetIdRef.current) {
        setActiveChat(null);
        lastTargetIdRef.current = null;
      }
    }
  }, [targetId, globalChats, currentUserId]);

  // Presence is managed globally by AppContext to conserve Firestore write quota.

  // Clean up typing status on tab switch, window minimize, disconnect, or page unload
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (isTypingRef.current && activeChatRef.current?.id) {
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = null;
          }
          isTypingRef.current = false;
          setIsTyping(false);
          updateTypingStatus(false, activeChatRef.current.id);
        }
      }
    };

    const handleBeforeUnload = () => {
      if (isTypingRef.current && activeChatRef.current?.id) {
        updateTypingStatus(false, activeChatRef.current.id);
      }
    };

    const handleOffline = () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (otherTypingTimerRef.current) {
        clearTimeout(otherTypingTimerRef.current);
        otherTypingTimerRef.current = null;
      }
      isTypingRef.current = false;
      setIsTyping(false);
      setOtherUserTyping(false);
    };

    const handleOnline = () => {
      // On network reconnect, never automatically restore old typing=true
      isTypingRef.current = false;
      setIsTyping(false);
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [currentUserId, updateTypingStatus]);

  // Listen for instant notification reply events dispatched by background services or native receiver
  useEffect(() => {
    const handleNotificationReplied = (e: Event) => {
      const customEvt = e as CustomEvent;
      const detail = customEvt?.detail;
      if (!detail || !detail.text) return;
      if (activeChat && (activeChat.id === detail.chatId || (activeChat.mergedChatIds && activeChat.mergedChatIds.includes(detail.chatId)))) {
        const optimisticId = `optimistic_${detail.messageId || Date.now()}`;
        const newMsg: ExtendedMessage = {
          id: optimisticId,
          text: detail.text,
          senderId: detail.senderId || currentUserId || "",
          status: "sent",
          isRead: false,
          createdAt: { toDate: () => new Date() } as any,
          timestamp: { toDate: () => new Date() } as any,
        };
        setMessages(prev => {
          if (prev.some(m => m.id === optimisticId || (m.senderId === newMsg.senderId && m.text === detail.text))) return prev;
          return [...prev, newMsg];
        });
      }
    };

    window.addEventListener("swapskill_message_replied", handleNotificationReplied);
    return () => {
      window.removeEventListener("swapskill_message_replied", handleNotificationReplied);
    };
  }, [activeChat, currentUserId]);

  // Listen to blocked users for current user (people I blocked)
  useEffect(() => {
    if (!currentUserId) return;
    const unsub = onSnapshot(collection(db, "users", currentUserId, "blockedUsers"), (snap) => {
      const blocked: string[] = [];
      snap.forEach(d => blocked.push(d.id));
      setBlockedUsers(blocked);
    });
    return () => unsub();
  }, [currentUserId]);

  // Listen to blocked users for the other user (people who blocked me)
  useEffect(() => {
    if (!activeChat) {
      setBlockedByUsers([]);
      return;
    }
    const otherId = activeChat.participantIds?.find(id => id !== currentUserId);
    if (!otherId) return;

    const unsub = onSnapshot(doc(db, "users", otherId, "blockedUsers", currentUserId), (snap) => {
      if (snap.exists()) {
        setBlockedByUsers([otherId]);
      } else {
        setBlockedByUsers([]);
      }
    }, (err) => {
      console.warn("Error listening to other user block state:", err);
      setBlockedByUsers([]);
    });
    return () => unsub();
  }, [activeChat?.id, currentUserId]);

  // Hardware Camera Access Functions
  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setCameraStream(stream);
      setShowCamera(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (e) {
      console.warn("Failed to access hardware camera:", e);
    }
  };

  const closeCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }
    setCameraStream(null);
    setShowCamera(false);
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async (blob) => {
          if (blob) {
            closeCamera();
            const file = new File([blob], `camera_${Date.now()}.jpg`, { type: "image/jpeg" });
            const url = await handleCloudinaryUpload(file, "image");
            handleSendMessage({ imageUrl: url });
          }
        }, "image/jpeg", 0.94);
      }
    } catch (e) {
      console.error("Failed to capture photo:", e);
    }
  };

  // Instagram Direct One-Time & Replay Camera Send Handler (Photos + Videos)
  const handleInstagramCameraSend = async (payload: {
    file: File;
    mediaType: EphemeralMediaType;
    viewMode: ViewOnceMode;
  }) => {
    try {
      const isVideo =
        payload.mediaType === "video" || payload.file.type.startsWith("video/");
      const isEphemeral = payload.viewMode !== "keep_in_chat";

      if (isVideo) {
        const url = await handleCloudinaryUpload(payload.file, "video");
        await handleSendMessage({
          videoUrl: url,
          mediaType: "video",
          isViewOnce: isEphemeral,
          viewMode: payload.viewMode,
        });
      } else {
        // Single-pass optimization happens inside uploadImageToCloudinary (avoids double-compression blur)
        const url = await handleCloudinaryUpload(payload.file, "image");
        await handleSendMessage({
          imageUrl: url,
          mediaType: "image",
          isViewOnce: isEphemeral,
          viewMode: payload.viewMode,
        });
      }
    } catch (err: any) {
      console.error("[InstagramCamera] Failed to send media:", err);
      setToast({ message: err?.message || "Failed to send media. Please try again.", type: "error" });
      throw err;
    }
  };

  // Instagram View Once & Allow Replay Open / Close Handlers
  const handleOpenViewOnce = (msg: ExtendedMessage) => {
    const mode = getEffectiveViewMode(msg);
    const maxViews = mode === "allow_replay" ? 2 : 1;
    const isVideo = Boolean(msg.videoUrl || msg.mediaType === "video");
    const noun = isVideo ? "video" : "photo";
    const otherId = activeChat?.participantIds?.find((id) => id !== currentUserId) || "";

    if (msg.senderId === currentUserId) {
      const recipientViews = otherId
        ? getEphemeralViewsForUser(msg, otherId)
        : msg.openedBy?.some((id) => id !== currentUserId)
        ? 1
        : 0;
      if (recipientViews >= maxViews) {
        setToast({ message: `${isVideo ? "Video" : "Photo"} was viewed and has expired.`, type: "info" });
      } else if (mode === "allow_replay" && recipientViews === 1) {
        setToast({ message: `Viewed once · Recipient has 1 replay left.`, type: "info" });
      } else {
        setToast({
          message:
            mode === "allow_replay"
              ? `You sent a replayable ${noun} (viewable twice).`
              : `You sent a View Once ${noun}. It disappears after viewing.`,
          type: "info",
        });
      }
      return;
    }

    const myViews = getEphemeralViewsForUser(msg, currentUserId);
    if (myViews >= maxViews) {
      setToast({ message: `This ${noun} has expired and cannot be viewed again.`, type: "info" });
      return;
    }

    if (!msg.videoUrl && !msg.imageUrl) {
      setToast({ message: `${isVideo ? "Video" : "Photo"} is unavailable or has expired.`, type: "error" });
      return;
    }

    setViewingViewOnceMessage(msg);
  };

  const handleCloseViewOnce = async () => {
    const msg = viewingViewOnceMessage;
    setViewingViewOnceMessage(null);
    if (!msg || !activeChat) return;

    const mode = getEffectiveViewMode(msg);
    const maxViews = mode === "allow_replay" ? 2 : 1;
    const prevViews = getEphemeralViewsForUser(msg, currentUserId);
    const nextViews = Math.min(maxViews, prevViews + 1);
    const isNowExpired = nextViews >= maxViews;

    // Synchronously update local UI with 0 delay
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msg.id) {
          const openedBy = m.openedBy ? [...m.openedBy] : [];
          if (!openedBy.includes(currentUserId)) openedBy.push(currentUserId);
          return {
            ...m,
            openedBy,
            replayCount: { ...(m.replayCount || {}), [currentUserId]: nextViews },
            isOpened: isNowExpired,
          };
        }
        return m;
      })
    );

    // Persist view count & opened state to Firestore
    try {
      const collectionName = msg.sourceCollection || (activeChat.isLegacy ? "chats" : "conversations");
      const chatId = msg.sourceChatId || activeChat.id;
      const msgRef = doc(db, collectionName, chatId, "messages", msg.id);
      await updateDoc(msgRef, {
        openedBy: arrayUnion(currentUserId),
        [`replayCount.${currentUserId}`]: nextViews,
        isOpened: isNowExpired,
        openedAt: new Date(),
      });
    } catch (err) {
      console.warn("[ViewOnce] Could not update opened status in Firestore:", err);
    }
  };

  // Image Compression Helper (Resizes large images up to 1200x1200 while maintaining aspect ratio and visual fidelity)
  const compressImage = (file: File): Promise<Blob | File> => {
    return optimizeImage(file, {
      type: "other",
      maxWidth: 1200,
      maxHeight: 1200,
      quality: 0.85
    });
  };

  // Message Requests: pending incoming requests directed to current user (and not deleted by current user)
  const messageRequests = useMemo(() => {
    return (globalChats as ExtendedChat[])
      .filter((c) => {
        if (!c || !c.id) return false;
        if (c.requestDeletedBy?.includes(currentUserId)) return false;
        if (c.requestStatus === "declined" || c.requestStatus === "deleted") return false;
        const isPendingToMe = (c.requestStatus === "pending" || c.isRequest === true) && 
          (c.requestedTo === currentUserId || (c.requestedBy && c.requestedBy !== currentUserId));
        return Boolean(isPendingToMe);
      })
      .map((c) => {
        const otherId = getOtherParticipantId(c, currentUserId);
        return {
          ...c,
          otherUserId: otherId || undefined
        };
      })
      .sort((a, b) => {
        const timeA = getTimestampMs(a.lastMessageAt || a.lastMessageTime || a.updatedAt || a.createdAt);
        const timeB = getTimestampMs(b.lastMessageAt || b.lastMessageTime || b.updatedAt || b.createdAt);
        return timeB - timeA;
      });
  }, [globalChats, currentUserId]);

  const unreadRequestsCount = useMemo(() => {
    return messageRequests.reduce((sum, c) => sum + (c.unreadCount?.[currentUserId] || (c.requestStatus === "pending" ? 1 : 0)), 0);
  }, [messageRequests, currentUserId]);

  const totalCallsCount = useMemo(() => {
    return (globalChats as ExtendedChat[]).filter((c) => {
      const msg = c.lastMessage?.toLowerCase() || "";
      return (c as any).hasCalls || (c as any).callData || msg.includes("call") || msg.includes("📞") || msg.includes("missed");
    }).length;
  }, [globalChats]);

  // Filter global chats list (Direct active chats + outgoing pending requests)
  const filteredChats = useMemo(() => {
    let result = (globalChats as ExtendedChat[])
      .filter((c) => {
        if (!c || !c.id) return false;
        if (c.requestDeletedBy?.includes(currentUserId)) return false;
        // Exclude pending message requests directed to me (they live in the Requests section)
        const isPendingToMe = (c.requestStatus === "pending" || c.isRequest === true) && 
          (c.requestedTo === currentUserId || (c.requestedBy && c.requestedBy !== currentUserId));
        if (isPendingToMe) return false;
        return true;
      })
      .map(c => {
        const otherId = getOtherParticipantId(c, currentUserId);
        return {
          ...c,
          otherUserId: otherId || undefined
        };
      });

    if (chatFilterText.trim()) {
      const filterLower = chatFilterText.toLowerCase();
      if (filterLower === "unread") {
        result = result.filter(c => (c.unreadCount?.[currentUserId] || 0) > 0);
      } else if (filterLower === "calls") {
        result = result.filter(c => {
          const msg = c.lastMessage?.toLowerCase() || "";
          return (c as any).hasCalls || (c as any).callData || msg.includes("call") || msg.includes("📞") || msg.includes("missed");
        });
      } else if (filterLower === "pinned") {
        result = result.filter(c => c.pinnedUsers?.includes(currentUserId));
      } else if (filterLower === "archived") {
        result = result.filter(c => c.archivedUsers?.includes(currentUserId));
      } else {
        result = result.filter(c => c.lastMessage?.toLowerCase().includes(filterLower));
      }
    }

    if (searchQuery.trim()) {
      const term = searchQuery.toLowerCase();
      result = result.filter(c => {
        const otherId = c.otherUserId || getOtherParticipantId(c, currentUserId);
        const otherUserObj = resolveOtherUserProfile(otherId, c, profilesCache, chatProfiles);
        const matchesName = otherUserObj?.fullName?.toLowerCase().includes(term);
        const matchesUser = otherUserObj?.username?.toLowerCase().includes(term);
        const matchesMsg = c.lastMessage?.toLowerCase().includes(term);
        return Boolean(matchesName || matchesUser || matchesMsg);
      });
    }

    // Always sort conversations by latest activity/message timestamp (lastMessageAt / lastMessageTime) descending
    result.sort((a, b) => {
      // Prioritize pinned chats if in All or Pinned view
      if (chatFilterText === "" || chatFilterText === "Pinned") {
        const isPinnedA = a.pinnedUsers?.includes(currentUserId) ? 1 : 0;
        const isPinnedB = b.pinnedUsers?.includes(currentUserId) ? 1 : 0;
        if (isPinnedB !== isPinnedA) return isPinnedB - isPinnedA;
      }

      const timeA = getTimestampMs(a.lastMessageAt || a.lastMessageTime || a.updatedAt || a.createdAt);
      const timeB = getTimestampMs(b.lastMessageAt || b.lastMessageTime || b.updatedAt || b.createdAt);
      if (timeB !== timeA) return timeB - timeA;
      return 0;
    });

    return result;
  }, [globalChats, chatFilterText, searchQuery, chatProfiles, profilesCache, currentUserId]);

  // Dynamic filter chip counts & total unread
  const { totalUnreadChats, totalPinnedChats, totalArchivedChats, totalUnreadMessages } = useMemo(() => {
    let unreadChats = 0;
    let pinnedChats = 0;
    let archivedChats = 0;
    let unreadMsgs = 0;

    (globalChats as ExtendedChat[]).forEach(c => {
      if (!c || !c.id || c.requestDeletedBy?.includes(currentUserId)) return;
      const isPendingToMe = (c.requestStatus === "pending" || c.isRequest === true) && 
        (c.requestedTo === currentUserId || (c.requestedBy && c.requestedBy !== currentUserId));
      if (isPendingToMe) return;

      const unread = c.unreadCount?.[currentUserId] || 0;
      if (unread > 0) {
        unreadChats += 1;
        unreadMsgs += unread;
      }
      if (c.pinnedUsers?.includes(currentUserId)) {
        pinnedChats += 1;
      }
      if (c.archivedUsers?.includes(currentUserId)) {
        archivedChats += 1;
      }
    });

    return {
      totalUnreadChats: unreadChats,
      totalPinnedChats: pinnedChats,
      totalArchivedChats: archivedChats,
      totalUnreadMessages: unreadMsgs
    };
  }, [globalChats, currentUserId]);

  // Actions for Message Requests
  const handleAcceptRequest = async (chatId: string) => {
    try {
      const targetChat = (globalChats as ExtendedChat[]).find(c => c.id === chatId) || activeChat;
      const collectionName = targetChat?.isLegacy ? "chats" : "conversations";
      const chatRef = doc(db, collectionName, chatId);
      const writeNow = new Date();
      await updateDoc(chatRef, {
        requestStatus: "accepted",
        isRequest: false,
        updatedAt: writeNow
      });

      if (activeChat && activeChat.id === chatId) {
        setActiveChat(prev => prev ? ({
          ...prev,
          requestStatus: "accepted",
          isRequest: false
        }) : null);
      }
      setShowRequestsView(false);
    } catch (err) {
      console.error("Error accepting message request:", err);
    }
  };

  const handleDeleteRequest = async (chatId: string) => {
    try {
      const targetChat = (globalChats as ExtendedChat[]).find(c => c.id === chatId) || activeChat;
      const collectionName = targetChat?.isLegacy ? "chats" : "conversations";
      const chatRef = doc(db, collectionName, chatId);
      const writeNow = new Date();
      await updateDoc(chatRef, {
        requestDeletedBy: arrayUnion(currentUserId),
        requestStatus: "declined",
        updatedAt: writeNow
      });

      if (activeChat && activeChat.id === chatId) {
        setActiveChat(null);
        if (onCloseChat) onCloseChat();
      }
    } catch (err) {
      console.error("Error deleting message request:", err);
    }
  };

  const handleBlockAndDeclineRequest = async (chatId: string, otherUid: string) => {
    try {
      if (otherUid) {
        const blockDocRef = doc(db, "users", currentUserId, "blockedUsers", otherUid);
        await setDoc(blockDocRef, { blockedAt: new Date() });
        setBlockedUsers(prev => [...prev, otherUid]);
      }
      await handleDeleteRequest(chatId);
    } catch (err) {
      console.error("Error blocking user from request:", err);
    }
  };

  const chatProfilesRef = useRef(chatProfiles);
  useEffect(() => {
    chatProfilesRef.current = chatProfiles;
  }, [chatProfiles]);

  useEffect(() => {
    const fetchMissingProfiles = async () => {
      const allDisplayChats = [...filteredChats, ...messageRequests];
      const missingIds = Array.from(
        new Set(
          allDisplayChats
            .map(c => c?.otherUserId)
            .filter((id): id is string => !!id && !chatProfilesRef.current[id])
        )
      );

      if (missingIds.length === 0) return;

      const updated = { ...chatProfilesRef.current };
      let hasNew = false;
      
      const fetchPromises = missingIds.map(async (uid) => {
        try {
          const p = await fetchProfile(uid);
          return { uid, p };
        } catch (e) {
          console.error("Error fetching user detail:", uid, e);
          return { uid, p: null };
        }
      });

      const results = await Promise.all(fetchPromises);
      results.forEach(({ uid, p }) => {
        if (p) {
          updated[uid] = p;
          hasNew = true;
        }
      });

      if (hasNew) {
        setChatProfiles(updated);
      }
    };
    fetchMissingProfiles();
  }, [filteredChats]);

  // Instant User Search logic
  useEffect(() => {
    const cleanSearch = searchQuery.trim();
    if (!cleanSearch) {
      setSearchResults([]);
      setSearchingUsers(false);
      return;
    }

    setSearchingUsers(true);
    const delayDebounce = setTimeout(async () => {
      try {
        const matches = await searchUsers(cleanSearch, {
          currentUserId,
          limitCount: 30
        });
        setSearchResults(matches);
      } catch (e) {
        console.error("Error searching users:", e);
      } finally {
        setSearchingUsers(false);
      }
    }, 250);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery, currentUserId]);

  // Clear parent conversation unread count when user opens the chat (message read receipts are batched in onSnapshot below)
  useEffect(() => {
    if (!activeChat || !currentUserId) return;
    const currentUnread = activeChat.unreadCount?.[currentUserId] || 0;
    const currentMentions = activeChat.unreadMentionCount?.[currentUserId] || 0;
    const hasLegacyDottedUnread = (activeChat as any)[`unreadCount.${currentUserId}`] !== undefined;
    const hasLegacyDottedMention = (activeChat as any)[`unreadMentionCount.${currentUserId}`] !== undefined;
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";

    if (currentUnread > 0 || currentMentions > 0 || hasLegacyDottedUnread || hasLegacyDottedMention) {
      const clearRef = doc(db, collectionName, activeChat.id);
      updateDoc(clearRef, {
        [`unreadCount.${currentUserId}`]: 0,
        [`unreadMentionCount.${currentUserId}`]: 0
      }).catch(console.error);
      if (hasLegacyDottedUnread) {
        updateDoc(clearRef, new FieldPath(`unreadCount.${currentUserId}`), deleteField()).catch(() => {});
      }
      if (hasLegacyDottedMention) {
        updateDoc(clearRef, new FieldPath(`unreadMentionCount.${currentUserId}`), deleteField()).catch(() => {});
      }
      if (activeChat.mergedChatIds && activeChat.mergedChatIds.length > 1) {
        activeChat.mergedChatIds.forEach((mId) => {
          if (mId !== activeChat.id) {
            const altRef = doc(db, collectionName === "chats" ? "conversations" : "chats", mId);
            updateDoc(altRef, {
              [`unreadCount.${currentUserId}`]: 0,
              [`unreadMentionCount.${currentUserId}`]: 0
            }).catch(() => {});
            updateDoc(altRef, new FieldPath(`unreadCount.${currentUserId}`), deleteField()).catch(() => {});
          }
        });
      }
    }
  }, [activeChat?.id, activeChat?.unreadCount?.[currentUserId], activeChat?.unreadMentionCount?.[currentUserId], currentUserId]);

  // Reset pagination window and rendered-animation set cleanly when switching chats
  useEffect(() => {
    setMessageWindowLimit(60);
    setHasOlderMessages(false);
    confirmedLocalSentIdsRef.current.clear();
    seenRenderedMsgKeysRef.current.clear();
  }, [activeChat?.id]);

  // Mark rendered keys post-commit & persist debounced local cache (never inside setMessages updater)
  useEffect(() => {
    messages.forEach((m) => {
      seenRenderedMsgKeysRef.current.add(m.clientMsgId || m.id);
    });
    if (!activeChat?.id || !setMessagesInCache || messages.length === 0) return;
    const chatId = activeChat.id;
    const timer = setTimeout(() => {
      setMessagesInCache(chatId, messages);
    }, 350);
    return () => clearTimeout(timer);
  }, [activeChat?.id, messages, setMessagesInCache]);

  // Listen to active chat details (Presence, typing, and bounded real-time messages)
  useEffect(() => {
    const targetChatId = activeChat?.id || null;
    const isSameChatPaginating = targetChatId && activeListeningChatIdRef.current === targetChatId;
    activeListeningChatIdRef.current = targetChatId;

    if (!isSameChatPaginating) {
      isFirstLoadRef.current = true;
      chatOpenedAtRef.current = Date.now();
      isNearBottomRef.current = true;
      prevFirstMsgIdRef.current = null;
      prevLastMsgIdRef.current = null;
      prevScrollHeightRef.current = 0;
      prevScrollTopRef.current = 0;
    }

    if (!activeChat) {
      setMessages([]);
      setOtherUserTyping(false);
      setOtherUserPresence(null);
      return;
    }

    const otherId = Array.isArray(activeChat.participantIds) ? activeChat.participantIds.find((id) => id !== currentUserId) : undefined;

    // 1. Instant zero-flicker hydration from local cache on first open
    if (!isSameChatPaginating) {
      if (messagesCache && messagesCache[activeChat.id]) {
        const cached = (messagesCache[activeChat.id] as ExtendedMessage[]) || [];
        const sortedCached = [...cached].sort(compareMessagesAsc);
        sortedCached.forEach((cm) => seenRenderedMsgKeysRef.current.add(cm.clientMsgId || cm.id));
        chatAnchorLockUntilRef.current = Date.now() + 1400;
        setMessages(sortedCached);
        setLoadingMessages(false);
      } else {
        chatAnchorLockUntilRef.current = Date.now() + 1400;
        setLoadingMessages(true);
        setMessages([]);
      }
    }

    const fallbackTimer = setTimeout(() => {
      setLoadingMessages(false);
    }, 2500);

    const primaryColl = activeChat.isLegacy ? "chats" : "conversations";
    const secondaryColl = activeChat.isLegacy ? "conversations" : "chats";
    const messagesStore = new Map<string, ExtendedMessage>();
    let batchCommitInFlight = false;

    const updateCombinedMessages = () => {
      clearTimeout(fallbackTimer);
      const allLoaded = Array.from(messagesStore.values());
      allLoaded.sort(compareMessagesAsc);

      setMessages(prev => {
        // Seed initial history keys cleanly so existing messages never trigger live pop-in animations
        if (seenRenderedMsgKeysRef.current.size === 0 && allLoaded.length > 0) {
          allLoaded.forEach((m) => seenRenderedMsgKeysRef.current.add(m.clientMsgId || m.id));
        }

        const pendingOptimistic = prev.filter(m => m._optimisticPending || m.id.startsWith("optimistic_"));
        const unresolved = pendingOptimistic.filter(o => {
          return !allLoaded.some(s => {
            if (s.id === o.id || (o.clientMsgId && s.clientMsgId === o.clientMsgId) || s.clientMsgId === o.id) return true;
            const senderMatch = s.senderId === o.senderId;
            const textMatch = (s.text || "").trim() === (o.text || "").trim();
            const imageMatch = !o.imageUrl || s.imageUrl === o.imageUrl;
            const videoMatch = !o.videoUrl || s.videoUrl === o.videoUrl;
            const audioMatch = !o.audioUrl || s.audioUrl === o.audioUrl;
            const fileMatch = !o.fileUrl || s.fileUrl === o.fileUrl;
            const timeDiff = Math.abs(getMessageTimeMs(s) - getMessageTimeMs(o));
            return senderMatch && textMatch && imageMatch && videoMatch && audioMatch && fileMatch && timeDiff < 15000;
          });
        });

        const seen = new Set<string>();
        const finalMsgs: ExtendedMessage[] = [];
        [...allLoaded, ...unresolved].forEach(m => {
          const dedupeKey = m.clientMsgId || m.id;
          if (!seen.has(dedupeKey) && !seen.has(m.id)) {
            seen.add(dedupeKey);
            seen.add(m.id);
            finalMsgs.push(m);
          }
        });

        finalMsgs.sort(compareMessagesAsc);

        // Skip state re-render if message snapshots are identical
        if (prev.length === finalMsgs.length && prev.length > 0) {
          let unchanged = true;
          for (let i = 0; i < prev.length; i++) {
            const p = prev[i];
            const n = finalMsgs[i];
            if (
              p.id !== n.id ||
              p.clientMsgId !== n.clientMsgId ||
              p.text !== n.text ||
              p.status !== n.status ||
              p.isRead !== n.isRead ||
              p.deleted !== n.deleted ||
              p.isEdited !== n.isEdited ||
              p.reactions !== n.reactions ||
              p.openedBy?.length !== n.openedBy?.length
            ) {
              unchanged = false;
              break;
            }
          }
          if (unchanged) return prev;
        }

        return finalMsgs;
      });

      setLoadingMessages(false);
    };

    const handleSnapshotDocs = (snapshot: any, collName: string, cId: string, isPrimaryQuery = false) => {
      if (isPrimaryQuery) {
        setHasOlderMessages(snapshot.size >= messageWindowLimit);
      }

      snapshot.docChanges().forEach((change: any) => {
        if (change.type === "removed") {
          messagesStore.delete(change.doc.id);
        }
      });

      const unreadToMark: Array<{ coll: string; chatDocId: string; msgId: string }> = [];

      snapshot.forEach((docSnap: any) => {
        // Estimate pending server timestamps so newly sent messages NEVER jump to index 0 (year 1970)
        const msg = docSnap.data({ serverTimestamps: "estimate" }) as ExtendedMessage;
        if (deletedForMeSetRef.current.has(docSnap.id) || msg.deletedFor?.includes(currentUserId)) {
          messagesStore.delete(docSnap.id);
          return;
        }

        const deleted = Boolean(
          deletedForEveryoneSetRef.current.has(docSnap.id) || 
          isMessageDeleted(msg)
        );

        const isMsgRead = Boolean(msg.isRead || msg.status === "seen");
        const processedMsg: ExtendedMessage = {
          ...msg,
          id: docSnap.id,
          sourceCollection: collName,
          sourceChatId: cId,
          isRead: isMsgRead,
          status: isMsgRead ? "seen" : msg.status,
          deleted,
          isDeleted: deleted,
          ...(deleted ? {
            text: "This message was deleted",
            imageUrl: undefined,
            videoUrl: undefined,
            audioUrl: undefined,
            fileUrl: undefined,
            fileName: undefined,
            fileSize: undefined,
            reactions: {},
            pinned: false
          } : {})
        };

        messagesStore.set(docSnap.id, processedMsg);

        // Queue unread incoming messages so we commit ONE atomic batch instead of N individual updateDoc storms
        if (!deleted && msg.senderId !== currentUserId && (!msg.isRead || msg.status !== "seen")) {
          if (!markedSeenIdsRef.current.has(docSnap.id)) {
            markedSeenIdsRef.current.add(docSnap.id);
            unreadToMark.push({ coll: collName, chatDocId: cId, msgId: docSnap.id });
          }
        }
      });

      if (unreadToMark.length > 0 && !batchCommitInFlight) {
        batchCommitInFlight = true;
        const batch = writeBatch(db);
        const nowRead = new Date();
        unreadToMark.slice(0, 100).forEach((item) => {
          batch.update(doc(db, item.coll, item.chatDocId, "messages", item.msgId), {
            isRead: true,
            status: "seen",
            readAt: nowRead,
          });
        });
        batch.update(doc(db, collName, cId), {
          [`unreadCount.${currentUserId}`]: 0,
          [`unreadMentionCount.${currentUserId}`]: 0,
        });
        batch.commit()
          .catch(() => {})
          .finally(() => {
            batchCommitInFlight = false;
          });
      }

      updateCombinedMessages();
    };

    const unsubscribers: (() => void)[] = [];
    const targetChatIds = Array.from(new Set([activeChat.id, ...(activeChat.mergedChatIds || [])]));

    // Listen to primary collection with bounded limitToLast window for instant load & minimal read quota
    targetChatIds.forEach((cId, idx) => {
      try {
        const colRef = collection(db, primaryColl, cId, "messages");
        const q = query(colRef, orderBy("createdAt", "asc"), limitToLast(messageWindowLimit));
        const unsub = onSnapshot(q, (snapshot) => {
          handleSnapshotDocs(snapshot, primaryColl, cId, idx === 0);
        }, () => {
          // Resilient fallback query without orderBy in case of indexing variations
          const qFallback = query(colRef, limit(messageWindowLimit));
          const unsubFallback = onSnapshot(qFallback, (fallbackSnap) => {
            handleSnapshotDocs(fallbackSnap, primaryColl, cId, idx === 0);
          }, () => {
            clearTimeout(fallbackTimer);
            setLoadingMessages(false);
          });
          unsubscribers.push(unsubFallback);
        });
        unsubscribers.push(unsub);
      } catch (e) {
        // ignore error quietly
      }

      // If active chat has legacy merged IDs, listen to secondary collection with bounded limit too
      if (activeChat.mergedChatIds && activeChat.mergedChatIds.length > 1) {
        try {
          const colRefSec = collection(db, secondaryColl, cId, "messages");
          const qSec = query(colRefSec, orderBy("createdAt", "asc"), limitToLast(messageWindowLimit));
          const unsubSec = onSnapshot(qSec, (snap) => {
            if (!snap.empty) {
              handleSnapshotDocs(snap, secondaryColl, cId, false);
            }
          }, () => {});
          unsubscribers.push(unsubSec);
        } catch (_) {}
      }
    });

    const unsubscribeMessages = () => {
      unsubscribers.forEach(fn => fn());
    };

    // 2. Realtime typing indicators inside typingStatus collection (strictly conversation-scoped)
    const currentChatId = activeChat.id;
    const typingDocRef = doc(db, "typingStatus", currentChatId);

    const unsubscribeTyping = onSnapshot(typingDocRef, (snapshot) => {
      if (activeChatRef.current?.id !== currentChatId) return;

      if (otherTypingTimerRef.current) {
        clearTimeout(otherTypingTimerRef.current);
        otherTypingTimerRef.current = null;
      }

      if (!snapshot.exists() || !otherId || otherId === currentUserId) {
        setOtherUserTyping(false);
        return;
      }

      const data = snapshot.data();
      const isTypingFlag = data[`${otherId}_typing`] !== undefined
        ? Boolean(data[`${otherId}_typing`])
        : Boolean(data[otherId]);

      if (!isTypingFlag) {
        setOtherUserTyping(false);
        return;
      }

      let lastTypedMs = 0;
      const userTs = data[`${otherId}_updatedAt`];
      if (userTs) {
        lastTypedMs = typeof userTs === "number"
          ? userTs
          : (userTs?.toMillis?.() || new Date(userTs).getTime());
      } else if (data.updatedAt) {
        const topTs = data.updatedAt;
        lastTypedMs = typeof topTs === "number"
          ? topTs
          : (topTs?.toMillis?.() || new Date(topTs).getTime());
      }

      const now = Date.now();
      const age = now - lastTypedMs;

      if (lastTypedMs > 0 && age >= 3500) {
        setOtherUserTyping(false);
        return;
      }

      setOtherUserTyping(true);

      const remainingMs = lastTypedMs > 0 ? Math.max(400, 3500 - age) : 3000;
      otherTypingTimerRef.current = setTimeout(() => {
        if (activeChatRef.current?.id === currentChatId) {
          setOtherUserTyping(false);
        }
      }, remainingMs);
    }, (err) => {
      console.warn("Typing status listener error:", err);
      setOtherUserTyping(false);
    });

    // 3. Realtime presence indicator
    let unsubscribePresence = () => {};
    if (otherId) {
      const presenceDocRef = doc(db, "userPresence", otherId);
      unsubscribePresence = onSnapshot(presenceDocRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setOtherUserPresence({
            status: data.status || "offline",
            lastSeen: data.lastSeen
          });
        } else {
          setOtherUserPresence(null);
        }
      }, (err) => {
        console.warn("User presence listener error:", err);
      });
    }

    return () => {
      clearTimeout(fallbackTimer);
      if (otherTypingTimerRef.current) {
        clearTimeout(otherTypingTimerRef.current);
        otherTypingTimerRef.current = null;
      }
      unsubscribeMessages();
      unsubscribeTyping();
      unsubscribePresence();

      setOtherUserTyping(false);

      if (isTypingRef.current && currentChatId) {
        isTypingRef.current = false;
        setIsTyping(false);
        updateTypingStatus(false, currentChatId);
      }
    };
  }, [activeChat?.id, activeChat?.isLegacy, messageWindowLimit, currentUserId, updateTypingStatus]);

  // Handle scrolling to paginate and track scroll position
  const handleScroll = () => {
    const container = chatScrollContainerRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distance <= 140;

    // During chat open hydration OR keyboard/emoji viewport resize animation, keep anchored to bottom instead of losing anchor
    if (
      !userInteractingRef.current &&
      (Date.now() < chatAnchorLockUntilRef.current || (isNearBottomRef.current && Date.now() < viewportTransitionUntilRef.current)) &&
      !nearBottom
    ) {
      pinToBottomInstant();
      isNearBottomRef.current = true;
      setShowScrollBottom(false);
      setUnreadAwayCount(0);
      return;
    }

    isNearBottomRef.current = nearBottom;
    setShowScrollBottom(!nearBottom);
    prevScrollTopRef.current = container.scrollTop;
    if (nearBottom) {
      setUnreadAwayCount(0);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setTypedMessage(val);
    adjustTextareaHeight();

    // Real-time mention detection preceding cursor
    const cursor = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursor);
    const mentionMatch = textBeforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);

    if (mentionMatch) {
      setShowMentionSuggestions(true);
      const queryStr = mentionMatch[1] || "";
      setMentionQuery(queryStr);
      const atIndex = textBeforeCursor.lastIndexOf("@");
      setMentionStartIndex(atIndex);
      setSelectedMentionIndex(0);
    } else {
      setShowMentionSuggestions(false);
      setMentionQuery("");
      setMentionStartIndex(-1);
    }

    const trimmed = val.trim();
    // 1. If input was cleared or is only whitespace, immediately clear typing status
    if (trimmed.length === 0) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (isTypingRef.current) {
        isTypingRef.current = false;
        setIsTyping(false);
        updateTypingStatus(false);
      }
      return;
    }

    // 2. Debounce/throttle typing writes: trigger on start, and heartbeat refresh every 4000ms
    const now = Date.now();
    if (!isTypingRef.current || now - lastTypingHeartbeatRef.current >= 4000) {
      isTypingRef.current = true;
      setIsTyping(true);
      lastTypingHeartbeatRef.current = now;
      updateTypingStatus(true);
    }

    // 3. Reset idle timeout: automatically clear typing after 3000ms of inactivity
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      setIsTyping(false);
      updateTypingStatus(false);
    }, 3000);
  };

  // Web Audio Analyser for Real-time Waveform Visualization
  const startAnalyser = (stream: MediaStream) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateWave = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const waveHeight = Math.max(10, Math.min(100, Math.floor((avg / 255) * 110) + 10));

        setVoiceWaves((prev) => {
          const next = [...prev, waveHeight];
          if (next.length > 28) {
            next.shift();
          }
          return next;
        });

        animationFrameRef.current = requestAnimationFrame(updateWave);
      };

      animationFrameRef.current = requestAnimationFrame(updateWave);
    } catch (e) {
      console.warn("Could not start Web Audio analyser:", e);
      // Fallback: simple random pulsing wave when permission/WebAudio fails
      recordIntervalRef.current = setInterval(() => {
        setVoiceWaves((prev) => {
          const next = [...prev, Math.floor(Math.random() * 60) + 20];
          if (next.length > 28) next.shift();
          return next;
        });
      }, 100);
    }
  };

  const stopAnalyser = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch((e) => console.warn(e));
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  };

  // Live RecordRTC audio recording handlers
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Initialize RecordRTC with optimized compression (16kHz mono WebM/Opus or WAV)
      const isMediaRecorderSupported = typeof MediaRecorder !== "undefined";
      const useWebM = isMediaRecorderSupported && MediaRecorder.isTypeSupported("audio/webm;codecs=opus");
      const recorder = new RecordRTC(stream, {
        type: "audio",
        mimeType: useWebM ? "audio/webm" : "audio/wav",
        numberOfAudioChannels: 1,
        desiredSampRate: 16000,
        recorderType: useWebM ? RecordRTC.MediaStreamRecorder : RecordRTC.StereoAudioRecorder,
      });

      recorder.startRecording();
      recorderRef.current = recorder;

      setIsRecording(true);
      setIsPaused(false);
      setRecordingDuration(0);
      setVoiceWaves([]);
      setRecordedBlob(null);
      setPreviewAudioUrl(null);

      // Start live wave analysis
      startAnalyser(stream);

      // Start the timer interval (in seconds)
      recordIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn("Audio recording initialization failed:", err);
      setIsRecording(true);
      setIsPaused(false);
      setRecordingDuration(0);
    }
  };

  const pauseRecording = () => {
    if (recorderRef.current && isRecording && !isPaused) {
      recorderRef.current.pauseRecording();
      setIsPaused(true);
      if (recordIntervalRef.current) {
        clearInterval(recordIntervalRef.current);
        recordIntervalRef.current = null;
      }
      stopAnalyser();
    }
  };

  const resumeRecording = () => {
    if (recorderRef.current && isRecording && isPaused) {
      recorderRef.current.resumeRecording();
      setIsPaused(false);

      // Resume timer
      recordIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      // Resume live wave analysis
      if (streamRef.current) {
        startAnalyser(streamRef.current);
      }
    }
  };

  const stopRecordingAndPreview = () => {
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    stopAnalyser();

    if (recorderRef.current) {
      recorderRef.current.stopRecording(() => {
        const blob = recorderRef.current!.getBlob();
        setRecordedBlob(blob);

        const previewUrl = URL.createObjectURL(blob);
        setPreviewAudioUrl(previewUrl);

        setIsRecording(false);
        setIsPaused(false);

        // Turn off stream tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      });
    } else {
      // Fallback/Simulated stop
      setIsRecording(false);
      setIsPaused(false);
      // Create small empty blob to act as draft wav
      const dummyBlob = new Blob([new Uint8Array(100)], { type: "audio/wav" });
      setRecordedBlob(dummyBlob);
      const previewUrl = URL.createObjectURL(dummyBlob);
      setPreviewAudioUrl(previewUrl);
    }
  };

  const cancelRecording = () => {
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    stopAnalyser();

    if (recorderRef.current) {
      recorderRef.current.destroy();
      recorderRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
    setIsPaused(false);
    setRecordedBlob(null);
    setPreviewAudioUrl(null);
    setVoiceWaves([]);
    setRecordingDuration(0);
  };

  const discardDraftRecording = () => {
    if (draftAudioRef.current) {
      draftAudioRef.current.pause();
      draftAudioRef.current = null;
    }
    setDraftIsPlaying(false);
    setDraftCurrentTime(0);
    setDraftDuration(0);
    if (previewAudioUrl) {
      URL.revokeObjectURL(previewAudioUrl);
      setPreviewAudioUrl(null);
    }
    setRecordedBlob(null);
    setVoiceWaves([]);
    setRecordingDuration(0);
    setIsPaused(false);
  };

  const sendDraftRecording = async () => {
    if (!recordedBlob) return;

    if (draftAudioRef.current) {
      draftAudioRef.current.pause();
      draftAudioRef.current = null;
    }
    setDraftIsPlaying(false);

    const mimeType = recordedBlob.type || "audio/webm";
    const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") ? "mp4" : "webm";
    const file = new File([recordedBlob], `voice_note_${Date.now()}.${extension}`, { type: mimeType });
    setIsUploadingVoice(true);
    try {
      const url = await handleCloudinaryUpload(file, "voice_notes");
      handleSendMessage({ audioUrl: url });
      discardDraftRecording();
    } catch (e: any) {
      console.warn("Cloudinary voice note upload failed, attempting direct audio fallback:", e);
      try {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result) {
            handleSendMessage({ audioUrl: reader.result as string });
            discardDraftRecording();
          }
        };
        reader.readAsDataURL(recordedBlob);
      } catch (fallbackErr) {
        console.error("Direct voice note fallback failed:", fallbackErr);
      }
    } finally {
      setIsUploadingVoice(false);
    }
  };

  const togglePlayDraft = () => {
    if (!previewAudioUrl) return;
    if (!draftAudioRef.current) {
      const audio = new Audio(previewAudioUrl);
      draftAudioRef.current = audio;
      audio.addEventListener("loadedmetadata", () => {
        setDraftDuration(audio.duration || 0);
      });
      audio.addEventListener("timeupdate", () => {
        setDraftCurrentTime(audio.currentTime || 0);
      });
      audio.addEventListener("ended", () => {
        setDraftIsPlaying(false);
        setDraftCurrentTime(0);
      });
    }

    if (draftIsPlaying) {
      draftAudioRef.current.pause();
      setDraftIsPlaying(false);
    } else {
      draftAudioRef.current.play().catch(e => console.warn("Draft audio playback issue:", e));
      setDraftIsPlaying(true);
    }
  };

  // Secure Unsigned Upload to Cloudinary with resilient fallback for voice notes
  const handleCloudinaryUpload = async (file: File, folderKey: string): Promise<string> => {
    const isImage = (file.type.startsWith("image/") || folderKey === "image") && folderKey !== "video";
    const isVideo = file.type.startsWith("video/") || folderKey === "video";
    const isAudio = file.type.startsWith("audio/") || folderKey === "voice_notes";

    setUploadProgress((prev) => ({ ...prev, [folderKey]: 10 }));

    if (isImage) {
      try {
        const url = await uploadImageToCloudinary(file, {
          type: "chat",
          folder: "swap_skill_chat",
          onProgress: (pct) => {
            setUploadProgress((prev) => ({ ...prev, [folderKey]: pct }));
          },
        });

        setUploadProgress((prev) => ({ ...prev, [folderKey]: 100 }));
        setTimeout(() => {
          setUploadProgress((prev) => {
            const copy = { ...prev };
            delete copy[folderKey];
            return copy;
          });
        }, 1000);

        return url;
      } catch (uploadErr) {
        setUploadProgress((prev) => {
          const copy = { ...prev };
          delete copy[folderKey];
          return copy;
        });
        throw uploadErr;
      }
    }

    // Helper: Resilient Data URL reader
    const readAsDataUrlFallback = (): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress((prev) => ({ ...prev, [folderKey]: Math.round((e.loaded / e.total) * 100) }));
          }
        };
        reader.onload = () => {
          setUploadProgress((prev) => ({ ...prev, [folderKey]: 100 }));
          setTimeout(() => {
            setUploadProgress((prev) => {
              const copy = { ...prev };
              delete copy[folderKey];
              return copy;
            });
          }, 1000);
          resolve(reader.result as string);
        };
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(file);
      });
    };

    // For non-image attachments (videos, voice notes, documents)
    const { cloudName, uploadPreset, isConfigured } = getCloudinaryConfig();

    if (!isConfigured) {
      if (isVideo && file.size > 750 * 1024) {
        setUploadProgress((prev) => {
          const copy = { ...prev };
          delete copy[folderKey];
          return copy;
        });
        throw new Error("Video is too large without Cloudinary configured. Try a shorter clip or configure Cloudinary.");
      }
      return readAsDataUrlFallback();
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", uploadPreset);
      formData.append(
        "folder",
        isAudio ? "swap_skill_audio" : isVideo ? "swap_skill_videos" : "swap_skill_docs"
      );

      // In Cloudinary, audio and video files belong to the /video/upload endpoint
      const resourceType = isAudio || isVideo ? "video" : "auto";
      const uploadUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`;

      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl, true);

      const uploadPromise = new Promise<string>((resolve, reject) => {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            setUploadProgress((prev) => ({ ...prev, [folderKey]: progress }));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              setUploadProgress((prev) => ({ ...prev, [folderKey]: 100 }));
              setTimeout(() => {
                setUploadProgress((prev) => {
                  const copy = { ...prev };
                  delete copy[folderKey];
                  return copy;
                });
              }, 1000);
              const rawUrl = data.secure_url || data.url;
              resolve(isVideo ? applyCloudinaryVideoOptimization(rawUrl) : rawUrl);
            } catch (_) {
              reject(new Error("Invalid response from Cloudinary"));
            }
          } else {
            let errorDetail = `Cloudinary upload failed with status ${xhr.status}`;
            try {
              const parsed = JSON.parse(xhr.responseText);
              if (parsed.error?.message) {
                errorDetail = parsed.error.message;
              }
            } catch (_) {}
            reject(new Error(errorDetail));
          }
        };

        xhr.onerror = () => reject(new Error("Network upload error"));
      });

      xhr.send(formData);
      return await uploadPromise;
    } catch (err: any) {
      // If Cloudinary rejects the upload (e.g. status 400 because upload preset is restricted to image-only),
      // provide a seamless fallback for audio voice notes and lightweight files (< 800 KB) so user messaging never breaks!
      const MAX_FALLBACK_SIZE = 800 * 1024; // 800 KB (well within Firestore 1MB limit)
      if (isAudio || file.size <= MAX_FALLBACK_SIZE) {
        console.warn(
          `[Cloudinary] ${isAudio ? "Voice note" : "File"} upload to Cloudinary failed (${err?.message || "status 400"}). Falling back to resilient audio data storage.`
        );
        return readAsDataUrlFallback();
      }

      setUploadProgress((prev) => {
        const copy = { ...prev };
        delete copy[folderKey];
        return copy;
      });
      throw new Error(`File upload failed: ${err?.message || "Please check your network and try again"}`);
    }
  };

  // Media Attachment trigger
  const triggerMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "file") => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === "file") {
      const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
      if (file.size > MAX_FILE_SIZE) {
        setToast({ message: "File size exceeds 25MB limit", type: "error" });
        e.target.value = "";
        return;
      }
    }

    try {
      // Images are optimized in a single crisp pass inside uploadImageToCloudinary (avoids double-compression blur)
      const url = await handleCloudinaryUpload(file, type);
      if (type === "image") {
        handleSendMessage({ imageUrl: url });
      } else {
        handleSendMessage({ 
          fileUrl: url, 
          fileName: file.name, 
          fileSize: file.size 
        });
      }
    } catch (e) {
      console.error("Attachment upload error:", e);
      setToast({ message: "Failed to upload file. Please try again.", type: "error" });
    } finally {
      try {
        e.target.value = "";
      } catch (_) {}
    }
  };

  // SEND MESSAGE HANDLER (Writing symmetrically with Optimistic UI updates and Blocks Safety)
  const handleSendMessage = async (payload: {
    text?: string;
    imageUrl?: string | null;
    videoUrl?: string | null;
    mediaType?: "image" | "video";
    audioUrl?: string | null;
    fileUrl?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
    isViewOnce?: boolean;
    viewMode?: ViewOnceMode;
  }) => {
    if (!activeChat) return;

    // Check Block Status: Do not send if blocked
    const otherId = Array.isArray(activeChat.participantIds) ? activeChat.participantIds.find((id) => id !== currentUserId) : undefined;
    if (otherId && (blockedUsers.includes(otherId) || blockedByUsers.includes(otherId))) {
      console.warn("Cannot send message. Messaging is restricted due to block.");
      return;
    }

    // Clear input field and typing state synchronously to prevent duplicate submissions while database is writing
    if (payload.text) {
      setTypedMessage("");
      setShowMentionSuggestions(false);
      setMentionQuery("");
      setMentionStartIndex(-1);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (isTypingRef.current) {
      isTypingRef.current = false;
      setIsTyping(false);
      updateTypingStatus(false);
    }

    const collectionName = activeChat.isLegacy ? "chats" : "conversations";

    // 1. Generate local optimistic ID & message with unique entropy and timestamps
    const tempId = "optimistic_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const now = new Date();

    // Prepare quote metadata if replying to a message (NEVER leak ephemeral view-once/replay thumbnails)
    let replySnippet = "";
    let replySender = "";
    let replyMedia: "image" | "video" | "audio" | "file" | undefined = undefined;
    let replyImageUrl: string | undefined = undefined;

    if (replyToMessage) {
      replySender = replyToMessage.senderId === currentUserId 
        ? "You" 
        : (otherUserProfile?.fullName || otherUserProfile?.username || "Contact");
      const replyIsEphemeral = isEphemeralMediaMessage(replyToMessage);
      if (replyToMessage.videoUrl || replyToMessage.mediaType === "video") {
        replySnippet = replyIsEphemeral ? "Disappearing video" : "Video";
        replyMedia = "video";
      } else if (replyToMessage.imageUrl) {
        replySnippet = replyIsEphemeral ? "Disappearing photo" : "Photo";
        replyMedia = "image";
        if (!replyIsEphemeral) {
          replyImageUrl = replyToMessage.imageUrl;
        }
      } else if (replyToMessage.audioUrl) {
        replySnippet = "Voice note";
        replyMedia = "audio";
      } else if (replyToMessage.fileUrl) {
        replySnippet = replyToMessage.fileName || "File";
        replyMedia = "file";
      } else {
        replySnippet = replyToMessage.text || "Message";
      }
    }

    const tempMsg: ExtendedMessage = {
      id: tempId,
      clientMsgId: tempId,
      _optimisticPending: true,
      senderId: currentUserId,
      text: payload.text || "",
      createdAt: now,
      timestamp: now,
      clientTimestamp: now.getTime(),
      status: "sent",
      isRead: false,
      deleted: false,
      reactions: {},
      pinned: false,
      deletedFor: [],
      ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
      ...(payload.videoUrl ? { videoUrl: payload.videoUrl } : {}),
      ...(payload.mediaType ? { mediaType: payload.mediaType } : {}),
      ...(payload.viewMode ? { viewMode: payload.viewMode } : {}),
      ...(payload.isViewOnce ? { isViewOnce: true, viewMode: payload.viewMode || "view_once", openedBy: [], replayCount: {} } : {}),
      ...(payload.audioUrl ? { audioUrl: payload.audioUrl } : {}),
      ...(payload.fileUrl ? { 
        fileUrl: payload.fileUrl, 
        fileName: payload.fileName || "document", 
        fileSize: payload.fileSize || 0 
      } : {}),
      ...(replyToMessage ? { 
        replyToId: replyToMessage.id, 
        replyToText: replySnippet,
        replyToSenderName: replySender,
        ...(replyMedia ? { replyToMedia: replyMedia } : {}),
        ...(replyImageUrl ? { replyToImageUrl: replyImageUrl } : {})
      } : {})
    };

    // 2. Append to bottom of local list optimistically (NEVER prepend)
    setMessages(prev => {
      if (prev.some(m => m.id === tempId || m.clientMsgId === tempId)) return prev;
      const next = [...prev, tempMsg];
      next.sort(compareMessagesAsc);
      return next;
    });

    // Pin scroll to bottom immediately upon sending and lock against keyboard resize jumps
    userInteractingRef.current = false;
    isNearBottomRef.current = true;
    chatAnchorLockUntilRef.current = Date.now() + 700;
    viewportTransitionUntilRef.current = Date.now() + 700;
    emojiCursorPosRef.current = 0;
    scrollToBottom("auto");

    try {
      const messagesRef = collection(db, collectionName, activeChat.id, "messages");
      
      const newMsgObj: any = {
        senderId: currentUserId,
        text: payload.text || "",
        createdAt: serverTimestamp(),
        timestamp: serverTimestamp(),
        clientTimestamp: now.getTime(),
        clientMsgId: tempId,
        status: "sent",
        isRead: false,
        deleted: false,
        reactions: {},
        pinned: false,
        deletedFor: []
      };

      if (payload.imageUrl) newMsgObj.imageUrl = payload.imageUrl;
      if (payload.videoUrl) newMsgObj.videoUrl = payload.videoUrl;
      if (payload.mediaType) newMsgObj.mediaType = payload.mediaType;
      if (payload.viewMode) newMsgObj.viewMode = payload.viewMode;
      if (payload.isViewOnce) {
        newMsgObj.isViewOnce = true;
        newMsgObj.viewMode = payload.viewMode || "view_once";
        newMsgObj.openedBy = [];
        newMsgObj.replayCount = {};
      }
      if (payload.audioUrl) newMsgObj.audioUrl = payload.audioUrl;
      if (payload.fileUrl) {
        newMsgObj.fileUrl = payload.fileUrl;
        newMsgObj.fileName = payload.fileName || "document";
        newMsgObj.fileSize = payload.fileSize || 0;
      }

      if (replyToMessage) {
        newMsgObj.replyToId = replyToMessage.id;
        newMsgObj.replyToText = replySnippet;
        newMsgObj.replyToSenderName = replySender;
        if (replyMedia) newMsgObj.replyToMedia = replyMedia;
        if (replyImageUrl) newMsgObj.replyToImageUrl = replyImageUrl;
        setReplyToMessage(null);
      }

      // Set readable parent log text
      let lastMsgText = payload.text || "";
      const isVidMsg = Boolean(payload.videoUrl || payload.mediaType === "video");
      if (payload.isViewOnce) {
        if (payload.viewMode === "allow_replay") {
          lastMsgText = isVidMsg ? "Sent a replayable video 🎥" : "Sent a replayable photo 📷";
        } else {
          lastMsgText = isVidMsg ? "Sent a view once video 🎥" : "Sent a view once photo 📷";
        }
      } else if (payload.videoUrl) lastMsgText = "Sent a video 🎥";
      else if (payload.imageUrl) lastMsgText = "Sent a photo 📷";
      else if (payload.audioUrl) lastMsgText = "Sent a voice note 🎙️";
      else if (payload.fileUrl) lastMsgText = `Sent a file 📎: ${payload.fileName}`;

      // Detect @mention or direct reply-mention to recipient
      const rawTextLower = (payload.text || "").toLowerCase();
      const otherHandle = (otherUserProfile?.username || otherUserProfile?.fullName?.replace(/\s+/g, "") || "").toLowerCase();
      const otherFirst = (otherUserProfile?.fullName?.split(" ")[0] || "").toLowerCase();
      const isMention = Boolean(
        otherId && (
          (otherHandle && rawTextLower.includes(`@${otherHandle}`)) ||
          (otherFirst && rawTextLower.includes(`@${otherFirst}`)) ||
          (replyToMessage && replyToMessage.senderId === otherId) ||
          /@[a-z0-9._-]{2,}/i.test(payload.text || "")
        )
      );

      // Update unread & mention balances as nested maps (required for setDoc with merge: true)
      const unreadUpdate: Record<string, any> = otherId ? {
        unreadCount: {
          [otherId]: increment(1),
          [currentUserId]: 0,
        },
        unreadMentionCount: {
          [currentUserId]: 0,
          ...(isMention ? { [otherId]: increment(1) } : {}),
        },
        lastMessageHasMention: isMention,
      } : {};

      // Determine request status transition if pending or uninitialized
      let requestStatusUpdate: Record<string, any> = {};
      if (activeChat.requestStatus === "pending") {
        if (activeChat.requestedTo === currentUserId || (activeChat.requestedBy && activeChat.requestedBy !== currentUserId)) {
          // Recipient responded, automatically accept request
          requestStatusUpdate = { requestStatus: "accepted", isRequest: false };
          setActiveChat(prev => prev ? ({ ...prev, requestStatus: "accepted", isRequest: false }) : null);
        } else {
          requestStatusUpdate = { requestStatus: "pending", isRequest: true };
        }
      } else if (!activeChat.requestStatus && otherId) {
        const isConnected = (currentUserProfile?.followingList || []).includes(otherId) ||
          (otherUserProfile?.followingList || []).includes(currentUserId);
        requestStatusUpdate = isConnected 
          ? { requestStatus: "accepted", isRequest: false }
          : { requestStatus: "pending", requestedBy: currentUserId, requestedTo: otherId, isRequest: true };
        setActiveChat(prev => prev ? ({ ...prev, ...requestStatusUpdate }) : null);
      }

      const parentRef = doc(db, collectionName, activeChat.id);
      const writeNow = new Date();

      // Fast-dispatch in-app notification doc and FCM push concurrently (0ms delay)
      if (otherId) {
        const isReq = (activeChat.requestStatus === "pending" || requestStatusUpdate.requestStatus === "pending") &&
          requestStatusUpdate.requestStatus !== "accepted";

        try {
          const notifRef = collection(db, "users", otherId, "notifications");
          addDoc(notifRef, {
            type: isReq ? "message_request" : "chat",
            senderId: currentUserId,
            senderName: currentUserProfile?.fullName || auth.currentUser?.displayName || "Someone",
            senderPhoto: currentUserProfile?.profilePhotoUrl || currentUserProfile?.photoUrl || "",
            referenceId: activeChat.id,
            chatId: activeChat.id,
            message: isReq
              ? `sent you a message request: "${lastMsgText.substring(0, 50)}"`
              : (lastMsgText || "Sent you a message"),
            read: false,
            createdAt: writeNow,
            createdTimestamp: Date.now()
          }).catch(() => {});
        } catch (_) {}

        // Dispatch background FCM push notification via backend immediately in parallel
        dispatchPushNotification({
          recipientUserId: otherId,
          title: currentUserProfile?.fullName || auth.currentUser?.displayName || "New message",
          body: isReq
            ? `sent you a message request: "${lastMsgText.substring(0, 50)}"`
            : lastMsgText.substring(0, 70),
          channelId: "swapskill_messages",
          priority: "high",
          data: {
            type: "chat",
            chatId: activeChat.id,
            messageId: tempId,
            senderId: currentUserId,
            senderName: currentUserProfile?.fullName || auth.currentUser?.displayName || "Someone",
            recipientId: otherId,
          },
        }).catch(() => {});
      }

      // Parallelize message write and parent conversation metadata write for zero-wait UI and high quota efficiency
      await Promise.all([
        addDoc(messagesRef, newMsgObj),
        setDoc(parentRef, {
          id: activeChat.id,
          participantIds: activeChat.participantIds || [currentUserId, ...(otherId ? [otherId] : [])],
          lastMessage: lastMsgText,
          lastMessageSenderId: currentUserId,
          lastMessageTime: writeNow,
          lastMessageAt: writeNow,
          updatedAt: writeNow,
          ...unreadUpdate,
          ...requestStatusUpdate
        }, { merge: true })
      ]);

      // Mark tempId locally confirmed so single check renders cleanly while keeping clientMsgId stable until snapshot replaces it in-place
      confirmedLocalSentIdsRef.current.add(tempId);
      setMessages(prev => prev.map(m => {
        if (m.id === tempId || m.clientMsgId === tempId) {
          return {
            ...m,
            status: "sent",
            _optimisticPending: true
          };
        }
        return m;
      }));

      // Clear states
      setTypedMessage("");
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      isTypingRef.current = false;
      setIsTyping(false);
      updateTypingStatus(false);
    } catch (err: any) {
      console.error("Error sending message:", err);
      // Mark optimistic message with sendError rather than freezing on the clock icon
      setMessages(prev => prev.map(m => {
        if (m.id === tempId || m.clientMsgId === tempId) {
          return {
            ...m,
            status: "error" as any,
            sendError: true
          };
        }
        return m;
      }));
    }
  };

  // Pin Chat
  const handleTogglePinChat = async () => {
    if (!activeChat) return;
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";
    try {
      const chatRef = doc(db, collectionName, activeChat.id);
      const isPinned = activeChat.pinnedUsers?.includes(currentUserId);
      const updatedPinned = isPinned
        ? activeChat.pinnedUsers?.filter((id) => id !== currentUserId) || []
        : [...(activeChat.pinnedUsers || []), currentUserId];

      await updateDoc(chatRef, { pinnedUsers: updatedPinned });
      setActiveChat({ ...activeChat, pinnedUsers: updatedPinned });
      setShowOptionsDropdown(false);
    } catch (err) {
      console.error("Error pinning chat:", err);
    }
  };

  // Archive Chat
  const handleToggleArchiveChat = async () => {
    if (!activeChat) return;
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";
    try {
      const chatRef = doc(db, collectionName, activeChat.id);
      const isArchived = activeChat.archivedUsers?.includes(currentUserId);
      const updatedArchived = isArchived
        ? activeChat.archivedUsers?.filter((id) => id !== currentUserId) || []
        : [...(activeChat.archivedUsers || []), currentUserId];

      await updateDoc(chatRef, { archivedUsers: updatedArchived });
      setActiveChat({ ...activeChat, archivedUsers: updatedArchived });
      setShowOptionsDropdown(false);
    } catch (err) {
      console.error("Error archiving chat:", err);
    }
  };

  // Mute Chat
  const handleToggleMuteChat = async () => {
    if (!activeChat) return;
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";
    try {
      const chatRef = doc(db, collectionName, activeChat.id);
      const isMuted = activeChat.mutedUsers?.includes(currentUserId);
      const updatedMuted = isMuted
        ? activeChat.mutedUsers?.filter((id) => id !== currentUserId) || []
        : [...(activeChat.mutedUsers || []), currentUserId];

      await updateDoc(chatRef, { mutedUsers: updatedMuted });
      setActiveChat({ ...activeChat, mutedUsers: updatedMuted });
      setShowOptionsDropdown(false);
    } catch (err) {
      console.error("Error muting chat:", err);
    }
  };

  // Open Block/Unblock Confirmation Modal
  const handleOpenBlockModal = (overrideMode?: "block" | "unblock", overrideTarget?: UserProfile | null) => {
    const target = overrideTarget || otherUserProfile || (otherUserId ? { uid: otherUserId, fullName: "Member", username: "user" } as UserProfile : null);
    if (!target) return;
    const isCurrentlyBlocked = target.uid ? blockedUsers.includes(target.uid) : false;
    const mode = overrideMode || (isCurrentlyBlocked ? "unblock" : "block");
    setBlockModalTarget(target);
    setBlockModalMode(mode);
    setShowBlockModal(true);
    setShowOptionsDropdown(false);
  };

  const handleConfirmBlockAction = async () => {
    if (!blockModalTarget?.uid) return;
    const targetId = blockModalTarget.uid;
    try {
      const isCurrentlyBlocked = blockedUsers.includes(targetId);
      const blockDocRef = doc(db, "users", currentUserId, "blockedUsers", targetId);
      if (blockModalMode === "unblock") {
        await deleteDoc(blockDocRef);
        setBlockedUsers(prev => prev.filter(id => id !== targetId));
        setShowBlockModal(false);
        setToast({ message: "User unblocked", type: "success" });
      } else {
        await setDoc(blockDocRef, {
          id: targetId,
          blockedAt: new Date()
        });
        setBlockedUsers(prev => [...prev.filter(id => id !== targetId), targetId]);
        if (activeChat && (activeChat.isRequest || activeChat.requestStatus === "pending")) {
          await handleDeleteRequest(activeChat.id);
        }
        setShowBlockModal(false);
        setToast({ message: "User blocked", type: "success" });
      }
    } catch (err) {
      console.error("Error toggling block:", err);
      setToast({ message: "Action failed. Please try again.", type: "error" });
    }
  };

  // Block / Unblock User
  const handleToggleBlockUser = async () => {
    handleOpenBlockModal();
  };

  // Submit User Misconduct Report
  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChat) return;
    const otherId = Array.isArray(activeChat.participantIds) ? activeChat.participantIds.find((id) => id !== currentUserId) : undefined;
    if (!otherId) return;

    setSubmittingReport(true);
    try {
      await addDoc(collection(db, "reports"), {
        reporterId: currentUserId,
        reportedUserId: otherId,
        category: reportCategory,
        comments: reportComments,
        reason: `${reportCategory}: ${reportComments}`,
        createdAt: new Date()
      });
      setReportSuccess(true);
      setTimeout(() => {
        setShowReportModal(false);
        setReportSuccess(false);
        setReportComments("");
        setShowOptionsDropdown(false);
      }, 1500);
    } catch (err) {
      console.error("Error submitting report:", err);
    } finally {
      setSubmittingReport(false);
    }
  };

  // Message Edits Submit
  const handleEditMessageSubmit = async () => {
    if (!activeChat || !editingMessage) return;
    const collectionName = editingMessage.sourceCollection || (activeChat.isLegacy ? "chats" : "conversations");
    const chatId = editingMessage.sourceChatId || activeChat.id;
    try {
      const msgRef = doc(db, collectionName, chatId, "messages", editingMessage.id);
      await updateDoc(msgRef, {
        text: typedMessage.trim(),
        isEdited: true
      });
      setEditingMessage(null);
      setTypedMessage("");
      setShowMentionSuggestions(false);
      setMentionQuery("");
      setMentionStartIndex(-1);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (isTypingRef.current) {
        isTypingRef.current = false;
        setIsTyping(false);
        updateTypingStatus(false);
      }
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch (err) {
      console.error("Error editing message:", err);
    }
  };

  const triggerBurst = (
    emoji: string, 
    coordsOrEvent?: React.MouseEvent | { x: number; y: number }, 
    msgId?: string
  ) => {
    let x = typeof window !== "undefined" ? window.innerWidth / 2 : 200;
    let y = typeof window !== "undefined" ? window.innerHeight / 2 : 300;

    if (coordsOrEvent) {
      if ("clientX" in coordsOrEvent && typeof coordsOrEvent.clientX === "number") {
        x = coordsOrEvent.clientX;
        y = coordsOrEvent.clientY;
      } else if ("x" in coordsOrEvent && "y" in coordsOrEvent) {
        x = coordsOrEvent.x;
        y = coordsOrEvent.y;
      }
    } else if (msgId) {
      const el = document.getElementById(`msg-bubble-${msgId}`);
      if (el) {
        const rect = el.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      }
    } else if (selectedMsgCoords) {
      x = selectedMsgCoords.left + selectedMsgCoords.width / 2;
      y = selectedMsgCoords.top + selectedMsgCoords.height / 2;
    }

    emitReactionBurst(emoji, x, y);
  };

  // Scroll smoothly to original replied message with gold pulse highlight
  const handleScrollToMessage = (replyToId: string) => {
    const el = document.getElementById(`msg-bubble-${replyToId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMsgId(replyToId);
      setTimeout(() => {
        setHighlightedMsgId((curr) => (curr === replyToId ? null : curr));
      }, 1800);
    } else {
      setToast({ message: "Original message is not loaded", type: "info" });
    }
  };

  // Start reply with auto-focus
  const handleStartReply = (msg: ExtendedMessage) => {
    if (isMessageDeleted(msg)) return;
    setReplyToMessage(msg);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  // Mobile Touch handlers: Swipe-to-reply & Long-press Context Menu
  const handleBubbleTouchStart = (e: React.TouchEvent, msg: ExtendedMessage) => {
    if (selectedMsgIds.size > 0) return; // In selection mode, taps toggle selection
    const touch = e.touches[0];
    touchCoordRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    isHorizontalSwipeRef.current = null;
    swipeThresholdCrossedRef.current = false;

    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    if (typeof window !== "undefined" && window.getSelection) {
      window.getSelection()?.removeAllRanges();
    }
    longPressTimeoutRef.current = setTimeout(() => {
      if (!isHorizontalSwipeRef.current) {
        if (typeof window !== "undefined" && window.getSelection) {
          window.getSelection()?.removeAllRanges();
        }
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(35);
        }
        setSelectedMsgId(msg.id);
      }
    }, 420);
  };

  const handleBubbleTouchMove = (e: React.TouchEvent, msg: ExtendedMessage) => {
    if (!touchCoordRef.current || selectedMsgIds.size > 0) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchCoordRef.current.x;
    const dy = touch.clientY - touchCoordRef.current.y;

    if (isHorizontalSwipeRef.current === null) {
      // Check gesture direction
      if (Math.abs(dy) > 7 && Math.abs(dy) >= Math.abs(dx)) {
        // Vertical scroll initiated: cancel swipe & long press
        isHorizontalSwipeRef.current = false;
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
          longPressTimeoutRef.current = null;
        }
        return;
      }
      if (dx > 10 && Math.abs(dx) > Math.abs(dy) * 1.2 && !isMessageDeleted(msg)) {
        // Horizontal swipe-to-reply initiated
        isHorizontalSwipeRef.current = true;
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
          longPressTimeoutRef.current = null;
        }
      }
    }

    if (isHorizontalSwipeRef.current === true) {
      const offset = Math.max(0, Math.min(dx * 0.42, 54));
      setSwipingMsgId(msg.id);
      setSwipeOffset(offset);

      if (offset >= 36 && !swipeThresholdCrossedRef.current) {
        swipeThresholdCrossedRef.current = true;
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(20);
        }
      } else if (offset < 36 && swipeThresholdCrossedRef.current) {
        swipeThresholdCrossedRef.current = false;
      }
    }
  };

  const handleBubbleTouchEnd = (msg: ExtendedMessage) => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }

    if (isHorizontalSwipeRef.current === true && swipingMsgId === msg.id) {
      if (swipeThresholdCrossedRef.current || swipeOffset >= 36) {
        handleStartReply(msg);
      }
      setSwipeOffset(0);
      setTimeout(() => {
        setSwipingMsgId(null);
      }, 200);
    }

    touchCoordRef.current = null;
    isHorizontalSwipeRef.current = null;
    swipeThresholdCrossedRef.current = false;
  };

  // Desktop right-click context menu
  const handleBubbleContextMenu = (e: React.MouseEvent, msg: ExtendedMessage) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window !== "undefined" && window.getSelection) {
      window.getSelection()?.removeAllRanges();
    }
    if (selectedMsgIds.size > 0) {
      handleToggleSelect(msg.id);
      return;
    }
    setSelectedMsgId(msg.id);
  };

  // Selection mode toggles
  const handleToggleSelect = (msgId: string) => {
    setSelectedMsgIds(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  };

  const handleSelectMessageFromMenu = (msg: ExtendedMessage) => {
    setSelectedMsgIds(new Set([msg.id]));
    setSelectedMsgId(null);
  };

  const handleCopyMessage = (msg: ExtendedMessage) => {
    if (msg.text) {
      navigator.clipboard.writeText(msg.text);
      setToast({ message: "Message copied", type: "success" });
    }
  };

  const handleCopySelected = () => {
    const selectedMsgs = messages.filter(m => selectedMsgIds.has(m.id) && !isMessageDeleted(m));
    const text = selectedMsgs.map(m => m.text).filter(Boolean).join("\n\n");
    if (text) {
      navigator.clipboard.writeText(text);
      setToast({ message: `Copied ${selectedMsgs.length} message${selectedMsgs.length > 1 ? "s" : ""}`, type: "success" });
    }
    setSelectedMsgIds(new Set());
  };

  const handleOpenForwardForSingle = (msg: ExtendedMessage) => {
    setForwardTargetMessages([msg]);
    setShowForwardModal(true);
    setSelectedMsgId(null);
  };

  const handleOpenForwardForSelected = () => {
    const selectedMsgs = messages.filter(m => selectedMsgIds.has(m.id) && !isMessageDeleted(m));
    if (selectedMsgs.length > 0) {
      setForwardTargetMessages(selectedMsgs);
      setShowForwardModal(true);
    }
  };

  const handleForwardToChat = async (targetChat: ForwardTargetChat) => {
    if (!forwardTargetMessages || forwardTargetMessages.length === 0) return;
    const collectionName = targetChat.isLegacy ? "chats" : "conversations";
    const messagesRef = collection(db, collectionName, targetChat.id, "messages");

    const forwardable = forwardTargetMessages.filter(
      (msg) => !isMessageDeleted(msg) && !isEphemeralMediaMessage(msg)
    );
    if (forwardable.length === 0) {
      setToast({ message: "View once & replay media cannot be forwarded.", type: "info" });
      return;
    }

    for (const msg of forwardable) {
      const now = new Date();
      const tempId = "fwd_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
      const newMsgObj: any = {
        senderId: currentUserId,
        text: msg.text || "",
        createdAt: now,
        timestamp: now,
        clientMsgId: tempId,
        status: "sent",
        deleted: false,
        reactions: {},
        pinned: false,
        deletedFor: [],
        isForwarded: true
      };
      if (msg.imageUrl) newMsgObj.imageUrl = msg.imageUrl;
      if (msg.videoUrl) newMsgObj.videoUrl = msg.videoUrl;
      if (msg.mediaType) newMsgObj.mediaType = msg.mediaType;
      if (msg.audioUrl) newMsgObj.audioUrl = msg.audioUrl;
      if (msg.fileUrl) {
        newMsgObj.fileUrl = msg.fileUrl;
        newMsgObj.fileName = msg.fileName || "document";
        newMsgObj.fileSize = msg.fileSize || 0;
      }
      await addDoc(messagesRef, newMsgObj);
    }

    const last = forwardable[forwardable.length - 1];
    let lastText = last.text || "Forwarded message";
    if (last.videoUrl) lastText = "Sent a video 🎥";
    else if (last.imageUrl) lastText = "Sent an image 📷";
    else if (last.audioUrl) lastText = "Sent a voice note 🎙️";
    else if (last.fileUrl) lastText = `Sent a file 📎: ${last.fileName || "document"}`;

    const chatDocRef = doc(db, collectionName, targetChat.id);
    await updateDoc(chatDocRef, {
      lastMessage: lastText,
      lastMessageSenderId: currentUserId,
      lastMessageTime: new Date(),
      updatedAt: new Date()
    }).catch(() => {});

    setToast({ message: "Message forwarded", type: "success" });
    setShowForwardModal(false);
    setForwardTargetMessages([]);
    setSelectedMsgIds(new Set());
  };

  // Open Delete Confirmation modal for single message
  const handleOpenDeleteForSingle = (msg: ExtendedMessage) => {
    if (msg.deletedFor?.includes(currentUserId) || deletedForMeSetRef.current.has(msg.id)) {
      setSelectedMsgId(null);
      return;
    }
    setDeleteTargetMessages([msg]);
    setShowDeleteModal(true);
    setSelectedMsgId(null);
  };

  // Open Delete Confirmation modal for selected messages
  const handleOpenDeleteForSelected = () => {
    const selectedMsgs = messages.filter(
      m => selectedMsgIds.has(m.id) && !m.deletedFor?.includes(currentUserId) && !deletedForMeSetRef.current.has(m.id)
    );
    if (selectedMsgs.length > 0) {
      setDeleteTargetMessages(selectedMsgs);
      setShowDeleteModal(true);
    } else {
      setSelectedMsgIds(new Set());
    }
  };

  // Message reaction toggle with celebratory animation burst & optimistic UI
  const handleReactToMessage = (msgId: string, emoji: string, clickCoords?: { x: number; y: number }) => {
    if (!activeChat || !msgId || !emoji) return;
    const cleanEmoji = emoji.trim();
    if (/^[a-zA-Z0-9_\s]+$/.test(cleanEmoji)) return; // Strictly ignore text or initials

    // Instant tactile feedback and close menu immediately
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(15);
    }
    setSelectedMsgId(null);

    // Trigger lightweight reaction burst
    triggerBurst(cleanEmoji, clickCoords, msgId);

    // Optimistically update message reaction in local state for instantaneous UI feedback
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const currentReactions = { ...(m.reactions || {}) };
      if (currentReactions[currentUserId] === cleanEmoji) {
        delete currentReactions[currentUserId];
      } else {
        currentReactions[currentUserId] = cleanEmoji;
      }
      return { ...m, reactions: currentReactions };
    }));

    const targetMsg = messages.find(m => m.id === msgId);
    const collectionName = targetMsg?.sourceCollection || (activeChat.isLegacy ? "chats" : "conversations");
    const chatId = targetMsg?.sourceChatId || activeChat.id;

    // Fast background update without blocking read or UI thread
    const currentReactions = { ...(targetMsg?.reactions || {}) };
    let updatedReactions = { ...currentReactions };
    if (updatedReactions[currentUserId] === cleanEmoji) {
      delete updatedReactions[currentUserId];
    } else {
      updatedReactions[currentUserId] = cleanEmoji;
    }

    try {
      const msgRef = doc(db, collectionName, chatId, "messages", msgId);
      updateDoc(msgRef, { reactions: updatedReactions }).catch(err => {
        console.warn("Non-fatal background reaction sync error:", err);
      });
    } catch (err) {
      console.warn("Reaction setup error:", err);
    }
  };

  // Idempotent, robust message deletions
  const handleDeleteForEveryone = async (msgId: string) => {
    if (!activeChat || !msgId) return;
    if (isDeletingMsgRef.current.has(msgId)) return;

    const targetMsg = messages.find(m => m.id === msgId);
    if (!targetMsg || isMessageDeleted(targetMsg)) {
      setSelectedMsgId(null);
      return;
    }
    if (targetMsg.senderId !== currentUserId) {
      setSelectedMsgId(null);
      return;
    }

    isDeletingMsgRef.current.add(msgId);
    deletedForEveryoneSetRef.current.add(msgId);
    setSelectedMsgId(null);

    // 1. Optimistic UI update: instantly render deleted tombstone
    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        return {
          ...m,
          text: "This message was deleted",
          deleted: true,
          isDeleted: true,
          imageUrl: undefined,
          audioUrl: undefined,
          fileUrl: undefined,
          fileName: undefined,
          fileSize: undefined,
          reactions: {},
          pinned: false,
          isEdited: false
        };
      }
      return m;
    }));

    // 2. Database update
    const collectionName = targetMsg?.sourceCollection || (activeChat.isLegacy ? "chats" : "conversations");
    const chatId = targetMsg?.sourceChatId || activeChat.id;
    try {
      const msgRef = doc(db, collectionName, chatId, "messages", msgId);
      await updateDoc(msgRef, {
        text: "This message was deleted",
        deleted: true,
        isDeleted: true,
        imageUrl: null,
        audioUrl: null,
        fileUrl: null,
        fileName: null,
        fileSize: null,
        reactions: {},
        pinned: false
      });

      if (activeChat.lastMessageSenderId === currentUserId) {
        const chatRef = doc(db, collectionName, chatId);
        await updateDoc(chatRef, {
          lastMessage: "This message was deleted"
        }).catch(() => {});
      }

      setToast({ message: "Message deleted for everyone", type: "info" });
    } catch (err) {
      console.error("Delete failed:", err);
      setToast({ message: "Failed to delete message", type: "error" });
    } finally {
      isDeletingMsgRef.current.delete(msgId);
    }
  };

  const handleDeleteForMe = async (msgId: string) => {
    if (!activeChat || !msgId) return;
    if (isDeletingMsgRef.current.has(msgId)) return;

    const targetMsg = messages.find(m => m.id === msgId);
    if (!targetMsg || targetMsg.deletedFor?.includes(currentUserId)) {
      setSelectedMsgId(null);
      return;
    }

    isDeletingMsgRef.current.add(msgId);
    deletedForMeSetRef.current.add(msgId);
    setSelectedMsgId(null);

    // 1. Optimistic UI update: remove from local messages state
    setMessages(prev => prev.filter(m => m.id !== msgId));

    // 2. Database update: Atomic arrayUnion
    const collectionName = targetMsg?.sourceCollection || (activeChat.isLegacy ? "chats" : "conversations");
    const chatId = targetMsg?.sourceChatId || activeChat.id;
    try {
      const msgRef = doc(db, collectionName, chatId, "messages", msgId);
      await updateDoc(msgRef, {
        deletedFor: arrayUnion(currentUserId)
      });
      setToast({ message: "Message deleted for you", type: "info" });
    } catch (err) {
      console.error("Delete for me failed:", err);
      setToast({ message: "Failed to delete message", type: "error" });
    } finally {
      isDeletingMsgRef.current.delete(msgId);
    }
  };

  const handleConfirmBatchDeleteForEveryone = async () => {
    const targets = [...deleteTargetMessages];
    setShowDeleteModal(false);
    setDeleteTargetMessages([]);
    setSelectedMsgIds(new Set());
    setSelectedMsgId(null);

    for (const msg of targets) {
      if (msg.senderId === currentUserId && !isMessageDeleted(msg)) {
        await handleDeleteForEveryone(msg.id);
      }
    }
  };

  const handleConfirmBatchDeleteForMe = async () => {
    const targets = [...deleteTargetMessages];
    setShowDeleteModal(false);
    setDeleteTargetMessages([]);
    setSelectedMsgIds(new Set());
    setSelectedMsgId(null);

    for (const msg of targets) {
      await handleDeleteForMe(msg.id);
    }
  };

  const handleExecuteForward = async (targetChatIds: string[]) => {
    if (targetChatIds.length === 0 || forwardTargetMessages.length === 0) return;
    const forwardable = forwardTargetMessages.filter(
      (msg) => !isMessageDeleted(msg) && !isEphemeralMediaMessage(msg)
    );
    if (forwardable.length === 0) {
      setToast({ message: "View once & replay media cannot be forwarded.", type: "info" });
      setShowForwardModal(false);
      return;
    }
    setShowForwardModal(false);
    try {
      for (const targetChatId of targetChatIds) {
        const targetChat = globalChats.find(c => c.id === targetChatId);
        const isLegacy = targetChat?.isLegacy ?? false;
        const collectionName = isLegacy ? "chats" : "conversations";
        
        for (const msg of forwardable) {
          const newMsgData: any = {
            senderId: currentUserId,
            timestamp: serverTimestamp(),
            createdAt: serverTimestamp(),
            status: "sent",
            isForwarded: true,
          };
          if (msg.text) newMsgData.text = msg.text;
          if (msg.imageUrl) newMsgData.imageUrl = msg.imageUrl;
          if (msg.videoUrl) newMsgData.videoUrl = msg.videoUrl;
          if (msg.mediaType) newMsgData.mediaType = msg.mediaType;
          if (msg.audioUrl) newMsgData.audioUrl = msg.audioUrl;
          if (msg.fileUrl) {
            newMsgData.fileUrl = msg.fileUrl;
            newMsgData.fileName = msg.fileName;
            newMsgData.fileSize = msg.fileSize;
          }

          await addDoc(collection(db, collectionName, targetChatId, "messages"), newMsgData);
          
          const lastMsgPreview = msg.text 
            ? `Forwarded: ${msg.text}` 
            : msg.videoUrl
              ? "Forwarded video"
              : msg.imageUrl 
                ? "Forwarded photo" 
                : msg.audioUrl 
                  ? "Forwarded voice message" 
                  : "Forwarded file";
          
          await updateDoc(doc(db, collectionName, targetChatId), {
            lastMessage: lastMsgPreview,
            lastMessageTime: serverTimestamp(),
            lastMessageAt: serverTimestamp(),
            lastMessageSenderId: currentUserId,
          }).catch(() => {});
        }
      }
      setToast({ message: `Message${forwardable.length > 1 ? "s" : ""} forwarded`, type: "info" });
    } catch (err) {
      console.error("Forwarding failed:", err);
      setToast({ message: "Failed to forward message", type: "error" });
    } finally {
      setSelectedMsgIds(new Set());
      setForwardTargetMessages([]);
    }
  };

  // Pin single message inside chat window
  const handleTogglePinMessage = async (msgId: string, currentlyPinned?: boolean) => {
    if (!activeChat) return;
    const targetMsg = messages.find(m => m.id === msgId);
    const collectionName = targetMsg?.sourceCollection || (activeChat.isLegacy ? "chats" : "conversations");
    const chatId = targetMsg?.sourceChatId || activeChat.id;
    try {
      const msgRef = doc(db, collectionName, chatId, "messages", msgId);
      await updateDoc(msgRef, {
        pinned: !currentlyPinned
      });
      setSelectedMsgId(null);
    } catch (e) {
      console.error("Message pinning toggle failed:", e);
    }
  };

  // Creating conversations from Instant Search
  const handleCreateNewConversation = async (targetUser: UserProfile) => {
    if (!targetUser?.uid || !currentUserId || targetUser.uid === currentUserId) return;

    // 1. First check if a conversation with targetUser already exists in globalChats
    const existing = globalChats.find((c) => {
      const otherId = getOtherParticipantId(c, currentUserId);
      return otherId === targetUser.uid;
    });
    if (existing) {
      setActiveChat({ ...existing, otherUser: targetUser } as ExtendedChat);
      if (onChatSelect) onChatSelect(existing.id);
      setSearchQuery("");
      setIsSearchOpen(false);
      return;
    }

    try {
      const isConnected = (currentUserProfile?.followingList || []).includes(targetUser.uid) ||
        (targetUser.followingList || []).includes(currentUserId);

      const requestOptions = isConnected 
        ? { requestStatus: "accepted" as const, isRequest: false }
        : { 
            requestStatus: "pending" as const, 
            requestedBy: currentUserId, 
            requestedTo: targetUser.uid, 
            isRequest: true 
          };

      const { chatId, isLegacy } = await getOrCreateConversation(
        currentUserId, 
        targetUser.uid, 
        "Conversation initiated",
        requestOptions
      );

      const convDoc = isLegacy 
        ? await getDoc(doc(db, "chats", chatId))
        : await getDoc(doc(db, "conversations", chatId));

      const now = new Date();
      const convData = convDoc.exists() ? (convDoc.data() as Chat) : ({
        id: chatId,
        participantIds: [currentUserId, targetUser.uid].sort(),
        lastMessage: "Conversation initiated",
        lastMessageSenderId: currentUserId,
        lastMessageTime: now,
        lastMessageAt: now,
        updatedAt: now,
        createdAt: now,
        unreadCount: { [currentUserId]: 0, [targetUser.uid]: 0 },
        ...requestOptions
      } as Chat);

      setActiveChat({
        ...convData,
        id: chatId,
        otherUser: targetUser,
        isLegacy
      });
      if (onChatSelect) onChatSelect(chatId);
      setSearchQuery("");
      setIsSearchOpen(false);
    } catch (e) {
      console.error("Failed to start new conversation:", e);
    }
  };

  // Matched platform users who don't already have an active conversation
  const nonChatSearchResults = useMemo(() => {
    if (!searchQuery.trim() || searchResults.length === 0) return [];
    const existingOtherUserIds = new Set(
      (globalChats as ExtendedChat[]).map(c => c?.otherUserId || getOtherParticipantId(c, currentUserId))
    );
    return searchResults.filter(u => !existingOtherUserIds.has(u.uid) && u.uid !== currentUserId);
  }, [searchQuery, searchResults, globalChats, currentUserId]);

  // Search inside chat filtering
  const chatMessagesFiltered = useMemo(() => {
    if (!searchInChatText.trim()) return messages;
    const qLower = searchInChatText.toLowerCase();
    return messages.filter(m => m.text?.toLowerCase().includes(qLower));
  }, [messages, searchInChatText]);

  const pinnedMessagesInChat = useMemo(() => {
    return messages.filter(m => m.pinned && !m.deleted);
  }, [messages]);

  // Helper date formatting
  const formatMsgTime = (val: any) => {
    if (!val) return "";
    let date: Date | null = null;
    if (typeof val === "number") {
      date = new Date(val < 1e11 ? val * 1000 : val);
    } else if (val && typeof val.toMillis === "function") {
      date = new Date(val.toMillis());
    } else if (val && val.seconds !== undefined) {
      date = new Date(val.seconds * 1000 + (val.nanoseconds || 0) / 1e6);
    } else if (val instanceof Date) {
      date = val;
    } else if (typeof val === "string") {
      const parsed = Date.parse(val);
      if (!isNaN(parsed)) date = new Date(parsed);
    }
    if (!date || isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatLastSeen = (timestamp: any) => {
    if (!timestamp) return "Offline";
    const seconds = timestamp?.seconds || (typeof timestamp === "string" ? Date.parse(timestamp) / 1000 : null);
    if (!seconds) return "Offline";
    const d = new Date(seconds * 1000);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Active just now";
    if (diffMins < 60) return `Active ${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Active ${diffHours}h ago`;

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return `Active yesterday at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    return `Active on ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  };

  const formatChatTimestamp = (timestamp: any) => {
    if (!timestamp) return "";
    let d: Date | null = null;
    if (typeof timestamp === "number") {
      d = new Date(timestamp < 1e11 ? timestamp * 1000 : timestamp);
    } else if (timestamp && typeof timestamp.toMillis === "function") {
      d = new Date(timestamp.toMillis());
    } else if (timestamp && timestamp.seconds !== undefined) {
      d = new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1e6);
    } else if (timestamp instanceof Date) {
      d = timestamp;
    } else if (typeof timestamp === "string") {
      const parsed = Date.parse(timestamp);
      if (!isNaN(parsed)) d = new Date(parsed);
    }
    if (!d || isNaN(d.getTime())) return "";
    const now = new Date();
    
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    }
    
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex-1 min-h-0 h-full w-full bg-theme-bg relative text-theme-text overflow-hidden rounded-none md:flex">
      
      {/* 1. CHAT LIST / SIDEBAR PANEL */}
      <motion.div 
        initial={false}
        animate={{
          x: activeChat ? "-24%" : "0%",
          opacity: activeChat ? 0 : 1,
        }}
        transition={{
          duration: 0.18,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={`absolute inset-0 md:relative md:inset-auto w-full md:w-72 lg:w-80 shrink-0 flex flex-col border-r border-neutral-200/60 dark:border-neutral-800/80 bg-white dark:bg-[#111215] h-full transform-gpu will-change-transform md:transform-none! md:opacity-100! ${
          activeChat ? "pointer-events-none md:pointer-events-auto" : ""
        }`}
      >
        
        {/* Luxury Executive Header, Search Bar & Segmented Filters */}
        <div className="flex flex-col border-b border-neutral-200/60 dark:border-neutral-800/80 bg-white dark:bg-[#111215] shrink-0 select-none">
          {/* Header Row */}
          <div className="px-4 pt-[max(env(safe-area-inset-top,0px),16px)] pb-2 flex items-center justify-between w-full">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white font-display">
                Chats
              </h1>
              {totalUnreadMessages > 0 && (
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-[#C9A96E] text-[#0D0D0F] shadow-2xs">
                  {totalUnreadMessages > 99 ? "99+" : totalUnreadMessages}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen((prev) => {
                    const next = !prev;
                    if (next) {
                      setTimeout(() => searchInputRef.current?.focus(), 60);
                    } else {
                      setSearchQuery("");
                    }
                    return next;
                  });
                }}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isSearchOpen
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs"
                    : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
                title={isSearchOpen ? "Close search" : "Search conversations or contacts"}
                aria-label="Search conversations"
              >
                <Search size={17} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(true);
                  setTimeout(() => searchInputRef.current?.focus(), 60);
                }}
                className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition cursor-pointer"
                title="New chat / find contact"
                aria-label="New chat"
              >
                <SquarePen size={16} />
              </button>
            </div>
          </div>

          {/* Collapsible Search Drawer: Pops up only when user clicks Search */}
          <AnimatePresence>
            {(isSearchOpen || searchQuery.trim().length > 0) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="overflow-hidden px-3.5 pt-1 pb-2"
              >
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 flex items-center group">
                    <Search className="absolute left-3.5 w-4 h-4 text-neutral-400 group-focus-within:text-neutral-900 dark:group-focus-within:text-white transition-colors pointer-events-none" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search conversations or contacts..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9.5 pr-8 py-2 bg-neutral-100/90 dark:bg-neutral-800/60 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/90 focus:bg-white dark:focus:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-700/50 focus:border-neutral-900/20 dark:focus:border-white/20 rounded-xl text-[13px] text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none focus:ring-2 focus:ring-neutral-900/5 dark:focus:ring-white/10 transition-all duration-200 shadow-2xs"
                    />
                    {searchQuery.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2.5 p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition cursor-pointer"
                        aria-label="Clear search text"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSearchOpen(false);
                      setSearchQuery("");
                    }}
                    className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white px-2 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition cursor-pointer shrink-0 select-none"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Executive Segmented Filter Control */}
          <div className="px-3.5 pb-2.5 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1 p-1 bg-neutral-100/90 dark:bg-neutral-800/70 rounded-xl border border-neutral-200/50 dark:border-neutral-700/40">
              {[
                { id: "", label: "All", count: undefined },
                { id: "Unread", label: "Unread", count: totalUnreadChats },
                { id: "Calls", label: "Calls", count: totalCallsCount },
                { id: "Pinned", label: "Pinned", count: totalPinnedChats },
                { id: "Archived", label: "Archived", count: totalArchivedChats },
              ].map((chip) => {
                const isSelected = (chip.id === "" && chatFilterText === "") || chatFilterText === chip.id;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => setChatFilterText(chip.id)}
                    className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11.5px] font-medium rounded-lg transition-all duration-150 cursor-pointer shrink-0 whitespace-nowrap select-none ${
                      isSelected
                        ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs font-semibold scale-[1.01]"
                        : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-neutral-700/30"
                    }`}
                  >
                    <span>{chip.label}</span>
                    {chip.count !== undefined && chip.count > 0 && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                          chip.id === "Unread"
                            ? "bg-[#C9A96E] text-[#0D0D0F]"
                            : isSelected
                              ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white"
                              : "bg-neutral-200/70 dark:bg-neutral-700/70 text-neutral-600 dark:text-neutral-300"
                        }`}
                      >
                        {chip.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Instagram-Style Notes Tray (Authentic 24h Notes, 0 Extra Reads) */}
        {!showRequestsView && !searchQuery.trim() && (
          <InstagramNotesTray
            currentUserProfile={currentUserProfile}
            userNote={userNoteObj}
            contacts={(() => {
              const seenUids = new Set<string>();
              const items: NoteTrayContact[] = [];

              filteredChats.slice(0, 16).forEach((c) => {
                const otherId = c.otherUserId || getOtherParticipantId(c, currentUserId);
                if (!otherId || otherId === currentUserId || seenUids.has(otherId)) return;
                seenUids.add(otherId);
                const otherUserObj = resolveOtherUserProfile(otherId, c, profilesCache, chatProfiles);
                const name = otherUserObj?.fullName?.trim() || (c as any).otherUserName?.trim() || "Partner";
                const photo = otherUserObj?.photoUrl || otherUserObj?.photoURL || otherUserObj?.profilePhotoUrl || (c as any).otherUserPhoto;
                const validNote = getValidActiveNote(otherUserObj?.activeNote);
                const isOtherTyping = Boolean(activeChat?.id === c.id && otherUserTyping);
                items.push({
                  uid: otherId,
                  chatId: c.id,
                  chatObj: c,
                  profile: otherUserObj,
                  displayName: name,
                  photoUrl: photo,
                  note: validNote,
                  isTyping: isOtherTyping,
                });
              });

              // Also include any in-memory cached connections who posted an active note (0 extra reads)
              if (profilesCache) {
                (Object.values(profilesCache) as UserProfile[]).forEach((p) => {
                  if (!p?.uid || p.uid === currentUserId || seenUids.has(p.uid)) return;
                  const validNote = getValidActiveNote(p.activeNote);
                  if (!validNote) return;
                  const isConnected = (currentUserProfile?.followingList || []).includes(p.uid) ||
                    (p.followingList || []).includes(currentUserId);
                  if (!isConnected) return;
                  seenUids.add(p.uid);
                  items.push({
                    uid: p.uid,
                    profile: p,
                    displayName: p.fullName || p.username || "Partner",
                    photoUrl: p.photoUrl || p.photoURL || p.profilePhotoUrl,
                    note: validNote,
                  });
                });
              }

              // Sort contacts with active 24h notes first (newest note first), then recent chats
              items.sort((a, b) => {
                const aHas = a.note ? 1 : 0;
                const bHas = b.note ? 1 : 0;
                if (aHas !== bHas) return bHas - aHas;
                if (a.note && b.note) return (b.note.createdAt || 0) - (a.note.createdAt || 0);
                return 0;
              });

              return items.slice(0, 14);
            })()}
            onOpenOwnNote={() => setIsEditingNote(true)}
            onSelectContact={async (contact) => {
              if (getValidActiveNote(contact.note)) {
                setViewingContactNote(contact);
                return;
              }
              if (contact.chatObj) {
                setActiveChat(contact.chatObj);
                if (onChatSelect) onChatSelect(contact.chatObj.id);
              } else {
                const res = await getOrCreateConversation(currentUserId, contact.uid);
                const syntheticChat: ExtendedChat = {
                  id: res.chatId,
                  participantIds: [currentUserId, contact.uid],
                  otherUserId: contact.uid,
                  otherUser: contact.profile || undefined,
                  lastMessage: "",
                  lastMessageSenderId: currentUserId,
                  lastMessageTime: new Date(),
                  unreadCount: { [currentUserId]: 0, [contact.uid]: 0 },
                  isLegacy: res.isLegacy,
                };
                setActiveChat(syntheticChat);
                if (onChatSelect) onChatSelect(res.chatId);
              }
            }}
          />
        )}

        {/* Message Requests Navigation Banner (VIP Inbox Style) */}
        {!showRequestsView && messageRequests.length > 0 && (
          <button
            onClick={() => setShowRequestsView(true)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-500/[0.04] hover:bg-amber-500/[0.08] dark:bg-amber-500/[0.06] border-b border-amber-500/15 transition cursor-pointer group select-none shrink-0"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8.5 h-8.5 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-700 dark:text-amber-400 relative shrink-0">
                <Inbox size={15} />
                {unreadRequestsCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-neutral-900 animate-pulse" />
                )}
              </div>
              <div className="text-left truncate">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-neutral-900 dark:text-white group-hover:text-amber-600 transition-colors">
                    Message Requests
                  </span>
                  {unreadRequestsCount > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-rose-500 text-white">
                      {unreadRequestsCount} new
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                  {messageRequests.length} pending connection{messageRequests.length > 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <ChevronRight size={15} className="text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition shrink-0 ml-2" />
          </button>
        )}

        {/* Requests Sub-view Mode */}
        {showRequestsView ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Requests Header */}
            <div className="p-3 px-4 border-b border-theme-border/60 flex items-center justify-between bg-theme-surface shrink-0 select-none">
              <button
                onClick={() => setShowRequestsView(false)}
                className="flex items-center gap-1 text-xs font-semibold text-theme-secondary hover:text-theme-text transition cursor-pointer"
              >
                <ChevronLeft size={16} />
                <span>All Chats</span>
              </button>
              <h3 className="text-xs font-bold text-theme-text uppercase tracking-wider">Requests</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-theme-accent/15 text-theme-accent border border-theme-accent/30 font-mono">
                {messageRequests.length}
              </span>
            </div>

            {/* Requests Info Note */}
            <div className="p-3 bg-theme-bg/50 border-b border-theme-border/40 text-[11px] text-theme-secondary leading-relaxed flex items-start gap-2 select-none shrink-0">
              <Info size={14} className="text-theme-accent shrink-0 mt-0.5" />
              <span>
                Open a request to preview the message. The sender won't know you've seen it until you choose to accept.
              </span>
            </div>

            {/* Requests Filter Search */}
            <div className="p-2.5 border-b border-theme-border/60">
              <div className="relative flex items-center">
                <Search className="absolute left-3 w-3.5 h-3.5 text-theme-secondary/70 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter requests..."
                  value={requestsSearchText}
                  onChange={(e) => setRequestsSearchText(e.target.value)}
                  className="w-full pl-8 pr-4 py-1.5 bg-theme-bg border border-theme-border/60 rounded-lg text-xs outline-none focus:border-theme-accent transition"
                />
              </div>
            </div>

            {/* Requests List */}
            <PullToRefresh
              onRefresh={refreshChats}
              className="flex-1 min-h-0 overflow-y-auto divide-y divide-theme-border/40 mobile-scroll"
            >
              {messageRequests.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center p-6 text-center text-theme-secondary select-none">
                  <Inbox className="w-8 h-8 text-theme-border mb-2 opacity-50" />
                  <p className="text-xs font-medium text-theme-text">No message requests</p>
                  <p className="text-[10px] text-theme-secondary/70 mt-1">
                    When non-connected users send you messages, they will appear here.
                  </p>
                </div>
              ) : (
                messageRequests
                  .filter((req) => {
                    if (!requestsSearchText.trim()) return true;
                    const q = requestsSearchText.toLowerCase();
                    const otherId = req.otherUserId || getOtherParticipantId(req, currentUserId);
                    const userObj = resolveOtherUserProfile(otherId, req, profilesCache, chatProfiles);
                    return (
                      userObj?.fullName?.toLowerCase().includes(q) ||
                      userObj?.username?.toLowerCase().includes(q) ||
                      req.lastMessage?.toLowerCase().includes(q)
                    );
                  })
                  .map((req) => {
                    const otherId = req.otherUserId || getOtherParticipantId(req, currentUserId);
                    const otherUserObj = resolveOtherUserProfile(otherId, req, profilesCache, chatProfiles);
                    const isActive = activeChat?.id === req.id;

                    return (
                      <div
                        key={req.id}
                        onClick={() => {
                          setActiveChat(req);
                          if (onChatSelect) onChatSelect(req.id);
                        }}
                        className={`p-3.5 hover:bg-theme-bg/60 transition-all duration-150 cursor-pointer relative select-none border-l-[3px] ${
                          isActive ? "bg-theme-bg/90 border-theme-accent shadow-2xs" : "border-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <SmartImage
                            src={otherUserObj?.photoUrl || otherUserObj?.profilePhotoUrl}
                            alt={otherUserObj?.fullName || "User"}
                            className="w-10 h-10 rounded-full border border-theme-border shadow-2xs shrink-0 object-cover"
                            fallbackType="profile"
                            fullName={otherUserObj?.fullName}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1.5">
                              <p className="text-[13px] font-semibold truncate text-theme-text">
                                {otherUserObj?.fullName || "User"}
                              </p>
                              <span className="text-[9px] text-theme-secondary/80 font-mono shrink-0">
                                {formatChatTimestamp(req.lastMessageAt || req.lastMessageTime || req.updatedAt)}
                              </span>
                            </div>
                            <p className="text-xs text-theme-secondary truncate mt-0.5">
                              {req.lastMessage || "Sent a message request"}
                            </p>
                          </div>
                        </div>

                        {/* Fast Actions in Request Item */}
                        <div className="flex items-center justify-end gap-2 mt-2.5 pt-2 border-t border-theme-border/30">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRequest(req.id);
                            }}
                            className="px-2.5 py-1 rounded-lg border border-theme-border bg-theme-bg hover:bg-theme-border text-theme-secondary hover:text-theme-text text-[11px] font-medium transition cursor-pointer"
                          >
                            Delete
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAcceptRequest(req.id);
                            }}
                            className="px-3 py-1 rounded-lg bg-theme-accent hover:opacity-95 text-white text-[11px] font-bold transition cursor-pointer shadow-2xs"
                          >
                            Accept
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </PullToRefresh>
          </div>
        ) : (
          /* Conversations List */
          <PullToRefresh
            onRefresh={refreshChats}
            className="flex-1 min-h-0 overflow-y-auto py-1 mobile-scroll"
          >
            {loadingChats && globalChats.length === 0 ? (
              <div className="p-3">
                <SkeletonLoader type="messages" count={6} />
              </div>
            ) : filteredChats.length === 0 && nonChatSearchResults.length === 0 && !searchingUsers ? (
              <div className="h-56 flex flex-col items-center justify-center p-6 text-center text-neutral-400 select-none">
                <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800/80 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center mb-3 text-neutral-400">
                  <MessageSquare className="w-5 h-5 opacity-70" />
                </div>
                <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                  {searchQuery.trim()
                    ? `No chats found for "${searchQuery}"`
                    : chatFilterText === "Unread"
                    ? "No unread messages"
                    : chatFilterText === "Pinned"
                    ? "No pinned conversations"
                    : chatFilterText === "Archived"
                    ? "No archived conversations"
                    : "No conversations yet"}
                </p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 max-w-[220px]">
                  {searchQuery.trim()
                    ? "Try searching another name or skill"
                    : "Search for a partner or start swapping skills to chat"}
                </p>
              </div>
            ) : (
              <>
                {filteredChats.map((c, idx) => {
                  const otherId = c.otherUserId || getOtherParticipantId(c, currentUserId);
                  const otherUserObj = resolveOtherUserProfile(otherId, c, profilesCache, chatProfiles);
                  const isPinned = c.pinnedUsers?.includes(currentUserId);
                  const unread = c.unreadCount?.[currentUserId] || 0;
                  const mentionCount = c.unreadMentionCount?.[currentUserId] || 0;
                  const isActive = activeChat?.id === c.id;
                  const isOutgoingPending = c.requestStatus === "pending" && c.requestedBy === currentUserId;
                  const isOtherOnline = Boolean(otherId && otherUserPresence?.userId === otherId && otherUserPresence?.status === "online");
                  const isOtherTyping = Boolean(isActive && otherUserTyping && otherId && otherId !== currentUserId);

                  const displayName = otherUserObj?.fullName?.trim() 
                    || (c as any).otherUserName?.trim() 
                    || (otherUserObj?.username ? (otherUserObj.username.replace(/@/g, "").charAt(0).toUpperCase() + otherUserObj.username.replace(/@/g, "").slice(1)) : "Swap Partner");

                  const lastMsg = c.lastMessage || "";
                  const isMissedCall = lastMsg.toLowerCase().includes("missed") && lastMsg.toLowerCase().includes("call");
                  const isDeleted = lastMsg.toLowerCase().includes("message was deleted");
                  const isSelfSender = c.lastMessageSenderId === currentUserId;

                  const myUsernameLower = (currentUserProfile?.username || "").toLowerCase();
                  const myFullHandleLower = (currentUserProfile?.fullName?.replace(/\s+/g, "") || "").toLowerCase();
                  const myFirstLower = (currentUserProfile?.fullName?.split(" ")[0] || "").toLowerCase();
                  const lastMsgLower = lastMsg.toLowerCase();
                  const hasMention = Boolean(
                    unread > 0 &&
                    !isSelfSender &&
                    (
                      mentionCount > 0 ||
                      c.lastMessageHasMention ||
                      (myUsernameLower && lastMsgLower.includes(`@${myUsernameLower}`)) ||
                      (myFullHandleLower && lastMsgLower.includes(`@${myFullHandleLower}`)) ||
                      (myFirstLower && lastMsgLower.includes(`@${myFirstLower}`))
                    )
                  );

                  return (
                    <div key={c.id}>
                      <div
                        onClick={() => {
                          setActiveChat(c);
                          setIsSearchOpen(false);
                          setSearchQuery("");
                          if (onChatSelect) onChatSelect(c.id);
                        }}
                        className={`group relative flex items-center gap-3.5 px-3 py-2.5 mx-2 rounded-2xl transition-all duration-150 cursor-pointer select-none touch-manipulation active:scale-[0.98] ${
                          isActive
                            ? "bg-neutral-100 dark:bg-neutral-800 shadow-2xs ring-1 ring-black/5 dark:ring-white/10"
                            : "hover:bg-neutral-50 dark:hover:bg-white/[0.04] active:bg-neutral-100/70 dark:active:bg-neutral-800/50"
                        }`}
                      >
                        {/* Avatar with luxury ring & presence */}
                        <div className="relative shrink-0">
                          <div className="w-12 h-12 rounded-full ring-1 ring-black/5 dark:ring-white/10 p-0.5 bg-white dark:bg-neutral-900 shadow-2xs">
                            <SmartImage 
                              src={otherUserObj?.photoUrl || otherUserObj?.profilePhotoUrl} 
                              alt={displayName} 
                              className="w-full h-full rounded-full object-cover" 
                              fallbackType="profile" 
                              fullName={displayName} 
                            />
                          </div>
                          {/* Presence Indicator */}
                          <span className={`absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full ring-2 ring-white dark:ring-neutral-900 ${
                            isOtherTyping ? "bg-amber-500 animate-pulse" :
                            isOtherOnline ? "bg-emerald-500 shadow-xs" : "bg-neutral-300 dark:bg-neutral-600"
                          }`} />
                        </div>

                        {/* Content Preview */}
                        <div className="flex-1 min-w-0">
                          {/* Top: Name & Timestamp */}
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0 truncate">
                              <span className={`text-[14px] truncate tracking-tight ${unread > 0 ? "font-bold text-[#0D0D0F] dark:text-white" : "font-semibold text-neutral-800 dark:text-neutral-200"}`}>
                                {displayName}
                              </span>
                              {isOutgoingPending && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200/50 dark:border-amber-800/40 text-amber-700 dark:text-amber-400 text-[9.5px] font-medium shrink-0">
                                  <Clock size={9} />
                                  <span>Requested</span>
                                </span>
                              )}
                            </div>
                            <span className={`text-[11px] tracking-tight shrink-0 ${
                              unread > 0
                                ? "font-medium text-[#B58E47] dark:text-[#C9A96E]"
                                : "font-normal text-neutral-400 dark:text-neutral-500"
                            }`}>
                              {formatChatTimestamp(c.lastMessageAt || c.lastMessageTime || c.updatedAt)}
                            </span>
                          </div>

                          {/* Bottom: Message Snippet & Indicators */}
                          <div className="flex items-center justify-between mt-1 gap-2">
                            <div className="flex items-center gap-1.5 min-w-0 truncate flex-1">
                              {/* Delivery checkmark if current user sent last message */}
                              {!isOtherTyping && isSelfSender && (
                                unread === 0 ? (
                                  <CheckCheck size={14} className="text-sky-500 shrink-0" />
                                ) : (
                                  <Check size={13} className="text-neutral-400 shrink-0" />
                                )
                              )}

                              {isOtherTyping ? (
                                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1.5">
                                  <span className="inline-flex gap-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                                  </span>
                                  <span>typing...</span>
                                </p>
                              ) : isMissedCall ? (
                                <p className="text-xs text-rose-500 dark:text-rose-400 font-medium truncate flex items-center gap-1">
                                  <PhoneMissed size={12} className="shrink-0" />
                                  <span>{lastMsg}</span>
                                </p>
                              ) : isDeleted ? (
                                <p className="text-xs text-neutral-400 dark:text-neutral-500 italic truncate flex items-center gap-1">
                                  <Slash size={11} className="shrink-0" />
                                  <span>This message was deleted</span>
                                </p>
                              ) : (
                                <p className={`text-[12.5px] truncate ${unread > 0 ? "text-[#0D0D0F] dark:text-[#F7F4EE] font-medium" : "text-neutral-500 dark:text-neutral-400"}`}>
                                  {lastMsg || "Started a conversation"}
                                </p>
                              )}
                            </div>

                            {/* Right meta: Mention badge, Unread badge or Pinned icon, plus desktop-only hover call actions */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              {onStartCall && otherId && (
                                <div className="hidden sm:group-hover:flex items-center gap-0.5 transition-all">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const target = otherUserObj || ({
                                        uid: otherId,
                                        id: otherId,
                                        fullName: displayName,
                                        photoUrl: otherUserObj?.photoUrl || (c as any).otherUserPhoto || "",
                                        photoURL: otherUserObj?.photoUrl || (c as any).otherUserPhoto || "",
                                      } as unknown as UserProfile);
                                      onStartCall(target, "audio", c.id);
                                    }}
                                    className="w-6.5 h-6.5 rounded-full flex items-center justify-center text-neutral-500 hover:text-amber-600 hover:bg-neutral-200/70 dark:hover:bg-neutral-700/60 transition cursor-pointer"
                                    title="Voice call"
                                    aria-label="Voice call"
                                  >
                                    <Phone size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const target = otherUserObj || ({
                                        uid: otherId,
                                        id: otherId,
                                        fullName: displayName,
                                        photoUrl: otherUserObj?.photoUrl || (c as any).otherUserPhoto || "",
                                        photoURL: otherUserObj?.photoUrl || (c as any).otherUserPhoto || "",
                                      } as unknown as UserProfile);
                                      onStartCall(target, "video", c.id);
                                    }}
                                    className="w-6.5 h-6.5 rounded-full flex items-center justify-center text-neutral-500 hover:text-amber-600 hover:bg-neutral-200/70 dark:hover:bg-neutral-700/60 transition cursor-pointer"
                                    title="Video call"
                                    aria-label="Video call"
                                  >
                                    <Video size={13} />
                                  </button>
                                </div>
                              )}
                              {isPinned && <Pin size={11} className="text-amber-500/80 fill-amber-500/30 rotate-45 shrink-0" />}
                              {hasMention && (
                                <span
                                  className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#C9A96E]/15 border border-[#C9A96E]/60 text-[#9A783A] dark:text-[#C9A96E] text-[10px] font-bold flex items-center justify-center shrink-0"
                                  title="Mentioned you"
                                >
                                  @
                                </span>
                              )}
                              {unread > 0 && (
                                <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#C9A96E] text-[#0D0D0F] text-[10px] font-bold flex items-center justify-center shadow-2xs shrink-0">
                                  {unread > 99 ? "99+" : unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Inset Divider */}
                      {idx < filteredChats.length - 1 && (
                        <div className="ml-[72px] mr-4 border-b border-neutral-100 dark:border-neutral-800/60" />
                      )}
                    </div>
                  );
                })}

                {/* Platform search matches when searching new contacts */}
                {searchQuery.trim().length > 0 && nonChatSearchResults.length > 0 && (
                  <div className="p-3 bg-neutral-50/70 dark:bg-neutral-900/60 border-t border-neutral-200/50 dark:border-neutral-800/60 mt-2">
                    <div className="text-[10.5px] uppercase tracking-wider text-neutral-400 font-semibold px-1 py-1 flex items-center justify-between">
                      <span>People on SwapSkill</span>
                      {searchingUsers && <Loader2 className="w-3 h-3 animate-spin text-amber-500" />}
                    </div>
                    <div className="flex flex-col gap-1 mt-1.5">
                      {nonChatSearchResults.map((u) => (
                        <div 
                          key={u.uid}
                          onClick={() => handleCreateNewConversation(u)}
                          className="flex items-center gap-3 p-2.5 hover:bg-white dark:hover:bg-neutral-800 rounded-xl transition cursor-pointer shadow-2xs border border-transparent hover:border-neutral-200/50 dark:hover:border-neutral-700/50"
                        >
                          <SmartImage 
                            src={u.photoUrl || u.profilePhotoUrl} 
                            alt={u.fullName} 
                            className="w-10 h-10 rounded-full border border-neutral-200/80 dark:border-neutral-700/80 object-cover shrink-0" 
                            fallbackType="profile" 
                            fullName={u.fullName} 
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate text-neutral-900 dark:text-white">{u.fullName}</p>
                            <p className="text-[11px] text-neutral-400 truncate">@{u.username}</p>
                          </div>
                          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 rounded-lg shrink-0 transition">
                            Message
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </PullToRefresh>
        )}
      </motion.div>

      {/* 2. CHAT AREA WINDOW */}
      <motion.div 
        id="chat-area-window"
        initial={false}
        animate={{
          x: activeChat ? "0%" : "100%",
        }}
        transition={{
          duration: 0.18,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={`absolute inset-0 md:relative md:inset-auto z-30 md:z-auto flex-1 flex flex-col min-w-0 w-full md:w-auto h-full min-h-0 bg-[#F4EFE6] dark:bg-[#0D0D10] overflow-hidden transform-gpu will-change-transform md:transform-none! ${
          !effectiveChat ? "pointer-events-none md:pointer-events-auto" : ""
        }`}
      >
        {effectiveChat ? (
          <>
            {/* Header: WhatsApp-style Selection Header when selecting messages, otherwise standard ChatHeader */}
            {selectedMsgIds.size > 0 ? (
              <SelectionHeader
                selectedCount={selectedMsgIds.size}
                onExitSelection={() => setSelectedMsgIds(new Set())}
                onCopy={handleCopySelected}
                onForward={handleOpenForwardForSelected}
                onDelete={handleOpenDeleteForSelected}
              />
            ) : (
              <ChatHeader 
                otherUserProfile={otherUserProfile}
                otherUserPresence={otherUserPresence}
                otherUserTyping={otherUserTyping}
                onBackClick={() => {
                  setActiveChat(null);
                  if (onChatSelect) onChatSelect(null);
                  if (onCloseChat) onCloseChat();
                }}
                onSearchInChatClick={() => setShowSearchInChat(!showSearchInChat)}
                onDropdownToggle={() => setShowOptionsDropdown(!showOptionsDropdown)}
                showOptionsDropdown={showOptionsDropdown}
                activeChat={effectiveChat}
                currentUserId={currentUserId}
                handleTogglePinChat={handleTogglePinChat}
                handleToggleArchiveChat={handleToggleArchiveChat}
                handleToggleMuteChat={handleToggleMuteChat}
                handleToggleBlockUser={handleToggleBlockUser}
                setShowReportModal={setShowReportModal}
                blockedUsers={blockedUsers}
                formatLastSeen={formatLastSeen}
                onSelectUser={onSelectUser}
                hasExchangedMessages={messages.length > 0}
                onVoiceCall={handleInitiateVoiceCall}
                onVideoCall={handleInitiateVideoCall}
                onOpenGallery={() => setShowGalleryModal(true)}
                onOpenStarred={() => setShowStarredModal(true)}
                onOpenWallpaper={() => setShowWallpaperModal(true)}
                onOpenChatInfo={() => setShowChatInfoModal(true)}
              />
            )}

            {/* In-Chat Search Drawer */}
            {showSearchInChat && (
              <div className="flex-none bg-[#111216]/95 backdrop-blur-xl border-b border-white/[0.08] px-3.5 py-2.5 flex items-center justify-between gap-2.5 relative z-10 animate-fade-in select-none">
                <div className="relative flex-1 flex items-center">
                  <SearchIcon className="absolute left-3 w-3.5 h-3.5 text-[#D4AF37] pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search in conversation..."
                    value={searchInChatText}
                    onChange={(e) => setSearchInChatText(e.target.value)}
                    autoFocus
                    className="w-full pl-9 pr-16 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded-xl text-xs text-white placeholder-zinc-500 outline-none focus:border-[#D4AF37]/70 transition"
                  />
                  {searchInChatText && (
                    <span className="absolute right-3 text-[10px] font-mono tabular-nums text-zinc-400">
                      {chatMessagesFiltered.length} match{chatMessagesFiltered.length === 1 ? "" : "es"}
                    </span>
                  )}
                </div>
                <button 
                  onClick={() => {
                    setSearchInChatText("");
                    setShowSearchInChat(false);
                  }}
                  className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/10 active:scale-90 text-zinc-400 hover:text-white flex items-center justify-center transition cursor-pointer"
                  title="Close search"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Pinned Messages Header Ribbon */}
            {pinnedMessagesInChat.length > 0 && (
              <div className="flex-none bg-theme-surface/70 border-b border-theme-border/75 py-1.5 px-3 flex items-center justify-between gap-3 text-xs relative z-10 animate-fade-in">
                <div className="flex items-center gap-2 min-w-0">
                  <Pin size={12} className="text-theme-accent rotate-45 shrink-0" />
                  <span className="font-semibold text-[11px] uppercase tracking-wider text-theme-secondary shrink-0">Pinned Message:</span>
                  <p className="truncate text-theme-text font-light text-[11px]">{pinnedMessagesInChat[0].text || "[Attachment]"}</p>
                </div>
                <button 
                  onClick={() => handleTogglePinMessage(pinnedMessagesInChat[0].id, true)}
                  className="text-[10px] text-theme-accent font-semibold tracking-wide hover:underline cursor-pointer shrink-0"
                >
                  Unpin
                </button>
              </div>
            )}

            {/* Outgoing Message Request Waiting Banner */}
            {activeChat && activeChat.requestStatus === "pending" && activeChat.requestedBy === currentUserId && (
              <div className="flex-none bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between text-xs text-amber-600 select-none animate-fade-in">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="shrink-0 text-amber-500" />
                  <span className="font-medium text-[11.5px]">
                    Message Request Sent • Waiting for {otherUserProfile?.fullName || "recipient"} to accept
                  </span>
                </div>
              </div>
            )}

            {/* Incoming Message Request Preview Notice */}
            {activeChat && (activeChat.requestStatus === "pending" || activeChat.isRequest === true) && (activeChat.requestedTo === currentUserId || (activeChat.requestedBy && activeChat.requestedBy !== currentUserId)) && (
              <div className="flex-none bg-theme-accent/10 border-b border-theme-accent/20 px-4 py-2 flex items-center justify-between text-xs text-theme-accent select-none animate-fade-in">
                <div className="flex items-center gap-2">
                  <Inbox size={14} className="shrink-0 text-theme-accent" />
                  <span className="font-medium text-[11px]">
                    Message Request • Previewing conversation from {otherUserProfile?.fullName || "User"}
                  </span>
                </div>
              </div>
            )}

            {/* Main Chat Stage with Full-Height Fixed WhatsApp Wallpaper Layer (Visible behind messages AND floating input bar) */}
            <div className="relative flex-1 min-h-0 flex flex-col w-full overflow-hidden">
              {/* Fixed Wallpaper Background (SwapSkill Warm Linen / Obsidian default, spans behind messages & floating bar) */}
              <div 
                className="absolute inset-0 w-full h-full pointer-events-none select-none bg-[#F4EFE6] dark:bg-[#0D0D10]"
                style={{ 
                  backgroundImage: activeWallpaperPreset?.id !== "default" && activeWallpaperPreset?.imageUrl
                    ? `linear-gradient(rgba(13, 13, 16, ${wallpaperDim}), rgba(13, 13, 16, ${wallpaperDim})), url("${activeWallpaperPreset.imageUrl}")`
                    : (activeWallpaperPreset?.id !== "default"
                        ? activeWallpaperPreset?.patternSvg
                        : `url("data:image/svg+xml,%3Csvg width='120' height='120' viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%239C8A6E' stroke-width='1.1' stroke-opacity='0.15' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 25h16a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-8l-5 4v-4h-3a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z'/%3E%3Cpath d='M75 20l25 8-12 12-13-20zm13 8l-8 7'/%3E%3Cpath d='M20 75a6 6 0 0 0 6 6h12a6 6 0 0 0 6-6v-12h-24v12zm18-6a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-1a3 3 0 0 1-3-3z'/%3E%3Cpath d='M85 70a6 6 0 0 0-8.5 0l-.5.5-.5-.5a6 6 0 0 0-8.5 8.5l9 9 9-9a6 6 0 0 0 0-8.5z'/%3E%3Cpath d='M55 45l3 7 7 3-7 3-3 7-3-7-7-3 7-3z'/%3E%3Ccircle cx='60' cy='95' r='4'/%3E%3Cpath d='M64 95v-10h6'/%3E%3Cpath d='M10 100h15v10h-15z'/%3E%3C/g%3E%3C/svg%3E")`),
                  backgroundColor: activeWallpaperPreset?.id !== "default" && activeWallpaperPreset?.backgroundColor !== "transparent" ? activeWallpaperPreset?.backgroundColor : undefined,
                  backgroundRepeat: activeWallpaperPreset?.id !== "default" ? (activeWallpaperPreset?.backgroundRepeat || (activeWallpaperPreset?.imageUrl ? "no-repeat" : "repeat")) : "repeat",
                  backgroundSize: activeWallpaperPreset?.id !== "default" ? (activeWallpaperPreset?.backgroundSize || (activeWallpaperPreset?.imageUrl ? "cover" : undefined)) : "120px 120px",
                  backgroundPosition: activeWallpaperPreset?.backgroundPosition || "center",
                  filter: wallpaperBlur ? "blur(3px)" : "none",
                }}
              />

              {/* Scrollable Messages Panel */}
              <div 
                ref={chatScrollContainerRef}
                onScroll={handleScroll}
                onTouchStart={() => {
                  userInteractingRef.current = true;
                  chatAnchorLockUntilRef.current = 0;
                  if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
                }}
                onTouchEnd={() => {
                  if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
                  interactionTimerRef.current = setTimeout(() => {
                    userInteractingRef.current = false;
                  }, 400);
                }}
                onWheel={() => {
                  userInteractingRef.current = true;
                  chatAnchorLockUntilRef.current = 0;
                  if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
                  interactionTimerRef.current = setTimeout(() => {
                    userInteractingRef.current = false;
                  }, 400);
                }}
                style={{ 
                  overflowAnchor: "none",
                }}
                className="relative z-10 flex-1 overflow-y-auto min-h-0 px-3.5 pt-2 pb-4 flex flex-col bg-transparent w-full max-w-full overflow-x-hidden overscroll-y-contain transition-colors duration-300"
              >
              <div ref={messagesContentRef} className="w-full flex flex-col mt-auto">
              <LoadingTransition isLoading={loadingMessages && messages.length === 0} type="chat-messages" count={4}>
                {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto select-none my-auto">
                  {/* Refined Minimal Illustration */}
                  <div className="relative mb-4 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-theme-surface to-theme-card border border-theme-border/70 flex items-center justify-center shadow-sm relative">
                      <MessageSquare size={26} className="text-[#D4AF37]" strokeWidth={1.8} />
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#141417] border border-[#D4AF37]/40 flex items-center justify-center text-[10px] text-[#D4AF37]">
                        ✨
                      </div>
                    </div>
                  </div>

                  <h3 className="text-[15px] font-semibold text-theme-text font-display">
                    Start a conversation with {otherUserProfile?.fullName?.split(" ")[0] || "your partner"}
                  </h3>
                  <p className="text-xs text-theme-secondary mt-1 leading-relaxed max-w-[260px]">
                    Break the ice and collaborate on skill exchange sessions.
                  </p>

                  {/* Suggested Starter Messages */}
                  <div className="w-full flex flex-col gap-2 mt-5">
                    {[
                      "Hi! I'm interested in your skill",
                      "When would you like to start?",
                      "Tell me more about what you want to learn"
                    ].map((starterText) => (
                      <button
                        key={starterText}
                        type="button"
                        onClick={() => {
                          setTypedMessage(starterText);
                          if (textareaRef.current) {
                            textareaRef.current.focus();
                          }
                        }}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-theme-surface hover:bg-theme-border/40 border border-theme-border/70 hover:border-[#D4AF37]/50 text-xs text-theme-text hover:text-[#D4AF37] text-left transition-all duration-150 flex items-center justify-between group cursor-pointer shadow-2xs"
                      >
                        <span className="truncate">{starterText}</span>
                        <Send size={11} className="opacity-0 group-hover:opacity-100 text-[#D4AF37] transition-opacity shrink-0 ml-2" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : chatMessagesFiltered.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-theme-secondary">
                  <Lock className="w-8 h-8 text-theme-border mb-2" />
                  <p className="text-xs font-semibold">End-to-End Secure Conversation</p>
                  <p className="text-[10px] text-theme-secondary/70 mt-1 max-w-xs">All exchanges are cryptographically restricted to peer participants. No other users can query this feed.</p>
                </div>
              ) : (
                <>
                  {hasOlderMessages && (
                    <div className="flex justify-center py-2">
                      <button
                        type="button"
                        onClick={() => setMessageWindowLimit((prev) => prev + 60)}
                        className="px-3.5 py-1.5 rounded-full text-[11px] font-medium bg-[#FAF8F4]/90 dark:bg-[#191920]/90 text-[#71717A] dark:text-[#A1A1AA] border border-[#E8E4DB] dark:border-white/10 hover:text-[#0D0D0F] dark:hover:text-white transition shadow-2xs cursor-pointer"
                      >
                        Load earlier messages
                      </button>
                    </div>
                  )}
                  {chatMessagesFiltered.map((m, index) => {
                  const isSelf = m.senderId === currentUserId;
                  const isDeleted = isMessageDeleted(m);
                  const isSelected = selectedMsgIds.has(m.id);
                  const isSwiping = swipingMsgId === m.id;
                  const isHighlighted = highlightedMsgId === m.id;
                  const showReactionsPalette = selectedMsgId === m.id;

                  const stableKey = m.clientMsgId || m.id;
                  const msgTimeMs = getMessageTimeMs(m);
                  const prevMsg = index > 0 ? chatMessagesFiltered[index - 1] : null;
                  const prevTimeMs = prevMsg ? getMessageTimeMs(prevMsg) : 0;
                  const dateLabel = formatChatDateDivider(msgTimeMs);
                  const prevDateLabel = prevMsg ? formatChatDateDivider(prevTimeMs) : "";
                  const showDateDivider = Boolean(dateLabel && dateLabel !== prevDateLabel);

                  const isSameSender = !showDateDivider && prevMsg ? prevMsg.senderId === m.senderId : false;
                  const marginClass = showDateDivider ? "mt-1" : isSameSender ? "mt-[2px]" : "mt-2.5";

                  const isNewlyArrived = !seenRenderedMsgKeysRef.current.has(stableKey) && (
                    Boolean(m._optimisticPending) || msgTimeMs >= chatOpenedAtRef.current - 5000
                  );

                  return (
                    <React.Fragment key={stableKey}>
                      {showDateDivider && (
                        <div className="flex justify-center my-2.5 select-none pointer-events-none">
                          <span className="px-3 py-0.5 rounded-full text-[11px] font-medium tracking-tight bg-[#FAF8F4]/90 dark:bg-[#18181D]/90 text-[#6B6B73] dark:text-[#A1A1AA] border border-[#E8E4DB]/80 dark:border-white/[0.07] shadow-2xs backdrop-blur-sm">
                            {dateLabel}
                          </span>
                        </div>
                      )}
                    <div 
                      onClick={() => {
                        if (selectedMsgIds.size > 0) {
                          handleToggleSelect(m.id);
                        }
                      }}
                      className={`flex items-center w-full min-w-0 transition-colors ${
                        isNewlyArrived ? "animate-slide-up" : ""
                      } ${
                        isSelected ? "bg-[#D4AF37]/10 px-1 py-1 rounded-lg" : ""
                      } ${isSelf ? "justify-end" : "justify-start"} ${marginClass}`}
                    >
                      {/* Selection Checkbox (WhatsApp style) */}
                      {selectedMsgIds.size > 0 && (
                        <div 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelect(m.id);
                          }}
                          className={`shrink-0 cursor-pointer p-1.5 transition-transform ${isSelf ? "order-last ml-2" : "order-first mr-2"}`}
                        >
                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                            isSelected 
                              ? "bg-[#D4AF37] border-[#D4AF37] text-black shadow-xs scale-105" 
                              : "border-zinc-500 hover:border-zinc-400 bg-transparent"
                          }`}>
                            <Check size={12} strokeWidth={3} className={isSelected ? "opacity-100" : "opacity-0"} />
                          </div>
                        </div>
                      )}

                      {/* Message Bubble Container with Swipe gesture */}
                      <div className={`flex flex-col relative max-w-[85%] sm:max-w-[75%] min-w-0 ${isSelf ? "items-end" : "items-start"}`}>
                        
                        {/* Swipe-to-reply Animated Visual Indicator */}
                        {isSwiping && swipeOffset > 0 && (
                          <div 
                            className="absolute -left-9 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-10"
                            style={{
                              opacity: Math.min(1, swipeOffset / 25),
                              transform: `translateY(-50%) scale(${Math.min(1, swipeOffset / 32)})`,
                            }}
                          >
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-colors ${
                              swipeOffset >= 36 ? "bg-[#D4AF37] text-black" : "bg-theme-surface text-theme-secondary border border-theme-border"
                            }`}>
                              <Reply size={13} />
                            </div>
                          </div>
                        )}

                        <div className={`group relative flex items-center gap-1.5 max-w-full min-w-0 ${isSelf ? "justify-end" : "justify-start"}`}>
                          
                          {/* Desktop/Web Hover Action Triggers (Self) */}
                          {isSelf && !isDeleted && selectedMsgIds.size === 0 && (
                            <div className="hidden md:flex opacity-0 group-hover:opacity-100 items-center gap-1 transition select-none mr-1 shrink-0">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartReply(m);
                                }}
                                className="p-1 hover:bg-theme-surface rounded-lg text-theme-secondary hover:text-theme-text transition cursor-pointer"
                                title="Reply"
                              >
                                <Reply size={12} />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedMsgId(showReactionsPalette ? null : m.id);
                                }}
                                className="p-1 hover:bg-theme-surface rounded-lg text-theme-secondary hover:text-theme-text transition cursor-pointer"
                                title="Actions"
                              >
                                <ChevronDown size={13} />
                              </button>
                            </div>
                          )}

                          {/* The Bubble */}
                          <div 
                            id={`msg-bubble-${m.id}`}
                            onContextMenu={(e) => handleBubbleContextMenu(e, m)}
                            onTouchStart={(e) => handleBubbleTouchStart(e, m)}
                            onTouchMove={(e) => handleBubbleTouchMove(e, m)}
                            onTouchEnd={() => handleBubbleTouchEnd(m)}
                            onDoubleClick={(e) => {
                              if (isDeleted) return;
                              e.stopPropagation();
                              handleReactToMessage(m.id, "❤️", { x: e.clientX, y: e.clientY });
                            }}
                            style={{
                              transform: isSwiping ? `translateX(${swipeOffset}px)` : "translateX(0px)",
                              transition: isSwiping && isHorizontalSwipeRef.current ? "none" : "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)"
                            }}
                            className={`px-[12px] py-[7px] relative break-words leading-[1.38] text-[14px] font-normal min-w-0 max-w-full [overflow-wrap:anywhere] select-none [-webkit-touch-callout:none] [-webkit-user-select:none] [user-select:none] ${
                              isHighlighted ? "ring-2 ring-[#C9A96E] ring-offset-2 ring-offset-transparent" : ""
                            } ${
                              isDeleted
                                ? "bg-[#FAF8F4]/80 dark:bg-[#18181D]/80 text-[#71717A] dark:text-[#A1A1AA] border border-black/5 dark:border-white/10 italic rounded-[16px]"
                                : isSelf 
                                  ? "bg-[#141418]/95 text-[#F7F4EE] border border-[#C9A96E]/25 shadow-[0_2px_8px_rgba(13,13,15,0.16)] dark:bg-[#241F17]/95 dark:text-[#FAF6EE] dark:border-[#C9A96E]/35 " + (isSameSender ? "rounded-[16px]" : "rounded-[16px] rounded-tr-[4px]") 
                                  : "bg-[#FAF8F4]/95 text-[#0D0D0F] border border-[#E8E4DB]/90 shadow-[0_1px_4px_rgba(13,13,15,0.08)] dark:bg-[#191920]/95 dark:text-[#F7F4EE] dark:border-white/[0.08] " + (isSameSender ? "rounded-[16px]" : "rounded-[16px] rounded-tl-[4px]")
                            } ${!isDeleted && m.reactions && Object.keys(m.reactions).length > 0 ? "mb-3.5" : ""}`}
                          >
                            
                            {/* Forwarded Tag */}
                            {m.isForwarded && !isDeleted && (
                              <div className={`flex items-center gap-1 text-[10.5px] italic mb-1 select-none ${
                                isSelf ? "text-[#F7F4EE]/60" : "text-[#71717A] dark:text-[#A1A1AA]"
                              }`}>
                                <Forward size={11} className="shrink-0" />
                                <span>Forwarded</span>
                              </div>
                            )}

                            {/* Quoted Reply Anchor */}
                            {m.replyToId && !isDeleted && (
                              <div 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleScrollToMessage(m.replyToId!);
                                }}
                                className={`mb-1.5 -mx-1 px-2.5 py-1.5 rounded-lg border-l-[3px] border-[#C9A96E] cursor-pointer transition select-none flex flex-col gap-0.5 text-left min-w-0 max-w-full overflow-hidden ${
                                  isSelf 
                                    ? "bg-white/[0.08] hover:bg-white/[0.12] text-[#F7F4EE]" 
                                    : "bg-[#F2EFE8]/90 dark:bg-white/[0.06] hover:bg-[#EAE5DA] dark:hover:bg-white/10 text-[#0D0D0F] dark:text-[#F7F4EE]"
                                }`}
                              >
                                <div className="flex items-center gap-1 text-[10.5px] font-semibold text-[#D4AF37] min-w-0">
                                  <Reply size={10} className="shrink-0" />
                                  <span className="truncate">{m.replyToSenderName || (m.senderId === currentUserId ? "You" : (otherUserProfile?.fullName || "Contact"))}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] opacity-80 truncate font-normal min-w-0">
                                  {m.replyToMedia === "image" && <ImageIcon size={11} className="shrink-0 text-theme-accent" />}
                                  {m.replyToMedia === "audio" && <Mic size={11} className="shrink-0 text-theme-accent" />}
                                  {m.replyToMedia === "file" && <FileText size={11} className="shrink-0 text-theme-accent" />}
                                  <span className="truncate">{m.replyToText || "Message"}</span>
                                </div>
                              </div>
                            )}

                            {/* DELETED MESSAGE STATE */}
                            {isDeleted ? (
                              <div className="flex items-center gap-2 py-0.5 text-[13px] text-theme-secondary/80 select-none">
                                <Ban size={14} className="shrink-0 opacity-60 text-theme-secondary" />
                                <span>{isSelf ? "You deleted this message" : "This message was deleted"}</span>
                              </div>
                            ) : m.type === "call_log" || m.callData || (m.text && (m.text.startsWith("📞") || m.text.startsWith("Voice call") || m.text.startsWith("Video call") || m.text.startsWith("Missed") || m.text === "Call declined" || m.text === "Unable to connect")) ? (
                              /* Real IMO / WhatsApp Style Call Log Bubble */
                              (() => {
                                const isVideo = m.callData?.callType === "video" || (m.text ? m.text.toLowerCase().includes("video") : false);
                                const isMissed = m.callData?.status === "missed" || (m.text ? m.text.toLowerCase().includes("missed") : false);
                                const isDeclined = m.callData?.status === "declined" || (m.text ? m.text.toLowerCase().includes("declined") : false);
                                let durationStr = "";
                                if (m.callData?.durationSeconds && m.callData.durationSeconds > 0) {
                                  const mins = Math.floor(m.callData.durationSeconds / 60);
                                  const secs = Math.floor(m.callData.durationSeconds % 60);
                                  durationStr = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
                                } else if (m.text && m.text.includes("·")) {
                                  durationStr = m.text.split("·")[1]?.trim() || "";
                                }

                                return (
                                  <div className="flex items-center gap-3 py-1 px-0.5 min-w-[200px] xs:min-w-[230px]">
                                    <div className={`w-9.5 h-9.5 rounded-full flex items-center justify-center shrink-0 ${
                                      isMissed || isDeclined
                                        ? (isSelf ? "bg-rose-500/20 text-rose-400" : "bg-rose-500/12 text-rose-600 dark:text-rose-400")
                                        : (isSelf ? "bg-[#C9A96E]/20 text-[#C9A96E]" : "bg-[#C9A96E]/18 text-[#9A783A] dark:text-[#C9A96E]")
                                    }`}>
                                      {isVideo ? (
                                        <Video size={17} />
                                      ) : isMissed ? (
                                        <PhoneMissed size={17} />
                                      ) : isSelf ? (
                                        <PhoneOutgoing size={17} />
                                      ) : (
                                        <PhoneIncoming size={17} />
                                      )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                      <div className="text-[13.5px] font-semibold text-inherit leading-tight truncate">
                                        {isVideo ? "Video call" : "Voice call"}
                                      </div>
                                      <div className="text-[11px] opacity-75 mt-0.5 flex items-center gap-1.5 leading-none">
                                        {isMissed ? (
                                          <span className="text-rose-400 font-medium opacity-100">Missed</span>
                                        ) : isDeclined ? (
                                          <span className="text-rose-400 font-medium opacity-100">Declined</span>
                                        ) : durationStr ? (
                                          <span>{durationStr}</span>
                                        ) : (
                                          <span>Ended</span>
                                        )}
                                      </div>
                                    </div>

                                    {(otherUserProfile || otherUserId || activeChat?.otherUserId) && onStartCall && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (isVideo) {
                                            handleInitiateVideoCall();
                                          } else {
                                            handleInitiateVoiceCall();
                                          }
                                        }}
                                        className={`p-1.5 rounded-full active:scale-95 transition shrink-0 cursor-pointer ${
                                          isSelf
                                            ? "text-[#C9A96E] hover:bg-white/10"
                                            : "text-[#9A783A] dark:text-[#C9A96E] hover:bg-black/5 dark:hover:bg-white/10"
                                        }`}
                                        title="Call back"
                                        aria-label="Call back"
                                      >
                                        {isVideo ? <Video size={16} /> : <Phone size={16} />}
                                      </button>
                                    )}
                                  </div>
                                );
                              })()
                            ) : (
                              <>
                                {/* Photo / Video Attachment (Ephemeral Instagram View Once / Allow Replay OR Keep in Chat) */}
                                {(m.imageUrl || m.videoUrl) && (
                                  isEphemeralMediaMessage(m) ? (
                                    (() => {
                                      const isSender = m.senderId === currentUserId;
                                      const mode = getEffectiveViewMode(m);
                                      const maxViews = mode === "allow_replay" ? 2 : 1;
                                      const isVideoItem = Boolean(m.videoUrl || m.mediaType === "video");
                                      const mediaLabel = isVideoItem ? "Video" : "Photo";
                                      const otherParticipantId =
                                        activeChat?.participantIds?.find((id) => id !== currentUserId) || "";

                                      const recipientViews = otherParticipantId
                                        ? getEphemeralViewsForUser(m, otherParticipantId)
                                        : m.openedBy?.some((id) => id !== currentUserId)
                                        ? 1
                                        : 0;
                                      const myViews = getEphemeralViewsForUser(m, currentUserId);
                                      const viewsCount = isSender ? recipientViews : myViews;

                                      const isExpired = viewsCount >= maxViews;
                                      const canReplay = !isSender && mode === "allow_replay" && myViews === 1;

                                      return (
                                        <div
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenViewOnce(m);
                                          }}
                                          className={`flex items-center gap-2.5 sm:gap-3 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-2xl cursor-pointer select-none transition-all my-1 max-w-[255px] shadow-sm active:scale-[0.98] ${
                                            isExpired
                                              ? isSender
                                                ? "bg-white/5 border border-white/10 text-white/55"
                                                : "bg-zinc-800/40 border border-zinc-700/40 text-zinc-400"
                                              : canReplay
                                              ? "bg-gradient-to-r from-[#1A1610] to-[#261E11] border border-amber-400/50 hover:border-amber-400 text-white shadow-amber-500/10"
                                              : isSender
                                              ? "bg-[#141417] text-white dark:bg-[#F2EFE8] dark:text-[#141417] border border-[#C9A96E]/40 hover:border-[#C9A96E]"
                                              : "bg-gradient-to-r from-zinc-900 to-zinc-800 border border-[#0095F6]/50 hover:border-[#0095F6] text-white shadow-[#0095F6]/15"
                                          }`}
                                          title={
                                            isExpired
                                              ? `Opened ${mediaLabel.toLowerCase()}`
                                              : canReplay
                                              ? `Tap to replay ${mediaLabel.toLowerCase()}`
                                              : mode === "allow_replay"
                                              ? `Replayable ${mediaLabel.toLowerCase()}`
                                              : `View once ${mediaLabel.toLowerCase()}`
                                          }
                                        >
                                          {/* Left Badge Icon */}
                                          <div className="shrink-0">
                                            {isExpired ? (
                                              <div className="w-7 h-7 rounded-full border border-dashed border-current flex items-center justify-center opacity-55">
                                                <div className="w-1.5 h-1.5 rounded-full bg-current" />
                                              </div>
                                            ) : canReplay ? (
                                              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-amber-400/20 text-amber-400 border border-amber-400/70 flex items-center justify-center">
                                                <RotateCcw size={14} />
                                              </div>
                                            ) : mode === "allow_replay" ? (
                                              <div
                                                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center ${
                                                  isSender
                                                    ? "bg-[#C9A96E]/20 text-[#C9A96E] border border-[#C9A96E]/60"
                                                    : "bg-[#0095F6]/20 text-[#0095F6] border-2 border-[#0095F6] animate-pulse"
                                                }`}
                                              >
                                                <RotateCcw size={14} />
                                              </div>
                                            ) : (
                                              <div
                                                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-xs ${
                                                  isSender
                                                    ? "bg-[#C9A96E]/20 text-[#C9A96E] border border-dashed border-[#C9A96E]"
                                                    : "bg-[#0095F6]/20 text-[#0095F6] border-2 border-dashed border-[#0095F6] animate-pulse"
                                                }`}
                                              >
                                                1
                                              </div>
                                            )}
                                          </div>

                                          {/* Label + State */}
                                          <div className="min-w-0 flex-1">
                                            <div
                                              className={`font-bold text-[13px] leading-tight flex items-center gap-1.5 ${
                                                isExpired ? "italic opacity-70" : ""
                                              }`}
                                            >
                                              {isVideoItem && !isExpired && (
                                                <Video size={13} className="shrink-0 opacity-90" />
                                              )}
                                              <span>
                                                {isExpired
                                                  ? "Opened"
                                                  : canReplay
                                                  ? "Tap to replay"
                                                  : mediaLabel}
                                              </span>
                                              {!isExpired && !isSender && !canReplay && (
                                                <span className="w-1.5 h-1.5 rounded-full bg-[#0095F6] animate-ping" />
                                              )}
                                            </div>
                                            <div
                                              className={`text-[10px] mt-0.5 font-medium leading-tight ${
                                                isExpired ? "opacity-50" : "opacity-75"
                                              }`}
                                            >
                                              {isSender
                                                ? isExpired
                                                  ? `Viewed · ${mediaLabel}`
                                                  : mode === "allow_replay" && recipientViews === 1
                                                  ? "Opened · 1 replay left"
                                                  : mode === "allow_replay"
                                                  ? "Delivered · Allow replay"
                                                  : "Delivered · View once"
                                                : isExpired
                                                ? `${mediaLabel} expired`
                                                : canReplay
                                                ? `${mediaLabel} · Final replay`
                                                : mode === "allow_replay"
                                                ? "Tap to view · Allow replay"
                                                : "Tap to view · 1 view"}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })()
                                  ) : m.videoUrl ? (
                                    <div
                                      className="relative max-w-[235px] max-h-[260px] rounded-xl overflow-hidden mb-1.5 cursor-pointer border border-white/10 shadow-sm bg-black group transition hover:scale-[1.01]"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setFullscreenVideo(m.videoUrl || null);
                                      }}
                                    >
                                      <video
                                        src={m.videoUrl}
                                        muted
                                        playsInline
                                        preload="metadata"
                                        className="w-full h-full max-h-[240px] object-cover pointer-events-none"
                                      />
                                      <div className="absolute inset-0 bg-black/25 group-hover:bg-black/35 transition flex items-center justify-center">
                                        <div className="w-11 h-11 rounded-full bg-black/65 backdrop-blur-sm border border-white/25 flex items-center justify-center text-white shadow-lg">
                                          <Play size={18} className="fill-white ml-0.5" />
                                        </div>
                                      </div>
                                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-semibold text-white flex items-center gap-1">
                                        <Video size={10} />
                                        <span>Video</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div 
                                      className="max-w-[220px] max-h-[220px] rounded-xl overflow-hidden mb-1.5 cursor-pointer border border-white/5 shadow-sm transition hover:scale-[1.01]" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setFullscreenImage(m.imageUrl || null);
                                      }}
                                    >
                                      <SmartImage src={m.imageUrl} alt="attachment" className="w-full h-full object-cover" fallbackType="cover" sizeType="standard" />
                                    </div>
                                  )
                                )}

                                {/* Audio Voice Note */}
                                {m.audioUrl && (
                                  <AudioWaveformPlayer src={m.audioUrl} isSelf={isSelf} />
                                )}

                                {/* File Document Attachment */}
                                {m.fileUrl && (
                                  <div className={`flex items-center gap-2.5 p-2.5 rounded-xl border mt-1 w-full min-w-0 max-w-[280px] sm:max-w-xs ${
                                    isSelf 
                                      ? "bg-black/[0.06] dark:bg-black/20 border-black/[0.08] dark:border-white/10 text-inherit" 
                                      : "bg-black/[0.04] dark:bg-white/[0.06] border-black/[0.07] dark:border-white/10 text-inherit"
                                  }`}>
                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                                      isSelf ? "bg-[#C9A96E]/20 text-[#C9A96E]" : "bg-[#C9A96E]/15 text-[#9A783A] dark:text-[#C9A96E]"
                                    }`}>
                                      <FileText size={18} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[12.5px] font-semibold truncate leading-tight">{m.fileName || "attachment"}</p>
                                      <p className="text-[10.5px] opacity-70 font-mono mt-0.5">
                                        {m.fileSize 
                                          ? (m.fileSize < 1024 * 1024 ? `${(m.fileSize / 1024).toFixed(1)} KB` : `${(m.fileSize / (1024 * 1024)).toFixed(1)} MB`) 
                                          : "Document"}
                                      </p>
                                    </div>
                                    <a 
                                      href={sanitizeUrl(m.fileUrl)} 
                                      download={m.fileName || "document"} 
                                      target="_blank" 
                                      rel="noopener noreferrer" 
                                      onClick={(e) => e.stopPropagation()}
                                      className={`p-2 rounded-full transition shrink-0 cursor-pointer ${
                                        isSelf
                                          ? "hover:bg-white/10 text-[#F7F4EE]/75 hover:text-[#C9A96E]"
                                          : "hover:bg-black/5 dark:hover:bg-white/10 text-[#71717A] dark:text-[#A1A1AA]"
                                      }`}
                                      title="Download document"
                                    >
                                      <Download size={15} />
                                    </a>
                                  </div>
                                )}

                                {/* Message text with WhatsApp-style Markdown formatting (*bold*, _italic_, ~strike~, `code`) and @mentions */}
                                {m.text && (
                                  <p className="font-normal whitespace-pre-wrap text-[14.5px] leading-[1.38] break-words [overflow-wrap:anywhere] min-w-0 max-w-full select-none [-webkit-touch-callout:none] [-webkit-user-select:none] [user-select:none]">{formatChatText(m.text, (username) => onSelectUser?.(username))}</p>
                                )}

                                {/* Rich Link Preview Card */}
                                {!m.deleted && !m.isDeleted && m.text && (() => {
                                  const previewUrl = extractFirstUrl(m.text);
                                  if (!previewUrl) return null;
                                  return <LinkPreviewCard url={previewUrl} isSelf={isSelf} />;
                                })()}
                              </>
                            )}

                            {/* Message Footer stats indicator */}
                            <div className={`flex items-center justify-end gap-1 mt-0.5 text-[10.5px] select-none font-sans font-normal tracking-tight ${
                              isSelf ? "text-[#F7F4EE]/60" : "text-[#71717A] dark:text-[#A1A1AA]"
                            }`}>
                              {m.starredBy?.includes(currentUserId) && (
                                <Star size={10} className="text-[#C9A96E] fill-[#C9A96E] shrink-0" />
                              )}
                              {m.isEdited && !isDeleted && (
                                <span className="text-[9px] uppercase tracking-wider font-medium opacity-75 mr-0.5">Edited</span>
                              )}
                              <span>{formatMsgTime(m.createdAt || m.timestamp || m.clientTimestamp)}</span>
                              {isSelf && (
                                <span className="flex items-center shrink-0 ml-0.5">
                                  {(m._optimisticPending || m.id.startsWith("optimistic_")) ? (
                                    (m as any).sendError ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSendMessage({ text: m.text, imageUrl: m.imageUrl, audioUrl: m.audioUrl, fileUrl: m.fileUrl, fileName: m.fileName, fileSize: m.fileSize });
                                        }}
                                        className="text-red-400 text-[9px] hover:underline flex items-center gap-0.5 cursor-pointer font-bold"
                                        title="Sending failed. Tap to retry."
                                      >
                                        Retry ⚠️
                                      </button>
                                    ) : confirmedLocalSentIdsRef.current.has(m.clientMsgId || m.id) ? (
                                      <Check size={13} className="text-[#F7F4EE]/55" title="Sent" />
                                    ) : (
                                      <Clock size={10.5} className="text-[#F7F4EE]/55" title="Sending..." />
                                    )
                                  ) : (m.isRead || m.status === "seen") ? (
                                    <CheckCheck size={13} className="text-[#C9A96E]" title="Read" />
                                  ) : m.status === "delivered" ? (
                                    <CheckCheck size={13} className="text-[#F7F4EE]/55" title="Delivered" />
                                  ) : (
                                    <Check size={13} className="text-[#F7F4EE]/55" title="Sent" />
                                  )}
                                </span>
                              )}
                            </div>

                            {/* Active Message Reactions tags (Apple & Telegram Luxury Style) */}
                            {!isDeleted && m.reactions && Object.keys(m.reactions).length > 0 && (() => {
                              const grouped = {} as Record<string, { count: number; users: string[] }>;
                              (Object.entries(m.reactions) as [string, string][]).forEach(([userId, emoji]) => {
                                // Strictly validate that it's a genuine emoji and filter out corrupt initials like "ZA"
                                if (!emoji || typeof emoji !== "string") return;
                                const trimmed = emoji.trim();
                                if (/^[a-zA-Z0-9_\s]+$/.test(trimmed)) return;

                                if (!grouped[trimmed]) {
                                  grouped[trimmed] = { count: 0, users: [] };
                                }
                                grouped[trimmed].count += 1;
                                grouped[trimmed].users.push(userId);
                              });

                              if (Object.keys(grouped).length === 0) return null;

                              return (
                                <div className={`absolute -bottom-3 ${isSelf ? "right-2" : "left-2"} flex flex-wrap gap-1 z-20 pointer-events-auto`}>
                                  {Object.entries(grouped).map(([emoji, data]) => {
                                    const hasReacted = m.reactions?.[currentUserId] === emoji;
                                    const isPopupOpen = activeReactionInfo?.msgId === m.id && activeReactionInfo?.emoji === emoji;
                                    return (
                                      <div key={emoji} className="relative select-none">
                                        <motion.button
                                          initial={{ scale: 0, opacity: 0 }}
                                          animate={{ scale: 1, opacity: 1 }}
                                          exit={{ scale: 0, opacity: 0 }}
                                          transition={{ type: "spring", stiffness: 460, damping: 20 }}
                                          whileHover={{ scale: 1.12, y: -1 }}
                                          whileTap={{ scale: 0.9 }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (isPopupOpen) {
                                              setActiveReactionInfo(null);
                                            } else {
                                              triggerBurst(emoji, { x: e.clientX, y: e.clientY }, m.id);
                                              setActiveReactionInfo({ msgId: m.id, emoji });
                                            }
                                          }}
                                          className={`h-[25px] px-2.5 rounded-full flex items-center gap-1.5 transition-all duration-150 border cursor-pointer select-none shadow-sm ${
                                            hasReacted 
                                              ? "bg-[#D4AF37]/25 border-[#D4AF37]/70 text-white ring-1 ring-[#D4AF37]/40 shadow-[0_2px_8px_rgba(212,175,55,0.25)]" 
                                              : "bg-[#181920]/95 hover:bg-[#23242E] border-white/15 text-white/95 shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
                                          }`}
                                          title={`Reacted with ${emoji}`}
                                        >
                                          <motion.span
                                            key={`${emoji}-${data.count}`}
                                            initial={{ scale: 1.3 }}
                                            animate={{ scale: 1 }}
                                            transition={{ type: "spring", stiffness: 500, damping: 18 }}
                                            className="native-emoji text-[15px] leading-none inline-block"
                                          >
                                            {emoji}
                                          </motion.span>
                                          {data.count > 1 && (
                                            <span className="font-semibold font-mono text-[10px] text-zinc-300">
                                              {data.count}
                                            </span>
                                          )}
                                        </motion.button>

                                        {/* Telegram & Apple Glassmorphism Reaction Sheet Card */}
                                        <AnimatePresence>
                                          {isPopupOpen && (
                                            <>
                                              <div 
                                                className="fixed inset-0 z-40 bg-transparent" 
                                                onClick={(ev) => {
                                                  ev.stopPropagation();
                                                  setActiveReactionInfo(null);
                                                }} 
                                              />
                                              <motion.div
                                                initial={{ opacity: 0, scale: 0.92, y: 6 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.92, y: 6 }}
                                                transition={{ type: "spring", stiffness: 440, damping: 24 }}
                                                className={`absolute bottom-full mb-2 ${isSelf ? "right-0 origin-bottom-right" : "left-0 origin-bottom-left"} z-50 bg-[#161720]/98 backdrop-blur-2xl border border-white/15 rounded-2xl p-3 shadow-[0_18px_50px_rgba(0,0,0,0.85)] min-w-[200px] max-w-[250px] text-left select-none text-white`}
                                                onClick={(ev) => ev.stopPropagation()}
                                              >
                                                {/* Header */}
                                                <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
                                                  <div className="flex items-center gap-1.5">
                                                    <span className="native-emoji text-xl leading-none">{emoji}</span>
                                                    <span className="text-[12px] font-semibold text-zinc-200">Reactions</span>
                                                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-white/10 text-zinc-400">
                                                      {data.count}
                                                    </span>
                                                  </div>
                                                  <button
                                                    type="button"
                                                    onClick={(ev) => {
                                                      ev.stopPropagation();
                                                      setActiveReactionInfo(null);
                                                    }}
                                                    className="w-5 h-5 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-xs"
                                                  >
                                                    ✕
                                                  </button>
                                                </div>

                                                {/* User list with avatars & name */}
                                                <div className="flex flex-col gap-1.5 max-h-[120px] overflow-y-auto scrollbar-none py-0.5">
                                                  {data.users.map((userId) => {
                                                    const isCurrentUser = userId === currentUserId;
                                                    const userName = isCurrentUser 
                                                      ? "You" 
                                                      : (otherUserProfile?.fullName || "Participant");
                                                    const photoUrl = isCurrentUser ? null : otherUserProfile?.photoUrl;

                                                    return (
                                                      <div key={userId} className="flex items-center justify-between py-1 px-1.5 rounded-xl hover:bg-white/5 transition-colors">
                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                          <div className="w-6 h-6 rounded-full overflow-hidden bg-gradient-to-tr from-[#D4AF37]/30 to-amber-500/20 border border-[#D4AF37]/40 flex items-center justify-center shrink-0 text-[10px] font-bold text-amber-200">
                                                            {photoUrl ? (
                                                              <img src={photoUrl} alt="" className="w-full h-full object-cover" />
                                                            ) : (
                                                              userName.slice(0, 1).toUpperCase()
                                                            )}
                                                          </div>
                                                          <div className="flex flex-col min-w-0">
                                                            <span className="text-[12px] font-medium text-zinc-100 truncate">
                                                              {userName}
                                                            </span>
                                                            {isCurrentUser && (
                                                              <span className="text-[9px] text-[#D4AF37] font-sans">Tap to remove</span>
                                                            )}
                                                          </div>
                                                        </div>
                                                        <span className="native-emoji text-sm shrink-0 ml-1.5">{emoji}</span>
                                                      </div>
                                                    );
                                                  })}
                                                </div>

                                                {/* Action Button: Remove Reaction or React */}
                                                <button
                                                  type="button"
                                                  onClick={(ev) => {
                                                    ev.stopPropagation();
                                                    handleReactToMessage(m.id, emoji, { x: ev.clientX, y: ev.clientY });
                                                    setActiveReactionInfo(null);
                                                  }}
                                                  className={`w-full mt-2 py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95 ${
                                                    hasReacted
                                                      ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/25"
                                                      : "bg-[#D4AF37]/20 hover:bg-[#D4AF37]/30 text-[#D4AF37] border border-[#D4AF37]/40"
                                                  }`}
                                                >
                                                  {hasReacted ? "Remove Reaction" : `React with ${emoji}`}
                                                </button>
                                              </motion.div>
                                            </>
                                          )}
                                        </AnimatePresence>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>

                          {/* Desktop/Web Hover Action Triggers (Recipient) */}
                          {!isSelf && !isDeleted && selectedMsgIds.size === 0 && (
                            <div className="hidden md:flex opacity-0 group-hover:opacity-100 items-center gap-1 transition select-none ml-1 shrink-0">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedMsgId(showReactionsPalette ? null : m.id);
                                }}
                                className="p-1 hover:bg-theme-surface rounded-lg text-theme-secondary hover:text-theme-text transition cursor-pointer"
                                title="Actions"
                              >
                                <ChevronDown size={13} />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartReply(m);
                                }}
                                className="p-1 hover:bg-theme-surface rounded-lg text-theme-secondary hover:text-theme-text transition cursor-pointer"
                                title="Reply"
                              >
                                <Reply size={12} />
                              </button>
                            </div>
                          )}

                        </div>
                      </div>
                    </div>
                    </React.Fragment>
                  );
                })
                }
                </>
              )}
              </LoadingTransition>

              {/* Inline Typing Indicator at message tail (inside feed so it never shifts wallpaper or resizes stage) */}
              <AnimatePresence>
                {otherUserTyping && (
                  <motion.div 
                    key="bottom-typing-indicator"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    className="pt-2 pb-1 flex items-center bg-transparent select-none"
                  >
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FAF8F4]/95 dark:bg-[#18181D]/95 backdrop-blur-md border border-[#C9A96E]/30 text-[#71717A] shadow-xs">
                      <div className="flex gap-1 items-center h-3 shrink-0">
                        <motion.span 
                          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: 0, ease: "easeInOut" }}
                          className="w-1.5 h-1.5 rounded-full bg-[#C9A96E]" 
                        />
                        <motion.span 
                          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: 0.15, ease: "easeInOut" }}
                          className="w-1.5 h-1.5 rounded-full bg-[#C9A96E]" 
                        />
                        <motion.span 
                          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: 0.3, ease: "easeInOut" }}
                          className="w-1.5 h-1.5 rounded-full bg-[#C9A96E]" 
                        />
                      </div>
                      <span className="text-[11px] font-medium text-[#9A783A] dark:text-[#C9A96E] lowercase italic tracking-tight">typing...</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={messagesEndRef} className="h-px w-full shrink-0 pointer-events-none opacity-0" aria-hidden="true" style={{ overflowAnchor: "none" }} />
              </div>
            </div>

            {/* In-app Reply banner preview (Floats cleanly over wallpaper above input pill) */}
            {replyToMessage && (
              <div className="relative z-20 flex-none h-10 min-h-[40px] max-h-[40px] mx-2 mb-1 px-3 rounded-2xl border border-[#C9A96E]/25 bg-[#FAF8F4]/95 dark:bg-[#18181D]/95 shadow-sm flex items-center justify-between gap-3 shrink-0 select-none overflow-hidden">
                <div className="flex items-center gap-1.5 text-xs min-w-0 flex-1 overflow-hidden">
                  <Reply size={13} className="text-[#B58E47] dark:text-[#C9A96E] shrink-0" />
                  <span className="text-[#B58E47] dark:text-[#C9A96E] shrink-0 font-semibold uppercase text-[9.5px] tracking-wide">Replying:</span>
                  <p className="truncate text-[#0D0D0F] dark:text-[#F7F4EE] font-normal text-[11.5px] min-w-0">"{replyToMessage.text || "[Attachment]"}"</p>
                </div>
                <button 
                  onClick={() => setReplyToMessage(null)}
                  className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-[#71717A] transition cursor-pointer shrink-0"
                  aria-label="Cancel reply"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* In-app Edits banner preview */}
            {editingMessage && (
              <div className="relative z-20 flex-none h-10 min-h-[40px] max-h-[40px] mx-2 mb-1 px-3 rounded-2xl border border-[#C9A96E]/25 bg-[#FAF8F4]/95 dark:bg-[#18181D]/95 shadow-sm flex items-center justify-between gap-3 shrink-0 select-none overflow-hidden">
                <div className="flex items-center gap-1.5 text-xs min-w-0 flex-1 overflow-hidden">
                  <Edit3 size={13} className="text-[#B58E47] dark:text-[#C9A96E] shrink-0" />
                  <span className="text-[#B58E47] dark:text-[#C9A96E] shrink-0 font-semibold uppercase text-[9.5px] tracking-wide">Editing:</span>
                  <p className="truncate text-[#0D0D0F] dark:text-[#F7F4EE] font-normal text-[11.5px] min-w-0">"{editingMessage.text}"</p>
                </div>
                <button 
                  onClick={() => {
                    setEditingMessage(null);
                    setTypedMessage("");
                    if (typingTimeoutRef.current) {
                      clearTimeout(typingTimeoutRef.current);
                      typingTimeoutRef.current = null;
                    }
                    if (isTypingRef.current) {
                      isTypingRef.current = false;
                      setIsTyping(false);
                      updateTypingStatus(false);
                    }
                    if (textareaRef.current) {
                      textareaRef.current.style.height = "auto";
                    }
                  }}
                  className="p-1 hover:bg-theme-bg rounded-lg text-theme-secondary transition cursor-pointer"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            {/* Media Upload Loading overlay bar */}
            {Object.keys(uploadProgress).map((key) => (
              <div key={key} className="relative z-20 flex-none mx-2 mb-1.5 px-4 py-2.5 rounded-2xl bg-[#FAF8F4]/95 dark:bg-[#18181D]/95 border border-[#C9A96E]/25 shadow-sm text-xs flex items-center justify-between gap-3 select-none">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin text-[#C9A96E]" />
                  </div>
                  <span className="font-semibold text-[#0D0D0F] dark:text-[#F7F4EE] tracking-tight">Uploading...</span>
                </div>
                <div className="w-24 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden relative">
                  <div className="absolute inset-0 bg-[#C9A96E] animate-pulse" />
                </div>
              </div>
            ))}

            {/* Live voice recording active mic ribbon */}
            {isRecording && (
              <div className="relative z-20 flex-none h-[54px] min-h-[54px] max-h-[54px] mx-2 mb-2 px-3 rounded-[26px] bg-white dark:bg-[#1F2C34] shadow-[0_1px_2px_rgba(11,20,26,0.14)] border border-black/[0.05] dark:border-white/10 flex items-center justify-between gap-3 select-none">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className={`w-2.5 h-2.5 bg-red-500 rounded-full shrink-0 ${isPaused ? "" : "animate-pulse"}`} />
                  <span className="text-xs font-semibold text-theme-text font-mono shrink-0">
                    {Math.floor(recordingDuration / 60)}:{( "0" + (recordingDuration % 60) ).slice(-2)}
                  </span>
                  
                  {/* Waveform Visualization */}
                  <div className="flex-1 flex items-center h-8 overflow-hidden">
                    {isPaused ? (
                      <span className="text-[11px] text-theme-secondary font-mono italic">Recording paused</span>
                    ) : (
                      <div className="flex items-end gap-[3px] h-6 px-1">
                        {voiceWaves.slice(-24).map((h, idx) => (
                          <motion.div
                            key={idx}
                            initial={{ height: "4px" }}
                            animate={{ height: `${h}%` }}
                            transition={{ type: "spring", stiffness: 300, damping: 15 }}
                            className="w-[3px] bg-red-500/80 rounded-full"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Cancel Button */}
                  <button 
                    onClick={cancelRecording}
                    className="p-1.5 hover:bg-red-500/10 text-red-500 rounded-xl transition cursor-pointer"
                    title="Cancel Recording"
                  >
                    <Trash2 size={16} />
                  </button>

                  {/* Pause/Resume Toggle */}
                  {isPaused ? (
                    <button 
                      onClick={resumeRecording}
                      className="p-1.5 hover:bg-theme-border text-theme-accent rounded-xl transition cursor-pointer"
                      title="Resume Recording"
                    >
                      <Play size={16} />
                    </button>
                  ) : (
                    <button 
                      onClick={pauseRecording}
                      className="p-1.5 hover:bg-theme-border text-theme-secondary hover:text-theme-text rounded-xl transition cursor-pointer"
                      title="Pause Recording"
                    >
                      <Pause size={16} />
                    </button>
                  )}

                  {/* Stop/Preview Button */}
                  <button 
                    onClick={stopRecordingAndPreview}
                    className="py-1.5 px-3 bg-theme-accent hover:opacity-95 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1 shadow-gold-glow"
                    title="Stop & Preview"
                  >
                    <CheckCircle size={14} />
                    <span className="hidden sm:inline">Done</span>
                  </button>
                </div>
              </div>
            )}

            {/* Draft voice preview player ribbon */}
            {previewAudioUrl && (
              <div className="relative z-20 flex-none h-[54px] min-h-[54px] max-h-[54px] mx-2 mb-2 px-3 rounded-[26px] bg-white dark:bg-[#1F2C34] shadow-[0_1px_2px_rgba(11,20,26,0.14)] border border-black/[0.05] dark:border-white/10 flex items-center justify-between gap-3 select-none">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  {/* Play/Pause Button */}
                  <button 
                    onClick={togglePlayDraft}
                    className="w-8 h-8 rounded-full bg-[#0D0D0F] dark:bg-[#C9A96E] flex items-center justify-center text-[#C9A96E] dark:text-[#0D0D0F] hover:opacity-95 transition shrink-0 cursor-pointer"
                  >
                    {draftIsPlaying ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
                  </button>

                  {/* Timer */}
                  <span className="text-[11px] font-mono text-theme-text shrink-0">
                    {Math.floor(draftCurrentTime / 60)}:{( "0" + Math.floor(draftCurrentTime % 60) ).slice(-2)}
                    {" / "}
                    {Math.floor(draftDuration / 60)}:{( "0" + Math.floor(draftDuration % 60) ).slice(-2)}
                  </span>

                  {/* Seek bar/visual progress slider */}
                  <div className="flex-1 h-1.5 bg-theme-border/60 rounded-full overflow-hidden relative">
                    <div 
                      className="h-full bg-[#C9A96E]" 
                      style={{ width: `${draftDuration ? (draftCurrentTime / draftDuration) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Discard Draft Button */}
                  <button 
                    onClick={discardDraftRecording}
                    className="p-1.5 hover:bg-red-500/10 text-red-500 rounded-xl transition cursor-pointer"
                    title="Discard Draft"
                  >
                    <Trash2 size={16} />
                  </button>

                  {/* Send Draft Button */}
                  <button 
                    onClick={sendDraftRecording}
                    disabled={isUploadingVoice}
                    className="py-1.5 px-3.5 bg-[#0D0D0F] dark:bg-[#C9A96E] hover:opacity-95 text-[#C9A96E] dark:text-[#0D0D0F] text-xs font-bold rounded-full transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
                  >
                    {isUploadingVoice ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <Send size={12} />
                        <span>Send</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Voice upload progress loader bar */}
            {isUploadingVoice && uploadProgress["voice_notes"] !== undefined && (
              <div className="relative z-20 flex-none mx-2 mb-2 px-4 py-2.5 rounded-2xl bg-[#FAF8F4]/95 dark:bg-[#18181D]/95 border border-[#C9A96E]/25 text-xs flex items-center justify-between gap-3 select-none shadow-sm">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-[#C9A96E]" />
                  <span className="font-semibold text-[#0D0D0F] dark:text-[#F7F4EE] tracking-tight">Uploading...</span>
                </div>
                <div className="w-24 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden relative">
                  <div className="absolute inset-0 bg-[#C9A96E] animate-pulse" />
                </div>
              </div>
            )}

            {/* INPUT CONTROLS FOOTER OR REQUEST DECISION BAR */}
            {!isRecording && !previewAudioUrl && !isUploadingVoice && (
              otherUserId && (blockedUsers.includes(otherUserId) || blockedByUsers.includes(otherUserId)) ? (
                <div className="relative z-20 flex-none h-[52px] mx-2 mb-2 rounded-2xl border border-red-500/20 bg-[#FAF8F4]/95 dark:bg-[#18181D]/95 flex items-center justify-center text-center text-[10px] font-bold text-red-500 select-none font-mono tracking-widest uppercase shadow-xs">
                  <Lock size={12} className="mr-1.5 text-red-500 shrink-0" />
                  Messaging is restricted due to active block state
                </div>
              ) : (effectiveChat?.requestStatus === "pending" || effectiveChat?.isRequest === true) && (effectiveChat?.requestedTo === currentUserId || (effectiveChat?.requestedBy && effectiveChat?.requestedBy !== currentUserId)) ? (
                /* INSTAGRAM-STYLE REQUEST DECISION FOOTER */
                <div className="relative z-20 flex-none p-4 mx-2 mb-2 rounded-2xl border border-[#C9A96E]/25 bg-[#FAF8F4]/95 dark:bg-[#18181D]/95 backdrop-blur-md shadow-lg select-none">
                  <div className="text-center mb-3">
                    <p className="text-xs font-bold text-theme-text">
                      Message Request from {otherUserProfile?.fullName || "this user"}
                    </p>
                    <p className="text-[11px] text-theme-secondary mt-0.5 max-w-sm mx-auto leading-normal">
                      Do you want to let {otherUserProfile?.fullName || "them"} send you messages? They won't know you've seen their message until you accept.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2.5 max-w-sm mx-auto">
                    {/* Block */}
                    <button
                      onClick={() => handleOpenBlockModal("block")}
                      className="flex-1 h-9 px-3 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95"
                    >
                      <Ban size={13} />
                      <span>Block</span>
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => effectiveChat?.id && handleDeleteRequest(effectiveChat.id)}
                      className="flex-1 h-9 px-3 rounded-xl border border-theme-border bg-theme-bg hover:bg-theme-border text-theme-secondary hover:text-theme-text text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95"
                    >
                      <Trash2 size={13} />
                      <span>Delete</span>
                    </button>
                    {/* Accept */}
                    <button
                      onClick={() => effectiveChat?.id && handleAcceptRequest(effectiveChat.id)}
                      className="flex-1 h-9 px-3 rounded-xl bg-[#0D0D0F] dark:bg-[#C9A96E] hover:opacity-95 text-[#C9A96E] dark:text-[#0D0D0F] text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95"
                    >
                      <Check size={14} />
                      <span>Accept</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div 
                  style={{
                    paddingBottom: isKeyboardOpen || showEmojiPicker ? "6px" : "max(env(safe-area-inset-bottom, 0px), 8px)"
                  }}
                  className="relative z-20 flex-none shrink-0 w-full min-h-[54px] pt-1.5 px-2 sm:px-3 bg-transparent flex items-end gap-1.5 sm:gap-2 select-none"
                >

                  {/* Luxury Floating Pill Input Bar (Wallpaper visible all around it) */}
                  <div className="flex-1 min-w-0 relative flex items-end min-h-[46px] bg-[#FAF8F4]/95 dark:bg-[#17171C]/95 backdrop-blur-md border border-[#C9A96E]/25 shadow-[0_2px_10px_rgba(13,13,15,0.14)] focus-within:border-[#C9A96E] rounded-[26px] px-2 py-1 transition-colors duration-150">
                    
                    {/* Real-time Mention Autocomplete Suggestions Popup */}
                    <AnimatePresence>
                      {showMentionSuggestions && mentionSuggestions.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: 6, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 6, scale: 0.98 }}
                          transition={{ duration: 0.15 }}
                          className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-50 bg-[#16161A]/95 dark:bg-[#16161A]/95 bg-white/95 backdrop-blur-xl border border-theme-border shadow-2xl rounded-2xl overflow-hidden max-h-56 flex flex-col"
                        >
                          <div className="px-3 py-1.5 border-b border-theme-border/60 flex items-center justify-between text-[11px] font-semibold text-theme-secondary uppercase tracking-wider bg-theme-bg/40">
                            <span>Tag Member</span>
                            <span className="text-[10px] lowercase opacity-75 font-normal">Tap or Enter</span>
                          </div>
                          <div className="overflow-y-auto divide-y divide-theme-border/25 scrollbar-none py-1">
                            {mentionSuggestions.map((user, idx) => {
                              const isSelected = idx === selectedMentionIndex;
                              const displayHandle = user.username || user.fullName?.replace(/\s+/g, "").toLowerCase() || "user";
                              return (
                                <button
                                  key={user.uid || idx}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleSelectMention(user);
                                  }}
                                  className={`w-full px-3 py-2 flex items-center gap-2.5 text-left transition-colors cursor-pointer ${
                                    isSelected ? "bg-[#D4AF37]/20 text-theme-text" : "hover:bg-theme-bg/60 text-theme-text"
                                  }`}
                                >
                                  <div className="relative w-8 h-8 rounded-full overflow-hidden shrink-0 border border-theme-border/50 bg-[#232328]">
                                    {user.avatarUrl || user.profilePhotoUrl || user.photoUrl ? (
                                      <SmartImage
                                        src={user.avatarUrl || user.profilePhotoUrl || user.photoUrl}
                                        alt={user.fullName || "User"}
                                        fallbackType="profile"
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center font-bold text-xs text-[#D4AF37]">
                                        {(user.fullName || user.username || "U").charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[13px] font-semibold truncate text-theme-text">
                                        {user.fullName || "Community Member"}
                                      </span>
                                      {user.isVerified && (
                                        <span className="text-[#3897f0] text-xs">●</span>
                                      )}
                                    </div>
                                    <div className="text-[12px] font-medium text-[#D4AF37] dark:text-[#E2C366] truncate">
                                      @{displayHandle}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* WhatsApp Emoji <-> System Keyboard Toggle */}
                    <div className="flex items-center pb-0.5 shrink-0">
                      <button 
                        type="button"
                        id="btn-chat-toggle-emoji"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          viewportTransitionUntilRef.current = Date.now() + 500;
                          if (showEmojiPicker) {
                            setShowEmojiPicker(false);
                            setTimeout(() => {
                              textareaRef.current?.focus();
                            }, 20);
                          } else {
                            if (textareaRef.current) {
                              emojiCursorPosRef.current = textareaRef.current.selectionStart ?? typedMessage.length;
                              textareaRef.current.blur();
                            }
                            setShowEmojiPicker(true);
                          }
                        }}
                        className="w-8 h-8 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#A1A1AA] transition-colors cursor-pointer flex items-center justify-center shrink-0"
                        title={showEmojiPicker ? "Show Keyboard" : "Emojis"}
                        aria-label={showEmojiPicker ? "Show Keyboard" : "Emojis"}
                      >
                        {showEmojiPicker ? <Keyboard size={20} /> : <Smile size={20} />}
                      </button>
                    </div>

                    {/* Auto-growing Textarea */}
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      placeholder={editingMessage ? "Edit message..." : "Message"}
                      value={typedMessage}
                      onChange={handleInputChange}
                      onPointerDown={() => {
                        if (showEmojiPicker) {
                          viewportTransitionUntilRef.current = Date.now() + 500;
                          setShowEmojiPicker(false);
                        }
                      }}
                      onFocus={() => {
                        if (showEmojiPicker) {
                          viewportTransitionUntilRef.current = Date.now() + 500;
                          setShowEmojiPicker(false);
                        }
                        if (window.scrollY !== 0) {
                          window.scrollTo(0, 0);
                        }
                        if (isNearBottomRef.current) {
                          viewportTransitionUntilRef.current = Date.now() + 500;
                          pinToBottomInstant();
                          requestAnimationFrame(() => {
                            if (isNearBottomRef.current) {
                              pinToBottomInstant();
                            }
                          });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (showMentionSuggestions && mentionSuggestions.length > 0) {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setSelectedMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
                            return;
                          }
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setSelectedMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                            return;
                          }
                          if (e.key === "Enter" || e.key === "Tab") {
                            if (!e.shiftKey) {
                              e.preventDefault();
                              const targetUser = mentionSuggestions[selectedMentionIndex] || mentionSuggestions[0];
                              if (targetUser) {
                                handleSelectMention(targetUser);
                                return;
                              }
                            }
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setShowMentionSuggestions(false);
                            return;
                          }
                        }

                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (typedMessage.trim().length > 0) {
                            if (editingMessage) {
                              handleEditMessageSubmit();
                            } else {
                              handleSendMessage({ text: typedMessage.trim() });
                            }
                          }
                        }
                      }}
                      style={{ resize: "none" }}
                      className="flex-1 min-w-0 max-h-[110px] py-1.5 px-1.5 bg-transparent outline-none text-[16px] md:text-[14.5px] text-[#111B21] dark:text-[#E9EDEF] placeholder:text-[#667781] dark:placeholder:text-[#8696A0] overflow-y-auto scrollbar-none leading-[1.35] break-words"
                    />

                    {/* Right inside pill: Gallery, Document, and One-Time Camera (WhatsApp alignment) */}
                    <div className="flex items-center gap-0.5 pb-0.5 shrink-0">
                      <label 
                        className="w-8 h-8 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0] transition-colors cursor-pointer flex items-center justify-center" 
                        title="Attach Image"
                        aria-label="Attach Image"
                      >
                        <ImageIcon size={18} />
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => triggerMediaUpload(e, "image")} />
                      </label>
                      
                      <label 
                        className="w-8 h-8 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0] transition-colors cursor-pointer flex items-center justify-center" 
                        title="Attach Document"
                        aria-label="Attach Document"
                      >
                        <Paperclip size={18} />
                        <input 
                          type="file" 
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.zip,.rar,.7z,.tar,.gz,.js,.ts,.tsx,.jsx,.py,.java,.cpp,.c,.html,.css,.xml,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip,text/*" 
                          className="hidden" 
                          onChange={(e) => triggerMediaUpload(e, "file")} 
                        />
                      </label>

                      {typedMessage.trim().length === 0 && (
                        <button 
                          type="button"
                          onClick={() => setShowInstagramCamera(true)}
                          className="w-8 h-8 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#8696A0] hover:text-[#0095F6] transition-colors cursor-pointer flex items-center justify-center shrink-0 relative" 
                          title="One-Time Photo & Video (Instagram View Once)"
                          aria-label="One-Time Photo & Video (Instagram View Once)"
                        >
                          <Camera size={19} />
                          <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-[#0095F6] text-white text-[8px] font-black rounded-full flex items-center justify-center shadow-xs border border-white/20">
                            1
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
 
                  {/* Luxury Obsidian + Champagne Gold Circular Send / Mic Button */}
                  <div className="shrink-0 flex items-center justify-center">
                    {typedMessage.trim().length > 0 ? (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (editingMessage) {
                            handleEditMessageSubmit();
                          } else {
                            handleSendMessage({ text: typedMessage.trim() });
                          }
                        }}
                        className="w-[46px] h-[46px] rounded-full bg-[#0D0D0F] hover:bg-[#1D1D22] text-[#C9A96E] border border-[#C9A96E]/45 dark:bg-[#C9A96E] dark:hover:bg-[#BFA063] dark:text-[#0D0D0F] flex items-center justify-center cursor-pointer shadow-[0_3px_10px_rgba(13,13,15,0.28)] active:scale-95 transition-transform"
                        title="Send Message"
                        aria-label="Send Message"
                      >
                        <Send size={18} className="ml-0.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={startRecording}
                        className="w-[46px] h-[46px] rounded-full bg-[#0D0D0F] hover:bg-[#1D1D22] text-[#C9A96E] border border-[#C9A96E]/45 dark:bg-[#C9A96E] dark:hover:bg-[#BFA063] dark:text-[#0D0D0F] flex items-center justify-center cursor-pointer shadow-[0_3px_10px_rgba(13,13,15,0.28)] active:scale-95 transition-transform"
                        title="Record Voice Note"
                        aria-label="Record Voice Note"
                      >
                        <Mic size={20} />
                      </button>
                    )}
                  </div>
                </div>
              )
            )}

              {/* Floating Scroll to Bottom Button (Always anchored above composer inside wallpaper stage) */}
              <AnimatePresence>
                {showScrollBottom && (
                  <motion.button
                    key="scroll-to-bottom-btn"
                    type="button"
                    initial={{ opacity: 0, scale: 0.8, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: 8 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => {
                      userInteractingRef.current = false;
                      isNearBottomRef.current = true;
                      scrollToBottom("smooth");
                      setUnreadAwayCount(0);
                      setShowScrollBottom(false);
                    }}
                    className="absolute right-3 bottom-18 sm:bottom-20 z-30 w-9 h-9 rounded-full bg-[#FAF8F4]/95 dark:bg-[#18181D]/95 backdrop-blur-md border border-[#C9A96E]/35 text-[#0D0D0F] dark:text-[#F7F4EE] shadow-[0_3px_10px_rgba(13,13,15,0.2)] active:scale-95 transition-all flex items-center justify-center cursor-pointer group select-none"
                    title="Scroll to latest messages"
                    aria-label="Scroll to bottom"
                  >
                    <ChevronDown size={19} className="transition-transform group-hover:translate-y-0.5" />
                    {unreadAwayCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-[#0D0D0F] dark:bg-[#C9A96E] text-[#C9A96E] dark:text-[#0D0D0F] border border-[#C9A96E]/40 text-[10px] font-bold font-sans flex items-center justify-center shadow-md">
                        {unreadAwayCount > 99 ? "99+" : unreadAwayCount}
                      </span>
                    )}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom-Docked WhatsApp Emoji Keyboard (Replaces System Keyboard Height Smoothly) */}
            <AnimatePresence initial={false}>
              {showEmojiPicker && (
                <ChatEmojiPicker
                  isOpen={showEmojiPicker}
                  onSelectEmoji={handleInsertEmoji}
                  onDeleteChar={handleDeleteEmojiChar}
                  onClose={() => setShowEmojiPicker(false)}
                  dockHeight={lastKeyboardHeight}
                />
              )}
            </AnimatePresence>

            {/* Fallback Keyboard Inset Spacer (Only for iOS/non-resizing overlay keyboards when emoji drawer is closed) */}
            {!showEmojiPicker && keyboardInset > 0 && (
              <div style={{ height: `${keyboardInset}px` }} className="flex-none shrink-0 w-full" />
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none bg-neutral-50/50 dark:bg-neutral-950/30">
            <div className="w-16 h-16 rounded-3xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/25 flex items-center justify-center mb-4 text-amber-700 dark:text-amber-400 shadow-xs">
              <MessageSquare className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white font-display">
              SwapSkill Messenger
            </h2>
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400 max-w-sm mt-2 leading-relaxed">
              Select a conversation to start chatting, or search a partner's name to exchange skills in real time.
            </p>
            <div className="inline-flex items-center gap-2 mt-4 px-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 shadow-2xs">
              <Lock size={12} className="text-emerald-500" />
              <span>Real-time End-to-End Secure</span>
            </div>
          </div>
        )}
      </motion.div>



      {/* 4. PHOTO FULL SCREEN MODAL */}
      <AnimatePresence>
        {fullscreenImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFullscreenImage(null)}
            className="fixed inset-0 bg-black/95 flex flex-col items-center justify-center p-4 z-50 cursor-zoom-out select-none"
          >
            <button 
              onClick={() => setFullscreenImage(null)}
              className="absolute top-6 right-6 p-2.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all cursor-pointer shadow-lg"
            >
              <X size={18} />
            </button>
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className="max-w-4xl max-h-[75vh] overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
            >
              <img
                src={fullscreenImage}
                alt="fullscreen attachment"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
                className="w-full h-full object-contain max-h-[75vh] select-none pointer-events-none"
                referrerPolicy="no-referrer"
              />
            </motion.div>
            <motion.div 
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
              transition={{ delay: 0.05 }}
              className="mt-6 flex gap-3"
            >
              <a 
                href={sanitizeUrl(fullscreenImage)} 
                download="attachment_image.png" 
                target="_blank" 
                rel="noopener noreferrer" 
                onClick={(e) => e.stopPropagation()}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-semibold text-white tracking-wide border border-white/10 transition-all flex items-center gap-2 shadow-lg"
              >
                <Download size={14} />
                <span>Download Photo</span>
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4B. VIDEO FULL SCREEN MODAL */}
      <AnimatePresence>
        {fullscreenVideo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFullscreenVideo(null)}
            className="fixed inset-0 bg-black/95 flex flex-col items-center justify-center p-4 z-50 select-none"
          >
            <button
              type="button"
              onClick={() => setFullscreenVideo(null)}
              className="absolute top-6 right-6 p-2.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all cursor-pointer shadow-lg"
            >
              <X size={18} />
            </button>
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className="max-w-4xl max-h-[78vh] overflow-hidden rounded-2xl border border-white/10 shadow-2xl bg-black"
            >
              <video
                src={fullscreenVideo}
                controls
                autoPlay
                playsInline
                className="w-full h-full max-h-[78vh] object-contain"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 5. USER MISCONDUCT REPORT MODAL */}
      <AnimatePresence>
        {showReportModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-theme-card border border-theme-border rounded-3xl p-6 w-full max-w-md shadow-2xl relative"
            >
              <button 
                onClick={() => setShowReportModal(false)}
                className="absolute top-4 right-4 p-2 text-theme-secondary hover:text-theme-text transition cursor-pointer"
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-2 mb-4">
                <ShieldAlert className="text-red-500 w-5 h-5" />
                <h3 className="text-base font-bold text-theme-text font-display">Report Platform Misconduct</h3>
              </div>

              {reportSuccess ? (
                <div className="py-8 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10 text-green-500 mb-3">
                    <CheckCircle size={24} />
                  </div>
                  <h4 className="text-sm font-semibold text-theme-text">Report Submitted Successfully</h4>
                  <p className="text-xs text-theme-secondary mt-1 max-w-xs mx-auto">Thank you for helping keep SwapSkill safe. Our trust and safety officers will review the logs within 24 hours.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmitReport} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-secondary font-mono mb-1.5">Category</label>
                    <select 
                      value={reportCategory}
                      onChange={(e) => setReportCategory(e.target.value)}
                      className="w-full p-3 bg-theme-bg border border-theme-border rounded-xl text-xs outline-none focus:border-theme-accent text-theme-text"
                    >
                      <option value="Spam">Spam or unwanted solicitation</option>
                      <option value="Harassment">Abusive language or harassment</option>
                      <option value="Inappropriate Content">Inappropriate files or media</option>
                      <option value="Fraud">Suspicious or fraudulent behavior</option>
                      <option value="Other">Other misconduct</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-secondary font-mono mb-1.5 font-display">Detailed comments</label>
                    <textarea 
                      required
                      placeholder="Please provide context or specific message excerpts to help our moderators review..."
                      value={reportComments}
                      onChange={(e) => setReportComments(e.target.value)}
                      rows={4}
                      className="w-full p-3 bg-theme-bg border border-theme-border rounded-xl text-xs outline-none focus:border-theme-accent text-theme-text resize-none"
                    />
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button 
                      type="button"
                      onClick={() => setShowReportModal(false)}
                      className="px-4 py-2 bg-theme-bg hover:bg-theme-border text-xs font-semibold text-theme-secondary rounded-xl transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      disabled={submittingReport || reportComments.trim().length === 0}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-semibold rounded-xl transition cursor-pointer shadow-lg"
                    >
                      {submittingReport ? "Submitting..." : "Submit Report"}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 6. INSTAGRAM DIRECT ONE-TIME CAMERA MODAL */}
      <InstagramCameraModal
        isOpen={showInstagramCamera}
        onClose={() => setShowInstagramCamera(false)}
        recipientName={otherUserProfile?.fullName || otherUserProfile?.username || "Contact"}
        onSend={handleInstagramCameraSend}
      />

      {/* 7. INSTAGRAM VIEW ONCE / ALLOW REPLAY FULL-SCREEN DISAPPEARING VIEWER */}
      {viewingViewOnceMessage && (
        <ViewOnceViewerModal
          isOpen={Boolean(viewingViewOnceMessage)}
          onClose={handleCloseViewOnce}
          mediaUrl={viewingViewOnceMessage.videoUrl || viewingViewOnceMessage.imageUrl || ""}
          imageUrl={viewingViewOnceMessage.imageUrl || ""}
          mediaType={
            viewingViewOnceMessage.videoUrl || viewingViewOnceMessage.mediaType === "video"
              ? "video"
              : "image"
          }
          viewMode={getEffectiveViewMode(viewingViewOnceMessage)}
          isReplay={
            getEffectiveViewMode(viewingViewOnceMessage) === "allow_replay" &&
            getEphemeralViewsForUser(viewingViewOnceMessage, currentUserId) === 1
          }
          senderName={
            viewingViewOnceMessage.senderId === currentUserId
              ? "You"
              : otherUserProfile?.fullName || otherUserProfile?.username || "Contact"
          }
          senderPhoto={
            viewingViewOnceMessage.senderId === currentUserId
              ? currentUserProfile?.profilePhotoUrl || currentUserProfile?.photoUrl
              : otherUserProfile?.profilePhotoUrl || otherUserProfile?.photoUrl
          }
          durationSeconds={7}
        />
      )}

      {/* Dynamic Celebration Bursts for Emoji reactions */}
      <ReactionBurstEffect 
        bursts={bursts} 
        onComplete={(id) => setBursts(prev => prev.filter(b => b.id !== id))} 
      />

      {/* Premium reactions details bottom sheet */}
      <AnimatePresence>
        {reactionsDetailMsg && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center z-[100] p-0 md:p-4 animate-fade-in font-sans">
            <div className="absolute inset-0" onClick={() => {
              setReactionsDetailMsg(null);
              setDetailTab("All");
            }} />

            <motion.div 
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0.5 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="relative w-full md:max-w-md bg-white border-t md:border border-gray-200 rounded-t-[24px] md:rounded-[24px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh] md:max-h-[600px] z-10 text-gray-900"
            >
              <div className="flex md:hidden justify-center py-2.5 shrink-0">
                <div className="w-12 h-1.5 bg-zinc-700/60 rounded-full" />
              </div>

              <div className="flex justify-between items-center px-5 py-4 border-b border-white/5 shrink-0">
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-zinc-400 font-mono">Message Reactions</h3>
                <button 
                  onClick={() => {
                    setReactionsDetailMsg(null);
                    setDetailTab("All");
                  }}
                  className="p-1.5 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {(() => {
                const reactionEntries = Object.entries(reactionsDetailMsg.reactions || {}) as [string, string][];
                const countsByEmoji: Record<string, number> = {};
                reactionEntries.forEach(([_, emoji]) => {
                  countsByEmoji[emoji] = (countsByEmoji[emoji] || 0) + 1;
                });
                const tabs = ["All", ...Object.keys(countsByEmoji)];

                return (
                  <>
                    <div className="flex items-center gap-1.5 px-4 py-2 bg-black/20 border-b border-white/5 overflow-x-auto shrink-0 scrollbar-none">
                      {tabs.map((tab) => {
                        const count = tab === "All" ? reactionEntries.length : countsByEmoji[tab];
                        const isActive = detailTab === tab;
                        return (
                          <button
                            key={tab}
                            onClick={() => setDetailTab(tab)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition flex items-center gap-1.5 cursor-pointer ${
                              isActive 
                                ? "bg-gradient-to-tr from-[#D4AF37] to-[#E5C158] text-black shadow-lg shadow-[#D4AF37]/10" 
                                : "bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white"
                            }`}
                          >
                            <span>{tab === "All" ? "All" : tab}</span>
                            <span className={`text-[10px] font-bold font-mono ${isActive ? "text-black/70" : "text-zinc-500"}`}>
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-[150px]">
                      {reactionEntries
                        .filter(([_, emoji]) => detailTab === "All" || emoji === detailTab)
                        .map(([userId, emoji]) => {
                          const profile = profilesCache?.[userId] || chatProfiles[userId] || null;
                          const isCurrentUser = userId === currentUserId;

                          return (
                            <div 
                              key={userId} 
                              className="flex items-center justify-between p-2 bg-white/[0.02] border border-white/[0.04] rounded-2xl hover:bg-white/[0.04] transition duration-200"
                            >
                              <div className="flex items-center gap-3">
                                <SmartImage 
                                  src={profile?.photoUrl || profile?.profilePhotoUrl} 
                                  alt={profile?.fullName || "Partner"} 
                                  className="w-10 h-10 rounded-full border border-white/10 shrink-0" 
                                  fallbackType="profile" 
                                  fullName={profile?.fullName} 
                                />
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                                    <span>{profile?.fullName || "User"}</span>
                                    {isCurrentUser && (
                                      <span className="text-[9px] bg-[#D4AF37]/20 text-[#D4AF37] px-1.5 py-0.5 rounded-md font-mono uppercase font-black">You</span>
                                    )}
                                  </p>
                                  <p className="text-[10px] text-zinc-500 font-mono font-display">
                                    @{profile?.username || "user"}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="text-lg">{emoji}</span>
                                {isCurrentUser && (
                                  <button
                                    onClick={() => {
                                      handleReactToMessage(reactionsDetailMsg.id, emoji as string);
                                      setReactionsDetailMsg(null);
                                      setDetailTab("All");
                                    }}
                                    className="px-2 py-1 text-[9px] font-mono font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-lg border border-red-500/20 transition cursor-pointer"
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </>
                );
              })()}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* WhatsApp style Context Menu */}
      <MessageContextMenu
        isOpen={Boolean(selectedMsgId && selectedMsgCoords)}
        selectedMsg={selectedMsgId ? (messages.find(m => m.id === selectedMsgId) as any) : null}
        coords={selectedMsgCoords}
        currentUserId={currentUserId}
        onReact={(emoji, e) => {
          if (selectedMsgId) {
            handleReactToMessage(
              selectedMsgId, 
              emoji, 
              e ? { x: e.clientX, y: e.clientY } : undefined
            );
          }
          setSelectedMsgId(null);
        }}
        onReply={(msg) => {
          handleStartReply(msg as ExtendedMessage);
          setSelectedMsgId(null);
        }}
        onCopy={(msg) => {
          if (msg.text) {
            navigator.clipboard.writeText(msg.text);
            setToast({ message: "Text copied to clipboard", type: "info" });
          }
          setSelectedMsgId(null);
        }}
        onForward={(msg) => {
          setForwardTargetMessages([msg as ExtendedMessage]);
          setShowForwardModal(true);
          setSelectedMsgId(null);
        }}
        onSelect={(msg) => {
          setSelectedMsgIds(new Set([msg.id]));
          setSelectedMsgId(null);
        }}
        onTogglePin={(msg) => {
          handleTogglePinMessage(msg.id, msg.pinned);
          setSelectedMsgId(null);
        }}
        onToggleStar={(msg) => {
          handleToggleStarMessage(msg);
          setSelectedMsgId(null);
        }}
        onMessageInfo={(msg) => {
          setInfoMessage(msg as ExtendedMessage);
          setSelectedMsgId(null);
        }}
        onEdit={(msg) => {
          setEditingMessage(msg as ExtendedMessage);
          setTypedMessage(msg.text || "");
          setSelectedMsgId(null);
          setTimeout(() => {
            adjustTextareaHeight();
            textareaRef.current?.focus();
          }, 50);
        }}
        onDelete={(msg) => {
          if (msg.deletedFor?.includes(currentUserId) || deletedForMeSetRef.current.has(msg.id)) {
            setSelectedMsgId(null);
            return;
          }
          setDeleteTargetMessages([msg as ExtendedMessage]);
          setShowDeleteModal(true);
          setSelectedMsgId(null);
        }}
        onClose={() => setSelectedMsgId(null)}
      />

      {/* WhatsApp-style Starred Messages Modal */}
      <StarredMessagesModal
        isOpen={showStarredModal}
        starredMessages={starredMessages.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          senderName: m.senderId === currentUserId ? "You" : (otherUserProfile?.fullName || "Contact"),
          text: m.text,
          imageUrl: isEphemeralMediaMessage(m) ? undefined : m.imageUrl,
          audioUrl: m.audioUrl,
          fileUrl: m.fileUrl,
          fileName: m.fileName,
          timestamp: m.timestamp || m.createdAt,
        }))}
        currentUserId={currentUserId}
        partnerName={otherUserProfile?.fullName || "Contact"}
        onSelectMessage={(msgId) => {
          setShowStarredModal(false);
          handleScrollToMessage(msgId);
        }}
        onUnstarMessage={(msgId) => {
          const target = messages.find((m) => m.id === msgId);
          if (target) {
            handleToggleStarMessage(target);
          }
        }}
        onClose={() => setShowStarredModal(false)}
      />

      {/* WhatsApp-style Message Info Modal */}
      <MessageInfoModal
        isOpen={Boolean(infoMessage)}
        message={infoMessage ? {
          id: infoMessage.id,
          text: infoMessage.text,
          imageUrl: isEphemeralMediaMessage(infoMessage) ? undefined : infoMessage.imageUrl,
          audioUrl: infoMessage.audioUrl,
          fileUrl: infoMessage.fileUrl,
          fileName: infoMessage.fileName,
          status: infoMessage.status,
          timestamp: infoMessage.timestamp || infoMessage.createdAt,
          deliveredAt: infoMessage.deliveredAt,
          readAt: infoMessage.readAt,
        } : null}
        onClose={() => setInfoMessage(null)}
      />

      {/* WhatsApp-style Media, Links & Docs Gallery Modal (Keep-in-Chat ONLY) */}
      <ChatGalleryModal
        isOpen={showGalleryModal}
        messages={messages
          .filter((m) => !isEphemeralMediaMessage(m))
          .map((m) => ({
            id: m.id,
            senderId: m.senderId,
            text: m.text,
            imageUrl: m.imageUrl,
            videoUrl: m.videoUrl,
            fileUrl: m.fileUrl,
            fileName: m.fileName,
            fileSize: m.fileSize,
            timestamp: m.timestamp || m.createdAt,
            isViewOnce: m.isViewOnce,
            viewMode: m.viewMode,
          }))}
        partnerName={otherUserProfile?.fullName || "Contact"}
        onSelectMessage={(msgId) => {
          setShowGalleryModal(false);
          handleScrollToMessage(msgId);
        }}
        onClose={() => setShowGalleryModal(false)}
      />

      {/* WhatsApp-style Chat Wallpaper Modal */}
      {activeChat && (
        <ChatWallpaperModal
          isOpen={showWallpaperModal}
          chatId={activeChat.id}
          currentUserId={currentUserId}
          currentWallpaperId={currentWallpaperId}
          currentCustomUrl={wallpaperCustomUrl}
          currentDim={wallpaperDim}
          currentBlur={wallpaperBlur}
          onSelectWallpaper={async (presetId, customUrl, dim, blur) => {
            setCurrentWallpaperId(presetId);
            if (customUrl !== undefined) setWallpaperCustomUrl(customUrl || null);
            if (dim !== undefined) setWallpaperDim(dim);
            if (blur !== undefined) setWallpaperBlur(Boolean(blur));

            const wallpaperPayload = {
              id: presetId,
              customUrl: customUrl || null,
              dim: typeof dim === "number" ? dim : 0.35,
              blur: Boolean(blur),
              updatedAt: serverTimestamp(),
              setBy: currentUserId,
            };

            const chatId = activeChat.id;
            try {
              await updateDoc(doc(db, "conversations", chatId), {
                wallpaper: wallpaperPayload,
              });
            } catch (err) {
              try {
                await updateDoc(doc(db, "chats", chatId), {
                  wallpaper: wallpaperPayload,
                });
              } catch (_) {}
            }
          }}
          onClose={() => setShowWallpaperModal(false)}
        />
      )}

      {/* Modern Luxury Chat / Contact Info Modal */}
      {activeChat && (
        <ChatInfoModal
          isOpen={showChatInfoModal}
          onClose={() => setShowChatInfoModal(false)}
          otherUserProfile={otherUserProfile}
          otherUserPresence={otherUserPresence}
          formatLastSeen={formatLastSeen}
          onVoiceCall={handleInitiateVoiceCall}
          onVideoCall={handleInitiateVideoCall}
          onSearchInChat={() => setShowSearchInChat(true)}
          onOpenGallery={() => setShowGalleryModal(true)}
          onOpenStarred={() => setShowStarredModal(true)}
          onOpenWallpaper={() => setShowWallpaperModal(true)}
          isPinned={Boolean(effectiveChat?.pinnedUsers?.includes(currentUserId))}
          isMuted={Boolean(effectiveChat?.mutedUsers?.includes(currentUserId))}
          isArchived={Boolean(effectiveChat?.archivedUsers?.includes(currentUserId))}
          isBlocked={Boolean((otherUserId || effectiveChat?.otherUserId) && blockedUsers.includes(otherUserId || effectiveChat?.otherUserId || ""))}
          onTogglePin={handleTogglePinChat}
          onToggleMute={handleToggleMuteChat}
          onToggleArchive={handleToggleArchiveChat}
          onToggleBlock={handleToggleBlockUser}
          onReportUser={() => setShowReportModal(true)}
          onViewProfile={(uid) => {
            if (otherUserProfile) {
              try {
                safeLocalStorage.setItem("swap_cached_profile", JSON.stringify(otherUserProfile));
                safeLocalStorage.setItem(`swap_cached_profile_${uid}`, JSON.stringify(otherUserProfile));
                const raw = safeLocalStorage.getItem("swap_cache_profiles_map");
                const map = raw ? JSON.parse(raw) : {};
                map[uid] = otherUserProfile;
                safeLocalStorage.setItem("swap_cache_profiles_map", JSON.stringify(map));
              } catch (_) {}
            }
            onSelectUser?.(uid);
          }}
          sharedMediaThumbnails={messages
            .filter((m) => !isEphemeralMediaMessage(m) && Boolean(m.imageUrl || m.videoUrl))
            .map((m) => (m.videoUrl || m.imageUrl)!)
            .slice(0, 6)}
          totalMediaCount={
            messages.filter((m) => !isEphemeralMediaMessage(m) && Boolean(m.imageUrl || m.videoUrl)).length
          }
          totalDocsCount={messages.filter((m) => Boolean(m.fileUrl)).length}
          totalLinksCount={messages.filter((m) => Boolean(m.text && (m.text.includes("http://") || m.text.includes("https://")))).length}
          totalStarredCount={starredMessages.length}
        />
      )}

      {/* WhatsApp-style Delete Confirmation Modal */}
      <DeleteMessageConfirmModal
        isOpen={showDeleteModal}
        targetMessages={deleteTargetMessages}
        currentUserId={currentUserId}
        onDeleteForMe={handleConfirmBatchDeleteForMe}
        onDeleteForEveryone={handleConfirmBatchDeleteForEveryone}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteTargetMessages([]);
        }}
      />

      {/* WhatsApp-style Forward Modal */}
      <ForwardMessageModal
        isOpen={showForwardModal}
        currentUserId={currentUserId}
        availableChats={globalChats.map(c => {
          const otherId = getOtherParticipantId(c, currentUserId);
          const otherProf = c.participantProfiles?.[otherId] || chatProfiles[otherId] || null;
          return {
            id: c.id,
            name: otherProf?.fullName || otherProf?.username || "Conversation",
            avatarUrl: otherProf?.photoUrl || otherProf?.photoURL,
            isOnline: otherId === activeChat?.otherUserId ? otherUserPresence?.status === "online" : false
          };
        })}
        forwardMessages={forwardTargetMessages}
        onForward={handleExecuteForward}
        onClose={() => {
          setShowForwardModal(false);
          setForwardTargetMessages([]);
        }}
      />

      {/* Block / Unblock User Confirmation Modal */}
      <BlockUserConfirmModal
        isOpen={showBlockModal}
        mode={blockModalMode}
        targetUser={blockModalTarget ? {
          uid: blockModalTarget.uid,
          username: blockModalTarget.username,
          fullName: blockModalTarget.fullName,
          photoUrl: blockModalTarget.photoUrl || (blockModalTarget as any).photoURL
        } : null}
        onConfirm={handleConfirmBlockAction}
        onClose={() => setShowBlockModal(false)}
      />

      {/* Instagram-Style Note Composer / Action Sheet */}
      <InstagramNoteComposerModal
        isOpen={isEditingNote}
        existingNote={userNoteObj}
        currentUserProfile={currentUserProfile}
        onClose={() => setIsEditingNote(false)}
        onSaveNote={async (nextNote) => {
          setUserNoteObj(nextNote);
          try {
            safeLocalStorage.setItem(`swap_user_note_v2_${currentUserId}`, JSON.stringify(nextNote));
            safeLocalStorage.removeItem(`swap_user_note_${currentUserId}`);
          } catch {}
          await updateProfile({ activeNote: nextNote });
        }}
        onDeleteNote={async () => {
          setUserNoteObj(null);
          try {
            safeLocalStorage.removeItem(`swap_user_note_v2_${currentUserId}`);
            safeLocalStorage.removeItem(`swap_user_note_${currentUserId}`);
          } catch {}
          await updateProfile({ activeNote: null });
        }}
      />

      {/* Instagram-Style Contact Note Viewer & Quick Reply Sheet */}
      <InstagramNoteViewerModal
        contact={viewingContactNote}
        onClose={() => setViewingContactNote(null)}
        onOpenChat={async (contact) => {
          if (contact.chatObj) {
            setActiveChat(contact.chatObj);
            if (onChatSelect) onChatSelect(contact.chatObj.id);
          } else {
            const res = await getOrCreateConversation(currentUserId, contact.uid);
            const syntheticChat: ExtendedChat = {
              id: res.chatId,
              participantIds: [currentUserId, contact.uid],
              otherUserId: contact.uid,
              otherUser: contact.profile || undefined,
              lastMessage: "",
              lastMessageSenderId: currentUserId,
              lastMessageTime: new Date(),
              unreadCount: { [currentUserId]: 0, [contact.uid]: 0 },
              isLegacy: res.isLegacy,
            };
            setActiveChat(syntheticChat);
            if (onChatSelect) onChatSelect(res.chatId);
          }
        }}
        onReplyToNote={async (contact, note, replyText) => {
          let targetChatId = contact.chatObj?.id;
          let targetParticipantIds: string[] = contact.chatObj?.participantIds || [currentUserId, contact.uid];
          let isLegacy = Boolean(contact.chatObj?.isLegacy);

          if (!targetChatId) {
            const res = await getOrCreateConversation(currentUserId, contact.uid, replyText);
            targetChatId = res.chatId;
            isLegacy = res.isLegacy;
          }
          if (!targetChatId) return;

          const collectionName = isLegacy ? "chats" : "conversations";
          const now = new Date();
          const clientMsgId = `note_reply_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const notePreview = note.text || `${note.moodEmoji || ""} ${note.moodLabel || ""}`.trim();
          const replyQuoteText = `Note: "${notePreview}"`;

          const msgPayload = {
            senderId: currentUserId,
            text: replyText,
            createdAt: serverTimestamp(),
            timestamp: serverTimestamp(),
            clientTimestamp: now.getTime(),
            clientMsgId,
            status: "sent",
            isRead: false,
            deleted: false,
            reactions: {},
            pinned: false,
            deletedFor: [],
            replyToId: `note_${contact.uid}_${note.createdAt}`,
            replyToText: replyQuoteText,
            replyToSenderName: contact.displayName,
          };

          const parentRef = doc(db, collectionName, targetChatId);
          await Promise.all([
            addDoc(collection(db, collectionName, targetChatId, "messages"), msgPayload),
            setDoc(
              parentRef,
              {
                id: targetChatId,
                participantIds: targetParticipantIds,
                lastMessage: replyText,
                lastMessageSenderId: currentUserId,
                lastMessageTime: now,
                lastMessageAt: now,
                updatedAt: now,
                unreadCount: {
                  [contact.uid]: increment(1),
                  [currentUserId]: 0,
                },
              },
              { merge: true }
            ),
          ]);

          dispatchPushNotification({
            recipientUserId: contact.uid,
            title: currentUserProfile?.fullName || auth.currentUser?.displayName || "New message",
            body: `Replied to your note: ${replyText.substring(0, 65)}`,
            channelId: "swapskill_messages",
            priority: "high",
            data: {
              type: "chat",
              chatId: targetChatId,
              messageId: clientMsgId,
              senderId: currentUserId,
              senderName: currentUserProfile?.fullName || "Someone",
              recipientId: contact.uid,
            },
          }).catch(() => {});
        }}
      />

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <PremiumToast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
