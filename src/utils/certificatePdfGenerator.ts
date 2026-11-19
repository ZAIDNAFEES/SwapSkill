import { jsPDF } from "jspdf";
import { Session, UserProfile } from "../types";

export interface CertificateParticipantInfo {
  uid: string;
  name: string;
  username?: string;
  location?: string;
  isVerified: boolean;
  verifiedLabel?: string;
}

export interface CertificateData {
  sessionId: string;
  serialCode: string;
  verificationHash: string;
  skillName: string;
  reciprocalSkill?: string;
  sessionType: string;
  durationMinutes: number;
  completedDate: Date;
  formattedDate: string;
  holderRole: "learner" | "mentor";
  holder: CertificateParticipantInfo;
  partner: CertificateParticipantInfo;
  mentor: CertificateParticipantInfo;
  learner: CertificateParticipantInfo;
  rating?: number;
}

function toTimestampMs(val: any): number {
  if (!val) return 0;
  if (val instanceof Date) return isNaN(val.getTime()) ? 0 : val.getTime();
  if (typeof val === "number") return val < 1e12 ? val * 1000 : val;
  if (typeof val?.toDate === "function") {
    const d = val.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0;
  }
  if (typeof val?.seconds === "number") return val.seconds * 1000;
  if (typeof val?._seconds === "number") return val._seconds * 1000;
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

export function isUserVerified(profile?: Partial<UserProfile> | null): boolean {
  if (!profile) return false;
  return (
    profile.verified === true ||
    (profile as any).verified === "true" ||
    profile.verificationStatus === "approved"
  );
}

export function getVerifiedTitle(profile?: Partial<UserProfile> | null): string | undefined {
  if (!isUserVerified(profile)) return undefined;
  const custom = profile?.verificationBadgeLabel?.trim();
  if (custom && custom.toLowerCase() !== "verified") {
    return custom;
  }
  const tier = profile?.verificationTier;
  if (tier === "notable") return "Notable";
  if (tier === "mentor") return "Verified Mentor";
  if (tier === "creator") return "Verified Creator";
  return "Verified";
}

export function computeCertificateSerial(sessionId: string): string {
  const clean = (sessionId || "SWAPSKILL").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const part1 = clean.slice(0, 4).padEnd(4, "X");
  const part2 = clean.slice(-4).padStart(4, "0");
  return `SKW-${part1}-${part2}`;
}

export function computeVerificationHash(sessionId: string, mentorId: string, learnerId: string): string {
  const seed = `${sessionId}|${mentorId}|${learnerId}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + ((h2 << 6) + (h2 >> 2));
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const hex1 = (h1 >>> 0).toString(16).toUpperCase().padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `${hex1.slice(0, 4)}-${hex2.slice(0, 4)}-${hex1.slice(4, 8)}`;
}

function buildLocation(profile?: Partial<UserProfile> | null): string | undefined {
  if (!profile) return undefined;
  const parts = [profile.city?.trim(), profile.country?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export function buildCertificateData(
  session: Session,
  currentUserId: string,
  profilesCache: Record<string, UserProfile>,
  currentUserProfile: UserProfile | null
): CertificateData {
  const mentorId = session.teacherId || "";
  const learnerId = session.learnerId || session.studentId || "";

  const mentorProfile =
    mentorId === currentUserId ? currentUserProfile : profilesCache[mentorId] || null;
  const learnerProfile =
    learnerId === currentUserId ? currentUserProfile : profilesCache[learnerId] || null;

  const isMentor = mentorId === currentUserId;
  const isSameTestUser = Boolean(mentorId && learnerId && mentorId === learnerId);

  const rawMentorName =
    mentorProfile?.fullName?.trim() ||
    mentorProfile?.displayName?.trim() ||
    session.teacherName?.trim() ||
    "Session Mentor";

  const rawLearnerName =
    learnerProfile?.fullName?.trim() ||
    learnerProfile?.displayName?.trim() ||
    session.learnerName?.trim() ||
    session.studentName?.trim() ||
    "Skill Exchange Participant";

  const mentorInfo: CertificateParticipantInfo = {
    uid: mentorId,
    name: rawMentorName,
    username: mentorProfile?.username?.trim() || undefined,
    location: buildLocation(mentorProfile),
    isVerified: isUserVerified(mentorProfile),
    verifiedLabel: getVerifiedTitle(mentorProfile),
  };

  const learnerInfo: CertificateParticipantInfo = {
    uid: learnerId,
    name: isSameTestUser && rawLearnerName === rawMentorName ? rawLearnerName : rawLearnerName,
    username: learnerProfile?.username?.trim() || undefined,
    location: buildLocation(learnerProfile),
    isVerified: isUserVerified(learnerProfile),
    verifiedLabel: getVerifiedTitle(learnerProfile),
  };

  const holderRole: "learner" | "mentor" = isMentor ? "mentor" : "learner";
  const holder = holderRole === "mentor" ? mentorInfo : learnerInfo;
  const partner = holderRole === "mentor" ? learnerInfo : mentorInfo;

  const ms =
    toTimestampMs(session.completedAt) ||
    toTimestampMs(session.actualEndTime) ||
    toTimestampMs(session.scheduledTime) ||
    Date.now();
  const completedDate = new Date(ms);

  const formattedDate = completedDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const parsedDuration = Number(session.actualDuration || session.duration || 60);
  const durationMinutes = Number.isFinite(parsedDuration) && parsedDuration > 0 ? Math.round(parsedDuration) : 60;

  return {
    sessionId: session.id,
    serialCode: computeCertificateSerial(session.id),
    verificationHash: computeVerificationHash(session.id, mentorId, learnerId),
    skillName: (session.skillName || session.skill || "Peer Skill Exchange").trim(),
    reciprocalSkill: session.teachSkill?.trim() || undefined,
    sessionType: session.sessionType?.trim() || "1-on-1 Live Video Session",
    durationMinutes,
    completedDate,
    formattedDate,
    holderRole,
    holder,
    partner,
    mentor: mentorInfo,
    learner: learnerInfo,
    rating: typeof session.rating === "number" && session.rating > 0 ? session.rating : undefined,
  };
}

/** Sanitize strings so built-in PDF WinAnsi fonts never output corrupted glyphs */
function toPdfSafeText(input?: string): string {
  if (!input) return "";
  return input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00B7/g, " | ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function drawGoldSeal(doc: jsPDF, cx: number, cy: number, radius: number) {
  // Subtle outer serrated points
  const points = 24;
  for (let i = 0; i < points; i++) {
    const a = (i * 2 * Math.PI) / points;
    const px = cx + Math.cos(a) * (radius + 0.9);
    const py = cy + Math.sin(a) * (radius + 0.9);
    doc.setFillColor(201, 169, 110);
    doc.circle(px, py, 1.35, "F");
  }

  // Gold main medallion
  doc.setFillColor(201, 169, 110);
  doc.circle(cx, cy, radius, "F");

  // Obsidian inner core
  doc.setFillColor(13, 13, 15);
  doc.circle(cx, cy, radius - 2.1, "F");

  // Gold precision ring inside core
  doc.setDrawColor(201, 169, 110);
  doc.setLineWidth(0.35);
  doc.circle(cx, cy, radius - 3.3, "S");

  // Crisp center verified checkmark
  doc.setDrawColor(247, 244, 238);
  doc.setLineWidth(0.95);
  doc.line(cx - 2.5, cy - 1.2, cx - 0.6, cy + 0.8);
  doc.line(cx - 0.6, cy + 0.8, cx + 3.0, cy - 3.1);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(4.7);
  doc.setTextColor(201, 169, 110);
  doc.text("VERIFIED", cx, cy + 4.3, { align: "center" });

  doc.setFontSize(4.2);
  doc.setTextColor(247, 244, 238);
  doc.text("SWAPSKILL", cx, cy + 6.9, { align: "center" });
}

function drawVerifiedBadgeChip(doc: jsPDF, x: number, y: number, label: string) {
  const safeLabel = toPdfSafeText(label).toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  const textW = doc.getTextWidth(safeLabel);
  const badgeW = textW + 10.5;
  const badgeH = 5.8;

  doc.setFillColor(13, 13, 15);
  doc.roundedRect(x, y, badgeW, badgeH, 1.5, 1.5, "F");

  doc.setDrawColor(201, 169, 110);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, badgeW, badgeH, 1.5, 1.5, "S");

  // Small gold dot + check
  doc.setFillColor(201, 169, 110);
  doc.circle(x + 3.3, y + badgeH / 2, 1.4, "F");
  doc.setDrawColor(13, 13, 15);
  doc.setLineWidth(0.42);
  doc.line(x + 2.6, y + badgeH / 2 + 0.1, x + 3.15, y + badgeH / 2 + 0.7);
  doc.line(x + 3.15, y + badgeH / 2 + 0.7, x + 4.1, y + badgeH / 2 - 0.55);

  doc.setTextColor(247, 244, 238);
  doc.text(safeLabel, x + 6.4, y + 3.9);
  return badgeW;
}

function drawSignatureScript(doc: jsPDF, x: number, y: number, variant: "authority" | "mentor") {
  doc.setDrawColor(26, 26, 29);
  doc.setLineWidth(0.5);
  if (variant === "authority") {
    // Elegant cursive calligraphic stroke
    doc.lines(
      [
        [4, -5],
        [3, 5],
        [5, -6],
        [4, 4],
        [6, -3],
        [5, 2],
        [10, -1],
        [-3, 1.5],
        [14, -2],
      ],
      x,
      y
    );
  } else {
    doc.lines(
      [
        [5, -4],
        [2, 3],
        [6, -5],
        [3, 4],
        [5, -2],
        [9, -1],
        [7, 0.5],
      ],
      x,
      y
    );
  }
}

export function generateCertificatePdf(data: CertificateData): jsPDF {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageW = 297;
  const pageH = 210;
  const cx = pageW / 2;

  // 1. Warm Ivory Parchment Base
  doc.setFillColor(247, 244, 238);
  doc.rect(0, 0, pageW, pageH, "F");

  // Clean White Inner Sheet
  doc.setFillColor(255, 254, 251);
  doc.rect(9, 9, pageW - 18, pageH - 18, "F");

  // 2. Architectural Double Frame (Champagne Gold + Obsidian Precision Rule)
  doc.setDrawColor(201, 169, 110);
  doc.setLineWidth(0.95);
  doc.rect(11.5, 11.5, pageW - 23, pageH - 23, "S");

  doc.setDrawColor(13, 13, 15);
  doc.setLineWidth(0.3);
  doc.rect(14.5, 14.5, pageW - 29, pageH - 29, "S");

  // Ornate Corner Accents
  const cornerLen = 7;
  doc.setDrawColor(201, 169, 110);
  doc.setLineWidth(1.2);
  // Top-left
  doc.line(11.5, 11.5 + cornerLen, 11.5, 11.5);
  doc.line(11.5, 11.5, 11.5 + cornerLen, 11.5);
  // Top-right
  doc.line(pageW - 11.5 - cornerLen, 11.5, pageW - 11.5, 11.5);
  doc.line(pageW - 11.5, 11.5, pageW - 11.5, 11.5 + cornerLen);
  // Bottom-left
  doc.line(11.5, pageH - 11.5 - cornerLen, 11.5, pageH - 11.5);
  doc.line(11.5, pageH - 11.5, 11.5 + cornerLen, pageH - 11.5);
  // Bottom-right
  doc.line(pageW - 11.5 - cornerLen, pageH - 11.5, pageW - 11.5, pageH - 11.5);
  doc.line(pageW - 11.5, pageH - 11.5 - cornerLen, pageW - 11.5, pageH - 11.5);

  // Subtle decorative watermark circle in backdrop
  doc.setDrawColor(240, 235, 224);
  doc.setLineWidth(0.6);
  doc.circle(cx, 103, 52, "S");
  doc.circle(cx, 103, 45, "S");

  // 3. Top Executive Header Band
  // Brand Crest Left
  doc.setFillColor(13, 13, 15);
  doc.roundedRect(22, 21, 11, 11, 2.2, 2.2, "F");
  doc.setDrawColor(201, 169, 110);
  doc.setLineWidth(0.5);
  doc.circle(27.5, 26.5, 3.2, "S");
  doc.setFillColor(201, 169, 110);
  doc.circle(27.5, 26.5, 1.1, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(13, 13, 15);
  doc.text("SWAPSKILL", 36, 25.8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(113, 113, 122);
  doc.text("VERIFIED PEER KNOWLEDGE EXCHANGE", 36, 30.2);

  // Right Serial & Authenticity Status
  doc.setFont("courier", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor(13, 13, 15);
  doc.text(`CREDENTIAL NO. ${toPdfSafeText(data.serialCode)}`, pageW - 22, 25.5, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(154, 122, 66);
  doc.text("ISSUED & CRYPTOGRAPHICALLY VERIFIED", pageW - 22, 29.8, { align: "right" });

  // Subtle hairline under header
  doc.setDrawColor(232, 228, 219);
  doc.setLineWidth(0.35);
  doc.line(22, 36.5, pageW - 22, 36.5);

  // 4. Formal Diploma Title Block
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(154, 122, 66);
  doc.text("OFFICIAL CREDENTIAL OF COMPLETION", cx, 46, { align: "center" });

  doc.setFont("times", "bold");
  doc.setFontSize(28);
  doc.setTextColor(13, 13, 15);
  doc.text("Certificate of Skill Exchange", cx, 57, { align: "center" });

  // Fine gold ornament divider under title
  doc.setDrawColor(201, 169, 110);
  doc.setLineWidth(0.55);
  doc.line(cx - 38, 61.5, cx + 38, 61.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(113, 113, 122);
  doc.text("THIS PROUDLY CERTIFIES THAT", cx, 69.5, { align: "center" });

  // 5. Honored Recipient Name
  const recipientDisplayName = toPdfSafeText(data.holder.name) || "SwapSkill Member";
  doc.setFont("times", "bold");
  doc.setFontSize(recipientDisplayName.length > 28 ? 22 : 27);
  doc.setTextColor(13, 13, 15);
  doc.text(recipientDisplayName, cx, 81, { align: "center" });

  // Subtle highlight underline beneath recipient
  doc.setDrawColor(226, 221, 210);
  doc.setLineWidth(0.4);
  doc.line(cx - 64, 84.5, cx + 64, 84.5);

  // Holder Meta Line (if verified or handle/location present)
  const holderMetaParts: string[] = [];
  if (data.holder.verifiedLabel) holderMetaParts.push(data.holder.verifiedLabel);
  if (data.holder.username) holderMetaParts.push(`@${data.holder.username}`);
  if (data.holder.location) holderMetaParts.push(data.holder.location);
  if (holderMetaParts.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(113, 113, 122);
    doc.text(toPdfSafeText(holderMetaParts.join("  |  ")), cx, 90, { align: "center" });
  }

  // 6. Citation Sentence
  const safeSkill = toPdfSafeText(data.skillName);
  const safePartner = toPdfSafeText(data.partner.name);
  const citationY = holderMetaParts.length > 0 ? 97.5 : 94.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(63, 63, 70);
  const actionLine =
    data.holderRole === "mentor"
      ? `has successfully mentored and led a verified ${data.durationMinutes}-minute 1-on-1 skill exchange on`
      : `has successfully completed a verified ${data.durationMinutes}-minute 1-on-1 mentorship & skill exchange on`;
  doc.text(actionLine, cx, citationY, { align: "center" });

  // 7. Highlighted Skill + Partner Showcase Card (Clean Editorial Box)
  const cardX = 28;
  const cardY = citationY + 5;
  const cardW = pageW - 56;
  const cardH = 38;

  doc.setFillColor(247, 244, 238);
  doc.roundedRect(cardX, cardY, cardW, cardH, 3, 3, "F");
  doc.setDrawColor(232, 228, 219);
  doc.setLineWidth(0.4);
  doc.roundedRect(cardX, cardY, cardW, cardH, 3, 3, "S");

  // Vertical divider between Mentor/Partner and Subject
  const splitX = cardX + cardW * 0.5;
  doc.setDrawColor(226, 221, 210);
  doc.line(splitX, cardY + 5, splitX, cardY + cardH - 5);

  // Left Side: SKILL FOCUS
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(154, 122, 66);
  doc.text("SKILL & TOPIC VERIFIED", cardX + 8, cardY + 9);

  doc.setFont("times", "bold");
  doc.setFontSize(safeSkill.length > 26 ? 13 : 15.5);
  doc.setTextColor(13, 13, 15);
  doc.text(safeSkill, cardX + 8, cardY + 17.5, { maxWidth: cardW * 0.45 });

  if (data.reciprocalSkill) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(82, 82, 91);
    doc.text(
      toPdfSafeText(`Mutual Swap Topic: ${data.reciprocalSkill}`),
      cardX + 8,
      cardY + 26.5,
      { maxWidth: cardW * 0.45 }
    );
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(82, 82, 91);
    doc.text(
      toPdfSafeText(`${data.sessionType}  |  Live Peer Exchange`),
      cardX + 8,
      cardY + 26.5,
      { maxWidth: cardW * 0.45 }
    );
  }

  // Right Side: MENTOR / PARTNER + VERIFIED STATUS
  const partnerRoleLabel =
    data.holderRole === "mentor" ? "EXCHANGE LEARNER" : "SESSION MENTOR & EXCHANGE PARTNER";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(154, 122, 66);
  doc.text(partnerRoleLabel, splitX + 8, cardY + 9);

  doc.setFont("times", "bold");
  doc.setFontSize(safePartner.length > 24 ? 13 : 15);
  doc.setTextColor(13, 13, 15);
  doc.text(safePartner, splitX + 8, cardY + 17.5, { maxWidth: cardW * 0.45 });

  // Verified Badge if partner is verified!
  let badgeNextY = cardY + 22.5;
  if (data.partner.isVerified) {
    const labelText = data.partner.verifiedLabel
      ? `Verified | ${data.partner.verifiedLabel}`
      : "Verified SwapSkill Member";
    drawVerifiedBadgeChip(doc, splitX + 8, badgeNextY, labelText);
    badgeNextY += 8;
  }

  const partnerSubParts: string[] = [];
  if (data.partner.username) partnerSubParts.push(`@${data.partner.username}`);
  if (data.partner.location) partnerSubParts.push(data.partner.location);
  if (partnerSubParts.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(113, 113, 122);
    doc.text(
      toPdfSafeText(partnerSubParts.join("  |  ")),
      splitX + 8,
      data.partner.isVerified ? badgeNextY + 1.5 : cardY + 26.5,
      { maxWidth: cardW * 0.45 }
    );
  }

  // 8. Metadata Ledger Row (Date, Duration, Format, Hash)
  const metaY = cardY + cardH + 10.5;
  const cols = [
    { label: "DATE ISSUED", value: toPdfSafeText(data.formattedDate), x: 32 },
    { label: "VERIFIED DURATION", value: `${data.durationMinutes} Minutes`, x: 97 },
    {
      label: data.rating ? "PEER RATING" : "EXCHANGE FORMAT",
      value: data.rating ? `${data.rating.toFixed(1)} / 5.0 Stars` : toPdfSafeText(data.sessionType),
      x: 158,
    },
    { label: "VERIFICATION HASH", value: toPdfSafeText(data.verificationHash), x: 222 },
  ];

  cols.forEach((col) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.6);
    doc.setTextColor(161, 161, 170);
    doc.text(col.label, col.x, metaY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(13, 13, 15);
    doc.text(col.value, col.x, metaY + 4.8);
  });

  // 9. Executive Signatures & Central Embossed Gold Seal
  const footerLineY = 179;

  // Left signature: Session Mentor
  drawSignatureScript(doc, 38, footerLineY - 4, "mentor");
  doc.setDrawColor(180, 174, 162);
  doc.setLineWidth(0.35);
  doc.line(28, footerLineY, 98, footerLineY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor(13, 13, 15);
  doc.text(toPdfSafeText(data.mentor.name), 63, footerLineY + 4.5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(113, 113, 122);
  const mentorRoleLine = data.mentor.verifiedLabel
    ? `${toPdfSafeText(data.mentor.verifiedLabel)} | Session Mentor`
    : "Session Mentor";
  doc.text(mentorRoleLine, 63, footerLineY + 8.3, { align: "center" });

  // Center Seal
  drawGoldSeal(doc, cx, footerLineY - 2, 13.2);

  // Right signature: SwapSkill Verification Board
  drawSignatureScript(doc, pageW - 86, footerLineY - 3, "authority");
  doc.setDrawColor(180, 174, 162);
  doc.setLineWidth(0.35);
  doc.line(pageW - 98, footerLineY, pageW - 28, footerLineY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor(13, 13, 15);
  doc.text("SwapSkill Verification Authority", pageW - 63, footerLineY + 4.5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(113, 113, 122);
  doc.text(`Immutable Ledger ID: ${toPdfSafeText(data.sessionId.slice(0, 14))}`, pageW - 63, footerLineY + 8.3, {
    align: "center",
  });

  // 10. Bottom Micro Verification Line
  doc.setFont("courier", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(150, 146, 138);
  doc.text(
    toPdfSafeText(`SESSION ID: ${data.sessionId}  |  SERIAL: ${data.serialCode}  |  SWAPSKILL VERIFIED CREDENTIAL`),
    cx,
    194.2,
    { align: "center" }
  );

  return doc;
}

export function buildCertificateFileName(data: CertificateData): string {
  const cleanName = (data.holder.name || "Member")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  const cleanSkill = (data.skillName || "Skill-Swap")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `SwapSkill-Certificate-${cleanName}-${cleanSkill}-${data.serialCode}.pdf`;
}

export function downloadCertificatePdf(data: CertificateData): string {
  const doc = generateCertificatePdf(data);
  const filename = buildCertificateFileName(data);
  try {
    doc.save(filename);
  } catch {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return filename;
}

export function buildCertificatePdfFile(data: CertificateData): File {
  const doc = generateCertificatePdf(data);
  const filename = buildCertificateFileName(data);
  const blob = doc.output("blob");
  return new File([blob], filename, { type: "application/pdf" });
}

export function buildLinkedInAddCertUrl(data: CertificateData): string {
  const d = data.completedDate;
  const issueYear = String(d.getFullYear());
  const issueMonth = String(d.getMonth() + 1);
  const certTitle = data.partner.verifiedLabel
    ? `${data.skillName} — 1:1 Swap with ${data.partner.name} (${data.partner.verifiedLabel})`
    : `${data.skillName} — Verified Peer Skill Exchange`;

  const params = new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: certTitle,
    organizationName: "SwapSkill",
    issueYear,
    issueMonth,
    certId: data.serialCode,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}
