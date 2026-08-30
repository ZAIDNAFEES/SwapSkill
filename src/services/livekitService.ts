/**
 * LiveKit Realtime Media Service
 * 
 * Provides deterministic room naming, WebSocket URL normalization, and secure server token acquisition
 * for 2-user real-time Live Swap audio/video sessions using LiveKit Cloud.
 */

import { auth } from "../firebase";
import { getApiUrl } from "../utils/apiConfig";

/**
 * Ensures the LiveKit server URL is a valid WebSocket URL starting with wss:// (or ws:// for local development).
 */
export function normalizeLiveKitUrl(url?: string): string {
  if (!url) return "";
  let clean = url.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  // Extract pure URL if multiple space-delimited tokens exist
  clean = clean.split(/\s+/)[0].trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (clean.startsWith("https://")) {
    clean = "wss://" + clean.slice(8);
  } else if (clean.startsWith("http://")) {
    clean = "ws://" + clean.slice(7);
  } else if (clean && !clean.startsWith("wss://") && !clean.startsWith("ws://")) {
    clean = "wss://" + clean;
  }
  return clean;
}

/**
 * Returns a deterministic, sanitised room identifier for any Swap Session.
 * Both caller and receiver connecting to the same session will ALWAYS get the identical room name.
 */
export function getDeterministicLiveKitRoomName(sessionId: string): string {
  const cleanId = (sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return `swapskill_live_${cleanId}`;
}

export interface LiveKitTokenResponse {
  token: string;
  serverUrl: string;
  roomName: string;
}

export async function fetchLiveKitToken(params: {
  sessionId: string;
  userId: string;
  userName: string;
  partnerUid?: string;
  sessionStatus?: string;
}): Promise<LiveKitTokenResponse> {
  const roomName = getDeterministicLiveKitRoomName(params.sessionId);

  console.log(`[LiveKit] TOKEN_REQUEST_STARTED: session=${params.sessionId}, user=${params.userId}, room=${roomName}`);

  // Retrieve current Firebase user ID token for authenticated verification if available
  let idToken: string | undefined;
  try {
    if (auth.currentUser) {
      idToken = await auth.currentUser.getIdToken();
    }
  } catch (err) {
    console.warn("[LiveKit] Could not retrieve Firebase ID token:", err);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (idToken) {
    headers["Authorization"] = `Bearer ${idToken}`;
  }

  const apiUrl = getApiUrl("/api/livekit/token");
  if (!apiUrl.startsWith("http") && typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.()) {
    console.warn(`[LiveKit] Warning: Making relative API request on native mobile without VITE_API_URL configured. Endpoint: ${apiUrl}`);
  }

  let response: Response;
  const payload = {
    roomName,
    sessionId: params.sessionId,
    userId: params.userId,
    userName: params.userName || "Skill Swap User",
    partnerUid: params.partnerUid,
    sessionStatus: params.sessionStatus,
    idToken,
  };

  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    // Fallback: If server rejects POST with 405, seamlessly retry using GET with query params
    if (response.status === 405) {
      console.warn(`[LiveKit] Received 405 on POST ${apiUrl}. Retrying with GET query parameters...`);
      const searchParams = new URLSearchParams();
      searchParams.set("roomName", roomName);
      searchParams.set("sessionId", params.sessionId);
      searchParams.set("userId", params.userId);
      searchParams.set("userName", params.userName || "Skill Swap User");
      if (params.partnerUid) searchParams.set("partnerUid", params.partnerUid);
      if (params.sessionStatus) searchParams.set("sessionStatus", params.sessionStatus);
      if (idToken) searchParams.set("idToken", idToken);

      const getUrl = `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}${searchParams.toString()}`;
      response = await fetch(getUrl, {
        method: "GET",
        headers,
      });
    }
  } catch (netErr: any) {
    console.error(`[LiveKit] NETWORK_ERROR connecting to ${apiUrl}:`, netErr);
    throw new Error(
      `Unable to reach backend token server at "${apiUrl}". Please verify your internet connection or check that VITE_API_URL points to your deployed backend.`
    );
  }

  const rawText = await response.text();
  let data: any = {};
  
  try {
    data = JSON.parse(rawText);
  } catch (_jsonErr) {
    // If an HTML document or SPA fallback was returned
    if (rawText.includes("<!DOCTYPE") || rawText.includes("<html") || rawText.includes("<!doctype")) {
      console.error(`[LiveKit] HTML returned instead of JSON from ${apiUrl} (Status ${response.status}). Response snippet:`, rawText.slice(0, 150));
      throw new Error(
        `Backend endpoint returned HTML instead of a JSON token (HTTP ${response.status}). If running on Android APK, ensure VITE_API_URL is configured to your deployed Vercel domain.`
      );
    }
    throw new Error(`Invalid response received from LiveKit backend (HTTP ${response.status}): ${rawText.slice(0, 100)}`);
  }

  if (!response.ok) {
    const message = data?.error || `Failed to fetch LiveKit token (HTTP ${response.status})`;
    console.error(`[LiveKit] TOKEN_REQUEST_FAILED: status=${response.status}, error=${message}`);
    throw new Error(message);
  }

  if (!data?.token || !data?.serverUrl) {
    throw new Error("Invalid token response received from LiveKit backend: missing token or serverUrl.");
  }

  const normalizedUrl = normalizeLiveKitUrl(data.serverUrl);
  console.log(`[LiveKit] TOKEN_RESPONSE_RECEIVED: room=${data.roomName}, serverUrl=${normalizedUrl}`);
  console.log(`[LiveKit] ROOM_NAME: ${data.roomName}`);

  return {
    token: data.token,
    serverUrl: normalizedUrl,
    roomName: data.roomName || roomName,
  };
}


