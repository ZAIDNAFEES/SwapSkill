import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  AlertTriangle, 
  Loader2, 
  CheckCircle2, 
  Trash2, 
  LogOut, 
  User 
} from "lucide-react";
import { 
  doc, 
  deleteDoc, 
  collection, 
  getDocs, 
  query, 
  where, 
  writeBatch 
} from "firebase/firestore";
import { deleteUser, signOut } from "firebase/auth";
import { db, auth } from "../firebase";
import { useApp } from "../context/AppContext";
import SmartImage from "./SmartImage";
import { safeLocalStorage } from "../utils/safeStorage";

// Custom premium toast
export function PremiumToast({ message, type, onClose }: { message: string, type: "success" | "error", onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.9 }}
      className={`fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-5 py-3.5 rounded-2xl border backdrop-blur-xl shadow-2xl ${
        type === "success" 
          ? "bg-emerald-50 border-emerald-200 text-emerald-700" 
          : "bg-rose-50 border-rose-200 text-rose-700"
      }`}
    >
      {type === "success" ? (
        <CheckCircle2 size={16} className="text-emerald-400 shrink-0 animate-bounce" />
      ) : (
        <AlertTriangle size={16} className="text-rose-400 shrink-0 animate-pulse" />
      )}
      <span className="text-xs font-medium tracking-wide">{message}</span>
      <button onClick={onClose} className="text-zinc-500 hover:text-white transition cursor-pointer">
        <X size={14} />
      </button>
    </motion.div>
  );
}

// 1. LOGOUT CONFIRMATION BOTTOM SHEET
interface LogoutConfirmSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LogoutConfirmSheet({ isOpen, onClose }: LogoutConfirmSheetProps) {
  const { currentUserProfile, setShowLogoutConfirm } = useApp();
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Focus management
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Handle Sign Out Process
  const handleSignOut = async () => {
    if (loading) return;
    setLoading(true);
    try {
      // 1. Clear cached user session & local storage
      safeLocalStorage.removeItem("swap_cache_user_profile");
      safeLocalStorage.removeItem("swap_cache_profiles_map");
      safeLocalStorage.removeItem("swap_cache_messages_map");
      
      // 3. Clear temporary states and navigate
      // Firebase auth signout
      await signOut(auth);

      // Force-reload the browser state to clear memory structures
      window.location.href = "/";
    } catch (err) {
      console.error("Logout failed:", err);
      setToastMsg("Couldn't sign out. Please try again.");
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <AnimatePresence>
        <div className="fixed inset-0 z-[150] overflow-hidden select-none">
          {/* Backdrop blur glassmorphism */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              if (!loading) onClose();
            }}
            className="absolute inset-0 bg-black/30 backdrop-blur-[4px] cursor-pointer"
          />

          {/* Bottom Sheet Modal Container */}
          <div className="absolute inset-x-0 bottom-0 flex justify-center p-4">
            <motion.div
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0.5 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-md bg-white border border-gray-200 rounded-[24px] shadow-2xl p-6 pb-8 flex flex-col gap-6 relative"
            >
              {/* Swipe handle */}
              <div 
                onClick={onClose}
                className="w-12 h-1 bg-gray-200 rounded-full mx-auto -mt-2 mb-2 cursor-pointer hover:bg-gray-300 transition" 
              />

              {/* Title & Description */}
              <div className="flex flex-col gap-1.5 text-center mt-1">
                <h3 className="font-sans font-bold text-lg text-gray-900">Sign out?</h3>
                <p className="text-xs text-gray-500 leading-relaxed max-w-[320px] mx-auto">
                  You'll need to sign in again to access your SwapSkill account.
                </p>
              </div>

              {/* Current Account Profile Info Card */}
              {currentUserProfile && (
                <div className="flex items-center gap-4 bg-slate-50 border border-gray-200 p-4 rounded-2xl">
                  <SmartImage
                    src={currentUserProfile.photoUrl || currentUserProfile.profilePhotoUrl}
                    alt={currentUserProfile.fullName}
                    className="w-12 h-12 rounded-full border border-gray-200 object-cover"
                    fallbackType="profile"
                    fullName={currentUserProfile.fullName}
                    sizeType="thumbnail"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900 truncate leading-snug">{currentUserProfile.fullName}</p>
                    <p className="text-xs text-gray-500 truncate font-mono">@{currentUserProfile.username}</p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col gap-2.5">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  disabled={loading}
                  onClick={handleSignOut}
                  className="w-full h-12 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-bold text-xs tracking-wide uppercase rounded-xl transition cursor-pointer flex items-center justify-center gap-2 border border-red-600"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Signing out...</span>
                    </>
                  ) : (
                    <>
                      <LogOut size={13} />
                      <span>Sign Out</span>
                    </>
                  )}
                </motion.button>

                <motion.button
                  ref={cancelButtonRef}
                  whileTap={{ scale: 0.97 }}
                  disabled={loading}
                  onClick={onClose}
                  className="w-full h-12 bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-gray-700 font-bold text-xs tracking-wide uppercase rounded-xl transition cursor-pointer flex items-center justify-center border border-gray-200"
                >
                  Cancel
                </motion.button>
              </div>
            </motion.div>
          </div>
        </div>
      </AnimatePresence>

      {/* Premium Failure Toast */}
      <AnimatePresence>
        {toastMsg && (
          <PremiumToast message={toastMsg} type="error" onClose={() => setToastMsg(null)} />
        )}
      </AnimatePresence>
    </>
  );
}


