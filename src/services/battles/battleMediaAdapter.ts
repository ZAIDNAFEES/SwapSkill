import { Device, types as mediasoupTypes } from "mediasoup-client";
import { auth } from "../../firebase";
import { getApiUrl } from "../../utils/apiConfig";
import { mobilePermissionService } from "../mobile/permissions";
import { BattleNetworkQuality } from "../../types/battle";
import {
  BattleRealtimeClient,
  RoomPublishersState,
  RoomRole,
  SfuProducerSummary,
} from "./battleRealtimeClient";
import { WebRTCService } from "../webrtcService";

export type ViewerStreamStatus = "offline" | "connecting" | "live" | "buffering" | "reconnecting";
export type StreamQualitySetting = "auto" | "1080p" | "720p" | "480p";

export type LocalMediaErrorCode =
  | "none"
  | "permission-denied"
  | "not-found"
  | "busy"
  | "camera-denied-audio-only"
  | "unknown";

export interface SlotVideoMetrics {
  width: number;
  height: number;
  fps?: number;
}

export interface BattleMediaConfig {
  mode: "mediasoup_sfu" | "ws_webrtc_relay";
  sfuUrl?: string;
  role: RoomRole;
  canPublish: boolean;
  maxDirectPeers?: number;
  iceServers: RTCIceServer[];
  capabilities?: {
    maxQuality?: string;
    simulcast?: boolean;
    sfuConfigured?: boolean;
    mediasoupWorkerPresent?: boolean;
    reason?: string;
  };
}

export interface BattleMediaCallbacks {
  onModeResolved?: (config: BattleMediaConfig) => void;
  onLocalStream?: (stream: MediaStream | null) => void;
  onLocalMediaError?: (code: LocalMediaErrorCode, message?: string) => void;
  onSlotStream?: (slot: "A" | "B", stream: MediaStream | null) => void;
  onSlotStatus?: (slot: "A" | "B", status: ViewerStreamStatus) => void;
  onSlotMetrics?: (slot: "A" | "B", metrics: SlotVideoMetrics) => void;
  onNetworkQuality?: (quality: BattleNetworkQuality) => void;
}

export async function fetchBattleMediaConfig(
  battleId: string,
  role: RoomRole,
  displayName: string
): Promise<BattleMediaConfig> {
  const token = await auth.currentUser?.getIdToken().catch(() => "");
  const fallbackIce = await WebRTCService.fetchIceServers();
  try {
    const endpoint = getApiUrl(
      `/api/battles/${encodeURIComponent(battleId)}/media-config?role=${encodeURIComponent(
        role
      )}&name=${encodeURIComponent(displayName)}`
    );
    const res = await fetch(endpoint, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      return (await res.json()) as BattleMediaConfig;
    }
  } catch (_) {}

  return {
    mode: "ws_webrtc_relay",
    role,
    canPublish: role === "competitorA" || role === "competitorB",
    maxDirectPeers: 25,
    iceServers: fallbackIce,
    capabilities: { maxQuality: "1080p", simulcast: false, sfuConfigured: false },
  };
}

function classifyMediaError(errMsg?: string): LocalMediaErrorCode {
  const msg = (errMsg || "").toLowerCase();
  if (msg.includes("permission") || msg.includes("denied") || msg.includes("notallowed")) {
    return "permission-denied";
  }
  if (msg.includes("no camera") || msg.includes("notfound") || msg.includes("device")) {
    return "not-found";
  }
  if (msg.includes("in use") || msg.includes("busy") || msg.includes("notreadable")) {
    return "busy";
  }
  return "unknown";
}

function qualityToMaxBitrate(q: StreamQualitySetting | "high" | "medium" | "low"): number {
  if (q === "480p" || q === "low") return 600_000;
  if (q === "720p" || q === "medium") return 1_300_000;
  return 2_500_000;
}

function qualityToPref(q: StreamQualitySetting): "high" | "medium" | "low" {
  if (q === "480p") return "low";
  if (q === "720p") return "medium";
  return "high";
}

export interface BattleMediaController {
  readonly mode: "mediasoup_sfu" | "ws_webrtc_relay";
  startStageMedia: (audioOnlyFallback?: boolean) => Promise<{ ok: boolean; camActive: boolean }>;
  stopStageMedia: () => Promise<void>;
  subscribeAsViewer: () => Promise<void>;
  onRealtimeReconnected: (publishers: RoomPublishersState) => void;
  setMicEnabled: (enabled: boolean) => void;
  setCamEnabled: (enabled: boolean) => void;
  flipCamera: () => Promise<boolean>;
  setScreenShareTrack: (track: MediaStreamTrack | null) => Promise<void>;
  setViewerQuality: (quality: StreamQualitySetting) => void;
  handlePublishersSnapshot: (publishers: RoomPublishersState) => void;
  handleSfuProducersUpdate: (producers: SfuProducerSummary[]) => void;
  handleRtcViewerJoin: (evt: {
    viewerConnId: string;
    viewerUid: string;
    viewerRole: RoomRole;
    targetSlot: "A" | "B";
    preferredQuality: "high" | "medium" | "low";
  }) => void;
  handleRtcViewerLeave: (evt: { viewerConnId: string }) => void;
  handleRtcSignal: (evt: {
    fromConnId: string;
    fromUid: string;
    fromSlot?: "A" | "B";
    targetSlot?: "A" | "B";
    signalType: "offer" | "answer" | "ice" | "renegotiate";
    direction?: "out" | "in";
    payload: any;
  }) => void;
  handlePeerDisconnected: (evt: { connId: string }) => void;
  cleanup: () => Promise<void>;
}

