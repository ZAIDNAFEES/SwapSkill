/**
 * WebRTC Firestore Signaling Service
 * 
 * Handles real-time SDP Offer/Answer exchanges, ICE Candidate trickling,
 * call state synchronization, and connection lifecycle across Web and Android APK.
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Unsubscribe,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { getApiUrl } from "../utils/apiConfig";
import { stopIncomingCallRingtone } from "../utils/sound";
import { dispatchPushNotification } from "../utils/pushDispatch";

export type CallStatus =
  | "calling"
  | "accepting"
  | "ringing"
  | "connecting"
  | "connected"
  | "rejected"
  | "ended"
  | "busy"
  | "missed";

export type SessionLifecycleState =
  | "IDLE"
  | "CALLING"
  | "RINGING"
  | "CONNECTING"
  | "CONNECTED"
  | "ENDING"
  | "TERMINATED";

export interface CallSignalingData {
  id: string;
  sessionId: string;
  conversationId?: string;
  callerId: string;
  callerName: string;
  callerPhoto?: string;
  receiverId: string;
  receiverName: string;
  receiverPhoto?: string;
  status: CallStatus;
  callType: "video" | "audio";
  offer?: {
    type: "offer";
    sdp: string;
  };
  answer?: {
    type: "answer";
    sdp: string;
  };
  createdAt?: any;
  acceptedAt?: any;
  connectedAt?: any;
  endedAt?: any;
  endReason?: string;
  skillName?: string;
  durationSeconds?: number;
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
  createdAt: number;
}

/**
 * Returns a clean deterministic signaling call document ID for a Swap Session.
 */
