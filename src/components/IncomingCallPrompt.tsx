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
}

export default function IncomingCallPrompt({
  call,
  onAccept,
  onDecline,
}: IncomingCallPromptProps) {
  const hapticIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onDeclineRef = useRef(onDecline);
  onDeclineRef.current = onDecline;
  const onAcceptRef = useRef(onAccept);
  onAcceptRef.current = onAccept;

  const callId = call?.id;
  const isVoiceCall = call?.callType === "audio";

  useEffect(() => {
    if (!call || !callId) {
      stopIncomingCallRingtone();
      if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

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
      if (!updated || updated.status === "ended" || updated.status === "rejected") {
        console.log(`[IncomingCallPrompt] Call ${callId} was ended/cancelled by caller`);
        stopIncomingCallRingtone();
        playCallEnded(`ended_${callId}`);
        onDeclineRef.current(call);
      }
    });

    // 5. Auto-timeout after 35 seconds of ringing
    timeoutRef.current = setTimeout(() => {
      console.log(`[IncomingCallPrompt] Call ${callId} timed out without answer`);
      stopIncomingCallRingtone();
      callSignalingService.rejectCall(callId, "Missed call (timed out)");
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
      onDeclineRef.current(call);
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
    stopIncomingCallRingtone();
    if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    onAccept(call);
  };

  const handleDecline = () => {
    stopIncomingCallRingtone();
    if (hapticIntervalRef.current) clearInterval(hapticIntervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    callSignalingService.rejectCall(call.id, "Declined by user");
    playCallEnded(`declined_${call.id}`);
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

        {/* Center: Caller Avatar with Harmonic Pulse Rings */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex flex-col items-center text-center my-auto relative"
        >
          {/* Animated concentric rings */}
          <div className="absolute w-44 h-44 rounded-full border border-emerald-500/20 animate-ping pointer-events-none" style={{ animationDuration: "2.4s" }} />
          <div className="absolute w-36 h-36 rounded-full border border-emerald-500/30 animate-pulse pointer-events-none" />

          {/* Caller Photo */}
          <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden border-3 border-emerald-400/80 shadow-[0_0_32px_rgba(16,185,129,0.3)] relative z-10 bg-zinc-900">
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

        {/* Bottom Actions: IMO-Style Decline & Accept Circle Buttons */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="w-full max-w-xs flex items-center justify-around gap-6"
        >
          {/* Decline Button */}
          <div className="flex flex-col items-center gap-2">
            <button
              id="decline-incoming-call-btn"
              type="button"
              onClick={handleDecline}
              className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 active:bg-red-700 text-white flex items-center justify-center shadow-lg shadow-red-600/40 cursor-pointer transition-transform active:scale-90"
              title="Decline"
              aria-label="Decline Call"
            >
              <PhoneOff size={26} />
            </button>
            <span className="text-xs font-medium text-zinc-300">Decline</span>
          </div>

          {/* Accept Button */}
          <div className="flex flex-col items-center gap-2">
            <button
              id="accept-incoming-call-btn"
              type="button"
              onClick={handleAccept}
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/50 cursor-pointer transition-transform active:scale-90 animate-bounce"
              style={{ animationDuration: "1.8s" }}
              title="Accept"
              aria-label="Accept Call"
            >
              {isVoiceCall ? <Phone size={26} /> : <Video size={26} />}
            </button>
            <span className="text-xs font-semibold text-emerald-400">Accept</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

