// Service Worker for GestiónPBI PWA
// Handles: caching, push notifications
const CACHE_NAME = 'gestionpbi-v3';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Network-first strategy: try network, fall back to cache
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cache successful responses
                if (response.status === 200 && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

// ── PUSH NOTIFICATION HANDLER ──
// This fires even when the browser tab is inactive or screen is locked.
self.addEventListener('push', (event) => {
    if (!event.data) return;

    let payload;
    try {
        payload = event.data.json();
    } catch (e) {
        payload = { title: 'Alerta', body: event.data.text() };
    }

    const options = {
        body: payload.body || '',
        icon: '/popping-icon.png',
        badge: '/popping-icon.png',
        tag: payload.tag || 'production-alert',
        renotify: true,  // Re-alert even if same tag
        requireInteraction: true,  // Keep notification visible until user interacts
        vibrate: [400, 200, 400, 200, 400],  // Strong vibration pattern
        data: payload.data || {},
        actions: [
            { action: 'open', title: '🔍 Ver proceso' },
            { action: 'dismiss', title: '✅ Entendido' },
        ],
    };

    event.waitUntil(
        self.registration.showNotification(payload.title || '🔔 Alerta de Producción', options)
    );
});

// ── NOTIFICATION CLICK HANDLER ──
// Opens/focuses the app when the notification is tapped.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const urlPath = event.notification.data?.url || '/';

    if (event.action === 'dismiss') return;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // If app is already open, focus it
            for (const client of clientList) {
                if (client.url.includes(self.location.origin)) {
                    client.navigate(urlPath);
                    return client.focus();
                }
            }
            // Otherwise open new window
            return self.clients.openWindow(urlPath);
        })
    );
});
