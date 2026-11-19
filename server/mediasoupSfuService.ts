import fs from "fs";
import path from "path";

export interface MediasoupCapabilityInfo {
  engine: "mediasoup";
  workerBinaryPresent: boolean;
  announcedIpConfigured: boolean;
  externalSfuUrl: string;
  ready: boolean;
  reason?: string;
}

export interface SfuProducerInfo {
  producerId: string;
  connId: string;
  uid: string;
  slot: "A" | "B";
  kind: "audio" | "video";
  source: "camera" | "microphone" | "screen";
}

interface PeerSfuState {
  transports: Map<string, any>;
  producers: Map<string, any>;
  consumers: Map<string, any>;
}

interface RoomSfuState {
  router: any;
  peers: Map<string, PeerSfuState>;
  producersMeta: Map<string, SfuProducerInfo>;
}

let workerInstance: any = null;
let workerInitPromise: Promise<any | null> | null = null;
const sfuRooms = new Map<string, RoomSfuState>();

const MEDIA_CODECS = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 900,
    },
  },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
    },
  },
];

function resolveWorkerBinaryPath(): string {
  if (process.env.MEDIASOUP_WORKER_BIN) {
    return process.env.MEDIASOUP_WORKER_BIN;
  }
  return path.join(
    process.cwd(),
    "node_modules",
    "mediasoup",
    "worker",
    "out",
    "Release",
    "mediasoup-worker"
  );
}

export function getMediasoupCapabilityInfo(): MediasoupCapabilityInfo {
  const externalSfuUrl = (process.env.MEDIASOUP_SFU_URL || "").trim();
  const announcedIp = (process.env.MEDIASOUP_ANNOUNCED_IP || "").trim();
  const explicitEnable = process.env.MEDIASOUP_ENABLED === "true";
  const workerBinaryPath = resolveWorkerBinaryPath();
  const workerBinaryPresent = fs.existsSync(workerBinaryPath);

  if (externalSfuUrl) {
    return {
      engine: "mediasoup",
      workerBinaryPresent,
      announcedIpConfigured: Boolean(announcedIp),
      externalSfuUrl,
      ready: true,
    };
  }

  if (!workerBinaryPresent) {
    return {
      engine: "mediasoup",
      workerBinaryPresent: false,
      announcedIpConfigured: Boolean(announcedIp),
      externalSfuUrl: "",
      ready: false,
      reason: "mediasoup-worker native binary not present in container",
    };
  }

  if (!announcedIp && !explicitEnable) {
    return {
      engine: "mediasoup",
      workerBinaryPresent: true,
      announcedIpConfigured: false,
      externalSfuUrl: "",
      ready: false,
      reason: "MEDIASOUP_ANNOUNCED_IP not set (single-port PaaS container)",
    };
  }

  return {
    engine: "mediasoup",
    workerBinaryPresent: true,
    announcedIpConfigured: Boolean(announcedIp),
    externalSfuUrl: "",
    ready: true,
  };
}

async function ensureWorker(): Promise<any | null> {
  const cap = getMediasoupCapabilityInfo();
  if (!cap.ready || cap.externalSfuUrl) return null;
  if (workerInstance && !workerInstance.closed) return workerInstance;
  if (workerInitPromise) return workerInitPromise;

  workerInitPromise = (async () => {
    try {
      const mediasoup: any = await import("mediasoup");
      const minPort = Number(process.env.MEDIASOUP_MIN_PORT || 40000);
      const maxPort = Number(process.env.MEDIASOUP_MAX_PORT || 40100);
      const worker = await mediasoup.createWorker({
        logLevel: "warn",
        rtcMinPort: minPort,
        rtcMaxPort: maxPort,
      });
      worker.on("died", () => {
        console.error("[mediasoup] Worker exited unexpectedly; resetting state.");
        workerInstance = null;
        sfuRooms.clear();
      });
      workerInstance = worker;
      return worker;
    } catch (err: any) {
      console.warn("[mediasoup] Worker initialization skipped:", err?.message || err);
      return null;
    } finally {
      workerInitPromise = null;
    }
  })();

  return workerInitPromise;
}

async function ensureRoom(battleId: string): Promise<RoomSfuState | null> {
  const existing = sfuRooms.get(battleId);
  if (existing) return existing;

  const worker = await ensureWorker();
  if (!worker) return null;

  const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
  const state: RoomSfuState = {
    router,
    peers: new Map(),
    producersMeta: new Map(),
  };
  sfuRooms.set(battleId, state);
  return state;
}

