import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { 
  doc, 
  getDoc, 
  getDocFromCache,
  getDocs, 
  setDoc, 
  updateDoc,
  collection, 
  query, 
  where, 
  limit, 
  onSnapshot, 
  orderBy,
  runTransaction,
  addDoc,
  writeBatch,
  startAfter,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
  disableNetwork,
  enableNetwork,
  waitForPendingWrites
} from "firebase/firestore";
import { Capacitor } from "@capacitor/core";
import { auth, db } from "../firebase";
import { mobileLifecycleService } from "../services/mobile/lifecycle";
import { UserProfile, Chat, Session, Message } from "../types";
import { trackLoginSession } from "../utils/loginTracker";
import { safeLocalStorage } from "../utils/safeStorage";
import { 
  soundService, 
  SoundPreferences, 
  playNotificationSound, 
  playSessionRequestReceived, 
  playSessionAccepted, 
  playNewChatMessage 
} from "../utils/sound";
import { crossPlatformNotificationManager } from "../services/notificationAdapter";
import { activeChatTrackingService } from "../services/activeChatTrackingService";
import { isChatMuted } from "../utils/mutedChats";
import { 
  consolidateConversations, 
  getParticipantKeyFromChat, 
  getTimestampSeconds 
} from "../utils/conversationUtils";

export interface Notification {
  id: string;
  type: "follower" | "booking" | "review" | "chat" | "call" | "incoming_call";
  senderId: string;
  senderName: string;
  senderPhoto: string;
  referenceId: string;
  message: string;
  read: boolean;
  createdAt: any;
}

interface AppContextType {
  firebaseUser: User | null;
  currentUserProfile: UserProfile | null;
  loadingAuth: boolean;
  isOnline: boolean;
  discoveryUsers: UserProfile[];
  loadingDiscovery: boolean;
  chats: Chat[];
  loadingChats: boolean;
  sessions: Session[];
  notifications: Notification[];
  profilesCache: Record<string, UserProfile>;
  hasMoreFeed: boolean;
  loadMoreFeed: () => Promise<void>;
  
  // Sound & Notification Preferences
  soundPreferences: SoundPreferences;
  updateSoundPreferences: (partial: Partial<SoundPreferences>) => void;
  
  // Cache & Background update operations
  fetchProfile: (uid: string) => Promise<UserProfile | null>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
  toggleFollow: (targetUserId: string) => Promise<void>;
  bookSessionOptimistic: (sessionData: Omit<Session, "id" | "createdAt" | "status">) => Promise<Session>;
  
