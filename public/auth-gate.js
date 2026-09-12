/**
 * Torn Operations Portal — Universal Authentication & Access Gatekeeper
 * 
 * Multi-tenant, session-based Torn authentication.
 * - API keys are never stored in client-side localStorage, sessionStorage, or URLs.
 * - Authenticates with server via secure session tokens (x-session-token).
 * - Distinguishes between Spider-Verse [52355] specific modules and public Torn tools.
 * - Never blurs or locks the site for public pages or external faction members.
 */
(function() {
    'use strict';

    const SPIDERVERSE_FACTION_ID = '52355';
    const SPIDERVERSE_PAGES = [
        '/',
        '/index.html',
        '/chain.html',
        '/oc.html',
        '/payout.html',
        '/discord.html',
        '/members.html',
        '/ai-sandbox.html'
    ];

    // Immediately purge any legacy client-side API key storage
    try {
        localStorage.removeItem('warboard_apikey');
        localStorage.removeItem('tornApiKey');
    } catch(e) {}

    // ─────────────────────────────────────────────────────────────
    // Fetch Interceptor: Automatically injects x-session-token
    // ─────────────────────────────────────────────────────────────
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
        const token = localStorage.getItem('sv_session_token');
        if (token && typeof url === 'string' && (url.startsWith('/api/') || url.startsWith('http://' + window.location.host + '/api/') || url.startsWith('https://' + window.location.host + '/api/'))) {
            options = Object.assign({}, options);
            if (!options.headers) {
                options.headers = { 'x-session-token': token };
            } else if (options.headers instanceof Headers) {
                if (!options.headers.has('x-session-token')) {
                    options.headers.append('x-session-token', token);
                }
            } else if (Array.isArray(options.headers)) {
                options.headers.push(['x-session-token', token]);
            } else {
                if (!options.headers['x-session-token']) {
                    options.headers['x-session-token'] = token;
                }
            }
        }
        return originalFetch.call(this, url, options);
    };

    // Inject styles
    const styles = `
    <style id="sv-auth-styles">
        #sv-auth-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(10, 12, 18, 0.88);
            backdrop-filter: blur(12px);
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #fff;
            padding: 20px;
            box-sizing: border-box;
        }
        .sv-auth-card {
            background: linear-gradient(145deg, #151922, #0d1117);
            border: 1px solid rgba(0, 206, 201, 0.35);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 35px rgba(0, 206, 201, 0.15);
            border-radius: 16px;
            width: 100%;
            max-width: 480px;
            padding: 34px 30px;
            text-align: center;
            position: relative;
            animation: svFadeIn 0.25s ease-out;
            box-sizing: border-box;
        }
        @keyframes svFadeIn {
            from { opacity: 0; transform: translateY(-12px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .sv-auth-close-btn {
            position: absolute;
            top: 14px;
            right: 16px;
            background: none;
            border: none;
            color: #747d8c;
            font-size: 1.5rem;
            cursor: pointer;
            line-height: 1;
            padding: 4px 8px;
            border-radius: 6px;
            transition: color 0.2s;
        }
        .sv-auth-close-btn:hover {
            color: #fff;
        }
        .sv-auth-avatar {
            width: 76px;
            height: 76px;
            border-radius: 50%;
            border: 2px solid #00cec9;
            box-shadow: 0 0 20px rgba(0, 206, 201, 0.35);
            margin: 0 auto 16px;
            display: block;
            object-fit: cover;
        }
        .sv-auth-title {
            font-size: 1.35rem;
            font-weight: 800;
            color: #f1f2f6;
            margin: 0 0 6px;
        }
        .sv-auth-subtitle {
            font-size: 0.82rem;
            color: #00cec9;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            font-weight: 700;
            margin-bottom: 16px;
        }
        .sv-auth-desc {
            font-size: 0.88rem;
            color: #a4b0be;
            line-height: 1.5;
            margin-bottom: 22px;
            text-align: left;
        }
        .sv-auth-input-group {
            text-align: left;
            margin-bottom: 18px;
        }
        .sv-auth-input-group label {
            display: block;
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #747d8c;
            margin-bottom: 8px;
            font-weight: 700;
        }
        .sv-auth-input {
            width: 100%;
            padding: 12px 14px;
            background: #080a0f;
            border: 1px solid #2f3542;
            border-radius: 8px;
            color: #fff;
            font-size: 0.95rem;
            outline: none;
            box-sizing: border-box;
            transition: border-color 0.2s, box-shadow 0.2s;
            font-family: monospace;
        }
        .sv-auth-input:focus {
            border-color: #00cec9;
            box-shadow: 0 0 10px rgba(0, 206, 201, 0.3);
        }
        .sv-auth-btn {
            width: 100%;
            padding: 13px;
            background: linear-gradient(135deg, #00cec9, #0984e3);
            border: none;
            border-radius: 8px;
            color: #fff;
            font-size: 0.98rem;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        .sv-auth-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0, 206, 201, 0.35);
        }
        .sv-auth-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .sv-auth-alert {
            margin-top: 16px;
            padding: 12px 14px;
            border-radius: 8px;
            font-size: 0.85rem;
            line-height: 1.4;
            display: none;
            text-align: left;
        }
        .sv-auth-alert.error {
            background: rgba(255, 71, 87, 0.15);
            border: 1px solid #ff4757;
            color: #ff6b81;
            display: block;
        }
        .sv-auth-alert.success {
            background: rgba(46, 213, 115, 0.15);
            border: 1px solid #2ed573;
            color: #2ed573;
            display: block;
        }
        .sv-restricted-banner {
            margin: 16px 20px 24px;
            padding: 18px 22px;
            background: rgba(255, 165, 2, 0.1);
            border: 1px solid rgba(255, 165, 2, 0.35);
            border-radius: 12px;
            color: #f1f2f6;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .sv-restricted-header {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 1.05rem;
            font-weight: 700;
            color: #ffa502;
        }
        .sv-restricted-body {
            font-size: 0.88rem;
            color: #ced6e0;
            line-height: 1.5;
        }
        .sv-restricted-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 4px;
        }
        .sv-restricted-btn {
            background: rgba(0, 206, 201, 0.15);
            border: 1px solid rgba(0, 206, 201, 0.4);
            color: #00cec9;
            padding: 8px 14px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 0.82rem;
            font-weight: 600;
            transition: all 0.2s;
        }
        .sv-restricted-btn:hover {
            background: rgba(0, 206, 201, 0.25);
            color: #fff;
        }
        .sv-badge-container {
            padding: 8px 12px;
            margin: 8px 10px;
            background: rgba(0, 206, 201, 0.08);
            border: 1px solid rgba(0, 206, 201, 0.25);
            border-radius: 8px;
            font-size: 0.78rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
    </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);

    // Identify current page path
    function getCurrentPath() {
        const path = window.location.pathname.toLowerCase();
        if (path === '' || path === '/') return '/index.html';
        return path;
    }

    function isSpiderVerseRestrictedPage() {
        const p = getCurrentPath();
        return SPIDERVERSE_PAGES.includes(p) || p.endsWith('index.html') || p.endsWith('chain.html') || p.endsWith('oc.html') || p.endsWith('payout.html') || p.endsWith('discord.html') || p.endsWith('members.html') || p.endsWith('ai-sandbox.html');
    }

    // Auth State
    let currentUser = null;

    async function checkAuth() {
        const token = localStorage.getItem('sv_session_token');
        if (!token) {
            handleUnauthenticated();
            return;
        }

        try {
            const res = await fetch('/api/auth/me', {
                headers: { 'x-session-token': token }
            });
            const data = await res.json();

            if (data && data.authenticated && data.user) {
                currentUser = data.user;
                sessionStorage.setItem('sv_user', JSON.stringify(currentUser));
                handleAuthenticated(currentUser);
            } else {
                localStorage.removeItem('sv_session_token');
                sessionStorage.removeItem('sv_user');
                handleUnauthenticated();
            }
        } catch(err) {
            console.warn('[Torn Auth] Auth verification failed:', err);
            handleUnauthenticated();
        }
    }

    function handleAuthenticated(user) {
        injectUserBadge(user);

        const isRestricted = isSpiderVerseRestrictedPage();
        if (isRestricted && !user.isSpiderVerse) {
            renderRestrictedBanner(user);
        } else {
            // Authorized! Trigger page initialization functions if present
            if (typeof window.startPolling === 'function') window.startPolling();
            if (typeof window.initPage === 'function') window.initPage();
            if (typeof window.loadAll === 'function') window.loadAll();
            if (typeof window.loadRoster === 'function') window.loadRoster();
        }
    }

    function handleUnauthenticated() {
        const isRestricted = isSpiderVerseRestrictedPage();
        if (isRestricted) {
            // Prompt modal on restricted modules
            showConnectModal(false);
        } else {
            // For public tools, inject a clean "Connect Torn Key" button in the sidebar or header
            injectConnectButton();
            // Trigger public page load anyway so users can see public elements
            if (typeof window.initPage === 'function') window.initPage();
            if (typeof window.loadAll === 'function') window.loadAll();
        }
    }

    function renderRestrictedBanner(user) {
        if (document.getElementById('sv-restricted-banner')) return;

        const mainContent = document.querySelector('.main-content') || document.querySelector('#main-content') || document.querySelector('.container') || document.body;
        const banner = document.createElement('div');
        banner.id = 'sv-restricted-banner';
        banner.className = 'sv-restricted-banner';
        banner.innerHTML = `
            <div class="sv-restricted-header">
                <span>🔒 Spider-Verse Faction Restricted Module</span>
            </div>
            <div class="sv-restricted-body">
                Hello <strong>${user.playerName} [${user.playerId}]</strong>! You are currently connected with <strong>${user.factionName || 'Factionless'} [ID: ${user.factionId || '0'}]</strong>. 
                This tactical warboard module is dedicated to Spider-Verse [52355]. As a visitor, you have unrestricted access to all our public Torn operations tools below!
            </div>
            <div class="sv-restricted-actions">
                <a href="/dashboard.html" class="sv-restricted-btn">📊 Personal Dashboard</a>
                <a href="/travel.html" class="sv-restricted-btn">✈️ Travel Calculator</a>
                <a href="/bazaar.html" class="sv-restricted-btn">🏪 Bazaar Tracker</a>
                <a href="/gamble.html" class="sv-restricted-btn">🎲 Casino Tools</a>
                <a href="/company.html" class="sv-restricted-btn">🏢 Company Tools</a>
                <a href="#" id="sv-banner-switch-btn" class="sv-restricted-btn" style="border-color: rgba(255,107,129,0.5); color: #ff6b81;">🔄 Switch Account / Logout</a>
            </div>
        `;

        if (mainContent.firstChild) {
            mainContent.insertBefore(banner, mainContent.firstChild);
        } else {
            mainContent.appendChild(banner);
        }

        const switchBtn = document.getElementById('sv-banner-switch-btn');
        if (switchBtn) {
            switchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                logout();
            });
        }
    }

    function injectUserBadge(user) {
        if (document.getElementById('sv-user-badge')) return;

        const container = document.querySelector('.sidebar-header') || document.querySelector('.header') || document.querySelector('header') || document.querySelector('.sidebar');
        if (!container) return;

        const badge = document.createElement('div');
        badge.id = 'sv-user-badge';
        badge.className = 'sv-badge-container';
        const facDisplay = user.isSpiderVerse 
            ? '<span style="color: #ff4757; font-weight:700;">🕷️ Spider-Verse [52355]</span>' 
            : (user.factionId && user.factionId !== '0' ? `<span style="color: #00cec9;">${user.factionName} [${user.factionId}]</span>` : '<span style="color: #a4b0be;">Factionless</span>');

        badge.innerHTML = `
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;">
                <div style="color: #f1f2f6; font-weight: 700; font-size: 0.8rem;">${user.playerName} [${user.playerId}]</div>
                <div style="font-size: 0.68rem;">${facDisplay}</div>
            </div>
            <a href="#" id="sv-logout-link" title="Logout" style="color: #ff6b81; text-decoration: none; font-size: 0.72rem; padding: 3px 8px; border: 1px solid rgba(255,107,129,0.35); border-radius: 4px; transition: all 0.2s;">Logout</a>
        `;

        container.appendChild(badge);

        const logoutLink = document.getElementById('sv-logout-link');
        if (logoutLink) {
            logoutLink.addEventListener('click', (e) => {
                e.preventDefault();
                if (confirm('Log out of Torn Operations Hub?')) {
                    logout();
                }
            });
        }
    }

    function injectConnectButton() {
        if (document.getElementById('sv-connect-badge')) return;

        const container = document.querySelector('.sidebar-header') || document.querySelector('.header') || document.querySelector('header') || document.querySelector('.sidebar');
        if (!container) return;

        const btn = document.createElement('div');
        btn.id = 'sv-connect-badge';
        btn.className = 'sv-badge-container';
        btn.style.cursor = 'pointer';
        btn.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px; color:#00cec9; font-weight:700;">
                <span>🔑</span> <span>Connect Torn Key</span>
            </div>
            <span style="color:#a4b0be; font-size:0.75rem;">&rarr;</span>
        `;
        btn.addEventListener('click', () => showConnectModal(true));
        container.appendChild(btn);
    }

    function showConnectModal(allowClose = true) {
        if (document.getElementById('sv-auth-modal-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'sv-auth-modal-overlay';
        overlay.innerHTML = `
            <div class="sv-auth-card">
                ${allowClose ? '<button class="sv-auth-close-btn" id="sv-modal-close">&times;</button>' : ''}
                <img src="/friday_avatar.jpg" alt="Portal Sentinel" class="sv-auth-avatar" onerror="this.src='/favicon.ico'">
                <div class="sv-auth-title">🕷️ Torn Operations Hub</div>
                <div class="sv-auth-subtitle">Connect Your Torn Account</div>
                <p class="sv-auth-desc">
                    Enter your Torn API Key to access personal analytics, market tracking, and tactical modules. 
                    <strong>Your API key is never stored in your browser</strong> — it is encrypted and held safely server-side.
                </p>
                <div class="sv-auth-input-group">
                    <label>Torn API Key (Public / Read-Only or Limited)</label>
                    <input type="password" id="sv-modal-key-input" class="sv-auth-input" placeholder="Paste your 16-character Torn API key..." autocomplete="off">
                </div>
                <button id="sv-modal-connect-btn" class="sv-auth-btn">
                    <span>⚡ Connect & Verify Account</span>
                </button>
                <div id="sv-modal-alert" class="sv-auth-alert"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        const closeBtn = document.getElementById('sv-modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => overlay.remove());
        }

        const input = document.getElementById('sv-modal-key-input');
        const submitBtn = document.getElementById('sv-modal-connect-btn');
        const alertBox = document.getElementById('sv-modal-alert');

        async function doConnect() {
            const key = input.value.trim();
            if (!key) {
                alertBox.className = 'sv-auth-alert error';
                alertBox.innerHTML = '⚠️ Please paste a valid Torn API key.';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>⏳ Authenticating with Torn API...</span>';
            alertBox.className = 'sv-auth-alert';
            alertBox.style.display = 'none';

            try {
                const res = await fetch('/api/auth/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey: key })
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Authentication failed');
                }

                // Success! Store session token ONLY (never the raw API key)
                localStorage.setItem('sv_session_token', data.sessionToken);
                sessionStorage.setItem('sv_user', JSON.stringify(data.user));
                currentUser = data.user;

                alertBox.className = 'sv-auth-alert success';
                alertBox.innerHTML = `✅ Welcome, <strong>${data.user.playerName}</strong>! Redirecting...`;

                setTimeout(() => {
                    overlay.remove();
                    window.location.reload();
                }, 700);

            } catch(err) {
                alertBox.className = 'sv-auth-alert error';
                alertBox.innerHTML = `⚠️ ${err.message}`;
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span>⚡ Connect & Verify Account</span>';
            }
        }

        submitBtn.addEventListener('click', doConnect);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doConnect(); });
        input.focus();
    }

    async function logout() {
        const token = localStorage.getItem('sv_session_token');
        if (token) {
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'x-session-token': token }
                });
            } catch(e) {}
        }
        localStorage.removeItem('sv_session_token');
        localStorage.removeItem('sv_session');
        localStorage.removeItem('warboard_apikey');
        sessionStorage.clear();
        window.location.reload();
    }

    // Public API
    window.svAuth = {
        getUser: () => currentUser,
        getToken: () => localStorage.getItem('sv_session_token'),
        openModal: () => showConnectModal(true),
        logout
    };
    window.svLogout = logout;

    // Run on DOM ready
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', checkAuth);
    } else {
        checkAuth();
    }
})();
