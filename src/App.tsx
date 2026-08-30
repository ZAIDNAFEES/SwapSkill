import React, { useState, useEffect, useMemo, Suspense } from "react";
import { doc, getDoc, getDocFromCache, setDoc, updateDoc, serverTimestamp, collection, query, where, onSnapshot } from "firebase/firestore";
import { db, auth } from "./firebase";
import { useSecurityTracker } from "./hooks/useSecurityTracker";
import { useApp } from "./context/AppContext";
import logoImg from "./assets/logo.jpg";
import { Home, Search, MessageSquare, Calendar, User, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Components & Loaders
import SplashScreen from "./components/SplashScreen";
import Onboarding from "./components/Onboarding";
import AuthScreen from "./components/AuthScreen";
import Navigation, { TabType } from "./components/Navigation";
import SkeletonLoader from "./components/SkeletonLoader";
import { LogoutConfirmSheet, DeleteAccountConfirmSheet } from "./components/PremiumConfirmSheets";
import SmartImage from "./components/SmartImage";
import { safeLocalStorage } from "./utils/safeStorage";
import { DEFAULT_AVATAR } from "./types";
import { 
  syncAndScheduleSessionAlarms, 
  ActiveAlarmState, 
  requestAlarmNotificationPermission,
  registerServiceWorker,
  formatSessionCountdown 
} from "./services/sessionReminderService";
import { 
  SessionAlarmReminderModal, 
  NotificationPermissionExplainModal, 
  GlobalStartingSoonBanner 
} from "./components/SessionReminderToast";
import { mobileLifecycleService } from "./services/mobile/lifecycle";
import { mobileNetworkService } from "./services/mobile/network";
import { mobileDeepLinkService } from "./services/mobile/deepLinks";
import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Capacitor } from "@capacitor/core";

// Lazy-loaded Views for splitting and fast initial page load
const HomeView = React.lazy(() => import("./components/HomeView"));
const SearchView = React.lazy(() => import("./components/SearchView"));
const MessagesView = React.lazy(() => import("./components/MessagesView"));
const SessionsView = React.lazy(() => import("./components/SessionsView"));
const ProfileView = React.lazy(() => import("./components/ProfileView"));
const ProfileSetup = React.lazy(() => import("./components/ProfileSetup"));

// Background preloader for lazy-loaded views to ensure instant switches
const preloadViews = () => {
  try {
    import("./components/HomeView");
    import("./components/SearchView");
    import("./components/MessagesView");
    import("./components/SessionsView");
    import("./components/ProfileView");
  } catch (e) {
    console.warn("Preloading chunks failed silently", e);
  }
};

