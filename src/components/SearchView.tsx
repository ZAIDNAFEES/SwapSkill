import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { UserProfile, DEFAULT_AVATAR } from "../types";
import { useApp } from "../context/AppContext";
import SkeletonLoader, { LoadingTransition } from "./SkeletonLoader";
import SmartImage from "./SmartImage";
import { safeLocalStorage } from "../utils/safeStorage";
import { useUserPresence } from "../hooks/useUserPresence";
import { searchUsers, normalizeSearchTerm } from "../services/userSearchService";
import { 
  Search, 
  Sparkles, 
  BookOpen, 
  MapPin, 
  X, 
  Globe, 
  User, 
  Filter, 
  SlidersHorizontal, 
  Star, 
  CheckCircle, 
  Check,
  UserPlus,
  MessageSquare,
  Calendar,
  Clock, 
  TrendingUp, 
  UserCheck,
  RefreshCw,
  AlertCircle
} from "lucide-react";
import FollowButton from "./FollowButton";

interface SearchViewProps {
  currentUserId: string;
  onSelectUser: (userId: string) => void;
}

export default function SearchView({ currentUserId, onSelectUser }: SearchViewProps) {
  const { 
    discoveryUsers, 
    loadingDiscovery, 
    currentUserProfile, 
    toggleFollow, 
    setProfileInCache,
    profilesCache 
  } = useApp();

  const [followingStates, setFollowingStates] = useState<Record<string, boolean>>({});
  
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = safeLocalStorage.getItem("swap_recent_searches");
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  const me = currentUserProfile;

  // Search input state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Server search state
  const [serverSearchResults, setServerSearchResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasExecutedSearch, setHasExecutedSearch] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const currentSearchRequestIdRef = useRef<number>(0);

  // Filters state
  const [showFilters, setShowFilters] = useState(false);
  const [filterTeachSkill, setFilterTeachSkill] = useState("");
  const [filterLearnSkill, setFilterLearnSkill] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterLanguage, setFilterLanguage] = useState("");
  const [filterAvailability, setFilterAvailability] = useState("");
  const [filterVerifiedOnly, setFilterVerifiedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"match" | "rating" | "newest">("match");

  // Check for deep-linked search skill from Home dashboard
  useEffect(() => {
    try {
      const pending = safeLocalStorage.getItem("swap_pending_search");
      if (pending) {
        setSearchQuery(pending);
        safeLocalStorage.removeItem("swap_pending_search");
      }
    } catch (_) {}
  }, []);

  // Debounce the search query
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setDebouncedQuery("");
      setServerSearchResults([]);
      setIsSearching(false);
      setHasExecutedSearch(false);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    const handler = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, 250);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Execute Firestore search when debouncedQuery changes
  useEffect(() => {
    const cleanTerm = debouncedQuery.trim();
    if (!cleanTerm) {
      setServerSearchResults([]);
      setIsSearching(false);
      setHasExecutedSearch(false);
      setSearchError(null);
      return;
    }

    const requestId = ++currentSearchRequestIdRef.current;
    setIsSearching(true);
    setSearchError(null);

    let isMounted = true;

    searchUsers(cleanTerm, { currentUserId, limitCount: 40 })
      .then((results) => {
        if (!isMounted || requestId !== currentSearchRequestIdRef.current) return;

        // Cache all fetched profiles in global cache for 0ms navigation
        results.forEach((p) => {
          if (setProfileInCache) setProfileInCache(p);
        });

        setServerSearchResults(results);
        setHasExecutedSearch(true);
        setIsSearching(false);
        setSearchError(null);

        // Save to recent searches if matches found
        if (results.length > 0) {
          saveSearch(cleanTerm);
        }
      })
      .catch((err) => {
        if (!isMounted || requestId !== currentSearchRequestIdRef.current) return;
        console.error("Firestore user search error:", err);
        setSearchError("Unable to load search results. Please try again.");
        setIsSearching(false);
        setHasExecutedSearch(true);
      });

    return () => {
      isMounted = false;
    };
  }, [debouncedQuery, currentUserId, setProfileInCache]);

  const retrySearch = useCallback(() => {
    if (!debouncedQuery.trim()) return;
    const cleanTerm = debouncedQuery.trim();
    const requestId = ++currentSearchRequestIdRef.current;
    setIsSearching(true);
    setSearchError(null);

    searchUsers(cleanTerm, { currentUserId, limitCount: 40 })
      .then((results) => {
        if (requestId !== currentSearchRequestIdRef.current) return;
        results.forEach((p) => {
          if (setProfileInCache) setProfileInCache(p);
        });
        setServerSearchResults(results);
        setHasExecutedSearch(true);
        setIsSearching(false);
      })
      .catch((err) => {
        if (requestId !== currentSearchRequestIdRef.current) return;
        console.error("Retry search error:", err);
        setSearchError("Unable to load search results. Please check your connection.");
        setIsSearching(false);
      });
  }, [debouncedQuery, currentUserId, setProfileInCache]);

  const saveSearch = (term: string) => {
    const cleanTerm = term.trim();
    if (!cleanTerm) return;
    setRecentSearches((prev) => {
      const filtered = prev.filter((t) => t.toLowerCase() !== cleanTerm.toLowerCase());
      const updated = [cleanTerm, ...filtered].slice(0, 5);
      try {
        safeLocalStorage.setItem("swap_recent_searches", JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  };

  // Dynamic Matching Score Engine
  const calculateMatchScore = (other: UserProfile): number => {
    if (!me) return 0;
    let score = 0;

    const otherTeachesMyLearn = other.skillsToTeach?.some(skill => 
      me.skillsToLearn?.some(mySkill => mySkill.toLowerCase().trim() === skill.toLowerCase().trim())
    );
    const otherLearnsMyTeach = other.skillsToLearn?.some(skill => 
      me.skillsToTeach?.some(mySkill => mySkill.toLowerCase().trim() === skill.toLowerCase().trim())
    );

    if (otherTeachesMyLearn && otherLearnsMyTeach) {
      score += 50;
    } else if (otherTeachesMyLearn || otherLearnsMyTeach) {
      score += 25;
    }

    const commonLanguages = other.languages?.filter(lang => 
      me.languages?.some(myLang => myLang.toLowerCase().trim() === lang.toLowerCase().trim())
    );
    if (commonLanguages && commonLanguages.length > 0) {
      score += 15;
    }

    if (other.country && me.country && other.country.toLowerCase().trim() === me.country.toLowerCase().trim()) {
      score += 15;
    }

    if (other.availability && me.availability && other.availability.toLowerCase().trim() === me.availability.toLowerCase().trim()) {
      score += 10;
    }

    if (other.verified) score += 5;
    if (other.rating && other.rating >= 4.5) score += 5;

    return Math.min(100, score);
  };

  // All candidates pool for dropdown filters
  const allPoolUsers = useMemo(() => {
    const map = new Map<string, UserProfile>();
    discoveryUsers.forEach(u => map.set(u.uid, u));
    serverSearchResults.forEach(u => map.set(u.uid, u));
    if (profilesCache) {
      (Object.values(profilesCache) as UserProfile[]).forEach(u => {
        if (u && u.uid) map.set(u.uid, u);
      });
    }
    return Array.from(map.values());
  }, [discoveryUsers, serverSearchResults, profilesCache]);

  const uniqueCountries = useMemo(() => {
    const list = new Set<string>();
    allPoolUsers.forEach(u => u.country && list.add(u.country));
    return Array.from(list).sort();
  }, [allPoolUsers]);

  const uniqueLanguages = useMemo(() => {
    const list = new Set<string>();
    allPoolUsers.forEach(u => u.languages?.forEach(l => list.add(l)));
    return Array.from(list).sort();
  }, [allPoolUsers]);

  // Combine Search, Local Memory, and Multi-Filter operations
  const processedUsers = useMemo(() => {
    const isSearchActive = Boolean(debouncedQuery.trim());
    const { clean: queryTerm } = normalizeSearchTerm(debouncedQuery);

    let candidates: UserProfile[] = [];

    if (isSearchActive) {
      const candidateMap = new Map<string, UserProfile>();

      // 1. Add server search results (authoritative Firestore results)
      serverSearchResults.forEach(u => {
        if (u && u.uid && u.uid !== currentUserId) {
          candidateMap.set(u.uid, u);
        }
      });

      // 2. Also match from in-memory discoveryUsers & profilesCache for 0ms instant display
      const memorySources: UserProfile[] = [
        ...discoveryUsers, 
        ...(profilesCache ? (Object.values(profilesCache) as UserProfile[]) : [])
      ];

      memorySources.forEach((user) => {
        if (!user || !user.uid || user.uid === currentUserId || candidateMap.has(user.uid)) return;

        const nameMatch = user.fullName?.toLowerCase().includes(queryTerm);
        const usernameMatch = user.username?.toLowerCase().includes(queryTerm);
        const cityMatch = user.city?.toLowerCase().includes(queryTerm);
        const countryMatch = user.country?.toLowerCase().includes(queryTerm);
        const teachMatch = user.skillsToTeach?.some(s => s.toLowerCase().includes(queryTerm));
        const learnMatch = user.skillsToLearn?.some(s => s.toLowerCase().includes(queryTerm));
        const langMatch = user.languages?.some(l => l.toLowerCase().includes(queryTerm));

        if (nameMatch || usernameMatch || cityMatch || countryMatch || teachMatch || learnMatch || langMatch) {
          candidateMap.set(user.uid, user);
        }
      });

      candidates = Array.from(candidateMap.values());
    } else {
      // Explore/Browse mode: show discovery users (excluding self)
      candidates = discoveryUsers.filter(u => u.uid !== currentUserId);
    }

    // Apply secondary facet filters
    let result = candidates;

    if (filterTeachSkill) {
      const term = filterTeachSkill.toLowerCase();
      result = result.filter(u => u.skillsToTeach?.some(s => s.toLowerCase().includes(term)));
    }
    if (filterLearnSkill) {
      const term = filterLearnSkill.toLowerCase();
      result = result.filter(u => u.skillsToLearn?.some(s => s.toLowerCase().includes(term)));
    }
    if (filterCountry) {
      result = result.filter(u => u.country === filterCountry);
    }
    if (filterLanguage) {
      const term = filterLanguage.toLowerCase();
      result = result.filter(u => u.languages?.some(l => l.toLowerCase() === term));
    }
    if (filterAvailability) {
      result = result.filter(u => u.availability === filterAvailability);
    }
    if (filterVerifiedOnly) {
      result = result.filter(u => u.verified === true);
    }

    // Compute match scores
    const scoredUsers = result.map(u => ({
      ...u,
      matchScore: calculateMatchScore(u)
    }));

    // Sorting
    if (sortBy === "match") {
      scoredUsers.sort((a, b) => {
        // In search mode, prioritize exact username/name match
        if (isSearchActive && queryTerm) {
          const aUser = (a.username || "").toLowerCase();
          const bUser = (b.username || "").toLowerCase();
          if (aUser === queryTerm && bUser !== queryTerm) return -1;
          if (bUser === queryTerm && aUser !== queryTerm) return 1;
        }
        return b.matchScore - a.matchScore;
      });
    } else if (sortBy === "rating") {
      scoredUsers.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === "newest") {
      scoredUsers.sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return dateB.getTime() - dateA.getTime();
      });
    }

    return scoredUsers;
  }, [
    debouncedQuery, 
    serverSearchResults, 
    discoveryUsers, 
    profilesCache, 
    currentUserId, 
    me, 
    filterTeachSkill, 
    filterLearnSkill, 
    filterCountry, 
    filterLanguage, 
    filterAvailability, 
    filterVerifiedOnly, 
    sortBy
  ]);

  const activeFilterCount = (filterTeachSkill ? 1 : 0) + 
    (filterLearnSkill ? 1 : 0) + 
    (filterCountry ? 1 : 0) + 
    (filterLanguage ? 1 : 0) + 
    (filterAvailability ? 1 : 0) + 
    (filterVerifiedOnly ? 1 : 0);

  const clearAllFilters = () => {
    setFilterTeachSkill("");
    setFilterLearnSkill("");
    setFilterCountry("");
    setFilterLanguage("");
    setFilterAvailability("");
    setFilterVerifiedOnly(false);
    setSearchQuery("");
  };

  // Determine overall loading state
  const isSearchMode = Boolean(searchQuery.trim() || debouncedQuery.trim());
  const isLoading = isSearchMode 
    ? (isSearching && processedUsers.length === 0)
    : (loadingDiscovery && discoveryUsers.length === 0);

  return (
    <div className="flex flex-col min-h-screen bg-[#F7F4EE] text-[#0D0D0F] font-sans pb-28 w-full overflow-x-hidden mobile-scroll">
      
      {/* Search Header and Action Dock */}
      <div className="px-4 sm:px-6 pt-safe pt-4 pb-4 border-b border-[#E8E4DB] bg-[#F7F4EE]/90 backdrop-blur-md sticky top-0 z-20 flex flex-col gap-3.5 w-full shadow-2xs">
        <div className="max-w-6xl mx-auto w-full flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold text-[#0D0D0F] tracking-tight">Explore Network</h1>
            <p className="text-[#71717A] text-xs font-normal">Find mentors, collaborators, and skill swaps</p>
          </div>
          
          <button
            id="toggle-filters-panel-btn"
            onClick={() => setShowFilters(!showFilters)}
            className={`h-9 px-3.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
              showFilters || activeFilterCount > 0
                ? "bg-[#0D0D0F] border-[#0D0D0F] text-[#F7F4EE] shadow-2xs" 
                : "bg-[#FFFFFF] border-[#E8E4DB] text-[#0D0D0F] hover:bg-[#F2EFE8]"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> 
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-[#C9A96E] text-[#0D0D0F] text-[10px] flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Minimal Search Input */}
        <div className="max-w-6xl mx-auto w-full relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717A]" />
          <input
            id="search-input-field"
            type="text"
            placeholder="Search by username, name, skill, topic, location, language..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-10 bg-[#FFFFFF] border border-[#E8E4DB] rounded-xl text-xs sm:text-sm focus:outline-none focus:border-[#C9A96E] text-[#0D0D0F] placeholder-[#71717A] transition-all shadow-2xs"
          />
          {searchQuery && (
            <button
              id="search-clear-btn"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#F2EFE8] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
              title="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Sort & Filter Pills */}
        <div className="max-w-6xl mx-auto w-full flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
          <button
            onClick={() => setSortBy("match")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              sortBy === "match"
                ? "bg-[#0D0D0F] text-[#F7F4EE] shadow-2xs"
                : "bg-[#FFFFFF] border border-[#E8E4DB] text-[#71717A] hover:text-[#0D0D0F] hover:bg-[#F2EFE8]"
            }`}
          >
            Best Match
          </button>
          <button
            onClick={() => setSortBy("rating")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              sortBy === "rating"
                ? "bg-[#0D0D0F] text-[#F7F4EE] shadow-2xs"
                : "bg-[#FFFFFF] border border-[#E8E4DB] text-[#71717A] hover:text-[#0D0D0F] hover:bg-[#F2EFE8]"
            }`}
          >
            Top Rated
          </button>
          <button
            onClick={() => setSortBy("newest")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              sortBy === "newest"
                ? "bg-[#0D0D0F] text-[#F7F4EE] shadow-2xs"
                : "bg-[#FFFFFF] border border-[#E8E4DB] text-[#71717A] hover:text-[#0D0D0F] hover:bg-[#F2EFE8]"
            }`}
          >
            Newest
          </button>
          <button
            onClick={() => setFilterVerifiedOnly(!filterVerifiedOnly)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
              filterVerifiedOnly
                ? "bg-[#0D0D0F] text-[#F7F4EE] shadow-2xs"
                : "bg-[#FFFFFF] border border-[#E8E4DB] text-[#71717A] hover:text-[#0D0D0F] hover:bg-[#F2EFE8]"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E]" />
            Verified Only
          </button>
        </div>

        {/* Expandable Filter Panel */}
        {showFilters && (
          <div className="max-w-6xl mx-auto w-full p-4 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl flex flex-col gap-3.5 animate-fade-in shadow-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Teaching Skill */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-[#71717A]">Offers Skill</label>
                <input
                  type="text"
                  placeholder="e.g. Design Systems"
                  value={filterTeachSkill}
                  onChange={(e) => setFilterTeachSkill(e.target.value)}
                  className="w-full h-9 px-3 bg-[#F2EFE8] border border-[#E8E4DB] rounded-lg text-xs text-[#0D0D0F] focus:outline-none focus:border-[#C9A96E]"
                />
              </div>

              {/* Learning Skill */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-[#71717A]">Seeks Skill</label>
                <input
                  type="text"
                  placeholder="e.g. TypeScript"
                  value={filterLearnSkill}
                  onChange={(e) => setFilterLearnSkill(e.target.value)}
                  className="w-full h-9 px-3 bg-[#F2EFE8] border border-[#E8E4DB] rounded-lg text-xs text-[#0D0D0F] focus:outline-none focus:border-[#C9A96E]"
                />
              </div>

              {/* Country Selection */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-[#71717A]">Country</label>
                <select
                  value={filterCountry}
                  onChange={(e) => setFilterCountry(e.target.value)}
                  className="w-full h-9 px-2 bg-[#F2EFE8] border border-[#E8E4DB] rounded-lg text-xs text-[#0D0D0F] focus:outline-none"
                >
                  <option value="">All Regions</option>
                  {uniqueCountries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Language Selection */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-[#71717A]">Language</label>
                <select
                  value={filterLanguage}
                  onChange={(e) => setFilterLanguage(e.target.value)}
                  className="w-full h-9 px-2 bg-[#F2EFE8] border border-[#E8E4DB] rounded-lg text-xs text-[#0D0D0F] focus:outline-none"
                >
                  <option value="">All Languages</option>
                  {uniqueLanguages.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            {activeFilterCount > 0 && (
              <div className="flex justify-end pt-1">
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-[#71717A] hover:text-[#0D0D0F] font-medium transition cursor-pointer"
                >
                  Reset all filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Results Showcase Grid */}
      <div className="flex-1 px-4 sm:px-6 pt-5 w-full max-w-6xl mx-auto">
        <LoadingTransition isLoading={isLoading} type="search" count={4}>
          {searchError && processedUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-4 max-w-sm mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mb-4 text-rose-500">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[#0D0D0F] mb-1">Search Interrupted</h3>
              <p className="text-[#71717A] text-xs leading-relaxed mb-4">
                {searchError}
              </p>
              <button
                onClick={retrySearch}
                className="luxury-button-secondary px-4 py-2 text-xs flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Search</span>
              </button>
            </div>
          ) : processedUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-20 px-4 max-w-sm mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-[#FFFFFF] border border-[#E8E4DB] flex items-center justify-center mb-4">
                <Search className="w-6 h-6 text-[#71717A]" strokeWidth={1.8} />
              </div>
              <h3 className="text-base font-semibold text-[#0D0D0F] mb-1">
                {isSearchMode ? "No matching profiles" : "No profiles available"}
              </h3>
              <p className="text-[#71717A] text-xs leading-relaxed mb-4">
                {isSearchMode 
                  ? `No user found matching "${searchQuery.trim()}". Try searching by username, full name, or skills.`
                  : "Try clearing active filters or refreshing the explore network."}
              </p>
              {(activeFilterCount > 0 || isSearchMode) && (
                <button
                  onClick={clearAllFilters}
                  className="luxury-button-secondary px-4 py-2 text-xs cursor-pointer"
                >
                  Clear all filters & search
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4 pb-12">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#71717A] tracking-wider uppercase">
                  {processedUsers.length} {processedUsers.length === 1 ? "Profile" : "Profiles"} {isSearchMode ? "Found" : "Available"}
                </span>
                {isSearching && (
                  <span className="text-[11px] text-[#C9A96E] font-medium flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#C9A96E] animate-ping" />
                    Updating results...
                  </span>
                )}
              </div>

              {/* Scored Matches Results Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {processedUsers.map((user) => (
                  <SearchUserCard
                    key={user.uid}
                    user={user}
                    me={me}
                    toggleFollow={toggleFollow}
                    onSelectUser={onSelectUser}
                    followingStates={followingStates}
                    setFollowingStates={setFollowingStates}
                    sortBy={sortBy}
                  />
                ))}
              </div>
            </div>
          )}
        </LoadingTransition>
      </div>
    </div>
  );
}

interface SearchUserCardProps {
  key?: string;
  user: UserProfile;
  me: UserProfile | null;
  toggleFollow: (uid: string) => Promise<any>;
  onSelectUser: (uid: string) => void;
  followingStates: Record<string, boolean>;
  setFollowingStates: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  sortBy: string;
}

function SearchUserCard({
  user,
  me,
  toggleFollow,
  onSelectUser,
  followingStates,
  setFollowingStates,
  sortBy
}: SearchUserCardProps) {
  const presence = useUserPresence(user.uid);

  const followingList = me?.followingList || [];
  const isFollowingLocal = followingStates[user.uid] !== undefined 
    ? followingStates[user.uid] 
    : followingList.includes(user.uid);

  const handleFollowClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setFollowingStates(prev => ({ ...prev, [user.uid]: !isFollowingLocal }));
    try {
      await toggleFollow(user.uid);
    } catch (err) {
      console.error("Follow toggling failed:", err);
      setFollowingStates(prev => ({ ...prev, [user.uid]: isFollowingLocal }));
    }
  };

  return (
    <div
      id={`search-user-row-${user.uid}`}
      onClick={() => onSelectUser(user.uid)}
      className="luxury-card p-5 flex flex-col justify-between gap-4 cursor-pointer group"
    >
      {/* Top Row: User Avatar, Name, Handle, Rating */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="relative shrink-0">
            <SmartImage
              src={user.photoUrl || user.photoURL || DEFAULT_AVATAR}
              alt={user.fullName}
              fallbackType="profile"
              fullName={user.fullName}
              sizeType="thumbnail"
              className="w-13 h-13 rounded-full border border-[#E8E4DB] object-cover shadow-2xs"
            />
            {user.verified && (
              <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#0D0D0F] text-[#C9A96E] border border-[#C9A96E]/40 flex items-center justify-center text-[9px] font-bold">
                ✓
              </span>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="font-semibold text-sm text-[#0D0D0F] group-hover:text-[#C9A96E] transition-colors truncate leading-tight">
                {user.fullName}
              </h3>
            </div>

            <p className="text-[11px] text-[#71717A] truncate mt-0.5">
              @{user.username}
            </p>

            {(user.city || user.country) && (
              <div className="flex items-center gap-1 text-[11px] text-[#71717A] mt-0.5 truncate">
                <MapPin className="w-3 h-3 text-[#71717A] shrink-0" />
                <span className="truncate">{user.city ? `${user.city}, ${user.country || ""}` : user.country}</span>
              </div>
            )}
          </div>
        </div>

        {/* Rating Badge */}
        {user.rating && user.rating > 0 ? (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#F2EFE8] border border-[#E8E4DB] text-xs font-medium text-[#0D0D0F] shrink-0">
            <Star className="w-3 h-3 fill-[#C9A96E] text-[#C9A96E]" />
            <span>{user.rating.toFixed(1)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#F2EFE8] border border-[#E8E4DB] text-[10px] font-medium text-[#71717A] shrink-0">
            <span>New</span>
          </div>
        )}
      </div>

      {/* Bio snippet */}
      {user.bio && (
        <p className="text-xs text-[#71717A] line-clamp-2 leading-relaxed font-normal">
          {user.bio}
        </p>
      )}

      {/* Skills Section */}
      <div className="flex flex-col gap-2 pt-3 border-t border-[#E8E4DB]">
        {/* Teaches Skills */}
        {user.skillsToTeach && user.skillsToTeach.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-medium text-[#71717A] uppercase tracking-wider shrink-0">Offers:</span>
            {user.skillsToTeach.slice(0, 3).map((skill) => (
              <span key={skill} className="luxury-tag truncate max-w-[130px]">
                {skill}
              </span>
            ))}
            {user.skillsToTeach.length > 3 && (
              <span className="text-[10px] text-[#71717A] font-medium">+{user.skillsToTeach.length - 3}</span>
            )}
          </div>
        )}

        {/* Wants Skills */}
        {user.skillsToLearn && user.skillsToLearn.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-medium text-[#71717A] uppercase tracking-wider shrink-0">Seeks:</span>
            {user.skillsToLearn.slice(0, 3).map((skill) => (
              <span key={skill} className="text-[11px] px-2.5 py-0.5 rounded-md border border-dashed border-[#E8E4DB] text-[#71717A] truncate max-w-[130px]">
                {skill}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action Footer Row */}
      <div className="flex items-center gap-2 pt-1 mt-auto">
        <FollowButton
          isFollowing={isFollowingLocal}
          onClick={handleFollowClick}
          fullWidth={false}
          className="flex-1 h-[36px]"
        />

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectUser(user.uid);
          }}
          className="flex-1 h-[36px] px-3 rounded-xl text-xs font-medium bg-[#FFFFFF] border border-[#E8E4DB] text-[#0D0D0F] hover:bg-[#F2EFE8] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
        >
          <MessageSquare className="w-3.5 h-3.5 text-[#71717A]" />
          <span>Message</span>
        </button>
      </div>
    </div>
  );
}
