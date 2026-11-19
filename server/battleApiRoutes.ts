import type { Express, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { getResolvedIceServers } from "../api/webrtc/ice-servers.js";
import { mediasoupSfuService } from "./mediasoupSfuService.js";
import type { BattleRealtimeBridge } from "./battleRealtimeServer.js";

export interface BattleApiDeps {
  verifyAuthToken: (req: Request) => Promise<{ uid: string; email?: string; emailVerified?: boolean } | null>;
  getAdminDb: () => Firestore | null;
  isAdminEmail: (email?: string) => boolean;
  getRealtimeBridge: () => BattleRealtimeBridge | null;
}

const DEFAULT_REWARDS = {
  winnerBaseXp: 250,
  participantBaseXp: 90,
  drawXp: 140,
  judgeBonusXp: 60,
  streakBonusXp: 40,
  allowAudienceVotingDefault: true,
  audienceWeightInHybridPercent: 20,
};

function computeWeightedCriteriaScore(
  criteria: Array<{ id: string; maxScore?: number; weight: number }>,
  scoreMap: Record<string, number>
): number {
  if (!criteria || criteria.length === 0) return 0;
  const totalWeight = criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0) || 100;
  let total = 0;
  for (const c of criteria) {
    const raw = Number(scoreMap?.[c.id] ?? 0);
    const maxS = Math.max(1, Number(c.maxScore) || 10);
    const clamped = Math.max(0, Math.min(maxS, raw));
    const normalized100 = (clamped / maxS) * 100;
    total += normalized100 * ((Number(c.weight) || 0) / totalWeight);
  }
  return Math.round(total * 10) / 10;
}

function computeAutomaticBattleMetrics(battle: any, audienceWeightPercent = 20) {
  const votesA = battle.audienceVotesA || 0;
  const votesB = battle.audienceVotesB || 0;
  const totalVotes = votesA + votesB;

  const scoreCompetitor = (comp: any, votes: number): number => {
    if (!comp) return 0;
    let base = 40;
    if (comp.ready) base += 12;
    if (comp.micActive || comp.camActive || comp.screenSharing) base += 14;
    if (comp.stageSummary && String(comp.stageSummary).trim().length > 10) base += 12;
    if (comp.submissionLink && String(comp.submissionLink).trim().length > 4) base += 12;
    if (comp.codeSnippet && String(comp.codeSnippet).trim().length > 10) base += 10;
    const clampedBase = Math.min(100, base);

    if (!battle.allowAudienceVoting || totalVotes === 0) {
      return Math.round(clampedBase * 10) / 10;
    }

    const audRatio = (votes / totalVotes) * 100;
    const audWeight = Math.min(35, Math.max(10, audienceWeightPercent)) / 100;
    const combined = clampedBase * (1 - audWeight) + audRatio * audWeight;
    return Math.round(combined * 10) / 10;
  };

  return {
    autoScoreA: scoreCompetitor(battle.competitorA, votesA),
    autoScoreB: scoreCompetitor(battle.competitorB, votesB),
  };
}

function buildEmptyServerProfile(uid: string, fullName?: string, username?: string, photoUrl?: string) {
  return {
    uid,
    fullName: fullName || "SwapSkill Competitor",
    username: username || "",
    photoUrl: photoUrl || "",
    battleXp: 0,
    totalBattles: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
    currentStreak: 0,
    bestStreak: 0,
    topCategories: [] as string[],
    badges: [] as string[],
    isVerifiedJudge: false,
    suspendedFromBattles: false,
    recentBattles: [] as any[],
    updatedAtMs: Date.now(),
  };
}

