import { 
  doc, 
  runTransaction, 
  getDoc, 
  updateDoc, 
  serverTimestamp,
  increment
} from "firebase/firestore";
import { db } from "../firebase";
import { getApiUrl } from "../utils/apiConfig";

export interface SessionLeaveResult {
  remainingCount: number;
  sessionEnded: boolean;
}

/**
 * Atomically marks a user as joined in the live session participants list.
 */
export async function joinLiveSession(sessionId: string, userId: string): Promise<void> {
  if (!sessionId || !userId) return;

  const sessionRef = doc(db, "sessions", sessionId);

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(sessionRef);
      if (!snap.exists()) return;

      const data = snap.data();
      const status = (data.status || "").toLowerCase();
      
      // Do not join if session is already completed or cancelled
      if (status === "completed" || data.sessionEnded === true || data.isEnded === true || data.meetingEnded === true) {
        throw new Error("This Swap Session has already ended and cannot be rejoined.");
      }

      const existingParticipants: string[] = Array.isArray(data.liveParticipants) ? data.liveParticipants : [];
      const updatedParticipants = existingParticipants.includes(userId) 
        ? existingParticipants 
        : [...existingParticipants, userId];

      transaction.update(sessionRef, {
        liveParticipants: updatedParticipants,
        hasStartedLive: true,
        isLive: true,
        lastLiveActivity: serverTimestamp(),
        actualStartTime: data.actualStartTime || serverTimestamp()
      });
    });
    console.log(`[SessionPresence] User "${userId}" registered in live session "${sessionId}"`);
  } catch (err) {
    console.error(`[SessionPresence] Failed to register user join for "${sessionId}":`, err);
    throw err;
  }
}

/**
 * Atomically removes a user from live session participants list.
 * If 0 participants remain (meaning BOTH participants have left), transitions session to "completed" exactly once.
 * If another participant is still inside, does NOT end the session.
 */
export async function leaveLiveSession(
  sessionId: string, 
  userId: string, 
  forceEnd: boolean = false
): Promise<SessionLeaveResult> {
  if (!sessionId || !userId) {
    return { remainingCount: 0, sessionEnded: true };
  }

  const sessionRef = doc(db, "sessions", sessionId);
  let result: SessionLeaveResult = { remainingCount: 0, sessionEnded: false };

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(sessionRef);
      if (!snap.exists()) {
        result = { remainingCount: 0, sessionEnded: true };
        return;
      }

      const data = snap.data();
      const status = (data.status || "").toLowerCase();

      // If already completed or cancelled, state is already final
      if (status === "completed" || data.sessionEnded === true || data.isEnded === true || data.meetingEnded === true) {
        result = { remainingCount: 0, sessionEnded: true };
        return;
      }

      const existingParticipants: string[] = Array.isArray(data.liveParticipants) ? data.liveParticipants : [];
      const updatedParticipants = existingParticipants.filter((id) => id !== userId);
      const remainingCount = updatedParticipants.length;

      if (remainingCount > 0 && !forceEnd) {
        // Partner is still in the room -> KEEP SESSION ACTIVE
        transaction.update(sessionRef, {
          liveParticipants: updatedParticipants,
          lastLeaveTime: serverTimestamp()
        });
        result = { remainingCount, sessionEnded: false };
      } else {
        // BOTH participants have left (or force end requested) -> MARK ENDED/COMPLETED
        transaction.update(sessionRef, {
          liveParticipants: [],
          status: "completed",
          sessionEnded: true,
          isEnded: true,
          meetingEnded: true,
          isLive: false,
          actualEndTime: serverTimestamp(),
          completedAt: serverTimestamp()
        });
        result = { remainingCount: 0, sessionEnded: true };
      }
    });

    // If session just ended, award teacher completion stats
    if (result.sessionEnded) {
      try {
        const snap = await getDoc(sessionRef);
        if (snap.exists()) {
          const sData = snap.data();
          if (sData.teacherId) {
            const teacherRef = doc(db, "users", sData.teacherId);
            await updateDoc(teacherRef, {
              sessionsCount: increment(1),
              swapsCompleted: increment(1),
              points: increment(50)
            }).catch(() => {});
          }
        }
      } catch (statErr) {
        console.warn("[SessionPresence] Non-fatal teacher stats update notice:", statErr);
      }
    }

    console.log(`[SessionPresence] User "${userId}" left session "${sessionId}". Remaining: ${result.remainingCount}, Ended: ${result.sessionEnded}`);
    return result;
  } catch (err) {
    console.error(`[SessionPresence] Error handling leave for "${sessionId}":`, err);
    // Fallback: direct updateDoc + send keepalive beacon
    try {
      if (forceEnd) {
        await updateDoc(sessionRef, {
          liveParticipants: [],
          status: "completed",
          sessionEnded: true,
          isEnded: true,
          meetingEnded: true,
          isLive: false,
          actualEndTime: serverTimestamp(),
          completedAt: serverTimestamp()
        });
      }
    } catch (_) {}
    recordSessionLeaveBeacon(sessionId, userId, forceEnd);
    return { remainingCount: 0, sessionEnded: true };
  }
}

/**
 * Fires a guaranteed background beacon/keepalive to /api/session/leave for tab closes & unloads.
 */
export function recordSessionLeaveBeacon(sessionId: string, userId: string, forceEnd: boolean = false): void {
  if (!sessionId || !userId) return;

  const payload = JSON.stringify({ sessionId, userId, forceEnd });

  try {
    const leaveApiUrl = getApiUrl("/api/session/leave");
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      const sent = navigator.sendBeacon(leaveApiUrl, blob);
      if (sent) return;
    }
  } catch (_) {}

  try {
    const leaveApiUrl = getApiUrl("/api/session/leave");
    fetch(leaveApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    }).catch(() => {});
  } catch (_) {}
}
