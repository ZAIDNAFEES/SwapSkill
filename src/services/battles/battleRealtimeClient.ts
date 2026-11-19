import { auth } from "../../firebase";
import { getApiBaseUrl } from "../../utils/apiConfig";
import {
  BattleComment,
  BattleCommentReplyRef,
  BattleJudgeSummary,
  BattleNetworkQuality,
  BattleRoundState,
} from "../../types/battle";

export type RoomRole = "competitorA" | "competitorB" | "judge" | "admin" | "spectator";
export type WsConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

export interface PublisherInfo {
  connId: string;
  uid: string;
  slot: "A" | "B";
  publishing: boolean;
  micActive: boolean;
  camActive: boolean;
  screenSharing: boolean;
  networkQuality: BattleNetworkQuality;
  updatedAtMs: number;
}

export interface RoomPublishersState {
  A: PublisherInfo | null;
  B: PublisherInfo | null;
}

export interface SfuProducerSummary {
  producerId: string;
  connId: string;
  uid: string;
  slot: "A" | "B";
  kind: "audio" | "video";
  source: "camera" | "mic" | "screen";
}

export interface ApplauseBurstEvent {
  uid: string;
  name: string;
  emoji: string;
  atMs: number;
}

export interface BattleRealtimeHandlers {
  onConnectionState?: (state: WsConnectionState) => void;
  onSnapshot?: (snapshot: {
    connId: string;
    uid: string;
    role: RoomRole;
    slot?: "A" | "B";
    viewerCount: number;
    publishers: RoomPublishersState;
    sfuEnabled: boolean;
    sfuProducers: SfuProducerSummary[];
    roundState: BattleRoundState;
    votesSummary: { audienceVotesA: number; audienceVotesB: number };
    chatHistory: BattleComment[];
    mutedUntilMs: number;
    isReconnect: boolean;
  }) => void;
  onViewerCount?: (count: number) => void;
  onPublishersUpdate?: (publishers: RoomPublishersState) => void;
  onSfuProducersUpdate?: (producers: SfuProducerSummary[]) => void;
  onVoteUpdate?: (votes: { audienceVotesA: number; audienceVotesB: number }) => void;
  onJudgesUpdate?: (judges: BattleJudgeSummary[]) => void;
  onChatMessage?: (msg: BattleComment) => void;
  onChatAck?: (clientMsgId: string, msg: BattleComment) => void;
  onChatError?: (clientMsgId: string | undefined, error: string) => void;
  onChatReactionUpdate?: (messageId: string, reactions: Record<string, string[]>) => void;
  onChatDeleted?: (messageId: string) => void;
  onUserMuted?: (targetUid: string, untilMs: number) => void;
  onApplauseBurst?: (evt: ApplauseBurstEvent) => void;
  onStageEvent?: (evt: any) => void;
  onRtcViewerJoin?: (evt: {
    viewerConnId: string;
    viewerUid: string;
    viewerRole: RoomRole;
    targetSlot: "A" | "B";
    preferredQuality: "high" | "medium" | "low";
  }) => void;
  onRtcViewerLeave?: (evt: { viewerConnId: string; targetSlot: "A" | "B" }) => void;
  onRtcSignal?: (evt: {
    fromConnId: string;
    fromUid: string;
    fromSlot?: "A" | "B";
    targetSlot?: "A" | "B";
    signalType: "offer" | "answer" | "ice" | "renegotiate";
    direction?: "out" | "in";
    payload: any;
  }) => void;
  onRtcPublisherUnavailable?: (evt: { targetSlot: "A" | "B" }) => void;
  onPeerDisconnected?: (evt: { connId: string; uid: string; slot?: "A" | "B" }) => void;
}

