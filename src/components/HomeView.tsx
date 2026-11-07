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
  UserPlus,
  Repeat,
  Star,
  Clock,
  Filter,
  Plus,
  BookOpen,
  RefreshCw,
  Send,
  MessageSquare,
  Shield
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

interface CommunitySwapRequest {
  id: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  userLocation?: string;
  seekingSkill: string;
  offeringSkill: string;
  duration: number; // in minutes
  note: string;
  timeAgo: string;
  isCurrentUser?: boolean;
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
  
  // Feed Filtering & Endless Discovery states
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>("All Disciplines");
  const [activeFeedTab, setActiveFeedTab] = useState<"all" | "match" | "top" | "active">("all");
  const [shuffleKey, setShuffleKey] = useState<number>(0);
  
  // Live Swap Request Modal & Local State
  const [showPostRequestModal, setShowPostRequestModal] = useState(false);
  const [requestSeeking, setRequestSeeking] = useState("");
  const [requestOffering, setRequestOffering] = useState("");
  const [requestDuration, setRequestDuration] = useState<number>(30);
  const [requestNote, setRequestNote] = useState("");
  const [userCreatedRequests, setUserCreatedRequests] = useState<CommunitySwapRequest[]>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_user_posted_requests");
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

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
      { threshold: 0.3 }
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

  // Unique notifications with guaranteed distinct ids
  const uniqueNotifications = useMemo(() => {
    const seen = new Set<string>();
    const list: Notification[] = [];
    (notifications || []).forEach((notif, idx) => {
      const id = notif.id || `notif-${idx}`;
      if (!seen.has(id)) {
        seen.add(id);
        list.push({ ...notif, id });
      }
    });
    return list;
  }, [notifications]);

  const unreadCount = useMemo(() => {
    return (uniqueNotifications || []).filter((n) => !n.read).length;
  }, [uniqueNotifications]);

  useEffect(() => {
    if (discoveryUsers.length === 0) {
      refreshFeed();
    }
  }, [refreshFeed, discoveryUsers.length]);

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

  // 1. All other users (excluding self and deduplicating by unique uid)
  const otherUsers = useMemo(() => {
    const seen = new Set<string>();
    const list: UserProfile[] = [];
    (discoveryUsers || []).forEach((u, idx) => {
      const uid = u?.uid || `user-${idx}`;
      if (uid && uid !== currentUserId && !seen.has(uid)) {
        seen.add(uid);
        list.push({ ...u, uid });
      }
    });
    return list;
  }, [discoveryUsers, currentUserId]);

  // 2. Recommended Peers (Hero Spotlight)
  const recommendedUsers = useMemo(() => {
    const myLearnSkills = (currentUserProfile?.skillsToLearn || []).map(s => s.toLowerCase().trim());
    const matches = (otherUsers || []).filter(u => 
      u.skillsToTeach?.some(s => 
        myLearnSkills.some(myS => myS && s.toLowerCase().trim().includes(myS))
      )
    );
    const combined = matches.length > 0 
      ? [...matches, ...otherUsers.filter(u => !matches.some(m => m.uid === u.uid))] 
      : otherUsers;
    const seen = new Set<string>();
    const uniqueList: UserProfile[] = [];
    combined.forEach((u) => {
      if (u.uid && !seen.has(u.uid)) {
        seen.add(u.uid);
        uniqueList.push(u);
      }
    });
    return uniqueList.slice(0, 4);
  }, [otherUsers, currentUserProfile]);

  // Set of user IDs already displayed in Recommended section to prevent repetition
  const recommendedUserIds = useMemo(() => {
    return new Set(recommendedUsers.map(u => u.uid));
  }, [recommendedUsers]);

  // 3. Active Now (Compact avatars only)
  const activeNowUsers = useMemo(() => {
    return otherUsers
      .filter(u => u.isOnline || (u.sessionsCount || 0) > 0)
      .slice(0, 8);
  }, [otherUsers]);

  // 4. Suggested Peers
  const suggestedPeers = useMemo(() => {
    const followingSet = new Set(currentUserProfile?.followingList || []);
    return otherUsers
      .filter(u => !recommendedUserIds.has(u.uid) && !followingSet.has(u.uid))
      .slice(0, 5);
  }, [otherUsers, recommendedUserIds, currentUserProfile]);

