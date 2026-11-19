import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  doc,
  getDoc,
  increment,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase";
import {
  Battle,
  BattleComment,
  BattleCommentReplyRef,
  BattleNetworkQuality,
  BattleReport,
  BattleResult,
  BattleRoundState,
  BattleScore,
  BattleVote,
} from "../../types/battle";
import {
  BattleUserActor,
  castBattleVote,
  finalizeBattleResult,
  getUserBattleVote,
  joinOpenBattle,
  moveBattleToJudging,
  respondToBattleInvite,
  sendBattleApplause,
  startBattleLive,
  submitBattleReport,
  submitJudgeScore,
  subscribeToBattleArena,
  updateCompetitorArenaState,
} from "../../services/battleService";
import { isVerificationAdminEmail } from "../../utils/verificationAdmin";
import { useBackHandler } from "../../utils/navigationManager";
import { BattleResultModal } from "./BattleResultModal";
import { CompetitorStageView } from "./CompetitorStageView";
import { AudienceViewerView } from "./AudienceViewerView";
import {
  ApplauseBurstEvent,
  BattleRealtimeClient,
  RoomPublishersState,
  RoomRole,
} from "../../services/battles/battleRealtimeClient";
import {
  BattleMediaController,
  createBattleMediaController,
  LocalMediaErrorCode,
  StreamQualitySetting,
  ViewerStreamStatus,
} from "../../services/battles/battleMediaAdapter";
import {
  ActiveScreenShareSession,
  ScreenCaptureUnavailableError,
  startBattleDeviceScreenShare,
} from "../../services/battles/battleScreenShare";

interface LiveBattleArenaProps {
  battleId: string;
  initialBattle?: Battle;
  currentUser: BattleUserActor;
  onClose: () => void;
  onViewProfile: (uid: string) => void;
  onOpenLeaderboard?: () => void;
}

const REPORT_REASONS: Array<{ id: BattleReport["reason"]; label: string }> = [
  { id: "misconduct", label: "Unsportsmanlike Conduct" },
  { id: "cheating", label: "Cheating / Pre-recorded Content" },
  { id: "scoring_dispute", label: "Scoring / Judging Dispute" },
  { id: "inappropriate_content", label: "Inappropriate Content" },
  { id: "spam", label: "Spam or Abuse" },
];

