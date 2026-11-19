import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { UserProfile, DEFAULT_AVATAR } from "../types";
import { useApp } from "../context/AppContext";
import SkeletonLoader, { LoadingTransition } from "./SkeletonLoader";
import SmartImage from "./SmartImage";
import { safeLocalStorage } from "../utils/safeStorage";
import { useUserPresence } from "../hooks/useUserPresence";
import { searchUsers, normalizeSearchTerm, fetchVerifiedUsers } from "../services/userSearchService";
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
  AlertCircle,
  BadgeCheck,
  ChevronDown,
  ArrowLeftRight,
  Loader2
} from "lucide-react";
import FollowButton from "./FollowButton";
import { countries } from "../data/countries";
import { WORLD_LANGUAGES } from "../data/languages";
import SearchablePickerModal, { PickerOption } from "./SearchablePickerModal";

function getTimestampMs(val: any): number {
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

function normalizeCountryKey(val?: string): string {
  const c = (val || "").toLowerCase().trim();
  if (!c) return "";
  if (c === "usa" || c === "us" || c === "united states" || c === "united states of america") {
    return "united states of america";
  }
  if (c === "uk" || c === "gb" || c === "great britain" || c === "united kingdom") {
    return "united kingdom";
  }
  if (c === "uae" || c === "ae" || c === "united arab emirates") {
    return "united arab emirates";
  }
  return c;
}

function skillsOverlap(a: string, b: string): boolean {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (!s1 || !s2) return false;
  if (s1 === s2) return true;
  if (s1.length >= 2 && s2.includes(s1)) return true;
  if (s2.length >= 2 && s1.includes(s2)) return true;
  return false;
}

function isProfileVerified(u: any): boolean {
  return u?.verified === true || u?.verified === "true" || u?.verificationStatus === "approved";
}

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
  const [verifiedUsers, setVerifiedUsers] = useState<UserProfile[]>([]);
  const [isLoadingVerified, setIsLoadingVerified] = useState(false);
  const [sortBy, setSortBy] = useState<"match" | "rating" | "newest">("match");
  const [pickerMode, setPickerMode] = useState<"country" | "language" | null>(null);

  // Fetch verified users on-demand (cached in memory so repeated toggles cost 0 reads)
  useEffect(() => {
    if (!filterVerifiedOnly) {
      setIsLoadingVerified(false);
      return;
    }

    let cancelled = false;
    setIsLoadingVerified(true);

    fetchVerifiedUsers(currentUserId)
      .then((results) => {
        if (cancelled) return;
        results.forEach((p) => {
          if (setProfileInCache) setProfileInCache(p);
        });
        setVerifiedUsers(results);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingVerified(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filterVerifiedOnly, currentUserId, setProfileInCache]);

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

  // Dynamic Matching Score Engine (flexible bidirectional matching)
  const calculateMatchScore = (other: UserProfile): number => {
    let score = 0;

    if (me) {
      const otherTeachesMyLearn = other.skillsToTeach?.some((skill) =>
        me.skillsToLearn?.some((mySkill) => skillsOverlap(skill, mySkill))
      );
      const otherLearnsMyTeach = other.skillsToLearn?.some((skill) =>
        me.skillsToTeach?.some((mySkill) => skillsOverlap(skill, mySkill))
      );

      if (otherTeachesMyLearn && otherLearnsMyTeach) {
        score += 55;
      } else if (otherTeachesMyLearn || otherLearnsMyTeach) {
        score += 30;
      }

      const commonLanguages = other.languages?.filter((lang) =>
        me.languages?.some((myLang) => skillsOverlap(lang, myLang))
      );
      if (commonLanguages && commonLanguages.length > 0) {
        score += 15;
      }

      if (
        other.country &&
        me.country &&
        normalizeCountryKey(other.country) === normalizeCountryKey(me.country)
      ) {
        score += 10;
      }

      if (other.city && me.city && other.city.toLowerCase().trim() === me.city.toLowerCase().trim()) {
        score += 5;
      }

      if (
        other.availability &&
        me.availability &&
        other.availability.toLowerCase().trim() === me.availability.toLowerCase().trim()
      ) {
        score += 5;
      }
    }

    if (other.verified) score += 5;
    if (other.rating && other.rating >= 4.5 && (other.reviewCount || 0) > 0) score += 5;
    if ((other.sessionsCount || 0) > 0) score += Math.min(5, other.sessionsCount || 0);

    return Math.min(100, score);
  };

  // All candidates pool for preserving any custom entries alongside A-Z lists
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

  // Complete A-Z Countries options (all 195+ countries + any custom user entries)
  const countryOptions: PickerOption[] = useMemo(() => {
    const byKey = new Map<string, PickerOption>();
    countries.forEach((c) => {
      byKey.set(normalizeCountryKey(c.name), {
        value: c.name,
        label: c.name,
        prefix: c.flag,
        hint: c.code,
      });
    });
    allPoolUsers.forEach((u) => {
      if (u.country && u.country.trim()) {
        const key = normalizeCountryKey(u.country);
        if (!byKey.has(key)) {
          byKey.set(key, {
            value: u.country.trim(),
            label: u.country.trim(),
            prefix: "🌍",
          });
        }
      }
    });
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [allPoolUsers]);

  // Complete A-Z Languages options (all world languages + any custom user entries)
  const languageOptions: PickerOption[] = useMemo(() => {
    const byLower = new Map<string, PickerOption>();
    WORLD_LANGUAGES.forEach((lang) => {
      byLower.set(lang.toLowerCase(), { value: lang, label: lang });
    });
    allPoolUsers.forEach((u) => {
      u.languages?.forEach((l) => {
        const clean = l?.trim();
        if (clean && !byLower.has(clean.toLowerCase())) {
          byLower.set(clean.toLowerCase(), { value: clean, label: clean });
        }
      });
    });
    return Array.from(byLower.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [allPoolUsers]);

  const selectedCountryOption = useMemo(() => {
    if (!filterCountry) return null;
    const key = normalizeCountryKey(filterCountry);
    return countryOptions.find((c) => normalizeCountryKey(c.value) === key) || null;
  }, [filterCountry, countryOptions]);

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
      // Explore/Browse mode: combine discoveryUsers, verifiedUsers, and cached full profiles (excluding self)
      const candidateMap = new Map<string, UserProfile>();
      const addCandidate = (u?: UserProfile | null) => {
        if (!u) return;
        const uid = u.uid || (u as any)?.id;
        if (!uid || uid === currentUserId) return;
        const existing = candidateMap.get(uid);
        if (!existing || (isProfileVerified(u) && !isProfileVerified(existing))) {
          candidateMap.set(uid, { ...u, uid });
        }
      };

      (discoveryUsers || []).forEach(addCandidate);
      if (profilesCache) {
        (Object.values(profilesCache) as UserProfile[]).forEach((u) => {
          if (u && (u.fullName || u.username)) addCandidate(u);
        });
      }
      verifiedUsers.forEach(addCandidate);

      candidates = Array.from(candidateMap.values());
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
      const targetKey = normalizeCountryKey(filterCountry);
      const matchedCountryObj = countries.find((c) => normalizeCountryKey(c.name) === targetKey);
      result = result.filter((u) => {
        const userKey = normalizeCountryKey(u.country);
        if (userKey && userKey === targetKey) return true;
        if (matchedCountryObj && u.countryCode && u.countryCode.toUpperCase() === matchedCountryObj.code) {
          return true;
        }
        return false;
      });
    }
    if (filterLanguage) {
      const term = filterLanguage.toLowerCase().trim();
      result = result.filter((u) =>
        u.languages?.some((l) => {
          const langLower = l.toLowerCase().trim();
          return langLower === term || term.includes(langLower) || langLower.includes(term);
        })
      );
    }
    if (filterAvailability) {
      result = result.filter(u => u.availability === filterAvailability);
    }
    if (filterVerifiedOnly) {
      result = result.filter((u) => isProfileVerified(u));
    }

    // Compute match scores
    const scoredUsers = result.map(u => ({
      ...u,
      matchScore: calculateMatchScore(u)
    }));

    // Sorting
    if (sortBy === "match") {
      scoredUsers.sort((a, b) => {
        if (isSearchActive && queryTerm) {
          const aUser = (a.username || "").toLowerCase();
          const bUser = (b.username || "").toLowerCase();
          if (aUser === queryTerm && bUser !== queryTerm) return -1;
          if (bUser === queryTerm && aUser !== queryTerm) return 1;
        }
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return (b.sessionsCount || 0) - (a.sessionsCount || 0);
      });
    } else if (sortBy === "rating") {
      scoredUsers.sort((a, b) => {
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
    } else if (sortBy === "newest") {
      scoredUsers.sort((a, b) => {
        const msB = getTimestampMs(b.createdAt) || getTimestampMs((b as any).updatedAt);
        const msA = getTimestampMs(a.createdAt) || getTimestampMs((a as any).updatedAt);
        return msB - msA;
      });
    }

    return scoredUsers;
  }, [
    debouncedQuery, 
    serverSearchResults, 
    discoveryUsers, 
    verifiedUsers,
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
    : ((loadingDiscovery && discoveryUsers.length === 0) || (filterVerifiedOnly && isLoadingVerified && processedUsers.length === 0));

  return (
    <div className="flex flex-col min-h-full bg-[#F7F4EE] text-[#0D0D0F] font-sans pb-28 relative w-full overflow-x-clip">
      
      {/* Compact Sticky Search Header & Single-Row Toolbar */}
      <header
        className="px-4 sm:px-6 lg:px-8 pb-3.5 border-b border-[#E8E4DB] bg-[#F7F4EE]/95 backdrop-blur-md sticky top-0 z-20 flex flex-col gap-3 w-full"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 14px)" }}
      >
        <div className="max-w-6xl mx-auto w-full flex justify-between items-center gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-[20px] font-bold text-[#0D0D0F] tracking-tight whitespace-nowrap">
              Explore
            </h1>
            {!isLoading && (
              <span className="text-[13px] font-normal text-[#71717A] tabular-nums whitespace-nowrap">
                {processedUsers.length} {processedUsers.length === 1 ? (isSearchMode ? "result" : "person") : (isSearchMode ? "results" : "people")}
              </span>
            )}
          </div>
          
          <button
            id="toggle-filters-panel-btn"
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`h-10 px-3.5 rounded-xl border text-[13px] font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 active:scale-[0.98] ${
              showFilters || activeFilterCount > 0
                ? "bg-[#0D0D0F] border-[#0D0D0F] text-[#F7F4EE]" 
                : "bg-[#FFFFFF] border-[#E8E4DB] text-[#0D0D0F] hover:bg-[#F2EFE8]"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" /> 
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="tabular-nums text-[12px] font-semibold text-[#C9A96E]">
                · {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Crisp Full-Width Search Input */}
        <div className="max-w-6xl mx-auto w-full relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717A] pointer-events-none" />
          <input
            id="search-input-field"
            type="text"
            placeholder="Search names, skills, or cities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-10 bg-[#FFFFFF] border border-[#E8E4DB] rounded-full text-[14px] focus:outline-none focus:border-[#0D0D0F] text-[#0D0D0F] placeholder-[#71717A] transition shadow-2xs"
          />
          {searchQuery && (
            <button
              id="search-clear-btn"
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[#F2EFE8] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer"
              title="Clear search"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Single-Row Sort Segmented Control + Verified Toggle */}
        <div className="max-w-6xl mx-auto w-full flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5 p-1 rounded-xl bg-[#EFECE4] border border-[#E8E4DB] flex-1 sm:flex-initial min-w-0">
            {(
              [
                { id: "match", label: "Best Match" },
                { id: "rating", label: "Top Rated" },
                { id: "newest", label: "Newest" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSortBy(tab.id)}
                className={`flex-1 sm:flex-initial h-8 px-2.5 sm:px-3.5 rounded-lg text-[12px] whitespace-nowrap transition cursor-pointer flex items-center justify-center ${
                  sortBy === tab.id
                    ? "bg-[#FFFFFF] text-[#0D0D0F] font-semibold shadow-2xs"
                    : "text-[#71717A] font-medium hover:text-[#0D0D0F]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setFilterVerifiedOnly(!filterVerifiedOnly)}
            aria-pressed={filterVerifiedOnly}
            className={`h-[40px] px-3 rounded-xl border text-[12px] font-medium whitespace-nowrap transition cursor-pointer inline-flex items-center gap-1.5 shrink-0 ${
              filterVerifiedOnly
                ? "bg-[#0D0D0F] border-[#0D0D0F] text-[#F7F4EE] font-semibold"
                : "bg-[#FFFFFF] border-[#E8E4DB] text-[#52525B] hover:text-[#0D0D0F] hover:bg-[#FAF8F4]"
            }`}
          >
            <BadgeCheck className={`w-3.5 h-3.5 shrink-0 ${filterVerifiedOnly ? "text-[#C9A96E]" : "text-[#9A7A42]"}`} />
            <span>Verified</span>
          </button>
        </div>

        {/* Expandable Filter Panel */}
        {showFilters && (
          <div className="max-w-6xl mx-auto w-full p-4 bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl flex flex-col gap-3.5 animate-fade-in shadow-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Teaching Skill */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-[#52525B]">Offers skill</label>
                <input
                  type="text"
                  placeholder="e.g. Design Systems"
                  value={filterTeachSkill}
                  onChange={(e) => setFilterTeachSkill(e.target.value)}
                  className="w-full h-10 px-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[13px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                />
              </div>

              {/* Learning Skill */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-[#52525B]">Seeks skill</label>
                <input
                  type="text"
                  placeholder="e.g. TypeScript"
                  value={filterLearnSkill}
                  onChange={(e) => setFilterLearnSkill(e.target.value)}
                  className="w-full h-10 px-3 bg-[#F7F4EE] border border-[#E8E4DB] rounded-xl text-[13px] text-[#0D0D0F] placeholder:text-[#A1A1AA] focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] transition"
                />
              </div>

              {/* Country Selection (Full A-Z Searchable Modal) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-[#52525B]">Country</label>
                <div className="relative flex items-center">
                  <button
                    id="filter-country-trigger"
                    type="button"
                    onClick={() => setPickerMode("country")}
                    className={`w-full h-10 px-3 bg-[#F7F4EE] hover:bg-[#F2EFE8] border border-[#E8E4DB] rounded-xl text-[13px] flex items-center justify-between gap-1.5 cursor-pointer transition text-left ${
                      filterCountry ? "text-[#0D0D0F] font-medium" : "text-[#71717A]"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      {selectedCountryOption?.prefix && (
                        <span className="text-sm leading-none shrink-0">{selectedCountryOption.prefix}</span>
                      )}
                      <span className="truncate">{filterCountry || "All Countries"}</span>
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-[#71717A] shrink-0 ${filterCountry ? "mr-5" : ""}`} />
                  </button>
                  {filterCountry && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterCountry("");
                      }}
                      className="absolute right-2 w-5 h-5 rounded-full bg-[#E8E4DB] hover:bg-[#D8D2C5] flex items-center justify-center text-[#0D0D0F] cursor-pointer"
                      aria-label="Clear country filter"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Language Selection (Full A-Z Searchable Modal) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-[#52525B]">Language</label>
                <div className="relative flex items-center">
                  <button
                    id="filter-language-trigger"
                    type="button"
                    onClick={() => setPickerMode("language")}
                    className={`w-full h-10 px-3 bg-[#F7F4EE] hover:bg-[#F2EFE8] border border-[#E8E4DB] rounded-xl text-[13px] flex items-center justify-between gap-1.5 cursor-pointer transition text-left ${
                      filterLanguage ? "text-[#0D0D0F] font-medium" : "text-[#71717A]"
                    }`}
                  >
                    <span className="truncate">{filterLanguage || "All Languages"}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-[#71717A] shrink-0 ${filterLanguage ? "mr-5" : ""}`} />
                  </button>
                  {filterLanguage && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterLanguage("");
                      }}
                      className="absolute right-2 w-5 h-5 rounded-full bg-[#E8E4DB] hover:bg-[#D8D2C5] flex items-center justify-center text-[#0D0D0F] cursor-pointer"
                      aria-label="Clear language filter"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {activeFilterCount > 0 && (
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-[12px] text-[#52525B] hover:text-[#0D0D0F] font-medium transition cursor-pointer"
                >
                  Reset all filters
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Main Results Showcase Grid */}
      <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-4 w-full max-w-6xl mx-auto">
        <LoadingTransition isLoading={isLoading} type="search" count={4}>
          {searchError && processedUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-4 max-w-sm mx-auto">
              <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center mb-4 text-rose-600">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h3 className="text-[15px] font-semibold text-[#0D0D0F] mb-1">Couldn't load results</h3>
              <p className="text-[#71717A] text-[13px] leading-relaxed mb-4">
                {searchError}
              </p>
              <button
                type="button"
                onClick={retrySearch}
                className="h-10 px-4 rounded-xl bg-[#0D0D0F] text-[#F7F4EE] text-[13px] font-medium flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Try again</span>
              </button>
            </div>
          ) : processedUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-6 max-w-md mx-auto bg-[#FFFFFF] border border-[#E8E4DB] rounded-2xl mt-2">
              <div className="w-11 h-11 rounded-full bg-[#F7F4EE] flex items-center justify-center mb-3.5">
                <Search className="w-5 h-5 text-[#71717A]" strokeWidth={1.8} />
              </div>
              <h3 className="text-[15px] font-semibold text-[#0D0D0F] mb-1">
                {isSearchMode ? "No matching profiles" : "No profiles match your filters"}
              </h3>
              <p className="text-[#71717A] text-[13px] leading-relaxed mb-4">
                {isSearchMode 
                  ? `No one matched "${searchQuery.trim()}". Try searching a skill, name, or city.`
                  : "Try resetting active filters to see everyone in the network."}
              </p>
              {(activeFilterCount > 0 || isSearchMode) && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="h-10 px-4 rounded-xl bg-[#0D0D0F] text-[#F7F4EE] text-[13px] font-medium cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3.5 pb-12">
              {isSearching && (
                <div className="flex items-center gap-2 text-[12px] text-[#71717A]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A96E]" />
                  <span>Updating results...</span>
                </div>
              )}

              {/* Clean 2-Column Responsive Editorial Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {processedUsers.map((user, index) => {
                  const cardKey = user.uid || (user as any).id || `search-user-${user.username || index}`;
                  return (
                    <SearchUserCard
                      key={cardKey}
                      user={user}
                      me={me}
                      toggleFollow={toggleFollow}
                      onSelectUser={onSelectUser}
                      followingStates={followingStates}
                      setFollowingStates={setFollowingStates}
                      sortBy={sortBy}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </LoadingTransition>
      </main>

      {/* Full A-Z Searchable Country Picker Modal */}
      <SearchablePickerModal
        isOpen={pickerMode === "country"}
        onClose={() => setPickerMode(null)}
        title="Select Country"
        searchPlaceholder="Search country or code (e.g. India, US)..."
        options={countryOptions}
        selectedValue={filterCountry}
        allOptionLabel="All Countries"
        onSelectSingle={(opt) => setFilterCountry(opt ? opt.value : "")}
      />

      {/* Full A-Z Searchable Language Picker Modal */}
      <SearchablePickerModal
        isOpen={pickerMode === "language"}
        onClose={() => setPickerMode(null)}
        title="Select Language"
        searchPlaceholder="Search language A–Z (e.g. Hindi, Spanish)..."
        options={languageOptions}
        selectedValue={filterLanguage}
        allOptionLabel="All Languages"
        onSelectSingle={(opt) => setFilterLanguage(opt ? opt.value : "")}
      />
    </div>
  );
}

interface SearchUserCardProps {
  key?: React.Key;
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

  const [followLoading, setFollowLoading] = useState(false);

  const followingList = me?.followingList || [];
  const isFollowingLocal = followingStates[user.uid] !== undefined 
    ? followingStates[user.uid] 
    : followingList.includes(user.uid);

  const handleFollowClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (followLoading) return;
    setFollowLoading(true);
    setFollowingStates(prev => ({ ...prev, [user.uid]: !isFollowingLocal }));
    try {
      await toggleFollow(user.uid);
    } catch (err) {
      console.error("Follow toggling failed:", err);
      setFollowingStates(prev => ({ ...prev, [user.uid]: isFollowingLocal }));
    } finally {
      setFollowLoading(false);
    }
  };

  const hasRealRating = Boolean(
    user.rating && user.rating > 0 && (user.reviewCount || 0) > 0
  );
  const locationText = user.city ? (user.country ? `${user.city}, ${user.country}` : user.city) : (user.country || "");
  const metaLine = [user.username ? `@${user.username}` : "", locationText].filter(Boolean).join(" · ");

  const teaches = (user.skillsToTeach || []).filter(Boolean);
  const learns = (user.skillsToLearn || []).filter(Boolean);
  const primaryTeach = teaches[0];
  const extraTeachCount = Math.max(0, teaches.length - 1);
  const primaryLearn = learns[0];
  const extraLearnCount = Math.max(0, learns.length - 1);

  return (
    <article
      id={`search-user-row-${user.uid}`}
      onClick={() => onSelectUser(user.uid)}
      className="bg-[#FFFFFF] rounded-2xl border border-[#E8E4DB] hover:border-[#D8D2C5] p-4 sm:p-5 flex flex-col justify-between gap-3.5 cursor-pointer transition shadow-2xs group"
    >
      {/* Identity & Unboxed Rating Row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <SmartImage
            src={user.photoUrl || user.photoURL || DEFAULT_AVATAR}
            alt={user.fullName}
            fallbackType="profile"
            fullName={user.fullName}
            sizeType="thumbnail"
            className="w-12 h-12 rounded-full border border-[#E8E4DB] bg-[#F2EFE8] object-cover shrink-0"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 min-w-0">
              <h3 className="font-semibold text-[15px] text-[#0D0D0F] group-hover:text-[#9A7A42] transition-colors truncate leading-snug">
                {user.fullName}
              </h3>
              {isProfileVerified(user) && (
                <BadgeCheck className="w-4 h-4 text-[#C9A96E] shrink-0" />
              )}
            </div>

            {metaLine && (
              <p className="text-[12px] text-[#71717A] truncate mt-0.5">
                {metaLine}
              </p>
            )}
          </div>
        </div>

        {hasRealRating ? (
          <div className="flex items-center gap-1 text-[12px] font-semibold text-[#0D0D0F] shrink-0 tabular-nums pt-0.5">
            <Star className="w-3.5 h-3.5 fill-[#C9A96E] text-[#C9A96E]" />
            <span>{user.rating!.toFixed(1)}</span>
            <span className="text-[#71717A] font-normal">({user.reviewCount})</span>
          </div>
        ) : (user.sessionsCount || 0) > 0 ? (
          <span className="text-[12px] text-[#71717A] font-medium shrink-0 tabular-nums pt-0.5">
            {user.sessionsCount} {user.sessionsCount === 1 ? "swap" : "swaps"}
          </span>
        ) : null}
      </div>

      {/* Bio snippet */}
      {user.bio && (
        <p className="text-[13px] text-[#52525B] line-clamp-2 leading-relaxed font-normal">
          {user.bio}
        </p>
      )}

      {/* Clean Zero-Pill Exchange Strip */}
      {(primaryTeach || primaryLearn) && (
        <div className="rounded-xl bg-[#F7F4EE] px-3.5 py-2.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <div className="min-w-0">
            <span className="block text-[11px] font-medium text-[#71717A]">
              Teaches
            </span>
            <p className="text-[13px] font-semibold text-[#0D0D0F] truncate mt-0.5">
              {primaryTeach || "Open to share"}
              {extraTeachCount > 0 && (
                <span className="text-[#71717A] font-normal"> +{extraTeachCount}</span>
              )}
            </p>
          </div>

          <ArrowLeftRight className="w-3.5 h-3.5 text-[#C9A96E] shrink-0" />

          <div className="min-w-0 text-right">
            <span className="block text-[11px] font-medium text-[#71717A]">
              Learns
            </span>
            <p className="text-[13px] font-semibold text-[#0D0D0F] truncate mt-0.5">
              {primaryLearn || "Open"}
              {extraLearnCount > 0 && (
                <span className="text-[#71717A] font-normal"> +{extraLearnCount}</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Clear Hierarchy Action Footer */}
      <div className="flex items-center gap-2 pt-0.5 mt-auto">
        <button
          type="button"
          onClick={handleFollowClick}
          disabled={followLoading}
          className={`flex-1 h-10 px-4 rounded-xl text-[13px] font-semibold transition active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-60 ${
            isFollowingLocal
              ? "bg-[#F2EFE8] hover:bg-[#EAE5DA] text-[#0D0D0F] border border-[#E2DDD2]"
              : "bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] border border-[#0D0D0F]"
          }`}
        >
          {followLoading ? (
            <Loader2 className={`w-3.5 h-3.5 animate-spin ${isFollowingLocal ? "text-[#52525B]" : "text-[#F7F4EE]"}`} />
          ) : isFollowingLocal ? (
            <>
              <UserCheck className="w-3.5 h-3.5 text-[#52525B]" strokeWidth={2.1} />
              <span>Connected</span>
            </>
          ) : (
            <>
              <UserPlus className="w-3.5 h-3.5 text-[#F7F4EE]" strokeWidth={2.1} />
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
          className="h-10 px-4 rounded-xl text-[13px] font-semibold bg-[#FFFFFF] border border-[#E2DDD2] text-[#0D0D0F] hover:bg-[#FAF8F4] transition active:scale-[0.98] cursor-pointer flex items-center justify-center shrink-0 whitespace-nowrap"
        >
          Profile
        </button>
      </div>
    </article>
  );
}
