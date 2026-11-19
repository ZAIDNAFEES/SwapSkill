import React, { useMemo, useState, useEffect } from "react";
import {
  Award,
  BadgeCheck,
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Share2,
  Star,
  X,
} from "lucide-react";
import { Session, UserProfile } from "../types";
import {
  buildCertificateData,
  buildCertificatePdfFile,
  buildLinkedInAddCertUrl,
  downloadCertificatePdf,
} from "../utils/certificatePdfGenerator";

interface CertificateModalProps {
  session: Session | null;
  currentUserId: string;
  profilesCache: Record<string, UserProfile>;
  currentUserProfile: UserProfile | null;
  onClose: () => void;
}

export default function CertificateModal({
  session,
  currentUserId,
  profilesCache,
  currentUserProfile,
  onClose,
}: CertificateModalProps) {
  const [copiedKey, setCopiedKey] = useState<"id" | "share" | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfDownloaded, setPdfDownloaded] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);

  const cert = useMemo(() => {
    if (!session) return null;
    return buildCertificateData(session, currentUserId, profilesCache, currentUserProfile);
  }, [session, currentUserId, profilesCache, currentUserProfile]);

  useEffect(() => {
    if (!session) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [session, onClose]);

  if (!session || !cert) return null;

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(`${cert.serialCode} (${cert.sessionId})`);
      setCopiedKey("id");
      setTimeout(() => setCopiedKey((prev) => (prev === "id" ? null : prev)), 2200);
    } catch (_) {}
  };

  const handleDownloadPdf = async () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      downloadCertificatePdf(cert);
      setPdfDownloaded(true);
      setTimeout(() => setPdfDownloaded(false), 3000);
    } catch (err) {
      console.error("Certificate PDF generation failed:", err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleShareCertificate = async () => {
    if (sharingPdf) return;
    setSharingPdf(true);
    const partnerQualifier = cert.partner.isVerified
      ? `${cert.partner.name} (${cert.partner.verifiedLabel || "Verified"})`
      : cert.partner.name;

    const shareText = `Completed a verified ${cert.durationMinutes}-minute 1:1 skill exchange in ${cert.skillName} with ${partnerQualifier} on SwapSkill. Credential ID: ${cert.serialCode}`;

    try {
      const pdfFile = buildCertificatePdfFile(cert);
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [pdfFile] })
      ) {
        await navigator.share({
          title: `SwapSkill Certificate — ${cert.skillName}`,
          text: shareText,
          files: [pdfFile],
        });
        setSharingPdf(false);
        return;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setSharingPdf(false);
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedKey("share");
      setTimeout(() => setCopiedKey((prev) => (prev === "share" ? null : prev)), 2400);
    } catch (_) {}
    setSharingPdf(false);
  };

  const linkedInUrl = buildLinkedInAddCertUrl(cert);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Verified SwapSkill Certificate"
      onClick={onClose}
      className="fixed inset-0 z-[80] bg-[#0D0D0F]/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 font-sans animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#FFFFFF] border-t sm:border border-[#E8E4DB] rounded-t-3xl sm:rounded-3xl w-full max-w-2xl max-h-[92dvh] flex flex-col shadow-2xl overflow-hidden text-[#0D0D0F]"
      >
        {/* Top Bar */}
        <div className="px-5 py-3.5 border-b border-[#E8E4DB] bg-[#FFFFFF] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#0D0D0F] flex items-center justify-center text-[#C9A96E] shrink-0">
              <Award className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#9A7A42] block leading-none">
                Official Credential
              </span>
              <span className="text-[11px] font-mono text-[#71717A] truncate block mt-1">
                {cert.serialCode}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close certificate"
            className="w-9 h-9 rounded-xl border border-[#E8E4DB] bg-[#FAF8F4] hover:bg-[#F2EFE8] text-[#52525B] hover:text-[#0D0D0F] flex items-center justify-center transition cursor-pointer shrink-0 active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Real Parchment Diploma Viewport */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 bg-[#F4EFE6]/70 mobile-scroll">
          <div className="bg-[#FCF9F2] border-2 border-[#C9A96E] p-1.5 sm:p-2 rounded-2xl shadow-md">
            <div className="border border-[#0D0D0F]/80 rounded-xl bg-[#FFFFFF] px-4 py-5 sm:px-7 sm:py-6 relative overflow-hidden">
              {/* Subtle Corner Gold Accents */}
              <span aria-hidden="true" className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-[#C9A96E]" />
              <span aria-hidden="true" className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-[#C9A96E]" />
              <span aria-hidden="true" className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-[#C9A96E]" />
              <span aria-hidden="true" className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-[#C9A96E]" />

              {/* Crest & Issuer Header */}
              <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-[#EFECE4]">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-[#0D0D0F] border border-[#C9A96E]/60 flex items-center justify-center text-[#C9A96E] shrink-0">
                    <Award className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold tracking-[0.16em] text-[#0D0D0F] block leading-none">
                      SWAPSKILL
                    </span>
                    <span className="text-[9.5px] font-medium tracking-wide text-[#71717A] block mt-0.5 truncate">
                      Verified Skill Exchange Network
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FAF6ED] border border-[#E6D5B3] text-[10px] font-semibold text-[#8E6F3A]">
                    <BadgeCheck className="w-3 h-3 text-[#C9A96E]" />
                    <span>Verified Record</span>
                  </span>
                </div>
              </div>

              {/* Diploma Title & Recipient */}
              <div className="text-center pt-5 pb-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9A7A42]">
                  Certificate of Skill Exchange
                </p>
                <h2
                  className="text-[24px] sm:text-[28px] font-bold text-[#0D0D0F] tracking-tight leading-tight mt-1"
                  style={{ fontFamily: "var(--font-serif, Georgia, serif)" }}
                >
                  {cert.holder.name}
                </h2>
                <div className="flex items-center justify-center flex-wrap gap-1.5 mt-1.5 text-[11.5px] text-[#71717A]">
                  {cert.holder.isVerified && (
                    <span className="inline-flex items-center gap-1 font-semibold text-[#0D0D0F]">
                      <BadgeCheck className="w-3.5 h-3.5 text-[#C9A96E]" />
                      <span>{cert.holder.verifiedLabel || "Verified"}</span>
                    </span>
                  )}
                  {cert.holder.isVerified && (cert.holder.username || cert.holder.location) && (
                    <span aria-hidden="true">·</span>
                  )}
                  {cert.holder.username && <span>@{cert.holder.username}</span>}
                  {cert.holder.username && cert.holder.location && <span aria-hidden="true">·</span>}
                  {cert.holder.location && <span>{cert.holder.location}</span>}
                </div>

                <p className="text-[12.5px] text-[#52525B] max-w-md mx-auto mt-3 leading-relaxed">
                  {cert.holderRole === "mentor"
                    ? `Successfully mentored and led a verified ${cert.durationMinutes}-minute 1-on-1 skill exchange session.`
                    : `Successfully completed a verified ${cert.durationMinutes}-minute 1-on-1 mentorship & knowledge exchange session.`}
                </p>
              </div>

              {/* Dual-Column Verified Exchange Ledger */}
              <div className="rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A7A42] block">
                    Skill &amp; Topic Verified
                  </span>
                  <p
                    className="text-[16px] font-bold text-[#0D0D0F] leading-snug mt-0.5 break-words"
                    style={{ fontFamily: "var(--font-serif, Georgia, serif)" }}
                  >
                    {cert.skillName}
                  </p>
                  {cert.reciprocalSkill ? (
                    <p className="text-[11.5px] text-[#52525B] mt-1">
                      Mutual Swap: <span className="font-medium text-[#0D0D0F]">{cert.reciprocalSkill}</span>
                    </p>
                  ) : (
                    <p className="text-[11.5px] text-[#71717A] mt-1">
                      {cert.sessionType}
                    </p>
                  )}
                </div>

                <div className="min-w-0 sm:border-l sm:border-[#E2DDD2] sm:pl-3.5 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-[#E2DDD2]">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A7A42] block">
                    {cert.holderRole === "mentor" ? "Exchange Learner" : "Mentor & Partner"}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span
                      className="text-[15.5px] font-bold text-[#0D0D0F] leading-snug break-words"
                      style={{ fontFamily: "var(--font-serif, Georgia, serif)" }}
                    >
                      {cert.partner.name}
                    </span>
                    {cert.partner.isVerified && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#0D0D0F] text-[#F7F4EE] text-[10px] font-semibold shrink-0">
                        <BadgeCheck className="w-3 h-3 text-[#C9A96E]" />
                        <span>{cert.partner.verifiedLabel || "Verified"}</span>
                      </span>
                    )}
                  </div>
                  {(cert.partner.username || cert.partner.location) && (
                    <p className="text-[11.5px] text-[#71717A] mt-1 truncate">
                      {[cert.partner.username ? `@${cert.partner.username}` : "", cert.partner.location || ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              </div>

              {/* Authenticity Meta Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 mt-4 border-t border-[#EFECE4] text-left">
                <div>
                  <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#A1A1AA] block">
                    Date Issued
                  </span>
                  <span className="text-[12px] font-semibold text-[#0D0D0F] mt-0.5 block">
                    {cert.formattedDate}
                  </span>
                </div>
                <div>
                  <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#A1A1AA] block">
                    Duration
                  </span>
                  <span className="text-[12px] font-semibold text-[#0D0D0F] mt-0.5 block tabular-nums">
                    {cert.durationMinutes} Minutes
                  </span>
                </div>
                <div>
                  <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#A1A1AA] block">
                    {cert.rating ? "Session Rating" : "Format"}
                  </span>
                  <span className="text-[12px] font-semibold text-[#0D0D0F] mt-0.5 inline-flex items-center gap-1">
                    {cert.rating ? (
                      <>
                        <Star className="w-3 h-3 fill-[#C9A96E] text-[#C9A96E]" />
                        <span>{cert.rating.toFixed(1)} / 5.0</span>
                      </>
                    ) : (
                      <span>1:1 Live Swap</span>
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#A1A1AA] block">
                    Verify Hash
                  </span>
                  <span className="text-[11px] font-mono font-semibold text-[#0D0D0F] mt-0.5 block truncate">
                    {cert.verificationHash}
                  </span>
                </div>
              </div>

              {/* Signature & Embossed Gold Seal Footer */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 pt-5 mt-4 border-t border-[#EFECE4]">
                <div className="text-center min-w-0">
                  <svg viewBox="0 0 110 26" className="w-20 h-6 mx-auto text-[#1A1A1D]" fill="none">
                    <path
                      d="M8 20 C18 7, 22 22, 32 10 C39 18, 46 6, 56 15 C66 12, 82 11, 102 12"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="h-px bg-[#D8D2C5] w-full mb-1" />
                  <p className="text-[10.5px] font-semibold text-[#0D0D0F] truncate">
                    {cert.mentor.name}
                  </p>
                  <p className="text-[9px] text-[#71717A] truncate">
                    {cert.mentor.verifiedLabel ? `${cert.mentor.verifiedLabel} · Mentor` : "Session Mentor"}
                  </p>
                </div>

                {/* Central Gold Medallion Seal */}
                <div className="flex flex-col items-center shrink-0 px-1">
                  <div className="w-12 h-12 rounded-full bg-[#C9A96E] p-[3px] shadow-sm flex items-center justify-center">
                    <div className="w-full h-full rounded-full bg-[#0D0D0F] border border-[#C9A96E]/80 flex flex-col items-center justify-center">
                      <Check className="w-3.5 h-3.5 text-[#F7F4EE]" strokeWidth={2.5} />
                      <span className="text-[6.5px] font-bold tracking-wider text-[#C9A96E] leading-none mt-0.5">
                        VERIFIED
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-center min-w-0">
                  <svg viewBox="0 0 110 26" className="w-20 h-6 mx-auto text-[#1A1A1D]" fill="none">
                    <path
                      d="M10 18 C16 6, 26 22, 34 8 C42 20, 50 9, 64 14 C75 17, 86 9, 100 11"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="h-px bg-[#D8D2C5] w-full mb-1" />
                  <p className="text-[10.5px] font-semibold text-[#0D0D0F] truncate">
                    SwapSkill Board
                  </p>
                  <p className="text-[9px] text-[#71717A] truncate">
                    Verification Authority
                  </p>
                </div>
              </div>

              {/* Copyable Immutable Session Reference */}
              <div className="mt-4 pt-3 border-t border-[#F2EFE8] flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[9px] font-mono uppercase tracking-wider text-[#9A7A42] font-semibold block">
                    Session ID
                  </span>
                  <span className="text-[10.5px] font-mono text-[#71717A] truncate block">
                    {cert.sessionId}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="h-8 px-2.5 rounded-lg bg-[#F7F4EE] hover:bg-[#EFECE4] border border-[#E8E4DB] text-[11px] font-medium text-[#0D0D0F] inline-flex items-center gap-1.5 transition cursor-pointer shrink-0 active:scale-95"
                >
                  {copiedKey === "id" ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-700" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-[#71717A]" />
                      <span>Copy ID</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Action Footer: Download PDF + Add to LinkedIn + Share */}
        <div
          className="px-4 sm:px-5 py-3.5 border-t border-[#E8E4DB] bg-[#FFFFFF] flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 14px)" }}
        >
          <button
            id="download-certificate-pdf-btn"
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="flex-1 h-11 px-4 rounded-xl bg-[#0D0D0F] hover:bg-[#1C1C20] active:scale-[0.98] text-[#F7F4EE] text-[13px] font-semibold inline-flex items-center justify-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-60"
          >
            {downloadingPdf ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#C9A96E]" />
            ) : pdfDownloaded ? (
              <Check className="w-4 h-4 text-[#C9A96E]" strokeWidth={2.4} />
            ) : (
              <Download className="w-4 h-4 text-[#C9A96E]" strokeWidth={2.2} />
            )}
            <span>{pdfDownloaded ? "PDF Downloaded" : "Download PDF"}</span>
          </button>

          <div className="flex items-center gap-2">
            <a
              id="add-certificate-linkedin-btn"
              href={linkedInUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-initial h-11 px-3.5 rounded-xl bg-[#FFFFFF] hover:bg-[#FAF8F4] active:scale-[0.98] border border-[#E2DDD2] text-[#0D0D0F] text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 transition whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#0A66C2]" strokeWidth={2.2} />
              <span>Add to LinkedIn</span>
            </a>

            <button
              id="share-certificate-btn"
              type="button"
              onClick={handleShareCertificate}
              disabled={sharingPdf}
              className="h-11 px-3.5 rounded-xl bg-[#F7F4EE] hover:bg-[#EFECE4] active:scale-[0.98] border border-[#E8E4DB] text-[#0D0D0F] text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {copiedKey === "share" ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5 text-[#52525B]" />
                  <span>Share</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
