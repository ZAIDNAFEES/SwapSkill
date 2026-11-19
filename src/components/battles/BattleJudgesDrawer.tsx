import React, { useEffect, useState } from "react";
import {
  X,
  Scale,
  ShieldCheck,
  CheckCircle2,
  Clock,
  UserPlus,
  Loader2,
  Award,
  Trophy,
} from "lucide-react";
import {
  Battle,
  BattleJudge,
  BattleScore,
} from "../../types/battle";
import { DEFAULT_AVATAR } from "../../types";
import { SmartImage } from "../SmartImage";
import { JudgeScorecardPanel } from "./JudgeScorecardPanel";
import { fetchActiveVerifiedJudges } from "../../services/battleService";

interface BattleJudgesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  battle: Battle;
  scores: BattleScore[];
  currentUserId: string;
  isCreator: boolean;
  isCompetitor: boolean;
  isAssignedJudge: boolean;
  isAdmin: boolean;
  canScoreAsJudge: boolean;
  actionBusy?: boolean;
  onSubmitScore?: (input: {
    competitorAScores: Record<string, number>;
    competitorBScores: Record<string, number>;
    feedbackA: string;
    feedbackB: string;
    overallNote: string;
  }) => Promise<void>;
  onAssignJudge?: (judge: BattleJudge) => Promise<void>;
  onFinalizeResult?: () => void;
  onOpenJudgeApplication?: () => void;
  onViewProfile?: (uid: string) => void;
}

