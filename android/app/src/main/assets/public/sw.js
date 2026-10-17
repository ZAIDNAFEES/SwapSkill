// SwapSkill Background Service Worker for Native / PWA Local Notifications, FCM WebPush & Alarms
// Handles background alarms, scheduled notifications, incoming calls, and action clicks

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming Web Push (FCM Web Notification / Raw Push) when app is closed or backgrounded
self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload = { notification: { body: event.data.text() } };
    }
  }

  // Support both FCM payload structure and direct push data
  const notif = payload.notification || {};
  const data = payload.data || {};

  const type = data.type || "";
  const callId = data.callId || "";
  const sessionId = data.sessionId || "";
  const chatId = data.chatId || "";
  const callerName = data.callerName || notif.title || data.title || "Skill Swap Partner";
  const title = notif.title || data.title || (callId ? `Incoming Call from ${callerName}` : "SwapSkill");
  const body = notif.body || data.body || (callId ? "Tap to answer the call" : "You have a new update.");

  const isIncomingCall = type === "incoming_call" || Boolean(callId);
  const isCallEnded = type === "call_cancelled" || type === "call_ended";

  // If a remote call was cancelled or ended, dismiss any active incoming call notification
  if (isCallEnded && callId) {
    event.waitUntil(
      self.registration.getNotifications().then((notifications) => {
        notifications.forEach((n) => {
          if (n.data && (n.data.callId === callId || n.tag === `call_${callId}`)) {
            n.close();
          }
        });
      })
    );
    return;
  }

  // Construct high-priority notification options
  const options = {
    body,
    icon: notif.icon || "/favicon.ico",
    badge: "/favicon.ico",
    data: {
      type,
      callId,
      sessionId,
      chatId,
      url: isIncomingCall
        ? `/call/${callId}?sessionId=${sessionId || ""}`
        : chatId
        ? `/messages?chatId=${chatId}`
        : sessionId
        ? `/sessions?id=${sessionId}`
        : "/",
      ...data,
    },
    tag: isIncomingCall ? `call_${callId}` : chatId ? `chat_${chatId}` : undefined,
    renotify: true,
    requireInteraction: isIncomingCall, // Keep incoming call banner active until user responds
    vibrate: isIncomingCall
      ? [300, 200, 300, 200, 500, 300, 500, 300, 500]
      : [150, 100, 150],
    actions: isIncomingCall
      ? [
          { action: "accept_call", title: "📞 Answer" },
          { action: "decline_call", title: "✕ Decline" },
        ]
      : [
          { action: "open", title: "Open" },
          { action: "dismiss", title: "Dismiss" },
        ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click (e.g. Join Session, Answer/Decline Call, Open Chat)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const action = event.action;
  const notifData = event.notification.data || {};
  const sessionId = notifData.sessionId;
  const callId = notifData.callId;
  const isIncomingCall = notifData.type === "incoming_call" || Boolean(callId);
  const targetPath = notifData.url || (isIncomingCall ? `/call/${callId}?sessionId=${sessionId || ""}` : "/");
  const fullUrl = new URL(targetPath, self.registration.scope).href;

  if (action === "dismiss" || action === "decline_call") {
    // If call was declined, notify server in background if possible
    if (callId) {
      fetch("/api/calls/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, reason: "Declined from notification" }),
      }).catch(() => {});
    }
    return;
  }

  // Focus existing app window or open a fresh window
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.postMessage({
            type: isIncomingCall ? "INCOMING_CALL_ACTION" : "NAVIGATE_NOTIFICATION",
            callId,
            sessionId,
            chatId: notifData.chatId,
            autoAccept: action === "accept_call",
            data: notifData,
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullUrl);
      }
    })
  );
});

// Listen for messages from web application / Native WebViews to display local alarm notification
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "TRIGGER_LOCAL_ALARM") {
    const { title, options } = event.data;
    self.registration.showNotification(title, options);
  }
});

