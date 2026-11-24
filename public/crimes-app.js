/**
 * FactionOS — Crime & Level Analytics Page Controller (crimes.html)
 * Coordinates IndexedDB sync, Snapshot hydration, Chart.js visualizations,
 * Deep-Dive Forecast modal, Level Planner, Exports, and F.R.I.D.A.Y. Co-Pilot intents.
 */
(function () {
    'use strict';

    const state = {
        userId: null,
        keyAccess: null,
        snapshot: null,
        logs: [],
        meta: null,
        itemPrices: {},
        analytics: null,
        demoMode: false,
        timeframe: 'all',
        crimeFilter: 'all',
        recMode: 'fastest',
        activeTab: 'overview',
        globalTarget: 100, // number or 'plus5'
        sortCol: 'currentSkill',
        sortAsc: false,
        profitChartMode: 'per_nerve',
        deepDiveCrimeKey: null,
        deepDiveTarget: 100,
        deepDiveXAxis: 'nerve',
        manualLevelUpTs: null,
        pendingFridayAction: null,
        charts: {
            outcomes: null,
            profit: null,
            timeline: null,
            xpDonut: null,
            ddForecast: null,
            ddHistogram: null
        },
        syncer: null
    };

    // ── Formatting Helpers ───────────────────────────────────────────────────
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function fmtMoney(n) {
        const v = Number(n || 0);
        const sign = v < 0 ? '-' : '';
        const abs = Math.abs(v);
        if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
        if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
        if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
        return `${sign}$${Math.round(abs).toLocaleString()}`;
    }
    function fmtDaysOrHrs(days) {
        const d = Number(days || 0);
        if (d <= 0) return 'Done';
        if (d < 1) return `${Math.max(1, Math.round(d * 24))}h`;
        if (d < 14) return `${d.toFixed(1)}d`;
        return `${Math.round(d)}d`;
    }
    function showToast(msg) {
        const el = document.getElementById('cr-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('show'), 2600);
    }

    // ── Boot & Hydration ─────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
        populateCrimeFilterDropdown();

        const DB = window.FactionOSCrimesDB;
        state.syncer = new DB.TornLogSyncer({
            throttleMs: 1350,
            onProgress: handleSyncProgress
        });

        // Pre-fill browser-only full key if saved
        const savedFullKey = DB.getBrowserFullKey();
        const keyInp = document.getElementById('browser-full-key');
        if (keyInp && savedFullKey) keyInp.value = savedFullKey;

        // Fetch Torn item market prices from server cache (best-effort)
        fetchItemPricesMap();

        // Check URL hash (#level, #analytics, #overview)
        const hash = (window.location.hash || '').replace('#', '').toLowerCase();
        if (['overview', 'analytics', 'level'].includes(hash)) {
            switchCrimeTab(hash, true);
        }

        await hydrateUserData();
        if (state.pendingFridayAction) {
            const act = state.pendingFridayAction;
            state.pendingFridayAction = null;
            window.applyFridayCrimesCommand(act);
        }
    });

    function populateCrimeFilterDropdown() {
        const sel = document.getElementById('crime-filter-select');
        if (!sel || !window.FactionOSCrimesEngine) return;
        for (const c of window.FactionOSCrimesEngine.CRIMES_CATALOG) {
            const opt = document.createElement('option');
            opt.value = c.key;
            opt.textContent = `${c.icon} ${c.name}`;
            sel.appendChild(opt);
        }
    }

    async function fetchItemPricesMap() {
        try {
            const res = await fetch('/api/items');
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.items) {
                const map = {};
                for (const [id, meta] of Object.entries(data.items)) {
                    map[id] = Number(meta?.market_value || meta?.sell_price || 0);
                }
                state.itemPrices = map;
                if (state.analytics && !state.demoMode && state.logs.length > 0) {
                    recomputeAndRender();
                }
            }
        } catch (_) {}
    }

    async function hydrateUserData() {
        const DB = window.FactionOSCrimesDB;
        const fullKey = DB.getBrowserFullKey();

        // 1. If user saved a browser-only key, inspect it directly against api.torn.com
        if (fullKey) {
            try {
                const keyInfo = await DB.inspectKeyAccess(fullKey);
                state.keyAccess = keyInfo;
                const snap = await DB.fetchDirectSnapshot(fullKey);
                state.snapshot = snap;
                state.userId = snap.userId || keyInfo.userId || 'local';
                updateKeyScopeUI();
                await loadCachedLogsForCurrentUser();
                recomputeAndRender();
                return;
            } catch (err) {
                setSyncStatusBadge('amber', 'Key Check Error');
                showToast('Browser key error: ' + err.message);
            }
        }

        // 2. Otherwise try FactionOS authenticated session snapshot (/api/crimes/snapshot)
        try {
            const res = await fetch('/api/crimes/snapshot');
            if (res.ok) {
                const data = await res.json();
                if (data && data.success && data.snapshot) {
                    state.snapshot = data.snapshot;
                    state.keyAccess = data.keyInfo || { accessType: 'Limited Access', hasLogAccess: false };
                    state.userId = data.snapshot.userId || 'session_user';
                    updateKeyScopeUI();
                    await loadCachedLogsForCurrentUser();
                    recomputeAndRender();
                    return;
                }
            }
        } catch (_) {}

        // 3. Fallback: check if any user profile exists in localStorage, or start ready for Demo / Key
        const prof = typeof window.getUserProfile === 'function' ? window.getUserProfile() : null;
        if (prof && prof.playerId) {
            state.userId = String(prof.playerId);
            await loadCachedLogsForCurrentUser();
        }
        state.keyAccess = { accessType: 'Not Connected', hasLogAccess: false };
        updateKeyScopeUI();
        // If zero logs and no snapshot, auto-load Demo preview so page is immediately rich & interactive!
        if (!state.snapshot && (!state.logs || state.logs.length === 0)) {
            toggleDemoMode(true, true);
        } else {
            recomputeAndRender();
        }
    }

    async function loadCachedLogsForCurrentUser() {
        if (!state.userId) return;
        try {
            const DB = window.FactionOSCrimesDB;
            const [logs, meta] = await Promise.all([
                DB.getUserLogs(state.userId),
                DB.getUserMeta(state.userId)
            ]);
            state.logs = logs || [];
            state.meta = meta;
            state.manualLevelUpTs = meta?.manualLevelUpTs || null;
            const dateInp = document.getElementById('manual-levelup-date');
            if (dateInp) {
                dateInp.value = state.manualLevelUpTs ? new Date(state.manualLevelUpTs * 1000).toISOString().slice(0, 10) : '';
            }
            updateCachedStatsReadout();
        } catch (err) {
            console.warn('[Crimes IDB] Load warning:', err);
        }
    }

    function updateKeyScopeUI() {
        const badge = document.getElementById('key-scope-badge');
        const banner = document.getElementById('limited-scope-banner');
        const btnNew = document.getElementById('btn-sync-new');
        const btnBack = document.getElementById('btn-sync-backfill');

        if (state.demoMode) {
            if (badge) { badge.className = 'cr-badge purple'; badge.textContent = '✨ Preview Demo Mode'; }
            if (banner) banner.classList.remove('visible');
            if (btnNew) btnNew.disabled = true;
            if (btnBack) btnBack.disabled = true;
            return;
        }

        const hasFull = Boolean(state.keyAccess?.hasLogAccess && window.FactionOSCrimesDB.getBrowserFullKey());
        if (hasFull) {
            if (badge) { badge.className = 'cr-badge green'; badge.textContent = `🔓 ${state.keyAccess.accessType} (Browser-Only)`; }
            if (banner) banner.classList.remove('visible');
            if (btnNew) btnNew.disabled = false;
            if (btnBack) btnBack.disabled = false;
        } else if (state.snapshot) {
            if (badge) { badge.className = 'cr-badge amber'; badge.textContent = `🔒 ${state.keyAccess?.accessType || 'Limited Access'}`; }
            if (banner) banner.classList.add('visible');
            if (btnNew) btnNew.disabled = true;
            if (btnBack) btnBack.disabled = true;
        } else {
            if (badge) { badge.className = 'cr-badge red'; badge.textContent = '🔑 Connect Key or Preview Demo'; }
            if (banner) banner.classList.add('visible');
            if (btnNew) btnNew.disabled = true;
            if (btnBack) btnBack.disabled = true;
        }
    }

    function updateCachedStatsReadout() {
        const el = document.getElementById('sync-stats-text');
        if (!el) return;
        if (state.demoMode) {
            el.textContent = `${state.logs.length.toLocaleString()} demo logs • 88-day preview window (not saved to IndexedDB)`;
            return;
        }
        const m = state.meta;
        if (!m || !m.totalLogs) {
            el.textContent = '0 cached logs in Browser IndexedDB';
            return;
        }
        const fromStr = m.minTs ? new Date(m.minTs * 1000).toLocaleDateString() : '—';
        const toStr = m.maxTs ? new Date(m.maxTs * 1000).toLocaleDateString() : '—';
        el.textContent = `${m.totalLogs.toLocaleString()} cached logs (${(m.crimeLogs || 0).toLocaleString()} crimes • ${(m.attackLogs || 0).toLocaleString()} attacks • ${m.levelLogs || 0} lvl-ups) • ${fromStr} → ${toStr}`;
    }

    function setSyncStatusBadge(cls, text) {
        const el = document.getElementById('sync-status-pill');
        if (!el) return;
        el.className = `cr-badge ${cls}`;
        el.textContent = text;
    }

    // ── Key Verification & Log Syncing Controls ──────────────────────────────
    window.toggleKeyMask = function () {
        const inp = document.getElementById('browser-full-key');
        if (!inp) return;
        inp.type = inp.type === 'password' ? 'text' : 'password';
    };

    window.saveBrowserFullKey = async function () {
        const inp = document.getElementById('browser-full-key');
        const raw = (inp?.value || '').trim();
        if (raw.length < 16) {
            showToast('Enter a valid 16-character Torn API key.');
            return;
        }
        setSyncStatusBadge('cyan', 'Verifying Key...');
        try {
            const DB = window.FactionOSCrimesDB;
            const info = await DB.inspectKeyAccess(raw);
            DB.setBrowserFullKey(raw);
            state.demoMode = false;
            updateDemoBtnState();
            state.keyAccess = info;
            const snap = await DB.fetchDirectSnapshot(raw);
            state.snapshot = snap;
            state.userId = snap.userId || info.userId || 'local';
            await loadCachedLogsForCurrentUser();
            updateKeyScopeUI();
            recomputeAndRender();
            setSyncStatusBadge(info.hasLogAccess ? 'green' : 'amber', info.hasLogAccess ? 'Ready to Sync' : 'Limited Scope');
            showToast(info.hasLogAccess
                ? `Verified ${info.accessType} key for ${snap.name}! Click "Sync New Logs" to pull crime history.`
                : `Key verified as ${info.accessType} — Full Access is required for /user/log history.`);
        } catch (err) {
            setSyncStatusBadge('red', 'Verify Failed');
            showToast('Key verification failed: ' + err.message);
        }
    };

    window.startLogSync = async function (mode) {
        const DB = window.FactionOSCrimesDB;
        const fullKey = DB.getBrowserFullKey();
        if (!fullKey || !state.keyAccess?.hasLogAccess) {
            showToast('Enter & verify a browser-only Full Access key first.');
            return;
        }
        if (state.demoMode) toggleDemoMode(false);
        const scope = document.getElementById('sync-scope-select')?.value || 'all';
        const maxPages = parseInt(document.getElementById('sync-pages-select')?.value || '30', 10) || 30;

        document.getElementById('btn-sync-pause').style.display = 'inline-flex';
        document.getElementById('btn-sync-stop').style.display = 'inline-flex';
        document.getElementById('btn-sync-new').disabled = true;
        document.getElementById('btn-sync-backfill').disabled = true;

        try {
            const result = await state.syncer.run({
                apiKey: fullKey,
                userId: state.userId || state.snapshot?.userId || 'local',
                mode,
                scope,
                maxPages
            });
            if (result) {
                state.logs = result.logs;
                state.meta = result.meta;
                updateCachedStatsReadout();
                recomputeAndRender();
            }
        } catch (err) {
            showToast('Sync interrupted: ' + err.message);
        } finally {
            document.getElementById('btn-sync-pause').style.display = 'none';
            document.getElementById('btn-sync-stop').style.display = 'none';
            document.getElementById('btn-sync-pause').textContent = '⏸️ Pause';
            updateKeyScopeUI();
        }
    };

    function handleSyncProgress(ev) {
        const fill = document.getElementById('sync-progress-fill');
        const txt = document.getElementById('sync-stats-text');
        if (ev.status === 'running') {
            setSyncStatusBadge('cyan', 'Syncing...');
            if (fill && ev.maxPages) {
                const pct = Math.min(100, Math.round((ev.pagesFetched / ev.maxPages) * 100));
                fill.style.width = `${Math.max(5, pct)}%`;
            }
            if (txt && ev.message) txt.textContent = ev.message;
        } else if (ev.status === 'paused') {
            setSyncStatusBadge('amber', 'Paused');
            if (txt) txt.textContent = ev.message;
        } else if (ev.status === 'done') {
            setSyncStatusBadge('green', 'Synced');
            if (fill) fill.style.width = '100%';
            if (txt) txt.textContent = ev.message;
        } else if (ev.status === 'stopped') {
            setSyncStatusBadge('amber', 'Stopped');
            if (txt) txt.textContent = ev.message;
        } else if (ev.status === 'error') {
            setSyncStatusBadge('red', 'Error');
            if (txt) txt.textContent = ev.message;
        }
    }

    window.togglePauseSync = function () {
        if (!state.syncer || !state.syncer.isRunning) return;
        const btn = document.getElementById('btn-sync-pause');
        if (state.syncer.isPaused) {
            state.syncer.resume();
            if (btn) btn.textContent = '⏸️ Pause';
        } else {
            state.syncer.pause();
            if (btn) btn.textContent = '▶️ Resume';
        }
    };

    window.stopLogSync = function () {
        if (state.syncer) state.syncer.stop();
    };

    window.refreshSnapshotAndRender = async function () {
        if (state.demoMode) {
            recomputeAndRender();
            showToast('Refreshed Demo Analytics');
            return;
        }
        await hydrateUserData();
        showToast('Refreshed Live Torn Skills & Stats');
    };

    // ── Demo Preview Mode ────────────────────────────────────────────────────
    function updateDemoBtnState() {
        const btn = document.getElementById('btn-demo-toggle');
        if (!btn) return;
        btn.classList.toggle('demo-active', state.demoMode);
        btn.textContent = state.demoMode ? '✨ Exit Demo Preview' : '✨ Preview Demo Data';
    }

    window.toggleDemoMode = function (forceState, silent = false) {
        const next = typeof forceState === 'boolean' ? forceState : !state.demoMode;
        state.demoMode = next;
        updateDemoBtnState();
        const dlSlider = document.getElementById('slider-daily-leaves');
        const dnSlider = document.getElementById('slider-daily-nerve');
        if (dlSlider) delete dlSlider.dataset.userTouched;
        if (dnSlider) delete dnSlider.dataset.userTouched;
        if (state.demoMode) {
            const demo = window.FactionOSCrimesEngine.generateDemoDataset();
            state._savedLive = { snapshot: state.snapshot, logs: state.logs, meta: state.meta };
            state.snapshot = demo.snapshot;
            state.logs = demo.logs;
            setSyncStatusBadge('purple', 'Demo Active');
            const fill = document.getElementById('sync-progress-fill');
            if (fill) fill.style.width = '100%';
            updateKeyScopeUI();
            updateCachedStatsReadout();
            recomputeAndRender();
            if (!silent) showToast('Loaded 88-day Crimes 2.0 & Level Estimator Preview Demo!');
        } else {
            if (state._savedLive) {
                state.snapshot = state._savedLive.snapshot;
                state.logs = state._savedLive.logs || [];
                state.meta = state._savedLive.meta;
            } else {
                state.logs = [];
            }
            setSyncStatusBadge('cyan', 'Idle');
            updateKeyScopeUI();
            updateCachedStatsReadout();
            recomputeAndRender();
            if (!silent) showToast('Returned to Live Account Mode.');
        }
    };

    // ── Manage / Clear Local Data Modal ──────────────────────────────────────
    window.openManageLocalDataModal = function () {
        const sumEl = document.getElementById('manage-data-summary');
        const hasKey = Boolean(window.FactionOSCrimesDB.getBrowserFullKey());
        const m = state.meta;
        if (sumEl) {
            sumEl.innerHTML = `
                <div><strong>Browser-Only Full Key:</strong> ${hasKey ? '<span style="color:#34d399;">Saved in localStorage</span>' : 'Not set'}</div>
                <div><strong>IndexedDB Cached Logs:</strong> ${(m?.totalLogs || 0).toLocaleString()} entries (${(m?.crimeLogs || 0).toLocaleString()} crimes, ${(m?.attackLogs || 0).toLocaleString()} attacks, ${m?.levelLogs || 0} level-ups)</div>
                <div style="margin-top:6px;font-size:11.5px;color:var(--text-tertiary);">All synced log history lives strictly inside your browser's local IndexedDB database and is never uploaded to FactionOS servers.</div>
            `;
        }
        document.getElementById('manage-data-backdrop')?.classList.add('open');
    };

    window.closeManageDataModal = function () {
        document.getElementById('manage-data-backdrop')?.classList.remove('open');
    };

    window.clearBrowserFullKeyOnly = function () {
        window.FactionOSCrimesDB.setBrowserFullKey('');
        const inp = document.getElementById('browser-full-key');
        if (inp) inp.value = '';
        state.keyAccess = { accessType: 'Limited Access', hasLogAccess: false };
        updateKeyScopeUI();
        closeManageDataModal();
        showToast('Removed saved Full Access key from browser.');
    };

    window.clearCachedLogsOnly = async function () {
        if (state.userId) {
            await window.FactionOSCrimesDB.clearUserData(state.userId);
        }
        state.logs = [];
        state.meta = null;
        if (state.demoMode) state.demoMode = false;
        updateDemoBtnState();
        updateCachedStatsReadout();
        recomputeAndRender();
        closeManageDataModal();
        showToast('Cleared IndexedDB cached logs.');
    };

    window.wipeEverythingLocal = async function () {
        window.FactionOSCrimesDB.setBrowserFullKey('');
        await window.FactionOSCrimesDB.clearAllCachedData();
        const inp = document.getElementById('browser-full-key');
        if (inp) inp.value = '';
        state.logs = [];
        state.meta = null;
        state.demoMode = false;
        state.keyAccess = { accessType: 'Not Connected', hasLogAccess: false };
        updateDemoBtnState();
        updateKeyScopeUI();
        updateCachedStatsReadout();
        recomputeAndRender();
        closeManageDataModal();
        showToast('Wiped all local Crime Intel logs & browser key.');
    };

    // ── Filters, Tabs & Sorting ──────────────────────────────────────────────
    window.setTimeframe = function (tf) {
        state.timeframe = tf;
        document.querySelectorAll('#timeframe-pills .tf-pill').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tf') === tf);
        });
        const cw = document.getElementById('custom-date-wrap');
        if (cw) cw.style.display = tf === 'custom' ? 'inline-flex' : 'none';
        recomputeAndRender();
    };

    window.onCrimeFilterChange = function () {
        state.crimeFilter = document.getElementById('crime-filter-select')?.value || 'all';
        recomputeAndRender();
    };

    window.setRecMode = function (mode) {
        state.recMode = mode;
        document.querySelectorAll('#rec-mode-pills .tf-pill').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-rec') === mode);
        });
        renderRecommendations();
    };

    window.setGlobalTarget = function (val) {
        if (val === 'plus5') {
            state.globalTarget = 'plus5';
        } else {
            const num = Math.max(2, Math.min(100, parseInt(val, 10) || 100));
            state.globalTarget = num;
            const inp = document.getElementById('global-target-input');
            if (inp) inp.value = String(num);
        }
        document.querySelectorAll('#pane-overview [data-target]').forEach(b => {
            b.classList.toggle('active', String(b.getAttribute('data-target')) === String(state.globalTarget));
        });
        const th = document.getElementById('th-target-col');
        if (th) th.textContent = (state.globalTarget === 'plus5' ? 'Est. to CS +5 ↕' : `Est. to CS ${state.globalTarget} ↕`);
        renderCrimeEstimatorTable();
    };

    window.sortCrimeTable = function (col) {
        if (state.sortCol === col) state.sortAsc = !state.sortAsc;
        else {
            state.sortCol = col;
            state.sortAsc = col === 'name';
        }
        document.querySelectorAll('.crime-table th[data-sort]').forEach(th => {
            th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sortCol);
        });
        renderCrimeEstimatorTable();
    };

    window.switchCrimeTab = function (tabName, skipChartDelay = false) {
        state.activeTab = tabName || 'overview';
        document.querySelectorAll('.crime-tab-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tab') === state.activeTab);
        });
        document.querySelectorAll('.crime-pane').forEach(p => {
            p.classList.toggle('active', p.id === `pane-${state.activeTab}`);
        });
        if (state.analytics) {
            const runCharts = () => {
                if (state.activeTab === 'analytics') renderAnalyticsCharts();
                if (state.activeTab === 'level') renderLevelTab();
            };
            if (skipChartDelay) runCharts();
            else setTimeout(runCharts, 40);
        }
    };

    window.setProfitChartMode = function (mode) {
        state.profitChartMode = mode;
        document.getElementById('btn-prof-nerve')?.classList.toggle('active', mode === 'per_nerve');
        document.getElementById('btn-prof-total')?.classList.toggle('active', mode === 'total');
        renderProfitChart();
    };

    // ── Master Recompute & Render ────────────────────────────────────────────
    window.recomputeAndRender = function () {
        if (!window.FactionOSCrimesEngine) return;
        const fromStr = document.getElementById('custom-from-date')?.value;
        const toStr = document.getElementById('custom-to-date')?.value;
        const customFromTs = fromStr ? Math.floor(Date.parse(fromStr + 'T00:00:00Z') / 1000) : null;
        const customToTs = toStr ? Math.floor(Date.parse(toStr + 'T00:00:00Z') / 1000) : null;

        state.analytics = window.FactionOSCrimesEngine.computeAnalytics({
            logs: state.logs,
            snapshot: state.snapshot,
            itemPrices: state.itemPrices,
            timeframe: state.timeframe,
            customFromTs,
            customToTs,
            crimeFilter: state.crimeFilter,
            manualLevelUpTs: state.manualLevelUpTs
        });

        renderHeroKPIs();
        renderRecommendations();
        renderCrimeEstimatorTable();
        if (state.activeTab === 'analytics') renderAnalyticsCharts();
        if (state.activeTab === 'level') renderLevelTab();
    };

    function renderHeroKPIs() {
        const { kpis, levelEstimate } = state.analytics;
        document.getElementById('kpi-nerve').textContent = Math.round(kpis.totalNerve).toLocaleString();
        document.getElementById('kpi-nerve-sub').textContent = `~${kpis.dailyNerveAvg} N/day (${kpis.dailyNerveSource})`;

        document.getElementById('kpi-attempts').textContent = kpis.totalAttempts.toLocaleString();
        document.getElementById('kpi-attempts-sub').textContent = `${kpis.totalSuccesses.toLocaleString()} S • ${kpis.totalFailures.toLocaleString()} F • ${kpis.totalCritFails.toLocaleString()} CF`;

        const ratesEl = document.getElementById('kpi-rates');
        if (kpis.totalAttempts > 0) {
            ratesEl.innerHTML = `<span style="color:#10b981;">${kpis.successRate.toFixed(1)}%</span> / <span style="color:#f59e0b;">${kpis.failRate.toFixed(1)}%</span> / <span style="color:#ef4444;">${kpis.critFailRate.toFixed(1)}%</span>`;
            const bar = document.getElementById('kpi-outcome-bar');
            bar.querySelector('.seg-s').style.width = `${kpis.successRate}%`;
            bar.querySelector('.seg-f').style.width = `${kpis.failRate}%`;
            bar.querySelector('.seg-cf').style.width = `${kpis.critFailRate}%`;
        } else {
            ratesEl.textContent = 'No logs';
        }

        document.getElementById('kpi-streak').textContent = `${kpis.crimeChain.toLocaleString()} Chain`;
        document.getElementById('kpi-streak-sub').textContent = `Streak: ${kpis.currentStreak} (Best: ${kpis.longestStreak}) • Max Chain: ${kpis.maxCrimeChain}`;

        const profEl = document.getElementById('kpi-profit');
        profEl.textContent = fmtMoney(kpis.totalNetProfit);
        profEl.style.color = kpis.totalNetProfit >= 0 ? '#10b981' : '#f87171';
        document.getElementById('kpi-profit-sub').textContent = `Avg ${fmtMoney(kpis.avgProfitPerNerve)} / Nerve`;

        document.getElementById('kpi-level-pct').textContent = `Lvl ${levelEstimate.currentLevel}→${levelEstimate.nextLevel}: ${levelEstimate.progressPct}%`;
        document.getElementById('kpi-level-sub').textContent = levelEstimate.isLevelHolding
            ? '🔒 Possible Level Holding detected'
            : `~${levelEstimate.leavesRemaining.toLocaleString()} Leaves or ~${levelEstimate.crimesRemaining.toLocaleString()} Crimes`;
    }

    function renderRecommendations() {
        const grid = document.getElementById('rec-cards-grid');
        if (!grid || !state.analytics) return;
        const picks = state.analytics.recommendations[state.recMode] || [];
        if (!picks.length) {
            grid.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);">All crimes maxed or no data synced yet.</div>';
            return;
        }
        grid.innerHTML = picks.map((c, idx) => {
            let metricHtml = '';
            if (state.recMode === 'fastest') {
                metricHtml = `<strong style="color:#34d399;">~${fmtDaysOrHrs(c.cs100Proj.daysRemaining)}</strong> to CS 100 (${c.cs100Proj.attemptsRemaining.toLocaleString()} att)`;
            } else if (state.recMode === 'profit') {
                metricHtml = `<strong style="color:#34d399;">${fmtMoney(c.profitPerNerve)}/N</strong> (${fmtMoney(c.netProfit)} net)`;
            } else {
                metricHtml = `<strong style="color:#38bdf8;">${c.critFailRate.toFixed(2)}% CF</strong> (${c.successRate.toFixed(1)}% success)`;
            }
            return `
                <div class="rec-card ${idx === 0 ? 'top-pick' : ''}" onclick="openCrimeDeepDive('${c.key}')">
                    <div style="min-width:0;">
                        <div style="font-weight:800;font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                            #${idx + 1} ${c.meta.icon} ${esc(c.meta.name)} <span style="font-size:11.5px;color:var(--text-tertiary);font-family:var(--font-mono);">CS ${c.currentSkill.toFixed(1)}</span>
                        </div>
                        <div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px;">${metricHtml}</div>
                    </div>
                    <span class="cr-badge ${idx === 0 ? 'green' : 'cyan'}">Inspect ↗</span>
                </div>
            `;
        }).join('');
    }

    function getTargetProjForRow(crimeStat) {
        const tgt = state.globalTarget === 'plus5'
            ? Math.min(100, Math.floor(crimeStat.currentSkill) + 5)
            : Number(state.globalTarget || 100);
        return window.FactionOSCrimesEngine.projectCrimeSkillRange(crimeStat, tgt, state.analytics.kpis.dailyNerveAvg);
    }

    function renderCrimeEstimatorTable() {
        const tbody = document.getElementById('crime-estimator-tbody');
        if (!tbody || !state.analytics) return;

        let rows = state.analytics.crimes.filter(c => state.crimeFilter === 'all' || c.key === state.crimeFilter);
        const enriched = rows.map(c => ({ c, targetProj: getTargetProjForRow(c) }));

        enriched.sort((a, b) => {
            const col = state.sortCol;
            let av, bv;
            if (col === 'name') { av = a.c.meta.name; bv = b.c.meta.name; }
            else if (col === 'nextAttempts') { av = a.c.nextLevelProj.attemptsRemaining; bv = b.c.nextLevelProj.attemptsRemaining; }
            else if (col === 'targetAttempts') { av = a.targetProj.attemptsRemaining; bv = b.targetProj.attemptsRemaining; }
            else if (col === 'confidence') {
                const map = { High: 3, Medium: 2, Low: 1 };
                av = map[a.c.confidence] || 0; bv = map[b.c.confidence] || 0;
            } else {
                av = a.c[col] ?? 0; bv = b.c[col] ?? 0;
            }
            if (typeof av === 'string') return state.sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            return state.sortAsc ? (av - bv) : (bv - av);
        });

        tbody.innerHTML = enriched.map(({ c, targetProj }) => {
            const maxed = c.currentSkill >= 100;
            const segCells = Array.from({ length: 10 }, (_, idx) => {
                const segStart = idx * 10;
                const fill = Math.max(0, Math.min(100, ((c.currentSkill - segStart) / 10) * 100));
                return `<div class="seg-cell"><div class="seg-cell-fill" style="width:${fill}%;"></div></div>`;
            }).join('');

            const confCls = c.confidence === 'High' ? 'green' : (c.confidence === 'Medium' ? 'cyan' : 'amber');
            const nextHtml = maxed
                ? '<span class="cr-badge green">MAX CS 100</span>'
                : `<div style="font-family:var(--font-mono);font-weight:800;">~${c.nextLevelProj.attemptsRemaining.toLocaleString()} att</div>
                   <div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);">${c.nextLevelProj.nerveRemaining.toLocaleString()}N → CS ${c.nextLevelProj.targetLevel}</div>`;

            const targetHtml = (maxed || targetProj.attemptsRemaining <= 0)
                ? '<span class="cr-badge green">Reached ✓</span>'
                : `<div style="font-family:var(--font-mono);font-weight:800;color:#38bdf8;">~${targetProj.attemptsRemaining.toLocaleString()} att</div>
                   <div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);">${targetProj.nerveRemaining.toLocaleString()}N • ~${fmtDaysOrHrs(targetProj.daysRemaining)}</div>`;

            return `<tr onclick="openCrimeDeepDive('${c.key}')">
                <td>
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                        <span style="font-weight:800;color:var(--text-primary);">${c.meta.icon} ${esc(c.meta.name)}</span>
                        <span style="font-family:var(--font-mono);font-weight:800;font-size:12px;color:${maxed ? '#34d399' : '#38bdf8'};">CS ${c.currentSkill.toFixed(1)}</span>
                    </div>
                    <div class="seg-bar ${maxed ? 'maxed' : ''}">${segCells}</div>
                </td>
                <td>
                    ${c.attempts > 0
                        ? `<div style="font-family:var(--font-mono);font-size:12px;">
                               <span style="color:#10b981;font-weight:700;">${c.successRate.toFixed(1)}%</span> /
                               <span style="color:#f59e0b;">${c.failRate.toFixed(1)}%</span> /
                               <span style="color:#ef4444;font-weight:700;">${c.critFailRate.toFixed(1)}%</span>
                           </div>
                           <div class="outcome-bar" style="width:110px;">
                               <div class="seg-s" style="width:${c.successRate}%;"></div>
                               <div class="seg-f" style="width:${c.failRate}%;"></div>
                               <div class="seg-cf" style="width:${c.critFailRate}%;"></div>
                           </div>`
                        : '<span style="font-size:11.5px;color:var(--text-tertiary);">No attempts in range</span>'}
                </td>
                <td style="font-family:var(--font-mono);">
                    <div style="font-weight:700;">~${c.recentAvgAttemptsPerLvl}</div>
                    <div style="font-size:11px;color:var(--text-tertiary);">${c.attempts.toLocaleString()} logged</div>
                </td>
                <td>${nextHtml}</td>
                <td>${targetHtml}</td>
                <td style="font-family:var(--font-mono);">
                    <div style="font-weight:800;color:${c.profitPerNerve >= 0 ? '#10b981' : '#f87171'};">${fmtMoney(c.profitPerNerve)}/N</div>
                    <div style="font-size:11px;color:var(--text-tertiary);">${fmtMoney(c.netProfit)} net</div>
                </td>
                <td>
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                        <span class="cr-badge ${confCls}" title="${esc(c.confidenceMath)}">${c.confidence} ⓘ</span>
                        <span style="color:var(--text-tertiary);font-size:12px;">▸</span>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Crime Deep-Dive Modal & Projection Charts ────────────────────────────
    window.openCrimeDeepDive = function (crimeKey, presetTarget = null) {
        if (!state.analytics) return;
        const crime = state.analytics.crimes.find(c => c.key === crimeKey);
        if (!crime) return;

        state.deepDiveCrimeKey = crimeKey;
        const minTarget = Math.min(100, Math.max(2, Math.floor(crime.currentSkill) + 1));
        const initTarget = presetTarget
            ? Math.max(minTarget, Math.min(100, Number(presetTarget)))
            : (state.globalTarget === 'plus5' ? Math.min(100, Math.floor(crime.currentSkill) + 5) : Math.max(minTarget, Number(state.globalTarget || 100)));
        state.deepDiveTarget = initTarget;

        const slider = document.getElementById('dd-target-slider');
        if (slider) {
            slider.min = String(minTarget);
            slider.max = '100';
            slider.value = String(initTarget);
        }

        document.getElementById('dd-icon').textContent = crime.meta.icon;
        document.getElementById('dd-title').textContent = `${crime.meta.name} — Skill Estimator & History`;
        document.getElementById('dd-subtitle').textContent = `Current CS ${crime.currentSkill.toFixed(2)} / 100 • ${crime.attempts.toLocaleString()} logged attempts • ${Math.round(crime.totalNerve).toLocaleString()} nerve spent`;

        const cb = document.getElementById('dd-conf-badge');
        cb.className = `cr-badge ${crime.confidence === 'High' ? 'green' : (crime.confidence === 'Medium' ? 'cyan' : 'amber')}`;
        cb.textContent = `${crime.confidence} Confidence`;
        cb.title = crime.confidenceMath;
        document.getElementById('dd-math-box').innerHTML = `<strong>📐 Model &amp; Confidence Math:</strong> ${esc(crime.confidenceMath)}`;

        document.getElementById('crime-deepdive-backdrop').classList.add('open');
        updateDeepDiveContent();
    };

    window.closeCrimeDeepDive = function () {
        document.getElementById('crime-deepdive-backdrop')?.classList.remove('open');
    };

    window.setDeepDiveTarget = function (val) {
        const crime = state.analytics?.crimes.find(c => c.key === state.deepDiveCrimeKey);
        if (!crime) return;
        let t = 100;
        if (val === 'plus1') t = Math.min(100, Math.floor(crime.currentSkill) + 1);
        else if (val === 'plus5') t = Math.min(100, Math.floor(crime.currentSkill) + 5);
        else t = Math.max(Math.min(100, Math.floor(crime.currentSkill) + 1), Math.min(100, Number(val)));
        state.deepDiveTarget = t;
        const sl = document.getElementById('dd-target-slider');
        if (sl) sl.value = String(t);
        updateDeepDiveContent();
    };

    window.onDeepDiveSliderChange = function (val) {
        state.deepDiveTarget = Math.max(2, Math.min(100, parseInt(val, 10) || 100));
        updateDeepDiveContent();
    };

    window.setDeepDiveXAxis = function (axis) {
        state.deepDiveXAxis = axis;
        document.getElementById('dd-x-nerve')?.classList.toggle('active', axis === 'nerve');
        document.getElementById('dd-x-att')?.classList.toggle('active', axis === 'attempts');
        updateDeepDiveContent();
    };

    function updateDeepDiveContent() {
        const crime = state.analytics?.crimes.find(c => c.key === state.deepDiveCrimeKey);
        if (!crime) return;
        const dailyNerve = state.analytics.kpis.dailyNerveAvg;
        const proj = window.FactionOSCrimesEngine.projectCrimeSkillRange(crime, state.deepDiveTarget, dailyNerve);

        document.getElementById('dd-target-val').textContent = `CS ${proj.targetLevel}`;
        document.getElementById('dd-est-attempts').textContent = proj.attemptsRemaining.toLocaleString();
        document.getElementById('dd-est-next-sub').textContent = `Next CS (${crime.nextLevelProj.targetLevel}): ~${crime.nextLevelProj.attemptsRemaining.toLocaleString()} att`;
        document.getElementById('dd-est-nerve').textContent = `${proj.nerveRemaining.toLocaleString()} N`;
        document.getElementById('dd-avg-nerve-sub').textContent = `Avg ${crime.avgNervePerAttempt.toFixed(2)} N / attempt`;
        document.getElementById('dd-est-time').textContent = fmtDaysOrHrs(proj.daysRemaining);
        document.getElementById('dd-daily-pace-sub').textContent = `At ~${dailyNerve} N/day`;
        document.getElementById('dd-cf-cost').textContent = `+${crime.critRecoveryExtraAttempts} att / CF`;
        document.getElementById('dd-cf-lost-sub').textContent = `${crime.critFails} crit fails (~${crime.critSkillLost.toFixed(1)} CS lost)`;

        if (typeof window.Chart !== 'function') return;

        // 1. Forecast Line Chart (Solid History + Dashed Forecast + Red Crit-Fail Markers)
        const xKey = state.deepDiveXAxis === 'attempts' ? 'attempts' : 'nerve';
        const histPts = crime.historyPoints.map(p => ({ x: p[xKey], y: p.cs }));
        const projPts = proj.forecastPoints.map(p => ({ x: p[xKey], y: p.cs }));
        const cfPts = crime.critFailPoints.map(p => ({ x: p[xKey], y: p.cs }));

        if (state.charts.ddForecast) state.charts.ddForecast.destroy();
        const fCanvas = document.getElementById('chart-dd-forecast');
        state.charts.ddForecast = new Chart(fCanvas.getContext('2d'), {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Historical CS',
                        data: histPts,
                        showLine: true,
                        borderColor: '#38bdf8',
                        backgroundColor: 'rgba(56,189,248,0.18)',
                        borderWidth: 2.5,
                        pointRadius: 2.5,
                        tension: 0.25
                    },
                    {
                        label: `Projected to CS ${proj.targetLevel}`,
                        data: projPts,
                        showLine: true,
                        borderColor: '#10b981',
                        borderDash: [6, 5],
                        borderWidth: 2.2,
                        pointRadius: 3,
                        tension: 0.25
                    },
                    {
                        label: 'Critical Failures',
                        data: cfPts,
                        showLine: false,
                        backgroundColor: '#ef4444',
                        borderColor: '#ffffff',
                        borderWidth: 1,
                        pointRadius: 5,
                        pointStyle: 'triangle'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } } },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: xKey === 'nerve' ? 'Cumulative Nerve' : 'Cumulative Attempts', color: '#94a3b8' },
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(148,163,184,0.12)' }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        title: { display: true, text: 'Crime Skill (1–100)', color: '#94a3b8' },
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(148,163,184,0.12)' }
                    }
                }
            }
        });

        // 2. Attempts-per-Level Histogram
        if (state.charts.ddHistogram) state.charts.ddHistogram.destroy();
        const hCanvas = document.getElementById('chart-dd-histogram');
        const trans = crime.transitions.slice(-24);
        state.charts.ddHistogram = new Chart(hCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: trans.length ? trans.map(t => `CS ${t.toLvl}`) : ['No Transitions'],
                datasets: [{
                    label: 'Attempts Taken',
                    data: trans.length ? trans.map(t => t.attempts) : [0],
                    backgroundColor: trans.length ? trans.map(t => t.critFailsInSpan > 0 ? 'rgba(239,68,68,0.78)' : 'rgba(56,189,248,0.75)') : ['#475569'],
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            afterLabel: (ctx) => {
                                const tr = trans[ctx.dataIndex];
                                if (!tr) return '';
                                return `${tr.nerve} nerve${tr.critFailsInSpan ? ` • ⚠️ ${tr.critFailsInSpan} crit fail(s)` : ''}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
                    y: { title: { display: true, text: 'Attempts', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.12)' } }
                }
            }
        });
    }

    // ── Sub-Tab 2: Visual Analytics & Profit Charts ──────────────────────────
    function renderAnalyticsCharts() {
        if (!state.analytics) return;
        renderOutcomeChart();
        renderProfitChart();
        renderTimelineChart();
        renderMeritsAndUniques();
    }

    function renderOutcomeChart() {
        if (typeof window.Chart !== 'function') return;
        const list = state.analytics.crimes.filter(c => c.attempts > 0);
        const canvas = document.getElementById('chart-outcomes');
        if (!canvas) return;
        if (state.charts.outcomes) state.charts.outcomes.destroy();

        state.charts.outcomes = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: list.map(c => c.meta.name),
                datasets: [
                    { label: 'Success %', data: list.map(c => Number(c.successRate.toFixed(1))), backgroundColor: '#10b981' },
                    { label: 'Failure %', data: list.map(c => Number(c.failRate.toFixed(1))), backgroundColor: '#f59e0b' },
                    { label: 'Crit Fail %', data: list.map(c => Number(c.critFailRate.toFixed(1))), backgroundColor: '#ef4444' }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, max: 100, ticks: { color: '#94a3b8', callback: v => `${v}%` }, grid: { color: 'rgba(148,163,184,0.12)' } },
                    y: { stacked: true, ticks: { color: '#cbd5e1', font: { size: 11 } }, grid: { display: false } }
                },
                plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12 } } }
            }
        });
    }

    function renderProfitChart() {
        if (typeof window.Chart !== 'function') return;
        const list = state.analytics.crimes.filter(c => c.attempts > 0)
            .sort((a, b) => state.profitChartMode === 'per_nerve' ? (b.profitPerNerve - a.profitPerNerve) : (b.netProfit - a.netProfit));
        const canvas = document.getElementById('chart-profit');
        if (!canvas) return;
        if (state.charts.profit) state.charts.profit.destroy();

        const isPerNerve = state.profitChartMode === 'per_nerve';
        state.charts.profit = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: list.map(c => c.meta.name),
                datasets: [{
                    label: isPerNerve ? '$/Nerve' : 'Total Net Profit ($)',
                    data: list.map(c => Math.round(isPerNerve ? c.profitPerNerve : c.netProfit)),
                    backgroundColor: list.map(c => (isPerNerve ? c.profitPerNerve : c.netProfit) >= 0 ? 'rgba(56,189,248,0.82)' : 'rgba(239,68,68,0.8)'),
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
                    y: { ticks: { color: '#94a3b8', callback: v => fmtMoney(v) }, grid: { color: 'rgba(148,163,184,0.12)' } }
                }
            }
        });
    }

    function renderTimelineChart() {
        if (typeof window.Chart !== 'function') return;
        const days = state.analytics.dailyTimeline;
        const spanEl = document.getElementById('timeline-span-badge');
        if (spanEl) spanEl.textContent = `${days.length} active days`;

        const canvas = document.getElementById('chart-timeline');
        if (!canvas) return;
        if (state.charts.timeline) state.charts.timeline.destroy();

        state.charts.timeline = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: days.map(d => d.date.slice(5)),
                datasets: [
                    {
                        type: 'bar',
                        label: 'Daily Nerve Spent',
                        data: days.map(d => d.nerve),
                        backgroundColor: 'rgba(56, 189, 248, 0.55)',
                        borderColor: '#38bdf8',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        type: 'line',
                        label: 'Critical Failures',
                        data: days.map(d => d.critFails),
                        borderColor: '#ef4444',
                        backgroundColor: '#ef4444',
                        pointRadius: days.map(d => d.critFails > 0 ? 4.5 : 0),
                        borderWidth: 1.5,
                        tension: 0.2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12 } } },
                scales: {
                    x: { ticks: { color: '#94a3b8', maxTicksLimit: 16 }, grid: { display: false } },
                    y: { position: 'left', title: { display: true, text: 'Nerve', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.1)' } },
                    y1: { position: 'right', beginAtZero: true, title: { display: true, text: 'Crit Fails', color: '#f87171' }, ticks: { color: '#f87171', stepSize: 1 }, grid: { display: false } }
                }
            }
        });
    }

    function renderMeritsAndUniques() {
        const mGrid = document.getElementById('merit-tracker-grid');
        if (mGrid) {
            mGrid.innerHTML = state.analytics.merits.map(m => `
                <div class="merit-item ${m.completed ? 'done' : ''}">
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;font-weight:800;">
                        <span>${esc(m.label)}</span>
                        <span class="cr-badge ${m.completed ? 'green' : 'cyan'}">${m.pct.toFixed(1)}%</span>
                    </div>
                    <div class="merit-track"><div class="merit-fill" style="width:${m.pct}%;"></div></div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);">
                        <span>${m.count.toLocaleString()} / 10,000</span>
                        <span>${m.completed ? 'Merit Earned ✓' : `${m.remaining.toLocaleString()} left`}</span>
                    </div>
                </div>
            `).join('');
        }

        const uGrid = document.getElementById('uniques-list-grid');
        const allUniques = [];
        for (const c of state.analytics.crimes) {
            for (const u of c.uniquesList) {
                allUniques.push({ icon: c.meta.icon, crime: c.meta.name, label: u });
            }
        }
        const ub = document.getElementById('uniques-total-badge');
        if (ub) ub.textContent = `${allUniques.length} Logged`;
        if (uGrid) {
            uGrid.innerHTML = allUniques.length
                ? allUniques.map(u => `
                    <div class="unique-chip">
                        <div style="font-weight:800;color:var(--text-primary);">${u.icon} ${esc(u.crime)}</div>
                        <div style="color:#c084fc;">✨ ${esc(u.label)}</div>
                    </div>`).join('')
                : '<div style="font-size:12px;color:var(--text-tertiary);">No unique outcome entries detected in the current timeframe/cache.</div>';
        }
    }

    // ── Sub-Tab 3: Regular In-Game Level Estimator ───────────────────────────
    function renderLevelTab() {
        const lvl = state.analytics?.levelEstimate;
        if (!lvl) return;

        // Radial Gauge SVG (circumference = 2 * pi * 74 ≈ 465)
        const circ = 465;
        const offset = circ * (1 - Math.max(0, Math.min(100, lvl.progressPct)) / 100);
        const arc = document.getElementById('lvl-gauge-arc');
        if (arc) arc.setAttribute('stroke-dashoffset', String(offset.toFixed(1)));
        document.getElementById('lvl-gauge-label').textContent = lvl.currentLevel >= 100 ? 'MAX LEVEL 100' : `LVL ${lvl.currentLevel} → ${lvl.nextLevel}`;
        document.getElementById('lvl-gauge-pct').textContent = `${lvl.progressPct}%`;
        document.getElementById('lvl-gauge-eta').textContent = lvl.currentLevel >= 100 ? 'Maxed ✓' : `Est. ~${fmtDaysOrHrs(lvl.estDaysToLevel)}`;

        document.getElementById('lvl-hof-badge').textContent = lvl.hofNote;
        document.getElementById('lvl-start-source').textContent = lvl.startSource;
        document.getElementById('lvl-calibration-note').textContent = lvl.calibrationMethod;

        const holdEl = document.getElementById('lvl-holding-banner');
        if (holdEl) {
            if (lvl.isLevelHolding) {
                holdEl.style.display = 'block';
                holdEl.innerHTML = `<strong>🔒 Level Holding Flag:</strong> ${esc(lvl.levelHoldingReason)}`;
            } else {
                holdEl.style.display = 'none';
            }
        }

        // Breakdown Donut
        const bd = lvl.breakdown;
        const xpTotal = Math.max(0.1, bd.xpAttacks + bd.xpCrimes + bd.xpGym);
        document.getElementById('xp-breakdown-list').innerHTML = `
            <div>⚔️ <strong>Attacks Won:</strong> ${bd.attacksTotal.toLocaleString()} <span style="color:var(--text-tertiary);">(${bd.leaves} Leaves · ${bd.mugs} Mugs · ${bd.hosps} Hosps)</span> — <strong style="color:#38bdf8;">${((bd.xpAttacks / xpTotal) * 100).toFixed(0)}% XP</strong></div>
            <div>🕵️ <strong>Successful Crimes:</strong> ${bd.crimesSuccess.toLocaleString()} — <strong style="color:#10b981;">${((bd.xpCrimes / xpTotal) * 100).toFixed(0)}% XP</strong></div>
            <div>🏋️ <strong>Gym Activity:</strong> ${bd.gymTrains.toLocaleString()} sessions (${bd.gymEnergy.toLocaleString()}E) — <strong style="color:#c084fc;">${((bd.xpGym / xpTotal) * 100).toFixed(0)}% XP</strong></div>
            <div style="border-top:1px solid var(--border-subtle);padding-top:6px;font-family:var(--font-mono);font-size:12px;">
                Est. XP Since Last Level-Up: <strong>${lvl.xpAccumulated.toLocaleString()}</strong> / <strong>${lvl.estimatedThresholdXP.toLocaleString()}</strong> Leave-equiv
            </div>
        `;

        if (typeof window.Chart === 'function') {
            if (state.charts.xpDonut) state.charts.xpDonut.destroy();
            const dCanvas = document.getElementById('chart-xp-donut');
            state.charts.xpDonut = new Chart(dCanvas.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Attacks (Leaves/Mugs/Hosps)', 'Crimes', 'Gym Training'],
                    datasets: [{
                        data: [bd.xpAttacks || 1, bd.xpCrimes || 0, bd.xpGym || 0],
                        backgroundColor: ['#38bdf8', '#10b981', '#c084fc'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '64%',
                    plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 10, font: { size: 11 } } } }
                }
            });
        }

        // Remaining Effort Cards
        document.getElementById('lvl-remaining-cards').innerHTML = `
            <div class="path-card">
                <div class="kpi-lbl">Pure Leave Attacks</div>
                <div style="font-size:1.25em;font-weight:900;font-family:var(--font-mono);color:#38bdf8;">~${lvl.leavesRemaining.toLocaleString()} Leaves</div>
                <div style="font-size:11px;color:var(--text-secondary);">On similar-level targets (100% XP)</div>
            </div>
            <div class="path-card">
                <div class="kpi-lbl">OR Pure Crimes</div>
                <div style="font-size:1.25em;font-weight:900;font-family:var(--font-mono);color:#10b981;">~${lvl.crimesRemaining.toLocaleString()} Crimes</div>
                <div style="font-size:11px;color:var(--text-secondary);">Mid-tier Crimes 2.0 successes</div>
            </div>
            <div class="path-card">
                <div class="kpi-lbl">OR Mugs / Hospitalizes</div>
                <div style="font-size:1.1em;font-weight:800;font-family:var(--font-mono);color:#fbbf24;">~${lvl.mugsRemaining.toLocaleString()} M / ~${lvl.hospsRemaining.toLocaleString()} H</div>
                <div style="font-size:11px;color:var(--text-secondary);">Mugs ~57% XP • Hosps ~40% XP</div>
            </div>
        `;

        // Sync Planner Sliders with observed user pace
        const dlSlider = document.getElementById('slider-daily-leaves');
        const dnSlider = document.getElementById('slider-daily-nerve');
        if (dlSlider && !dlSlider.dataset.userTouched) dlSlider.value = String(Math.min(40, Math.round(lvl.defaultDailyLeaves)));
        if (dnSlider && !dnSlider.dataset.userTouched) dnSlider.value = String(Math.min(600, Math.round(lvl.defaultDailyNerve / 10) * 10));
        updateLevelPlannerUI(false);

        // Historical Level-Up Log Table
        const hCount = document.getElementById('lvl-history-count');
        const hTbody = document.getElementById('lvl-history-tbody');
        const intervals = lvl.historicalIntervals || [];
        const allLvls = lvl.levelUpHistory || [];
        if (hCount) hCount.textContent = `${allLvls.length} Logged`;

        if (hTbody) {
            if (intervals.length > 0) {
                hTbody.innerHTML = intervals.map(iv => `
                    <tr>
                        <td><strong>Level ${iv.toLevel}</strong> <span style="font-size:11px;color:var(--text-tertiary);">(from ${iv.fromLevel})</span></td>
                        <td style="font-family:var(--font-mono);">${new Date(iv.endTs * 1000).toISOString().slice(0, 10)}</td>
                        <td style="font-family:var(--font-mono);">${iv.daysSpent.toFixed(1)}d</td>
                        <td style="font-family:var(--font-mono);">${iv.attacksTotal} <span style="color:var(--text-tertiary);">(${iv.leaves}L / ${iv.mugs}M / ${iv.hosps}H)</span></td>
                        <td style="font-family:var(--font-mono);">${iv.crimesSuccess.toLocaleString()}</td>
                        <td style="font-family:var(--font-mono);color:#38bdf8;font-weight:700;">~${Math.round(iv.xpTotal).toLocaleString()} XP</td>
                    </tr>
                `).join('');
            } else if (allLvls.length > 0) {
                hTbody.innerHTML = allLvls.map(lu => `
                    <tr>
                        <td><strong>Level ${lu.levelReached || '—'}</strong></td>
                        <td style="font-family:var(--font-mono);">${new Date(lu.timestamp * 1000).toISOString().slice(0, 10)}</td>
                        <td colspan="4" style="color:var(--text-tertiary);">Baseline milestone (backfill 1+ earlier level-up to calibrate personal XP interval)</td>
                    </tr>
                `).join('');
            } else {
                hTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:22px;color:var(--text-tertiary);">No <code>Level up</code> entries in local log cache yet. Sync Full Access logs, backfill history, or set a Manual Last Level-Up Date above.</td></tr>`;
            }
        }
    }

    window.updateLevelPlannerUI = function (fromUser = false) {
        const lvl = state.analytics?.levelEstimate;
        if (!lvl) return;
        const mixPct = Number(document.getElementById('slider-xp-mix')?.value || 65);
        const dailyLeaves = Number(document.getElementById('slider-daily-leaves')?.value || 6);
        const dailyNerve = Number(document.getElementById('slider-daily-nerve')?.value || 180);

        if (fromUser) {
            const dlEl = document.getElementById('slider-daily-leaves');
            const dnEl = document.getElementById('slider-daily-nerve');
            if (dlEl) dlEl.dataset.userTouched = '1';
            if (dnEl) dnEl.dataset.userTouched = '1';
        }

        document.getElementById('mix-label').textContent = `${mixPct}% Attacks / ${100 - mixPct}% Crimes`;
        document.getElementById('daily-leaves-val').textContent = `${dailyLeaves} / day`;
        document.getElementById('daily-nerve-val').textContent = `${dailyNerve} N / day`;

        const atkPortionXP = lvl.xpRemaining * (mixPct / 100);
        const crimePortionXP = lvl.xpRemaining * ((100 - mixPct) / 100);
        const mixLeaves = Math.ceil(atkPortionXP);
        const mixCrimes = Math.ceil(crimePortionXP / (lvl.avgCrimeXP || 0.189));
        document.getElementById('mix-output').innerHTML = `At this mix: <strong>~${mixLeaves.toLocaleString()} Leave attacks</strong> + <strong>~${mixCrimes.toLocaleString()} crimes</strong> remaining.`;

        const dailyXP = dailyLeaves * 1.0 + dailyNerve * 0.042;
        const etaEl = document.getElementById('planner-eta-date');
        if (lvl.xpRemaining <= 0) {
            etaEl.textContent = 'Projected Date: Ready to Upgrade Now!';
        } else if (dailyXP <= 0) {
            etaEl.textContent = 'Projected Date: Set daily attacks or nerve > 0';
        } else {
            const days = lvl.xpRemaining / dailyXP;
            const projDate = new Date(Date.now() + days * 86400000);
            etaEl.textContent = `Projected Lvl ${lvl.nextLevel}: ${projDate.toLocaleDateString()} (~${fmtDaysOrHrs(days)})`;
        }
    };

    window.onManualLevelUpDateChange = async function () {
        const val = document.getElementById('manual-levelup-date')?.value;
        state.manualLevelUpTs = val ? Math.floor(Date.parse(val + 'T00:00:00Z') / 1000) : null;
        if (state.userId && !state.demoMode && state.meta) {
            state.meta.manualLevelUpTs = state.manualLevelUpTs;
            await window.FactionOSCrimesDB.saveUserMeta(state.meta).catch(() => {});
        }
        recomputeAndRender();
    };

    window.clearManualLevelUpDate = async function () {
        const inp = document.getElementById('manual-levelup-date');
        if (inp) inp.value = '';
        state.manualLevelUpTs = null;
        if (state.userId && !state.demoMode && state.meta) {
            state.meta.manualLevelUpTs = null;
            await window.FactionOSCrimesDB.saveUserMeta(state.meta).catch(() => {});
        }
        recomputeAndRender();
    };

    // ── Discord Share Card & CSV/JSON Exports ────────────────────────────────
    window.copyDiscordSummary = async function () {
        if (!state.analytics) return;
        const md = window.FactionOSCrimesEngine.buildDiscordMarkdownSummary(state.analytics, state.snapshot);
        try {
            await navigator.clipboard.writeText(md);
            showToast('✅ Copied Discord-ready Crime & Level summary!');
        } catch (_) {
            const ta = document.createElement('textarea');
            ta.value = md;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            showToast('✅ Copied Discord-ready Crime & Level summary!');
        }
    };

    window.exportCrimeData = function (format) {
        if (!state.analytics) return;
        let content = '';
        let mime = 'text/plain';
        let filename = `factionos_crimes_${new Date().toISOString().slice(0, 10)}`;

        if (format === 'csv') {
            content = window.FactionOSCrimesEngine.buildCsvExport(state.analytics);
            mime = 'text/csv;charset=utf-8';
            filename += '.csv';
        } else {
            const exportObj = {
                exportedAt: new Date().toISOString(),
                player: state.snapshot?.name || 'Operative',
                timeframe: state.timeframe,
                kpis: state.analytics.kpis,
                levelEstimate: state.analytics.levelEstimate,
                crimes: state.analytics.crimes.map(c => ({
                    key: c.key,
                    name: c.meta.name,
                    currentSkill: c.currentSkill,
                    attempts: c.attempts,
                    successes: c.successes,
                    failures: c.failures,
                    critFails: c.critFails,
                    totalNerve: c.totalNerve,
                    netProfit: c.netProfit,
                    profitPerNerve: c.profitPerNerve,
                    confidence: c.confidence,
                    transitions: c.transitions,
                    nextLevelProj: c.nextLevelProj,
                    cs100Proj: c.cs100Proj
                }))
            };
            content = JSON.stringify(exportObj, null, 2);
            mime = 'application/json;charset=utf-8';
            filename += '.json';
        }

        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(`📥 Exported ${filename}`);
    };

    // ── F.R.I.D.A.Y. Site Co-Pilot Direct Command Hook ───────────────────────
    window.applyFridayCrimesCommand = function (action) {
        if (!action) return;
        if (!state.analytics) {
            state.pendingFridayAction = action;
            return;
        }
        if (action.demo && !state.demoMode) toggleDemoMode(true, true);
        if (action.tab) switchCrimeTab(action.tab);
        if (action.recommendMode) setRecMode(action.recommendMode);
        if (action.timeframe) setTimeframe(action.timeframe);
        if (action.crime) {
            const raw = String(action.crime).toLowerCase().replace(/[\s-]+/g, '_');
            const found = window.FactionOSCrimesEngine.CRIMES_CATALOG.find(
                c => c.key === raw || c.name.toLowerCase().includes(String(action.crime).toLowerCase())
            );
            if (found) {
                switchCrimeTab('overview');
                setTimeout(() => openCrimeDeepDive(found.key, action.targetSkill || null), 120);
            }
        }
    };
})();