/**
 * Zero-Glare Multi-Peer WebSocket + TURN WebRTC Broadcast Engine
 * - Outbound PCs handle publishing (`mySlot` -> subscriber `connId`, tagged `direction: "out"`).
 * - Inbound PCs handle subscribing (`otherSlot` -> local slot tile, tagged `direction: "in"`).
 * - Competitor A and Competitor B independently subscribe to each other via `rtc_subscribe`,
 *   completely eliminating duplicate offer collisions and glare.
 */
class WsWebRtcMediaController implements BattleMediaController {
  public readonly mode = "ws_webrtc_relay" as const;

  private disposed = false;
  private localCameraStream: MediaStream | null = null;
  private screenVideoTrack: MediaStreamTrack | null = null;
  private currentFacingMode: "user" | "environment" = "user";
  private micEnabled = true;
  private camEnabled = true;
  private isPublishing = false;
  private viewerQuality: StreamQualitySetting = "auto";
  private lastPublishers: RoomPublishersState = { A: null, B: null };

  private outboundPeers = new Map<
    string,
    {
      pc: RTCPeerConnection;
      isViewer: boolean;
      targetConnId: string;
      preferredQuality: "high" | "medium" | "low";
      pendingIce: RTCIceCandidateInit[];
      remoteSet: boolean;
      videoSender: RTCRtpSender | null;
      audioSender: RTCRtpSender | null;
    }
  >();

  private inboundPeers = new Map<
    "A" | "B",
    {
      pc: RTCPeerConnection;
      publisherConnId: string;
      stream: MediaStream;
      pendingIce: RTCIceCandidateInit[];
      remoteSet: boolean;
      subscribedAtMs: number;
    }
  >();

  private subscribeCooldown = new Map<"A" | "B", number>();
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private networkQuality: BattleNetworkQuality = "unknown";

  constructor(
    private readonly role: RoomRole,
    private readonly mySlot: "A" | "B" | undefined,
    private readonly iceServers: RTCIceServer[],
    private readonly maxDirectPeers: number,
    private readonly wsClient: BattleRealtimeClient,
    private readonly callbacks: BattleMediaCallbacks
  ) {}

  private getOutboundVideoTrack(): MediaStreamTrack | null {
    if (this.screenVideoTrack && this.screenVideoTrack.readyState === "live") {
      return this.screenVideoTrack;
    }
    return this.localCameraStream?.getVideoTracks()?.[0] || null;
  }

  private getOutboundAudioTrack(): MediaStreamTrack | null {
    return this.localCameraStream?.getAudioTracks()?.[0] || null;
  }

  private emitLocalPreviewStream() {
    const tracks: MediaStreamTrack[] = [];
    const vTrack = this.getOutboundVideoTrack();
    const aTrack = this.getOutboundAudioTrack();
    if (vTrack) tracks.push(vTrack);
    if (aTrack) tracks.push(aTrack);
    this.callbacks.onLocalStream?.(tracks.length > 0 ? new MediaStream(tracks) : null);

    if (this.mySlot && vTrack) {
      const s = vTrack.getSettings?.();
      if (s?.width && s?.height) {
        this.callbacks.onSlotMetrics?.(this.mySlot, {
          width: s.width,
          height: s.height,
          fps: s.frameRate ? Math.round(s.frameRate) : undefined,
        });
      }
    }
  }

  public async startStageMedia(audioOnlyFallback = false): Promise<{ ok: boolean; camActive: boolean }> {
    if (!this.mySlot || this.disposed) return { ok: false, camActive: false };

    let acquiredStream: MediaStream | null = null;
    let camActive = false;

    if (!audioOnlyFallback) {
      const videoRes = await mobilePermissionService.acquireCallMediaStream({
        video: true,
        audio: true,
      });
      if (videoRes.success && videoRes.stream) {
        acquiredStream = videoRes.stream;
        camActive = videoRes.stream.getVideoTracks().length > 0;
        this.callbacks.onLocalMediaError?.("none");
      } else {
        const audioRes = await mobilePermissionService.acquireCallMediaStream({
          video: false,
          audio: true,
        });
        if (audioRes.success && audioRes.stream) {
          acquiredStream = audioRes.stream;
          camActive = false;
          this.callbacks.onLocalMediaError?.(
            "camera-denied-audio-only",
            videoRes.error || "Camera unavailable — broadcasting microphone only"
          );
        } else {
          this.callbacks.onLocalMediaError?.(
            classifyMediaError(videoRes.error || audioRes.error),
            videoRes.error || audioRes.error || "Camera and microphone permissions are required."
          );
          return { ok: false, camActive: false };
        }
      }
    } else {
      const audioRes = await mobilePermissionService.acquireCallMediaStream({
        video: false,
        audio: true,
      });
      if (audioRes.success && audioRes.stream) {
        acquiredStream = audioRes.stream;
        camActive = false;
        this.callbacks.onLocalMediaError?.("none");
      } else {
        this.callbacks.onLocalMediaError?.(
          classifyMediaError(audioRes.error),
          audioRes.error || "Microphone permission denied."
        );
        return { ok: false, camActive: false };
      }
    }

    if (this.disposed) {
      acquiredStream.getTracks().forEach((t) => t.stop());
      return { ok: false, camActive: false };
    }

    this.localCameraStream = acquiredStream;
    this.camEnabled = camActive;
    this.micEnabled = acquiredStream.getAudioTracks().length > 0;
    this.isPublishing = true;

    this.emitLocalPreviewStream();
    this.publishStateOverWs();
    this.startStatsLoop();

    // Sync any already-created outbound peers (if track changed) & subscribe to opponent
    await this.replaceAllOutboundVideoTracks(this.getOutboundVideoTrack());
    this.handlePublishersSnapshot(this.lastPublishers);

    return { ok: true, camActive };
  }

