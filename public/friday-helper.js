'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// F.R.I.D.A.Y. BOTTOM-LEFT SITE CO-PILOT & TACTICAL AI ASSISTANT
// Instant client-side execution (<100ms) for quick actions, persistent cross-page
// sessionStorage intent queue, animated thinking indicator, and Tactical AI mode.
// ══════════════════════════════════════════════════════════════════════════════
(function () {
    if (window.__fridayHelperLoaded) return;
    window.__fridayHelperLoaded = true;

    const HISTORY_KEY = 'sv_friday_helper_history_v1';
    const PENDING_ACTION_KEY = 'friday_pending_action';
    const LEGACY_PENDING_KEY = 'sv_friday_pending_action';
    const OPEN_STATE_KEY = 'sv_friday_helper_open';
    const MODE_STATE_KEY = 'sv_friday_helper_mode';
    const EXPAND_STATE_KEY = 'sv_friday_helper_expanded';

    const CORE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8" opacity="0.45"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/></svg>`;
    const CLOSE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const SEND_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

    // Built-in Site Co-Pilot quick pills execute instantaneously (<100ms) on the client side
    const COPILOT_CHIPS = [
        {
            label: '🩸 Blood Bag Fillers',
            prompt: 'Show me who filled empty blood bags in the armory',
            instantReply: 'Opening **Armory & Logistics → Stock, Burn Rate & Blood Bags** to inspect Blood Bag reserves and Top Fillers.',
            instantAction: {
                type: 'armory_filter',
                page: '/armory.html#stock',
                tab: 'stock',
                segment: 'bloodfillers',
                actionFilter: 'filled',
                scrollId: 'blood-types-grid',
                label: 'Opened Stock, Burn Rate & Blood Bags'
            }
        },
        {
            label: '🏋️ Gym Slackers',
            prompt: 'Show gym slackers on the roster',
            instantReply: 'Navigating to **Gym & Stat Tracker → Member Roster** and activating **Show Slackers Only**.',
            instantAction: {
                type: 'gym_action',
                page: '/gym-stats.html#roster',
                view: 'roster',
                subFilter: 'slacker',
                scrollId: 'pane-roster',
                label: 'Filtered Gym Roster to Slackers Only'
            }
        },
        {
            label: '💊 Idle Drug CD',
            prompt: 'Show members with drug cooldown off',
            instantReply: 'Navigating to **Gym & Stat Tracker → Member Roster** and activating **Off Drug CD**.',
            instantAction: {
                type: 'gym_action',
                page: '/gym-stats.html#roster',
                view: 'roster',
                subFilter: 'cd_idle',
                sortCol: 'drugcd',
                scrollId: 'pane-roster',
                label: 'Filtered Gym Roster to Off Drug CD'
            }
        },
        {
            label: '🎯 Optimal FF Targets',
            prompt: 'Filter enemy targets to optimal fair fight',
            instantReply: 'Opening **Gym & Stat Tracker → War Room & Fair Fight** and triggering **Calculate Matches**.',
            instantAction: {
                type: 'gym_action',
                page: '/gym-stats.html#war',
                view: 'war',
                ffTargetStats: 10000000,
                triggerCalculateMatches: true,
                scrollId: 'ff-matches-table',
                label: 'Opened War Room & Calculated FF Matches'
            }
        },
        {
            label: '✈️ Who Is Flying?',
            prompt: 'Show me who is flying in airspace intel',
            instantReply: 'Opening **Operations Overview → Airspace & War Intel** to view live member flights.',
            instantAction: {
                type: 'dashboard_action',
                page: '/dashboard.html#sentinel',
                tab: 'sentinel',
                subSection: 'airspace',
                radarFilter: 'flying',
                scrollId: 'sn-sec-airspace',
                label: 'Opened Operations Overview → Airspace'
            }
        },
        {
            label: '🧸 Travel Plushies',
            prompt: 'Filter travel desk to plushies in stock',
            instantReply: 'Opening **Travel Profit Desk** and activating **🧸 Plushies** + **✅ In Stock Only** filters.',
            instantAction: {
                type: 'travel_action',
                page: '/travel.html',
                filter: 'plushie',
                inStockOnly: true,
                scrollId: 'profits-tbody',
                label: 'Filtered Travel Desk to Plushies + In Stock Only'
            }
        },
        {
            label: '🕵️ Crime & Level ETAs',
            prompt: 'Open Crime & Level Analytics estimators',
            instantReply: 'Opening **Crime & Level Analytics** to view your Crimes 2.0 skill estimators, $/nerve efficiency, and regular level progress.',
            instantAction: {
                type: 'crimes_action',
                page: '/crimes.html',
                tab: 'overview',
                label: 'Opened Crime & Level Analytics'
            }
        },
        {
            label: '🌓 Toggle Theme',
            prompt: 'Toggle dark or light mode',
            instantReply: 'Toggled your FactionOS visual theme.',
            instantAction: {
                type: 'theme',
                mode: 'toggle',
                label: 'Toggled Dark / Light Mode'
            }
        },
        {
            label: '⚙️ API Settings',
            prompt: 'Open API settings',
            instantReply: 'Opened the **Operations & API Settings** modal.',
            instantAction: {
                type: 'open_settings',
                label: 'Opened Operations & API Settings'
            }
        }
    ];

    const TACTICAL_CHIPS = [
        { label: '⚔️ Ranked War Strategy', prompt: 'What is the best Ranked War hospital timing, chain watching, and Fair Fight strategy?' },
        { label: '🏋️ Happy Jump vs Xanax', prompt: 'When should I stop doing Happy Jumps and switch to standard 3x Xanax + refill training?' },
        { label: '🎯 Fair Fight Formula', prompt: 'How does the Torn Fair Fight multiplier formula work and what is the optimal 2.5x-3.0x target stat ratio?' },
        { label: '🏢 Company Director Guide', prompt: 'How do employee addiction debuffs, advertising budget, and stock burn rate affect Torn company star ratings?' }
    ];

    let isHelperBusy = false;
    const promptQueue = [];
    let currentMode = 'copilot';

    function getHistory() {
        try {
            const raw = sessionStorage.getItem(HISTORY_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (_) {
            return [];
        }
    }

    function saveHistory(arr) {
        try {
            sessionStorage.setItem(HISTORY_KEY, JSON.stringify((arr || []).slice(-20)));
        } catch (_) {}
    }

    function normalizePath(p) {
        if (!p || p === '/index.html') return '/';
        return p.split('?')[0].split('#')[0];
    }

    function flashElement(el) {
        if (!el) return;
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const prevOutline = el.style.outline;
            const prevTransition = el.style.transition;
            el.style.transition = 'outline 0.25s ease, box-shadow 0.25s ease';
            el.style.outline = '2px solid #38bdf8';
            el.style.boxShadow = '0 0 18px rgba(56, 189, 248, 0.45)';
            setTimeout(() => {
                el.style.outline = prevOutline;
                el.style.boxShadow = '';
                el.style.transition = prevTransition;
            }, 2200);
        } catch (_) {}
    }

    function setPendingCrossPageAction(action) {
        try {
            const serialized = JSON.stringify(action);
            sessionStorage.setItem(PENDING_ACTION_KEY, serialized);
            sessionStorage.setItem(LEGACY_PENDING_KEY, serialized);
            sessionStorage.setItem(OPEN_STATE_KEY, '1');
        } catch (_) {}
    }

    function consumePendingCrossPageAction() {
        try {
            const raw = sessionStorage.getItem(PENDING_ACTION_KEY) || sessionStorage.getItem(LEGACY_PENDING_KEY);
            if (!raw) return null;
            sessionStorage.removeItem(PENDING_ACTION_KEY);
            sessionStorage.removeItem(LEGACY_PENDING_KEY);
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    // ─── Execute Structured UI Action on Current Page or Queue Across Navigation ───
    function executeHelperAction(action, fromPending = false) {
        if (!action || typeof action !== 'object') return false;

        // 1. Global actions that work on EVERY page without navigation
        if (action.type === 'theme') {
            const isLight = document.body.classList.contains('light-mode');
            if (action.mode === 'light' && !isLight && typeof window.toggleTheme === 'function') window.toggleTheme();
            else if (action.mode === 'dark' && isLight && typeof window.toggleTheme === 'function') window.toggleTheme();
            else if (action.mode === 'toggle' && typeof window.toggleTheme === 'function') window.toggleTheme();
            return true;
        }
        if (action.type === 'sidebar') {
            const sb = document.getElementById('app-sidebar');
            if (sb) {
                const isCol = sb.classList.contains('collapsed');
                if (action.state === 'collapse' && !isCol && typeof window.toggleSidebar === 'function') window.toggleSidebar();
                else if (action.state === 'expand' && isCol && typeof window.toggleSidebar === 'function') window.toggleSidebar();
                else if (!action.state && typeof window.toggleSidebar === 'function') window.toggleSidebar();
                syncFabSidebarState();
            }
            return true;
        }
        if (action.type === 'replay_intro') {
            if (typeof window.playFridayIntro === 'function') {
                window.playFridayIntro({ force: true });
            } else {
                const sc = document.createElement('script');
                sc.src = '/friday-intro.js?v=1.0.0';
                sc.onload = () => { if (typeof window.playFridayIntro === 'function') window.playFridayIntro({ force: true }); };
                document.head.appendChild(sc);
            }
            return true;
        }
        if (action.type === 'open_settings') {
            if (typeof window.openGlobalSettings === 'function') {
                window.openGlobalSettings();
                if (action.enemyId) {
                    setTimeout(() => {
                        const inp = document.getElementById('gs-enemy-id');
                        if (inp) {
                            inp.value = String(action.enemyId);
                            flashElement(inp);
                        }
                    }, 180);
                }
            }
            return true;
        }

        // 2. Check if we need to navigate to another page first
        const curPath = normalizePath(window.location.pathname);
        const targetPath = action.page ? normalizePath(action.page) : curPath;

        if (targetPath && targetPath !== curPath) {
            setPendingCrossPageAction(action);
            window.location.href = action.page;
            return true;
        }

        // 3. Page-specific DOM & controller execution
        const runDomAction = (isFollowupPass = false) => {
            try {
                // LIVE WARBOARD (/)
                if (action.type === 'warboard_action') {
                    if (action.enemyFilter && typeof window.setEnemyFilter === 'function') {
                        window.setEnemyFilter(action.enemyFilter);
                        if (!isFollowupPass) flashElement(document.getElementById('eflt-' + action.enemyFilter) || document.getElementById('enemy-list'));
                    }
                    if (action.friendlyFilter && typeof window.setFriendlyFilter === 'function') {
                        window.setFriendlyFilter(action.friendlyFilter);
                        if (!isFollowupPass) flashElement(document.getElementById('fflt-m-' + action.friendlyFilter) || document.getElementById('friendly-list'));
                    }
                    if (action.enemySort && typeof window.handleEnemySort === 'function') {
                        const sel = document.getElementById('enemy-sort-select');
                        if (sel) sel.value = action.enemySort;
                        window.handleEnemySort(action.enemySort);
                        if (!isFollowupPass) flashElement(sel);
                    }
                    if (!isFollowupPass && action.toggleHud && typeof window.toggleHudMode === 'function') {
                        window.toggleHudMode();
                    }
                    if (!isFollowupPass && action.toggleSim && typeof window.toggleWarSimulation === 'function') {
                        window.toggleWarSimulation();
                    }
                }

                // ARMORY & LOGISTICS (/armory.html)
                if (action.type === 'armory_filter') {
                    if (action.tab && typeof window.switchArmorySubTab === 'function') {
                        window.switchArmorySubTab(action.tab);
                    }
                    if (action.segment && typeof window.setTrackerTab === 'function') {
                        const segBtn = document.querySelector(`#tracker-segment-pills .filter-pill[onclick*="'${action.segment}'"]`);
                        window.setTrackerTab(action.segment, segBtn);
                    } else if (action.actionFilter && typeof window.setArmoryActionFilter === 'function') {
                        window.setArmoryActionFilter(action.actionFilter);
                    }
                    if (!isFollowupPass) {
                        const targetEl = (action.scrollId && document.getElementById(action.scrollId))
                            || document.getElementById('asub-btn-' + (action.tab || 'stock'))
                            || document.getElementById('blood-types-grid')
                            || document.getElementById('tracker-member-table');
                        flashElement(targetEl);
                    }
                }

                // GYM & STAT TRACKER (/gym-stats.html)
                if (action.type === 'gym_action') {
                    if (action.view && typeof window.switchTrackerView === 'function') {
                        const sf = action.subFilter === 'slackers' ? 'slacker' : (action.subFilter || null);
                        window.switchTrackerView(action.view, sf);
                    }
                    if (action.timeframe && typeof window.setRosterTimeframe === 'function') {
                        const pill = document.querySelector(`.stat-window-pill[data-window="${action.timeframe}"]`);
                        window.setRosterTimeframe(action.timeframe, pill);
                        if (!isFollowupPass) flashElement(pill);
                    }
                    if (action.sortCol && typeof window.sortRoster === 'function' && !isFollowupPass) {
                        window.sortRoster(action.sortCol);
                    }
                    if (action.search) {
                        const sInp = document.getElementById('roster-search');
                        if (sInp) {
                            sInp.value = action.search;
                            sInp.dispatchEvent(new Event('input'));
                        }
                    }
                    if (action.ffTargetStats && typeof window.setFfPreset === 'function') {
                        window.setFfPreset(Number(action.ffTargetStats));
                    } else if (action.triggerCalculateMatches && typeof window.queryFairFightMatches === 'function') {
                        window.queryFairFightMatches();
                    }
                    if (!isFollowupPass) {
                        const scrollEl = (action.scrollId && document.getElementById(action.scrollId))
                            || (action.subFilter === 'slacker' ? document.getElementById('btn-toggle-slackers') : null)
                            || (action.subFilter === 'cd_idle' ? document.getElementById('btn-toggle-cd-idle') : null)
                            || (action.subFilter === 'stacked_e' ? document.getElementById('btn-toggle-stacked-e') : null)
                            || document.getElementById('master-roster-table');
                        flashElement(scrollEl);
                    }
                }

                // OPERATIONS OVERVIEW & AIRSPACE (/dashboard.html)
                if (action.type === 'dashboard_action') {
                    if (action.tab && typeof window.switchOpsTab === 'function') {
                        window.switchOpsTab(action.tab);
                    }
                    if (action.subSection && typeof window.openSentinelSection === 'function') {
                        window.openSentinelSection(action.subSection);
                    }
                    if (action.radarFilter && typeof window.setRadarFilter === 'function') {
                        window.setRadarFilter(action.radarFilter);
                    }
                    if (!isFollowupPass) {
                        const scrollEl = (action.scrollId && document.getElementById(action.scrollId))
                            || document.getElementById('tab-btn-' + (action.tab || 'sentinel'));
                        flashElement(scrollEl);
                    }
                }

                // CHAIN SENTINEL (/chain.html)
                if (action.type === 'chain_action' && !isFollowupPass) {
                    if (action.autoFill && typeof window.lineupAutoFill === 'function') {
                        window.lineupAutoFill();
                        flashElement(document.querySelector('.lineup-card'));
                    }
                    if (action.toggleAuto && typeof window.toggleAutoMode === 'function') {
                        window.toggleAutoMode();
                    }
                    if (action.copyLineup && typeof window.copyFull === 'function') {
                        window.copyFull();
                    }
                }

                // WAR PAYOUTS (/payout.html)
                if (action.type === 'payout_action' && !isFollowupPass) {
                    if (action.loadLastWar && typeof window.fetchReport === 'function') {
                        window.fetchReport('51235');
                    }
                }

                // OC MANAGER (/oc.html)
                if (action.type === 'oc_action') {
                    if (action.view && typeof window.switchOcView === 'function') {
                        window.switchOcView(action.view);
                        if (!isFollowupPass) flashElement(document.getElementById('view-tab-' + action.view));
                    }
                    if (action.tab && typeof window.setTab === 'function') {
                        window.setTab(action.tab);
                        if (!isFollowupPass) flashElement(document.getElementById('tab-' + action.tab));
                    }
                }

                // TRAVEL PROFIT DESK (/travel.html)
                if (action.type === 'travel_action') {
                    if (typeof window.applyFridayTravelCommand === 'function') {
                        window.applyFridayTravelCommand(action);
                    } else {
                        if (action.capacity) {
                            const capEl = document.getElementById('capacity');
                            if (capEl && typeof window.applyCapacity === 'function') {
                                capEl.value = action.capacity;
                                window.applyCapacity();
                            }
                        }
                        if (action.flightProfile) {
                            const fpEl = document.getElementById('flight-profile');
                            if (fpEl && typeof window.applyFlightProfile === 'function') {
                                fpEl.value = action.flightProfile;
                                window.applyFlightProfile();
                            }
                        }
                        if (action.filter && typeof window.setFilter === 'function') {
                            const btn = document.querySelector(`.pill-btn[data-filter="${action.filter}"]`);
                            if (btn) {
                                window.setFilter(action.filter, btn);
                                if (!isFollowupPass) flashElement(btn);
                            }
                        }
                        if (action.inStockOnly && typeof window.setFilter === 'function') {
                            const stockBtn = document.querySelector('.pill-btn[data-filter="instock"]');
                            if (stockBtn) {
                                window.setFilter('instock', stockBtn, true);
                            }
                        }
                    }
                }

                // CRIME & LEVEL ANALYTICS (/crimes.html)
                if (action.type === 'crimes_action') {
                    if (typeof window.applyFridayCrimesCommand === 'function') {
                        window.applyFridayCrimesCommand(action);
                    }
                }

                // COMPANY HUB (/company.html)
                if (action.type === 'company_action' && !isFollowupPass) {
                    if (action.runAdvisor && typeof window.getAIAdvice === 'function') {
                        window.getAIAdvice();
                    }
                    if (action.openAlerts && typeof window.openCompanyAlertModal === 'function') {
                        window.openCompanyAlertModal();
                    }
                }

                // CASINO ANALYTICS (/gamble.html)
                if (action.type === 'gamble_action') {
                    if (action.bankroll) {
                        const brEl = document.getElementById('global-bankroll');
                        if (brEl && typeof window.onBankrollChange === 'function') {
                            brEl.value = action.bankroll;
                            window.onBankrollChange();
                        }
                    }
                    if (action.tab && typeof window.showTab === 'function') {
                        const btn = document.querySelector(`.tab-btn[onclick*="'${action.tab}'"]`);
                        if (btn) {
                            window.showTab(action.tab, btn);
                            if (!isFollowupPass) flashElement(btn);
                        }
                    }
                }

                // DISCORD SENTINEL & MARKET SNIPER (/discord.html)
                if (action.type === 'discord_action') {
                    if (action.tab && typeof window.switchDeckTab === 'function') {
                        window.switchDeckTab(action.tab);
                        if (!isFollowupPass) flashElement(document.querySelector(`.deck-tab-btn[data-tab="${action.tab}"]`));
                    }
                }

                // BUG TRACKER (/bugs.html)
                if (action.type === 'bugs_action' && !isFollowupPass) {
                    if (action.openModal && typeof window.openReportModal === 'function') {
                        window.openReportModal();
                    }
                }
            } catch (e) {
                console.warn('[FRIDAY Helper] Action execution warning:', e);
            }
        };

        if (fromPending) {
            setTimeout(() => runDomAction(false), 120);
            setTimeout(() => runDomAction(true), 650);
            setTimeout(() => runDomAction(true), 1250);
        } else {
            runDomAction(false);
        }
        return true;
    }

    window.executeFridayHelperAction = executeHelperAction;

    // ─── Format Markdown safely ───
    function formatMsgHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    function syncFabSidebarState() {
        const fab = document.getElementById('friday-helper-fab');
        const sb = document.getElementById('app-sidebar');
        if (!fab) return;
        const isCompact = (sb && sb.classList.contains('collapsed')) || window.innerWidth <= 960;
        fab.classList.toggle('compact', Boolean(isCompact));
    }

    function updateChipsBar() {
        const chipsBar = document.getElementById('fh-chips-bar');
        if (!chipsBar) return;
        chipsBar.innerHTML = '';
        const list = currentMode === 'tactical' ? TACTICAL_CHIPS : COPILOT_CHIPS;
        list.forEach(c => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'fh-chip';
            btn.disabled = isHelperBusy;
            btn.textContent = c.label;
            btn.addEventListener('click', () => {
                if (c.instantAction) {
                    executeInstantQuickChip(c);
                } else {
                    sendHelperPrompt(c.prompt);
                }
            });
            chipsBar.appendChild(btn);
        });
    }

    function setHelperMode(mode) {
        currentMode = mode === 'tactical' ? 'tactical' : 'copilot';
        try { sessionStorage.setItem(MODE_STATE_KEY, currentMode); } catch (_) {}
        const btnCopilot = document.getElementById('fh-mode-copilot');
        const btnTactical = document.getElementById('fh-mode-tactical');
        const subEl = document.getElementById('fh-header-sub');
        const inpEl = document.getElementById('fh-input');
        if (btnCopilot) btnCopilot.classList.toggle('active', currentMode === 'copilot');
        if (btnTactical) btnTactical.classList.toggle('active', currentMode === 'tactical');
        if (subEl) {
            subEl.textContent = currentMode === 'tactical'
                ? 'Torn City combat, gym, company & war strategy analyst'
                : 'Finds pages, changes settings & filters for you';
        }
        if (inpEl) {
            inpEl.placeholder = currentMode === 'tactical'
                ? 'Ask any Torn combat, gym, war, or company strategy question...'
                : 'Tell me what to find, filter, or change...';
        }
        updateChipsBar();
    }

    function toggleExpandPanel(forceState) {
        const panel = document.getElementById('friday-helper-panel');
        const btn = document.getElementById('fh-expand-btn');
        if (!panel) return;
        const next = typeof forceState === 'boolean' ? forceState : !panel.classList.contains('expanded');
        panel.classList.toggle('expanded', next);
        if (btn) btn.title = next ? 'Compact panel size' : 'Expand panel size';
        try { sessionStorage.setItem(EXPAND_STATE_KEY, next ? '1' : '0'); } catch (_) {}
    }

    function injectHelperUI() {
        if (document.getElementById('friday-helper-fab')) return;

        try {
            const savedMode = sessionStorage.getItem(MODE_STATE_KEY);
            if (savedMode === 'tactical' || savedMode === 'copilot') currentMode = savedMode;
        } catch (_) {}

        const style = document.createElement('style');
        style.id = 'friday-helper-styles';
        style.textContent = `
            #friday-helper-fab {
                position: fixed;
                bottom: 14px;
                left: 14px;
                z-index: 9990;
                display: inline-flex;
                align-items: center;
                gap: 10px;
                width: 212px;
                padding: 9px 13px;
                border-radius: 12px;
                background: linear-gradient(135deg, rgba(13, 19, 30, 0.98), rgba(9, 14, 22, 0.99));
                border: 1px solid rgba(56, 189, 248, 0.45);
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.65), 0 0 14px rgba(6, 182, 212, 0.18);
                color: #f8fafc;
                cursor: pointer;
                font-family: var(--font-sans, 'Inter', sans-serif);
                text-align: left;
                transition: all 0.2s ease;
                box-sizing: border-box;
            }
            body.light-mode #friday-helper-fab {
                background: linear-gradient(135deg, #ffffff, #f1f5f9);
                color: #0f172a;
                border-color: rgba(6, 182, 212, 0.55);
                box-shadow: 0 6px 20px rgba(15, 23, 42, 0.14);
            }
            #friday-helper-fab:hover {
                border-color: #38bdf8;
                box-shadow: 0 8px 28px rgba(0, 0, 0, 0.75), 0 0 20px rgba(56, 189, 248, 0.35);
                transform: translateY(-1px);
            }
            #friday-helper-fab.compact {
                width: 44px;
                height: 44px;
                padding: 0;
                border-radius: 50%;
                justify-content: center;
                left: 12px;
            }
            #friday-helper-fab.compact .fh-fab-text,
            #friday-helper-fab.compact .fh-fab-dot {
                display: none;
            }
            .fh-fab-core {
                width: 30px;
                height: 30px;
                border-radius: 50%;
                background: radial-gradient(circle, rgba(6, 182, 212, 0.28), rgba(6, 182, 212, 0.06));
                border: 1.5px solid #06b6d4;
                color: #06b6d4;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            .fh-fab-text {
                display: flex;
                flex-direction: column;
                min-width: 0;
                flex: 1;
            }
            .fh-fab-title {
                font-size: 0.78rem;
                font-weight: 800;
                letter-spacing: 0.2px;
                line-height: 1.15;
                white-space: nowrap;
            }
            .fh-fab-sub {
                font-size: 0.66rem;
                color: #94a3b8;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 1px;
            }
            .fh-fab-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: #10b981;
                box-shadow: 0 0 8px #10b981;
                flex-shrink: 0;
            }

            /* High-contrast opaque surface so zero sidebar text bleeds through */
            #friday-helper-panel {
                position: fixed;
                bottom: 68px;
                left: 14px;
                width: 390px;
                max-width: calc(100vw - 28px);
                height: 530px;
                max-height: calc(100vh - 92px);
                z-index: 9992;
                background: rgba(10, 15, 28, 0.98);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(56, 189, 248, 0.35);
                border-radius: 14px;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85), 0 0 24px rgba(6, 182, 212, 0.18);
                display: none;
                flex-direction: column;
                overflow: hidden;
                font-family: var(--font-sans, 'Inter', sans-serif);
                transition: width 0.2s ease, height 0.2s ease;
            }
            body.light-mode #friday-helper-panel {
                background: rgba(255, 255, 255, 0.98);
                border-color: rgba(6, 182, 212, 0.45);
                box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
            }
            #friday-helper-panel.expanded {
                width: 560px;
                height: 640px;
            }
            #friday-helper-panel.open {
                display: flex;
                animation: fhSlideUp 0.18s ease-out;
            }
            @keyframes fhSlideUp {
                from { opacity: 0; transform: translateY(10px) scale(0.98); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .fh-header {
                padding: 10px 12px;
                background: linear-gradient(90deg, rgba(6, 182, 212, 0.18), rgba(59, 130, 246, 0.1));
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .fh-header-top {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }
            .fh-header-left {
                display: flex;
                align-items: center;
                gap: 9px;
                min-width: 0;
            }
            .fh-header-title {
                font-size: 0.85rem;
                font-weight: 800;
                color: var(--text-primary, #f8fafc);
                line-height: 1.2;
            }
            .fh-header-sub {
                font-size: 0.68rem;
                color: var(--text-secondary, #94a3b8);
            }
            .fh-header-actions {
                display: flex;
                align-items: center;
                gap: 5px;
            }
            .fh-mode-bar {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 4px;
                background: rgba(5, 8, 15, 0.75);
                padding: 3px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.08);
            }
            body.light-mode .fh-mode-bar {
                background: #e2e8f0;
                border-color: #cbd5e1;
            }
            .fh-mode-btn {
                border: none;
                background: transparent;
                color: #94a3b8;
                font-size: 0.71rem;
                font-weight: 800;
                padding: 4px 8px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.15s ease;
                font-family: inherit;
            }
            .fh-mode-btn.active {
                background: rgba(6, 182, 212, 0.22);
                color: #38bdf8;
                box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.45);
            }
            body.light-mode .fh-mode-btn.active {
                background: #ffffff;
                color: #0284c7;
            }
            .fh-icon-btn {
                background: rgba(255,255,255,0.06);
                border: 1px solid rgba(255,255,255,0.12);
                color: var(--text-secondary, #94a3b8);
                border-radius: 6px;
                padding: 4px 7px;
                font-size: 0.7rem;
                font-weight: 700;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .fh-icon-btn:hover {
                color: var(--text-primary, #fff);
                border-color: #38bdf8;
            }
            .fh-chips-bar {
                padding: 8px 10px;
                border-bottom: 1px solid rgba(255,255,255,0.08);
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                background: rgba(6, 10, 18, 0.95);
                flex-shrink: 0;
            }
            body.light-mode .fh-chips-bar {
                background: #f8fafc;
                border-bottom-color: #e2e8f0;
            }
            .fh-chip {
                background: rgba(22, 29, 42, 0.98);
                border: 1px solid rgba(255,255,255,0.14);
                color: #cbd5e1;
                padding: 3px 8px;
                border-radius: 99px;
                font-size: 0.69rem;
                font-weight: 700;
                white-space: nowrap;
                cursor: pointer;
                transition: all 0.15s;
            }
            body.light-mode .fh-chip {
                background: #ffffff;
                border-color: #cbd5e1;
                color: #334155;
            }
            .fh-chip:hover:not(:disabled) {
                border-color: #38bdf8;
                color: #38bdf8;
                background: rgba(56, 189, 248, 0.12);
            }
            .fh-chip:disabled {
                opacity: 0.45;
                cursor: wait;
            }
            .fh-messages {
                flex: 1;
                overflow-y: auto;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                background: rgba(8, 12, 22, 0.96);
            }
            body.light-mode .fh-messages {
                background: #ffffff;
            }
            .fh-msg {
                max-width: 92%;
                padding: 9px 12px;
                border-radius: 10px;
                font-size: 0.81rem;
                line-height: 1.5;
                word-break: break-word;
            }
            .fh-msg.assistant {
                align-self: flex-start;
                background: rgba(23, 31, 46, 0.98);
                border: 1px solid rgba(255,255,255,0.1);
                color: #f1f5f9;
            }
            body.light-mode .fh-msg.assistant {
                background: #f1f5f9;
                border-color: #cbd5e1;
                color: #0f172a;
            }
            .fh-msg.user {
                align-self: flex-end;
                background: #2563eb;
                color: #ffffff;
                font-weight: 500;
            }
            .fh-typing-bubble {
                align-self: flex-start;
                display: inline-flex;
                align-items: center;
                gap: 9px;
                padding: 9px 13px;
                border-radius: 10px;
                background: rgba(14, 24, 38, 0.98);
                border: 1px solid rgba(56, 189, 248, 0.4);
                color: #38bdf8;
                font-size: 0.78rem;
                font-weight: 700;
            }
            .fh-spinner {
                width: 14px;
                height: 14px;
                border: 2px solid rgba(56, 189, 248, 0.25);
                border-top-color: #38bdf8;
                border-radius: 50%;
                animation: fhSpin 0.75s linear infinite;
                flex-shrink: 0;
            }
            @keyframes fhSpin {
                to { transform: rotate(360deg); }
            }
            .fh-action-pill {
                margin-top: 7px;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 4px 9px;
                border-radius: 6px;
                background: rgba(16, 185, 129, 0.16);
                border: 1px solid rgba(16, 185, 129, 0.45);
                color: #10b981;
                font-size: 0.72rem;
                font-weight: 800;
                cursor: pointer;
            }
            .fh-action-pill:hover {
                background: rgba(16, 185, 129, 0.26);
            }
            .fh-input-row {
                padding: 10px 12px;
                border-top: 1px solid rgba(255,255,255,0.1);
                display: flex;
                align-items: center;
                gap: 8px;
                background: rgba(14, 20, 32, 0.98);
            }
            body.light-mode .fh-input-row {
                background: #f8fafc;
                border-top-color: #e2e8f0;
            }
            .fh-input {
                flex: 1;
                padding: 8px 11px !important;
                border-radius: 8px !important;
                border: 1px solid rgba(255,255,255,0.16) !important;
                background: rgba(8, 12, 20, 0.98) !important;
                color: #ffffff !important;
                font-size: 0.81rem !important;
                outline: none !important;
            }
            body.light-mode .fh-input {
                background: #ffffff !important;
                color: #0f172a !important;
                border-color: #cbd5e1 !important;
            }
            .fh-input:focus {
                border-color: #38bdf8 !important;
            }
            .fh-send-btn {
                width: 34px;
                height: 34px;
                border-radius: 8px;
                border: none;
                background: #06b6d4;
                color: #041016;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                transition: background 0.15s;
            }
            .fh-send-btn:hover { background: #22d3ee; }
            .fh-send-btn:disabled { opacity: 0.5; cursor: wait; }

            /* Apple iOS Mobile Safe Positioning & Bottom-Sheet Presentation */
            @media (max-width: 768px) {
                #friday-helper-fab {
                    left: auto !important;
                    right: 14px !important;
                    bottom: calc(env(safe-area-inset-bottom, 0px) + 74px) !important;
                    width: 48px !important;
                    height: 48px !important;
                    padding: 0 !important;
                    border-radius: 50% !important;
                    justify-content: center !important;
                    backdrop-filter: saturate(180%) blur(18px);
                    -webkit-backdrop-filter: saturate(180%) blur(18px);
                    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.58), 0 0 0 1px rgba(56, 189, 248, 0.4) !important;
                    transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.18s ease !important;
                }
                #friday-helper-fab .fh-fab-text,
                #friday-helper-fab .fh-fab-dot {
                    display: none !important;
                }
                body:has(#mobile-app-sheet.open) #friday-helper-fab,
                body:has(#friday-helper-panel.open) #friday-helper-fab {
                    opacity: 0;
                    pointer-events: none;
                    transform: scale(0.8);
                }
                #friday-helper-panel,
                #friday-helper-panel.expanded {
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    width: 100vw !important;
                    max-width: 100vw !important;
                    height: 82dvh !important;
                    max-height: 88dvh !important;
                    border-radius: 22px 22px 0 0 !important;
                    border-bottom: none !important;
                    padding-bottom: env(safe-area-inset-bottom, 0px);
                    z-index: 10030 !important;
                }
                #friday-helper-panel.open {
                    animation: fhIosSheetUp 0.34s cubic-bezier(0.32, 0.72, 0, 1) !important;
                }
                @keyframes fhIosSheetUp {
                    from { transform: translateY(100%); opacity: 0.7; }
                    to { transform: translateY(0); opacity: 1; }
                }
                .fh-header::before {
                    content: '';
                    display: block;
                    width: 36px;
                    height: 4px;
                    border-radius: 99px;
                    background: rgba(148, 163, 184, 0.42);
                    margin: 0 auto 4px auto;
                }
                .fh-input {
                    font-size: 16px !important;
                    padding: 10px 12px !important;
                }
                .fh-send-btn {
                    width: 40px !important;
                    height: 40px !important;
                }
                .fh-icon-btn {
                    min-height: 34px;
                    padding: 5px 10px !important;
                }
            }
        `;
        document.head.appendChild(style);

        const fab = document.createElement('button');
        fab.id = 'friday-helper-fab';
        fab.type = 'button';
        fab.title = 'Ask F.R.I.D.A.Y. Helper AI to find features, auto-filter, or analyze Torn strategy';
        fab.setAttribute('aria-label', 'Open F.R.I.D.A.Y. Helper AI');
        fab.innerHTML = `
            <span class="fh-fab-core">${CORE_SVG}</span>
            <span class="fh-fab-text">
                <span class="fh-fab-title">F.R.I.D.A.Y. Helper</span>
                <span class="fh-fab-sub">Ask or Auto-Filter</span>
            </span>
            <span class="fh-fab-dot"></span>
        `;
        fab.addEventListener('click', () => toggleHelperPanel());

        const panel = document.createElement('section');
        panel.id = 'friday-helper-panel';
        panel.setAttribute('aria-label', 'F.R.I.D.A.Y. Site Co-Pilot');
        panel.innerHTML = `
            <div class="fh-header">
                <div class="fh-header-top">
                    <div class="fh-header-left">
                        <span class="fh-fab-core">${CORE_SVG}</span>
                        <div>
                            <div class="fh-header-title">F.R.I.D.A.Y. Site Co-Pilot</div>
                            <div class="fh-header-sub" id="fh-header-sub">Finds pages, changes settings &amp; filters for you</div>
                        </div>
                    </div>
                    <div class="fh-header-actions">
                        <button type="button" class="fh-icon-btn" id="fh-expand-btn" title="Expand panel size" aria-label="Expand panel">⤢</button>
                        <button type="button" class="fh-icon-btn" id="fh-clear-btn" title="Clear conversation">Clear</button>
                        <button type="button" class="fh-icon-btn" id="fh-close-btn" aria-label="Close helper">${CLOSE_SVG}</button>
                    </div>
                </div>
                <div class="fh-mode-bar" role="tablist" aria-label="F.R.I.D.A.Y. Assistant Mode">
                    <button type="button" class="fh-mode-btn active" id="fh-mode-copilot" role="tab">⚡ Site Co-Pilot</button>
                    <button type="button" class="fh-mode-btn" id="fh-mode-tactical" role="tab">🧠 Tactical AI</button>
                </div>
            </div>
            <div class="fh-chips-bar" id="fh-chips-bar"></div>
            <div class="fh-messages" id="fh-messages"></div>
            <form class="fh-input-row" id="fh-form">
                <input type="text" class="fh-input" id="fh-input" placeholder="Tell me what to find, filter, or change..." autocomplete="off">
                <button type="submit" class="fh-send-btn" id="fh-send-btn" aria-label="Send">${SEND_SVG}</button>
            </form>
        `;

        document.body.appendChild(fab);
        document.body.appendChild(panel);

        document.getElementById('fh-mode-copilot').addEventListener('click', () => setHelperMode('copilot'));
        document.getElementById('fh-mode-tactical').addEventListener('click', () => setHelperMode('tactical'));
        document.getElementById('fh-expand-btn').addEventListener('click', () => toggleExpandPanel());
        document.getElementById('fh-close-btn').addEventListener('click', () => toggleHelperPanel(false));

        // Swipe-down header gesture to close Helper AI bottom sheet on mobile
        const fhHeader = panel.querySelector('.fh-header');
        if (fhHeader) {
            let startY = 0;
            let dy = 0;
            let dragging = false;
            fhHeader.addEventListener('touchstart', (e) => {
                if (window.innerWidth > 768) return;
                startY = e.touches[0].clientY;
                dy = 0;
                dragging = true;
                panel.style.transition = 'none';
            }, { passive: true });
            fhHeader.addEventListener('touchmove', (e) => {
                if (!dragging) return;
                dy = Math.max(0, e.touches[0].clientY - startY);
                if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
            }, { passive: true });
            fhHeader.addEventListener('touchend', () => {
                if (!dragging) return;
                dragging = false;
                panel.style.transition = 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)';
                if (dy > 85) {
                    panel.style.transform = '';
                    toggleHelperPanel(false);
                } else {
                    panel.style.transform = '';
                }
            }, { passive: true });
        }
        document.getElementById('fh-clear-btn').addEventListener('click', () => {
            saveHistory([]);
            renderMessages();
        });
        document.getElementById('fh-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const inp = document.getElementById('fh-input');
            const val = (inp.value || '').trim();
            if (!val) return;
            inp.value = '';
            sendHelperPrompt(val);
        });

        window.addEventListener('resize', syncFabSidebarState);
        const sb = document.getElementById('app-sidebar');
        if (sb && typeof MutationObserver !== 'undefined') {
            new MutationObserver(syncFabSidebarState).observe(sb, { attributes: true, attributeFilter: ['class'] });
        }
        syncFabSidebarState();
        setHelperMode(currentMode);
        renderMessages();

        // Restore expanded/open states & execute any pending cross-page action
        try {
            if (sessionStorage.getItem(EXPAND_STATE_KEY) === '1') {
                toggleExpandPanel(true);
            }
            if (sessionStorage.getItem(OPEN_STATE_KEY) === '1') {
                toggleHelperPanel(true);
            }
            const pendingAction = consumePendingCrossPageAction();
            if (pendingAction) {
                executeHelperAction(pendingAction, true);
            }
        } catch (_) {}
    }

    function toggleHelperPanel(forceState) {
        const panel = document.getElementById('friday-helper-panel');
        if (!panel) return;
        const next = typeof forceState === 'boolean' ? forceState : !panel.classList.contains('open');
        panel.classList.toggle('open', next);
        try { sessionStorage.setItem(OPEN_STATE_KEY, next ? '1' : '0'); } catch (_) {}
        if (next) {
            setTimeout(() => document.getElementById('fh-input')?.focus(), 80);
        }
    }

    window.toggleFridayHelper = toggleHelperPanel;

    function renderMessages() {
        const container = document.getElementById('fh-messages');
        if (!container) return;
        const hist = getHistory();
        container.innerHTML = '';

        const welcome = document.createElement('div');
        welcome.className = 'fh-msg assistant';
        welcome.innerHTML = `Hi! I'm <strong>F.R.I.D.A.Y.</strong> Use <strong>⚡ Site Co-Pilot</strong> to find pages or auto-apply filters/settings, or switch to <strong>🧠 Tactical AI</strong> to ask Torn City combat, gym, war, or company strategy questions.`;
        container.appendChild(welcome);

        hist.forEach(item => {
            const div = document.createElement('div');
            div.className = `fh-msg ${item.role === 'user' ? 'user' : 'assistant'}`;
            div.innerHTML = formatMsgHtml(item.text);
            if (item.action && item.action.label) {
                const pill = document.createElement('button');
                pill.type = 'button';
                pill.className = 'fh-action-pill';
                pill.innerHTML = `⚡ Executed: ${formatMsgHtml(item.action.label)}`;
                pill.addEventListener('click', () => executeHelperAction(item.action));
                div.appendChild(document.createElement('br'));
                div.appendChild(pill);
            }
            container.appendChild(div);
        });

        if (isHelperBusy) {
            const typing = document.createElement('div');
            typing.className = 'fh-typing-bubble';
            typing.id = 'fh-typing-indicator';
            typing.innerHTML = `<span class="fh-spinner"></span> <span>F.R.I.D.A.Y. is executing...</span>`;
            container.appendChild(typing);
        }

        container.scrollTop = container.scrollHeight;
    }

    // Instant client-side execution (<100ms) for the 8 built-in quick-prompt pills
    function executeInstantQuickChip(chip) {
        if (isHelperBusy) {
            promptQueue.push({ type: 'chip', chip });
            return;
        }
        const hist = getHistory();
        hist.push({ role: 'user', text: chip.label });
        hist.push({ role: 'assistant', text: chip.instantReply, action: chip.instantAction });
        saveHistory(hist);
        renderMessages();
        executeHelperAction(chip.instantAction);
    }

    async function sendHelperPrompt(text) {
        if (isHelperBusy) {
            promptQueue.push({ type: 'prompt', text });
            const hist = getHistory();
            hist.push({ role: 'user', text });
            saveHistory(hist);
            renderMessages();
            return;
        }

        const hist = getHistory();
        if (!hist.length || hist[hist.length - 1].role !== 'user' || hist[hist.length - 1].text !== text) {
            hist.push({ role: 'user', text });
            saveHistory(hist);
        }

        if (/^(replay|play|show|start)\s+(friday\s+|hud\s+)?intro$|^reboot\s+(hud|friday|intro)$/i.test(text.trim())) {
            const localAction = { type: 'replay_intro', label: 'Launched F.R.I.D.A.Y. Boot Intro' };
            hist.push({ role: 'assistant', text: 'Initiating **F.R.I.D.A.Y. Mark-85 Holographic Boot Sequence** now.', action: localAction });
            saveHistory(hist);
            renderMessages();
            executeHelperAction(localAction);
            return;
        }

        // Fast client-side Crime & Level Analytics Intel Co-Pilot Q&A (works on ANY page using cached FactionOSCrimeIntel!)
        const qLow = text.trim().toLowerCase();
        const crimeIntelObj = (() => {
            try {
                if (window.FactionOSCrimeIntel && window.FactionOSCrimeIntel.crimes) return window.FactionOSCrimeIntel;
                const raw = localStorage.getItem('factionos_crime_intel_summary_v1');
                return raw ? JSON.parse(raw) : null;
            } catch (_) { return null; }
        })();

        const CRIME_ALIAS_MAP = [
            ['search_for_cash', /\bsearch\s*for\s*cash\b|\bsfc\b/],
            ['bootlegging', /\bbootlegg/],
            ['graffiti', /\bgraffiti\b/],
            ['shoplifting', /\bshoplift/],
            ['pickpocketing', /\bpickpocket/],
            ['card_skimming', /\bcard\s*skimm|\bskimm/],
            ['burglary', /\bburglar/],
            ['hustling', /\bhustl/],
            ['disposal', /\bdispos/],
            ['cracking', /\bcrack/],
            ['forgery', /\bforger/],
            ['scamming', /\bscamm/],
            ['arson', /\barson\b/]
        ];
        let matchedCrimeKey = null;
        for (const [ck, rx] of CRIME_ALIAS_MAP) {
            if (rx.test(qLow)) { matchedCrimeKey = ck; break; }
        }

        const asksLevelProgress = /\b(next\s*level|hit\s*(my\s*)?next\s*level|level\s*progress|level\s*estimator|level\s*holding|how\s*close.*level|when\s*will\s*i\s*(hit|reach).*level)\b/.test(qLow) && !matchedCrimeKey && !/\bcrime\s*skill\b/.test(qLow);
        const asksBestCrime = /\b(most\s*\$?\s*\/?\s*nerve|best\s*\$?\s*\/?\s*nerve|best\s*crime\s*(profit|money)|highest\s*\$?\s*\/?\s*nerve|fastest\s*crime|fastest\s*to\s*(cs\s*)?100|safest\s*crime|lowest\s*crit)\b/.test(qLow);
        const asksSpecificCrime = Boolean(matchedCrimeKey && /\b(how\s*many|attempts?|nerve|days?|time|long|until|to\s*(cs|level|lvl)?\s*\d+|eta|estimate|skill|profit|progress|inspect|open|check)\b/.test(qLow));

        if (asksSpecificCrime || asksLevelProgress || asksBestCrime) {
            if (!crimeIntelObj || !crimeIntelObj.crimes) {
                const openAct = {
                    type: 'crimes_action',
                    page: asksLevelProgress ? '/crimes.html#level' : '/crimes.html',
                    tab: asksLevelProgress ? 'level' : 'overview',
                    crime: matchedCrimeKey,
                    label: 'Open Crime & Level Analytics'
                };
                hist.push({
                    role: 'assistant',
                    text: `I don't have synced crime or level telemetry cached in this browser yet. Opening **Crime & Level Analytics** so you can sync your logs (or toggle **Preview Demo Data**).`,
                    action: openAct
                });
                saveHistory(hist);
                renderMessages();
                executeHelperAction(openAct);
                return;
            }

            if (asksSpecificCrime && matchedCrimeKey && crimeIntelObj.crimes[matchedCrimeKey]) {
                const c = crimeIntelObj.crimes[matchedCrimeKey];
                const tgtMatch = qLow.match(/\b(?:level|lvl|cs|to|until|reach)\s*(\d{1,3})\b/);
                const targetCS = tgtMatch ? Math.min(100, Math.max(Math.ceil(c.currentSkill + 0.01), parseInt(tgtMatch[1], 10))) : 100;

                // Exact nonlinear projection (reuse page helper if available, else local curve matching crimes-engine.js)
                let estAtt = c.cs100Attempts;
                let estNerve = c.cs100Nerve;
                let estDays = c.cs100Days;
                if (typeof window.FactionOSCrimeIntelProject === 'function') {
                    const p = window.FactionOSCrimeIntelProject(matchedCrimeKey, targetCS);
                    if (p) { estAtt = p.attemptsRemaining; estNerve = p.nerveRemaining; estDays = Number(p.daysRemaining.toFixed(1)); }
                } else if (targetCS < 100 && c.currentSkill < targetCS) {
                    const cf = (s) => 1 + 0.022 * s + (s > 50 ? 0.00055 * Math.pow(s - 50, 2.2) : 0) + (s > 75 ? 0.0018 * Math.pow(s - 75, 2.1) : 0);
                    const base = c.calibratedBaseRate || 5;
                    const floor = Math.floor(c.currentSkill);
                    let sumA = 0;
                    for (let l = floor; l < targetCS; l++) {
                        const frac = l === floor ? Math.max(0.05, 1 - (c.currentSkill - floor)) : 1;
                        sumA += Math.max(2, base * cf(l + 0.5)) * frac;
                    }
                    estAtt = Math.ceil(sumA);
                    estNerve = Math.ceil(estAtt * (c.avgNerve || 4));
                    estDays = Number((estNerve / Math.max(24, crimeIntelObj.dailyNerveAvg || 150)).toFixed(1));
                }

                const act = {
                    type: 'crimes_action',
                    page: '/crimes.html',
                    tab: 'overview',
                    crime: matchedCrimeKey,
                    targetSkill: targetCS,
                    label: `Inspect ${c.name} (Target CS ${targetCS})`
                };
                const demoNote = crimeIntelObj.isDemo ? ' *(Preview Demo Data)*' : '';
                const replyTxt = c.currentSkill >= 100
                    ? `${c.icon} **${c.name}** is already maxed at **CS 100**${demoNote}! Your efficiency is **$${c.profitPerNerve.toLocaleString()}/nerve** (${c.successRate}% success).`
                    : `${c.icon} **${c.name}** is currently **CS ${c.currentSkill} / 100**${demoNote} (${c.confidence} confidence):\n• **Next Level (CS ${Math.min(100, Math.floor(c.currentSkill) + 1)}):** ~**${c.nextAttempts.toLocaleString()} attempts** (${c.nextNerve.toLocaleString()} nerve)\n• **Target CS ${targetCS}:** ~**${estAtt.toLocaleString()} attempts** • **${estNerve.toLocaleString()} nerve** • ~**${estDays} days** at ${crimeIntelObj.dailyNerveAvg} N/day\n• **Efficiency:** **$${c.profitPerNerve.toLocaleString()}/nerve** (${c.critFailRate}% crit-fail rate)`;

                hist.push({ role: 'assistant', text: replyTxt, action: act });
                saveHistory(hist);
                renderMessages();
                if (normalizePath(window.location.pathname) === '/crimes.html') {
                    executeHelperAction(act);
                }
                return;
            }

            if (asksLevelProgress) {
                const lv = crimeIntelObj.levelEstimate;
                const demoNote = crimeIntelObj.isDemo ? ' *(Preview Demo Data)*' : '';
                const act = {
                    type: 'crimes_action',
                    page: '/crimes.html#level',
                    tab: 'level',
                    label: `Open Level ${lv.currentLevel}→${lv.nextLevel} Estimator`
                };
                const holdTxt = lv.isLevelHolding ? `\n🔒 **Heads-up:** Your XP activity suggests you may be **Level Holding** (or have an Upgrade ready).` : '';
                const replyTxt = `⭐ **Regular Level Progress (Lvl ${lv.currentLevel} → ${lv.nextLevel})**${demoNote}:\n• **Estimated Progress:** **~${lv.progressPct}%**${lv.hofLevelRank ? ` (HoF Rank #${lv.hofLevelRank.toLocaleString()})` : ''}\n• **Remaining Effort:** ~**${lv.leavesRemaining.toLocaleString()} similar-level Leave attacks** OR ~**${lv.crimesRemaining.toLocaleString()} crimes**\n• **Projected ETA:** ~**${lv.estDaysToLevel} days** at your recent pace.${holdTxt}`;

                hist.push({ role: 'assistant', text: replyTxt, action: act });
                saveHistory(hist);
                renderMessages();
                if (normalizePath(window.location.pathname) === '/crimes.html') {
                    executeHelperAction(act);
                }
                return;
            }

            if (asksBestCrime) {
                const allC = Object.values(crimeIntelObj.crimes);
                const demoNote = crimeIntelObj.isDemo ? ' *(Preview Demo Data)*' : '';
                let recMode = 'profit';
                let ranked = [];
                let heading = '';
                if (/fastest|100/.test(qLow)) {
                    recMode = 'fastest';
                    ranked = allC.filter(c => c.currentSkill < 100).sort((a, b) => a.cs100Nerve - b.cs100Nerve).slice(0, 3);
                    heading = '🚀 **Fastest Crimes to CS 100**';
                } else if (/safest|lowest\s*crit/.test(qLow)) {
                    recMode = 'safest';
                    ranked = allC.filter(c => c.attempts > 0 && c.currentSkill < 100).sort((a, b) => a.critFailRate - b.critFailRate).slice(0, 3);
                    heading = '🛡️ **Safest Crimes (Lowest Crit-Fail Rate)**';
                } else {
                    recMode = 'profit';
                    ranked = allC.filter(c => c.attempts > 0).sort((a, b) => b.profitPerNerve - a.profitPerNerve).slice(0, 3);
                    heading = '💰 **Highest $/Nerve Crimes**';
                }
                const lines = ranked.map((c, idx) => {
                    if (recMode === 'fastest') return `${idx + 1}. ${c.icon} **${c.name}** (CS ${c.currentSkill}) — ~**${c.cs100Days}d** (${c.cs100Attempts.toLocaleString()} att)`;
                    if (recMode === 'safest') return `${idx + 1}. ${c.icon} **${c.name}** (CS ${c.currentSkill}) — **${c.critFailRate}% CF** (${c.successRate}% success)`;
                    return `${idx + 1}. ${c.icon} **${c.name}** — **$${c.profitPerNerve.toLocaleString()}/nerve** ($${c.netProfit.toLocaleString()} net)`;
                });
                const topPick = ranked[0];
                const act = {
                    type: 'crimes_action',
                    page: '/crimes.html',
                    tab: 'overview',
                    recommendMode: recMode,
                    crime: topPick?.key || null,
                    label: topPick ? `Inspect #1 ${topPick.name}` : 'Open Crime Recommender'
                };
                hist.push({
                    role: 'assistant',
                    text: `${heading}${demoNote}:\n${lines.join('\n') || 'Sync logs to rank your crimes.'}`,
                    action: act
                });
                saveHistory(hist);
                renderMessages();
                return;
            }
        }

        // Fast client-side Travel Co-Pilot intent parser ("overnight sleep flight", "swiss rehab", "instant npc cash", "best run under 2 hours with $2M budget")
        if (/\b(best\s+run|best\s+flight|sleep\s+flight|overnight\s+flight|before\s+bed|swiss\s+rehab|zurich\s+rehab|rehab\s+flight|rehab\s+combo|instant\s+npc|npc\s+cash|museum\s+set|set\s+planner|fly\s+for\s+a\s+set|contraband|mug\s+risk|50[\s-]*flight|travel\s+merit|country\s+cards)\b/.test(qLow)) {
            let preset = null;
            if (/\bsleep\s+flight|overnight\s+flight|before\s+bed/.test(qLow)) preset = 'sleep';
            else if (/\bswiss\s+rehab|zurich\s+rehab|rehab\s+flight|rehab\s+combo/.test(qLow)) preset = 'rehab';
            else if (/\binstant\s+npc|npc\s+cash/.test(qLow)) preset = 'npc_cash';

            let filter = null;
            if (!preset) {
                if (/\bplushie/.test(qLow)) filter = 'plushie';
                else if (/\bflower/.test(qLow)) filter = 'flower';
                else if (/\bcontraband|black\s*market/.test(qLow)) filter = 'contraband';
                else if (/\bweapon|temp/.test(qLow)) filter = 'weapon';
                else if (/\bdrug|xanax/.test(qLow)) filter = 'drug';
            }

            let viewMode = null;
            if (/\bmuseum|set\s*planner|fly\s*for\s*a\s*set/.test(qLow)) viewMode = 'museum';
            else if (/\bcountry\s*card|by\s*country/.test(qLow)) viewMode = 'countries';
            else if (/\bmerit|50[\s-]*flight|trip\s*log/.test(qLow)) viewMode = 'merits';
            else if (/\bscatter|chart|simulator/.test(qLow)) viewMode = 'analytics';
            else if (preset) viewMode = 'items';

            const hrM = qLow.match(/(?:under|max|within|<=?)\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
            const minM = qLow.match(/(?:under|max|within|<=?)\s*(\d+)\s*(?:m|min|mins|minutes)\b/);
            const maxRtMins = hrM ? Math.round(parseFloat(hrM[1]) * 60) : (minM ? parseInt(minM[1], 10) : null);

            let budget = null;
            const bM = qLow.match(/\$\s*(\d+(?:\.\d+)?)\s*([mkb])?\b/) || qLow.match(/\b(\d+(?:\.\d+)?)\s*([mkb])\s*budget\b/);
            if (bM) {
                const mult = bM[2] === 'b' ? 1e9 : (bM[2] === 'm' ? 1e6 : (bM[2] === 'k' ? 1e3 : 1));
                budget = Math.round(parseFloat(bM[1]) * mult);
            }
            const lowMugRisk = /\blow\s*mug|\bno\s*mug|\bsafe\s*mug/.test(qLow);
            const noEnergyWaste = /\bno\s*energy\s*waste|\b0e\s*waste|\benergy\s*guard/.test(qLow);

            const travelAct = {
                type: 'travel_action',
                page: '/travel.html',
                preset,
                filter,
                viewMode,
                maxRtMins,
                budget,
                lowMugRisk,
                noEnergyWaste,
                inStockOnly: preset !== 'rehab',
                label: preset ? `Activated Travel Preset: ${preset.toUpperCase()}` : 'Applied Travel Tactical Plan'
            };
            const summaryParts = [];
            if (preset === 'sleep') summaryParts.push(`activated **🌙 Overnight / Sleep Flight Planner**`);
            else if (preset === 'rehab') summaryParts.push(`activated **🏥 Swiss Rehab Combo (Zurich)**`);
            else if (preset === 'npc_cash') summaryParts.push(`activated **🕶️ Instant City NPC Cash (0% Tax)**`);
            if (viewMode && !preset) summaryParts.push(`switched to **${viewMode.toUpperCase()}** view`);
            if (filter) summaryParts.push(`filtered to **${filter}**`);
            if (maxRtMins) summaryParts.push(`max flight time **≤${maxRtMins}m RT**`);
            if (budget) summaryParts.push(`budget cap **$${budget.toLocaleString()}**`);
            if (lowMugRisk) summaryParts.push(`**Low Mug Risk**`);
            if (noEnergyWaste) summaryParts.push(`**0E/0N Waste Guard**`);
            hist.push({
                role: 'assistant',
                text: `Executing on **Travel Profit Desk**: ${summaryParts.length ? summaryParts.join(', ') : 'showing optimal in-stock travel runs'}.`,
                action: travelAct
            });
            saveHistory(hist);
            renderMessages();
            executeHelperAction(travelAct);
            return;
        }

        isHelperBusy = true;
        const sendBtn = document.getElementById('fh-send-btn');
        if (sendBtn) sendBtn.disabled = true;
        updateChipsBar();
        renderMessages();

        try {
            const res = await fetch('/api/ai/helper', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    mode: currentMode,
                    currentPage: window.location.pathname + window.location.hash,
                    history: hist.slice(-8),
                    crimeIntel: crimeIntelObj || null
                })
            });
            const data = await res.json();
            const reply = data.reply || 'Done!';
            const action = data.action || null;

            const updated = getHistory();
            updated.push({ role: 'assistant', text: reply, action });
            saveHistory(updated);
            isHelperBusy = false;
            renderMessages();

            if (action) {
                executeHelperAction(action);
            }
        } catch (err) {
            const updated = getHistory();
            updated.push({ role: 'assistant', text: 'Connection error reaching F.R.I.D.A.Y. helper: ' + (err.message || 'Network error') });
            saveHistory(updated);
            isHelperBusy = false;
            renderMessages();
        } finally {
            isHelperBusy = false;
            if (sendBtn) sendBtn.disabled = false;
            updateChipsBar();
            if (promptQueue.length > 0) {
                const nextItem = promptQueue.shift();
                if (nextItem.type === 'chip') {
                    executeInstantQuickChip(nextItem.chip);
                } else if (nextItem.text) {
                    sendHelperPrompt(nextItem.text);
                }
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectHelperUI);
    } else {
        injectHelperUI();
    }
})();
