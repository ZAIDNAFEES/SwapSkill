import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { createPortal } from "react-dom";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  SwitchCamera,
  Phone,
  PhoneOff,
  Volume2,
  VolumeX,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Users,
  Minimize2,
  Maximize2,
  ChevronDown,
  MonitorUp,
  MonitorOff,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Smartphone,
  X,
  Hand,
  Smile,
  Activity,
  ShieldCheck,
  Radio,
  Zap,
  MoreHorizontal,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useBackHandler } from "../utils/navigationManager";
import { doc, getDoc, onSnapshot, updateDoc, serverTimestamp, Unsubscribe } from "firebase/firestore";
import { db } from "../firebase";
import { DEFAULT_AVATAR } from "../types";
import { WebRTCService } from "../services/webrtcService";
import { LiveScreenShareStudio } from "./LiveScreenShareStudio";
import {
  callSignalingService,
  generateUniqueCallId,
  logCallToConversation,
} from "../services/callSignalingService";
import { getOrCreateConversation } from "../utils/conversationUtils";
import {
  joinLiveSession,
  leaveLiveSession,
  recordSessionLeaveBeacon,
} from "../services/sessionPresenceService";
import { mobileLifecycleService } from "../services/mobile/lifecycle";
import { mobileAudioRoutingService } from "../services/mobile/audio";
import { mobileNetworkService } from "../services/mobile/network";
import { mobilePermissionService } from "../services/mobile/permissions";
import { activeCallSessionService } from "../services/activeCallSessionService";
import { mobileForegroundService } from "../services/mobile/foregroundService";
import { mobileCallKitService } from "../services/mobile/callKitService";
import {
  playCallEnded,
  stopIncomingCallRingtone,
  startOutgoingRingtone,
  stopOutgoingRingtone,
  stopAllCallSounds,
  triggerHapticFeedback,
} from "../utils/sound";

// 1x1 solid dark SVG poster to eradicate Android WebView default play glyph placeholders
const BLACK_POSTER = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Crect width='1' height='1' fill='%230c0d12'/%3E%3C/svg%3E";

export interface LiveSwapCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  partnerName: string;
  partnerPhoto?: string;
  partnerUid: string;
  sessionId: string;
  conversationId?: string;
  skillName?: string;
  currentUserId: string;
  currentUserName: string;
  currentUserPhoto?: string;
  sessionDuration?: number; // in minutes (e.g. 30, 45, 60)
  scheduledTime?: any;
  sessionEndTime?: any;
  onSessionCompleted?: (sessionId: string) => void;
  initialCallType?: "video" | "audio";
  isCaller?: boolean; // legacy compat
  incomingCallId?: string; // legacy compat
}

export type CallStage =
  | "waiting"     // Waiting for partner to join the room
  | "initiating"  // Preparing camera/mic and signaling
  | "calling"     // Caller calling partner ("Calling...")
  | "ringing"     // Ringing partner / callee receiving call ("Ringing...")
  | "connecting"  // Both joined, WebRTC negotiating
  | "connected"   // Audio/video stream active
  | "reconnecting" // Network hiccup / ICE disconnected, attempting recovery
  | "ending"      // Tear down in progress
  | "ended"       // Call finished
  | "failed";     // Fatal connection error

