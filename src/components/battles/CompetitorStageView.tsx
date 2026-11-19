import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Mic,
  MicOff,
  Video,
  VideoOff,
  RefreshCw,
  MonitorUp,
  MonitorOff,
  MessageSquare,
  MoreHorizontal,
  Play,
  Trophy,
  Eye,
  Clock,
  Sparkles,
  Flag,
  Share2,
  Scale,
  BookOpen,
  PenTool,
  Maximize2,
  Minimize2,
  Pin,
  Wifi,
  WifiOff,
  X,
  Check,
  AlertTriangle,
  Swords,
} from "lucide-react";
import {
  Battle,
  BattleComment,
  BattleCommentReplyRef,
  BattleJudge,
  BattleNetworkQuality,
  BattleResult,
  BattleRoundState,
  BattleScore,
} from "../../types/battle";
import { DEFAULT_AVATAR } from "../../types";
import { SmartImage } from "../SmartImage";
import { LiveScreenShareStudio } from "../LiveScreenShareStudio";
import { BattleChatPanel } from "./BattleChatPanel";
import { JudgeScorecardPanel } from "./JudgeScorecardPanel";
import { BattleJudgesDrawer } from "./BattleJudgesDrawer";
import { LocalMediaErrorCode, SlotVideoMetrics } from "../../services/battles/battleMediaAdapter";
import { ApplauseBurstEvent, RoomPublishersState } from "../../services/battles/battleRealtimeClient";
import { getBattleScreenShareCapabilities } from "../../services/battles/battleScreenShare";

const BLACK_POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'%3E%3Crect width='100%25' height='100%25' fill='%23090A0F'/%3E%3C/svg%3E";

