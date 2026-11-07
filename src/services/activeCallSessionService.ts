import { WebRTCService } from "./webrtcService";
import { mobileForegroundService } from "./mobile/foregroundService";
import { mobileCallKitService } from "./mobile/callKitService";

export interface ActiveCallState {
  sessionId: string;
  callId: string;
  partnerName: string;
  partnerPhoto?: string;
  partnerUid?: string;
  skillName?: string;
  callType: "video" | "audio";
  isCaller: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  webrtcService: WebRTCService | null;
  callStage: "initiating" | "calling" | "ringing" | "connected" | "ended";
  isMuted: boolean;
  isVideoOff: boolean;
  startedAt: number;
}

/**
 * Singleton service that decouples WebRTC media tracks, peer connections, and signaling
 * from the React component tree lifecycle.
 * 
 * Active calls survive React component unmounts (e.g. backgrounding, tab switching, navigation).
 * Full destruction of media tracks and network sockets is ONLY performed on an explicit End Call.
 */
class ActiveCallSessionService {
  private activeSession: ActiveCallState | null = null;
  private hasExplicitlyEnded = false;
  private unmountDetached = false;
  private callEndedListeners = new Set<(reason: string) => void>();

  constructor() {
    mobileForegroundService.onCallEndedByNotification(() => {
      console.log("[ActiveCallSession] Ending call explicitly via Android notification action");
      this.endActiveCallExplicitly("Ended from Android notification");
    });
  }

  public getActiveSession(): ActiveCallState | null {
    if (this.hasExplicitlyEnded) return null;
    return this.activeSession;
  }

  public hasActiveCall(): boolean {
    return (
      !this.hasExplicitlyEnded &&
      this.activeSession !== null &&
      this.activeSession.callStage !== "ended"
    );
  }

  public registerSession(params: {
    sessionId: string;
    callId: string;
    partnerName: string;
    partnerPhoto?: string;
    partnerUid?: string;
    skillName?: string;
    callType: "video" | "audio";
    isCaller: boolean;
    localStream: MediaStream | null;
    webrtcService: WebRTCService | null;
  }): void {
    this.hasExplicitlyEnded = false;
    this.unmountDetached = false;
    this.activeSession = {
      sessionId: params.sessionId,
      callId: params.callId,
      partnerName: params.partnerName,
      partnerPhoto: params.partnerPhoto,
      partnerUid: params.partnerUid,
      skillName: params.skillName,
      callType: params.callType,
      isCaller: params.isCaller,
      localStream: params.localStream,
      remoteStream: null,
      webrtcService: params.webrtcService,
      callStage: "calling",
      isMuted: false,
      isVideoOff: false,
      startedAt: Date.now(),
    };

    console.log(`[ActiveCallSession] Registered call session for ${params.callId} (${params.sessionId})`);
    mobileForegroundService.setLifecycleState("ACTIVE_CALL_UI_VISIBLE");

    // START FOREGROUND SERVICE EARLY:
    // Protect microphone and camera immediately when the call begins/initiates,
    // before the peer connects or the app is backgrounded/locked.
    mobileForegroundService.startCallForegroundService({
      partnerName: params.partnerName,
      callType: params.callType,
      sessionId: params.sessionId,
      callId: params.callId,
    });
  }

  public updateLocalStream(stream: MediaStream | null): void {
    if (this.activeSession) {
      this.activeSession.localStream = stream;
    }
  }

  public updateRemoteStream(stream: MediaStream | null): void {
    if (this.activeSession) {
      this.activeSession.remoteStream = stream;
    }
  }

  public setCallStage(stage: ActiveCallState["callStage"]): void {
    if (this.activeSession) {
      this.activeSession.callStage = stage;
      if (stage === "connected") {
        this.notifyCallConnected();
      }
    }
  }

  /**
   * Invoked when call transitions to connected: starts native Android foreground service
   * and reports connected to CallKit
   */
  public async notifyCallConnected(): Promise<void> {
    if (!this.activeSession) return;
    const { partnerName, callType, sessionId, callId } = this.activeSession;

    // 1. Android Foreground Service (keeps mic, audio and sockets alive)
    await mobileForegroundService.startCallForegroundService({
      partnerName,
      callType,
      sessionId,
      callId,
    });

    // 2. iOS CallKit
    await mobileCallKitService.reportCallConnected(callId);
  }

  /**
   * Called when LiveSwapCallModal unmounts without an explicit end call.
   * Preserves streams and peer connection; only notes that UI detached.
   */
  public markModalDetached(): void {
    if (this.hasActiveCall()) {
      this.unmountDetached = true;
      console.log("[ActiveCallSession] LiveSwapCallModal detached/unmounted while call is active. Preserving media & WebRTC in background.");
    }
  }

  public isModalDetached(): boolean {
    return this.unmountDetached && this.hasActiveCall();
  }

  /**
   * EXPLICIT END CALL: This is the ONLY method that permanently shuts down
   * the WebRTC peer connection, stops microphone/camera media tracks,
   * stops the Android Foreground Service, and terminates CallKit.
   */
  public async endActiveCallExplicitly(reason: string = "User explicitly ended call"): Promise<void> {
    if (this.hasExplicitlyEnded && !this.activeSession) {
      return;
    }

    console.log(`[CALL_LIFECYCLE] WEBRTC_CLEANUP: Shutting down call media and services (${reason})`);
    mobileForegroundService.setLifecycleState("CALL_ENDED");
    this.hasExplicitlyEnded = true;
    this.unmountDetached = false;

    const session = this.activeSession;

    // 1. Stop Native Android Foreground Service
    console.log("[CALL_LIFECYCLE] FOREGROUND_SERVICE_STOP");
    await mobileForegroundService.stopCallForegroundService();

    // 2. End iOS CallKit Call
    if (session?.callId) {
      await mobileCallKitService.endCall(session.callId);
    }

    // 3. Stop all local audio and video tracks
    if (session?.localStream) {
      try {
        session.localStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (_) {}
        });
      } catch (e) {
        console.warn("[ActiveCallSession] Error stopping local tracks:", e);
      }
      session.localStream = null;
    }

    // 4. Stop remote tracks
    if (session?.remoteStream) {
      try {
        session.remoteStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (_) {}
        });
      } catch (e) {
        console.warn("[ActiveCallSession] Error stopping remote tracks:", e);
      }
      session.remoteStream = null;
    }

    // 5. Cleanup WebRTC peer connection
    if (session?.webrtcService) {
      try {
        session.webrtcService.cleanup();
      } catch (e) {
        console.warn("[ActiveCallSession] Error cleaning up WebRTC:", e);
      }
      session.webrtcService = null;
    }

    // 6. Notify registered listeners
    this.callEndedListeners.forEach((listener) => {
      try {
        listener(reason);
      } catch (_) {}
    });

    this.activeSession = null;
  }

  public addCallEndedListener(listener: (reason: string) => void): () => void {
    this.callEndedListeners.add(listener);
    return () => {
      this.callEndedListeners.delete(listener);
    };
  }
}

export const activeCallSessionService = new ActiveCallSessionService();
