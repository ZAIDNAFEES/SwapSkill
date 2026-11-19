import React, { useEffect, useMemo, useState } from "react";
import {
  Swords,
  Search,
  Plus,
  Trophy,
  Scale,
  ShieldAlert,
  Clock,
  Eye,
  Globe,
  Lock,
  Sparkles,
  Check,
  X,
  Loader2,
  Flame,
  RefreshCw,
} from "lucide-react";
import {
  Battle,
  BattleCategoryItem,
  BattleProfile,
  BattleResult,
  DEFAULT_BATTLE_CATEGORIES,
} from "../../types/battle";
import { DEFAULT_AVATAR } from "../../types";
import {
  BattleUserActor,
  fetchBattleProfile,
  fetchBattleResult,
  fetchBattleSettings,
  fetchBattlesFeed,
  joinOpenBattle,
  respondToBattleInvite,
} from "../../services/battleService";
import { isVerificationAdminEmail } from "../../utils/verificationAdmin";
import { SmartImage } from "../SmartImage";
import { useBackHandler } from "../../utils/navigationManager";
import { CreateBattleModal } from "./CreateBattleModal";
import { LiveBattleArena } from "./LiveBattleArena";
import { BattleResultModal } from "./BattleResultModal";
import { JudgeApplicationModal } from "./JudgeApplicationModal";
import { JudgeDashboardView } from "./JudgeDashboardView";
import { BattleLeaderboardView } from "./BattleLeaderboardView";
import { BattleAdminPanel } from "./BattleAdminPanel";

interface SkillBattleHubProps {
  currentUser: BattleUserActor;
  initialBattleId?: string | null;
  onClearInitialBattle?: () => void;
  onViewProfile: (uid: string) => void;
}

type HubView = "home" | "leaderboard" | "judge" | "admin";
type BattleFilter = "all" | "live" | "upcoming" | "open" | "completed" | "public" | "private";

