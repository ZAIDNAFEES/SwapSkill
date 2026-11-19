import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Eye,
  Clock,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Sliders,
  Share2,
  Flag,
  UserPlus,
  Swords,
  Scale,
  MessageSquare,
  Info,
  Trophy,
  Heart,
  ExternalLink,
  Loader2,
  Pin,
  Mic,
  MicOff,
  Check,
  Send,
  MoreVertical,
  X,
  AlertCircle,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  Battle,
  BattleComment,
  BattleCommentReplyRef,
  BattleJudge,
  BattleResult,
  BattleRoundState,
  BattleScore,
  BattleVote,
} from "../../types/battle";
import { DEFAULT_AVATAR } from "../../types";
import { SmartImage } from "../SmartImage";
import { BattleChatPanel } from "./BattleChatPanel";
import { BattleJudgesDrawer } from "./BattleJudgesDrawer";
import {
  SlotVideoMetrics,
  StreamQualitySetting,
  ViewerStreamStatus,
} from "../../services/battles/battleMediaAdapter";
import {
  ApplauseBurstEvent,
  RoomPublishersState,
} from "../../services/battles/battleRealtimeClient";
import { mobileForegroundService } from "../../services/mobile/foregroundService";

const BLACK_POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'%3E%3Crect width='100%25' height='100%25' fill='%23090A0F'/%3E%3C/svg%3E";

interface AudienceViewerViewProps {
  battle: Battle;
  currentUserId: string;
  isAdmin: boolean;
  isAssignedJudge: boolean;
  canScoreAsJudge: boolean;
  viewerCount: number;
  secondsRemaining: number;
  roundState: BattleRoundState;
  countdownSecs: number;
  wsConnected: boolean;
  publishers: RoomPublishersState;
  slotStreams: Record<"A" | "B", MediaStream | null>;
  slotStatuses: Record<"A" | "B", ViewerStreamStatus>;
  slotMetrics?: Record<"A" | "B", SlotVideoMetrics | null>;
  quality: StreamQualitySetting;
  sfuMode: "mediasoup_sfu" | "ws_webrtc_relay";
  comments: BattleComment[];
  mutedUntilMs: number;
  scores: BattleScore[];
  myVote: BattleVote | null;
  result: BattleResult | null;
  applauseBursts: ApplauseBurstEvent[];
  followedUids: Record<string, boolean>;
  actionBusy: boolean;
  onLeave: () => void;
  onClaimOpenBattle: () => void;
  onVote: (slot: "A" | "B", uid: string) => void;
  onApplause: (emoji?: string) => void;
  onFollow: (uid: string) => void;
  onChangeQuality: (q: StreamQualitySetting) => void;
  onSendMessage: (text: string, replyTo?: BattleCommentReplyRef) => void;
  onRetryMessage: (msg: BattleComment) => void;
  onReactMessage: (messageId: string, emoji: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onMuteUser: (targetUid: string) => void;
  onSubmitJudgeScore: (input: {
    competitorAScores: Record<string, number>;
    competitorBScores: Record<string, number>;
    feedbackA: string;
    feedbackB: string;
    overallNote: string;
  }) => Promise<void>;
  onAssignJudge?: (judge: BattleJudge) => Promise<void>;
  onOpenJudgeApplication?: () => void;
  onFinalizeResult: () => void;
  onOpenResult: () => void;
  onShare: () => void;
  onReport: () => void;
  onViewProfile: (uid: string) => void;
}

export const AudienceViewerView: React.FC<AudienceViewerViewProps> = ({
  battle,
  currentUserId,
  isAdmin,
  isAssignedJudge,
  canScoreAsJudge,
  viewerCount,
  secondsRemaining,
  roundState,
  countdownSecs,
  wsConnected,
  publishers,
  slotStreams,
  slotStatuses,
  slotMetrics,
  quality,
  sfuMode,
  comments,
  mutedUntilMs,
  scores,
  myVote,
  result,
  applauseBursts,
  followedUids,
  actionBusy,
  onLeave,
  onClaimOpenBattle,
  onVote,
  onApplause,
  onFollow,
  onChangeQuality,
  onSendMessage,
  onRetryMessage,
  onReactMessage,
  onDeleteMessage,
  onMuteUser,
  onSubmitJudgeScore,
  onAssignJudge,
  onOpenJudgeApplication,
  onFinalizeResult,
  onOpenResult,
  onShare,
  onReport,
  onViewProfile,
}) => {
  const videoARef = useRef<HTMLVideoElement | null>(null);
  const videoBRef = useRef<HTMLVideoElement | null>(null);
  const stageWrapperRef = useRef<HTMLDivElement | null>(null);

  const [streamMuted, setStreamMuted] = useState(true);
  const [spotlightSlot, setSpotlightSlot] = useState<"A" | "B" | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nativePipSupported, setNativePipSupported] = useState(false);

