import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BellOff, Check, MessageSquare, Send, VolumeX, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { auth } from "../firebase";
import { DEFAULT_AVATAR } from "../types";
import { triggerHapticFeedback } from "../utils/sound";
import { activeChatTrackingService } from "../services/activeChatTrackingService";
import { mobileDeepLinkService } from "../services/mobile/deepLinks";
import { mobileForegroundService } from "../services/mobile/foregroundService";
import { sendNotificationReply } from "../services/chatReplyService";
import { getMutedChatIds, isChatMuted, muteChat } from "../utils/mutedChats";

export interface NewMessagePayload {
  chatId: string;
  messageId?: string;
  senderName: string;
  senderPhoto?: string;
  senderId?: string;
  message: string;
  fullMessage?: string;
  createdAtMs?: number;
}

interface StackedMessageItem {
  id: string;
  sender: "partner" | "you";
  text: string;
  ts: number;
}

interface NotificationThread {
  chatId: string;
  senderId: string;
  senderName: string;
  senderPhoto?: string;
  items: StackedMessageItem[];
}

export default function InAppMessageNotification() {
  const [thread, setThread] = useState<NotificationThread | null>(null);
  const [isReplying, setIsReplying] = useState<boolean>(false);
  const [replyText, setReplyText] = useState<string>("");
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyInputRef = useRef<HTMLInputElement | null>(null);
  const replyQueueRef = useRef<Promise<void>>(Promise.resolve());

  const clearTimer = useCallback(() => {
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
  }, []);

  const handleDismiss = useCallback(() => {
    clearTimer();
    setThread(null);
    setIsReplying(false);
    setReplyText("");
    setStatusFeedback(null);
  }, [clearTimer]);

  const startTimer = useCallback(
    (ms = 7000) => {
      clearTimer();
      autoDismissTimerRef.current = setTimeout(() => {
        handleDismiss();
      }, ms);
    },
    [clearTimer, handleDismiss]
  );

  // Listen to new incoming message notifications dispatched across the app
  useEffect(() => {
    const handleNewMessage = (e: Event) => {
      const customEvent = e as CustomEvent<NewMessagePayload>;
      const detail = customEvent.detail;
      if (!detail || !detail.chatId) return;

      // When native Android app is backgrounded, native MessagingStyle handles the notification tray cleanly
      if (
        Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === "android" &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      // Suppress if user is already viewing this chat OR has muted notifications for this chat
      if (
        activeChatTrackingService.isChatCurrentlyOpenAndVisible(detail.chatId, detail.senderId) ||
        isChatMuted(detail.chatId)
      ) {
        return;
      }

      const incomingText = String(detail.fullMessage || detail.message || "Sent you a message").trim();
      if (!incomingText) return;
      const incomingId = detail.messageId || `in_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const incomingTs = typeof detail.createdAtMs === "number" && detail.createdAtMs > 0 ? detail.createdAtMs : Date.now();

      triggerHapticFeedback("light");

      setThread((prev) => {
        if (prev && prev.chatId === detail.chatId) {
          // Deduplicate repeat fires for the same messageId / rapid duplicate payload
          const alreadyExists = prev.items.some(
            (item) =>
              item.id === incomingId ||
              (item.sender === "partner" &&
                item.text === incomingText &&
                Math.abs(incomingTs - item.ts) < 12000)
          );
          if (alreadyExists) return prev;
          const nextItems = [
            ...prev.items,
            { id: incomingId, sender: "partner" as const, text: incomingText, ts: incomingTs },
          ].slice(-5);
          return {
            ...prev,
            senderName: detail.senderName || prev.senderName,
            senderPhoto: detail.senderPhoto || prev.senderPhoto,
            items: nextItems,
          };
        }

        // Fresh notification thread
        setIsReplying(false);
        setReplyText("");
        setStatusFeedback(null);
        return {
          chatId: detail.chatId,
          senderId: detail.senderId || "",
          senderName: detail.senderName || "New Message",
          senderPhoto: detail.senderPhoto || "",
          items: [{ id: incomingId, sender: "partner", text: incomingText, ts: incomingTs }],
        };
      });

      // Keep open smoothly; if user is actively typing inline, extend idle timer comfortably
      setIsReplying((currentlyReplying) => {
        startTimer(currentlyReplying ? 12000 : 7000);
        return currentlyReplying;
      });
    };

    window.addEventListener("swapskill_new_message_notif", handleNewMessage);
    return () => {
      window.removeEventListener("swapskill_new_message_notif", handleNewMessage);
      clearTimer();
    };
  }, [clearTimer, startTimer]);

  // Focus input cleanly when user taps Reply
  useEffect(() => {
    if (isReplying) {
      clearTimer();
      const focusTimer = setTimeout(() => {
        replyInputRef.current?.focus();
      }, 40);
      return () => clearTimeout(focusTimer);
    }
  }, [isReplying, clearTimer]);

  // Mute chat notifications (0 Firestore quota, instant client + Android sync)
  const handleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!thread) return;
    const targetChatId = thread.chatId;
    triggerHapticFeedback("light");
    muteChat(targetChatId);
    if (Capacitor.isNativePlatform()) {
      void mobileForegroundService.syncMutedChats(getMutedChatIds());
      void mobileForegroundService.clearChatNotifHistory(targetChatId);
    }
    setStatusFeedback("Chat muted");
    setIsReplying(false);
    clearTimer();
    setTimeout(() => {
      handleDismiss();
    }, 550);
  };

  // Inline Reply (WhatsApp MessagingStyle behavior: keeps banner & keyboard active for rapid follow-up replies)
  const handleSendReply = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!thread) return;
    const trimmed = replyText.trim();
    if (!trimmed) return;

    triggerHapticFeedback("light");

    const targetChatId = thread.chatId;
    const targetRecipientId = thread.senderId;
    const optimisticId = `local_reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowTs = Date.now();

    // 1. Instantly clear input and stack "You: <reply>" inside notification bubble at 0ms
    setReplyText("");
    setStatusFeedback(null);
    setThread((prev) => {
      if (!prev || prev.chatId !== targetChatId) return prev;
      return {
        ...prev,
        items: [
          ...prev.items,
          { id: optimisticId, sender: "you", text: trimmed, ts: nowTs },
        ].slice(-5),
      };
    });

    // Keep compose focus & restart gentle idle timer so consecutive replies ("Yooo" -> "Hleww") feel effortless
    startTimer(8500);
    requestAnimationFrame(() => {
      replyInputRef.current?.focus();
    });

    // 2. Dispatch optimistic local event right away so Chat list / active chat reflects at 0ms
    const currentUid = auth.currentUser?.uid || "";
    window.dispatchEvent(
      new CustomEvent("swapskill_message_replied", {
        detail: {
          chatId: targetChatId,
          messageId: optimisticId,
          text: trimmed,
          senderId: currentUid,
        },
      })
    );

    // 3. Enqueue real Firestore write + FCM push sequentially so back-to-back replies preserve exact order
    const senderDisplayName = auth.currentUser?.displayName || "You";
    replyQueueRef.current = replyQueueRef.current.then(async () => {
      try {
        const result = await sendNotificationReply({
          chatId: targetChatId,
          text: trimmed,
          recipientId: targetRecipientId,
          senderName: senderDisplayName,
        });
        if (!result.success) {
          throw new Error(result.error || "Failed to send");
        }
        triggerHapticFeedback("success");
      } catch (err) {
        console.warn("[InAppNotification] Inline reply send failed:", err);
      }
    });
  };

  // Tapping notification body or header ALWAYS opens directly inside that exact chat smoothly
  const handleOpenDirectChat = () => {
    if (!thread) return;
    triggerHapticFeedback("light");
    const targetChatId = thread.chatId;
    handleDismiss();
    if (Capacitor.isNativePlatform()) {
      void mobileForegroundService.clearChatNotifHistory(targetChatId);
    }
    mobileDeepLinkService.processDeepLinkUrl(`swapskill://chat/${encodeURIComponent(targetChatId)}`);
  };

  const visibleItems = thread ? thread.items.slice(-4) : [];

  return (
    <AnimatePresence>
      {thread && (
        <motion.div
          key={thread.chatId}
          initial={{ opacity: 0, y: -32, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -28, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 440, damping: 32, mass: 0.85 }}
          drag="y"
          dragConstraints={{ top: -80, bottom: 0 }}
          dragElastic={0.18}
          onDragEnd={(_, info) => {
            if (info.offset.y < -36 || info.velocity.y < -280) {
              handleDismiss();
            }
          }}
          className="fixed top-3.5 inset-x-0 mx-auto z-[99998] w-[calc(100%-1.25rem)] max-w-[430px] pointer-events-auto"
        >
          <div
            onClick={handleOpenDirectChat}
            className="relative overflow-hidden rounded-[22px] bg-[#141418]/96 border border-white/12 text-white backdrop-blur-2xl px-4 pt-3.5 pb-3 select-none cursor-pointer transition-colors hover:border-white/20"
            style={{
              boxShadow: "0 18px 40px -10px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(255,255,255,0.06)",
            }}
          >
            {/* Header + Avatar + Stacked MessagingStyle Lines */}
            <div className="flex items-start gap-3">
              <div className="relative shrink-0 mt-0.5">
                <img
                  src={thread.senderPhoto || DEFAULT_AVATAR}
                  alt={thread.senderName}
                  className="w-10 h-10 rounded-full object-cover ring-1 ring-white/15 bg-zinc-800"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = DEFAULT_AVATAR;
                  }}
                />
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#C9A96E] ring-2 ring-[#141418] flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0D0D0F]" />
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h4 className="text-[14px] font-semibold text-white truncate tracking-tight">
                      {thread.senderName}
                    </h4>
                    <span className="text-[11px] text-zinc-400 shrink-0">now</span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback("light");
                      handleDismiss();
                    }}
                    className="w-6 h-6 -mr-1 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center transition shrink-0 cursor-pointer"
                    aria-label="Dismiss notification"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Stacked MessagingStyle Lines (Partner + Inline Replies) */}
                <div className="mt-1 space-y-0.5">
                  {visibleItems.map((item) => (
                    <motion.p
                      key={item.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.16 }}
                      className="text-[13px] leading-[1.35] text-zinc-200 truncate"
                    >
                      {item.sender === "you" ? (
                        <>
                          <span className="font-semibold text-[#C9A96E] mr-1.5">You</span>
                          <span className="text-zinc-100">{item.text}</span>
                        </>
                      ) : (
                        <span>{item.text}</span>
                      )}
                    </motion.p>
                  ))}
                </div>
              </div>
            </div>

            {/* Subtle Mute Feedback */}
            {statusFeedback && (
              <div className="mt-2.5 py-1.5 px-3 rounded-xl bg-white/8 border border-white/10 text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-[#C9A96E]" />
                <span>{statusFeedback}</span>
              </div>
            )}

            {/* Action Buttons: Reply & Mute (Clean WhatsApp Action Layout) */}
            {!isReplying && !statusFeedback && (
              <div className="mt-2.5 pt-2 border-t border-white/8 flex items-center justify-between gap-2 pl-[52px]">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback("light");
                      setIsReplying(true);
                    }}
                    className="text-[13px] font-semibold text-[#E8D5B0] hover:text-white active:opacity-75 transition flex items-center gap-1.5 py-0.5 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Reply</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleMute}
                    className="text-[13px] font-semibold text-zinc-300 hover:text-white active:opacity-75 transition flex items-center gap-1.5 py-0.5 cursor-pointer"
                  >
                    <VolumeX className="w-3.5 h-3.5" />
                    <span>Mute</span>
                  </button>
                </div>

                <span className="text-[11px] text-zinc-500 font-medium">Tap to open</span>
              </div>
            )}

            {/* Persistent Inline Reply Bar (stays open cleanly across consecutive replies) */}
            {isReplying && !statusFeedback && (
              <form
                onSubmit={handleSendReply}
                onClick={(e) => e.stopPropagation()}
                className="mt-2.5 pt-2 border-t border-white/10 flex items-center gap-2"
              >
                <input
                  ref={replyInputRef}
                  type="text"
                  value={replyText}
                  onChange={(e) => {
                    setReplyText(e.target.value);
                    startTimer(15000);
                  }}
                  placeholder={`Reply to ${thread.senderName}...`}
                  className="flex-1 h-9 px-3.5 rounded-full bg-white/10 border border-white/15 text-[13px] text-white placeholder-zinc-400 focus:outline-none focus:border-[#C9A96E]/80 transition"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply();
                    }
                  }}
                />

                <button
                  type="button"
                  onClick={handleMute}
                  className="w-9 h-9 rounded-full bg-white/8 hover:bg-white/15 text-zinc-300 hover:text-white flex items-center justify-center transition shrink-0 cursor-pointer"
                  title="Mute notifications for this chat"
                  aria-label="Mute notifications"
                >
                  <BellOff className="w-4 h-4" />
                </button>

                <button
                  type="submit"
                  disabled={!replyText.trim()}
                  className="w-9 h-9 rounded-full bg-[#C9A96E] hover:bg-[#d6b77d] active:scale-95 text-[#0D0D0F] flex items-center justify-center transition shadow-sm shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send reply"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