// 2. DELETE ACCOUNT CONFIRMATION BOTTOM SHEET
interface DeleteAccountConfirmSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DeleteAccountConfirmSheet({ isOpen, onClose }: DeleteAccountConfirmSheetProps) {
  const { currentUserId, setShowDeleteConfirm } = useApp();
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Focus management
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Keyboard Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Deep deletion cleanup logic
  const performDeepDeletion = async () => {
    const batch = writeBatch(db);
    
    // 1. Delete Firestore User document
    const userRef = doc(db, "users", currentUserId);
    batch.delete(userRef);

    // 2. Delete User Presence document
    const presenceRef = doc(db, "userPresence", currentUserId);
    batch.delete(presenceRef);

    // 3. Delete user subcollection (notifications, blocked users)
    try {
      const notifsSnap = await getDocs(collection(db, "users", currentUserId, "notifications"));
      notifsSnap.forEach((doc) => batch.delete(doc.ref));

      const blockedSnap = await getDocs(collection(db, "users", currentUserId, "blockedUsers"));
      blockedSnap.forEach((doc) => batch.delete(doc.ref));
    } catch (e) {
      console.warn("Could not retrieve notifications subcollection for delete:", e);
    }

    // 4. Update/Delete related Sessions
    try {
      const sessionsTeacherQuery = query(collection(db, "sessions"), where("teacherId", "==", currentUserId));
      const sessionsLearnerQuery = query(collection(db, "sessions"), where("learnerId", "==", currentUserId));

      const [teacherSnap, learnerSnap] = await Promise.all([
        getDocs(sessionsTeacherQuery),
        getDocs(sessionsLearnerQuery)
      ]);

      teacherSnap.forEach((doc) => batch.delete(doc.ref));
      learnerSnap.forEach((doc) => batch.delete(doc.ref));
    } catch (e) {
      console.warn("Could not clean up related sessions:", e);
    }

    // 5. Update/Delete related Chats
    try {
      const chatsQuery = query(collection(db, "chats"), where("participantIds", "array-contains", currentUserId));
      const chatsSnap = await getDocs(chatsQuery);
      chatsSnap.forEach((doc) => batch.delete(doc.ref));
    } catch (e) {
      console.warn("Could not clean up related chats:", e);
    }

    // Commit batch
    await batch.commit();
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== "DELETE" || loading) return;
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("No authenticated user session found.");
      }

      // 1. Perform database cleanups
      await performDeepDeletion();

      // 2. Delete user in Firebase Authentication
      await deleteUser(user);

      // Show success animation
      setIsSuccess(true);
      
      // Delay navigation to let animation play
      setTimeout(() => {
        // Clear all localized caches
        safeLocalStorage.clear();

        // Redirect to initial login
        window.location.href = "/";
      }, 1500);

    } catch (err: any) {
      console.error("Account deletion failed:", err);
      if (err.code === "auth/requires-recent-login") {
        setToastMsg("Requires fresh login. Please log out and sign back in to delete.");
      } else {
        setToastMsg("Couldn't delete account. Please try again.");
      }
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <AnimatePresence>
        <div className="fixed inset-0 z-[150] overflow-hidden select-none">
          {/* Backdrop blur glassmorphism */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              if (!loading && !isSuccess) onClose();
            }}
            className="absolute inset-0 bg-black/30 backdrop-blur-[4px] cursor-pointer"
          />

          {/* Bottom Sheet Modal Container */}
          <div className="absolute inset-x-0 bottom-0 flex justify-center p-4">
            <motion.div
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0.5 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-md bg-white border border-gray-200 rounded-[24px] shadow-2xl p-6 pb-8 flex flex-col gap-5 relative overflow-hidden"
            >
              {/* Success Screen Overlay */}
              <AnimatePresence>
                {isSuccess && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-white z-10 flex flex-col items-center justify-center gap-4 p-6"
                  >
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    >
                      <CheckCircle2 size={56} className="text-emerald-600 animate-pulse" />
                    </motion.div>
                    <div className="text-center flex flex-col gap-1">
                      <h4 className="text-base font-bold text-gray-900">Account Deleted</h4>
                      <p className="text-xs text-gray-500">All data wiped successfully. Fare thee well.</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Swipe handle */}
              <div 
                onClick={onClose}
                className="w-12 h-1 bg-gray-200 rounded-full mx-auto -mt-2 mb-2 cursor-pointer hover:bg-gray-300 transition" 
              />

              {/* Title & Description */}
              <div className="flex flex-col gap-1 text-center">
                <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mx-auto mb-1 animate-pulse">
                  <AlertTriangle size={18} />
                </div>
                <h3 className="font-sans font-bold text-lg text-gray-900">Delete Account?</h3>
                <p className="text-xs text-gray-500 leading-relaxed max-w-[320px] mx-auto">
                  This action is permanent and cannot be undone. All your details will be wiped.
                </p>
              </div>

              {/* Details of items deleted */}
              <div className="bg-slate-50 border border-gray-200 rounded-2xl p-4 flex flex-col gap-2">
                <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">The following will be permanently removed:</span>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-700">
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-rose-500" />
                    <span>User Profile</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-rose-500" />
                    <span>All Chats & Logs</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-rose-500" />
                    <span>Learning History</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-rose-500" />
                    <span>Reviews & Ratings</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-rose-500" />
                    <span>Uploaded Media</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-rose-500" />
                    <span>Presence Tokens</span>
                  </li>
                </ul>
              </div>

              {/* Confirmation Input Step */}
              <div className="flex flex-col gap-2 mt-1">
                <label className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">
                  Type exactly <strong className="text-rose-600 font-mono">DELETE</strong> to confirm:
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type DELETE..."
                  className="w-full h-11 px-4 bg-slate-50 border border-gray-200 rounded-xl text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-rose-500 focus:bg-white tracking-wider font-semibold transition"
                />
              </div>

              {/* Buttons */}
              <div className="flex flex-col gap-2.5 mt-1">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  disabled={confirmText !== "DELETE" || loading}
                  onClick={handleDeleteAccount}
                  className="w-full h-12 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-200 disabled:text-gray-400 text-white font-bold text-xs tracking-wide uppercase rounded-xl transition cursor-pointer flex items-center justify-center gap-2 border border-rose-600"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Deleting account...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={13} />
                      <span>Delete Account</span>
                    </>
                  )}
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  disabled={loading}
                  onClick={onClose}
                  className="w-full h-12 bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-gray-700 font-bold text-xs tracking-wide uppercase rounded-xl transition cursor-pointer flex items-center justify-center border border-gray-200"
                >
                  Cancel
                </motion.button>
              </div>
            </motion.div>
          </div>
        </div>
      </AnimatePresence>

      {/* Premium Failure Toast */}
      <AnimatePresence>
        {toastMsg && (
          <PremiumToast message={toastMsg} type="error" onClose={() => setToastMsg(null)} />
        )}
      </AnimatePresence>
    </>
  );
}
