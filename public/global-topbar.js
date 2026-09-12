/**
 * Torn Operations Portal — Universal Topbar & Sidebar Driver (v3.0)
 * Synchronizes TCT Clock, WebSocket indicators, user session badges, and navigation state.
 */
(function() {
    'use strict';

    // 1. TCT Clock (Torn City Time = UTC)
    function tickTCT() {
        const now = new Date();
        const h = String(now.getUTCHours()).padStart(2, '0');
        const m = String(now.getUTCMinutes()).padStart(2, '0');
        const s = String(now.getUTCSeconds()).padStart(2, '0');
        const timeStr = `${h}:${m}:${s}`;
        
        const clockEls = document.querySelectorAll('#global-tct-clock, .tct-clock-val');
        clockEls.forEach(el => { el.textContent = timeStr; });
    }
    setInterval(tickTCT, 1000);
    tickTCT();

    // 2. User Session & Identity Loader
    async function syncUserIdentity() {
        let user = null;
        try {
            const cached = sessionStorage.getItem('sv_user');
            if (cached) user = JSON.parse(cached);
        } catch(e) {}

        if (!user) {
            const token = localStorage.getItem('sv_session_token');
            if (token) {
                try {
                    const res = await fetch('/api/auth/me');
                    const data = await res.json();
                    if (data.authenticated && data.user) {
                        user = data.user;
                        sessionStorage.setItem('sv_user', JSON.stringify(user));
                    }
                } catch(e) {}
            }
        }

        if (user) {
            const nameEls = document.querySelectorAll('#nav-user-name, .topbar-user-name');
            const subEls = document.querySelectorAll('#nav-user-sub, .topbar-user-sub');
            const avatarEls = document.querySelectorAll('#nav-user-avatar, .topbar-user-avatar');

            nameEls.forEach(el => { el.textContent = user.playerName || 'Operative'; });
            subEls.forEach(el => {
                const fac = user.factionName ? `${user.factionName} [${user.factionId}]` : 'Torn Citizen';
                el.textContent = fac;
            });
            avatarEls.forEach(el => {
                if (user.playerName) el.textContent = user.playerName.charAt(0).toUpperCase();
            });
        }
    }

    // 3. Sidebar Toggle & State Persistence
    window.toggleSidebar = function() {
        const sidebar = document.getElementById('app-sidebar') || document.querySelector('.sidebar');
        if (!sidebar) return;

        if (window.innerWidth <= 960) {
            const navItems = sidebar.querySelector('.nav-items');
            if (navItems) navItems.classList.toggle('mobile-open');
        } else {
            sidebar.classList.toggle('collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem('sv_sidebar_collapsed', isCollapsed ? '1' : '0');
        }
    };

    // 4. Dark / Light Theme Toggle
    window.toggleTheme = function() {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        localStorage.setItem('sv_theme', isLight ? 'light' : 'dark');
    };

    // Restore saved sidebar & theme states on load
    document.addEventListener('DOMContentLoaded', () => {
        if (localStorage.getItem('sv_theme') === 'light') {
            document.body.classList.add('light-mode');
        }
        if (window.innerWidth > 960 && localStorage.getItem('sv_sidebar_collapsed') === '1') {
            const sidebar = document.getElementById('app-sidebar') || document.querySelector('.sidebar');
            if (sidebar) sidebar.classList.add('collapsed');
        }
        syncUserIdentity();
    });

    // 5. Global WebSocket Badge Updater Helper
    window.updateBroadcasterBadge = function(status, isLive) {
        const badge = document.getElementById('global-ws-badge');
        const text = document.getElementById('global-ws-status');
        if (!badge || !text) return;

        if (isLive) {
            badge.className = 'telemetry-chip live-ws';
            text.textContent = status || 'LIVE WS';
        } else {
            badge.className = 'telemetry-chip polling';
            text.textContent = status || 'POLLING';
        }
    };
})();
