/**
 * Mobile Deep Linking & Notification Navigation Service
 * Routes native local notification taps, universal links, and app URL schemes
 * directly to the target session or Live Swap screen.
 */

import { App, URLOpenListenerEvent } from "@capacitor/app";
import { LocalNotifications, ActionPerformed } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";

export type DeepLinkNavigationHandler = (routeData: {
  type: "session" | "live_call" | "tab";
  sessionId?: string;
  tabName?: string;
  autoJoinLive?: boolean;
}) => void;

export class MobileDeepLinkService {
  private handler: DeepLinkNavigationHandler | null = null;
  private isInitialized = false;

  public init(navigationHandler: DeepLinkNavigationHandler) {
    this.handler = navigationHandler;
    if (this.isInitialized || typeof window === "undefined") return;
    this.isInitialized = true;

    // 1. Handle Native App URL Openings (Universal Links & Custom Schemes)
    if (Capacitor.isNativePlatform()) {
      App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
        console.log(`[MobileDeepLink] App opened via URL: ${event.url}`);
        this.processDeepLinkUrl(event.url);
      });

      // 2. Handle Local Notification Action Taps
      LocalNotifications.addListener(
        "localNotificationActionPerformed",
        (notificationAction: ActionPerformed) => {
          console.log(
            `[MobileDeepLink] Notification action performed: actionId=${notificationAction.actionId}`,
            notificationAction.notification
          );
          const extra = notificationAction.notification.extra || {};
          const sessionId = extra.sessionId;
          const isLive = extra.isLive;

          if (sessionId && this.handler) {
            this.handler({
              type: isLive ? "live_call" : "session",
              sessionId,
              autoJoinLive: isLive || notificationAction.actionId === "join",
            });
          }
        }
      );
    }
  }

  public processDeepLinkUrl(url: string) {
    try {
      // Examples:
      // swapskill://session/SESSION_ID
      // swapskill://live/SESSION_ID
      // https://swapskill.app/session/SESSION_ID
      const parsed = new URL(url);
      const pathname = parsed.pathname || "";
      const host = parsed.host || "";

      let sessionId = "";
      let isLive = false;

      if (host === "session" || pathname.includes("/session/")) {
        sessionId = pathname.split("/session/")[1] || pathname.replace(/^\//, "");
      } else if (host === "live" || pathname.includes("/live/")) {
        sessionId = pathname.split("/live/")[1] || pathname.replace(/^\//, "");
        isLive = true;
      }

      if (sessionId && this.handler) {
        this.handler({
          type: isLive ? "live_call" : "session",
          sessionId,
          autoJoinLive: isLive,
        });
      }
    } catch (err) {
      console.warn("[MobileDeepLink] Failed to parse URL:", url, err);
    }
  }
}

export const mobileDeepLinkService = new MobileDeepLinkService();
