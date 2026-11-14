import React, { useCallback, useEffect, useRef, useState } from "react";

interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | void;
  children: React.ReactNode;
  className?: string;
  /** Minimum interval (ms) between real network refreshes to protect Firestore quota */
  cooldownMs?: number;
  /** Temporarily disable pull-to-refresh */
  disabled?: boolean;
  /** Optional class override for the top indicator slot */
  indicatorClassName?: string;
}

const THRESHOLD = 62;
const HOLD_HEIGHT = 54;
const MAX_PULL = 106;
const MIN_REFRESH_SPIN_MS = 620;
const REFRESH_TIMEOUT_MS = 7500;

const SPOKE_COUNT = 12;
const SPOKES = Array.from({ length: SPOKE_COUNT }, (_, i) => i);

const INTERACTIVE_OR_MODAL_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='dialog']",
  "[aria-modal='true']",
  "[data-ptr-ignore='true']",
  ".fixed.inset-0",
].join(",");

function hasActiveNestedVerticalScroll(target: HTMLElement | null, root: HTMLElement): boolean {
  let node: HTMLElement | null = target;
  while (node && node !== root) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 2) {
      if (node.scrollTop > 2) {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

export function PullToRefresh({
  onRefresh,
  children,
  className = "",
  cooldownMs = 20000,
  disabled = false,
  indicatorClassName = "",
}: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [pullY, setPullY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Refs for latest props & gesture state inside native listeners (zero rebind overhead)
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const cooldownMsRef = useRef(cooldownMs);
  cooldownMsRef.current = cooldownMs;

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const isRefreshingRef = useRef(isRefreshing);
  isRefreshingRef.current = isRefreshing;

  const lastServerRefreshRef = useRef<number>(0);
  const latestPullRef = useRef<number>(0);
  const hapticFiredRef = useRef<boolean>(false);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef<boolean>(true);

  const gestureRef = useRef<{
    phase: "idle" | "armed" | "pulling" | "cancelled";
    startX: number;
    startY: number;
  }>({
    phase: "idle",
    startX: 0,
    startY: 0,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const schedulePullY = useCallback((nextY: number) => {
    latestPullRef.current = nextY;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (mountedRef.current) {
        setPullY(nextY);
      }
    });
  }, []);

  const runRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    latestPullRef.current = HOLD_HEIGHT;
    setPullY(HOLD_HEIGHT);

    const startedAt = Date.now();
    const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;
    const outsideCooldown = startedAt - lastServerRefreshRef.current >= cooldownMsRef.current;

    try {
      if (outsideCooldown && isOnline) {
        lastServerRefreshRef.current = startedAt;
        await Promise.race([
          Promise.resolve(onRefreshRef.current()),
          new Promise<void>((resolve) => setTimeout(resolve, REFRESH_TIMEOUT_MS)),
        ]);
      }
    } catch (err) {
      console.warn("[PullToRefresh] Refresh notice:", err);
    }

    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, MIN_REFRESH_SPIN_MS - elapsed);
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remaining));
    }

    if (mountedRef.current) {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
      latestPullRef.current = 0;
      setPullY(0);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (disabledRef.current || isRefreshingRef.current || e.touches.length !== 1) {
        gestureRef.current.phase = "idle";
        return;
      }

      if (container.scrollTop > 2) {
        gestureRef.current.phase = "idle";
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target) {
        if (target.closest(INTERACTIVE_OR_MODAL_SELECTOR)) {
          gestureRef.current.phase = "cancelled";
          return;
        }
        if (hasActiveNestedVerticalScroll(target, container)) {
          gestureRef.current.phase = "cancelled";
          return;
        }
      }

      const touch = e.touches[0];
      gestureRef.current = {
        phase: "armed",
        startX: touch.clientX,
        startY: touch.clientY,
      };
      hapticFiredRef.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (g.phase === "idle" || g.phase === "cancelled" || isRefreshingRef.current || disabledRef.current) {
        return;
      }

      if (e.touches.length !== 1) {
        g.phase = "cancelled";
        setIsDragging(false);
        schedulePullY(0);
        return;
      }

      const touch = e.touches[0];
      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;

      if (g.phase === "armed") {
        // Small movement deadzone preserves native taps and clicks cleanly
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
          return;
        }

        // Cancel immediately on upward swipe (scrolling down), horizontal swipe, or non-top container
        if (container.scrollTop > 2 || dy <= 0 || Math.abs(dx) > Math.abs(dy) * 0.85) {
          g.phase = "cancelled";
          return;
        }

        g.phase = "pulling";
        setIsDragging(true);
      }

      if (g.phase === "pulling") {
        if (container.scrollTop > 2) {
          g.phase = "cancelled";
          setIsDragging(false);
          schedulePullY(0);
          return;
        }

        if (e.cancelable) {
          e.preventDefault();
        }

        const effectiveDy = Math.max(0, dy - 5);
        // Asymptotic iOS/Instagram rubber-band tension
        const nextPull = Math.round(MAX_PULL * (1 - Math.exp(-effectiveDy / 145)));

        if (nextPull >= THRESHOLD && !hapticFiredRef.current) {
          hapticFiredRef.current = true;
          try {
            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
              navigator.vibrate(8);
            }
          } catch (_) {
            // Silent no-op where haptics are unavailable
          }
        } else if (nextPull < THRESHOLD - 8 && hapticFiredRef.current) {
          hapticFiredRef.current = false;
        }

        schedulePullY(nextPull);
      }
    };

    const handleTouchEndOrCancel = () => {
      const g = gestureRef.current;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (g.phase === "pulling") {
        setIsDragging(false);
        if (latestPullRef.current >= THRESHOLD) {
          void runRefresh();
        } else {
          latestPullRef.current = 0;
          setPullY(0);
        }
      }

      g.phase = "idle";
      hapticFiredRef.current = false;
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEndOrCancel, { passive: true });
    container.addEventListener("touchcancel", handleTouchEndOrCancel, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEndOrCancel);
      container.removeEventListener("touchcancel", handleTouchEndOrCancel);
    };
  }, [runRefresh, schedulePullY]);

  // Reset cleanly if disabled becomes true mid-gesture
  useEffect(() => {
    if (disabled && !isRefreshingRef.current) {
      gestureRef.current.phase = "idle";
      setIsDragging(false);
      latestPullRef.current = 0;
      setPullY(0);
    }
  }, [disabled]);

  const progress = Math.min(1, Math.max(0, pullY / THRESHOLD));
  const showIndicator = pullY > 0 || isRefreshing;
  const thresholdReached = pullY >= THRESHOLD;
  const wheelRotationDeg = Math.round(progress * 150);
  const wheelScale = isRefreshing
    ? 1
    : thresholdReached
      ? 1.06
      : 0.76 + progress * 0.24;

  return (
    <div
      ref={containerRef}
      className={`overscroll-y-contain ${className}`}
    >
      {/* Top Instagram Activity Indicator Slot (zero height when idle, zero transform on children) */}
      <div
        aria-hidden={!showIndicator}
        className={`shrink-0 w-full overflow-hidden flex items-center justify-center pointer-events-none select-none ${
          isDragging ? "" : "transition-[height] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]"
        } ${indicatorClassName}`}
        style={{ height: `${pullY}px` }}
      >
        {showIndicator && (
          <div
            role={isRefreshing ? "status" : undefined}
            aria-label={isRefreshing ? "Refreshing" : undefined}
            className="flex items-center justify-center text-neutral-600 dark:text-neutral-300"
            style={{
              opacity: isRefreshing ? 1 : Math.min(1, progress * 1.25),
              transform: isRefreshing
                ? undefined
                : `scale(${wheelScale.toFixed(3)}) rotate(${wheelRotationDeg}deg)`,
              transition: isDragging ? undefined : "opacity 180ms ease, transform 200ms ease",
            }}
          >
            <svg
              viewBox="0 0 28 28"
              className={`w-7 h-7 ${isRefreshing ? "animate-ig-ptr-spin" : ""}`}
              fill="none"
            >
              {SPOKES.map((idx) => {
                const angle = idx * 30;
                const spokeThreshold = (idx + 1) / SPOKE_COUNT;
                const opacity = isRefreshing
                  ? Number((0.16 + ((idx + 1) / SPOKE_COUNT) * 0.84).toFixed(2))
                  : progress >= spokeThreshold
                    ? 0.95
                    : Math.max(0.12, 0.95 - (spokeThreshold - progress) * 4.5);

                return (
                  <line
                    key={idx}
                    x1="14"
                    y1="3.4"
                    x2="14"
                    y2="7.8"
                    stroke="currentColor"
                    strokeWidth="2.15"
                    strokeLinecap="round"
                    opacity={opacity}
                    transform={`rotate(${angle} 14 14)`}
                  />
                );
              })}
            </svg>
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