export function registerBattleApiRoutes(app: Express, deps: BattleApiDeps) {
  // 1. Media configuration & pluggable mediasoup SFU / TURN WebRTC negotiation details
  app.get("/api/battles/:battleId/media-config", async (req: Request, res: Response) => {
    try {
      const authUser = await deps.verifyAuthToken(req);
      if (!authUser) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const battleId = String(req.params.battleId || "").trim();
      if (!battleId || !/^[a-zA-Z0-9_-]+$/.test(battleId)) {
        return res.status(400).json({ error: "Invalid battleId" });
      }

      const iceResolution = getResolvedIceServers();
      const sfuCap = mediasoupSfuService.getCapabilityInfo();

      let roleHint = String(req.query.role || "spectator");
      let isCompetitor = roleHint === "competitorA" || roleHint === "competitorB";

      const adminDb = deps.getAdminDb();
      if (adminDb) {
        try {
          const snap = await Promise.race([
            adminDb.collection("battles").doc(battleId).get(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
          ]);
          if (snap && snap.exists) {
            const b = snap.data() as any;
            if (b.creatorId === authUser.uid) {
              roleHint = "competitorA";
              isCompetitor = true;
            } else if (b.opponentId === authUser.uid) {
              roleHint = "competitorB";
              isCompetitor = true;
            } else if (Array.isArray(b.judgeIds) && b.judgeIds.includes(authUser.uid)) {
              roleHint = "judge";
              isCompetitor = false;
            } else if (deps.isAdminEmail(authUser.email)) {
              roleHint = "admin";
              isCompetitor = false;
            } else {
              roleHint = "spectator";
              isCompetitor = false;
            }
          }
        } catch (_) {}
      }

      if (sfuCap.ready) {
        return res.status(200).json({
          mode: "mediasoup_sfu",
          wsPath: "/ws/battles",
          externalSfuUrl: sfuCap.externalSfuUrl || undefined,
          role: roleHint,
          canPublish: isCompetitor,
          iceServers: iceResolution.iceServers,
          capabilities: {
            sfuEngine: "mediasoup",
            sfuConfigured: true,
            simulcast: true,
            adaptiveBitrate: true,
            turnEnabled: iceResolution.turnEnabled,
          },
        });
      }

      return res.status(200).json({
        mode: "ws_webrtc_relay",
        wsPath: "/ws/battles",
        role: roleHint,
        canPublish: isCompetitor,
        maxDirectPeers: 25,
        iceServers: iceResolution.iceServers,
        capabilities: {
          sfuEngine: "mediasoup",
          sfuConfigured: false,
          sfuReason: sfuCap.reason || "MEDIASOUP_ANNOUNCED_IP not configured",
          simulcast: false,
          adaptiveBitrate: true,
          turnEnabled: iceResolution.turnEnabled,
          sfuEnvHints: ["MEDIASOUP_ANNOUNCED_IP", "MEDIASOUP_MIN_PORT", "MEDIASOUP_MAX_PORT"],
        },
      });
    } catch (err: any) {
      console.error("[/api/battles/:battleId/media-config Error]:", err);
      return res.status(500).json({ error: err?.message || "Failed to load battle media config" });
    }
  });

  // 2. Reliable Battle Chat History Fetch (Room + DB fallback)
  app.get("/api/battles/:battleId/messages", async (req: Request, res: Response) => {
    try {
      const authUser = await deps.verifyAuthToken(req);
      if (!authUser) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const battleId = String(req.params.battleId || "").trim();
      if (!battleId || !/^[a-zA-Z0-9_-]+$/.test(battleId)) {
        return res.status(400).json({ error: "Invalid battleId" });
      }

      const bridge = deps.getRealtimeBridge();
      const messages = bridge ? bridge.getChatHistory(battleId) : [];

      return res.status(200).json({ ok: true, messages });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to load messages" });
    }
  });

  // 3. Reliable HTTP Chat Post Fallback (Persists & broadcasts into WS room immediately)
  app.post("/api/battles/:battleId/messages", async (req: Request, res: Response) => {
    try {
      const authUser = await deps.verifyAuthToken(req);
      if (!authUser) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const battleId = String(req.params.battleId || "").trim();
      const bridge = deps.getRealtimeBridge();
      if (!bridge) {
        return res.status(503).json({ error: "Realtime bridge initializing" });
      }

      const result = await bridge.postChatMessageFromHttp({
        battleId,
        uid: authUser.uid,
        email: authUser.email,
        displayName: String(req.body?.displayName || "SwapSkill Member"),
        photoUrl: typeof req.body?.photoUrl === "string" ? req.body.photoUrl : "",
        roleHint: typeof req.body?.roleHint === "string" ? req.body.roleHint : undefined,
        text: String(req.body?.text || ""),
        clientMsgId: typeof req.body?.clientMsgId === "string" ? req.body.clientMsgId : undefined,
        replyTo: req.body?.replyTo,
      });

      if (!result.ok) {
        const errRes = result as { ok: false; status: number; error: string };
        return res.status(errRes.status).json({ error: errRes.error });
      }

      return res.status(200).json({ ok: true, msg: result.msg });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to post chat message" });
    }
  });

  // 4. Live Vote Sync Broadcast Helper
  app.post("/api/battles/:battleId/vote-sync", async (req: Request, res: Response) => {
    try {
      const authUser = await deps.verifyAuthToken(req);
      if (!authUser) return res.status(401).json({ error: "Unauthorized" });
      const battleId = String(req.params.battleId || "").trim();
      const votesA = Number(req.body?.audienceVotesA ?? 0);
      const votesB = Number(req.body?.audienceVotesB ?? 0);
      const bridge = deps.getRealtimeBridge();
      if (bridge && Number.isFinite(votesA) && Number.isFinite(votesB)) {
        bridge.broadcastVoteUpdate(battleId, votesA, votesB);
      }
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Vote sync error" });
    }
  });

  // 5. Server-authoritative battle score calculation & finalization
  app.post("/api/battles/:battleId/finalize", async (req: Request, res: Response) => {
    try {
      const authUser = await deps.verifyAuthToken(req);
      if (!authUser) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const battleId = String(req.params.battleId || "").trim();
      if (!battleId || !/^[a-zA-Z0-9_-]+$/.test(battleId)) {
        return res.status(400).json({ error: "Invalid battleId" });
      }

      const adminDb = deps.getAdminDb();
      let battle: any = req.body?.battleSnapshot || null;
      let judgeScores: any[] = Array.isArray(req.body?.scoresSnapshot) ? req.body.scoresSnapshot : [];
      let rewardCfg: any = DEFAULT_REWARDS;

      if (adminDb) {
        try {
          const [bSnap, sSnap, cfgSnap] = await Promise.all([
            adminDb.collection("battles").doc(battleId).get(),
            adminDb.collection("battleScores").where("battleId", "==", battleId).get(),
            adminDb.collection("battleSettings").doc("config").get(),
          ]);
          if (bSnap.exists) {
            battle = { ...(bSnap.data() as any), id: bSnap.id };
          }
          if (!sSnap.empty) {
            judgeScores = sSnap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
          }
          if (cfgSnap.exists) {
            rewardCfg = { ...DEFAULT_REWARDS, ...((cfgSnap.data() as any)?.rewards || {}) };
          }
        } catch (_) {
          // Starter tier fallback
        }
      }

      if (!battle) {
        return res.status(404).json({ error: "Battle record not found." });
      }

      const isAdmin = deps.isAdminEmail(authUser.email);
      const isAuthorized =
        isAdmin ||
        battle.creatorId === authUser.uid ||
        battle.opponentId === authUser.uid ||
        (Array.isArray(battle.judgeIds) && battle.judgeIds.includes(authUser.uid));

      if (!isAuthorized) {
        return res.status(403).json({ error: "Forbidden: only battle judges, competitors, or admin can finalize." });
      }

      if (!battle.opponentId || !battle.competitorB) {
        return res.status(400).json({ error: "Cannot finalize a battle without an opponent." });
      }

      if (
        battle.judgingMethod === "human_judges" &&
        Array.isArray(battle.judgeIds) &&
        battle.judgeIds.length > 0 &&
        judgeScores.length === 0 &&
        !isAdmin
      ) {
        return res.status(400).json({
          error: "At least one assigned judge must submit their scorecard before finalizing.",
        });
      }

      const criteria = Array.isArray(battle.criteria) ? battle.criteria : [];
      const { autoScoreA, autoScoreB } = computeAutomaticBattleMetrics(
        battle,
        rewardCfg.audienceWeightInHybridPercent
      );

      let judgeScoreA = 0;
      let judgeScoreB = 0;

      if (judgeScores.length > 0) {
        const totalsA = judgeScores.map((s) =>
          typeof s.weightedTotalA === "number"
            ? s.weightedTotalA
            : computeWeightedCriteriaScore(criteria, s.competitorAScores || {})
        );
        const totalsB = judgeScores.map((s) =>
          typeof s.weightedTotalB === "number"
            ? s.weightedTotalB
            : computeWeightedCriteriaScore(criteria, s.competitorBScores || {})
        );
        judgeScoreA =
          Math.round((totalsA.reduce((a, b) => a + b, 0) / totalsA.length) * 10) / 10;
        judgeScoreB =
          Math.round((totalsB.reduce((a, b) => a + b, 0) / totalsB.length) * 10) / 10;
      }

      let finalScoreA = autoScoreA;
      let finalScoreB = autoScoreB;
      if (battle.judgingMethod === "human_judges" && judgeScores.length > 0) {
        finalScoreA = judgeScoreA;
        finalScoreB = judgeScoreB;
      } else if (battle.judgingMethod === "hybrid" && judgeScores.length > 0) {
        finalScoreA = Math.round((judgeScoreA * 0.65 + autoScoreA * 0.35) * 10) / 10;
        finalScoreB = Math.round((judgeScoreB * 0.65 + autoScoreB * 0.35) * 10) / 10;
      }

      const criteriaBreakdown = criteria.map((c: any) => {
        const sA =
          judgeScores.length > 0
            ? Math.round(
                (judgeScores.reduce(
                  (acc, sc) => acc + Number(sc.competitorAScores?.[c.id] ?? 0),
                  0
                ) /
                  judgeScores.length) *
                  10
              ) / 10
            : Math.round((autoScoreA / 10) * 10) / 10;
        const sB =
          judgeScores.length > 0
            ? Math.round(
                (judgeScores.reduce(
                  (acc, sc) => acc + Number(sc.competitorBScores?.[c.id] ?? 0),
                  0
                ) /
                  judgeScores.length) *
                  10
              ) / 10
            : Math.round((autoScoreB / 10) * 10) / 10;
        return {
          criterionId: c.id,
          label: c.label,
          weight: c.weight,
          scoreA: sA,
          scoreB: sB,
        };
      });

      const isDraw = Math.abs(finalScoreA - finalScoreB) < 0.05;
      const slotAWins = !isDraw && finalScoreA > finalScoreB;
      const winnerId = isDraw ? null : slotAWins ? battle.creatorId : battle.opponentId;
      const compAName = battle.competitorA?.name || battle.creatorName || "Competitor A";
      const compBName = battle.competitorB?.name || battle.opponentName || "Opponent";
      const winnerName = isDraw ? "Draw Match" : slotAWins ? compAName : compBName;
      const runnerUpId = isDraw ? null : slotAWins ? battle.opponentId : battle.creatorId;
      const runnerUpName = isDraw ? "" : slotAWins ? compBName : compAName;

      const now = Date.now();
      const baseComputedResult = {
        id: battleId,
        battleId,
        battleTitle: battle.title,
        category: battle.category,
        customSkill: battle.customSkill,
        judgingMethod: battle.judgingMethod,
        creatorId: battle.creatorId,
        opponentId: battle.opponentId,
        competitorAName: compAName,
        competitorAPhoto: battle.competitorA?.photoUrl || "",
        competitorBName: compBName,
        competitorBPhoto: battle.competitorB?.photoUrl || "",
        winnerId,
        winnerName,
        runnerUpId,
        runnerUpName,
        isDraw,
        finalScoreA,
        finalScoreB,
        judgeScoreA,
        judgeScoreB,
        autoScoreA,
        autoScoreB,
        audienceVotesA: battle.audienceVotesA || 0,
        audienceVotesB: battle.audienceVotesB || 0,
        criteriaBreakdown,
        judgeFeedbacks: judgeScores.map((s) => ({
          judgeId: s.judgeId,
          judgeName: s.judgeName,
          feedbackA: s.feedbackA || "",
          feedbackB: s.feedbackB || "",
          ...(s.overallNote ? { overallNote: s.overallNote } : {}),
        })),
        xpAwardedWinner: isDraw ? rewardCfg.drawXp : rewardCfg.winnerBaseXp,
        xpAwardedParticipant: rewardCfg.participantBaseXp,
        badgesUnlocked: {} as Record<string, string[]>,
        publishedBy: authUser.uid,
        publishedAtMs: now,
      };

      const computeProfileOutcome = (
        profile: any,
        outcome: "win" | "loss" | "draw",
        myScore: number,
        oppScore: number,
        oppName: string
      ) => {
        const nextTotal = (profile.totalBattles || 0) + 1;
        const nextWins = (profile.wins || 0) + (outcome === "win" ? 1 : 0);
        const nextLosses = (profile.losses || 0) + (outcome === "loss" ? 1 : 0);
        const nextDraws = (profile.draws || 0) + (outcome === "draw" ? 1 : 0);
        const nextStreak = outcome === "win" ? (profile.currentStreak || 0) + 1 : 0;
        const nextBestStreak = Math.max(profile.bestStreak || 0, nextStreak);
        const xpEarned =
          outcome === "draw"
            ? rewardCfg.drawXp
            : outcome === "win"
            ? rewardCfg.winnerBaseXp + (nextStreak >= 2 ? rewardCfg.streakBonusXp : 0)
            : rewardCfg.participantBaseXp;
        const nextXp = (profile.battleXp || 0) + xpEarned;

        const badgesSet = new Set<string>(profile.badges || []);
        const unlockedHere: string[] = [];
        const awardBadge = (id: string) => {
          if (!badgesSet.has(id)) {
            badgesSet.add(id);
            unlockedHere.push(id);
          }
        };
        if (nextWins >= 1) awardBadge("first_victory");
        if (nextStreak >= 3) awardBadge("win_streak_3");
        if (nextTotal >= 5) awardBadge("veteran_5");
        if (nextXp >= 1000) awardBadge("grandmaster_1000xp");

        const topCats = Array.from(new Set([battle.category, ...(profile.topCategories || [])])).slice(
          0,
          5
        );
        const historyEntry = {
          battleId: battle.id,
          title: battle.title,
          category: battle.category,
          opponentName: oppName,
          outcome,
          score: myScore,
          opponentScore: oppScore,
          xpEarned,
          completedAtMs: now,
        };

        return {
          xpEarned,
          unlockedHere,
          updatedProfile: {
            ...profile,
            battleXp: nextXp,
            totalBattles: nextTotal,
            wins: nextWins,
            losses: nextLosses,
            draws: nextDraws,
            winRate: nextTotal > 0 ? Math.round((nextWins / nextTotal) * 100) : 0,
            currentStreak: nextStreak,
            bestStreak: nextBestStreak,
            topCategories: topCats,
            badges: Array.from(badgesSet),
            recentBattles: [historyEntry, ...(profile.recentBattles || [])].slice(0, 12),
            lastBattleId: battle.id,
            updatedAtMs: now,
          },
        };
      };

      let adminPersisted = false;
      let persistedResult = baseComputedResult;
      if (adminDb) {
        try {
          const outcome = await adminDb.runTransaction(async (tx) => {
            const resultRef = adminDb.collection("battleResults").doc(battleId);
            const battleRef = adminDb.collection("battles").doc(battleId);
            const profARef = adminDb.collection("battleProfiles").doc(battle.creatorId);
            const profBRef = adminDb.collection("battleProfiles").doc(battle.opponentId);

            const [existingRes, profASnap, profBSnap] = await Promise.all([
              tx.get(resultRef),
              tx.get(profARef),
              tx.get(profBRef),
            ]);

            if (existingRes.exists) {
              return { alreadyFinalized: true, result: existingRes.data() };
            }

            const profA = profASnap.exists
              ? profASnap.data()
              : buildEmptyServerProfile(
                  battle.creatorId,
                  battle.creatorName,
                  battle.creatorUsername,
                  battle.creatorPhoto
                );
            const profB = profBSnap.exists
              ? profBSnap.data()
              : buildEmptyServerProfile(
                  battle.opponentId,
                  battle.opponentName || "Challenger",
                  battle.opponentUsername,
                  battle.opponentPhoto
                );

            const resA = computeProfileOutcome(
              profA,
              isDraw ? "draw" : slotAWins ? "win" : "loss",
              finalScoreA,
              finalScoreB,
              compBName
            );
            const resB = computeProfileOutcome(
              profB,
              isDraw ? "draw" : slotAWins ? "loss" : "win",
              finalScoreB,
              finalScoreA,
              compAName
            );

            const finalResult = {
              ...baseComputedResult,
              xpAwardedWinner: isDraw
                ? rewardCfg.drawXp
                : Math.max(resA.xpEarned, resB.xpEarned),
              badgesUnlocked: {
                [battle.creatorId]: resA.unlockedHere,
                [battle.opponentId]: resB.unlockedHere,
              },
            };

            tx.set(resultRef, finalResult);
            tx.update(battleRef, {
              status: "completed",
              endedAtMs: battle.endedAtMs || now,
              winnerId,
              winnerName,
              isDraw,
              finalScoreA,
              finalScoreB,
              updatedAtMs: now,
            });
            tx.set(profARef, resA.updatedProfile);
            tx.set(profBRef, resB.updatedProfile);
            tx.set(adminDb.collection("battleRewards").doc(`${battleId}_${battle.creatorId}`), {
              id: `${battleId}_${battle.creatorId}`,
              battleId,
              battleTitle: battle.title,
              userId: battle.creatorId,
              role: isDraw ? "draw" : slotAWins ? "winner" : "runner_up",
              xpEarned: resA.xpEarned,
              badgesGranted: resA.unlockedHere,
              category: battle.category,
              createdAtMs: now,
            });
            tx.set(adminDb.collection("battleRewards").doc(`${battleId}_${battle.opponentId}`), {
              id: `${battleId}_${battle.opponentId}`,
              battleId,
              battleTitle: battle.title,
              userId: battle.opponentId,
              role: isDraw ? "draw" : slotAWins ? "runner_up" : "winner",
              xpEarned: resB.xpEarned,
              badgesGranted: resB.unlockedHere,
              category: battle.category,
              createdAtMs: now,
            });

            return { alreadyFinalized: false, result: finalResult };
          });

          if (outcome.alreadyFinalized) {
            return res.status(200).json({
              ok: true,
              result: outcome.result,
              adminPersisted: true,
              alreadyFinalized: true,
            });
          }
          persistedResult = outcome.result as any;
          adminPersisted = true;
        } catch (err: any) {
          console.warn("[BattleFinalize] Admin SDK persist skipped:", err?.message || err);
        }
      }

      return res.status(200).json({
        ok: true,
        result: persistedResult,
        adminPersisted,
        requiresClientCommit: !adminPersisted,
      });
    } catch (err: any) {
      console.error("[/api/battles/:battleId/finalize Error]:", err);
      return res.status(500).json({ error: err?.message || "Failed to finalize battle" });
    }
  });
}
