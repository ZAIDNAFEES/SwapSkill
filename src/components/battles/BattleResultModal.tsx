import React, { useState } from "react";
import {
  Trophy,
  X,
  Sparkles,
  Award,
  Share2,
  Check,
  Scale,
  BarChart3,
  MessageSquare,
} from "lucide-react";
import { motion } from "motion/react";
import { BATTLE_BADGE_CATALOG, BattleResult } from "../../types/battle";
import { DEFAULT_AVATAR } from "../../types";
import { SmartImage } from "../SmartImage";
import { useBackHandler } from "../../utils/navigationManager";

interface BattleResultModalProps {
  isOpen: boolean;
  result: BattleResult | null;
  currentUserId: string;
  onClose: () => void;
  onOpenLeaderboard?: () => void;
}

export const BattleResultModal: React.FC<BattleResultModalProps> = ({
  isOpen,
  result,
  currentUserId,
  onClose,
  onOpenLeaderboard,
}) => {
  const [copied, setCopied] = useState(false);

  useBackHandler(Boolean(isOpen && result), onClose);

  if (!isOpen || !result) return null;

  const isWinner = !result.isDraw && result.winnerId === currentUserId;
  const myUnlockedBadges = result.badgesUnlocked?.[currentUserId] || [];

  const handleShare = async () => {
    const text = result.isDraw
      ? `Skill Battle Draw in "${result.battleTitle}" (${result.finalScoreA} vs ${result.finalScoreB}) on SwapSkill Arena!`
      : `${result.winnerName} won "${result.battleTitle}" (${result.finalScoreA} vs ${result.finalScoreB}) on SwapSkill Arena!`;
    try {
      if (navigator.share) {
        await navigator.share({ title: result.battleTitle, text });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (_) {}
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 24 }}
        transition={{ type: "spring", stiffness: 280, damping: 24 }}
        className="w-full sm:max-w-xl max-h-[92dvh] flex flex-col rounded-t-[26px] sm:rounded-[26px] bg-[#0D0E13] text-white border border-[#C9A96E]/40 shadow-2xl overflow-hidden"
      >
        {/* Top Hero Banner */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-b from-[#1E1A12] via-[#13141B] to-[#0D0E13] border-b border-white/10 text-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Result"
            className="absolute right-4 top-4 w-10 h-10 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-neutral-300 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <motion.div
            initial={{ scale: 0.6, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
            className="w-16 h-16 mx-auto rounded-2xl bg-[#C9A96E]/20 border border-[#C9A96E] flex items-center justify-center text-[#C9A96E] shadow-[0_0_30px_rgba(201,169,110,0.3)] mb-3"
          >
            <Trophy className="w-8 h-8" />
          </motion.div>

          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#C9A96E]">
            {result.isDraw
              ? "Official Draw Verdict"
              : isWinner
              ? "Victory Claimed"
              : "Official Battle Result"}
          </div>
          <h2 className="text-[22px] font-extrabold tracking-tight mt-1">
            {result.isDraw ? "Deadlocked Match" : `${result.winnerName} Wins!`}
          </h2>
          <p className="text-[13px] text-neutral-300 mt-0.5">
            {result.battleTitle} · {result.customSkill}
          </p>
        </div>

        {/* Scrollable Breakdown */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Scoreboard Face-Off */}
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                uid: result.creatorId,
                name: result.competitorAName,
                photo: result.competitorAPhoto,
                score: result.finalScoreA,
                votes: result.audienceVotesA,
                won: result.winnerId === result.creatorId,
              },
              {
                uid: result.opponentId,
                name: result.competitorBName,
                photo: result.competitorBPhoto,
                score: result.finalScoreB,
                votes: result.audienceVotesB,
                won: result.winnerId === result.opponentId,
              },
            ].map((comp) => (
              <div
                key={comp.uid}
                className={`p-3.5 rounded-2xl border ${
                  comp.won
                    ? "bg-[#C9A96E]/12 border-[#C9A96E]"
                    : "bg-white/[0.03] border-white/10"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <SmartImage
                    src={comp.photo || DEFAULT_AVATAR}
                    alt={comp.name}
                    fallbackType="profile"
                    fullName={comp.name}
                    className="w-10 h-10 rounded-full object-cover border border-white/20 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold truncate">{comp.name}</div>
                    <div className="text-[11px] text-[#C9A96E] font-semibold">
                      {result.isDraw ? "Draw" : comp.won ? "Winner" : "Runner-Up"}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-[28px] font-black tabular-nums text-white">
                    {comp.score}
                  </span>
                  <span className="text-[11px] text-neutral-400 tabular-nums">
                    {comp.votes} fan votes
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* XP & Unlocked Badges */}
          <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-5 h-5 text-[#C9A96E] shrink-0" />
              <div>
                <div className="text-[13px] font-semibold">XP Rewards Dispatched</div>
                <div className="text-[12px] text-neutral-400 tabular-nums">
                  Winner +{result.xpAwardedWinner} XP · Competitor +{result.xpAwardedParticipant} XP
                </div>
              </div>
            </div>
            {myUnlockedBadges.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {myUnlockedBadges.map((bId) => (
                  <span
                    key={bId}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#C9A96E]/20 text-[#C9A96E]"
                  >
                    <Award className="w-3.5 h-3.5" />
                    {BATTLE_BADGE_CATALOG[bId]?.label || bId}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Criteria Breakdown */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-[#C9A96E]" />
                Criteria Breakdown
              </span>
              <span className="text-[11px] text-neutral-400 flex items-center gap-1">
                <Scale className="w-3.5 h-3.5" />
                {result.judgingMethod.replace("_", " ")}
              </span>
            </div>

            <div className="space-y-2.5">
              {result.criteriaBreakdown.map((c) => (
                <div key={c.criterionId} className="space-y-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-medium text-neutral-200">
                      {c.label} <span className="text-neutral-500">({c.weight}%)</span>
                    </span>
                    <span className="font-bold tabular-nums text-[#C9A96E]">
                      {c.scoreA} vs {c.scoreB}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 h-1.5">
                    <div className="bg-white/10 rounded-full overflow-hidden flex justify-end">
                      <div
                        className="bg-[#C9A96E] h-full rounded-full"
                        style={{ width: `${Math.min(100, c.scoreA * 10)}%` }}
                      />
                    </div>
                    <div className="bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="bg-sky-400 h-full rounded-full"
                        style={{ width: `${Math.min(100, c.scoreB * 10)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Judge Feedbacks */}
          {result.judgeFeedbacks.length > 0 && (
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
              <div className="text-[12px] font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-[#C9A96E]" />
                Judge Evaluations
              </div>
              {result.judgeFeedbacks.map((jf) => (
                <div
                  key={jf.judgeId}
                  className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1.5 text-[12px]"
                >
                  <div className="font-semibold text-[#C9A96E]">Judge {jf.judgeName}</div>
                  {jf.feedbackA && (
                    <p className="text-neutral-300">
                      <span className="font-semibold text-white">{result.competitorAName}: </span>
                      {jf.feedbackA}
                    </p>
                  )}
                  {jf.feedbackB && (
                    <p className="text-neutral-300">
                      <span className="font-semibold text-white">{result.competitorBName}: </span>
                      {jf.feedbackB}
                    </p>
                  )}
                  {jf.overallNote && <p className="text-neutral-400 italic">{jf.overallNote}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 sm:px-5 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] bg-[#14151C] border-t border-white/10 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleShare}
            className="min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[13px] font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
            <span>{copied ? "Copied" : "Share Result"}</span>
          </button>

          <div className="flex items-center gap-2">
            {onOpenLeaderboard && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenLeaderboard();
                }}
                className="min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-[#C9A96E] text-[13px] font-semibold cursor-pointer whitespace-nowrap"
              >
                Leaderboard
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-5 rounded-xl bg-[#C9A96E] text-[#0D0D0F] text-[13px] font-bold cursor-pointer whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
