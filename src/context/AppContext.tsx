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
  increment
} from "firebase/firestore";
import { auth, db } from "../firebase";
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
import { 
  consolidateConversations, 
  getParticipantKeyFromChat, 
  getTimestampSeconds 
} from "../utils/conversationUtils";

export interface Notification {
  id: string;
  type: "follower" | "booking" | "review" | "chat";
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

  // 1. Sync online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Trigger background sync when coming back online
      if (firebaseUser) {
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

    const updatePresence = async (status: "online" | "offline") => {
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        updatePresence("offline");
      } else {
        updatePresence("online");
      }
    };

    const handleBeforeUnload = () => {
      updatePresence("offline");
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
      updatePresence("online");
    }, 2000);

    // Heartbeat interval (checks activity & updates lastSeen)
    const interval = setInterval(() => {
      const idleTimeMins = (Date.now() - lastActivity) / 1000 / 60;
      if (document.visibilityState === "hidden" || idleTimeMins > 3) {
        updatePresence("offline");
      } else {
        updatePresence("online");
      }
    }, 20000);

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

  // Real-time Chat updater: Always sorts conversations by latest activity/message timestamp (lastMessageAt / lastMessageTime) descending
  // Consolidates multiple Firestore docs for the same two Firebase UIDs into one logical chat
  const updateChatsStably = useCallback((loadedChats: Chat[]) => {
    const currentUid = auth.currentUser?.uid || "";
    const consolidated = consolidateConversations(loadedChats, currentUid);

    if (!consolidated || consolidated.length === 0) {
      setChats((prev) => {
        if (prev.length === 0) return prev;
        saveToCacheDebounced("swap_cache_chats", [], 400);
        return [];
      });
      return;
    }

    // Always sort conversations by latest activity/message timestamp descending (newest on top #1).
    // If two chats have no messages or identical timestamps, keep their existing relative order.
    const sorted = [...consolidated].sort((a, b) => {
      const timeA = getChatTimestampValue(a);
      const timeB = getChatTimestampValue(b);
      if (timeB !== timeA) return timeB - timeA;
      return 0;
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
            p.lastMessageAt !== s.lastMessageAt ||
            p.lastMessageTime !== s.lastMessageTime ||
            (p.unreadCount?.[currentUid] || 0) !== (s.unreadCount?.[currentUid] || 0)
          ) {
            isSame = false;
            break;
          }
        }
        if (isSame) return prev;
      }
      saveToCacheDebounced("swap_cache_chats", sorted, 400);
      return sorted;
    });
  }, []);

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
          loaded.push({ ...docSnap.data(), id: docSnap.id, isLegacy: false } as Chat);
        });

        snapChats.forEach((docSnap) => {
          loaded.push({ ...docSnap.data(), id: docSnap.id, isLegacy: true } as Chat);
        });

        updateChatsStably(loaded);
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
    // 1. Silent preloads: only refresh feed if cached discovery feed is empty
    if (discoveryUsersRef.current.length === 0) {
      refreshFeed();
    }
    
    // Clean existing background timers & listeners
    backgroundTimersRef.current.forEach(t => clearTimeout(t));
    backgroundTimersRef.current = [];
    listenersRef.current.forEach(unsub => unsub());
    listenersRef.current = [];

    // Note: We deliberately DO NOT start a 25-user onSnapshot for discovery!
    // The feed uses refreshFeed() and pagination on demand, removing 25 duplicate reads on every startup.

    // 2. Real-time active chats + conversations list listener (Immediate for messaging responsive state)
    try {
      const chatsRef = collection(db, "chats");
      const qChats = query(chatsRef, where("participantIds", "array-contains", uid));
      
      const convsRef = collection(db, "conversations");
      const qConvs = query(convsRef, where("participantIds", "array-contains", uid));

      let legacyChatsList: Chat[] = [];
      let newConversationsList: Chat[] = [];

      const mergeAndSetChats = () => {
        const mergedRaw: Chat[] = [...newConversationsList, ...legacyChatsList];
        updateChatsStably(mergedRaw);
        setLoadingChats(false);
      };

      // Safety timeout: ensure loadingChats resolves even on slow initial network handshake
      const fallbackTimer = setTimeout(() => {
        setLoadingChats(false);
      }, 3500);

      const unsubChats = onSnapshot(qChats, (snapshot) => {
        clearTimeout(fallbackTimer);
        legacyChatsList = [];
        snapshot.forEach((docSnap) => {
          legacyChatsList.push({ ...docSnap.data(), id: docSnap.id, isLegacy: true } as Chat);
        });
        mergeAndSetChats();
      }, (err) => {
        clearTimeout(fallbackTimer);
        console.warn("Chats listener error:", err);
        setLoadingChats(false);
      });

      const unsubConvs = onSnapshot(qConvs, (snapshot) => {
        clearTimeout(fallbackTimer);
        newConversationsList = [];
        snapshot.forEach((docSnap) => {
          newConversationsList.push({ ...docSnap.data(), id: docSnap.id, isLegacy: false } as Chat);
        });
        mergeAndSetChats();
      }, (err) => {
        clearTimeout(fallbackTimer);
        console.warn("Conversations listener error:", err);
        setLoadingChats(false);
      });

      listenersRef.current.push(unsubChats);
      listenersRef.current.push(unsubConvs);
    } catch (e) {
      console.warn("Could not start chats/conversations list listener:", e);
      setLoadingChats(false);
    }

    // 3. Real-time notifications listener (Deferred 1000ms to background so startup render is prioritized)
    const notifTimer = setTimeout(() => {
      try {
        let isFirstNotifLoad = true;
        const notificationsRef = collection(db, "users", uid, "notifications");
        const qNotif = query(notificationsRef, orderBy("createdAt", "desc"), limit(30));
        const unsubNotif = onSnapshot(qNotif, (snapshot) => {
          const loaded: Notification[] = [];
          snapshot.forEach((docSnap) => {
            loaded.push({ ...docSnap.data(), id: docSnap.id } as Notification);
          });

          if (!isFirstNotifLoad) {
            snapshot.docChanges().forEach((change) => {
              if (change.type === "added") {
                const notifData = change.doc.data() as Notification;
                const notifType = (notifData.type || "").toLowerCase();
                const notifMsg = (notifData.message || "").toLowerCase();
                const sessId = (notifData as any).sessionId || change.doc.id;
                
                if (notifType === "booking" || notifType === "session_request" || notifMsg.includes("request") || notifMsg.includes("booked")) {
                  crossPlatformNotificationManager.notifySessionRequestReceived({
                    sessionId: sessId,
                    partnerName: notifData.senderName || (notifData as any).fromUserName || "A partner",
                    skillName: (notifData as any).skillName || "Skill Swap",
                  });
                } else if (notifType === "booking_accepted" || notifType === "session_accepted" || notifMsg.includes("accepted") || notifMsg.includes("confirmed")) {
                  crossPlatformNotificationManager.notifySessionAccepted({
                    sessionId: sessId,
                    partnerName: notifData.senderName || (notifData as any).fromUserName || "Your partner",
                    skillName: (notifData as any).skillName || "Skill Swap",
                  });
                } else if (notifType === "chat" || notifType === "message") {
                  const incomingChatId = (notifData as any).chatId || (notifData as any).referenceId || change.doc.id;
                  const senderId = notifData.senderId || (notifData as any).fromUserId;

                  // If user is currently inside this chat and viewing it on screen, suppress notification and sound
                  if (activeChatTrackingService.isChatCurrentlyOpenAndVisible(incomingChatId, senderId)) {
                    console.log(`[Notification] Suppressed chat notification for open chat: ${incomingChatId}`);
                  } else {
                    crossPlatformNotificationManager.notifyNewChatMessage({
                      chatId: incomingChatId,
                      senderName: notifData.senderName || (notifData as any).fromUserName || "New message",
                      messageText: notifData.message || "Sent you a message",
                      messageId: change.doc.id,
                    });
                  }
                } else if (notifType === "incoming_call" || notifType === "call") {
                  const callData = notifData as any;
                  const callId = callData.callId || (notifData as any).referenceId || change.doc.id;
                  if (callId) {
                    crossPlatformNotificationManager.notifyIncomingCall({
                      callId,
                      callerName: callData.callerName || notifData.senderName || (notifData as any).fromUserName || "A partner",
                      skillName: callData.skillName || "Skill Swap",
                      callType: callData.callType || "video",
                    });
                    window.dispatchEvent(new CustomEvent("swapskill_incoming_call_notif", { detail: { ...callData, callId } }));
                  }
                } else if (notifType === "call_cancelled" || notifType === "call_ended") {
                  const callId = (notifData as any).callId || (notifData as any).referenceId;
                  crossPlatformNotificationManager.notifyCallEnded({ callId });
                  window.dispatchEvent(new CustomEvent("swapskill_call_cancelled_notif", { detail: { callId } }));
                } else {
                  playNotificationSound(`notif_${change.doc.id}`);
                }
              }
            });
          }
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
        }, (err) => {
          console.warn("Notifications listener offline or permission issue:", err);
        });
        listenersRef.current.push(unsubNotif);
      } catch (e) {
        console.warn("Could not start real-time notifications listener:", e);
      }
    }, 1000);
    backgroundTimersRef.current.push(notifTimer);

    // 4. Real-time sessions listener (Deferred 1500ms to background so startup render is prioritized)
    const sessTimer = setTimeout(() => {
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
    }, 1500);
    backgroundTimersRef.current.push(sessTimer);
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
        
        // Start preloading and setting up real-time listener chains
        preloadData(user.uid);
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
    
    // Optimistic Update
    setCurrentUserProfile((prev) => {
      if (!prev) return null;
      const updated = { ...prev, ...data };
      saveToCache("swap_cache_user_profile", updated);
      return updated;
    });

    setProfilesCache((prev) => {
      const updated = { ...prev, [uid]: { ...prev[uid], ...data } as UserProfile };
      saveToCache("swap_cache_profiles_map", updated);
      return updated;
    });

    // Write to Firestore in background
    try {
      const userRef = doc(db, "users", uid);
      await updateDoc(userRef, data);
    } catch (err) {
      console.error("Failed to persist updated profile. Rolling back.", err);
      // Re-fetch correct state from server
      const docRef = doc(db, "users", uid);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const original = snap.data() as UserProfile;
        setCurrentUserProfile(original);
        setProfileInCache(original);
      }
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

      batch.update(targetUserRef, {
        followersList: isCurrentlyFollowing ? arrayRemove(currentUserId) : arrayUnion(currentUserId),
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
            let tarFollowers = tarData.followersList || [];
            if (isCurrentlyFollowing) {
              tarFollowers = tarFollowers.filter((id: string) => id !== currentUserId);
            } else if (!tarFollowers.includes(currentUserId)) {
              tarFollowers.push(currentUserId);
            }
            transaction.update(targetUserRef, {
              followersList: tarFollowers,
              followersCount: tarFollowers.length
            });
          }
        });
      } catch (retryErr) {
        console.error("Firestore follow sync failed, rolling back optimistic follow state", retryErr);
        fetchProfile(currentUserId);
        fetchProfile(targetUserId);
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
