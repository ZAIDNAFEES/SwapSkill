import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, MessageSquare, Send, X, CornerDownRight, Sparkles } from "lucide-react";
import { auth } from "../firebase";
import { DEFAULT_AVATAR } from "../types";
import { triggerHapticFeedback } from "../utils/sound";
import { activeChatTrackingService } from "../services/activeChatTrackingService";
import { mobileDeepLinkService } from "../services/mobile/deepLinks";

export interface NewMessagePayload {
  chatId: string;
  messageId?: string;
  senderName: string;
  senderPhoto?: string;
  senderId?: string;
  message: string;
}

export default function InAppMessageNotification() {
  const [activeMessage, setActiveMessage] = useState<NewMessagePayload | null>(null);
  const [isReplying, setIsReplying] = useState<boolean>(false);
  const [replyText, setReplyText] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const autoDismissTimerRef = useRef<NodeJS.Timeout | null>(null);
  const replyInputRef = useRef<HTMLInputElement | null>(null);

  // Clear dismiss timer
  const clearTimer = () => {
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
  };

  // Start auto-dismiss timer (7 seconds)
  const startTimer = () => {
    clearTimer();
    autoDismissTimerRef.current = setTimeout(() => {
      handleDismiss();
    }, 7000);
  };

  const handleDismiss = () => {
    clearTimer();
    setActiveMessage(null);
    setIsReplying(false);
    setReplyText("");
    setActionFeedback(null);
    setIsSubmitting(false);
  };

  // Listen to new message notifications dispatched across the app
  useEffect(() => {
    const handleNewMessage = (e: Event) => {
      const customEvent = e as CustomEvent<NewMessagePayload>;
      const detail = customEvent.detail;
      if (!detail || !detail.chatId) return;

      // Suppress notification if user is currently inside and viewing this chat
      if (activeChatTrackingService.isChatCurrentlyOpenAndVisible(detail.chatId, detail.senderId)) {
        return;
      }

      triggerHapticFeedback("light");
      setActiveMessage(detail);
      setIsReplying(false);
      setReplyText("");
      setActionFeedback(null);
      setIsSubmitting(false);
      startTimer();
    };

    window.addEventListener("swapskill_new_message_notif", handleNewMessage);
    return () => {
      window.removeEventListener("swapskill_new_message_notif", handleNewMessage);
      clearTimer();
    };
  }, []);

  // Pause timer when replying so user can type comfortably
  useEffect(() => {
    if (isReplying) {
      clearTimer();
      setTimeout(() => {
        replyInputRef.current?.focus();
      }, 50);
    }
  }, [isReplying]);

  // Mark chat as read
  const handleMarkAsRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeMessage || isSubmitting) return;

    triggerHapticFeedback("light");
    setIsSubmitting(true);
    setActionFeedback("Marked as read");

    try {
      const currentUserId = auth.currentUser?.uid || "";
      await fetch("/api/chat/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: activeMessage.chatId,
          userId: currentUserId,
        }),
      });

      // Dispatch local event so open chats / unread badges update
      window.dispatchEvent(
        new CustomEvent("swapskill_chat_marked_read", {
          detail: { chatId: activeMessage.chatId },
        })
      );
    } catch (err) {
      console.warn("[InAppNotification] Failed to mark as read:", err);
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        handleDismiss();
      }, 700);
    }
  };

  // Send inline reply
  const handleSendReply = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeMessage || !replyText.trim() || isSubmitting) return;

    triggerHapticFeedback("light");
    setIsSubmitting(true);
    const textToSend = replyText.trim();
    setActionFeedback("Sending reply...");

    try {
      const currentUserId = auth.currentUser?.uid || "";
      const currentUserName = auth.currentUser?.displayName || "You";

      const res = await fetch("/api/chat/send-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: activeMessage.chatId,
          text: textToSend,
          senderId: currentUserId,
          recipientId: activeMessage.senderId || "",
          senderName: currentUserName,
        }),
      });

      if (!res.ok) {
        throw new Error("Server rejected reply");
      }

      setActionFeedback("✓ Reply sent!");
      triggerHapticFeedback("success");

      // Dispatch local event so MessagesView can optimistically reflect the reply
      window.dispatchEvent(
        new CustomEvent("swapskill_message_replied", {
          detail: {
            chatId: activeMessage.chatId,
            text: textToSend,
          },
        })
      );

      setTimeout(() => {
        handleDismiss();
      }, 800);
    } catch (err) {
      console.warn("[InAppNotification] Failed to send reply:", err);
      setActionFeedback("Failed to send");
      setIsSubmitting(false);
      setTimeout(() => {
        setActionFeedback(null);
      }, 1500);
    }
  };

  // Navigate directly into chat when tapping the banner
  const handleBannerClick = () => {
    if (!activeMessage || isReplying || isSubmitting) return;
    triggerHapticFeedback("light");
    const chatId = activeMessage.chatId;
    handleDismiss();
    mobileDeepLinkService.processDeepLinkUrl(`swapskill://chat/${chatId}`);
  };

  if (!activeMessage) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={activeMessage.chatId + (activeMessage.messageId || "")}
        initial={{ opacity: 0, y: -40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -30, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="fixed top-4 inset-x-0 mx-auto z-[99998] w-[calc(100%-1.5rem)] max-w-md pointer-events-auto"
      >
        <div
          onClick={handleBannerClick}
          className="relative overflow-hidden rounded-2xl bg-[#0f1118]/95 border border-white/20 text-white shadow-2xl backdrop-blur-xl p-3.5 sm:p-4 select-none cursor-pointer transition ring-1 ring-black/40 hover:border-white/30"
          style={{
            boxShadow: "0 20px 35px -10px rgba(0,0,0,0.85), 0 0 20px rgba(201,169,110,0.15)",
          }}
        >
          {/* Ambient Gold Glow */}
          <div className="absolute -top-10 -right-10 w-28 h-28 bg-[#C9A96E]/15 rounded-full blur-xl pointer-events-none" />

          {/* Header Row: Sender Photo, Name, and Close */}
          <div className="flex items-start justify-between gap-2.5 relative z-10">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0">
                <img
                  src={activeMessage.senderPhoto || DEFAULT_AVATAR}
                  alt={activeMessage.senderName}
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-white/15 bg-zinc-800 shadow-md"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = DEFAULT_AVATAR;
                  }}
                />
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0f1118]" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h4 className="text-xs sm:text-sm font-bold text-white truncate max-w-[170px] sm:max-w-[210px]">
                    {activeMessage.senderName}
                  </h4>
                  <span className="text-[10px] text-[#C9A96E] font-medium bg-[#C9A96E]/15 px-1.5 py-0.2 rounded">
                    New Message
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-zinc-300 truncate max-w-[220px] sm:max-w-[280px] mt-0.5">
                  {activeMessage.message}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHapticFeedback("light");
                handleDismiss();
              }}
              className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center transition shrink-0 cursor-pointer"
              title="Dismiss"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Action Feedback Toast Pill */}
          {actionFeedback && (
            <div className="mt-2.5 py-1 px-3 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 animate-in fade-in duration-200">
              <Check className="w-3.5 h-3.5" />
              <span>{actionFeedback}</span>
            </div>
          )}

          {/* Standard View: Mark as Read & Reply Buttons */}
          {!isReplying && !actionFeedback && (
            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-end gap-2 relative z-10">
              <button
                type="button"
                onClick={handleMarkAsRead}
                disabled={isSubmitting}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-xs font-medium text-white/90 hover:text-white flex items-center gap-1.5 transition border border-white/10 cursor-pointer disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Mark as read</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHapticFeedback("light");
                  setIsReplying(true);
                }}
                disabled={isSubmitting}
                className="px-3.5 py-1.5 rounded-xl bg-[#C9A96E] hover:bg-[#b89559] active:scale-95 text-xs font-bold text-[#0D0D0F] flex items-center gap-1.5 transition shadow-sm cursor-pointer disabled:opacity-50"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Reply</span>
              </button>
            </div>
          )}

          {/* Inline Reply Input Row */}
          {isReplying && !actionFeedback && (
            <form
              onSubmit={handleSendReply}
              onClick={(e) => e.stopPropagation()}
              className="mt-3 pt-2.5 border-t border-white/10 flex items-center gap-2 relative z-10"
            >
              <div className="relative flex-1">
                <input
                  ref={replyInputRef}
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${activeMessage.senderName}...`}
                  disabled={isSubmitting}
                  className="w-full h-9 pl-3 pr-2 rounded-xl bg-white/10 border border-white/20 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[#C9A96E] transition disabled:opacity-50"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply();
                    }
                  }}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback("light");
                  setIsReplying(false);
                  startTimer();
                }}
                disabled={isSubmitting}
                className="h-9 px-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs font-medium transition cursor-pointer"
                title="Cancel reply"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting || !replyText.trim()}
                className="h-9 px-3.5 rounded-xl bg-[#C9A96E] hover:bg-[#b89559] active:scale-95 text-[#0D0D0F] text-xs font-bold flex items-center gap-1.5 transition shadow-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Send reply"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
