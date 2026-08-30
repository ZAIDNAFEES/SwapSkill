import React, { useState, useEffect, useRef } from "react";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  getDocFromServer,
  serverTimestamp,
  runTransaction,
  onSnapshot
} from "firebase/firestore";
import { AnimatePresence, motion } from "motion/react";
import { deleteUser, signOut } from "firebase/auth";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, auth, storage } from "../firebase";
import { UserProfile, Review, DEFAULT_AVATAR } from "../types";
import { safeLocalStorage } from "../utils/safeStorage";
import { useApp } from "../context/AppContext";
import { getOrCreateConversation, getOtherParticipantId } from "../utils/conversationUtils";
import { PremiumToast } from "./PremiumConfirmSheets";
import FollowButton from "./FollowButton";
import {
  User,
  Sparkles,
  BookOpen,
  MapPin,
  Clock,
  LogOut,
  Trash2,
  Globe,
  Star,
  MessageSquare,
  CalendarDays,
  Calendar,
  X,
  Check,
  ShieldAlert,
  ArrowRight,
  Share2,
  Instagram,
  Linkedin,
  Github,
  Flag,
  Slash,
  PenTool,
  CheckCircle,
  Briefcase,
  AlertCircle,
  Camera,
  UploadCloud,
  Plus,
  Cloud,
  Database,
  Award,
  Search,
  ChevronLeft,
  ChevronRight,
  Phone,
  Edit3,
  Loader2
} from "lucide-react";
import { OperationType, handleFirestoreError } from "../utils/firestoreError";
import { compressImage } from "../utils/imageCompressor";
import CountryPicker from "./CountryPicker";
import { Shield } from "lucide-react";
import { SmartImage } from "./SmartImage";
import SettingsView from "./SettingsView";
import FollowersFollowingView from "./FollowersFollowingView";
import { Settings } from "lucide-react";
import SkeletonLoader, { LoadingTransition } from "./SkeletonLoader";
import {
  getLocalDateString,
  getLocalTimeString,
  parseLocalDateTime,
  isPastTimeSlot,
  isPastDateTime,
  validateSessionDateTime,
  roundToNearest15
} from "../utils/dateTimeValidation";

interface FullscreenViewerProps {
  src: string;
  alt: string;
  layoutId: string;
  showDownload?: boolean;
  onClose: () => void;
}

function FullscreenViewer({
  src,
  alt,
  layoutId,
  showDownload,
  onClose
}: FullscreenViewerProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleWheel = (e: React.WheelEvent) => {
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.15 : 0.85;
    const nextScale = Math.min(4, Math.max(1, scale * factor));
    setScale(nextScale);
    if (nextScale === 1) {
      setOffset({ x: 0, y: 0 });
    }
  };

  const handleDoubleClick = () => {
    if (scale > 1) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    } else {
      setScale(2.5);
    }
  };

  const touchStartDist = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDist.current = dist;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDist.current > 0) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / touchStartDist.current;
      const nextScale = Math.min(4, Math.max(1, scale * factor));
      setScale(nextScale);
      touchStartDist.current = dist;
    }
  };

  const handleTouchEnd = () => {
    touchStartDist.current = 0;
  };

  const handleDownload = async () => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = alt ? `${alt.toLowerCase().replace(/\s+/g, "_")}.jpg` : "download.jpg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      window.open(src, "_blank");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      ref={containerRef}
      onWheel={handleWheel}
      className="fixed inset-0 z-50 bg-black/92 backdrop-blur-md flex items-center justify-center p-4 select-none touch-none"
      onClick={onClose}
    >
      <div className="absolute top-4 left-4 right-4 z-50 flex justify-between items-center">
        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
          {alt}
        </span>
        <div className="flex gap-2.5">
          {showDownload && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              className="w-10 h-10 rounded-full bg-slate-900/85 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
              title="Download image"
            >
              <UploadCloud className="w-5 h-5 rotate-180" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-10 h-10 rounded-full bg-slate-900/85 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
        <motion.div
          drag
          dragConstraints={
            scale > 1 
              ? false 
              : { top: 0, bottom: 0, left: 0, right: 0 }
          }
          dragElastic={scale > 1 ? 0.25 : { top: 0, bottom: 0.5, left: 0, right: 0 }}
          onDragEnd={(e, info) => {
            if (scale === 1 && info.offset.y > 100) {
              onClose();
            }
          }}
          style={{ x: offset.x, y: offset.y }}
          onUpdate={(latest) => {
            setOffset({ x: Number(latest.x), y: Number(latest.y) });
          }}
          className="relative max-w-[95%] max-h-[95%] flex items-center justify-center cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <motion.img
            layoutId={layoutId}
            src={src || undefined}
            alt={alt}
            referrerPolicy="no-referrer"
            animate={{ scale }}
            transition={{ type: "spring", damping: 25, stiffness: 180 }}
            onDoubleClick={handleDoubleClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="max-w-full max-h-full object-contain pointer-events-none rounded-lg"
          />
        </motion.div>
      </div>

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-mono text-slate-500 uppercase tracking-widest text-center pointer-events-none">
        {scale > 1 ? "Drag to pan • Pinch / Scroll to zoom • Double click reset" : "Double click zoom • Swipe down close"}
      </div>
    </motion.div>
  );
}

interface ProfileViewProps {
  currentUserId: string;
  selectedUserId: string; // Could be currentUserId or another user's ID
  onNavigateToTab: (tab: "home" | "search" | "messages" | "sessions" | "profile") => void;
  onOpenChat: (chatId: string) => void;
  onLogOutComplete: () => void;
  onSelectUser?: (userId: string) => void;
  onBack?: () => void;
}

