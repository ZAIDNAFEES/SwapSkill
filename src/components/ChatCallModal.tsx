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
} from "lucide-react";
import { doc, updateDoc, serverTimestamp, Unsubscribe } from "firebase/firestore";
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

  // Track muted states in refs for mobile screen-off event handlers
  const isAudioMutedRef = useRef<boolean>(false);
  isAudioMutedRef.current = isAudioMuted;
  const isVideoMutedRef = useRef<boolean>(callType === "audio");
  isVideoMutedRef.current = isVideoMuted;

  // References
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const webrtcRef = useRef<WebRTCService | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

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
  const performCleanup = useCallback((reason: string) => {
    // If component is unmounting but user did not explicitly click End Call, detach into background
    if (!hasExplicitlyEndedRef.current && activeCallSessionService.hasActiveCall()) {
      activeCallSessionService.markModalDetached();
      console.log(`[ChatCall] Modal unmounted while call is active. Preserving media & WebRTC in background.`);
      return;
    }

    if (hasEndedRef.current) return;
    hasEndedRef.current = true;
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
    async (reason = "User hung up", overrideStatus?: "completed" | "missed" | "declined" | "failed") => {
      if (hasExplicitlyEndedRef.current) return;
      hasExplicitlyEndedRef.current = true;

      const callId = activeCallIdRef.current;
      const duration = durationSecondsRef.current;
      const wasConnected = callStageRef.current === "connected" || duration > 0;

      const finalStatus: "completed" | "missed" | "declined" | "failed" =
        overrideStatus || (wasConnected ? "completed" : isCaller ? "missed" : "declined");

      console.log(`[ChatCall] handleEndCall: callId=${callId}, wasConnected=${wasConnected}, duration=${duration}s, status=${finalStatus}`);

      setCallStage("ended");
      setStatusText(finalStatus === "completed" ? "Call ended" : reason);
      playCallEnded();

      // Shut down Foreground Service, CallKit, and media tracks
      await activeCallSessionService.endActiveCallExplicitly(reason);
      await mobileForegroundService.stopCallForegroundService();
      if (callId) {
        await mobileCallKitService.endCall(callId);
      }
      await mobileLifecycleService.releaseCallWakeLock();
      await mobileAudioRoutingService.resetAudioRouting(remoteAudioRef.current);
      mobilePermissionService.releaseActiveStream();

      performCleanup(reason);

      // 1. Update Firestore call document via signaling service
      if (callId) {
        try {
          await callSignalingService.endCall(callId, reason, sessionIdRef.current, duration);
        } catch (err) {
          console.warn("[ChatCall] Error writing call end status:", err);
        }
      }

      // 2. Log to conversation thread
      if (conversationId && callId) {
        try {
          await logCallToConversation({
            conversationId,
            callId,
            callType,
            status: finalStatus,
            durationSeconds: duration,
            callerId: isCaller ? currentUserId : partnerUid,
            callerName: isCaller ? currentUserName : partnerName,
            receiverId: isCaller ? partnerUid : currentUserId,
            receiverName: isCaller ? partnerName : currentUserName,
            currentUserId,
          });
        } catch (err) {
          console.warn("[ChatCall] Error logging call:", err);
        }
      }

      // Close modal smoothly
      setTimeout(() => {
        onCloseRef.current();
      }, 400);
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

  // Handle remote media track reception
  const handleRemoteStream = useCallback((stream: MediaStream) => {
    console.log(`[ChatCall] Remote stream received: videoTracks=${stream.getVideoTracks().length}, audioTracks=${stream.getAudioTracks().length}`);
    remoteStreamRef.current = stream;

    const hasLiveVideo = stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
    setHasRemoteVideo(hasLiveVideo);

    if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== stream) {
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.play().catch(() => {});
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
      };
      track.onmute = () => {
        setHasRemoteVideo(false);
      };
    });
  }, []);

  // Main Call Setup Lifecycle - Executes ONCE per call session
  useEffect(() => {
    if (!isOpen || !partnerUid || !currentUserId) return;
    hasEndedRef.current = false;

    let isCancelled = false;
    const callId = incomingCallId || generateUniqueCallId(`chat_${conversationId || "call"}`);
    const sessionId = sessionIdProp || generateUniqueSessionId(`chat_${conversationId || "sess"}`);
    activeCallIdRef.current = callId;
    sessionIdRef.current = sessionId;

    console.log(`[ChatCall] Initiating call workflow: callId=${callId}, sessionId=${sessionId}, isCaller=${isCaller}, callType=${callType}`);
    callSignalingService.registerActiveCall(sessionId, callId);
    mobileLifecycleService.acquireCallWakeLock();

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

        // Step A: Acquire Local Media Stream Immediately
        const mediaRes = await mobilePermissionService.acquireCallMediaStream({
          video: callType === "video",
          audio: true,
          facingMode: "user",
        });

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

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          localVideoRef.current.play().catch(() => {});
        }

        // Step B: Fetch ICE servers (fast fallback to STUN if backend slow)
        const iceServers = await WebRTCService.fetchIceServers();
        if (isCancelled || hasEndedRef.current) return;

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

        // Step D: Configure Audio Route (Speaker for video, earpiece/speaker for voice)
        await mobileAudioRoutingService.setAudioRoute(
          callType === "video" ? "speaker" : "earpiece",
          remoteAudioRef.current
        );

        // ==========================================
        // CALLER WORKFLOW: Generate Offer and Send
        // ==========================================
        if (isCaller) {
          // Listen to Callee Candidates immediately
          unsubCandidatesRef.current = callSignalingService.listenToCalleeCandidates(
            callId,
            (candidate) => {
              webrtc.addIceCandidate(candidate);
            }
          );

          // Generate Offer and write to Firestore calls/{callId}
          const offer = await webrtc.createOffer();
          if (isCancelled || hasEndedRef.current) return;

          await callSignalingService.initiateCall({
            callId,
            sessionId,
            conversationId,
            callerId: currentUserId,
            callerName: currentUserName,
            callerPhoto: currentUserPhoto,
            receiverId: partnerUid,
            receiverName: partnerName,
            receiverPhoto: partnerPhoto,
            callType,
            skillName: "Chat Call",
            offer,
          });

          // Listen to Call Document for Answer and Remote Status
          let hasHandledAnswer = false;
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
              setTimeout(() => handleEndCallRef.current("Call declined", "declined"), 1200);
            } else if (callData.status === "ended") {
              stopAllCallSounds();
              setStatusText("Call ended");
              playCallEnded();
              setTimeout(() => handleEndCallRef.current("Remote peer ended", "completed"), 800);
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
            }
          });
        }
        // ==========================================
        // CALLEE WORKFLOW: Read Offer and Answer
        // ==========================================
        else {
          // Listen to Caller Candidates immediately so no candidates are missed
          unsubCandidatesRef.current = callSignalingService.listenToCallerCandidates(
            callId,
            (candidate) => {
              webrtc.addIceCandidate(candidate);
            }
          );

          // Listen to Call Document to receive Offer
          let hasAnswered = false;
          unsubCallRef.current = callSignalingService.listenToCall(callId, async (callData) => {
            if (!callData || hasEndedRef.current) return;

            if (callData.status === "ended") {
              setStatusText("Call ended");
              playCallEnded();
              setTimeout(() => handleEndCallRef.current("Caller ended the call", "completed"), 800);
              return;
            }

            if (callData.status === "rejected" || (callData.status as any) === "cancelled") {
              setStatusText("Call ended");
              playCallEnded();
              setTimeout(() => handleEndCallRef.current("Call was cancelled", "declined"), 800);
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
              console.log("[ChatCall] Callee received offer. Creating answer immediately...");
              setCallStage("connecting");
              setStatusText("Connecting...");

              const answer = await webrtc.createAnswer(callData.offer.sdp);
              if (isCancelled || hasEndedRef.current) return;

              await callSignalingService.answerCall(callId, answer);
              console.log("[ChatCall] Callee answer written to Firestore successfully");
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
      isCancelled = true;
      unsubLife();
      unsubNet();
      unsubCallEndedNotification();
      performCleanup("Component unmounting");
    };
  }, [
    isOpen,
    incomingCallId,
    sessionIdProp,
    partnerUid,
    currentUserId,
    isCaller,
    callType,
    conversationId,
    currentUserName,
    currentUserPhoto,
    partnerName,
    partnerPhoto,
    handleRemoteStream,
    performCleanup,
    startDurationTimer,
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
  const showRemoteVideo = isVideoCall && isConnected && hasRemoteVideo;

  const modalContent = (
    <div
      id="chat-call-screen"
      className="fixed inset-0 z-[99999] w-full h-[100dvh] bg-[#0c0d12] text-white flex flex-col justify-between overflow-hidden select-none"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {/* Audio element for playing remote incoming voice/video audio */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        className="fixed -top-[9999px] -left-[9999px] opacity-0 pointer-events-none w-px h-px"
      />

      {/* ========================================================================= */}
      {/* FULL-SCREEN VIDEO (Video Call Remote Stream)                              */}
      {/* ========================================================================= */}
      {isVideoCall && (
        <div
          className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden"
          style={{ display: showRemoteVideo ? "flex" : "none" }}
        >
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            // @ts-ignore
            webkit-playsinline="true"
            x5-playsinline="true"
            controls={false}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* ========================================================================= */}
      {/* TOP HEADER: Clean Minimal Overlay (When Remote Video is Active)           */}
      {/* ========================================================================= */}
      <header className="relative z-30 w-full px-6 pt-6 pb-2 flex flex-col items-center justify-center text-center pointer-events-none">
        {showRemoteVideo ? (
          <div className="inline-flex flex-col items-center px-4 py-2 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 shadow-lg">
            <h2 className="text-base font-semibold text-white tracking-tight">{partnerName}</h2>
            <span className="text-xs font-mono font-medium text-emerald-400 mt-0.5 tracking-wider">
              {formattedDuration}
            </span>
          </div>
        ) : null}
      </header>

      {/* ========================================================================= */}
      {/* LOCAL CAMERA PiP (Video Call Only - Top Right)                            */}
      {/* ========================================================================= */}
      {isVideoCall && (
        <div
          id="chat-call-local-pip"
          className="absolute top-6 right-4 z-40 w-28 h-40 xs:w-32 xs:h-44 sm:w-36 sm:h-48 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/20 bg-zinc-900/90 backdrop-blur-sm pointer-events-auto transition-transform active:scale-95"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 20px)" }}
        >
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-cover ${isVideoMuted ? "hidden" : "block"}`}
            style={{ transform: cameraFacingMode === "user" ? "scaleX(-1)" : "none" }}
          />
          {isVideoMuted && (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-zinc-900 text-white/50 p-2 text-center">
              <VideoOff size={22} className="text-rose-400" />
              <span className="text-[10px] font-medium text-zinc-400">Camera Off</span>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VOICE CALL / CONNECTING AVATAR VIEW (IMO / WhatsApp Centered Aesthetic)   */}
      {/* ========================================================================= */}
      {!showRemoteVideo && (
        <div className="relative z-20 flex-1 flex flex-col items-center justify-center px-6 my-auto text-center">
          {/* Circular Avatar with subtle ringing pulse */}
          <div className="relative mb-6 flex items-center justify-center">
            {(callStage === "calling" || callStage === "ringing" || callStage === "connecting") && (
              <>
                <div
                  className="absolute w-44 h-44 sm:w-52 sm:h-52 rounded-full border border-sky-400/30 bg-sky-500/10 animate-ping pointer-events-none"
                  style={{ animationDuration: "2.4s" }}
                />
                <div
                  className="absolute w-36 h-36 sm:w-44 sm:h-44 rounded-full border border-sky-400/25 animate-pulse pointer-events-none"
                  style={{ animationDuration: "1.8s" }}
                />
              </>
            )}

            <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden ring-4 ring-white/20 shadow-2xl relative z-10 bg-zinc-800">
              <SmartImage
                src={partnerPhoto || DEFAULT_AVATAR}
                alt={partnerName}
                className="w-full h-full object-cover"
                fallbackType="profile"
                fullName={partnerName}
              />
            </div>
          </div>

          {/* Name Display */}
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight">
            {partnerName}
          </h1>

          {/* Status Text or Duration Timer */}
          <div className="mt-2 min-h-[28px] flex items-center justify-center">
            {isConnected ? (
              <span className="text-base sm:text-lg font-mono font-medium text-emerald-400 tracking-wider">
                {formattedDuration}
              </span>
            ) : (
              <span className="text-sm font-medium text-zinc-400 animate-pulse tracking-wide">
                {statusText}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BOTTOM CALL CONTROLS (Clean, Modern IMO/WhatsApp Styled, Touch Targets)   */}
      {/* ========================================================================= */}
      <footer
        className="relative z-30 w-full px-6 pb-8 pt-4 flex flex-col items-center justify-center pointer-events-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
      >
        <div
          className={`flex items-center justify-center gap-4 sm:gap-6 px-6 py-4 rounded-3xl ${
            showRemoteVideo ? "bg-black/40 backdrop-blur-xl border border-white/15 shadow-2xl" : ""
          }`}
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
  );

  return createPortal(modalContent, document.body);
}
