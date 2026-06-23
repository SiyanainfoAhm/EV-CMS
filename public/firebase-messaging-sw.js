/* eslint-disable no-undef */
/** Web Push background handler (VAPID) — no FCM registration API required. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function parsePushPayload(event) {
  if (!event.data) {
    return { title: "DFCCIL EV-CMS", body: "", data: { url: "/notifications" } };
  }
  try {
    const raw = event.data.json();
    return {
      title: raw.title ?? raw.notification?.title ?? "DFCCIL EV-CMS",
      body: raw.body ?? raw.notification?.body ?? "",
      data: { url: raw.url ?? "/notifications", ...(raw.data ?? {}) },
    };
  } catch {
    const text = event.data.text();
    return { title: "DFCCIL EV-CMS", body: text, data: { url: "/notifications" } };
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      data: payload.data,
      tag: payload.data?.notificationId ?? "ev-cms",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })
  );
});
