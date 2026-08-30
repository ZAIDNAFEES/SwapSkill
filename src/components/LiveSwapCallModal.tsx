import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { 
  Room, 
  RoomEvent, 
  Track, 
  VideoPresets, 
  AudioPresets,
  VideoQuality,
  ConnectionQuality,
  RemoteTrack, 
  RemoteTrackPublication, 
  RemoteParticipant 
} from "livekit-client";
import { 
  AlertCircle, 
  RefreshCw, 
  FlipHorizontal,
  ShieldCheck,
  Clock,
  Sparkles,
  Info
} from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { 
  fetchLiveKitToken, 
  getDeterministicLiveKitRoomName 
} from "../services/livekitService";
import { 
  joinLiveSession, 
  leaveLiveSession, 
  recordSessionLeaveBeacon 
} from "../services/sessionPresenceService";
import { DEFAULT_AVATAR } from "../types";
import { mobileLifecycleService } from "../services/mobile/lifecycle";
import { mobileNetworkService } from "../services/mobile/network";
import { mobileAudioRoutingService } from "../services/mobile/audio";

// Sub-components
import { PreCallLobby } from "./liveswap/PreCallLobby";
import { CallTopBar } from "./liveswap/CallTopBar";
import { CallControlsDock, AudioDeviceOption, VideoDeviceOption } from "./liveswap/CallControlsDock";
import { CallAvatarView } from "./liveswap/CallAvatarView";
import { InCallChatDrawer, LiveChatMessage } from "./liveswap/InCallChatDrawer";
import { EndCallConfirmModal } from "./liveswap/EndCallConfirmModal";
import { PostCallFeedbackModal } from "./liveswap/PostCallFeedbackModal";

export interface LiveSwapCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  partnerName: string;
  partnerPhoto?: string;
  partnerUid: string;
  sessionId: string;
  skillName?: string;
  currentUserId: string;
  currentUserName: string;
  currentUserPhoto?: string;
  sessionDuration?: number; // in minutes (e.g. 30, 45, 60)
  scheduledTime?: any;
  sessionEndTime?: any;
  onSessionCompleted?: (sessionId: string) => void;
  initialCallType?: "video" | "audio";
  isCaller?: boolean;
  incomingCallId?: string;
}

export type CallConnectionState = 
  | "lobby"
  | "initializing" 
  | "joining" 
  | "connected" 
  | "reconnecting" 
  | "ended" 
  | "failed";

