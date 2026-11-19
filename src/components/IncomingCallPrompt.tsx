import React, { useEffect, useRef } from "react";
import { Video, Phone, PhoneOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { SmartImage } from "./SmartImage";
import { DEFAULT_AVATAR } from "../types";
import { CallSignalingData, callSignalingService, logCallToConversation } from "../services/callSignalingService";
import { 
  startIncomingCallRingtone, 
  stopIncomingCallRingtone, 
  playCallEnded,
  triggerHapticFeedback 
} from "../utils/sound";

interface IncomingCallPromptProps {
  call: CallSignalingData | null;
  onAccept: (call: CallSignalingData) => void;
  onDecline: (call: CallSignalingData) => void;
  onCallerCancelled?: (call: CallSignalingData) => void;
}

export default function IncomingCallPrompt({
  call,
  onAccept,
  onDecline,
  onCallerCancelled,
}: IncomingCallPromptProps) {
  const hapticIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasDismissedRef = useRef<boolean>(false);
  const onDeclineRef = useRef(onDecline);
  onDeclineRef.current = onDecline;
  const onAcceptRef = useRef(onAccept);
  onAcceptRef.current = onAccept;
  const onCallerCancelledRef = useRef(onCallerCancelled);
  onCallerCancelledRef.current = onCallerCancelled;

  const callId = call?.id || (call as any)?.callId;
  const isVoiceCall = call?.callType === "audio";

  useEffect(() => {
    hasDismissedRef.current = false;
    if (!call || !callId) {
      stopIncomingCallRingtone();
      if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    if (callSignalingService.isCallTerminated(callId)) {
      stopIncomingCallRingtone();
      hasDismissedRef.current = true;
      (onCallerCancelledRef.current || onDeclineRef.current)(call);
      return;
    }

    console.log(`[TIMING] INCOMING_UI_SHOWN: (prompt mounted) callId=${callId} t=${Date.now()}`);
    console.log(`[IncomingCallPrompt] Initializing incoming call alert for: ${callId}`);

    // 1. Immediately notify caller that receiver's device is ringing
    callSignalingService.setCallRinging(callId);

    // 2. Play polyphonic ringtone
    startIncomingCallRingtone(callId);

    // 3. Periodic subtle haptic vibration pulse (every 2.4s)
    triggerHapticFeedback("pattern", [120, 80, 120]);
    hapticIntervalRef.current = setInterval(() => {
      triggerHapticFeedback("pattern", [120, 80, 120]);
    }, 2400);

    // 4. Listen to the call document for remote cancel
    const unsubscribe = callSignalingService.listenToCall(callId, (updated) => {
      if (hasDismissedRef.current) return;
      const st = (updated?.status || "") as string;
      if (!updated || st === "ended" || st === "rejected" || st === "cancelled" || st === "missed") {
        hasDismissedRef.current = true;
        console.log(`[IncomingCallPrompt] Call ${callId} was ended/cancelled remotely (status=${st || "missing"})`);
        callSignalingService.markCallTerminated(callId, call.sessionId);
        stopIncomingCallRingtone();
        if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (updated) {
          playCallEnded(`call_ended_${callId}`);
        }
        if (onCallerCancelledRef.current) {
          onCallerCancelledRef.current(call);
        } else {
          onDeclineRef.current(call);
        }
      }
    });

    // 5. Auto-timeout after 35 seconds of ringing
    timeoutRef.current = setTimeout(() => {
      if (hasDismissedRef.current) return;
      hasDismissedRef.current = true;
      console.log(`[IncomingCallPrompt] Call ${callId} timed out without answer`);
      callSignalingService.markCallTerminated(callId, call.sessionId);
      stopIncomingCallRingtone();
      if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
      callSignalingService.rejectCall(callId, "Missed call (timed out)", call.sessionId, call.callerId);
      if (call.conversationId) {
        logCallToConversation({
          conversationId: call.conversationId,
          callId: call.id,
          callType: call.callType || "video",
          status: "missed",
          callerId: call.callerId,
          callerName: call.callerName,
          receiverId: call.receiverId,
          receiverName: call.receiverName,
          currentUserId: call.receiverId,
        });
      }
      if (onCallerCancelledRef.current) {
        onCallerCancelledRef.current(call);
      } else {
        onDeclineRef.current(call);
      }
    }, 35000);

    return () => {
      stopIncomingCallRingtone();
      unsubscribe();
      if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [callId]);

  if (!call) return null;

  const handleAccept = () => {
    if (hasDismissedRef.current) return;
    hasDismissedRef.current = true;
    stopIncomingCallRingtone();
    if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    onAccept(call);
  };

  const handleDecline = () => {
    if (hasDismissedRef.current) return;
    hasDismissedRef.current = true;
    const targetId = call.id || (call as any).callId;
    if (targetId) {
      callSignalingService.markCallTerminated(targetId, call.sessionId);
    }
    stopIncomingCallRingtone();
    if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (targetId) {
      callSignalingService.rejectCall(targetId, "Declined by user", call.sessionId, call.callerId);
      playCallEnded(`call_ended_${targetId}`);
    }
    if (call.conversationId) {
      logCallToConversation({
        conversationId: call.conversationId,
        callId: call.id,
        callType: call.callType || "video",
        status: "declined",
        callerId: call.callerId,
        callerName: call.callerName,
        receiverId: call.receiverId,
        receiverName: call.receiverName,
        currentUserId: call.receiverId,
      });
    }
    onDecline(call);
  };

  return (
    <AnimatePresence>
      <div 
        id="swapskill-incoming-call-overlay"
        className="fixed inset-0 z-[100000] pointer-events-auto flex flex-col items-center justify-between p-6 pt-[calc(env(safe-area-inset-top,0px)+32px)] pb-[calc(env(safe-area-inset-bottom,0px)+40px)] bg-gradient-to-b from-[#0F0F12]/95 via-[#16161B]/95 to-[#0B0B0E]/98 backdrop-blur-xl select-none"
      >
        {/* Top Header: Voice/Video Call Label */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-1.5 text-center"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-medium text-emerald-400">
            {isVoiceCall ? <Phone size={14} className="animate-pulse" /> : <Video size={14} className="animate-pulse" />}
            <span>{isVoiceCall ? "Incoming Voice Call" : "Incoming Video Call"}</span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">SwapSkill Calling...</p>
        </motion.div>

        {/* Center: Caller Avatar with Subtle Breathing Light */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex flex-col items-center text-center my-auto relative"
        >
          {/* Animated concentric pulse rings */}
          <div className="absolute w-48 h-48 sm:w-56 sm:h-56 rounded-full border border-emerald-500/20 animate-ping pointer-events-none" style={{ animationDuration: "2.8s" }} />
          <div className="absolute w-40 h-40 sm:w-48 sm:h-48 rounded-full border border-emerald-500/25 animate-pulse pointer-events-none" style={{ animationDuration: "2s" }} />

          {/* Caller Photo */}
          <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-full overflow-hidden ring-4 ring-white/15 shadow-[0_16px_40px_rgba(0,0,0,0.8)] relative z-10 bg-zinc-900">
            <SmartImage
              src={call.callerPhoto || DEFAULT_AVATAR}
              alt={call.callerName}
              className="w-full h-full object-cover"
              fallbackType="profile"
              fullName={call.callerName}
            />
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold text-white mt-6 tracking-tight">
            {call.callerName || "Swap Partner"}
          </h2>
          {call.skillName && call.skillName !== "Chat Call" && (
            <p className="text-sm text-[#D4AF37] font-medium mt-1">
              {call.skillName}
            </p>
          )}
        </motion.div>

        {/* Bottom Actions: Premium Decline & Accept Buttons */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="w-full max-w-xs flex items-center justify-around gap-8"
        >
          {/* Decline Button */}
          <div className="flex flex-col items-center gap-2.5">
            <button
              id="decline-incoming-call-btn"
              type="button"
              onClick={handleDecline}
              className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white flex items-center justify-center shadow-lg shadow-rose-600/40 ring-4 ring-rose-500/20 cursor-pointer transition-transform active:scale-90"
              title="Decline"
              aria-label="Decline Call"
            >
              <PhoneOff size={24} />
            </button>
            <span className="text-xs font-medium text-zinc-400">Decline</span>
          </div>

          {/* Accept Button */}
          <div className="flex flex-col items-center gap-2.5">
            <button
              id="accept-incoming-call-btn"
              type="button"
              onClick={handleAccept}
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white flex items-center justify-center shadow-xl shadow-emerald-500/50 ring-4 ring-emerald-400/25 cursor-pointer transition-transform active:scale-90"
              title="Accept"
              aria-label="Accept Call"
            >
              {isVoiceCall ? <Phone size={24} /> : <Video size={24} />}
            </button>
            <span className="text-xs font-semibold text-emerald-400">Accept</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

