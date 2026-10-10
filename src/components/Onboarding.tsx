import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, Sparkles, Users, ArrowRight, Check } from "lucide-react";
import logoImg from "../assets/logo.jpg";

interface OnboardingProps {
  onFinish: () => void;
}

export default function Onboarding({ onFinish }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      title: "Learn any skill.",
      description: "Access an elite directory of experts ready to share their crafts. Acquire real-world knowledge from language fluency to advanced system design.",
      icon: <BookOpen className="w-12 h-12 text-[#D4AF37]" />,
      colorClass: "from-[#D4AF37]/10 to-transparent",
      accentBorder: "border-[#D4AF37]/20",
      illustration: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute inset-0 bg-[#D4AF37]/5 rounded-full blur-2xl animate-pulse-slow"></div>
          {/* Glowing central orbit */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            className="absolute w-40 h-40 border border-dashed border-[#D4AF37]/30 rounded-full flex items-center justify-center"
          >
            <div className="absolute -top-1.5 w-3 h-3 rounded-full bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]"></div>
            <div className="absolute -bottom-1.5 w-3 h-3 rounded-full bg-zinc-600"></div>
          </motion.div>
          
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            className="absolute w-28 h-28 border border-white/10 rounded-full"
          >
            <div className="absolute top-1/2 -right-1 w-2.5 h-2.5 rounded-full bg-[#4F46E5] shadow-lg"></div>
          </motion.div>

          <div className="w-20 h-20 bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-xl z-10">
            <BookOpen className="w-10 h-10 text-amber-500" />
          </div>
        </div>
      )
    },
    {
      title: "Teach your skills.",
      description: "Share your passion, build your global reputation, and establish credentials. Pay it forward and help others achieve their true potential.",
      icon: <Sparkles className="w-12 h-12 text-blue-600" />,
      colorClass: "from-blue-500/10 to-transparent",
      accentBorder: "border-blue-200",
      illustration: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute inset-0 bg-blue-500/5 rounded-full blur-2xl animate-pulse-slow"></div>
          {/* Radial radiant bars representing broadcasting */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, idx) => (
            <motion.div
              key={idx}
              initial={{ scale: 0.6, opacity: 0.2 }}
              animate={{ scale: [0.6, 1.1, 0.6], opacity: [0.2, 0.8, 0.2] }}
              transition={{ duration: 3, repeat: Infinity, delay: idx * 0.2, ease: "easeInOut" }}
              className="absolute w-1 h-12 bg-gradient-to-t from-blue-600 to-transparent origin-bottom"
              style={{ transform: `rotate(${angle}deg) translateY(-24px)` }}
            />
          ))}

          <div className="w-20 h-20 bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-xl z-10">
            <Sparkles className="w-10 h-10 text-blue-600" />
          </div>
        </div>
      )
    },
    {
      title: "Grow together.",
      description: "A pure community powered by clean, direct peer-to-peer knowledge trades. No artificial AI, no paywalls, just real people accelerating together.",
      icon: <Users className="w-12 h-12 text-amber-500" />,
      colorClass: "from-amber-500/10 to-transparent",
      accentBorder: "border-amber-200",
      illustration: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute inset-0 bg-amber-500/5 rounded-full blur-2xl animate-pulse-slow"></div>
          {/* Dual spinning loop */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
            className="absolute w-36 h-36 border-2 border-t-amber-400 border-r-blue-400 border-b-gray-200 border-l-transparent rounded-full"
          />
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            className="absolute w-28 h-28 border border-t-blue-300 border-l-amber-300 border-b-transparent border-r-transparent rounded-full opacity-60"
          />

          <div className="w-20 h-20 bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-xl z-10">
            <Users className="w-10 h-10 text-amber-500" />
          </div>
        </div>
      )
    }
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      onFinish();
    }
  };

  const handleSkip = () => {
    onFinish();
  };

  return (
    <div 
      className="flex flex-col h-full w-full flex-1 bg-white text-gray-900 select-none relative overflow-y-auto overscroll-y-contain mobile-scroll font-sans touch-pan-y"
      style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
    >
      {/* Dynamic Background Blob depending on current slide */}
      <div className={`absolute top-0 inset-x-0 h-96 bg-gradient-to-b ${steps[currentStep].colorClass} blur-[100px] transition-all duration-1000`} />

      {/* Header with Skip button */}
      <div className="flex justify-between items-center px-6 py-5 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 border border-gray-200 rounded-lg overflow-hidden shadow-sm bg-white">
            <img src={logoImg} alt="SwapSkill Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <span className="font-sans font-bold text-base tracking-tight text-gray-900 flex items-center gap-1">
            SwapSkill <span className="text-blue-600 text-xs">✦</span>
          </span>
        </div>
        
        {currentStep < steps.length - 1 && (
          <button
            id="onboarding-skip-btn"
            onClick={handleSkip}
            className="text-gray-400 hover:text-gray-900 transition text-xs font-semibold uppercase tracking-wider font-mono"
          >
            Skip
          </button>
        )}
      </div>

      {/* Main Content Carousel */}
      <div className="flex-1 flex flex-col justify-center px-8 z-10 max-w-md mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center text-center"
          >
            {/* Visual Illustration Container */}
            <div className={`mb-10 p-6 rounded-[40px] border ${steps[currentStep].accentBorder} bg-slate-50/80 backdrop-blur-md shadow-xs`}>
              {steps[currentStep].illustration}
            </div>

            {/* Typography */}
            <h2 className="text-3xl font-sans font-bold tracking-tight text-gray-900 mb-4">
              {steps[currentStep].title}
            </h2>
            <p className="text-gray-500 text-sm leading-relaxed max-w-sm font-sans">
              {steps[currentStep].description}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer Controls */}
      <div className="px-8 py-8 z-10 max-w-md mx-auto w-full flex flex-col gap-6">
        {/* Step Indicator Bullets */}
        <div className="flex justify-center gap-2">
          {steps.map((_, idx) => (
            <button
              id={`onboarding-indicator-${idx}`}
              key={idx}
              onClick={() => setCurrentStep(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                currentStep === idx ? "w-6 bg-blue-600" : "w-1.5 bg-gray-200 hover:bg-gray-300"
              }`}
            />
          ))}
        </div>

        {/* Action Button */}
        <button
          id="onboarding-action-btn"
          onClick={handleNext}
          className="w-full h-14 bg-blue-600 hover:bg-blue-700 rounded-2xl flex items-center justify-center font-bold text-white hover:opacity-95 active:scale-98 transition group cursor-pointer shadow-md"
        >
          {currentStep === steps.length - 1 ? (
            <span className="flex items-center gap-2 text-sm font-bold">
              Get Started <Check className="w-5 h-5 stroke-[2.5]" />
            </span>
          ) : (
            <span className="flex items-center gap-2 text-sm font-bold">
              Next <ArrowRight className="w-5 h-5 stroke-[2.5] group-hover:translate-x-1 transition-transform" />
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
