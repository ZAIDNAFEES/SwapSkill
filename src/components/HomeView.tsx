import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  updateDoc,
  doc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { UserProfile } from "../types";
import { useApp } from "../context/AppContext";
import { LoadingTransition } from "./SkeletonLoader";
import SmartImage from "./SmartImage";
import logoImg from "../assets/logo.jpg";
import { safeLocalStorage } from "../utils/safeStorage";
import { useBackHandler } from "../utils/navigationManager";
import {
  Search,
  ChevronRight,
  Bell,
  X,
  CheckCheck,
  Trash2,
  Share2,
  Check,
  UserCheck,
  UserPlus,
  Repeat,
  Star,
  Clock,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
  ArrowLeftRight,
  BadgeCheck,
  Loader2,
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
  duration: number;
  note: string;
  timeAgo: string;
  isCurrentUser?: boolean;
}

const DISCOVER_CATEGORIES = [
  "All",
  "Tech & Code",
  "Design",
  "Languages",
  "Business",
  "Creative",
  "Finance",
] as const;

function getHomeTimestampMs(val: any): number {
  if (!val) return 0;
  if (typeof val === "number") return val < 1e12 ? val * 1000 : val;
  if (typeof val?.toDate === "function") {
    const d = val.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0;
  }
  if (typeof val?.seconds === "number") return val.seconds * 1000;
  if (typeof val?._seconds === "number") return val._seconds * 1000;
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

function skillsFlexMatch(a: string, b: string): boolean {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (!s1 || !s2) return false;
  if (s1 === s2) return true;
  if (s1.length >= 2 && s2.includes(s1)) return true;
  if (s2.length >= 2 && s1.includes(s2)) return true;
  return false;
}

export default function HomeView({ currentUserId, onSelectUser, onNavigateToTab }: HomeViewProps) {
  const {
    discoveryUsers,
    notifications,
    refreshFeed,
    currentUserProfile,
    toggleFollow,
    hasMoreFeed,
    loadMoreFeed,
  } = useApp();

  const [copied, setCopied] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [followingStates, setFollowingStates] = useState<Record<string, boolean>>({});
  const [connectingUserIds, setConnectingUserIds] = useState<Record<string, boolean>>({});
  const [connectModalUser, setConnectModalUser] = useState<UserProfile | null>(null);
  const [disconnectModalUser, setDisconnectModalUser] = useState<UserProfile | null>(null);
  const [connectToast, setConnectToast] = useState<{
    message: string;
    userId?: string;
    variant: "connected" | "disconnected" | "error";
  } | null>(null);
  const connectToastTimerRef = useRef<number | null>(null);

  // Feed Filtering & Discovery states
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>("All");
  const [activeFeedTab, setActiveFeedTab] = useState<"all" | "match" | "top" | "recent">("all");
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

  useBackHandler(Boolean(connectModalUser), () => {
    setConnectModalUser(null);
  });
  useBackHandler(Boolean(disconnectModalUser), () => {
    setDisconnectModalUser(null);
  });
  useBackHandler(showPostRequestModal, () => {
    setShowPostRequestModal(false);
  });
  useBackHandler(showNotifications, () => {
    setShowNotifications(false);
  });

  useEffect(() => {
    setFollowingStates({});
  }, [currentUserProfile?.followingList]);

  useEffect(() => {
    return () => {
      if (connectToastTimerRef.current) {
        window.clearTimeout(connectToastTimerRef.current);
      }
    };
  }, []);

  const showTimedToast = (
    message: string,
    variant: "connected" | "disconnected" | "error",
    userId?: string
  ) => {
    if (connectToastTimerRef.current) {
      window.clearTimeout(connectToastTimerRef.current);
    }
    setConnectToast({ message, variant, userId });
    connectToastTimerRef.current = window.setTimeout(() => {
      setConnectToast(null);
    }, 3000);
  };

  const isUserConnected = (userId: string) =>
    followingStates[userId] !== undefined
      ? followingStates[userId]
      : (currentUserProfile?.followingList || []).includes(userId);

  const handleConnectButtonClick = (user: UserProfile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.uid || connectingUserIds[user.uid]) return;
    if (isUserConnected(user.uid)) {
      setDisconnectModalUser(user);
    } else {
      setConnectModalUser(user);
    }
  };

  const executeConnectionChange = async (user: UserProfile, action: "connect" | "disconnect") => {
    const userId = user.uid;
    if (!userId || connectingUserIds[userId]) return;

    const currentlyConnected = isUserConnected(userId);
    const shouldBeConnected = action === "connect";
    if (currentlyConnected === shouldBeConnected) {
      setConnectModalUser(null);
      setDisconnectModalUser(null);
      return;
    }

    setConnectingUserIds((prev) => ({ ...prev, [userId]: true }));
    setFollowingStates((prev) => ({ ...prev, [userId]: shouldBeConnected }));
    setConnectModalUser(null);
    setDisconnectModalUser(null);

    try {
      await toggleFollow(userId);
      const firstName = (user.fullName || "Member").trim().split(/\s+/)[0];
      if (action === "connect") {
        showTimedToast(`Connected with ${firstName}`, "connected", userId);
      } else {
        showTimedToast(`Removed connection with ${firstName}`, "disconnected");
      }
    } catch (err) {
      console.error("Connection update failed:", err);
      setFollowingStates((prev) => ({ ...prev, [userId]: currentlyConnected }));
      showTimedToast("Couldn't update connection. Please try again.", "error");
    } finally {
      setConnectingUserIds((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
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

  // 2. Recommended Peers (Spotlight)
  const recommendedUsers = useMemo(() => {
    const myLearnSkills = (currentUserProfile?.skillsToLearn || []).map((s) => s.toLowerCase().trim());
    const matches = (otherUsers || []).filter((u) =>
      u.skillsToTeach?.some((s) => myLearnSkills.some((myS) => myS && s.toLowerCase().trim().includes(myS)))
    );
    const combined =
      matches.length > 0 ? [...matches, ...otherUsers.filter((u) => !matches.some((m) => m.uid === u.uid))] : otherUsers;
    const seen = new Set<string>();
    const uniqueList: UserProfile[] = [];
    combined.forEach((u) => {
      if (u.uid && !seen.has(u.uid)) {
        seen.add(u.uid);
        uniqueList.push(u);
      }
    });
    return uniqueList.slice(0, 5);
  }, [otherUsers, currentUserProfile]);

  const recommendedUserIds = useMemo(() => {
    return new Set(recommendedUsers.map((u) => u.uid));
  }, [recommendedUsers]);

  // 3. Community Directory Stream
  const { endlessPeers, isDisciplineFallback } = useMemo(() => {
    let pool = otherUsers;
    let fellBack = false;

    if (selectedDiscipline !== "All") {
      const disc = selectedDiscipline.toLowerCase();
      const filtered = pool.filter((u) => {
        const teachStr = (u.skillsToTeach || []).join(" ").toLowerCase();
        const learnStr = (u.skillsToLearn || []).join(" ").toLowerCase();
        const bioStr = (u.bio || "").toLowerCase();
        const combined = `${teachStr} ${learnStr} ${bioStr}`;
        if (disc.includes("tech") || disc.includes("code")) {
          return /python|react|javascript|typescript|code|dev|software|data|web|app|java|c\+\+|ai|ml/.test(combined);
        }
        if (disc.includes("design")) {
          return /design|ui|ux|figma|product|graphic|brand|motion|3d/.test(combined);
        }
        if (disc.includes("language")) {
          return /english|hindi|spanish|french|german|japanese|arabic|urdu|language|spoken/.test(combined);
        }
        if (disc.includes("business")) {
          return /business|marketing|sales|startup|seo|growth|strategy|management|consulting/.test(combined);
        }
        if (disc.includes("creative")) {
          return /music|guitar|piano|art|photo|video|edit|writing|singing|creative/.test(combined);
        }
        if (disc.includes("finance")) {
          return /finance|invest|stock|crypto|account|tax|trading|excel/.test(combined);
        }
        return combined.includes(disc);
      });
      if (filtered.length > 0) {
        pool = filtered;
      } else {
        fellBack = true;
      }
    }

    if (activeFeedTab === "match") {
      const me = currentUserProfile;
      const computeCompatibility = (u: UserProfile): number => {
        let score = 0;
        if (me) {
          const teachesWhatILearn = (u.skillsToTeach || []).some((s) =>
            (me.skillsToLearn || []).some((myS) => skillsFlexMatch(s, myS))
          );
          const learnsWhatITeach = (u.skillsToLearn || []).some((s) =>
            (me.skillsToTeach || []).some((myS) => skillsFlexMatch(s, myS))
          );
          if (teachesWhatILearn && learnsWhatITeach) score += 55;
          else if (teachesWhatILearn || learnsWhatITeach) score += 30;

          const sharedLang = (u.languages || []).some((l) =>
            (me.languages || []).some((myL) => skillsFlexMatch(l, myL))
          );
          if (sharedLang) score += 15;

          if (
            u.country &&
            me.country &&
            u.country.toLowerCase().trim() === me.country.toLowerCase().trim()
          ) {
            score += 10;
          }
          if (u.city && me.city && u.city.toLowerCase().trim() === me.city.toLowerCase().trim()) {
            score += 5;
          }
          if (
            u.availability &&
            me.availability &&
            u.availability.toLowerCase().trim() === me.availability.toLowerCase().trim()
          ) {
            score += 5;
          }
        }
        if (u.verified) score += 4;
        if ((u.reviewCount || 0) > 0 && (u.rating || 0) >= 4) score += 4;
        if ((u.sessionsCount || 0) > 0) score += Math.min(4, u.sessionsCount || 0);
        return score;
      };
      pool = [...pool].sort((a, b) => computeCompatibility(b) - computeCompatibility(a));
    } else if (activeFeedTab === "top") {
      pool = [...pool].sort((a, b) => {
        const scoreB =
          ((b.reviewCount || 0) > 0 ? (b.rating || 0) * 100 + (b.reviewCount || 0) * 5 : 0) +
          (b.sessionsCount || 0) * 2 +
          (b.verified ? 1.5 : 0) +
          (b.followersCount || 0) * 0.05;
        const scoreA =
          ((a.reviewCount || 0) > 0 ? (a.rating || 0) * 100 + (a.reviewCount || 0) * 5 : 0) +
          (a.sessionsCount || 0) * 2 +
          (a.verified ? 1.5 : 0) +
          (a.followersCount || 0) * 0.05;
        return scoreB - scoreA;
      });
    } else if (activeFeedTab === "recent") {
      pool = [...pool].sort((a, b) => {
        const msB = getHomeTimestampMs(b.createdAt) || getHomeTimestampMs((b as any).updatedAt);
        const msA = getHomeTimestampMs(a.createdAt) || getHomeTimestampMs((a as any).updatedAt);
        return msB - msA;
      });
    }

    if (shuffleKey > 0) {
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = (i * 7 + shuffleKey) % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return { endlessPeers: shuffled, isDisciplineFallback: fellBack };
    }

    return { endlessPeers: pool, isDisciplineFallback: fellBack };
  }, [otherUsers, selectedDiscipline, activeFeedTab, shuffleKey, currentUserProfile]);

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
      userLocation: currentUserProfile?.city || "",
      seekingSkill: requestSeeking.trim(),
      offeringSkill: requestOffering.trim(),
      duration: requestDuration,
      note:
        requestNote.trim() ||
        `Looking to learn ${requestSeeking.trim()} and happy to help with ${requestOffering.trim()}.`,
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
    const updated = userCreatedRequests.filter((r) => r.id !== id);
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
      const unreadNotifs = (notifications || []).filter((n) => !n.read);
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
          url: inviteUrl,
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

  const quickTopics = useMemo(() => {
    if (currentUserProfile?.skillsToLearn && currentUserProfile.skillsToLearn.length > 0) {
      return currentUserProfile.skillsToLearn;
    }
    return ["Python", "UI Design", "Spoken English", "React", "Public Speaking"];
  }, [currentUserProfile?.skillsToLearn]);

  return (
    <div className="flex flex-col min-h-[100dvh] bg-[#F7F4EE] text-[#0D0D0F] font-sans pb-32 relative w-full overflow-x-hidden mobile-scroll">
      {/* App-Harmonized Warm Ivory & Obsidian Top Bar */}
      <header
        className="border-b border-[#E8E4DB] bg-[#F7F4EE]/95 backdrop-blur-md sticky top-0 z-20 pt-safe"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0px)" }}
      >
        <div className="px-4 sm:px-6 lg:px-8 h-14 w-full flex justify-between items-center max-w-6xl mx-auto">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg overflow-hidden bg-[#0D0D0F] border border-[#E8E4DB] shadow-2xs shrink-0">
              <img src={logoImg} alt="SwapSkill" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <span className="font-sans font-bold text-[18px] tracking-tight text-[#0D0D0F] whitespace-nowrap">
              SwapSkill
            </span>
          </div>

          <button
            id="home-notif-bell-btn"
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            className="w-10 h-10 rounded-xl border border-[#E8E4DB] bg-[#FFFFFF] hover:bg-[#F2EFE8] flex items-center justify-center text-[#0D0D0F] transition relative cursor-pointer active:scale-95 shadow-2xs"
            aria-label="Notifications"
          >
            <Bell className="w-[18px] h-[18px]" strokeWidth={1.9} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-[#C9A96E] text-[#0D0D0F] text-[10px] font-bold tabular-nums flex items-center justify-center ring-2 ring-[#F7F4EE]">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-4 w-full max-w-6xl mx-auto">
        <LoadingTransition isLoading={loading} type="feed" count={4}>
          {discoveryUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-24 px-4 max-w-sm mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] flex items-center justify-center mb-4 shadow-2xs">
                <Share2 className="w-6 h-6 text-[#C9A96E]" strokeWidth={1.8} />
              </div>

              <h3 className="text-base font-semibold text-[#0D0D0F] mb-1.5 tracking-tight">
                No people nearby yet
              </h3>
              <p className="text-[#71717A] text-[13px] leading-relaxed mb-6">
                Invite friends or classmates to start exchanging skills together.
              </p>

              <button
                id="invite-friends-btn"
                type="button"
                onClick={handleInvite}
                className="h-11 px-5 rounded-full bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] text-[13px] font-semibold flex items-center gap-2 transition active:scale-95 cursor-pointer shadow-2xs"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-[#C9A96E]" />
                    <span>Link copied</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4 text-[#C9A96E]" />
                    <span>Invite friends</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-6 pb-10 w-full">
              {/* Native App Search Trigger + Category Rail */}
              <div className="flex flex-col gap-3 w-full">
                <button
                  id="home-search-promo"
                  type="button"
                  onClick={() => onNavigateToTab("search")}
                  className="w-full h-11 pl-4 pr-3.5 rounded-full bg-[#FFFFFF] border border-[#E8E4DB] hover:border-[#D8D2C5] active:scale-[0.995] flex items-center justify-between gap-3 transition cursor-pointer text-left shadow-2xs"
                >
                  <span className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Search className="w-[17px] h-[17px] text-[#71717A] shrink-0" strokeWidth={2} />
                    <span className="text-[14px] text-[#71717A] font-normal truncate">
                      Search skills, people, or cities...
                    </span>
                  </span>
                  <SlidersHorizontal className="w-4 h-4 text-[#71717A] shrink-0" strokeWidth={1.9} />
                </button>

                {/* Interactive Category Tabs */}
                <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar scroll-smooth">
                  <div className="flex items-center gap-2 py-0.5 w-max min-w-full">
                    {DISCOVER_CATEGORIES.map((cat) => {
                      const isSelected = selectedDiscipline === cat;
                      return (
                        <button
                          key={`topic-chip-${cat}`}
                          type="button"
                          onClick={() => setSelectedDiscipline(cat)}
                          className={`h-9 px-4 rounded-full text-[13px] font-medium whitespace-nowrap shrink-0 transition cursor-pointer inline-flex items-center justify-center active:scale-95 ${
                            isSelected
                              ? "bg-[#0D0D0F] text-[#F7F4EE] font-semibold shadow-2xs"
                              : "bg-[#FFFFFF] border border-[#E8E4DB] text-[#71717A] hover:text-[#0D0D0F] hover:border-[#D8D2C5]"
                          }`}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Primary Discovery Grid: Main Feed Left, Sidebar Right on Desktop */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
                <div className="lg:col-span-8 flex flex-col gap-6 min-w-0">
                  {/* SECTION 1: Suggested for you Carousel (Mobile Swipeable, Desktop 2-Col Grid) */}
                  <section aria-label="Suggested matches" className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-[17px] font-bold text-[#0D0D0F] tracking-tight">
                        Suggested for you
                      </h2>
                      <button
                        type="button"
                        onClick={() => onNavigateToTab("search")}
                        className="text-[13px] font-medium text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer inline-flex items-center gap-0.5 py-1 pl-2"
                      >
                        <span>See all</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar snap-x snap-mandatory md:overflow-visible">
                      <div className="flex md:grid md:grid-cols-2 gap-3.5 w-max md:w-full">
                        {recommendedUsers.map((user, uIdx) => {
                          const followingList = currentUserProfile?.followingList || [];
                          const isFollowing =
                            followingStates[user.uid] !== undefined
                              ? followingStates[user.uid]
                              : followingList.includes(user.uid);

                          const primaryTeach = user.skillsToTeach?.[0];
                          const teachLevel = primaryTeach ? user.skillProficiencies?.[primaryTeach] : undefined;
                          const extraTeachCount = Math.max(0, (user.skillsToTeach?.length || 0) - 1);

                          const primaryLearn = user.skillsToLearn?.[0];
                          const learnLevel = primaryLearn ? (user as any).learnSkillLevels?.[primaryLearn] : undefined;
                          const extraLearnCount = Math.max(0, (user.skillsToLearn?.length || 0) - 1);

                          const hasRealRating = Boolean(
                            user.reviewCount && user.reviewCount > 0 && user.rating && user.rating > 0
                          );
                          const locationOrHandle = user.city || (user.username ? `@${user.username}` : "");

                          return (
                            <article
                              key={user.uid ? `rec-user-${user.uid}` : `rec-user-idx-${uIdx}`}
                              onClick={() => onSelectUser(user.uid)}
                              className="w-[82vw] max-w-[330px] md:w-auto md:max-w-none shrink-0 snap-start bg-[#FFFFFF] rounded-2xl border border-[#E8E4DB] hover:border-[#D8D2C5] p-4 flex flex-col justify-between gap-3.5 transition cursor-pointer shadow-2xs group"
                            >
                              {/* Identity Row */}
                              <div className="flex items-center gap-3 min-w-0">
                                <SmartImage
                                  src={user.photoUrl || user.photoURL}
                                  alt={user.fullName}
                                  fallbackType="profile"
                                  fullName={user.fullName}
                                  sizeType="thumbnail"
                                  className="w-12 h-12 rounded-full object-cover bg-[#F2EFE8] border border-[#E8E4DB] shrink-0"
                                />

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1 min-w-0">
                                    <h3 className="font-semibold text-[15px] text-[#0D0D0F] group-hover:text-[#9A7A42] transition-colors leading-snug truncate">
                                      {user.fullName}
                                    </h3>
                                    {user.verified && (
                                      <BadgeCheck className="w-4 h-4 text-[#C9A96E] shrink-0" />
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 text-[12px] text-[#71717A] mt-0.5 truncate tabular-nums">
                                    {locationOrHandle && <span className="truncate">{locationOrHandle}</span>}
                                    {hasRealRating && (
                                      <>
                                        {locationOrHandle && <span aria-hidden="true">·</span>}
                                        <span className="inline-flex items-center gap-0.5 text-[#0D0D0F] font-medium shrink-0">
                                          <Star className="w-3 h-3 fill-[#C9A96E] stroke-[#C9A96E]" />
                                          {user.rating!.toFixed(1)}
                                          <span className="text-[#71717A] font-normal">({user.reviewCount})</span>
                                        </span>
                                      </>
                                    )}
                                    {!hasRealRating && user.sessionsCount && user.sessionsCount > 0 ? (
                                      <>
                                        {locationOrHandle && <span aria-hidden="true">·</span>}
                                        <span className="shrink-0">
                                          {user.sessionsCount} {user.sessionsCount === 1 ? "swap" : "swaps"}
                                        </span>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              {/* Clean Structured Skill Exchange Strip */}
                              {(primaryTeach || primaryLearn) && (
                                <div className="rounded-xl bg-[#F7F4EE] border border-[#E8E4DB]/70 px-3 py-2.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5">
                                  <div className="min-w-0">
                                    <span className="block text-[11px] font-medium text-[#71717A]">
                                      Can teach
                                    </span>
                                    <p className="text-[13px] font-semibold text-[#0D0D0F] truncate mt-0.5">
                                      {primaryTeach || "Open to share"}
                                      {extraTeachCount > 0 && (
                                        <span className="text-[#71717A] font-normal"> +{extraTeachCount}</span>
                                      )}
                                    </p>
                                    {teachLevel && (
                                      <span className="block text-[11px] text-[#9A7A42] font-medium truncate">
                                        {teachLevel}
                                      </span>
                                    )}
                                  </div>

                                  <ArrowLeftRight className="w-3.5 h-3.5 text-[#C9A96E] shrink-0" />

                                  <div className="min-w-0 text-right">
                                    <span className="block text-[11px] font-medium text-[#71717A]">
                                      Wants to learn
                                    </span>
                                    <p className="text-[13px] font-semibold text-[#0D0D0F] truncate mt-0.5">
                                      {primaryLearn || "Open"}
                                      {extraLearnCount > 0 && (
                                        <span className="text-[#71717A] font-normal"> +{extraLearnCount}</span>
                                      )}
                                    </p>
                                    {learnLevel && learnLevel !== "Any Level" && (
                                      <span className="block text-[11px] text-[#71717A] truncate">
                                        {learnLevel}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Bio snippet if present */}
                              {user.bio && (
                                <p className="text-[12.5px] text-[#71717A] line-clamp-2 leading-relaxed">
                                  {user.bio}
                                </p>
                              )}

                              {/* Action Footer */}
                              <div className="flex items-center gap-2 pt-0.5">
                                <button
                                  id={`connect-btn-${user.uid}`}
                                  type="button"
                                  disabled={Boolean(connectingUserIds[user.uid])}
                                  onClick={(e) => handleConnectButtonClick(user, e)}
                                  className={`h-10 px-4 rounded-xl text-[13px] font-semibold flex-1 flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                                    isFollowing
                                      ? "bg-[#F2EFE8] hover:bg-[#EAE5DA] text-[#0D0D0F] border border-[#E8E4DB]"
                                      : "bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE]"
                                  }`}
                                >
                                  {connectingUserIds[user.uid] ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A96E]" />
                                  ) : isFollowing ? (
                                    <>
                                      <UserCheck className="w-3.5 h-3.5 text-[#C9A96E]" strokeWidth={2.2} />
                                      <span>Connected</span>
                                    </>
                                  ) : (
                                    <>
                                      <UserPlus className="w-3.5 h-3.5 text-[#C9A96E]" strokeWidth={2.2} />
                                      <span>Connect</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectUser(user.uid);
                                  }}
                                  className="h-10 px-3.5 rounded-xl bg-[#FFFFFF] hover:bg-[#F7F4EE] border border-[#E8E4DB] text-[13px] font-medium text-[#0D0D0F] transition cursor-pointer shrink-0"
                                >
                                  Profile
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  {/* SECTION 2: Swap Requests (Compact Notice Banner or Horizontal Request Cards) */}
                  <section aria-label="Swap requests" className="flex flex-col gap-3">
                    {communitySwapRequests.length > 0 ? (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="text-[17px] font-bold text-[#0D0D0F] tracking-tight">
                            Your swap requests
                          </h2>
                          <button
                            type="button"
                            onClick={() => setShowPostRequestModal(true)}
                            className="h-9 px-3.5 rounded-full bg-[#0D0D0F] hover:bg-[#1C1C20] active:scale-95 text-[#F7F4EE] text-[12px] font-semibold transition inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 text-[#C9A96E]" />
                            <span>New request</span>
                          </button>
                        </div>

                        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar scroll-smooth pb-1">
                          <div className="flex items-stretch gap-3 w-max">
                            {communitySwapRequests.map((req) => (
                              <div
                                key={req.id}
                                onClick={() => {
                                  if (!req.isCurrentUser) onSelectUser(req.userId);
                                }}
                                className="w-[280px] sm:w-[300px] rounded-2xl p-4 bg-[#FFFFFF] border border-[#E8E4DB] flex flex-col justify-between gap-3 cursor-pointer relative shrink-0 shadow-2xs"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <SmartImage
                                      src={req.userPhoto}
                                      alt={req.userName}
                                      fallbackType="profile"
                                      fullName={req.userName}
                                      sizeType="thumbnail"
                                      className="w-8 h-8 rounded-full border border-[#E8E4DB] object-cover shrink-0"
                                    />
                                    <div className="min-w-0">
                                      <span className="font-semibold text-[13px] text-[#0D0D0F] block truncate">
                                        {req.userName}
                                      </span>
                                      <div className="flex items-center gap-1.5 text-[11px] text-[#71717A] tabular-nums">
                                        {req.userLocation && <span>{req.userLocation}</span>}
                                        {req.userLocation && <span aria-hidden="true">·</span>}
                                        <span className="inline-flex items-center gap-1">
                                          <Clock className="w-3 h-3" /> {req.duration}m
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  {req.isCurrentUser && (
                                    <button
                                      type="button"
                                      onClick={(e) => handleDeleteUserRequest(req.id, e)}
                                      className="w-8 h-8 rounded-full hover:bg-[#F2EFE8] text-[#71717A] hover:text-rose-700 flex items-center justify-center transition cursor-pointer shrink-0"
                                      title="Delete request"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>

                                <div className="p-2.5 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB]/70 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                                  <div className="min-w-0">
                                    <span className="text-[10px] font-medium text-[#71717A] block">Learning</span>
                                    <span className="text-[12.5px] font-semibold text-[#0D0D0F] truncate block">
                                      {req.seekingSkill}
                                    </span>
                                  </div>
                                  <Repeat className="w-3.5 h-3.5 text-[#C9A96E] shrink-0" />
                                  <div className="min-w-0 text-right">
                                    <span className="text-[10px] font-medium text-[#71717A] block">Teaching</span>
                                    <span className="text-[12.5px] font-semibold text-[#0D0D0F] truncate block">
                                      {req.offeringSkill}
                                    </span>
                                  </div>
                                </div>

                                <p className="text-[12px] text-[#71717A] line-clamp-2 leading-relaxed">
                                  {req.note}
                                </p>

                                <div className="flex items-center justify-between text-[11px] text-[#71717A] pt-1 border-t border-[#F2EFE8]">
                                  <span>{req.timeAgo}</span>
                                  {!req.isCurrentUser ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onSelectUser(req.userId);
                                      }}
                                      className="px-3 py-1 rounded-lg bg-[#0D0D0F] text-[#F7F4EE] text-[11px] font-semibold transition active:scale-95 cursor-pointer"
                                    >
                                      Propose swap
                                    </button>
                                  ) : (
                                    <span className="text-[#9A7A42] font-medium">Posted</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] px-4 py-3.5 flex items-center justify-between gap-3 shadow-2xs">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-center text-[#C9A96E] shrink-0">
                            <Repeat className="w-4 h-4" strokeWidth={2} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-[13.5px] font-semibold text-[#0D0D0F] truncate">
                              Looking for a skill swap?
                            </h3>
                            <p className="text-[12px] text-[#71717A] truncate">
                              Post what you want to learn &amp; teach
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowPostRequestModal(true)}
                          className="h-9 px-3.5 rounded-full bg-[#0D0D0F] hover:bg-[#1C1C20] active:scale-95 text-[#F7F4EE] text-[12px] font-semibold transition inline-flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5 text-[#C9A96E]" />
                          <span>Post</span>
                        </button>
                      </div>
                    )}
                  </section>

                  {/* SECTION 3: Community Feed (Warm Luxury Directory List) */}
                  <section aria-label="Community directory" className="flex flex-col gap-3.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-baseline gap-2">
                        <h2 className="text-[17px] font-bold text-[#0D0D0F] tracking-tight">
                          Community
                        </h2>
                        <span className="text-[12px] text-[#71717A] tabular-nums">
                          {endlessPeers.length} {endlessPeers.length === 1 ? "person" : "people"}
                        </span>
                      </div>

                      {/* Segmented Filter Control */}
                      <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFECE4] border border-[#E8E4DB] w-full sm:w-auto">
                        {(
                          [
                            { id: "all", label: "All" },
                            { id: "match", label: "Best match" },
                            { id: "top", label: "Top rated" },
                            { id: "recent", label: "Newest" },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveFeedTab(tab.id)}
                            className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition cursor-pointer ${
                              activeFeedTab === tab.id
                                ? "bg-[#FFFFFF] text-[#0D0D0F] font-semibold shadow-2xs"
                                : "text-[#71717A] hover:text-[#0D0D0F]"
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {isDisciplineFallback && (
                      <p className="text-[12px] text-[#71717A]">
                        No exact matches in {selectedDiscipline} yet — showing everyone.
                      </p>
                    )}

                    {/* Clean Directory Cards */}
                    <div className="bg-[#FFFFFF] rounded-2xl border border-[#E8E4DB] divide-y divide-[#F2EFE8] overflow-hidden shadow-2xs">
                      {endlessPeers.map((user, idx) => {
                        const followingList = currentUserProfile?.followingList || [];
                        const isFollowing =
                          followingStates[user.uid] !== undefined
                            ? followingStates[user.uid]
                            : followingList.includes(user.uid);

                        const teaches = user.skillsToTeach || [];
                        const learns = user.skillsToLearn || [];
                        const hasRealRating = Boolean(
                          user.reviewCount && user.reviewCount > 0 && user.rating && user.rating > 0
                        );
                        const metaParts: string[] = [];
                        if (user.city) metaParts.push(user.city);
                        else if (user.username) metaParts.push(`@${user.username}`);
                        if (hasRealRating) metaParts.push(`★ ${user.rating!.toFixed(1)} (${user.reviewCount})`);
                        else if (user.sessionsCount && user.sessionsCount > 0) {
                          metaParts.push(`${user.sessionsCount} ${user.sessionsCount === 1 ? "swap" : "swaps"}`);
                        }

                        return (
                          <div
                            key={`endless-${user.uid}-${idx}`}
                            onClick={() => onSelectUser(user.uid)}
                            className="p-4 hover:bg-[#FAF8F4] active:bg-[#F2EFE8]/70 transition cursor-pointer flex flex-col gap-2.5"
                          >
                            {/* Top Row */}
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <SmartImage
                                  src={user.photoUrl || user.photoURL}
                                  alt={user.fullName}
                                  fallbackType="profile"
                                  fullName={user.fullName}
                                  sizeType="thumbnail"
                                  className="w-11 h-11 rounded-full object-cover bg-[#F2EFE8] border border-[#E8E4DB] shrink-0"
                                />

                                <div className="min-w-0">
                                  <div className="flex items-center gap-1 min-w-0">
                                    <h3 className="font-semibold text-[14.5px] text-[#0D0D0F] truncate">
                                      {user.fullName}
                                    </h3>
                                    {user.verified && (
                                      <BadgeCheck className="w-4 h-4 text-[#C9A96E] shrink-0" />
                                    )}
                                  </div>
                                  {metaParts.length > 0 && (
                                    <p className="text-[12px] text-[#71717A] truncate mt-0.5 tabular-nums">
                                      {metaParts.join(" · ")}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <button
                                id={`community-connect-btn-${user.uid}`}
                                type="button"
                                disabled={Boolean(connectingUserIds[user.uid])}
                                onClick={(e) => handleConnectButtonClick(user, e)}
                                className={`h-9 min-w-[104px] px-3.5 rounded-xl text-[12px] font-semibold shrink-0 cursor-pointer inline-flex items-center justify-center gap-1.5 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed ${
                                  isFollowing
                                    ? "bg-[#F2EFE8] hover:bg-[#EAE5DA] text-[#0D0D0F] border border-[#E8E4DB]"
                                    : "bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE]"
                                }`}
                              >
                                {connectingUserIds[user.uid] ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A96E]" />
                                ) : isFollowing ? (
                                  <>
                                    <UserCheck className="w-3.5 h-3.5 text-[#C9A96E]" strokeWidth={2.2} />
                                    <span>Connected</span>
                                  </>
                                ) : (
                                  <>
                                    <UserPlus className="w-3.5 h-3.5 text-[#C9A96E]" strokeWidth={2.2} />
                                    <span>Connect</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {/* Bio */}
                            {user.bio && (
                              <p className="text-[13px] text-[#71717A] line-clamp-2 leading-relaxed pl-14">
                                {user.bio}
                              </p>
                            )}

                            {/* Clean Unboxed Skill Lines */}
                            {(teaches.length > 0 || learns.length > 0) && (
                              <div className="pl-14 flex flex-col gap-1 text-[12.5px]">
                                {teaches.length > 0 && (
                                  <div className="flex items-baseline gap-1.5 min-w-0">
                                    <span className="text-[#9A7A42] font-medium shrink-0">Teaches:</span>
                                    <span className="font-semibold text-[#0D0D0F] truncate">
                                      {teaches.slice(0, 2).join(", ")}
                                      {teaches.length > 2 ? ` +${teaches.length - 2}` : ""}
                                    </span>
                                  </div>
                                )}
                                {learns.length > 0 && (
                                  <div className="flex items-baseline gap-1.5 min-w-0">
                                    <span className="text-[#71717A] shrink-0">Learning:</span>
                                    <span className="text-[#0D0D0F]/80 truncate">
                                      {learns.slice(0, 2).join(", ")}
                                      {learns.length > 2 ? ` +${learns.length - 2}` : ""}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Footer Actions & Pagination Loader */}
                    <div className="flex flex-col items-center justify-center gap-3 py-4">
                      {hasMoreFeed && (
                        <div ref={observerRef} className="flex items-center justify-center py-3 gap-2 text-[#71717A]">
                          <Loader2 className="w-4 h-4 animate-spin text-[#C9A96E]" />
                          <span className="text-[12px]">Loading more people...</span>
                        </div>
                      )}

                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setShuffleKey((prev) => prev + 1)}
                          className="h-10 px-4 rounded-full bg-[#FFFFFF] border border-[#E8E4DB] hover:border-[#D8D2C5] hover:bg-[#FAF8F4] active:scale-95 text-[#0D0D0F] text-[12.5px] font-medium transition inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-[#C9A96E]" />
                          <span>Shuffle feed</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigateToTab("search")}
                          className="h-10 px-4 rounded-full bg-[#0D0D0F] hover:bg-[#1C1C20] active:scale-95 text-[#F7F4EE] text-[12.5px] font-semibold transition inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <span>Browse all</span>
                          <ChevronRight className="w-3.5 h-3.5 text-[#C9A96E]" />
                        </button>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Desktop Complementary Sidebar */}
                <aside className="hidden lg:flex lg:col-span-4 flex-col gap-5 sticky top-20">
                  <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-5 flex flex-col gap-3 shadow-2xs">
                    <h3 className="text-[14px] font-bold text-[#0D0D0F] tracking-tight">
                      Topics you follow
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {quickTopics.map((skill, sIdx) => (
                        <button
                          key={`learn-path-${skill}-${sIdx}`}
                          type="button"
                          onClick={() => handleSkillClick(skill)}
                          className="px-3 py-1.5 bg-[#F7F4EE] hover:bg-[#F2EFE8] border border-[#E8E4DB] text-[12.5px] font-medium text-[#0D0D0F] rounded-lg transition cursor-pointer"
                        >
                          {skill}
                        </button>
                      ))}
                    </div>
                  </div>

                  {otherUsers.filter((u) => !recommendedUserIds.has(u.uid)).length > 0 && (
                    <div className="bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl p-5 flex flex-col gap-3.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[14px] font-bold text-[#0D0D0F] tracking-tight">
                          More people
                        </h3>
                        <button
                          type="button"
                          onClick={() => onNavigateToTab("search")}
                          className="text-[12px] font-medium text-[#71717A] hover:text-[#0D0D0F] cursor-pointer"
                        >
                          View all
                        </button>
                      </div>

                      <div className="flex flex-col gap-3">
                        {otherUsers
                          .filter((u) => !recommendedUserIds.has(u.uid))
                          .slice(0, 4)
                          .map((user, pIdx) => {
                            const followingList = currentUserProfile?.followingList || [];
                            const isFollowing =
                              followingStates[user.uid] !== undefined
                                ? followingStates[user.uid]
                                : followingList.includes(user.uid);

                            return (
                              <div
                                key={user.uid ? `peer-user-${user.uid}` : `peer-user-idx-${pIdx}`}
                                onClick={() => onSelectUser(user.uid)}
                                className="flex items-center justify-between gap-3 cursor-pointer group"
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
                                    <span className="font-semibold text-[13px] text-[#0D0D0F] group-hover:text-[#9A7A42] transition-colors block truncate">
                                      {user.fullName}
                                    </span>
                                    <span className="text-[11.5px] text-[#71717A] block truncate">
                                      {user.skillsToTeach?.[0] || user.city || "Member"}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={Boolean(connectingUserIds[user.uid])}
                                  onClick={(e) => handleConnectButtonClick(user, e)}
                                  className={`h-8 min-w-[88px] px-3 rounded-xl text-[11.5px] font-semibold shrink-0 cursor-pointer inline-flex items-center justify-center gap-1.5 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed ${
                                    isFollowing
                                      ? "bg-[#F2EFE8] hover:bg-[#EAE5DA] text-[#0D0D0F] border border-[#E8E4DB]"
                                      : "bg-[#0D0D0F] text-[#F7F4EE] hover:bg-[#1C1C20]"
                                  }`}
                                >
                                  {connectingUserIds[user.uid] ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-[#C9A96E]" />
                                  ) : isFollowing ? (
                                    <>
                                      <UserCheck className="w-3 h-3 text-[#C9A96E]" strokeWidth={2.2} />
                                      <span>Connected</span>
                                    </>
                                  ) : (
                                    <>
                                      <UserPlus className="w-3 h-3 text-[#C9A96E]" strokeWidth={2.2} />
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
                </aside>
              </div>
            </div>
          )}
        </LoadingTransition>
      </main>

      {/* POST COMMUNITY SWAP REQUEST MODAL */}
      {showPostRequestModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowPostRequestModal(false)}
          className="fixed inset-0 z-50 bg-[#0D0D0F]/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in font-sans"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[#FFFFFF] border border-[#E8E4DB] rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl flex flex-col gap-5 relative"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-[17px] font-bold text-[#0D0D0F]">Post a swap request</h3>
                <p className="text-[12.5px] text-[#71717A] mt-0.5">
                  Share what you want to learn and what you can teach in return.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPostRequestModal(false)}
                className="w-9 h-9 rounded-full bg-[#F7F4EE] border border-[#E8E4DB] hover:bg-[#F2EFE8] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSwapRequest} className="flex flex-col gap-4">
              <div>
                <label className="text-[12.5px] font-semibold text-[#0D0D0F] mb-1.5 block">
                  Skill you want to learn
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Spoken English, Python, Figma"
                  value={requestSeeking}
                  onChange={(e) => setRequestSeeking(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E8E4DB] bg-[#F7F4EE] text-sm text-[#0D0D0F] focus:border-[#0D0D0F] outline-none transition"
                />
              </div>

              <div>
                <label className="text-[12.5px] font-semibold text-[#0D0D0F] mb-1.5 block">
                  Skill you can teach
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Hindi, React, Resume review"
                  value={requestOffering}
                  onChange={(e) => setRequestOffering(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E8E4DB] bg-[#F7F4EE] text-sm text-[#0D0D0F] focus:border-[#0D0D0F] outline-none transition"
                />
              </div>

              <div>
                <label className="text-[12.5px] font-semibold text-[#0D0D0F] mb-1.5 block">
                  Session duration
                </label>
                <select
                  value={requestDuration}
                  onChange={(e) => setRequestDuration(Number(e.target.value))}
                  className="w-full h-11 px-3 rounded-xl border border-[#E8E4DB] bg-[#F7F4EE] text-sm text-[#0D0D0F] focus:border-[#0D0D0F] outline-none transition cursor-pointer"
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </div>

              <div>
                <label className="text-[12.5px] font-semibold text-[#0D0D0F] mb-1.5 block">
                  Note (optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Briefly describe what you'd like to cover..."
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  className="w-full p-3 rounded-xl border border-[#E8E4DB] bg-[#F7F4EE] text-xs text-[#0D0D0F] focus:border-[#0D0D0F] outline-none transition resize-none"
                />
              </div>

              <div className="pt-1 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowPostRequestModal(false)}
                  className="h-10 px-4 rounded-xl border border-[#E8E4DB] hover:bg-[#F7F4EE] text-[13px] font-medium text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-10 px-5 rounded-xl bg-[#0D0D0F] hover:bg-[#1C1C20] active:scale-95 text-[#F7F4EE] text-[13px] font-semibold transition inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 text-[#C9A96E]" />
                  <span>Publish</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Notifications Drawer */}
      {showNotifications && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowNotifications(false)}
          className="fixed inset-0 z-50 bg-[#0D0D0F]/40 backdrop-blur-xs flex justify-end animate-fade-in font-sans"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#FFFFFF] border-l border-[#E8E4DB] h-full flex flex-col relative z-50 shadow-2xl pb-24"
          >
            {/* Drawer Header */}
            <div className="px-5 py-4 border-b border-[#E8E4DB] flex justify-between items-center bg-[#FFFFFF] sticky top-0">
              <div className="flex flex-col">
                <h3 className="font-bold text-[15px] text-[#0D0D0F]">Notifications</h3>
                <span className="text-[11.5px] text-[#71717A] tabular-nums">{unreadCount} unread</span>
              </div>
              <button
                type="button"
                onClick={() => setShowNotifications(false)}
                className="w-9 h-9 rounded-full hover:bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Notifications Feed */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
              <LoadingTransition isLoading={loading} type="notifications" count={3}>
                {uniqueNotifications.length === 0 ? (
                  <div className="py-20 flex flex-col items-center text-center text-[#71717A] gap-2">
                    <Bell className="w-7 h-7 text-[#D8D2C5]" />
                    <p className="text-[13px] font-semibold text-[#0D0D0F]">You're all caught up</p>
                    <p className="text-[12px] text-[#71717A] max-w-[220px] leading-relaxed">
                      Session requests, reviews, and new connections will appear here.
                    </p>
                  </div>
                ) : (
                  uniqueNotifications.map((notif, nIdx) => (
                    <div
                      key={notif.id ? `notif-${notif.id}` : `notif-idx-${nIdx}`}
                      onClick={() => handleNotificationClick(notif)}
                      className={`p-3 rounded-xl border transition cursor-pointer relative group flex gap-3 items-center ${
                        notif.read
                          ? "bg-[#FFFFFF] border-[#E8E4DB] hover:bg-[#FAF8F4]"
                          : "bg-[#F7F4EE] border-[#D8D2C5]"
                      }`}
                    >
                      {!notif.read && (
                        <span className="w-2 h-2 rounded-full bg-[#C9A96E] shrink-0" />
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
                        <p className="text-[12.5px] text-[#0D0D0F] leading-snug">
                          <span className="font-semibold">{notif.senderName}</span> {notif.message}
                        </p>
                        <span className="text-[11px] text-[#71717A] mt-1 block">
                          {notif.createdAt?.toDate
                            ? notif.createdAt.toDate().toLocaleDateString([], { month: "short", day: "numeric" })
                            : "Recent"}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => handleClearNotification(notif.id, e)}
                        className="p-1.5 hover:bg-[#E8E4DB]/60 rounded-lg text-[#71717A] hover:text-[#0D0D0F] absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition"
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
                  type="button"
                  onClick={handleMarkAllAsRead}
                  className="text-[12.5px] font-semibold text-[#0D0D0F] hover:text-[#9A7A42] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <CheckCheck className="w-4 h-4 text-[#C9A96E]" /> Mark all as read
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Connect Confirmation Sheet */}
      {connectModalUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="connect-modal-title"
          onClick={() => setConnectModalUser(null)}
          className="fixed inset-0 z-50 bg-[#0D0D0F]/45 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 animate-fade-in font-sans"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-[410px] rounded-t-3xl sm:rounded-2xl bg-[#FFFFFF] border-t sm:border border-[#E8E4DB] p-5 pb-7 sm:pb-5 shadow-2xl flex flex-col gap-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <SmartImage
                  src={connectModalUser.photoUrl || connectModalUser.photoURL}
                  alt={connectModalUser.fullName}
                  fallbackType="profile"
                  fullName={connectModalUser.fullName}
                  sizeType="thumbnail"
                  className="w-12 h-12 rounded-full object-cover bg-[#F2EFE8] border border-[#E8E4DB] shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h3
                      id="connect-modal-title"
                      className="text-[15.5px] font-bold text-[#0D0D0F] truncate"
                    >
                      Connect with {connectModalUser.fullName}
                    </h3>
                    {connectModalUser.verified && (
                      <BadgeCheck className="w-4 h-4 text-[#C9A96E] shrink-0" />
                    )}
                  </div>
                  <p className="text-[12px] text-[#71717A] truncate mt-0.5 tabular-nums">
                    {[
                      connectModalUser.city || (connectModalUser.username ? `@${connectModalUser.username}` : ""),
                      connectModalUser.reviewCount && connectModalUser.reviewCount > 0 && connectModalUser.rating
                        ? `★ ${connectModalUser.rating.toFixed(1)} (${connectModalUser.reviewCount})`
                        : connectModalUser.sessionsCount && connectModalUser.sessionsCount > 0
                        ? `${connectModalUser.sessionsCount} ${connectModalUser.sessionsCount === 1 ? "swap" : "swaps"}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setConnectModalUser(null)}
                aria-label="Close"
                className="w-9 h-9 rounded-full hover:bg-[#F7F4EE] border border-[#E8E4DB] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {((connectModalUser.skillsToTeach || []).length > 0 ||
              (connectModalUser.skillsToLearn || []).length > 0) && (
              <div className="rounded-xl bg-[#F7F4EE] border border-[#E8E4DB] p-3.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium text-[#71717A]">
                    Offers to teach
                  </span>
                  <p className="text-[13px] font-semibold text-[#0D0D0F] truncate mt-0.5">
                    {connectModalUser.skillsToTeach?.[0] || "Open to share"}
                    {(connectModalUser.skillsToTeach?.length || 0) > 1 && (
                      <span className="text-[#71717A] font-normal">
                        {" "}+{(connectModalUser.skillsToTeach?.length || 0) - 1}
                      </span>
                    )}
                  </p>
                </div>

                <ArrowLeftRight className="w-4 h-4 text-[#C9A96E] shrink-0" />

                <div className="min-w-0 text-right">
                  <span className="block text-[11px] font-medium text-[#71717A]">
                    Wants to learn
                  </span>
                  <p className="text-[13px] font-semibold text-[#0D0D0F] truncate mt-0.5">
                    {connectModalUser.skillsToLearn?.[0] || "Open"}
                    {(connectModalUser.skillsToLearn?.length || 0) > 1 && (
                      <span className="text-[#71717A] font-normal">
                        {" "}+{(connectModalUser.skillsToLearn?.length || 0) - 1}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}

            <p className="text-[12.5px] text-[#71717A] leading-relaxed">
              {(connectModalUser.skillsToTeach || []).some((s) =>
                (currentUserProfile?.skillsToLearn || []).some((my) => skillsFlexMatch(my, s))
              )
                ? "Mutual skill overlap found. Connecting adds them to your network to coordinate 1:1 skill swaps."
                : `Connecting adds ${(connectModalUser.fullName || "this member").trim().split(/\s+/)[0]} to your network so you can coordinate skill swaps and stay updated.`}
            </p>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setConnectModalUser(null)}
                className="flex-1 h-11 rounded-xl border border-[#E8E4DB] bg-[#FFFFFF] hover:bg-[#F7F4EE] text-[13px] font-semibold text-[#0D0D0F] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                id="confirm-connect-btn"
                type="button"
                disabled={Boolean(connectingUserIds[connectModalUser.uid])}
                onClick={() => executeConnectionChange(connectModalUser, "connect")}
                className="flex-[1.5] h-11 rounded-xl bg-[#0D0D0F] hover:bg-[#1C1C20] active:scale-[0.98] text-[#F7F4EE] text-[13px] font-semibold transition inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {connectingUserIds[connectModalUser.uid] ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#C9A96E]" />
                ) : (
                  <UserPlus className="w-4 h-4 text-[#C9A96E]" strokeWidth={2.2} />
                )}
                <span>Confirm &amp; Connect</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Sheet */}
      {disconnectModalUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="disconnect-modal-title"
          onClick={() => setDisconnectModalUser(null)}
          className="fixed inset-0 z-50 bg-[#0D0D0F]/45 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 animate-fade-in font-sans"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-[380px] rounded-t-3xl sm:rounded-2xl bg-[#FFFFFF] border-t sm:border border-[#E8E4DB] p-5 pb-7 sm:pb-5 shadow-2xl flex flex-col gap-4"
          >
            <div className="flex flex-col items-center text-center gap-2.5 pt-1">
              <SmartImage
                src={disconnectModalUser.photoUrl || disconnectModalUser.photoURL}
                alt={disconnectModalUser.fullName}
                fallbackType="profile"
                fullName={disconnectModalUser.fullName}
                sizeType="thumbnail"
                className="w-14 h-14 rounded-full object-cover bg-[#F2EFE8] border border-[#E8E4DB]"
              />
              <div>
                <h3
                  id="disconnect-modal-title"
                  className="text-[15.5px] font-bold text-[#0D0D0F]"
                >
                  Remove connection with {(disconnectModalUser.fullName || "Member").trim().split(/\s+/)[0]}?
                </h3>
                <p className="text-[12.5px] text-[#71717A] leading-relaxed mt-1 max-w-[300px]">
                  They will be removed from your connections list. You can reconnect anytime from Discover or their profile.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setDisconnectModalUser(null)}
                className="flex-1 h-11 rounded-xl border border-[#E8E4DB] bg-[#FFFFFF] hover:bg-[#F7F4EE] text-[13px] font-semibold text-[#0D0D0F] transition cursor-pointer"
              >
                Keep Connected
              </button>
              <button
                id="confirm-disconnect-btn"
                type="button"
                disabled={Boolean(connectingUserIds[disconnectModalUser.uid])}
                onClick={() => executeConnectionChange(disconnectModalUser, "disconnect")}
                className="flex-1 h-11 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-[13px] font-semibold transition inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {connectingUserIds[disconnectModalUser.uid] && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>Disconnect</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle Action Toast */}
      {connectToast && (
        <div className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-[calc(100vw-2rem)] animate-fade-in">
          <div className="rounded-xl bg-[#0D0D0F] text-[#F7F4EE] border border-[#27272A] shadow-xl px-4 py-2.5 flex items-center gap-3">
            {connectToast.variant === "connected" ? (
              <Check className="w-4 h-4 text-[#C9A96E] shrink-0" strokeWidth={2.5} />
            ) : connectToast.variant === "error" ? (
              <X className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <UserCheck className="w-4 h-4 text-[#A1A1AA] shrink-0" />
            )}
            <span className="text-[12.5px] font-medium whitespace-nowrap">
              {connectToast.message}
            </span>
            {connectToast.userId && (
              <button
                type="button"
                onClick={() => {
                  const uid = connectToast.userId!;
                  setConnectToast(null);
                  onSelectUser(uid);
                }}
                className="text-[12px] font-semibold text-[#C9A96E] hover:underline whitespace-nowrap cursor-pointer pl-1 border-l border-white/15"
              >
                View profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