export default function App() {
  const {
    firebaseUser,
    currentUserProfile,
    loadingAuth,
    isOnline,
    chats,
    sessions,
    setProfileInCache,
    showLogoutConfirm,
    setShowLogoutConfirm,
    showDeleteConfirm,
    setShowDeleteConfirm
  } = useApp();

  // App lifecycle states
  const [isSplashFinished, setIsSplashFinished] = useState(false);
  const [isOnboardingFinished, setIsOnboardingFinished] = useState(() => {
    return safeLocalStorage.getItem("swap_onboarding_finished") === "true";
  });
  
  const [userProfileExists, setUserProfileExists] = useState<boolean | null>(null);
  const [loadingProfileCheck, setLoadingProfileCheck] = useState(false);

  // Platform navigation
  const [currentTab, setCurrentTab] = useState<TabType>("home");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Invoke the background chunk preloader on mount
  useEffect(() => {
    preloadViews();
  }, []);

  // Invoke the security and device tracking engine
  useSecurityTracker(firebaseUser);

  // 1. Check if user document exists in Firestore on authentication
  useEffect(() => {
    if (!firebaseUser) {
      setUserProfileExists(null);
      return;
    }

    // If cache already has profile, we can verify if it's complete
    if (currentUserProfile) {
      const hasFullName = !!currentUserProfile.fullName?.trim();
      const hasUsername = !!currentUserProfile.username?.trim();
      const hasCity = !!currentUserProfile.city?.trim();
      const hasCountry = !!currentUserProfile.country?.trim() && currentUserProfile.country !== "Location not added";
      const hasTeachingSkills = Array.isArray(currentUserProfile.skillsToTeach) && currentUserProfile.skillsToTeach.length > 0;
      const hasLearningSkills = Array.isArray(currentUserProfile.skillsToLearn) && currentUserProfile.skillsToLearn.length > 0;
      
      const isComplete = hasFullName && hasUsername && hasCity && hasCountry && hasTeachingSkills && hasLearningSkills;
      setUserProfileExists(isComplete);
      return;
    }

    async function checkProfile() {
      setLoadingProfileCheck(true);
      let timerId: any = null;
      try {
        const userDocRef = doc(db, "users", firebaseUser.uid);
        
        // Try reading from cache first for fast load
        try {
          const cachedSnap = await getDocFromCache(userDocRef);
          if (cachedSnap.exists()) {
            const profileData = cachedSnap.data() as any;
            setProfileInCache(profileData);
            const hasFullName = !!profileData.fullName?.trim();
            const hasUsername = !!profileData.username?.trim();
            const hasCity = !!profileData.city?.trim();
            const hasCountry = !!profileData.country?.trim() && profileData.country !== "Location not added";
            const hasTeachingSkills = Array.isArray(profileData.skillsToTeach) && profileData.skillsToTeach.length > 0;
            const hasLearningSkills = Array.isArray(profileData.skillsToLearn) && profileData.skillsToLearn.length > 0;
            const isComplete = hasFullName && hasUsername && hasCity && hasCountry && hasTeachingSkills && hasLearningSkills;
            setUserProfileExists(isComplete);
          }
        } catch (_) {
          // Cache miss, proceed to server
        }

        const timeoutPromise = new Promise<null>((_, reject) => {
          timerId = setTimeout(() => reject(new Error("Timeout")), 10000);
        });

        const docSnap = await Promise.race([
          getDoc(userDocRef),
          timeoutPromise
        ]) as any;
        
        if (docSnap && docSnap.exists()) {
          const profileData = docSnap.data() as any;
          setProfileInCache(profileData);
          
          // Check if profile is complete
          const hasFullName = !!profileData.fullName?.trim();
          const hasUsername = !!profileData.username?.trim();
          const hasCity = !!profileData.city?.trim();
          const hasCountry = !!profileData.country?.trim() && profileData.country !== "Location not added";
          const hasTeachingSkills = Array.isArray(profileData.skillsToTeach) && profileData.skillsToTeach.length > 0;
          const hasLearningSkills = Array.isArray(profileData.skillsToLearn) && profileData.skillsToLearn.length > 0;
          
          const isComplete = hasFullName && hasUsername && hasCity && hasCountry && hasTeachingSkills && hasLearningSkills;
          setUserProfileExists(isComplete);
        } else {
          // Document does not exist or timed out
          setUserProfileExists(false);
        }
      } catch (err: any) {
        if (err?.message === "Timeout") {
          console.warn("[App Profile Check] Profile check timed out, continuing with default state.");
        } else {
          console.error("Error checking Firestore profile:", err);
        }
        // Fallback to false so they can fill out ProfileSetup
        setUserProfileExists(false);
      } finally {
        if (timerId) clearTimeout(timerId);
        setLoadingProfileCheck(false);
      }
    }
    
    checkProfile();
  }, [firebaseUser, currentUserProfile, setProfileInCache]);

  // 2. Compute Badges from Cached Lists - ZERO extra Firestore listeners
  const unreadMessages = useMemo(() => {
    if (!firebaseUser) return 0;
    let unread = 0;
    chats.forEach((chat) => {
      if (chat.unreadCount && chat.unreadCount[firebaseUser.uid] > 0) {
        unread += chat.unreadCount[firebaseUser.uid];
      }
    });
    return unread;
  }, [chats, firebaseUser]);

  // Session Alarm & Starting Soon Notification State
  const [activeAlarm, setActiveAlarm] = useState<ActiveAlarmState | null>(null);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [dismissedTopBanners, setDismissedTopBanners] = useState<Record<string, boolean>>({});

  // Register background ServiceWorker and native mobile lifecycle on startup
  useEffect(() => {
    registerServiceWorker().catch(() => {});

    // Initialize mobile core services
    mobileLifecycleService.init();
    mobileNetworkService.init().catch(() => {});

    // Initialize native deep link and notification tap routing
    mobileDeepLinkService.init((route) => {
      console.log("[App] Deep link received:", route);
      if (route.type === "live_call" || route.type === "session") {
        setSelectedUserId(null);
        setCurrentTab("sessions");
      }
    });

    // Native Mobile Hardware Back Button Handling & Status Bar styling
    if (Capacitor.isNativePlatform()) {
      try {
        StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
        StatusBar.setBackgroundColor({ color: "#000000" }).catch(() => {});
      } catch {}

      const backListener = CapApp.addListener("backButton", ({ canGoBack }) => {
        if (activeAlarm) {
          setActiveAlarm(null);
        } else if (showLogoutConfirm) {
          setShowLogoutConfirm(false);
        } else if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else if (selectedUserId) {
          setSelectedUserId(null);
        } else if (currentTab !== "home") {
          setCurrentTab("home");
        } else if (canGoBack) {
          window.history.back();
        } else {
          CapApp.exitApp();
        }
      });

      return () => {
        backListener.then((sub) => sub.remove()).catch(() => {});
      };
    }

    // Listen for Service Worker background message actions
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === "NAVIGATE_LIVE_SESSION" || event.data?.type === "NAVIGATE_SESSION") {
          setSelectedUserId(null);
          setCurrentTab("sessions");
        }
      };
      navigator.serviceWorker.addEventListener("message", handleMessage);
      return () => {
        navigator.serviceWorker.removeEventListener("message", handleMessage);
      };
    }
  }, [activeAlarm, showLogoutConfirm, showDeleteConfirm, selectedUserId, currentTab, setShowLogoutConfirm, setShowDeleteConfirm]);

  // Sessions badge: Pending requests needing attention + Sessions starting soon / Live now
  const pendingSessions = useMemo(() => {
    if (!firebaseUser) return 0;
    const now = Date.now();

    // 1. Pending incoming requests where user is teacher/receiver
    const incomingRequests = sessions.filter(
      (s) => (s.teacherId === firebaseUser.uid || s.receiverId === firebaseUser.uid) &&
             s.senderId !== firebaseUser.uid &&
             (s.status === "requested" || s.status === "pending" || s.status === "Pending")
    ).length;

    // 2. Upcoming sessions starting soon (<= 15 min) or Live Now
    const startingSoonOrLive = sessions.filter((s) => {
      const isParticipant = s.teacherId === firebaseUser.uid || s.learnerId === firebaseUser.uid || s.studentId === firebaseUser.uid;
      if (!isParticipant) return false;
      const sStatus = (s.status || "").toLowerCase();
      if (s.sessionEnded || s.isEnded || s.meetingEnded || sStatus === "completed" || sStatus === "cancelled" || sStatus === "deleted" || s.deletedAt) return false;
      if (sStatus !== "accepted" && sStatus !== "upcoming" && sStatus !== "confirmed") return false;

      if (s.isLive || (Array.isArray(s.liveParticipants) && s.liveParticipants.length > 0)) return true;

      const schedMs = s.scheduledTime?.seconds ? s.scheduledTime.seconds * 1000 : new Date(s.scheduledTime).getTime();
      if (isNaN(schedMs)) return false;
      const diffMins = (schedMs - now) / 60000;
      const duration = s.duration || 60;
      return diffMins <= 15 && diffMins >= -duration;
    }).length;

    return incomingRequests + startingSoonOrLive;
  }, [sessions, firebaseUser]);

  // Find active starting soon or live session for global top banner
  const activeStartingSoonSession = useMemo(() => {
    if (!firebaseUser) return null;
    const now = Date.now();

    return sessions.find((s) => {
      if (dismissedTopBanners[s.id]) return false;
      const isParticipant = s.teacherId === firebaseUser.uid || s.learnerId === firebaseUser.uid || s.studentId === firebaseUser.uid;
      if (!isParticipant) return false;
      const sStatus = (s.status || "").toLowerCase();
      if (s.sessionEnded || s.isEnded || s.meetingEnded || sStatus === "completed" || sStatus === "cancelled" || sStatus === "deleted" || s.deletedAt) return false;
      if (sStatus !== "accepted" && sStatus !== "upcoming" && sStatus !== "confirmed") return false;

      const schedMs = s.scheduledTime?.seconds ? s.scheduledTime.seconds * 1000 : new Date(s.scheduledTime).getTime();
      if (isNaN(schedMs)) return false;
      const diffMins = (schedMs - now) / 60000;
      const duration = s.duration || 60;
      return (diffMins <= 15 && diffMins >= -duration) || s.isLive;
    }) || null;
  }, [sessions, firebaseUser, dismissedTopBanners]);

  // Automatic 10-Minute Alarm Synchronization Engine
  useEffect(() => {
    if (!firebaseUser || !sessions.length) return;

    // Check if user has upcoming confirmed sessions
    const hasUpcoming = sessions.some((s) => {
      const st = (s.status || "").toLowerCase();
      const isParticipant = s.teacherId === firebaseUser.uid || s.learnerId === firebaseUser.uid || s.studentId === firebaseUser.uid;
      return isParticipant && (st === "accepted" || st === "upcoming" || st === "confirmed") && !s.sessionEnded && !s.isEnded;
    });

    // Check notification permission if we have upcoming sessions
    if (hasUpcoming && typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default" && !safeLocalStorage.getItem("swap_notif_prompted")) {
        setShowPermissionPrompt(true);
      }
    }

    // Sync and schedule local alarms (exactly 10 min before start or immediate fallback)
    const runAlarmSync = () => {
      syncAndScheduleSessionAlarms(sessions, firebaseUser.uid, (alarm) => {
        setActiveAlarm(alarm);
      });
    };

    runAlarmSync();
    const interval = setInterval(runAlarmSync, 10000);
    return () => clearInterval(interval);
  }, [sessions, firebaseUser]);

  const handleFinishSplash = () => {
    setIsSplashFinished(true);
  };

  const handleFinishOnboarding = () => {
    safeLocalStorage.setItem("swap_onboarding_finished", "true");
    setIsOnboardingFinished(true);
  };

  const handleProfileSetupComplete = () => {
    setUserProfileExists(true);
    setCurrentTab("home");
  };

  const handleSelectUser = (browsingUserId: string) => {
    setSelectedUserId(browsingUserId);
  };

  const handleOpenChatRoom = (chatId: string) => {
    setActiveChatId(chatId);
    setSelectedUserId(null); // Close active profile browsing
    setCurrentTab("messages");
  };

  // Render main routing flow
  const renderFlow = () => {
    if (!isSplashFinished) {
      return <SplashScreen onFinish={handleFinishSplash} />;
    }
    
    if (!isOnboardingFinished) {
      return <Onboarding onFinish={handleFinishOnboarding} />;
    }

    if (loadingAuth || (loadingProfileCheck && !currentUserProfile)) {
      return (
        <div className="flex flex-col h-full bg-white animate-pulse">
          {/* Custom Header Skeleton */}
          <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-white">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gray-100" />
              <div className="h-4 w-20 bg-gray-100 rounded" />
            </div>
            <div className="w-9 h-9 rounded-xl bg-gray-100" />
          </div>
          {/* Custom Feed Skeleton */}
          <div className="flex-1 p-6 flex flex-col gap-6 overflow-hidden bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-200" />
              <div className="flex flex-col gap-2">
                <div className="h-3 w-28 bg-gray-200 rounded" />
                <div className="h-2 w-16 bg-gray-200 rounded" />
              </div>
            </div>
            <div className="h-40 w-full bg-gray-200 rounded-2xl" />
            <div className="h-4 w-full bg-gray-200 rounded" />
            <div className="h-4 w-3/4 bg-gray-200 rounded" />
          </div>
          {/* Custom Navigation Skeleton */}
          <div className="p-4 bg-white border-t border-gray-200 flex justify-around items-center pb-8">
            <div className="h-7 w-7 bg-gray-100 rounded-lg" />
            <div className="h-7 w-7 bg-gray-100 rounded-lg" />
            <div className="h-7 w-7 bg-gray-100 rounded-lg" />
            <div className="h-7 w-7 bg-gray-100 rounded-lg" />
          </div>
        </div>
      );
    }

    if (!firebaseUser) {
      return <AuthScreen onSuccess={() => {}} />;
    }

    if (userProfileExists === false) {
      return (
        <Suspense fallback={
          <div className="flex flex-col h-full bg-white animate-pulse p-6">
            <div className="h-20 w-20 rounded-full bg-gray-200 mx-auto mb-4" />
            <div className="h-6 w-32 bg-gray-200 rounded mx-auto mb-6" />
            <div className="h-10 w-full bg-gray-200 rounded-xl mb-4" />
            <div className="h-10 w-full bg-gray-200 rounded-xl" />
          </div>
        }>
          <ProfileSetup
            userId={firebaseUser.uid}
            email={firebaseUser.email || ""}
            onComplete={handleProfileSetupComplete}
          />
        </Suspense>
      );
    }

    return (
      <div className="h-[100dvh] md:h-screen bg-white text-gray-900 flex flex-col md:flex-row relative select-none w-full overflow-hidden">
        
        {/* Real-time offline warning badge */}
        {!isOnline && (
          <div className="bg-[#1A1A1D] border-b border-[#C9A96E]/30 text-[#F7F4EE] text-[11px] font-medium py-1.5 px-3 text-center flex items-center justify-center gap-2 animate-fade-in shrink-0 z-50 absolute top-0 left-0 right-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E] animate-pulse" />
            <span>Offline Mode — Viewing cached data</span>
          </div>
        )}

        {/* Left Sidebar Navigation - Visible on tablet/desktop (>= 768px / md) */}
        <aside className="hidden md:flex flex-col w-64 lg:w-72 border-r border-[#E8E4DB] bg-[#FFFFFF] p-6 shrink-0 h-screen sticky top-0 justify-between select-none shadow-[1px_0_12px_rgba(13,13,15,0.02)]">
          <div className="flex flex-col gap-8">
            {/* Branding Header */}
            <div className="flex items-center gap-3.5 px-1 py-1">
              <div className="w-9 h-9 border border-[#E8E4DB] rounded-xl overflow-hidden shadow-2xs bg-[#FFFFFF] flex-shrink-0 flex items-center justify-center">
                <img src={logoImg} alt="SwapSkill Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="font-sans font-bold text-base tracking-tight text-[#0D0D0F] leading-none">
                    SwapSkill
                  </span>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#C9A96E]" />
                </div>
                <span className="text-[11px] text-[#71717A] font-normal mt-1 tracking-tight">Skill Exchange Network</span>
              </div>
            </div>

            {/* Sidebar Navigation Items */}
            <nav className="flex flex-col gap-1.5">
              {[
                { id: "home", label: "Discover", icon: <Home className="w-[18px] h-[18px]" strokeWidth={1.8} />, badge: 0 },
                { id: "search", label: "Explore", icon: <Search className="w-[18px] h-[18px]" strokeWidth={1.8} />, badge: 0 },
                { id: "messages", label: "Chats", icon: <MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.8} />, badge: unreadMessages },
                { id: "sessions", label: "Sessions", icon: <Calendar className="w-[18px] h-[18px]" strokeWidth={1.8} />, badge: pendingSessions },
                { id: "profile", label: "Profile", icon: <User className="w-[18px] h-[18px]" strokeWidth={1.8} />, badge: 0 }
              ].map((item) => {
                const isActive = (selectedUserId ? "profile" : currentTab) === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedUserId(null);
                      setCurrentTab(item.id as TabType);
                    }}
                    className={`flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl transition-all duration-200 cursor-pointer text-[13px] ${
                      isActive 
                        ? "bg-[#0D0D0F] text-[#F7F4EE] font-medium shadow-xs" 
                        : "text-[#71717A] hover:bg-[#F2EFE8] hover:text-[#0D0D0F] font-normal"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`transition-colors duration-200 ${isActive ? "text-[#C9A96E]" : "text-[#71717A] group-hover:text-[#0D0D0F]"}`}>
                        {item.icon}
                      </span>
                      <span className="tracking-tight">{item.label}</span>
                    </div>
                    {item.badge > 0 && (
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full shadow-2xs ${
                        isActive ? "bg-[#C9A96E] text-[#0D0D0F]" : "bg-[#0D0D0F] text-[#F7F4EE]"
                      }`}>
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* User Profile Block at Bottom of Sidebar */}
          {currentUserProfile && (
            <div className="border-t border-[#E8E4DB] pt-4 flex flex-col gap-2.5">
              <div 
                className="flex items-center gap-3 p-2.5 hover:bg-[#F2EFE8] border border-[#E8E4DB] rounded-xl transition-all duration-200 cursor-pointer group"
                onClick={() => {
                  setSelectedUserId(null);
                  setCurrentTab("profile");
                }}
              >
                <div className="relative shrink-0">
                  <SmartImage 
                    src={currentUserProfile.photoUrl || currentUserProfile.profilePhotoUrl} 
                    alt={currentUserProfile.fullName} 
                    className="w-10 h-10 rounded-full border border-[#E8E4DB] object-cover shadow-2xs" 
                    fallbackType="profile" 
                    fullName={currentUserProfile.fullName}
                    sizeType="thumbnail"
                  />
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#C9A96E] ring-2 ring-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[#0D0D0F] truncate leading-snug group-hover:text-[#C9A96E] transition-colors">
                    {currentUserProfile.fullName}
                  </p>
                  <p className="text-[11px] text-[#71717A] truncate">@{currentUserProfile.username}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowLogoutConfirm(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-transparent hover:bg-[#1A1A1D]/5 border border-[#E8E4DB] text-[#71717A] hover:text-[#0D0D0F] rounded-xl text-xs font-medium transition-all duration-200 cursor-pointer"
              >
                <LogOut size={13} />
                <span>Log Out</span>
              </button>
            </div>
          )}
        </aside>

        {/* Main Panel */}
        <div className="flex-1 flex flex-col h-[100dvh] md:h-screen relative overflow-hidden bg-theme-bg w-full">
          
          {/* Subtle Starting Soon / Live Now Global Top Banner (across tabs) */}
          <AnimatePresence>
            {activeStartingSoonSession && (
              <GlobalStartingSoonBanner
                session={activeStartingSoonSession}
                currentUserId={firebaseUser.uid}
                onJoinLive={(session) => {
                  setSelectedUserId(null);
                  setCurrentTab("sessions");
                }}
                onViewSession={(session) => {
                  setSelectedUserId(null);
                  setCurrentTab("sessions");
                }}
                onDismiss={(sessionId) => {
                  setDismissedTopBanners((prev) => ({ ...prev, [sessionId]: true }));
                }}
              />
            )}
          </AnimatePresence>

          <div className="flex-1 flex flex-col relative min-h-0 overflow-hidden w-full">
            {/* 1. Browsing other user profile (overlay style to preserve parent tab state) */}
            <AnimatePresence>
              {selectedUserId && (
                <motion.div
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="absolute inset-0 z-20 bg-theme-bg text-theme-text flex flex-col h-full overflow-y-auto w-full"
                >
                  <Suspense fallback={<SkeletonLoader type="profile" />}>
                    <ProfileView
                      currentUserId={firebaseUser.uid}
                      selectedUserId={selectedUserId}
                      onNavigateToTab={(tab) => {
                        setSelectedUserId(null);
                        setCurrentTab(tab);
                      }}
                      onOpenChat={handleOpenChatRoom}
                      onLogOutComplete={() => {
                        setSelectedUserId(null);
                      }}
                      onSelectUser={handleSelectUser}
                      onBack={() => setSelectedUserId(null)}
                    />
                  </Suspense>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 2. Main Tabs - Material Motion Fade-Through */}
            <AnimatePresence mode="wait">
              {!selectedUserId && currentTab === "home" && (
                <motion.div 
                  key="home-tab"
                  initial={{ opacity: 0.85, scale: 0.99 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0.85, scale: 0.99 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  className="flex-1 flex flex-col min-h-0 overflow-y-auto w-full pb-[88px] md:pb-0"
                >
                  <Suspense fallback={<SkeletonLoader type="feed" />}>
                    <HomeView
                      currentUserId={firebaseUser.uid}
                      onSelectUser={handleSelectUser}
                      onNavigateToTab={(tab) => setCurrentTab(tab)}
                    />
                  </Suspense>
                </motion.div>
              )}

              {!selectedUserId && currentTab === "search" && (
                <motion.div 
                  key="search-tab"
                  initial={{ opacity: 0.85, scale: 0.99 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0.85, scale: 0.99 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  className="flex-1 flex flex-col min-h-0 overflow-y-auto w-full pb-[88px] md:pb-0"
                >
                  <Suspense fallback={<SkeletonLoader type="search" />}>
                    <SearchView
                      currentUserId={firebaseUser.uid}
                      onSelectUser={handleSelectUser}
                    />
                  </Suspense>
                </motion.div>
              )}

              {!selectedUserId && currentTab === "messages" && (
                <motion.div 
                  key="messages-tab"
                  initial={{ opacity: 0.85, scale: 0.99 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0.85, scale: 0.99 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  className="flex-1 flex flex-col min-h-0 overflow-hidden w-full pb-[88px] md:pb-0"
                >
                  <Suspense fallback={<SkeletonLoader type="messages" />}>
                    <MessagesView
                      currentUserId={firebaseUser.uid}
                      activeChatId={activeChatId}
                      onCloseChat={() => setActiveChatId(null)}
                      onChatSelect={(chatId) => setActiveChatId(chatId)}
                      onSelectUser={handleSelectUser}
                    />
                  </Suspense>
                </motion.div>
              )}

              {!selectedUserId && currentTab === "sessions" && (
                <motion.div 
                  key="sessions-tab"
                  initial={{ opacity: 0.85, scale: 0.99 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0.85, scale: 0.99 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  className="flex-1 flex flex-col min-h-0 overflow-y-auto w-full pb-[88px] md:pb-0"
                >
                  <Suspense fallback={<SkeletonLoader type="sessions" />}>
                    <SessionsView currentUserId={firebaseUser.uid} />
                  </Suspense>
                </motion.div>
              )}

              {!selectedUserId && currentTab === "profile" && (
                <motion.div 
                  key="profile-tab"
                  initial={{ opacity: 0.85, scale: 0.99 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0.85, scale: 0.99 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  className="flex-1 flex flex-col min-h-0 overflow-y-auto w-full pb-[88px] md:pb-0"
                >
                  <Suspense fallback={<SkeletonLoader type="profile" />}>
                    <ProfileView
                      currentUserId={firebaseUser.uid}
                      selectedUserId={firebaseUser.uid}
                      onNavigateToTab={(tab) => setCurrentTab(tab)}
                      onOpenChat={handleOpenChatRoom}
                      onLogOutComplete={() => {}}
                      onSelectUser={handleSelectUser}
                    />
                  </Suspense>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          {/* Navigation bottom bar (always on mobile < 768px / md) */}
          <div className="md:hidden shrink-0">
            <Navigation
              activeTab={selectedUserId ? "profile" : currentTab}
              onChangeTab={(tab) => {
                setSelectedUserId(null); // Reset user profile browsing
                setActiveChatId(null); // Close active chat when clicking navigating tabs
                setCurrentTab(tab);
              }}
              unreadMessagesCount={unreadMessages}
              pendingSessionsCount={pendingSessions}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full min-h-[100dvh] w-full flex flex-col bg-theme-bg text-theme-text relative select-none overflow-hidden">
      {renderFlow()}

      {/* 10-Minute Alarm Notification Modal */}
      <SessionAlarmReminderModal
        alarm={activeAlarm}
        onClose={() => setActiveAlarm(null)}
        onJoinSession={(session) => {
          setSelectedUserId(null);
          setCurrentTab("sessions");
        }}
      />

      {/* Notification Permission Explanation Dialog */}
      <NotificationPermissionExplainModal
        isOpen={showPermissionPrompt}
        onGrant={async () => {
          safeLocalStorage.setItem("swap_notif_prompted", "true");
          setShowPermissionPrompt(false);
          await requestAlarmNotificationPermission();
        }}
        onDismiss={() => {
          safeLocalStorage.setItem("swap_notif_prompted", "true");
          setShowPermissionPrompt(false);
        }}
      />

      {/* Premium Confirm Bottom Sheets */}
      <LogoutConfirmSheet 
        isOpen={showLogoutConfirm} 
        onClose={() => setShowLogoutConfirm(false)} 
      />
      <DeleteAccountConfirmSheet 
        isOpen={showDeleteConfirm} 
        onClose={() => setShowDeleteConfirm(false)} 
      />
    </div>
  );
}
