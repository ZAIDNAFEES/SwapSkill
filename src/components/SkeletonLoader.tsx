import React, { useState, useEffect } from "react";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div className={`bg-gray-200/70 border border-gray-200/50 skeleton-shimmer rounded-xl ${className}`} />
  );
}

/**
 * LoadingTransition manages the 200ms delay and 250ms fade-in transition
 * to ensure that skeleton loading screens only show if operations take > 200ms.
 */
export function LoadingTransition({
  isLoading,
  type,
  count = 1,
  children,
  delayMs = 200,
}: {
  isLoading: boolean;
  type: "feed" | "profile" | "messages" | "sessions" | "search" | "image" | "notifications" | "swap" | "followers" | "comments" | "chat-messages";
  count?: number;
  children: React.ReactNode;
  delayMs?: number;
}) {
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [renderedLoadingState, setRenderedLoadingState] = useState(isLoading);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isLoading) {
      setRenderedLoadingState(true);
      setShowSkeleton(false);
      timer = setTimeout(() => {
        setShowSkeleton(true);
      }, delayMs);
    } else {
      setShowSkeleton(false);
      // Allow a brief tick before setting rendered state to false to ensure a clean fade-in
      const fadeTimer = setTimeout(() => {
        setRenderedLoadingState(false);
      }, 50);
      return () => clearTimeout(fadeTimer);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isLoading, delayMs]);

  if (isLoading) {
    if (!showSkeleton) {
      // Avoid flicker by returning an empty block during the first 200ms
      return null;
    }
    return (
      <div className="w-full h-full animate-fade-in-shimmer">
        <SkeletonLoader type={type} count={count} />
      </div>
    );
  }

  return (
    <div className="w-full min-h-full flex flex-col animate-fade-in-shimmer">
      {children}
    </div>
  );
}

