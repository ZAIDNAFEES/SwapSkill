import React, { useState, useEffect, useRef, useMemo } from "react";
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
import { SmartImage } from "./SmartImage";
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
  ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import RecordRTC from "recordrtc";
import SkeletonLoader, { LoadingTransition, Skeleton } from "./SkeletonLoader";

interface MessagesViewProps {
  currentUserId: string;
  initialChatId?: string | null;
  activeChatId?: string | null;
  onCloseChat?: () => void;
  onSelectUser?: (userId: string) => void;
  onChatSelect?: (chatId: string | null) => void;
}

interface ExtendedMessage extends Message {
  id: string;
  createdAt?: any;
  clientMsgId?: string;
  replyToId?: string;
  replyToText?: string;
  isEdited?: boolean;
  imageUrl?: string;
  audioUrl?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  deletedFor?: string[];
  deleted?: boolean;
  reactions?: Record<string, string>;
  pinned?: boolean;
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
  chat: { participantIds?: string[]; otherUserId?: string } | null | undefined,
  currentUserId: string
): string | null => {
  if (!chat) return null;
  if (Array.isArray(chat.participantIds)) {
    const other = chat.participantIds.find((id) => id && id !== currentUserId);
    if (other) return other;
  }
  if (chat.otherUserId && chat.otherUserId !== currentUserId) {
    return chat.otherUserId;
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
}: ChatHeaderProps) => {
  const isOnline = otherUserPresence?.status === "online";
  const statusText = isOnline ? "Active now" : formatLastSeen(otherUserPresence?.lastSeen);

  const username = useMemo(() => {
    if (!otherUserProfile) return "";
    return otherUserProfile.username || otherUserProfile.fullName?.toLowerCase().replace(/\s+/g, "") || "user";
  }, [otherUserProfile]);

  return (
    <div className="h-[58px] min-h-[58px] shrink-0 flex-none bg-[#0D0D0F]/95 backdrop-blur-md text-[#F7F4EE] border-b border-[#1A1A1D] flex items-center justify-between px-3.5 sm:px-4 shadow-sm relative z-20 select-none">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button 
          onClick={onBackClick}
          className="md:hidden w-8 h-8 hover:bg-[#1A1A1D] rounded-full text-[#F7F4EE]/90 hover:text-white transition-all shrink-0 cursor-pointer flex items-center justify-center -ml-1 active:scale-95"
          title="Back to conversations"
        >
          <ChevronLeft size={20} />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <AnimatePresence mode="wait">
            {!otherUserProfile ? (
              <motion.div 
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center gap-3 min-w-0"
              >
                <div className="w-9.5 h-9.5 rounded-full bg-[#1A1A1D] animate-pulse shrink-0 border border-[#27272A]" />
                <div className="flex flex-col gap-1.5 justify-center min-w-0">
                  <div className="w-24 h-3 bg-[#1A1A1D] rounded animate-pulse" />
                  <div className="w-20 h-2 bg-[#1A1A1D] rounded animate-pulse" />
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key={otherUserProfile.uid}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 5 }}
                transition={{ duration: 0.18 }}
                className="flex items-center min-w-0"
              >
                 <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSelectUser?.(otherUserProfile.uid)}
                  className="group flex items-center gap-3 text-left outline-none focus:outline-none cursor-pointer p-1 -ml-1 rounded-xl hover:bg-[#1A1A1D]/80 active:bg-[#27272A] transition-all duration-200 relative overflow-hidden min-w-0"
                >
                  <div className="relative shrink-0 flex items-center">
                    <SmartImage 
                      src={otherUserProfile.photoUrl || otherUserProfile.profilePhotoUrl} 
                      alt={otherUserProfile.fullName || "User"} 
                      className="w-10 h-10 rounded-full border border-[#27272A] shadow-2xs shrink-0 object-cover group-hover:scale-105 transition-transform duration-200" 
                      fallbackType="profile" 
                      fullName={otherUserProfile.fullName} 
                    />
                    <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0D0D0F] ${
                      isOnline ? "bg-[#C9A96E] shadow-sm animate-pulse-slow" : "bg-[#71717A]"
                    }`} />
                  </div>

                  <div className="flex flex-col justify-center min-w-0">
                    <h3 className="text-[14px] font-semibold text-[#F7F4EE] leading-tight tracking-tight truncate max-w-[130px] xs:max-w-[170px] sm:max-w-[260px] group-hover:text-[#C9A96E] transition-colors">
                      {otherUserProfile.fullName || "Member"}
                    </h3>
                    <div className="flex items-center gap-1.5 leading-none text-[10.5px] text-[#A1A1AA] mt-0.5 min-w-0 font-mono">
                      <span className="truncate max-w-[70px] xs:max-w-[95px]">@{username}</span>
                      <span className="text-[#52525B] shrink-0">•</span>
                      <div className="flex items-center gap-1 truncate max-w-[120px]">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? "bg-[#C9A96E] animate-pulse-slow" : "bg-[#71717A]"}`} />
                        <span className="truncate">{statusText}</span>
                      </div>
                    </div>
                  </div>
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Meta Toolbar with Search and Options */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {/* Search Inside Conversation */}
        <button 
          id="chat-header-search-btn"
          onClick={onSearchInChatClick}
          className="w-9 h-9 rounded-full text-[#F7F4EE]/80 hover:text-[#F7F4EE] hover:bg-[#1A1A1D] active:scale-95 transition-all duration-150 cursor-pointer flex items-center justify-center shrink-0 border border-white/5 hover:border-white/10 shadow-2xs"
          title="Search inside chat"
        >
          <SearchIcon size={15} />
        </button>
        
        {/* More Options Dropdown */}
        <div className="relative flex items-center">
          <button 
            id="chat-header-options-btn"
            onClick={onDropdownToggle}
            className="w-9 h-9 rounded-full text-[#F7F4EE]/80 hover:text-[#F7F4EE] hover:bg-[#1A1A1D] active:scale-95 transition-all duration-150 cursor-pointer flex items-center justify-center shrink-0 border border-white/5 hover:border-white/10 shadow-2xs"
            title="Chat options"
          >
            <MoreVertical size={16} />
          </button>
          
          <AnimatePresence>
            {showOptionsDropdown && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -6 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="absolute right-0 top-[46px] w-52 bg-[#141417]/95 backdrop-blur-xl border border-[#C9A96E]/20 rounded-2xl shadow-[0_12px_32px_rgba(0,0,0,0.6)] p-1.5 z-50 text-xs font-medium text-[#F7F4EE]"
              >
                <button 
                  onClick={handleTogglePinChat}
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-[#F7F4EE] hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  <Pin size={14} className="rotate-45 text-[#C9A96E]" />
                  <span>{activeChat.pinnedUsers?.includes(currentUserId) ? "Unpin Chat" : "Pin Chat"}</span>
                </button>
                <button 
                  onClick={handleToggleArchiveChat}
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-[#F7F4EE] hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  <Archive size={14} className="text-[#A1A1AA]" />
                  <span>{activeChat.archivedUsers?.includes(currentUserId) ? "Unarchive" : "Archive"}</span>
                </button>
                <button 
                  onClick={handleToggleMuteChat}
                  className="flex items-center gap-2.5 w-full p-2.5 text-left text-[#F7F4EE] hover:bg-white/5 rounded-xl transition cursor-pointer"
                >
                  {activeChat.mutedUsers?.includes(currentUserId) ? <Bell size={14} className="text-[#C9A96E]" /> : <BellOff size={14} className="text-[#A1A1AA]" />}
                  <span>{activeChat.mutedUsers?.includes(currentUserId) ? "Unmute Notifications" : "Mute Notifications"}</span>
                </button>

                <div className="border-t border-white/10 my-1" />

                <button 
                  onClick={handleToggleBlockUser}
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
  onChatSelect
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

  useEffect(() => {
    if (otherUserId && !otherUserProfile && fetchProfile) {
      fetchProfile(otherUserId).catch(err => {
        console.error("Error loading other user profile:", err);
      });
    }
  }, [otherUserId, otherUserProfile, fetchProfile]);

  // Search state for creating new conversations
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  
  // Chat list filter search
  const [chatSearchText, setChatSearchText] = useState("");
  const [chatFilterText, setChatFilterText] = useState("");

  // Camera Capture States
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Block & Report States
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [blockedByUsers, setBlockedByUsers] = useState<string[]>([]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCategory, setReportCategory] = useState("Spam");
  const [reportComments, setReportComments] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  // Input & Edit States
  const [typedMessage, setTypedMessage] = useState("");
  const [editingMessage, setEditingMessage] = useState<ExtendedMessage | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<ExtendedMessage | null>(null);
  const [searchInChatText, setSearchInChatText] = useState("");
  const [showSearchInChat, setShowSearchInChat] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow input textarea height based on typing text
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 100)}px`;
    }
  }, [typedMessage]);
  
  // Interactive Overlays
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [selectedMsgCoords, setSelectedMsgCoords] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  
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
  const recordIntervalRef = useRef<any>(null);
  const typingTimeoutRef = useRef<any>(null);

  const checkIsNearBottom = () => {
    const container = chatScrollContainerRef.current;
    if (!container) return true;
    const threshold = 180;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: "end" });
    } else if (chatScrollContainerRef.current) {
      chatScrollContainerRef.current.scrollTop = chatScrollContainerRef.current.scrollHeight;
    }
  };

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
            const compressedBlob = await compressImage(new File([blob], "camera_capture.jpg", { type: "image/jpeg" }));
            const file = new File([compressedBlob], "camera_capture.jpg", { type: "image/jpeg" });
            const url = await handleCloudinaryUpload(file, "image");
            handleSendMessage({ imageUrl: url });
          }
        }, "image/jpeg", 0.75);
      }
    } catch (e) {
      console.error("Failed to capture photo:", e);
    }
  };

  // HTML5 Canvas Image Compression Helper (Zero dependencies, incredibly lightweight)
  const compressImage = (file: File): Promise<Blob | File> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;

          if (width > MAX_WIDTH || height > MAX_HEIGHT) {
            if (width > height) {
              height = Math.round((height * MAX_WIDTH) / width);
              width = MAX_WIDTH;
            } else {
              width = Math.round((width * MAX_HEIGHT) / height);
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
              if (blob) {
                resolve(blob);
              } else {
                resolve(file);
              }
            }, "image/jpeg", 0.75);
          } else {
            resolve(file);
          }
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  // Filter global chats list without triggering visual reordering when messages are sent/received
  const filteredChats = useMemo(() => {
    let result = (globalChats as ExtendedChat[])
      .filter(c => Boolean(c && c.id))
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
      } else if (filterLower === "pinned") {
        result = result.filter(c => c.pinnedUsers?.includes(currentUserId));
      } else if (filterLower === "archived") {
        result = result.filter(c => c.archivedUsers?.includes(currentUserId));
      } else {
        result = result.filter(c => c.lastMessage?.toLowerCase().includes(filterLower));
      }
    }

    if (chatSearchText.trim()) {
      const term = chatSearchText.toLowerCase();
      result = result.filter(c => {
        const otherId = c.otherUserId || getOtherParticipantId(c, currentUserId);
        const otherUserObj = resolveOtherUserProfile(otherId, c, profilesCache, chatProfiles);
        const matchesName = otherUserObj?.fullName?.toLowerCase().includes(term);
        const matchesUser = otherUserObj?.username?.toLowerCase().includes(term);
        const matchesMsg = c.lastMessage?.toLowerCase().includes(term);
        return Boolean(matchesName || matchesUser || matchesMsg);
      });
    }

    // Always sort conversations by latest activity/message timestamp (lastMessageAt) descending
    // Newest active conversation is always #1 at top of list. If no messages, keep stable relative order.
    result.sort((a, b) => {
      const timeA = getTimestampMs(a.lastMessageAt || a.lastMessageTime || a.updatedAt || a.createdAt);
      const timeB = getTimestampMs(b.lastMessageAt || b.lastMessageTime || b.updatedAt || b.createdAt);
      if (timeB !== timeA) return timeB - timeA;
      return 0;
    });

    return result;
  }, [globalChats, chatFilterText, chatSearchText, chatProfiles, profilesCache, currentUserId]);

  const chatProfilesRef = useRef(chatProfiles);
  useEffect(() => {
    chatProfilesRef.current = chatProfiles;
  }, [chatProfiles]);

  useEffect(() => {
    const fetchMissingProfiles = async () => {
      const missingIds = filteredChats
        .map(c => c.otherUserId)
        .filter((id): id is string => !!id && !chatProfilesRef.current[id]);

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
    const cleanSearch = searchText.trim();
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
  }, [searchText, currentUserId]);

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
        
        // Skip if deleted for this user
        if (msg.deletedFor?.includes(currentUserId)) return;

        loadedMsgs.push({
          ...msg,
          id: docSnap.id
        });

        // Mark incoming messages as seen
        if (msg.senderId !== currentUserId && msg.status !== "seen") {
          updateDoc(doc(db, collectionName, activeChat.id, "messages", docSnap.id), {
            status: "seen"
          }).catch(() => {});
        }
      });

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

      // Keep scroll pinned to the bottom if user was near bottom or on initial opening
      if (isFirstLoadRef.current || isNearBottomRef.current) {
        const isFirst = isFirstLoadRef.current;
        isFirstLoadRef.current = false;
        setTimeout(() => {
          scrollToBottom(isFirst ? "auto" : "smooth");
        }, 50);
      }
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

    // 2. Realtime typing indicators inside typingStatus collection
    const typingDocRef = doc(db, "typingStatus", activeChat.id);
    const unsubscribeTyping = onSnapshot(typingDocRef, (snapshot) => {
      if (snapshot.exists() && otherId) {
        const data = snapshot.data();
        setOtherUserTyping(!!data[otherId]);
      } else {
        setOtherUserTyping(false);
      }
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
      unsubscribeMessages();
      unsubscribeTyping();
      unsubscribePresence();
    };
  }, [activeChat?.id, activeChat?.isLegacy, currentUserId]);

  // Handle scrolling to paginate and track scroll position
  const handleScroll = () => {
    const container = chatScrollContainerRef.current;
    if (!container) return;
    isNearBottomRef.current = checkIsNearBottom();
  };



  // Auto-scroll helper
  useEffect(() => {
    if (messages.length > 0 && messagesLimit === 30) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [loadingMessages]);

  // Typing status sync to Firestore
  const updateTypingStatus = async (typing: boolean) => {
    if (!activeChat) return;
    try {
      const typingDocRef = doc(db, "typingStatus", activeChat.id);
      await setDoc(typingDocRef, {
        [currentUserId]: typing,
        updatedAt: new Date()
      }, { merge: true });
    } catch (err) {
      console.error("Error setting typing status:", err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTypedMessage(e.target.value);

    if (!isTyping) {
      setIsTyping(true);
      updateTypingStatus(true);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
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

  // Secure Unsigned Upload to Cloudinary with Graceful FileReader Base64 Fallback
  const handleCloudinaryUpload = async (file: File, folderKey: string): Promise<string> => {
    const cloudName = (import.meta as any).env?.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = (import.meta as any).env?.VITE_CLOUDINARY_UPLOAD_PRESET;

    setUploadProgress((prev) => ({ ...prev, [folderKey]: 10 }));

    if (!cloudName || !uploadPreset) {
      // FileReader Fallback for sandboxed offline previewing
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

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloudName}/upload`, true);

      const uploadPromise = new Promise<string>((resolve, reject) => {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            setUploadProgress((prev) => ({ ...prev, [folderKey]: progress }));
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            const data = JSON.parse(xhr.responseText);
            setUploadProgress((prev) => ({ ...prev, [folderKey]: 100 }));
            setTimeout(() => {
              setUploadProgress((prev) => {
                const copy = { ...prev };
                delete copy[folderKey];
                return copy;
              });
            }, 1000);
            resolve(data.secure_url);
          } else {
            reject(new Error("Cloudinary returned non-200 response"));
          }
        };

        xhr.onerror = () => reject(new Error("Network upload error"));
      });

      xhr.send(formData);
      return await uploadPromise;
    } catch (err: any) {
      console.error("Cloudinary failed, falling back to instant secure base64:", err);
      // Secondary absolute fallback
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    }
  };

  // Media Attachment trigger
  const triggerMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "file") => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let uploadFile: File | Blob = file;
      if (type === "image") {
        uploadFile = await compressImage(file);
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

    // Clear input field synchronously to prevent duplicate submissions while database is writing
    if (payload.text) {
      setTypedMessage("");
    }

    const collectionName = activeChat.isLegacy ? "chats" : "conversations";

    // 1. Generate local optimistic ID & message with unique entropy and timestamps
    const tempId = "optimistic_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const now = new Date();
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
      ...(replyToMessage ? { replyToId: replyToMessage.id, replyToText: replyToMessage.text || "[Attachment]" } : {})
    };

    // 2. Append to bottom of local list optimistically (NEVER prepend)
    setMessages(prev => {
      if (prev.some(m => m.id === tempId)) return prev;
      const next = [...prev, tempMsg];
      next.sort((a, b) => getMessageTimeMs(a) - getMessageTimeMs(b));
      return next;
    });

    // Pin scroll to bottom immediately upon sending
    setTimeout(() => {
      scrollToBottom("smooth");
    }, 20);

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
        newMsgObj.replyToText = replyToMessage.text || "[Attachment]";
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

      const parentRef = doc(db, collectionName, activeChat.id);
      const writeNow = new Date();
      await updateDoc(parentRef, {
        lastMessage: lastMsgText,
        lastMessageSenderId: currentUserId,
        lastMessageTime: writeNow,
        lastMessageAt: writeNow,
        updatedAt: writeNow,
        ...unreadUpdate
      });

      // Clear states
      setTypedMessage("");
      if (isTyping) {
        setIsTyping(false);
        updateTypingStatus(false);
      }
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

  // Block / Unblock User
  const handleToggleBlockUser = async () => {
    if (!activeChat) return;
    const otherId = Array.isArray(activeChat.participantIds) ? activeChat.participantIds.find((id) => id !== currentUserId) : undefined;
    if (!otherId) return;

    try {
      const isBlocked = blockedUsers.includes(otherId);
      const blockDocRef = doc(db, "users", currentUserId, "blockedUsers", otherId);
      if (isBlocked) {
        await deleteDoc(blockDocRef);
      } else {
        await setDoc(blockDocRef, {
          id: otherId,
          blockedAt: new Date()
        });
      }
      setShowOptionsDropdown(false);
    } catch (err) {
      console.error("Error blocking user:", err);
    }
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

  const handleBubbleTouchStart = (e: React.TouchEvent, msgId: string) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    hasMovedRef.current = false;

    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = setTimeout(() => {
      if (!hasMovedRef.current) {
        setSelectedMsgId(msgId);
      }
    }, 450);
  };

  const handleBubbleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    if (dx > 8 || dy > 8) {
      hasMovedRef.current = true;
      if (longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
        longPressTimeoutRef.current = null;
      }
    }
  };

  const handleBubbleTouchEnd = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
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

  // Message deletions
  const handleDeleteForEveryone = async (msgId: string) => {
    if (!activeChat) return;
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";
    try {
      const msgRef = doc(db, collectionName, activeChat.id, "messages", msgId);
      await updateDoc(msgRef, {
        text: "This message was deleted",
        deleted: true,
        imageUrl: null,
        audioUrl: null,
        fileUrl: null,
        fileName: null,
        fileSize: null
      });
      setSelectedMsgId(null);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleDeleteForMe = async (msgId: string) => {
    if (!activeChat) return;
    const collectionName = activeChat.isLegacy ? "chats" : "conversations";
    try {
      const msgRef = doc(db, collectionName, activeChat.id, "messages", msgId);
      const msgSnap = await getDoc(msgRef);
      if (msgSnap.exists()) {
        const deletedFor = msgSnap.data().deletedFor || [];
        if (!deletedFor.includes(currentUserId)) {
          await updateDoc(msgRef, {
            deletedFor: [...deletedFor, currentUserId]
          });
        }
      }
      setSelectedMsgId(null);
    } catch (err) {
      console.error("Delete for me failed:", err);
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
      setSearchText("");
      return;
    }

    try {
      const { chatId, isLegacy } = await getOrCreateConversation(
        currentUserId, 
        targetUser.uid, 
        "Conversation initiated"
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
        unreadCount: { [currentUserId]: 0, [targetUser.uid]: 0 }
      } as Chat);

      setActiveChat({
        ...convData,
        id: chatId,
        otherUser: targetUser,
        isLegacy
      });
      if (onChatSelect) onChatSelect(chatId);
      setSearchText("");
    } catch (e) {
      console.error("Failed to start new conversation:", e);
    }
  };

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
    <div className="flex flex-1 min-h-0 h-full w-full bg-theme-bg relative text-theme-text overflow-hidden md:rounded-[24px] rounded-none">
      
      {/* 1. CHAT LIST / SIDEBAR PANEL */}
      <div className={`w-full md:w-80 flex flex-col border-r border-theme-border bg-theme-surface h-full ${activeChat ? "hidden md:flex" : "flex"}`}>
        {/* Header and Filter */}
        <div className="p-4 border-b border-theme-border flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight text-theme-text font-display">Conversations</h2>
            {/* New chat launcher prompt status indicators */}
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse-slow shadow-gold-glow" title="Messenger Active" />
          </div>

          {/* Instant User search input */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-theme-secondary" />
            <input
              type="text"
              placeholder="Search people or skills..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-theme-bg border border-theme-border rounded-xl text-xs outline-none focus:border-theme-accent transition"
            />
          </div>

          {/* Active Chat filter search input (Requirement: Search chats) */}
          <div className="relative">
            <Search className="absolute left-3 top-2 w-3.5 h-3.5 text-theme-secondary/80" />
            <input
              type="text"
              placeholder="Filter active chats..."
              value={chatSearchText}
              onChange={(e) => setChatSearchText(e.target.value)}
              className="w-full pl-8 pr-4 py-1.5 bg-theme-bg/60 border border-theme-border/50 rounded-lg text-[11px] outline-none focus:border-theme-accent transition"
            />
          </div>
        </div>

        {/* User Search Results Dropdown Overlay */}
        {searchText.trim().length > 0 && (
          <div className="bg-theme-card border-b border-theme-border p-2 max-h-48 overflow-y-auto divide-y divide-theme-border z-10">
            <div className="text-[10px] uppercase tracking-wider text-theme-secondary font-mono px-2 py-1 flex justify-between">
              <span>Platform matches</span>
              {searchingUsers && <Loader2 className="w-3 h-3 animate-spin text-theme-accent" />}
            </div>
            {searchResults.length === 0 && !searchingUsers ? (
              <div className="text-xs text-theme-secondary p-3 text-center">No users found match term.</div>
            ) : (
              searchResults.map((u) => (
                <div 
                  key={u.uid}
                  onClick={() => handleCreateNewConversation(u)}
                  className="flex items-center gap-3 p-2 hover:bg-theme-bg rounded-xl transition cursor-pointer"
                >
                  <SmartImage src={u.photoUrl || u.profilePhotoUrl} alt={u.fullName} className="w-8 h-8 rounded-full border border-theme-border" fallbackType="profile" fullName={u.fullName} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate text-theme-text">{u.fullName}</p>
                    <p className="text-[10px] text-theme-secondary truncate font-mono">@{u.username}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Filters/Subtabs bar */}
        <div className="flex gap-1.5 p-3 px-4 border-b border-theme-border overflow-x-auto select-none">
          {["All", "Unread", "Pinned", "Archived"].map((tab) => {
            const isSelected = (tab === "All" && chatFilterText === "") || chatFilterText === tab;
            return (
              <button
                key={tab}
                onClick={() => {
                  if (tab === "All") setChatFilterText("");
                  else setChatFilterText(tab);
                }}
                className={`px-3 py-1 text-[11px] font-medium rounded-full transition cursor-pointer shrink-0 ${
                  isSelected 
                    ? "bg-theme-accent text-white shadow-gold-glow" 
                    : "bg-theme-bg hover:bg-theme-border text-theme-secondary hover:text-theme-text"
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto divide-y divide-theme-border/60">
          {filteredChats.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center p-6 text-center text-theme-secondary select-none">
              <Info className="w-8 h-8 text-theme-border mb-2" />
              <p className="text-xs">No active discussions found.</p>
              <p className="text-[10px] text-theme-secondary/70 mt-1">Search or go to someone's profile to launch a secure chat.</p>
            </div>
          ) : (
            filteredChats.map((c) => {
              const otherId = c.otherUserId || getOtherParticipantId(c, currentUserId);
              const otherUserObj = resolveOtherUserProfile(otherId, c, profilesCache, chatProfiles);
              const isPinned = c.pinnedUsers?.includes(currentUserId);
              const isArchived = c.archivedUsers?.includes(currentUserId);
              const unread = c.unreadCount?.[currentUserId] || 0;
              const isActive = activeChat?.id === c.id;

              if (chatFilterText === "Pinned" && !isPinned) return null;
              if (chatFilterText === "Archived" && !isArchived) return null;
              if (chatFilterText === "Unread" && unread === 0) return null;

              const isOtherOnline = Boolean(otherId && otherUserPresence?.userId === otherId && otherUserPresence?.status === "online");
              const isOtherTyping = Boolean(otherId && c.typingUsers?.[otherId]);

              return (
                <div
                  key={c.id}
                  onClick={() => {
                    setActiveChat(c);
                    if (onChatSelect) onChatSelect(c.id);
                  }}
                  className={`flex items-center gap-3.5 p-3.5 hover:bg-theme-bg/50 transition-all duration-150 cursor-pointer relative border-l-[3px] select-none ${
                    isActive ? "bg-theme-bg/90 border-theme-accent shadow-2xs" : "border-transparent"
                  }`}
                >
                  <div className="relative shrink-0">
                    <SmartImage 
                      src={otherUserObj?.photoUrl || otherUserObj?.profilePhotoUrl} 
                      alt={otherUserObj?.fullName || "Chat"} 
                      className="w-11 h-11 rounded-full border border-theme-border shadow-2xs shrink-0 object-cover" 
                      fallbackType="profile" 
                      fullName={otherUserObj?.fullName} 
                    />
                    {/* Symmetrical Presence Online Indicator */}
                    <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-theme-surface ${
                      isOtherTyping ? "bg-blue-500 animate-pulse" :
                      isOtherOnline ? "bg-emerald-500 shadow-2xs animate-pulse-slow" : "bg-zinc-400"
                    }`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <p className="text-[13.5px] font-semibold tracking-tight truncate text-theme-text">{otherUserObj?.fullName || "User"}</p>
                      <span className="text-[9.5px] text-theme-secondary/80 font-mono shrink-0">
                        {formatChatTimestamp(c.lastMessageAt || c.lastMessageTime || c.updatedAt)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-1 gap-2">
                      {isOtherTyping ? (
                        <p className="text-xs text-theme-accent font-medium animate-pulse flex items-center gap-1">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-theme-accent animate-bounce" />
                          <span>Typing...</span>
                        </p>
                      ) : (
                        <p className="text-xs text-theme-secondary truncate max-w-[150px] font-normal leading-tight">
                          {c.lastMessage}
                        </p>
                      )}

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isPinned && <Pin size={11} className="text-theme-accent shrink-0 rotate-45" />}
                        {unread > 0 && (
                          <span className="px-2 py-0.5 text-[10px] bg-theme-accent text-white font-bold rounded-full min-w-[18px] text-center shadow-2xs">
                            {unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 2. CHAT AREA WINDOW */}
      <div className={`flex-1 flex flex-col min-h-0 bg-theme-bg relative overflow-hidden ${!activeChat ? "hidden md:flex" : "flex"}`}>
        {activeChat ? (
          <>
            {/* Header */}
            <ChatHeader 
              otherUserProfile={otherUserProfile}
              otherUserPresence={otherUserPresence}
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
            />

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

            {/* Messages Scroll Panel */}
            <div 
              ref={chatScrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto min-h-0 px-3.5 pt-2 pb-3 flex flex-col bg-theme-bg"
            >
              <LoadingTransition isLoading={loadingMessages && messages.length === 0} type="chat-messages" count={4}>
                {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto select-none my-auto">
                  <div className="w-16 h-16 rounded-full bg-theme-accent/10 border border-theme-accent/25 flex items-center justify-center text-theme-accent mb-4 shadow-gold-glow animate-pulse-slow">
                    <MessageSquare size={28} />
                  </div>
                  <h3 className="text-base font-bold text-theme-text font-display">Start your first conversation</h3>
                  <p className="text-xs text-theme-secondary mt-1.5 leading-relaxed max-w-xs">
                    Send a secure greeting to {otherUserProfile?.fullName || "your contact"} to break the ice and start swapping skills.
                  </p>
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
                  const isLastMsgInGroup = index === messages.length - 1;
                  const showReactionsPalette = selectedMsgId === m.id;

                  const prevMsg = index > 0 ? chatMessagesFiltered[index - 1] : null;
                  const isSameSender = prevMsg ? prevMsg.senderId === m.senderId : false;
                  const marginClass = isSameSender ? "mt-[2px]" : "mt-2.5";

                  return (
                    <motion.div 
                      key={m.id}
                      initial={{ opacity: 0, y: 12, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      className={`flex flex-col w-full max-w-[70%] ${isSelf ? "self-end items-end" : "self-start items-start"} relative ${marginClass}`}
                    >
                      {/* Message Reply Anchor Reference */}
                      {m.replyToId && (
                        <div className="flex items-center gap-1.5 text-[10px] text-theme-secondary bg-theme-surface/70 px-3 py-1.5 rounded-xl border border-theme-border/60 mb-1.5 max-w-xs truncate select-none opacity-80 animate-fade-in">
                          <Reply size={10} className="text-theme-accent" />
                          <span>Replying to: </span>
                          <span className="font-medium font-mono">"{m.replyToText}"</span>
                        </div>
                      )}

                      {/* Message Bubble Base */}
                      <div className="group relative flex items-center gap-2 max-w-full">
                        
                        {/* Self reaction trigger / Option menu when hover */}
                        {isSelf && (
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 transition select-none mr-1.5 shrink-0">
                            <button 
                              onClick={() => setReplyToMessage(m)}
                              className="p-1 hover:bg-theme-surface rounded-lg text-theme-secondary hover:text-theme-text transition cursor-pointer"
                              title="Reply"
                            >
                              <Reply size={12} />
                            </button>
                            <button 
                              onClick={() => setSelectedMsgId(showReactionsPalette ? null : m.id)}
                              className="p-1 hover:bg-theme-surface rounded-lg text-theme-secondary hover:text-theme-text transition cursor-pointer"
                              title="React/Delete"
                            >
                              <Smile size={12} />
                            </button>
                          </div>
                        )}

                        <div 
                          id={`msg-bubble-${m.id}`}
                          onDoubleClick={() => setSelectedMsgId(showReactionsPalette ? null : m.id)}
                          onTouchStart={(e) => handleBubbleTouchStart(e, m.id)}
                          onTouchMove={handleBubbleTouchMove}
                          onTouchEnd={handleBubbleTouchEnd}
                          className={`px-[13px] py-[8px] relative break-words leading-[1.38] text-[13.5px] font-normal shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-200 select-text active:scale-[0.99] max-w-full ${
                            isSelf 
                              ? "bg-[var(--chat-bubble-self-bg)] text-[var(--chat-bubble-self-text)] " + (isSameSender ? "rounded-[18px]" : "rounded-[18px] rounded-br-[4px]") 
                              : "bg-[var(--chat-bubble-other-bg)] text-[var(--chat-bubble-other-text)] border border-theme-border/10 " + (isSameSender ? "rounded-[18px]" : "rounded-[18px] rounded-bl-[4px]")
                          } ${m.reactions && Object.keys(m.reactions).length > 0 ? "mb-3.5" : ""}`}
                        >
                          
                          {/* Image Attachment content */}
                          {m.imageUrl && (
                            <div className="max-w-[180px] max-h-[180px] rounded-xl overflow-hidden mb-1.5 cursor-pointer border border-white/5 shadow-sm transition hover:scale-[1.01]" onClick={() => setFullscreenImage(m.imageUrl || null)}>
                              <SmartImage src={m.imageUrl} alt="attachment" className="w-full h-full object-cover" fallbackType="cover" sizeType="standard" />
                            </div>
                          )}

                          {/* Audio voice note note player */}
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
                              <a href={m.fileUrl} download={m.fileName || "attachment"} target="_blank" rel="noreferrer" className="p-1 hover:bg-theme-border rounded-lg text-theme-secondary transition shrink-0">
                                <Download size={12} />
                              </a>
                            </div>
                          )}

                          {/* Raw text body message */}
                          {m.text && (
                            <p className="font-normal whitespace-pre-wrap text-[13.5px] leading-[1.38]">{m.text}</p>
                          )}

                          {/* Message Footer stats indicator */}
                          <div className={`flex items-center justify-end gap-1 mt-1 text-[9px] select-none font-sans font-medium tracking-wide ${
                            isSelf ? "text-[#090909]/50" : "text-zinc-400/60"
                          }`}>
                            {m.isEdited && <span className="text-[8px] uppercase tracking-wider font-semibold opacity-75 mr-0.5 font-mono">Edited</span>}
                            <span>{formatMsgTime(m.createdAt || m.timestamp)}</span>
                            {isSelf && (
                              <span className="flex items-center shrink-0 ml-0.5">
                                {m.status === "seen" ? (
                                  <CheckCheck size={11} className="text-[#090909]/75" />
                                ) : m.status === "delivered" ? (
                                  <CheckCheck size={11} className="text-[#090909]/45" />
                                ) : (
                                  <Check size={11} className="text-[#090909]/30" />
                                )}
                              </span>
                            )}
                          </div>

                          {/* Active Message Reactions tags */}
                          {m.reactions && Object.keys(m.reactions).length > 0 && (() => {
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
                                            ? "bg-[#D4AF37]/10 border-[#D4AF37]/40 text-[#D4AF37]" 
                                            : "bg-gray-100 border-gray-200 hover:border-gray-300 text-gray-700"
                                        }`}
                                      >
                                        <span className="scale-105">{emoji}</span>
                                        <span className="font-bold font-mono text-[9px]">{data.count}</span>
                                      </motion.button>

                                      {/* Micro Popover with Glassmorphism */}
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
                                                  const profile = profilesCache?.[userId] || chatProfiles[userId] || null;
                                                  const uName = profile?.fullName || "User";
                                                  return (
                                                    <div key={userId} className="flex items-center gap-1.5 py-0.5 px-1 rounded-md hover:bg-white/5">
                                                      <span className="text-zinc-500 text-[10px]">•</span>
                                                      <span className="text-zinc-200 text-[10px] font-medium truncate flex-1">{uName}</span>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                              <div className="h-px bg-white/5 my-1.5" />
                                              <button
                                                onClick={(ev) => {
                                                  ev.stopPropagation();
                                                  handleReactToMessage(m.id, emoji);
                                                  setActiveReactionInfo(null);
                                                }}
                                                className="w-full text-center text-[9px] font-mono font-bold text-zinc-400 hover:text-red-400 transition cursor-pointer"
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

                        {/* Recipient menu triggers */}
                        {!isSelf && (
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 transition select-none ml-1.5">
                            <button 
                              onClick={() => setSelectedMsgId(showReactionsPalette ? null : m.id)}
                              className="p-1 hover:bg-theme-surface rounded-lg text-theme-secondary hover:text-theme-text transition cursor-pointer"
                              title="React"
                            >
                              <Smile size={12} />
                            </button>
                            <button 
                              onClick={() => setReplyToMessage(m)}
                              className="p-1 hover:bg-theme-surface rounded-lg text-theme-secondary hover:text-theme-text transition cursor-pointer"
                              title="Reply"
                            >
                              <Reply size={12} />
                            </button>
                          </div>
                        )}


                      </div>
                    </motion.div>
                  );
                })
              )}
              </LoadingTransition>

              {/* Other member typing live visual bubble */}
              <AnimatePresence>
                {otherUserTyping && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="self-start flex items-center gap-2 bg-[var(--chat-bubble-other-bg)] text-[var(--chat-bubble-other-text)] border border-theme-border/15 px-4 py-2.5 rounded-2xl rounded-bl-xs shadow-xs select-none mb-1"
                  >
                    <div className="flex gap-1 items-center h-4">
                      <motion.span 
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 0.1, delay: 0 }}
                        className="w-1.5 h-1.5 rounded-full bg-theme-secondary" 
                      />
                      <motion.span 
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 0.1, delay: 0.15 }}
                        className="w-1.5 h-1.5 rounded-full bg-theme-secondary" 
                      />
                      <motion.span 
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 0.1, delay: 0.3 }}
                        className="w-1.5 h-1.5 rounded-full bg-theme-secondary" 
                      />
                    </div>
                    <span className="ml-1 font-mono text-[9px] uppercase tracking-wider opacity-60">Typing...</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={messagesEndRef} />
            </div>

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

            {/* INPUT CONTROLS FOOTER */}
            {!isRecording && !previewAudioUrl && !isUploadingVoice && (
              activeChat.otherUserId && (blockedUsers.includes(activeChat.otherUserId) || blockedByUsers.includes(activeChat.otherUserId)) ? (
                <div className="flex-none h-[56px] min-h-[56px] max-h-[56px] border-t border-theme-border/60 bg-theme-surface/95 flex items-center justify-center text-center text-[10px] font-bold text-red-500 bg-red-500/5 select-none font-mono tracking-widest uppercase animate-slide-up">
                  <Lock size={12} className="mr-1.5 text-red-500 shrink-0" />
                  Messaging is restricted due to active block state
                </div>
              ) : (
                <div className="flex-none min-h-[54px] py-2 border-t border-theme-border/60 bg-white/95 backdrop-blur-md flex items-end gap-2.5 px-3 shadow-md shrink-0 w-full select-none">
                  {/* File/Image Upload Buttons */}
                  <div className="flex items-center gap-1.5 pb-1 shrink-0">
                    <motion.label 
                      whileTap={{ scale: 0.92 }}
                      whileHover={{ scale: 1.05 }}
                      className="w-8 h-8 rounded-full bg-theme-bg/60 border border-theme-border/30 hover:bg-theme-border/60 text-theme-secondary hover:text-theme-text transition cursor-pointer flex items-center justify-center shadow-xs" 
                      title="Gallery"
                    >
                      <ImageIcon size={14} />
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => triggerMediaUpload(e, "image")} />
                    </motion.label>
                    
                    <motion.label 
                      whileTap={{ scale: 0.92 }}
                      whileHover={{ scale: 1.05 }}
                      className="w-8 h-8 rounded-full bg-theme-bg/60 border border-theme-border/30 hover:bg-theme-border/60 text-theme-secondary hover:text-theme-text transition cursor-pointer flex items-center justify-center shadow-xs" 
                      title="File"
                    >
                      <Paperclip size={14} />
                      <input type="file" accept="*" className="hidden" onChange={(e) => triggerMediaUpload(e, "file")} />
                    </motion.label>
                    
                    <motion.button 
                      whileTap={{ scale: 0.92 }}
                      whileHover={{ scale: 1.05 }}
                      onClick={openCamera}
                      className="w-8 h-8 rounded-full bg-theme-bg/60 border border-theme-border/30 hover:bg-theme-border/60 text-theme-secondary hover:text-theme-text transition cursor-pointer flex items-center justify-center shadow-xs" 
                      title="Camera"
                    >
                      <Camera size={14} />
                    </motion.button>
                  </div>
 
                  {/* Growing Textarea Capsule */}
                  <div className="flex-1 relative flex items-center min-h-[36px] bg-theme-bg border border-theme-border/40 rounded-[18px] focus-within:border-[#D4AF37]/50 transition-all duration-200">
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      placeholder={editingMessage ? "Edit message..." : "Message..."}
                      value={typedMessage}
                      onChange={handleInputChange}
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
                      className="w-full max-h-[100px] py-[8px] px-4 bg-transparent outline-none text-[13.5px] text-theme-text placeholder-theme-secondary/40 transition-all duration-150 overflow-y-auto scrollbar-none"
                    />
                  </div>
 
                  {/* Action button - Swaps between Mic and Send with nice Framer Motion effect */}
                  <div className="pb-1 shrink-0 flex items-center justify-center">
                    <AnimatePresence mode="wait">
                      {typedMessage.trim().length > 0 ? (
                        <motion.button
                          key="send"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.15 }}
                          whileTap={{ scale: 0.92 }}
                          whileHover={{ scale: 1.05 }}
                          onClick={() => {
                            if (editingMessage) {
                              handleEditMessageSubmit();
                            } else {
                              handleSendMessage({ text: typedMessage.trim() });
                            }
                          }}
                          className="w-8.5 h-8.5 rounded-full bg-theme-accent text-white flex items-center justify-center cursor-pointer shadow-md shadow-theme-accent/15 hover:opacity-95"
                          title="Send Message"
                        >
                          <Send size={14} className="ml-[1px]" />
                        </motion.button>
                      ) : (
                        <motion.button
                          key="mic"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.15 }}
                          whileTap={{ scale: 0.92 }}
                          whileHover={{ scale: 1.05 }}
                          onClick={startRecording}
                          className="w-8.5 h-8.5 rounded-full bg-theme-accent text-white flex items-center justify-center cursor-pointer shadow-md shadow-theme-accent/15 hover:opacity-95"
                          title="Record Voice Note"
                        >
                          <Mic size={15} />
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
                href={fullscreenImage} 
                download="attachment_image.png" 
                target="_blank" 
                rel="noreferrer" 
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

      {/* 4. PREMIUM FLOATING REACTION PORTAL */}
      {(() => {
        if (!selectedMsgId || !selectedMsgCoords) return null;
        const selectedMsg = messages.find(m => m.id === selectedMsgId);
        if (!selectedMsg) return null;

        const isSelf = selectedMsg.senderId === currentUserId;
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 600;

        let reactionBarTop = 0;
        let reactionBarLeft = 0;
        let optionsMenuTop = 0;
        let optionsMenuLeft = 0;

        const { top, left, width, height } = selectedMsgCoords;
        const isMobile = viewportWidth < 640;
        const reactionBarHeight = 46;
        const reactionBarWidth = isMobile ? Math.min(320, viewportWidth - 24) : 340;
        const optionsMenuHeight = selectedMsg.senderId === currentUserId ? 240 : 160;
        const optionsMenuWidth = 190;
        const gap = 8;

        // Try placing reaction bar above the message
        if (top - reactionBarHeight - gap > 70) {
          reactionBarTop = top - reactionBarHeight - gap;
          optionsMenuTop = top + height + gap;
        } else {
          reactionBarTop = top + height + gap;
          optionsMenuTop = top - optionsMenuHeight - gap;
        }

        // Center the reaction bar horizontally over the bubble
        const centerX = left + width / 2;
        reactionBarLeft = centerX - reactionBarWidth / 2;
        reactionBarLeft = Math.max(12, Math.min(viewportWidth - reactionBarWidth - 12, reactionBarLeft));

        // Align options menu based on message ownership
        if (isSelf) {
          optionsMenuLeft = left + width - optionsMenuWidth;
        } else {
          optionsMenuLeft = left;
        }
        optionsMenuLeft = Math.max(12, Math.min(viewportWidth - optionsMenuWidth - 12, optionsMenuLeft));

        // Fallback bounds checks for optionsMenuTop to avoid off-screen overflow
        if (optionsMenuTop < 70) {
          optionsMenuTop = Math.min(viewportHeight - optionsMenuHeight - 12, top + height + gap);
        } else if (optionsMenuTop + optionsMenuHeight > viewportHeight - 12) {
          optionsMenuTop = Math.max(70, top - optionsMenuHeight - gap);
        }

        return (
          <AnimatePresence>
            <div className="fixed inset-0 z-[100] overflow-hidden select-none pointer-events-auto">
              {/* Dark blur glassmorphism backdrop */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSelectedMsgId(null)}
                className="absolute inset-0 bg-black/55 backdrop-blur-[4px] cursor-pointer"
              />

              {/* Floating reaction picker */}
              <motion.div
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 420, damping: 28 }}
                style={{
                  position: 'fixed',
                  top: reactionBarTop,
                  left: reactionBarLeft,
                }}
                className="w-full max-w-[340px] h-[46px] bg-white/95 backdrop-blur-lg border border-gray-200 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.12)] flex items-center justify-between px-3 gap-1 z-[101]"
              >
                {["❤️", "👍", "😂", "🔥", "🎉", "😮", "😢", "🙏"].map((emoji, idx) => {
                  const hasReacted = selectedMsg.reactions?.[currentUserId] === emoji;
                  return (
                    <motion.button
                      key={emoji}
                      whileHover={{ scale: 1.35, y: -5 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 400, damping: 15 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerBurst(emoji, e);
                        handleReactToMessage(selectedMsg.id, emoji);
                        setSelectedMsgId(null);
                      }}
                      className={`text-xl p-1 rounded-full cursor-pointer transition-colors ${
                        hasReacted ? "bg-[#D4AF37]/25 ring-1 ring-[#D4AF37]/50" : "hover:bg-white/5"
                      }`}
                    >
                      {emoji}
                    </motion.button>
                  );
                })}
              </motion.div>

              {/* Custom Options Actions Menu */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 6 }}
                transition={{ type: "spring", stiffness: 400, damping: 28, delay: 0.04 }}
                style={{
                  position: 'fixed',
                  top: optionsMenuTop,
                  left: optionsMenuLeft,
                }}
                className="w-[190px] bg-[#0c0c0e]/95 backdrop-blur-lg border border-white/10 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] py-1.5 flex flex-col gap-0.5 z-[101]"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setReplyToMessage(selectedMsg);
                    setSelectedMsgId(null);
                  }}
                  className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-300 hover:text-white font-medium transition cursor-pointer"
                >
                  <Reply size={13} className="text-zinc-500" />
                  <span>Reply</span>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTogglePinMessage(selectedMsg.id, selectedMsg.pinned);
                    setSelectedMsgId(null);
                  }}
                  className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-300 hover:text-white font-medium transition cursor-pointer"
                >
                  <Pin size={13} className={`rotate-45 ${selectedMsg.pinned ? "text-[#D4AF37]" : "text-zinc-500"}`} />
                  <span>{selectedMsg.pinned ? "Unpin Message" : "Pin Message"}</span>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectedMsg.text) {
                      navigator.clipboard.writeText(selectedMsg.text);
                    }
                    setSelectedMsgId(null);
                  }}
                  className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-300 hover:text-white font-medium transition cursor-pointer"
                >
                  <Copy size={13} className="text-zinc-500" />
                  <span>Copy Text</span>
                </button>

                {selectedMsg.senderId === currentUserId && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingMessage(selectedMsg);
                        setSelectedMsgId(null);
                      }}
                      className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-300 hover:text-white font-medium transition cursor-pointer"
                    >
                      <Edit3 size={13} className="text-zinc-500" />
                      <span>Edit Message</span>
                    </button>

                    <div className="h-px bg-white/5 my-1" />

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteForEveryone(selectedMsg.id);
                        setSelectedMsgId(null);
                      }}
                      className="w-full px-4 py-2 hover:bg-red-500/10 flex items-center gap-3 text-xs text-red-400 font-semibold transition cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>Delete for Everyone</span>
                    </button>
                  </>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteForMe(selectedMsg.id);
                    setSelectedMsgId(null);
                  }}
                  className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-400 hover:text-white transition cursor-pointer"
                >
                  <X size={13} className="text-zinc-500" />
                  <span>Delete for Me</span>
                </button>
              </motion.div>
            </div>
          </AnimatePresence>
        );
      })()}

    </div>
  );
}