export default function LiveSwapCallModal({
  isOpen,
  onClose,
  partnerName,
  partnerPhoto,
  partnerUid,
  sessionId,
  skillName,
  currentUserId,
  currentUserName,
  currentUserPhoto,
  sessionDuration = 30,
  scheduledTime,
  sessionEndTime,
  onSessionCompleted,
  initialCallType = "video"
}: LiveSwapCallModalProps) {
  if (!isOpen) return null;

  // DOM Refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);

  // LiveKit Instance Refs
  const roomRef = useRef<Room | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Pre-Call Lobby State
  const [isInLobby, setIsInLobby] = useState(true);

  // Connection & Media States
  const [connectionState, setConnectionState] = useState<CallConnectionState>("lobby");
  const [statusMessage, setStatusMessage] = useState<string>("Connecting to your partner…");
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(initialCallType === "audio");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMirrorLocal, setIsMirrorLocal] = useState(true);
  const [hasRemoteParticipant, setHasRemoteParticipant] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [hasRemoteAudio, setHasRemoteAudio] = useState(false);
  const [isPartnerSpeaking, setIsPartnerSpeaking] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<{ rawError?: string; serverUrl?: string; roomName?: string } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"pip" | "side-by-side">("pip");

  // Speaker / Audio Output Controls
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioDeviceOption[]>([]);
  const [currentAudioOutputId, setCurrentAudioOutputId] = useState<string | undefined>();
  const [videoDevices, setVideoDevices] = useState<VideoDeviceOption[]>([]);
  const [currentVideoDeviceId, setCurrentVideoDeviceId] = useState<string | undefined>();

  // Controls Auto-Hide Visibility State
  const [areControlsVisible, setAreControlsVisible] = useState(true);

  // Connection Quality & HD Stats
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>(ConnectionQuality.Good);
  const [isHdActive, setIsHdActive] = useState<boolean>(true);
  const [videoQualityTier, setVideoQualityTier] = useState<"1080p" | "720p" | "480p" | "360p" | "Auto">("1080p");
  const [actualResolution, setActualResolution] = useState<{ width: number; height: number } | null>(null);

  // Dynamically inspect video stream dimensions to accurately reflect 1080p Full HD, 720p HD, 480p SD
  useEffect(() => {
    const updateQualityStats = () => {
      const remoteEl = remoteVideoRef.current;
      const localEl = localVideoRef.current;

      let width = 0;
      let height = 0;

      // Remote video takes precedence when present, otherwise check local video
      if (remoteEl && hasRemoteVideo && remoteEl.videoWidth > 0 && remoteEl.videoHeight > 0) {
        width = remoteEl.videoWidth;
        height = remoteEl.videoHeight;
      } else if (localEl && !isVideoOff && localEl.videoWidth > 0 && localEl.videoHeight > 0) {
        width = localEl.videoWidth;
        height = localEl.videoHeight;
      }

      if (width > 0 && height > 0) {
        setActualResolution({ width, height });
        if (height >= 900) {
          setVideoQualityTier("1080p");
          setIsHdActive(true);
        } else if (height >= 600) {
          setVideoQualityTier("720p");
          setIsHdActive(true);
        } else if (height >= 400) {
          setVideoQualityTier("480p");
          setIsHdActive(false);
        } else {
          setVideoQualityTier("360p");
          setIsHdActive(false);
        }
      } else {
        if (connectionQuality === ConnectionQuality.Excellent || connectionQuality === ConnectionQuality.Good) {
          setVideoQualityTier("1080p");
          setIsHdActive(true);
        } else if (connectionQuality === ConnectionQuality.Poor) {
          setVideoQualityTier("480p");
          setIsHdActive(false);
        } else {
          setVideoQualityTier("360p");
          setIsHdActive(false);
        }
      }
    };

    const remoteEl = remoteVideoRef.current;
    const localEl = localVideoRef.current;

    if (remoteEl) {
      remoteEl.addEventListener("resize", updateQualityStats);
      remoteEl.addEventListener("loadedmetadata", updateQualityStats);
    }
    if (localEl) {
      localEl.addEventListener("resize", updateQualityStats);
      localEl.addEventListener("loadedmetadata", updateQualityStats);
    }

    const interval = setInterval(updateQualityStats, 2500);
    updateQualityStats();

    return () => {
      clearInterval(interval);
      if (remoteEl) {
        remoteEl.removeEventListener("resize", updateQualityStats);
        remoteEl.removeEventListener("loadedmetadata", updateQualityStats);
      }
      if (localEl) {
        localEl.removeEventListener("resize", updateQualityStats);
        localEl.removeEventListener("loadedmetadata", updateQualityStats);
      }
    };
  }, [hasRemoteVideo, isVideoOff, connectionQuality]);

  // In-Call Live Chat
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<LiveChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatUnreadCount, setChatUnreadCount] = useState(0);

  // End Call Confirmation Dialog
  const [showEndCallConfirm, setShowEndCallConfirm] = useState(false);

  // 5-Minute Alert Toast
  const [showExpiringSoonToast, setShowExpiringSoonToast] = useState(false);

  // Post-Call "Swap Complete" Dialog
  const [showPostCallModal, setShowPostCallModal] = useState(false);
  const [sessionEndedNotice, setSessionEndedNotice] = useState<string | null>(null);

  // Detect Screen Share support
  const isScreenShareSupported = useMemo(() => {
    return typeof navigator !== "undefined" && 
           typeof navigator.mediaDevices !== "undefined" && 
           typeof (navigator.mediaDevices as any).getDisplayMedia === "function";
  }, []);

  // Authoritative Session End Time and Countdown
  const targetEndTimeMs = useMemo(() => {
    if (sessionEndTime) {
      const t = sessionEndTime.seconds ? sessionEndTime.seconds * 1000 : new Date(sessionEndTime).getTime();
      if (!isNaN(t) && t > Date.now()) return t;
    }
    if (scheduledTime) {
      const s = scheduledTime.seconds ? scheduledTime.seconds * 1000 : new Date(scheduledTime).getTime();
      const durMs = (sessionDuration || 30) * 60 * 1000;
      if (!isNaN(s)) {
        const computed = s + durMs;
        if (computed > Date.now()) return computed;
      }
    }
    return Date.now() + (sessionDuration || 30) * 60 * 1000;
  }, [sessionEndTime, scheduledTime, sessionDuration]);

  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    return Math.max(0, Math.floor((targetEndTimeMs - Date.now()) / 1000));
  });

  const formattedRemaining = useMemo(() => {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, [remainingSeconds]);

  // Format Elapsed Call Duration MM:SS
  const formattedDuration = useMemo(() => {
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, [durationSeconds]);

  // Room Name
  const roomName = useMemo(() => getDeterministicLiveKitRoomName(sessionId), [sessionId]);

  // Reset unread count when chat opens
  useEffect(() => {
    if (showChat) {
      setChatUnreadCount(0);
    }
  }, [showChat]);

  // Show 5-minute remaining toast once
  useEffect(() => {
    if (remainingSeconds <= 300 && remainingSeconds > 290 && connectionState === "connected") {
      setShowExpiringSoonToast(true);
      const t = setTimeout(() => setShowExpiringSoonToast(false), 5000);
      return () => clearTimeout(t);
    }
  }, [remainingSeconds, connectionState]);

  // Controls Auto-Hide Behavior (4-second inactivity timeout)
  const resetAutoHideTimer = useCallback(() => {
    setAreControlsVisible(true);
    if (autoHideTimeoutRef.current) {
      clearTimeout(autoHideTimeoutRef.current);
      autoHideTimeoutRef.current = null;
    }

    // Do NOT auto-hide if chat drawer is open, end confirm is open, or in reconnecting/joining state
    if (showChat || showEndCallConfirm || connectionState !== "connected") {
      return;
    }

    autoHideTimeoutRef.current = setTimeout(() => {
      setAreControlsVisible(false);
    }, 4000);
  }, [showChat, showEndCallConfirm, connectionState]);

  // Track mouse and touch activity across container
  useEffect(() => {
    if (isInLobby) return;

    resetAutoHideTimer();

    const handleUserActivity = () => {
      resetAutoHideTimer();
    };

    window.addEventListener("mousemove", handleUserActivity);
    window.addEventListener("touchstart", handleUserActivity);

    return () => {
      window.removeEventListener("mousemove", handleUserActivity);
      window.removeEventListener("touchstart", handleUserActivity);
      if (autoHideTimeoutRef.current) {
        clearTimeout(autoHideTimeoutRef.current);
      }
    };
  }, [isInLobby, resetAutoHideTimer]);

  // Enumerate Media Devices
  const refreshDevices = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs: AudioDeviceOption[] = devices
          .filter((d) => d.kind === "audiooutput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "Speaker" }));
        const videos: VideoDeviceOption[] = devices
          .filter((d) => d.kind === "videoinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "Camera" }));

        setAudioOutputDevices(audioOutputs);
        setVideoDevices(videos);
      }
    } catch (e) {
      console.warn("[MediaDevices] Could not enumerate devices:", e);
    }
  }, []);

  /**
   * Complete clean-up of LiveKit room, tracks and timers
   */
  const cleanupCall = useCallback(async () => {
    console.log("[LiveKit Live Swap] Disconnecting and cleaning up session...");

    // Release Screen Wake Lock when call terminates
    mobileLifecycleService.releaseCallWakeLock().catch(() => {});

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    if (autoHideTimeoutRef.current) {
      clearTimeout(autoHideTimeoutRef.current);
      autoHideTimeoutRef.current = null;
    }

    if (roomRef.current) {
      try {
        await roomRef.current.disconnect();
      } catch (err) {
        console.warn("[LiveKit] Non-fatal error disconnecting room:", err);
      }
      roomRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  /**
   * Auto-End Call when authoritative duration reaches zero
   */
  const handleAutoEndDueToDuration = useCallback(async () => {
    console.log("[LiveKit Live Swap] Authoritative session duration reached zero. Ending call for everyone.");
    setSessionEndedNotice("Your Swap Session has reached its scheduled duration and ended.");
    await cleanupCall();
    setConnectionState("ended");
    await leaveLiveSession(sessionId, currentUserId, true);
    recordSessionLeaveBeacon(sessionId, currentUserId, true);
    setShowPostCallModal(true);
    onSessionCompleted?.(sessionId);
  }, [cleanupCall, sessionId, currentUserId, onSessionCompleted]);

  /**
   * User Confirmed Manual End / Leave Call
   */
  const handleConfirmEndCall = useCallback(async () => {
    console.log("[LiveKit Live Swap] User confirmed call termination.");
    setShowEndCallConfirm(false);
    
    // Broadcast instant call_ended signal over WebRTC data channel
    if (roomRef.current) {
      try {
        const payload = JSON.stringify({ type: "call_ended", by: currentUserId, reason: "user_ended" });
        const encoder = new TextEncoder();
        await roomRef.current.localParticipant.publishData(encoder.encode(payload), { reliable: true });
      } catch (e) {
        console.warn("[LiveKit] Non-fatal notification publish error:", e);
      }
    }

    await cleanupCall();
    setConnectionState("ended");
    
    // Immediately mark meeting as ended and status as completed for BOTH participants in Firestore
    await leaveLiveSession(sessionId, currentUserId, true);
    recordSessionLeaveBeacon(sessionId, currentUserId, true);

    setSessionEndedNotice("Swap Session completed!");
    onSessionCompleted?.(sessionId);
    setShowPostCallModal(true);
  }, [cleanupCall, sessionId, currentUserId, onSessionCompleted]);

  /**
   * Countdown Interval Tracker
   */
  useEffect(() => {
    if (isInLobby || (connectionState !== "connected" && connectionState !== "joining")) return;

    const interval = setInterval(() => {
      const rem = Math.max(0, Math.floor((targetEndTimeMs - Date.now()) / 1000));
      setRemainingSeconds(rem);

      if (rem <= 0 && connectionState === "connected") {
        clearInterval(interval);
        handleAutoEndDueToDuration();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isInLobby, connectionState, targetEndTimeMs, handleAutoEndDueToDuration]);

  /**
   * Real-time listener for remote session completion or authoritative termination
   */
  useEffect(() => {
    if (!sessionId) return;
    const sessionRef = doc(db, "sessions", sessionId);
    const unsubscribe = onSnapshot(sessionRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const s = (data.status || "").toLowerCase();
      const isEnded = data.sessionEnded === true || data.isEnded === true || data.meetingEnded === true || s === "completed";

      if (isEnded && (connectionState === "connected" || connectionState === "joining")) {
        console.log("[LiveKit Live Swap] Detected remote session completion. Ending active call.");
        setSessionEndedNotice("Your Swap Session has concluded.");
        cleanupCall();
        setConnectionState("ended");
        setShowPostCallModal(true);
        onSessionCompleted?.(sessionId);
      }
    });

    return () => unsubscribe();
  }, [sessionId, connectionState, cleanupCall, onSessionCompleted]);

  /**
   * Guaranteed unload & pagehide listeners to clean up live presence on tab close/refresh
   */
  useEffect(() => {
    const handleBeforeUnload = () => {
      recordSessionLeaveBeacon(sessionId, currentUserId, false);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
    };
  }, [sessionId, currentUserId]);

  /**
   * Helper to attach remote media track to DOM video/audio elements
   */
  const attachRemoteTrack = useCallback((track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) {
      console.log("[LiveKit] Remote VIDEO track subscribed. Attaching to remote video tag...");
      if (remoteVideoRef.current) {
        track.attach(remoteVideoRef.current);
        setHasRemoteVideo(true);
      }
    } else if (track.kind === Track.Kind.Audio) {
      console.log("[LiveKit] Remote AUDIO track subscribed. Attaching to remote audio element...");
      if (remoteAudioRef.current) {
        track.attach(remoteAudioRef.current);
        setHasRemoteAudio(true);
      }
    }
  }, []);

  /**
   * Helper to detach remote media track from DOM elements
   */
  const detachRemoteTrack = useCallback((track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) {
      console.log("[LiveKit] Remote VIDEO track unsubscribed/muted.");
      track.detach();
      setHasRemoteVideo(false);
    } else if (track.kind === Track.Kind.Audio) {
      console.log("[LiveKit] Remote AUDIO track unsubscribed/muted.");
      track.detach();
      setHasRemoteAudio(false);
    }
  }, []);

  /**
   * Main LiveKit Room Initialization & Join Routine
   */
  const joinLiveKitRoom = useCallback(async () => {
    try {
      setIsInLobby(false);
      setConnectionState("joining");
      setStatusMessage("Connecting to your partner…");
      setErrorMessage(null);
      setErrorDetails(null);

      // 1. Fetch token and LiveKit server URL
      const { token, serverUrl } = await fetchLiveKitToken({
        sessionId,
        userId: currentUserId,
        userName: currentUserName || "SwapSkill User",
        partnerUid,
      });

      setStatusMessage("Connecting to your partner…");

      // 2. Instantiate Room with HD Video and Adaptive Stream configurations
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: {
            width: 1920,
            height: 1080,
            frameRate: 30,
          },
          facingMode: "user",
        },
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        publishDefaults: {
          simulcast: true,
          videoCodec: "vp8",
          videoSimulcastLayers: [
            VideoPresets.h1080,
            VideoPresets.h720,
            VideoPresets.h540,
            VideoPresets.h360,
          ],
          videoEncoding: {
            maxBitrate: 3_500_000,
            maxFramerate: 30,
          },
          audioPreset: AudioPresets.speech,
          dtx: true,
          red: true,
        },
      });

      roomRef.current = room;

      // 3. Register Room Event Listeners
      room.on(RoomEvent.Connected, () => {
        console.log(`[LiveKit] Connected successfully to room: ${room.name}`);
        setConnectionState("connected");
        setStatusMessage("Connected");
        joinLiveSession(sessionId, currentUserId);
        refreshDevices();
        
        // Prevent screen sleep during active call on mobile/desktop
        mobileLifecycleService.acquireCallWakeLock().catch(() => {});

        // Start Call Elapsed Duration Timer
        if (!durationIntervalRef.current) {
          durationIntervalRef.current = setInterval(() => {
            setDurationSeconds((prev) => prev + 1);
          }, 1000);
        }

        // Check if remote participant is already present
        const remoteParticipants = Array.from(room.remoteParticipants.values());
        if (remoteParticipants.length > 0) {
          const partner = remoteParticipants[0];
          setHasRemoteParticipant(true);
          console.log(`[LiveKit] Detected existing remote participant: ${partner.identity}`);

          partner.trackPublications.forEach((publication) => {
            if (publication.isSubscribed && publication.track) {
              if (publication.kind === Track.Kind.Video && typeof (publication as any).setVideoQuality === "function") {
                (publication as any).setVideoQuality(VideoQuality.HIGH);
              }
              attachRemoteTrack(publication.track as RemoteTrack);
            }
          });
        }
      });

      room.on(RoomEvent.Disconnected, (reason) => {
        console.log("[LiveKit] Room disconnected:", reason);
        if (connectionState !== "ended") {
          setConnectionState("ended");
        }
      });

      room.on(RoomEvent.Reconnecting, () => {
        console.warn("[LiveKit] Connection unstable. Reconnecting...");
        setConnectionState("reconnecting");
        setStatusMessage("Reconnecting…");
      });

      room.on(RoomEvent.Reconnected, () => {
        console.log("[LiveKit] Successfully reconnected to room.");
        setConnectionState("connected");
        setStatusMessage("Connected");
      });

      room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        console.log(`[LiveKit] Participant joined: ${participant.identity}`);
        setHasRemoteParticipant(true);

        participant.trackPublications.forEach((pub) => {
          if (pub.isSubscribed && pub.track) {
            attachRemoteTrack(pub.track as RemoteTrack);
          }
        });
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        console.log(`[LiveKit] Participant left: ${participant.identity}`);
        setHasRemoteParticipant(false);
        setHasRemoteVideo(false);
        setHasRemoteAudio(false);
      });

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        console.log(`[LiveKit] Track subscribed: kind=${track.kind}, from=${participant.identity}`);
        setHasRemoteParticipant(true);
        if (track.kind === Track.Kind.Video && pub && typeof (pub as any).setVideoQuality === "function") {
          (pub as any).setVideoQuality(VideoQuality.HIGH);
        }
        attachRemoteTrack(track);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        console.log(`[LiveKit] Track unsubscribed: kind=${track.kind}`);
        detachRemoteTrack(track);
      });

      room.on(RoomEvent.TrackMuted, (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (pub.kind === Track.Kind.Video) {
          console.log("[LiveKit] Remote video track muted.");
          setHasRemoteVideo(false);
        } else if (pub.kind === Track.Kind.Audio) {
          console.log("[LiveKit] Remote audio track muted.");
          setHasRemoteAudio(false);
        }
      });

      room.on(RoomEvent.TrackUnmuted, (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (pub.kind === Track.Kind.Video && pub.track) {
          console.log("[LiveKit] Remote video track unmuted.");
          attachRemoteTrack(pub.track as RemoteTrack);
        } else if (pub.kind === Track.Kind.Audio && pub.track) {
          console.log("[LiveKit] Remote audio track unmuted.");
          attachRemoteTrack(pub.track as RemoteTrack);
        }
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const isSpeaking = speakers.some((s) => s.identity !== currentUserId);
        setIsPartnerSpeaking(isSpeaking);
      });

      room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant) => {
        if (participant?.identity === currentUserId || !participant) {
          setConnectionQuality(quality);
          setIsHdActive(quality === ConnectionQuality.Excellent || quality === ConnectionQuality.Good);
        }
      });

      // In-Call Live Chat & Realtime Signaling Receiver
      room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
        try {
          const decoder = new TextDecoder();
          const jsonStr = decoder.decode(payload);
          const data = JSON.parse(jsonStr);

          if (data.type === "call_ended") {
            console.log("[LiveKit] Received call_ended signal from partner.");
            setSessionEndedNotice("Your partner has ended the Swap Session.");
            cleanupCall();
            setConnectionState("ended");
            setShowPostCallModal(true);
            onSessionCompleted?.(sessionId);
            return;
          }

          if (data.type === "chat" && data.text) {
            setChatMessages((prev) => [
              ...prev,
              {
                id: Math.random().toString(36).substring(2, 9),
                senderId: participant?.identity || partnerUid,
                senderName: partnerName || "Partner",
                text: data.text,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
            ]);

            if (!showChat) {
              setChatUnreadCount((c) => c + 1);
            }
          }
        } catch (e) {
          console.warn("[LiveKit] Error parsing data packet:", e);
        }
      });

      // 4. Connect to Room
      console.log(`[LiveKit] CONNECT_STARTED: url=${serverUrl}, roomName=${roomName}`);
      await room.connect(serverUrl, token);

      // 5. Publish Local Audio & Video tracks in HD
      try {
        await room.localParticipant.setMicrophoneEnabled(!isAudioMuted, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });

        await room.localParticipant.setCameraEnabled(!isVideoOff, {
          resolution: {
            width: 1920,
            height: 1080,
            frameRate: 30,
          },
          facingMode: "user",
          deviceId: currentVideoDeviceId,
        });

        // Attach local camera video track to local preview
        const localVideoPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (localVideoPub && localVideoPub.track && localVideoRef.current) {
          localVideoPub.track.attach(localVideoRef.current);
        }
      } catch (mediaErr: any) {
        console.warn("[LiveKit] Non-fatal media device access warning:", mediaErr);
      }

    } catch (err: any) {
      console.error("[LiveKit] CONNECTION_ERROR:", err);
      setConnectionState("failed");
      setErrorMessage(err.message || "Connection lost. Please check your network and try again.");
      setErrorDetails({
        rawError: String(err?.message || err),
        serverUrl: err?.serverUrl,
        roomName,
      });
    }
  }, [
    cleanupCall,
    sessionId,
    roomName,
    currentUserId,
    currentUserName,
    partnerName,
    partnerUid,
    isAudioMuted,
    isVideoOff,
    showChat,
    attachRemoteTrack,
    detachRemoteTrack,
    refreshDevices
  ]);

  // Clean up on Unmount
  useEffect(() => {
    return () => {
      cleanupCall();
    };
  }, [cleanupCall]);

  // Toggle Mute Audio
  const handleToggleAudio = async () => {
    if (!roomRef.current) {
      setIsAudioMuted((prev) => !prev);
      return;
    }
    try {
      const nextState = !isAudioMuted;
      await roomRef.current.localParticipant.setMicrophoneEnabled(!nextState);
      setIsAudioMuted(nextState);
    } catch (err) {
      console.error("Error toggling audio:", err);
    }
  };

  // Toggle Video Camera
  const handleToggleVideo = async () => {
    if (!roomRef.current) {
      setIsVideoOff((prev) => !prev);
      return;
    }
    try {
      const nextState = !isVideoOff;
      await roomRef.current.localParticipant.setCameraEnabled(!nextState, {
        resolution: {
          width: 1920,
          height: 1080,
          frameRate: 30,
        },
        facingMode,
        deviceId: currentVideoDeviceId,
      });
      setIsVideoOff(nextState);
      if (!nextState) {
        setTimeout(() => {
          const camPub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
          if (camPub && camPub.track && localVideoRef.current) {
            camPub.track.attach(localVideoRef.current);
          }
        }, 300);
      }
    } catch (err) {
      console.error("Error toggling video:", err);
    }
  };

  // Flip Camera (Front / Rear) - Robust mobile & desktop support
  const handleFlipCamera = async () => {
    const nextFacing: "user" | "environment" = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextFacing);

    if (!roomRef.current) {
      return;
    }

    if (!isVideoOff) {
      try {
        console.log(`[LiveKit] Switching camera facingMode to: ${nextFacing}`);
        const localParticipant = roomRef.current.localParticipant;
        const camPub = localParticipant.getTrackPublication(Track.Source.Camera);

        const cameraResolution = {
          width: 1920,
          height: 1080,
          frameRate: 30,
        };

        // Try LiveKit's switchActiveDevice or restartTrack if available, or recreate the camera track with new facingMode
        if (camPub && camPub.track && (camPub.track as any).restartTrack) {
          await (camPub.track as any).restartTrack({
            facingMode: { exact: nextFacing },
            resolution: cameraResolution,
          }).catch(async () => {
            // Fallback without exact constraint (for desktop or browsers with loose facingMode support)
            await (camPub.track as any).restartTrack({
              facingMode: nextFacing,
              resolution: cameraResolution,
            });
          });
        } else {
          // Standard full cycle: disable old camera track and re-enable with new facingMode
          await localParticipant.setCameraEnabled(false);
          await localParticipant.setCameraEnabled(true, {
            resolution: cameraResolution,
            facingMode: nextFacing,
          });
        }

        // Re-attach local camera track to the local video element
        const updatedCamPub = localParticipant.getTrackPublication(Track.Source.Camera);
        if (updatedCamPub && updatedCamPub.track && localVideoRef.current) {
          updatedCamPub.track.attach(localVideoRef.current);
        }
        
        // Also refresh list of available video devices
        refreshDevices();
      } catch (err) {
        console.warn("[LiveKit] Facing mode flip fallback via device switching:", err);
        try {
          if (videoDevices.length > 1) {
            const nextDev = videoDevices.find((d) => d.deviceId !== currentVideoDeviceId) || videoDevices[0];
            await roomRef.current.switchActiveDevice("videoinput", nextDev.deviceId);
            setCurrentVideoDeviceId(nextDev.deviceId);
          }
        } catch (e2) {
          console.error("Error switching video device:", e2);
        }
      }
    }
  };

  // Toggle Speaker Mute (Partner Audio)
  const handleToggleSpeaker = () => {
    if (remoteAudioRef.current) {
      const nextState = !isSpeakerMuted;
      remoteAudioRef.current.muted = nextState;
      setIsSpeakerMuted(nextState);
    }
  };

  // Select Audio Output Device (Speaker / Earpiece / Bluetooth / Headset)
  const handleSelectAudioOutput = async (deviceId: string) => {
    if (!roomRef.current) return;
    try {
      await roomRef.current.switchActiveDevice("audiooutput", deviceId);
      setCurrentAudioOutputId(deviceId);
      
      const mode = deviceId.includes("earpiece") ? "earpiece" : deviceId.includes("bluetooth") ? "bluetooth" : "speaker";
      await mobileAudioRoutingService.setAudioRoute(mode, remoteAudioRef.current);

      if (remoteAudioRef.current && (remoteAudioRef.current as any).setSinkId) {
        await (remoteAudioRef.current as any).setSinkId(deviceId);
      }
    } catch (err) {
      console.warn("Could not switch audio output device:", err);
    }
  };

  // Select Video Input Device
  const handleSelectVideoDevice = async (deviceId: string) => {
    if (!roomRef.current) return;
    try {
      await roomRef.current.switchActiveDevice("videoinput", deviceId);
      setCurrentVideoDeviceId(deviceId);
    } catch (err) {
      console.warn("Could not switch video input device:", err);
    }
  };

  // Toggle Screen Share
  const handleToggleScreenShare = async () => {
    if (!roomRef.current) return;
    try {
      const nextState = !isScreenSharing;
      await roomRef.current.localParticipant.setScreenShareEnabled(nextState, {
        resolution: {
          width: 1920,
          height: 1080,
          frameRate: 30,
        },
      });
      setIsScreenSharing(nextState);
    } catch (err) {
      console.error("Error toggling screen share:", err);
      setIsScreenSharing(false);
    }
  };

  // Send Chat Message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !roomRef.current) return;

    const text = chatInput.trim();
    const payload = JSON.stringify({ type: "chat", text });
    const encoder = new TextEncoder();
    try {
      roomRef.current.localParticipant.publishData(encoder.encode(payload), { reliable: true });
      setChatMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(2, 9),
          senderId: currentUserId,
          senderName: "You",
          text,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      setChatInput("");
    } catch (err) {
      console.error("Error publishing chat data:", err);
    }
  };

  // Toggle Fullscreen
  const handleToggleFullscreen = () => {
    if (!modalContainerRef.current) return;
    if (!document.fullscreenElement) {
      modalContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Stage Tap handler to toggle controls visibility
  const handleStageTap = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest("button") || 
      target.closest("input") || 
      target.closest("textarea") || 
      target.closest("#call-controls-dock") || 
      target.closest("#in-call-chat-drawer")
    ) {
      return;
    }
    setAreControlsVisible((prev) => !prev);
  };

  // =========================================================================
  // 1. PRE-CALL LOBBY SCREEN
  // =========================================================================
  if (isInLobby) {
    const lobbyContent = (
      <PreCallLobby
        partnerName={partnerName}
        partnerPhoto={partnerPhoto}
        skillName={skillName}
        sessionDuration={sessionDuration}
        currentUserName={currentUserName}
        currentUserPhoto={currentUserPhoto}
        isAudioMuted={isAudioMuted}
        isVideoOff={isVideoOff}
        onToggleAudio={handleToggleAudio}
        onToggleVideo={handleToggleVideo}
        onJoin={joinLiveKitRoom}
        onClose={onClose}
      />
    );

    if (typeof document !== "undefined" && document.body) {
      return createPortal(lobbyContent, document.body);
    }
    return lobbyContent;
  }

  // =========================================================================
  // 2. ACTIVE LIVE MEETING SCREEN
  // =========================================================================
  const modalContent = (
    <div
      ref={modalContainerRef}
      id="livekit-live-swap-modal"
      className="fixed inset-0 z-[99999] w-screen h-[100dvh] bg-[#0A0A0E] text-[#F7F4EE] flex flex-col justify-between overflow-hidden select-none font-sans"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100dvh",
        zIndex: 99999,
      }}
    >
      {/* Hidden Audio Element for Remote Audio Streaming */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* 5-Minute Expiring Soon Floating Toast */}
      {showExpiringSoonToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-amber-500/20 backdrop-blur-xl border border-amber-500/40 text-amber-300 text-xs font-semibold shadow-xl shadow-amber-500/10 flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
          <Clock className="w-4 h-4 text-amber-400" />
          <span>5 minutes remaining in your Live Swap session</span>
        </div>
      )}

      {/* TOP STATUS & INFO BAR (Fades with auto-hide timer) */}
      <div className={`transition-all duration-300 z-30 ${areControlsVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-full pointer-events-none"}`}>
        <CallTopBar
          partnerName={partnerName}
          partnerPhoto={partnerPhoto}
          skillName={skillName}
          hasRemoteParticipant={hasRemoteParticipant}
          isPartnerSpeaking={isPartnerSpeaking}
          connectionState={connectionState}
          connectionQuality={connectionQuality}
          isHdActive={isHdActive}
          videoQualityTier={videoQualityTier}
          actualResolution={actualResolution}
          formattedDuration={formattedDuration}
          formattedRemaining={formattedRemaining}
          remainingSeconds={remainingSeconds}
          layoutMode={layoutMode}
          setLayoutMode={setLayoutMode}
          showChat={showChat}
          setShowChat={setShowChat}
          chatUnreadCount={chatUnreadCount}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          onEndCall={() => setShowEndCallConfirm(true)}
        />
      </div>

      {/* MAIN PRESENTATION STAGE */}
      <main 
        className="relative flex-1 w-full h-full bg-[#08080A] flex overflow-hidden cursor-default"
        onClick={handleStageTap}
      >
        
        {/* Stage Viewport */}
        <div className={`relative flex-1 h-full flex items-center justify-center p-2 sm:p-4 overflow-hidden transition-all duration-300 ${
          showChat ? "mr-0 md:mr-80 lg:mr-96" : ""
        }`}>

          {/* Connecting / Reconnecting Overlay */}
          {connectionState !== "connected" && connectionState !== "failed" && connectionState !== "ended" && (
            <div className="absolute inset-0 z-30 bg-[#0A0A0E]/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center">
              <div className="relative w-20 h-20 sm:w-24 sm:h-24 mb-5">
                <div className="absolute inset-0 rounded-full border-2 border-[#C9A96E]/30 animate-ping" />
                <div className="w-full h-full rounded-full border-3 border-t-[#C9A96E] border-r-transparent border-b-[#C9A96E]/20 border-l-transparent animate-spin" />
                <div className="absolute inset-2 rounded-full overflow-hidden border-2 border-[#C9A96E]/50 shadow-lg">
                  <img
                    src={partnerPhoto || DEFAULT_AVATAR}
                    alt={partnerName}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
              </div>

              <h3 className="text-base sm:text-lg font-bold text-[#F7F4EE] mb-1 tracking-tight">
                {connectionState === "reconnecting" ? "Reconnecting…" : "Connecting to your partner…"}
              </h3>
              <p className="text-xs text-[#C9A96E] font-medium animate-pulse mb-3">
                {statusMessage}
              </p>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] text-white/50 font-mono">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>LiveKit Encrypted</span>
              </div>
            </div>
          )}

          {/* Connection Error Overlay */}
          {connectionState === "failed" && (
            <div className="absolute inset-0 z-30 bg-[#0A0A0E]/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 shadow-xl shadow-rose-500/10">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h3 className="text-base sm:text-lg font-bold text-[#F7F4EE] mb-2 tracking-tight">
                Connection Lost
              </h3>
              <p className="text-xs text-white/70 leading-relaxed mb-6">
                {errorMessage || "We couldn't connect to your partner's room. Check your internet connection and try again."}
              </p>

              <div className="flex items-center gap-3">
                <button
                  id="retry-livekit-btn"
                  onClick={joinLiveKitRoom}
                  className="px-5 py-2.5 bg-gradient-to-r from-[#C9A96E] to-[#D5B980] hover:opacity-95 text-[#0A0A0E] font-bold text-xs rounded-xl shadow-lg transition active:scale-95 cursor-pointer flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Try Again</span>
                </button>
                <button
                  onClick={handleConfirmEndCall}
                  className="px-4 py-2.5 bg-white/10 hover:bg-white/15 text-[#F7F4EE] border border-white/10 font-semibold text-xs rounded-xl transition cursor-pointer"
                >
                  Return to Sessions
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* LAYOUT A: PICTURE-IN-PICTURE (MAIN STAGE + FLOATING LOCAL SELF-VIEW)     */}
          {/* ========================================================================= */}
          {layoutMode === "pip" ? (
            <div className="relative w-full h-full rounded-2xl sm:rounded-3xl overflow-hidden bg-[#101015] border border-white/10 shadow-2xl flex items-center justify-center">
              
              {/* Remote Video Stream (Fills entire stage seamlessly) */}
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  hasRemoteVideo ? "opacity-100 block" : "opacity-0 hidden"
                }`}
              />

              {/* Remote Camera Disabled / Waiting Fallback View */}
              {!hasRemoteVideo && (
                <CallAvatarView
                  name={partnerName}
                  photo={partnerPhoto}
                  isSpeaking={isPartnerSpeaking}
                  isWaiting={!hasRemoteParticipant}
                  hasAudio={hasRemoteAudio}
                />
              )}

              {/* Floating Local Self-View PiP Card (Positioned safely above bottom dock) */}
              <div 
                className="absolute bottom-20 xs:bottom-24 sm:bottom-28 right-3 sm:right-5 z-20 w-32 h-20 xs:w-36 xs:h-24 sm:w-56 sm:h-34 md:w-64 md:h-38 rounded-2xl overflow-hidden bg-[#14141A] border border-white/20 hover:border-[#C9A96E]/70 shadow-2xl shadow-black/90 group transition-all duration-200 backdrop-blur-md"
              >
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover transition-transform duration-200 ${
                    isMirrorLocal ? "scale-x-[-1]" : ""
                  } ${isVideoOff ? "hidden" : "block"}`}
                />

                {/* Local Camera Off Avatar Fallback */}
                {isVideoOff && (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-[#181822] to-[#101016] text-white/70 p-2 text-center">
                    <img
                      src={currentUserPhoto || DEFAULT_AVATAR}
                      alt={currentUserName}
                      className="w-7 h-7 sm:w-10 sm:h-10 rounded-full object-cover ring-1.5 ring-[#C9A96E]/40 mb-1"
                      referrerPolicy="no-referrer"
                    />
                    <span className="text-[9px] sm:text-[10px] font-semibold text-white/90 truncate max-w-[90%]">
                      Camera Off
                    </span>
                  </div>
                )}

                {/* Local Self Overlay Badge */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-md border border-white/10 text-[9px] font-mono font-medium text-white/90 flex items-center gap-1">
                  <span>You</span>
                  {isAudioMuted && <span className="text-rose-400 font-bold">(Muted)</span>}
                </div>

                {/* Local Self Micro Controls */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMirrorLocal((prev) => !prev);
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 hover:bg-black/90 text-white/80 hover:text-white opacity-0 group-hover:opacity-100 transition cursor-pointer backdrop-blur-md"
                  title="Mirror Self View"
                >
                  <FlipHorizontal className="w-3 h-3" />
                </button>
              </div>

              {/* Remote Participant Name Tag at Top-Left of Video */}
              <div className="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs font-semibold text-white flex items-center gap-2 shadow-lg">
                <span className={`w-2 h-2 rounded-full ${hasRemoteParticipant ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                <span>{partnerName}</span>
                {isPartnerSpeaking && (
                  <span className="text-[10px] text-emerald-400 font-normal">speaking</span>
                )}
              </div>
            </div>
          ) : (
            /* ========================================================================= */
            /* LAYOUT B: SIDE-BY-SIDE GRID VIEW (ZOOM / MEET STYLE 2-TILE GRID)          */
            /* ========================================================================= */
            <div className="w-full h-full grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 pb-20 sm:pb-0">
              
              {/* Partner Tile */}
              <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden bg-[#101015] border border-white/10 shadow-xl flex items-center justify-center">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className={`w-full h-full object-cover ${hasRemoteVideo ? "block" : "hidden"}`}
                />
                {!hasRemoteVideo && (
                  <CallAvatarView
                    name={partnerName}
                    photo={partnerPhoto}
                    isSpeaking={isPartnerSpeaking}
                    isWaiting={!hasRemoteParticipant}
                    hasAudio={hasRemoteAudio}
                  />
                )}
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs font-semibold text-white flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${hasRemoteParticipant ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <span>{partnerName}</span>
                </div>
              </div>

              {/* Local User Tile */}
              <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden bg-[#101015] border border-white/10 shadow-xl flex items-center justify-center">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${isMirrorLocal ? "scale-x-[-1]" : ""} ${isVideoOff ? "hidden" : "block"}`}
                />
                {isVideoOff && (
                  <CallAvatarView
                    name="You"
                    photo={currentUserPhoto}
                    isSpeaking={false}
                    isMuted={isAudioMuted}
                    customMessage="Your camera is turned off"
                  />
                )}
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>You</span>
                  {isAudioMuted && <span className="text-rose-400 font-mono text-[10px]">(Muted)</span>}
                </div>
              </div>

            </div>
          )}

        </div>

        {/* IN-CALL LIVE CHAT DRAWER */}
        <InCallChatDrawer
          isOpen={showChat}
          onClose={() => setShowChat(false)}
          messages={chatMessages}
          currentUserId={currentUserId}
          partnerName={partnerName}
          chatInput={chatInput}
          setChatInput={setChatInput}
          onSendMessage={handleSendMessage}
        />
      </main>

      {/* FLOATING BOTTOM CONTROL DOCK (Fades with auto-hide timer) */}
      <div className={`transition-all duration-300 z-40 ${areControlsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-full pointer-events-none"}`}>
        <CallControlsDock
          isAudioMuted={isAudioMuted}
          isVideoOff={isVideoOff}
          isScreenSharing={isScreenSharing}
          isMirrorLocal={isMirrorLocal}
          facingMode={facingMode}
          isSpeakerMuted={isSpeakerMuted}
          audioOutputDevices={audioOutputDevices}
          currentAudioOutputId={currentAudioOutputId}
          videoDevices={videoDevices}
          currentVideoDeviceId={currentVideoDeviceId}
          showChat={showChat}
          chatUnreadCount={chatUnreadCount}
          layoutMode={layoutMode}
          isFullscreen={isFullscreen}
          isHdActive={isHdActive}
          videoQualityTier={videoQualityTier}
          actualResolution={actualResolution}
          isScreenShareSupported={isScreenShareSupported}
          onToggleAudio={handleToggleAudio}
          onToggleVideo={handleToggleVideo}
          onFlipCamera={handleFlipCamera}
          onToggleSpeaker={handleToggleSpeaker}
          onSelectAudioOutput={handleSelectAudioOutput}
          onSelectVideoDevice={handleSelectVideoDevice}
          onToggleScreenShare={handleToggleScreenShare}
          onToggleMirror={() => setIsMirrorLocal((prev) => !prev)}
          onToggleChat={() => setShowChat((prev) => !prev)}
          onToggleLayout={() => setLayoutMode((prev) => (prev === "pip" ? "side-by-side" : "pip"))}
          onToggleFullscreen={handleToggleFullscreen}
          onEndCall={() => setShowEndCallConfirm(true)}
        />
      </div>

      {/* END CALL CONFIRMATION MODAL */}
      <EndCallConfirmModal
        isOpen={showEndCallConfirm}
        onCancel={() => setShowEndCallConfirm(false)}
        onConfirmEnd={handleConfirmEndCall}
        partnerName={partnerName}
      />

      {/* POST-LIVE-SWAP FEEDBACK & REVIEW MODAL */}
      <PostCallFeedbackModal
        isOpen={showPostCallModal}
        onClose={onClose}
        partnerName={partnerName}
        partnerPhoto={partnerPhoto}
        partnerUid={partnerUid}
        sessionId={sessionId}
        skillName={skillName}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        currentUserPhoto={currentUserPhoto}
        sessionDuration={sessionDuration}
        formattedDuration={formattedDuration}
        sessionEndedNotice={sessionEndedNotice}
        onSessionCompleted={onSessionCompleted}
      />

    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
}
