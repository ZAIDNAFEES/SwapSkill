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
import { useElasticOverscroll } from "../hooks/useElasticOverscroll";

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
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listContentRef = useRef<HTMLDivElement>(null);

  useElasticOverscroll({
    scrollRef: listScrollRef,
    targetRef: listContentRef,
    allowTop: true,
    allowBottom: true,
  });

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
    <div className="flex flex-col h-full bg-[#F7F4EE] text-[#0D0D0F] font-sans relative">
      {/* Header */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-[#E8E4DB] bg-[#F7F4EE]/95 backdrop-blur-md flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-xl border border-[#E2DDD2] bg-[#FFFFFF] hover:bg-[#F2EFE8] flex items-center justify-center text-[#0D0D0F] transition active:scale-[0.98] cursor-pointer"
          aria-label="Back"
        >
          <ArrowLeft className="w-4.5 h-4.5" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="font-sans font-bold text-[16px] capitalize tracking-tight text-[#0D0D0F]">{type}</h3>
          <p className="text-[12px] text-[#71717A] tabular-nums">
            {userIds.length} {userIds.length === 1 ? "member" : "members"}
          </p>
        </div>
      </div>

      {/* Search Box */}
      <div className="px-4 sm:px-5 py-3 border-b border-[#E8E4DB] bg-[#FAF8F4] shrink-0">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717A]" />
          <input
            type="text"
            placeholder={`Search ${type}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-9 h-10 bg-[#FFFFFF] border border-[#E8E4DB] focus:border-[#0D0D0F] rounded-xl text-[13.5px] text-[#0D0D0F] placeholder-[#71717A] focus:outline-none transition"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-[#F2EFE8] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* List Container */}
      <div
        ref={listScrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 mobile-scroll overscroll-y-contain"
      >
        <div ref={listContentRef} className="flex flex-col gap-2.5 w-full">
        <LoadingTransition isLoading={loading} type="followers" count={4}>
          {filteredUserIds.length === 0 ? (
          <div className="py-16 flex flex-col items-center text-center text-[#71717A] gap-2">
            <div className="w-11 h-11 rounded-full bg-[#FFFFFF] border border-[#E8E4DB] flex items-center justify-center text-[#71717A] mb-1">
              <UserPlus className="w-5 h-5" />
            </div>
            <p className="text-[14px] font-semibold text-[#0D0D0F]">No members found</p>
            <p className="text-[12.5px] text-[#71717A] max-w-[220px] leading-relaxed">
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
                className="p-3.5 bg-[#FFFFFF] border border-[#E8E4DB] hover:border-[#D8D2C5] rounded-2xl flex items-center justify-between gap-3 cursor-pointer transition shadow-2xs"
              >
                {/* Left: Avatar with presence dot */}
                <div className="relative shrink-0">
                  <div className="w-11 h-11 rounded-full overflow-hidden border border-[#E8E4DB]">
                    <SmartImage
                      src={p.photoUrl || p.photoURL}
                      alt={p.fullName}
                      fallbackType="profile"
                      fullName={p.fullName}
                    />
                  </div>
                  {isOnline && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#FFFFFF] bg-emerald-500" />
                  )}
                </div>

                {/* Center: Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[14px] font-semibold text-[#0D0D0F] truncate max-w-[140px]">
                      {p.fullName}
                    </span>
                    {p.verified && (
                      <span className="w-3.5 h-3.5 rounded-full bg-[#0D0D0F] text-[#C9A96E] flex items-center justify-center inline-flex shrink-0">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <span className="text-[12px] text-[#71717A] block truncate font-normal">
                    @{p.username}
                  </span>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {!isMeRow && (
                    <>
                      {/* Message shortcut */}
                      <button
                        type="button"
                        onClick={(e) => handleMessageClick(id, e)}
                        className="w-9 h-9 rounded-xl border border-[#E2DDD2] bg-[#FFFFFF] hover:bg-[#FAF8F4] flex items-center justify-center text-[#0D0D0F] transition active:scale-[0.98] cursor-pointer"
                        title="Direct Message"
                        aria-label="Direct Message"
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>

                      {/* Follow toggle button */}
                      <FollowButton
                        isFollowing={isFollowingTarget}
                        isLoading={followLoadingMap[id]}
                        onClick={(e) => handleFollowClick(id, e)}
                        className="h-9 min-w-[96px] px-3 text-[12.5px]"
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
    </div>
  );
}
