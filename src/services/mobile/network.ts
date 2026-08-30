/**
 * Mobile Network Resilience & Connectivity Service
 * Monitors Online/Offline status, Wi-Fi ↔ Cellular transitions,
 * and triggers proactive LiveKit / Firestore re-sync when network returns.
 */

import { Network, ConnectionStatus } from "@capacitor/network";
import { Capacitor } from "@capacitor/core";

export type NetworkStatusChangeListener = (status: {
  connected: boolean;
  connectionType: string;
}) => void;

export class MobileNetworkService {
  private listeners: Set<NetworkStatusChangeListener> = new Set();
  private isOnlineState: boolean = true;
  private isInitialized = false;

  public async init() {
    if (this.isInitialized || typeof window === "undefined") return;
    this.isInitialized = true;

    if (Capacitor.isNativePlatform()) {
      try {
        const status = await Network.getStatus();
        this.isOnlineState = status.connected;

        Network.addListener("networkStatusChange", (status: ConnectionStatus) => {
          console.log(`[MobileNetwork] Native network status changed: connected=${status.connected}, type=${status.connectionType}`);
          this.isOnlineState = status.connected;
          this.notifyListeners({
            connected: status.connected,
            connectionType: status.connectionType,
          });
        });
      } catch (err) {
        console.warn("[MobileNetwork] Network plugin init error:", err);
      }
    }

    // Web Fallback
    window.addEventListener("online", () => {
      console.log("[MobileNetwork] Browser online event");
      this.isOnlineState = true;
      this.notifyListeners({ connected: true, connectionType: "wifi" });
    });

    window.addEventListener("offline", () => {
      console.log("[MobileNetwork] Browser offline event");
      this.isOnlineState = false;
      this.notifyListeners({ connected: false, connectionType: "none" });
    });

    this.isOnlineState = navigator.onLine;
  }

  public isOnline(): boolean {
    return this.isOnlineState;
  }

  public addListener(listener: NetworkStatusChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(status: { connected: boolean; connectionType: string }) {
    this.listeners.forEach((listener) => {
      try {
        listener(status);
      } catch (err) {
        console.error("[MobileNetwork] Error in listener:", err);
      }
    });
  }
}

export const mobileNetworkService = new MobileNetworkService();
