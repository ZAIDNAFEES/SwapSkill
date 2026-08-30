import React, { useState } from "react";
import { 
  CheckCircle, 
  Sparkles, 
  Clock, 
  Check, 
  Star, 
  X,
  ArrowRight,
  Repeat
} from "lucide-react";
import { collection, addDoc, doc, updateDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { DEFAULT_AVATAR } from "../../types";

export interface PostCallFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  partnerName: string;
  partnerPhoto?: string;
  partnerUid: string;
  sessionId: string;
  skillName?: string;
  currentUserId: string;
  currentUserName: string;
  currentUserPhoto?: string;
  sessionDuration: number;
  formattedDuration: string;
  sessionEndedNotice: string | null;
  onSessionCompleted?: (sessionId: string) => void;
}

const FEEDBACK_CHIP_OPTIONS = [
  "🌟 Great teacher",
  "💡 Very helpful",
  "🚀 Learned a lot",
  "🤝 Friendly & patient",
  "⏳ On-time",
  "🔄 Would swap again"
];

export const PostCallFeedbackModal: React.FC<PostCallFeedbackModalProps> = ({
  isOpen,
  onClose,
  partnerName,
  partnerPhoto,
  partnerUid,
  sessionId,
  skillName,
  currentUserId,
  currentUserName,
  currentUserPhoto,
  sessionDuration,
  formattedDuration,
  sessionEndedNotice,
  onSessionCompleted,
}) => {
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const toggleChip = (chip: string) => {
    setSelectedChips((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]
    );
  };

  const getRatingLabel = (r: number) => {
    switch (r) {
      case 5: return "Outstanding experience";
      case 4: return "Great session";
      case 3: return "Good session";
      case 2: return "Fair";
      case 1: return "Needs improvement";
      default: return "";
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting || submitted) return;

    setIsSubmitting(true);
    setSubmitError("");

    try {
      // 1. Create review doc
      const reviewsRef = collection(db, "reviews");
      await addDoc(reviewsRef, {
        sessionId,
        reviewerId: currentUserId,
        revieweeId: partnerUid,
        reviewerName: currentUserName,
        rating,
        comment: feedbackComment.trim() || selectedChips.join(", ") || "Great skill swap session!",
        feedbackChips: selectedChips,
        createdAt: new Date(),
      });

      // 2. Update partner aggregate rating in users/{partnerUid}
      try {
        if (partnerUid) {
          const qReviews = query(collection(db, "reviews"), where("revieweeId", "==", partnerUid));
          const snaps = await getDocs(qReviews);
          let total = 0;
          let count = 0;
          snaps.forEach((d) => {
            total += d.data().rating;
            count++;
          });

          if (count > 0) {
            const avgRating = total / count;
            await updateDoc(doc(db, "users", partnerUid), {
              rating: parseFloat(avgRating.toFixed(1)),
            });
          }
        }
      } catch (ratingErr) {
        console.warn("Could not update user rating average:", ratingErr);
      }

      // 3. Send notification to partner
      if (partnerUid) {
        try {
          const partnerNotifRef = collection(db, "users", partnerUid, "notifications");
          await addDoc(partnerNotifRef, {
            type: "review",
            senderId: currentUserId,
            senderName: currentUserName,
            senderPhoto: currentUserPhoto || DEFAULT_AVATAR,
            referenceId: sessionId,
            message: `rated your skill swap ${rating} stars! ✦`,
            read: false,
            createdAt: new Date(),
          });
        } catch (notifErr) {
          console.warn("Could not create review notification:", notifErr);
        }
      }

      // 4. Update session document
      try {
        const sessionRef = doc(db, "sessions", sessionId);
        await updateDoc(sessionRef, {
          rating,
          feedbackText: feedbackComment.trim(),
          feedbackChips: selectedChips,
          reviewedBy: [currentUserId],
        });
      } catch (sessionDocErr) {
        console.warn("Could not update session doc with feedback:", sessionDocErr);
      }

      setSubmitted(true);
      onSessionCompleted?.(sessionId);

      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      console.error("Error submitting post-call feedback:", err);
      setSubmitError(err.message || "Failed to submit feedback. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div 
        id="swap-complete-modal-container"
        className="relative w-full max-w-md bg-[#121217] text-[#F7F4EE] rounded-3xl border border-white/15 shadow-2xl p-6 sm:p-7 flex flex-col items-center text-center animate-in zoom-in-95 duration-200 select-none"
      >
        {/* Success Celebration Badge */}
        <div className="relative mb-3">
          <div className="w-14 h-14 rounded-2xl bg-[#C9A96E]/15 border border-[#C9A96E]/30 flex items-center justify-center shadow-lg shadow-[#C9A96E]/10">
            <CheckCircle className="w-7 h-7 text-[#C9A96E]" />
          </div>
        </div>

        {/* Header Title */}
        <h2 className="text-xl font-bold text-[#F7F4EE] tracking-tight mb-1">
          Swap Completed
        </h2>
        <p className="text-xs text-white/60 max-w-xs mb-4">
          {sessionEndedNotice || "Your live skill exchange session is finished."}
        </p>

        {/* Session Summary Card */}
        <div className="w-full bg-[#181820] border border-white/10 rounded-2xl p-3.5 mb-5 text-left">
          <div className="flex items-center gap-3">
            <img
              src={partnerPhoto || DEFAULT_AVATAR}
              alt={partnerName}
              className="w-11 h-11 rounded-full object-cover ring-1.5 ring-[#C9A96E]/40"
              referrerPolicy="no-referrer"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white/50">Partner</div>
              <div className="text-sm font-bold text-[#F7F4EE] truncate">
                {partnerName}
              </div>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#C9A96E] bg-[#C9A96E]/10 px-2.5 py-1 rounded-full border border-[#C9A96E]/20">
                <Clock className="w-3 h-3" />
                {formattedDuration || `${sessionDuration}m`}
              </span>
            </div>
          </div>

          {skillName && (
            <div className="mt-2.5 pt-2.5 border-t border-white/5 flex items-center justify-between text-xs text-white/70">
              <span className="text-white/40">Skill Exchanged:</span>
              <span className="font-semibold text-white/90 truncate max-w-[180px]">{skillName}</span>
            </div>
          )}
        </div>

        {/* Rating & Feedback Section */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col items-center">
          <div className="text-xs font-bold text-white/90 uppercase tracking-wider mb-1">
            Rate your partner
          </div>
          <div className="text-xs text-[#C9A96E] font-medium h-4 mb-2">
            {getRatingLabel(hoverRating || rating)}
          </div>

          {/* 5 Interactive Gold Stars */}
          <div className="flex items-center justify-center gap-1.5 mb-4">
            {[1, 2, 3, 4, 5].map((star) => {
              const isFilled = star <= (hoverRating || rating);
              return (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1 text-[#C9A96E] hover:scale-110 active:scale-95 transition cursor-pointer"
                >
                  <Star 
                    className={`w-7 h-7 transition-colors ${
                      isFilled ? "fill-[#C9A96E] text-[#C9A96E]" : "text-white/20 fill-transparent"
                    }`} 
                  />
                </button>
              );
            })}
          </div>

          {/* Quick Feedback Chips */}
          <div className="w-full mb-3.5">
            <div className="flex flex-wrap gap-1.5 justify-center">
              {FEEDBACK_CHIP_OPTIONS.map((chip) => {
                const isSelected = selectedChips.includes(chip);
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => toggleChip(chip)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition cursor-pointer active:scale-95 ${
                      isSelected
                        ? "bg-[#C9A96E] text-[#0A0A0E] border-[#C9A96E] font-semibold"
                        : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Short Feedback Textarea */}
          <div className="w-full mb-4 text-left">
            <textarea
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
              placeholder="How was your session? (optional feedback)..."
              rows={2}
              maxLength={400}
              className="w-full px-3 py-2 bg-[#181820] border border-white/10 rounded-xl text-xs text-[#F7F4EE] placeholder-white/30 focus:outline-hidden focus:border-[#C9A96E] transition resize-none"
            />
          </div>

          {submitError && (
            <div className="w-full p-2 mb-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs text-left">
              {submitError}
            </div>
          )}

          {/* Action Buttons */}
          <div className="w-full grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                onSessionCompleted?.(sessionId);
                onClose();
              }}
              disabled={isSubmitting}
              className="h-11 px-4 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 rounded-xl text-xs font-semibold transition active:scale-95 cursor-pointer flex items-center justify-center"
            >
              Not Now
            </button>

            <button
              id="submit-session-feedback-btn"
              type="submit"
              disabled={isSubmitting || submitted}
              className="h-11 px-4 bg-gradient-to-r from-[#C9A96E] to-[#D5B980] hover:opacity-95 text-[#0A0A0E] rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {submitted ? (
                <>
                  <Check className="w-4 h-4 text-[#0A0A0E]" />
                  <span>Submitted!</span>
                </>
              ) : isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-[#0A0A0E] border-t-transparent rounded-full animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <span>Submit Rating</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
