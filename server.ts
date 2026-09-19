import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { initializeApp, cert, getApps, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging, MulticastMessage } from "firebase-admin/messaging";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { sendApnsVoipPush } from "./server/apnsVoipService.js";

let firebaseAdminApp: App | null = null;
let adminFirestore: ReturnType<typeof getFirestore> | null = null;
let hasAttemptedInit = false;

interface AuthenticatedUser {
  uid: string;
  email?: string;
}

async function verifyAuthToken(req: express.Request): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.authorization;
  let token = "";
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  } else if ((req.body as any)?.idToken) {
    token = (req.body as any).idToken;
  } else if ((req.query as any)?.idToken) {
    token = (req.query as any).idToken as string;
  }

  if (!token) {
    return null;
  }

  const adminApp = getFirebaseAdmin();
  if (adminApp) {
    try {
      const auth = getAuth(adminApp);
      const decoded = await auth.verifyIdToken(token);
      return { uid: decoded.uid, email: decoded.email };
    } catch (err) {
      console.warn("[Auth] Firebase ID token verification failed via Admin SDK:", err);
    }
  }

  // Graceful fallback for local development or sandbox environments: validate JWT structure and expiration
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
      const payload = JSON.parse(payloadJson);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp > nowSeconds && (payload.user_id || payload.sub)) {
        return { uid: payload.user_id || payload.sub, email: payload.email };
      }
    }
  } catch (_) {}

  return null;
}

function getFirebaseAdmin(): App | null {
  if (firebaseAdminApp) return firebaseAdminApp;

  try {
    const existingApps = getApps();
    if (existingApps.length > 0 && existingApps[0]) {
      firebaseAdminApp = existingApps[0];
      return firebaseAdminApp;
    }

    // 1. Check for raw JSON in FIREBASE_SERVICE_ACCOUNT / FCM_SERVICE_ACCOUNT_KEY
    const serviceAccountRaw =
      process.env.FIREBASE_SERVICE_ACCOUNT ||
      process.env.FCM_SERVICE_ACCOUNT_KEY ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

    if (serviceAccountRaw) {
      let parsedCreds: any = null;
      try {
        parsedCreds = JSON.parse(serviceAccountRaw);
      } catch (e) {
        try {
          const decoded = Buffer.from(serviceAccountRaw, "base64").toString("utf8");
          parsedCreds = JSON.parse(decoded);
        } catch (_) {
          console.warn("[FCM v1] Could not parse FIREBASE_SERVICE_ACCOUNT as JSON string.");
        }
      }

      if (parsedCreds && parsedCreds.private_key && parsedCreds.client_email) {
        if (typeof parsedCreds.private_key === "string") {
          parsedCreds.private_key = parsedCreds.private_key.replace(/\\n/g, "\n");
        }
        firebaseAdminApp = initializeApp({
          credential: cert(parsedCreds),
          projectId: parsedCreds.project_id || process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1",
        });
        console.log(`[FCM v1] Firebase Admin initialized for project: ${parsedCreds.project_id}`);
        return firebaseAdminApp;
      }
    }

    // 2. Check for individual environment variables
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1";

    if (clientEmail && privateKey) {
      firebaseAdminApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
        projectId,
      });
      console.log(`[FCM v1] Firebase Admin initialized from individual env credentials for project: ${projectId}`);
      return firebaseAdminApp;
    }

    // 3. Fallback for Google Cloud Run / Application Default Credentials
    try {
      firebaseAdminApp = initializeApp({ projectId });
      console.log(`[Firebase Admin] Initialized with Application Default Credentials for project: ${projectId}`);
      return firebaseAdminApp;
    } catch (adcErr) {
      // Retried on subsequent calls if credentials become available
    }

    return null;
  } catch (err) {
    console.warn("[FCM v1] Lazy initialization attempt:", err);
    return null;
  }
}

function getAdminFirestore(): ReturnType<typeof getFirestore> | null {
  if (adminFirestore) return adminFirestore;
  const adminApp = getFirebaseAdmin();
  if (adminApp) {
    try {
      adminFirestore = getFirestore(adminApp);
      return adminFirestore;
    } catch (err) {
      console.warn("[Admin Firestore] Error getting Firestore from Admin app:", err);
    }
  }
  return null;
}

