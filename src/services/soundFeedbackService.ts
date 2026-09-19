// Comprehensive Sound, Ringtone & Haptic Feedback Engine for SwapSkill
// Built using Web Audio API synthesis for zero latency, zero external asset dependencies, 
// and 100% offline reliability on Web and Native Mobile (Capacitor Android & iOS).

import { safeLocalStorage } from "../utils/safeStorage";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { App as CapApp } from "@capacitor/app";

export interface SoundPreferences {
  notificationSounds: boolean;     // General notification chimes
  callRingtone: boolean;           // Live Swap incoming call ringtone
  chatSounds: boolean;             // New incoming chat message sound
  sessionReminderSounds: boolean;  // 10-min & starting session reminders
  vibrationFeedback: boolean;      // Haptic / vibration feedback
}

export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = {
  notificationSounds: true,
  callRingtone: true,
  chatSounds: true,
  sessionReminderSounds: true,
  vibrationFeedback: true,
};

const STORAGE_KEY = "swap_sound_preferences";

// In-memory audio context instance (lazy initialized on first user interaction)
let sharedAudioCtx: AudioContext | null = null;

// Track whether the app is currently in foreground on mobile
let isAppInForeground = true;
if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
  try {
    CapApp.getState().then((state) => {
      isAppInForeground = state.isActive;
    }).catch(() => {});
    CapApp.addListener("appStateChange", (state) => {
      isAppInForeground = state.isActive;
    });
  } catch (_) {}
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  // If native mobile app is in background, suppress foreground Web Audio playback
  // Native notification channels handle audio/vibration in background respecting DND/Silent
  if (Capacitor.isNativePlatform() && !isAppInForeground) {
    return null;
  }
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch (err) {
    console.warn("[SoundService] Failed to initialize AudioContext:", err);
    return null;
  }
}

// Sound Deduplication and Rate-limiting Cache
const playedDeduplicationMap = new Map<string, number>();
const THROTTLE_MS = 600;
const DEDUPE_WINDOW_MS = 8000;

function isDuplicate(key?: string): boolean {
  if (!key) return false;
  const now = Date.now();
  const lastTime = playedDeduplicationMap.get(key);
  if (lastTime && now - lastTime < DEDUPE_WINDOW_MS) {
    return true;
  }
  playedDeduplicationMap.set(key, now);
  
  // Cleanup old entries
  if (playedDeduplicationMap.size > 200) {
    playedDeduplicationMap.forEach((time, k) => {
      if (now - time > 30000) playedDeduplicationMap.delete(k);
    });
  }
  return false;
}

/**
 * Universal Haptic / Vibration trigger
 */
