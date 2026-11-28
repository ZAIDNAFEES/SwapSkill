// SwapSkill Background Service Worker for Native / PWA Local Notifications, FCM WebPush & Alarms
// Handles background alarms, scheduled notifications, incoming calls, and action clicks

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function showSafeNotification(title, options) {
  try {
    return await self.registration.showNotification(title, options);
  } catch (err) {
    // Fallback 1: Strip unsupported action properties (like type: "text" / placeholder) or actions
    try {
      const strippedActions = Array.isArray(options.actions)
        ? options.actions
            .filter((a) => a && a.action && a.title && a.type !== "text")
            .map((a) => ({ action: a.action, title: a.title }))
        : undefined;
      const safeOpts = {
        body: options.body || "",
        icon: options.icon || "/favicon.ico",
        badge: options.badge || "/favicon.ico",
        tag: options.tag,
        data: options.data,
        ...(strippedActions && strippedActions.length > 0 ? { actions: strippedActions } : {}),
      };
      return await self.registration.showNotification(title, safeOpts);
    } catch (err2) {
      // Fallback 2: Bare minimal notification options supported by all older Android/mobile browsers
      return self.registration.showNotification(title, {
        body: options.body || "",
        icon: options.icon || "/favicon.ico",
        tag: options.tag,
        data: options.data,
      });
    }
  }
}

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
  const title = notif.title || data.title || (type === "incoming_call" ? `Incoming Call from ${callerName}` : "SwapSkill");
  const body = notif.body || data.body || (type === "incoming_call" ? "Tap to answer the call" : "You have a new update.");

  const isCallEnded =
    type === "call_cancelled" ||
    type === "call_ended" ||
    type === "call_rejected" ||
    type === "call_missed" ||
    type === "call_accepted";
  const isIncomingCall = type === "incoming_call" && !isCallEnded && Boolean(callId);

  // If a remote call was cancelled/ended/answered, dismiss active notifications, notify open tabs, and record callId to drop delayed incoming pushes
  if (isCallEnded && callId) {
    const cancelWork = (async () => {
      try {
        const cache = await caches.open("swap-push-bridge-v1");
        const res = await cache.match("/swap-cancelled-calls");
        let list = [];
        if (res) {
          const parsed = await res.json().catch(() => []);
          if (Array.isArray(parsed)) list = parsed;
        }
        const now = Date.now();
        list = list.filter((item) => item && item.callId && now - (item.ts || 0) < 120000 && item.callId !== callId);
        list.push({ callId, ts: now });
        if (list.length > 30) list = list.slice(-30);
        await cache.put(
          "/swap-cancelled-calls",
          new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } })
        );
      } catch (_) {}

      const notifications = await self.registration.getNotifications().catch(() => []);
      notifications.forEach((n) => {
        if ((n.data && n.data.callId === callId) || n.tag === `call_${callId}`) {
          n.close();
        }
      });

      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true }).catch(() => []);
      for (const client of clientsList) {
        client.postMessage({ type: "CALL_CANCELLED_PUSH", callId });
      }
    })();
    event.waitUntil(cancelWork);
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
          { action: "accept_call", title: "Answer" },
          { action: "decline_call", title: "Decline" },
        ]
      : chatId
      ? [
          { action: "reply", title: "Reply", type: "text", placeholder: "Reply..." },
          { action: "mute_chat", title: "Mute" },
        ]
      : [
          { action: "open", title: "Open" },
          { action: "dismiss", title: "Dismiss" },
        ],
  };

  const isChatPush = Boolean(chatId && !isIncomingCall && !isCallEnded);
  const handlePushWork = async () => {
    if (isChatPush) {
      const pushEntry = {
        chatId,
        senderId: data.senderId || "",
        senderName: data.senderName || notif.title || data.title || "",
        senderPhoto: data.senderPhoto || data.icon || notif.icon || "",
        message: body,
        fullMessage: data.fullMessage || body,
        messageId: data.messageId || "",
        createdAtMs: Number(data.createdAtMs) || Date.now(),
      };

      let isMuted = false;
      try {
        const cache = await caches.open("swap-push-bridge-v1");
        const mutedRes = await cache.match("/swap-muted-chats");
        if (mutedRes) {
          const mutedList = await mutedRes.json().catch(() => []);
          if (Array.isArray(mutedList) && mutedList.includes(chatId)) {
            isMuted = true;
          }
        }
        const existingRes = await cache.match("/swap-pending-chat-pushes");
        let list = [];
        if (existingRes) {
          try {
            const parsed = await existingRes.json();
            if (Array.isArray(parsed)) list = parsed;
          } catch (_) {}
        }
        list.push(pushEntry);
        if (list.length > 20) list = list.slice(-20);
        await cache.put(
          "/swap-pending-chat-pushes",
          new Response(JSON.stringify(list), {
            headers: { "Content-Type": "application/json" },
          })
        );
      } catch (_) {}

      await self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            client.postMessage({
              type: "CHAT_PUSH_RECEIVED",
              push: pushEntry,
            });
          }
        })
        .catch(() => {});

      if (!isMuted) {
        await showSafeNotification(title, options);
      }
      return;
    }

    if (isIncomingCall && callId) {
      const pushTs = Number(data.timestamp || 0);
      if (pushTs > 0 && Date.now() - pushTs > 40000) {
        return;
      }
      try {
        const cache = await caches.open("swap-push-bridge-v1");
        const cancelledRes = await cache.match("/swap-cancelled-calls");
        if (cancelledRes) {
          const cancelledList = await cancelledRes.json().catch(() => []);
          if (Array.isArray(cancelledList) && cancelledList.some((item) => item && item.callId === callId)) {
            return;
          }
        }
      } catch (_) {}
    }

    await showSafeNotification(title, options);
  };

  event.waitUntil(handlePushWork());
});

