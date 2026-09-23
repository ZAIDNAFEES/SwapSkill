import { Session } from "../types";
import { safeLocalStorage } from "../utils/safeStorage";
import {
  ScheduledAlarmNotification,
  crossPlatformNotificationManager,
} from "./notificationAdapter";

export type { ScheduledAlarmNotification };

export interface ActiveAlarmState {
  id: string;
  sessionId: string;
  title: string;
  partnerName: string;
  skillName: string;
  timeString: string;
  duration: number;
  session: Session;
  isLive: boolean;
  minutesRemaining: number;
}

// In-memory active timer handles for client side fallback (10-minute prior and session-start)
const activeAlarmTimers10m: Map<string, NodeJS.Timeout> = new Map();
const activeAlarmTimersStart: Map<string, NodeJS.Timeout> = new Map();

/**
 * Helper to get user's local formatted date & time string in their device timezone
 * e.g. "Today · 6:00 PM · 60 min" or "Tomorrow · 2:30 PM · 45 min"
 */
/**
 * Parse any format of scheduled time across Firestore Timestamp, ISO string, or Date to epoch ms
 */
export function parseSessionTimestampMs(scheduledTime: any): number {
  if (!scheduledTime) return NaN;
  if (typeof scheduledTime === "number") return scheduledTime;
  if (scheduledTime instanceof Date) return scheduledTime.getTime();
  if (typeof scheduledTime.toDate === "function") {
    try {
      return scheduledTime.toDate().getTime();
    } catch (_) {}
  }
  if (typeof scheduledTime.seconds === "number") {
    return scheduledTime.seconds * 1000 + Math.floor((scheduledTime.nanoseconds || 0) / 1000000);
  }
  if (typeof scheduledTime._seconds === "number") {
    return scheduledTime._seconds * 1000 + Math.floor((scheduledTime._nanoseconds || 0) / 1000000);
  }
  if (typeof scheduledTime === "string") {
    const parsed = new Date(scheduledTime).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  return NaN;
}

/**
 * Format scheduled time for notification body and modal
 */
export const formatSessionAlarmTime = (
  scheduledTime: any,
  duration: number = 60
): { dayStr: string; timeStr: string; fullStr: string } => {
  const schedMs = parseSessionTimestampMs(scheduledTime);

  if (isNaN(schedMs)) {
    return { dayStr: "Today", timeStr: "Scheduled Time", fullStr: `Today · ${duration} min` };
  }

  const schedDate = new Date(schedMs);
  const now = new Date();

  const isToday = schedDate.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = schedDate.toDateString() === tomorrow.toDateString();

  let dayStr = "";
  if (isToday) {
    dayStr = "Today";
  } else if (isTomorrow) {
    dayStr = "Tomorrow";
  } else {
    dayStr = schedDate.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  const timeStr = schedDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const fullStr = `${dayStr} · ${timeStr} · ${duration} min`;

  return { dayStr, timeStr, fullStr };
};

/**
 * Generates an authoritative session content hash to detect changes in scheduledTime or status.
 */
export const getSessionAlarmHash = (session: Session): string => {
  const schedMs = parseSessionTimestampMs(session.scheduledTime);
  return `${session.id}_${schedMs}_${session.duration || 60}`;
};

/**
 * Register Service Worker for background notifications and alarm actions
 */
export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return reg;
  } catch (err) {
    console.warn("[Local Alarm] Service worker registration failed:", err);
    return null;
  }
};

/**
 * Safely request notification permission across Web and Native Mobile
 */
export const requestAlarmNotificationPermission = async (): Promise<boolean> => {
  return crossPlatformNotificationManager.requestPermission();
};

/**
 * Synchronize and schedule local alarm notifications for all confirmed/upcoming sessions.
 * 
 * Shared Core Logic for Web and Native Mobile:
 * 1. Filters for confirmed upcoming sessions where the current user is teacher or learner
 * 2. Computes the exact 10-minute prior trigger timestamp
 * 3. Handles immediate fallback for sessions already <= 10m or Live
 * 4. Cancels outdated alarms on deletion, cancellation, or reschedule
 * 5. Uses session hash deduplication
 * 6. Dispatches to CrossPlatformNotificationManager for native mobile and browser push
 * 7. Triggers interactive In-App Alarm Modal
 */