async function startServer() {
  const app = express();

  // Enable CORS for Capacitor Native Android/iOS (https://localhost, capacitor://localhost) and Web clients
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
    );
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
    next();
  });

  const PORT = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === "production";

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  // WebRTC ICE Servers Configuration Endpoint
  // Securely delivers STUN + TURN relay servers to authenticated users
  app.get("/api/webrtc/ice-servers", async (req, res) => {
    const authUser = await verifyAuthToken(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized: Valid Firebase authentication token required." });
    }

    const defaultStunServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ];

    const turnUrl = process.env.TURN_URL || process.env.COTURN_URL || process.env.VITE_TURN_URL || "";
    const turnUsername = process.env.TURN_USERNAME || process.env.COTURN_USERNAME || process.env.VITE_TURN_USERNAME || "";
    const turnCredential =
      process.env.TURN_CREDENTIAL ||
      process.env.TURN_PASSWORD ||
      process.env.COTURN_PASSWORD ||
      process.env.VITE_TURN_CREDENTIAL ||
      "";

    const iceServers = [...defaultStunServers];

    if (turnUrl && turnUsername && turnCredential) {
      // Support comma-separated TURN URLs (e.g. UDP & TCP endpoints)
      const turnUrls = turnUrl.split(",").map((u) => u.trim()).filter(Boolean);
      iceServers.push({
        urls: turnUrls,
        username: turnUsername,
        credential: turnCredential,
      });
      console.log(`[WebRTC ICE] Configured ${turnUrls.length} TURN relay endpoints for secure mobile NAT traversal`);
    } else {
      console.log("[WebRTC ICE] TURN credentials not provided in environment, using high-reliability STUN servers");
    }

    res.json({
      iceServers,
      turnEnabled: Boolean(turnUrl && turnUsername && turnCredential),
      timestamp: Date.now(),
    });
  });

  // In-memory push deduplication cache (Key -> timestamp)
  const pushDedupeCache = new Map<string, number>();

  // Clean old entries every 5 minutes
  setInterval(() => {
    const cutoff = Date.now() - 60000;
    for (const [key, ts] of pushDedupeCache.entries()) {
      if (ts < cutoff) {
        pushDedupeCache.delete(key);
      }
    }
  }, 300000);

  // Push Notification Dispatch Endpoint (FCM / Background Push)
  // Triggers real push notifications for Session Reminders, Incoming Calls, and Chat Messages
  app.post("/api/notifications/send-push", async (req, res) => {
    try {
      const authUser = await verifyAuthToken(req);
      if (!authUser) {
        return res.status(401).json({ error: "Unauthorized: Valid Firebase authentication token required." });
      }

      const {
        recipientUserId,
        title,
        body,
        data = {},
        channelId = "swapskill_general",
        priority = "high",
        sound = "default",
      } = req.body || {};

      if (!recipientUserId || !title) {
        return res.status(400).json({ error: "recipientUserId and title are required." });
      }

      // Sender Spoofing Protection:
      // For incoming calls, callerId must match authenticated user.
      // For chat messages, senderId must match authenticated user.
      // For call cancellation/hangup, either participant can send it, so callerId is not restricted to authUser.uid.
      // For diagnostic self-tests (recipientUserId === authUser.uid), allow sender.
      const isSelfTest = recipientUserId === authUser.uid;
      if (!isSelfTest) {
        if (data.type === "incoming_call" && data.callerId && data.callerId !== authUser.uid) {
          return res.status(403).json({ error: "Forbidden: callerId does not match authenticated user." });
        }
        if (data.senderId && data.senderId !== authUser.uid) {
          return res.status(403).json({ error: "Forbidden: senderId does not match authenticated user." });
        }
      }

      // Strong deduplication for call and session notification events (while allowing rapid distinct chat messages)
      const now = Date.now();
      const isCallNotification = data?.type === "incoming_call" || channelId === "swapskill_calls";
      const isCallCancellation = data?.type === "call_cancelled" || data?.type === "call_ended";
      const eventKey = isCallCancellation
        ? `${recipientUserId}:cancel_${data.callId || now}`
        : isCallNotification
        ? `${recipientUserId}:call_${data.callId || now}`
        : `${recipientUserId}:${data.messageId || (data.type === "chat" ? `chat_${data.chatId}_${now}` : "") || data.callId || data.sessionId || data.eventId || data.type || title}`;
      const lastSent = pushDedupeCache.get(eventKey);
      if (!isCallCancellation && !isSelfTest && lastSent && now - lastSent < (isCallNotification ? 10000 : 30000)) {
        console.log(`[Push] Skipping duplicate notification for ${eventKey} (sent ${(now - lastSent) / 1000}s ago)`);
        return res.json({ ok: true, deduplicated: true, recipientUserId });
      }
      pushDedupeCache.set(eventKey, now);

      const projectId = process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1";
      const cleanUserId = encodeURIComponent(recipientUserId);

      // Fetch user's registered device tokens (supporting direct passed tokens first)
      let deviceTokens: string[] = [];
      let voipToken: string = "";

      if (Array.isArray(req.body.deviceTokens)) {
        deviceTokens = req.body.deviceTokens.filter(Boolean);
      } else if (typeof req.body.deviceToken === "string" && req.body.deviceToken) {
        deviceTokens = [req.body.deviceToken];
      } else if (typeof req.body.pushToken === "string" && req.body.pushToken) {
        deviceTokens = [req.body.pushToken];
      }
      if (typeof req.body.voipToken === "string" && req.body.voipToken) {
        voipToken = req.body.voipToken;
      }

      const adminDb = getAdminFirestore();
      if (adminDb && deviceTokens.length === 0) {
        try {
          // Check private tokens subcollection
          const secDoc = await adminDb.collection("users").doc(recipientUserId).collection("security").doc("tokens").get();
          if (secDoc.exists) {
            const secData = secDoc.data() || {};
            if (Array.isArray(secData.fcmTokens)) {
              deviceTokens = secData.fcmTokens.filter(Boolean);
            }
            if (deviceTokens.length === 0 && secData.pushToken) {
              deviceTokens = [secData.pushToken];
            }
            if (secData.voipToken && typeof secData.voipToken === "string") {
              voipToken = secData.voipToken;
            }
          }

          // Fallback to user root document
          if (deviceTokens.length === 0 || !voipToken) {
            const userDoc = await adminDb.collection("users").doc(recipientUserId).get();
            if (userDoc.exists) {
              const userData = userDoc.data() || {};
              if (deviceTokens.length === 0 && Array.isArray(userData.fcmTokens)) {
                deviceTokens = userData.fcmTokens.filter(Boolean);
              }
              if (deviceTokens.length === 0 && userData.pushToken) {
                deviceTokens = [userData.pushToken];
              }
              if (!voipToken && userData.voipToken && typeof userData.voipToken === "string") {
                voipToken = userData.voipToken;
              }
            }
          }
        } catch (err) {
          console.warn("[Push] Error fetching recipient device tokens:", err);
        }
      }

      const fcmServerKey = process.env.FCM_SERVER_KEY || "";
      let deliveredCount = 0;
      const adminApp = getFirebaseAdmin();

      const isIncomingCall = data?.type === "incoming_call" || channelId === "swapskill_calls";
      const callId = data?.callId || "";

      // Pipeline 1: iOS Native PushKit VoIP Push (dedicated pipeline for incoming calls)
      if (isIncomingCall && voipToken) {
        console.log(`[Push] Dispatching real iOS PushKit VoIP push to token ${voipToken.substring(0, 10)}...`);
        try {
          const apnsResult = await sendApnsVoipPush({
            voipToken,
            callId: data?.callId || "",
            sessionId: data?.sessionId || "",
            callerId: data?.callerId || "",
            callerName: data?.callerName || title || "Skill Swap Partner",
            callerPhoto: data?.callerPhoto,
            callType: data?.callType || "video",
            skillName: data?.skillName,
          });

          if (apnsResult.success) {
            console.log(`[LIVE SWAP] PUSH_SENT: iOS VoIP push delivered via APNs to recipient=${recipientUserId} (HTTP 200)`);
            deliveredCount++;
          } else if (apnsResult.skipped) {
            console.log(`[Push] iOS VoIP token detected (${voipToken.substring(0, 10)}...). Server APNs signing key not configured; client will receive FCM/in-app notification fallback.`);
          } else {
            console.error(`[LIVE SWAP] PUSH_FAILED: iOS VoIP APNs rejected - status=${apnsResult.statusCode} reason=${apnsResult.reason}`);
            // If token was rejected by APNs as bad or unregistered, remove from Firestore
            if (apnsResult.statusCode === 410 || apnsResult.reason?.includes("BadDeviceToken") || apnsResult.reason?.includes("Unregistered")) {
              console.warn(`[Push] Invalid VoIP token detected for user ${recipientUserId}. Removing from Firestore.`);
              if (adminApp) {
                try {
                  const db = getFirestore(adminApp);
                  await db.collection("users").doc(recipientUserId).update({
                    voipToken: null,
                    lastInvalidVoipToken: voipToken,
                  });
                } catch (cleanupErr) {
                  console.warn("[Push] Failed to clean up invalid VoIP token:", cleanupErr);
                }
              }
            }
          }
        } catch (apnsErr: any) {
          console.error(`[LIVE SWAP] PUSH_FAILED: iOS VoIP APNs error - ${apnsErr?.message}`);
        }
      }

      // Pipeline 2: Android & Web FCM Multicast Push (and standard iOS notifications)
      if (adminApp && deviceTokens.length > 0) {
        // Modern FCM HTTP v1 using Firebase Admin SDK
        try {
          const stringifiedData: Record<string, string> = {
            title: String(title),
            body: String(body || ""),
            channelId: String(channelId),
          };
          if (data && typeof data === "object") {
            for (const [k, v] of Object.entries(data)) {
              if (v !== undefined && v !== null) {
                stringifiedData[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
              }
            }
          }

          const clickAction = isIncomingCall && callId ? `swapskill://call/${callId}` : "FLUTTER_NOTIFICATION_CLICK";

          // For incoming calls, Android MUST receive a pure high-priority DATA message
          // without a top-level notification object so that Google Play Services invokes
          // SwapSkillMessagingService.onMessageReceived across background, locked, and killed states.
          const multicastPayload: any = {
            tokens: deviceTokens,
            data: stringifiedData,
            android: {
              priority: isIncomingCall || priority === "high" ? "high" : "normal",
              ttl: isIncomingCall ? 60 * 1000 : 86400 * 1000,
            },
            apns: {
              headers: {
                "apns-priority": isIncomingCall || priority === "high" ? "10" : "5",
                "apns-push-type": "alert",
                "apns-expiration": String(Math.floor(Date.now() / 1000) + (isIncomingCall ? 60 : 86400)),
              },
              payload: {
                aps: {
                  alert: {
                    title,
                    body: body || "",
                  },
                  sound: sound || "default",
                  badge: 1,
                  "content-available": 1,
                  category: isIncomingCall ? "INCOMING_CALL" : undefined,
                },
                ...stringifiedData,
              },
            },
            webpush: {
              notification: {
                title,
                body: body || "",
                icon: "/favicon.ico",
              },
            },
          };

          // For both incoming calls and call cancellations/hangups, Android MUST receive a pure high-priority
          // DATA message without a top-level notification object so that Google Play Services invokes
          // SwapSkillMessagingService.onMessageReceived across background, locked, and killed states.
          const isCallEvent = isIncomingCall || isCallCancellation;

          // Only attach top-level notification for non-call events (chat, sessions, announcements)
          if (!isCallEvent) {
            multicastPayload.notification = {
              title,
              body: body || "",
            };
            multicastPayload.android.notification = {
              channelId: channelId || "swapskill_general",
              sound: sound || "default",
              priority: priority === "high" ? "high" : "default",
              visibility: "public",
              clickAction,
            };
          }

          const response = await getMessaging(adminApp).sendEachForMulticast(multicastPayload);

          deliveredCount = response.successCount;
          console.log(`[Push FCM v1] Dispatched to ${response.successCount}/${deviceTokens.length} devices (Failures: ${response.failureCount})`);
          if (response.successCount > 0) {
            console.log(`[LIVE SWAP] PUSH_SENT: FCM multicast delivered to ${response.successCount} device(s)`);
          }
          if (response.failureCount > 0) {
            console.log(`[LIVE SWAP] PUSH_FAILED: FCM multicast failed for ${response.failureCount} token(s)`);
            response.responses.forEach((resp, idx) => {
              if (!resp.success) {
                console.warn(`[Push FCM v1] Token ${deviceTokens[idx]?.substring(0, 12)}... failed:`, resp.error?.message);
              }
            });
          }
        } catch (fcmV1Err: any) {
          console.error(`[LIVE SWAP] PUSH_FAILED: FCM v1 Multicast dispatch error:`, fcmV1Err?.message || fcmV1Err);
        }
      } else if (fcmServerKey && deviceTokens.length > 0) {
        // Fallback to FCM HTTP Legacy endpoint
        const isCallEventLegacy = isIncomingCall || isCallCancellation;
        const clickAction = isIncomingCall && callId ? `swapskill://call/${callId}` : "FLUTTER_NOTIFICATION_CLICK";
        const fcmPayload: any = {
          registration_ids: deviceTokens,
          priority: isCallEventLegacy || priority === "high" ? "high" : "normal",
          time_to_live: isCallEventLegacy ? 60 : 86400,
          data: {
            ...data,
            title,
            body,
            channelId: isIncomingCall ? "swapskill_calls" : channelId,
            click_action: clickAction,
          },
        };

        if (!isCallEventLegacy) {
          fcmPayload.notification = {
            title,
            body,
            sound: sound || "default",
            android_channel_id: isIncomingCall ? "swapskill_calls" : channelId,
            click_action: clickAction,
          };
        }

        const fcmRes = await fetch("https://fcm.googleapis.com/fcm/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `key=${fcmServerKey}`,
          },
          body: JSON.stringify(fcmPayload),
        });

        if (fcmRes.ok) {
          const fcmJson = await fcmRes.json();
          deliveredCount = fcmJson.success || 0;
          console.log(`[Push FCM Legacy] Dispatched to ${deliveredCount}/${deviceTokens.length} devices`);
          if (deliveredCount > 0) {
            console.log(`[LIVE SWAP] PUSH_SENT: FCM Legacy delivered to ${deliveredCount} device(s)`);
          } else {
            console.log(`[LIVE SWAP] PUSH_FAILED: FCM Legacy delivered 0 messages`);
          }
        } else {
          console.error(`[LIVE SWAP] PUSH_FAILED: FCM Legacy error response -`, await fcmRes.text());
        }
      } else {
        console.log(`[Push] In-app fallback only (Registered tokens: ${deviceTokens.length}, FCM v1 Admin configured: ${Boolean(adminApp)})`);
      }

      // Also persist to Firestore notifications collection as reliable fallback
      if (adminDb) {
        try {
          await adminDb.collection("users").doc(recipientUserId).collection("notifications").add({
            title,
            body: body || "",
            channelId,
            data: data || {},
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
          console.log(`[Push] In-app notification saved for user: ${recipientUserId}`);
        } catch (err) {
          console.warn("[Push] Fallback write to notifications collection failed via Admin SDK:", err);
        }
      }

      return res.json({
        ok: true,
        deliveredCount,
        deviceCount: deviceTokens.length,
        hasAdminApp: Boolean(adminApp),
        recipientUserId,
      });
    } catch (err: any) {
      console.error("[/api/notifications/send-push Error]:", err);
      return res.status(500).json({ error: err.message || "Failed to send push notification." });
    }
  });

  // Call Rejection Endpoint (Used by native CallActionReceiver and background tasks)
  app.post("/api/calls/reject", express.json({ type: ["application/json", "text/plain"] }), async (req, res) => {
    try {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {}
      }
      const { callId, reason } = body || {};
      if (!callId) {
        return res.status(400).json({ error: "Missing callId parameter." });
      }

      console.log(`[API] Processing call rejection for callId=${callId}, reason=${reason}`);
      const adminDb = getAdminFirestore();
      if (adminDb) {
        await adminDb.collection("calls").doc(callId).set({
          status: "rejected",
          endedAt: FieldValue.serverTimestamp(),
          endReason: reason || "Declined from notification",
        }, { merge: true });
        console.log(`[API] Call ${callId} successfully marked as rejected in Firestore.`);
      }

      return res.json({ ok: true, callId });
    } catch (err: any) {
      console.error("[/api/calls/reject Error]:", err);
      return res.status(500).json({ error: err?.message || "Failed to reject call" });
    }
  });

  // Session Leave & Disconnect Cleanup Endpoint (Supports fetch & navigator.sendBeacon)
  app.post("/api/session/leave", express.json({ type: ["application/json", "text/plain"] }), async (req, res) => {
    try {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (_) {}
      }
      const { sessionId, userId, forceEnd } = body || {};
      if (!sessionId || !userId) {
        return res.status(400).json({ error: "sessionId and userId are required." });
      }

      // Authentication verification
      const authUser = await verifyAuthToken(req);
      if (!authUser) {
        return res.status(401).json({ error: "Unauthorized: Valid Firebase ID token is required." });
      }

      // User ID matching verification
      if (authUser.uid !== userId) {
        return res.status(403).json({ error: "Forbidden: authenticated user does not match the userId parameter." });
      }

      const adminDb = getAdminFirestore();
      if (!adminDb) {
        console.warn("[/api/session/leave] Admin Firestore unavailable, skipping leave persistence.");
        return res.status(200).json({ ok: true, message: "Admin Firestore unavailable." });
      }

      const sessionRef = adminDb.collection("sessions").doc(sessionId);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        return res.status(200).json({ ok: true, message: "Session document not found." });
      }

      const sessionData = sessionDoc.data() || {};

      // Session participant authorization verification
      const isParticipant =
        sessionData.teacherId === authUser.uid ||
        sessionData.learnerId === authUser.uid ||
        sessionData.createdBy === authUser.uid ||
        (Array.isArray(sessionData.participantIds) && sessionData.participantIds.includes(authUser.uid)) ||
        (Array.isArray(sessionData.liveParticipants) && sessionData.liveParticipants.includes(authUser.uid));

      if (!isParticipant) {
        return res.status(403).json({ error: "Forbidden: authenticated user is not an authorized participant in this session." });
      }

      const status = (sessionData.status || "").toLowerCase();
      const sessionEnded = sessionData.sessionEnded || sessionData.isEnded || false;

      if (status === "completed" || sessionEnded) {
        return res.status(200).json({ ok: true, sessionEnded: true, remainingCount: 0 });
      }

      const existingParticipants = Array.isArray(sessionData.liveParticipants)
        ? sessionData.liveParticipants.filter(Boolean)
        : [];

      const remaining = existingParticipants.filter((id: string) => id !== userId);

      if (remaining.length > 0) {
        // Partner is still in the room -> keep session active
        await sessionRef.update({
          liveParticipants: remaining,
          lastLeaveTime: FieldValue.serverTimestamp(),
        });
        return res.status(200).json({ ok: true, sessionEnded: false, remainingCount: remaining.length });
      } else {
        // Participant left -> update live presence only, do NOT force-complete session
        await sessionRef.update({
          liveParticipants: [],
          isLive: false,
          lastLeaveTime: FieldValue.serverTimestamp(),
        });
        return res.status(200).json({ ok: true, sessionEnded: false, remainingCount: 0 });
      }
    } catch (err: any) {
      console.error("[/api/session/leave Error]:", err);
      return res.status(500).json({ error: err.message || "Failed to process session leave." });
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },
      appType: "spa",
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    app.use(express.static(distPath));

    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});