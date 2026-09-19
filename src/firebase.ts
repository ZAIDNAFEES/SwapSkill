import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { 
  initializeFirestore, 
  getFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getDatabase } from "firebase/database";
import { safeLocalStorage } from "./utils/safeStorage";

// Dynamic Configuration Loader: localStorage -> environment variables -> workspace default
const getFirebaseConfig = () => {
  let saved = null;
  try {
    saved = safeLocalStorage.getItem("custom_firebase_config");
  } catch (_) {}
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Auto-correct casing if they have a saved config with the old lowercase typo
      if (parsed.apiKey === "AIzaSyBu-YUExO-0Qrk_01QOA5-ai8Lae3enIAM") {
        parsed.apiKey = "AIzaSyBu-YUExO-0QrK_01QOA5-ai8LAe3enIAM";
        try {
          safeLocalStorage.setItem("custom_firebase_config", JSON.stringify(parsed));
        } catch (_) {}
      }
      
      // Ensure saved databaseId is not an analytics measurement ID
      if (parsed.databaseId && (parsed.databaseId === "G-0GVRXE9V4Y" || parsed.databaseId.startsWith("G-"))) {
        parsed.databaseId = "(default)";
      }

      if (parsed.projectId && typeof parsed.projectId === "string") {
        const trimmed = parsed.projectId.trim();
        if (trimmed.startsWith("{")) {
          try {
            parsed.projectId = JSON.parse(trimmed).project_id || "swapskill-abbe1";
          } catch (_) {
            const m = trimmed.match(/"project_id"\s*:\s*"([^"]+)"/);
            parsed.projectId = m ? m[1] : "swapskill-abbe1";
          }
        }
      }

      if (parsed.apiKey && parsed.projectId) {
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse saved custom_firebase_config", e);
    }
  }

  // Ensure VITE_FIREBASE_DATABASE_ID from env is not incorrectly equal to measurement ID
  const envDatabaseId = (import.meta as any).env?.VITE_FIREBASE_DATABASE_ID;
  const filteredDatabaseId = (envDatabaseId && envDatabaseId !== "G-0GVRXE9V4Y" && !envDatabaseId.startsWith("G-"))
    ? envDatabaseId
    : "(default)";

  // Extract clean projectId if service account JSON or malformed string was provided
  const rawProjectId = (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID;
  let cleanProjectId = "swapskill-abbe1";
  if (rawProjectId && typeof rawProjectId === "string") {
    const trimmed = rawProjectId.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsedJson = JSON.parse(trimmed);
        cleanProjectId = parsedJson.project_id || cleanProjectId;
      } catch (_) {
        const match = trimmed.match(/"project_id"\s*:\s*"([^"]+)"/);
        if (match && match[1]) {
          cleanProjectId = match[1];
        }
      }
    } else if (!trimmed.includes("\n") && !trimmed.includes(" ") && !trimmed.includes("/")) {
      cleanProjectId = trimmed;
    }
  }

  return {
    apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY || "AIzaSyBu-YUExO-0QrK_01QOA5-ai8LAe3enIAM",
    authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN || "swapskill-abbe1.firebaseapp.com",
    projectId: cleanProjectId,
    storageBucket: (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET || "swapskill-abbe1.firebasestorage.app",
    messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "101269763520",
    appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID || "1:101269763520:web:d70306cc8eb9f467f48425",
    databaseId: filteredDatabaseId,
    measurementId: (import.meta as any).env?.VITE_FIREBASE_MEASUREMENT_ID || "G-0GVRXE9V4Y",
    databaseURL: (import.meta as any).env?.VITE_FIREBASE_DATABASE_URL || "https://swapskill-abbe1-default-rtdb.firebaseio.com"
  };
};

export const firebaseConfig = getFirebaseConfig();
console.log("Firebase Config:", firebaseConfig);
console.log("Database ID:", firebaseConfig.databaseId);
console.log("Measurement ID:", firebaseConfig.measurementId);

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Firestore with local persistent cache enabled and robust fallback for sandboxed environments
const getDbInstance = () => {
  const dbId = firebaseConfig.databaseId;
  try {
    const cacheSettings = {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    };

    if (dbId && dbId !== "(default)" && dbId !== "G-0GVRXE9V4Y" && !dbId.startsWith("G-")) {
      return initializeFirestore(app, cacheSettings, dbId);
    }
    return initializeFirestore(app, cacheSettings);
  } catch (e) {
    console.warn("Firestore persistentLocalCache not supported or failed to initialize (common in sandboxed iframes). Falling back to standard memory/standard client:", e);
    try {
      if (dbId && dbId !== "(default)" && dbId !== "G-0GVRXE9V4Y" && !dbId.startsWith("G-")) {
        return initializeFirestore(app, {}, dbId);
      }
    } catch (innerErr) {
      console.error("Fallback initializeFirestore with databaseId failed:", innerErr);
    }
    return getFirestore(app);
  }
};

export const db = getDbInstance();
// Initialize Storage
export const storage = getStorage(app);

// Initialize Auth
export const auth = getAuth(app);

// Initialize Realtime Database
export const rtdb = getDatabase(app);

// Auth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});