export const syncAndScheduleSessionAlarms = (
  sessions: Session[],
  currentUserId: string,
  onTriggerAlarmModal: (alarm: ActiveAlarmState) => void
) => {
  if (!sessions || !currentUserId || typeof window === "undefined") return;

  const now = Date.now();
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  // Track valid active session IDs to clear stale alarms
  const activeSessionIds = new Set<string>();

  sessions.forEach((session) => {
    const status = (session.status || "").toLowerCase();
    const isTeacher = session.teacherId === currentUserId;
    const isLearner = (session.learnerId || session.studentId) === currentUserId;
    const isParticipant = isTeacher || isLearner;

    // Check if session is actively upcoming
    const isTerminated =
      session.sessionEnded ||
      session.isEnded ||
      session.meetingEnded ||
      status === "completed" ||
      status === "cancelled" ||
      status === "deleted" ||
      Boolean(session.deletedAt);

    const isUpcoming =
      isParticipant &&
      !isTerminated &&
      (status === "accepted" || status === "upcoming" || status === "confirmed");

    if (!isUpcoming) {
      // If session cancelled/deleted/completed, cancel any scheduled alarm across platforms
      cancelScheduledAlarm(session.id);
      return;
    }

    activeSessionIds.add(session.id);

    const schedMs = session.scheduledTime?.seconds
      ? session.scheduledTime.seconds * 1000
      : session.scheduledTime?.toDate
      ? session.scheduledTime.toDate().getTime()
      : new Date(session.scheduledTime).getTime();

    if (isNaN(schedMs)) return;

    const duration = session.duration || 60;
    const durationMs = duration * 60 * 1000;
    const partnerName = isTeacher
      ? session.learnerName || session.studentName || "Swap Partner"
      : session.teacherName || "Swap Partner";
    const skillName = session.skillName || session.skill || "Skill Swap";
    const timeFormatted = formatSessionAlarmTime(session.scheduledTime, duration);

    // If session has already ended past scheduled duration, don't schedule
    if (now > schedMs + durationMs) {
      cancelScheduledAlarm(session.id);
      return;
    }

    // DISCARD EXPIRED ALARMS: If device was offline or user opened app >15 mins past start,
    // do NOT fire a barrage of stale notifications. Discard expired alarms.
    const FIFTEEN_MINS_MS = 15 * 60 * 1000;
    if (now > schedMs + FIFTEEN_MINS_MS) {
      cancelScheduledAlarm(session.id);
      return;
    }

    const currentHash = getSessionAlarmHash(session);
    const storedHash = safeLocalStorage.getItem(`swap_alarm_hash_${session.id}`);

    // If rescheduled (hash changed), cancel old scheduled alarm and clear old fired marks
    if (storedHash && storedHash !== currentHash) {
      cancelScheduledAlarm(session.id);
      safeLocalStorage.removeItem(`swap_alarm_10m_fired_${storedHash}`);
      safeLocalStorage.removeItem(`swap_alarm_start_fired_${storedHash}`);
    }
    safeLocalStorage.setItem(`swap_alarm_hash_${session.id}`, currentHash);

    const alreadyFired10m = safeLocalStorage.getItem(`swap_alarm_10m_fired_${currentHash}`) === "true";
    const alreadyFiredStart = safeLocalStorage.getItem(`swap_alarm_start_fired_${currentHash}`) === "true";

    const idealTriggerTime10m = schedMs - TEN_MINUTES_MS;
    const msUntilStart = schedMs - now;

    // Base alarm payload
    const baseAlarmPayload: ScheduledAlarmNotification = {
      sessionId: session.id,
      sessionHash: currentHash,
      scheduledTimeMs: schedMs,
      triggerTimeMs: idealTriggerTime10m,
      title: "SwapSkill Session Reminder",
      body: `Your ${skillName} Skill Swap with ${partnerName} starts in 10 minutes.\n${timeFormatted.fullStr}`,
      partnerName,
      skillName,
      duration,
      formattedTime: timeFormatted.fullStr,
      isImmediateFallback: false,
    };

    // 1. Cross-platform native scheduling for 10-minute prior alarm
    if (!alreadyFired10m && now < schedMs) {
      crossPlatformNotificationManager.scheduleAlarm(baseAlarmPayload, session);
    }

    // --- 2. PHASE A: 10-Minute Prior Reminder Timer ---
    if (!alreadyFired10m) {
      if (activeAlarmTimers10m.has(session.id)) {
        clearTimeout(activeAlarmTimers10m.get(session.id)!);
        activeAlarmTimers10m.delete(session.id);
      }

      const fire10MinAlarm = () => {
        safeLocalStorage.setItem(`swap_alarm_10m_fired_${currentHash}`, "true");
        const remaining = Math.max(1, Math.ceil((schedMs - Date.now()) / 60000));

        crossPlatformNotificationManager.triggerImmediateNotification(baseAlarmPayload, session, false);

        onTriggerAlarmModal({
          id: `alarm-10m-${session.id}-${Date.now()}`,
          sessionId: session.id,
          title: "SwapSkill Session Reminder",
          partnerName,
          skillName,
          timeString: timeFormatted.fullStr,
          duration,
          session,
          isLive: false,
          minutesRemaining: remaining,
        });
      };

      if (now >= idealTriggerTime10m && msUntilStart > 0) {
        // Less than 10 mins away, fire immediately
        setTimeout(fire10MinAlarm, 600);
      } else if (now < idealTriggerTime10m) {
        // More than 10 mins away, schedule timer
        const timer10m = setTimeout(fire10MinAlarm, idealTriggerTime10m - now);
        activeAlarmTimers10m.set(session.id, timer10m);
      }
    }

    // --- 3. PHASE B: Session Starting Reminder Timer (0 minutes / Live now) ---
    if (!alreadyFiredStart) {
      if (activeAlarmTimersStart.has(session.id)) {
        clearTimeout(activeAlarmTimersStart.get(session.id)!);
        activeAlarmTimersStart.delete(session.id);
      }

      const fireStartAlarm = () => {
        safeLocalStorage.setItem(`swap_alarm_start_fired_${currentHash}`, "true");

        crossPlatformNotificationManager.triggerImmediateNotification(
          { ...baseAlarmPayload, title: "🔔 Live Session Starting Now!" },
          session,
          true
        );

        onTriggerAlarmModal({
          id: `alarm-start-${session.id}-${Date.now()}`,
          sessionId: session.id,
          title: "SwapSkill Session Live Now",
          partnerName,
          skillName,
          timeString: timeFormatted.fullStr,
          duration,
          session,
          isLive: true,
          minutesRemaining: 0,
        });
      };

      if (msUntilStart <= 0 || session.isLive === true) {
        // Starting or already live now
        setTimeout(fireStartAlarm, 800);
      } else {
        // Schedule timer to fire right when session scheduled start time is reached
        const timerStart = setTimeout(fireStartAlarm, msUntilStart);
        activeAlarmTimersStart.set(session.id, timerStart);
      }
    }
  });

  // Clean up any timers for sessions that were removed
  activeAlarmTimers10m.forEach((timer, sessionId) => {
    if (!activeSessionIds.has(sessionId)) {
      clearTimeout(timer);
      activeAlarmTimers10m.delete(sessionId);
    }
  });

  activeAlarmTimersStart.forEach((timer, sessionId) => {
    if (!activeSessionIds.has(sessionId)) {
      clearTimeout(timer);
      activeAlarmTimersStart.delete(sessionId);
    }
  });
};

