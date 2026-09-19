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
  addDoc, 
  where,
  getDocs,
  arrayUnion,
  arrayRemove,
  serverTimestamp
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { useApp } from "../context/AppContext";
import { Chat, Message, UserProfile } from "../types";
import { searchUsers } from "../services/userSearchService";
import { getOrCreateConversation, getTimestampMs } from "../utils/conversationUtils";
import { playNewChatMessage } from "../utils/sound";
import { SmartImage } from "./SmartImage";
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
  Video
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
import { optimizeImage, applyCloudinaryAutoOptimization } from "../utils/imageCompressor";
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
  createdAt?: any;
  clientMsgId?: string;
  replyToId?: string;
  replyToText?: string;
  replyToSenderName?: string;
  replyToMedia?: "image" | "audio" | "file";
  replyToImageUrl?: string;
  isEdited?: boolean;
  imageUrl?: string;
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
  const val = msg.createdAt || msg.timestamp;
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
    const parts = chat.id.replace(/^chat_/, "").split("_").map((p) => p.trim()).filter(Boolean);
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
}: ChatHeaderProps) => {
  const isOnline = otherUserPresence?.status === "online";
  const statusText = otherUserTyping 
    ? "typing..." 
    : isOnline 
    ? "Active now" 
    : formatLastSeen(otherUserPresence?.lastSeen);

  return (
    <div className="shrink-0 flex-none bg-[#0D0D0F] text-[#F7F4EE] border-b border-[#1E1E22] flex items-center justify-between px-3 sm:px-4 shadow-sm relative z-20 select-none w-full pt-[env(safe-area-inset-top,0px)] min-h-[calc(56px+env(safe-area-inset-top,0px))]">
      {/* Left: Back button + User Identity */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <button 
          onClick={onBackClick}
          className="md:hidden w-8 h-8 -ml-1 rounded-full text-[#F7F4EE]/90 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer flex items-center justify-center active:scale-95"
          title="Back to conversations"
          aria-label="Back"
        >
          <ChevronLeft size={22} />
        </button>

        <div className="flex items-center min-w-0 flex-1">
          <AnimatePresence mode="wait">
            {!otherUserProfile ? (
              <motion.div 
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center gap-2.5 min-w-0"
              >
                <div className="w-9 h-9 rounded-full bg-[#1A1A1D] animate-pulse shrink-0 border border-[#27272A]" />
                <div className="flex flex-col gap-1.5 justify-center min-w-0">
                  <div className="w-24 h-3 bg-[#1A1A1D] rounded animate-pulse" />
                  <div className="w-16 h-2 bg-[#1A1A1D] rounded animate-pulse" />
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key={otherUserProfile.uid}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 4 }}
                transition={{ duration: 0.15 }}
                className="flex items-center min-w-0"
              >
                <button
                  type="button"
                  onClick={() => onSelectUser?.(otherUserProfile.uid)}
                  className="group flex items-center gap-2.5 text-left outline-none focus:outline-none cursor-pointer p-0.5 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors relative overflow-hidden min-w-0"
                >
                  <div className="relative shrink-0 flex items-center">
                    <SmartImage 
                      src={otherUserProfile.photoUrl || otherUserProfile.profilePhotoUrl} 
                      alt={otherUserProfile.fullName || "User"} 
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border border-[#27272A] object-cover shrink-0 shadow-2xs group-hover:scale-102 transition-transform duration-150" 
                      fallbackType="profile" 
                      fullName={otherUserProfile.fullName} 
                    />
                    <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0D0D0F] ${
                      otherUserTyping ? "bg-emerald-500 shadow-2xs animate-pulse" : isOnline ? "bg-emerald-500 shadow-2xs" : "bg-[#71717A]"
                    }`} />
                  </div>

                  <div className="flex flex-col justify-center min-w-0">
                    <h3 className="text-[13.5px] sm:text-[14px] font-semibold text-[#F7F4EE] leading-tight truncate max-w-[140px] xs:max-w-[190px] sm:max-w-[280px] group-hover:text-[#D4AF37] transition-colors">
                      {otherUserProfile.fullName || "Member"}
                    </h3>
                    <div className="flex items-center gap-1.5 leading-none text-[11px] text-[#A1A1AA] mt-0.5 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${otherUserTyping ? "bg-emerald-500 animate-pulse" : isOnline ? "bg-emerald-500" : "bg-[#71717A]"}`} />
                      <span className={`truncate max-w-[130px] sm:max-w-[180px] ${otherUserTyping ? "text-emerald-400 font-medium italic animate-pulse" : "font-normal"}`}>{statusText}</span>
                    </div>
                  </div>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right: Real Calling Actions & Options Menu */}
      <div className="relative flex items-center gap-1.5 sm:gap-2 shrink-0">
        {onVoiceCall && (
          <button
            id="chat-header-voice-call-btn"
            type="button"
            onClick={onVoiceCall}
            className="h-8.5 px-2.5 sm:px-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-[#F7F4EE] hover:text-[#D4AF37] active:scale-95 transition-all duration-150 cursor-pointer flex items-center gap-1.5 shrink-0 shadow-xs"
            title="Start voice call"
            aria-label="Start voice call"
          >
            <Phone size={15} className="text-[#D4AF37]" />
            <span className="hidden sm:inline text-xs font-semibold text-white/95">Voice</span>
          </button>
        )}

        {onVideoCall && (
          <button
            id="chat-header-video-call-btn"
            type="button"
            onClick={onVideoCall}
            className="h-8.5 px-2.5 sm:px-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-[#F7F4EE] hover:text-[#D4AF37] active:scale-95 transition-all duration-150 cursor-pointer flex items-center gap-1.5 shrink-0 shadow-xs"
            title="Start video call"
            aria-label="Start video call"
          >
            <Video size={16} className="text-[#D4AF37]" />
            <span className="hidden sm:inline text-xs font-semibold text-white/95">Video</span>
          </button>
        )}

        <button 
          id="chat-header-options-btn"
          onClick={onDropdownToggle}
          className="w-8.5 h-8.5 rounded-full text-[#F7F4EE]/80 hover:text-[#F7F4EE] hover:bg-white/10 active:scale-95 transition-all duration-150 cursor-pointer flex items-center justify-center shrink-0 border border-transparent hover:border-white/10"
          title="More options"
          aria-label="More options"
        >
          <MoreVertical size={18} />
        </button>
        
        <AnimatePresence>
          {showOptionsDropdown && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -6 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute right-0 top-[44px] w-52 bg-[#141417] border border-[#27272A] rounded-2xl shadow-[0_12px_32px_rgba(0,0,0,0.6)] p-1.5 z-50 text-xs font-medium text-[#F7F4EE]"
            >
              {onVoiceCall && (
                <button
                  type="button"
                  onClick={() => {
                    onVoiceCall();
                    onDropdownToggle();
                  }}
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-[#F7F4EE] hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  <Phone size={14} className="text-[#D4AF37]" />
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
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-[#F7F4EE] hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  <Video size={14} className="text-[#D4AF37]" />
                  <span>Start Video Call</span>
                </button>
              )}

              {(onVoiceCall || onVideoCall) && (
                <div className="border-t border-white/10 my-1" />
              )}

              <button 
                onClick={() => {
                  onSearchInChatClick();
                  onDropdownToggle();
                }}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-[#F7F4EE] hover:bg-white/5 rounded-xl transition cursor-pointer"
              >
                <SearchIcon size={14} className="text-[#D4AF37]" />
                <span>Search in Conversation</span>
              </button>

              <button 
                onClick={() => {
                  handleTogglePinChat();
                  onDropdownToggle();
                }}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-[#F7F4EE] hover:bg-white/5 rounded-xl transition cursor-pointer"
              >
                <Pin size={14} className="rotate-45 text-[#D4AF37]" />
                <span>{activeChat.pinnedUsers?.includes(currentUserId) ? "Unpin Chat" : "Pin Chat"}</span>
              </button>
              
              <button 
                onClick={() => {
                  handleToggleArchiveChat();
                  onDropdownToggle();
                }}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-[#F7F4EE] hover:bg-white/5 rounded-xl transition cursor-pointer"
              >
                <Archive size={14} className="text-[#A1A1AA]" />
                <span>{activeChat.archivedUsers?.includes(currentUserId) ? "Unarchive" : "Archive"}</span>
              </button>

              <button 
                onClick={() => {
                  handleToggleMuteChat();
                  onDropdownToggle();
                }}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-[#F7F4EE] hover:bg-white/5 rounded-xl transition cursor-pointer"
              >
                {activeChat.mutedUsers?.includes(currentUserId) ? <Bell size={14} className="text-[#D4AF37]" /> : <BellOff size={14} className="text-[#A1A1AA]" />}
                <span>{activeChat.mutedUsers?.includes(currentUserId) ? "Unmute Notifications" : "Mute Notifications"}</span>
              </button>

              <div className="border-t border-white/10 my-1" />

              <button 
                onClick={() => {
                  handleToggleBlockUser();
                  onDropdownToggle();
                }}
                disabled={!activeChat.otherUserId}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-rose-400 hover:bg-rose-500/10 rounded-xl transition cursor-pointer disabled:opacity-50"
              >
                <Ban size={14} className="text-rose-400" />
                <span>{activeChat.otherUserId && blockedUsers.includes(activeChat.otherUserId) ? "Unblock User" : "Block User"}</span>
              </button>

              <button 
                onClick={() => {
                  setShowReportModal(true);
                  onDropdownToggle();
                }}
                className="flex items-center gap-2.5 w-full p-2.5 text-left text-[#A1A1AA] hover:text-[#F7F4EE] hover:bg-white/5 rounded-xl transition cursor-pointer"
              >
                <ShieldAlert size={14} className="text-[#A1A1AA]" />
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
  const { currentUserProfile, chats: globalChats, messagesCache, setMessagesInCache, profilesCache, fetchProfile } = useApp();
  
  // Navigation & View States
  const [activeChat, setActiveChat] = useState<ExtendedChat | null>(null);
  const [messages, setMessages] = useState<ExtendedMessage[]>([]);
  
  // Load other user details for all filtered chats
  const [chatProfiles, setChatProfiles] = useState<Record<string, UserProfile>>({});

  const otherUserId = useMemo(() => {
    return getOtherParticipantId(activeChat, currentUserId);
  }, [activeChat, currentUserId]);

  const otherUserProfile = useMemo(() => {
    return resolveOtherUserProfile(otherUserId, activeChat, profilesCache, chatProfiles);
  }, [otherUserId, activeChat, profilesCache, chatProfiles]);

  // Synchronize active chat state to parent App (for responsive layout adaptation and bottom nav control)
  useEffect(() => {
    const hasActive = Boolean(activeChat);
    const id = activeChat?.id || null;
    if (onActiveChatChange) {
      onActiveChatChange(hasActive, id);
    }
    if (onChatSelect) {
      onChatSelect(id);
    }
  }, [activeChat?.id, onActiveChatChange, onChatSelect]);

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

    return () => {
      activeChatTrackingService.setActiveChat(null);
    };
  }, [activeChat?.id, otherUserId, activeChat?.participantIds]);

  const handleInitiateVoiceCall = useCallback(() => {
    if (!activeChat) return;
    const resolvedOtherId = otherUserId || activeChat.otherUserId || getOtherParticipantId(activeChat, currentUserId);
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
    const resolvedOtherId = otherUserId || activeChat.otherUserId || getOtherParticipantId(activeChat, currentUserId);
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
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  
  // Chat list filter & Instagram-style requests state
  const [chatFilterText, setChatFilterText] = useState("");
  const [showRequestsView, setShowRequestsView] = useState(false);
  const [requestsSearchText, setRequestsSearchText] = useState("");

  // Camera Capture States
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Block & Report States
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [blockedByUsers, setBlockedByUsers] = useState<string[]>([]);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockModalTarget, setBlockModalTarget] = useState<UserProfile | null>(null);
  const [blockModalMode, setBlockModalMode] = useState<"block" | "unblock">("block");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCategory, setReportCategory] = useState("Spam");
  const [reportComments, setReportComments] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  // Mobile Keyboard & Viewport Insets
  const { isKeyboardOpen, keyboardInset, visualViewportHeight } = useKeyboardViewport();

  // Input & Edit States
  const [typedMessage, setTypedMessage] = useState("");
  const [editingMessage, setEditingMessage] = useState<ExtendedMessage | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<ExtendedMessage | null>(null);
  const [searchInChatText, setSearchInChatText] = useState("");
  const [showSearchInChat, setShowSearchInChat] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showOptionsDropdown, setShowOptionsDropdown] = useState(false);

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
  useBackHandler(Boolean(fullscreenImage), () => {
    setFullscreenImage(null);
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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = chatScrollContainerRef.current;
    if (!container) return;
    const targetScrollTop = container.scrollHeight - container.clientHeight;
    if (targetScrollTop < 0) return;

    if (behavior === "auto") {
      container.scrollTop = targetScrollTop;
    } else {
      container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    }
  }, []);

  // Monitor chat container resize (mobile keyboard open/close, textarea expansion, orientation)
  useEffect(() => {
    const container = chatScrollContainerRef.current;
    if (!container) return;

    let prevClientHeight = container.clientHeight;

    const handleContainerResize = () => {
      const newHeight = container.clientHeight;
      if (newHeight !== prevClientHeight) {
        prevClientHeight = newHeight;
        if (isNearBottomRef.current) {
          // Immediately keep pinned to bottom as keyboard or input changes
          container.scrollTop = container.scrollHeight - container.clientHeight;
        }
      }
    };

    const ro = new ResizeObserver(() => {
      handleContainerResize();
    });
    ro.observe(container);

    // Also listen to visualViewport for mobile soft keyboard in WebView/Capacitor
    const vv = window.visualViewport;
    const handleVisualViewportChange = () => {
      if (isNearBottomRef.current && chatScrollContainerRef.current) {
        const c = chatScrollContainerRef.current;
        c.scrollTop = c.scrollHeight - c.clientHeight;
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
  }, [activeChat?.id]);

  // Re-anchor to bottom when keyboard opens/closes, visual viewport shrinks, or typing indicator toggles (only if user was already near bottom)
  useEffect(() => {
    if (isNearBottomRef.current && chatScrollContainerRef.current) {
      const c = chatScrollContainerRef.current;
      c.scrollTop = c.scrollHeight - c.clientHeight;

      const rAf = requestAnimationFrame(() => {
        if (isNearBottomRef.current && chatScrollContainerRef.current) {
          c.scrollTop = c.scrollHeight - c.clientHeight;
        }
      });
      const timer = setTimeout(() => {
        if (isNearBottomRef.current && chatScrollContainerRef.current) {
          c.scrollTop = c.scrollHeight - c.clientHeight;
        }
      }, 200);

      return () => {
        cancelAnimationFrame(rAf);
        clearTimeout(timer);
      };
    }
  }, [isKeyboardOpen, visualViewportHeight, keyboardInset, otherUserTyping]);

  // Synchronize scroll position when messages change
  useLayoutEffect(() => {
    const container = chatScrollContainerRef.current;
    if (!container || messages.length === 0) return;

    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];

    const prevFirstId = prevFirstMsgIdRef.current;
    const prevLastId = prevLastMsgIdRef.current;
    const prevHeight = prevScrollHeightRef.current;
    const prevTop = prevScrollTopRef.current;

    const isInitial = isFirstLoadRef.current || !prevLastId;

    if (isInitial) {
      isFirstLoadRef.current = false;
      isNearBottomRef.current = true;
      container.scrollTop = container.scrollHeight - container.clientHeight;
    } else if (lastMsg && lastMsg.id !== prevLastId) {
      // New message appended at bottom
      const isSentByMe = lastMsg.senderId === currentUserId;
      if (isSentByMe) {
        // I sent a message: always scroll down smoothly
        isNearBottomRef.current = true;
        scrollToBottom("smooth");
      } else if (isNearBottomRef.current) {
        // Incoming message: only scroll if user was already near bottom
        scrollToBottom("smooth");
      }
      // If user was reading older messages (isNearBottomRef.current === false), DO NOT force scroll!
    } else if (firstMsg && firstMsg.id !== prevFirstId && prevHeight > 0) {
      // Older messages were prepended at top: PRESERVE exact scroll position
      const heightDiff = container.scrollHeight - prevHeight;
      if (heightDiff > 0 && !isNearBottomRef.current) {
        container.scrollTop = prevTop + heightDiff;
      }
    } else if (isNearBottomRef.current) {
      // Content updated (reactions, edits, delivery status) while anchored at bottom
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }

    // Update tracking refs
    prevFirstMsgIdRef.current = firstMsg?.id || null;
    prevLastMsgIdRef.current = lastMsg?.id || null;
    prevScrollHeightRef.current = container.scrollHeight;
    prevScrollTopRef.current = container.scrollTop;
  }, [messages, currentUserId, scrollToBottom]);

  // Synchronize target chat from props
  const targetId = activeChatId || initialChatId;
  const lastTargetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (targetId) {
      const match = globalChats.find((c) => c.id === targetId);
      if (match) {
        setActiveChat(prev => {
          if (prev && prev.id === targetId) {
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

  // Sync user presence status inside MessagesView
  useEffect(() => {
    if (!currentUserId) return;
    
    // Set user as online
    const presenceRef = doc(db, "userPresence", currentUserId);
    setDoc(presenceRef, {
      id: currentUserId,
      userId: currentUserId,
      status: "online",
      lastSeen: new Date()
    }, { merge: true }).catch(console.error);

    return () => {
      // Set user as offline on leave
      setDoc(presenceRef, {
        status: "offline",
        lastSeen: new Date()
      }, { merge: true }).catch(console.error);
    };
  }, [currentUserId]);

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
    const otherId = activeChat.participantIds.find(id => id !== currentUserId);
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
  }, [activeChat, currentUserId]);

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
            const optimizedFile = await optimizeImage(
              new File([blob], "camera_capture.jpg", { type: "image/jpeg" }),
              {
                type: "other",
                maxWidth: 1200,
                maxHeight: 1200,
                quality: 0.85
              }
            );
            const file = optimizedFile instanceof File 
              ? optimizedFile 
              : new File([optimizedFile], "camera_capture.jpg", { type: "image/jpeg" });
            const url = await handleCloudinaryUpload(file, "image");
            handleSendMessage({ imageUrl: url });
          }
        }, "image/jpeg", 0.85);
      }
    } catch (e) {
      console.error("Failed to capture photo:", e);
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
            .map(c => c.otherUserId)
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

  // Clean unreadCount immediately for the active conversation
  useEffect(() => {
    if (!activeChat || !currentUserId) return;
    const currentUnread = activeChat.unreadCount?.[currentUserId] || 0;
    if (currentUnread > 0) {
      const collectionName = activeChat.isLegacy ? "chats" : "conversations";
      updateDoc(doc(db, collectionName, activeChat.id), {
        [`unreadCount.${currentUserId}`]: 0
      }).catch(console.error);
    }
  }, [activeChat, currentUserId]);

  // Background worker to mark incoming unread messages as 'delivered' when user has app open
  useEffect(() => {
    if (!currentUserId || !globalChats || globalChats.length === 0) return;

    globalChats.forEach(async (chat) => {
      const unread = chat.unreadCount?.[currentUserId] || 0;
      if (unread > 0) {
        try {
          const collectionName = chat.isLegacy ? "chats" : "conversations";
          const msgsRef = collection(db, collectionName, chat.id, "messages");
          const q = query(msgsRef, where("senderId", "!=", currentUserId), where("status", "==", "sent"), limit(15));
          const snap = await getDocs(q);
          snap.forEach((docSnap) => {
            updateDoc(doc(db, collectionName, chat.id, "messages", docSnap.id), {
              status: "delivered"
            }).catch(() => {});
          });
        } catch (e) {
          // ignore error quietly
        }
      }
    });
  }, [globalChats, currentUserId]);

  // Listen to active chat details (Presence, typing, and messages)
  useEffect(() => {
    isFirstLoadRef.current = true;
    isNearBottomRef.current = true;
    prevFirstMsgIdRef.current = null;
    prevLastMsgIdRef.current = null;
    prevScrollHeightRef.current = 0;
    prevScrollTopRef.current = 0;
    if (!activeChat) {
      setMessages([]);
      setOtherUserTyping(false);
      setOtherUserPresence(null);
      return;
    }

    const otherId = Array.isArray(activeChat.participantIds) ? activeChat.participantIds.find((id) => id !== currentUserId) : undefined;
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";

    // 1. Listen to active messages real time from cache first if available
    if (messagesCache && messagesCache[activeChat.id]) {
      const cached = (messagesCache[activeChat.id] as ExtendedMessage[]) || [];
      const sortedCached = [...cached].sort((a, b) => getMessageTimeMs(a) - getMessageTimeMs(b));
      setMessages(sortedCached);
      setLoadingMessages(false);
      setTimeout(() => {
        scrollToBottom("auto");
      }, 30);
    } else {
      setLoadingMessages(true);
      setMessages([]);
    }

    // Safety timeout: ensure loadingMessages is never stuck true forever even on network lag
    const fallbackTimer = setTimeout(() => {
      setLoadingMessages(false);
    }, 2500);

    const msgsRef = collection(db, collectionName, activeChat.id, "messages");

    // Unified Snapshot Processor ensuring strict oldest -> newest ascending message rendering
    const processMessagesSnapshot = (snapshot: any) => {
      clearTimeout(fallbackTimer);

      const loadedMsgs: ExtendedMessage[] = [];
      snapshot.forEach((docSnap: any) => {
        const msg = docSnap.data() as ExtendedMessage;
        
        // Skip if deleted for this user (in DB or local optimistic ref)
        if (deletedForMeSetRef.current.has(docSnap.id) || msg.deletedFor?.includes(currentUserId)) {
          return;
        }

        const deleted = Boolean(
          deletedForEveryoneSetRef.current.has(docSnap.id) || 
          isMessageDeleted(msg)
        );

        const processedMsg: ExtendedMessage = {
          ...msg,
          id: docSnap.id,
          deleted,
          isDeleted: deleted,
          ...(deleted ? {
            text: "This message was deleted",
            imageUrl: undefined,
            audioUrl: undefined,
            fileUrl: undefined,
            fileName: undefined,
            fileSize: undefined,
            reactions: {},
            pinned: false
          } : {})
        };

        loadedMsgs.push(processedMsg);

        // Mark incoming active messages as seen
        if (!deleted && msg.senderId !== currentUserId && msg.status !== "seen") {
          updateDoc(doc(db, collectionName, activeChat.id, "messages", docSnap.id), {
            status: "seen"
          }).catch(() => {});
        }
      });

      // Trigger subtle chat sound for incoming new messages
      if (!isFirstLoadRef.current) {
        const hasIncomingNew = snapshot.docChanges().some((change: any) => 
          change.type === "added" && 
          change.doc.data().senderId !== currentUserId
        );
        if (hasIncomingNew) {
          playNewChatMessage(`chat_msg_${activeChat.id}`);
        }
      }

      // Strict Chronological Sort: Oldest → Newest (Top → Bottom)
      loadedMsgs.sort((a, b) => getMessageTimeMs(a) - getMessageTimeMs(b));

      setMessages(prev => {
        const optimistic = prev.filter(m => m.id.startsWith("optimistic_"));
        const unresolved = optimistic.filter(o => {
          return !loadedMsgs.some(s => {
            // Match by stable clientMsgId or direct document ID
            if (s.id === o.id || s.clientMsgId === o.id) return true;
            // Fallback match: same sender, exact same payload text/media, created within 15 seconds
            const senderMatch = s.senderId === o.senderId;
            const textMatch = (s.text || "").trim() === (o.text || "").trim();
            const imageMatch = !o.imageUrl || s.imageUrl === o.imageUrl;
            const audioMatch = !o.audioUrl || s.audioUrl === o.audioUrl;
            const fileMatch = !o.fileUrl || s.fileUrl === o.fileUrl;
            const timeDiff = Math.abs(getMessageTimeMs(s) - getMessageTimeMs(o));
            return senderMatch && textMatch && imageMatch && audioMatch && fileMatch && timeDiff < 15000;
          });
        });

        // Deduplicate messages by ID to strictly enforce unique render entries
        const seen = new Set<string>();
        const finalMsgs: ExtendedMessage[] = [];
        [...loadedMsgs, ...unresolved].forEach(m => {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            finalMsgs.push(m);
          }
        });

        // Ensure entire list is strictly ordered oldest → newest (top → bottom)
        finalMsgs.sort((a, b) => getMessageTimeMs(a) - getMessageTimeMs(b));

        if (setMessagesInCache) {
          const chatId = activeChat.id;
          setTimeout(() => {
            setMessagesInCache(chatId, finalMsgs);
          }, 0);
        }
        return finalMsgs;
      });

      setLoadingMessages(false);
    };

    let unsubscribeMessages = () => {};
    try {
      // Primary query using createdAt ascending
      const q = query(msgsRef, orderBy("createdAt", "asc"));
      unsubscribeMessages = onSnapshot(q, (snapshot) => {
        processMessagesSnapshot(snapshot);
      }, (err) => {
        console.warn("createdAt query notice, fallback to collection listener:", err);
        // Fallback listener for resiliency
        unsubscribeMessages = onSnapshot(msgsRef, (fallbackSnapshot) => {
          processMessagesSnapshot(fallbackSnapshot);
        }, (fallbackErr) => {
          clearTimeout(fallbackTimer);
          console.error("Error listening to messages:", fallbackErr);
          setLoadingMessages(false);
        });
      });
    } catch (err) {
      unsubscribeMessages = onSnapshot(msgsRef, (snapshot) => {
        processMessagesSnapshot(snapshot);
      });
    }

    // 2. Realtime typing indicators inside typingStatus collection (strictly conversation-scoped)
    const currentChatId = activeChat.id;
    const typingDocRef = doc(db, "typingStatus", currentChatId);

    const unsubscribeTyping = onSnapshot(typingDocRef, (snapshot) => {
      // Strictly conversation-scoped: if chat has changed, ignore
      if (activeChatRef.current?.id !== currentChatId) return;

      if (otherTypingTimerRef.current) {
        clearTimeout(otherTypingTimerRef.current);
        otherTypingTimerRef.current = null;
      }

      // Only show typing for the OTHER participant; never current user
      if (!snapshot.exists() || !otherId || otherId === currentUserId) {
        setOtherUserTyping(false);
        return;
      }

      const data = snapshot.data();
      // Check both per-user typing flag and legacy boolean
      const isTypingFlag = data[`${otherId}_typing`] !== undefined
        ? Boolean(data[`${otherId}_typing`])
        : Boolean(data[otherId]);

      if (!isTypingFlag) {
        setOtherUserTyping(false);
        return;
      }

      // Check timestamp to discard stale/ghost typing states from past sessions or crashes
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

      // Stale ghost threshold: 3500ms
      // If timestamp is known and older than 3500ms, it is a ghost from an old or disconnected session!
      if (lastTypedMs > 0 && age >= 3500) {
        setOtherUserTyping(false);
        return;
      }

      // Other user is actively typing right now
      setOtherUserTyping(true);

      // Auto-expire lease: if no new heartbeat arrives within remaining lease window, clear typing automatically
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

      // Immediately reset other user's typing state so it never leaks to the next conversation
      setOtherUserTyping(false);

      // If current user was typing in the conversation we are now leaving, clear our typing in Firestore
      if (isTypingRef.current && currentChatId) {
        isTypingRef.current = false;
        setIsTyping(false);
        updateTypingStatus(false, currentChatId);
      }
    };
  }, [activeChat?.id, activeChat?.isLegacy, currentUserId, updateTypingStatus]);

  // Handle scrolling to paginate and track scroll position
  const handleScroll = () => {
    const container = chatScrollContainerRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distance <= 140;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setTypedMessage(val);
    adjustTextareaHeight();

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

    // 2. Debounce/throttle typing writes: trigger on start, and heartbeat refresh every 1800ms
    const now = Date.now();
    if (!isTypingRef.current || now - lastTypingHeartbeatRef.current >= 1800) {
      isTypingRef.current = true;
      setIsTyping(true);
      lastTypingHeartbeatRef.current = now;
      updateTypingStatus(true);
    }

    // 3. Reset idle timeout: automatically clear typing after 2000ms of inactivity
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      setIsTyping(false);
      updateTypingStatus(false);
    }, 2000);
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

      // Initialize RecordRTC
      const recorder = new RecordRTC(stream, {
        type: "audio",
        mimeType: "audio/wav",
        numberOfAudioChannels: 1,
        recorderType: RecordRTC.StereoAudioRecorder,
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

    const file = new File([recordedBlob], "voice_note.wav", { type: "audio/wav" });
    setIsUploadingVoice(true);
    try {
      const url = await handleCloudinaryUpload(file, "voice_notes");
      handleSendMessage({ audioUrl: url });
      discardDraftRecording();
    } catch (e) {
      console.error("Cloudinary voice note upload failed:", e);
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

  // Secure Unsigned Upload to Cloudinary with safety against oversized Base64 Firestore storage
  const handleCloudinaryUpload = async (file: File, folderKey: string): Promise<string> => {
    const isImage = file.type.startsWith("image/") || folderKey === "image";

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

    // For non-image attachments (e.g. documents)
    const { cloudName, uploadPreset, isConfigured } = getCloudinaryConfig();

    if (!isConfigured) {
      // FileReader Fallback only for offline sandbox previewing
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
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", uploadPreset);
      formData.append("folder", "swap_skill_docs");

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`, true);

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
              resolve(data.secure_url || data.url);
            } catch (_) {
              reject(new Error("Invalid response from Cloudinary"));
            }
          } else {
            reject(new Error(`Cloudinary upload failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error("Network upload error"));
      });

      xhr.send(formData);
      return await uploadPromise;
    } catch (err: any) {
      setUploadProgress((prev) => {
        const copy = { ...prev };
        delete copy[folderKey];
        return copy;
      });
      // CRITICAL: When Cloudinary is configured, reject rather than storing large Base64 in Firestore
      throw new Error(`File upload failed: ${err?.message || "Please check your network and try again"}`);
    }
  };

  // Media Attachment trigger
  const triggerMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "file") => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let uploadFile: File | Blob = file;
      if (type === "image") {
        uploadFile = await optimizeImage(file, {
          type: "other",
          maxWidth: 1200,
          maxHeight: 1200,
          quality: 0.85
        });
      }

      const fileToSend = uploadFile instanceof File 
        ? uploadFile 
        : new File([uploadFile], file.name || "compressed_image.jpg", { type: "image/jpeg" });

      const url = await handleCloudinaryUpload(fileToSend, type);
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
    }
  };

  // SEND MESSAGE HANDLER (Writing symmetrically with Optimistic UI updates and Blocks Safety)
  const handleSendMessage = async (payload: {
    text?: string;
    imageUrl?: string | null;
    audioUrl?: string | null;
    fileUrl?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
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

    // Prepare quote metadata if replying to a message
    let replySnippet = "";
    let replySender = "";
    let replyMedia: "image" | "audio" | "file" | undefined = undefined;
    let replyImageUrl: string | undefined = undefined;

    if (replyToMessage) {
      replySender = replyToMessage.senderId === currentUserId 
        ? "You" 
        : (otherUserProfile?.fullName || otherUserProfile?.username || "Contact");
      if (replyToMessage.imageUrl) {
        replySnippet = "Photo";
        replyMedia = "image";
        replyImageUrl = replyToMessage.imageUrl;
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
      senderId: currentUserId,
      text: payload.text || "",
      createdAt: now,
      timestamp: { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0 } as any,
      status: "sent",
      deleted: false,
      reactions: {},
      pinned: false,
      deletedFor: [],
      ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
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
      if (prev.some(m => m.id === tempId)) return prev;
      const next = [...prev, tempMsg];
      next.sort((a, b) => getMessageTimeMs(a) - getMessageTimeMs(b));
      return next;
    });

    // Pin scroll to bottom immediately upon sending
    isNearBottomRef.current = true;
    scrollToBottom("smooth");

    try {
      const messagesRef = collection(db, collectionName, activeChat.id, "messages");
      
      const newMsgObj: any = {
        senderId: currentUserId,
        text: payload.text || "",
        createdAt: now,
        timestamp: now,
        clientMsgId: tempId,
        status: "sent",
        deleted: false,
        reactions: {},
        pinned: false,
        deletedFor: []
      };

      if (payload.imageUrl) newMsgObj.imageUrl = payload.imageUrl;
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

      // Add to primary collection
      await addDoc(messagesRef, newMsgObj);

      // Set readable parent log text
      let lastMsgText = payload.text || "";
      if (payload.imageUrl) lastMsgText = "Sent an image 📷";
      else if (payload.audioUrl) lastMsgText = "Sent a voice note 🎙️";
      else if (payload.fileUrl) lastMsgText = `Sent a file 📎: ${payload.fileName}`;

      // Update unread balances and meta
      const unreadUpdate = otherId ? {
        [`unreadCount.${otherId}`]: (activeChat.unreadCount?.[otherId] || 0) + 1,
        [`unreadCount.${currentUserId}`]: 0
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
      await updateDoc(parentRef, {
        lastMessage: lastMsgText,
        lastMessageSenderId: currentUserId,
        lastMessageTime: writeNow,
        lastMessageAt: writeNow,
        updatedAt: writeNow,
        ...unreadUpdate,
        ...requestStatusUpdate
      });

      // Notify recipient in background
      if (otherId) {
        try {
          const isReq = (activeChat.requestStatus === "pending" || requestStatusUpdate.requestStatus === "pending") &&
            requestStatusUpdate.requestStatus !== "accepted";
          const notifRef = collection(db, "users", otherId, "notifications");
          await addDoc(notifRef, {
            type: isReq ? "message_request" : "chat",
            senderId: currentUserId,
            senderName: currentUserProfile?.fullName || auth.currentUser?.displayName || "Someone",
            senderPhoto: currentUserProfile?.profilePhotoUrl || currentUserProfile?.photoUrl || "",
            referenceId: activeChat.id,
            chatId: activeChat.id,
            message: isReq
              ? `sent you a message request: "${lastMsgText.substring(0, 50)}"`
              : lastMsgText.substring(0, 70),
            read: false,
            createdAt: writeNow
          });

          // Dispatch background FCM push notification via backend
          let otherPushToken = "";
          try {
            const otherUserDoc = await getDoc(doc(db, "users", otherId));
            if (otherUserDoc.exists()) {
              const oData = otherUserDoc.data();
              otherPushToken = oData?.pushToken || (Array.isArray(oData?.fcmTokens) && oData.fcmTokens[0]) || "";
            }
          } catch (_) {}

          dispatchPushNotification({
            recipientUserId: otherId,
            pushToken: otherPushToken || undefined,
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
            },
          }).catch(() => {});
        } catch (notifErr) {
          // Non-blocking notification
        }
      }

      // Clear states
      setTypedMessage("");
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      isTypingRef.current = false;
      setIsTyping(false);
      updateTypingStatus(false);
    } catch (err) {
      console.error("Error sending message:", err);
      // Rollback optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== tempId));
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
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";
    try {
      const msgRef = doc(db, collectionName, activeChat.id, "messages", editingMessage.id);
      await updateDoc(msgRef, {
        text: typedMessage.trim(),
        isEdited: true
      });
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
    } catch (err) {
      console.error("Error editing message:", err);
    }
  };

  const triggerBurst = (emoji: string, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const id = Math.random().toString(36).substring(2, 11);
    setBursts(prev => [...prev, { id, emoji, x, y }]);
    setTimeout(() => {
      setBursts(prev => prev.filter(b => b.id !== id));
    }, 800);
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
    longPressTimeoutRef.current = setTimeout(() => {
      if (!isHorizontalSwipeRef.current) {
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

    for (const msg of forwardTargetMessages) {
      if (isMessageDeleted(msg)) continue;
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
      if (msg.audioUrl) newMsgObj.audioUrl = msg.audioUrl;
      if (msg.fileUrl) {
        newMsgObj.fileUrl = msg.fileUrl;
        newMsgObj.fileName = msg.fileName || "document";
        newMsgObj.fileSize = msg.fileSize || 0;
      }
      await addDoc(messagesRef, newMsgObj);
    }

    const last = forwardTargetMessages[forwardTargetMessages.length - 1];
    let lastText = last.text || "Forwarded message";
    if (last.imageUrl) lastText = "Sent an image 📷";
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

  // Message reaction toggle
  const handleReactToMessage = async (msgId: string, emoji: string) => {
    if (!activeChat) return;
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";
    try {
      const msgRef = doc(db, collectionName, activeChat.id, "messages", msgId);
      const msgSnap = await getDoc(msgRef);
      if (msgSnap.exists()) {
        const reactions = msgSnap.data().reactions || {};
        const userExisting = reactions[currentUserId];

        let updatedReactions = { ...reactions };
        if (userExisting === emoji) {
          delete updatedReactions[currentUserId];
        } else {
          updatedReactions[currentUserId] = emoji;
        }

        await updateDoc(msgRef, { reactions: updatedReactions });
      }
      setSelectedMsgId(null);
    } catch (err) {
      console.error("Reaction failed:", err);
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
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";
    try {
      const msgRef = doc(db, collectionName, activeChat.id, "messages", msgId);
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
        const chatRef = doc(db, collectionName, activeChat.id);
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
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";
    try {
      const msgRef = doc(db, collectionName, activeChat.id, "messages", msgId);
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
    setShowForwardModal(false);
    try {
      for (const targetChatId of targetChatIds) {
        const targetChat = globalChats.find(c => c.id === targetChatId);
        const isLegacy = targetChat?.isLegacy ?? false;
        const collectionName = isLegacy ? "chats" : "conversations";
        
        for (const msg of forwardTargetMessages) {
          if (isMessageDeleted(msg)) continue;
          const newMsgData: any = {
            senderId: currentUserId,
            timestamp: serverTimestamp(),
            createdAt: serverTimestamp(),
            status: "sent",
            isForwarded: true,
          };
          if (msg.text) newMsgData.text = msg.text;
          if (msg.imageUrl) newMsgData.imageUrl = msg.imageUrl;
          if (msg.audioUrl) newMsgData.audioUrl = msg.audioUrl;
          if (msg.fileUrl) {
            newMsgData.fileUrl = msg.fileUrl;
            newMsgData.fileName = msg.fileName;
            newMsgData.fileSize = msg.fileSize;
          }

          await addDoc(collection(db, collectionName, targetChatId, "messages"), newMsgData);
          
          const lastMsgPreview = msg.text 
            ? `Forwarded: ${msg.text}` 
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
      setToast({ message: `Message${forwardTargetMessages.length > 1 ? "s" : ""} forwarded`, type: "info" });
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
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";
    try {
      const msgRef = doc(db, collectionName, activeChat.id, "messages", msgId);
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
    } catch (e) {
      console.error("Failed to start new conversation:", e);
    }
  };

  // Matched platform users who don't already have an active conversation
  const nonChatSearchResults = useMemo(() => {
    if (!searchQuery.trim() || searchResults.length === 0) return [];
    const existingOtherUserIds = new Set(
      (globalChats as ExtendedChat[]).map(c => c.otherUserId || getOtherParticipantId(c, currentUserId))
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

  // Premium Interactive Soundwave Voice Player
  const AudioNotePlayer = ({ src }: { src: string }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
      const audio = new Audio(src);
      audioRef.current = audio;

      const handleLoadedMetadata = () => setDuration(audio.duration || 10);
      const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
      const handleEnded = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };

      audio.addEventListener("loadedmetadata", handleLoadedMetadata);
      audio.addEventListener("timeupdate", handleTimeUpdate);
      audio.addEventListener("ended", handleEnded);

      return () => {
        audio.pause();
        audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
        audio.removeEventListener("timeupdate", handleTimeUpdate);
        audio.removeEventListener("ended", handleEnded);
      };
    }, [src]);

    const togglePlay = () => {
      if (!audioRef.current) return;
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().catch(e => console.warn("Audio play issue:", e));
        setIsPlaying(true);
      }
    };

    const progressPercent = duration ? (currentTime / duration) * 100 : 0;
    
    // High-fidelity soundwave visual blocks (luxury feeling layout)
    const waveBars = [
      15, 30, 20, 45, 60, 35, 50, 40, 25, 30, 
      45, 55, 30, 40, 20, 35, 50, 65, 45, 30, 
      25, 40, 55, 35, 20, 45, 30, 15, 25, 40
    ];

    const seekTo = (index: number) => {
      if (!audioRef.current || !duration) return;
      const targetTime = (index / waveBars.length) * duration;
      audioRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    };

    return (
      <div className="flex items-center gap-3 bg-theme-bg p-3.5 rounded-[20px] border border-theme-border/60 shadow-inner max-w-xs mt-1 select-none">
        <button 
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-theme-accent flex items-center justify-center text-white hover:opacity-95 hover:scale-105 active:scale-95 transition shadow-gold-glow cursor-pointer"
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <div className="flex-1 flex flex-col gap-1">
          {/* Soundwave Interactive bars */}
          <div className="flex items-end gap-[3px] h-8 w-44 cursor-pointer pb-1">
            {waveBars.map((height, idx) => {
              const isActive = (idx / waveBars.length) * 100 <= progressPercent;
              return (
                <div 
                  key={idx}
                  onClick={() => seekTo(idx)}
                  style={{ height: `${height}%` }}
                  className={`w-[4px] rounded-full transition-colors duration-150 ${
                    isActive ? "bg-theme-accent shadow-gold-glow" : "bg-theme-secondary/30"
                      }`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between items-center text-[9px] text-theme-secondary font-mono px-0.5">
                <span>{Math.floor(currentTime / 60)}:{( "0" + Math.floor(currentTime % 60) ).slice(-2)}</span>
                <span>{Math.floor(duration / 60)}:{( "0" + Math.floor(duration % 60) ).slice(-2)}</span>
              </div>
            </div>
          </div>
        );
      };

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
    <div className="flex flex-1 min-h-0 h-full w-full bg-theme-bg relative text-theme-text overflow-hidden rounded-none">
      
      {/* 1. CHAT LIST / SIDEBAR PANEL */}
      <div className={`w-full md:w-72 lg:w-80 shrink-0 flex flex-col border-r border-theme-border/60 bg-theme-surface h-full ${activeChat ? "hidden md:flex" : "flex"}`}>
        
        {/* Compact Header, Single Search Bar & Small Filter Chips */}
        <div className="flex flex-col border-b border-theme-border/60 bg-theme-surface shrink-0 select-none">
          {/* Header Row */}
          <div className="px-4 pt-[max(env(safe-area-inset-top,0px),14px)] pb-2 flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-theme-text font-display">Chats</h2>
              {totalUnreadMessages > 0 && (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-theme-accent text-white shadow-2xs">
                  {totalUnreadMessages}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5" title="Messenger Active">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs animate-pulse-slow" />
            </div>
          </div>

          {/* Single Compact Search Bar */}
          <div className="px-3.5 pb-2">
            <div className="relative flex items-center">
              <Search className="absolute left-3 w-3.5 h-3.5 text-theme-secondary/70 pointer-events-none" />
              <input
                type="text"
                placeholder="Search conversations"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 bg-theme-bg border border-theme-border/70 rounded-xl text-xs text-theme-text placeholder:text-theme-secondary/60 outline-none focus:border-theme-accent focus:ring-1 focus:ring-theme-accent/20 transition"
              />
              {searchQuery.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 p-0.5 text-theme-secondary hover:text-theme-text transition cursor-pointer"
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Small Horizontally Scrollable Filter Chips */}
          <div className="flex items-center gap-1.5 px-3.5 pb-2.5 overflow-x-auto no-scrollbar">
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
                  className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-full transition-all duration-150 cursor-pointer shrink-0 whitespace-nowrap ${
                    isSelected
                      ? "bg-[#141417] text-white dark:bg-[#F2EFE8] dark:text-[#141417] shadow-xs"
                      : "bg-theme-bg text-theme-secondary hover:text-theme-text border border-theme-border/60 hover:bg-theme-border/30"
                  }`}
                >
                  <span>{chip.label}</span>
                  {chip.count !== undefined && chip.count > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                        isSelected
                          ? "bg-white/20 text-white dark:bg-black/20 dark:text-black"
                          : "bg-theme-accent/15 text-theme-accent"
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

        {/* Message Requests Navigation Banner (Instagram Style) */}
        {!showRequestsView && messageRequests.length > 0 && (
          <button
            onClick={() => setShowRequestsView(true)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 bg-theme-bg/60 hover:bg-theme-bg border-b border-theme-border/50 transition cursor-pointer group select-none shrink-0"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-theme-accent/15 border border-theme-accent/30 flex items-center justify-center text-theme-accent relative shrink-0">
                <Inbox size={15} />
                {unreadRequestsCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-theme-surface animate-pulse" />
                )}
              </div>
              <div className="text-left truncate">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-theme-text group-hover:text-theme-accent transition-colors">
                    Message Requests
                  </span>
                  {unreadRequestsCount > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-rose-500 text-white">
                      {unreadRequestsCount} new
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-theme-secondary truncate">
                  {messageRequests.length} pending request{messageRequests.length > 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <ChevronRight size={15} className="text-theme-secondary group-hover:text-theme-text transition shrink-0 ml-2" />
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
            <div className="flex-1 overflow-y-auto divide-y divide-theme-border/40">
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
            </div>
          </div>
        ) : (
          /* Conversations List */
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-theme-border/40">
            {filteredChats.length === 0 && nonChatSearchResults.length === 0 && !searchingUsers ? (
              <div className="h-48 flex flex-col items-center justify-center p-6 text-center text-theme-secondary select-none">
                <Info className="w-7 h-7 text-theme-border mb-2 opacity-60" />
                <p className="text-xs font-medium text-theme-text">
                  {searchQuery.trim()
                    ? `No conversations found for "${searchQuery}"`
                    : chatFilterText === "Unread"
                    ? "No unread messages"
                    : chatFilterText === "Pinned"
                    ? "No pinned conversations"
                    : chatFilterText === "Archived"
                    ? "No archived conversations"
                    : "No conversations yet"}
                </p>
                <p className="text-[10px] text-theme-secondary/70 mt-1">
                  {searchQuery.trim()
                    ? "Try searching another name or skill"
                    : "Connect with skill partners to start messaging"}
                </p>
              </div>
            ) : (
              <>
                {filteredChats.map((c) => {
                  const otherId = c.otherUserId || getOtherParticipantId(c, currentUserId);
                  const otherUserObj = resolveOtherUserProfile(otherId, c, profilesCache, chatProfiles);
                  const isPinned = c.pinnedUsers?.includes(currentUserId);
                  const unread = c.unreadCount?.[currentUserId] || 0;
                  const isActive = activeChat?.id === c.id;
                  const isOutgoingPending = c.requestStatus === "pending" && c.requestedBy === currentUserId;
                  const isOtherOnline = Boolean(otherId && otherUserPresence?.userId === otherId && otherUserPresence?.status === "online");
                  const isOtherTyping = Boolean(isActive && otherUserTyping && otherId && otherId !== currentUserId);

                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setActiveChat(c);
                        if (onChatSelect) onChatSelect(c.id);
                      }}
                      className={`group flex items-center gap-3 px-3.5 py-3 hover:bg-theme-bg/60 active:bg-theme-bg/80 transition-all duration-150 cursor-pointer relative select-none border-l-[3px] ${
                        isActive ? "bg-theme-bg/90 border-theme-accent" : "border-transparent"
                      }`}
                    >
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <SmartImage 
                          src={otherUserObj?.photoUrl || otherUserObj?.profilePhotoUrl} 
                          alt={otherUserObj?.fullName || "Chat"} 
                          className="w-11 h-11 rounded-full border border-theme-border/60 object-cover shadow-2xs shrink-0" 
                          fallbackType="profile" 
                          fullName={otherUserObj?.fullName} 
                        />
                        {/* Presence Indicator */}
                        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-theme-surface ${
                          isOtherTyping ? "bg-blue-500 animate-pulse" :
                          isOtherOnline ? "bg-emerald-500 shadow-2xs" : "bg-zinc-400"
                        }`} />
                      </div>

                      {/* Content Preview */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 truncate">
                            <p className={`text-[13.5px] truncate ${unread > 0 ? "font-bold text-theme-text" : "font-semibold text-theme-text"}`}>
                              {otherUserObj?.fullName || "User"}
                            </p>
                            {isOutgoingPending && (
                              <span className="px-1.5 py-0.2 rounded-md bg-amber-500/15 text-amber-600 text-[9px] font-semibold shrink-0">
                                Pending
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-theme-secondary/80 font-mono shrink-0">
                            {formatChatTimestamp(c.lastMessageAt || c.lastMessageTime || c.updatedAt)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between mt-0.5 gap-2">
                          {isOtherTyping ? (
                            <p className="text-xs text-theme-accent font-medium animate-pulse flex items-center gap-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-theme-accent animate-bounce" />
                              <span>Typing...</span>
                            </p>
                          ) : (
                            <p className={`text-xs truncate max-w-[185px] sm:max-w-[210px] ${unread > 0 ? "text-theme-text font-medium" : "text-theme-secondary"}`}>
                              {c.lastMessage || "Started a conversation"}
                            </p>
                          )}

                          <div className="flex items-center gap-1.5 shrink-0">
                            {onStartCall && otherId && (
                              <div className="flex items-center gap-0.5 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const target = otherUserObj || ({
                                      uid: otherId,
                                      id: otherId,
                                      fullName: otherUserObj?.fullName || (c as any).otherUserName || "Contact",
                                      photoUrl: otherUserObj?.photoUrl || (c as any).otherUserPhoto || "",
                                      photoURL: otherUserObj?.photoUrl || (c as any).otherUserPhoto || "",
                                    } as unknown as UserProfile);
                                    onStartCall(target, "audio", c.id);
                                  }}
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-theme-secondary hover:text-[#D4AF37] hover:bg-theme-border/40 transition cursor-pointer"
                                  title="Voice call"
                                  aria-label="Voice call"
                                >
                                  <Phone size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const target = otherUserObj || ({
                                      uid: otherId,
                                      id: otherId,
                                      fullName: otherUserObj?.fullName || (c as any).otherUserName || "Contact",
                                      photoUrl: otherUserObj?.photoUrl || (c as any).otherUserPhoto || "",
                                      photoURL: otherUserObj?.photoUrl || (c as any).otherUserPhoto || "",
                                    } as unknown as UserProfile);
                                    onStartCall(target, "video", c.id);
                                  }}
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-theme-secondary hover:text-[#D4AF37] hover:bg-theme-border/40 transition cursor-pointer"
                                  title="Video call"
                                  aria-label="Video call"
                                >
                                  <Video size={14} />
                                </button>
                              </div>
                            )}
                            {isPinned && <Pin size={11} className="text-theme-accent shrink-0 rotate-45" />}
                            {unread > 0 && (
                              <span className="px-1.5 py-0.5 text-[10px] bg-theme-accent text-white font-bold rounded-full min-w-[18px] text-center shadow-2xs">
                                {unread}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Platform search matches when searching new contacts */}
                {searchQuery.trim().length > 0 && nonChatSearchResults.length > 0 && (
                  <div className="p-2.5 bg-theme-surface border-t border-theme-border/60">
                    <div className="text-[10px] uppercase tracking-wider text-theme-secondary font-mono px-1 py-1 flex items-center justify-between">
                      <span>Start new conversation</span>
                      {searchingUsers && <Loader2 className="w-3 h-3 animate-spin text-theme-accent" />}
                    </div>
                    <div className="flex flex-col gap-1 mt-1">
                      {nonChatSearchResults.map((u) => (
                        <div 
                          key={u.uid}
                          onClick={() => handleCreateNewConversation(u)}
                          className="flex items-center gap-2.5 p-2 hover:bg-theme-bg rounded-xl transition cursor-pointer"
                        >
                          <SmartImage 
                            src={u.photoUrl || u.profilePhotoUrl} 
                            alt={u.fullName} 
                            className="w-9 h-9 rounded-full border border-theme-border object-cover shrink-0" 
                            fallbackType="profile" 
                            fullName={u.fullName} 
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate text-theme-text">{u.fullName}</p>
                            <p className="text-[10px] text-theme-secondary truncate font-mono">@{u.username}</p>
                          </div>
                          <span className="text-[10px] font-bold text-theme-accent bg-theme-accent/10 px-2 py-0.5 rounded-lg shrink-0">
                            Chat
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* 2. CHAT AREA WINDOW */}
      <div 
        id="chat-area-window"
        style={{
          paddingBottom: keyboardInset > 0 ? `${keyboardInset}px` : undefined,
        }}
        className={`flex-1 flex flex-col w-full h-full min-h-0 bg-theme-bg relative overflow-hidden ${!activeChat ? "hidden md:flex" : "flex"}`}
      >
        {activeChat ? (
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
                activeChat={activeChat}
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
              />
            )}

            {/* In-Chat Search Drawer */}
            {showSearchInChat && (
              <div className="flex-none bg-theme-surface border-b border-theme-border p-2 flex items-center justify-between gap-2.5 relative z-10 animate-fade-in">
                <div className="relative flex-1">
                  <SearchIcon className="absolute left-3 top-2.5 w-3.5 h-3.5 text-theme-secondary" />
                  <input
                    type="text"
                    placeholder="Search inside this conversation..."
                    value={searchInChatText}
                    onChange={(e) => setSearchInChatText(e.target.value)}
                    className="w-full pl-9 pr-4 py-1.5 bg-theme-bg border border-theme-border rounded-xl text-xs outline-none focus:border-theme-accent transition"
                  />
                </div>
                <button 
                  onClick={() => {
                    setSearchInChatText("");
                    setShowSearchInChat(false);
                  }}
                  className="p-1.5 bg-theme-bg hover:bg-theme-border rounded-xl text-theme-secondary transition"
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

            {/* Scrollable Messages Panel */}
            <div 
              ref={chatScrollContainerRef}
              onScroll={handleScroll}
                onTouchStart={() => {
                  userInteractingRef.current = true;
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
                  if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
                  interactionTimerRef.current = setTimeout(() => {
                    userInteractingRef.current = false;
                  }, 400);
                }}
                style={{ overflowAnchor: "none" }}
                className="flex-1 overflow-y-auto min-h-0 px-3.5 pt-2 pb-6 flex flex-col bg-theme-bg w-full max-w-full overflow-x-hidden overscroll-y-contain"
              >
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
                chatMessagesFiltered.map((m, index) => {
                  const isSelf = m.senderId === currentUserId;
                  const isDeleted = isMessageDeleted(m);
                  const isSelected = selectedMsgIds.has(m.id);
                  const isSwiping = swipingMsgId === m.id;
                  const isHighlighted = highlightedMsgId === m.id;
                  const showReactionsPalette = selectedMsgId === m.id;

                  const prevMsg = index > 0 ? chatMessagesFiltered[index - 1] : null;
                  const isSameSender = prevMsg ? prevMsg.senderId === m.senderId : false;
                  const marginClass = isSameSender ? "mt-[3px]" : "mt-2.5";

                  return (
                    <motion.div 
                      key={m.id}
                      initial={{ opacity: 0, y: 10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      onClick={() => {
                        if (selectedMsgIds.size > 0) {
                          handleToggleSelect(m.id);
                        }
                      }}
                      className={`flex items-center w-full transition-colors ${
                        isSelected ? "bg-[#D4AF37]/10 -mx-4 px-4 py-1 rounded-lg" : ""
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
                      <div className={`flex flex-col relative max-w-[82%] sm:max-w-[72%] min-w-0 ${isSelf ? "items-end" : "items-start"}`}>
                        
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

                        <div className="group relative flex items-center gap-1.5 max-w-full">
                          
                          {/* Desktop/Web Hover Action Triggers (Self) */}
                          {isSelf && !isDeleted && selectedMsgIds.size === 0 && (
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition select-none mr-1 shrink-0">
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
                            style={{
                              transform: isSwiping ? `translateX(${swipeOffset}px)` : "translateX(0px)",
                              transition: isSwiping && isHorizontalSwipeRef.current ? "none" : "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)"
                            }}
                            className={`px-[13px] py-[8px] relative break-words leading-[1.38] text-[13.5px] font-normal shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-150 select-text max-w-full ${
                              isHighlighted ? "ring-2 ring-[#D4AF37] ring-offset-2 ring-offset-theme-bg animate-pulse" : ""
                            } ${
                              isDeleted
                                ? "bg-theme-surface/50 text-theme-secondary border border-dashed border-theme-border/70 italic rounded-[18px]"
                                : isSelf 
                                  ? "bg-[var(--chat-bubble-self-bg)] text-[var(--chat-bubble-self-text)] " + (isSameSender ? "rounded-[18px]" : "rounded-[18px] rounded-br-[4px]") 
                                  : "bg-[var(--chat-bubble-other-bg)] text-[var(--chat-bubble-other-text)] border border-theme-border/10 " + (isSameSender ? "rounded-[18px]" : "rounded-[18px] rounded-bl-[4px]")
                            } ${!isDeleted && m.reactions && Object.keys(m.reactions).length > 0 ? "mb-3.5" : ""}`}
                          >
                            
                            {/* Forwarded Tag */}
                            {m.isForwarded && !isDeleted && (
                              <div className="flex items-center gap-1 text-[10px] text-zinc-400 italic mb-1 select-none">
                                <Forward size={11} className="shrink-0" />
                                <span>Forwarded</span>
                              </div>
                            )}

                            {/* WhatsApp style Quoted Reply Anchor */}
                            {m.replyToId && !isDeleted && (
                              <div 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleScrollToMessage(m.replyToId!);
                                }}
                                className={`mb-1.5 -mx-1 px-2.5 py-1.5 rounded-lg border-l-[3px] border-[#D4AF37] cursor-pointer transition select-none flex flex-col gap-0.5 text-left ${
                                  isSelf 
                                    ? "bg-black/10 hover:bg-black/15 text-white" 
                                    : "bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-theme-text"
                                }`}
                              >
                                <div className="flex items-center gap-1 text-[10.5px] font-semibold text-[#D4AF37]">
                                  <Reply size={10} className="shrink-0" />
                                  <span className="truncate">{m.replyToSenderName || (m.senderId === currentUserId ? "You" : (otherUserProfile?.fullName || "Contact"))}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] opacity-80 truncate font-normal">
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
                                        ? "bg-rose-500/15 text-rose-500"
                                        : "bg-emerald-500/15 text-emerald-500"
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
                                      <div className="text-[13px] font-semibold text-theme-text leading-tight truncate">
                                        {isVideo ? "Video call" : "Voice call"}
                                      </div>
                                      <div className="text-[11px] text-theme-secondary mt-0.5 flex items-center gap-1.5 leading-none">
                                        {isMissed ? (
                                          <span className="text-rose-500 font-medium">Missed</span>
                                        ) : isDeclined ? (
                                          <span className="text-rose-400 font-medium">Declined</span>
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
                                        className="p-1.5 rounded-full hover:bg-white/10 active:scale-95 text-theme-secondary hover:text-theme-text transition shrink-0 cursor-pointer"
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
                                {/* Image Attachment */}
                                {m.imageUrl && (
                                  <div 
                                    className="max-w-[220px] max-h-[220px] rounded-xl overflow-hidden mb-1.5 cursor-pointer border border-white/5 shadow-sm transition hover:scale-[1.01]" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFullscreenImage(m.imageUrl || null);
                                    }}
                                  >
                                    <SmartImage src={m.imageUrl} alt="attachment" className="w-full h-full object-cover" fallbackType="cover" sizeType="standard" />
                                  </div>
                                )}

                                {/* Audio Voice Note */}
                                {m.audioUrl && (
                                  <AudioNotePlayer src={m.audioUrl} />
                                )}

                                {/* File Document Attachment */}
                                {m.fileUrl && (
                                  <div className="flex items-center gap-2.5 bg-theme-bg/60 p-2 rounded-xl border border-theme-border/40 mt-1">
                                    <FileText size={16} className="text-theme-accent shrink-0" />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[11px] font-semibold truncate text-theme-text">{m.fileName || "attachment"}</p>
                                      <p className="text-[9px] text-theme-secondary font-mono mt-0.5">{( (m.fileSize || 0) / 1024 ).toFixed(1)} KB</p>
                                    </div>
                                    <a 
                                      href={sanitizeUrl(m.fileUrl)} 
                                      download={m.fileName || "attachment"} 
                                      target="_blank" 
                                      rel="noopener noreferrer" 
                                      onClick={(e) => e.stopPropagation()}
                                      className="p-1 hover:bg-theme-border rounded-lg text-theme-secondary transition shrink-0"
                                    >
                                      <Download size={12} />
                                    </a>
                                  </div>
                                )}

                                {/* Message text */}
                                {m.text && (
                                  <p className="font-normal whitespace-pre-wrap text-[13.5px] leading-[1.38] break-words [overflow-wrap:anywhere] min-w-0">{m.text}</p>
                                )}
                              </>
                            )}

                            {/* Message Footer stats indicator */}
                            <div className={`flex items-center justify-end gap-1 mt-1 text-[9px] select-none font-sans font-medium tracking-wide ${
                              isSelf ? "text-[#090909]/50 dark:text-white/60" : "text-zinc-400/70"
                            }`}>
                              {m.isEdited && !isDeleted && (
                                <span className="text-[8px] uppercase tracking-wider font-semibold opacity-75 mr-0.5 font-mono">Edited</span>
                              )}
                              <span>{formatMsgTime(m.createdAt || m.timestamp)}</span>
                              {isSelf && (
                                <span className="flex items-center shrink-0 ml-0.5">
                                  {m.id.startsWith("optimistic_") ? (
                                    <Clock size={10} className="text-zinc-400 animate-spin" />
                                  ) : m.status === "seen" ? (
                                    <CheckCheck size={11} className="text-blue-500" />
                                  ) : m.status === "delivered" ? (
                                    <CheckCheck size={11} className="text-[#090909]/55 dark:text-white/55" />
                                  ) : (
                                    <Check size={11} className="text-[#090909]/40 dark:text-white/40" />
                                  )}
                                </span>
                              )}
                            </div>

                            {/* Active Message Reactions tags */}
                            {!isDeleted && m.reactions && Object.keys(m.reactions).length > 0 && (() => {
                              const grouped = {} as Record<string, { count: number; users: string[] }>;
                              (Object.entries(m.reactions) as [string, string][]).forEach(([userId, emoji]) => {
                                if (!grouped[emoji]) {
                                  grouped[emoji] = { count: 0, users: [] };
                                }
                                grouped[emoji].count += 1;
                                grouped[emoji].users.push(userId);
                              });

                              return (
                                <div className={`absolute -bottom-3 ${isSelf ? "right-2" : "left-2"} flex flex-wrap gap-1 z-20 pointer-events-auto`}>
                                  {Object.entries(grouped).map(([emoji, data]) => {
                                    const hasReacted = m.reactions?.[currentUserId] === emoji;
                                    const isPopupOpen = activeReactionInfo?.msgId === m.id && activeReactionInfo?.emoji === emoji;
                                    return (
                                      <div key={emoji} className="relative select-none">
                                        <motion.button
                                          whileHover={{ scale: 1.08 }}
                                          whileTap={{ scale: 0.95 }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (isPopupOpen) {
                                              setActiveReactionInfo(null);
                                            } else {
                                              setActiveReactionInfo({ msgId: m.id, emoji });
                                            }
                                          }}
                                          className={`h-5 px-1.5 rounded-full flex items-center gap-1 text-[10px] transition-all duration-150 border cursor-pointer shadow-md ${
                                            hasReacted 
                                              ? "bg-[#D4AF37]/15 border-[#D4AF37]/50 text-[#D4AF37]" 
                                              : "bg-theme-surface border-theme-border hover:border-zinc-400 text-theme-text"
                                          }`}
                                        >
                                          <span className="scale-105">{emoji}</span>
                                          <span className="font-bold font-mono text-[9px]">{data.count}</span>
                                        </motion.button>

                                        {/* Micro Popover */}
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
                                                initial={{ opacity: 0, scale: 0.9, y: 6 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.9, y: 6 }}
                                                transition={{ type: "spring", stiffness: 400, damping: 20 }}
                                                className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-50 bg-[#0c0c0e]/95 backdrop-blur-md border border-white/10 rounded-[14px] p-2.5 shadow-[0_4px_20px_rgba(0,0,0,0.6)] min-w-[125px] text-left max-w-[200px]"
                                                onClick={(ev) => ev.stopPropagation()}
                                              >
                                                <div className="text-[9px] font-bold text-[#D4AF37] uppercase tracking-wider mb-1 px-1">
                                                  Liked by
                                                </div>
                                                <div className="flex flex-col gap-0.5 max-h-[100px] overflow-y-auto scrollbar-none">
                                                  {data.users.map((userId) => {
                                                    const isCurrentUser = userId === currentUserId;
                                                    const userName = isCurrentUser 
                                                      ? "You" 
                                                      : (otherUserProfile?.fullName || "Participant");
                                                    return (
                                                      <div key={userId} className="flex items-center gap-1.5 py-0.5 px-1 rounded-md text-[11px] text-zinc-300">
                                                        <span className="text-[12px]">{emoji}</span>
                                                        <span className="truncate">{userName}</span>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                                <button
                                                  onClick={(ev) => {
                                                    ev.stopPropagation();
                                                    handleReactToMessage(m.id, emoji);
                                                    setActiveReactionInfo(null);
                                                  }}
                                                  className="w-full mt-1.5 pt-1.5 border-t border-white/10 text-[10px] text-center text-[#D4AF37] hover:underline font-medium cursor-pointer"
                                                >
                                                  {hasReacted ? "Remove Reaction" : "React Too"}
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
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition select-none ml-1 shrink-0">
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
                    </motion.div>
                  );
                })
              )}
              </LoadingTransition>

              <div ref={messagesEndRef} className="h-px w-full shrink-0 pointer-events-none opacity-0" aria-hidden="true" style={{ overflowAnchor: "none" }} />
            </div>

            {/* Bottom Typing Indicator (Takes real layout space above composer, never overlays messages) */}
            <AnimatePresence>
              {otherUserTyping && (
                <motion.div 
                  key="bottom-typing-indicator"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="flex-none px-3.5 sm:px-4 py-1.5 overflow-hidden flex items-center bg-theme-bg select-none"
                >
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-theme-surface/95 dark:bg-[#1C1C20]/95 backdrop-blur-md border border-theme-border/60 text-theme-secondary shadow-xs">
                    <div className="flex gap-1 items-center h-3 shrink-0">
                      <motion.span 
                        animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0, ease: "easeInOut" }}
                        className="w-1.5 h-1.5 rounded-full bg-emerald-500" 
                      />
                      <motion.span 
                        animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0.15, ease: "easeInOut" }}
                        className="w-1.5 h-1.5 rounded-full bg-emerald-500" 
                      />
                      <motion.span 
                        animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0.3, ease: "easeInOut" }}
                        className="w-1.5 h-1.5 rounded-full bg-emerald-500" 
                      />
                    </div>
                    <span className="text-[11px] font-medium text-theme-secondary/90 lowercase italic tracking-tight">typing...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* In-app Reply banner preview (Strict maximum 36px height, completely removed when null) */}
            {replyToMessage && (
              <div className="flex-none h-9 min-h-[36px] max-h-[36px] px-3 border-t border-theme-border bg-theme-surface flex items-center justify-between gap-3 shrink-0 select-none animate-slide-up">
                <div className="flex items-center gap-1.5 text-xs min-w-0">
                  <Reply size={13} className="text-theme-accent shrink-0" />
                  <span className="text-theme-secondary shrink-0 font-medium font-mono uppercase text-[9px] tracking-wide">Replying:</span>
                  <p className="truncate text-theme-text font-light text-[11px]">"{replyToMessage.text || "[Attachment]"}"</p>
                </div>
                <button 
                  onClick={() => setReplyToMessage(null)}
                  className="p-1 hover:bg-theme-bg rounded-lg text-theme-secondary transition cursor-pointer"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            {/* In-app Edits banner preview */}
            {editingMessage && (
              <div className="flex-none h-9 min-h-[36px] max-h-[36px] px-3 border-t border-theme-border bg-theme-surface flex items-center justify-between gap-3 shrink-0 select-none animate-slide-up">
                <div className="flex items-center gap-1.5 text-xs min-w-0">
                  <Edit3 size={13} className="text-theme-accent shrink-0" />
                  <span className="text-theme-secondary shrink-0 font-medium font-mono uppercase text-[9px] tracking-wide">Editing:</span>
                  <p className="truncate text-theme-text font-light text-[11px]">"{editingMessage.text}"</p>
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
              <div key={key} className="flex-none px-4 py-2.5 bg-gray-100 border-t border-gray-200 text-xs flex items-center justify-between gap-3 select-none backdrop-blur-md animate-fade-in">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  </div>
                  <span className="font-semibold text-gray-800 tracking-tight">Uploading...</span>
                </div>
                <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden relative border border-gray-300">
                  <div className="absolute inset-0 bg-blue-600 animate-pulse" />
                </div>
              </div>
            ))}

            {/* Live voice recording active mic ribbon */}
            {isRecording && (
              <div className="flex-none h-[56px] min-h-[56px] max-h-[56px] px-3 bg-theme-surface border-t border-theme-border/60 flex items-center justify-between gap-3 animate-slide-up select-none">
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
              <div className="flex-none h-[56px] min-h-[56px] max-h-[56px] px-3 bg-theme-surface border-t border-theme-border/60 flex items-center justify-between gap-3 animate-slide-up select-none">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  {/* Play/Pause Button */}
                  <button 
                    onClick={togglePlayDraft}
                    className="w-8 h-8 rounded-full bg-theme-accent flex items-center justify-center text-white hover:opacity-95 transition shrink-0 cursor-pointer shadow-gold-glow"
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
                      className="h-full bg-theme-accent" 
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
                    className="py-1.5 px-3.5 bg-theme-accent hover:opacity-95 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1 shadow-gold-glow disabled:opacity-50"
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
              <div className="flex-none px-4 py-2.5 bg-zinc-900/90 border-t border-white/10 text-xs flex items-center justify-between gap-3 select-none backdrop-blur-md animate-fade-in">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  <span className="font-semibold text-zinc-200 tracking-tight">Uploading...</span>
                </div>
                <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden relative border border-white/5">
                  <div className="absolute inset-0 bg-gradient-to-r from-amber-500 via-amber-300 to-amber-500 animate-pulse" />
                </div>
              </div>
            )}

            {/* INPUT CONTROLS FOOTER OR REQUEST DECISION BAR */}
            {!isRecording && !previewAudioUrl && !isUploadingVoice && (
              activeChat.otherUserId && (blockedUsers.includes(activeChat.otherUserId) || blockedByUsers.includes(activeChat.otherUserId)) ? (
                <div className="flex-none h-[56px] min-h-[56px] max-h-[56px] border-t border-theme-border/60 bg-theme-surface/95 flex items-center justify-center text-center text-[10px] font-bold text-red-500 bg-red-500/5 select-none font-mono tracking-widest uppercase animate-slide-up">
                  <Lock size={12} className="mr-1.5 text-red-500 shrink-0" />
                  Messaging is restricted due to active block state
                </div>
              ) : (activeChat.requestStatus === "pending" || activeChat.isRequest === true) && (activeChat.requestedTo === currentUserId || (activeChat.requestedBy && activeChat.requestedBy !== currentUserId)) ? (
                /* INSTAGRAM-STYLE REQUEST DECISION FOOTER */
                <div className="flex-none p-4 border-t border-theme-border bg-theme-surface/95 backdrop-blur-md shadow-lg select-none animate-slide-up">
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
                      onClick={() => handleDeleteRequest(activeChat.id)}
                      className="flex-1 h-9 px-3 rounded-xl border border-theme-border bg-theme-bg hover:bg-theme-border text-theme-secondary hover:text-theme-text text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95"
                    >
                      <Trash2 size={13} />
                      <span>Delete</span>
                    </button>
                    {/* Accept */}
                    <button
                      onClick={() => handleAcceptRequest(activeChat.id)}
                      className="flex-1 h-9 px-3 rounded-xl bg-theme-accent hover:opacity-95 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-gold-glow active:scale-95"
                    >
                      <Check size={14} />
                      <span>Accept</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div 
                  style={{
                    paddingBottom: isKeyboardOpen ? "8px" : "max(env(safe-area-inset-bottom, 0px), 12px)"
                  }}
                  className="flex-none shrink-0 w-full min-h-[54px] sm:min-h-[60px] pt-2 px-2.5 sm:px-4 border-t border-theme-border/60 bg-theme-surface/95 backdrop-blur-md flex items-end gap-1.5 sm:gap-2 select-none transition-[padding-bottom] duration-150"
                >
                  {/* Clean rounded input bar */}
                  <div className="flex-1 relative flex items-end min-h-[40px] sm:min-h-[42px] bg-theme-bg border border-theme-border/70 focus-within:border-[#D4AF37] focus-within:ring-1 focus-within:ring-[#D4AF37]/20 rounded-[22px] px-1.5 sm:px-2 py-1 transition-all duration-150">
                    
                    {/* Attachment trigger actions on left */}
                    <div className="flex items-center gap-0.5 pb-0.5 shrink-0">
                      {/* Image / Gallery Upload */}
                      <label 
                        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-theme-surface text-theme-secondary hover:text-theme-text transition-colors cursor-pointer flex items-center justify-center" 
                        title="Attach Image"
                        aria-label="Attach Image"
                      >
                        <ImageIcon size={17} />
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => triggerMediaUpload(e, "image")} />
                      </label>
                      
                      {/* File / Document Upload */}
                      <label 
                        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-theme-surface text-theme-secondary hover:text-theme-text transition-colors cursor-pointer flex items-center justify-center" 
                        title="Attach Document"
                        aria-label="Attach Document"
                      >
                        <Paperclip size={17} />
                        <input type="file" accept="*" className="hidden" onChange={(e) => triggerMediaUpload(e, "file")} />
                      </label>
                    </div>

                    {/* Auto-growing Textarea */}
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      placeholder={editingMessage ? "Edit message..." : "Message..."}
                      value={typedMessage}
                      onChange={handleInputChange}
                      onFocus={() => {
                        if (window.scrollY !== 0) {
                          window.scrollTo(0, 0);
                        }
                        if (isNearBottomRef.current) {
                          scrollToBottom("auto");
                          requestAnimationFrame(() => {
                            if (isNearBottomRef.current) {
                              scrollToBottom("auto");
                            }
                          });
                          setTimeout(() => {
                            if (isNearBottomRef.current) {
                              scrollToBottom("auto");
                            }
                          }, 250);
                        }
                      }}
                      onKeyDown={(e) => {
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
                      className="flex-1 max-h-[110px] py-1.5 px-2 bg-transparent outline-none text-[16px] md:text-[14px] text-theme-text placeholder:text-theme-secondary/50 transition-all duration-150 overflow-y-auto scrollbar-none leading-[1.4]"
                    />

                    {/* Right side inline camera button (when input is empty) */}
                    {typedMessage.trim().length === 0 && (
                      <button 
                        type="button"
                        onClick={openCamera}
                        className="w-7 h-7 sm:w-8 sm:h-8 pb-0.5 rounded-full hover:bg-theme-surface text-theme-secondary hover:text-theme-text transition-colors cursor-pointer flex items-center justify-center shrink-0" 
                        title="Open Camera"
                        aria-label="Open Camera"
                      >
                        <Camera size={17} />
                      </button>
                    )}
                  </div>
 
                  {/* Action button: Send or Voice Record */}
                  <div className="pb-0.5 shrink-0 flex items-center justify-center">
                    <AnimatePresence mode="wait">
                      {typedMessage.trim().length > 0 ? (
                        <motion.button
                          key="send"
                          type="button"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.12 }}
                          whileTap={{ scale: 0.92 }}
                          onClick={() => {
                            if (editingMessage) {
                              handleEditMessageSubmit();
                            } else {
                              handleSendMessage({ text: typedMessage.trim() });
                            }
                          }}
                          className="w-[38px] h-[38px] sm:w-[42px] sm:h-[42px] rounded-full bg-[#141417] text-white dark:bg-[#F2EFE8] dark:text-[#141417] border border-[#D4AF37]/40 flex items-center justify-center cursor-pointer shadow-sm hover:opacity-95 active:scale-95 transition-transform"
                          title="Send Message"
                          aria-label="Send Message"
                        >
                          <Send size={15} className="ml-0.5 text-[#D4AF37]" />
                        </motion.button>
                      ) : (
                        <motion.button
                          key="mic"
                          type="button"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.12 }}
                          whileTap={{ scale: 0.92 }}
                          onClick={startRecording}
                          className="w-[38px] h-[38px] sm:w-[42px] sm:h-[42px] rounded-full bg-theme-surface hover:bg-theme-border/40 text-theme-text border border-theme-border/80 flex items-center justify-center cursor-pointer shadow-2xs hover:text-[#D4AF37] active:scale-95 transition-colors"
                          title="Record Voice Note"
                          aria-label="Record Voice Note"
                        >
                          <Mic size={17} />
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-theme-secondary select-none">
            <Lock className="w-12 h-12 text-theme-border mb-3" />
            <h2 className="text-lg font-bold tracking-tight text-theme-text font-display">Your Secure Inbox</h2>
            <p className="text-xs text-theme-secondary max-w-xs mt-1.5 leading-relaxed font-light">Choose an existing conversation from the sidebar or type a member's name into the search bar above to launch a new cryptographically secure chat.</p>
          </div>
        )}
      </div>



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
              <img src={fullscreenImage} alt="fullscreen attachment" className="w-full h-full object-contain max-h-[75vh]" referrerPolicy="no-referrer" />
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

      {/* 6. HARDWARE CAMERA CAPTURE OVERLAY */}
      <AnimatePresence>
        {showCamera && (
          <div className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 z-50">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-gray-200 rounded-3xl p-6 w-full max-w-md shadow-2xl relative flex flex-col items-center"
            >
              <button 
                onClick={closeCamera}
                className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-900 transition cursor-pointer"
              >
                <X size={18} />
              </button>

              <h3 className="text-sm font-bold text-gray-900 mb-4 tracking-wide font-display">Capture Secure Media</h3>

              <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden border border-zinc-800 relative shadow-inner mb-6">
                <video 
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex justify-center gap-4 w-full">
                <button 
                  onClick={closeCamera}
                  className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 text-xs font-semibold rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={capturePhoto}
                  className="px-5 py-2 bg-theme-accent hover:opacity-95 text-white text-xs font-semibold rounded-xl transition cursor-pointer shadow-gold-glow"
                >
                  Capture Photo
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Dynamic Particle Bursts for Emoji reactions */}
      <div className="fixed inset-0 pointer-events-none z-[110] overflow-hidden">
        {bursts.map(b => (
          <div key={b.id} className="absolute pointer-events-none" style={{ left: b.x, top: b.y }}>
            {[...Array(6)].map((_, i) => {
              const angle = (i * 360) / 6;
              const rad = (angle * Math.PI) / 180;
              const tx = Math.cos(rad) * 45;
              const ty = Math.sin(rad) * 45;
              return (
                <motion.span
                  key={i}
                  initial={{ scale: 0.2, opacity: 1, x: 0, y: 0 }}
                  animate={{ scale: [0.2, 1.2, 0], opacity: [1, 1, 0], x: tx, y: ty }}
                  transition={{ duration: 0.65, ease: "easeOut" }}
                  className="absolute text-sm select-none pointer-events-none"
                >
                  {b.emoji}
                </motion.span>
              );
            })}
          </div>
        ))}
      </div>

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
        onReact={(emoji) => {
          if (selectedMsgId) {
            handleReactToMessage(selectedMsgId, emoji);
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
