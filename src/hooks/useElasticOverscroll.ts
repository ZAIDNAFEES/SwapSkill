import { useEffect, useRef, RefObject } from "react";

export interface UseElasticOverscrollOptions {
  /** Scrollable container ref (overflow-y: auto) */
  scrollRef: RefObject<HTMLElement | null>;
  /** Inner content wrapper ref to stretch (falls back to scrollRef.firstElementChild) */
  targetRef?: RefObject<HTMLElement | null>;
  /** Allow elastic vertical stretch when pulling down at the top edge */
  allowTop?: boolean;
  /** Allow elastic vertical stretch when pulling up at the bottom edge */
  allowBottom?: boolean;
  /** Maximum additional Y scale factor (0.068 => up to scaleY(1.068)) */
  maxScaleDelta?: number;
  /** Damping resistance in px for asymptotic rubber-band feel */
  resistance?: number;
  /** Temporarily disable elastic overscroll */
  disabled?: boolean;
  /** Optional predicate checked per touch frame without restarting listeners */
  shouldIgnore?: () => boolean;
  /** Re-attach listeners cleanly when conditionally mounted views change */
  reattachKey?: string | number | boolean | null;
}

const INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[data-elastic-ignore='true']",
].join(",");

const AXIS_LOCK_THRESHOLD = 4;
const EDGE_TOLERANCE_PX = 2.5;

function hasScrollableNestedAncestor(
  target: HTMLElement | null,
  scroller: HTMLElement,
  dy: number
): boolean {
  let node: HTMLElement | null = target;
  while (node && node !== scroller) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 2) {
      if (dy > 0 && node.scrollTop > 2) return true;
      if (dy < 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 2) return true;
    }
    node = node.parentElement;
  }
  return false;
}

function clearElasticStyles(el: HTMLElement | null) {
  if (!el) return;
  el.style.transform = "";
  el.style.transition = "";
  el.style.transformOrigin = "";
  el.style.willChange = "";
}

/**
 * WhatsApp / Android 12+ style silky 60-120fps vertical elastic overscroll stretch.
 * Pure ref + requestAnimationFrame GPU transform mutations: zero React re-renders per frame.
 */