export function getCallDocId(sessionId: string): string {
  const cleanId = (sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return `call_${cleanId}`;
}

/**
 * Generates a globally unique call ID for every new WebRTC call.
 * Avoids reusing deterministic session IDs to prevent stale SDP / ICE candidate collisions.
 */
export function generateUniqueCallId(prefix?: string): string {
  const cleanId = (prefix || "call").replace(/[^a-zA-Z0-9_-]/g, "");
  const randomSuffix = Math.random().toString(36).substring(2, 9);
  const perfNow = typeof performance !== "undefined" ? Math.floor(performance.now() * 1000) % 10000 : Math.floor(Math.random() * 10000);
  return `call_${cleanId}_${Date.now()}_${perfNow}_${randomSuffix}`;
}

/**
 * Generates a globally unique session ID for every new call attempt.
 * Never reuse a terminated sessionId across repeated calls.
 */
export function generateUniqueSessionId(prefix?: string): string {
  const cleanId = (prefix || "sess").replace(/[^a-zA-Z0-9_-]/g, "");
  const randomSuffix = Math.random().toString(36).substring(2, 9);
  const perfNow = typeof performance !== "undefined" ? Math.floor(performance.now() * 1000) % 10000 : Math.floor(Math.random() * 10000);
  return `sess_${cleanId}_${Date.now()}_${perfNow}_${randomSuffix}`;
}

export class CallSignalingService {
  private activeCallId: string | null = null;
  private activeSessionId: string | null = null;
  private inCallCount = 0;
  private handledCallIds = new Set<string>();
  private notifiedCallIds = new Set<string>();
  private endedCallIds = new Set<string>();
  private terminatedSessionIds = new Set<string>();
  private sessionLifecycleStates = new Map<string, SessionLifecycleState>();
  private activeCallListeners = new Map<string, Unsubscribe>();
  private handledFingerprints = new Set<string>();
  private activeIncomingUnsubscribe: Unsubscribe | null = null;
  private callParticipantCache = new Map<string, { callerId: string; receiverId: string }>();

  public getSessionState(sessionId: string): SessionLifecycleState {
    if (this.terminatedSessionIds.has(sessionId)) return "TERMINATED";
    return this.sessionLifecycleStates.get(sessionId) || "IDLE";
  }

  public setSessionState(sessionId: string, state: SessionLifecycleState): void {
    this.sessionLifecycleStates.set(sessionId, state);
    if (state === "TERMINATED") {
      this.terminatedSessionIds.add(sessionId);
    } else {
      this.terminatedSessionIds.delete(sessionId);
    }
  }

  public isSessionTerminated(sessionId?: string): boolean {
    if (!sessionId) return false;
    return this.terminatedSessionIds.has(sessionId);
  }

  public isCallTerminated(callId?: string): boolean {
    if (!callId) return false;
    return this.endedCallIds.has(callId);
  }

  public isCallOrSessionTerminated(callId?: string, sessionId?: string): boolean {
    if (callId && this.endedCallIds.has(callId)) return true;
    if (sessionId && this.terminatedSessionIds.has(sessionId)) return true;
    return false;
  }

  public terminateSession(sessionId: string, callId?: string, reason: string = "Session terminated"): void {
    console.log(`[Signaling] TERMINATE_SESSION: sessionId=${sessionId}, callId=${callId}, reason=${reason}`);
    this.terminatedSessionIds.add(sessionId);
    this.sessionLifecycleStates.set(sessionId, "TERMINATED");

    if (callId) {
      this.endedCallIds.add(callId);
      this.handledCallIds.add(callId);
      if (this.activeCallId === callId) {
        this.activeCallId = null;
      }
      const unsub = this.activeCallListeners.get(callId);
      if (unsub) {
        try { unsub(); } catch (_) {}
        this.activeCallListeners.delete(callId);
      }
    }

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    this.inCallCount = 0;
  }

  public registerActiveCall(sessionId?: string, callId?: string): void {
    this.inCallCount = 1;
    if (callId) {
      this.activeCallId = callId;
      this.handledCallIds.add(callId);
      this.endedCallIds.delete(callId);
    }
    if (sessionId) {
      this.activeSessionId = sessionId;
      this.terminatedSessionIds.delete(sessionId);
      this.sessionLifecycleStates.set(sessionId, "CALLING");
    }
    console.log(`[Signaling] Register active call: sessionId=${sessionId}, callId=${callId}`);
  }

  public unregisterActiveCall(sessionId?: string, callId?: string): void {
    this.inCallCount = 0;
    this.activeCallId = null;
    this.activeSessionId = null;
    if (callId) {
      this.endedCallIds.add(callId);
      this.handledCallIds.add(callId);
      const unsub = this.activeCallListeners.get(callId);
      if (unsub) {
        try { unsub(); } catch (_) {}
        this.activeCallListeners.delete(callId);
      }
    }
    if (sessionId) {
      this.terminatedSessionIds.add(sessionId);
      this.sessionLifecycleStates.set(sessionId, "TERMINATED");
    }
    console.log(`[Signaling] Unregister active call: cleared active call state`);
  }

  /**
   * Resets all per-call active locks, active IDs, and call-specific listeners.
   * Does NOT touch the global incoming call listener.
   */
  public resetCallState(): void {
    console.log("[Signaling] Resetting all per-call active state");
    this.activeCallId = null;
    this.activeSessionId = null;
    this.inCallCount = 0;
    this.activeCallListeners.forEach((unsub) => {
      try { unsub(); } catch (_) {}
    });
    this.activeCallListeners.clear();
    // Allow subsequent incoming calls to be processed cleanly
    this.handledFingerprints.clear();
    this.notifiedCallIds.clear();
  }

  public isUserInCall(): boolean {
    return this.activeCallId !== null || this.inCallCount > 0;
  }

  public getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  public getEventFingerprint(callData: { id?: string; sessionId?: string; callerId?: string; receiverId?: string }): string {
    const cId = callData.id || "";
    const sId = callData.sessionId || "";
    const from = callData.callerId || "";
    const to = callData.receiverId || "";
    return `${cId}::${sId}::${from}::${to}`;
  }

  public setActiveCallId(callId: string | null): void {
    this.activeCallId = callId;
    if (callId) {
      this.handledCallIds.add(callId);
      this.endedCallIds.delete(callId);
      this.inCallCount = 1;
    } else {
      this.inCallCount = 0;
    }
  }

  public getActiveCallId(): string | null {
    return this.activeCallId;
  }

  public hasActiveCall(): boolean {
    return this.activeCallId !== null || this.inCallCount > 0;
  }

  public markCallHandled(callId: string): void {
    this.handledCallIds.add(callId);
  }

  public isCallHandled(callId: string): boolean {
    return this.handledCallIds.has(callId) || this.endedCallIds.has(callId);
  }

  public clearActiveCall(callId?: string): void {
    this.activeCallId = null;
    this.activeSessionId = null;
    this.inCallCount = 0;
    if (callId) {
      this.endedCallIds.add(callId);
      this.handledCallIds.add(callId);
      const unsub = this.activeCallListeners.get(callId);
      if (unsub) {
        try { unsub(); } catch (_) {}
        this.activeCallListeners.delete(callId);
      }
    }
  }

  /**
   * Caller initiates the WebRTC call by writing the offer and metadata to Firestore.
   */
  public async initiateCall(params: {
    callId: string;
    sessionId: string;
    conversationId?: string;
    callerId: string;
    callerName: string;
    callerPhoto?: string;
    receiverId: string;
    receiverName: string;
    receiverPhoto?: string;
    callType?: "video" | "audio";
    skillName?: string;
    offer: { type: "offer"; sdp: string };
  }): Promise<void> {
    const {
      callId,
      sessionId,
      conversationId,
      callerId,
      callerName,
      callerPhoto = "",
      receiverId,
      receiverName,
      receiverPhoto = "",
      callType = "video",
      skillName = "",
      offer,
    } = params;

    this.setActiveCallId(callId);
    this.callParticipantCache.set(callId, { callerId, receiverId });
    const callDocRef = doc(db, "calls", callId);

    const callPayload: Record<string, any> = {
      id: callId,
      sessionId,
      callerId,
      callerName,
      callerPhoto,
      receiverId,
      receiverName,
      receiverPhoto,
      callType,
      skillName,
      status: "calling",
      offer: {
        type: offer.type,
        sdp: offer.sdp,
      },
      answer: null,
      createdAt: serverTimestamp(),
      acceptedAt: null,
      connectedAt: null,
      endedAt: null,
      endReason: null,
    };

    if (conversationId) {
      callPayload.conversationId = conversationId;
    }

    console.log(`[LIVE SWAP] CALL_CREATED: callId=${callId}`);
    console.log(`[LIVE SWAP] OFFER_SENT: callId=${callId}`);
    console.log(`[SIGNALING] OFFER_WRITTEN to calls/${callId}`);
    await setDoc(callDocRef, callPayload);

    // 1. Write incoming call directly to receiver's Firestore notifications collection
    // This delivers real-time call alert to receiver's device immediately via Firestore onSnapshot
    try {
      const notifRef = collection(db, "users", receiverId, "notifications");
      addDoc(notifRef, {
        type: "incoming_call",
        callId,
        sessionId: sessionId || "",
        conversationId: conversationId || "",
        callerId,
        callerName,
        callerPhoto: callerPhoto || "",
        callType: callType || "video",
        skillName: skillName || "",
        title: "Incoming SwapSkill Call",
        message: `${callerName} is calling (${callType === "audio" ? "Voice" : "Video"} Call)`,
        read: false,
        createdAt: new Date().toISOString(),
      }).catch((notifErr) => {
        console.warn("[Signaling] Non-fatal notification write error:", notifErr);
      });
    } catch (_) {}

    // 2. Dispatch background push notification to recipient device via backend/FCM
    try {
      let recipientPushToken = "";
      const recipientTokens: string[] = [];
      try {
        const userDocSnap = await getDoc(doc(db, "users", receiverId));
        if (userDocSnap.exists()) {
          const uData = userDocSnap.data();
          recipientPushToken = uData?.pushToken || (Array.isArray(uData?.fcmTokens) && uData.fcmTokens[0]) || "";
          if (uData?.pushToken) recipientTokens.push(uData.pushToken);
          if (Array.isArray(uData?.fcmTokens)) {
            recipientTokens.push(...uData.fcmTokens);
          }
        }
      } catch (_) {}

      dispatchPushNotification({
        recipientUserId: receiverId,
        pushToken: recipientPushToken || undefined,
        deviceTokens: Array.from(new Set(recipientTokens.filter(Boolean))),
        title: "Incoming SwapSkill Call",
        body: `${callerName} is calling (${
          callType === "audio" ? "Voice" : "Video"
        } Call)`,
        channelId: "swapskill_calls",
        priority: "high",
        sound: "default",
        data: {
          type: "incoming_call",
          callId,
          sessionId,
          conversationId: conversationId || "",
          callerId,
          callerName,
          callerPhoto: callerPhoto || "",
          callType: callType || "video",
          skillName: skillName || "",
          timestamp: String(Date.now()),
        },
      }).catch((err) => {
        console.warn("[Signaling] Non-fatal push dispatch error:", err);
      });
    } catch (_) {}
  }

  /**
   * Receiver acknowledges call and updates status to "ringing"
   */
  public async setCallRinging(callId: string): Promise<void> {
    if (this.endedCallIds.has(callId)) return;
    const callDocRef = doc(db, "calls", callId);
    try {
      await updateDoc(callDocRef, {
        status: "ringing",
      });
      console.log(`[Signaling] Call ${callId} status updated to ringing`);
    } catch (err) {
      console.warn(`[Signaling] Non-fatal error setting call ringing ${callId}:`, err);
    }
  }

  public isCallAccepted(callId: string): boolean {
    return this.activeCallId === callId;
  }

  public acceptCall(callId: string): Promise<void> {
    this.setActiveCallId(callId);
    this.markCallHandled(callId);
    this.endedCallIds.delete(callId);
    const callDocRef = doc(db, "calls", callId);
    try {
      console.log(`[Signaling] CALL_ACCEPTED - Callee accepted call ${callId}, setting status to accepting`);
      return updateDoc(callDocRef, {
        status: "accepting",
        acceptedAt: Date.now(),
      });
    } catch (err) {
      console.warn(`[Signaling] Non-fatal error marking call accepting for ${callId}:`, err);
      return Promise.resolve();
    }
  }

  /**
   * Callee accepts the call and writes the answer SDP to Firestore.
   */
  public async answerCall(callId: string, answer: { type: "answer"; sdp: string }): Promise<void> {
    const callDocRef = doc(db, "calls", callId);

    console.log(`[LIVE SWAP] ANSWER_SENT: callId=${callId}`);
    console.log(`[SIGNALING] ANSWER_WRITTEN to calls/${callId}`);
    await updateDoc(callDocRef, {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
      status: "connecting",
    });
  }

  /**
   * Reject an incoming call
   */
  public async rejectCall(callId: string, reason: string = "User declined the call", sessionId?: string): Promise<void> {
    const participants = this.callParticipantCache.get(callId);
    if (participants) {
      const currentUid = auth.currentUser?.uid;
      const otherUserId = currentUid === participants.callerId ? participants.receiverId : participants.callerId;
      if (otherUserId) {
        dispatchPushNotification({
          recipientUserId: otherUserId,
          title: "Call Declined",
          body: reason,
          channelId: "swapskill_calls",
          priority: "high",
          data: {
            type: "call_cancelled",
            callId,
            sessionId: sessionId || "",
            reason,
          },
        }).catch(() => {});
      }
    }
    this.endedCallIds.add(callId);
    this.handledCallIds.add(callId);
    this.clearActiveCall(callId);
    if (sessionId) {
      this.terminateSession(sessionId, callId, reason);
    }
    const callDocRef = doc(db, "calls", callId);
    try {
      console.log(`[Signaling] Rejecting call ${callId}: ${reason}`);
      await updateDoc(callDocRef, {
        status: "rejected",
        endedAt: serverTimestamp(),
        endReason: reason,
      });
    } catch (err) {
      console.warn(`[Signaling] Non-fatal error rejecting call ${callId}:`, err);
    }
  }

  /**
   * Mark call as connected once RTCPeerConnection is actually connected
   */
  public async markCallConnected(callId: string): Promise<void> {
    const callDocRef = doc(db, "calls", callId);
    try {
      console.log(`[LIVE SWAP] CALL_CONNECTED: callId=${callId}`);
      console.log(`[Signaling] PEER_CONNECTED - Marking calls/${callId} as connected`);
      await updateDoc(callDocRef, {
        status: "connected",
        connectedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn(`[Signaling] Non-fatal error updating call connected status for ${callId}:`, err);
    }
  }

  /**
   * End an active call and immediately invalidate its call ID
   */
  public async endCall(
    callId: string,
    reason: string = "Call ended by user",
    sessionId?: string,
    durationSeconds?: number
  ): Promise<void> {
    const participants = this.callParticipantCache.get(callId);
    if (participants) {
      const currentUid = auth.currentUser?.uid;
      const otherUserId = currentUid === participants.callerId ? participants.receiverId : participants.callerId;
      if (otherUserId) {
        try {
          const notifRef = collection(db, "users", otherUserId, "notifications");
          addDoc(notifRef, {
            type: "call_cancelled",
            callId,
            sessionId: sessionId || "",
            title: "Call Ended",
            message: "The call was cancelled or ended",
            read: true,
            createdAt: new Date().toISOString(),
          }).catch(() => {});

          dispatchPushNotification({
            recipientUserId: otherUserId,
            title: "Call Ended",
            body: "The call was cancelled or ended",
            channelId: "swapskill_calls",
            priority: "high",
            data: {
              type: "call_cancelled",
              callId,
              sessionId: sessionId || "",
            },
          }).catch(() => {});
        } catch (_) {}
      }
      this.callParticipantCache.delete(callId);
    }

    this.endedCallIds.add(callId);
    this.handledCallIds.add(callId);
    this.clearActiveCall(callId);
    if (sessionId) {
      this.terminateSession(sessionId, callId, reason);
    }
    const callDocRef = doc(db, "calls", callId);
    try {
      console.log(`[LIVE SWAP] CALL_ENDED: callId=${callId}, reason=${reason}`);
      console.log(`[Signaling] Ending call ${callId}: ${reason}, duration: ${durationSeconds}s`);
      const updateData: Record<string, any> = {
        status: "ended",
        endedAt: serverTimestamp(),
        endReason: reason,
      };
      if (typeof durationSeconds === "number") {
        updateData.durationSeconds = durationSeconds;
      }
      await updateDoc(callDocRef, updateData);
    } catch (err) {
      console.warn(`[Signaling] Non-fatal error ending call ${callId}:`, err);
    }
  }

  /**
   * Write ICE candidate from Caller
   */
  public async addCallerCandidate(callId: string, candidate: RTCIceCandidate): Promise<void> {
    if (!candidate || !candidate.candidate) return;
    if (this.isCallTerminated(callId)) return;

    try {
      const candidatesCol = collection(db, "calls", callId, "callerCandidates");
      const candPayload: IceCandidatePayload = {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid || null,
        sdpMLineIndex: typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null,
        usernameFragment: candidate.usernameFragment || null,
        createdAt: Date.now(),
      };
      await addDoc(candidatesCol, candPayload);
      console.log("[SIGNALING] CALLER_ICE_SENT");
    } catch (err) {
      console.warn("[Signaling] Failed to write caller candidate:", err);
    }
  }

  /**
   * Write ICE candidate from Callee
   */
  public async addCalleeCandidate(callId: string, candidate: RTCIceCandidate): Promise<void> {
    if (!candidate || !candidate.candidate) return;
    if (this.isCallTerminated(callId)) return;

    try {
      const candidatesCol = collection(db, "calls", callId, "calleeCandidates");
      const candPayload: IceCandidatePayload = {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid || null,
        sdpMLineIndex: typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null,
        usernameFragment: candidate.usernameFragment || null,
        createdAt: Date.now(),
      };
      await addDoc(candidatesCol, candPayload);
      console.log("[SIGNALING] CALLEE_ICE_SENT");
    } catch (err) {
      console.warn("[Signaling] Failed to write callee candidate:", err);
    }
  }

  /**
   * Subscribe to call document updates (Offer, Answer, Status changes)
   */
  public listenToCall(
    callId: string,
    onUpdate: (data: CallSignalingData | null) => void,
    onError?: (error: Error) => void
  ): Unsubscribe {
    // If call is already ended/terminated, don't attach new listener
    if (this.isCallTerminated(callId)) {
      console.log(`[Signaling] Skipping listenToCall for already-terminated call: ${callId}`);
      onUpdate(null);
      return () => {};
    }

    const callDocRef = doc(db, "calls", callId);

    const unsub = onSnapshot(
      callDocRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          onUpdate(null);
          return;
        }
        const data = snapshot.data() as CallSignalingData;
        if (data.status === "ended" || (data.status as any) === "cancelled") {
          this.endedCallIds.add(callId);
          if (data.sessionId) {
            this.terminateSession(data.sessionId, callId, data.endReason || "Call ended");
          }
        }
        onUpdate(data);
      },
      (err) => {
        console.error(`[Signaling] Error listening to calls/${callId}:`, err);
        onError?.(err);
      }
    );

    this.activeCallListeners.set(callId, unsub);
    return () => {
      if (this.activeCallListeners.get(callId) === unsub) {
        this.activeCallListeners.delete(callId);
      }
      unsub();
    };
  }

  /**
   * Subscribe to ICE candidates added by the Caller (used by Callee)
   */
  public listenToCallerCandidates(
    callId: string,
    onCandidate: (candidate: RTCIceCandidateInit) => void
  ): Unsubscribe {
    if (this.isCallTerminated(callId)) {
      return () => {};
    }

    const candidatesCol = collection(db, "calls", callId, "callerCandidates");
    const processedIds = new Set<string>();

    return onSnapshot(
      candidatesCol,
      (snapshot) => {
        if (this.isCallTerminated(callId)) return;
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            if (!processedIds.has(change.doc.id)) {
              processedIds.add(change.doc.id);
              const data = change.doc.data() as IceCandidatePayload;
              if (data && data.candidate) {
                console.log("[SIGNALING] CALLER_ICE_RECEIVED");
                onCandidate({
                  candidate: data.candidate,
                  sdpMid: data.sdpMid !== null && data.sdpMid !== undefined ? String(data.sdpMid) : undefined,
                  sdpMLineIndex: typeof data.sdpMLineIndex === "number" ? data.sdpMLineIndex : undefined,
                  usernameFragment: data.usernameFragment || undefined,
                });
              }
            }
          }
        });
      },
      (err) => {
        console.warn("[Signaling] Error listening to caller candidates:", err);
      }
    );
  }

  /**
   * Subscribe to ICE candidates added by the Callee (used by Caller)
   */
  public listenToCalleeCandidates(
    callId: string,
    onCandidate: (candidate: RTCIceCandidateInit) => void
  ): Unsubscribe {
    if (this.isCallTerminated(callId)) {
      return () => {};
    }

    const candidatesCol = collection(db, "calls", callId, "calleeCandidates");
    const processedIds = new Set<string>();

    return onSnapshot(
      candidatesCol,
      (snapshot) => {
        if (this.isCallTerminated(callId)) return;
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            if (!processedIds.has(change.doc.id)) {
              processedIds.add(change.doc.id);
              const data = change.doc.data() as IceCandidatePayload;
              if (data && data.candidate) {
                console.log("[SIGNALING] CALLEE_ICE_RECEIVED");
                onCandidate({
                  candidate: data.candidate,
                  sdpMid: data.sdpMid !== null && data.sdpMid !== undefined ? String(data.sdpMid) : undefined,
                  sdpMLineIndex: typeof data.sdpMLineIndex === "number" ? data.sdpMLineIndex : undefined,
                  usernameFragment: data.usernameFragment || undefined,
                });
              }
            }
          }
        });
      },
      (err) => {
        console.warn(`[Signaling] Error listening to callee candidates on ${callId}:`, err);
      }
    );
  }

  /**
   * Fetch current call document once
   */
  public async getCall(callId: string): Promise<CallSignalingData | null> {
    try {
      const callDocRef = doc(db, "calls", callId);
      const snap = await getDoc(callDocRef);
      if (!snap.exists()) return null;
      return snap.data() as CallSignalingData;
    } catch (err) {
      console.warn(`[Signaling] Error getting call ${callId}:`, err);
      return null;
    }
  }

  /**
   * Listen for real-time incoming calls where receiverId === currentUserId and status === "calling"
   */
  public listenToIncomingCalls(
    currentUserId: string,
    onIncomingCall: (callData: CallSignalingData) => void,
    onError?: (error: Error) => void,
    onCallCancelled?: (callId: string) => void
  ): Unsubscribe {
    // Unsubscribe previous incoming listener to prevent duplicate listeners
    if (this.activeIncomingUnsubscribe) {
      console.log(`[Signaling] Unsubscribing previous incoming listener for user: ${currentUserId}`);
      this.activeIncomingUnsubscribe();
      this.activeIncomingUnsubscribe = null;
    }

    const callsCol = collection(db, "calls");
    // Single-field equality filter: Never requires a composite index in Firestore!
    const qIncoming = query(
      callsCol,
      where("receiverId", "==", currentUserId)
    );

    const unsubscribe = onSnapshot(
      qIncoming,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "removed") {
            const removedCallId = change.doc.id;
            // CRITICAL: If this call is currently active or being answered by this device, DO NOT cancel or terminate!
            if (this.activeCallId === removedCallId || this.isCallAccepted(removedCallId)) {
              console.log(`[Signaling] Call ${removedCallId} transitioned out of incoming state (now active/accepted). Retaining.`);
              return;
            }

            console.log(`[Signaling] Incoming call removed/cancelled by caller before answer: ${removedCallId}`);
            stopIncomingCallRingtone();
            onCallCancelled?.(removedCallId);
            return;
          }

          if (change.type === "added" || change.type === "modified") {
            const data = { ...change.doc.data(), id: change.doc.id } as CallSignalingData;
            const callId = data.id || (data as any).callId;
            if (!callId) return;

            // 0. RACE PROTECTION: Only drop if this SPECIFIC callId has already been ended
            if (this.isCallTerminated(callId)) {
              return;
            }

            const fingerprint = this.getEventFingerprint(data);

            // 1. Ignore if current user is caller (must never notify caller of own call)
            if (data.callerId === currentUserId) {
              return;
            }

            // 2. Ignore if receiver is not current user
            if (data.receiverId !== currentUserId) {
              return;
            }

            if (data.callerId && data.receiverId) {
              this.callParticipantCache.set(callId, { callerId: data.callerId, receiverId: data.receiverId });
            }

            // 3. Ignore non-calling and non-ringing status
            if (data.status !== "calling" && data.status !== "ringing") {
              if (data.status === "ended" || (data.status as any) === "cancelled" || data.status === "rejected") {
                if (this.activeCallId !== callId) {
                  this.endedCallIds.add(callId);
                }
              }
              return;
            }

            // 4. Ignore already ended, accepted, or notified calls / fingerprints
            if (
              this.endedCallIds.has(callId) ||
              this.notifiedCallIds.has(callId) ||
              this.activeCallId === callId ||
              this.handledFingerprints.has(fingerprint)
            ) {
              return;
            }

            // 5. Stale / Expired Call Filter:
            // Allow 180 seconds to tolerate network latency or mobile device clock discrepancies
            let createdMs = 0;
            if (data.createdAt?.toMillis) {
              createdMs = data.createdAt.toMillis();
            } else if (data.createdAt?.seconds) {
              createdMs = data.createdAt.seconds * 1000;
            } else if (typeof data.createdAt === "number") {
              createdMs = data.createdAt;
            }

            const now = Date.now();
            if (createdMs > 0 && now - createdMs > 180000) {
              console.log(`[Signaling] Skipping stale incoming call: ${callId} (created ${(now - createdMs) / 1000}s ago)`);
              this.endedCallIds.add(callId);
              this.markCallHandled(callId);
              this.handledFingerprints.add(fingerprint);
              return;
            }

            // 6. User is already in an active call / session:
            if (this.isUserInCall() && this.activeCallId !== callId) {
              console.log(`[Signaling] Suppressing incoming call ${callId}: User is already in an active call`);
              this.markCallHandled(callId);
              this.handledFingerprints.add(fingerprint);
              return;
            }

            // 7. Genuinely new incoming call:
            this.handledFingerprints.add(fingerprint);
            this.notifiedCallIds.add(callId);
            this.markCallHandled(callId);
            console.log(`[Signaling] INCOMING_CALL_RECEIVED for user ${currentUserId} callId=${callId} (caller=${data.callerName})`);
            onIncomingCall(data);
          }
        });
      },
      (err) => {
        console.warn(`[Signaling] Error listening for incoming calls:`, err);
        onError?.(err);
      }
    );

    this.activeIncomingUnsubscribe = unsubscribe;
    return () => {
      if (this.activeIncomingUnsubscribe === unsubscribe) {
        this.activeIncomingUnsubscribe = null;
      }
      unsubscribe();
    };
  }
}

