self.addEventListener("push", (event) => {
  let payload = {
    title: "Janja — Voice Chat",
    body: "Você recebeu uma nova atividade cifrada.",
    data: {},
  };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Deliberately keep a generic body; message plaintext never belongs in push payloads.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/logo-vetorizada.png",
      badge: "/logo-vetorizada.png",
      data: payload.data,
      tag: payload.data?.messageId || "janja-activity",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const channelId = event.notification.data?.channelId;
  const target = channelId ? `/?channel=${encodeURIComponent(channelId)}` : "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients[0];
        if (existing) {
          existing.postMessage({ type: "JANJA_OPEN_CHANNEL", channelId });
          return existing.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
