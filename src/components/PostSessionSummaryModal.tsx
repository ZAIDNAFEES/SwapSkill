import React, { useEffect, useMemo, useState } from "react";
import {
  Award,
  BadgeCheck,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Shield,
  Star,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { DEFAULT_AVATAR, Session, UserProfile, getUserProfilePhoto } from "../types";
import SmartImage from "./SmartImage";

export interface PostSessionOutcomeMeta {
  sessionId: string;
  mode: "complete" | "pause";
  durationSeconds: number;
  remainingSeconds: number;
  partnerUid: string;
  partnerName: string;
  partnerPhoto?: string;
  skillName?: string;
  sessionDuration?: number;
  scheduledTime?: any;
  sessionEndTime?: any;
}

interface PostSessionSummaryModalProps {
  isOpen: boolean;
  outcome: PostSessionOutcomeMeta | null;
  session: Session | null;
  currentUserId: string;
  currentUserProfile: UserProfile | null;
  profilesCache: Record<string, UserProfile>;
  onClose: () => void;
  onRejoinSession: () => void;
  onOpenCertificate: (session: Session) => void;
  onNavigateToSessions?: () => void;
}

const ENDORSEMENT_CHIPS = [
  "Clear Explanations",
  "Patient Mentor",
  "Practical Examples",
  "Well Prepared",
  "Respectful",
];

const QUICK_FEEDBACK_NOTES = [
  "Clear, practical walkthrough!",
  "Super patient and helpful.",
  "Great 1-on-1 skill swap.",
];

const RATING_LABELS: Record<number, string> = {
  1: "Needs improvement",
  2: "Fair session",
  3: "Good exchange",
  4: "Great mentor",
  5: "Exceptional mentor",
};

function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  }
  return `${secs}s`;
}

function parseTimestampMs(val: any): number | null {
  if (!val) return null;
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  if (typeof val?.toMillis === "function") {
    try {
      return val.toMillis();
    } catch (_) {}
  }
  if (typeof val?.seconds === "number") return val.seconds * 1000;
  if (val instanceof Date) return val.getTime();
  const parsed = Date.parse(String(val));
  return Number.isNaN(parsed) ? null : parsed;
}

