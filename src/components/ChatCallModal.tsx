import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  RefreshCw,
  Volume2,
  VolumeX,
  ChevronDown,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useBackHandler } from "../utils/navigationManager";
import { doc, getDoc, updateDoc, serverTimestamp, Unsubscribe } from "firebase/firestore";
import { db } from "../firebase";
import { DEFAULT_AVATAR } from "../types";
import { SmartImage } from "./SmartImage";
import { WebRTCService } from "../services/webrtcService";
import {
  callSignalingService,
  logCallToConversation,
  generateUniqueCallId,
  generateUniqueSessionId,
} from "../services/callSignalingService";
import { mobileAudioRoutingService } from "../services/mobile/audio";
import { mobilePermissionService } from "../services/mobile/permissions";
import { mobileLifecycleService } from "../services/mobile/lifecycle";
import { mobileForegroundService } from "../services/mobile/foregroundService";
import { mobileCallKitService } from "../services/mobile/callKitService";
import { activeCallSessionService } from "../services/activeCallSessionService";
import { mobileNetworkService } from "../services/mobile/network";
import {
  startOutgoingRingtone,
  stopOutgoingRingtone,
  stopIncomingCallRingtone,
  stopAllCallSounds,
  playCallEnded,
  triggerHapticFeedback,
} from "../utils/sound";
import { safeLocalStorage } from "../utils/safeStorage";

export interface ChatCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  partnerName: string;
  partnerPhoto?: string;
  partnerUid: string;
  currentUserId: string;
  currentUserName: string;
  currentUserPhoto?: string;
  incomingCallId?: string;
  sessionId?: string;
  isCaller?: boolean;
  callType?: "video" | "audio";
  conversationId?: string;
  skillName?: string;
  sessionDuration?: number;
  onSessionCompleted?: (sessionId?: string) => void;
}