export default function ProfileView({
  currentUserId,
  selectedUserId,
  onNavigateToTab,
  onOpenChat,
  onLogOutComplete,
  onSelectUser,
  onBack
}: ProfileViewProps) {
  const { setShowLogoutConfirm, chats, toggleFollow, currentUserProfile } = useApp();
  const isMe = currentUserId === selectedUserId;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Overlays & Sub-pages states
  const [showSettings, setShowSettings] = useState(false);
  const [activeSubPage, setActiveSubPage] = useState<"followers" | "following" | null>(null);

  // Connection/Follow logic
  const [isFollowing, setIsFollowing] = useState<boolean>(() => {
    return (currentUserProfile?.followingList || []).includes(selectedUserId);
  });
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);
  const [showUnfollowConfirm, setShowUnfollowConfirm] = useState(false);
  const [isFollowHovered, setIsFollowHovered] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<{
    src: string;
    alt: string;
    layoutId: string;
    showDownload?: boolean;
  } | null>(null);

  // Blocking logic
  const [isBlocked, setIsBlocked] = useState(false);
  const [isBlockedByThem, setIsBlockedByThem] = useState(false);

  // Scheduling session modal state
  const [isScheduling, setIsScheduling] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState("");
  const [sessionDateTime, setSessionDateTime] = useState("");
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionSuccess, setSessionSuccess] = useState(false);
  const [sessionError, setSessionError] = useState("");

  // New States for booking system upgrade
  const [sessionDuration, setSessionDuration] = useState<number>(60);
  const [sessionType, setSessionType] = useState<"HD Video Call" | "Voice Call" | "Chat Session">("HD Video Call");
  const [sessionNotes, setSessionNotes] = useState("");
  const [teachableSkills, setTeachableSkills] = useState<string[]>([]);
  const [fetchingTeachableSkills, setFetchingTeachableSkills] = useState(false);

  // Upgraded Skill Swap booking flow states
  const [bookingStep, setBookingStep] = useState(1);
  const [skillToTeach, setSkillToTeach] = useState("");
  const [learnSearch, setLearnSearch] = useState("");
  const [teachSearch, setTeachSearch] = useState("");
  const [submittingStage, setSubmittingStage] = useState<"idle" | "matching" | "sending" | "done">("idle");

  // Edit profile state (for self profile)
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [showSaveSuccessToast, setShowSaveSuccessToast] = useState(false);
  const [avatarPulse, setAvatarPulse] = useState(false);
  const profileHeaderRef = useRef<HTMLDivElement>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAvailability, setEditAvailability] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editPhotoUrl, setEditPhotoUrl] = useState("");
  const [editCoverUrl, setEditCoverUrl] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editLinkedin, setEditLinkedin] = useState("");
  const [editGithub, setEditGithub] = useState("");
  const [editPortfolio, setEditPortfolio] = useState("");
  const [editWebsite, setEditWebsite] = useState("");

  // New Edit Profile states for Requirement 12
  const [editUsername, setEditUsername] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editCountryCode, setEditCountryCode] = useState("US");
  const [editLanguages, setEditLanguages] = useState<string[]>([]);
  const [editCurrentLanguage, setEditCurrentLanguage] = useState("");
  const [editSkillsToTeach, setEditSkillsToTeach] = useState<string[]>([]);
  const [editCurrentSkillTeach, setEditCurrentSkillTeach] = useState("");
  const [editSkillsToLearn, setEditSkillsToLearn] = useState<string[]>([]);
  const [editCurrentSkillLearn, setEditCurrentSkillLearn] = useState("");

  // Image Upload Progress and Ref States
  const profileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const handleTriggerProfileUpload = () => {
    profileInputRef.current?.click();
  };

  const handleTriggerCoverUpload = () => {
    coverInputRef.current?.click();
  };
  const topRef = useRef<HTMLDivElement>(null);
  const profileContainerRef = useRef<HTMLDivElement>(null);
  const [isPhotoHighlight, setIsPhotoHighlight] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});
  const [uploadError, setUploadError] = useState("");
  const [editError, setEditError] = useState("");

  // Cloudinary credentials states
  const [cloudinaryCloudName, setCloudinaryCloudName] = useState(() => {
    let saved = "";
    try {
      saved = safeLocalStorage.getItem("cloudinary_cloud_name") || "";
    } catch (_) {}
    return (import.meta as any).env?.VITE_CLOUDINARY_CLOUD_NAME || saved;
  });
  const [cloudinaryUploadPreset, setCloudinaryUploadPreset] = useState(() => {
    let saved = "";
    try {
      saved = safeLocalStorage.getItem("cloudinary_upload_preset") || "";
    } catch (_) {}
    return (import.meta as any).env?.VITE_CLOUDINARY_UPLOAD_PRESET || saved;
  });
  const [showCloudinaryConfig, setShowCloudinaryConfig] = useState(false);

  // Custom Firebase credentials states
  const [showFirebaseConfig, setShowFirebaseConfig] = useState(false);
  const [firebaseConfigState, setFirebaseConfigState] = useState(() => {
    try {
      const saved = safeLocalStorage.getItem("custom_firebase_config");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error(e);
    }
    return {
      apiKey: "",
      authDomain: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: "",
      databaseId: "",
      databaseURL: "",
      measurementId: ""
    };
  });


  // Delete account verification
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Share overlay
  const [showShareSuccess, setShowShareSuccess] = useState(false);

  // Report user dialog
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  // Identity & Expert Verification Portal States
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyPortfolio, setVerifyPortfolio] = useState("");
  const [verifyDomain, setVerifyDomain] = useState("");
  const [verifyPledge, setVerifyPledge] = useState(false);
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  // Load profile details and reviews
  useEffect(() => {
    async function loadProfileData() {
      setLoading(true);
      setLoadError(null);
      try {
        const currentDocRef = doc(db, "users", currentUserId);
        const docRef = doc(db, "users", selectedUserId);
        const followDocRef = doc(db, "users", selectedUserId, "followers", currentUserId);
        const blockDocRef = doc(db, "users", currentUserId, "blockedUsers", selectedUserId);
        const blockByThemRef = doc(db, "users", selectedUserId, "blockedUsers", currentUserId);

        const [
          currentDocSnap,
          docSnap,
          followSnap,
          blockSnap,
          blockByThemSnap
        ] = await Promise.all([
          getDoc(currentDocRef),
          getDoc(docRef),
          getDoc(followDocRef),
          getDoc(blockDocRef),
          getDoc(blockByThemRef)
        ]);

        if (docSnap.exists()) {
          const data = docSnap.data() as UserProfile;
          setProfile(data);
          
          // Seed edits state
          setEditFullName(data.fullName || "");
          setEditBio(data.bio || "");
          setEditAvailability(data.availability || "");
          setEditCity(data.city || "");
          setEditPhotoUrl(data.profilePhotoUrl || data.photoUrl || "");
          setEditCoverUrl(data.coverPhotoUrl || data.coverUrl || "");
          setEditInstagram(data.instagram || "");
          setEditLinkedin(data.linkedin || "");
          setEditGithub(data.github || "");
          setEditPortfolio(data.portfolio || "");
          setEditWebsite(data.website || "");

          setEditUsername(data.username || "");
          setEditCountry(data.country || "");
          setEditCountryCode(data.countryCode || "");
          setEditLanguages(data.languages || []);
          setEditSkillsToTeach(data.skillsToTeach || []);
          setEditSkillsToLearn(data.skillsToLearn || []);

          // Check if current user is following this selected user (via subcollection)
          if (!isMe) {
            setIsFollowing(followSnap.exists());
          }

          // Check if user is blocked or if they blocked us
          if (!isMe) {
            setIsBlocked(blockSnap.exists());
            setIsBlockedByThem(blockByThemSnap.exists());
          }

          setFollowersCount(data.followersCount || 0);
          setFollowingCount(data.followingCount || 0);
        } else if (isMe) {
          // If profile doesn't exist yet and it's the current user, create it automatically
          const user = auth.currentUser;
          if (user) {
            const profileData: UserProfile = {
              uid: user.uid,
              email: user.email || "",
              displayName: user.displayName || user.email?.split("@")[0] || "New User",
              fullName: user.displayName || user.email?.split("@")[0] || "New User",
              username: (user.displayName || user.email?.split("@")[0] || "user_" + user.uid.substring(0, 5))
                .toLowerCase()
                .replace(/\s+/g, ""),
              photoURL: user.photoURL || "",
              photoUrl: user.photoURL || "",
              createdAt: serverTimestamp(),
              bio: "Developed modern, responsive, and high-performance websites using React, Next.js, Tailwind CSS, and Firebase. Built scalable web applications with secure authentication, database integration, REST APIs, and responsive UI. Focused on clean code, fast loading speed, SEO optimization, and excellent user experience.",
              city: "San Francisco",
              country: "United States of America",
              countryCode: "US",
              languages: ["English"],
              skillsToTeach: [],
              skillsToLearn: [],
              availability: "Flexible",
              timezone: "UTC (GMT +00:00)",
              followersCount: 0,
              followingCount: 0,
              points: 0,
              sessionsCount: 0,
              rating: 0
            };
            await setDoc(docRef, profileData);
            setProfile(profileData as any);

            setEditFullName(profileData.fullName);
            setEditBio(profileData.bio);
            setEditAvailability(profileData.availability);
            setEditCity(profileData.city);
            setEditPhotoUrl(profileData.profilePhotoUrl || profileData.photoUrl || "");
            setEditCoverUrl(profileData.coverPhotoUrl || profileData.coverUrl || "");
            setEditInstagram("");
            setEditLinkedin("");
            setEditGithub("");
            setEditPortfolio("");
            setEditWebsite("");
            setEditUsername(profileData.username);
            setEditCountry(profileData.country);
            setEditCountryCode(profileData.countryCode);
            setEditLanguages(profileData.languages);
            setEditSkillsToTeach([]);
            setEditSkillsToLearn([]);
          } else {
            setProfile(null);
          }
        } else {
          setProfile(null);
        }

        // Load reviews where revieweeId === selectedUserId
        const reviewsRef = collection(db, "reviews");
        const q = query(reviewsRef, where("revieweeId", "==", selectedUserId));
        const querySnapshot = await getDocs(q);
        const loadedReviews: Review[] = [];
        querySnapshot.forEach((doc) => {
          loadedReviews.push({ ...(doc.data() as Review), id: doc.id });
        });
        setReviews(loadedReviews);

      } catch (err: any) {
        console.error("Error loading profile details:", err);
        setLoadError(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    }
    loadProfileData();
  }, [selectedUserId, currentUserId, isMe]);

  // Automatically fetch selected user's skillsToTeach from Firestore when opening the modal
  useEffect(() => {
    if (isScheduling && selectedUserId) {
      const fetchTeachableSkills = async () => {
        setFetchingTeachableSkills(true);
        try {
          const userDoc = await getDoc(doc(db, "users", selectedUserId));
          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile;
            setTeachableSkills(data.skillsToTeach || []);
          }
        } catch (err) {
          console.error("Error fetching teachable skills:", err);
        } finally {
          setFetchingTeachableSkills(false);
        }
      };
      fetchTeachableSkills();
    }
  }, [isScheduling, selectedUserId]);

  // Real-time unread chat count sync for other users' profiles
  useEffect(() => {
    if (!currentUserId || !selectedUserId || isMe) {
      setUnreadCount(0);
      return;
    }
    const existingChat = chats.find(c => {
      const otherId = getOtherParticipantId(c, currentUserId);
      return otherId === selectedUserId;
    });
    setUnreadCount(existingChat?.unreadCount?.[currentUserId] || 0);
  }, [chats, currentUserId, selectedUserId, isMe]);

  // Image Upload and Compression logic
  const handleUploadImage = async (file: File, type: "profile" | "cover") => {
    if (!file) return;
    setUploadError("");
    
    // Check for active Cloudinary configurations
    let savedCloudName = "";
    let savedUploadPreset = "";
    try {
      savedCloudName = safeLocalStorage.getItem("cloudinary_cloud_name") || "";
      savedUploadPreset = safeLocalStorage.getItem("cloudinary_upload_preset") || "";
    } catch (_) {}
    const activeCloudName = cloudinaryCloudName || (import.meta as any).env?.VITE_CLOUDINARY_CLOUD_NAME || savedCloudName;
    const activeUploadPreset = cloudinaryUploadPreset || (import.meta as any).env?.VITE_CLOUDINARY_UPLOAD_PRESET || savedUploadPreset;

    try {
      // 1. Compress image
      const maxWidth = type === "profile" ? 500 : 1200;
      const maxHeight = type === "profile" ? 500 : 600;
      const compressedBlob = await compressImage(file, maxWidth, maxHeight, 0.85);

      // 2. Set upload progress to 5% initially to indicate starting
      setUploadProgress((prev) => ({
        ...prev,
        [type]: 5
      }));

      let downloadUrl = "";

      if (activeCloudName && activeUploadPreset) {
        // 3. Upload to Cloudinary using XMLHttpRequest for upload progress tracking
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `https://api.cloudinary.com/v1_1/${activeCloudName.trim()}/image/upload`, true);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            setUploadProgress((prev) => ({
              ...prev,
              [type]: Math.max(5, progress) // Ensure at least 5% is shown while uploading
            }));
          }
        };

        const uploadPromise = new Promise<string>((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                if (response.secure_url) {
                  resolve(response.secure_url);
                } else {
                  reject(new Error("Cloudinary response missing secure_url"));
                }
              } catch (err) {
                reject(new Error("Invalid response from Cloudinary"));
              }
            } else {
              try {
                const response = JSON.parse(xhr.responseText);
                reject(new Error(response.error?.message || `Error ${xhr.status}`));
              } catch {
                reject(new Error(`Server error ${xhr.status} (Please make sure Cloud name and Unsigned Upload Preset are correct)`));
              }
            }
          };

          xhr.onerror = () => reject(new Error("Network connection failed during upload"));
          xhr.onabort = () => reject(new Error("Upload aborted"));
        });

        // Prepare form data for Unsigned Upload
        const formData = new FormData();
        formData.append("file", compressedBlob, `${type}_photos_${currentUserId}.jpg`);
        formData.append("upload_preset", activeUploadPreset.trim());
        formData.append("folder", "swap_skill_profiles");

        xhr.send(formData);

        downloadUrl = await uploadPromise;
      } else {
        // Fallback to high-performance base64 data URLs! This ensures 100% offline and standalone reliability.
        setUploadProgress((prev) => ({
          ...prev,
          [type]: 50
        }));

        const base64Promise = new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Failed to convert image to base64 format"));
          reader.readAsDataURL(compressedBlob);
        });

        downloadUrl = await base64Promise;
        
        setUploadProgress((prev) => ({
          ...prev,
          [type]: 100
        }));
      }

      // 4. Update Firestore document
      const userRef = doc(db, "users", currentUserId);
      const updateData: any = {};
      if (type === "profile") {
        updateData.profilePhotoUrl = downloadUrl;
        updateData.photoUrl = downloadUrl;
      } else {
        updateData.coverPhotoUrl = downloadUrl;
        updateData.coverUrl = downloadUrl;
      }

      await updateDoc(userRef, updateData);

      // 5. Update local profile state immediately
      setProfile((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ...updateData
        };
      });

      if (type === "profile") {
        setEditPhotoUrl(downloadUrl);
      } else {
        setEditCoverUrl(downloadUrl);
      }

      // Progress complete animation
      setUploadProgress((prev) => ({
        ...prev,
        [type]: 100
      }));

      // Clear progress indicator
      setTimeout(() => {
        setUploadProgress((prev) => {
          const copy = { ...prev };
          delete copy[type];
          return copy;
        });
      }, 1200);

    } catch (err: any) {
      console.error("Cloudinary upload error:", err);
      setUploadProgress((prev) => {
        const copy = { ...prev };
        delete copy[type];
        return copy;
      });
      setUploadError(`Failed to upload ${type} image: ${err.message || err}`);
    }
  };

  const handleProfilePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleUploadImage(e.target.files[0], "profile");
    }
  };

  const handleCoverPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleUploadImage(e.target.files[0], "cover");
    }
  };

  // Tag list edit helpers
  const addEditLanguage = () => {
    if (editCurrentLanguage.trim() && !editLanguages.includes(editCurrentLanguage.trim())) {
      setEditLanguages([...editLanguages, editCurrentLanguage.trim()]);
      setEditCurrentLanguage("");
    }
  };

  const removeEditLanguage = (lang: string) => {
    setEditLanguages(editLanguages.filter((l) => l !== lang));
  };

  const addEditSkillTeach = () => {
    if (editCurrentSkillTeach.trim() && !editSkillsToTeach.includes(editCurrentSkillTeach.trim())) {
      setEditSkillsToTeach([...editSkillsToTeach, editCurrentSkillTeach.trim()]);
      setEditCurrentSkillTeach("");
    }
  };

  const removeEditSkillTeach = (skill: string) => {
    setEditSkillsToTeach(editSkillsToTeach.filter((s) => s !== skill));
  };

  const addEditSkillLearn = () => {
    if (editCurrentSkillLearn.trim() && !editSkillsToLearn.includes(editCurrentSkillLearn.trim())) {
      setEditSkillsToLearn([...editSkillsToLearn, editCurrentSkillLearn.trim()]);
      setEditCurrentSkillLearn("");
    }
  };

  const removeEditSkillLearn = (skill: string) => {
    setEditSkillsToLearn(editSkillsToLearn.filter((s) => s !== skill));
  };

  // Follow/Unfollow Handler (Optimistic & Super Fast)
  const handleFollowToggle = async () => {
    if (!profile || isMe) return;
    if (followLoading) return;

    setFollowLoading(true);

    // Optimistic update of local state (0ms)
    const originalIsFollowing = isFollowing;
    const originalFollowersCount = followersCount;
    const originalFollowingCount = followingCount;

    const nextFollowingState = !originalIsFollowing;
    setIsFollowing(nextFollowingState);
    setFollowersCount((prev) => nextFollowingState ? prev + 1 : Math.max(0, prev - 1));
    if (selectedUserId === currentUserId) {
      setFollowingCount((prev) => nextFollowingState ? prev + 1 : Math.max(0, prev - 1));
    }

    try {
      await toggleFollow(selectedUserId);
    } catch (err) {
      console.error("Error executing follow toggle:", err);
      // Rollback optimistic state on error
      setIsFollowing(originalIsFollowing);
      setFollowersCount(originalFollowersCount);
      setFollowingCount(originalFollowingCount);
    } finally {
      setFollowLoading(false);
    }
  };

  // Block/Unblock Handler
  const handleBlockToggle = async () => {
    if (!profile) return;

    try {
      const blockDocRef = doc(db, "users", currentUserId, "blockedUsers", selectedUserId);
      
      if (isBlocked) {
        await deleteDoc(blockDocRef);
        setIsBlocked(false);
      } else {
        await setDoc(blockDocRef, { blockedAt: new Date() });
        setIsBlocked(true);
        // Unfollow automatically if blocked
        if (isFollowing) {
          await handleFollowToggle();
        }
      }
    } catch (err) {
      console.error("Error toggling block:", err);
    }
  };

  // Chat Initiator: Instant navigation with background canonical provisioning
  const handleMessageUser = async () => {
    if (!profile || !selectedUserId || !currentUserId) return;
    setMessageLoading(true);
    setMessageError(null);

    try {
      // 1. Check if conversation already exists in memory
      const existing = chats.find(c => {
        const otherId = getOtherParticipantId(c, currentUserId);
        return otherId === selectedUserId;
      });

      if (existing) {
        onOpenChat(existing.id);
        setMessageLoading(false);
        return;
      }

      // 2. Compute canonical chat ID and open chat immediately (<50ms)
      const canonicalId = [currentUserId, selectedUserId].sort().join("_");
      onOpenChat(canonicalId);

      // Background canonical doc sync & initialization
      getOrCreateConversation(currentUserId, selectedUserId).catch(err => {
        console.warn("Background conversation init warning:", err);
      });
    } catch (err: any) {
      console.error("Error creating/navigating chat room:", err);
      setMessageError(err?.message || String(err));
      setToast({ message: "Could not open conversation: " + (err?.message || "Please check your network."), type: "error" });
    } finally {
      setMessageLoading(false);
    }
  };  // Timezone helpers
  const parseTimezoneOffset = (tzString: string): number => {
    const match = tzString.match(/GMT\s*([+-]\d{2}):(\d{2})/);
    if (match) {
      const sign = match[1][0] === '+' ? 1 : -1;
      const hours = parseInt(match[1].slice(1), 10);
      const minutes = parseInt(match[2], 10);
      return sign * (hours * 60 + minutes);
    }
    return 0; // Default to UTC
  };

  const formatInTimezone = (date: Date, tzString: string): string => {
    const offsetMinutes = parseTimezoneOffset(tzString);
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

  // Schedule Session Request Handler (Upgraded Production System)
  const handleScheduleSession = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!profile) return;
    setSessionError("");

    if (bookingStep !== 6) {
      return;
    }

    if (!auth.currentUser) {
      setSessionError("You must be signed in to book a session.");
      return;
    }

    if (!selectedSkill) {
      setSessionError("Please select the skill you want to learn.");
      return;
    }

    if (!skillToTeach) {
      setSessionError("Please specify the skill you will teach.");
      return;
    }

    if (!sessionDateTime) {
      setSessionError("Please select a date and time for the session.");
      return;
    }

    const roundedDateTimeStr = roundToNearest15(sessionDateTime, true);
    
    // Smoothly update the field in the UI so the user sees the rounded booking time
    setSessionDateTime(roundedDateTimeStr);

    const validation = validateSessionDateTime(roundedDateTimeStr, new Date());
    if (!validation.isValid || !validation.date) {
      setSessionError(validation.error || "Please select a future time.");
      return;
    }

    const selectedDate = validation.date;

    if (sessionNotes.length > 500) {
      setSessionError("Notes cannot exceed 500 characters.");
      return;
    }

    setSessionLoading(true);

    try {
      // Step 1 of animation: Finding the best match
      setSubmittingStage("matching");

      // Step 2: Sending request
      setSubmittingStage("sending");

      const sessionsRef = collection(db, "sessions");
      
      const meetingId = Math.random().toString(36).substring(2, 10).toUpperCase();
      const studentId = currentUserId;
      const studentName = currentUserProfile?.fullName || auth.currentUser?.displayName || "Student";
      
      const teacherId = selectedUserId;
      const teacherName = profile.fullName;

      // Construct highly detailed notes for backwards compatibility
      const fullNotesText = `✨ Skill Swap Session Details:\n📚 Learning: ${selectedSkill}\n🎓 Teaching: ${skillToTeach}\n\n💬 Message/Goals:\n${sessionNotes.trim() || "No extra goals specified."}`;

      const sessionEndTime = new Date(selectedDate.getTime() + sessionDuration * 60000);

      const sessionObj = {
        teacherId,
        studentId,
        learnerId: studentId, // Backwards compatibility for rules / views
        senderId: studentId,  // Explicit senderId
        receiverId: teacherId, // Explicit receiverId
        teacherName,
        studentName,
        learnerName: studentName, // Backwards compatibility
        skill: selectedSkill,
        skillName: selectedSkill, // Backwards compatibility
        teachSkill: skillToTeach, // Custom field for teach skill
        duration: sessionDuration,
        sessionType,
        status: "Pending", // Set initial status exactly to Pending (capitalized as required)
        scheduledTime: selectedDate,
        sessionEndTime,
        createdAt: new Date(),
        notes: fullNotesText.substring(0, 1000),
        timezone: currentUserProfile?.timezone || "UTC (GMT +00:00)",
        meetingId
      };

      const docAdded = await addDoc(sessionsRef, sessionObj);

      // Store sessionId within the document
      await updateDoc(doc(db, "sessions", docAdded.id), {
        sessionId: docAdded.id
      });

      // Notify teacher immediately: "New Session Request"
      const hostNotifRef = collection(db, "users", teacherId, "notifications");
      await addDoc(hostNotifRef, {
        type: "booking",
        senderId: currentUserId,
        senderName: studentName,
        senderPhoto: auth.currentUser?.photoURL || DEFAULT_AVATAR,
        referenceId: docAdded.id,
        message: `requested a skill swap! Learn [${selectedSkill}] & Teach [${skillToTeach}]. Type: ${sessionType}, Duration: ${sessionDuration}m`,
        read: false,
        createdAt: new Date()
      });

      // Step 3: Done
      setSubmittingStage("done");

      // Show the beautiful success card
      setSessionSuccess(true);

    } catch (err) {
      console.error("Error creating session request:", err);
      setSessionError("Failed to book session. Please try again.");
      setSubmittingStage("idle");
    } finally {
      setSessionLoading(false);
    }
  };

  // Report User Misconduct
  const handleReportUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportReason.trim()) return;
    setReportLoading(true);

    try {
      const reportsRef = collection(db, "reports");
      await addDoc(reportsRef, {
        reporterId: currentUserId,
        reportedUserId: selectedUserId,
        reason: reportReason.trim(),
        createdAt: new Date()
      });

      setReportSuccess(true);
      setTimeout(() => {
        setShowReportDialog(false);
        setReportSuccess(false);
        setReportReason("");
      }, 2500);
    } catch (err) {
      console.error("Error creating report:", err);
    } finally {
      setReportLoading(false);
    }
  };

  // Submit Identity and Skill Verification Challenge
  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyPortfolio.trim()) {
      setVerifyError("Please provide a portfolio link or credential proof.");
      return;
    }
    if (!verifyDomain.trim()) {
      setVerifyError("Please choose your expert domain.");
      return;
    }
    if (!verifyPledge) {
      setVerifyError("You must agree to the peer learning code of conduct.");
      return;
    }

    setVerifySubmitting(true);
    setVerifyError("");

    try {
      const userRef = doc(db, "users", currentUserId);
      const pointsBonus = 100;
      const updatedPoints = (profile?.points || 0) + pointsBonus;

      await updateDoc(userRef, {
        verified: true,
        points: updatedPoints,
        portfolio: verifyPortfolio.trim()
      });

      // Update local state
      if (profile) {
        setProfile({
          ...profile,
          verified: true,
          points: updatedPoints,
          portfolio: verifyPortfolio.trim()
        });
      }

      // Create a welcome verification notification in user's subcollection
      const notifRef = collection(db, "users", currentUserId, "notifications");
      await addDoc(notifRef, {
        type: "booking",
        senderId: "system",
        senderName: "SwapSkill Security",
        senderPhoto: DEFAULT_AVATAR,
        referenceId: currentUserId,
        message: `Congratulations! Your identity and expert profile in [${verifyDomain}] has been certified. +100 verification bonus points added! ✦`,
        read: false,
        createdAt: new Date()
      });

      setVerifySuccess(true);
      setTimeout(() => {
        setShowVerifyModal(false);
        setVerifySuccess(false);
        setVerifyPortfolio("");
        setVerifyDomain("");
        setVerifyPledge(false);
      }, 3000);

    } catch (err) {
      console.error("Error submitting verification:", err);
      setVerifyError("Failed to submit verification. Please try again.");
    } finally {
      setVerifySubmitting(false);
    }
  };

  // Share Profile
  const handleShareProfile = async () => {
    const inviteUrl = `${window.location.origin}/profile/${selectedUserId}`;
    const shareText = `Check out ${profile?.fullName}'s premium peer learning profile on SwapSkill! Teach, Learn, and Swap crafts.`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${profile?.fullName} - SwapSkill`,
          text: shareText,
          url: inviteUrl
        });
      } catch (e) {
        console.log("Web share cancelled or failed");
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${inviteUrl}`);
        setShowShareSuccess(true);
        setTimeout(() => setShowShareSuccess(false), 2500);
      } catch (err) {
        console.error("Failed to copy", err);
      }
    }
  };

  // Check if we are already at the top of any parent or window scroll container
  const isAlreadyAtTop = () => {
    if (window.scrollY > 10) return false;
    if (profileContainerRef.current && profileContainerRef.current.scrollTop > 10) return false;
    let parent = profileContainerRef.current?.parentElement;
    while (parent) {
      if (parent.scrollTop > 10) return false;
      parent = parent.parentElement;
    }
    return true;
  };

  // Smooth scroll to top, focus input, and animate cover/profile photo soft glow
  const handleEditProfileToggle = () => {
    const alreadyTop = isAlreadyAtTop();
    
    if (alreadyTop) {
      setIsEditing(!isEditing);
      if (!isEditing) {
        setTimeout(() => {
          const field = document.getElementById("edit-fullname-input") || document.getElementById("edit-profile-photo-btn");
          field?.focus();
        }, 100);
      }
      return;
    }

    if (!isEditing) {
      setIsEditing(true);
    }

    // Scroll smoothly to the very top (takes about 300-500ms)
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    // Focus and highlight after reaching the top
    setTimeout(() => {
      setIsPhotoHighlight(true);
      
      const field = document.getElementById("edit-fullname-input") || document.getElementById("edit-profile-photo-btn");
      if (field) {
        field.focus();
      }

      // Keep glowing for 2 seconds
      setTimeout(() => {
        setIsPhotoHighlight(false);
      }, 2000);
    }, 450);
  };

  // Save Self Profile Edits
  const handleSaveEdits = async () => {
    if (!profile) return;
    setEditError("");

    if (!editFullName.trim() || !editUsername.trim().toLowerCase().replace(/\s+/g, "") || !editCity.trim() || !editCountry.trim()) {
      setEditError("Please complete all required fields (Full Name, Username, Country, and City).");
      return;
    }

    if (editSkillsToTeach.length === 0) {
      setEditError("Please add at least one skill you want to teach.");
      return;
    }

    if (editSkillsToLearn.length === 0) {
      setEditError("Please add at least one skill you want to learn.");
      return;
    }

    try {
      setIsSavingEdits(true);
      const userRef = doc(db, "users", currentUserId);
      const updatedFields = {
        fullName: editFullName.trim(),
        bio: editBio.trim(),
        availability: editAvailability,
        city: editCity.trim(),
        photoUrl: editPhotoUrl,
        profilePhotoUrl: editPhotoUrl,
        coverUrl: editCoverUrl,
        coverPhotoUrl: editCoverUrl,
        instagram: editInstagram.trim(),
        linkedin: editLinkedin.trim(),
        github: editGithub.trim(),
        portfolio: editPortfolio.trim(),
        website: editWebsite.trim(),
        username: editUsername.trim().toLowerCase().replace(/\s+/g, ""),
        country: editCountry,
        countryCode: editCountryCode,
        languages: editLanguages,
        skillsToTeach: editSkillsToTeach,
        skillsToLearn: editSkillsToLearn
      };

      await updateDoc(userRef, updatedFields);

      setProfile((prev: any) => ({
        ...prev,
        ...updatedFields
      }));
      setIsEditing(false);
      setIsSavingEdits(false);

      // Show Toast
      setShowSaveSuccessToast(true);
      setTimeout(() => setShowSaveSuccessToast(false), 3500);

      // Smooth scroll to top / profile header
      if (profileHeaderRef.current) {
        profileHeaderRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      // Trigger avatar pulse effect
      setAvatarPulse(true);
      setTimeout(() => setAvatarPulse(false), 2000);
    } catch (err) {
      console.error("Error saving edits:", err);
      setIsSavingEdits(false);
      setEditError("Failed to save edits. Please check your network connection.");
    }
  };

  // Log Out
  const handleLogOut = async () => {
    try {
      await signOut(auth);
      onLogOutComplete();
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  // Account Deletion
  const handleDeleteAccount = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setDeleteError("");

    try {
      // 1. Delete user profile document in Firestore
      await deleteDoc(doc(db, "users", currentUserId));
      
      // 2. Delete user in Firebase Auth
      await deleteUser(user);
      
      onLogOutComplete();
    } catch (err: any) {
      console.error("Error deleting account:", err);
      if (err.code === "auth/requires-recent-login") {
        setDeleteError("This operation requires a fresh login. Please sign out and sign back in to delete.");
      } else {
        setDeleteError("Failed to complete account deletion.");
      }
    }
  };

  // Format joined date beautifully
  const getJoinedDateString = () => {
    if (!profile?.createdAt) return "July 2026";
    try {
      const date = profile.createdAt.toDate ? profile.createdAt.toDate() : new Date(profile.createdAt);
      return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    } catch (e) {
      return "July 2026";
    }
  };

  if (loading || !profile) {
    return (
      <LoadingTransition isLoading={loading} type="profile">
        {!profile && (
          <div className="flex flex-col items-center justify-center min-h-screen bg-white text-gray-900 p-6 font-sans text-center animate-fade-in">
            <ShieldAlert className="w-12 h-12 text-[#D4AF37] mb-4" />
            <h2 className="text-lg font-sans font-bold">Profile Not Setup</h2>
            <p className="text-slate-400 text-xs mt-1 max-w-xs leading-relaxed mb-4">
              This user profile has not been configured on the SwapSkill database yet.
            </p>

            {loadError && (
              <div className="bg-red-950/40 border border-red-900/60 p-3 rounded-lg text-[11px] text-red-400 max-w-xs mb-6 text-left leading-relaxed">
                <span className="font-bold block mb-1 uppercase tracking-wider text-[9px] text-red-300">Database Connection Status:</span>
                {loadError}
                <div className="mt-2 text-[10px] text-slate-500">
                  Tip: If you see "Missing or insufficient permissions", make sure you have deployed or configured standard read/write Security Rules in your Firebase console under **Firestore &rarr; Rules**.
                </div>
              </div>
            )}

            <button
              onClick={() => onNavigateToTab("home")}
              className="px-6 h-11 bg-slate-900 border border-slate-800 rounded-xl text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
            >
              Return Home
            </button>
          </div>
        )}
      </LoadingTransition>
    );
  }

  // Calculate rating average
  const calculatedAvgRating = reviews.length > 0
    ? parseFloat((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1))
    : (profile.rating || 0);
  const avgRating = calculatedAvgRating;
  const completedSessionsCount = profile.sessionsCount || 0;

  if (showSettings) {
    return (
      <SettingsView
        currentUserId={currentUserId}
        onClose={() => setShowSettings(false)}
        onLogOut={handleLogOut}
      />
    );
  }

  if (activeSubPage) {
    return (
      <FollowersFollowingView
        userId={selectedUserId}
        type={activeSubPage}
        currentUserId={currentUserId}
        onClose={() => setActiveSubPage(null)}
        onSelectUser={(uid) => {
          if (onSelectUser) {
            onSelectUser(uid);
          }
          setActiveSubPage(null);
        }}
        onOpenChat={onOpenChat}
      />
    );
  }

  return (
    <div ref={profileContainerRef} className="min-h-screen bg-[#F7F4EE] text-[#0D0D0F] font-sans overflow-y-auto pb-28 relative w-full overflow-x-hidden mobile-scroll">
      <div ref={topRef} id="profile-page-top" className="absolute top-0 left-0 w-full h-px pointer-events-none" />
      
      {/* Hidden File Inputs for Profile and Cover Photos */}
      <input
        type="file"
        ref={profileInputRef}
        onChange={handleProfilePhotoChange}
        accept="image/*"
        className="hidden"
      />
      <input
        type="file"
        ref={coverInputRef}
        onChange={handleCoverPhotoChange}
        accept="image/*"
        className="hidden"
      />

      {/* Top Banner Cover Image */}
      <div 
        id="profile-cover-container"
        className={`h-48 relative bg-[#0D0D0F] overflow-hidden cursor-pointer transition-all duration-500 ${
          isPhotoHighlight 
            ? "ring-2 ring-[#C9A96E] z-20" 
            : "ring-0"
        }`}
        onClick={() => {
          if (profile.coverPhotoUrl || profile.coverUrl) {
            setFullscreenImage({
              src: profile.coverPhotoUrl || profile.coverUrl || "",
              alt: "Cover Banner",
              layoutId: "cover-photo-fullscreen",
              showDownload: isMe
            });
          }
        }}
      >
        <SmartImage
          src={profile.coverPhotoUrl || profile.coverUrl}
          alt="Cover Banner"
          className="w-full h-full animate-fade-in object-cover opacity-80"
          fallbackType="cover"
          layoutId="cover-photo-fullscreen"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0D0D0F]/80 via-transparent to-black/20 pointer-events-none"></div>
        
        {onBack && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onBack();
            }}
            className="absolute top-safe top-3 left-3 z-20 w-10 h-10 rounded-full bg-[#0D0D0F]/80 backdrop-blur-md border border-[#1A1A1D] flex items-center justify-center text-[#F7F4EE] hover:text-[#C9A96E] transition cursor-pointer active:scale-95"
            title="Go Back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        
        {isMe && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              coverInputRef.current?.click();
            }}
            className="absolute bottom-3 right-3 z-10 p-2.5 bg-[#0D0D0F]/90 backdrop-blur-md border border-[#C9A96E]/40 rounded-full text-[#C9A96E] hover:text-white transition shadow-sm flex items-center justify-center cursor-pointer animate-fade-in"
            title="Change Cover Banner"
          >
            <Camera className="w-4 h-4" />
          </button>
        )}

        {/* Upload Cover Progress */}
        {uploadProgress.cover !== undefined && (
          <div className="absolute inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 transition">
            <div className="w-1/2 max-w-xs bg-[#FFFFFF] border border-[#E8E4DB] p-4 rounded-2xl text-center shadow-lg">
              <p className="text-[10px] uppercase tracking-wider text-[#0D0D0F] font-semibold mb-1.5">Uploading Cover</p>
              <div className="w-full bg-[#F2EFE8] h-1.5 rounded-full overflow-hidden border border-[#E8E4DB] mb-1">
                <div 
                  className="bg-[#0D0D0F] h-full transition-all duration-350"
                  style={{ width: `${uploadProgress.cover}%` }}
                />
              </div>
              <span className="text-[11px] text-[#71717A] font-medium">{uploadProgress.cover}%</span>
            </div>
          </div>
        )}

        {/* Floating Quick Navigation or Report Badge */}
        <div className="absolute top-5 right-5 flex gap-2 z-20">
          <button
            id="profile-share-banner-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleShareProfile();
            }}
            className="w-9 h-9 rounded-full bg-[#0D0D0F]/70 backdrop-blur-md border border-white/10 flex items-center justify-center text-[#F7F4EE] hover:text-[#C9A96E] transition cursor-pointer"
            title="Share Profile"
          >
            <Share2 className="w-4 h-4" />
          </button>

          {isMe && (
            <button
              id="profile-settings-banner-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowSettings(true);
              }}
              className="w-9 h-9 rounded-full bg-[#0D0D0F]/70 backdrop-blur-md border border-white/10 flex items-center justify-center text-[#F7F4EE] hover:text-[#C9A96E] transition cursor-pointer"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}

          {!isMe && (
            <>
              <button
                id="profile-report-banner-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowReportDialog(true);
                }}
                className="w-9 h-9 rounded-full bg-[#0D0D0F]/70 backdrop-blur-md border border-white/10 flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
                title="Report"
              >
                <Flag className="w-4 h-4" />
              </button>

              <button
                id="profile-block-banner-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleBlockToggle();
                }}
                className={`w-9 h-9 rounded-full backdrop-blur-md border flex items-center justify-center transition cursor-pointer ${
                  isBlocked 
                    ? "bg-[#0D0D0F] border-[#1A1A1D] text-[#C9A96E]" 
                    : "bg-[#0D0D0F]/70 border-white/10 text-[#71717A] hover:text-[#0D0D0F]"
                }`}
                title={isBlocked ? "Unblock User" : "Block User"}
              >
                <Slash className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Container */}
      <div className="px-6 -mt-16 relative z-10 flex flex-col gap-6 md:max-w-4xl md:mx-auto w-full">
        
        {/* Upload Error Banner if present */}
        {uploadError && (
          <div className="bg-[#FFFFFF] border border-[#E8E4DB] text-[#0D0D0F] px-4 py-3 rounded-xl flex items-center gap-2.5 text-xs animate-fade-in z-20">
            <AlertCircle className="w-4 h-4 text-[#71717A] flex-shrink-0" />
            <p className="flex-1">{uploadError}</p>
            <button onClick={() => setUploadError("")} className="text-[#71717A] hover:text-[#0D0D0F] cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Profile Card Header */}
        <div ref={profileHeaderRef} className="flex flex-col items-center text-center">
          <div className="relative">
            <div 
              id="profile-avatar-container"
              className={`relative rounded-full border-4 border-[#F7F4EE] shadow-md overflow-hidden w-28 h-28 cursor-pointer transition-all duration-500 bg-[#FFFFFF] ${
                avatarPulse
                  ? "ring-2 ring-[#C9A96E] scale-105"
                  : isPhotoHighlight 
                  ? "ring-2 ring-[#C9A96E] scale-105" 
                  : "ring-1 ring-[#E8E4DB]"
              }`}
              onClick={() => {
                setFullscreenImage({
                  src: profile.profilePhotoUrl || profile.photoUrl || "",
                  alt: profile.fullName || "Profile Photo",
                  layoutId: "profile-photo-fullscreen",
                  showDownload: false
                });
              }}
            >
              <SmartImage
                src={profile.profilePhotoUrl || profile.photoUrl}
                alt={profile.fullName || "Profile Photo"}
                fullName={profile.fullName}
                className="w-full h-full object-cover"
                fallbackType="profile"
                layoutId="profile-photo-fullscreen"
              />

              {/* Upload Profile Progress Overlay */}
              {uploadProgress.profile !== undefined && (
                <div className="absolute inset-0 bg-[#0D0D0F]/85 flex flex-col items-center justify-center z-10 transition">
                  <span className="text-xs text-[#C9A96E] font-medium animate-pulse">{uploadProgress.profile}%</span>
                  <span className="text-[8px] text-[#A1A1AA] uppercase tracking-wider">Uploading</span>
                </div>
              )}
            </div>

            {isMe && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTriggerProfileUpload();
                }}
                className="absolute bottom-0 right-0 z-20 p-2 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#C9A96E] rounded-full transition shadow-md border-2 border-[#F7F4EE] cursor-pointer flex items-center justify-center animate-fade-in"
                title="Edit Profile Photo"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            )}

            {profile.verified && (
              <span className={`absolute bottom-1 ${isMe ? "left-1" : "right-1"} w-6 h-6 rounded-full bg-[#0D0D0F] text-[#C9A96E] text-[10px] font-bold flex items-center justify-center border-2 border-[#F7F4EE] z-20 animate-fade-in`} title="Verified Member">
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              </span>
            )}
          </div>

          <h2 className="text-2xl font-semibold text-[#0D0D0F] tracking-tight mt-4 flex items-center gap-2 justify-center">
            {profile.fullName}
            {profile.verified && <span className="text-[10px] bg-[#0D0D0F] text-[#C9A96E] border border-[#1A1A1D] px-2 py-0.5 rounded-full font-medium tracking-wider uppercase">VERIFIED</span>}
          </h2>
          <p className="text-xs text-[#71717A] mt-0.5 font-normal">@{profile.username}</p>

          <p className="text-xs text-[#71717A] mt-2 flex items-center gap-1.5 justify-center">
            <MapPin className="w-3.5 h-3.5 text-[#C9A96E]" />
            <span>{profile.city}, {profile.country}</span>
          </p>

          {/* Social Icons Links */}
          <div className="flex gap-4 mt-3.5 justify-center">
            {profile.github && (
              <a href={profile.github.startsWith("http") ? profile.github : `https://${profile.github}`} target="_blank" rel="noopener noreferrer" className="text-[#71717A] hover:text-[#0D0D0F] transition">
                <Github className="w-4 h-4" />
              </a>
            )}
            {profile.linkedin && (
              <a href={profile.linkedin.startsWith("http") ? profile.linkedin : `https://${profile.linkedin}`} target="_blank" rel="noopener noreferrer" className="text-[#71717A] hover:text-[#0D0D0F] transition">
                <Linkedin className="w-4 h-4" />
              </a>
            )}
            {profile.instagram && (
              <a href={profile.instagram.startsWith("http") ? profile.instagram : `https://${profile.instagram}`} target="_blank" rel="noopener noreferrer" className="text-[#71717A] hover:text-[#0D0D0F] transition">
                <Instagram className="w-4 h-4" />
              </a>
            )}
            {(profile.website || profile.portfolio) && (
              <a href={(profile.website || profile.portfolio || "").startsWith("http") ? (profile.website || profile.portfolio) : `https://${profile.website || profile.portfolio}`} target="_blank" rel="noopener noreferrer" className="text-[#71717A] hover:text-[#0D0D0F] transition">
                <Globe className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {/* Platform statistics boxes */}
        <div className="grid grid-cols-4 gap-2 bg-[#FFFFFF] border border-[#E8E4DB] p-4 rounded-2xl shadow-2xs">
          <div 
            onClick={() => setActiveSubPage("followers")}
            className="flex flex-col items-center text-center cursor-pointer hover:opacity-80 transition"
          >
            <span className="text-base font-bold text-[#0D0D0F] block overflow-hidden">
              <motion.span
                key={followersCount}
                initial={{ y: 15, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="inline-block"
              >
                {followersCount}
              </motion.span>
            </span>
            <span className="text-[10px] text-[#71717A] uppercase tracking-wider font-medium mt-0.5">Followers</span>
          </div>

          <div 
            onClick={() => setActiveSubPage("following")}
            className="flex flex-col items-center text-center border-l border-[#E8E4DB] cursor-pointer hover:opacity-80 transition"
          >
            <span className="text-base font-bold text-[#0D0D0F] block overflow-hidden">
              <motion.span
                key={followingCount}
                initial={{ y: 15, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="inline-block"
              >
                {followingCount}
              </motion.span>
            </span>
            <span className="text-[10px] text-[#71717A] uppercase tracking-wider font-medium mt-0.5">Following</span>
          </div>

          <div className="flex flex-col items-center text-center border-l border-[#E8E4DB]">
            <span className="text-base font-bold text-[#0D0D0F]">
              {completedSessionsCount}
            </span>
            <span className="text-[10px] text-[#71717A] uppercase tracking-wider font-medium mt-0.5">Sessions</span>
          </div>

          <div className="flex flex-col items-center text-center border-l border-[#E8E4DB]">
            <span className="text-base font-bold text-[#0D0D0F] flex items-center gap-1 justify-center">
              {avgRating > 0 ? (
                <>
                  <span>{avgRating.toFixed(1)}</span>
                  <Star className="w-3.5 h-3.5 fill-[#C9A96E] text-[#C9A96E]" />
                </>
              ) : (
                <span className="text-[#A1A1AA] font-normal text-xs">New</span>
              )}
            </span>
            <span className="text-[10px] text-[#71717A] uppercase tracking-wider font-medium mt-0.5">Rating</span>
          </div>
        </div>

        {/* Social interactions or Action Controls */}
        <div className="flex gap-2.5 w-full">
          {isMe ? (
            /* Controls for current user */
            <div className="w-full">
              <div className="grid grid-cols-2 gap-3 w-full items-center">
                {(() => {
                  const isProfileComplete = Boolean(profile?.bio && (profile?.profilePhotoUrl || profile?.photoUrl) && profile?.city && (profile?.skillsToTeach?.length || 0) > 0);
                  return (
                    <button
                      id="profile-edit-toggle-btn"
                      onClick={handleEditProfileToggle}
                      className="w-full h-11 rounded-xl bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] font-medium text-xs tracking-wider transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer shadow-2xs select-none"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-[#C9A96E]" />
                      <span className="truncate">{isEditing ? "Close Editor" : isProfileComplete ? "Edit Profile" : "Complete Profile"}</span>
                    </button>
                  );
                })()}
                
                <button
                  id="profile-settings-btn"
                  onClick={() => setShowSettings(true)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E8E4DB] bg-[#FFFFFF] hover:bg-[#F2EFE8] text-[#0D0D0F] transition-all cursor-pointer flex items-center justify-center gap-2 font-medium text-xs tracking-wider shadow-2xs group select-none"
                  title="Settings"
                >
                  <Settings className="w-3.5 h-3.5 text-[#71717A]" />
                  <span>Settings</span>
                </button>
              </div>
            </div>
          ) : isBlocked ? (
            /* If we blocked this user */
            <div className="w-full p-6 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl flex flex-col items-center text-center gap-2">
              <Slash className="w-6 h-6 text-[#71717A]" />
              <h4 className="text-xs font-bold text-[#0D0D0F]">You have blocked this member</h4>
              <p className="text-xs text-[#71717A] leading-relaxed max-w-xs">
                You cannot follow, message, or swap skills with this user unless you unblock them.
              </p>
              <button
                onClick={handleBlockToggle}
                className="mt-2 px-5 h-9 bg-[#0D0D0F] hover:bg-[#1A1A1D] rounded-xl text-[#F7F4EE] text-xs font-medium transition cursor-pointer"
              >
                Unblock User
              </button>
            </div>
          ) : isBlockedByThem ? (
            /* If they blocked us */
            <div className="w-full p-6 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl flex flex-col items-center text-center gap-2">
              <ShieldAlert className="w-6 h-6 text-[#71717A]" />
              <h4 className="text-xs font-bold text-[#0D0D0F]">Profile Unavailable</h4>
              <p className="text-xs text-[#71717A] leading-relaxed max-w-xs">
                This member profile has restricted access and cannot be followed or messaged.
              </p>
            </div>
          ) : (
            /* Controls for browsing other user profile normally */
            <div className="flex flex-col gap-3 w-full">
              {/* ROW 1: Follow & Message in one line */}
              <div className="grid grid-cols-2 gap-3 w-full items-center">
                {/* 1. FOLLOW BUTTON */}
                <FollowButton
                  isFollowing={isFollowing}
                  isLoading={followLoading}
                  onClick={() => {
                    if (isFollowing) {
                      setShowUnfollowConfirm(true);
                    } else {
                      handleFollowToggle();
                    }
                  }}
                  fullWidth
                  className="w-full h-11"
                />

                {/* 2. MESSAGE BUTTON */}
                <button
                  id="profile-message-btn"
                  disabled={messageLoading}
                  onClick={handleMessageUser}
                  className="w-full h-11 rounded-xl border border-[#E8E4DB] bg-[#FFFFFF] hover:bg-[#F2EFE8] text-[#0D0D0F] font-medium text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap relative disabled:opacity-50 shadow-2xs group select-none"
                >
                  {messageLoading ? (
                    <div className="w-4 h-4 rounded-full border-2 border-[#0D0D0F] border-t-transparent animate-spin" />
                  ) : (
                    <>
                      <MessageSquare className="w-3.5 h-3.5 text-[#C9A96E]" />
                      <span>Message</span>
                    </>
                  )}
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-[#0D0D0F] text-[#C9A96E] text-[10px] font-bold h-5 px-2 rounded-full flex items-center justify-center border border-[#1A1A1D]">
                      {unreadCount}
                    </span>
                  )}
                </button>
              </div>

              {/* ROW 2: BOOK SWAP BUTTON */}
              <button
                id="profile-schedule-btn"
                onClick={() => setIsScheduling(true)}
                className="w-full h-11 rounded-xl bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] font-medium text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap shadow-2xs group select-none"
              >
                <CalendarDays className="w-4 h-4 text-[#C9A96E]" />
                <span>Request Skill Swap</span>
              </button>
            </div>
          )}
        </div>

        {/* Share profile alert */}
        {showShareSuccess && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs flex items-center gap-2 animate-fade-in">
            <Check className="w-4 h-4" /> Profile share link copied to clipboard successfully!
          </div>
        )}

        {/* Profile editing form (In-place & beautiful) */}
        {isEditing && isMe && (
          <div className="bg-white border border-gray-200 p-5 rounded-2xl flex flex-col gap-4 animate-fade-in shadow-xs">
            <span className="text-[10px] font-mono text-blue-600 uppercase tracking-widest font-bold flex items-center gap-1">
              <PenTool className="w-3.5 h-3.5" /> Complete profile details
            </span>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Display Name</label>
              <input
                id="edit-fullname-input"
                type="text"
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
            </div>

            {/* Custom Photo and Cover Trigger buttons */}
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Profile Photo</label>
                <button
                  type="button"
                  onClick={handleTriggerProfileUpload}
                  className="h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 hover:bg-gray-100 transition flex items-center justify-center gap-2 cursor-pointer font-medium"
                >
                  <UploadCloud className="w-4 h-4 text-blue-600" />
                  {uploadProgress.profile !== undefined ? `Uploading ${uploadProgress.profile}%` : "Upload Custom Avatar"}
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Cover Photo</label>
                <button
                  type="button"
                  onClick={handleTriggerCoverUpload}
                  className="h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 hover:bg-gray-100 transition flex items-center justify-center gap-2 cursor-pointer font-medium"
                >
                  <UploadCloud className="w-4 h-4 text-indigo-600" />
                  {uploadProgress.cover !== undefined ? `Uploading ${uploadProgress.cover}%` : "Upload Custom Cover"}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Username</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-mono">@</span>
                <input
                  id="edit-username-input"
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                  className="w-full h-11 pl-8 pr-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>
            </div>

            <CountryPicker
              selectedCode={editCountryCode}
              onChange={(c) => {
                setEditCountryCode(c.code);
                setEditCountry(c.name);
              }}
              label="Country"
            />

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Languages Spoken</label>
              <div className="flex gap-2">
                <input
                  id="edit-languages-input"
                  type="text"
                  placeholder="Type a language and press Enter"
                  value={editCurrentLanguage}
                  onChange={(e) => setEditCurrentLanguage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEditLanguage())}
                  className="flex-1 h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={addEditLanguage}
                  className="w-11 h-11 bg-gray-100 border border-gray-200 rounded-xl flex items-center justify-center hover:bg-gray-200 transition text-gray-700"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {editLanguages.map((lang) => (
                  <span key={lang} className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-[10px] text-blue-700 font-medium rounded-lg flex items-center gap-1">
                    {lang}
                    <button type="button" onClick={() => removeEditLanguage(lang)} className="hover:text-blue-900 text-blue-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Skills to Teach</label>
              <div className="flex gap-2">
                <input
                  id="edit-skills-teach-input"
                  type="text"
                  placeholder="Type a skill and press Enter"
                  value={editCurrentSkillTeach}
                  onChange={(e) => setEditCurrentSkillTeach(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEditSkillTeach())}
                  className="flex-1 h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={addEditSkillTeach}
                  className="w-11 h-11 bg-gray-100 border border-gray-200 rounded-xl flex items-center justify-center hover:bg-gray-200 transition text-gray-700"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {editSkillsToTeach.map((skill) => (
                  <span key={skill} className="px-2.5 py-1 bg-blue-50 border border-blue-200 text-[10px] text-blue-700 font-medium rounded-lg flex items-center gap-1">
                    {skill}
                    <button type="button" onClick={() => removeEditSkillTeach(skill)} className="hover:text-blue-900 text-blue-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Skills to Learn</label>
              <div className="flex gap-2">
                <input
                  id="edit-skills-learn-input"
                  type="text"
                  placeholder="Type a skill and press Enter"
                  value={editCurrentSkillLearn}
                  onChange={(e) => setEditCurrentSkillLearn(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEditSkillLearn())}
                  className="flex-1 h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={addEditSkillLearn}
                  className="w-11 h-11 bg-gray-100 border border-gray-200 rounded-xl flex items-center justify-center hover:bg-gray-200 transition text-gray-700"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {editSkillsToLearn.map((skill) => (
                  <span key={skill} className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-[10px] text-indigo-700 font-medium rounded-lg flex items-center gap-1">
                    {skill}
                    <button type="button" onClick={() => removeEditSkillLearn(skill)} className="hover:text-indigo-900 text-indigo-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Short Bio</label>
              <textarea
                id="edit-bio-input"
                rows={3}
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 resize-none leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">City</label>
                <input
                  id="edit-city-input"
                  type="text"
                  value={editCity}
                  onChange={(e) => setEditCity(e.target.value)}
                  className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Availability</label>
                <input
                  id="edit-availability-input"
                  type="text"
                  value={editAvailability}
                  onChange={(e) => setEditAvailability(e.target.value)}
                  className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 flex flex-col gap-3">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Portfolio & Social Handles</span>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase tracking-wider font-semibold text-gray-500">LinkedIn</label>
                  <input
                    id="edit-linkedin-input"
                    type="text"
                    placeholder="linkedin.com/in/username"
                    value={editLinkedin}
                    onChange={(e) => setEditLinkedin(e.target.value)}
                    className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:bg-white"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase tracking-wider font-semibold text-gray-500">GitHub</label>
                  <input
                    id="edit-github-input"
                    type="text"
                    placeholder="github.com/username"
                    value={editGithub}
                    onChange={(e) => setEditGithub(e.target.value)}
                    className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:bg-white"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase tracking-wider font-semibold text-gray-500">Instagram</label>
                  <input
                    id="edit-instagram-input"
                    type="text"
                    placeholder="instagram.com/username"
                    value={editInstagram}
                    onChange={(e) => setEditInstagram(e.target.value)}
                    className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:bg-white"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase tracking-wider font-semibold text-gray-500">Website</label>
                  <input
                    id="edit-website-input"
                    type="text"
                    placeholder="example.com"
                    value={editWebsite}
                    onChange={(e) => setEditWebsite(e.target.value)}
                    className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:bg-white"
                  />
                </div>
              </div>
            </div>

            {editError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center justify-center text-center font-medium">
                {editError}
              </div>
            )}

            <motion.button
              id="edit-save-btn"
              disabled={isSavingEdits}
              onClick={handleSaveEdits}
              whileHover={{ scale: isSavingEdits ? 1 : 1.01 }}
              whileTap={{ scale: isSavingEdits ? 1 : 0.98 }}
              className="w-full h-11 mt-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-full text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 transition-all select-none shadow-sm hover:shadow-md"
            >
              {isSavingEdits ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span>Save Profile Changes</span>
                </>
              )}
            </motion.button>
          </div>
        )}

        {/* Conditional Privacy Shield */}
        {(isBlocked || isBlockedByThem) ? (
          <div className="p-8 bg-white border border-dashed border-gray-200 rounded-3xl flex flex-col items-center text-center gap-2.5 py-12 animate-fade-in shadow-xs">
            <ShieldAlert className="w-8 h-8 text-blue-600 animate-pulse" />
            <h4 className="text-xs font-sans font-bold uppercase tracking-wider text-gray-900">Private Profile Information</h4>
            <p className="text-[10px] text-gray-500 leading-relaxed max-w-[240px]">
              {isBlocked 
                ? "This member's details are hidden because you have blocked them." 
                : "This profile has restricted details and is currently private."}
            </p>
          </div>
        ) : (
          <>
            {/* 1. Biography and Information */}
            <div className="bg-[#FFFFFF] border border-[#E8E4DB] p-5 rounded-2xl flex flex-col gap-2.5 shadow-2xs">
              <span className="text-[10px] uppercase text-[#71717A] tracking-wider font-semibold">Biography</span>
              <p className="text-xs text-[#0D0D0F] leading-relaxed font-normal">
                {profile.bio || <span className="text-[#A1A1AA] italic">"No biography added yet."</span>}
              </p>
            </div>

            {/* 2. Skills Exchange Details */}
            <div className="grid grid-cols-1 gap-4">
              {/* Skills Teach */}
              <div className="bg-[#FFFFFF] border border-[#E8E4DB] p-5 rounded-2xl flex flex-col gap-3 shadow-2xs">
                <span className="text-[10px] uppercase text-[#0D0D0F] tracking-wider flex items-center gap-1.5 font-semibold">
                  <Sparkles className="w-3.5 h-3.5 text-[#C9A96E]" /> Skills I Teach
                </span>
                <div className="flex flex-wrap gap-2">
                  {profile.skillsToTeach && profile.skillsToTeach.map((skill) => (
                    <span
                      key={skill}
                      className="px-3 py-1 bg-[#F2EFE8] border border-[#E8E4DB] text-xs text-[#0D0D0F] rounded-xl font-medium"
                    >
                      {skill}
                    </span>
                  ))}
                  {(!profile.skillsToTeach || profile.skillsToTeach.length === 0) && (
                    <div className="w-full p-4 rounded-xl border border-dashed border-[#E8E4DB] bg-[#F7F4EE] text-center text-[#71717A] text-xs">
                      No teaching skills yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Skills Learn */}
              <div className="bg-[#FFFFFF] border border-[#E8E4DB] p-5 rounded-2xl flex flex-col gap-3 shadow-2xs">
                <span className="text-[10px] uppercase text-[#0D0D0F] tracking-wider flex items-center gap-1.5 font-semibold">
                  <BookOpen className="w-3.5 h-3.5 text-[#C9A96E]" /> Skills I Want To Learn
                </span>
                <div className="flex flex-wrap gap-2">
                  {profile.skillsToLearn && profile.skillsToLearn.map((skill) => (
                    <span
                      key={skill}
                      className="px-3 py-1 bg-[#F7F4EE] border border-[#E8E4DB] text-xs text-[#0D0D0F] rounded-xl font-medium"
                    >
                      {skill}
                    </span>
                  ))}
                  {(!profile.skillsToLearn || profile.skillsToLearn.length === 0) && (
                    <div className="w-full p-4 rounded-xl border border-dashed border-[#E8E4DB] bg-[#F7F4EE] text-center text-[#71717A] text-xs">
                      No learning goals yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 3. Availability and Logistics */}
            <div className="bg-[#FFFFFF] border border-[#E8E4DB] p-5 rounded-2xl flex flex-col gap-3 shadow-2xs">
              <span className="text-[10px] uppercase text-[#71717A] tracking-wider font-semibold">Logistical Details</span>
              
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs border-b border-[#F2EFE8] pb-2.5">
                  <span className="text-[#71717A] flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-[#C9A96E]" /> Availability:
                  </span>
                  <span className="text-[#0D0D0F] font-semibold">
                    {profile.availability || <span className="text-[#A1A1AA] italic font-normal">Flexible</span>}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs border-b border-[#F2EFE8] pb-2.5">
                  <span className="text-[#71717A] flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-[#C9A96E]" /> Languages:
                  </span>
                  <span className="text-[#0D0D0F] font-semibold">
                    {profile.languages && profile.languages.length > 0 ? profile.languages.join(", ") : "English"}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs pb-1">
                  <span className="text-[#71717A] flex items-center gap-2">
                    <CalendarDays className="w-3.5 h-3.5 text-[#C9A96E]" /> Member Since:
                  </span>
                  <span className="text-[#0D0D0F] font-semibold">{getJoinedDateString()}</span>
                </div>
              </div>
            </div>

            {/* 4. Immutable Reviews Panel */}
            <div className="bg-[#FFFFFF] border border-[#E8E4DB] p-5 rounded-2xl flex flex-col gap-4 shadow-2xs">
              <span className="text-[10px] uppercase text-[#71717A] tracking-wider font-semibold">Peer Reviews</span>

              {reviews.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-[#E8E4DB] bg-[#F7F4EE] text-center text-[#71717A] text-xs font-normal">
                  No reviews yet.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {reviews.map((review) => (
                    <div
                      key={review.id}
                      className="p-4 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] flex flex-col gap-2 transition-all hover:bg-[#F2EFE8]"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-[#0D0D0F]">{review.reviewerName}</span>
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }).map((_, idx) => (
                            <Star
                              key={idx}
                              className={`w-3.5 h-3.5 ${
                                idx < review.rating ? "text-[#C9A96E] fill-[#C9A96E]" : "text-[#E8E4DB]"
                              }`}
                            />
                          ))}
                        </div>
                      </div>

                      <p className="text-xs text-[#71717A] leading-relaxed font-normal">
                        "{review.comment}"
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
      </>
    )}

        {/* If user has no teaching skills, no learning goals, etc. Show "Complete your profile" prompt */}
        {isMe && (!profile.bio || !profile.skillsToTeach || profile.skillsToTeach.length === 0 || !profile.skillsToLearn || profile.skillsToLearn.length === 0) && (
          <div className="p-6 rounded-3xl bg-blue-50/60 border border-dashed border-blue-200 text-center flex flex-col gap-3 items-center">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
              ✦
            </div>
            <h4 className="text-sm font-bold text-gray-900">Your Profile is Incomplete</h4>
            <p className="text-xs text-gray-600 max-w-xs leading-relaxed">
              Complete your biography, skills checklist, and city location to unlock matching suggestions.
            </p>
            <button
              onClick={handleEditProfileToggle}
              className="h-10 px-5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
            >
              Complete Your Profile
            </button>
          </div>
        )}

      </div>

      {/* Scheduling Session Booking Modal Overlay */}
      {isScheduling && !isMe && (() => {
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
        const selectedDateObject = sessionDateTime ? new Date(sessionDateTime) : null;

        // Step definitions with icons and subtitles
        const stepMetadata = [
          { icon: "📚", title: "What do you want to learn?", desc: `Select from ${profile.fullName}'s expert skills.` },
          { icon: "🎓", title: "What will you teach?", desc: "Your partner will learn this from you in return." },
          { icon: "⏱", title: "How long should the session be?", desc: "Choose a duration that fits your learning pace." },
          { icon: "🎥", title: "How do you want to connect?", desc: "Choose your preferred communication protocol." },
          { icon: "📅", title: "Choose Date & Time", desc: "Select a time comfortable for both practitioners to swap skills." },
          { icon: "💬", title: "Exchange Goals & Notes", desc: "Specify any targets, questions, or learning paths." }
        ];

        return (
          <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 font-sans overflow-y-auto pb-20 sm:pb-6">
            <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 w-full max-w-xl flex flex-col max-h-[85vh] sm:max-h-[88vh] shadow-2xl relative overflow-hidden text-gray-900 my-auto">
              
              {/* Top Accent Light Line */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-600 to-purple-600 opacity-80" />

              {/* Modal Header */}
              <div className="flex justify-between items-start pb-3 border-b border-gray-200 gap-4 shrink-0">
                <div className="flex flex-col gap-0.5">
                  <h3 className="font-display font-bold text-base sm:text-lg text-gray-900 flex items-center gap-2">
                    <span>✨ Start a Skill Swap</span>
                  </h3>
                  <span className="text-xs text-gray-500">Learn one skill. Teach one skill.</span>
                </div>
                <button
                  id="close-schedule-modal-btn"
                  onClick={() => {
                    setIsScheduling(false);
                    setBookingStep(1);
                    setSubmittingStage("idle");
                  }}
                  className="text-gray-400 hover:text-gray-900 transition p-2 rounded-xl hover:bg-gray-100 border border-transparent hover:border-gray-200 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Step Progress Bar & Indicators */}
              {!sessionSuccess && (
                <div className="flex flex-col gap-1.5 py-3 shrink-0">
                  <div className="flex items-center justify-between text-[11px] font-mono text-gray-500 uppercase tracking-widest">
                    <span>Step {bookingStep} of 6: <strong className="text-gray-800">{stepMetadata[bookingStep - 1].title}</strong></span>
                    <span>{Math.round((bookingStep / 6) * 100)}% Complete</span>
                  </div>
                  <div className="grid grid-cols-6 gap-1.5">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          i === bookingStep
                            ? "bg-blue-600 shadow-xs shadow-blue-500/50"
                            : i < bookingStep
                            ? "bg-purple-500/50"
                            : "bg-gray-200"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {sessionError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-600 flex items-center gap-2 font-medium shrink-0 my-1">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{sessionError}</span>
                </div>
              )}

              {/* Success Screen */}
              {sessionSuccess ? (
                <div className="flex flex-col items-center text-center py-8 px-4 gap-6 animate-fade-in text-emerald-600 overflow-y-auto">
                  <div className="w-20 h-20 rounded-full border-2 border-emerald-500 flex items-center justify-center p-3 bg-emerald-50 shadow-xl shadow-emerald-500/10 relative">
                    <Check className="w-10 h-10 text-emerald-600" />
                    <div className="absolute inset-0 rounded-full border border-emerald-500 animate-ping opacity-20"></div>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <h4 className="font-display font-bold text-xl text-gray-900">✓ Request Sent</h4>
                    <p className="text-sm text-gray-500">Waiting for your partner...</p>
                    <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 border border-gray-200 rounded-full text-[10px] text-gray-600 font-mono self-center">
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      <span>Estimated response: <strong className="text-gray-900">Under 10 minutes</strong></span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsScheduling(false);
                      setSessionSuccess(false);
                      setSelectedSkill("");
                      setSkillToTeach("");
                      setSessionDateTime("");
                      setSessionNotes("");
                      setBookingStep(1);
                      setSubmittingStage("idle");
                      onNavigateToTab("sessions");
                    }}
                    className="w-full h-14 bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-900 rounded-2xl font-bold text-xs active:scale-98 transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Return Home</span>
                    <ArrowRight className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              ) : fetchingTeachableSkills ? (
                <div className="py-2">
                  <SkeletonLoader type="swap" />
                </div>
              ) : teachableSkills.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-4 bg-gray-50 border border-gray-200 rounded-2xl">
                  <div className="w-12 h-12 rounded-full bg-red-100 border border-red-200 flex items-center justify-center text-red-500">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <h4 className="text-sm font-semibold text-gray-900">Booking Restricted</h4>
                    <p className="text-xs text-red-600 max-w-xs leading-relaxed font-semibold">
                      This user has not listed any teachable skills.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsScheduling(false)}
                    className="h-11 px-6 bg-gray-100 hover:bg-gray-200 text-xs font-semibold rounded-xl text-gray-700 transition cursor-pointer"
                  >
                    Close Modal
                  </button>
                </div>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); if (bookingStep === 6) handleScheduleSession(e); }} className="flex flex-col flex-1 min-h-0">
                  
                  {/* Scrollable Body Content */}
                  <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-4 py-1">
                    {/* Step Description Card */}
                    <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-2xl flex gap-3 items-start shrink-0">
                      <span className="text-xl select-none">{stepMetadata[bookingStep - 1].icon}</span>
                      <div className="flex flex-col gap-0.5">
                        <h4 className="text-xs font-semibold text-gray-900">{stepMetadata[bookingStep - 1].title}</h4>
                        <p className="text-[11px] text-gray-500 leading-relaxed">{stepMetadata[bookingStep - 1].desc}</p>
                      </div>
                    </div>

                  {/* ACTIVE QUESTION PANEL */}
                  <div className="min-h-[140px] flex flex-col justify-center gap-4">
                    
                    {/* STEP 1: Learn Skill Selection */}
                    {bookingStep === 1 && (
                      <div className="flex flex-col gap-3 animate-fade-in">
                        <div className="relative">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            placeholder="Search their skills..."
                            value={learnSearch}
                            onChange={(e) => setLearnSearch(e.target.value)}
                            className="w-full h-12 pl-11 pr-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-all"
                          />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto pr-1">
                          {(teachableSkills.filter(s => s.toLowerCase().includes(learnSearch.toLowerCase())).length > 0
                            ? teachableSkills.filter(s => s.toLowerCase().includes(learnSearch.toLowerCase()))
                            : ["Python", "English", "UI Design", "Photography"].filter(s => s.toLowerCase().includes(learnSearch.toLowerCase()))
                          ).map((skill) => {
                            const isSelected = selectedSkill === skill;
                            return (
                              <button
                                key={skill}
                                type="button"
                                onClick={() => {
                                  setSelectedSkill(skill);
                                  setSessionError("");
                                  setBookingStep(2);
                                }}
                                className={`p-3.5 rounded-2xl border text-left flex items-center justify-between transition-all group cursor-pointer ${
                                  isSelected
                                    ? "border-blue-600 bg-blue-50 text-blue-900 shadow-md"
                                    : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:text-gray-900"
                                }`}
                              >
                                <div className="flex flex-col">
                                  <span className="text-xs font-semibold">{skill}</span>
                                  <span className="text-[10px] text-gray-400 group-hover:text-gray-500">Available from partner</span>
                                </div>
                                {isSelected ? (
                                  <Check className="w-4 h-4 text-blue-600 shrink-0" />
                                ) : (
                                  <ArrowRight className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* STEP 2: Teach Skill Selection */}
                    {bookingStep === 2 && (
                      <div className="flex flex-col gap-4 animate-fade-in">
                        <div className="relative">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            placeholder="Type a skill you can teach them..."
                            value={skillToTeach}
                            onChange={(e) => {
                              setSkillToTeach(e.target.value);
                              setTeachSearch(e.target.value);
                              setSessionError("");
                            }}
                            className="w-full h-12 pl-11 pr-4 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-all"
                          />
                        </div>

                        <div className="flex flex-col gap-2">
                          <span className="text-[10px] uppercase font-mono tracking-wider text-gray-400">Suggestions based on your profile:</span>
                          <div className="flex flex-wrap gap-2">
                            {(currentUserProfile?.skillsToTeach && currentUserProfile.skillsToTeach.length > 0
                              ? currentUserProfile.skillsToTeach
                              : ["TypeScript", "React", "Spanish", "Product Strategy", "Growth Marketing"]
                            ).filter(s => s.toLowerCase().includes(teachSearch.toLowerCase())).map((skill) => {
                              const isSelected = skillToTeach === skill;
                              return (
                                <button
                                  key={skill}
                                  type="button"
                                  onClick={() => {
                                    setSkillToTeach(skill);
                                    setSessionError("");
                                    setBookingStep(3);
                                  }}
                                  className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                                    isSelected
                                      ? "bg-purple-50 border-purple-500 text-purple-900"
                                      : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900"
                                  }`}
                                >
                                  {skill}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* STEP 3: Duration selection */}
                    {bookingStep === 3 && (
                      <div className="grid grid-cols-3 gap-3 animate-fade-in">
                        {[
                          { value: 30, label: "30 min", desc: "Quick check-in & exchange" },
                          { value: 60, label: "60 min", desc: "Deep dive & practice (Recommended)" },
                          { value: 90, label: "90 min", desc: "Masterclass comprehensive sync" }
                        ].map((dur) => {
                          const isSelected = sessionDuration === dur.value;
                          return (
                            <button
                              key={dur.value}
                              type="button"
                              onClick={() => {
                                setSessionDuration(dur.value);
                                setBookingStep(4);
                              }}
                              className={`p-4 rounded-2xl border flex flex-col items-center text-center justify-between gap-3 min-h-[110px] transition-all cursor-pointer ${
                                isSelected
                                  ? "border-blue-600 bg-blue-50 text-blue-900 shadow-md"
                                  : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:text-gray-900"
                              }`}
                            >
                              <span className="text-sm font-bold">{dur.label}</span>
                              <span className="text-[9px] leading-relaxed text-gray-400">{dur.desc}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* STEP 4: Protocol selection */}
                    {bookingStep === 4 && (
                      <div className="grid grid-cols-3 gap-3 animate-fade-in">
                        {[
                          { value: "HD Video Call", label: "Video Call", icon: Camera },
                          { value: "Voice Call", label: "Voice Call", icon: Phone },
                          { value: "Chat Session", label: "Chat Session", icon: MessageSquare }
                        ].map((item) => {
                          const isSelected = sessionType === item.value;
                          const IconComponent = item.icon;
                          return (
                            <button
                              key={item.value}
                              type="button"
                              onClick={() => {
                                setSessionType(item.value as any);
                                setBookingStep(5);
                              }}
                              className={`p-5 rounded-2xl border flex flex-col items-center text-center gap-3 transition-all cursor-pointer ${
                                isSelected
                                  ? "border-blue-600 bg-blue-50 text-blue-900 shadow-md"
                                  : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:text-gray-900"
                              }`}
                            >
                              <IconComponent className={`w-5 h-5 ${isSelected ? "text-blue-600" : "text-gray-400"}`} />
                              <span className="text-xs font-semibold">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* STEP 5: Date and Time */}
                    {bookingStep === 5 && (() => {
                      const now = new Date();
                      const todayStr = getLocalDateString(now);
                      
                      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                      const tomorrowStr = getLocalDateString(tomorrow);
                      
                      const in2Days = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
                      const in2DaysStr = getLocalDateString(in2Days);

                      const curDateStr = sessionDateTime ? sessionDateTime.split("T")[0] : tomorrowStr;
                      const curTimeStr = sessionDateTime && sessionDateTime.includes("T") ? sessionDateTime.split("T")[1] : "10:00";
                      const isSelectedDateToday = curDateStr === todayStr;

                      const updateDateTime = (newDate: string, newTime: string) => {
                        setSessionError("");
                        setSessionDateTime(`${newDate}T${newTime}`);
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
                        <div className="flex flex-col gap-4 animate-fade-in">
                          {/* Quick Date Presets & Date Picker */}
                          <div className="flex flex-col gap-2">
                            <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-blue-600" /> Select Date:
                            </label>

                            <div className="grid grid-cols-3 gap-2">
                              {[
                                { label: "Today", date: todayStr },
                                { label: "Tomorrow", date: tomorrowStr },
                                { label: "In 2 Days", date: in2DaysStr },
                              ].map((item) => (
                                <button
                                  key={item.date}
                                  type="button"
                                  onClick={() => {
                                    // When switching to Today, pick the preferred time or next future slot
                                    if (item.date === todayStr && isPastTimeSlot(item.date, curTimeStr, now)) {
                                      const nextSlot = timePresets.find(p => !isPastTimeSlot(item.date, p.value, now));
                                      const fallbackTime = nextSlot ? nextSlot.value : getLocalTimeString(new Date(now.getTime() + 30 * 60 * 1000));
                                      updateDateTime(item.date, fallbackTime);
                                    } else {
                                      updateDateTime(item.date, curTimeStr);
                                    }
                                  }}
                                  className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                                    curDateStr === item.date
                                      ? "border-blue-600 bg-blue-50 text-blue-900 font-bold shadow-sm"
                                      : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                                  }`}
                                >
                                  {item.label}
                                </button>
                              ))}
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
                                  updateDateTime(newDate, fallbackTime);
                                } else {
                                  updateDateTime(newDate, curTimeStr);
                                }
                              }}
                              className="w-full h-11 px-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:border-blue-500 font-medium"
                              required
                            />
                          </div>

                          {/* Quick Time Presets & Custom Time Picker */}
                          <div className="flex flex-col gap-2">
                            <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-blue-600" /> Select Comfortable Time:
                            </label>

                            <div className="grid grid-cols-3 gap-2">
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
                                        updateDateTime(curDateStr, preset.value);
                                      }
                                    }}
                                    title={isPast ? "This time slot has already passed today" : undefined}
                                    className={`py-2 px-2 rounded-xl border text-xs transition-all ${
                                      isPast
                                        ? "opacity-35 bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed line-through"
                                        : isSelected
                                        ? "border-purple-600 bg-purple-50 text-purple-900 font-bold shadow-sm cursor-pointer"
                                        : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 cursor-pointer"
                                    }`}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>

                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[11px] text-gray-500 shrink-0 font-medium">Or custom time:</span>
                              <input
                                type="time"
                                value={curTimeStr}
                                min={isSelectedDateToday ? getLocalTimeString(now) : undefined}
                                onChange={(e) => updateDateTime(curDateStr, e.target.value)}
                                className={`flex-1 h-11 px-3 bg-gray-50 border rounded-xl text-xs text-gray-900 focus:outline-none font-medium transition ${
                                  isCurrentChoicePast ? "border-amber-400 bg-amber-50/40 focus:border-amber-500" : "border-gray-200 focus:border-blue-500"
                                }`}
                                required
                              />
                            </div>

                            {isCurrentChoicePast && (
                              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs text-amber-800 animate-fade-in">
                                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                                <span>Please select a future time. The selected time has already passed.</span>
                              </div>
                            )}
                          </div>

                          {selectedDateObject && !isCurrentChoicePast && (
                            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex flex-col gap-2 font-sans text-xs text-emerald-950">
                              <div className="flex items-center gap-2 font-bold text-emerald-800">
                                <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span>Swap Comfort Window</span>
                              </div>
                              <div className="flex justify-between items-center pt-1 border-t border-emerald-200/60">
                                <span className="text-emerald-700 font-medium">Scheduled Time:</span>
                                <span className="font-bold text-emerald-900">
                                  {selectedDateObject.toLocaleString([], {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    hour12: true
                                  })}
                                </span>
                              </div>
                              <p className="text-[11px] text-emerald-700 leading-relaxed mt-0.5">
                                {(() => {
                                  const hours = selectedDateObject.getHours();
                                  const isComfortable = hours >= 8 && hours <= 21;
                                  if (isComfortable) {
                                    return `✨ Daytime slot — highly comfortable for both you and ${profile.fullName} to conduct your skill swap!`;
                                  } else {
                                    return `⏰ Early morning or evening slot selected. Ensure both you and ${profile.fullName} are comfortable with this time.`;
                                  }
                                })()}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* STEP 6: Optional goals note */}
                    {bookingStep === 6 && (
                      <div className="flex flex-col gap-3 animate-fade-in">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase font-mono tracking-wider text-gray-400 font-bold">Quick topics:</span>
                          <span className="text-[10px] font-mono text-gray-400 font-bold">
                            {sessionNotes.length}/200 max
                          </span>
                        </div>
                        
                        <div className="flex flex-wrap gap-2">
                          {[
                            "I'm a beginner.",
                            "I need interview preparation.",
                            "I only want to practice speaking."
                          ].map((note) => (
                            <button
                              key={note}
                              type="button"
                              onClick={() => {
                                setSessionNotes(note);
                              }}
                              className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-200 text-[10px] rounded-lg text-gray-600 hover:text-gray-900 transition cursor-pointer"
                            >
                              {note}
                            </button>
                          ))}
                        </div>

                        <textarea
                          value={sessionNotes}
                          onChange={(e) => setSessionNotes(e.target.value.substring(0, 200))}
                          placeholder="Specify what you want to learn or any topics you wish to cover..."
                          className="w-full h-24 p-4 bg-gray-50 border border-gray-200 rounded-2xl text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-all resize-none leading-relaxed"
                          maxLength={200}
                        />
                      </div>
                    )}

                  </div>
                  </div>

                  {/* BOTTOM NAVIGATION ACTIONS */}
                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-200 shrink-0 bg-white z-10">
                    {bookingStep > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSessionError("");
                          setBookingStep(prev => prev - 1);
                        }}
                        className="h-12 px-5 bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-900 rounded-2xl flex items-center justify-center gap-2 transition active:scale-98 cursor-pointer font-bold text-xs shrink-0"
                      >
                        <ChevronLeft className="w-4 h-4 text-gray-500" />
                        <span>Back</span>
                      </button>
                    )}

                    {bookingStep < 6 ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (bookingStep === 1 && !selectedSkill) {
                            setSessionError("Please select the skill you want to learn first.");
                            return;
                          }
                          if (bookingStep === 2 && !skillToTeach) {
                            setSessionError("Please select or specify the skill you will teach first.");
                            return;
                          }
                          if (bookingStep === 5) {
                            const curDate = sessionDateTime ? sessionDateTime.split("T")[0] : getLocalDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
                            const curTime = sessionDateTime && sessionDateTime.includes("T") ? sessionDateTime.split("T")[1] : "10:00";
                            const effectiveDateTime = sessionDateTime || `${curDate}T${curTime}`;
                            const validation = validateSessionDateTime(effectiveDateTime, new Date());
                            if (!validation.isValid) {
                              setSessionError(validation.error || "Please select a future time.");
                              return;
                            }
                            if (!sessionDateTime) {
                              setSessionDateTime(effectiveDateTime);
                            }
                          }
                          setSessionError("");
                          setBookingStep(prev => prev + 1);
                        }}
                        className="flex-1 h-12 bg-gradient-to-r from-[#5B8CFF] to-[#8B5CF6] hover:opacity-90 text-white rounded-2xl flex items-center justify-center gap-2 transition font-bold text-xs active:scale-98 cursor-pointer shadow-lg shadow-blue-500/10"
                      >
                        <span>Next Question</span>
                        <ChevronRight className="w-4 h-4 text-white" />
                      </button>
                    ) : (
                      <button
                        id="schedule-submit-btn"
                        type="button"
                        onClick={(e) => handleScheduleSession(e)}
                        disabled={sessionLoading}
                        className="flex-1 h-12 bg-gradient-to-r from-[#5B8CFF] to-[#8B5CF6] hover:opacity-90 text-white rounded-2xl flex items-center justify-center gap-2 transition font-bold text-xs active:scale-98 cursor-pointer shadow-lg shadow-blue-500/15 disabled:opacity-50"
                      >
                        {submittingStage === "idle" && (
                          <>
                            <span>🚀 Send Swap Request</span>
                          </>
                        )}
                        {submittingStage === "matching" && (
                          <div className="flex items-center gap-2">
                            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                            <span>Finding the best match...</span>
                          </div>
                        )}
                        {submittingStage === "sending" && (
                          <div className="flex items-center gap-2">
                            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                            <span>Sending request...</span>
                          </div>
                        )}
                        {submittingStage === "done" && (
                          <div className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-emerald-400" />
                            <span>Request Sent ✅</span>
                          </div>
                        )}
                      </button>
                    )}
                  </div>

                </form>
              )}
            </div>
          </div>
        );
      })()}

      {/* Report User Dialog Modal */}
      {showReportDialog && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-6 font-sans">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4 animate-scale-up">
            <div className="flex justify-between items-center border-b border-slate-850 pb-3">
              <h3 className="font-display font-bold text-base text-red-400 flex items-center gap-1.5">
                <Flag className="w-4 h-4" /> Report Misconduct
              </h3>
              <button
                onClick={() => setShowReportDialog(false)}
                className="text-slate-500 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reportSuccess ? (
              <div className="flex flex-col items-center text-center py-6 gap-3 animate-fade-in text-emerald-400">
                <Check className="w-12 h-12 rounded-full border-2 border-emerald-500 p-2" />
                <h4 className="font-semibold text-sm">Report Received</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The moderator team has been alerted of this misconduct. Thank you for keeping SwapSkill safe.
                </p>
              </div>
            ) : (
              <form onSubmit={handleReportUser} className="flex flex-col gap-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Please describe the violation or abusive behavior. Verified reports are acted upon within 24 hours.
                </p>
                <textarea
                  id="report-reason-input"
                  rows={4}
                  required
                  placeholder="Provide precise details of the incident..."
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-1 focus:ring-red-500 resize-none leading-relaxed"
                />
                <button
                  type="submit"
                  disabled={reportLoading || !reportReason.trim()}
                  className="w-full h-11 bg-red-600 hover:bg-red-500 rounded-xl font-semibold text-xs text-white transition disabled:opacity-55 cursor-pointer"
                >
                  {reportLoading ? "Filing Report..." : "Submit Abuse Report"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Identity & Expert Verification Challenge Dialog Modal */}
      <AnimatePresence>
        {showVerifyModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-6 font-sans">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-2xl"
            >
              <div className="flex justify-between items-center border-b border-slate-850 pb-3">
                <h3 className="font-display font-bold text-base text-[#D4AF37] flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 animate-pulse" /> Verify Expert Status
                </h3>
                <button
                  onClick={() => setShowVerifyModal(false)}
                  className="text-slate-500 hover:text-white transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {verifySuccess ? (
                <div className="flex flex-col items-center text-center py-6 gap-3 animate-fade-in text-emerald-400">
                  <Check className="w-12 h-12 rounded-full border-2 border-[#D4AF37] p-2 text-[#D4AF37] animate-pulse" />
                  <h4 className="font-semibold text-sm text-[#D4AF37]">Profile Certified ✦</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Amazing! Your expert credentials are approved. The gold verification badge has been minted on your Studio profile and +100 swap points are credited!
                  </p>
                </div>
              ) : (
                <form onSubmit={handleVerifySubmit} className="flex flex-col gap-4">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Verify your skill experience to earn trust in the directory, get featured on the main Discovery board, and unlock advanced exchange privileges.
                  </p>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Portfolio, Github, or LinkedIn Proof</label>
                    <input
                      type="url"
                      required
                      placeholder="https://github.com/yourusername"
                      value={verifyPortfolio}
                      onChange={(e) => setVerifyPortfolio(e.target.value)}
                      className="w-full h-11 px-4 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Select Expert Domain</label>
                    <select
                      required
                      value={verifyDomain}
                      onChange={(e) => setVerifyDomain(e.target.value)}
                      className="w-full h-11 px-4 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                    >
                      <option value="" disabled>Choose Domain...</option>
                      <option value="Software Architecture">Software Architecture</option>
                      <option value="Product Design & UI/UX">Product Design & UI/UX</option>
                      <option value="Languages & Linguistics">Languages & Linguistics</option>
                      <option value="Creative Arts & Film">Creative Arts & Film</option>
                      <option value="Business Strategy & Growth">Business Strategy & Growth</option>
                    </select>
                  </div>

                  <div className="flex items-start gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="pledge-chk"
                      checked={verifyPledge}
                      onChange={(e) => setVerifyPledge(e.target.checked)}
                      className="mt-0.5 rounded border-slate-800 bg-slate-950 text-[#D4AF37] focus:ring-[#D4AF37] h-4.5 w-4.5 cursor-pointer"
                    />
                    <label htmlFor="pledge-chk" className="text-[10px] text-slate-400 leading-normal select-none cursor-pointer">
                      I pledge to provide respectful, high-quality, non-commercial peer learning exchanges on SwapSkill.
                    </label>
                  </div>

                  {verifyError && (
                    <p className="text-[10px] text-red-400 font-mono font-bold animate-pulse">{verifyError}</p>
                  )}

                  <button
                    type="submit"
                    disabled={verifySubmitting}
                    className="w-full h-11 bg-gradient-to-r from-[#D4AF37] to-[#e5c158] hover:from-[#e5c158] hover:to-[#D4AF37] text-black rounded-xl font-bold text-xs transition disabled:opacity-55 cursor-pointer shadow-lg active:scale-98"
                  >
                    {verifySubmitting ? "Processing Challenge..." : "Submit Expert Verification ✦"}
                  </button>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Fullscreen Photo Viewer */}
      <AnimatePresence>
        {fullscreenImage && (
          <FullscreenViewer
            src={fullscreenImage.src}
            alt={fullscreenImage.alt}
            layoutId={fullscreenImage.layoutId}
            showDownload={fullscreenImage.showDownload}
            onClose={() => setFullscreenImage(null)}
          />
        )}
      </AnimatePresence>

      {/* Unfollow Confirmation Dialog Modal */}
      <AnimatePresence>
        {showUnfollowConfirm && profile && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 font-sans">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-xs flex flex-col gap-4 shadow-2xl"
            >
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-[#D4AF37]/30">
                  <SmartImage
                    src={profile.profilePhotoUrl || profile.photoUrl}
                    alt={profile.fullName || "User"}
                    fallbackType="profile"
                    fullName={profile.fullName}
                    className="w-full h-full"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="font-display font-bold text-sm text-white">Unfollow @{profile.username}?</h3>
                  <p className="text-slate-400 text-xs leading-relaxed">
                    Are you sure you want to stop following {profile.fullName}?
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowUnfollowConfirm(false);
                    handleFollowToggle(); // Trigger actual unfollow
                  }}
                  className="w-full h-11 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  Unfollow
                </button>
                <button
                  type="button"
                  onClick={() => setShowUnfollowConfirm(false)}
                  className="w-full h-11 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSaveSuccessToast && (
          <motion.div
            initial={{ y: -50, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -30, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[100000] bg-white border border-gray-200 text-gray-900 px-5 py-3 rounded-full shadow-2xl backdrop-blur-2xl flex items-center gap-2.5 pointer-events-none select-none"
          >
            <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            </div>
            <span className="text-xs font-bold tracking-tight text-amber-200 whitespace-nowrap">
              Profile Updated Successfully
            </span>
          </motion.div>
        )}
      </AnimatePresence>

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
