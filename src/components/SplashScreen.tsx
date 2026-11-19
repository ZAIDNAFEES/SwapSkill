import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import logoImg from "../assets/logo.jpg";
import { useApp } from "../context/AppContext";

interface SplashScreenProps {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  const { loadingAuth, currentUserProfile } = useApp();
  const onFinishRef = React.useRef(onFinish);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  // 1. Natural show duration for brand logo animation (500ms)
  useEffect(() => {
    const minTimer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, 500);
    return () => clearTimeout(minTimer);
  }, []);

  // 2. Maximum safety limit (1500ms)
  useEffect(() => {
    const maxTimer = setTimeout(() => {
      onFinishRef.current();
    }, 1500);
    return () => clearTimeout(maxTimer);
  }, []);

  // 3. Trigger completion when both minimum animation time elapsed and either cached profile exists or auth resolved
  useEffect(() => {
    if (minTimeElapsed && (currentUserProfile || !loadingAuth)) {
      onFinishRef.current();
    }
  }, [minTimeElapsed, loadingAuth, currentUserProfile]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center min-h-[100dvh] bg-[#F7F4EE] text-[#0D0D0F] select-none relative overflow-hidden font-sans"
    >
      {/* Subtle ambient luxury backdrop glow */}
      <div className="absolute w-72 h-72 rounded-full bg-[#C9A96E]/10 blur-3xl pointer-events-none" />

      <div className="flex flex-col items-center max-w-sm px-6 text-center z-10">
        {/* Animated App Icon */}
        <motion.div
          initial={{ scale: 0.88, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-24 h-24 bg-[#0D0D0F] border border-[#C9A96E]/30 rounded-[28px] p-2 flex items-center justify-center shadow-[0_16px_36px_rgba(13,13,15,0.14)] overflow-hidden"
        >
          <motion.img
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            src={logoImg}
            alt="SwapSkill Logo"
            className="w-full h-full object-cover rounded-[20px]"
            referrerPolicy="no-referrer"
          />
        </motion.div>

        {/* Animated Brand Typography */}
        <motion.div
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 flex flex-col items-center"
        >
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-sans font-bold text-[#0D0D0F] tracking-tight">
              SwapSkill
            </h1>
            <span className="text-[#C9A96E] text-base select-none font-bold">✦</span>
          </div>
          
          <p className="mt-1.5 text-[#71717A] text-[10px] font-semibold uppercase tracking-[0.2em]">
            Skill Exchange Network
          </p>
        </motion.div>

        {/* Minimal luxury loading indicator */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.25 }}
          className="mt-9 flex items-center gap-1.5"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E] animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-[#0D0D0F] animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-[#C9A96E] animate-bounce" style={{ animationDelay: '300ms' }} />
        </motion.div>
      </div>

      <div className="absolute bottom-8 text-[11px] font-medium text-[#71717A]/70 tracking-wider">
        Learn • Teach • Grow
      </div>
    </motion.div>
  );
}
