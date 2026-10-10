import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

export interface KeyboardViewportInfo {
  isKeyboardOpen: boolean;
  keyboardHeight: number;
  keyboardInset: number;
  visualViewportHeight: number;
}

/**
 * Universal Mobile Keyboard & Viewport Inset hook
 * Handles viewport resize, visualViewport shifts, Capacitor native keyboard events,
 * and eliminates unwanted gaps and header clipping.
 */
export function useKeyboardViewport(): KeyboardViewportInfo {
  const [state, setState] = useState<KeyboardViewportInfo>({
    isKeyboardOpen: false,
    keyboardHeight: 0,
    keyboardInset: 0,
    visualViewportHeight: typeof window !== "undefined" ? window.innerHeight : 0,
  });

  const nativeKeyboardHeightRef = useRef<number>(0);
  const initialInnerHeightRef = useRef<number>(typeof window !== "undefined" ? window.innerHeight : 0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    initialInnerHeightRef.current = window.innerHeight;

    const updateInsets = () => {
      const vv = window.visualViewport;
      const innerHeight = window.innerHeight;
      const nativeHeight = nativeKeyboardHeightRef.current;

      let calculatedInset = 0;
      let isOpen = false;
      let visibleHeight = innerHeight;

      if (vv) {
        // Visual Viewport is available (Standard in modern Mobile Chrome, Android WebView, iOS Safari/WKWebView)
        const visualHeight = Math.round(vv.height);
        visibleHeight = visualHeight;
        const visualOffsetTop = vv.offsetTop || 0;
        const layoutHeight = innerHeight;

        // Gap between layout bottom and visual bottom
        const bottomGap = Math.max(0, Math.round(layoutHeight - (visualHeight + visualOffsetTop)));

        // Did the window's layout viewport itself shrink? (e.g. interactive-widget=resizes-content)
        const isLayoutViewportShrunk = layoutHeight < initialInnerHeightRef.current - 100;

        if (bottomGap > 30) {
          // Viewport did NOT shrink (e.g. iOS WKWebView or Android overlay keyboard)
          calculatedInset = bottomGap;
          isOpen = true;
        } else if (isLayoutViewportShrunk) {
          // Viewport shrunk naturally
          calculatedInset = 0;
          isOpen = true;
        } else if (nativeHeight > 50) {
          // Native Capacitor reported height
          calculatedInset = nativeHeight;
          visibleHeight = Math.max(200, innerHeight - nativeHeight);
          isOpen = true;
        } else {
          calculatedInset = 0;
          isOpen = false;
        }
      } else if (nativeHeight > 50) {
        calculatedInset = nativeHeight;
        visibleHeight = Math.max(200, innerHeight - nativeHeight);
        isOpen = true;
      } else {
        const diff = initialInnerHeightRef.current - innerHeight;
        if (diff > 120) {
          calculatedInset = 0;
          isOpen = true;
          visibleHeight = innerHeight;
        } else {
          calculatedInset = 0;
          isOpen = false;
          visibleHeight = innerHeight;
        }
      }

      // Prevent mobile browsers from scrolling document body/window when keyboard opens
      if (isOpen && (window.scrollY > 0 || document.documentElement.scrollTop > 0)) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }

      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty("--app-visible-height", `${visibleHeight}px`);
      }

      setState({
        isKeyboardOpen: isOpen,
        keyboardHeight: Math.max(calculatedInset, nativeHeight),
        keyboardInset: calculatedInset,
        visualViewportHeight: visibleHeight,
      });
    };

    // 1. Visual Viewport listeners
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", updateInsets);
      vv.addEventListener("scroll", updateInsets);
    }
    window.addEventListener("resize", updateInsets);

    // 2. Capacitor native keyboard listeners (Android APK & iOS)
    let removeWillShow: (() => void) | undefined;
    let removeDidShow: (() => void) | undefined;
    let removeWillHide: (() => void) | undefined;
    let removeDidHide: (() => void) | undefined;

    if (Capacitor.isPluginAvailable("Keyboard")) {
      Keyboard.addListener("keyboardWillShow", (info) => {
        nativeKeyboardHeightRef.current = info.keyboardHeight;
        updateInsets();
      }).then((handle) => {
        removeWillShow = () => handle.remove();
      }).catch(() => {});

      Keyboard.addListener("keyboardDidShow", (info) => {
        nativeKeyboardHeightRef.current = info.keyboardHeight;
        updateInsets();
      }).then((handle) => {
        removeDidShow = () => handle.remove();
      }).catch(() => {});

      Keyboard.addListener("keyboardWillHide", () => {
        nativeKeyboardHeightRef.current = 0;
        updateInsets();
      }).then((handle) => {
        removeWillHide = () => handle.remove();
      }).catch(() => {});

      Keyboard.addListener("keyboardDidHide", () => {
        nativeKeyboardHeightRef.current = 0;
        updateInsets();
      }).then((handle) => {
        removeDidHide = () => handle.remove();
      }).catch(() => {});
    }

    // Initial check
    updateInsets();

    return () => {
      if (vv) {
        vv.removeEventListener("resize", updateInsets);
        vv.removeEventListener("scroll", updateInsets);
      }
      window.removeEventListener("resize", updateInsets);
      if (removeWillShow) removeWillShow();
      if (removeDidShow) removeDidShow();
      if (removeWillHide) removeWillHide();
      if (removeDidHide) removeDidHide();
    };
  }, []);

  return state;
}
