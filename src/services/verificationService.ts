import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  increment,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { DEFAULT_AVATAR, getUserProfilePhoto, UserProfile } from "../types";
import { getApiUrl } from "../utils/apiConfig";
import {
  isVerificationAdminEmail,
  VERIFICATION_ADMIN_EMAIL,
  VerificationCategory,
  VerificationRequestRecord,
  VerificationSensitiveDossier,
  VerificationStatus,
  VerificationTier,
} from "../utils/verificationAdmin";
import { encryptVerificationDossier } from "../utils/verificationCrypto";

enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function isPermissionError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  return code === "permission-denied" || msg.includes("insufficient permissions") || msg.includes("permission-denied");
}

// Session-level memory cache to minimize Firestore reads (0 repeated reads)
const myRequestCache = new Map<string, VerificationRequestRecord | null>();
const adminQueueCache = new Map<VerificationStatus, AdminDecryptedVerificationItem[]>();

export interface SubmitVerificationInput {
  profile: UserProfile;
  category: VerificationCategory;
  legalOrKnownName: string;
  contactHandleOrPhone: string;
  domain: string;
  portfolioUrl: string;
  instagram?: string;
  youtube?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  credentialReference: string;
  statement: string;
}

export interface AdminDecryptedVerificationItem {
  request: VerificationRequestRecord;
  dossier: VerificationSensitiveDossier | null;
  integrityVerified: boolean;
  decryptionError?: string;
}

export async function getMyVerificationRequest(
  uid: string,
  forceRefresh = false
): Promise<VerificationRequestRecord | null> {
  if (!uid) return null;
  if (!forceRefresh && myRequestCache.has(uid)) {
    return myRequestCache.get(uid) || null;
  }

  const path = `verificationRequests/${uid}`;
  try {
    const snap = await getDoc(doc(db, "verificationRequests", uid));
    if (!snap.exists()) {
      myRequestCache.set(uid, null);
      return null;
    }
    const record = { id: snap.id, ...(snap.data() as any) } as VerificationRequestRecord;
    myRequestCache.set(uid, record);
    return record;
  } catch (err) {
    if (isPermissionError(err)) {
      handleFirestoreError(err, OperationType.GET, path);
    }
    throw err;
  }
}

