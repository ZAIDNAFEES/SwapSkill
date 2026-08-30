// Utility for playing a crisp, pleasant notification chime pop using Web Audio API

export const playNotificationSound = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Pop tone 1: Warm D5 -> A5 glide
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5

    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    // Pop tone 2: High shimmer chime (D6 -> A6)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1174.66, now + 0.04); // D6
    osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.12); // A6

    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.2, now + 0.04);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.22);

    osc2.start(now + 0.04);
    osc2.stop(now + 0.28);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 450);
  } catch (e) {
    console.warn("Could not play notification sound:", e);
  }
};
