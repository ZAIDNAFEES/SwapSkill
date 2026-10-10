import React, { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Reply, 
  Copy, 
  Forward, 
  CheckSquare, 
  Pin, 
  Edit3, 
  Trash2, 
  X,
  Star,
  Info 
} from "lucide-react";
import { isMessageDeleted, MessageDeleteTarget } from "./DeleteMessageConfirmModal";

export interface ContextMenuMessage extends MessageDeleteTarget {
  id: string;
  senderId: string;
  text?: string;
  pinned?: boolean;
  starredBy?: string[];
  reactions?: Record<string, string>;
  imageUrl?: string;
  audioUrl?: string;
  fileUrl?: string;
  status?: "sent" | "delivered" | "seen";
  timestamp?: any;
  deliveredAt?: any;
  readAt?: any;
}

interface MessageContextMenuProps {
  isOpen: boolean;
  selectedMsg: ContextMenuMessage | null;
  coords: { top: number; left: number; width: number; height: number } | null;
  currentUserId: string;
  onReact: (emoji: string, e?: React.MouseEvent) => void;
  onReply: (msg: ContextMenuMessage) => void;
  onCopy: (msg: ContextMenuMessage) => void;
  onForward: (msg: ContextMenuMessage) => void;
  onSelect: (msg: ContextMenuMessage) => void;
  onTogglePin: (msg: ContextMenuMessage) => void;
  onToggleStar?: (msg: ContextMenuMessage) => void;
  onMessageInfo?: (msg: ContextMenuMessage) => void;
  onEdit: (msg: ContextMenuMessage) => void;
  onDelete: (msg: ContextMenuMessage) => void;
  onClose: () => void;
}

const EMOJI_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

