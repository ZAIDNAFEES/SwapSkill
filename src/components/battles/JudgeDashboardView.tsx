import React, { useEffect, useState } from "react";
import {
  Scale,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Swords,
  ShieldCheck,
  Loader2,
  Award,
} from "lucide-react";
import { Battle, BattleScore } from "../../types/battle";
import {
  BattleUserActor,
  fetchJudgeAssignedBattles,
  fetchJudgeCompletedScores,
} from "../../services/battleService";

interface JudgeDashboardViewProps {
  currentUser: BattleUserActor;
  isVerifiedJudge: boolean;
  onBack: () => void;
  onOpenBattle: (battle: Battle) => void;
  onApplyJudge: () => void;
}

export const JudgeDashboardView: React.FC<JudgeDashboardViewProps> = ({
  currentUser,
  isVerifiedJudge,
  onBack,
  onOpenBattle,
  onApplyJudge,
}) => {
  const [assignedBattles, setAssignedBattles] = useState<Battle[]>([]);
  const [completedScores, setCompletedScores] = useState<BattleScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchJudgeAssignedBattles(currentUser.uid),
      fetchJudgeCompletedScores(currentUser.uid),
    ])
      .then(([battles, scores]) => {
        if (!active) return;
        setAssignedBattles(battles);
        setCompletedScores(scores);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser.uid]);

  const scoredBattleIds = new Set(completedScores.map((s) => s.battleId));
  const pendingEvaluations = assignedBattles.filter(
    (b) => b.status !== "cancelled" && !scoredBattleIds.has(b.id)
  );
  const completedEvaluations = assignedBattles.filter((b) => scoredBattleIds.has(b.id));

  return (
    <div className="w-full min-w-0 space-y-5">
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
                Judge Command Desk
              </h2>
              {isVerifiedJudge && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 text-[11px] font-bold shrink-0">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Verified
                </span>
              )}
            </div>
            <p className="text-[12px] text-[#6B6760] truncate">
              Assigned evaluations & historical scorecards
            </p>
          </div>
        </div>

        {!isVerifiedJudge && (
          <button
            type="button"
            onClick={onApplyJudge}
            className="min-h-[42px] px-4 rounded-xl bg-[#0D0D0F] text-white text-[13px] font-semibold cursor-pointer whitespace-nowrap"
          >
            Apply as Verified Judge
          </button>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
        <div className="p-3.5 sm:p-4 rounded-2xl bg-white border border-[#E8E4DB] min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6760] truncate">
            Assigned Queue
          </div>
          <div className="text-[22px] sm:text-[24px] font-black tabular-nums text-[#0D0D0F] mt-1">
            {pendingEvaluations.length}
          </div>
        </div>
        <div className="p-3.5 sm:p-4 rounded-2xl bg-white border border-[#E8E4DB] min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6760] truncate">
            Completed Scores
          </div>
          <div className="text-[22px] sm:text-[24px] font-black tabular-nums text-emerald-600 mt-1">
            {completedScores.length}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1 p-3.5 sm:p-4 rounded-2xl bg-white border border-[#E8E4DB] min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6760]">
            Status
          </div>
          <div className="text-[14px] font-bold text-[#8A6D3B] mt-1.5">
            {isVerifiedJudge ? "Active Panelist" : "Applicant"}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-[#C9A96E]" />
        </div>
      ) : (
        <div className="space-y-6 min-w-0">
          {/* Pending Queue */}
          <div className="space-y-3 min-w-0">
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-[#6B6760] flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              Pending Evaluations ({pendingEvaluations.length})
            </h3>
            {pendingEvaluations.length === 0 ? (
              <div className="p-6 rounded-2xl bg-white border border-[#E8E4DB] text-center text-[13px] text-[#6B6760]">
                No battles currently awaiting your official scorecard.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pendingEvaluations.map((b) => (
                  <div
                    key={b.id}
                    className="p-4 rounded-2xl bg-white border border-[#E8E4DB] flex flex-col justify-between gap-3 min-w-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#C9A96E] truncate">
                          {b.customSkill}
                        </span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 uppercase shrink-0">
                          {b.status.replace("_", " ")}
                        </span>
                      </div>
                      <h4 className="text-[15px] font-bold text-[#0D0D0F] mt-1 break-words">
                        {b.title}
                      </h4>
                      <p className="text-[12px] text-[#6B6760] mt-1 truncate">
                        {b.competitorA.name} vs {b.competitorB?.name || "Open Slot"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenBattle(b)}
                      className="min-h-[44px] w-full rounded-xl bg-[#0D0D0F] text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Scale className="w-4 h-4 text-[#C9A96E]" />
                      <span>Enter Arena & Score</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Completed Evaluations */}
          <div className="space-y-3 min-w-0">
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-[#6B6760] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Submitted Scorecards ({completedScores.length})
            </h3>
            {completedEvaluations.length === 0 && completedScores.length === 0 ? (
              <div className="p-6 rounded-2xl bg-white border border-[#E8E4DB] text-center text-[13px] text-[#6B6760]">
                Your submitted battle scorecards will appear here.
              </div>
            ) : (
              <div className="space-y-2.5">
                {completedScores.map((sc) => {
                  const matchedBattle = assignedBattles.find((b) => b.id === sc.battleId);
                  return (
                    <div
                      key={sc.id}
                      className="p-4 rounded-2xl bg-white border border-[#E8E4DB] flex items-center justify-between gap-3 min-w-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-bold text-[#0D0D0F] truncate flex items-center gap-2">
                          <Swords className="w-4 h-4 text-[#C9A96E] shrink-0" />
                          <span className="truncate">{matchedBattle?.title || `Battle ${sc.battleId}`}</span>
                        </div>
                        <div className="text-[12px] text-[#6B6760] mt-0.5 tabular-nums">
                          Scored {sc.weightedTotalA} vs {sc.weightedTotalB} ·{" "}
                          {new Date(sc.submittedAtMs).toLocaleDateString()}
                        </div>
                      </div>
                      {matchedBattle && (
                        <button
                          type="button"
                          onClick={() => onOpenBattle(matchedBattle)}
                          className="min-h-[40px] px-3.5 rounded-lg bg-[#EFECE4] text-[12px] font-semibold text-[#0D0D0F] cursor-pointer whitespace-nowrap shrink-0"
                        >
                          View
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
