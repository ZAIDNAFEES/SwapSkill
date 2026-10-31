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
      let part2 = url.substring(uploadIndex + 8);
      
      // If part2 already begins with a transformation segment (e.g. f_auto,q_auto/), strip it to avoid duplicates
      const firstSlash = part2.indexOf("/");
      if (firstSlash !== -1) {
        const firstSegment = part2.substring(0, firstSlash);
        if (
          !/^v\d+$/.test(firstSegment) &&
          (firstSegment.includes("f_auto") || firstSegment.includes("q_auto") || firstSegment.includes("w_") || firstSegment.includes("c_"))
        ) {
          part2 = part2.substring(firstSlash + 1);
        }
      }
      
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

  const hasValidSrc = Boolean(src && typeof src === "string" && src.trim() && src !== DEFAULT_AVATAR && !src.startsWith("data:image/svg"));

  // Cloudinary optimization
  const optimizedSrc = hasValidSrc ? getOptimizedImageUrl(src!.trim(), sizeType) : "";

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
    const cleanName = (fullName || alt || "Member").trim();
    const initials = cleanName
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "SS";

    if (fallbackType === "profile") {
      // Premium curated modern gradient palettes (obsidian, titanium, slate, royal indigo, deep emerald, warm champagne)
      const palettes = [
        { bg: "linear-gradient(135deg, #18181B 0%, #09090B 100%)", text: "#C9A96E" },
        { bg: "linear-gradient(135deg, #27272A 0%, #18181B 100%)", text: "#F4F4F5" },
        { bg: "linear-gradient(135deg, #1C1917 0%, #0C0A09 100%)", text: "#E5C483" },
        { bg: "linear-gradient(135deg, #1E1B4B 0%, #0F172A 100%)", text: "#C7D2FE" },
        { bg: "linear-gradient(135deg, #064E3B 0%, #022C22 100%)", text: "#A7F3D0" },
        { bg: "linear-gradient(135deg, #3B0764 0%, #1F0533 100%)", text: "#FBCFE8" },
      ];
      let hash = 0;
      for (let i = 0; i < cleanName.length; i++) {
        hash = (hash << 5) - hash + cleanName.charCodeAt(i);
      }
      const palette = palettes[Math.abs(hash) % palettes.length];

      return (
        <div
          className="w-full h-full flex items-center justify-center font-sans font-bold select-none text-center"
          style={{
            background: palette.bg,
            color: palette.text,
            boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.15)",
          }}
        >
          <span className="text-[12px] sm:text-sm font-semibold tracking-wide">
            {initials}
          </span>
        </div>
      );
    } else {
      return (
        <div 
          className="w-full h-full relative overflow-hidden flex items-center justify-center select-none"
          style={{
            background: "linear-gradient(135deg, #0D0D0F 0%, #1A1816 50%, #111114 100%)",
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23C9A96E' fill-opacity='0.08'%3E%3Ccircle cx='20' cy='20' r='1.5'/%3E%3Ccircle cx='60' cy='50' r='1.2'/%3E%3Cpath d='M40 10l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'/%3E%3C/g%3E%3C/svg%3E"), linear-gradient(135deg, #0D0D0F 0%, #1C1917 50%, #121114 100%)`,
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
        </div>
      );
    }
  };

  // If there's no valid custom image or image loading failed, gracefully render the initials/cover badge
  if (!hasValidSrc || error) {
    return (
      <div className={`relative ${className} overflow-hidden`} onClick={onClick}>
        {renderInitials()}
      </div>
    );
  }

  return (
    <div className={`relative ${className} overflow-hidden`} onClick={onClick}>
      {loading && (
        <div className="absolute inset-0 bg-[#EFEBE2] animate-pulse flex items-center justify-center">
          <div className="w-4 h-4 rounded-full border-2 border-[#C9A96E] border-t-transparent animate-spin" />
        </div>
      )}

      <motion.img
        layoutId={layoutId}
        src={optimizedSrc}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="w-full h-full object-cover transition-opacity duration-200"
        style={{ opacity: loading ? 0.3 : 1 }}
      />
    </div>
  );
}
export default SmartImage;
