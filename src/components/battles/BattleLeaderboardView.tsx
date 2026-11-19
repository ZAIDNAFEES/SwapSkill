import React, { useEffect, useState } from "react";
import { ArrowLeft, Trophy, Award, Flame, ShieldCheck, Loader2 } from "lucide-react";
import { BattleCategoryItem, BattleProfile } from "../../types/battle";
import { DEFAULT_AVATAR } from "../../types";
import { fetchBattleLeaderboard } from "../../services/battleService";
import { SmartImage } from "../SmartImage";

interface BattleLeaderboardViewProps {
  categories: BattleCategoryItem[];
  currentUserId: string;
  onBack: () => void;
  onViewProfile: (uid: string) => void;
}

export const BattleLeaderboardView: React.FC<BattleLeaderboardViewProps> = ({
  categories,
  currentUserId,
  onBack,
  onViewProfile,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [entries, setEntries] = useState<BattleProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchBattleLeaderboard(selectedCategory, 25)
      .then((res) => {
        if (active) setEntries(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedCategory]);

  return (
    <div className="w-full min-w-0 space-y-4 sm:space-y-5">
      <div className="flex items-center justify-between gap-3 min-w-0">
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
            <h2 className="text-[18px] sm:text-[20px] font-bold text-[#0D0D0F] tracking-tight flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#C9A96E] shrink-0" />
              <span className="truncate">Arena Leaderboard</span>
            </h2>
            <p className="text-[12px] text-[#6B6760] truncate">
              Top Skill Battle competitors ranked by Battle XP
            </p>
          </div>
        </div>
      </div>

      {/* Category Filter Row */}
      <div className="w-full max-w-full min-w-0 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar touch-pan-x">
        <button
          type="button"
          onClick={() => setSelectedCategory("all")}
          className={`min-h-[40px] px-3.5 rounded-xl text-[12px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition ${
            selectedCategory === "all"
              ? "bg-[#0D0D0F] text-white"
              : "bg-white border border-[#E8E4DB] text-[#0D0D0F]"
          }`}
        >
          Global Top 25
        </button>
        {categories
          .filter((c) => c.enabled)
          .map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`min-h-[40px] px-3.5 rounded-xl text-[12px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition ${
                selectedCategory === cat.id
                  ? "bg-[#0D0D0F] text-white"
                  : "bg-white border border-[#E8E4DB] text-[#0D0D0F]"
              }`}
            >
              {cat.name}
            </button>
          ))}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-[#C9A96E]" />
        </div>
      ) : entries.length === 0 ? (
        <div className="w-full min-w-0 p-6 sm:p-8 rounded-2xl bg-white border border-[#E8E4DB] text-center space-y-2">
          <Trophy className="w-8 h-8 text-[#C9A96E] mx-auto opacity-80" />
          <div className="text-[15px] font-bold text-[#0D0D0F]">
            No Ranked Competitors Yet
          </div>
          <p className="text-[13px] text-[#6B6760] max-w-md mx-auto leading-relaxed">
            Complete an official Skill Battle in this category to claim Rank #1 on the leaderboard.
          </p>
        </div>
      ) : (
        <div className="w-full min-w-0 rounded-2xl bg-white border border-[#E8E4DB] overflow-hidden divide-y divide-[#E8E4DB]/60">
          {entries.map((entry, idx) => {
            const rank = idx + 1;
            const isMe = entry.uid === currentUserId;
            return (
              <button
                key={entry.uid}
                type="button"
                onClick={() => onViewProfile(entry.uid)}
                className={`w-full px-3 sm:px-4 py-3 flex items-center justify-between gap-2.5 sm:gap-3 text-left transition hover:bg-[#F7F4EE]/70 cursor-pointer min-w-0 ${
                  isMe ? "bg-[#C9A96E]/10" : ""
                }`}
              >
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-black tabular-nums shrink-0 ${
                      rank === 1
                        ? "bg-[#C9A96E] text-[#0D0D0F]"
                        : rank === 2
                        ? "bg-neutral-300 text-neutral-900"
                        : rank === 3
                        ? "bg-amber-700 text-white"
                        : "bg-[#F7F4EE] text-[#6B6760]"
                    }`}
                  >
                    #{rank}
                  </div>

                  <SmartImage
                    src={entry.photoUrl || DEFAULT_AVATAR}
                    alt={entry.fullName}
                    fallbackType="profile"
                    fullName={entry.fullName}
                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover border border-[#E8E4DB] shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] sm:text-[14px] font-bold text-[#0D0D0F] truncate flex items-center gap-1.5">
                      <span className="truncate">{entry.fullName}</span>
                      {isMe && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#C9A96E]/20 text-[#8A6D3B] shrink-0">
                          YOU
                        </span>
                      )}
                      {entry.isVerifiedJudge && (
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      )}
                    </div>
                    <div className="text-[11px] sm:text-[12px] text-[#6B6760] flex items-center gap-2 tabular-nums">
                      <span>
                        {entry.wins}W – {entry.losses}L
                      </span>
                      <span>·</span>
                      <span>{entry.winRate}% WR</span>
                      {entry.currentStreak >= 2 && (
                        <span className="inline-flex items-center gap-0.5 text-amber-600 font-semibold">
                          <Flame className="w-3 h-3" />
                          {entry.currentStreak}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-[14px] sm:text-[15px] font-black tabular-nums text-[#0D0D0F]">
                    {entry.battleXp.toLocaleString()} XP
                  </div>
                  <div className="text-[11px] text-[#6B6760] flex items-center justify-end gap-1">
                    <Award className="w-3 h-3 text-[#C9A96E]" />
                    <span>{entry.badges?.length || 0}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
