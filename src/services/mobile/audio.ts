/**
 * Mobile Audio Output & Routing Manager
 * Provides reliable speakerphone, earpiece, and Bluetooth headset routing
 * during LiveKit WebRTC audio/video calls.
 */

import { Capacitor } from "@capacitor/core";

export type AudioOutputMode = "speaker" | "earpiece" | "bluetooth" | "default";

export class MobileAudioRoutingService {
  private currentMode: AudioOutputMode = "speaker";

  /**
   * Returns current audio route
   */
  public getCurrentRoute(): AudioOutputMode {
    return this.currentMode;
  }

  /**
   * Requests audio routing to speakerphone or earpiece
   */
  public async setAudioRoute(
    mode: AudioOutputMode,
    audioElement?: HTMLAudioElement | null
  ): Promise<boolean> {
    this.currentMode = mode;

    // 1. If Native Android / iOS Bridge is present
    if (typeof window !== "undefined") {
      const win = window as any;
      if (win.AndroidAudioBridge?.setSpeakerphoneOn) {
        try {
          win.AndroidAudioBridge.setSpeakerphoneOn(mode === "speaker");
          return true;
        } catch (e) {
          console.warn("[AudioRouting] AndroidAudioBridge error:", e);
        }
      }
      if (win.webkit?.messageHandlers?.audioBridge?.postMessage) {
        try {
          win.webkit.messageHandlers.audioBridge.postMessage({
            action: "setAudioRoute",
            route: mode,
          });
          return true;
        } catch (e) {
          console.warn("[AudioRouting] iOS audioBridge error:", e);
        }
      }
    }

    // 2. Web Audio output sink ID (supported in Chrome/Chromium Android)
    if (audioElement && "setSinkId" in audioElement) {
      try {
        const devices = await navigator.mediaDevices?.enumerateDevices?.();
        if (devices) {
          const audioOutputs = devices.filter((d) => d.kind === "audiooutput");
          if (mode === "speaker") {
            const speaker = audioOutputs.find((d) =>
              d.label.toLowerCase().includes("speaker") || d.label.toLowerCase().includes("lautsprecher")
            );
            if (speaker?.deviceId) {
              await (audioElement as any).setSinkId(speaker.deviceId);
              return true;
            }
          } else if (mode === "earpiece") {
            const earpiece = audioOutputs.find((d) =>
              d.label.toLowerCase().includes("earpiece") || d.label.toLowerCase().includes("receiver")
            );
            if (earpiece?.deviceId) {
              await (audioElement as any).setSinkId(earpiece.deviceId);
              return true;
            }
          }
          // Default sink
          await (audioElement as any).setSinkId("");
          return true;
        }
      } catch (e) {
        console.warn("[AudioRouting] setSinkId error:", e);
      }
    }

    return true;
  }

  /**
   * Enumerate available audio output devices
   */
  public async getAvailableAudioDevices(): Promise<{ id: string; label: string; mode: AudioOutputMode }[]> {
    const list: { id: string; label: string; mode: AudioOutputMode }[] = [
      { id: "speaker", label: "Loud Speaker", mode: "speaker" },
      { id: "earpiece", label: "Phone Earpiece", mode: "earpiece" },
    ];

    if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter((d) => d.kind === "audiooutput");
        outputs.forEach((dev, idx) => {
          const lbl = dev.label || `Audio Device ${idx + 1}`;
          const isBT = lbl.toLowerCase().includes("bluetooth") || lbl.toLowerCase().includes("headset");
          list.push({
            id: dev.deviceId || `device-${idx}`,
            label: lbl,
            mode: isBT ? "bluetooth" : "default",
          });
        });
      } catch (e) {
        // Enumerate not permitted or failed
      }
    }

    return list;
  }
}

export const mobileAudioRoutingService = new MobileAudioRoutingService();
