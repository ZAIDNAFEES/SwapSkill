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
    <div className="flex flex-col items-center justify-center min-h-screen bg-white text-gray-900 select-none relative overflow-hidden font-sans">
      <div className="flex flex-col items-center max-w-sm px-6 text-center z-10">
        {/* Animated App Icon */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-28 h-28 bg-white border border-gray-200 rounded-3xl p-1.5 flex items-center justify-center shadow-md overflow-hidden"
        >
          <motion.img
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.05, duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            src={logoImg}
            alt="SwapSkill Logo"
            className="w-full h-full object-cover rounded-2xl"
            referrerPolicy="no-referrer"
          />
        </motion.div>

        {/* Animated Brand Typography */}
        <motion.div
          initial={{ y: 5, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.2 }}
          className="mt-6 flex flex-col items-center"
        >
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-sans font-bold text-gray-900 tracking-tight">
              SwapSkill
            </h1>
            <span className="text-blue-600 text-md select-none font-bold">✦</span>
          </div>
          
          <p className="mt-1 text-gray-500 text-[11px] font-medium uppercase tracking-wider">
            Learn • Teach • Grow
          </p>
        </motion.div>

        {/* Loading Dots */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.15 }}
          className="mt-10 flex gap-1.5"
        >
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.1s' }}></span>
          <span className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" style={{ animationDelay: '0.2s' }}></span>
        </motion.div>
      </div>
    </div>
  );
}
