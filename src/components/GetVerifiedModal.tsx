import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronRight,
  Clock,
  Lock,
  ShieldAlert,
  Sparkles,
  UserCheck,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { UserProfile } from "../types";
import {
  getMyVerificationRequest,
  submitVerificationApplication,
} from "../services/verificationService";
import {
  VerificationCategory,
  VerificationRequestRecord,
} from "../utils/verificationAdmin";
import { getUserProfilePhoto } from "../types";
import { SmartImage } from "./SmartImage";
import { auth } from "../firebase";
import { useBackHandler } from "../utils/navigationManager";
import { useElasticOverscroll } from "../hooks/useElasticOverscroll";

interface GetVerifiedModalProps {
  isOpen: boolean;
  profile: UserProfile;
  onClose: () => void;
  onSubmitted?: (record: VerificationRequestRecord) => void;
}

const CATEGORY_OPTIONS: Array<{
  id: VerificationCategory;
  title: string;
  desc: string;
  icon: any;
}> = [
  {
    id: "skilled",
    title: "Skilled Member",
    desc: "Active swappers with quality sessions and peer feedback",
    icon: Sparkles,
  },
  {
    id: "notable",
    title: "Public Figure or Creator",
    desc: "Recognized voices, founders, or creators outside SwapSkill",
    icon: UserCheck,
  },
  {
    id: "educator",
    title: "Mentor & Educator",
    desc: "Certified instructors, specialists, and domain leaders",
    icon: BadgeCheck,
  },
];

const DOMAIN_OPTIONS = [
  "Software & Engineering",
  "Design & UI/UX",
  "Content & Media",
  "Languages",
  "Business & Finance",
  "Music, Film & Arts",
  "Academics & Research",
  "Public Figure",
  "Other Specialty",
];

function normalizeUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export default function GetVerifiedModal({
  isOpen,
  profile,
  onClose,
  onSubmitted,
}: GetVerifiedModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [existingReq, setExistingReq] = useState<VerificationRequestRecord | null>(null);
  const [editingForm, setEditingForm] = useState(false);

  // Form fields (kept clean & prefilled so users barely need to type)
  const [category, setCategory] = useState<VerificationCategory>("skilled");
  const [domain, setDomain] = useState("");
  const [legalOrKnownName, setLegalOrKnownName] = useState(profile.fullName || "");
  const [contactHandleOrPhone, setContactHandleOrPhone] = useState(profile.email || "");
  const [portfolioUrl, setPortfolioUrl] = useState(profile.portfolio || profile.website || "");
  const [showMoreLinks, setShowMoreLinks] = useState(false);
  const [instagram, setInstagram] = useState(profile.instagram || "");
  const [linkedin, setLinkedin] = useState(profile.linkedin || "");
  const [github, setGithub] = useState(profile.github || "");
  const [youtube, setYoutube] = useState("");
  const [credentialReference, setCredentialReference] = useState("");
  const [statement, setStatement] = useState("");
  const [pledgeAccepted, setPledgeAccepted] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const bodyContentRef = useRef<HTMLDivElement>(null);

  useElasticOverscroll({
    scrollRef: bodyScrollRef,
    targetRef: bodyContentRef,
    allowTop: true,
    allowBottom: true,
    disabled: !isOpen,
    reattachKey: isOpen,
  });

  useBackHandler(isOpen, () => {
    if (step === 2 && !justSubmitted) {
      setStep(1);
      setErrorMsg("");
    } else {
      onClose();
    }
  });

  useEffect(() => {
    if (!isOpen || !profile?.uid) return;
    setStep(1);
    setErrorMsg("");
    setJustSubmitted(false);
    setEditingForm(false);

    setLegalOrKnownName((prev) => prev || profile.fullName || "");
    setContactHandleOrPhone((prev) => prev || auth.currentUser?.email || profile.email || "");
    setPortfolioUrl((prev) => prev || profile.portfolio || profile.website || profile.linkedin || profile.github || "");
    setInstagram((prev) => prev || profile.instagram || "");
    setLinkedin((prev) => prev || profile.linkedin || "");
    setGithub((prev) => prev || profile.github || "");

    let cancelled = false;
    setLoadingStatus(true);
    getMyVerificationRequest(profile.uid)
      .then((rec) => {
        if (!cancelled) {
          setExistingReq(rec);
          if (rec?.category) setCategory(rec.category);
          if (rec?.domain) setDomain(rec.domain);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Verification status check:", err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStatus(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, profile?.uid]);

  if (!isOpen) return null;

  const isAlreadyVerified = profile.verified === true || existingReq?.status === "approved";
  const isPending =
    !isAlreadyVerified &&
    existingReq?.status === "pending" &&
    !editingForm &&
    !justSubmitted;
  const isDeclinedOrRevoked =
    !isAlreadyVerified &&
    (existingReq?.status === "rejected" || existingReq?.status === "revoked");
  const isEmailVerified = auth.currentUser?.emailVerified ?? true;
  const swapsCount = Number((profile as any).swapsCompleted ?? profile.sessionsCount ?? 0);

  const handleNextStep = () => {
    setErrorMsg("");
    if (!domain.trim()) {
      setErrorMsg("Please select your primary area of expertise.");
      return;
    }
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!isEmailVerified) {
      setErrorMsg("Please verify your email address first before submitting.");
      return;
    }
    if (!legalOrKnownName.trim()) {
      setErrorMsg("Please enter your full name.");
      return;
    }
    if (!contactHandleOrPhone.trim()) {
      setErrorMsg("Please enter an email or phone number for contact.");
      return;
    }
    const cleanPrimaryUrl = normalizeUrlInput(portfolioUrl);
    if (!cleanPrimaryUrl) {
      setErrorMsg("Please add a portfolio, social profile, or official reference link.");
      return;
    }
    try {
      new URL(cleanPrimaryUrl);
    } catch {
      setErrorMsg("Please enter a valid web link (e.g. linkedin.com/in/yourname).");
      return;
    }
    if (statement.trim().length < 15) {
      setErrorMsg("Please add a brief note (at least 15 characters) about your work.");
      return;
    }
    if (!pledgeAccepted) {
      setErrorMsg("Please confirm that your details are accurate.");
      return;
    }

    setSubmitting(true);
    try {
      const saved = await submitVerificationApplication({
        profile,
        category,
        legalOrKnownName,
        contactHandleOrPhone,
        domain,
        portfolioUrl: cleanPrimaryUrl,
        instagram: instagram.trim(),
        youtube: youtube.trim(),
        linkedin: linkedin.trim(),
        github: github.trim(),
        website: profile.website,
        credentialReference: credentialReference.trim(),
        statement: statement.trim(),
      });
      setExistingReq(saved);
      setEditingForm(false);
      setJustSubmitted(true);
      onSubmitted?.(saved);
    } catch (err: any) {
      setErrorMsg(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const showForm = !loadingStatus && !isAlreadyVerified && !isPending && !justSubmitted;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 font-sans">
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="w-full sm:max-w-[440px] max-h-[92vh] bg-[#FFFFFF] text-[#0D0D0F] rounded-t-[28px] sm:rounded-[28px] shadow-2xl flex flex-col overflow-hidden border border-[#E8E4DB]"
        >
          {/* Clean Top Bar */}
          <div className="px-5 py-4 flex items-center justify-between border-b border-[#F1EFE9] shrink-0">
            <div className="flex items-center gap-2.5">
              {showForm && step === 2 ? (
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setErrorMsg("");
                  }}
                  className="w-8 h-8 -ml-1.5 rounded-full hover:bg-[#F7F4EE] flex items-center justify-center text-[#0D0D0F] transition cursor-pointer"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : (
                <div className="w-8 h-8 rounded-full bg-[#0D0D0F] text-[#C9A96E] flex items-center justify-center shrink-0">
                  <BadgeCheck className="w-4.5 h-4.5" />
                </div>
              )}
              <div>
                <h3 className="text-[16px] font-semibold tracking-tight text-[#0D0D0F] leading-tight">
                  Get Verified
                </h3>
                {showForm && (
                  <p className="text-[11px] text-[#71717A] leading-tight mt-0.5">
                    Step {step} of 2
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-[#F7F4EE] hover:bg-[#EDE9DF] flex items-center justify-center text-[#52525B] transition cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step Progress Bar (thin, crisp) */}
          {showForm && (
            <div className="h-[2px] w-full bg-[#F1EFE9] shrink-0">
              <div
                className="h-full bg-[#0D0D0F] transition-all duration-300"
                style={{ width: step === 1 ? "50%" : "100%" }}
              />
            </div>
          )}

          {/* Body */}
          <div ref={bodyScrollRef} className="flex-1 overflow-y-auto px-5 py-5 mobile-scroll overscroll-y-contain">
            <div ref={bodyContentRef} className="flex flex-col gap-5 w-full">
            {loadingStatus ? (
              <div className="py-16 flex flex-col items-center justify-center gap-2.5 text-[#71717A]">
                <Loader2 className="w-5 h-5 animate-spin text-[#0D0D0F]" />
                <span className="text-[13px]">Checking status...</span>
              </div>
            ) : isAlreadyVerified ? (
              <div className="py-6 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-[#0D0D0F] text-[#C9A96E] flex items-center justify-center shadow-sm">
                  <BadgeCheck className="w-8 h-8" />
                </div>
                <div className="space-y-1.5 max-w-xs">
                  <h4 className="text-[18px] font-semibold text-[#0D0D0F] tracking-tight">
                    You&apos;re Verified
                  </h4>
                  <p className="text-[13px] text-[#71717A] leading-relaxed">
                    Your account displays the official{" "}
                    <span className="font-medium text-[#0D0D0F]">
                      {profile.verificationBadgeLabel || existingReq?.badgeLabel || "Verified"}
                    </span>{" "}
                    badge approved by SwapSkill.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-2 w-full h-12 rounded-2xl bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] text-[14px] font-semibold transition cursor-pointer"
                >
                  Done
                </button>
              </div>
            ) : justSubmitted ? (
              <div className="py-6 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
                  <Check className="w-7 h-7 stroke-[2.5]" />
                </div>
                <div className="space-y-1.5 max-w-xs">
                  <h4 className="text-[18px] font-semibold text-[#0D0D0F] tracking-tight">
                    Request Received
                  </h4>
                  <p className="text-[13px] text-[#71717A] leading-relaxed">
                    Your verification details have been securely submitted. We&apos;ll notify you as soon as the review is complete.
                  </p>
                </div>
                <div className="w-full rounded-2xl bg-[#F7F4EE] border border-[#E8E4DB] px-4 py-3 text-[12px] text-[#52525B] flex items-center justify-center gap-2">
                  <Clock className="w-4 h-4 text-[#8B6F35]" />
                  <span>Badge activates only after approval</span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-1 w-full h-12 rounded-2xl bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] text-[14px] font-semibold transition cursor-pointer"
                >
                  Done
                </button>
              </div>
            ) : isPending ? (
              <div className="py-2 flex flex-col gap-5">
                <div className="flex flex-col items-center text-center gap-3 pt-3">
                  <div className="w-14 h-14 rounded-full bg-[#F7F4EE] border border-[#E8E4DB] text-[#8B6F35] flex items-center justify-center">
                    <Clock className="w-6 h-6" />
                  </div>
                  <div className="space-y-1 max-w-xs">
                    <h4 className="text-[17px] font-semibold text-[#0D0D0F]">
                      Under Review
                    </h4>
                    <p className="text-[13px] text-[#71717A] leading-relaxed">
                      We received your application and will notify you once reviewed. Your verified badge isn&apos;t active yet.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl bg-[#F7F4EE] border border-[#E8E4DB] divide-y divide-[#E8E4DB] text-[13px]">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-[#71717A]">Category</span>
                    <span className="font-medium text-[#0D0D0F] capitalize">
                      {existingReq?.category}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 gap-4">
                    <span className="text-[#71717A] shrink-0">Specialty</span>
                    <span className="font-medium text-[#0D0D0F] truncate">
                      {existingReq?.domain}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-[#71717A]">Privacy</span>
                    <span className="font-medium text-[#0D0D0F] flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5 text-[#8B6F35]" />
                      Encrypted
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full h-12 rounded-2xl bg-[#0D0D0F] text-[#F7F4EE] text-[14px] font-semibold hover:bg-[#1A1A1D] transition cursor-pointer"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingForm(true);
                      setStep(1);
                    }}
                    className="w-full h-10 rounded-xl text-[13px] font-medium text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
                  >
                    Edit application
                  </button>
                </div>
              </div>
            ) : step === 1 ? (
              /* STEP 1: Profile Preview + Category + Specialty */
              <div className="flex flex-col gap-5">
                {isDeclinedOrRevoked && (
                  <div className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="text-[12px] text-rose-900 leading-relaxed">
                      <div className="font-semibold">
                        Previous request {existingReq?.status === "revoked" ? "revoked" : "not approved"}
                      </div>
                      {existingReq?.rejectionReason && (
                        <p className="mt-0.5 text-rose-700">{existingReq.rejectionReason}</p>
                      )}
                    </div>
                  </div>
                )}

                {!isEmailVerified && (
                  <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2.5 text-[12px] text-amber-900">
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>Please verify your email address before applying.</span>
                  </div>
                )}

                {/* Calm Profile Summary Card */}
                <div className="rounded-2xl bg-[#F7F4EE] border border-[#E8E4DB] p-3.5 flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-full overflow-hidden border border-[#E8E4DB] shrink-0">
                    <SmartImage
                      src={getUserProfilePhoto(profile)}
                      alt={profile.fullName}
                      fallbackType="profile"
                      fullName={profile.fullName}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[15px] font-semibold text-[#0D0D0F] truncate">
                        {profile.fullName}
                      </span>
                      <BadgeCheck className="w-4 h-4 text-[#C9A96E] shrink-0" />
                    </div>
                    <p className="text-[12px] text-[#71717A] truncate mt-0.5 tabular-nums">
                      @{profile.username} · {swapsCount} swaps · {profile.followersCount || 0} followers
                    </p>
                  </div>
                </div>

                {/* Category Selection (Full-width clean radio rows) */}
                <div className="flex flex-col gap-2">
                  <label className="text-[13px] font-semibold text-[#0D0D0F]">
                    Choose verification type
                  </label>
                  <div className="flex flex-col gap-2">
                    {CATEGORY_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const selected = category === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setCategory(opt.id);
                            setErrorMsg("");
                          }}
                          className={`w-full p-3.5 rounded-2xl border text-left flex items-center gap-3.5 transition cursor-pointer ${
                            selected
                              ? "border-[#0D0D0F] bg-[#F7F4EE]"
                              : "border-[#E8E4DB] bg-[#FFFFFF] hover:bg-[#FAF8F4]"
                          }`}
                        >
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                              selected
                                ? "bg-[#0D0D0F] text-[#C9A96E]"
                                : "bg-[#F7F4EE] text-[#71717A]"
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold text-[#0D0D0F] leading-snug">
                              {opt.title}
                            </div>
                            <div className="text-[12px] text-[#71717A] leading-snug mt-0.5">
                              {opt.desc}
                            </div>
                          </div>
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              selected ? "border-[#0D0D0F] bg-[#0D0D0F]" : "border-[#D4D0C8]"
                            }`}
                          >
                            {selected && <Check className="w-3 h-3 text-[#FFFFFF] stroke-[3]" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Specialty Chip / Picker (Zero ugly browser dropdown tooltips) */}
                <div className="flex flex-col gap-2">
                  <label className="text-[13px] font-semibold text-[#0D0D0F]">
                    Primary area of expertise
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {DOMAIN_OPTIONS.map((d) => {
                      const active = domain === d;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            setDomain(d);
                            setErrorMsg("");
                          }}
                          className={`px-3 py-2 rounded-xl text-[12px] font-medium border transition cursor-pointer ${
                            active
                              ? "bg-[#0D0D0F] text-[#F7F4EE] border-[#0D0D0F]"
                              : "bg-[#FFFFFF] text-[#52525B] border-[#E8E4DB] hover:bg-[#F7F4EE]"
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {errorMsg && (
                  <p className="text-[12px] text-rose-600 font-medium">{errorMsg}</p>
                )}

                <button
                  type="button"
                  onClick={handleNextStep}
                  className="w-full h-12 rounded-2xl bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] text-[14px] font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>Continue</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* STEP 2: Single-column clean proof & review submission */
              <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-medium text-[#0D0D0F]">
                    Full name
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={legalOrKnownName}
                    onChange={(e) => setLegalOrKnownName(e.target.value)}
                    placeholder="Your full or public name"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F7F4EE]/70 border border-[#E8E4DB] text-[14px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:bg-[#FFFFFF] focus:outline-none focus:border-[#0D0D0F] transition"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-medium text-[#0D0D0F]">
                    Contact email or phone
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={contactHandleOrPhone}
                    onChange={(e) => setContactHandleOrPhone(e.target.value)}
                    placeholder="Email or phone number"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F7F4EE]/70 border border-[#E8E4DB] text-[14px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:bg-[#FFFFFF] focus:outline-none focus:border-[#0D0D0F] transition"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-medium text-[#0D0D0F]">
                    Official profile or portfolio link
                  </label>
                  <input
                    type="text"
                    inputMode="url"
                    maxLength={300}
                    value={portfolioUrl}
                    onChange={(e) => setPortfolioUrl(e.target.value)}
                    placeholder="e.g. linkedin.com/in/username or website"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F7F4EE]/70 border border-[#E8E4DB] text-[14px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:bg-[#FFFFFF] focus:outline-none focus:border-[#0D0D0F] transition"
                  />
                </div>

                {/* Clean progressive disclosure for extra social links (never cramped!) */}
                {!showMoreLinks ? (
                  <button
                    type="button"
                    onClick={() => setShowMoreLinks(true)}
                    className="self-start text-[12px] font-medium text-[#52525B] hover:text-[#0D0D0F] underline underline-offset-4 cursor-pointer"
                  >
                    + Add Instagram, YouTube, LinkedIn, or credential ID (optional)
                  </button>
                ) : (
                  <div className="flex flex-col gap-3 p-3.5 rounded-2xl bg-[#F7F4EE]/60 border border-[#E8E4DB]">
                    <div className="text-[12px] font-medium text-[#52525B]">
                      Optional supporting links & credentials
                    </div>
                    <input
                      type="text"
                      maxLength={180}
                      value={instagram}
                      onChange={(e) => setInstagram(e.target.value)}
                      placeholder="Instagram profile URL or @handle"
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] text-[13px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F]"
                    />
                    <input
                      type="text"
                      maxLength={180}
                      value={youtube}
                      onChange={(e) => setYoutube(e.target.value)}
                      placeholder="YouTube channel URL"
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] text-[13px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F]"
                    />
                    <input
                      type="text"
                      maxLength={180}
                      value={linkedin}
                      onChange={(e) => setLinkedin(e.target.value)}
                      placeholder="LinkedIn profile URL"
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] text-[13px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F]"
                    />
                    <input
                      type="text"
                      maxLength={180}
                      value={github}
                      onChange={(e) => setGithub(e.target.value)}
                      placeholder="GitHub or website URL"
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] text-[13px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F]"
                    />
                    <input
                      type="text"
                      maxLength={250}
                      value={credentialReference}
                      onChange={(e) => setCredentialReference(e.target.value)}
                      placeholder="Certificate ID, award, or press link"
                      className="w-full h-10 px-3 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] text-[13px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F]"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-medium text-[#0D0D0F]">
                    Brief note for reviewer
                  </label>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={statement}
                    onChange={(e) => setStatement(e.target.value)}
                    placeholder="Summarize your expertise, teaching track record, or public work..."
                    className="w-full p-3.5 rounded-xl bg-[#F7F4EE]/70 border border-[#E8E4DB] text-[14px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:bg-[#FFFFFF] focus:outline-none focus:border-[#0D0D0F] resize-none transition"
                  />
                </div>

                <label className="flex items-start gap-2.5 pt-0.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pledgeAccepted}
                    onChange={(e) => setPledgeAccepted(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-[#D4D0C8] accent-[#0D0D0F] cursor-pointer"
                  />
                  <span className="text-[12px] text-[#71717A] leading-relaxed">
                    I confirm these details belong to me. Verification is granted after manual review.
                  </span>
                </label>

                {errorMsg && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-[12px] text-rose-700 font-medium">
                    {errorMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-1 w-full h-12 rounded-2xl bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] text-[14px] font-semibold transition flex items-center justify-center gap-2 disabled:opacity-55 cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>Submit Request</span>
                  )}
                </button>

                <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#A1A1AA] pb-1">
                  <Lock className="w-3 h-3" />
                  <span>Encrypted before upload · Reviewed only by SwapSkill</span>
                </div>
              </form>
            )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
