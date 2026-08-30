import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { DEFAULT_AVATAR } from "../types";

export function getOptimizedImageUrl(
  url: string | null | undefined, 
  type: "thumbnail" | "standard" | "raw" = "standard"
): string {
  if (!url) return "";
  
  // If it's a Cloudinary URL, inject performance parameters
  if (url.includes("res.cloudinary.com")) {
    const uploadIndex = url.indexOf("/upload/");
    if (uploadIndex !== -1) {
      const part1 = url.substring(0, uploadIndex + 8);
      const part2 = url.substring(uploadIndex + 8);
      
      let transformation = "f_auto,q_auto";
      if (type === "thumbnail") {
        transformation += ",w_150,h_150,c_fill,g_face";
      } else if (type === "standard") {
        transformation += ",w_800";
      }
      return `${part1}${transformation}/${part2}`;
    }
  }
  return url;
}

interface SmartImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallbackType: "profile" | "cover";
  fullName?: string;
  onClick?: () => void;
  layoutId?: string;
  sizeType?: "thumbnail" | "standard" | "raw";
}

export function SmartImage({
  src,
  alt,
  className = "",
  fallbackType,
  fullName = "User",
  onClick,
  layoutId,
  sizeType = "standard"
}: SmartImageProps) {
  const [loading, setLoading] = useState(!!src);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Resolve source with default avatar if profile fallback and source is empty/falsy
  const resolvedSrc = (fallbackType === "profile" && !src) ? DEFAULT_AVATAR : src;

  // Cloudinary optimization
  const optimizedSrc = resolvedSrc ? getOptimizedImageUrl(resolvedSrc, sizeType) : "";

  useEffect(() => {
    if (!optimizedSrc) {
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);

    const img = new Image();
    img.src = optimizedSrc;
    img.onload = () => {
      setLoading(false);
      setError(false);
    };
    img.onerror = () => {
      setLoading(false);
      setError(true);
    };
  }, [optimizedSrc, retryCount]);

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetryCount((prev) => prev + 1);
  };

  const renderInitials = () => {
    const initials = fullName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "SS";

    if (fallbackType === "profile") {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#4F46E5] via-[#111113] to-[#09090B] border border-white/[0.08] flex items-center justify-center text-[#D4AF37] font-sans font-bold text-lg shadow-inner">
          {initials}
        </div>
      );
    } else {
      return (
        <div className="w-full h-full bg-slate-100 border border-gray-200 flex items-center justify-center text-gray-400 font-mono text-[9px] uppercase tracking-wider font-semibold">
          No Cover Image
        </div>
      );
    }
  };

  // If there's no src and it's not a profile (i.e. cover image), render standard fallback initials/placeholder
  if (!resolvedSrc) {
    return <div className={className}>{renderInitials()}</div>;
  }

  return (
    <div className={`relative ${className} overflow-hidden`} onClick={onClick}>
      {loading && (
        <div className="absolute inset-0 bg-slate-100 animate-pulse flex items-center justify-center">
          <div className="w-5 h-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        </div>
      )}

      {error ? (
        fallbackType === "profile" ? (
          // Automatically fall back to default avatar on load failure for profiles
          <img
            src={DEFAULT_AVATAR}
            alt="Default Profile Avatar Fallback"
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="absolute inset-0 bg-slate-100 flex flex-col items-center justify-center p-2 text-center z-10">
            <span className="text-[10px] text-gray-500 mb-1">Failed to load</span>
            <button
              onClick={handleRetry}
              className="px-2 py-0.5 bg-white text-[10px] text-blue-600 font-medium rounded border border-gray-200 shadow-xs transition cursor-pointer"
            >
              Retry
            </button>
          </div>
        )
      ) : (
        <motion.img
          layoutId={layoutId}
          src={optimizedSrc}
          alt={alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="w-full h-full object-cover transition-all duration-300 ease-out"
          style={{ filter: loading ? "blur(8px)" : "blur(0px)" }}
        />
      )}
    </div>
  );
}
export default SmartImage;
