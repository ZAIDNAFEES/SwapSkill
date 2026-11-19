import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BadgeCheck,
  Bell,
  Calendar,
  CheckCheck,
  MessageCircle,
  Phone,
  PhoneMissed,
  Star,
  Swords,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import { UserProfile, getUserProfilePhoto } from "../types";
import SmartImage from "./SmartImage";
import { LoadingTransition } from "./SkeletonLoader";
import { useElasticOverscroll } from "../hooks/useElasticOverscroll";

export interface RawNotificationItem {
  id: string;
  type?: string;
  senderId?: string;
  callerId?: string;
  fromUserId?: string;
  senderName?: string;
  callerName?: string;
  fromUserName?: string;
  senderPhoto?: string;
  callerPhoto?: string;
  fromUserPhoto?: string;
  referenceId?: string;
  sessionId?: string;
  battleId?: string;
  conversationId?: string;
  chatId?: string;
  callId?: string;
  callType?: string;
  skillName?: string;
  title?: string;
  message?: string;
  body?: string;
  read?: boolean;
  createdAt?: any;
  createdTimestamp?: any;
  data?: Record<string, any>;
}

type NotificationKind =
  | "call_incoming"
  | "call_missed"
  | "follower"
  | "booking"
  | "battle"
  | "review"
  | "chat"
  | "system";

type NotificationTab = "all" | "unread" | "sessions" | "calls";

interface NormalizedNotification {
  id: string;
  raw: RawNotificationItem;
  kind: NotificationKind;
  actorId: string;
  actorName: string;
  actorPhoto: string;
  actorVerified: boolean;
  headline: string;
  contextLabel: string;
  topic: string;
  timestampMs: number;
  read: boolean;
  isVideoCall: boolean;
}

interface GroupedNotificationEntry {
  key: string;
  primary: NormalizedNotification;
  ids: string[];
  unreadIds: string[];
  count: number;
  hasVideo: boolean;
  hasVoice: boolean;
  timestampMs: number;
  hasUnread: boolean;
}

interface NotificationsDrawerProps {
  isOpen: boolean;
  notifications: RawNotificationItem[];
  profilesCache: Record<string, UserProfile>;
  loading: boolean;
  unreadCount: number;
  onClose: () => void;
  onSelectNotification: (notif: RawNotificationItem, idsToMarkRead: string[]) => void;
  onDismissNotification: (idsToDelete: string[], e: React.MouseEvent) => void;
  onMarkAllAsRead: () => void;
}

const CALL_GROUP_WINDOW_MS = 12 * 60 * 60 * 1000;
const NOISE_SUBLINES = new Set([
  "chat call",
  "voice call",
  "video call",
  "audio call",
  "call",
]);

