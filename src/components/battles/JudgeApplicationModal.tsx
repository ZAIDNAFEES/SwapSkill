import React, { useState, useEffect } from "react";
import { X, Scale, CheckCircle2, Clock, AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import {
  BattleCategoryItem,
  BattleJudgeApplication,
} from "../../types/battle";
import {
  BattleUserActor,
  fetchMyJudgeApplication,
  submitJudgeApplication,
} from "../../services/battleService";
import { useBackHandler } from "../../utils/navigationManager";

interface JudgeApplicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: BattleUserActor;
  categories: BattleCategoryItem[];
  onSubmitted?: (app: BattleJudgeApplication) => void;
}

export const JudgeApplicationModal: React.FC<JudgeApplicationModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  categories,
  onSubmitted,
}) => {
  const [existingApp, setExistingApp] = useState<BattleJudgeApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCats, setSelectedCats] = useState<string[]>(
    categories[0] ? [categories[0].id] : ["coding"]
  );
  const [yearsExperience, setYearsExperience] = useState<number>(2);
  const [credentialsSummary, setCredentialsSummary] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [statement, setStatement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !currentUser.uid) return;
    setLoading(true);
    setError(null);
    fetchMyJudgeApplication(currentUser.uid)
      .then((app) => {
        setExistingApp(app);
        if (app) {
          setSelectedCats(app.categories || []);
          setYearsExperience(app.yearsExperience || 2);
          setCredentialsSummary(app.credentialsSummary || "");
          setPortfolioUrl(app.portfolioUrl || "");
          setStatement(app.statement || "");
        }
      })
      .finally(() => setLoading(false));
  }, [isOpen, currentUser.uid]);

  useBackHandler(isOpen, onClose);

  if (!isOpen) return null;

  const toggleCategory = (catId: string) => {
    setSelectedCats((prev) =>
      prev.includes(catId)
        ? prev.length > 1
          ? prev.filter((id) => id !== catId)
          : prev
        : prev.length < 4
        ? [...prev, catId]
        : prev
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCats.length === 0) return setError("Select at least one skill category.");
    if (credentialsSummary.trim().length < 15) {
      return setError("Please describe your domain expertise & credentials (min 15 chars).");
    }
    if (statement.trim().length < 15) {
      return setError("Please write a short judging philosophy statement (min 15 chars).");
    }

    setSubmitting(true);
    setError(null);
    try {
      const app = await submitJudgeApplication({
        user: currentUser,
        categories: selectedCats,
        yearsExperience: Math.max(0, Number(yearsExperience) || 0),
        credentialsSummary,
        portfolioUrl,
        statement,
      });
      setExistingApp(app);
      onSubmitted?.(app);
    } catch (err: any) {
      setError(err?.message || "Failed to submit judge application.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col rounded-t-[24px] sm:rounded-[24px] bg-[#F7F4EE] border border-[#E8E4DB] shadow-2xl overflow-hidden"
      >
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 bg-white border-b border-[#E8E4DB] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#0D0D0F] text-[#C9A96E] flex items-center justify-center shrink-0">
              <Scale className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] sm:text-[16px] font-bold text-[#0D0D0F] truncate">
                Apply to Become a Battle Judge
              </h3>
              <p className="text-[11px] text-[#6B6760] truncate">
                Verified by SwapSkill Arena Administration
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Judge Application"
            className="w-10 h-10 rounded-full flex items-center justify-center text-[#6B6760] hover:bg-black/5 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {loading ? (
            <div className="py-12 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#C9A96E]" />
            </div>
          ) : existingApp?.status === "approved" ? (
            <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-2">
              <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto" />
              <h4 className="text-[16px] font-bold text-[#0D0D0F]">
                You Are a Verified Arena Judge
              </h4>
              <p className="text-[13px] text-[#6B6760]">
                You can now be assigned to judge live Skill Battles and access the Judge Dashboard.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {existingApp?.status === "pending" && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-[13px] text-amber-800">
                  <Clock className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-semibold">Application Under Review:</span> You can update your submission details below while admin reviews it.
                  </div>
                </div>
              )}

              {existingApp?.status === "rejected" && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5 text-[13px] text-rose-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-semibold">Previous Review Note:</span>{" "}
                    {existingApp.rejectionReason || "Please strengthen your credentials and reapply."}
                  </div>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-[13px]">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-2">
                  Judging Expertise Categories (Up to 4)
                </label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => {
                    const active = selectedCats.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleCategory(c.id)}
                        className={`min-h-[38px] px-3 rounded-lg text-[12px] font-semibold border transition cursor-pointer ${
                          active
                            ? "bg-[#0D0D0F] text-white border-transparent"
                            : "bg-white border-[#E8E4DB] text-[#0D0D0F]"
                        }`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                  Years of Domain Experience
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(Number(e.target.value) || 0)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-[#E8E4DB] text-[14px] text-[#0D0D0F]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                  Credentials & Track Record *
                </label>
                <textarea
                  rows={3}
                  value={credentialsSummary}
                  onChange={(e) => setCredentialsSummary(e.target.value)}
                  maxLength={500}
                  placeholder="Highlight SwapSkill mentorships, professional roles, competitions won, or certifications..."
                  className="w-full p-3.5 rounded-xl bg-white border border-[#E8E4DB] text-[13px] text-[#0D0D0F] resize-none"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                  Portfolio / LinkedIn / GitHub URL (Optional)
                </label>
                <input
                  type="url"
                  value={portfolioUrl}
                  onChange={(e) => setPortfolioUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-[#E8E4DB] text-[14px] text-[#0D0D0F]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#6B6760] mb-1.5">
                  Judging Philosophy & Impartiality Statement *
                </label>
                <textarea
                  rows={3}
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  maxLength={500}
                  placeholder="How do you evaluate live technical or creative skill performances fairly?"
                  className="w-full p-3.5 rounded-xl bg-white border border-[#E8E4DB] text-[13px] text-[#0D0D0F] resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[46px] rounded-xl bg-[#0D0D0F] text-white text-[14px] font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-[#C9A96E]" />
                )}
                <span>
                  {existingApp?.status === "pending"
                    ? "Update Judge Application"
                    : "Submit Judge Application"}
                </span>
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
};