export const callSignalingService = new CallSignalingService();

export interface LogCallParams {
  conversationId: string;
  callId: string;
  callType: "video" | "audio";
  status: "completed" | "missed" | "declined" | "failed";
  durationSeconds?: number;
  callerId: string;
  callerName?: string;
  receiverId: string;
  receiverName?: string;
  currentUserId: string;
}

export async function logCallToConversation(params: LogCallParams): Promise<void> {
  const {
    conversationId,
    callId,
    callType,
    status,
    durationSeconds = 0,
    callerId,
    callerName,
    receiverId,
    receiverName,
    currentUserId,
  } = params;

  if (!conversationId || !callId) return;

  let text = "";
  const typeLabel = callType === "video" ? "Video call" : "Voice call";

  if (status === "completed") {
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    const formattedDuration = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    text = `${typeLabel} · ${formattedDuration}`;
  } else if (status === "declined") {
    text = "Call declined";
  } else if (status === "missed") {
    text = callType === "video" ? "Missed video call" : "Missed voice call";
  } else {
    text = "Unable to connect";
  }

  const callDocMsgId = `call_${callId}`;

  try {
    const isLegacy = conversationId.startsWith("legacy_");
    const collectionName = isLegacy ? "chats" : "conversations";
    const msgRef = doc(db, collectionName, conversationId, "messages", callDocMsgId);

    const sender = currentUserId || callerId;
    const now = serverTimestamp();

    await setDoc(
      msgRef,
      {
        id: callDocMsgId,
        senderId: sender,
        text,
        createdAt: now,
        timestamp: now,
        type: "call_log",
        status: "delivered",
        callData: {
          callId,
          callType,
          status,
          durationSeconds: status === "completed" ? durationSeconds : 0,
          callerId,
          callerName: callerName || "Member",
          receiverId,
          receiverName: receiverName || "Member",
        },
      },
      { merge: true }
    );

    const convRef = doc(db, collectionName, conversationId);
    await updateDoc(convRef, {
      lastMessage: text,
      lastMessageSenderId: sender,
      lastMessageTime: now,
      lastMessageAt: now,
      updatedAt: now,
    }).catch(() => {});

    console.log(`[Signaling] Call logged to conversation "${conversationId}": ${text}`);
  } catch (err) {
    console.warn(`[Signaling] Non-fatal error logging call to conversation:`, err);
  }
}