export function resolveBattleWsUrl(): string {
  const apiBase = getApiBaseUrl();
  if (apiBase) {
    const wsBase = apiBase.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
    return `${wsBase}/ws/battles`;
  }
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/battles`;
  }
  return "ws://127.0.0.1:3000/ws/battles";
}

export class BattleRealtimeClient {
  private ws: WebSocket | null = null;
  private disposed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connId: string | null = null;
  private isAuthenticated = false;
  private hasConnectedOnce = false;
  private forceTokenRefreshNext = false;
  private pendingQueue: Array<Record<string, any>> = [];
  private sfuPending = new Map<
    string,
    { resolve: (data: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private sfuSeq = 0;

  constructor(
    private readonly params: {
      battleId: string;
      displayName: string;
      photoUrl?: string;
      roleHint: RoomRole;
      slot?: "A" | "B";
      getToken?: (forceRefresh?: boolean) => Promise<string>;
    },
    private readonly handlers: BattleRealtimeHandlers
  ) {}

  public getConnectionId(): string | null {
    return this.connId;
  }

  public isReady(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN && this.isAuthenticated);
  }

  private async resolveAuthToken(forceRefresh = false): Promise<string> {
    if (this.params.getToken) {
      return (await this.params.getToken(forceRefresh).catch(() => "")) || "";
    }
    const user = auth.currentUser;
    if (!user) return "";
    return (await user.getIdToken(forceRefresh).catch(() => "")) || "";
  }

  public async connect(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.isReady()) return true;

    this.handlers.onConnectionState?.(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    const forceRefresh = this.forceTokenRefreshNext;
    this.forceTokenRefreshNext = false;
    let token = await this.resolveAuthToken(forceRefresh);
    if (!token && !forceRefresh) {
      token = await this.resolveAuthToken(true);
    }

    if (this.disposed) return false;

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close(1000, "Replacing connection");
      } catch (_) {}
      this.ws = null;
    }

    const url = resolveBattleWsUrl();
    const ws = new WebSocket(url);
    this.ws = ws;
    this.isAuthenticated = false;

    return await new Promise<boolean>((resolveAuth) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(handshakeTimeout);
        resolveAuth(ok);
      };

      const handshakeTimeout = setTimeout(() => {
        if (!settled) {
          settle(false);
        }
      }, 8500);

      ws.onopen = () => {
        if (this.disposed || this.ws !== ws) {
          settle(false);
          return;
        }
        this.reconnectAttempt = 0;
        this.sendRaw({
          type: "auth",
          token,
          battleId: this.params.battleId,
          displayName: this.params.displayName,
          photoUrl: this.params.photoUrl || "",
          roleHint: this.params.roleHint,
          slot: this.params.slot,
        });
        this.startHeartbeat();
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        let data: any;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!data || typeof data.type !== "string") return;

        switch (data.type) {
          case "room_snapshot": {
            const isReconnect = this.hasConnectedOnce;
            this.hasConnectedOnce = true;
            this.connId = data.connId;
            this.isAuthenticated = true;
            this.handlers.onConnectionState?.("connected");
            this.handlers.onSnapshot?.({
              connId: data.connId,
              uid: data.uid,
              role: data.role,
              slot: data.slot,
              viewerCount: data.viewerCount ?? 1,
              publishers: data.publishers || { A: null, B: null },
              sfuEnabled: Boolean(data.sfuEnabled),
              sfuProducers: Array.isArray(data.sfuProducers) ? data.sfuProducers : [],
              roundState: data.roundState || { index: 1, total: 1, title: "Live Arena" },
              votesSummary: data.votesSummary || { audienceVotesA: 0, audienceVotesB: 0 },
              chatHistory: Array.isArray(data.chatHistory) ? data.chatHistory : [],
              mutedUntilMs: Number(data.mutedUntilMs || 0),
              isReconnect,
            });
            this.flushPendingQueue();
            settle(true);
            break;
          }
          case "error": {
            if (data.code === "UNAUTHORIZED" || data.code === "AUTH_TIMEOUT" || data.code === "AUTH_ERROR") {
              this.forceTokenRefreshNext = true;
              settle(false);
            }
            if (data.clientMsgId) {
              this.handlers.onChatError?.(data.clientMsgId, data.message || "Authentication pending — retrying");
            }
            break;
          }
          case "sfu_response": {
            const reqId = String(data.reqId || "");
            const entry = this.sfuPending.get(reqId);
            if (entry) {
              clearTimeout(entry.timer);
              this.sfuPending.delete(reqId);
              if (data.ok) entry.resolve(data.data);
              else entry.reject(new Error(data.error || "SFU request failed"));
            }
            break;
          }
          case "sfu_producers_update":
            this.handlers.onSfuProducersUpdate?.(Array.isArray(data.producers) ? data.producers : []);
            break;
          case "viewer_count_update":
            this.handlers.onViewerCount?.(Number(data.viewerCount || 0));
            break;
          case "publishers_update":
            this.handlers.onPublishersUpdate?.(data.publishers || { A: null, B: null });
            break;
          case "vote_update":
            this.handlers.onVoteUpdate?.({
              audienceVotesA: Number(data.audienceVotesA || 0),
              audienceVotesB: Number(data.audienceVotesB || 0),
            });
            break;
          case "judges_update":
            this.handlers.onJudgesUpdate?.(Array.isArray(data.judges) ? data.judges : []);
            break;
          case "chat_message":
            if (data.msg) this.handlers.onChatMessage?.(data.msg);
            break;
          case "chat_ack":
            if (data.clientMsgId && data.msg) {
              this.handlers.onChatAck?.(data.clientMsgId, data.msg);
            }
            break;
          case "chat_error":
            this.handlers.onChatError?.(data.clientMsgId, data.message || "Could not send message");
            break;
          case "chat_reaction_update":
            if (data.messageId) {
              this.handlers.onChatReactionUpdate?.(data.messageId, data.reactions || {});
            }
            break;
          case "chat_deleted":
            if (data.messageId) this.handlers.onChatDeleted?.(data.messageId);
            break;
          case "user_muted":
            if (data.targetUid) this.handlers.onUserMuted?.(data.targetUid, Number(data.untilMs || 0));
            break;
          case "applause_burst":
            this.handlers.onApplauseBurst?.({
              uid: data.uid,
              name: data.name,
              emoji: data.emoji,
              atMs: data.atMs,
            });
            break;
          case "stage_event":
            this.handlers.onStageEvent?.(data);
            break;
          case "rtc_viewer_join":
            this.handlers.onRtcViewerJoin?.(data);
            break;
          case "rtc_viewer_leave":
            this.handlers.onRtcViewerLeave?.(data);
            break;
          case "rtc_signal":
            this.handlers.onRtcSignal?.(data);
            break;
          case "rtc_publisher_unavailable":
            this.handlers.onRtcPublisherUnavailable?.({ targetSlot: data.targetSlot });
            break;
          case "peer_disconnected":
            this.handlers.onPeerDisconnected?.(data);
            break;
        }
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.stopHeartbeat();
        this.isAuthenticated = false;
        this.connId = null;
        this.rejectAllPendingSfu("Realtime connection closed");
        settle(false);
        if (this.disposed) {
          this.handlers.onConnectionState?.("disconnected");
          return;
        }
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        // Handled cleanly by onclose
      };
    });
  }

  private rejectAllPendingSfu(reason: string) {
    for (const [reqId, entry] of this.sfuPending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.sfuPending.delete(reqId);
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return;
    this.handlers.onConnectionState?.("reconnecting");
    const delay = Math.min(8000, 750 * Math.pow(1.6, this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendRaw({ type: "ping", t: Date.now() });
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendRaw(payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private enqueueOrSend(payload: Record<string, any>): boolean {
    if (this.isReady()) {
      return this.sendRaw(payload);
    }
    if (this.disposed) return false;

    // Deduplicate idempotent state updates in queue
    if (payload.type === "publisher_state") {
      this.pendingQueue = this.pendingQueue.filter((p) => p.type !== "publisher_state");
    } else if (payload.type === "rtc_subscribe" || payload.type === "rtc_unsubscribe") {
      this.pendingQueue = this.pendingQueue.filter(
        (p) =>
          !(
            (p.type === "rtc_subscribe" || p.type === "rtc_unsubscribe") &&
            p.targetSlot === payload.targetSlot
          )
      );
    }

    if (this.pendingQueue.length >= 60) {
      this.pendingQueue.shift();
    }
    this.pendingQueue.push(payload);
    return true;
  }

  private flushPendingQueue() {
    if (!this.isReady() || this.pendingQueue.length === 0) return;
    const queued = this.pendingQueue.splice(0);
    for (const item of queued) {
      this.sendRaw(item);
    }
  }

  public sfuRequest<T = any>(action: string, payload: Record<string, any> = {}, timeoutMs = 9000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.isReady()) {
        reject(new Error("Realtime room not ready for SFU signaling"));
        return;
      }
      const reqId = `sfu_${++this.sfuSeq}_${Date.now()}`;
      const timer = setTimeout(() => {
        this.sfuPending.delete(reqId);
        reject(new Error(`SFU action "${action}" timed out`));
      }, timeoutMs);

      this.sfuPending.set(reqId, { resolve, reject, timer });
      const ok = this.sendRaw({ type: "sfu_request", reqId, action, ...payload });
      if (!ok) {
        clearTimeout(timer);
        this.sfuPending.delete(reqId);
        reject(new Error("Failed to transmit SFU request"));
      }
    });
  }

  public updatePublisherState(state: {
    publishing: boolean;
    micActive?: boolean;
    camActive?: boolean;
    screenSharing?: boolean;
    networkQuality?: BattleNetworkQuality;
  }): boolean {
    return this.enqueueOrSend({ type: "publisher_state", ...state });
  }

  public subscribeStream(targetSlot: "A" | "B", preferredQuality: "high" | "medium" | "low" = "high"): boolean {
    return this.enqueueOrSend({ type: "rtc_subscribe", targetSlot, preferredQuality });
  }

  public unsubscribeStream(targetSlot: "A" | "B"): boolean {
    return this.enqueueOrSend({ type: "rtc_unsubscribe", targetSlot });
  }

  public sendRtcSignal(params: {
    toConnId: string;
    targetSlot?: "A" | "B";
    signalType: "offer" | "answer" | "ice" | "renegotiate";
    direction?: "out" | "in";
    payload: any;
  }): boolean {
    if (!this.isReady()) return false;
    return this.sendRaw({ type: "rtc_signal", ...params });
  }

  public sendChat(text: string, clientMsgId: string, replyTo?: BattleCommentReplyRef): boolean {
    return this.enqueueOrSend({ type: "chat_send", text, clientMsgId, replyTo });
  }

  public reactToChat(messageId: string, emoji: string): boolean {
    return this.enqueueOrSend({ type: "chat_react", messageId, emoji });
  }

  public deleteChat(messageId: string): boolean {
    return this.enqueueOrSend({ type: "chat_delete", messageId });
  }

  public muteUser(targetUid: string, durationMs = 300_000): boolean {
    return this.enqueueOrSend({ type: "moderate_mute", targetUid, durationMs });
  }

  public sendApplause(emoji = "🔥"): boolean {
    return this.enqueueOrSend({ type: "applause_burst", emoji });
  }

  public syncVotes(audienceVotesA: number, audienceVotesB: number): boolean {
    return this.enqueueOrSend({ type: "vote_sync", audienceVotesA, audienceVotesB });
  }

  public sendStageEvent(
    event: "countdown_start" | "round_change" | "deliverable_sync",
    data: Record<string, any> = {}
  ): boolean {
    return this.enqueueOrSend({ type: "stage_event", event, ...data });
  }

  public disconnect(): void {
    this.disposed = true;
    this.pendingQueue = [];
    this.rejectAllPendingSfu("Disconnected");
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close(1000, "Leaving arena");
      } catch (_) {}
      this.ws = null;
    }
    this.handlers.onConnectionState?.("disconnected");
  }
}
