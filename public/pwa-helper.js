/**
 * FactionOS — Progressive Web App & Mobile Optimization Helper
 * Service Worker registration, mobile bottom navigation, and native install prompts for Android & iOS.
 */

(function () {
    'use strict';

    // 1. Detect Standalone / Installed State
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         window.navigator.standalone === true ||
                         document.referrer.includes('android-app://');

    if (isStandalone) {
        document.documentElement.classList.add('pwa-standalone');
    }

    // 2. Service Worker Registration
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js', { scope: '/' })
                .then((reg) => {
                    // Check for updates
                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        if (newWorker) {
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    console.log('[FactionOS PWA] New version available.');
                                }
                            });
                        }
                    });
                })
                .catch((err) => {
                    console.warn('[FactionOS PWA] SW registration failed:', err);
                });
        });
    }

    // 3. Android PWA Install Prompt (beforeinstallprompt)
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        
        // Don't show if user dismissed recently (within 48 hours)
        const dismissedAt = localStorage.getItem('factionos_pwa_dismissed');
        if (dismissedAt && (Date.now() - parseInt(dismissedAt, 10) < 48 * 3600 * 1000)) {
            return;
        }

        renderInstallBanner('android');
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        removeInstallBanner();
        console.log('[FactionOS PWA] App successfully installed!');
    });

    // 4. iOS "Add to Home Screen" Detection
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(navigator.userAgent);

    if (isIOS && isSafari && !isStandalone) {
        const iosDismissedAt = localStorage.getItem('factionos_ios_prompt_dismissed');
        if (!iosDismissedAt || (Date.now() - parseInt(iosDismissedAt, 10) > 72 * 3600 * 1000)) {
            // Delay banner slightly to not overwhelm on first second
            setTimeout(() => {
                if (!document.getElementById('pwa-install-banner')) {
                    renderInstallBanner('ios');
                }
            }, 3000);
        }
    }

    // Render Install Banner
    function isPwaBannerDismissed() {
        try {
            if (sessionStorage.getItem('factionos_pwa_dismissed') === '1') return true;
            const d1 = parseInt(localStorage.getItem('factionos_pwa_dismissed') || '0', 10);
            const d2 = parseInt(localStorage.getItem('factionos_ios_prompt_dismissed') || '0', 10);
            const latest = Math.max(d1 || 0, d2 || 0);
            if (latest > 0 && (Date.now() - latest < 7 * 24 * 3600 * 1000)) return true;
        } catch (_) {}
        return false;
    }

    function dismissInstallBannerPermanently(e) {
        if (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        }
        try {
            const nowStr = Date.now().toString();
            localStorage.setItem('factionos_pwa_dismissed', nowStr);
            localStorage.setItem('factionos_ios_prompt_dismissed', nowStr);
            sessionStorage.setItem('factionos_pwa_dismissed', '1');
        } catch (_) {}
        removeInstallBanner();
    }
    window.dismissPwaInstallBanner = dismissInstallBannerPermanently;

    function renderInstallBanner(platform) {
        if (document.getElementById('pwa-install-banner') || isStandalone || isPwaBannerDismissed()) return;

        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.className = 'pwa-install-banner animate-slide-up';

        if (platform === 'android') {
            banner.innerHTML = `
                <div class="pwa-banner-content">
                    <img src="/icons/icon-192.png" alt="FactionOS" class="pwa-banner-icon" />
                    <div class="pwa-banner-text">
                        <div class="pwa-banner-title">Install FactionOS App</div>
                        <div class="pwa-banner-desc">Fast, fullscreen tactical command on your home screen.</div>
                    </div>
                </div>
                <div class="pwa-banner-actions">
                    <button type="button" id="pwa-install-btn" class="pwa-btn-primary">Install</button>
                    <button type="button" id="pwa-dismiss-btn" class="pwa-btn-close" aria-label="Dismiss install banner" title="Dismiss" onclick="window.dismissPwaInstallBanner && window.dismissPwaInstallBanner(event)">&times;</button>
                </div>
            `;
        } else if (platform === 'ios') {
            banner.innerHTML = `
                <div class="pwa-banner-content">
                    <img src="/icons/icon-180.png" alt="FactionOS" class="pwa-banner-icon" />
                    <div class="pwa-banner-text">
                        <div class="pwa-banner-title">Install on iPhone / iPad</div>
                        <div class="pwa-banner-desc">Tap <span class="ios-share-badge">Share <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></span> then tap <strong>"Add to Home Screen"</strong></div>
                    </div>
                </div>
                <div class="pwa-banner-actions">
                    <button type="button" id="pwa-dismiss-btn" class="pwa-btn-close" aria-label="Dismiss install banner" title="Dismiss" onclick="window.dismissPwaInstallBanner && window.dismissPwaInstallBanner(event)">&times;</button>
                </div>
            `;
        }

        const mainHost = document.querySelector('.main-content');
        if (mainHost && window.innerWidth <= 768) {
            mainHost.prepend(banner);
        } else {
            document.body.appendChild(banner);
        }

        const installBtn = banner.querySelector('#pwa-install-btn');
        if (installBtn && deferredPrompt) {
            installBtn.addEventListener('click', async () => {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    removeInstallBanner();
                }
                deferredPrompt = null;
            });
        }

        const dismissBtn = banner.querySelector('#pwa-dismiss-btn');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', dismissInstallBannerPermanently);
        }
    }

    function removeInstallBanner() {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) {
            banner.classList.remove('animate-slide-up');
            banner.style.pointerEvents = 'none';
            banner.style.opacity = '0';
            banner.style.setProperty('display', 'none', 'important');
            banner.remove();
        }
    }

    function iosHaptic(ms = 6) {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            try { navigator.vibrate(ms); } catch (_) {}
        }
    }

    // 5. Native Apple iOS Floating Tab Bar (Screens <= 768px)
    function initMobileBottomNav() {
        if (document.getElementById('mobile-bottom-nav')) return;

        const path = window.location.pathname.toLowerCase();
        const isPrimaryTab =
            path === '/' || path === '/index.html' || path === '' ||
            path.includes('armory') || path.includes('gym') || path.includes('chain');

        const nav = document.createElement('nav');
        nav.id = 'mobile-bottom-nav';
        nav.className = 'mobile-bottom-nav';
        nav.setAttribute('aria-label', 'Mobile Navigation');

        const navItems = [
            {
                id: 'nav-warboard',
                label: 'Warboard',
                href: '/index.html',
                icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
                active: path === '/' || path === '/index.html' || path === ''
            },
            {
                id: 'nav-armory',
                label: 'Armory',
                href: '/armory.html',
                icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
                active: path.includes('armory')
            },
            {
                id: 'nav-gym',
                label: 'Gym Stats',
                href: '/gym-stats.html',
                icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 5v14M18 5v14M2 9v6M22 9v6M6 12h12"/></svg>',
                active: path.includes('gym')
            },
            {
                id: 'nav-chain',
                label: 'Chain',
                href: '/chain.html',
                icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
                active: path.includes('chain')
            },
            {
                id: 'nav-menu',
                label: 'Hub',
                href: '#',
                icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
                active: !isPrimaryTab,
                isMenu: true
            }
        ];

        let html = '<div class="mobile-bottom-nav-inner">';
        navItems.forEach(item => {
            html += `
                <a href="${item.href}" class="mobile-nav-item ${item.active ? 'active' : ''}" id="${item.id}" ${item.isMenu ? 'role="button"' : ''}>
                    <div class="mobile-nav-icon">${item.icon}</div>
                    <span class="mobile-nav-label">${item.label}</span>
                </a>
            `;
        });
        html += '</div>';

        nav.innerHTML = html;
        document.body.appendChild(nav);

        nav.querySelectorAll('.mobile-nav-item').forEach(el => {
            el.addEventListener('click', (e) => {
                iosHaptic(6);
                if (el.id === 'nav-menu') {
                    e.preventDefault();
                    toggleMobileAppSheet();
                }
            });
        });
    }

    // 6. Interactive iOS Control Hub Bottom Sheet (with Finger Drag-to-Dismiss Physics)
    function attachSheetDragPhysics(contentEl, onClose) {
        if (!contentEl || contentEl.dataset.dragBound) return;
        contentEl.dataset.dragBound = '1';
        let startY = 0;
        let currentDy = 0;
        let dragging = false;

        contentEl.addEventListener('touchstart', (e) => {
            const canDrag = contentEl.scrollTop <= 2 || e.target.closest('.mobile-sheet-handle, .mobile-sheet-header');
            if (!canDrag) return;
            startY = e.touches[0].clientY;
            currentDy = 0;
            dragging = true;
            contentEl.style.transition = 'none';
        }, { passive: true });

        contentEl.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const dy = e.touches[0].clientY - startY;
            if (dy > 0) {
                currentDy = dy;
                contentEl.style.transform = `translateY(${dy}px)`;
            } else if (currentDy > 0) {
                currentDy = 0;
                contentEl.style.transform = 'translateY(0)';
            }
        }, { passive: true });

        contentEl.addEventListener('touchend', () => {
            if (!dragging) return;
            dragging = false;
            contentEl.style.transition = '';
            contentEl.style.transform = '';
            if (currentDy > 85) {
                iosHaptic(8);
                onClose();
            }
        }, { passive: true });
    }

    function toggleMobileAppSheet() {
        let sheet = document.getElementById('mobile-app-sheet');
        if (sheet) {
            if (sheet.classList.contains('open')) {
                sheet.classList.remove('open');
                setTimeout(() => sheet.remove(), 300);
            } else {
                sheet.classList.add('open');
            }
            return;
        }

        const isLight = document.body.classList.contains('light-mode');
        const accountBarHtml = (typeof window.__iosGetAccountBarMarkup === 'function')
            ? `<div class="ios-hub-account-bar" id="ios-hub-account-bar">${window.__iosGetAccountBarMarkup('hub')}</div>`
            : '';
        sheet = document.createElement('div');
        sheet.id = 'mobile-app-sheet';
        sheet.className = 'mobile-app-sheet';
        sheet.innerHTML = `
            <div class="mobile-sheet-backdrop" id="mobile-sheet-backdrop"></div>
            <div class="mobile-sheet-content">
                <div class="mobile-sheet-handle"></div>
                <div class="mobile-sheet-header">
                    <div class="mobile-sheet-title">🕷️ FactionOS Hub</div>
                    <button class="mobile-sheet-close" id="mobile-sheet-close" aria-label="Close">&times;</button>
                </div>
                ${accountBarHtml}
                <div class="ios-hub-quick-bar">
                    <button type="button" class="ios-quick-widget" id="hub-qa-theme"><span class="w-ico">${isLight ? '🌙' : '☀️'}</span><span>${isLight ? 'Dark' : 'Light'}</span></button>
                    <button type="button" class="ios-quick-widget" id="hub-qa-settings"><span class="w-ico">⚙️</span><span>Settings</span></button>
                    <button type="button" class="ios-quick-widget" id="hub-qa-ai"><span class="w-ico">🤖</span><span>Helper AI</span></button>
                    <button type="button" class="ios-quick-widget" id="hub-qa-refresh"><span class="w-ico">↻</span><span>Refresh</span></button>
                </div>
                <div class="mobile-app-grid">
                    <a href="/index.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(255, 152, 0, 0.16); color: #ff9800;">📡</div>
                        <div class="app-tile-name">Warboard</div>
                    </a>
                    <a href="/dashboard.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(59, 130, 246, 0.16); color: #3b82f6;">📊</div>
                        <div class="app-tile-name">Ops Overview</div>
                    </a>
                    <a href="/armory.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(0, 230, 118, 0.16); color: #00e676;">🛡️</div>
                        <div class="app-tile-name">Armory</div>
                    </a>
                    <a href="/gym-stats.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(0, 176, 255, 0.16); color: #00b0ff;">🏋️</div>
                        <div class="app-tile-name">Gym Tracker</div>
                    </a>
                    <a href="/chain.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(229, 57, 53, 0.16); color: #e53935;">🔗</div>
                        <div class="app-tile-name">Chain Sentinel</div>
                    </a>
                    <a href="/travel.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(171, 71, 188, 0.16); color: #ab47bc;">✈️</div>
                        <div class="app-tile-name">Travel Radar</div>
                    </a>
                    <a href="/gym-stats.html#roster" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(77, 182, 172, 0.16); color: #4db6ac;">👥</div>
                        <div class="app-tile-name">Member Roster</div>
                    </a>
                    <a href="/payout.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(255, 214, 0, 0.16); color: #ffd600;">💰</div>
                        <div class="app-tile-name">War Payout</div>
                    </a>
                    <a href="/oc.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(239, 83, 80, 0.16); color: #ef5350;">🕵️</div>
                        <div class="app-tile-name">OC 2.0</div>
                    </a>
                    <a href="/discord.html#market" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(100, 255, 218, 0.16); color: #64ffda;">🛒</div>
                        <div class="app-tile-name">Market Sniper</div>
                    </a>
                    <a href="/company.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(124, 77, 255, 0.16); color: #7c4dff;">🏢</div>
                        <div class="app-tile-name">Company Hub</div>
                    </a>
                    <a href="/gamble.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(255, 64, 129, 0.16); color: #ff4081;">🎰</div>
                        <div class="app-tile-name">Casino Hub</div>
                    </a>
                    <a href="/discord.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(88, 101, 242, 0.16); color: #5865f2;">💬</div>
                        <div class="app-tile-name">Discord Bot</div>
                    </a>
                    <a href="/bugs.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(255, 171, 64, 0.16); color: #ffab40;">🐛</div>
                        <div class="app-tile-name">Bug Reports</div>
                    </a>
                    <a href="/gym-stats.html#war" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(56, 189, 248, 0.16); color: #38bdf8;">⚡</div>
                        <div class="app-tile-name">Stack Check</div>
                    </a>
                    <a href="javascript:void(0)" onclick="if(window.toggleHudMode){window.toggleHudMode();document.getElementById('mobile-sheet-close')?.click();}" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(245, 158, 11, 0.16); color: #f59e0b;">📟</div>
                        <div class="app-tile-name">Mini HUD</div>
                    </a>
                </div>
            </div>
        `;

        document.body.appendChild(sheet);
        void sheet.offsetWidth;
        sheet.classList.add('open');

        const closeBtn = document.getElementById('mobile-sheet-close');
        const backdrop = document.getElementById('mobile-sheet-backdrop');
        const contentEl = sheet.querySelector('.mobile-sheet-content');
        const closeSheet = () => {
            sheet.classList.remove('open');
            setTimeout(() => sheet.remove(), 300);
        };

        if (closeBtn) closeBtn.addEventListener('click', closeSheet);
        if (backdrop) backdrop.addEventListener('click', closeSheet);
        attachSheetDragPhysics(contentEl, closeSheet);
        if (typeof window.__iosBindAccountActions === 'function') {
            window.__iosBindAccountActions(document.getElementById('ios-hub-account-bar'), closeSheet);
        }

        sheet.querySelectorAll('.mobile-app-tile').forEach(t => {
            t.addEventListener('click', () => iosHaptic(5));
        });
        document.getElementById('hub-qa-theme')?.addEventListener('click', () => {
            iosHaptic(8);
            if (typeof window.toggleTheme === 'function') window.toggleTheme();
            closeSheet();
        });
        document.getElementById('hub-qa-settings')?.addEventListener('click', () => {
            iosHaptic(6);
            closeSheet();
            setTimeout(() => {
                if (typeof window.openGlobalSettings === 'function') window.openGlobalSettings();
                else if (typeof window.openSettings === 'function') window.openSettings();
            }, 120);
        });
        document.getElementById('hub-qa-ai')?.addEventListener('click', () => {
            iosHaptic(6);
            closeSheet();
            setTimeout(() => {
                if (typeof window.toggleFridayHelper === 'function') window.toggleFridayHelper(true);
            }, 120);
        });
        document.getElementById('hub-qa-refresh')?.addEventListener('click', () => {
            iosHaptic(10);
            closeSheet();
            triggerSmartPageRefresh();
        });
    }

    function triggerSmartPageRefresh() {
        try {
            if (typeof window.fetchWarboard === 'function') return window.fetchWarboard();
            if (typeof window.loadOcData === 'function') return window.loadOcData(true);
            if (typeof window.syncGymData === 'function') return window.syncGymData(true);
            if (typeof window.loadAll === 'function') return window.loadAll();
            if (typeof window.fetchCompanyData === 'function') return window.fetchCompanyData();
        } catch (_) {}
        window.location.reload();
    }

    // 7. iOS Pull-to-Refresh & Auto-Center Segmented Tabs
    function initIosPullToRefresh() {
        if (!('ontouchstart' in window) || window.innerWidth > 960) return;
        const pill = document.createElement('div');
        pill.id = 'ios-ptr-pill';
        pill.className = 'ios-ptr-pill';
        pill.innerHTML = '<span class="ios-ptr-spinner"></span><span class="ios-ptr-txt">Pull to sync</span>';
        document.body.appendChild(pill);

        let startY = 0;
        let pulling = false;
        let readyToFire = false;
        const txtEl = pill.querySelector('.ios-ptr-txt');

        document.addEventListener('touchstart', (e) => {
            if (window.innerWidth > 960 || e.touches.length !== 1) return;
            if (document.querySelector('.mobile-app-sheet.open, #app-sidebar.mobile-drawer-open, .modal-overlay.open, .modal-overlay.active, .global-modal-overlay[style*="flex"]')) return;
            if (e.target.closest('.table-wrap, .oc-data-table-wrap, .scrollable, input, select, textarea')) return;
            if (window.scrollY > 4) return;
            startY = e.touches[0].clientY;
            pulling = true;
            readyToFire = false;
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!pulling) return;
            const dy = e.touches[0].clientY - startY;
            if (dy < 16 || window.scrollY > 4) {
                if (dy < 0) pulling = false;
                pill.classList.remove('visible');
                return;
            }
            pill.classList.add('visible');
            if (dy >= 78) {
                if (!readyToFire) { readyToFire = true; iosHaptic(8); }
                if (txtEl) txtEl.textContent = 'Release to sync';
            } else {
                readyToFire = false;
                if (txtEl) txtEl.textContent = 'Pull to sync';
            }
        }, { passive: true });

        document.addEventListener('touchend', () => {
            if (!pulling) return;
            pulling = false;
            if (readyToFire) {
                pill.classList.add('refreshing');
                if (txtEl) txtEl.textContent = 'Syncing live intel...';
                triggerSmartPageRefresh();
                setTimeout(() => {
                    pill.classList.remove('visible', 'refreshing');
                }, 900);
            } else {
                pill.classList.remove('visible');
            }
        }, { passive: true });
    }

    function initSegmentedAutoCenter() {
        document.addEventListener('click', (e) => {
            if (window.innerWidth > 768) return;
            const tab = e.target.closest('.oc-view-tab, .deck-tab-btn, .gym-subnav button, .gym-subnav .tracker-tab-btn, .armory-sub-tab, .date-presets .filter-pill, .ops-tab-btn, .tab-btn, #stack-filter-bar .ff-preset-btn');
            if (tab) {
                iosHaptic(5);
                try {
                    tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                } catch (_) {}
            }
        }, { passive: true });
    }

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initMobileBottomNav();
            initIosPullToRefresh();
            initSegmentedAutoCenter();
        });
    } else {
        initMobileBottomNav();
        initIosPullToRefresh();
        initSegmentedAutoCenter();
    }

})();