export const SkillBattleHub: React.FC<SkillBattleHubProps> = ({
  currentUser,
  initialBattleId,
  onClearInitialBattle,
  onViewProfile,
}) => {
  const [view, setView] = useState<HubView>("home");
  const [battles, setBattles] = useState<Battle[]>([]);
  const [categories, setCategories] = useState<BattleCategoryItem[]>(DEFAULT_BATTLE_CATEGORIES);
  const [myBattleProfile, setMyBattleProfile] = useState<BattleProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BattleFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJudgeAppModal, setShowJudgeAppModal] = useState(false);
  const [activeArenaBattle, setActiveArenaBattle] = useState<Battle | null>(null);
  const [selectedResult, setSelectedResult] = useState<BattleResult | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(12);
  const [busyBattleId, setBusyBattleId] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const isAdmin = isVerificationAdminEmail(currentUser.email);

  useBackHandler(
    view !== "home" &&
      !activeArenaBattle &&
      !showCreateModal &&
      !showJudgeAppModal &&
      !showResultModal,
    () => {
      setView("home");
    }
  );

  const loadHub = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [feed, settings, profile] = await Promise.all([
        fetchBattlesFeed({
          currentUserId: currentUser.uid,
          isAdmin,
          pageSize: 45,
        }),
        fetchBattleSettings(),
        fetchBattleProfile(currentUser.uid, currentUser),
      ]);
      setBattles(feed);
      setCategories(settings.categories);
      setMyBattleProfile(profile);

      if (initialBattleId) {
        const match = feed.find((b) => b.id === initialBattleId);
        if (match) {
          setActiveArenaBattle(match);
          onClearInitialBattle?.();
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!currentUser.uid) return;
    loadHub();
  }, [currentUser.uid]);

  useEffect(() => {
    if (!initialBattleId || battles.length === 0) return;
    const match = battles.find((b) => b.id === initialBattleId);
    if (match) {
      setActiveArenaBattle(match);
      onClearInitialBattle?.();
    }
  }, [initialBattleId, battles]);

  const showNotice = (msg: string) => {
    setBannerMsg(msg);
    setTimeout(() => setBannerMsg(null), 2800);
  };

  const pendingInvitesForMe = useMemo(
    () =>
      battles.filter(
        (b) => b.status === "pending_invite" && b.opponentId === currentUser.uid
      ),
    [battles, currentUser.uid]
  );

  const featuredBattles = useMemo(
    () => battles.filter((b) => b.featured && b.status !== "cancelled"),
    [battles]
  );

  const filteredBattles = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return battles.filter((b) => {
      if (b.status === "cancelled" && !isAdmin) return false;
      if (categoryFilter !== "all" && b.category !== categoryFilter) return false;
      if (statusFilter === "live" && b.status !== "live" && b.status !== "judging") return false;
      if (statusFilter === "upcoming" && b.status !== "upcoming" && b.status !== "pending_invite")
        return false;
      if (statusFilter === "open" && b.status !== "open") return false;
      if (statusFilter === "completed" && b.status !== "completed") return false;
      if (statusFilter === "public" && b.visibility !== "public") return false;
      if (statusFilter === "private" && b.visibility !== "private") return false;

      if (!term) return true;
      return (
        b.title.toLowerCase().includes(term) ||
        b.customSkill.toLowerCase().includes(term) ||
        b.category.toLowerCase().includes(term) ||
        b.creatorName.toLowerCase().includes(term) ||
        (b.creatorUsername || "").toLowerCase().includes(term) ||
        (b.opponentName || "").toLowerCase().includes(term)
      );
    });
  }, [battles, searchQuery, statusFilter, categoryFilter, isAdmin]);

  const liveBattles = useMemo(
    () => filteredBattles.filter((b) => b.status === "live" || b.status === "judging"),
    [filteredBattles]
  );
  const upcomingAndOpenBattles = useMemo(
    () =>
      filteredBattles.filter(
        (b) => b.status === "upcoming" || b.status === "open" || b.status === "pending_invite"
      ),
    [filteredBattles]
  );
  const completedBattles = useMemo(
    () => filteredBattles.filter((b) => b.status === "completed"),
    [filteredBattles]
  );

  const handleOpenResult = async (battle: Battle) => {
    setBusyBattleId(battle.id);
    try {
      const res = await fetchBattleResult(battle.id);
      if (res) {
        setSelectedResult(res);
        setShowResultModal(true);
      } else {
        setActiveArenaBattle(battle);
      }
    } finally {
      setBusyBattleId(null);
    }
  };

  const handleAcceptDecline = async (battle: Battle, accept: boolean) => {
    setBusyBattleId(battle.id);
    try {
      const updated = await respondToBattleInvite(battle.id, currentUser, accept);
      setBattles((prev) => prev.map((b) => (b.id === battle.id ? updated : b)));
      showNotice(accept ? `Challenge accepted! "${battle.title}" is now Upcoming.` : "Invite declined.");
    } catch (err: any) {
      showNotice(err?.message || "Could not update challenge invite");
    } finally {
      setBusyBattleId(null);
    }
  };

  const handleClaimOpenBattle = async (battle: Battle) => {
    setBusyBattleId(battle.id);
    try {
      const updated = await joinOpenBattle(battle.id, currentUser);
      setBattles((prev) => prev.map((b) => (b.id === battle.id ? updated : b)));
      setActiveArenaBattle(updated);
    } catch (err: any) {
      showNotice(err?.message || "Could not join open battle");
    } finally {
      setBusyBattleId(null);
    }
  };

  const renderBattleCard = (battle: Battle) => {
    const isLive = battle.status === "live";
    const canJoinOpen =
      battle.status === "open" &&
      battle.creatorId !== currentUser.uid &&
      !battle.opponentId;

    return (
      <div
        key={battle.id}
        className="w-full min-w-0 rounded-2xl bg-white border border-[#E8E4DB] overflow-hidden shadow-xs hover:border-[#C9A96E]/60 transition flex flex-col justify-between"
      >
        <div>
          {battle.thumbnailUrl && (
            <div className="h-32 w-full relative overflow-hidden bg-[#0D0D0F]">
              <img
                src={battle.thumbnailUrl}
                alt={battle.title}
                className="w-full h-full object-cover opacity-90"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            </div>
          )}

          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {isLive ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-extrabold uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    LIVE
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-[#EFECE4] text-[#0D0D0F] text-[10px] font-bold uppercase tracking-wider">
                    {battle.status.replace("_", " ")}
                  </span>
                )}
                <span className="text-[11px] font-semibold text-[#C9A96E] truncate max-w-[160px]">
                  {battle.customSkill}
                </span>
              </div>

              <span className="text-[11px] text-[#6B6760] flex items-center gap-1 shrink-0">
                {battle.visibility === "public" ? (
                  <Globe className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-amber-500" />
                )}
                <span className="capitalize">{battle.visibility}</span>
              </span>
            </div>

            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-[#0D0D0F] leading-snug line-clamp-2 break-words">
                {battle.title}
              </h3>
              {battle.description && (
                <p className="text-[12px] text-[#6B6760] mt-1 line-clamp-2 break-words">
                  {battle.description}
                </p>
              )}
            </div>

            {/* Competitors Faceoff Row */}
            <div className="p-2.5 rounded-xl bg-[#F7F4EE] flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <SmartImage
                  src={battle.competitorA.photoUrl || DEFAULT_AVATAR}
                  alt={battle.competitorA.name}
                  fallbackType="profile"
                  fullName={battle.competitorA.name}
                  className="w-7 h-7 rounded-full object-cover shrink-0"
                />
                <span className="text-[12px] font-semibold text-[#0D0D0F] truncate">
                  {battle.competitorA.name}
                </span>
              </div>

              <span className="text-[10px] font-black text-[#C9A96E] px-1.5 py-0.5 rounded bg-[#C9A96E]/15 shrink-0">
                VS
              </span>

              <div className="flex items-center justify-end gap-2 min-w-0 flex-1">
                <span className="text-[12px] font-semibold text-[#0D0D0F] truncate">
                  {battle.competitorB?.name || "Open Slot"}
                </span>
                {battle.competitorB ? (
                  <SmartImage
                    src={battle.competitorB.photoUrl || DEFAULT_AVATAR}
                    alt={battle.competitorB.name}
                    fallbackType="profile"
                    fullName={battle.competitorB.name}
                    className="w-7 h-7 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-[#C9A96E]/20 text-[#C9A96E] flex items-center justify-center shrink-0">
                    <Swords className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            </div>

            {/* Meta Metrics */}
            <div className="flex items-center justify-between gap-2 text-[11px] text-[#6B6760] tabular-nums">
              <span className="flex items-center gap-1 shrink-0">
                <Clock className="w-3.5 h-3.5 text-[#C9A96E]" />
                {battle.durationMinutes}m
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <Eye className="w-3.5 h-3.5 text-[#C9A96E]" />
                {battle.viewerCount || 0} watching
              </span>
              <span className="capitalize truncate">{battle.judgingMethod.replace("_", " ")}</span>
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="px-4 pb-4 flex items-center gap-2">
          {battle.status === "completed" ? (
            <>
              <button
                type="button"
                disabled={busyBattleId === battle.id}
                onClick={() => handleOpenResult(battle)}
                className="flex-1 min-h-[44px] rounded-xl bg-[#0D0D0F] text-white text-[12px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trophy className="w-4 h-4 text-[#C9A96E]" />
                <span>View Result</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveArenaBattle(battle)}
                className="min-h-[44px] px-3.5 rounded-xl bg-[#EFECE4] text-[#0D0D0F] text-[12px] font-semibold cursor-pointer shrink-0"
              >
                Replay
              </button>
            </>
          ) : canJoinOpen ? (
            <>
              <button
                type="button"
                disabled={busyBattleId === battle.id}
                onClick={() => handleClaimOpenBattle(battle)}
                className="flex-1 min-h-[44px] rounded-xl bg-[#C9A96E] text-[#0D0D0F] text-[12px] font-bold cursor-pointer"
              >
                Accept Challenge
              </button>
              <button
                type="button"
                onClick={() => setActiveArenaBattle(battle)}
                className="min-h-[44px] px-3.5 rounded-xl bg-[#EFECE4] text-[#0D0D0F] text-[12px] font-semibold cursor-pointer shrink-0"
              >
                Watch
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setActiveArenaBattle(battle)}
              className="w-full min-h-[44px] rounded-xl bg-[#0D0D0F] text-white text-[12px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Swords className="w-4 h-4 text-[#C9A96E]" />
              <span>{isLive ? "Enter Live Arena" : "Open Battle Room"}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full min-w-0 min-h-full bg-[#F7F4EE] text-[#0D0D0F] px-3.5 sm:px-6 pt-3 sm:pt-4 pb-24 max-w-6xl mx-auto overflow-x-hidden">
      {view === "leaderboard" && (
        <BattleLeaderboardView
          categories={categories}
          currentUserId={currentUser.uid}
          onBack={() => setView("home")}
          onViewProfile={onViewProfile}
        />
      )}

      {view === "judge" && (
        <JudgeDashboardView
          currentUser={currentUser}
          isVerifiedJudge={Boolean(myBattleProfile?.isVerifiedJudge)}
          onBack={() => setView("home")}
          onOpenBattle={(b) => setActiveArenaBattle(b)}
          onApplyJudge={() => setShowJudgeAppModal(true)}
        />
      )}

      {view === "admin" && isAdmin && (
        <BattleAdminPanel
          adminEmail={currentUser.email || "zaidnafees8321@gmail.com"}
          onBack={() => {
            setView("home");
            loadHub(true);
          }}
          onOpenBattle={(b) => setActiveArenaBattle(b)}
          onSettingsUpdated={() => loadHub(true)}
        />
      )}

      {view === "home" && (
        <div className="w-full min-w-0 space-y-5 sm:space-y-6">
          {/* Hero Header */}
          <div className="w-full min-w-0 rounded-[22px] sm:rounded-[24px] bg-[#0D0D0F] text-white p-4 sm:p-6 border border-[#C9A96E]/35 shadow-xl relative overflow-hidden">
            <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full bg-[#C9A96E]/10 blur-3xl pointer-events-none" />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10 min-w-0">
              <div className="space-y-1.5 min-w-0 max-w-xl">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#C9A96E]/15 text-[#C9A96E] text-[11px] font-bold uppercase tracking-wider max-w-full">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">SwapSkill Competitive Arena</span>
                </div>
                <h1 className="text-[22px] sm:text-[28px] font-black tracking-tight text-balance">
                  Skill Battles
                </h1>
                <p className="text-[13px] text-neutral-300 leading-relaxed break-words">
                  Challenge creators & mentors in live head-to-head skill duels, showcase your craft on camera or screen-share, earn Battle XP, and climb global rankings.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-2.5 w-full md:w-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="col-span-2 sm:col-span-1 min-h-[46px] px-4 sm:px-5 rounded-xl bg-[#C9A96E] hover:bg-[#b8975b] text-[#0D0D0F] text-[13px] font-bold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shadow-lg"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>Create Battle</span>
                </button>
                <button
                  type="button"
                  onClick={() => setView("leaderboard")}
                  className="min-h-[44px] px-3 sm:px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[12px] sm:text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap min-w-0"
                >
                  <Trophy className="w-4 h-4 text-[#C9A96E] shrink-0" />
                  <span className="truncate">Rankings</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    myBattleProfile?.isVerifiedJudge
                      ? setView("judge")
                      : setShowJudgeAppModal(true)
                  }
                  className="min-h-[44px] px-3 sm:px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[12px] sm:text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap min-w-0"
                >
                  <Scale className="w-4 h-4 text-[#C9A96E] shrink-0" />
                  <span className="truncate">
                    {myBattleProfile?.isVerifiedJudge ? "Judge Desk" : "Become Judge"}
                  </span>
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setView("admin")}
                    className="col-span-2 sm:col-span-1 min-h-[44px] px-4 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-[12px] sm:text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>Admin</span>
                  </button>
                )}
              </div>
            </div>

            {/* Personal Battle Strip */}
            {myBattleProfile && (
              <div className="mt-4 pt-3.5 border-t border-white/10 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-neutral-300 tabular-nums">
                <span className="font-bold text-[#C9A96E]">
                  Record: {myBattleProfile.wins}W – {myBattleProfile.losses}L
                </span>
                <span>{myBattleProfile.battleXp} Battle XP</span>
                <span>{myBattleProfile.winRate}% Win Rate</span>
                {myBattleProfile.currentStreak >= 2 && (
                  <span className="inline-flex items-center gap-1 text-amber-400 font-semibold">
                    <Flame className="w-3.5 h-3.5" />
                    {myBattleProfile.currentStreak} Streak
                  </span>
                )}
              </div>
            )}
          </div>

          {bannerMsg && (
            <div className="p-3.5 rounded-xl bg-[#0D0D0F] text-[#C9A96E] text-[13px] font-semibold border border-[#C9A96E]/40 break-words">
              {bannerMsg}
            </div>
          )}

          {/* Direct Battle Invites Received */}
          {pendingInvitesForMe.length > 0 && (
            <div className="w-full min-w-0 space-y-2.5">
              <h2 className="text-[13px] font-bold uppercase tracking-wider text-[#C9A96E]">
                Incoming Challenges ({pendingInvitesForMe.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pendingInvitesForMe.map((b) => (
                  <div
                    key={b.id}
                    className="p-4 rounded-2xl bg-white border-2 border-[#C9A96E]/60 flex flex-wrap items-center justify-between gap-3 min-w-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-[#C9A96E] uppercase truncate">
                        Direct Challenge · {b.customSkill}
                      </div>
                      <div className="text-[15px] font-bold truncate">{b.title}</div>
                      <div className="text-[12px] text-[#6B6760] truncate">
                        From {b.creatorName} · {b.durationMinutes} min
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyBattleId === b.id}
                        onClick={() => handleAcceptDecline(b, true)}
                        className="min-h-[40px] px-3.5 rounded-xl bg-[#0D0D0F] text-white text-[12px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Accept</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyBattleId === b.id}
                        onClick={() => handleAcceptDecline(b, false)}
                        className="min-h-[40px] px-3 rounded-xl bg-rose-500/15 text-rose-600 text-[12px] font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Decline</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search & Filters */}
          <div className="w-full min-w-0 space-y-2.5">
            <div className="flex items-center gap-2 w-full min-w-0">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 text-[#6B6760] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search battles, skill, or user..."
                  className="w-full min-h-[44px] pl-10 pr-4 rounded-xl bg-white border border-[#E8E4DB] text-[13px] text-[#0D0D0F] placeholder:text-[#6B6760] focus:outline-none focus:border-[#C9A96E]"
                />
              </div>
              <button
                type="button"
                onClick={() => loadHub(true)}
                aria-label="Refresh Battles"
                className="w-11 h-11 rounded-xl bg-white border border-[#E8E4DB] flex items-center justify-center cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-[#C9A96E]" : ""}`} />
              </button>
            </div>

            {/* Status/Visibility Filter Chips */}
            <div className="w-full max-w-full min-w-0 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar touch-pan-x">
              {(
                [
                  { id: "all", label: "All Battles" },
                  { id: "live", label: "Live Now" },
                  { id: "open", label: "Open Challenges" },
                  { id: "upcoming", label: "Upcoming" },
                  { id: "completed", label: "Completed" },
                  { id: "public", label: "Public" },
                  { id: "private", label: "Private" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={`min-h-[38px] px-3.5 rounded-xl text-[12px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition ${
                    statusFilter === f.id
                      ? "bg-[#0D0D0F] text-white"
                      : "bg-white border border-[#E8E4DB] text-[#0D0D0F]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Popular Categories */}
            <div className="w-full max-w-full min-w-0 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar touch-pan-x">
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                className={`min-h-[36px] px-3 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                  categoryFilter === "all"
                    ? "bg-[#C9A96E]/25 text-[#8A6D3B] border border-[#C9A96E]"
                    : "bg-[#EFECE4]/70 text-[#6B6760]"
                }`}
              >
                All Categories
              </button>
              {categories
                .filter((c) => c.enabled)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryFilter(c.id)}
                    className={`min-h-[36px] px-3 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                      categoryFilter === c.id
                        ? "bg-[#C9A96E]/25 text-[#8A6D3B] border border-[#C9A96E]"
                        : "bg-[#EFECE4]/70 text-[#6B6760]"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
            </div>
          </div>

          {loading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#C9A96E]" />
            </div>
          ) : filteredBattles.length === 0 ? (
            <div className="w-full min-w-0 p-6 sm:p-10 rounded-2xl bg-white border border-[#E8E4DB] text-center space-y-3">
              <Swords className="w-10 h-10 text-[#C9A96E] mx-auto" />
              <div className="text-[16px] font-bold">No Matching Skill Battles</div>
              <p className="text-[13px] text-[#6B6760] max-w-md mx-auto leading-relaxed">
                No active battles match your current search or filters. Launch a new battle to spark the next live match!
              </p>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="min-h-[44px] px-5 rounded-xl bg-[#0D0D0F] text-white text-[13px] font-bold cursor-pointer"
              >
                Create First Battle
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Featured Spotlight */}
              {featuredBattles.length > 0 && statusFilter === "all" && !searchQuery && (
                <section className="space-y-3">
                  <h2 className="text-[15px] font-bold tracking-tight flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#C9A96E]" />
                    <span>Featured Arena Spotlight</span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {featuredBattles.slice(0, 3).map(renderBattleCard)}
                  </div>
                </section>
              )}

              {/* Live Battles Section */}
              {liveBattles.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-[15px] font-bold tracking-tight flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                    <span>Live & Judging Now ({liveBattles.length})</span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {liveBattles.slice(0, visibleLimit).map(renderBattleCard)}
                  </div>
                </section>
              )}

              {/* Upcoming & Open Battles */}
              {upcomingAndOpenBattles.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-[15px] font-bold tracking-tight">
                    Open & Upcoming Battles ({upcomingAndOpenBattles.length})
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {upcomingAndOpenBattles.slice(0, visibleLimit).map(renderBattleCard)}
                  </div>
                </section>
              )}

              {/* Recently Completed Battles */}
              {completedBattles.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-[15px] font-bold tracking-tight flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-[#C9A96E]" />
                    <span>Recently Completed ({completedBattles.length})</span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {completedBattles.slice(0, visibleLimit).map(renderBattleCard)}
                  </div>
                </section>
              )}

              {filteredBattles.length > visibleLimit && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((v) => v + 12)}
                    className="min-h-[42px] px-5 rounded-xl bg-white border border-[#E8E4DB] text-[#0D0D0F] text-[13px] font-semibold cursor-pointer"
                  >
                    Load More Battles
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Create Battle Modal */}
      <CreateBattleModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        currentUser={currentUser}
        categories={categories}
        onCreated={(battle) => {
          setBattles((prev) => [battle, ...prev]);
          setActiveArenaBattle(battle);
        }}
      />

      {/* Judge Application Modal */}
      <JudgeApplicationModal
        isOpen={showJudgeAppModal}
        onClose={() => setShowJudgeAppModal(false)}
        currentUser={currentUser}
        categories={categories}
        onSubmitted={() => showNotice("Judge application submitted for admin review.")}
      />

      {/* Live Battle Arena Overlay */}
      {activeArenaBattle && (
        <LiveBattleArena
          battleId={activeArenaBattle.id}
          initialBattle={activeArenaBattle}
          currentUser={currentUser}
          onClose={() => {
            setActiveArenaBattle(null);
            loadHub(true);
          }}
          onViewProfile={(uid) => {
            setActiveArenaBattle(null);
            onViewProfile(uid);
          }}
          onOpenLeaderboard={() => {
            setActiveArenaBattle(null);
            setView("leaderboard");
          }}
        />
      )}

      {/* Completed Result Modal */}
      <BattleResultModal
        isOpen={showResultModal}
        result={selectedResult}
        currentUserId={currentUser.uid}
        onClose={() => setShowResultModal(false)}
        onOpenLeaderboard={() => setView("leaderboard")}
      />
    </div>
  );
};
