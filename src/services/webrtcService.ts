/**
 * WebRTC 1-to-1 Real-Time Audio/Video Communication Service
 * 
 * Provides pure standard WebRTC peer connection, media capture, camera switching,
 * track management, and deterministic resource cleanup for SwapSkill on Web & Android APK.
 */

import { getApiBaseUrl } from "../utils/apiConfig";
import { auth } from "../firebase";
import { safeLocalStorage } from "../utils/safeStorage";

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

/**
 * Normalizes and validates any raw STUN/TURN URL into valid RFC-compliant WebRTC format.
 * Automatically fixes missing 'turn:' / 'stun:' protocols, removes 'turn://' typos,
 * and discards invalid entries so RTCPeerConnection constructor never throws:
 * "is not a valid stun or turn URL".
 */
export function sanitizeIceUrl(rawUrl: string, hasCredentials = false): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  let url = rawUrl.trim().replace(/\/+$/, "");
  if (!url) return null;

  // Fix common typo: protocol with double slashes (e.g., turn://host:3478 or turns://host:5349)
  if (/^turns?:\/\//i.test(url)) {
    url = url.replace(/^turn:\/\//i, "turn:").replace(/^turns:\/\//i, "turns:");
  } else if (/^stuns?:\/\//i.test(url)) {
    url = url.replace(/^stun:\/\//i, "stun:").replace(/^stuns:\/\//i, "stuns:");
  }

  // If already starts with valid scheme
  if (/^(stun|stuns|turn|turns):/i.test(url)) {
    return url;
  }

  // Missing scheme!
  // If credentials are provided or host contains "turn" / "relay", it is a TURN server:
  const isTurn = hasCredentials || /turn|relay/i.test(url);
  const isSecure = /:5349\b/i.test(url) || /transport=(tls|tcp-tls)/i.test(url) || /\bturns\b/i.test(url);

  if (isTurn) {
    return `${isSecure ? "turns:" : "turn:"}${url}`;
  } else {
    return `${isSecure ? "stuns:" : "stun:"}${url}`;
  }
}

/**
 * Sanitizes an array of RTCIceServer objects:
 * - Normalizes all URLs so none can throw "not a valid stun or turn URL"
 * - Drops completely invalid / empty entries
 * - Ensures fallback reliability
 */
export function sanitizeIceServers(servers: RTCIceServer[]): RTCIceServer[] {
  if (!Array.isArray(servers) || servers.length === 0) {
    return DEFAULT_ICE_SERVERS;
  }

  const sanitized: RTCIceServer[] = [];

  for (const server of servers) {
    if (!server) continue;
    const rawUrls = Array.isArray(server.urls) ? server.urls : [server.urls];
    const hasCreds = Boolean(server.username && server.credential);

    const validUrls: string[] = [];
    for (const raw of rawUrls) {
      const fixed = sanitizeIceUrl(raw, hasCreds);
      if (fixed && /^(stun|stuns|turn|turns):/i.test(fixed)) {
        if (!validUrls.includes(fixed)) {
          validUrls.push(fixed);
        }
      }
    }

    if (validUrls.length > 0) {
      sanitized.push({
        urls: validUrls.length === 1 ? validUrls[0] : validUrls,
        ...(server.username ? { username: server.username } : {}),
        ...(server.credential ? { credential: server.credential } : {}),
      });
    }
  }

  return sanitized.length > 0 ? sanitized : DEFAULT_ICE_SERVERS;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.relay.metered.ca:80" },
  {
    urls: [
      "turn:global.relay.metered.ca:80",
      "turn:global.relay.metered.ca:80?transport=tcp",
      "turn:global.relay.metered.ca:443",
      "turn:global.relay.metered.ca:443?transport=tcp",
      "turns:global.relay.metered.ca:443?transport=tcp",
    ],
    username: "13748a1862f0e5316c1a9877",
    credential: "9cgHjuE4wpy1L/Dq",
  },
];

const ICE_SERVER_CACHE_TTL_MS = 10 * 60 * 1000;
const ICE_LOCAL_STORAGE_KEY = "swap_ice_servers_cache_v1";

function loadCachedIceFromStorage(): { iceServers: RTCIceServer[]; savedAt: number } | null {
  try {
    const raw = safeLocalStorage.getItem(ICE_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.iceServers) && parsed.iceServers.length > 0) {
      return {
        iceServers: sanitizeIceServers(parsed.iceServers),
        savedAt: Number(parsed.savedAt) || 0,
      };
    }
  } catch (_) {}
  return null;
}

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private outboundStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private seenCandidates = new Set<string>();
  private events: WebRTCServiceEvents = {};
  private currentFacingMode: "user" | "environment" = "user";
  private isCleanedUp = false;
  private static cachedIceServers: RTCIceServer[] | null =
    loadCachedIceFromStorage()?.iceServers || DEFAULT_ICE_SERVERS;
  private static lastIceRefreshAt = loadCachedIceFromStorage()?.savedAt || 0;
  private static iceRefreshInFlight: Promise<void> | null = null;
  private isRestartingIce = false;
  private isAnswerer = false;
  private attachedRemoteTracks = new WeakSet<MediaStreamTrack>();
  private iceRestartDebounceTimer: ReturnType<typeof setTimeout> | null = null;
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
   * On warm cache, returns immediately (0ms). On cold cache (first call of session),
   * races background backend fetch with a tight 600ms cap so fresh ExpressTurn/Coturn
   * credentials are used on Call #1 without stalling signaling.
   */
  public static async fetchIceServers(forceRefresh = false): Promise<RTCIceServer[]> {
    const now = Date.now();
    const isCold = WebRTCService.lastIceRefreshAt === 0;
    const isStale = now - WebRTCService.lastIceRefreshAt > ICE_SERVER_CACHE_TTL_MS;

    if (forceRefresh || isStale || isCold) {
      const refreshPromise = WebRTCService.refreshIceServersInBackground(forceRefresh);
      // On first-ever cold start, allow up to 600ms to grab fresh TURN credentials before falling back to defaults
      if ((isCold || forceRefresh) && refreshPromise) {
        await Promise.race([
          refreshPromise,
          new Promise<void>((resolve) => setTimeout(resolve, 600)),
        ]);
      }
    }

    if (WebRTCService.cachedIceServers) {
      return sanitizeIceServers(WebRTCService.cachedIceServers);
    }

    return DEFAULT_ICE_SERVERS;
  }

  /**
   * Asynchronously queries the backend ICE servers endpoint and updates cached list + localStorage
   */
  private static refreshIceServersInBackground(forceRefresh = false): Promise<void> | null {
    const now = Date.now();
    if (!forceRefresh && WebRTCService.iceRefreshInFlight) return WebRTCService.iceRefreshInFlight;
    if (!forceRefresh && WebRTCService.lastIceRefreshAt > 0 && now - WebRTCService.lastIceRefreshAt < ICE_SERVER_CACHE_TTL_MS) {
      return null;
    }

    const baseUrl = getApiBaseUrl();
    const endpoint = baseUrl ? `${baseUrl}/api/webrtc/ice-servers` : "/api/webrtc/ice-servers";
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 1800) : null;

    WebRTCService.iceRefreshInFlight = (auth.currentUser
      ? auth.currentUser.getIdToken()
      : Promise.resolve(null))
      .then((idToken) =>
        fetch(endpoint, {
          signal: controller ? controller.signal : undefined,
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        })
      )
      .then((res) => (res && res.ok ? res.json() : null))
      .then((data) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          const sanitized = sanitizeIceServers(data.iceServers);
          const hasTurn = sanitized.some((s: RTCIceServer) => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some((u) => u.startsWith("turn:") || u.startsWith("turns:"));
          });
          const resolvedServers = hasTurn
            ? sanitized
            : [...sanitized, DEFAULT_ICE_SERVERS[DEFAULT_ICE_SERVERS.length - 1]];
          const savedAt = Date.now();
          WebRTCService.cachedIceServers = resolvedServers;
          WebRTCService.lastIceRefreshAt = savedAt;
          try {
            safeLocalStorage.setItem(
              ICE_LOCAL_STORAGE_KEY,
              JSON.stringify({ iceServers: resolvedServers, savedAt })
            );
          } catch (_) {}
          console.log(`[WebRTC] Background refreshed ${resolvedServers.length} ICE servers`);
        }
      })
      .catch(() => {
        if (timeoutId) clearTimeout(timeoutId);
      })
      .finally(() => {
        WebRTCService.iceRefreshInFlight = null;
      });

    return WebRTCService.iceRefreshInFlight;
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
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
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
   * Initializes RTCPeerConnection immediately (even before camera/mic stream resolves)
   * using pre-configured sendrecv transceivers bound to a persistent outbound MediaStream.
   */
  public initPeerConnection(
    customIceServers?: RTCIceServer[],
    existingStream?: MediaStream | null,
    options?: { enableVideo?: boolean; isAnswerer?: boolean }
  ): RTCPeerConnection {
    if (this.peerConnection) {
      this.cleanupPeerConnection();
    }

    this.isAnswerer = Boolean(options?.isAnswerer);

    if (existingStream) {
      this.localStream = existingStream;
    }

    // 1. Sanitize all incoming ICE servers so RTCPeerConnection constructor never throws "not a valid stun or turn URL"
    const rawServers = customIceServers && customIceServers.length > 0
      ? customIceServers
      : (WebRTCService.cachedIceServers || DEFAULT_ICE_SERVERS);

    const iceServers = sanitizeIceServers(rawServers);

    const config: RTCConfiguration = {
      iceServers,
      iceCandidatePoolSize: 4, // Pre-gather STUN+TURN candidate pool immediately
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    };

    console.log(
      `[WEBRTC] Creating RTCPeerConnection (isAnswerer=${this.isAnswerer}) with ${iceServers.length} ICE servers:`,
      iceServers.map((s) => (Array.isArray(s.urls) ? s.urls.join(", ") : s.urls)).join(" | ")
    );

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection(config);
    } catch (pcErr) {
      console.warn("[WEBRTC] Failed to construct RTCPeerConnection with configured servers, falling back to guaranteed DEFAULT_ICE_SERVERS:", pcErr);
      pc = new RTCPeerConnection({
        iceServers: DEFAULT_ICE_SERVERS,
        iceCandidatePoolSize: 4,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      });
    }

    this.peerConnection = pc;
    this.isCleanedUp = false;
    this.remoteStream = new MediaStream();
    this.outboundStream = existingStream || new MediaStream();
    this.pendingCandidates = [];
    this.seenCandidates.clear();
    console.log("[WEBRTC_PC_CREATED]");
    console.log("[WEBRTC] PEER_CONNECTION_CREATED");

    const emitFreshRemoteStream = () => {
      if (!this.remoteStream) return;
      const liveTracks = this.remoteStream.getTracks().filter((t) => t.readyState !== "ended");
      const freshSnapshot = new MediaStream(liveTracks);
      this.remoteStream = freshSnapshot;
      this.events.onRemoteStream?.(freshSnapshot);
    };

    // Handle remote tracks with robust multi-track combination, deduplication, and fresh MediaStream snapshots
    pc.ontrack = (event) => {
      const track = event.track;
      console.log("[WEBRTC_REMOTE_TRACK]");
      console.log(`[LS_DEBUG] ontrack received: kind=${track.kind}, id=${track.id}, readyState=${track.readyState}, muted=${track.muted}`);

      // Note: Do NOT force jitterBufferTarget=0 / playoutDelayHint=0 on video tracks —
      // zero-jitter video starves multi-packet I-frame assembly on mobile networks and causes solid black video.
      if (event.receiver && track.kind === "audio") {
        try {
          if ("playoutDelayHint" in event.receiver) {
            (event.receiver as any).playoutDelayHint = 0.02;
          }
        } catch (_) {}
      }

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

      // Emit a fresh MediaStream snapshot so <video>.srcObject !== stream always triggers rebind when video arrives after audio
      emitFreshRemoteStream();

      if (!this.attachedRemoteTracks.has(track)) {
        this.attachedRemoteTracks.add(track);
        const handleUnmute = () => {
          console.log(`[LS_DEBUG] Remote track ${track.kind} (${track.id}) unmuted, emitting refreshed remote stream`);
          emitFreshRemoteStream();
        };

        const handleMute = () => {
          console.log(`[LS_DEBUG] Remote track ${track.kind} (${track.id}) muted`);
        };

        track.addEventListener("unmute", handleUnmute);
        track.addEventListener("mute", handleMute);
      }
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
        if (this.iceRestartDebounceTimer) {
          clearTimeout(this.iceRestartDebounceTimer);
          this.iceRestartDebounceTimer = null;
        }
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
        if (this.iceRestartDebounceTimer) {
          clearTimeout(this.iceRestartDebounceTimer);
          this.iceRestartDebounceTimer = null;
        }
        console.log("[CALL_TRACE] Step 7: WebRTC ICE connected successfully!");
        console.log("[LIVE SWAP] ICE_CONNECTED");
        // Treat ICE connection as connected if connectionState hasn't fired yet
        if (pc.connectionState !== "connected" && pc.connectionState !== "failed") {
          this.events.onConnectionStateChange?.("connected");
        }
      } else if (pc.iceConnectionState === "failed") {
        if (this.iceRestartDebounceTimer) {
          clearTimeout(this.iceRestartDebounceTimer);
          this.iceRestartDebounceTimer = null;
        }
        console.warn("[WEBRTC] ICE state is failed. Requesting immediate reconnect/restart...");
        this.events.onIceRestartNeeded?.();
      } else if (pc.iceConnectionState === "disconnected") {
        // Transient disconnects frequently self-recover within <1.5s; debounce to avoid spurious renegotiations
        if (!this.iceRestartDebounceTimer) {
          this.iceRestartDebounceTimer = setTimeout(() => {
            this.iceRestartDebounceTimer = null;
            if (
              this.peerConnection === pc &&
              (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed")
            ) {
              console.warn(`[WEBRTC] ICE remained ${pc.iceConnectionState} after 1.5s. Requesting reconnect/restart...`);
              this.events.onIceRestartNeeded?.();
            }
          }, 1500);
        }
      }
      this.events.onIceConnectionStateChange?.(pc.iceConnectionState);
    };

    // Add local tracks if stream is already acquired AND we are not an Answerer waiting on setRemoteDescription
    if (this.localStream && !this.isAnswerer) {
      console.log("[CALL_TRACE] Step 5: Initializing peer connection with local tracks...");
      this.localStream.getTracks().forEach((track) => {
        try {
          const senders = pc.getSenders();
          const existingSender = senders.find((s) => s.track && s.track.kind === track.kind);
          if (existingSender) {
            existingSender.replaceTrack(track);
            console.log(`[CALL_TRACE] Step 6: Local track replaced in PeerConnection: kind=${track.kind}`);
          } else {
            pc.addTrack(track, this.localStream!);
            console.log(`[CALL_TRACE] Step 6: Local track published to PeerConnection: kind=${track.kind}`);
          }
        } catch (e) {
          console.warn("[WebRTC] Error adding local track to peer connection:", e);
        }
      });
    }

    // Pre-create sendrecv transceivers ONLY on the Offerer.
    // The Answerer MUST let setRemoteDescription(offer) create/match exact mid-bound transceivers
    // so local tracks never bind to orphan mid=null transceivers (prevents 1-way black video).
    if (!this.isAnswerer) {
      const enableVideo =
        options?.enableVideo !== undefined
          ? options.enableVideo
          : this.localStream
          ? this.localStream.getVideoTracks().length > 0
          : true;
      const kinds: ("audio" | "video")[] = enableVideo ? ["audio", "video"] : ["audio"];
      kinds.forEach((kind) => {
        const transceiver = pc.getTransceivers().find((t) => t.currentDirection !== "stopped" && t.direction !== "stopped" && t.receiver.track.kind === kind);
        if (transceiver) {
          if (transceiver.direction !== "sendrecv") {
            transceiver.direction = "sendrecv";
          }
        } else {
          try {
            if (this.outboundStream) {
              pc.addTransceiver(kind, { direction: "sendrecv", streams: [this.outboundStream] });
            } else {
              pc.addTransceiver(kind, { direction: "sendrecv" });
            }
            console.log(`[WebRTC] Initialized ${kind} transceiver with sendrecv direction`);
          } catch (e) {
            try {
              pc.addTransceiver(kind, { direction: "sendrecv" });
            } catch (fallbackErr) {
              console.warn(`[WebRTC] Could not add transceiver for ${kind}:`, fallbackErr);
            }
          }
        }
      });
    }

    return pc;
  }

  private findTransceiverByKind(kind: "audio" | "video"): RTCRtpTransceiver | null {
    if (!this.peerConnection || !this.peerConnection.getTransceivers) return null;
    const transceivers = this.peerConnection.getTransceivers().filter((t) => t.currentDirection !== "stopped" && t.direction !== "stopped");
    // Prioritize already-negotiated transceivers with a valid mid
    return (
      transceivers.find(
        (t) =>
          t.mid !== null &&
          (t.receiver?.track?.kind === kind || t.sender?.track?.kind === kind)
      ) ||
      transceivers.find(
        (t) => t.receiver?.track?.kind === kind || t.sender?.track?.kind === kind
      ) ||
      null
    );
  }

  private async bindLocalStreamToPeerConnection(stream: MediaStream): Promise<void> {
    const pc = this.peerConnection;
    if (!pc || pc.signalingState === "closed") return;

    const tracks = stream.getTracks().filter((t) => t.readyState !== "ended");
    for (const track of tracks) {
      try {
        const kind = track.kind === "video" ? "video" : "audio";
        const matchingTransceiver = this.findTransceiverByKind(kind);
        const senders = pc.getSenders ? pc.getSenders() : [];
        const matchingSender =
          matchingTransceiver?.sender ||
          senders.find((s) => s.track?.kind === kind) ||
          null;

        if (matchingTransceiver && matchingTransceiver.direction !== "sendrecv") {
          matchingTransceiver.direction = "sendrecv";
        }

        if (matchingSender) {
          if (matchingSender.track?.id !== track.id) {
            await matchingSender.replaceTrack(track);
            console.log(`[WebRTC] Bound local ${track.kind} track via replaceTrack (mid=${matchingTransceiver?.mid ?? "none"})`);
          }
          if (kind === "video") {
            try {
              const params = matchingSender.getParameters();
              if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
              }
              params.encodings.forEach((enc) => {
                enc.maxBitrate = 1500000;
                enc.maxFramerate = 30;
              });
              // @ts-ignore
              if ("degradationPreference" in params) {
                // @ts-ignore
                params.degradationPreference = "maintain-framerate";
              }
              await matchingSender.setParameters(params);
            } catch (_) {}
          }
        } else {
          pc.addTrack(track, stream);
          console.log(`[WebRTC] Added local ${track.kind} track directly to PeerConnection`);
        }
      } catch (err) {
        console.warn(`[WebRTC] Error binding local ${track.kind} track:`, err);
      }
    }
  }

  /**
   * Attaches a late-resolved local MediaStream onto existing RTCPeerConnection transceivers/senders
   * via replaceTrack() so media flows instantaneously with zero SDP renegotiation.
   */
  public attachLocalStream(stream: MediaStream): void {
    if (this.isCleanedUp) {
      stream.getTracks().forEach((t) => {
        try { t.stop(); } catch (_) {}
      });
      return;
    }

    this.localStream = stream;
    this.isCleanedUp = false;
    console.log(
      `[WEBRTC] ATTACH_LOCAL_STREAM: ${stream.getVideoTracks().length} video, ${stream.getAudioTracks().length} audio tracks`
    );
    this.events.onLocalStream?.(stream);

    const pc = this.peerConnection;
    if (!pc || pc.signalingState === "closed") return;

    // If Answerer has not yet processed remote Offer, defer track attachment to createAnswer()
    // right after setRemoteDescription(offer) so tracks bind to the exact mid-matched transceivers.
    if (this.isAnswerer && !pc.remoteDescription) {
      console.log("[WebRTC] Deferring Answerer track bind until setRemoteDescription(offer)");
      return;
    }

    void this.bindLocalStreamToPeerConnection(stream);
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

    const hasVideoTransceiver = this.peerConnection
      .getTransceivers()
      .some((t) => t.receiver?.track?.kind === "video" || t.sender?.track?.kind === "video");
    const hasVideo = this.localStream ? this.localStream.getVideoTracks().length > 0 : hasVideoTransceiver;
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

    // Ensure all non-stopped transceivers have direction = "sendrecv" so callee actively publishes both audio & video
    this.peerConnection.getTransceivers().forEach((t) => {
      if (t.currentDirection !== "stopped" && t.direction !== "stopped" && t.direction !== "sendrecv") {
        t.direction = "sendrecv";
      }
    });

    // Bind local tracks synchronously onto matched mid transceivers before generating SDP Answer
    if (this.localStream) {
      await this.bindLocalStreamToPeerConnection(this.localStream);
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
   * Returns ICE candidate priority rank (lower = faster connection path):
   * host UDP (0) < srflx/prflx (1) < relay UDP (2) < relay TCP/TLS (3) < host TCP (4)
   */
  private getCandidatePriorityScore(candStr?: string): number {
    if (!candStr) return 99;
    const lower = candStr.toLowerCase();
    if (lower.includes("typ host")) {
      return /\stcp\s/.test(lower) ? 4 : 0;
    }
    if (lower.includes("typ srflx") || lower.includes("typ prflx")) {
      return 1;
    }
    if (lower.includes("typ relay")) {
      return /\stcp\s/.test(lower) ? 3 : 2;
    }
    return 5;
  }

  /**
   * Flush pending candidates once remote description is set (priority-ordered & parallel)
   */
  private async flushPendingCandidates(): Promise<void> {
    const pc = this.peerConnection;
    if (!pc || this.pendingCandidates.length === 0) return;

    const queued = [...this.pendingCandidates].sort(
      (a, b) => this.getCandidatePriorityScore(a.candidate) - this.getCandidatePriorityScore(b.candidate)
    );
    this.pendingCandidates = [];

    console.log(`[WebRTC] Flushing ${queued.length} queued ICE candidates in parallel...`);
    await Promise.allSettled(
      queued.map(async (cand) => {
        try {
          const cleanCand = this.sanitizeCandidateInit(cand);
          await pc.addIceCandidate(new RTCIceCandidate(cleanCand));
        } catch (err) {
          console.warn("[WebRTC] Failed to flush queued candidate:", err);
        }
      })
    );
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

    // 1. Locate the outgoing VIDEO sender / transceiver BEFORE modifying any tracks (prefer active mid-bound)
    let videoSender: RTCRtpSender | null = null;
    if (this.peerConnection) {
      const videoTransceiver = this.findTransceiverByKind("video");
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
          // Enterprise-grade Full HD (1080p@30fps) screen capture with cursor.
          // Capping at 1080p eliminates 4K/Retina encoding choke and packet queue delays while ensuring code and text are 100% pin-sharp.
          screenStream = await getDisplayMedia({
            video: {
              cursor: "always",
              displaySurface: "monitor",
              width: { ideal: 1920, max: 1920 },
              height: { ideal: 1080, max: 1080 },
              frameRate: { ideal: 30, max: 30 },
            } as any,
            audio: false,
          });
        } catch (err: any) {
          console.warn("[SCREEN_SHARE] 1080p constraints rejected, retrying standard HD:", err);
          try {
            screenStream = await getDisplayMedia({
              video: {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 30, max: 30 },
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

      // Ensure captured track is enabled and prioritize smooth real-time delivery over buffering
      screenTrack.enabled = true;
      try {
        // 'motion' ensures Chromium delivers frames without buffering delays or dropping frame rates
        screenTrack.contentHint = "motion";
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

      // Replace outgoing video track on active RTCRtpSender or add if not present
      let videoSender: RTCRtpSender | null = null;
      if (this.peerConnection) {
        const videoTransceiver = this.findTransceiverByKind("video");
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
              // 2.2 Mbps on mobile, 3.2 Mbps on desktop: optimal for 1080p/720p 30fps without packet queues
              enc.maxBitrate = isMobile ? 2200000 : 3200000;
              enc.maxFramerate = 30; // Fluid 30 fps
              delete (enc as any).minBitrate; // Allow adaptive down-stepping to prevent packet buffer stalls
              enc.scaleResolutionDownBy = 1.0;
              enc.networkPriority = "high";
              // @ts-ignore
              enc.priority = "high";
            });
            // Prioritize framerate so 2nd user sees real-time, lag-free updates with zero frame queue buildup
            // @ts-ignore
            if ("degradationPreference" in params) {
              // @ts-ignore
              params.degradationPreference = "maintain-framerate";
            }
            await videoSender.setParameters(params);
            console.log(`[SCREEN_SHARE] Real-time smooth screen encoding applied (isMobile=${isMobile})`);
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
      const videoTransceiver = this.findTransceiverByKind("video");
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
    if (this.iceRestartDebounceTimer) {
      clearTimeout(this.iceRestartDebounceTimer);
      this.iceRestartDebounceTimer = null;
    }

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

    this.outboundStream = null;

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
