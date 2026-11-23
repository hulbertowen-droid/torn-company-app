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
        
        const clockEls = document.querySelectorAll('#global-tct-clock, #topbar-tct-clock, .tct-clock-val, .topbar-clock');
        clockEls.forEach(el => {
            if (el.id === 'global-tct-clock') {
                // Paired inside .tct-clock-chip alongside <span class="tct-label">TCT</span>
                el.textContent = timeStr;
            } else if (el.id === 'topbar-tct-clock' || el.classList.contains('topbar-clock')) {
                el.textContent = `${timeStr} TCT`;
            } else {
                el.textContent = timeStr;
            }
        });
    }
    setInterval(tickTCT, 1000);
    tickTCT();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tickTCT);
    } else {
        tickTCT();
    }

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
            const nameEls = document.querySelectorAll('#nav-user-name, .topbar-user-name, #topbar-user-name, .user-name-label');
            const subEls = document.querySelectorAll('#nav-user-sub, .topbar-user-sub');
            const avatarEls = document.querySelectorAll('#nav-user-avatar, .topbar-user-avatar, .brand-avatar');

            nameEls.forEach(el => { el.textContent = user.playerName || 'Operative'; });
            subEls.forEach(el => {
                const fac = user.factionName ? `${user.factionName} [${user.factionId}]` : 'Torn Citizen';
                el.textContent = fac;
            });
            avatarEls.forEach(el => {
                if (user.playerName && !el.textContent.includes('🕷️')) {
                    el.textContent = user.playerName.charAt(0).toUpperCase();
                }
            });
            if (user.factionName) {
                document.querySelectorAll('.brand-text').forEach(el => {
                    if (el.textContent === 'Spider-Verse' || el.textContent === 'Faction Operations' || el.textContent === 'Faction Portal') {
                        el.textContent = user.factionName;
                    }
                });
            }
        }
    }

    // 3. Sidebar Toggle, iOS Slide-Over Drawer & State Persistence
    function getPageShortTitle() {
        const p = window.location.pathname.toLowerCase();
        if (p === '/' || p.includes('index')) return 'Warboard';
        if (p.includes('chain')) return 'Chain Sentinel';
        if (p.includes('dashboard')) return 'Operations';
        if (p.includes('armory')) return 'Armory';
        if (p.includes('gym')) return 'Gym Stats';
        if (p.includes('payout')) return 'War Payouts';
        if (p.includes('oc.html')) return 'OC 2.0';
        if (p.includes('travel')) return 'Travel Radar';
        if (p.includes('company')) return 'Company';
        if (p.includes('gamble')) return 'Casino Hub';
        if (p.includes('discord')) return 'Discord Bot';
        if (p.includes('bugs')) return 'Bug Tracker';
        return 'FactionOS';
    }

    function escHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function getMobileAccountInfo() {
        const u = (window.svAuth && typeof window.svAuth.getUser === 'function' && window.svAuth.getUser())
            || (typeof window.getUserProfile === 'function' && window.getUserProfile())
            || null;
        if (u && (u.playerName || u.playerId)) {
            return {
                signedIn: true,
                name: u.playerName || `Player #${u.playerId}`,
                faction: u.factionName || (u.factionId ? `Faction #${u.factionId}` : 'Torn Session')
            };
        }
        try {
            const raw = sessionStorage.getItem('sv_user') || localStorage.getItem('sv_user');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && (parsed.playerName || parsed.playerId)) {
                    return {
                        signedIn: true,
                        name: parsed.playerName || `Player #${parsed.playerId}`,
                        faction: parsed.factionName || (parsed.factionId ? `Faction #${parsed.factionId}` : 'Torn Session')
                    };
                }
            }
        } catch (_) {}
        const lsName = localStorage.getItem('warboard_myname');
        if (lsName) {
            return {
                signedIn: true,
                name: lsName,
                faction: localStorage.getItem('warboard_myFactionName') || 'Torn Session'
            };
        }
        return { signedIn: false, name: 'Not Connected', faction: 'Tap Connect for API session' };
    }

    window.__iosGetAccountBarMarkup = function(idPrefix) {
        const acct = getMobileAccountInfo();
        const dotStyle = acct.signedIn ? '' : 'style="background:#f59e0b;box-shadow:0 0 8px rgba(245,158,11,0.7);"';
        const btn = acct.signedIn
            ? `<button type="button" class="ios-account-action" data-ios-logout="1">Logout</button>`
            : `<button type="button" class="ios-account-action connect" data-ios-connect="1">Connect Key</button>`;
        return `
            <div class="ios-account-meta">
                <span class="ios-account-dot" ${dotStyle}></span>
                <div style="min-width:0;">
                    <div class="ios-account-name">${escHtml(acct.name)}</div>
                    <div class="ios-account-sub">${escHtml(acct.faction)}</div>
                </div>
            </div>
            ${btn}
        `;
    };

    window.__iosBindAccountActions = function(container, onActionDone) {
        if (!container) return;
        const logoutBtn = container.querySelector('[data-ios-logout]');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                if (typeof onActionDone === 'function') onActionDone();
                if (typeof window.svLogout === 'function') window.svLogout();
                else if (window.svAuth && typeof window.svAuth.logout === 'function') window.svAuth.logout();
            });
        }
        const connectBtn = container.querySelector('[data-ios-connect]');
        if (connectBtn) {
            connectBtn.addEventListener('click', () => {
                if (typeof onActionDone === 'function') onActionDone();
                if (typeof window.showConnectModal === 'function') window.showConnectModal(true);
                else if (window.svAuth && typeof window.svAuth.openModal === 'function') window.svAuth.openModal();
            });
        }
    };

    function syncMobileDrawerAccount(sidebar) {
        if (!sidebar) return;
        let card = sidebar.querySelector('#mobile-drawer-account');
        if (!card) {
            card = document.createElement('div');
            card.id = 'mobile-drawer-account';
            card.className = 'mobile-drawer-account';
            const header = sidebar.querySelector('.sidebar-header');
            if (header && header.nextSibling) sidebar.insertBefore(card, header.nextSibling);
            else sidebar.prepend(card);
        }
        card.innerHTML = window.__iosGetAccountBarMarkup('drawer');
        window.__iosBindAccountActions(card, () => {
            if (window.innerWidth <= 960) window.toggleSidebar(false);
        });
    }

    function ensureMobileDrawerSupport() {
        const topbarLeft = document.querySelector('.app-topbar .topbar-left');
        if (topbarLeft && !topbarLeft.querySelector('.topbar-mobile-brand')) {
            const brandEl = document.createElement('span');
            brandEl.className = 'topbar-mobile-brand';
            brandEl.innerHTML = `<span style="font-size:1.05em;">🕷️</span><span>${getPageShortTitle()}</span>`;
            topbarLeft.appendChild(brandEl);
        }

        const sidebar = document.getElementById('app-sidebar') || document.querySelector('.sidebar');
        if (!sidebar) return null;

        syncMobileDrawerAccount(sidebar);

        let backdrop = document.getElementById('mobile-drawer-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'mobile-drawer-backdrop';
            backdrop.className = 'mobile-drawer-backdrop';
            document.body.appendChild(backdrop);
            backdrop.addEventListener('click', () => window.toggleSidebar(false));
        }

        if (!sidebar.dataset.iosSwipeBound) {
            sidebar.dataset.iosSwipeBound = '1';
            let startX = 0;
            let startY = 0;
            let tracking = false;
            sidebar.addEventListener('touchstart', (e) => {
                if (window.innerWidth > 960 || !sidebar.classList.contains('mobile-drawer-open')) return;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                tracking = true;
            }, { passive: true });
            sidebar.addEventListener('touchmove', (e) => {
                if (!tracking) return;
                const dx = e.touches[0].clientX - startX;
                const dy = Math.abs(e.touches[0].clientY - startY);
                if (dy > Math.abs(dx) * 1.4) { tracking = false; return; }
                if (dx < -10) {
                    sidebar.style.transition = 'none';
                    sidebar.style.transform = `translateX(${dx}px)`;
                }
            }, { passive: true });
            sidebar.addEventListener('touchend', (e) => {
                if (!tracking) return;
                tracking = false;
                sidebar.style.transition = '';
                sidebar.style.transform = '';
                const dx = (e.changedTouches?.[0]?.clientX || startX) - startX;
                if (dx < -65) window.toggleSidebar(false);
            }, { passive: true });

            sidebar.querySelectorAll('.nav-link').forEach(link => {
                link.addEventListener('click', () => {
                    if (window.innerWidth <= 960) window.toggleSidebar(false);
                });
            });
        }
        return backdrop;
    }

    function syncTopbarToggleVisibility() {
        const sidebar = document.getElementById('app-sidebar') || document.querySelector('.sidebar');
        const topToggle = document.getElementById('mobile-nav-toggle');
        if (!sidebar || !topToggle) return;
        const isCollapsed = sidebar.classList.contains('collapsed');
        if (window.innerWidth > 960) {
            topToggle.style.display = isCollapsed ? 'inline-flex' : 'none';
            topToggle.title = isCollapsed ? 'Expand Sidebar' : 'Toggle Sidebar';
        } else {
            topToggle.style.display = '';
        }
    }

    window.toggleSidebar = function(forceOpen) {
        const sidebar = document.getElementById('app-sidebar') || document.querySelector('.sidebar');
        if (!sidebar) return;

        if (window.innerWidth <= 960) {
            const backdrop = ensureMobileDrawerSupport();
            const navItems = sidebar.querySelector('.nav-items');
            const isOpen = sidebar.classList.contains('mobile-drawer-open');
            const next = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;
            sidebar.classList.toggle('mobile-drawer-open', next);
            if (navItems) navItems.classList.toggle('mobile-open', next);
            if (backdrop) backdrop.classList.toggle('open', next);
            if (navigator.vibrate) try { navigator.vibrate(6); } catch(_) {}
        } else {
            sidebar.classList.toggle('collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem('sv_sidebar_collapsed', isCollapsed ? '1' : '0');
            syncTopbarToggleVisibility();
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
        const savedTheme = localStorage.getItem('sv_theme') || localStorage.getItem('theme') || localStorage.getItem('warboard_theme');
        if (savedTheme === 'light' || savedTheme === 'light-mode') {
            document.body.classList.add('light-mode');
            localStorage.setItem('sv_theme', 'light');
        }
        const savedCollapsed = localStorage.getItem('sv_sidebar_collapsed') === '1' || localStorage.getItem('sidebar_collapsed') === 'true';
        if (window.innerWidth > 960 && savedCollapsed) {
            const sidebar = document.getElementById('app-sidebar') || document.querySelector('.sidebar');
            if (sidebar) sidebar.classList.add('collapsed');
            localStorage.setItem('sv_sidebar_collapsed', '1');
        }
        syncTopbarToggleVisibility();
        ensureMobileDrawerSupport();
        window.addEventListener('resize', syncTopbarToggleVisibility);
        syncUserIdentity();
        // Ensure bottom-left Helper AI Co-Pilot is loaded on every page
        if (!window.__fridayHelperLoaded && !document.querySelector('script[src*="/friday-helper.js"]')) {
            const s = document.createElement('script');
            s.src = '/friday-helper.js?v=4.4.0';
            s.defer = true;
            document.head.appendChild(s);
        }
        // Ensure F.R.I.D.A.Y. Boot Intro module is available on all pages for Settings / Helper replay
        if (!window.__fridayIntroEngineLoaded && !document.querySelector('script[src*="/friday-intro.js"]')) {
            const introScript = document.createElement('script');
            introScript.src = '/friday-intro.js?v=1.0.0';
            introScript.defer = true;
            document.head.appendChild(introScript);
        }
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