  // 5. Endless Discovery Peers Stream (All remaining peers + full catalog with filter tabs)
  const endlessPeers = useMemo(() => {
    let pool = otherUsers.filter(u => !recommendedUserIds.has(u.uid));
    
    // If pool is small, include all other users so feed never feels barren
    if (pool.length < 3) {
      pool = otherUsers;
    }

    // Apply discipline filter
    if (selectedDiscipline !== "All Disciplines") {
      const disc = selectedDiscipline.toLowerCase();
      pool = pool.filter(u => {
        const teachStr = (u.skillsToTeach || []).join(" ").toLowerCase();
        const learnStr = (u.skillsToLearn || []).join(" ").toLowerCase();
        if (disc.includes("software") || disc.includes("tech")) {
          return teachStr.includes("python") || teachStr.includes("react") || teachStr.includes("code") || teachStr.includes("dev") || teachStr.includes("data");
        }
        if (disc.includes("design")) {
          return teachStr.includes("design") || teachStr.includes("ui") || teachStr.includes("ux") || teachStr.includes("figma");
        }
        if (disc.includes("language")) {
          return teachStr.includes("english") || teachStr.includes("hindi") || teachStr.includes("spanish") || teachStr.includes("french") || teachStr.includes("german");
        }
        return teachStr.includes(disc) || learnStr.includes(disc);
      });
      // Fallback if filter leaves empty
      if (pool.length === 0) pool = otherUsers;
    }

    // Apply tab filter
    if (activeFeedTab === "match") {
      const myLearn = (currentUserProfile?.skillsToLearn || []).map(s => s.toLowerCase());
      const filtered = pool.filter(u => 
        (u.skillsToTeach || []).some(s => myLearn.some(m => s.toLowerCase().includes(m)))
      );
      if (filtered.length > 0) pool = filtered;
    } else if (activeFeedTab === "top") {
      pool = [...pool].sort((a, b) => {
        const ratingB = (b.reviewCount && b.reviewCount > 0) ? (b.rating || 0) : 0;
        const ratingA = (a.reviewCount && a.reviewCount > 0) ? (a.rating || 0) : 0;
        return ratingB - ratingA;
      });
    } else if (activeFeedTab === "active") {
      pool = [...pool].sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0));
    }

    // Apply shuffle seed when user taps shuffle
    if (shuffleKey > 0) {
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = (i * 7 + shuffleKey) % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }

