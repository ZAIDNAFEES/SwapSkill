/**
 * Mobile Deep Linking & Notification Navigation Service
 * Routes native local notification taps, universal links, and app URL schemes
 * directly to the target session or Live Swap screen.
 */

import { App, URLOpenListenerEvent } from "@capacitor/app";
import { LocalNotifications, ActionPerformed } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";
import { callSignalingService } from "../callSignalingService";
import { stopIncomingCallRingtone } from "../../utils/sound";

export type DeepLinkNavigationHandler = (routeData: {
  type: "session" | "live_call" | "tab" | "chat" | "call";
  sessionId?: string;
  tabName?: string;
  chatId?: string;
  callId?: string;
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
      App.getLaunchUrl().then((launchUrl) => {
        if (launchUrl?.url) {
          console.log(`[MobileDeepLink] Cold launch via URL: ${launchUrl.url}`);
          this.processDeepLinkUrl(launchUrl.url);
        }
      }).catch((err) => {
        console.warn("[MobileDeepLink] Failed to get launch URL:", err);
      });

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
          const chatId = extra.chatId;
          const callId = extra.callId;

          if (callId) {
            if (notificationAction.actionId === "decline") {
              console.log("[MobileDeepLink] Call declined via notification action:", callId);
              stopIncomingCallRingtone();
              callSignalingService.rejectCall(callId, "Call declined from notification", sessionId);
              return;
            }
            if (this.handler) {
              this.handler({
                type: "call",
                callId,
                sessionId,
                autoJoinLive: notificationAction.actionId === "accept",
              });
            }
          } else if (chatId && this.handler) {
            this.handler({
              type: "chat",
              chatId,
              tabName: "messages",
            });
          } else if (sessionId && this.handler) {
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
      // swapskill://chat/CHAT_ID
      // swapskill://call/CALL_ID?sessionId=SESSION_ID
      // https://swapskill.app/session/SESSION_ID
      const parsed = new URL(url);
      const pathname = parsed.pathname || "";
      const host = parsed.host || "";

      let sessionId = "";
      let isLive = false;

      if (host === "chat" || pathname.includes("/chat/")) {
        const chatId = pathname.split("/chat/")[1] || pathname.replace(/^\//, "");
        if (chatId && this.handler) {
          this.handler({
            type: "chat",
            chatId: decodeURIComponent(chatId),
            tabName: "messages",
          });
          return;
        }
      } else if (host === "call" || pathname.includes("/call/")) {
        const callId = pathname.split("/call/")[1]?.split("?")[0] || pathname.replace(/^\//, "");
        const querySessionId = parsed.searchParams?.get("sessionId") || "";
        const autoAccept = parsed.searchParams?.get("autoAccept") === "true";
        if (callId && this.handler) {
          this.handler({
            type: "call",
            callId: decodeURIComponent(callId),
            sessionId: querySessionId,
            autoJoinLive: autoAccept,
          });
          return;
        }
      } else if (host === "session" || pathname.includes("/session/")) {
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
