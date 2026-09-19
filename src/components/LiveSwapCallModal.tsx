import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
} from "lucide-react";
import { doc, onSnapshot, updateDoc, serverTimestamp, Unsubscribe } from "firebase/firestore";
import { db } from "../firebase";
import { DEFAULT_AVATAR } from "../types";
import { WebRTCService } from "../services/webrtcService";
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
} from "../utils/sound";

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

  // Media Controls State
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(initialCallType === "audio");
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [cameraFlipError, setCameraFlipError] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const durationSecondsRef = useRef(0);
  durationSecondsRef.current = durationSeconds;

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

  useEffect(() => {
    mobileForegroundService.isPipSupported().then((supported) => {
      setNativePipSupported(supported);
    });
  }, []);

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

    remoteStreamRef.current = null;
    setHasRemoteVideo(false);
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
      await performFullCleanup(reason, true);

      setTimeout(() => {
        onSessionCompletedRef.current?.(sessionId);
        onCloseRef.current();
      }, 800);
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

        // 1. Start Native Foreground Service EARLY to protect camera & mic before capture
        mobileForegroundService.startCallForegroundService({
          partnerName: partnerNameRef.current || partnerName,
          callType: initialCallType,
          sessionId,
          callId,
        });

        // 2. Ensure local media is active
        const localStream = passedLocalStream || (await acquireLocalMedia());
        if (!localStream) {
          throw new Error("Unable to access local camera or microphone.");
        }

        // 2. Initialize WebRTC Service with dynamically loaded ICE servers (STUN + TURN relay)
        const iceServers = await WebRTCService.fetchIceServers();
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

        // 40s connection timeout for initial negotiation
        if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = setTimeout(() => {
          if (callStageRef.current === "calling" || callStageRef.current === "ringing" || callStageRef.current === "connecting") {
            console.warn("[LiveSwap] Call connection timed out after 40s");
            stopOutgoingRingtone();
            setCallStage("failed");
            setStatusMessage("Connection timed out");
            setErrorMessage("Partner did not answer or connection timed out. Please try again.");
          }
        }, 40000);

        // 5. Write Offer Document to Firestore /calls/{callId}
        await callSignalingService.initiateCall({
          callId,
          sessionId,
          callerId: currentUserId,
          callerName: currentUserNameRef.current,
          callerPhoto: currentUserPhotoRef.current,
          receiverId: partnerUidRef.current,
          receiverName: partnerNameRef.current,
          receiverPhoto: partnerPhotoRef.current,
          callType: isVideoMutedRef.current ? "audio" : "video",
          skillName: skillNameRef.current,
          offer,
        });

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
            setStatusMessage(`${partnerNameRef.current} has ended the call.`);
            setTimeout(() => {
              handleEndCall("Remote peer ended");
            }, 1500);
            return;
          }

          if (callData.answer && callData.answer.sdp !== lastHandledAnswerSdp) {
            lastHandledAnswerSdp = callData.answer.sdp;
            console.log(`[SIGNALING] ANSWER_RECEIVED on offerer for call ${callId}`);
            stopOutgoingRingtone();
            setCallStage("connecting");
            setStatusMessage("Connecting to swap partner...");
            await webrtc.setRemoteAnswer(callData.answer.sdp);
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

        // 2. Ensure local media is active
        const localStream = passedLocalStream || (await acquireLocalMedia());
        if (!localStream) {
          throw new Error("Unable to access local camera or microphone.");
        }

        // 2. Initialize WebRTC Service with dynamically loaded ICE servers (STUN + TURN relay)
        const iceServers = await WebRTCService.fetchIceServers();
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
          isCaller: false,
          localStream,
          webrtcService: webrtc,
        });

        // 3. Configure Mobile Speaker Audio
        await mobileAudioRoutingService.setAudioRoute("speaker", remoteAudioRef.current);

        // 4. Listen for Caller's ICE Candidates
        unsubCandidatesRef.current = callSignalingService.listenToCallerCandidates(
          callId,
          (cand) => {
            webrtc.addIceCandidate(cand);
          }
        );

        // 5. Listen for the Offer document and generate Answer (handles initial & renegotiated offers)
        let lastHandledOfferSdp = "";
        unsubCallRef.current = callSignalingService.listenToCall(callId, async (callData) => {
          if (!callData) return;

          if (callData.status === "ended" || (callData.status as any) === "cancelled") {
            playCallEnded();
            hasExplicitlyEndedRef.current = true;
            activeCallSessionService.endActiveCallExplicitly("Remote peer ended the call");
            cleanupActiveCall("Remote peer ended the call");
            setCallStage("ended");
            setStatusMessage(`${partnerNameRef.current} has ended the call.`);
            setTimeout(() => {
              handleEndCall("Remote peer ended");
            }, 1500);
            return;
          }

          if (callData.offer && callData.offer.sdp !== lastHandledOfferSdp) {
            lastHandledOfferSdp = callData.offer.sdp;
            console.log(`[LIVE SWAP] Offer received on Answerer for call ${callId}. Creating answer...`);
            const answer = await webrtc.createAnswer(callData.offer.sdp);
            await callSignalingService.answerCall(callId, answer);
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

        // CASE 1: Direct incoming call answerer (User clicked Accept on IncomingCallPrompt)
        if (incomingCallId && !isCaller && !hasInitiatedRef.current) {
          hasInitiatedRef.current = true;
          activeCallIdRef.current = incomingCallId;
          isNegotiatingRef.current = true;
          console.log(`[CALL_TRACE] Step 5: Direct Answerer startup for incomingCallId: ${incomingCallId}`);
          startAnswererWorkflowRef.current(incomingCallId, stream);
          return;
        }

        // CASE 2: Explicit caller initiated call
        if (isCaller && !hasInitiatedRef.current) {
          hasInitiatedRef.current = true;
          const newCallId = generateUniqueCallId(sessionId);
          activeCallIdRef.current = newCallId;
          isNegotiatingRef.current = true;
          console.log(`[CALL_TRACE] Step 5: Direct Caller startup for callId: ${newCallId}`);

          updateDoc(doc(db, "sessions", sessionId), {
            currentCallId: newCallId,
            callUpdatedAt: serverTimestamp(),
          }).catch((err) => {
            console.warn("[LiveSwap] Error syncing currentCallId to session doc:", err);
          });

          startOffererWorkflowRef.current(newCallId, stream);
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

            console.log(`[LIVE SWAP]\nPARTICIPANT_COUNT: ${count}`);

            // If less than 2 participants -> Waiting state (only if call has not initiated yet)
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

            // Exactly 2 participants in room -> Deterministic election
            const sortedUids = [...participants].sort();
            const offererUid = sortedUids[0];
            const amIOfferer = currentUserId === offererUid;

            if (amIOfferer) {
              if (!isNegotiatingRef.current && !activeCallIdRef.current && !hasInitiatedRef.current) {
                hasInitiatedRef.current = true;
                const newCallId = generateUniqueCallId(sessionId);
                activeCallIdRef.current = newCallId;
                isNegotiatingRef.current = true;

                try {
                  await updateDoc(sessionDocRef, {
                    currentCallId: newCallId,
                    callUpdatedAt: serverTimestamp(),
                  });
                } catch (err) {
                  console.warn("[LiveSwap] Error syncing currentCallId to session doc:", err);
                }

                console.log(`[CALL_TRACE] Step 5: Deterministic Offerer startup for callId: ${newCallId}`);
                startOffererWorkflowRef.current(newCallId, localStreamRef.current);
              }
            } else {
              const activeCallIdOnSession = data.currentCallId;
              if (
                activeCallIdOnSession &&
                activeCallIdRef.current !== activeCallIdOnSession &&
                !isNegotiatingRef.current &&
                !hasInitiatedRef.current
              ) {
                hasInitiatedRef.current = true;
                activeCallIdRef.current = activeCallIdOnSession;
                isNegotiatingRef.current = true;

                console.log(`[CALL_TRACE] Step 5: Deterministic Answerer startup for callId: ${activeCallIdOnSession}`);
                startAnswererWorkflowRef.current(activeCallIdOnSession, localStreamRef.current);
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

  const modalContent = (
    <div
      id="webrtc-liveswap-modal"
      onPointerDown={handleUserInteraction}
      className={`fixed inset-0 z-50 bg-[#0B0C10] text-white flex flex-col justify-between select-none overflow-hidden ${
        isNativePip ? "p-0" : ""
      }`}
      style={
        isNativePip
          ? { height: "100%", width: "100%", padding: 0 }
          : {
              height: "100dvh",
              paddingTop: "env(safe-area-inset-top, 0px)",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)",
            }
      }
    >
      {/* Audio Element for Remote Incoming Audio */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        className="fixed -top-[9999px] -left-[9999px] opacity-0 pointer-events-none w-px h-px"
      />

      {/* ========================================================================= */}
      {/* 1. TOP BAR (Clean Responsive Header)                                      */}
      {/* ========================================================================= */}
      <header className={`relative z-30 w-full px-3 xs:px-4 sm:px-6 py-2.5 sm:py-3.5 bg-gradient-to-b from-[#0B0C10]/95 via-[#0B0C10]/60 to-transparent flex items-center justify-between pointer-events-auto shrink-0 ${
        isNativePip ? "hidden" : ""
      }`}>
        <div className="flex items-center gap-2 xs:gap-3 min-w-0">
          <div className="relative shrink-0">
            <img
              src={partnerPhoto || DEFAULT_AVATAR}
              alt={partnerName}
              className="w-9 h-9 xs:w-10 xs:h-10 rounded-full object-cover ring-2 ring-white/20 shadow-md"
              referrerPolicy="no-referrer"
            />
            <span
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-[#0B0C10] ${
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

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs xs:text-sm sm:text-base font-bold text-white tracking-tight truncate max-w-[110px] xs:max-w-[150px] sm:max-w-[220px]">
                {partnerName}
              </span>
              {skillName && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-[#C9A96E] bg-[#C9A96E]/10 px-2 py-0.5 rounded-full border border-[#C9A96E]/25 truncate max-w-[150px]">
                  <Sparkles className="w-3 h-3" />
                  <span className="truncate">{skillName}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 text-[11px] xs:text-xs text-white/60">
              <span
                className={`inline-block w-1.5 h-1.5 xs:w-2 xs:h-2 rounded-full shrink-0 ${
                  callStage === "connected"
                    ? "bg-emerald-400"
                    : callStage === "failed"
                    ? "bg-rose-500"
                    : callStage === "reconnecting"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-sky-400 animate-pulse"
                }`}
              />
              <span className="capitalize truncate max-w-[120px] xs:max-w-[180px] sm:max-w-none">{statusMessage}</span>
            </div>
          </div>
        </div>

        {/* Top Status & Timer Indicators */}
        <div className="flex items-center gap-1.5 xs:gap-2 shrink-0">
          {/* Native PiP Button (Android Picture-in-Picture) */}
          {nativePipSupported && (
            <button
              type="button"
              id="btn-enter-native-pip"
              onClick={() => mobileForegroundService.enterPipMode()}
              className="p-1.5 xs:p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/15 text-white/90 hover:text-white transition cursor-pointer"
              title="Picture in picture"
              aria-label="Picture in picture"
            >
              <Minimize2 className="w-3.5 h-3.5 xs:w-4 xs:h-4" />
            </button>
          )}

          <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 text-white/80 text-[11px] font-medium border border-white/10">
            <Users className="w-3 h-3 text-[#C9A96E]" />
            <span>{participantCount}/2</span>
          </div>

          {/* Show Timer Pill when Connected or Reconnecting */}
          {(callStage === "connected" || callStage === "reconnecting") && (
            <div
              id="live-swap-timer-badge"
              className="flex items-center gap-1 xs:gap-1.5 px-2 xs:px-2.5 sm:px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white shadow-sm"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="text-[11px] xs:text-xs font-mono font-semibold tracking-wider">{formattedDuration}</span>
            </div>
          )}

          {/* Show LIVE status ONLY when: connecting, calling, ringing, connected, reconnecting */}
          {isLiveActive && (
            <div
              id="live-swap-status-badge"
              className="flex items-center gap-1 xs:gap-1.5 px-2 xs:px-2.5 py-1 rounded-full bg-emerald-500/20 backdrop-blur-md border border-emerald-500/40 text-emerald-400 shadow-sm"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="text-[10px] xs:text-[11px] font-bold tracking-wider">LIVE</span>
            </div>
          )}
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. MAIN STAGE (Remote User Full-Screen Video & IMO Avatar Calling UI)     */}
      {/* ========================================================================= */}
      {(() => {
        const isRemoteVideoActive =
          (callStage === "connected" || callStage === "reconnecting") &&
          (hasRemoteVideo ||
            Boolean(remoteStreamRef.current?.getVideoTracks().some((t) => t.enabled && t.readyState !== "ended")));

        return (
          <div className="relative flex-1 w-full h-full min-h-0 flex items-center justify-center overflow-hidden bg-black">
            {/* Remote Video Stream (Full-screen when connected and active) */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={true}
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                isRemoteVideoActive ? "opacity-100" : "opacity-0 absolute"
              }`}
            />

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

            {/* IMO-Style Center Calling / Ringing UI */}
            {!isRemoteVideoActive && (
              <div className={`flex flex-col items-center justify-center text-center z-10 max-w-sm max-h-full overflow-y-auto ${
                isNativePip ? "scale-75 p-2" : "px-4 py-6"
              }`}>
            <div className="relative mb-4 sm:mb-6 flex items-center justify-center">
              {(callStage === "calling" ||
                callStage === "ringing" ||
                callStage === "waiting" ||
                callStage === "connecting") && (
                <>
                  <div className="absolute w-28 h-28 xs:w-36 xs:h-36 sm:w-44 sm:h-44 rounded-full border border-sky-400/40 bg-sky-500/15 animate-ping pointer-events-none" />
                  <div className="absolute w-40 h-40 xs:w-48 xs:h-48 sm:w-56 sm:h-56 rounded-full border border-sky-400/20 bg-sky-500/10 animate-pulse pointer-events-none" />
                </>
              )}

              <img
                src={partnerPhoto || DEFAULT_AVATAR}
                alt={partnerName}
                className="relative w-24 h-24 xs:w-28 xs:h-28 sm:w-36 sm:h-36 rounded-full object-cover ring-4 ring-white/20 shadow-2xl z-10"
                referrerPolicy="no-referrer"
              />
            </div>

            <h3 className="text-xl xs:text-2xl sm:text-3xl font-bold text-white mb-1 tracking-tight truncate max-w-xs">
              {partnerName}
            </h3>

            {skillName ? (
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#C9A96E] bg-[#C9A96E]/10 px-3 py-1 rounded-full border border-[#C9A96E]/30 mb-3 sm:mb-4 truncate max-w-[260px]">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{skillName}</span>
              </span>
            ) : (
              <span className="text-xs sm:text-sm text-white/60 mb-3 sm:mb-4">1-on-1 Live Swap</span>
            )}

            {/* Status Label (Calling / Ringing / Connecting / Reconnecting - NEVER shown when connected) */}
            {callStage !== "connected" && (
              <div className="flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs xs:text-sm text-white/90 font-medium shadow-md">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    callStage === "failed"
                      ? "bg-rose-500"
                      : callStage === "reconnecting"
                      ? "bg-amber-400 animate-pulse"
                      : "bg-sky-400 animate-pulse"
                  }`}
                />
                <span className="truncate max-w-[220px]">{statusMessage}</span>
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

        {/* Floating PiP (Local User Preview) */}
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
          } w-24 h-36 xs:w-28 xs:h-40 sm:w-36 sm:h-52 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl z-40 bg-zinc-900/95 backdrop-blur-md flex items-center justify-center cursor-grab active:cursor-grabbing select-none touch-none transition-shadow`}
        >
          {/* Local Video Tag */}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover pointer-events-none ${
              facingMode === "user" ? "-scale-x-100" : ""
            } ${isVideoMuted ? "hidden" : "block"}`}
          />

          {/* Fallback Avatar if Local Camera is Off */}
          {isVideoMuted && (
            <div className="flex flex-col items-center justify-center gap-1 p-2 text-center pointer-events-none">
              <img
                src={currentUserPhoto || DEFAULT_AVATAR}
                alt={currentUserName}
                className="w-10 h-10 xs:w-12 xs:h-12 rounded-full object-cover border border-white/20 shadow-md"
                referrerPolicy="no-referrer"
              />
              <span className="text-[10px] text-white/70 font-semibold">Camera Off</span>
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
            className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 hover:bg-black/80 active:scale-90 text-white/90 border border-white/15 transition cursor-pointer"
            title="Flip camera"
            aria-label="Flip camera"
          >
            <SwitchCamera className="w-3.5 h-3.5" />
          </button>
          </div>
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
      {/* 4. BOTTOM CONTROLS DOCK (IMO-Style: Flip, Mute, Camera, End)              */}
      {/* ========================================================================= */}
      <footer className={`relative z-30 w-full px-3 xs:px-4 sm:px-6 py-3 sm:py-5 bg-gradient-to-t from-[#0B0C10]/95 via-[#0B0C10]/70 to-transparent flex items-center justify-center pointer-events-auto shrink-0 pb-safe ${
        isNativePip ? "hidden" : ""
      }`}>
        <div className="flex items-center justify-center gap-2.5 xs:gap-4 sm:gap-6 bg-zinc-900/85 backdrop-blur-xl border border-white/10 rounded-full px-3.5 xs:px-5 sm:px-7 py-2 xs:py-2.5 sm:py-3 shadow-2xl">
          {/* 1. Switch Camera (Front / Back) - When video is on */}
          <button
            type="button"
            id="btn-switch-camera"
            onClick={handleSwitchCamera}
            className={`flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform touch-manipulation ${
              isVideoMuted ? "opacity-40 pointer-events-none" : ""
            }`}
            title="Flip camera"
            aria-label="Flip camera"
            disabled={isVideoMuted}
          >
            <div className="w-10 h-10 xs:w-12 xs:h-12 sm:w-14 sm:h-14 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/25 text-white flex items-center justify-center backdrop-blur-md border border-white/15 shadow-md transition">
              <SwitchCamera className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <span className="text-[9px] xs:text-[11px] font-medium text-white/80 group-hover:text-white transition">
              Flip
            </span>
          </button>

          {/* 2. Speaker / Earpiece Toggle */}
          <button
            type="button"
            id="btn-toggle-speaker"
            onClick={handleToggleSpeaker}
            className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform touch-manipulation"
            title={isSpeakerOn ? "Speaker on" : "Earpiece mode"}
            aria-label="Toggle speaker"
          >
            <div className={`w-10 h-10 xs:w-12 xs:h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md transition ${
              isSpeakerOn
                ? "bg-white/15 text-white border-white/25"
                : "bg-white/5 text-white/60 border-white/10"
            }`}>
              {isSpeakerOn ? (
                <Volume2 className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-6 text-white" />
              ) : (
                <VolumeX className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-6 text-white/70" />
              )}
            </div>
            <span className="text-[9px] xs:text-[11px] font-medium text-white/80 group-hover:text-white transition">
              {isSpeakerOn ? "Speaker" : "Earpiece"}
            </span>
          </button>

          {/* 3. Mute / Unmute Microphone */}
          <button
            type="button"
            id="btn-toggle-mic"
            onClick={handleToggleMic}
            className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform touch-manipulation"
            title={isAudioMuted ? "Unmute microphone" : "Mute microphone"}
            aria-label="Toggle microphone"
          >
            <div
              className={`w-10 h-10 xs:w-12 xs:h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md transition ${
                isAudioMuted
                  ? "bg-rose-600 text-white border-rose-400/40 shadow-rose-600/30"
                  : "bg-white/10 hover:bg-white/20 active:bg-white/25 text-white border-white/15"
              }`}
            >
              {isAudioMuted ? (
                <MicOff className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-6 text-white" />
              ) : (
                <Mic className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-6 text-white" />
              )}
            </div>
            <span className="text-[9px] xs:text-[11px] font-medium text-white/80 group-hover:text-white transition">
              {isAudioMuted ? "Unmute" : "Mute"}
            </span>
          </button>

          {/* 4. Camera On / Off */}
          <button
            type="button"
            id="btn-toggle-video"
            onClick={handleToggleVideo}
            className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform touch-manipulation"
            title={isVideoMuted ? "Turn camera on" : "Turn camera off"}
            aria-label="Toggle camera"
          >
            <div
              className={`w-10 h-10 xs:w-12 xs:h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center backdrop-blur-md border shadow-md transition ${
                isVideoMuted
                  ? "bg-rose-600/80 text-white border-rose-400/30"
                  : "bg-white/10 hover:bg-white/20 active:bg-white/25 text-white border-white/15"
              }`}
            >
              {isVideoMuted ? (
                <VideoOff className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-6 text-white" />
              ) : (
                <Video className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-6 text-white" />
              )}
            </div>
            <span className="text-[9px] xs:text-[11px] font-medium text-white/80 group-hover:text-white transition">
              {isVideoMuted ? "Cam Off" : "Cam On"}
            </span>
          </button>

          {/* 5. End Call Button */}
          <button
            type="button"
            id="btn-end-call"
            onClick={() => handleEndCall("User ended call")}
            className="flex flex-col items-center gap-1 group cursor-pointer active:scale-90 transition-transform touch-manipulation"
            title="End call"
            aria-label="End call"
          >
            <div className="w-10 h-10 xs:w-12 xs:h-12 sm:w-14 sm:h-14 rounded-full bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white flex items-center justify-center shadow-lg shadow-rose-600/40 border border-rose-400/40 transition">
              <PhoneOff className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <span className="text-[9px] xs:text-[11px] font-bold text-rose-300 group-hover:text-rose-200 transition">
              End
            </span>
          </button>
        </div>
      </footer>
    </div>
  );

  return createPortal(modalContent, document.body);
}
