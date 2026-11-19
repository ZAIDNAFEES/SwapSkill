import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  increment,
  Unsubscribe,
} from "firebase/firestore";
import { db } from "../firebase";
import { handleFirestoreError, OperationType } from "../utils/firestoreError";
import { isVerificationAdminEmail } from "../utils/verificationAdmin";
import { notifyBattleUsers, sendBattleNotification } from "./battleNotificationService";
import {
  Battle,
  BattleCategoryItem,
  BattleComment,
  BattleCompetitorSummary,
  BattleCriterion,
  BattleCriterionBreakdown,
  BattleJudge,
  BattleJudgeApplication,
  BattleJudgeSummary,
  BattleJudgingMethod,
  BattleMode,
  BattleProfile,
  BattleRecentHistoryEntry,
  BattleReport,
  BattleResult,
  BattleReward,
  BattleRewardConfig,
  BattleScore,
  BattleSettings,
  BattleSuspension,
  BattleViewer,
  BattleVisibility,
  BattleVote,
  DEFAULT_BATTLE_CATEGORIES,
  DEFAULT_BATTLE_CRITERIA,
  DEFAULT_BATTLE_REWARD_CONFIG,
} from "../types/battle";

export interface BattleUserActor {
  uid: string;
  email?: string;
  fullName: string;
  username?: string;
  photoUrl?: string;
  verified?: boolean;
}

export interface CreateBattleInput {
  title: string;
  description: string;
  category: string;
  customSkill: string;
  mode: BattleMode;
  visibility: BattleVisibility;
  durationMinutes: number;
  scheduledAtMs?: number;
  judgingMethod: BattleJudgingMethod;
  allowAudienceVoting: boolean;
  rules: string[];
  criteria: BattleCriterion[];
  opponent?: BattleUserActor | null;
  judges?: BattleJudgeSummary[];
  entryRequirements?: {
    minXp?: number;
    verifiedOnly?: boolean;
    requiredSkill?: string;
  };
  thumbnailUrl?: string;
}

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function buildEmptyBattleProfile(user: {
  uid: string;
  fullName?: string;
  username?: string;
  photoUrl?: string;
}): BattleProfile {
  return {
    uid: user.uid,
    fullName: user.fullName || "SwapSkill Competitor",
    username: user.username || "",
    photoUrl: user.photoUrl || "",
    battleXp: 0,
    totalBattles: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
    currentStreak: 0,
    bestStreak: 0,
    topCategories: [],
    badges: [],
    isVerifiedJudge: false,
    suspendedFromBattles: false,
    recentBattles: [],
    updatedAtMs: Date.now(),
  };
}

export function computeWeightedTotal(
  scoresByCriterion: Record<string, number>,
  criteria: BattleCriterion[]
): number {
  const list = criteria.length > 0 ? criteria : DEFAULT_BATTLE_CRITERIA;
  const totalWeight = list.reduce((sum, c) => sum + (c.weight || 0), 0) || 100;
  let weighted = 0;
  for (const c of list) {
    const raw = Number(scoresByCriterion[c.id] ?? 0);
    const maxScore = Math.max(1, c.maxScore || 10);
    const clamped = Math.max(0, Math.min(maxScore, raw));
    const normalized = (clamped / maxScore) * 100;
    weighted += normalized * ((c.weight || 0) / totalWeight);
  }
  return Math.round(weighted * 10) / 10;
}

export function computeAutomaticScores(
  battle: Battle,
  audienceWeightPercent = 20
): { autoScoreA: number; autoScoreB: number } {
  const scoreCompetitor = (
    comp: BattleCompetitorSummary | null | undefined,
    votes: number,
    totalVotes: number
  ): number => {
    if (!comp) return 0;
    let base = 40; // Participating & live round completion base
    if (comp.ready) base += 12;
    if (comp.micActive || comp.camActive || comp.screenSharing) base += 14;
    if (comp.stageSummary && comp.stageSummary.trim().length > 10) base += 12;
    if (comp.submissionLink && comp.submissionLink.trim().length > 4) base += 12;
    if (comp.codeSnippet && comp.codeSnippet.trim().length > 10) base += 10;
    const clampedBase = Math.min(100, base);

    if (!battle.allowAudienceVoting || totalVotes === 0) {
      return Math.round(clampedBase * 10) / 10;
    }

    const audRatio = (votes / totalVotes) * 100;
    const audWeight = Math.min(35, Math.max(10, audienceWeightPercent)) / 100;
    const combined = clampedBase * (1 - audWeight) + audRatio * audWeight;
    return Math.round(combined * 10) / 10;
  };

  const votesA = battle.audienceVotesA || 0;
  const votesB = battle.audienceVotesB || 0;
  const totalVotes = votesA + votesB;

  return {
    autoScoreA: scoreCompetitor(battle.competitorA, votesA, totalVotes),
    autoScoreB: scoreCompetitor(battle.competitorB, votesB, totalVotes),
  };
}

export async function fetchBattleSettings(): Promise<BattleSettings> {
  try {
    const snap = await getDoc(doc(db, "battleSettings", "config"));
    if (snap.exists()) {
      const data = snap.data() as BattleSettings;
      return {
        id: "config",
        categories:
          Array.isArray(data.categories) && data.categories.length > 0
            ? data.categories
            : DEFAULT_BATTLE_CATEGORIES,
        rewards: {
          ...DEFAULT_BATTLE_REWARD_CONFIG,
          ...(data.rewards || {}),
        },
        updatedBy: data.updatedBy || "system",
        updatedAtMs: data.updatedAtMs || Date.now(),
      };
    }
  } catch (err) {
    console.warn("[BattleService] Using default battleSettings:", err);
  }

  return {
    id: "config",
    categories: DEFAULT_BATTLE_CATEGORIES,
    rewards: DEFAULT_BATTLE_REWARD_CONFIG,
    updatedBy: "system",
    updatedAtMs: Date.now(),
  };
}

export async function fetchBattleProfile(
  uid: string,
  fallbackUser?: { fullName?: string; username?: string; photoUrl?: string }
): Promise<BattleProfile> {
  if (!uid) {
    return buildEmptyBattleProfile({ uid: "" });
  }
  try {
    const snap = await getDoc(doc(db, "battleProfiles", uid));
    if (snap.exists()) {
      return snap.data() as BattleProfile;
    }
    return buildEmptyBattleProfile({
      uid,
      fullName: fallbackUser?.fullName,
      username: fallbackUser?.username,
      photoUrl: fallbackUser?.photoUrl,
    });
  } catch (err) {
    console.warn("[BattleService] fetchBattleProfile fallback:", err);
    return buildEmptyBattleProfile({
      uid,
      fullName: fallbackUser?.fullName,
      username: fallbackUser?.username,
      photoUrl: fallbackUser?.photoUrl,
    });
  }
}

export async function checkUserBattleSuspension(uid: string): Promise<BattleSuspension | null> {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, "battleSuspensions", uid));
    if (snap.exists()) {
      const data = snap.data() as BattleSuspension;
      if (data.active) return data;
    }
  } catch (_) {}
  return null;
}