export async function triggerHapticFeedback(type: "light" | "medium" | "heavy" | "success" | "warning" | "error" | "pattern", pattern: number[] = [40]) {
  const prefs = soundService.getPreferences();
  if (!prefs.vibrationFeedback) return;

  try {
    if (Capacitor.isNativePlatform()) {
      if (type === "success") {
        await Haptics.notification({ type: NotificationType.Success });
      } else if (type === "warning") {
        await Haptics.notification({ type: NotificationType.Warning });
      } else if (type === "error") {
        await Haptics.notification({ type: NotificationType.Error });
      } else if (type === "heavy") {
        await Haptics.impact({ style: ImpactStyle.Heavy });
      } else if (type === "medium") {
        await Haptics.impact({ style: ImpactStyle.Medium });
      } else if (type === "light") {
        await Haptics.impact({ style: ImpactStyle.Light });
      } else {
        await Haptics.vibrate({ duration: pattern[0] || 50 });
      }
      return;
    }

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch (_) {
    // Graceful fallback if haptics are disabled or unsupported
  }
}

class SoundFeedbackService {
  private preferences: SoundPreferences = { ...DEFAULT_SOUND_PREFERENCES };
  private ringtoneInterval: NodeJS.Timeout | null = null;
  private ringtoneTimeout: NodeJS.Timeout | null = null;
  private isRingtonePlaying = false;
  private outgoingToneInterval: NodeJS.Timeout | null = null;
  private isOutgoingTonePlaying = false;
  private lastPlayedTimeByType: Record<string, number> = {};
  private lastGlobalSoundTime = 0;

  constructor() {
    this.loadPreferences();
  }

  public loadPreferences(): SoundPreferences {
    try {
      const stored = safeLocalStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.preferences = { ...DEFAULT_SOUND_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch (_) {
      this.preferences = { ...DEFAULT_SOUND_PREFERENCES };
    }
    return this.preferences;
  }

  public getPreferences(): SoundPreferences {
    return { ...this.preferences };
  }

  public updatePreferences(partial: Partial<SoundPreferences>): SoundPreferences {
    this.preferences = { ...this.preferences, ...partial };
    try {
      safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
    } catch (_) {}
    return { ...this.preferences };
  }

  private canPlay(soundType: keyof SoundPreferences, dedupeKey?: string): boolean {
    if (!this.preferences[soundType]) return false;
    if (dedupeKey && isDuplicate(dedupeKey)) return false;

    const now = Date.now();
    // Global throttle to prevent multiple overlapping audio events
    if (now - this.lastGlobalSoundTime < 350) return false;

    const last = this.lastPlayedTimeByType[soundType] || 0;
    if (now - last < THROTTLE_MS) return false;

    this.lastPlayedTimeByType[soundType] = now;
    this.lastGlobalSoundTime = now;
    return true;
  }

  // 1. Session Reminder (10 minutes before) - Gentle ascending two-tone chime
  public playSessionReminder10Min(dedupeKey?: string) {
    if (!this.canPlay("sessionReminderSounds", dedupeKey)) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Note 1: G5 (783.99 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(783.99, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.18, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Note 2: C6 (1046.50 Hz) - 120ms later with soft harmonic warmth
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1046.50, now + 0.12);
      gain2.gain.setValueAtTime(0.001, now + 0.12);
      gain2.gain.linearRampToValueAtTime(0.22, now + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.65);

      triggerHapticFeedback("pattern", [60, 40, 60]);
    } catch (e) {
      console.warn("[SoundService] Session reminder sound failed:", e);
    }
  }

  // 2. Session Starting Reminder (Live Now / Starting) - Crisp 4-note ascending chime
  public playSessionStarting(dedupeKey?: string) {
    if (!this.canPlay("sessionReminderSounds", dedupeKey)) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Chord progression: C5 -> E5 -> G5 -> C6
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startTime = now + idx * 0.09;
        const duration = 0.45 + (idx === notes.length - 1 ? 0.3 : 0);

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(0.18, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      });

      triggerHapticFeedback("pattern", [80, 50, 80]);
    } catch (e) {
      console.warn("[SoundService] Session starting sound failed:", e);
    }
  }

  // 3. Incoming Live Swap Call Ringtone - Modern, elegant repeating marimba pulse
  public startIncomingCallRingtone(dedupeKey?: string) {
    if (this.isRingtonePlaying) return;
    const prefs = this.getPreferences();
    if (!prefs.callRingtone) return;

    this.isRingtonePlaying = true;

    const playRingtonePulse = () => {
      if (!this.isRingtonePlaying) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        // Modern warm double-tone mallet chord
        const chord1 = [698.46, 880.00]; // F5 + A5
        chord1.forEach((freq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.4);
        });

        // Response note: C6 (1046.50 Hz) 160ms later
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(1046.50, now + 0.16);
        gain2.gain.setValueAtTime(0.001, now + 0.16);
        gain2.gain.linearRampToValueAtTime(0.2, now + 0.18);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.16);
        osc2.stop(now + 0.65);

        // Echo note: F6 (1396.91 Hz) 320ms later
        const osc3 = ctx.createOscillator();
        const gain3 = ctx.createGain();
        osc3.type = "sine";
        osc3.frequency.setValueAtTime(1396.91, now + 0.32);
        gain3.gain.setValueAtTime(0.001, now + 0.32);
        gain3.gain.linearRampToValueAtTime(0.15, now + 0.34);
        gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
        osc3.connect(gain3);
        gain3.connect(ctx.destination);
        osc3.start(now + 0.32);
        osc3.stop(now + 0.9);

        // Rhythmic vibration pulse during ringtone
        triggerHapticFeedback("pattern", [120, 80, 120]);
      } catch (e) {
        console.warn("[SoundService] Ringtone pulse error:", e);
      }
    };

    // Play first pulse immediately
    playRingtonePulse();

    // Repeat every 2.4 seconds
    this.ringtoneInterval = setInterval(playRingtonePulse, 2400);

    // Auto-timeout after 45 seconds if unhandled
    this.ringtoneTimeout = setTimeout(() => {
      this.stopIncomingCallRingtone();
    }, 45000);
  }

  public stopIncomingCallRingtone() {
    this.isRingtonePlaying = false;
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
    if (this.ringtoneTimeout) {
      clearTimeout(this.ringtoneTimeout);
      this.ringtoneTimeout = null;
    }
  }

  // Outgoing Call Ringback Tone - Realistic soft double pulse (440Hz + 480Hz) every 3 seconds
  public startOutgoingRingtone() {
    if (this.isOutgoingTonePlaying) return;
    const prefs = this.getPreferences();
    if (!prefs.callRingtone) return;

    this.isOutgoingTonePlaying = true;

    const playDialTonePulse = () => {
      if (!this.isOutgoingTonePlaying) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        // Realistic subtle ringing tone (440Hz + 480Hz dual tone)
        [440, 480].forEach((freq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now);

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.06, now + 0.05);
          gain.gain.setValueAtTime(0.06, now + 1.2);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 1.35);
        });
      } catch (e) {
        console.warn("[SoundService] Outgoing ringtone pulse error:", e);
      }
    };

    // Play initial pulse
    playDialTonePulse();

    // Repeat every 3.2 seconds
    this.outgoingToneInterval = setInterval(playDialTonePulse, 3200);
  }

  public stopOutgoingRingtone() {
    this.isOutgoingTonePlaying = false;
    if (this.outgoingToneInterval) {
      clearInterval(this.outgoingToneInterval);
      this.outgoingToneInterval = null;
    }
  }

  // 4. Session Request Received - Sophisticated soft mallet ping
  public playSessionRequestReceived(dedupeKey?: string) {
    if (!this.canPlay("notificationSounds", dedupeKey)) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Note: F5 (698.46 Hz) -> C6 (1046.50 Hz)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(698.46, now);
      osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.08);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.38);

      triggerHapticFeedback("light");
    } catch (e) {
      console.warn("[SoundService] Session request sound error:", e);
    }
  }

  // 5. Session Accepted - Uplifting harmonic confirmation chime
  public playSessionAccepted(dedupeKey?: string) {
    if (!this.canPlay("notificationSounds", dedupeKey)) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Major Triad Harmony: E5 (659.25) -> G#5 (830.61) -> B5 (987.77) -> E6 (1318.51)
      const triad = [659.25, 830.61, 987.77, 1318.51];
      triad.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.06;
        const dur = 0.38 + (idx === triad.length - 1 ? 0.25 : 0);

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur);
      });

      triggerHapticFeedback("success");
    } catch (e) {
      console.warn("[SoundService] Session accepted sound error:", e);
    }
  }

  // 6. New Chat Message - Crisp, subtle iOS-style drop pop
  public playNewChatMessage(dedupeKey?: string) {
    if (!this.canPlay("chatSounds", dedupeKey)) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Clean liquid pop tone: 587.33 (D5) -> 880 (A5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(587.33, now);
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.06);

      gain1.gain.setValueAtTime(0.24, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.16);

      // Micro shimmer overtone: 1480Hz
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1480, now + 0.03);
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.setValueAtTime(0.12, now + 0.03);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.03);
      osc2.stop(now + 0.18);

      triggerHapticFeedback("light");
    } catch (e) {
      console.warn("[SoundService] Chat message sound error:", e);
    }
  }

  // 7. Call Ended - Gentle, soft descending fade tone
  public playCallEnded(dedupeKey?: string) {
    if (!this.canPlay("notificationSounds", dedupeKey)) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Descending pair: G5 (783.99) -> D5 (587.33) -> C5 (523.25)
      const notes = [783.99, 587.33, 523.25];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.1;
        const dur = 0.35 + (idx === notes.length - 1 ? 0.2 : 0);

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur);
      });

      triggerHapticFeedback("pattern", [50, 40, 30]);
    } catch (e) {
      console.warn("[SoundService] Call ended sound error:", e);
    }
  }

  // General Notification Pop
  public playGenericNotification(dedupeKey?: string) {
    if (!this.canPlay("notificationSounds", dedupeKey)) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);

      triggerHapticFeedback("light");
    } catch (e) {
      console.warn("[SoundService] Notification sound error:", e);
    }
  }
}

export const soundService = new SoundFeedbackService();