export default function PostSessionSummaryModal({
  isOpen,
  outcome,
  session,
  currentUserId,
  currentUserProfile,
  profilesCache,
  onClose,
  onRejoinSession,
  onOpenCertificate,
  onNavigateToSessions,
}: PostSessionSummaryModalProps) {
  const [mode, setMode] = useState<"complete" | "pause">(outcome?.mode || "complete");
  const [rating, setRating] = useState<number>(5);
  const [taughtProperly, setTaughtProperly] = useState<"yes" | "partial" | "no">("yes");
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [feedbackText, setFeedbackText] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [completingPause, setCompletingPause] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string>("");
  const [reviewSubmitted, setReviewSubmitted] = useState<boolean>(false);
  const [skippedToCert, setSkippedToCert] = useState<boolean>(false);
  const [submittedRatingValue, setSubmittedRatingValue] = useState<number | null>(null);
  const [liveRemainingSeconds, setLiveRemainingSeconds] = useState<number>(
    outcome?.remainingSeconds ?? 0
  );

  useEffect(() => {
    if (!isOpen || !outcome) return;
    setMode(outcome.mode);
    setRating(5);
    setTaughtProperly("yes");
    setSelectedChips([]);
    setFeedbackText("");
    setReviewError("");
    setSkippedToCert(false);
    setSubmittedRatingValue(null);
    const alreadyReviewed =
      Array.isArray(session?.reviewedBy) && session.reviewedBy.includes(currentUserId);
    setReviewSubmitted(alreadyReviewed);
    setLiveRemainingSeconds(outcome.remainingSeconds ?? 0);
  }, [isOpen, outcome?.sessionId, outcome?.mode]);

  // Live countdown ticker while paused so user sees exact time left to rejoin
  useEffect(() => {
    if (!isOpen || mode !== "pause" || !outcome) return;
    const deadlineMs = (() => {
      const explicitEnd = parseTimestampMs(session?.sessionEndTime ?? outcome.sessionEndTime);
      if (explicitEnd) return explicitEnd;
      const startMs = parseTimestampMs(session?.scheduledTime ?? outcome.scheduledTime);
      const mins = session?.duration || outcome.sessionDuration || 30;
      if (startMs) return startMs + mins * 60_000;
      return Date.now() + (outcome.remainingSeconds ?? 0) * 1000;
    })();

    const tick = () => {
      const rem = Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
      setLiveRemainingSeconds(rem);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isOpen, mode, outcome, session?.sessionEndTime, session?.scheduledTime, session?.duration]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const partnerUid = useMemo(() => {
    if (outcome?.partnerUid) return outcome.partnerUid;
    if (!session) return "";
    const isTeacher = session.teacherId === currentUserId;
    return isTeacher
      ? session.learnerId || session.studentId || ""
      : session.teacherId || "";
  }, [outcome?.partnerUid, session, currentUserId]);

  const partnerProfile = partnerUid ? profilesCache[partnerUid] : undefined;
  const partnerName =
    partnerProfile?.fullName ||
    outcome?.partnerName ||
    (session
      ? session.teacherId === currentUserId
        ? session.learnerName || session.studentName
        : session.teacherName
      : "") ||
    "Swap Partner";

  const partnerPhoto =
    outcome?.partnerPhoto ||
    (partnerProfile ? getUserProfilePhoto(partnerProfile) : DEFAULT_AVATAR);

  const skillName =
    outcome?.skillName || session?.skillName || session?.skill || "Skill Exchange";

  const effectiveSession: Session = useMemo(() => {
    if (session) {
      return {
        ...session,
        status: mode === "complete" ? "Completed" : session.status,
        rating: submittedRatingValue ?? session.rating,
        actualDuration:
          session.actualDuration ||
          Math.max(1, Math.round((outcome?.durationSeconds || 0) / 60)) ||
          session.duration ||
          30,
      };
    }

    const myName = currentUserProfile?.fullName || "SwapSkill Member";
    return {
      id: outcome?.sessionId || `session_${Date.now()}`,
      teacherId: partnerUid || "partner",
      learnerId: currentUserId,
      teacherName: partnerName,
      learnerName: myName,
      teacherPhoto: partnerPhoto,
      learnerPhoto: getUserProfilePhoto(currentUserProfile),
      skillName,
      status: mode === "complete" ? "Completed" : "confirmed",
      scheduledTime: outcome?.scheduledTime || new Date(),
      sessionEndTime: outcome?.sessionEndTime,
      createdAt: new Date(),
      duration: outcome?.sessionDuration || 30,
      actualDuration: Math.max(1, Math.round((outcome?.durationSeconds || 0) / 60)),
      completedAt: new Date(),
      rating: submittedRatingValue ?? undefined,
    };
  }, [
    session,
    mode,
    submittedRatingValue,
    outcome,
    currentUserProfile,
    partnerUid,
    partnerName,
    partnerPhoto,
    currentUserId,
    skillName,
  ]);

  if (!isOpen || !outcome) return null;

  const handleCompleteFromPause = async () => {
    if (completingPause) return;
    setCompletingPause(true);
    try {
      await updateDoc(doc(db, "sessions", outcome.sessionId), {
        status: "Completed",
        sessionEnded: true,
        isEnded: true,
        meetingEnded: true,
        isLive: false,
        currentCallId: null,
        currentCallCallerId: null,
        actualEndTime: serverTimestamp(),
        completedAt: serverTimestamp(),
        actualDurationSeconds: outcome.durationSeconds,
      });
    } catch (err) {
      console.warn("[PostSessionSummary] Non-fatal session finalize error:", err);
    } finally {
      setCompletingPause(false);
      setMode("complete");
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const trimmedComment = feedbackText.trim();
    if (!trimmedComment) {
      setReviewError("Add a short note or tap a quick summary above.");
      return;
    }

    setSubmitting(true);
    setReviewError("");

    try {
      const reviewerName =
        currentUserProfile?.fullName ||
        (session?.teacherId === currentUserId
          ? session?.teacherName
          : session?.learnerName || session?.studentName) ||
        "SwapSkill Member";

      if (partnerUid) {
        await addDoc(collection(db, "reviews"), {
          sessionId: outcome.sessionId,
          reviewerId: currentUserId,
          revieweeId: partnerUid,
          reviewerName,
          rating,
          comment: trimmedComment,
          taughtProperly,
          feedbackChips: selectedChips,
          skillTaught: skillName,
          createdAt: new Date(),
        });

        if (taughtProperly === "no") {
          try {
            const userRef = doc(db, "users", currentUserId);
            const userSnap = await getDoc(userRef);
            const curCredits = userSnap.data()?.swapCredits || 0;
            await updateDoc(userRef, { swapCredits: curCredits + 1 });
          } catch (_) {}
        } else if (taughtProperly === "yes") {
          try {
            const partnerRef = doc(db, "users", partnerUid);
            const partnerSnap = await getDoc(partnerRef);
            const curPts = partnerSnap.data()?.points || 0;
            await updateDoc(partnerRef, { points: curPts + 25 });
          } catch (_) {}
        }

        try {
          const qReviews = query(
            collection(db, "reviews"),
            where("revieweeId", "==", partnerUid)
          );
          const snaps = await getDocs(qReviews);
          let total = 0;
          let count = 0;
          snaps.forEach((d) => {
            total += d.data().rating || 0;
            count += 1;
          });
          if (count > 0) {
            await updateDoc(doc(db, "users", partnerUid), {
              rating: parseFloat((total / count).toFixed(1)),
              reviewCount: count,
            });
          }
        } catch (_) {}

        try {
          await addDoc(collection(db, "users", partnerUid, "notifications"), {
            type: "review",
            senderId: currentUserId,
            senderName: reviewerName,
            senderPhoto: getUserProfilePhoto(currentUserProfile) || DEFAULT_AVATAR,
            referenceId: outcome.sessionId,
            message: `rated your ${skillName} live swap (${rating}.0★)`,
            read: false,
            createdAt: new Date(),
          });
        } catch (_) {}
      }

      try {
        await updateDoc(doc(db, "sessions", outcome.sessionId), {
          rating,
          feedbackText: trimmedComment,
          feedbackChips: selectedChips,
          taughtProperlyRating: taughtProperly,
          reviewedBy: arrayUnion(currentUserId),
        });
      } catch (_) {}

      setSubmittedRatingValue(rating);
      setReviewSubmitted(true);
    } catch (err) {
      console.error("[PostSessionSummary] Review submission failed:", err);
      setReviewError("Could not save review right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const showCertificateStage = mode === "complete" && (reviewSubmitted || skippedToCert);

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "pause" ? "Session paused" : "Session completed"}
        onClick={onClose}
        className="fixed inset-0 z-[130] bg-[#0D0D0F]/65 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 font-sans overflow-y-auto"
      >
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-[490px] max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#F7F4EE] border-t sm:border border-[#E8E4DB] shadow-2xl overflow-hidden text-[#0D0D0F]"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {/* Top Summary Header */}
          <div className="bg-[#FFFFFF] border-b border-[#E8E4DB] px-5 pt-4 pb-4 shrink-0">
            <div className="w-10 h-1 rounded-full bg-[#E8E4DB] mx-auto mb-3 sm:hidden" />

            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative shrink-0">
                  <SmartImage
                    src={partnerPhoto}
                    alt={partnerName}
                    fallbackType="profile"
                    fullName={partnerName}
                    sizeType="thumbnail"
                    className="w-12 h-12 rounded-2xl object-cover border border-[#E8E4DB] bg-[#F2EFE8]"
                  />
                  <span
                    className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-[#FFFFFF] ${
                      mode === "pause"
                        ? "bg-amber-500 text-white"
                        : "bg-[#0D0D0F] text-[#C9A96E]"
                    }`}
                  >
                    {mode === "pause" ? (
                      <Clock className="w-2.5 h-2.5" strokeWidth={2.5} />
                    ) : (
                      <Check className="w-2.5 h-2.5" strokeWidth={2.8} />
                    )}
                  </span>
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h2 className="text-[17px] font-bold tracking-tight text-[#0D0D0F] truncate">
                      {mode === "pause" ? "Session Paused" : "Swap Completed"}
                    </h2>
                  </div>
                  <div className="flex items-center gap-1.5 text-[12.5px] text-[#52525B] mt-0.5 truncate">
                    <span className="font-semibold text-[#0D0D0F] truncate">
                      {partnerName}
                    </span>
                    {partnerProfile?.verified && (
                      <BadgeCheck
                        className="w-3.5 h-3.5 text-[#9A7A42] fill-[#C9A96E]/15 shrink-0"
                        aria-label="Verified member"
                      />
                    )}
                    <span aria-hidden="true" className="text-[#A1A1AA]">
                      ·
                    </span>
                    <span className="truncate text-[#71717A]">{skillName}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close summary"
                className="min-w-[40px] min-h-[40px] rounded-full hover:bg-[#F7F4EE] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer shrink-0"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Clean Unboxed Telemetry Row */}
            <div className="mt-3 pt-3 border-t border-[#F2EFE8] flex items-center justify-between text-[12px] text-[#71717A] tabular-nums">
              <span>
                Connected:{" "}
                <strong className="font-semibold text-[#0D0D0F]">
                  {formatDurationClock(outcome.durationSeconds)}
                </strong>
              </span>
              {mode === "pause" ? (
                <span className="font-semibold text-[#9A7A42]">
                  {liveRemainingSeconds > 0
                    ? `${formatDurationClock(liveRemainingSeconds)} left to rejoin`
                    : "Rejoin window open"}
                </span>
              ) : (
                <span className="font-semibold text-emerald-700 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Verified exchange
                </span>
              )}
            </div>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {mode === "pause" ? (
              <div className="space-y-3.5">
                <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#FAF6ED] border border-[#E8DFC9] flex items-center justify-center text-[#9A7A42] shrink-0">
                      <RefreshCw className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <h3 className="text-[14.5px] font-bold text-[#0D0D0F]">
                        Your swap room is still active
                      </h3>
                      <p className="text-[12.5px] text-[#71717A] leading-relaxed mt-1">
                        {liveRemainingSeconds > 0
                          ? `You still have ${formatDurationClock(
                              liveRemainingSeconds
                            )} remaining in this session. Rejoin anytime before closing or mark the swap completed if you’re done.`
                          : "You left the call temporarily without marking it finished. Rejoin anytime or end the session to unlock your certificate."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2.5">
                  <button
                    id="post-session-rejoin-btn"
                    type="button"
                    onClick={onRejoinSession}
                    className="w-full h-12 rounded-xl bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] font-semibold text-[13.5px] flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer shadow-sm"
                  >
                    <Play className="w-4 h-4 text-[#C9A96E] fill-[#C9A96E]" />
                    <span>Rejoin Live Swap</span>
                  </button>

                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      id="post-session-finalize-btn"
                      type="button"
                      disabled={completingPause}
                      onClick={handleCompleteFromPause}
                      className="h-11 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#FAF8F4] text-[#0D0D0F] font-semibold text-[12.5px] flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer"
                    >
                      {completingPause ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#9A7A42]" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-[#9A7A42]" />
                      )}
                      <span>End & Rate Now</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onNavigateToSessions?.();
                        onClose();
                      }}
                      className="h-11 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#FAF8F4] text-[#52525B] font-semibold text-[12.5px] flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer"
                    >
                      <Calendar className="w-4 h-4 text-[#71717A]" />
                      <span>Back to Sessions</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : !showCertificateStage ? (
              <form onSubmit={handleSubmitReview} className="space-y-3.5">
                {reviewError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[12px] font-medium">
                    {reviewError}
                  </div>
                )}

                {/* 1. Star Rating Card */}
                <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-4 text-center space-y-2.5">
                  <div className="flex items-center justify-between text-left">
                    <span className="text-[13px] font-semibold text-[#0D0D0F]">
                      Rate your session with {partnerName}
                    </span>
                    <span className="text-[12px] font-semibold text-[#9A7A42]">
                      {RATING_LABELS[rating]}
                    </span>
                  </div>

                  <div className="flex items-center justify-center gap-2 py-1">
                    {[1, 2, 3, 4, 5].map((starVal) => {
                      const active = starVal <= rating;
                      return (
                        <button
                          key={starVal}
                          id={`post-session-star-${starVal}`}
                          type="button"
                          onClick={() => setRating(starVal)}
                          aria-label={`Rate ${starVal} out of 5`}
                          className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center hover:bg-[#FAF6ED] transition active:scale-90 cursor-pointer"
                        >
                          <Star
                            className={`w-7 h-7 transition-colors ${
                              active
                                ? "text-[#C9A96E] fill-[#C9A96E]"
                                : "text-[#E2DDD2]"
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Fair Swap Check */}
                <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-[#0D0D0F]">
                      Did {partnerName} teach {skillName} clearly?
                    </span>
                    <Shield className="w-3.5 h-3.5 text-[#C9A96E] shrink-0" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: "yes", label: "Yes, clearly", hint: "+25 Karma" },
                      { id: "partial", label: "Partially", hint: "Fair" },
                      { id: "no", label: "Unable", hint: "Swap Credit" },
                    ].map((opt) => {
                      const active = taughtProperly === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setTaughtProperly(opt.id as "yes" | "partial" | "no")}
                          className={`py-2 px-2 rounded-xl border text-center transition cursor-pointer ${
                            active
                              ? "bg-[#0D0D0F] border-[#0D0D0F] text-[#F7F4EE]"
                              : "bg-[#FAF8F4] border-[#E8E4DB] text-[#52525B] hover:text-[#0D0D0F]"
                          }`}
                        >
                          <span className="block text-[11.5px] font-semibold">
                            {opt.label}
                          </span>
                          <span
                            className={`block text-[10px] mt-0.5 ${
                              active ? "text-[#C9A96E]" : "text-[#8A8478]"
                            }`}
                          >
                            {opt.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Endorsement Strengths */}
                <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-4 space-y-2.5">
                  <span className="block text-[12.5px] font-semibold text-[#0D0D0F]">
                    Highlight strengths
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {ENDORSEMENT_CHIPS.map((chip) => {
                      const selected = selectedChips.includes(chip);
                      return (
                        <button
                          key={chip}
                          type="button"
                          onClick={() =>
                            setSelectedChips((prev) =>
                              prev.includes(chip)
                                ? prev.filter((c) => c !== chip)
                                : [...prev, chip]
                            )
                          }
                          className={`px-3 py-1.5 rounded-xl border text-[11.5px] font-medium transition cursor-pointer ${
                            selected
                              ? "bg-[#FAF6ED] border-[#C9A96E] text-[#0D0D0F] font-semibold"
                              : "bg-[#F7F4EE] border-[#E8E4DB] text-[#52525B] hover:text-[#0D0D0F]"
                          }`}
                        >
                          {selected ? "✓ " : "+ "}
                          {chip}
                        </button>
                      );
                    })}
                  </div>

                  {/* Feedback Textarea + 1-Tap Starters */}
                  <div className="pt-1 space-y-2">
                    <textarea
                      id="post-session-feedback-input"
                      rows={2}
                      maxLength={180}
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder={`Share how your swap with ${partnerName} went...`}
                      className="w-full p-3 bg-[#FAF8F4] border border-[#E8E4DB] rounded-xl text-[12.5px] text-[#0D0D0F] placeholder-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F] resize-none leading-relaxed"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_FEEDBACK_NOTES.map((note) => (
                        <button
                          key={note}
                          type="button"
                          onClick={() => setFeedbackText(note)}
                          className="text-[11px] text-[#71717A] hover:text-[#0D0D0F] underline underline-offset-2 cursor-pointer"
                        >
                          "{note}"
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Primary & Skip CTAs */}
                <div className="flex flex-col gap-2 pt-0.5">
                  <button
                    id="post-session-submit-review-btn"
                    type="submit"
                    disabled={submitting}
                    className="w-full h-12 rounded-xl bg-[#0D0D0F] hover:bg-[#1C1C20] disabled:opacity-60 text-[#F7F4EE] font-semibold text-[13.5px] flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer shadow-sm"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#C9A96E]" />
                        <span>Publishing Review...</span>
                      </>
                    ) : (
                      <>
                        <Award className="w-4 h-4 text-[#C9A96E]" />
                        <span>Submit Review & Unlock Certificate</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSkippedToCert(true)}
                    className="h-9 text-[12px] font-medium text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
                  >
                    Skip review & view certificate
                  </button>
                </div>
              </form>
            ) : (
              /* Certificate Ready & Next Steps Stage */
              <div className="space-y-3.5">
                {reviewSubmitted && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 flex items-center gap-2.5 text-emerald-900">
                    <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                    <div className="text-[12.5px]">
                      <span className="font-semibold">Verified review saved.</span>{" "}
                      <span className="text-emerald-800">
                        Thank you for strengthening the SwapSkill network.
                      </span>
                    </div>
                  </div>
                )}

                {/* Featured Verified Certificate Card */}
                <div className="bg-[#0D0D0F] text-[#F7F4EE] rounded-2xl p-5 border border-[#242429] relative overflow-hidden space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-[#1A1A1D] border border-[#C9A96E]/35 flex items-center justify-center text-[#C9A96E] shrink-0">
                        <Award className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C9A96E]">
                          Verified Credential Ready
                        </p>
                        <h3 className="text-[16px] font-bold text-[#F7F4EE] truncate mt-0.5">
                          {skillName}
                        </h3>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/10 grid grid-cols-2 gap-3 text-[12px]">
                    <div className="min-w-0">
                      <span className="block text-[10.5px] text-[#A1A1AA]">
                        Exchange Partner
                      </span>
                      <span className="font-semibold text-[#F7F4EE] truncate block mt-0.5">
                        {partnerName}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="block text-[10.5px] text-[#A1A1AA]">
                        Session Duration
                      </span>
                      <span className="font-semibold text-[#F7F4EE] tabular-nums block mt-0.5">
                        {formatDurationClock(outcome.durationSeconds)}
                      </span>
                    </div>
                  </div>

                  <button
                    id="post-session-view-cert-btn"
                    type="button"
                    onClick={() => onOpenCertificate(effectiveSession)}
                    className="w-full h-11 rounded-xl bg-[#C9A96E] hover:bg-[#D5B87F] text-[#0D0D0F] font-bold text-[13px] flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer"
                  >
                    <Award className="w-4 h-4" />
                    <span>View & Download PDF Certificate</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateToSessions?.();
                      onClose();
                    }}
                    className="h-11 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#FAF8F4] text-[#0D0D0F] font-semibold text-[12.5px] flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer"
                  >
                    <Calendar className="w-4 h-4 text-[#9A7A42]" />
                    <span>View Sessions</span>
                  </button>

                  <button
                    type="button"
                    onClick={onClose}
                    className="h-11 rounded-xl bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] font-semibold text-[12.5px] flex items-center justify-center transition active:scale-[0.98] cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