export async function fetchBattlesFeed(options: {
  currentUserId?: string;
  isAdmin?: boolean;
  pageSize?: number;
}): Promise<Battle[]> {
  const { currentUserId, isAdmin = false, pageSize = 40 } = options;
  try {
    const map = new Map<string, Battle>();

    if (isAdmin) {
      const qAll = query(
        collection(db, "battles"),
        orderBy("updatedAtMs", "desc"),
        limit(Math.max(pageSize, 50))
      );
      const snap = await getDocs(qAll);
      snap.docs.forEach((d) => {
        map.set(d.id, { ...(d.data() as Battle), id: d.id });
      });
    } else {
      const queries: Promise<void>[] = [];

      const qPublic = query(
        collection(db, "battles"),
        where("visibility", "==", "public"),
        limit(pageSize)
      );
      queries.push(
        getDocs(qPublic).then((snap) => {
          snap.docs.forEach((d) => {
            map.set(d.id, { ...(d.data() as Battle), id: d.id });
          });
        })
      );

      if (currentUserId) {
        const qParticipant = query(
          collection(db, "battles"),
          where("participantIds", "array-contains", currentUserId),
          limit(25)
        );
        queries.push(
          getDocs(qParticipant).then((snap) => {
            snap.docs.forEach((d) => {
              map.set(d.id, { ...(d.data() as Battle), id: d.id });
            });
          })
        );

        const qJudge = query(
          collection(db, "battles"),
          where("judgeIds", "array-contains", currentUserId),
          limit(25)
        );
        queries.push(
          getDocs(qJudge)
            .then((snap) => {
              snap.docs.forEach((d) => {
                map.set(d.id, { ...(d.data() as Battle), id: d.id });
              });
            })
            .catch(() => {})
        );
      }

      await Promise.all(queries);
    }

    const statusWeight: Record<string, number> = {
      live: 5,
      judging: 4,
      pending_invite: 3,
      upcoming: 2,
      open: 2,
      completed: 1,
      cancelled: 0,
    };

    return Array.from(map.values()).sort((a, b) => {
      if (a.status !== b.status) {
        return (statusWeight[b.status] ?? 0) - (statusWeight[a.status] ?? 0);
      }
      return (b.updatedAtMs || b.createdAtMs || 0) - (a.updatedAtMs || a.createdAtMs || 0);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, "battles");
    return [];
  }
}

export async function fetchBattleById(battleId: string): Promise<Battle | null> {
  if (!battleId) return null;
  try {
    const snap = await getDoc(doc(db, "battles", battleId));
    if (!snap.exists()) return null;
    return { ...(snap.data() as Battle), id: snap.id };
  } catch (err) {
    console.warn("[BattleService] fetchBattleById error:", err);
    return null;
  }
}

export async function searchPotentialOpponents(
  searchText: string,
  excludeUserId: string
): Promise<BattleUserActor[]> {
  try {
    const qUsers = query(collection(db, "users"), limit(40));
    const snap = await getDocs(qUsers);
    const term = searchText.trim().toLowerCase();

    return snap.docs
      .map((d) => {
        const u = d.data() as any;
        return {
          uid: d.id,
          fullName: u.fullName || u.name || "SwapSkill Member",
          username: u.username || "",
          photoUrl: u.profilePhotoUrl || u.photoUrl || u.photoURL || "",
          verified: Boolean(u.verified),
        } as BattleUserActor;
      })
      .filter((u) => {
        if (u.uid === excludeUserId) return false;
        if (!term) return true;
        return (
          u.fullName.toLowerCase().includes(term) ||
          (u.username || "").toLowerCase().includes(term)
        );
      })
      .slice(0, 15);
  } catch (err) {
    console.warn("[BattleService] searchPotentialOpponents error:", err);
    return [];
  }
}

export async function fetchActiveVerifiedJudges(): Promise<BattleJudge[]> {
  try {
    const qJudges = query(
      collection(db, "battleJudges"),
      where("status", "==", "active"),
      limit(30)
    );
    const snap = await getDocs(qJudges);
    return snap.docs.map((d) => ({ ...(d.data() as BattleJudge), uid: d.id }));
  } catch (err) {
    console.warn("[BattleService] fetchActiveVerifiedJudges error:", err);
    return [];
  }
}

export async function createBattle(
  input: CreateBattleInput,
  creator: BattleUserActor
): Promise<Battle> {
  const suspension = await checkUserBattleSuspension(creator.uid);
  if (suspension?.active) {
    throw new Error(`You are currently suspended from creating Skill Battles: ${suspension.reason}`);
  }

  const now = Date.now();
  const battleId = generateId("btl");
  const callId = `battle_call_${battleId}`;

  const creatorProfile = await fetchBattleProfile(creator.uid, creator);
  const competitorA: BattleCompetitorSummary = {
    uid: creator.uid,
    name: creator.fullName,
    username: creator.username || "",
    photoUrl: creator.photoUrl || "",
    verified: Boolean(creator.verified),
    battleXp: creatorProfile.battleXp,
    wins: creatorProfile.wins,
    losses: creatorProfile.losses,
    ready: false,
    micActive: true,
    camActive: true,
    screenSharing: false,
  };

  let competitorB: BattleCompetitorSummary | null = null;
  const participantIds = [creator.uid];
  let status: Battle["status"] = "open";
  let inviteStatus: Battle["inviteStatus"] = undefined;

  if (input.mode === "direct" && input.opponent) {
    const oppProfile = await fetchBattleProfile(input.opponent.uid, input.opponent);
    competitorB = {
      uid: input.opponent.uid,
      name: input.opponent.fullName,
      username: input.opponent.username || "",
      photoUrl: input.opponent.photoUrl || "",
      verified: Boolean(input.opponent.verified),
      battleXp: oppProfile.battleXp,
      wins: oppProfile.wins,
      losses: oppProfile.losses,
      ready: false,
      micActive: true,
      camActive: true,
      screenSharing: false,
    };
    participantIds.push(input.opponent.uid);
    status = "pending_invite";
    inviteStatus = "pending";
  }

  const judges = (input.judges || []).slice(0, 3);
  const judgeIds = judges.map((j) => j.uid);

  const battle: Battle = {
    id: battleId,
    title: input.title.trim(),
    description: input.description.trim(),
    category: input.category,
    customSkill: input.customSkill.trim(),
    mode: input.mode,
    visibility: input.visibility,
    status,
    judgingMethod: input.judgingMethod,
    allowAudienceVoting: input.allowAudienceVoting,
    featured: false,
    durationMinutes: input.durationMinutes,
    scheduledAtMs: input.scheduledAtMs || now,
    createdAtMs: now,
    updatedAtMs: now,
    creatorId: creator.uid,
    creatorName: creator.fullName,
    creatorUsername: creator.username || "",
    creatorPhoto: creator.photoUrl || "",
    creatorVerified: Boolean(creator.verified),
    ...(input.mode === "direct" && input.opponent
      ? {
          opponentId: input.opponent.uid,
          opponentName: input.opponent.fullName,
          opponentUsername: input.opponent.username || "",
          opponentPhoto: input.opponent.photoUrl || "",
          opponentVerified: Boolean(input.opponent.verified),
          inviteStatus,
        }
      : { opponentId: null as any }),
    participantIds,
    judgeIds,
    judges,
    competitorA,
    competitorB,
    rules: input.rules.filter((r) => r.trim().length > 0),
    criteria: input.criteria.length > 0 ? input.criteria : DEFAULT_BATTLE_CRITERIA,
    ...(input.entryRequirements ? { entryRequirements: input.entryRequirements } : {}),
    ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
    callId,
    viewerCount: 0,
    applauseCount: 0,
    audienceVotesA: 0,
    audienceVotesB: 0,
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "battles", battleId), battle);
    batch.set(doc(db, "battleParticipants", `${battleId}_${creator.uid}`), {
      id: `${battleId}_${creator.uid}`,
      battleId,
      userId: creator.uid,
      role: "creator",
      name: creator.fullName,
      username: creator.username || "",
      photoUrl: creator.photoUrl || "",
      ready: false,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `battles/${battleId}`);
  }

  // Send battle notifications asynchronously without blocking creation
  if (input.mode === "direct" && input.opponent) {
    void sendBattleNotification({
      targetUserId: input.opponent.uid,
      type: "battle_invite",
      title: `Skill Battle Challenge from ${creator.fullName}`,
      body: `You've been challenged to "${battle.title}" (${battle.customSkill}) • ${battle.durationMinutes} min`,
      battleId,
      senderId: creator.uid,
      senderName: creator.fullName,
      senderPhoto: creator.photoUrl,
    });
  }

  if (judgeIds.length > 0) {
    void notifyBattleUsers(judgeIds, {
      type: "battle_judge_assigned",
      title: "Assigned as Official Battle Judge",
      body: `You were assigned to judge "${battle.title}" (${battle.customSkill}).`,
      battleId,
      senderId: creator.uid,
      senderName: creator.fullName,
      senderPhoto: creator.photoUrl,
    });
  }

  return battle;
}

