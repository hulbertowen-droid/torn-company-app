/* ═══════════════════════════════════════════════════════════════════════════
   FactionOS — Torn City OC 2.0 Command Center Engine (Refactored 4 Workspaces)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ─── Persistent State & Preferences ───
    const STORAGE_CACHE_KEY = 'sv_cache_oc_cmd_v3';
    const STORAGE_ROLE_CPR_CACHE_KEY = 'faction_role_cpr_cache';
    const STORAGE_FLOORS_KEY = 'sv_oc_cpr_floors_v1';
    const STORAGE_VAULT_KEY = 'sv_oc_vault_cut_v1';
    const STORAGE_PAYOUT_MODE_KEY = 'sv_oc_payout_mode_v1';
    const STORAGE_GANTT_HOURS_KEY = 'sv_oc_gantt_hours_v1';
    const STORAGE_PAID_IDS_KEY = 'sv_oc_paid_ids_v1';
    const STORAGE_STAGED_KEY = 'sv_oc_staged_assignments_v1';
    const REFRESH_MS = 300000;

    const CLOSE_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const CORE_ROLE_COLUMNS = ['Techie', 'Hacker', 'Negotiator', 'Imitator', 'Muscle', 'Driver', 'Car Thief', 'Picklock', 'Bomber', 'Lookout', 'Looter', 'Enforcer'];

    let cmdData = {
        factionId: '',
        factionName: 'Faction',
        crimes: [],
        completedCrimes: [],
        members: {},
        armoryStock: {},
        warState: { activeWar: null, nextScheduledWar: null, chain: null },
        catalog: [],
        cprOverrides: {},
        factionRoleCprCache: {},
        payoutStatus: {},
        ocMemberHistory: {}
    };

    let analytics = {
        activeAnnotated: [],
        bench: { all: [], available: [], blocked: [], inactive: [] },
        memberProfiles: [],
        memberProfileMap: new Map(),
        memberRoleHistory: new Map(),
        allRoleColumns: [...CORE_ROLE_COLUMNS],
        openSlotMatches: [],
        queuePlan: { overSpawned: false, openSlots: 0, availBench: 0, deficit: 0, fillNow: [], pauseRecs: [], autoFillPairs: [] },
        missingGearList: [],
        postMortems: [],
        warConflictsCount: 0,
        kpis: {}
    };

    let currentView = 'board';       // board | workbench | payouts | intel
    let currentBoardTab = 'all';     // all | recruiting | planning | ready | blocked
    let safePreWarOnly = false;
    let ganttWindowHours = Number(localStorage.getItem(STORAGE_GANTT_HOURS_KEY) || 24);
    let ganttCollapsed = localStorage.getItem('sv_oc_gantt_collapsed') === 'true';
    let benchBucket = 'all';         // all | available | blocked | inactive

    let stagedAssignments = (() => {
        try {
            const arr = JSON.parse(localStorage.getItem(STORAGE_STAGED_KEY) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (_) { return []; }
    })();

    let localPaidOverrides = (() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_PAID_IDS_KEY) || '{}') || {}; }
        catch (_) { return {}; }
    })();

    let localRoleCprCache = (() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_ROLE_CPR_CACHE_KEY) || '{}') || {}; }
        catch (_) { return {}; }
    })();

    let batchState = {
        filter: 'auto',              // auto -> unpaid if any unpaid else all
        userSelectedFilter: false,
        selectedIds: new Set()
    };

    let payoutState = {
        selectedCrimeKey: '',
        cash: 0,
        itemsVal: 0,
        includeItems: true,
        vaultPct: Number(localStorage.getItem(STORAGE_VAULT_KEY) ?? 10),
        mode: localStorage.getItem(STORAGE_PAYOUT_MODE_KEY) || 'equal',
        reimburseEnabled: {},
        rows: []
    };

    let roiState = { avgCpr: 78, sortCol: 'evPerMemberDay', sortAsc: false };
    let simState = { selectedKey: '', crimeName: '', difficulty: 4, planningDays: 5, estCash: 10000000, estRespect: 100, slots: [], baselinePct: null };
    let lbState = { sortCol: 'grossCash', sortAsc: false };
    let heatmapState = { sortRole: 'Techie', sortAsc: false };
    let econDays = 30;
    let broadcastTab = 'discord';
    let broadcastCrimeId = null;

    let cprFloors = (() => {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_FLOORS_KEY) || '{}');
            return { low: Number(raw.low || 70), high: Number(raw.high || 65) };
        } catch (_) { return { low: 70, high: 65 }; }
    })();

    const openCrimeIds = new Set();
    let isFetchingOCs = false;
    let refreshTimer = null;
    let progressTimer = null;
    let liveTickTimer = null;

    // ─── Formatting & Security Utilities ───
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeCrimeName(name) {
        return String(name || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
    }

    function normalizeRoleName(role) {
        return String(role || '').replace(/\s*#\d+$/g, '').trim();
    }

    function fmt(n) {
        if (n === null || n === undefined || Number.isNaN(Number(n))) return '0';
        return Math.round(Number(n)).toLocaleString('en-US');
    }

    function fmtMoney(n) {
        return '$' + fmt(n || 0);
    }

    function fmtCompactMoney(n) {
        const v = Number(n || 0);
        if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
        if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
        if (Math.abs(v) >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
        return '$' + Math.round(v);
    }

    function formatCountdown(seconds) {
        const s = Math.max(0, Math.floor(seconds || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
    }

    function formatDurationShort(seconds) {
        const s = Math.max(0, Math.floor(seconds || 0));
        if (s < 60) return `${s}s`;
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
        return `${m}m ${String(sec).padStart(2, '0')}s`;
    }

    function formatRelativeSec(unixSec, nowSec = Math.floor(Date.now() / 1000)) {
        if (!unixSec) return 'Unknown';
        const diff = Math.max(0, nowSec - Number(unixSec));
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    function formatTctClock(unixSec) {
        return new Date(Number(unixSec) * 1000).toISOString().slice(11, 16) + ' TCT';
    }

    function formatTctDate(unixSec) {
        return new Date(Number(unixSec) * 1000).toISOString().slice(0, 10);
    }

    function formatLocalShort(unixSec) {
        try {
            return new Date(Number(unixSec) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (_) { return ''; }
    }

    function sanitizeCSVCell(val) {
        if (val === null || val === undefined) return '""';
        let s = String(val).trim();
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return `"${s.replace(/"/g, '""')}"`;
    }

    function debounce(fn, wait = 150) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    function showOcToast(msg) {
        const wrap = document.getElementById('oc-toast-container');
        if (!wrap) return;
        const div = document.createElement('div');
        div.className = 'oc-toast';
        div.textContent = msg;
        wrap.appendChild(div);
        setTimeout(() => div.remove(), 3600);
    }

    function copyText(text, successMsg) {
        if (!navigator.clipboard) {
            showOcToast('Clipboard unavailable in browser context');
            return;
        }
        navigator.clipboard.writeText(text)
            .then(() => showOcToast(successMsg || '✅ Copied to clipboard!'))
            .catch(() => showOcToast('⚠️ Clipboard write blocked by browser'));
    }

    function getCrimeEmoji(name) {
        const n = normalizeCrimeName(name);
        if (n.includes('stage') || n.includes('heist') || n.includes('bank') || n.includes('deck')) return '🎭';
        if (n.includes('market') || n.includes('cash') || n.includes('ace')) return '💹';
        if (n.includes('car') || n.includes('lot') || n.includes('wing') || n.includes('reserve')) return '🚗';
        if (n.includes('lotus') || n.includes('honey')) return '🌸';
        if (n.includes('smoke') || n.includes('gas') || n.includes('blind')) return '💨';
        if (n.includes('first aid') || n.includes('clinical')) return '🏥';
        if (n.includes('pet')) return '🐾';
        if (n.includes('blast') || n.includes('dish')) return '💣';
        if (n.includes('trace') || n.includes('git')) return '💻';
        return '🎯';
    }

    function getMinSafeFloor(difficulty) {
        return Number(difficulty || 1) >= 5 ? cprFloors.high : cprFloors.low;
    }

    function getCprBadgeClass(rate, floor = 70) {
        const r = Number(rate || 0);
        if (r >= 80) return 'cpr-opt';
        if (r >= Math.min(70, floor)) return 'cpr-safe';
        if (r >= 60) return 'cpr-warn';
        return 'cpr-risk';
    }

    // ─── PART 1: STRICT 4-PRIORITY PER-ROLE CPR RESOLVER ───
    /**
     * Resolve exact CPR for a member in a specific role (never cross-role averages for known roles).
     * Priority 1: Exact Live Slotted CPR on current active OCs
     * Priority 2: Cached Multi-User API Key / TornStats Role CPR (faction_role_cpr_cache / overrides)
     * Priority 3: Role-Specific Historical CPR from 300 Completed OCs (by [playerId][roleName])
     * Priority 4: Fallback estimate explicitly labeled "Est. — Never Played <Role>"
     */
    function getMemberRoleCPR(playerId, roleName, crimeTier = 2, liveSlotData = null, crimeName = '') {
        const pKey = String(playerId || '').trim();
        const role = normalizeRoleName(roleName);
        if (!pKey || !role) {
            return { cpr: 60, source: 'est', isEstimated: true, tag: 'Est.', dropdownLabel: '~60% Est.' };
        }

        // Priority 1: Exact Live Slotted CPR
        const candidateCrimes = Array.isArray(liveSlotData)
            ? [{ name: crimeName, difficulty: crimeTier, slots: liveSlotData }]
            : (analytics.activeAnnotated.length ? analytics.activeAnnotated : (cmdData.crimes || []));

        let fallbackLiveMatch = null;
        for (const c of candidateCrimes) {
            for (const s of (c.slots || [])) {
                const sRole = normalizeRoleName(s.position || s.position_info?.label);
                if (s.user && String(s.user.id) === pKey && sRole.toLowerCase() === role.toLowerCase()) {
                    const cprVal = Number(s.checkpoint_pass_rate || 0);
                    if (cprVal > 0) {
                        const isSameCrime = !crimeName || normalizeCrimeName(c.name) === normalizeCrimeName(crimeName);
                        if (isSameCrime) {
                            return {
                                cpr: cprVal,
                                source: 'live',
                                isEstimated: false,
                                tag: '[Exact]',
                                sourceNote: 'Live Slotted CPR',
                                dropdownLabel: `${cprVal}% ${role} [Exact]`
                            };
                        }
                        if (!fallbackLiveMatch) fallbackLiveMatch = cprVal;
                    }
                }
            }
        }
        if (fallbackLiveMatch !== null) {
            return {
                cpr: fallbackLiveMatch,
                source: 'live',
                isEstimated: false,
                tag: '[Exact]',
                sourceNote: 'Live Slotted CPR',
                dropdownLabel: `${fallbackLiveMatch}% ${role} [Exact]`
            };
        }

        // Priority 2: Cached Multi-User API Key / TornStats / Manual Overrides
        const serverOverrides = (cmdData.cprOverrides || {})[pKey] || {};
        const serverRoleCache = (cmdData.factionRoleCprCache || {})[pKey] || {};
        const clientRoleCache = localRoleCprCache[pKey] || {};

        const specKey = crimeName ? `${crimeName}::${role}` : '';
        let cachedVal = null;
        if (specKey && typeof serverOverrides[specKey] === 'number') cachedVal = serverOverrides[specKey];
        else if (typeof serverOverrides[role] === 'number') cachedVal = serverOverrides[role];
        else if (serverRoleCache[role]?.cpr) cachedVal = Number(serverRoleCache[role].cpr);
        else if (clientRoleCache[role]?.cpr) cachedVal = Number(clientRoleCache[role].cpr);
        else {
            // Case-insensitive lookup in Priority 2 stores
            const roleLower = role.toLowerCase();
            for (const [k, v] of Object.entries(serverOverrides)) {
                if (k.toLowerCase() === roleLower && typeof v === 'number') { cachedVal = v; break; }
            }
            if (cachedVal === null) {
                for (const [k, v] of Object.entries(serverRoleCache)) {
                    if (k.toLowerCase() === roleLower && v?.cpr) { cachedVal = Number(v.cpr); break; }
                }
            }
        }
        if (cachedVal !== null && !Number.isNaN(cachedVal) && cachedVal > 0) {
            return {
                cpr: Math.round(cachedVal),
                source: 'cache',
                isEstimated: false,
                tag: '[Exact]',
                sourceNote: 'Cached Key / TornStats CPR',
                dropdownLabel: `${Math.round(cachedVal)}% ${role} [Exact]`
            };
        }

        // Priority 3: Role-Specific Historical CPR from 300 Completed OCs (by [playerId][roleName])
        const roleHist = analytics.memberRoleHistory.get(pKey);
        if (roleHist) {
            const roleLower = role.toLowerCase();
            const entry = roleHist[roleLower];
            if (entry) {
                const byTier = entry.byTier?.[Number(crimeTier)];
                const histVal = byTier ? byTier.latest : entry.latest;
                if (histVal > 0) {
                    return {
                        cpr: Math.round(histVal),
                        source: 'history',
                        isEstimated: false,
                        tag: '[Exact]',
                        sourceNote: byTier ? `Historical T${crimeTier} ${role}` : `Historical ${role}`,
                        dropdownLabel: `${Math.round(histVal)}% ${role} [Exact]`
                    };
                }
            }
        }

        // Priority 4: Fallback — NEVER played this specific role
        const mem = cmdData.members[pKey];
        const lvl = Number(mem?.level || 25);
        const est = Math.min(88, Math.max(40, 48 + Math.round(lvl * 0.42) - (Math.max(1, Number(crimeTier || 2)) - 1) * 4));
        return {
            cpr: est,
            source: 'est',
            isEstimated: true,
            tag: '(Est.)',
            sourceNote: `Never Played ${role}`,
            dropdownLabel: `~${est}% Est. — Never Played ${role}`
        };
    }

    // ─── Auth & Navigation Helpers ───
    function hasOcAccess() {
        const token = localStorage.getItem('sv_session_token');
        const legacyKey = localStorage.getItem('warboard_apikey');
        const memKey = typeof window.getApiKey === 'function' ? window.getApiKey() : '';
        return Boolean((typeof window.hasTornAccess === 'function' && window.hasTornAccess()) || token || legacyKey || memKey);
    }

    window.openSettings = function () {
        if (typeof window.openGlobalSettings === 'function') return window.openGlobalSettings();
        const modal = document.getElementById('settings-modal');
        if (modal) modal.style.display = 'flex';
    };
    window.closeSettings = function () {
        const modal = document.getElementById('settings-modal');
        if (modal) modal.style.display = 'none';
    };

    window.switchOcView = function (viewKey, updateHash = true) {
        const raw = String(viewKey || 'board').toLowerCase();
        // Backwards-compatible mapping from old 6 tabs into 4 consolidated workspaces
        const mapView = {
            board: 'board',
            workbench: 'workbench',
            bench: 'workbench',
            payouts: 'payouts',
            economics: 'payouts',
            intel: 'intel',
            roi: 'intel',
            leaderboard: 'intel'
        };
        const safe = mapView[raw] || 'board';
        currentView = safe;

        document.querySelectorAll('.oc-view-tab').forEach(b => b.classList.toggle('active', b.id === `view-tab-${safe}`));
        document.querySelectorAll('.oc-view-pane').forEach(p => p.classList.toggle('active', p.id === `pane-${safe}`));

        if (updateHash) {
            try {
                if (window.location.hash !== `#${safe}`) window.history.replaceState(null, '', `#${safe}`);
            } catch (_) {}
        }

        renderAllActiveViews();

        if (raw === 'economics') {
            setTimeout(() => document.getElementById('economics-suite-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
        } else if (raw === 'roi') {
            setTimeout(() => document.getElementById('roi-advisor-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
        }
    };

    window.setTab = function (tab) {
        const safe = ['all', 'recruiting', 'planning', 'ready', 'blocked'].includes(tab) ? tab : 'all';
        currentBoardTab = safe;
        if (currentView !== 'board') window.switchOcView('board');
        document.querySelectorAll('#board-status-pills .tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-${safe}`));
        renderBoardCrimesOnly();
    };

    window.toggleSafePreWar = function () {
        safePreWarOnly = !safePreWarOnly;
        const btn = document.getElementById('btn-safe-prewar');
        if (btn) btn.classList.toggle('primary', safePreWarOnly);
        renderBoardCrimesOnly();
    };

    // ─── Data Sync & Cache Hydration ───
    function stopProgressBar() {
        if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    }

    function startProgressBar() {
        if (document.hidden) return;
        if (progressTimer) clearInterval(progressTimer);
        const bar = document.getElementById('refresh-bar');
        const startTime = Date.now();
        if (bar) {
            bar.style.transition = 'none';
            bar.style.width = '0%';
            setTimeout(() => { bar.style.transition = 'width 0.1s linear'; }, 50);
        }
        progressTimer = setInterval(() => {
            if (document.hidden) { stopProgressBar(); return; }
            const pct = Math.min(((Date.now() - startTime) / REFRESH_MS) * 100, 100);
            if (bar) bar.style.width = pct + '%';
        }, 250);
    }

    window.fetchOCs = async function (force = false) {
        if (!hasOcAccess()) {
            renderNoAuthState();
            return;
        }
        if (isFetchingOCs) return;
        isFetchingOCs = true;

        const syncBtn = document.getElementById('btn-sync-ocs');
        const syncSvg = document.getElementById('sync-oc-svg');
        if (syncBtn) syncBtn.disabled = true;
        if (syncSvg) syncSvg.classList.add('spin-svg');

        try {
            const url = `/api/oc/command-center${force ? '?force=1' : ''}`;
            const res = await fetch(url);
            if (res.status === 404) {
                const legRes = await fetch('/api/ocs');
                const legData = await legRes.json();
                if (legData.error) throw new Error(legData.error);
                cmdData = {
                    ...cmdData,
                    factionId: legData.factionId || '',
                    crimes: legData.crimes || [],
                    members: legData.members || synthesizeMembersFromCrimes(legData.crimes || []),
                    completedCrimes: legData.completedCrimes || [],
                    catalog: legData.catalog || []
                };
            } else {
                const data = await res.json();
                if (res.status === 403 || data.permissionError || data.requiresAA) {
                    renderPermissionError(data.error);
                    return;
                }
                if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
                cmdData = {
                    factionId: data.factionId || '',
                    factionName: data.factionName || 'Faction',
                    crimes: data.crimes || [],
                    completedCrimes: data.completedCrimes || [],
                    members: data.members || {},
                    armoryStock: data.armoryStock || {},
                    warState: data.warState || { activeWar: null, nextScheduledWar: null, chain: null },
                    catalog: data.catalog || [],
                    cprOverrides: data.cprOverrides || {},
                    factionRoleCprCache: data.factionRoleCprCache || {},
                    payoutStatus: data.payoutStatus || {},
                    ocMemberHistory: data.ocMemberHistory || {}
                };

                // Persist multi-user Priority 2 role CPR cache locally
                if (data.factionRoleCprCache && Object.keys(data.factionRoleCprCache).length > 0) {
                    localRoleCprCache = { ...localRoleCprCache, ...data.factionRoleCprCache };
                    try { localStorage.setItem(STORAGE_ROLE_CPR_CACHE_KEY, JSON.stringify(localRoleCprCache)); } catch (_) {}
                }
            }

            try { sessionStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(cmdData)); } catch (_) {}
            recomputeCommandAnalytics();
            renderAllActiveViews();
            startProgressBar();

            const timeStr = new Date().toLocaleTimeString();
            const el = document.getElementById('status-line');
            if (el) {
                el.textContent = `${cmdData.factionName || 'Faction'} • ${analytics.activeAnnotated.length} Active OCs • ${(cmdData.completedCrimes || []).length} Historical OCs • Synced ${timeStr}`;
            }

            if (refreshTimer) clearInterval(refreshTimer);
            refreshTimer = setInterval(() => {
                if (!document.hidden) window.fetchOCs(false);
            }, REFRESH_MS);
        } catch (err) {
            showOcToast(`⚠️ Sync error: ${err.message}`);
            const el = document.getElementById('status-line');
            if (el) el.textContent = `Sync notice: ${err.message}`;
        } finally {
            isFetchingOCs = false;
            if (syncBtn) syncBtn.disabled = false;
            if (syncSvg) syncSvg.classList.remove('spin-svg');
        }
    };

    function synthesizeMembersFromCrimes(crimes) {
        const map = {};
        (crimes || []).forEach(c => {
            (c.slots || []).forEach(s => {
                if (s.user && s.user.id) {
                    map[String(s.user.id)] = {
                        id: s.user.id,
                        name: s.user.name || `ID:${s.user.id}`,
                        level: s.user.level || 1,
                        days_in_faction: 30,
                        position: 'Member',
                        status: s.user.status || { state: 'Okay', description: 'Okay', until: 0 },
                        last_action: s.user.last_action || { timestamp: Math.floor(Date.now() / 1000) - 600 }
                    };
                }
            });
        });
        return map;
    }

    function renderNoAuthState() {
        document.getElementById('status-line').textContent = 'Connect Torn API key in Settings to sync OC 2.0 Command Center.';
        document.getElementById('oc-container').innerHTML = `
            <div class="oc-alert-strip cyan" style="padding:20px;">
                <div>
                    <strong>⚙️ Torn API Key Required</strong> — Connect your Torn API key in
                    <button class="oc-action-btn primary" onclick="openSettings()" style="margin:0 6px;">Settings</button>
                    to unlock the OC 2.0 Command Center.
                </div>
            </div>`;
    }

    function renderPermissionError(msg) {
        document.getElementById('status-line').textContent = 'Faction AA API permission required.';
        document.getElementById('oc-container').innerHTML = `
            <div class="oc-alert-strip" style="padding:20px;">
                <div>
                    <strong>🔐 Faction AA API Permission Required</strong><br>
                    <span style="color:var(--text-secondary);">${escapeHtml(msg || 'Your key needs Faction Organized Crime (AA) permissions.')}</span>
                    <button class="oc-action-btn primary" onclick="openSettings()" style="margin-left:10px;">Open Settings</button>
                </div>
            </div>`;
    }

    // ─── Core Analytics Derivation Engine ───
    function getPhaseForCrime(c, nowSec) {
        const st = String(c.status || '').toLowerCase();
        if (st === 'ready') return 'ready';
        if (st === 'recruiting') return 'recruiting';
        if (st === 'planning') {
            if (c.ready_at && c.ready_at <= nowSec) return 'ready';
            return 'planning';
        }
        return 'completed';
    }

    function getMemberLiveBlocker(mInfo, nowSec) {
        const st = mInfo?.status || {};
        const state = String(st.state || 'Okay');
        const desc = String(st.description || '');
        const until = Number(st.until || 0);
        const remSec = until > nowSec ? (until - nowSec) : 0;

        if (state === 'Hospital') return { blocked: true, code: 'Hospital', label: `🏥 Hosp ${remSec > 0 ? formatDurationShort(remSec) : ''}`.trim(), remSec: remSec || 600, detail: desc || 'Hospitalized' };
        if (state === 'Jail' || state === 'Federal') return { blocked: true, code: state, label: `⛓️ ${state} ${remSec > 0 ? formatDurationShort(remSec) : ''}`.trim(), remSec: remSec || 900, detail: desc || state };
        if (state === 'Traveling' || desc.toLowerCase().includes('traveling')) return { blocked: true, code: 'Traveling', label: '✈️ Flying', remSec: remSec || 1800, detail: desc || 'Traveling' };
        if (state === 'Abroad') return { blocked: true, code: 'Abroad', label: '🌐 Abroad', remSec: remSec || 2400, detail: desc || 'Abroad' };
        return { blocked: false, code: 'Okay', label: '🟢 Okay', remSec: 0, detail: 'In Torn' };
    }

    function computeTeamSuccessProb(slots) {
        if (!slots || !slots.length) return 0;
        let geoProd = 1;
        let sum = 0;
        let penalty = 0;
        slots.forEach(s => {
            const p = Math.max(5, Math.min(99, Number(s.cpr ?? s.checkpoint_pass_rate ?? 50)));
            geoProd *= (p / 100);
            sum += p;
            if (p < 60) penalty += (60 - p) * 0.45;
            if ((s.needsItem || s.item_requirement) && (s.hasItem === false || s.item_requirement?.is_available === false)) {
                penalty += 18;
            }
        });
        const arith = sum / slots.length;
        const geoPct = Math.pow(geoProd, 1 / slots.length) * 100;
        return Math.max(2, Math.min(99, Number(((arith * 0.4 + geoPct * 0.6) - penalty).toFixed(1))));
    }

    function recomputeCommandAnalytics() {
        const nowSec = Math.floor(Date.now() / 1000);
        const members = cmdData.members || {};
        const activeCrimesRaw = (cmdData.crimes || []).filter(c => {
            const ph = getPhaseForCrime(c, nowSec);
            return ph === 'recruiting' || ph === 'planning' || ph === 'ready';
        });
        const completedRaw = cmdData.completedCrimes || [];

        // 1. Index ALL 300 Completed OCs + 16 Active OCs STRICTLY per [playerId][roleName] (Priority 3 data)
        const roleHistoryMap = new Map();
        const memStats = {};
        const observedRolesSet = new Set(CORE_ROLE_COLUMNS);

        const ensureMem = (pId) => {
            const k = String(pId);
            if (!memStats[k]) {
                memStats[k] = {
                    playerId: Number(pId),
                    completed: 0,
                    wins: 0,
                    fails: 0,
                    cprSum: 0,
                    cprCount: 0,
                    grossCash: 0,
                    respect: 0,
                    gearSupplied: 0,
                    lastCompletedAt: Number((cmdData.ocMemberHistory || {})[k] || 0) / ((Number((cmdData.ocMemberHistory || {})[k] || 0) > 1e12) ? 1000 : 1),
                    recentCrimes: [],
                    cprHistory: []
                };
            }
            if (!roleHistoryMap.has(k)) roleHistoryMap.set(k, {});
            return memStats[k];
        };

        const indexRoleCpr = (pId, rawRole, tier, cpr) => {
            const k = String(pId);
            const role = normalizeRoleName(rawRole);
            const val = Number(cpr || 0);
            if (!role || val <= 0) return;
            observedRolesSet.add(role);
            const rLower = role.toLowerCase();
            const map = roleHistoryMap.get(k);
            if (!map[rLower]) map[rLower] = { role, latest: val, sum: 0, cnt: 0, byTier: {} };
            const e = map[rLower];
            e.latest = val;
            e.sum += val;
            e.cnt++;
            if (!e.byTier[tier]) e.byTier[tier] = { latest: val, sum: 0, cnt: 0 };
            e.byTier[tier].latest = val;
            e.byTier[tier].sum += val;
            e.byTier[tier].cnt++;
        };

        const completedChron = [...completedRaw].sort((a, b) => (a.executed_at || 0) - (b.executed_at || 0));
        completedChron.forEach(c => {
            const isWin = String(c.status || '').toLowerCase() === 'successful';
            const slots = c.slots || [];
            const crewCount = Math.max(1, slots.filter(s => s.user?.id).length);
            const crimeGross = Number(c.rewards?.gross_total ?? ((c.rewards?.money || 0) + (c.rewards?.item_value_total || 0)));
            const crimeResp = Number(c.rewards?.respect || 0);
            const execAt = Number(c.executed_at || c.ready_at || 0);
            const tier = Number(c.difficulty || 1);

            slots.forEach(s => {
                if (!s.user?.id) return;
                const rec = ensureMem(s.user.id);
                const role = normalizeRoleName(s.position || s.position_info?.label || 'Operative');
                const cpr = Number(s.checkpoint_pass_rate || 0);
                rec.completed++;
                if (isWin) rec.wins++; else rec.fails++;
                if (cpr > 0) {
                    rec.cprSum += cpr;
                    rec.cprCount++;
                    rec.cprHistory.push({ ts: execAt, cpr, crime: c.name, role });
                    indexRoleCpr(s.user.id, role, tier, cpr);
                }
                if (isWin) {
                    rec.grossCash += crimeGross / crewCount;
                    rec.respect += crimeResp / crewCount;
                }
                // Count ONLY consumed 1x items supplied by user
                if (s.item_requirement && !s.item_requirement.is_reusable && s.user.item_outcome?.owned_by !== 'faction' && (s.user.item_outcome?.outcome === 'used' || s.item_requirement.is_available)) {
                    rec.gearSupplied += Number(s.item_requirement.market_value || 0);
                }
                if (execAt > rec.lastCompletedAt) rec.lastCompletedAt = execAt;
                rec.recentCrimes.push({
                    id: c.id, name: c.name, difficulty: tier, role, cpr, status: c.status,
                    outcome: s.user.outcome || c.status, executedAt: execAt,
                    rewardShare: isWin ? Math.round(crimeGross / crewCount) : 0
                });
            });
        });

        activeCrimesRaw.forEach(c => {
            (c.slots || []).forEach(s => {
                if (!s.user?.id) return;
                const rec = ensureMem(s.user.id);
                const role = normalizeRoleName(s.position || s.position_info?.label || 'Operative');
                const cpr = Number(s.checkpoint_pass_rate || 0);
                if (cpr > 0) {
                    rec.cprSum += cpr;
                    rec.cprCount++;
                    indexRoleCpr(s.user.id, role, Number(c.difficulty || 1), cpr);
                }
            });
        });

        Object.values(memStats).forEach(rec => rec.recentCrimes.reverse());
        analytics.memberRoleHistory = roleHistoryMap;
        analytics.allRoleColumns = Array.from(observedRolesSet);

        // Clean stale staged entries where member is no longer unassigned or crime left Recruiting
        const activeMemSlot = new Map();
        activeCrimesRaw.forEach(c => {
            const ph = getPhaseForCrime(c, nowSec);
            (c.slots || []).forEach(s => {
                if (s.user?.id) activeMemSlot.set(String(s.user.id), { crime: c, phase: ph, role: s.position_info?.label || s.position });
            });
        });
        const activeRecruitIds = new Set(activeCrimesRaw.filter(c => getPhaseForCrime(c, nowSec) === 'recruiting').map(c => String(c.id)));
        stagedAssignments = stagedAssignments.filter(st => !activeMemSlot.has(String(st.playerId)) && activeRecruitIds.has(String(st.crimeId)));
        saveStagedAssignments();

        // 2. Annotate Active OCs + Normalize Catalog Map
        const catalogMap = new Map();
        (cmdData.catalog || []).forEach(x => {
            const nKey = normalizeCrimeName(x.name);
            if (!catalogMap.has(nKey) || (x.observedCount || 0) > (catalogMap.get(nKey).observedCount || 0)) {
                catalogMap.set(nKey, x);
            }
        });

        const war = cmdData.warState?.activeWar || cmdData.warState?.nextScheduledWar || null;
        const warStart = Number(war?.start || 0);
        const warEnd = Number(war?.end || (warStart ? warStart + 5 * 86400 : 0));
        const missingGearMap = new Map();
        const blockingMemberIds = new Set();

        const annotatedCrimes = activeCrimesRaw.map(c => {
            const phase = getPhaseForCrime(c, nowSec);
            const tier = Number(c.difficulty || 1);
            const floor = getMinSafeFloor(tier);
            const cat = catalogMap.get(normalizeCrimeName(c.name)) || null;
            const slots = c.slots || [];
            const filledSlots = slots.filter(s => s.user?.id).length;
            const totalSlots = slots.length;
            const emptySlots = totalSlots - filledSlots;

            let sumCpr = 0, cprCnt = 0, lowCprCount = 0;
            const blockedCrew = [];
            const inactiveCrew = [];
            const missingItems = [];
            let earliestJoined = Number(c.created_at || nowSec);

            slots.forEach(s => {
                if (s.user?.joined_at && s.user.joined_at < earliestJoined) earliestJoined = s.user.joined_at;
                if (s.user?.id) {
                    const mInfo = members[String(s.user.id)] || s.user;
                    const blk = getMemberLiveBlocker(mInfo, nowSec);
                    s._liveBlocker = blk;
                    if (blk.blocked) {
                        blockedCrew.push({ id: s.user.id, name: mInfo.name || s.user.name, ...blk });
                        if (phase === 'ready' || (phase === 'planning' && c.ready_at && (c.ready_at - nowSec) <= 7200)) {
                            blockingMemberIds.add(String(s.user.id));
                        }
                    }
                    const lastTs = Number(mInfo?.last_action?.timestamp || 0);
                    if (lastTs > 0 && (nowSec - lastTs) > 86400) {
                        inactiveCrew.push({ id: s.user.id, name: mInfo.name || s.user.name, offlineHours: Math.round((nowSec - lastTs) / 3600) });
                    }
                    const cpr = Number(s.checkpoint_pass_rate || 0);
                    if (cpr > 0) { sumCpr += cpr; cprCnt++; if (cpr < floor) lowCprCount++; }
                }
                if (s.item_requirement && !s.item_requirement.is_available && s.user?.id) {
                    const itemObj = {
                        crimeId: c.id,
                        crimeName: c.name,
                        role: s.position_info?.label || s.position,
                        playerId: s.user.id,
                        playerName: s.user.name || `ID:${s.user.id}`,
                        itemId: s.item_requirement.id,
                        itemName: s.item_requirement.name || `Item #${s.item_requirement.id}`,
                        marketValue: Number(s.item_requirement.market_value || 0),
                        armoryAvail: s.item_requirement.armory_available
                    };
                    missingItems.push(itemObj);
                    const mKey = String(itemObj.itemId);
                    if (!missingGearMap.has(mKey)) missingGearMap.set(mKey, { ...itemObj, qtyNeeded: 0, usages: [] });
                    const gAgg = missingGearMap.get(mKey);
                    gAgg.qtyNeeded++;
                    gAgg.usages.push(`${itemObj.playerName} (${itemObj.crimeName})`);
                }
            });

            const avgCpr = cprCnt > 0 ? Number((sumCpr / cprCnt).toFixed(1)) : 0;
            const teamPassProb = cprCnt > 0 ? computeTeamSuccessProb(slots.filter(s => s.user).map(s => ({ cpr: s.checkpoint_pass_rate || 50, needsItem: Boolean(s.item_requirement), hasItem: Boolean(s.item_requirement?.is_available ?? true) }))) : 0;
            const allClearEtaSec = blockedCrew.reduce((mx, b) => Math.max(mx, b.remSec || 0), 0);
            const isLaunchBlocked = (phase === 'ready' || (phase === 'planning' && c.ready_at && (c.ready_at - nowSec) <= 7200)) && blockedCrew.length > 0;
            const waitHours = Math.max(0, (nowSec - earliestJoined) / 3600);
            const isHostageStall = phase === 'recruiting' && filledSlots >= 1 && emptySlots >= 1 && emptySlots <= 2 && waitHours > 18;
            const isInactiveStall = (phase === 'planning' || phase === 'ready') && inactiveCrew.length > 0;
            const planDays = cat?.planningDays || (tier + 2);
            const projectedEndSec = phase === 'ready' ? nowSec : (Number(c.ready_at || 0) > 0 ? Number(c.ready_at) : nowSec + planDays * 86400);
            const warOverlap = Boolean(warStart && projectedEndSec >= warStart && projectedEndSec <= warEnd);
            const estCash = Number(c.rewards?.gross_total || ((cat?.estCash || 0) + (cat?.estItemValue || 0)) || (tier * 3500000));
            const estRespect = Number(c.rewards?.respect || cat?.estRespect || (tier * 35));
            const wastedReadinessSec = phase === 'ready' && c.ready_at && c.ready_at < nowSec ? (nowSec - c.ready_at) : 0;
            const needsAttention = isLaunchBlocked || isHostageStall || isInactiveStall || missingItems.length > 0 || lowCprCount > 0;

            return {
                ...c, phase, tier, floor, filledSlots, emptySlots, totalSlots, avgCpr, teamPassProb, lowCprCount,
                blockedCrew, inactiveCrew, allClearEtaSec, isLaunchBlocked, isHostageStall, waitHours: Math.round(waitHours),
                isInactiveStall, missingItems, needsAttention, warOverlap, projectedEndSec, estCash, estRespect, wastedReadinessSec, planDays
            };
        });
        analytics.activeAnnotated = annotatedCrimes;
        analytics.missingGearList = Array.from(missingGearMap.values());
        analytics.warConflictsCount = annotatedCrimes.filter(c => c.warOverlap).length;

        // 3. Classify Unassigned Bench with Top 3 Strongest Roles (no generic ~XX% average!)
        const benchAll = [], benchAvail = [], benchBlocked = [], benchInactive = [];
        Object.values(members).forEach(m => {
            const pKey = String(m.id);
            if (activeMemSlot.has(pKey)) return;
            const lastTs = Number(m.last_action?.timestamp || 0);
            const offlineSec = lastTs > 0 ? Math.max(0, nowSec - lastTs) : 999999;
            const state = String(m.status?.state || 'Okay');
            const daysInFac = Number(m.days_in_faction || 0);
            const blocker = getMemberLiveBlocker(m, nowSec);
            const recHist = memStats[pKey];
            const lastOcSec = recHist?.lastCompletedAt || 0;
            const daysSinceLastOc = lastOcSec > 0 ? Math.max(0, Math.round((nowSec - lastOcSec) / 86400)) : null;

            // Gather Top 3 exact/known role ratings across all observed roles
            const knownRoles = [];
            analytics.allRoleColumns.forEach(rName => {
                const res = getMemberRoleCPR(m.id, rName, 3);
                if (!res.isEstimated) knownRoles.push({ role: rName, cpr: res.cpr, source: res.source });
            });
            knownRoles.sort((a, b) => b.cpr - a.cpr);
            const topRoles = knownRoles.slice(0, 3);
            const bestRoleScore = topRoles.length ? topRoles[0].cpr : 50;

            let bucket = 'available', exemptReason = '';
            if (offlineSec > 86400) { bucket = 'inactive'; exemptReason = `Offline ${Math.floor(offlineSec / 3600)}h`; }
            else if (state === 'Federal') { bucket = 'inactive'; exemptReason = 'Federal Jail'; }
            else if (daysInFac < 3) { bucket = 'inactive'; exemptReason = `New Recruit (${daysInFac}d)`; }
            else if (blocker.blocked) { bucket = 'blocked'; exemptReason = blocker.detail; }

            const entry = { ...m, bucket, exemptReason, blocker, offlineSec, topRoles, bestRoleScore, daysSinceLastOc };
            benchAll.push(entry);
            if (bucket === 'available') benchAvail.push(entry);
            else if (bucket === 'blocked') benchBlocked.push(entry);
            else benchInactive.push(entry);
        });
        benchAvail.sort((a, b) => b.bestRoleScore - a.bestRoleScore);
        analytics.bench = { all: benchAll, available: benchAvail, blocked: benchBlocked, inactive: benchInactive };

        // 4. Smart Role & CPR Matching + Real Tool #1 Recruiting Queue Over-Spawn Consolidation Plan
        const recruitingCrimes = annotatedCrimes
            .filter(c => c.phase === 'recruiting' && c.emptySlots > 0)
            .sort((a, b) => a.emptySlots - b.emptySlots || (b.filledSlots / b.totalSlots) - (a.filledSlots / a.totalSlots) || b.estCash - a.estCash);

        const openSlotsList = [];
        recruitingCrimes.forEach(c => {
            (c.slots || []).forEach((s, idx) => {
                if (!s.user) {
                    openSlotsList.push({
                        crimeId: c.id, crimeName: c.name, tier: c.tier, floor: c.floor, slotIdx: idx,
                        role: s.position_info?.label || s.position || 'Operative',
                        rawRole: normalizeRoleName(s.position || 'Operative'),
                        itemReq: s.item_requirement || null,
                        slotRef: s
                    });
                }
            });
        });

        const totalOpenRecSlots = openSlotsList.length;
        const availCount = benchAvail.length;
        const fillNowCrimes = [];
        const pauseRecs = [];
        const autoFillPairs = [];
        const usedBench = new Set();
        let remainingAvail = availCount;

        recruitingCrimes.forEach(c => {
            const need = c.emptySlots;
            if (remainingAvail > 0 && remainingAvail >= need) {
                const crimePairs = [];
                (c.slots || []).forEach((s, sIdx) => {
                    if (s.user) return;
                    const rawRole = normalizeRoleName(s.position || 'Operative');
                    let bestCand = null, bestCpr = -1, bestScore = -9999;
                    benchAvail.forEach(cand => {
                        if (usedBench.has(cand.id)) return;
                        const info = getMemberRoleCPR(cand.id, rawRole, c.tier);
                        const score = info.cpr + (info.isEstimated ? -15 : 25) + (info.cpr >= c.floor ? 30 : -20);
                        if (score > bestScore) { bestScore = score; bestCand = cand; bestCpr = info; }
                    });
                    if (bestCand) {
                        usedBench.add(bestCand.id);
                        remainingAvail--;
                        const pair = { playerId: bestCand.id, playerName: bestCand.name, crimeId: c.id, crimeName: c.name, tier: c.tier, slotIdx: sIdx, role: s.position_info?.label || rawRole, rawRole, cpr: bestCpr.cpr, cprInfo: bestCpr };
                        crimePairs.push(pair);
                        autoFillPairs.push(pair);
                        s._suggestedFit = { id: bestCand.id, name: bestCand.name, cpr: bestCpr.cpr, isEstimated: bestCpr.isEstimated, dropdownLabel: bestCpr.dropdownLabel };
                    }
                });
                fillNowCrimes.push({ crime: c, slotsUsed: crimePairs.length, pairs: crimePairs });
            } else {
                // Still annotate best candidate preview if any unused bench exists
                (c.slots || []).forEach(s => {
                    if (s.user) return;
                    const rawRole = normalizeRoleName(s.position || 'Operative');
                    const firstCand = benchAvail.find(cand => !usedBench.has(cand.id)) || benchAvail[0];
                    if (firstCand) {
                        const info = getMemberRoleCPR(firstCand.id, rawRole, c.tier);
                        s._suggestedFit = { id: firstCand.id, name: firstCand.name, cpr: info.cpr, isEstimated: info.isEstimated, dropdownLabel: info.dropdownLabel };
                    } else s._suggestedFit = null;
                });
                pauseRecs.push({ crime: c, need });
            }
        });

        // Order openSlotsList matches cleanly for Workbench & Matcher
        analytics.openSlotMatches = openSlotsList.map(os => {
            const pair = autoFillPairs.find(p => p.crimeId === os.crimeId && p.slotIdx === os.slotIdx);
            return { ...os, matched: pair ? cmdData.members[String(pair.playerId)] : null, cpr: pair ? pair.cpr : 0, cprInfo: pair?.cprInfo || null };
        });

        analytics.queuePlan = {
            overSpawned: totalOpenRecSlots > availCount,
            openSlots: totalOpenRecSlots,
            availBench: availCount,
            deficit: Math.max(0, totalOpenRecSlots - availCount),
            fillNow: fillNowCrimes,
            pauseRecs,
            autoFillPairs
        };

        // 5. Full Member Profiles & Reliability Scores
        const profiles = Object.values(members).map(m => {
            const pKey = String(m.id);
            const h = memStats[pKey] || { completed: 0, wins: 0, fails: 0, cprSum: 0, cprCount: 0, grossCash: 0, respect: 0, gearSupplied: 0, recentCrimes: [], cprHistory: [] };
            const activeAssign = activeMemSlot.get(pKey) || null;
            const avgCpr = h.cprCount > 0 ? Math.round(h.cprSum / h.cprCount) : null;
            const passRate = h.completed > 0 ? Math.round((h.wins / h.completed) * 100) : null;
            const offlineSec = m.last_action?.timestamp ? Math.max(0, nowSec - m.last_action.timestamp) : 0;
            const daysSinceOc = h.lastCompletedAt > 0 ? Math.max(0, Math.round((nowSec - h.lastCompletedAt) / 86400)) : null;

            let reliability = 100;
            const deductions = [];
            if (!activeAssign && offlineSec <= 86400 && daysSinceOc !== null && daysSinceOc >= 2) {
                const pts = Math.min(30, daysSinceOc * 8);
                reliability -= pts;
                deductions.push(`−${pts} Unassigned ${daysSinceOc}d while active`);
            } else if (!activeAssign && offlineSec <= 86400) {
                reliability -= 8;
                deductions.push('−8 Currently on OC Bench');
            }
            if (blockingMemberIds.has(pKey)) {
                reliability -= 25;
                deductions.push('−25 Blocking Ready/Imminent OC');
            }
            if (h.fails > 0 && h.completed > 0 && (h.fails / h.completed) > 0.35) {
                const pts = Math.round(((h.fails / h.completed) - 0.35) * 30);
                reliability -= pts;
                deductions.push(`−${pts} Elevated Fail Share`);
            }
            reliability = Math.max(0, Math.min(100, reliability));

            let rankKey = 'reliable', rankLabel = '⚡ Reliable Operative', rankColor = '#38bdf8';
            if (reliability < 70 || blockingMemberIds.has(pKey)) {
                rankKey = 'risk'; rankLabel = '⚠️ Bench / Blocker Risk'; rankColor = '#fb7185';
            } else if (h.wins >= 6 && (passRate ?? 0) >= 75 && (avgCpr ?? 0) >= 74) {
                rankKey = 'mastermind'; rankLabel = '👑 Heist Mastermind'; rankColor = '#fbbf24';
            } else if (h.gearSupplied >= 250000) {
                rankKey = 'sponsor'; rankLabel = '🛠️ Gear Sponsor'; rankColor = '#a78bfa';
            }

            const roleMap = roleHistoryMap.get(pKey) || {};
            const roleBars = Object.values(roleMap).map(r => ({ role: r.role, val: r.latest })).sort((a, b) => b.val - a.val);

            return {
                playerId: Number(m.id), name: m.name, level: Number(m.level || 1), status: m.status, lastAction: m.last_action,
                inActiveOc: Boolean(activeAssign), activeOcName: activeAssign ? activeAssign.crime.name : null,
                activeOcPhase: activeAssign ? activeAssign.phase : null, activeOcRole: activeAssign ? activeAssign.role : null,
                completed: h.completed, wins: h.wins, fails: h.fails, passRate: passRate ?? 0, hasHistory: h.completed > 0,
                avgCpr: avgCpr ?? 0, grossCash: Math.round(h.grossCash), respect: Math.round(h.respect),
                gearSupplied: Math.round(h.gearSupplied), reliability, deductions, rankKey, rankLabel, rankColor,
                roleBars, recentCrimes: h.recentCrimes, cprHistory: h.cprHistory
            };
        });
        analytics.memberProfiles = profiles;
        analytics.memberProfileMap = new Map(profiles.map(p => [String(p.playerId), p]));

        // 6. Fail Post-Mortems
        analytics.postMortems = completedRaw
            .filter(c => String(c.status || '').toLowerCase().includes('fail'))
            .slice(0, 18)
            .map(c => {
                const filled = (c.slots || []).filter(s => s.user);
                const sorted = [...filled].sort((a, b) => (a.checkpoint_pass_rate || 0) - (b.checkpoint_pass_rate || 0));
                const bottleneck = sorted[0] || null;
                const avg = filled.length ? Math.round(filled.reduce((s, x) => s + (x.checkpoint_pass_rate || 0), 0) / filled.length) : 0;
                const floor = getMinSafeFloor(c.difficulty || 1);
                const recovery = filled.map(s => {
                    const liveMem = members[String(s.user.id)];
                    const blk = liveMem ? getMemberLiveBlocker(liveMem, nowSec) : { blocked: false, label: '✅ Clear' };
                    return { id: s.user.id, name: s.user.name || `ID:${s.user.id}`, role: s.position_info?.label || s.position, cpr: s.checkpoint_pass_rate || 0, outcome: s.user.outcome || 'Failed', blocker: blk };
                });
                const bnCpr = bottleneck?.checkpoint_pass_rate || 0;
                const bnRole = bottleneck?.position_info?.label || bottleneck?.position || 'Slot';
                const missingGearSlot = filled.find(s => s.item_requirement && !s.item_requirement.is_available);
                const tip = missingGearSlot
                    ? `Missing required consumable (${missingGearSlot.item_requirement.name}) crippled execution.`
                    : `Crew avg was ${avg}%, but ${bnRole} slot was ${bnCpr}% CPR — enforce >=${floor}% floor on Tier ${c.difficulty || 1} roles.`;
                return { crime: c, bottleneck, avgCpr: avg, floor, recovery, tip };
            });

        // 7. KPI Summary
        const recCnt = annotatedCrimes.filter(c => c.phase === 'recruiting').length;
        const planCnt = annotatedCrimes.filter(c => c.phase === 'planning').length;
        const readyCnt = annotatedCrimes.filter(c => c.phase === 'ready').length;
        const totalRoster = Object.keys(members).length;
        const assignedCount = activeMemSlot.size;
        const coveragePct = totalRoster > 0 ? Math.round((assignedCount / totalRoster) * 100) : 0;
        const nextPlan = annotatedCrimes.filter(c => c.phase === 'planning' && c.ready_at > nowSec).sort((a, b) => a.ready_at - b.ready_at)[0] || null;

        let allCprSum = 0, allCprCnt = 0, lowFloorCnt = 0;
        annotatedCrimes.forEach(c => {
            (c.slots || []).forEach(s => {
                if (s.user && Number(s.checkpoint_pass_rate || 0) > 0) {
                    allCprSum += Number(s.checkpoint_pass_rate);
                    allCprCnt++;
                    if (Number(s.checkpoint_pass_rate) < c.floor) lowFloorCnt++;
                }
            });
        });

        const cutoff30 = nowSec - 30 * 86400;
        let cashAndItems30d = 0, respect30d = 0;
        completedRaw.forEach(c => {
            const ts = Number(c.executed_at || c.ready_at || 0);
            if (ts >= cutoff30 && String(c.status || '').toLowerCase() === 'successful') {
                cashAndItems30d += Number(c.rewards?.gross_total || ((c.rewards?.money || 0) + (c.rewards?.item_value_total || 0)));
                respect30d += Number(c.rewards?.respect || 0);
            }
        });

        analytics.kpis = {
            totalActive: annotatedCrimes.length, recruitingCount: recCnt, planningCount: planCnt, readyCount: readyCnt,
            totalRoster, assignedCount, benchCount: benchAll.length, coveragePct,
            nextReadyAt: nextPlan ? nextPlan.ready_at : null,
            avgCpr: allCprCnt > 0 ? (allCprSum / allCprCnt).toFixed(1) : '—',
            lowCprSlots: lowFloorCnt,
            missingItemsCount: analytics.missingGearList.reduce((a, g) => a + g.qtyNeeded, 0),
            blockedCount: blockingMemberIds.size,
            cashAndItems30d, respect30d
        };
    }

    // ─── KPIs & Header ───
    function renderKpisAndHeader() {
        const k = analytics.kpis;
        const nowSec = Math.floor(Date.now() / 1000);

        document.getElementById('kpi-active-val').textContent = `${k.totalActive || 0} Active`;
        document.getElementById('kpi-active-sub').textContent = `${k.recruitingCount || 0} Recruiting • ${k.planningCount || 0} Planning • ${k.readyCount || 0} Ready`;

        const covEl = document.getElementById('kpi-cov-val');
        covEl.textContent = `${k.coveragePct || 0}% Assigned`;
        covEl.style.color = k.coveragePct >= 80 ? '#34d399' : (k.coveragePct >= 50 ? '#fbbf24' : '#fb7185');
        document.getElementById('kpi-cov-sub').textContent = `${k.assignedCount || 0} of ${k.totalRoster || 0} in OCs • ${k.benchCount || 0} on Bench`;

        document.getElementById('kpi-ready-val').textContent = `${k.readyCount || 0} Ready`;
        const nextEl = document.getElementById('kpi-next-timer');
        if (k.nextReadyAt && k.nextReadyAt > nowSec) {
            nextEl.dataset.nextReadyAt = String(k.nextReadyAt);
            nextEl.textContent = `Next in ${formatCountdown(k.nextReadyAt - nowSec)}`;
        } else {
            delete nextEl.dataset.nextReadyAt;
            nextEl.textContent = k.readyCount > 0 ? 'Launch ready now' : 'No active planning timers';
        }

        document.getElementById('kpi-cpr-val').textContent = k.avgCpr === '—' ? '—%' : `${k.avgCpr}% Avg`;
        document.getElementById('kpi-cpr-sub').textContent = `${k.lowCprSlots || 0} slots <${cprFloors.low}%/${cprFloors.high}% floor`;

        const alertSum = (k.missingItemsCount || 0) + (k.blockedCount || 0);
        const alertEl = document.getElementById('kpi-alerts-val');
        alertEl.textContent = `${alertSum} Alerts`;
        alertEl.style.color = alertSum > 0 ? '#fb7185' : '#34d399';
        document.getElementById('kpi-alerts-sub').textContent = `${k.missingItemsCount || 0} Missing Items • ${k.blockedCount || 0} Blocked`;

        document.getElementById('kpi-treasury-val').textContent = fmtCompactMoney(k.cashAndItems30d || 0);
        document.getElementById('kpi-respect-sub').textContent = `+${fmt(k.respect30d || 0)} Respect`;

        const pingBtn = document.getElementById('btn-ping-unassigned');
        if (pingBtn) pingBtn.textContent = `📋 Ping Unassigned (${analytics.bench.available.length})`;

        const warPill = document.getElementById('war-sync-pill');
        const warTxt = document.getElementById('war-sync-text');
        if (warPill && warTxt) {
            const activeWar = cmdData.warState?.activeWar;
            const nextWar = cmdData.warState?.nextScheduledWar;
            const chainCur = Number(cmdData.warState?.chain?.current || 0);
            const chainNote = chainCur >= 10 ? ` • Chain ${chainCur}` : '';
            if (analytics.warConflictsCount > 0) {
                warPill.className = 'oc-war-pill warn';
                warTxt.textContent = `⚠️ ${analytics.warConflictsCount} OC${analytics.warConflictsCount > 1 ? 's' : ''} Overlap Ranked War${chainNote}`;
            } else if (activeWar) {
                warPill.className = 'oc-war-pill warn';
                warTxt.textContent = `⚔️ Ranked War Active • Timing Safe${chainNote}`;
            } else if (nextWar) {
                warPill.className = 'oc-war-pill safe';
                warTxt.textContent = `🛡️ War Scheduled (${formatTctDate(nextWar.start)}) • Safe${chainNote}`;
            } else {
                warPill.className = 'oc-war-pill safe';
                warTxt.textContent = `🛡️ No War Conflict${chainNote}`;
            }
        }
    }

    // ─── WORKSPACE 1 (#board): Live Command & Queue Optimizer ───
    window.renderBoard = renderBoard;
    function renderBoard() {
        renderQueueOptimizerCard('queue-optimizer-card', true);

        const gearEl = document.getElementById('missing-gear-summary');
        if (gearEl) {
            const list = analytics.missingGearList;
            if (list.length > 0) {
                const totalCost = list.reduce((a, i) => a + i.marketValue * i.qtyNeeded, 0);
                const pills = list.map(i => `
                    <span class="item-pill missing" title="${escapeHtml(i.usages.join(', '))}">
                        ⚠️ ${i.qtyNeeded}× ${escapeHtml(i.itemName)} (~${fmtCompactMoney(i.marketValue * i.qtyNeeded)})
                        ${i.armoryAvail !== null ? `<span>• Armory: ${i.armoryAvail}</span>` : ''}
                        <a class="mini-icon-btn" href="https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${i.itemId}" target="_blank" rel="noopener noreferrer">🛒</a>
                    </span>`).join('');
                gearEl.style.display = 'flex';
                gearEl.className = 'oc-alert-strip crimson';
                gearEl.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                            <strong>🛠️ Missing Role Consumables Summary (${list.reduce((a, x) => a + x.qtyNeeded, 0)} items • Est. ${fmtMoney(totalCost)} market cost)</strong>
                            <a class="mini-icon-btn" href="https://www.torn.com/factions.php?step=your#/tab=armoury&sub=utilities" target="_blank" rel="noopener noreferrer">📦 Open Faction Armory ↗</a>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">${pills}</div>
                    </div>`;
            } else gearEl.style.display = 'none';
        }

        renderTimelineGantt();
        renderBoardCrimesOnly();
    }

    function renderQueueOptimizerCard(targetId, showFullActionRows) {
        const el = document.getElementById(targetId);
        if (!el) return;
        const qp = analytics.queuePlan;
        if (!qp || (qp.openSlots === 0 && qp.availBench === 0)) {
            el.style.display = 'none';
            return;
        }
        el.style.display = 'block';
        if (qp.overSpawned) {
            const fillHtml = qp.fillNow.length
                ? qp.fillNow.map(f => `<div style="font-size:0.78em; padding:3px 0;"><span class="status-pill pill-ready" style="padding:2px 7px;">🟢 FILL NOW</span> <strong>[T${f.crime.tier}] ${escapeHtml(f.crime.name)}</strong> (#${f.crime.id}) — Needs ${f.crime.emptySlots} slot${f.crime.emptySlots > 1 ? 's' : ''} → Uses ${f.slotsUsed}/${qp.availBench} Available Bench</div>`).join('')
                : '<div style="font-size:0.78em; color:#fbbf24;">Not enough available bench members to complete even 1 full Recruiting OC yet.</div>';

            const pauseHtml = qp.pauseRecs.slice(0, 5).map(p => `<div style="font-size:0.78em; padding:3px 0;"><span class="status-pill pill-recruiting" style="padding:2px 7px; border-color:rgba(244,63,94,0.5); color:#fda4af; background:rgba(244,63,94,0.14);">🔴 RECOMMEND PAUSE / REASSIGN CREW</span> <strong>[T${p.crime.tier}] ${escapeHtml(p.crime.name)}</strong> (#${p.crime.id}) — ${p.crime.filledSlots}/${p.crime.totalSlots} filled, needs ${p.need} more (Insufficient free bench)</div>`).join('');

            el.innerHTML = `
                <div class="oc-glass-panel" style="border-color:rgba(245,158,11,0.5); background:rgba(245,158,11,0.07);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom:8px;">
                        <div>
                            <strong style="font-size:0.96em; color:#fbbf24;">⚠️ Recruiting Queue Over-Spawned: ${qp.openSlots} Open Slots for only ${qp.availBench} Available Members (${qp.deficit}-Slot Deficit)</strong>
                            <div style="font-size:0.77em; color:var(--text-secondary); margin-top:2px;">Do NOT spawn new OCs — consolidate existing half-empty Recruiting crimes so crews start planning immediately.</div>
                        </div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            ${qp.autoFillPairs.length > 0 ? `<button class="oc-action-btn emerald" onclick="autoStageBestFills(true)">⚡ Auto-Stage Best ${qp.autoFillPairs.length} Fill${qp.autoFillPairs.length > 1 ? 's' : ''}</button>` : ''}
                            <button class="oc-action-btn" onclick="switchOcView('workbench')">🛠️ Open Crew Workbench</button>
                        </div>
                    </div>
                    ${showFullActionRows ? `<div style="display:flex; flex-direction:column; gap:3px; border-top:1px solid rgba(255,255,255,0.07); padding-top:8px;">${fillHtml}${pauseHtml}</div>` : ''}
                </div>`;
        } else {
            const netNeed = qp.availBench - qp.openSlots;
            el.innerHTML = `
                <div class="oc-alert-strip ${netNeed >= 3 ? 'cyan' : 'emerald'}">
                    <div>
                        <strong>🧬 Queue Capacity &amp; Demand:</strong> ${qp.availBench} Available Bench Members vs. ${qp.openSlots} Open Recruiting Slots
                        ${netNeed >= 3 ? `→ <strong style="color:#38bdf8;">Spawn 1× New Tier 2–4 OC (${netNeed} idle operatives ready)</strong>` : '→ Queue cleanly balanced with active bench.'}
                    </div>
                    <div style="display:flex; gap:8px;">
                        ${qp.autoFillPairs.length > 0 ? `<button class="oc-action-btn primary" onclick="autoStageBestFills(true)">⚡ Auto-Stage ${qp.autoFillPairs.length} Fills</button>` : ''}
                        <a class="oc-action-btn" href="https://www.torn.com/factions.php?step=your#/tab=crimes" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">🚀 Spawn on Torn ↗</a>
                    </div>
                </div>`;
        }
    }

    function renderTimelineGantt() {
        const panel = document.getElementById('timeline-gantt-panel');
        const body = document.getElementById('gantt-body');
        const collapseBtn = document.getElementById('gantt-collapse-btn');
        const heading = document.getElementById('gantt-title-heading');
        const hintEl = document.getElementById('gantt-summary-hint');
        if (!panel || !body) return;

        if (heading) heading.textContent = `⏱️ ${ganttWindowHours}-Hour Stage Timeline & Planning Chronometer`;
        body.style.display = ganttCollapsed ? 'none' : 'block';
        if (collapseBtn) collapseBtn.textContent = ganttCollapsed ? 'Show Timeline' : 'Hide Timeline';

        const nowSec = Math.floor(Date.now() / 1000);
        const spanSec = ganttWindowHours * 3600;
        const endSec = nowSec + spanSec;

        // Strictly filter to crimes finishing within selected horizon (never render +27h/+44h bars inside 24h view!)
        const inWindow = [];
        let longerCount = 0;
        analytics.activeAnnotated.forEach(c => {
            if (c.phase === 'ready') {
                inWindow.push(c);
            } else if (c.phase === 'planning' && c.ready_at && c.ready_at <= endSec) {
                inWindow.push(c);
            } else if (c.phase === 'recruiting' && c.emptySlots <= 2 && c.projectedEndSec <= endSec) {
                inWindow.push(c);
            } else {
                longerCount++;
            }
        });
        inWindow.sort((a, b) => a.projectedEndSec - b.projectedEndSec);

        if (hintEl) {
            hintEl.textContent = ganttWindowHours === 24
                ? `Strictly <=24h window (${inWindow.length} shown${longerCount > 0 ? ` • ${longerCount} longer horizon in 72h` : ''})`
                : `72h horizon (${inWindow.length} shown${longerCount > 0 ? ` • ${longerCount} beyond 72h` : ''})`;
        }
        if (ganttCollapsed) return;

        const nowDate = new Date(nowSec * 1000);
        const nextMidnightSec = Math.floor(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() + 1, 0, 0, 0) / 1000);
        const midnightPct = (nextMidnightSec >= nowSec && nextMidnightSec <= endSec)
            ? Math.max(4, Math.min(96, ((nextMidnightSec - nowSec) / spanSec) * 100))
            : null;

        const ticks = [];
        const stepH = ganttWindowHours === 24 ? 4 : 12;
        for (let h = 0; h <= ganttWindowHours; h += stepH) ticks.push(h === 0 ? 'Now (TCT)' : `+${h}h`);

        if (inWindow.length === 0) {
            body.innerHTML = `<div style="padding:12px 0; color:var(--text-tertiary); font-size:0.8em;">No crimes completing within next ${ganttWindowHours} hours.${longerCount > 0 ? ` Switch to <button class="mini-icon-btn" onclick="setGanttWindow(72)">72h view</button> to inspect ${longerCount} longer-horizon OC(s).` : ''}</div>`;
            return;
        }

        const rowsHtml = inWindow.map(c => {
            let cls = c.phase;
            if (c.isLaunchBlocked || c.isHostageStall || c.isInactiveStall) cls = 'blocked';
            let widthPct = 100, barText = '';
            if (c.phase === 'ready') {
                widthPct = 30;
                barText = `READY NOW${c.wastedReadinessSec > 0 ? ` • Idling ${formatDurationShort(c.wastedReadinessSec)}${c.wastedReadinessSec > 7200 ? '!' : ''}` : ''}`;
            } else if (c.phase === 'planning' && c.ready_at) {
                widthPct = Math.max(8, Math.min(100, ((c.ready_at - nowSec) / spanSec) * 100));
                const hrsLeft = ((c.ready_at - nowSec) / 3600).toFixed(1);
                barText = `+${hrsLeft}h (${formatTctClock(c.ready_at)} / ${formatLocalShort(c.ready_at)})`;
            } else {
                widthPct = 26;
                barText = `Recruiting (${c.filledSlots}/${c.totalSlots})`;
            }
            return `
                <div class="gantt-row">
                    <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:0.78em; font-weight:700; color:var(--text-primary);">
                        <span style="color:#38bdf8;">[T${c.tier}]</span> ${escapeHtml(c.name)}
                    </div>
                    <div class="gantt-track">
                        ${midnightPct !== null ? `<div class="gantt-midnight-line" style="left:${midnightPct.toFixed(1)}%;" title="00:00 TCT Rollover"></div>` : ''}
                        <div class="gantt-pill ${cls}" style="left:0%; width:${widthPct.toFixed(1)}%;" title="${escapeHtml(c.name)}: ${escapeHtml(barText)}">${escapeHtml(barText)}</div>
                    </div>
                </div>`;
        }).join('');

        body.innerHTML = `
            <div class="gantt-axis">
                <span>Active Crime (&le;${ganttWindowHours}h)</span>
                <div class="gantt-ticks">
                    ${ticks.map(t => `<span>${t}</span>`).join('')}
                    ${midnightPct !== null ? `<span class="gantt-midnight-badge" style="left:${midnightPct.toFixed(1)}%;">00:00 TCT</span>` : ''}
                </div>
            </div>
            ${rowsHtml}`;
    }

    window.setGanttWindow = function (hrs) {
        ganttWindowHours = hrs === 72 ? 72 : 24;
        localStorage.setItem(STORAGE_GANTT_HOURS_KEY, String(ganttWindowHours));
        document.getElementById('gantt-btn-24')?.classList.toggle('active', ganttWindowHours === 24);
        document.getElementById('gantt-btn-72')?.classList.toggle('active', ganttWindowHours === 72);
        renderTimelineGantt();
    };

    window.toggleGanttCollapse = function () {
        ganttCollapsed = !ganttCollapsed;
        localStorage.setItem('sv_oc_gantt_collapsed', String(ganttCollapsed));
        renderTimelineGantt();
    };

    function renderBoardCrimesOnly() {
        const container = document.getElementById('oc-container');
        if (!container) return;
        const all = analytics.activeAnnotated || [];
        const nowSec = Math.floor(Date.now() / 1000);

        const counts = {
            all: all.length,
            recruiting: all.filter(c => c.phase === 'recruiting').length,
            planning: all.filter(c => c.phase === 'planning').length,
            ready: all.filter(c => c.phase === 'ready').length,
            blocked: all.filter(c => c.needsAttention).length
        };

        document.getElementById('tab-all').textContent = `All Active (${counts.all})`;
        document.getElementById('tab-recruiting').textContent = `Recruiting (${counts.recruiting})`;
        document.getElementById('tab-planning').textContent = `Planning (${counts.planning})`;
        document.getElementById('tab-ready').textContent = `✅ Ready (${counts.ready})`;
        document.getElementById('tab-blocked').textContent = `⚠️ Needs Attention (${counts.blocked})`;

        const q = (document.getElementById('oc-search-input')?.value || '').toLowerCase().trim();
        const tierFlt = document.getElementById('oc-tier-filter')?.value || 'all';
        const sortBy = document.getElementById('oc-sort-select')?.value || 'soonest';

        const list = all.filter(c => {
            if (currentBoardTab === 'blocked') { if (!c.needsAttention) return false; }
            else if (currentBoardTab !== 'all') { if (c.phase !== currentBoardTab) return false; }
            if (safePreWarOnly && c.warOverlap) return false;
            if (tierFlt === '1-2' && c.tier > 2) return false;
            if (tierFlt === '3-4' && (c.tier < 3 || c.tier > 4)) return false;
            if (tierFlt === '5+' && c.tier < 5) return false;
            if (q) {
                const hay = [c.name, String(c.id), ...(c.slots || []).map(s => `${s.position} ${s.position_info?.label || ''} ${s.user?.name || ''} ${s.user?.id || ''}`)].join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        list.sort((a, b) => {
            if (sortBy === 'tier') return b.tier - a.tier || a.projectedEndSec - b.projectedEndSec;
            if (sortBy === 'ev') return b.estCash - a.estCash;
            if (sortBy === 'openslots') return b.emptySlots - a.emptySlots || b.tier - a.tier;
            const orderA = a.phase === 'ready' ? 0 : (a.phase === 'planning' ? 1 : 2);
            const orderB = b.phase === 'ready' ? 0 : (b.phase === 'planning' ? 1 : 2);
            return orderA !== orderB ? orderA - orderB : a.projectedEndSec - b.projectedEndSec;
        });

        if (!list.length) {
            container.innerHTML = '<div class="oc-glass-panel" style="text-align:center; padding:32px; color:var(--text-tertiary);">No matching Organized Crimes for current filter.</div>';
            return;
        }
        container.innerHTML = list.map(crime => renderSingleCrimeCard(crime, nowSec)).join('');
    }

    function renderSingleCrimeCard(c, nowSec) {
        const cardId = `crime-${c.id}`;
        const isOpen = openCrimeIds.has(cardId) || openCrimeIds.size === 0;
        if (openCrimeIds.size === 0) openCrimeIds.add(cardId);

        let cardCls = `oc-card ${c.phase}`;
        if (c.isLaunchBlocked) cardCls += ' blocked-card';
        else if (c.isHostageStall || c.isInactiveStall) cardCls += ' stall-card';

        const statusPill = c.phase === 'ready'
            ? `<span class="status-pill pill-ready">✅ READY TO LAUNCH</span>`
            : (c.phase === 'planning'
                ? `<span class="status-pill pill-planning">⏳ PLANNING</span>`
                : `<span class="status-pill pill-recruiting">👥 RECRUITING (${c.emptySlots} OPEN)</span>`);

        let timerHtml = '';
        if (c.phase === 'ready') {
            const idleStr = c.wastedReadinessSec > 0 ? `<span data-idle-since="${c.ready_at}" style="color:${c.wastedReadinessSec > 7200 ? '#fb7185' : '#fbbf24'};">Idling ${formatDurationShort(c.wastedReadinessSec)}</span>` : 'Launch Now';
            timerHtml = `<div class="timer-block"><div class="timer-big" style="color:#34d399;">READY!</div><div class="timer-label">${idleStr}</div></div>`;
        } else if (c.phase === 'planning' && c.ready_at) {
            timerHtml = `<div class="timer-block"><div class="timer-big" style="color:#38bdf8;" data-ready="${c.ready_at}">${formatCountdown(Math.max(0, c.ready_at - nowSec))}</div><div class="timer-label">Until Ready (${formatTctClock(c.ready_at)})</div></div>`;
        } else if (c.expired_at) {
            timerHtml = `<div class="timer-block"><div class="timer-big" style="color:#fbbf24;" data-expired="${c.expired_at}">${formatCountdown(Math.max(0, c.expired_at - nowSec))}</div><div class="timer-label">Recruit Window Left</div></div>`;
        }

        const bannerParts = [];
        if (c.isLaunchBlocked) {
            const bNames = c.blockedCrew.map(b => `${escapeHtml(b.name)} (${escapeHtml(b.label)})`).join(', ');
            bannerParts.push(`<div class="oc-readiness-banner blocked"><span>🔴 <strong>LAUNCH BLOCKED (ETA: ${formatDurationShort(c.allClearEtaSec)})</strong> — ${bNames}</span><button class="oc-action-btn" onclick="event.stopPropagation(); copyBlockerPing('${c.id}')" style="padding:4px 9px;">🔔 Copy Blocker Ping</button></div>`);
        } else if (c.phase === 'ready' || (c.phase === 'planning' && c.ready_at && (c.ready_at - nowSec) <= 7200)) {
            bannerParts.push(`<div class="oc-readiness-banner clear"><span>🟢 ALL CREW OKAY IN TORN — ${c.phase === 'ready' ? 'READY TO INITIATE' : 'CLEAR FOR IMMINENT COMPLETION'}</span>${c.phase === 'ready' ? `<button class="oc-action-btn primary" onclick="event.stopPropagation(); pingReadyOC('${c.id}', this)" style="padding:4px 9px;">📢 Send Ready Discord Ping</button>` : ''}</div>`);
        }
        if (c.isHostageStall || c.isInactiveStall) {
            const stallMsg = c.isHostageStall
                ? `⚠️ STALL ALERT: ${c.filledSlots} Crew Waiting ${c.waitHours}h for ${c.emptySlots} Open Slot(s)`
                : `⚠️ STALL ALERT: ${c.inactiveCrew.map(x => `${escapeHtml(x.name)} Offline ${x.offlineHours}h`).join(', ')}`;
            bannerParts.push(`<div class="oc-readiness-banner stall"><span>${stallMsg}</span><button class="oc-action-btn" onclick="event.stopPropagation(); toggleStallPopover('${c.id}')" style="padding:4px 9px;">🔄 Suggest 3 Ready Replacements</button></div><div id="stall-pop-${c.id}" style="display:none; padding:10px 18px; background:rgba(10,15,28,0.95); border-bottom:1px solid var(--oc-border-cyan); font-size:0.8em;"></div>`);
        }
        if (c.warOverlap) {
            bannerParts.push(`<div class="oc-readiness-banner stall"><span>⚔️ <strong>War Window Overlap</strong> — Completes during Ranked War window (${formatTctDate(c.projectedEndSec)} ${formatTctClock(c.projectedEndSec)}). Verify availability.</span></div>`);
        }

        const slotsRows = (c.slots || []).map((slot, sIdx) => {
            const roleLabel = slot.position_info?.label || slot.position || 'Operative';
            const rawRole = normalizeRoleName(slot.position || roleLabel);
            const cpr = Number(slot.checkpoint_pass_rate || 0);
            const item = slot.item_requirement;

            let itemHtml = '<span style="color:var(--text-tertiary);">None</span>';
            if (item) {
                const iName = escapeHtml(item.name || `Item #${item.id}`);
                const iCost = Number(item.market_value || 0);
                if (item.is_available) {
                    const keepTag = item.is_reusable ? '🛡️ Reusable Tool (Kept)' : '🔥 1x Consumed';
                    itemHtml = `<span class="item-pill supplied" title="${keepTag}">🛠️ ${iName} ✓ Supplied</span>`;
                } else {
                    const armAvail = item.armory_available !== null && item.armory_available !== undefined ? `Armory: ${item.armory_available}` : 'Armory';
                    const isAssigned = Boolean(slot.user);
                    itemHtml = `
                        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                            <span class="item-pill ${isAssigned ? 'missing' : 'supplied'}" ${isAssigned ? '' : 'style="background:rgba(245,158,11,0.1); border-color:rgba(245,158,11,0.35); color:#fde68a;"'}>${isAssigned ? '⚠️ Missing' : '🛠️ Needs'} ${iName} (~${fmtCompactMoney(iCost)})</span>
                            <a class="mini-icon-btn" href="https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${item.id}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">🛒</a>
                            <button class="mini-icon-btn" onclick="event.stopPropagation(); checkArmoryStockToast('${item.id}', '${escapeHtml(iName)}', ${iCost})">📦 ${armAvail}</button>
                        </div>`;
                }
            }

            if (!slot.user) {
                const stagedForSlot = stagedAssignments.find(st => String(st.crimeId) === String(c.id) && Number(st.slotIdx) === sIdx);
                const fit = slot._suggestedFit;
                const fitHtml = stagedForSlot
                    ? `<span class="status-pill pill-staged">📌 Staged: <strong>${escapeHtml(stagedForSlot.playerName)}</strong> (${stagedForSlot.cpr}% ${escapeHtml(rawRole)} [Exact])</span>`
                    : (fit
                        ? `<span class="status-pill" style="background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.4); color:#7dd3fc;">✨ Best Fit: <strong>${escapeHtml(fit.name)}</strong> (${escapeHtml(fit.dropdownLabel)})</span>`
                        : `<span style="color:var(--text-tertiary); font-style:italic;">OPEN SLOT — Awaiting operative</span>`);
                return `
                    <tr>
                        <td><strong>${escapeHtml(roleLabel)}</strong></td>
                        <td>${fitHtml}</td>
                        <td><span class="cpr-badge" style="color:var(--text-tertiary); border:1px dashed var(--border-subtle);">Floor ${c.floor}%</span></td>
                        <td>${itemHtml}</td>
                        <td><span style="color:var(--text-tertiary);">0%</span></td>
                    </tr>`;
            }

            const blk = slot._liveBlocker || getMemberLiveBlocker(slot.user, nowSec);
            const prog = Number(slot.user.progress ?? (c.phase === 'ready' ? 100 : 0)).toFixed(0);
            const isBottleneck = cpr > 0 && cpr < 65;

            // Real Tool #2: Pulsing Bottleneck Swapper Badge inside slot row for <65% CPR
            const cprCellHtml = isBottleneck
                ? `<button type="button" class="cpr-badge cpr-risk" onclick="event.stopPropagation(); toggleBottleneckSwapper('${c.id}', ${sIdx})" title="Click to inspect faction members with higher ${escapeHtml(rawRole)} CPR">⚠️ ${cpr}% Bottleneck — Find Upgrade</button>`
                : `<span class="cpr-badge ${getCprBadgeClass(cpr, c.floor)}" title="Tier ${c.tier} Floor: ${c.floor}%">${cpr}% ${escapeHtml(rawRole)}</span>`;

            return `
                <tr>
                    <td><strong>${escapeHtml(roleLabel)}</strong></td>
                    <td>
                        <div style="display:flex; align-items:center; gap:7px; flex-wrap:wrap;">
                            <a href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(slot.user.id)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="color:var(--text-primary); font-weight:800; text-decoration:none;">${escapeHtml(slot.user.name || `ID:${slot.user.id}`)}</a>
                            <span style="font-size:0.84em; color:var(--text-tertiary); font-family:var(--font-mono);">Lv ${slot.user.level || '?'}</span>
                            <span class="status-pill" style="padding:2px 7px; font-size:0.8em; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1);">${blk.label}</span>
                        </div>
                    </td>
                    <td>${cprCellHtml}</td>
                    <td>${itemHtml}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div class="oc-progress-mini"><div class="oc-progress-fill" style="width:${prog}%;"></div></div>
                            <span class="font-mono" style="font-size:0.85em; color:var(--text-secondary);">${prog}%</span>
                        </div>
                    </td>
                </tr>
                ${isBottleneck ? `<tr id="bn-row-${c.id}-${sIdx}" style="display:none;"><td colspan="5" id="bn-cell-${c.id}-${sIdx}" style="background:rgba(244,63,94,0.06); padding:10px 14px;"></td></tr>` : ''}`;
        }).join('');

        return `
            <div class="${cardCls}${isOpen ? ' open' : ''}" id="${cardId}">
                <div class="oc-header" onclick="toggleOcCard('${cardId}')">
                    <div class="oc-title-block">
                        <div class="oc-thumbnail">${getCrimeEmoji(c.name)}</div>
                        <div>
                            <div class="oc-name">${escapeHtml(c.name || 'Organized Crime')}</div>
                            <div class="oc-meta">
                                <span class="diff-badge">TIER ${c.tier}</span>
                                <span class="slots-badge">#${c.id} • ${c.filledSlots}/${c.totalSlots} Slots</span>
                                <span class="diff-badge" style="background:rgba(16,185,129,0.12); color:#6ee7b7; border-color:rgba(16,185,129,0.35);">Team Pass ${c.teamPassProb}% (Avg ${c.avgCpr}%)</span>
                                <span class="diff-badge" style="background:rgba(245,158,11,0.12); color:#fcd34d; border-color:rgba(245,158,11,0.35);">Est. ${fmtCompactMoney(c.estCash)} • +${c.estRespect} Resp</span>
                            </div>
                        </div>
                    </div>
                    <div class="oc-header-right">${timerHtml}${statusPill}<span class="collapse-arrow">▼</span></div>
                </div>
                ${bannerParts.join('')}
                <div class="oc-body" style="display:${isOpen ? 'block' : 'none'};">
                    <div class="slot-table-wrap">
                        <table class="oc-slot-table">
                            <thead><tr><th>Role Slot</th><th>Operative / Live Status</th><th>Role CPR %</th><th>Required Gear</th><th>Progress</th></tr></thead>
                            <tbody>${slotsRows}</tbody>
                        </table>
                    </div>
                </div>
                <div class="oc-card-footer">
                    <div style="font-size:0.74em; color:var(--text-tertiary); font-family:var(--font-mono);">Stage Target: ${c.ready_at ? `${formatTctClock(c.ready_at)} (${formatTctDate(c.ready_at)})` : 'Awaiting full crew'}</div>
                    <div class="oc-footer-actions">
                        <button class="oc-action-btn" onclick="openInSimulator('${c.id}')">🧪 Simulate Swap</button>
                        <button class="oc-action-btn" onclick="openInPayoutCalc('${c.id}')">💰 Preview Payout Split</button>
                        <button class="oc-action-btn" onclick="openBroadcastModal('${c.id}')">📢 Copy Slot Ping</button>
                        <a class="oc-action-btn primary" href="https://www.torn.com/factions.php?step=your#/tab=crimes" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">🔗 Open in Torn ↗</a>
                    </div>
                </div>
            </div>`;
    }

    // Real Tool #2 Handler: Danger-Slot Bottleneck Upgrade Popover
    window.toggleBottleneckSwapper = function (crimeId, slotIdx) {
        const row = document.getElementById(`bn-row-${crimeId}-${slotIdx}`);
        const cell = document.getElementById(`bn-cell-${crimeId}-${slotIdx}`);
        if (!row || !cell) return;
        if (row.style.display !== 'none') {
            row.style.display = 'none';
            return;
        }
        const c = analytics.activeAnnotated.find(x => String(x.id) === String(crimeId));
        if (!c || !c.slots[slotIdx]?.user) return;
        const slot = c.slots[slotIdx];
        const rawRole = normalizeRoleName(slot.position || slot.position_info?.label);
        const curCpr = Number(slot.checkpoint_pass_rate || 0);
        const curProb = computeTeamSuccessProb(c.slots.filter(s => s.user).map(s => ({ cpr: s.checkpoint_pass_rate || 50, needsItem: Boolean(s.item_requirement), hasItem: Boolean(s.item_requirement?.is_available ?? true) })));

        // Find all faction members with higher role-specific CPR
        const candidates = [];
        Object.values(cmdData.members || {}).forEach(m => {
            if (String(m.id) === String(slot.user.id)) return;
            const info = getMemberRoleCPR(m.id, rawRole, c.tier);
            if (info.cpr <= curCpr) return;
            // Compute team Pass Probability if swapped into this slot
            const simSlots = c.slots.filter(s => s.user).map((s, idx2) => {
                if (s === slot) return { cpr: info.cpr, needsItem: Boolean(s.item_requirement), hasItem: true };
                return { cpr: s.checkpoint_pass_rate || 50, needsItem: Boolean(s.item_requirement), hasItem: Boolean(s.item_requirement?.is_available ?? true) };
            });
            const newProb = computeTeamSuccessProb(simSlots);
            const delta = Number((newProb - curProb).toFixed(1));
            const prof = analytics.memberProfileMap.get(String(m.id));
            const whereTxt = !prof?.inActiveOc ? '🟢 Unassigned on Bench' : (prof.activeOcPhase === 'recruiting' ? `🟡 In Recruiting (${prof.activeOcName})` : `⏳ In ${prof.activeOcPhase} (${prof.activeOcName})`);
            candidates.push({ m, info, delta, whereTxt, isBench: !prof?.inActiveOc, isRecruiting: prof?.activeOcPhase === 'recruiting' });
        });

        candidates.sort((a, b) => (Number(b.isBench) - Number(a.isBench)) || (b.info.cpr - a.info.cpr));
        const top = candidates.slice(0, 6);

        row.style.display = 'table-row';
        cell.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:7px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <strong style="color:#fda4af;">⚠️ Higher-CPR Upgrades for ${escapeHtml(rawRole)} (Currently ${escapeHtml(slot.user.name)} at ${curCpr}% • Team Pass ${curProb}%)</strong>
                    <button class="oc-action-btn" onclick="openInSimulator('${c.id}')" style="padding:3px 9px;">🧪 Test in Simulator</button>
                </div>
                ${top.length ? top.map(x => {
                    const pingMsg = `🔄 Swap Upgrade for **${c.name} [T${c.tier}] — ${rawRole}**: @${x.m.name} [${x.m.id}] (${x.info.cpr}% ${rawRole}) to replace @${slot.user.name} (${curCpr}%) → +${x.delta}% Team Pass Chance!`;
                    return `<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding:6px 10px; background:rgba(15,23,42,0.85); border:1px solid var(--oc-border-cyan); border-radius:7px; font-size:0.9em;">
                        <div>
                            <strong>${escapeHtml(x.m.name)}</strong> <span style="color:var(--text-tertiary);">[${x.m.id}]</span>
                            <span style="margin-left:8px; color:var(--text-secondary);">${x.whereTxt}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span class="cpr-badge ${getCprBadgeClass(x.info.cpr, c.floor)}">${escapeHtml(x.info.dropdownLabel)}</span>
                            <span class="font-mono" style="color:#34d399; font-weight:800;">+${x.delta}% Pass Chance</span>
                            <button class="mini-icon-btn" onclick="copyTextMsg('${encodeURIComponent(pingMsg)}')">📋 Copy Swap Ping</button>
                        </div>
                    </div>`;
                }).join('') : '<div style="color:var(--text-tertiary);">No other faction member currently has a higher recorded CPR for this role.</div>'}
            </div>`;
    };

    window.copyTextMsg = function (enc) {
        copyText(decodeURIComponent(enc), '✅ Copied to clipboard!');
    };

    window.toggleOcCard = function (id) {
        const card = document.getElementById(id);
        if (!card) return;
        const body = card.querySelector('.oc-body');
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        card.classList.toggle('open', !isOpen);
        if (!isOpen) openCrimeIds.add(id);
        else openCrimeIds.delete(id);
    };

    window.checkArmoryStockToast = function (itemId, itemName, marketVal) {
        const stock = (cmdData.armoryStock || {})[String(itemId)];
        if (stock) showOcToast(`📦 Armory Stock for ${itemName}: ${stock.available} available (${stock.total} total) • Market ~${fmtMoney(marketVal)}`);
        else showOcToast(`📦 ${itemName}: Not found in Armory utilities/tools • Est. Market ${fmtMoney(marketVal)}`);
    };

    window.toggleStallPopover = function (crimeId) {
        const pop = document.getElementById(`stall-pop-${crimeId}`);
        if (!pop) return;
        if (pop.style.display !== 'none') { pop.style.display = 'none'; return; }
        const crime = analytics.activeAnnotated.find(x => String(x.id) === String(crimeId));
        if (!crime) return;
        const top3 = analytics.bench.available.slice(0, 3);
        const pingTxt = top3.length
            ? `🔄 Urgent OC backup needed for **${crime.name} [T${crime.tier}]**: ${top3.map(m => `@${m.name} [${m.id}]`).join(', ')} — open slots waiting in Faction Crimes!`
            : 'No available bench members online right now.';
        pop.style.display = 'block';
        pop.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;"><div><strong style="color:#38bdf8;">Top 3 Ready Bench Replacements:</strong> ${top3.map(m => `<span class="diff-badge" style="margin-left:5px;">${escapeHtml(m.name)} (Lv ${m.level})</span>`).join('') || 'None'}</div><button class="oc-action-btn primary" onclick="copyTextMsg('${encodeURIComponent(pingTxt)}')" style="padding:4px 10px;">📋 Copy Replacement Ping</button></div>`;
    };

    window.copyBlockerPing = function (crimeId) {
        const c = analytics.activeAnnotated.find(x => String(x.id) === String(crimeId));
        if (!c) return;
        const lines = c.blockedCrew.map(b => `@${b.name} [${b.id}] (${b.detail})`).join(', ');
        copyText(`🚨 **OC Launch Waiting [${c.name} T${c.tier}]** — ETA ${formatDurationShort(c.allClearEtaSec)}. Unavailable: ${lines}. https://www.torn.com/factions.php?step=your#/tab=crimes`, `✅ Blocker ping copied for ${c.name}!`);
    };

    window.pingReadyOC = async function (crimeId, btnEl) {
        const c = analytics.activeAnnotated.find(x => String(x.id) === String(crimeId));
        if (!c) return;
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Sending...'; }
        try {
            const participants = (c.slots || []).map(s => s.user ? { id: s.user.id, name: s.user.name, position: s.position_info?.label || s.position } : null).filter(Boolean);
            const res = await fetch('/api/oc-ping', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ crimeId: c.id, crimeName: c.name, difficulty: c.tier, rewardCash: c.estCash, participants })
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Discord ping failed');
            if (btnEl) btnEl.textContent = '✅ Pinged!';
            showOcToast(`📢 Discord launch ping sent for ${c.name}`);
        } catch (e) {
            if (btnEl) { btnEl.disabled = false; btnEl.textContent = '❌ Retry Ping'; }
            showOcToast(`Discord ping error: ${e.message}`);
        }
    };

    // ─── WORKSPACE 2 (#workbench): Stateful Crew Builder & What-If Simulator ───
    function saveStagedAssignments() {
        try { localStorage.setItem(STORAGE_STAGED_KEY, JSON.stringify(stagedAssignments)); } catch (_) {}
    }

    function renderWorkbenchView() {
        renderQueueOptimizerCard('workbench-queue-banner', false);
        const fLow = document.getElementById('floor-disp-low');
        const fHigh = document.getElementById('floor-disp-high');
        if (fLow) fLow.textContent = `${cprFloors.low}%`;
        if (fHigh) fHigh.textContent = `${cprFloors.high}%`;

        populateSimulatorSelect();
        renderWorkbenchOpenSlots();
        renderWorkbenchBenchGrid();
        renderStagedCart();
    }

    function renderWorkbenchOpenSlots() {
        const el = document.getElementById('wb-open-slots-list');
        if (!el) return;
        const slots = analytics.openSlotMatches;
        if (!slots.length) {
            el.innerHTML = '<div style="padding:14px; color:var(--text-tertiary); font-size:0.8em;">No open Recruiting role slots right now.</div>';
            return;
        }
        el.innerHTML = slots.map(os => {
            const staged = stagedAssignments.find(st => String(st.crimeId) === String(os.crimeId) && Number(st.slotIdx) === os.slotIdx);
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 10px; background:rgba(10,15,28,0.82); border:1px solid ${staged ? 'rgba(56,189,248,0.5)' : 'var(--oc-border-cyan)'}; border-radius:8px; font-size:0.79em;">
                    <div>
                        <strong style="color:#38bdf8;">[T${os.tier}]</strong> <strong>${escapeHtml(os.crimeName)}</strong> (#${os.crimeId})
                        <div style="color:var(--text-secondary);">Slot #${os.slotIdx + 1}: <strong>${escapeHtml(os.role)}</strong> • Floor ${os.floor}%</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        ${staged
                            ? `<span class="status-pill pill-staged">📌 ${escapeHtml(staged.playerName)} (${staged.cpr}%)</span><button class="mini-icon-btn" onclick="unstageMember('${staged.playerId}')">✕</button>`
                            : (os.matched ? `<button class="mini-icon-btn" onclick="stageAssignment('${os.matched.id}', '${os.crimeId}', ${os.slotIdx})">📌 Stage ${escapeHtml(os.matched.name)} (${os.cpr}%)</button>` : '<span style="color:var(--text-tertiary);">No free bench left</span>')}
                        <button class="mini-icon-btn" onclick="loadSimCrime('active:${os.crimeId}')">🧪 Sim</button>
                    </div>
                </div>`;
        }).join('');
    }

    function renderWorkbenchBenchGrid() {
        const b = analytics.bench;
        document.getElementById('bench-tab-all').textContent = `All (${b.all.length})`;
        document.getElementById('bench-tab-available').textContent = `🟢 Available (${b.available.length})`;
        document.getElementById('bench-tab-blocked').textContent = `🟡 Blocked (${b.blocked.length})`;
        document.getElementById('bench-tab-inactive').textContent = `⚫ Inactive (${b.inactive.length})`;

        const q = (document.getElementById('bench-search-input')?.value || '').toLowerCase().trim();
        const pool = (b[benchBucket] || b.all).filter(m => !q || m.name.toLowerCase().includes(q) || String(m.id).includes(q));
        const grid = document.getElementById('bench-cards-container');
        if (!grid) return;

        if (!pool.length) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:24px; color:var(--text-tertiary);">No unassigned bench members match filter.</div>';
            return;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const stagedCrimeSlotSet = new Set(stagedAssignments.map(st => `${st.crimeId}::${st.slotIdx}`));

        grid.innerHTML = pool.map(m => {
            const staged = stagedAssignments.find(st => String(st.playerId) === String(m.id));
            const untilTs = Number(m.status?.until || 0);
            let stPill = '';
            if (m.bucket === 'available') stPill = '<span class="status-pill pill-ready">🟢 Available Now</span>';
            else if (m.bucket === 'blocked') {
                const isTimerState = (m.blocker.code === 'Hospital' || m.blocker.code === 'Jail') && untilTs > nowSec;
                const prefix = m.blocker.code === 'Hospital' ? '🏥 Hosp' : '⛓️ Jail';
                stPill = isTimerState
                    ? `<span class="status-pill pill-recruiting">${prefix} <span data-until="${untilTs}">${formatDurationShort(untilTs - nowSec)}</span></span>`
                    : `<span class="status-pill pill-recruiting">${escapeHtml(m.blocker.label)}</span>`;
            } else stPill = `<span class="status-pill" style="background:rgba(148,163,184,0.14); color:#94a3b8;">⚫ ${escapeHtml(m.exemptReason)}</span>`;

            // Top 3 Strongest Roles as crisp pills (no misleading generic ~XX% number!)
            const rolesHtml = m.topRoles.length
                ? m.topRoles.map(r => `<span class="cpr-badge ${getCprBadgeClass(r.cpr, 70)}" style="font-size:0.72em; padding:2px 6px;">${escapeHtml(r.role)} ${r.cpr}%</span>`).join('')
                : '<span style="font-size:0.74em; color:var(--text-tertiary);">No role CPRs recorded yet</span>';

            const openSlotOptions = analytics.openSlotMatches
                .filter(os => !stagedCrimeSlotSet.has(`${os.crimeId}::${os.slotIdx}`))
                .map(os => {
                    const info = getMemberRoleCPR(m.id, os.rawRole, os.tier);
                    return `<option value="${os.crimeId}::${os.slotIdx}">[T${os.tier}] ${escapeHtml(os.crimeName)} — ${escapeHtml(os.role)} (${escapeHtml(info.dropdownLabel)})</option>`;
                }).join('');

            return `
                <div class="bench-card ${staged ? 'is-staged' : ''}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                        <div style="min-width:0;">
                            <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" rel="noopener noreferrer" style="font-weight:900; color:var(--text-primary); text-decoration:none; font-size:0.96em;">${escapeHtml(m.name)}</a>
                            <div style="font-size:0.74em; color:var(--text-tertiary); font-family:var(--font-mono); margin-top:2px;">Lv ${m.level} • ID [${m.id}]</div>
                        </div>
                        ${stPill}
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:0.74em; color:var(--text-secondary);">
                        <span>Active: ${formatRelativeSec(m.last_action?.timestamp, nowSec)}</span>
                        <span>Last OC: ${m.daysSinceLastOc !== null ? `${m.daysSinceLastOc}d ago` : 'Never'}</span>
                    </div>
                    <div style="display:flex; gap:5px; flex-wrap:wrap;">${rolesHtml}</div>
                    ${staged ? `
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding-top:4px;">
                            <span class="status-pill pill-staged" style="font-size:0.74em; white-space:normal;">📌 Staged for [T${staged.tier} ${escapeHtml(staged.crimeName)} — ${escapeHtml(staged.role)}]</span>
                            <button class="mini-icon-btn" onclick="unstageMember('${m.id}')">Unstage</button>
                        </div>` : `
                        <select class="oc-select" style="width:100%; font-size:0.78em; padding:5px 8px;" onchange="stageFromDropdown('${m.id}', this.value, this)">
                            <option value="">+ Stage into Open Recruiting Slot...</option>
                            ${openSlotOptions}
                        </select>`}
                </div>`;
        }).join('');
    }

    function renderStagedCart() {
        const cntEl = document.getElementById('staged-cart-count');
        const listEl = document.getElementById('staged-cart-list');
        if (cntEl) cntEl.textContent = String(stagedAssignments.length);
        if (!listEl) return;

        if (!stagedAssignments.length) {
            listEl.innerHTML = '<div style="font-size:0.78em; color:var(--text-tertiary);">No assignments staged yet. Stage a member from a Bench Card, Simulator, or click Auto-Stage Best Fills.</div>';
            return;
        }
        listEl.innerHTML = stagedAssignments.map(st => `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:7px 10px; background:rgba(15,23,42,0.85); border:1px solid rgba(56,189,248,0.28); border-radius:7px; font-size:0.79em;">
                <div>
                    <strong>${escapeHtml(st.playerName)}</strong> <span style="color:var(--text-tertiary);">[${st.playerId}]</span>
                    → <strong style="color:#38bdf8;">[T${st.tier}] ${escapeHtml(st.crimeName)}</strong> (${escapeHtml(st.role)} • <strong>${st.cpr}%</strong>)
                </div>
                <button class="mini-icon-btn" onclick="unstageMember('${st.playerId}')">✕ Remove</button>
            </div>`).join('');
    }

    window.setBenchBucket = function (bucket) {
        benchBucket = bucket;
        document.querySelectorAll('#bench-bucket-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.id === `bench-tab-${bucket}`));
        renderWorkbenchBenchGrid();
    };

    window.stageAssignment = function (playerId, crimeId, slotIdx) {
        const m = cmdData.members[String(playerId)];
        const c = analytics.activeAnnotated.find(x => String(x.id) === String(crimeId));
        if (!m || !c || !c.slots[slotIdx]) return;
        const slot = c.slots[slotIdx];
        const roleLabel = slot.position_info?.label || slot.position || 'Operative';
        const rawRole = normalizeRoleName(slot.position || roleLabel);
        const cprInfo = getMemberRoleCPR(m.id, rawRole, c.tier);

        // Enforce no double-booking (remove any previous staging of same member or same slot)
        stagedAssignments = stagedAssignments.filter(st => String(st.playerId) !== String(m.id) && !(String(st.crimeId) === String(c.id) && Number(st.slotIdx) === Number(slotIdx)));
        stagedAssignments.push({
            playerId: Number(m.id), playerName: m.name, crimeId: c.id, crimeName: c.name, tier: c.tier,
            slotIdx: Number(slotIdx), role: roleLabel, rawRole, cpr: cprInfo.cpr, tag: cprInfo.tag
        });
        saveStagedAssignments();
        showOcToast(`📌 Staged ${m.name} → [T${c.tier}] ${c.name} (${roleLabel} ${cprInfo.cpr}%)`);
        renderWorkbenchOpenSlots();
        renderWorkbenchBenchGrid();
        renderStagedCart();
    };

    window.stageFromDropdown = function (playerId, val, selEl) {
        if (!val) return;
        const [crimeId, slotIdxStr] = val.split('::');
        window.stageAssignment(playerId, crimeId, Number(slotIdxStr));
        if (selEl) selEl.value = '';
    };

    window.unstageMember = function (playerId) {
        stagedAssignments = stagedAssignments.filter(st => String(st.playerId) !== String(playerId));
        saveStagedAssignments();
        renderWorkbenchOpenSlots();
        renderWorkbenchBenchGrid();
        renderStagedCart();
    };

    window.clearStagedAssignments = function () {
        stagedAssignments = [];
        saveStagedAssignments();
        renderWorkbenchOpenSlots();
        renderWorkbenchBenchGrid();
        renderStagedCart();
        showOcToast('↺ Cleared staged assignments');
    };

    window.autoStageBestFills = function (jumpToWorkbench = false) {
        const pairs = analytics.queuePlan.autoFillPairs || [];
        if (!pairs.length) return showOcToast('⚠️ No assignable available bench pairs found.');
        stagedAssignments = pairs.map(p => ({
            playerId: Number(p.playerId), playerName: p.playerName, crimeId: p.crimeId, crimeName: p.crimeName,
            tier: p.tier, slotIdx: p.slotIdx, role: p.role, rawRole: p.rawRole, cpr: p.cpr, tag: p.cprInfo?.tag || '[Exact]'
        }));
        saveStagedAssignments();
        if (jumpToWorkbench && currentView !== 'workbench') window.switchOcView('workbench');
        else renderWorkbenchView();
        showOcToast(`⚡ Auto-staged best ${stagedAssignments.length} bench fill(s)!`);
    };

    window.copyAllStagedToDiscordAndTorn = function () {
        if (!stagedAssignments.length) return showOcToast('No staged assignments in cart to copy.');
        const discordLines = stagedAssignments.map(st => `• **${st.playerName} [${st.playerId}]** → **[T${st.tier}] ${st.crimeName}** (*${st.role}* • ${st.cpr}%)`).join('\n');
        const tornLine = stagedAssignments.map(st => `${st.playerName}->${st.crimeName}(${st.role})`).join(' | ');
        const msg = `📋 **OC Crew Assignment Orders**\n${discordLines}\n\n**Compact Torn Chat Line:**\nJoin OCs: ${tornLine}\n👉 https://www.torn.com/factions.php?step=your#/tab=crimes`;
        copyText(msg, `📢 Copied all ${stagedAssignments.length} staged assignments for Discord & Torn Chat!`);
    };

    window.copyAvailableBenchPings = function () {
        const list = analytics.bench.available;
        if (!list.length) return showOcToast('🟢 All active faction members are already assigned to an OC!');
        const msg = `📢 **Unassigned Active Members (${list.length}) — Please Join an Open OC:**\n` +
            list.map((m, i) => `${i + 1}. @${m.name} [${m.id}]${m.topRoles.length ? ` — Top: ${m.topRoles.map(r => `${r.role} ${r.cpr}%`).join(', ')}` : ''}`).join('\n') +
            `\n👉 https://www.torn.com/factions.php?step=your#/tab=crimes`;
        copyText(msg, `✅ Copied Discord pings for ${list.length} available bench members!`);
    };

    window.openTornMailToBench = function () {
        const list = analytics.bench.available;
        if (!list.length) return showOcToast('No available bench members to message.');
        copyText(list.map(m => `${m.name} [${m.id}]`).join(', '), `✅ Copied ${list.length} recipient(s) & opened Torn Mail!`);
        window.open(`https://www.torn.com/messages.php#/p=compose&XID=${encodeURIComponent(list[0].id)}`, '_blank', 'noopener,noreferrer');
    };

    // ─── What-If Crew Swap Simulator (Exact Per-Role CPR Dropdowns + Sliders Match 100%) ───
    function populateSimulatorSelect() {
        const sel = document.getElementById('sim-crime-select');
        if (!sel) return;
        const activeOpts = analytics.activeAnnotated.map(c => `<option value="active:${c.id}">[LIVE T${c.tier}] ${escapeHtml(c.name)} (#${c.id})</option>`);
        const catOpts = (cmdData.catalog || []).map(c => `<option value="cat:${escapeHtml(c.name)}">[T${c.difficulty} Blueprint] ${escapeHtml(c.name)} (${c.crewSize} crew)</option>`);
        sel.innerHTML = `${activeOpts.join('')}${catOpts.join('')}`;

        if (!simState.selectedKey) {
            if (analytics.activeAnnotated.length) loadSimCrime(`active:${analytics.activeAnnotated[0].id}`);
            else if (cmdData.catalog.length) loadSimCrime(`cat:${cmdData.catalog[0].name}`);
        } else {
            sel.value = simState.selectedKey;
            renderSimSandbox();
        }
    }

    window.openInSimulator = function (crimeId) {
        window.switchOcView('workbench');
        loadSimCrime(`active:${crimeId}`);
        setTimeout(() => document.getElementById('simulator-sandbox-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    };

    window.loadSimCrime = function (key) {
        simState.selectedKey = key;
        const sel = document.getElementById('sim-crime-select');
        if (sel) sel.value = key;

        if (key.startsWith('active:')) {
            const c = analytics.activeAnnotated.find(x => String(x.id) === key.slice(7));
            if (c) {
                simState.crimeName = c.name;
                simState.difficulty = c.tier;
                simState.planningDays = c.planDays;
                simState.estCash = c.estCash;
                simState.estRespect = c.estRespect;
                simState.liveRawSlots = c.slots || [];
                simState.slots = (c.slots || []).map(s => {
                    const rawRole = normalizeRoleName(s.position || s.position_info?.label);
                    const cprVal = s.user?.id
                        ? (Number(s.checkpoint_pass_rate || 0) || getMemberRoleCPR(s.user.id, rawRole, c.tier, c.slots, c.name).cpr)
                        : 70;
                    return {
                        role: s.position_info?.label || s.position || 'Operative',
                        rawRole,
                        playerId: s.user?.id || '',
                        cpr: cprVal,
                        hasItem: s.item_requirement ? Boolean(s.item_requirement.is_available) : true,
                        needsItem: Boolean(s.item_requirement),
                        itemName: s.item_requirement?.name || ''
                    };
                });
                simState.baselinePct = computeTeamSuccessProb(simState.slots);
                renderSimSandbox();
                return;
            }
        }
        const name = key.startsWith('cat:') ? key.slice(4) : key;
        const cat = (cmdData.catalog || []).find(x => normalizeCrimeName(x.name) === normalizeCrimeName(name)) || (cmdData.catalog || [])[0];
        if (cat) {
            simState.crimeName = cat.name;
            simState.difficulty = cat.difficulty;
            simState.planningDays = cat.planningDays;
            simState.estCash = (cat.estCash || 0) + (cat.estItemValue || 0);
            simState.estRespect = cat.estRespect;
            simState.liveRawSlots = null;
            simState.slots = (cat.roles || ['Operative']).map((r, idx) => ({
                role: r, rawRole: normalizeRoleName(r), playerId: '', cpr: 75, hasItem: true,
                needsItem: Boolean((cat.requiredItems || [])[idx]), itemName: (cat.requiredItems || [])[idx]?.name || ''
            }));
            simState.baselinePct = null;
        }
        renderSimSandbox();
    };

    function renderSimSandbox() {
        const listEl = document.getElementById('sim-slots-list');
        if (!listEl) return;
        const membersArr = Object.values(cmdData.members || {});

        listEl.innerHTML = simState.slots.map((s, idx) => {
            // Sort members for THIS specific role by exact/historical CPR descending so best role specialists are on top!
            const roleOptions = membersArr
                .map(m => ({ m, info: getMemberRoleCPR(m.id, s.rawRole, simState.difficulty, simState.liveRawSlots, simState.crimeName) }))
                .sort((a, b) => (Number(!a.info.isEstimated) - Number(!b.info.isEstimated)) || (b.info.cpr - a.info.cpr) || a.m.name.localeCompare(b.m.name))
                .map(({ m, info }) => `<option value="${m.id}">${escapeHtml(m.name)} (Lv ${m.level || 1} • ${escapeHtml(info.dropdownLabel)})</option>`)
                .join('');

            return `
                <div style="background:rgba(10,15,28,0.82); border:1px solid var(--oc-border-cyan); border-radius:9px; padding:10px 12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:7px;">
                        <strong>Slot #${idx + 1}: ${escapeHtml(s.role)}</strong>
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <button class="mini-icon-btn" onclick="simFindBestUnassignedFit(${idx})" title="Pick highest-${escapeHtml(s.rawRole)}-CPR unassigned bench operative">🔍 Find Best Unassigned Fit</button>
                            <select class="oc-select" style="max-width:295px; font-size:0.86em;" onchange="simPickMember(${idx}, this.value)">
                                <option value="">-- Custom / Unassigned --</option>
                                ${roleOptions}
                            </select>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:0.74em; color:var(--text-tertiary);">CPR:</span>
                        <input type="range" min="10" max="100" value="${s.cpr}" style="flex:1;" oninput="simSetSlotCpr(${idx}, this.value)">
                        <span class="cpr-badge ${getCprBadgeClass(s.cpr)}">${s.cpr}%</span>
                    </div>
                    ${s.needsItem ? `<label style="display:inline-flex; align-items:center; gap:6px; font-size:0.76em; margin-top:6px; cursor:pointer; color:var(--text-secondary);"><input type="checkbox" ${s.hasItem ? 'checked' : ''} onchange="simToggleSlotItem(${idx}, this.checked)"> <span>Item Ready: ${escapeHtml(s.itemName || 'Required Gear')}</span></label>` : ''}
                </div>`;
        }).join('');

        const selects = listEl.querySelectorAll('select');
        simState.slots.forEach((s, i) => { if (selects[i] && s.playerId) selects[i].value = String(s.playerId); });
        updateSimResultsOnly();
    }

    function updateSimResultsOnly() {
        const resEl = document.getElementById('sim-results-panel');
        if (!resEl) return;
        const prob = computeTeamSuccessProb(simState.slots);
        const failRisk = Number((100 - prob).toFixed(1));
        const critFailRisk = Number((failRisk * 0.42).toFixed(1));
        const expCash = Math.round(simState.estCash * (prob / 100));
        const expResp = Math.round(simState.estRespect * (prob / 100));
        const delta = simState.baselinePct !== null ? Number((prob - simState.baselinePct).toFixed(1)) : null;

        const r = 56, circ = 2 * Math.PI * r, offset = circ - (prob / 100) * circ;
        const strokeColor = prob >= 80 ? '#10b981' : (prob >= 65 ? '#06b6d4' : (prob >= 50 ? '#f59e0b' : '#f43f5e'));

        resEl.innerHTML = `
            <div style="font-size:0.76em; font-weight:800; color:var(--text-tertiary); text-transform:uppercase;">Live Team Success Probability</div>
            <div class="sim-gauge-wrap">
                <svg class="sim-gauge-svg" viewBox="0 0 144 144">
                    <circle cx="72" cy="72" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="11"/>
                    <circle cx="72" cy="72" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="11" stroke-linecap="round"
                        stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 72 72)"/>
                    <text x="72" y="69" text-anchor="middle" fill="#f8fafc" font-family="JetBrains Mono" font-size="24" font-weight="900">${prob}%</text>
                    <text x="72" y="88" text-anchor="middle" fill="#94a3b8" font-family="Inter" font-size="10" font-weight="700">PASS PROB</text>
                </svg>
                ${delta !== null ? `<div style="font-size:0.8em; font-weight:800; color:${delta >= 0 ? '#34d399' : '#fb7185'};">Delta vs Live Crew: ${delta >= 0 ? '+' : ''}${delta}%</div>` : ''}
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; text-align:left; font-size:0.78em;">
                <div class="oc-kpi-card" style="padding:8px;"><div class="oc-kpi-top">Jail / Crit Fail</div><div class="oc-kpi-val" style="font-size:1em; color:#fb7185;">${failRisk}% (${critFailRisk}% Crit)</div></div>
                <div class="oc-kpi-card" style="padding:8px;"><div class="oc-kpi-top">Expected Net EV</div><div class="oc-kpi-val" style="font-size:1em; color:#34d399;">${fmtCompactMoney(expCash)} • +${expResp}R</div></div>
            </div>`;
    }

    window.simPickMember = function (idx, playerId) {
        const s = simState.slots[idx];
        if (!s) return;
        s.playerId = playerId;
        if (playerId) {
            s.cpr = getMemberRoleCPR(playerId, s.rawRole, simState.difficulty, simState.liveRawSlots, simState.crimeName).cpr;
        }
        renderSimSandbox();
    };

    window.simFindBestUnassignedFit = function (idx) {
        const s = simState.slots[idx];
        if (!s) return;
        const alreadyInSim = new Set(simState.slots.map((sl, i) => i !== idx ? String(sl.playerId) : '').filter(Boolean));
        const stagedIds = new Set(stagedAssignments.map(st => String(st.playerId)));
        const pool = analytics.bench.available.filter(m => !alreadyInSim.has(String(m.id)) && !stagedIds.has(String(m.id)));
        const fallbackPool = pool.length ? pool : analytics.bench.available;
        if (!fallbackPool.length) return showOcToast('No available unassigned bench operatives right now.');

        let best = null, bestScore = -9999, bestCpr = 0;
        fallbackPool.forEach(m => {
            const info = getMemberRoleCPR(m.id, s.rawRole, simState.difficulty, simState.liveRawSlots, simState.crimeName);
            const score = info.cpr + (info.isEstimated ? -15 : 25);
            if (score > bestScore) { bestScore = score; best = m; bestCpr = info.cpr; }
        });
        if (best) {
            s.playerId = best.id;
            s.cpr = bestCpr;
            renderSimSandbox();
            showOcToast(`🔍 Selected ${best.name} (${bestCpr}% ${s.rawRole}) for Slot #${idx + 1}!`);
        }
    };

    window.simSetSlotCpr = function (idx, val) {
        if (!simState.slots[idx]) return;
        simState.slots[idx].cpr = Number(val || 50);
        const badges = document.querySelectorAll('#sim-slots-list .cpr-badge');
        if (badges && badges[idx]) {
            badges[idx].textContent = `${simState.slots[idx].cpr}%`;
            badges[idx].className = `cpr-badge ${getCprBadgeClass(simState.slots[idx].cpr)}`;
        }
        updateSimResultsOnly();
    };

    window.simToggleSlotItem = function (idx, checked) {
        if (!simState.slots[idx]) return;
        simState.slots[idx].hasItem = checked;
        updateSimResultsOnly();
    };

    // ─── WORKSPACE 3 (#payouts): Batch Settlement, Fixed Gear Calculator & 90d Economics ───
    function isCrimeSettled(c) {
        const idStr = String(c.id);
        if (typeof localPaidOverrides[idStr] === 'boolean') return localPaidOverrides[idStr];
        if (cmdData.payoutStatus && cmdData.payoutStatus[idStr] && typeof cmdData.payoutStatus[idStr].paid === 'boolean') {
            return cmdData.payoutStatus[idStr].paid;
        }
        // Torn sets rewards.payout.paid_at when settled in Torn balance
        return Boolean(c.rewards?.payout?.paid_at);
    }

    function getCrimeConsumedGearCost(c) {
        let sum = 0;
        (c.slots || []).forEach(s => {
            if (s.item_requirement && !s.item_requirement.is_reusable && s.user?.item_outcome?.owned_by !== 'faction') {
                if (s.user?.item_outcome?.outcome === 'used' || s.item_requirement.is_available) {
                    sum += Number(s.item_requirement.market_value || 0);
                }
            }
        });
        return sum;
    }

    function renderPayoutsWorkspace() {
        renderBatchSettlementQueue();
        document.getElementById('payout-vault-slider').value = payoutState.vaultPct;
        document.getElementById('payout-vault-pct-label').textContent = `${payoutState.vaultPct}%`;
        ['equal', 'cpr', 'role'].forEach(m => document.getElementById(`mode-btn-${m}`)?.classList.toggle('active', m === payoutState.mode));
        populatePayoutCrimeSelect();
        renderEconomicsView();
    }

    function renderBatchSettlementQueue() {
        const qBody = document.getElementById('batch-queue-tbody');
        const cBody = document.getElementById('batch-consolidated-tbody');
        if (!qBody || !cBody) return;

        const successful = (cmdData.completedCrimes || []).filter(c => String(c.status || '').toLowerCase() === 'successful').slice(0, 60);
        const unpaidList = successful.filter(c => !isCrimeSettled(c));
        const unpCntEl = document.getElementById('unpaid-queue-cnt');
        if (unpCntEl) unpCntEl.textContent = String(unpaidList.length);

        const activeFilter = (!batchState.userSelectedFilter)
            ? (unpaidList.length > 0 ? 'unpaid' : 'all')
            : (batchState.filter === 'all' ? 'all' : 'unpaid');
        batchState.filter = activeFilter;

        document.getElementById('settle-flt-unpaid')?.classList.toggle('active', activeFilter === 'unpaid');
        document.getElementById('settle-flt-all')?.classList.toggle('active', activeFilter === 'all');

        const displayList = activeFilter === 'unpaid' ? unpaidList : successful.slice(0, 30);

        // If user has none selected yet and unpaid items exist, keep selectedIds ready
        if (!displayList.length) {
            qBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:18px; color:var(--text-tertiary);">${batchState.filter === 'unpaid' ? '🟢 All recent completed OCs are marked Paid! Switch to "All Completed (Last 30)" to audit or toggle status.' : 'No completed OCs found.'}</td></tr>`;
        } else {
            qBody.innerHTML = displayList.map(c => {
                const paid = isCrimeSettled(c);
                const checked = batchState.selectedIds.has(String(c.id));
                const gross = Number(c.rewards?.gross_total || ((c.rewards?.money || 0) + (c.rewards?.item_value_total || 0)));
                const gear = getCrimeConsumedGearCost(c);
                return `
                    <tr>
                        <td><input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleBatchCrimeSelect('${c.id}', this.checked)"></td>
                        <td class="font-mono">${formatTctDate(c.executed_at || c.ready_at || 0)}</td>
                        <td><span class="diff-badge">T${c.difficulty}</span> <strong>${escapeHtml(c.name)}</strong> <span style="color:var(--text-tertiary);">#${c.id}</span></td>
                        <td class="font-mono" style="color:#34d399;">${fmtCompactMoney(gross)}</td>
                        <td class="font-mono" style="color:${gear > 0 ? '#fbbf24' : 'var(--text-tertiary)'};">${gear > 0 ? fmtCompactMoney(gear) : '$0'}</td>
                        <td>
                            <button class="status-pill ${paid ? 'pill-ready' : 'pill-recruiting'}" style="padding:2px 8px; cursor:pointer;" onclick="toggleCrimePaidFlag('${c.id}', ${!paid})" title="Click to toggle Paid / Unpaid">
                                ${paid ? '✅ Paid' : '⏳ Unpaid'}
                            </button>
                        </td>
                    </tr>`;
            }).join('');
        }

        // Compute Consolidated Member Payout Ledger across all checked OCs
        const selectedCrimes = successful.filter(c => batchState.selectedIds.has(String(c.id)));
        const selCntEl = document.getElementById('batch-sel-cnt');
        if (selCntEl) selCntEl.textContent = String(selectedCrimes.length);

        const memberAgg = new Map();
        selectedCrimes.forEach(c => {
            const gross = Number(c.rewards?.gross_total || ((c.rewards?.money || 0) + (c.rewards?.item_value_total || 0)));
            const slots = (c.slots || []).filter(s => s.user?.id);
            if (!slots.length) return;

            let totalConsumed = 0;
            const slotReimb = slots.map(s => {
                const consumed = (s.item_requirement && !s.item_requirement.is_reusable && s.user?.item_outcome?.owned_by !== 'faction' && (s.user?.item_outcome?.outcome === 'used' || s.item_requirement.is_available))
                    ? Number(s.item_requirement.market_value || 0)
                    : 0;
                totalConsumed += consumed;
                return consumed;
            });
            totalConsumed = Math.min(gross, totalConsumed);
            const afterGear = Math.max(0, gross - totalConsumed);
            const vaultPct = c.rewards?.payout?.percentage !== undefined ? Math.max(0, 100 - Number(c.rewards.payout.percentage)) : payoutState.vaultPct;
            const netPool = Math.max(0, Math.round(afterGear * ((100 - vaultPct) / 100)));
            const eachShare = Math.round(netPool / slots.length);

            slots.forEach((s, i) => {
                const pId = String(s.user.id);
                if (!memberAgg.has(pId)) memberAgg.set(pId, { id: s.user.id, name: s.user.name || `ID:${pId}`, crimes: 0, reimburse: 0, netTotal: 0 });
                const agg = memberAgg.get(pId);
                agg.crimes++;
                agg.reimburse += slotReimb[i];
                agg.netTotal += eachShare + slotReimb[i];
            });
        });

        const ledger = Array.from(memberAgg.values()).sort((a, b) => b.netTotal - a.netTotal);
        if (!ledger.length) {
            cBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:22px; color:var(--text-tertiary);">Check 1 or more OCs on the left (or click "Select All Unpaid") to compute consolidated member payouts.</td></tr>';
        } else {
            cBody.innerHTML = ledger.map(m => `
                <tr>
                    <td><strong>${escapeHtml(m.name)}</strong> <span style="color:var(--text-tertiary);">[${m.id}]</span></td>
                    <td class="font-mono">${m.crimes}</td>
                    <td class="font-mono" style="color:${m.reimburse > 0 ? '#fbbf24' : 'var(--text-tertiary)'};">${fmtMoney(m.reimburse)}</td>
                    <td class="font-mono" style="font-weight:900; color:#34d399;">${fmtMoney(m.netTotal)}</td>
                    <td><button class="oc-action-btn" onclick="payInFactionBank(${m.id}, '${escapeHtml(m.name)}', ${m.netTotal})" style="padding:3px 8px;">💸 Copy Amount &amp; Open Faction Bank</button></td>
                </tr>`).join('');
        }
    }

    window.setSettlementFilter = function (flt) {
        batchState.filter = flt === 'all' ? 'all' : 'unpaid';
        batchState.userSelectedFilter = true;
        renderBatchSettlementQueue();
    };
    window.toggleBatchCrimeSelect = function (cId, checked) {
        if (checked) batchState.selectedIds.add(String(cId));
        else batchState.selectedIds.delete(String(cId));
        renderBatchSettlementQueue();
    };
    window.selectAllUnpaidSettlements = function () {
        const successful = (cmdData.completedCrimes || []).filter(c => String(c.status || '').toLowerCase() === 'successful');
        const target = batchState.filter === 'unpaid' ? successful.filter(c => !isCrimeSettled(c)) : successful.slice(0, 30);
        target.forEach(c => batchState.selectedIds.add(String(c.id)));
        renderBatchSettlementQueue();
    };
    window.clearBatchSelection = function () {
        batchState.selectedIds.clear();
        renderBatchSettlementQueue();
    };
    window.toggleCrimePaidFlag = function (cId, paid) {
        window.persistBatchPaidStatus([String(cId)], paid);
    };
    window.markSelectedSettlementsPaid = function (paid) {
        const ids = Array.from(batchState.selectedIds);
        if (!ids.length) return showOcToast('Select at least 1 completed OC first.');
        window.persistBatchPaidStatus(ids, paid);
        if (paid) batchState.selectedIds.clear();
    };
    window.persistBatchPaidStatus = async function (crimeIds, paid) {
        crimeIds.forEach(id => { localPaidOverrides[String(id)] = Boolean(paid); });
        try { localStorage.setItem(STORAGE_PAID_IDS_KEY, JSON.stringify(localPaidOverrides)); } catch (_) {}
        renderBatchSettlementQueue();
        try {
            const res = await fetch('/api/oc/payout-status', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ crimeIds, paid: Boolean(paid) })
            });
            if (res.ok) {
                const d = await res.json();
                if (d.payoutStatus) cmdData.payoutStatus = d.payoutStatus;
            }
        } catch (_) {}
        showOcToast(`✅ Marked ${crimeIds.length} OC(s) as ${paid ? 'Paid' : 'Unpaid'}`);
    };
    window.copyBatchLedgerReceipt = function () {
        const rows = Array.from(document.querySelectorAll('#batch-consolidated-tbody tr')).map(tr => tr.innerText.replace(/\s+/g, ' ').trim());
        if (!rows.length || rows[0].includes('Check 1')) return showOcToast('Select crimes first to copy batch receipt.');
        copyText(`💸 **Batch OC Settlement Receipt (${batchState.selectedIds.size} OCs)**\n` + rows.join('\n'), '✅ Batch payout receipt copied!');
    };

    // Single-Crime Calculator (Reusable Gear Fix!)
    function populatePayoutCrimeSelect() {
        const sel = document.getElementById('payout-crime-select');
        if (!sel) return;
        const activeOpts = analytics.activeAnnotated.map(c => `<option value="active:${c.id}">[ACTIVE T${c.tier}] ${escapeHtml(c.name)} (#${c.id}) — Est. ${fmtCompactMoney(c.estCash)}</option>`);
        const compOpts = (cmdData.completedCrimes || []).filter(c => String(c.status || '').toLowerCase() === 'successful').slice(0, 40).map(c => `<option value="comp:${c.id}">[DONE T${c.difficulty}] ${escapeHtml(c.name)} (#${c.id}) — ${fmtCompactMoney(c.rewards?.gross_total || c.rewards?.money || 0)}</option>`);
        sel.innerHTML = `<option value="custom">-- Custom / Manual Payout --</option>${activeOpts.join('')}${compOpts.join('')}`;

        if (!payoutState.selectedCrimeKey) {
            if (analytics.activeAnnotated.length) loadPayoutCrime(`active:${analytics.activeAnnotated[0].id}`);
            else if (compOpts.length) loadPayoutCrime(`comp:${(cmdData.completedCrimes || []).find(c => String(c.status || '').toLowerCase() === 'successful')?.id}`);
            else loadPayoutCrime('custom');
        } else {
            sel.value = payoutState.selectedCrimeKey;
            recalcPayoutLedger();
        }
    }

    window.openInPayoutCalc = function (crimeId) {
        window.switchOcView('payouts');
        loadPayoutCrime(`active:${crimeId}`);
        setTimeout(() => document.getElementById('payout-calc-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    };

    window.loadPayoutCrime = function (key) {
        payoutState.selectedCrimeKey = key;
        const sel = document.getElementById('payout-crime-select');
        if (sel) sel.value = key;

        let crime = null;
        if (key.startsWith('active:')) crime = analytics.activeAnnotated.find(x => String(x.id) === key.slice(7));
        else if (key.startsWith('comp:')) crime = (cmdData.completedCrimes || []).find(x => String(x.id) === key.slice(5));

        if (!crime) {
            payoutState.cash = 10000000;
            payoutState.itemsVal = 0;
            payoutState.rows = [{ key: '0_1', id: 1, name: 'Operative 1', role: 'Hacker', cpr: 85, itemCost: 0, itemName: '', isReusable: false }];
            payoutState.reimburseEnabled = {};
        } else {
            const isComp = key.startsWith('comp:');
            payoutState.cash = isComp ? Number(crime.rewards?.money || 0) : Number(crime.estCash || 0);
            payoutState.itemsVal = isComp ? Number(crime.rewards?.item_value_total || 0) : 0;
            payoutState.reimburseEnabled = {};
            payoutState.rows = (crime.slots || []).filter(s => s.user).map((s, idx) => {
                const itm = s.item_requirement;
                const isReusable = Boolean(itm?.is_reusable);
                const ownedByFaction = s.user?.item_outcome?.owned_by === 'faction';
                const cost = itm ? Number(itm.market_value || 0) : 0;
                const rKey = `${idx}_${s.user.id}`;
                // FIXED BUG: Check ONLY 1x Consumed items owned by member; NEVER auto-deduct Reusable tools!
                payoutState.reimburseEnabled[rKey] = Boolean(itm && !isReusable && !ownedByFaction && cost > 0);
                return {
                    key: rKey, id: s.user.id, name: s.user.name || `ID:${s.user.id}`,
                    role: s.position_info?.label || s.position || 'Operative',
                    cpr: Number(s.checkpoint_pass_rate || 75),
                    itemCost: cost, itemName: itm?.name || '', isReusable
                };
            });
        }
        document.getElementById('payout-cash-input').value = payoutState.cash;
        document.getElementById('payout-items-input').value = payoutState.itemsVal;
        renderPayoutReimburseList();
        recalcPayoutLedger();
    };

    function renderPayoutReimburseList() {
        const el = document.getElementById('payout-reimburse-list');
        if (!el) return;
        const withItems = payoutState.rows.filter(r => r.itemCost > 0);
        if (!withItems.length) {
            el.innerHTML = '<div style="font-size:0.78em; color:var(--text-tertiary);">No gear items attached to this crew.</div>';
            return;
        }
        el.innerHTML = withItems.map(r => `
            <label style="display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:0.78em; padding:7px 10px; background:rgba(10,15,28,0.75); border:1px solid ${r.isReusable ? 'rgba(56,189,248,0.25)' : 'rgba(245,158,11,0.35)'}; border-radius:7px; cursor:pointer;">
                <span style="display:flex; align-items:center; gap:7px; flex-wrap:wrap;">
                    <input type="checkbox" ${payoutState.reimburseEnabled[r.key] ? 'checked' : ''} onchange="toggleReimburseSlot('${r.key}', this.checked)">
                    <span><strong>${escapeHtml(r.name)}</strong> — ${escapeHtml(r.itemName)}</span>
                    ${r.isReusable
                        ? '<span class="status-pill" style="padding:1px 7px; font-size:0.86em; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.35); color:#7dd3fc;">🛡️ Reusable Tool — Kept by Member (Check only to reimburse initial purchase)</span>'
                        : '<span class="status-pill" style="padding:1px 7px; font-size:0.86em; background:rgba(245,158,11,0.14); border:1px solid rgba(245,158,11,0.4); color:#fbbf24;">🔥 Consumed (1x Use)</span>'}
                </span>
                <span class="font-mono" style="color:${payoutState.reimburseEnabled[r.key] ? '#fbbf24' : 'var(--text-tertiary)'}; white-space:nowrap;">${payoutState.reimburseEnabled[r.key] ? fmtMoney(r.itemCost) : '$0 deducted'}</span>
            </label>`).join('');
    }

    window.toggleReimburseSlot = function (k, checked) {
        payoutState.reimburseEnabled[k] = checked;
        renderPayoutReimburseList();
        recalcPayoutLedger();
    };

    window.setVaultCutPct = function (pct) {
        payoutState.vaultPct = Math.max(0, Math.min(100, Number(pct || 0)));
        localStorage.setItem(STORAGE_VAULT_KEY, String(payoutState.vaultPct));
        document.getElementById('payout-vault-slider').value = payoutState.vaultPct;
        document.getElementById('payout-vault-pct-label').textContent = `${payoutState.vaultPct}%`;
        recalcPayoutLedger();
    };

    window.setPayoutMode = function (mode) {
        payoutState.mode = mode;
        localStorage.setItem(STORAGE_PAYOUT_MODE_KEY, mode);
        ['equal', 'cpr', 'role'].forEach(m => document.getElementById(`mode-btn-${m}`)?.classList.toggle('active', m === mode));
        recalcPayoutLedger();
    };

    function getRoleDiffWeight(roleName) {
        const r = String(roleName || '').toLowerCase();
        if (/hacker|techie|bomber|imitator|saboteur|assassin/.test(r)) return 1.35;
        if (/picklock|engineer|driver|arsonist|negotiator|car thief/.test(r)) return 1.15;
        return 1.0;
    }

    window.recalcPayoutLedger = function () {
        const cash = Number(document.getElementById('payout-cash-input')?.value || 0);
        const items = Number(document.getElementById('payout-items-input')?.value || 0);
        const incItems = document.getElementById('payout-include-items')?.checked !== false;
        const gross = Math.max(0, cash + (incItems ? items : 0));

        let totalReimburse = 0;
        payoutState.rows.forEach(r => { if (payoutState.reimburseEnabled[r.key]) totalReimburse += r.itemCost; });
        totalReimburse = Math.min(gross, totalReimburse);

        const afterReimburse = Math.max(0, gross - totalReimburse);
        const vaultCut = Math.round(afterReimburse * (payoutState.vaultPct / 100));
        const memberPool = Math.max(0, afterReimburse - vaultCut);

        const sumEl = document.getElementById('payout-summary-cards');
        if (sumEl) {
            sumEl.innerHTML = `
                <div class="oc-kpi-card" style="padding:9px;"><div class="oc-kpi-top">Gross</div><div class="oc-kpi-val" style="font-size:1.05em;">${fmtCompactMoney(gross)}</div></div>
                <div class="oc-kpi-card" style="padding:9px;"><div class="oc-kpi-top">Reimbursed</div><div class="oc-kpi-val" style="font-size:1.05em; color:#fbbf24;">${fmtCompactMoney(totalReimburse)}</div></div>
                <div class="oc-kpi-card" style="padding:9px;"><div class="oc-kpi-top">Vault (${payoutState.vaultPct}%)</div><div class="oc-kpi-val" style="font-size:1.05em; color:#38bdf8;">${fmtCompactMoney(vaultCut)}</div></div>
                <div class="oc-kpi-card" style="padding:9px;"><div class="oc-kpi-top">Member Pool</div><div class="oc-kpi-val" style="font-size:1.05em; color:#34d399;">${fmtCompactMoney(memberPool)}</div></div>`;
        }

        const rows = payoutState.rows;
        const totalWeight = rows.reduce((s, r) => s + (payoutState.mode === 'cpr' ? Math.max(1, r.cpr) : (payoutState.mode === 'role' ? getRoleDiffWeight(r.role) : 1)), 0) || 1;
        const tbody = document.getElementById('payout-receipt-tbody');
        if (!tbody) return;
        tbody.innerHTML = rows.map(r => {
            const w = payoutState.mode === 'cpr' ? Math.max(1, r.cpr) : (payoutState.mode === 'role' ? getRoleDiffWeight(r.role) : 1);
            const sharePct = (w / totalWeight) * 100;
            const poolCash = Math.round(memberPool * (w / totalWeight));
            const reimbCash = payoutState.reimburseEnabled[r.key] ? r.itemCost : 0;
            const finalCash = poolCash + reimbCash;
            r._computedFinal = finalCash;
            r._computedReimb = reimbCash;
            return `
                <tr>
                    <td><strong>${escapeHtml(r.name)}</strong> <span style="color:var(--text-tertiary);">[${r.id}]</span></td>
                    <td>${escapeHtml(r.role)}</td>
                    <td class="font-mono">${r.cpr}%</td>
                    <td class="font-mono" style="color:${reimbCash > 0 ? '#fbbf24' : 'var(--text-tertiary)'};">${fmtMoney(reimbCash)}</td>
                    <td class="font-mono">${sharePct.toFixed(1)}%</td>
                    <td class="font-mono" style="font-weight:900; color:#34d399;">${fmtMoney(finalCash)}</td>
                    <td><button class="oc-action-btn" onclick="payInFactionBank(${r.id}, '${escapeHtml(r.name)}', ${finalCash})" style="padding:4px 8px;">💸 Pay in Bank</button></td>
                </tr>`;
        }).join('');
    };

    window.payInFactionBank = function (playerId, playerName, amount) {
        copyText(String(amount), `💸 Copied $${fmt(amount)} for ${playerName} [${playerId}] & opened Faction Banking!`);
        window.open('https://www.torn.com/factions.php?step=your#/tab=controls', '_blank', 'noopener,noreferrer');
    };

    window.copyPayoutDiscordReceipt = function () {
        const cash = Number(document.getElementById('payout-cash-input')?.value || 0);
        const items = Number(document.getElementById('payout-items-input')?.value || 0);
        const incItems = document.getElementById('payout-include-items')?.checked !== false;
        const gross = cash + (incItems ? items : 0);
        const lines = payoutState.rows.map(r => `• **${r.name} [${r.id}]** (${r.role}, ${r.cpr}%): **${fmtMoney(r._computedFinal || 0)}**${r._computedReimb ? ` (incl. ${fmtMoney(r._computedReimb)} consumed gear)` : ''}`).join('\n');
        copyText(`💰 **OC Payout Receipt (${payoutState.mode.toUpperCase()} • ${payoutState.vaultPct}% Vault)**\n**Gross:** ${fmtMoney(gross)}\n${lines}`, '✅ Discord payout receipt copied!');
    };

    // Economics Suite + Fixed 7d/30d/90d X-Axis Buckets
    window.setEconWindow = function (days) {
        econDays = days;
        [7, 30, 90].forEach(d => document.getElementById(`econ-btn-${d}`)?.classList.toggle('active', d === days));
        document.getElementById('econ-btn-all')?.classList.toggle('active', days >= 9999);
        renderEconomicsView();
    };

    function getFilteredCompletedForEconomics() {
        const nowSec = Math.floor(Date.now() / 1000);
        const cutoff = econDays >= 9999 ? 0 : (nowSec - econDays * 86400);
        return (cmdData.completedCrimes || []).filter(c => Number(c.executed_at || c.ready_at || 0) >= cutoff);
    }

    function renderEconomicsView() {
        const crimes = getFilteredCompletedForEconomics();
        let grossCash = 0, itemDropsVal = 0, reimbCost = 0, vaultCutEst = 0, respect = 0;
        const dailyMap = {};
        const tierMap = {};
        const dropRows = [];
        const profitMap = {};

        crimes.forEach(c => {
            const isWin = String(c.status || '').toLowerCase() === 'successful';
            const tier = Number(c.difficulty || 1);
            if (!tierMap[tier]) tierMap[tier] = { tier, wins: 0, fails: 0 };
            if (isWin) tierMap[tier].wins++; else tierMap[tier].fails++;

            const pKey = `${tier}:${normalizeCrimeName(c.name)}`;
            if (!profitMap[pKey]) profitMap[pKey] = { name: c.name, tier, wins: 0, fails: 0, gross: 0, gear: 0, respect: 0 };
            const pm = profitMap[pKey];
            if (isWin) pm.wins++; else pm.fails++;

            const crimeGear = getCrimeConsumedGearCost(c);
            reimbCost += crimeGear;
            pm.gear += crimeGear;

            if (isWin) {
                const m = Number(c.rewards?.money || 0);
                const iv = Number(c.rewards?.item_value_total || 0);
                const r = Number(c.rewards?.respect || 0);
                const vaultPct = c.rewards?.payout?.percentage !== undefined ? Math.max(0, 100 - Number(c.rewards.payout.percentage)) : payoutState.vaultPct;
                const vc = Math.round((m + iv) * (vaultPct / 100));

                grossCash += m; itemDropsVal += iv; vaultCutEst += vc; respect += r;
                pm.gross += m + iv; pm.respect += r;

                const execTs = Number(c.executed_at || c.ready_at || 0);
                const day = formatTctDate(execTs);
                if (!dailyMap[day]) dailyMap[day] = { day, cash: 0, items: 0, vault: 0 };
                dailyMap[day].cash += m; dailyMap[day].items += iv; dailyMap[day].vault += vc;

                (c.rewards?.items || []).forEach(it => {
                    dropRows.push({ day, crime: c.name, item: it.name || `Item #${it.id}`, qty: it.quantity || 1, val: it.total_value || 0 });
                });
            }
        });

        const banner = document.getElementById('econ-totals-banner');
        if (banner) {
            banner.textContent = `${crimes.length} Completed OCs • Cash: ${fmtCompactMoney(grossCash)} • Item Drops: ${fmtCompactMoney(itemDropsVal)} • Consumed Gear: ${fmtCompactMoney(reimbCost)} • Vault Retained: ${fmtCompactMoney(vaultCutEst)} • +${fmt(respect)} Respect`;
        }

        const titleEl = document.getElementById('econ-chart-title');
        if (titleEl) {
            const winLbl = econDays === 7 ? '7 Daily Bars' : (econDays === 30 ? '30 Daily Bars' : (econDays === 90 ? '90 Days — 13 Weekly Buckets' : 'All Time — Weekly Buckets'));
            titleEl.textContent = `📊 OC Revenue, Item Drops & Vault Cut (${winLbl})`;
        }

        // Fixed X-Axis Buckets: 7 daily, 30 daily (FULL 30), or 13 weekly buckets covering full 90d / All Time!
        const revEl = document.getElementById('econ-revenue-chart');
        if (revEl) {
            const nowSec = Math.floor(Date.now() / 1000);
            let buckets = [];
            if (econDays <= 30) {
                const nDays = econDays === 7 ? 7 : 30;
                for (let i = nDays - 1; i >= 0; i--) {
                    const dt = formatTctDate(nowSec - i * 86400);
                    const rec = dailyMap[dt] || { cash: 0, items: 0, vault: 0 };
                    buckets.push({ label: dt.slice(5), fullLabel: dt, cash: rec.cash, items: rec.items, vault: rec.vault });
                }
            } else {
                const winStart = econDays === 90 ? (nowSec - 90 * 86400) : Math.min(nowSec - 90 * 86400, ...crimes.map(c => Number(c.executed_at || c.ready_at || nowSec)));
                const numWeeks = 13;
                const weekSpan = Math.max(86400, (nowSec - winStart) / numWeeks);
                for (let w = 0; w < numWeeks; w++) {
                    const bStart = winStart + w * weekSpan;
                    buckets.push({ label: formatTctDate(bStart).slice(5), fullLabel: `Week of ${formatTctDate(bStart)}`, cash: 0, items: 0, vault: 0, bStart, bEnd: bStart + weekSpan });
                }
                crimes.forEach(c => {
                    if (String(c.status || '').toLowerCase() !== 'successful') return;
                    const ts = Number(c.executed_at || c.ready_at || 0);
                    const idx = Math.max(0, Math.min(numWeeks - 1, Math.floor((ts - winStart) / weekSpan)));
                    const b = buckets[idx];
                    const m = Number(c.rewards?.money || 0);
                    const iv = Number(c.rewards?.item_value_total || 0);
                    const vaultPct = c.rewards?.payout?.percentage !== undefined ? Math.max(0, 100 - Number(c.rewards.payout.percentage)) : payoutState.vaultPct;
                    b.cash += m;
                    b.items += iv;
                    b.vault += Math.round((m + iv) * (vaultPct / 100));
                });
            }

            const mx = Math.max(1, ...buckets.map(b => b.cash + b.items));
            const svgW = 540;
            const slotW = (svgW - 24) / Math.max(1, buckets.length);
            const barW = Math.max(6, Math.min(28, slotW - 4));
            const labelStep = buckets.length > 15 ? 5 : (buckets.length > 8 ? 2 : 1);

            revEl.innerHTML = `
                <svg viewBox="0 0 ${svgW} 185" style="width:100%; height:185px;">
                    ${buckets.map((b, i) => {
                        const total = b.cash + b.items;
                        const totalH = total > 0 ? Math.max(4, Math.round((total / mx) * 140)) : 2;
                        const cashH = total > 0 ? Math.round((b.cash / mx) * 140) : 0;
                        const itemH = Math.max(0, totalH - cashH);
                        const x = 12 + i * slotW + (slotW - barW) / 2;
                        const showLbl = (i % labelStep === 0 || i === buckets.length - 1);
                        return `
                            <g>
                                <rect x="${x.toFixed(1)}" y="${150 - (total > 0 ? cashH : 2)}" width="${barW.toFixed(1)}" height="${total > 0 ? cashH : 2}" rx="2" fill="${total > 0 ? '#38bdf8' : 'rgba(255,255,255,0.08)'}"><title>${b.fullLabel}: Cash ${fmtMoney(b.cash)} | Drops ${fmtMoney(b.items)} | Vault ~${fmtMoney(b.vault)}</title></rect>
                                ${itemH > 0 ? `<rect x="${x.toFixed(1)}" y="${150 - totalH}" width="${barW.toFixed(1)}" height="${itemH}" rx="2" fill="#a78bfa"/>` : ''}
                                ${showLbl ? `<text x="${(x + barW / 2).toFixed(1)}" y="170" text-anchor="middle" fill="#64748b" font-size="8.5" font-family="JetBrains Mono">${b.label}</text>` : ''}
                            </g>`;
                    }).join('')}
                </svg>
                <div style="display:flex; gap:14px; font-size:0.74em; color:var(--text-secondary);">
                    <span>🟦 Gross Cash (${fmtCompactMoney(grossCash)})</span>
                    <span>🟪 Item Drops (${fmtCompactMoney(itemDropsVal)})</span>
                    <span>Vault Retained: ${fmtCompactMoney(vaultCutEst)}</span>
                </div>`;
        }

        const tierEl = document.getElementById('econ-tier-chart');
        if (tierEl) {
            const tiers = Object.values(tierMap).sort((a, b) => a.tier - b.tier);
            tierEl.innerHTML = tiers.length ? tiers.map(t => {
                const tot = t.wins + t.fails;
                const winPct = Math.round((t.wins / tot) * 100);
                return `
                    <div style="margin-bottom:9px;">
                        <div style="display:flex; justify-content:space-between; font-size:0.78em; margin-bottom:3px;"><strong>Tier ${t.tier}</strong><span class="font-mono">${t.wins}W / ${t.fails}F (${winPct}% Win)</span></div>
                        <div style="height:10px; border-radius:6px; background:rgba(244,63,94,0.45); overflow:hidden; display:flex;"><div style="width:${winPct}%; background:linear-gradient(90deg,#10b981,#06b6d4);"></div></div>
                    </div>`;
            }).join('') : '<div style="padding:24px; color:var(--text-tertiary);">No tier records in selected timeframe.</div>';
        }

        const dropsBody = document.getElementById('econ-drops-tbody');
        if (dropsBody) {
            dropsBody.innerHTML = dropRows.length ? dropRows.slice(0, 30).map(r => `
                <tr><td class="font-mono">${r.day}</td><td>${escapeHtml(r.crime)}</td><td><strong>${escapeHtml(r.item)}</strong></td><td class="font-mono">${r.qty}</td><td class="font-mono" style="color:#a78bfa; font-weight:800;">${fmtMoney(r.val)}</td></tr>`).join('')
                : '<tr><td colspan="5" style="text-align:center; padding:18px; color:var(--text-tertiary);">No item drops in selected window.</td></tr>';
        }

        const profBody = document.getElementById('econ-profit-tbody');
        if (profBody) {
            const pRows = Object.values(profitMap).sort((a, b) => b.gross - a.gross);
            profBody.innerHTML = pRows.length ? pRows.map(p => `
                <tr><td><span class="diff-badge">T${p.tier}</span> <strong>${escapeHtml(p.name)}</strong></td><td class="font-mono">${p.wins} / ${p.fails}</td><td class="font-mono" style="color:#34d399; font-weight:800;">${fmtCompactMoney(p.gross)}</td><td class="font-mono" style="color:#fbbf24;">${fmtCompactMoney(p.gear)}</td><td class="font-mono" style="color:#c4b5fd;">+${fmt(p.respect)}</td></tr>`).join('')
                : '<tr><td colspan="5" style="text-align:center; padding:18px; color:var(--text-tertiary);">No completed crimes in window.</td></tr>';
        }
    }

    window.exportOcLedgerCSV = function () {
        const crimes = getFilteredCompletedForEconomics();
        if (!crimes.length) return showOcToast('No completed OC records in selected window to export.');
        const headers = ['Crime ID', 'Date (TCT)', 'Crime Name', 'Tier', 'Status', 'Gross Cash', 'Item Drops Value', 'Consumed Gear Cost', 'Vault %', 'Respect', 'Participants & Roles', 'Member Payout Splits'];
        const rows = crimes.map(c => {
            const dt = formatTctDate(c.executed_at || c.ready_at || 0);
            const slots = (c.slots || []).filter(s => s.user);
            const parts = slots.map(s => `${s.user.name || s.user.id} (${s.position_info?.label || s.position} ${s.checkpoint_pass_rate || 0}%)`).join('; ');
            const gearCost = getCrimeConsumedGearCost(c);
            const gross = Number(c.rewards?.gross_total || ((c.rewards?.money || 0) + (c.rewards?.item_value_total || 0)));
            const payPct = c.rewards?.payout?.percentage !== undefined ? Number(c.rewards.payout.percentage) : (100 - payoutState.vaultPct);
            const vaultPct = Math.max(0, 100 - payPct);
            const netPool = Math.max(0, Math.round(gross * (payPct / 100)));
            const perMember = slots.length ? Math.round(netPool / slots.length) : 0;
            const splitsStr = String(c.status || '').toLowerCase() === 'successful'
                ? slots.map(s => `${s.user.name || s.user.id}: $${perMember.toLocaleString('en-US')}`).join('; ')
                : '$0 (Failed)';
            return [sanitizeCSVCell(c.id), sanitizeCSVCell(dt), sanitizeCSVCell(c.name), c.difficulty || 1, sanitizeCSVCell(c.status), Number(c.rewards?.money || 0), Number(c.rewards?.item_value_total || 0), gearCost, vaultPct, Number(c.rewards?.respect || 0), sanitizeCSVCell(parts), sanitizeCSVCell(splitsStr)];
        });
        const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const link = document.createElement('a');
        link.href = encodeURI(csv);
        link.download = `factionos_oc_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        showOcToast(`📥 Exported ${rows.length} OC records to CSV!`);
    };

    // ─── WORKSPACE 4 (#intel): Role Heatmap Matrix, Deduplicated Tier Advisor, Leaderboard & Post-Mortems ───
    function renderIntelWorkspace() {
        renderRoleHeatmap();
        renderRoiMatrix();
        renderLeaderboard();
        renderPostMortems();
    }

    // Real Tool #4: Faction Member × Role CPR Heatmap Matrix
    window.sortRoleHeatmap = function (roleName) {
        if (heatmapState.sortRole === roleName) heatmapState.sortAsc = !heatmapState.sortAsc;
        else { heatmapState.sortRole = roleName; heatmapState.sortAsc = false; }
        renderRoleHeatmap();
    };

    window.renderRoleHeatmap = function () {
        const thead = document.getElementById('role-heatmap-thead');
        const tbody = document.getElementById('role-heatmap-tbody');
        if (!thead || !tbody) return;

        const cols = analytics.allRoleColumns;
        const benchOnly = Boolean(document.getElementById('hm-bench-only')?.checked);
        const q = (document.getElementById('hm-search-input')?.value || '').toLowerCase().trim();

        thead.innerHTML = `<tr>
            <th class="sticky-col" onclick="sortRoleHeatmap('__name')" style="cursor:pointer;">Member ${heatmapState.sortRole === '__name' ? (heatmapState.sortAsc ? '↑' : '↓') : '↕'}</th>
            ${cols.map(r => {
                const isAct = heatmapState.sortRole === r;
                return `<th class="${isAct ? 'sort-active' : ''}" onclick="sortRoleHeatmap('${escapeHtml(r)}')" style="cursor:pointer; text-align:center;">${escapeHtml(r.toUpperCase())} ${isAct ? (heatmapState.sortAsc ? '↑' : '↓') : '↕'}</th>`;
            }).join('')}
        </tr>`;

        const rows = analytics.memberProfiles
            .filter(m => (!benchOnly || !m.inActiveOc) && (!q || m.name.toLowerCase().includes(q) || String(m.playerId).includes(q)))
            .map(m => {
                const cellMap = {};
                cols.forEach(r => {
                    const info = getMemberRoleCPR(m.playerId, r, 3);
                    cellMap[r] = info.isEstimated ? null : info;
                });
                return { m, cellMap };
            });

        rows.sort((a, b) => {
            if (heatmapState.sortRole === '__name') {
                return heatmapState.sortAsc ? a.m.name.localeCompare(b.m.name) : b.m.name.localeCompare(a.m.name);
            }
            const va = a.cellMap[heatmapState.sortRole]?.cpr ?? -1;
            const vb = b.cellMap[heatmapState.sortRole]?.cpr ?? -1;
            if (va === -1 && vb === -1) return a.m.name.localeCompare(b.m.name);
            if (va === -1) return 1;
            if (vb === -1) return -1;
            return heatmapState.sortAsc ? (va - vb) : (vb - va);
        });

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" style="text-align:center; padding:22px; color:var(--text-tertiary);">No members match filter.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(({ m, cellMap }) => `
            <tr style="cursor:pointer;" onclick="openOcDossier('${m.playerId}')">
                <td class="sticky-col">
                    <strong>${escapeHtml(m.name)}</strong>
                    <div style="font-size:0.78em; color:${m.inActiveOc ? '#38bdf8' : '#fbbf24'};">${m.inActiveOc ? escapeHtml(m.activeOcName) : 'Bench'}</div>
                </td>
                ${cols.map(r => {
                    const cell = cellMap[r];
                    if (!cell) return `<td style="text-align:center;"><span class="hm-empty" title="Never played ${escapeHtml(r)}">—</span></td>`;
                    const cls = cell.cpr >= 80 ? 'hm-opt' : (cell.cpr >= 70 ? 'hm-safe' : (cell.cpr >= 60 ? 'hm-warn' : 'hm-risk'));
                    return `<td style="text-align:center;"><span class="hm-cell ${cls}" title="${escapeHtml(cell.sourceNote)}">${cell.cpr}%</span></td>`;
                }).join('')}
            </tr>`).join('');
    };

    // Fixed Deduplicated Tier EV Advisor + >=70% Realistic Sweet Spot
    window.updateRoiCpr = function (val) {
        roiState.avgCpr = Number(val || 78);
        document.getElementById('roi-cpr-val').textContent = `${roiState.avgCpr}%`;
        renderRoiMatrix();
    };
    window.sortRoiTable = function (col) {
        if (roiState.sortCol === col) roiState.sortAsc = !roiState.sortAsc;
        else { roiState.sortCol = col; roiState.sortAsc = col === 'name'; }
        renderRoiMatrix();
    };

    function renderRoiMatrix() {
        const tbody = document.getElementById('roi-matrix-tbody');
        const chartWrap = document.getElementById('roi-chart-wrap');
        if (!tbody) return;

        // Deduplicate defensively by normalized name (merges Guardian Ángels + Guardian Angels if legacy cached)
        const deduped = new Map();
        (cmdData.catalog || []).forEach(cat => {
            const key = normalizeCrimeName(cat.name);
            const prev = deduped.get(key);
            if (!prev || (cat.observedCount || 0) > (prev.observedCount || 0)) deduped.set(key, cat);
        });

        const baseCpr = roiState.avgCpr;
        const rows = Array.from(deduped.values()).map(cat => {
            const obsWinRate = (cat.observedCount >= 2) ? Math.round((cat.observedWins / cat.observedCount) * 100) : null;
            const tierPenalty = Math.max(-12, (cat.difficulty - 3.5) * 4);
            const modelWinPct = Math.max(12, Math.min(98, Math.round(baseCpr - tierPenalty)));
            // Use real faction win rate when sample size >= 2, else realistic tier model
            const effectiveWinPct = obsWinRate !== null ? obsWinRate : modelWinPct;
            const winRateFrac = effectiveWinPct / 100;
            const grossAvg = Number(cat.estCash || 0) + Number(cat.estItemValue || 0);
            const netEv = Math.round((winRateFrac * Math.max(0, grossAvg - Number(cat.consumableCost || 0))) - ((1 - winRateFrac) * Number(cat.failPenaltyCost || 250000)));
            const evPerMemberDay = Math.round(netEv / Math.max(1, cat.crewSize * cat.planningDays));
            const respectPerDay = Number(((winRateFrac * Number(cat.estRespect || 0)) / Math.max(1, cat.planningDays)).toFixed(2));
            const highFailFlag = Boolean(obsWinRate !== null && obsWinRate < 50);
            return { ...cat, winRate: effectiveWinPct, obsWinRate, netEv, evPerMemberDay, respectPerDay, highFailFlag };
        });

        // Sweet Spot STRICTLY among proven / executable crimes with >= 70% pass rate (never empty T8 blueprints or high-fail T5/T6!)
        const provenSweet = rows.filter(r => r.observedCount >= 2 && r.winRate >= 70);
        const feasibleFallback = rows.filter(r => r.difficulty <= 4 && r.winRate >= 70);
        const sweetPool = provenSweet.length ? provenSweet : feasibleFallback;
        const sweetSpot = sweetPool.sort((a, b) => b.evPerMemberDay - a.evPerMemberDay)[0] || null;

        rows.sort((a, b) => {
            const va = a[roiState.sortCol], vb = b[roiState.sortCol];
            if (typeof va === 'string') return roiState.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            return roiState.sortAsc ? (va - vb) : (vb - va);
        });

        document.querySelectorAll('#roi-matrix-table thead th').forEach(th => th.classList.remove('sort-active'));
        ['difficulty', 'name', 'crewSize', 'winRate', 'consumableCost', 'netEv', 'evPerMemberDay', 'respectPerDay'].forEach(col => {
            const sp = document.getElementById(`roi-sind-${col}`);
            if (sp) {
                if (col === roiState.sortCol) { sp.textContent = roiState.sortAsc ? '↑' : '↓'; sp.closest('th')?.classList.add('sort-active'); }
                else sp.textContent = '↕';
            }
        });

        if (chartWrap) {
            const topChart = [...rows].sort((a, b) => b.evPerMemberDay - a.evPerMemberDay).slice(0, 8);
            const maxEv = Math.max(1, ...topChart.map(r => r.evPerMemberDay));
            const maxResp = Math.max(1, ...topChart.map(r => r.respectPerDay));
            chartWrap.innerHTML = `
                <div style="display:grid; gap:7px; padding:12px; background:rgba(10,15,28,0.8); border:1px solid var(--oc-border-cyan); border-radius:10px;">
                    <div style="display:flex; justify-content:space-between; font-size:0.74em; color:var(--text-tertiary); flex-wrap:wrap; gap:6px;">
                        <span>Top Crimes by $/Member/Day (Cyan) vs. Respect/Day (Purple) — Weighted by Observed Faction Win Rates</span>
                        <span>★ Recommended Sweet Spot (&ge;70% Win): <strong style="color:#22d3ee;">${sweetSpot ? `[T${sweetSpot.difficulty}] ${escapeHtml(sweetSpot.name)}` : '—'}</strong></span>
                    </div>
                    ${topChart.map(r => `
                        <div style="display:grid; grid-template-columns:190px 1fr 150px; align-items:center; gap:10px; font-size:0.76em;">
                            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><strong>[T${r.difficulty}]</strong> ${escapeHtml(r.name)}</span>
                            <div style="display:flex; flex-direction:column; gap:3px;">
                                <div style="height:7px; border-radius:4px; background:linear-gradient(90deg,${r.highFailFlag ? '#f43f5e,#fb7185' : '#06b6d4,#3b82f6'}); width:${Math.max(2, Math.round((Math.max(0, r.evPerMemberDay) / maxEv) * 100))}%;"></div>
                                <div style="height:5px; border-radius:4px; background:linear-gradient(90deg,#8b5cf6,#ec4899); width:${Math.max(2, Math.round((Math.max(0, r.respectPerDay) / maxResp) * 100))}%;"></div>
                            </div>
                            <span class="font-mono" style="text-align:right; white-space:nowrap;">${fmtCompactMoney(r.evPerMemberDay)}/d • +${r.respectPerDay}R/d</span>
                        </div>`).join('')}
                </div>`;
        }

        tbody.innerHTML = rows.map(r => {
            const isSweet = sweetSpot && normalizeCrimeName(sweetSpot.name) === normalizeCrimeName(r.name);
            const histStr = r.observedCount > 0 ? `${r.observedWins}/${r.observedCount} Wins (${Math.round((r.observedWins / r.observedCount) * 100)}%)` : 'Catalog Est.';
            return `
                <tr class="${isSweet ? 'sweet-spot-row' : ''}">
                    <td><span class="diff-badge">T${r.difficulty}</span></td>
                    <td>
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <strong>${escapeHtml(r.name)}</strong>
                            ${isSweet ? '<span class="sweet-spot-badge">★ Recommended Faction Sweet Spot</span>' : ''}
                            ${r.highFailFlag ? `<span class="fail-warn-badge">⚠️ High Fail Rate in Faction History (${r.observedWins}/${r.observedCount} • ${r.obsWinRate}% Wins) — Require &ge;70% Role CPRs Before Spawning</span>` : ''}
                        </div>
                    </td>
                    <td class="font-mono">${r.crewSize} crew / ${r.planningDays}d</td>
                    <td class="font-mono" style="color:${r.winRate >= 70 ? '#34d399' : '#fb7185'};">${r.winRate}%</td>
                    <td class="font-mono">${fmtCompactMoney(r.consumableCost || 0)}</td>
                    <td class="font-mono" style="color:${r.netEv >= 0 ? 'var(--text-primary)' : '#fb7185'};">${fmtCompactMoney(r.netEv)}</td>
                    <td class="font-mono" style="font-weight:900; color:#22d3ee;">${fmtCompactMoney(r.evPerMemberDay)}</td>
                    <td class="font-mono" style="color:#c4b5fd;">+${r.respectPerDay}</td>
                    <td style="font-size:0.88em; color:var(--text-secondary);">${histStr}</td>
                </tr>`;
        }).join('');
    }

    // Operative Leaderboard & Post-Mortems
    window.sortLeaderboard = function (col) {
        if (lbState.sortCol === col) lbState.sortAsc = !lbState.sortAsc;
        else { lbState.sortCol = col; lbState.sortAsc = col === 'name'; }
        renderLeaderboard();
    };

    window.renderLeaderboard = function () {
        const tbody = document.getElementById('oc-leaderboard-tbody');
        if (!tbody) return;
        const q = (document.getElementById('lb-search-input')?.value || '').toLowerCase().trim();
        const rankFlt = document.getElementById('lb-rank-filter')?.value || 'all';

        const list = analytics.memberProfiles.filter(m => (rankFlt === 'all' || m.rankKey === rankFlt) && (!q || m.name.toLowerCase().includes(q) || String(m.playerId).includes(q)));
        list.sort((a, b) => {
            if (lbState.sortCol === 'name') return lbState.sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
            if (lbState.sortCol === 'rank') return lbState.sortAsc ? a.rankLabel.localeCompare(b.rankLabel) : b.rankLabel.localeCompare(a.rankLabel);
            if (lbState.sortCol === 'activeOc') {
                const va = a.activeOcName || 'zzz', vb = b.activeOcName || 'zzz';
                return lbState.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            const va = Number(a[lbState.sortCol] || 0), vb = Number(b[lbState.sortCol] || 0);
            return lbState.sortAsc ? (va - vb) : (vb - va);
        });

        document.querySelectorAll('#oc-leaderboard-table thead th').forEach(th => th.classList.remove('sort-active'));
        ['name', 'rank', 'activeOc', 'completed', 'passRate', 'avgCpr', 'grossCash', 'respect', 'gearSupplied', 'reliability'].forEach(col => {
            const sp = document.getElementById(`lb-sind-${col}`);
            if (sp) {
                if (col === lbState.sortCol) { sp.textContent = lbState.sortAsc ? '↑' : '↓'; sp.closest('th')?.classList.add('sort-active'); }
                else sp.textContent = '↕';
            }
        });

        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--text-tertiary);">No operatives match filter.</td></tr>';
            return;
        }
        tbody.innerHTML = list.map(m => `
            <tr style="cursor:pointer;" onclick="openOcDossier('${m.playerId}')" title="Open Operative Crime Dossier">
                <td class="sticky-col"><strong>${escapeHtml(m.name)}</strong><div style="font-size:0.78em; color:var(--text-tertiary); font-family:var(--font-mono);">Lv ${m.level} • [${m.playerId}]</div></td>
                <td><span class="status-pill" style="color:${m.rankColor}; border:1px solid ${m.rankColor};">${m.rankLabel}</span></td>
                <td>${m.activeOcName ? `<span style="color:#38bdf8; font-weight:700;">${escapeHtml(m.activeOcName)}</span><div style="font-size:0.78em; color:var(--text-tertiary);">${escapeHtml(m.activeOcRole || '')}</div>` : '<span style="color:#fbbf24;">On Bench</span>'}</td>
                <td class="font-mono">${m.wins}/${m.completed}</td>
                <td class="font-mono" style="color:${m.hasHistory ? (m.passRate >= 75 ? '#34d399' : '#fbbf24') : 'var(--text-tertiary)'};">${m.hasHistory ? `${m.passRate}%` : '—'}</td>
                <td><span class="cpr-badge ${getCprBadgeClass(m.avgCpr)}">${m.avgCpr}%</span></td>
                <td class="font-mono" style="font-weight:800; color:#34d399;">${fmtCompactMoney(m.grossCash)}</td>
                <td class="font-mono" style="color:#c4b5fd;">+${fmt(m.respect)}</td>
                <td class="font-mono">${fmtCompactMoney(m.gearSupplied)}</td>
                <td class="font-mono" style="font-weight:900; color:${m.reliability >= 85 ? '#34d399' : (m.reliability >= 65 ? '#fbbf24' : '#fb7185')};">${m.reliability}%</td>
            </tr>`).join('');
    };

    window.openOcDossier = function (playerId) {
        const m = analytics.memberProfileMap.get(String(playerId));
        if (!m) return;
        const overlay = document.getElementById('oc-dossier-overlay');
        const panel = document.getElementById('oc-dossier-panel');
        if (!overlay || !panel) return;

        let sparkSvg = '<div style="font-size:0.78em; color:var(--text-tertiary);">No CPR trend points recorded yet.</div>';
        if (m.cprHistory.length > 1) {
            const pts = m.cprHistory.slice(-15), w = 480, h = 72;
            const coords = pts.map((p, i) => `${Math.round((i / (pts.length - 1)) * (w - 20) + 10)},${Math.round(h - 10 - ((Math.max(20, Math.min(100, p.cpr)) - 20) / 80) * (h - 20))}`).join(' ');
            sparkSvg = `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:72px; background:rgba(10,15,28,0.8); border-radius:8px; border:1px solid var(--oc-border-cyan);"><polyline fill="none" stroke="#38bdf8" stroke-width="2.5" points="${coords}"/></svg>`;
        }

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                    <h2 style="margin:0; font-size:1.25em; font-weight:900;">${escapeHtml(m.name)} <span style="color:var(--text-tertiary); font-size:0.78em;">[${m.playerId}]</span></h2>
                    <div style="font-size:0.8em; color:var(--text-secondary); margin-top:3px;">Level ${m.level} • ${m.rankLabel} • Reliability: <strong style="color:#38bdf8;">${m.reliability}%</strong></div>
                </div>
                <button class="oc-close-btn" onclick="closeOcDossier()" aria-label="Close Operative Dossier">${CLOSE_SVG}</button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px;">
                <div class="oc-kpi-card" style="padding:10px;"><div class="oc-kpi-top">Pass Rate</div><div class="oc-kpi-val" style="font-size:1.1em;">${m.hasHistory ? `${m.passRate}%` : '—'}</div><div class="oc-kpi-sub">${m.wins}W / ${m.fails}F</div></div>
                <div class="oc-kpi-card" style="padding:10px;"><div class="oc-kpi-top">Avg CPR</div><div class="oc-kpi-val" style="font-size:1.1em; color:#38bdf8;">${m.avgCpr}%</div><div class="oc-kpi-sub">Active: ${escapeHtml(m.activeOcName || 'Bench')}</div></div>
                <div class="oc-kpi-card" style="padding:10px;"><div class="oc-kpi-top">Generated</div><div class="oc-kpi-val" style="font-size:1.1em; color:#34d399;">${fmtCompactMoney(m.grossCash)}</div><div class="oc-kpi-sub">+${fmt(m.respect)} Resp</div></div>
            </div>
            ${m.deductions.length ? `<div class="oc-alert-strip" style="margin:0;"><strong>Reliability Deductions:</strong> ${m.deductions.map(escapeHtml).join(' • ')}</div>` : ''}
            <div>
                <div style="font-size:0.78em; font-weight:800; color:var(--text-tertiary); text-transform:uppercase; margin-bottom:6px;">Role-Specific CPR Ratings</div>
                ${m.roleBars.length ? m.roleBars.map(rb => `<div style="margin-bottom:6px;"><div style="display:flex; justify-content:space-between; font-size:0.78em; margin-bottom:2px;"><span>${escapeHtml(rb.role)}</span><strong class="font-mono">${rb.val}% [Exact]</strong></div><div style="height:6px; background:rgba(255,255,255,0.08); border-radius:4px;"><div style="height:100%; width:${rb.val}%; background:#38bdf8; border-radius:4px;"></div></div></div>`).join('') : '<div style="font-size:0.8em; color:var(--text-tertiary);">No role CPR samples yet.</div>'}
            </div>
            <div><div style="font-size:0.78em; font-weight:800; color:var(--text-tertiary); text-transform:uppercase; margin-bottom:6px;">CPR History Trend</div>${sparkSvg}</div>
            <div>
                <div style="font-size:0.78em; font-weight:800; color:var(--text-tertiary); text-transform:uppercase; margin-bottom:6px;">Recent Organized Crimes (${m.recentCrimes.length})</div>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    ${m.recentCrimes.slice(0, 10).map(rc => `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:rgba(15,23,42,0.85); border:1px solid var(--border-subtle); border-radius:8px; font-size:0.78em;"><div><strong>[T${rc.difficulty}] ${escapeHtml(rc.name)}</strong><div style="color:var(--text-tertiary);">${escapeHtml(rc.role)} (${rc.cpr}% CPR) • ${formatTctDate(rc.executedAt)}</div></div><span class="status-pill ${rc.status === 'Successful' ? 'pill-ready' : 'pill-recruiting'}">${rc.status === 'Successful' ? fmtCompactMoney(rc.rewardShare) : escapeHtml(rc.outcome)}</span></div>`).join('') || '<div style="font-size:0.8em; color:var(--text-tertiary);">No recent completed OCs found.</div>'}
                </div>
            </div>`;
        overlay.classList.add('open');
    };

    window.closeOcDossier = function () {
        document.getElementById('oc-dossier-overlay')?.classList.remove('open');
    };

    function renderPostMortems() {
        const el = document.getElementById('postmortem-list');
        if (!el) return;
        const pms = analytics.postMortems;
        if (!pms.length) {
            el.innerHTML = '<div style="padding:18px; color:var(--text-tertiary); font-size:0.84em;">🎉 No failed OCs in recent history!</div>';
            return;
        }
        el.innerHTML = pms.map(pm => {
            const c = pm.crime, bn = pm.bottleneck;
            return `
                <div class="bench-card" style="border-color:rgba(244,63,94,0.38);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <div><strong style="color:#fda4af;">❌ [T${c.difficulty}] ${escapeHtml(c.name)}</strong><div style="font-size:0.75em; color:var(--text-tertiary);">#${c.id} • ${formatTctDate(c.executed_at || c.ready_at || 0)}</div></div>
                        <span class="cpr-badge cpr-risk">Avg ${pm.avgCpr}%</span>
                    </div>
                    ${bn ? `<div style="font-size:0.79em;"><strong>Bottleneck Slot:</strong> ${escapeHtml(bn.position_info?.label || bn.position)} — ${escapeHtml(bn.user?.name || '')} (${bn.checkpoint_pass_rate}% CPR)</div>` : ''}
                    <div style="display:flex; gap:5px; flex-wrap:wrap;">${pm.recovery.map(r => `<span class="tag" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); padding:2px 7px; border-radius:5px; font-size:0.73em;">${escapeHtml(r.name)}: ${r.blocker.blocked ? r.blocker.label : '✅ Clear'}</span>`).join('')}</div>
                    <div style="font-size:0.77em; color:#fde68a; background:rgba(245,158,11,0.08); padding:7px 9px; border-radius:6px; border:1px solid rgba(245,158,11,0.25);">💡 ${escapeHtml(pm.tip)}</div>
                </div>`;
        }).join('');
    }

    // ─── Modals: Broadcast Studio & CPR Import ───
    window.openBroadcastModal = function (crimeId = null) {
        broadcastCrimeId = crimeId;
        document.getElementById('broadcast-modal')?.classList.add('open');
        renderBroadcastPreview();
    };
    window.closeBroadcastModal = function () {
        document.getElementById('broadcast-modal')?.classList.remove('open');
    };
    window.setBroadcastTab = function (tab) {
        broadcastTab = tab;
        document.getElementById('bc-tab-discord')?.classList.toggle('active', tab === 'discord');
        document.getElementById('bc-tab-torn')?.classList.toggle('active', tab === 'torn');
        renderBroadcastPreview();
    };
    window.renderBroadcastPreview = function () {
        const area = document.getElementById('bc-preview-text');
        const cntEl = document.getElementById('bc-char-counter');
        const mention = (document.getElementById('bc-mention-input')?.value || '@OC-Ready').trim();
        if (!area) return;

        const targetCrimes = analytics.activeAnnotated.filter(c => c.phase === 'recruiting' && (!broadcastCrimeId || String(c.id) === String(broadcastCrimeId)));
        let text = '';
        if (broadcastTab === 'discord') {
            if (!targetCrimes.length) text = `${mention} No open Recruiting OC slots right now!`;
            else {
                const blocks = targetCrimes.map(c => {
                    const openLines = (c.slots || []).filter(s => !s.user).map(s => {
                        const role = s.position_info?.label || s.position;
                        const itemTxt = s.item_requirement ? ` • Requires: ${s.item_requirement.name} (~${fmtCompactMoney(s.item_requirement.market_value)})` : '';
                        return `  • Need **${role}** (Min ${c.floor}% CPR${itemTxt})`;
                    }).join('\n');
                    return `**🎯 ${c.name} [Tier ${c.tier}]** (Est. ${fmtCompactMoney(c.estCash)} • +${c.estRespect} Resp)\n${openLines}`;
                });
                text = `${mention} 📢 **OPEN ORGANIZED CRIME SLOTS**\n\n${blocks.join('\n\n')}\n\n👉 Join now: https://www.torn.com/factions.php?step=your#/tab=crimes`;
            }
        } else {
            if (!targetCrimes.length) text = 'OPEN OCs: All current recruiting slots filled!';
            else {
                const compactParts = targetCrimes.map(c => `[${c.name}: Need ${(c.slots || []).filter(s => !s.user).map(s => `${s.position_info?.label || s.position} ${c.floor}%+`).slice(0, 3).join(', ')}]`);
                text = `📢 OPEN OCs: ${compactParts.join(' • ')} — Join Faction Crimes!`;
                if (text.length > 248) text = text.slice(0, 245) + '...';
            }
        }
        area.value = text;
        if (cntEl) cntEl.textContent = `${text.length}${broadcastTab === 'torn' ? ' / 250 max chars' : ' chars'}`;
    };
    window.copyBroadcastText = function () {
        copyText(document.getElementById('bc-preview-text')?.value || '', '📢 Broadcast callout copied!');
    };

    window.openCprModal = function () {
        document.getElementById('cpr-floor-low').value = cprFloors.low;
        document.getElementById('cpr-floor-high').value = cprFloors.high;
        const tsKey = typeof window.getTornStatsKey === 'function' ? window.getTornStatsKey() : (localStorage.getItem('warboard_tskey') || '');
        const inp = document.getElementById('cpr-tornstats-key');
        if (inp && tsKey) inp.placeholder = 'Connected from Global Settings (leave blank to reuse)';
        document.getElementById('cpr-modal')?.classList.add('open');
    };
    window.closeCprModal = function () {
        document.getElementById('cpr-modal')?.classList.remove('open');
    };
    window.saveCprSettingsAndSync = async function () {
        const low = Math.max(10, Math.min(100, Number(document.getElementById('cpr-floor-low')?.value || 70)));
        const high = Math.max(10, Math.min(100, Number(document.getElementById('cpr-floor-high')?.value || 65)));
        cprFloors = { low, high };
        localStorage.setItem(STORAGE_FLOORS_KEY, JSON.stringify(cprFloors));

        const manualRaw = (document.getElementById('cpr-manual-json')?.value || '').trim();
        let manualOverrides = null;
        if (manualRaw) {
            try { manualOverrides = JSON.parse(manualRaw); }
            catch (_) { return showOcToast('⚠️ Invalid JSON in manual CPR overrides'); }
        }
        const rawTsKey = (document.getElementById('cpr-tornstats-key')?.value || '').trim()
            || (typeof window.getTornStatsKey === 'function' ? window.getTornStatsKey() : '');

        if (rawTsKey || manualOverrides) {
            try {
                const res = await fetch('/api/oc/cpr-import', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tornStatsKey: rawTsKey, manualOverrides })
                });
                const d = await res.json();
                if (!res.ok || d.error) showOcToast(`⚠️ CPR Import notice: ${d.error}`);
                else {
                    cmdData.cprOverrides = d.overrides || cmdData.cprOverrides;
                    showOcToast(`✅ Saved floors & imported ${d.importedCount || 0} CPR entries!`);
                }
            } catch (e) { showOcToast(`⚠️ CPR Sync failed: ${e.message}`); }
        } else {
            showOcToast(`✅ Saved Safe Floors: Tiers 1–4 (${low}%), Tiers 5–8 (${high}%)`);
        }
        closeCprModal();
        recomputeCommandAnalytics();
        renderAllActiveViews();
    };

    // ─── Master Render + 1s Countdown Ticker ───
    function renderAllActiveViews() {
        renderKpisAndHeader();
        if (currentView === 'board') renderBoard();
        else if (currentView === 'workbench') renderWorkbenchView();
        else if (currentView === 'payouts') renderPayoutsWorkspace();
        else if (currentView === 'intel') renderIntelWorkspace();
    }

    function startLiveTicker() {
        if (liveTickTimer) clearInterval(liveTickTimer);
        liveTickTimer = setInterval(() => {
            const nowSec = Math.floor(Date.now() / 1000);
            let needRecompute = false;

            const nextEl = document.getElementById('kpi-next-timer');
            if (nextEl?.dataset.nextReadyAt) {
                const rem = Number(nextEl.dataset.nextReadyAt) - nowSec;
                nextEl.textContent = rem > 0 ? `Next in ${formatCountdown(rem)}` : 'Transitioning to Ready...';
                if (rem <= 0) needRecompute = true;
            }
            document.querySelectorAll('[data-ready]').forEach(el => {
                const rem = Number(el.dataset.ready) - nowSec;
                if (rem <= 0) {
                    if (el.textContent !== 'READY!') { el.textContent = 'READY!'; el.style.color = '#34d399'; needRecompute = true; }
                } else el.textContent = formatCountdown(rem);
            });
            document.querySelectorAll('[data-expired]').forEach(el => {
                const rem = Number(el.dataset.expired) - nowSec;
                el.textContent = rem <= 0 ? 'Expired' : formatCountdown(rem);
            });
            document.querySelectorAll('[data-idle-since]').forEach(el => {
                const idleSec = Math.max(0, nowSec - Number(el.dataset.idleSince));
                el.textContent = `Idling ${formatDurationShort(idleSec)}`;
                el.style.color = idleSec > 7200 ? '#fb7185' : '#fbbf24';
            });
            document.querySelectorAll('[data-until]').forEach(el => {
                const rem = Number(el.dataset.until) - nowSec;
                el.textContent = rem > 0 ? formatDurationShort(rem) : '0s (Clear)';
            });

            if (needRecompute && cmdData.crimes.length) {
                recomputeCommandAnalytics();
                renderAllActiveViews();
            }
        }, 1000);
    }

    // ─── Listeners & Bootstrap ───
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeOcDossier(); closeBroadcastModal(); closeCprModal(); window.closeSettings(); }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopProgressBar();
        else if (hasOcAccess()) window.fetchOCs(false);
    });

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('oc-search-input')?.addEventListener('input', debounce(() => renderBoardCrimesOnly(), 150));
        document.getElementById('bench-search-input')?.addEventListener('input', debounce(() => renderWorkbenchBenchGrid(), 150));
        document.getElementById('lb-search-input')?.addEventListener('input', debounce(() => window.renderLeaderboard(), 150));
        document.getElementById('hm-search-input')?.addEventListener('input', debounce(() => window.renderRoleHeatmap(), 150));

        document.getElementById('gantt-btn-24')?.classList.toggle('active', ganttWindowHours === 24);
        document.getElementById('gantt-btn-72')?.classList.toggle('active', ganttWindowHours === 72);

        const rawHash = (window.location.hash || '').replace('#', '').toLowerCase();
        if (['board', 'workbench', 'payouts', 'intel', 'bench', 'roi', 'leaderboard', 'economics'].includes(rawHash)) {
            window.switchOcView(rawHash, false);
        } else if (['recruiting', 'planning', 'ready'].includes(rawHash)) {
            currentView = 'board';
            currentBoardTab = rawHash;
            document.querySelectorAll('#board-status-pills .tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-${rawHash}`));
        }

        try {
            const cached = sessionStorage.getItem(STORAGE_CACHE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && Array.isArray(parsed.crimes)) {
                    cmdData = parsed;
                    recomputeCommandAnalytics();
                    renderAllActiveViews();
                }
            }
        } catch (_) {}

        startLiveTicker();
        window.fetchOCs(false);
    });
})();