export default function SkeletonLoader({
  type = "feed",
  count = 3
}: {
  type?: "feed" | "profile" | "messages" | "sessions" | "search" | "image" | "notifications" | "swap" | "followers" | "comments" | "chat-messages";
  count?: number;
}) {
  const items = Array.from({ length: count });

  if (type === "profile") {
    return (
      <div className="w-full flex flex-col gap-6 animate-fade-in-shimmer">
        {/* Banner Cover */}
        <Skeleton className="h-44 w-full rounded-b-[24px]" />
        
        {/* Profile Info */}
        <div className="flex flex-col items-center -mt-16 px-4 gap-4 z-10">
          <Skeleton className="w-28 h-28 rounded-full border-4 border-white" />
          <Skeleton className="h-5 w-36 rounded-lg" />
          <Skeleton className="h-4 w-24 rounded-md" />
          <Skeleton className="h-16 w-full max-w-sm rounded-2xl" />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 px-4 w-full max-w-sm mx-auto">
          <Skeleton className="h-11 flex-1 rounded-xl" />
          <Skeleton className="h-11 flex-1 rounded-xl" />
        </div>

        {/* Grid or details */}
        <div className="px-4 flex flex-col gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-24 w-full rounded-[24px]" />
          <Skeleton className="h-24 w-full rounded-[24px]" />
        </div>
      </div>
    );
  }

  if (type === "messages") {
    // Chat List Skeleton
    return (
      <div className="flex flex-col p-4 gap-4 animate-fade-in-shimmer">
        {items.map((_, i) => (
          <div key={i} className="flex items-center gap-3 w-full">
            <Skeleton className="w-12 h-12 rounded-full shrink-0" />
            <div className="flex flex-col gap-2 flex-1">
              <div className="flex justify-between items-center">
                <Skeleton className="h-4 w-28 rounded" />
                <Skeleton className="h-3 w-10 rounded" />
              </div>
              <Skeleton className="h-3.5 w-full max-w-xs rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "chat-messages") {
    // Inside a chat room
    return (
      <div className="flex flex-col p-4 gap-4 animate-fade-in-shimmer w-full">
        {items.map((_, i) => {
          const isSelf = i % 2 === 1;
          return (
            <div
              key={i}
              className={`flex items-end gap-2.5 max-w-[70%] ${
                isSelf ? "self-end flex-row-reverse" : "self-start"
              }`}
            >
              {!isSelf && <Skeleton className="w-7 h-7 rounded-full shrink-0" />}
              <div className="flex flex-col gap-1">
                <Skeleton
                  className={`h-9 rounded-2xl ${
                    isSelf 
                      ? "w-48 rounded-tr-none bg-blue-50" 
                      : "w-56 rounded-tl-none bg-gray-100"
                  }`}
                />
                <Skeleton className="h-2.5 w-10 rounded self-end mt-1" />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (type === "sessions") {
    // High-quality Apple/Linear/Calendly style session cards
    return (
      <div className="flex flex-col p-4 gap-4 animate-fade-in-shimmer">
        {items.map((_, i) => (
          <div key={i} className="p-6 rounded-2xl bg-white border border-gray-200 shadow-xs flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                <Skeleton className="h-4 w-16 rounded-full" />
                <Skeleton className="h-4 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4.5 w-14 rounded-md" />
            </div>
            
            <div className="flex gap-3 items-center">
              <Skeleton className="w-10 h-10 rounded-full shrink-0" />
              <div className="flex-1 flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3 rounded" />
                <Skeleton className="h-3 w-1/3 rounded" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-1">
              <Skeleton className="h-10 rounded-xl" />
              <Skeleton className="h-10 rounded-xl" />
            </div>

            <div className="border-t border-gray-100 pt-3 flex justify-between items-center">
              <Skeleton className="h-3 w-28 rounded" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "search") {
    return (
      <div className="flex flex-col p-4 gap-4 animate-fade-in-shimmer">
        <div className="flex flex-col gap-4">
          {items.map((_, i) => (
            <div key={i} className="p-4 rounded-[24px] bg-white border border-gray-200 shadow-xs flex gap-4 items-center">
              <Skeleton className="w-12 h-12 rounded-full shrink-0" />
              <div className="flex flex-col gap-2 flex-1">
                <Skeleton className="h-4 w-28 rounded" />
                <Skeleton className="h-3 w-40 rounded" />
              </div>
              <Skeleton className="h-8 w-20 rounded-xl shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === "notifications") {
    return (
      <div className="flex flex-col p-4 gap-3 animate-fade-in-shimmer">
        {items.map((_, i) => (
          <div key={i} className="p-3.5 rounded-xl bg-white border border-gray-200 shadow-xs flex gap-3 items-start">
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1">
              <Skeleton className="h-3.5 w-full rounded" />
              <Skeleton className="h-2.5 w-16 rounded" />
            </div>
            <Skeleton className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" />
          </div>
        ))}
      </div>
    );
  }

  if (type === "swap") {
    // Book / Skill Swap interaction or overlay block
    return (
      <div className="p-5 rounded-2xl bg-white border border-gray-200 shadow-xs flex flex-col gap-4 animate-fade-in-shimmer">
        <Skeleton className="h-5 w-40 rounded" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-9 rounded-lg" />
          <Skeleton className="h-9 rounded-lg" />
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl mt-1" />
      </div>
    );
  }

  if (type === "followers") {
    return (
      <div className="flex flex-col gap-3 animate-fade-in-shimmer">
        {items.map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-1">
            <Skeleton className="w-9 h-9 rounded-full shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-24 rounded" />
              <Skeleton className="h-2.5 w-16 rounded" />
            </div>
            <Skeleton className="h-7 w-16 rounded-lg shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (type === "comments") {
    return (
      <div className="flex flex-col gap-3.5 animate-fade-in-shimmer">
        {items.map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="w-7 h-7 rounded-full shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <div className="flex gap-2 items-center">
                <Skeleton className="h-3 w-16 rounded" />
                <Skeleton className="h-2.5 w-10 rounded" />
              </div>
              <Skeleton className="h-3 w-full max-w-sm rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "image") {
    return (
      <div className="relative w-full h-full min-h-[180px] rounded-2xl overflow-hidden bg-slate-100">
        <Skeleton className="absolute inset-0 w-full h-full rounded-2xl" />
      </div>
    );
  }

  // Default: Feed cards skeleton
  return (
    <div className="flex flex-col p-4 gap-5 animate-fade-in-shimmer">
      {items.map((_, i) => (
        <div key={i} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col gap-3.5">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-full shrink-0" />
            <div className="flex flex-col gap-2 flex-1">
              <div className="flex justify-between items-center">
                <Skeleton className="h-3.5 w-24 rounded" />
                <Skeleton className="h-2.5 w-12 rounded" />
              </div>
              <Skeleton className="h-3 w-16 rounded" />
            </div>
          </div>
          
          <Skeleton className="h-4.5 w-full rounded mt-1" />
          <Skeleton className="h-4.5 w-5/6 rounded" />
          
          {/* Post Image Placeholder */}
          <Skeleton className="h-44 w-full rounded-2xl mt-2" />

          <div className="flex gap-3.5 mt-2 border-t border-gray-100 pt-3">
            <Skeleton className="h-5 w-14 rounded-md" />
            <Skeleton className="h-5 w-14 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
