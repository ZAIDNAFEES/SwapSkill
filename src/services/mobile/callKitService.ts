import { Capacitor, registerPlugin } from "@capacitor/core";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";

export interface CallKitPluginInterface {
  getVoipToken(): Promise<{ voipToken: string }>;
  endCall(options: { callId?: string }): Promise<{ ended: boolean }>;
  reportConnected(options: { callId?: string }): Promise<{ connected: boolean }>;
  getPendingCallAction(): Promise<{ hasAction: boolean; action: string; callId: string }>;
  clearPendingCallAction(): Promise<{ cleared: boolean }>;
  addListener(eventName: "callAnswered", listenerFunc: (data: { callId: string }) => void): Promise<any>;
  addListener(eventName: "callDeclined", listenerFunc: (data: { callId: string }) => void): Promise<any>;
  addListener(eventName: "voipTokenUpdated", listenerFunc: (data: { voipToken: string }) => void): Promise<any>;
}

const CallKitPlugin = registerPlugin<CallKitPluginInterface>("CallKitPlugin");

class MobileCallKitService {
  private currentVoipToken: string | null = null;

  public isSupported(): boolean {
    return Capacitor.getPlatform() === "ios";
  }

  /**
   * Retrieves any pending CallKit action (e.g. if user pressed Answer or Decline while app was closed)
   */
  public async getPendingCallAction(): Promise<{ hasAction: boolean; action: string; callId: string }> {
    if (!this.isSupported()) return { hasAction: false, action: "", callId: "" };
    try {
      return await CallKitPlugin.getPendingCallAction();
    } catch (e) {
      console.warn("[CallKitService] Error checking pending call action:", e);
      return { hasAction: false, action: "", callId: "" };
    }
  }

  /**
   * Clears any stored pending CallKit action
   */
  public async clearPendingCallAction(): Promise<void> {
    if (!this.isSupported()) return;
    try {
      await CallKitPlugin.clearPendingCallAction();
    } catch {}
  }

  /**
   * Register listener when user taps Answer on native CallKit UI
   */
  public onCallAnswered(callback: (data: { callId: string }) => void): () => void {
    if (!this.isSupported()) return () => {};
    let sub: any = null;
    try {
      sub = CallKitPlugin.addListener("callAnswered", callback);
    } catch (e) {
      console.warn("[CallKitService] Could not add callAnswered listener:", e);
    }
    return () => {
      sub?.then?.((s: any) => s.remove?.());
    };
  }

  /**
   * Register listener when user taps Decline on native CallKit UI
   */
  public onCallDeclined(callback: (data: { callId: string }) => void): () => void {
    if (!this.isSupported()) return () => {};
    let sub: any = null;
    try {
      sub = CallKitPlugin.addListener("callDeclined", callback);
    } catch (e) {
      console.warn("[CallKitService] Could not add callDeclined listener:", e);
    }
    return () => {
      sub?.then?.((s: any) => s.remove?.());
    };
  }

  /**
   * Fetches the native PushKit VoIP token if running on iOS
   */
  public async getVoipToken(): Promise<string | null> {
    if (!this.isSupported()) return null;
    try {
      const res = await CallKitPlugin.getVoipToken();
      if (res?.voipToken && res.voipToken.length > 0) {
        this.currentVoipToken = res.voipToken;
        return res.voipToken;
      }
    } catch (e) {
      console.warn("[CallKitService] Error fetching VoIP token:", e);
    }
    return null;
  }

  /**
   * Synchronizes the native iOS PushKit VoIP device token to Firestore
   * so closed-app incoming calls trigger CallKit directly via APNs VoIP.
   * Also listens for token updates/refreshes from PKPushRegistry.
   */
  public async syncVoipTokenToFirestore(userId: string): Promise<void> {
    if (!this.isSupported() || !userId) return;

    const saveToken = async (token: string) => {
      if (!token) return;
      this.currentVoipToken = token;
      const cacheKey = `voip_token_synced_${userId}_${token}`;
      if (localStorage.getItem(cacheKey) === "true") {
        return;
      }
      try {
        const userDocRef = doc(db, "users", userId);
        await updateDoc(userDocRef, {
          voipToken: token,
          voipPlatform: "ios",
          lastVoipTokenUpdate: serverTimestamp(),
        });
        localStorage.setItem(cacheKey, "true");
        console.log("[CallKitService] iOS VoIP push token synced to Firestore");
      } catch (err) {
        console.warn("[CallKitService] Failed to sync VoIP token to Firestore:", err);
      }
    };

    try {
      const initialToken = await this.getVoipToken();
      if (initialToken) {
        await saveToken(initialToken);
      }

      // Listen for token refresh/issuance after launch
      CallKitPlugin.addListener("voipTokenUpdated", (data) => {
        if (data?.voipToken) {
          console.log("[CallKitService] PushKit VoIP token refreshed:", data.voipToken.substring(0, 10) + "...");
          saveToken(data.voipToken);
        }
      });
    } catch (err) {
      console.warn("[CallKitService] Error setting up VoIP token sync:", err);
    }
  }

  /**
   * Reports that the call is connected to dismiss CallKit connecting screen
   */
  public async reportCallConnected(callId?: string): Promise<void> {
    if (!this.isSupported()) return;
    try {
      await CallKitPlugin.reportConnected({ callId });
    } catch (e) {
      console.warn("[CallKitService] Failed to report call connected:", e);
    }
  }

  /**
   * Dismisses the native CallKit call UI when user ends or hangs up a call from the web UI
   */
  public async endCall(callId?: string): Promise<void> {
    if (!this.isSupported()) return;
    try {
      await CallKitPlugin.endCall({ callId });
    } catch (e) {
      console.warn("[CallKitService] Failed to end CallKit call:", e);
    }
  }
}

export const mobileCallKitService = new MobileCallKitService();