interface CompetitorStageViewProps {
  battle: Battle;
  currentUserId: string;
  mySlot: "A" | "B";
  isCreator: boolean;
  isOpponent: boolean;
  isAdmin: boolean;
  viewerCount: number;
  secondsRemaining: number;
  roundState: BattleRoundState;
  countdownSecs: number;
  wsConnected: boolean;
  networkQuality: BattleNetworkQuality;
  publishers: RoomPublishersState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  slotMetrics?: Record<"A" | "B", SlotVideoMetrics | null>;
  applauseBursts?: ApplauseBurstEvent[];
  localMediaError: LocalMediaErrorCode;
  localMediaErrorMsg: string | null;
  isStageActive: boolean;
  isMicOn: boolean;
  isCamOn: boolean;
  isScreenSharing: boolean;
  showStudio: boolean;
  comments: BattleComment[];
  mutedUntilMs: number;
  scores: BattleScore[];
  result: BattleResult | null;
  actionBusy: boolean;
  onLeave: () => void;
  onRetryMedia: (audioOnly?: boolean) => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onFlipCam: () => void;
  onStartDeviceScreenShare: () => void;
  onStopScreenShare: () => void;
  onToggleStudio: (open: boolean) => void;
  onStudioStreamReady: (stream: MediaStream) => void;
  onStartLiveWithCountdown: () => void;
  onMoveToJudging: () => void;
  onFinalizeResult: () => void;
  onOpenResult: () => void;
  onAssignJudge?: (judge: BattleJudge) => Promise<void>;
  onSyncDeliverable: (summary: string, link: string) => Promise<void>;
  onRespondInvite: (accept: boolean) => void;
  onSendMessage: (text: string, replyTo?: BattleCommentReplyRef) => void;
  onRetryMessage: (msg: BattleComment) => void;
  onReactMessage: (messageId: string, emoji: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onMuteUser: (targetUid: string) => void;
  onShare: () => void;
  onReport: () => void;
  onViewProfile: (uid: string) => void;
}

export const CompetitorStageView: React.FC<CompetitorStageViewProps> = ({
  battle,
  currentUserId,
  mySlot,
  isCreator,
  isOpponent,
  isAdmin,
  viewerCount,
  secondsRemaining,
  roundState,
  countdownSecs,
  wsConnected,
  networkQuality,
  publishers,
  localStream,
  remoteStream,
  slotMetrics,
  applauseBursts = [],
  localMediaError,
  localMediaErrorMsg,
  isStageActive,
  isMicOn,
  isCamOn,
  isScreenSharing,
  showStudio,
  comments,
  mutedUntilMs,
  scores,
  result,
  actionBusy,
  onLeave,
  onRetryMedia,
  onToggleMic,
  onToggleCam,
  onFlipCam,
  onStartDeviceScreenShare,
  onStopScreenShare,
  onToggleStudio,
  onStudioStreamReady,
  onStartLiveWithCountdown,
  onMoveToJudging,
  onFinalizeResult,
  onOpenResult,
  onAssignJudge,
  onSyncDeliverable,
  onRespondInvite,
  onSendMessage,
  onRetryMessage,
  onReactMessage,
  onDeleteMessage,
  onMuteUser,
  onShare,
  onReport,
  onViewProfile,
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const [pinnedSlot, setPinnedSlot] = useState<"A" | "B" | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [judgesDrawerOpen, setJudgesDrawerOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [desktopTab, setDesktopTab] = useState<"chat" | "judge" | "rules">("chat");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);

  // Deliverable inputs inside More sheet
  const myComp = mySlot === "A" ? battle.competitorA : battle.competitorB;
  const [stageSummaryInput, setStageSummaryInput] = useState(myComp?.stageSummary || "");
  const [submissionLinkInput, setSubmissionLinkInput] = useState(myComp?.submissionLink || "");
  const [savingWork, setSavingWork] = useState(false);

  const prevMsgLenRef = useRef(comments.length);
  useEffect(() => {
    if (comments.length > prevMsgLenRef.current && !mobileChatOpen) {
      setUnreadChatCount((c) => c + (comments.length - prevMsgLenRef.current));
    }
    prevMsgLenRef.current = comments.length;
  }, [comments.length, mobileChatOpen]);

  useEffect(() => {
    if (mobileChatOpen) setUnreadChatCount(0);
  }, [mobileChatOpen]);

  // Bind MediaStreams reliably whenever tracks update
  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (el.srcObject !== localStream) {
      el.srcObject = localStream;
    }
    if (localStream) {
      el.play?.().catch(() => {});
    }
  }, [localStream, pinnedSlot, mobileChatOpen, isCamOn, isScreenSharing, showStudio]);

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    if (el.srcObject !== remoteStream) {
      el.srcObject = remoteStream;
    }
    if (remoteStream) {
      el.play?.().catch(() => {});
    }
  }, [remoteStream, pinnedSlot, mobileChatOpen, showStudio, publishers.A?.camActive, publishers.B?.camActive]);

  // Auto-spotlight whoever turns on screen share
  useEffect(() => {
    if (isScreenSharing) {
      setPinnedSlot(mySlot);
    } else if (publishers[mySlot === "A" ? "B" : "A"]?.screenSharing) {
      setPinnedSlot(mySlot === "A" ? "B" : "A");
    }
  }, [isScreenSharing, publishers.A?.screenSharing, publishers.B?.screenSharing, mySlot]);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const screenCaps = getBattleScreenShareCapabilities();
  const partnerSlot: "A" | "B" = mySlot === "A" ? "B" : "A";
  const partnerComp = partnerSlot === "A" ? battle.competitorA : battle.competitorB;

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement && stageContainerRef.current) {
      stageContainerRef.current.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleSaveWork = async () => {
    setSavingWork(true);
    try {
      await onSyncDeliverable(stageSummaryInput, submissionLinkInput);
      setMoreSheetOpen(false);
    } finally {
      setSavingWork(false);
    }
  };

  const renderCompetitorTile = (slot: "A" | "B") => {
    const isSelf = slot === mySlot;
    const comp = slot === "A" ? battle.competitorA : battle.competitorB;
    const pub = publishers[slot];
    const metrics = slotMetrics?.[slot];
    const stream = isSelf ? localStream : remoteStream;
    const videoElRef = isSelf ? localVideoRef : remoteVideoRef;

    const hasVideoTrack = Boolean(
      stream && stream.getVideoTracks().some((t) => t.readyState === "live")
    );
    const camActive = isSelf ? isCamOn || isScreenSharing : pub ? pub.camActive || pub.screenSharing : false;
    const micActive = isSelf ? isMicOn : pub ? pub.micActive : comp?.micActive !== false;
    const sharingNow = isSelf ? isScreenSharing : Boolean(pub?.screenSharing || comp?.screenSharing);
    const isPinned = pinnedSlot === slot;
    const showVideo = Boolean(stream && (hasVideoTrack || sharingNow) && camActive);

    return (
      <div
        key={slot}
        className={`relative rounded-2xl bg-[#0D0F16] border overflow-hidden flex items-center justify-center transition-all ${
          isPinned
            ? "border-[#C9A96E] shadow-xl shadow-[#C9A96E]/10"
            : "border-white/10"
        } ${
          pinnedSlot
            ? isPinned
              ? "flex-1 min-h-0"
              : "h-28 sm:h-36 shrink-0"
            : "flex-1 min-h-0"
        }`}
      >
        {/* Single Persistent Video / Audio Element (Never unmounts on cam toggle) */}
        <video
          ref={videoElRef}
          autoPlay
          playsInline
          muted={isSelf}
          poster={BLACK_POSTER}
          className={
            showVideo
              ? `w-full h-full bg-[#090A0F] ${
                  sharingNow ? "object-contain" : "object-cover"
                } ${isSelf && !sharingNow ? "scale-x-[-1]" : ""}`
              : "absolute w-px h-px opacity-0 pointer-events-none"
          }
        />

        {!showVideo && (
          !comp ? (
            <div className="flex flex-col items-center justify-center text-center p-4">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-2">
                <Swords className="w-6 h-6 text-[#C9A96E]" />
              </div>
              <p className="text-[13px] font-bold text-white">Open Challenger Slot</p>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                Waiting for opponent to join battle
              </p>
            </div>
          ) : isSelf && localMediaError !== "none" && localMediaError !== "camera-denied-audio-only" && !isStageActive ? (
            /* Honest Camera/Mic Permission Recovery UI */
            <div className="flex flex-col items-center justify-center text-center p-4 max-w-xs space-y-2.5">
              <div className="w-11 h-11 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-white">Camera / Mic Access Needed</p>
                <p className="text-[11px] text-neutral-300 mt-0.5 leading-snug">
                  {localMediaErrorMsg || "Grant camera and microphone access to go live on stage."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRetryMedia(false)}
                  className="min-h-[38px] px-3.5 rounded-xl bg-[#C9A96E] text-[#0D0D0F] text-[12px] font-bold cursor-pointer"
                >
                  Enable Camera
                </button>
                <button
                  type="button"
                  onClick={() => onRetryMedia(true)}
                  className="min-h-[38px] px-3 rounded-xl bg-white/10 text-white text-[12px] font-semibold cursor-pointer"
                >
                  Audio Only
                </button>
              </div>
            </div>
          ) : (
            /* Honest Camera Off / Awaiting Remote Stream State (Never pretends static photo is live video) */
            <div className="flex flex-col items-center justify-center text-center p-4">
              <SmartImage
                src={comp.photoUrl || DEFAULT_AVATAR}
                alt={comp.name}
                fallbackType="profile"
                fullName={comp.name}
                className="w-16 h-16 rounded-full object-cover border-2 border-white/20 mb-2"
              />
              <p className="text-[13px] font-bold text-white">{comp.name}</p>
              <span className="mt-1 text-[11px] text-neutral-400 font-medium">
                {isSelf
                  ? !isCamOn
                    ? "Camera Off · Mic Active"
                    : "Initializing camera..."
                  : pub?.publishing
                  ? "Camera Off · Connected"
                  : "Waiting for competitor video..."}
              </span>
            </div>
          )
        )}

        {/* Top Left Overlay: Slot, Resolution & Share Status */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
          <span className="px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm border border-white/10 text-[10px] font-extrabold uppercase tracking-wider text-[#C9A96E]">
            {slot === "A" ? "Corner A" : "Corner B"}
          </span>
          {metrics && metrics.height >= 720 && (
            <span className="px-1.5 py-0.5 rounded-md bg-black/70 border border-white/10 text-[9px] font-extrabold text-emerald-300 tabular-nums">
              {metrics.height >= 1080 ? "1080p" : "720p"}
            </span>
          )}
          {sharingNow && (
            <span className="px-2 py-0.5 rounded-md bg-sky-500/90 text-white text-[10px] font-bold uppercase">
              Screen Live
            </span>
          )}
        </div>

        {/* Top Right Overlay: Pin & Mic/Cam Indicators */}
        {comp && (
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10">
            <button
              type="button"
              onClick={() => setPinnedSlot((prev) => (prev === slot ? null : slot))}
              aria-label={isPinned ? "Unpin Spotlight" : "Spotlight Stream"}
              className={`w-8 h-8 rounded-lg backdrop-blur-sm flex items-center justify-center cursor-pointer transition ${
                isPinned
                  ? "bg-[#C9A96E] text-[#0D0D0F]"
                  : "bg-black/60 text-white hover:bg-black/80"
              }`}
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
            <span
              className={`w-8 h-8 rounded-lg backdrop-blur-sm flex items-center justify-center ${
                micActive ? "bg-black/60 text-emerald-400" : "bg-rose-600/90 text-white"
              }`}
            >
              {micActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            </span>
          </div>
        )}

        {/* Bottom Scrim: Name + Live Stats */}
        {comp && (
          <div className="absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex items-center justify-between gap-2 z-10">
            <button
              type="button"
              onClick={() => onViewProfile(comp.uid)}
              className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
            >
              <span className="text-[13px] font-bold text-white truncate">
                {comp.name} {isSelf ? "(You)" : ""}
              </span>
            </button>
            <span className="text-[11px] font-semibold text-neutral-300 tabular-nums shrink-0">
              {slot === "A" ? battle.audienceVotesA || 0 : battle.audienceVotesB || 0} votes
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={stageContainerRef}
      className="fixed inset-0 z-[80] h-[100dvh] w-full bg-[#08090D] text-white flex flex-col overflow-hidden"
    >
      {/* Sleek Minimal Top Broadcast HUD */}
      <header className="px-3 sm:px-5 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 bg-[#0D0F16]/95 backdrop-blur-md border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onLeave}
            aria-label="Leave Stage"
            className="w-11 h-11 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {battle.status === "live" && isStageActive ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  LIVE
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-[#C9A96E]/20 text-[#C9A96E] text-[10px] font-bold uppercase">
                  {battle.status === "live" ? "Connecting" : battle.status.replace("_", " ")}
                </span>
              )}

              {/* Prominent Top Judges Pill right beside LIVE */}
              <button
                type="button"
                onClick={() => setJudgesDrawerOpen(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#C9A96E]/15 hover:bg-[#C9A96E]/25 border border-[#C9A96E]/50 text-[#C9A96E] text-[10px] font-extrabold cursor-pointer"
              >
                <Scale className="w-3 h-3" />
                <span>Judges ({battle.judges?.length || 0})</span>
              </button>

              <span className="hidden sm:inline text-[11px] text-neutral-400 font-medium truncate">
                R{roundState.index}/{roundState.total} · {battle.customSkill}
              </span>
            </div>
            <h1 className="text-[13px] sm:text-[15px] font-bold truncate leading-tight">
              {battle.title}
            </h1>
          </div>
        </div>

        {/* Right Broadcast HUD: Timer, Signal, Viewers */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={`px-2.5 py-1.5 rounded-xl border flex items-center gap-1.5 tabular-nums ${
              secondsRemaining > 0 && secondsRemaining <= 60 && battle.status === "live"
                ? "bg-rose-500/15 border-rose-500/40 text-rose-200"
                : "bg-black/50 border-[#C9A96E]/40 text-white"
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-[#C9A96E]" />
            <span className="text-[13px] font-black">{formatTimer(secondsRemaining)}</span>
          </div>

          <div className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-white/5 text-[11px] font-semibold tabular-nums text-neutral-200">
            <Eye className="w-3.5 h-3.5 text-[#C9A96E]" />
            <span>{viewerCount}</span>
          </div>

          <div
            title={`Network: ${networkQuality}`}
            className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center"
          >
            {wsConnected ? (
              <Wifi
                className={`w-4 h-4 ${
                  networkQuality === "excellent"
                    ? "text-emerald-400"
                    : networkQuality === "poor"
                    ? "text-rose-400"
                    : "text-[#C9A96E]"
                }`}
              />
            ) : (
              <WifiOff className="w-4 h-4 text-amber-400 animate-pulse" />
            )}
          </div>

          <button
            type="button"
            onClick={handleToggleFullscreen}
            aria-label="Fullscreen Stage"
            className="hidden sm:flex w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 items-center justify-center cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Pending Direct Invite Banner */}
      {battle.status === "pending_invite" && isOpponent && (
        <div className="mx-3 mt-2 p-3 rounded-2xl bg-[#C9A96E]/15 border border-[#C9A96E] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="text-[12px]">
            <strong className="text-[#C9A96E]">{battle.creatorName}</strong> invited you to this
            battle ({battle.durationMinutes}m).
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => onRespondInvite(true)}
              className="min-h-[38px] px-3.5 rounded-xl bg-[#C9A96E] text-[#0D0D0F] text-[12px] font-bold cursor-pointer"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => onRespondInvite(false)}
              className="min-h-[38px] px-3.5 rounded-xl bg-white/10 text-white text-[12px] font-semibold cursor-pointer"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* Stage Workspace */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Video Stage Area */}
        <div className="flex-1 min-h-0 flex flex-col p-2.5 sm:p-3.5 gap-2.5 relative">
          {/* Interactive Whiteboard / Code Studio Overlay */}
          {showStudio && (
            <div className="relative flex-1 min-h-0 rounded-2xl overflow-hidden border border-[#C9A96E]/50">
              <LiveScreenShareStudio
                onStreamReady={onStudioStreamReady}
                onStopSharing={() => {
                  onStopScreenShare();
                  onToggleStudio(false);
                }}
                partnerName={partnerComp?.name || "Arena"}
                skillName={battle.customSkill}
              />
            </div>
          )}

          {/* Dual Live Video Grid */}
          {!showStudio && (
            <div
              className={`flex-1 min-h-0 flex flex-col ${
                pinnedSlot ? "" : "sm:grid sm:grid-cols-2"
              } gap-2.5`}
            >
              {pinnedSlot
                ? (
                    <>
                      {renderCompetitorTile(pinnedSlot)}
                      {renderCompetitorTile(pinnedSlot === "A" ? "B" : "A")}
                    </>
                  )
                : (
                    <>
                      {renderCompetitorTile("A")}
                      {renderCompetitorTile("B")}
                    </>
                  )}
            </div>
          )}

          {/* Floating Audience Cheers & Live Chat Ticker (Mobile Stage Preview) */}
          {applauseBursts.length > 0 && (
            <div className="pointer-events-none absolute right-4 bottom-20 z-20 flex flex-col items-end gap-1">
              {applauseBursts.slice(-3).map((b, idx) => (
                <span
                  key={`${b.uid}_${b.atMs}_${idx}`}
                  className="px-2.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-[13px] animate-bounce"
                >
                  {b.emoji}
                </span>
              ))}
            </div>
          )}

          {!mobileChatOpen && !showStudio && comments.filter((c) => !c.deleted).length > 0 && (
            <button
              type="button"
              onClick={() => setMobileChatOpen(true)}
              className="lg:hidden absolute left-4 bottom-16 z-20 max-w-[78%] text-left space-y-1 cursor-pointer"
            >
              {comments
                .filter((c) => !c.deleted)
                .slice(-2)
                .map((m) => (
                  <div
                    key={m.id}
                    className="px-2.5 py-1 rounded-xl bg-black/55 backdrop-blur-md border border-white/10 text-[11px] text-white truncate"
                  >
                    <strong className="text-[#C9A96E] mr-1">{m.authorName}:</strong>
                    <span>{m.text}</span>
                  </div>
                ))}
            </button>
          )}

          {/* Synchronized 3-2-1 Countdown Overlay */}
          {countdownSecs > 0 && (
            <div className="absolute inset-0 z-30 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
              <div className="text-[12px] font-bold uppercase tracking-[0.25em] text-[#C9A96E] mb-2">
                Battle Starting
              </div>
              <div className="w-24 h-24 rounded-full bg-[#C9A96E] text-[#0D0D0F] flex items-center justify-center text-[44px] font-black shadow-2xl animate-bounce">
                {countdownSecs}
              </div>
            </div>
          )}

          {/* Quick Match Status CTA Bar (Only shown when battle can transition cleanly) */}
          {battle.status === "upcoming" && battle.opponentId && (
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#131621] border border-[#C9A96E]/40">
              <span className="text-[12px] text-neutral-200 truncate">
                Both competitors ready? Launch live broadcast!
              </span>
              <button
                type="button"
                disabled={actionBusy}
                onClick={onStartLiveWithCountdown}
                className="min-h-[38px] px-4 rounded-xl bg-[#C9A96E] text-[#0D0D0F] text-[12px] font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Go LIVE</span>
              </button>
            </div>
          )}

          {battle.status === "judging" && (
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <span className="text-[12px] text-emerald-200 truncate">
                Round complete · Finalize official scores & XP
              </span>
              <button
                type="button"
                disabled={actionBusy}
                onClick={onFinalizeResult}
                className="min-h-[38px] px-4 rounded-xl bg-emerald-500 text-[#0D0D0F] text-[12px] font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Trophy className="w-3.5 h-3.5" />
                <span>Finalize Result</span>
              </button>
            </div>
          )}

          {/* Mobile Slide-up Live Chat Drawer (keeps top video visible!) */}
          {mobileChatOpen && (
            <div className="lg:hidden h-[46dvh] min-h-[240px] rounded-2xl border border-white/15 overflow-hidden flex flex-col shrink-0 shadow-2xl">
              <div className="px-3 py-2 bg-[#131621] border-b border-white/10 flex items-center justify-between">
                <span className="text-[12px] font-bold text-[#C9A96E]">Live Arena Chat</span>
                <button
                  type="button"
                  onClick={() => setMobileChatOpen(false)}
                  className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <BattleChatPanel
                compactHeader
                messages={comments}
                currentUserId={currentUserId}
                isModerator={isCreator || isOpponent || isAdmin}
                mutedUntilMs={mutedUntilMs}
                wsConnected={wsConnected}
                onSendMessage={onSendMessage}
                onRetryMessage={onRetryMessage}
                onReactMessage={onReactMessage}
                onDeleteMessage={onDeleteMessage}
                onMuteUser={onMuteUser}
              />
            </div>
          )}
        </div>

        {/* Desktop Right Sidebar */}
        <aside className="hidden lg:flex w-[360px] bg-[#0C0E14] border-l border-white/10 flex-col shrink-0 min-h-0">
          <div className="p-2 grid grid-cols-3 gap-1.5 border-b border-white/10 shrink-0">
            {[
              { id: "chat" as const, label: "Live Chat", icon: MessageSquare },
              { id: "judge" as const, label: `Judges (${scores.length})`, icon: Scale },
              { id: "rules" as const, label: "Brief", icon: BookOpen },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDesktopTab(t.id)}
                  className={`min-h-[38px] rounded-xl text-[12px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                    desktopTab === t.id
                      ? "bg-[#C9A96E] text-[#0D0D0F]"
                      : "bg-white/5 text-neutral-300 hover:bg-white/10"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {desktopTab === "chat" && (
            <BattleChatPanel
              compactHeader
              messages={comments}
              currentUserId={currentUserId}
              isModerator={isCreator || isOpponent || isAdmin}
              mutedUntilMs={mutedUntilMs}
              wsConnected={wsConnected}
              onSendMessage={onSendMessage}
              onRetryMessage={onRetryMessage}
              onReactMessage={onReactMessage}
              onDeleteMessage={onDeleteMessage}
              onMuteUser={onMuteUser}
            />
          )}

          {desktopTab === "judge" && (
            <JudgeScorecardPanel
              battle={battle}
              scores={scores}
              currentUserId={currentUserId}
              canScoreAsJudge={false}
              onSubmitScore={async () => {}}
            />
          )}

          {desktopTab === "rules" && (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-[12px]">
              <p className="text-neutral-300 leading-relaxed">{battle.description}</p>
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-[#C9A96E] uppercase">Rules</div>
                {battle.rules.map((r, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-white/5 text-neutral-200">
                    {i + 1}. {r}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Compact Single-Row Bottom Stage Control Dock */}
      <footer className="px-3 pt-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] bg-[#0D0F16]/95 backdrop-blur-md border-t border-white/10 shrink-0">
        <div className="max-w-xl mx-auto flex items-center justify-around gap-1.5">
          <button
            type="button"
            onClick={onToggleMic}
            className="flex flex-col items-center gap-0.5 cursor-pointer group"
          >
            <span
              className={`w-11 h-11 rounded-2xl flex items-center justify-center transition ${
                isMicOn
                  ? "bg-white/10 text-white group-hover:bg-white/15"
                  : "bg-rose-600 text-white"
              }`}
            >
              {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </span>
            <span className="text-[10px] font-medium text-neutral-400">
              {isMicOn ? "Mute" : "Unmute"}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleCam}
            className="flex flex-col items-center gap-0.5 cursor-pointer group"
          >
            <span
              className={`w-11 h-11 rounded-2xl flex items-center justify-center transition ${
                isCamOn
                  ? "bg-white/10 text-white group-hover:bg-white/15"
                  : "bg-rose-600 text-white"
              }`}
            >
              {isCamOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </span>
            <span className="text-[10px] font-medium text-neutral-400">Cam</span>
          </button>

          <button
            type="button"
            onClick={onFlipCam}
            className="flex flex-col items-center gap-0.5 cursor-pointer group"
          >
            <span className="w-11 h-11 rounded-2xl bg-white/10 group-hover:bg-white/15 text-white flex items-center justify-center transition">
              <RefreshCw className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-medium text-neutral-400">Flip</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (isScreenSharing || showStudio) {
                onStopScreenShare();
                onToggleStudio(false);
              } else {
                setSharePickerOpen(true);
              }
            }}
            className="flex flex-col items-center gap-0.5 cursor-pointer group"
          >
            <span
              className={`w-11 h-11 rounded-2xl flex items-center justify-center transition ${
                isScreenSharing || showStudio
                  ? "bg-sky-500 text-white"
                  : "bg-white/10 text-white group-hover:bg-white/15"
              }`}
            >
              {isScreenSharing || showStudio ? (
                <MonitorOff className="w-5 h-5" />
              ) : (
                <MonitorUp className="w-5 h-5" />
              )}
            </span>
            <span className="text-[10px] font-medium text-neutral-400">
              {isScreenSharing || showStudio ? "Stop" : "Share"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMobileChatOpen((v) => !v)}
            className="lg:hidden flex flex-col items-center gap-0.5 cursor-pointer relative"
          >
            <span
              className={`w-11 h-11 rounded-2xl flex items-center justify-center transition ${
                mobileChatOpen ? "bg-[#C9A96E] text-[#0D0D0F]" : "bg-white/10 text-white"
              }`}
            >
              <MessageSquare className="w-5 h-5" />
            </span>
            {unreadChatCount > 0 && !mobileChatOpen && (
              <span className="absolute -top-1 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadChatCount > 9 ? "9+" : unreadChatCount}
              </span>
            )}
            <span className="text-[10px] font-medium text-neutral-400">Chat</span>
          </button>

          <button
            type="button"
            onClick={() => setMoreSheetOpen(true)}
            className="flex flex-col items-center gap-0.5 cursor-pointer"
          >
            <span className="w-11 h-11 rounded-2xl bg-white/10 hover:bg-white/15 text-white flex items-center justify-center transition">
              <MoreHorizontal className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-medium text-neutral-400">More</span>
          </button>
        </div>
      </footer>

      {/* Share Mode Picker Sheet (Supports Native Android MediaProjection, Browser DisplayMedia, and Studio Whiteboard) */}
      {sharePickerOpen && (
        <div
          onClick={() => setSharePickerOpen(false)}
          className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-t-[24px] sm:rounded-[24px] bg-[#131621] border border-white/10 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-bold">Share on Live Stage</h3>
              <button
                type="button"
                onClick={() => setSharePickerOpen(false)}
                className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {screenCaps.supportsDeviceCapture ? (
              <button
                type="button"
                onClick={() => {
                  setSharePickerOpen(false);
                  onStartDeviceScreenShare();
                }}
                className="w-full p-3.5 rounded-2xl bg-[#0D0F16] hover:bg-white/5 border border-white/15 flex items-center gap-3 text-left cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                  <MonitorUp className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[14px] font-bold text-white">
                    {screenCaps.isAndroidNative
                      ? "Share Full Android Screen"
                      : "Share Screen / Window"}
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    Broadcasts live HD screen feed to opponent and audience
                  </div>
                </div>
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[12px] text-amber-200">
                iOS/Mobile browsers restrict OS-level screen broadcast. Use the Interactive Studio
                below to present code, whiteboard drawings, notes, or slides live!
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setSharePickerOpen(false);
                onToggleStudio(true);
              }}
              className="w-full p-3.5 rounded-2xl bg-[#0D0F16] hover:bg-white/5 border border-[#C9A96E]/40 flex items-center gap-3 text-left cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-[#C9A96E]/20 text-[#C9A96E] flex items-center justify-center shrink-0">
                <PenTool className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[14px] font-bold text-white">
                  Interactive Whiteboard & Code Studio
                </div>
                <div className="text-[11px] text-neutral-400">
                  Draw diagrams, present syntax-highlighted code, or share slides at 30fps
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Stage "More" Bottom Sheet */}
      {moreSheetOpen && (
        <div
          onClick={() => setMoreSheetOpen(false)}
          className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg max-h-[85dvh] rounded-t-[24px] sm:rounded-[24px] bg-[#131621] border border-white/10 flex flex-col overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-[15px] font-bold">Stage Tools & Battle Actions</h3>
              <button
                type="button"
                onClick={() => setMoreSheetOpen(false)}
                className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4">
              {/* Match Progression Actions */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                  Match Controls
                </div>
                <div className="flex flex-wrap gap-2">
                  {battle.status === "upcoming" && battle.opponentId && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => {
                        setMoreSheetOpen(false);
                        onStartLiveWithCountdown();
                      }}
                      className="min-h-[42px] px-4 rounded-xl bg-[#C9A96E] text-[#0D0D0F] text-[12px] font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-4 h-4" />
                      <span>Go LIVE Now</span>
                    </button>
                  )}

                  {battle.status === "live" && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => {
                        setMoreSheetOpen(false);
                        onMoveToJudging();
                      }}
                      className="min-h-[42px] px-4 rounded-xl bg-amber-500 text-[#0D0D0F] text-[12px] font-bold cursor-pointer"
                    >
                      End Round & Move to Judging
                    </button>
                  )}

                  {(battle.status === "judging" ||
                    (battle.status === "live" && battle.judgingMethod === "automatic")) && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => {
                        setMoreSheetOpen(false);
                        onFinalizeResult();
                      }}
                      className="min-h-[42px] px-4 rounded-xl bg-emerald-500 text-[#0D0D0F] text-[12px] font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trophy className="w-4 h-4" />
                      <span>Finalize & Award XP</span>
                    </button>
                  )}

                  {result && (
                    <button
                      type="button"
                      onClick={() => {
                        setMoreSheetOpen(false);
                        onOpenResult();
                      }}
                      className="min-h-[42px] px-4 rounded-xl bg-[#C9A96E] text-[#0D0D0F] text-[12px] font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trophy className="w-4 h-4" />
                      <span>View Official Result</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Deliverable / Stage Work Sync */}
              <div className="p-3.5 rounded-2xl bg-[#0D0F16] border border-white/10 space-y-2.5">
                <div className="text-[12px] font-bold text-[#C9A96E] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Live Stage Submission & Notes</span>
                </div>
                <input
                  type="text"
                  value={stageSummaryInput}
                  onChange={(e) => setStageSummaryInput(e.target.value)}
                  placeholder="Describe your live work or progress..."
                  className="w-full min-h-[42px] px-3 rounded-xl bg-black/50 border border-white/10 text-[13px] text-white"
                />
                <input
                  type="url"
                  value={submissionLinkInput}
                  onChange={(e) => setSubmissionLinkInput(e.target.value)}
                  placeholder="Demo / GitHub / Figma URL (optional)"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-black/50 border border-white/10 text-[13px] text-white"
                />
                <button
                  type="button"
                  disabled={savingWork}
                  onClick={handleSaveWork}
                  className="min-h-[40px] px-4 rounded-xl bg-white/10 hover:bg-white/20 text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{savingWork ? "Syncing..." : "Publish to Audience & Judges"}</span>
                </button>
              </div>

              {/* Quick Actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMoreSheetOpen(false);
                    onShare();
                  }}
                  className="flex-1 min-h-[42px] rounded-xl bg-white/10 text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Share2 className="w-4 h-4 text-[#C9A96E]" />
                  <span>Share Battle</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreSheetOpen(false);
                    onReport();
                  }}
                  className="flex-1 min-h-[42px] rounded-xl bg-rose-500/15 text-rose-300 text-[12px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Flag className="w-4 h-4" />
                  <span>Report Issue</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top-Bar Judges Drawer */}
      <BattleJudgesDrawer
        isOpen={judgesDrawerOpen}
        onClose={() => setJudgesDrawerOpen(false)}
        battle={battle}
        scores={scores}
        currentUserId={currentUserId}
        isCreator={isCreator}
        isCompetitor
        isAssignedJudge={false}
        isAdmin={isAdmin}
        canScoreAsJudge={false}
        actionBusy={actionBusy}
        onAssignJudge={onAssignJudge}
        onFinalizeResult={onFinalizeResult}
        onViewProfile={onViewProfile}
      />
    </div>
  );
};