export async function respondToBattleInvite(
  battleId: string,
  user: BattleUserActor,
  accept: boolean
): Promise<Battle> {
  const suspension = await checkUserBattleSuspension(user.uid);
  if (accept && suspension?.active) {
    throw new Error(`You are suspended from Skill Battles: ${suspension.reason}`);
  }

  const now = Date.now();
  let updatedBattle!: Battle;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, "battles", battleId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Battle not found.");
    const data = snap.data() as Battle;

    if (data.opponentId !== user.uid) {
      throw new Error("Only the invited opponent can respond to this challenge.");
    }
    if (data.status !== "pending_invite") {
      throw new Error("This challenge has already been responded to.");
    }

    if (accept) {
      updatedBattle = {
        ...data,
        status: "upcoming",
        inviteStatus: "accepted",
        updatedAtMs: now,
      };
      tx.update(ref, {
        status: "upcoming",
        inviteStatus: "accepted",
        updatedAtMs: now,
      });
      tx.set(doc(db, "battleParticipants", `${battleId}_${user.uid}`), {
        id: `${battleId}_${user.uid}`,
        battleId,
        userId: user.uid,
        role: "opponent",
        name: user.fullName,
        username: user.username || "",
        photoUrl: user.photoUrl || "",
        ready: false,
        createdAtMs: now,
        updatedAtMs: now,
      });
    } else {
      updatedBattle = {
        ...data,
        status: "cancelled",
        inviteStatus: "declined",
        cancelReason: "Opponent declined the challenge",
        updatedAtMs: now,
      };
      tx.update(ref, {
        status: "cancelled",
        inviteStatus: "declined",
        cancelReason: "Opponent declined the challenge",
        updatedAtMs: now,
      });
    }
  });

  void sendBattleNotification({
    targetUserId: updatedBattle.creatorId,
    type: accept ? "battle_accepted" : "battle_declined",
    title: accept
      ? `${user.fullName} Accepted Your Battle!`
      : `${user.fullName} Declined Battle Invite`,
    body: accept
      ? `"${updatedBattle.title}" is now upcoming. Head to the Arena when ready!`
      : `"${updatedBattle.title}" challenge was declined.`,
    battleId,
    senderId: user.uid,
    senderName: user.fullName,
    senderPhoto: user.photoUrl,
  });

  return updatedBattle;
}

export async function joinOpenBattle(
  battleId: string,
  challenger: BattleUserActor
): Promise<Battle> {
  const suspension = await checkUserBattleSuspension(challenger.uid);
  if (suspension?.active) {
    throw new Error(`You are suspended from Skill Battles: ${suspension.reason}`);
  }

  const challengerProfile = await fetchBattleProfile(challenger.uid, challenger);
  const now = Date.now();
  let updatedBattle!: Battle;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, "battles", battleId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Battle not found.");
    const data = snap.data() as Battle;

    if (data.creatorId === challenger.uid) {
      throw new Error("You cannot join your own battle as the opponent.");
    }
    if (data.mode !== "open" || data.status !== "open" || data.opponentId) {
      throw new Error("This open battle slot has already been claimed.");
    }
    if (data.entryRequirements?.verifiedOnly && !challenger.verified) {
      throw new Error("This battle requires a verified SwapSkill profile.");
    }
    if (
      data.entryRequirements?.minXp &&
      challengerProfile.battleXp < data.entryRequirements.minXp
    ) {
      throw new Error(
        `Minimum ${data.entryRequirements.minXp} Battle XP required to join.`
      );
    }

    const competitorB: BattleCompetitorSummary = {
      uid: challenger.uid,
      name: challenger.fullName,
      username: challenger.username || "",
      photoUrl: challenger.photoUrl || "",
      verified: Boolean(challenger.verified),
      battleXp: challengerProfile.battleXp,
      wins: challengerProfile.wins,
      losses: challengerProfile.losses,
      ready: false,
      micActive: true,
      camActive: true,
      screenSharing: false,
    };

    const nextParticipants = Array.from(new Set([...(data.participantIds || []), challenger.uid]));

    updatedBattle = {
      ...data,
      opponentId: challenger.uid,
      opponentName: challenger.fullName,
      opponentUsername: challenger.username || "",
      opponentPhoto: challenger.photoUrl || "",
      opponentVerified: Boolean(challenger.verified),
      inviteStatus: "open_filled",
      participantIds: nextParticipants,
      competitorB,
      status: "upcoming",
      updatedAtMs: now,
    };

    tx.update(ref, {
      opponentId: challenger.uid,
      opponentName: challenger.fullName,
      opponentUsername: challenger.username || "",
      opponentPhoto: challenger.photoUrl || "",
      opponentVerified: Boolean(challenger.verified),
      inviteStatus: "open_filled",
      participantIds: nextParticipants,
      competitorB,
      status: "upcoming",
      updatedAtMs: now,
    });

    tx.set(doc(db, "battleParticipants", `${battleId}_${challenger.uid}`), {
      id: `${battleId}_${challenger.uid}`,
      battleId,
      userId: challenger.uid,
      role: "opponent",
      name: challenger.fullName,
      username: challenger.username || "",
      photoUrl: challenger.photoUrl || "",
      ready: false,
      createdAtMs: now,
      updatedAtMs: now,
    });
  });

  void sendBattleNotification({
    targetUserId: updatedBattle.creatorId,
    type: "battle_challenger_joined",
    title: `${challenger.fullName} Joined Your Open Battle!`,
    body: `"${updatedBattle.title}" has a challenger. Enter the Arena to start live!`,
    battleId,
    senderId: challenger.uid,
    senderName: challenger.fullName,
    senderPhoto: challenger.photoUrl,
  });

  return updatedBattle;
}