export function extractNotifTimestampMs(n: RawNotificationItem): number {
  const candidates = [n?.createdAt, n?.createdTimestamp, n?.data?.createdAt];
  for (const val of candidates) {
    if (!val) continue;
    if (typeof val === "number" && !Number.isNaN(val)) return val;
    if (typeof val?.toMillis === "function") {
      try {
        return val.toMillis();
      } catch (_) {}
    }
    if (typeof val?.toDate === "function") {
      try {
        return val.toDate().getTime();
      } catch (_) {}
    }
    if (typeof val?.seconds === "number") {
      return val.seconds * 1000;
    }
    if (val instanceof Date) {
      return val.getTime();
    }
    if (typeof val === "string") {
      const parsed = Date.parse(val);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

function formatRelativeTime(tsMs: number, nowMs: number): string {
  if (!tsMs || tsMs <= 0) return "";
  const diffSec = Math.max(0, Math.floor((nowMs - tsMs) / 1000));
  if (diffSec < 45) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;

  const date = new Date(tsMs);
  const today = new Date(nowMs);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  if (tsMs >= startOfYesterday && tsMs < startOfToday) {
    return "Yesterday";
  }

  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

function getSectionLabel(tsMs: number, nowMs: number): "Today" | "This week" | "Earlier" {
  if (!tsMs || tsMs <= 0) return "Earlier";
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (tsMs >= startOfToday) return "Today";
  if (tsMs >= startOfToday - 6 * 24 * 60 * 60 * 1000) return "This week";
  return "Earlier";
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function normalizeNotification(
  n: RawNotificationItem,
  profilesCache: Record<string, UserProfile>,
  nowMs: number
): NormalizedNotification {
  const nested = n.data || {};
  const rawType = String(n.type || nested.type || "").toLowerCase();
  const actorId = String(
    n.senderId || n.callerId || n.fromUserId || nested.senderId || nested.callerId || ""
  ).trim();
  const cachedProfile = actorId ? profilesCache[actorId] : undefined;

  let actorName = String(
    n.senderName ||
      n.callerName ||
      n.fromUserName ||
      nested.senderName ||
      nested.callerName ||
      cachedProfile?.fullName ||
      ""
  ).trim();

  const rawMsg = String(n.message || n.body || nested.fullMessage || "").trim();
  const lowerMsg = rawMsg.toLowerCase();

  if (!actorName && lowerMsg.includes(" is calling")) {
    const idx = lowerMsg.indexOf(" is calling");
    const inferred = rawMsg.slice(0, idx).trim();
    if (inferred) actorName = inferred;
  }

  const actorPhoto = String(
    n.senderPhoto ||
      n.callerPhoto ||
      n.fromUserPhoto ||
      nested.senderPhoto ||
      nested.callerPhoto ||
      (cachedProfile ? getUserProfilePhoto(cachedProfile) : "")
  ).trim();

  const tsMs = extractNotifTimestampMs(n);
  const callTypeStr = String(n.callType || nested.callType || "").toLowerCase();
  const isVideoCall =
    callTypeStr === "video" ||
    lowerMsg.includes("video call") ||
    (!callTypeStr.includes("audio") && !lowerMsg.includes("voice call"));

  const isCallCancelled =
    rawType === "call_cancelled" ||
    rawType === "call_ended" ||
    rawType === "call_missed" ||
    rawType === "call_rejected" ||
    lowerMsg.includes("cancelled or ended") ||
    lowerMsg.includes("missed call");

  const isIncomingCall =
    !isCallCancelled &&
    (rawType === "incoming_call" || rawType === "call" || lowerMsg.includes("is calling"));

  let kind: NotificationKind = "system";
  if (isCallCancelled) kind = "call_missed";
  else if (isIncomingCall) kind = "call_incoming";
  else if (rawType.includes("battle") || Boolean(n.battleId || nested.battleId))
    kind = "battle";
  else if (rawType === "follower" || lowerMsg.includes("following") || lowerMsg.includes("connected"))
    kind = "follower";
  else if (
    rawType.includes("booking") ||
    rawType.includes("session") ||
    lowerMsg.includes("session") ||
    lowerMsg.includes("swap request") ||
    lowerMsg.includes("booked")
  )
    kind = "booking";
  else if (rawType === "review" || lowerMsg.includes("review") || lowerMsg.includes("rated"))
    kind = "review";
  else if (
    rawType === "chat" ||
    rawType === "message" ||
    rawType === "message_request" ||
    Boolean(n.chatId || nested.chatId)
  )
    kind = "chat";

  let cleanBody = rawMsg;
  if (actorName && cleanBody.toLowerCase().startsWith(actorName.toLowerCase())) {
    cleanBody = cleanBody.slice(actorName.length).trim();
  }

  let headline = cleanBody;
  let contextLabel = "";

  if (kind === "call_incoming") {
    const isFresh = tsMs > 0 && nowMs - tsMs < 90 * 1000;
    const modeWord = isVideoCall ? "video" : "voice";
    headline = isFresh
      ? `is calling you (${modeWord})`
      : `tried ${modeWord} calling you`;
    contextLabel = isVideoCall ? "Video call" : "Voice call";
  } else if (kind === "call_missed") {
    const modeWord = isVideoCall ? "video" : "voice";
    headline = actorName
      ? `left a missed ${modeWord} call`
      : `Missed ${modeWord} call`;
    contextLabel = isVideoCall ? "Missed video call" : "Missed voice call";
  } else if (kind === "follower") {
    if (!headline) headline = "connected with you";
    contextLabel = "Connection";
  } else if (kind === "booking") {
    if (!headline) headline = "sent a session request";
    contextLabel = "Session";
  } else if (kind === "battle") {
    if (!headline) headline = String(n.title || "sent a Skill Battle update");
    contextLabel = "Skill Battle";
  } else if (kind === "review") {
    if (!headline) headline = "left a new review";
    contextLabel = "Review";
  } else if (kind === "chat") {
    if (!headline) headline = "sent you a message";
    contextLabel = "Message";
  } else {
    if (!headline) headline = "shared an activity update";
    contextLabel = "Update";
  }

  const rawSkill = String(n.skillName || nested.skillName || "").trim();
  const topic =
    rawSkill &&
    !NOISE_SUBLINES.has(rawSkill.toLowerCase()) &&
    !headline.toLowerCase().includes(rawSkill.toLowerCase())
      ? rawSkill
      : "";

  return {
    id: n.id,
    raw: n,
    kind,
    actorId,
    actorName,
    actorPhoto,
    actorVerified: Boolean(cachedProfile?.verified),
    headline,
    contextLabel,
    topic,
    timestampMs: tsMs,
    read: Boolean(n.read),
    isVideoCall,
  };
}

function matchesTab(item: NormalizedNotification, tab: NotificationTab): boolean {
  if (tab === "unread") return !item.read;
  if (tab === "sessions") return item.kind === "booking" || item.kind === "review";
  if (tab === "calls") return item.kind === "call_incoming" || item.kind === "call_missed";
  return true;
}

function buildGroupedEntries(
  normalized: NormalizedNotification[],
  filter: NotificationTab
): GroupedNotificationEntry[] {
  const filtered = normalized.filter((n) => matchesTab(n, filter));
  const grouped: GroupedNotificationEntry[] = [];

  for (const item of filtered) {
    const isCollapsibleCall = item.kind === "call_incoming" || item.kind === "call_missed";
    const actorGroupKey = item.actorId || item.actorName.toLowerCase() || "system-call";

    const prev = grouped[grouped.length - 1];
    const canFoldIntoPrev =
      isCollapsibleCall &&
      prev &&
      prev.primary.kind === item.kind &&
      (prev.primary.actorId || prev.primary.actorName.toLowerCase() || "system-call") ===
        actorGroupKey &&
      (prev.timestampMs === 0 ||
        item.timestampMs === 0 ||
        Math.abs(prev.timestampMs - item.timestampMs) <= CALL_GROUP_WINDOW_MS);

    if (canFoldIntoPrev) {
      prev.ids.push(item.id);
      if (!item.read) {
        prev.unreadIds.push(item.id);
        prev.hasUnread = true;
      }
      prev.count += 1;
      if (item.isVideoCall) prev.hasVideo = true;
      else prev.hasVoice = true;
    } else {
      grouped.push({
        key: item.id,
        primary: item,
        ids: [item.id],
        unreadIds: item.read ? [] : [item.id],
        count: 1,
        hasVideo: item.isVideoCall,
        hasVoice: !item.isVideoCall,
        timestampMs: item.timestampMs,
        hasUnread: !item.read,
      });
    }
  }

  return grouped;
}

function resolveGroupedHeadline(entry: GroupedNotificationEntry): string {
  const { primary, count, hasVideo, hasVoice } = entry;
  if (
    (primary.kind === "call_incoming" || primary.kind === "call_missed") &&
    count > 1 &&
    hasVideo &&
    hasVoice
  ) {
    return primary.kind === "call_missed"
      ? "left missed voice & video calls"
      : "tried voice & video calling you";
  }
  return primary.headline;
}

function resolveGroupedContext(entry: GroupedNotificationEntry): string {
  const { primary, count, hasVideo, hasVoice } = entry;
  if (primary.kind === "call_incoming" || primary.kind === "call_missed") {
    if (count > 1 && hasVideo && hasVoice) {
      return primary.kind === "call_missed" ? "Missed calls" : "Calls";
    }
  }
  return primary.contextLabel;
}

export default function NotificationsDrawer({
  isOpen,
  notifications,
  profilesCache,
  loading,
  unreadCount,
  onClose,
  onSelectNotification,
  onDismissNotification,
  onMarkAllAsRead,
}: NotificationsDrawerProps) {
  const [activeTab, setActiveTab] = useState<NotificationTab>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useElasticOverscroll({
    scrollRef,
    targetRef: contentRef,
    allowTop: true,
    allowBottom: true,
    disabled: !isOpen,
    reattachKey: isOpen ? activeTab : false,
  });

  const nowMs = Date.now();

  const normalizedList = useMemo(
    () => notifications.map((n) => normalizeNotification(n, profilesCache, nowMs)),
    [notifications, profilesCache, nowMs]
  );

  const tabCounts = useMemo(() => {
    let sessions = 0;
    let calls = 0;
    for (const item of normalizedList) {
      if (item.kind === "booking" || item.kind === "review") sessions += 1;
      else if (item.kind === "call_incoming" || item.kind === "call_missed") calls += 1;
    }
    return {
      all: normalizedList.length,
      unread: unreadCount,
      sessions,
      calls,
    };
  }, [normalizedList, unreadCount]);

  const entries = useMemo(
    () => buildGroupedEntries(normalizedList, activeTab),
    [normalizedList, activeTab]
  );

  const sectionedEntries = useMemo(() => {
    const buckets: Array<{ label: string; rows: GroupedNotificationEntry[] }> = [];
    let currentLabel = "";
    for (const entry of entries) {
      const label = getSectionLabel(entry.timestampMs, nowMs);
      if (label !== currentLabel) {
        currentLabel = label;
        buckets.push({ label, rows: [entry] });
      } else {
        buckets[buckets.length - 1].rows.push(entry);
      }
    }
    return buckets;
  }, [entries, nowMs]);

  const renderBadgeGlyph = (entry: GroupedNotificationEntry) => {
    const { primary: item } = entry;
    if (item.kind === "call_missed") {
      return (
        <span className="w-[19px] h-[19px] rounded-full bg-rose-500 text-white flex items-center justify-center ring-2 ring-[#FFFFFF] shadow-2xs">
          <PhoneMissed className="w-2.5 h-2.5" strokeWidth={2.5} />
        </span>
      );
    }
    if (item.kind === "call_incoming") {
      return (
        <span className="w-[19px] h-[19px] rounded-full bg-[#0D0D0F] text-[#C9A96E] flex items-center justify-center ring-2 ring-[#FFFFFF] shadow-2xs">
          {item.isVideoCall ? (
            <Video className="w-2.5 h-2.5" strokeWidth={2.3} />
          ) : (
            <Phone className="w-2.5 h-2.5" strokeWidth={2.3} />
          )}
        </span>
      );
    }
    if (item.kind === "follower") {
      return (
        <span className="w-[19px] h-[19px] rounded-full bg-emerald-600 text-white flex items-center justify-center ring-2 ring-[#FFFFFF] shadow-2xs">
          <UserPlus className="w-2.5 h-2.5" strokeWidth={2.4} />
        </span>
      );
    }
    if (item.kind === "booking") {
      return (
        <span className="w-[19px] h-[19px] rounded-full bg-[#0D0D0F] text-[#C9A96E] flex items-center justify-center ring-2 ring-[#FFFFFF] shadow-2xs">
          <Calendar className="w-2.5 h-2.5" strokeWidth={2.3} />
        </span>
      );
    }
    if (item.kind === "battle") {
      return (
        <span className="w-[19px] h-[19px] rounded-full bg-[#0D0D0F] text-[#C9A96E] flex items-center justify-center ring-2 ring-[#FFFFFF] shadow-2xs">
          <Swords className="w-2.5 h-2.5" strokeWidth={2.3} />
        </span>
      );
    }
    if (item.kind === "review") {
      return (
        <span className="w-[19px] h-[19px] rounded-full bg-amber-500 text-white flex items-center justify-center ring-2 ring-[#FFFFFF] shadow-2xs">
          <Star className="w-2.5 h-2.5 fill-current" strokeWidth={2} />
        </span>
      );
    }
    if (item.kind === "chat") {
      return (
        <span className="w-[19px] h-[19px] rounded-full bg-[#0D0D0F] text-white flex items-center justify-center ring-2 ring-[#FFFFFF] shadow-2xs">
          <MessageCircle className="w-2.5 h-2.5" strokeWidth={2.3} />
        </span>
      );
    }
    return null;
  };

  const tabs: Array<{ id: NotificationTab; label: string; count?: number }> = [
    { id: "all", label: "All" },
    { id: "unread", label: "Unread", count: tabCounts.unread },
    { id: "sessions", label: "Sessions", count: tabCounts.sessions },
    { id: "calls", label: "Calls", count: tabCounts.calls },
  ];

  const emptyStateCopy = useMemo(() => {
    if (activeTab === "unread") {
      return {
        title: "No unread activity",
        subtitle: "Everything in your inbox has already been reviewed.",
      };
    }
    if (activeTab === "sessions") {
      return {
        title: "No session notifications",
        subtitle: "Swap bookings, schedule changes, and new reviews appear here.",
      };
    }
    if (activeTab === "calls") {
      return {
        title: "No recent calls",
        subtitle: "Incoming and missed audio or video calls will show up here.",
      };
    }
    return {
      title: "You’re all caught up",
      subtitle: "Session requests, new connections, reviews, and calls appear here.",
    };
  }, [activeTab]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          onClick={onClose}
          className="fixed inset-0 z-[70] bg-[#0D0D0F]/35 backdrop-blur-[2px] flex justify-end font-sans"
        >
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-[430px] bg-[#F7F4EE] sm:border-l sm:border-[#E8E4DB] h-full flex flex-col relative z-50 shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <header
              className="bg-[#FFFFFF] border-b border-[#E8E4DB] shrink-0"
              style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
            >
              <div className="px-4 sm:px-5 pb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#FAF8F4] border border-[#E8E4DB] flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4 text-[#8E6F3A]" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[18px] font-bold tracking-[-0.02em] text-[#0D0D0F] leading-tight">
                      Activity
                    </h2>
                    <p className="text-[12px] text-[#71717A] tabular-nums truncate mt-0.5">
                      {unreadCount > 0
                        ? `${unreadCount} unread ${unreadCount === 1 ? "update" : "updates"}`
                        : "All caught up"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {unreadCount > 0 && (
                    <button
                      id="mark-all-read-btn"
                      type="button"
                      onClick={onMarkAllAsRead}
                      className="min-h-[40px] px-3 rounded-xl text-[12px] font-semibold text-[#0D0D0F] bg-[#FAF8F4] hover:bg-[#F2EFE8] border border-[#E8E4DB] transition inline-flex items-center gap-1.5 cursor-pointer active:scale-[0.98] whitespace-nowrap shrink-0"
                    >
                      <CheckCheck className="w-3.5 h-3.5 text-[#9A7A42]" strokeWidth={2.2} />
                      <span>Mark read</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close notifications"
                    className="min-w-[44px] min-h-[44px] rounded-full hover:bg-[#F7F4EE] flex items-center justify-center text-[#52525B] hover:text-[#0D0D0F] transition cursor-pointer active:scale-95"
                  >
                    <X className="w-4.5 h-4.5" strokeWidth={2} />
                  </button>
                </div>
              </div>

              {/* Clean Segmented Category Filter */}
              <div className="px-4 sm:px-5 pb-3">
                <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#F4F1EA] border border-[#EAE5DA]">
                  {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`min-h-[34px] px-2 rounded-lg text-[12px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap shrink-0 ${
                          isActive
                            ? "bg-[#FFFFFF] text-[#0D0D0F] shadow-2xs ring-1 ring-black/[0.04]"
                            : "text-[#71717A] hover:text-[#0D0D0F]"
                        }`}
                      >
                        <span>{tab.label}</span>
                        {typeof tab.count === "number" && tab.count > 0 && (
                          <span
                            className={`text-[10.5px] tabular-nums ${
                              isActive ? "text-[#8E6F3A]" : "text-[#A1A1AA]"
                            }`}
                          >
                            {tab.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </header>

            {/* Scrollable Notifications Stream with Elastic Stretch */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto min-h-0 bg-[#F7F4EE] mobile-scroll overscroll-y-contain"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 24px)" }}
            >
              <div ref={contentRef} className="w-full py-3.5 space-y-4">
                <LoadingTransition
                  isLoading={loading && notifications.length === 0}
                  type="notifications"
                  count={5}
                >
                  {sectionedEntries.length === 0 ? (
                    <div className="mx-3.5 sm:mx-4 rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] py-16 px-6 flex flex-col items-center text-center">
                      <div className="w-12 h-12 rounded-full bg-[#FAF8F4] border border-[#E8E4DB] flex items-center justify-center mb-3.5">
                        <Bell className="w-5 h-5 text-[#8E6F3A]" strokeWidth={1.8} />
                      </div>
                      <p className="text-[14.5px] font-semibold text-[#0D0D0F]">
                        {emptyStateCopy.title}
                      </p>
                      <p className="text-[12.5px] text-[#71717A] max-w-[245px] leading-relaxed mt-1">
                        {emptyStateCopy.subtitle}
                      </p>
                      {activeTab !== "all" && notifications.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setActiveTab("all")}
                          className="mt-4 min-h-[40px] px-4 rounded-xl bg-[#FAF8F4] hover:bg-[#F2EFE8] border border-[#E8E4DB] text-[12.5px] font-semibold text-[#0D0D0F] transition cursor-pointer"
                        >
                          Show all activity
                        </button>
                      )}
                    </div>
                  ) : (
                    sectionedEntries.map((section) => (
                      <section key={section.label} className="px-3.5 sm:px-4">
                        <div className="flex items-center justify-between px-1 pb-2">
                          <span className="text-[12px] font-semibold text-[#52525B] tracking-tight">
                            {section.label}
                          </span>
                          <span className="text-[11px] font-medium text-[#A1A1AA] tabular-nums">
                            {section.rows.length}
                          </span>
                        </div>

                        <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl overflow-hidden">
                          {section.rows.map((entry, idx) => {
                            const { primary } = entry;
                            const timeLabel = formatRelativeTime(entry.timestampMs, nowMs);
                            const initials = getInitials(primary.actorName);
                            const headlineText = resolveGroupedHeadline(entry);
                            const contextText = resolveGroupedContext(entry);

                            return (
                              <div
                                key={entry.key}
                                className={idx > 0 ? "relative" : undefined}
                              >
                                {idx > 0 && (
                                  <div
                                    aria-hidden="true"
                                    className="h-px bg-[#F2EFE8] ml-[72px] mr-3.5"
                                  />
                                )}

                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() =>
                                    onSelectNotification(primary.raw, entry.unreadIds)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      onSelectNotification(primary.raw, entry.unreadIds);
                                    }
                                  }}
                                  className={`px-3.5 py-3 flex items-start gap-3 cursor-pointer transition-colors group select-none ${
                                    entry.hasUnread
                                      ? "bg-[#FCF9F1] hover:bg-[#F7F2E6] active:bg-[#F2ECE0]"
                                      : "bg-[#FFFFFF] hover:bg-[#FAF8F4] active:bg-[#F4F0E6]"
                                  }`}
                                >
                                  {/* Avatar + Micro Category Glyph */}
                                  <div className="relative shrink-0 mt-0.5">
                                    {primary.actorPhoto ? (
                                      <SmartImage
                                        src={primary.actorPhoto}
                                        alt={primary.actorName || "Member"}
                                        fallbackType="profile"
                                        fullName={primary.actorName || "Member"}
                                        sizeType="thumbnail"
                                        className="w-11 h-11 rounded-full object-cover ring-1 ring-black/[0.06] bg-[#F2EFE8]"
                                      />
                                    ) : primary.actorName ? (
                                      <div className="w-11 h-11 rounded-full bg-[#F2EFE8] border border-[#E6E0D4] text-[#0D0D0F] text-[13px] font-semibold flex items-center justify-center">
                                        {initials || primary.actorName[0]?.toUpperCase()}
                                      </div>
                                    ) : (
                                      <div className="w-11 h-11 rounded-full bg-[#FAF8F4] border border-[#E8E4DB] text-[#71717A] flex items-center justify-center">
                                        {primary.kind === "call_missed" ? (
                                          <PhoneMissed
                                            className="w-4.5 h-4.5 text-rose-500"
                                            strokeWidth={2}
                                          />
                                        ) : (
                                          <Bell
                                            className="w-4.5 h-4.5 text-[#8E6F3A]"
                                            strokeWidth={1.9}
                                          />
                                        )}
                                      </div>
                                    )}

                                    {primary.actorName && (
                                      <div className="absolute -bottom-0.5 -right-0.5 pointer-events-none">
                                        {renderBadgeGlyph(entry)}
                                      </div>
                                    )}
                                  </div>

                                  {/* Primary Message & Metadata */}
                                  <div className="flex-1 min-w-0 pt-0.5">
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="text-[13.5px] leading-[1.38] text-[#27272A] break-words">
                                        {primary.actorName && (
                                          <span className="font-semibold text-[#0D0D0F]">
                                            {primary.actorName}
                                            {primary.actorVerified && (
                                              <BadgeCheck
                                                className="inline-block w-3.5 h-3.5 text-[#9A7A42] fill-[#C9A96E]/15 align-[-2px] ml-1 mr-0.5"
                                                aria-label="Verified"
                                              />
                                            )}{" "}
                                          </span>
                                        )}
                                        <span
                                          className={
                                            entry.hasUnread
                                              ? "text-[#18181B]"
                                              : "text-[#52525B]"
                                          }
                                        >
                                          {headlineText}
                                        </span>
                                      </p>

                                      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                                        {timeLabel && (
                                          <span className="text-[11px] font-medium text-[#8A8478] tabular-nums whitespace-nowrap">
                                            {timeLabel}
                                          </span>
                                        )}
                                        {entry.hasUnread && (
                                          <span
                                            className="w-2 h-2 rounded-full bg-[#C9A96E] shrink-0"
                                            aria-label="Unread"
                                          />
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-2 mt-1">
                                      <div className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-[#71717A] tabular-nums">
                                        {contextText && (
                                          <span className="text-[#71717A] truncate">
                                            {contextText}
                                          </span>
                                        )}
                                        {entry.count > 1 && (
                                          <>
                                            {contextText && <span aria-hidden="true">·</span>}
                                            <span className="font-medium text-[#52525B] shrink-0">
                                              {entry.count} attempts
                                            </span>
                                          </>
                                        )}
                                        {primary.topic && (
                                          <>
                                            {(contextText || entry.count > 1) && (
                                              <span aria-hidden="true">·</span>
                                            )}
                                            <span className="truncate text-[#8E6F3A] font-medium">
                                              {primary.topic}
                                            </span>
                                          </>
                                        )}
                                      </div>

                                      <button
                                        type="button"
                                        onClick={(e) => onDismissNotification(entry.ids, e)}
                                        aria-label="Dismiss notification"
                                        title="Dismiss"
                                        className="w-7 h-7 -mr-1.5 -my-1 rounded-full flex items-center justify-center text-[#C4BEB2] sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 hover:bg-[#EFECE4] hover:text-[#0D0D0F] transition cursor-pointer shrink-0"
                                      >
                                        <X className="w-3.5 h-3.5" strokeWidth={2} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))
                  )}
                </LoadingTransition>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
