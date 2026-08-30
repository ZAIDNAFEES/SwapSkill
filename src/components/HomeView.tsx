import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  updateDoc, 
  doc, 
  deleteDoc
} from "firebase/firestore";
import { db } from "../firebase";
import { UserProfile } from "../types";
import { useApp } from "../context/AppContext";
import { LoadingTransition } from "./SkeletonLoader";
import SmartImage from "./SmartImage";
import logoImg from "../assets/logo.jpg";
import { safeLocalStorage } from "../utils/safeStorage";
import { 
  Search, 
  ChevronRight, 
  Bell, 
  X, 
  CheckCheck, 
  Trash2, 
  AlertCircle,
  Zap,
  Compass,
  ArrowRight,
  Share2,
  Check,
  Sparkles,
  UserCheck,
  UserPlus
} from "lucide-react";

interface HomeViewProps {
  currentUserId: string;
  onSelectUser: (userId: string) => void;
  onNavigateToTab: (tab: "search" | "messages" | "sessions" | "profile") => void;
}

interface Notification {
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

export default function HomeView({ currentUserId, onSelectUser, onNavigateToTab }: HomeViewProps) {
  const { 
    discoveryUsers, 
    notifications, 
    refreshFeed, 
    currentUserProfile, 
    toggleFollow,
    hasMoreFeed,
    loadMoreFeed
  } = useApp();
  
  const [copied, setCopied] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [followingStates, setFollowingStates] = useState<Record<string, boolean>>({});

  // Infinite scroll observer
  const observerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMoreFeed) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreFeed();
        }
      },
      { threshold: 0.5 }
    );

    const currentRef = observerRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasMoreFeed, loadMoreFeed]);

  const loading = discoveryUsers.length === 0;

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  useEffect(() => {
    refreshFeed();
  }, [refreshFeed]);

  const handleSkillClick = (skill: string) => {
    try {
      safeLocalStorage.setItem("swap_pending_search", skill);
    } catch (_) {}
    onNavigateToTab("search");
  };

  const handleFollowToggle = async (userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentFollowing = followingStates[userId] !== undefined 
      ? followingStates[userId] 
      : (currentUserProfile?.followingList || []).includes(userId);
    
    setFollowingStates(prev => ({ ...prev, [userId]: !currentFollowing }));
    try {
      await toggleFollow(userId);
    } catch (err) {
      console.error("Follow toggle failed:", err);
      setFollowingStates(prev => ({ ...prev, [userId]: currentFollowing }));
    }
  };

  // 1. All other users (excluding self)
  const otherUsers = useMemo(() => {
    return discoveryUsers.filter(u => u.uid !== currentUserId);
  }, [discoveryUsers, currentUserId]);

  // 2. Recommended Peers (Main Profile Cards)
  const recommendedUsers = useMemo(() => {
    const myLearnSkills = (currentUserProfile?.skillsToLearn || []).map(s => s.toLowerCase().trim());
    const matches = otherUsers.filter(u => 
      u.skillsToTeach?.some(s => 
        myLearnSkills.some(myS => myS && s.toLowerCase().trim().includes(myS))
      )
    );
    const sorted = matches.length > 0 
      ? [...matches, ...otherUsers.filter(u => !matches.some(m => m.uid === u.uid))] 
      : otherUsers;
    return sorted.slice(0, 6);
  }, [otherUsers, currentUserProfile]);

  // Set of user IDs already displayed in Recommended section to guarantee ZERO duplicates across sections
  const recommendedUserIds = useMemo(() => {
    return new Set(recommendedUsers.map(u => u.uid));
  }, [recommendedUsers]);

  // 3. Active Now (Compact avatars only)
  const activeNowUsers = useMemo(() => {
    return otherUsers
      .filter(u => u.isOnline || (u.sessionsCount || 0) > 0)
      .slice(0, 8);
  }, [otherUsers]);

  // 4. Suggested Peers (Strictly users NOT already in recommended cards and NOT already followed)
  const suggestedPeers = useMemo(() => {
    const followingSet = new Set(currentUserProfile?.followingList || []);
    return otherUsers
      .filter(u => !recommendedUserIds.has(u.uid) && !followingSet.has(u.uid))
      .slice(0, 5);
  }, [otherUsers, recommendedUserIds, currentUserProfile]);

  const handleMarkAsRead = async (notifId: string) => {
    try {
      const notifDocRef = doc(db, "users", currentUserId, "notifications", notifId);
      await updateDoc(notifDocRef, { read: true });
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const unreadNotifs = notifications.filter(n => !n.read);
      for (const notif of unreadNotifs) {
        const notifDocRef = doc(db, "users", currentUserId, "notifications", notif.id);
        await updateDoc(notifDocRef, { read: true });
      }
    } catch (err) {
      console.error("Error marking all as read:", err);
    }
  };

  const handleClearNotification = async (notifId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const notifDocRef = doc(db, "users", currentUserId, "notifications", notifId);
      await deleteDoc(notifDocRef);
    } catch (err) {
      console.error("Error clearing notification:", err);
    }
  };

  const handleNotificationClick = (notif: Notification) => {
    handleMarkAsRead(notif.id);
    setShowNotifications(false);

    if (notif.type === "follower") {
      onSelectUser(notif.referenceId);
    } else if (notif.type === "booking") {
      onNavigateToTab("sessions");
    } else if (notif.type === "review") {
      onNavigateToTab("profile");
    }
  };

  const handleInvite = async () => {
    const inviteUrl = window.location.href;
    const inviteText = "Connect with me on SwapSkill, the peer skill exchange network.";
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: "SwapSkill - Skill Exchange",
          text: inviteText,
          url: inviteUrl
        });
      } catch (e) {
        console.log("Share cancelled");
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${inviteText}\n${inviteUrl}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch (err) {
        console.error("Failed to copy", err);
      }
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#F7F4EE] text-[#0D0D0F] font-sans pb-28 relative w-full overflow-x-hidden mobile-scroll">
      
      {/* Refined Minimal Top Bar */}
      <div className="border-b border-[#E8E4DB] bg-[#F7F4EE]/90 backdrop-blur-md sticky top-0 z-20 pt-safe">
        <div className="px-5 sm:px-8 py-3.5 w-full flex justify-between items-center max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-[#E8E4DB] rounded-lg overflow-hidden bg-[#FFFFFF] shadow-2xs flex items-center justify-center">
              <img src={logoImg} alt="SwapSkill" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-sans font-bold text-lg tracking-tight text-[#0D0D0F]">
                SwapSkill
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E]" />
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              id="home-notif-bell-btn"
              onClick={() => setShowNotifications(!showNotifications)}
              className="w-10 h-10 rounded-xl border border-[#E8E4DB] bg-[#FFFFFF] hover:bg-[#F2EFE8] flex items-center justify-center text-[#0D0D0F] transition relative cursor-pointer active:scale-95 shadow-2xs"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4 text-[#0D0D0F]" strokeWidth={1.8} />
              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-[#C9A96E] rounded-full ring-2 ring-white" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 px-4 sm:px-8 pt-6 w-full max-w-6xl mx-auto">
        
        <LoadingTransition isLoading={loading} type="feed" count={4}>
          {discoveryUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-24 px-4 max-w-sm mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] flex items-center justify-center mb-5 shadow-xs">
                <Share2 className="w-6 h-6 text-[#C9A96E]" strokeWidth={1.8} />
              </div>

              <h3 className="text-base font-semibold text-[#0D0D0F] mb-1.5 tracking-tight">
                No members found
              </h3>
              <p className="text-[#71717A] text-xs leading-relaxed mb-6">
                Invite peers to begin swapping skills and building sessions.
              </p>

              <button
                id="invite-friends-btn"
                onClick={handleInvite}
                className="luxury-button-primary px-5 py-2.5 text-xs flex items-center gap-2 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#C9A96E]" /> Link Copied
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5 text-[#C9A96E]" /> Share Invite
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-8 pb-12">
            
              {/* Minimal Search Trigger */}
              <div className="flex flex-col gap-3">
                <button
                  id="home-search-promo"
                  onClick={() => onNavigateToTab("search")}
                  className="w-full h-12 px-4 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] hover:border-[#D8D2C5] text-left flex items-center justify-between text-[#71717A] transition-all duration-150 shadow-2xs group cursor-pointer"
                >
                  <span className="text-xs sm:text-sm flex items-center gap-3 font-normal">
                    <Search className="w-4 h-4 text-[#71717A] group-hover:text-[#0D0D0F] transition-colors" strokeWidth={1.8} /> 
                    <span className="text-[#71717A]">Search skills, topics, mentors, languages...</span>
                  </span>
                  <span className="text-xs font-medium text-[#0D0D0F] bg-[#F2EFE8] px-3 py-1 rounded-lg border border-[#E8E4DB]">
                    Explore
                  </span>
                </button>

                {/* Quick Topic Chips */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {["All Disciplines", "Software Engineering", "Product Design", "Languages", "Brand Strategy", "Creative Arts", "Finance"].map((cat, idx) => (
                    <button
                      key={cat}
                      onClick={() => onNavigateToTab("search")}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150 cursor-pointer ${
                        idx === 0 
                          ? "bg-[#0D0D0F] text-[#F7F4EE] shadow-2xs" 
                          : "bg-[#FFFFFF] border border-[#E8E4DB] text-[#71717A] hover:text-[#0D0D0F] hover:bg-[#F2EFE8]"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Main Content Layout: Profile Cards on Left, Streamlined Sidebar on Right */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                
                {/* PRIMARY SHOWCASE: Recommended Peers */}
                <div className="lg:col-span-2 flex flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E]" />
                      <h2 className="text-xs font-semibold text-[#0D0D0F] uppercase tracking-wider">
                        Recommended Peers
                      </h2>
                    </div>
                    <button 
                      onClick={() => onNavigateToTab("search")}
                      className="text-xs text-[#71717A] hover:text-[#0D0D0F] font-medium transition cursor-pointer flex items-center gap-1"
                    >
                      <span>Explore all</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Spacious, uncluttered profile cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {recommendedUsers.map((user) => {
                      const followingList = currentUserProfile?.followingList || [];
                      const isFollowing = followingStates[user.uid] !== undefined 
                        ? followingStates[user.uid] 
                        : followingList.includes(user.uid);

                      const teaches = user.skillsToTeach || [];
                      const learns = user.skillsToLearn || [];

                      return (
                        <div
                          key={user.uid}
                          onClick={() => onSelectUser(user.uid)}
                          className="bg-[#FFFFFF] border border-[#E8E4DB] hover:border-[#D8D2C5] rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all duration-200 cursor-pointer shadow-2xs hover:shadow-xs group"
                        >
                          {/* Profile Header */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="relative shrink-0">
                                <SmartImage
                                  src={user.photoUrl || user.photoURL}
                                  alt={user.fullName}
                                  fallbackType="profile"
                                  fullName={user.fullName}
                                  sizeType="thumbnail"
                                  className="w-12 h-12 rounded-full border border-[#E8E4DB] object-cover"
                                />
                                {user.verified && (
                                  <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#0D0D0F] text-[#C9A96E] border border-[#C9A96E]/40 flex items-center justify-center text-[9px] font-bold">
                                    ✓
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-semibold text-sm text-[#0D0D0F] group-hover:text-[#C9A96E] transition-colors truncate">
                                  {user.fullName}
                                </h3>
                                <p className="text-[11px] text-[#71717A] truncate mt-0.5">
                                  {user.city ? user.city : `@${user.username || "member"}`}
                                </p>
                              </div>
                            </div>

                            {/* One Clear Connect Action */}
                            <button
                              id={`connect-btn-${user.uid}`}
                              onClick={(e) => handleFollowToggle(user.uid, e)}
                              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 cursor-pointer flex items-center gap-1.5 ${
                                isFollowing
                                  ? "glass-connected-btn"
                                  : "glass-connect-btn"
                              }`}
                              title={isFollowing ? "Connected" : "Connect"}
                            >
                              {isFollowing ? (
                                <>
                                  <UserCheck className="w-3.5 h-3.5 text-[#C9A96E] stroke-[2.2]" />
                                  <span className="text-[#0D0D0F]">Connected</span>
                                </>
                              ) : (
                                <>
                                  <UserPlus className="w-3.5 h-3.5 text-[#C9A96E] stroke-[2.2]" />
                                  <span className="text-[#0D0D0F]">Connect</span>
                                </>
                              )}
                            </button>
                          </div>

                          {/* Most Important Skills Only */}
                          <div className="flex flex-col gap-2 pt-2 border-t border-[#F2EFE8]">
                            {teaches.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-medium text-[#71717A] uppercase tracking-wider shrink-0">Offers:</span>
                                {teaches.slice(0, 2).map((s) => (
                                  <span key={s} className="px-2.5 py-0.5 rounded-md bg-[#F2EFE8] text-[#0D0D0F] text-[11px] font-medium truncate max-w-[140px]">
                                    {s}
                                  </span>
                                ))}
                                {teaches.length > 2 && (
                                  <span className="text-[10px] text-[#71717A] font-medium">+{teaches.length - 2}</span>
                                )}
                              </div>
                            )}

                            {learns.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-medium text-[#71717A] uppercase tracking-wider shrink-0">Seeks:</span>
                                {learns.slice(0, 2).map((s) => (
                                  <span key={s} className="px-2.5 py-0.5 rounded-md border border-[#E8E4DB] text-[#71717A] text-[11px] truncate max-w-[140px]">
                                    {s}
                                  </span>
                                ))}
                                {learns.length > 2 && (
                                  <span className="text-[10px] text-[#71717A] font-medium">+{learns.length - 2}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* SIDEBAR: Active Now (Compact Avatars) & Non-duplicate Suggested Peers */}
                <div className="lg:col-span-1 flex flex-col gap-6">
                  
                  {/* ACTIVE NOW: Compact Avatars Only */}
                  {activeNowUsers.length > 0 && (
                    <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-5 flex flex-col gap-3 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-[#C9A96E]" strokeWidth={1.8} />
                          <h3 className="text-xs font-semibold text-[#0D0D0F] uppercase tracking-wider">
                            Active Now
                          </h3>
                        </div>
                        <span className="w-2 h-2 rounded-full bg-[#C9A96E] animate-pulse" />
                      </div>

                      {/* Compact avatar rail */}
                      <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-none pt-1">
                        {activeNowUsers.map((user) => (
                          <div
                            key={user.uid}
                            onClick={() => onSelectUser(user.uid)}
                            className="flex flex-col items-center gap-1 shrink-0 cursor-pointer group"
                            title={user.fullName}
                          >
                            <div className="relative">
                              <SmartImage
                                src={user.photoUrl || user.photoURL}
                                alt={user.fullName}
                                fallbackType="profile"
                                fullName={user.fullName}
                                sizeType="thumbnail"
                                className="w-10 h-10 rounded-full border border-[#E8E4DB] object-cover group-hover:border-[#C9A96E] transition-all"
                              />
                              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#C9A96E] ring-2 ring-white" />
                            </div>
                            <span className="text-[10px] font-medium text-[#71717A] group-hover:text-[#0D0D0F] transition-colors truncate max-w-[54px] text-center">
                              {user.fullName.split(" ")[0]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SUGGESTED PEERS: Zero duplicates with recommended section */}
                  {suggestedPeers.length > 0 && (
                    <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-5 flex flex-col gap-3.5 shadow-2xs">
                      <div className="flex items-center gap-2">
                        <Compass className="w-4 h-4 text-[#C9A96E]" strokeWidth={1.8} />
                        <h3 className="text-xs font-semibold text-[#0D0D0F] uppercase tracking-wider">
                          Suggested Peers
                        </h3>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        {suggestedPeers.map((user) => {
                          const followingList = currentUserProfile?.followingList || [];
                          const isFollowing = followingStates[user.uid] !== undefined 
                            ? followingStates[user.uid] 
                            : followingList.includes(user.uid);

                          return (
                            <div
                              key={user.uid}
                              onClick={() => onSelectUser(user.uid)}
                              className="p-2.5 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-between gap-3 cursor-pointer hover:bg-[#F2EFE8] transition-all group"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <SmartImage
                                  src={user.photoUrl || user.photoURL}
                                  alt={user.fullName}
                                  fallbackType="profile"
                                  fullName={user.fullName}
                                  sizeType="thumbnail"
                                  className="w-9 h-9 rounded-full border border-[#E8E4DB] object-cover shrink-0"
                                />
                                <div className="min-w-0">
                                  <span className="font-semibold text-xs text-[#0D0D0F] block truncate group-hover:text-[#C9A96E] transition-colors">
                                    {user.fullName}
                                  </span>
                                  <span className="text-[10px] text-[#71717A] block truncate">
                                    {user.skillsToTeach?.[0] || "Peer"}
                                  </span>
                                </div>
                              </div>
                              <button
                                onClick={(e) => handleFollowToggle(user.uid, e)}
                                className={`px-3 py-1 rounded-xl text-xs font-semibold shrink-0 cursor-pointer flex items-center gap-1 ${
                                  isFollowing
                                    ? "glass-connected-btn text-[#0D0D0F]"
                                    : "glass-connect-btn text-[#0D0D0F]"
                                }`}
                              >
                                {isFollowing ? (
                                  <>
                                    <UserCheck className="w-3 h-3 text-[#C9A96E] stroke-[2.2]" />
                                    <span>Connected</span>
                                  </>
                                ) : (
                                  <>
                                    <UserPlus className="w-3 h-3 text-[#C9A96E] stroke-[2.2]" />
                                    <span>Connect</span>
                                  </>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Learning Path Quick Topics */}
                  <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-5 flex flex-col gap-3 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#C9A96E]" strokeWidth={1.8} />
                      <h3 className="text-xs font-semibold text-[#0D0D0F] uppercase tracking-wider">
                        Learning Path
                      </h3>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(currentUserProfile?.skillsToLearn && currentUserProfile.skillsToLearn.length > 0) ? (
                        currentUserProfile.skillsToLearn.map((skill) => (
                          <button
                            key={skill}
                            onClick={() => handleSkillClick(skill)}
                            className="px-3 py-1 bg-[#F7F4EE] hover:bg-[#F2EFE8] border border-[#E8E4DB] text-xs text-[#0D0D0F] rounded-lg transition cursor-pointer font-medium"
                          >
                            {skill}
                          </button>
                        ))
                      ) : (
                        ["Product Design", "TypeScript", "System Architecture", "Creative Arts", "AI"].map((skill) => (
                          <button
                            key={skill}
                            onClick={() => handleSkillClick(skill)}
                            className="px-3 py-1 bg-[#F7F4EE] hover:bg-[#F2EFE8] border border-[#E8E4DB] text-xs text-[#0D0D0F] rounded-lg transition cursor-pointer font-medium"
                          >
                            {skill}
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                </div>

              </div>

              {hasMoreFeed && (
                <div ref={observerRef} className="flex justify-center py-6">
                  <span className="text-xs text-[#71717A] tracking-wider animate-pulse font-medium">
                    Loading more members...
                  </span>
                </div>
              )}

            </div>
          )}
        </LoadingTransition>
      </div>

      {/* Notifications Drawer */}
      {showNotifications && (
        <div className="fixed inset-0 z-50 bg-[#0D0D0F]/40 backdrop-blur-xs flex justify-end animate-fade-in font-sans">
          <div className="w-full max-w-sm bg-[#FFFFFF] border-l border-[#E8E4DB] h-full flex flex-col relative z-50 shadow-2xl pb-24">
            
            {/* Drawer Header */}
            <div className="px-5 py-4 border-b border-[#E8E4DB] flex justify-between items-center bg-[#FFFFFF] sticky top-0">
              <div className="flex flex-col">
                <h3 className="font-semibold text-sm text-[#0D0D0F]">Activity & Notifications</h3>
                <span className="text-[10px] text-[#71717A] uppercase tracking-wider">{unreadCount} Unread</span>
              </div>
              <button 
                onClick={() => setShowNotifications(false)}
                className="w-8 h-8 rounded-lg border border-[#E8E4DB] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Notifications Feed */}
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2.5">
              <LoadingTransition isLoading={loading} type="notifications" count={3}>
                {notifications.length === 0 ? (
                  <div className="py-20 flex flex-col items-center text-center text-[#71717A] gap-2">
                    <AlertCircle className="w-7 h-7 text-[#71717A]/60" />
                    <p className="text-xs font-medium text-[#0D0D0F]">No new notifications</p>
                    <p className="text-[11px] text-[#71717A] max-w-[200px] leading-relaxed">
                      Session bookings, reviews, and connection requests will appear here.
                    </p>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`p-3.5 rounded-xl border transition-all duration-150 cursor-pointer relative group flex gap-3 items-center ${
                        notif.read 
                          ? "bg-[#FFFFFF] border-[#E8E4DB] hover:border-[#D8D2C5]" 
                          : "bg-[#F2EFE8] border-[#E8E4DB] hover:border-[#C9A96E]"
                      }`}
                    >
                      {!notif.read && (
                        <span className="absolute left-2.5 top-2.5 w-1.5 h-1.5 rounded-full bg-[#C9A96E]"></span>
                      )}

                      <div className="relative shrink-0">
                        <SmartImage
                          src={notif.senderPhoto}
                          alt={notif.senderName}
                          fallbackType="profile"
                          fullName={notif.senderName}
                          sizeType="thumbnail"
                          className="w-10 h-10 rounded-full border border-[#E8E4DB]"
                        />
                      </div>

                      <div className="flex-1 min-w-0 pr-6">
                        <p className="text-xs text-[#0D0D0F] leading-snug">
                          <span className="font-semibold">{notif.senderName}</span> {notif.message}
                        </p>
                        <span className="text-[10px] text-[#71717A] mt-1 block">
                          {notif.createdAt?.toDate ? notif.createdAt.toDate().toLocaleDateString([], { month: "short", day: "numeric" }) : "Recent"}
                        </span>
                      </div>

                      <button
                        onClick={(e) => handleClearNotification(notif.id, e)}
                        className="p-1.5 hover:bg-[#E8E4DB] rounded-lg text-[#71717A] hover:text-[#0D0D0F] absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition"
                        title="Dismiss"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </LoadingTransition>
            </div>

            {/* Footer */}
            {unreadCount > 0 && (
              <div className="p-4 border-t border-[#E8E4DB] bg-[#FFFFFF] sticky bottom-0 flex justify-end">
                <button
                  id="mark-all-read-btn"
                  onClick={handleMarkAllAsRead}
                  className="text-xs font-medium text-[#0D0D0F] hover:text-[#C9A96E] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <CheckCheck className="w-4 h-4 text-[#C9A96E]" /> Mark all as read
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
