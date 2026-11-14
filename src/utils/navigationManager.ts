import { useEffect } from "react";
import { TabType } from "../components/Navigation";

export interface NavState {
  tab: TabType;
  selectedUserId?: string | null;
  activeChatId?: string | null;
  isMessageRequests?: boolean;
}

type OverlayBackHandler = () => boolean;

class NavigationManager {
  private overlayStack: OverlayBackHandler[] = [];
  private navHistory: NavState[] = [
    { tab: "home", selectedUserId: null, activeChatId: null, isMessageRequests: false }
  ];
  private stateChangeListeners: ((state: NavState) => void)[] = [];
  private isPopping = false;

  constructor() {
    if (typeof window !== "undefined") {
      // Listen to popstate for browser/device back navigation
      window.addEventListener("popstate", () => {
        if (this.isPopping) return;
        this.handleBack(true);
      });
    }
  }

  /**
   * Register a back handler for an open overlay, modal, sheet, or drawer.
   * Returns a cleanup unregister function.
   */
  public registerOverlayHandler(handler: OverlayBackHandler): () => void {
    this.overlayStack.push(handler);
    return () => {
      this.overlayStack = this.overlayStack.filter((h) => h !== handler);
    };
  }

  /**
   * Push a new navigation state (e.g. tab switch, user profile open, chat open, requests open)
   */
  public pushState(nextState: Partial<NavState>) {
    const currentState = this.getCurrentState();
    const resolved: NavState = {
      tab: nextState.tab || currentState.tab,
      selectedUserId: nextState.selectedUserId !== undefined ? nextState.selectedUserId : currentState.selectedUserId,
      activeChatId: nextState.activeChatId !== undefined ? nextState.activeChatId : currentState.activeChatId,
      isMessageRequests: nextState.isMessageRequests !== undefined ? nextState.isMessageRequests : currentState.isMessageRequests
    };

    // Avoid duplicate identical pushes on the top of stack
    if (this.isEqual(currentState, resolved)) {
      return;
    }

    this.navHistory.push(resolved);

    if (typeof window !== "undefined" && window.history) {
      try {
        window.history.pushState({ navIndex: this.navHistory.length - 1 }, "");
      } catch (_) {}
    }

    this.notifyStateChange(resolved);
  }

  /**
   * Replace current navigation state without adding a new step
   */
  public replaceCurrentState(nextState: Partial<NavState>) {
    const currentState = this.getCurrentState();
    const resolved: NavState = {
      ...currentState,
      ...nextState
    };
    if (this.navHistory.length > 0) {
      this.navHistory[this.navHistory.length - 1] = resolved;
    } else {
      this.navHistory.push(resolved);
    }
    this.notifyStateChange(resolved);
  }

  /**
   * Reset navigation history to a specific root state (e.g. on login)
   */
  public resetTo(state: NavState) {
    this.navHistory = [state];
    this.overlayStack = [];
    this.notifyStateChange(state);
  }

  public getCurrentState(): NavState {
    if (this.navHistory.length === 0) {
      return { tab: "home", selectedUserId: null, activeChatId: null, isMessageRequests: false };
    }
    return this.navHistory[this.navHistory.length - 1];
  }

  public getHistoryLength(): number {
    return this.navHistory.length;
  }

  public onStateChange(listener: (state: NavState) => void): () => void {
    this.stateChangeListeners.push(listener);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter((l) => l !== listener);
    };
  }

  private notifyStateChange(state: NavState) {
    this.stateChangeListeners.forEach((l) => {
      try {
        l(state);
      } catch (err) {
        console.error("Error in nav listener:", err);
      }
    });
  }

  /**
   * Universal One-Step Back Handler.
   * 1. Closes topmost open modal/sheet/drawer if present.
   * 2. Otherwise pops exactly one navigation step from history.
   * 3. Returns true if handled, false if at the root and nothing to pop.
   */
  public handleBack(isFromPopState = false): boolean {
    // 1. Check overlays / modals first (top of stack)
    while (this.overlayStack.length > 0) {
      const topHandler = this.overlayStack.pop();
      if (topHandler) {
        try {
          const handled = topHandler();
          if (handled) {
            return true;
          }
        } catch (err) {
          console.error("Error running overlay back handler:", err);
        }
      }
    }

    // 2. Check navigation history
    if (this.navHistory.length > 1) {
      this.isPopping = true;
      this.navHistory.pop(); // Pop top state
      const prevState = this.getCurrentState();

      if (!isFromPopState && typeof window !== "undefined" && window.history) {
        try {
          // Keep browser history consistent
        } catch (_) {}
      }

      this.notifyStateChange(prevState);
      setTimeout(() => {
        this.isPopping = false;
      }, 50);
      return true;
    }

    // 3. We are at root screen (e.g. Tab: home with no profile/chat)
    return false;
  }

  /**
   * Explicitly pop the top navigation state (e.g., Back button clicked in header)
   */
  public popState(): boolean {
    return this.handleBack(false);
  }

  private isEqual(a: NavState, b: NavState): boolean {
    return (
      a.tab === b.tab &&
      (a.selectedUserId || null) === (b.selectedUserId || null) &&
      (a.activeChatId || null) === (b.activeChatId || null) &&
      Boolean(a.isMessageRequests) === Boolean(b.isMessageRequests)
    );
  }
}

export const navigationManager = new NavigationManager();
export default navigationManager;

/**
 * Custom React Hook to register back button interception for any modal/sheet/drawer/popup.
 * When active, pressing Android hardware Back or universal Back will call onBack and prevent page pop.
 */
export function useBackHandler(isActive: boolean, onBack: () => boolean | void) {
  useEffect(() => {
    if (!isActive) return;
    const unregister = navigationManager.registerOverlayHandler(() => {
      const result = onBack();
      return result !== false;
    });
    return () => {
      unregister();
    };
  }, [isActive, onBack]);
}
