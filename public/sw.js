// Service Worker for Push Notifications
// This file handles push notifications for the PWA (including iOS 16.4+)

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  console.log('[SW] Push event received:', event);

  let data = {
    title: 'הודעה חדשה',
    body: 'יש לך הודעה חדשה',
    url: '/announcements'
  };

  try {
    if (event.data) {
      const payload = event.data.json();
      data = { ...data, ...payload };
    }
  } catch (e) {
    console.error('[SW] Error parsing push data:', e);
  }

  // iOS Safari Web Push requires minimal notification options
  // Do NOT use icon, badge, actions, etc. - they can cause silent failures
  const options = {
    body: data.body,
    data: {
      url: data.url || '/announcements',
      dateOfArrival: Date.now()
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options).catch((err) => {
      console.error('[SW] showNotification failed:', err);
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/announcements';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to find an existing window to focus
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      // Open a new window if none exists
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
});