// Handle notification click (e.g. Join Session, Answer/Decline Call, Open Chat, Reply, Mute)
self.addEventListener("notificationclick", (event) => {
  const action = event.action;
  const notifData = event.notification.data || {};
  const sessionId = notifData.sessionId;
  const callId = notifData.callId;
  const chatId = notifData.chatId;
  const isIncomingCall = notifData.type === "incoming_call" && Boolean(callId);
  const targetPath = notifData.url || (isIncomingCall ? `/call/${callId}?sessionId=${sessionId || ""}` : chatId ? `/messages?chatId=${chatId}` : "/");
  const fullUrl = new URL(targetPath, self.registration.scope).href;

  if (action === "dismiss" || action === "decline_call") {
    event.notification.close();
    if (callId) {
      fetch("/api/calls/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, reason: "Declined from notification" }),
      }).catch(() => {});
    }
    return;
  }

  // Handle Mute action
  if (action === "mute_chat" && chatId) {
    event.notification.close();
    const muteCachePromise = (async () => {
      try {
        const cache = await caches.open("swap-push-bridge-v1");
        const mutedRes = await cache.match("/swap-muted-chats");
        let list = [];
        if (mutedRes) {
          const parsed = await mutedRes.json().catch(() => []);
          if (Array.isArray(parsed)) list = parsed;
        }
        if (!list.includes(chatId)) {
          list.push(chatId);
          await cache.put(
            "/swap-muted-chats",
            new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } })
          );
        }
      } catch (_) {}
    })();

    const clientNotifyPromise = self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          client.postMessage({
            type: "MUTE_CHAT",
            chatId: chatId,
          });
        }
      });
    event.waitUntil(Promise.all([muteCachePromise, clientNotifyPromise]));
    return;
  }

  // Handle Mark as Read action (backwards compatible)
  if (action === "mark_read" && chatId) {
    event.notification.close();
    const reqPromise = fetch("/api/chat/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: chatId,
        userId: notifData.recipientId || notifData.recipientUserId || "",
      }),
    }).catch(() => {});

    const clientNotifyPromise = self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          client.postMessage({
            type: "MARK_CHAT_READ",
            chatId: chatId,
          });
        }
      });

    event.waitUntil(Promise.all([reqPromise, clientNotifyPromise]));
    return;
  }

  // Handle Inline Reply action: keep stacked conversation visible & interactive for rapid consecutive replies
  if (action === "reply" && chatId && event.reply && event.reply.trim()) {
    const replyText = event.reply.trim();
    const prevBody = event.notification.body || "";
    const updatedBody = prevBody ? `${prevBody}\nYou: ${replyText}` : `You: ${replyText}`;

    const replyPromise = fetch("/api/chat/send-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: chatId,
        text: replyText,
        senderId: notifData.recipientId || notifData.recipientUserId || "",
        recipientId: notifData.senderId || "",
        senderName: "SwapSkill User",
      }),
    }).catch(() => {});

    const reshowPromise = showSafeNotification(event.notification.title || "SwapSkill", {
      body: updatedBody,
      icon: event.notification.icon || "/favicon.ico",
      badge: "/favicon.ico",
      tag: event.notification.tag || `chat_${chatId}`,
      renotify: false,
      silent: true,
      data: notifData,
      actions: [
        { action: "reply", title: "Reply", type: "text", placeholder: "Reply..." },
        { action: "mute_chat", title: "Mute" },
      ],
    });

    const clientNotifyPromise = self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          client.postMessage({
            type: "MESSAGE_REPLIED",
            chatId: chatId,
            text: replyText,
          });
        }
      });

    event.waitUntil(Promise.all([replyPromise, reshowPromise, clientNotifyPromise]));
    return;
  }

  // Default tap: close notification and focus/open straight inside the exact chat
  event.notification.close();
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
    showSafeNotification(title, options || {});
  }
});

