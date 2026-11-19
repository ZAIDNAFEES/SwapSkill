import React, { useState, useEffect, useMemo, useCallback, Suspense, useRef } from "react";
import { doc, getDoc, getDocs, getDocFromCache, setDoc, updateDoc, serverTimestamp, collection, query, where, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "./firebase";
import { useSecurityTracker } from "./hooks/useSecurityTracker";
import { useApp } from "./context/AppContext";
import logoImg from "./assets/logo.jpg";
import { Home, Search, MessageSquare, Calendar, User, LogOut, Swords } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Components & Loaders
import SplashScreen from "./components/SplashScreen";
import Onboarding from "./components/Onboarding";
import AuthScreen from "./components/AuthScreen";
import Navigation, { TabType } from "./components/Navigation";
import SkeletonLoader from "./components/SkeletonLoader";
import { LogoutConfirmSheet, DeleteAccountConfirmSheet } from "./components/PremiumConfirmSheets";
import SmartImage from "./components/SmartImage";
import { PullToRefresh } from "./components/PullToRefresh";
import { safeLocalStorage } from "./utils/safeStorage";
import { DEFAULT_AVATAR, Session, getUserProfilePhoto } from "./types";
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

// Call & Post-Session Components
import IncomingCallPrompt from "./components/IncomingCallPrompt";
import ChatCallModal from "./components/ChatCallModal";
import LiveSwapCallModal, { LiveSwapSessionOutcome } from "./components/LiveSwapCallModal";
import PostSessionSummaryModal, { PostSessionOutcomeMeta } from "./components/PostSessionSummaryModal";
import CertificateModal from "./components/CertificateModal";
import { 
  callSignalingService, 
  CallSignalingData,
  logCallToConversation,
  generateUniqueCallId,
  generateUniqueSessionId
} from "./services/callSignalingService";
import { getOrCreateConversation, getOtherParticipantId } from "./utils/conversationUtils";
import { WebRTCService } from "./services/webrtcService";
import { stopIncomingCallRingtone, stopAllCallSounds, soundService } from "./utils/sound";
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
import { muteChat } from "./utils/mutedChats";

// Synchronously detect direct chat deep-link launches before first render so Home/Splash never flashes
const getInitialDeepLinkChatId = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const paramChatId = params.get("chatId");
    if (paramChatId && paramChatId.trim()) return paramChatId.trim();
    const match = window.location.pathname.match(/^\/chat\/([^/?#]+)/);
    if (match && match[1]) return decodeURIComponent(match[1]);
  } catch {}
  return null;
};

const INITIAL_DEEP_LINK_CHAT_ID = getInitialDeepLinkChatId();
if (INITIAL_DEEP_LINK_CHAT_ID) {
  void import("./components/MessagesView");
}

// Lazy-loaded Views for splitting and fast initial page load
const HomeView = React.lazy(() => import("./components/HomeView"));
const SearchView = React.lazy(() => import("./components/SearchView"));
const MessagesView = React.lazy(() => import("./components/MessagesView"));
const SessionsView = React.lazy(() => import("./components/SessionsView"));
const ProfileView = React.lazy(() => import("./components/ProfileView"));
const ProfileSetup = React.lazy(() => import("./components/ProfileSetup"));
const SkillBattleHub = React.lazy(() =>
  import("./components/battles/SkillBattleHub").then((m) => ({ default: m.SkillBattleHub }))
);

// Background preloader for lazy-loaded views to ensure instant switches
const preloadViews = () => {
  try {
    import("./components/HomeView");
    import("./components/SearchView");
    import("./components/MessagesView");
    import("./components/SessionsView");
    import("./components/ProfileView");
    import("./components/battles/SkillBattleHub");
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
    profilesCache,
    setProfileInCache,
    refreshFeed,
    refreshSessions,
    fetchProfile,
    showLogoutConfirm,
    setShowLogoutConfirm,
    showDeleteConfirm,
    setShowDeleteConfirm
  } = useApp();

  // App lifecycle states (skip Splash delay immediately when launched directly from a chat notification)
  const [isSplashFinished, setIsSplashFinished] = useState(() => Boolean(INITIAL_DEEP_LINK_CHAT_ID));
  const [isOnboardingFinished, setIsOnboardingFinished] = useState(() => {
    return safeLocalStorage.getItem("swap_onboarding_finished") === "true";
  });
  
  const [userProfileExists, setUserProfileExists] = useState<boolean | null>(null);
  const [loadingProfileCheck, setLoadingProfileCheck] = useState(false);

  // Platform navigation
  const [currentTab, setCurrentTab] = useState<TabType>(() =>
    INITIAL_DEEP_LINK_CHAT_ID ? "messages" : "home"
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(() => INITIAL_DEEP_LINK_CHAT_ID);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(() => Boolean(INITIAL_DEEP_LINK_CHAT_ID));
  const [pendingBattleId, setPendingBattleId] = useState<string | null>(null);
  const [visitedTabs, setVisitedTabs] = useState<Set<TabType>>(() =>
    INITIAL_DEEP_LINK_CHAT_ID ? new Set(["messages"]) : new Set(["home"])
  );

  useEffect(() => {
    if (INITIAL_DEEP_LINK_CHAT_ID) {
      activeChatTrackingService.setTab("messages");
      activeChatTrackingService.setActiveChat({ chatId: INITIAL_DEEP_LINK_CHAT_ID });
      navigationManager.resetTo({
        tab: "messages",
        selectedUserId: null,
        activeChatId: INITIAL_DEEP_LINK_CHAT_ID,
      });
      // Clean URL parameter without reloading so future manual refreshes behave normally
      if (typeof window !== "undefined" && window.history?.replaceState) {
        try {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("chatId");
          window.history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
        } catch {}
      }
    }
  }, []);

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
    activeChatTrackingService.setTab(selectedUserId ? "profile" : currentTab);
  }, [currentTab, selectedUserId]);

  useEffect(() => {
    const unsubscribe = navigationManager.onStateChange((state) => {
      setCurrentTab(state.tab);
      setSelectedUserId(state.selectedUserId || null);
      setActiveChatId(state.activeChatId || null);
      setIsChatOpen(Boolean(state.activeChatId));
      activeChatTrackingService.setTab(state.selectedUserId ? "profile" : state.tab);
      if (!state.activeChatId) {
        activeChatTrackingService.setActiveChat(null);
      }
    });
    return unsubscribe;
  }, []);

  const handleNavigateTab = useCallback((tab: TabType) => {
    setSelectedUserId(null);
    setCurrentTab(tab);
    setIsChatOpen(false);
    setActiveChatId(null);
    activeChatTrackingService.setActiveChat(null);
    activeChatTrackingService.setTab(tab);
    navigationManager.pushState({
      tab,
      selectedUserId: null,
      activeChatId: null,
    });
  }, []);

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
    if (!chatId) return;
    void import("./components/MessagesView");
    setIsSplashFinished(true);
    setSelectedUserId(null);
    setVisitedTabs((prev) => {
      if (prev.has("messages")) return prev;
      const next = new Set(prev);
      next.add("messages");
      return next;
    });
    setCurrentTab("messages");
    setIsChatOpen(true);
    setActiveChatId(chatId);
    activeChatTrackingService.setTab("messages");
    activeChatTrackingService.setActiveChat({ chatId });
    if (Capacitor.isNativePlatform()) {
      void mobileForegroundService.clearChatNotifHistory(chatId);
    }
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
      if (Capacitor.isNativePlatform()) {
        void mobileForegroundService.clearChatNotifHistory(chatId);
      }
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

  // Global Content & Image Copy/Drag Protection (0 quota impact, preserves editable inputs)
  useEffect(() => {
    const isEditableOrAllowed = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(
          'input, textarea, [contenteditable="true"], [data-allow-copy="true"]'
        )
      );
    };

    const handleDragStart = (e: DragEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLImageElement ||
        target instanceof HTMLAnchorElement ||
        target instanceof SVGElement ||
        !isEditableOrAllowed(target)
      ) {
        e.preventDefault();
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement) {
        e.preventDefault();
        return;
      }
      if (!isEditableOrAllowed(target)) {
        e.preventDefault();
      }
    };

    const handleSelectStart = (e: Event) => {
      if (!isEditableOrAllowed(e.target)) {
        e.preventDefault();
      }
    };

    const handleCopyOrCut = (e: ClipboardEvent) => {
      if (!isEditableOrAllowed(e.target) && !isEditableOrAllowed(document.activeElement)) {
        e.preventDefault();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      // Always block page save / view-source / print scraping shortcuts
      if (key === "s" || key === "u" || key === "p") {
        e.preventDefault();
        return;
      }

      // Block Ctrl+C / Ctrl+X / Ctrl+A outside actual text inputs or explicit copy zones
      if (key === "c" || key === "x" || key === "a") {
        if (!isEditableOrAllowed(e.target) && !isEditableOrAllowed(document.activeElement)) {
          e.preventDefault();
        }
      }
    };

    document.addEventListener("dragstart", handleDragStart, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("selectstart", handleSelectStart, true);
    document.addEventListener("copy", handleCopyOrCut, true);
    document.addEventListener("cut", handleCopyOrCut, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("dragstart", handleDragStart, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("selectstart", handleSelectStart, true);
      document.removeEventListener("copy", handleCopyOrCut, true);
      document.removeEventListener("cut", handleCopyOrCut, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
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
    isLiveSwap?: boolean;
  } | null>(null);

  const activeAcceptedCallRef = useRef(activeAcceptedCall);
  activeAcceptedCallRef.current = activeAcceptedCall;

  // Post-Session Summary (Paused / Completed + Rating) & Verified Certificate Modals
  const [postSessionOutcome, setPostSessionOutcome] = useState<PostSessionOutcomeMeta | null>(null);
  const [postSessionCert, setPostSessionCert] = useState<Session | null>(null);
  const pauseSessionSkipDismissRef = useRef<string | null>(null);

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
  useBackHandler(Boolean(postSessionOutcome), () => {
    setPostSessionOutcome(null);
  });
  useBackHandler(Boolean(postSessionCert), () => {
    setPostSessionCert(null);
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
      if (!targetCallId || callSignalingService.isCallTerminated(targetCallId)) {
        stopAllCallSounds();
        setIncomingCall(null);
        return;
      }

      console.log(`[CALL_NATIVE_ACCEPT] callId=${targetCallId} sessionId=${targetSessionId}`);
      console.log(`[CALL_ATTACH] callId=${targetCallId} sessionId=${targetSessionId}`);

      callSignalingService.markCallAccepted(targetCallId);
      callSignalingService.registerActiveCall(targetSessionId, targetCallId);

      setIsSplashFinished(true);
      stopAllCallSounds();
      setIncomingCall(null);

      const isLiveSwap = Boolean(
        targetSessionId &&
        !targetSessionId.startsWith("chat_") &&
        callInfo.skillName !== "Chat Call"
      );

      setActiveAcceptedCall({
        sessionId: targetSessionId,
        partnerName: callInfo.callerName || "Swap Partner",
        partnerPhoto: callInfo.callerPhoto,
        partnerUid: callInfo.callerId || "",
        skillName: callInfo.skillName || (isLiveSwap ? "Live Swap Call" : "Chat Call"),
        incomingCallId: targetCallId,
        isCaller: false,
        initialCallType: callInfo.callType || "video",
        conversationId: callInfo.conversationId,
        isLiveSwap,
      });

      callSignalingService
        .acceptCall(targetCallId)
        .then((res) => {
          if (!res.accepted) {
            console.log(`[App] Aborting direct-accepted call ${targetCallId}: caller already terminated (${res.status})`);
            stopAllCallSounds();
            callSignalingService.markCallTerminated(targetCallId, targetSessionId);
            callSignalingService.resetCallState(targetCallId);
            activeCallSessionService.endActiveCallExplicitly("Call was cancelled by caller", targetCallId);
            mobileForegroundService.stopCallForegroundService(targetCallId).catch(() => {});
            setActiveAcceptedCall((curr) =>
              curr && (curr.incomingCallId === targetCallId || curr.sessionId === targetCallId) ? null : curr
            );
          }
        })
        .catch(() => {});

      if (Capacitor.isNativePlatform()) {
        mobileForegroundService.clearPendingAcceptedCall().catch(() => {});
      }

      // Hydrate any missing caller details from Firestore call doc in background
      if (!callInfo.callerId || !callInfo.callerName || !callInfo.callerPhoto || !callInfo.sessionId) {
        callSignalingService.getCall(targetCallId).then((callData) => {
          if (callData) {
            const st = (callData.status || "") as string;
            if (st === "ended" || st === "cancelled" || st === "rejected" || st === "missed") {
              stopAllCallSounds();
              callSignalingService.markCallTerminated(targetCallId, targetSessionId);
              callSignalingService.resetCallState(targetCallId);
              activeCallSessionService.endActiveCallExplicitly("Call was cancelled by caller", targetCallId);
              mobileForegroundService.stopCallForegroundService(targetCallId).catch(() => {});
              setActiveAcceptedCall((curr) =>
                curr && (curr.incomingCallId === targetCallId || curr.sessionId === targetCallId) ? null : curr
              );
              return;
            }
            setActiveAcceptedCall((prev) => {
              if (!prev || prev.incomingCallId !== targetCallId) return prev;
              const resolvedSessionId = prev.sessionId || callData.sessionId || targetCallId;
              const resolvedIsLiveSwap = prev.isLiveSwap ?? Boolean(resolvedSessionId && !resolvedSessionId.startsWith("chat_") && callData.skillName !== "Chat Call");
              return {
                ...prev,
                sessionId: resolvedSessionId,
                partnerName: (!prev.partnerName || prev.partnerName === "Swap Partner") ? (callData.callerName || "Swap Partner") : prev.partnerName,
                partnerPhoto: prev.partnerPhoto || callData.callerPhoto,
                partnerUid: prev.partnerUid || callData.callerId || "",
                skillName: prev.skillName || callData.skillName || (resolvedIsLiveSwap ? "Live Swap Call" : "Chat Call"),
                conversationId: prev.conversationId || callData.conversationId,
                initialCallType: prev.initialCallType || callData.callType || "video",
                isLiveSwap: resolvedIsLiveSwap,
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
        handleNavigateTab("sessions");
      } else if (route.type === "chat" && route.chatId) {
        setSelectedUserId(null);
        handleOpenChatRoom(route.chatId);
      }
    });

    // Check for pending pre-accepted call and direct notification chat launches on Android
    const cleanupNativeBridges: (() => void)[] = [];
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

      // Direct-to-chat open fallback (guarantees opening inside exact chat on cold/warm native notification tap)
      mobileForegroundService.getPendingChatOpen().then((pendingChatId) => {
        if (pendingChatId) {
          handleOpenChatRoom(pendingChatId);
        }
      }).catch(() => {});

      cleanupNativeBridges.push(
        mobileForegroundService.onChatOpenedNatively((chatId) => {
          handleOpenChatRoom(chatId);
        }),
        mobileForegroundService.onChatMutedNatively((chatId) => {
          if (chatId) muteChat(chatId);
        })
      );
    }

    // Listen for Service Worker background notification clicks, inline replies, and actions
    let swCleanup: (() => void) | undefined;
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      const handleMessage = (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || !msg.type) return;

        if (msg.type === "NAVIGATE_LIVE_SESSION" || msg.type === "NAVIGATE_SESSION") {
          setIsSplashFinished(true);
          setSelectedUserId(null);
          setCurrentTab("sessions");
        } else if (msg.type === "NAVIGATE_NOTIFICATION") {
          if (msg.chatId) {
            handleOpenChatRoom(msg.chatId);
          } else if (msg.callId) {
            mobileDeepLinkService.processDeepLinkUrl(
              `swapskill://call/${msg.callId}?sessionId=${msg.sessionId || ""}${msg.autoAccept ? "&autoAccept=true" : ""}`
            );
          } else if (msg.sessionId) {
            setIsSplashFinished(true);
            setSelectedUserId(null);
            setCurrentTab("sessions");
          }
        } else if (msg.type === "MUTE_CHAT" && msg.chatId) {
          muteChat(msg.chatId);
        } else if (msg.type === "MARK_CHAT_READ" && msg.chatId) {
          window.dispatchEvent(
            new CustomEvent("swapskill_chat_marked_read", { detail: { chatId: msg.chatId } })
          );
        } else if (msg.type === "MESSAGE_REPLIED" && msg.chatId && msg.text) {
          window.dispatchEvent(
            new CustomEvent("swapskill_message_replied", {
              detail: {
                chatId: msg.chatId,
                messageId: msg.messageId,
                text: msg.text,
              },
            })
          );
        } else if (msg.type === "CHAT_PUSH_RECEIVED" && msg.push?.chatId) {
          window.dispatchEvent(
            new CustomEvent("swapskill_sync_message_from_push", { detail: msg.push })
          );
        } else if (msg.type === "CALL_CANCELLED_PUSH" && msg.callId) {
          callSignalingService.markCallTerminated(msg.callId);
          window.dispatchEvent(
            new CustomEvent("swapskill_call_cancelled_notif", { detail: { callId: msg.callId } })
          );
        }
      };
      navigator.serviceWorker.addEventListener("message", handleMessage);
      swCleanup = () => navigator.serviceWorker.removeEventListener("message", handleMessage);
    }

    return () => {
      cleanupNativeBridges.forEach((fn) => fn());
      swCleanup?.();
    };
  }, [handleOpenChatRoom]);

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
      const dismissedAt = Number(safeLocalStorage.getItem("swap_permissions_dismissed_at") || 0);
      const canShowReminderPrompt = !dismissedAt || Date.now() - dismissedAt > 24 * 60 * 60 * 1000;
      if (Notification.permission === "default" && canShowReminderPrompt) {
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
    if (!hasUpcoming) return;
    const interval = setInterval(runAlarmSync, 30000);
    return () => clearInterval(interval);
  }, [sessions, firebaseUser]);

  // Prompt for App Permissions (Camera, Mic, Push Alerts) on login when browser permission is still unset
  useEffect(() => {
    if (!firebaseUser || loadingAuth) return;
    if (typeof window !== "undefined") {
      const dismissedAt = Number(safeLocalStorage.getItem("swap_permissions_dismissed_at") || 0);
      const inCooldown = dismissedAt > 0 && Date.now() - dismissedAt < 24 * 60 * 60 * 1000;
      const needsPrompt = "Notification" in window && Notification.permission === "default";
      if (!inCooldown && needsPrompt) {
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

      // Sync push status if permission is already granted (never request Web Notification permission without a user gesture)
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        safeLocalStorage.setItem("swap_push_notifications_enabled", "true");
        window.dispatchEvent(new CustomEvent("swap_push_status_changed", { detail: { enabled: true } }));
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
      const activeUid = firebaseUser?.uid || auth.currentUser?.uid || "";
      const notifTs = detail?.timestamp ? Number(detail.timestamp) : 0;

      if (!callId || !activeUid) return;
      if (detail?.receiverId && detail.receiverId !== activeUid) {
        console.log("[App] Suppressing incoming call notification for different user:", callId);
        return;
      }
      if (detail?.callerId && detail.callerId === activeUid) {
        console.log("[App] Suppressing incoming call notification where caller is self:", callId);
        return;
      }
      if (notifTs > 0 && Date.now() - notifTs > 45000) {
        console.log("[App] Suppressing expired incoming call notification:", callId);
        return;
      }
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

      const detailTs = Number(detail.timestamp || 0);
      if (detailTs > 0 && Date.now() - detailTs > 40000) {
        console.log("[App] Suppressing stale incoming call notification:", callId);
        callSignalingService.markCallTerminated(callId, detail.sessionId || undefined);
        stopAllCallSounds();
        return;
      }

      console.log(`[TIMING] INCOMING_UI_SHOWN: (via notification) callId=${callId} t=${Date.now()}`);
      console.log("[App] Incoming call received via notification event:", detail);

      // Instant 0ms UI Display (FAANG quality, zero delay):
      // Populate incoming call dialog immediately from push notification detail payload
      const immediateCallData: any = {
        id: callId,
        callId: callId,
        sessionId: detail.sessionId || "",
        conversationId: detail.conversationId || "",
        callerId: detail.callerId || "",
        receiverId: detail.receiverId || activeUid,
        callerName: detail.callerName || detail.title || "Skill Swap Partner",
        callerPhoto: detail.callerPhoto || "",
        callType: detail.callType || "video",
        skillName: detail.skillName || "",
        status: "calling",
        createdAt: new Date().toISOString(),
      };
      setIncomingCall(immediateCallData);

      // Verify asynchronously in background without blocking incoming call presentation
      callSignalingService.getCall(callId).then((callData) => {
        const rawCreatedAt = callData?.createdAt as any;
        const callCreatedMs =
          typeof (callData as any)?.createdTimestamp === "number" && (callData as any).createdTimestamp > 0
            ? (callData as any).createdTimestamp
            : rawCreatedAt?.toMillis
            ? rawCreatedAt.toMillis()
            : rawCreatedAt?.seconds
            ? rawCreatedAt.seconds * 1000
            : 0;
        const st = (callData?.status || "") as string;
        const isTerminal =
          !callData ||
          st === "ended" ||
          st === "cancelled" ||
          st === "rejected" ||
          st === "missed";
        const isAcceptedOrLive =
          st === "accepting" ||
          st === "connecting" ||
          st === "connected" ||
          st === "in_call";
        const isWrongReceiver = Boolean(callData?.receiverId && callData.receiverId !== activeUid);
        const isStale = callCreatedMs > 0 && Date.now() - callCreatedMs > 45000 && !isAcceptedOrLive;

        if (isTerminal || isWrongReceiver || isStale) {
          console.log("[App] Background check: Call is invalid/expired/inactive, dismissing UI:", callId);
          callSignalingService.markCallTerminated(callId, detail.sessionId || undefined);
          setIncomingCall((curr) => (curr && (curr.id === callId || (curr as any).callId === callId) ? null : curr));
          setActiveAcceptedCall((curr) => (curr && (curr.incomingCallId === callId || curr.sessionId === callId) ? null : curr));
          stopAllCallSounds();
          mobileForegroundService.stopCallForegroundService(callId).catch(() => {});
          return;
        }
        // If call is already accepted/live on this device, leave active call untouched and clear ringing prompt
        if (isAcceptedOrLive || callSignalingService.isCallAccepted(callId)) {
          setIncomingCall((curr) => (curr && (curr.id === callId || (curr as any).callId === callId) ? null : curr));
          return;
        }
        // Authoritatively merge full doc data if still active
        setIncomingCall((curr) => {
          if (curr && (curr.id === callId || (curr as any).callId === callId)) {
            return { ...curr, ...callData };
          }
          return curr;
        });
      }).catch(() => {});
    };

    const handleNotifCancel = (e: any) => {
      const callId = e.detail?.callId || e.detail?.id;
      if (callId) {
        console.log("[App] Incoming call cancelled via notification event:", callId);
        // Always blacklist this callId immediately even if React state hasn't mounted the prompt yet
        callSignalingService.markCallTerminated(callId);
        stopAllCallSounds();
        mobileForegroundService.stopCallForegroundService(callId).catch(() => {});
        setIncomingCall((curr) => {
          if (curr && (curr.id === callId || (curr as any).callId === callId)) {
            callSignalingService.resetCallState(callId);
            activeCallSessionService.endActiveCallExplicitly("Notification cancel event", callId);
            return null;
          }
          return curr;
        });
        setActiveAcceptedCall((curr) => {
          if (curr && (curr.incomingCallId === callId || curr.sessionId === callId)) {
            callSignalingService.resetCallState(callId);
            activeCallSessionService.endActiveCallExplicitly("Notification cancel event", callId);
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
  }, [currentUserProfile, firebaseUser]);

  // Real-time Incoming Live Swap Calls Listener via Firestore
  useEffect(() => {
    const effectiveUid = firebaseUser?.uid || auth.currentUser?.uid;
    stopAllCallSounds();
    setIncomingCall(null);

    if (!effectiveUid) {
      setActiveAcceptedCall(null);
      callSignalingService.resetCallState();
      return;
    }

    const unsubCalls = callSignalingService.listenToIncomingCalls(
      effectiveUid,
      (call) => {
        const activeCallId = callSignalingService.getActiveCallId();
        const effectiveCallId = call.id || (call as any).callId;
        if (
          activeAcceptedCallRef.current ||
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
          console.log("[App] Incoming call is already accepted/connecting, auto-attaching call modal:", effectiveCallId);
          setIsSplashFinished(true);
          stopAllCallSounds();
          setIncomingCall(null);

          const isLiveSwap = Boolean(
            call.sessionId &&
            !call.sessionId.startsWith("chat_") &&
            call.skillName !== "Chat Call"
          );

          setActiveAcceptedCall({
            sessionId: call.sessionId || effectiveCallId,
            partnerName: call.callerName || "Swap Partner",
            partnerPhoto: call.callerPhoto,
            partnerUid: call.callerId || "",
            skillName: call.skillName || (isLiveSwap ? "Live Swap Call" : "Chat Call"),
            incomingCallId: effectiveCallId,
            isCaller: false,
            initialCallType: call.callType || "video",
            conversationId: call.conversationId,
            isLiveSwap,
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
            callSignalingService.resetCallState(cancelledCallId);
            activeCallSessionService.endActiveCallExplicitly("Incoming call cancelled by caller", cancelledCallId);
            mobileForegroundService.stopCallForegroundService(cancelledCallId).catch(() => {});
            return null;
          }
          return curr;
        });
        setActiveAcceptedCall((curr) => {
          if (curr && (curr.incomingCallId === cancelledCallId || curr.sessionId === cancelledCallId)) {
            stopAllCallSounds();
            callSignalingService.resetCallState(cancelledCallId);
            activeCallSessionService.endActiveCallExplicitly("Incoming call cancelled by caller", cancelledCallId);
            mobileForegroundService.stopCallForegroundService(cancelledCallId).catch(() => {});
            return null;
          }
          return curr;
        });
      }
    );

    return () => {
      unsubCalls();
    };
  }, [firebaseUser?.uid, auth.currentUser?.uid]);

  const handleAcceptIncomingCall = useCallback((call: CallSignalingData) => {
    const targetCallId = call.id || (call as any).callId;
    if (!targetCallId || callSignalingService.isCallTerminated(targetCallId)) {
      stopAllCallSounds();
      setIncomingCall(null);
      return;
    }
    console.log(`[TIMING] T6_CALLEE_ANSWERED: callId=${targetCallId}`);
    stopAllCallSounds();
    setIncomingCall(null);
    const targetSessionId = call.sessionId || targetCallId;

    const isLiveSwap = Boolean(
      call.sessionId &&
      !call.sessionId.startsWith("chat_") &&
      call.skillName !== "Chat Call"
    );

    setActiveAcceptedCall({
      sessionId: targetSessionId,
      partnerName: call.callerName || "Swap Partner",
      partnerPhoto: call.callerPhoto,
      partnerUid: call.callerId,
      skillName: call.skillName || (isLiveSwap ? "Live Swap Call" : "Chat Call"),
      incomingCallId: targetCallId,
      isCaller: false,
      initialCallType: call.callType || "video",
      conversationId: call.conversationId,
      isLiveSwap,
    });

    // Validate atomically via Firestore transaction: if caller already cancelled, abort immediately so callee never gets stuck on Connecting
    callSignalingService
      .acceptCall(targetCallId)
      .then((res) => {
        if (!res.accepted) {
          console.log(`[App] Aborting accepted call ${targetCallId}: caller already terminated (${res.status})`);
          stopAllCallSounds();
          callSignalingService.markCallTerminated(targetCallId, targetSessionId);
          callSignalingService.resetCallState(targetCallId);
          activeCallSessionService.endActiveCallExplicitly("Call was cancelled by caller", targetCallId);
          mobileForegroundService.stopCallForegroundService(targetCallId).catch(() => {});
          setActiveAcceptedCall((curr) =>
            curr && (curr.incomingCallId === targetCallId || curr.sessionId === targetCallId) ? null : curr
          );
          setIncomingCall((curr) =>
            curr && (curr.id === targetCallId || (curr as any).callId === targetCallId) ? null : curr
          );
        }
      })
      .catch(() => {});
  }, []);

  const handleCallerCancelledIncomingCall = useCallback((call: CallSignalingData) => {
    const targetCallId = call.id || (call as any).callId;
    stopAllCallSounds();
    setIncomingCall(null);
    if (targetCallId) {
      callSignalingService.markCallTerminated(targetCallId, call.sessionId);
    }
    callSignalingService.resetCallState(targetCallId);
    activeCallSessionService.endActiveCallExplicitly("Call cancelled by caller", targetCallId);
    mobileForegroundService.stopCallForegroundService(targetCallId).catch(() => {});
  }, []);

  const handleDeclineIncomingCall = useCallback((call: CallSignalingData) => {
    const targetCallId = call.id || (call as any).callId;
    setIncomingCall(null);
    stopAllCallSounds();
    if (targetCallId) {
      callSignalingService.markCallTerminated(targetCallId, call.sessionId);
    }
    if (call.sessionId) {
      callSignalingService.terminateSession(call.sessionId, targetCallId, "User declined the call");
    }
    if (targetCallId) {
      callSignalingService.rejectCall(targetCallId, "User declined the call", call.sessionId, call.callerId);
    }
    callSignalingService.resetCallState(targetCallId);
    activeCallSessionService.endActiveCallExplicitly("User declined the call", targetCallId);
    mobileForegroundService.stopCallForegroundService(targetCallId).catch(() => {});

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
    let partnerId = partnerUser?.id || partnerUser?.uid || "";
    const currentUid = firebaseUser?.uid || auth.currentUser?.uid || "";
    if (!partnerId && conversationId) {
      partnerId = getOtherParticipantId({ id: conversationId }, currentUid) || "";
    }
    const partnerName = partnerUser?.name || partnerUser?.fullName || "Partner";
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
      isLiveSwap: false,
    });
  }, [firebaseUser?.uid]);

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
    // If incomingCallId is provided or isCaller is false, user is callee answering/joining
    // Otherwise user is initiating as caller and will create WebRTC offer
    const isCaller = callConfig.isCaller !== undefined ? callConfig.isCaller : (!callConfig.incomingCallId);
    const targetIncomingCallId = isCaller ? undefined : callConfig.incomingCallId;

    setActiveAcceptedCall({
      sessionId: callConfig.sessionId,
      partnerName: callConfig.partnerName,
      partnerPhoto: callConfig.partnerPhoto,
      partnerUid: callConfig.partnerUid,
      skillName: callConfig.skillName || "Live Swap Call",
      isCaller,
      initialCallType: callConfig.initialCallType || "video",
      incomingCallId: targetIncomingCallId,
      conversationId: callConfig.conversationId,
      sessionDuration: callConfig.sessionDuration,
      scheduledTime: callConfig.scheduledTime,
      sessionEndTime: callConfig.sessionEndTime,
      isLiveSwap: true,
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

  // Warm up primary tab views & WebRTC ICE/TURN servers on auth (0 Firestore quota)
  useEffect(() => {
    if (firebaseUser?.uid) {
      const preloadTimer = setTimeout(() => {
        import("./components/ProfileView");
        import("./components/SearchView");
        import("./components/MessagesView");
        import("./components/SessionsView");
        import("./components/SettingsView");
        WebRTCService.fetchIceServers().catch(() => {});
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
                { id: "battles", label: "Skill Battles", icon: <Swords className="w-[18px] h-[18px]" strokeWidth={1.8} />, badge: 0 },
                { id: "profile", label: "Profile", icon: <User className="w-[18px] h-[18px]" strokeWidth={1.8} />, badge: 0 }
              ].map((item) => {
                const isActive = !selectedUserId ? currentTab === item.id : currentTab === item.id;
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
                  handleNavigateTab("sessions");
                }}
                onViewSession={(session) => {
                  handleNavigateTab("sessions");
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
                  className="absolute inset-0 z-20 bg-theme-bg text-theme-text flex flex-col h-full overflow-hidden w-full"
                >
                  <PullToRefresh
                    onRefresh={() => fetchProfile(selectedUserId, true)}
                    className="flex-1 flex flex-col min-h-0 overflow-y-auto w-full mobile-scroll"
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
                  </PullToRefresh>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 2. Main Tabs - Native Keep-Alive (Zero Flashing, Instant 0ms Tab Switching) */}
            <div className="flex-1 flex flex-col min-h-0 relative w-full h-full">
              {visitedTabs.has("home") && (
                <PullToRefresh
                  onRefresh={() => refreshFeed(true)}
                  className={`flex-1 flex-col min-h-0 overflow-y-auto w-full pb-6 mobile-scroll ${
                    !selectedUserId && currentTab === "home" ? "flex" : "hidden"
                  }`}
                >
                  <Suspense fallback={<SkeletonLoader type="feed" />}>
                    <HomeView
                      currentUserId={firebaseUser.uid}
                      onSelectUser={handleSelectUser}
                      onNavigateToTab={handleNavigateTab}
                      onOpenBattle={(battleId) => {
                        setPendingBattleId(battleId || null);
                        handleNavigateTab("battles");
                      }}
                    />
                  </Suspense>
                </PullToRefresh>
              )}

              {visitedTabs.has("search") && (
                <PullToRefresh
                  onRefresh={() => refreshFeed(true)}
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
                </PullToRefresh>
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
                <PullToRefresh
                  onRefresh={refreshSessions}
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
                </PullToRefresh>
              )}

              {visitedTabs.has("battles") && (
                <div
                  className={`flex-1 flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-hidden w-full pb-6 mobile-scroll ${
                    !selectedUserId && currentTab === "battles" ? "flex" : "hidden"
                  }`}
                >
                  <Suspense fallback={<SkeletonLoader type="feed" />}>
                    <SkillBattleHub
                      currentUser={{
                        uid: firebaseUser.uid,
                        email: firebaseUser.email || undefined,
                        fullName:
                          currentUserProfile?.fullName ||
                          firebaseUser.displayName ||
                          "SwapSkill Member",
                        username: currentUserProfile?.username,
                        photoUrl:
                          currentUserProfile?.profilePhotoUrl ||
                          currentUserProfile?.photoUrl ||
                          firebaseUser.photoURL ||
                          "",
                        verified: Boolean(currentUserProfile?.verified),
                      }}
                      initialBattleId={pendingBattleId}
                      onClearInitialBattle={() => setPendingBattleId(null)}
                      onViewProfile={handleSelectUser}
                    />
                  </Suspense>
                </div>
              )}

              {visitedTabs.has("profile") && (
                <PullToRefresh
                  onRefresh={() => fetchProfile(firebaseUser.uid, true)}
                  className={`flex-1 flex-col min-h-0 overflow-y-auto w-full pb-6 mobile-scroll ${
                    !selectedUserId && currentTab === "profile" ? "flex" : "hidden"
                  }`}
                >
                  <Suspense fallback={<SkeletonLoader type="profile" />}>
                    <ProfileView
                      currentUserId={firebaseUser.uid}
                      selectedUserId={firebaseUser.uid}
                      onNavigateToTab={handleNavigateTab}
                      onOpenChat={handleOpenChatRoom}
                      onLogOutComplete={() => {}}
                      onSelectUser={handleSelectUser}
                    />
                  </Suspense>
                </PullToRefresh>
              )}
            </div>
          </div>
          
          {/* Navigation bottom bar kept mounted on mobile so fixed chat window overlays seamlessly without flex height jumps */}
          <div
            className={`md:hidden shrink-0 w-full relative z-20 ${isMobileChatActive ? "pointer-events-none" : ""}`}
            aria-hidden={isMobileChatActive}
          >
            <Navigation
              activeTab={currentTab}
              onChangeTab={(tab) => {
                handleNavigateTab(tab);
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
    <div className="h-full h-[100dvh] w-full max-w-full flex flex-col bg-theme-bg text-theme-text relative select-none overflow-hidden">
      {renderFlow()}

      {/* Global In-App Interactive Message Notification with Mark as Read & Reply */}
      <InAppMessageNotification />

      {/* 10-Minute Alarm Notification Modal */}
      <SessionAlarmReminderModal
        alarm={activeAlarm}
        onClose={() => setActiveAlarm(null)}
        onJoinSession={(session) => {
          handleNavigateTab("sessions");
        }}
      />

      {/* Notification & Call Permission Explanation Dialog */}
      <NotificationPermissionExplainModal
        isOpen={showPermissionPrompt}
        onGrant={async () => {
          soundService.unlockAudio();
          safeLocalStorage.setItem("swap_permissions_prompted", "true");
          safeLocalStorage.setItem("swap_notif_prompted", "true");
          safeLocalStorage.removeItem("swap_permissions_dismissed_at");
          setShowPermissionPrompt(false);
          const effectiveUid = firebaseUser?.uid || auth.currentUser?.uid;
          // Request notification permission FIRST while still inside the active user tap gesture
          if (effectiveUid) {
            const granted = await pushNotificationService.requestPermissionAndRegister(effectiveUid);
            if (granted) {
              safeLocalStorage.setItem("swap_push_notifications_enabled", "true");
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("swap_push_status_changed", { detail: { enabled: true } }));
              }
            }
          } else {
            await requestAlarmNotificationPermission();
          }
          try {
            const streamRes = await mobilePermissionService.acquireCallMediaStream({ video: true, audio: true });
            if (streamRes.stream) {
              mobilePermissionService.releaseActiveStream();
            }
          } catch (_) {}
        }}
        onDismiss={() => {
          safeLocalStorage.setItem("swap_permissions_dismissed_at", String(Date.now()));
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
        !callSignalingService.isCallAccepted(incomingCall.id || (incomingCall as any).callId) &&
        !callSignalingService.isCallTerminated(incomingCall.id || (incomingCall as any).callId) && (
        <IncomingCallPrompt
          call={incomingCall}
          onAccept={handleAcceptIncomingCall}
          onDecline={handleDeclineIncomingCall}
          onCallerCancelled={handleCallerCancelledIncomingCall}
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

            const isSwapMeeting = Boolean(
              activeAcceptedCall.isLiveSwap ||
              (activeAcceptedCall.sessionId &&
                !activeAcceptedCall.sessionId.startsWith("chat_") &&
                activeAcceptedCall.skillName !== "Chat Call")
            );

            if (isSwapMeeting) {
              const matchedSession = sessions.find((s) => s.id === activeAcceptedCall.sessionId);
              return (
                <LiveSwapCallModal
                  isOpen={true}
                  onClose={() => {
                    const targetCallId = activeAcceptedCall?.incomingCallId || activeAcceptedCall?.sessionId;
                    stopAllCallSounds();
                    callSignalingService.resetCallState(targetCallId);
                    activeCallSessionService.endActiveCallExplicitly("Live swap call closed", targetCallId);
                    mobileForegroundService.stopCallForegroundService(targetCallId).catch(() => {});
                    if (
                      activeAcceptedCall.sessionId &&
                      pauseSessionSkipDismissRef.current !== activeAcceptedCall.sessionId
                    ) {
                      setDismissedTopBanners((prev) => ({ ...prev, [activeAcceptedCall.sessionId]: true }));
                    }
                    pauseSessionSkipDismissRef.current = null;
                    setActiveAcceptedCall(null);
                    setIncomingCall(null);
                  }}
                  partnerName={activeAcceptedCall.partnerName}
                  partnerPhoto={activeAcceptedCall.partnerPhoto}
                  partnerUid={activeAcceptedCall.partnerUid || ""}
                  sessionId={activeAcceptedCall.sessionId}
                  conversationId={activeAcceptedCall.conversationId}
                  skillName={activeAcceptedCall.skillName || matchedSession?.skillName || matchedSession?.skill || "Live Swap Session"}
                  sessionDuration={activeAcceptedCall.sessionDuration ?? matchedSession?.duration ?? 30}
                  scheduledTime={activeAcceptedCall.scheduledTime ?? matchedSession?.scheduledTime}
                  sessionEndTime={activeAcceptedCall.sessionEndTime ?? matchedSession?.sessionEndTime}
                  currentUserId={effectiveUid || "current_user"}
                  currentUserName={currentUserProfile?.fullName || firebaseUser?.displayName || auth.currentUser?.displayName || "You"}
                  currentUserPhoto={getUserProfilePhoto(currentUserProfile, firebaseUser || auth.currentUser)}
                  incomingCallId={activeAcceptedCall.incomingCallId}
                  isCaller={activeAcceptedCall.isCaller ?? false}
                  initialCallType={activeAcceptedCall.initialCallType || "video"}
                  onSessionCompleted={(completedSessionId: string, outcome?: LiveSwapSessionOutcome) => {
                    const targetSessionId = completedSessionId || activeAcceptedCall.sessionId;
                    if (outcome?.mode === "pause" && targetSessionId) {
                      pauseSessionSkipDismissRef.current = targetSessionId;
                      setDismissedTopBanners((prev) => {
                        if (!prev[targetSessionId]) return prev;
                        const next = { ...prev };
                        delete next[targetSessionId];
                        return next;
                      });
                    }
                    setActiveAcceptedCall(null);
                    handleNavigateTab("sessions");
                    if (outcome) {
                      setPostSessionOutcome({
                        ...outcome,
                        sessionId: targetSessionId,
                      });
                    }
                  }}
                />
              );
            }

            return (
              <ChatCallModal
                isOpen={true}
                onClose={() => {
                  const targetCallId = activeAcceptedCall?.incomingCallId || activeAcceptedCall?.sessionId;
                  stopAllCallSounds();
                  callSignalingService.resetCallState(targetCallId);
                  activeCallSessionService.endActiveCallExplicitly("Call modal closed", targetCallId);
                  mobileForegroundService.stopCallForegroundService(targetCallId).catch(() => {});
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
                  // In-chat calls stay in current chat/messages view; never redirect to sessions
                }}
              />
            );
          })()}
        </Suspense>
      )}

      {/* Post-Session Summary (Paused Rejoin / Professional Rating & Certificate Unlock) */}
      <PostSessionSummaryModal
        isOpen={Boolean(postSessionOutcome)}
        outcome={postSessionOutcome}
        session={sessions.find((s) => s.id === postSessionOutcome?.sessionId) || null}
        currentUserId={firebaseUser?.uid || auth.currentUser?.uid || currentUserProfile?.uid || ""}
        currentUserProfile={currentUserProfile}
        profilesCache={profilesCache}
        onClose={() => setPostSessionOutcome(null)}
        onNavigateToSessions={() => handleNavigateTab("sessions")}
        onRejoinSession={() => {
          if (!postSessionOutcome) return;
          const matched = sessions.find((s) => s.id === postSessionOutcome.sessionId);
          const existingCallId = (matched as any)?.currentCallId || undefined;
          const targetSessionId = postSessionOutcome.sessionId;
          const partnerName = postSessionOutcome.partnerName;
          const partnerPhoto = postSessionOutcome.partnerPhoto;
          const partnerUid = postSessionOutcome.partnerUid;
          const skillName =
            postSessionOutcome.skillName || matched?.skillName || matched?.skill || "Live Swap Session";
          const sessionDuration = postSessionOutcome.sessionDuration ?? matched?.duration ?? 30;
          const scheduledTime = postSessionOutcome.scheduledTime ?? matched?.scheduledTime;
          const sessionEndTime = postSessionOutcome.sessionEndTime ?? matched?.sessionEndTime;

          setPostSessionOutcome(null);
          handleStartCallFromSession({
            sessionId: targetSessionId,
            partnerName,
            partnerPhoto,
            partnerUid,
            skillName,
            sessionDuration,
            scheduledTime,
            sessionEndTime,
            isCaller: !existingCallId,
            incomingCallId: existingCallId,
            initialCallType: "video",
          });
        }}
        onOpenCertificate={(certSession) => {
          setPostSessionOutcome(null);
          setPostSessionCert(certSession);
        }}
      />

      {/* Verified PDF Certificate Viewer Launched from Post-Session Summary */}
      <CertificateModal
        session={postSessionCert}
        currentUserId={firebaseUser?.uid || auth.currentUser?.uid || currentUserProfile?.uid || ""}
        profilesCache={profilesCache}
        currentUserProfile={currentUserProfile}
        onClose={() => setPostSessionCert(null)}
      />
    </div>
  );
}