  // Overlays & Drawers
  const [judgesDrawerOpen, setJudgesDrawerOpen] = useState(false);
  const [fullChatOpen, setFullChatOpen] = useState(false);
  const [optionsSheetOpen, setOptionsSheetOpen] = useState(false);
  const [cheerMenuOpen, setCheerMenuOpen] = useState(false);
  const [quickInput, setQuickInput] = useState("");

  useEffect(() => {
    mobileForegroundService.isPipSupported().then(setNativePipSupported).catch(() => {});
  }, []);

  // Re-attach live MediaStreams whenever element or spotlight changes
  useEffect(() => {
    const el = videoARef.current;
    const stream = slotStreams.A;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play?.().catch(() => {});
  }, [slotStreams.A, spotlightSlot]);

  useEffect(() => {
    const el = videoBRef.current;
    const stream = slotStreams.B;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play?.().catch(() => {});
  }, [slotStreams.B, spotlightSlot]);

  // Auto-spotlight whichever competitor enables Screen Share
  useEffect(() => {
    if (publishers.A?.screenSharing && !publishers.B?.screenSharing) {
      setSpotlightSlot("A");
    } else if (publishers.B?.screenSharing && !publishers.A?.screenSharing) {
      setSpotlightSlot("B");
    }
  }, [publishers.A?.screenSharing, publishers.B?.screenSharing]);

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && stageWrapperRef.current) {
        await stageWrapperRef.current.requestFullscreen?.();
        setIsFullscreen(true);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    } catch (_) {}
  };

  const handleEnterPip = async () => {
    if (nativePipSupported) {
      await mobileForegroundService.enterPipMode();
      return;
    }
    const targetVideo =
      (spotlightSlot === "B" ? videoBRef.current : videoARef.current) || videoBRef.current;
    if (targetVideo && (targetVideo as any).requestPictureInPicture) {
      try {
        await (targetVideo as any).requestPictureInPicture();
      } catch (_) {}
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const visibleComments = useMemo(
    () => comments.filter((m) => !m.deleted),
    [comments]
  );
  const recentOverlayComments = useMemo(
    () => visibleComments.slice(-4),
    [visibleComments]
  );

  const isStreamActivelyBroadcasting = Boolean(
    publishers.A?.publishing ||
      publishers.B?.publishing ||
      slotStatuses.A === "live" ||
      slotStatuses.B === "live" ||
      slotStreams.A ||
      slotStreams.B
  );
  const showGenuineLiveBadge = battle.status === "live" && isStreamActivelyBroadcasting;

  const totalVotes = (battle.audienceVotesA || 0) + (battle.audienceVotesB || 0);
  const votePctA =
    totalVotes > 0 ? Math.round(((battle.audienceVotesA || 0) / totalVotes) * 100) : 50;
  const votePctB = totalVotes > 0 ? 100 - votePctA : 50;

  const canJoinOpen =
    battle.status === "open" &&
    battle.creatorId !== currentUserId &&
    !battle.opponentId;

  const canPip =
    nativePipSupported ||
    (typeof document !== "undefined" && Boolean((document as any).pictureInPictureEnabled));

  const isMutedInChat = mutedUntilMs > Date.now();
  const judgeCount = battle.judges?.length || 0;

  const handleQuickSend = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = quickInput.trim();
    if (!clean || isMutedInChat) return;
    onSendMessage(clean);
    setQuickInput("");
  };

  const renderHostTile = (slot: "A" | "B") => {
    const comp = slot === "A" ? battle.competitorA : battle.competitorB;
    const stream = slotStreams[slot];
    const status = slotStatuses[slot];
    const pub = publishers[slot];
    const metrics = slotMetrics?.[slot];
    const videoRef = slot === "A" ? videoARef : videoBRef;

    const hasVideoTrack = Boolean(
      stream && stream.getVideoTracks().some((t) => t.readyState === "live")
    );
    const camOn = pub ? pub.camActive || pub.screenSharing : false;
    const isSharing = Boolean(pub?.screenSharing || comp?.screenSharing);
    const showVideo = Boolean(stream && (hasVideoTrack || isSharing) && (camOn || status === "live"));
    const isSpotlighted = spotlightSlot === slot;
    const isMiniPip = Boolean(spotlightSlot && spotlightSlot !== slot);

    return (
      <div
        key={slot}
        className={
          isMiniPip
            ? "absolute top-20 right-3 z-25 w-28 sm:w-36 aspect-[3/4] rounded-2xl border-2 border-white/25 bg-[#090A0F] shadow-2xl overflow-hidden cursor-pointer"
            : "relative flex-1 min-w-0 min-h-0 w-full h-full bg-[#090A0F] flex items-center justify-center overflow-hidden"
        }
        onClick={
          isMiniPip
            ? () => setSpotlightSlot(slot)
            : undefined
        }
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={streamMuted}
          poster={BLACK_POSTER}
          className={
            showVideo
              ? `w-full h-full ${isSharing ? "object-contain bg-black" : "object-cover"}`
              : "absolute w-px h-px opacity-0 pointer-events-none"
          }
        />

        {!showVideo && (
          !comp ? (
            <div className="flex flex-col items-center text-center p-4">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-2">
                <Swords className="w-6 h-6 text-[#C9A96E]" />
              </div>
              <span className="text-[13px] font-bold text-white">Open Challenger Seat</span>
              {canJoinOpen && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={onClaimOpenBattle}
                  className="mt-2.5 min-h-[38px] px-4 rounded-full bg-[#C9A96E] text-[#0D0D0F] text-[12px] font-extrabold cursor-pointer"
                >
                  Join & Compete Live
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center text-center p-3">
              <SmartImage
                src={comp.photoUrl || DEFAULT_AVATAR}
                alt={comp.name}
                fallbackType="profile"
                fullName={comp.name}
                className={`${
                  isMiniPip ? "w-11 h-11" : "w-16 h-16 sm:w-20 sm:h-20"
                } rounded-full object-cover border-2 ${
                  slot === "A" ? "border-[#C9A96E]/70" : "border-sky-400/70"
                } mb-2`}
              />
              <span className="text-[12px] sm:text-[13px] font-bold text-white truncate max-w-[160px]">
                {comp.name}
              </span>
              <span className="text-[11px] text-neutral-300 mt-0.5 flex items-center gap-1.5">
                {(status === "connecting" || status === "buffering" || status === "reconnecting") && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A96E]" />
                )}
                {status === "connecting"
                  ? "Connecting live stream..."
                  : status === "buffering" || status === "reconnecting"
                  ? "Reconnecting..."
                  : pub?.publishing
                  ? "Camera Off · Audio Live"
                  : "Waiting to go live"}
              </span>
            </div>
          )
        )}

        {/* Per-Host Identity + Mic + Pin Pill */}
        {comp && !isMiniPip && (
          <div
            className={`absolute left-3 right-3 ${
              slot === "B" || spotlightSlot === "A"
                ? "top-2.5"
                : "top-[max(3.75rem,calc(env(safe-area-inset-top)+3.25rem))]"
            } flex items-center justify-between gap-2 pointer-events-none z-10`}
          >
            <div className="pointer-events-auto flex items-center gap-1.5 min-w-0 max-w-[78%]">
              <button
                type="button"
                onClick={() => onViewProfile(comp.uid)}
                className="px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-md border border-white/15 flex items-center gap-1.5 min-w-0 cursor-pointer"
              >
                <span
                  className={`text-[10px] font-black ${
                    slot === "A" ? "text-[#C9A96E]" : "text-sky-300"
                  }`}
                >
                  {slot}
                </span>
                <span className="text-[11px] font-bold text-white truncate">{comp.name}</span>
                {pub?.micActive === false ? (
                  <MicOff className="w-3 h-3 text-rose-400 shrink-0" />
                ) : pub?.publishing ? (
                  <Mic className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : null}
              </button>

              {metrics && metrics.height >= 720 && (
                <span className="px-1.5 py-0.5 rounded-full bg-black/55 border border-white/15 text-[9px] font-extrabold text-emerald-300 tabular-nums shrink-0">
                  {metrics.height >= 1080 ? "1080p" : "720p"}
                </span>
              )}

              {comp.uid !== currentUserId && !followedUids[comp.uid] && (
                <button
                  type="button"
                  onClick={() => onFollow(comp.uid)}
                  aria-label={`Follow ${comp.name}`}
                  className="w-7 h-7 rounded-full bg-[#C9A96E]/90 hover:bg-[#C9A96E] text-[#0D0D0F] flex items-center justify-center shrink-0 cursor-pointer shadow"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSpotlightSlot((prev) => (prev === slot ? null : slot))}
              aria-label={isSpotlighted ? "Exit Spotlight" : "Spotlight Host"}
              className={`pointer-events-auto w-8 h-8 rounded-full backdrop-blur-md border flex items-center justify-center cursor-pointer transition ${
                isSpotlighted
                  ? "bg-[#C9A96E] border-[#C9A96E] text-[#0D0D0F]"
                  : "bg-black/55 border-white/15 text-white hover:bg-black/75"
              }`}
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={stageWrapperRef}
      className="fixed inset-0 z-[80] h-[100dvh] w-full bg-[#06070B] text-white flex flex-col lg:flex-row overflow-hidden select-none"
    >
      {/* MAIN INSTAGRAM LIVE BROADCAST STAGE */}
      <div className="relative flex-1 min-w-0 min-h-0 flex flex-col bg-black overflow-hidden">
        {/* Dual-Host Full-Bleed Split Stage (Stacked Portrait on Mobile, Side-by-Side on Desktop) */}
        <div
          className={`flex-1 min-h-0 w-full h-full flex ${
            spotlightSlot
              ? "relative"
              : "flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-white/15"
          }`}
        >
          {renderHostTile("A")}
          {renderHostTile("B")}
        </div>

        {/* Top Instagram Live Overlay Header */}
        <header className="absolute inset-x-0 top-0 z-30 px-3 pt-[max(0.55rem,env(safe-area-inset-top))] pb-6 bg-gradient-to-b from-black/85 via-black/45 to-transparent flex items-center justify-between gap-2 pointer-events-none">
          {/* Left: Back + Dual Avatars + Title */}
          <div className="pointer-events-auto flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onLeave}
              aria-label="Leave Live Battle"
              className="w-9 h-9 rounded-full bg-black/55 hover:bg-black/75 backdrop-blur-md border border-white/15 flex items-center justify-center cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
            </button>

            <div className="flex items-center -space-x-2 shrink-0">
              <SmartImage
                src={battle.competitorA.photoUrl || DEFAULT_AVATAR}
                alt={battle.competitorA.name}
                fallbackType="profile"
                fullName={battle.competitorA.name}
                className="w-8 h-8 rounded-full object-cover border-2 border-[#C9A96E]"
              />
              {battle.competitorB && (
                <SmartImage
                  src={battle.competitorB.photoUrl || DEFAULT_AVATAR}
                  alt={battle.competitorB.name}
                  fallbackType="profile"
                  fullName={battle.competitorB.name}
                  className="w-8 h-8 rounded-full object-cover border-2 border-sky-400"
                />
              )}
            </div>

            <div className="min-w-0">
              <h1 className="text-[13px] font-extrabold text-white truncate drop-shadow leading-tight">
                {battle.title}
              </h1>
              <p className="text-[10px] text-neutral-300 truncate leading-tight">
                {battle.competitorA.name}
                {battle.competitorB ? ` vs ${battle.competitorB.name}` : " · Open Challenge"}
              </p>
            </div>
          </div>

          {/* Right: Genuine LIVE badge + Prominent Judges CTA beside LIVE + Viewers + Menu */}
          <div className="pointer-events-auto flex items-center gap-1.5 shrink-0">
            {showGenuineLiveBadge ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-rose-600 text-white text-[10px] font-black uppercase tracking-wider shadow-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                LIVE
              </span>
            ) : (
              <span className="px-2 py-1 rounded-full bg-black/65 border border-[#C9A96E]/40 text-[#C9A96E] text-[10px] font-bold uppercase">
                {battle.status === "live" ? "Starting" : battle.status.replace("_", " ")}
              </span>
            )}

            {/* PROMINENT TOP JUDGES BUTTON RIGHT BESIDE LIVE */}
            <button
              type="button"
              onClick={() => setJudgesDrawerOpen(true)}
              aria-label="Open Battle Judges & Scoring"
              className={`h-8 px-2.5 rounded-full backdrop-blur-md border text-[11px] font-extrabold flex items-center gap-1 cursor-pointer transition shadow-lg ${
                canScoreAsJudge
                  ? "bg-[#C9A96E] border-[#C9A96E] text-[#0D0D0F]"
                  : "bg-black/65 hover:bg-black/85 border-[#C9A96E]/60 text-[#C9A96E]"
              }`}
            >
              <Scale className="w-3.5 h-3.5 shrink-0" />
              <span>{canScoreAsJudge ? "Judge" : "Judges"}</span>
              {judgeCount > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] tabular-nums ${
                    canScoreAsJudge
                      ? "bg-[#0D0D0F]/15 text-[#0D0D0F]"
                      : "bg-[#C9A96E]/25 text-white"
                  }`}
                >
                  {judgeCount}
                </span>
              )}
            </button>

            <span className="h-8 px-2 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-[11px] font-bold text-white flex items-center gap-1 tabular-nums">
              <Eye className="w-3.5 h-3.5 text-neutral-300" />
              <span>{viewerCount}</span>
            </span>

            <span className="hidden sm:flex h-8 px-2.5 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-[11px] font-black text-white items-center gap-1 tabular-nums">
              <Clock className="w-3 h-3 text-[#C9A96E]" />
              <span>{formatTimer(secondsRemaining)}</span>
            </span>

            <button
              type="button"
              onClick={() => setOptionsSheetOpen(true)}
              aria-label="Stream Options & Info"
              className="w-8 h-8 rounded-full bg-black/55 hover:bg-black/80 backdrop-blur-md border border-white/15 flex items-center justify-center cursor-pointer"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Synchronized 3-2-1 Countdown Overlay */}
        {countdownSecs > 0 && (
          <div className="absolute inset-0 z-35 bg-black/65 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#C9A96E] mb-2">
              Battle Starting
            </span>
            <div className="w-24 h-24 rounded-full bg-[#C9A96E] text-[#0D0D0F] flex items-center justify-center text-[44px] font-black shadow-2xl animate-bounce">
              {countdownSecs}
            </div>
          </div>
        )}

        {/* Tap-to-Unmute Pill */}
        {streamMuted && (slotStreams.A || slotStreams.B) && (
          <button
            type="button"
            onClick={() => setStreamMuted(false)}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-[#C9A96E] text-[#0D0D0F] text-[11px] font-extrabold shadow-xl flex items-center gap-1.5 cursor-pointer"
          >
            <VolumeX className="w-3.5 h-3.5" />
            <span>Tap for Audio</span>
          </button>
        )}

        {/* Floating Upward Hearts / Cheers on Right Side */}
        <div className="absolute right-3 bottom-44 z-25 pointer-events-none flex flex-col items-end gap-1.5">
          {applauseBursts.slice(-5).map((b, idx) => (
            <div
              key={`${b.uid}_${b.atMs}_${idx}`}
              className="px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 text-[14px] flex items-center gap-1 animate-bounce shadow-lg"
            >
              <span>{b.emoji}</span>
              <span className="text-[10px] font-semibold text-neutral-200 max-w-[80px] truncate">
                {b.name}
              </span>
            </div>
          ))}
        </div>

        {/* BOTTOM INSTAGRAM LIVE OVERLAY (Translucent Comments + Audience Voting + Composer) */}
        <div className="absolute inset-x-0 bottom-0 z-30 pt-10 px-3 pb-[max(0.65rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/95 via-black/65 to-transparent flex flex-col gap-2 pointer-events-none">
          {/* Live Overlay Comments Feed (last 4 messages, tappable to open full chat drawer) */}
          <div className="pointer-events-auto flex flex-col gap-1 max-w-md">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <button
                type="button"
                onClick={() => setFullChatOpen(true)}
                className="px-2.5 py-0.5 rounded-full bg-black/50 hover:bg-black/75 border border-white/15 text-[10px] font-bold text-neutral-200 flex items-center gap-1.5 cursor-pointer"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    wsConnected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                  }`}
                />
                <MessageSquare className="w-3 h-3 text-[#C9A96E]" />
                <span>Live Chat ({visibleComments.length}) · Expand</span>
              </button>

              {result && (
                <button
                  type="button"
                  onClick={onOpenResult}
                  className="px-2.5 py-0.5 rounded-full bg-[#C9A96E] text-[#0D0D0F] text-[10px] font-extrabold flex items-center gap-1 cursor-pointer"
                >
                  <Trophy className="w-3 h-3" />
                  <span>View Result</span>
                </button>
              )}
            </div>

            <div className="space-y-1 max-h-32 overflow-hidden">
              {recentOverlayComments.length === 0 ? (
                <p className="text-[11px] text-neutral-300/80 px-2 py-1 rounded-lg bg-black/35 backdrop-blur-sm w-fit">
                  Say hi in live chat or send a cheer!
                </p>
              ) : (
                recentOverlayComments.map((msg) => {
                  const isOwn = msg.authorId === currentUserId;
                  return (
                    <div
                      key={msg.id}
                      onClick={() => {
                        if (isOwn && msg.deliveryStatus === "failed") {
                          onRetryMessage(msg);
                        } else {
                          setFullChatOpen(true);
                        }
                      }}
                      className="px-2.5 py-1 rounded-xl bg-black/45 backdrop-blur-sm border border-white/10 text-[12px] leading-snug flex items-start gap-2 cursor-pointer max-w-full"
                    >
                      <SmartImage
                        src={msg.authorPhoto || DEFAULT_AVATAR}
                        alt={msg.authorName}
                        fallbackType="profile"
                        fullName={msg.authorName}
                        className="w-5 h-5 rounded-full object-cover shrink-0 mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <span
                          className={`font-bold mr-1.5 ${
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
                        <span className="text-white/95 break-words">{msg.text}</span>
                        {isOwn && msg.deliveryStatus === "sending" && (
                          <span className="ml-1.5 text-[10px] text-neutral-400">Sending…</span>
                        )}
                        {isOwn && msg.deliveryStatus === "failed" && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-400">
                            <AlertCircle className="w-3 h-3" /> Retry <RotateCcw className="w-2.5 h-2.5" />
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Interactive Audience Voting Bar */}
          {battle.allowAudienceVoting &&
            (battle.status === "live" || battle.status === "judging") &&
            battle.competitorB && (
              <div className="pointer-events-auto p-2 rounded-2xl bg-black/65 backdrop-blur-md border border-white/15 space-y-1.5 max-w-xl">
                <div className="flex items-center justify-between text-[10px] font-bold text-neutral-300 px-0.5">
                  <span className="text-[#C9A96E] truncate max-w-[38%]">
                    A: {battle.competitorA.name} ({battle.audienceVotesA || 0})
                  </span>
                  <span className="text-[10px] text-neutral-400 tabular-nums">
                    {myVote ? "Vote Locked" : `${totalVotes} Audience Votes`}
                  </span>
                  <span className="text-sky-300 truncate max-w-[38%] text-right">
                    ({battle.audienceVotesB || 0}) {battle.competitorB.name} :B
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={Boolean(myVote) || actionBusy}
                    onClick={() => onVote("A", battle.competitorA.uid)}
                    className={`min-h-[34px] px-3 rounded-xl text-[11px] font-extrabold cursor-pointer shrink-0 transition ${
                      myVote?.votedForSlot === "A"
                        ? "bg-[#C9A96E] text-[#0D0D0F]"
                        : myVote
                        ? "bg-white/10 text-neutral-400"
                        : "bg-[#C9A96E]/25 hover:bg-[#C9A96E] text-[#C9A96E] hover:text-[#0D0D0F]"
                    }`}
                  >
                    {myVote?.votedForSlot === "A" ? "Voted A" : `Vote A · ${votePctA}%`}
                  </button>

                  <div className="flex-1 h-2 rounded-full bg-white/15 overflow-hidden flex">
                    <div
                      className="bg-[#C9A96E] transition-all duration-300"
                      style={{ width: `${votePctA}%` }}
                    />
                    <div
                      className="bg-sky-400 transition-all duration-300"
                      style={{ width: `${votePctB}%` }}
                    />
                  </div>

                  <button
                    type="button"
                    disabled={Boolean(myVote) || actionBusy}
                    onClick={() => onVote("B", battle.competitorB!.uid)}
                    className={`min-h-[34px] px-3 rounded-xl text-[11px] font-extrabold cursor-pointer shrink-0 transition ${
                      myVote?.votedForSlot === "B"
                        ? "bg-sky-400 text-[#0D0D0F]"
                        : myVote
                        ? "bg-white/10 text-neutral-400"
                        : "bg-sky-400/25 hover:bg-sky-400 text-sky-300 hover:text-[#0D0D0F]"
                    }`}
                  >
                    {myVote?.votedForSlot === "B" ? "Voted B" : `Vote B · ${votePctB}%`}
                  </button>
                </div>
              </div>
            )}

          {/* Judge / Admin Quick Finalize Strip when Judging */}
          {(isAssignedJudge || isAdmin) &&
            (battle.status === "judging" ||
              (battle.status === "live" && battle.judgingMethod === "automatic")) && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={onFinalizeResult}
                className="pointer-events-auto max-w-xl min-h-[38px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0D0D0F] text-[12px] font-extrabold flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
              >
                <Trophy className="w-4 h-4" />
                <span>Finalize Official Result & Award XP</span>
              </button>
            )}

          {/* Single-Row Instagram Live Bottom Composer & Action Bar */}
          <div className="pointer-events-auto flex items-center gap-1.5 max-w-2xl">
            <form
              onSubmit={handleQuickSend}
              className="flex-1 min-w-0 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 pl-3.5 pr-1.5 py-1"
            >
              <input
                type="text"
                value={quickInput}
                disabled={isMutedInChat}
                onChange={(e) => setQuickInput(e.target.value)}
                maxLength={320}
                placeholder={
                  isMutedInChat ? "Muted in chat..." : "Comment live..."
                }
                className="flex-1 min-w-0 bg-transparent text-[13px] text-white placeholder:text-neutral-400 focus:outline-none py-1.5"
              />
              <button
                type="submit"
                disabled={!quickInput.trim() || isMutedInChat}
                aria-label="Send live comment"
                className="w-8 h-8 rounded-full bg-[#C9A96E] text-[#0D0D0F] flex items-center justify-center cursor-pointer disabled:opacity-40 shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>

            {/* Quick Cheer Picker */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setCheerMenuOpen((o) => !o)}
                aria-label="Send Cheer"
                className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 text-[16px] flex items-center justify-center cursor-pointer active:scale-90 transition"
              >
                🔥
              </button>
              {cheerMenuOpen && (
                <div className="absolute bottom-12 right-0 flex items-center gap-1 p-1.5 rounded-full bg-[#131621]/95 border border-white/15 shadow-2xl">
                  {["🔥", "👏", "⚡", "🏆"].map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => {
                        onApplause(em);
                        setCheerMenuOpen(false);
                      }}
                      className="w-9 h-9 rounded-full hover:bg-white/15 text-[17px] flex items-center justify-center cursor-pointer active:scale-90"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Instant Heart Burst */}
            <button
              type="button"
              onClick={() => onApplause("❤️")}
              aria-label="Send Heart"
              className="w-10 h-10 rounded-full bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/40 text-rose-400 flex items-center justify-center cursor-pointer active:scale-90 transition shrink-0"
            >
              <Heart className="w-4.5 h-4.5 fill-rose-500 text-rose-500" />
            </button>

            {/* Mute/Unmute Stream */}
            <button
              type="button"
              onClick={() => setStreamMuted((m) => !m)}
              aria-label={streamMuted ? "Unmute Stream" : "Mute Stream"}
              className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 flex items-center justify-center cursor-pointer shrink-0"
            >
              {streamMuted ? (
                <VolumeX className="w-4.5 h-4.5 text-rose-400" />
              ) : (
                <Volume2 className="w-4.5 h-4.5 text-emerald-400" />
              )}
            </button>

            {/* Share */}
            <button
              type="button"
              onClick={onShare}
              aria-label="Share Battle"
              className="hidden sm:flex w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 items-center justify-center cursor-pointer shrink-0"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* DESKTOP SIDE PANEL (Live Chat + Brief) */}
      <aside className="hidden lg:flex w-[360px] bg-[#0B0D13] border-l border-white/10 flex-col shrink-0 min-h-0">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[#0E1119] shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#C9A96E]" />
            <span className="text-[13px] font-bold">Live Arena Chat</span>
          </div>
          <button
            type="button"
            onClick={() => setJudgesDrawerOpen(true)}
            className="px-2.5 py-1 rounded-full bg-[#C9A96E]/15 hover:bg-[#C9A96E]/25 border border-[#C9A96E]/40 text-[#C9A96E] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Judges ({judgeCount})</span>
          </button>
        </div>

        <BattleChatPanel
          compactHeader
          messages={comments}
          currentUserId={currentUserId}
          isModerator={isAdmin || isAssignedJudge}
          mutedUntilMs={mutedUntilMs}
          wsConnected={wsConnected}
          onSendMessage={onSendMessage}
          onRetryMessage={onRetryMessage}
          onReactMessage={onReactMessage}
          onDeleteMessage={onDeleteMessage}
          onMuteUser={onMuteUser}
        />
      </aside>

      {/* EXPANDABLE FULL CHAT DRAWER (Replies, Reactions, Moderation) */}
      {fullChatOpen && (
        <div
          onClick={() => setFullChatOpen(false)}
          className="fixed inset-0 z-[92] bg-black/65 backdrop-blur-sm flex items-end justify-center lg:hidden"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full h-[64dvh] rounded-t-[26px] bg-[#0C0E14] border-t border-white/15 flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[#121520] shrink-0">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#C9A96E]" />
                <span className="text-[14px] font-bold">Live Arena Chat</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    wsConnected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                  }`}
                />
              </div>
              <button
                type="button"
                onClick={() => setFullChatOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <BattleChatPanel
              compactHeader
              messages={comments}
              currentUserId={currentUserId}
              isModerator={isAdmin || isAssignedJudge}
              mutedUntilMs={mutedUntilMs}
              wsConnected={wsConnected}
              onSendMessage={onSendMessage}
              onRetryMessage={onRetryMessage}
              onReactMessage={onReactMessage}
              onDeleteMessage={onDeleteMessage}
              onMuteUser={onMuteUser}
            />
          </div>
        </div>
      )}

      {/* PROMINENT TOP-BAR JUDGES DRAWER */}
      <BattleJudgesDrawer
        isOpen={judgesDrawerOpen}
        onClose={() => setJudgesDrawerOpen(false)}
        battle={battle}
        scores={scores}
        currentUserId={currentUserId}
        isCreator={battle.creatorId === currentUserId}
        isCompetitor={false}
        isAssignedJudge={isAssignedJudge}
        isAdmin={isAdmin}
        canScoreAsJudge={canScoreAsJudge}
        actionBusy={actionBusy}
        onSubmitScore={onSubmitJudgeScore}
        onAssignJudge={onAssignJudge}
        onFinalizeResult={onFinalizeResult}
        onOpenJudgeApplication={onOpenJudgeApplication}
        onViewProfile={onViewProfile}
      />

      {/* STREAM OPTIONS, QUALITY, MATCH INFO & REPORT SHEET */}
      {optionsSheetOpen && (
        <div
          onClick={() => setOptionsSheetOpen(false)}
          className="fixed inset-0 z-[94] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md max-h-[85dvh] rounded-t-[26px] sm:rounded-[26px] bg-[#10131C] border border-white/12 flex flex-col overflow-hidden text-white"
          >
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between bg-[#141824] shrink-0">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-[#C9A96E]" />
                <span className="text-[15px] font-bold">Battle Info & Stream Settings</span>
              </div>
              <button
                type="button"
                onClick={() => setOptionsSheetOpen(false)}
                className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4 text-[12px]">
              {/* Video Quality Selector */}
              <div className="p-3 rounded-xl bg-[#161A26] border border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase text-[#C9A96E] flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" /> Stream Quality
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    {sfuMode === "mediasoup_sfu" ? "mediasoup SFU" : "WebRTC TURN Relay"} · R
                    {roundState.index}/{roundState.total}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["auto", "1080p", "720p", "480p"] as StreamQualitySetting[]).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onChangeQuality(q)}
                      className={`min-h-[36px] rounded-lg text-[11px] font-bold uppercase flex items-center justify-center gap-1 cursor-pointer ${
                        quality === q
                          ? "bg-[#C9A96E] text-[#0D0D0F]"
                          : "bg-white/5 text-neutral-300 hover:bg-white/10"
                      }`}
                    >
                      <span>{q}</span>
                      {quality === q && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Player Utilities: PiP, Fullscreen, Share, Report */}
              <div className="grid grid-cols-2 gap-2">
                {canPip && (
                  <button
                    type="button"
                    onClick={() => {
                      setOptionsSheetOpen(false);
                      void handleEnterPip();
                    }}
                    className="min-h-[42px] rounded-xl bg-white/10 hover:bg-white/15 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <PictureInPicture2 className="w-4 h-4 text-[#C9A96E]" />
                    <span>Picture-in-Picture</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOptionsSheetOpen(false);
                    void handleToggleFullscreen();
                  }}
                  className="min-h-[42px] rounded-xl bg-white/10 hover:bg-white/15 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-4 h-4 text-[#C9A96E]" />
                  ) : (
                    <Maximize2 className="w-4 h-4 text-[#C9A96E]" />
                  )}
                  <span>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOptionsSheetOpen(false);
                    onShare();
                  }}
                  className="min-h-[42px] rounded-xl bg-white/10 hover:bg-white/15 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Share2 className="w-4 h-4 text-[#C9A96E]" />
                  <span>Share Battle</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOptionsSheetOpen(false);
                    onReport();
                  }}
                  className="min-h-[42px] rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Flag className="w-4 h-4" />
                  <span>Report Issue</span>
                </button>
              </div>

              {/* Challenge Brief */}
              <div className="p-3 rounded-xl bg-[#161A26] border border-white/10 space-y-1">
                <div className="text-[11px] font-bold uppercase text-[#C9A96E]">
                  Challenge Brief · {battle.customSkill}
                </div>
                <p className="text-neutral-200 leading-relaxed">{battle.description}</p>
              </div>

              {/* Competitor Deliverables */}
              {[battle.competitorA, battle.competitorB]
                .filter(Boolean)
                .map((comp) =>
                  comp && (comp.stageSummary || comp.submissionLink) ? (
                    <div
                      key={comp.uid}
                      className="p-3 rounded-xl bg-[#161A26] border border-white/10 space-y-1"
                    >
                      <div className="text-[11px] font-bold text-[#C9A96E]">
                        {comp.name}'s Live Work
                      </div>
                      {comp.stageSummary && <p className="text-neutral-200">{comp.stageSummary}</p>}
                      {comp.submissionLink && (
                        <a
                          href={comp.submissionLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sky-400 hover:underline font-medium"
                        >
                          <span>Open Submission Link</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ) : null
                )}

              {/* Rules */}
              {battle.rules.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase text-[#C9A96E]">Arena Rules</div>
                  {battle.rules.map((r, i) => (
                    <div key={i} className="p-2.5 rounded-lg bg-[#161A26] text-neutral-200">
                      {i + 1}. {r}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