export default function ChatCallModal({
  isOpen,
  onClose,
  partnerName,
  partnerPhoto,
  partnerUid,
  currentUserId,
  currentUserName,
  currentUserPhoto,
  incomingCallId,
  sessionId: sessionIdProp,
  isCaller = false,
  callType = "video",
  conversationId,
  skillName,
  sessionDuration,
  onSessionCompleted,
}: ChatCallModalProps) {
  // Call Lifecycle Stage: "calling" | "ringing" | "connecting" | "connected" | "ended" | "failed"
  const [callStage, setCallStage] = useState<"calling" | "ringing" | "connecting" | "connected" | "ended" | "failed">(
    isCaller ? "calling" : "connecting"
  );
  const [statusText, setStatusText] = useState<string>(isCaller ? "Calling..." : "Connecting...");
  const [durationSeconds, setDurationSeconds] = useState<number>(0);

  // Synchronized state refs to prevent re-triggering main effect on state transitions
  const callStageRef = useRef(callStage);
  callStageRef.current = callStage;
  const durationSecondsRef = useRef(durationSeconds);
  durationSecondsRef.current = durationSeconds;

  // Media Controls State
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isVideoMuted, setIsVideoMuted] = useState<boolean>(callType === "audio");
  const [isSpeakerOn, setIsSpeakerOn] = useState<boolean>(callType === "video");
  const [isFlippingCamera, setIsFlippingCamera] = useState<boolean>(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState<boolean>(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("user");

  // In-app Minimize State (IMO-style Draggable Floating Mini-Window)
  const [isMinimized, setIsMinimized] = useState<boolean>(false);

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
    // Don't toggle controls if user clicked on any interactive button, local camera PiP, or control elements
    if (target.closest("button") || target.closest("#chat-call-local-pip") || target.closest(".no-controls-toggle")) {
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

  // Intercept back button when in full-screen call to minimize into floating PiP instead of closing
  useBackHandler(isOpen && !isMinimized, () => {
    triggerHapticFeedback("light");
    setIsMinimized(true);
    return true; // consumed
  });

  // Dynamic Profile & Name Display State (hydrated live from Firestore to ensure SwapSkill custom photo is used)
  const [partnerDisplayName, setPartnerDisplayName] = useState<string>(partnerName || "Partner");
  const [partnerDisplayPhoto, setPartnerDisplayPhoto] = useState<string>(partnerPhoto || "");
  const [currentDisplayName, setCurrentDisplayName] = useState<string>(currentUserName || "You");
  const [currentDisplayPhoto, setCurrentDisplayPhoto] = useState<string>(currentUserPhoto || "");

  const setupStartedCallIdRef = useRef<string | null>(null);
  const partnerUidRef = useRef(partnerUid);
  partnerUidRef.current = partnerUid;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const skillNameRef = useRef(skillName);
  skillNameRef.current = skillName;
  const onSessionCompletedRef = useRef(onSessionCompleted);
  onSessionCompletedRef.current = onSessionCompleted;

  // Sync prop changes into display state
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

  // Track muted states in refs for mobile screen-off event handlers
  const isAudioMutedRef = useRef<boolean>(false);
  isAudioMutedRef.current = isAudioMuted;
  const isVideoMutedRef = useRef<boolean>(callType === "audio");
  isVideoMutedRef.current = isVideoMuted;

  // References
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const miniRemoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const [isStreamSwapped, setIsStreamSwapped] = useState<boolean>(false);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const cornerPipRef = useRef<HTMLDivElement | null>(null);

  const webrtcRef = useRef<WebRTCService | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  partnerUidRef.current = partnerUid;
  const isDraggingRef = useRef<boolean>(false);
  const partnerNameRef = useRef(partnerName);
  partnerNameRef.current = partnerName;
  const partnerPhotoRef = useRef(partnerPhoto);
  partnerPhotoRef.current = partnerPhoto;
  currentUserIdRef.current = currentUserId;
  const currentUserNameRef = useRef(currentUserName);
  currentUserNameRef.current = currentUserName;
  const currentUserPhotoRef = useRef(currentUserPhoto);
  currentUserPhotoRef.current = currentUserPhoto;

  const activeCallIdRef = useRef<string>(incomingCallId || "");
  const sessionIdRef = useRef<string>(sessionIdProp || "");
  const unsubCallRef = useRef<Unsubscribe | null>(null);
  const unsubCandidatesRef = useRef<Unsubscribe | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ringingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectedAtMsRef = useRef<number | null>(null);
  const hasEndedRef = useRef<boolean>(false);
  const hasExplicitlyEndedRef = useRef<boolean>(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Format Duration string: 00:01, 00:02, etc.
  const formattedDuration = React.useMemo(() => {
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, [durationSeconds]);

  // Synchronized Duration Timer
  const startDurationTimer = useCallback((connectedAtMs?: number) => {
    if (durationTimerRef.current) return;
    const startTime = connectedAtMs || Date.now();
    connectedAtMsRef.current = startTime;

    const initialElapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    setDurationSeconds(initialElapsed);

    durationTimerRef.current = setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
      setDurationSeconds(elapsed);
    }, 1000);
  }, []);

  // Complete cleanup helper
  const performCleanup = useCallback((reason: string, isExplicit = false) => {
    // If component is unmounting but user did not explicitly click End Call, detach into background
    if (!isExplicit && !hasExplicitlyEndedRef.current && activeCallSessionService.hasActiveCall()) {
      activeCallSessionService.markModalDetached();
      console.log(`[ChatCall] Modal unmounted while call is active. Preserving media & WebRTC in background.`);
      return;
    }

    if (!isExplicit && !hasExplicitlyEndedRef.current) {
      // Re-render or component lifecycle transition without explicit call termination: preserve WebRTC connection!
      return;
    }

    if (hasEndedRef.current) return;
    if (isExplicit) {
      hasEndedRef.current = true;
    }
    console.log(`[ChatCall] performCleanup invoked: reason="${reason}"`);

    stopAllCallSounds();
    mobileLifecycleService.releaseCallWakeLock();
    mobileAudioRoutingService.resetAudioRouting(remoteAudioRef.current);
    mobilePermissionService.releaseActiveStream();

    // Clear timers
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }

    // Detach Firestore signaling listeners
    if (unsubCallRef.current) {
      try { unsubCallRef.current(); } catch (_) {}
      unsubCallRef.current = null;
    }
    if (unsubCandidatesRef.current) {
      try { unsubCandidatesRef.current(); } catch (_) {}
      unsubCandidatesRef.current = null;
    }

    // Stop and close WebRTC
    if (webrtcRef.current) {
      try { webrtcRef.current.close(); } catch (_) {}
      webrtcRef.current = null;
    }

    // Stop local tracks
    if (localStreamRef.current) {
      try {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      localStreamRef.current = null;
    }

    // Clear media element bindings
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (miniRemoteVideoRef.current) miniRemoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    // Unregister from signaling service and reset per-call active state
    if (activeCallIdRef.current) {
      callSignalingService.unregisterActiveCall(sessionIdRef.current || undefined, activeCallIdRef.current);
    }
    callSignalingService.resetCallState();

    // Ensure Firestore call document is marked ended
    if (activeCallIdRef.current) {
      const cId = activeCallIdRef.current;
      updateDoc(doc(db, "calls", cId), {
        status: "ended",
        endedAt: serverTimestamp(),
        endReason: reason || "Call closed",
      }).catch(() => {});
    }
  }, []);

  // Stable End Call Handler referencing refs to avoid tearing down effects
  const handleEndCall = useCallback(
    (reason = "User hung up", overrideStatus?: "completed" | "missed" | "declined" | "failed") => {
      if (hasExplicitlyEndedRef.current) return;
      hasExplicitlyEndedRef.current = true;

      const callId = activeCallIdRef.current;
      const duration = durationSecondsRef.current;
      const wasConnected = callStageRef.current === "connected" || duration > 0;

      const finalStatus: "completed" | "missed" | "declined" | "failed" =
        overrideStatus || (wasConnected ? "completed" : isCaller ? "missed" : "declined");

      console.log(`[ChatCall] Instant cut: callId=${callId}, wasConnected=${wasConnected}, duration=${duration}s, status=${finalStatus}`);

      // 1. Immediately silence all ringtones and audio, and play subtle end chime
      stopAllCallSounds();
      playCallEnded();

      // 2. DISMISS MODAL IMMEDIATELY (0ms delay) so both caller and receiver screens close cleanly
      setIsMinimized(false);
      onCloseRef.current();

      // 3. Kill local camera/mic media tracks instantly so device sensors stop with zero lag
      try {
        localStreamRef.current?.getTracks().forEach((track) => {
          try { track.stop(); } catch (_) {}
        });
        localStreamRef.current = null;
      } catch (_) {}

      try {
        remoteStreamRef.current?.getTracks().forEach((track) => {
          try { track.stop(); } catch (_) {}
        });
        remoteStreamRef.current = null;
      } catch (_) {}

      // 4. Shut down background services asynchronously without delaying the UI
      void (async () => {
        try {
          await activeCallSessionService.endActiveCallExplicitly(reason);
        } catch (_) {}
        try {
          await mobileForegroundService.stopCallForegroundService();
        } catch (_) {}
        if (callId) {
          try {
            await mobileCallKitService.endCall(callId);
          } catch (_) {}
        }
        try {
          await mobileLifecycleService.releaseCallWakeLock();
        } catch (_) {}
        try {
          await mobileAudioRoutingService.resetAudioRouting(remoteAudioRef.current);
        } catch (_) {}
        try {
          mobilePermissionService.releaseActiveStream();
        } catch (_) {}

        performCleanup(reason, true);

        // Update Firestore call document
        if (callId) {
          try {
            await callSignalingService.endCall(callId, reason, sessionIdRef.current, duration);
          } catch (err) {
            console.warn("[ChatCall] Error writing call end status:", err);
          }
        }

        // Log to conversation thread
        if (conversationId && callId) {
          try {
            await logCallToConversation({
              conversationId,
              callId,
              callType,
              status: finalStatus,
              durationSeconds: duration,
              callerId: isCaller ? (currentUserIdRef.current || currentUserId) : (partnerUidRef.current || partnerUid),
              callerName: isCaller ? (currentUserNameRef.current || currentUserName) : (partnerNameRef.current || partnerName),
              receiverId: isCaller ? (partnerUidRef.current || partnerUid) : (currentUserIdRef.current || currentUserId),
              receiverName: isCaller ? (partnerNameRef.current || partnerName) : (currentUserNameRef.current || currentUserName),
              currentUserId: currentUserIdRef.current || currentUserId,
            });
          } catch (err) {
            console.warn("[ChatCall] Error logging call:", err);
          }
        }

        // Update session document & invoke onSessionCompleted if this is a Live Swap Session
        if (sessionIdRef.current && !sessionIdRef.current.startsWith("chat_")) {
          updateDoc(doc(db, "sessions", sessionIdRef.current), {
            isLive: false,
            lastLeaveTime: serverTimestamp(),
          }).catch(() => {});
          if (onSessionCompletedRef.current) {
            try {
              onSessionCompletedRef.current(sessionIdRef.current);
            } catch (_) {}
          }
        }
      })();
    },
    [
      isCaller,
      partnerUid,
      currentUserId,
      currentUserName,
      partnerName,
      conversationId,
      callType,
      performCleanup,
    ]
  );

  const handleEndCallRef = useRef(handleEndCall);
  handleEndCallRef.current = handleEndCall;

  // Ensure full cleanup runs only if modal is closed AND the call was explicitly ended
  useEffect(() => {
    if (!isOpen && hasExplicitlyEndedRef.current) {
      performCleanup("Modal closed after explicit call end", true);
    }
  }, [isOpen, performCleanup]);

  // Handle remote media track reception
  const handleRemoteStream = useCallback((stream: MediaStream) => {
    console.log("[WEBRTC_REMOTE_TRACK]");
    console.log(`[ChatCall] Remote stream received: videoTracks=${stream.getVideoTracks().length}, audioTracks=${stream.getAudioTracks().length}`);
    remoteStreamRef.current = stream;

    const hasLiveVideo = stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
    setHasRemoteVideo(hasLiveVideo);

    if (stream.getTracks().length > 0) {
      stopAllCallSounds();
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      if (ringingTimeoutRef.current) {
        clearTimeout(ringingTimeoutRef.current);
        ringingTimeoutRef.current = null;
      }
      setCallStage("connected");
      setStatusText("");
      startDurationTimer(connectedAtMsRef.current || Date.now());
    }

    if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== stream) {
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.play().catch(() => {});
    }

    if (miniRemoteVideoRef.current && miniRemoteVideoRef.current.srcObject !== stream) {
      miniRemoteVideoRef.current.srcObject = stream;
      miniRemoteVideoRef.current.play().catch(() => {});
    }

    if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== stream) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.volume = 1.0;
      remoteAudioRef.current.play().catch(() => {});
    }

    // Attach track unmute/mute listeners
    stream.getVideoTracks().forEach((track) => {
      track.onunmute = () => {
        setHasRemoteVideo(true);
        if (remoteVideoRef.current) remoteVideoRef.current.play().catch(() => {});
        if (miniRemoteVideoRef.current) miniRemoteVideoRef.current.play().catch(() => {});
      };
      track.onmute = () => {
        setHasRemoteVideo(false);
      };
    });
  }, []);

  // Callback ref for instantaneous, glitch-free binding to User B's remote video element when call is minimized
  const attachMiniRemoteVideo = useCallback((el: HTMLVideoElement | null) => {
    miniRemoteVideoRef.current = el;
    if (!el) return;
    // ALWAYS attach User B's remote stream when minimized (IMO style)
    const stream = remoteStreamRef.current || webrtcRef.current?.getRemoteStream() || activeCallSessionService.getActiveSession()?.remoteStream;
    if (stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.play().catch(() => {});
    }
  }, []);

  // Callback ref for the full-screen video element (User B by default, or self if swapped)
  const attachFullScreenVideo = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoRef.current = el;
    if (!el) return;
    const remoteStream = remoteStreamRef.current || webrtcRef.current?.getRemoteStream() || activeCallSessionService.getActiveSession()?.remoteStream;
    const localStream = localStreamRef.current;
    const stream = isStreamSwapped ? localStream : remoteStream;
    if (stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.play().catch(() => {});
    }
  }, [isStreamSwapped]);

  // Callback ref for the draggable corner thumbnail video element (self by default, or User B if swapped)
  const attachPipThumbnailVideo = useCallback((el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    if (!el) return;
    const remoteStream = remoteStreamRef.current || webrtcRef.current?.getRemoteStream() || activeCallSessionService.getActiveSession()?.remoteStream;
    const localStream = localStreamRef.current;
    const stream = isStreamSwapped ? remoteStream : localStream;
    if (stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.play().catch(() => {});
    }
  }, [isStreamSwapped]);

  // Sync streams seamlessly across full-screen, corner thumbnail, and draggable mini PiP window
  useEffect(() => {
    const remoteStream = remoteStreamRef.current || webrtcRef.current?.getRemoteStream() || activeCallSessionService.getActiveSession()?.remoteStream;
    const localStream = localStreamRef.current;

    // 1. Minimized floating PiP: ALWAYS User B's Remote Stream (IMO style)
    if (isMinimized && miniRemoteVideoRef.current) {
      if (remoteStream && miniRemoteVideoRef.current.srcObject !== remoteStream) {
        miniRemoteVideoRef.current.srcObject = remoteStream;
      }
      miniRemoteVideoRef.current.play().catch(() => {});
      return;
    }

    if (isMinimized) return;

    // 2. Full-Screen video:
    const mainStream = isStreamSwapped ? localStream : remoteStream;
    if (remoteVideoRef.current && mainStream) {
      if (remoteVideoRef.current.srcObject !== mainStream) {
        remoteVideoRef.current.srcObject = mainStream;
      }
      remoteVideoRef.current.play().catch(() => {});
    }

    // 3. Corner Thumbnail video:
    const thumbStream = isStreamSwapped ? remoteStream : localStream;
    if (localVideoRef.current && thumbStream) {
      if (localVideoRef.current.srcObject !== thumbStream) {
        localVideoRef.current.srcObject = thumbStream;
      }
      localVideoRef.current.play().catch(() => {});
    }
  }, [isMinimized, isStreamSwapped, hasRemoteVideo]);

  // Main Call Setup Lifecycle - Executes ONCE per call session
  useEffect(() => {
    const effectiveCurrentUserId =
      currentUserId ||
      currentUserIdRef.current ||
      (() => {
        try {
          const saved = safeLocalStorage.getItem("swap_cache_user_profile");
          if (saved) return JSON.parse(saved)?.uid || "";
        } catch (_) {}
        return safeLocalStorage.getItem("current_user_id") || "";
      })() ||
      "user";

    if (!isOpen || !effectiveCurrentUserId) return;
    if (isCaller && !partnerUid && !partnerUidRef.current) return;

    const callId = incomingCallId || generateUniqueCallId(`chat_${conversationId || "call"}`);
    const sessionId = sessionIdProp || generateUniqueSessionId(`chat_${conversationId || "sess"}`);

    // Guard: Prevent re-running or tearing down the live WebRTC connection for the same callId
    if (setupStartedCallIdRef.current === callId) {
      return;
    }
    setupStartedCallIdRef.current = callId;
    hasEndedRef.current = false;
    hasExplicitlyEndedRef.current = false;

    let isCancelled = false;
    activeCallIdRef.current = callId;
    sessionIdRef.current = sessionId;

    console.log(`[CALL_ATTACH] callId=${callId} sessionId=${sessionId}`);
    console.log(`[ChatCall] Initiating call workflow: callId=${callId}, sessionId=${sessionId}, isCaller=${isCaller}, callType=${callType}`);
    callSignalingService.registerActiveCall(sessionId, callId);
    mobileLifecycleService.acquireCallWakeLock();

    // Early registration in activeCallSessionService to decouple from React lifecycle
    activeCallSessionService.registerSession({
      sessionId,
      callId,
      partnerName: partnerNameRef.current || partnerName,
      partnerPhoto: partnerPhotoRef.current || partnerPhoto,
      partnerUid: partnerUidRef.current || partnerUid,
      skillName: skillNameRef.current || skillName || (conversationId ? "Chat Call" : "Live Swap Call"),
      callType,
      isCaller,
      localStream: null,
      webrtcService: null,
    });

    // 1. Ringing Timeout (35 seconds if unanswered)
    if (isCaller) {
      startOutgoingRingtone();
      ringingTimeoutRef.current = setTimeout(() => {
        if (!hasEndedRef.current && callStageRef.current !== "connected") {
          console.warn("[ChatCall] Ringing timeout reached (35s) without answer");
          handleEndCallRef.current("No answer", "missed");
        }
      }, 35000);
    } else {
      stopAllCallSounds();
    }

    // 2. Connection Timeout (25 seconds if WebRTC connection stalls)
    connectionTimeoutRef.current = setTimeout(() => {
      if (!hasEndedRef.current && callStageRef.current !== "connected") {
        console.warn("[ChatCall] WebRTC connection timeout reached (25s)");
        setStatusText("Unable to connect");
        setTimeout(() => {
          handleEndCallRef.current("Unable to connect", "failed");
        }, 1200);
      }
    }, 25000);

    // Background -> Foreground lifecycle resumption & screen wake lock management
    const unsubLife = mobileLifecycleService.addAppStateListener((isActive) => {
      console.log(`[CALL_LIFECYCLE] App lifecycle transition: isActive=${isActive}`);
      if (!isActive) {
        // SCREEN-OFF / BACKGROUND:
        // Remote audio and video must continue uninterrupted. Do NOT stop tracks or destroy WebRTC.
        console.log("[CALL_LIFECYCLE] APP_BACKGROUND: Maintaining audio and video call pipeline.");
        // Keep local tracks enabled according to user mute settings
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
        console.log("[CALL_LIFECYCLE] APP_FOREGROUND");
        mobileLifecycleService.acquireCallWakeLock();
        console.log("[CALL_LIFECYCLE] WAKELOCK_ACQUIRED");
        const savedRoute = mobileAudioRoutingService.getCurrentRoute();
        mobileAudioRoutingService.setAudioRoute(savedRoute, remoteAudioRef.current).catch(() => {});

        if (remoteAudioRef.current && remoteAudioRef.current.paused) {
          remoteAudioRef.current.play().catch(() => {});
        }
        if (remoteVideoRef.current && remoteVideoRef.current.paused) {
          remoteVideoRef.current.play().catch(() => {});
        }
        if (localVideoRef.current && localVideoRef.current.paused) {
          localVideoRef.current.play().catch(() => {});
        }

        // Restore local video track if unmuted
        if (localStreamRef.current && !isVideoMutedRef.current && callType === "video") {
          localStreamRef.current.getVideoTracks().forEach((track) => {
            track.enabled = true;
          });
        }

        // Re-verify network & ICE state
        if (webrtcRef.current) {
          const iceState = webrtcRef.current.getIceConnectionState();
          if (iceState === "disconnected" || iceState === "failed") {
            console.log("[ChatCall] App foregrounded with degraded ICE, restarting ICE...");
            webrtcRef.current.restartIce().catch(() => {});
          }
        }
      }
    });

    // Mobile network listener to handle WiFi <-> Cellular handover and disconnections
    const unsubNet = mobileNetworkService.onNetworkStatusChange((netStatus) => {
      console.log(`[ChatCall] Network status changed: connected=${netStatus.connected}, type=${netStatus.connectionType}`);
      if (!netStatus.connected) {
        setStatusText("Network disconnected. Waiting for connection...");
      } else {
        if (webrtcRef.current) {
          const iceState = webrtcRef.current.getIceConnectionState();
          if (iceState === "disconnected" || iceState === "failed") {
            console.log("[ChatCall] Network restored with degraded ICE, restarting ICE...");
            setStatusText("Network restored. Reconnecting…");
            webrtcRef.current.restartIce().catch((err) => {
              console.warn("[ChatCall] restartIce on network restore failed:", err);
            });
          } else {
            setStatusText(callStageRef.current === "connected" ? "" : "Connecting…");
          }
        }
      }
    });

    // Native notification action listener (e.g. Android notification hang-up button)
    const unsubCallEndedNotification = activeCallSessionService.addCallEndedListener((reason) => {
      console.log("[ChatCall] Received notification action to end call:", reason);
      handleEndCallRef.current(reason, "completed");
    });

    const setupCallSession = async () => {
      try {
        // Step 0: Check if activeCallSessionService already holds a live session for this callId
        const existingSession = activeCallSessionService.getActiveSession();
        if (existingSession && existingSession.callId === callId && existingSession.webrtcService) {
          console.log(`[ChatCall] Reattaching to existing active call session: callId=${callId}`);
          webrtcRef.current = existingSession.webrtcService;
          localStreamRef.current = existingSession.localStream;
          remoteStreamRef.current = existingSession.remoteStream;
          setCallStage(existingSession.callStage);
          setStatusText(existingSession.callStage === "connected" ? "" : "Connecting...");

          if (existingSession.localStream && localVideoRef.current) {
            localVideoRef.current.srcObject = existingSession.localStream;
            localVideoRef.current.play().catch(() => {});
          }
          if (existingSession.remoteStream) {
            handleRemoteStream(existingSession.remoteStream);
          }
          startDurationTimer(existingSession.startedAt);
          return;
        }

        // Step 0b: IMMEDIATE INITIATION FOR CALLER (t=0ms)
        // Decoupled from media acquisition & ICE negotiation so callee's device starts ringing in ~200-400ms!
        if (isCaller) {
          const effCallerName = currentUserNameRef.current || currentUserName || "User";
          const effPartnerName = partnerNameRef.current || partnerName || "Partner";
          const effSkillName = skillNameRef.current || skillName || (conversationId ? "Chat Call" : "Live Swap Call");
          console.log(`[TIMING] T0_CALL_INITIATED: callId=${callId} sessionId=${sessionId} caller=${effCallerName} receiver=${effPartnerName} skill=${effSkillName}`);
          
          callSignalingService.initiateCall({
            callId,
            sessionId,
            conversationId,
            callerId: effectiveCurrentUserId,
            callerName: effCallerName,
            callerPhoto: currentUserPhotoRef.current || currentUserPhoto || "",
            receiverId: partnerUidRef.current || partnerUid || "",
            receiverName: effPartnerName,
            receiverPhoto: partnerPhotoRef.current || partnerPhoto || "",
            callType,
            skillName: effSkillName,
            offer: null, // Asynchronously generated in background and attached via setCallOffer
          }).catch((initErr) => {
            console.warn("[ChatCall] Immediate initiateCall error:", initErr);
          });

          // Start Android Native Foreground Service early so mic/camera permissions are preserved even on lock screen
          mobileForegroundService.startCallForegroundService({
            partnerName: effPartnerName,
            callType,
            sessionId,
            callId,
          }).catch(() => {});

          // If this call is for a Swap Session, update session document
          if (sessionId && !sessionId.startsWith("chat_")) {
            updateDoc(doc(db, "sessions", sessionId), {
              currentCallId: callId,
              isLive: true,
              hasStartedLive: true,
              callUpdatedAt: serverTimestamp(),
            }).catch(() => {});
          }
        }

        // Step A & B: Acquire Local Media Stream and ICE servers concurrently for instant startup
        const [mediaRes, iceServers] = await Promise.all([
          mobilePermissionService.acquireCallMediaStream({
            video: callType === "video",
            audio: true,
            facingMode: "user",
          }),
          WebRTCService.fetchIceServers(),
        ]);

        if (isCancelled || hasEndedRef.current) return;

        if (!mediaRes.success || !mediaRes.stream) {
          console.error("[ChatCall] Local media acquisition failed:", mediaRes.error);
          setStatusText("Camera/Mic access denied");
          setCallStage("failed");
          setTimeout(() => handleEndCallRef.current("Permission denied", "failed"), 1500);
          return;
        }

        const localStream = mediaRes.stream;
        localStreamRef.current = localStream;
        console.log("[WEBRTC_LOCAL_STREAM_READY]");

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          localVideoRef.current.play().catch(() => {});
        }

        // Step C: Initialize WebRTC PeerConnection with full event handlers
        const webrtc = new WebRTCService({
          onLocalStream: (s) => {
            activeCallSessionService.updateLocalStream(s);
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = s;
              localVideoRef.current.play().catch(() => {});
            }
          },
          onRemoteStream: (stream) => {
            activeCallSessionService.updateRemoteStream(stream);
            handleRemoteStream(stream);
          },
          onIceCandidate: (candidate) => {
            if (isCaller) {
              callSignalingService.addCallerCandidate(callId, candidate);
            } else {
              callSignalingService.addCalleeCandidate(callId, candidate);
            }
          },
          onIceGatheringStateChange: (gatheringState) => {
            console.log(`[ChatCall] ICE Gathering State: ${gatheringState}`);
          },
          onIceConnectionStateChange: (iceState) => {
            console.log(`[ChatCall] ICE Connection State: ${iceState}`);
            if (iceState === "connected" || iceState === "completed") {
              stopAllCallSounds();
              if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
              }
              if (ringingTimeoutRef.current) {
                clearTimeout(ringingTimeoutRef.current);
                ringingTimeoutRef.current = null;
              }
              setCallStage("connected");
              setStatusText("");
              startDurationTimer(connectedAtMsRef.current || Date.now());

              activeCallSessionService.setCallStage("connected");
              mobileForegroundService.startCallForegroundService({
                partnerName,
                callType,
                sessionId,
                callId,
              }).catch(() => {});
              mobileCallKitService.reportCallConnected(callId).catch(() => {});

              updateDoc(doc(db, "calls", callId), {
                status: "connected",
                connectedAt: serverTimestamp(),
              }).catch(() => {});

              if (sessionId && !sessionId.startsWith("chat_")) {
                updateDoc(doc(db, "sessions", sessionId), {
                  isLive: true,
                  hasStartedLive: true,
                  actualStartTime: serverTimestamp(),
                }).catch(() => {});
              }
            }
          },
          onConnectionStateChange: (state) => {
            console.log(`[ChatCall] PeerConnection State: ${state}`);
            if (state === "connected") {
              stopAllCallSounds();
              if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
              }
              if (ringingTimeoutRef.current) {
                clearTimeout(ringingTimeoutRef.current);
                ringingTimeoutRef.current = null;
              }
              setCallStage("connected");
              setStatusText("");
              startDurationTimer(connectedAtMsRef.current || Date.now());

              activeCallSessionService.setCallStage("connected");
              mobileForegroundService.startCallForegroundService({
                partnerName,
                callType,
                sessionId,
                callId,
              }).catch(() => {});
              mobileCallKitService.reportCallConnected(callId).catch(() => {});

              updateDoc(doc(db, "calls", callId), {
                status: "connected",
                connectedAt: serverTimestamp(),
              }).catch(() => {});
            } else if (state === "failed") {
              console.error("[ChatCall] WebRTC connection failed");
              setStatusText("Unable to connect");
              setTimeout(() => {
                handleEndCallRef.current("Connection failed", "failed");
              }, 1500);
            }
          },
          onIceRestartNeeded: async () => {
            console.log("[ChatCall] ICE restart needed due to network switch or disconnect");
            if (isCaller && webrtcRef.current && !hasEndedRef.current) {
              try {
                const restartOffer = await webrtcRef.current.restartIce();
                if (restartOffer && callId) {
                  await updateDoc(doc(db, "calls", callId), {
                    offer: restartOffer,
                  });
                  console.log("[ChatCall] ICE restart offer sent successfully");
                }
              } catch (e) {
                console.warn("[ChatCall] Error during ICE restart:", e);
              }
            }
          },
        });

        webrtcRef.current = webrtc;
        webrtc.initPeerConnection(iceServers, localStream);
        console.log("[WEBRTC_PC_CREATED]");

        // Register session in activeCallSessionService to decouple from React lifecycle
        activeCallSessionService.registerSession({
          sessionId,
          callId,
          partnerName,
          partnerPhoto,
          partnerUid,
          skillName: "Chat Call",
          callType,
          isCaller,
          localStream,
          webrtcService: webrtc,
        });

        // Step D: Configure Audio Route (Speaker for video, earpiece/speaker for voice) in background
        mobileAudioRoutingService.setAudioRoute(
          callType === "video" ? "speaker" : "earpiece",
          remoteAudioRef.current
        ).catch(() => {});

        // ==========================================
        // CALLER WORKFLOW: Generate Offer and Send
        // ==========================================
        if (isCaller) {
          console.log(`[CALL_ATTACH] callId=${callId} sessionId=${sessionId}`);

          // Listen to Callee Candidates immediately
          unsubCandidatesRef.current = callSignalingService.listenToCalleeCandidates(
            callId,
            (candidate) => {
              console.log("[WEBRTC_ICE_CANDIDATE_RECEIVED]");
              webrtc.addIceCandidate(candidate);
            }
          );

          // Generate Offer and attach to Firestore calls/{callId}
          const offer = await webrtc.createOffer();
          if (isCancelled || hasEndedRef.current) return;

          await callSignalingService.setCallOffer(callId, offer);

          // Check if Callee already answered (fast native answer path)
          let hasHandledAnswer = false;
          try {
            const existingCallData = await callSignalingService.getCall(callId);
            if (existingCallData && existingCallData.answer && !hasHandledAnswer) {
              hasHandledAnswer = true;
              console.log("[ChatCall] Callee answer already present in call doc. Setting remote description...");
              stopOutgoingRingtone();
              setCallStage("connecting");
              setStatusText("Connecting...");
              if (typeof existingCallData.acceptedAt === "number") {
                connectedAtMsRef.current = existingCallData.acceptedAt;
              }
              await webrtc.setRemoteAnswer(existingCallData.answer.sdp);
              console.log("[WEBRTC_REMOTE_DESCRIPTION_SET]");

              // Also check any already-stored callee candidates
              const existingCalleeCandidates = await callSignalingService.getCalleeCandidates(callId);
              for (const cand of existingCalleeCandidates) {
                console.log("[WEBRTC_ICE_CANDIDATE_RECEIVED]");
                webrtc.addIceCandidate(cand);
              }
            }
          } catch (e) {
            console.warn("[ChatCall] Error checking existing answer on caller:", e);
          }

          // Listen to Call Document for Answer and Remote Status
          unsubCallRef.current = callSignalingService.listenToCall(callId, async (callData) => {
            if (!callData || hasEndedRef.current) return;

            if (callData.status === "ringing") {
              setCallStage("ringing");
              setStatusText("Ringing...");
            } else if (callData.status === "accepting") {
              stopOutgoingRingtone();
              setCallStage("connecting");
              setStatusText("Connecting...");
            } else if (callData.status === "rejected") {
              stopOutgoingRingtone();
              setStatusText("Call declined");
              playCallEnded();
              handleEndCallRef.current("Call declined", "declined");
            } else if (callData.status === "ended") {
              stopAllCallSounds();
              setStatusText("Call ended");
              playCallEnded();
              handleEndCallRef.current("Remote peer ended", "completed");
            } else if (callData.status === "connected" || (callData as any).status === "in_call") {
              stopAllCallSounds();
              if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
              }
              if (ringingTimeoutRef.current) {
                clearTimeout(ringingTimeoutRef.current);
                ringingTimeoutRef.current = null;
              }
              setCallStage("connected");
              setStatusText("");
              if (typeof callData.acceptedAt === "number") {
                connectedAtMsRef.current = callData.acceptedAt;
              }
              startDurationTimer(connectedAtMsRef.current || Date.now());
            }

            // Remote peer answered
            if (callData.answer && !hasHandledAnswer) {
              hasHandledAnswer = true;
              console.log("[ChatCall] Answer received from receiver. Setting remote description...");
              stopOutgoingRingtone();
              setCallStage("connecting");
              setStatusText("Connecting...");
              if (typeof callData.acceptedAt === "number") {
                connectedAtMsRef.current = callData.acceptedAt;
              }
              await webrtc.setRemoteAnswer(callData.answer.sdp);
              console.log("[WEBRTC_REMOTE_DESCRIPTION_SET]");

              // Fetch any pre-existing callee candidates
              try {
                const existingCalleeCandidates = await callSignalingService.getCalleeCandidates(callId);
                for (const cand of existingCalleeCandidates) {
                  console.log("[WEBRTC_ICE_CANDIDATE_RECEIVED]");
                  webrtc.addIceCandidate(cand);
                }
              } catch (_) {}
            }
          });
        }
        // ==========================================
        // CALLEE WORKFLOW: Read Offer and Answer
        // ==========================================
        else {
          console.log(`[CALL_ATTACH] callId=${callId} sessionId=${sessionId}`);

          // 1. Listen to Caller Candidates in real time
          unsubCandidatesRef.current = callSignalingService.listenToCallerCandidates(
            callId,
            (candidate) => {
              console.log("[WEBRTC_ICE_CANDIDATE_RECEIVED]");
              webrtc.addIceCandidate(candidate);
            }
          );

          // Pre-fetch existing caller candidates asynchronously in background (non-blocking)
          callSignalingService.getCallerCandidates(callId).then((existingCallerCandidates) => {
            if (existingCallerCandidates.length > 0) {
              console.log(`[ChatCall] Found ${existingCallerCandidates.length} pre-existing caller ICE candidates. Adding...`);
              for (const cand of existingCallerCandidates) {
                webrtc.addIceCandidate(cand);
              }
            }
          }).catch((e) => {
            console.warn("[ChatCall] Non-fatal error reading existing caller candidates:", e);
          });

          // 2. Immediately inspect existing call document for pre-existing Offer
          let hasAnswered = false;
          try {
            const existingCallData = await callSignalingService.getCall(callId);
            if (existingCallData && existingCallData.offer && !hasAnswered && !hasEndedRef.current) {
              hasAnswered = true;
              console.log("[WEBRTC_OFFER_FOUND]");
              console.log("[ChatCall] Found pre-existing offer in call doc. Creating answer immediately...");
              setCallStage("connecting");
              setStatusText("Connecting...");

              const answer = await webrtc.createAnswer(existingCallData.offer.sdp);
              console.log("[WEBRTC_REMOTE_DESCRIPTION_SET]");
              console.log("[WEBRTC_ANSWER_CREATED]");

              if (!isCancelled && !hasEndedRef.current) {
                await callSignalingService.answerCall(callId, answer);
                console.log("[WEBRTC_ANSWER_STORED]");
                console.log("[ChatCall] Pre-existing offer answered and written to Firestore successfully");

                try {
                  const callerCands = await callSignalingService.getCallerCandidates(callId);
                  for (const cand of callerCands) {
                    webrtc.addIceCandidate(cand);
                  }
                } catch (_) {}
              }
            }
          } catch (e) {
            console.warn("[ChatCall] Non-fatal error checking pre-existing call document:", e);
          }

          // 4. Attach real-time listener to Call Document to receive Offer, Answer and status updates
          unsubCallRef.current = callSignalingService.listenToCall(callId, async (callData) => {
            if (!callData || hasEndedRef.current) return;

            if (callData.status === "ended") {
              stopAllCallSounds();
              setStatusText("Call ended");
              playCallEnded();
              handleEndCallRef.current("Caller ended the call", "completed");
              return;
            }

            if (callData.status === "rejected" || (callData.status as any) === "cancelled") {
              stopAllCallSounds();
              setStatusText("Call ended");
              playCallEnded();
              handleEndCallRef.current("Call was cancelled", "declined");
              return;
            }

            if (callData.status === "connected" || (callData as any).status === "in_call") {
              stopAllCallSounds();
              if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
              }
              if (ringingTimeoutRef.current) {
                clearTimeout(ringingTimeoutRef.current);
                ringingTimeoutRef.current = null;
              }
              setCallStage("connected");
              setStatusText("");
              if (typeof callData.acceptedAt === "number") {
                connectedAtMsRef.current = callData.acceptedAt;
              }
              startDurationTimer(connectedAtMsRef.current || Date.now());
            }

            if (callData.offer && !hasAnswered) {
              hasAnswered = true;
              console.log("[WEBRTC_OFFER_FOUND]");
              console.log("[ChatCall] Callee received offer from snapshot. Creating answer immediately...");
              setCallStage("connecting");
              setStatusText("Connecting...");

              const answer = await webrtc.createAnswer(callData.offer.sdp);
              console.log("[WEBRTC_REMOTE_DESCRIPTION_SET]");
              console.log("[WEBRTC_ANSWER_CREATED]");

              if (hasEndedRef.current) return;

              await callSignalingService.answerCall(callId, answer);
              console.log("[WEBRTC_ANSWER_STORED]");
              console.log("[ChatCall] Callee answer written to Firestore successfully");

              try {
                const callerCands = await callSignalingService.getCallerCandidates(callId);
                for (const cand of callerCands) {
                  webrtc.addIceCandidate(cand);
                }
              } catch (_) {}
            }
          });
        }
      } catch (err: any) {
        console.error("[ChatCall] Fatal error setting up call session:", err);
        setStatusText("Unable to connect");
        setTimeout(() => handleEndCallRef.current("Connection error", "failed"), 1500);
      }
    };

    setupCallSession();

    return () => {
      unsubLife();
      unsubNet();
      unsubCallEndedNotification();
      // On regular component unmount, do NOT tear down active WebRTC or cancel call
    };
  }, [
    isOpen,
    incomingCallId,
    sessionIdProp,
    isCaller,
    callType,
    conversationId,
  ]);

  // Media Toggle Handlers
  const handleToggleMic = () => {
    if (!webrtcRef.current) return;
    triggerHapticFeedback("light");
    const nextMuted = !isAudioMuted;
    webrtcRef.current.setAudioEnabled(!nextMuted);
    setIsAudioMuted(nextMuted);
  };

  const handleToggleVideo = () => {
    if (!webrtcRef.current) return;
    triggerHapticFeedback("light");
    const nextMuted = !isVideoMuted;
    webrtcRef.current.setVideoEnabled(!nextMuted);
    setIsVideoMuted(nextMuted);
  };

  const handleToggleSpeaker = async () => {
    triggerHapticFeedback("light");
    const nextSpeaker = !isSpeakerOn;
    setIsSpeakerOn(nextSpeaker);
    await mobileAudioRoutingService.setAudioRoute(
      nextSpeaker ? "speaker" : "earpiece",
      remoteAudioRef.current
    );
  };

  const handleFlipCamera = async () => {
    if (!webrtcRef.current || isFlippingCamera) return;
    triggerHapticFeedback("medium");
    setIsFlippingCamera(true);
    const targetFacing = cameraFacingMode === "user" ? "environment" : "user";
    try {
      const newStream = await webrtcRef.current.switchCamera(targetFacing);
      setCameraFacingMode(targetFacing);
      if (newStream && localVideoRef.current) {
        localVideoRef.current.srcObject = newStream;
        localVideoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.warn("[ChatCall] Camera switch error:", err);
    } finally {
      setTimeout(() => setIsFlippingCamera(false), 600);
    }
  };

  if (!isOpen) return null;

  const isVideoCall = callType === "video";
  const isConnected = callStage === "connected";
  const activeRemoteStream = remoteStreamRef.current || activeCallSessionService.getActiveSession()?.remoteStream;
  const hasLiveVideoTrack = Boolean(
    activeRemoteStream &&
    activeRemoteStream.getVideoTracks().length > 0 &&
    activeRemoteStream.getVideoTracks().some((t) => t.readyState !== "ended")
  );
  const showRemoteVideo = isVideoCall && (hasRemoteVideo || hasLiveVideoTrack);
  const isMainVideoVisible = isVideoCall && (isStreamSwapped ? !isVideoMuted : showRemoteVideo);

  const modalContent = (
    <>
      {/* Audio element for playing remote incoming voice/video audio (always mounted in DOM) */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        className="fixed -top-[9999px] -left-[9999px] opacity-0 pointer-events-none w-px h-px"
      />

      {/* FULL-SCREEN VIDEO CALL INTERFACE */}
      <div
        id="chat-call-screen"
        ref={modalContainerRef}
        onClick={handleScreenTap}
        className={`fixed inset-0 z-[99999] w-screen h-screen min-h-[100dvh] bg-[#0c0d12] text-white flex-col justify-between overflow-hidden select-none cursor-pointer ${
          isMinimized ? "hidden" : "flex"
        }`}
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {/* ========================================================================= */}
        {/* FULL-SCREEN VIDEO (User B Remote Stream by default, or self if swapped)   */}
        {/* ========================================================================= */}
        {isVideoCall && (
          <div
            className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden pointer-events-none"
            style={{ display: isMainVideoVisible ? "flex" : "none" }}
          >
            <video
              ref={attachFullScreenVideo}
              autoPlay
              playsInline
              muted={isStreamSwapped}
              // @ts-ignore
              webkit-playsinline="true"
              x5-playsinline="true"
              controls={false}
              className="w-full h-full object-cover"
              style={{
                transform: isStreamSwapped && cameraFacingMode === "user" ? "scaleX(-1)" : "none",
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* TOP HEADER: Minimize Button & Partner Info (Clean, NEVER obscured)        */}
        {/* ========================================================================= */}
        <header
          className={`relative z-30 w-full px-4 pt-3 sm:pt-5 pb-2 flex items-center justify-between transition-all duration-300 ease-out ${
            areControlsVisible
              ? "translate-y-0 opacity-100 pointer-events-auto"
              : "-translate-y-12 opacity-0 pointer-events-none"
          }`}
        >
          {/* Top-left: Minimize button + Partner info pill (Clean, wide clearance) */}
          <div className="flex items-center gap-2.5 max-w-[85%] sm:max-w-[75%]">
            <button
              type="button"
              id="btn-minimize-call"
              onClick={(e) => {
                e.stopPropagation();
                triggerHapticFeedback("light");
                setIsMinimized(true);
              }}
              className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 active:scale-95 text-white/90 hover:text-white flex items-center justify-center transition border border-white/15 backdrop-blur-xl cursor-pointer shadow-lg shrink-0 pointer-events-auto"
              title="Minimize Call (Floating PiP)"
              aria-label="Minimize Call"
            >
              <ChevronDown className="w-5 h-5 stroke-[2.5]" />
            </button>

            <div className="flex flex-col min-w-0 bg-black/60 backdrop-blur-xl px-3.5 py-1.5 rounded-2xl border border-white/15 shadow-xl pointer-events-auto">
              <h2 className="text-sm font-semibold text-white tracking-tight truncate max-w-[200px] xs:max-w-[260px] sm:max-w-[340px]">
                {partnerDisplayName}
              </h2>
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="shrink-0">{formattedDuration}</span>
                {skillName && skillName !== "Chat Call" && (
                  <span className="text-amber-300/90 truncate font-sans text-[10px] max-w-[120px]">
                    · {skillName}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ========================================================================= */}
        {/* DRAGGABLE CORNER VIDEO THUMBNAIL (Google Meet / FaceTime style)            */}
        {/* Positioned at bottom-28 right-4: NEVER obscures caller name at top!       */}
        {/* ========================================================================= */}
        {isVideoCall && (
          <motion.div
            id="chat-call-corner-pip"
            ref={cornerPipRef}
            drag
            dragElastic={0.12}
            dragMomentum={false}
            dragConstraints={modalContainerRef}
            whileTap={{ scale: 0.96 }}
            onClick={(e) => {
              e.stopPropagation();
              if (isDraggingRef.current) return;
              triggerHapticFeedback("light");
              setIsStreamSwapped((prev) => !prev);
            }}
            onDragStart={() => {
              isDraggingRef.current = true;
            }}
            onDragEnd={() => {
              setTimeout(() => {
                isDraggingRef.current = false;
              }, 120);
            }}
            className="absolute bottom-28 right-4 z-40 w-28 h-40 xs:w-32 xs:h-44 sm:w-36 sm:h-48 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/25 bg-zinc-900/95 backdrop-blur-md pointer-events-auto cursor-grab active:cursor-grabbing touch-none select-none ring-1 ring-black/50"
            style={{
              boxShadow: "0 14px 35px -6px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5)",
            }}
            title="Tap to swap view · Drag to reposition"
          >
            <video
              ref={attachPipThumbnailVideo}
              autoPlay
              muted={!isStreamSwapped}
              playsInline
              className={`w-full h-full object-cover pointer-events-none ${
                !isStreamSwapped && isVideoMuted ? "hidden" : "block"
              }`}
              style={{
                transform: !isStreamSwapped && cameraFacingMode === "user" ? "scaleX(-1)" : "none",
              }}
            />

            {!isStreamSwapped && isVideoMuted && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-zinc-900 text-white/50 p-2 text-center pointer-events-none">
                <VideoOff size={22} className="text-rose-400" />
                <span className="text-[10px] font-medium text-zinc-400">Camera Off</span>
              </div>
            )}

            {isStreamSwapped && !showRemoteVideo && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-zinc-900 text-white/50 p-2 text-center pointer-events-none">
                <VideoOff size={22} className="text-sky-400" />
                <span className="text-[10px] font-medium text-zinc-400">{partnerDisplayName}</span>
              </div>
            )}

            {/* Tap-to-Swap Badge */}
            <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between px-2 py-0.5 rounded-full bg-black/65 backdrop-blur-xs text-[9px] font-medium text-white/90 border border-white/10 pointer-events-none select-none">
              <span className="truncate max-w-[70px]">
                {isStreamSwapped ? partnerDisplayName : "You"}
              </span>
              <RefreshCw size={10} className="text-white/70 shrink-0 ml-1" />
            </div>
          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* VOICE CALL / CONNECTING AVATAR VIEW (Google Meet Ambient Glow)            */}
        {/* ========================================================================= */}
        {!isMainVideoVisible && (
          <div className="relative z-20 flex-1 flex flex-col items-center justify-center px-6 my-auto text-center">
            {/* Subtle Ambient Radial Glow */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
              <div className="w-80 h-80 sm:w-96 sm:h-96 rounded-full bg-gradient-to-tr from-sky-500/15 via-indigo-500/10 to-amber-500/15 blur-3xl animate-pulse" />
            </div>

            {/* Circular Avatar with refined pulse rings */}
            <div className="relative mb-6 flex items-center justify-center">
              {(callStage === "calling" || callStage === "ringing" || callStage === "connecting") && (
                <>
                  <div
                    className="absolute w-44 h-44 sm:w-52 sm:h-52 rounded-full border border-sky-400/30 bg-sky-500/10 animate-ping pointer-events-none"
                    style={{ animationDuration: "2.4s" }}
                  />
                  <div
                    className="absolute w-36 h-36 sm:w-44 sm:h-44 rounded-full border border-sky-400/20 bg-sky-500/5 animate-pulse pointer-events-none"
                    style={{ animationDuration: "1.8s" }}
                  />
                </>
              )}

              <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full overflow-hidden ring-4 ring-white/20 shadow-2xl relative z-10 bg-zinc-800">
                <SmartImage
                  src={partnerDisplayPhoto || DEFAULT_AVATAR}
                  alt={partnerDisplayName}
                  className="w-full h-full object-cover"
                  fallbackType="profile"
                  fullName={partnerDisplayName}
                />
              </div>
            </div>

            {/* Name Display */}
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight">
              {partnerDisplayName}
            </h1>

            {skillName && skillName !== "Chat Call" && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#C9A96E]/15 border border-[#C9A96E]/30 text-[#C9A96E] text-xs font-medium tracking-wide">
                <span>{skillName}</span>
              </div>
            )}

            {/* Status Badge */}
            <div className="mt-4 min-h-[36px] flex items-center justify-center">
              {isConnected ? (
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm font-mono font-medium text-emerald-400 tracking-wider">
                    {formattedDuration}
                  </span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                  <span className="text-xs font-medium text-white/90 tracking-wide">
                    {statusText || (isCaller ? "Calling..." : "Connecting...")}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}


        {/* ========================================================================= */}
        {/* BOTTOM CALL CONTROLS (Clean Google Meet / iOS FaceTime Floating Dock)    */}
        {/* ========================================================================= */}
        <footer
          className={`relative z-30 w-full px-4 pb-8 pt-4 flex flex-col items-center justify-center bg-gradient-to-t from-black via-black/70 to-transparent transition-all duration-300 ease-out ${
            areControlsVisible
              ? "translate-y-0 opacity-100 pointer-events-auto"
              : "translate-y-16 opacity-0 pointer-events-none"
          }`}
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
        >
          <div
            className="flex items-center justify-center gap-3.5 sm:gap-5 px-5 py-3 rounded-full bg-black/60 backdrop-blur-2xl border border-white/15 shadow-2xl"
          >
          {/* 1. MUTE / UNMUTE MICROPHONE */}
          <button
            type="button"
            id="btn-call-mute-mic"
            onClick={handleToggleMic}
            className={`w-13 h-13 sm:w-15 sm:h-15 rounded-full flex items-center justify-center transition-transform active:scale-90 shadow-md cursor-pointer ${
              isAudioMuted
                ? "bg-rose-600 text-white shadow-rose-600/30 ring-2 ring-rose-400/40"
                : "bg-white/15 hover:bg-white/20 active:bg-white/25 text-white backdrop-blur-md border border-white/20"
            }`}
            title={isAudioMuted ? "Unmute" : "Mute"}
            aria-label="Toggle Microphone"
          >
            {isAudioMuted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>

          {/* 2. CAMERA TOGGLE (In Video Call) */}
          {isVideoCall && (
            <button
              type="button"
              id="btn-call-toggle-camera"
              onClick={handleToggleVideo}
              className={`w-13 h-13 sm:w-15 sm:h-15 rounded-full flex items-center justify-center transition-transform active:scale-90 shadow-md cursor-pointer ${
                isVideoMuted
                  ? "bg-rose-600/90 text-white ring-2 ring-rose-400/30"
                  : "bg-white/15 hover:bg-white/20 active:bg-white/25 text-white backdrop-blur-md border border-white/20"
              }`}
              title={isVideoMuted ? "Camera On" : "Camera Off"}
              aria-label="Toggle Camera"
            >
              {isVideoMuted ? <VideoOff size={22} /> : <Video size={22} />}
            </button>
          )}

          {/* 3. FLIP CAMERA (In Video Call) */}
          {isVideoCall && (
            <button
              type="button"
              id="btn-call-flip-camera"
              onClick={handleFlipCamera}
              disabled={isVideoMuted || isFlippingCamera}
              className={`w-13 h-13 sm:w-15 sm:h-15 rounded-full flex items-center justify-center transition-transform active:scale-90 shadow-md cursor-pointer ${
                isVideoMuted
                  ? "bg-white/5 text-white/30 border border-white/5 cursor-not-allowed"
                  : "bg-white/15 hover:bg-white/20 active:bg-white/25 text-white backdrop-blur-md border border-white/20"
              }`}
              title="Flip Camera"
              aria-label="Flip Camera"
            >
              <RefreshCw size={20} className={isFlippingCamera ? "animate-spin" : ""} />
            </button>
          )}

          {/* 4. SPEAKER TOGGLE (Available in both Voice and Video Call) */}
          <button
            type="button"
            id="btn-call-toggle-speaker"
            onClick={handleToggleSpeaker}
            className={`w-13 h-13 sm:w-15 sm:h-15 rounded-full flex items-center justify-center transition-transform active:scale-90 shadow-md cursor-pointer ${
              isSpeakerOn
                ? "bg-sky-500/90 text-white ring-2 ring-sky-400/40"
                : "bg-white/15 hover:bg-white/20 active:bg-white/25 text-white backdrop-blur-md border border-white/20"
            }`}
            title={isSpeakerOn ? "Speaker On" : "Earpiece"}
            aria-label="Toggle Speaker"
          >
            {isSpeakerOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
          </button>

          {/* 5. LARGE RED END CALL BUTTON */}
          <button
            type="button"
            id="btn-call-end"
            onClick={() => handleEndCall("User ended call")}
            className="w-16 h-16 sm:w-18 sm:h-18 rounded-full bg-red-600 hover:bg-red-500 active:bg-red-700 text-white flex items-center justify-center shadow-xl shadow-red-600/40 ring-4 ring-red-500/20 cursor-pointer transition-transform active:scale-90"
            title="End Call"
            aria-label="End Call"
          >
            <PhoneOff size={26} />
          </button>
        </div>
      </footer>
    </div>

      {/* ========================================================================= */}
      {/* DRAGGABLE FLOATING MINI-CALL WINDOW (IMO STYLE: ONLY USER B VIDEO)         */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isMinimized && (
          <motion.div
            id="chat-call-mini-pip"
            drag
            dragElastic={0.1}
            dragMomentum={false}
            dragConstraints={{
              left: -(typeof window !== "undefined" ? window.innerWidth - 140 : 260),
              right: 0,
              top: -(typeof window !== "undefined" ? 50 : 20),
              bottom: typeof window !== "undefined" ? window.innerHeight - 220 : 500,
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
            {isVideoCall ? (
              <div className="w-full h-full relative bg-black overflow-hidden">
                <video
                  ref={attachMiniRemoteVideo}
                  autoPlay
                  playsInline
                  muted={true}
                  className="w-full h-full object-cover block"
                />
                {!showRemoteVideo && (
                  <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center p-2.5 text-center bg-zinc-950">
                    <div className="w-12 h-12 rounded-full overflow-hidden ring-1 ring-white/20 bg-zinc-800 shadow-md mb-1.5">
                      <SmartImage
                        src={partnerDisplayPhoto || DEFAULT_AVATAR}
                        alt={partnerDisplayName}
                        className="w-full h-full object-cover"
                        fallbackType="profile"
                        fullName={partnerDisplayName}
                      />
                    </div>
                    <span className="text-[11px] font-medium text-white truncate max-w-[95px]">
                      {partnerDisplayName}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 mt-0.5">
                      {formattedDuration}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-2.5 text-center bg-zinc-950">
                <div className="w-12 h-12 rounded-full overflow-hidden ring-1 ring-white/20 bg-zinc-800 shadow-md mb-1.5">
                  <SmartImage
                    src={partnerDisplayPhoto || DEFAULT_AVATAR}
                    alt={partnerDisplayName}
                    className="w-full h-full object-cover"
                    fallbackType="profile"
                    fullName={partnerDisplayName}
                  />
                </div>
                <span className="text-[11px] font-medium text-white truncate max-w-[95px]">
                  {partnerDisplayName}
                </span>
                <span className="text-[10px] font-mono text-emerald-400 mt-0.5">
                  {formattedDuration}
                </span>
              </div>
            )}

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