  // Force refreshes
  refreshFeed: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshChats: () => Promise<void>;
  setProfileInCache: (profile: UserProfile) => void;
  messagesCache: Record<string, any[]>;
  setMessagesInCache: (chatId: string, messages: any[]) => void;
  showLogoutConfirm: boolean;
  setShowLogoutConfirm: (show: boolean) => void;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (show: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_cache_user_profile");
      return saved ? JSON.parse(saved) : null;
    } catch (_) {
      return null;
    }
  });
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Sound and Haptic Preferences State
  const [soundPreferences, setSoundPreferences] = useState<SoundPreferences>(() => {
    return soundService.loadPreferences();
  });

  const updateSoundPreferences = useCallback((partial: Partial<SoundPreferences>) => {
    const updated = soundService.updatePreferences(partial);
    setSoundPreferences(updated);

    // Synchronize to Firestore user profile if logged in
    if (currentUserProfile?.uid) {
      const existingSettings = currentUserProfile.notificationSettings || {};
      const newSettings = { ...existingSettings, ...partial };
      setCurrentUserProfile(prev => prev ? { ...prev, notificationSettings: newSettings } : null);
      updateDoc(doc(db, "users", currentUserProfile.uid), {
        notificationSettings: newSettings
      }).catch(err => console.warn("Failed to sync sound settings to Firestore:", err));
    }
  }, [currentUserProfile?.uid]);

  // Synchronize Firestore userProfile sound preferences when loaded
  useEffect(() => {
    if (currentUserProfile?.notificationSettings) {
      const settings = currentUserProfile.notificationSettings;
      const partial: Partial<SoundPreferences> = {};
      if (typeof settings.notificationSounds === "boolean") partial.notificationSounds = settings.notificationSounds;
      if (typeof settings.callRingtone === "boolean") partial.callRingtone = settings.callRingtone;
      if (typeof settings.chatSounds === "boolean") partial.chatSounds = settings.chatSounds;
      if (typeof settings.sessionReminderSounds === "boolean") partial.sessionReminderSounds = settings.sessionReminderSounds;
      if (typeof settings.sessionStartSounds === "boolean") partial.sessionStartSounds = settings.sessionStartSounds;
      if (typeof settings.vibrationFeedback === "boolean") partial.vibrationFeedback = settings.vibrationFeedback;
      
      if (Object.keys(partial).length > 0) {
        const updated = soundService.updatePreferences(partial);
        setSoundPreferences(updated);
      }
    }
  }, [currentUserProfile?.uid]);
  
  // In-memory cache for profiles
  const [profilesCache, setProfilesCache] = useState<Record<string, UserProfile>>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_cache_profiles_map");
      return saved ? JSON.parse(saved) : {};
    } catch (_) {
      return {};
    }
  });

  const profilesCacheRef = useRef(profilesCache);
  useEffect(() => {
    profilesCacheRef.current = profilesCache;
  }, [profilesCache]);

  // In-memory and local storage cache for messages
  const [messagesCache, setMessagesCache] = useState<Record<string, any[]>>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_cache_messages_map");
      return saved ? JSON.parse(saved) : {};
    } catch (_) {
      return {};
    }
  });

  const setMessagesInCache = useCallback((chatId: string, messages: any[]) => {
    setMessagesCache((prev) => {
      // Keep only latest 25 messages per chat in local cache to respect storage constraints
      const limitedMessages = messages.slice(-25);
      const updated = { ...prev, [chatId]: limitedMessages };
      try {
        safeLocalStorage.setItem("swap_cache_messages_map", JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  }, []);
  
  // Lists
  const [discoveryUsers, setDiscoveryUsers] = useState<UserProfile[]>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_cache_discovery");
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });
  const [loadingDiscovery, setLoadingDiscovery] = useState<boolean>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_cache_discovery");
      return !saved || JSON.parse(saved).length === 0;
    } catch (_) {
      return true;
    }
  });
  
  const [chats, setChats] = useState<Chat[]>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_cache_chats");
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });
  const [loadingChats, setLoadingChats] = useState<boolean>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_cache_chats");
      return !saved || JSON.parse(saved).length === 0;
    } catch (_) {
      return true;
    }
  });
  
  const [sessions, setSessions] = useState<Session[]>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_cache_sessions");
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  const [notifications, setNotifications] = useState<Notification[]>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_cache_notifications");
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  // Track active real-time listeners for easy teardown
  const listenersRef = React.useRef<Array<() => void>>([]);
  const backgroundTimersRef = useRef<any[]>([]);

  // Throttle references for background and manual feed refreshes
  const lastFeedFetchRef = useRef<number>(0);
  const feedFetchPromiseRef = useRef<Promise<void> | null>(null);

  const lastSessionsFetchRef = useRef<number>(0);
  const sessionsFetchPromiseRef = useRef<Promise<void> | null>(null);

  const lastChatsFetchRef = useRef<number>(0);
  const chatsFetchPromiseRef = useRef<Promise<void> | null>(null);

  // Discovery pagination state
  const [hasMoreFeed, setHasMoreFeed] = useState(true);
  const lastFeedDocRef = useRef<any>(null);
  const inFlightFollowsRef = useRef<Set<string>>(new Set());

  const discoveryUsersRef = useRef<UserProfile[]>(discoveryUsers);
  useEffect(() => {
    discoveryUsersRef.current = discoveryUsers;
  }, [discoveryUsers]);

  const chatsRef = useRef<Chat[]>(chats);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  // 1a. Fast resume recovery for stalled Firestore WatchChange long-polling streams on Android Doze/Background
  // Uses local resume tokens (0 reads of unchanged docs) and guards offline writes with a short waitForPendingWrites race.
  const lastBackgroundAtRef = useRef<number>(0);
  const lastResumeReconnectRef = useRef<number>(0);
  useEffect(() => {
    const unsubLifecycle = mobileLifecycleService.addAppStateListener((isActive) => {
      const now = Date.now();
      if (!isActive) {
        lastBackgroundAtRef.current = now;
        return;
      }
      if (!auth.currentUser) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const sleptMs = lastBackgroundAtRef.current > 0 ? now - lastBackgroundAtRef.current : 0;
      if (sleptMs < 3500) return;
      if (now - lastResumeReconnectRef.current < 6000) return;
      lastResumeReconnectRef.current = now;

      void (async () => {
        try {
          await Promise.race([
            waitForPendingWrites(db).catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 700)),
          ]);
          await disableNetwork(db);
        } catch (_) {
          // ignore
        } finally {
          try {
            await enableNetwork(db);
          } catch (_) {}
        }
      })();
    });
    return () => unsubLifecycle();
  }, []);

  // 1. Sync online/offline status (Do NOT tear down active Firestore listeners on reconnect;
  // Firestore SDK auto-resumes incremental delta sync cleanly without re-reading collections)
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (firebaseUser && listenersRef.current.length === 0) {
        preloadData(firebaseUser.uid);
      }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [firebaseUser]);

  // 1b. Real-time User Presence Heartbeat (Active/Idle/Offline status sync)
  useEffect(() => {
    if (!firebaseUser?.uid) return;

    const uid = firebaseUser.uid;
    const presenceRef = doc(db, "userPresence", uid);

    let lastActivity = Date.now();
    const handleActivity = () => {
      lastActivity = Date.now();
    };

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("click", handleActivity);
    window.addEventListener("scroll", handleActivity);

    const updatePresence = async (status: "online" | "offline", force = false) => {
      const now = Date.now();
      // Quota protector: Only write to Firestore if status actually changed or at least 5 minutes elapsed
      if (!force && lastRecordedStatus === status && now - lastPresenceWriteTime < 300000) {
        return;
      }
      lastRecordedStatus = status;
      lastPresenceWriteTime = now;
      try {
        await setDoc(presenceRef, {
          id: uid,
          userId: uid,
          status,
          lastSeen: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Error updating presence:", err);
      }
    };

    let lastRecordedStatus: "online" | "offline" | null = null;
    let lastPresenceWriteTime = 0;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        updatePresence("offline");
      } else {
        updatePresence("online");
      }
    };

    const handleBeforeUnload = () => {
      updatePresence("offline", true);
    };

    const handleOnline = () => updatePresence("online");
    const handleOffline = () => updatePresence("offline");

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial online state - defer to background so startup render is immediate
    const presenceInitTimer = setTimeout(() => {
      updatePresence("online", true);
    }, 2000);

    // Heartbeat check every 2 minutes (only writes if state changed or 5 minutes passed)
    const interval = setInterval(() => {
      const idleTimeMins = (Date.now() - lastActivity) / 1000 / 60;
      if (document.visibilityState === "hidden" || idleTimeMins > 5) {
        updatePresence("offline");
      } else {
        updatePresence("online");
      }
    }, 120000);

    return () => {
      clearTimeout(presenceInitTimer);
      clearInterval(interval);
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("scroll", handleActivity);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      updatePresence("offline");
    };
  }, [firebaseUser]);

  // Save key caches to safeLocalStorage
  const saveToCache = (key: string, data: any) => {
    try {
      safeLocalStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn("Storage limits or error caching", e);
    }
  };

  const debounceCacheTimersRef = useRef<Record<string, any>>({});
  const saveToCacheDebounced = (key: string, data: any, delay = 500) => {
    if (debounceCacheTimersRef.current[key]) {
      clearTimeout(debounceCacheTimersRef.current[key]);
    }
    debounceCacheTimersRef.current[key] = setTimeout(() => {
      saveToCache(key, data);
      delete debounceCacheTimersRef.current[key];
    }, delay);
  };

  const setProfileInCache = useCallback((profile: UserProfile) => {
    if (!profile.uid) return;
    setProfilesCache((prev) => {
      const existing = prev[profile.uid];
      if (
        existing &&
        existing.fullName === profile.fullName &&
        (existing.photoUrl || existing.photoURL) === (profile.photoUrl || profile.photoURL) &&
        existing.bio === profile.bio
      ) {
        return prev;
      }
      const updated = { ...prev, [profile.uid]: profile };
      saveToCacheDebounced("swap_cache_profiles_map", updated, 800);
      return updated;
    });
  }, []);

  // 2. Fetch/Check Profile helper (instant cache-first)
  const fetchProfile = useCallback(async (uid: string): Promise<UserProfile | null> => {
    // 1. Return cached instantly if exists
    const cached = profilesCacheRef.current[uid];
    
    // 2. Silently fetch from Firestore in background
    const fetchPromise = async () => {
      let timerId: any = null;
      try {
        const docRef = doc(db, "users", uid);
        
        // Try reading from cache first for instant response if doc is in local IndexedDB
        try {
          const cachedSnap = await getDocFromCache(docRef);
          if (cachedSnap.exists()) {
            const cachedData = cachedSnap.data() as UserProfile;
            setProfileInCache(cachedData);
            if (uid === auth.currentUser?.uid) {
              setCurrentUserProfile(cachedData);
            }
          }
        } catch (_) {
          // Cache miss or disabled, proceed to server fetch
        }

        const timeoutPromise = new Promise<null>((_, reject) => {
          timerId = setTimeout(() => reject(new Error("Timeout")), 10000);
        });

        const snap = await Promise.race([
          getDoc(docRef),
          timeoutPromise
        ]) as any;

        if (snap && snap.exists()) {
          const freshData = snap.data() as UserProfile;
          setProfileInCache(freshData);
          if (uid === auth.currentUser?.uid) {
            setCurrentUserProfile(freshData);
            saveToCache("swap_cache_user_profile", freshData);
          }
          return freshData;
        }
      } catch (err: any) {
        if (err?.message === "Timeout") {
          console.warn(`[Profile Fetch] Background update timed out for ${uid}. Using cached state.`);
        } else {
          console.warn("[Profile Fetch] Silent profile background fetch note:", uid, err?.message || err);
        }
      } finally {
        if (timerId) clearTimeout(timerId);
      }
      return null;
    };

    if (cached) {
      // Fire and forget fetch to update the cache silently
      fetchPromise();
      return cached;
    }

    // If not cached, we wait for the network but fallback gracefully
    return await fetchPromise();
  }, [setProfileInCache]);

  // Feed/Discovery Refresh (Optimized to load only the first 8 users)
  const refreshFeed = useCallback(async (force = false) => {
    const now = Date.now();
    // Throttle if fetched recently or already populated from cache unless forced
    if (!force && discoveryUsersRef.current.length > 0 && now - lastFeedFetchRef.current < 60000) {
      setLoadingDiscovery(false);
      return Promise.resolve();
    }
    if (now - lastFeedFetchRef.current < 15000) {
      if (feedFetchPromiseRef.current) {
        return feedFetchPromiseRef.current;
      }
      return Promise.resolve();
    }

    feedFetchPromiseRef.current = (async () => {
      try {
        lastFeedFetchRef.current = Date.now();
        const usersRef = collection(db, "users");
        const q = query(usersRef, limit(8));
        const querySnapshot = await getDocs(q);
        
        const loadedUsers: UserProfile[] = [];
        const newProfilesMap: Record<string, UserProfile> = {};
        querySnapshot.forEach((doc) => {
          const data = doc.data() as UserProfile;
          if (data.uid !== auth.currentUser?.uid) {
            loadedUsers.push(data);
            newProfilesMap[data.uid] = data;
          }
        });

        if (Object.keys(newProfilesMap).length > 0) {
          setProfilesCache((prev) => {
            const updated = { ...prev, ...newProfilesMap };
            saveToCacheDebounced("swap_cache_profiles_map", updated, 800);
            return updated;
          });
        }

        if (querySnapshot.docs.length > 0) {
          lastFeedDocRef.current = querySnapshot.docs[querySnapshot.docs.length - 1];
          setHasMoreFeed(querySnapshot.docs.length === 8);
        } else {
          lastFeedDocRef.current = null;
          setHasMoreFeed(false);
        }

        setDiscoveryUsers(loadedUsers);
        saveToCache("swap_cache_discovery", loadedUsers);
      } catch (err) {
        console.error("Error loading feed:", err);
      } finally {
        setLoadingDiscovery(false);
        feedFetchPromiseRef.current = null;
      }
    })();

    return feedFetchPromiseRef.current;
  }, []);

  // Load More Feed for Pagination
  const loadMoreFeed = useCallback(async () => {
    if (!hasMoreFeed || !lastFeedDocRef.current || feedFetchPromiseRef.current) return;

    feedFetchPromiseRef.current = (async () => {
      try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, startAfter(lastFeedDocRef.current), limit(8));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.docs.length > 0) {
          lastFeedDocRef.current = querySnapshot.docs[querySnapshot.docs.length - 1];
          setHasMoreFeed(querySnapshot.docs.length === 8);

          const loadedUsers: UserProfile[] = [];
          const newProfilesMap: Record<string, UserProfile> = {};
          querySnapshot.forEach((doc) => {
            const data = doc.data() as UserProfile;
            if (data.uid !== auth.currentUser?.uid) {
              loadedUsers.push(data);
              newProfilesMap[data.uid] = data;
            }
          });

          if (Object.keys(newProfilesMap).length > 0) {
            setProfilesCache((prev) => {
              const updated = { ...prev, ...newProfilesMap };
              saveToCacheDebounced("swap_cache_profiles_map", updated, 800);
              return updated;
            });
          }

          setDiscoveryUsers((prev) => {
            const merged = [...prev];
            loadedUsers.forEach((u) => {
              if (!merged.some((m) => m.uid === u.uid)) {
                merged.push(u);
              }
            });
            saveToCache("swap_cache_discovery", merged);
            return merged;
          });
        } else {
          setHasMoreFeed(false);
        }
      } catch (err) {
        console.error("Error loading more feed:", err);
      } finally {
        feedFetchPromiseRef.current = null;
      }
    })();

    return feedFetchPromiseRef.current;
  }, [hasMoreFeed]);

  // Sessions Refresh (Throttled fallback/manual pull refresh)
  const refreshSessions = useCallback(async () => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const now = Date.now();
    if (now - lastSessionsFetchRef.current < 15000) {
      if (sessionsFetchPromiseRef.current) {
        return sessionsFetchPromiseRef.current;
      }
      return Promise.resolve();
    }

    sessionsFetchPromiseRef.current = (async () => {
      try {
        lastSessionsFetchRef.current = Date.now();
        const sessRef = collection(db, "sessions");
        const qTeacher = query(sessRef, where("teacherId", "==", uid));
        const qLearner = query(sessRef, where("learnerId", "==", uid));
        
        const [snapTeacher, snapLearner] = await Promise.all([
          getDocs(qTeacher),
          getDocs(qLearner)
        ]);

        const loaded: Session[] = [];
        const seen = new Set<string>();

        const addSessions = (snap: any) => {
          snap.forEach((docSnap: any) => {
            if (!seen.has(docSnap.id)) {
              seen.add(docSnap.id);
              loaded.push({ ...docSnap.data(), id: docSnap.id } as Session);
            }
          });
        };

        addSessions(snapTeacher);
        addSessions(snapLearner);

        loaded.sort((a, b) => {
          const timeA = a.scheduledTime?.seconds || 0;
          const timeB = b.scheduledTime?.seconds || 0;
          return timeB - timeA;
        });

        setSessions(loaded);
        saveToCache("swap_cache_sessions", loaded);
      } catch (err) {
        console.error("Error refreshing sessions:", err);
      } finally {
        sessionsFetchPromiseRef.current = null;
      }
    })();

    return sessionsFetchPromiseRef.current;
  }, []);

  // Helper to extract timestamp value safely for real-time descending activity sorting
  const getChatTimestampValue = (c: Chat): number => {
    if (!c) return 0;
    const timeVal = c.lastMessageAt || c.lastMessageTime || c.updatedAt || c.createdAt;
    if (!timeVal) return 0;
    if (typeof timeVal === "number") return timeVal > 1e11 ? timeVal : timeVal * 1000;
    if (typeof timeVal.toMillis === "function") return timeVal.toMillis();
    if (timeVal.seconds !== undefined) return timeVal.seconds * 1000 + (timeVal.nanoseconds || 0) / 1e6;
    if (timeVal instanceof Date) return timeVal.getTime();
    if (typeof timeVal === "string") {
      const parsed = Date.parse(timeVal);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const chatLiveStateRef = useRef<Record<string, { sig: string; timeMs: number; liveUnread: number; liveMention: boolean }>>({});
  const chatLiveHydratedUidRef = useRef<string | null>(null);
  const chatLiveBaselineReadyRef = useRef<boolean>(false);
  const currentUserProfileRef = useRef<UserProfile | null>(null);
  currentUserProfileRef.current = currentUserProfile;

  const ensureChatLiveStateLoaded = useCallback((uid: string) => {
    if (!uid || chatLiveHydratedUidRef.current === uid) return;
    chatLiveHydratedUidRef.current = uid;
    try {
      const raw = safeLocalStorage.getItem(`swap_live_unread_${uid}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          chatLiveStateRef.current = parsed;
          return;
        }
      }
    } catch {}
    chatLiveStateRef.current = {};
  }, []);

  const persistChatLiveState = useCallback((uid: string) => {
    if (!uid) return;
    try {
      safeLocalStorage.setItem(`swap_live_unread_${uid}`, JSON.stringify(chatLiveStateRef.current));
    } catch {}
  }, []);

  // Immediately clear local unread & mention state the instant user opens a chat
  useEffect(() => {
    const unsub = activeChatTrackingService.onActiveChatChange((openedChatId) => {
      const uid = auth.currentUser?.uid || "";
      if (!uid || !openedChatId) return;
      ensureChatLiveStateLoaded(uid);
      let didChange = false;

      setChats((prev) => {
        let stateMutated = false;
        const next = prev.map((c) => {
          const matches = c.id === openedChatId || Boolean(c.mergedChatIds?.includes(openedChatId));
          if (!matches) return c;

          const msgTimeMs = getChatTimestampValue(c);
          const sig = `${c.lastMessageSenderId || ""}::${c.lastMessage || ""}::${msgTimeMs}`;
          const prevEntry = chatLiveStateRef.current[c.id];
          if (!prevEntry || prevEntry.liveUnread > 0 || prevEntry.liveMention || prevEntry.sig !== sig) {
            chatLiveStateRef.current[c.id] = { sig, timeMs: msgTimeMs, liveUnread: 0, liveMention: false };
            didChange = true;
          }

          const hadUnread = (c.unreadCount?.[uid] || 0) > 0;
          const hadMention = (c.unreadMentionCount?.[uid] || 0) > 0;
          if (!hadUnread && !hadMention) return c;

          stateMutated = true;
          return {
            ...c,
            unreadCount: { ...(c.unreadCount || {}), [uid]: 0 },
            unreadMentionCount: c.unreadMentionCount ? { ...c.unreadMentionCount, [uid]: 0 } : c.unreadMentionCount,
          };
        });
        if (didChange) persistChatLiveState(uid);
        if (stateMutated) {
          saveToCacheDebounced("swap_cache_chats", next, 400);
          return next;
        }
        return prev;
      });
    });
    return () => unsub();
  }, [ensureChatLiveStateLoaded, persistChatLiveState]);

  const recentChatPatchRef = useRef<Map<string, {
    lastMessage: string;
    lastMessageSenderId: string;
    lastMessageAtMs: number;
    patchedAt: number;
  }>>(new Map());
  const processedIncomingEventsRef = useRef<Map<string, number>>(new Map());

  const isGenericPreviewText = (txt: string): boolean => {
    const t = (txt || "").trim();
    if (!t) return true;
    const lower = t.toLowerCase();
    return (
      lower.startsWith("sent a photo") ||
      lower.startsWith("sent a video") ||
      lower.startsWith("sent a view once") ||
      lower.startsWith("sent a replayable") ||
      lower.startsWith("sent a voice note") ||
      lower.startsWith("sent a file") ||
      lower.startsWith("shared a ") ||
      lower === "started a conversation" ||
      lower === "conversation initiated" ||
      lower === "this message was deleted" ||
      lower === "missed video call" ||
      lower === "missed voice call"
    );
  };

  // Zero-quota instant chat & message cache bridge from FCM pushes, foreground notifications, or inline replies
  const applyRealtimeIncomingMessage = useCallback((payload: {
    chatId: string;
    senderId?: string;
    senderName?: string;
    senderPhoto?: string;
    message?: string;
    fullMessage?: string;
    messageId?: string;
    createdAtMs?: number;
  }) => {
    const uid = auth.currentUser?.uid || "";
    const rawChatId = payload.chatId?.trim();
    if (!uid || !rawChatId) return;

    const rawText = (payload.fullMessage || payload.message || "").trim();
    if (!rawText) return;

    const senderId = (payload.senderId || "").trim();
    const isFromMe = senderId === uid;
    const eventTimeMs =
      typeof payload.createdAtMs === "number" && Number.isFinite(payload.createdAtMs) && payload.createdAtMs > 0
        ? payload.createdAtMs
        : Date.now();

    // Unwrap message-request wrapper if present
    const reqMatch = rawText.match(/^sent you a message request:\s*"([\s\S]*)"$/i);
    const cleanText = reqMatch ? reqMatch[1] : rawText;

    // Deduplicate across unsubNotif + FCM foreground/tap listeners so unread never double-counts
    const dedupeKey = payload.messageId
      ? `msg:${rawChatId}:${payload.messageId}`
      : `txt:${rawChatId}:${senderId}:${cleanText}`;
    const now = Date.now();
    const lastProcessed = processedIncomingEventsRef.current.get(dedupeKey);
    if (lastProcessed && now - lastProcessed < 20000) {
      return;
    }
    processedIncomingEventsRef.current.set(dedupeKey, now);
    if (processedIncomingEventsRef.current.size > 120) {
      processedIncomingEventsRef.current.forEach((ts, k) => {
        if (now - ts > 30000) processedIncomingEventsRef.current.delete(k);
      });
    }

    ensureChatLiveStateLoaded(uid);
    const isOpenNow = !isFromMe && Boolean(
      activeChatTrackingService.isChatCurrentlyOpenAndVisible(rawChatId, senderId || undefined)
    );
    const canonicalPairId = senderId && senderId !== uid ? [uid, senderId].sort().join("_") : "";

    let resolvedChatIds = [rawChatId];
    if (canonicalPairId && canonicalPairId !== rawChatId) {
      resolvedChatIds.push(canonicalPairId);
    }

    const patchKeys = new Set<string>(resolvedChatIds);
    let maxPatchedTs = eventTimeMs;

    // Synchronously collect all matching consolidated/merged keys & max timestamp from latest ref
    // so React 19 batched state updaters never leave patchKeys or messagesCache incomplete
    (chatsRef.current || []).forEach((c) => {
      const isMatch =
        c.id === rawChatId ||
        Boolean(c.mergedChatIds?.includes(rawChatId)) ||
        (canonicalPairId && (c.id === canonicalPairId || Boolean(c.mergedChatIds?.includes(canonicalPairId)) || getParticipantKeyFromChat(c, uid) === canonicalPairId));
      if (!isMatch) return;
      patchKeys.add(c.id);
      c.mergedChatIds?.forEach((mid) => patchKeys.add(mid));
      const existingTs = getChatTimestampValue(c);
      const effectiveTs = Math.max(existingTs + 1, eventTimeMs);
      if (effectiveTs > maxPatchedTs) maxPatchedTs = effectiveTs;
    });

    // 1. Update chats list immediately (0ms) so Chats tab shows latest preview & order at top
    setChats((prev) => {
      let matched = false;
      const updatedList = prev.map((c) => {
        const isMatch =
          c.id === rawChatId ||
          Boolean(c.mergedChatIds?.includes(rawChatId)) ||
          (canonicalPairId && (c.id === canonicalPairId || Boolean(c.mergedChatIds?.includes(canonicalPairId)) || getParticipantKeyFromChat(c, uid) === canonicalPairId));

        if (!isMatch) return c;
        matched = true;
        patchKeys.add(c.id);
        c.mergedChatIds?.forEach((mid) => patchKeys.add(mid));

        const existingTs = getChatTimestampValue(c);
        const effectiveTs = Math.max(existingTs + 1, eventTimeMs);
        if (effectiveTs > maxPatchedTs) maxPatchedTs = effectiveTs;
        const currentUnread = c.unreadCount?.[uid] || 0;
        const nextUnread = isFromMe || isOpenNow ? 0 : currentUnread + 1;
        const newSig = `${senderId || c.lastMessageSenderId || ""}::${cleanText}::${effectiveTs}`;

        chatLiveStateRef.current[c.id] = {
          sig: newSig,
          timeMs: effectiveTs,
          liveUnread: nextUnread,
          liveMention: Boolean(c.unreadMentionCount?.[uid] || 0),
        };
        persistChatLiveState(uid);

        return {
          ...c,
          lastMessage: cleanText,
          lastMessageSenderId: senderId || c.lastMessageSenderId || "",
          lastMessageAt: effectiveTs,
          lastMessageTime: effectiveTs,
          updatedAt: effectiveTs,
          unreadCount: {
            ...(c.unreadCount || {}),
            [uid]: nextUnread,
          },
        };
      });

      if (!matched && senderId && senderId !== uid) {
        const syntheticId = canonicalPairId || rawChatId;
        patchKeys.add(syntheticId);
        const nextUnread = isOpenNow ? 0 : 1;
        const newSig = `${senderId}::${cleanText}::${eventTimeMs}`;
        chatLiveStateRef.current[syntheticId] = {
          sig: newSig,
          timeMs: eventTimeMs,
          liveUnread: nextUnread,
          liveMention: false,
        };
        persistChatLiveState(uid);

        updatedList.unshift({
          id: syntheticId,
          participantIds: [uid, senderId],
          otherUserId: senderId,
          otherUserName: payload.senderName || "New Message",
          otherUserPhoto: payload.senderPhoto || "",
          lastMessage: cleanText,
          lastMessageSenderId: senderId,
          lastMessageAt: eventTimeMs,
          lastMessageTime: eventTimeMs,
          updatedAt: eventTimeMs,
          createdAt: eventTimeMs,
          unreadCount: { [uid]: nextUnread, [senderId]: 0 },
          mergedChatIds: Array.from(new Set([syntheticId, rawChatId])),
        } as Chat);
      }

      const sortedNext = [...updatedList].sort((a, b) => {
        const timeA = getChatTimestampValue(a);
        const timeB = getChatTimestampValue(b);
        if (timeB !== timeA) return timeB - timeA;
        return String(a.id || "").localeCompare(String(b.id || ""));
      });

      saveToCacheDebounced("swap_cache_chats", sortedNext, 120);
      return sortedNext;
    });

    // Record monotonic patch guard so stale IndexedDB fromCache snapshots never revert preview backward across clock skew
    const patchEntry = {
      lastMessage: cleanText,
      lastMessageSenderId: senderId || "",
      lastMessageAtMs: maxPatchedTs,
      patchedAt: now,
    };
    patchKeys.forEach((k) => {
      recentChatPatchRef.current.set(k, patchEntry);
    });

    // 2. Also pre-populate messagesCache immediately across all matching conversation IDs (0 extra reads!)
    if (!reqMatch && !isGenericPreviewText(cleanText) && senderId) {
      const targetCacheIds = Array.from(patchKeys);
      const getLocalMsgTs = (m: any) =>
        m?.clientTimestamp ||
        (typeof m?.createdAt === "number" ? m.createdAt : m?.createdAt?.seconds ? m.createdAt.seconds * 1000 : 0) ||
        (typeof m?.timestamp === "number" ? m.timestamp : 0);

      setMessagesCache((prev) => {
        let changed = false;
        const nextMap = { ...prev };
        for (const cKey of targetCacheIds) {
          const existingList = Array.isArray(prev[cKey]) ? prev[cKey] : [];

          const msgClientId = payload.messageId || `push_${eventTimeMs}_${Math.random().toString(36).slice(2, 6)}`;
          const alreadyExists = existingList.some((m: any) => {
            if (payload.messageId && (m.id === payload.messageId || m.clientMsgId === payload.messageId || m.id === `push_${payload.messageId}`)) return true;
            const sameSender = m.senderId === senderId;
            const sameText = (m.text || "").trim() === cleanText;
            const ts = getLocalMsgTs(m);
            return sameSender && sameText && Math.abs((ts || eventTimeMs) - eventTimeMs) < 30000;
          });

          if (!alreadyExists) {
            const syntheticMsg = {
              id: payload.messageId ? `push_${payload.messageId}` : msgClientId,
              clientMsgId: msgClientId,
              _fromPush: true,
              _receivedLocallyAt: now,
              senderId,
              text: cleanText,
              createdAt: eventTimeMs,
              timestamp: eventTimeMs,
              clientTimestamp: eventTimeMs,
              status: "delivered",
              isRead: false,
              deleted: false,
              reactions: {},
              deletedFor: [],
            };
            const merged = [...existingList, syntheticMsg].sort((a: any, b: any) => getLocalMsgTs(a) - getLocalMsgTs(b));
            nextMap[cKey] = merged.slice(-25);
            changed = true;
          }
        }
        if (!changed) return prev;
        try {
          safeLocalStorage.setItem("swap_cache_messages_map", JSON.stringify(nextMap));
        } catch (_) {}
        return nextMap;
      });
    }
  }, [ensureChatLiveStateLoaded, persistChatLiveState]);

  // Listen to push notification events, inline replies, and mark-as-read actions for instant 0ms UI sync
  useEffect(() => {
    const handleSyncFromPush = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      if (!detail || !detail.chatId) return;
      applyRealtimeIncomingMessage({
        chatId: detail.chatId,
        senderId: detail.senderId,
        senderName: detail.senderName,
        senderPhoto: detail.senderPhoto,
        message: detail.message,
        fullMessage: detail.fullMessage,
        messageId: detail.messageId,
        createdAtMs: detail.createdAtMs,
      });
    };

    const handleInlineReplied = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      const uid = auth.currentUser?.uid || "";
      if (!detail || !detail.chatId || !detail.text || !uid) return;
      applyRealtimeIncomingMessage({
        chatId: detail.chatId,
        senderId: uid,
        message: detail.text,
        messageId: detail.messageId,
        createdAtMs: Date.now(),
      });
    };

    const handleMarkedRead = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      const uid = auth.currentUser?.uid || "";
      const targetChatId = detail?.chatId;
      if (!uid || !targetChatId) return;
      ensureChatLiveStateLoaded(uid);
      setChats((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          const matches = c.id === targetChatId || Boolean(c.mergedChatIds?.includes(targetChatId));
          if (!matches) return c;
          const msgTimeMs = getChatTimestampValue(c);
          const sig = `${c.lastMessageSenderId || ""}::${c.lastMessage || ""}::${msgTimeMs}`;
          chatLiveStateRef.current[c.id] = { sig, timeMs: msgTimeMs, liveUnread: 0, liveMention: false };
          if ((c.unreadCount?.[uid] || 0) === 0 && (c.unreadMentionCount?.[uid] || 0) === 0) return c;
          changed = true;
          return {
            ...c,
            unreadCount: { ...(c.unreadCount || {}), [uid]: 0 },
            unreadMentionCount: c.unreadMentionCount ? { ...c.unreadMentionCount, [uid]: 0 } : c.unreadMentionCount,
          };
        });
        if (changed) {
          persistChatLiveState(uid);
          saveToCacheDebounced("swap_cache_chats", next, 120);
          return next;
        }
        return prev;
      });
    };

    window.addEventListener("swapskill_sync_message_from_push", handleSyncFromPush);
    window.addEventListener("swapskill_new_message_notif", handleSyncFromPush);
    window.addEventListener("swapskill_message_replied", handleInlineReplied);
    window.addEventListener("swapskill_chat_marked_read", handleMarkedRead);

    return () => {
      window.removeEventListener("swapskill_sync_message_from_push", handleSyncFromPush);
      window.removeEventListener("swapskill_new_message_notif", handleSyncFromPush);
      window.removeEventListener("swapskill_message_replied", handleInlineReplied);
      window.removeEventListener("swapskill_chat_marked_read", handleMarkedRead);
    };
  }, [applyRealtimeIncomingMessage, ensureChatLiveStateLoaded, persistChatLiveState]);

  // Real-time Chat updater: Always sorts conversations by latest activity/message timestamp (lastMessageAt / lastMessageTime) descending
  // Consolidates multiple Firestore docs for the same two Firebase UIDs into one logical chat
  const updateChatsStably = useCallback((loadedChats: Chat[], isFromCache = false) => {
    const currentUid = auth.currentUser?.uid || "";
    const consolidated = consolidateConversations(loadedChats, currentUid);

    if (!consolidated || consolidated.length === 0) {
      // Never wipe cached chats on an initial fromCache empty snapshot
      if (isFromCache && chatsRef.current.length > 0) return;
      setChats((prev) => {
        if (prev.length === 0) return prev;
        saveToCacheDebounced("swap_cache_chats", [], 150);
        return [];
      });
      return;
    }

    // Apply monotonic patch protection so stale cache snapshots never revert newer push-received previews
    const now = Date.now();
    const monotonicConsolidated = consolidated.map((c) => {
      const candidateKeys = [c.id, ...(c.mergedChatIds || [])];
      if (currentUid) {
        const pairKey = getParticipantKeyFromChat(c, currentUid);
        if (pairKey) candidateKeys.push(pairKey);
      }
      const docTimeMs = getChatTimestampValue(c);
      for (const key of candidateKeys) {
        const patch = recentChatPatchRef.current.get(key);
        if (!patch) continue;
        if (now - patch.patchedAt > 25000 || docTimeMs >= patch.lastMessageAtMs) {
          recentChatPatchRef.current.delete(key);
          continue;
        }
        return {
          ...c,
          lastMessage: patch.lastMessage,
          lastMessageSenderId: patch.lastMessageSenderId || c.lastMessageSenderId,
          lastMessageAt: patch.lastMessageAtMs,
          lastMessageTime: patch.lastMessageAtMs,
          updatedAt: patch.lastMessageAtMs,
        };
      }
      return c;
    });

    if (currentUid) {
      ensureChatLiveStateLoaded(currentUid);
    }

    const activeOpenId = activeChatTrackingService.getActiveChatId();
    const myProf = currentUserProfileRef.current;
    const myUserLower = (myProf?.username || "").toLowerCase();
    const myFullHandleLower = (myProf?.fullName?.replace(/\s+/g, "") || "").toLowerCase();
    const myFirstLower = (myProf?.fullName?.split(" ")[0] || "").toLowerCase();
    let liveStateDirty = false;

    const enriched: Chat[] = currentUid
      ? monotonicConsolidated.map((c) => {
          const msgTimeMs = getChatTimestampValue(c);
          const msgText = c.lastMessage || "";
          const sig = `${c.lastMessageSenderId || ""}::${msgText}::${msgTimeMs}`;
          const fsUnread = c.unreadCount?.[currentUid] || 0;
          const fsMention = c.unreadMentionCount?.[currentUid] || 0;
          const isOpenNow = Boolean(
            activeOpenId && (activeOpenId === c.id || c.mergedChatIds?.includes(activeOpenId))
          );
          const isIncoming = Boolean(c.lastMessageSenderId && c.lastMessageSenderId !== currentUid && msgText);
          const msgLower = msgText.toLowerCase();
          const textMentionsMe = Boolean(
            c.lastMessageHasMention ||
            (myUserLower && msgLower.includes(`@${myUserLower}`)) ||
            (myFullHandleLower && msgLower.includes(`@${myFullHandleLower}`)) ||
            (myFirstLower && msgLower.includes(`@${myFirstLower}`))
          );

          const prevEntry = chatLiveStateRef.current[c.id];
          let liveUnread = 0;
          let liveMention = false;

          if (isOpenNow) {
            liveUnread = 0;
            liveMention = false;
            if (!prevEntry || prevEntry.sig !== sig || prevEntry.liveUnread !== 0 || prevEntry.liveMention) {
              chatLiveStateRef.current[c.id] = { sig, timeMs: msgTimeMs, liveUnread: 0, liveMention: false };
              liveStateDirty = true;
            }
          } else if (prevEntry) {
            if (prevEntry.sig !== sig && isIncoming) {
              liveUnread = Math.max(prevEntry.liveUnread + 1, fsUnread);
              liveMention = prevEntry.liveMention || fsMention > 0 || textMentionsMe;
            } else {
              liveUnread = Math.max(prevEntry.liveUnread, fsUnread);
              liveMention = prevEntry.liveMention || fsMention > 0 || (liveUnread > 0 && textMentionsMe);
            }
            if (
              prevEntry.sig !== sig ||
              prevEntry.liveUnread !== liveUnread ||
              prevEntry.liveMention !== liveMention
            ) {
              chatLiveStateRef.current[c.id] = { sig, timeMs: msgTimeMs, liveUnread, liveMention };
              liveStateDirty = true;
            }
          } else {
            const isRecentLiveNewChat = Boolean(
              chatLiveBaselineReadyRef.current &&
              isIncoming &&
              Date.now() - msgTimeMs < 60000
            );
            liveUnread = isRecentLiveNewChat ? Math.max(1, fsUnread) : fsUnread;
            liveMention = fsMention > 0 || (liveUnread > 0 && textMentionsMe);
            chatLiveStateRef.current[c.id] = { sig, timeMs: msgTimeMs, liveUnread, liveMention };
            liveStateDirty = true;
          }

          const finalUnread = isOpenNow ? 0 : Math.max(fsUnread, liveUnread);
          const finalMention = isOpenNow ? 0 : Math.max(fsMention, liveMention ? 1 : 0);

          if (finalUnread === fsUnread && finalMention === fsMention) {
            return c;
          }

          return {
            ...c,
            unreadCount: { ...(c.unreadCount || {}), [currentUid]: finalUnread },
            ...(finalMention > 0
              ? { unreadMentionCount: { ...(c.unreadMentionCount || {}), [currentUid]: finalMention } }
              : {}),
          };
        })
      : monotonicConsolidated;

    if (currentUid && liveStateDirty) {
      persistChatLiveState(currentUid);
    }

    // Always sort conversations by latest activity/message timestamp descending (newest on top #1)
    // with a deterministic ID tie-breaker so rows never swap position unexpectedly.
    const sorted = [...enriched].sort((a, b) => {
      const timeA = getChatTimestampValue(a);
      const timeB = getChatTimestampValue(b);
      if (timeB !== timeA) return timeB - timeA;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });

    setChats((prev) => {
      if (prev.length === sorted.length) {
        let isSame = true;
        for (let i = 0; i < prev.length; i++) {
          const p = prev[i];
          const s = sorted[i];
          if (
            p.id !== s.id ||
            p.lastMessage !== s.lastMessage ||
            p.lastMessageSenderId !== s.lastMessageSenderId ||
            getChatTimestampValue(p) !== getChatTimestampValue(s) ||
            (p.unreadCount?.[currentUid] || 0) !== (s.unreadCount?.[currentUid] || 0) ||
            (p.unreadMentionCount?.[currentUid] || 0) !== (s.unreadMentionCount?.[currentUid] || 0)
          ) {
            isSame = false;
            break;
          }
        }
        if (isSame) return prev;
      }
      saveToCacheDebounced("swap_cache_chats", sorted, 150);
      return sorted;
    });
  }, [ensureChatLiveStateLoaded, persistChatLiveState]);

  // Chats Refresh (Throttled fallback/manual pull refresh)
  const refreshChats = useCallback(async () => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const now = Date.now();
    if (now - lastChatsFetchRef.current < 15000) {
      if (chatsFetchPromiseRef.current) {
        return chatsFetchPromiseRef.current;
      }
      return Promise.resolve();
    }

    chatsFetchPromiseRef.current = (async () => {
      try {
        lastChatsFetchRef.current = Date.now();
        const chatsRef = collection(db, "chats");
        const q = query(chatsRef, where("participantIds", "array-contains", uid));
        
        const convsRef = collection(db, "conversations");
        const qC = query(convsRef, where("participantIds", "array-contains", uid));

        const [snapChats, snapConvs] = await Promise.all([
          getDocs(q),
          getDocs(qC)
        ]);
        
        const loaded: Chat[] = [];

        snapConvs.forEach((docSnap) => {
          loaded.push({ ...docSnap.data({ serverTimestamps: "estimate" }), id: docSnap.id, isLegacy: false } as Chat);
        });

        snapChats.forEach((docSnap) => {
          loaded.push({ ...docSnap.data({ serverTimestamps: "estimate" }), id: docSnap.id, isLegacy: true } as Chat);
        });

        updateChatsStably(loaded, false);
      } catch (err) {
        console.error("Error refreshing chats:", err);
      } finally {
        chatsFetchPromiseRef.current = null;
      }
    })();

    return chatsFetchPromiseRef.current;
  }, [updateChatsStably]);

  // Set up real-time preloading and active listeners in stages
  const preloadData = useCallback((uid: string) => {
    chatLiveBaselineReadyRef.current = false;
    ensureChatLiveStateLoaded(uid);

    // 1. Silent preloads: only refresh feed if cached discovery feed is empty
    if (discoveryUsersRef.current.length === 0) {
      refreshFeed();
    }
    
    // Clean existing background timers & listeners
    backgroundTimersRef.current.forEach(t => clearTimeout(t));
    backgroundTimersRef.current = [];
    listenersRef.current.forEach(unsub => unsub());
    listenersRef.current = [];

    const baselineTimer = setTimeout(() => {
      chatLiveBaselineReadyRef.current = true;
    }, 1500);
    backgroundTimersRef.current.push(baselineTimer);

    // Note: We deliberately DO NOT start a 25-user onSnapshot for discovery!
    // The feed uses refreshFeed() and pagination on demand, removing 25 duplicate reads on every startup.

    // 2. Real-time active chats + conversations list listener (Immediate for messaging responsive state)
    try {
      const chatsRefCol = collection(db, "chats");
      const qChats = query(chatsRefCol, where("participantIds", "array-contains", uid));
      
      const convsRef = collection(db, "conversations");
      const qConvs = query(convsRef, where("participantIds", "array-contains", uid));

      let legacyChatsList: Chat[] = [];
      let newConversationsList: Chat[] = [];
      let hasChatsSnap = false;
      let hasConvsSnap = false;
      let chatsFromCache = true;
      let convsFromCache = true;
      let initialBarrierTimer: any = null;

      const mergeAndSetChats = () => {
        if (initialBarrierTimer) {
          clearTimeout(initialBarrierTimer);
          initialBarrierTimer = null;
        }
        // If one collection emitted before the other (e.g. legacy chats resolved while conversations is still syncing),
        // preserve cached rows belonging to the still-pending collection so chats NEVER vanish for 1s on open!
        const preservedConvs = hasConvsSnap
          ? newConversationsList
          : (chatsRef.current || []).filter((c) => !c.isLegacy);
        const preservedLegacy = hasChatsSnap
          ? legacyChatsList
          : (chatsRef.current || []).filter((c) => c.isLegacy);

        const mergedRaw: Chat[] = [...preservedConvs, ...preservedLegacy];
        const stillBothFromCache = chatsFromCache && convsFromCache;
        updateChatsStably(mergedRaw, stillBothFromCache || !hasChatsSnap || !hasConvsSnap);
        setLoadingChats(false);
      };

      // Hold initial merge very briefly until both collections emit initial cache snapshots
      // so chats never momentarily reorder or drop rows between listeners.
      const scheduleMerge = () => {
        if (hasChatsSnap && hasConvsSnap) {
          mergeAndSetChats();
        } else if (!initialBarrierTimer) {
          initialBarrierTimer = setTimeout(() => {
            mergeAndSetChats();
          }, 120);
          backgroundTimersRef.current.push(initialBarrierTimer);
        }
      };

      // Safety timeout: ensure loadingChats resolves even on slow initial network handshake
      const fallbackTimer = setTimeout(() => {
        setLoadingChats(false);
      }, 3500);

      const unsubChats = onSnapshot(qChats, (snapshot) => {
        clearTimeout(fallbackTimer);
        hasChatsSnap = true;
        chatsFromCache = Boolean(snapshot.metadata?.fromCache);
        legacyChatsList = [];
        snapshot.forEach((docSnap) => {
          legacyChatsList.push({ ...docSnap.data({ serverTimestamps: "estimate" }), id: docSnap.id, isLegacy: true } as Chat);
        });
        scheduleMerge();
      }, (err) => {
        clearTimeout(fallbackTimer);
        hasChatsSnap = true;
        chatsFromCache = false;
        console.warn("Chats listener error:", err);
        scheduleMerge();
      });

      const unsubConvs = onSnapshot(qConvs, (snapshot) => {
        clearTimeout(fallbackTimer);
        hasConvsSnap = true;
        convsFromCache = Boolean(snapshot.metadata?.fromCache);
        newConversationsList = [];
        snapshot.forEach((docSnap) => {
          newConversationsList.push({ ...docSnap.data({ serverTimestamps: "estimate" }), id: docSnap.id, isLegacy: false } as Chat);
        });
        scheduleMerge();
      }, (err) => {
        clearTimeout(fallbackTimer);
        hasConvsSnap = true;
        convsFromCache = false;
        console.warn("Conversations listener error:", err);
        scheduleMerge();
      });

      listenersRef.current.push(unsubChats);
      listenersRef.current.push(unsubConvs);
    } catch (e) {
      console.warn("Could not start chats/conversations list listener:", e);
      setLoadingChats(false);
    }

    // 3. Real-time notifications listener (Newest 50 via createdAt desc - zero extra quota!)
    try {
      const listenerAttachedAtMs = Date.now();
      const seenStorageKey = `swap_seen_notif_ids_${uid}`;
      const persistedSeenList: string[] = (() => {
        try {
          const raw = safeLocalStorage.getItem(seenStorageKey);
          const parsed = raw ? JSON.parse(raw) : [];
          return Array.isArray(parsed) ? parsed.slice(-150) : [];
        } catch {
          return [];
        }
      })();
      const persistedSeenIds = new Set<string>(persistedSeenList);
      const seenNotifAlertIds = new Set<string>(persistedSeenList);

      const rememberNotifAlertId = (key: string) => {
        if (!key) return;
        seenNotifAlertIds.add(key);
        persistedSeenIds.add(key);
        if (seenNotifAlertIds.size > 200) {
          const firstKey = seenNotifAlertIds.values().next().value;
          if (firstKey) seenNotifAlertIds.delete(firstKey);
        }
        try {
          const arr = Array.from(persistedSeenIds).slice(-150);
          safeLocalStorage.setItem(seenStorageKey, JSON.stringify(arr));
        } catch {}
      };

      const extractNotifTimeMs = (n: any): number => {
        if (!n) return 0;
        if (typeof n.createdTimestamp === "number" && Number.isFinite(n.createdTimestamp) && n.createdTimestamp > 0) {
          return n.createdTimestamp;
        }
        const nestedTs = Number(n?.data?.createdAtMs || 0);
        if (Number.isFinite(nestedTs) && nestedTs > 0) return nestedTs;
        if (n.createdAt?.toMillis) return n.createdAt.toMillis();
        if (n.createdAt?.seconds) return n.createdAt.seconds * 1000;
        if (typeof n.createdAt === "number") return n.createdAt;
        if (typeof n.createdAt === "string") {
          const parsed = new Date(n.createdAt).getTime();
          if (!isNaN(parsed)) return parsed;
        }
        return 0;
      };

      const notificationsRef = collection(db, "users", uid, "notifications");
      const qNotifOrdered = query(notificationsRef, orderBy("createdAt", "desc"), limit(50));

      const attachNotifListener = (qTarget: any, fallbackStage: number) => {
        let isFirstNotifLoad = true;
        return onSnapshot(qTarget, (snapshot: any) => {
          const loaded: Notification[] = [];
          snapshot.forEach((docSnap: any) => {
            loaded.push({ ...docSnap.data({ serverTimestamps: "estimate" }), id: docSnap.id } as Notification);
          });

          // Robust in-memory timestamp sort
          loaded.sort((a: any, b: any) => extractNotifTimeMs(b) - extractNotifTimeMs(a));

          // Trigger events for changes
          const processNotification = (rawNotifData: Notification, docId: string) => {
            const nestedData = (rawNotifData as any).data || {};
            const notifData = rawNotifData;
            const notifType = (notifData.type || nestedData.type || "").toLowerCase();
            const notifMsg = (notifData.message || (notifData as any).body || "").toLowerCase();
            const sessId = (notifData as any).sessionId || nestedData.sessionId || docId;
            const alertDedupeKey = (notifData as any).messageId || nestedData.messageId || docId;
            if (seenNotifAlertIds.has(alertDedupeKey)) return;
            rememberNotifAlertId(alertDedupeKey);

            if (
              notifType === "booking" ||
              notifType === "session_request" ||
              ((notifMsg.includes("request") && !notifType.includes("message") && !notifMsg.includes("message request")) || notifMsg.includes("booked"))
            ) {
              crossPlatformNotificationManager.notifySessionRequestReceived({
                sessionId: sessId,
                partnerName: notifData.senderName || (notifData as any).fromUserName || (notifData as any).title || "A partner",
                skillName: (notifData as any).skillName || nestedData.skillName || "Skill Swap",
              });
            } else if (notifType === "booking_accepted" || notifType === "session_accepted" || notifMsg.includes("accepted") || notifMsg.includes("confirmed")) {
              crossPlatformNotificationManager.notifySessionAccepted({
                sessionId: sessId,
                partnerName: notifData.senderName || (notifData as any).fromUserName || "Your partner",
                skillName: (notifData as any).skillName || nestedData.skillName || "Skill Swap",
              });
            } else if (notifType === "chat" || notifType === "message" || notifType === "message_request" || Boolean((notifData as any).chatId || nestedData.chatId)) {
              const incomingChatId = (notifData as any).chatId || nestedData.chatId || (notifData as any).referenceId || docId;
              const senderId = notifData.senderId || nestedData.senderId || (notifData as any).fromUserId;
              const rawNotifMsg = notifData.message || nestedData.fullMessage || (notifData as any).body || "Sent you a message";
              const senderDisplayName = notifData.senderName || nestedData.senderName || (notifData as any).fromUserName || (notifData as any).title || "New message";
              const senderAvatar = (notifData as any).senderPhoto || nestedData.senderPhoto || (notifData as any).fromUserPhoto || "";
              const resolvedMsgId = (notifData as any).messageId || nestedData.messageId || docId;
              const createdTs = extractNotifTimeMs(notifData) || Date.now();

              // Always sync chats list & local message cache immediately at 0ms (0 extra reads!)
              applyRealtimeIncomingMessage({
                chatId: incomingChatId,
                senderId,
                senderName: senderDisplayName,
                senderPhoto: senderAvatar,
                message: rawNotifMsg,
                fullMessage: nestedData.fullMessage,
                messageId: resolvedMsgId,
                createdAtMs: createdTs,
              });

              // If user is currently inside this chat or muted it, suppress notification banner and sound
              if (activeChatTrackingService.isChatCurrentlyOpenAndVisible(incomingChatId, senderId) || isChatMuted(incomingChatId)) {
                console.log(`[Notification] Suppressed chat notification (open or muted) for chat: ${incomingChatId}`);
              } else {
                crossPlatformNotificationManager.notifyNewChatMessage({
                  chatId: incomingChatId,
                  senderName: senderDisplayName,
                  messageText: rawNotifMsg,
                  messageId: resolvedMsgId,
                  senderId,
                  senderPhoto: senderAvatar,
                });
                const isBackgroundedNativeAndroid =
                  Capacitor.isNativePlatform() &&
                  Capacitor.getPlatform() === "android" &&
                  typeof document !== "undefined" &&
                  document.visibilityState !== "visible";
                if (typeof window !== "undefined" && !isBackgroundedNativeAndroid) {
                  window.dispatchEvent(
                    new CustomEvent("swapskill_new_message_notif", {
                      detail: {
                        chatId: incomingChatId,
                        senderId,
                        senderName: senderDisplayName,
                        senderPhoto: senderAvatar,
                        message: rawNotifMsg,
                        fullMessage: nestedData.fullMessage,
                        messageId: resolvedMsgId,
                        createdAtMs: createdTs,
                      },
                    })
                  );
                }
              }
            } else if (notifType === "incoming_call" || notifType === "call") {
              // Live incoming calls are exclusively handled in real time via callSignalingService.listenToIncomingCalls
              // and FCM push notifications. Do not trigger incoming call popups from the notifications collection.
            } else if (notifType === "call_cancelled" || notifType === "call_ended") {
              const callId = (notifData as any).callId || nestedData.callId || (notifData as any).referenceId;
              crossPlatformNotificationManager.notifyCallEnded({ callId });
              window.dispatchEvent(new CustomEvent("swapskill_call_cancelled_notif", { detail: { callId } }));
            } else {
              playNotificationSound(`notif_${docId}`);
            }
          };

          const isFromCache = Boolean(snapshot.metadata?.fromCache);
          snapshot.docChanges().forEach((change: any) => {
            if (change.type !== "added") return;
            const rawData = change.doc.data({ serverTimestamps: "estimate" }) as Notification;
            const nested = (rawData as any).data || {};
            const alertKey = (rawData as any).messageId || nested.messageId || change.doc.id;
            if (!isFirstNotifLoad) {
              processNotification(rawData, change.doc.id);
              return;
            }
            // On initial snapshot: alert ONLY genuinely brand-new server notifications (arrived around attach time)
            // and silently record historical/cached notifications so page loads never replay old alerts.
            const createdMs = extractNotifTimeMs(rawData);
            const isFreshLiveNotif = !isFromCache && !rawData.read && createdMs > 0 && createdMs >= listenerAttachedAtMs - 15000;
            if (isFreshLiveNotif && !persistedSeenIds.has(alertKey)) {
              processNotification(rawData, change.doc.id);
            } else {
              rememberNotifAlertId(alertKey);
            }
          });
          isFirstNotifLoad = false;

          setNotifications((prev) => {
            if (prev.length === loaded.length) {
              let isSame = true;
              for (let i = 0; i < prev.length; i++) {
                if (prev[i].id !== loaded[i].id || prev[i].read !== loaded[i].read) {
                  isSame = false;
                  break;
                }
              }
              if (isSame) return prev;
            }
            saveToCacheDebounced("swap_cache_notifications", loaded, 500);
            return loaded;
          });
        }, (err: any) => {
          console.warn("Notifications listener offline or index fallback:", err);
          if (fallbackStage === 1) {
            try {
              const qFallbackOrdered = query(notificationsRef, orderBy("createdTimestamp", "desc"), limit(50));
              const unsubFallback = attachNotifListener(qFallbackOrdered, 2);
              listenersRef.current.push(unsubFallback);
            } catch (_) {}
          } else if (fallbackStage === 2) {
            try {
              const qFallbackUnordered = query(notificationsRef, limit(50));
              const unsubFallback = attachNotifListener(qFallbackUnordered, 0);
              listenersRef.current.push(unsubFallback);
            } catch (_) {}
          }
        });
      };

      const unsubNotif = attachNotifListener(qNotifOrdered, 1);
      listenersRef.current.push(unsubNotif);
    } catch (e) {
      console.warn("Could not start real-time notifications listener:", e);
    }

    // 4. Real-time sessions listener (Immediate startup)
    try {
      const sessRef = collection(db, "sessions");
      const qSessT = query(sessRef, where("teacherId", "==", uid));
      const qSessL = query(sessRef, where("learnerId", "==", uid));

        let teacherSessions: Session[] = [];
        let learnerSessions: Session[] = [];

        const mergeAndSetSessions = () => {
          const loaded: Session[] = [];
          const seen = new Set<string>();

          teacherSessions.forEach((s) => {
            seen.add(s.id);
            loaded.push(s);
          });
          learnerSessions.forEach((s) => {
            if (!seen.has(s.id)) {
              seen.add(s.id);
              loaded.push(s);
            }
          });

          // Sort by scheduledTime (newest first)
          loaded.sort((a, b) => {
            const timeA = a.scheduledTime?.seconds || 0;
            const timeB = b.scheduledTime?.seconds || 0;
            return timeB - timeA;
          });

          setSessions((prev) => {
            if (prev.length === loaded.length) {
              let isSame = true;
              for (let i = 0; i < prev.length; i++) {
                if (prev[i].id !== loaded[i].id || prev[i].status !== loaded[i].status || prev[i].isLive !== loaded[i].isLive) {
                  isSame = false;
                  break;
                }
              }
              if (isSame) return prev;
            }
            saveToCacheDebounced("swap_cache_sessions", loaded, 500);
            return loaded;
          });
        };

        let isFirstTeacherSessLoad = true;
        const unsubSessT = onSnapshot(qSessT, (snapshot) => {
          if (!isFirstTeacherSessLoad) {
            snapshot.docChanges().forEach((change) => {
              if (change.type === "added") {
                const sess = change.doc.data() as Session;
                if (sess.status === "pending" || sess.status === "requested") {
                  crossPlatformNotificationManager.notifySessionRequestReceived({
                    sessionId: change.doc.id,
                    partnerName: sess.learnerName || sess.studentName || "A partner",
                    skillName: sess.skillName || sess.skill || "Skill Swap",
                  });
                }
              }
            });
          }
          isFirstTeacherSessLoad = false;
          teacherSessions = snapshot.docs.map((d) => ({ ...(d.data() as Session), id: d.id }));
          mergeAndSetSessions();
        }, (err) => {
          console.warn("Sessions teacher listener error:", err);
        });

        let isFirstLearnerSessLoad = true;
        const unsubSessL = onSnapshot(qSessL, (snapshot) => {
          if (!isFirstLearnerSessLoad) {
            snapshot.docChanges().forEach((change) => {
              if (change.type === "modified") {
                const sess = change.doc.data() as Session;
                if (sess.status === "accepted" || sess.status === "confirmed") {
                  crossPlatformNotificationManager.notifySessionAccepted({
                    sessionId: change.doc.id,
                    partnerName: sess.teacherName || "Your partner",
                    skillName: sess.skillName || sess.skill || "Skill Swap",
                  });
                }
              }
            });
          }
          isFirstLearnerSessLoad = false;
          learnerSessions = snapshot.docs.map((d) => ({ ...(d.data() as Session), id: d.id }));
          mergeAndSetSessions();
        }, (err) => {
          console.warn("Sessions learner listener error:", err);
        });

        listenersRef.current.push(unsubSessT);
        listenersRef.current.push(unsubSessL);
      } catch (e) {
        console.warn("Could not start sessions listeners:", e);
      }
  }, [refreshFeed, updateChatsStably]);

  // 3. Auth Listener (single onAuthStateChanged across app)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (user) {
        // Trigger profile fetching asynchronously in the background, without blocking loadingAuth
        fetchProfile(user.uid).then((p) => {
          if (p) {
            setCurrentUserProfile(p);
            saveToCache("swap_cache_user_profile", p);
          }
          // Securely and silently track successful login session in the background
          const trackTimer = setTimeout(() => {
            trackLoginSession(user, p?.fullName).catch((err) => {
              console.error("Failed to track login session:", err);
            });
          }, 2500);
          backgroundTimersRef.current.push(trackTimer);
        }).catch((err) => {
          console.error("Error fetching user profile in auth handler:", err);
        });

        // Start preloading and setting up real-time listener chains first (clears prior listenersRef)
        preloadData(user.uid);

        // Real-time synchronization of current user profile doc (updates custom photo, bio, etc. immediately)
        const unsubUserProfile = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
          if (docSnap.exists()) {
            const freshProfile = docSnap.data() as UserProfile;
            setCurrentUserProfile(freshProfile);
            setProfileInCache(freshProfile);
            saveToCache("swap_cache_user_profile", freshProfile);
          }
        }, (err) => {
          console.warn("User profile realtime listener warning:", err);
        });
        listenersRef.current.push(unsubUserProfile);
      } else {
        backgroundTimersRef.current.forEach(t => clearTimeout(t));
        backgroundTimersRef.current = [];

        setCurrentUserProfile(null);
        setDiscoveryUsers([]);
        setChats([]);
        setSessions([]);
        setNotifications([]);
        setProfilesCache({});
        
        // Teardown any lingering listeners
        listenersRef.current.forEach(unsub => unsub());
        listenersRef.current = [];
        
        // Clear caches
        safeLocalStorage.removeItem("swap_cache_user_profile");
        safeLocalStorage.removeItem("swap_cache_discovery");
        safeLocalStorage.removeItem("swap_cache_chats");
        safeLocalStorage.removeItem("swap_cache_sessions");
        safeLocalStorage.removeItem("swap_cache_notifications");
        safeLocalStorage.removeItem("swap_cache_profiles_map");
      }
      setLoadingAuth(false);
    });

    return () => {
      unsubscribe();
      backgroundTimersRef.current.forEach(t => clearTimeout(t));
      backgroundTimersRef.current = [];
      listenersRef.current.forEach(unsub => unsub());
    };
  }, [fetchProfile, preloadData]);

  // 4. Update Current User Profile (optimistic write, merge updates)
  const updateProfile = useCallback(async (data: Partial<UserProfile>) => {
    if (!firebaseUser) return;
    const uid = firebaseUser.uid;

    // Never allow client self-updates to overwrite admin-controlled verification fields
    const {
      verified: _v,
      verificationStatus: _vs,
      verificationTier: _vt,
      verificationBadgeLabel: _vbl,
      verifiedAt: _va,
      verifiedBy: _vb,
      ...safeData
    } = data as any;
    if (Object.keys(safeData).length === 0) return;

    // Optimistic Update
    setCurrentUserProfile((prev) => {
      if (!prev) return null;
      const updated = { ...prev, ...safeData };
      saveToCache("swap_cache_user_profile", updated);
      return updated;
    });

    setProfilesCache((prev) => {
      const updated = { ...prev, [uid]: { ...prev[uid], ...safeData } as UserProfile };
      saveToCache("swap_cache_profiles_map", updated);
      return updated;
    });

    // Write to Firestore in background
    try {
      const userRef = doc(db, "users", uid);
      try {
        await updateDoc(userRef, safeData);
      } catch (innerErr: any) {
        if (innerErr?.code === "not-found") {
          await setDoc(userRef, { uid, ...safeData }, { merge: true });
        } else {
          throw innerErr;
        }
      }
    } catch (err) {
      console.error("Failed to persist updated profile. Rolling back.", err);
      // Re-fetch correct state from server
      try {
        const docRef = doc(db, "users", uid);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const original = snap.data() as UserProfile;
          setCurrentUserProfile(original);
          setProfileInCache(original);
        }
      } catch (_) {}
    }
  }, [firebaseUser, setProfileInCache]);

  // 5. Follow / Unfollow Transaction Optimistic Updates
  const toggleFollow = useCallback(async (targetUserId: string) => {
    if (!firebaseUser || !targetUserId || targetUserId === firebaseUser.uid) return;
    const currentUserId = firebaseUser.uid;

    // Prevent duplicate rapid clicks on the same user
    if (inFlightFollowsRef.current.has(targetUserId)) {
      return;
    }
    inFlightFollowsRef.current.add(targetUserId);

    const currentFollowingList = currentUserProfile?.followingList || [];
    const isCurrentlyFollowing = currentFollowingList.includes(targetUserId);

    // Optimistic values
    const nextFollowingList = isCurrentlyFollowing 
      ? currentFollowingList.filter(id => id !== targetUserId)
      : [...currentFollowingList, targetUserId];

    const nextFollowingCount = nextFollowingList.length;

    // Update current user state immediately (0ms)
    setCurrentUserProfile((prev) => {
      if (!prev) return null;
      const updated = {
        ...prev,
        followingList: nextFollowingList,
        followingCount: nextFollowingCount
      };
      saveToCache("swap_cache_user_profile", updated);
      return updated;
    });

    // Update target user in cache immediately (0ms)
    setProfilesCache((prev) => {
      const target = prev[targetUserId];
      if (!target) return prev;
      
      const newFollowersCount = isCurrentlyFollowing 
        ? Math.max(0, (target.followersCount || 1) - 1)
        : (target.followersCount || 0) + 1;

      const updatedTarget = {
        ...target,
        followersCount: newFollowersCount
      };

      const updated = {
        ...prev,
        [targetUserId]: updatedTarget,
        [currentUserId]: {
          ...prev[currentUserId],
          followingList: nextFollowingList,
          followingCount: nextFollowingCount
        } as UserProfile
      };
      saveToCache("swap_cache_profiles_map", updated);
      return updated;
    });

    // Update discovery users immediately (0ms)
    setDiscoveryUsers((prev) => {
      return prev.map((u) => {
        if (u.uid === targetUserId) {
          return {
            ...u,
            followersCount: isCurrentlyFollowing ? Math.max(0, (u.followersCount || 1) - 1) : (u.followersCount || 0) + 1
          };
        }
        return u;
      });
    });

    // Sync to Firestore using fast atomic batch / parallel operations
    try {
      const currentUserRef = doc(db, "users", currentUserId);
      const targetUserRef = doc(db, "users", targetUserId);
      const followingDocRef = doc(db, "users", currentUserId, "following", targetUserId);
      const followerDocRef = doc(db, "users", targetUserId, "followers", currentUserId);

      const batch = writeBatch(db);

      // Fast atomic field updates without preliminary read round-trips
      batch.update(currentUserRef, {
        followingList: isCurrentlyFollowing ? arrayRemove(targetUserId) : arrayUnion(targetUserId),
        followingCount: increment(isCurrentlyFollowing ? -1 : 1)
      });

      // Firestore security rules permit non-owners to update ONLY followersCount (+/- 1)
      batch.update(targetUserRef, {
        followersCount: increment(isCurrentlyFollowing ? -1 : 1)
      });

      if (isCurrentlyFollowing) {
        batch.delete(followingDocRef);
        batch.delete(followerDocRef);
      } else {
        batch.set(followingDocRef, { followedAt: new Date() });
        batch.set(followerDocRef, { followerAt: new Date() });
      }

      await batch.commit();

      // Send follower notification asynchronously in background
      if (!isCurrentlyFollowing) {
        const notificationsRef = collection(db, "users", targetUserId, "notifications");
        addDoc(notificationsRef, {
          type: "follower",
          senderId: currentUserId,
          senderName: currentUserProfile?.fullName || "A member",
          senderPhoto: currentUserProfile?.photoUrl || "",
          referenceId: currentUserId,
          message: "started following your skills craft! ✦",
          read: false,
          createdAt: new Date()
        }).catch((e) => console.warn("Could not create notification doc:", e));
      }
    } catch (err) {
      console.warn("Fast batch follow sync failed, retrying with transaction fallback...", err);
      try {
        const currentUserRef = doc(db, "users", currentUserId);
        const targetUserRef = doc(db, "users", targetUserId);
        const followingDocRef = doc(db, "users", currentUserId, "following", targetUserId);
        const followerDocRef = doc(db, "users", targetUserId, "followers", currentUserId);

        await runTransaction(db, async (transaction) => {
          const curSnap = await transaction.get(currentUserRef);
          const tarSnap = await transaction.get(targetUserRef);
          if (curSnap.exists()) {
            const curData = curSnap.data();
            let curFollowing = curData.followingList || [];
            if (isCurrentlyFollowing) {
              curFollowing = curFollowing.filter((id: string) => id !== targetUserId);
            } else if (!curFollowing.includes(targetUserId)) {
              curFollowing.push(targetUserId);
            }
            transaction.update(currentUserRef, {
              followingList: curFollowing,
              followingCount: curFollowing.length
            });
          }
          if (tarSnap.exists()) {
            const tarData = tarSnap.data();
            const currentCount = typeof tarData.followersCount === "number" ? tarData.followersCount : 0;
            const nextCount = isCurrentlyFollowing ? Math.max(0, currentCount - 1) : currentCount + 1;
            if (nextCount !== currentCount) {
              transaction.update(targetUserRef, {
                followersCount: nextCount
              });
            }
          }
          if (isCurrentlyFollowing) {
            transaction.delete(followingDocRef);
            transaction.delete(followerDocRef);
          } else {
            transaction.set(followingDocRef, { followedAt: new Date() });
            transaction.set(followerDocRef, { followerAt: new Date() });
          }
        });
      } catch (retryErr) {
        console.error("Firestore follow sync failed, rolling back optimistic follow state", retryErr);
        fetchProfile(currentUserId);
        fetchProfile(targetUserId);
        throw retryErr;
      }
    } finally {
      inFlightFollowsRef.current.delete(targetUserId);
    }
  }, [firebaseUser, currentUserProfile, fetchProfile]);

  // 6. Optimistic Booking
  const bookSessionOptimistic = useCallback(async (sessionData: Omit<Session, "id" | "createdAt" | "status">): Promise<Session> => {
    const tempId = `temp_${Date.now()}`;
    const newSession: Session = {
      ...sessionData,
      id: tempId,
      status: "requested",
      createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }
    };

    // Optimistically update sessions list
    setSessions((prev) => {
      const updated = [newSession, ...prev];
      saveToCache("swap_cache_sessions", updated);
      return updated;
    });

    // Write to Firestore in background
    try {
      const sessRef = collection(db, "sessions");
      const serverDoc = {
        ...sessionData,
        status: "requested",
        createdAt: new Date()
      };
      
      const docRef = await addDoc(sessRef, serverDoc);
      
      // Replace temporary ID with actual server ID
      setSessions((prev) => {
        const updated = prev.map((s) => s.id === tempId ? { ...s, id: docRef.id } : s);
        saveToCache("swap_cache_sessions", updated);
        return updated;
      });

      // Send a notification to the teacher in background
      try {
        const notificationsRef = collection(db, "users", sessionData.teacherId, "notifications");
        await addDoc(notificationsRef, {
          type: "booking",
          senderId: sessionData.learnerId,
          senderName: sessionData.learnerName,
          senderPhoto: currentUserProfile?.photoUrl || "",
          referenceId: docRef.id,
          message: `requested a swap session for "${sessionData.skillName}"! 📅`,
          read: false,
          createdAt: new Date()
        });
      } catch (e) {
        console.warn("Could not send booking notification to teacher", e);
      }

      return { ...newSession, id: docRef.id };
    } catch (err) {
      console.error("Failed to sync session booking with Firestore:", err);
      // Rollback optimistic state
      setSessions((prev) => {
        const updated = prev.filter((s) => s.id !== tempId);
        saveToCache("swap_cache_sessions", updated);
        return updated;
      });
      throw err;
    }
  }, [currentUserProfile]);

  const value = useMemo(() => ({
    firebaseUser,
    currentUserProfile,
    loadingAuth,
    isOnline,
    discoveryUsers,
    loadingDiscovery,
    chats,
    loadingChats,
    sessions,
    notifications,
    profilesCache,
    hasMoreFeed,
    loadMoreFeed,
    soundPreferences,
    updateSoundPreferences,
    fetchProfile,
    updateProfile,
    toggleFollow,
    bookSessionOptimistic,
    refreshFeed,
    refreshSessions,
    refreshChats,
    setProfileInCache,
    messagesCache,
    setMessagesInCache,
    showLogoutConfirm,
    setShowLogoutConfirm,
    showDeleteConfirm,
    setShowDeleteConfirm
  }), [
    firebaseUser,
    currentUserProfile,
    loadingAuth,
    isOnline,
    discoveryUsers,
    loadingDiscovery,
    chats,
    loadingChats,
    sessions,
    notifications,
    profilesCache,
    hasMoreFeed,
    loadMoreFeed,
    soundPreferences,
    updateSoundPreferences,
    fetchProfile,
    updateProfile,
    toggleFollow,
    bookSessionOptimistic,
    refreshFeed,
    refreshSessions,
    refreshChats,
    setProfileInCache,
    messagesCache,
    setMessagesInCache,
    showLogoutConfirm,
    setShowLogoutConfirm,
    showDeleteConfirm,
    setShowDeleteConfirm
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used inside an AppContextProvider");
  }
  return context;
}