export async function updateCompetitorArenaState(
  battleId: string,
  userId: string,
  patch: Partial<BattleCompetitorSummary>
): Promise<void> {
  const now = Date.now();
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "battles", battleId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const battle = snap.data() as Battle;

      if (battle.creatorId === userId) {
        tx.update(ref, {
          competitorA: { ...battle.competitorA, ...patch },
          updatedAtMs: now,
        });
      } else if (battle.opponentId === userId && battle.competitorB) {
        tx.update(ref, {
          competitorB: { ...battle.competitorB, ...patch },
          updatedAtMs: now,
        });
      }
    });
  } catch (err) {
    console.warn("[BattleService] updateCompetitorArenaState warning:", err);
  }
}

export async function startBattleLive(battleId: string, actor: BattleUserActor): Promise<void> {
  const now = Date.now();
  let battleSnapshot!: Battle;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, "battles", battleId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Battle not found.");
    const data = snap.data() as Battle;

    const isAllowed =
      data.creatorId === actor.uid ||
      data.opponentId === actor.uid ||
      isVerificationAdminEmail(actor.email);

    if (!isAllowed) {
      throw new Error("Only competitors or the platform admin can start this battle.");
    }
    if (!data.opponentId || !data.competitorB) {
      throw new Error("An opponent must join before the battle can go LIVE.");
    }
    if (data.status === "live") return;
    if (data.status === "completed" || data.status === "cancelled") {
      throw new Error("This battle has already ended.");
    }

    battleSnapshot = data;
    tx.update(ref, {
      status: "live",
      startedAtMs: data.startedAtMs || now,
      updatedAtMs: now,
    });
  });

  if (battleSnapshot) {
    const targets = [
      ...(battleSnapshot.participantIds || []),
      ...(battleSnapshot.judgeIds || []),
    ].filter((uid) => uid !== actor.uid);

    void notifyBattleUsers(targets, {
      type: "battle_live",
      title: `LIVE NOW: ${battleSnapshot.title}`,
      body: `${battleSnapshot.competitorA.name} vs ${battleSnapshot.competitorB?.name || "Challenger"} just went LIVE in the Arena!`,
      battleId,
      senderId: actor.uid,
      senderName: actor.fullName,
      senderPhoto: actor.photoUrl,
    });
  }
}

export async function moveBattleToJudging(battleId: string, actor: BattleUserActor): Promise<void> {
  const now = Date.now();
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "battles", battleId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Battle not found.");
    const data = snap.data() as Battle;

    const isAllowed =
      data.creatorId === actor.uid ||
      data.opponentId === actor.uid ||
      data.judgeIds?.includes(actor.uid) ||
      isVerificationAdminEmail(actor.email);

    if (!isAllowed) {
      throw new Error("Unauthorized to move battle to judging phase.");
    }
    if (data.status === "completed" || data.status === "cancelled") return;

    tx.update(ref, {
      status: "judging",
      endedAtMs: data.endedAtMs || now,
      updatedAtMs: now,
    });
  });
}

export async function submitJudgeScore(input: {
  battle: Battle;
  judge: BattleUserActor;
  competitorAScores: Record<string, number>;
  competitorBScores: Record<string, number>;
  feedbackA: string;
  feedbackB: string;
  overallNote?: string;
}): Promise<BattleScore> {
  const { battle, judge } = input;
  const isAdmin = isVerificationAdminEmail(judge.email);
  if (!isAdmin && !battle.judgeIds?.includes(judge.uid)) {
    throw new Error("Only judges assigned to this battle can submit official scores.");
  }

  const now = Date.now();
  const weightedTotalA = computeWeightedTotal(input.competitorAScores, battle.criteria);
  const weightedTotalB = computeWeightedTotal(input.competitorBScores, battle.criteria);
  const scoreId = `${battle.id}_${judge.uid}`;

  const scoreDoc: BattleScore = {
    id: scoreId,
    battleId: battle.id,
    judgeId: judge.uid,
    judgeName: judge.fullName,
    judgePhoto: judge.photoUrl || "",
    competitorAScores: input.competitorAScores,
    competitorBScores: input.competitorBScores,
    weightedTotalA,
    weightedTotalB,
    feedbackA: input.feedbackA.trim(),
    feedbackB: input.feedbackB.trim(),
    overallNote: input.overallNote?.trim() || "",
    submittedAtMs: now,
    locked: true,
  };

  await runTransaction(db, async (tx) => {
    const battleRef = doc(db, "battles", battle.id);
    const battleSnap = await tx.get(battleRef);
    if (!battleSnap.exists()) throw new Error("Battle not found.");
    const bData = battleSnap.data() as Battle;

    if (bData.status === "completed") {
      throw new Error("Battle results are already finalized.");
    }

    tx.set(doc(db, "battleScores", scoreId), scoreDoc);

    const updatedJudges = (bData.judges || []).map((j) =>
      j.uid === judge.uid ? { ...j, submitted: true } : j
    );

    tx.update(battleRef, {
      judges: updatedJudges,
      updatedAtMs: now,
    });
  });

  return scoreDoc;
}

