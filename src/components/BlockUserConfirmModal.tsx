import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Ban, Unlock, Loader2, X, AlertTriangle } from "lucide-react";
import SmartImage from "./SmartImage";

export interface BlockTargetUser {
  uid: string;
  username?: string;
  fullName?: string;
  photoUrl?: string;
}

interface BlockUserConfirmModalProps {
  isOpen: boolean;
  mode: "block" | "unblock";
  targetUser: BlockTargetUser | null;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export default function BlockUserConfirmModal({
  isOpen,
  mode,
  targetUser,
  onConfirm,
  onClose
}: BlockUserConfirmModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  // Reset state when opening/closing
  useEffect(() => {
    if (!isOpen) {
      setIsProcessing(false);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isProcessing) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isProcessing, onClose]);

  if (!isOpen || !targetUser) return null;

  const handleAction = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await onConfirm();
    } catch (err) {
      console.error("Error executing block/unblock action:", err);
      setIsProcessing(false);
    }
  };

  const usernameText = targetUser.username 
    ? `@${targetUser.username}` 
    : targetUser.fullName 
      ? targetUser.fullName 
      : "this user";

  const isBlockMode = mode === "block";

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-[250] flex items-center justify-center p-4 select-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-dialog-title"
      >
        {/* Backdrop - Tapping backdrop CANCELS, never confirms */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => {
            if (!isProcessing) onClose();
          }}
          className="absolute inset-0 bg-black/75 backdrop-blur-md"
        />

        {/* Modal Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 15 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-sm bg-[#141417] text-[#F7F4EE] border border-white/10 rounded-3xl p-6 shadow-2xl overflow-hidden z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top Close Icon */}
          <button
            onClick={() => {
              if (!isProcessing) onClose();
            }}
            disabled={isProcessing}
            className="absolute top-4 right-4 p-2 rounded-full text-[#A1A1AA] hover:text-white hover:bg-white/10 transition cursor-pointer disabled:opacity-40"
            title="Cancel"
          >
            <X size={18} />
          </button>

          {/* User Icon / Avatar Block */}
          <div className="flex flex-col items-center text-center mt-2 mb-4">
            <div className="relative mb-3.5">
              <div className="w-16 h-16 rounded-full border-2 border-white/15 overflow-hidden shadow-lg flex items-center justify-center bg-[#1A1A1D]">
                <SmartImage
                  src={targetUser.photoUrl}
                  alt={targetUser.fullName || "User"}
                  className="w-full h-full object-cover"
                  fallbackType="profile"
                  fullName={targetUser.fullName}
                  sizeType="standard"
                />
              </div>
              <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center border-2 border-[#141417] shadow-sm ${
                isBlockMode ? "bg-rose-600 text-white" : "bg-[#C9A96E] text-[#0D0D0F]"
              }`}>
                {isBlockMode ? <Ban size={12} strokeWidth={2.5} /> : <Unlock size={12} strokeWidth={2.5} />}
              </div>
            </div>

            {/* Title */}
            <h3 id="block-dialog-title" className="text-base font-bold text-[#F7F4EE] tracking-tight font-display">
              {isBlockMode ? "Block this user?" : "Unblock this user?"}
            </h3>

            {/* Body Text */}
            <p className="text-xs text-[#A1A1AA] mt-2 leading-relaxed max-w-xs">
              {isBlockMode
                ? `Are you sure you want to block ${usernameText}? They won't be able to message, connect with, or interact with you.`
                : `Are you sure you want to unblock ${usernameText}?`}
            </p>
          </div>

          {/* Actions: Cancel | Confirm */}
          <div className="flex items-center gap-3 mt-6">
            <button
              type="button"
              id="block-modal-cancel-btn"
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1 h-11 px-4 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 active:bg-white/15 text-[#F7F4EE] text-xs font-semibold transition cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>

            <button
              type="button"
              id="block-modal-confirm-btn"
              onClick={handleAction}
              disabled={isProcessing}
              className={`flex-1 h-11 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-md disabled:opacity-60 active:scale-98 ${
                isBlockMode
                  ? "bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white"
                  : "bg-[#C9A96E] hover:bg-[#D8BA80] active:bg-[#B8985C] text-[#0D0D0F]"
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>{isBlockMode ? "Blocking..." : "Unblocking..."}</span>
                </>
              ) : (
                <span>{isBlockMode ? "Block" : "Unblock"}</span>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
