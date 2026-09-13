/**
 * Instant Navigation & Prefetching Engine for Spider-Verse Operations Portal
 * Pre-warms cache and prefetches tabs on hover/touch so switching is instantaneous (< 20ms).
 */
(function() {
    'use strict';

    const prefetched = new Set();
    let hoverTimer = null;

    function prefetchUrl(rawUrl) {
        if (!rawUrl) return;
        try {
            const u = new URL(rawUrl, window.location.origin);
            // Only prefetch same-origin URLs
            if (u.origin !== window.location.origin) return;
            // Don't prefetch current page
            if (u.pathname === window.location.pathname) return;
            // Don't prefetch APIs, assets, or non-HTML pages
            if (u.pathname.startsWith('/api/') || (u.pathname.includes('.') && !u.pathname.endsWith('.html'))) {
                return;
            }
            if (prefetched.has(u.pathname)) return;
            prefetched.add(u.pathname);

            // 1. Browser-native link prefetch
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = u.pathname;
            link.as = 'document';
            document.head.appendChild(link);

            // 2. Fetch with low priority to populate HTTP cache across all browsers
            if (window.fetch) {
                fetch(u.pathname, { priority: 'low', cache: 'default' }).catch(() => {});
            }
        } catch(e) {}
    }

    // Attach listeners on mouseover and touchstart
    function initPrefetchListeners() {
        document.addEventListener('mouseover', (e) => {
            const a = e.target.closest('a');
            if (!a || !a.href) return;
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => {
                prefetchUrl(a.href);
            }, 50); // 50ms intent delay avoids spamming on quick mouse sweeps
        }, { passive: true });

        document.addEventListener('touchstart', (e) => {
            const a = e.target.closest('a');
            if (a && a.href) {
                prefetchUrl(a.href);
            }
        }, { passive: true });
    }

    // Pre-warm the most visited faction dashboard tabs during idle time
    function prewarmPrimaryTabs() {
        const topTabs = [
            '/',
            '/chain.html',
            '/oc.html',
            '/members.html',
            '/dashboard.html',
            '/payout.html',
            '/company.html',
            '/travel.html',
            '/discord.html'
        ];

        let index = 0;
        function prewarmNext() {
            if (index >= topTabs.length) return;
            const tab = topTabs[index++];
            if (tab !== window.location.pathname) {
                prefetchUrl(tab);
            }
            if ('requestIdleCallback' in window) {
                requestIdleCallback(prewarmNext, { timeout: 1500 });
            } else {
                setTimeout(prewarmNext, 400);
            }
        }

        // Start prewarming after current page finishes rendering
        if ('requestIdleCallback' in window) {
            requestIdleCallback(prewarmNext, { timeout: 2500 });
        } else {
            setTimeout(prewarmNext, 800);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initPrefetchListeners();
            prewarmPrimaryTabs();
        });
    } else {
        initPrefetchListeners();
        prewarmPrimaryTabs();
    }
})();
