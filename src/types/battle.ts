export type BattleStatus =
  | "pending_invite"
  | "open"
  | "upcoming"
  | "live"
  | "judging"
  | "completed"
  | "cancelled";

export type BattleVisibility = "public" | "private";
export type BattleMode = "direct" | "open";
export type BattleJudgingMethod = "automatic" | "human_judges" | "hybrid";

export interface BattleCriterion {
  id: string;
  label: string;
  weight: number; // Percentage weight summing to 100
  maxScore: number; // Default 10
  description?: string;
}

export interface BattleCompetitorSummary {
  uid: string;
  name: string;
  username?: string;
  photoUrl?: string;
  verified?: boolean;
  battleXp?: number;
  wins?: number;
  losses?: number;
  ready?: boolean;
  micActive?: boolean;
  camActive?: boolean;
  screenSharing?: boolean;
  stageSummary?: string;
  submissionLink?: string;
  codeSnippet?: string;
}

export interface BattleJudgeSummary {
  uid: string;
  name: string;
  username?: string;
  photoUrl?: string;
  specialty?: string;
  submitted?: boolean;
}

export interface Battle {
  id: string;
  title: string;
  description: string;
  category: string;
  customSkill: string;
  mode: BattleMode;
  visibility: BattleVisibility;
  status: BattleStatus;
  judgingMethod: BattleJudgingMethod;
  allowAudienceVoting: boolean;
  featured: boolean;
  durationMinutes: number;
  scheduledAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;

  creatorId: string;
  creatorName: string;
  creatorUsername?: string;
  creatorPhoto?: string;
  creatorVerified?: boolean;

  opponentId?: string;
  opponentName?: string;
  opponentUsername?: string;
  opponentPhoto?: string;
  opponentVerified?: boolean;
  inviteStatus?: "pending" | "accepted" | "declined" | "open_filled";

  participantIds: string[];
  judgeIds: string[];
  judges: BattleJudgeSummary[];

  competitorA: BattleCompetitorSummary;
  competitorB?: BattleCompetitorSummary | null;

  rules: string[];
  criteria: BattleCriterion[];
  entryRequirements?: {
    minXp?: number;
    verifiedOnly?: boolean;
    requiredSkill?: string;
  };

  thumbnailUrl?: string;
  callId: string;

  viewerCount: number;
  applauseCount: number;
  audienceVotesA: number;
  audienceVotesB: number;
  autoMetricsA?: {
    stageActivityScore: number;
    completionScore: number;
    audienceEngagementScore: number;
    total: number;
  };
  autoMetricsB?: {
    stageActivityScore: number;
    completionScore: number;
    audienceEngagementScore: number;
    total: number;
  };

  winnerId?: string;
  winnerName?: string;
  isDraw?: boolean;
  finalScoreA?: number;
  finalScoreB?: number;
  cancelReason?: string;
}

