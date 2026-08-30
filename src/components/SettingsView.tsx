import React, { useState, useEffect, useMemo } from "react";
import { collection, query, onSnapshot, doc, getDoc, setDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { signOut, deleteUser, updateEmail, updatePassword, updateProfile as authUpdateProfile } from "firebase/auth";
import { auth, db } from "../firebase";
import { useApp } from "../context/AppContext";
import { UserProfile, Session, DEFAULT_AVATAR } from "../types";
import { SmartImage } from "./SmartImage";
import logoImg from "../assets/logo.jpg";
import { 
  ArrowLeft, 
  User, 
  Bell, 
  Shield, 
  Slash, 
  HelpCircle, 
  LogOut, 
  Check, 
  Trash2, 
  CheckCircle,
  Mail,
  Lock,
  Globe,
  Loader2,
  Key,
  Phone,
  Clock,
  AlertTriangle,
  ShieldCheck,
  Info,
  RotateCcw,
  Calendar,
  AlertCircle,
  Search,
  RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { safeLocalStorage } from "../utils/safeStorage";
import {
  getDaysRemaining,
  isDeletedSessionExpired,
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

type ActiveSection = "menu" | "account" | "notifications" | "privacy" | "blocked" | "security" | "help" | "about" | "recentlyDeleted";

export default function SettingsView({ currentUserId, onClose, onLogOut }: SettingsViewProps) {
  const { 
    currentUserProfile, 
    updateProfile, 
    setShowLogoutConfirm, 
    setShowDeleteConfirm,
    sessions = [],
    refreshSessions,
    profilesCache = {},
    fetchProfile
  } = useApp();
  
  const [activeSection, setActiveSection] = useState<ActiveSection>("menu");

  const changeSection = (section: ActiveSection) => {
    setActiveSection(section);
  };
  
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
        text: `Session successfully restored as ${res.restoredStatus === "completed" ? "Completed" : "Active"}.`
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
        text: "Session permanently deleted from database."
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
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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
      setSavingPrivacyMsg("Stealth profile mode updated");
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
      setSavingPrivacyMsg("Active online state updated");
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
      if (blockedProfiles[id]) return; // Already fetched
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

  // Unblock user action
  const handleUnblock = async (blockedId: string) => {
    setUnblockingId(blockedId);
    try {
      const blockDocRef = doc(db, "users", currentUserId, "blockedUsers", blockedId);
      await deleteDoc(blockDocRef);
      setBlockedIds((prev) => prev.filter((id) => id !== blockedId));
    } catch (err) {
      console.error("Unblock failed:", err);
    } finally {
      setUnblockingId(null);
    }
  };

  // Update Account Details (Email / Password)
  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountStatusMsg(null);
    setIsUpdatingAccount(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("No user authenticated");

      // 1. Update Email in Auth and profile document if changed
      if (emailInput && emailInput !== user.email) {
        await updateEmail(user, emailInput);
        await updateProfile({ email: emailInput });
      }

      // 2. Update password if filled
      if (newPassword || confirmPassword) {
        if (newPassword !== confirmPassword) {
          throw new Error("New passwords do not match. Please enter the same password twice.");
        }
        if (newPassword.length < 6) {
          throw new Error("Password must be at least 6 characters long.");
        }
        await updatePassword(user, newPassword);
        setNewPassword("");
        setConfirmPassword("");
      }

      setAccountStatusMsg({ type: "success", text: "Account updated successfully!" });
    } catch (err: any) {
      console.error("Account update failed:", err);
      if (err.code === "auth/requires-recent-login") {
        setAccountStatusMsg({
          type: "error",
          text: "Requires fresh login. Please log out and sign back in to modify email or password."
        });
      } else {
        setAccountStatusMsg({ type: "error", text: err.message || "Failed to update account details." });
      }
    } finally {
      setIsUpdatingAccount(false);
    }
  };

  // Permanently delete user account
  const handleDeleteAccount = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setDeleteError("");

    try {
      // 1. Delete user profile document in Firestore
      await deleteDoc(doc(db, "users", currentUserId));
      
      // 2. Delete user in Firebase Auth
      await deleteUser(user);
      
      onLogOut();
    } catch (err: any) {
      console.error("Error deleting account:", err);
      if (err.code === "auth/requires-recent-login") {
        setDeleteError("This operation requires a fresh login. Please sign out and sign back in to delete.");
      } else {
        setDeleteError("Failed to complete account deletion.");
      }
    }
  };

  const renderHeader = (title: string, onBack: () => void) => (
    <div className="px-5 py-4.5 border-b border-theme-border bg-theme-bg/90 backdrop-blur-md flex items-center gap-3 shrink-0 sticky top-0 z-10">
      <button
        onClick={onBack}
        className="w-9 h-9 rounded-xl border border-theme-border hover:border-theme-primary bg-theme-surface flex items-center justify-center text-theme-text-secondary hover:text-theme-text-primary transition cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div>
        <h3 className="font-sans font-bold text-sm tracking-tight text-theme-text-primary">{title}</h3>
        <p className="text-[9px] font-mono text-theme-text-secondary uppercase tracking-widest">Configuration Panel</p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen h-full bg-theme-bg text-theme-text-primary font-sans relative select-none overflow-y-auto pb-36 mobile-scroll">
      <AnimatePresence mode="wait">
        {activeSection === "menu" && (
          <motion.div
            key="menu"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="flex-1 flex flex-col"
          >
            {/* Main Header */}
            <div className="px-5 py-5 border-b border-theme-border bg-theme-bg/95 backdrop-blur-md flex items-center justify-between shrink-0 sticky top-0 z-20">
              <div className="flex flex-col">
                <h3 className="font-sans font-bold text-sm tracking-tight text-theme-text-primary">System Settings</h3>
                <span className="text-[9px] font-mono text-theme-text-secondary uppercase tracking-widest">Apple Quality Engine</span>
              </div>
              <button
                onClick={onClose}
                className="text-xs font-bold text-theme-primary hover:text-theme-primary/80 uppercase tracking-wider cursor-pointer"
              >
                Close
              </button>
            </div>

            {/* Menu options - Apple Settings App Style */}
            <div className="flex flex-col gap-4 px-5 pt-5 pb-36">
              
              {/* Profile Card Header */}
              {currentUserProfile && (
                <div className="p-4 bg-theme-surface border border-theme-border rounded-2xl flex items-center gap-3.5 shadow-md">
                  <div className="w-12 h-12 rounded-full overflow-hidden border border-theme-border shrink-0">
                    <SmartImage
                      src={currentUserProfile.photoUrl || currentUserProfile.photoURL}
                      alt={currentUserProfile.fullName}
                      fallbackType="profile"
                      fullName={currentUserProfile.fullName}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-sans font-bold text-theme-text-primary truncate leading-tight flex items-center gap-1.5">
                      {currentUserProfile.fullName}
                      {currentUserProfile.verified && (
                        <span className="text-theme-primary font-mono text-[10px] uppercase font-extrabold tracking-wide px-1.5 py-0.5 rounded-full bg-theme-primary/10 border border-theme-primary/20">
                          PRO
                        </span>
                      )}
                    </h4>
                    <span className="text-xs text-theme-text-secondary block truncate mt-0.5">
                      @{currentUserProfile.username}
                    </span>
                  </div>
                </div>
              )}

              {/* Unified Settings Block */}
              <div className="flex flex-col bg-theme-surface border border-theme-border rounded-2xl overflow-hidden shadow-sm">
                {/* Account & Privacy Details */}
                <button
                  onClick={() => changeSection("account")}
                  className="w-full px-4 py-3.5 hover:bg-theme-card-hover flex items-center gap-3.5 text-left border-b border-theme-border transition cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-theme-primary/10 flex items-center justify-center text-theme-primary">
                    <User className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-sans font-semibold text-theme-text-primary">Account & Privacy</h4>
                    <p className="text-[10px] text-theme-text-secondary mt-0.5">Security, credentials, stealth mode & delete</p>
                  </div>
                </button>

                {/* Notifications */}
                <button
                  onClick={() => changeSection("notifications")}
                  className="w-full px-4 py-3.5 hover:bg-theme-card-hover flex items-center gap-3.5 text-left border-b border-theme-border transition cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-theme-primary/10 flex items-center justify-center text-theme-primary">
                    <Bell className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-sans font-semibold text-theme-text-primary">Notifications</h4>
                    <p className="text-[10px] text-theme-text-secondary mt-0.5">Direct messages & system requests alerts</p>
                  </div>
                </button>

                {/* Blocked Users */}
                <button
                  onClick={() => changeSection("blocked")}
                  className="w-full px-4 py-3.5 hover:bg-theme-card-hover flex items-center gap-3.5 text-left border-b border-theme-border transition cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-[#ef4444]/10 flex items-center justify-center text-[#ef4444]">
                    <Slash className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-sans font-semibold text-theme-text-primary">Blocked Users</h4>
                    <p className="text-[10px] text-theme-text-secondary mt-0.5">Manage blocklist, restrict users</p>
                  </div>
                </button>

                {/* Security tracking */}
                <button
                  onClick={() => changeSection("security")}
                  className="w-full px-4 py-3.5 hover:bg-theme-card-hover flex items-center gap-3.5 text-left border-b border-theme-border transition cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-theme-primary/10 flex items-center justify-center text-theme-primary">
                    <ShieldCheck className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-sans font-semibold text-theme-text-primary">Security & Devices</h4>
                    <p className="text-[10px] text-theme-text-secondary mt-0.5">Active session logs & trusted devices</p>
                  </div>
                </button>

                {/* Recently Deleted Sessions */}
                <button
                  id="settings-recently-deleted-btn"
                  onClick={() => changeSection("recentlyDeleted")}
                  className="w-full px-4 py-3.5 hover:bg-theme-card-hover flex items-center gap-3.5 text-left border-b border-theme-border transition cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-[#C9A96E]/15 flex items-center justify-center text-[#C9A96E]">
                    <RotateCcw className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-sans font-semibold text-theme-text-primary">Recently Deleted</h4>
                      {deletedSessions.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#C9A96E]/20 text-[#0D0D0F] border border-[#C9A96E]/40">
                          {deletedSessions.length}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-theme-text-secondary mt-0.5 truncate">Restore or manage deleted swap sessions</p>
                  </div>
                </button>

                {/* Help */}
                <button
                  onClick={() => changeSection("help")}
                  className="w-full px-4 py-3.5 hover:bg-theme-card-hover flex items-center gap-3.5 text-left border-b border-theme-border transition cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-theme-primary/10 flex items-center justify-center text-theme-primary">
                    <HelpCircle className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-sans font-semibold text-theme-text-primary">Help & FAQ</h4>
                    <p className="text-[10px] text-theme-text-secondary mt-0.5">Knowledge base & support contact</p>
                  </div>
                </button>

                {/* About */}
                <button
                  onClick={() => changeSection("about")}
                  className="w-full px-4 py-3.5 hover:bg-theme-card-hover flex items-center gap-3.5 text-left transition cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-theme-secondary/10 flex items-center justify-center text-theme-text-secondary">
                    <Info className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-sans font-semibold text-theme-text-primary">About SwapSkill</h4>
                    <p className="text-[10px] text-theme-text-secondary mt-0.5">App version, licenses & terms</p>
                  </div>
                </button>
              </div>

              {/* Prominent High-Contrast Log Out Button */}
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                className="w-full h-12 mt-2 bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white rounded-2xl font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-md hover:shadow-lg select-none"
              >
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <LogOut className="w-3.5 h-3.5 text-white stroke-[2.5]" />
                </div>
                <span>Log Out of Account</span>
              </button>

            </div>
          </motion.div>
        )}

        {/* 1. Account & Privacy Section */}
        {activeSection === "account" && (
          <motion.div
            key="account"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Account & Privacy", () => { setActiveSection("menu"); setAccountStatusMsg(null); setIsConfirmingDelete(false); })}
            <div className="px-5 pt-5 pb-36 flex flex-col gap-4">
              
              <form onSubmit={handleUpdateAccount} className="flex flex-col gap-4">
                <div className="bg-theme-surface border border-theme-border p-4 rounded-2xl flex flex-col gap-3.5 shadow-sm">
                  <span className="text-[9px] font-mono text-theme-primary uppercase tracking-widest font-bold">Manage Credentials</span>
                  
                  {/* Email Address */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-theme-text-secondary font-sans font-semibold uppercase tracking-wider">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-secondary" />
                      <input
                        type="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="w-full h-11 pl-10 pr-4 bg-theme-input border border-theme-input-border rounded-xl text-xs text-theme-text-primary focus:border-theme-primary/50 focus:ring-1 focus:ring-theme-primary/20 outline-none transition"
                        placeholder="yourname@domain.com"
                      />
                    </div>
                  </div>

                  {/* New Password */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-theme-text-secondary font-sans font-semibold uppercase tracking-wider">New Password (6+ chars)</label>
                    <div className="relative">
                      <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-secondary" />
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full h-11 pl-10 pr-4 bg-theme-input border border-theme-input-border rounded-xl text-xs text-theme-text-primary focus:border-theme-primary/50 focus:ring-1 focus:ring-theme-primary/20 outline-none transition"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  {/* Confirm Password */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-theme-text-secondary font-sans font-semibold uppercase tracking-wider">Confirm New Password</label>
                    <div className="relative">
                      <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-secondary" />
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full h-11 pl-10 pr-4 bg-theme-input border border-theme-input-border rounded-xl text-xs text-theme-text-primary focus:border-theme-primary/50 focus:ring-1 focus:ring-theme-primary/20 outline-none transition"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </div>

                {accountStatusMsg && (
                  <div className={`p-3.5 rounded-xl text-xs border ${
                    accountStatusMsg.type === "success" 
                      ? "bg-theme-success/10 border-theme-success/20 text-theme-success" 
                      : "bg-theme-danger/10 border-theme-danger/20 text-theme-danger"
                  }`}>
                    {accountStatusMsg.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isUpdatingAccount}
                  className="w-full h-11 bg-theme-primary disabled:bg-theme-surface-secondary text-theme-bg font-bold text-xs tracking-wider uppercase rounded-xl transition cursor-pointer flex items-center justify-center gap-2 shadow-md"
                >
                  {isUpdatingAccount ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-theme-bg" />
                      <span>Saving updates...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </form>

              {/* Privacy & Stealth Settings embedded inside Account */}
              <div className="flex flex-col gap-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-theme-primary uppercase tracking-widest font-bold">Privacy & Stealth Controls</span>
                  {savingPrivacyMsg && (
                    <span className="text-[10px] text-emerald-600 font-semibold animate-pulse">{savingPrivacyMsg}</span>
                  )}
                </div>

                <div className="p-4 bg-theme-surface border border-theme-border rounded-2xl flex items-center justify-between shadow-sm">
                  <div className="flex-1 pr-4">
                    <h4 className="text-xs font-sans font-semibold text-theme-text-primary">Stealth Profile Mode</h4>
                    <p className="text-[9px] text-theme-text-secondary mt-0.5 leading-relaxed">Only followed users can browse your skill list and bio details</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleStealth}
                    aria-label="Toggle Stealth Profile Mode"
                    className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-200 ease-in-out cursor-pointer p-0.5 select-none shrink-0 ${
                      isStealthMode ? "bg-indigo-600" : "bg-slate-300 dark:bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                        isStealthMode ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                <div className="p-4 bg-theme-surface border border-theme-border rounded-2xl flex items-center justify-between shadow-sm">
                  <div className="flex-1 pr-4">
                    <h4 className="text-xs font-sans font-semibold text-theme-text-primary">Active Online State</h4>
                    <p className="text-[9px] text-theme-text-secondary mt-0.5 leading-relaxed">Broadcast online status inside active chats and lists</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleOnlineVisible}
                    aria-label="Toggle Active Online State"
                    className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-200 ease-in-out cursor-pointer p-0.5 select-none shrink-0 ${
                      isOnlineVisible ? "bg-emerald-500" : "bg-slate-300 dark:bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                        isOnlineVisible ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Log Out Option inside Account */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(true)}
                  className="w-full h-11 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md select-none"
                >
                  <LogOut className="w-4 h-4 text-white" />
                  <span>Log Out of Session</span>
                </button>
              </div>

              {/* Delete Account Danger Area */}
              <div className="mt-2 bg-theme-danger/5 border border-theme-danger/15 p-4 rounded-2xl flex flex-col gap-3 shadow-sm">
                <div className="flex items-center gap-2 text-theme-danger font-bold text-xs">
                  <AlertTriangle className="w-4.5 h-4.5 animate-bounce" />
                  <span>DANGER ZONE</span>
                </div>
                <p className="text-[10px] text-theme-danger/80 leading-relaxed">
                  Permanently deletes your profile, skills record, and authentic credentials. This cannot be undone.
                </p>

                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full py-2.5 bg-theme-danger/10 hover:bg-theme-danger/20 border border-theme-danger/20 text-theme-danger font-bold text-[10px] uppercase tracking-wider rounded-xl cursor-pointer transition"
                >
                  Delete Account Permanently
                </button>
              </div>

            </div>
          </motion.div>
        )}

        {/* 3. Notifications Section */}
        {activeSection === "notifications" && (
          <motion.div
            key="notifications"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Notifications", () => { setActiveSection("menu"); })}
            <div className="px-5 pt-5 pb-36 flex flex-col gap-3.5">
              <span className="text-[9px] font-mono text-theme-primary uppercase tracking-widest font-bold">Delivery Switches</span>

              {[
                { key: "directMessages" as const, title: "Direct Chat Messages", desc: "Push notification on incoming premium messages" },
                { key: "bookingRequests" as const, title: "Skill Booking Requests", desc: "Notify when colleagues submit session requests" },
                { key: "newFollowers" as const, title: "New Subscriber Followers", desc: "Toast alerting when a practitioner follows you" },
                { key: "completedReviews" as const, title: "Completed Session Reviews", desc: "Notify upon receiving a review or skill credit" }
              ].map((opt) => {
                const isOn = notifSettings[opt.key];
                return (
                  <div key={opt.key} className="p-4 bg-theme-surface border border-theme-border rounded-2xl flex items-center justify-between shadow-sm">
                    <div className="flex-1 pr-4">
                      <h4 className="text-xs font-sans font-semibold text-theme-text-primary">{opt.title}</h4>
                      <p className="text-[9px] text-theme-text-secondary mt-0.5 leading-relaxed">{opt.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleNotif(opt.key)}
                      aria-label={`Toggle ${opt.title}`}
                      className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-200 ease-in-out cursor-pointer p-0.5 select-none shrink-0 ${
                        isOn ? "bg-emerald-500" : "bg-slate-300 dark:bg-zinc-700"
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                          isOn ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* 4. Privacy Section */}
        {activeSection === "privacy" && (
          <motion.div
            key="privacy"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Privacy Settings", () => setActiveSection("menu"))}
            <div className="px-5 pt-5 pb-36 flex flex-col gap-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-mono text-theme-primary uppercase tracking-widest font-bold">Stealth Settings</span>
                {savingPrivacyMsg && (
                  <span className="text-[10px] text-emerald-600 font-semibold animate-pulse">{savingPrivacyMsg}</span>
                )}
              </div>

              <div className="p-4 bg-theme-surface border border-theme-border rounded-2xl flex items-center justify-between shadow-sm">
                <div className="flex-1 pr-4">
                  <h4 className="text-xs font-sans font-semibold text-theme-text-primary">Stealth Profile Mode</h4>
                  <p className="text-[9px] text-theme-text-secondary mt-0.5 leading-relaxed">Only followed users can browse your skill list and bio details</p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleStealth}
                  aria-label="Toggle Stealth Profile Mode"
                  className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-200 ease-in-out cursor-pointer p-0.5 select-none shrink-0 ${
                    isStealthMode ? "bg-indigo-600" : "bg-slate-300 dark:bg-zinc-700"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                      isStealthMode ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="p-4 bg-theme-surface border border-theme-border rounded-2xl flex items-center justify-between shadow-sm">
                <div className="flex-1 pr-4">
                  <h4 className="text-xs font-sans font-semibold text-theme-text-primary">Active Online State</h4>
                  <p className="text-[9px] text-theme-text-secondary mt-0.5 leading-relaxed">Broadcast online status inside active chats and lists</p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleOnlineVisible}
                  aria-label="Toggle Active Online State"
                  className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-200 ease-in-out cursor-pointer p-0.5 select-none shrink-0 ${
                    isOnlineVisible ? "bg-emerald-500" : "bg-slate-300 dark:bg-zinc-700"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                      isOnlineVisible ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* 5. Blocked Users Section */}
        {activeSection === "blocked" && (
          <motion.div
            key="blocked"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Blocked Users", () => setActiveSection("menu"))}
            <div className="px-5 pt-5 pb-36 flex flex-col gap-3">
              <span className="text-[9px] font-mono text-theme-primary uppercase tracking-widest font-bold">Restricted Connections</span>

              {loadingBlocked ? (
                <div className="flex items-center justify-center py-12 gap-2 text-theme-text-secondary text-xs font-mono">
                  <Loader2 className="w-4 h-4 animate-spin text-theme-primary" /> LOADING RESTRICTIONS...
                </div>
              ) : blockedIds.length === 0 ? (
                <div className="py-16 text-center text-theme-text-secondary flex flex-col items-center gap-2">
                  <CheckCircle className="w-8 h-8 text-theme-text-secondary/40" />
                  <p className="text-xs font-mono uppercase tracking-widest text-theme-text-secondary">Zero blocks</p>
                  <p className="text-[10px] text-theme-text-secondary max-w-[210px] leading-relaxed">
                    Practitioners you lock will appear in this list. Blocked users cannot follow, chat or book with you.
                  </p>
                </div>
              ) : (
                blockedIds.map((id) => {
                  const p = blockedProfiles[id];
                  return (
                    <div
                      key={id}
                      className="p-3 bg-theme-surface border border-theme-border rounded-2xl flex items-center justify-between gap-3 shadow-sm"
                    >
                      <div className="w-9 h-9 rounded-full overflow-hidden border border-theme-border shrink-0">
                        {p ? (
                          <SmartImage
                            src={p.photoUrl || p.photoURL}
                            alt={p.fullName}
                            fallbackType="profile"
                            fullName={p.fullName}
                          />
                        ) : (
                          <div className="w-full h-full bg-theme-bg" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-sans font-bold text-theme-text-primary truncate">
                          {p?.fullName || "Member Node"}
                        </h4>
                        <span className="text-[9px] font-mono text-theme-text-secondary block truncate mt-0.5">
                          @{p?.username || "loading"}
                        </span>
                      </div>

                      <button
                        onClick={() => handleUnblock(id)}
                        disabled={unblockingId === id}
                        className="px-3.5 h-8 bg-theme-danger/10 hover:bg-theme-danger/20 border border-theme-danger/20 hover:border-theme-danger/40 rounded-xl text-theme-danger font-bold text-[10px] tracking-wider uppercase flex items-center justify-center transition cursor-pointer"
                      >
                        {unblockingId === id ? (
                          <Loader2 className="w-3 h-3 animate-spin text-theme-danger" />
                        ) : (
                          "Unblock"
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}

        {/* 6. Security Section */}
        {activeSection === "security" && (
          <motion.div
            key="security"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Security & Devices", () => setActiveSection("menu"))}
            <div className="px-5 pt-5 pb-36 flex flex-col gap-4">
              <span className="text-[9px] font-mono text-theme-primary uppercase tracking-widest font-bold">Session Integrity</span>

              {/* Secure statement */}
              <div className="p-4 bg-theme-success/5 border border-theme-success/15 text-theme-success rounded-2xl text-xs flex items-start gap-2.5 leading-relaxed shadow-sm">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-theme-success" />
                <div>
                  <h5 className="font-bold text-theme-text-primary">Device verification active</h5>
                  <p className="text-[10px] text-theme-text-secondary mt-1 leading-normal">
                    This browser is verified as a trusted device. Your cryptographic session operations are fully isolated.
                  </p>
                </div>
              </div>

              {/* Login history */}
              <div className="flex flex-col bg-theme-surface border border-theme-border p-4 rounded-2xl gap-3 shadow-sm">
                <div className="flex items-center gap-2 text-theme-text-secondary text-xs font-bold">
                  <Clock className="w-4 h-4 text-theme-primary" />
                  <span>Recent Login Sessions</span>
                </div>

                <div className="divide-y divide-theme-border text-[10px] font-mono text-theme-text-secondary">
                  <div className="py-2 flex justify-between">
                    <span>Chrome / Linux (Current Device)</span>
                    <span className="text-theme-success font-sans font-semibold">Active Now</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span>Mobile Safari / iPhone</span>
                    <span>3 hours ago</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span>Edge / Windows</span>
                    <span>Yesterday</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* 7. Help Section */}
        {activeSection === "help" && (
          <motion.div
            key="help"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Help & FAQs", () => setActiveSection("menu"))}
            <div className="px-5 pt-5 pb-36 flex flex-col gap-4">
              <span className="text-[9px] font-mono text-theme-primary uppercase tracking-widest font-bold">SwapSkill HelpDesk</span>

              {[
                { q: "How do skill swap points work?", a: "Each member earns points when teaching a session. Earned points can be spent to register for learning other practitioners' skills." },
                { q: "What happens if a user is blocked?", a: "Blocked members cannot find your profile, view list updates, message you in chats, or request scheduling." },
                { q: "How do I request a verification badge?", a: "Badge verifications are certified manually by team moderators when proof of craft expertise is uploaded." }
              ].map((faq, idx) => (
                <div key={idx} className="p-4 bg-theme-surface border border-theme-border rounded-2xl flex flex-col gap-1.5 shadow-sm">
                  <h4 className="text-xs font-sans font-bold text-theme-text-primary">{faq.q}</h4>
                  <p className="text-[10px] text-theme-text-secondary leading-relaxed">{faq.a}</p>
                </div>
              ))}

              <div className="p-5 border border-dashed border-theme-border rounded-2xl flex flex-col items-center text-center gap-1.5 py-6">
                <Mail className="w-6 h-6 text-theme-primary" />
                <h4 className="text-xs font-sans font-bold text-theme-text-primary">Have more questions?</h4>
                <p className="text-[10px] text-theme-text-secondary leading-normal max-w-[200px]">
                  Submit support inquiries or security reports directly to our helpdesk.
                </p>
                <a href="mailto:support@swapskill.app" className="text-[10px] font-mono text-theme-primary underline mt-1">
                  support@swapskill.app
                </a>
              </div>
            </div>
          </motion.div>
        )}

        {/* 8. About Section */}
        {activeSection === "about" && (
          <motion.div
            key="about"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("About SwapSkill", () => setActiveSection("menu"))}
            <div className="px-5 pt-5 pb-36 flex flex-col gap-4 items-center text-center">
              
              {/* App Logo */}
              <div className="w-16 h-16 rounded-2xl border border-theme-border overflow-hidden shadow-xl mt-6 bg-theme-surface">
                <img src={logoImg} alt="SwapSkill Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>

              <div className="mt-2">
                <h4 className="text-sm font-sans font-bold text-theme-text-primary">SwapSkill Premium</h4>
                <p className="text-[9px] font-mono text-theme-text-secondary mt-1 uppercase tracking-widest">Version 1.0.4 (Stable)</p>
              </div>

              <div className="p-4.5 bg-theme-surface border border-theme-border rounded-2xl text-[10px] text-theme-text-secondary leading-relaxed text-left mt-4 w-full shadow-sm">
                SwapSkill is a high-trust peer-to-peer knowledge swapping platform enabling skilled practitioners to barter expertise, book schedules, and grow their craft networks globally without financial barriers.
              </div>

              <div className="text-[9px] font-mono text-theme-text-secondary/60 mt-8">
                © 2026 SwapSkill Inc. All rights reserved.
              </div>

            </div>
          </motion.div>
        )}

        {/* 9. Recently Deleted Sessions Section */}
        {activeSection === "recentlyDeleted" && (
          <motion.div
            key="recentlyDeleted"
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            className="flex-1 flex flex-col"
          >
            {renderHeader("Recently Deleted", () => setActiveSection("menu"))}

            <div className="px-5 pt-4 pb-36 flex flex-col gap-4">
              
              {/* Banner Explanation */}
              <div className="p-4 rounded-2xl bg-[#F7F4EE] border border-[#E8E4DB] flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#0D0D0F] flex items-center justify-center shrink-0 text-[#C9A96E]">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-semibold text-[#0D0D0F]">30-Day Retention Policy</h4>
                  <p className="text-[11px] text-[#71717A] mt-0.5 leading-relaxed">
                    Deleted swap sessions are kept here for exactly 30 days. You can restore them anytime to your schedule or permanently delete them now.
                  </p>
                </div>
              </div>

              {/* Toast Feedback */}
              {trashToast && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3.5 rounded-2xl text-xs flex items-center gap-2.5 border shadow-sm ${
                    trashToast.type === "success"
                      ? "bg-[#F7F4EE] border-[#C9A96E]/40 text-[#0D0D0F]"
                      : "bg-[#FEF2F2] border-[#FCA5A5] text-[#991B1B]"
                  }`}
                >
                  {trashToast.type === "success" ? (
                    <CheckCircle className="w-4 h-4 text-[#C9A96E] shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-[#DC2626] shrink-0" />
                  )}
                  <span className="font-medium text-xs flex-1">{trashToast.text}</span>
                </motion.div>
              )}

              {/* Search Bar if multiple items */}
              {deletedSessions.length > 2 && (
                <div className="relative">
                  <Search className="w-4 h-4 text-[#71717A] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={trashSearchQuery}
                    onChange={(e) => setTrashSearchQuery(e.target.value)}
                    placeholder="Search deleted sessions by partner or skill..."
                    className="w-full h-10 pl-9 pr-3.5 text-xs rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] text-[#0D0D0F] placeholder-[#A1A1AA] focus:outline-none focus:border-[#C9A96E]"
                  />
                  {trashSearchQuery && (
                    <button
                      onClick={() => setTrashSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#71717A] hover:text-[#0D0D0F]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {/* List of Deleted Sessions */}
              {filteredDeletedSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-16 px-4 gap-3 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl shadow-2xs">
                  <div className="w-14 h-14 rounded-2xl bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-center text-[#C9A96E]">
                    <Trash2 className="w-6 h-6 stroke-[1.75]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#0D0D0F]">
                      {trashSearchQuery ? "No matches found" : "No recently deleted sessions"}
                    </h3>
                    <p className="text-[#71717A] text-xs mt-1 max-w-xs leading-relaxed">
                      {trashSearchQuery
                        ? "Try adjusting your search keywords."
                        : "Sessions you delete will be held here for 30 days before permanent automatic cleanup."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3.5">
                  {filteredDeletedSessions.map((session) => {
                    const isTeacher = session.teacherId === currentUserId;
                    const partnerId = isTeacher ? (session.learnerId || session.studentId) : session.teacherId;
                    const partnerProfile = partnerId ? profilesCache[partnerId] : null;
                    const otherName = isTeacher
                      ? (session.learnerName || session.studentName || partnerProfile?.fullName || "Swap Partner")
                      : (session.teacherName || partnerProfile?.fullName || "Swap Partner");

                    const daysLeft = getDaysRemaining(session.deletedAt);
                    const isExpired = isDeletedSessionExpired(session.deletedAt);

                    // Original scheduled time
                    const schedMs = getTimestampMs(session.scheduledTime);
                    const schedDateStr = schedMs
                      ? new Date(schedMs).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) +
                        " • " +
                        new Date(schedMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                      : "Not set";

                    // Deleted timestamp
                    const delMs = getTimestampMs(session.deletedAt);
                    const delDateStr = delMs
                      ? new Date(delMs).toLocaleDateString([], { month: "short", day: "numeric" })
                      : "Recently";

                    const isRestoring = restoringSessionId === session.id;

                    return (
                      <div
                        key={session.id}
                        id={`deleted-session-card-${session.id}`}
                        className="p-4 sm:p-5 rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] flex flex-col gap-3.5 shadow-2xs transition-all hover:border-[#C9A96E]/50"
                      >
                        {/* Header: Partner + Days Remaining Badge */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full overflow-hidden border border-[#E8E4DB] bg-[#F7F4EE] shrink-0">
                              <img
                                src={partnerProfile?.profilePhotoUrl || partnerProfile?.photoUrl || DEFAULT_AVATAR}
                                alt={otherName}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-[#0D0D0F] truncate">{otherName}</h4>
                              <p className="text-[10px] text-[#71717A] mt-0.5">
                                {isTeacher ? "Your Learner" : "Your Mentor"} • {session.sessionType || "Video Call"}
                              </p>
                            </div>
                          </div>

                          {/* Retention Countdown Pill */}
                          <div className={`px-2.5 py-1 rounded-full text-[10px] font-semibold flex items-center gap-1.5 shrink-0 border ${
                            daysLeft <= 3
                              ? "bg-[#FEF2F2] border-[#FCA5A5] text-[#991B1B]"
                              : "bg-[#F7F4EE] border-[#C9A96E]/40 text-[#0D0D0F]"
                          }`}>
                            <Clock className={`w-3 h-3 ${daysLeft <= 3 ? "text-[#DC2626]" : "text-[#C9A96E]"}`} />
                            <span>
                              {daysLeft === 0 ? "Expires today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                            </span>
                          </div>
                        </div>

                        {/* Skill / Topic Title */}
                        <div className="pt-0.5">
                          <h3 className="font-semibold text-sm text-[#0D0D0F] leading-snug">
                            {session.skillName || session.skill || "Skill Exchange Session"}
                          </h3>
                        </div>

                        {/* Metadata Box: Original Date vs Deleted Date */}
                        <div className="grid grid-cols-2 gap-2 bg-[#F7F4EE] p-3 rounded-xl border border-[#E8E4DB] text-[11px]">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] uppercase font-bold text-[#71717A] tracking-wider">Original Date</span>
                            <span className="font-medium text-[#0D0D0F] truncate">{schedDateStr}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] uppercase font-bold text-[#71717A] tracking-wider">Deleted Date</span>
                            <span className="font-medium text-[#71717A] truncate">{delDateStr}</span>
                          </div>
                        </div>

                        {/* Action Buttons: Restore & Delete Permanently */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            id={`restore-session-btn-${session.id}`}
                            type="button"
                            disabled={isRestoring || isExpired}
                            onClick={() => handleRestoreSession(session)}
                            className="h-10 px-3 rounded-xl bg-[#0D0D0F] hover:bg-[#1A1A1D] disabled:opacity-50 text-[#F7F4EE] font-semibold text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                          >
                            {isRestoring ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A96E]" />
                                <span>Restoring...</span>
                              </>
                            ) : (
                              <>
                                <RotateCcw className="w-3.5 h-3.5 text-[#C9A96E]" />
                                <span>Restore</span>
                              </>
                            )}
                          </button>

                          <button
                            id={`perm-delete-session-btn-${session.id}`}
                            type="button"
                            onClick={() => setPermanentDeleteTarget(session)}
                            className="h-10 px-3 rounded-xl bg-[#FFFFFF] hover:bg-[#FEF2F2] border border-[#E8E4DB] hover:border-[#FCA5A5] text-[#71717A] hover:text-[#DC2626] font-semibold text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete permanently</span>
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

      </AnimatePresence>

      {/* ========================================================================= */}
      {/* PERMANENT DELETE CONFIRMATION DIALOG MODAL                                */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {permanentDeleteTarget && (() => {
          const isTeacher = permanentDeleteTarget.teacherId === currentUserId;
          const partnerId = isTeacher ? (permanentDeleteTarget.learnerId || permanentDeleteTarget.studentId) : permanentDeleteTarget.teacherId;
          const partnerProfile = partnerId ? profilesCache[partnerId] : null;
          const otherName = isTeacher
            ? (permanentDeleteTarget.learnerName || permanentDeleteTarget.studentName || partnerProfile?.fullName || "Swap Partner")
            : (permanentDeleteTarget.teacherName || partnerProfile?.fullName || "Swap Partner");

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
              
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (!isDeletingPermanently) setPermanentDeleteTarget(null);
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
                <div className="w-12 h-12 rounded-2xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-center justify-center text-[#DC2626] mx-auto shadow-sm">
                  <AlertTriangle className="w-6 h-6 stroke-[2]" />
                </div>

                <div className="text-center">
                  <h3 className="text-base font-bold text-[#0D0D0F]">Delete permanently?</h3>
                  <p className="text-xs text-[#DC2626] font-semibold mt-1">
                    This session will be permanently deleted and cannot be recovered.
                  </p>
                  <p className="text-xs text-[#71717A] mt-2 leading-relaxed">
                    Session record for <span className="font-semibold text-[#0D0D0F]">"{permanentDeleteTarget.skillName || permanentDeleteTarget.skill || 'Session'}"</span> with <span className="font-semibold text-[#0D0D0F]">{otherName}</span> will be completely removed from Firestore.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-2">
                  <button
                    id="cancel-permanent-delete-btn"
                    type="button"
                    disabled={isDeletingPermanently}
                    onClick={() => setPermanentDeleteTarget(null)}
                    className="h-11 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F7F4EE] text-[#0D0D0F] font-semibold text-xs transition cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    id="confirm-permanent-delete-btn"
                    type="button"
                    disabled={isDeletingPermanently}
                    onClick={handleConfirmPermanentDelete}
                    className="h-11 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-md active:scale-95"
                  >
                    {isDeletingPermanently ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>Deleting...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4 text-white" />
                        <span>Delete Forever</span>
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
