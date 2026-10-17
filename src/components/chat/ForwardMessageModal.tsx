import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Forward, Search, X, Check, Loader2, MessageSquare, Send } from "lucide-react";
import { SmartImage } from "../SmartImage";
import { UserProfile } from "../../types";

export interface AvailableChat {
  id: string;
  name: string;
  avatarUrl?: string | null;
  isOnline?: boolean;
  isLegacy?: boolean;
  participantIds?: string[];
  otherUserId?: string;
  otherUser?: UserProfile | null;
  lastMessage?: string;
}

export type ForwardTargetChat = AvailableChat;

export interface ForwardMessageModalProps {
  isOpen: boolean;
  currentUserId?: string;
  availableChats?: AvailableChat[];
  chats?: ForwardTargetChat[];
  forwardMessages?: any[];
  messagesCount?: number;
  profilesCache?: Record<string, UserProfile>;
  onForward?: (targetChatIds: string[]) => Promise<void> | void;
  onForwardToChat?: (targetChat: ForwardTargetChat) => Promise<void>;
  onClose: () => void;
}

export const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({
  isOpen,
  currentUserId = "",
  availableChats,
  chats,
  forwardMessages,
  messagesCount,
  profilesCache = {},
  onForward,
  onForwardToChat,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Normalize chats list safely
  const rawList: AvailableChat[] = useMemo(() => {
    return availableChats || chats || [];
  }, [availableChats, chats]);

  // Compute number of messages being forwarded
  const totalMessagesCount = useMemo(() => {
    if (forwardMessages && Array.isArray(forwardMessages)) {
      return forwardMessages.length;
    }
    if (typeof messagesCount === "number") {
      return messagesCount;
    }
    return 1;
  }, [forwardMessages, messagesCount]);

  // Filter conversations based on query
  const filteredChats = useMemo(() => {
    const list = rawList || [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return list;

    return list.filter((c) => {
      if (!c) return false;
      const otherId = c.otherUserId || c.participantIds?.find((id) => id && id !== currentUserId);
      const profile = (otherId ? profilesCache[otherId] : null) || c.otherUser;

      const chatName = c.name?.toLowerCase() || "";
      const profileName = profile?.fullName?.toLowerCase() || "";
      const username = profile?.username?.toLowerCase() || "";
      const lastMsg = c.lastMessage?.toLowerCase() || "";

      return (
        chatName.includes(q) ||
        profileName.includes(q) ||
        username.includes(q) ||
        lastMsg.includes(q)
      );
    });
  }, [rawList, searchQuery, currentUserId, profilesCache]);

  const handleToggleSelectChat = (chatId: string) => {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  };

  const handleExecuteSend = async (targetIds: string[]) => {
    if (targetIds.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (onForward) {
        await onForward(targetIds);
      } else if (onForwardToChat) {
        for (const id of targetIds) {
          const target = rawList.find((c) => c.id === id);
          if (target) {
            await onForwardToChat(target);
          }
        }
      }
      setSelectedChatIds(new Set());
      onClose();
    } catch (err) {
      console.error("Forward execution failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        id="forward-message-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Forward message"
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-hidden select-none"
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/65 backdrop-blur-md cursor-pointer"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className="relative z-10 w-full sm:max-w-md bg-[#111216]/95 text-zinc-100 border border-white/[0.08] rounded-t-3xl sm:rounded-3xl shadow-[0_24px_64px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[600px] backdrop-blur-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 border-b border-white/[0.06] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/15 text-[#D4AF37] flex items-center justify-center">
                <Forward size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white tracking-tight">
                  Forward {totalMessagesCount > 1 ? `${totalMessagesCount} messages` : "message"}
                </h3>
                <p className="text-[11px] text-zinc-400">
                  {selectedChatIds.size > 0 
                    ? `${selectedChatIds.size} recipient${selectedChatIds.size > 1 ? "s" : ""} selected` 
                    : "Select a conversation to forward to"}
                </p>
              </div>
            </div>
            <button
              id="forward-modal-close-btn"
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-white/10 active:scale-90 text-zinc-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              title="Close"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Search Input */}
          <div className="p-3 border-b border-white/[0.05] bg-black/20 shrink-0">
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-zinc-400 pointer-events-none" />
              <input
                id="forward-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-8 pr-4 py-2 bg-white/[0.03] border border-white/[0.08] rounded-xl text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#D4AF37]/70 transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 text-zinc-400 hover:text-white transition cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1 scrollbar-none">
            {filteredChats.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center px-4">
                <MessageSquare size={32} className="text-zinc-600 mb-2" />
                <p className="text-xs sm:text-sm text-zinc-400">No conversations found</p>
              </div>
            ) : (
              filteredChats.map((chat) => {
                const otherId = chat.otherUserId || chat.participantIds?.find((id) => id && id !== currentUserId);
                const profile = (otherId ? profilesCache[otherId] : null) || chat.otherUser;
                const displayName = chat.name || profile?.fullName || profile?.username || "Conversation";
                const displayPhoto = chat.avatarUrl || profile?.photoUrl || profile?.profilePhotoUrl;
                const isSelected = selectedChatIds.has(chat.id);

                return (
                  <div
                    key={chat.id}
                    id={`forward-item-${chat.id}`}
                    onClick={() => handleToggleSelectChat(chat.id)}
                    className={`flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition select-none ${
                      isSelected 
                        ? "bg-[#D4AF37]/15 border border-[#D4AF37]/35" 
                        : "hover:bg-white/[0.04] border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                      <div className="relative shrink-0">
                        <SmartImage
                          src={displayPhoto}
                          alt={displayName}
                          className="w-10 h-10 rounded-full object-cover border border-white/10"
                          fallbackType="profile"
                          fullName={displayName}
                        />
                        {chat.isOnline && (
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-[#111216]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-semibold text-white truncate">
                          {displayName}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate">
                          {chat.lastMessage || (profile?.username ? `@${profile.username}` : "SwapSkill chat")}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center border transition ${
                          isSelected
                            ? "bg-[#D4AF37] border-[#D4AF37] text-black"
                            : "border-zinc-600 bg-white/5"
                        }`}
                      >
                        {isSelected && <Check size={12} strokeWidth={3} />}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Send Action Toolbar */}
          <div className="p-3.5 border-t border-white/[0.06] bg-black/25 flex items-center justify-between gap-3 shrink-0">
            <div className="text-xs text-zinc-400 truncate">
              {selectedChatIds.size === 0 ? (
                <span>Select at least 1 chat</span>
              ) : (
                <span className="text-white font-medium">
                  {selectedChatIds.size} recipient{selectedChatIds.size > 1 ? "s" : ""} selected
                </span>
              )}
            </div>

            <button
              id="forward-modal-send-btn"
              type="button"
              disabled={selectedChatIds.size === 0 || isSubmitting}
              onClick={() => handleExecuteSend(Array.from(selectedChatIds))}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer shrink-0 ${
                selectedChatIds.size > 0 && !isSubmitting
                  ? "bg-[#D4AF37] hover:bg-[#c49f2e] text-black shadow-md shadow-[#D4AF37]/20 active:scale-95"
                  : "bg-white/10 text-zinc-500 cursor-not-allowed border border-white/5"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Forwarding...</span>
                </>
              ) : (
                <>
                  <Send size={13} />
                  <span>Forward</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ForwardMessageModal;
