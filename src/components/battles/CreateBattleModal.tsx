import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Swords,
  Globe,
  Lock,
  Users,
  Clock,
  Scale,
  ShieldCheck,
  Search,
  Plus,
  Trash2,
  Image as ImageIcon,
  Check,
  Sparkles,
  Award,
  Loader2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  Battle,
  BattleCategoryItem,
  BattleCriterion,
  BattleJudge,
  BattleJudgingMethod,
  BattleMode,
  BattleVisibility,
  DEFAULT_BATTLE_CRITERIA,
} from "../../types/battle";
import { DEFAULT_AVATAR } from "../../types";
import {
  BattleUserActor,
  createBattle,
  fetchActiveVerifiedJudges,
  searchPotentialOpponents,
} from "../../services/battleService";
import { uploadImageToCloudinary } from "../../utils/cloudinary";
import { SmartImage } from "../SmartImage";
import { useBackHandler } from "../../utils/navigationManager";

interface CreateBattleModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: BattleUserActor;
  categories: BattleCategoryItem[];
  onCreated: (battle: Battle) => void;
}

const DURATION_PRESETS = [5, 10, 15, 30, 45, 60];

export const CreateBattleModal: React.FC<CreateBattleModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  categories,
  onCreated,
}) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(categories[0]?.id || "coding");
  const [customSkill, setCustomSkill] = useState("");
  const [mode, setMode] = useState<BattleMode>("open");
  const [visibility, setVisibility] = useState<BattleVisibility>("public");
  const [durationMinutes, setDurationMinutes] = useState<number>(15);
  const [scheduledDateTime, setScheduledDateTime] = useState<string>("");
  const [judgingMethod, setJudgingMethod] = useState<BattleJudgingMethod>("hybrid");
  const [allowAudienceVoting, setAllowAudienceVoting] = useState<boolean>(true);
  const [rules, setRules] = useState<string[]>([
    "Original live work only during the timed battle round",
    "Keep commentary respectful and aligned with SwapSkill guidelines",
  ]);
  const [newRuleText, setNewRuleText] = useState("");
  const [criteria, setCriteria] = useState<BattleCriterion[]>(DEFAULT_BATTLE_CRITERIA);
  const [minXp, setMinXp] = useState<string>("");
  const [verifiedOnly, setVerifiedOnly] = useState<boolean>(false);
  const [requiredSkill, setRequiredSkill] = useState<string>("");
  const [thumbnailUrl, setThumbnailUrl] = useState<string>("");
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);

  // Opponent Picker
  const [opponentQuery, setOpponentQuery] = useState("");
  const [opponentResults, setOpponentResults] = useState<BattleUserActor[]>([]);
  const [selectedOpponent, setSelectedOpponent] = useState<BattleUserActor | null>(null);
  const [searchingOpponents, setSearchingOpponents] = useState(false);

  // Verified Judges Picker
  const [availableJudges, setAvailableJudges] = useState<BattleJudge[]>([]);
  const [selectedJudgeIds, setSelectedJudgeIds] = useState<string[]>([]);

  const [step, setStep] = useState<"setup" | "rules" | "review">("setup");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackHandler(isOpen, () => {
    if (categoryOpen) {
      setCategoryOpen(false);
      return;
    }
    onClose();
  });

  useEffect(() => {
    if (!isOpen) return;
    setCategoryOpen(false);
    setError(null);
    fetchActiveVerifiedJudges()
      .then((list) => setAvailableJudges(list.filter((j) => j.uid !== currentUser.uid)))
      .catch(() => {});
  }, [isOpen, currentUser.uid]);

  useEffect(() => {
    if (!isOpen || mode !== "direct") return;
    let active = true;
    setSearchingOpponents(true);
    const timer = setTimeout(() => {
      searchPotentialOpponents(opponentQuery, currentUser.uid)
        .then((res) => {
          if (active) setOpponentResults(res);
        })
        .finally(() => {
          if (active) setSearchingOpponents(false);
        });
    }, 220);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isOpen, mode, opponentQuery, currentUser.uid]);

  const totalCriteriaWeight = useMemo(
    () => criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0),
    [criteria]
  );

  const selectedCategoryObj = useMemo(
    () => categories.find((c) => c.id === category) || categories[0],
    [categories, category]
  );

  if (!isOpen) return null;

  const handleUploadThumbnail = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingThumb(true);
    setError(null);
    try {
      const url = await uploadImageToCloudinary(file, {
        type: "cover",
        folder: "swapskill_battles",
        allowDevOfflineFallback: true,
      });
      setThumbnailUrl(url);
    } catch (err: any) {
      setError(err?.message || "Could not upload thumbnail image.");
    } finally {
      setIsUploadingThumb(false);
    }
  };

  const handleAddRule = () => {
    const clean = newRuleText.trim();
    if (!clean || rules.length >= 8) return;
    setRules((prev) => [...prev, clean]);
    setNewRuleText("");
  };

  const handleAddCriterion = () => {
    if (criteria.length >= 6) return;
    setCriteria((prev) => [
      ...prev,
      {
        id: `crit_${Date.now()}`,
        label: "New Criterion",
        weight: 20,
        maxScore: 10,
      },
    ]);
  };

  const handleToggleJudge = (judgeId: string) => {
    setSelectedJudgeIds((prev) =>
      prev.includes(judgeId)
        ? prev.filter((id) => id !== judgeId)
        : prev.length < 3
        ? [...prev, judgeId]
        : prev
    );
  };

  const validateStep1 = (): string | null => {
    if (title.trim().length < 3) return "Enter a battle title (at least 3 characters).";
    if (customSkill.trim().length < 2) return "Specify the exact skill being battled.";
    if (mode === "direct" && !selectedOpponent) {
      return "Select an opponent or switch to Open Challenger mode.";
    }
    return null;
  };

  const validateStep2 = (): string | null => {
    if (criteria.length === 0) return "Add at least one judging criterion.";
    if (criteria.some((c) => !c.label.trim())) return "Every criterion needs a name.";
    if (totalCriteriaWeight !== 100) {
      return `Criteria weights must sum to 100% (currently ${totalCriteriaWeight}%).`;
    }
    return null;
  };

  const handleNext = () => {
    setError(null);
    if (step === "setup") {
      const err = validateStep1();
      if (err) return setError(err);
      setStep("rules");
    } else if (step === "rules") {
      const err = validateStep2();
      if (err) return setError(err);
      setStep("review");
    }
  };

  const handleSubmit = async () => {
    const err1 = validateStep1();
    if (err1) return setError(err1);
    const err2 = validateStep2();
    if (err2) return setError(err2);

    setSubmitting(true);
    setError(null);

    try {
      const chosenJudges = availableJudges
        .filter((j) => selectedJudgeIds.includes(j.uid))
        .map((j) => ({
          uid: j.uid,
          name: j.name,
          username: j.username,
          photoUrl: j.photoUrl,
          specialty: j.categories[0] || "Arena Judge",
          submitted: false,
        }));

      const scheduledAtMs = scheduledDateTime
        ? new Date(scheduledDateTime).getTime()
        : Date.now();

      const battle = await createBattle(
        {
          title,
          description:
            description.trim() ||
            `Live ${durationMinutes}-minute head-to-head ${customSkill.trim()} battle on SwapSkill.`,
          category,
          customSkill,
          mode,
          visibility,
          durationMinutes,
          scheduledAtMs: Number.isFinite(scheduledAtMs) ? scheduledAtMs : Date.now(),
          judgingMethod,
          allowAudienceVoting,
          rules,
          criteria,
          opponent: mode === "direct" ? selectedOpponent : null,
          judges: chosenJudges,
          entryRequirements:
            minXp || verifiedOnly || requiredSkill.trim()
              ? {
                  ...(minXp ? { minXp: Math.max(0, Number(minXp) || 0) } : {}),
                  ...(verifiedOnly ? { verifiedOnly: true } : {}),
                  ...(requiredSkill.trim() ? { requiredSkill: requiredSkill.trim() } : {}),
                }
              : undefined,
          thumbnailUrl: thumbnailUrl || undefined,
        },
        currentUser
      );

      onCreated(battle);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to launch Skill Battle. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        className="w-full sm:max-w-2xl max-h-[92dvh] flex flex-col rounded-t-[24px] sm:rounded-[24px] bg-[#F7F4EE] border border-[#E8E4DB] shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 bg-white border-b border-[#E8E4DB] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#0D0D0F] text-[#C9A96E] flex items-center justify-center shrink-0">
              <Swords className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold text-[#0D0D0F] tracking-tight truncate">
                Create Skill Battle
              </h2>
              <p className="text-[12px] text-[#6B6760] truncate">
                {step === "setup"
                  ? "Step 1 of 3 · Format & Matchup"
                  : step === "rules"
                  ? "Step 2 of 3 · Rules, Criteria & Judges"
                  : "Step 3 of 3 · Arena Card Preview"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Create Battle"
            className="w-10 h-10 rounded-full flex items-center justify-center text-[#6B6760] hover:bg-black/5 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Progress Strip */}
        <div className="px-4 sm:px-5 pt-3 pb-2 bg-white/80 border-b border-[#E8E4DB] flex items-center gap-2 shrink-0">
          {(["setup", "rules", "review"] as const).map((s, idx) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setError(null);
                setStep(s);
              }}
              className={`flex-1 min-h-[38px] rounded-lg text-[12px] font-semibold transition cursor-pointer whitespace-nowrap px-2 ${
                step === s
                  ? "bg-[#0D0D0F] text-white"
                  : "bg-[#EFECE4] text-[#6B6760]"
              }`}
            >
              {idx + 1}. {s === "setup" ? "Matchup" : s === "rules" ? "Judging" : "Confirm"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-[13px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === "setup" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                  Battle Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="e.g., 15-Min React Dashboard Speedrun"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-[#E8E4DB] text-[14px] text-[#0D0D0F] focus:outline-none focus:border-[#C9A96E]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="relative">
                  <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                    Skill Category *
                  </label>
                  <button
                    type="button"
                    onClick={() => setCategoryOpen((o) => !o)}
                    aria-expanded={categoryOpen}
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-[#E8E4DB] hover:border-[#C9A96E] text-[14px] text-[#0D0D0F] flex items-center justify-between gap-2 focus:outline-none focus:border-[#C9A96E] cursor-pointer transition"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: selectedCategoryObj?.accentColor || "#C9A96E" }}
                      />
                      <span className="font-medium truncate">
                        {selectedCategoryObj?.name || category}
                      </span>
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#6B6760] shrink-0 transition-transform ${
                        categoryOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {categoryOpen && (
                    <>
                      <div
                        onClick={() => setCategoryOpen(false)}
                        className="fixed inset-0 z-30"
                      />
                      <div className="absolute left-0 right-0 mt-1.5 z-40 rounded-2xl bg-white border border-[#E8E4DB] shadow-2xl max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                        {categories
                          .filter((c) => c.enabled)
                          .map((c) => {
                            const selected = c.id === category;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setCategory(c.id);
                                  setCategoryOpen(false);
                                }}
                                className={`w-full px-3 py-2.5 rounded-xl text-left flex items-center justify-between gap-2 transition cursor-pointer ${
                                  selected
                                    ? "bg-[#0D0D0F] text-white"
                                    : "hover:bg-[#F7F4EE] text-[#0D0D0F]"
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: c.accentColor || "#C9A96E" }}
                                  />
                                  <div className="min-w-0">
                                    <div className="text-[13px] font-semibold truncate">
                                      {c.name}
                                    </div>
                                    <div
                                      className={`text-[11px] truncate ${
                                        selected ? "text-neutral-300" : "text-[#6B6760]"
                                      }`}
                                    >
                                      {c.description}
                                    </div>
                                  </div>
                                </div>
                                {selected && (
                                  <Check className="w-4 h-4 text-[#C9A96E] shrink-0" />
                                )}
                              </button>
                            );
                          })}
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                    Exact Skill Focus *
                  </label>
                  <input
                    type="text"
                    value={customSkill}
                    onChange={(e) => setCustomSkill(e.target.value)}
                    maxLength={60}
                    placeholder="e.g., TypeScript / Figma / Guitar"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-[#E8E4DB] text-[14px] text-[#0D0D0F] focus:outline-none focus:border-[#C9A96E]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                  Brief & Challenge Prompt
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={600}
                  placeholder="Describe the live challenge objective, deliverables, or prompt..."
                  className="w-full p-3.5 rounded-xl bg-white border border-[#E8E4DB] text-[14px] text-[#0D0D0F] focus:outline-none focus:border-[#C9A96E] resize-none"
                />
              </div>

              {/* Matchmaking Mode */}
              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                  Opponent Matchmaking
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setMode("open")}
                    className={`min-h-[48px] p-3 rounded-xl border text-left transition cursor-pointer ${
                      mode === "open"
                        ? "bg-[#0D0D0F] text-white border-transparent"
                        : "bg-white border-[#E8E4DB] text-[#0D0D0F]"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-[13px]">
                      <Users className="w-4 h-4 shrink-0" />
                      <span>Open Challenger</span>
                    </div>
                    <p className="text-[11px] opacity-75 mt-0.5">
                      Any eligible SwapSkill member can claim the opponent slot
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode("direct")}
                    className={`min-h-[48px] p-3 rounded-xl border text-left transition cursor-pointer ${
                      mode === "direct"
                        ? "bg-[#0D0D0F] text-white border-transparent"
                        : "bg-white border-[#E8E4DB] text-[#0D0D0F]"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-[13px]">
                      <Swords className="w-4 h-4 shrink-0" />
                      <span>Direct Invite</span>
                    </div>
                    <p className="text-[11px] opacity-75 mt-0.5">
                      Challenge a specific SwapSkill competitor directly
                    </p>
                  </button>
                </div>
              </div>

              {/* Opponent Search Picker */}
              {mode === "direct" && (
                <div className="p-3.5 rounded-xl bg-white border border-[#E8E4DB] space-y-2.5">
                  <div className="relative">
                    <Search className="w-4 h-4 text-[#6B6760] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={opponentQuery}
                      onChange={(e) => setOpponentQuery(e.target.value)}
                      placeholder="Search SwapSkill users by name or @username..."
                      className="w-full min-h-[42px] pl-9 pr-3 rounded-lg bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] text-[#0D0D0F] focus:outline-none"
                    />
                  </div>

                  {selectedOpponent && (
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#C9A96E]/15 border border-[#C9A96E]/40 gap-2 min-w-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <SmartImage
                          src={selectedOpponent.photoUrl || DEFAULT_AVATAR}
                          alt={selectedOpponent.fullName}
                          fallbackType="profile"
                          fullName={selectedOpponent.fullName}
                          className="w-8 h-8 rounded-full object-cover shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-[#0D0D0F] truncate">
                            {selectedOpponent.fullName}
                          </div>
                          {selectedOpponent.username && (
                            <div className="text-[11px] text-[#6B6760] truncate">
                              @{selectedOpponent.username}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedOpponent(null)}
                        className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-black/10 text-[#0D0D0F] cursor-pointer shrink-0"
                      >
                        Change
                      </button>
                    </div>
                  )}

                  {!selectedOpponent && (
                    <div className="max-h-40 overflow-y-auto divide-y divide-[#E8E4DB]/60">
                      {searchingOpponents ? (
                        <div className="py-4 text-center text-[12px] text-[#6B6760]">
                          Searching SwapSkill network...
                        </div>
                      ) : opponentResults.length === 0 ? (
                        <div className="py-4 text-center text-[12px] text-[#6B6760]">
                          No matching members found.
                        </div>
                      ) : (
                        opponentResults.map((u) => (
                          <button
                            key={u.uid}
                            type="button"
                            onClick={() => setSelectedOpponent(u)}
                            className="w-full py-2 px-1.5 flex items-center justify-between gap-2 hover:bg-[#F7F4EE] rounded-lg text-left transition cursor-pointer min-w-0"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <SmartImage
                                src={u.photoUrl || DEFAULT_AVATAR}
                                alt={u.fullName}
                                fallbackType="profile"
                                fullName={u.fullName}
                                className="w-8 h-8 rounded-full object-cover shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="text-[13px] font-medium text-[#0D0D0F] truncate flex items-center gap-1">
                                  <span className="truncate">{u.fullName}</span>
                                  {u.verified && (
                                    <ShieldCheck className="w-3.5 h-3.5 text-[#C9A96E] shrink-0" />
                                  )}
                                </div>
                                {u.username && (
                                  <div className="text-[11px] text-[#6B6760] truncate">
                                    @{u.username}
                                  </div>
                                )}
                              </div>
                            </div>
                            <span className="text-[11px] font-semibold text-[#8A6D3B] shrink-0">
                              Select
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Visibility & Duration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                    Battle Visibility
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setVisibility("public")}
                      className={`min-h-[44px] px-3 rounded-xl border flex items-center justify-center gap-1.5 text-[13px] font-semibold cursor-pointer ${
                        visibility === "public"
                          ? "bg-[#0D0D0F] text-white border-transparent"
                          : "bg-white border-[#E8E4DB] text-[#0D0D0F]"
                      }`}
                    >
                      <Globe className="w-4 h-4 shrink-0" />
                      <span>Public</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibility("private")}
                      className={`min-h-[44px] px-3 rounded-xl border flex items-center justify-center gap-1.5 text-[13px] font-semibold cursor-pointer ${
                        visibility === "private"
                          ? "bg-[#0D0D0F] text-white border-transparent"
                          : "bg-white border-[#E8E4DB] text-[#0D0D0F]"
                      }`}
                    >
                      <Lock className="w-4 h-4 shrink-0" />
                      <span>Private</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                    Duration (Minutes)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {DURATION_PRESETS.map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setDurationMinutes(mins)}
                        className={`min-h-[40px] px-3 rounded-lg text-[12px] font-semibold tabular-nums cursor-pointer ${
                          durationMinutes === mins
                            ? "bg-[#C9A96E] text-[#0D0D0F]"
                            : "bg-white border border-[#E8E4DB] text-[#0D0D0F]"
                        }`}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                    Scheduled Start (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-[#E8E4DB] text-[13px] text-[#0D0D0F]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                    Cover Thumbnail (Optional)
                  </label>
                  <label className="min-h-[44px] px-3.5 rounded-xl bg-white border border-dashed border-[#C9A96E]/60 flex items-center justify-center gap-2 text-[13px] font-medium text-[#0D0D0F] cursor-pointer hover:bg-[#C9A96E]/10 transition">
                    {isUploadingThumb ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#C9A96E]" />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-[#C9A96E]" />
                    )}
                    <span className="truncate">
                      {thumbnailUrl ? "Cover Uploaded · Replace" : "Upload Cover Image"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUploadThumbnail}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {step === "rules" && (
            <div className="space-y-4">
              {/* Judging Method */}
              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                  Judging System
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    {
                      id: "automatic" as const,
                      label: "Automatic",
                      desc: "Live activity, submission & enabled fan score",
                    },
                    {
                      id: "human_judges" as const,
                      label: "Verified Judges",
                      desc: "Assigned verified judges score each criterion",
                    },
                    {
                      id: "hybrid" as const,
                      label: "Hybrid Arena",
                      desc: "Verified judge score + live stage & fan weight",
                    },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setJudgingMethod(m.id)}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                        judgingMethod === m.id
                          ? "bg-[#0D0D0F] text-white border-transparent"
                          : "bg-white border-[#E8E4DB] text-[#0D0D0F]"
                      }`}
                    >
                      <div className="text-[13px] font-semibold">{m.label}</div>
                      <div className="text-[11px] opacity-75 mt-0.5 leading-snug">{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Audience Participation Toggle */}
              <div className="p-3.5 rounded-xl bg-white border border-[#E8E4DB] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#0D0D0F]">
                    Allow Audience Voting (1 vote/user)
                  </div>
                  <div className="text-[11px] text-[#6B6760]">
                    Spectators can cast one verified vote during the live round
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowAudienceVoting((v) => !v)}
                  className={`w-12 h-7 rounded-full transition p-0.5 cursor-pointer shrink-0 ${
                    allowAudienceVoting ? "bg-[#C9A96E]" : "bg-neutral-300"
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-full bg-white shadow transition-transform ${
                      allowAudienceVoting ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Assign Verified Judges */}
              {(judgingMethod === "human_judges" || judgingMethod === "hybrid") && (
                <div className="p-3.5 rounded-xl bg-white border border-[#E8E4DB] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[13px] font-semibold text-[#0D0D0F] flex items-center gap-1.5 min-w-0">
                      <Scale className="w-4 h-4 text-[#C9A96E] shrink-0" />
                      <span className="truncate">Assign Verified Judges (max 3)</span>
                    </div>
                    <span className="text-[11px] font-semibold text-[#6B6760] tabular-nums shrink-0">
                      {selectedJudgeIds.length}/3
                    </span>
                  </div>

                  {availableJudges.length === 0 ? (
                    <p className="text-[12px] text-[#6B6760]">
                      No other verified judges active yet — admin or automatic fallback can score if no judge is assigned.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                      {availableJudges.map((judge) => {
                        const selected = selectedJudgeIds.includes(judge.uid);
                        return (
                          <button
                            key={judge.uid}
                            type="button"
                            onClick={() => handleToggleJudge(judge.uid)}
                            className={`p-2 rounded-lg border flex items-center gap-2 text-left transition cursor-pointer min-w-0 ${
                              selected
                                ? "bg-[#C9A96E]/15 border-[#C9A96E] text-[#0D0D0F]"
                                : "border-[#E8E4DB] text-[#0D0D0F]"
                            }`}
                          >
                            <SmartImage
                              src={judge.photoUrl || DEFAULT_AVATAR}
                              alt={judge.name}
                              fallbackType="profile"
                              fullName={judge.name}
                              className="w-7 h-7 rounded-full object-cover shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-[12px] font-semibold truncate">{judge.name}</div>
                              <div className="text-[10px] text-[#6B6760] truncate">
                                {judge.categories.join(", ")}
                              </div>
                            </div>
                            {selected && <Check className="w-4 h-4 text-[#C9A96E] shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Judging Criteria Builder */}
              <div className="p-3.5 rounded-xl bg-white border border-[#E8E4DB] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-[#0D0D0F]">
                    Judging Criteria
                  </span>
                  <span
                    className={`text-[12px] font-bold tabular-nums ${
                      totalCriteriaWeight === 100 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    Total Weight: {totalCriteriaWeight}%
                  </span>
                </div>

                <div className="space-y-2">
                  {criteria.map((c, idx) => (
                    <div key={c.id} className="flex items-center gap-2 min-w-0">
                      <input
                        type="text"
                        value={c.label}
                        onChange={(e) =>
                          setCriteria((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, label: e.target.value } : item
                            )
                          )
                        }
                        placeholder="Criterion label"
                        className="flex-1 min-w-0 min-h-[40px] px-3 rounded-lg bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] text-[#0D0D0F]"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min={5}
                          max={100}
                          value={c.weight}
                          onChange={(e) =>
                            setCriteria((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? { ...item, weight: Math.max(0, Number(e.target.value) || 0) }
                                  : item
                              )
                            )
                          }
                          className="w-16 min-h-[40px] px-2 rounded-lg bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] text-center tabular-nums text-[#0D0D0F]"
                        />
                        <span className="text-[12px] text-[#6B6760]">%</span>
                      </div>
                      {criteria.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setCriteria((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label="Remove criterion"
                          className="w-9 h-9 rounded-lg flex items-center justify-center text-rose-500 hover:bg-rose-500/10 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {criteria.length < 6 && (
                  <button
                    type="button"
                    onClick={handleAddCriterion}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#8A6D3B] hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Criterion</span>
                  </button>
                )}
              </div>

              {/* Battle Rules */}
              <div className="p-3.5 rounded-xl bg-white border border-[#E8E4DB] space-y-2.5">
                <div className="text-[13px] font-semibold text-[#0D0D0F]">
                  Arena Rules
                </div>
                <div className="space-y-1.5">
                  {rules.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#F7F4EE] text-[12px] text-[#0D0D0F]"
                    >
                      <span className="break-words min-w-0">
                        {i + 1}. {r}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRules((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-[#6B6760] hover:text-rose-500 cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 min-w-0">
                  <input
                    type="text"
                    value={newRuleText}
                    onChange={(e) => setNewRuleText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddRule())}
                    placeholder="Add custom rule..."
                    className="flex-1 min-w-0 min-h-[40px] px-3 rounded-lg bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] text-[#0D0D0F]"
                  />
                  <button
                    type="button"
                    onClick={handleAddRule}
                    className="min-h-[40px] px-3.5 rounded-lg bg-[#0D0D0F] text-white text-[12px] font-semibold cursor-pointer shrink-0"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Optional Entry Requirements */}
              <div className="p-3.5 rounded-xl bg-white border border-[#E8E4DB] space-y-2.5">
                <div className="text-[13px] font-semibold text-[#0D0D0F]">
                  Optional Entry Requirements
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="number"
                    min={0}
                    value={minXp}
                    onChange={(e) => setMinXp(e.target.value)}
                    placeholder="Minimum Battle XP (e.g. 100)"
                    className="min-h-[40px] px-3 rounded-lg bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] text-[#0D0D0F]"
                  />
                  <input
                    type="text"
                    value={requiredSkill}
                    onChange={(e) => setRequiredSkill(e.target.value)}
                    placeholder="Required skill tag (optional)"
                    className="min-h-[40px] px-3 rounded-lg bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] text-[#0D0D0F]"
                  />
                </div>
                <label className="flex items-center gap-2 text-[12px] text-[#6B6760] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={verifiedOnly}
                    onChange={(e) => setVerifiedOnly(e.target.checked)}
                    className="rounded border-[#C9A96E]"
                  />
                  <span>Restrict open challengers to Verified SwapSkill members only</span>
                </label>
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-4">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-[#6B6760]">
                Arena Card Preview
              </div>

              {/* Preview Card */}
              <div className="rounded-2xl overflow-hidden bg-[#0D0D0F] text-white border border-[#C9A96E]/40 shadow-lg">
                {thumbnailUrl && (
                  <div className="h-36 w-full relative overflow-hidden">
                    <img
                      src={thumbnailUrl}
                      alt={title}
                      className="w-full h-full object-cover opacity-80"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0D0D0F] via-transparent to-transparent" />
                  </div>
                )}

                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-[#C9A96E]/20 text-[#C9A96E]">
                      {selectedCategoryObj?.name || category} · {customSkill}
                    </span>
                    <span className="text-[11px] font-semibold text-neutral-300 flex items-center gap-1">
                      {visibility === "public" ? (
                        <Globe className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                      )}
                      {visibility === "public" ? "Public Arena" : "Private Invite"}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-[18px] font-bold leading-snug">{title}</h3>
                    {description && (
                      <p className="text-[13px] text-neutral-300 mt-1 line-clamp-2">
                        {description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <SmartImage
                        src={currentUser.photoUrl || DEFAULT_AVATAR}
                        alt={currentUser.fullName}
                        fallbackType="profile"
                        fullName={currentUser.fullName}
                        className="w-8 h-8 rounded-full object-cover border border-[#C9A96E]/60"
                      />
                      <span className="text-[13px] font-semibold truncate">
                        {currentUser.fullName}
                      </span>
                    </div>

                    <span className="text-[11px] font-bold text-[#C9A96E] px-2 py-0.5 rounded bg-[#C9A96E]/10">
                      VS
                    </span>

                    <div className="flex items-center gap-2 min-w-0 justify-end">
                      <span className="text-[13px] font-semibold truncate text-neutral-200">
                        {mode === "direct" && selectedOpponent
                          ? selectedOpponent.fullName
                          : "Open Challenger"}
                      </span>
                      {mode === "direct" && selectedOpponent ? (
                        <SmartImage
                          src={selectedOpponent.photoUrl || DEFAULT_AVATAR}
                          alt={selectedOpponent.fullName}
                          fallbackType="profile"
                          fullName={selectedOpponent.fullName}
                          className="w-8 h-8 rounded-full object-cover border border-white/20"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <Users className="w-4 h-4 text-[#C9A96E]" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[12px] text-neutral-300 pt-1">
                    <span className="flex items-center gap-1 tabular-nums">
                      <Clock className="w-3.5 h-3.5 text-[#C9A96E]" />
                      {durationMinutes} min
                    </span>
                    <span className="flex items-center gap-1">
                      <Scale className="w-3.5 h-3.5 text-[#C9A96E]" />
                      {judgingMethod === "automatic"
                        ? "Automatic Scoring"
                        : judgingMethod === "human_judges"
                        ? "Verified Judges"
                        : "Hybrid Judging"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Award className="w-3.5 h-3.5 text-[#C9A96E]" />
                      {allowAudienceVoting ? "Audience Vote Enabled" : "Judge/Auto Only"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="px-4 sm:px-5 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-white border-t border-[#E8E4DB] flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              setError(null);
              if (step === "setup") onClose();
              else if (step === "rules") setStep("setup");
              else setStep("rules");
            }}
            className="min-h-[44px] px-4 rounded-xl bg-[#EFECE4] text-[#0D0D0F] text-[13px] font-semibold cursor-pointer whitespace-nowrap"
          >
            {step === "setup" ? "Cancel" : "Back"}
          </button>

          {step !== "review" ? (
            <button
              type="button"
              onClick={handleNext}
              className="min-h-[44px] px-6 rounded-xl bg-[#0D0D0F] text-white text-[13px] font-semibold cursor-pointer whitespace-nowrap flex items-center gap-2"
            >
              <span>Continue</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="min-h-[44px] px-5 sm:px-6 rounded-xl bg-[#C9A96E] hover:bg-[#b8975b] text-[#0D0D0F] text-[13px] font-bold cursor-pointer whitespace-nowrap flex items-center gap-2 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>
                {mode === "direct" ? "Send Battle Challenge" : "Launch Open Battle"}
              </span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};