function getOrCreatePeer(room: RoomSfuState, connId: string): PeerSfuState {
  let peer = room.peers.get(connId);
  if (!peer) {
    peer = {
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    room.peers.set(connId, peer);
  }
  return peer;
}

export const mediasoupSfuService = {
  getCapabilityInfo: getMediasoupCapabilityInfo,

  async getRouterRtpCapabilities(battleId: string): Promise<any | null> {
    const room = await ensureRoom(battleId);
    return room ? room.router.rtpCapabilities : null;
  },

  listProducers(battleId: string): SfuProducerInfo[] {
    const room = sfuRooms.get(battleId);
    if (!room) return [];
    return Array.from(room.producersMeta.values());
  },

  async createWebRtcTransport(
    battleId: string,
    connId: string,
    direction: "send" | "recv"
  ): Promise<any> {
    const room = await ensureRoom(battleId);
    if (!room) throw new Error("mediasoup SFU worker is unavailable");

    const listenIp = process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0";
    const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1";

    const transport = await room.router.createWebRtcTransport({
      listenInfos: [
        { protocol: "udp", ip: listenIp, announcedAddress: announcedIp },
        { protocol: "tcp", ip: listenIp, announcedAddress: announcedIp },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1_200_000,
      appData: { connId, direction },
    });

    const peer = getOrCreatePeer(room, connId);
    peer.transports.set(transport.id, transport);

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    };
  },

  async connectWebRtcTransport(
    battleId: string,
    connId: string,
    transportId: string,
    dtlsParameters: any
  ): Promise<void> {
    const room = sfuRooms.get(battleId);
    const peer = room?.peers.get(connId);
    const transport = peer?.transports.get(transportId);
    if (!transport) throw new Error("Transport not found");
    await transport.connect({ dtlsParameters });
  },

  async produce(params: {
    battleId: string;
    connId: string;
    uid: string;
    slot: "A" | "B";
    transportId: string;
    kind: "audio" | "video";
    rtpParameters: any;
    source?: "camera" | "microphone" | "screen";
  }): Promise<{ producerId: string; producers: SfuProducerInfo[] }> {
    const room = sfuRooms.get(params.battleId);
    const peer = room?.peers.get(params.connId);
    const transport = peer?.transports.get(params.transportId);
    if (!room || !peer || !transport) throw new Error("Send transport not found");

    const source =
      params.source || (params.kind === "audio" ? "microphone" : "camera");
    const producer = await transport.produce({
      kind: params.kind,
      rtpParameters: params.rtpParameters,
      appData: {
        connId: params.connId,
        uid: params.uid,
        slot: params.slot,
        source,
      },
    });

    const info: SfuProducerInfo = {
      producerId: producer.id,
      connId: params.connId,
      uid: params.uid,
      slot: params.slot,
      kind: params.kind,
      source,
    };

    peer.producers.set(producer.id, producer);
    room.producersMeta.set(producer.id, info);

    producer.on("transportclose", () => {
      peer.producers.delete(producer.id);
      room.producersMeta.delete(producer.id);
    });

    return {
      producerId: producer.id,
      producers: Array.from(room.producersMeta.values()),
    };
  },

  async closeProducer(
    battleId: string,
    connId: string,
    producerId: string
  ): Promise<SfuProducerInfo[]> {
    const room = sfuRooms.get(battleId);
    if (!room) return [];
    const peer = room.peers.get(connId);
    const producer = peer?.producers.get(producerId);
    if (producer) {
      try {
        producer.close();
      } catch (_) {}
      peer?.producers.delete(producerId);
    }
    room.producersMeta.delete(producerId);
    return Array.from(room.producersMeta.values());
  },

  async consume(params: {
    battleId: string;
    viewerConnId: string;
    transportId: string;
    producerId: string;
    rtpCapabilities: any;
  }): Promise<any> {
    const room = sfuRooms.get(params.battleId);
    if (!room) throw new Error("Battle SFU room not found");
    const peer = room.peers.get(params.viewerConnId);
    const transport = peer?.transports.get(params.transportId);
    if (!peer || !transport) throw new Error("Receive transport not found");

    if (
      !room.router.canConsume({
        producerId: params.producerId,
        rtpCapabilities: params.rtpCapabilities,
      })
    ) {
      throw new Error("Client RTP capabilities cannot consume producer");
    }

    const consumer = await transport.consume({
      producerId: params.producerId,
      rtpCapabilities: params.rtpCapabilities,
      paused: true,
    });

    peer.consumers.set(consumer.id, consumer);
    consumer.on("transportclose", () => peer.consumers.delete(consumer.id));
    consumer.on("producerclose", () => peer.consumers.delete(consumer.id));

    const meta = room.producersMeta.get(params.producerId);

    return {
      id: consumer.id,
      producerId: params.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
      slot: meta?.slot,
      source: meta?.source,
    };
  },

  async resumeConsumer(
    battleId: string,
    connId: string,
    consumerId: string
  ): Promise<void> {
    const room = sfuRooms.get(battleId);
    const consumer = room?.peers.get(connId)?.consumers.get(consumerId);
    if (consumer) {
      await consumer.resume();
    }
  },

  async setPreferredLayers(
    battleId: string,
    connId: string,
    consumerId: string,
    spatialLayer: number,
    temporalLayer?: number
  ): Promise<void> {
    const room = sfuRooms.get(battleId);
    const consumer = room?.peers.get(connId)?.consumers.get(consumerId);
    if (consumer && consumer.kind === "video") {
      await consumer.setPreferredLayers({
        spatialLayer,
        temporalLayer: temporalLayer ?? 2,
      });
    }
  },

  closePeer(battleId: string, connId: string): { removedProducerIds: string[]; remainingProducers: SfuProducerInfo[] } {
    const room = sfuRooms.get(battleId);
    if (!room) return { removedProducerIds: [], remainingProducers: [] };

    const peer = room.peers.get(connId);
    const removedProducerIds: string[] = [];

    if (peer) {
      for (const [pid, producer] of peer.producers) {
        removedProducerIds.push(pid);
        room.producersMeta.delete(pid);
        try {
          producer.close();
        } catch (_) {}
      }
      for (const consumer of peer.consumers.values()) {
        try {
          consumer.close();
        } catch (_) {}
      }
      for (const transport of peer.transports.values()) {
        try {
          transport.close();
        } catch (_) {}
      }
      room.peers.delete(connId);
    }

    const remainingProducers = Array.from(room.producersMeta.values());
    if (room.peers.size === 0) {
      try {
        room.router.close();
      } catch (_) {}
      sfuRooms.delete(battleId);
    }

    return { removedProducerIds, remainingProducers };
  },
};
