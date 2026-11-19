import React, { useEffect, useState } from "react";
import { Swords, Trophy, Award, Flame, Scale, ChevronRight } from "lucide-react";
import { BATTLE_BADGE_CATALOG, BattleProfile } from "../../types/battle";
import { fetchBattleProfile } from "../../services/battleService";

interface ProfileBattleStatsCardProps {
  userId: string;
  userName?: string;
  userPhoto?: string;
  onOpenBattlesHub?: () => void;
}

export const ProfileBattleStatsCard: React.FC<ProfileBattleStatsCardProps> = ({
  userId,
  userName,
  userPhoto,
  onOpenBattlesHub,
}) => {
  const [profile, setProfile] = useState<BattleProfile | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchBattleProfile(userId, { fullName: userName, photoUrl: userPhoto })
      .then((res) => {
        if (active) setProfile(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId, userName, userPhoto]);

  if (!profile) return null;

  return (
    <section className="w-full min-w-0 rounded-2xl bg-white border border-[#E8E4DB] p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-2.5 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#0D0D0F] text-[#C9A96E] flex items-center justify-center shrink-0">
            <Swords className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[15px] font-bold text-[#0D0D0F] tracking-tight">
                Skill Battles
              </h3>
              {profile.isVerifiedJudge && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700">
                  <Scale className="w-3 h-3" />
                  Verified Judge
                </span>
              )}
            </div>
            <p className="text-[12px] text-[#6B6760] truncate">
              Competitive Arena Record & Achievements
            </p>
          </div>
        </div>

        {onOpenBattlesHub && (
          <button
            type="button"
            onClick={onOpenBattlesHub}
            className="min-h-[38px] px-3 rounded-lg bg-[#F7F4EE] text-[12px] font-semibold text-[#0D0D0F] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Open Arena</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Stat Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="p-2.5 rounded-xl bg-[#F7F4EE] text-center min-w-0">
          <div className="text-[17px] font-black tabular-nums text-[#0D0D0F]">
            {profile.totalBattles}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6760]">
            Battles
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-[#F7F4EE] text-center min-w-0">
          <div className="text-[17px] font-black tabular-nums text-emerald-600">
            {profile.wins}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6760]">
            Wins
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-[#F7F4EE] text-center min-w-0">
          <div className="text-[17px] font-black tabular-nums text-[#0D0D0F]">
            {profile.winRate}%
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6760]">
            Win Rate
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-[#F7F4EE] text-center min-w-0">
          <div className="text-[17px] font-black tabular-nums text-[#8A6D3B]">
            {profile.battleXp}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6760]">
            Battle XP
          </div>
        </div>
      </div>

      {/* Badges */}
      {profile.badges?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {profile.badges.map((bId) => (
            <span
              key={bId}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#C9A96E]/15 text-[#8A6D3B] text-[11px] font-semibold"
            >
              <Award className="w-3.5 h-3.5" />
              {BATTLE_BADGE_CATALOG[bId]?.label || bId}
            </span>
          ))}
          {profile.currentStreak >= 2 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-700 text-[11px] font-semibold">
              <Flame className="w-3.5 h-3.5" />
              {profile.currentStreak} Win Streak
            </span>
          )}
        </div>
      )}

      {/* Recent Battle History */}
      {profile.recentBattles?.length > 0 ? (
        <div className="space-y-1.5 pt-1 border-t border-[#E8E4DB]/60">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#6B6760]">
            Recent Battles
          </div>
          {profile.recentBattles.slice(0, 3).map((item) => (
            <div
              key={item.battleId}
              className="flex items-center justify-between gap-2 text-[12px] py-1 min-w-0"
            >
              <div className="min-w-0 truncate">
                <span className="font-semibold text-[#0D0D0F]">
                  {item.title}
                </span>
                <span className="text-[#6B6760]">
                  {" "}
                  vs {item.opponentName}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 tabular-nums">
                <span
                  className={`text-[11px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    item.outcome === "win"
                      ? "bg-emerald-500/15 text-emerald-700"
                      : item.outcome === "draw"
                      ? "bg-amber-500/15 text-amber-700"
                      : "bg-neutral-200 text-neutral-600"
                  }`}
                >
                  {item.outcome}
                </span>
                <span className="text-[#8A6D3B] font-bold">+{item.xpEarned} XP</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-[#6B6760] flex items-center gap-2 pt-1">
          <Trophy className="w-4 h-4 text-[#C9A96E] shrink-0" />
          <span>No completed battles yet. Challenge a peer in Skill Battles!</span>
        </div>
      )}
    </section>
  );
};