export async function assignJudgeToBattle(
  battleId: string,
  actor: BattleUserActor,
  judge: BattleJudge
): Promise<BattleJudgeSummary[]> {
  const isAdmin = isVerificationAdminEmail(actor.email);
  const now = Date.now();
  let nextJudges: BattleJudgeSummary[] = [];

  await runTransaction(db, async (tx) => {
    const ref = doc(db, "battles", battleId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Battle not found.");
    const data = snap.data() as Battle;

    if (data.creatorId !== actor.uid && !isAdmin) {
      throw new Error("Only the battle host or an admin can assign judges.");
    }
    if (judge.uid === data.creatorId || judge.uid === data.opponentId) {
      throw new Error("Competitors cannot judge their own battle.");
    }
    if (data.status === "completed" || data.status === "cancelled") {
      throw new Error("Cannot assign judges to a finished battle.");
    }

    const existingJudges = Array.isArray(data.judges) ? data.judges : [];
    if (existingJudges.some((j) => j.uid === judge.uid)) {
      nextJudges = existingJudges;
      return;
    }
    if (existingJudges.length >= 3) {
      throw new Error("Maximum of 3 verified judges can be assigned per battle.");
    }

    const summary: BattleJudgeSummary = {
      uid: judge.uid,
      name: judge.name,
      username: judge.username || "",
      photoUrl: judge.photoUrl || "",
      specialty: judge.categories?.[0] || "Arena Judge",
      submitted: false,
    };

    nextJudges = [...existingJudges, summary];
    const nextJudgeIds = Array.from(new Set([...(data.judgeIds || []), judge.uid]));

    tx.update(ref, {
      judges: nextJudges,
      judgeIds: nextJudgeIds,
      updatedAtMs: now,
    });
  });

  void sendBattleNotification({
    targetUserId: judge.uid,
    type: "battle_judge_assigned",
    title: "Assigned as Official Battle Judge",
    body: "You were assigned to evaluate a live Skill Battle.",
    battleId,
    senderId: actor.uid,
    senderName: actor.fullName,
    senderPhoto: actor.photoUrl,
  });

  return nextJudges;
}

export async function finalizeBattleResult(
  battleId: string,
  actor: BattleUserActor
): Promise<BattleResult> {
  const settings = await fetchBattleSettings();
  const rewardCfg: BattleRewardConfig = settings.rewards;

  // Pre-fetch battle & judge scores safely for server verification
  const [preBattleSnap, scoresSnap] = await Promise.all([
    getDoc(doc(db, "battles", battleId)),
    getDocs(query(collection(db, "battleScores"), where("battleId", "==", battleId), limit(10))),
  ]);
  const preBattle = preBattleSnap.exists() ? (preBattleSnap.data() as Battle) : null;
  const judgeScores = scoresSnap.docs.map((d) => d.data() as BattleScore);

  // Attempt server-authoritative computation & persistence first
  try {
    const { auth } = await import("../firebase");
    const { getApiUrl } = await import("../utils/apiConfig");
    const idToken = await auth.currentUser?.getIdToken().catch(() => "");
    if (idToken && preBattle) {
      const resp = await fetch(getApiUrl(`/api/battles/${encodeURIComponent(battleId)}/finalize`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          battleSnapshot: preBattle,
          scoresSnapshot: judgeScores,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.adminPersisted && data?.result) {
          const finalRes = data.result as BattleResult;
          if (!data.alreadyFinalized) {
            const targets = [
              preBattle.creatorId,
              preBattle.opponentId,
              ...(preBattle.judgeIds || []),
            ].filter(Boolean) as string[];
            if (targets.length > 0) {
              void notifyBattleUsers(targets, {
                type: "battle_result",
                title: finalRes.isDraw
                  ? `Battle Draw: ${finalRes.battleTitle}`
                  : `Winner Announced: ${finalRes.winnerName}!`,
                body: `Final Score ${finalRes.finalScoreA} vs ${finalRes.finalScoreB} in "${finalRes.battleTitle}".`,
                battleId,
                senderId: actor.uid,
                senderName: actor.fullName,
                senderPhoto: actor.photoUrl,
              });
            }
          }
          return finalRes;
        }
      } else if (resp.status === 403 || resp.status === 400) {
        const errPayload = await resp.json().catch(() => ({}));
        if (errPayload?.error) {
          throw new Error(errPayload.error);
        }
      }
    }
  } catch (serverErr: any) {
    if (
      serverErr?.message?.includes("Forbidden") ||
      serverErr?.message?.includes("Cannot finalize") ||
      serverErr?.message?.includes("assigned judge")
    ) {
      throw serverErr;
    }
    // Proceed cleanly to atomic Firestore transaction fallback when server Admin SDK lacks IAM on Starter Tier
  }

  const now = Date.now();
  let publishedResult!: BattleResult;
  let notifyTargets: string[] = [];

  await runTransaction(db, async (tx) => {
    const battleRef = doc(db, "battles", battleId);
    const resultRef = doc(db, "battleResults", battleId);

    const [battleSnap, resultSnap] = await Promise.all([
      tx.get(battleRef),
      tx.get(resultRef),
    ]);

    if (!battleSnap.exists()) throw new Error("Battle not found.");
    const battle = battleSnap.data() as Battle;

    if (resultSnap.exists()) {
      publishedResult = resultSnap.data() as BattleResult;
      return;
    }

    const isAdmin = isVerificationAdminEmail(actor.email);
    const isAuthorized =
      isAdmin ||
      battle.creatorId === actor.uid ||
      battle.opponentId === actor.uid ||
      battle.judgeIds?.includes(actor.uid);

    if (!isAuthorized) {
      throw new Error("Unauthorized to finalize this battle.");
    }
    if (!battle.opponentId || !battle.competitorB) {
      throw new Error("Cannot finalize a battle without two competitors.");
    }

    if (
      battle.judgingMethod === "human_judges" &&
      battle.judgeIds?.length > 0 &&
      judgeScores.length === 0 &&
      !isAdmin
    ) {
      throw new Error("At least one assigned judge must submit their scorecard before finalizing.");
    }

    const profileARef = doc(db, "battleProfiles", battle.creatorId);
    const profileBRef = doc(db, "battleProfiles", battle.opponentId);
    const [profASnap, profBSnap] = await Promise.all([
      tx.get(profileARef),
      tx.get(profileBRef),
    ]);

    const profA: BattleProfile = profASnap.exists()
      ? (profASnap.data() as BattleProfile)
      : buildEmptyBattleProfile({
          uid: battle.creatorId,
          fullName: battle.creatorName,
          username: battle.creatorUsername,
          photoUrl: battle.creatorPhoto,
        });

    const profB: BattleProfile = profBSnap.exists()
      ? (profBSnap.data() as BattleProfile)
      : buildEmptyBattleProfile({
          uid: battle.opponentId,
          fullName: battle.opponentName || "Challenger",
          username: battle.opponentUsername,
          photoUrl: battle.opponentPhoto,
        });

    const { autoScoreA, autoScoreB } = computeAutomaticScores(
      battle,
      rewardCfg.audienceWeightInHybridPercent
    );

    let judgeAvgA = 0;
    let judgeAvgB = 0;
    if (judgeScores.length > 0) {
      judgeAvgA =
        Math.round(
          (judgeScores.reduce((s, sc) => s + sc.weightedTotalA, 0) / judgeScores.length) * 10
        ) / 10;
      judgeAvgB =
        Math.round(
          (judgeScores.reduce((s, sc) => s + sc.weightedTotalB, 0) / judgeScores.length) * 10
        ) / 10;
    }

    let finalScoreA = autoScoreA;
    let finalScoreB = autoScoreB;

    if (battle.judgingMethod === "human_judges" && judgeScores.length > 0) {
      finalScoreA = judgeAvgA;
      finalScoreB = judgeAvgB;
    } else if (battle.judgingMethod === "hybrid") {
      if (judgeScores.length > 0) {
        finalScoreA = Math.round((judgeAvgA * 0.65 + autoScoreA * 0.35) * 10) / 10;
        finalScoreB = Math.round((judgeAvgB * 0.65 + autoScoreB * 0.35) * 10) / 10;
      }
    }

    const diff = Math.abs(finalScoreA - finalScoreB);
    const isDraw = diff < 0.05;
    const slotAWins = !isDraw && finalScoreA > finalScoreB;

    const winnerId = isDraw ? null : slotAWins ? battle.creatorId : battle.opponentId;
    const winnerName = isDraw
      ? "Draw Match"
      : slotAWins
      ? battle.competitorA.name
      : battle.competitorB.name;
    const runnerUpId = isDraw ? null : slotAWins ? battle.opponentId : battle.creatorId;
    const runnerUpName = isDraw
      ? ""
      : slotAWins
      ? battle.competitorB.name
      : battle.competitorA.name;

    const criteria = battle.criteria?.length ? battle.criteria : DEFAULT_BATTLE_CRITERIA;
    const criteriaBreakdown: BattleCriterionBreakdown[] = criteria.map((c) => {
      if (judgeScores.length > 0) {
        const avgA =
          judgeScores.reduce((sum, s) => sum + Number(s.competitorAScores[c.id] ?? 0), 0) /
          judgeScores.length;
        const avgB =
          judgeScores.reduce((sum, s) => sum + Number(s.competitorBScores[c.id] ?? 0), 0) /
          judgeScores.length;
        return {
          criterionId: c.id,
          label: c.label,
          weight: c.weight,
          scoreA: Math.round(avgA * 10) / 10,
          scoreB: Math.round(avgB * 10) / 10,
        };
      }
      return {
        criterionId: c.id,
        label: c.label,
        weight: c.weight,
        scoreA: Math.round((autoScoreA / 10) * 10) / 10,
        scoreB: Math.round((autoScoreB / 10) * 10) / 10,
      };
    });

    const calcBadgesAndStats = (
      profile: BattleProfile,
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
      const badgesSet = new Set(profile.badges || []);
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
      const historyEntry: BattleRecentHistoryEntry = {
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

      const updatedProfile: BattleProfile = {
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
      };

      return { xpEarned, unlockedHere, updatedProfile };
    };

    const resA = calcBadgesAndStats(
      profA,
      isDraw ? "draw" : slotAWins ? "win" : "loss",
      finalScoreA,
      finalScoreB,
      battle.competitorB.name
    );
    const resB = calcBadgesAndStats(
      profB,
      isDraw ? "draw" : slotAWins ? "loss" : "win",
      finalScoreB,
      finalScoreA,
      battle.competitorA.name
    );

    publishedResult = {
      id: battle.id,
      battleId: battle.id,
      battleTitle: battle.title,
      category: battle.category,
      customSkill: battle.customSkill,
      judgingMethod: battle.judgingMethod,
      creatorId: battle.creatorId,
      opponentId: battle.opponentId,
      competitorAName: battle.competitorA.name,
      competitorAPhoto: battle.competitorA.photoUrl || "",
      competitorBName: battle.competitorB.name,
      competitorBPhoto: battle.competitorB.photoUrl || "",
      winnerId,
      winnerName,
      runnerUpId,
      runnerUpName,
      isDraw,
      finalScoreA,
      finalScoreB,
      judgeScoreA: judgeAvgA,
      judgeScoreB: judgeAvgB,
      autoScoreA,
      autoScoreB,
      audienceVotesA: battle.audienceVotesA || 0,
      audienceVotesB: battle.audienceVotesB || 0,
      criteriaBreakdown,
      judgeFeedbacks: judgeScores.map((s) => ({
        judgeId: s.judgeId,
        judgeName: s.judgeName,
        feedbackA: s.feedbackA,
        feedbackB: s.feedbackB,
        overallNote: s.overallNote,
      })),
      xpAwardedWinner: isDraw ? rewardCfg.drawXp : Math.max(resA.xpEarned, resB.xpEarned),
      xpAwardedParticipant: rewardCfg.participantBaseXp,
      badgesUnlocked: {
        [battle.creatorId]: resA.unlockedHere,
        [battle.opponentId]: resB.unlockedHere,
      },
      publishedBy: actor.uid,
      publishedAtMs: now,
    };

    tx.set(resultRef, publishedResult);
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

    tx.set(profileARef, resA.updatedProfile);
    tx.set(profileBRef, resB.updatedProfile);

    const rewardA: BattleReward = {
      id: `${battle.id}_${battle.creatorId}`,
      battleId: battle.id,
      battleTitle: battle.title,
      userId: battle.creatorId,
      role: isDraw ? "draw" : slotAWins ? "winner" : "runner_up",
      xpEarned: resA.xpEarned,
      badgesGranted: resA.unlockedHere,
      category: battle.category,
      createdAtMs: now,
    };
    const rewardB: BattleReward = {
      id: `${battle.id}_${battle.opponentId}`,
      battleId: battle.id,
      battleTitle: battle.title,
      userId: battle.opponentId,
      role: isDraw ? "draw" : slotAWins ? "runner_up" : "winner",
      xpEarned: resB.xpEarned,
      badgesGranted: resB.unlockedHere,
      category: battle.category,
      createdAtMs: now,
    };
    tx.set(doc(db, "battleRewards", rewardA.id), rewardA);
    tx.set(doc(db, "battleRewards", rewardB.id), rewardB);

    notifyTargets = [
      battle.creatorId,
      battle.opponentId,
      ...(battle.judgeIds || []),
    ].filter(Boolean);
  });

  if (notifyTargets.length > 0 && publishedResult) {
    void notifyBattleUsers(notifyTargets, {
      type: "battle_result",
      title: publishedResult.isDraw
        ? `Battle Draw: ${publishedResult.battleTitle}`
        : `Winner Announced: ${publishedResult.winnerName}!`,
      body: `Final Score ${publishedResult.finalScoreA} vs ${publishedResult.finalScoreB} in "${publishedResult.battleTitle}".`,
      battleId,
      senderId: actor.uid,
      senderName: actor.fullName,
      senderPhoto: actor.photoUrl,
    });
  }

  return publishedResult;
}

export async function castBattleVote(
  battleId: string,
  voter: BattleUserActor,
  slot: "A" | "B",
  votedForUserId: string
): Promise<BattleVote> {
  const suspension = await checkUserBattleSuspension(voter.uid);
  if (suspension?.active) {
    throw new Error("Suspended users cannot vote in battles.");
  }

  const voteId = `${battleId}_${voter.uid}`;
  const now = Date.now();

  const voteDoc: BattleVote = {
    id: voteId,
    battleId,
    voterId: voter.uid,
    voterName: voter.fullName,
    votedForUserId,
    votedForSlot: slot,
    createdAtMs: now,
  };

  await runTransaction(db, async (tx) => {
    const battleRef = doc(db, "battles", battleId);
    const voteRef = doc(db, "battleVotes", voteId);

    const [battleSnap, voteSnap] = await Promise.all([
      tx.get(battleRef),
      tx.get(voteRef),
    ]);

    if (!battleSnap.exists()) throw new Error("Battle not found.");
    const battle = battleSnap.data() as Battle;

    if (!battle.allowAudienceVoting) {
      throw new Error("Audience voting is disabled for this battle.");
    }
    if (battle.status !== "live" && battle.status !== "judging") {
      throw new Error("Audience voting is only open while the battle is live or being judged.");
    }
    if (voteSnap.exists()) {
      throw new Error("You have already cast your official audience vote for this battle.");
    }

    tx.set(voteRef, voteDoc);
    tx.update(battleRef, {
      ...(slot === "A"
        ? { audienceVotesA: increment(1) }
        : { audienceVotesB: increment(1) }),
      updatedAtMs: now,
    });
  });

  return voteDoc;
}

export async function getUserBattleVote(
  battleId: string,
  userId: string
): Promise<BattleVote | null> {
  if (!battleId || !userId) return null;
  try {
    const snap = await getDoc(doc(db, "battleVotes", `${battleId}_${userId}`));
    return snap.exists() ? (snap.data() as BattleVote) : null;
  } catch (_) {
    return null;
  }
}

export async function sendBattleApplause(battleId: string): Promise<void> {
  try {
    await updateDoc(doc(db, "battles", battleId), {
      applauseCount: increment(1),
      updatedAtMs: Date.now(),
    });
  } catch (_) {}
}

export async function joinBattleViewer(
  battleId: string,
  user: BattleUserActor
): Promise<void> {
  if (!battleId || !user.uid) return;
  const viewerId = `${battleId}_${user.uid}`;
  const now = Date.now();
  try {
    await runTransaction(db, async (tx) => {
      const battleRef = doc(db, "battles", battleId);
      const viewerRef = doc(db, "battleViewers", viewerId);
      const [bSnap, vSnap] = await Promise.all([tx.get(battleRef), tx.get(viewerRef)]);
      if (!bSnap.exists()) return;

      const viewer: BattleViewer = {
        id: viewerId,
        battleId,
        userId: user.uid,
        userName: user.fullName,
        userPhoto: user.photoUrl || "",
        joinedAtMs: vSnap.exists() ? (vSnap.data() as BattleViewer).joinedAtMs : now,
        lastActiveAtMs: now,
      };
      tx.set(viewerRef, viewer);
      if (!vSnap.exists()) {
        tx.update(battleRef, {
          viewerCount: increment(1),
        });
      }
    });
  } catch (_) {}
}

export async function leaveBattleViewer(battleId: string, userId: string): Promise<void> {
  if (!battleId || !userId) return;
  const viewerId = `${battleId}_${userId}`;
  try {
    await runTransaction(db, async (tx) => {
      const battleRef = doc(db, "battles", battleId);
      const viewerRef = doc(db, "battleViewers", viewerId);
      const [bSnap, vSnap] = await Promise.all([tx.get(battleRef), tx.get(viewerRef)]);
      if (!vSnap.exists()) return;
      tx.delete(viewerRef);
      if (bSnap.exists()) {
        const curr = Number((bSnap.data() as Battle).viewerCount || 0);
        tx.update(battleRef, {
          viewerCount: Math.max(0, curr - 1),
        });
      }
    });
  } catch (_) {}
}

export async function postBattleComment(
  battleId: string,
  author: BattleUserActor,
  text: string,
  authorRole: BattleComment["authorRole"] = "spectator",
  reactionEmoji?: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await addDoc(collection(db, "battleComments"), {
    battleId,
    authorId: author.uid,
    authorName: author.fullName,
    authorPhoto: author.photoUrl || "",
    authorRole,
    text: trimmed.slice(0, 500),
    ...(reactionEmoji ? { reactionEmoji } : {}),
    createdAtMs: Date.now(),
  });
}

export function subscribeToBattleArena(
  battleId: string,
  callbacks: {
    onBattle: (battle: Battle | null) => void;
    onComments: (comments: BattleComment[]) => void;
    onScores: (scores: BattleScore[]) => void;
    onResult: (result: BattleResult | null) => void;
  }
): Unsubscribe {
  const unsubBattle = onSnapshot(
    doc(db, "battles", battleId),
    (snap) => {
      callbacks.onBattle(snap.exists() ? ({ ...(snap.data() as Battle), id: snap.id }) : null);
    },
    (err) => console.warn("[BattleArena] battle listener error:", err)
  );

  const qComments = query(
    collection(db, "battleComments"),
    where("battleId", "==", battleId),
    limit(60)
  );
  const unsubComments = onSnapshot(
    qComments,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ ...(d.data() as BattleComment), id: d.id }))
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
      callbacks.onComments(list);
    },
    (err) => console.warn("[BattleArena] comments listener error:", err)
  );

  const qScores = query(
    collection(db, "battleScores"),
    where("battleId", "==", battleId),
    limit(10)
  );
  const unsubScores = onSnapshot(
    qScores,
    (snap) => {
      callbacks.onScores(snap.docs.map((d) => ({ ...(d.data() as BattleScore), id: d.id })));
    },
    (err) => console.warn("[BattleArena] scores listener error:", err)
  );

  const unsubResult = onSnapshot(
    doc(db, "battleResults", battleId),
    (snap) => {
      callbacks.onResult(snap.exists() ? (snap.data() as BattleResult) : null);
    },
    () => {}
  );

  return () => {
    unsubBattle();
    unsubComments();
    unsubScores();
    unsubResult();
  };
}