/**
 * Cancels any scheduled alarms for a specific session ID across all platforms
 */
export const cancelScheduledAlarm = (sessionId: string) => {
  if (activeAlarmTimers10m.has(sessionId)) {
    clearTimeout(activeAlarmTimers10m.get(sessionId)!);
    activeAlarmTimers10m.delete(sessionId);
  }

  if (activeAlarmTimersStart.has(sessionId)) {
    clearTimeout(activeAlarmTimersStart.get(sessionId)!);
    activeAlarmTimersStart.delete(sessionId);
  }

  // Cancel across native mobile and web adapters
  crossPlatformNotificationManager.cancelAlarm(sessionId);
};

/**
 * Formats a clean countdown string: "Starts in 2h 15m", "Starts in 45m", "Starts in 1d 4h", etc.
 */
export const formatSessionCountdown = (scheduledTime: any, now: Date = new Date()): string => {
  if (!scheduledTime) return "Starts soon";
  const schedMs = scheduledTime?.seconds
    ? scheduledTime.seconds * 1000
    : scheduledTime?.toDate
    ? scheduledTime.toDate().getTime()
    : new Date(scheduledTime).getTime();

  if (isNaN(schedMs)) return "Starts soon";

  const diffMs = schedMs - now.getTime();
  if (diffMs <= 0) return "Live Now";

  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / (24 * 60));
  const hours = Math.floor((totalMins % (24 * 60)) / 60);
  const mins = totalMins % 60;

  if (days > 0) {
    return `Starts in ${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `Starts in ${hours}h ${mins > 0 ? `${mins}m` : ""}`.trim();
  }
  if (mins > 0) {
    return `Starts in ${mins}m`;
  }
  return "Starts in < 1m";
};
