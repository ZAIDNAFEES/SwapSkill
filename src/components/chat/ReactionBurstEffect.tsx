import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";

export interface ReactionBurst {
  id: string;
  emoji: string;
  x: number;
  y: number;
}

interface ReactionBurstEffectProps {
  bursts: ReactionBurst[];
  onComplete: (id: string) => void;
}

// Dynamic particle dispersal vectors for celebratory burst
const PARTICLES = [
  { dx: -34, dy: -46, rot: -24, delay: 0.01, scale: 0.8 },
  { dx: 32, dy: -50, rot: 22, delay: 0.03, scale: 0.85 },
  { dx: -52, dy: -20, rot: -40, delay: 0.02, scale: 0.7 },
  { dx: 48, dy: -24, rot: 36, delay: 0.04, scale: 0.75 },
  { dx: -18, dy: -76, rot: -14, delay: 0.01, scale: 0.9 },
  { dx: 22, dy: -72, rot: 16, delay: 0.03, scale: 0.95 },
  { dx: -38, dy: -62, rot: -30, delay: 0.02, scale: 0.8 },
  { dx: 36, dy: -60, rot: 28, delay: 0.04, scale: 0.85 },
  { dx: 0, dy: -65, rot: 0, delay: 0.02, scale: 0.75 },
];

export const ReactionBurstEffect: React.FC<ReactionBurstEffectProps> = ({
  bursts,
  onComplete,
}) => {
  return (
    <div className="fixed inset-0 pointer-events-none z-[220] overflow-hidden select-none">
      <AnimatePresence>
        {bursts.map((b) => (
          <BurstItem key={b.id} burst={b} onFinish={() => onComplete(b.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
};

const BurstItem: React.FC<{ burst: ReactionBurst; onFinish: () => void }> = ({
  burst,
  onFinish,
}) => {
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    const timer = setTimeout(() => {
      onFinishRef.current();
    }, 950);
    return () => clearTimeout(timer);
  }, []);

  // Viewport edge clamping so celebrations never get cut off
  const safeX = typeof window !== "undefined" 
    ? Math.max(48, Math.min(window.innerWidth - 48, burst.x)) 
    : burst.x;
  const safeY = typeof window !== "undefined" 
    ? Math.max(72, Math.min(window.innerHeight - 60, burst.y)) 
    : burst.y;

  return (
    <div
      style={{
        position: "fixed",
        left: safeX,
        top: safeY,
        transform: "translate(-50%, -50%)",
      }}
      className="pointer-events-none select-none z-[220]"
    >
      {/* 1. Golden Aura Shockwave Pulse */}
      <motion.div
        initial={{ scale: 0.2, opacity: 0.9 }}
        animate={{ scale: [0.2, 2.4], opacity: [0.9, 0] }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="absolute -inset-6 rounded-full bg-gradient-to-r from-amber-400/40 via-yellow-300/35 to-amber-500/25 blur-lg pointer-events-none"
      />

      {/* 2. Sparkle Ring */}
      <motion.div
        initial={{ scale: 0.4, opacity: 1, rotate: 0 }}
        animate={{ scale: 1.8, opacity: 0, rotate: 45 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="absolute -inset-8 rounded-full border border-amber-300/50 pointer-events-none"
      />

      {/* 3. Radial Particle Sprinkles */}
      {PARTICLES.map((p, idx) => (
        <motion.div
          key={idx}
          initial={{ x: 0, y: 0, scale: 0, opacity: 1, rotate: 0 }}
          animate={{
            x: p.dx,
            y: p.dy,
            scale: [0, p.scale, 0],
            opacity: [0, 1, 0],
            rotate: p.rot,
          }}
          transition={{
            duration: 0.8,
            delay: p.delay,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="absolute text-sm drop-shadow-md pointer-events-none"
        >
          {idx % 3 === 0 ? burst.emoji : idx % 3 === 1 ? "✨" : "💛"}
        </motion.div>
      ))}

      {/* 4. Main Flying Hero Emoji with spring bounce */}
      <motion.div
        initial={{ scale: 0.3, y: 0, opacity: 0, rotate: 0 }}
        animate={{
          scale: [0.3, 2.0, 1.45, 0],
          y: [0, -32, -75, -105],
          opacity: [0, 1, 1, 0],
          rotate: [0, -14, 10, -6],
        }}
        transition={{
          duration: 0.9,
          times: [0, 0.28, 0.72, 1],
          ease: [0.16, 1, 0.3, 1],
        }}
        className="text-[44px] sm:text-[48px] drop-shadow-[0_8px_24px_rgba(0,0,0,0.5)] pointer-events-none filter"
      >
        {burst.emoji}
      </motion.div>
    </div>
  );
};
