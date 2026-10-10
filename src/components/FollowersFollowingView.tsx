import React, { useState, useEffect, useRef, useMemo } from "react";
import { collection, query, onSnapshot, doc, getDoc, getDocs, limit as firestoreLimit, setDoc } from "firebase/firestore";
import { ref as dbRef, onValue as dbOnValue } from "firebase/database";
import { db, rtdb } from "../firebase";
import { UserProfile } from "../types";
import { useApp } from "../context/AppContext";
import { getOrCreateConversation } from "../utils/conversationUtils";
import { SmartImage } from "./SmartImage";
import { ArrowLeft, Search, MessageSquare, Check, Sparkles, UserPlus, ShieldAlert, X } from "lucide-react";
import FollowButton from "./FollowButton";
import { motion, AnimatePresence } from "motion/react";
import SkeletonLoader, { LoadingTransition, Skeleton } from "./SkeletonLoader";

interface FollowersFollowingViewProps {
  userId: string;
  type: "followers" | "following";
  currentUserId: string;
  onClose: () => void;
  onSelectUser: (userId: string) => void;
  onOpenChat: (chatId: string) => void;
}

export default function FollowersFollowingView({
  userId,
  type,
  currentUserId,
  onClose,
  onSelectUser,
  onOpenChat
}: FollowersFollowingViewProps) {
  const { toggleFollow, currentUserProfile } = useApp();
  const [searchTerm, setSearchTerm] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [presenceMap, setPresenceMap] = useState<Record<string, { state: string; lastChanged: any }>>({});
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(15);
  const [followLoadingMap, setFollowLoadingMap] = useState<Record<string, boolean>>({});

  // 1. Listen to the followers/following subcollection to get uids in real time
  useEffect(() => {
    setLoading(true);
    const subcollRef = collection(db, "users", userId, type);
    const unsub = onSnapshot(subcollRef, (snapshot) => {
      const ids: string[] = [];
      snapshot.forEach((d) => {
        ids.push(d.id);
      });
      setUserIds(ids);
      setLoading(false);
    }, (err) => {
      console.error(`Error loading ${type}:`, err);
      setLoading(false);
    });

    return () => unsub();
  }, [userId, type]);

  // 2. Fetch profiles for uids that we don't have yet in real time
  useEffect(() => {
    if (userIds.length === 0) return;

    const unsubscribes: Array<() => void> = [];

    // Listen to each user profile in real-time
    userIds.forEach((id) => {
      const userDocRef = doc(db, "users", id);
      const unsubProfile = onSnapshot(userDocRef, (snap) => {
        if (snap.exists()) {
          const uData = snap.data() as UserProfile;
          setProfiles((prev) => ({ ...prev, [id]: uData }));
        }
      });
      unsubscribes.push(unsubProfile);

      // Listen to RTDB presence
      const presenceRef = dbRef(rtdb, `/status/${id}`);
      const unsubPresence = dbOnValue(presenceRef, (snap) => {
        const val = snap.val();
        if (val) {
          setPresenceMap((prev) => ({
            ...prev,
            [id]: { state: val.state, lastChanged: val.lastChanged }
          }));
        } else {
          setPresenceMap((prev) => ({
            ...prev,
            [id]: { state: "offline", lastChanged: null }
          }));
        }
      });
      unsubscribes.push(() => unsubPresence());
    });

    return () => {
      unsubscribes.forEach((u) => u());
    };
  }, [userIds]);

  // 3. Handle Follow Action inside list
  const handleFollowClick = async (targetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (followLoadingMap[targetId]) return;

    setFollowLoadingMap((prev) => ({ ...prev, [targetId]: true }));
    try {
      await toggleFollow(targetId);
    } catch (err) {
      console.error("Error toggling follow inside list:", err);
    } finally {
      setFollowLoadingMap((prev) => ({ ...prev, [targetId]: false }));
    }
  };

  // 4. Handle Message Button inside list
  const handleMessageClick = async (targetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!targetId || !currentUserId) return;

    try {
      const { chatId } = await getOrCreateConversation(
        currentUserId, 
        targetId, 
        "Conversation started ✦"
      );
      onOpenChat(chatId);
    } catch (err) {
      console.error("Error launching chat from followers list:", err);
    }
  };

  // Filter profiles based on search term
  const filteredUserIds = useMemo(() => {
    return userIds.filter((id) => {
      const p = profiles[id];
      if (!p) return true; // Keep loading placeholders
      const nameMatch = p.fullName?.toLowerCase().includes(searchTerm.toLowerCase());
      const usernameMatch = p.username?.toLowerCase().includes(searchTerm.toLowerCase());
      return nameMatch || usernameMatch;
    });
  }, [userIds, profiles, searchTerm]);

  // Slice list for infinite scroll
  const paginatedUserIds = useMemo(() => {
    return filteredUserIds.slice(0, visibleCount);
  }, [filteredUserIds, visibleCount]);

  // Handle infinite scrolling on scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 40) {
      if (visibleCount < filteredUserIds.length) {
        setVisibleCount((prev) => prev + 12);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-white text-gray-900 font-sans relative">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-200 bg-white/90 backdrop-blur-md flex items-center gap-3 shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl border border-gray-200 hover:border-gray-300 bg-gray-50 flex items-center justify-center text-gray-500 hover:text-gray-900 transition cursor-pointer"
        >
          <ArrowLeft className="w-4.5 h-4.5" />
        </button>
        <div className="flex-1">
          <h3 className="font-sans font-bold text-base capitalize tracking-tight text-gray-900">{type}</h3>
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
            {userIds.length} members total
          </p>
        </div>
      </div>

      {/* Search Box */}
      <div className="px-5 py-3 border-b border-gray-100 shrink-0">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={`Search ${type}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 h-10 bg-gray-50 border border-gray-200 focus:border-blue-500 rounded-xl text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition leading-none"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* List Container */}
      <div
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2.5"
      >
        <LoadingTransition isLoading={loading} type="followers" count={4}>
          {filteredUserIds.length === 0 ? (
          <div className="py-20 flex flex-col items-center text-center text-gray-400 gap-2">
            <UserPlus className="w-8 h-8 text-gray-300 animate-pulse" />
            <p className="text-xs font-mono uppercase tracking-widest text-gray-500 font-bold">No members found</p>
            <p className="text-xs text-gray-500 max-w-[200px] leading-relaxed">
              {searchTerm ? "Try adjusting your search criteria." : `This list is currently empty.`}
            </p>
          </div>
        ) : (
          paginatedUserIds.map((id) => {
            const p = profiles[id];
            const presence = presenceMap[id];
            const isOnline = presence?.state === "online";
            const currentFollowingList = currentUserProfile?.followingList || [];
            const isFollowingTarget = currentFollowingList.includes(id);

            if (!p) {
              // Individual placeholder while loading profile
              return (
                <div key={id} className="flex items-center gap-3 animate-pulse h-14">
                  <div className="w-11 h-11 bg-gray-200 rounded-full" />
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="h-3 bg-gray-200 rounded-md w-24" />
                    <div className="h-2.5 bg-gray-200 rounded-md w-16" />
                  </div>
                </div>
              );
            }

            const isMeRow = id === currentUserId;

            return (
              <motion.div
                key={id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => onSelectUser(id)}
                className="p-3 bg-white border border-gray-200 hover:bg-gray-50/80 rounded-2xl flex items-center justify-between gap-3 cursor-pointer transition shadow-xs"
              >
                {/* Left: Avatar with presence dot */}
                <div className="relative shrink-0">
                  <div className="w-11 h-11 rounded-full overflow-hidden border border-gray-200">
                    <SmartImage
                      src={p.photoUrl || p.photoURL}
                      alt={p.fullName}
                      fallbackType="profile"
                      fullName={p.fullName}
                    />
                  </div>
                  {/* Real-time online indicator dot */}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                    isOnline ? "bg-emerald-500" : "bg-gray-300"
                  }`} />
                </div>

                {/* Center: Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-sans font-bold text-gray-900 truncate max-w-[120px]">
                      {p.fullName}
                    </span>
                    {p.verified && (
                      <span className="w-3.5 h-3.5 rounded-full bg-amber-500 text-white flex items-center justify-center inline-flex shrink-0">
                        <Check className="w-2.5 h-2.5 stroke-[4]" />
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-500 block truncate font-medium">
                    @{p.username}
                  </span>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {!isMeRow && (
                    <>
                      {/* Message shortcut */}
                      <button
                        onClick={(e) => handleMessageClick(id, e)}
                        className="w-8 h-8 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-gray-100 transition cursor-pointer"
                        title="Direct Message"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>

                      {/* Follow toggle button */}
                      <FollowButton
                        isFollowing={isFollowingTarget}
                        isLoading={followLoadingMap[id]}
                        onClick={(e) => handleFollowClick(id, e)}
                        className="h-8 min-w-[90px] px-3 text-[11px]"
                      />
                    </>
                  )}
                </div>
              </motion.div>
            );
          })
        )}</LoadingTransition>

        {/* Infinite Scroll trigger area */}
        {filteredUserIds.length > visibleCount && (
          <div className="py-4 flex justify-center">
            <span className="w-5 h-5 rounded-full border-2 border-gray-200 border-t-blue-600 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
