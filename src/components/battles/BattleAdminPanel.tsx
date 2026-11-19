import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ShieldAlert,
  Swords,
  Scale,
  Flag,
  Settings2,
  Ban,
  BarChart3,
  Star,
  Trash2,
  Check,
  X,
  Loader2,
  Plus,
} from "lucide-react";
import {
  Battle,
  BattleCategoryItem,
  BattleJudge,
  BattleJudgeApplication,
  BattleReport,
  BattleRewardConfig,
  BattleSuspension,
  DEFAULT_BATTLE_CATEGORIES,
  DEFAULT_BATTLE_REWARD_CONFIG,
} from "../../types/battle";
import { DEFAULT_AVATAR } from "../../types";
import {
  adminCancelBattle,
  adminDeleteBattle,
  adminFetchOverviewData,
  adminResolveBattleReport,
  adminReviewJudgeApplication,
  adminRevokeJudge,
  adminSetBattleSuspension,
  adminToggleFeatureBattle,
  adminUpdateBattleSettings,
} from "../../services/battleService";
import { SmartImage } from "../SmartImage";

interface BattleAdminPanelProps {
  adminEmail: string;
  onBack: () => void;
  onOpenBattle: (battle: Battle) => void;
  onSettingsUpdated?: () => void;
}

type AdminTab = "battles" | "judges" | "reports" | "rules" | "suspensions";