export const BattleJudgesDrawer: React.FC<BattleJudgesDrawerProps> = ({
  isOpen,
  onClose,
  battle,
  scores,
  currentUserId,
  isCreator,
  isCompetitor,
  isAssignedJudge,
  isAdmin,
  canScoreAsJudge,
  actionBusy = false,
  onSubmitScore,
  onAssignJudge,
  onFinalizeResult,
  onOpenJudgeApplication,
  onViewProfile,
}) => {
  const [availableJudges, setAvailableJudges] = useState<BattleJudge[]>([]);
  const [loadingJudges, setLoadingJudges] = useState(false);
  const [assigningUid, setAssigningUid] = useState<string | null>(null);
  const [showAssignList, setShowAssignList] = useState(false);

  const canManageJudges =
    (isCreator || isAdmin) &&
    battle.status !== "completed" &&
    battle.status !== "cancelled" &&
    (battle.judges?.length || 0) < 3;

  useEffect(() => {
    if (!isOpen || !showAssignList || !canManageJudges) return;
    let cancelled = false;
    setLoadingJudges(true);
    fetchActiveVerifiedJudges()
      .then((list) => {
        if (!cancelled) {
          const assignedSet = new Set(battle.judgeIds || []);
          setAvailableJudges(
            list.filter(
              (j) =>
                j.uid !== battle.creatorId &&
                j.uid !== battle.opponentId &&
                !assignedSet.has(j.uid)
            )
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingJudges(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, showAssignList, canManageJudges, battle.creatorId, battle.opponentId, battle.judgeIds]);

  if (!isOpen) return null;

  const assignedJudges = battle.judges || [];
  const submittedCount = scores.length;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[96] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[88dvh] rounded-t-[26px] sm:rounded-[26px] bg-[#10131C] border border-white/12 text-white flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-2 bg-[#141824] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#C9A96E]/15 border border-[#C9A96E]/40 flex items-center justify-center text-[#C9A96E] shrink-0">
              <Scale className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold tracking-tight truncate">
                Official Arena Judges
              </h3>
              <p className="text-[11px] text-neutral-400 truncate">
                {battle.judgingMethod === "automatic"
                  ? "Automatic Scoring + Audience Polls"
                  : `${assignedJudges.length} Assigned · ${submittedCount} Scorecard${
                      submittedCount === 1 ? "" : "s"
                    } Locked`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Judges Drawer"
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Assigned Judges Panel */}
          <div className="p-4 space-y-2.5 border-b border-white/10">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#C9A96E]">
                Assigned Verified Judges ({assignedJudges.length}/3)
              </span>
              {canManageJudges && onAssignJudge && (
                <button
                  type="button"
                  onClick={() => setShowAssignList((v) => !v)}
                  className="px-2.5 py-1 rounded-lg bg-[#C9A96E]/15 hover:bg-[#C9A96E]/25 border border-[#C9A96E]/40 text-[#C9A96E] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{showAssignList ? "Hide List" : "Assign Judge"}</span>
                </button>
              )}
            </div>

            {assignedJudges.length === 0 ? (
              <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-[12px] text-neutral-300 flex items-center justify-between gap-2">
                <span>
                  {battle.judgingMethod === "automatic"
                    ? "This battle uses Automatic Performance + Audience scoring."
                    : "No verified judges assigned yet."}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {assignedJudges.map((j) => {
                  const hasScored = Boolean(j.submitted || scores.some((s) => s.judgeId === j.uid));
                  return (
                    <div
                      key={j.uid}
                      className="p-2.5 rounded-xl bg-[#161A26] border border-white/10 flex items-center justify-between gap-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => onViewProfile?.(j.uid)}
                        className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
                      >
                        <SmartImage
                          src={j.photoUrl || DEFAULT_AVATAR}
                          alt={j.name}
                          fallbackType="profile"
                          fullName={j.name}
                          className="w-9 h-9 rounded-full object-cover border border-[#C9A96E]/50 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-[13px] font-bold text-white truncate">
                              {j.name}
                            </span>
                            <ShieldCheck className="w-3.5 h-3.5 text-[#C9A96E] shrink-0" />
                          </div>
                          <div className="text-[11px] text-neutral-400 truncate">
                            {j.specialty || "Verified Arena Judge"}
                          </div>
                        </div>
                      </button>

                      <span
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 shrink-0 ${
                          hasScored
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-amber-500/15 text-amber-300 border border-amber-500/25"
                        }`}
                      >
                        {hasScored ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Scored</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3" />
                            <span>Live Panel</span>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Quick Assign Verified Judges Picker (Host/Admin only) */}
            {showAssignList && canManageJudges && onAssignJudge && (
              <div className="mt-2 p-3 rounded-xl bg-black/40 border border-[#C9A96E]/30 space-y-2">
                <div className="text-[11px] font-bold text-neutral-300">
                  Select a Verified SwapSkill Judge
                </div>
                {loadingJudges ? (
                  <div className="py-3 flex items-center justify-center text-neutral-400 text-[12px] gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#C9A96E]" />
                    <span>Loading verified panel...</span>
                  </div>
                ) : availableJudges.length === 0 ? (
                  <div className="text-[11px] text-neutral-400 py-1">
                    No other active verified judges available right now.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {availableJudges.map((j) => (
                      <div
                        key={j.uid}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <SmartImage
                            src={j.photoUrl || DEFAULT_AVATAR}
                            alt={j.name}
                            fallbackType="profile"
                            fullName={j.name}
                            className="w-7 h-7 rounded-full object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-[12px] font-bold truncate">{j.name}</div>
                            <div className="text-[10px] text-neutral-400 truncate">
                              {j.categories?.[0] || "All Skills"} · {j.yearsExperience}y exp
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={assigningUid === j.uid}
                          onClick={async () => {
                            setAssigningUid(j.uid);
                            try {
                              await onAssignJudge(j);
                              setAvailableJudges((prev) => prev.filter((x) => x.uid !== j.uid));
                            } finally {
                              setAssigningUid(null);
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#C9A96E] text-[#0D0D0F] text-[11px] font-bold cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          {assigningUid === j.uid ? "Adding..." : "Assign"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Interactive Scorecard Panel (or read-only official scorecards) */}
          <JudgeScorecardPanel
            battle={battle}
            scores={scores}
            currentUserId={currentUserId}
            canScoreAsJudge={Boolean(canScoreAsJudge && onSubmitScore)}
            onSubmitScore={onSubmitScore || (async () => {})}
          />

          {/* Finalize Match CTA for Judges/Admin */}
          {(isAssignedJudge || isAdmin) &&
            onFinalizeResult &&
            (battle.status === "judging" ||
              (battle.status === "live" && battle.judgingMethod === "automatic")) && (
              <div className="px-4 pb-3">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => {
                    onClose();
                    onFinalizeResult();
                  }}
                  className="w-full min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0D0D0F] text-[13px] font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Trophy className="w-4 h-4" />
                  <span>Finalize Official Result & Award XP</span>
                </button>
              </div>
            )}

          {/* Become a Verified Judge CTA */}
          {!isAssignedJudge && !isCompetitor && onOpenJudgeApplication && (
            <div className="px-4 pb-4">
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-[#C9A96E]/15 via-[#161A26] to-white/5 border border-[#C9A96E]/35 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-bold text-[#C9A96E] flex items-center gap-1.5">
                    <Award className="w-4 h-4 shrink-0" />
                    <span>Verify as an Arena Judge</span>
                  </div>
                  <p className="text-[11px] text-neutral-300 mt-0.5">
                    Evaluate future live Skill Battles and earn Judge XP badges.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenJudgeApplication();
                  }}
                  className="px-3 py-2 rounded-xl bg-[#C9A96E] text-[#0D0D0F] text-[11px] font-bold shrink-0 cursor-pointer"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
