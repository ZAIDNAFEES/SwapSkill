// Exported Sound & Haptics Feedback Utilities for SwapSkill
import { soundService, triggerHapticFeedback } from "../services/soundFeedbackService";

export { soundService, triggerHapticFeedback };
export type { SoundPreferences } from "../services/soundFeedbackService";

export const playNotificationSound = (dedupeKey?: string) => {
  soundService.playGenericNotification(dedupeKey);
};

export const playSessionReminder10Min = (dedupeKey?: string) => {
  soundService.playSessionReminder10Min(dedupeKey);
};

export const playSessionStarting = (dedupeKey?: string) => {
  soundService.playSessionStarting(dedupeKey);
};

export const startIncomingCallRingtone = (dedupeKey?: string) => {
  soundService.startIncomingCallRingtone(dedupeKey);
};

export const stopIncomingCallRingtone = () => {
  soundService.stopIncomingCallRingtone();
};

export const startOutgoingRingtone = () => {
  soundService.startOutgoingRingtone();
};

export const stopOutgoingRingtone = () => {
  soundService.stopOutgoingRingtone();
};

export const playSessionRequestReceived = (dedupeKey?: string) => {
  soundService.playSessionRequestReceived(dedupeKey);
};

export const playSessionAccepted = (dedupeKey?: string) => {
  soundService.playSessionAccepted(dedupeKey);
};

export const playNewChatMessage = (dedupeKey?: string) => {
  soundService.playNewChatMessage(dedupeKey);
};

export const playCallEnded = (dedupeKey?: string) => {
  soundService.playCallEnded(dedupeKey);
};
