'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// F.R.I.D.A.Y. BOTTOM-LEFT SITE CO-PILOT & AUTO-ACTION WIDGET
// Helps users find anything on FactionOS and executes filters, sorts, tab
// switches, and settings changes for them automatically.
// ══════════════════════════════════════════════════════════════════════════════
(function () {
    if (window.__fridayHelperLoaded) return;
    window.__fridayHelperLoaded = true;

    const HISTORY_KEY = 'sv_friday_helper_history_v1';
    const PENDING_ACTION_KEY = 'sv_friday_pending_action';
    const OPEN_STATE_KEY = 'sv_friday_helper_open';

    const CORE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8" opacity="0.45"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/></svg>`;
    const CLOSE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const SEND_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

    const QUICK_CHIPS = [
        { label: '🩸 Blood Bag Fillers', prompt: 'Show me who filled empty blood bags in the armory' },
        { label: '🏋️ Gym Slackers', prompt: 'Show gym slackers on the roster' },
        { label: '💊 Idle Drug CD', prompt: 'Show members with drug cooldown off' },
        { label: '🎯 Optimal FF Targets', prompt: 'Filter enemy targets to optimal fair fight' },
        { label: '✈️ Who Is Flying?', prompt: 'Show me who is flying in airspace intel' },
        { label: '🧸 Travel Plushies', prompt: 'Filter travel desk to plushies' },
        { label: '🌓 Toggle Theme', prompt: 'Toggle dark or light mode' },
        { label: '⚙️ API Settings', prompt: 'Open API settings' }
    ];

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
            sessionStorage.setItem(HISTORY_KEY, JSON.stringify((arr || []).slice(-16)));
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
            el.style.outline = '2px solid #06b6d4';
            el.style.boxShadow = '0 0 18px rgba(6, 182, 212, 0.45)';
            setTimeout(() => {
                el.style.outline = prevOutline;
                el.style.boxShadow = '';
                el.style.transition = prevTransition;
            }, 2200);
        } catch (_) {}
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
            try {
                sessionStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(action));
                sessionStorage.setItem(OPEN_STATE_KEY, '1');
            } catch (_) {}
            window.location.href = action.page;
            return true;
        }

        // 3. Page-specific DOM & controller execution
        const runDomAction = () => {
            try {
                // LIVE WARBOARD (/)
                if (action.type === 'warboard_action') {
                    if (action.enemyFilter && typeof window.setEnemyFilter === 'function') {
                        window.setEnemyFilter(action.enemyFilter);
                        flashElement(document.getElementById('eflt-' + action.enemyFilter) || document.getElementById('enemy-list'));
                    }
                    if (action.friendlyFilter && typeof window.setFriendlyFilter === 'function') {
                        window.setFriendlyFilter(action.friendlyFilter);
                        flashElement(document.getElementById('fflt-m-' + action.friendlyFilter) || document.getElementById('friendly-list'));
                    }
                    if (action.enemySort && typeof window.handleEnemySort === 'function') {
                        const sel = document.getElementById('enemy-sort-select');
                        if (sel) sel.value = action.enemySort;
                        window.handleEnemySort(action.enemySort);
                        flashElement(sel);
                    }
                    if (action.toggleHud && typeof window.toggleHudMode === 'function') {
                        window.toggleHudMode();
                    }
                    if (action.toggleSim && typeof window.toggleWarSimulation === 'function') {
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
                        flashElement(segBtn || document.getElementById('tracker-member-table'));
                    } else if (action.actionFilter && typeof window.setArmoryActionFilter === 'function') {
                        window.setArmoryActionFilter(action.actionFilter);
                        flashElement(document.getElementById('tracker-member-table'));
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
                        flashElement(pill);
                    }
                    if (action.sortCol && typeof window.sortRoster === 'function') {
                        window.sortRoster(action.sortCol);
                        flashElement(document.getElementById('master-roster-table'));
                    }
                    if (action.search) {
                        const sInp = document.getElementById('roster-search');
                        if (sInp) {
                            sInp.value = action.search;
                            sInp.dispatchEvent(new Event('input'));
                            flashElement(sInp);
                        }
                    }
                    if (action.ffTargetStats && typeof window.setFfPreset === 'function') {
                        window.setFfPreset(Number(action.ffTargetStats));
                        flashElement(document.getElementById('ff-matches-table'));
                    }
                }

                // OPERATIONS OVERVIEW & AIRSPACE (/dashboard.html)
                if (action.type === 'dashboard_action') {
                    if (action.tab && typeof window.switchOpsTab === 'function') {
                        window.switchOpsTab(action.tab);
                        flashElement(document.getElementById('tab-btn-' + action.tab));
                    }
                }

                // CHAIN SENTINEL (/chain.html)
                if (action.type === 'chain_action') {
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
                if (action.type === 'payout_action') {
                    if (action.loadLastWar && typeof window.fetchReport === 'function') {
                        window.fetchReport('51235');
                    }
                }

                // OC MANAGER (/oc.html)
                if (action.type === 'oc_action') {
                    if (action.tab && typeof window.setTab === 'function') {
                        window.setTab(action.tab);
                        flashElement(document.getElementById('tab-' + action.tab));
                    }
                }

                // TRAVEL PROFIT DESK (/travel.html)
                if (action.type === 'travel_action') {
                    if (action.capacity) {
                        const capEl = document.getElementById('capacity');
                        if (capEl && typeof window.applyCapacity === 'function') {
                            capEl.value = action.capacity;
                            window.applyCapacity();
                            flashElement(capEl);
                        }
                    }
                    if (action.flightProfile) {
                        const fpEl = document.getElementById('flight-profile');
                        if (fpEl && typeof window.applyFlightProfile === 'function') {
                            fpEl.value = action.flightProfile;
                            window.applyFlightProfile();
                            flashElement(fpEl);
                        }
                    }
                    if (action.filter && typeof window.setFilter === 'function') {
                        const btn = document.querySelector(`.pill-btn[data-filter="${action.filter}"]`);
                        if (btn) {
                            window.setFilter(action.filter, btn);
                            flashElement(btn);
                        }
                    }
                }

                // COMPANY HUB (/company.html)
                if (action.type === 'company_action') {
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
                            flashElement(btn);
                        }
                    }
                }

                // DISCORD SENTINEL & MARKET SNIPER (/discord.html)
                if (action.type === 'discord_action') {
                    if (action.tab && typeof window.switchDeckTab === 'function') {
                        window.switchDeckTab(action.tab);
                        flashElement(document.querySelector(`.deck-tab-btn[data-tab="${action.tab}"]`));
                    }
                }

                // BUG TRACKER (/bugs.html)
                if (action.type === 'bugs_action') {
                    if (action.openModal && typeof window.openReportModal === 'function') {
                        window.openReportModal();
                    }
                }
            } catch (e) {
                console.warn('[FRIDAY Helper] Action execution warning:', e);
            }
        };

        if (fromPending) {
            setTimeout(runDomAction, 550);
        } else {
            runDomAction();
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

    function injectHelperUI() {
        if (document.getElementById('friday-helper-fab')) return;

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
                background: linear-gradient(135deg, rgba(13, 19, 30, 0.97), rgba(9, 14, 22, 0.99));
                border: 1px solid rgba(6, 182, 212, 0.45);
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55), 0 0 14px rgba(6, 182, 212, 0.18);
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
                border-color: #06b6d4;
                box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65), 0 0 20px rgba(6, 182, 212, 0.35);
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
                background: radial-gradient(circle, rgba(6, 182, 212, 0.25), rgba(6, 182, 212, 0.05));
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

            #friday-helper-panel {
                position: fixed;
                bottom: 68px;
                left: 14px;
                width: 375px;
                max-width: calc(100vw - 28px);
                height: 510px;
                max-height: calc(100vh - 92px);
                z-index: 9992;
                background: var(--bg-surface, #10151f);
                border: 1px solid rgba(6, 182, 212, 0.45);
                border-radius: 14px;
                box-shadow: 0 18px 50px rgba(0, 0, 0, 0.7), 0 0 24px rgba(6, 182, 212, 0.16);
                display: none;
                flex-direction: column;
                overflow: hidden;
                font-family: var(--font-sans, 'Inter', sans-serif);
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
                padding: 12px 14px;
                background: linear-gradient(90deg, rgba(6, 182, 212, 0.14), rgba(59, 130, 246, 0.08));
                border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }
            .fh-header-left {
                display: flex;
                align-items: center;
                gap: 10px;
                min-width: 0;
            }
            .fh-header-title {
                font-size: 0.86rem;
                font-weight: 800;
                color: var(--text-primary, #f8fafc);
                line-height: 1.2;
            }
            .fh-header-sub {
                font-size: 0.69rem;
                color: var(--text-secondary, #94a3b8);
            }
            .fh-header-actions {
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .fh-icon-btn {
                background: rgba(255,255,255,0.06);
                border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
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
                border-color: #06b6d4;
            }
            .fh-chips-bar {
                padding: 8px 10px;
                border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.07));
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                background: rgba(0, 0, 0, 0.16);
                flex-shrink: 0;
            }
            .fh-chip {
                background: var(--bg-elevated, #161d2a);
                border: 1px solid var(--border-default, rgba(255,255,255,0.12));
                color: var(--text-secondary, #cbd5e1);
                padding: 3px 8px;
                border-radius: 99px;
                font-size: 0.69rem;
                font-weight: 700;
                white-space: nowrap;
                cursor: pointer;
                transition: all 0.15s;
            }
            .fh-chip:hover {
                border-color: #06b6d4;
                color: #06b6d4;
                background: rgba(6, 182, 212, 0.1);
            }
            .fh-messages {
                flex: 1;
                overflow-y: auto;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .fh-msg {
                max-width: 90%;
                padding: 9px 12px;
                border-radius: 10px;
                font-size: 0.81rem;
                line-height: 1.48;
                word-break: break-word;
            }
            .fh-msg.assistant {
                align-self: flex-start;
                background: var(--bg-elevated, #171f2e);
                border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
                color: var(--text-primary, #f1f5f9);
            }
            .fh-msg.user {
                align-self: flex-end;
                background: #2563eb;
                color: #ffffff;
                font-weight: 500;
            }
            .fh-action-pill {
                margin-top: 7px;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 4px 9px;
                border-radius: 6px;
                background: rgba(16, 185, 129, 0.14);
                border: 1px solid rgba(16, 185, 129, 0.4);
                color: #10b981;
                font-size: 0.72rem;
                font-weight: 800;
                cursor: pointer;
            }
            .fh-action-pill:hover {
                background: rgba(16, 185, 129, 0.24);
            }
            .fh-input-row {
                padding: 10px 12px;
                border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
                display: flex;
                align-items: center;
                gap: 8px;
                background: var(--bg-elevated, #141b26);
            }
            .fh-input {
                flex: 1;
                padding: 8px 11px !important;
                border-radius: 8px !important;
                border: 1px solid var(--border-default, rgba(255,255,255,0.14)) !important;
                background: var(--bg-surface, #0c1017) !important;
                color: var(--text-primary, #fff) !important;
                font-size: 0.81rem !important;
                outline: none !important;
            }
            .fh-input:focus {
                border-color: #06b6d4 !important;
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
        `;
        document.head.appendChild(style);

        const fab = document.createElement('button');
        fab.id = 'friday-helper-fab';
        fab.type = 'button';
        fab.title = 'Ask F.R.I.D.A.Y. Helper AI to find features or change filters for you';
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
                <div class="fh-header-left">
                    <span class="fh-fab-core">${CORE_SVG}</span>
                    <div>
                        <div class="fh-header-title">F.R.I.D.A.Y. Site Co-Pilot</div>
                        <div class="fh-header-sub">Finds pages, changes settings &amp; filters for you</div>
                    </div>
                </div>
                <div class="fh-header-actions">
                    <button type="button" class="fh-icon-btn" id="fh-clear-btn" title="Clear conversation">Clear</button>
                    <button type="button" class="fh-icon-btn" id="fh-close-btn" aria-label="Close helper">${CLOSE_SVG}</button>
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

        const chipsBar = document.getElementById('fh-chips-bar');
        QUICK_CHIPS.forEach(c => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'fh-chip';
            btn.textContent = c.label;
            btn.addEventListener('click', () => sendHelperPrompt(c.prompt));
            chipsBar.appendChild(btn);
        });

        document.getElementById('fh-close-btn').addEventListener('click', () => toggleHelperPanel(false));
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
        renderMessages();

        // Check if panel was open before navigation or has a pending cross-page action
        try {
            if (sessionStorage.getItem(OPEN_STATE_KEY) === '1') {
                toggleHelperPanel(true);
            }
            const pendingRaw = sessionStorage.getItem(PENDING_ACTION_KEY);
            if (pendingRaw) {
                sessionStorage.removeItem(PENDING_ACTION_KEY);
                const pendingAction = JSON.parse(pendingRaw);
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
        welcome.innerHTML = `Hi! I'm <strong>F.R.I.D.A.Y.</strong> Tell me what you're looking for or what filter/setting you want changed (e.g. <em>"show blood bag fillers"</em>, <em>"show gym slackers"</em>, <em>"filter enemies to okay now"</em>, or <em>"switch to light mode"</em>) and I'll do it for you automatically.`;
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
        container.scrollTop = container.scrollHeight;
    }

    async function sendHelperPrompt(text) {
        const hist = getHistory();
        hist.push({ role: 'user', text });
        saveHistory(hist);
        renderMessages();

        const sendBtn = document.getElementById('fh-send-btn');
        if (sendBtn) sendBtn.disabled = true;

        try {
            const res = await fetch('/api/ai/helper', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    currentPage: window.location.pathname + window.location.hash,
                    history: hist.slice(-8)
                })
            });
            const data = await res.json();
            const reply = data.reply || 'Done!';
            const action = data.action || null;

            const updated = getHistory();
            updated.push({ role: 'assistant', text: reply, action });
            saveHistory(updated);
            renderMessages();

            if (action) {
                executeHelperAction(action);
            }
        } catch (err) {
            const updated = getHistory();
            updated.push({ role: 'assistant', text: 'Connection error reaching F.R.I.D.A.Y. helper: ' + (err.message || 'Network error') });
            saveHistory(updated);
            renderMessages();
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectHelperUI);
    } else {
        injectHelperUI();
    }
})();
