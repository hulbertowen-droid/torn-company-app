/**
 * FactionOS — Progressive Web App Service Worker (v1.0.0)
 * Provides app shell caching, offline asset delivery, and native PWA capabilities.
 */

const CACHE_NAME = 'factionos-pwa-v1.2.0';
const STATIC_ASSETS = [
    '/',
    '/manifest.json',
    '/global.css',
    '/global-topbar.js',
    '/auth-gate.js',
    '/global_settings.js',
    '/icons/icon.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-180.png',
    '/favicon.ico'
];

// Install Event: Pre-cache App Shell
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[ServiceWorker] Pre-cache warning:', err);
            });
        })
    );
});

// Activate Event: Clean up legacy caches & take immediate control
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((k) => {
                    if (k !== CACHE_NAME) {
                        return caches.delete(k);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event: Cache-First for static assets, Network-First for dynamic API
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests and WebSocket / EventSource streams
    if (request.method !== 'GET') return;
    if (url.pathname.includes('/sse/') || url.pathname.includes('/events') || url.pathname.includes('/socket.io')) return;

    // 1. API Requests: Network-First (Do NOT serve stale live combat / banking / OC data from cache)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request).catch(() => {
                return new Response(JSON.stringify({ 
                    offline: true, 
                    error: "Offline mode. Live Torn API telemetry unavailable without internet." 
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // 2. Navigation / HTML pages: Network-First with Cache fallback
    if (request.mode === 'navigate' || request.destination === 'document') {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const copy = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return networkResponse;
                })
                .catch(() => {
                    return caches.match(request).then((cached) => {
                        return cached || caches.match('/');
                    });
                })
        );
        return;
    }

    // 3. Static Assets (CSS, JS, Fonts, Images): Stale-While-Revalidate
    if (
        request.destination === 'style' ||
        request.destination === 'script' ||
        request.destination === 'image' ||
        request.destination === 'font' ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com')
    ) {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                const fetchPromise = fetch(request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const copy = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return networkResponse;
                }).catch(() => null);

                return cachedResponse || fetchPromise;
            })
        );
        return;
    }

    // Default fallback to network
    event.respondWith(
        fetch(request).catch(() => caches.match(request))
    );
});