export const BattleAdminPanel: React.FC<BattleAdminPanelProps> = ({
  adminEmail,
  onBack,
  onOpenBattle,
  onSettingsUpdated,
}) => {
  const [tab, setTab] = useState<AdminTab>("battles");
  const [loading, setLoading] = useState(true);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [applications, setApplications] = useState<BattleJudgeApplication[]>([]);
  const [judges, setJudges] = useState<BattleJudge[]>([]);
  const [reports, setReports] = useState<BattleReport[]>([]);
  const [suspensions, setSuspensions] = useState<BattleSuspension[]>([]);
  const [categories, setCategories] = useState<BattleCategoryItem[]>(DEFAULT_BATTLE_CATEGORIES);
  const [rewards, setRewards] = useState<BattleRewardConfig>(DEFAULT_BATTLE_REWARD_CONFIG);

  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [suspendUid, setSuspendUid] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await adminFetchOverviewData();
      setBattles(data.battles);
      setApplications(data.applications);
      setJudges(data.judges);
      setReports(data.reports);
      setSuspensions(data.suspensions);
      setCategories(data.settings.categories);
      setRewards(data.settings.rewards);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const flash = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  };

  const handleToggleFeature = async (b: Battle) => {
    setBusyId(b.id);
    try {
      await adminToggleFeatureBattle(b.id, !b.featured);
      setBattles((prev) =>
        prev.map((item) => (item.id === b.id ? { ...item, featured: !b.featured } : item))
      );
      flash(b.featured ? "Battle unfeatured" : "Battle marked Featured");
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelBattle = async (b: Battle) => {
    setBusyId(b.id);
    try {
      await adminCancelBattle(b.id, "Cancelled by SwapSkill Arena Admin");
      setBattles((prev) =>
        prev.map((item) => (item.id === b.id ? { ...item, status: "cancelled" } : item))
      );
      flash("Battle cancelled");
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteBattle = async (b: Battle) => {
    setBusyId(b.id);
    try {
      await adminDeleteBattle(b.id);
      setBattles((prev) => prev.filter((item) => item.id !== b.id));
      flash("Battle removed");
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewJudge = async (app: BattleJudgeApplication, approve: boolean) => {
    setBusyId(app.id);
    try {
      await adminReviewJudgeApplication({
        application: app,
        approve,
        adminEmail,
        rejectionReason: approve ? undefined : "Criteria did not meet verified panel standards",
      });
      await loadData();
      flash(approve ? `Approved ${app.name} as Judge` : `Declined ${app.name}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleRevokeJudge = async (judgeId: string) => {
    setBusyId(judgeId);
    try {
      await adminRevokeJudge(judgeId);
      await loadData();
      flash("Judge status revoked");
    } finally {
      setBusyId(null);
    }
  };

  const handleResolveReport = async (report: BattleReport, status: BattleReport["status"]) => {
    setBusyId(report.id);
    try {
      await adminResolveBattleReport({
        reportId: report.id,
        status,
        adminEmail,
      });
      setReports((prev) =>
        prev.map((r) => (r.id === report.id ? { ...r, status } : r))
      );
      flash(`Report marked ${status.replace("_", " ")}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveRules = async () => {
    setBusyId("save_rules");
    try {
      await adminUpdateBattleSettings({
        categories,
        rewards,
        adminEmail,
      });
      onSettingsUpdated?.();
      flash("Battle categories & XP rules saved");
    } finally {
      setBusyId(null);
    }
  };

  const handleAddCategory = () => {
    const clean = newCatName.trim();
    if (!clean) return;
    const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (categories.some((c) => c.id === id)) return;
    setCategories((prev) => [
      ...prev,
      {
        id: id || `cat_${Date.now()}`,
        name: clean,
        description: newCatDesc.trim() || "Skill battle discipline",
        accentColor: "#C9A96E",
        enabled: true,
      },
    ]);
    setNewCatName("");
    setNewCatDesc("");
  };

  const handleSuspendUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendUid.trim() || !suspendReason.trim()) return;
    setBusyId("suspend_user");
    try {
      await adminSetBattleSuspension({
        uid: suspendUid.trim(),
        active: true,
        reason: suspendReason.trim(),
        adminEmail,
      });
      setSuspendUid("");
      setSuspendReason("");
      await loadData();
      flash("User suspended from Skill Battles");
    } finally {
      setBusyId(null);
    }
  };

  const handleLiftSuspension = async (s: BattleSuspension) => {
    setBusyId(s.uid);
    try {
      await adminSetBattleSuspension({
        uid: s.uid,
        userName: s.userName,
        active: false,
        reason: "Suspension lifted by admin",
        adminEmail,
      });
      await loadData();
      flash("Suspension lifted");
    } finally {
      setBusyId(null);
    }
  };

  const pendingApps = applications.filter((a) => a.status === "pending");
  const openReports = reports.filter((r) => r.status === "open");
  const liveCount = battles.filter((b) => b.status === "live").length;

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to Skill Battles"
            className="w-11 h-11 rounded-xl bg-white border border-[#E8E4DB] flex items-center justify-center text-[#0D0D0F] cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[18px] sm:text-[20px] font-bold text-[#0D0D0F] tracking-tight truncate">
                Battle Admin Console
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#C9A96E]/20 text-[#8A6D3B] shrink-0">
                GOVERNANCE
              </span>
            </div>
            <p className="text-[12px] text-[#6B6760] truncate">
              Restricted to {adminEmail}
            </p>
          </div>
        </div>
      </div>

      {toastMsg && (
        <div className="px-4 py-2.5 rounded-xl bg-[#0D0D0F] text-[#C9A96E] text-[13px] font-semibold border border-[#C9A96E]/40">
          {toastMsg}
        </div>
      )}

      {/* Analytics KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl bg-white border border-[#E8E4DB] min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6760] truncate">
            Total Battles
          </div>
          <div className="text-[22px] font-black tabular-nums text-[#0D0D0F] mt-0.5">
            {battles.length}
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold">{liveCount} live now</div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-[#E8E4DB] min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6760] truncate">
            Judge Queue
          </div>
          <div className="text-[22px] font-black tabular-nums text-[#C9A96E] mt-0.5">
            {pendingApps.length}
          </div>
          <div className="text-[11px] text-[#6B6760]">{judges.filter((j) => j.status === "active").length} active judges</div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-[#E8E4DB] min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6760] truncate">
            Open Reports
          </div>
          <div className="text-[22px] font-black tabular-nums text-rose-600 mt-0.5">
            {openReports.length}
          </div>
          <div className="text-[11px] text-[#6B6760]">{reports.length} total logged</div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-[#E8E4DB] min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6760] truncate">
            Suspensions
          </div>
          <div className="text-[22px] font-black tabular-nums text-[#0D0D0F] mt-0.5">
            {suspensions.filter((s) => s.active).length}
          </div>
          <div className="text-[11px] text-[#6B6760]">Restricted accounts</div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="w-full max-w-full min-w-0 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar touch-pan-x">
        {[
          { id: "battles" as const, label: "Battles", icon: Swords },
          { id: "judges" as const, label: `Judges (${pendingApps.length})`, icon: Scale },
          { id: "reports" as const, label: `Reports (${openReports.length})`, icon: Flag },
          { id: "rules" as const, label: "Categories & XP", icon: Settings2 },
          { id: "suspensions" as const, label: "Suspensions", icon: Ban },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`min-h-[40px] px-3.5 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                tab === item.id
                  ? "bg-[#0D0D0F] text-white"
                  : "bg-white border border-[#E8E4DB] text-[#0D0D0F]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-[#C9A96E]" />
        </div>
      ) : (
        <>
          {tab === "battles" && (
            <div className="space-y-2.5">
              {battles.map((b) => (
                <div
                  key={b.id}
                  className="p-4 rounded-2xl bg-white border border-[#E8E4DB] flex flex-wrap items-center justify-between gap-3 min-w-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-[#EFECE4] text-[#0D0D0F]">
                        {b.status}
                      </span>
                      {b.featured && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#C9A96E]/20 text-[#8A6D3B]">
                          FEATURED
                        </span>
                      )}
                      <span className="text-[11px] text-[#6B6760]">{b.customSkill}</span>
                    </div>
                    <h4 className="text-[14px] font-bold text-[#0D0D0F] mt-1 truncate">
                      {b.title}
                    </h4>
                    <div className="text-[12px] text-[#6B6760] truncate">
                      {b.creatorName} vs {b.opponentName || "Open"} · {b.viewerCount} viewers
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenBattle(b)}
                      className="min-h-[38px] px-3 rounded-lg bg-[#EFECE4] text-[12px] font-semibold text-[#0D0D0F] cursor-pointer"
                    >
                      Inspect
                    </button>
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => handleToggleFeature(b)}
                      className={`min-h-[38px] px-3 rounded-lg text-[12px] font-semibold flex items-center gap-1 cursor-pointer ${
                        b.featured
                          ? "bg-[#C9A96E] text-[#0D0D0F]"
                          : "bg-white border border-[#E8E4DB] text-[#0D0D0F]"
                      }`}
                    >
                      <Star className="w-3.5 h-3.5" />
                      <span>{b.featured ? "Featured" : "Feature"}</span>
                    </button>
                    {b.status !== "cancelled" && b.status !== "completed" && (
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => handleCancelBattle(b)}
                        className="min-h-[38px] px-3 rounded-lg bg-amber-500/15 text-amber-700 text-[12px] font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => handleDeleteBattle(b)}
                      aria-label="Delete battle"
                      className="w-10 h-10 rounded-lg bg-rose-500/10 text-rose-600 flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "judges" && (
            <div className="space-y-4">
              <div className="space-y-2.5">
                <h3 className="text-[13px] font-bold uppercase tracking-wider text-[#6B6760]">
                  Judge Applications ({applications.length})
                </h3>
                {applications.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-white border border-[#E8E4DB] text-center text-[13px] text-[#6B6760]">
                    No judge applications submitted yet.
                  </div>
                ) : (
                  applications.map((app) => (
                    <div
                      key={app.id}
                      className="p-4 rounded-2xl bg-white border border-[#E8E4DB] space-y-2.5 min-w-0"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <SmartImage
                            src={app.photoUrl || DEFAULT_AVATAR}
                            alt={app.name}
                            fallbackType="profile"
                            fullName={app.name}
                            className="w-10 h-10 rounded-full object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-[14px] font-bold text-[#0D0D0F] truncate">
                              {app.name}
                            </div>
                            <div className="text-[12px] text-[#6B6760] truncate">
                              {app.yearsExperience} yrs · {app.categories.join(", ")}
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] font-bold uppercase px-2.5 py-0.5 rounded bg-[#EFECE4] text-[#0D0D0F] shrink-0">
                          {app.status}
                        </span>
                      </div>
                      <p className="text-[12px] text-[#0D0D0F] break-words">
                        {app.credentialsSummary}
                      </p>
                      <p className="text-[12px] text-[#6B6760] italic break-words">
                        "{app.statement}"
                      </p>
                      {app.status === "pending" && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={busyId === app.id}
                            onClick={() => handleReviewJudge(app, true)}
                            className="min-h-[38px] px-4 rounded-xl bg-emerald-600 text-white text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Approve Judge</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === app.id}
                            onClick={() => handleReviewJudge(app, false)}
                            className="min-h-[38px] px-4 rounded-xl bg-rose-500/15 text-rose-600 text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Reject</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2.5">
                <h3 className="text-[13px] font-bold uppercase tracking-wider text-[#6B6760]">
                  Verified Judges ({judges.filter((j) => j.status === "active").length})
                </h3>
                {judges
                  .filter((j) => j.status === "active")
                  .map((j) => (
                    <div
                      key={j.uid}
                      className="p-3.5 rounded-2xl bg-white border border-[#E8E4DB] flex items-center justify-between gap-3 min-w-0"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <SmartImage
                          src={j.photoUrl || DEFAULT_AVATAR}
                          alt={j.name}
                          fallbackType="profile"
                          fullName={j.name}
                          className="w-9 h-9 rounded-full object-cover shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-[#0D0D0F] truncate">
                            {j.name}
                          </div>
                          <div className="text-[11px] text-[#6B6760] truncate">
                            {j.categories.join(", ")}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busyId === j.uid}
                        onClick={() => handleRevokeJudge(j.uid)}
                        className="min-h-[38px] px-3 rounded-lg bg-rose-500/10 text-rose-600 text-[12px] font-semibold cursor-pointer shrink-0"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {tab === "reports" && (
            <div className="space-y-2.5">
              {reports.length === 0 ? (
                <div className="p-8 rounded-2xl bg-white border border-[#E8E4DB] text-center text-[13px] text-[#6B6760]">
                  No battle reports or disputes have been filed.
                </div>
              ) : (
                reports.map((rep) => (
                  <div
                    key={rep.id}
                    className="p-4 rounded-2xl bg-white border border-[#E8E4DB] space-y-2 min-w-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-bold text-rose-600 uppercase">
                        {rep.reason.replace("_", " ")}
                      </span>
                      <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-[#EFECE4] text-[#0D0D0F]">
                        {rep.status}
                      </span>
                    </div>
                    <div className="text-[14px] font-bold text-[#0D0D0F] break-words">
                      {rep.battleTitle}
                    </div>
                    <p className="text-[12px] text-[#6B6760] break-words">
                      Reported by {rep.reporterName}: {rep.details}
                    </p>
                    {rep.status === "open" && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleResolveReport(rep, "action_taken")}
                          className="min-h-[38px] px-3 rounded-lg bg-[#0D0D0F] text-white text-[12px] font-semibold cursor-pointer"
                        >
                          Mark Action Taken
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveReport(rep, "dismissed")}
                          className="min-h-[38px] px-3 rounded-lg bg-[#EFECE4] text-[12px] font-semibold text-[#0D0D0F] cursor-pointer"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "rules" && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-white border border-[#E8E4DB] space-y-3">
                <h3 className="text-[14px] font-bold text-[#0D0D0F] flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#C9A96E]" />
                  <span>XP & Reward Rules</span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { key: "winnerBaseXp" as const, label: "Winner Base XP" },
                    { key: "participantBaseXp" as const, label: "Participant XP" },
                    { key: "drawXp" as const, label: "Draw XP" },
                    { key: "streakBonusXp" as const, label: "Streak Bonus XP" },
                    {
                      key: "audienceWeightInHybridPercent" as const,
                      label: "Audience Weight %",
                    },
                  ].map((field) => (
                    <div key={field.key}>
                      <label className="block text-[11px] font-semibold text-[#6B6760] mb-1">
                        {field.label}
                      </label>
                      <input
                        type="number"
                        value={rewards[field.key]}
                        onChange={(e) =>
                          setRewards((prev) => ({
                            ...prev,
                            [field.key]: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className="w-full min-h-[40px] px-3 rounded-lg bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] tabular-nums text-[#0D0D0F]"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-[#E8E4DB] space-y-3">
                <h3 className="text-[14px] font-bold text-[#0D0D0F]">
                  Skill Categories
                </h3>
                <div className="space-y-2">
                  {categories.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#F7F4EE] min-w-0"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-[#0D0D0F] truncate">
                          {c.name}
                        </div>
                        <div className="text-[11px] text-[#6B6760] truncate">{c.description}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setCategories((prev) =>
                            prev.map((item) =>
                              item.id === c.id ? { ...item, enabled: !item.enabled } : item
                            )
                          )
                        }
                        className={`min-h-[34px] px-3 rounded-lg text-[11px] font-bold cursor-pointer shrink-0 ${
                          c.enabled
                            ? "bg-emerald-500/15 text-emerald-700"
                            : "bg-neutral-300 text-neutral-700"
                        }`}
                      >
                        {c.enabled ? "Enabled" : "Disabled"}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                  <input
                    type="text"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="New category name"
                    className="min-h-[40px] px-3 rounded-lg bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] text-[#0D0D0F]"
                  />
                  <input
                    type="text"
                    value={newCatDesc}
                    onChange={(e) => setNewCatDesc(e.target.value)}
                    placeholder="Short description"
                    className="min-h-[40px] px-3 rounded-lg bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] text-[#0D0D0F]"
                  />
                  <button
                    type="button"
                    onClick={handleAddCategory}
                    className="min-h-[40px] px-4 rounded-lg bg-[#0D0D0F] text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Category</span>
                  </button>
                </div>
              </div>

              <button
                type="button"
                disabled={busyId === "save_rules"}
                onClick={handleSaveRules}
                className="w-full sm:w-auto min-h-[46px] px-6 rounded-xl bg-[#C9A96E] text-[#0D0D0F] text-[14px] font-bold cursor-pointer"
              >
                {busyId === "save_rules" ? "Saving..." : "Publish Battle Rules & Categories"}
              </button>
            </div>
          )}

          {tab === "suspensions" && (
            <div className="space-y-4">
              <form
                onSubmit={handleSuspendUser}
                className="p-4 rounded-2xl bg-white border border-[#E8E4DB] space-y-3"
              >
                <div className="text-[14px] font-bold text-[#0D0D0F] flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-500" />
                  <span>Suspend Abusive User From Battles</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={suspendUid}
                    onChange={(e) => setSuspendUid(e.target.value)}
                    placeholder="User UID"
                    className="min-h-[42px] px-3 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] text-[#0D0D0F]"
                  />
                  <input
                    type="text"
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    placeholder="Suspension reason"
                    className="min-h-[42px] px-3 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] text-[#0D0D0F]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busyId === "suspend_user"}
                  className="min-h-[42px] px-5 rounded-xl bg-rose-600 text-white text-[13px] font-semibold cursor-pointer"
                >
                  Apply Battle Suspension
                </button>
              </form>

              <div className="space-y-2">
                {suspensions.map((s) => (
                  <div
                    key={s.uid}
                    className="p-3.5 rounded-2xl bg-white border border-[#E8E4DB] flex items-center justify-between gap-3 min-w-0"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-[#0D0D0F] truncate">
                        {s.userName || s.uid}
                      </div>
                      <div className="text-[12px] text-[#6B6760] truncate">
                        {s.active ? `Active: ${s.reason}` : "Lifted"}
                      </div>
                    </div>
                    {s.active && (
                      <button
                        type="button"
                        disabled={busyId === s.uid}
                        onClick={() => handleLiftSuspension(s)}
                        className="min-h-[38px] px-3 rounded-lg bg-emerald-500/15 text-emerald-700 text-[12px] font-semibold cursor-pointer shrink-0"
                      >
                        Lift Ban
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