export const MessageContextMenu: React.FC<MessageContextMenuProps> = ({
  isOpen,
  selectedMsg,
  coords,
  currentUserId,
  onReact,
  onReply,
  onCopy,
  onForward,
  onSelect,
  onTogglePin,
  onToggleStar,
  onMessageInfo,
  onEdit,
  onDelete,
  onClose,
}) => {
  // Dismiss on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !selectedMsg) return null;

  const isSelf = selectedMsg.senderId === currentUserId;
  const isDeleted = isMessageDeleted(selectedMsg);

  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 600;

  // Sizing & Positioning calculations
  const reactionBarHeight = 48;
  const reactionBarWidth = Math.min(290, viewportWidth - 32);
  const optionsMenuWidth = 205;
  const optionsMenuHeight = isDeleted ? 90 : (isSelf ? (selectedMsg.text ? 335 : 295) : 285);
  const gap = 10;
  const topSafeInset = 64; // Header height
  const bottomSafeInset = 24; // Composer or safe area clearance

  let reactionBarTop = 0;
  let reactionBarLeft = 0;
  let optionsMenuTop = 0;
  let optionsMenuLeft = 0;

  if (coords) {
    const { top, left, width, height } = coords;
    const bubbleBottom = top + height;

    const spaceAbove = top - topSafeInset;
    const spaceBelow = viewportHeight - bubbleBottom - bottomSafeInset;

    // Decision tree:
    if (spaceAbove >= reactionBarHeight + gap && spaceBelow >= optionsMenuHeight) {
      // 1. Ideal layout: Reaction bar above bubble, options menu below bubble
      reactionBarTop = top - reactionBarHeight - gap;
      optionsMenuTop = bubbleBottom + gap;
    } else if (spaceBelow >= reactionBarHeight + gap + optionsMenuHeight) {
      // 2. Both fit below the bubble
      reactionBarTop = bubbleBottom + gap;
      optionsMenuTop = reactionBarTop + reactionBarHeight + gap;
    } else if (spaceAbove >= reactionBarHeight + gap + optionsMenuHeight) {
      // 3. Both fit above the bubble
      optionsMenuTop = top - optionsMenuHeight - gap;
      reactionBarTop = optionsMenuTop - reactionBarHeight - gap;
    } else {
      // 4. Space is tight (e.g., small screen or message near the bottom)
      if (spaceBelow > spaceAbove) {
        reactionBarTop = Math.max(topSafeInset, bubbleBottom + gap);
        optionsMenuTop = reactionBarTop + reactionBarHeight + gap;
      } else {
        const availableHeight = viewportHeight - topSafeInset - bottomSafeInset;
        if (availableHeight >= reactionBarHeight + gap + 180) {
          reactionBarTop = Math.max(topSafeInset, top - optionsMenuHeight - reactionBarHeight - (gap * 2));
          optionsMenuTop = reactionBarTop + reactionBarHeight + gap;
        } else {
          reactionBarTop = topSafeInset;
          optionsMenuTop = reactionBarTop + reactionBarHeight + gap;
        }
      }
    }

    // STRICT ANTI-COLLISION ENFORCEMENT:
    if (!isDeleted) {
      const minOptionsMenuTop = reactionBarTop + reactionBarHeight + gap;
      if (optionsMenuTop < minOptionsMenuTop) {
        optionsMenuTop = minOptionsMenuTop;
      }
    }

    // Horizontal centering & alignment
    const centerX = left + width / 2;
    reactionBarLeft = Math.max(16, Math.min(viewportWidth - reactionBarWidth - 16, centerX - reactionBarWidth / 2));

    if (isSelf) {
      optionsMenuLeft = Math.max(16, Math.min(viewportWidth - optionsMenuWidth - 16, left + width - optionsMenuWidth));
    } else {
      optionsMenuLeft = Math.max(16, Math.min(viewportWidth - optionsMenuWidth - 16, left));
    }
  } else {
    // Fallback: screen center with guaranteed separation
    reactionBarTop = Math.max(topSafeInset, viewportHeight / 2 - 160);
    reactionBarLeft = (viewportWidth - reactionBarWidth) / 2;
    optionsMenuTop = reactionBarTop + reactionBarHeight + gap;
    optionsMenuLeft = (viewportWidth - optionsMenuWidth) / 2;
  }

  const maxMenuHeight = Math.max(140, viewportHeight - optionsMenuTop - bottomSafeInset);

  return (
    <AnimatePresence>
      <div 
        id="msg-context-menu-portal"
        className="fixed inset-0 z-[110] overflow-hidden select-none pointer-events-auto"
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-[3px] cursor-pointer"
        />

        {/* 1. Quick Emoji Reaction Bar (Disabled for deleted messages) */}
        {!isDeleted && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 440, damping: 28 }}
            style={{
              position: "fixed",
              top: reactionBarTop,
              left: reactionBarLeft,
              width: reactionBarWidth,
            }}
            className="h-[48px] bg-[#141418]/95 backdrop-blur-xl border border-white/[0.08] rounded-full shadow-[0_12px_36px_rgba(0,0,0,0.65)] flex items-center justify-between px-3 gap-1 z-[111]"
            onClick={(e) => e.stopPropagation()}
          >
            {EMOJI_REACTIONS.map((emoji, idx) => {
              const hasReacted = selectedMsg.reactions?.[currentUserId] === emoji;
              return (
                <motion.button
                  key={emoji}
                  type="button"
                  initial={{ scale: 0, opacity: 0, y: 8 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03, type: "spring", stiffness: 480, damping: 20 }}
                  whileHover={{ scale: 1.35, y: -3 }}
                  whileTap={{ scale: 0.85 }}
                  onClick={(e) => {
                    onReact(emoji, e);
                    onClose();
                  }}
                  className={`text-xl p-1.5 rounded-full cursor-pointer transition-colors ${
                    hasReacted ? "bg-[#D4AF37]/20 ring-1 ring-[#D4AF37]/60" : "hover:bg-white/10"
                  }`}
                  title={`React ${emoji}`}
                  aria-label={`React ${emoji}`}
                >
                  {emoji}
                </motion.button>
              );
            })}
          </motion.div>
        )}

        {/* 2. Options Menu Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 6 }}
          transition={{ type: "spring", stiffness: 420, damping: 28, delay: 0.02 }}
          style={{
            position: "fixed",
            top: optionsMenuTop,
            left: optionsMenuLeft,
            width: optionsMenuWidth,
            maxHeight: maxMenuHeight,
          }}
          className="bg-[#141418]/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] py-1.5 flex flex-col z-[111] overflow-y-auto scrollbar-none"
          onClick={(e) => e.stopPropagation()}
        >
          {isDeleted ? (
            /* Deleted Message: ONLY allow Delete for me to clear tombstone */
            <>
              <button
                id="btn-context-delete-for-me-only"
                type="button"
                onClick={() => {
                  onDelete(selectedMsg);
                  onClose();
                }}
                className="w-full px-3.5 py-2 hover:bg-white/[0.06] flex items-center gap-3 text-xs text-rose-400 hover:text-rose-300 font-medium transition cursor-pointer"
              >
                <Trash2 size={14} className="text-rose-400" />
                <span>Delete for me</span>
              </button>
              <div className="h-px bg-white/[0.06] my-0.5" />
              <button
                type="button"
                onClick={onClose}
                className="w-full px-3.5 py-2 hover:bg-white/[0.06] flex items-center gap-3 text-xs text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
              >
                <X size={14} />
                <span>Cancel</span>
              </button>
            </>
          ) : (
            /* Normal Active Message */
            <>
              {/* Reply */}
              <button
                id="btn-context-reply"
                type="button"
                onClick={() => {
                  onReply(selectedMsg);
                  onClose();
                }}
                className="w-full px-3.5 py-2 hover:bg-white/[0.06] flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
              >
                <Reply size={14} className="text-[#D4AF37]" />
                <span>Reply</span>
              </button>

              {/* Star / Unstar */}
              {onToggleStar && (
                <button
                  id="btn-context-star"
                  type="button"
                  onClick={() => {
                    onToggleStar(selectedMsg);
                    onClose();
                  }}
                  className="w-full px-3.5 py-2 hover:bg-white/[0.06] flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
                >
                  <Star
                    size={14}
                    className={
                      selectedMsg.starredBy?.includes(currentUserId)
                        ? "text-amber-400 fill-amber-400"
                        : "text-zinc-400"
                    }
                  />
                  <span>
                    {selectedMsg.starredBy?.includes(currentUserId) ? "Unstar Message" : "Star Message"}
                  </span>
                </button>
              )}

              {/* Message Info */}
              {onMessageInfo && (
                <button
                  id="btn-context-info"
                  type="button"
                  onClick={() => {
                    onMessageInfo(selectedMsg);
                    onClose();
                  }}
                  className="w-full px-3.5 py-2 hover:bg-white/[0.06] flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
                >
                  <Info size={14} className="text-zinc-400" />
                  <span>Message Info</span>
                </button>
              )}

              {/* Copy Text */}
              {selectedMsg.text && (
                <button
                  id="btn-context-copy"
                  type="button"
                  onClick={() => {
                    onCopy(selectedMsg);
                    onClose();
                  }}
                  className="w-full px-3.5 py-2 hover:bg-white/[0.06] flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
                >
                  <Copy size={14} className="text-zinc-400" />
                  <span>Copy Text</span>
                </button>
              )}

              {/* Forward */}
              <button
                id="btn-context-forward"
                type="button"
                onClick={() => {
                  onForward(selectedMsg);
                  onClose();
                }}
                className="w-full px-3.5 py-2 hover:bg-white/[0.06] flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
              >
                <Forward size={14} className="text-zinc-400" />
                <span>Forward</span>
              </button>

              {/* Select */}
              <button
                id="btn-context-select"
                type="button"
                onClick={() => {
                  onSelect(selectedMsg);
                  onClose();
                }}
                className="w-full px-3.5 py-2 hover:bg-white/[0.06] flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
              >
                <CheckSquare size={14} className="text-zinc-400" />
                <span>Select Message</span>
              </button>

              {/* Pin / Unpin */}
              <button
                id="btn-context-pin"
                type="button"
                onClick={() => {
                  onTogglePin(selectedMsg);
                  onClose();
                }}
                className="w-full px-3.5 py-2 hover:bg-white/[0.06] flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
              >
                <Pin size={14} className={selectedMsg.pinned ? "text-[#D4AF37] rotate-45" : "text-zinc-400"} />
                <span>{selectedMsg.pinned ? "Unpin Message" : "Pin Message"}</span>
              </button>

              {/* Edit (Own text messages only) */}
              {isSelf && selectedMsg.text && (
                <button
                  id="btn-context-edit"
                  type="button"
                  onClick={() => {
                    onEdit(selectedMsg);
                    onClose();
                  }}
                  className="w-full px-3.5 py-2 hover:bg-white/[0.06] flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
                >
                  <Edit3 size={14} className="text-zinc-400" />
                  <span>Edit Message</span>
                </button>
              )}

              <div className="h-px bg-white/[0.06] my-1" />

              {/* Delete */}
              <button
                id="btn-context-delete"
                type="button"
                onClick={() => {
                  onDelete(selectedMsg);
                  onClose();
                }}
                className="w-full px-3.5 py-2 hover:bg-rose-500/10 flex items-center gap-3 text-xs text-rose-400 hover:text-rose-300 font-medium transition cursor-pointer"
              >
                <Trash2 size={14} className="text-rose-400" />
                <span>Delete...</span>
              </button>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default MessageContextMenu;