export async function submitVerificationApplication(
  input: SubmitVerificationInput
): Promise<VerificationRequestRecord> {
  const user = auth.currentUser;
  if (!user || user.uid !== input.profile.uid) {
    throw new Error("Please sign in again to submit a verification request.");
  }

  if (!user.emailVerified) {
    throw new Error("Please verify your email address first before applying for verification.");
  }

  const uid = user.uid;
  const nowMs = Date.now();
  const createdAtRaw = input.profile.createdAt;
  let accountCreatedAt = "";
  try {
    if (createdAtRaw?.toDate) {
      accountCreatedAt = createdAtRaw.toDate().toISOString();
    } else if (createdAtRaw instanceof Date) {
      accountCreatedAt = createdAtRaw.toISOString();
    } else if (typeof createdAtRaw === "string" || typeof createdAtRaw === "number") {
      accountCreatedAt = new Date(createdAtRaw).toISOString();
    }
  } catch (_) {}

  const dossier: VerificationSensitiveDossier = {
    uid,
    email: (user.email || input.profile.email || "").trim().slice(0, 160),
    fullName: (input.profile.fullName || "").trim().slice(0, 100),
    username: (input.profile.username || "").trim().slice(0, 50),
    legalOrKnownName: input.legalOrKnownName.trim().slice(0, 120),
    contactHandleOrPhone: input.contactHandleOrPhone.trim().slice(0, 120),
    category: input.category,
    domain: input.domain.trim().slice(0, 100),
    portfolioUrl: input.portfolioUrl.trim().slice(0, 300),
    socialLinks: {
      instagram: (input.instagram || input.profile.instagram || "").trim().slice(0, 200) || undefined,
      youtube: (input.youtube || "").trim().slice(0, 200) || undefined,
      linkedin: (input.linkedin || input.profile.linkedin || "").trim().slice(0, 200) || undefined,
      github: (input.github || input.profile.github || "").trim().slice(0, 200) || undefined,
      website: (input.website || input.profile.website || input.profile.portfolio || "").trim().slice(0, 200) || undefined,
    },
    credentialReference: input.credentialReference.trim().slice(0, 300),
    statement: input.statement.trim().slice(0, 1200),
    profileSnapshot: {
      photoUrl: getUserProfilePhoto(input.profile),
      city: (input.profile.city || "").slice(0, 80),
      country: (input.profile.country || "").slice(0, 80),
      bio: (input.profile.bio || "").slice(0, 500),
      languages: Array.isArray(input.profile.languages) ? input.profile.languages.slice(0, 12) : [],
      skillsToTeach: Array.isArray(input.profile.skillsToTeach) ? input.profile.skillsToTeach.slice(0, 20) : [],
      skillsToLearn: Array.isArray(input.profile.skillsToLearn) ? input.profile.skillsToLearn.slice(0, 20) : [],
      followersCount: Number(input.profile.followersCount || 0),
      followingCount: Number(input.profile.followingCount || 0),
      sessionsCount: Number((input.profile as any).swapsCompleted ?? input.profile.sessionsCount ?? 0),
      rating: Number(input.profile.rating || 0),
      reviewCount: Number(input.profile.reviewCount || 0),
      points: Number(input.profile.points || 0),
      accountCreatedAt,
    },
    deviceMeta: {
      platform: typeof navigator !== "undefined" ? (navigator.platform || "web").slice(0, 60) : "web",
      language: typeof navigator !== "undefined" ? (navigator.language || "en").slice(0, 32) : "en",
      timezone:
        typeof Intl !== "undefined"
          ? (Intl.DateTimeFormat().resolvedOptions().timeZone || "").slice(0, 64)
          : "",
    },
    submittedAtIso: new Date(nowMs).toISOString(),
  };

  // End-to-end encrypt dossier (RSA-OAEP-2048 + AES-256-GCM + SHA-256 integrity hash)
  const encryptedEnvelope = await encryptVerificationDossier(dossier);

  const docPayload: Record<string, any> = {
    userId: uid,
    status: "pending",
    category: input.category,
    domain: input.domain.trim().slice(0, 100),
    applicantName: (input.profile.fullName || input.legalOrKnownName || "Member").trim().slice(0, 100),
    applicantUsername: (input.profile.username || "").trim().slice(0, 40),
    swapsSnapshot: Number((input.profile as any).swapsCompleted ?? input.profile.sessionsCount ?? 0),
    ratingSnapshot: Number(input.profile.rating || 0),
    encryptionAlg: encryptedEnvelope.alg,
    keyVersion: "v1",
    payloadHash: encryptedEnvelope.sha256,
    encryptedEnvelope,
    submittedAt: serverTimestamp(),
    submittedAtMs: nowMs,
    updatedAt: serverTimestamp(),
    rejectionReason: "",
  };

  const path = `verificationRequests/${uid}`;
  try {
    await setDoc(doc(db, "verificationRequests", uid), docPayload, { merge: true });
  } catch (err) {
    if (isPermissionError(err)) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
    throw err;
  }

  const savedRecord: VerificationRequestRecord = {
    id: uid,
    ...(docPayload as any),
    submittedAt: new Date(nowMs),
    updatedAt: new Date(nowMs),
  };
  myRequestCache.set(uid, savedRecord);

  // Fire-and-forget admin notification alert (0 client Firestore reads)
  try {
    const idToken = await user.getIdToken();
    fetch(getApiUrl("/api/verification/notify-admin"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        applicantName: dossier.fullName || dossier.legalOrKnownName,
        category: input.category,
      }),
    }).catch(() => {});
  } catch (_) {}

  return savedRecord;
}

export async function fetchAdminVerificationQueue(
  statusFilter: VerificationStatus,
  forceRefresh = false
): Promise<AdminDecryptedVerificationItem[]> {
  const user = auth.currentUser;
  if (!user || !isVerificationAdminEmail(user.email)) {
    throw new Error("Admin privileges required.");
  }

  if (!forceRefresh && adminQueueCache.has(statusFilter)) {
    return adminQueueCache.get(statusFilter)!;
  }

  const colRef = collection(db, "verificationRequests");
  let docsSnap;
  try {
    const q = query(
      colRef,
      where("status", "==", statusFilter),
      orderBy("submittedAtMs", "desc"),
      limit(25)
    );
    docsSnap = await getDocs(q);
  } catch (err: any) {
    // Fallback without composite index if still building, still capped at 25 docs
    const code = String(err?.code || "").toLowerCase();
    if (code === "failed-precondition" || String(err?.message || "").toLowerCase().includes("index")) {
      const qFallback = query(colRef, where("status", "==", statusFilter), limit(25));
      docsSnap = await getDocs(qFallback);
    } else if (isPermissionError(err)) {
      handleFirestoreError(err, OperationType.LIST, "verificationRequests");
    } else {
      throw err;
    }
  }

  const records: VerificationRequestRecord[] = docsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) } as VerificationRequestRecord))
    .sort((a, b) => Number(b.submittedAtMs || 0) - Number(a.submittedAtMs || 0));

  if (records.length === 0) {
    adminQueueCache.set(statusFilter, []);
    return [];
  }

  // Decrypt batch via authenticated Admin-only endpoint
  const decryptedMap = new Map<
    string,
    { dossier: VerificationSensitiveDossier | null; integrityVerified: boolean; error?: string }
  >();

  try {
    const idToken = await user.getIdToken();
    const res = await fetch(getApiUrl("/api/admin/verification/decrypt"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        items: records.map((r) => ({
          id: r.id,
          encryptedEnvelope: r.encryptedEnvelope,
        })),
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody?.error || `Decryption HTTP ${res.status}`);
    }

    const payload = await res.json();
    const results: any[] = Array.isArray(payload?.results) ? payload.results : [];
    results.forEach((item) => {
      decryptedMap.set(String(item.id), {
        dossier: item.ok ? item.dossier : null,
        integrityVerified: Boolean(item.integrityVerified),
        error: item.ok ? undefined : item.error || "Unable to decrypt envelope",
      });
    });
  } catch (decryptErr: any) {
    records.forEach((r) => {
      decryptedMap.set(r.id, {
        dossier: null,
        integrityVerified: false,
        error: decryptErr?.message || "Decryption service unavailable",
      });
    });
  }

  const merged: AdminDecryptedVerificationItem[] = records.map((reqDoc) => {
    const dec = decryptedMap.get(reqDoc.id);
    return {
      request: reqDoc,
      dossier: dec?.dossier || null,
      integrityVerified: Boolean(dec?.integrityVerified),
      decryptionError: dec?.error,
    };
  });

  adminQueueCache.set(statusFilter, merged);
  return merged;
}

