var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_config = require("dotenv/config");
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_app = require("firebase-admin/app");
var import_auth = require("firebase-admin/auth");
var import_messaging = require("firebase-admin/messaging");
var import_firestore = require("firebase-admin/firestore");

// server/apnsVoipService.ts
var import_http2 = __toESM(require("http2"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var cachedJwt = null;
function getApnsJwt(keyId, teamId, privateKeyRaw) {
  const now = Math.floor(Date.now() / 1e3);
  if (cachedJwt && cachedJwt.expiresAt > now + 300) {
    return cachedJwt.token;
  }
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString("base64url");
  const data = `${header}.${claims}`;
  let normalizedKey = privateKeyRaw.trim();
  if (normalizedKey.includes("\\n")) {
    normalizedKey = normalizedKey.replace(/\\n/g, "\n");
  }
  if (!normalizedKey.includes("-----BEGIN PRIVATE KEY-----") && !normalizedKey.includes("-----BEGIN EC PRIVATE KEY-----")) {
    normalizedKey = `-----BEGIN PRIVATE KEY-----
${normalizedKey}
-----END PRIVATE KEY-----`;
  }
  const signature = import_crypto.default.sign("sha256", Buffer.from(data), {
    key: normalizedKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64url");
  const jwt = `${data}.${signature}`;
  cachedJwt = {
    token: jwt,
    expiresAt: now + 3e3
    // Valid for 50 minutes (APNs max 60 min)
  };
  return jwt;
}
async function sendApnsVoipPush(options) {
  const apnsKeyId = process.env.APNS_KEY_ID;
  const apnsTeamId = process.env.APNS_TEAM_ID;
  const apnsPrivateKey = process.env.APNS_PRIVATE_KEY;
  const bundleId = process.env.APNS_BUNDLE_ID || "com.swapskill.app";
  const isSandbox = process.env.APNS_SANDBOX === "true" || process.env.NODE_ENV !== "production";
  if (!apnsKeyId || !apnsTeamId || !apnsPrivateKey) {
    console.log("[APNs VoIP] APNs signing credentials (APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY) not configured. Real APNs HTTP/2 push skipped.");
    return {
      success: false,
      skipped: true,
      reason: "APNs credentials not configured"
    };
  }
  const cleanToken = options.voipToken.replace(/[^0-9a-fA-F]/g, "");
  if (!cleanToken || cleanToken.length < 32) {
    return {
      success: false,
      reason: `Invalid VoIP token format (${options.voipToken})`
    };
  }
  let jwt;
  try {
    jwt = getApnsJwt(apnsKeyId, apnsTeamId, apnsPrivateKey);
  } catch (jwtErr) {
    console.error("[APNs VoIP] Failed to sign JWT with APNs private key:", jwtErr?.message);
    return {
      success: false,
      reason: `JWT signing failed: ${jwtErr?.message}`
    };
  }
  const apnsHost = isSandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const payload = {
    aps: {},
    callId: options.callId,
    sessionId: options.sessionId,
    callerId: options.callerId,
    callerName: options.callerName,
    callerPhoto: options.callerPhoto || "",
    callType: options.callType || "video",
    skillName: options.skillName || "",
    timestamp: Date.now()
  };
  const bodyData = Buffer.from(JSON.stringify(payload), "utf8");
  return new Promise((resolve) => {
    let client = null;
    try {
      client = import_http2.default.connect(apnsHost);
    } catch (connErr) {
      console.error(`[APNs VoIP] Failed to connect to ${apnsHost}:`, connErr?.message);
      return resolve({
        success: false,
        reason: `Connection error: ${connErr?.message}`
      });
    }
    client.on("error", (err) => {
      console.error(`[APNs VoIP] HTTP/2 client error:`, err?.message);
      if (client && !client.destroyed) {
        client.destroy();
      }
      resolve({
        success: false,
        reason: `HTTP/2 client error: ${err?.message}`
      });
    });
    const apnsTopic = `${bundleId}.voip`;
    const req = client.request({
      [import_http2.default.constants.HTTP2_HEADER_METHOD]: import_http2.default.constants.HTTP2_METHOD_POST,
      [import_http2.default.constants.HTTP2_HEADER_PATH]: `/3/device/${cleanToken}`,
      authorization: `bearer ${jwt}`,
      "apns-push-type": "voip",
      "apns-topic": apnsTopic,
      "apns-priority": "10",
      "apns-expiration": "0"
      // Deliver immediately or discard
    });
    let resBody = "";
    let statusCode = 0;
    req.on("response", (headers) => {
      const statusVal = headers[import_http2.default.constants.HTTP2_HEADER_STATUS];
      statusCode = Number(Array.isArray(statusVal) ? statusVal[0] : statusVal) || 0;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      resBody += chunk;
    });
    req.on("end", () => {
      if (client && !client.destroyed) {
        client.close();
      }
      if (statusCode === 200) {
        console.log(`[APNs VoIP] Successfully delivered VoIP push to token ${cleanToken.substring(0, 10)}... (HTTP 200)`);
        resolve({
          success: true,
          statusCode: 200
        });
      } else {
        console.error(`[APNs VoIP] APNs rejected VoIP push. Status: ${statusCode}, Body: ${resBody}`);
        resolve({
          success: false,
          statusCode,
          reason: resBody || `HTTP ${statusCode}`
        });
      }
    });
    req.on("error", (reqErr) => {
      console.error(`[APNs VoIP] Request error:`, reqErr?.message);
      if (client && !client.destroyed) {
        client.destroy();
      }
      resolve({
        success: false,
        reason: `Request error: ${reqErr?.message}`
      });
    });
    req.write(bodyData);
    req.end();
  });
}

// server.ts
var firebaseAdminApp = null;
var adminFirestore = null;
async function verifyAuthToken(req) {
  const authHeader = req.headers.authorization;
  let token = "";
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  } else if (req.body?.idToken) {
    token = req.body.idToken;
  } else if (req.query?.idToken) {
    token = req.query.idToken;
  }
  if (!token) {
    return null;
  }
  const adminApp = getFirebaseAdmin();
  if (adminApp) {
    try {
      const auth = (0, import_auth.getAuth)(adminApp);
      const decoded = await auth.verifyIdToken(token);
      return { uid: decoded.uid, email: decoded.email };
    } catch (err) {
      console.warn("[Auth] Firebase ID token verification failed via Admin SDK:", err);
    }
  }
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
      const payload = JSON.parse(payloadJson);
      const nowSeconds = Math.floor(Date.now() / 1e3);
      if (payload.exp && payload.exp > nowSeconds && (payload.user_id || payload.sub)) {
        return { uid: payload.user_id || payload.sub, email: payload.email };
      }
    }
  } catch (_) {
  }
  return null;
}
function getFirebaseAdmin() {
  if (firebaseAdminApp) return firebaseAdminApp;
  try {
    const existingApps = (0, import_app.getApps)();
    if (existingApps.length > 0 && existingApps[0]) {
      firebaseAdminApp = existingApps[0];
      return firebaseAdminApp;
    }
    const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FCM_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (serviceAccountRaw) {
      let parsedCreds = null;
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
        firebaseAdminApp = (0, import_app.initializeApp)({
          credential: (0, import_app.cert)(parsedCreds),
          projectId: parsedCreds.project_id || process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1"
        });
        console.log(`[FCM v1] Firebase Admin initialized for project: ${parsedCreds.project_id}`);
        return firebaseAdminApp;
      }
    }
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1";
    if (clientEmail && privateKey) {
      firebaseAdminApp = (0, import_app.initializeApp)({
        credential: (0, import_app.cert)({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n")
        }),
        projectId
      });
      console.log(`[FCM v1] Firebase Admin initialized from individual env credentials for project: ${projectId}`);
      return firebaseAdminApp;
    }
    try {
      firebaseAdminApp = (0, import_app.initializeApp)({ projectId });
      console.log(`[Firebase Admin] Initialized with Application Default Credentials for project: ${projectId}`);
      return firebaseAdminApp;
    } catch (adcErr) {
    }
    return null;
  } catch (err) {
    console.warn("[FCM v1] Lazy initialization attempt:", err);
    return null;
  }
}
function getAdminFirestore() {
  if (adminFirestore) return adminFirestore;
  const adminApp = getFirebaseAdmin();
  if (adminApp) {
    try {
      adminFirestore = (0, import_firestore.getFirestore)(adminApp);
      return adminFirestore;
    } catch (err) {
      console.warn("[Admin Firestore] Error getting Firestore from Admin app:", err);
    }
  }
  return null;
}
async function startServer() {
  const app = (0, import_express.default)();
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
  const PORT = Number(process.env.PORT) || 3e3;
  const isProduction = process.env.NODE_ENV === "production";
  app.use(import_express.default.json());
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.get("/api/webrtc/ice-servers", async (req, res) => {
    const authUser = await verifyAuthToken(req);
    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized: Valid Firebase authentication token required." });
    }
    const defaultStunServers = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:global.stun.twilio.com:3478" }
    ];
    const turnUrl = process.env.TURN_URL || process.env.COTURN_URL || process.env.VITE_TURN_URL || "";
    const turnUsername = process.env.TURN_USERNAME || process.env.COTURN_USERNAME || process.env.VITE_TURN_USERNAME || "";
    const turnCredential = process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD || process.env.COTURN_PASSWORD || process.env.VITE_TURN_CREDENTIAL || "";
    const iceServers = [...defaultStunServers];
    if (turnUrl && turnUsername && turnCredential) {
      const turnUrls = turnUrl.split(",").map((u) => u.trim()).filter(Boolean);
      iceServers.push({
        urls: turnUrls,
        username: turnUsername,
        credential: turnCredential
      });
      console.log(`[WebRTC ICE] Configured ${turnUrls.length} TURN relay endpoints for secure mobile NAT traversal`);
    } else {
      console.log("[WebRTC ICE] TURN credentials not provided in environment, using high-reliability STUN servers");
    }
    res.json({
      iceServers,
      turnEnabled: Boolean(turnUrl && turnUsername && turnCredential),
      timestamp: Date.now()
    });
  });
  const pushDedupeCache = /* @__PURE__ */ new Map();
  setInterval(() => {
    const cutoff = Date.now() - 6e4;
    for (const [key, ts] of pushDedupeCache.entries()) {
      if (ts < cutoff) {
        pushDedupeCache.delete(key);
      }
    }
  }, 3e5);
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
        sound = "default"
      } = req.body || {};
      if (!recipientUserId || !title) {
        return res.status(400).json({ error: "recipientUserId and title are required." });
      }
      const isSelfTest = recipientUserId === authUser.uid;
      if (!isSelfTest) {
        if (data.type === "incoming_call" && data.callerId && data.callerId !== authUser.uid) {
          return res.status(403).json({ error: "Forbidden: callerId does not match authenticated user." });
        }
        if (data.senderId && data.senderId !== authUser.uid) {
          return res.status(403).json({ error: "Forbidden: senderId does not match authenticated user." });
        }
      }
      const now = Date.now();
      const isCallNotification = data?.type === "incoming_call" || channelId === "swapskill_calls";
      const isCallCancellation = data?.type === "call_cancelled" || data?.type === "call_ended";
      const eventKey = isCallCancellation ? `${recipientUserId}:cancel_${data.callId || now}` : isCallNotification ? `${recipientUserId}:call_${data.callId || now}` : `${recipientUserId}:${data.messageId || (data.type === "chat" ? `chat_${data.chatId}_${now}` : "") || data.callId || data.sessionId || data.eventId || data.type || title}`;
      const lastSent = pushDedupeCache.get(eventKey);
      if (!isCallCancellation && !isSelfTest && lastSent && now - lastSent < (isCallNotification ? 1e4 : 3e4)) {
        console.log(`[Push] Skipping duplicate notification for ${eventKey} (sent ${(now - lastSent) / 1e3}s ago)`);
        return res.json({ ok: true, deduplicated: true, recipientUserId });
      }
      pushDedupeCache.set(eventKey, now);
      const projectId = process.env.VITE_FIREBASE_PROJECT_ID || "swapskill-abbe1";
      const cleanUserId = encodeURIComponent(recipientUserId);
      let deviceTokens = [];
      let voipToken = "";
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
            skillName: data?.skillName
          });
          if (apnsResult.success) {
            console.log(`[LIVE SWAP] PUSH_SENT: iOS VoIP push delivered via APNs to recipient=${recipientUserId} (HTTP 200)`);
            deliveredCount++;
          } else if (apnsResult.skipped) {
            console.log(`[Push] iOS VoIP token detected (${voipToken.substring(0, 10)}...). Server APNs signing key not configured; client will receive FCM/in-app notification fallback.`);
          } else {
            console.error(`[LIVE SWAP] PUSH_FAILED: iOS VoIP APNs rejected - status=${apnsResult.statusCode} reason=${apnsResult.reason}`);
            if (apnsResult.statusCode === 410 || apnsResult.reason?.includes("BadDeviceToken") || apnsResult.reason?.includes("Unregistered")) {
              console.warn(`[Push] Invalid VoIP token detected for user ${recipientUserId}. Removing from Firestore.`);
              if (adminApp) {
                try {
                  const db = (0, import_firestore.getFirestore)(adminApp);
                  await db.collection("users").doc(recipientUserId).update({
                    voipToken: null,
                    lastInvalidVoipToken: voipToken
                  });
                } catch (cleanupErr) {
                  console.warn("[Push] Failed to clean up invalid VoIP token:", cleanupErr);
                }
              }
            }
          }
        } catch (apnsErr) {
          console.error(`[LIVE SWAP] PUSH_FAILED: iOS VoIP APNs error - ${apnsErr?.message}`);
        }
      }
      if (adminApp && deviceTokens.length > 0) {
        try {
          const stringifiedData = {
            title: String(title),
            body: String(body || ""),
            channelId: String(channelId)
          };
          if (data && typeof data === "object") {
            for (const [k, v] of Object.entries(data)) {
              if (v !== void 0 && v !== null) {
                stringifiedData[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
              }
            }
          }
          const clickAction = isIncomingCall && callId ? `swapskill://call/${callId}` : "FLUTTER_NOTIFICATION_CLICK";
          const multicastPayload = {
            tokens: deviceTokens,
            data: stringifiedData,
            android: {
              priority: isIncomingCall || priority === "high" ? "high" : "normal",
              ttl: isIncomingCall ? 60 * 1e3 : 86400 * 1e3
            },
            apns: {
              headers: {
                "apns-priority": isIncomingCall || priority === "high" ? "10" : "5",
                "apns-push-type": "alert",
                "apns-expiration": String(Math.floor(Date.now() / 1e3) + (isIncomingCall ? 60 : 86400))
              },
              payload: {
                aps: {
                  alert: {
                    title,
                    body: body || ""
                  },
                  sound: sound || "default",
                  badge: 1,
                  "content-available": 1,
                  category: isIncomingCall ? "INCOMING_CALL" : void 0
                },
                ...stringifiedData
              }
            },
            webpush: {
              notification: {
                title,
                body: body || "",
                icon: "/favicon.ico"
              }
            }
          };
          const isCallEvent = isIncomingCall || isCallCancellation;
          if (!isCallEvent) {
            multicastPayload.notification = {
              title,
              body: body || ""
            };
            multicastPayload.android.notification = {
              channelId: channelId || "swapskill_general",
              sound: sound || "default",
              priority: priority === "high" ? "high" : "default",
              visibility: "public",
              clickAction
            };
          }
          const response = await (0, import_messaging.getMessaging)(adminApp).sendEachForMulticast(multicastPayload);
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
        } catch (fcmV1Err) {
          console.error(`[LIVE SWAP] PUSH_FAILED: FCM v1 Multicast dispatch error:`, fcmV1Err?.message || fcmV1Err);
        }
      } else if (fcmServerKey && deviceTokens.length > 0) {
        const isCallEventLegacy = isIncomingCall || isCallCancellation;
        const clickAction = isIncomingCall && callId ? `swapskill://call/${callId}` : "FLUTTER_NOTIFICATION_CLICK";
        const fcmPayload = {
          registration_ids: deviceTokens,
          priority: isCallEventLegacy || priority === "high" ? "high" : "normal",
          time_to_live: isCallEventLegacy ? 60 : 86400,
          data: {
            ...data,
            title,
            body,
            channelId: isIncomingCall ? "swapskill_calls" : channelId,
            click_action: clickAction
          }
        };
        if (!isCallEventLegacy) {
          fcmPayload.notification = {
            title,
            body,
            sound: sound || "default",
            android_channel_id: isIncomingCall ? "swapskill_calls" : channelId,
            click_action: clickAction
          };
        }
        const fcmRes = await fetch("https://fcm.googleapis.com/fcm/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `key=${fcmServerKey}`
          },
          body: JSON.stringify(fcmPayload)
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
      if (adminDb) {
        try {
          await adminDb.collection("users").doc(recipientUserId).collection("notifications").add({
            title,
            body: body || "",
            channelId,
            data: data || {},
            read: false,
            createdAt: import_firestore.FieldValue.serverTimestamp()
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
        recipientUserId
      });
    } catch (err) {
      console.error("[/api/notifications/send-push Error]:", err);
      return res.status(500).json({ error: err.message || "Failed to send push notification." });
    }
  });
  app.post("/api/calls/reject", import_express.default.json({ type: ["application/json", "text/plain"] }), async (req, res) => {
    try {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
        }
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
          endedAt: import_firestore.FieldValue.serverTimestamp(),
          endReason: reason || "Declined from notification"
        }, { merge: true });
        console.log(`[API] Call ${callId} successfully marked as rejected in Firestore.`);
      }
      return res.json({ ok: true, callId });
    } catch (err) {
      console.error("[/api/calls/reject Error]:", err);
      return res.status(500).json({ error: err?.message || "Failed to reject call" });
    }
  });
  app.post("/api/session/leave", import_express.default.json({ type: ["application/json", "text/plain"] }), async (req, res) => {
    try {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (_) {
        }
      }
      const { sessionId, userId, forceEnd } = body || {};
      if (!sessionId || !userId) {
        return res.status(400).json({ error: "sessionId and userId are required." });
      }
      const authUser = await verifyAuthToken(req);
      if (!authUser) {
        return res.status(401).json({ error: "Unauthorized: Valid Firebase ID token is required." });
      }
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
      const isParticipant = sessionData.teacherId === authUser.uid || sessionData.learnerId === authUser.uid || sessionData.createdBy === authUser.uid || Array.isArray(sessionData.participantIds) && sessionData.participantIds.includes(authUser.uid) || Array.isArray(sessionData.liveParticipants) && sessionData.liveParticipants.includes(authUser.uid);
      if (!isParticipant) {
        return res.status(403).json({ error: "Forbidden: authenticated user is not an authorized participant in this session." });
      }
      const status = (sessionData.status || "").toLowerCase();
      const sessionEnded = sessionData.sessionEnded || sessionData.isEnded || false;
      if (status === "completed" || sessionEnded) {
        return res.status(200).json({ ok: true, sessionEnded: true, remainingCount: 0 });
      }
      const existingParticipants = Array.isArray(sessionData.liveParticipants) ? sessionData.liveParticipants.filter(Boolean) : [];
      const remaining = existingParticipants.filter((id) => id !== userId);
      if (remaining.length > 0) {
        await sessionRef.update({
          liveParticipants: remaining,
          lastLeaveTime: import_firestore.FieldValue.serverTimestamp()
        });
        return res.status(200).json({ ok: true, sessionEnded: false, remainingCount: remaining.length });
      } else {
        await sessionRef.update({
          liveParticipants: [],
          isLive: false,
          lastLeaveTime: import_firestore.FieldValue.serverTimestamp()
        });
        return res.status(200).json({ ok: true, sessionEnded: false, remainingCount: 0 });
      }
    } catch (err) {
      console.error("[/api/session/leave Error]:", err);
      return res.status(500).json({ error: err.message || "Failed to process session leave." });
    }
  });
  if (!isProduction) {
    const vite = await (0, import_vite.createServer)({
      server: {
        middlewareMode: true
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
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
//# sourceMappingURL=server.cjs.map
