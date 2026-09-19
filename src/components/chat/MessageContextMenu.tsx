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
  X 
} from "lucide-react";
import { isMessageDeleted, MessageDeleteTarget } from "./DeleteMessageConfirmModal";

export interface ContextMenuMessage extends MessageDeleteTarget {
  id: string;
  senderId: string;
  text?: string;
  pinned?: boolean;
  reactions?: Record<string, string>;
  imageUrl?: string;
  audioUrl?: string;
  fileUrl?: string;
}

interface MessageContextMenuProps {
  isOpen: boolean;
  selectedMsg: ContextMenuMessage | null;
  coords: { top: number; left: number; width: number; height: number } | null;
  currentUserId: string;
  onReact: (emoji: string) => void;
  onReply: (msg: ContextMenuMessage) => void;
  onCopy: (msg: ContextMenuMessage) => void;
  onForward: (msg: ContextMenuMessage) => void;
  onSelect: (msg: ContextMenuMessage) => void;
  onTogglePin: (msg: ContextMenuMessage) => void;
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
  const reactionBarHeight = 46;
  const reactionBarWidth = Math.min(300, viewportWidth - 32);
  const optionsMenuWidth = 195;
  const optionsMenuHeight = isDeleted ? 100 : (isSelf ? 260 : 210);
  const gap = 8;

  let reactionBarTop = 0;
  let reactionBarLeft = 0;
  let optionsMenuTop = 0;
  let optionsMenuLeft = 0;

  if (coords) {
    const { top, left, width, height } = coords;

    // Determine vertical placement: try above first, otherwise below
    const spaceAbove = top - 70;
    const spaceBelow = viewportHeight - (top + height) - 20;

    if (spaceAbove >= reactionBarHeight + gap) {
      reactionBarTop = top - reactionBarHeight - gap;
      if (spaceBelow >= optionsMenuHeight + gap) {
        optionsMenuTop = top + height + gap;
      } else {
        optionsMenuTop = Math.max(70, top - optionsMenuHeight - gap - reactionBarHeight);
      }
    } else {
      reactionBarTop = top + height + gap;
      optionsMenuTop = reactionBarTop + reactionBarHeight + gap;
    }

    // Center the reaction bar horizontally over the message bubble
    const centerX = left + width / 2;
    reactionBarLeft = Math.max(16, Math.min(viewportWidth - reactionBarWidth - 16, centerX - reactionBarWidth / 2));

    // Align options menu based on message ownership
    if (isSelf) {
      optionsMenuLeft = Math.max(16, Math.min(viewportWidth - optionsMenuWidth - 16, left + width - optionsMenuWidth));
    } else {
      optionsMenuLeft = Math.max(16, Math.min(viewportWidth - optionsMenuWidth - 16, left));
    }

    // Final boundary safety clamps
    if (optionsMenuTop + optionsMenuHeight > viewportHeight - 16) {
      optionsMenuTop = Math.max(70, viewportHeight - optionsMenuHeight - 16);
    }
    if (optionsMenuTop < 70) {
      optionsMenuTop = 70;
    }
  } else {
    // Fallback: screen center
    reactionBarTop = Math.max(70, viewportHeight / 2 - 120);
    reactionBarLeft = (viewportWidth - reactionBarWidth) / 2;
    optionsMenuTop = reactionBarTop + reactionBarHeight + 12;
    optionsMenuLeft = (viewportWidth - optionsMenuWidth) / 2;
  }

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
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/55 backdrop-blur-[4px] cursor-pointer"
        />

        {/* 1. Quick Emoji Reaction Bar (Disabled for deleted messages) */}
        {!isDeleted && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 440, damping: 28 }}
            style={{
              position: "fixed",
              top: reactionBarTop,
              left: reactionBarLeft,
              width: reactionBarWidth,
            }}
            className="h-[46px] bg-[#1A1A1E]/95 backdrop-blur-md border border-white/10 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex items-center justify-between px-3 gap-1 z-[111]"
            onClick={(e) => e.stopPropagation()}
          >
            {EMOJI_REACTIONS.map((emoji) => {
              const hasReacted = selectedMsg.reactions?.[currentUserId] === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onReact(emoji);
                    onClose();
                  }}
                  className={`text-xl p-1 rounded-full cursor-pointer transition-transform hover:scale-125 active:scale-95 ${
                    hasReacted ? "bg-[#D4AF37]/25 ring-1 ring-[#D4AF37]/60" : "hover:bg-white/10"
                  }`}
                  title={`React ${emoji}`}
                  aria-label={`React ${emoji}`}
                >
                  {emoji}
                </button>
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
          }}
          className="bg-[#121216]/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.65)] py-1.5 flex flex-col z-[111] overflow-hidden"
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
                className="w-full px-4 py-2.5 hover:bg-white/5 flex items-center gap-3 text-xs text-red-400 hover:text-red-300 font-medium transition cursor-pointer"
              >
                <Trash2 size={14} className="text-red-400" />
                <span>Delete for me</span>
              </button>
              <div className="h-px bg-white/5 my-0.5" />
              <button
                type="button"
                onClick={onClose}
                className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
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
                className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
              >
                <Reply size={14} className="text-zinc-400" />
                <span>Reply</span>
              </button>

              {/* Copy Text */}
              {selectedMsg.text && (
                <button
                  id="btn-context-copy"
                  type="button"
                  onClick={() => {
                    onCopy(selectedMsg);
                    onClose();
                  }}
                  className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
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
                className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
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
                className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
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
                className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
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
                  className="w-full px-4 py-2 hover:bg-white/5 flex items-center gap-3 text-xs text-zinc-200 hover:text-white font-medium transition cursor-pointer"
                >
                  <Edit3 size={14} className="text-zinc-400" />
                  <span>Edit Message</span>
                </button>
              )}

              <div className="h-px bg-white/5 my-0.5" />

              {/* Delete */}
              <button
                id="btn-context-delete"
                type="button"
                onClick={() => {
                  onDelete(selectedMsg);
                  onClose();
                }}
                className="w-full px-4 py-2 hover:bg-red-500/10 flex items-center gap-3 text-xs text-red-400 hover:text-red-300 font-medium transition cursor-pointer"
              >
                <Trash2 size={14} className="text-red-400" />
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
