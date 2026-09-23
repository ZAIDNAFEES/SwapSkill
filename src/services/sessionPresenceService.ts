import { 
  doc, 
  runTransaction, 
  getDoc, 
  updateDoc, 
  serverTimestamp,
  increment
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { getApiUrl } from "../utils/apiConfig";

export interface SessionLeaveResult {
  remainingCount: number;
  sessionEnded: boolean;
}

/**
 * Atomically marks a user as active in the live session participants list.
 * Never throws fatal session-ended errors that interrupt WebRTC calling.
 */
export async function joinLiveSession(sessionId: string, userId: string): Promise<void> {
  if (!sessionId || !userId) return;

  const sessionRef = doc(db, "sessions", sessionId);

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(sessionRef);
      if (!snap.exists()) return;

      const data = snap.data();
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
    console.log(`[SessionPresence] User "${userId}" presence registered in live session "${sessionId}"`);
  } catch (err) {
    console.warn(`[SessionPresence] Non-blocking join notice for session "${sessionId}":`, err);
  }
}

/**
 * Atomically updates user leave from live session participants list.
 * Does NOT prematurely mutate the Swap Session status to "completed" or set sessionEnded: true.
 */
export async function leaveLiveSession(
  sessionId: string, 
  userId: string, 
  _forceEnd: boolean = false
): Promise<SessionLeaveResult> {
  if (!sessionId || !userId) {
    return { remainingCount: 0, sessionEnded: false };
  }

  const sessionRef = doc(db, "sessions", sessionId);
  let result: SessionLeaveResult = { remainingCount: 0, sessionEnded: false };

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(sessionRef);
      if (!snap.exists()) {
        result = { remainingCount: 0, sessionEnded: false };
        return;
      }

      const data = snap.data();
      const existingParticipants: string[] = Array.isArray(data.liveParticipants) ? data.liveParticipants : [];
      const updatedParticipants = existingParticipants.filter((id) => id !== userId);
      const remainingCount = updatedParticipants.length;

      transaction.update(sessionRef, {
        liveParticipants: updatedParticipants,
        isLive: remainingCount > 0,
        lastLeaveTime: serverTimestamp()
      });
      result = { remainingCount, sessionEnded: false };
    });

    console.log(`[SessionPresence] User "${userId}" left live session "${sessionId}". Remaining: ${result.remainingCount}`);
    return result;
  } catch (err) {
    console.warn(`[SessionPresence] Error handling leave for "${sessionId}":`, err);
    return { remainingCount: 0, sessionEnded: false };
  }
}

/**
 * Fires a guaranteed background beacon/keepalive to /api/session/leave for tab closes & unloads.
 */
export function recordSessionLeaveBeacon(sessionId: string, userId: string, forceEnd: boolean = false): void {
  if (!sessionId || !userId) return;

  const currentToken = (auth.currentUser as any)?.accessToken || "";
  const send = (idToken: string) => {
    const payload = JSON.stringify({ sessionId, userId, forceEnd, idToken });

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
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch (_) {}
  };

  if (auth.currentUser) {
    auth.currentUser.getIdToken().then(send).catch(() => send(currentToken));
  } else {
    send(currentToken);
  }
}
