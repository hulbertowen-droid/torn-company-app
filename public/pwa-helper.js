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
    function renderInstallBanner(platform) {
        if (document.getElementById('pwa-install-banner') || isStandalone) return;

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
                    <button id="pwa-install-btn" class="pwa-btn-primary">Install</button>
                    <button id="pwa-dismiss-btn" class="pwa-btn-close" title="Dismiss">&times;</button>
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
                    <button id="pwa-dismiss-btn" class="pwa-btn-close" title="Dismiss">&times;</button>
                </div>
            `;
        }

        document.body.appendChild(banner);

        const installBtn = document.getElementById('pwa-install-btn');
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

        const dismissBtn = document.getElementById('pwa-dismiss-btn');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                if (platform === 'ios') {
                    localStorage.setItem('factionos_ios_prompt_dismissed', Date.now().toString());
                } else {
                    localStorage.setItem('factionos_pwa_dismissed', Date.now().toString());
                }
                removeInstallBanner();
            });
        }
    }

    function removeInstallBanner() {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) {
            banner.style.opacity = '0';
            banner.style.transform = 'translateY(20px)';
            setTimeout(() => banner.remove(), 250);
        }
    }

    // 5. Native Mobile Bottom Navigation Bar (Screens <= 768px)
    function initMobileBottomNav() {
        if (document.getElementById('mobile-bottom-nav')) return;

        const path = window.location.pathname.toLowerCase();
        
        const nav = document.createElement('nav');
        nav.id = 'mobile-bottom-nav';
        nav.className = 'mobile-bottom-nav';
        nav.setAttribute('aria-label', 'Mobile Navigation');

        const navItems = [
            {
                id: 'nav-warboard',
                label: 'Warboard',
                href: '/index.html',
                icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
                active: path === '/' || path === '/index.html' || path === ''
            },
            {
                id: 'nav-armory',
                label: 'Armory',
                href: '/dashboard.html#armory',
                icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
                active: path.includes('dashboard')
            },
            {
                id: 'nav-gym',
                label: 'Gym Stats',
                href: '/gym-stats.html',
                icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 5v14M18 5v14M2 9v6M22 9v6M6 12h12"/></svg>',
                active: path.includes('gym')
            },
            {
                id: 'nav-chain',
                label: 'Chain',
                href: '/chain.html',
                icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
                active: path.includes('chain')
            },
            {
                id: 'nav-menu',
                label: 'Menu',
                href: '#',
                icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
                active: false,
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

        // Mobile Menu sheet toggle
        const menuBtn = document.getElementById('nav-menu');
        if (menuBtn) {
            menuBtn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleMobileAppSheet();
            });
        }
    }

    // 6. Mobile App Sheet Drawer (All Apps & Utilities)
    function toggleMobileAppSheet() {
        let sheet = document.getElementById('mobile-app-sheet');
        if (sheet) {
            if (sheet.classList.contains('open')) {
                sheet.classList.remove('open');
                setTimeout(() => sheet.remove(), 250);
            } else {
                sheet.classList.add('open');
            }
            return;
        }

        sheet = document.createElement('div');
        sheet.id = 'mobile-app-sheet';
        sheet.className = 'mobile-app-sheet';
        sheet.innerHTML = `
            <div class="mobile-sheet-backdrop" id="mobile-sheet-backdrop"></div>
            <div class="mobile-sheet-content">
                <div class="mobile-sheet-handle"></div>
                <div class="mobile-sheet-header">
                    <div class="mobile-sheet-title">FactionOS Hub</div>
                    <button class="mobile-sheet-close" id="mobile-sheet-close">&times;</button>
                </div>
                <div class="mobile-app-grid">
                    <a href="/index.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(255, 152, 0, 0.15); color: #ff9800;">📡</div>
                        <div class="app-tile-name">Warboard</div>
                    </a>
                    <a href="/dashboard.html#armory" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(0, 230, 118, 0.15); color: #00e676;">🛡️</div>
                        <div class="app-tile-name">Armory</div>
                    </a>
                    <a href="/gym-stats.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(0, 176, 255, 0.15); color: #00b0ff;">🏋️</div>
                        <div class="app-tile-name">Gym Tracker</div>
                    </a>
                    <a href="/chain.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(229, 57, 53, 0.15); color: #e53935;">🔗</div>
                        <div class="app-tile-name">Chain Sentinel</div>
                    </a>
                    <a href="/travel.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(171, 71, 188, 0.15); color: #ab47bc;">✈️</div>
                        <div class="app-tile-name">Travel Radar</div>
                    </a>
                    <a href="/members.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(77, 182, 172, 0.15); color: #4db6ac;">👥</div>
                        <div class="app-tile-name">Members</div>
                    </a>
                    <a href="/payout.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(255, 214, 0, 0.15); color: #ffd600;">💰</div>
                        <div class="app-tile-name">War Payout</div>
                    </a>
                    <a href="/oc.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(239, 83, 80, 0.15); color: #ef5350;">🕵️</div>
                        <div class="app-tile-name">Organized Crimes</div>
                    </a>
                    <a href="/bazaar.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(100, 255, 218, 0.15); color: #64ffda;">🏪</div>
                        <div class="app-tile-name">Bazaar</div>
                    </a>
                    <a href="/company.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(124, 77, 255, 0.15); color: #7c4dff;">🏢</div>
                        <div class="app-tile-name">Company</div>
                    </a>
                    <a href="/gamble.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(255, 64, 129, 0.15); color: #ff4081;">🎰</div>
                        <div class="app-tile-name">Casino Hub</div>
                    </a>
                    <a href="/discord.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(88, 101, 242, 0.15); color: #5865f2;">💬</div>
                        <div class="app-tile-name">Discord Bot</div>
                    </a>
                    <a href="/bugs.html" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(255, 171, 64, 0.15); color: #ffab40;">🐛</div>
                        <div class="app-tile-name">Bug Reports</div>
                    </a>
                    <a href="javascript:void(0)" onclick="if(window.openGlobalSettings) window.openGlobalSettings();" class="mobile-app-tile">
                        <div class="app-tile-icon" style="background: rgba(144, 164, 174, 0.15); color: #90a4ae;">⚙️</div>
                        <div class="app-tile-name">Settings</div>
                    </a>
                </div>
            </div>
        `;

        document.body.appendChild(sheet);
        // Force reflow for transition
        void sheet.offsetWidth;
        sheet.classList.add('open');

        const closeBtn = document.getElementById('mobile-sheet-close');
        const backdrop = document.getElementById('mobile-sheet-backdrop');
        const closeSheet = () => {
            sheet.classList.remove('open');
            setTimeout(() => sheet.remove(), 250);
        };

        if (closeBtn) closeBtn.addEventListener('click', closeSheet);
        if (backdrop) backdrop.addEventListener('click', closeSheet);
    }

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initMobileBottomNav();
        });
    } else {
        initMobileBottomNav();
    }

})();
