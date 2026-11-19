import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { mediasoupSfuService, SfuProducerInfo } from "./mediasoupSfuService.js";

export type RoomRole = "competitorA" | "competitorB" | "judge" | "admin" | "spectator";
export type NetworkQuality = "excellent" | "good" | "poor" | "unknown";

export interface PublisherSnapshot {
  connId: string;
  uid: string;
  slot: "A" | "B";
  publishing: boolean;
  micActive: boolean;
  camActive: boolean;
  screenSharing: boolean;
  networkQuality: NetworkQuality;
  updatedAtMs: number;
}

export interface RoomChatMessage {
  id: string;
  clientMsgId?: string;
  battleId: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  authorRole: "competitor" | "judge" | "spectator" | "admin";
  text: string;
  replyTo?: {
    id: string;
    authorName: string;
    text: string;
  };
  reactions: Record<string, string[]>;
  deleted?: boolean;
  createdAtMs: number;
}

export interface RoomRoundState {
  index: number;
  total: number;
  title: string;
  durationSecs?: number;
  startedAtMs?: number;
  countdownTargetMs?: number;
}

export interface RoomVotesSummary {
  audienceVotesA: number;
  audienceVotesB: number;
}

interface RoomConnection {
  connId: string;
  ws: WebSocket;
  battleId: string;
  uid: string;
  email?: string;
  displayName: string;
  photoUrl: string;
  role: RoomRole;
  slot?: "A" | "B";
  joinedAtMs: number;
  lastPongAtMs: number;
  msgTimestamps: number[];
  applauseTimestamps: number[];
}

interface BattleRoom {
  battleId: string;
  connections: Map<string, RoomConnection>;
  publishers: {
    A: PublisherSnapshot | null;
    B: PublisherSnapshot | null;
  };
  chatMessages: RoomChatMessage[];
  seenClientMsgIds: Map<string, RoomChatMessage>;
  mutedUids: Map<string, number>;
  roundState: RoomRoundState;
  votesSummary: RoomVotesSummary;
  lastViewerSyncAtMs: number;
  lastSyncedViewerCount: number;
  hydratedFromDb: boolean;
}

export interface BattleRealtimeDeps {
  verifyTokenString: (token: string) => Promise<{ uid: string; email?: string; emailVerified?: boolean } | null>;
  getAdminDb: () => Firestore | null;
  isAdminEmail: (email?: string) => boolean;
}

export interface BattleRealtimeBridge {
  getChatHistory: (battleId: string) => RoomChatMessage[];
  postChatMessageFromHttp: (params: {
    battleId: string;
    uid: string;
    email?: string;
    displayName: string;
    photoUrl?: string;
    roleHint?: string;
    text: string;
    clientMsgId?: string;
    replyTo?: { id: string; authorName: string; text: string };
  }) => Promise<{ ok: true; msg: RoomChatMessage } | { ok: false; status: number; error: string }>;
  broadcastVoteUpdate: (battleId: string, audienceVotesA: number, audienceVotesB: number) => void;
  broadcastJudgesUpdate: (battleId: string, judges: any[]) => void;
}

const ALLOWED_REACTION_EMOJIS = new Set(["🔥", "👏", "❤️", "👍", "😂", "⚡", "🏆"]);
const MAX_CHAT_HISTORY = 200;
const HEARTBEAT_INTERVAL_MS = 15000;
const CONNECTION_STALE_MS = 45000;

