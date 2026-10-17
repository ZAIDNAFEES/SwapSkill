import React, { useEffect, useRef, useState, memo } from "react";
import { motion, AnimatePresence } from "motion/react";

export interface ReactionBurst {
  id: string;
  emoji: string;
  x: number;
  y: number;
}

interface ReactionBurstEffectProps {
  bursts?: ReactionBurst[];
  onComplete?: (id: string) => void;
}

// Global trigger helper that avoids re-rendering the parent chat list component
export const emitReactionBurst = (emoji: string, x: number, y: number) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("swap_reaction_burst", {
      detail: {
        id: `burst_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        emoji,
        x,
        y,
      },
    })
  );
};

// 6 optimized particles for crisp, lag-free 60fps mobile burst
const PARTICLES = [
  { dx: -28, dy: -38, rot: -18, scale: 0.8 },
  { dx: 26, dy: -42, rot: 16, scale: 0.85 },
  { dx: -42, dy: -16, rot: -28, scale: 0.7 },
  { dx: 38, dy: -18, rot: 25, scale: 0.75 },
  { dx: -14, dy: -56, rot: -10, scale: 0.85 },
  { dx: 16, dy: -54, rot: 12, scale: 0.9 },
];

export const ReactionBurstEffect: React.FC<ReactionBurstEffectProps> = memo(({
  bursts: propBursts = [],
  onComplete,
}) => {
  const [internalBursts, setInternalBursts] = useState<ReactionBurst[]>([]);

  // Listen to standalone burst events to isolate animation renders from parent chat tree
  useEffect(() => {
    const handleBurstEvent = (e: Event) => {
      const customEvent = e as CustomEvent<ReactionBurst>;
      if (!customEvent.detail) return;
      setInternalBursts((prev) => [...prev.slice(-5), customEvent.detail]);
    };

    window.addEventListener("swap_reaction_burst", handleBurstEvent as EventListener);
    return () => {
      window.removeEventListener("swap_reaction_burst", handleBurstEvent as EventListener);
    };
  }, []);

  const handleFinish = (id: string) => {
    setInternalBursts((prev) => prev.filter((b) => b.id !== id));
    if (onComplete) onComplete(id);
  };

  const activeBursts = [...propBursts, ...internalBursts];

  if (activeBursts.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[220] overflow-hidden select-none">
      <AnimatePresence>
        {activeBursts.map((b) => (
          <BurstItem key={b.id} burst={b} onFinish={() => handleFinish(b.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
});

ReactionBurstEffect.displayName = "ReactionBurstEffect";

const BurstItem: React.FC<{ burst: ReactionBurst; onFinish: () => void }> = memo(({
  burst,
  onFinish,
}) => {
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    const timer = setTimeout(() => {
      onFinishRef.current();
    }, 650);
    return () => clearTimeout(timer);
  }, []);

  // Viewport edge clamping
  const safeX = typeof window !== "undefined" 
    ? Math.max(40, Math.min(window.innerWidth - 40, burst.x)) 
    : burst.x;
  const safeY = typeof window !== "undefined" 
    ? Math.max(64, Math.min(window.innerHeight - 50, burst.y)) 
    : burst.y;

  return (
    <div
      style={{
        position: "fixed",
        left: safeX,
        top: safeY,
        transform: "translate3d(-50%, -50%, 0)",
        willChange: "transform, opacity",
      }}
      className="pointer-events-none select-none z-[220]"
    >
      {/* 1. Subtle, lightweight Gold Ring expansion (no expensive Gaussian blurs) */}
      <motion.div
        initial={{ scale: 0.3, opacity: 0.8 }}
        animate={{ scale: 1.8, opacity: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="absolute -inset-5 rounded-full border-2 border-amber-400/60 pointer-events-none"
        style={{ willChange: "transform, opacity" }}
      />

      {/* 2. Radial Particle Sprinkles (6 lightweight sprites) */}
      {PARTICLES.map((p, idx) => (
        <motion.div
          key={idx}
          initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
          animate={{
            x: p.dx,
            y: p.dy,
            scale: [0, p.scale, 0],
            opacity: [0, 1, 0],
            rotate: p.rot,
          }}
          transition={{
            duration: 0.55,
            ease: "easeOut",
          }}
          className="absolute text-xs pointer-events-none"
          style={{ willChange: "transform, opacity" }}
        >
          {idx % 2 === 0 ? burst.emoji : "✨"}
        </motion.div>
      ))}

      {/* 3. Main Flying Hero Emoji with responsive spring */}
      <motion.div
        initial={{ scale: 0.4, y: 0, opacity: 0 }}
        animate={{
          scale: [0.4, 1.8, 1.3, 0],
          y: [0, -26, -58, -78],
          opacity: [0, 1, 1, 0],
        }}
        transition={{
          duration: 0.62,
          times: [0, 0.25, 0.7, 1],
          ease: "easeOut",
        }}
        className="text-[38px] pointer-events-none select-none"
        style={{ willChange: "transform, opacity" }}
      >
        {burst.emoji}
      </motion.div>
    </div>
  );
});

BurstItem.displayName = "BurstItem";