export default function LiveSwapCallModal({
  isOpen,
  onClose,
  partnerName,
  partnerPhoto,
  partnerUid,
  sessionId,
  conversationId,
  skillName,
  currentUserId,
  currentUserName,
  currentUserPhoto,
  sessionDuration = 30,
  scheduledTime,
  sessionEndTime,
  onSessionCompleted,
  initialCallType = "video",
  isCaller = false,
  incomingCallId,
}: LiveSwapCallModalProps) {
  if (!isOpen) return null;

  // DOM Video & Audio Refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // WebRTC Service & Active Media Stream Refs
  const webrtcRef = useRef<WebRTCService | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  // Session & Call State: IMO-style Calling / Ringing
  // If receiver accepted incoming call, they immediately enter connected stage with active duration timer
  const [callStage, setCallStage] = useState<CallStage>(
    incomingCallId && !isCaller ? "connected" : isCaller ? "calling" : "waiting"
  );
  const [statusMessage, setStatusMessage] = useState<string>(
    incomingCallId && !isCaller
      ? "00:00"
      : isCaller
      ? "Calling..."
      : `Waiting for ${partnerName} to join...`
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [participantCount, setParticipantCount] = useState<number>(1);
  const [hasRemoteVideo, setHasRemoteVideo] = useState<boolean>(false);
  const [remoteStreamRevision, setRemoteStreamRevision] = useState<number>(0);
  const [isRemoteVideoPlaying, setIsRemoteVideoPlaying] = useState<boolean>(false);
  const [isLocalVideoPlaying, setIsLocalVideoPlaying] = useState<boolean>(false);
  const [isLocalScreenPlaying, setIsLocalScreenPlaying] = useState<boolean>(false);

  // Media Controls State
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(initialCallType === "audio");
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [cameraFlipError, setCameraFlipError] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const durationSecondsRef = useRef(0);
  durationSecondsRef.current = durationSeconds;

  // Screen Share & Stage Zoom State (Educational Tech-Giant Polish)
  const [isSharingScreen, setIsSharingScreen] = useState<boolean>(false);
  const [isRemoteSharingScreen, setIsRemoteSharingScreen] = useState<boolean>(false);
  const [screenSharingPresenterName, setScreenSharingPresenterName] = useState<string>("");
  const [screenZoomLevel, setScreenZoomLevel] = useState<number>(1);
  const [screenFitMode, setScreenFitMode] = useState<"contain" | "cover">("contain");
  const [screenShareToast, setScreenShareToast] = useState<string | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const nativeScreenCleanupRef = useRef<(() => Promise<void>) | null>(null);
  const presenterScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const [localScreenRevision, setLocalScreenRevision] = useState<number>(0);
  const [isStudioOpen, setIsStudioOpen] = useState<boolean>(false);
  const [showMobileScreenShareHelp, setShowMobileScreenShareHelp] = useState<boolean>(false);
  const isSharingScreenRef = useRef<boolean>(false);
  isSharingScreenRef.current = isSharingScreen;
  const isRemoteSharingScreenRef = useRef<boolean>(false);
  isRemoteSharingScreenRef.current = isRemoteSharingScreen;
  const [screenPan, setScreenPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isLandscapeTheater, setIsLandscapeTheater] = useState<boolean>(false);
  const [isPiPMinimized, setIsPiPMinimized] = useState<boolean>(false);
  const theaterStageRef = useRef<HTMLDivElement | null>(null);
  const isPanningScreenRef = useRef(false);
  const screenPanStartRef = useRef<{ x: number; y: number; initPanX: number; initPanY: number }>({
    x: 0,
    y: 0,
    initPanX: 0,
    initPanY: 0,
  });

  // Zoom & Google Meet Tech-Giant Features State
  const [floatingReactions, setFloatingReactions] = useState<
    { id: string; emoji: string; senderName: string; x: number; key: string }[]
  >([]);
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState<boolean>(false);
  const [isMoreActionsOpen, setIsMoreActionsOpen] = useState<boolean>(false);
  const touchPinchRef = useRef<{
    initialDist: number;
    initialZoom: number;
    isPinching: boolean;
    hasPannedOrPinched: boolean;
    lastTapTime: number;
    panStart: { x: number; y: number; initPanX: number; initPanY: number };
  }>({
    initialDist: 0,
    initialZoom: 1,
    isPinching: false,
    hasPannedOrPinched: false,
    lastTapTime: 0,
    panStart: { x: 0, y: 0, initPanX: 0, initPanY: 0 },
  });
  const lastReactionIdRef = useRef<string | null>(null);

  // Raise Hand
  const [isHandRaised, setIsHandRaised] = useState<boolean>(false);
  const [partnerHandRaised, setPartnerHandRaised] = useState<string | null>(null);

  // Active Speaker Voice Glow
  const [isLocalSpeaking, setIsLocalSpeaking] = useState<boolean>(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState<boolean>(false);

  // Laser Pointer on Screen Share
  const [isLaserPointerActive, setIsLaserPointerActive] = useState<boolean>(false);
  const [localLaser, setLocalLaser] = useState<{ x: number; y: number } | null>(null);
  const [remoteLaser, setRemoteLaser] = useState<{ x: number; y: number; senderName?: string } | null>(null);
  const lastLaserSentRef = useRef<number>(0);

  // Call Diagnostics & Quality HUD
  const [isQualityStatsOpen, setIsQualityStatsOpen] = useState<boolean>(false);
  const [isVoiceFocusEnabled, setIsVoiceFocusEnabled] = useState<boolean>(false);

  // Floating PiP Dragging State
  const [pipPosition, setPipPosition] = useState<{ x: number; y: number } | null>(null);
  const isDraggingPipRef = useRef(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initX: number; initY: number }>({
    startX: 0,
    startY: 0,
    initX: 0,
    initY: 0,
  });

  // Native Android Picture-in-Picture State
  const [isNativePip, setIsNativePip] = useState<boolean>(false);
  const [nativePipSupported, setNativePipSupported] = useState<boolean>(false);

  // In-app Minimize State (IMO-style Draggable Floating Mini-Window)
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const miniRemoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);

  // IMO-Style Touch-to-Toggle Call Interface Controls (Mute, Camera, Flip, Speaker, End)
  const [areControlsVisible, setAreControlsVisible] = useState<boolean>(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
    // Auto-hide controls after 4.5 seconds of inactivity when visible
    controlsTimeoutRef.current = setTimeout(() => {
      setAreControlsVisible(false);
    }, 4500);
  }, []);

  const handleScreenTap = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Don't toggle controls if user was pinching or panning screen
    if (touchPinchRef.current.hasPannedOrPinched) {
      touchPinchRef.current.hasPannedOrPinched = false;
      return;
    }
    // Don't toggle controls if user clicked on any interactive button, local camera PiP, or control elements
    if (
      target.closest("button") ||
      target.closest("#live-swap-local-pip") ||
      target.closest("#more-actions-sheet") ||
      target.closest(".no-controls-toggle")
    ) {
      return;
    }
    setAreControlsVisible((prev) => {
      const next = !prev;
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = null;
      }
      if (next) {
        controlsTimeoutRef.current = setTimeout(() => {
          setAreControlsVisible(false);
        }, 4500);
      }
      return next;
    });
  }, []);

  // Callback ref for instantaneous, glitch-free binding to User B's remote video element
  const attachMiniRemoteVideo = useCallback((el: HTMLVideoElement | null) => {
    miniRemoteVideoRef.current = el;
    if (!el) return;
    const stream = remoteStreamRef.current || webrtcRef.current?.getRemoteStream() || activeCallSessionService.getActiveSession()?.remoteStream;
    if (stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.play().catch(() => {});
    }
  }, []);

  // Intercept back button when in full-screen call to minimize into floating PiP instead of closing
  useBackHandler(isOpen && !isMinimized, () => {
    triggerHapticFeedback("light");
    setIsMinimized(true);
    return true; // consumed
  });

  useEffect(() => {
    mobileForegroundService.isPipSupported().then((supported) => {
      setNativePipSupported(supported);
    });
  }, []);

  // Sync remote video stream seamlessly across full-screen and draggable mini PiP window
  useEffect(() => {
    const stream = remoteStreamRef.current || webrtcRef.current?.getRemoteStream() || activeCallSessionService.getActiveSession()?.remoteStream;
    if (!stream) return;

    if (isMinimized && miniRemoteVideoRef.current) {
      if (miniRemoteVideoRef.current.srcObject !== stream) {
        miniRemoteVideoRef.current.srcObject = stream;
      }
      miniRemoteVideoRef.current.play().catch(() => {});
    } else if (!isMinimized && remoteVideoRef.current) {
      if (remoteVideoRef.current.srcObject !== stream) {
        remoteVideoRef.current.srcObject = stream;
      }
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [isMinimized, hasRemoteVideo, remoteStreamRevision]);

  // CallStage ref for callbacks & timeouts
  const callStageRef = useRef<CallStage>(callStage);
  callStageRef.current = callStage;

  // Connection & Reconnection Timeout Refs
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const iceRestartCountRef = useRef<number>(0);

  // LIVE status indicator visibility: Active during connecting, calling, ringing, connected, or reconnecting
  const isLiveActive =
    callStage === "connecting" ||
    callStage === "calling" ||
    callStage === "ringing" ||
    callStage === "connected" ||
    callStage === "reconnecting";

  // Call Negotiation Synchronization Refs
  const activeCallIdRef = useRef<string | null>(incomingCallId || null);
  const isNegotiatingRef = useRef<boolean>(false);
  const connectedAtRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasFullCleanedUpRef = useRef<boolean>(false);
  const hasInitiatedRef = useRef<boolean>(false);

  // Stabilize props in refs to avoid triggering effect re-runs on prop changes
  const partnerNameRef = useRef(partnerName);
  partnerNameRef.current = partnerName;
  const partnerUidRef = useRef(partnerUid);
  partnerUidRef.current = partnerUid;
  const partnerPhotoRef = useRef(partnerPhoto);
  partnerPhotoRef.current = partnerPhoto;
  const currentUserNameRef = useRef(currentUserName);
  currentUserNameRef.current = currentUserName;
  const currentUserPhotoRef = useRef(currentUserPhoto);
  currentUserPhotoRef.current = currentUserPhoto;
  const skillNameRef = useRef(skillName);
  skillNameRef.current = skillName;
  const isVideoMutedRef = useRef(isVideoMuted);
  isVideoMutedRef.current = isVideoMuted;
  const isAudioMutedRef = useRef(isAudioMuted);
  isAudioMutedRef.current = isAudioMuted;
  const facingModeRef = useRef(facingMode);
  facingModeRef.current = facingMode;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSessionCompletedRef = useRef(onSessionCompleted);
  onSessionCompletedRef.current = onSessionCompleted;
  const setupStartedSessionIdRef = useRef<string | null>(null);

  // Firestore Listeners Refs
  const unsubSessionRef = useRef<Unsubscribe | null>(null);
  const unsubCallRef = useRef<Unsubscribe | null>(null);
  const unsubCandidatesRef = useRef<Unsubscribe | null>(null);
  const hasExplicitlyEndedRef = useRef<boolean>(false);

  // Dynamic Profile & Name Display State (hydrated live from Firestore to ensure SwapSkill custom photo is used)
  const [partnerDisplayName, setPartnerDisplayName] = useState<string>(partnerName || "Partner");
  const [partnerDisplayPhoto, setPartnerDisplayPhoto] = useState<string>(partnerPhoto || "");
  const [currentDisplayName, setCurrentDisplayName] = useState<string>(currentUserName || "You");
  const [currentDisplayPhoto, setCurrentDisplayPhoto] = useState<string>(currentUserPhoto || "");

  useEffect(() => {
    if (partnerName) setPartnerDisplayName(partnerName);
    if (partnerPhoto) setPartnerDisplayPhoto(partnerPhoto);
  }, [partnerName, partnerPhoto]);

  useEffect(() => {
    if (currentUserName) setCurrentDisplayName(currentUserName);
    if (currentUserPhoto) setCurrentDisplayPhoto(currentUserPhoto);
  }, [currentUserName, currentUserPhoto]);

  // Background hydration: Load fresh SwapSkill profile photos directly from Firestore users documents
  useEffect(() => {
    let active = true;
    const fetchFreshPhotos = async () => {
      if (partnerUid) {
        try {
          const pSnap = await getDoc(doc(db, "users", partnerUid));
          if (active && pSnap.exists()) {
            const data = pSnap.data();
            const freshPhoto = data.profilePhotoUrl || data.photoUrl || "";
            if (freshPhoto) setPartnerDisplayPhoto(freshPhoto);
            if (data.fullName) setPartnerDisplayName(data.fullName);
          }
        } catch (_) {}
      }
      if (currentUserId) {
        try {
          const uSnap = await getDoc(doc(db, "users", currentUserId));
          if (active && uSnap.exists()) {
            const data = uSnap.data();
            const freshPhoto = data.profilePhotoUrl || data.photoUrl || "";
            if (freshPhoto) setCurrentDisplayPhoto(freshPhoto);
            if (data.fullName) setCurrentDisplayName(data.fullName);
          }
        } catch (_) {}
      }
    };
    fetchFreshPhotos();
    return () => { active = false; };
  }, [partnerUid, currentUserId]);

  /**
   * Format call duration into MM:SS
   */
  const formattedDuration = useMemo(() => {
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, [durationSeconds]);

  /**
   * Timer management: strictly driven by stable connectedAt timestamp.
   * Starts ONLY when WebRTC connection is connected, never during calling or ringing.
   * Starts exactly once and is immune to redundant state updates or connection events.
   */
  const startDurationTimer = useCallback((customStartTimestamp?: number) => {
    if (connectedAtRef.current) {
      console.log("[CALL_TIMER] Connected timer already running, preserving current elapsed time");
      return;
    }
    const startTime = customStartTimestamp && customStartTimestamp <= Date.now() 
      ? customStartTimestamp 
      : Date.now();
    connectedAtRef.current = startTime;
    const initialElapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    setDurationSeconds(initialElapsed);
    console.log("[CALL_TIMER] Connected timer started with elapsed:", initialElapsed);

    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      if (connectedAtRef.current) {
        const elapsed = Math.floor((Date.now() - connectedAtRef.current) / 1000);
        setDurationSeconds(elapsed);
      }
    }, 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
      console.log("[CALL_TIMER] Connected timer stopped");
    }
    connectedAtRef.current = null;
  }, []);

  /**
   * Cleans up an active WebRTC negotiation/call instance when partner leaves
   * or a new negotiation round begins.
   */
  const cleanupActiveCall = useCallback((reason: string) => {
    console.log(`[LIVE SWAP] CLEANUP_REASON: ${reason}`);

    stopIncomingCallRingtone();
    stopDurationTimer();

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
    iceRestartCountRef.current = 0;

    if (unsubCallRef.current) {
      unsubCallRef.current();
      unsubCallRef.current = null;
    }
    if (unsubCandidatesRef.current) {
      unsubCandidatesRef.current();
      unsubCandidatesRef.current = null;
    }

    if (webrtcRef.current) {
      webrtcRef.current.cleanup();
      webrtcRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    if (nativeScreenCleanupRef.current) {
      nativeScreenCleanupRef.current().catch(() => {});
      nativeScreenCleanupRef.current = null;
    }
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch (_) {}
      });
      localScreenStreamRef.current = null;
    }
    mobileForegroundService.setScreenShareState(false).catch(() => {});

    remoteStreamRef.current = null;
    setHasRemoteVideo(false);
    setIsSharingScreen(false);
    setIsRemoteSharingScreen(false);
    setScreenZoomLevel(1);
    setRemoteStreamRevision((prev) => prev + 1);

    if (activeCallIdRef.current) {
      callSignalingService.clearActiveCall(activeCallIdRef.current);
      activeCallIdRef.current = null;
    }
    isNegotiatingRef.current = false;
  }, [stopDurationTimer]);

  /**
   * Complete teardown when user exits the Live Swap room
   */
  const performFullCleanup = useCallback(
    async (reason: string, shouldNotifyPresence = true) => {
      if (hasFullCleanedUpRef.current) return;
      hasFullCleanedUpRef.current = true;
      setupStartedSessionIdRef.current = null;

      console.log(`[LIVE SWAP] CLEANUP_REASON: Full teardown (${reason})`);

      cleanupActiveCall(reason);

      // Stop local camera and microphone tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (_) {}
        });
        localStreamRef.current = null;
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }

      // Unsubscribe session room listener
      if (unsubSessionRef.current) {
        unsubSessionRef.current();
        unsubSessionRef.current = null;
      }

      // Release Mobile Screen Wake Lock and reset audio routing
      await mobileLifecycleService.releaseCallWakeLock();
      await mobileAudioRoutingService.resetAudioRouting();
      mobilePermissionService.releaseActiveStream();

      // Stop native Android Foreground Service and iOS CallKit
      await mobileForegroundService.stopCallForegroundService();
      await mobileCallKitService.endCall(activeCallIdRef.current || undefined);
      await activeCallSessionService.endActiveCallExplicitly(reason);

      // Explicitly terminate session in CallSignalingService (ONE CALL = ONE SESSION)
      if (sessionId) {
        callSignalingService.terminateSession(sessionId, activeCallIdRef.current || undefined, reason);
      }
      callSignalingService.unregisterActiveCall(sessionId, activeCallIdRef.current || undefined);
      callSignalingService.resetCallState();

      // Update Session Presence atomically (preserves isLive if partner is still in call)
      if (shouldNotifyPresence && sessionId && currentUserId) {
        try {
          const leaveRes = await leaveLiveSession(sessionId, currentUserId);
          if (leaveRes.remainingCount === 0) {
            await updateDoc(doc(db, "sessions", sessionId), {
              currentCallId: null,
            }).catch(() => {});
          }
        } catch (e) {
          console.warn("[LiveSwap] Error updating session leave state:", e);
        }
      }
    },
    [cleanupActiveCall, sessionId, currentUserId]
  );

  /**
   * User ends the call or leaves the Live Swap room
   */
  const handleEndCall = useCallback(
    async (reason = "User left session") => {
      hasExplicitlyEndedRef.current = true;
      console.log(`[LIVE SWAP] EXPLICIT_END_CALL: handleEndCall (${reason})`);
      stopOutgoingRingtone();
      setCallStage("ended");
      setStatusMessage("Session ended");
      await activeCallSessionService.endActiveCallExplicitly(reason);

      const finalDuration = durationSecondsRef.current;
      const wasConnected = callStage === "connected" || finalDuration > 0;
      const finalCallId = activeCallIdRef.current || `call_${Date.now()}`;

      // Persist real call log entry into conversation
      const writeCallLog = async () => {
        try {
          let targetChatId = conversationId;
          if (!targetChatId && currentUserId && partnerUid) {
            const resolved = await getOrCreateConversation(currentUserId, partnerUid);
            targetChatId = resolved.chatId;
          }
          if (targetChatId) {
            await logCallToConversation({
              conversationId: targetChatId,
              callId: finalCallId,
              callType: initialCallType,
              status: wasConnected ? "completed" : "missed",
              durationSeconds: finalDuration,
              callerId: isCaller ? currentUserId : partnerUid,
              callerName: isCaller ? currentUserName : partnerName,
              receiverId: isCaller ? partnerUid : currentUserId,
              receiverName: isCaller ? partnerName : currentUserName,
              currentUserId: currentUserId,
            });
          }
        } catch (logErr) {
          console.warn("[LiveSwap] Error writing call log:", logErr);
        }
      };
      writeCallLog();

      if (sessionId) {
        callSignalingService.terminateSession(sessionId, activeCallIdRef.current || undefined, reason);
      }

      if (activeCallIdRef.current) {
        try {
          await callSignalingService.endCall(activeCallIdRef.current, reason, sessionId);
        } catch (err) {
          console.warn("[LiveSwap] Non-fatal error signaling call end:", err);
        }
      }

      if (sessionId) {
        try {
          await updateDoc(doc(db, "sessions", sessionId), {
            isLive: false,
            currentCallId: null,
          });
        } catch (_) {}
      }

      playCallEnded();
      setIsMinimized(false);
      onSessionCompletedRef.current?.(sessionId);
      onCloseRef.current();
    },
    [sessionId, performFullCleanup, conversationId, currentUserId, partnerUid, initialCallType, isCaller, currentUserName, partnerName, callStage]
  );

  /**
   * Acquire local camera and microphone stream and render in PiP
   */
  const acquireLocalMedia = useCallback(async (): Promise<MediaStream | null> => {
    try {
      if (localStreamRef.current && localStreamRef.current.active) {
        console.log("[CALL_TRACE] Step 4: Reusing existing active local stream");
        if (localVideoRef.current && localVideoRef.current.srcObject !== localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.play().catch(() => {});
        }
        return localStreamRef.current;
      }

      console.log("[CALL_TRACE] Step 1: Requesting camera and microphone access via MobilePermissionService...");
      setStatusMessage("Requesting camera & microphone access...");
      const res = await mobilePermissionService.acquireCallMediaStream({
        video: !isVideoMutedRef.current,
        audio: true,
        facingMode: facingModeRef.current,
      });

      if (!res.success || !res.stream) {
        // If initial video+audio request failed, check if audio-only works
        if (!isVideoMutedRef.current) {
          console.warn("[CALL_TRACE] Video+Audio failed, attempting audio-only fallback...");
          const audioOnlyRes = await mobilePermissionService.acquireCallMediaStream({
            video: false,
            audio: true,
          });
          if (audioOnlyRes.success && audioOnlyRes.stream) {
            console.log("[CALL_TRACE] Audio-only stream acquired successfully!");
            isVideoMutedRef.current = true;
            setIsVideoMuted(true);
            const stream = audioOnlyRes.stream;
            localStreamRef.current = stream;
            activeCallSessionService.updateLocalStream(stream);
            setErrorMessage(null);
            return stream;
          }
        }

        console.error("[CALL_TRACE] Step 2 FAILED: Media acquisition failed:", res.error, res.errorType);
        setErrorMessage(res.error || "Please allow camera and microphone access to join the Live Swap.");
        setStatusMessage("Camera & microphone access failed");
        setCallStage("failed");
        return null;
      }

      const stream = res.stream;
      localStreamRef.current = stream;
      activeCallSessionService.updateLocalStream(stream);
      setErrorMessage(null);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }
      return stream;
    } catch (err: any) {
      console.error("[CALL_TRACE] Step 2 FAILED: Unexpected error acquiring local media:", err);
      setErrorMessage(err?.message || "Please allow camera and microphone access to join the Live Swap.");
      setStatusMessage("Camera & microphone access failed");
      setCallStage("failed");
      return null;
    }
  }, []);

  /**
   * Helper to attach remote media stream to HTML elements
   */
  const handleRemoteStream = useCallback((stream: MediaStream) => {
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    const hasVideo = videoTracks.length > 0 && videoTracks.some((t) => t.enabled && t.readyState !== "ended");

    console.log(
      `[LS_DEBUG] handleRemoteStream: video=${videoTracks.length} (hasLiveVideo=${hasVideo}), audio=${audioTracks.length}`
    );

    remoteStreamRef.current = stream;
    activeCallSessionService.updateRemoteStream(stream);
    setHasRemoteVideo(hasVideo);
    setRemoteStreamRevision((prev) => prev + 1);

    videoTracks.forEach((t) => {
      const handleUnmute = () => {
        console.log(`[LS_DEBUG] Remote video track unmuted and active (id: ${t.id})`);
        setHasRemoteVideo(true);
        if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== stream) {
          remoteVideoRef.current.srcObject = stream;
        }
        remoteVideoRef.current?.play().catch(() => {});
      };
      const handleMute = () => {
        console.log(`[LS_DEBUG] Remote video track muted (id: ${t.id})`);
      };

      t.addEventListener("unmute", handleUnmute);
      t.addEventListener("mute", handleMute);
    });

    if (remoteVideoRef.current) {
      if (remoteVideoRef.current.srcObject !== stream) {
        remoteVideoRef.current.srcObject = stream;
      }
      remoteVideoRef.current.play().catch((e) => {
        console.log("[LiveSwap] Remote video auto-play caught:", e);
      });
    }

    if (remoteAudioRef.current) {
      if (remoteAudioRef.current.srcObject !== stream) {
        remoteAudioRef.current.srcObject = stream;
      }
      remoteAudioRef.current.play().catch(() => {});
    }
  }, []);

  /**
   * Sync remote video element srcObject on revision or stage changes
   */
  useEffect(() => {
    if (remoteVideoRef.current && remoteStreamRef.current) {
      if (remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
        console.log("[LiveSwap WebRTC] Syncing remoteStream to remote video element");
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
      remoteVideoRef.current.play().catch((e) => {
        console.log("[LiveSwap] Remote video play sync:", e);
      });
    }

    if (remoteAudioRef.current && remoteStreamRef.current) {
      if (remoteAudioRef.current.srcObject !== remoteStreamRef.current) {
        remoteAudioRef.current.srcObject = remoteStreamRef.current;
      }
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStreamRevision, callStage, hasRemoteVideo]);

  /**
   * Enterprise-Grade Synthesized Audio Feedback (Chimes, Pings, Clicks)
   */
  const playSynthChime = useCallback((type: "reaction" | "hand" | "pop") => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      if (type === "reaction") {
        // High-end marimba chord: C5 -> E5 -> G5
        [523.25, 659.25, 783.99].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + idx * 0.05);
          gain.gain.setValueAtTime(0.08, now + idx * 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.05 + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.05);
          osc.stop(now + idx * 0.05 + 0.35);
        });
      } else if (type === "hand") {
        // Two-tone bell ping: 660Hz -> 880Hz
        [660, 880].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + idx * 0.08);
          gain.gain.setValueAtTime(0.09, now + idx * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.08);
          osc.stop(now + idx * 0.08 + 0.4);
        });
      } else {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(450, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.06);
      }
    } catch (_) {}
  }, []);

  /**
   * Trigger floating emoji reactions
   */
  const triggerReactionBurst = useCallback(
    (emoji: string, senderName: string) => {
      playSynthChime("reaction");
      triggerHapticFeedback("light");
      const newItems = Array.from({ length: 6 }).map((_, i) => ({
        id: `${Date.now()}_${Math.random()}`,
        emoji,
        senderName,
        x: 20 + Math.random() * 60,
        key: `${Date.now()}_${i}_${Math.random()}`,
      }));
      setFloatingReactions((prev) => [...prev.slice(-15), ...newItems]);
      setTimeout(() => {
        setFloatingReactions((prev) => prev.filter((r) => !newItems.some((n) => n.key === r.key)));
      }, 3400);
    },
    [playSynthChime]
  );

  const handleSendReaction = useCallback(
    async (emoji: string) => {
      triggerHapticFeedback("medium");
      setIsReactionPickerOpen(false);
      triggerReactionBurst(emoji, currentUserNameRef.current || currentUserName || "You");
      if (activeCallIdRef.current) {
        await callSignalingService.sendReaction(
          activeCallIdRef.current,
          emoji,
          currentUserId,
          currentUserNameRef.current || currentUserName
        );
      }
    },
    [currentUserId, currentUserName, triggerReactionBurst]
  );

  const handleToggleRaiseHand = useCallback(async () => {
    triggerHapticFeedback("medium");
    const next = !isHandRaised;
    setIsHandRaised(next);
    if (next) playSynthChime("hand");
    if (activeCallIdRef.current) {
      await callSignalingService.setHandRaise(
        activeCallIdRef.current,
        next,
        currentUserId,
        currentUserNameRef.current || currentUserName
      );
    }
  }, [isHandRaised, currentUserId, currentUserName, playSynthChime]);

  /**
   * Real-Time Active Speaker Detection & Acoustic Pulse (Apple / Google Meet Style)
   */
  useEffect(() => {
    if (callStage !== "connected") {
      setIsLocalSpeaking(false);
      setIsRemoteSpeaking(false);
      return;
    }

    let audioCtx: AudioContext | null = null;
    let animId: number;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      audioCtx = new AudioCtx();

      let localAnalyser: AnalyserNode | null = null;
      let remoteAnalyser: AnalyserNode | null = null;

      if (localStreamRef.current && localStreamRef.current.getAudioTracks().some((t) => t.enabled)) {
        try {
          const localSource = audioCtx.createMediaStreamSource(localStreamRef.current);
          localAnalyser = audioCtx.createAnalyser();
          localAnalyser.fftSize = 64;
          localSource.connect(localAnalyser);
        } catch (_) {}
      }

      if (remoteStreamRef.current && remoteStreamRef.current.getAudioTracks().length > 0) {
        try {
          const remoteSource = audioCtx.createMediaStreamSource(remoteStreamRef.current);
          remoteAnalyser = audioCtx.createAnalyser();
          remoteAnalyser.fftSize = 64;
          remoteSource.connect(remoteAnalyser);
        } catch (_) {}
      }

      const localData = new Uint8Array(32);
      const remoteData = new Uint8Array(32);
      let lastCheck = 0;

      const analyzeAudio = (now: number) => {
        if (now - lastCheck > 120) {
          lastCheck = now;
          if (localAnalyser && !isAudioMuted) {
            localAnalyser.getByteFrequencyData(localData);
            const sum = localData.reduce((a, b) => a + b, 0);
            setIsLocalSpeaking(sum / localData.length > 14);
          } else {
            setIsLocalSpeaking(false);
          }

          if (remoteAnalyser) {
            remoteAnalyser.getByteFrequencyData(remoteData);
            const sum = remoteData.reduce((a, b) => a + b, 0);
            setIsRemoteSpeaking(sum / remoteData.length > 14);
          } else {
            setIsRemoteSpeaking(false);
          }
        }
        animId = requestAnimationFrame(analyzeAudio);
      };
      animId = requestAnimationFrame(analyzeAudio);
    } catch (_) {}

    return () => {
      cancelAnimationFrame(animId);
      if (audioCtx) {
        try { audioCtx.close(); } catch (_) {}
      }
    };
  }, [callStage, isAudioMuted, remoteStreamRevision]);

  /**
   * OFF-ERER WORKFLOW (Direct Caller or Deterministic smaller UID)
   */
  const startOffererWorkflow = useCallback(
    async (callId: string, passedLocalStream?: MediaStream | null) => {
      try {
        console.log(`[LIVE SWAP] AUTO_NEGOTIATION_STARTED: Offerer for call ${callId}`);
        setCallStage("calling");
        setStatusMessage("Calling...");
        setErrorMessage(null);
        startOutgoingRingtone();

        // 1. Instantly initiate call record in Firestore & dispatch FCM push to callee (t=0ms)
        // Decoupled from media acquisition & ICE negotiation so callee starts ringing in ~200-400ms!
        console.log(`[TIMING] T0_CALL_INITIATED_LIVESWAP: callId=${callId} sessionId=${sessionId}`);
        try {
          await callSignalingService.initiateCall({
            callId,
            sessionId,
            callerId: currentUserId,
            callerName: currentUserNameRef.current || currentUserName,
            callerPhoto: currentUserPhotoRef.current || currentUserPhoto,
            receiverId: partnerUidRef.current || partnerUid,
            receiverName: partnerNameRef.current || partnerName,
            receiverPhoto: partnerPhotoRef.current || partnerPhoto,
            callType: isVideoMutedRef.current ? "audio" : "video",
            skillName: skillNameRef.current || skillName,
            offer: null, // Asynchronously generated in background and attached via setCallOffer
          });
        } catch (initErr) {
          console.warn("[LiveSwap] Immediate initiateCall error:", initErr);
        }

        // 1b. Start Native Foreground Service EARLY to protect camera & mic before capture
        mobileForegroundService.startCallForegroundService({
          partnerName: partnerNameRef.current || partnerName,
          callType: initialCallType,
          sessionId,
          callId,
        });

        // 2. Parallel media acquisition and ICE server resolution for instant connection (<1s)
        const [localStream, iceServers] = await Promise.all([
          passedLocalStream ? Promise.resolve(passedLocalStream) : acquireLocalMedia(),
          WebRTCService.fetchIceServers(),
        ]);
        if (!localStream) {
          throw new Error("Unable to access local camera or microphone.");
        }

        const webrtc = new WebRTCService({
          onLocalStream: (stream) => {
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
            }
          },
          onRemoteStream: handleRemoteStream,
          onIceCandidate: (candidate) => {
            callSignalingService.addCallerCandidate(callId, candidate);
          },
          onIceRestartNeeded: async () => {
            console.warn("[LiveSwap WebRTC] ICE restart needed on offerer. Initiating ICE renegotiation...");
            setStatusMessage("Reconnecting call...");
            try {
              const restartOffer = await webrtc.restartIce();
              if (restartOffer && activeCallIdRef.current === callId) {
                await updateDoc(doc(db, "calls", callId), {
                  offer: restartOffer,
                  iceRestartAt: serverTimestamp(),
                });
                console.log("[LiveSwap WebRTC] ICE restart offer sent to signaling");
              }
            } catch (err) {
              console.warn("[LiveSwap WebRTC] ICE restart offer error:", err);
            }
          },
          onConnectionStateChange: (state) => {
            if (state === "connected") {
              if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
              }
              if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
              }
              iceRestartCountRef.current = 0;
              stopOutgoingRingtone();
              setCallStage("connected");
              setStatusMessage("Connected");
              setErrorMessage(null);
              startDurationTimer();
              callSignalingService.markCallConnected(callId);
              activeCallSessionService.setCallStage("connected");
              mobileForegroundService.startCallForegroundService({
                partnerName: partnerNameRef.current,
                callType: initialCallType,
                sessionId,
                callId,
              });
              mobileCallKitService.reportCallConnected(callId);
              // Update session doc isLive to true
              updateDoc(doc(db, "sessions", sessionId), {
                isLive: true,
                liveAt: serverTimestamp(),
              }).catch(() => {});
            } else if (state === "disconnected") {
              console.warn("[LiveSwap WebRTC] Connection temporarily disconnected on offerer, attempting recovery...");
              setCallStage("reconnecting");
              setStatusMessage("Reconnecting call…");

              // 15-second grace period for recovery before declaring fatal failure
              if (!reconnectTimeoutRef.current) {
                reconnectTimeoutRef.current = setTimeout(() => {
                  if (callStageRef.current === "reconnecting") {
                    console.error("[LiveSwap WebRTC] Reconnection timed out after 15s on offerer");
                    setCallStage("failed");
                    setStatusMessage("Connection lost");
                    setErrorMessage("Connection dropped. Please check your network and retry.");
                  }
                }, 15000);
              }

              // Trigger an ICE restart if recovery takes more than 3s
              if (iceRestartCountRef.current < 3) {
                iceRestartCountRef.current++;
                setTimeout(async () => {
                  if (callStageRef.current === "reconnecting" && webrtcRef.current) {
                    try {
                      console.log(`[LiveSwap WebRTC] Triggering ICE restart (attempt ${iceRestartCountRef.current}/3)...`);
                      const restartOffer = await webrtcRef.current.restartIce();
                      if (restartOffer && activeCallIdRef.current === callId) {
                        await updateDoc(doc(db, "calls", callId), {
                          offer: restartOffer,
                          iceRestartAt: serverTimestamp(),
                        });
                      }
                    } catch (e) {
                      console.warn("[LiveSwap WebRTC] ICE restart attempt error:", e);
                    }
                  }
                }, 3000);
              }
            } else if (state === "failed") {
              console.error("[LiveSwap WebRTC] Connection failed on offerer");
              stopOutgoingRingtone();
              if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
              }
              if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
              }
              setCallStage("failed");
              setStatusMessage("Connection failed");
              setErrorMessage("Connection dropped. Please retry.");
              // Remove live status immediately
              updateDoc(doc(db, "sessions", sessionId), {
                isLive: false,
              }).catch(() => {});
            }
          },
        });

        webrtcRef.current = webrtc;
        webrtc.initPeerConnection(iceServers, localStream);
        activeCallSessionService.registerSession({
          sessionId,
          callId,
          partnerName: partnerNameRef.current,
          partnerPhoto: partnerPhotoRef.current,
          partnerUid: partnerUidRef.current,
          skillName: skillNameRef.current,
          callType: initialCallType,
          isCaller: true,
          localStream,
          webrtcService: webrtc,
        });

        // 3. Configure Mobile Speaker Audio
        await mobileAudioRoutingService.setAudioRoute("speaker", remoteAudioRef.current);

        // 4. Generate SDP Offer
        const offer = await webrtc.createOffer();

        // 35s outgoing ringing timeout: after 35s, silence ringtone and transition to open meeting room waiting for partner
        if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = setTimeout(() => {
          if (callStageRef.current === "calling" || callStageRef.current === "ringing") {
            console.log("[LiveSwap] Ringing completed. Keeping meeting room live in waiting state for partner");
            stopOutgoingRingtone();
            setCallStage("waiting");
            setStatusMessage(`Waiting for ${partnerNameRef.current} to join…`);
          }
        }, 35000);

        // 5. Attach generated SDP offer to Firestore /calls/{callId}
        await callSignalingService.setCallOffer(callId, offer);

        // 6. Listen for Answerer's ICE Candidates
        unsubCandidatesRef.current = callSignalingService.listenToCalleeCandidates(
          callId,
          (cand) => {
            webrtc.addIceCandidate(cand);
          }
        );

        // 7. Listen for Callee's Answer
        let lastHandledAnswerSdp = "";
        unsubCallRef.current = callSignalingService.listenToCall(callId, async (callData) => {
          if (!callData) return;

          if (callData.status === "ringing") {
            setCallStage("ringing");
            setStatusMessage("Ringing...");
          }

          if (callData.status === "rejected") {
            stopOutgoingRingtone();
            playCallEnded();
            cleanupActiveCall("Call declined");
            setCallStage("ended");
            setStatusMessage(`${partnerNameRef.current} declined the call.`);
            setTimeout(() => {
              handleEndCall("Call declined");
            }, 1500);
            return;
          }

          if (callData.status === "ended" || (callData.status as any) === "cancelled") {
            stopOutgoingRingtone();
            playCallEnded();
            hasExplicitlyEndedRef.current = true;
            activeCallSessionService.endActiveCallExplicitly("Remote peer ended the call");
            cleanupActiveCall("Remote peer ended the call");
            setCallStage("ended");
            handleEndCall("Remote peer ended");
            return;
          }

          if (callData.status === "connected" || (callData as any).status === "in_call") {
            stopAllCallSounds();
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
              reconnectTimeoutRef.current = null;
            }
            setCallStage("connected");
            setStatusMessage("");
          }

          // Real-time synchronization of screen sharing state
          if (callData.isScreenSharing) {
            const isLocalSharing = isSharingScreenRef.current || (callData.screenSharingUid && callData.screenSharingUid === currentUserId);
            if (!isLocalSharing) {
              setIsRemoteSharingScreen(true);
              setScreenSharingPresenterName(callData.screenSharingName || partnerNameRef.current || "Partner");
            } else {
              setIsRemoteSharingScreen(false);
            }
          } else {
            setIsRemoteSharingScreen(false);
            setScreenPan({ x: 0, y: 0 });
            setScreenZoomLevel(1);
          }

          // Real-time synchronization of floating emoji reactions
          if (callData.latestReaction && callData.latestReaction.id !== lastReactionIdRef.current) {
            lastReactionIdRef.current = callData.latestReaction.id;
            if (callData.latestReaction.senderId !== currentUserId) {
              triggerReactionBurst(callData.latestReaction.emoji, callData.latestReaction.senderName);
            }
          }

          // Real-time synchronization of Raise Hand status
          if (callData.raisedHand) {
            if (callData.raisedHand.userId !== currentUserId) {
              setPartnerHandRaised(callData.raisedHand.userName || partnerNameRef.current || "Partner");
            } else {
              setPartnerHandRaised(null);
            }
          } else {
            setPartnerHandRaised(null);
          }

          // Real-time synchronization of Laser Pointer on screen share
          if (callData.laserPointer) {
            if (callData.laserPointer.userId !== currentUserId) {
              setRemoteLaser({
                x: callData.laserPointer.x,
                y: callData.laserPointer.y,
                senderName: partnerNameRef.current || "Partner",
              });
            }
          } else {
            setRemoteLaser(null);
          }

          if (callData.answer && callData.answer.sdp !== lastHandledAnswerSdp) {
            lastHandledAnswerSdp = callData.answer.sdp;
            console.log(`[SIGNALING] ANSWER_RECEIVED on offerer for call ${callId}`);
            stopOutgoingRingtone();
            setCallStage("connecting");
            setStatusMessage("Connecting to swap partner...");
            await webrtc.setRemoteAnswer(callData.answer.sdp);

            // Flush any existing callee candidates to eliminate ICE candidate race conditions
            try {
              const existingCalleeCandidates = await callSignalingService.getCalleeCandidates(callId);
              if (existingCalleeCandidates.length > 0) {
                console.log(`[LiveSwap WebRTC] Flushing ${existingCalleeCandidates.length} callee ICE candidates after answer`);
                for (const cand of existingCalleeCandidates) {
                  webrtc.addIceCandidate(cand);
                }
              }
            } catch (candErr) {
              console.warn("[LiveSwap] Error flushing callee candidates after answer:", candErr);
            }
          }
        });
      } catch (err: any) {
        console.error("[LiveSwap WebRTC] Error in Offerer workflow:", err);
        stopOutgoingRingtone();
        setCallStage("failed");
        setErrorMessage(err?.message || "Failed to negotiate connection.");
        isNegotiatingRef.current = false;
      }
    },
    [
      acquireLocalMedia,
      handleRemoteStream,
      currentUserId,
      sessionId,
      startDurationTimer,
      cleanupActiveCall,
      handleEndCall,
    ]
  );

  /**
   * ANSWERER WORKFLOW (Direct Answerer or Deterministic larger UID)
   */
  const startAnswererWorkflow = useCallback(
    async (callId: string, passedLocalStream?: MediaStream | null) => {
      try {
        console.log(`[LIVE SWAP] AUTO_NEGOTIATION_STARTED: Answerer for call ${callId}`);
        // Receiver accepted: transition to connecting state while ICE and DTLS negotiate
        setCallStage("connecting");
        setStatusMessage("Connecting to swap partner...");
        setErrorMessage(null);

        // 35s connection timeout for answerer negotiation
        if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = setTimeout(() => {
          if (callStageRef.current === "connecting") {
            console.warn("[LiveSwap] Answerer connection timed out after 35s");
            setCallStage("failed");
            setStatusMessage("Connection timed out");
            setErrorMessage("Failed to connect to partner. Please try again.");
          }
        }, 35000);

        // 1. Start Native Foreground Service EARLY to protect camera & mic before capture
        mobileForegroundService.startCallForegroundService({
          partnerName: partnerNameRef.current || partnerName,
          callType: initialCallType,
          sessionId,
          callId,
        });

        // 2. Parallel media acquisition and ICE server resolution for instant connection (<1s)
        const [localStream, iceServers] = await Promise.all([
          passedLocalStream ? Promise.resolve(passedLocalStream) : acquireLocalMedia(),
          WebRTCService.fetchIceServers(),
        ]);
        if (!localStream) {
          throw new Error("Unable to access local camera or microphone.");
        }

        const webrtc = new WebRTCService({
          onLocalStream: (stream) => {
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
            }
          },
          onRemoteStream: handleRemoteStream,
          onIceCandidate: (candidate) => {
            callSignalingService.addCalleeCandidate(callId, candidate);
          },
          onIceRestartNeeded: () => {
            console.warn("[LiveSwap WebRTC] ICE restart needed on answerer, awaiting remote offer...");
            setCallStage("reconnecting");
            setStatusMessage("Reconnecting call…");
          },
          onConnectionStateChange: (state) => {
            if (state === "connected") {
              if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
              }
              if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
              }
              iceRestartCountRef.current = 0;
              stopIncomingCallRingtone();
              setCallStage("connected");
              setStatusMessage("Connected");
              setErrorMessage(null);
              startDurationTimer();
              callSignalingService.markCallConnected(callId);
              activeCallSessionService.setCallStage("connected");
              mobileForegroundService.startCallForegroundService({
                partnerName: partnerNameRef.current,
                callType: initialCallType,
                sessionId,
                callId,
              });
              mobileCallKitService.reportCallConnected(callId);
              // Update session doc isLive to true
              updateDoc(doc(db, "sessions", sessionId), {
                isLive: true,
                liveAt: serverTimestamp(),
              }).catch(() => {});
            } else if (state === "disconnected") {
              console.warn("[LiveSwap WebRTC] Connection temporarily disconnected on answerer, attempting recovery...");
              setCallStage("reconnecting");
              setStatusMessage("Reconnecting call…");

              // 15-second grace period for recovery before declaring fatal failure
              if (!reconnectTimeoutRef.current) {
                reconnectTimeoutRef.current = setTimeout(() => {
                  if (callStageRef.current === "reconnecting") {
                    console.error("[LiveSwap WebRTC] Reconnection timed out after 15s on answerer");
                    setCallStage("failed");
                    setStatusMessage("Connection lost");
                    setErrorMessage("Connection dropped. Please check your network and retry.");
                  }
                }, 15000);
              }
            } else if (state === "failed") {
              console.error("[LiveSwap WebRTC] Connection failed on answerer");
              if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
              }
              if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
              }
              setCallStage("failed");
              setStatusMessage("Connection failed");
              setErrorMessage("Connection dropped. Please retry.");
              // Remove live status immediately
              updateDoc(doc(db, "sessions", sessionId), {
                isLive: false,
              }).catch(() => {});
            }
          },
        });

        console.log(`[CALL_ATTACH] callId=${callId} sessionId=${sessionId}`);
        webrtcRef.current = webrtc;
        webrtc.initPeerConnection(iceServers, localStream);
        console.log("[WEBRTC_PC_CREATED]");

        activeCallSessionService.registerSession({
          sessionId,
          callId,
          partnerName: partnerNameRef.current,
          partnerPhoto: partnerPhotoRef.current,
          partnerUid: partnerUidRef.current,
          skillName: skillNameRef.current,
          callType: initialCallType,
          isCaller: false,
          localStream,
          webrtcService: webrtc,
        });

        // 3. Configure Mobile Speaker Audio
        await mobileAudioRoutingService.setAudioRoute("speaker", remoteAudioRef.current);

        // 4. Pre-fetch any existing caller ICE candidates immediately
        try {
          const existingCallerCandidates = await callSignalingService.getCallerCandidates(callId);
          if (existingCallerCandidates.length > 0) {
            console.log(`[LiveSwap] Found ${existingCallerCandidates.length} pre-existing caller ICE candidates. Adding...`);
            for (const cand of existingCallerCandidates) {
              console.log("[WEBRTC_ICE_CANDIDATE_RECEIVED]");
              webrtc.addIceCandidate(cand);
            }
          }
        } catch (e) {
          console.warn("[LiveSwap] Error reading existing caller candidates:", e);
        }

        // 5. Listen for Caller's ICE Candidates in real-time
        unsubCandidatesRef.current = callSignalingService.listenToCallerCandidates(
          callId,
          (cand) => {
            console.log("[WEBRTC_ICE_CANDIDATE_RECEIVED]");
            webrtc.addIceCandidate(cand);
          }
        );

        // 6. Inspect call document for pre-existing Offer immediately
        let lastHandledOfferSdp = "";
        try {
          const existingCallData = await callSignalingService.getCall(callId);
          if (existingCallData && existingCallData.offer && !hasExplicitlyEndedRef.current) {
            lastHandledOfferSdp = existingCallData.offer.sdp;
            console.log("[WEBRTC_OFFER_FOUND]");
            console.log(`[LIVE SWAP] Pre-existing offer found on Answerer for call ${callId}. Creating answer...`);
            setCallStage("connecting");
            setStatusMessage("Connecting...");
            const answer = await webrtc.createAnswer(existingCallData.offer.sdp);
            console.log("[WEBRTC_REMOTE_DESCRIPTION_SET]");
            console.log("[WEBRTC_ANSWER_CREATED]");
            await callSignalingService.answerCall(callId, answer);
            console.log("[WEBRTC_ANSWER_STORED]");

            try {
              const existingCallerCandidates = await callSignalingService.getCallerCandidates(callId);
              if (existingCallerCandidates.length > 0) {
                console.log(`[LiveSwap WebRTC] Flushing ${existingCallerCandidates.length} caller ICE candidates after pre-existing offer answer`);
                for (const cand of existingCallerCandidates) {
                  webrtc.addIceCandidate(cand);
                }
              }
            } catch (candErr) {
              console.warn("[LiveSwap] Error flushing caller candidates after pre-existing answer:", candErr);
            }
          }
        } catch (e) {
          console.warn("[LiveSwap] Error checking pre-existing call document:", e);
        }

        // 7. Listen for the Offer document and generate Answer (handles initial & renegotiated offers)
        unsubCallRef.current = callSignalingService.listenToCall(callId, async (callData) => {
          if (!callData) return;

          if (callData.status === "accepting") {
            setCallStage("connecting");
            setStatusMessage("Connecting...");
          }

          if (callData.status === "ended" || (callData.status as any) === "cancelled") {
            playCallEnded();
            hasExplicitlyEndedRef.current = true;
            activeCallSessionService.endActiveCallExplicitly("Remote peer ended the call");
            cleanupActiveCall("Remote peer ended the call");
            setCallStage("ended");
            handleEndCall("Remote peer ended");
            return;
          }

          if (callData.status === "connected" || (callData as any).status === "in_call") {
            stopAllCallSounds();
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
              reconnectTimeoutRef.current = null;
            }
            setCallStage("connected");
            setStatusMessage("");
          }

          // Real-time synchronization of screen sharing state
          if (callData.isScreenSharing) {
            const isLocalSharing = isSharingScreenRef.current || (callData.screenSharingUid && callData.screenSharingUid === currentUserId);
            if (!isLocalSharing) {
              setIsRemoteSharingScreen(true);
              setScreenSharingPresenterName(callData.screenSharingName || partnerNameRef.current || "Partner");
            } else {
              setIsRemoteSharingScreen(false);
            }
          } else {
            setIsRemoteSharingScreen(false);
            setScreenPan({ x: 0, y: 0 });
            setScreenZoomLevel(1);
          }

          // Real-time synchronization of floating emoji reactions
          if (callData.latestReaction && callData.latestReaction.id !== lastReactionIdRef.current) {
            lastReactionIdRef.current = callData.latestReaction.id;
            if (callData.latestReaction.senderId !== currentUserId) {
              triggerReactionBurst(callData.latestReaction.emoji, callData.latestReaction.senderName);
            }
          }

          // Real-time synchronization of Raise Hand status
          if (callData.raisedHand) {
            if (callData.raisedHand.userId !== currentUserId) {
              setPartnerHandRaised(callData.raisedHand.userName || partnerNameRef.current || "Partner");
            } else {
              setPartnerHandRaised(null);
            }
          } else {
            setPartnerHandRaised(null);
          }

          // Real-time synchronization of Laser Pointer on screen share
          if (callData.laserPointer) {
            if (callData.laserPointer.userId !== currentUserId) {
              setRemoteLaser({
                x: callData.laserPointer.x,
                y: callData.laserPointer.y,
                senderName: partnerNameRef.current || "Partner",
              });
            }
          } else {
            setRemoteLaser(null);
          }

          if (callData.offer && callData.offer.sdp !== lastHandledOfferSdp) {
            lastHandledOfferSdp = callData.offer.sdp;
            console.log("[WEBRTC_OFFER_FOUND]");
            console.log(`[LIVE SWAP] Offer received on Answerer for call ${callId}. Creating answer...`);
            setCallStage("connecting");
            setStatusMessage("Connecting...");
            const answer = await webrtc.createAnswer(callData.offer.sdp);
            console.log("[WEBRTC_REMOTE_DESCRIPTION_SET]");
            console.log("[WEBRTC_ANSWER_CREATED]");
            await callSignalingService.answerCall(callId, answer);
            console.log("[WEBRTC_ANSWER_STORED]");

            // Flush any existing caller candidates to eliminate ICE candidate race conditions
            try {
              const existingCallerCandidates = await callSignalingService.getCallerCandidates(callId);
              if (existingCallerCandidates.length > 0) {
                console.log(`[LiveSwap WebRTC] Flushing ${existingCallerCandidates.length} caller ICE candidates after answer`);
                for (const cand of existingCallerCandidates) {
                  webrtc.addIceCandidate(cand);
                }
              }
            } catch (candErr) {
              console.warn("[LiveSwap] Error flushing caller candidates after answer:", candErr);
            }
          }
        });
      } catch (err: any) {
        console.error("[LiveSwap WebRTC] Error in Answerer workflow:", err);
        setCallStage("failed");
        setErrorMessage(err?.message || "Failed to answer connection.");
        isNegotiatingRef.current = false;
      }
    },
    [
      acquireLocalMedia,
      handleRemoteStream,
      sessionId,
      startDurationTimer,
      cleanupActiveCall,
      handleEndCall,
    ]
  );

  const acquireLocalMediaRef = useRef(acquireLocalMedia);
  acquireLocalMediaRef.current = acquireLocalMedia;
  const startOffererWorkflowRef = useRef(startOffererWorkflow);
  startOffererWorkflowRef.current = startOffererWorkflow;
  const startAnswererWorkflowRef = useRef(startAnswererWorkflow);
  startAnswererWorkflowRef.current = startAnswererWorkflow;
  const cleanupActiveCallRef = useRef(cleanupActiveCall);
  cleanupActiveCallRef.current = cleanupActiveCall;
  const performFullCleanupRef = useRef(performFullCleanup);
  performFullCleanupRef.current = performFullCleanup;

  /**
   * Main Room & Presence Synchronization Lifecycle
   */
  useEffect(() => {
    if (!isOpen || !sessionId || !currentUserId) return;

    // Guard: Prevent re-initializing if already active for this session
    if (setupStartedSessionIdRef.current === sessionId) {
      return;
    }
    setupStartedSessionIdRef.current = sessionId;
    hasFullCleanedUpRef.current = false;
    let isCancelled = false;

    const setupCall = async () => {
      try {
        console.log(`[CALL_TRACE] Initializing Live Swap room for session ${sessionId}...`);

        // CASE 0: Re-attach to existing decoupled active call session if one is already running
        const existingSession = activeCallSessionService.getActiveSession();
        if (existingSession && existingSession.sessionId === sessionId && existingSession.webrtcService) {
          console.log(`[CALL_TRACE] Re-attaching to existing decoupled call session: ${existingSession.callId}`);
          activeCallIdRef.current = existingSession.callId;
          hasInitiatedRef.current = true;
          webrtcRef.current = existingSession.webrtcService;
          localStreamRef.current = existingSession.localStream;
          remoteStreamRef.current = existingSession.remoteStream;

          if (localVideoRef.current && existingSession.localStream) {
            localVideoRef.current.srcObject = existingSession.localStream;
            localVideoRef.current.play().catch(() => {});
          }
          if (remoteVideoRef.current && existingSession.remoteStream) {
            remoteVideoRef.current.srcObject = existingSession.remoteStream;
            remoteVideoRef.current.play().catch(() => {});
          }
          if (remoteAudioRef.current && existingSession.remoteStream) {
            remoteAudioRef.current.srcObject = existingSession.remoteStream;
            remoteAudioRef.current.play().catch(() => {});
          }

          setHasRemoteVideo(Boolean(existingSession.remoteStream?.getVideoTracks().some((t) => t.enabled && t.readyState !== "ended")));
          setCallStage("connected");
          setStatusMessage("Connected");
          startDurationTimer(existingSession.startedAt);
          return;
        }

        callSignalingService.registerActiveCall(sessionId, incomingCallId || undefined);
        setCallStage("initiating");
        setStatusMessage("Requesting camera & microphone access...");
        setErrorMessage(null);

        // Step 1: Request camera + microphone permissions & acquire stream FIRST
        const stream = await acquireLocalMediaRef.current();
        if (isCancelled) return;

        if (!stream || !stream.active) {
          console.error("[CALL_TRACE] Local media acquisition failed or not active. Halting room entry.");
          setCallStage("failed");
          setStatusMessage("Camera & microphone access failed");
          return;
        }

        console.log(`[CALL_TRACE] Step 3 & 4 verified: Local stream active (id: ${stream.id}).`);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }

        // Step 2: Acquire Mobile Screen Wake Lock
        mobileLifecycleService.acquireCallWakeLock();

        // Step 3: Register Presence in Live Session Room
        await joinLiveSession(sessionId, currentUserId);
        if (isCancelled) return;

        // 1. Verify if an active call already exists on the session or incomingCallId
        let verifiedIncomingCallId: string | null = null;
        let isIncomingCallFromPartner = false;

        try {
          const sessionSnap = await getDoc(doc(db, "sessions", sessionId));
          if (sessionSnap.exists()) {
            const sessData = sessionSnap.data();
            const sessionCallId = sessData.currentCallId || incomingCallId;
            if (sessionCallId) {
              const callSnap = await getDoc(doc(db, "calls", sessionCallId));
              if (callSnap.exists()) {
                const callData = callSnap.data();
                const isLive =
                  callData.status !== "ended" &&
                  callData.status !== "completed" &&
                  callData.status !== "cancelled" &&
                  callData.status !== "rejected";
                if (isLive) {
                  if (callData.callerId && callData.callerId !== currentUserId) {
                    verifiedIncomingCallId = sessionCallId;
                    isIncomingCallFromPartner = true;
                    console.log(`[CALL_TRACE] Verified active partner call: ${sessionCallId}. Will join as Answerer!`);
                  } else if (callData.callerId === currentUserId) {
                    activeCallIdRef.current = sessionCallId;
                    console.log(`[CALL_TRACE] Re-joining my active call: ${sessionCallId}`);
                  }
                } else {
                  console.log(`[CALL_TRACE] Session call ${sessionCallId} is already ended/completed. Clearing stale ID.`);
                  updateDoc(doc(db, "sessions", sessionId), {
                    currentCallId: null,
                    isLive: false,
                  }).catch(() => {});
                }
              }
            }
          }
        } catch (checkErr) {
          console.warn("[LiveSwap] Non-fatal error checking existing session call:", checkErr);
        }

        // CASE 1: Verified active call from partner exists -> Join as Answerer immediately
        if (verifiedIncomingCallId && isIncomingCallFromPartner && !hasInitiatedRef.current) {
          hasInitiatedRef.current = true;
          activeCallIdRef.current = verifiedIncomingCallId;
          isNegotiatingRef.current = true;
          console.log(`[CALL_TRACE] Step 5: Joining partner call as Answerer for callId: ${verifiedIncomingCallId}`);
          startAnswererWorkflowRef.current(verifiedIncomingCallId, stream);
          return;
        }

        // CASE 2: Explicit caller initiated call (and no partner call exists)
        if (isCaller && !verifiedIncomingCallId && !hasInitiatedRef.current) {
          hasInitiatedRef.current = true;
          const newCallId = activeCallIdRef.current || generateUniqueCallId(sessionId);
          activeCallIdRef.current = newCallId;
          isNegotiatingRef.current = true;
          console.log(`[CALL_TRACE] Step 5: Direct Caller startup for callId: ${newCallId}`);

          startOffererWorkflowRef.current(newCallId, stream);

          updateDoc(doc(db, "sessions", sessionId), {
            currentCallId: newCallId,
            callUpdatedAt: serverTimestamp(),
          }).catch((err) => {
            console.warn("[LiveSwap] Error syncing currentCallId to session doc:", err);
          });

          return;
        }

        // CASE 3: In-room peer synchronization (both participants joined the session)
        setCallStage("waiting");
        setStatusMessage(`Waiting for ${partnerNameRef.current} to join...`);

        const sessionDocRef = doc(db, "sessions", sessionId);
        unsubSessionRef.current = onSnapshot(
          sessionDocRef,
          async (snap) => {
            if (isCancelled || !snap.exists()) return;
            const data = snap.data();

            const participants: string[] = Array.isArray(data.liveParticipants)
              ? data.liveParticipants
              : [];
            const count = participants.length;
            setParticipantCount(count);

            console.log(`[LIVE SWAP] PARTICIPANT_COUNT: ${count}, currentCallId: ${data.currentCallId}`);

            // A) Check if partner has already published an active call to this session:
            const activeCallIdOnSession = data.currentCallId;
            if (activeCallIdOnSession && !hasInitiatedRef.current) {
              try {
                const cSnap = await getDoc(doc(db, "calls", activeCallIdOnSession));
                if (cSnap.exists()) {
                  const cData = cSnap.data();
                  const isCallActive =
                    cData.status !== "ended" &&
                    cData.status !== "completed" &&
                    cData.status !== "cancelled" &&
                    cData.status !== "rejected";
                  if (isCallActive) {
                    if (cData.callerId && cData.callerId !== currentUserId) {
                      hasInitiatedRef.current = true;
                      activeCallIdRef.current = activeCallIdOnSession;
                      isNegotiatingRef.current = true;
                      console.log(`[CALL_TRACE] Answering partner call ${activeCallIdOnSession} discovered in room`);
                      startAnswererWorkflowRef.current(activeCallIdOnSession, localStreamRef.current);
                      return;
                    } else if (cData.callerId === currentUserId) {
                      activeCallIdRef.current = activeCallIdOnSession;
                      return;
                    }
                  }
                }
              } catch (e) {
                console.warn("[LiveSwap] Error inspecting in-room call:", e);
              }
            }

            // B) If less than 2 participants -> Waiting state
            if (count < 2) {
              if (!hasInitiatedRef.current && !activeCallIdRef.current) {
                setCallStage("waiting");
                setStatusMessage(
                  participants.includes(currentUserId)
                    ? `Waiting for ${partnerNameRef.current} to join...`
                    : "Connecting to session room..."
                );
              }
              return;
            }

            // C) Exactly 2 participants in room and NO call exists yet -> Deterministic election
            if (!hasInitiatedRef.current && !activeCallIdRef.current) {
              const sortedUids = [...participants].sort();
              const offererUid = sortedUids[0];
              const amIOfferer = currentUserId === offererUid;

              if (amIOfferer) {
                hasInitiatedRef.current = true;
                const newCallId = generateUniqueCallId(sessionId);
                activeCallIdRef.current = newCallId;
                console.log(`[CALL_TRACE] Step 5: Deterministic Offerer startup for callId: ${newCallId}`);
                startOffererWorkflowRef.current(newCallId, localStreamRef.current);

                try {
                  await updateDoc(sessionDocRef, {
                    currentCallId: newCallId,
                    callUpdatedAt: serverTimestamp(),
                  });
                } catch (err) {
                  console.warn("[LiveSwap] Error syncing currentCallId to session doc:", err);
                }
              } else {
                console.log("[CALL_TRACE] Waiting for deterministic offerer to write currentCallId...");
                setCallStage("connecting");
                setStatusMessage("Connecting to swap partner...");
              }
            }
          },
          (err) => {
            console.warn("[LiveSwap] Error listening to session presence:", err);
          }
        );
      } catch (err: any) {
        console.error("[CALL_TRACE] setupCall error:", err);
        setCallStage("failed");
        setStatusMessage("Connection failed");
        setErrorMessage(err?.message || "Failed to establish call.");
      }
    };

    setupCall();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, sessionId, currentUserId, isCaller, incomingCallId]);

  // Ensure full cleanup runs only if modal is closed AND the call was explicitly ended
  useEffect(() => {
    if (!isOpen && hasExplicitlyEndedRef.current && !hasFullCleanedUpRef.current) {
      performFullCleanupRef.current("Modal closed after explicit call end", true);
    }
  }, [isOpen]);

  // Decoupled WebRTC lifecycle: Active call survives unmount (e.g. backgrounding, route navigation)
  useEffect(() => {
    return () => {
      if (!hasExplicitlyEndedRef.current && activeCallSessionService.hasActiveCall()) {
        console.log("[LIVE SWAP] Modal unmounted while call is active. Decoupling UI and preserving active WebRTC media & signaling in background.");
        activeCallSessionService.markModalDetached();
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
      } else if (hasExplicitlyEndedRef.current && !hasFullCleanedUpRef.current) {
        performFullCleanupRef.current("Explicit end call finalized on unmount", true);
      }
    };
  }, []);

  /**
   * Handle Tab / Window Close Beacon
   */
  useEffect(() => {
    const handleBeforeUnload = () => {
      recordSessionLeaveBeacon(sessionId, currentUserId, false);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [sessionId, currentUserId]);

  /**
   * Monitor Network Switches & App Background -> Foreground Transitions
   */
  useEffect(() => {
    if (!isOpen) return;

    // 1. Network state monitoring (Wi-Fi <-> Cellular, Offline -> Online)
    const unsubNet = mobileNetworkService.onNetworkStatusChange((netStatus) => {
      console.log(`[LIVE SWAP] Network status changed: connected=${netStatus.connected}, type=${netStatus.connectionType}`);
      if (!netStatus.connected) {
        setStatusMessage("Network disconnected. Waiting for connection...");
      } else {
        if (webrtcRef.current) {
          const iceState = webrtcRef.current.getIceConnectionState();
          if (iceState === "disconnected" || iceState === "failed") {
            console.log("[LiveSwap] Network restored with degraded ICE, requesting renegotiation...");
            setStatusMessage("Network restored. Reconnecting…");
            webrtcRef.current.restartIce().catch((err) => {
              console.warn("[LiveSwap] restartIce on network restore failed:", err);
            });
          } else {
            setStatusMessage("Connected");
          }
        }
      }
    });

    // Helper for structured call lifecycle telemetry
    const logCallLifecycleTelemetry = (trigger: string) => {
      console.log(`[CALL_LIFECYCLE] ${trigger}`);
      if (localStreamRef.current) {
        const vt = localStreamRef.current.getVideoTracks()[0];
        if (vt) {
          console.log(`[CALL_LIFECYCLE] LOCAL_VIDEO_TRACK_STATE readyState=${vt.readyState} enabled=${vt.enabled} muted=${vt.muted}`);
        }
        const at = localStreamRef.current.getAudioTracks()[0];
        if (at) {
          console.log(`[CALL_LIFECYCLE] LOCAL_AUDIO_TRACK_STATE readyState=${at.readyState} enabled=${at.enabled} muted=${at.muted}`);
        }
      }
      if (webrtcRef.current) {
        const pc = webrtcRef.current.getPeerConnection();
        if (pc) {
          console.log(`[CALL_LIFECYCLE] PEER_CONNECTION_STATE ${pc.connectionState}`);
          console.log(`[CALL_LIFECYCLE] ICE_CONNECTION_STATE ${pc.iceConnectionState}`);
          console.log(`[CALL_LIFECYCLE] ICE_GATHERING_STATE ${pc.iceGatheringState}`);
          pc.getSenders().forEach((s) => {
            if (s.track) {
              if (s.track.kind === "video") {
                console.log(`[CALL_LIFECYCLE] RTP_SENDER_VIDEO_TRACK readyState=${s.track.readyState} enabled=${s.track.enabled}`);
              } else if (s.track.kind === "audio") {
                console.log(`[CALL_LIFECYCLE] RTP_SENDER_AUDIO_TRACK readyState=${s.track.readyState} enabled=${s.track.enabled}`);
              }
            }
          });
        }
      }
    };

    // 2. Background -> Foreground lifecycle resumption
    const unsubLife = mobileLifecycleService.addAppStateListener((isActive) => {
      console.log(`[LIVE SWAP] App lifecycle transition: isActive=${isActive}`);
      if (!isActive) {
        // SCREEN-OFF / BACKGROUND:
        // Remote audio and video pipeline must continue uninterrupted.
        // DO NOT stop tracks, DO NOT set track.enabled = false, DO NOT destroy WebRTC connection.
        logCallLifecycleTelemetry("APP_BACKGROUND");
        console.log("[LiveSwap] Screen off / app backgrounded. Maintaining active video & audio streams.");
        if (!isNativePip) {
          mobileForegroundService.setLifecycleState("APP_BACKGROUND");
        }
        
        // Ensure local media tracks retain their user-configured enabled state
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((track) => {
            track.enabled = !isVideoMutedRef.current;
          });
          localStreamRef.current.getAudioTracks().forEach((track) => {
            track.enabled = !isAudioMutedRef.current;
          });
        }
        if (remoteAudioRef.current && remoteAudioRef.current.paused) {
          remoteAudioRef.current.play().catch(() => {});
        }
      } else {
        // FOREGROUND / SCREEN-ON:
        logCallLifecycleTelemetry("APP_FOREGROUND");
        if (!isNativePip) {
          mobileForegroundService.setLifecycleState("ACTIVE_CALL_UI_VISIBLE");
        }
        // Re-acquire screen wake lock on foreground
        mobileLifecycleService.acquireCallWakeLock();
        console.log("[CALL_LIFECYCLE] WAKELOCK_ACQUIRED");

        // Restore preserved audio route (speakerphone/earpiece)
        const savedRoute = mobileAudioRoutingService.getCurrentRoute();
        mobileAudioRoutingService.setAudioRoute(savedRoute, remoteAudioRef.current).catch(() => {});

        // Ensure audio element resumes playback if paused by OS during screen off
        if (remoteAudioRef.current && remoteAudioRef.current.paused) {
          remoteAudioRef.current.play().catch(() => {});
        }

        // Ensure video elements resume playback (mobile WebViews pause media when backgrounded)
        if (remoteVideoRef.current && remoteVideoRef.current.paused) {
          remoteVideoRef.current.play().catch(() => {});
        }
        if (localVideoRef.current && localVideoRef.current.paused) {
          localVideoRef.current.play().catch(() => {});
        }

        // Camera recovery: On mobile (iOS / Android), camera hardware may end during screen off.
        // If user was not video-muted, inspect the track and re-acquire if ended.
        if (!isVideoMutedRef.current) {
          const currentVTrack = localStreamRef.current?.getVideoTracks()[0];
          if (!currentVTrack || currentVTrack.readyState === "ended") {
            console.log("[LiveSwap] Local camera track stopped during background, re-acquiring camera...");
            navigator.mediaDevices
              ?.getUserMedia({
                video: {
                  facingMode: webrtcRef.current?.getCurrentFacingMode() || facingModeRef.current || "user",
                  width: { ideal: 1280, max: 1920 },
                  height: { ideal: 720, max: 1080 },
                },
                audio: false,
              })
              .then(async (newCamStream) => {
                const newTrack = newCamStream.getVideoTracks()[0];
                if (!newTrack || !localStreamRef.current) return;
                newTrack.enabled = !isVideoMutedRef.current;

                // Remove ended track and add new track
                localStreamRef.current.getVideoTracks().forEach((t) => {
                  try {
                    localStreamRef.current?.removeTrack(t);
                    t.stop();
                  } catch (_) {}
                });
                localStreamRef.current.addTrack(newTrack);

                if (localVideoRef.current) {
                  localVideoRef.current.srcObject = localStreamRef.current;
                  localVideoRef.current.play().catch(() => {});
                }

                // Seamlessly replace outgoing track on WebRTC without rebuilding connection
                if (webrtcRef.current) {
                  const pc = webrtcRef.current.getPeerConnection();
                  if (pc) {
                    const transceivers = pc.getTransceivers?.() || [];
                    const vTransceiver = transceivers.find(
                      (t) => t.sender?.track?.kind === "video" || t.receiver?.track?.kind === "video"
                    );
                    const vSender = vTransceiver?.sender || pc.getSenders().find((s) => s.track?.kind === "video");
                    if (vSender) {
                      await vSender.replaceTrack(newTrack);
                      console.log("[LiveSwap] Replaced video track on RTCRtpSender after foreground restore");
                    }
                  }
                }
              })
              .catch((err) => {
                console.warn("[LiveSwap] Non-fatal camera re-acquisition on foreground:", err);
              });
          } else {
            currentVTrack.enabled = true;
          }
        }

        // Re-verify network & ICE state
        if (webrtcRef.current) {
          const iceState = webrtcRef.current.getIceConnectionState();
          if (iceState === "disconnected" || iceState === "failed") {
            console.log("[LiveSwap] App foregrounded with degraded ICE, restarting ICE...");
            webrtcRef.current.restartIce().catch(() => {});
          }
        }
      }
    });

    // 3. Screen lock / unlock broadcast listener
    const unsubScreenLock = mobileForegroundService.onScreenLockStateChanged((screenLocked) => {
      logCallLifecycleTelemetry(screenLocked ? "SCREEN_LOCK" : "SCREEN_UNLOCK");
      if (screenLocked) {
        mobileForegroundService.setLifecycleState("SCREEN_LOCKED");
        // Keep video track enabled when device locks
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((track) => {
            track.enabled = !isVideoMutedRef.current;
          });
          localStreamRef.current.getAudioTracks().forEach((track) => {
            track.enabled = !isAudioMutedRef.current;
          });
        }
      } else {
        if (isNativePip) {
          mobileForegroundService.setLifecycleState("ACTIVE_CALL_MINIMIZED");
        } else {
          mobileForegroundService.setLifecycleState("ACTIVE_CALL_UI_VISIBLE");
        }
      }
    });

    // 4. Picture-in-Picture mode change listener
    const unsubPip = mobileForegroundService.onPipModeChanged((inPip) => {
      setIsNativePip(inPip);
      if (inPip) {
        mobileForegroundService.setLifecycleState("ACTIVE_CALL_MINIMIZED");
      } else if (callStageRef.current === "connected" || callStageRef.current === "reconnecting") {
        mobileForegroundService.setLifecycleState("ACTIVE_CALL_UI_VISIBLE");
      }
    });

    return () => {
      unsubNet();
      unsubLife();
      unsubScreenLock();
      unsubPip();
    };
  }, [isOpen]);

  /**
   * Toggle Microphone (Mute / Unmute)
   * Controls ONLY the local audio track without touching connection or renegotiating
   */
  const handleToggleMic = useCallback(() => {
    const nextMuted = !isAudioMutedRef.current;
    isAudioMutedRef.current = nextMuted;
    setIsAudioMuted(nextMuted);

    const audioEnabled = !nextMuted;

    // 1. Control localStream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = audioEnabled;
      });
    }

    // 2. Control webrtcService localStream and RTCRtpSender
    if (webrtcRef.current) {
      webrtcRef.current.setAudioEnabled(audioEnabled);
      const pc = (webrtcRef.current as any).peerConnection as RTCPeerConnection | null;
      if (pc) {
        pc.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === "audio") {
            sender.track.enabled = audioEnabled;
          }
        });
      }
    }

    console.log(`[CONTROL_DEBUG] MIC_TOGGLE: enabled=${audioEnabled}`);
  }, []);

  /**
   * Toggle Camera (Video On / Off)
   * Controls ONLY the local video track without touching connection or renegotiating
   */
  const handleToggleVideo = useCallback(() => {
    const nextVideoMuted = !isVideoMutedRef.current;
    isVideoMutedRef.current = nextVideoMuted;
    setIsVideoMuted(nextVideoMuted);

    const videoEnabled = !nextVideoMuted;

    // 1. Control localStream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = videoEnabled;
      });
    }

    // 2. Control webrtcService localStream and RTCRtpSender
    if (webrtcRef.current) {
      webrtcRef.current.setVideoEnabled(videoEnabled);
      const pc = (webrtcRef.current as any).peerConnection as RTCPeerConnection | null;
      if (pc) {
        pc.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === "video") {
            sender.track.enabled = videoEnabled;
          }
        });
      }
    }

    console.log(`[CONTROL_DEBUG] CAMERA_TOGGLE: enabled=${videoEnabled}`);
  }, []);

  const isSwitchingCameraRef = useRef(false);

  /**
   * Switch Camera (Front <-> Back on Mobile & Desktop)
   * Safely stops previous camera track, opens new facingMode (audio: false), and replaces track on RTCRtpSender
   */
  const handleSwitchCamera = useCallback(async () => {
    if (isSwitchingCameraRef.current) return;
    isSwitchingCameraRef.current = true;

    const nextFacing = facingModeRef.current === "user" ? "environment" : "user";
    const prevFacing = facingModeRef.current;
    facingModeRef.current = nextFacing;
    setFacingMode(nextFacing);

    console.log(
      `[CAMERA_FLIP] Switching from ${prevFacing === "user" ? "front" : "environment"} to ${
        nextFacing === "user" ? "front" : "environment"
      } camera`
    );

    try {
      if (webrtcRef.current) {
        const updatedStream = await webrtcRef.current.switchCamera(nextFacing);
        if (updatedStream) {
          localStreamRef.current = updatedStream;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
            localVideoRef.current.srcObject = updatedStream;
            localVideoRef.current.play().catch(() => {});
          }
        }
      } else if (localStreamRef.current) {
        // Pre-connection preview camera switch
        const oldTracks = localStreamRef.current.getVideoTracks();
        const oldTrack = oldTracks[0] || null;
        const wasVideoEnabled = oldTrack ? oldTrack.enabled : !isVideoMutedRef.current;

        let newCamStream: MediaStream | null = null;
        try {
          newCamStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: nextFacing },
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
            },
            audio: false,
          });
        } catch (_e) {
          // If parallel capture failed, release old track and retry
          if (oldTrack) {
            try {
              localStreamRef.current.removeTrack(oldTrack);
              oldTrack.stop();
            } catch (_) {}
          }
          newCamStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: nextFacing },
            audio: false,
          });
        }

        const newVideoTracks = newCamStream.getVideoTracks();
        const newTrack = newVideoTracks[0];
        if (newTrack && localStreamRef.current) {
          newTrack.enabled = wasVideoEnabled;
          if (oldTrack && oldTrack !== newTrack) {
            try {
              localStreamRef.current.removeTrack(oldTrack);
              oldTrack.stop();
            } catch (_) {}
          }
          localStreamRef.current.addTrack(newTrack);
        }

        // Clean up any surplus tracks
        for (let i = 1; i < newVideoTracks.length; i++) {
          try {
            newVideoTracks[i].stop();
          } catch (_) {}
        }

        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = null;
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.play().catch(() => {});
        }
      }
    } catch (err: any) {
      console.warn("[CAMERA_FLIP] Error switching camera:", err);
      facingModeRef.current = prevFacing;
      setFacingMode(prevFacing);
      setCameraFlipError(err?.message || "Could not switch camera.");
      setTimeout(() => setCameraFlipError(null), 3500);
    } finally {
      isSwitchingCameraRef.current = false;
    }
  }, []);

  /**
   * Speaker On / Off (Earpiece vs Speaker)
   */
  const handleToggleSpeaker = useCallback(async () => {
    const nextSpeakerState = !isSpeakerOn;
    setIsSpeakerOn(nextSpeakerState);
    try {
      await mobileAudioRoutingService.setAudioRoute(
        nextSpeakerState ? "speaker" : "earpiece",
        remoteAudioRef.current
      );
    } catch (e) {
      console.warn("[LiveSwap] Failed to toggle audio route:", e);
    }
  }, [isSpeakerOn]);

  // Ensure presenter screen video element is actively playing when screen sharing begins
  useEffect(() => {
    if (isSharingScreen && presenterScreenVideoRef.current && localScreenStreamRef.current) {
      if (presenterScreenVideoRef.current.srcObject !== localScreenStreamRef.current) {
        presenterScreenVideoRef.current.srcObject = localScreenStreamRef.current;
      }
      presenterScreenVideoRef.current.play().catch(() => {});
    }
  }, [isSharingScreen, localScreenRevision]);

  /**
   * Screen Share with Custom / Canvas Stream (for Live Screen Share Studio)
   */
  const startScreenShareWithStream = useCallback(
    async (stream: MediaStream) => {
      if (!webrtcRef.current) return;
      try {
        console.log("[LiveSwap] Starting screen share with custom stream/studio");
        const screenStream = await webrtcRef.current.startScreenShare(stream, async () => {
          console.log("[LiveSwap] Screen sharing stream ended");
          if (localScreenStreamRef.current) {
            localScreenStreamRef.current.getTracks().forEach((track) => {
              try { track.stop(); } catch (_) {}
            });
            localScreenStreamRef.current = null;
          }
          await mobileForegroundService.setScreenShareState(false);
          setIsSharingScreen(false);
          setIsStudioOpen(false);
          setLocalScreenRevision((prev) => prev + 1);
          if (activeCallIdRef.current) {
            await callSignalingService.setScreenSharing(activeCallIdRef.current, false);
          }
        });

        await mobileForegroundService.setScreenShareState(true);
        localScreenStreamRef.current = screenStream;
        setIsSharingScreen(true);
        setLocalScreenRevision((prev) => prev + 1);

        if (activeCallIdRef.current) {
          await callSignalingService.setScreenSharing(
            activeCallIdRef.current,
            true,
            currentUserId,
            currentUserNameRef.current || currentUserName
          );
        }
      } catch (err: any) {
        console.warn("[LiveSwap] Failed to publish screen share stream:", err);
      }
    },
    [currentUserId, currentUserName]
  );

  const handleStartNativeScreenShare = useCallback(async () => {
    if (!webrtcRef.current) return;

    // PATH 1: Android Native App (Capacitor) - Full Device Screen Capture via MediaProjection
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      try {
        console.log("[LiveSwap] Requesting Android system screen capture prompt...");
        const res = await mobileForegroundService.startNativeScreenCapture();
        if (res && res.success && res.streamUrl) {
          console.log("[LiveSwap] Native screen capture granted, streamUrl:", res.streamUrl);
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = `${res.streamUrl}?t=${Date.now()}`;

          const canvas = document.createElement("canvas");
          canvas.width = res.width || 720;
          canvas.height = res.height || 1280;
          const ctx = canvas.getContext("2d", { alpha: false });
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "medium";
          }

          let isStreaming = true;
          let animFrameId: number;
          let lastDrawTime = 0;
          const renderLoop = (timestamp: number) => {
            if (!isStreaming) return;
            // Throttle to ~30 fps to eliminate CPU heating and frame queues
            if (timestamp - lastDrawTime >= 32) {
              if (img.complete && img.naturalWidth > 0 && ctx) {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                lastDrawTime = timestamp;
              }
            }
            animFrameId = requestAnimationFrame(renderLoop);
          };
          animFrameId = requestAnimationFrame(renderLoop);

          const customStream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
          if (!customStream || customStream.getVideoTracks().length === 0) {
            throw new Error("Could not initialize video track from system screen capture.");
          }
          const capTrack = customStream.getVideoTracks()[0];
          try {
            capTrack.contentHint = "detail";
          } catch (_) {}

          nativeScreenCleanupRef.current = async () => {
            isStreaming = false;
            cancelAnimationFrame(animFrameId);
            img.src = "";
            await mobileForegroundService.stopNativeScreenCapture();
          };

          const screenStream = await webrtcRef.current.startScreenShare(customStream, async () => {
            console.log("[LiveSwap] Native screen sharing ended");
            if (nativeScreenCleanupRef.current) {
              await nativeScreenCleanupRef.current();
              nativeScreenCleanupRef.current = null;
            }
            if (localScreenStreamRef.current) {
              localScreenStreamRef.current.getTracks().forEach((track) => {
                try { track.stop(); } catch (_) {}
              });
              localScreenStreamRef.current = null;
            }
            await mobileForegroundService.setScreenShareState(false);
            setIsSharingScreen(false);
            setLocalScreenRevision((prev) => prev + 1);
            if (activeCallIdRef.current) {
              await callSignalingService.setScreenSharing(activeCallIdRef.current, false);
            }
          });

          await mobileForegroundService.setScreenShareState(true);
          localScreenStreamRef.current = screenStream;
          setIsSharingScreen(true);
          setLocalScreenRevision((prev) => prev + 1);

          if (activeCallIdRef.current) {
            await callSignalingService.setScreenSharing(
              activeCallIdRef.current,
              true,
              currentUserId,
              currentUserNameRef.current || currentUserName
            );
          }
          return;
        }
      } catch (err: any) {
        console.warn("[LiveSwap] Native screen share prompt dismissed or error:", err);
        if (err?.message?.includes("cancelled") || err?.message?.includes("denied") || err?.name === "AbortError") {
          return;
        }
        setScreenShareToast(err?.message || "Screen capture could not be started.");
        setTimeout(() => setScreenShareToast(null), 4000);
        return;
      }
    }

    // PATH 2: Desktop / Standard Web browser with getDisplayMedia
    try {
      const screenStream = await webrtcRef.current.startScreenShare(async () => {
        console.log("[LiveSwap] Screen sharing ended by browser UI");
        if (localScreenStreamRef.current) {
          localScreenStreamRef.current.getTracks().forEach((track) => {
            try { track.stop(); } catch (_) {}
          });
          localScreenStreamRef.current = null;
        }
        await mobileForegroundService.setScreenShareState(false);
        setIsSharingScreen(false);
        setLocalScreenRevision((prev) => prev + 1);
        if (activeCallIdRef.current) {
          await callSignalingService.setScreenSharing(activeCallIdRef.current, false);
        }
      });

      await mobileForegroundService.setScreenShareState(true);
      localScreenStreamRef.current = screenStream;
      setIsSharingScreen(true);
      setLocalScreenRevision((prev) => prev + 1);

      if (activeCallIdRef.current) {
        await callSignalingService.setScreenSharing(
          activeCallIdRef.current,
          true,
          currentUserId,
          currentUserNameRef.current || currentUserName
        );
      }
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "AbortError" || err?.message?.includes("Permission denied")) {
        console.log("[LiveSwap] Screen share permission cancelled or dismissed by user");
      } else {
        console.warn("[LiveSwap] Screen share failed:", err);
        const isMobileOrTablet =
          typeof navigator !== "undefined" &&
          /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobileOrTablet) {
          setScreenShareToast("For full device screen sharing on mobile, open the SwapSkill Android app.");
        } else {
          setScreenShareToast(err?.message || "Could not start screen sharing.");
        }
        setTimeout(() => setScreenShareToast(null), 5000);
      }
    }
  }, [currentUserId, currentUserName]);

  /**
   * Screen Share Toggle Handler (Zoom / Meet tech-giant quality)
   * Captures desktop or mobile display directly in the immediate user tap gesture
   */
  const handleToggleScreenShare = useCallback(async () => {
    triggerHapticFeedback("medium");
    if (!webrtcRef.current) {
      setScreenShareToast("Call is not connected yet.");
      setTimeout(() => setScreenShareToast(null), 3000);
      return;
    }

    if (isSharingScreen) {
      try {
        if (nativeScreenCleanupRef.current) {
          await nativeScreenCleanupRef.current();
          nativeScreenCleanupRef.current = null;
        }
        if (localScreenStreamRef.current) {
          localScreenStreamRef.current.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch (_) {}
          });
          localScreenStreamRef.current = null;
        }
        await webrtcRef.current.stopScreenShare();
        await mobileForegroundService.setScreenShareState(false);
        setIsSharingScreen(false);
        setIsStudioOpen(false);
        setLocalScreenRevision((prev) => prev + 1);
        if (activeCallIdRef.current) {
          await callSignalingService.setScreenSharing(activeCallIdRef.current, false);
        }
      } catch (err) {
        console.warn("[LiveSwap] Error stopping screen share:", err);
      }
    } else {
      // Trigger native screen sharing directly in this immediate user tap gesture
      await handleStartNativeScreenShare();
    }
  }, [isSharingScreen, handleStartNativeScreenShare]);

  /**
   * Mobile Multi-Touch Pinch-to-Zoom, Double-Tap, and Desktop Pan Handlers
   */
  const clampScreenPan = useCallback((x: number, y: number, zoom: number) => {
    if (zoom <= 1) return { x: 0, y: 0 };
    const maxX = (zoom - 1) * 240;
    const maxY = (zoom - 1) * 360;
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  const handleScreenTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        // 2-finger pinch start
        touchPinchRef.current.isPinching = true;
        touchPinchRef.current.hasPannedOrPinched = true;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        touchPinchRef.current.initialDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        touchPinchRef.current.initialZoom = screenZoomLevel;
      } else if (e.touches.length === 1) {
        touchPinchRef.current.isPinching = false;
        const now = Date.now();
        // Double-tap to zoom (1x <-> 2.2x)
        if (now - touchPinchRef.current.lastTapTime < 300) {
          touchPinchRef.current.hasPannedOrPinched = true;
          triggerHapticFeedback("medium");
          setScreenZoomLevel((prev) => {
            if (prev > 1.2) {
              setScreenPan({ x: 0, y: 0 });
              return 1;
            } else {
              return 2.2;
            }
          });
          touchPinchRef.current.lastTapTime = 0;
          return;
        }
        touchPinchRef.current.lastTapTime = now;

        if (screenZoomLevel > 1) {
          touchPinchRef.current.panStart = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            initPanX: screenPan.x,
            initPanY: screenPan.y,
          };
        }
      }
    },
    [screenZoomLevel, screenPan]
  );

  const handleScreenTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && touchPinchRef.current.isPinching) {
        touchPinchRef.current.hasPannedOrPinched = true;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        if (touchPinchRef.current.initialDist > 0) {
          const factor = dist / touchPinchRef.current.initialDist;
          const nextZoom = Math.min(3.5, Math.max(1, +(touchPinchRef.current.initialZoom * factor).toFixed(2)));
          setScreenZoomLevel(nextZoom);
          if (nextZoom === 1) {
            setScreenPan({ x: 0, y: 0 });
          }
        }
      } else if (e.touches.length === 1 && screenZoomLevel > 1) {
        touchPinchRef.current.hasPannedOrPinched = true;
        const dx = e.touches[0].clientX - touchPinchRef.current.panStart.x;
        const dy = e.touches[0].clientY - touchPinchRef.current.panStart.y;
        const nextX = touchPinchRef.current.panStart.initPanX + dx / screenZoomLevel;
        const nextY = touchPinchRef.current.panStart.initPanY + dy / screenZoomLevel;
        setScreenPan(clampScreenPan(nextX, nextY, screenZoomLevel));
      }
    },
    [screenZoomLevel, clampScreenPan]
  );

  const handleScreenTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      touchPinchRef.current.isPinching = false;
    }
  }, []);

  const handleScreenWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!isRemoteSharingScreen) return;
      e.preventDefault();
      setScreenZoomLevel((prev) => {
        const delta = e.deltaY < 0 ? 0.25 : -0.25;
        const next = Math.min(3.5, Math.max(1, +(prev + delta).toFixed(2)));
        if (next === 1) {
          setScreenPan({ x: 0, y: 0 });
        }
        return next;
      });
    },
    [isRemoteSharingScreen]
  );

  const handleScreenPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (screenZoomLevel <= 1 || e.pointerType === "touch") return;
      isPanningScreenRef.current = true;
      touchPinchRef.current.hasPannedOrPinched = true;
      screenPanStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        initPanX: screenPan.x,
        initPanY: screenPan.y,
      };
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch (_) {}
    },
    [screenZoomLevel, screenPan]
  );

  const handleScreenPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningScreenRef.current || screenZoomLevel <= 1 || e.pointerType === "touch") return;
      touchPinchRef.current.hasPannedOrPinched = true;
      const dx = e.clientX - screenPanStartRef.current.x;
      const dy = e.clientY - screenPanStartRef.current.y;
      const nextX = screenPanStartRef.current.initPanX + dx / screenZoomLevel;
      const nextY = screenPanStartRef.current.initPanY + dy / screenZoomLevel;
      setScreenPan(clampScreenPan(nextX, nextY, screenZoomLevel));
    },
    [screenZoomLevel, clampScreenPan]
  );

  const handleScreenPointerUp = useCallback((e: React.PointerEvent) => {
    if (isPanningScreenRef.current) {
      isPanningScreenRef.current = false;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    try {
      if (!document.fullscreenElement) {
        theaterStageRef.current?.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    } catch (_) {}
  }, []);

  /**
   * Pointer Move Handler for Interactive Screen Share Laser Pointer
   */
  const handleLaserPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isLaserPointerActive) return;
      const stage = theaterStageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setLocalLaser({ x, y });

      const now = Date.now();
      if (now - lastLaserSentRef.current > 60 && activeCallIdRef.current) {
        lastLaserSentRef.current = now;
        callSignalingService.updateLaserPointer(activeCallIdRef.current, { x, y }, currentUserId);
      }
    },
    [isLaserPointerActive, currentUserId]
  );

  /**
   * Pointer Drag Handlers for Movable PiP Preview
   */
  const handlePipPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;

    const rect = e.currentTarget.getBoundingClientRect();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: rect.left,
      initY: rect.top,
    };
    isDraggingPipRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handlePipPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingPipRef.current) return;
    const deltaX = e.clientX - dragStartRef.current.startX;
    const deltaY = e.clientY - dragStartRef.current.startY;

    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width || 120;
    const height = rect.height || 160;
    const minX = 8;
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const minY = 8;
    const maxY = Math.max(8, window.innerHeight - height - 90);

    const clampedX = Math.min(Math.max(minX, dragStartRef.current.initX + deltaX), maxX);
    const clampedY = Math.min(Math.max(minY, dragStartRef.current.initY + deltaY), maxY);

    setPipPosition({ x: clampedX, y: clampedY });
  };

  const handlePipPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingPipRef.current) {
      isDraggingPipRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
  };

  const handleUserInteraction = useCallback(() => {
    if (remoteAudioRef.current && remoteStreamRef.current) {
      if (remoteAudioRef.current.paused) {
        remoteAudioRef.current.play().catch(() => {});
      }
    }
  }, []);

  const activeRemoteStream = remoteStreamRef.current || activeCallSessionService.getActiveSession()?.remoteStream;
  const isRemoteVideoActive =
    (callStage === "connected" || callStage === "reconnecting" || callStage === "waiting" || callStage === "calling") &&
    (hasRemoteVideo ||
      Boolean(activeRemoteStream?.getVideoTracks().some((t) => t.readyState !== "ended")));

  const modalContent = (
    <>
      {/* Audio Element for Remote Incoming Audio */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        className="fixed -top-[9999px] -left-[9999px] opacity-0 pointer-events-none w-px h-px"
      />

      {/* FULL-SCREEN LIVE SWAP CALL INTERFACE */}
      <div
        id="webrtc-liveswap-modal"
        onClick={handleScreenTap}
        onPointerDown={handleUserInteraction}
        className={`fixed inset-0 z-50 w-screen h-screen min-h-[100dvh] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/90 via-[#0A0D14] to-[#040507] text-white flex-col justify-between select-none overflow-hidden cursor-pointer ${
          isMinimized ? "hidden" : "flex"
        } ${isNativePip ? "p-0" : ""}`}
        style={
          isNativePip
            ? { height: "100%", width: "100%", padding: 0 }
            : {
                height: "100%",
                paddingTop: "env(safe-area-inset-top, 0px)",
                paddingLeft: "env(safe-area-inset-left, 0px)",
                paddingRight: "env(safe-area-inset-right, 0px)",
              }
        }
      >
        {/* ========================================================================= */}
        {/* 1. TOP BAR (Apple FaceTime / Google Meet Style Floating Island)          */}
        {/* ========================================================================= */}
        <header
          className={`relative z-30 w-full px-3 xs:px-4 sm:px-6 pt-3 sm:pt-4 flex items-center justify-between shrink-0 pointer-events-none transition-all duration-300 ease-out ${
            areControlsVisible
              ? "translate-y-0 opacity-100"
              : "-translate-y-12 opacity-0"
          } ${isNativePip ? "hidden" : ""}`}
        >
          {/* Left: Minimize & Partner Information Capsule */}
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-2xl border border-white/10 rounded-full px-2.5 py-1.5 shadow-2xl pointer-events-auto">
            <button
              type="button"
              id="btn-minimize-live-swap"
              onClick={() => {
                triggerHapticFeedback("light");
                setIsMinimized(true);
              }}
              className="w-7 h-7 xs:w-8 xs:h-8 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white/90 hover:text-white flex items-center justify-center transition border border-white/10 backdrop-blur-md cursor-pointer shrink-0"
              title="Minimize Call (Floating PiP)"
              aria-label="Minimize Call"
            >
              <ChevronDown className="w-4 h-4 stroke-[2.5]" />
            </button>

            <div className="relative shrink-0">
              <img
                src={partnerDisplayPhoto || DEFAULT_AVATAR}
                alt={partnerDisplayName}
                className="w-7 h-7 xs:w-8 xs:h-8 rounded-full object-cover ring-1.5 ring-white/20 shadow-md"
                referrerPolicy="no-referrer"
              />
              <span
                className={`absolute bottom-0 right-0 w-2 h-2 rounded-full ring-1 ring-black ${
                  callStage === "connected"
                    ? "bg-emerald-400 animate-pulse"
                    : callStage === "reconnecting"
                    ? "bg-amber-400 animate-pulse"
                    : participantCount >= 2
                    ? "bg-sky-400 animate-ping"
                    : "bg-zinc-500"
                }`}
              />
            </div>

            <div className="flex flex-col min-w-0 pr-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs xs:text-sm font-bold text-white tracking-tight truncate max-w-[100px] xs:max-w-[140px] sm:max-w-[200px]">
                  {partnerName}
                </span>
                {skillName && (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20 truncate max-w-[130px]">
                    <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                    <span className="truncate">{skillName}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-white/60">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                    callStage === "connected"
                      ? "bg-emerald-400"
                      : callStage === "failed"
                      ? "bg-rose-500"
                      : callStage === "reconnecting"
                      ? "bg-amber-400 animate-pulse"
                      : "bg-sky-400 animate-pulse"
                  }`}
                />
                <span className="capitalize truncate max-w-[100px] xs:max-w-[140px]">{statusMessage}</span>
              </div>
            </div>
          </div>

          {/* Right: Picture-in-Picture, Timer & LIVE Badge Capsule */}
          <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-2xl border border-white/10 rounded-full px-2.5 py-1.5 shadow-2xl pointer-events-auto">
            {nativePipSupported && (
              <button
                type="button"
                id="btn-enter-native-pip"
                onClick={() => mobileForegroundService.enterPipMode()}
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition cursor-pointer"
                title="Picture in picture"
                aria-label="Picture in picture"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            )}

            <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 text-white/80 text-[10px] font-medium border border-white/10">
              <Users className="w-3 h-3 text-amber-400" />
              <span>{participantCount}/2</span>
            </div>

            {/* Speaking indicator */}
            {isRemoteSpeaking && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-bold border border-sky-400/30 animate-pulse">
                <Radio className="w-2.5 h-2.5 animate-spin" />
                <span className="hidden xs:inline">Speaking</span>
              </div>
            )}

            {/* Quality & Health HUD Pill */}
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback("light");
                setIsQualityStatsOpen(true);
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-emerald-400 text-[10px] font-bold border border-emerald-400/30 shadow-sm transition cursor-pointer"
              title="Call Health & Diagnostics"
            >
              <Activity className="w-3 h-3" />
              <span className="font-mono">1080p HD</span>
            </button>

            {/* Timer Pill */}
            {(callStage === "connected" || callStage === "reconnecting") && (
              <div
                id="live-swap-timer-badge"
                className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 shadow-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="text-[11px] font-mono font-semibold tracking-wider">{formattedDuration}</span>
              </div>
            )}

            {/* LIVE status indicator */}
            {isLiveActive && (
              <div
                id="live-swap-status-badge"
                className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 shadow-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="text-[10px] font-bold tracking-wider">LIVE</span>
              </div>
            )}
          </div>
        </header>

      {/* ========================================================================= */}
      {/* 2. MAIN STAGE (Remote User Full-Screen Video & Educational Screen Share)  */}
      {/* ========================================================================= */}
      {(() => {
        const isScreenShareActive = isSharingScreen || isRemoteSharingScreen;
        const isRemoteVideoActive =
          (callStage === "connected" || callStage === "reconnecting") &&
          (hasRemoteVideo ||
            Boolean(remoteStreamRef.current?.getVideoTracks().some((t) => t.enabled && t.readyState === "live"))) &&
          isRemoteVideoPlaying;

        return (
          <div
            ref={theaterStageRef}
            onPointerMove={handleLaserPointerMove}
            className="relative flex-1 w-full h-full min-h-0 flex items-center justify-center overflow-hidden bg-black select-none"
          >
            {/* Screen Share / Remote Video Stage (Full-screen, persistent mounting, never unmounted to prevent black screen) */}
            <div
              className={`absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden transition-colors duration-300 ${
                isScreenShareActive ? "bg-[#07090E]" : "bg-black"
              }`}
            >
              <video
                ref={remoteVideoRef}
                poster={BLACK_POSTER}
                autoPlay
                playsInline
                muted={true}
                // @ts-ignore
                webkit-playsinline="true"
                x5-playsinline="true"
                controls={false}
                disablePictureInPicture
                onPlaying={() => setIsRemoteVideoPlaying(true)}
                onLoadedData={() => setIsRemoteVideoPlaying(true)}
                onTouchStart={handleScreenTouchStart}
                onTouchMove={handleScreenTouchMove}
                onTouchEnd={handleScreenTouchEnd}
                onWheel={handleScreenWheel}
                onPointerDown={handleScreenPointerDown}
                onPointerMove={handleScreenPointerMove}
                onPointerUp={handleScreenPointerUp}
                style={{
                  transform: isRemoteSharingScreen
                    ? `${isLandscapeTheater ? "rotate(90deg) " : ""}scale(${screenZoomLevel}) translate(${screenPan.x}px, ${screenPan.y}px)`
                    : undefined,
                  transformOrigin: "center center",
                  imageRendering: isRemoteSharingScreen ? "-webkit-optimize-contrast" : "auto",
                  touchAction: isRemoteSharingScreen ? "none" : "auto",
                }}
                className={`transition-all duration-150 select-none ${
                  isRemoteSharingScreen
                    ? screenFitMode === "contain"
                      ? "max-w-full max-h-full w-auto h-auto object-contain mx-auto my-auto shadow-2xl cursor-grab active:cursor-grabbing"
                      : "w-full h-full object-cover"
                    : "w-full h-full object-cover"
                } ${isRemoteVideoActive ? "opacity-100" : "opacity-0"}`}
              />
            </div>

            {/* Google Meet / Zoom Style Top Screen Share Pill for Presenter */}
            {isSharingScreen && (
              <div className="absolute top-16 sm:top-20 z-30 flex items-center gap-2.5 px-4 py-2 rounded-full bg-emerald-950/90 backdrop-blur-xl border border-emerald-500/40 text-emerald-200 shadow-[0_10px_30px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in-95">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0 ring-4 ring-emerald-500/30" />
                <span className="text-xs sm:text-sm font-semibold tracking-wide">You're sharing your screen</span>
                <button
                  type="button"
                  onClick={handleToggleScreenShare}
                  className="ml-1.5 px-3 py-1 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold transition cursor-pointer shadow-md shadow-rose-600/30"
                >
                  Stop Sharing
                </button>
              </div>
            )}

            {isRemoteSharingScreen && (
              <div className="absolute top-16 sm:top-20 z-30 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 rounded-full bg-slate-950/85 backdrop-blur-md border border-white/20 text-white shadow-2xl animate-in fade-in zoom-in-95 max-w-[96%] overflow-x-auto scrollbar-none">
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span className="text-xs sm:text-sm font-semibold truncate max-w-[120px] xs:max-w-[160px]">
                    {screenSharingPresenterName || partnerName}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-400/30 shrink-0">
                    1080p HD
                  </span>
                </div>

                {/* Tech-Giant Zoom / Pan pill for reading small code & presentation slides */}
                <div className="flex items-center gap-1 ml-1.5 border-l border-white/20 pl-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setScreenZoomLevel((prev) => {
                        const next = Math.max(1, +(prev - 0.25).toFixed(2));
                        if (next === 1) setScreenPan({ x: 0, y: 0 });
                        return next;
                      });
                    }}
                    className="p-1 rounded-full hover:bg-white/20 active:scale-90 text-white transition cursor-pointer"
                    title="Zoom out"
                    aria-label="Zoom out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] font-mono text-white/90 min-w-[34px] text-center font-bold">
                    {Math.round(screenZoomLevel * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setScreenZoomLevel((prev) => Math.min(3, +(prev + 0.25).toFixed(2)))}
                    className="p-1 rounded-full hover:bg-white/20 active:scale-90 text-white transition cursor-pointer"
                    title="Zoom in"
                    aria-label="Zoom in"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  {(screenZoomLevel !== 1 || screenPan.x !== 0 || screenPan.y !== 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setScreenZoomLevel(1);
                        setScreenPan({ x: 0, y: 0 });
                      }}
                      className="p-1 rounded-full hover:bg-white/20 active:scale-90 text-white/70 hover:text-white transition cursor-pointer ml-0.5"
                      title="Reset 100%"
                      aria-label="Reset zoom"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setScreenFitMode((prev) => (prev === "contain" ? "cover" : "contain"))}
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white/90 transition ml-1 cursor-pointer"
                    title={screenFitMode === "contain" ? "Fit Entire Screen (100% visible)" : "Fill Screen (Cropped)"}
                  >
                    {screenFitMode === "contain" ? "Fit" : "Fill"}
                  </button>

                  {/* Mobile Landscape Rotate Button */}
                  <button
                    type="button"
                    onClick={() => setIsLandscapeTheater((prev) => !prev)}
                    className={`p-1 rounded-full transition cursor-pointer sm:hidden ${
                      isLandscapeTheater ? "bg-amber-400/30 text-amber-300" : "hover:bg-white/20 text-white/80 hover:text-white"
                    }`}
                    title="Rotate landscape view"
                    aria-label="Rotate landscape view"
                  >
                    <Smartphone className={`w-3.5 h-3.5 ${isLandscapeTheater ? "rotate-90 text-amber-300" : ""}`} />
                  </button>

                  {/* Laser Pointer Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsLaserPointerActive((prev) => !prev);
                      if (!isLaserPointerActive) {
                        playSynthChime("pop");
                      } else {
                        setLocalLaser(null);
                        if (activeCallIdRef.current) {
                          callSignalingService.updateLaserPointer(activeCallIdRef.current, null, currentUserId);
                        }
                      }
                    }}
                    className={`p-1 rounded-full transition cursor-pointer ${
                      isLaserPointerActive
                        ? "bg-rose-500 text-white shadow-[0_0_12px_#f43f5e]"
                        : "hover:bg-white/20 text-white/80 hover:text-white"
                    }`}
                    title={isLaserPointerActive ? "Turn off Laser Pointer" : "Turn on Laser Pointer"}
                    aria-label="Laser Pointer"
                  >
                    <Zap className="w-3.5 h-3.5" />
                  </button>

                  {/* Fullscreen Button */}
                  <button
                    type="button"
                    onClick={handleToggleFullscreen}
                    className="p-1 rounded-full hover:bg-white/20 active:scale-90 text-white/80 hover:text-white transition cursor-pointer"
                    title="Toggle Fullscreen"
                    aria-label="Toggle fullscreen"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Interactive Laser Pointer (Local & Remote) */}
            {isLaserPointerActive && localLaser && (
              <div
                style={{ left: `${localLaser.x * 100}%`, top: `${localLaser.y * 100}%` }}
                className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 z-40 flex items-center gap-1.5"
              >
                <div className="relative flex items-center justify-center">
                  <span className="w-5 h-5 rounded-full bg-rose-500/40 animate-ping absolute" />
                  <span className="w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-white shadow-[0_0_15px_#f43f5e]" />
                </div>
                <span className="px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[9px] font-bold text-rose-300 border border-rose-500/40 shadow-lg whitespace-nowrap">
                  Laser (You)
                </span>
              </div>
            )}

            {remoteLaser && (
              <div
                style={{ left: `${remoteLaser.x * 100}%`, top: `${remoteLaser.y * 100}%` }}
                className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 z-40 flex items-center gap-1.5 transition-all duration-75"
              >
                <div className="relative flex items-center justify-center">
                  <span className="w-5 h-5 rounded-full bg-sky-400/40 animate-ping absolute" />
                  <span className="w-3.5 h-3.5 rounded-full bg-sky-400 border-2 border-white shadow-[0_0_15px_#38bdf8]" />
                </div>
                <span className="px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[9px] font-bold text-sky-300 border border-sky-400/40 shadow-lg whitespace-nowrap">
                  {remoteLaser.senderName || partnerName}
                </span>
              </div>
            )}

            {/* Hand Raised Alert Banner */}
            {(isHandRaised || partnerHandRaised) && (
              <div className="absolute top-16 sm:top-20 z-40 flex items-center gap-2 px-3.5 sm:px-4 py-1.5 rounded-full bg-amber-950/90 backdrop-blur-md border border-amber-400/40 text-amber-300 shadow-2xl animate-in fade-in slide-in-from-top-2">
                <span className="text-sm">✋</span>
                <span className="text-xs sm:text-sm font-bold tracking-wide">
                  {isHandRaised ? "You raised hand" : `${partnerHandRaised} raised hand`}
                </span>
                {isHandRaised && (
                  <button
                    type="button"
                    onClick={handleToggleRaiseHand}
                    className="ml-1.5 px-2 py-0.5 rounded-full bg-amber-500/30 hover:bg-amber-500/50 text-amber-200 text-[10px] font-bold transition cursor-pointer"
                  >
                    Lower
                  </button>
                )}
              </div>
            )}

            {/* Native Android PiP Floating Overlay Badge */}
            {isNativePip && (
              <div className="absolute top-2 left-2 z-50 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white text-[10px] font-medium shadow-md pointer-events-none select-none">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="font-semibold tracking-wide">SwapSkill</span>
                {(callStage === "connected" || callStage === "reconnecting") && (
                  <span className="text-white/80 font-mono text-[9px]">· {formattedDuration}</span>
                )}
              </div>
            )}

            {/* Tech-Giant Luxury Center Calling / Ringing UI */}
            {!isRemoteVideoActive && !isSharingScreen && (
              <div
                className={`flex flex-col items-center justify-center text-center z-10 max-w-sm max-h-full overflow-y-auto ${
                  isNativePip ? "scale-75 p-2" : "px-4 py-6"
                }`}
              >
                <div className="relative mb-5 sm:mb-7 flex items-center justify-center">
                  {(callStage === "calling" ||
                    callStage === "ringing" ||
                    callStage === "waiting" ||
                    callStage === "connecting") && (
                    <>
                      <div className="absolute w-32 h-32 xs:w-40 xs:h-40 sm:w-48 sm:h-48 rounded-full border border-sky-400/30 bg-sky-500/10 animate-ping pointer-events-none" />
                      <div className="absolute w-44 h-44 xs:w-52 xs:h-52 sm:w-64 sm:h-64 rounded-full border border-sky-400/15 bg-sky-500/5 animate-pulse pointer-events-none" />
                    </>
                  )}

                  <div
                    className={`relative p-1 rounded-full transition-all duration-300 ${
                      isRemoteSpeaking
                        ? "ring-4 ring-emerald-400 shadow-[0_0_35px_rgba(52,211,153,0.7)] animate-pulse"
                        : "bg-gradient-to-tr from-sky-500/40 via-amber-400/30 to-emerald-400/40"
                    } shadow-2xl`}
                  >
                    <img
                      src={partnerDisplayPhoto || DEFAULT_AVATAR}
                      alt={partnerDisplayName}
                      className="relative w-24 h-24 xs:w-28 xs:h-28 sm:w-36 sm:h-36 rounded-full object-cover ring-4 ring-black/80 shadow-2xl z-10"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>

                <h3 className="text-xl xs:text-2xl sm:text-3xl font-extrabold text-white mb-1.5 tracking-tight truncate max-w-xs drop-shadow-md">
                  {partnerDisplayName}
                </h3>

                {skillName ? (
                  <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-amber-300 bg-amber-400/10 px-3.5 py-1 rounded-full border border-amber-400/25 mb-4 shadow-sm truncate max-w-[280px]">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">{skillName}</span>
                  </span>
                ) : (
                  <span className="text-xs sm:text-sm text-white/50 mb-4 font-medium tracking-wide">Live Swap Session</span>
                )}

                {/* Status Label (Calling / Ringing / Connecting / Reconnecting - NEVER shown when connected) */}
                {callStage !== "connected" && (
                  <div className="flex items-center justify-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-xl border border-white/15 text-xs xs:text-sm text-white/90 font-medium shadow-lg shadow-black/20">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        callStage === "failed"
                          ? "bg-rose-500"
                          : callStage === "reconnecting"
                          ? "bg-amber-400 animate-pulse"
                          : "bg-sky-400 animate-pulse"
                      }`}
                    />
                    <span className="truncate max-w-[220px] font-medium">{statusMessage}</span>
                  </div>
                )}

            {/* In Connected or Reconnecting State without remote video, show duration timer prominently */}
            {(callStage === "connected" || callStage === "reconnecting") && (
              <div 
                id="connected-call-duration-timer"
                className="px-4 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/35 text-emerald-300 font-mono text-sm sm:text-base tracking-widest font-semibold flex items-center gap-2 shadow-lg shadow-emerald-500/10"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span>{formattedDuration}</span>
              </div>
            )}

            {/* Error Display & Retry */}
            {errorMessage && (
              <div className="mt-3 sm:mt-4 p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 text-xs flex flex-col items-center gap-2 max-w-xs">
                <div className="flex items-center gap-1.5 text-center">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setErrorMessage(null);
                    setCallStage("initiating");
                    setStatusMessage("Requesting camera & microphone access...");
                    cleanupActiveCall("User clicked retry");
                    const stream = await acquireLocalMedia();
                    if (stream && stream.active) {
                      joinLiveSession(sessionId, currentUserId);
                      if (incomingCallId) {
                        hasInitiatedRef.current = true;
                        activeCallIdRef.current = incomingCallId;
                        isNegotiatingRef.current = true;
                        startAnswererWorkflow(incomingCallId, stream);
                      } else if (isCaller) {
                        hasInitiatedRef.current = true;
                        const newCallId = generateUniqueCallId(sessionId);
                        activeCallIdRef.current = newCallId;
                        isNegotiatingRef.current = true;
                        updateDoc(doc(db, "sessions", sessionId), {
                          currentCallId: newCallId,
                          callUpdatedAt: serverTimestamp(),
                        }).catch(() => {});
                        startOffererWorkflow(newCallId, stream);
                      } else {
                        setCallStage("waiting");
                        setStatusMessage(`Waiting for ${partnerNameRef.current} to join...`);
                      }
                    }
                  }}
                  className="px-3 py-1 bg-rose-500 hover:bg-rose-600 active:scale-95 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry Permission & Connect
                </button>
              </div>
            )}
          </div>
        )}

        {/* Floating PiP (Local / Partner Camera Preview with Clean Minimize Toggle) */}
        {isPiPMinimized ? (
          <button
            type="button"
            onClick={() => setIsPiPMinimized(false)}
            className="absolute top-3 right-3 sm:top-5 sm:right-5 z-40 px-2.5 py-1.5 rounded-full bg-zinc-900/90 border border-white/20 text-white shadow-2xl flex items-center gap-1.5 text-xs font-semibold backdrop-blur-md hover:bg-zinc-800 transition active:scale-95 cursor-pointer select-none"
            title="Expand camera preview"
          >
            <img
              src={(isSharingScreen ? partnerDisplayPhoto : currentDisplayPhoto) || DEFAULT_AVATAR}
              alt="Preview"
              className="w-5 h-5 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
            <span className="text-[11px] font-medium">Camera</span>
            <ChevronDown className="w-3.5 h-3.5 rotate-180 text-white/70" />
          </button>
        ) : (
          <div
            id="local-pip-preview"
            onPointerDown={handlePipPointerDown}
            onPointerMove={handlePipPointerMove}
            onPointerUp={handlePipPointerUp}
            style={
              pipPosition
                ? { left: `${pipPosition.x}px`, top: `${pipPosition.y}px`, right: "auto" }
                : undefined
            }
            className={`absolute ${
              isNativePip ? "hidden" : ""
            } ${
              pipPosition ? "" : "top-3 right-3 sm:top-5 sm:right-5"
            } w-24 h-36 xs:w-28 xs:h-40 sm:w-36 sm:h-52 rounded-2xl overflow-hidden border-2 ${
              (isSharingScreen ? isRemoteSpeaking : isLocalSpeaking)
                ? "border-emerald-400 ring-4 ring-emerald-400/40 shadow-[0_0_25px_rgba(52,211,153,0.5)]"
                : "border-white/20"
            } shadow-2xl z-40 bg-zinc-900/95 backdrop-blur-md flex items-center justify-center cursor-grab active:cursor-grabbing select-none touch-none transition-all duration-200`}
          >
            {/* Quick minimize PiP button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsPiPMinimized(true);
              }}
              className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 hover:bg-black/90 active:scale-90 text-white/80 hover:text-white transition z-50 cursor-pointer"
              title="Minimize camera preview"
              aria-label="Minimize preview"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          {/* Video in PiP: When presenting screen, show partner's remote video if available; otherwise show local camera */}
          <video
            ref={(el) => {
              if (!el) return;
              if (isSharingScreen && hasRemoteVideo && remoteStreamRef.current) {
                if (el.srcObject !== remoteStreamRef.current) {
                  el.srcObject = remoteStreamRef.current;
                  el.play().catch(() => {});
                }
              } else {
                localVideoRef.current = el;
                if (localStreamRef.current && el.srcObject !== localStreamRef.current) {
                  el.srcObject = localStreamRef.current;
                  el.play().catch(() => {});
                }
              }
            }}
            poster={BLACK_POSTER}
            autoPlay
            playsInline
            muted
            // @ts-ignore
            webkit-playsinline="true"
            x5-playsinline="true"
            controls={false}
            disablePictureInPicture
            onPlaying={() => setIsLocalVideoPlaying(true)}
            onLoadedData={() => setIsLocalVideoPlaying(true)}
            className={`w-full h-full object-cover pointer-events-none transition-opacity duration-200 ${
              !isSharingScreen && facingMode === "user" ? "-scale-x-100" : ""
            } ${(!isSharingScreen && isVideoMuted) || (isSharingScreen && !hasRemoteVideo) ? "hidden" : "block"} ${
              isLocalVideoPlaying || (isSharingScreen && isRemoteVideoPlaying) ? "opacity-100" : "opacity-0"
            }`}
          />

          {/* Fallback Avatar if Local Camera is Off */}
          {((!isSharingScreen && isVideoMuted) || (isSharingScreen && !hasRemoteVideo)) && (
            <div className="flex flex-col items-center justify-center gap-1 p-2 text-center pointer-events-none">
              <img
                src={(isSharingScreen ? partnerDisplayPhoto : currentDisplayPhoto) || DEFAULT_AVATAR}
                alt={isSharingScreen ? partnerDisplayName : currentDisplayName}
                className="w-10 h-10 xs:w-12 xs:h-12 rounded-full object-cover border border-white/20 shadow-md"
                referrerPolicy="no-referrer"
              />
              <span className="text-[10px] text-white/70 font-semibold">
                {isSharingScreen ? "Partner Camera Off" : "Camera Off"}
              </span>
            </div>
          )}

          {/* Local User Label Badge */}
          <div className="absolute bottom-1.5 left-1.5 px-1.5 xs:px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-xs text-[9px] xs:text-[10px] font-medium text-white/90 border border-white/10 pointer-events-none truncate max-w-[70%]">
            You {isAudioMuted && "• Muted"}
          </div>

          {/* Quick Tap Camera Switch Overlay on PiP */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSwitchCamera();
            }}
            className="absolute top-1.5 left-1.5 p-1 rounded-full bg-black/60 hover:bg-black/80 active:scale-90 text-white/90 border border-white/15 transition cursor-pointer"
            title="Flip camera"
            aria-label="Flip camera"
          >
            <SwitchCamera className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      </div>
    );
    })()}

      {/* Toast Banner for Camera Flip Warning / Error */}
      {cameraFlipError && (
        <div className="absolute bottom-24 sm:bottom-28 z-40 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-rose-600/90 backdrop-blur-md text-white text-xs font-medium shadow-xl border border-white/20 flex items-center gap-1.5 pointer-events-none animate-bounce">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{cameraFlipError}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. BOTTOM CONTROLS DOCK (Google Meet / Zoom Tech-Giant Glassmorphism Dock) */}
      {/* ========================================================================= */}
      <footer
        className={`relative z-30 w-full px-3 xs:px-4 sm:px-6 py-3 sm:py-5 flex flex-col items-center justify-center shrink-0 transition-all duration-300 ease-out pb-[max(1.25rem,env(safe-area-inset-bottom,20px))] ${
          areControlsVisible
            ? "translate-y-0 opacity-100 pointer-events-auto"
            : "translate-y-16 opacity-0 pointer-events-none"
        } ${isNativePip ? "hidden" : ""}`}
      >
        {/* Mobile Slide-Up More Actions Sheet */}
        <AnimatePresence>
          {isMoreActionsOpen && (
            <motion.div
              id="more-actions-sheet"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="sm:hidden absolute bottom-24 z-50 w-[92%] max-w-sm rounded-3xl bg-zinc-950/95 backdrop-blur-2xl border border-white/15 p-4 shadow-[0_25px_60px_rgba(0,0,0,0.9)] ring-1 ring-white/10"
            >
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
                <span className="text-xs font-bold text-white/90 uppercase tracking-wider">Meeting Controls</span>
                <button
                  type="button"
                  onClick={() => setIsMoreActionsOpen(false)}
                  className="p-1 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition cursor-pointer"
                  aria-label="Close controls"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Quick Emojis Row in Sheet */}
              <div className="flex items-center justify-between px-1 py-1.5 mb-3 bg-white/5 rounded-2xl border border-white/5">
                {["👏", "❤️", "🔥", "💡", "🎉", "💯", "👍"].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      handleSendReaction(emoji);
                      setIsMoreActionsOpen(false);
                    }}
                    className="text-2xl p-1 hover:scale-125 active:scale-90 transition-transform cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Action Tiles Grid */}
              <div className="grid grid-cols-3 gap-2">
                {/* 1. Flip Camera */}
                <button
                  type="button"
                  onClick={() => {
                    handleSwitchCamera();
                    setIsMoreActionsOpen(false);
                  }}
                  disabled={isVideoMuted}
                  className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border transition active:scale-95 cursor-pointer ${
                    isVideoMuted
                      ? "opacity-30 pointer-events-none bg-white/5 border-white/5 text-white/40"
                      : "bg-white/10 hover:bg-white/15 border-white/10 text-white"
                  }`}
                >
                  <SwitchCamera className="w-5 h-5 text-white" />
                  <span className="text-[10px] font-medium text-white/80">Flip Cam</span>
                </button>

                {/* 2. Speaker Mode */}
                <button
                  type="button"
                  onClick={handleToggleSpeaker}
                  className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border transition active:scale-95 cursor-pointer ${
                    isSpeakerOn
                      ? "bg-sky-500/20 border-sky-400/40 text-sky-300"
                      : "bg-white/10 hover:bg-white/15 border-white/10 text-white/80"
                  }`}
                >
                  {isSpeakerOn ? <Volume2 className="w-5 h-5 text-sky-400" /> : <VolumeX className="w-5 h-5 text-white/60" />}
                  <span className="text-[10px] font-medium">{isSpeakerOn ? "Speaker" : "Earpiece"}</span>
                </button>

                {/* 3. Raise Hand */}
                <button
                  type="button"
                  onClick={() => {
                    handleToggleRaiseHand();
                    setIsMoreActionsOpen(false);
                  }}
                  className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border transition active:scale-95 cursor-pointer ${
                    isHandRaised
                      ? "bg-amber-500/25 border-amber-400/40 text-amber-300 ring-2 ring-amber-400/20"
                      : "bg-white/10 hover:bg-white/15 border-white/10 text-white"
                  }`}
                >
                  <Hand className="w-5 h-5 text-amber-300" />
                  <span className="text-[10px] font-medium">{isHandRaised ? "Lower Hand" : "Raise Hand"}</span>
                </button>

                {/* 4. Presentation & Code Studio */}
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("light");
                    setIsStudioOpen(true);
                    setIsMoreActionsOpen(false);
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-white transition active:scale-95 cursor-pointer"
                >
                  <Sparkles className="w-5 h-5 text-sky-300" />
                  <span className="text-[10px] font-medium text-white/80">Code Studio</span>
                </button>

                {/* 5. Health & Diagnostics HUD */}
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback("light");
                    setIsQualityStatsOpen(true);
                    setIsMoreActionsOpen(false);
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-white transition active:scale-95 cursor-pointer"
                >
                  <Activity className="w-5 h-5 text-emerald-400" />
                  <span className="text-[10px] font-medium text-white/80">Call Info</span>
                </button>

                {/* 6. Landscape View */}
                <button
                  type="button"
                  onClick={() => {
                    setIsLandscapeTheater((prev) => !prev);
                    setIsMoreActionsOpen(false);
                  }}
                  className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border transition active:scale-95 cursor-pointer ${
                    isLandscapeTheater
                      ? "bg-amber-400/25 border-amber-400/40 text-amber-300"
                      : "bg-white/10 hover:bg-white/15 border-white/10 text-white"
                  }`}
                >
                  <Smartphone className={`w-5 h-5 ${isLandscapeTheater ? "rotate-90 text-amber-300" : ""}`} />
                  <span className="text-[10px] font-medium text-white/80">Rotate View</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Primary Controls Capsule: Mobile (5 buttons) / Desktop (All buttons) */}
        <div className="flex items-center justify-center bg-zinc-950/85 backdrop-blur-2xl border border-white/15 rounded-full px-3 xs:px-4 sm:px-7 py-2 xs:py-2.5 sm:py-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.85)] ring-1 ring-white/10 max-w-full">
          {/* ================= DESKTOP-ONLY EXTRA BUTTONS (LEFT) ================= */}
          <div className="hidden sm:flex items-center gap-4 mr-2 border-r border-white/15 pr-4">
            {/* Desktop Flip Camera */}
            <button
              type="button"
              id="btn-switch-camera"
              onClick={handleSwitchCamera}
              className={`flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform ${
                isVideoMuted ? "opacity-35 pointer-events-none" : ""
              }`}
              title="Flip camera"
              aria-label="Flip camera"
              disabled={isVideoMuted}
            >
              <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/15 active:bg-white/20 text-white flex items-center justify-center backdrop-blur-md border border-white/15 shadow-md transition group-hover:border-white/30">
                <SwitchCamera className="w-5 h-5 text-white" />
              </div>
              <span className="text-[10px] font-medium text-white/70 group-hover:text-white transition">Flip</span>
            </button>

            {/* Desktop Speaker / Earpiece Toggle */}
            <button
              type="button"
              id="btn-toggle-speaker"
              onClick={handleToggleSpeaker}
              className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform"
              title={isSpeakerOn ? "Speaker on" : "Earpiece mode"}
              aria-label="Toggle speaker"
            >
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md transition ${
                  isSpeakerOn
                    ? "bg-sky-500/20 text-sky-400 border-sky-400/40 ring-2 ring-sky-400/20"
                    : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"
                }`}
              >
                {isSpeakerOn ? <Volume2 className="w-5 h-5 text-sky-300" /> : <VolumeX className="w-5 h-5 text-white/60" />}
              </div>
              <span
                className={`text-[10px] font-medium transition ${
                  isSpeakerOn ? "text-sky-300 font-semibold" : "text-white/70 group-hover:text-white"
                }`}
              >
                {isSpeakerOn ? "Speaker" : "Earpiece"}
              </span>
            </button>
          </div>

          {/* ================= CORE 5 BUTTONS (MOBILE & DESKTOP) ================= */}
          <div className="flex items-center justify-center gap-2 xs:gap-3 sm:gap-5">
            {/* 1. Mute / Unmute Microphone */}
            <button
              type="button"
              id="btn-toggle-mic"
              onClick={handleToggleMic}
              className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform touch-manipulation"
              title={isAudioMuted ? "Unmute microphone" : "Mute microphone"}
              aria-label="Toggle microphone"
            >
              <div
                className={`w-11 h-11 xs:w-12 xs:h-12 sm:w-13 sm:h-13 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md transition ${
                  isAudioMuted
                    ? "bg-rose-500/30 text-rose-300 border-rose-400/50 ring-2 ring-rose-400/20 shadow-rose-500/20"
                    : "bg-white/10 hover:bg-white/15 active:bg-white/20 text-white border-white/15 group-hover:border-white/30"
                }`}
              >
                {isAudioMuted ? (
                  <MicOff className="w-4 h-4 xs:w-5 xs:h-5 text-rose-400" />
                ) : (
                  <Mic className="w-4 h-4 xs:w-5 xs:h-5 text-white" />
                )}
              </div>
              <span
                className={`text-[9px] xs:text-[10px] font-medium transition ${
                  isAudioMuted ? "text-rose-400 font-semibold" : "text-white/70 group-hover:text-white"
                }`}
              >
                {isAudioMuted ? "Unmute" : "Mute"}
              </span>
            </button>

            {/* 2. Camera On / Off */}
            <button
              type="button"
              id="btn-toggle-video"
              onClick={handleToggleVideo}
              className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform touch-manipulation"
              title={isVideoMuted ? "Turn camera on" : "Turn camera off"}
              aria-label="Toggle camera"
            >
              <div
                className={`w-11 h-11 xs:w-12 xs:h-12 sm:w-13 sm:h-13 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md transition ${
                  isVideoMuted
                    ? "bg-rose-500/30 text-rose-300 border-rose-400/50 ring-2 ring-rose-400/20 shadow-rose-500/20"
                    : "bg-white/10 hover:bg-white/15 active:bg-white/20 text-white border-white/15 group-hover:border-white/30"
                }`}
              >
                {isVideoMuted ? (
                  <VideoOff className="w-4 h-4 xs:w-5 xs:h-5 text-rose-400" />
                ) : (
                  <Video className="w-4 h-4 xs:w-5 xs:h-5 text-white" />
                )}
              </div>
              <span
                className={`text-[9px] xs:text-[10px] font-medium transition ${
                  isVideoMuted ? "text-rose-400 font-semibold" : "text-white/70 group-hover:text-white"
                }`}
              >
                {isVideoMuted ? "Cam Off" : "Cam On"}
              </span>
            </button>

            {/* 3. Screen Share Toggle */}
            <button
              type="button"
              id="btn-toggle-screen-share"
              onClick={handleToggleScreenShare}
              className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform touch-manipulation"
              title={isSharingScreen ? "Stop sharing screen" : "Share screen"}
              aria-label="Share screen"
            >
              <div
                className={`w-11 h-11 xs:w-12 xs:h-12 sm:w-13 sm:h-13 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md transition ${
                  isSharingScreen
                    ? "bg-emerald-500 text-white border-emerald-300 ring-4 ring-emerald-400/30 shadow-lg shadow-emerald-500/40 animate-pulse"
                    : "bg-white/10 hover:bg-white/15 active:bg-white/20 text-white border-white/15 group-hover:border-emerald-400/50"
                }`}
              >
                {isSharingScreen ? (
                  <MonitorOff className="w-4 h-4 xs:w-5 xs:h-5 text-white" />
                ) : (
                  <MonitorUp className="w-4 h-4 xs:w-5 xs:h-5 text-white group-hover:text-emerald-300 transition" />
                )}
              </div>
              <span
                className={`text-[9px] xs:text-[10px] font-medium transition ${
                  isSharingScreen ? "text-emerald-400 font-bold" : "text-white/70 group-hover:text-white"
                }`}
              >
                {isSharingScreen ? "Sharing" : "Share"}
              </span>
            </button>

            {/* 4a. Mobile-Only 'More' Menu Trigger */}
            <button
              type="button"
              id="btn-mobile-more-actions"
              onClick={() => {
                triggerHapticFeedback("light");
                setIsMoreActionsOpen((prev) => !prev);
              }}
              className="flex sm:hidden flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform touch-manipulation relative"
              title="More options"
              aria-label="More options"
            >
              <div
                className={`w-11 h-11 xs:w-12 xs:h-12 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md transition ${
                  isMoreActionsOpen
                    ? "bg-white/25 text-white border-white/40 ring-2 ring-white/20"
                    : "bg-white/10 hover:bg-white/15 text-white border-white/15"
                }`}
              >
                <MoreHorizontal className="w-5 h-5 text-white" />
              </div>
              {/* Indicator dot if hand is raised or reaction active */}
              {(isHandRaised || partnerHandRaised) && (
                <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-zinc-950 animate-pulse" />
              )}
              <span className="text-[9px] xs:text-[10px] font-medium text-white/70 group-hover:text-white transition">
                More
              </span>
            </button>

            {/* ================= DESKTOP-ONLY EXTRA BUTTONS (RIGHT) ================= */}
            <div className="hidden sm:flex items-center gap-4 border-l border-white/15 pl-4 ml-1">
              {/* Desktop Emoji Reactions */}
              <button
                type="button"
                id="btn-toggle-reactions"
                onClick={() => {
                  triggerHapticFeedback("light");
                  setIsReactionPickerOpen((prev) => !prev);
                }}
                className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform"
                title="Send live reaction"
                aria-label="Send live reaction"
              >
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md transition ${
                    isReactionPickerOpen
                      ? "bg-amber-400 text-black border-amber-300 ring-2 ring-amber-400/40"
                      : "bg-white/10 hover:bg-white/15 text-white border-white/15 group-hover:border-amber-400/50"
                  }`}
                >
                  <Smile className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-medium text-white/70 group-hover:text-white transition">React</span>
              </button>

              {/* Desktop Raise Hand */}
              <button
                type="button"
                id="btn-toggle-raise-hand"
                onClick={handleToggleRaiseHand}
                className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform"
                title={isHandRaised ? "Lower hand" : "Raise hand"}
                aria-label="Toggle raise hand"
              >
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md transition ${
                    isHandRaised
                      ? "bg-amber-500 text-white border-amber-300 ring-4 ring-amber-400/30 animate-pulse"
                      : "bg-white/10 hover:bg-white/15 text-white border-white/15 group-hover:border-amber-400/50"
                  }`}
                >
                  <Hand className="w-5 h-5" />
                </div>
                <span
                  className={`text-[10px] font-medium transition ${
                    isHandRaised ? "text-amber-300 font-bold" : "text-white/70 group-hover:text-white"
                  }`}
                >
                  {isHandRaised ? "Raised" : "Hand"}
                </span>
              </button>

              {/* Desktop Code Studio */}
              <button
                type="button"
                id="btn-open-presentation-studio"
                onClick={() => {
                  triggerHapticFeedback("light");
                  setIsStudioOpen(true);
                }}
                className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform"
                title="Open Live Presentation & Code Studio"
                aria-label="Open Live Presentation & Code Studio"
              >
                <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/15 text-white flex items-center justify-center backdrop-blur-md border border-white/15 shadow-md transition group-hover:border-sky-400/50">
                  <Sparkles className="w-5 h-5 text-sky-300" />
                </div>
                <span className="text-[10px] font-medium text-white/70 group-hover:text-white transition">Studio</span>
              </button>
            </div>

            {/* 5. End Call Button (Universal Red Round Button) */}
            <button
              type="button"
              id="btn-end-call"
              onClick={() => handleEndCall("User ended call")}
              className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform touch-manipulation ml-1"
              title="End call"
              aria-label="End call"
            >
              <div className="w-11 h-11 xs:w-12 xs:h-12 sm:w-13 sm:h-13 rounded-full bg-red-600 hover:bg-red-500 active:bg-red-700 text-white flex items-center justify-center shadow-xl shadow-red-600/40 border border-red-400/40 ring-4 ring-red-500/20 transition">
                <PhoneOff className="w-4 h-4 xs:w-5 xs:h-5 text-white" />
              </div>
              <span className="text-[9px] xs:text-[10px] font-bold text-red-400 group-hover:text-red-300 transition">
                End
              </span>
            </button>
          </div>
        </div>

        {/* Desktop Quick Emoji Reaction Pill Picker */}
        <AnimatePresence>
          {isReactionPickerOpen && (
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 15, scale: 0.95 }}
              className="absolute bottom-20 xs:bottom-24 z-50 flex items-center gap-1.5 xs:gap-2 px-3.5 py-2 rounded-full bg-zinc-950/95 backdrop-blur-2xl border border-white/20 shadow-2xl ring-1 ring-white/10"
            >
              {["👏", "❤️", "🔥", "💡", "🎉", "💯", "👍"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleSendReaction(emoji)}
                  className="text-xl xs:text-2xl p-1.5 hover:scale-130 active:scale-95 transition-transform cursor-pointer hover:bg-white/10 rounded-full select-none"
                  title={`Send ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </footer>

      {/* Screen Share Toast Notification */}
      {screenShareToast && (
        <div className="absolute top-20 sm:top-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-zinc-950/90 border border-white/20 text-white text-xs font-medium shadow-2xl backdrop-blur-xl max-w-sm text-center animate-in fade-in zoom-in-95 pointer-events-none ring-1 ring-white/10">
          <div className="flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span>{screenShareToast}</span>
          </div>
        </div>
      )}

      {/* Real-Time Floating Emoji Reaction Burst (Zoom / FaceTime style) */}
      <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
        <AnimatePresence>
          {floatingReactions.map((reaction) => (
            <motion.div
              key={reaction.key}
              initial={{ opacity: 0, y: 0, scale: 0.6 }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: -280 - Math.random() * 120,
                x: (Math.random() - 0.5) * 80,
                scale: [0.6, 1.3, 1.1, 0.9],
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 3.2, ease: "easeOut" }}
              style={{
                position: "absolute",
                bottom: "100px",
                left: `${reaction.x}%`,
              }}
              className="flex flex-col items-center select-none"
            >
              <span className="text-3xl sm:text-4xl filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
                {reaction.emoji}
              </span>
              <span className="text-[10px] font-semibold text-white/90 bg-black/60 px-1.5 py-0.5 rounded-full backdrop-blur-sm border border-white/10 mt-1 whitespace-nowrap">
                {reaction.senderName}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Call Quality & Diagnostics HUD Modal (Zoom / Google Meet Tech-Giant Standard) */}
      <AnimatePresence>
        {isQualityStatsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="w-full max-w-md rounded-3xl bg-zinc-950/95 border border-white/15 p-5 sm:p-6 shadow-[0_25px_60px_rgba(0,0,0,0.9)] text-white ring-1 ring-white/10"
            >
              <div className="flex items-center justify-between pb-3.5 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm sm:text-base font-bold text-white tracking-tight">Call Health & Quality</h4>
                    <p className="text-[11px] text-emerald-400 font-medium">Enterprise WebRTC Engine Active</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsQualityStatsOpen(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition cursor-pointer"
                  title="Close diagnostics"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Real-Time Metrics Grid */}
              <div className="grid grid-cols-2 gap-2.5 my-4">
                <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-white/50 mb-1">Video Stream</div>
                  <div className="text-sm font-extrabold text-emerald-400 font-mono">1080p FHD</div>
                  <div className="text-[10px] text-white/70 mt-0.5">30-60 FPS • Bitrate ~4 Mbps</div>
                </div>
                <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-white/50 mb-1">Audio Codec</div>
                  <div className="text-sm font-extrabold text-sky-400 font-mono">Opus 48 kHz</div>
                  <div className="text-[10px] text-white/70 mt-0.5">Echo & Noise Filtered</div>
                </div>
                <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-white/50 mb-1">Encryption</div>
                  <div className="text-sm font-extrabold text-amber-300 font-mono">DTLS-SRTP</div>
                  <div className="text-[10px] text-white/70 mt-0.5">256-bit End-to-End P2P</div>
                </div>
                <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-white/50 mb-1">Connection State</div>
                  <div className="text-sm font-extrabold text-emerald-400 capitalize">{callStage}</div>
                  <div className="text-[10px] text-white/70 mt-0.5">Direct Mesh Topology</div>
                </div>
              </div>

              {/* Tech-Giant Advanced Controls */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-sky-400" />
                    <div>
                      <div className="text-xs font-semibold text-white">Voice Focus</div>
                      <div className="text-[10px] text-white/60">Acoustic level enhancement</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticFeedback("light");
                      setIsVoiceFocusEnabled((prev) => !prev);
                      playSynthChime("pop");
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
                      isVoiceFocusEnabled
                        ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
                        : "bg-white/10 text-white/70 hover:bg-white/15"
                    }`}
                  >
                    {isVoiceFocusEnabled ? "Enabled" : "Off"}
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-rose-400" />
                    <div>
                      <div className="text-xs font-semibold text-white">Screen Share Laser</div>
                      <div className="text-[10px] text-white/60">Collaborative pointer sync</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticFeedback("light");
                      setIsLaserPointerActive((prev) => !prev);
                      playSynthChime("pop");
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
                      isLaserPointerActive
                        ? "bg-rose-500 text-white shadow-md shadow-rose-500/30"
                        : "bg-white/10 text-white/70 hover:bg-white/15"
                    }`}
                  >
                    {isLaserPointerActive ? "Active" : "Off"}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsQualityStatsOpen(false)}
                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 active:scale-98 text-white font-semibold text-xs transition cursor-pointer"
              >
                Done
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mobile Browser Screen Share Guidance Modal */}
      <AnimatePresence>
        {showMobileScreenShareHelp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl bg-[#161B22] border border-white/15 p-5 shadow-2xl text-white"
            >
              <div className="flex items-center justify-between mb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base leading-tight">Mobile Screen Share</h3>
                    <p className="text-xs text-white/60">Android Browser Security Policy</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMobileScreenShareHelp(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition cursor-pointer"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-white/80 leading-relaxed mb-4">
                <p>
                  You are running SwapSkill in a mobile browser. Android OS blocks browser tabs from recording your other apps and home screen for system security.
                </p>

                <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
                    How to enable screen share in Chrome:
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-white/70 pl-1 text-[11px]">
                    <li>Tap Chrome's 3-dot menu (<span className="text-white font-bold">⋮</span>) at top right</li>
                    <li>Check the <span className="text-sky-300 font-semibold">'Desktop site'</span> box</li>
                    <li>Tap <span className="text-white font-semibold">Share Screen</span> again to broadcast!</li>
                  </ol>
                </div>

                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                  <div className="font-semibold flex items-center gap-1.5 mb-1">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    Live Presentation & Whiteboard:
                  </div>
                  <p className="text-[11px] text-emerald-200/80">
                    You can present interactive live code, draw diagrams, write notes, and share slides directly inside this browser call!
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileScreenShareHelp(false);
                    setIsStudioOpen(true);
                  }}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-semibold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/30"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Open Studio
                </button>
                <button
                  type="button"
                  onClick={() => setShowMobileScreenShareHelp(false)}
                  className="py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 text-white font-semibold text-xs transition cursor-pointer"
                >
                  Got It
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Live Screen Share Studio (Whiteboard, Code, Notes, Slides) */}
      {isStudioOpen && (
        <LiveScreenShareStudio
          partnerName={partnerDisplayName}
          skillName={skillName}
          onStreamReady={startScreenShareWithStream}
          onStopSharing={handleToggleScreenShare}
        />
      )}
    </div>

  {/* ========================================================================= */}
  {/* DRAGGABLE FLOATING MINI-CALL WINDOW (IMO STYLE: ONLY USER B VIDEO)         */}
  {/* ========================================================================= */}
  <AnimatePresence>
    {isMinimized && (
      <motion.div
        id="live-swap-mini-pip"
        drag
        dragElastic={0.1}
        dragMomentum={false}
        dragConstraints={{
          left: 12,
          top: 12,
          right: typeof window !== "undefined" ? window.innerWidth - 130 : 260,
          bottom: typeof window !== "undefined" ? window.innerHeight - 190 : 480,
        }}
        initial={{ scale: 0.82, opacity: 0, y: -20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.82, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 26 }}
        onDragStart={() => {
          isDraggingRef.current = true;
        }}
        onDragEnd={() => {
          setTimeout(() => {
            isDraggingRef.current = false;
          }, 120);
        }}
        onTap={() => {
          if (isDraggingRef.current) return;
          triggerHapticFeedback("light");
          setIsMinimized(false);
        }}
        className="fixed top-16 right-4 z-[99999] w-28 h-40 xs:w-32 xs:h-48 rounded-2xl overflow-hidden shadow-2xl bg-black cursor-grab active:cursor-grabbing select-none group touch-none ring-1 ring-white/20 border border-black/40"
        style={{
          boxShadow: "0 16px 40px -8px rgba(0,0,0,0.85), 0 0 15px rgba(0,0,0,0.5)",
        }}
        title="Tap to expand call"
      >
        {/* User B's Live Remote Video Stream (Pure full-bleed edge-to-edge, identical to IMO) */}
        <div className="w-full h-full relative bg-black overflow-hidden">
          <video
            ref={attachMiniRemoteVideo}
            poster={BLACK_POSTER}
            autoPlay
            playsInline
            muted={true}
            // @ts-ignore
            webkit-playsinline="true"
            x5-playsinline="true"
            controls={false}
            disablePictureInPicture
            className={`w-full h-full object-cover transition-opacity duration-200 ${
              isRemoteVideoActive && isRemoteVideoPlaying ? "opacity-100 block" : "opacity-0 hidden"
            }`}
          />

          {/* Voice Call / Camera-Off Fallback UI (User B Avatar & Minimal Name/Time) */}
          {(!isRemoteVideoActive || !isRemoteVideoPlaying) && (
            <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center p-2.5 text-center bg-zinc-950">
              <div className="w-12 h-12 rounded-full overflow-hidden ring-1 ring-white/20 bg-zinc-800 shadow-md mb-1.5">
                <img
                  src={partnerDisplayPhoto || DEFAULT_AVATAR}
                  alt={partnerDisplayName}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-[11px] font-medium text-white truncate max-w-[95px]">
                {partnerDisplayName}
              </span>
              <span className="text-[10px] font-mono text-emerald-400 mt-0.5">
                {isLiveActive ? formattedDuration : statusMessage}
              </span>
            </div>
          )}
        </div>

        {/* Subtle expand indicator icon on hover (Desktop) */}
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="w-5 h-5 rounded-full bg-black/60 text-white/90 flex items-center justify-center backdrop-blur-sm border border-white/10 shadow">
            <Maximize2 className="w-2.5 h-2.5" />
          </div>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
</>
);

  return createPortal(modalContent, document.body);
}