export async function fetchBattleResult(battleId: string): Promise<BattleResult | null> {
  try {
    const snap = await getDoc(doc(db, "battleResults", battleId));
    return snap.exists() ? (snap.data() as BattleResult) : null;
  } catch (_) {
    return null;
  }
}

export async function submitBattleReport(input: {
  battleId: string;
  battleTitle: string;
  reporter: BattleUserActor;
  reportedUserId?: string;
  reportedUserName?: string;
  reason: BattleReport["reason"];
  details: string;
}): Promise<void> {
  const now = Date.now();
  await addDoc(collection(db, "battleReports"), {
    battleId: input.battleId,
    battleTitle: input.battleTitle,
    reporterId: input.reporter.uid,
    reporterName: input.reporter.fullName,
    reportedUserId: input.reportedUserId || "",
    reportedUserName: input.reportedUserName || "",
    reason: input.reason,
    details: input.details.trim().slice(0, 1000),
    status: "open",
    createdAtMs: now,
    updatedAtMs: now,
  });
}

export async function submitJudgeApplication(input: {
  user: BattleUserActor;
  categories: string[];
  yearsExperience: number;
  credentialsSummary: string;
  portfolioUrl?: string;
  statement: string;
}): Promise<BattleJudgeApplication> {
  const now = Date.now();
  const app: BattleJudgeApplication = {
    id: input.user.uid,
    userId: input.user.uid,
    name: input.user.fullName,
    username: input.user.username || "",
    photoUrl: input.user.photoUrl || "",
    categories: input.categories,
    yearsExperience: input.yearsExperience,
    credentialsSummary: input.credentialsSummary.trim(),
    portfolioUrl: input.portfolioUrl?.trim() || "",
    statement: input.statement.trim(),
    status: "pending",
    submittedAtMs: now,
    updatedAtMs: now,
  };

  await setDoc(doc(db, "battleJudgeApplications", input.user.uid), app);
  return app;
}