  private publishStateOverWs() {
    if (!this.mySlot) return;
    this.wsClient.updatePublisherState({
      publishing: this.isPublishing,
      micActive: this.micEnabled,
      camActive: this.camEnabled,
      screenSharing: Boolean(this.screenVideoTrack),
      networkQuality: this.networkQuality,
    });
  }

  public async stopStageMedia(): Promise<void> {
    this.isPublishing = false;
    this.stopStatsLoop();

    for (const [id, entry] of this.outboundPeers) {
      try {
        entry.pc.close();
      } catch (_) {}
      this.outboundPeers.delete(id);
    }

    if (this.localCameraStream) {
      this.localCameraStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch (_) {}
      });
      this.localCameraStream = null;
    }
    mobilePermissionService.releaseActiveStream();
    this.callbacks.onLocalStream?.(null);
    this.publishStateOverWs();
  }

  public async subscribeAsViewer(): Promise<void> {
    if (this.disposed) return;
    this.startStatsLoop();
    this.handlePublishersSnapshot(this.lastPublishers);
  }

  public onRealtimeReconnected(publishers: RoomPublishersState): void {
    if (this.disposed) return;
    if (this.isPublishing && this.mySlot) {
      this.publishStateOverWs();
    }
    this.handlePublishersSnapshot(publishers);
  }

  public setMicEnabled(enabled: boolean): void {
    this.micEnabled = enabled;
    this.localCameraStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
    this.publishStateOverWs();
  }

  public setCamEnabled(enabled: boolean): void {
    this.camEnabled = enabled;
    this.localCameraStream?.getVideoTracks().forEach((t) => {
      t.enabled = enabled;
    });
    this.publishStateOverWs();
  }

  public async flipCamera(): Promise<boolean> {
    if (!this.localCameraStream) return false;
    const nextFacing = this.currentFacingMode === "user" ? "environment" : "user";
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: nextFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      const newTrack = nextStream.getVideoTracks()[0];
      if (!newTrack) return false;

      newTrack.enabled = this.camEnabled;
      const oldTracks = this.localCameraStream.getVideoTracks();
      oldTracks.forEach((t) => {
        this.localCameraStream?.removeTrack(t);
        try {
          t.stop();
        } catch (_) {}
      });
      this.localCameraStream.addTrack(newTrack);
      this.currentFacingMode = nextFacing;

      if (!this.screenVideoTrack) {
        await this.replaceAllOutboundVideoTracks(newTrack);
      }
      this.emitLocalPreviewStream();
      return true;
    } catch {
      return false;
    }
  }

  public async setScreenShareTrack(track: MediaStreamTrack | null): Promise<void> {
    this.screenVideoTrack = track;
    const targetTrack = this.getOutboundVideoTrack();
    await this.replaceAllOutboundVideoTracks(targetTrack);
    this.emitLocalPreviewStream();
    this.publishStateOverWs();
  }

  private async replaceAllOutboundVideoTracks(track: MediaStreamTrack | null): Promise<void> {
    const ops: Promise<void>[] = [];
    for (const entry of this.outboundPeers.values()) {
      if (entry.videoSender) {
        ops.push(entry.videoSender.replaceTrack(track).catch(() => {}));
      } else if (track) {
        try {
          entry.videoSender = entry.pc.addTrack(track, new MediaStream([track]));
        } catch (_) {}
      }
    }
    await Promise.all(ops);
  }

  public setViewerQuality(quality: StreamQualitySetting): void {
    this.viewerQuality = quality;
    const pref = qualityToPref(quality);
    if (this.lastPublishers.A?.publishing && this.mySlot !== "A") {
      this.wsClient.subscribeStream("A", pref);
    }
    if (this.lastPublishers.B?.publishing && this.mySlot !== "B") {
      this.wsClient.subscribeStream("B", pref);
    }
  }

  private requestSlotSubscribe(slot: "A" | "B") {
    const now = Date.now();
    const lastReq = this.subscribeCooldown.get(slot) || 0;
    if (now - lastReq < 1200) return;
    this.subscribeCooldown.set(slot, now);
    this.callbacks.onSlotStatus?.(slot, "connecting");
    this.wsClient.subscribeStream(slot, qualityToPref(this.viewerQuality));
  }

  public handlePublishersSnapshot(publishers: RoomPublishersState): void {
    this.lastPublishers = publishers;
    if (this.disposed) return;

    const slots: Array<"A" | "B"> = ["A", "B"];
    for (const slot of slots) {
      if (this.mySlot === slot) continue;

      const pub = publishers[slot];
      const existing = this.inboundPeers.get(slot);

      if (!pub || !pub.publishing) {
        if (existing) {
          try {
            existing.pc.close();
          } catch (_) {}
          this.inboundPeers.delete(slot);
        }
        this.callbacks.onSlotStream?.(slot, null);
        this.callbacks.onSlotStatus?.(slot, "offline");
        continue;
      }

      if (existing && existing.publisherConnId !== pub.connId) {
        try {
          existing.pc.close();
        } catch (_) {}
        this.inboundPeers.delete(slot);
      }

      const current = this.inboundPeers.get(slot);
      if (!current) {
        this.requestSlotSubscribe(slot);
      } else if (
        current.pc.connectionState === "failed" ||
        current.pc.connectionState === "closed"
      ) {
        try {
          current.pc.close();
        } catch (_) {}
        this.inboundPeers.delete(slot);
        this.requestSlotSubscribe(slot);
      }
    }
  }

  public handleSfuProducersUpdate(): void {}

  public handleRtcViewerJoin(evt: {
    viewerConnId: string;
    viewerUid: string;
    viewerRole: RoomRole;
    targetSlot: "A" | "B";
    preferredQuality: "high" | "medium" | "low";
  }): void {
    if (!this.isPublishing || !this.mySlot || evt.targetSlot !== this.mySlot) return;
    if (evt.viewerConnId === this.wsClient.getConnectionId()) return;

    if (
      !this.outboundPeers.has(evt.viewerConnId) &&
      this.outboundPeers.size >= this.maxDirectPeers
    ) {
      return;
    }

    const prev = this.outboundPeers.get(evt.viewerConnId);
    if (prev) {
      try {
        prev.pc.close();
      } catch (_) {}
      this.outboundPeers.delete(evt.viewerConnId);
    }

    void this.createOutboundPeerOffer(
      evt.viewerConnId,
      evt.preferredQuality,
      evt.viewerRole === "spectator" || evt.viewerRole === "judge" || evt.viewerRole === "admin"
    );
  }

  public handleRtcViewerLeave(evt: { viewerConnId: string }): void {
    const entry = this.outboundPeers.get(evt.viewerConnId);
    if (entry) {
      try {
        entry.pc.close();
      } catch (_) {}
      this.outboundPeers.delete(evt.viewerConnId);
    }
  }

  public handlePeerDisconnected(evt: { connId: string }): void {
    this.handleRtcViewerLeave({ viewerConnId: evt.connId });
    for (const [slot, entry] of this.inboundPeers.entries()) {
      if (entry.publisherConnId === evt.connId) {
        try {
          entry.pc.close();
        } catch (_) {}
        this.inboundPeers.delete(slot);
        this.callbacks.onSlotStream?.(slot, null);
        this.callbacks.onSlotStatus?.(slot, "offline");
      }
    }
  }

  private async createOutboundPeerOffer(
    targetConnId: string,
    preferredQuality: "high" | "medium" | "low",
    isViewer: boolean
  ) {
    if (!this.mySlot || this.disposed) return;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry = {
      pc,
      isViewer,
      targetConnId,
      preferredQuality,
      pendingIce: [] as RTCIceCandidateInit[],
      remoteSet: false,
      videoSender: null as RTCRtpSender | null,
      audioSender: null as RTCRtpSender | null,
    };
    this.outboundPeers.set(targetConnId, entry);

    const stream = new MediaStream();
    const audioTrack = this.getOutboundAudioTrack();
    const videoTrack = this.getOutboundVideoTrack();

    if (audioTrack) {
      stream.addTrack(audioTrack);
      entry.audioSender = pc.addTrack(audioTrack, stream);
    } else {
      const aTrans = pc.addTransceiver("audio", { direction: "sendonly" });
      entry.audioSender = aTrans.sender;
    }

    if (videoTrack) {
      stream.addTrack(videoTrack);
      entry.videoSender = pc.addTrack(videoTrack, stream);
      try {
        const params = entry.videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = qualityToMaxBitrate(preferredQuality);
        await entry.videoSender.setParameters(params).catch(() => {});
      } catch (_) {}
    } else {
      const vTrans = pc.addTransceiver("video", { direction: "sendonly" });
      entry.videoSender = vTrans.sender;
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.wsClient.sendRtcSignal({
          toConnId: targetConnId,
          targetSlot: this.mySlot,
          signalType: "ice",
          direction: "out",
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        pc.restartIce?.();
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.wsClient.sendRtcSignal({
        toConnId: targetConnId,
        targetSlot: this.mySlot,
        signalType: "offer",
        direction: "out",
        payload: { sdp: offer.sdp, type: offer.type },
      });
    } catch (err) {
      console.warn("[BattleMedia] Offer error:", err);
      try {
        pc.close();
      } catch (_) {}
      if (this.outboundPeers.get(targetConnId)?.pc === pc) {
        this.outboundPeers.delete(targetConnId);
      }
    }
  }

  public handleRtcSignal(evt: {
    fromConnId: string;
    fromUid: string;
    fromSlot?: "A" | "B";
    targetSlot?: "A" | "B";
    signalType: "offer" | "answer" | "ice" | "renegotiate";
    direction?: "out" | "in";
    payload: any;
  }): void {
    if (this.disposed) return;

    if (evt.signalType === "answer") {
      const out = this.outboundPeers.get(evt.fromConnId);
      if (!out || !evt.payload?.sdp) return;
      void out.pc
        .setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: evt.payload.sdp }))
        .then(() => {
          out.remoteSet = true;
          const queued = out.pendingIce.splice(0);
          queued.forEach((c) => out.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
        })
        .catch(() => {});
      return;
    }

    if (evt.signalType === "ice") {
      const candidateInit = evt.payload as RTCIceCandidateInit;
      if (!candidateInit?.candidate) return;

      const slot = evt.targetSlot || evt.fromSlot;
      if (evt.direction === "out") {
        if (slot) {
          const inbound = this.inboundPeers.get(slot);
          if (inbound && inbound.publisherConnId === evt.fromConnId) {
            if (inbound.remoteSet) {
              inbound.pc.addIceCandidate(new RTCIceCandidate(candidateInit)).catch(() => {});
            } else {
              inbound.pendingIce.push(candidateInit);
            }
          }
        }
        return;
      }

      if (evt.direction === "in") {
        const out = this.outboundPeers.get(evt.fromConnId);
        if (out) {
          if (out.remoteSet) {
            out.pc.addIceCandidate(new RTCIceCandidate(candidateInit)).catch(() => {});
          } else {
            out.pendingIce.push(candidateInit);
          }
        }
        return;
      }

      // Direction-agnostic fallback
      if (slot && slot !== this.mySlot) {
        const inbound = this.inboundPeers.get(slot);
        if (inbound && inbound.publisherConnId === evt.fromConnId) {
          if (inbound.remoteSet) {
            inbound.pc.addIceCandidate(new RTCIceCandidate(candidateInit)).catch(() => {});
          } else {
            inbound.pendingIce.push(candidateInit);
          }
          return;
        }
      }
      const out = this.outboundPeers.get(evt.fromConnId);
      if (out) {
        if (out.remoteSet) {
          out.pc.addIceCandidate(new RTCIceCandidate(candidateInit)).catch(() => {});
        } else {
          out.pendingIce.push(candidateInit);
        }
      }
      return;
    }

    if (evt.signalType === "offer" && evt.payload?.sdp) {
      const slot = evt.targetSlot || evt.fromSlot;
      if (!slot || slot === this.mySlot) return;
      void this.acceptInboundOffer(slot, evt.fromConnId, evt.payload.sdp);
    }
  }

  private async acceptInboundOffer(slot: "A" | "B", publisherConnId: string, offerSdp: string) {
    const prev = this.inboundPeers.get(slot);
    if (prev) {
      try {
        prev.pc.close();
      } catch (_) {}
      this.inboundPeers.delete(slot);
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const stream = new MediaStream();
    const inbound = {
      pc,
      publisherConnId,
      stream,
      pendingIce: [] as RTCIceCandidateInit[],
      remoteSet: false,
      subscribedAtMs: Date.now(),
    };
    this.inboundPeers.set(slot, inbound);

    pc.ontrack = (event) => {
      const track = event.track;
      if (!stream.getTracks().some((t) => t.id === track.id)) {
        stream.addTrack(track);
      }
      this.callbacks.onSlotStream?.(slot, new MediaStream(stream.getTracks()));
      this.callbacks.onSlotStatus?.(slot, "live");
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.wsClient.sendRtcSignal({
          toConnId: publisherConnId,
          targetSlot: slot,
          signalType: "ice",
          direction: "in",
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        this.callbacks.onSlotStatus?.(slot, "live");
      } else if (pc.connectionState === "disconnected") {
        this.callbacks.onSlotStatus?.(slot, "buffering");
      } else if (pc.connectionState === "failed") {
        this.callbacks.onSlotStatus?.(slot, "reconnecting");
        if (this.lastPublishers[slot]?.publishing) {
          setTimeout(() => {
            if (!this.disposed && this.lastPublishers[slot]?.publishing) {
              this.wsClient.subscribeStream(slot, qualityToPref(this.viewerQuality));
            }
          }, 1200);
        }
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: offerSdp }));
      inbound.remoteSet = true;
      const queued = inbound.pendingIce.splice(0);
      queued.forEach((c) => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.wsClient.sendRtcSignal({
        toConnId: publisherConnId,
        targetSlot: slot,
        signalType: "answer",
        direction: "in",
        payload: { sdp: answer.sdp, type: answer.type },
      });
    } catch (err) {
      console.warn(`[BattleMedia] Accept offer failed for slot ${slot}:`, err);
      this.callbacks.onSlotStatus?.(slot, "reconnecting");
    }
  }

  private startStatsLoop() {
    this.stopStatsLoop();
    this.statsTimer = setInterval(async () => {
      if (this.disposed) return;

      // Measure real inbound video resolution & fps per remote slot
      for (const [slot, entry] of this.inboundPeers.entries()) {
        try {
          const stats = await entry.pc.getStats();
          stats.forEach((report: any) => {
            if (
              report.type === "inbound-rtp" &&
              report.kind === "video" &&
              report.frameWidth > 0 &&
              report.frameHeight > 0
            ) {
              this.callbacks.onSlotMetrics?.(slot, {
                width: Number(report.frameWidth),
                height: Number(report.frameHeight),
                fps: report.framesPerSecond ? Math.round(report.framesPerSecond) : undefined,
              });
            }
          });
        } catch (_) {}
      }

      const firstEntry =
        this.outboundPeers.values().next().value ||
        this.inboundPeers.values().next().value;
      if (!firstEntry) return;
      try {
        const stats = await firstEntry.pc.getStats();
        let rttMs = 0;
        let packetsLost = 0;
        stats.forEach((report: any) => {
          if (report.type === "candidate-pair" && report.state === "succeeded" && report.currentRoundTripTime) {
            rttMs = report.currentRoundTripTime * 1000;
          }
          if (report.type === "remote-inbound-rtp" && typeof report.packetsLost === "number") {
            packetsLost += report.packetsLost;
          }
        });
        let q: BattleNetworkQuality = "good";
        if (rttMs > 0 && rttMs < 130 && packetsLost < 10) q = "excellent";
        else if (rttMs > 320 || packetsLost > 40) q = "poor";
        if (q !== this.networkQuality) {
          this.networkQuality = q;
          this.callbacks.onNetworkQuality?.(q);
          this.publishStateOverWs();
        }
      } catch (_) {}
    }, 3500);
  }

  private stopStatsLoop() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  public async cleanup(): Promise<void> {
    this.disposed = true;
    await this.stopStageMedia();
    for (const [slot, entry] of this.inboundPeers) {
      try {
        entry.pc.close();
      } catch (_) {}
      this.inboundPeers.delete(slot);
    }
  }
}

