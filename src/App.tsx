import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { doc, getDoc, getDocs, getDocFromCache, setDoc, updateDoc, serverTimestamp, collection, query, where, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
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
import { DEFAULT_AVATAR, getUserProfilePhoto } from "./types";
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
import InAppMessageNotification from "./components/InAppMessageNotification";

// Call Components
import IncomingCallPrompt from "./components/IncomingCallPrompt";
import ChatCallModal from "./components/ChatCallModal";
import { 
  callSignalingService, 
  CallSignalingData,
  logCallToConversation,
  generateUniqueCallId,
  generateUniqueSessionId
} from "./services/callSignalingService";
import { getOrCreateConversation } from "./utils/conversationUtils";
import { stopIncomingCallRingtone, stopAllCallSounds } from "./utils/sound";
import { mobileLifecycleService } from "./services/mobile/lifecycle";
import { mobileNetworkService } from "./services/mobile/network";
import { mobileDeepLinkService } from "./services/mobile/deepLinks";
import { mobileForegroundService } from "./services/mobile/foregroundService";
import { pushNotificationService } from "./services/mobile/pushNotificationService";
import { mobileCallKitService } from "./services/mobile/callKitService";
import { mobilePermissionService } from "./services/mobile/permissions";
import { activeChatTrackingService } from "./services/activeChatTrackingService";
import { activeCallSessionService } from "./services/activeCallSessionService";
import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Capacitor } from "@capacitor/core";
import navigationManager, { useBackHandler } from "./utils/navigationManager";

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
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [visitedTabs, setVisitedTabs] = useState<Set<TabType>>(() => new Set(["home"]));

  // Keep visited tabs rendered in memory for instantaneous 0ms native switching
  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(currentTab)) return prev;
      const next = new Set(prev);
      next.add(currentTab);
      return next;
    });
  }, [currentTab]);

  // Sync navigation manager state with React state and active chat tracking
  useEffect(() => {
    activeChatTrackingService.setTab(currentTab);
  }, [currentTab]);

  useEffect(() => {
    const unsubscribe = navigationManager.onStateChange((state) => {
      setCurrentTab(state.tab);
      setSelectedUserId(state.selectedUserId || null);
      setActiveChatId(state.activeChatId || null);
      setIsChatOpen(Boolean(state.activeChatId));
      activeChatTrackingService.setTab(state.tab);
      if (!state.activeChatId) {
        activeChatTrackingService.setActiveChat(null);
      }
    });
    return unsubscribe;
  }, []);

  const handleNavigateTab = (tab: TabType) => {
    setIsChatOpen(false);
    setActiveChatId(null);
    activeChatTrackingService.setActiveChat(null);
    navigationManager.pushState({
      tab,
      selectedUserId: null,
      activeChatId: null,
    });
  };

  const handleSelectUser = (userId: string) => {
    if (!firebaseUser) return;
    if (userId === firebaseUser.uid) {
      handleNavigateTab("profile");
    } else {
      navigationManager.pushState({
        tab: currentTab,
        selectedUserId: userId,
        activeChatId: null,
      });
    }
  };

  const handleOpenChatRoom = useCallback((chatId: string) => {
    setIsChatOpen(true);
    setActiveChatId(chatId);
    navigationManager.pushState({
      tab: "messages",
      selectedUserId: null,
      activeChatId: chatId,
    });
  }, []);

  const handleCloseChat = useCallback(() => {
    setActiveChatId(prev => (prev !== null ? null : prev));
    setIsChatOpen(prev => (prev !== false ? false : prev));
    activeChatTrackingService.setActiveChat(null);
    navigationManager.replaceCurrentState({
      tab: "messages",
      selectedUserId: null,
      activeChatId: null,
    });
  }, []);

  const handleChatSelect = useCallback((chatId: string | null) => {
    setActiveChatId(prev => (prev !== chatId ? chatId : prev));
    setIsChatOpen(prev => (prev !== Boolean(chatId) ? Boolean(chatId) : prev));
    if (chatId) {
      navigationManager.pushState({
        tab: "messages",
        selectedUserId: null,
        activeChatId: chatId,
      });
    }
  }, []);

  const handleActiveChatChange = useCallback((hasActive: boolean, chatId: string | null) => {
    setIsChatOpen(prev => (prev !== hasActive ? hasActive : prev));
    setActiveChatId(prev => {
      const nextId = hasActive ? chatId : null;
      return prev !== nextId ? nextId : prev;
    });
  }, []);

  // Invoke the background chunk preloader after initial interactive render
  useEffect(() => {
    const timer = setTimeout(() => {
      preloadViews();
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  // Invoke the security and device tracking engine
  useSecurityTracker(firebaseUser);

  // 1. Check if user document exists in Firestore on authentication
  useEffect(() => {
    if (!firebaseUser) {
      setUserProfileExists(null);
      return;
    }

    // If profile is already in memory or cache, treat profile as existing
    if (currentUserProfile && (currentUserProfile.fullName || currentUserProfile.username || currentUserProfile.email)) {
      setUserProfileExists(true);
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
            setUserProfileExists(true);
            setLoadingProfileCheck(false);
            return;
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
          setUserProfileExists(true);
        } else {
          // Fallback: Check if an existing profile exists with this user's email (e.g. created previously via email/password or Google)
          if (firebaseUser.email) {
            const cleanEmail = firebaseUser.email.trim().toLowerCase();
            const qEmail = query(collection(db, "users"), where("email", "==", cleanEmail));
            const emailSnap = await getDocs(qEmail).catch(() => null);
            if (emailSnap && !emailSnap.empty) {
              const matchedDoc = emailSnap.docs[0];
              const existingData = { ...matchedDoc.data(), id: firebaseUser.uid, uid: firebaseUser.uid };
              await setDoc(userDocRef, { ...existingData, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
              setProfileInCache(existingData);
              setUserProfileExists(true);
              return;
            }
          }
          // Only if this user genuinely has no existing profile document
          setUserProfileExists(false);
        }
      } catch (err: any) {
        if (err?.message === "Timeout") {
          console.warn("[App Profile Check] Profile check timed out, continuing with default state.");
        } else {
          console.error("Error checking Firestore profile:", err);
        }
        // If an error happens, default to true if user already has an auth profile
        setUserProfileExists(Boolean(firebaseUser.displayName || firebaseUser.email));
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

  // Real-time Incoming Live Swap Call State
  const [incomingCall, setIncomingCall] = useState<CallSignalingData | null>(null);
  const [activeAcceptedCall, setActiveAcceptedCall] = useState<{
    sessionId: string;
    partnerName: string;
    partnerPhoto?: string;
    partnerUid?: string;
    skillName?: string;
    incomingCallId?: string;
    isCaller?: boolean;
    initialCallType?: "video" | "audio";
    conversationId?: string;
    sessionDuration?: number;
    scheduledTime?: any;
    sessionEndTime?: any;
  } | null>(null);

  // Register top-level back handlers for modals
  useBackHandler(Boolean(incomingCall), () => {
    setIncomingCall(null);
  });
  useBackHandler(Boolean(activeAlarm), () => {
    setActiveAlarm(null);
  });
  useBackHandler(showPermissionPrompt, () => {
    setShowPermissionPrompt(false);
  });

  // Register background ServiceWorker and native mobile lifecycle on startup
  useEffect(() => {
    registerServiceWorker().catch(() => {});

    // Initialize mobile core services
    mobileLifecycleService.init();
    mobileNetworkService.init().catch(() => {});

    const attachAcceptedCallDirectly = (callInfo: {
      callId: string;
      sessionId?: string;
      callerId?: string;
      callerName?: string;
      callerPhoto?: string;
      callType?: "video" | "audio";
      skillName?: string;
      conversationId?: string;
    }) => {
      const targetCallId = callInfo.callId;
      const targetSessionId = callInfo.sessionId || targetCallId;
      console.log(`[CALL_NATIVE_ACCEPT] callId=${targetCallId} sessionId=${targetSessionId}`);
      console.log(`[CALL_ATTACH] callId=${targetCallId} sessionId=${targetSessionId}`);

      callSignalingService.markCallAccepted(targetCallId);
      callSignalingService.registerActiveCall(targetSessionId, targetCallId);
      callSignalingService.acceptCall(targetCallId).catch(() => {});

      setIsSplashFinished(true);
      stopAllCallSounds();
      setIncomingCall(null);

      setActiveAcceptedCall({
        sessionId: targetSessionId,
        partnerName: callInfo.callerName || "Swap Partner",
        partnerPhoto: callInfo.callerPhoto,
        partnerUid: callInfo.callerId || "",
        skillName: callInfo.skillName || "Chat Call",
        incomingCallId: targetCallId,
        isCaller: false,
        initialCallType: callInfo.callType || "video",
        conversationId: callInfo.conversationId,
      });

      if (Capacitor.isNativePlatform()) {
        mobileForegroundService.clearPendingAcceptedCall().catch(() => {});
      }

      // Hydrate any missing caller details from Firestore call doc in background
      if (!callInfo.callerId || !callInfo.callerName || !callInfo.callerPhoto || !callInfo.sessionId) {
        callSignalingService.getCall(targetCallId).then((callData) => {
          if (callData) {
            setActiveAcceptedCall((prev) => {
              if (!prev || prev.incomingCallId !== targetCallId) return prev;
              return {
                ...prev,
                sessionId: prev.sessionId || callData.sessionId || targetCallId,
                partnerName: (!prev.partnerName || prev.partnerName === "Swap Partner") ? (callData.callerName || "Swap Partner") : prev.partnerName,
                partnerPhoto: prev.partnerPhoto || callData.callerPhoto,
                partnerUid: prev.partnerUid || callData.callerId || "",
                skillName: prev.skillName || callData.skillName || "Chat Call",
                conversationId: prev.conversationId || callData.conversationId,
                initialCallType: prev.initialCallType || callData.callType || "video",
              };
            });
          }
        }).catch(() => {});
      }
    };

    // Initialize native deep link and notification tap routing
    mobileDeepLinkService.init(async (route) => {
      console.log("[App] Deep link received:", route);
      if (route.type === "call" && route.callId) {
        try {
          // If the call was already accepted natively or autoAccept is requested, join immediately!
          if (route.alreadyAccepted || route.autoAccept || route.autoJoinLive) {
            attachAcceptedCallDirectly({
              callId: route.callId,
              sessionId: route.sessionId,
              callerId: route.callerId,
              callerName: route.callerName,
              callerPhoto: route.callerPhoto,
              callType: route.callType,
              skillName: route.skillName,
              conversationId: route.conversationId,
            });
            return;
          }

          let currentUid = auth.currentUser?.uid;
          if (!currentUid) {
            try {
              currentUid = safeLocalStorage.getItem("current_user_id") || undefined;
            } catch (_) {}
          }

          const callDoc = await getDoc(doc(db, "calls", route.callId));
          if (callDoc.exists()) {
            const callData = { ...callDoc.data(), id: callDoc.id } as CallSignalingData;

            if (currentUid && callData.receiverId && callData.receiverId !== currentUid) {
              console.warn("[App] Rejected call deep link: current user is not receiver of call:", route.callId);
              return;
            }

            const rawCreatedAt = callData.createdAt as any;
            const callCreatedTime = rawCreatedAt?.toMillis
              ? rawCreatedAt.toMillis()
              : rawCreatedAt?.seconds
              ? rawCreatedAt.seconds * 1000
              : typeof rawCreatedAt === "number"
              ? rawCreatedAt
              : 0;

            if (callCreatedTime > 0 && Date.now() - callCreatedTime > 45000) {
              console.warn("[App] Rejected call deep link: call invitation has expired.");
              return;
            }

            const isCallActive =
              callData.status === "calling" ||
              callData.status === "ringing" ||
              callData.status === "accepting" ||
              callData.status === "connecting";

            if (isCallActive) {
              if (route.autoJoinLive || route.autoAccept || route.alreadyAccepted) {
                attachAcceptedCallDirectly({
                  callId: callData.id,
                  sessionId: callData.sessionId || route.sessionId,
                  callerId: callData.callerId || route.callerId,
                  callerName: callData.callerName || route.callerName,
                  callerPhoto: callData.callerPhoto || route.callerPhoto,
                  callType: callData.callType || route.callType,
                  skillName: callData.skillName || route.skillName,
                  conversationId: callData.conversationId || route.conversationId,
                });
              } else {
                setIncomingCall(callData);
              }
            }
          }
        } catch (err) {
          console.warn("[App] Error loading call from deep link:", err);
        }
      } else if (route.type === "live_call" || route.type === "session") {
        setSelectedUserId(null);
        setCurrentTab("sessions");
      } else if (route.type === "chat" && route.chatId) {
        setSelectedUserId(null);
        setCurrentTab("messages");
        setActiveChatId(route.chatId);
      }
    });

    // Check for pending pre-accepted call from native layer on cold boot & live native acceptance
    if (Capacitor.isNativePlatform()) {
      const handleNativeAcceptedCall = (pendingCall: any) => {
        if (pendingCall && (pendingCall.hasPendingCall || pendingCall.alreadyAccepted) && pendingCall.callId) {
          attachAcceptedCallDirectly({
            callId: pendingCall.callId,
            sessionId: pendingCall.sessionId,
            callerId: pendingCall.callerId,
            callerName: pendingCall.callerName,
            callerPhoto: pendingCall.callerPhoto,
            callType: pendingCall.callType,
            skillName: pendingCall.skillName,
            conversationId: pendingCall.conversationId,
          });
        }
      };

      mobileForegroundService.getPendingAcceptedCall().then(handleNativeAcceptedCall).catch((err) => {
        console.warn("[App] Failed to check pending pre-accepted call:", err);
      });

      mobileForegroundService.onCallAcceptedNatively(handleNativeAcceptedCall);
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
  }, []);

  // Sessions badge: Pending requests needing attention + Sessions starting soon / Live now
  const pendingSessions = useMemo(() => {
    if (!firebaseUser) return 0;
    const now = Date.now();

    // 1. Pending incoming requests where user is teacher/receiver
    const incomingRequests = (sessions || []).filter(
      (s) => (s.teacherId === firebaseUser.uid || s.receiverId === firebaseUser.uid) &&
             s.senderId !== firebaseUser.uid &&
             (s.status === "requested" || s.status === "pending" || s.status === "Pending")
    ).length;

    // 2. Upcoming sessions starting soon (<= 15 min) or Live Now
    const startingSoonOrLive = (sessions || []).filter((s) => {
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

      // A session is ONLY live if an active call is actually taking place with real participants
      const isRealLiveCall = s.isLive === true && Array.isArray(s.liveParticipants) && s.liveParticipants.length > 0;

      const schedMs = s.scheduledTime?.seconds ? s.scheduledTime.seconds * 1000 : new Date(s.scheduledTime).getTime();
      if (isNaN(schedMs)) return isRealLiveCall;
      const diffMins = (schedMs - now) / 60000;
      
      // Only show starting soon within 15 mins before start time, OR if a real live call is currently active
      return isRealLiveCall || (diffMins <= 15 && diffMins >= 0);
    }) || null;
  }, [sessions, firebaseUser, dismissedTopBanners]);

  // Native Mobile Hardware Back Button Handling & Dynamic Status Bar styling
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      try {
        if (activeStartingSoonSession) {
          StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
          StatusBar.setBackgroundColor({ color: "#0D0D0F" }).catch(() => {});
        } else {
          StatusBar.setStyle({ style: Style.Light }).catch(() => {});
          StatusBar.setBackgroundColor({ color: "#F7F4EE" }).catch(() => {});
        }
      } catch {}

      const backListener = CapApp.addListener("backButton", ({ canGoBack }) => {
        const handled = navigationManager.handleBack();
        if (!handled) {
          if (canGoBack) {
            window.history.back();
          } else {
            CapApp.exitApp();
          }
        }
      });

      return () => {
        backListener.then((sub) => sub.remove()).catch(() => {});
      };
    }
  }, [activeAlarm, showLogoutConfirm, showDeleteConfirm, selectedUserId, currentTab, setShowLogoutConfirm, setShowDeleteConfirm, activeStartingSoonSession]);

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

  // Prompt for App Permissions (Camera, Mic, Push Alerts) once logged in if not prompted
  useEffect(() => {
    if (!firebaseUser || loadingAuth) return;
    if (typeof window !== "undefined") {
      const alreadyPrompted = safeLocalStorage.getItem("swap_permissions_prompted") || safeLocalStorage.getItem("swap_notif_prompted");
      const needsPrompt = "Notification" in window && Notification.permission === "default";
      if (!alreadyPrompted && needsPrompt) {
        const timer = setTimeout(() => {
          setShowPermissionPrompt(true);
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [firebaseUser?.uid, loadingAuth]);

  // Initialize Native / Web Push Notification Token Registration
  useEffect(() => {
    const effectiveUid = firebaseUser?.uid || auth.currentUser?.uid;
    if (effectiveUid) {
      pushNotificationService.init(effectiveUid).catch((err) => {
        console.warn("[App] Push notification init failed:", err);
      });
      mobileCallKitService.syncVoipTokenToFirestore(effectiveUid).catch((err) => {
        console.warn("[App] CallKit VoIP token sync failed:", err);
      });

      // Automatically sync push notification status if camera/mic or notification permissions are already granted
      if (typeof window !== "undefined") {
        if ("Notification" in window && Notification.permission === "granted") {
          safeLocalStorage.setItem("swap_push_notifications_enabled", "true");
          window.dispatchEvent(new CustomEvent("swap_push_status_changed", { detail: { enabled: true } }));
        } else if (navigator.permissions?.query) {
          navigator.permissions.query({ name: "camera" as any }).then((camStatus) => {
            if (camStatus.state === "granted") {
              pushNotificationService.requestPermissionAndRegister(effectiveUid).catch(() => {});
            }
          }).catch(() => {});
        }
      }
    } else if (!loadingAuth) {
      pushNotificationService.unregisterOrLogout().catch(() => {});
    }
  }, [firebaseUser?.uid, auth.currentUser?.uid, loadingAuth]);

  // Listen for Native and Foreground Push Notification Call Events immediately on mount (never blocked by auth!)
  useEffect(() => {
    const handleNotifCall = (e: any) => {
      const detail = e.detail;
      const callId = detail?.callId || detail?.id;
      if (!callId) return;
      if (
        activeAcceptedCall ||
        activeCallSessionService.hasActiveCall() ||
        callSignalingService.getActiveCallId() === callId ||
        callSignalingService.isCallAccepted(callId) ||
        callSignalingService.isCallTerminated(callId)
      ) {
        console.log("[App] Suppressing incoming call notification: call already active or handled:", callId);
        return;
      }
      console.log(`[TIMING] INCOMING_UI_SHOWN: (via notification) callId=${callId} t=${Date.now()}`);
      console.log("[App] Incoming call received via notification event:", detail);

      // Verify call is actually active in Firestore before popping UI
      callSignalingService.getCall(callId).then((callData) => {
        if (!callData) return;
        if (callData.status !== "calling" && callData.status !== "ringing") return;
        if (
          activeAcceptedCall ||
          activeCallSessionService.hasActiveCall() ||
          callSignalingService.isCallAccepted(callId) ||
          callSignalingService.isCallTerminated(callId)
        ) {
          return;
        }
        setIncomingCall(callData);
      }).catch(() => {});
    };

    const handleNotifCancel = (e: any) => {
      const callId = e.detail?.callId || e.detail?.id;
      if (callId) {
        console.log("[App] Incoming call cancelled via notification event:", callId);
        setIncomingCall((curr) => {
          if (curr && (curr.id === callId || (curr as any).callId === callId)) {
            stopAllCallSounds();
            callSignalingService.resetCallState();
            activeCallSessionService.endActiveCallExplicitly("Notification cancel event");
            return null;
          }
          return curr;
        });
      }
    };

    window.addEventListener("swapskill_incoming_call_notif", handleNotifCall);
    window.addEventListener("swapskill_call_cancelled_notif", handleNotifCancel);

    return () => {
      window.removeEventListener("swapskill_incoming_call_notif", handleNotifCall);
      window.removeEventListener("swapskill_call_cancelled_notif", handleNotifCancel);
    };
  }, [activeAcceptedCall, currentUserProfile, firebaseUser]);

  // Real-time Incoming Live Swap Calls Listener via Firestore
  useEffect(() => {
    const effectiveUid = firebaseUser?.uid || auth.currentUser?.uid;
    if (!effectiveUid) return;

    const unsubCalls = callSignalingService.listenToIncomingCalls(
      effectiveUid,
      (call) => {
        const activeCallId = callSignalingService.getActiveCallId();
        const effectiveCallId = call.id || (call as any).callId;
        if (
          activeAcceptedCall ||
          activeCallSessionService.hasActiveCall() ||
          activeCallId === effectiveCallId ||
          callSignalingService.isCallAccepted(effectiveCallId) ||
          callSignalingService.isCallTerminated(effectiveCallId)
        ) {
          console.log("[App] Suppressing incoming call prompt: call already active or handled:", effectiveCallId);
          return;
        }

        // If the call was already accepted natively or by backend, immediately attach it without asking user again!
        if (call.status === "accepting" || call.status === "connected" || (call as any).status === "in_call") {
          console.log("[App] Incoming call is already accepted/connecting, auto-attaching ChatCallModal:", effectiveCallId);
          setIsSplashFinished(true);
          stopAllCallSounds();
          setIncomingCall(null);
          setActiveAcceptedCall({
            sessionId: call.sessionId || effectiveCallId,
            partnerName: call.callerName || "Swap Partner",
            partnerPhoto: call.callerPhoto,
            partnerUid: call.callerId || "",
            skillName: call.skillName || "Chat Call",
            incomingCallId: effectiveCallId,
            isCaller: false,
            initialCallType: call.callType || "video",
            conversationId: call.conversationId,
          });
          return;
        }

        console.log(`[TIMING] INCOMING_UI_SHOWN: (via Firestore) callId=${effectiveCallId} t=${Date.now()}`);
        console.log("[App] Incoming Live Swap call detected:", call);
        setIncomingCall(call);
      },
      (err) => {
        console.warn("[App] Error listening to incoming calls:", err);
      },
      (cancelledCallId) => {
        console.log("[App] Incoming call cancelled by caller:", cancelledCallId);
        setIncomingCall((curr) => {
          if (curr && (curr.id === cancelledCallId || (curr as any).callId === cancelledCallId)) {
            stopAllCallSounds();
            callSignalingService.resetCallState();
            activeCallSessionService.endActiveCallExplicitly("Incoming call cancelled by caller");
            return null;
          }
          return curr;
        });
        setActiveAcceptedCall((curr) => {
          if (curr && (curr.incomingCallId === cancelledCallId || curr.sessionId === cancelledCallId)) {
            stopAllCallSounds();
            callSignalingService.resetCallState();
            activeCallSessionService.endActiveCallExplicitly("Incoming call cancelled by caller");
            return null;
          }
          return curr;
        });
      }
    );

    return () => {
      unsubCalls();
    };
  }, [firebaseUser?.uid, auth.currentUser?.uid, activeAcceptedCall]);

  const handleAcceptIncomingCall = useCallback((call: CallSignalingData) => {
    const targetCallId = call.id || (call as any).callId;
    console.log(`[TIMING] T6_CALLEE_ANSWERED: callId=${targetCallId}`);
    stopAllCallSounds();
    setIncomingCall(null);
    const targetSessionId = call.sessionId || targetCallId;
    callSignalingService.acceptCall(targetCallId).catch(() => {});
    setActiveAcceptedCall({
      sessionId: targetSessionId,
      partnerName: call.callerName || "Swap Partner",
      partnerPhoto: call.callerPhoto,
      partnerUid: call.callerId,
      skillName: call.skillName || "Chat Call",
      incomingCallId: targetCallId,
      isCaller: false,
      initialCallType: call.callType || "video",
      conversationId: call.conversationId,
    });
  }, []);

  const handleDeclineIncomingCall = useCallback((call: CallSignalingData) => {
    setIncomingCall(null);
    stopAllCallSounds();
    if (call.sessionId) {
      callSignalingService.terminateSession(call.sessionId, call.id, "User declined the call");
    }
    callSignalingService.rejectCall(call.id, "User declined the call", call.sessionId);
    callSignalingService.resetCallState();
    activeCallSessionService.endActiveCallExplicitly("User declined the call");

    // Also persist declined call entry to conversation
    const convId = call.conversationId;
    (async () => {
      try {
        let targetConvId = convId;
        if (!targetConvId && call.callerId && call.receiverId) {
          const res = await getOrCreateConversation(call.receiverId, call.callerId);
          targetConvId = res.chatId;
        }
        if (targetConvId) {
          await logCallToConversation({
            conversationId: targetConvId,
            callId: call.id,
            callType: call.callType || "video",
            status: "declined",
            durationSeconds: 0,
            callerId: call.callerId,
            callerName: call.callerName,
            receiverId: call.receiverId,
            receiverName: call.receiverName,
            currentUserId: firebaseUser?.uid || call.receiverId,
          });
        }
      } catch (err) {
        console.warn("[App] Error logging declined call:", err);
      }
    })();
  }, [firebaseUser?.uid]);

  // Connect native iOS CallKit Answer/Decline actions directly to Firestore and WebRTC
  useEffect(() => {
    if (!mobileCallKitService.isSupported()) return;

    // Check if user answered or declined a call from CallKit while app was closed or backgrounded
    const checkPendingCallKitAction = async () => {
      const pending = await mobileCallKitService.getPendingCallAction();
      if (pending && pending.hasAction && pending.callId) {
        console.log(`[App] Processing pending CallKit action: ${pending.action} for callId: ${pending.callId}`);
        try {
          const callDoc = await getDoc(doc(db, "calls", pending.callId));
          if (callDoc.exists()) {
            const callData = { ...callDoc.data(), id: callDoc.id } as CallSignalingData;
            if (pending.action === "answer") {
              handleAcceptIncomingCall(callData);
            } else if (pending.action === "decline") {
              handleDeclineIncomingCall(callData);
            }
          }
        } catch (e) {
          console.warn("[App] Error executing pending CallKit action:", e);
        }
      }
    };
    checkPendingCallKitAction();

    // Listen for live CallKit events while app is open/foregrounded
    const unsubAnswer = mobileCallKitService.onCallAnswered(async ({ callId }) => {
      console.log(`[App] CallKit Answer action event received for callId: ${callId}`);
      try {
        const callDoc = await getDoc(doc(db, "calls", callId));
        if (callDoc.exists()) {
          const callData = { ...callDoc.data(), id: callDoc.id } as CallSignalingData;
          handleAcceptIncomingCall(callData);
        }
      } catch (e) {
        console.warn("[App] Error handling CallKit answer event:", e);
      }
    });

    const unsubDecline = mobileCallKitService.onCallDeclined(async ({ callId }) => {
      console.log(`[App] CallKit Decline action event received for callId: ${callId}`);
      try {
        const callDoc = await getDoc(doc(db, "calls", callId));
        if (callDoc.exists()) {
          const callData = { ...callDoc.data(), id: callDoc.id } as CallSignalingData;
          handleDeclineIncomingCall(callData);
        } else {
          callSignalingService.rejectCall(callId, "Declined via CallKit");
        }
      } catch (e) {
        console.warn("[App] Error handling CallKit decline event:", e);
      }
    });

    return () => {
      unsubAnswer();
      unsubDecline();
    };
  }, [handleAcceptIncomingCall, handleDeclineIncomingCall]);

  const handleStartCallFromChat = useCallback((partnerUser: any, callType: "video" | "audio", conversationId: string) => {
    const partnerId = partnerUser.id || partnerUser.uid;
    const partnerName = partnerUser.name || partnerUser.fullName || "Partner";
    const partnerPhoto = getUserProfilePhoto(partnerUser);

    const freshSessionId = generateUniqueSessionId(`chat_${conversationId || "direct"}`);
    const freshCallId = generateUniqueCallId(`chat_${conversationId || "direct"}`);

    setActiveAcceptedCall({
      sessionId: freshSessionId,
      partnerName,
      partnerPhoto,
      partnerUid: partnerId,
      skillName: "Chat Call",
      isCaller: true,
      initialCallType: callType,
      conversationId: conversationId,
      incomingCallId: freshCallId,
    });
  }, []);

  const handleStartCallFromSession = useCallback((callConfig: {
    sessionId: string;
    partnerName: string;
    partnerPhoto?: string;
    partnerUid?: string;
    skillName: string;
    sessionDuration?: number;
    scheduledTime?: any;
    sessionEndTime?: any;
    isCaller?: boolean;
    initialCallType?: "video" | "audio";
    incomingCallId?: string;
    conversationId?: string;
  }) => {
    const freshCallId = callConfig.incomingCallId || generateUniqueCallId(`session_${callConfig.sessionId || "swap"}`);

    setActiveAcceptedCall({
      sessionId: callConfig.sessionId,
      partnerName: callConfig.partnerName,
      partnerPhoto: callConfig.partnerPhoto,
      partnerUid: callConfig.partnerUid,
      skillName: callConfig.skillName || "Live Swap Call",
      isCaller: callConfig.isCaller ?? true,
      initialCallType: callConfig.initialCallType || "video",
      incomingCallId: freshCallId,
      conversationId: callConfig.conversationId,
      sessionDuration: callConfig.sessionDuration,
      scheduledTime: callConfig.scheduledTime,
      sessionEndTime: callConfig.sessionEndTime,
    });
  }, []);

  const handleFinishSplash = () => {
    setIsSplashFinished(true);
  };

  const handleFinishOnboarding = () => {
    safeLocalStorage.setItem("swap_onboarding_finished", "true");
    setIsOnboardingFinished(true);
  };

  const handleProfileSetupComplete = () => {
    setUserProfileExists(true);
    handleNavigateTab("home");
  };

  // Warm up and prefetch all primary tab views in background so tab switching is instantaneous (< 1-2s)
  useEffect(() => {
    if (firebaseUser?.uid) {
      const preloadTimer = setTimeout(() => {
        import("./components/ProfileView");
        import("./components/SearchView");
        import("./components/MessagesView");
        import("./components/SessionsView");
        import("./components/SettingsView");
      }, 300);
      return () => clearTimeout(preloadTimer);
    }
  }, [firebaseUser?.uid]);

  // Render main routing flow
  const renderFlow = () => {
    // If user is currently in a call, hide background flow completely
    if (activeAcceptedCall) {
      return null;
    }

    if (!isSplashFinished || loadingAuth || (loadingProfileCheck && !currentUserProfile)) {
      return <SplashScreen onFinish={handleFinishSplash} />;
    }
    
    if (!isOnboardingFinished) {
      return <Onboarding onFinish={handleFinishOnboarding} />;
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

    const isMobileChatActive = (
      currentTab === "messages" && (
        Boolean(activeChatId) || 
        isChatOpen || 
        Boolean(activeChatTrackingService.getActiveChatId())
      )
    );

    return (
      <div className="h-full h-[100dvh] w-full bg-theme-bg text-theme-text flex flex-col md:flex-row relative select-none max-w-full overflow-hidden">
        
        {/* Real-time offline warning badge */}
        {!isOnline && (
          <div className="bg-[#1A1A1D] border-b border-[#C9A96E]/30 text-[#F7F4EE] text-[11px] font-medium py-1.5 px-3 text-center flex items-center justify-center gap-2 animate-fade-in shrink-0 z-50 absolute top-0 left-0 right-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E] animate-pulse" />
            <span>Offline Mode — Viewing cached data</span>
          </div>
        )}

        {/* Left Sidebar Navigation - Visible on tablet/desktop (>= 768px / md) */}
        <aside className="hidden md:flex flex-col w-60 lg:w-68 border-r border-[#E8E4DB] bg-[#FFFFFF] p-5 shrink-0 h-full sticky top-0 justify-between select-none shadow-[1px_0_12px_rgba(13,13,15,0.02)]">
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
                      handleNavigateTab(item.id as TabType);
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
                  handleNavigateTab("profile");
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
        <div className="flex-1 flex flex-col h-full h-[100dvh] min-h-0 relative overflow-hidden bg-theme-bg w-full">
          
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
                        handleNavigateTab(tab);
                      }}
                      onOpenChat={handleOpenChatRoom}
                      onLogOutComplete={() => {
                        setSelectedUserId(null);
                      }}
                      onSelectUser={handleSelectUser}
                      onBack={() => navigationManager.popState()}
                    />
                  </Suspense>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 2. Main Tabs - Native Keep-Alive (Zero Flashing, Instant 0ms Tab Switching) */}
            <div className="flex-1 flex flex-col min-h-0 relative w-full h-full">
              {visitedTabs.has("home") && (
                <div 
                  className={`flex-1 flex-col min-h-0 overflow-y-auto w-full pb-6 mobile-scroll ${
                    !selectedUserId && currentTab === "home" ? "flex" : "hidden"
                  }`}
                >
                  <Suspense fallback={<SkeletonLoader type="feed" />}>
                    <HomeView
                      currentUserId={firebaseUser.uid}
                      onSelectUser={handleSelectUser}
                      onNavigateToTab={(tab) => setCurrentTab(tab)}
                    />
                  </Suspense>
                </div>
              )}

              {visitedTabs.has("search") && (
                <div 
                  className={`flex-1 flex-col min-h-0 overflow-y-auto w-full pb-6 mobile-scroll ${
                    !selectedUserId && currentTab === "search" ? "flex" : "hidden"
                  }`}
                >
                  <Suspense fallback={<SkeletonLoader type="search" />}>
                    <SearchView
                      currentUserId={firebaseUser.uid}
                      onSelectUser={handleSelectUser}
                    />
                  </Suspense>
                </div>
              )}

              {visitedTabs.has("messages") && (
                <div 
                  className={`flex-1 flex-col min-h-0 overflow-hidden w-full ${
                    !selectedUserId && currentTab === "messages" ? "flex" : "hidden"
                  }`}
                >
                  <Suspense fallback={<SkeletonLoader type="messages" />}>
                    <MessagesView
                      currentUserId={firebaseUser.uid}
                      activeChatId={activeChatId}
                      onCloseChat={handleCloseChat}
                      onChatSelect={handleChatSelect}
                      onActiveChatChange={handleActiveChatChange}
                      onSelectUser={handleSelectUser}
                      onStartCall={handleStartCallFromChat}
                    />
                  </Suspense>
                </div>
              )}

              {visitedTabs.has("sessions") && (
                <div 
                  className={`flex-1 flex-col min-h-0 overflow-y-auto w-full pb-6 mobile-scroll ${
                    !selectedUserId && currentTab === "sessions" ? "flex" : "hidden"
                  }`}
                >
                  <Suspense fallback={<SkeletonLoader type="sessions" />}>
                    <SessionsView
                      currentUserId={firebaseUser.uid}
                      onStartCall={handleStartCallFromSession}
                    />
                  </Suspense>
                </div>
              )}

              {visitedTabs.has("profile") && (
                <div 
                  className={`flex-1 flex-col min-h-0 overflow-y-auto w-full pb-6 mobile-scroll ${
                    !selectedUserId && currentTab === "profile" ? "flex" : "hidden"
                  }`}
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
                </div>
              )}
            </div>
          </div>
          
          {/* Navigation bottom bar (always on mobile < 768px / md, hidden when viewing an individual chat) */}
          {!isMobileChatActive && (
            <div className="md:hidden shrink-0 w-full">
              <Navigation
                activeTab={selectedUserId ? "profile" : currentTab}
                onChangeTab={(tab) => {
                  handleNavigateTab(tab);
                }}
                unreadMessagesCount={unreadMessages}
                pendingSessionsCount={pendingSessions}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full h-[100dvh] w-full max-w-full flex flex-col bg-theme-bg text-theme-text relative select-none overflow-hidden">
      {renderFlow()}

      {/* Global In-App Interactive Message Notification with Mark as Read & Reply */}
      <InAppMessageNotification />

      {/* 10-Minute Alarm Notification Modal */}
      <SessionAlarmReminderModal
        alarm={activeAlarm}
        onClose={() => setActiveAlarm(null)}
        onJoinSession={(session) => {
          setSelectedUserId(null);
          setCurrentTab("sessions");
        }}
      />

      {/* Notification & Call Permission Explanation Dialog */}
      <NotificationPermissionExplainModal
        isOpen={showPermissionPrompt}
        onGrant={async () => {
          safeLocalStorage.setItem("swap_permissions_prompted", "true");
          safeLocalStorage.setItem("swap_notif_prompted", "true");
          setShowPermissionPrompt(false);
          const effectiveUid = firebaseUser?.uid || auth.currentUser?.uid;
          try {
            const streamRes = await mobilePermissionService.acquireCallMediaStream({ video: true, audio: true });
            if (streamRes.stream) {
              mobilePermissionService.releaseActiveStream();
            }
          } catch (_) {}
          if (effectiveUid) {
            await pushNotificationService.requestPermissionAndRegister(effectiveUid);
            safeLocalStorage.setItem("swap_push_notifications_enabled", "true");
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("swap_push_status_changed", { detail: { enabled: true } }));
            }
          }
          await requestAlarmNotificationPermission();
        }}
        onDismiss={() => {
          safeLocalStorage.setItem("swap_permissions_prompted", "true");
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

      {/* Real-time Incoming Live Swap Call Prompt */}
      {!activeAcceptedCall &&
        incomingCall &&
        !callSignalingService.isCallAccepted(incomingCall.id || (incomingCall as any).callId) && (
        <IncomingCallPrompt
          call={incomingCall}
          onAccept={handleAcceptIncomingCall}
          onDecline={handleDeclineIncomingCall}
        />
      )}

      {/* App-Level Call Modals */}
      {activeAcceptedCall && (
        <Suspense fallback={null}>
          {(() => {
            const effectiveUid =
              firebaseUser?.uid ||
              auth.currentUser?.uid ||
              currentUserProfile?.uid ||
              (() => {
                try {
                  const saved = safeLocalStorage.getItem("swap_cache_user_profile");
                  if (saved) return JSON.parse(saved)?.uid || "";
                } catch (_) {}
                return safeLocalStorage.getItem("current_user_id") || "";
              })() ||
              "";

            return (
              <ChatCallModal
                isOpen={true}
                onClose={() => {
                  stopAllCallSounds();
                  callSignalingService.resetCallState();
                  activeCallSessionService.endActiveCallExplicitly("Call modal closed");
                  setActiveAcceptedCall(null);
                  setIncomingCall(null);
                }}
                partnerName={activeAcceptedCall.partnerName}
                partnerPhoto={activeAcceptedCall.partnerPhoto}
                partnerUid={activeAcceptedCall.partnerUid}
                sessionId={activeAcceptedCall.sessionId}
                skillName={activeAcceptedCall.skillName}
                sessionDuration={activeAcceptedCall.sessionDuration}
                currentUserId={effectiveUid || "current_user"}
                currentUserName={currentUserProfile?.fullName || firebaseUser?.displayName || auth.currentUser?.displayName || "You"}
                currentUserPhoto={getUserProfilePhoto(currentUserProfile, firebaseUser || auth.currentUser)}
                incomingCallId={activeAcceptedCall.incomingCallId}
                isCaller={activeAcceptedCall.isCaller ?? false}
                callType={activeAcceptedCall.initialCallType || "video"}
                conversationId={activeAcceptedCall.conversationId}
                onSessionCompleted={() => {
                  setActiveAcceptedCall(null);
                  setCurrentTab("sessions");
                }}
              />
            );
          })()}
        </Suspense>
      )}
    </div>
  );
}