export function clearAdminQueueCache() {
  adminQueueCache.clear();
}

export interface ReviewDecisionInput {
  targetUserId: string;
  decision: "approved" | "rejected" | "revoked";
  tier?: VerificationTier;
  badgeLabel?: string;
  rejectionReason?: string;
}

export async function reviewVerificationApplication(
  input: ReviewDecisionInput
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !isVerificationAdminEmail(user.email)) {
    throw new Error("Only the verified platform administrator can approve or revoke badges.");
  }

  const batch = writeBatch(db);
  const userRef = doc(db, "users", input.targetUserId);
  const reqRef = doc(db, "verificationRequests", input.targetUserId);
  const notifRef = doc(collection(db, "users", input.targetUserId, "notifications"));

  const isApprove = input.decision === "approved";
  const tier: VerificationTier = input.tier || "verified";
  const badgeLabel =
    input.badgeLabel?.trim() ||
    (tier === "notable"
      ? "Notable Figure"
      : tier === "mentor"
      ? "Verified Mentor"
      : tier === "creator"
      ? "Verified Creator"
      : "Verified");

  if (isApprove) {
    batch.update(userRef, {
      verified: true,
      verificationStatus: "approved",
      verificationTier: tier,
      verificationBadgeLabel: badgeLabel,
      verifiedAt: serverTimestamp(),
      verifiedBy: VERIFICATION_ADMIN_EMAIL,
      points: increment(100),
    });

    batch.update(reqRef, {
      status: "approved",
      assignedTier: tier,
      badgeLabel,
      rejectionReason: "",
      reviewedAt: serverTimestamp(),
      reviewedBy: VERIFICATION_ADMIN_EMAIL,
      updatedAt: serverTimestamp(),
    });

    batch.set(notifRef, {
      type: "booking",
      senderId: "system",
      senderName: "SwapSkill Verification",
      senderPhoto: DEFAULT_AVATAR,
      referenceId: input.targetUserId,
      message: `Approved! Your SwapSkill ${badgeLabel} verification badge is now active (+100 bonus points).`,
      read: false,
      createdAt: serverTimestamp(),
    });
  } else {
    const cleanReason = (input.rejectionReason || "").trim().slice(0, 300);
    batch.update(userRef, {
      verified: false,
      verificationStatus: input.decision,
      verificationTier: "verified",
      verificationBadgeLabel: "",
    });

    batch.update(reqRef, {
      status: input.decision,
      rejectionReason: cleanReason,
      reviewedAt: serverTimestamp(),
      reviewedBy: VERIFICATION_ADMIN_EMAIL,
      updatedAt: serverTimestamp(),
    });

    const msg =
      input.decision === "revoked"
        ? `Your SwapSkill verification badge was revoked by the administrator.${cleanReason ? ` Reason: ${cleanReason}` : ""}`
        : `Your verification request was not approved at this time.${cleanReason ? ` Note: ${cleanReason}` : ""}`;

    batch.set(notifRef, {
      type: "booking",
      senderId: "system",
      senderName: "SwapSkill Verification",
      senderPhoto: DEFAULT_AVATAR,
      referenceId: input.targetUserId,
      message: msg,
      read: false,
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    if (isPermissionError(err)) {
      handleFirestoreError(err, OperationType.WRITE, `verificationRequests/${input.targetUserId}`);
    }
    throw err;
  }

  // Invalidate admin caches cleanly
  adminQueueCache.clear();
  myRequestCache.delete(input.targetUserId);

  // Best-effort push notification to applicant
  try {
    const idToken = await user.getIdToken();
    fetch(getApiUrl("/api/send-push"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        recipientId: input.targetUserId,
        type: "notification",
        title: isApprove ? "Verification Approved" : "Verification Update",
        body: isApprove
          ? `Your SwapSkill ${badgeLabel} mark is now active on your profile.`
          : input.decision === "revoked"
          ? "Your verification status has been updated by the admin."
          : "Your verification application has an update in Settings > Get Verified.",
      }),
    }).catch(() => {});
  } catch (_) {}
}
