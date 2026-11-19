export const VERIFICATION_ADMIN_EMAIL = "zaidnafees8321@gmail.com";

export function isVerificationAdminEmail(email?: string | null): boolean {
  if (!email || typeof email !== "string") return false;
  return email.trim().toLowerCase() === VERIFICATION_ADMIN_EMAIL;
}

export type VerificationCategory = "notable" | "skilled" | "educator";
export type VerificationTier = "notable" | "mentor" | "creator" | "verified";
export type VerificationStatus = "pending" | "approved" | "rejected" | "revoked";

export interface VerificationEncryptedEnvelope {
  v: 1;
  alg: "RSA-OAEP-SHA256+AES-256-GCM";
  encryptedKey: string;
  iv: string;
  ciphertext: string;
  sha256: string;
}

export interface VerificationSensitiveDossier {
  uid: string;
  email: string;
  fullName: string;
  username: string;
  legalOrKnownName: string;
  contactHandleOrPhone: string;
  category: VerificationCategory;
  domain: string;
  portfolioUrl: string;
  socialLinks: {
    instagram?: string;
    youtube?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
  credentialReference: string;
  statement: string;
  profileSnapshot: {
    photoUrl: string;
    city: string;
    country: string;
    bio: string;
    languages: string[];
    skillsToTeach: string[];
    skillsToLearn: string[];
    followersCount: number;
    followingCount: number;
    sessionsCount: number;
    rating: number;
    reviewCount: number;
    points: number;
    accountCreatedAt: string;
  };
  deviceMeta: {
    platform: string;
    language: string;
    timezone: string;
  };
  submittedAtIso: string;
}

export interface VerificationRequestRecord {
  id: string;
  userId: string;
  status: VerificationStatus;
  category: VerificationCategory;
  domain: string;
  applicantName: string;
  applicantUsername: string;
  swapsSnapshot: number;
  ratingSnapshot: number;
  encryptionAlg: string;
  keyVersion: string;
  payloadHash: string;
  encryptedEnvelope: VerificationEncryptedEnvelope;
  submittedAt: any;
  submittedAtMs: number;
  updatedAt: any;
  reviewedAt?: any;
  reviewedBy?: string;
  assignedTier?: VerificationTier;
  badgeLabel?: string;
  rejectionReason?: string;
}
