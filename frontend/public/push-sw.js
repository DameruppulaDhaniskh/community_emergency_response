// Optional Web Push Service Worker scaffold (enabled when VITE_ENABLE_WEB_PUSH=true)
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = { title: 'SafeCircle Alert', body: 'New emergency update.' };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'SafeCircle Alert', {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: payload.data || {},
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/notifications';
  event.waitUntil(self.clients.openWindow(target));
});