/**
 * Self-Hosted mediasoup SFU Media Controller
 * Activated automatically when server verifies mediasoup worker binary & UDP host config (`mode === "mediasoup_sfu"`).
 */
class MediasoupSfuMediaController implements BattleMediaController {
  public readonly mode = "mediasoup_sfu" as const;

  private disposed = false;
  private device: Device | null = null;
  private sendTransport: mediasoupTypes.Transport | null = null;
  private recvTransport: mediasoupTypes.Transport | null = null;
  private audioProducer: mediasoupTypes.Producer | null = null;
  private videoProducer: mediasoupTypes.Producer | null = null;
  private consumersByProducer = new Map<
    string,
    { consumer: mediasoupTypes.Consumer; slot: "A" | "B"; track: MediaStreamTrack }
  >();
  private slotStreams: Record<"A" | "B", MediaStream> = {
    A: new MediaStream(),
    B: new MediaStream(),
  };

  private localCameraStream: MediaStream | null = null;
  private screenVideoTrack: MediaStreamTrack | null = null;
  private currentFacingMode: "user" | "environment" = "user";
  private micEnabled = true;
  private camEnabled = true;
  private isPublishing = false;
  private viewerQuality: StreamQualitySetting = "auto";
  private knownProducers: SfuProducerSummary[] = [];

