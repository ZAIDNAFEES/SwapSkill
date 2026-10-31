/**
 * WebRTC 1-to-1 Real-Time Audio/Video Communication Service
 * 
 * Provides pure standard WebRTC peer connection, media capture, camera switching,
 * track management, and deterministic resource cleanup for SwapSkill on Web & Android APK.
 */

import { getApiBaseUrl } from "../utils/apiConfig";
import { auth } from "../firebase";

export interface WebRTCServiceEvents {
  onRemoteStream?: (stream: MediaStream) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onIceCandidate?: (candidate: RTCIceCandidate) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onIceConnectionStateChange?: (state: RTCIceConnectionState) => void;
  onIceGatheringStateChange?: (state: RTCIceGatheringState) => void;
  onIceRestartNeeded?: () => void;
  onError?: (error: Error) => void;
}

export interface WebRTCMediaOptions {
  video?: boolean;
  audio?: boolean;
  facingMode?: "user" | "environment";
  preferredVideoDeviceId?: string;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:global.stun.twilio.com:3478" },
  {
    urls: [
      "turn:global.relay.metered.ca:80",
      "turn:global.relay.metered.ca:80?transport=tcp",
      "turn:global.relay.metered.ca:443",
      "turns:global.relay.metered.ca:443?transport=tcp",
    ],
    username: "13748a1862f0e5316c1a9877",
    credential: "9cgHjuE4wpy1L/Dq",
  },
];

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private seenCandidates = new Set<string>();
  private events: WebRTCServiceEvents = {};
  private currentFacingMode: "user" | "environment" = "user";
  private isCleanedUp = false;
  private static cachedIceServers: RTCIceServer[] | null = DEFAULT_ICE_SERVERS;
  private isRestartingIce = false;
  private screenStream: MediaStream | null = null;
  private savedCameraTrack: MediaStreamTrack | null = null;
  private onScreenShareEndedCallback?: () => void;

  constructor(events?: WebRTCServiceEvents) {
    if (events) {
      this.events = events;
    }
  }

  /**
   * Securely loads TURN & STUN servers from the backend infrastructure.
   * Returns high-availability STUN/TURN immediately from memory cache to avoid call connection latency.
   */
  public static async fetchIceServers(forceRefresh = false): Promise<RTCIceServer[]> {
    if (WebRTCService.cachedIceServers && !forceRefresh) {
      // Refresh in background without blocking current call connection
      WebRTCService.refreshIceServersInBackground();
      return WebRTCService.cachedIceServers;
    }

    // Return instant defaults while background refresh completes
    WebRTCService.refreshIceServersInBackground();
    return DEFAULT_ICE_SERVERS;
  }

  /**
   * Asynchronously queries the backend ICE servers endpoint and updates cached list
   */
  private static refreshIceServersInBackground(): void {
    const baseUrl = getApiBaseUrl();
    const endpoint = baseUrl ? `${baseUrl}/api/webrtc/ice-servers` : "/api/webrtc/ice-servers";
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 1800) : null;

    auth.currentUser?.getIdToken().then((idToken) => {
      fetch(endpoint, {
        signal: controller ? controller.signal : undefined,
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
            const hasTurn = data.iceServers.some((s: RTCIceServer) => {
              const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
              return urls.some((u) => u.startsWith("turn:") || u.startsWith("turns:"));
            });
            const resolvedServers = hasTurn
              ? data.iceServers
              : [...data.iceServers, DEFAULT_ICE_SERVERS[DEFAULT_ICE_SERVERS.length - 1]];
            WebRTCService.cachedIceServers = resolvedServers;
            console.log(`[WebRTC] Background refreshed ${resolvedServers.length} ICE servers`);
          }
        })
        .catch(() => {
          if (timeoutId) clearTimeout(timeoutId);
        });
    }).catch(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }

  public setEvents(events: WebRTCServiceEvents) {
    this.events = { ...this.events, ...events };
  }

  /**
   * Acquire local camera and microphone stream with optimal mobile audio processing
   */
  public async getLocalUserMedia(options: WebRTCMediaOptions = {}): Promise<MediaStream> {
    const {
      video = true,
      audio = true,
      facingMode = "user",
      preferredVideoDeviceId,
    } = options;

    this.currentFacingMode = facingMode;

    if (this.localStream) {
      this.stopLocalTracks();
    }

    const videoConstraints: MediaTrackConstraints | boolean = video
      ? preferredVideoDeviceId
        ? { deviceId: { exact: preferredVideoDeviceId } }
        : {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
          }
      : false;

    const audioConstraints: MediaTrackConstraints | boolean = audio
      ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      : false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: audioConstraints,
      });

      this.localStream = stream;
      this.isCleanedUp = false;
      console.log(`[WEBRTC] LOCAL_STREAM_READY: ${stream.getVideoTracks().length} video, ${stream.getAudioTracks().length} audio tracks`);
      this.events.onLocalStream?.(stream);
      return stream;
    } catch (err: any) {
      console.warn("[WebRTC] Primary getUserMedia failed, attempting fallback:", err);
      // Fallback: try basic video & audio without restrictive constraints
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: !!video,
          audio: !!audio,
        });
        this.localStream = fallbackStream;
        this.isCleanedUp = false;
        console.log(`[WEBRTC] LOCAL_STREAM_READY (Fallback): ${fallbackStream.getVideoTracks().length} video, ${fallbackStream.getAudioTracks().length} audio tracks`);
        this.events.onLocalStream?.(fallbackStream);
        return fallbackStream;
      } catch (fallbackErr: any) {
        console.error("[WebRTC] Fallback getUserMedia also failed:", fallbackErr);
        throw fallbackErr;
      }
    }
  }

  /**
   * Directly sets an already acquired local stream
   */
  public setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;
    if (stream) {
      this.isCleanedUp = false;
      console.log(`[WEBRTC] LOCAL_STREAM_READY (Set directly): ${stream.getVideoTracks().length} video, ${stream.getAudioTracks().length} audio tracks`);
      this.events.onLocalStream?.(stream);
    }
  }

  /**
   * Initializes RTCPeerConnection and attaches local tracks
   */
  public initPeerConnection(customIceServers?: RTCIceServer[], existingStream?: MediaStream | null): RTCPeerConnection {
    if (this.peerConnection) {
      this.cleanupPeerConnection();
    }

    if (existingStream) {
      this.localStream = existingStream;
    }

    const iceServers = customIceServers && customIceServers.length > 0
      ? customIceServers
      : DEFAULT_ICE_SERVERS;

    const config: RTCConfiguration = {
      iceServers,
      iceCandidatePoolSize: 2, // Pre-gather ICE candidates immediately to cut connection latency by ~1.5s
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    };

    console.log(
      `[WEBRTC] Creating RTCPeerConnection with ${iceServers.length} ICE servers:`,
      iceServers.map((s) => (Array.isArray(s.urls) ? s.urls.join(", ") : s.urls)).join(" | ")
    );

    const pc = new RTCPeerConnection(config);
    this.peerConnection = pc;
    this.remoteStream = new MediaStream();
    this.pendingCandidates = [];
    this.seenCandidates.clear();
    console.log("[WEBRTC_PC_CREATED]");
    console.log("[WEBRTC] PEER_CONNECTION_CREATED");

    // Handle remote tracks with robust multi-track combination and deduplication
    pc.ontrack = (event) => {
      const track = event.track;
      console.log("[WEBRTC_REMOTE_TRACK]");
      console.log(`[LS_DEBUG] ontrack received: kind=${track.kind}, id=${track.id}, readyState=${track.readyState}, muted=${track.muted}`);

      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }

      // If an existing track of the same kind is present with a different ID, remove it
      this.remoteStream.getTracks().forEach((existingTrack) => {
        if (existingTrack.kind === track.kind && existingTrack.id !== track.id) {
          console.log(`[LS_DEBUG] Replacing existing remote ${track.kind} track (${existingTrack.id}) with new track (${track.id})`);
          try {
            this.remoteStream?.removeTrack(existingTrack);
          } catch (_) {}
        }
      });

      // Add track to combined remoteStream if not already in it
      if (!this.remoteStream.getTracks().some((t) => t.id === track.id)) {
        this.remoteStream.addTrack(track);
        console.log(`[LS_DEBUG] Added remote ${track.kind} track to combined stream. Total tracks now: video=${this.remoteStream.getVideoTracks().length}, audio=${this.remoteStream.getAudioTracks().length}`);
      }

      // Also merge any tracks present in event.streams[0] into this.remoteStream
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((stTrack) => {
          if (!this.remoteStream?.getTracks().some((t) => t.id === stTrack.id)) {
            this.remoteStream?.addTrack(stTrack);
            console.log(`[LS_DEBUG] Merged stream[0] track ${stTrack.kind} (${stTrack.id}) into remoteStream`);
          }
        });
      }

      // Notify consumer with the persistent, multi-track remoteStream
      this.events.onRemoteStream?.(this.remoteStream);

      // Listen for unmute/mute events via addEventListener so we do not clobber other handlers
      const handleUnmute = () => {
        console.log(`[LS_DEBUG] Remote track ${track.kind} (${track.id}) unmuted, notifying remote stream update`);
        if (this.remoteStream) {
          this.events.onRemoteStream?.(this.remoteStream);
        }
      };

      const handleMute = () => {
        console.log(`[LS_DEBUG] Remote track ${track.kind} (${track.id}) muted`);
      };

      track.addEventListener("unmute", handleUnmute);
      track.addEventListener("mute", handleMute);
    };

    // Handle local ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[SIGNALING] ICE_CANDIDATE_GENERATED");
        this.events.onIceCandidate?.(event.candidate);
      } else {
        console.log("[SIGNALING] ICE_GATHERING_COMPLETE (null candidate received from browser)");
      }
    };

    // ICE Gathering State logging
    pc.onicegatheringstatechange = () => {
      console.log(`[WEBRTC] ICE_GATHERING_STATE: ${pc.iceGatheringState}`);
      this.events.onIceGatheringStateChange?.(pc.iceGatheringState);
    };

    // Connection state logging & events
    pc.onconnectionstatechange = () => {
      console.log(`[WEBRTC_CONNECTION_STATE] ${pc.connectionState}`);
      console.log(`[WEBRTC] CONNECTION_STATE: ${pc.connectionState} (iceConnectionState: ${pc.iceConnectionState}, iceGatheringState: ${pc.iceGatheringState})`);
      if (pc.connectionState === "connected") {
        console.log("[CALL_TRACE] Step 7: WebRTC connection established successfully!");
        console.log("[LIVE SWAP] PEER_CONNECTED");
      } else if (pc.connectionState === "failed") {
        console.error("[MEDIA_DEBUG] Room connection failure - PeerConnection connectionState failed");
        console.error("[WEBRTC] CALL_FAILED - PeerConnection connectionState failed");
      }
      this.events.onConnectionStateChange?.(pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WEBRTC_ICE_STATE] ${pc.iceConnectionState}`);
      console.log(`[WEBRTC] ICE_CONNECTION_STATE: ${pc.iceConnectionState} (connectionState: ${pc.connectionState}, iceGatheringState: ${pc.iceGatheringState})`);
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        console.log("[CALL_TRACE] Step 7: WebRTC ICE connected successfully!");
        console.log("[LIVE SWAP] ICE_CONNECTED");
        // Treat ICE connection as connected if connectionState hasn't fired yet
        if (pc.connectionState !== "connected" && pc.connectionState !== "failed") {
          this.events.onConnectionStateChange?.("connected");
        }
      } else if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        console.warn(`[WEBRTC] ICE state is ${pc.iceConnectionState}. Requesting reconnect/restart...`);
        this.events.onIceRestartNeeded?.();
      }
      this.events.onIceConnectionStateChange?.(pc.iceConnectionState);
    };

    // Add local tracks to peer connection
    if (this.localStream) {
      console.log("[CALL_TRACE] Step 5: Initializing peer connection with local tracks...");
      this.localStream.getTracks().forEach((track) => {
        try {
          const senders = pc.getSenders();
          const existingSender = senders.find((s) => s.track && s.track.kind === track.kind);
          if (existingSender) {
            existingSender.replaceTrack(track);
            console.log(`[CALL_TRACE] Step 6: Local track replaced in PeerConnection: kind=${track.kind}`);
            console.log(`[MEDIA_DEBUG] track publishing SUCCESS (Replaced sender): kind=${track.kind}`);
            console.log(`[WebRTC] Replaced existing track sender: kind=${track.kind}`);
          } else {
            pc.addTrack(track, this.localStream!);
            console.log(`[CALL_TRACE] Step 6: Local track published to PeerConnection: kind=${track.kind}`);
            console.log(`[MEDIA_DEBUG] track publishing SUCCESS (Added track): kind=${track.kind}`);
            console.log(`[WebRTC] Added local track to peer connection: kind=${track.kind}`);
          }
        } catch (e) {
          console.error("[MEDIA_DEBUG] track publishing failure:", e);
          console.warn("[WebRTC] Error adding local track to peer connection:", e);
        }
      });
    }

    // Ensure transceivers are configured to "sendrecv" based on media availability
    // For audio-only calls, omit video transceiver to prevent unnecessary hardware allocation and ICE overhead
    const hasVideo = this.localStream ? this.localStream.getVideoTracks().length > 0 : true;
    const kinds: ("audio" | "video")[] = hasVideo ? ["audio", "video"] : ["audio"];
    kinds.forEach((kind) => {
      const transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === kind);
      if (transceiver) {
        if (transceiver.direction !== "sendrecv") {
          transceiver.direction = "sendrecv";
        }
      } else {
        try {
          pc.addTransceiver(kind, { direction: "sendrecv" });
          console.log(`[WebRTC] Initialized ${kind} transceiver with sendrecv direction`);
        } catch (e) {
          console.warn(`[WebRTC] Could not add transceiver for ${kind}:`, e);
        }
      }
    });

    return pc;
  }

  /**
   * Caller: Create WebRTC Offer
   */
  public async createOffer(): Promise<{ type: "offer"; sdp: string }> {
    if (!this.peerConnection) {
      throw new Error("PeerConnection not initialized. Call initPeerConnection first.");
    }

    // Ensure all transceivers are configured to sendrecv
    this.peerConnection.getTransceivers().forEach((t) => {
      if (t.direction !== "sendrecv") {
        t.direction = "sendrecv";
      }
    });

    const hasVideo = this.localStream ? this.localStream.getVideoTracks().length > 0 : true;
    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: hasVideo,
    });

    await this.peerConnection.setLocalDescription(offer);
    console.log("[LS_DEBUG] OFFER_CREATED - Local description set for caller");

    return {
      type: "offer",
      sdp: offer.sdp || "",
    };
  }

  /**
   * Caller or Callee triggers an ICE restart to re-negotiate media and NAT paths
   * following a network switch (Wi-Fi <-> Cellular) or ICE failure.
   */
  public async restartIce(): Promise<{ type: "offer"; sdp: string } | null> {
    if (!this.peerConnection || this.isRestartingIce) return null;
    this.isRestartingIce = true;

    try {
      console.log("[LS_DEBUG] ICE_RESTART_REQUESTED");
      if ("restartIce" in this.peerConnection) {
        (this.peerConnection as any).restartIce();
      }

      const offer = await this.peerConnection.createOffer({
        iceRestart: true,
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await this.peerConnection.setLocalDescription(offer);
      console.log("[LS_DEBUG] ICE_RESTART_OFFER_GENERATED");
      this.isRestartingIce = false;
      return {
        type: "offer",
        sdp: offer.sdp || "",
      };
    } catch (err) {
      console.warn("[WebRTC] restartIce error:", err);
      this.isRestartingIce = false;
      return null;
    }
  }

  /**
   * Callee: Set remote Offer and Create WebRTC Answer
   */
  public async createAnswer(offerSdp: string): Promise<{ type: "answer"; sdp: string }> {
    if (!this.peerConnection) {
      throw new Error("PeerConnection not initialized. Call initPeerConnection first.");
    }

    const remoteDesc = new RTCSessionDescription({
      type: "offer",
      sdp: offerSdp,
    });

    await this.peerConnection.setRemoteDescription(remoteDesc);
    console.log("[WEBRTC_REMOTE_DESCRIPTION_SET]");
    console.log("[WEBRTC] REMOTE_DESCRIPTION_SET (Offer) on Callee");

    // Ensure all transceivers have direction = "sendrecv" so callee actively publishes both audio & video
    this.peerConnection.getTransceivers().forEach((t) => {
      if (t.direction !== "sendrecv") {
        t.direction = "sendrecv";
      }
    });

    // Verify local tracks are bound to senders
    if (this.localStream) {
      const vTrack = this.localStream.getVideoTracks().find((t) => t.readyState === "live");
      const aTrack = this.localStream.getAudioTracks().find((t) => t.readyState === "live");
      this.peerConnection.getSenders().forEach((sender) => {
        if (sender.track?.kind === "video" && vTrack && sender.track.id !== vTrack.id) {
          sender.replaceTrack(vTrack).catch(() => {});
        } else if (!sender.track && vTrack) {
          sender.replaceTrack(vTrack).catch(() => {});
        }
        if (sender.track?.kind === "audio" && aTrack && sender.track.id !== aTrack.id) {
          sender.replaceTrack(aTrack).catch(() => {});
        } else if (!sender.track && aTrack) {
          sender.replaceTrack(aTrack).catch(() => {});
        }
      });
    }

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    console.log("[WEBRTC_ANSWER_CREATED]");
    console.log("[WEBRTC] ANSWER_CREATED - Local description set on Callee");

    // Flush queued candidates after both remote Offer and local Answer are set
    await this.flushPendingCandidates();

    return {
      type: "answer",
      sdp: answer.sdp || "",
    };
  }

  /**
   * Caller: Set remote Answer received from Callee
   */
  public async setRemoteAnswer(answerSdp: string): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("PeerConnection not initialized.");
    }

    if (this.peerConnection.signalingState === "stable") {
      console.log("[WebRTC] Remote description already set (state is stable), skipping duplicate");
      return;
    }

    const remoteDesc = new RTCSessionDescription({
      type: "answer",
      sdp: answerSdp,
    });

    await this.peerConnection.setRemoteDescription(remoteDesc);
    console.log("[WEBRTC] REMOTE_DESCRIPTION_SET (Answer) on Caller");

    // Process queued candidates immediately
    await this.flushPendingCandidates();
  }

  /**
   * Safely formats and cleans an RTCIceCandidateInit payload to ensure standard W3C compatibility
   */
  private sanitizeCandidateInit(candidateInit: RTCIceCandidateInit): RTCIceCandidateInit {
    const clean: RTCIceCandidateInit = {
      candidate: candidateInit.candidate,
    };
    if (candidateInit.sdpMid !== undefined && candidateInit.sdpMid !== null) {
      clean.sdpMid = String(candidateInit.sdpMid);
    }
    if (typeof candidateInit.sdpMLineIndex === "number") {
      clean.sdpMLineIndex = candidateInit.sdpMLineIndex;
    }
    if (candidateInit.usernameFragment) {
      clean.usernameFragment = candidateInit.usernameFragment;
    }
    return clean;
  }

  /**
   * Add ICE candidate from remote peer (with queuing if remote description is not yet set)
   */
  public async addIceCandidate(candidateInit: RTCIceCandidateInit): Promise<void> {
    if (!candidateInit || !candidateInit.candidate) return;

    const candStr = candidateInit.candidate.trim();
    if (this.seenCandidates.has(candStr)) {
      return;
    }
    this.seenCandidates.add(candStr);

    console.log("[SIGNALING] ICE_RECEIVED");

    const hasRemote = !!(this.peerConnection?.remoteDescription && this.peerConnection.remoteDescription.sdp);

    if (!this.peerConnection || !hasRemote) {
      console.log(`[WebRTC] Queuing ICE candidate until remote description is set (total pending: ${this.pendingCandidates.length + 1})`);
      this.pendingCandidates.push(candidateInit);
      return;
    }

    try {
      const cleanCandidate = this.sanitizeCandidateInit(candidateInit);
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(cleanCandidate));
      console.log("[WebRTC] ICE_ADDED - Remote candidate added to PeerConnection");
    } catch (err) {
      console.warn("[WebRTC] Failed to add remote ICE candidate:", err);
    }
  }

  /**
   * Flush pending candidates once remote description is set
   */
  private async flushPendingCandidates(): Promise<void> {
    if (!this.peerConnection || this.pendingCandidates.length === 0) return;

    console.log(`[WebRTC] Flushing ${this.pendingCandidates.length} queued ICE candidates...`);
    const queued = [...this.pendingCandidates];
    this.pendingCandidates = [];

    for (const cand of queued) {
      try {
        const cleanCand = this.sanitizeCandidateInit(cand);
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(cleanCand));
        console.log("[WebRTC] ICE_ADDED - Queued candidate added to PeerConnection");
      } catch (err) {
        console.warn("[WebRTC] Failed to flush queued candidate:", err);
      }
    }
  }

  /**
   * Switch between Front ("user") and Back ("environment") camera on Mobile / Desktop
   * Safely acquires new camera with rollback recovery to prevent losing outgoing video.
   */
  public async switchCamera(targetFacingMode?: "user" | "environment"): Promise<MediaStream | null> {
    const prevFacing = this.currentFacingMode;
    const nextFacing = targetFacingMode || (this.currentFacingMode === "user" ? "environment" : "user");

    console.log(
      `[CAMERA_FLIP] Requesting switch from ${prevFacing === "user" ? "front" : "environment"} to ${
        nextFacing === "user" ? "front" : "environment"
      } camera`
    );

    // 1. Locate the outgoing VIDEO sender / transceiver BEFORE modifying any tracks
    let videoSender: RTCRtpSender | null = null;
    if (this.peerConnection) {
      const transceivers = this.peerConnection.getTransceivers();
      const videoTransceiver = transceivers.find(
        (t) => t.receiver?.track?.kind === "video" || t.sender?.track?.kind === "video"
      );
      if (videoTransceiver && videoTransceiver.sender) {
        videoSender = videoTransceiver.sender;
      } else {
        videoSender =
          this.peerConnection.getSenders().find((s) => s.track && s.track.kind === "video") || null;
      }
    }

    // 2. Identify current active video track and preserve references
    const oldVideoTracks = this.localStream ? this.localStream.getVideoTracks() : [];
    const oldTrack = oldVideoTracks[0] || null;
    const wasVideoEnabled = oldTrack ? oldTrack.enabled : true;

    // 3. Enumerate devices to check if multiple cameras exist
    let numVideoDevices = 2;
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === "videoinput");
        numVideoDevices = videoInputs.length;
        if (numVideoDevices <= 1) {
          console.warn("[CAMERA_FLIP] Only one video input device detected on this hardware.");
        }
      }
    } catch (e) {
      console.log("[CAMERA_FLIP] Could not enumerate devices:", e);
    }

    // 4. Safe Acquisition with Rollback Recovery
    let newStream: MediaStream | null = null;
    let didStopOldTrackFirst = false;

    // Strategy A: Try acquiring new camera in parallel without stopping old track first
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: nextFacing },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
        audio: false,
      });
    } catch (parallelErr: any) {
      console.log("[CAMERA_FLIP] Parallel camera acquisition error, checking fallback:", parallelErr?.name);

      // Strategy B: If hardware lock prevents parallel capture (NotReadableError or TrackStartError)
      // or overconstrained, stop old track and try with simpler constraints
      if (
        parallelErr?.name === "NotReadableError" ||
        parallelErr?.name === "TrackStartError" ||
        parallelErr?.name === "OverconstrainedError" ||
        numVideoDevices > 1
      ) {
        didStopOldTrackFirst = true;
        if (oldTrack) {
          try {
            oldTrack.stop();
          } catch (_) {}
        }

        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: nextFacing },
            audio: false,
          });
        } catch (retryErr: any) {
          console.error(`[CAMERA_FLIP] Failed to acquire ${nextFacing} camera:`, retryErr);

          // ROLLBACK RECOVERY: Try to restore previous camera
          try {
            console.log(`[CAMERA_FLIP] Attempting rollback to recover ${prevFacing} camera...`);
            const rollbackStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: prevFacing },
              audio: false,
            });
            const rollbackTrack = rollbackStream.getVideoTracks()[0];
            if (rollbackTrack && this.localStream) {
              rollbackTrack.enabled = wasVideoEnabled;
              this.localStream.addTrack(rollbackTrack);
              if (videoSender) {
                await videoSender.replaceTrack(rollbackTrack);
              }
              this.events.onLocalStream?.(this.localStream);
            }
          } catch (rollbackErr) {
            console.error("[CAMERA_FLIP] Rollback recovery also failed:", rollbackErr);
          }

          throw new Error(
            retryErr?.name === "OverconstrainedError" || retryErr?.name === "NotFoundError"
              ? "Secondary camera not found on this device."
              : retryErr?.message || "Failed to switch camera."
          );
        }
      } else {
        // Did not stop old track, old track is still active and valid!
        console.warn("[CAMERA_FLIP] Acquisition failed but old track remains active:", parallelErr);
        throw new Error(
          parallelErr?.name === "NotAllowedError"
            ? "Camera permission denied."
            : "Secondary camera unavailable."
        );
      }
    }

    // Verify acquired track
    const newVideoTracks = newStream.getVideoTracks();
    const newVideoTrack = newVideoTracks[0];
    if (!newVideoTrack) {
      console.warn("[CAMERA_FLIP] No video track returned in new camera stream");
      throw new Error("No video track found from camera.");
    }

    // Stop extra tracks if browser created multiples
    for (let i = 1; i < newVideoTracks.length; i++) {
      try {
        newVideoTracks[i].stop();
      } catch (_) {}
    }

    // Preserve previous video enabled/mute state
    newVideoTrack.enabled = wasVideoEnabled;

    // If old track wasn't stopped yet, stop and remove it now
    if (!didStopOldTrackFirst && oldTrack) {
      try {
        this.localStream?.removeTrack(oldTrack);
        oldTrack.stop();
      } catch (_) {}
    }

    // Attach new track to localStream
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((t) => {
        if (t.id !== newVideoTrack.id) {
          try {
            this.localStream?.removeTrack(t);
            t.stop();
          } catch (_) {}
        }
      });
      this.localStream.addTrack(newVideoTrack);
    } else {
      this.localStream = newStream;
    }

    // Replace outgoing track on RTCRtpSender
    if (videoSender) {
      try {
        await videoSender.replaceTrack(newVideoTrack);
        console.log("[CAMERA_FLIP] Outgoing video track successfully replaced on RTCRtpSender");
      } catch (repErr) {
        console.error("[CAMERA_FLIP] replaceTrack failed on RTCRtpSender:", repErr);
      }
    }

    this.currentFacingMode = nextFacing;
    this.events.onLocalStream?.(this.localStream);
    return this.localStream;
  }

  /**
   * Toggle local microphone track on / off
   */
  public setAudioEnabled(enabled: boolean): boolean {
    let tracksCount = 0;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
        tracksCount++;
      });
    }
    if (this.peerConnection) {
      this.peerConnection.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") {
          sender.track.enabled = enabled;
        }
      });
    }
    console.log(`[CONTROL_DEBUG] MIC_TOGGLE: enabled=${enabled}, tracksCount=${tracksCount}`);
    return enabled;
  }

  /**
   * Toggle local camera track on / off
   */
  public setVideoEnabled(enabled: boolean): boolean {
    let tracksCount = 0;
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
        tracksCount++;
      });
    }
    if (this.peerConnection) {
      this.peerConnection.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === "video") {
          sender.track.enabled = enabled;
        }
      });
    }
    console.log(`[CONTROL_DEBUG] CAMERA_TOGGLE: enabled=${enabled}, tracksCount=${tracksCount}`);
    return enabled;
  }

  /**
   * Starts screen sharing by replacing outgoing video track with screen capture or custom stream track.
   * Supports both native getDisplayMedia and high-performance canvas capture streams.
   */
  public async startScreenShare(
    customStreamOrOnEnded?: MediaStream | (() => void),
    onEnded?: () => void
  ): Promise<MediaStream> {
    let customStream: MediaStream | null = null;
    let actualOnEnded: (() => void) | undefined = onEnded;

    if (customStreamOrOnEnded instanceof MediaStream) {
      customStream = customStreamOrOnEnded;
    } else if (typeof customStreamOrOnEnded === "function") {
      actualOnEnded = customStreamOrOnEnded;
    }

    try {
      let screenStream: MediaStream;
      if (customStream && customStream.getVideoTracks().length > 0) {
        screenStream = customStream;
        console.log("[SCREEN_SHARE] Using provided high-performance screen/canvas stream");
      } else {
        const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
        const getDisplayMedia =
          nav?.mediaDevices?.getDisplayMedia?.bind(nav.mediaDevices) ||
          nav?.getDisplayMedia?.bind(nav) ||
          nav?.mediaDevices?.webkitGetDisplayMedia?.bind(nav.mediaDevices);

        if (!getDisplayMedia) {
          throw new Error("Device screen capture is not natively supported by this browser.");
        }
        const isMobileOrTablet =
          typeof navigator !== "undefined" &&
          /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        try {
          // Preferred enterprise-grade Full HD (1080p/60fps) screen capture with cursor
          screenStream = await getDisplayMedia({
            video: {
              cursor: "always",
              displaySurface: "monitor",
              width: { ideal: 1920, max: 3840 },
              height: { ideal: 1080, max: 2160 },
              frameRate: { ideal: 30, max: 60 },
            } as any,
            audio: false,
          });
        } catch (err: any) {
          console.warn("[SCREEN_SHARE] 1080p constraints rejected, retrying standard HD:", err);
          try {
            screenStream = await getDisplayMedia({
              video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 },
              } as any,
              audio: false,
            });
          } catch (retryErr) {
            console.warn("[SCREEN_SHARE] Retrying with basic video constraint:", retryErr);
            try {
              screenStream = await getDisplayMedia({ video: true });
            } catch (fallbackErr) {
              console.warn("[SCREEN_SHARE] Retrying with empty constraints for maximum browser compatibility:", fallbackErr);
              screenStream = await getDisplayMedia();
            }
          }
        }
      }

      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) {
        throw new Error("No video track captured from screen.");
      }

      // Ensure captured track is enabled and prioritize text sharpness/detail over aggressive downscaling
      screenTrack.enabled = true;
      try {
        // 'detail' hints WebRTC encoders to maintain 100% spatial sharpness for code, text, slides
        screenTrack.contentHint = "detail";
      } catch (hintErr) {
        console.warn("[SCREEN_SHARE] Could not set contentHint:", hintErr);
      }

      this.screenStream = screenStream;
      this.onScreenShareEndedCallback = actualOnEnded;

      // Preserve current active camera track to restore later
      const currentCamTrack = this.localStream?.getVideoTracks().find((t) => t.readyState === "live") || null;
      if (currentCamTrack && currentCamTrack !== screenTrack) {
        this.savedCameraTrack = currentCamTrack;
      }

      // Replace outgoing video track on RTCRtpSender or add if not present
      let videoSender: RTCRtpSender | null = null;
      if (this.peerConnection) {
        const transceivers = this.peerConnection.getTransceivers();
        const videoTransceiver = transceivers.find(
          (t) => t.receiver?.track?.kind === "video" || t.sender?.track?.kind === "video"
        );
        if (videoTransceiver && videoTransceiver.sender) {
          videoSender = videoTransceiver.sender;
        } else {
          videoSender =
            this.peerConnection.getSenders().find((s) => s.track && s.track.kind === "video") || null;
        }

        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
          console.log("[SCREEN_SHARE] Outgoing track successfully replaced with screenTrack");

          // Optimize WebRTC encoder parameters for ultra-crisp, lag-free screen sharing (Zoom / Google Meet standard)
          try {
            const isMobile =
              typeof navigator !== "undefined" &&
              /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

            const params = videoSender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            params.encodings.forEach((enc) => {
              // 1.8 Mbps on mobile prevents uplink hardware choke, 3.0 Mbps on desktop for 1080p
              enc.maxBitrate = isMobile ? 1800000 : 3000000;
              delete (enc as any).minBitrate; // Allow adaptive down-stepping to prevent packet buffer stalls
              enc.scaleResolutionDownBy = 1.0;
              enc.networkPriority = "high";
              // @ts-ignore
              enc.priority = "high";
            });
            // On mobile devices, prioritize framerate so User B never sees frozen or delayed screen
            // @ts-ignore
            if ("degradationPreference" in params) {
              // @ts-ignore
              params.degradationPreference = isMobile ? "maintain-framerate" : "balanced";
            }
            await videoSender.setParameters(params);
            console.log(`[SCREEN_SHARE] Adaptive screen encoding applied (isMobile=${isMobile})`);
          } catch (paramErr) {
            console.warn("[SCREEN_SHARE] Could not set encoding parameters (non-fatal):", paramErr);
          }
        } else {
          console.log("[SCREEN_SHARE] Adding screenTrack directly to peerConnection");
          this.peerConnection.addTrack(screenTrack, this.localStream || screenStream);
        }
      }

      // Handle user stopping screen share via browser floating bar or track ending
      screenTrack.onended = async () => {
        console.log("[SCREEN_SHARE] Screen sharing track ended");
        await this.stopScreenShare();
        if (this.onScreenShareEndedCallback) {
          this.onScreenShareEndedCallback();
        }
      };

      return screenStream;
    } catch (err: any) {
      console.warn("[SCREEN_SHARE] Failed to acquire display media:", err);
      throw err;
    }
  }

  /**
   * Stops active screen sharing and seamlessly restores the original camera track.
   */
  public async stopScreenShare(): Promise<void> {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      this.screenStream = null;
    }

    let videoSender: RTCRtpSender | null = null;
    if (this.peerConnection) {
      const transceivers = this.peerConnection.getTransceivers();
      const videoTransceiver = transceivers.find(
        (t) => t.receiver?.track?.kind === "video" || t.sender?.track?.kind === "video"
      );
      if (videoTransceiver && videoTransceiver.sender) {
        videoSender = videoTransceiver.sender;
      } else {
        videoSender =
          this.peerConnection.getSenders().find((s) => s.track && s.track.kind === "video") || null;
      }
    }

    // Restore previous camera track if live
    if (this.savedCameraTrack && this.savedCameraTrack.readyState === "live") {
      if (videoSender) {
        await videoSender.replaceTrack(this.savedCameraTrack);
        console.log("[SCREEN_SHARE] Restored original camera track");
        try {
          const params = videoSender.getParameters();
          if (params && params.encodings) {
            params.encodings.forEach((enc) => {
              enc.maxBitrate = 1500000;
              delete (enc as any).minBitrate;
              enc.scaleResolutionDownBy = 1.0;
              enc.networkPriority = "medium";
            });
            // @ts-ignore
            if ("degradationPreference" in params) {
              // @ts-ignore
              params.degradationPreference = "balanced";
            }
            await videoSender.setParameters(params);
          }
        } catch (_) {}
      }
      this.savedCameraTrack = null;
    } else if (this.localStream) {
      const fallbackCamTrack = this.localStream.getVideoTracks().find((t) => t.readyState === "live");
      if (fallbackCamTrack && videoSender) {
        await videoSender.replaceTrack(fallbackCamTrack);
        console.log("[SCREEN_SHARE] Restored fallback camera track");
      } else if (videoSender) {
        await videoSender.replaceTrack(null);
      }
    } else if (videoSender) {
      await videoSender.replaceTrack(null);
    }
  }

  public isScreenSharing(): boolean {
    return Boolean(this.screenStream && this.screenStream.active);
  }

  public getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  /**
   * Stops all active tracks on localStream
   */
  public stopLocalTracks(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          track.stop();
          console.log(`[WebRTC] Stopped local track: kind=${track.kind}`);
        } catch (_) {}
      });
      this.localStream = null;
    }
  }

  /**
   * Closes RTCPeerConnection and resets remote stream
   */
  private cleanupPeerConnection(): void {
    if (this.peerConnection) {
      try {
        // Explicitly remove all track senders before closing
        this.peerConnection.getSenders().forEach((sender) => {
          try {
            this.peerConnection?.removeTrack(sender);
          } catch (_) {}
        });

        this.peerConnection.ontrack = null;
        this.peerConnection.onicecandidate = null;
        this.peerConnection.onconnectionstatechange = null;
        this.peerConnection.oniceconnectionstatechange = null;
        this.peerConnection.close();
        console.log("[WebRTC] RTCPeerConnection closed and all senders removed successfully");
      } catch (err) {
        console.warn("[WebRTC] Non-fatal error closing peer connection:", err);
      }
      this.peerConnection = null;
    }

    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      this.remoteStream = null;
    }

    this.pendingCandidates = [];
    this.seenCandidates.clear();
  }

  /**
   * Complete, safe cleanup of all WebRTC media streams, tracks, and connections.
   */
  public cleanup(): void {
    if (this.isCleanedUp) return;
    this.isCleanedUp = true;
    console.log("[WebRTC] Executing complete WebRTC cleanup...");

    this.stopScreenShare().catch(() => {});
    this.stopLocalTracks();
    this.cleanupPeerConnection();
  }

  /**
   * Standard close alias for cleanup()
   */
  public close(): void {
    this.cleanup();
  }

  /**
   * Check if peer connection is actively connecting or connected
   */
  public isActive(): boolean {
    if (!this.peerConnection) return false;
    const state = this.peerConnection.connectionState;
    return state === "connected" || state === "connecting" || state === "new";
  }

  public getConnectionState(): RTCPeerConnectionState | null {
    return this.peerConnection?.connectionState || null;
  }

  public getIceConnectionState(): RTCIceConnectionState | null {
    return this.peerConnection?.iceConnectionState || null;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  public getPeerConnection(): RTCPeerConnection | null {
    return this.peerConnection;
  }

  public getCurrentFacingMode(): "user" | "environment" {
    return this.currentFacingMode;
  }
}
