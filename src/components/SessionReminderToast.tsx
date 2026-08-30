import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Video, Clock, X, Bell, Calendar, Sparkles, ChevronRight } from "lucide-react";
import { ActiveAlarmState } from "../services/sessionReminderService";

interface SessionAlarmReminderModalProps {
  alarm: ActiveAlarmState | null;
  onClose: () => void;
  onJoinSession: (session: any) => void;
}

export const SessionAlarmReminderModal: React.FC<SessionAlarmReminderModalProps> = ({
  alarm,
  onClose,
  onJoinSession,
}) => {
  if (!alarm) return null;

  const isLive = alarm.isLive;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: "spring", stiffness: 350, damping: 25 }}
          className="w-full max-w-sm bg-[#0D0D0F] text-[#F7F4EE] border border-[#C9A96E]/50 rounded-3xl p-5 sm:p-6 shadow-2xl relative overflow-hidden ring-1 ring-[#C9A96E]/30"
        >
          {/* Subtle Ambient Gold Glow */}
          <div className="absolute -top-16 -right-16 w-36 h-36 bg-[#C9A96E]/15 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-16 w-36 h-36 bg-[#C9A96E]/10 rounded-full blur-2xl pointer-events-none" />

          {/* Alarm Header Badge */}
          <div className="flex items-center justify-between gap-2 mb-4 relative z-10">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-2xl bg-[#C9A96E]/20 border border-[#C9A96E]/40 flex items-center justify-center text-[#C9A96E] shadow-xs">
                {isLive ? (
                  <Video className="w-4 h-4 animate-pulse text-[#C9A96E]" />
                ) : (
                  <Bell className="w-4 h-4 animate-bounce text-[#C9A96E]" />
                )}
              </div>
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#C9A96E] block">
                  {isLive ? "LIVE SESSION ALERT" : "SESSION ALARM"}
                </span>
                <span className="text-xs font-semibold text-white/90">
                  SwapSkill Reminder
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/15 text-zinc-400 hover:text-white flex items-center justify-center transition cursor-pointer"
              title="Dismiss"
              aria-label="Dismiss Alarm"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Core Content */}
          <div className="space-y-3.5 relative z-10">
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight leading-snug">
                {isLive
                  ? `Your session is Live Now!`
                  : `Your ${alarm.skillName} Skill Swap starts in ${alarm.minutesRemaining || 10} minutes.`}
              </h3>
              <p className="text-xs text-zinc-300 mt-1">
                With <strong className="text-white font-medium">{alarm.partnerName}</strong>
              </p>
            </div>

            {/* Session Metadata Card */}
            <div className="p-3 bg-[#1A1A1E] border border-white/10 rounded-2xl flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs text-zinc-200">
                <Calendar className="w-3.5 h-3.5 text-[#C9A96E] shrink-0" />
                <span className="font-medium text-[11px] text-[#F7F4EE]">{alarm.timeString}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1 border-t border-white/5">
                <span>Skill: <strong className="text-zinc-200">{alarm.skillName}</strong></span>
                <span>Duration: <strong className="text-zinc-200">{alarm.duration}m</strong></span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full sm:w-1/3 h-11 bg-white/10 hover:bg-white/15 active:bg-white/20 text-zinc-300 rounded-2xl text-xs font-semibold transition cursor-pointer flex items-center justify-center"
              >
                Dismiss
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onJoinSession(alarm.session);
                }}
                className="w-full sm:w-2/3 h-11 bg-[#C9A96E] hover:bg-[#B8965B] active:scale-98 text-[#0D0D0F] rounded-2xl text-xs font-bold transition shadow-lg shadow-[#C9A96E]/20 cursor-pointer flex items-center justify-center gap-2"
              >
                {isLive ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-[#0D0D0F] animate-ping" />
                    <Video className="w-3.5 h-3.5" />
                    <span>Join Live Swap</span>
                  </>
                ) : (
                  <>
                    <Video className="w-3.5 h-3.5" />
                    <span>Join Session</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

interface PermissionRequestModalProps {
  isOpen: boolean;
  onGrant: () => void;
  onDismiss: () => void;
}

export const NotificationPermissionExplainModal: React.FC<PermissionRequestModalProps> = ({
  isOpen,
  onGrant,
  onDismiss,
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-sm bg-[#FFFFFF] text-[#0D0D0F] border border-[#E8E4DB] rounded-3xl p-5 shadow-2xl relative"
        >
          <div className="w-10 h-10 rounded-2xl bg-[#C9A96E]/15 text-[#8C6D37] flex items-center justify-center mb-3">
            <Bell className="w-5 h-5" />
          </div>

          <h3 className="text-base font-bold text-[#0D0D0F]">Enable 10-Minute Session Reminders</h3>
          <p className="text-xs text-[#71717A] mt-1.5 leading-relaxed">
            SwapSkill uses local notifications to ring an alarm 10 minutes before your scheduled live swaps so you and your partner never miss a session.
          </p>

          <div className="flex gap-2 mt-4">
            <button
              onClick={onDismiss}
              className="flex-1 h-10 rounded-xl bg-[#F2EFE8] text-[#71717A] hover:text-[#0D0D0F] text-xs font-medium transition cursor-pointer"
            >
              Later
            </button>
            <button
              onClick={onGrant}
              className="flex-1 h-10 rounded-xl bg-[#0D0D0F] hover:bg-[#1A1A1D] text-[#F7F4EE] text-xs font-semibold transition cursor-pointer"
            >
              Allow Reminders
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

interface GlobalStartingSoonBannerProps {
  session: any | null;
  currentUserId: string;
  onJoinLive: (session: any) => void;
  onViewSession: (session: any) => void;
  onDismiss: (sessionId: string) => void;
}

export const GlobalStartingSoonBanner: React.FC<GlobalStartingSoonBannerProps> = ({
  session,
  currentUserId,
  onJoinLive,
  onViewSession,
  onDismiss,
}) => {
  if (!session) return null;

  const isTeacher = session.teacherId === currentUserId;
  const partnerName = isTeacher
    ? session.learnerName || session.studentName || "Swap Partner"
    : session.teacherName || "Swap Partner";
  const skillName = session.skillName || session.skill || "Skill Swap";

  const schedMs = session.scheduledTime?.seconds
    ? session.scheduledTime.seconds * 1000
    : session.scheduledTime?.toDate
    ? session.scheduledTime.toDate().getTime()
    : new Date(session.scheduledTime).getTime();

  const now = Date.now();
  const diffMs = schedMs - now;
  const diffMins = Math.floor(diffMs / 60000);
  const isLive = diffMins <= 0 || session.isLive === true;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="w-full bg-[#0D0D0F] text-[#F7F4EE] border-b border-[#C9A96E]/30 z-30 shrink-0 shadow-md"
    >
      <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
              isLive
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-[#C9A96E]/20 text-[#C9A96E]"
            }`}
          >
            {isLive ? (
              <Video className="w-3.5 h-3.5 animate-pulse" />
            ) : (
              <Clock className="w-3.5 h-3.5 animate-pulse" />
            )}
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0 ${
                isLive
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-[#C9A96E]/20 text-[#C9A96E]"
              }`}
            >
              {isLive ? "Live Now" : `Starts in ${diffMins}m`}
            </span>
            <span className="truncate text-zinc-300">
              <strong className="text-white font-medium">{partnerName}</strong> • {skillName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isLive ? (
            <button
              onClick={() => onJoinLive(session)}
              className="h-7 px-3 bg-[#C9A96E] hover:bg-[#B8965B] text-[#0D0D0F] rounded-lg font-semibold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs"
            >
              <Video className="w-3 h-3" />
              <span>Join Live</span>
            </button>
          ) : (
            <button
              onClick={() => onViewSession(session)}
              className="h-7 px-2.5 bg-white/10 hover:bg-white/15 text-zinc-200 rounded-lg font-medium text-xs flex items-center gap-1 transition cursor-pointer"
            >
              <span>View</span>
            </button>
          )}

          <button
            onClick={() => onDismiss(session.id)}
            className="w-6 h-6 rounded-md hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center transition cursor-pointer"
            title="Dismiss top banner"
            aria-label="Dismiss banner"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};
