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

// In-memory active timer handles for client side fallback
const activeAlarmTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * Helper to get user's local formatted date & time string in their device timezone
 * e.g. "Today · 6:00 PM · 60 min" or "Tomorrow · 2:30 PM · 45 min"
 */
export const formatSessionAlarmTime = (
  scheduledTime: any,
  duration: number = 60
): { dayStr: string; timeStr: string; fullStr: string } => {
  const schedMs = scheduledTime?.seconds
    ? scheduledTime.seconds * 1000
    : scheduledTime?.toDate
    ? scheduledTime.toDate().getTime()
    : new Date(scheduledTime).getTime();

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
  const schedMs = session.scheduledTime?.seconds
    ? session.scheduledTime.seconds * 1000
    : session.scheduledTime?.toDate
    ? session.scheduledTime.toDate().getTime()
    : new Date(session.scheduledTime).getTime();
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

    const currentHash = getSessionAlarmHash(session);
    const storedHash = safeLocalStorage.getItem(`swap_alarm_hash_${session.id}`);
    const alreadyFired = safeLocalStorage.getItem(`swap_alarm_fired_${currentHash}`);

    // If rescheduled (hash changed), cancel old scheduled alarm and clear old fired mark
    if (storedHash && storedHash !== currentHash) {
      cancelScheduledAlarm(session.id);
      safeLocalStorage.removeItem(`swap_alarm_fired_${storedHash}`);
    }
    safeLocalStorage.setItem(`swap_alarm_hash_${session.id}`, currentHash);

    if (alreadyFired === "true") {
      return; // Already triggered for this exact session schedule
    }

    // Calculate Trigger Time: Exactly 10 minutes before start time
    const idealTriggerTimeMs = schedMs - TEN_MINUTES_MS;
    const msUntilStart = schedMs - now;

    let triggerDelayMs = 0;
    let isImmediateFallback = false;

    if (msUntilStart <= 0) {
      // Session is LIVE now!
      triggerDelayMs = 0;
      isImmediateFallback = true;
    } else if (now >= idealTriggerTimeMs) {
      // Session is less than 10 minutes away
      triggerDelayMs = 0;
      isImmediateFallback = true;
    } else {
      // Session is > 10 minutes away, fire in (idealTriggerTimeMs - now)
      triggerDelayMs = idealTriggerTimeMs - now;
      isImmediateFallback = false;
    }

    const alarmPayload: ScheduledAlarmNotification = {
      sessionId: session.id,
      sessionHash: currentHash,
      scheduledTimeMs: schedMs,
      triggerTimeMs: idealTriggerTimeMs,
      title: "SwapSkill Session Reminder",
      body: `Your ${skillName} Skill Swap with ${partnerName} starts in ${
        isImmediateFallback ? "< 10" : "10"
      } minutes.\n${timeFormatted.fullStr}`,
      partnerName,
      skillName,
      duration,
      formattedTime: timeFormatted.fullStr,
      isImmediateFallback,
    };

    // 1. Cross-platform schedule (Capacitor / Android Bridge / iOS Bridge)
    crossPlatformNotificationManager.scheduleAlarm(alarmPayload, session);

    // 2. Schedule in-memory client timer
    if (activeAlarmTimers.has(session.id)) {
      clearTimeout(activeAlarmTimers.get(session.id)!);
      activeAlarmTimers.delete(session.id);
    }

    const fireAlarm = () => {
      // Mark as fired for this hash
      safeLocalStorage.setItem(`swap_alarm_fired_${currentHash}`, "true");

      const isLiveNow = schedMs - Date.now() <= 0 || session.isLive === true;
      const minsRemaining = Math.max(0, Math.ceil((schedMs - Date.now()) / 60000));

      // Trigger cross-platform notification (ServiceWorker / Browser / Native Notification)
      crossPlatformNotificationManager.triggerImmediateNotification(alarmPayload, session, isLiveNow);

      // Open interactive in-app alarm modal
      onTriggerAlarmModal({
        id: `alarm-${session.id}-${Date.now()}`,
        sessionId: session.id,
        title: "SwapSkill Session Reminder",
        partnerName,
        skillName,
        timeString: timeFormatted.fullStr,
        duration,
        session,
        isLive: isLiveNow,
        minutesRemaining: isLiveNow ? 0 : isImmediateFallback ? Math.max(1, minsRemaining) : 10,
      });
    };

    if (triggerDelayMs <= 0) {
      setTimeout(fireAlarm, 500);
    } else {
      const timer = setTimeout(fireAlarm, triggerDelayMs);
      activeAlarmTimers.set(session.id, timer);
    }
  });

  // Clean up any timers for sessions that were removed
  activeAlarmTimers.forEach((timer, sessionId) => {
    if (!activeSessionIds.has(sessionId)) {
      clearTimeout(timer);
      activeAlarmTimers.delete(sessionId);
    }
  });
};

/**
 * Cancels any scheduled alarms for a specific session ID across all platforms
 */
export const cancelScheduledAlarm = (sessionId: string) => {
  if (activeAlarmTimers.has(sessionId)) {
    clearTimeout(activeAlarmTimers.get(sessionId)!);
    activeAlarmTimers.delete(sessionId);
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
