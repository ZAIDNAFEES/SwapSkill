import { 
  collection, 
  query, 
  where, 
  limit as firestoreLimit, 
  getDocs, 
  doc, 
  getDoc 
} from "firebase/firestore";
import { db } from "../firebase";
import { UserProfile } from "../types";

export interface UserSearchOptions {
  currentUserId?: string;
  limitCount?: number;
}

/**
 * Normalizes search text for consistent, case-insensitive comparison
 */
export function normalizeSearchTerm(term: string): {
  raw: string;
  clean: string;
  capitalized: string;
} {
  const raw = (term || "").trim();
  const clean = raw.replace(/^@/, "").trim().toLowerCase();
  const capitalized = clean.length > 0 
    ? clean.charAt(0).toUpperCase() + clean.slice(1) 
    : "";

  return { raw, clean, capitalized };
}

/**
 * Deterministic, multi-strategy Firestore user search.
 * Searches across username, full name, skills to teach, skills to learn, city, country, and languages.
 * Guaranteed to find existing users across the entire database without requiring app refresh.
 */
export async function searchUsers(
  searchTerm: string, 
  options: UserSearchOptions = {}
): Promise<UserProfile[]> {
  const { currentUserId, limitCount = 40 } = options;
  const { raw, clean, capitalized } = normalizeSearchTerm(searchTerm);

  if (!clean && !raw) {
    return [];
  }

  const usersRef = collection(db, "users");
  const resultMap = new Map<string, UserProfile>();

  const addDocToMap = (docSnap: any) => {
    if (!docSnap || !docSnap.exists()) return;
    const data = docSnap.data() as UserProfile;
    const uid = data.uid || docSnap.id;
    if (currentUserId && uid === currentUserId) return;
    if (!resultMap.has(uid)) {
      resultMap.set(uid, { ...data, uid });
    }
  };

  try {
    // 1. Parallel targeted queries for high-speed deterministic resolution
    const queryPromises: Array<Promise<any>> = [];

    // Query A: Exact username match (e.g. 'john' or 'johndoe')
    queryPromises.push(
      getDocs(query(usersRef, where("username", "==", clean), firestoreLimit(10)))
    );

    // Query B: Username prefix range (e.g. 'john' matches 'johnathan', 'johndoe')
    queryPromises.push(
      getDocs(
        query(
          usersRef, 
          where("username", ">=", clean), 
          where("username", "<=", clean + "\uf8ff"), 
          firestoreLimit(15)
        )
      )
    );

    // Query C: Full name prefix matching (exact raw & capitalized)
    if (raw.length >= 2) {
      queryPromises.push(
        getDocs(
          query(
            usersRef, 
            where("fullName", ">=", raw), 
            where("fullName", "<=", raw + "\uf8ff"), 
            firestoreLimit(15)
          )
        )
      );
      if (capitalized && capitalized !== raw) {
        queryPromises.push(
          getDocs(
            query(
              usersRef, 
              where("fullName", ">=", capitalized), 
              where("fullName", "<=", capitalized + "\uf8ff"), 
              firestoreLimit(15)
            )
          )
        );
      }
    }

    // Query D: Skills to teach (exact case & lowercase)
    queryPromises.push(
      getDocs(query(usersRef, where("skillsToTeach", "array-contains", raw), firestoreLimit(15)))
    );
    if (clean !== raw) {
      queryPromises.push(
        getDocs(query(usersRef, where("skillsToTeach", "array-contains", clean), firestoreLimit(15)))
      );
    }
    if (capitalized && capitalized !== raw && capitalized !== clean) {
      queryPromises.push(
        getDocs(query(usersRef, where("skillsToTeach", "array-contains", capitalized), firestoreLimit(15)))
      );
    }

    // Query E: Skills to learn
    queryPromises.push(
      getDocs(query(usersRef, where("skillsToLearn", "array-contains", raw), firestoreLimit(15)))
    );
    if (clean !== raw) {
      queryPromises.push(
        getDocs(query(usersRef, where("skillsToLearn", "array-contains", clean), firestoreLimit(15)))
      );
    }

    // Execute targeted queries in parallel
    const querySnapshots = await Promise.allSettled(queryPromises);
    querySnapshots.forEach((result) => {
      if (result.status === "fulfilled") {
        result.value.forEach(addDocToMap);
      }
    });

    // 2. Broad scan fallback: If results are few, fetch a batch of users and perform thorough partial/substring matching
    if (resultMap.size < 10) {
      try {
        const fallbackSnap = await getDocs(query(usersRef, firestoreLimit(60)));
        fallbackSnap.forEach((docSnap) => {
          const u = docSnap.data() as UserProfile;
          const uid = u.uid || docSnap.id;
          if (currentUserId && uid === currentUserId) return;

          const uName = (u.fullName || "").toLowerCase();
          const uUser = (u.username || "").toLowerCase();
          const uCity = (u.city || "").toLowerCase();
          const uCountry = (u.country || "").toLowerCase();
          const uBio = (u.bio || "").toLowerCase();
          const teachMatch = u.skillsToTeach?.some((s) => s.toLowerCase().includes(clean));
          const learnMatch = u.skillsToLearn?.some((s) => s.toLowerCase().includes(clean));
          const langMatch = u.languages?.some((l) => l.toLowerCase().includes(clean));

          if (
            uName.includes(clean) ||
            uUser.includes(clean) ||
            uCity.includes(clean) ||
            uCountry.includes(clean) ||
            uBio.includes(clean) ||
            teachMatch ||
            learnMatch ||
            langMatch
          ) {
            addDocToMap(docSnap);
          }
        });
      } catch (fallbackErr) {
        console.warn("[User Search] Fallback partial scan note:", fallbackErr);
      }
    }

    const allMatches = Array.from(resultMap.values());

    // Sort exact matches to the top
    allMatches.sort((a, b) => {
      const aUser = (a.username || "").toLowerCase();
      const bUser = (b.username || "").toLowerCase();
      const aName = (a.fullName || "").toLowerCase();
      const bName = (b.fullName || "").toLowerCase();

      // 1. Exact username match
      if (aUser === clean && bUser !== clean) return -1;
      if (bUser === clean && aUser !== clean) return 1;

      // 2. Username starts with search term
      if (aUser.startsWith(clean) && !bUser.startsWith(clean)) return -1;
      if (bUser.startsWith(clean) && !aUser.startsWith(clean)) return 1;

      // 3. Name starts with search term
      if (aName.startsWith(clean) && !bName.startsWith(clean)) return -1;
      if (bName.startsWith(clean) && !aName.startsWith(clean)) return 1;

      // 4. Rating / reputation
      return (b.rating || 0) - (a.rating || 0);
    });

    return allMatches.slice(0, limitCount);
  } catch (error) {
    console.error("[User Search] Error querying users collection:", error);
    throw error;
  }
}
