import React, { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  setDoc,
  getDoc,
  getDocs
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { Session, Review, UserProfile, DEFAULT_AVATAR } from "../types";
import { useApp } from "../context/AppContext";
import { getOrCreateConversation } from "../utils/conversationUtils";
import { safeLocalStorage } from "../utils/safeStorage";
import { 
  Calendar, 
  Video,
  Clock, 
  Check, 
  X, 
  AlertTriangle, 
  Star, 
  Shield, 
  HelpCircle, 
  ArrowRight, 
  AlertCircle,
  XCircle,
  RefreshCw,
  MessageSquare,
  Sparkles,
  ChevronRight,
  Award,
  FileText,
  MessageCircle,
  ExternalLink,
  CheckCircle,
  User,
  Heart,
  ChevronDown,
  Info,
  Loader2,
  Copy,
  Send,
  Trash2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import SkeletonLoader, { LoadingTransition, Skeleton } from "./SkeletonLoader";
import LiveSwapCallModal from "./LiveSwapCallModal";
import {
  getLocalDateString,
  getLocalTimeString,
  parseLocalDateTime,
  isPastTimeSlot,
  isPastDateTime,
  validateSessionDateTime,
  roundToNearest15
} from "../utils/dateTimeValidation";
import {
  isSessionActivelyLive,
  softDeleteSession
} from "../services/sessionTrashService";
import { formatSessionCountdown } from "../services/sessionReminderService";

// Helper to normalize session status strings
export const getNormalizedStatus = (status: string, session?: Partial<Session>): "pending" | "upcoming" | "completed" | "cancelled" | "deleted" => {
  const s = (status || "").toLowerCase();
  if (s === "deleted" || session?.deletedAt) return "deleted";
  if (session?.sessionEnded === true || session?.isEnded === true || session?.meetingEnded === true || s === "completed") return "completed";
  if (s === "cancelled" || s === "rejected") return "cancelled";
  if (s === "requested" || s === "pending") return "pending";
  if (s === "accepted" || s === "upcoming" || s === "confirmed") return "upcoming";
  return "pending";
};

// Helper to format session start time as "Starts at [time]"
const getStartsAtLabel = (scheduledTime: any): string => {
  if (!scheduledTime) return "Starts soon";
  const date = scheduledTime?.seconds ? new Date(scheduledTime.seconds * 1000) : new Date(scheduledTime);
  if (isNaN(date.getTime())) return "Starts soon";
  
  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `Starts at ${timeStr}`;
};

interface SessionsViewProps {
  currentUserId: string;
}

type TabType = "pending" | "upcoming" | "completed" | "cancelled";

export default function SessionsView({ currentUserId }: SessionsViewProps) {
  const { sessions: globalSessions, profilesCache: profiles, currentUserProfile, fetchProfile } = useApp();

  const sessions = React.useMemo(() => {
    return [...globalSessions]
      .filter((s) => s.status !== "deleted" && !s.deletedAt)
      .sort((a, b) => {
        const t1 = a.scheduledTime?.seconds ? a.scheduledTime.seconds * 1000 : new Date(a.scheduledTime).getTime() || 0;
        const t2 = b.scheduledTime?.seconds ? b.scheduledTime.seconds * 1000 : new Date(b.scheduledTime).getTime() || 0;
        return t1 - t2;
      });
  }, [globalSessions]);

  // Soft deletion modal state
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState<boolean>(false);
  const [deleteSessionError, setDeleteSessionError] = useState<string>("");
  const [deleteSessionToast, setDeleteSessionToast] = useState<string>("");

  // Dismissed active session alert IDs (synced to localStorage per user)
  const [dismissedAlerts, setDismissedAlerts] = useState<Record<string, number>>(() => {
    try {
      const raw = safeLocalStorage.getItem(`swap_dismissed_alerts_${currentUserId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const handleDismissAlert = React.useCallback((sessionId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDismissedAlerts((prev) => {
      const next = { ...prev, [sessionId]: Date.now() };
      try {
        safeLocalStorage.setItem(`swap_dismissed_alerts_${currentUserId}`, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  }, [currentUserId]);

  const handleQuickCompleteAlert = async (session: Session, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    handleDismissAlert(session.id);
    await handleUpdateStatus(session.id, "completed");
  };

  const handleRequestDelete = (session: Session, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isSessionActivelyLive(session)) {
      alert("Cannot delete an actively running Live Swap session. Please end the call first.");
      return;
    }
    setSessionToDelete(session);
    setDeleteSessionError("");
  };

  const handleConfirmSoftDelete = async () => {
    if (!sessionToDelete) return;
    try {
      setIsDeletingSession(true);
      setDeleteSessionError("");
      await softDeleteSession(sessionToDelete, currentUserId);
      setDeleteSessionToast("Session moved to Recently Deleted in Settings.");
      setTimeout(() => setDeleteSessionToast(""), 3500);
      setSessionToDelete(null);
      if (selectedWorkspaceSession?.id === sessionToDelete.id) {
        setSelectedWorkspaceSession(null);
      }
    } catch (err: any) {
      console.error("Error deleting session:", err);
      setDeleteSessionError(err.message || "Failed to delete session.");
    } finally {
      setIsDeletingSession(false);
    }
  };

  const loading = false;
  const [activeTab, setActiveTab] = useState<TabType>("pending");
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const filterDropdownRef = React.useRef<HTMLDivElement | null>(null);

  // Unseen notification dot states for Upcoming and Cancelled
  const [hasUnseenUpcoming, setHasUnseenUpcoming] = useState<boolean>(() => {
    try {
      const stored = safeLocalStorage.getItem(`swap_unseen_upcoming_${currentUserId}`);
      return stored === "true";
    } catch {
      return false;
    }
  });

  const [hasUnseenCancelled, setHasUnseenCancelled] = useState<boolean>(() => {
    try {
      const stored = safeLocalStorage.getItem(`swap_unseen_cancelled_${currentUserId}`);
      return stored === "true";
    } catch {
      return false;
    }
  });

  // Calculate dynamic counts for each category
  const upcomingCount = sessions.filter(s => getNormalizedStatus(s.status, s) === "upcoming").length;
  const cancelledCount = sessions.filter(s => getNormalizedStatus(s.status, s) === "cancelled").length;
  const pendingCount = sessions.filter(s => getNormalizedStatus(s.status, s) === "pending").length;
  const completedCount = sessions.filter(s => getNormalizedStatus(s.status, s) === "completed").length;

  // Track new/unseen activity for upcoming and cancelled sections
  useEffect(() => {
    try {
      const lastUpcoming = parseInt(safeLocalStorage.getItem(`swap_seen_upcoming_count_${currentUserId}`) || "0", 10);
      const lastCancelled = parseInt(safeLocalStorage.getItem(`swap_seen_cancelled_count_${currentUserId}`) || "0", 10);

      if (activeTab === "upcoming") {
        setHasUnseenUpcoming(false);
        safeLocalStorage.setItem(`swap_seen_upcoming_count_${currentUserId}`, String(upcomingCount));
        safeLocalStorage.setItem(`swap_unseen_upcoming_${currentUserId}`, "false");
      } else if (upcomingCount > lastUpcoming) {
        setHasUnseenUpcoming(true);
        safeLocalStorage.setItem(`swap_unseen_upcoming_${currentUserId}`, "true");
      }

      if (activeTab === "cancelled") {
        setHasUnseenCancelled(false);
        safeLocalStorage.setItem(`swap_seen_cancelled_count_${currentUserId}`, String(cancelledCount));
        safeLocalStorage.setItem(`swap_unseen_cancelled_${currentUserId}`, "false");
      } else if (cancelledCount > lastCancelled) {
        setHasUnseenCancelled(true);
        safeLocalStorage.setItem(`swap_unseen_cancelled_${currentUserId}`, "true");
      }
    } catch (_) {}
  }, [sessions, activeTab, currentUserId, upcomingCount, cancelledCount]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setIsFilterDropdownOpen(false);
      }
    };
    if (isFilterDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isFilterDropdownOpen]);

  // Handler for selecting tab from dropdown
  const handleSelectTab = (tabId: TabType) => {
    setActiveTab(tabId);
    setIsFilterDropdownOpen(false);
    if (tabId === "upcoming") {
      setHasUnseenUpcoming(false);
      try {
        safeLocalStorage.setItem(`swap_seen_upcoming_count_${currentUserId}`, String(upcomingCount));
        safeLocalStorage.setItem(`swap_unseen_upcoming_${currentUserId}`, "false");
      } catch (_) {}
    }
    if (tabId === "cancelled") {
      setHasUnseenCancelled(false);
      try {
        safeLocalStorage.setItem(`swap_seen_cancelled_count_${currentUserId}`, String(cancelledCount));
        safeLocalStorage.setItem(`swap_unseen_cancelled_${currentUserId}`, "false");
      } catch (_) {}
    }
  };

  const TAB_LABELS: Record<TabType, string> = {
    pending: "Requested",
    upcoming: "Upcoming",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  // High-precision time ticker updating every second for smooth ticking countdowns
  const [currentTime, setCurrentTime] = useState(new Date());

  // Workspace active details drawer
  const [selectedWorkspaceSession, setSelectedWorkspaceSession] = useState<Session | null>(null);

  // Workspace controls & notes
  const [workspaceNotes, setWorkspaceNotes] = useState("");
  const [workspaceActiveTab, setWorkspaceActiveTab] = useState<"notes" | "review" | "chat">("notes");

  // Review & Rating Modal States
  const [activeReviewSession, setActiveReviewSession] = useState<Session | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");

  // Cancellation modal state
  const [cancellingSession, setCancellingSession] = useState<Session | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancellingLoading, setCancellingLoading] = useState(false);

  // Hardware Back button and Escape key close handler for Cancellation bottom sheet
  useEffect(() => {
    if (!cancellingSession) return;
    
    // Add dummy history entry to handle Back button
    window.history.pushState({ sheetOpen: true }, "");
    
    const handlePopState = (e: PopStateEvent) => {
      setCancellingSession(null);
      setCancelReason("");
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCancellingSession(null);
        setCancelReason("");
      }
    };
    
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleKeyDown);
    
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleKeyDown);
      if (window.history.state?.sheetOpen) {
        window.history.back();
      }
    };
  }, [cancellingSession]);

  // Rescheduling modal state
  const [reschedulingSession, setReschedulingSession] = useState<Session | null>(null);
  const [rescheduleDateTime, setRescheduleDateTime] = useState("");
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");
  const [otherUserProfile, setOtherUserProfile] = useState<UserProfile | null>(null);

  // Certificate Modal State
  const [activeCertificate, setActiveCertificate] = useState<Session | null>(null);
  const [showCertSuccessCopy, setShowCertSuccessCopy] = useState(false);

  // Active LiveKit Cloud Realtime Media Live Swap Calling Session State
  const [activeLiveSwapSession, setActiveLiveSwapSession] = useState<{
    session: Session;
    isCaller?: boolean;
    incomingCallId?: string;
  } | null>(null);

  // Request Another Session State (Creates Brand New Session ID & Room)
  const [requestingAnotherSession, setRequestingAnotherSession] = useState<Session | null>(null);
  const [newSessionSkill, setNewSessionSkill] = useState("");
  const [newSessionTeachSkill, setNewSessionTeachSkill] = useState("");
  const [newSessionDateTime, setNewSessionDateTime] = useState("");
  const [newSessionDuration, setNewSessionDuration] = useState(30);
  const [newSessionNotes, setNewSessionNotes] = useState("");
  const [newSessionLoading, setNewSessionLoading] = useState(false);
  const [newSessionError, setNewSessionError] = useState("");
  const [newSessionSuccess, setNewSessionSuccess] = useState(false);

  // Handle requesting a new follow-up session with the partner
  const handleRequestAnotherSessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestingAnotherSession) return;

    const validation = validateSessionDateTime(newSessionDateTime, new Date());
    if (!validation.isValid || !validation.date) {
      setNewSessionError(validation.error || "Please select a future time.");
      return;
    }

    const selectedDate = validation.date;
    const isTeacher = requestingAnotherSession.teacherId === currentUserId;
    const partnerId = isTeacher 
      ? (requestingAnotherSession.learnerId || requestingAnotherSession.studentId)
      : requestingAnotherSession.teacherId;
    const partnerName = isTeacher
      ? (requestingAnotherSession.learnerName || requestingAnotherSession.studentName || profiles[partnerId || ""]?.fullName || "Partner")
      : (requestingAnotherSession.teacherName || profiles[partnerId || ""]?.fullName || "Partner");
    const myName = currentUserProfile?.fullName || auth.currentUser?.displayName || "Student";

    if (!partnerId) {
      setNewSessionError("Unable to identify partner for new session.");
      return;
    }

    setNewSessionLoading(true);
    setNewSessionError("");

    try {
      const duration = newSessionDuration || 30;
      const sessionEndTime = new Date(selectedDate.getTime() + duration * 60000);
      const meetingId = Math.random().toString(36).substring(2, 10).toUpperCase();

      const newSessionObj = {
        teacherId: partnerId,
        studentId: currentUserId,
        learnerId: currentUserId,
        senderId: currentUserId,
        receiverId: partnerId,
        teacherName: partnerName,
        studentName: myName,
        learnerName: myName,
        skill: newSessionSkill || requestingAnotherSession.skill || requestingAnotherSession.skillName || "Skill Swap",
        skillName: newSessionSkill || requestingAnotherSession.skillName || requestingAnotherSession.skill || "Skill Swap",
        teachSkill: newSessionTeachSkill || requestingAnotherSession.teachSkill || "",
        duration,
        sessionType: requestingAnotherSession.sessionType || "1-on-1 Video",
        status: "Pending",
        scheduledTime: selectedDate,
        sessionEndTime,
        createdAt: new Date(),
        notes: newSessionNotes.trim() || "Follow-up skill swap session.",
        timezone: currentUserProfile?.timezone || "UTC (GMT +00:00)",
        meetingId,
      };

      const docAdded = await addDoc(collection(db, "sessions"), newSessionObj);
      await updateDoc(doc(db, "sessions", docAdded.id), {
        sessionId: docAdded.id,
        livekitRoom: `swapskill_live_${docAdded.id}`,
      });

      // Send booking notification to partner
      try {
        const hostNotifRef = collection(db, "users", partnerId, "notifications");
        await addDoc(hostNotifRef, {
          type: "booking",
          senderId: currentUserId,
          senderName: myName,
          senderPhoto: auth.currentUser?.photoURL || DEFAULT_AVATAR,
          referenceId: docAdded.id,
          message: `requested another skill swap session! Topic: [${newSessionSkill || "Skill Swap"}]. Duration: ${duration}m`,
          read: false,
          createdAt: new Date(),
        });
      } catch (notifErr) {
        console.warn("Could not write notification:", notifErr);
      }

      setNewSessionSuccess(true);
      setTimeout(() => {
        setRequestingAnotherSession(null);
        setNewSessionSuccess(false);
        setNewSessionDateTime("");
        setNewSessionNotes("");
        setActiveTab("pending");
      }, 1200);

    } catch (err: any) {
      console.error("Error creating new session request:", err);
      setNewSessionError(err.message || "Failed to schedule new session.");
    } finally {
      setNewSessionLoading(false);
    }
  };

  // Handle joining a Live Swap for an accepted/upcoming session
  const handleJoinLiveSwap = (session: Session) => {
    if (!session) return;

    // Strict access control: only participants of this Swap Session may join
    const isParticipant =
      session.teacherId === currentUserId ||
      session.learnerId === currentUserId ||
      session.studentId === currentUserId;

    if (!isParticipant) {
      alert("Unauthorized: Only confirmed participants of this Swap Session can join the Live Swap.");
      return;
    }

    // Strict state check: only accepted / upcoming sessions can start Live Swap
    const normalized = getNormalizedStatus(session.status, session);
    if (normalized !== "upcoming" && session.status !== "accepted") {
      alert("Live Swap is only available for active/accepted sessions.");
      return;
    }

    if (session.sessionEnded === true || session.isEnded === true || session.meetingEnded === true || session.status?.toLowerCase() === "completed") {
      alert("This Swap Session has already ended and cannot be rejoined.");
      return;
    }

    // Strict expiration check: do not allow joining if session has passed its duration
    const scheduledDate = session.scheduledTime?.seconds 
      ? new Date(session.scheduledTime.seconds * 1000) 
      : new Date(session.scheduledTime);
    const duration = session.duration || 30;
    const sessionEndTime = session.sessionEndTime?.seconds 
      ? new Date(session.sessionEndTime.seconds * 1000) 
      : (session.sessionEndTime ? new Date(session.sessionEndTime) : new Date(scheduledDate.getTime() + duration * 60000));

    if (Date.now() >= sessionEndTime.getTime()) {
      alert("This Swap Session has already ended and reached its duration limit.");
      return;
    }

    console.log(`[LiveKit Live Swap] User "${currentUserProfile?.fullName || currentUserId}" joining session "${session.id}"`);

    setActiveLiveSwapSession({
      session
    });
  };
  // Dual-timezone parsing helpers
  const parseTimezoneOffset = (tzString: string): number => {
    const match = tzString?.match(/GMT\s*([+-]\d{2}):(\d{2})/);
    if (match) {
      const sign = match[1][0] === '+' ? 1 : -1;
      const hours = parseInt(match[1].slice(1), 10);
      const minutes = parseInt(match[2], 10);
      return sign * (hours * 60 + minutes);
    }
    return 0; // Default to UTC
  };

  const formatInTimezone = (date: Date, tzString: string): string => {
    const offsetMinutes = parseTimezoneOffset(tzString || "UTC (GMT +00:00)");
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    const targetTime = new Date(utcTime + (offsetMinutes * 60000));
    return targetTime.toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  };

  // Dynamic partner profile fetcher to cache user details (photos, bio, timezone)
  useEffect(() => {
    const missingIds = sessions
      .map(s => s.teacherId === currentUserId ? (s.learnerId || s.studentId) : s.teacherId)
      .filter(id => id && !profiles[id as string]);

    const uniqueMissing = Array.from(new Set(missingIds)) as string[];

    uniqueMissing.forEach(id => {
      fetchProfile(id as string);
    });
  }, [sessions, currentUserId, profiles, fetchProfile]);

  // Fetch other user profile when reschedule modal mounts
  useEffect(() => {
    if (reschedulingSession) {
      const otherId = reschedulingSession.teacherId === currentUserId 
        ? (reschedulingSession.learnerId || reschedulingSession.studentId) 
        : reschedulingSession.teacherId;
      if (otherId) {
        fetchProfile(otherId as string).then((p) => {
          if (p) setOtherUserProfile(p);
        });
      }
    } else {
      setOtherUserProfile(null);
    }
  }, [reschedulingSession, currentUserId, fetchProfile]);

  // Keep countdown/elapsed clock ticking every second for pristine feedback
  useEffect(() => {
    const ticker = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(ticker);
  }, []);

  // Automatic expiration cleanup: if an upcoming session exceeds scheduled duration, mark ended in Firestore
  useEffect(() => {
    const now = new Date();
    sessions.forEach((s) => {
      const normalized = getNormalizedStatus(s.status, s);
      if (normalized === "upcoming" && s.sessionEnded !== true && s.isEnded !== true && s.meetingEnded !== true) {
        const scheduledDate = s.scheduledTime?.seconds 
          ? new Date(s.scheduledTime.seconds * 1000) 
          : new Date(s.scheduledTime);
        const duration = s.duration || 60;
        const endTime = s.sessionEndTime?.seconds 
          ? new Date(s.sessionEndTime.seconds * 1000) 
          : (s.sessionEndTime ? new Date(s.sessionEndTime) : new Date(scheduledDate.getTime() + duration * 60000));
        
        if (now.getTime() >= endTime.getTime()) {
          const sessionRef = doc(db, "sessions", s.id);
          updateDoc(sessionRef, {
            status: "completed",
            sessionEnded: true,
            isEnded: true,
            meetingEnded: true,
            isLive: false,
            actualEndTime: new Date(),
            completedAt: new Date()
          }).catch(() => {});
        }
      }
    });
  }, [sessions]);

  // High fidelity sub-state resolver for Upcoming/Accepted lifecycle
  const getSessionSubState = (session: Session, now: Date) => {
    if (
      session.sessionEnded === true || 
      session.isEnded === true || 
      session.meetingEnded === true || 
      (session.status || "").toLowerCase() === "completed"
    ) {
      return {
        status: "completed",
        countdownText: "Completed",
        elapsedText: "",
        diffMins: -999999,
        isLive: false,
        isEnded: true,
        isMissed: false,
      };
    }

    const normalized = getNormalizedStatus(session.status, session);
    if (normalized !== "upcoming") {
      return {
        status: normalized, // "pending" | "completed" | "cancelled"
        countdownText: "",
        elapsedText: "",
        diffMins: 999999,
        isLive: false,
        isEnded: normalized === "completed" || normalized === "cancelled",
        isMissed: false,
      };
    }

    const scheduledDate = session.scheduledTime?.seconds 
      ? new Date(session.scheduledTime.seconds * 1000) 
      : new Date(session.scheduledTime);
      
    const diffMs = scheduledDate.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const duration = session.duration || 60;

    const isLiveRoom = session.isLive === true || (Array.isArray(session.liveParticipants) && session.liveParticipants.length > 0);

    // 1. LIVE NOW (Session start time reached and within scheduled duration, or active live room)
    if (isLiveRoom || (diffMins <= 0 && diffMins >= -duration)) {
      const elapsedSecs = Math.max(0, Math.floor((now.getTime() - scheduledDate.getTime()) / 1000));
      const totalDurationSecs = duration * 60;
      const remainingSecs = Math.max(0, totalDurationSecs - elapsedSecs);
      const remainingMins = Math.ceil(remainingSecs / 60);

      const pad = (num: number) => String(num).padStart(2, '0');
      const minStr = pad(Math.floor(elapsedSecs / 60));
      const secStr = pad(elapsedSecs % 60);

      return {
        status: "live",
        countdownText: `${remainingMins}m remaining`,
        elapsedText: `${minStr}:${secStr} / ${duration}:00`,
        diffMins,
        isLive: true,
        isEnded: false,
        isMissed: false,
      };
    }

    // 2. STARTING SOON (within 15 minutes of scheduled start time)
    if (diffMins > 0 && diffMins <= 15) {
      return {
        status: "starting_soon",
        countdownText: `Starts in ${diffMins}m`,
        elapsedText: "",
        diffMins,
        isLive: false,
        isEnded: false,
        isMissed: false,
      };
    }

    // 3. UPCOMING / SCHEDULED (> 15 minutes in advance)
    if (diffMins > 15) {
      return {
        status: "upcoming",
        countdownText: formatSessionCountdown(session.scheduledTime, now),
        elapsedText: "",
        diffMins,
        isLive: false,
        isEnded: false,
        isMissed: false,
      };
    }

    // 4. PAST SCHEDULED WINDOW (Duration expired)
    const wasStarted = session.hasStartedLive || session.actualStartTime || session.isLive;
    if (!wasStarted) {
      return {
        status: "missed",
        countdownText: "Missed",
        elapsedText: "",
        diffMins,
        isLive: false,
        isEnded: true,
        isMissed: true,
      };
    }

    return {
      status: "ended",
      countdownText: "Ended",
      elapsedText: "",
      diffMins,
      isLive: false,
      isEnded: true,
      isMissed: false,
    };
  };

  const getCountdownText = (scheduledTime: any, now: Date) => {
    return formatSessionCountdown(scheduledTime, now);
  };

  // Status handlers
  const handleUpdateStatus = async (sessionId: string, newStatus: "accepted" | "completed") => {
    try {
      const sessionRef = doc(db, "sessions", sessionId);
      const dbStatus = newStatus === "accepted" ? "confirmed" : "Completed";

      await updateDoc(sessionRef, { status: dbStatus });

      const sessionSnap = await getDoc(sessionRef);
      if (sessionSnap.exists()) {
        const sData = sessionSnap.data() as Session;
        const studentId = sData.learnerId || sData.studentId;

        if (newStatus === "completed") {
          const teacherProfileRef = doc(db, "users", sData.teacherId);
          const teacherSnap = await getDoc(teacherProfileRef);
          if (teacherSnap.exists()) {
            const currentSessions = teacherSnap.data().sessionsCount || 0;
            const currentPoints = teacherSnap.data().points || 0;
            await updateDoc(teacherProfileRef, {
              sessionsCount: currentSessions + 1,
              points: currentPoints + 50
            });
          }

          const learnerProfileRef = doc(db, "users", studentId);
          const learnerSnap = await getDoc(learnerProfileRef);
          if (learnerSnap.exists()) {
            const currentPoints = learnerSnap.data().points || 0;
            await updateDoc(learnerProfileRef, {
              points: currentPoints + 20
            });
          }

          const studentNotifRef = collection(db, "users", studentId, "notifications");
          await addDoc(studentNotifRef, {
            type: "booking",
            senderId: currentUserId,
            senderName: sData.teacherName,
            senderPhoto: DEFAULT_AVATAR,
            referenceId: sessionId,
            message: `marked the session [${sData.skillName || sData.skill}] as successfully completed! +20 points added!`,
            read: false,
            createdAt: new Date()
          });
        }

        if (newStatus === "accepted") {
          try {
            await getOrCreateConversation(
              sData.teacherId, 
              studentId, 
              "✦ Swap Session accepted! Let's coordinate here. ✦"
            );
          } catch (e) {
            console.warn("Could not create/get canonical conversation on accept:", e);
          }

          const studentNotifRef = collection(db, "users", studentId, "notifications");
          await addDoc(studentNotifRef, {
            type: "booking",
            senderId: currentUserId,
            senderName: sData.teacherName,
            senderPhoto: DEFAULT_AVATAR,
            referenceId: sessionId,
            message: `accepted your booking request for [${sData.skillName || sData.skill}]! Realtime HD room and chat channel generated.`,
            read: false,
            createdAt: new Date()
          });
        }
      }
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingSession) return;

    const isSender = cancellingSession.senderId === currentUserId || cancellingSession.studentId === currentUserId || cancellingSession.learnerId === currentUserId;
    const finalReason = cancelReason.trim() || (isSender ? "Cancelled by requester" : "No reason provided");

    setCancellingLoading(true);
    try {
      const sessionRef = doc(db, "sessions", cancellingSession.id);
      const isTeacher = cancellingSession.teacherId === currentUserId;
      const otherId = isTeacher ? (cancellingSession.learnerId || cancellingSession.studentId) : cancellingSession.teacherId;
      const dbStatus = cancellingSession.status === "requested" || cancellingSession.status === "Pending" ? "Rejected" : "Cancelled";

      await updateDoc(sessionRef, {
        status: dbStatus,
        cancelReason: finalReason,
        cancelledBy: currentUserId
      });

      if (otherId) {
        const otherNotifRef = collection(db, "users", otherId, "notifications");
        await addDoc(otherNotifRef, {
          type: "booking",
          senderId: currentUserId,
          senderName: isTeacher ? cancellingSession.teacherName : (cancellingSession.learnerName || cancellingSession.studentName),
          senderPhoto: DEFAULT_AVATAR,
          referenceId: cancellingSession.id,
          message: `${dbStatus === "Rejected" ? "declined" : "cancelled"} the [${cancellingSession.skillName || cancellingSession.skill}] exchange session. Reason: "${finalReason}"`,
          read: false,
          createdAt: new Date()
        });
      }

      setCancellingSession(null);
      setCancelReason("");
    } catch (err) {
      console.error("Error rejecting/cancelling session:", err);
    } finally {
      setCancellingLoading(false);
    }
  };

  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reschedulingSession || !rescheduleDateTime) {
      setRescheduleError("Please select a date and time for the session.");
      return;
    }

    const roundedDateTimeStr = roundToNearest15(rescheduleDateTime, true);
    setRescheduleDateTime(roundedDateTimeStr);

    const validation = validateSessionDateTime(roundedDateTimeStr, new Date());
    if (!validation.isValid || !validation.date) {
      setRescheduleError(validation.error || "Please select a future time.");
      return;
    }

    const selectedDate = validation.date;

    setRescheduleLoading(true);
    setRescheduleError("");

    try {
      const sessionRef = doc(db, "sessions", reschedulingSession.id);
      
      await updateDoc(sessionRef, {
        scheduledTime: selectedDate,
        status: "Pending"
      });

      const isTeacher = reschedulingSession.teacherId === currentUserId;
      const otherId = isTeacher ? (reschedulingSession.learnerId || reschedulingSession.studentId) : reschedulingSession.teacherId;

      if (otherId) {
        const otherNotifRef = collection(db, "users", otherId, "notifications");
        await addDoc(otherNotifRef, {
          type: "booking",
          senderId: currentUserId,
          senderName: isTeacher ? reschedulingSession.teacherName : (reschedulingSession.learnerName || reschedulingSession.studentName),
          senderPhoto: DEFAULT_AVATAR,
          referenceId: reschedulingSession.id,
          message: `rescheduled the [${reschedulingSession.skillName || reschedulingSession.skill}] session to ${selectedDate.toLocaleString()}. Status reset to Pending.`,
          read: false,
          createdAt: new Date()
        });
      }

      setReschedulingSession(null);
      setRescheduleDateTime("");
    } catch (err) {
      console.error("Error rescheduling:", err);
      setRescheduleError("Failed to update schedule. Try again.");
    } finally {
      setRescheduleLoading(false);
    }
  };

  const handleSubmitReview = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const sessionToReview = activeReviewSession || selectedWorkspaceSession;
    if (!sessionToReview) return;
    setReviewError("");

    if (!comment.trim()) {
      setReviewError("Please provide written feedback.");
      return;
    }

    setSubmittingReview(true);
    try {
      const reviewsRef = collection(db, "reviews");
      const revieweeId = sessionToReview.teacherId === currentUserId 
        ? (sessionToReview.learnerId || sessionToReview.studentId) 
        : sessionToReview.teacherId;
      const reviewerName = sessionToReview.teacherId === currentUserId
        ? sessionToReview.teacherName
        : (sessionToReview.learnerName || sessionToReview.studentName);

      await addDoc(reviewsRef, {
        sessionId: sessionToReview.id,
        reviewerId: currentUserId,
        revieweeId,
        reviewerName,
        rating,
        comment: comment.trim(),
        createdAt: new Date()
      });

      const qReviews = query(collection(db, "reviews"), where("revieweeId", "==", revieweeId));
      const snaps = await getDocs(qReviews);
      let total = 0;
      let count = 0;
      snaps.forEach((d) => {
        total += d.data().rating;
        count++;
      });

      if (count > 0 && revieweeId) {
        const avgRating = total / count;
        await updateDoc(doc(db, "users", revieweeId), {
          rating: parseFloat(avgRating.toFixed(1))
        });
      }

      if (revieweeId) {
        const revieweeNotifRef = collection(db, "users", revieweeId, "notifications");
        await addDoc(revieweeNotifRef, {
          type: "review",
          senderId: currentUserId,
          senderName: reviewerName,
          senderPhoto: DEFAULT_AVATAR,
          referenceId: sessionToReview.id,
          message: "completed and submitted a verified peer review on your swap! ✦",
          read: false,
          createdAt: new Date()
        });
      }

      // Mark completed as well if it's currently ended
      if (getNormalizedStatus(sessionToReview.status, sessionToReview) === "upcoming") {
        await handleUpdateStatus(sessionToReview.id, "completed");
      }

      setActiveReviewSession(null);
      setComment("");
      setRating(5);
      
      // Auto close workspace or sync states
      if (selectedWorkspaceSession?.id === sessionToReview.id) {
        setSelectedWorkspaceSession(null);
      }
    } catch (err) {
      console.error("Error submitting review:", err);
      setReviewError("Failed to lock review ledger.");
    } finally {
      setSubmittingReview(false);
    }
  };

  // Filter list
  const filteredSessions = sessions.filter(
    (s) => getNormalizedStatus(s.status, s) === activeTab
  );

  // Truly Live in-progress sessions (active participants or flagged isLive)
  const liveSessionsCount = React.useMemo(() => {
    return sessions.filter((s) => {
      const normalized = getNormalizedStatus(s.status, s);
      if (normalized === "completed" || normalized === "cancelled" || normalized === "deleted") return false;
      if (s.sessionEnded === true || s.isEnded === true || s.meetingEnded === true) return false;
      return s.isLive === true || (Array.isArray(s.liveParticipants) && s.liveParticipants.length > 0);
    }).length;
  }, [sessions]);

  // Active reminder & live call banners (non-completed, non-ended, non-dismissed)
  const activeAlerts = React.useMemo(() => {
    return sessions
      .filter((s) => {
        // Exclude if explicitly dismissed by user in this session/browser
        if (dismissedAlerts[s.id]) return false;

        const normalized = getNormalizedStatus(s.status, s);
        if (normalized !== "upcoming" && s.status !== "accepted") return false;
        if (
          s.sessionEnded === true ||
          s.isEnded === true ||
          s.meetingEnded === true ||
          (s.status || "").toLowerCase() === "completed" ||
          s.status === "deleted" ||
          s.deletedAt
        ) {
          return false;
        }
        return true;
      })
      .map((s) => {
        const schedTime = s.scheduledTime?.seconds ? s.scheduledTime.seconds * 1000 : new Date(s.scheduledTime).getTime();
        const diffMs = schedTime - currentTime.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const otherName = s.teacherId === currentUserId ? (s.learnerName || s.studentName) : s.teacherName;
        const isLiveRoom = s.isLive === true || (Array.isArray(s.liveParticipants) && s.liveParticipants.length > 0);
        const duration = s.duration || 60;
        const isTimeWindow = diffMins <= 15 && diffMins >= -duration;

        return { 
          session: s, 
          diffMins, 
          otherName: otherName || "Swap Partner",
          isLiveRoom,
          duration,
          isStartingSoon: diffMins > 0 && diffMins <= 15,
          isTimeWindow
        };
      })
      .filter((alert) => {
        // Render if actively live room OR starting soon / within scheduled active window
        return alert.isLiveRoom || alert.isTimeWindow;
      });
  }, [sessions, dismissedAlerts, currentTime, currentUserId]);

  return (
    <div className="flex flex-col min-h-screen bg-[#F7F4EE] text-[#0D0D0F] font-sans pb-28 relative w-full overflow-x-hidden mobile-scroll">
      
      {/* Native Mobile Sticky Header */}
      <header className="px-4 sm:px-6 pt-safe pt-4 pb-3 border-b border-[#E8E4DB] bg-[#F7F4EE]/95 backdrop-blur-md sticky top-0 z-30 w-full shadow-2xs">
        <div className="max-w-lg mx-auto w-full flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#0D0D0F]">Swap Sessions</h1>
            <p className="text-[#71717A] text-[11px] font-normal mt-0.5">
              1-on-1 peer skill exchange appointments
            </p>
          </div>
          <div className="flex items-center gap-2">
            {liveSessionsCount > 0 ? (
              <span className="text-[11px] bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full text-emerald-700 font-semibold flex items-center gap-1.5 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                {liveSessionsCount} Live Now
              </span>
            ) : upcomingCount > 0 ? (
              <span className="text-[11px] bg-[#FFFFFF] border border-[#E8E4DB] px-3 py-1 rounded-full text-[#0D0D0F] font-medium flex items-center gap-1.5 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E]" />
                {upcomingCount} Upcoming
              </span>
            ) : (
              <span className="text-[11px] bg-[#FFFFFF] border border-[#E8E4DB] px-3 py-1 rounded-full text-[#71717A] font-medium flex items-center gap-1.5 shadow-2xs">
                {sessions.length} Total
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Native Content Container */}
      <main className="w-full max-w-lg mx-auto px-4 sm:px-6 pt-4 flex-1 flex flex-col">
        
        {/* Urgent Live / Starting Soon Alerts Banner (With Dismiss & Quick Actions) */}
        <AnimatePresence initial={false}>
          {activeAlerts.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-col gap-2.5 mb-4 overflow-hidden"
            >
              {activeAlerts.map(({ session, diffMins, otherName, isLiveRoom, isStartingSoon, duration }) => {
                return (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0, scale: 0.95, transition: { duration: 0.2 } }}
                    key={session.id}
                    className={`p-3.5 rounded-2xl border transition-all duration-200 shadow-xs relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isLiveRoom 
                        ? "border-emerald-500/40 bg-[#FFFFFF] ring-1 ring-emerald-500/20"
                        : "border-[#C9A96E]/40 bg-[#FFFFFF]"
                    }`}
                  >
                    {/* Top Row / Left Info */}
                    <div className="flex items-center gap-3 min-w-0 pr-6 sm:pr-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                        isLiveRoom 
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600" 
                          : "bg-[#0D0D0F] border-[#C9A96E]/40 text-[#C9A96E]"
                      }`}>
                        {isLiveRoom ? (
                          <Video className="w-4 h-4 animate-pulse" />
                        ) : (
                          <Clock className="w-4 h-4 animate-pulse" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isLiveRoom ? (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700">
                              Live Now
                            </span>
                          ) : isStartingSoon ? (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-[#C9A96E]/15 text-[#8C6D37]">
                              In {diffMins}m
                            </span>
                          ) : (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600">
                              Scheduled
                            </span>
                          )}
                          <p className="text-xs font-semibold text-[#0D0D0F] truncate">
                            {otherName}
                          </p>
                        </div>
                        <p className="text-[11px] text-[#71717A] truncate mt-0.5">
                          {session.skillName || session.skill} • {duration}m
                        </p>
                      </div>
                    </div>

                    {/* Action Buttons & Dismiss */}
                    <div className="flex items-center justify-between sm:justify-end gap-1.5 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-zinc-100">
                      <div className="flex items-center gap-1.5">
                        <button
                          id={`alert-join-live-swap-btn-${session.id}`}
                          onClick={() => handleJoinLiveSwap(session)}
                          className="h-8 px-3 bg-[#0D0D0F] text-[#F7F4EE] hover:bg-[#1A1A1D] border border-[#C9A96E]/40 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-md"
                          title="Join Live Video/Audio Call"
                        >
                          <Video className="w-3.5 h-3.5 text-[#C9A96E] animate-pulse" />
                          <span>{isLiveRoom ? "Join Live" : "Open Call"}</span>
                        </button>
                        <button
                          onClick={() => setSelectedWorkspaceSession(session)}
                          className="h-8 px-2.5 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#0D0D0F] rounded-xl font-medium text-xs flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-2xs"
                          title="View Session Workspace"
                        >
                          <FileText className="w-3.5 h-3.5 text-[#71717A]" />
                          <span>Workspace</span>
                        </button>
                        <button
                          onClick={(e) => handleQuickCompleteAlert(session, e)}
                          className="h-8 px-2 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 border border-[#E8E4DB] text-[#71717A] rounded-xl font-medium text-xs flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-2xs"
                          title="Mark Session as Completed"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span className="hidden xs:inline">Done</span>
                        </button>
                      </div>

                      {/* Close / Dismiss Button */}
                      <button
                        type="button"
                        onClick={(e) => handleDismissAlert(session.id, e)}
                        className="w-7 h-7 rounded-lg hover:bg-zinc-100 text-[#A1A1AA] hover:text-[#0D0D0F] flex items-center justify-center transition cursor-pointer"
                        title="Dismiss notification"
                        aria-label="Dismiss active session notification"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Premium Compact Glass Filter Dropdown: View: Requested ▾ */}
        <div className="relative mb-4 z-30" ref={filterDropdownRef}>
          <div className="flex items-center justify-between gap-3">
            <div className="relative">
              <button
                id="sessions-filter-dropdown-btn"
                type="button"
                onClick={() => setIsFilterDropdownOpen((prev) => !prev)}
                className="glass-filter-dropdown-btn h-9.5 px-3.5 rounded-xl text-xs font-medium flex items-center gap-2 cursor-pointer select-none active:scale-[0.98]"
                aria-expanded={isFilterDropdownOpen}
                aria-haspopup="listbox"
              >
                <span className="text-[#71717A] text-[11px] font-normal">View:</span>
                <span className="text-[#0D0D0F] font-semibold text-xs">{TAB_LABELS[activeTab]}</span>
                
                {/* Active Tab Count Badge */}
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#C9A96E]/20 text-[#0D0D0F] border border-[#C9A96E]/35">
                  {sessions.filter(s => getNormalizedStatus(s.status, s) === activeTab).length}
                </span>

                {/* Ambient Red Dot on trigger if other unviewed tabs have activity */}
                {((hasUnseenUpcoming && activeTab !== "upcoming") || (hasUnseenCancelled && activeTab !== "cancelled")) && (
                  <span className="w-2 h-2 rounded-full bg-[#EF4444] animate-pulse -ml-0.5" title="New activity in other views" />
                )}

                <ChevronDown 
                  className={`w-3.5 h-3.5 text-[#71717A] transition-transform duration-200 ml-0.5 ${
                    isFilterDropdownOpen ? "rotate-180 text-[#0D0D0F]" : ""
                  }`} 
                />
              </button>

              {/* Glassmorphism Dropdown Menu */}
              <AnimatePresence>
                {isFilterDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    className="absolute left-0 top-full mt-2 w-64 glass-filter-dropdown-menu rounded-2xl p-1.5 shadow-xl z-50 flex flex-col gap-1"
                    role="listbox"
                  >
                    {([
                      { id: "pending", label: "Requested" },
                      { id: "upcoming", label: "Upcoming" },
                      { id: "completed", label: "Completed" },
                      { id: "cancelled", label: "Cancelled" }
                    ] as const).map((tab) => {
                      const count = sessions.filter(s => getNormalizedStatus(s.status) === tab.id).length;
                      const isSelected = activeTab === tab.id;
                      const showDot = 
                        (tab.id === "upcoming" && hasUnseenUpcoming) || 
                        (tab.id === "cancelled" && hasUnseenCancelled);

                      return (
                        <button
                          key={tab.id}
                          id={`session-filter-option-${tab.id}`}
                          type="button"
                          onClick={() => handleSelectTab(tab.id)}
                          className={`w-full px-3.5 py-2 rounded-xl text-xs flex items-center justify-between cursor-pointer select-none transition-all ${
                            isSelected
                              ? "glass-filter-dropdown-item-active"
                              : "glass-filter-dropdown-item"
                          }`}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {/* Small Red Notification Dot only on Upcoming/Cancelled when unseen */}
                            {showDot ? (
                              <span className="w-2 h-2 rounded-full bg-[#EF4444] shrink-0 animate-pulse" />
                            ) : (
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? "bg-[#C9A96E]" : "bg-transparent"}`} />
                            )}
                            <span className={`truncate text-xs ${isSelected ? "text-[#0D0D0F] font-semibold" : "text-[#4A4A52] font-medium"}`}>
                              {tab.label}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              isSelected
                                ? "bg-[#C9A96E]/20 text-[#0D0D0F] border border-[#C9A96E]/40"
                                : "bg-[#F2EFE8] text-[#71717A] border border-[#E8E4DB]"
                            }`}>
                              {count}
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-[#C9A96E] stroke-[2.5]" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Total sessions counter badge */}
            <div className="text-[11px] font-medium text-[#71717A] flex items-center gap-1.5 bg-[#FFFFFF] border border-[#E8E4DB] px-2.5 py-1 rounded-xl shadow-2xs">
              <span>Total:</span>
              <span className="text-[#0D0D0F] font-semibold">{sessions.length}</span>
            </div>
          </div>
        </div>

        {/* Action Toast Feedback */}
        <AnimatePresence>
          {deleteSessionToast && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-4 p-3.5 rounded-2xl bg-[#0D0D0F] text-[#F7F4EE] text-xs flex items-center justify-between border border-[#1A1A1D] shadow-md"
            >
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#C9A96E]" />
                <span className="font-medium">{deleteSessionToast}</span>
              </div>
              <span className="text-[10px] text-[#C9A96E] font-mono uppercase tracking-wider">30-day Trash</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* List Content */}
        <LoadingTransition isLoading={loading} type="sessions" count={2}>
          {filteredSessions.length === 0 ? (
          /* Clean Minimal Empty States */
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center text-center py-16 px-4 my-auto gap-3.5"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] flex items-center justify-center shadow-2xs">
              <Calendar className="w-5 h-5 text-[#C9A96E]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#0D0D0F]">No {activeTab} sessions</h3>
              <p className="text-[#71717A] text-xs mt-1 max-w-xs leading-relaxed">
                {activeTab === "pending" && "You have no incoming or outgoing swap requests at the moment."}
                {activeTab === "upcoming" && "No scheduled sessions yet. Coordinate with partners to book a slot."}
                {activeTab === "completed" && "Completed sessions and verified certificates will appear here."}
                {activeTab === "cancelled" && "Declined or cancelled session bookings are archived here."}
              </p>
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {filteredSessions.map((session) => {
              const isTeacher = session.teacherId === currentUserId;
              const partnerId = isTeacher ? (session.learnerId || session.studentId) : session.teacherId;
              const partnerProfile = partnerId ? profiles[partnerId] : null;

              const scheduledDate = session.scheduledTime?.seconds 
                ? new Date(session.scheduledTime.seconds * 1000) 
                : new Date(session.scheduledTime);
              
              const formattedDate = scheduledDate.toLocaleDateString([], {
                weekday: "short",
                month: "short",
                day: "numeric"
              });

              const formattedTime = scheduledDate.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              });

              const otherName = isTeacher ? (session.learnerName || session.studentName) : session.teacherName;
              
              // Calculate Substate for scheduling
              const subState = getSessionSubState(session, currentTime);

              // Determine current user's role based on Firebase UID
              const isSender = session.senderId === currentUserId || session.studentId === currentUserId || session.learnerId === currentUserId;
              const isReceiver = session.receiverId === currentUserId || (!isSender && session.teacherId === currentUserId);

              const normalizedStatus = getNormalizedStatus(session.status);

              // Compute ONE SINGLE clean, elegant status badge
              let statusLabel = "";
              let statusClasses = "";

              if (normalizedStatus === "pending") {
                if (isReceiver) {
                  statusLabel = "Action Required";
                  statusClasses = "bg-[#0D0D0F] text-[#C9A96E] border border-[#1A1A1D]";
                } else {
                  statusLabel = "Awaiting Reply";
                  statusClasses = "bg-[#F2EFE8] text-[#71717A] border border-[#E8E4DB]";
                }
              } else if (normalizedStatus === "upcoming") {
                if (subState.isMissed) {
                  statusLabel = "Missed";
                  statusClasses = "bg-[#FEF2F2] text-[#DC2626] border border-[#FCA5A5]";
                } else if (subState.status === "live") {
                  statusLabel = "Live Now";
                  statusClasses = "bg-[#0D0D0F] text-[#C9A96E] border border-[#1A1A1D]";
                } else if (subState.status === "starting_soon") {
                  statusLabel = "Starting Soon";
                  statusClasses = "bg-[#F7F4EE] text-[#0D0D0F] border border-[#C9A96E]/60";
                } else {
                  statusLabel = "Upcoming";
                  statusClasses = "bg-[#F2EFE8] text-[#0D0D0F] border border-[#E8E4DB]";
                }
              } else if (normalizedStatus === "completed") {
                statusLabel = "Completed";
                statusClasses = "bg-[#F2EFE8] text-[#71717A] border border-[#E8E4DB]";
              } else {
                statusLabel = "Cancelled";
                statusClasses = "bg-[#F2EFE8] text-[#71717A] border border-[#E8E4DB]";
              }

              return (
                <motion.div
                  id={`session-card-${session.id}`}
                  key={session.id}
                  className="p-4 sm:p-5 rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] transition-all duration-200 shadow-2xs w-full flex flex-col gap-3.5"
                >
                  {/* Top Row: Partner Avatar + Name & Role + Single Status Pill */}
                  <div className="flex items-center justify-between gap-3 w-full">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full overflow-hidden border border-[#E8E4DB] bg-[#F2EFE8] shrink-0 select-none">
                        <img 
                          src={partnerProfile?.profilePhotoUrl || partnerProfile?.photoUrl || DEFAULT_AVATAR} 
                          alt={otherName} 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-[#0D0D0F] truncate">{otherName}</span>
                        </div>
                        <span className="text-[10px] text-[#71717A] flex items-center gap-1 mt-0.5">
                          <span>{isTeacher ? "Learner" : "Mentor"}</span>
                          <span>•</span>
                          <span className="text-[#0D0D0F] font-medium truncate">{session.sessionType || "Video Call"}</span>
                        </span>
                      </div>
                    </div>

                    {/* Single Clean Status Badge + Quick Delete Action */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[10px] px-2.5 py-1 rounded-full font-medium tracking-wide flex items-center gap-1.5 ${statusClasses}`}>
                        {subState.status === "live" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E] animate-pulse" />
                        )}
                        {statusLabel}
                      </span>
                      {subState.status !== "live" && (
                        <button
                          id={`delete-session-btn-${session.id}`}
                          type="button"
                          onClick={(e) => handleRequestDelete(session, e)}
                          className="w-7 h-7 rounded-lg bg-[#F7F4EE] hover:bg-[#FEF2F2] text-[#71717A] hover:text-[#DC2626] border border-[#E8E4DB] hover:border-[#FCA5A5] flex items-center justify-center transition-all active:scale-95 cursor-pointer"
                          title="Move session to Recently Deleted"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Skill / Topic Title */}
                  <div className="pt-0.5">
                    <h3 className="font-semibold text-sm sm:text-base text-[#0D0D0F] tracking-tight leading-snug">
                      {session.skillName || session.skill}
                    </h3>
                  </div>

                  {/* Compact Date & Time Meta Row */}
                  <div className="flex items-center flex-wrap gap-y-1.5 gap-x-4 text-xs text-[#71717A] bg-[#F7F4EE] px-3 py-2 rounded-xl border border-[#E8E4DB]">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-[#C9A96E] shrink-0" />
                      <span className="text-[#0D0D0F] font-medium">{formattedDate}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                      <span className="text-[#0D0D0F] font-medium">{formattedTime}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto text-[11px] text-[#71717A]">
                      <span>{session.duration || 60}m</span>
                    </div>
                  </div>

                  {/* Live Progress / Countdown Banner if applicable */}
                  {activeTab === "upcoming" && subState.status === "live" && (
                    <div className="flex items-center justify-between text-xs bg-[#0D0D0F] text-[#F7F4EE] px-3 py-2 rounded-xl border border-[#1A1A1D]">
                      <span className="text-[#C9A96E] font-medium flex items-center gap-1.5 text-[11px]">
                        <span className="w-2 h-2 rounded-full bg-[#C9A96E] animate-ping" />
                        Live Now
                      </span>
                      <span className="font-mono text-[11px] text-[#F7F4EE] font-semibold">
                        {subState.countdownText}
                      </span>
                    </div>
                  )}

                  {activeTab === "upcoming" && subState.status === "starting_soon" && (
                    <div className="flex items-center justify-between text-xs bg-[#FDFBF7] border border-[#C9A96E]/50 px-3 py-2 rounded-xl">
                      <span className="text-[#71717A] text-[11px] font-medium flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#C9A96E]" />
                        Starting Soon
                      </span>
                      <span className="font-semibold text-[#0D0D0F] text-[11px]">
                        {subState.countdownText}
                      </span>
                    </div>
                  )}

                  {activeTab === "upcoming" && subState.status === "upcoming" && (
                    <div className="flex items-center justify-between text-xs bg-[#F7F4EE] border border-[#E8E4DB] px-3 py-2 rounded-xl">
                      <span className="text-[#71717A] text-[11px] font-medium flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#C9A96E]" />
                        Upcoming Countdown
                      </span>
                      <span className="font-semibold text-[#0D0D0F] text-[11px]">
                        {subState.countdownText}
                      </span>
                    </div>
                  )}

                  {activeTab === "upcoming" && subState.isMissed && (
                    <div className="flex items-center justify-between text-xs bg-[#FEF2F2] border border-[#FCA5A5] px-3 py-2 rounded-xl">
                      <span className="text-[#DC2626] text-[11px] font-medium flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-[#DC2626]" />
                        Session Missed
                      </span>
                      <span className="text-[11px] text-[#71717A]">
                        Scheduled time has passed
                      </span>
                    </div>
                  )}

                  {/* Notes snippet if present */}
                  {session.notes && (
                    <p className="text-[11px] text-[#71717A] italic line-clamp-2 px-1">
                      "{session.notes}"
                    </p>
                  )}

                  {/* Action Buttons Row */}
                  <div className="pt-1 flex items-center gap-2 w-full">
                    
                    {/* PENDING TAB ACTIONS */}
                    {(activeTab === "pending" || normalizedStatus === "pending") && (
                      <div className="grid grid-cols-2 gap-2 w-full">
                        {isReceiver ? (
                          <>
                            <button
                              id={`accept-session-btn-${session.id}`}
                              onClick={() => handleUpdateStatus(session.id, "accepted")}
                              className="h-10 px-4 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                            >
                              <Check className="w-3.5 h-3.5 text-[#C9A96E]" />
                              <span>Accept</span>
                            </button>
                            <button
                              id={`decline-session-btn-${session.id}`}
                              onClick={() => setCancellingSession(session)}
                              className="h-10 px-4 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#71717A] hover:text-[#0D0D0F] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center"
                            >
                              Decline
                            </button>
                          </>
                        ) : isSender ? (
                          <button
                            id={`cancel-session-btn-${session.id}`}
                            onClick={() => setCancellingSession(session)}
                            className="col-span-2 h-10 px-4 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#71717A] hover:text-[#0D0D0F] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center"
                          >
                            Cancel Request
                          </button>
                        ) : null}
                      </div>
                    )}

                    {/* UPCOMING TAB ACTIONS */}
                    {activeTab === "upcoming" && (
                      <div className="w-full flex items-center gap-2">
                        {subState.isMissed ? (
                          <div className="grid grid-cols-2 gap-2 w-full">
                            <button
                              id={`request-again-btn-${session.id}`}
                              onClick={() => {
                                setRequestingAnotherSession(session);
                                setNewSessionSkill(session.skillName || session.skill || "");
                                setNewSessionTeachSkill(session.teachSkill || "");
                                setNewSessionDuration(session.duration || 60);
                              }}
                              className="h-10 px-3 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-[#C9A96E]" />
                              <span>Request Again</span>
                            </button>
                            <button
                              onClick={() => setReschedulingSession(session)}
                              className="h-10 px-3 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#71717A] hover:text-[#0D0D0F] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center"
                            >
                              Reschedule
                            </button>
                          </div>
                        ) : subState.status === "ended" || session.sessionEnded === true || session.isEnded === true || session.meetingEnded === true ? (
                          <div className="grid grid-cols-2 gap-2 w-full">
                            <button
                              onClick={() => {
                                setSelectedWorkspaceSession(session);
                                setWorkspaceActiveTab("review");
                              }}
                              className="h-10 px-3 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#0D0D0F] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                            >
                              <Star className="w-3.5 h-3.5 text-[#C9A96E] fill-[#C9A96E]" />
                              <span>Rate</span>
                            </button>
                            <button
                              onClick={() => {
                                setSelectedWorkspaceSession(session);
                                setWorkspaceActiveTab("review");
                              }}
                              className="h-10 px-3 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                            >
                              <CheckCircle className="w-3.5 h-3.5 text-[#C9A96E]" />
                              <span>Complete</span>
                            </button>
                          </div>
                        ) : subState.status === "live" ? (
                          <div className="grid grid-cols-3 gap-2 w-full">
                            <button
                              id={`join-live-swap-btn-${session.id}`}
                              onClick={() => handleJoinLiveSwap(session)}
                              className="col-span-2 h-11 px-4 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] border border-[#C9A96E] rounded-xl font-bold text-xs transition-all active:scale-95 cursor-pointer shadow-md flex items-center justify-center gap-2"
                              title="Join Live Video/Audio Swap"
                            >
                              <span className="w-2 h-2 rounded-full bg-[#C9A96E] animate-ping" />
                              <Video className="w-4 h-4 text-[#C9A96E]" />
                              <span>Join Live</span>
                            </button>
                            <button
                              id={`workspace-btn-${session.id}`}
                              onClick={() => setSelectedWorkspaceSession(session)}
                              className="col-span-1 h-11 px-2 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#0D0D0F] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center shadow-2xs"
                              title="Open Workspace"
                            >
                              <span>Workspace</span>
                            </button>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2 w-full">
                            <button
                              id={`workspace-btn-${session.id}`}
                              onClick={() => setSelectedWorkspaceSession(session)}
                              className="h-10 px-3 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#0D0D0F] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center shadow-2xs"
                              title="Open Workspace"
                            >
                              <span>Workspace</span>
                            </button>
                            <button
                              onClick={() => setReschedulingSession(session)}
                              className="h-10 px-3 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#71717A] hover:text-[#0D0D0F] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center"
                              title="Reschedule"
                            >
                              Reschedule
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* COMPLETED TAB ACTIONS */}
                    {activeTab === "completed" && (
                      <div className="grid grid-cols-3 gap-2 w-full">
                        <button
                          id={`request-another-session-btn-${session.id}`}
                          onClick={() => {
                            const isTeacher = session.teacherId === currentUserId;
                            const partnerId = isTeacher ? (session.learnerId || session.studentId) : session.teacherId;
                            setRequestingAnotherSession(session);
                            setNewSessionSkill(session.skillName || session.skill || "");
                            setNewSessionTeachSkill(session.teachSkill || "");
                            setNewSessionDuration(session.duration || 30);
                            setNewSessionDateTime("");
                            setNewSessionNotes("");
                            setNewSessionError("");
                            if (partnerId) {
                              fetchProfile(partnerId as string).then(p => {
                                if (p) setOtherUserProfile(p);
                              });
                            }
                          }}
                          className="col-span-1 h-10 px-2 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] rounded-xl font-bold text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                          title="Request Another Session with this partner"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-[#C9A96E]" />
                          <span className="truncate">Request Again</span>
                        </button>

                        <button
                          onClick={() => {
                            setSelectedWorkspaceSession(session);
                            setWorkspaceActiveTab("review");
                          }}
                          className="col-span-1 h-10 px-2 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#0D0D0F] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Star className="w-3.5 h-3.5 text-[#C9A96E] fill-[#C9A96E]" />
                          <span className="truncate">Rate</span>
                        </button>
                        
                        <button
                          onClick={() => {
                            setActiveCertificate(session);
                            setShowCertSuccessCopy(false);
                          }}
                          className="col-span-1 h-10 px-2 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#0D0D0F] rounded-xl font-medium text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                        >
                          <Award className="w-3.5 h-3.5 text-[#C9A96E]" />
                          <span className="truncate">Certificate</span>
                        </button>
                      </div>
                    )}

                    {/* CANCELLED TAB ARCHIVE */}
                    {activeTab === "cancelled" && (
                      <div className="w-full flex items-center justify-between text-xs text-[#71717A] pt-1">
                        <span>{session.cancelReason ? `"${session.cancelReason}"` : "Session cancelled"}</span>
                        <span className="text-[10px] text-[#A1A1AA] uppercase tracking-wider">Archived</span>
                      </div>
                    )}

                  </div>
                </motion.div>
              );
            })}
          </div>
        )}</LoadingTransition>
      </main>

      {/* ========================================================================= */}
      {/* 1. COMPREHENSIVE MEETING WORKSPACE DRAWER (CALENDLY / GOOGLE MEET STYLE)  */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {selectedWorkspaceSession && (() => {
          const isTeacher = selectedWorkspaceSession.teacherId === currentUserId;
          const partnerId = isTeacher ? (selectedWorkspaceSession.learnerId || selectedWorkspaceSession.studentId) : selectedWorkspaceSession.teacherId;
          const partnerProfile = partnerId ? profiles[partnerId] : null;
          const subState = getSessionSubState(selectedWorkspaceSession, currentTime);
          const otherName = isTeacher ? (selectedWorkspaceSession.learnerName || selectedWorkspaceSession.studentName) : selectedWorkspaceSession.teacherName;
          
          const scheduledDate = selectedWorkspaceSession.scheduledTime?.seconds 
            ? new Date(selectedWorkspaceSession.scheduledTime.seconds * 1000) 
            : new Date(selectedWorkspaceSession.scheduledTime);

          const formattedTime = scheduledDate.toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          });

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6 select-none">
              
              {/* Blur backdrop overlay */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedWorkspaceSession(null)}
                className="absolute inset-0 bg-black/60 backdrop-blur-md"
              />

              {/* Worksp              {/* Drawer Container */}
              <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.98 }}
                transition={{ type: "spring", damping: 26, stiffness: 220 }}
                className="relative bg-[#FFFFFF] border border-[#E8E4DB] md:rounded-3xl shadow-2xl w-full max-w-4xl h-full md:h-[85vh] flex flex-col overflow-hidden z-10 text-[#0D0D0F]"
              >
                
                {/* Drawer Top Header info */}
                <div className="px-6 py-4 border-b border-[#E8E4DB] bg-[#F7F4EE] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#0D0D0F] border border-[#1A1A1D] flex items-center justify-center text-[#C9A96E]">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-[#0D0D0F] tracking-tight">
                        {selectedWorkspaceSession.skillName || selectedWorkspaceSession.skill} Workspace
                      </h2>
                      <p className="text-[10px] text-[#71717A] font-mono tracking-wider uppercase mt-0.5">
                        Session #{selectedWorkspaceSession.id.substring(0, 8)}
                      </p>
                    </div>
                  </div>
                  
                  {/* Action buttons on workspace header */}
                  <div className="flex items-center gap-1.5">
                    {selectedWorkspaceSession && !isSessionActivelyLive(selectedWorkspaceSession) && (
                      <button
                        id="workspace-delete-session-btn"
                        type="button"
                        onClick={() => handleRequestDelete(selectedWorkspaceSession)}
                        className="p-1.5 hover:bg-[#FEF2F2] border border-transparent hover:border-[#FCA5A5] rounded-lg text-[#71717A] hover:text-[#DC2626] transition-all cursor-pointer"
                        title="Delete Session"
                      >
                        <Trash2 className="w-4.5 h-4.5" />
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedWorkspaceSession(null)}
                      className="p-1.5 hover:bg-[#E8E4DB] border border-transparent rounded-lg text-[#71717A] hover:text-[#0D0D0F] transition-all cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Main panel Stage workspace content split columns */}
                <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12">
                  
                  {/* Left Column (Session details, stepper, timezone info) */}
                  <div className="lg:col-span-7 p-6 border-r border-[#E8E4DB] flex flex-col gap-5">
                    
                    {/* Stepper progress path */}
                    <div className="p-4 bg-[#F7F4EE] border border-[#E8E4DB] rounded-2xl">
                      <div className="flex items-center justify-between mb-3 px-1">
                        <span className="text-[9px] font-mono font-bold text-[#71717A] tracking-wider uppercase">Lifecycle Pipeline</span>
                        <span className="text-[9px] font-mono text-[#C9A96E] font-bold uppercase">Progress</span>
                      </div>
                      
                      {/* Interactive nodes tracker */}
                      <div className="grid grid-cols-4 text-center relative pt-2">
                        <div className="absolute top-4 left-[12%] right-[12%] h-px bg-[#E8E4DB] z-0" />
                        
                        {([
                          { id: "pending", label: "Requested" },
                          { id: "accepted", label: "Accepted" },
                          { id: "scheduled", label: "Scheduled" },
                          { id: "completed", label: "Completed" }
                        ] as const).map((step, idx) => {
                          const statuses = ["pending", "accepted", "scheduled", "completed"] as const;
                          const currentActiveIdx = activeTab === "completed" ? 3 : statuses.indexOf(subState.status as any);
                          
                          const isDone = idx < currentActiveIdx || activeTab === "completed";
                          const isActive = idx === currentActiveIdx && activeTab !== "completed";
                          
                          return (
                            <div key={step.id} className="flex flex-col items-center gap-1.5 relative z-10">
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 border font-mono text-[9px] font-bold
                                ${isDone 
                                  ? "bg-[#0D0D0F] border-[#0D0D0F] text-[#C9A96E]" 
                                  : isActive 
                                  ? "bg-[#0D0D0F] border-[#C9A96E] text-[#F7F4EE] ring-2 ring-[#C9A96E]/20" 
                                  : "bg-[#FFFFFF] border-[#E8E4DB] text-[#71717A]"}`}
                              >
                                {isDone ? "✓" : idx + 1}
                              </div>
                              <span className={`text-[9px] font-medium tracking-tight
                                ${isActive ? "text-[#0D0D0F] font-semibold" : isDone ? "text-[#0D0D0F]" : "text-[#71717A]"}`}
                              >
                                {step.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Session Partner & Details Card */}
                    <div className="p-5 bg-[#F7F4EE] border border-[#E8E4DB] rounded-2xl flex flex-col gap-4 shadow-2xs">
                      <div className="flex items-center gap-3.5">
                        <div className="w-14 h-14 rounded-2xl overflow-hidden border border-[#E8E4DB] bg-[#FFFFFF] shrink-0">
                          <img 
                            src={partnerProfile?.photoURL || partnerProfile?.photoUrl || DEFAULT_AVATAR} 
                            alt={otherName} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-bold text-[#0D0D0F] truncate">{otherName}</h3>
                            <span className="text-[10px] px-2.5 py-0.5 rounded-full font-medium bg-[#0D0D0F] text-[#C9A96E]">
                              {isTeacher ? "Learner" : "Mentor"}
                            </span>
                          </div>
                          <p className="text-xs text-[#71717A] mt-0.5 truncate">
                            {partnerProfile?.title || partnerProfile?.bio || "SkillSwap Community Member"}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-[#71717A]">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-[#C9A96E]" />
                              {selectedWorkspaceSession.duration || 60} min session
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Dual-Timezone scheduling info */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-[#E8E4DB]">
                        <div className="p-2.5 bg-[#FFFFFF] rounded-xl border border-[#E8E4DB] flex flex-col gap-0.5">
                          <span className="text-[9px] font-mono font-semibold text-[#71717A] uppercase">Your Time</span>
                          <span className="text-xs font-semibold text-[#0D0D0F]">
                            {scheduledDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                          </span>
                          <span className="text-[10px] text-[#71717A]">
                            {scheduledDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <div className="p-2.5 bg-[#FFFFFF] rounded-xl border border-[#E8E4DB] flex flex-col gap-0.5">
                          <span className="text-[9px] font-mono font-semibold text-[#71717A] uppercase">Partner Time</span>
                          <span className="text-xs font-semibold text-[#0D0D0F]">
                            {formatInTimezone(scheduledDate, partnerProfile?.timezone || "")}
                          </span>
                          <span className="text-[10px] text-[#71717A] truncate">
                            {partnerProfile?.timezone || "UTC"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Dynamic Action Area inside Workspace */}
                    <div className="flex flex-col gap-3">
                      
                      {/* If session is active/upcoming and not ended, show Live Swap WebRTC Launch Hero Button */}
                      {activeTab !== "completed" && getNormalizedStatus(selectedWorkspaceSession.status, selectedWorkspaceSession) === "upcoming" && subState.status !== "ended" && !selectedWorkspaceSession.sessionEnded && !selectedWorkspaceSession.isEnded ? (
                        <button
                          id="workspace-join-live-swap-btn"
                          onClick={() => handleJoinLiveSwap(selectedWorkspaceSession)}
                          className="w-full h-12 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] border border-[#C9A96E]/50 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition active:scale-98 cursor-pointer"
                        >
                          <Video className="w-4 h-4 text-[#C9A96E] animate-pulse" />
                          <span>Join Live Swap</span>
                        </button>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="w-full p-3 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-[#C9A96E]" />
                              <span className="text-xs font-bold text-[#0D0D0F]">Session Completed</span>
                            </div>
                            <span className="text-[10px] font-mono text-[#71717A] bg-[#F7F4EE] px-2 py-0.5 rounded-md border border-[#E8E4DB]">
                              Verified
                            </span>
                          </div>

                          <button
                            id="workspace-request-again-btn"
                            onClick={() => {
                              const isTeacher = selectedWorkspaceSession.teacherId === currentUserId;
                              const partnerId = isTeacher ? (selectedWorkspaceSession.learnerId || selectedWorkspaceSession.studentId) : selectedWorkspaceSession.teacherId;
                              setRequestingAnotherSession(selectedWorkspaceSession);
                              setNewSessionSkill(selectedWorkspaceSession.skillName || selectedWorkspaceSession.skill || "");
                              setNewSessionTeachSkill(selectedWorkspaceSession.teachSkill || "");
                              setNewSessionDuration(selectedWorkspaceSession.duration || 30);
                              setNewSessionDateTime("");
                              setNewSessionNotes("");
                              setNewSessionError("");
                              if (partnerId) {
                                fetchProfile(partnerId as string).then(p => {
                                  if (p) setOtherUserProfile(p);
                                });
                              }
                            }}
                            className="w-full h-11 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-md transition active:scale-98 cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-[#C9A96E]" />
                            <span>Request Another Session</span>
                          </button>
                        </div>
                      )}

                      {/* Scheduled Time Banner */}
                      <div className="w-full p-3.5 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl flex items-center justify-between shadow-2xs">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-center text-[#C9A96E]">
                            <Clock className="w-4 h-4" />
                          </div>
                          <div className="text-left">
                            <div className="text-xs font-semibold text-[#0D0D0F]">
                              {getStartsAtLabel(selectedWorkspaceSession.scheduledTime)}
                            </div>
                            <div className="text-[10px] text-[#71717A]">
                              Scheduled swap session
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-[#C9A96E] font-semibold bg-[#F7F4EE] px-2.5 py-1 rounded-lg border border-[#E8E4DB]">
                          {activeTab === "completed" || subState.status === "ended" ? "Completed" : (subState.countdownText || "Upcoming")}
                        </span>
                      </div>

                    </div>

                  </div>

                  {/* Right Column (Notes, Feedback tabs, live review workspace, goals list) */}
                  <div className="lg:col-span-5 bg-[#F7F4EE]/60 p-6 flex flex-col gap-5">
                    
                    {/* Workspace mini-navigation tabs */}
                    <div className="flex bg-[#FFFFFF] border border-[#E8E4DB] rounded-xl p-1 select-none shadow-2xs">
                      {[
                        { id: "notes", label: "Agenda & Notes" },
                        { id: "review", label: "Review & Rate" },
                        { id: "chat", label: "Messages" }
                      ].map((tab) => {
                        const isSel = workspaceActiveTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            onClick={() => setWorkspaceActiveTab(tab.id as any)}
                            className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                              isSel ? "bg-[#0D0D0F] text-[#F7F4EE] shadow-xs" : "text-[#71717A] hover:text-[#0D0D0F]"
                            }`}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Tab panels switcher */}
                    <div className="flex-1 flex flex-col">
                      <AnimatePresence mode="wait">
                        
                        {workspaceActiveTab === "notes" && (
                          <motion.div
                            key="notes-panel"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            className="flex flex-col gap-4 flex-1"
                          >
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wider px-1">Session Agenda</label>
                              <div className="p-3.5 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl flex flex-col gap-2 shadow-2xs">
                                <div className="flex items-center gap-2.5 text-xs text-[#0D0D0F] font-medium">
                                  <div className="w-4 h-4 rounded border border-[#E8E4DB] bg-[#F7F4EE] flex items-center justify-center text-[10px] text-[#C9A96E] font-mono">1</div>
                                  <span>Establish core learning objectives (5m)</span>
                                </div>
                                <div className="flex items-center gap-2.5 text-xs text-[#0D0D0F] font-medium border-t border-[#E8E4DB] pt-2">
                                  <div className="w-4 h-4 rounded border border-[#E8E4DB] bg-[#F7F4EE] flex items-center justify-center text-[10px] text-[#C9A96E] font-mono">2</div>
                                  <span>Demonstrate framework logic/live session (25m)</span>
                                </div>
                                <div className="flex items-center gap-2.5 text-xs text-[#0D0D0F] font-medium border-t border-[#E8E4DB] pt-2">
                                  <div className="w-4 h-4 rounded border border-[#E8E4DB] bg-[#F7F4EE] flex items-center justify-center text-[10px] text-[#C9A96E] font-mono">3</div>
                                  <span>Peer code review / milestone checking (15m)</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex-1 flex flex-col gap-1.5">
                              <label className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wider px-1">Session Notes</label>
                              <textarea
                                value={workspaceNotes}
                                onChange={(e) => setWorkspaceNotes(e.target.value)}
                                placeholder="Jot down active links, concepts, or steps shared during the call..."
                                className="w-full flex-1 min-h-[160px] p-3.5 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl text-xs text-[#0D0D0F] focus:outline-none focus:border-[#0D0D0F] resize-none leading-relaxed placeholder-[#A1A1AA] shadow-2xs"
                              />
                            </div>
                          </motion.div>
                        )}

                        {workspaceActiveTab === "review" && (
                          <motion.div
                            key="review-panel"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            className="flex flex-col gap-4 flex-1 justify-between"
                          >
                            <div className="flex flex-col gap-3.5">
                              <div className="p-3.5 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl flex items-start gap-2.5 shadow-2xs">
                                <Award className="w-5 h-5 text-[#C9A96E] shrink-0 mt-0.5" />
                                <div className="flex-1">
                                  <h4 className="text-xs font-semibold text-[#0D0D0F]">Verified Exchange</h4>
                                  <p className="text-[11px] text-[#71717A] leading-normal mt-0.5">
                                    Completing this swap finalizes the knowledge exchange and issues a verified digital certificate.
                                  </p>
                                </div>
                              </div>

                              {reviewError && (
                                <div className="p-3 bg-[#FFFFFF] border border-red-300 rounded-xl text-xs text-red-700">
                                  {reviewError}
                                </div>
                              )}

                              <div className="flex flex-col gap-1.5 items-center bg-[#FFFFFF] p-4 rounded-2xl border border-[#E8E4DB] shadow-2xs">
                                <span className="text-xs font-semibold text-[#0D0D0F]">Rate Your Swap Partner</span>
                                <div className="flex gap-2 mt-1.5">
                                  {[1, 2, 3, 4, 5].map((starValue) => (
                                    <button
                                      id={`star-btn-${starValue}`}
                                      key={starValue}
                                      type="button"
                                      onClick={() => setRating(starValue)}
                                      className="p-1 cursor-pointer transition transform active:scale-90"
                                    >
                                      <Star
                                        className={`w-6 h-6 transition-all ${
                                          starValue <= rating ? "text-[#C9A96E] fill-[#C9A96E]" : "text-[#E8E4DB]"
                                        }`}
                                      />
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wider px-1">Feedback</label>
                                <textarea
                                  id="review-comment-textarea"
                                  rows={4}
                                  maxLength={150}
                                  placeholder="Provide feedback on the knowledge exchange..."
                                  value={comment}
                                  onChange={(e) => setComment(e.target.value)}
                                  className="w-full p-3.5 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl text-xs text-[#0D0D0F] focus:outline-none focus:border-[#0D0D0F] resize-none leading-relaxed placeholder-[#A1A1AA] shadow-2xs"
                                  required
                                />
                              </div>
                            </div>

                            <button
                              id="submit-review-form-btn"
                              onClick={() => handleSubmitReview()}
                              disabled={submittingReview}
                              className="w-full h-11 bg-[#0D0D0F] text-[#F7F4EE] hover:bg-[#1A1A1D] rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition active:scale-98 disabled:opacity-50 cursor-pointer shadow-2xs mt-3"
                            >
                              <span>{submittingReview ? "Processing..." : "Complete & Verify"}</span>
                            </button>
                          </motion.div>
                        )}

                        {workspaceActiveTab === "chat" && (
                          <motion.div
                            key="chat-panel"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            className="flex flex-col gap-3 flex-1 items-center justify-center text-center p-6 bg-[#FFFFFF] rounded-2xl border border-[#E8E4DB] shadow-2xs"
                          >
                            <div className="w-10 h-10 rounded-full bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-center">
                              <MessageSquare className="w-5 h-5 text-[#C9A96E]" />
                            </div>
                            <h4 className="text-xs font-semibold text-[#0D0D0F]">Direct Messages</h4>
                            <p className="text-[11px] text-[#71717A] max-w-xs leading-relaxed">
                              Coordinate notes, repository links, or scheduling details directly with {otherName}.
                            </p>
                            
                            <a
                              href="#chats"
                              onClick={() => {
                                setSelectedWorkspaceSession(null);
                                window.location.hash = "chats";
                              }}
                              className="h-9 px-4 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] rounded-xl font-medium text-xs flex items-center gap-1.5 transition mt-2 shadow-2xs"
                            >
                              <span>Open Chat</span>
                            </a>
                          </motion.div>
                        )}

                      </AnimatePresence>
                    </div>

                    {/* Session time display */}
                    <div className="p-3.5 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl text-[11px] text-[#71717A] flex flex-col gap-1.5 shadow-2xs">
                      <div className="flex justify-between items-center">
                        <span className="text-[#71717A]">Scheduled:</span>
                        <span className="text-[#0D0D0F] font-semibold">
                          {scheduledDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                    </div>

                  </div>

                </div>

              </motion.div>

            </div>
          );
        })()}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* 2. CANCELLATION & DECLINE PREMIUM BOTTOM SHEET                           */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {cancellingSession && (() => {
          const isTeacher = cancellingSession.teacherId === currentUserId;
          const partnerId = isTeacher ? (cancellingSession.learnerId || cancellingSession.studentId) : cancellingSession.teacherId;
          const partnerProfile = partnerId ? profiles[partnerId] : null;
          const otherName = isTeacher ? (cancellingSession.learnerName || cancellingSession.studentName) : cancellingSession.teacherName;
          const isSender = cancellingSession.senderId === currentUserId || cancellingSession.studentId === currentUserId || cancellingSession.learnerId === currentUserId;
          const isReceiver = cancellingSession.receiverId === currentUserId || (!isSender && cancellingSession.teacherId === currentUserId);
          const isPending = cancellingSession.status === "requested" || cancellingSession.status === "Pending";
          
          const title = isPending
            ? (isSender ? "Cancel Swap Request" : "Decline Swap Request")
            : "Cancel Confirmed Session";
            
          const description = isPending
            ? (isSender 
                ? `Cancel your swap request with ${otherName} for ${cancellingSession.skillName || cancellingSession.skill}.` 
                : `Optionally provide a reason to ${otherName} for declining this swap.`)
            : `Cancel your confirmed session with ${otherName} for ${cancellingSession.skillName || cancellingSession.skill}.`;

          const primaryBtnLabel = isPending
            ? (isSender ? (cancellingLoading ? "Cancelling..." : "Cancel Request") : (cancellingLoading ? "Declining..." : "Decline Swap"))
            : (cancellingLoading ? "Cancelling..." : "Cancel Booking");

          const secondaryBtnLabel = isPending
            ? (isSender ? "Keep Request" : "Go Back")
            : "Keep Booking";

          const reasonChips = ["Busy today", "Schedule conflict", "Topic mismatch", "Other"];

          const handlePrimaryActionClick = (e: React.FormEvent) => {
            e.preventDefault();
            let finalReason = cancelReason.trim();
            if (isPending && isSender && !finalReason) {
              setCancelReason("Cancelled by requester");
            }
            
            setTimeout(() => {
              handleCancelSubmit(e);
            }, 50);
          };

          return (
            <div className="fixed inset-0 z-[150] overflow-hidden select-none">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (!cancellingLoading) {
                    setCancellingSession(null);
                    setCancelReason("");
                  }
                }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-pointer"
              />

              {/* Bottom Sheet Modal Container */}
              <div className="absolute inset-x-0 bottom-0 flex justify-center p-4">
                <motion.div
                  initial={{ y: "100%", opacity: 0.5 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: "100%", opacity: 0.5 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="w-full max-w-md bg-[#FFFFFF] border border-[#E8E4DB] rounded-3xl shadow-2xl p-5 sm:p-6 pb-8 flex flex-col gap-4 relative text-[#0D0D0F]"
                >
                  {/* Swipe handle */}
                  <div 
                    onClick={() => {
                      if (!cancellingLoading) {
                        setCancellingSession(null);
                        setCancelReason("");
                      }
                    }}
                    className="w-10 h-1 bg-[#E8E4DB] rounded-full mx-auto -mt-1 mb-1 cursor-pointer hover:bg-[#D0C9BD] transition" 
                  />

                  {/* Header Title & Desc */}
                  <div className="flex flex-col gap-1 text-center">
                    <h3 className="font-bold text-base text-[#0D0D0F]">{title}</h3>
                    <p className="text-xs text-[#71717A] leading-relaxed max-w-[320px] mx-auto">
                      {description}
                    </p>
                  </div>

                  {/* Partner Detail Card */}
                  <div className="flex items-center gap-3 bg-[#F7F4EE] border border-[#E8E4DB] p-3.5 rounded-2xl">
                    <div className="w-10 h-10 rounded-full overflow-hidden border border-[#E8E4DB] shrink-0 select-none bg-[#FFFFFF]">
                      <img 
                        src={partnerProfile?.profilePhotoUrl || partnerProfile?.photoUrl || DEFAULT_AVATAR} 
                        alt={otherName} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#0D0D0F] truncate">{otherName}</p>
                      <p className="text-[11px] text-[#71717A] truncate font-medium">{cancellingSession.skillName || cancellingSession.skill}</p>
                    </div>
                  </div>

                  {/* Custom Form */}
                  <form onSubmit={handleCancelSubmit} className="flex flex-col gap-3.5">
                    {(!isPending || isReceiver) && (
                      <div className="flex flex-col gap-2.5">
                        {/* Reason chips */}
                        <div className="flex flex-wrap gap-1.5">
                          {reasonChips.map((chip) => (
                            <button
                              key={chip}
                              type="button"
                              onClick={() => {
                                if (cancelReason.includes(chip)) return;
                                const prefix = cancelReason.trim() ? `${cancelReason.trim()}, ` : "";
                                setCancelReason((prefix + chip).substring(0, 150));
                              }}
                              className="px-3 py-1 bg-[#F7F4EE] hover:bg-[#E8E4DB] text-[#0D0D0F] rounded-full text-xs font-medium border border-[#E8E4DB] cursor-pointer active:scale-95 transition"
                            >
                              {chip}
                            </button>
                          ))}
                        </div>

                        {/* Reason Input Textarea */}
                        <div className="flex flex-col gap-1">
                          <textarea
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value.substring(0, 150))}
                            placeholder="Reason for declining or cancelling..."
                            className="w-full h-20 p-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-xs text-[#0D0D0F] placeholder-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F] resize-none leading-relaxed transition"
                            maxLength={150}
                            required={!isPending || isReceiver}
                          />
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-col gap-2 mt-1">
                      <button
                        type="submit"
                        disabled={cancellingLoading || ((!isPending || isReceiver) && !cancelReason.trim())}
                        onClick={handlePrimaryActionClick}
                        className="w-full h-11 bg-[#0D0D0F] hover:bg-[#1A1A1D] disabled:bg-[#F2EFE8] disabled:text-[#A1A1AA] text-[#F7F4EE] font-medium text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-2 shadow-2xs"
                      >
                        {cancellingLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F7F4EE]" />}
                        <span>{primaryBtnLabel}</span>
                      </button>

                      <button
                        type="button"
                        disabled={cancellingLoading}
                        onClick={() => {
                          setCancellingSession(null);
                          setCancelReason("");
                        }}
                        className="w-full h-11 bg-[#FFFFFF] hover:bg-[#F2EFE8] disabled:opacity-30 text-[#71717A] hover:text-[#0D0D0F] font-medium text-xs rounded-xl transition cursor-pointer flex items-center justify-center border border-[#E8E4DB]"
                      >
                        {secondaryBtnLabel}
                      </button>
                    </div>
                  </form>

                </motion.div>
              </div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* 3. RESCHEDULING MODAL OVERLAY                                            */}
      {/* ========================================================================= */}
      {reschedulingSession && (() => {
        const now = new Date();
        const formatDateTimeLocal = (date: Date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          const hours = String(date.getHours()).padStart(2, "0");
          const minutes = String(date.getMinutes()).padStart(2, "0");
          return `${year}-${month}-${day}T${hours}:${minutes}`;
        };
        const minDateTime = roundToNearest15(formatDateTimeLocal(now));
        const selectedDateObject = rescheduleDateTime ? new Date(rescheduleDateTime) : null;

        return (
          <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 font-sans overflow-y-auto pb-20 sm:pb-6">
            <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-3xl p-5 sm:p-6 w-full max-w-sm flex flex-col gap-4 shadow-2xl animate-scale-up text-[#0D0D0F] my-auto">
              <div className="flex justify-between items-center border-b border-[#E8E4DB] pb-3">
                <div>
                  <h3 className="font-bold text-base text-[#0D0D0F]">Reschedule Session</h3>
                  <span className="text-[10px] text-[#71717A]">Choose a new date and time slot</span>
                </div>
                <button
                  onClick={() => setReschedulingSession(null)}
                  className="text-[#71717A] hover:text-[#0D0D0F] transition p-1 rounded-lg hover:bg-[#F2EFE8] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {rescheduleError && (
                <div className="p-3 bg-[#FFFFFF] border border-red-300 rounded-xl text-xs text-red-700">
                  {rescheduleError}
                </div>
              )}

              <form onSubmit={handleRescheduleSubmit} className="flex flex-col gap-3.5">
                {(() => {
                  const now = new Date();
                  const todayStr = getLocalDateString(now);
                  
                  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                  const tomorrowStr = getLocalDateString(tomorrow);

                  const curDateStr = rescheduleDateTime ? rescheduleDateTime.split("T")[0] : tomorrowStr;
                  const curTimeStr = rescheduleDateTime && rescheduleDateTime.includes("T") ? rescheduleDateTime.split("T")[1] : "10:00";
                  const isSelectedDateToday = curDateStr === todayStr;

                  const updateRescheduleDateTime = (d: string, t: string) => {
                    setRescheduleError("");
                    setRescheduleDateTime(`${d}T${t}`);
                  };

                  const timePresets = [
                    { label: "09:00 AM", value: "09:00" },
                    { label: "11:00 AM", value: "11:00" },
                    { label: "02:00 PM", value: "14:00" },
                    { label: "04:00 PM", value: "16:00" },
                    { label: "06:00 PM", value: "18:00" },
                    { label: "08:00 PM", value: "20:00" },
                  ];

                  const isCurrentChoicePast = isPastDateTime(curDateStr, curTimeStr, now);

                  return (
                    <div className="flex flex-col gap-3">
                      {/* Date selection with quick presets */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-[#71717A] flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-[#C9A96E]" /> Date:
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (isPastTimeSlot(todayStr, curTimeStr, now)) {
                                const nextSlot = timePresets.find(p => !isPastTimeSlot(todayStr, p.value, now));
                                const fallbackTime = nextSlot ? nextSlot.value : getLocalTimeString(new Date(now.getTime() + 30 * 60 * 1000));
                                updateRescheduleDateTime(todayStr, fallbackTime);
                              } else {
                                updateRescheduleDateTime(todayStr, curTimeStr);
                              }
                            }}
                            className={`py-1.5 px-2 rounded-xl border text-xs font-medium transition cursor-pointer ${
                              curDateStr === todayStr
                                ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE]"
                                : "border-[#E8E4DB] bg-[#F7F4EE] text-[#71717A] hover:text-[#0D0D0F]"
                            }`}
                          >
                            Today
                          </button>
                          <button
                            type="button"
                            onClick={() => updateRescheduleDateTime(tomorrowStr, curTimeStr)}
                            className={`py-1.5 px-2 rounded-xl border text-xs font-medium transition cursor-pointer ${
                              curDateStr === tomorrowStr
                                ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE]"
                                : "border-[#E8E4DB] bg-[#F7F4EE] text-[#71717A] hover:text-[#0D0D0F]"
                            }`}
                          >
                            Tomorrow
                          </button>
                        </div>
                        <input
                          type="date"
                          value={curDateStr}
                          min={todayStr}
                          onChange={(e) => {
                            const newDate = e.target.value;
                            if (newDate === todayStr && isPastTimeSlot(newDate, curTimeStr, now)) {
                              const nextSlot = timePresets.find(p => !isPastTimeSlot(newDate, p.value, now));
                              const fallbackTime = nextSlot ? nextSlot.value : getLocalTimeString(new Date(now.getTime() + 30 * 60 * 1000));
                              updateRescheduleDateTime(newDate, fallbackTime);
                            } else {
                              updateRescheduleDateTime(newDate, curTimeStr);
                            }
                          }}
                          className="w-full h-10 px-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-xs text-[#0D0D0F] focus:outline-none focus:border-[#0D0D0F]"
                          required
                        />
                      </div>

                      {/* Time selection with quick presets */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-medium text-[#71717A] flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-[#C9A96E]" /> Time Slot:
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {timePresets.map((preset) => {
                            const isPast = isPastTimeSlot(curDateStr, preset.value, now);
                            const isSelected = curTimeStr === preset.value && !isPast;
                            return (
                              <button
                                key={preset.value}
                                type="button"
                                disabled={isPast}
                                onClick={() => {
                                  if (!isPast) {
                                    updateRescheduleDateTime(curDateStr, preset.value);
                                  }
                                }}
                                title={isPast ? "This time slot has already passed today" : undefined}
                                className={`py-1.5 px-1.5 rounded-xl border text-[11px] transition ${
                                  isPast
                                    ? "opacity-35 bg-[#E8E4DB] border-[#E8E4DB] text-[#A1A1AA] cursor-not-allowed line-through"
                                    : isSelected
                                    ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE] font-medium cursor-pointer"
                                    : "border-[#E8E4DB] bg-[#F7F4EE] text-[#71717A] hover:text-[#0D0D0F] cursor-pointer"
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-[#71717A] shrink-0">Custom:</span>
                          <input
                            type="time"
                            value={curTimeStr}
                            min={isSelectedDateToday ? getLocalTimeString(now) : undefined}
                            onChange={(e) => updateRescheduleDateTime(curDateStr, e.target.value)}
                            className={`flex-1 h-9 px-3 bg-[#F7F4EE] border rounded-xl text-xs text-[#0D0D0F] focus:outline-none ${
                              isCurrentChoicePast ? "border-amber-400 bg-amber-50/40" : "border-[#E8E4DB] focus:border-[#0D0D0F]"
                            }`}
                            required
                          />
                        </div>

                        {isCurrentChoicePast && (
                          <div className="p-2 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 flex items-center gap-1.5 animate-fade-in">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>Please select a future time.</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {selectedDateObject && (
                  <div className="p-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl flex flex-col gap-1 text-xs">
                    <span className="text-[#71717A]">New Time Slot:</span>
                    <span className="text-[#0D0D0F] font-semibold">
                      {selectedDateObject.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                )}

                <div className="flex justify-end gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setReschedulingSession(null)}
                    className="h-10 px-4 bg-[#FFFFFF] hover:bg-[#F2EFE8] border border-[#E8E4DB] rounded-xl text-[#71717A] hover:text-[#0D0D0F] text-xs font-medium transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={rescheduleLoading || !rescheduleDateTime}
                    className="h-10 px-5 bg-[#0D0D0F] text-[#F7F4EE] hover:bg-[#1A1A1D] font-medium rounded-xl text-xs transition disabled:opacity-50 cursor-pointer shadow-2xs"
                  >
                    {rescheduleLoading ? "Saving..." : "Confirm Schedule"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* 4. VERIFIED SWAP CERTIFICATE MODAL (IMMUTABLE RECORD)                     */}
      {/* ========================================================================= */}
      {activeCertificate && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-3xl p-6 w-full max-w-md flex flex-col gap-5 shadow-2xl relative overflow-hidden animate-scale-up text-[#0D0D0F]">
            
            <div className="flex justify-between items-center border-b border-[#E8E4DB] pb-3 relative z-10">
              <span className="text-[10px] font-mono text-[#C9A96E] tracking-widest font-bold uppercase">Verified Certificate</span>
              <button
                onClick={() => setActiveCertificate(null)}
                className="text-[#71717A] hover:text-[#0D0D0F] transition p-1.5 rounded-lg hover:bg-[#F2EFE8] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="border border-[#E8E4DB] p-5 rounded-2xl bg-[#F7F4EE] text-center relative z-10 flex flex-col items-center gap-4">
              
              <div className="w-14 h-14 rounded-full bg-[#0D0D0F] border border-[#C9A96E] flex items-center justify-center text-[#C9A96E] shadow-xs select-none">
                <Award className="w-7 h-7" />
              </div>

              <div className="flex flex-col gap-0.5 select-none">
                <h2 className="font-sans font-bold text-xs text-[#0D0D0F] tracking-widest uppercase">SwapSkill Certificate</h2>
                <p className="text-[10px] text-[#71717A]">Knowledge Exchange Verification</p>
              </div>

              <div className="w-2/3 h-px bg-[#E8E4DB]" />

              <div className="flex flex-col gap-2.5 w-full">
                <p className="text-[11px] text-[#71717A] leading-normal select-none">
                  Verified peer-to-peer knowledge exchange successfully completed between:
                </p>

                <div className="bg-[#FFFFFF] p-3.5 rounded-xl border border-[#E8E4DB] flex flex-col gap-2 text-left shadow-2xs">
                  <div>
                    <span className="text-[9px] text-[#71717A] font-mono uppercase block">Mentor</span>
                    <span className="text-xs font-bold text-[#0D0D0F]">{activeCertificate.teacherName}</span>
                    <span className="text-[11px] text-[#C9A96E] font-medium block mt-0.5">✦ {activeCertificate.skillName || activeCertificate.skill}</span>
                  </div>
                  
                  <div className="h-px bg-[#E8E4DB]" />

                  <div>
                    <span className="text-[9px] text-[#71717A] font-mono uppercase block">Learner</span>
                    <span className="text-xs font-bold text-[#0D0D0F]">{activeCertificate.learnerName || activeCertificate.studentName}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-[#71717A] pt-1 select-none">
                  <div className="text-left">
                    <span className="text-[#A1A1AA] block text-[9px] uppercase">Date</span>
                    <span className="text-[#0D0D0F] font-semibold">
                      {new Date(activeCertificate.scheduledTime?.seconds ? activeCertificate.scheduledTime.seconds * 1000 : activeCertificate.scheduledTime).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[#A1A1AA] block text-[9px] uppercase">Duration</span>
                    <span className="text-[#0D0D0F] font-semibold">{activeCertificate.duration || 60} Minutes</span>
                  </div>
                </div>
              </div>

              <div className="w-full h-px bg-[#E8E4DB]" />

              <div className="w-full p-2.5 bg-[#FFFFFF] border border-[#E8E4DB] rounded-xl flex items-center justify-between text-left shadow-2xs">
                <div className="flex flex-col gap-0.5 max-w-[190px]">
                  <span className="text-[8px] font-mono font-bold text-[#C9A96E] uppercase tracking-wider">Session ID</span>
                  <span className="text-[10px] font-mono text-[#71717A] truncate block">{activeCertificate.id}</span>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(activeCertificate.id);
                    setShowCertSuccessCopy(true);
                    setTimeout(() => setShowCertSuccessCopy(false), 2000);
                  }}
                  className="px-2.5 py-1.5 bg-[#F7F4EE] border border-[#E8E4DB] hover:bg-[#E8E4DB] text-[10px] text-[#0D0D0F] rounded-lg transition font-medium cursor-pointer"
                >
                  {showCertSuccessCopy ? "Copied! ✓" : "Copy ID"}
                </button>
              </div>

            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`Verified SwapSkill Peer Exchange certificate: Protocol ID ${activeCertificate.id} concludes completed exchange of ${activeCertificate.skillName || activeCertificate.skill}!`);
                  setShowCertSuccessCopy(true);
                  setTimeout(() => setShowCertSuccessCopy(false), 2000);
                }}
                className="flex-1 h-10 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] rounded-xl font-medium text-xs transition active:scale-98 cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
              >
                {showCertSuccessCopy ? "Copied Share Details! ✓" : "Share Certificate"}
              </button>
              <button
                onClick={() => setActiveCertificate(null)}
                className="h-10 px-4 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#71717A] hover:text-[#0D0D0F] rounded-xl text-xs font-medium transition cursor-pointer"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. REQUEST ANOTHER SESSION MODAL (NEW UNIQUE SESSION ID & ROOM)           */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {requestingAnotherSession && (() => {
          const isTeacher = requestingAnotherSession.teacherId === currentUserId;
          const partnerId = isTeacher 
            ? (requestingAnotherSession.learnerId || requestingAnotherSession.studentId)
            : requestingAnotherSession.teacherId;
          const partnerName = isTeacher
            ? (requestingAnotherSession.learnerName || requestingAnotherSession.studentName || profiles[partnerId || ""]?.fullName || "Partner")
            : (requestingAnotherSession.teacherName || profiles[partnerId || ""]?.fullName || "Partner");
          const partnerPhoto = profiles[partnerId || ""]?.photoURL || profiles[partnerId || ""]?.photoUrl || DEFAULT_AVATAR;

          const now = new Date();
          const todayStr = getLocalDateString(now);
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          const tomorrowStr = getLocalDateString(tomorrow);

          const [curDateStr, curTimeStr] = newSessionDateTime.includes("T")
            ? newSessionDateTime.split("T")
            : [tomorrowStr, "14:00"];

          const updateNewSessionDateTime = (dStr: string, tStr: string) => {
            setNewSessionDateTime(`${dStr}T${tStr}`);
            setNewSessionError("");
          };

          const timePresets = [
            { label: "09:00 AM", value: "09:00" },
            { label: "11:00 AM", value: "11:00" },
            { label: "02:00 PM", value: "14:00" },
            { label: "04:00 PM", value: "16:00" },
            { label: "06:00 PM", value: "18:00" },
            { label: "08:00 PM", value: "20:00" },
          ];

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (!newSessionLoading) {
                    setRequestingAnotherSession(null);
                    setNewSessionError("");
                  }
                }}
                className="absolute inset-0 bg-black/60 backdrop-blur-xs"
              />

              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                className="relative w-full max-w-md bg-[#FFFFFF] rounded-3xl p-6 border border-[#E8E4DB] shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-[#E8E4DB]">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-center text-[#C9A96E]">
                      <RefreshCw className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[#0D0D0F]">Request Another Session</h3>
                      <p className="text-[11px] text-[#71717A]">Schedule a new live skill swap</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!newSessionLoading) {
                        setRequestingAnotherSession(null);
                        setNewSessionError("");
                      }
                    }}
                    className="p-1 rounded-lg text-[#71717A] hover:text-[#0D0D0F] hover:bg-[#F7F4EE] transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Partner Info Summary */}
                <div className="p-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-2xl flex items-center gap-3">
                  <img
                    src={partnerPhoto}
                    alt={partnerName}
                    className="w-11 h-11 rounded-full object-cover border border-[#C9A96E]/50"
                    referrerPolicy="no-referrer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[#0D0D0F] truncate">{partnerName}</div>
                    <div className="text-[11px] text-[#71717A] truncate">{otherUserProfile?.title || "Swap Partner"}</div>
                  </div>
                  <span className="text-[10px] font-mono text-[#C9A96E] bg-[#FFFFFF] px-2 py-0.5 rounded-full border border-[#E8E4DB]">
                    New Session
                  </span>
                </div>

                <form onSubmit={handleRequestAnotherSessionSubmit} className="flex flex-col gap-4">
                  
                  {/* Skill / Topic to Learn */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                      Skill to Learn / Practice:
                    </label>
                    <input
                      type="text"
                      value={newSessionSkill}
                      onChange={(e) => setNewSessionSkill(e.target.value)}
                      placeholder="e.g., Advanced React, Spanish Conversation"
                      className="w-full h-10 px-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-xs text-[#0D0D0F] focus:outline-hidden focus:border-[#C9A96E] focus:bg-[#FFFFFF] transition"
                      required
                    />
                  </div>

                  {/* Date Selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-[#C9A96E]" /> Select Date:
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (isPastTimeSlot(todayStr, curTimeStr, now)) {
                            const nextSlot = timePresets.find(p => !isPastTimeSlot(todayStr, p.value, now));
                            const fallbackTime = nextSlot ? nextSlot.value : getLocalTimeString(new Date(now.getTime() + 30 * 60 * 1000));
                            updateNewSessionDateTime(todayStr, fallbackTime);
                          } else {
                            updateNewSessionDateTime(todayStr, curTimeStr);
                          }
                        }}
                        className={`py-1.5 px-2 rounded-xl border text-xs font-medium transition cursor-pointer ${
                          curDateStr === todayStr
                            ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE]"
                            : "border-[#E8E4DB] bg-[#F7F4EE] text-[#71717A] hover:text-[#0D0D0F]"
                        }`}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        onClick={() => updateNewSessionDateTime(tomorrowStr, curTimeStr)}
                        className={`py-1.5 px-2 rounded-xl border text-xs font-medium transition cursor-pointer ${
                          curDateStr === tomorrowStr
                            ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE]"
                            : "border-[#E8E4DB] bg-[#F7F4EE] text-[#71717A] hover:text-[#0D0D0F]"
                        }`}
                      >
                        Tomorrow
                      </button>
                    </div>
                    <input
                      type="date"
                      value={curDateStr}
                      min={todayStr}
                      onChange={(e) => {
                        const newDate = e.target.value;
                        if (newDate === todayStr && isPastTimeSlot(newDate, curTimeStr, now)) {
                          const nextSlot = timePresets.find(p => !isPastTimeSlot(newDate, p.value, now));
                          const fallbackTime = nextSlot ? nextSlot.value : getLocalTimeString(new Date(now.getTime() + 30 * 60 * 1000));
                          updateNewSessionDateTime(newDate, fallbackTime);
                        } else {
                          updateNewSessionDateTime(newDate, curTimeStr);
                        }
                      }}
                      className="w-full h-10 px-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-xs text-[#0D0D0F] focus:outline-hidden focus:border-[#C9A96E] focus:bg-[#FFFFFF] transition"
                      required
                    />
                  </div>

                  {/* Time Slot Selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-[#C9A96E]" /> Select Time:
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {timePresets.map((preset) => {
                        const isPast = isPastTimeSlot(curDateStr, preset.value, now);
                        const isSelected = curTimeStr === preset.value && !isPast;
                        return (
                          <button
                            key={preset.value}
                            type="button"
                            disabled={isPast}
                            onClick={() => {
                              if (!isPast) {
                                updateNewSessionDateTime(curDateStr, preset.value);
                              }
                            }}
                            className={`py-1.5 px-1.5 rounded-xl border text-[11px] transition ${
                              isPast
                                ? "opacity-35 bg-[#E8E4DB] border-[#E8E4DB] text-[#A1A1AA] cursor-not-allowed line-through"
                                : isSelected
                                ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE] font-medium cursor-pointer"
                                : "border-[#E8E4DB] bg-[#F7F4EE] text-[#71717A] hover:text-[#0D0D0F] cursor-pointer"
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="time"
                      value={curTimeStr}
                      onChange={(e) => updateNewSessionDateTime(curDateStr, e.target.value)}
                      className="w-full h-10 px-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-xs text-[#0D0D0F] focus:outline-hidden focus:border-[#C9A96E] focus:bg-[#FFFFFF] transition"
                      required
                    />
                  </div>

                  {/* Duration selector */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                      Session Duration:
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[30, 45, 60, 90].map((dur) => (
                        <button
                          key={dur}
                          type="button"
                          onClick={() => setNewSessionDuration(dur)}
                          className={`py-2 px-1 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                            newSessionDuration === dur
                              ? "bg-[#0D0D0F] text-[#F7F4EE] border-[#0D0D0F] shadow-xs"
                              : "bg-[#F7F4EE] text-[#71717A] border-[#E8E4DB] hover:text-[#0D0D0F]"
                          }`}
                        >
                          {dur} min
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Optional message / goals */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                      Message / Goals (optional):
                    </label>
                    <textarea
                      value={newSessionNotes}
                      onChange={(e) => setNewSessionNotes(e.target.value)}
                      placeholder="What would you like to cover in this session?"
                      rows={2}
                      maxLength={400}
                      className="w-full px-3 py-2 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-xs text-[#0D0D0F] placeholder-[#A1A1AA] focus:outline-hidden focus:border-[#C9A96E] focus:bg-[#FFFFFF] transition resize-none"
                    />
                  </div>

                  {newSessionError && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{newSessionError}</span>
                    </div>
                  )}

                  {newSessionSuccess && (
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>Session request sent successfully!</span>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={newSessionLoading || newSessionSuccess}
                      className="flex-1 h-11 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] rounded-xl font-bold text-xs transition active:scale-98 cursor-pointer flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
                    >
                      {newSessionLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Sending Request...</span>
                        </>
                      ) : newSessionSuccess ? (
                        <>
                          <Check className="w-4 h-4 text-[#C9A96E]" />
                          <span>Requested!</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5 text-[#C9A96E]" />
                          <span>Send Session Request</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!newSessionLoading) {
                          setRequestingAnotherSession(null);
                          setNewSessionError("");
                        }
                      }}
                      className="h-11 px-4 bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] text-[#71717A] hover:text-[#0D0D0F] rounded-xl text-xs font-medium transition cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>

                </form>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* LiveKit Cloud Realtime Media Live Swap Modal (Accepted Swap Sessions ONLY) */}
      {activeLiveSwapSession && (
        (() => {
          const { session, isCaller, incomingCallId } = activeLiveSwapSession;
          const isTeacher = session.teacherId === currentUserId;
          const partnerUid = isTeacher ? (session.learnerId || session.studentId) : session.teacherId;
          const partnerName = isTeacher
            ? (session.learnerName || session.studentName || profiles[partnerUid || ""]?.fullName || "Swap Partner")
            : (session.teacherName || profiles[partnerUid || ""]?.fullName || "Swap Partner");
          const partnerPhoto = isTeacher
            ? (session.learnerPhoto || session.studentPhoto || profiles[partnerUid || ""]?.photoURL || DEFAULT_AVATAR)
            : (session.teacherPhoto || profiles[partnerUid || ""]?.photoURL || DEFAULT_AVATAR);
          const currentUserName = currentUserProfile?.fullName || currentUserProfile?.displayName || auth.currentUser?.displayName || "You";
          const currentUserPhoto = currentUserProfile?.photoURL || currentUserProfile?.photoUrl || auth.currentUser?.photoURL || DEFAULT_AVATAR;

          return (
            <LiveSwapCallModal
              isOpen={true}
              onClose={() => {
                if (session?.id) {
                  handleDismissAlert(session.id);
                }
                setActiveLiveSwapSession(null);
              }}
              partnerName={partnerName}
              partnerPhoto={partnerPhoto}
              partnerUid={partnerUid || ""}
              sessionId={session.id}
              skillName={session.skillName || session.skill}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentUserPhoto={currentUserPhoto}
              sessionDuration={session.duration || 30}
              scheduledTime={session.scheduledTime}
              sessionEndTime={session.sessionEndTime}
              onSessionCompleted={(completedSessionId) => {
                console.log("[SessionsView] Session completed callback received:", completedSessionId);
                handleDismissAlert(completedSessionId || session.id);
                setActiveLiveSwapSession(null);
                setActiveTab("completed");
              }}
              isCaller={isCaller}
              incomingCallId={incomingCallId}
              initialCallType="video"
            />
          );
        })()
      )}

      {/* ========================================================================= */}
      {/* SOFT DELETE SESSION CONFIRMATION MODAL                                    */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {sessionToDelete && (() => {
          const isTeacher = sessionToDelete.teacherId === currentUserId;
          const partnerId = isTeacher ? (sessionToDelete.learnerId || sessionToDelete.studentId) : sessionToDelete.teacherId;
          const partnerProfile = partnerId ? profiles[partnerId] : null;
          const otherName = isTeacher
            ? (sessionToDelete.learnerName || sessionToDelete.studentName || partnerProfile?.fullName || "Swap Partner")
            : (sessionToDelete.teacherName || partnerProfile?.fullName || "Swap Partner");

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
              
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (!isDeletingSession) setSessionToDelete(null);
                }}
                className="absolute inset-0 bg-[#0D0D0F]/60 backdrop-blur-xs"
              />

              {/* Modal Card */}
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                className="relative w-full max-w-sm rounded-3xl bg-[#FFFFFF] border border-[#E8E4DB] p-6 shadow-2xl z-10 flex flex-col gap-4"
              >
                <div className="w-12 h-12 rounded-2xl bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-center text-[#DC2626] mx-auto shadow-sm">
                  <Trash2 className="w-6 h-6 stroke-[1.75]" />
                </div>

                <div className="text-center">
                  <h3 className="text-base font-bold text-[#0D0D0F]">Delete Session?</h3>
                  <p className="text-xs text-[#71717A] mt-1.5 leading-relaxed">
                    Move <span className="font-semibold text-[#0D0D0F]">"{sessionToDelete.skillName || sessionToDelete.skill || 'Session'}"</span> with <span className="font-semibold text-[#0D0D0F]">{otherName}</span> to Recently Deleted?
                  </p>
                </div>

                {/* 30-Day Retention Notice Card */}
                <div className="p-3.5 rounded-2xl bg-[#F7F4EE] border border-[#E8E4DB] flex items-start gap-2.5 text-left">
                  <Clock className="w-4 h-4 text-[#C9A96E] shrink-0 mt-0.5" />
                  <p className="text-[11px] text-[#71717A] leading-relaxed">
                    This session will be kept in <strong className="text-[#0D0D0F]">Settings → Recently Deleted</strong> for 30 days, where you can restore it anytime before it is permanently removed.
                  </p>
                </div>

                {deleteSessionError && (
                  <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] text-[#991B1B] text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{deleteSessionError}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    id="cancel-soft-delete-btn"
                    type="button"
                    disabled={isDeletingSession}
                    onClick={() => setSessionToDelete(null)}
                    className="h-11 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F7F4EE] text-[#0D0D0F] font-semibold text-xs transition cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    id="confirm-soft-delete-btn"
                    type="button"
                    disabled={isDeletingSession}
                    onClick={handleConfirmSoftDelete}
                    className="h-11 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-md active:scale-95"
                  >
                    {isDeletingSession ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>Deleting...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4 text-white" />
                        <span>Delete Session</span>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
