import React, { useState, useEffect, useRef, Suspense } from "react";
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
  onSnapshot,
  limit
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
import BlockUserConfirmModal from "./BlockUserConfirmModal";
import { useBackHandler } from "../utils/navigationManager";
import { getShareProfileUrl } from "../utils/apiConfig";
import { sanitizeExternalLink } from "../utils/urlSecurity";
import { formatChatText } from "../utils/textFormatter";
import { pushNotificationService } from "../services/mobile/pushNotificationService";
import { ProfileBattleStatsCard } from "./battles/ProfileBattleStatsCard";
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
  ArrowLeft,
  UserX,
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
  ChevronDown,
  Phone,
  Edit3,
  Loader2,
  BadgeCheck
} from "lucide-react";
import { OperationType, handleFirestoreError } from "../utils/firestoreError";
import { compressImage, optimizeImage, applyCloudinaryAutoOptimization } from "../utils/imageCompressor";
import { uploadImageToCloudinary } from "../utils/cloudinary";
import { ImageCropModal } from "./ImageCropModal";
import CountryPicker from "./CountryPicker";
import SearchablePickerModal from "./SearchablePickerModal";
import { WORLD_LANGUAGES } from "../data/languages";
import { Shield } from "lucide-react";
import { SmartImage } from "./SmartImage";
const SettingsView = React.lazy(() => import("./SettingsView"));
import GetVerifiedModal from "./GetVerifiedModal";
const FollowersFollowingView = React.lazy(() => import("./FollowersFollowingView"));
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
      const a = document.createElement("a");
      a.href = src;
      a.download = alt ? `${alt.toLowerCase().replace(/\s+/g, "_")}.jpg` : "download.jpg";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            animate={{ scale }}
            transition={{ type: "spring", damping: 25, stiffness: 180 }}
            onDoubleClick={handleDoubleClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="max-w-full max-h-full object-contain pointer-events-none select-none rounded-lg"
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
  onNavigateToTab: (tab: "home" | "search" | "messages" | "sessions" | "battles" | "profile") => void;
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
  const { setShowLogoutConfirm, chats, toggleFollow, currentUserProfile, updateProfile, profilesCache } = useApp();
  const isMe = currentUserId === selectedUserId;

  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (isMe && currentUserProfile) return currentUserProfile;
    if (profilesCache && profilesCache[selectedUserId]) return profilesCache[selectedUserId];
    try {
      const perUserKey = `swap_cached_profile_${selectedUserId}`;
      const cached = safeLocalStorage.getItem(perUserKey) || safeLocalStorage.getItem("swap_cached_profile");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && (parsed.uid === selectedUserId || parsed.id === selectedUserId)) {
          return parsed;
        }
      }
    } catch (_) {}
    return null;
  });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(() => {
    if (isMe && currentUserProfile) return false;
    if (profilesCache && profilesCache[selectedUserId]) return false;
    try {
      const perUserKey = `swap_cached_profile_${selectedUserId}`;
      const cached = safeLocalStorage.getItem(perUserKey) || safeLocalStorage.getItem("swap_cached_profile");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && (parsed.uid === selectedUserId || parsed.id === selectedUserId)) {
          return false;
        }
      }
    } catch (_) {}
    return true;
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUserNotFound, setIsUserNotFound] = useState(false);
  const [notFoundHandle, setNotFoundHandle] = useState<string>("");

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
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockModalMode, setBlockModalMode] = useState<"block" | "unblock">("block");

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
  const [editLanguagePickerOpen, setEditLanguagePickerOpen] = useState(false);
  const [editSkillsToTeach, setEditSkillsToTeach] = useState<string[]>([]);
  const [editCurrentSkillTeach, setEditCurrentSkillTeach] = useState("");
  const [editSkillProficiencies, setEditSkillProficiencies] = useState<Record<string, "Beginner" | "Intermediate" | "Advanced" | "Expert">>({});
  const [selectedTeachLevel, setSelectedTeachLevel] = useState<"Beginner" | "Intermediate" | "Advanced" | "Expert">("Intermediate");

  const [editSkillsToLearn, setEditSkillsToLearn] = useState<string[]>([]);
  const [editCurrentSkillLearn, setEditCurrentSkillLearn] = useState("");
  const [editLearnSkillLevels, setEditLearnSkillLevels] = useState<Record<string, string>>({});
  const [selectedLearnLevel, setSelectedLearnLevel] = useState<string>("Beginner");

  // Image Upload Progress and Ref States
  const profileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Image Cropper State
  const [cropModalState, setCropModalState] = useState<{
    isOpen: boolean;
    imageSrc: string | null;
    cropType: "profile" | "cover";
    isUploading: boolean;
  }>({
    isOpen: false,
    imageSrc: null,
    cropType: "profile",
    isUploading: false,
  });

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

  // Identity & Verification Portal State (strictly admin-approved, never self-verified)
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const reviewsSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setShowAllReviews(false);
  }, [selectedUserId]);

  // Intercept back button for open modals, sheets and subpages in ProfileView
  useBackHandler(showBlockModal, () => {
    setShowBlockModal(false);
  });
  useBackHandler(Boolean(fullscreenImage), () => {
    setFullscreenImage(null);
  });
  useBackHandler(showReportDialog, () => {
    setShowReportDialog(false);
  });
  useBackHandler(showUnfollowConfirm, () => {
    setShowUnfollowConfirm(false);
  });
  useBackHandler(showVerifyModal, () => {
    setShowVerifyModal(false);
  });
  useBackHandler(isScheduling, () => {
    setIsScheduling(false);
  });
  useBackHandler(isEditing, () => {
    setIsEditing(false);
  });
  useBackHandler(showSettings, () => {
    setShowSettings(false);
  });
  useBackHandler(Boolean(activeSubPage), () => {
    setActiveSubPage(null);
  });

  // Immediate synchronization with currentUserProfile
  useEffect(() => {
    if (isMe && currentUserProfile) {
      setProfile(currentUserProfile);
      setLoading(false);
      setFollowersCount(currentUserProfile.followersCount || 0);
      setFollowingCount(currentUserProfile.followingCount || 0);
      setEditFullName(currentUserProfile.fullName || "");
      setEditBio(currentUserProfile.bio || "");
      setEditAvailability(currentUserProfile.availability || "");
      setEditCity(currentUserProfile.city || "");
      setEditPhotoUrl(currentUserProfile.profilePhotoUrl || currentUserProfile.photoUrl || "");
      setEditCoverUrl(currentUserProfile.coverPhotoUrl || currentUserProfile.coverUrl || "");
      setEditUsername(currentUserProfile.username || "");
      setEditCountry(currentUserProfile.country || "");
      setEditCountryCode(currentUserProfile.countryCode || "");
      setEditLanguages(currentUserProfile.languages || []);
      setEditSkillsToTeach((currentUserProfile.skillsToTeach || []).filter(s => s && s.trim()));
      setEditSkillsToLearn((currentUserProfile.skillsToLearn || []).filter(s => s && s.trim()));
      setEditSkillProficiencies(currentUserProfile.skillProficiencies || {});
      setEditLearnSkillLevels((currentUserProfile as any).learnSkillLevels || {});
      try {
        safeLocalStorage.setItem("swap_cached_profile", JSON.stringify(currentUserProfile));
      } catch (_) {}
    }
  }, [isMe, currentUserProfile]);

  // Reactive synchronization with AppContext cache when browsing another user's profile (e.g., pull-to-refresh)
  useEffect(() => {
    if (!isMe && profilesCache && profilesCache[selectedUserId]) {
      const cached = profilesCache[selectedUserId];
      setProfile(cached);
      setFollowersCount(cached.followersCount || 0);
      setFollowingCount(cached.followingCount || 0);
      setLoading(false);
    }
  }, [isMe, profilesCache, selectedUserId]);

  // Load profile details and reviews
  useEffect(() => {
    let isCancelled = false;
    async function loadProfileData() {
      if (!profile) {
        setLoading(true);
      }
      setLoadError(null);
      try {
        if (isMe) {
          const docRef = doc(db, "users", selectedUserId);
          const docSnap = await getDoc(docRef);
          if (isCancelled) return;
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setProfile(data);
            setFollowersCount(data.followersCount || 0);
            setFollowingCount(data.followingCount || 0);
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
            setEditSkillsToTeach((data.skillsToTeach || []).filter(s => s && s.trim()));
            setEditSkillsToLearn((data.skillsToLearn || []).filter(s => s && s.trim()));
            setEditSkillProficiencies(data.skillProficiencies || {});
            setEditLearnSkillLevels((data as any).learnSkillLevels || {});
          }
          setLoading(false);

          // Asynchronously load reviews without blocking UI
          try {
            const reviewsRef = collection(db, "reviews");
            const q = query(reviewsRef, where("revieweeId", "==", selectedUserId));
            const querySnapshot = await getDocs(q);
            if (!isCancelled) {
              const loadedReviews: Review[] = [];
              querySnapshot.forEach((d) => {
                loadedReviews.push({ ...(d.data() as Review), id: d.id });
              });
              setReviews(loadedReviews);
            }
          } catch (_) {}
          return;
        }

        // For other users:
        let targetUid = selectedUserId;
        let userDocData: UserProfile | null = null;
        let isDocFound = false;

        // 1. Direct UID lookup
        const docRef = doc(db, "users", selectedUserId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          userDocData = docSnap.data() as UserProfile;
          targetUid = docSnap.id;
          isDocFound = true;
        } else {
          // 2. If not found by direct doc ID, check if selectedUserId is a username (e.g., from an @mention or search)
          const cleanUsername = selectedUserId.replace(/^@/, "").trim().toLowerCase();
          if (cleanUsername) {
            try {
              const usersRef = collection(db, "users");
              const userQ = query(usersRef, where("username", "==", cleanUsername), limit(1));
              const querySnap = await getDocs(userQ);
              if (!querySnap.empty) {
                const foundDoc = querySnap.docs[0];
                userDocData = foundDoc.data() as UserProfile;
                targetUid = foundDoc.id;
                isDocFound = true;
              }
            } catch (err) {
              console.warn("[ProfileView] Username lookup notice:", err);
            }
          }
        }

        if (isCancelled) return;

        // Check if user account was deleted, deactivated, or in trash
        const isAccountDeleted = Boolean(
          userDocData && (
            userDocData.isDeleted ||
            (userDocData as any).deleted ||
            (userDocData as any).status === "deleted" ||
            (userDocData as any).inTrash ||
            (userDocData as any).isDeactivated
          )
        );

        if (!isDocFound || !userDocData || isAccountDeleted) {
          setProfile(null);
          setIsUserNotFound(true);
          const rawHandle = selectedUserId.startsWith("@") ? selectedUserId.slice(1) : selectedUserId;
          setNotFoundHandle(userDocData?.username || rawHandle);
          setLoading(false);
          return;
        }

        // Active, valid user found!
        setIsUserNotFound(false);
        setProfile(userDocData);
        setFollowersCount(userDocData.followersCount || 0);
        setFollowingCount(userDocData.followingCount || 0);

        // Fetch follow and block statuses using targetUid
        const followDocRef = doc(db, "users", targetUid, "followers", currentUserId);
        const blockDocRef = doc(db, "users", currentUserId, "blockedUsers", targetUid);
        const blockByThemRef = doc(db, "users", targetUid, "blockedUsers", currentUserId);

        const [followSnap, blockSnap, blockByThemSnap] = await Promise.all([
          getDoc(followDocRef),
          getDoc(blockDocRef),
          getDoc(blockByThemRef)
        ]);

        if (isCancelled) return;
        setIsFollowing(followSnap.exists());
        setIsBlocked(blockSnap.exists());
        setIsBlockedByThem(blockByThemSnap.exists());
        setLoading(false);

        // Reviews for other user
        try {
          const reviewsRef = collection(db, "reviews");
          const q = query(reviewsRef, where("revieweeId", "==", targetUid));
          const querySnapshot = await getDocs(q);
          if (!isCancelled) {
            const loadedReviews: Review[] = [];
            querySnapshot.forEach((d) => {
              loadedReviews.push({ ...(d.data() as Review), id: d.id });
            });
            setReviews(loadedReviews);
          }
        } catch (_) {}
      } catch (err: any) {
        if (!isCancelled) {
          console.error("Error loading profile details:", err);
          setLoadError(err?.message || String(err));
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }
    loadProfileData();
    return () => {
      isCancelled = true;
    };
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

  // Cropped Image Upload logic
  const handleUploadCroppedImage = async (croppedBlob: Blob, type: "profile" | "cover") => {
    if (!croppedBlob) return;
    setUploadError("");

    try {
      // Set upload progress to 5% initially to indicate starting
      setUploadProgress((prev) => ({
        ...prev,
        [type]: 5
      }));

      // Upload via unified production Cloudinary service
      // CRITICAL: When Cloudinary credentials are configured, errors fail fast rather than dumping large Base64 into Firestore
      const downloadUrl = await uploadImageToCloudinary(croppedBlob, {
        type: type === "profile" ? "profile" : "cover",
        fileName: `${type}_photos_${currentUserId}.jpg`,
        folder: "swap_skill_profiles",
        onProgress: (pct) => {
          setUploadProgress((prev) => ({
            ...prev,
            [type]: pct
          }));
        }
      });

      // Update Firestore document
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
      updateProfile(updateData);

      // Update local profile state immediately
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
      console.error("Image upload error:", err);
      setUploadProgress((prev) => {
        const copy = { ...prev };
        delete copy[type];
        return copy;
      });
      setUploadError(`Failed to upload ${type} image: ${err.message || err}`);
      throw err;
    }
  };

  const handleProfilePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith("image/")) {
        setUploadError("Please select a valid image file (JPEG, PNG, WebP).");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setCropModalState({
          isOpen: true,
          imageSrc: reader.result as string,
          cropType: "profile",
          isUploading: false,
        });
      };
      reader.onerror = () => {
        setUploadError("Failed to read the image file. Please try again.");
      };
      reader.readAsDataURL(file);
      e.target.value = ""; // Reset to allow re-selecting same file
    }
  };

  const handleCoverPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith("image/")) {
        setUploadError("Please select a valid image file (JPEG, PNG, WebP).");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setCropModalState({
          isOpen: true,
          imageSrc: reader.result as string,
          cropType: "cover",
          isUploading: false,
        });
      };
      reader.onerror = () => {
        setUploadError("Failed to read the image file. Please try again.");
      };
      reader.readAsDataURL(file);
      e.target.value = ""; // Reset to allow re-selecting same file
    }
  };

  const handleConfirmCrop = async (croppedBlob: Blob) => {
    setCropModalState((prev) => ({ ...prev, isUploading: true }));
    try {
      await handleUploadCroppedImage(croppedBlob, cropModalState.cropType);
      setCropModalState({
        isOpen: false,
        imageSrc: null,
        cropType: "profile",
        isUploading: false,
      });
    } catch (err) {
      setCropModalState((prev) => ({ ...prev, isUploading: false }));
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

  const TEACH_LEVELS: { id: "Beginner" | "Intermediate" | "Advanced" | "Expert"; label: string; badge: string }[] = [
    { id: "Beginner", label: "Beginner", badge: "🌱" },
    { id: "Intermediate", label: "Intermediate", badge: "⚡" },
    { id: "Advanced", label: "Advanced", badge: "🚀" },
    { id: "Expert", label: "Expert", badge: "🏆" }
  ];

  const LEARN_LEVELS: { id: string; label: string; badge: string }[] = [
    { id: "Beginner", label: "Beginner", badge: "🌱" },
    { id: "Intermediate", label: "Intermediate", badge: "⚡" },
    { id: "Advanced", label: "Advanced", badge: "🚀" },
    { id: "Any Level", label: "Any Level", badge: "✦" }
  ];

  const addEditSkillTeach = () => {
    const trimmed = editCurrentSkillTeach.trim();
    if (trimmed && !editSkillsToTeach.includes(trimmed)) {
      setEditSkillsToTeach([...editSkillsToTeach, trimmed]);
      setEditSkillProficiencies((prev) => ({
        ...prev,
        [trimmed]: selectedTeachLevel
      }));
      setEditCurrentSkillTeach("");
    }
  };

  const removeEditSkillTeach = (skill: string) => {
    setEditSkillsToTeach(editSkillsToTeach.filter((s) => s !== skill));
    setEditSkillProficiencies((prev) => {
      const copy = { ...prev };
      delete copy[skill];
      return copy;
    });
  };

  const updateSkillTeachLevel = (skill: string, newLevel: "Beginner" | "Intermediate" | "Advanced" | "Expert") => {
    setEditSkillProficiencies((prev) => ({
      ...prev,
      [skill]: newLevel
    }));
  };

  const addEditSkillLearn = () => {
    const trimmed = editCurrentSkillLearn.trim();
    if (trimmed && !editSkillsToLearn.includes(trimmed)) {
      setEditSkillsToLearn([...editSkillsToLearn, trimmed]);
      setEditLearnSkillLevels((prev) => ({
        ...prev,
        [trimmed]: selectedLearnLevel
      }));
      setEditCurrentSkillLearn("");
    }
  };

  const removeEditSkillLearn = (skill: string) => {
    setEditSkillsToLearn(editSkillsToLearn.filter((s) => s !== skill));
    setEditLearnSkillLevels((prev) => {
      const copy = { ...prev };
      delete copy[skill];
      return copy;
    });
  };

  const updateSkillLearnLevel = (skill: string, newLevel: string) => {
    setEditLearnSkillLevels((prev) => ({
      ...prev,
      [skill]: newLevel
    }));
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

  // Open Block/Unblock Confirmation Modal
  const handleOpenBlockModal = (overrideMode?: "block" | "unblock") => {
    const mode = overrideMode || (isBlocked ? "unblock" : "block");
    setBlockModalMode(mode);
    setShowBlockModal(true);
  };

  // Confirmed Block/Unblock Handler
  const handleConfirmBlockAction = async () => {
    if (!profile || !selectedUserId) return;

    try {
      const blockDocRef = doc(db, "users", currentUserId, "blockedUsers", selectedUserId);
      
      if (blockModalMode === "unblock") {
        await deleteDoc(blockDocRef);
        setIsBlocked(false);
        setShowBlockModal(false);
        setToast({ message: "User unblocked", type: "success" });
      } else {
        await setDoc(blockDocRef, { 
          id: selectedUserId,
          blockedAt: new Date() 
        });
        setIsBlocked(true);
        // Unfollow automatically if blocked
        if (isFollowing) {
          await handleFollowToggle();
        }
        setShowBlockModal(false);
        setToast({ message: "User blocked", type: "success" });
      }
    } catch (err) {
      console.error("Error executing block action:", err);
      setToast({ message: "Action failed. Please try again.", type: "error" });
    }
  };

  // Chat Initiator: Instant navigation with background canonical provisioning
  const handleMessageUser = async () => {
    if (!profile || !selectedUserId || !currentUserId) return;
    setMessageLoading(true);
    setMessageError(null);

    try {
      // 1. Check if users are connected/following each other
      const isConnected = isFollowing || 
        (currentUserProfile?.followingList || []).includes(selectedUserId) ||
        (profile?.followingList || []).includes(currentUserId);

      const requestOptions = isConnected 
        ? { requestStatus: "accepted" as const, isRequest: false }
        : { 
            requestStatus: "pending" as const, 
            requestedBy: currentUserId, 
            requestedTo: selectedUserId, 
            isRequest: true 
          };

      // 2. Check if conversation already exists in memory
      const existing = chats.find(c => {
        const otherId = getOtherParticipantId(c, currentUserId);
        return otherId === selectedUserId;
      });

      if (existing) {
        onOpenChat(existing.id);
        setMessageLoading(false);
        return;
      }

      // 3. Compute canonical chat ID and open chat immediately (<50ms)
      const canonicalId = [currentUserId, selectedUserId].sort().join("_");
      onOpenChat(canonicalId);

      // Background canonical doc sync & initialization with requestOptions
      getOrCreateConversation(currentUserId, selectedUserId, undefined, requestOptions).catch(err => {
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

  // Share Profile
  const handleShareProfile = async () => {
    const targetUserId = selectedUserId || profile?.id || "";
    const inviteUrl = getShareProfileUrl(targetUserId);
    const shareText = `Check out ${profile?.fullName || "this"}'s premium peer learning profile on SwapSkill! Teach, Learn, and Swap crafts.`;

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
        skillsToLearn: editSkillsToLearn,
        skillProficiencies: editSkillProficiencies,
        learnSkillLevels: editLearnSkillLevels
      };

      await updateDoc(userRef, updatedFields);
      updateProfile(updatedFields);

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
      await pushNotificationService.unregisterOrLogout(auth.currentUser?.uid).catch(() => {});
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
    if (loading) {
      return (
        <LoadingTransition isLoading={loading} type="profile">
          <div className="min-h-screen bg-white" />
        </LoadingTransition>
      );
    }

    // Instagram-style "User not found" view when viewing another user who is deleted, in trash, or non-existent
    if (!isMe || isUserNotFound) {
      const displayTitle = notFoundHandle ? `@${notFoundHandle}` : "Profile";

      return (
        <div className="flex flex-col min-h-screen bg-white text-gray-900 font-sans animate-fade-in select-none">
          {/* Instagram-style minimalist top header with real Back button */}
          <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E8E4DB]/70 px-4 h-14 flex items-center justify-between">
            <button
              onClick={() => {
                if (onBack) {
                  onBack();
                } else {
                  onNavigateToTab("home");
                }
              }}
              className="p-2 -ml-2 rounded-full hover:bg-gray-100 transition active:scale-95 text-gray-800 cursor-pointer"
              aria-label="Go back"
              title="Go back"
            >
              <ArrowLeft className="w-5 h-5 text-gray-800" />
            </button>
            <span className="text-sm font-bold text-gray-900 truncate max-w-[200px]">
              {displayTitle}
            </span>
            <div className="w-8" />
          </div>

          {/* Instagram-style Empty State Center Stage */}
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto my-auto">
            {/* Minimalist circular avatar outline with UserX icon */}
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center mb-5 text-gray-400">
              <UserX className="w-10 h-10 stroke-[1.5] text-gray-400" />
            </div>

            <h2 className="text-xl font-bold text-gray-900 tracking-tight mb-2">
              User not found
            </h2>

            <p className="text-xs sm:text-sm text-gray-500 leading-relaxed max-w-xs mb-6">
              The link you followed may be broken, or the account may have been removed.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-xs">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="w-full h-11 px-5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 text-xs font-semibold transition active:scale-95 cursor-pointer shadow-2xs"
                >
                  Go Back
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigateToTab("home")}
                className="w-full h-11 px-5 rounded-xl bg-gray-900 hover:bg-black text-white text-xs font-semibold transition active:scale-95 cursor-pointer shadow-xs"
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Fallback for current user whose profile is not yet completed
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white text-gray-900 p-6 font-sans text-center animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mb-4 text-[#C9A96E]">
          <Sparkles className="w-8 h-8 text-[#C9A96E]" />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Complete Your Profile</h2>
        <p className="text-gray-500 text-xs mt-1 max-w-xs leading-relaxed mb-5">
          Set up your SwapSkill profile to start exchanging skills and connecting with peers.
        </p>
        <button
          onClick={() => onNavigateToTab("home")}
          className="px-6 h-11 bg-gray-900 hover:bg-black text-white rounded-xl text-xs font-semibold transition active:scale-95 cursor-pointer"
        >
          Return Home
        </button>
      </div>
    );
  }

  // Calculate rating average strictly from genuine reviews
  const calculatedAvgRating = reviews.length > 0
    ? parseFloat((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1))
    : ((profile.reviewCount && profile.reviewCount > 0) ? (profile.rating || 0) : 0);
  const avgRating = calculatedAvgRating;
  const completedSessionsCount = profile.sessionsCount || 0;

  if (showSettings) {
    return (
      <Suspense fallback={<SkeletonLoader count={4} />}>
        <SettingsView
          currentUserId={currentUserId}
          onClose={() => setShowSettings(false)}
          onLogOut={handleLogOut}
        />
      </Suspense>
    );
  }

  if (activeSubPage) {
    return (
      <Suspense fallback={<SkeletonLoader count={4} />}>
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
      </Suspense>
    );
  }

  return (
    <div ref={profileContainerRef} className="min-h-full bg-[#F7F4EE] text-[#0D0D0F] font-sans pb-28 relative w-full overflow-x-clip">
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

      {/* Top Banner Cover Image (LinkedIn 4:1 Panoramic Ratio: 1584 × 396) */}
      <div className="w-full md:max-w-4xl md:mx-auto md:px-6 md:pt-4">
        <div
          id="profile-cover-container"
          className={`w-full aspect-[4/1] min-h-[132px] sm:min-h-[168px] relative bg-[#121215] overflow-hidden cursor-pointer transition-all duration-500 md:rounded-3xl md:border md:border-[#E8E4DB] md:shadow-2xs ${
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
            } else if (isMe) {
              coverInputRef.current?.click();
            }
          }}
        >
          {!(profile.coverPhotoUrl || profile.coverUrl) && (
            <div
              className="absolute inset-0 opacity-35 pointer-events-none"
              style={{
                backgroundImage: "radial-gradient(circle at 20% 25%, rgba(201,169,110,0.28), transparent 55%), radial-gradient(circle at 85% 75%, rgba(255,255,255,0.09), transparent 50%)"
              }}
            />
          )}
          <SmartImage
            src={profile.coverPhotoUrl || profile.coverUrl}
            alt="Cover Banner"
            className="w-full h-full animate-fade-in object-cover"
            fallbackType="cover"
            layoutId="cover-photo-fullscreen"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/25 pointer-events-none" />

          {onBack && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              style={{ top: "max(env(safe-area-inset-top, 0px), 12px)" }}
              className="absolute left-3 z-20 w-9 h-9 rounded-full bg-[#0D0D0F]/75 backdrop-blur-md border border-white/15 flex items-center justify-center text-[#F7F4EE] hover:text-[#C9A96E] transition cursor-pointer active:scale-95"
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
              className="absolute bottom-3 right-3 z-20 w-9 h-9 bg-[#FFFFFF]/95 hover:bg-[#FFFFFF] border border-[#E8E4DB] rounded-full text-[#0D0D0F] transition shadow-md flex items-center justify-center cursor-pointer active:scale-95 animate-fade-in"
              title="Edit Cover Banner (1584 × 396)"
              aria-label="Edit Cover Banner"
            >
              <Camera className="w-4 h-4 text-[#0D0D0F]" />
            </button>
          )}

          {/* Upload Cover Progress */}
          {uploadProgress.cover !== undefined && (
            <div className="absolute inset-0 bg-[#0D0D0F]/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 transition">
              <div className="w-56 bg-[#FFFFFF] border border-[#E8E4DB] p-3.5 rounded-2xl text-center shadow-lg">
                <p className="text-[11px] text-[#0D0D0F] font-semibold mb-1.5">
                  Uploading banner ({uploadProgress.cover}%)
                </p>
                <div className="w-full bg-[#F2EFE8] h-1.5 rounded-full overflow-hidden border border-[#E8E4DB]">
                  <div
                    className="bg-[#0D0D0F] h-full transition-all duration-300"
                    style={{ width: `${uploadProgress.cover}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Floating Quick Navigation or Report Badge */}
          <div
            className="absolute right-3 flex gap-2 z-20"
            style={{ top: "max(env(safe-area-inset-top, 0px), 12px)" }}
          >
            <button
              id="profile-share-banner-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleShareProfile();
              }}
              className="w-9 h-9 rounded-full bg-[#0D0D0F]/65 backdrop-blur-md border border-white/15 flex items-center justify-center text-[#F7F4EE] hover:text-[#C9A96E] transition cursor-pointer"
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
                className="w-9 h-9 rounded-full bg-[#0D0D0F]/65 backdrop-blur-md border border-white/15 flex items-center justify-center text-[#F7F4EE] hover:text-[#C9A96E] transition cursor-pointer"
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
                  className="w-9 h-9 rounded-full bg-[#0D0D0F]/65 backdrop-blur-md border border-white/15 flex items-center justify-center text-[#F7F4EE] hover:text-[#C9A96E] transition cursor-pointer"
                  title="Report"
                >
                  <Flag className="w-4 h-4" />
                </button>

                <button
                  id="profile-block-banner-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenBlockModal();
                  }}
                  className={`w-9 h-9 rounded-full backdrop-blur-md border flex items-center justify-center transition cursor-pointer ${
                    isBlocked
                      ? "bg-[#0D0D0F] border-[#1A1A1D] text-[#C9A96E]"
                      : "bg-[#0D0D0F]/65 border-white/15 text-[#F7F4EE] hover:text-[#C9A96E]"
                  }`}
                  title={isBlocked ? "Unblock User" : "Block User"}
                >
                  <Slash className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="px-4 sm:px-6 -mt-8 sm:-mt-10 relative z-10 flex flex-col gap-4 md:max-w-4xl md:mx-auto w-full">
        
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

        {/* Clean Profile Identity Header Card */}
        <section
          ref={profileHeaderRef}
          className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl px-5 pb-5 pt-0 sm:px-6 sm:pb-6 shadow-2xs flex flex-col items-center text-center"
        >
          {/* Avatar Anchor */}
          <div className="relative -mt-12 sm:-mt-14">
            <div 
              id="profile-avatar-container"
              className={`relative rounded-full border-4 border-[#FFFFFF] shadow-md overflow-hidden w-24 h-24 sm:w-28 sm:h-28 cursor-pointer transition-all duration-500 bg-[#F7F4EE] ${
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
                className="absolute bottom-0 right-0 z-20 w-8 h-8 bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#C9A96E] rounded-full transition shadow-md border-2 border-[#FFFFFF] cursor-pointer flex items-center justify-center animate-fade-in"
                title="Edit Profile Photo"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            )}

            {profile.verified && (
              <span className={`absolute bottom-1 ${isMe ? "left-0" : "right-0"} w-6 h-6 rounded-full bg-[#0D0D0F] text-[#C9A96E] text-[10px] font-bold flex items-center justify-center border-2 border-[#FFFFFF] z-20 animate-fade-in`} title="Verified Member">
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              </span>
            )}
          </div>

          {/* Identity Name & Quiet Metadata Strip */}
          <div className="mt-3 flex flex-col items-center max-w-lg w-full">
            <h2 className="text-[21px] sm:text-[23px] font-bold text-[#0D0D0F] tracking-tight flex items-center gap-1.5 justify-center flex-wrap">
              <span>{profile.fullName}</span>
              {profile.verified && <BadgeCheck className="w-5 h-5 text-[#C9A96E] shrink-0" />}
            </h2>

            <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-[#71717A]">
              <span>@{profile.username}</span>
              {(profile.city || profile.country) && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{[profile.city, profile.country].filter(Boolean).join(", ")}</span>
                </>
              )}
              {(profile as any).verificationBadgeLabel && profile.verified && (profile as any).verificationBadgeLabel !== "Verified" && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-[#9A7A42]">
                    {(profile as any).verificationBadgeLabel}
                  </span>
                </>
              )}
            </div>

            {/* Integrated Bio */}
            {profile.bio ? (
              <p className="mt-2.5 text-[13.5px] text-[#52525B] leading-relaxed font-normal max-w-md break-words">
                {formatChatText(profile.bio, (u) => onSelectUser?.(u))}
              </p>
            ) : isMe ? (
              <button
                type="button"
                onClick={handleEditProfileToggle}
                className="mt-2.5 text-[12.5px] text-[#9A7A42] hover:text-[#0D0D0F] font-medium transition cursor-pointer"
              >
                + Add a bio
              </button>
            ) : null}

            {/* Quiet Circular Social Links */}
            {(
              (profile.github && sanitizeExternalLink(profile.github)) ||
              (profile.linkedin && sanitizeExternalLink(profile.linkedin)) ||
              (profile.instagram && sanitizeExternalLink(profile.instagram)) ||
              ((profile.website || profile.portfolio) && sanitizeExternalLink(profile.website || profile.portfolio))
            ) && (
              <div className="flex items-center justify-center gap-2 mt-3">
                {profile.github && sanitizeExternalLink(profile.github) && (
                  <a
                    href={sanitizeExternalLink(profile.github)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="GitHub"
                    aria-label="GitHub"
                    className="w-8 h-8 rounded-full bg-[#F7F4EE] hover:bg-[#EFECE4] border border-[#E8E4DB] text-[#52525B] hover:text-[#0D0D0F] inline-flex items-center justify-center transition"
                  >
                    <Github className="w-3.5 h-3.5" />
                  </a>
                )}
                {profile.linkedin && sanitizeExternalLink(profile.linkedin) && (
                  <a
                    href={sanitizeExternalLink(profile.linkedin)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="LinkedIn"
                    aria-label="LinkedIn"
                    className="w-8 h-8 rounded-full bg-[#F7F4EE] hover:bg-[#EFECE4] border border-[#E8E4DB] text-[#52525B] hover:text-[#0D0D0F] inline-flex items-center justify-center transition"
                  >
                    <Linkedin className="w-3.5 h-3.5" />
                  </a>
                )}
                {profile.instagram && sanitizeExternalLink(profile.instagram) && (
                  <a
                    href={sanitizeExternalLink(profile.instagram)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Instagram"
                    aria-label="Instagram"
                    className="w-8 h-8 rounded-full bg-[#F7F4EE] hover:bg-[#EFECE4] border border-[#E8E4DB] text-[#52525B] hover:text-[#0D0D0F] inline-flex items-center justify-center transition"
                  >
                    <Instagram className="w-3.5 h-3.5" />
                  </a>
                )}
                {(profile.website || profile.portfolio) && sanitizeExternalLink(profile.website || profile.portfolio) && (
                  <a
                    href={sanitizeExternalLink(profile.website || profile.portfolio)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Website"
                    aria-label="Website"
                    className="w-8 h-8 rounded-full bg-[#F7F4EE] hover:bg-[#EFECE4] border border-[#E8E4DB] text-[#52525B] hover:text-[#0D0D0F] inline-flex items-center justify-center transition"
                  >
                    <Globe className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Unboxed Metrics Row */}
          <div className="w-full mt-4 pt-3.5 border-t border-[#F2EFE8] grid grid-cols-4 divide-x divide-[#F2EFE8]">
            <button
              type="button"
              onClick={() => setActiveSubPage("followers")}
              className="flex flex-col items-center text-center cursor-pointer hover:opacity-75 transition px-1"
            >
              <span className="text-[16px] font-bold text-[#0D0D0F] tabular-nums block overflow-hidden">
                <motion.span
                  key={followersCount}
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="inline-block"
                >
                  {followersCount}
                </motion.span>
              </span>
              <span className="text-[11px] text-[#71717A] font-medium mt-0.5">Followers</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubPage("following")}
              className="flex flex-col items-center text-center cursor-pointer hover:opacity-75 transition px-1"
            >
              <span className="text-[16px] font-bold text-[#0D0D0F] tabular-nums block overflow-hidden">
                <motion.span
                  key={followingCount}
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="inline-block"
                >
                  {followingCount}
                </motion.span>
              </span>
              <span className="text-[11px] text-[#71717A] font-medium mt-0.5">Following</span>
            </button>

            <div className="flex flex-col items-center text-center px-1">
              <span className="text-[16px] font-bold text-[#0D0D0F] tabular-nums">
                {completedSessionsCount}
              </span>
              <span className="text-[11px] text-[#71717A] font-medium mt-0.5">Swaps</span>
            </div>

            <button
              type="button"
              onClick={() => reviewsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="flex flex-col items-center text-center cursor-pointer hover:opacity-75 transition px-1"
            >
              <span className="text-[16px] font-bold text-[#0D0D0F] tabular-nums flex items-center gap-1 justify-center">
                {avgRating > 0 ? (
                  <>
                    <span>{avgRating.toFixed(1)}</span>
                    <Star className="w-3.5 h-3.5 fill-[#C9A96E] text-[#C9A96E]" />
                  </>
                ) : (
                  <span className="text-[#71717A] font-semibold text-[13px]">New</span>
                )}
              </span>
              <span className="text-[11px] text-[#71717A] font-medium mt-0.5">Rating</span>
            </button>
          </div>

          {/* Primary Action Controls */}
          <div className="flex gap-2.5 w-full mt-4">
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
                      className="w-full h-11 rounded-xl bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] font-semibold text-[13px] tracking-normal transition active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer shadow-2xs select-none"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-[#F7F4EE]" />
                      <span className="truncate">{isEditing ? "Close Editor" : isProfileComplete ? "Edit Profile" : "Complete Profile"}</span>
                    </button>
                  );
                })()}
                
                <button
                  id="profile-settings-btn"
                  onClick={() => setShowSettings(true)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E2DDD2] bg-[#FFFFFF] hover:bg-[#FAF8F4] text-[#0D0D0F] transition active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 font-semibold text-[13px] tracking-normal shadow-2xs group select-none"
                  title="Settings"
                >
                  <Settings className="w-3.5 h-3.5 text-[#52525B]" />
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
                onClick={() => handleOpenBlockModal("unblock")}
                className="mt-2 px-5 h-10 bg-[#0D0D0F] hover:bg-[#1C1C20] rounded-xl text-[#F7F4EE] text-[13px] font-semibold transition active:scale-[0.98] cursor-pointer"
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
                  className="w-full h-11 rounded-xl border border-[#E2DDD2] bg-[#FFFFFF] hover:bg-[#FAF8F4] text-[#0D0D0F] font-semibold text-[13px] tracking-normal flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer whitespace-nowrap relative disabled:opacity-50 shadow-2xs group select-none"
                >
                  {messageLoading ? (
                    <div className="w-4 h-4 rounded-full border-2 border-[#0D0D0F] border-t-transparent animate-spin" />
                  ) : (
                    <>
                      <MessageSquare className="w-3.5 h-3.5 text-[#52525B]" />
                      <span>Message</span>
                    </>
                  )}
                  {unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-[#0D0D0F] text-[#F7F4EE] text-[10px] font-bold h-5 min-w-5 px-1.5 rounded-full flex items-center justify-center ring-2 ring-[#F7F4EE]">
                      {unreadCount}
                    </span>
                  )}
                </button>
              </div>

              {/* ROW 2: BOOK SWAP BUTTON */}
              <button
                id="profile-schedule-btn"
                onClick={() => setIsScheduling(true)}
                className="w-full h-11 rounded-xl bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] font-semibold text-[13px] tracking-normal flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer whitespace-nowrap shadow-2xs group select-none"
              >
                <CalendarDays className="w-4 h-4 text-[#F7F4EE]" />
                <span>Request Skill Swap</span>
              </button>
            </div>
          )}
        </div>
        </section>

        {/* Share profile alert */}
        {showShareSuccess && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs flex items-center gap-2 animate-fade-in">
            <Check className="w-4 h-4" /> Profile share link copied to clipboard successfully!
          </div>
        )}

        {/* Profile editing form */}
        {isEditing && isMe && (
          <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl overflow-hidden animate-fade-in shadow-2xs">
            {/* Editorial Editor Header */}
            <div className="px-5 py-4 border-b border-[#E8E4DB] bg-[#FAF8F4]/70 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold text-[#0D0D0F] tracking-tight">
                  Edit Profile
                </h3>
                <p className="text-[12px] text-[#71717A] mt-0.5 truncate">
                  Manage your photo, bio, location, and skill exchange
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                aria-label="Close profile editor"
                className="w-9 h-9 rounded-full bg-[#FFFFFF] border border-[#E8E4DB] hover:bg-[#F2EFE8] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-6">
              {/* Section 1: Photos & Media */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[#0D0D0F]">
                    Profile media
                  </span>
                  <span className="text-[11.5px] text-[#71717A]">
                    JPG, PNG up to 5MB
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Profile Photo Tile */}
                  <button
                    id="edit-profile-photo-btn"
                    type="button"
                    onClick={handleTriggerProfileUpload}
                    disabled={uploadProgress.profile !== undefined}
                    className="w-full min-h-[68px] p-3 rounded-xl bg-[#F7F4EE] hover:bg-[#F2EFE8] border border-[#E8E4DB] hover:border-[#D8D2C5] transition flex items-center gap-3 text-left cursor-pointer disabled:opacity-70 group"
                  >
                    <SmartImage
                      src={editPhotoUrl || profile.profilePhotoUrl || profile.photoUrl || DEFAULT_AVATAR}
                      alt="Profile preview"
                      fallbackType="profile"
                      fullName={editFullName || profile.fullName}
                      sizeType="thumbnail"
                      className="w-11 h-11 rounded-full object-cover border border-[#E8E4DB] bg-[#FFFFFF] shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-[#0D0D0F] whitespace-nowrap truncate">
                        Profile photo
                      </span>
                      <span className="block text-[11.5px] text-[#71717A] truncate mt-0.5">
                        {uploadProgress.profile !== undefined
                          ? `Uploading ${uploadProgress.profile}%...`
                          : "Tap to change avatar"}
                      </span>
                    </div>
                    <span className="w-8 h-8 rounded-lg bg-[#FFFFFF] border border-[#E8E4DB] group-hover:border-[#C9A96E] flex items-center justify-center text-[#0D0D0F] shrink-0 transition">
                      {uploadProgress.profile !== undefined ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A96E]" />
                      ) : (
                        <Camera className="w-3.5 h-3.5 text-[#9A7A42]" />
                      )}
                    </span>
                  </button>

                  {/* Cover Photo Tile */}
                  <button
                    id="edit-cover-photo-btn"
                    type="button"
                    onClick={handleTriggerCoverUpload}
                    disabled={uploadProgress.cover !== undefined}
                    className="w-full min-h-[68px] p-3 rounded-xl bg-[#F7F4EE] hover:bg-[#F2EFE8] border border-[#E8E4DB] hover:border-[#D8D2C5] transition flex items-center gap-3 text-left cursor-pointer disabled:opacity-70 group"
                  >
                    <div className="w-20 h-9 rounded-lg overflow-hidden border border-[#E8E4DB] bg-[#121215] shrink-0">
                      {(editCoverUrl || profile.coverPhotoUrl || profile.coverUrl) ? (
                        <SmartImage
                          src={editCoverUrl || profile.coverPhotoUrl || profile.coverUrl}
                          alt="Cover preview"
                          fallbackType="cover"
                          sizeType="thumbnail"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#1C1C20] to-[#121215] flex items-center justify-center">
                          <Camera className="w-3.5 h-3.5 text-[#C9A96E]/70" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-[#0D0D0F] whitespace-nowrap truncate">
                        Cover banner
                      </span>
                      <span className="block text-[11.5px] text-[#71717A] truncate mt-0.5">
                        {uploadProgress.cover !== undefined
                          ? `Uploading ${uploadProgress.cover}%...`
                          : "1584 × 396 · 4:1 banner"}
                      </span>
                    </div>
                    <span className="w-8 h-8 rounded-lg bg-[#FFFFFF] border border-[#E8E4DB] group-hover:border-[#C9A96E] flex items-center justify-center text-[#0D0D0F] shrink-0 transition">
                      {uploadProgress.cover !== undefined ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A96E]" />
                      ) : (
                        <Camera className="w-3.5 h-3.5 text-[#9A7A42]" />
                      )}
                    </span>
                  </button>
                </div>

                {uploadError && (
                  <p className="text-[12px] text-rose-600 font-medium">{uploadError}</p>
                )}
              </div>

              {/* Section 2: Identity & Bio */}
              <div className="pt-5 border-t border-[#F2EFE8] flex flex-col gap-3.5">
                <span className="text-[13px] font-semibold text-[#0D0D0F]">
                  Basic information
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="edit-fullname-input" className="text-[12px] font-medium text-[#52525B]">
                      Display name
                    </label>
                    <input
                      id="edit-fullname-input"
                      type="text"
                      autoComplete="off"
                      placeholder="Your full name"
                      value={editFullName}
                      onChange={(e) => setEditFullName(e.target.value)}
                      className="w-full h-11 px-3.5 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[13px] font-medium text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_#F7F4EE]"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="edit-username-input" className="text-[12px] font-medium text-[#52525B]">
                      Username
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#71717A] text-[13px] font-medium">
                        @
                      </span>
                      <input
                        id="edit-username-input"
                        type="text"
                        autoComplete="off"
                        placeholder="username"
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                        className="w-full h-11 pl-8 pr-3.5 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[13px] font-medium text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_#F7F4EE]"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="edit-bio-input" className="text-[12px] font-medium text-[#52525B]">
                      Bio
                    </label>
                    <span className="text-[11px] text-[#71717A] tabular-nums">
                      {editBio.length} chars
                    </span>
                  </div>
                  <textarea
                    id="edit-bio-input"
                    rows={3}
                    placeholder="Share your background, interests, and what you love teaching..."
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    className="w-full p-3.5 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[13px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition resize-none leading-relaxed"
                  />
                </div>
              </div>

              {/* Section 3: Location, Availability & Languages */}
              <div className="pt-5 border-t border-[#F2EFE8] flex flex-col gap-3.5">
                <span className="text-[13px] font-semibold text-[#0D0D0F]">
                  Location &amp; languages
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <CountryPicker
                    selectedCode={editCountryCode}
                    onChange={(c) => {
                      setEditCountryCode(c.code);
                      setEditCountry(c.name);
                    }}
                    label="Country"
                  />

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="edit-city-input" className="text-[12px] font-medium text-[#52525B]">
                      City
                    </label>
                    <input
                      id="edit-city-input"
                      type="text"
                      autoComplete="off"
                      placeholder="e.g. Mumbai, London, New York"
                      value={editCity}
                      onChange={(e) => setEditCity(e.target.value)}
                      className="w-full h-11 px-3.5 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[13px] font-medium text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_#F7F4EE]"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="edit-availability-input" className="text-[12px] font-medium text-[#52525B]">
                    Availability
                  </label>
                  <input
                    id="edit-availability-input"
                    type="text"
                    autoComplete="off"
                    placeholder="e.g. Weekends, Weekday evenings, Flexible"
                    value={editAvailability}
                    onChange={(e) => setEditAvailability(e.target.value)}
                    className="w-full h-11 px-3.5 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[13px] font-medium text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {["Flexible", "Weekends", "Evenings", "Morning slots"].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setEditAvailability(preset)}
                        className={`px-2.5 py-1 rounded-lg text-[11.5px] font-medium border transition cursor-pointer ${
                          editAvailability === preset
                            ? "bg-[#0D0D0F] text-[#F7F4EE] border-[#0D0D0F]"
                            : "bg-[#F7F4EE] text-[#52525B] border-[#E8E4DB] hover:bg-[#EFECE4] hover:text-[#0D0D0F]"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="edit-languages-input" className="text-[12px] font-medium text-[#52525B]">
                      Languages spoken
                    </label>
                    <button
                      id="edit-browse-languages-btn"
                      type="button"
                      onClick={() => setEditLanguagePickerOpen(true)}
                      className="h-8 px-2.5 rounded-lg bg-[#F7F4EE] border border-[#E8E4DB] hover:bg-[#EFECE4] text-[11.5px] font-semibold text-[#0D0D0F] flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Search className="w-3 h-3 text-[#9A7A42]" />
                      <span>Browse A–Z</span>
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      id="edit-languages-input"
                      type="text"
                      placeholder="Add a language or tap Browse A–Z"
                      value={editCurrentLanguage}
                      onChange={(e) => setEditCurrentLanguage(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEditLanguage())}
                      className="flex-1 h-11 px-3.5 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[13px] font-medium text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                    />
                    <button
                      type="button"
                      onClick={addEditLanguage}
                      aria-label="Add language"
                      className="h-11 px-4 bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] rounded-xl flex items-center justify-center gap-1.5 transition text-[12.5px] font-semibold cursor-pointer shrink-0 active:scale-95"
                    >
                      <Plus className="w-4 h-4 text-[#C9A96E]" />
                      <span>Add</span>
                    </button>
                  </div>
                  {editLanguages.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {editLanguages.map((lang) => (
                        <span
                          key={lang}
                          className="pl-2.5 pr-1.5 py-1 bg-[#F7F4EE] border border-[#E8E4DB] text-[12px] text-[#0D0D0F] font-medium rounded-lg inline-flex items-center gap-1.5"
                        >
                          <span>{lang}</span>
                          <button
                            type="button"
                            onClick={() => removeEditLanguage(lang)}
                            aria-label={`Remove ${lang}`}
                            className="w-4 h-4 rounded hover:bg-[#E8E4DB] text-[#71717A] hover:text-[#0D0D0F] flex items-center justify-center transition cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Section 4: Skills Exchange */}
              <div className="pt-5 border-t border-[#F2EFE8] flex flex-col gap-4">
                <span className="text-[13px] font-semibold text-[#0D0D0F]">
                  Skills exchange
                </span>

                {/* Skills to Teach */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="edit-skills-teach-input" className="text-[12px] font-medium text-[#52525B]">
                      Skills you can teach
                    </label>
                    <span className="text-[11px] text-[#71717A]">Set level &amp; add</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      id="edit-skills-teach-input"
                      type="text"
                      placeholder="e.g. English, Python, Guitar"
                      value={editCurrentSkillTeach}
                      onChange={(e) => setEditCurrentSkillTeach(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEditSkillTeach())}
                      className="w-full sm:flex-1 h-11 px-3.5 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[13px] font-medium text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                    />

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="relative flex-1 sm:w-40">
                        <select
                          id="edit-skill-teach-level-select"
                          value={selectedTeachLevel}
                          onChange={(e) => setSelectedTeachLevel(e.target.value as any)}
                          className="w-full h-11 appearance-none pl-3.5 pr-8 bg-[#F7F4EE] hover:bg-[#F2EFE8] border border-[#E8E4DB] rounded-xl text-[12.5px] font-semibold text-[#0D0D0F] cursor-pointer focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                        >
                          <option value="Beginner">Beginner</option>
                          <option value="Intermediate">Intermediate</option>
                          <option value="Advanced">Advanced</option>
                          <option value="Expert">Expert</option>
                        </select>
                        <ChevronDown className="w-4 h-4 text-[#71717A] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>

                      <button
                        type="button"
                        onClick={addEditSkillTeach}
                        className="h-11 px-4 bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] rounded-xl flex items-center justify-center gap-1.5 transition text-[12.5px] font-semibold cursor-pointer shrink-0 active:scale-95"
                      >
                        <Plus className="w-4 h-4 text-[#C9A96E]" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>

                  {editSkillsToTeach.filter((s) => s && s.trim()).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-0.5">
                      {editSkillsToTeach.filter((s) => s && s.trim()).map((skill) => {
                        const currentLevel = editSkillProficiencies[skill] || "Intermediate";
                        return (
                          <div
                            key={skill}
                            className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl bg-[#FAF8F4] border border-[#E8E4DB] hover:border-[#D8D2C5] transition"
                          >
                            <span className="text-[12.5px] font-semibold text-[#0D0D0F]">{skill}</span>

                            <div className="relative inline-flex items-center">
                              <select
                                value={currentLevel}
                                onChange={(e) => updateSkillTeachLevel(skill, e.target.value as any)}
                                className="appearance-none bg-[#FFFFFF] hover:bg-[#F2EFE8] border border-[#E8E4DB] rounded-lg pl-2 pr-6 py-1 text-[11px] font-semibold text-[#0D0D0F] cursor-pointer focus:outline-none focus:border-[#0D0D0F]"
                                title="Change proficiency level"
                              >
                                <option value="Beginner">Beginner</option>
                                <option value="Intermediate">Intermediate</option>
                                <option value="Advanced">Advanced</option>
                                <option value="Expert">Expert</option>
                              </select>
                              <ChevronDown className="w-3 h-3 text-[#71717A] absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>

                            <button
                              type="button"
                              onClick={() => removeEditSkillTeach(skill)}
                              className="w-6 h-6 rounded-md hover:bg-rose-50 text-[#71717A] hover:text-rose-600 flex items-center justify-center transition cursor-pointer"
                              title="Remove"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Skills to Learn */}
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="edit-skills-learn-input" className="text-[12px] font-medium text-[#52525B]">
                      Skills you want to learn
                    </label>
                    <span className="text-[11px] text-[#71717A]">Target level</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      id="edit-skills-learn-input"
                      type="text"
                      placeholder="e.g. Hindi, Spanish, UI Design"
                      value={editCurrentSkillLearn}
                      onChange={(e) => setEditCurrentSkillLearn(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEditSkillLearn())}
                      className="w-full sm:flex-1 h-11 px-3.5 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[13px] font-medium text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                    />

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="relative flex-1 sm:w-40">
                        <select
                          id="edit-skill-learn-level-select"
                          value={selectedLearnLevel}
                          onChange={(e) => setSelectedLearnLevel(e.target.value)}
                          className="w-full h-11 appearance-none pl-3.5 pr-8 bg-[#F7F4EE] hover:bg-[#F2EFE8] border border-[#E8E4DB] rounded-xl text-[12.5px] font-semibold text-[#0D0D0F] cursor-pointer focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                        >
                          <option value="Beginner">Beginner</option>
                          <option value="Intermediate">Intermediate</option>
                          <option value="Advanced">Advanced</option>
                          <option value="Any Level">Any Level</option>
                        </select>
                        <ChevronDown className="w-4 h-4 text-[#71717A] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>

                      <button
                        type="button"
                        onClick={addEditSkillLearn}
                        className="h-11 px-4 bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] rounded-xl flex items-center justify-center gap-1.5 transition text-[12.5px] font-semibold cursor-pointer shrink-0 active:scale-95"
                      >
                        <Plus className="w-4 h-4 text-[#C9A96E]" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>

                  {editSkillsToLearn.filter((s) => s && s.trim()).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-0.5">
                      {editSkillsToLearn.filter((s) => s && s.trim()).map((skill) => {
                        const currentLevel = editLearnSkillLevels[skill] || "Beginner";
                        return (
                          <div
                            key={skill}
                            className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl bg-[#FAF8F4] border border-[#E8E4DB] hover:border-[#D8D2C5] transition"
                          >
                            <span className="text-[12.5px] font-semibold text-[#0D0D0F]">{skill}</span>

                            <div className="relative inline-flex items-center">
                              <select
                                value={currentLevel}
                                onChange={(e) => updateSkillLearnLevel(skill, e.target.value)}
                                className="appearance-none bg-[#FFFFFF] hover:bg-[#F2EFE8] border border-[#E8E4DB] rounded-lg pl-2 pr-6 py-1 text-[11px] font-semibold text-[#0D0D0F] cursor-pointer focus:outline-none focus:border-[#0D0D0F]"
                                title="Change target level"
                              >
                                <option value="Beginner">Beginner</option>
                                <option value="Intermediate">Intermediate</option>
                                <option value="Advanced">Advanced</option>
                                <option value="Any Level">Any Level</option>
                              </select>
                              <ChevronDown className="w-3 h-3 text-[#71717A] absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>

                            <button
                              type="button"
                              onClick={() => removeEditSkillLearn(skill)}
                              className="w-6 h-6 rounded-md hover:bg-rose-50 text-[#71717A] hover:text-rose-600 flex items-center justify-center transition cursor-pointer"
                              title="Remove"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Section 5: Social & Web Links */}
              <div className="pt-5 border-t border-[#F2EFE8] flex flex-col gap-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[#0D0D0F]">
                    Social &amp; web links
                  </span>
                  <span className="text-[11px] text-[#71717A]">Optional</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="edit-linkedin-input" className="text-[11.5px] font-medium text-[#52525B]">
                      LinkedIn
                    </label>
                    <div className="relative">
                      <Linkedin className="w-3.5 h-3.5 text-[#71717A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="edit-linkedin-input"
                        type="text"
                        placeholder="linkedin.com/in/username"
                        value={editLinkedin}
                        onChange={(e) => setEditLinkedin(e.target.value)}
                        className="w-full h-10 pl-9 pr-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[12.5px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="edit-github-input" className="text-[11.5px] font-medium text-[#52525B]">
                      GitHub
                    </label>
                    <div className="relative">
                      <Github className="w-3.5 h-3.5 text-[#71717A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="edit-github-input"
                        type="text"
                        placeholder="github.com/username"
                        value={editGithub}
                        onChange={(e) => setEditGithub(e.target.value)}
                        className="w-full h-10 pl-9 pr-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[12.5px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="edit-instagram-input" className="text-[11.5px] font-medium text-[#52525B]">
                      Instagram
                    </label>
                    <div className="relative">
                      <Instagram className="w-3.5 h-3.5 text-[#71717A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="edit-instagram-input"
                        type="text"
                        placeholder="instagram.com/username"
                        value={editInstagram}
                        onChange={(e) => setEditInstagram(e.target.value)}
                        className="w-full h-10 pl-9 pr-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[12.5px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="edit-website-input" className="text-[11.5px] font-medium text-[#52525B]">
                      Website
                    </label>
                    <div className="relative">
                      <Globe className="w-3.5 h-3.5 text-[#71717A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="edit-website-input"
                        type="text"
                        placeholder="example.com"
                        value={editWebsite}
                        onChange={(e) => setEditWebsite(e.target.value)}
                        className="w-full h-10 pl-9 pr-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[12.5px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {editError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-[12px] flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              {/* Footer Actions */}
              <div className="pt-4 border-t border-[#E8E4DB] flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={isSavingEdits}
                  onClick={() => setIsEditing(false)}
                  className="h-11 px-5 rounded-xl border border-[#E8E4DB] bg-[#FFFFFF] hover:bg-[#F7F4EE] text-[13px] font-semibold text-[#0D0D0F] transition cursor-pointer disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  id="edit-save-btn"
                  type="button"
                  disabled={isSavingEdits}
                  onClick={handleSaveEdits}
                  className="flex-1 h-11 rounded-xl bg-[#0D0D0F] hover:bg-[#1C1C20] active:scale-[0.98] text-[#F7F4EE] text-[13px] font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 transition select-none"
                >
                  {isSavingEdits ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#C9A96E]" />
                      <span>Saving changes...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-[#C9A96E]" strokeWidth={2.5} />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Conditional Privacy Shield */}
        {(isBlocked || isBlockedByThem) ? (
          <div className="p-8 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl flex flex-col items-center text-center gap-2.5 py-12 animate-fade-in shadow-2xs">
            <ShieldAlert className="w-8 h-8 text-[#71717A]" />
            <h4 className="text-[14px] font-semibold text-[#0D0D0F]">Private Profile Information</h4>
            <p className="text-[12.5px] text-[#71717A] leading-relaxed max-w-xs">
              {isBlocked 
                ? "This member's details are hidden because you have blocked them." 
                : "This profile has restricted details and is currently private."}
            </p>
          </div>
        ) : (() => {
          const teachList = (profile.skillsToTeach || []).filter(Boolean);
          const learnList = (profile.skillsToLearn || []).filter(Boolean);

          const myLearnLower = (currentUserProfile?.skillsToLearn || []).map((s) => s.toLowerCase().trim());
          const myTeachLower = (currentUserProfile?.skillsToTeach || []).map((s) => s.toLowerCase().trim());

          const matchedTeachForMe = !isMe
            ? teachList.filter((s) => myLearnLower.some((m) => m === s.toLowerCase().trim()))
            : [];
          const matchedLearnForThem = !isMe
            ? learnList.filter((s) => myTeachLower.some((m) => m === s.toLowerCase().trim()))
            : [];

          const openSwapWithSkill = (skillName: string) => {
            setSelectedSkill(skillName);
            setBookingStep(2);
            setIsScheduling(true);
          };

          const visibleReviews = showAllReviews ? reviews : reviews.slice(0, 3);

          return (
            <>
              {/* 1. Skill Exchange Card (Clean hairline list, zero inner boxes) */}
              <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl overflow-hidden shadow-2xs">
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#F2EFE8]">
                  {/* Offers to teach */}
                  <div className="p-5 flex flex-col gap-3">
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-[14px] font-semibold text-[#0D0D0F]">Skills taught</h3>
                      <span className="text-[12px] text-[#71717A] tabular-nums">{teachList.length}</span>
                    </div>

                    {teachList.length > 0 ? (
                      <div className="divide-y divide-[#F2EFE8]">
                        {teachList.map((skill) => {
                          const prof = profile.skillProficiencies?.[skill] || "Intermediate";
                          const cred = profile.skillCredentials?.[skill];
                          const segments = prof === "Beginner" ? 1 : prof === "Intermediate" ? 2 : prof === "Advanced" ? 3 : 4;
                          const isDirectMatch = matchedTeachForMe.includes(skill);

                          const RowEl = !isMe ? "button" : "div";
                          return (
                            <RowEl
                              key={skill}
                              {...(!isMe
                                ? {
                                    type: "button" as const,
                                    onClick: () => openSwapWithSkill(skill)
                                  }
                                : {})}
                              className={`w-full text-left py-2.5 first:pt-1 last:pb-0 flex items-center justify-between gap-3 ${
                                !isMe ? "cursor-pointer group hover:opacity-80 transition" : ""
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-[13.5px] font-semibold text-[#0D0D0F] truncate">
                                    {skill}
                                  </span>
                                  {isDirectMatch && (
                                    <span className="text-[11px] font-semibold text-[#9A7A42] shrink-0">
                                      · Match
                                    </span>
                                  )}
                                </div>
                                <div className="text-[12px] text-[#71717A] flex flex-wrap items-center gap-1.5 mt-0.5">
                                  <span>{prof}</span>
                                  {cred && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-[#52525B] truncate">{cred}</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <div className="flex items-center gap-1" title={`${prof} (${segments}/4)`}>
                                  {[1, 2, 3, 4].map((seg) => (
                                    <span
                                      key={`gauge-${skill}-${seg}`}
                                      className={`w-2.5 h-1.5 rounded-full ${
                                        seg <= segments ? "bg-[#0D0D0F]" : "bg-[#E8E4DB]"
                                      }`}
                                    />
                                  ))}
                                </div>
                                {!isMe && (
                                  <ChevronRight className="w-3.5 h-3.5 text-[#A1A1AA] group-hover:text-[#0D0D0F] transition-colors" />
                                )}
                              </div>
                            </RowEl>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="py-3 text-[13px] text-[#71717A]">No teaching skills listed yet.</p>
                    )}
                  </div>

                  {/* Want to learn */}
                  <div className="p-5 flex flex-col gap-3">
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-[14px] font-semibold text-[#0D0D0F]">Want to learn</h3>
                      <span className="text-[12px] text-[#71717A] tabular-nums">{learnList.length}</span>
                    </div>

                    {learnList.length > 0 ? (
                      <div className="divide-y divide-[#F2EFE8]">
                        {learnList.map((skill) => {
                          const targetLevel = (profile as any).learnSkillLevels?.[skill] || "Beginner";
                          const canTeachThem = matchedLearnForThem.includes(skill);

                          return (
                            <div
                              key={skill}
                              className="py-2.5 first:pt-1 last:pb-0 flex items-center justify-between gap-3"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[13.5px] font-semibold text-[#0D0D0F] truncate">
                                  {skill}
                                </span>
                                {canTeachThem && (
                                  <span className="text-[11px] font-semibold text-[#9A7A42] shrink-0">
                                    · You teach
                                  </span>
                                )}
                              </div>
                              <span className="text-[12px] text-[#71717A] shrink-0">
                                {targetLevel}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="py-3 text-[13px] text-[#71717A]">No learning goals listed yet.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 1B. Competitive Skill Battles Record */}
              <ProfileBattleStatsCard
                userId={selectedUserId}
                userName={profile.fullName}
                userPhoto={profile.photoUrl || profile.profilePhotoUrl}
                onOpenBattlesHub={() => onNavigateToTab("battles")}
              />

              {/* 2. Details Card (Clean hairline rows, zero nested boxes) */}
              <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-5 flex flex-col gap-3 shadow-2xs">
                <h3 className="text-[14px] font-semibold text-[#0D0D0F]">Details</h3>
                <div className="divide-y divide-[#F2EFE8]">
                  <div className="flex items-center justify-between text-[13px] py-2.5 first:pt-1">
                    <span className="text-[#71717A] flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-[#9A7A42]" /> Availability
                    </span>
                    <span className="text-[#0D0D0F] font-medium">
                      {profile.availability || "Flexible"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[13px] py-2.5 gap-4">
                    <span className="text-[#71717A] flex items-center gap-2 shrink-0">
                      <Globe className="w-3.5 h-3.5 text-[#9A7A42]" /> Languages
                    </span>
                    <span className="text-[#0D0D0F] font-medium text-right truncate">
                      {profile.languages && profile.languages.length > 0 ? profile.languages.join(", ") : "English"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[13px] py-2.5 last:pb-0">
                    <span className="text-[#71717A] flex items-center gap-2">
                      <CalendarDays className="w-3.5 h-3.5 text-[#9A7A42]" /> Joined
                    </span>
                    <span className="text-[#0D0D0F] font-medium tabular-nums">{getJoinedDateString()}</span>
                  </div>
                </div>
              </div>

              {/* 3. Subtle Verification Prompt (Own unverified profile only) */}
              {isMe && !profile.verified && (
                <div className="px-5 py-4 rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] flex items-center justify-between gap-3.5 shadow-2xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <BadgeCheck className="w-5 h-5 text-[#9A7A42] shrink-0" />
                    <div className="min-w-0">
                      <h4 className="text-[13.5px] font-semibold text-[#0D0D0F] truncate">
                        Get Verified
                      </h4>
                      <p className="text-[12px] text-[#71717A] truncate">
                        Request a verified badge for your profile.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowVerifyModal(true)}
                    className="h-9 px-3.5 rounded-xl bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] text-[12px] font-semibold transition cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    Apply
                  </button>
                </div>
              )}

              {/* 4. Reviews Card (Clean hairline rows, zero nested boxes) */}
              <div
                ref={reviewsSectionRef}
                className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-5 flex flex-col gap-3 shadow-2xs"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[14px] font-semibold text-[#0D0D0F]">Reviews</h3>
                  {reviews.length > 0 && (
                    <span className="text-[12px] text-[#71717A] tabular-nums inline-flex items-center gap-1">
                      <Star className="w-3 h-3 fill-[#C9A96E] text-[#C9A96E]" />
                      <strong className="text-[#0D0D0F] font-semibold">{avgRating.toFixed(1)}</strong>
                      <span>· {reviews.length}</span>
                    </span>
                  )}
                </div>

                {reviews.length === 0 ? (
                  <p className="py-3 text-[13px] text-[#71717A] text-center">No reviews yet.</p>
                ) : (
                  <>
                    <div className="divide-y divide-[#F2EFE8]">
                      {visibleReviews.map((review) => (
                        <div
                          key={review.id}
                          className="py-3 first:pt-1 last:pb-0 flex flex-col gap-1"
                        >
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-[13.5px] font-semibold text-[#0D0D0F] truncate">
                              {review.reviewerName}
                            </span>
                            <div className="flex gap-0.5 shrink-0">
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
                          <p className="text-[13px] text-[#52525B] leading-relaxed font-normal">
                            &ldquo;{review.comment}&rdquo;
                          </p>
                        </div>
                      ))}
                    </div>

                    {reviews.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setShowAllReviews((prev) => !prev)}
                        className="pt-2.5 border-t border-[#F2EFE8] text-[12.5px] font-semibold text-[#0D0D0F] hover:text-[#9A7A42] transition text-center cursor-pointer"
                      >
                        {showAllReviews ? "Show less" : `Show all ${reviews.length} reviews`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          );
        })()}

        {/* Complete profile prompt harmonized with app palette */}
        {isMe && (!profile.bio || !profile.skillsToTeach || profile.skillsToTeach.length === 0 || !profile.skillsToLearn || profile.skillsToLearn.length === 0) && (
          <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] flex items-center justify-between gap-4 shadow-2xs">
            <div className="min-w-0">
              <h4 className="text-[14px] font-semibold text-[#0D0D0F]">Finish setting up your profile</h4>
              <p className="text-[12.5px] text-[#71717A] mt-0.5 leading-relaxed">
                Add your bio and skills so peers can discover you for swaps.
              </p>
            </div>
            <button
              type="button"
              onClick={handleEditProfileToggle}
              className="h-10 px-4 bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] text-[12.5px] font-semibold rounded-xl transition cursor-pointer shrink-0 whitespace-nowrap"
            >
              Complete
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
              
              {/* Modal Header */}
              <div className="flex justify-between items-start pb-3 border-b border-[#E8E4DB] gap-4 shrink-0">
                <div className="flex flex-col gap-0.5">
                  <h3 className="font-bold text-base sm:text-lg text-[#0D0D0F]">
                    Request skill swap
                  </h3>
                  <span className="text-xs text-[#71717A]">Learn one skill, teach one skill in return.</span>
                </div>
                <button
                  id="close-schedule-modal-btn"
                  type="button"
                  onClick={() => {
                    setIsScheduling(false);
                    setBookingStep(1);
                    setSubmittingStage("idle");
                  }}
                  className="text-[#71717A] hover:text-[#0D0D0F] transition p-2 rounded-xl hover:bg-[#F2EFE8] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Step Progress Bar */}
              {!sessionSuccess && (
                <div className="flex flex-col gap-1.5 py-3 shrink-0">
                  <div className="flex items-center justify-between text-[12px] text-[#71717A] tabular-nums">
                    <span>Step {bookingStep} of 6 · <strong className="text-[#0D0D0F] font-semibold">{stepMetadata[bookingStep - 1].title}</strong></span>
                    <span>{Math.round((bookingStep / 6) * 100)}%</span>
                  </div>
                  <div className="grid grid-cols-6 gap-1.5">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          i === bookingStep
                            ? "bg-[#0D0D0F]"
                            : i < bookingStep
                            ? "bg-[#C9A96E]"
                            : "bg-[#E8E4DB]"
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
                <div className="flex flex-col items-center text-center py-8 px-4 gap-5 animate-fade-in overflow-y-auto">
                  <div className="w-16 h-16 rounded-full border border-emerald-200 flex items-center justify-center bg-emerald-50">
                    <Check className="w-7 h-7 text-emerald-700 stroke-[2.5]" />
                  </div>
                  
                  <div className="flex flex-col gap-1.5">
                    <h4 className="font-bold text-[18px] text-[#0D0D0F] tracking-tight">Request Sent</h4>
                    <p className="text-[13.5px] text-[#71717A]">Waiting for your partner to confirm.</p>
                    <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-[#F7F4EE] border border-[#E8E4DB] rounded-full text-[11px] text-[#52525B] self-center">
                      <Clock className="w-3.5 h-3.5 text-[#9A7A42]" />
                      <span>Estimated response: <strong className="text-[#0D0D0F]">Under 10 minutes</strong></span>
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
                    className="w-full h-11 bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] rounded-xl font-semibold text-[13.5px] active:scale-[0.98] transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>View Sessions</span>
                    <ArrowRight className="w-4 h-4 text-[#F7F4EE]" />
                  </button>
                </div>
              ) : fetchingTeachableSkills ? (
                <div className="py-2">
                  <SkeletonLoader type="swap" />
                </div>
              ) : teachableSkills.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-4 bg-[#F7F4EE] border border-[#E8E4DB] rounded-2xl">
                  <div className="w-11 h-11 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <h4 className="text-[14px] font-semibold text-[#0D0D0F]">Booking Unavailable</h4>
                    <p className="text-[12.5px] text-[#71717A] max-w-xs leading-relaxed">
                      This user has not listed any teachable skills yet.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsScheduling(false)}
                    className="h-10 px-5 bg-[#0D0D0F] hover:bg-[#1C1C20] text-[13px] font-semibold rounded-xl text-[#F7F4EE] transition cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); if (bookingStep === 6) handleScheduleSession(e); }} className="flex flex-col flex-1 min-h-0">
                  
                  {/* Scrollable Body Content */}
                  <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-3.5 py-1">
                    {/* Step Description */}
                    <p className="text-[12.5px] text-[#71717A] leading-snug px-3 py-2 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl">
                      {stepMetadata[bookingStep - 1].desc}
                    </p>

                    {/* ACTIVE QUESTION PANEL */}
                    <div className="flex flex-col gap-4">
                    
                    {/* STEP 1: Learn Skill Selection */}
                    {bookingStep === 1 && (
                      <div className="flex flex-col gap-3 animate-fade-in">
                        <div className="relative">
                          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717A]" />
                          <input
                            type="text"
                            placeholder="Search their skills..."
                            value={learnSearch}
                            onChange={(e) => setLearnSearch(e.target.value)}
                            className="w-full h-11 pl-10 pr-4 bg-[#F7F4EE] focus:bg-[#FFFFFF] border border-[#E8E4DB] rounded-xl text-[13.5px] text-[#0D0D0F] placeholder-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F] transition"
                          />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2.5 max-h-48 overflow-y-auto pr-1">
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
                                className={`p-3.5 rounded-xl border text-left flex items-center justify-between transition group cursor-pointer active:scale-[0.98] ${
                                  isSelected
                                    ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE]"
                                    : "border-[#E8E4DB] bg-[#F7F4EE] text-[#0D0D0F] hover:border-[#D8D2C5] hover:bg-[#EFECE4]"
                                }`}
                              >
                                <div className="flex flex-col min-w-0">
                                  <span className="text-[13px] font-semibold truncate">{skill}</span>
                                  <span className={`text-[11px] ${isSelected ? "text-[#F7F4EE]/70" : "text-[#71717A]"}`}>Available</span>
                                </div>
                                {isSelected ? (
                                  <Check className="w-4 h-4 text-[#C9A96E] shrink-0" />
                                ) : (
                                  <ArrowRight className="w-3.5 h-3.5 text-[#71717A] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
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
                          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717A]" />
                          <input
                            type="text"
                            placeholder="Type a skill you can teach them..."
                            value={skillToTeach}
                            onChange={(e) => {
                              setSkillToTeach(e.target.value);
                              setTeachSearch(e.target.value);
                              setSessionError("");
                            }}
                            className="w-full h-11 pl-10 pr-4 bg-[#F7F4EE] focus:bg-[#FFFFFF] border border-[#E8E4DB] rounded-xl text-[13.5px] text-[#0D0D0F] placeholder-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F] transition"
                          />
                        </div>

                        <div className="flex flex-col gap-2">
                          <span className="text-[12px] font-medium text-[#71717A]">Suggestions based on your profile</span>
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
                                  className={`px-3.5 py-2 rounded-xl text-[12.5px] font-semibold border transition active:scale-[0.98] cursor-pointer ${
                                    isSelected
                                      ? "bg-[#0D0D0F] border-[#0D0D0F] text-[#F7F4EE]"
                                      : "bg-[#F7F4EE] border-[#E8E4DB] text-[#0D0D0F] hover:border-[#D8D2C5] hover:bg-[#EFECE4]"
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
                      <div className="grid grid-cols-3 gap-2.5 animate-fade-in">
                        {[
                          { value: 30, label: "30 min", desc: "Quick check-in & exchange" },
                          { value: 60, label: "60 min", desc: "Balanced deep dive" },
                          { value: 90, label: "90 min", desc: "Extended workshop" }
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
                              className={`p-4 rounded-xl border flex flex-col items-center text-center justify-between gap-2 min-h-[104px] transition active:scale-[0.98] cursor-pointer ${
                                isSelected
                                  ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE]"
                                  : "border-[#E8E4DB] bg-[#F7F4EE] text-[#0D0D0F] hover:border-[#D8D2C5] hover:bg-[#EFECE4]"
                              }`}
                            >
                              <span className="text-[14px] font-bold">{dur.label}</span>
                              <span className={`text-[11px] leading-snug ${isSelected ? "text-[#F7F4EE]/75" : "text-[#71717A]"}`}>{dur.desc}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* STEP 4: Protocol selection */}
                    {bookingStep === 4 && (
                      <div className="grid grid-cols-3 gap-2.5 animate-fade-in">
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
                              className={`p-4 rounded-xl border flex flex-col items-center text-center gap-2.5 transition active:scale-[0.98] cursor-pointer ${
                                isSelected
                                  ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE]"
                                  : "border-[#E8E4DB] bg-[#F7F4EE] text-[#0D0D0F] hover:border-[#D8D2C5] hover:bg-[#EFECE4]"
                              }`}
                            >
                              <IconComponent className={`w-5 h-5 ${isSelected ? "text-[#C9A96E]" : "text-[#52525B]"}`} />
                              <span className="text-[12.5px] font-semibold">{item.label}</span>
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
                            <label className="text-[12px] font-semibold text-[#0D0D0F] flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-[#9A7A42]" /> Select date
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
                                    if (item.date === todayStr && isPastTimeSlot(item.date, curTimeStr, now)) {
                                      const nextSlot = timePresets.find(p => !isPastTimeSlot(item.date, p.value, now));
                                      const fallbackTime = nextSlot ? nextSlot.value : getLocalTimeString(new Date(now.getTime() + 30 * 60 * 1000));
                                      updateDateTime(item.date, fallbackTime);
                                    } else {
                                      updateDateTime(item.date, curTimeStr);
                                    }
                                  }}
                                  className={`h-9 px-3 rounded-xl border text-[12.5px] font-semibold transition active:scale-[0.98] cursor-pointer ${
                                    curDateStr === item.date
                                      ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE]"
                                      : "border-[#E8E4DB] bg-[#F7F4EE] text-[#0D0D0F] hover:bg-[#EFECE4]"
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
                              className="w-full h-11 px-3.5 bg-[#F7F4EE] focus:bg-[#FFFFFF] border border-[#E8E4DB] rounded-xl text-[13px] text-[#0D0D0F] focus:outline-none focus:border-[#0D0D0F] font-medium"
                              required
                            />
                          </div>

                          {/* Quick Time Presets & Custom Time Picker */}
                          <div className="flex flex-col gap-2">
                            <label className="text-[12px] font-semibold text-[#0D0D0F] flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-[#9A7A42]" /> Select time
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
                                    className={`h-9 px-2 rounded-xl border text-[12px] font-semibold transition tabular-nums ${
                                      isPast
                                        ? "opacity-40 bg-[#EFECE4] border-[#E8E4DB] text-[#A1A1AA] cursor-not-allowed line-through"
                                        : isSelected
                                        ? "border-[#0D0D0F] bg-[#0D0D0F] text-[#F7F4EE] cursor-pointer"
                                        : "border-[#E8E4DB] bg-[#F7F4EE] text-[#0D0D0F] hover:bg-[#EFECE4] cursor-pointer"
                                    }`}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>

                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[12px] text-[#71717A] shrink-0 font-medium">Custom time:</span>
                              <input
                                type="time"
                                value={curTimeStr}
                                min={isSelectedDateToday ? getLocalTimeString(now) : undefined}
                                onChange={(e) => updateDateTime(curDateStr, e.target.value)}
                                className={`flex-1 h-10 px-3 bg-[#F7F4EE] focus:bg-[#FFFFFF] border rounded-xl text-[13px] text-[#0D0D0F] focus:outline-none font-medium transition ${
                                  isCurrentChoicePast ? "border-amber-400 bg-amber-50/40 focus:border-amber-500" : "border-[#E8E4DB] focus:border-[#0D0D0F]"
                                }`}
                                required
                              />
                            </div>

                            {isCurrentChoicePast && (
                              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs text-amber-800 animate-fade-in">
                                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                                <span>Please select a future time.</span>
                              </div>
                            )}
                          </div>

                          {selectedDateObject && !isCurrentChoicePast && (
                            <div className="p-3.5 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl flex flex-col gap-1.5 text-xs">
                              <div className="flex justify-between items-center">
                                <span className="text-[#71717A] font-medium">Scheduled slot</span>
                                <span className="font-semibold text-[#0D0D0F] tabular-nums">
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
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* STEP 6: Optional goals note */}
                    {bookingStep === 6 && (
                      <div className="flex flex-col gap-3 animate-fade-in">
                        <div className="flex justify-between items-center">
                          <span className="text-[12px] font-medium text-[#71717A]">Quick topics</span>
                          <span className="text-[11.5px] font-mono text-[#71717A] tabular-nums">
                            {sessionNotes.length}/200
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
                              className="px-3 py-1.5 bg-[#F7F4EE] hover:bg-[#EFECE4] border border-[#E8E4DB] text-[12px] font-medium rounded-xl text-[#0D0D0F] transition cursor-pointer"
                            >
                              {note}
                            </button>
                          ))}
                        </div>

                        <textarea
                          value={sessionNotes}
                          onChange={(e) => setSessionNotes(e.target.value.substring(0, 200))}
                          placeholder="Specify what you want to learn or any topics you wish to cover..."
                          className="w-full h-24 p-3.5 bg-[#F7F4EE] focus:bg-[#FFFFFF] border border-[#E8E4DB] rounded-xl text-[13px] text-[#0D0D0F] placeholder-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F] transition resize-none leading-relaxed"
                          maxLength={200}
                        />
                      </div>
                    )}

                  </div>
                  </div>

                  {/* BOTTOM NAVIGATION ACTIONS */}
                  <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-[#E8E4DB] shrink-0 bg-[#FFFFFF] z-10">
                    {bookingStep > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSessionError("");
                          setBookingStep(prev => prev - 1);
                        }}
                        className="h-11 px-4 bg-[#FFFFFF] hover:bg-[#FAF8F4] border border-[#E2DDD2] text-[#0D0D0F] rounded-xl flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer font-semibold text-[13px] shrink-0"
                      >
                        <ChevronLeft className="w-4 h-4 text-[#52525B]" />
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
                        className="flex-1 h-11 bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] rounded-xl flex items-center justify-center gap-1.5 transition font-semibold text-[13px] active:scale-[0.98] cursor-pointer"
                      >
                        <span>Continue</span>
                        <ChevronRight className="w-4 h-4 text-[#F7F4EE]" />
                      </button>
                    ) : (
                      <button
                        id="schedule-submit-btn"
                        type="button"
                        onClick={(e) => handleScheduleSession(e)}
                        disabled={sessionLoading}
                        className="flex-1 h-11 bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] rounded-xl flex items-center justify-center gap-2 transition font-semibold text-[13px] active:scale-[0.98] cursor-pointer disabled:opacity-50"
                      >
                        {submittingStage === "idle" && (
                          <span>Send Swap Request</span>
                        )}
                        {submittingStage === "matching" && (
                          <div className="flex items-center gap-2">
                            <span className="w-4 h-4 border-2 border-[#F7F4EE] border-t-transparent rounded-full animate-spin"></span>
                            <span>Checking availability...</span>
                          </div>
                        )}
                        {submittingStage === "sending" && (
                          <div className="flex items-center gap-2">
                            <span className="w-4 h-4 border-2 border-[#F7F4EE] border-t-transparent rounded-full animate-spin"></span>
                            <span>Sending request...</span>
                          </div>
                        )}
                        {submittingStage === "done" && (
                          <div className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-[#C9A96E]" />
                            <span>Request Sent</span>
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
        <div className="fixed inset-0 z-50 bg-[#0D0D0F]/50 backdrop-blur-xs flex items-center justify-center p-4 font-sans">
          <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4 animate-scale-up shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#E8E4DB] pb-3">
              <h3 className="font-bold text-[15.5px] text-rose-600 flex items-center gap-1.5">
                <Flag className="w-4 h-4" /> Report Misconduct
              </h3>
              <button
                type="button"
                onClick={() => setShowReportDialog(false)}
                className="w-8 h-8 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] text-[#52525B] hover:text-[#0D0D0F] flex items-center justify-center transition cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {reportSuccess ? (
              <div className="flex flex-col items-center text-center py-6 gap-3 animate-fade-in">
                <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                  <Check className="w-6 h-6" />
                </div>
                <h4 className="font-semibold text-[15px] text-[#0D0D0F]">Report Received</h4>
                <p className="text-[12.5px] text-[#71717A] leading-relaxed">
                  The moderation team has been notified. Thank you for helping keep SwapSkill safe.
                </p>
              </div>
            ) : (
              <form onSubmit={handleReportUser} className="flex flex-col gap-4">
                <p className="text-[12.5px] text-[#71717A] leading-relaxed">
                  Describe the violation or abusive behavior. Verified reports are reviewed within 24 hours.
                </p>
                <textarea
                  id="report-reason-input"
                  rows={4}
                  required
                  placeholder="Provide details of the incident..."
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full p-3.5 bg-[#F7F4EE] focus:bg-[#FFFFFF] border border-[#E8E4DB] rounded-xl text-[13px] text-[#0D0D0F] placeholder-[#A1A1AA] focus:outline-none focus:border-[#0D0D0F] resize-none leading-relaxed"
                />
                <button
                  type="submit"
                  disabled={reportLoading || !reportReason.trim()}
                  className="w-full h-11 bg-rose-600 hover:bg-rose-700 rounded-xl font-semibold text-[13px] text-white transition active:scale-[0.98] disabled:opacity-55 cursor-pointer"
                >
                  {reportLoading ? "Submitting..." : "Submit Report"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Encrypted Verification Application Modal (Admin-reviewed only) */}
      {isMe && profile && (
        <GetVerifiedModal
          isOpen={showVerifyModal}
          profile={profile}
          onClose={() => setShowVerifyModal(false)}
        />
      )}

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
          <div className="fixed inset-0 z-50 bg-[#0D0D0F]/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 font-sans">
            <motion.div 
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-[#FFFFFF] border-t sm:border border-[#E8E4DB] rounded-t-3xl sm:rounded-2xl p-6 pb-7 sm:pb-6 w-full sm:max-w-[360px] flex flex-col gap-4 shadow-2xl"
            >
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 rounded-full overflow-hidden border border-[#E8E4DB] bg-[#F2EFE8]">
                  <SmartImage
                    src={profile.profilePhotoUrl || profile.photoUrl}
                    alt={profile.fullName || "User"}
                    fallbackType="profile"
                    fullName={profile.fullName}
                    className="w-full h-full"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="font-bold text-[15.5px] text-[#0D0D0F]">Remove connection with @{profile.username}?</h3>
                  <p className="text-[#71717A] text-[12.5px] leading-relaxed">
                    Are you sure you want to disconnect from {profile.fullName}?
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 mt-1">
                <button
                  type="button"
                  onClick={() => setShowUnfollowConfirm(false)}
                  className="flex-1 h-11 bg-[#FFFFFF] border border-[#E2DDD2] hover:bg-[#FAF8F4] text-[#0D0D0F] rounded-xl text-[13px] font-semibold transition active:scale-[0.98] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUnfollowConfirm(false);
                    handleFollowToggle(); // Trigger actual unfollow
                  }}
                  className="flex-1 h-11 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-[13px] transition active:scale-[0.98] cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSaveSuccessToast && (
          <motion.div
            initial={{ y: -14, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -10, opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-[max(env(safe-area-inset-top,0px)+14px,16px)] inset-x-0 mx-auto w-fit max-w-[calc(100vw-2rem)] z-[99995] bg-[#141417]/95 border border-white/12 text-[#F5F5F7] backdrop-blur-xl px-3.5 py-2 rounded-full shadow-[0_12px_32px_-8px_rgba(0,0,0,0.55)] flex items-center gap-2 pointer-events-none select-none"
          >
            <div className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <Check className="w-2.5 h-2.5 stroke-[2.75]" />
            </div>
            <span className="text-[12.5px] font-medium tracking-[-0.01em] text-[#F5F5F7] whitespace-nowrap">
              Profile updated
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

      {/* Block / Unblock User Confirmation Modal */}
      <BlockUserConfirmModal
        isOpen={showBlockModal}
        mode={blockModalMode}
        targetUser={{
          uid: selectedUserId,
          username: profile?.username,
          fullName: profile?.fullName,
          photoUrl: profile?.photoUrl || profile?.profilePhotoUrl
        }}
        onConfirm={handleConfirmBlockAction}
        onClose={() => setShowBlockModal(false)}
      />

      {/* Image Cropper Modal for Profile Avatar and Cover Banner */}
      <ImageCropModal
        isOpen={cropModalState.isOpen}
        imageSrc={cropModalState.imageSrc}
        cropType={cropModalState.cropType}
        isProcessing={cropModalState.isUploading}
        onClose={() => {
          if (!cropModalState.isUploading) {
            setCropModalState({
              isOpen: false,
              imageSrc: null,
              cropType: "profile",
              isUploading: false,
            });
          }
        }}
        onConfirm={handleConfirmCrop}
      />

      {/* A-Z Searchable Language Picker Modal */}
      <SearchablePickerModal
        isOpen={editLanguagePickerOpen}
        onClose={() => setEditLanguagePickerOpen(false)}
        title="Select Languages Spoken"
        searchPlaceholder="Search language A–Z (e.g. Hindi, English, Spanish)..."
        options={WORLD_LANGUAGES.map((l) => ({ value: l, label: l }))}
        selectedValues={editLanguages}
        multiSelect
        onToggleMulti={(lang) => {
          setEditLanguages((prev) => {
            const exists = prev.some((l) => l.toLowerCase() === lang.toLowerCase());
            if (exists) {
              return prev.filter((l) => l.toLowerCase() !== lang.toLowerCase());
            }
            return [...prev, lang];
          });
        }}
      />
    </div>
  );
}
