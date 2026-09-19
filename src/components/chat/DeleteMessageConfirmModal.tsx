import React, { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Trash2 } from "lucide-react";

export interface MessageDeleteTarget {
  id: string;
  senderId: string;
  text?: string;
  deleted?: boolean;
  isDeleted?: boolean;
  deletedFor?: string[];
}

interface DeleteMessageConfirmModalProps {
  isOpen: boolean;
  targetMessages: MessageDeleteTarget[];
  currentUserId: string;
  onDeleteForEveryone: () => void;
  onDeleteForMe: () => void;
  onClose: () => void;
}

export const isMessageDeleted = (m?: MessageDeleteTarget | null): boolean => {
  if (!m) return false;
  return Boolean(m.deleted || m.isDeleted || m.text === "This message was deleted");
};

export const DeleteMessageConfirmModal: React.FC<DeleteMessageConfirmModalProps> = ({
  isOpen,
  targetMessages,
  currentUserId,
  onDeleteForEveryone,
  onDeleteForMe,
  onClose
}) => {
  const hasTriggeredRef = useRef(false);

  // Reset trigger lock whenever modal opens
  useEffect(() => {
    if (isOpen) {
      hasTriggeredRef.current = false;
    }
  }, [isOpen]);

  if (!isOpen || targetMessages.length === 0) return null;

  const count = targetMessages.length;
  const isMultiple = count > 1;

  // Can only delete for everyone if all target messages are sent by current user and none are already deleted
  const canDeleteForEveryone = targetMessages.every(
    (m) => m.senderId === currentUserId && !isMessageDeleted(m)
  );

  const handleAction = (action: "everyone" | "me") => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;
    
    // Close immediately to prevent reopening or hanging UI
    onClose();
    
    if (action === "everyone") {
      onDeleteForEveryone();
    } else {
      onDeleteForMe();
    }
  };

  return (
    <AnimatePresence>
      <div 
        id="delete-message-modal-overlay"
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-2.5 sm:p-4 overflow-hidden select-none"
      >
        {/* Subtle, non-intrusive backdrop with gentle dimming */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/35 backdrop-blur-[2px] cursor-pointer"
        />

        {/* Compact WhatsApp-inspired Sheet */}
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 460, damping: 34 }}
          className="relative z-10 w-full max-w-[340px] sm:max-w-[310px] bg-[#18181C] text-zinc-100 border border-white/10 rounded-2xl shadow-[0_16px_36px_rgba(0,0,0,0.55)] p-3 sm:p-3.5 overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Subtle mobile sheet drag indicator */}
          <div className="w-8 h-1 rounded-full bg-white/20 mx-auto mt-0.5 mb-2 sm:hidden" />

          {/* Compact Header */}
          <div className="flex items-center gap-2.5 px-1 pt-0.5 pb-2">
            <div className="w-7 h-7 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
              <Trash2 size={13} strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[13.5px] font-semibold text-zinc-100 tracking-tight leading-tight">
                {isMultiple ? `Delete ${count} messages?` : "Delete message?"}
              </h3>
            </div>
          </div>

          {/* Action List - Native WhatsApp stacked action items */}
          <div className="flex flex-col gap-1.5 pt-1">
            {canDeleteForEveryone && (
              <button
                id="btn-delete-for-everyone"
                type="button"
                onClick={() => handleAction("everyone")}
                className="w-full h-10 px-3.5 rounded-xl bg-rose-500/[0.09] hover:bg-rose-500/[0.15] active:bg-rose-500/[0.2] border border-rose-500/25 text-rose-400 hover:text-rose-300 text-[13px] font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-[0.99] touch-manipulation"
              >
                <Trash2 size={13} className="opacity-80 shrink-0" />
                <span>Delete for everyone</span>
              </button>
            )}

            <button
              id="btn-delete-for-me"
              type="button"
              onClick={() => handleAction("me")}
              className="w-full h-10 px-3.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] active:bg-white/[0.12] border border-white/10 text-zinc-200 hover:text-white text-[13px] font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-[0.99] touch-manipulation"
            >
              <span>Delete for me</span>
            </button>

            <button
              id="btn-delete-cancel"
              type="button"
              onClick={onClose}
              className="w-full h-9 px-3 rounded-xl text-zinc-400 hover:text-zinc-200 active:text-zinc-100 hover:bg-white/[0.04] text-[13px] font-medium flex items-center justify-center transition-colors cursor-pointer touch-manipulation mt-0.5"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default DeleteMessageConfirmModal;
