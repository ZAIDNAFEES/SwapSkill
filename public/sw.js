// SwapSkill Background Service Worker for Native / PWA Local Notifications & Alarms
// Handles background alarms, scheduled notifications, and action clicks

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle notification click (e.g. Join Session or Dismiss)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const action = event.action;
  const sessionData = event.notification.data || {};
  const sessionId = sessionData.sessionId;
  const urlToOpen = new URL(self.registration.scope).href;

  if (action === "dismiss") {
    // User explicitly dismissed
    return;
  }

  // Focus existing window or open a new window
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          // Send message to web app client to navigate and open Live Swap or Sessions
          client.postMessage({
            type: action === "join" || sessionData.isLive ? "NAVIGATE_LIVE_SESSION" : "NAVIGATE_SESSION",
            sessionId: sessionId,
            session: sessionData.session,
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
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