export const LiveBattleArena: React.FC<LiveBattleArenaProps> = ({
  battleId,
  initialBattle,
  currentUser,
  onClose,
  onViewProfile,
  onOpenLeaderboard,
}) => {
  const [battle, setBattle] = useState<Battle | null>(initialBattle || null);
  const [firestoreComments, setFirestoreComments] = useState<BattleComment[]>([]);
  const [wsComments, setWsComments] = useState<BattleComment[]>([]);
  const [scores, setScores] = useState<BattleScore[]>([]);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [myVote, setMyVote] = useState<BattleVote | null>(null);

  // Realtime WebSocket room state
  const wsClientRef = useRef<BattleRealtimeClient | null>(null);
  const mediaCtrlRef = useRef<BattleMediaController | null>(null);
  const activeScreenShareRef = useRef<ActiveScreenShareSession | null>(null);

  const [wsConnected, setWsConnected] = useState(false);
  const [viewerCount, setViewerCount] = useState<number>(initialBattle?.viewerCount || 1);
  const [publishers, setPublishers] = useState<RoomPublishersState>({ A: null, B: null });
  const [roundState, setRoundState] = useState<BattleRoundState>({
    index: 1,
    total: 1,
    title: "Main Arena Round",
  });
  const [countdownSecs, setCountdownSecs] = useState<number>(0);
  const [mutedUntilMs, setMutedUntilMs] = useState<number>(0);
  const [applauseBursts, setApplauseBursts] = useState<ApplauseBurstEvent[]>([]);

  // Media Streams & Status
  const [sfuMode, setSfuMode] = useState<"livekit_sfu" | "ws_webrtc_relay">("ws_webrtc_relay");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [slotStreams, setSlotStreams] = useState<Record<"A" | "B", MediaStream | null>>({
    A: null,
    B: null,
  });
  const [slotStatuses, setSlotStatuses] = useState<Record<"A" | "B", ViewerStreamStatus>>({
    A: "offline",
    B: "offline",
  });
  const [localMediaError, setLocalMediaError] = useState<LocalMediaErrorCode>("none");
  const [localMediaErrorMsg, setLocalMediaErrorMsg] = useState<string | null>(null);
  const [isStageActive, setIsStageActive] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<BattleNetworkQuality>("unknown");
  const [viewerQuality, setViewerQuality] = useState<StreamQualitySetting>("auto");

  // Synced Battle Timer
  const [secondsRemaining, setSecondsRemaining] = useState<number>(
    (initialBattle?.durationMinutes || 15) * 60
  );

  // Modals & Misc UI
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<BattleReport["reason"]>("misconduct");
  const [reportDetails, setReportDetails] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [followedUids, setFollowedUids] = useState<Record<string, boolean>>({});
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const showToast = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useBackHandler(true, () => {
    if (showReportModal) {
      setShowReportModal(false);
      return;
    }
    if (showResultModal) {
      setShowResultModal(false);
      return;
    }
    onClose();
  });

  // Subscribe to battle document, scores, and result in Firestore
  useEffect(() => {
    const unsub = subscribeToBattleArena(battleId, {
      onBattle: (b) => {
        if (b) setBattle(b);
      },
      onComments: setFirestoreComments,
      onScores: setScores,
      onResult: (res) => {
        setResult(res);
        if (res) setShowResultModal(true);
      },
    });

    getUserBattleVote(battleId, currentUser.uid)
      .then(setMyVote)
      .catch(() => {});

    return () => {
      unsub();
    };
  }, [battleId, currentUser.uid]);

  // Derived Role
  const isCreator = battle?.creatorId === currentUser.uid;
  const isOpponent = battle?.opponentId === currentUser.uid;
  const isCompetitor = Boolean(isCreator || isOpponent);
  const mySlot: "A" | "B" | undefined = isCreator ? "A" : isOpponent ? "B" : undefined;
  const isAdmin = isVerificationAdminEmail(currentUser.email);
  const isAssignedJudge = Boolean(battle?.judgeIds?.includes(currentUser.uid));
  const canScoreAsJudge = (isAssignedJudge || isAdmin) && !isCompetitor;

  const resolvedRoomRole: RoomRole = isCreator
    ? "competitorA"
    : isOpponent
    ? "competitorB"
    : isAssignedJudge
    ? "judge"
    : isAdmin
    ? "admin"
    : "spectator";

  // Synchronized Match Countdown Clock
  useEffect(() => {
    if (!battle) return;
    const totalSecs = (battle.durationMinutes || 15) * 60;
    const tick = () => {
      if (battle.status === "live" && battle.startedAtMs) {
        const elapsed = Math.floor((Date.now() - battle.startedAtMs) / 1000);
        setSecondsRemaining(Math.max(0, totalSecs - elapsed));
      } else if (battle.status === "completed" || battle.status === "judging") {
        setSecondsRemaining(0);
      } else {
        setSecondsRemaining(totalSecs);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [battle?.status, battle?.startedAtMs, battle?.durationMinutes]);

  // Synchronized 3-2-1 Go-Live Countdown Effect
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggerVisualCountdown = useCallback((targetMs: number) => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    const update = () => {
      const rem = Math.ceil((targetMs - Date.now()) / 1000);
      if (rem <= 0) {
        setCountdownSecs(0);
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
      } else {
        setCountdownSecs(rem);
      }
    };
    update();
    countdownTimerRef.current = setInterval(update, 250);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  // Merge WS live messages cleanly with initial Firestore comment history (deduplicated)
  const mergedComments = useMemo(() => {
    const map = new Map<string, BattleComment>();
    for (const c of firestoreComments) {
      map.set(c.id, c);
    }
    for (const c of wsComments) {
      if (c.clientMsgId && map.has(c.clientMsgId)) {
        map.delete(c.clientMsgId);
      }
      map.set(c.id, c);
    }
    return Array.from(map.values()).sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
  }, [firestoreComments, wsComments]);

  // Connect WebSocket Room & Pluggable Media Session (LiveKit SFU or WebRTC Relay)
  useEffect(() => {
    if (!battle) return;
    let disposed = false;

    const wsClient = new BattleRealtimeClient(
      {
        battleId: battle.id,
        displayName: currentUser.fullName || "SwapSkill Member",
        photoUrl: currentUser.photoUrl,
        roleHint: resolvedRoomRole,
        slot: mySlot,
      },
      {
        onConnectionState: (st) => {
          if (!disposed) setWsConnected(st === "connected");
        },
        onSnapshot: (snap) => {
          if (disposed) return;
          setViewerCount(snap.viewerCount);
          setPublishers(snap.publishers);
          if (snap.roundState) setRoundState(snap.roundState);
          setMutedUntilMs(snap.mutedUntilMs || 0);
          if (snap.chatHistory?.length) {
            setWsComments(snap.chatHistory);
          }
          mediaCtrlRef.current?.handlePublishersSnapshot(snap.publishers);
        },
        onViewerCount: (cnt) => {
          if (!disposed) setViewerCount(cnt);
        },
        onPublishersUpdate: (pubs) => {
          if (disposed) return;
          setPublishers(pubs);
          mediaCtrlRef.current?.handlePublishersSnapshot(pubs);
        },
        onChatMessage: (msg) => {
          if (disposed) return;
          setWsComments((prev) => {
            const filtered = prev.filter(
              (m) => m.id !== msg.id && (!msg.clientMsgId || m.clientMsgId !== msg.clientMsgId)
            );
            return [...filtered, { ...msg, deliveryStatus: "sent" }];
          });
        },
        onChatAck: (clientMsgId, msg) => {
          if (disposed) return;
          setWsComments((prev) => {
            const filtered = prev.filter(
              (m) => m.id !== clientMsgId && m.id !== msg.id && m.clientMsgId !== clientMsgId
            );
            return [...filtered, { ...msg, deliveryStatus: "sent" }];
          });
        },
        onChatError: (clientMsgId, error) => {
          if (disposed) return;
          if (clientMsgId) {
            setWsComments((prev) =>
              prev.map((m) =>
                m.id === clientMsgId || m.clientMsgId === clientMsgId
                  ? { ...m, deliveryStatus: "failed" }
                  : m
              )
            );
          }
          showToast(error, "err");
        },
        onChatReactionUpdate: (messageId, reactions) => {
          if (disposed) return;
          setWsComments((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
          );
        },
        onChatDeleted: (messageId) => {
          if (disposed) return;
          setWsComments((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, deleted: true } : m))
          );
        },
        onUserMuted: (targetUid, untilMs) => {
          if (!disposed && targetUid === currentUser.uid) {
            setMutedUntilMs(untilMs);
            showToast("You were temporarily muted by a moderator", "err");
          }
        },
        onApplauseBurst: (evt) => {
          if (disposed) return;
          setApplauseBursts((prev) => [...prev.slice(-8), evt]);
          setTimeout(() => {
            setApplauseBursts((prev) => prev.filter((item) => item.atMs !== evt.atMs));
          }, 2600);
        },
        onStageEvent: (evt) => {
          if (disposed) return;
          if (evt.event === "countdown_start" && evt.targetStartAtMs) {
            triggerVisualCountdown(evt.targetStartAtMs);
          } else if (evt.event === "round_change" && evt.roundState) {
            setRoundState(evt.roundState);
          }
        },
        onRtcViewerJoin: (evt) => mediaCtrlRef.current?.handleRtcViewerJoin(evt),
        onRtcViewerLeave: (evt) => mediaCtrlRef.current?.handleRtcViewerLeave(evt),
        onRtcSignal: (evt) => mediaCtrlRef.current?.handleRtcSignal(evt),
        onPeerDisconnected: (evt) => mediaCtrlRef.current?.handlePeerDisconnected(evt),
      }
    );

    wsClientRef.current = wsClient;

    const bootArena = async () => {
      const mediaCtrl = await createBattleMediaController({
        battleId: battle.id,
        role: resolvedRoomRole,
        mySlot,
        displayName: currentUser.fullName || "SwapSkill Member",
        wsClient,
        callbacks: {
          onModeResolved: (cfg) => {
            if (!disposed) setSfuMode(cfg.mode);
          },
          onLocalStream: (stream) => {
            if (!disposed) setLocalStream(stream);
          },
          onLocalMediaError: (code, msg) => {
            if (!disposed) {
              setLocalMediaError(code);
              setLocalMediaErrorMsg(msg || null);
            }
          },
          onSlotStream: (slot, stream) => {
            if (!disposed) {
              setSlotStreams((prev) => ({ ...prev, [slot]: stream }));
            }
          },
          onSlotStatus: (slot, status) => {
            if (!disposed) {
              setSlotStatuses((prev) => ({ ...prev, [slot]: status }));
            }
          },
          onNetworkQuality: (q) => {
            if (!disposed) setNetworkQuality(q);
          },
        },
      });

      if (disposed) {
        await mediaCtrl.cleanup();
        return;
      }

      mediaCtrlRef.current = mediaCtrl;
      await wsClient.connect();

      if (disposed) return;

      if (isCompetitor && mySlot) {
        const res = await mediaCtrl.startStageMedia(false);
        if (!disposed) {
          setIsStageActive(res.ok);
          setIsCamOn(res.camActive);
        }
      } else {
        await mediaCtrl.subscribeAsViewer();
      }
    };

    void bootArena();

    return () => {
      disposed = true;
      if (activeScreenShareRef.current) {
        void activeScreenShareRef.current.stop();
        activeScreenShareRef.current = null;
      }
      if (mediaCtrlRef.current) {
        void mediaCtrlRef.current.cleanup();
        mediaCtrlRef.current = null;
      }
      wsClient.disconnect();
      wsClientRef.current = null;
      setLocalStream(null);
      setSlotStreams({ A: null, B: null });
      setIsStageActive(false);
      setIsScreenSharing(false);
    };
  }, [battle?.id, resolvedRoomRole, mySlot]);

  // Competitor Media Handlers
  const handleRetryMedia = async (audioOnly = false) => {
    if (!mediaCtrlRef.current) return;
    const res = await mediaCtrlRef.current.startStageMedia(audioOnly);
    setIsStageActive(res.ok);
    setIsCamOn(res.camActive);
  };

  const handleToggleMic = () => {
    const next = !isMicOn;
    setIsMicOn(next);
    mediaCtrlRef.current?.setMicEnabled(next);
    if (battle) {
      void updateCompetitorArenaState(battle.id, currentUser.uid, { micActive: next });
    }
  };

  const handleToggleCam = () => {
    const next = !isCamOn;
    setIsCamOn(next);
    mediaCtrlRef.current?.setCamEnabled(next);
    if (battle) {
      void updateCompetitorArenaState(battle.id, currentUser.uid, { camActive: next });
    }
  };

  const handleFlipCam = async () => {
    const ok = await mediaCtrlRef.current?.flipCamera();
    if (!ok) showToast("Secondary camera unavailable on this device", "err");
  };

  const handleStartDeviceScreenShare = async () => {
    if (!battle || !mediaCtrlRef.current) return;
    try {
      const session = await startBattleDeviceScreenShare(battle.id, async () => {
        activeScreenShareRef.current = null;
        await mediaCtrlRef.current?.setScreenShareTrack(null);
        setIsScreenSharing(false);
        void updateCompetitorArenaState(battle.id, currentUser.uid, { screenSharing: false });
      });

      activeScreenShareRef.current = session;
      const track = session.stream.getVideoTracks()[0] || null;
      await mediaCtrlRef.current.setScreenShareTrack(track);
      setIsScreenSharing(true);
      void updateCompetitorArenaState(battle.id, currentUser.uid, { screenSharing: true });
    } catch (err: any) {
      if (err instanceof ScreenCaptureUnavailableError) {
        setShowStudio(true);
        showToast("Switched to Live Interactive Whiteboard & Code Studio");
      } else {
        showToast(err?.message || "Could not start screen share", "err");
      }
    }
  };

  const handleStopScreenShare = async () => {
    if (activeScreenShareRef.current) {
      await activeScreenShareRef.current.stop();
      activeScreenShareRef.current = null;
    }
    await mediaCtrlRef.current?.setScreenShareTrack(null);
    setIsScreenSharing(false);
    if (battle) {
      void updateCompetitorArenaState(battle.id, currentUser.uid, { screenSharing: false });
    }
  };

  const handleStudioStreamReady = async (canvasStream: MediaStream) => {
    if (!mediaCtrlRef.current || !battle) return;
    const track = canvasStream.getVideoTracks()[0] || null;
    await mediaCtrlRef.current.setScreenShareTrack(track);
    setIsScreenSharing(true);
    void updateCompetitorArenaState(battle.id, currentUser.uid, { screenSharing: true });
  };

  // Chat Handlers (Optimistic send + ACK + Retry)
  const handleSendMessage = (text: string, replyTo?: BattleCommentReplyRef) => {
    if (!battle) return;
    const clientMsgId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMsg: BattleComment = {
      id: clientMsgId,
      clientMsgId,
      battleId: battle.id,
      authorId: currentUser.uid,
      authorName: currentUser.fullName,
      authorPhoto: currentUser.photoUrl || "",
      authorRole: isCompetitor
        ? "competitor"
        : isAssignedJudge
        ? "judge"
        : isAdmin
        ? "admin"
        : "spectator",
      text,
      ...(replyTo ? { replyTo } : {}),
      reactions: {},
      deliveryStatus: "sending",
      createdAtMs: Date.now(),
    };

    setWsComments((prev) => [...prev, optimisticMsg]);
    const sent = wsClientRef.current?.sendChat(text, clientMsgId, replyTo);
    if (!sent) {
      setWsComments((prev) =>
        prev.map((m) => (m.id === clientMsgId ? { ...m, deliveryStatus: "failed" } : m))
      );
    } else {
      // Timeout guard if ACK doesn't arrive in 6s
      setTimeout(() => {
        setWsComments((prev) =>
          prev.map((m) =>
            m.id === clientMsgId && m.deliveryStatus === "sending"
              ? { ...m, deliveryStatus: "failed" }
              : m
          )
        );
      }, 6000);
    }
  };

  const handleRetryMessage = (msg: BattleComment) => {
    setWsComments((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, deliveryStatus: "sending" } : m))
    );
    const key = msg.clientMsgId || msg.id;
    const sent = wsClientRef.current?.sendChat(msg.text, key, msg.replyTo);
    if (!sent) {
      setWsComments((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, deliveryStatus: "failed" } : m))
      );
    }
  };

  // Battle Lifecycle & Engagement Handlers
  const handleStartLiveWithCountdown = async () => {
    if (!battle) return;
    setActionBusy(true);
    try {
      wsClientRef.current?.sendStageEvent("countdown_start", { delayMs: 3200 });
      triggerVisualCountdown(Date.now() + 3200);
      setTimeout(async () => {
        try {
          await startBattleLive(battle.id, currentUser);
          showToast("Battle is now LIVE!");
        } catch (err: any) {
          showToast(err?.message || "Could not start live battle", "err");
        } finally {
          setActionBusy(false);
        }
      }, 3100);
    } catch (err: any) {
      setActionBusy(false);
      showToast(err?.message || "Could not start live battle", "err");
    }
  };

  const handleMoveToJudging = async () => {
    if (!battle) return;
    setActionBusy(true);
    try {
      await moveBattleToJudging(battle.id, currentUser);
      showToast("Round ended — Judging phase active");
    } catch (err: any) {
      showToast(err?.message || "Could not move to judging", "err");
    } finally {
      setActionBusy(false);
    }
  };

  const handleFinalizeResult = async () => {
    if (!battle) return;
    setActionBusy(true);
    try {
      const res = await finalizeBattleResult(battle.id, currentUser);
      setResult(res);
      setShowResultModal(true);
    } catch (err: any) {
      showToast(err?.message || "Could not finalize battle results", "err");
    } finally {
      setActionBusy(false);
    }
  };

  const handleSyncDeliverable = async (summary: string, link: string) => {
    if (!battle || !isCompetitor) return;
    await updateCompetitorArenaState(battle.id, currentUser.uid, {
      ready: true,
      stageSummary: summary.trim(),
      submissionLink: link.trim(),
    });
    wsClientRef.current?.sendStageEvent("deliverable_sync", {
      stageSummary: summary.trim(),
      submissionLink: link.trim(),
    });
    showToast("Live submission published to Judges & Audience");
  };

  const handleVote = async (slot: "A" | "B", targetUid: string) => {
    if (!battle) return;
    setActionBusy(true);
    try {
      const vote = await castBattleVote(battle.id, currentUser, slot, targetUid);
      setMyVote(vote);
      showToast("Official audience vote recorded!");
    } catch (err: any) {
      showToast(err?.message || "Vote could not be submitted", "err");
    } finally {
      setActionBusy(false);
    }
  };

  const handleApplause = async (emoji = "🔥") => {
    if (!battle) return;
    wsClientRef.current?.sendApplause(emoji);
    void sendBattleApplause(battle.id);
  };

  const handleFollowUser = async (targetUid: string) => {
    if (!targetUid || targetUid === currentUser.uid) return;
    try {
      const followerRef = doc(db, "users", targetUid, "followers", currentUser.uid);
      const existing = await getDoc(followerRef);
      if (existing.exists()) {
        setFollowedUids((prev) => ({ ...prev, [targetUid]: true }));
        return;
      }
      await setDoc(followerRef, {
        followerId: currentUser.uid,
        followerName: currentUser.fullName,
        timestamp: Date.now(),
      });
      await setDoc(doc(db, "users", currentUser.uid, "following", targetUid), {
        followingId: targetUid,
        timestamp: Date.now(),
      });
      await updateDoc(doc(db, "users", targetUid), {
        followersCount: increment(1),
      }).catch(() => {});
      setFollowedUids((prev) => ({ ...prev, [targetUid]: true }));
      showToast("Following competitor!");
    } catch {
      showToast("Unable to follow user right now", "err");
    }
  };

  const handleShareBattle = async () => {
    if (!battle) return;
    const shareText = `Watch "${battle.title}" (${battle.customSkill}) LIVE on SwapSkill Arena! Battle ID: ${battle.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: battle.title, text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
        showToast("Battle invite copied to clipboard!");
      }
    } catch (_) {}
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!battle || reportDetails.trim().length < 5) return;
    setSubmittingReport(true);
    try {
      await submitBattleReport({
        battleId: battle.id,
        battleTitle: battle.title,
        reporter: currentUser,
        reason: reportReason,
        details: reportDetails,
      });
      setShowReportModal(false);
      setReportDetails("");
      showToast("Report submitted to SwapSkill moderation");
    } catch {
      showToast("Failed to submit report", "err");
    } finally {
      setSubmittingReport(false);
    }
  };

  if (!battle) {
    return (
      <div className="fixed inset-0 z-[85] bg-[#08090D] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#C9A96E]" />
      </div>
    );
  }

  return (
    <>
      {isCompetitor && mySlot ? (
        <CompetitorStageView
          battle={battle}
          currentUserId={currentUser.uid}
          mySlot={mySlot}
          isCreator={isCreator}
          isOpponent={isOpponent}
          isAdmin={isAdmin}
          viewerCount={viewerCount}
          secondsRemaining={secondsRemaining}
          roundState={roundState}
          countdownSecs={countdownSecs}
          wsConnected={wsConnected}
          networkQuality={networkQuality}
          publishers={publishers}
          localStream={localStream}
          remoteStream={slotStreams[mySlot === "A" ? "B" : "A"]}
          localMediaError={localMediaError}
          localMediaErrorMsg={localMediaErrorMsg}
          isStageActive={isStageActive}
          isMicOn={isMicOn}
          isCamOn={isCamOn}
          isScreenSharing={isScreenSharing}
          showStudio={showStudio}
          comments={mergedComments}
          mutedUntilMs={mutedUntilMs}
          scores={scores}
          result={result}
          actionBusy={actionBusy}
          onLeave={onClose}
          onRetryMedia={handleRetryMedia}
          onToggleMic={handleToggleMic}
          onToggleCam={handleToggleCam}
          onFlipCam={handleFlipCam}
          onStartDeviceScreenShare={handleStartDeviceScreenShare}
          onStopScreenShare={handleStopScreenShare}
          onToggleStudio={setShowStudio}
          onStudioStreamReady={handleStudioStreamReady}
          onStartLiveWithCountdown={handleStartLiveWithCountdown}
          onMoveToJudging={handleMoveToJudging}
          onFinalizeResult={handleFinalizeResult}
          onOpenResult={() => setShowResultModal(true)}
          onSyncDeliverable={handleSyncDeliverable}
          onRespondInvite={async (accept) => {
            setActionBusy(true);
            try {
              await respondToBattleInvite(battle.id, currentUser, accept);
              showToast(accept ? "Challenge accepted!" : "Challenge declined");
              if (!accept) onClose();
            } finally {
              setActionBusy(false);
            }
          }}
          onSendMessage={handleSendMessage}
          onRetryMessage={handleRetryMessage}
          onReactMessage={(messageId, emoji) =>
            wsClientRef.current?.reactToChat(messageId, emoji)
          }
          onDeleteMessage={(messageId) => wsClientRef.current?.deleteChat(messageId)}
          onMuteUser={(uid) => wsClientRef.current?.muteUser(uid)}
          onShare={handleShareBattle}
          onReport={() => setShowReportModal(true)}
          onViewProfile={onViewProfile}
        />
      ) : (
        <AudienceViewerView
          battle={battle}
          currentUserId={currentUser.uid}
          isAdmin={isAdmin}
          isAssignedJudge={isAssignedJudge}
          canScoreAsJudge={canScoreAsJudge}
          viewerCount={viewerCount}
          secondsRemaining={secondsRemaining}
          roundState={roundState}
          countdownSecs={countdownSecs}
          wsConnected={wsConnected}
          publishers={publishers}
          slotStreams={slotStreams}
          slotStatuses={slotStatuses}
          quality={viewerQuality}
          sfuMode={sfuMode}
          comments={mergedComments}
          mutedUntilMs={mutedUntilMs}
          scores={scores}
          myVote={myVote}
          result={result}
          applauseBursts={applauseBursts}
          followedUids={followedUids}
          actionBusy={actionBusy}
          onLeave={onClose}
          onClaimOpenBattle={async () => {
            setActionBusy(true);
            try {
              await joinOpenBattle(battle.id, currentUser);
              showToast("You claimed the Challenger seat!");
            } catch (err: any) {
              showToast(err?.message || "Could not join open battle", "err");
            } finally {
              setActionBusy(false);
            }
          }}
          onVote={handleVote}
          onApplause={handleApplause}
          onFollow={handleFollowUser}
          onChangeQuality={(q) => {
            setViewerQuality(q);
            mediaCtrlRef.current?.setViewerQuality(q);
          }}
          onSendMessage={handleSendMessage}
          onRetryMessage={handleRetryMessage}
          onReactMessage={(messageId, emoji) =>
            wsClientRef.current?.reactToChat(messageId, emoji)
          }
          onDeleteMessage={(messageId) => wsClientRef.current?.deleteChat(messageId)}
          onMuteUser={(uid) => wsClientRef.current?.muteUser(uid)}
          onSubmitJudgeScore={async (input) => {
            await submitJudgeScore({
              battle,
              judge: currentUser,
              ...input,
            });
            showToast("Official judge scorecard locked!");
          }}
          onFinalizeResult={handleFinalizeResult}
          onOpenResult={() => setShowResultModal(true)}
          onShare={handleShareBattle}
          onReport={() => setShowReportModal(true)}
          onViewProfile={onViewProfile}
        />
      )}

      {/* Floating Arena Toast */}
      {toast && (
        <div
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-[105] px-4 py-2 rounded-full text-[12px] font-bold shadow-2xl border backdrop-blur-md ${
            toast.tone === "ok"
              ? "bg-[#0D0F16]/95 border-[#C9A96E]/50 text-[#C9A96E]"
              : "bg-rose-950/95 border-rose-500/50 text-rose-200"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Report Misconduct Modal (Custom Accessible Radio Sheet - Zero Native Select) */}
      {showReportModal && (
        <div
          onClick={() => setShowReportModal(false)}
          className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmitReport}
            className="w-full sm:max-w-md rounded-t-[24px] sm:rounded-[24px] bg-[#131621] border border-white/10 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3 text-white"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-bold">Report Battle Issue</h3>
              <button
                type="button"
                onClick={() => setShowReportModal(false)}
                className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReportReason(r.id)}
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-left text-[13px] font-medium cursor-pointer transition ${
                    reportReason === r.id
                      ? "bg-[#C9A96E]/20 border-[#C9A96E] text-[#C9A96E]"
                      : "bg-black/40 border-white/10 text-neutral-300"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              required
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="Describe details for SwapSkill moderation review..."
              className="w-full p-3 rounded-xl bg-black/50 border border-white/10 text-[13px] text-white placeholder:text-neutral-500 resize-none focus:outline-none focus:border-[#C9A96E]"
            />

            <button
              type="submit"
              disabled={submittingReport || reportDetails.trim().length < 5}
              className="w-full min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
            >
              {submittingReport ? "Submitting..." : "Submit Report"}
            </button>
          </form>
        </div>
      )}

      {/* Official Result Reveal */}
      <BattleResultModal
        isOpen={showResultModal}
        result={result}
        currentUserId={currentUser.uid}
        onClose={() => setShowResultModal(false)}
        onOpenLeaderboard={onOpenLeaderboard}
      />
    </>
  );
};