export async function fetchMyJudgeApplication(
  userId: string
): Promise<BattleJudgeApplication | null> {
  if (!userId) return null;
  try {
    const snap = await getDoc(doc(db, "battleJudgeApplications", userId));
    return snap.exists() ? (snap.data() as BattleJudgeApplication) : null;
  } catch (_) {
    return null;
  }
}

export async function fetchJudgeAssignedBattles(judgeId: string): Promise<Battle[]> {
  if (!judgeId) return [];
  try {
    const q = query(
      collection(db, "battles"),
      where("judgeIds", "array-contains", judgeId),
      limit(30)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ ...(d.data() as Battle), id: d.id }))
      .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  } catch (err) {
    console.warn("[BattleService] fetchJudgeAssignedBattles error:", err);
    return [];
  }
}

export async function fetchJudgeCompletedScores(judgeId: string): Promise<BattleScore[]> {
  if (!judgeId) return [];
  try {
    const q = query(
      collection(db, "battleScores"),
      where("judgeId", "==", judgeId),
      limit(30)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ ...(d.data() as BattleScore), id: d.id }))
      .sort((a, b) => (b.submittedAtMs || 0) - (a.submittedAtMs || 0));
  } catch (_) {
    return [];
  }
}

export async function fetchBattleLeaderboard(
  categoryFilter?: string,
  pageLimit = 25
): Promise<BattleProfile[]> {
  try {
    const q = query(
      collection(db, "battleProfiles"),
      orderBy("battleXp", "desc"),
      limit(pageLimit)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as BattleProfile);
    if (!categoryFilter || categoryFilter === "all") return list;
    return list.filter((p) => p.topCategories?.includes(categoryFilter));
  } catch (err) {
    console.warn("[BattleService] fetchBattleLeaderboard error:", err);
    return [];
  }
}