    return pool;
  }, [otherUsers, recommendedUserIds, selectedDiscipline, activeFeedTab, shuffleKey, currentUserProfile]);

  // 6. Community Swap Requests (Strictly authentic user posts only - no fake generated requests)
  const communitySwapRequests = useMemo(() => {
    return userCreatedRequests;
  }, [userCreatedRequests]);

  const handleCreateSwapRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestSeeking.trim() || !requestOffering.trim()) return;

    const newReq: CommunitySwapRequest = {
      id: `my-req-${Date.now()}`,
      userId: currentUserId,
      userName: currentUserProfile?.fullName || "You",
      userPhoto: currentUserProfile?.photoUrl || currentUserProfile?.photoURL,
      userLocation: currentUserProfile?.city || "Your City",
      seekingSkill: requestSeeking.trim(),
      offeringSkill: requestOffering.trim(),
      duration: requestDuration,
      note: requestNote.trim() || `Eager to learn ${requestSeeking.trim()} and can teach ${requestOffering.trim()} in return!`,
      timeAgo: "Just now",
      isCurrentUser: true,
    };

    const updated = [newReq, ...userCreatedRequests];
    setUserCreatedRequests(updated);
    try {
      safeLocalStorage.setItem("swap_user_posted_requests", JSON.stringify(updated));
    } catch (_) {}

    setRequestSeeking("");
    setRequestOffering("");
    setRequestNote("");
    setShowPostRequestModal(false);
  };

  const handleDeleteUserRequest = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = userCreatedRequests.filter(r => r.id !== id);
    setUserCreatedRequests(updated);
    try {
      safeLocalStorage.setItem("swap_user_posted_requests", JSON.stringify(updated));
    } catch (_) {}
  };

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
      const unreadNotifs = (notifications || []).filter(n => !n.read);
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
    <div className="flex flex-col min-h-[100dvh] bg-[#F7F4EE] text-[#0D0D0F] font-sans pb-32 relative w-full overflow-x-hidden mobile-scroll">
      
      {/* Refined Minimal Top Bar */}
      <div 
        className="border-b border-[#E8E4DB] bg-[#F7F4EE]/90 backdrop-blur-md sticky top-0 z-20 pt-safe"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0px)" }}
      >
        <div className="px-4 sm:px-8 py-3.5 w-full flex justify-between items-center max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-[#E8E4DB] rounded-lg overflow-hidden bg-[#FFFFFF] shadow-2xs flex items-center justify-center shrink-0">
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
      <div className="flex-1 px-4 sm:px-8 pt-5 w-full max-w-6xl mx-auto">
        
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
            <div className="flex flex-col gap-7 sm:gap-9 pb-12 w-full">
            
              {/* Minimal Search Trigger */}
              <div className="flex flex-col gap-3 w-full">
                <button
                  id="home-search-promo"
                  onClick={() => onNavigateToTab("search")}
                  className="w-full h-12 px-4 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] hover:border-[#D8D2C5] text-left flex items-center justify-between text-[#71717A] transition-all duration-150 shadow-2xs group cursor-pointer gap-2"
                >
                  <span className="text-xs sm:text-sm flex items-center gap-2.5 font-normal min-w-0 flex-1">
                    <Search className="w-4 h-4 text-[#71717A] group-hover:text-[#0D0D0F] transition-colors shrink-0" strokeWidth={1.8} /> 
                    <span className="text-[#71717A] truncate">Search skills, topics, mentors, languages...</span>
                  </span>
                  <span className="text-xs font-medium text-[#0D0D0F] bg-[#F2EFE8] px-3 py-1 rounded-lg border border-[#E8E4DB] shrink-0">
                    Explore
                  </span>
                </button>

                {/* Quick Topic Chips - Edge-to-edge smooth horizontal scroll */}
                <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar scroll-smooth">
                  <div className="flex items-center gap-2 pb-1 pt-0.5 w-max min-w-full">
                    {["All Disciplines", "Software Engineering", "Product Design", "Languages", "Brand Strategy", "Creative Arts", "Finance"].map((cat) => (
                      <button
                        key={`topic-chip-${cat}`}
                        onClick={() => setSelectedDiscipline(cat)}
                        className={`h-9 px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 transition-all duration-150 cursor-pointer inline-flex items-center justify-center active:scale-95 ${
                          selectedDiscipline === cat
                            ? "bg-[#0D0D0F] text-[#F7F4EE] shadow-2xs font-semibold" 
                            : "bg-[#FFFFFF] border border-[#E8E4DB] text-[#71717A] hover:text-[#0D0D0F] hover:bg-[#F2EFE8]"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Main Content Layout: Profile Cards on Left, Streamlined Sidebar on Right */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                
                {/* PRIMARY SHOWCASE: Top Matches For You */}
                <div className="lg:col-span-2 flex flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E]" />
                      <h2 className="text-xs font-semibold text-[#0D0D0F] uppercase tracking-wider">
                        Top Matches For You
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
                    {recommendedUsers.map((user, uIdx) => {
                      const followingList = currentUserProfile?.followingList || [];
                      const isFollowing = followingStates[user.uid] !== undefined 
                        ? followingStates[user.uid] 
                        : followingList.includes(user.uid);

                      const teaches = user.skillsToTeach || [];
                      const learns = user.skillsToLearn || [];

                      return (
                        <div
                          key={user.uid ? `rec-user-${user.uid}` : `rec-user-idx-${uIdx}`}
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

                          {/* Most Important Skills Only with Mastery Levels */}
                          <div className="flex flex-col gap-2 pt-2 border-t border-[#F2EFE8]">
                            {teaches.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-medium text-[#71717A] uppercase tracking-wider shrink-0">Offers:</span>
                                {teaches.slice(0, 2).map((s, sIdx) => {
                                  const prof = user.skillProficiencies?.[s];
                                  const levelIcon = prof === "Beginner" ? "🌱" : prof === "Intermediate" ? "⚡" : prof === "Advanced" ? "🚀" : prof === "Expert" ? "🏆" : null;
                                  return (
                                    <span key={`teach-${user.uid || uIdx}-${s}-${sIdx}`} className="px-2.5 py-0.5 rounded-md bg-[#F2EFE8] text-[#0D0D0F] text-[11px] font-medium truncate max-w-[155px] inline-flex items-center gap-1">
                                      <span className="truncate">{s}</span>
                                      {prof && (
                                        <span className="text-[9px] font-bold text-[#C9A96E] bg-white px-1.5 py-0.2 rounded border border-[#E8E4DB] shrink-0 inline-flex items-center gap-0.5">
                                          <span>{levelIcon}</span>
                                          <span>{prof}</span>
                                        </span>
                                      )}
                                    </span>
                                  );
                                })}
                                {teaches.length > 2 && (
                                  <span className="text-[10px] text-[#71717A] font-medium">+{teaches.length - 2}</span>
                                )}
                              </div>
                            )}

                            {learns.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-medium text-[#71717A] uppercase tracking-wider shrink-0">Seeks:</span>
                                {learns.slice(0, 2).map((s, sIdx) => {
                                  const targetLvl = (user as any).learnSkillLevels?.[s];
                                  return (
                                    <span key={`learn-${user.uid || uIdx}-${s}-${sIdx}`} className="px-2.5 py-0.5 rounded-md border border-[#E8E4DB] text-[#71717A] text-[11px] truncate max-w-[150px] inline-flex items-center gap-1">
                                      <span className="truncate">{s}</span>
                                      {targetLvl && targetLvl !== "Any Level" && (
                                        <span className="text-[8px] font-medium text-[#71717A] bg-[#F7F4EE] px-1 rounded">
                                          {targetLvl}
                                        </span>
                                      )}
                                    </span>
                                  );
                                })}
                                {learns.length > 2 && (
                                  <span className="text-[10px] text-[#71717A] font-medium">+{learns.length - 2}</span>
                                )}
                              </div>
                            )}

                            {/* Mutual Agenda Trust Badge */}
                            <div className="flex items-center justify-between text-[10px] text-[#71717A] pt-1">
                              <span className="inline-flex items-center gap-1 text-[#C9A96E] font-medium">
                                <Shield className="w-3 h-3 text-[#C9A96E]" /> Mutual Agenda Protected
                              </span>
                              <span className="font-semibold text-[#0D0D0F]">
                                {(user.reviewCount && user.reviewCount > 0 && user.rating && user.rating > 0)
                                  ? `★ ${user.rating.toFixed(1)} (${user.reviewCount})`
                                  : "Available for Swap"}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* SIDEBAR: Active Now, Suggested Peers & Learning Path */}
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
                        {activeNowUsers.map((user, aIdx) => (
                          <div
                            key={user.uid ? `active-user-${user.uid}` : `active-user-idx-${aIdx}`}
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
                        {suggestedPeers.map((user, pIdx) => {
                          const followingList = currentUserProfile?.followingList || [];
                          const isFollowing = followingStates[user.uid] !== undefined 
                            ? followingStates[user.uid] 
                            : followingList.includes(user.uid);

                          return (
                            <div
                              key={user.uid ? `peer-user-${user.uid}` : `peer-user-idx-${pIdx}`}
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
                        currentUserProfile.skillsToLearn.map((skill, sIdx) => (
                          <button
                            key={`learn-path-${skill}-${sIdx}`}
                            onClick={() => handleSkillClick(skill)}
                            className="px-3 py-1 bg-[#F7F4EE] hover:bg-[#F2EFE8] border border-[#E8E4DB] text-xs text-[#0D0D0F] rounded-lg transition cursor-pointer font-medium"
                          >
                            {skill}
                          </button>
                        ))
                      ) : (
                        ["Product Design", "TypeScript", "System Architecture", "Creative Arts", "AI"].map((skill, sIdx) => (
                          <button
                            key={`default-path-${skill}-${sIdx}`}
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

              {/* ========================================================================= */}
              {/* NEW SECTION 1: LIVE COMMUNITY SWAP REQUESTS BOARD                         */}
              {/* High-engagement peer learning opportunities with "+ Post Request" modal   */}
              {/* ========================================================================= */}
              <div className="flex flex-col gap-4 pt-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-[#C9A96E]/15 border border-[#C9A96E]/30 flex items-center justify-center text-[#C9A96E]">
                      <Repeat className="w-4 h-4 stroke-[2.2]" />
                    </div>
                    <div>
                      <h2 className="text-sm sm:text-base font-bold text-[#0D0D0F] tracking-tight">
                        Live Swap Requests
                      </h2>
                      <p className="text-[11px] text-[#71717A]">
                        Real-time skill trade requests from the community
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowPostRequestModal(true)}
                    className="px-3.5 py-1.5 rounded-xl bg-[#0D0D0F] hover:bg-[#1f2024] active:scale-95 text-[#F7F4EE] text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#C9A96E]" />
                    <span>Post Request</span>
                  </button>
                </div>

                {/* Horizontal Swipeable Requests Cards or Empty State */}
                {communitySwapRequests.length > 0 ? (
                  <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar scroll-smooth pb-2 pt-1">
                    <div className="flex items-stretch gap-3.5 w-max">
                      {communitySwapRequests.map((req) => (
                        <div
                          key={req.id}
                          onClick={() => {
                            if (!req.isCurrentUser) onSelectUser(req.userId);
                          }}
                          className={`w-72 sm:w-80 rounded-2xl p-4 bg-[#FFFFFF] border transition-all duration-200 flex flex-col justify-between shadow-2xs hover:shadow-xs group cursor-pointer relative ${
                            req.isCurrentUser 
                              ? "border-[#C9A96E] ring-1 ring-[#C9A96E]/20" 
                              : "border-[#E8E4DB] hover:border-[#D8D2C5]"
                          }`}
                        >
                          {req.isCurrentUser && (
                            <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-[#C9A96E] bg-[#C9A96E]/10 px-2 py-0.5 rounded-full border border-[#C9A96E]/30">
                                Your Post
                              </span>
                              <button
                                onClick={(e) => handleDeleteUserRequest(req.id, e)}
                                className="text-[#71717A] hover:text-rose-600 p-0.5 transition"
                                title="Delete request"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                          <div>
                            {/* Request Header */}
                            <div className="flex items-center gap-2.5 mb-3">
                              <SmartImage
                                src={req.userPhoto}
                                alt={req.userName}
                                fallbackType="profile"
                                fullName={req.userName}
                                sizeType="thumbnail"
                                className="w-9 h-9 rounded-full border border-[#E8E4DB] object-cover shrink-0"
                              />
                              <div className="min-w-0 pr-8">
                                <span className="font-semibold text-xs text-[#0D0D0F] block truncate group-hover:text-[#C9A96E] transition-colors">
                                  {req.userName}
                                </span>
                                <div className="flex items-center gap-2 text-[10px] text-[#71717A]">
                                  <span>{req.userLocation}</span>
                                  <span>•</span>
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5" /> {req.duration}m
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Swap Trade Badge */}
                            <div className="p-2.5 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-between gap-2 mb-2.5">
                              <div className="flex-1 min-w-0">
                                <span className="text-[9px] font-bold text-[#71717A] uppercase tracking-wider block">Wants:</span>
                                <span className="text-xs font-semibold text-[#0D0D0F] truncate block">
                                  {req.seekingSkill}
                                </span>
                              </div>
                              <div className="w-5 h-5 rounded-full bg-[#FFFFFF] border border-[#E8E4DB] flex items-center justify-center text-[#C9A96E] shrink-0">
                                <Repeat className="w-3 h-3" />
                              </div>
                              <div className="flex-1 min-w-0 text-right">
                                <span className="text-[9px] font-bold text-[#C9A96E] uppercase tracking-wider block">Offers:</span>
                                <span className="text-xs font-semibold text-[#0D0D0F] truncate block">
                                  {req.offeringSkill}
                                </span>
                              </div>
                            </div>

                            <p className="text-[11px] text-[#71717A] line-clamp-2 leading-relaxed">
                              {req.note}
                            </p>
                          </div>

                          {/* Action CTA */}
                          <div className="mt-3 pt-2.5 border-t border-[#F2EFE8] flex items-center justify-between">
                            <span className="text-[10px] text-[#71717A]">{req.timeAgo}</span>
                            {!req.isCurrentUser ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectUser(req.userId);
                                }}
                                className="px-3 py-1 rounded-lg bg-[#0D0D0F] hover:bg-[#C9A96E] text-white hover:text-[#0D0D0F] text-[11px] font-semibold transition active:scale-95 flex items-center gap-1 cursor-pointer"
                              >
                                <span>Propose Swap</span>
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            ) : (
                              <span className="text-[10px] font-medium text-emerald-600 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live in feed
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] text-center flex flex-col items-center justify-center gap-2 shadow-2xs">
                    <div className="w-10 h-10 rounded-full bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-center text-[#C9A96E]">
                      <Repeat className="w-4 h-4 stroke-[2.2]" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-[#0D0D0F]">No Active Swap Requests</h4>
                      <p className="text-[11px] text-[#71717A] max-w-xs mt-0.5">
                        Post what you want to learn and what you can teach to connect with peers.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowPostRequestModal(true)}
                      className="px-3.5 py-1.5 rounded-xl bg-[#0D0D0F] text-[#F7F4EE] text-xs font-semibold hover:bg-[#1f2024] transition flex items-center gap-1.5 cursor-pointer mt-1"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#C9A96E]" />
                      <span>Create Request</span>
                    </button>
                  </div>
                )}
              </div>

              {/* ========================================================================= */}
              {/* DISCOVERY STREAM: Live search, filter tabs and peer community cards       */}
              {/* ========================================================================= */}
              <div className="flex flex-col gap-5 pt-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#0D0D0F]" />
                    <h2 className="text-sm sm:text-base font-bold text-[#0D0D0F] tracking-tight">
                      Explore All Peers & Swappers
                    </h2>
                    <span className="text-xs font-semibold text-[#71717A] bg-[#FFFFFF] border border-[#E8E4DB] px-2.5 py-0.5 rounded-full">
                      {endlessPeers.length} Available
                    </span>
                  </div>

                  {/* Filter Tabs */}
                  <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] shadow-2xs">
                    <button
                      onClick={() => setActiveFeedTab("all")}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        activeFeedTab === "all"
                          ? "bg-[#0D0D0F] text-[#F7F4EE]"
                          : "text-[#71717A] hover:text-[#0D0D0F]"
                      }`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setActiveFeedTab("match")}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1 ${
                        activeFeedTab === "match"
                          ? "bg-[#0D0D0F] text-[#F7F4EE]"
                          : "text-[#71717A] hover:text-[#0D0D0F]"
                      }`}
                    >
                      <Sparkles className="w-3 h-3 text-[#C9A96E]" /> Matches
                    </button>
                    <button
                      onClick={() => setActiveFeedTab("top")}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        activeFeedTab === "top"
                          ? "bg-[#0D0D0F] text-[#F7F4EE]"
                          : "text-[#71717A] hover:text-[#0D0D0F]"
                      }`}
                    >
                      Top Rated
                    </button>
                    <button
                      onClick={() => setActiveFeedTab("active")}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        activeFeedTab === "active"
                          ? "bg-[#0D0D0F] text-[#F7F4EE]"
                          : "text-[#71717A] hover:text-[#0D0D0F]"
                      }`}
                    >
                      Active
                    </button>
                  </div>
                </div>

                {/* Endless Peer Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {endlessPeers.map((user, idx) => {
                    const followingList = currentUserProfile?.followingList || [];
                    const isFollowing = followingStates[user.uid] !== undefined 
                      ? followingStates[user.uid] 
                      : followingList.includes(user.uid);

                    const teaches = user.skillsToTeach || [];
                    const learns = user.skillsToLearn || [];

                    return (
                      <div
                        key={`endless-${user.uid}-${idx}`}
                        onClick={() => onSelectUser(user.uid)}
                        className="bg-[#FFFFFF] border border-[#E8E4DB] hover:border-[#D8D2C5] rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all duration-200 cursor-pointer shadow-2xs hover:shadow-xs group"
                      >
                        {/* Card Header */}
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
                              {user.isOnline && (
                                <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#C9A96E] ring-2 ring-white" />
                              )}
                              {user.verified && !user.isOnline && (
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
                                {user.city ? `${user.city}` : `@${user.username || "member"}`}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1">
                                {user.rating && user.rating > 0 && user.reviewCount && user.reviewCount > 0 ? (
                                  <>
                                    <Star className="w-3 h-3 fill-[#C9A96E] stroke-[#C9A96E]" />
                                    <span className="text-[11px] font-bold text-[#0D0D0F]">{user.rating.toFixed(1)}</span>
                                    <span className="text-[10px] text-[#71717A]">({user.reviewCount} {user.reviewCount === 1 ? "review" : "reviews"})</span>
                                  </>
                                ) : (user.sessionsCount && user.sessionsCount > 0) ? (
                                  <span className="text-[10px] text-[#71717A]">
                                    {user.sessionsCount} {user.sessionsCount === 1 ? "swap" : "swaps"}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-[#71717A] bg-[#F7F4EE] px-1.5 py-0.5 rounded border border-[#E8E4DB]">
                                    New Member
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={(e) => handleFollowToggle(user.uid, e)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 cursor-pointer flex items-center gap-1.5 ${
                              isFollowing
                                ? "glass-connected-btn"
                                : "glass-connect-btn"
                            }`}
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

                        {/* Bio snippet if available */}
                        {user.bio && (
                          <p className="text-xs text-[#71717A] line-clamp-2 leading-relaxed">
                            {user.bio}
                          </p>
                        )}

                        {/* Skills Section with Real Mastery Levels */}
                        <div className="flex flex-col gap-2 pt-2 border-t border-[#F2EFE8]">
                          {teaches.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-bold text-[#0D0D0F] uppercase tracking-wider shrink-0">Offers:</span>
                              {teaches.slice(0, 2).map((s, sIdx) => {
                                const prof = user.skillProficiencies?.[s];
                                return (
                                  <span key={`endless-teach-${user.uid}-${s}-${sIdx}`} className="px-2 py-0.5 rounded-md bg-[#F2EFE8] text-[#0D0D0F] text-[11px] font-medium truncate max-w-[135px] inline-flex items-center gap-1">
                                    <span className="truncate">{s}</span>
                                    {prof && (
                                      <span className="text-[9px] font-bold text-[#C9A96E] bg-white px-1 rounded border border-[#E8E4DB] shrink-0">
                                        {prof}
                                      </span>
                                    )}
                                  </span>
                                );
                              })}
                              {teaches.length > 2 && (
                                <span className="text-[10px] text-[#71717A]">+{teaches.length - 2}</span>
                              )}
                            </div>
                          )}

                          {learns.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-bold text-[#71717A] uppercase tracking-wider shrink-0">Seeks:</span>
                              {learns.slice(0, 2).map((s, sIdx) => (
                                <span key={`endless-learn-${user.uid}-${s}-${sIdx}`} className="px-2 py-0.5 rounded-md border border-[#E8E4DB] text-[#71717A] text-[11px] truncate max-w-[130px]">
                                  {s}
                                </span>
                              ))}
                              {learns.length > 2 && (
                                <span className="text-[10px] text-[#71717A]">+{learns.length - 2}</span>
                              )}
                            </div>
                          )}

                          {/* Fair Swap Guarantee tag */}
                          <div className="flex items-center justify-between text-[10px] text-[#71717A] pt-0.5">
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              <Shield className="w-2.5 h-2.5 text-emerald-600" /> Fair Swap Protected
                            </span>
                            <span className="text-[10px] text-[#71717A]">{user.sessionsCount || 4} verified exchanges</span>
                          </div>
                        </div>

                        {/* Direct Swap Trigger */}
                        <div className="pt-2 border-t border-[#F2EFE8] flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-[#C9A96E] flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Ready for Live Swap
                          </span>
                          <span className="text-xs font-semibold text-[#0D0D0F] group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                            View Profile <ChevronRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Endless Stream Footer Actions (Shuffle Matches & Infinite loader) */}
                <div className="flex flex-col items-center justify-center gap-4 py-8">
                  {hasMoreFeed && (
                    <div ref={observerRef} className="flex flex-col items-center justify-center py-4 gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E] animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#0D0D0F] animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E] animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <span className="text-[11px] text-[#71717A]">Loading more peers...</span>
                    </div>
                  )}

                  {/* Shuffle / Discover More Button to guarantee feed is always fresh & continuous */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShuffleKey(prev => prev + 1)}
                      className="px-4 py-2 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] hover:border-[#D8D2C5] active:scale-95 text-[#0D0D0F] text-xs font-semibold transition flex items-center gap-2 shadow-2xs cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-[#C9A96E]" />
                      <span>Shuffle & Discover New Peers</span>
                    </button>
                    <button
                      onClick={() => onNavigateToTab("search")}
                      className="px-4 py-2 rounded-xl bg-[#0D0D0F] hover:bg-[#1f2024] active:scale-95 text-[#F7F4EE] text-xs font-semibold transition flex items-center gap-2 shadow-2xs cursor-pointer"
                    >
                      <span>Explore Catalog</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#C9A96E]" />
                    </button>
                  </div>
                </div>

              </div>

            </div>
          )}
        </LoadingTransition>
      </div>

      {/* ========================================================================= */}
      {/* POST COMMUNITY SWAP REQUEST MODAL                                         */}
      {/* Clean, zero-slop modal allowing users to post their own skill trade       */}
      {/* ========================================================================= */}
      {showPostRequestModal && (
        <div className="fixed inset-0 z-50 bg-[#0D0D0F]/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in font-sans">
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[#FFFFFF] border border-[#E8E4DB] rounded-3xl p-6 shadow-2xl flex flex-col gap-5 relative animate-in fade-in zoom-in-95"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-bold text-[#C9A96E] uppercase tracking-wider">Community Exchange</span>
                <h3 className="text-base font-bold text-[#0D0D0F] mt-0.5">Post a Live Swap Request</h3>
                <p className="text-xs text-[#71717A] mt-0.5">Peers can see this on the live feed and propose a swap session.</p>
              </div>
              <button
                onClick={() => setShowPostRequestModal(false)}
                className="w-8 h-8 rounded-full border border-[#E8E4DB] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSwapRequest} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-[#0D0D0F] mb-1.5 block">
                  What skill do you want to learn / need help with?
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Spoken English, Python async, Figma auto-layout..."
                  value={requestSeeking}
                  onChange={(e) => setRequestSeeking(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E8E4DB] bg-[#F7F4EE] text-sm text-[#0D0D0F] focus:border-[#0D0D0F] outline-none transition"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#0D0D0F] mb-1.5 block">
                  What skill can you teach in return?
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Hindi fluency, React & Tailwind, Resume review..."
                  value={requestOffering}
                  onChange={(e) => setRequestOffering(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E8E4DB] bg-[#F7F4EE] text-sm text-[#0D0D0F] focus:border-[#0D0D0F] outline-none transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[#0D0D0F] mb-1.5 block">
                    Target Duration
                  </label>
                  <select
                    value={requestDuration}
                    onChange={(e) => setRequestDuration(Number(e.target.value))}
                    className="w-full h-11 px-3 rounded-xl border border-[#E8E4DB] bg-[#F7F4EE] text-sm text-[#0D0D0F] focus:border-[#0D0D0F] outline-none transition cursor-pointer"
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes</option>
                    <option value={45}>45 Minutes</option>
                    <option value={60}>60 Minutes</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-[#0D0D0F] mb-1.5 block">
                    Availability
                  </label>
                  <span className="w-full h-11 px-3 rounded-xl border border-[#E8E4DB] bg-[#F2EFE8] text-xs text-[#0D0D0F] font-medium flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Today / Flexible
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#0D0D0F] mb-1.5 block">
                  Quick Note / Topic Details (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Briefly describe what you'd like to cover..."
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  className="w-full p-3 rounded-xl border border-[#E8E4DB] bg-[#F7F4EE] text-xs text-[#0D0D0F] focus:border-[#0D0D0F] outline-none transition resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowPostRequestModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#E8E4DB] hover:bg-[#F2EFE8] text-xs font-semibold text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#0D0D0F] hover:bg-[#1f2024] active:scale-95 text-[#F7F4EE] text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 text-[#C9A96E]" />
                  <span>Publish to Feed</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                {uniqueNotifications.length === 0 ? (
                  <div className="py-20 flex flex-col items-center text-center text-[#71717A] gap-2">
                    <AlertCircle className="w-7 h-7 text-[#71717A]/60" />
                    <p className="text-xs font-medium text-[#0D0D0F]">No new notifications</p>
                    <p className="text-[11px] text-[#71717A] max-w-[200px] leading-relaxed">
                      Session bookings, reviews, and connection requests will appear here.
                    </p>
                  </div>
                ) : (
                  uniqueNotifications.map((notif, nIdx) => (
                    <div
                      key={notif.id ? `notif-${notif.id}` : `notif-idx-${nIdx}`}
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
