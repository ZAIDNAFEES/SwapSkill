import React, { useMemo, useState, useEffect } from "react";
import { Scale, Lock, CheckCircle2, Sparkles } from "lucide-react";
import { Battle, BattleScore } from "../../types/battle";

interface JudgeScorecardPanelProps {
  battle: Battle;
  scores: BattleScore[];
  currentUserId: string;
  canScoreAsJudge: boolean;
  onSubmitScore: (input: {
    competitorAScores: Record<string, number>;
    competitorBScores: Record<string, number>;
    feedbackA: string;
    feedbackB: string;
    overallNote: string;
  }) => Promise<void>;
}

export const JudgeScorecardPanel: React.FC<JudgeScorecardPanelProps> = ({
  battle,
  scores,
  currentUserId,
  canScoreAsJudge,
  onSubmitScore,
}) => {
  const [scoresA, setScoresA] = useState<Record<string, number>>({});
  const [scoresB, setScoresB] = useState<Record<string, number>>({});
  const [feedbackA, setFeedbackA] = useState("");
  const [feedbackB, setFeedbackB] = useState("");
  const [overallNote, setOverallNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!battle?.criteria) return;
    setScoresA((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, number> = {};
      battle.criteria.forEach((c) => (next[c.id] = 7));
      return next;
    });
    setScoresB((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, number> = {};
      battle.criteria.forEach((c) => (next[c.id] = 7));
      return next;
    });
  }, [battle.id]);

  const alreadySubmitted = useMemo(
    () => scores.some((s) => s.judgeId === currentUserId),
    [scores, currentUserId]
  );

  const liveWeighted = useMemo(() => {
    let totalA = 0;
    let totalB = 0;
    for (const c of battle.criteria || []) {
      const maxS = c.maxScore || 10;
      const a = Math.min(maxS, Math.max(0, Number(scoresA[c.id] ?? 7)));
      const b = Math.min(maxS, Math.max(0, Number(scoresB[c.id] ?? 7)));
      totalA += ((a / maxS) * 100 * c.weight) / 100;
      totalB += ((b / maxS) * 100 * c.weight) / 100;
    }
    return {
      a: Math.round(totalA * 10) / 10,
      b: Math.round(totalB * 10) / 10,
    };
  }, [battle.criteria, scoresA, scoresB]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || alreadySubmitted) return;
    setSubmitting(true);
    try {
      await onSubmitScore({
        competitorAScores: scoresA,
        competitorBScores: scoresB,
        feedbackA,
        feedbackB,
        overallNote,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 bg-[#0C0E14] text-white">
      {/* Official Judge Panel Header */}
      <div className="p-3 rounded-xl bg-[#131621] border border-white/10 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#C9A96E] uppercase tracking-wider">
            <Scale className="w-3.5 h-3.5" />
            <span>Official Evaluation</span>
          </div>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white/10 text-neutral-200 capitalize">
            {battle.judgingMethod.replace("_", " ")}
          </span>
        </div>
        <p className="text-[11px] text-neutral-400 leading-relaxed">
          {battle.judges?.length
            ? `Assigned panel: ${battle.judges.map((j) => j.name).join(", ")}.`
            : "Evaluated by verified arena scoring criteria."}{" "}
          Official judge scorecards are weighted separately from audience cheering & polls.
        </p>
      </div>

      {/* Judge Submission Form */}
      {canScoreAsJudge && !alreadySubmitted && battle.status !== "completed" && (
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Live Calculated Weighted Preview */}
          <div className="p-3 rounded-xl bg-gradient-to-r from-[#C9A96E]/15 via-[#141722] to-white/5 border border-[#C9A96E]/40 flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#C9A96E]">
                Live Rubric Total
              </div>
              <div className="text-[13px] font-bold mt-0.5 tabular-nums">
                {battle.competitorA.name}: <span className="text-[#C9A96E]">{liveWeighted.a}</span>
                {" · "}
                {battle.competitorB?.name || "Opponent"}:{" "}
                <span className="text-sky-300">{liveWeighted.b}</span>
              </div>
            </div>
            <Sparkles className="w-4 h-4 text-[#C9A96E] shrink-0" />
          </div>

          {battle.criteria.map((c) => (
            <div
              key={c.id}
              className="p-3 rounded-xl bg-[#131621] border border-white/10 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">{c.label}</span>
                <span className="text-[11px] font-bold text-[#C9A96E] tabular-nums">
                  {c.weight}% weight
                </span>
              </div>

              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-neutral-300 truncate">{battle.competitorA.name}</span>
                    <span className="font-bold text-[#C9A96E] tabular-nums">
                      {(scoresA[c.id] ?? 7).toFixed(1)} / {c.maxScore}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={c.maxScore}
                    step={0.5}
                    value={scoresA[c.id] ?? 7}
                    onChange={(e) =>
                      setScoresA((prev) => ({
                        ...prev,
                        [c.id]: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-[#C9A96E] cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-neutral-300 truncate">
                      {battle.competitorB?.name || "Opponent"}
                    </span>
                    <span className="font-bold text-sky-300 tabular-nums">
                      {(scoresB[c.id] ?? 7).toFixed(1)} / {c.maxScore}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={c.maxScore}
                    step={0.5}
                    value={scoresB[c.id] ?? 7}
                    onChange={(e) =>
                      setScoresB((prev) => ({
                        ...prev,
                        [c.id]: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          ))}

          <textarea
            rows={2}
            value={feedbackA}
            onChange={(e) => setFeedbackA(e.target.value)}
            placeholder={`Written feedback for ${battle.competitorA.name}...`}
            className="w-full p-2.5 rounded-xl bg-[#131621] border border-white/10 text-[12px] text-white placeholder:text-neutral-500 resize-none focus:outline-none focus:border-[#C9A96E]"
          />
          <textarea
            rows={2}
            value={feedbackB}
            onChange={(e) => setFeedbackB(e.target.value)}
            placeholder={`Written feedback for ${battle.competitorB?.name || "Opponent"}...`}
            className="w-full p-2.5 rounded-xl bg-[#131621] border border-white/10 text-[12px] text-white placeholder:text-neutral-500 resize-none focus:outline-none focus:border-[#C9A96E]"
          />
          <input
            type="text"
            value={overallNote}
            onChange={(e) => setOverallNote(e.target.value)}
            placeholder="Overall verdict note (optional)"
            className="w-full min-h-[40px] px-3 rounded-xl bg-[#131621] border border-white/10 text-[12px] text-white placeholder:text-neutral-500 focus:outline-none focus:border-[#C9A96E]"
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[44px] rounded-xl bg-[#C9A96E] hover:bg-[#b8975b] text-[#0D0D0F] text-[13px] font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Lock className="w-4 h-4" />
            <span>{submitting ? "Locking Scorecard..." : "Submit & Lock Official Score"}</span>
          </button>
        </form>
      )}

      {/* Submitted Official Scorecards */}
      <div className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
          Submitted Official Scorecards ({scores.length})
        </div>

        {scores.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#131621] border border-white/10 text-center text-[12px] text-neutral-400">
            No official judge scorecards locked yet.
          </div>
        ) : (
          scores.map((sc) => (
            <div
              key={sc.id}
              className="p-3 rounded-xl bg-[#131621] border border-white/10 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#C9A96E]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{sc.judgeName}</span>
                </div>
                <span className="text-[12px] font-extrabold tabular-nums">
                  {sc.weightedTotalA} vs {sc.weightedTotalB}
                </span>
              </div>
              {(sc.feedbackA || sc.feedbackB || sc.overallNote) && (
                <div className="space-y-1 text-[11px] text-neutral-300 border-t border-white/10 pt-2">
                  {sc.overallNote && <p className="font-medium text-white">{sc.overallNote}</p>}
                  {sc.feedbackA && (
                    <p>
                      <strong className="text-[#C9A96E]">{battle.competitorA.name}:</strong>{" "}
                      {sc.feedbackA}
                    </p>
                  )}
                  {sc.feedbackB && (
                    <p>
                      <strong className="text-sky-300">
                        {battle.competitorB?.name || "Opponent"}:
                      </strong>{" "}
                      {sc.feedbackB}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
