import { SocialLogin } from '@capgo/capacitor-social-login';
import { GoogleAuthProvider, signInWithCredential, signInWithPopup } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, googleProvider } from "../firebase";
import { safeLocalStorage } from "../utils/safeStorage";
import { DEFAULT_AVATAR } from "../types";

export interface NativeGoogleAuthResult {
  success: boolean;
  uid?: string;
  isNewUser?: boolean;
  error?: string;
  isCancelled?: boolean;
}

class GoogleAuthService {
  private initialized = false;

  /**
   * Detects whether the app is running in a native Capacitor environment (Android/iOS).
   */
  private isNativePlatform(): boolean {
    const isCapacitor = Boolean((window as any).Capacitor?.isNativePlatform?.());
    const platform = (window as any).Capacitor?.getPlatform?.() || "web";
    return isCapacitor && (platform === "android" || platform === "ios");
  }

  /**
   * Initializes the SocialLogin Google Auth plugin for native Android/iOS platforms.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      if (this.isNativePlatform()) {
        console.log("[GoogleAuthService] Initializing Native Capacitor SocialLogin plugin...");
        await SocialLogin.initialize({
          google: {
            webClientId: "101269763520-resmj9eqouol2ldhmainomj0p5lvvu4e.apps.googleusercontent.com",
            mode: "online",
          },
        });
        console.log("[GoogleAuthService] Native SocialLogin initialized successfully.");
      }
      this.initialized = true;
    } catch (e: any) {
      console.warn("[GoogleAuthService] Native SocialLogin init warning:", e);
      this.initialized = true;
    }
  }

  /**
   * Executes Google Sign-In with automatic platform detection.
   * - Native Android/iOS: Uses native Capacitor SocialLogin + Firebase signInWithCredential
   * - Web: Uses Firebase signInWithPopup
   */
  async signIn(): Promise<NativeGoogleAuthResult> {
    const isNative = this.isNativePlatform();
    console.log(`[GoogleAuthService] Starting Google Sign-In flow. Platform isNative: ${isNative}`);

    try {
      let userCredential;

      if (isNative) {
        // NATIVE ANDROID / IOS FLOW
        await this.initialize();
        console.log("[GoogleAuthService] Triggering native SocialLogin.login({ provider: 'google' })...");
        const loginResponse = await SocialLogin.login({
          provider: "google",
          options: {
            scopes: ["profile", "email"],
          },
        });

        if (!loginResponse || !loginResponse.result) {
          return { success: false, error: "Google sign-in returned no account details.", isCancelled: true };
        }

        const res = loginResponse.result as any;
        const idToken = res.idToken || res.authentication?.idToken || res.response?.id_token;
        const accessToken = res.accessToken?.token || res.accessToken || res.authentication?.accessToken;

        if (!idToken) {
          return {
            success: false,
            error: "Failed to obtain ID token from Google Sign-In. Please verify Google Play Services and SHA configuration."
          };
        }

        const credential = GoogleAuthProvider.credential(idToken, accessToken);
        userCredential = await signInWithCredential(auth, credential);
      } else {
        // WEB FLOW (Popup login)
        console.log("[GoogleAuthService] Triggering Web Firebase signInWithPopup...");
        userCredential = await signInWithPopup(auth, googleProvider);
      }

      const user = userCredential.user;
      console.log(`[GoogleAuthService] Firebase authentication successful for UID: ${user.uid}`);

      // Ensure user profile document exists/updated in Firestore
      let isNewUser = false;
      try {
        const userDocRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userDocRef);

        if (!userSnap.exists()) {
          isNewUser = true;
          const defaultUsername = (user.email?.split("@")[0] || "user").replace(/[^a-zA-Z0-9_]/g, "") + "_" + Math.floor(1000 + Math.random() * 9000);
          const newProfile = {
            uid: user.uid,
            email: user.email || "",
            fullName: user.displayName || user.email?.split("@")[0] || "SwapSkill User",
            username: defaultUsername,
            avatarUrl: user.photoURL || DEFAULT_AVATAR,
            bio: "Passionate about sharing skills and learning new abilities on SwapSkill.",
            city: "",
            country: "",
            skillsToTeach: [],
            skillsToLearn: [],
            rating: 5.0,
            reviewCount: 0,
            swapsCompleted: 0,
            isOnline: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            authProvider: "google"
          };
          await setDoc(userDocRef, newProfile);
          safeLocalStorage.setItem("swap_cache_user_profile", JSON.stringify(newProfile));
          console.log("[GoogleAuthService] Created missing Firestore user profile document.");
        } else {
          await setDoc(userDocRef, {
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            isOnline: true
          }, { merge: true });
          console.log("[GoogleAuthService] Updated existing Firestore user profile document.");
        }
      } catch (dbErr: any) {
        console.warn("[GoogleAuthService] Firestore user profile sync warning:", dbErr);
      }

      return {
        success: true,
        uid: user.uid,
        isNewUser
      };

    } catch (err: any) {
      // Print FULL native exception and stack to console for complete engineering transparency
      console.error("[GoogleAuthService] Full Unhandled Google Sign-In Exception:", {
        message: err?.message,
        code: err?.code,
        statusCode: err?.statusCode,
        status: err?.status,
        developerError: err?.code === "10" || err?.statusCode === 10 || err?.message?.includes("DEVELOPER_ERROR"),
        canceled: err?.code === "12501" || err?.statusCode === 12501 || err?.message?.includes("12501"),
        rawError: JSON.stringify(err, Object.getOwnPropertyNames(err)),
        stack: err?.stack,
        cause: err?.cause
      });

      const errorMessage = String(err?.message || err || "").toLowerCase();
      const errorCode = String(err?.code || err?.statusCode || "");

      // Handle user cancellation specifically
      if (
        errorMessage.includes("cancel") ||
        errorMessage.includes("dismiss") ||
        errorMessage.includes("closed") ||
        errorMessage.includes("popup-closed-by-user") ||
        errorMessage.includes("12501") ||
        errorCode === "12501" ||
        errorCode === "auth/popup-closed-by-user"
      ) {
        return {
          success: false,
          isCancelled: true,
          error: "Sign in was cancelled."
        };
      }

      // Return full detailed diagnostic error string containing code and message
      const detailedErrorString = `[Google Auth Error] ${err?.code || err?.statusCode ? `(Code ${err.code || err.statusCode}) ` : ""}${err?.message || String(err)}`;

      return {
        success: false,
        error: detailedErrorString
      };
    }
  }

  /**
   * Signs out from Google Auth natively if on native platform.
   */
  async signOut(): Promise<void> {
    try {
      if (this.isNativePlatform()) {
        await SocialLogin.logout({ provider: 'google' });
      }
    } catch (_) {}
  }
}

export const googleAuthService = new GoogleAuthService();