export function useElasticOverscroll({
  scrollRef,
  targetRef,
  allowTop = true,
  allowBottom = true,
  maxScaleDelta = 0.068,
  resistance = 185,
  disabled = false,
  shouldIgnore,
  reattachKey,
}: UseElasticOverscrollOptions) {
  const shouldIgnoreRef = useRef(shouldIgnore);
  shouldIgnoreRef.current = shouldIgnore;

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || disabled) return;
    if (!allowTop && !allowBottom) return;

    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const getTarget = (): HTMLElement | null => {
      return targetRef?.current ?? (scroller.firstElementChild as HTMLElement | null) ?? scroller;
    };

    let active = false;
    let axis: "none" | "vertical" | "horizontal" = "none";
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let edge: "top" | "bottom" | null = null;
    let overscrollRaw = 0;

    let rafId: number | null = null;
    let cleanupTimerId: number | null = null;
    let pendingEdge: "top" | "bottom" | null = null;
    let pendingScale = 1;
    let needsApply = false;

    const applyPendingFrame = () => {
      rafId = null;
      if (!needsApply) return;
      needsApply = false;
      const target = getTarget();
      if (!target) return;

      if (pendingEdge && pendingScale > 1.0005) {
        target.style.willChange = "transform";
        target.style.transition = "none";
        target.style.transformOrigin = pendingEdge === "top" ? "center top" : "center bottom";
        target.style.transform = `scaleY(${pendingScale.toFixed(4)}) translate3d(0, 0, 0)`;
      } else {
        clearElasticStyles(target);
      }
    };

    const scheduleFrame = (nextEdge: "top" | "bottom" | null, nextScale: number) => {
      pendingEdge = nextEdge;
      pendingScale = nextScale;
      needsApply = true;
      if (rafId === null) {
        rafId = requestAnimationFrame(applyPendingFrame);
      }
    };

    const springBack = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      needsApply = false;

      if (cleanupTimerId !== null) {
        window.clearTimeout(cleanupTimerId);
        cleanupTimerId = null;
      }

      const target = getTarget();
      const wasStretched =
        overscrollRaw > 0.5 ||
        Boolean(target && target.style.transform && target.style.transform !== "none");

      edge = null;
      overscrollRaw = 0;
      pendingEdge = null;
      pendingScale = 1;

      if (!target) return;

      if (wasStretched) {
        target.style.willChange = "transform";
        target.style.transition = "transform 360ms cubic-bezier(0.22, 1, 0.36, 1)";
        target.style.transform = "scaleY(1) translate3d(0, 0, 0)";
        cleanupTimerId = window.setTimeout(() => {
          cleanupTimerId = null;
          clearElasticStyles(getTarget());
        }, 380);
      } else {
        clearElasticStyles(target);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || shouldIgnoreRef.current?.()) {
        active = false;
        return;
      }

      const eventTarget = e.target as HTMLElement | null;
      if (eventTarget) {
        if (eventTarget.closest(INTERACTIVE_SELECTOR)) {
          active = false;
          return;
        }
        const targetDialog = eventTarget.closest("[role='dialog'], [aria-modal='true']");
        const scrollerDialog = scroller.closest("[role='dialog'], [aria-modal='true']");
        if (targetDialog && targetDialog !== scrollerDialog) {
          active = false;
          return;
        }
      }

      if (cleanupTimerId !== null) {
        window.clearTimeout(cleanupTimerId);
        cleanupTimerId = null;
      }

      const target = getTarget();
      if (target && target.style.transform) {
        clearElasticStyles(target);
      }

      const touch = e.touches[0];
      active = true;
      axis = "none";
      startX = touch.clientX;
      startY = touch.clientY;
      lastY = touch.clientY;
      edge = null;
      overscrollRaw = 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!active) return;

      if (shouldIgnoreRef.current?.()) {
        active = false;
        springBack();
        return;
      }

      if (e.touches.length !== 1) {
        active = false;
        springBack();
        return;
      }

      const touch = e.touches[0];
      const totalDx = touch.clientX - startX;
      const totalDy = touch.clientY - startY;

      if (axis === "none") {
        if (Math.abs(totalDx) < AXIS_LOCK_THRESHOLD && Math.abs(totalDy) < AXIS_LOCK_THRESHOLD) {
          return;
        }
        // Horizontal gestures (swipe-to-reply, carousels) abort vertical elastic immediately
        if (Math.abs(totalDx) > Math.abs(totalDy) * 0.9) {
          axis = "horizontal";
          active = false;
          return;
        }
        if (hasScrollableNestedAncestor(e.target as HTMLElement | null, scroller, totalDy)) {
          active = false;
          return;
        }
        axis = "vertical";
      }

      const stepDy = touch.clientY - lastY;
      lastY = touch.clientY;

      if (stepDy === 0 && edge === null) return;

      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const atTop = scroller.scrollTop <= EDGE_TOLERANCE_PX;
      const atBottom =
        maxScroll <= EDGE_TOLERANCE_PX
          ? scroller.scrollTop >= 0
          : scroller.scrollTop >= maxScroll - EDGE_TOLERANCE_PX;

      if (edge === "top") {
        overscrollRaw = Math.max(0, overscrollRaw + stepDy);
        if (overscrollRaw <= 0.5) {
          overscrollRaw = 0;
          edge = null;
          scheduleFrame(null, 1);
        } else {
          if (e.cancelable) e.preventDefault();
          const scale = 1 + maxScaleDelta * (1 - Math.exp(-overscrollRaw / resistance));
          scheduleFrame("top", scale);
        }
        return;
      }

      if (edge === "bottom") {
        overscrollRaw = Math.max(0, overscrollRaw - stepDy);
        if (overscrollRaw <= 0.5) {
          overscrollRaw = 0;
          edge = null;
          scheduleFrame(null, 1);
        } else {
          if (e.cancelable) e.preventDefault();
          const scale = 1 + maxScaleDelta * (1 - Math.exp(-overscrollRaw / resistance));
          scheduleFrame("bottom", scale);
        }
        return;
      }

      if (allowTop && atTop && stepDy > 0) {
        edge = "top";
        overscrollRaw = stepDy;
        if (e.cancelable) e.preventDefault();
        const scale = 1 + maxScaleDelta * (1 - Math.exp(-overscrollRaw / resistance));
        scheduleFrame("top", scale);
      } else if (allowBottom && atBottom && stepDy < 0) {
        edge = "bottom";
        overscrollRaw = -stepDy;
        if (e.cancelable) e.preventDefault();
        const scale = 1 + maxScaleDelta * (1 - Math.exp(-overscrollRaw / resistance));
        scheduleFrame("bottom", scale);
      }
    };

    const handleTouchEndOrCancel = () => {
      if (!active && overscrollRaw === 0) return;
      active = false;
      axis = "none";
      springBack();
    };

    scroller.addEventListener("touchstart", handleTouchStart, { passive: true });
    scroller.addEventListener("touchmove", handleTouchMove, { passive: false });
    scroller.addEventListener("touchend", handleTouchEndOrCancel, { passive: true });
    scroller.addEventListener("touchcancel", handleTouchEndOrCancel, { passive: true });

    return () => {
      scroller.removeEventListener("touchstart", handleTouchStart);
      scroller.removeEventListener("touchmove", handleTouchMove);
      scroller.removeEventListener("touchend", handleTouchEndOrCancel);
      scroller.removeEventListener("touchcancel", handleTouchEndOrCancel);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (cleanupTimerId !== null) {
        window.clearTimeout(cleanupTimerId);
      }
      clearElasticStyles(getTarget());
    };
  }, [
    scrollRef,
    targetRef,
    allowTop,
    allowBottom,
    maxScaleDelta,
    resistance,
    disabled,
    reattachKey,
  ]);
}