export function attachBattleRealtimeServer(
  server: HttpServer,
  deps: BattleRealtimeDeps
): BattleRealtimeBridge {
  const wss = new WebSocketServer({ server, path: "/ws/battles" });
  const rooms = new Map<string, BattleRoom>();

  function getOrCreateRoom(battleId: string): BattleRoom {
    let room = rooms.get(battleId);
    if (!room) {
      room = {
        battleId,
        connections: new Map(),
        publishers: { A: null, B: null },
        chatMessages: [],
        seenClientMsgIds: new Map(),
        mutedUids: new Map(),
        roundState: { index: 1, total: 1, title: "Main Arena Round" },
        votesSummary: { audienceVotesA: 0, audienceVotesB: 0 },
        lastViewerSyncAtMs: 0,
        lastSyncedViewerCount: -1,
        hydratedFromDb: false,
      };
      rooms.set(battleId, room);
    }
    return room;
  }

  function sendJson(ws: WebSocket, payload: unknown) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch (_) {}
    }
  }

  function broadcastRoom(room: BattleRoom, payload: unknown, excludeConnId?: string) {
    const serialized = JSON.stringify(payload);
    for (const [cid, conn] of room.connections) {
      if (excludeConnId && cid === excludeConnId) continue;
      if (conn.ws.readyState === WebSocket.OPEN) {
        try {
          conn.ws.send(serialized);
        } catch (_) {}
      }
    }
  }

  function computeUniqueViewerCount(room: BattleRoom): number {
    const uids = new Set<string>();
    for (const conn of room.connections.values()) {
      if (conn.uid) uids.add(conn.uid);
    }
    return uids.size;
  }

  function broadcastPresence(room: BattleRoom) {
    const viewerCount = computeUniqueViewerCount(room);
    broadcastRoom(room, {
      type: "viewer_count_update",
      battleId: room.battleId,
      viewerCount,
      timestampMs: Date.now(),
    });

    const now = Date.now();
    if (
      viewerCount !== room.lastSyncedViewerCount &&
      now - room.lastViewerSyncAtMs >= 8000
    ) {
      room.lastSyncedViewerCount = viewerCount;
      room.lastViewerSyncAtMs = now;
      const adminDb = deps.getAdminDb();
      if (adminDb) {
        adminDb
          .collection("battles")
          .doc(room.battleId)
          .update({ viewerCount, updatedAtMs: now })
          .catch(() => {});
      }
    }
  }

  function broadcastPublishers(room: BattleRoom) {
    broadcastRoom(room, {
      type: "publishers_update",
      battleId: room.battleId,
      publishers: room.publishers,
      timestampMs: Date.now(),
    });
  }

  function broadcastSfuProducers(room: BattleRoom, producers: SfuProducerInfo[]) {
    broadcastRoom(room, {
      type: "sfu_producers_update",
      battleId: room.battleId,
      producers,
      timestampMs: Date.now(),
    });
  }

  async function hydrateChatHistoryFromDb(room: BattleRoom): Promise<void> {
    if (room.hydratedFromDb || room.chatMessages.length > 0) return;
    room.hydratedFromDb = true;
    const adminDb = deps.getAdminDb();
    if (!adminDb) return;
    try {
      const snap = await Promise.race([
        adminDb
          .collection("battleComments")
          .where("battleId", "==", room.battleId)
          .limit(60)
          .get(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
      ]);
      if (!snap || snap.empty) return;
      const fetched = snap.docs
        .map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            battleId: room.battleId,
            authorId: data.authorId || "",
            authorName: data.authorName || "Member",
            authorPhoto: data.authorPhoto || "",
            authorRole: data.authorRole || "spectator",
            text: data.text || "",
            ...(data.replyTo ? { replyTo: data.replyTo } : {}),
            reactions: data.reactions || {},
            deleted: Boolean(data.deleted),
            createdAtMs: Number(data.createdAtMs || 0),
          } as RoomChatMessage;
        })
        .sort((a, b) => a.createdAtMs - b.createdAtMs);
      const existingIds = new Set(room.chatMessages.map((m) => m.id));
      for (const m of fetched) {
        if (!existingIds.has(m.id)) {
          room.chatMessages.push(m);
        }
      }
      room.chatMessages.sort((a, b) => a.createdAtMs - b.createdAtMs);
      if (room.chatMessages.length > MAX_CHAT_HISTORY) {
        room.chatMessages.splice(0, room.chatMessages.length - MAX_CHAT_HISTORY);
      }
    } catch (_) {
      // Starter Tier IAM may forbid Admin SDK Firestore reads cleanly
    }
  }

  async function resolveVerifiedRole(
    battleId: string,
    uid: string,
    email: string | undefined,
    roleHint?: string,
    slotHint?: string
  ): Promise<{ role: RoomRole; slot?: "A" | "B"; votesSummary?: RoomVotesSummary }> {
    const isAdmin = deps.isAdminEmail(email);
    const adminDb = deps.getAdminDb();

    if (adminDb) {
      try {
        const snap = await Promise.race([
          adminDb.collection("battles").doc(battleId).get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
        ]);
        if (snap && snap.exists) {
          const b = snap.data() as any;
          const votesSummary: RoomVotesSummary = {
            audienceVotesA: Number(b?.audienceVotesA || 0),
            audienceVotesB: Number(b?.audienceVotesB || 0),
          };
          if (b?.creatorId === uid) return { role: "competitorA", slot: "A", votesSummary };
          if (b?.opponentId === uid) return { role: "competitorB", slot: "B", votesSummary };
          if (Array.isArray(b?.judgeIds) && b.judgeIds.includes(uid)) {
            return { role: "judge", votesSummary };
          }
          if (isAdmin) return { role: "admin", votesSummary };
          return { role: "spectator", votesSummary };
        }
      } catch (_) {
        // Starter Tier fallback
      }
    }

    if (roleHint === "competitorA" && slotHint === "A") {
      return { role: "competitorA", slot: "A" };
    }
    if (roleHint === "competitorB" && slotHint === "B") {
      return { role: "competitorB", slot: "B" };
    }
    if (roleHint === "judge") {
      return { role: "judge" };
    }
    if (roleHint === "admin" && isAdmin) {
      return { role: "admin" };
    }
    if (isAdmin) {
      return { role: "admin" };
    }
    return { role: "spectator" };
  }

  function recordAndBroadcastChatMessage(params: {
    room: BattleRoom;
    uid: string;
    displayName: string;
    photoUrl: string;
    authorRole: RoomChatMessage["authorRole"];
    text: string;
    clientMsgId?: string;
    replyTo?: { id: string; authorName: string; text: string };
  }): RoomChatMessage {
    const { room, uid, displayName, photoUrl, authorRole, text, clientMsgId, replyTo } = params;
    const now = Date.now();
    const cleanMsgId = clientMsgId ? clientMsgId.slice(0, 64) : undefined;
    if (cleanMsgId && room.seenClientMsgIds.has(cleanMsgId)) {
      return room.seenClientMsgIds.get(cleanMsgId)!;
    }

    const chatMsg: RoomChatMessage = {
      id: randomUUID(),
      clientMsgId: cleanMsgId,
      battleId: room.battleId,
      authorId: uid,
      authorName: displayName,
      authorPhoto: photoUrl,
      authorRole,
      text,
      ...(replyTo ? { replyTo } : {}),
      reactions: {},
      createdAtMs: now,
    };

    room.chatMessages.push(chatMsg);
    if (room.chatMessages.length > MAX_CHAT_HISTORY) {
      room.chatMessages.shift();
    }
    if (cleanMsgId) {
      room.seenClientMsgIds.set(cleanMsgId, chatMsg);
      if (room.seenClientMsgIds.size > 500) {
        const firstKey = room.seenClientMsgIds.keys().next().value;
        if (firstKey) room.seenClientMsgIds.delete(firstKey);
      }
    }

    broadcastRoom(room, { type: "chat_message", battleId: room.battleId, msg: chatMsg });

    const adminDb = deps.getAdminDb();
    if (adminDb) {
      adminDb
        .collection("battleComments")
        .doc(chatMsg.id)
        .set({
          id: chatMsg.id,
          battleId: chatMsg.battleId,
          authorId: chatMsg.authorId,
          authorName: chatMsg.authorName,
          authorPhoto: chatMsg.authorPhoto || "",
          authorRole: chatMsg.authorRole,
          text: chatMsg.text,
          ...(chatMsg.replyTo ? { replyTo: chatMsg.replyTo } : {}),
          createdAtMs: chatMsg.createdAtMs,
        })
        .catch(() => {});
    }

    return chatMsg;
  }

  function cleanupConnection(conn: RoomConnection | null) {
    if (!conn) return;
    const room = rooms.get(conn.battleId);
    if (!room) return;

    room.connections.delete(conn.connId);

    const sfuClose = mediasoupSfuService.closePeer(room.battleId, conn.connId);
    if (sfuClose.removedProducerIds.length > 0) {
      broadcastSfuProducers(room, sfuClose.remainingProducers);
    }

    let publisherChanged = false;
    if (room.publishers.A?.connId === conn.connId) {
      room.publishers.A = null;
      publisherChanged = true;
    }
    if (room.publishers.B?.connId === conn.connId) {
      room.publishers.B = null;
      publisherChanged = true;
    }

    broadcastRoom(room, {
      type: "peer_disconnected",
      battleId: room.battleId,
      connId: conn.connId,
      uid: conn.uid,
      slot: conn.slot,
    });

    if (publisherChanged) {
      broadcastPublishers(room);
    }

    if (room.connections.size === 0) {
      // Retain chatMessages for 5 minutes if room briefly empties so reconnect keeps history
      setTimeout(() => {
        const check = rooms.get(conn.battleId);
        if (check && check.connections.size === 0) {
          rooms.delete(conn.battleId);
        }
      }, 300_000);
    } else {
      broadcastPresence(room);
    }
  }

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let activeConn: RoomConnection | null = null;
    let isAuthing = false;

    const authTimeout = setTimeout(() => {
      if (!activeConn && ws.readyState === WebSocket.OPEN) {
        sendJson(ws, { type: "error", code: "AUTH_TIMEOUT", message: "Authentication timed out" });
        ws.close(4001, "Authentication timeout");
      }
    }, 9000);

    async function completeAuth(params: {
      token: string;
      battleId: string;
      displayName?: string;
      photoUrl?: string;
      roleHint?: string;
      slot?: string;
    }) {
      if (activeConn || isAuthing) return;
      isAuthing = true;

      try {
        const cleanBattleId = String(params.battleId || "").trim().slice(0, 128);
        if (!cleanBattleId || !/^[a-zA-Z0-9_-]+$/.test(cleanBattleId)) {
          sendJson(ws, { type: "error", code: "INVALID_BATTLE", message: "Invalid battleId" });
          ws.close(4002, "Invalid battleId");
          return;
        }

        const verified = await deps.verifyTokenString(params.token);
        if (!verified?.uid) {
          sendJson(ws, { type: "error", code: "UNAUTHORIZED", message: "Invalid or expired Firebase ID token" });
          ws.close(4001, "Unauthorized");
          return;
        }

        const resolvedRole = await resolveVerifiedRole(
          cleanBattleId,
          verified.uid,
          verified.email,
          params.roleHint,
          params.slot
        );

        const room = getOrCreateRoom(cleanBattleId);
        if (resolvedRole.votesSummary) {
          room.votesSummary = {
            audienceVotesA: Math.max(room.votesSummary.audienceVotesA, resolvedRole.votesSummary.audienceVotesA),
            audienceVotesB: Math.max(room.votesSummary.audienceVotesB, resolvedRole.votesSummary.audienceVotesB),
          };
        }
        await hydrateChatHistoryFromDb(room);

        const connId = randomUUID();
        const conn: RoomConnection = {
          connId,
          ws,
          battleId: cleanBattleId,
          uid: verified.uid,
          email: verified.email,
          displayName: String(params.displayName || "SwapSkill Member").trim().slice(0, 80),
          photoUrl: String(params.photoUrl || "").trim().slice(0, 500),
          role: resolvedRole.role,
          slot: resolvedRole.slot,
          joinedAtMs: Date.now(),
          lastPongAtMs: Date.now(),
          msgTimestamps: [],
          applauseTimestamps: [],
        };

        activeConn = conn;
        clearTimeout(authTimeout);
        room.connections.set(connId, conn);

        const viewerCount = computeUniqueViewerCount(room);
        const sfuCap = mediasoupSfuService.getCapabilityInfo();

        sendJson(ws, {
          type: "room_snapshot",
          battleId: cleanBattleId,
          connId,
          uid: verified.uid,
          role: conn.role,
          slot: conn.slot,
          viewerCount,
          publishers: room.publishers,
          sfuEnabled: sfuCap.ready,
          sfuProducers: sfuCap.ready ? mediasoupSfuService.listProducers(cleanBattleId) : [],
          roundState: room.roundState,
          votesSummary: room.votesSummary,
          chatHistory: room.chatMessages.filter((m) => !m.deleted).slice(-100),
          mutedUntilMs: room.mutedUids.get(verified.uid) || 0,
        });

        broadcastPresence(room);
      } catch (err: any) {
        sendJson(ws, { type: "error", code: "AUTH_ERROR", message: err?.message || "Auth error" });
        ws.close(4001, "Auth failure");
      } finally {
        isAuthing = false;
      }
    }

    try {
      const reqUrl = new URL(req.url || "/ws/battles", "http://localhost");
      const queryToken = reqUrl.searchParams.get("token");
      const queryBattleId = reqUrl.searchParams.get("battleId");
      if (queryToken && queryBattleId) {
        void completeAuth({
          token: queryToken,
          battleId: queryBattleId,
          displayName: reqUrl.searchParams.get("name") || undefined,
          photoUrl: reqUrl.searchParams.get("photo") || undefined,
          roleHint: reqUrl.searchParams.get("role") || undefined,
          slot: reqUrl.searchParams.get("slot") || undefined,
        });
      }
    } catch (_) {}

    ws.on("pong", () => {
      if (activeConn) activeConn.lastPongAtMs = Date.now();
    });

    ws.on("message", async (rawData) => {
      let msg: any;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "auth") {
        await completeAuth({
          token: String(msg.token || ""),
          battleId: String(msg.battleId || ""),
          displayName: msg.displayName,
          photoUrl: msg.photoUrl,
          roleHint: msg.roleHint,
          slot: msg.slot,
        });
        return;
      }

      if (!activeConn) {
        sendJson(ws, {
          type: "error",
          code: "UNAUTHENTICATED",
          message: "Authenticate first before sending room events.",
          clientMsgId: typeof msg.clientMsgId === "string" ? msg.clientMsgId : undefined,
        });
        return;
      }

      const conn = activeConn;
      conn.lastPongAtMs = Date.now();
      const room = rooms.get(conn.battleId);
      if (!room) return;

      switch (msg.type) {
        case "ping": {
          sendJson(ws, { type: "pong", t: Date.now() });
          break;
        }

        case "publisher_state": {
          if (!conn.slot) return;
          const publishing = Boolean(msg.publishing);
          if (!publishing) {
            if (room.publishers[conn.slot]?.connId === conn.connId) {
              room.publishers[conn.slot] = null;
              broadcastPublishers(room);
            }
            sendJson(ws, { type: "publisher_ack", slot: conn.slot, publishing: false });
            return;
          }
          const quality: NetworkQuality =
            msg.networkQuality === "excellent" ||
            msg.networkQuality === "good" ||
            msg.networkQuality === "poor"
              ? msg.networkQuality
              : "unknown";
          room.publishers[conn.slot] = {
            connId: conn.connId,
            uid: conn.uid,
            slot: conn.slot,
            publishing: true,
            micActive: msg.micActive !== false,
            camActive: msg.camActive !== false,
            screenSharing: Boolean(msg.screenSharing),
            networkQuality: quality,
            updatedAtMs: Date.now(),
          };
          sendJson(ws, { type: "publisher_ack", slot: conn.slot, publishing: true });
          broadcastPublishers(room);
          break;
        }

        case "rtc_subscribe": {
          const targetSlot = msg.targetSlot === "A" || msg.targetSlot === "B" ? msg.targetSlot : null;
          if (!targetSlot) return;
          const pub = room.publishers[targetSlot];
          if (!pub || !pub.publishing) {
            sendJson(ws, {
              type: "rtc_publisher_unavailable",
              battleId: room.battleId,
              targetSlot,
            });
            return;
          }
          const pubConn = room.connections.get(pub.connId);
          if (!pubConn) return;
          const preferredQuality =
            msg.preferredQuality === "low" || msg.preferredQuality === "medium" || msg.preferredQuality === "high"
              ? msg.preferredQuality
              : "high";

          sendJson(pubConn.ws, {
            type: "rtc_viewer_join",
            battleId: room.battleId,
            viewerConnId: conn.connId,
            viewerUid: conn.uid,
            viewerRole: conn.role,
            targetSlot,
            preferredQuality,
          });
          break;
        }

        case "rtc_unsubscribe": {
          const targetSlot = msg.targetSlot === "A" || msg.targetSlot === "B" ? msg.targetSlot : null;
          if (!targetSlot) return;
          const pub = room.publishers[targetSlot];
          if (!pub) return;
          const pubConn = room.connections.get(pub.connId);
          if (pubConn) {
            sendJson(pubConn.ws, {
              type: "rtc_viewer_leave",
              battleId: room.battleId,
              viewerConnId: conn.connId,
              targetSlot,
            });
          }
          break;
        }

        case "rtc_signal": {
          const toConnId = typeof msg.toConnId === "string" ? msg.toConnId : "";
          const targetConn = room.connections.get(toConnId);
          if (!targetConn) return;
          sendJson(targetConn.ws, {
            type: "rtc_signal",
            battleId: room.battleId,
            fromConnId: conn.connId,
            fromUid: conn.uid,
            fromSlot: conn.slot,
            targetSlot: msg.targetSlot,
            signalType: msg.signalType,
            direction: msg.direction,
            payload: msg.payload,
          });
          break;
        }

        case "sfu_request": {
          const reqId = String(msg.reqId || "");
          const action = String(msg.action || "");
          try {
            let result: any = null;
            if (action === "getRouterRtpCapabilities") {
              result = await mediasoupSfuService.getRouterRtpCapabilities(room.battleId);
            } else if (action === "createTransport") {
              result = await mediasoupSfuService.createWebRtcTransport(
                room.battleId,
                conn.connId,
                msg.direction === "send" ? "send" : "recv"
              );
            } else if (action === "connectTransport") {
              await mediasoupSfuService.connectWebRtcTransport(
                room.battleId,
                conn.connId,
                String(msg.transportId || ""),
                msg.dtlsParameters
              );
              result = { connected: true };
            } else if (action === "produce") {
              if (!conn.slot) throw new Error("Only assigned competitors can publish to SFU");
              const res = await mediasoupSfuService.produce({
                battleId: room.battleId,
                connId: conn.connId,
                uid: conn.uid,
                slot: conn.slot,
                transportId: String(msg.transportId || ""),
                kind: msg.kind === "audio" ? "audio" : "video",
                rtpParameters: msg.rtpParameters,
                source: msg.source,
              });
              result = { id: res.producerId };
              broadcastSfuProducers(room, res.producers);
            } else if (action === "closeProducer") {
              const producers = await mediasoupSfuService.closeProducer(
                room.battleId,
                conn.connId,
                String(msg.producerId || "")
              );
              result = { closed: true };
              broadcastSfuProducers(room, producers);
            } else if (action === "consume") {
              result = await mediasoupSfuService.consume({
                battleId: room.battleId,
                viewerConnId: conn.connId,
                transportId: String(msg.transportId || ""),
                producerId: String(msg.producerId || ""),
                rtpCapabilities: msg.rtpCapabilities,
              });
            } else if (action === "resumeConsumer") {
              await mediasoupSfuService.resumeConsumer(
                room.battleId,
                conn.connId,
                String(msg.consumerId || "")
              );
              result = { resumed: true };
            } else if (action === "setPreferredLayers") {
              await mediasoupSfuService.setPreferredLayers(
                room.battleId,
                conn.connId,
                String(msg.consumerId || ""),
                Number(msg.spatialLayer ?? 2),
                Number(msg.temporalLayer ?? 2)
              );
              result = { updated: true };
            } else {
              throw new Error(`Unknown SFU action: ${action}`);
            }

            sendJson(ws, { type: "sfu_response", reqId, ok: true, data: result });
          } catch (err: any) {
            sendJson(ws, {
              type: "sfu_response",
              reqId,
              ok: false,
              error: err?.message || "SFU operation failed",
            });
          }
          break;
        }

        case "chat_send": {
          const now = Date.now();
          const clientMsgId =
            typeof msg.clientMsgId === "string" ? msg.clientMsgId.slice(0, 64) : undefined;
          const mutedUntil = room.mutedUids.get(conn.uid) || 0;
          if (mutedUntil > now) {
            sendJson(ws, {
              type: "chat_error",
              clientMsgId,
              message: `You are temporarily muted for ${Math.ceil((mutedUntil - now) / 1000)}s.`,
            });
            return;
          }

          conn.msgTimestamps = conn.msgTimestamps.filter((ts) => now - ts < 10000);
          if (conn.msgTimestamps.length >= 10) {
            sendJson(ws, {
              type: "chat_error",
              clientMsgId,
              message: "Slow down slightly — rate limit reached.",
            });
            return;
          }

          const cleanText = String(msg.text || "").trim().slice(0, 400);
          if (!cleanText) {
            sendJson(ws, {
              type: "chat_error",
              clientMsgId,
              message: "Message cannot be empty.",
            });
            return;
          }

          const authorRole: RoomChatMessage["authorRole"] =
            conn.role === "competitorA" || conn.role === "competitorB"
              ? "competitor"
              : conn.role;

          let replyTo: RoomChatMessage["replyTo"];
          if (msg.replyTo && typeof msg.replyTo.id === "string") {
            replyTo = {
              id: String(msg.replyTo.id).slice(0, 80),
              authorName: String(msg.replyTo.authorName || "Member").slice(0, 60),
              text: String(msg.replyTo.text || "").slice(0, 140),
            };
          }

          conn.msgTimestamps.push(now);
          const chatMsg = recordAndBroadcastChatMessage({
            room,
            uid: conn.uid,
            displayName: conn.displayName,
            photoUrl: conn.photoUrl,
            authorRole,
            text: cleanText,
            clientMsgId,
            replyTo,
          });
          sendJson(ws, { type: "chat_ack", clientMsgId, msg: chatMsg });
          break;
        }

        case "chat_react": {
          const messageId = String(msg.messageId || "");
          const emoji = String(msg.emoji || "");
          if (!ALLOWED_REACTION_EMOJIS.has(emoji)) return;
          const target = room.chatMessages.find((m) => m.id === messageId && !m.deleted);
          if (!target) return;

          const current = new Set(target.reactions[emoji] || []);
          if (current.has(conn.uid)) current.delete(conn.uid);
          else current.add(conn.uid);

          if (current.size === 0) delete target.reactions[emoji];
          else target.reactions[emoji] = Array.from(current);

          broadcastRoom(room, {
            type: "chat_reaction_update",
            battleId: room.battleId,
            messageId: target.id,
            reactions: target.reactions,
          });
          break;
        }

        case "chat_delete": {
          const messageId = String(msg.messageId || "");
          const target = room.chatMessages.find((m) => m.id === messageId);
          if (!target) return;
          const isModerator =
            conn.role === "admin" ||
            conn.role === "judge" ||
            conn.role === "competitorA" ||
            conn.role === "competitorB";
          if (!isModerator && target.authorId !== conn.uid) return;
          target.deleted = true;
          broadcastRoom(room, {
            type: "chat_deleted",
            battleId: room.battleId,
            messageId: target.id,
          });
          break;
        }

        case "moderate_mute": {
          const isModerator =
            conn.role === "admin" ||
            conn.role === "judge" ||
            conn.role === "competitorA" ||
            conn.role === "competitorB";
          if (!isModerator) return;
          const targetUid = String(msg.targetUid || "").trim();
          if (!targetUid || targetUid === conn.uid) return;
          const durationMs = Math.min(3600_000, Math.max(30_000, Number(msg.durationMs) || 300_000));
          const untilMs = Date.now() + durationMs;
          room.mutedUids.set(targetUid, untilMs);
          broadcastRoom(room, {
            type: "user_muted",
            battleId: room.battleId,
            targetUid,
            untilMs,
          });
          break;
        }

        case "applause_burst": {
          const now = Date.now();
          conn.applauseTimestamps = conn.applauseTimestamps.filter((ts) => now - ts < 5000);
          if (conn.applauseTimestamps.length >= 16) return;
          conn.applauseTimestamps.push(now);
          const emoji = ALLOWED_REACTION_EMOJIS.has(String(msg.emoji)) ? String(msg.emoji) : "🔥";
          broadcastRoom(room, {
            type: "applause_burst",
            battleId: room.battleId,
            uid: conn.uid,
            name: conn.displayName,
            emoji,
            atMs: now,
          });
          break;
        }

        case "vote_sync": {
          const votesA = Number(msg.audienceVotesA);
          const votesB = Number(msg.audienceVotesB);
          if (Number.isFinite(votesA) && Number.isFinite(votesB) && votesA >= 0 && votesB >= 0) {
            room.votesSummary = {
              audienceVotesA: Math.max(room.votesSummary.audienceVotesA, votesA),
              audienceVotesB: Math.max(room.votesSummary.audienceVotesB, votesB),
            };
            broadcastRoom(room, {
              type: "vote_update",
              battleId: room.battleId,
              audienceVotesA: room.votesSummary.audienceVotesA,
              audienceVotesB: room.votesSummary.audienceVotesB,
            });
          }
          break;
        }

        case "stage_event": {
          const canControl =
            conn.role === "competitorA" ||
            conn.role === "competitorB" ||
            conn.role === "judge" ||
            conn.role === "admin";
          if (!canControl) return;

          if (msg.event === "countdown_start") {
            const targetStartAtMs = Date.now() + Math.min(5000, Math.max(2000, Number(msg.delayMs) || 3400));
            room.roundState.countdownTargetMs = targetStartAtMs;
            broadcastRoom(room, {
              type: "stage_event",
              battleId: room.battleId,
              event: "countdown_start",
              targetStartAtMs,
              byUid: conn.uid,
            });
          } else if (msg.event === "round_change") {
            room.roundState = {
              index: Math.max(1, Number(msg.index) || 1),
              total: Math.max(1, Number(msg.total) || 1),
              title: String(msg.title || "Live Round").slice(0, 60),
              durationSecs: Number(msg.durationSecs) || undefined,
              startedAtMs: Date.now(),
              countdownTargetMs: 0,
            };
            broadcastRoom(room, {
              type: "stage_event",
              battleId: room.battleId,
              event: "round_change",
              roundState: room.roundState,
              byUid: conn.uid,
            });
          } else if (msg.event === "deliverable_sync") {
            broadcastRoom(room, {
              type: "stage_event",
              battleId: room.battleId,
              event: "deliverable_sync",
              slot: conn.slot,
              uid: conn.uid,
              stageSummary: String(msg.stageSummary || "").slice(0, 300),
              submissionLink: String(msg.submissionLink || "").slice(0, 300),
            });
          }
          break;
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      cleanupConnection(activeConn);
      activeConn = null;
    });

    ws.on("error", () => {
      clearTimeout(authTimeout);
      cleanupConnection(activeConn);
      activeConn = null;
    });
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      for (const conn of room.connections.values()) {
        if (now - conn.lastPongAtMs > CONNECTION_STALE_MS) {
          try {
            conn.ws.terminate();
          } catch (_) {}
          cleanupConnection(conn);
          continue;
        }
        if (conn.ws.readyState === WebSocket.OPEN) {
          try {
            conn.ws.ping();
          } catch (_) {}
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  return {
    getChatHistory(battleId: string): RoomChatMessage[] {
      const room = rooms.get(battleId);
      if (!room) return [];
      return room.chatMessages.filter((m) => !m.deleted).slice(-100);
    },

    async postChatMessageFromHttp(params) {
      const cleanBattleId = String(params.battleId || "").trim().slice(0, 128);
      if (!cleanBattleId || !/^[a-zA-Z0-9_-]+$/.test(cleanBattleId)) {
        return { ok: false, status: 400, error: "Invalid battleId" };
      }
      const cleanText = String(params.text || "").trim().slice(0, 400);
      if (!cleanText) {
        return { ok: false, status: 400, error: "Message text cannot be empty." };
      }
      const room = getOrCreateRoom(cleanBattleId);
      const mutedUntil = room.mutedUids.get(params.uid) || 0;
      const now = Date.now();
      if (mutedUntil > now) {
        return {
          ok: false,
          status: 403,
          error: `You are temporarily muted for ${Math.ceil((mutedUntil - now) / 1000)}s.`,
        };
      }
      const resolved = await resolveVerifiedRole(
        cleanBattleId,
        params.uid,
        params.email,
        params.roleHint
      );
      const authorRole: RoomChatMessage["authorRole"] =
        resolved.role === "competitorA" || resolved.role === "competitorB"
          ? "competitor"
          : resolved.role;

      const msg = recordAndBroadcastChatMessage({
        room,
        uid: params.uid,
        displayName: String(params.displayName || "SwapSkill Member").trim().slice(0, 80),
        photoUrl: String(params.photoUrl || "").trim().slice(0, 500),
        authorRole,
        text: cleanText,
        clientMsgId: params.clientMsgId,
        replyTo: params.replyTo,
      });

      return { ok: true, msg };
    },

    broadcastVoteUpdate(battleId: string, audienceVotesA: number, audienceVotesB: number) {
      const room = rooms.get(battleId);
      if (!room) return;
      room.votesSummary = { audienceVotesA, audienceVotesB };
      broadcastRoom(room, {
        type: "vote_update",
        battleId,
        audienceVotesA,
        audienceVotesB,
      });
    },

    broadcastJudgesUpdate(battleId: string, judges: any[]) {
      const room = rooms.get(battleId);
      if (!room) return;
      broadcastRoom(room, {
        type: "judges_update",
        battleId,
        judges,
      });
    },
  };
}