export interface BattleParticipant {
  id: string; // `${battleId}_${userId}`
  battleId: string;
  userId: string;
  role: "creator" | "opponent";
  name: string;
  username?: string;
  photoUrl?: string;
  ready: boolean;
  joinedArenaAtMs?: number;
  submissionNote?: string;
  submissionUrl?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface BattleViewer {
  id: string; // `${battleId}_${userId}`
  battleId: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  joinedAtMs: number;
  lastActiveAtMs: number;
}

export interface BattleVote {
  id: string; // `${battleId}_${voterId}`
  battleId: string;
  voterId: string;
  voterName: string;
  votedForUserId: string;
  votedForSlot: "A" | "B";
  createdAtMs: number;
}

export interface BattleJudge {
  uid: string;
  name: string;
  username?: string;
  photoUrl?: string;
  categories: string[];
  bio: string;
  portfolioUrl?: string;
  yearsExperience: number;
  status: "active" | "revoked";
  battlesJudged: number;
  averageAccuracyScore: number;
  approvedBy: string;
  approvedAtMs: number;
  updatedAtMs: number;
}

export interface BattleJudgeApplication {
  id: string; // uid
  userId: string;
  name: string;
  username?: string;
  photoUrl?: string;
  categories: string[];
  yearsExperience: number;
  credentialsSummary: string;
  portfolioUrl?: string;
  statement: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string;
  reviewedBy?: string;
  submittedAtMs: number;
  reviewedAtMs?: number;
  updatedAtMs: number;
}

export interface BattleScore {
  id: string; // `${battleId}_${judgeId}`
  battleId: string;
  judgeId: string;
  judgeName: string;
  judgePhoto?: string;
  competitorAScores: Record<string, number>;
  competitorBScores: Record<string, number>;
  weightedTotalA: number;
  weightedTotalB: number;
  feedbackA: string;
  feedbackB: string;
  overallNote?: string;
  submittedAtMs: number;
  locked: boolean;
}

export interface BattleCriterionBreakdown {
  criterionId: string;
  label: string;
  weight: number;
  scoreA: number;
  scoreB: number;
}

export interface BattleResult {
  id: string; // battleId
  battleId: string;
  battleTitle: string;
  category: string;
  customSkill: string;
  judgingMethod: BattleJudgingMethod;
  creatorId: string;
  opponentId: string;
  competitorAName: string;
  competitorAPhoto?: string;
  competitorBName: string;
  competitorBPhoto?: string;
  winnerId: string | null;
  winnerName: string;
  runnerUpId: string | null;
  runnerUpName: string;
  isDraw: boolean;
  finalScoreA: number;
  finalScoreB: number;
  judgeScoreA: number;
  judgeScoreB: number;
  autoScoreA: number;
  autoScoreB: number;
  audienceVotesA: number;
  audienceVotesB: number;
  criteriaBreakdown: BattleCriterionBreakdown[];
  judgeFeedbacks: Array<{
    judgeId: string;
    judgeName: string;
    feedbackA: string;
    feedbackB: string;
    overallNote?: string;
  }>;
  xpAwardedWinner: number;
  xpAwardedParticipant: number;
  badgesUnlocked: Record<string, string[]>;
  publishedBy: string;
  publishedAtMs: number;
}

export interface BattleReport {
  id: string;
  battleId: string;
  battleTitle: string;
  reporterId: string;
  reporterName: string;
  reportedUserId?: string;
  reportedUserName?: string;
  reason: "misconduct" | "cheating" | "spam" | "inappropriate_content" | "scoring_dispute";
  details: string;
  status: "open" | "reviewed" | "dismissed" | "action_taken";
  adminNote?: string;
  resolvedBy?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface BattleReward {
  id: string; // `${battleId}_${userId}`
  battleId: string;
  battleTitle: string;
  userId: string;
  role: "winner" | "runner_up" | "draw" | "judge";
  xpEarned: number;
  badgesGranted: string[];
  category: string;
  createdAtMs: number;
}

export type BattleNetworkQuality = "excellent" | "good" | "poor" | "unknown";

export interface BattleRoundState {
  index: number;
  total: number;
  title?: string;
  durationSecs?: number;
  startedAtMs?: number;
  countdownTargetMs?: number;
}

export interface BattleCommentReplyRef {
  id: string;
  authorName: string;
  text: string;
}

export interface BattleComment {
  id: string;
  clientMsgId?: string;
  battleId: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  authorRole?: "competitor" | "judge" | "spectator" | "admin";
  text: string;
  reactionEmoji?: string;
  replyTo?: BattleCommentReplyRef;
  reactions?: Record<string, string[]>;
  deleted?: boolean;
  deliveryStatus?: "sending" | "sent" | "failed";
  createdAtMs: number;
}

export interface BattleRecentHistoryEntry {
  battleId: string;
  title: string;
  category: string;
  opponentName: string;
  outcome: "win" | "loss" | "draw";
  score: number;
  opponentScore: number;
  xpEarned: number;
  completedAtMs: number;
}

export interface BattleProfile {
  uid: string;
  fullName: string;
  username?: string;
  photoUrl?: string;
  battleXp: number;
  totalBattles: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  topCategories: string[];
  badges: string[];
  isVerifiedJudge: boolean;
  suspendedFromBattles: boolean;
  suspensionReason?: string;
  recentBattles: BattleRecentHistoryEntry[];
  lastBattleId?: string;
  updatedAtMs: number;
}

export interface BattleCategoryItem {
  id: string;
  name: string;
  description: string;
  accentColor: string;
  enabled: boolean;
}

export interface BattleRewardConfig {
  winnerBaseXp: number;
  participantBaseXp: number;
  drawXp: number;
  judgeBonusXp: number;
  streakBonusXp: number;
  allowAudienceVotingDefault: boolean;
  audienceWeightInHybridPercent: number;
}

export interface BattleSettings {
  id: string; // "config"
  categories: BattleCategoryItem[];
  rewards: BattleRewardConfig;
  updatedBy: string;
  updatedAtMs: number;
}

export interface BattleSuspension {
  uid: string;
  userName?: string;
  reason: string;
  active: boolean;
  suspendedBy: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export const DEFAULT_BATTLE_CATEGORIES: BattleCategoryItem[] = [
  {
    id: "coding",
    name: "Coding & Algorithms",
    description: "Live coding, debugging, system architecture & frontend sprints",
    accentColor: "#38BDF8",
    enabled: true,
  },
  {
    id: "design",
    name: "UI/UX & Visual Design",
    description: "Rapid product design, wireframing, brand identity & Figma craft",
    accentColor: "#C9A96E",
    enabled: true,
  },
  {
    id: "music",
    name: "Music & Production",
    description: "Live beatmaking, vocal improvisation, guitar & audio mixing",
    accentColor: "#A855F7",
    enabled: true,
  },
  {
    id: "speaking",
    name: "Debate & Pitching",
    description: "Public speaking, startup pitching, storytelling & persuasion",
    accentColor: "#F59E0B",
    enabled: true,
  },
  {
    id: "languages",
    name: "Language Fluency",
    description: "Live translation sprints, pronunciation & conversational mastery",
    accentColor: "#10B981",
    enabled: true,
  },
  {
    id: "ai_prompting",
    name: "AI Engineering & Prompts",
    description: "Workflow automation, prompt craft & creative AI tool mastery",
    accentColor: "#EC4899",
    enabled: true,
  },
  {
    id: "business",
    name: "Marketing & Strategy",
    description: "Growth playbooks, copywriting sprints & product strategy",
    accentColor: "#6366F1",
    enabled: true,
  },
];

export const DEFAULT_BATTLE_CRITERIA: BattleCriterion[] = [
  {
    id: "execution",
    label: "Technical Execution",
    weight: 40,
    maxScore: 10,
    description: "Accuracy, craft quality, and completeness within time limit",
  },
  {
    id: "creativity",
    label: "Creativity & Originality",
    weight: 30,
    maxScore: 10,
    description: "Unique approach, polish, and problem-solving elegance",
  },
  {
    id: "clarity",
    label: "Presentation & Clarity",
    weight: 30,
    maxScore: 10,
    description: "Live communication, confidence, and demonstration clarity",
  },
];

export const DEFAULT_BATTLE_REWARD_CONFIG: BattleRewardConfig = {
  winnerBaseXp: 250,
  participantBaseXp: 90,
  drawXp: 140,
  judgeBonusXp: 60,
  streakBonusXp: 40,
  allowAudienceVotingDefault: true,
  audienceWeightInHybridPercent: 20,
};

export const BATTLE_BADGE_CATALOG: Record<string, { label: string; description: string }> = {
  first_victory: {
    label: "First Blood Victory",
    description: "Won your first Skill Battle in the Arena",
  },
  win_streak_3: {
    label: "3x Streak Champion",
    description: "Achieved 3 consecutive Skill Battle victories",
  },
  veteran_5: {
    label: "Arena Veteran",
    description: "Completed 5 official Skill Battles",
  },
  grandmaster_1000xp: {
    label: "1K Battle XP",
    description: "Earned 1,000+ competitive Battle XP",
  },
  verified_judge: {
    label: "Verified Arena Judge",
    description: "Approved by SwapSkill to evaluate official Skill Battles",
  },
};
