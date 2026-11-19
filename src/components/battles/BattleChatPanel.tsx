import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Reply,
  X,
  RotateCcw,
  Trash2,
  VolumeX,
  ArrowDown,
  SmilePlus,
  Check,
  AlertCircle,
} from "lucide-react";
import { BattleComment, BattleCommentReplyRef } from "../../types/battle";
import { DEFAULT_AVATAR } from "../../types";
import { SmartImage } from "../SmartImage";

const CHAT_REACTION_EMOJIS = ["🔥", "👏", "❤️", "👍", "⚡"];

interface BattleChatPanelProps {
  messages: BattleComment[];
  currentUserId: string;
  isModerator: boolean;
  mutedUntilMs: number;
  wsConnected: boolean;
  onSendMessage: (text: string, replyTo?: BattleCommentReplyRef) => void;
  onRetryMessage: (msg: BattleComment) => void;
  onReactMessage: (messageId: string, emoji: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onMuteUser: (targetUid: string) => void;
  compactHeader?: boolean;
}

export const BattleChatPanel: React.FC<BattleChatPanelProps> = ({
  messages,
  currentUserId,
  isModerator,
  mutedUntilMs,
  wsConnected,
  onSendMessage,
  onRetryMessage,
  onReactMessage,
  onDeleteMessage,
  onMuteUser,
  compactHeader = false,
}) => {
  const [text, setText] = useState("");
  const [replyingTo, setReplyingTo] = useState<BattleCommentReplyRef | null>(null);
  const [activeActionMsgId, setActiveActionMsgId] = useState<string | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isMuted = mutedUntilMs > Date.now();
  const visibleMessages = useMemo(
    () => messages.filter((m) => !m.deleted),
    [messages]
  );

  // Smart auto-scroll when pinned to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedToBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      setHasUnreadBelow(false);
    } else if (visibleMessages.length > 0) {
      setHasUnreadBelow(true);
    }
  }, [visibleMessages.length, pinnedToBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 48;
    setPinnedToBottom(atBottom);
    if (atBottom) setHasUnreadBelow(false);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPinnedToBottom(true);
    setHasUnreadBelow(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isMuted) return;
    onSendMessage(trimmed, replyingTo || undefined);
    setText("");
    setReplyingTo(null);
    setPinnedToBottom(true);
  };

  const formatTime = (ms: number) => {
    try {
      return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-[#0C0E14] text-white relative">
      {!compactHeader && (
        <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold tracking-tight text-white">
              Live Arena Chat
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                wsConnected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
              }`}
            />
          </div>
          <span className="text-[11px] text-neutral-400 tabular-nums">
            {visibleMessages.length} msgs
          </span>
        </div>
      )}

      {/* Scrollable Chat Feed */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2.5 overscroll-contain"
      >
        {visibleMessages.length === 0 ? (
          <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center px-4">
            <p className="text-[13px] font-medium text-neutral-400">
              No messages yet
            </p>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Drop feedback, cheer a competitor, or react live.
            </p>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            const isOwn = msg.authorId === currentUserId;
            const showActions = activeActionMsgId === msg.id;
            const reactionEntries = Object.entries(
              (msg.reactions || {}) as Record<string, string[]>
            ).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].length > 0);

            return (
              <div
                key={msg.id}
                onClick={() =>
                  setActiveActionMsgId((prev) => (prev === msg.id ? null : msg.id))
                }
                className={`group rounded-xl px-2.5 py-2 transition cursor-pointer ${
                  showActions ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                }`}
              >
                {/* Reply Quote */}
                {msg.replyTo && (
                  <div className="mb-1.5 pl-2.5 border-l-2 border-[#C9A96E]/60 text-[11px] text-neutral-400 truncate">
                    <span className="font-semibold text-[#C9A96E] mr-1">
                      @{msg.replyTo.authorName}
                    </span>
                    <span>{msg.replyTo.text}</span>
                  </div>
                )}

                <div className="flex items-start gap-2.5 min-w-0">
                  <SmartImage
                    src={msg.authorPhoto || DEFAULT_AVATAR}
                    alt={msg.authorName}
                    fallbackType="profile"
                    fullName={msg.authorName}
                    className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5 border border-white/10"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span
                        className={`text-[12px] font-bold truncate ${
                          msg.authorRole === "competitor"
                            ? "text-[#C9A96E]"
                            : msg.authorRole === "judge"
                            ? "text-emerald-400"
                            : msg.authorRole === "admin"
                            ? "text-rose-400"
                            : "text-neutral-200"
                        }`}
                      >
                        {msg.authorName}
                      </span>

                      {msg.authorRole && msg.authorRole !== "spectator" && (
                        <span
                          className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            msg.authorRole === "competitor"
                              ? "bg-[#C9A96E]/20 text-[#C9A96E]"
                              : msg.authorRole === "judge"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-rose-500/20 text-rose-300"
                          }`}
                        >
                          {msg.authorRole}
                        </span>
                      )}

                      <span className="text-[10px] text-neutral-500 tabular-nums ml-auto shrink-0">
                        {formatTime(msg.createdAtMs)}
                      </span>
                    </div>

                    <p className="text-[13px] text-neutral-100 leading-snug break-words mt-0.5">
                      {msg.text}
                    </p>

                    {/* Delivery status on own optimistic messages */}
                    {isOwn && msg.deliveryStatus && msg.deliveryStatus !== "sent" && (
                      <div className="mt-1 flex items-center gap-2 text-[11px]">
                        {msg.deliveryStatus === "sending" ? (
                          <span className="text-neutral-400 flex items-center gap-1">
                            <Check className="w-3 h-3 opacity-60" /> Sending...
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRetryMessage(msg);
                            }}
                            className="text-rose-400 hover:text-rose-300 flex items-center gap-1 font-semibold cursor-pointer"
                          >
                            <AlertCircle className="w-3 h-3" />
                            <span>Failed · Tap to retry</span>
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Reactions Strip */}
                    {reactionEntries.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {reactionEntries.map(([emoji, uids]) => {
                          const iReacted = uids.includes(currentUserId);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onReactMessage(msg.id, emoji);
                              }}
                              className={`min-h-[26px] px-2 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition ${
                                iReacted
                                  ? "bg-[#C9A96E]/25 border border-[#C9A96E]/60 text-[#C9A96E]"
                                  : "bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10"
                              }`}
                            >
                              <span>{emoji}</span>
                              <span className="tabular-nums">{uids.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Expandable Quick Actions on Tap/Focus */}
                    {showActions && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2 pt-2 border-t border-white/10 flex flex-wrap items-center gap-1.5"
                      >
                        {CHAT_REACTION_EMOJIS.map((em) => (
                          <button
                            key={em}
                            type="button"
                            onClick={() => {
                              onReactMessage(msg.id, em);
                              setActiveActionMsgId(null);
                            }}
                            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-[14px] cursor-pointer"
                          >
                            {em}
                          </button>
                        ))}

                        <button
                          type="button"
                          onClick={() => {
                            setReplyingTo({
                              id: msg.id,
                              authorName: msg.authorName,
                              text: msg.text.slice(0, 90),
                            });
                            setActiveActionMsgId(null);
                            setTimeout(() => inputRef.current?.focus(), 40);
                          }}
                          className="h-8 px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Reply className="w-3.5 h-3.5 text-[#C9A96E]" />
                          <span>Reply</span>
                        </button>

                        {(isModerator || isOwn) && (
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteMessage(msg.id);
                              setActiveActionMsgId(null);
                            }}
                            className="h-8 px-2.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        )}

                        {isModerator && !isOwn && (
                          <button
                            type="button"
                            onClick={() => {
                              onMuteUser(msg.authorId);
                              setActiveActionMsgId(null);
                            }}
                            className="h-8 px-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <VolumeX className="w-3.5 h-3.5" />
                            <span>Mute 5m</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Unread jump button */}
      {hasUnreadBelow && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-20 right-3 z-20 px-3 py-1.5 rounded-full bg-[#C9A96E] text-[#0D0D0F] text-[11px] font-bold shadow-lg flex items-center gap-1 cursor-pointer"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          <span>New messages</span>
        </button>
      )}

      {/* Reply Context Banner */}
      {replyingTo && (
        <div className="px-3 py-2 bg-[#141722] border-t border-white/10 flex items-center justify-between gap-2 text-[11px] shrink-0">
          <div className="min-w-0 flex items-center gap-1.5">
            <Reply className="w-3.5 h-3.5 text-[#C9A96E] shrink-0" />
            <span className="text-neutral-400 truncate">
              Replying to <strong className="text-white">{replyingTo.authorName}</strong>:{" "}
              {replyingTo.text}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Keyboard-Safe Message Composer */}
      <form
        onSubmit={handleSubmit}
        className="px-2.5 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-[#0E1017] border-t border-white/10 flex items-center gap-2 shrink-0"
      >
        <div className="flex-1 min-w-0 relative flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={text}
            disabled={isMuted}
            onChange={(e) => setText(e.target.value)}
            maxLength={360}
            placeholder={
              isMuted
                ? "You are temporarily muted in chat..."
                : replyingTo
                ? `Reply to ${replyingTo.authorName}...`
                : "Message live arena..."
            }
            className="w-full min-h-[44px] pl-3.5 pr-9 rounded-xl bg-[#161923] border border-white/10 text-[13px] text-white placeholder:text-neutral-500 focus:outline-none focus:border-[#C9A96E] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => {
              if (!isMuted) {
                setText((t) => (t ? `${t} 🔥` : "🔥"));
                inputRef.current?.focus();
              }
            }}
            aria-label="Quick Fire Emoji"
            className="absolute right-2 w-7 h-7 rounded-lg text-neutral-400 hover:text-[#C9A96E] flex items-center justify-center cursor-pointer"
          >
            <SmilePlus className="w-4 h-4" />
          </button>
        </div>

        <button
          type="submit"
          disabled={!text.trim() || isMuted}
          aria-label="Send chat message"
          className="w-11 h-11 rounded-xl bg-[#C9A96E] hover:bg-[#b8975b] text-[#0D0D0F] flex items-center justify-center cursor-pointer disabled:opacity-40 transition shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