  constructor(
    private readonly config: BattleMediaConfig,
    private readonly mySlot: "A" | "B" | undefined,
    private readonly wsClient: BattleRealtimeClient,
    private readonly callbacks: BattleMediaCallbacks
  ) {}

  private async ensureDeviceAndRecvTransport() {
    if (this.device && this.device.loaded && this.recvTransport) return;

    const rtpCapabilities = await this.wsClient.sfuRequest<mediasoupTypes.RtpCapabilities>(
      "getRouterRtpCapabilities"
    );
    const device = new Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });
    this.device = device;

    const params = await this.wsClient.sfuRequest<any>("createTransport", { direction: "recv" });
    const recvTransport = device.createRecvTransport({
      ...params,
      iceServers: this.config.iceServers,
    });

    recvTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
      this.wsClient
        .sfuRequest("connectTransport", {
          transportId: recvTransport.id,
          dtlsParameters,
        })
        .then(() => callback())
        .catch(errback);
    });

    recvTransport.on("connectionstatechange", (state) => {
      if (state === "failed") {
        if (this.mySlot !== "A") this.callbacks.onSlotStatus?.("A", "reconnecting");
        if (this.mySlot !== "B") this.callbacks.onSlotStatus?.("B", "reconnecting");
      }
    });

    this.recvTransport = recvTransport;
  }

  private async ensureSendTransport() {
    await this.ensureDeviceAndRecvTransport();
    if (this.sendTransport) return;
    if (!this.device) throw new Error("SFU device unavailable");

    const params = await this.wsClient.sfuRequest<any>("createTransport", { direction: "send" });
    const sendTransport = this.device.createSendTransport({
      ...params,
      iceServers: this.config.iceServers,
    });

    sendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
      this.wsClient
        .sfuRequest("connectTransport", {
          transportId: sendTransport.id,
          dtlsParameters,
        })
        .then(() => callback())
        .catch(errback);
    });

    sendTransport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
      this.wsClient
        .sfuRequest<{ id: string }>("produce", {
          transportId: sendTransport.id,
          kind,
          rtpParameters,
          source: appData?.source || (kind === "audio" ? "mic" : "camera"),
        })
        .then(({ id }) => callback({ id }))
        .catch(errback);
    });

    this.sendTransport = sendTransport;
  }

  private emitLocalPreviewStream() {
    const tracks: MediaStreamTrack[] = [];
    const vTrack =
      (this.screenVideoTrack && this.screenVideoTrack.readyState === "live"
        ? this.screenVideoTrack
        : this.localCameraStream?.getVideoTracks()[0]) || null;
    const aTrack = this.localCameraStream?.getAudioTracks()[0] || null;
    if (vTrack) tracks.push(vTrack);
    if (aTrack) tracks.push(aTrack);
    this.callbacks.onLocalStream?.(tracks.length > 0 ? new MediaStream(tracks) : null);
  }

  public async startStageMedia(audioOnlyFallback = false): Promise<{ ok: boolean; camActive: boolean }> {
    if (!this.mySlot || this.disposed) return { ok: false, camActive: false };

    let acquiredStream: MediaStream | null = null;
    let camActive = false;
    if (!audioOnlyFallback) {
      const videoRes = await mobilePermissionService.acquireCallMediaStream({ video: true, audio: true });
      if (videoRes.success && videoRes.stream) {
        acquiredStream = videoRes.stream;
        camActive = videoRes.stream.getVideoTracks().length > 0;
        this.callbacks.onLocalMediaError?.("none");
      } else {
        const audioRes = await mobilePermissionService.acquireCallMediaStream({ video: false, audio: true });
        if (audioRes.success && audioRes.stream) {
          acquiredStream = audioRes.stream;
          this.callbacks.onLocalMediaError?.("camera-denied-audio-only", videoRes.error);
        } else {
          this.callbacks.onLocalMediaError?.(classifyMediaError(videoRes.error || audioRes.error), videoRes.error);
          return { ok: false, camActive: false };
        }
      }
    } else {
      const audioRes = await mobilePermissionService.acquireCallMediaStream({ video: false, audio: true });
      if (audioRes.success && audioRes.stream) {
        acquiredStream = audioRes.stream;
        this.callbacks.onLocalMediaError?.("none");
      } else {
        this.callbacks.onLocalMediaError?.(classifyMediaError(audioRes.error), audioRes.error);
        return { ok: false, camActive: false };
      }
    }

    this.localCameraStream = acquiredStream;
    this.camEnabled = camActive;
    this.micEnabled = acquiredStream.getAudioTracks().length > 0;
    this.isPublishing = true;
    this.emitLocalPreviewStream();

    await this.ensureSendTransport();
    if (!this.sendTransport) return { ok: false, camActive: false };

    const aTrack = acquiredStream.getAudioTracks()[0];
    if (aTrack) {
      this.audioProducer = await this.sendTransport.produce({
        track: aTrack,
        appData: { source: "mic" },
      });
    }

    const vTrack = acquiredStream.getVideoTracks()[0];
    if (vTrack) {
      this.videoProducer = await this.sendTransport.produce({
        track: vTrack,
        encodings: [
          { rid: "r0", maxBitrate: 350_000, scalabilityMode: "S1T3" },
          { rid: "r1", maxBitrate: 900_000, scalabilityMode: "S1T3" },
          { rid: "r2", maxBitrate: 2_200_000, scalabilityMode: "S1T3" },
        ],
        codecOptions: { videoGoogleStartBitrate: 1000 },
        appData: { source: "camera" },
      });
    }

    this.wsClient.updatePublisherState({
      publishing: true,
      micActive: this.micEnabled,
      camActive: this.camEnabled,
      screenSharing: Boolean(this.screenVideoTrack),
      networkQuality: "good",
    });

    this.syncConsumers();
    return { ok: true, camActive };
  }

  public async stopStageMedia(): Promise<void> {
    this.isPublishing = false;
    try {
      this.audioProducer?.close();
    } catch (_) {}
    try {
      this.videoProducer?.close();
    } catch (_) {}
    this.audioProducer = null;
    this.videoProducer = null;
    try {
      this.sendTransport?.close();
    } catch (_) {}
    this.sendTransport = null;

    this.localCameraStream?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch (_) {}
    });
    this.localCameraStream = null;
    mobilePermissionService.releaseActiveStream();
    this.callbacks.onLocalStream?.(null);
    this.wsClient.updatePublisherState({ publishing: false });
  }

  public async subscribeAsViewer(): Promise<void> {
    await this.ensureDeviceAndRecvTransport();
    this.syncConsumers();
  }

  public onRealtimeReconnected(): void {
    this.syncConsumers();
  }

  public handleSfuProducersUpdate(producers: SfuProducerSummary[]): void {
    this.knownProducers = producers;
    this.syncConsumers();
  }

  private async syncConsumers() {
    if (this.disposed) return;
    try {
      await this.ensureDeviceAndRecvTransport();
    } catch {
      return;
    }
    if (!this.device || !this.recvTransport) return;

    const myConnId = this.wsClient.getConnectionId();
    const activeIds = new Set(this.knownProducers.map((p) => p.producerId));

    // Close removed producers
    for (const [prodId, entry] of this.consumersByProducer.entries()) {
      if (!activeIds.has(prodId)) {
        try {
          entry.consumer.close();
        } catch (_) {}
        this.slotStreams[entry.slot].removeTrack(entry.track);
        this.consumersByProducer.delete(prodId);
        const tracks = this.slotStreams[entry.slot].getTracks();
        this.callbacks.onSlotStream?.(
          entry.slot,
          tracks.length > 0 ? new MediaStream(tracks) : null
        );
        if (tracks.length === 0) {
          this.callbacks.onSlotStatus?.(entry.slot, "offline");
        }
      }
    }

    for (const prod of this.knownProducers) {
      if (prod.connId === myConnId || prod.slot === this.mySlot) continue;
      if (this.consumersByProducer.has(prod.producerId)) continue;

      this.callbacks.onSlotStatus?.(prod.slot, "connecting");
      try {
        const res = await this.wsClient.sfuRequest<{
          id: string;
          producerId: string;
          kind: "audio" | "video";
          rtpParameters: any;
        }>("consume", {
          transportId: this.recvTransport.id,
          producerId: prod.producerId,
          rtpCapabilities: this.device.rtpCapabilities,
        });

        const consumer = await this.recvTransport.consume({
          id: res.id,
          producerId: res.producerId,
          kind: res.kind,
          rtpParameters: res.rtpParameters,
        });

        await this.wsClient.sfuRequest("resumeConsumer", { consumerId: consumer.id });
        const track = consumer.track;
        this.consumersByProducer.set(prod.producerId, { consumer, slot: prod.slot, track });
        this.slotStreams[prod.slot].addTrack(track);
        this.callbacks.onSlotStream?.(prod.slot, new MediaStream(this.slotStreams[prod.slot].getTracks()));
        this.callbacks.onSlotStatus?.(prod.slot, "live");
      } catch (err) {
        console.warn("[MediasoupSFU] consume error:", err);
      }
    }
  }

  public setMicEnabled(enabled: boolean): void {
    this.micEnabled = enabled;
    this.localCameraStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
    if (enabled) this.audioProducer?.resume();
    else this.audioProducer?.pause();
    this.wsClient.updatePublisherState({ publishing: this.isPublishing, micActive: enabled });
  }

  public setCamEnabled(enabled: boolean): void {
    this.camEnabled = enabled;
    this.localCameraStream?.getVideoTracks().forEach((t) => {
      t.enabled = enabled;
    });
    if (enabled) this.videoProducer?.resume();
    else this.videoProducer?.pause();
    this.wsClient.updatePublisherState({ publishing: this.isPublishing, camActive: enabled });
  }

  public async flipCamera(): Promise<boolean> {
    if (!this.localCameraStream) return false;
    const nextFacing = this.currentFacingMode === "user" ? "environment" : "user";
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const newTrack = nextStream.getVideoTracks()[0];
      if (!newTrack) return false;
      newTrack.enabled = this.camEnabled;
      this.localCameraStream.getVideoTracks().forEach((t) => {
        this.localCameraStream?.removeTrack(t);
        try {
          t.stop();
        } catch (_) {}
      });
      this.localCameraStream.addTrack(newTrack);
      this.currentFacingMode = nextFacing;
      if (!this.screenVideoTrack && this.videoProducer) {
        await this.videoProducer.replaceTrack({ track: newTrack });
      }
      this.emitLocalPreviewStream();
      return true;
    } catch {
      return false;
    }
  }

  public async setScreenShareTrack(track: MediaStreamTrack | null): Promise<void> {
    this.screenVideoTrack = track;
    const nextTrack =
      track || this.localCameraStream?.getVideoTracks()[0] || null;
    if (nextTrack && this.videoProducer) {
      await this.videoProducer.replaceTrack({ track: nextTrack }).catch(() => {});
    }
    this.emitLocalPreviewStream();
    this.wsClient.updatePublisherState({ publishing: this.isPublishing, screenSharing: Boolean(track) });
  }

  public setViewerQuality(quality: StreamQualitySetting): void {
    this.viewerQuality = quality;
    const spatialLayer = quality === "480p" ? 0 : quality === "720p" ? 1 : 2;
    this.consumersByProducer.forEach(({ consumer }) => {
      if (consumer.kind === "video") {
        void this.wsClient
          .sfuRequest("setPreferredLayers", {
            consumerId: consumer.id,
            spatialLayer,
            temporalLayer: 2,
          })
          .catch(() => {});
      }
    });
  }

  public handlePublishersSnapshot(): void {}
  public handleRtcViewerJoin(): void {}
  public handleRtcViewerLeave(): void {}
  public handleRtcSignal(): void {}
  public handlePeerDisconnected(): void {}

  public async cleanup(): Promise<void> {
    this.disposed = true;
    await this.stopStageMedia();
    this.consumersByProducer.forEach(({ consumer }) => {
      try {
        consumer.close();
      } catch (_) {}
    });
    this.consumersByProducer.clear();
    try {
      this.recvTransport?.close();
    } catch (_) {}
    this.recvTransport = null;
  }
}

export async function createBattleMediaController(params: {
  battleId: string;
  role: RoomRole;
  mySlot?: "A" | "B";
  displayName: string;
  wsClient: BattleRealtimeClient;
  callbacks: BattleMediaCallbacks;
}): Promise<BattleMediaController> {
  const config = await fetchBattleMediaConfig(params.battleId, params.role, params.displayName);
  params.callbacks.onModeResolved?.(config);

  if (config.mode === "mediasoup_sfu") {
    return new MediasoupSfuMediaController(config, params.mySlot, params.wsClient, params.callbacks);
  }

  return new WsWebRtcMediaController(
    params.role,
    params.mySlot,
    config.iceServers,
    config.maxDirectPeers || 25,
    params.wsClient,
    params.callbacks
  );
}
