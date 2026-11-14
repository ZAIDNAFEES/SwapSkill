import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

export interface KeyboardViewportInfo {
  isKeyboardOpen: boolean;
  keyboardHeight: number;
  keyboardInset: number;
  visualViewportHeight: number;
  lastKeyboardHeight: number;
}

const DEFAULT_KEYBOARD_HEIGHT = 290;

/**
 * Universal Mobile Keyboard & Viewport Inset hook
 * - Prevents duplicate bottom padding on Android WebViews where adjustResize / KeyboardResize.Body already resizes 100dvh.
 * - Ignores sub-90px system nav-bar / IME strip discrepancies between innerHeight and visualViewport.
 * - Remembers the user's real keyboard height so the docked emoji panel opens at the exact same height without layout jumps.
 */
export function useKeyboardViewport(): KeyboardViewportInfo {
  const [state, setState] = useState<KeyboardViewportInfo>({
    isKeyboardOpen: false,
    keyboardHeight: 0,
    keyboardInset: 0,
    visualViewportHeight: typeof window !== "undefined" ? window.innerHeight : 0,
    lastKeyboardHeight: DEFAULT_KEYBOARD_HEIGHT,
  });

  const nativeKeyboardHeightRef = useRef<number>(0);
  const nativeDidShowRef = useRef<boolean>(false);
  const maxInnerHeightRef = useRef<number>(typeof window !== "undefined" ? window.innerHeight : 0);
  const lastInnerWidthRef = useRef<number>(typeof window !== "undefined" ? window.innerWidth : 0);
  const lastKeyboardHeightRef = useRef<number>(DEFAULT_KEYBOARD_HEIGHT);

  useEffect(() => {
    if (typeof window === "undefined") return;

    maxInnerHeightRef.current = window.innerHeight;
    lastInnerWidthRef.current = window.innerWidth;

    let didShowFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const isAndroidNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

    const updateInsets = () => {
      const vv = window.visualViewport;
      const innerHeight = window.innerHeight;
      const innerWidth = window.innerWidth;
      const nativeHeight = nativeKeyboardHeightRef.current;

      // Reset max baseline cleanly on orientation / window width change
      if (Math.abs(innerWidth - lastInnerWidthRef.current) > 40) {
        lastInnerWidthRef.current = innerWidth;
        maxInnerHeightRef.current = innerHeight;
      } else if (nativeHeight === 0 && innerHeight > maxInnerHeightRef.current) {
        maxInnerHeightRef.current = innerHeight;
      }

      const layoutShrink = Math.max(0, Math.round(maxInnerHeightRef.current - innerHeight));
      const visualHeight = vv ? Math.round(vv.height) : innerHeight;
      const visualOffsetTop = vv ? Math.round(vv.offsetTop || 0) : 0;
      const visualGap = vv ? Math.max(0, Math.round(innerHeight - (visualHeight + visualOffsetTop))) : 0;

      let calculatedInset = 0;
      let isOpen = false;
      let visibleHeight = visualHeight;
      let activeKbHeight = 0;

      if (layoutShrink > 110) {
        // WebView / Browser layout viewport ALREADY shrunk (adjustResize / KeyboardResize.Body / interactive-widget=resizes-content).
        // Do NOT add keyboardInset even if Android nav-bar/IME causes a small 30-75px delta between innerHeight and visualViewport.height.
        isOpen = true;
        calculatedInset = 0;
        visibleHeight = innerHeight;
        activeKbHeight = nativeHeight >= 160 ? nativeHeight : layoutShrink;
      } else if (visualGap > 100) {
        // VisualViewport shrunk without shrinking the layout viewport (iOS Safari / WKWebView / overlay soft keyboard)
        isOpen = true;
        calculatedInset = visualGap;
        visibleHeight = visualHeight;
        activeKbHeight = Math.max(visualGap, nativeHeight);
      } else if (nativeHeight > 110 && (!isAndroidNative || nativeDidShowRef.current)) {
        // Fallback if native keyboard confirmed shown and viewport did not resize at all
        isOpen = true;
        calculatedInset = nativeHeight;
        visibleHeight = Math.max(200, innerHeight - nativeHeight);
        activeKbHeight = nativeHeight;
      } else {
        isOpen = false;
        calculatedInset = 0;
        visibleHeight = innerHeight;
      }

      if (isOpen && activeKbHeight >= 180 && activeKbHeight <= 460) {
        lastKeyboardHeightRef.current = activeKbHeight;
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
        keyboardHeight: activeKbHeight,
        keyboardInset: calculatedInset,
        visualViewportHeight: visibleHeight,
        lastKeyboardHeight: lastKeyboardHeightRef.current,
      });
    };

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", updateInsets);
      vv.addEventListener("scroll", updateInsets);
    }
    window.addEventListener("resize", updateInsets);

    let removeWillShow: (() => void) | undefined;
    let removeDidShow: (() => void) | undefined;
    let removeWillHide: (() => void) | undefined;
    let removeDidHide: (() => void) | undefined;

    if (Capacitor.isPluginAvailable("Keyboard")) {
      Keyboard.addListener("keyboardWillShow", (info) => {
        nativeKeyboardHeightRef.current = info.keyboardHeight;
        nativeDidShowRef.current = false;
        if (!isAndroidNative) {
          updateInsets();
        }
      }).then((handle) => {
        removeWillShow = () => handle.remove();
      }).catch(() => {});

      Keyboard.addListener("keyboardDidShow", (info) => {
        nativeKeyboardHeightRef.current = info.keyboardHeight;
        if (info.keyboardHeight >= 180 && info.keyboardHeight <= 460) {
          lastKeyboardHeightRef.current = info.keyboardHeight;
        }
        if (didShowFallbackTimer) clearTimeout(didShowFallbackTimer);
        if (isAndroidNative) {
          // Give WebView 60ms to complete adjustResize before deciding fallback inset
          didShowFallbackTimer = setTimeout(() => {
            nativeDidShowRef.current = true;
            updateInsets();
          }, 60);
        } else {
          nativeDidShowRef.current = true;
          updateInsets();
        }
      }).then((handle) => {
        removeDidShow = () => handle.remove();
      }).catch(() => {});

      Keyboard.addListener("keyboardWillHide", () => {
        if (didShowFallbackTimer) clearTimeout(didShowFallbackTimer);
        nativeKeyboardHeightRef.current = 0;
        nativeDidShowRef.current = false;
        updateInsets();
      }).then((handle) => {
        removeWillHide = () => handle.remove();
      }).catch(() => {});

      Keyboard.addListener("keyboardDidHide", () => {
        if (didShowFallbackTimer) clearTimeout(didShowFallbackTimer);
        nativeKeyboardHeightRef.current = 0;
        nativeDidShowRef.current = false;
        updateInsets();
      }).then((handle) => {
        removeDidHide = () => handle.remove();
      }).catch(() => {});
    }

    updateInsets();

    return () => {
      if (didShowFallbackTimer) clearTimeout(didShowFallbackTimer);
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