// ==========================================
// ADMIN OPERATIONS (Strictly Admin Verified)
// ==========================================

export async function adminFetchOverviewData(): Promise<{
  battles: Battle[];
  applications: BattleJudgeApplication[];
  judges: BattleJudge[];
  reports: BattleReport[];
  suspensions: BattleSuspension[];
  settings: BattleSettings;
}> {
  const [battlesSnap, appsSnap, judgesSnap, reportsSnap, suspSnap, settings] =
    await Promise.all([
      getDocs(query(collection(db, "battles"), orderBy("updatedAtMs", "desc"), limit(50))),
      getDocs(query(collection(db, "battleJudgeApplications"), limit(50))),
      getDocs(query(collection(db, "battleJudges"), limit(50))),
      getDocs(query(collection(db, "battleReports"), limit(50))),
      getDocs(query(collection(db, "battleSuspensions"), limit(50))),
      fetchBattleSettings(),
    ]);

  return {
    battles: battlesSnap.docs.map((d) => ({ ...(d.data() as Battle), id: d.id })),
    applications: appsSnap.docs
      .map((d) => ({ ...(d.data() as BattleJudgeApplication), id: d.id }))
      .sort((a, b) => (b.submittedAtMs || 0) - (a.submittedAtMs || 0)),
    judges: judgesSnap.docs.map((d) => ({ ...(d.data() as BattleJudge), uid: d.id })),
    reports: reportsSnap.docs
      .map((d) => ({ ...(d.data() as BattleReport), id: d.id }))
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)),
    suspensions: suspSnap.docs.map((d) => ({ ...(d.data() as BattleSuspension), uid: d.id })),
    settings,
  };
}

export async function adminReviewJudgeApplication(input: {
  application: BattleJudgeApplication;
  approve: boolean;
  adminEmail: string;
  rejectionReason?: string;
}): Promise<void> {
  const { application, approve, adminEmail, rejectionReason } = input;
  const now = Date.now();
  const batch = writeBatch(db);

  batch.update(doc(db, "battleJudgeApplications", application.userId), {
    status: approve ? "approved" : "rejected",
    reviewedBy: adminEmail,
    reviewedAtMs: now,
    updatedAtMs: now,
    ...(rejectionReason ? { rejectionReason: rejectionReason.trim() } : {}),
  });

  if (approve) {
    const judgeRecord: BattleJudge = {
      uid: application.userId,
      name: application.name,
      username: application.username || "",
      photoUrl: application.photoUrl || "",
      categories: application.categories,
      bio: application.credentialsSummary,
      portfolioUrl: application.portfolioUrl || "",
      yearsExperience: application.yearsExperience,
      status: "active",
      battlesJudged: 0,
      averageAccuracyScore: 100,
      approvedBy: adminEmail,
      approvedAtMs: now,
      updatedAtMs: now,
    };
    batch.set(doc(db, "battleJudges", application.userId), judgeRecord);

    const existingProf = await fetchBattleProfile(application.userId, {
      fullName: application.name,
      username: application.username,
      photoUrl: application.photoUrl,
    });
    const nextBadges = Array.from(new Set([...(existingProf.badges || []), "verified_judge"]));
    batch.set(doc(db, "battleProfiles", application.userId), {
      ...existingProf,
      isVerifiedJudge: true,
      badges: nextBadges,
      updatedAtMs: now,
    });
  }

  await batch.commit();

  void sendBattleNotification({
    targetUserId: application.userId,
    type: approve ? "battle_judge_approved" : "battle_judge_rejected",
    title: approve
      ? "Verified Skill Battle Judge Approved!"
      : "Judge Application Update",
    body: approve
      ? "Congratulations! You are now a verified SwapSkill Arena Judge."
      : `Your judge application was not approved${rejectionReason ? `: ${rejectionReason}` : "."}`,
    senderName: "SwapSkill Arena Governance",
  });
}

export async function adminRevokeJudge(judgeId: string): Promise<void> {
  const now = Date.now();
  const batch = writeBatch(db);
  batch.update(doc(db, "battleJudges", judgeId), {
    status: "revoked",
    updatedAtMs: now,
  });
  batch.set(
    doc(db, "battleProfiles", judgeId),
    {
      isVerifiedJudge: false,
      updatedAtMs: now,
    },
    { merge: true }
  );
  await batch.commit();
}

export async function adminToggleFeatureBattle(
  battleId: string,
  featured: boolean
): Promise<void> {
  await updateDoc(doc(db, "battles", battleId), {
    featured,
    updatedAtMs: Date.now(),
  });
}

export async function adminCancelBattle(
  battleId: string,
  reason = "Cancelled by platform administrator"
): Promise<void> {
  await updateDoc(doc(db, "battles", battleId), {
    status: "cancelled",
    cancelReason: reason,
    updatedAtMs: Date.now(),
  });
}

export async function adminDeleteBattle(battleId: string): Promise<void> {
  await deleteDoc(doc(db, "battles", battleId));
}

export async function adminResolveBattleReport(input: {
  reportId: string;
  status: BattleReport["status"];
  adminEmail: string;
  adminNote?: string;
}): Promise<void> {
  await updateDoc(doc(db, "battleReports", input.reportId), {
    status: input.status,
    resolvedBy: input.adminEmail,
    adminNote: input.adminNote?.trim() || "",
    updatedAtMs: Date.now(),
  });
}

export async function adminSetBattleSuspension(input: {
  uid: string;
  userName?: string;
  active: boolean;
  reason: string;
  adminEmail: string;
}): Promise<void> {
  const now = Date.now();
  const batch = writeBatch(db);
  const record: BattleSuspension = {
    uid: input.uid,
    userName: input.userName || "User",
    reason: input.reason.trim(),
    active: input.active,
    suspendedBy: input.adminEmail,
    createdAtMs: now,
    updatedAtMs: now,
  };
  batch.set(doc(db, "battleSuspensions", input.uid), record);
  batch.set(
    doc(db, "battleProfiles", input.uid),
    {
      suspendedFromBattles: input.active,
      suspensionReason: input.active ? input.reason.trim() : "",
      updatedAtMs: now,
    },
    { merge: true }
  );
  await batch.commit();
}

export async function adminUpdateBattleSettings(input: {
  categories: BattleCategoryItem[];
  rewards: BattleRewardConfig;
  adminEmail: string;
}): Promise<void> {
  await setDoc(doc(db, "battleSettings", "config"), {
    id: "config",
    categories: input.categories,
    rewards: input.rewards,
    updatedBy: input.adminEmail,
    updatedAtMs: Date.now(),
  } satisfies BattleSettings);
}
