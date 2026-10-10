import React, { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, doc, getDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { updateEmail, updatePassword } from "firebase/auth";
import { auth, db } from "../firebase";
import { useApp } from "../context/AppContext";
import { UserProfile, Session } from "../types";
import { SmartImage } from "./SmartImage";
import logoImg from "../assets/logo.jpg";
import { 
  ChevronLeft,
  ChevronRight,
  User, 
  Bell, 
  Slash, 
  HelpCircle, 
  LogOut, 
  Trash2, 
  CheckCircle,
  Mail,
  Key,
  Clock,
  AlertTriangle,
  ShieldCheck,
  Info,
  RotateCcw,
  AlertCircle,
  Search,
  Volume2,
  Smartphone,
  PhoneCall,
  MessageSquare,
  Play,
  Square,
  Sparkles,
  Loader2,
  Check,
  ExternalLink,
  FileText
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { safeLocalStorage } from "../utils/safeStorage";
import { pushNotificationService } from "../services/mobile/pushNotificationService";
import { 
  playNotificationSound,
  playSessionReminder10Min,
  playSessionStarting,
  playSessionRequestReceived,
  playSessionAccepted,
  playNewChatMessage,
  playCallEnded,
  startIncomingCallRingtone,
  stopIncomingCallRingtone,
  triggerHapticFeedback
} from "../utils/sound";
import BlockUserConfirmModal from "./BlockUserConfirmModal";
import { PremiumToast } from "./PremiumConfirmSheets";
import { useBackHandler } from "../utils/navigationManager";
import {
  restoreDeletedSession,
  permanentlyDeleteSession,
  autoCleanupExpiredSessions,
  getTimestampMs
} from "../services/sessionTrashService";

interface SettingsViewProps {
  currentUserId: string;
  onClose: () => void;
  onLogOut: () => void;
}

type ActiveSection = "menu" | "account" | "notifications" | "blocked" | "security" | "help" | "about" | "recentlyDeleted" | "privacy" | "terms";

// ==========================================
// iOS-STYLE UI COMPONENTS
// ==========================================

function IOSToggle({
  checked,
  onChange,
  disabled = false,
  ariaLabel
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none select-none ${
        checked ? "bg-[#34C759]" : "bg-[#E9E9EB] dark:bg-[#39393D]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`pointer-events-none inline-block h-[27px] w-[27px] rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function IOSGroup({
  title,
  footer,
  children
}: {
  title?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {title && (
        <div className="px-4 pb-1.5 pt-3.5 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider select-none">
          {title}
        </div>
      )}
      <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 overflow-hidden shadow-2xs divide-y divide-theme-border/40">
        {children}
      </div>
      {footer && (
        <div className="px-4 pt-1.5 text-[11px] text-neutral-400 dark:text-neutral-500 leading-relaxed select-none">
          {footer}
        </div>
      )}
    </div>
  );
}

function IOSRow({
  icon: Icon,
  iconBg,
  title,
  subtitle,
  rightContent,
  onClick,
  showChevron = true,
  destructive = false
}: {
  icon?: any;
  iconBg?: string;
  title: string;
  subtitle?: string;
  rightContent?: React.ReactNode;
  onClick?: () => void;
  showChevron?: boolean;
  destructive?: boolean;
}) {
  const content = (
    <div className="flex items-center gap-3.5 px-4 py-3 min-h-[50px] w-full text-left transition active:bg-black/[0.04] dark:active:bg-white/[0.04]">
      {Icon && (
        <div
          className={`w-[30px] h-[30px] rounded-[7px] flex items-center justify-center text-white shrink-0 shadow-xs ${iconBg || "bg-[#007AFF]"}`}
        >
          <Icon className="w-4 h-4 stroke-[2.2]" />
        </div>
      )}
      <div className="flex-1 min-w-0 pr-1">
        <div className={`text-[15px] leading-snug ${destructive ? "text-[#FF3B30] font-medium text-center" : "text-theme-text-primary font-normal"}`}>
          {title}
        </div>
        {subtitle && (
          <div className="text-[11px] text-neutral-400 dark:text-neutral-500 leading-tight mt-0.5 truncate">
            {subtitle}
          </div>
        )}
      </div>
      {rightContent && <div className="shrink-0 flex items-center gap-2">{rightContent}</div>}
      {showChevron && (
        <ChevronRight className="w-4 h-4 text-neutral-300 dark:text-neutral-600 shrink-0 stroke-[2.5]" />
      )}
    </div>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="w-full text-left cursor-pointer select-none">
        {content}
      </button>
    );
  }
  return content;
}

// ==========================================
// MAIN SETTINGS VIEW
// ==========================================

export default function SettingsView({ currentUserId, onClose, onLogOut }: SettingsViewProps) {
  const { 
    currentUserProfile, 
    updateProfile, 
    setShowLogoutConfirm, 
    setShowDeleteConfirm,
    sessions = [],
    refreshSessions,
    profilesCache = {},
    soundPreferences,
    updateSoundPreferences
  } = useApp();
  
  const [activeSection, setActiveSection] = useState<ActiveSection>("menu");

  const changeSection = (section: ActiveSection) => {
    stopIncomingCallRingtone();
    setIsPlayingRingtonePreview(false);
    setActiveSection(section);
  };

  // Sound ringtone preview state
  const [isPlayingRingtonePreview, setIsPlayingRingtonePreview] = useState(false);
  const [playingToneId, setPlayingToneId] = useState<string | null>(null);

  const handleToggleRingtonePreview = () => {
    if (isPlayingRingtonePreview) {
      stopIncomingCallRingtone();
      setIsPlayingRingtonePreview(false);
    } else {
      startIncomingCallRingtone("settings_preview");
      setIsPlayingRingtonePreview(true);
    }
  };

  const playToneAudition = (id: string, playFn: () => void) => {
    setPlayingToneId(id);
    playFn();
    setTimeout(() => setPlayingToneId(null), 1200);
  };

  // Stop ringtone preview on unmount or section change
  useEffect(() => {
    return () => {
      stopIncomingCallRingtone();
    };
  }, [activeSection]);

  // Background Push State
  const [pushPermStatus, setPushPermStatus] = useState<string>("default");
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const [isPushAlertsEnabled, setIsPushAlertsEnabled] = useState<boolean>(() => {
    const saved = safeLocalStorage.getItem("swap_push_notifications_enabled");
    if (saved !== null) return saved === "true";
    return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
  });

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushPermStatus(Notification.permission);
      if (Notification.permission === "denied") {
        setIsPushAlertsEnabled(false);
      }
    }
  }, [activeSection]);

  const handleTogglePushAlerts = async () => {
    if (isPushAlertsEnabled) {
      setIsPushAlertsEnabled(false);
      safeLocalStorage.setItem("swap_push_notifications_enabled", "false");
      setToast({ message: "High-priority push alerts turned off", type: "success" });
    } else {
      setIsEnablingPush(true);
      try {
        const granted = await pushNotificationService.requestPermissionAndRegister(currentUserId);
        if (typeof window !== "undefined" && "Notification" in window) {
          setPushPermStatus(Notification.permission);
        }
        if (granted) {
          setIsPushAlertsEnabled(true);
          safeLocalStorage.setItem("swap_push_notifications_enabled", "true");
          setToast({ message: "High-priority push alerts enabled", type: "success" });
        } else {
          setIsPushAlertsEnabled(false);
          safeLocalStorage.setItem("swap_push_notifications_enabled", "false");
          setToast({ message: "Please allow notifications in browser or device settings", type: "error" });
        }
      } catch (e: any) {
        setToast({ message: e.message || "Failed to enable notifications", type: "error" });
      } finally {
        setIsEnablingPush(false);
      }
    }
  };

  // Unblock confirmation modal states
  const [showUnblockModal, setShowUnblockModal] = useState(false);
  const [selectedUserToUnblock, setSelectedUserToUnblock] = useState<UserProfile | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Intercept back button when in a sub-section or when unblock modal is open
  useBackHandler(showUnblockModal, () => {
    setShowUnblockModal(false);
  });
  useBackHandler(activeSection !== "menu", () => {
    setActiveSection("menu");
  });
  
  // Recently Deleted State
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<Session | null>(null);
  const [isDeletingPermanently, setIsDeletingPermanently] = useState(false);
  const [trashToast, setTrashToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [trashSearchQuery, setTrashSearchQuery] = useState("");

  const deletedSessions = useMemo(() => {
    return sessions
      .filter((s) => s.status === "deleted" || s.deletedAt)
      .sort((a, b) => {
        const timeA = getTimestampMs(a.deletedAt) || 0;
        const timeB = getTimestampMs(b.deletedAt) || 0;
        return timeB - timeA;
      });
  }, [sessions]);

  const filteredDeletedSessions = useMemo(() => {
    if (!trashSearchQuery.trim()) return deletedSessions;
    const q = trashSearchQuery.toLowerCase();
    return deletedSessions.filter((s) => {
      const isTeacher = s.teacherId === currentUserId;
      const otherName = isTeacher ? (s.learnerName || s.studentName || "") : (s.teacherName || "");
      const skill = (s.skillName || s.skill || "").toLowerCase();
      return otherName.toLowerCase().includes(q) || skill.includes(q);
    });
  }, [deletedSessions, trashSearchQuery, currentUserId]);

  // Auto cleanup expired deleted sessions (older than 30 days) whenever Recently Deleted is opened
  useEffect(() => {
    if (activeSection === "recentlyDeleted" && deletedSessions.length > 0) {
      autoCleanupExpiredSessions(deletedSessions, currentUserId)
        .then((cleanedIds) => {
          if (cleanedIds.length > 0) {
            setTrashToast({
              type: "success",
              text: `Auto-cleaned ${cleanedIds.length} expired session${cleanedIds.length > 1 ? "s" : ""} (>30 days).`
            });
            setTimeout(() => setTrashToast(null), 4000);
            refreshSessions?.();
          }
        })
        .catch((err) => {
          console.warn("Auto cleanup error:", err);
        });
    }
  }, [activeSection, deletedSessions, currentUserId, refreshSessions]);

  // Restore Session Handler
  const handleRestoreSession = async (session: Session) => {
    try {
      setRestoringSessionId(session.id);
      setTrashToast(null);
      const res = await restoreDeletedSession(session, currentUserId);
      setTrashToast({
        type: "success",
        text: `Session restored as ${res.restoredStatus === "completed" ? "Completed" : "Active"}.`
      });
      setTimeout(() => setTrashToast(null), 3500);
      refreshSessions?.();
    } catch (err: any) {
      console.error("Error restoring session:", err);
      setTrashToast({
        type: "error",
        text: err.message || "Failed to restore session."
      });
      setTimeout(() => setTrashToast(null), 4000);
    } finally {
      setRestoringSessionId(null);
    }
  };

  // Permanent Delete Handler
  const handleConfirmPermanentDelete = async () => {
    if (!permanentDeleteTarget) return;
    try {
      setIsDeletingPermanently(true);
      setTrashToast(null);
      await permanentlyDeleteSession(permanentDeleteTarget.id, currentUserId);
      setTrashToast({
        type: "success",
        text: "Session permanently deleted."
      });
      setTimeout(() => setTrashToast(null), 3500);
      setPermanentDeleteTarget(null);
      refreshSessions?.();
    } catch (err: any) {
      console.error("Error permanently deleting session:", err);
      setTrashToast({
        type: "error",
        text: err.message || "Failed to permanently delete session."
      });
      setTimeout(() => setTrashToast(null), 4000);
    } finally {
      setIsDeletingPermanently(false);
    }
  };
  
  // Blocked users state
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [blockedProfiles, setBlockedProfiles] = useState<Record<string, UserProfile>>({});
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  // Account operations state
  const [emailInput, setEmailInput] = useState(auth.currentUser?.email || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountStatusMsg, setAccountStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isUpdatingAccount, setIsUpdatingAccount] = useState(false);

  // Reactive Privacy & Notification settings state
  const [isStealthMode, setIsStealthMode] = useState<boolean>(currentUserProfile?.isStealthMode ?? false);
  const [isOnlineVisible, setIsOnlineVisible] = useState<boolean>(currentUserProfile?.isOnlineVisible ?? true);

  const [notifSettings, setNotifSettings] = useState({
    directMessages: currentUserProfile?.notificationSettings?.directMessages ?? true,
    bookingRequests: currentUserProfile?.notificationSettings?.bookingRequests ?? true,
    newFollowers: currentUserProfile?.notificationSettings?.newFollowers ?? true,
    completedReviews: currentUserProfile?.notificationSettings?.completedReviews ?? true,
  });

  const [savingPrivacyMsg, setSavingPrivacyMsg] = useState<string | null>(null);

  // Sync states if currentUserProfile updates from Firestore
  useEffect(() => {
    if (currentUserProfile) {
      if (currentUserProfile.isStealthMode !== undefined) setIsStealthMode(currentUserProfile.isStealthMode);
      if (currentUserProfile.isOnlineVisible !== undefined) setIsOnlineVisible(currentUserProfile.isOnlineVisible);
      if (currentUserProfile.notificationSettings) {
        setNotifSettings({
          directMessages: currentUserProfile.notificationSettings.directMessages ?? true,
          bookingRequests: currentUserProfile.notificationSettings.bookingRequests ?? true,
          newFollowers: currentUserProfile.notificationSettings.newFollowers ?? true,
          completedReviews: currentUserProfile.notificationSettings.completedReviews ?? true,
        });
      }
    }
  }, [currentUserProfile]);

  const handleToggleStealth = async () => {
    const nextVal = !isStealthMode;
    setIsStealthMode(nextVal);
    try {
      await updateProfile({ isStealthMode: nextVal });
      setSavingPrivacyMsg("Updated");
      setTimeout(() => setSavingPrivacyMsg(null), 2000);
    } catch (err) {
      console.error("Failed to update stealth mode:", err);
      setIsStealthMode(!nextVal);
    }
  };

  const handleToggleOnlineVisible = async () => {
    const nextVal = !isOnlineVisible;
    setIsOnlineVisible(nextVal);
    try {
      await updateProfile({ isOnlineVisible: nextVal });
      setSavingPrivacyMsg("Updated");
      setTimeout(() => setSavingPrivacyMsg(null), 2000);
    } catch (err) {
      console.error("Failed to update online state:", err);
      setIsOnlineVisible(!nextVal);
    }
  };

  const handleToggleNotif = async (key: keyof typeof notifSettings) => {
    const updated = { ...notifSettings, [key]: !notifSettings[key] };
    setNotifSettings(updated);
    try {
      await updateProfile({ notificationSettings: updated });
    } catch (err) {
      console.error("Failed to update notification settings:", err);
      setNotifSettings(notifSettings);
    }
  };

  // Listen to blocked users subcollection
  useEffect(() => {
    if (activeSection !== "blocked") return;

    setLoadingBlocked(true);
    const blockedRef = collection(db, "users", currentUserId, "blockedUsers");
    const unsub = onSnapshot(blockedRef, async (snapshot) => {
      const ids: string[] = [];
      snapshot.forEach((doc) => {
        ids.push(doc.id);
      });
      setBlockedIds(ids);
      setLoadingBlocked(false);
    }, (err) => {
      console.error("Error loading blocked users:", err);
      setLoadingBlocked(false);
    });

    return () => unsub();
  }, [activeSection, currentUserId]);

  // Fetch blocked user details
  useEffect(() => {
    if (blockedIds.length === 0) return;

    blockedIds.forEach(async (id) => {
      if (blockedProfiles[id]) return;
      try {
        const docRef = doc(db, "users", id);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const uProfile = snap.data() as UserProfile;
          setBlockedProfiles((prev) => ({ ...prev, [id]: uProfile }));
        }
      } catch (err) {
        console.error("Error fetching blocked profile:", id, err);
      }
    });
  }, [blockedIds]);

  const handleOpenUnblock = (blockedId: string, profile?: UserProfile) => {
    setSelectedUserToUnblock(profile || { uid: blockedId, fullName: "Member", username: "user" } as UserProfile);
    setShowUnblockModal(true);
  };

  const handleConfirmUnblock = async () => {
    if (!selectedUserToUnblock) return;
    const blockedId = selectedUserToUnblock.uid;
    setUnblockingId(blockedId);
    try {
      const blockDocRef = doc(db, "users", currentUserId, "blockedUsers", blockedId);
      await deleteDoc(blockDocRef);
      setBlockedIds((prev) => prev.filter((id) => id !== blockedId));
      setShowUnblockModal(false);
      setSelectedUserToUnblock(null);
      setToast({ message: "User unblocked", type: "success" });
    } catch (err) {
      console.error("Unblock failed:", err);
      setToast({ message: "Failed to unblock user. Please try again.", type: "error" });
    } finally {
      setUnblockingId(null);
    }
  };

  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountStatusMsg(null);
    setIsUpdatingAccount(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("No user authenticated");

      if (emailInput && emailInput !== user.email) {
        await updateEmail(user, emailInput);
        await updateProfile({ email: emailInput });
      }

      if (newPassword || confirmPassword) {
        if (newPassword !== confirmPassword) {
          throw new Error("New passwords do not match.");
        }
        if (newPassword.length < 6) {
          throw new Error("Password must be at least 6 characters long.");
        }
        await updatePassword(user, newPassword);
        setNewPassword("");
        setConfirmPassword("");
      }

      setAccountStatusMsg({ type: "success", text: "Settings saved successfully." });
    } catch (err: any) {
      console.error("Account update failed:", err);
      if (err.code === "auth/requires-recent-login") {
        setAccountStatusMsg({
          type: "error",
          text: "Requires fresh login. Please log out and sign back in to modify credentials."
        });
      } else {
        setAccountStatusMsg({ type: "error", text: err.message || "Failed to update account details." });
      }
    } finally {
      setIsUpdatingAccount(false);
    }
  };

  // Apple-style Subpage Header
  const renderHeader = (title: string, onBack: () => void) => (
    <div className="px-4 py-3.5 border-b border-theme-border/60 bg-theme-bg/90 backdrop-blur-xl flex items-center justify-between shrink-0 sticky top-0 z-20">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[#007AFF] hover:opacity-80 active:opacity-60 transition cursor-pointer text-[15px] font-normal shrink-0"
      >
        <ChevronLeft className="w-5 h-5 -ml-1 stroke-[2.5]" />
        <span>Settings</span>
      </button>
      <h3 className="font-semibold text-[16px] tracking-tight text-theme-text-primary text-center truncate max-w-[200px]">
        {title}
      </h3>
      <div className="w-16" /> {/* Symmetrical spacer for centering */}
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen h-full bg-[#F2F2F7] dark:bg-[#000000] text-theme-text-primary font-sans relative select-none overflow-y-auto pb-36 mobile-scroll">
      <AnimatePresence mode="wait">
        
        {/* ========================================== */}
        {/* MAIN SETTINGS MENU (APPLE INSET STYLE)     */}
        {/* ========================================== */}
        {activeSection === "menu" && (
          <motion.div
            key="menu"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="flex-1 flex flex-col"
          >
            {/* iOS Top Navigation Bar with Done Button */}
            <div className="px-4 py-3 bg-[#F2F2F7]/90 dark:bg-[#000000]/90 backdrop-blur-xl shrink-0 sticky top-0 z-20 flex items-center justify-between border-b border-black/[0.04] dark:border-white/[0.08]">
              <span className="w-12" />
              <h2 className="text-[17px] font-semibold tracking-tight text-theme-text-primary text-center">
                Settings
              </h2>
              <button
                onClick={onClose}
                className="text-[16px] font-semibold text-[#007AFF] hover:opacity-80 active:opacity-60 transition cursor-pointer"
              >
                Done
              </button>
            </div>

            <div className="flex flex-col gap-5 px-4 pt-4 pb-36 max-w-xl mx-auto w-full">
              
              {/* Apple ID Style Profile Row */}
              {currentUserProfile && (
                <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 overflow-hidden shadow-2xs">
                  <button
                    onClick={() => changeSection("account")}
                    className="w-full p-4 flex items-center gap-4 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] active:bg-black/[0.04] transition cursor-pointer"
                  >
                    <div className="w-[60px] h-[60px] rounded-full overflow-hidden border border-black/[0.06] dark:border-white/[0.1] shrink-0 shadow-xs">
                      <SmartImage
                        src={currentUserProfile.photoUrl || currentUserProfile.photoURL}
                        alt={currentUserProfile.fullName}
                        fallbackType="profile"
                        fullName={currentUserProfile.fullName}
                      />
                    </div>
                    <div className="flex-1 min-w-0 pr-1">
                      <h4 className="text-[18px] font-semibold text-theme-text-primary truncate leading-tight flex items-center gap-1.5">
                        {currentUserProfile.fullName}
                        {currentUserProfile.verified && (
                          <span className="text-[#007AFF] font-mono text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-[#007AFF]/10">
                            PRO
                          </span>
                        )}
                      </h4>
                      <p className="text-[13px] text-neutral-400 dark:text-neutral-500 truncate mt-1">
                        @{currentUserProfile.username} • Account & Privacy
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-neutral-300 dark:text-neutral-600 shrink-0 stroke-[2.5]" />
                  </button>
                </div>
              )}

              {/* Group 1: Preferences */}
              <IOSGroup title="Preferences">
                <IOSRow
                  icon={User}
                  iconBg="bg-[#007AFF]"
                  title="Account & Privacy"
                  subtitle="Credentials, stealth mode & security"
                  onClick={() => changeSection("account")}
                />
                <IOSRow
                  icon={Volume2}
                  iconBg="bg-[#FF2D55]"
                  title="Sounds & Notifications"
                  subtitle="Ringtones, chat tones, session alerts"
                  onClick={() => changeSection("notifications")}
                />
                <IOSRow
                  icon={Slash}
                  iconBg="bg-[#FF3B30]"
                  title="Blocked Users"
                  subtitle="Manage restricted connections"
                  onClick={() => changeSection("blocked")}
                />
                <IOSRow
                  icon={ShieldCheck}
                  iconBg="bg-[#34C759]"
                  title="Security & Devices"
                  subtitle="Active session integrity & trusted hardware"
                  onClick={() => changeSection("security")}
                />
              </IOSGroup>

              {/* Group 2: Trash / Retention */}
              <IOSGroup title="Data & Storage">
                <IOSRow
                  icon={RotateCcw}
                  iconBg="bg-[#FF9500]"
                  title="Recently Deleted"
                  subtitle="30-day retention for deleted swap sessions"
                  rightContent={
                    deletedSessions.length > 0 ? (
                      <span className="px-2 py-0.5 rounded-full text-[12px] font-semibold bg-neutral-200/70 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                        {deletedSessions.length}
                      </span>
                    ) : undefined
                  }
                  onClick={() => changeSection("recentlyDeleted")}
                />
              </IOSGroup>

              {/* Group 3: Support & About */}
              <IOSGroup title="Support & System">
                <IOSRow
                  icon={HelpCircle}
                  iconBg="bg-[#5856D6]"
                  title="Help & FAQ"
                  subtitle="Knowledge base & support inquiry"
                  onClick={() => changeSection("help")}
                />
                <IOSRow
                  icon={Info}
                  iconBg="bg-[#8E8E93]"
                  title="About SwapSkill"
                  rightContent={
                    <span className="text-[13px] text-neutral-400 dark:text-neutral-500 font-normal">
                      1.0.4
                    </span>
                  }
                  onClick={() => changeSection("about")}
                />
              </IOSGroup>

              {/* Group 4: Sign Out (Native Apple Red Center Style) */}
              <div className="pt-2">
                <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 overflow-hidden shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setShowLogoutConfirm(true)}
                    className="w-full py-3.5 px-4 flex items-center justify-center gap-2 text-[#FF3B30] hover:bg-red-500/5 active:opacity-60 transition cursor-pointer text-[15px] font-medium"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>

            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* 2. SOUNDS & NOTIFICATIONS (IPHONE LEVEL)   */}
        {/* ========================================== */}
        {activeSection === "notifications" && (
          <motion.div
            key="notifications"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Sounds & Haptics", () => { 
              stopIncomingCallRingtone();
              setIsPlayingRingtonePreview(false);
              setActiveSection("menu"); 
            })}

            <div className="flex flex-col gap-5 px-4 pt-4 pb-36 max-w-xl mx-auto w-full">
              
              {/* Group 1: Device Push & Incoming Alert Toggle */}
              <IOSGroup 
                title="Device Push Alerts"
                footer="Native push notifications deliver incoming video calls and messages even if your screen is locked or the app is closed."
              >
                <div className="flex items-center justify-between px-4 py-3 min-h-[52px]">
                  <div className="flex items-center gap-3.5 pr-2">
                    <div className="w-[30px] h-[30px] rounded-[7px] bg-[#007AFF] flex items-center justify-center text-white shrink-0 shadow-xs">
                      <Bell className="w-4 h-4 stroke-[2.2]" />
                    </div>
                    <div>
                      <div className="text-[15px] text-theme-text-primary font-normal">Push Notification Alerts</div>
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
                        {isPushAlertsEnabled ? "Enabled • High-priority background delivery" : "Disabled • Turn on to receive alerts"}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <IOSToggle
                      checked={isPushAlertsEnabled}
                      onChange={handleTogglePushAlerts}
                      disabled={isEnablingPush}
                      ariaLabel="Toggle Push Notification Alerts"
                    />
                  </div>
                </div>
              </IOSGroup>

              {/* Group 2: Audio & Alert Sounds (Clean On/Off Toggles) */}
              <IOSGroup 
                title="Alert Sounds"
                footer="Individual sound toggles for incoming calls, chat messages, and scheduled session reminders."
              >
                {/* 1. Call Notification Sound */}
                <div className="flex items-center justify-between px-4 py-3 min-h-[50px]">
                  <div className="flex items-center gap-3.5 pr-2">
                    <div className="w-[30px] h-[30px] rounded-[7px] bg-[#FF2D55] flex items-center justify-center text-white shrink-0 shadow-xs">
                      <PhoneCall className="w-4 h-4 stroke-[2.2]" />
                    </div>
                    <div>
                      <div className="text-[15px] text-theme-text-primary font-normal">Call Notification Sound</div>
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500">Incoming call ringtone chime</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleToggleRingtonePreview}
                      className={`h-7 px-2.5 rounded-full text-[11px] font-semibold transition flex items-center gap-1 cursor-pointer ${
                        isPlayingRingtonePreview 
                          ? "bg-red-500 text-white animate-pulse" 
                          : "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                      }`}
                    >
                      {isPlayingRingtonePreview ? (
                        <>
                          <Square className="w-2.5 h-2.5 fill-current" />
                          Stop
                        </>
                      ) : (
                        <>
                          <Play className="w-2.5 h-2.5 fill-current" />
                          Test
                        </>
                      )}
                    </button>
                    <IOSToggle
                      checked={soundPreferences.callRingtone}
                      onChange={() => updateSoundPreferences({ callRingtone: !soundPreferences.callRingtone })}
                      ariaLabel="Toggle Call Notification Sound"
                    />
                  </div>
                </div>

                {/* 2. Message Notification Sound */}
                <div className="flex items-center justify-between px-4 py-3 min-h-[50px]">
                  <div className="flex items-center gap-3.5 pr-2">
                    <div className="w-[30px] h-[30px] rounded-[7px] bg-[#34C759] flex items-center justify-center text-white shrink-0 shadow-xs">
                      <MessageSquare className="w-4 h-4 stroke-[2.2]" />
                    </div>
                    <div>
                      <div className="text-[15px] text-theme-text-primary font-normal">Message Notification Sound</div>
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500">Incoming chat message alert</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => playToneAudition("chat", () => playNewChatMessage("settings_chat"))}
                      className="h-7 px-2.5 rounded-full text-[11px] font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      Test
                    </button>
                    <IOSToggle
                      checked={soundPreferences.chatSounds}
                      onChange={() => updateSoundPreferences({ chatSounds: !soundPreferences.chatSounds })}
                      ariaLabel="Toggle Message Notification Sound"
                    />
                  </div>
                </div>

                {/* 3. Session Notification Sound */}
                <div className="flex items-center justify-between px-4 py-3 min-h-[50px]">
                  <div className="flex items-center gap-3.5 pr-2">
                    <div className="w-[30px] h-[30px] rounded-[7px] bg-[#5856D6] flex items-center justify-center text-white shrink-0 shadow-xs">
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </div>
                    <div>
                      <div className="text-[15px] text-theme-text-primary font-normal">Session Notification Sound</div>
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500">Alert when scheduled session begins</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => playToneAudition("session_start", () => playSessionStarting("settings_start"))}
                      className="h-7 px-2.5 rounded-full text-[11px] font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      Test
                    </button>
                    <IOSToggle
                      checked={soundPreferences.sessionStartSounds ?? true}
                      onChange={() => updateSoundPreferences({ sessionStartSounds: !(soundPreferences.sessionStartSounds ?? true) })}
                      ariaLabel="Toggle Session Notification Sound"
                    />
                  </div>
                </div>

                {/* 4. 10 Mins Reminder Sound */}
                <div className="flex items-center justify-between px-4 py-3 min-h-[50px]">
                  <div className="flex items-center gap-3.5 pr-2">
                    <div className="w-[30px] h-[30px] rounded-[7px] bg-[#FF9500] flex items-center justify-center text-white shrink-0 shadow-xs">
                      <Clock className="w-4 h-4 stroke-[2.2]" />
                    </div>
                    <div>
                      <div className="text-[15px] text-theme-text-primary font-normal">10 Mins Reminder Sound</div>
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500">Advance 10-minute warning chime</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => playToneAudition("reminder", () => playSessionReminder10Min("settings_10m"))}
                      className="h-7 px-2.5 rounded-full text-[11px] font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      Test
                    </button>
                    <IOSToggle
                      checked={soundPreferences.sessionReminderSounds}
                      onChange={() => updateSoundPreferences({ sessionReminderSounds: !soundPreferences.sessionReminderSounds })}
                      ariaLabel="Toggle 10 Mins Reminder Sound"
                    />
                  </div>
                </div>

                {/* 5. General Notification Sounds */}
                <div className="flex items-center justify-between px-4 py-3 min-h-[50px]">
                  <div className="flex items-center gap-3.5 pr-2">
                    <div className="w-[30px] h-[30px] rounded-[7px] bg-[#AF52DE] flex items-center justify-center text-white shrink-0 shadow-xs">
                      <Bell className="w-4 h-4 stroke-[2.2]" />
                    </div>
                    <div>
                      <div className="text-[15px] text-theme-text-primary font-normal">Notification Sound</div>
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500">General app and activity chimes</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => playToneAudition("notif", () => playNotificationSound("settings_notif"))}
                      className="h-7 px-2.5 rounded-full text-[11px] font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      Test
                    </button>
                    <IOSToggle
                      checked={soundPreferences.notificationSounds}
                      onChange={() => updateSoundPreferences({ notificationSounds: !soundPreferences.notificationSounds })}
                      ariaLabel="Toggle Notification Sound"
                    />
                  </div>
                </div>

                {/* 6. Vibration & Haptic Feedback */}
                <div className="flex items-center justify-between px-4 py-3 min-h-[50px]">
                  <div className="flex items-center gap-3.5 pr-2">
                    <div className="w-[30px] h-[30px] rounded-[7px] bg-[#8E8E93] flex items-center justify-center text-white shrink-0 shadow-xs">
                      <Smartphone className="w-4 h-4 stroke-[2.2]" />
                    </div>
                    <div>
                      <div className="text-[15px] text-theme-text-primary font-normal">Vibration & Haptics</div>
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500">Tactile physical feedback</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => triggerHapticFeedback("medium")}
                      className="h-7 px-2.5 rounded-full text-[11px] font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      Pulse
                    </button>
                    <IOSToggle
                      checked={soundPreferences.vibrationFeedback}
                      onChange={() => updateSoundPreferences({ vibrationFeedback: !soundPreferences.vibrationFeedback })}
                      ariaLabel="Toggle Vibration Feedback"
                    />
                  </div>
                </div>
              </IOSGroup>

            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* 3. ACCOUNT & PRIVACY                       */}
        {/* ========================================== */}
        {activeSection === "account" && (
          <motion.div
            key="account"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Account & Privacy", () => { setActiveSection("menu"); setAccountStatusMsg(null); })}
            
            <div className="flex flex-col gap-5 px-4 pt-4 pb-36 max-w-xl mx-auto w-full">
              
              {/* Credentials Form */}
              <form onSubmit={handleUpdateAccount} className="flex flex-col gap-5">
                <IOSGroup title="Credentials">
                  <div className="px-4 py-2.5">
                    <label className="text-[11px] text-neutral-400 dark:text-neutral-500 font-medium">Email Address</label>
                    <div className="relative mt-1">
                      <Mail className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                      <input
                        type="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="w-full h-9 pl-6 pr-2 bg-transparent text-[14px] text-theme-text-primary focus:outline-none"
                        placeholder="yourname@domain.com"
                      />
                    </div>
                  </div>

                  <div className="px-4 py-2.5">
                    <label className="text-[11px] text-neutral-400 dark:text-neutral-500 font-medium">New Password</label>
                    <div className="relative mt-1">
                      <Key className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full h-9 pl-6 pr-2 bg-transparent text-[14px] text-theme-text-primary focus:outline-none"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  <div className="px-4 py-2.5">
                    <label className="text-[11px] text-neutral-400 dark:text-neutral-500 font-medium">Confirm Password</label>
                    <div className="relative mt-1">
                      <Key className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full h-9 pl-6 pr-2 bg-transparent text-[14px] text-theme-text-primary focus:outline-none"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </IOSGroup>

                {accountStatusMsg && (
                  <div className={`p-3 rounded-[12px] text-[12px] border ${
                    accountStatusMsg.type === "success" 
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400" 
                      : "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
                  }`}>
                    {accountStatusMsg.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isUpdatingAccount}
                  className="h-11 rounded-[14px] bg-[#007AFF] hover:bg-[#0071E3] active:opacity-80 text-white font-medium text-[15px] transition cursor-pointer flex items-center justify-center gap-2 shadow-2xs"
                >
                  {isUpdatingAccount ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <span>Save Account Updates</span>
                  )}
                </button>
              </form>

              {/* Privacy Controls */}
              <IOSGroup 
                title="Privacy & Visibility"
                footer="Control who can see your online presence and discover your profile."
              >
                <div className="flex items-center justify-between px-4 py-3 min-h-[50px]">
                  <div className="pr-3">
                    <div className="text-[15px] text-theme-text-primary font-normal">Stealth Profile Mode</div>
                    <div className="text-[11px] text-neutral-400 dark:text-neutral-500">Only followers can view bio & skills</div>
                  </div>
                  <IOSToggle
                    checked={isStealthMode}
                    onChange={handleToggleStealth}
                    ariaLabel="Toggle Stealth Mode"
                  />
                </div>

                <div className="flex items-center justify-between px-4 py-3 min-h-[50px]">
                  <div className="pr-3">
                    <div className="text-[15px] text-theme-text-primary font-normal">Online Status Indicator</div>
                    <div className="text-[11px] text-neutral-400 dark:text-neutral-500">Show green active presence in chats</div>
                  </div>
                  <IOSToggle
                    checked={isOnlineVisible}
                    onChange={handleToggleOnlineVisible}
                    ariaLabel="Toggle Online Status"
                  />
                </div>
              </IOSGroup>

              {/* Delete Account (Apple Style Inset) */}
              <IOSGroup title="Danger Zone">
                <div className="p-4 flex flex-col gap-2">
                  <p className="text-[12px] text-neutral-400 dark:text-neutral-500 leading-relaxed">
                    Permanently delete your profile, barter credits, and session history. This action cannot be undone.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="mt-1 h-10 px-4 rounded-[10px] bg-red-500/10 hover:bg-red-500/20 text-[#FF3B30] font-medium text-[13px] transition cursor-pointer text-center"
                  >
                    Delete Account Permanently
                  </button>
                </div>
              </IOSGroup>

            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* 4. BLOCKED USERS                           */}
        {/* ========================================== */}
        {activeSection === "blocked" && (
          <motion.div
            key="blocked"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Blocked Users", () => setActiveSection("menu"))}
            
            <div className="flex flex-col gap-4 px-4 pt-4 pb-36 max-w-xl mx-auto w-full">
              <IOSGroup 
                title="Restricted List"
                footer="Blocked users cannot message you, request skill swaps, or browse your schedule."
              >
                {loadingBlocked ? (
                  <div className="flex items-center justify-center py-10 gap-2 text-neutral-400 text-xs">
                    <Loader2 className="w-4 h-4 animate-spin text-[#007AFF]" /> Loading blocked list...
                  </div>
                ) : blockedIds.length === 0 ? (
                  <div className="py-12 text-center text-neutral-400 flex flex-col items-center gap-2">
                    <CheckCircle className="w-8 h-8 text-neutral-300 dark:text-neutral-700" />
                    <p className="text-sm font-medium text-theme-text-primary">No Blocked Users</p>
                    <p className="text-xs text-neutral-400 max-w-[240px]">
                      Anyone you block will appear here. You can unblock them at any time.
                    </p>
                  </div>
                ) : (
                  blockedIds.map((id) => {
                    const p = blockedProfiles[id];
                    return (
                      <div
                        key={id}
                        className="p-3.5 flex items-center justify-between gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition"
                      >
                        <div className="w-9 h-9 rounded-full overflow-hidden border border-black/[0.06] dark:border-white/[0.1] shrink-0">
                          {p ? (
                            <SmartImage
                              src={p.photoUrl || p.photoURL}
                              alt={p.fullName}
                              fallbackType="profile"
                              fullName={p.fullName}
                            />
                          ) : (
                            <div className="w-full h-full bg-neutral-200 dark:bg-neutral-800" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="text-[14px] font-medium text-theme-text-primary truncate">
                            {p?.fullName || "Member"}
                          </h4>
                          <span className="text-[11px] text-neutral-400 block truncate">
                            @{p?.username || "user"}
                          </span>
                        </div>

                        <button
                          onClick={() => handleOpenUnblock(id, p)}
                          disabled={unblockingId === id}
                          className="px-3 h-7.5 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-[#007AFF] font-semibold text-[12px] rounded-full transition cursor-pointer"
                        >
                          {unblockingId === id ? (
                            <Loader2 className="w-3 h-3 animate-spin text-[#007AFF]" />
                          ) : (
                            "Unblock"
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </IOSGroup>
            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* 5. SECURITY & DEVICES                      */}
        {/* ========================================== */}
        {activeSection === "security" && (
          <motion.div
            key="security"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Security & Devices", () => setActiveSection("menu"))}
            
            <div className="flex flex-col gap-5 px-4 pt-4 pb-36 max-w-xl mx-auto w-full">
              <IOSGroup title="Hardware Verification">
                <div className="p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#34C759]/15 flex items-center justify-center text-[#34C759] shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="text-[14px] font-semibold text-theme-text-primary">Trusted Device Session</h5>
                    <p className="text-[12px] text-neutral-400 dark:text-neutral-500 mt-0.5 leading-relaxed">
                      Your credentials and push notification registration are verified with end-to-end token encryption.
                    </p>
                  </div>
                </div>
              </IOSGroup>

              <IOSGroup 
                title="Active Logins"
                footer="If you see an unfamiliar device, update your password in Account & Privacy."
              >
                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-[14px] text-theme-text-primary font-normal">Current Device</div>
                    <div className="text-[11px] text-neutral-400">Mobile Client / Browser</div>
                  </div>
                  <span className="text-[12px] text-[#34C759] font-medium">Active Now</span>
                </div>
              </IOSGroup>
            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* 6. RECENTLY DELETED SESSIONS               */}
        {/* ========================================== */}
        {activeSection === "recentlyDeleted" && (
          <motion.div
            key="recentlyDeleted"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Recently Deleted", () => setActiveSection("menu"))}

            <div className="flex flex-col gap-4 px-4 pt-4 pb-36 max-w-xl mx-auto w-full">
              
              {/* 30-Day Policy Card */}
              <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 shadow-2xs flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[#FF9500]/15 flex items-center justify-center text-[#FF9500] shrink-0">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[13px] font-semibold text-theme-text-primary">30-Day Recovery Window</h4>
                  <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 leading-relaxed">
                    Deleted swap sessions remain recoverable here for 30 days before being automatically purged from the database.
                  </p>
                </div>
              </div>

              {trashToast && (
                <div
                  className={`p-3 rounded-[12px] text-[12px] flex items-center gap-2 border ${
                    trashToast.type === "success"
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                      : "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
                  }`}
                >
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span className="flex-1 font-medium">{trashToast.text}</span>
                </div>
              )}

              {deletedSessions.length > 2 && (
                <div className="relative">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={trashSearchQuery}
                    onChange={(e) => setTrashSearchQuery(e.target.value)}
                    placeholder="Search deleted sessions..."
                    className="w-full h-10 pl-9 pr-3.5 text-[13px] rounded-[10px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 text-theme-text-primary placeholder-neutral-400 focus:outline-none"
                  />
                </div>
              )}

              {filteredDeletedSessions.length === 0 ? (
                <div className="py-16 text-center text-neutral-400 flex flex-col items-center gap-2">
                  <RotateCcw className="w-8 h-8 text-neutral-300 dark:text-neutral-700" />
                  <p className="text-sm font-medium text-theme-text-primary">No Deleted Sessions</p>
                  <p className="text-xs text-neutral-400 max-w-[240px]">
                    Any sessions you delete will be held here safely for 30 days.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {filteredDeletedSessions.map((session) => {
                    const isTeacher = session.teacherId === currentUserId;
                    const partnerName = isTeacher 
                      ? (session.learnerName || session.studentName || "Swap Partner")
                      : (session.teacherName || "Swap Partner");
                    const isRestoring = restoringSessionId === session.id;

                    return (
                      <div
                        key={session.id}
                        className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 shadow-2xs flex flex-col gap-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="text-[15px] font-semibold text-theme-text-primary">
                              {session.skillName || session.skill || "Swap Session"}
                            </h4>
                            <p className="text-[12px] text-neutral-400 mt-0.5">
                              with {partnerName}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isRestoring}
                            onClick={() => handleRestoreSession(session)}
                            className="flex-1 h-9 rounded-[10px] bg-[#007AFF] hover:bg-[#0071E3] active:opacity-80 text-white font-medium text-[12px] transition cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            {isRestoring ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                            <span>Restore</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setPermanentDeleteTarget(session)}
                            className="h-9 px-3 rounded-[10px] bg-neutral-100 dark:bg-neutral-800 hover:bg-red-500/10 hover:text-red-500 text-neutral-600 dark:text-neutral-400 font-medium text-[12px] transition cursor-pointer flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* 7. HELP & FAQ                              */}
        {/* ========================================== */}
        {activeSection === "help" && (
          <motion.div
            key="help"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Help & FAQs", () => setActiveSection("menu"))}
            
            <div className="flex flex-col gap-4 px-4 pt-4 pb-36 max-w-xl mx-auto w-full">
              <IOSGroup title="Frequently Asked Questions">
                {[
                  { q: "How do skill swap credits work?", a: "Earn points by teaching a peer, then spend those credits to learn new skills from other mentors." },
                  { q: "What does blocking a member do?", a: "Blocked members cannot search for your profile, message you, or submit schedule requests." },
                  { q: "How do verified badges work?", a: "Moderators verify craft authenticity when practitioners upload portfolio links or credentials." }
                ].map((faq, idx) => (
                  <div key={idx} className="p-4 flex flex-col gap-1">
                    <h5 className="text-[14px] font-semibold text-theme-text-primary">{faq.q}</h5>
                    <p className="text-[12px] text-neutral-400 dark:text-neutral-500 leading-relaxed">{faq.a}</p>
                  </div>
                ))}
              </IOSGroup>

              <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-5 text-center flex flex-col items-center gap-1.5 shadow-2xs">
                <div className="w-10 h-10 rounded-full bg-[#5856D6]/15 flex items-center justify-center text-[#5856D6] mb-1">
                  <Mail className="w-5 h-5" />
                </div>
                <h4 className="text-[15px] font-semibold text-theme-text-primary">Need More Assistance?</h4>
                <p className="text-[12px] text-neutral-400 max-w-[240px]">
                  Our support team is always available to help you with sessions or account issues.
                </p>
                <a
                  href="mailto:support@swapskill.app"
                  className="mt-2 text-[13px] font-semibold text-[#007AFF] hover:underline"
                >
                  support@swapskill.app
                </a>
              </div>
            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* 8. ABOUT SWAPSKILL                         */}
        {/* ========================================== */}
        {activeSection === "about" && (
          <motion.div
            key="about"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("About", () => setActiveSection("menu"))}
            
            <div className="flex flex-col gap-6 px-4 pt-8 pb-36 max-w-xl mx-auto w-full items-center text-center">
              
              <div className="w-20 h-20 rounded-[18px] overflow-hidden shadow-md border border-black/[0.08] dark:border-white/[0.1] bg-white">
                <img src={logoImg} alt="SwapSkill" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>

              <div>
                <h3 className="text-[19px] font-bold text-theme-text-primary tracking-tight">SwapSkill</h3>
                <p className="text-[12px] text-neutral-400 mt-0.5">Version 1.0.4 (Build 2026)</p>
              </div>

              <div className="w-full rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 text-left shadow-2xs">
                <p className="text-[13px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  SwapSkill is a high-trust peer-to-peer knowledge swapping platform enabling skilled practitioners to barter expertise, book schedules, and grow their craft networks globally without financial barriers.
                </p>
              </div>

              {/* Legal & Compliance Section for Play Store Review */}
              <div className="w-full flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSection("privacy")}
                  className="w-full flex items-center justify-between p-3.5 rounded-[12px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 hover:bg-neutral-50 dark:hover:bg-[#252528] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-[13px] font-medium text-theme-text-primary">Privacy Policy & Data Safety</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-neutral-400" />
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection("terms")}
                  className="w-full flex items-center justify-between p-3.5 rounded-[12px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 hover:bg-neutral-50 dark:hover:bg-[#252528] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-[13px] font-medium text-theme-text-primary">Terms of Service</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-neutral-400" />
                </button>
              </div>

              <div className="text-[11px] text-neutral-400 mt-4">
                © 2026 SwapSkill Inc. All rights reserved.
              </div>

            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* 9. PRIVACY POLICY & DATA SAFETY            */}
        {/* ========================================== */}
        {activeSection === "privacy" && (
          <motion.div
            key="privacy"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Privacy Policy", () => setActiveSection("about"))}
            
            <div className="flex flex-col gap-4 px-4 pt-6 pb-36 max-w-xl mx-auto w-full text-left">
              <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 shadow-2xs">
                <h4 className="text-[14px] font-bold text-theme-text-primary mb-2 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Camera & Microphone Usage
                </h4>
                <p className="text-[12px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  SwapSkill requests Camera and Microphone permissions solely to facilitate user-initiated real-time peer-to-peer audio and video knowledge exchange sessions via WebRTC. Media streams are transmitted encrypted end-to-end between peers and are never recorded, analyzed, or stored on our servers without your explicit consent.
                </p>
              </div>

              <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 shadow-2xs">
                <h4 className="text-[14px] font-bold text-theme-text-primary mb-2 flex items-center gap-2">
                  <User className="w-4 h-4 text-amber-600" />
                  Account & Personal Data
                </h4>
                <p className="text-[12px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  We collect only necessary profile data (display name, username, email, and public skills) to provide matching and scheduling features. Your authentication is protected by Firebase Authentication and Google Cloud infrastructure with strict security rules.
                </p>
              </div>

              <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 shadow-2xs">
                <h4 className="text-[14px] font-bold text-theme-text-primary mb-2 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-blue-600" />
                  Push Notifications
                </h4>
                <p className="text-[12px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  Push notifications (FCM on Android, APNs on iOS) are used exclusively to alert you to incoming call invitations, verified session reminders, and direct messages. You can toggle notification categories at any time under Settings &gt; Notifications.
                </p>
              </div>

              <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 shadow-2xs">
                <h4 className="text-[14px] font-bold text-theme-text-primary mb-2 flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-rose-600" />
                  Right to Account Deletion
                </h4>
                <p className="text-[12px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  In compliance with Google Play Developer Policies, you have the full right to delete your account and all associated personal data at any time directly in Settings &gt; Account &gt; Delete Account.
                </p>
              </div>

              <div className="text-[11px] text-neutral-400 text-center mt-2">
                Last updated: September 2026 • SwapSkill Privacy Office
              </div>
            </div>
          </motion.div>
        )}

        {/* ========================================== */}
        {/* 10. TERMS OF SERVICE                       */}
        {/* ========================================== */}
        {activeSection === "terms" && (
          <motion.div
            key="terms"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Terms of Service", () => setActiveSection("about"))}
            
            <div className="flex flex-col gap-4 px-4 pt-6 pb-36 max-w-xl mx-auto w-full text-left">
              <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 shadow-2xs">
                <h4 className="text-[14px] font-bold text-theme-text-primary mb-2">1. Peer-to-Peer Exchange Code</h4>
                <p className="text-[12px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  SwapSkill operates on mutual respect and collaborative learning. All sessions must adhere to professional community standards. Harassment, hateful speech, unsolicited commercial advertising, and inappropriate conduct are strictly prohibited.
                </p>
              </div>

              <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 shadow-2xs">
                <h4 className="text-[14px] font-bold text-theme-text-primary mb-2">2. Safety &amp; Reporting</h4>
                <p className="text-[12px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  Users can block any individual immediately via their profile or chat. Violations can be confidentially reported to platform moderators through the in-app report workflow.
                </p>
              </div>

              <div className="rounded-[14px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-4 shadow-2xs">
                <h4 className="text-[14px] font-bold text-theme-text-primary mb-2">3. User Responsibility</h4>
                <p className="text-[12px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  Skills shared on SwapSkill represent the individual experiences of our community members. Users should exercise standard caution when applying advice in technical, legal, or health disciplines.
                </p>
              </div>

              <div className="text-[11px] text-neutral-400 text-center mt-2">
                Last updated: September 2026 • SwapSkill Terms of Service
              </div>
            </div>
          </motion.div>
        )}

      </AnimatePresence>

      {/* Permanent Delete Modal Dialog */}
      <AnimatePresence>
        {permanentDeleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isDeletingPermanently) setPermanentDeleteTarget(null);
              }}
              className="absolute inset-0 bg-black/50 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-xs rounded-[20px] bg-theme-surface dark:bg-[#1C1C1E] border border-theme-border/60 p-5 shadow-2xl z-10 flex flex-col gap-3 text-center"
            >
              <div className="w-11 h-11 rounded-full bg-red-500/15 flex items-center justify-center text-[#FF3B30] mx-auto">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-[16px] font-bold text-theme-text-primary">Delete Permanently?</h3>
                <p className="text-[12px] text-neutral-400 mt-1 leading-normal">
                  This session will be purged from the database and cannot be recovered.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  type="button"
                  disabled={isDeletingPermanently}
                  onClick={() => setPermanentDeleteTarget(null)}
                  className="h-10 rounded-[10px] bg-neutral-100 dark:bg-neutral-800 text-theme-text-primary font-medium text-[13px] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeletingPermanently}
                  onClick={handleConfirmPermanentDelete}
                  className="h-10 rounded-[10px] bg-[#FF3B30] hover:bg-red-600 text-white font-medium text-[13px] transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {isDeletingPermanently ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>Delete</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Unblock User Confirmation Modal */}
      <BlockUserConfirmModal
        isOpen={showUnblockModal}
        mode="unblock"
        targetUser={selectedUserToUnblock ? {
          uid: selectedUserToUnblock.uid,
          username: selectedUserToUnblock.username,
          fullName: selectedUserToUnblock.fullName,
          photoUrl: selectedUserToUnblock.photoUrl || (selectedUserToUnblock as any).photoURL
        } : null}
        onConfirm={handleConfirmUnblock}
        onClose={() => setShowUnblockModal(false)}
      />

      {/* Success/Error Toast */}
      <AnimatePresence>
        {toast && (
          <PremiumToast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
