import { doc, updateDoc, deleteDoc, deleteField, serverTimestamp, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Session } from "../types";

export const RETENTION_DAYS = 30;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000; // 30 days in milliseconds

/**
 * Checks if a session is currently running in an active live swap
 */
export const isSessionActivelyLive = (session: Session): boolean => {
  if (session.sessionEnded === true || session.isEnded === true) return false;
  const status = (session.status || "").toLowerCase();
  if (status === "completed" || status === "cancelled" || status === "deleted") return false;

  // If live participants are currently inside or isLive is flagged
  if (session.isLive || (session.liveParticipants && session.liveParticipants.length > 0)) {
    return true;
  }

  // If scheduled within the last duration window and marked as accepted/upcoming
  if (status === "accepted" || status === "upcoming") {
    const schedMs = session.scheduledTime?.seconds 
      ? session.scheduledTime.seconds * 1000 
      : new Date(session.scheduledTime).getTime();
    
    if (!isNaN(schedMs)) {
      const now = Date.now();
      const durationMs = (session.duration || 60) * 60 * 1000;
      // If within live window (started within duration and not ended)
      if (now >= schedMs && now <= schedMs + durationMs && session.hasStartedLive) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Parses any Firestore timestamp, Date, or string safely into milliseconds
 */
export const getTimestampMs = (val: any): number => {
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (val.seconds !== undefined) return val.seconds * 1000;
  if (val.toDate && typeof val.toDate === "function") return val.toDate().getTime();
  if (val instanceof Date) return val.getTime();
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? 0 : parsed;
};

/**
 * Calculates days remaining for a deleted session before permanent removal (out of 30 days)
 */
export const getDaysRemaining = (deletedAt: any): number => {
  const deletedMs = getTimestampMs(deletedAt);
  if (!deletedMs) return RETENTION_DAYS;

  const now = Date.now();
  const elapsedMs = now - deletedMs;
  const remainingMs = RETENTION_MS - elapsedMs;

  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
};

/**
 * Checks if a deleted session has exceeded the 30-day retention window
 */
export const isDeletedSessionExpired = (deletedAt: any): boolean => {
  const deletedMs = getTimestampMs(deletedAt);
  if (!deletedMs) return false;
  return Date.now() - deletedMs >= RETENTION_MS;
};

/**
 * Soft deletes a session (moves to Recently Deleted)
 */
export const softDeleteSession = async (
  session: Session,
  currentUserId: string
): Promise<void> => {
  if (isSessionActivelyLive(session)) {
    throw new Error("Cannot delete an actively running Live Swap session. Please end the session first.");
  }

  const sessionRef = doc(db, "sessions", session.id);
  const currentStatus = session.status || "completed";

  await updateDoc(sessionRef, {
    status: "deleted",
    previousStatus: currentStatus,
    deletedAt: serverTimestamp(),
    deletedBy: currentUserId,
  });
};

/**
 * Restores a deleted session from Recently Deleted
 * Rules:
 * - If original scheduled time is in the past, restore as "completed" (or "cancelled" if previous was cancelled)
 * - Never restore an expired past session as "upcoming"
 * - If scheduled time is in the future, restore to previous valid status or "upcoming"
 */
export const restoreDeletedSession = async (
  session: Session,
  currentUserId: string
): Promise<{ restoredStatus: string }> => {
  // Check 30-day retention constraint
  if (isDeletedSessionExpired(session.deletedAt)) {
    throw new Error("This session has passed the 30-day retention period and can no longer be restored.");
  }

  const schedMs = getTimestampMs(session.scheduledTime);
  const now = Date.now();
  const isPast = schedMs < now;

  let targetStatus = "completed";
  const prev = (session.previousStatus || "").toLowerCase();

  if (isPast) {
    if (prev === "cancelled" || prev === "rejected") {
      targetStatus = "cancelled";
    } else {
      // Historical session in the past must be completed
      targetStatus = "completed";
    }
  } else {
    // Future session
    if (prev === "requested" || prev === "pending") {
      targetStatus = "requested";
    } else if (prev === "cancelled" || prev === "rejected") {
      targetStatus = "cancelled";
    } else {
      targetStatus = "accepted"; // Upcoming
    }
  }

  const sessionRef = doc(db, "sessions", session.id);
  await updateDoc(sessionRef, {
    status: targetStatus,
    deletedAt: deleteField(),
    deletedBy: deleteField(),
    previousStatus: deleteField(),
  });

  return { restoredStatus: targetStatus };
};

/**
 * Permanently deletes a session from Firestore
 */
export const permanentlyDeleteSession = async (
  sessionId: string,
  currentUserId: string
): Promise<void> => {
  const sessionRef = doc(db, "sessions", sessionId);
  await deleteDoc(sessionRef);
};

/**
 * Auto cleanup: Scans deleted sessions and permanently removes any that are >= 30 days old
 */
export const autoCleanupExpiredSessions = async (
  sessions: Session[],
  currentUserId: string
): Promise<string[]> => {
  const cleanedIds: string[] = [];

  const expired = sessions.filter(
    (s) => (s.status === "deleted" || s.deletedAt) && isDeletedSessionExpired(s.deletedAt)
  );

  for (const session of expired) {
    try {
      await permanentlyDeleteSession(session.id, currentUserId);
      cleanedIds.push(session.id);
    } catch (err) {
      console.warn(`Failed to auto-cleanup expired session ${session.id}:`, err);
    }
  }

  return cleanedIds;
};
