import React, { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Check, CheckCheck, Clock, FileText, Mic, Image as ImageIcon } from "lucide-react";

export interface MessageInfoData {
  id: string;
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  fileUrl?: string;
  fileName?: string;
  status?: "sent" | "delivered" | "seen";
  isRead?: boolean;
  timestamp?: any;
  deliveredAt?: any;
  readAt?: any;
}

interface MessageInfoModalProps {
  isOpen: boolean;
  message: MessageInfoData | null;
  onClose: () => void;
}

export const MessageInfoModal: React.FC<MessageInfoModalProps> = ({ isOpen, message, onClose }) => {
  // Dismiss on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !message) return null;

  const formatExactTime = (val: any) => {
    if (!val) return null;
    try {
      let date: Date | null = null;
      if (typeof val === "number") date = new Date(val);
      else if (val?.toDate) date = val.toDate();
      else if (val?.seconds !== undefined) date = new Date(val.seconds * 1000);
      else if (val instanceof Date) date = val;
      else if (typeof val === "string") {
        const p = Date.parse(val);
        if (!isNaN(p)) date = new Date(p);
      }
      if (!date || isNaN(date.getTime())) return null;

      const dateStr = date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
      const timeStr = date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
      return `${dateStr} · ${timeStr}`;
    } catch {
      return null;
    }
  };

  const isMessageRead = Boolean(message.isRead || message.status === "seen");
  const sentTime = formatExactTime(message.timestamp) || "Just now";
  const deliveredTime = formatExactTime(message.deliveredAt) || (message.status === "delivered" || isMessageRead ? sentTime : "Pending");
  const readTime = formatExactTime(message.readAt) || (isMessageRead ? (formatExactTime(message.timestamp) || "Read") : null);

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Message Info"
        className="fixed inset-0 z-[120] flex items-center justify-center p-4 select-none"
      >
        {/* Soft luxury backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 bg-black/65 backdrop-blur-md cursor-pointer"
          onClick={onClose}
        />

        {/* Minimalist High-End Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 8 }}
          transition={{ type: "spring", stiffness: 440, damping: 30 }}
          className="relative z-10 w-full max-w-[320px] bg-[#111216]/95 text-zinc-100 border border-white/[0.08] rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.7),0_0_1px_rgba(255,255,255,0.15)] p-4 overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]" />
              <h4 className="text-xs font-semibold text-white tracking-wide">
                Message Info
              </h4>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 rounded-full hover:bg-white/10 active:scale-90 text-zinc-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              aria-label="Close message info"
            >
              <X size={14} />
            </button>
          </div>

          {/* Minimal Content Preview Inset */}
          <div className="my-3 p-3 rounded-xl bg-white/[0.025] border border-white/[0.05] text-xs text-zinc-200">
            {message.imageUrl && (
              <div className="relative w-full h-24 rounded-lg overflow-hidden mb-2 bg-black/40 border border-white/5">
                <img
                  src={message.imageUrl}
                  alt="Message attachment"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            {message.audioUrl && (
              <div className="flex items-center gap-2.5 py-0.5 text-zinc-300">
                <div className="w-6 h-6 rounded-lg bg-[#D4AF37]/15 text-[#D4AF37] flex items-center justify-center shrink-0">
                  <Mic size={12} />
                </div>
                <span className="text-[11px] font-medium">Voice note</span>
              </div>
            )}
            {message.fileUrl && (
              <div className="flex items-center gap-2.5 py-0.5 text-zinc-300 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-[#D4AF37]/15 text-[#D4AF37] flex items-center justify-center shrink-0">
                  <FileText size={12} />
                </div>
                <span className="text-[11px] font-medium truncate flex-1">
                  {message.fileName || "Document"}
                </span>
              </div>
            )}
            {message.text && (
              <p className="line-clamp-3 leading-relaxed text-zinc-300 [overflow-wrap:anywhere] break-words text-[12px]">
                "{message.text}"
              </p>
            )}
          </div>

          {/* Status Timeline Ledger */}
          <div className="space-y-1 pt-1">
            {/* Read */}
            <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-md bg-sky-500/15 text-sky-400 flex items-center justify-center shrink-0">
                  <CheckCheck size={13} strokeWidth={2.4} />
                </div>
                <span className="text-xs font-medium text-zinc-200">Read</span>
              </div>
              <span className={`text-[11px] font-mono tabular-nums ${isMessageRead ? "text-sky-400 font-medium" : "text-zinc-500"}`}>
                {readTime || "Not yet read"}
              </span>
            </div>

            {/* Delivered */}
            <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-md bg-white/[0.06] text-zinc-400 flex items-center justify-center shrink-0">
                  <CheckCheck size={13} strokeWidth={2.4} />
                </div>
                <span className="text-xs font-medium text-zinc-200">Delivered</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                {deliveredTime}
              </span>
            </div>

            {/* Sent */}
            <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-md bg-white/[0.06] text-zinc-400 flex items-center justify-center shrink-0">
                  <Check size={13} strokeWidth={2.4} />
                </div>
                <span className="text-xs font-medium text-zinc-200">Sent</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                {sentTime}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default MessageInfoModal;
