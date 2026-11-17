/* ═══════════════════════════════════════════════════════════════════════════
   FactionOS — Torn City OC 2.0 Command Center Engine (All 15 Management Tools)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ─── Persistent State & Preferences ───
    const STORAGE_CACHE_KEY = 'sv_cache_oc_cmd_v2';
    const STORAGE_FLOORS_KEY = 'sv_oc_cpr_floors_v1';
    const STORAGE_VAULT_KEY = 'sv_oc_vault_cut_v1';
    const STORAGE_PAYOUT_MODE_KEY = 'sv_oc_payout_mode_v1';
    const STORAGE_GANTT_HOURS_KEY = 'sv_oc_gantt_hours_v1';
    const REFRESH_MS = 300000;

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
        ocMemberHistory: {}
    };

    let analytics = {
        activeAnnotated: [],
        bench: { all: [], available: [], blocked: [], inactive: [] },
        memberProfiles: [],
        memberProfileMap: new Map(),
        roleCprMatrix: new Map(),
        openSlotMatches: [],
        missingGearList: [],
        spawnPlan: { demand: 0, availBench: 0, readyCrew: 0, finishingSoon: 0, openSlots: 0, recommendations: [], formulaText: '' },
        postMortems: [],
        warConflictsCount: 0,
        kpis: {}
    };

    let currentView = 'board';       // board | bench | payouts | roi | leaderboard | economics
    let currentBoardTab = 'all';     // all | recruiting | planning | ready | blocked
    let safePreWarOnly = false;
    let ganttWindowHours = Number(localStorage.getItem(STORAGE_GANTT_HOURS_KEY) || 24);
    let ganttCollapsed = localStorage.getItem('sv_oc_gantt_collapsed') === 'true';
    let benchBucket = 'all';         // all | available | blocked | inactive
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
        const d = new Date(Number(unixSec) * 1000);
        return d.toISOString().slice(11, 16) + ' TCT';
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
        setTimeout(() => div.remove(), 3500);
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
        const n = String(name || '').toLowerCase();
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

    // ─── Canonical Auth & Session Resolution ───
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

    // ─── Navigation & Tab Switching ───
    window.switchOcView = function (viewKey, updateHash = true) {
        const valid = ['board', 'bench', 'payouts', 'roi', 'leaderboard', 'economics'];
        const safe = valid.includes(viewKey) ? viewKey : 'board';
        currentView = safe;

        document.querySelectorAll('.oc-view-tab').forEach(b => b.classList.toggle('active', b.id === `view-tab-${safe}`));
        document.querySelectorAll('.oc-view-pane').forEach(p => p.classList.toggle('active', p.id === `pane-${safe}`));

        if (updateHash) {
            try {
                if (window.location.hash !== `#${safe}`) window.history.replaceState(null, '', `#${safe}`);
            } catch (_) {}
        }

        if (safe === 'board') renderBoard();
        else if (safe === 'bench') renderBenchView();
        else if (safe === 'payouts') renderPayoutsView();
        else if (safe === 'roi') renderRoiAndSimulatorView();
        else if (safe === 'leaderboard') renderLeaderboardView();
        else if (safe === 'economics') renderEconomicsView();
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

    // ─── Core Data Fetch & Fallback Support (/api/oc/command-center -> /api/ocs) ───
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
                // Graceful fallback to legacy /api/ocs endpoint (also supports mock test harnesses)
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
                    ocMemberHistory: data.ocMemberHistory || {}
                };
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
                    to unlock all 15 OC 2.0 Command Tools.
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

    // ─── Analytics Engine Across All 15 Tools ───
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

        if (state === 'Hospital') {
            return { blocked: true, code: 'Hospital', label: `🏥 Hosp ${remSec > 0 ? formatDurationShort(remSec) : ''}`.trim(), remSec: remSec || 600, detail: desc || 'Hospitalized' };
        }
        if (state === 'Jail' || state === 'Federal') {
            return { blocked: true, code: state, label: `⛓️ ${state} ${remSec > 0 ? formatDurationShort(remSec) : ''}`.trim(), remSec: remSec || 900, detail: desc || state };
        }
        if (state === 'Traveling' || desc.toLowerCase().includes('traveling')) {
            return { blocked: true, code: 'Traveling', label: '✈️ Flying', remSec: remSec || 1800, detail: desc || 'Traveling' };
        }
        if (state === 'Abroad') {
            return { blocked: true, code: 'Abroad', label: '🌐 Abroad', remSec: remSec || 2400, detail: desc || 'Abroad' };
        }
        return { blocked: false, code: 'Okay', label: '🟢 Okay', remSec: 0, detail: 'In Torn' };
    }

    function lookupEstimatedCpr(playerId, crimeName, role, tier) {
        const pKey = String(playerId);
        const overrides = (cmdData.cprOverrides || {})[pKey] || {};
        const specificKey = `${crimeName}::${role}`;
        if (typeof overrides[specificKey] === 'number') return overrides[specificKey];
        if (typeof overrides[role] === 'number') return overrides[role];

        const matrix = analytics.roleCprMatrix.get(pKey);
        if (matrix) {
            if (typeof matrix.bySpecific[specificKey] === 'number') return matrix.bySpecific[specificKey];
            if (typeof matrix.byRole[role] === 'number') return matrix.byRole[role];
            if (typeof matrix.overallAvg === 'number') {
                const diffPenalty = Math.max(0, (Number(tier || 2) - (matrix.avgTier || 2)) * 5);
                return Math.max(25, Math.min(99, Math.round(matrix.overallAvg - diffPenalty)));
            }
        }
        // Heuristic fallback by player level & crime tier if zero OC history yet
        const mem = cmdData.members[pKey];
        const lvl = Number(mem?.level || 25);
        const base = Math.min(92, Math.max(48, 52 + Math.round(lvl * 0.45) - (Number(tier || 2) - 1) * 4));
        return base;
    }

    function recomputeCommandAnalytics() {
        const nowSec = Math.floor(Date.now() / 1000);
        const members = cmdData.members || {};
        const activeCrimesRaw = (cmdData.crimes || []).filter(c => {
            const ph = getPhaseForCrime(c, nowSec);
            return ph === 'recruiting' || ph === 'planning' || ph === 'ready';
        });
        const completedRaw = cmdData.completedCrimes || [];

        // 1. Build historical role CPR matrix & stats per member
        const roleCprMap = new Map();
        const memStats = {};
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
                    tierSum: 0,
                    grossCash: 0,
                    respect: 0,
                    gearSupplied: 0,
                    lastCompletedAt: Number((cmdData.ocMemberHistory || {})[k] || 0) / ((Number((cmdData.ocMemberHistory || {})[k] || 0) > 1e12) ? 1000 : 1),
                    recentCrimes: [],
                    cprHistory: [],
                    roleAgg: {},
                    specAgg: {}
                };
            }
            return memStats[k];
        };

        // Process completed crimes chronologically (oldest -> newest for CPR trend, then reverse)
        const completedChron = [...completedRaw].sort((a, b) => (a.executed_at || 0) - (b.executed_at || 0));
        completedChron.forEach(c => {
            const isWin = String(c.status || '').toLowerCase() === 'successful';
            const slots = c.slots || [];
            const crewCount = Math.max(1, slots.filter(s => s.user?.id).length);
            const crimeGross = Number(c.rewards?.gross_total ?? ((c.rewards?.money || 0) + (c.rewards?.item_value_total || 0)));
            const crimeResp = Number(c.rewards?.respect || 0);
            const execAt = Number(c.executed_at || c.ready_at || 0);

            slots.forEach(s => {
                if (!s.user?.id) return;
                const rec = ensureMem(s.user.id);
                const role = s.position || s.position_info?.label || 'Operative';
                const cpr = Number(s.checkpoint_pass_rate || 0);
                rec.completed++;
                if (isWin) rec.wins++; else rec.fails++;
                if (cpr > 0) {
                    rec.cprSum += cpr;
                    rec.cprCount++;
                    rec.tierSum += Number(c.difficulty || 1);
                    rec.cprHistory.push({ ts: execAt, cpr, crime: c.name, role });
                    if (!rec.roleAgg[role]) rec.roleAgg[role] = { sum: 0, cnt: 0, latest: 0 };
                    rec.roleAgg[role].sum += cpr;
                    rec.roleAgg[role].cnt++;
                    rec.roleAgg[role].latest = cpr;
                    const specKey = `${c.name}::${role}`;
                    rec.specAgg[specKey] = cpr;
                }
                if (isWin) {
                    rec.grossCash += crimeGross / crewCount;
                    rec.respect += crimeResp / crewCount;
                }
                if (s.user.item_outcome?.owned_by === 'user' && s.user.item_outcome?.outcome === 'used' && s.item_requirement && !s.item_requirement.is_reusable) {
                    rec.gearSupplied += Number(s.item_requirement.market_value || 0);
                } else if (s.item_requirement?.is_available && s.user.item_outcome?.owned_by === 'user' && !s.item_requirement.is_reusable) {
                    rec.gearSupplied += Number(s.item_requirement.market_value || 0);
                }
                if (execAt > rec.lastCompletedAt) rec.lastCompletedAt = execAt;
                rec.recentCrimes.push({
                    id: c.id,
                    name: c.name,
                    difficulty: c.difficulty || 1,
                    role,
                    cpr,
                    status: c.status,
                    outcome: s.user.outcome || c.status,
                    executedAt: execAt,
                    rewardShare: isWin ? Math.round(crimeGross / crewCount) : 0
                });
            });
        });

        // Also seed roleCprMatrix from active crimes
        activeCrimesRaw.forEach(c => {
            (c.slots || []).forEach(s => {
                if (!s.user?.id) return;
                const rec = ensureMem(s.user.id);
                const role = s.position || s.position_info?.label || 'Operative';
                const cpr = Number(s.checkpoint_pass_rate || 0);
                if (cpr > 0) {
                    rec.cprSum += cpr;
                    rec.cprCount++;
                    if (!rec.roleAgg[role]) rec.roleAgg[role] = { sum: 0, cnt: 0, latest: cpr };
                    rec.roleAgg[role].sum += cpr;
                    rec.roleAgg[role].cnt++;
                    rec.roleAgg[role].latest = cpr;
                    rec.specAgg[`${c.name}::${role}`] = cpr;
                }
            });
        });

        Object.entries(memStats).forEach(([k, rec]) => {
            const byRole = {};
            Object.entries(rec.roleAgg).forEach(([r, agg]) => {
                byRole[r] = Math.round(agg.latest || (agg.sum / Math.max(1, agg.cnt)));
            });
            roleCprMap.set(k, {
                overallAvg: rec.cprCount > 0 ? Math.round(rec.cprSum / rec.cprCount) : null,
                avgTier: rec.cprCount > 0 ? (rec.tierSum / rec.cprCount) : 2,
                byRole,
                bySpecific: rec.specAgg
            });
            rec.recentCrimes.reverse();
        });
        analytics.roleCprMatrix = roleCprMap;

        // 2. Map active crime occupancy & War window boundaries
        const activeMemSlot = new Map();
        const catalogMap = new Map((cmdData.catalog || []).map(x => [String(x.name || '').toLowerCase(), x]));
        const war = cmdData.warState?.activeWar || cmdData.warState?.nextScheduledWar || null;
        const warStart = Number(war?.start || 0);
        const warEnd = Number(war?.end || (warStart ? warStart + 5 * 86400 : 0));

        const missingGearMap = new Map();
        const blockingMemberIds = new Set();

        const annotatedCrimes = activeCrimesRaw.map(c => {
            const phase = getPhaseForCrime(c, nowSec);
            const tier = Number(c.difficulty || 1);
            const floor = getMinSafeFloor(tier);
            const cat = catalogMap.get(String(c.name || '').toLowerCase()) || null;
            const slots = c.slots || [];
            const filledSlots = slots.filter(s => s.user?.id).length;
            const totalSlots = slots.length;
            const emptySlots = totalSlots - filledSlots;

            let sumCpr = 0;
            let cprCnt = 0;
            let lowCprCount = 0;
            const blockedCrew = [];
            const inactiveCrew = [];
            const missingItems = [];

            let earliestJoined = Number(c.created_at || nowSec);
            slots.forEach(s => {
                if (s.user?.joined_at && s.user.joined_at < earliestJoined) earliestJoined = s.user.joined_at;
                if (s.user?.id) {
                    activeMemSlot.set(String(s.user.id), { crime: c, phase, role: s.position_info?.label || s.position });
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
                if (s.item_requirement && !s.item_requirement.is_available) {
                    const itemObj = {
                        crimeId: c.id,
                        crimeName: c.name,
                        role: s.position_info?.label || s.position,
                        playerId: s.user?.id || null,
                        playerName: s.user?.name || (s.user ? `ID:${s.user.id}` : 'Open Slot'),
                        itemId: s.item_requirement.id,
                        itemName: s.item_requirement.name || `Item #${s.item_requirement.id}`,
                        marketValue: Number(s.item_requirement.market_value || 0),
                        armoryAvail: s.item_requirement.armory_available
                    };
                    missingItems.push(itemObj);
                    if (s.user?.id) {
                        const mKey = String(itemObj.itemId);
                        if (!missingGearMap.has(mKey)) {
                            missingGearMap.set(mKey, { ...itemObj, qtyNeeded: 0, usages: [] });
                        }
                        const gAgg = missingGearMap.get(mKey);
                        gAgg.qtyNeeded++;
                        gAgg.usages.push(`${itemObj.playerName} (${itemObj.crimeName})`);
                    }
                }
            });

            const avgCpr = cprCnt > 0 ? Number((sumCpr / cprCnt).toFixed(1)) : 0;
            const allClearEtaSec = blockedCrew.reduce((mx, b) => Math.max(mx, b.remSec || 0), 0);
            const isLaunchBlocked = (phase === 'ready' || (phase === 'planning' && c.ready_at && (c.ready_at - nowSec) <= 7200)) && blockedCrew.length > 0;

            // Tool 9 Stall Detector
            const waitHours = Math.max(0, (nowSec - earliestJoined) / 3600);
            const isHostageStall = phase === 'recruiting' && filledSlots >= 1 && emptySlots >= 1 && emptySlots <= 2 && waitHours > 18;
            const isInactiveStall = (phase === 'planning' || phase === 'ready') && inactiveCrew.length > 0;

            // Tool 8 War Conflict
            const planDays = cat?.planningDays || (tier + 2);
            const projectedEndSec = phase === 'ready' ? nowSec : (Number(c.ready_at || 0) > 0 ? Number(c.ready_at) : nowSec + planDays * 86400);
            const warOverlap = Boolean(warStart && projectedEndSec >= warStart && projectedEndSec <= warEnd);

            // Est payout from observed rewards or catalog
            const estCash = Number(c.rewards?.gross_total || ((cat?.estCash || 0) + (cat?.estItemValue || 0)) || (tier * 3500000));
            const estRespect = Number(c.rewards?.respect || cat?.estRespect || (tier * 35));
            const wastedReadinessSec = phase === 'ready' && c.ready_at && c.ready_at < nowSec ? (nowSec - c.ready_at) : 0;
            const needsAttention = isLaunchBlocked || isHostageStall || isInactiveStall || missingItems.some(i => i.playerId) || lowCprCount > 0;

            return {
                ...c,
                phase,
                tier,
                floor,
                filledSlots,
                emptySlots,
                totalSlots,
                avgCpr,
                lowCprCount,
                blockedCrew,
                inactiveCrew,
                allClearEtaSec,
                isLaunchBlocked,
                isHostageStall,
                waitHours: Math.round(waitHours),
                isInactiveStall,
                missingItems,
                needsAttention,
                warOverlap,
                projectedEndSec,
                estCash,
                estRespect,
                wastedReadinessSec,
                planDays
            };
        });
        analytics.activeAnnotated = annotatedCrimes;
        analytics.missingGearList = Array.from(missingGearMap.values());
        analytics.warConflictsCount = annotatedCrimes.filter(c => c.warOverlap).length;

        // 3. Classify Unassigned Bench (Tool 1)
        const benchAll = [];
        const benchAvail = [];
        const benchBlocked = [];
        const benchInactive = [];

        Object.values(members).forEach(m => {
            const pKey = String(m.id);
            if (activeMemSlot.has(pKey)) return;
            const lastTs = Number(m.last_action?.timestamp || 0);
            const offlineSec = lastTs > 0 ? Math.max(0, nowSec - lastTs) : 999999;
            const state = String(m.status?.state || 'Okay');
            const daysInFac = Number(m.days_in_faction || 0);
            const blocker = getMemberLiveBlocker(m, nowSec);
            const prof = roleCprMap.get(pKey);
            const estAvgCpr = prof?.overallAvg ?? lookupEstimatedCpr(m.id, 'Best of the Lot', 'Muscle', 2);
            const estTier = estAvgCpr >= 80 ? 'T5–T7 Ready' : (estAvgCpr >= 70 ? 'T3–T5 Ready' : 'T1–T3 Ready');
            const recHist = memStats[pKey];
            const lastOcSec = recHist?.lastCompletedAt || 0;
            const daysSinceLastOc = lastOcSec > 0 ? Math.max(0, Math.round((nowSec - lastOcSec) / 86400)) : null;

            let bucket = 'available';
            let exemptReason = '';
            if (offlineSec > 86400) {
                bucket = 'inactive';
                exemptReason = `Offline ${Math.floor(offlineSec / 3600)}h`;
            } else if (state === 'Federal') {
                bucket = 'inactive';
                exemptReason = 'Federal Jail';
            } else if (daysInFac < 3) {
                bucket = 'inactive';
                exemptReason = `New Recruit (${daysInFac}d)`;
            } else if (blocker.blocked) {
                bucket = 'blocked';
                exemptReason = blocker.detail;
            }

            const entry = {
                ...m,
                bucket,
                exemptReason,
                blocker,
                offlineSec,
                estAvgCpr,
                estTier,
                daysSinceLastOc
            };
            benchAll.push(entry);
            if (bucket === 'available') benchAvail.push(entry);
            else if (bucket === 'blocked') benchBlocked.push(entry);
            else benchInactive.push(entry);
        });
        benchAvail.sort((a, b) => b.estAvgCpr - a.estAvgCpr);
        analytics.bench = { all: benchAll, available: benchAvail, blocked: benchBlocked, inactive: benchInactive };

        // 4. Smart Role & CPR Auto-Matcher (Tool 3)
        const openSlots = [];
        annotatedCrimes.filter(c => c.phase === 'recruiting').forEach(c => {
            (c.slots || []).forEach((s, idx) => {
                if (!s.user) {
                    openSlots.push({
                        crimeId: c.id,
                        crimeName: c.name,
                        tier: c.tier,
                        floor: c.floor,
                        slotIdx: idx,
                        role: s.position_info?.label || s.position || 'Operative',
                        rawRole: s.position || 'Operative',
                        itemReq: s.item_requirement || null,
                        slotRef: s
                    });
                }
            });
        });

        // Sort harder tiers first so specialists get right tier, while penalizing wasting >=90% veterans on T1-2
        openSlots.sort((a, b) => b.tier - a.tier);
        const pool = [...benchAvail];
        const usedIds = new Set();
        const matchResults = [];

        openSlots.forEach(os => {
            let bestCand = null;
            let bestScore = -999999;
            let bestCpr = 0;

            pool.forEach(cand => {
                if (usedIds.has(cand.id)) return;
                const cpr = lookupEstimatedCpr(cand.id, os.crimeName, os.rawRole, os.tier);
                const overqualifiedPenalty = (os.tier <= 2 && cand.estAvgCpr >= 88 && cpr > os.floor + 12) ? (cand.estAvgCpr - os.floor) * 1.4 : 0;
                const meetsFloorBonus = cpr >= os.floor ? 40 : -35;
                const score = cpr + meetsFloorBonus - overqualifiedPenalty;
                if (score > bestScore) {
                    bestScore = score;
                    bestCand = cand;
                    bestCpr = cpr;
                }
            });

            if (bestCand) {
                usedIds.add(bestCand.id);
                os.slotRef._suggestedFit = { id: bestCand.id, name: bestCand.name, cpr: bestCpr, meetsFloor: bestCpr >= os.floor };
                matchResults.push({ ...os, matched: bestCand, cpr: bestCpr, meetsFloor: bestCpr >= os.floor });
            } else {
                os.slotRef._suggestedFit = null;
                matchResults.push({ ...os, matched: null, cpr: 0, meetsFloor: false });
            }
        });
        analytics.openSlotMatches = matchResults;

        // 5. Tool 10 Spawn Architect Demand
        const readyCrewCount = annotatedCrimes.filter(c => c.phase === 'ready').reduce((a, c) => a + c.filledSlots, 0);
        const finishingSoonCount = annotatedCrimes
            .filter(c => c.phase === 'planning' && c.ready_at && (c.ready_at - nowSec) <= 43200)
            .reduce((a, c) => a + c.filledSlots, 0);
        const openRecSlotsCount = openSlots.length;
        const demand = Math.max(0, benchAvail.length + readyCrewCount + finishingSoonCount - openRecSlotsCount);
        const recommendations = [];
        let remDemand = demand;
        const highReady = benchAvail.filter(m => m.estAvgCpr >= 78).length;
        if (remDemand >= 4 && highReady >= 3) {
            const t5 = Math.min(Math.floor(remDemand / 4), Math.floor(highReady / 3));
            if (t5 > 0) {
                recommendations.push({ label: `${t5}× Tier 4–5 Crime (4 slots)`, count: t5, tier: 4, slots: 4 });
                remDemand -= t5 * 4;
            }
        }
        while (remDemand >= 3) {
            const t2 = Math.floor(remDemand / 3);
            recommendations.push({ label: `${t2}× Tier 2–3 Crime (3 slots)`, count: t2, tier: 2, slots: 3 });
            remDemand -= t2 * 3;
        }
        if (remDemand > 0) {
            recommendations.push({ label: `1× Tier 1–2 Crime (${remDemand}–3 slots)`, count: 1, tier: 1, slots: 3 });
        }
        analytics.spawnPlan = {
            demand,
            availBench: benchAvail.length,
            readyCrew: readyCrewCount,
            finishingSoon: finishingSoonCount,
            openSlots: openRecSlotsCount,
            recommendations,
            formulaText: `${benchAvail.length} Bench Available + ${readyCrewCount} Ready + ${finishingSoonCount} Finishing (<12h) − ${openRecSlotsCount} Open Recruiting Slots = ${demand} New Slots Needed`
        };

        // 6. Tool 14 Full Member Profiles & Reliability Scores
        const profiles = Object.values(members).map(m => {
            const pKey = String(m.id);
            const h = memStats[pKey] || { completed: 0, wins: 0, fails: 0, cprSum: 0, cprCount: 0, grossCash: 0, respect: 0, gearSupplied: 0, recentCrimes: [], cprHistory: [], roleAgg: {} };
            const activeAssign = activeMemSlot.get(pKey) || null;
            const cprMat = roleCprMap.get(pKey);
            const avgCpr = cprMat?.overallAvg ?? lookupEstimatedCpr(m.id, 'Best of the Lot', 'Muscle', 2);
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

            let rankKey = 'reliable';
            let rankLabel = '⚡ Reliable Operative';
            let rankColor = '#38bdf8';
            if (reliability < 70 || blockingMemberIds.has(pKey)) {
                rankKey = 'risk';
                rankLabel = '⚠️ Bench / Blocker Risk';
                rankColor = '#fb7185';
            } else if (h.wins >= 6 && (passRate ?? 0) >= 75 && avgCpr >= 74) {
                rankKey = 'mastermind';
                rankLabel = '👑 Heist Mastermind';
                rankColor = '#fbbf24';
            } else if (h.gearSupplied >= 250000) {
                rankKey = 'sponsor';
                rankLabel = '🛠️ Gear Sponsor';
                rankColor = '#a78bfa';
            }

            const roleBars = Object.entries(cprMat?.byRole || {}).map(([role, val]) => ({ role, val })).sort((a, b) => b.val - a.val);

            return {
                playerId: Number(m.id),
                name: m.name,
                level: Number(m.level || 1),
                status: m.status,
                lastAction: m.last_action,
                activeOcName: activeAssign ? activeAssign.crime.name : null,
                activeOcPhase: activeAssign ? activeAssign.phase : null,
                activeOcRole: activeAssign ? activeAssign.role : null,
                completed: h.completed,
                wins: h.wins,
                fails: h.fails,
                passRate: passRate ?? 0,
                hasHistory: h.completed > 0,
                avgCpr,
                grossCash: Math.round(h.grossCash),
                respect: Math.round(h.respect),
                gearSupplied: Math.round(h.gearSupplied),
                reliability,
                deductions,
                rankKey,
                rankLabel,
                rankColor,
                roleBars,
                recentCrimes: h.recentCrimes,
                cprHistory: h.cprHistory
            };
        });
        analytics.memberProfiles = profiles;
        analytics.memberProfileMap = new Map(profiles.map(p => [String(p.playerId), p]));

        // 7. Tool 13 Post-Mortem Analyzer
        analytics.postMortems = completedRaw
            .filter(c => String(c.status || '').toLowerCase().includes('fail'))
            .slice(0, 18)
            .map(c => {
                const slots = c.slots || [];
                const filled = slots.filter(s => s.user);
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
                    ? `Missing required consumable (${missingGearSlot.item_requirement.name}) crippled team execution — verify Armory Stock pre-launch.`
                    : `Crew average was ${avg}%, but ${bnRole} slot was ${bnCpr}% CPR — enforce >=${floor}% floor on Tier ${c.difficulty || 1} roles.`;
                return { crime: c, bottleneck, avgCpr: avg, floor, recovery, tip };
            });

        // 8. Compute Top 6 KPIs
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
        let cashAndItems30d = 0;
        let respect30d = 0;
        completedRaw.forEach(c => {
            const ts = Number(c.executed_at || c.ready_at || 0);
            if (ts >= cutoff30 && String(c.status || '').toLowerCase() === 'successful') {
                cashAndItems30d += Number(c.rewards?.gross_total || ((c.rewards?.money || 0) + (c.rewards?.item_value_total || 0)));
                respect30d += Number(c.rewards?.respect || 0);
            }
        });

        analytics.kpis = {
            totalActive: annotatedCrimes.length,
            recruitingCount: recCnt,
            planningCount: planCnt,
            readyCount: readyCnt,
            totalRoster,
            assignedCount,
            benchCount: benchAll.length,
            coveragePct,
            nextReadyAt: nextPlan ? nextPlan.ready_at : null,
            avgCpr: allCprCnt > 0 ? (allCprSum / allCprCnt).toFixed(1) : '—',
            lowCprSlots: lowFloorCnt,
            lowFloorLabel: cprFloors.low,
            missingItemsCount: analytics.missingGearList.reduce((a, g) => a + g.qtyNeeded, 0),
            blockedCount: blockingMemberIds.size,
            cashAndItems30d,
            respect30d
        };
    }

    // ─── Render Executive KPI Ribbon + War Sync Pill ───
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

    // ─── View 1: Active Operations Board (Tools 1,2,3,4,7,8,9,10 + Crime Cards) ───
    window.renderBoard = renderBoard;
    function renderBoard() {
        // 1) Tool 1 Collapsible Bench Alert Strip
        const bStrip = document.getElementById('bench-alert-strip');
        if (bStrip) {
            const b = analytics.bench;
            if (b.all.length > 0) {
                bStrip.style.display = 'flex';
                bStrip.className = 'oc-alert-strip';
                bStrip.innerHTML = `
                    <div>
                        <strong>🪑 OC Bench Radar:</strong> <strong>${b.all.length}</strong> Faction Members unassigned —
                        <span style="color:#34d399; font-weight:700;">${b.available.length} Available Now</span>,
                        <span style="color:#fbbf24; font-weight:700;">${b.blocked.length} Blocked/Flying</span>,
                        <span style="color:var(--text-secondary);">${b.inactive.length} Offline/Exempt</span>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button class="oc-action-btn primary" onclick="switchOcView('bench')">View Bench &amp; Assign</button>
                        <button class="oc-action-btn" onclick="copyAvailableBenchPings()">📋 Copy Discord Pings</button>
                    </div>`;
            } else {
                bStrip.style.display = 'none';
            }
        }

        // 2) Tool 4 Consolidated Missing Consumables Bar
        const gearEl = document.getElementById('missing-gear-summary');
        if (gearEl) {
            const list = analytics.missingGearList;
            if (list.length > 0) {
                const totalCost = list.reduce((a, i) => a + i.marketValue * i.qtyNeeded, 0);
                const pills = list.map(i => `
                    <span class="item-pill missing" title="${escapeHtml(i.usages.join(', '))}">
                        ⚠️ ${i.qtyNeeded}× ${escapeHtml(i.itemName)} (~${fmtCompactMoney(i.marketValue * i.qtyNeeded)})
                        ${i.armoryAvail !== null ? `<span style="opacity:0.8;">• Armory: ${i.armoryAvail}</span>` : ''}
                        <a class="mini-icon-btn" href="https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${i.itemId}" target="_blank" rel="noopener noreferrer">🛒</a>
                    </span>`).join('');
                gearEl.style.display = 'flex';
                gearEl.className = 'oc-alert-strip crimson';
                gearEl.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                            <strong>🛠️ Missing Role Consumables Summary (${list.reduce((a, x) => a + x.qtyNeeded, 0)} items • Est. ${fmtMoney(totalCost)} total market cost)</strong>
                            <a class="mini-icon-btn" href="https://www.torn.com/factions.php?step=your#/tab=armoury&sub=utilities" target="_blank" rel="noopener noreferrer">📦 Open Faction Armory ↗</a>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">${pills}</div>
                    </div>`;
            } else {
                gearEl.style.display = 'none';
            }
        }

        // 3) Tool 10 Compact Spawn Strip
        const spEl = document.getElementById('board-spawn-strip');
        if (spEl) {
            const sp = analytics.spawnPlan;
            if (sp.demand > 0 && sp.recommendations.length > 0) {
                spEl.style.display = 'flex';
                spEl.className = 'oc-alert-strip cyan';
                spEl.innerHTML = `
                    <div>
                        <strong>🧬 Spawn Architect:</strong> ${escapeHtml(sp.formulaText)} →
                        <span style="color:#22d3ee; font-weight:800;">${sp.recommendations.map(r => r.label).join(' + ')}</span>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="oc-action-btn" onclick="switchOcView('bench')">Open Spawn Planner</button>
                        <a class="oc-action-btn primary" href="https://www.torn.com/factions.php?step=your#/tab=crimes" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">🚀 Spawn on Torn</a>
                    </div>`;
            } else {
                spEl.style.display = 'none';
            }
        }

        // 4) Tool 7 Timeline Gantt Chronometer
        renderTimelineGantt();

        // 5) Status counts + Enhanced OC Cards
        renderBoardCrimesOnly();
    }

    function renderTimelineGantt() {
        const panel = document.getElementById('timeline-gantt-panel');
        const body = document.getElementById('gantt-body');
        const collapseBtn = document.getElementById('gantt-collapse-btn');
        if (!panel || !body) return;

        body.style.display = ganttCollapsed ? 'none' : 'block';
        if (collapseBtn) collapseBtn.textContent = ganttCollapsed ? 'Show Timeline' : 'Hide Timeline';
        if (ganttCollapsed) return;

        const nowSec = Math.floor(Date.now() / 1000);
        const spanSec = ganttWindowHours * 3600;
        const endSec = nowSec + spanSec;

        // Next 00:00 TCT daily rollover timestamp
        const nowDate = new Date(nowSec * 1000);
        const nextMidnightSec = Math.floor(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() + 1, 0, 0, 0) / 1000);
        const midnightPct = (nextMidnightSec >= nowSec && nextMidnightSec <= endSec)
            ? ((nextMidnightSec - nowSec) / spanSec) * 100
            : null;

        const ticks = [];
        const stepH = ganttWindowHours === 24 ? 4 : 12;
        for (let h = 0; h <= ganttWindowHours; h += stepH) {
            ticks.push(h === 0 ? 'Now (TCT)' : `+${h}h`);
        }

        const items = [...analytics.activeAnnotated].sort((a, b) => a.projectedEndSec - b.projectedEndSec);
        if (items.length === 0) {
            body.innerHTML = '<div style="padding:12px 0; color:var(--text-tertiary); font-size:0.8em;">No active crimes to plot on timeline.</div>';
            return;
        }

        const rowsHtml = items.map(c => {
            let cls = c.phase;
            if (c.isLaunchBlocked || c.isHostageStall || c.isInactiveStall) cls = 'blocked';

            let leftPct = 0;
            let widthPct = 100;
            let barText = '';

            if (c.phase === 'ready') {
                leftPct = 0;
                widthPct = 36;
                const idleTxt = c.wastedReadinessSec > 0 ? ` • Idling ${formatDurationShort(c.wastedReadinessSec)}${c.wastedReadinessSec > 7200 ? '!' : ''}` : '';
                barText = `READY NOW${idleTxt}`;
            } else if (c.phase === 'planning' && c.ready_at) {
                const startBase = Number(c.planning_at || (c.ready_at - c.planDays * 86400));
                const remPct = Math.max(4, Math.min(100, ((c.ready_at - nowSec) / spanSec) * 100));
                leftPct = 0;
                widthPct = remPct;
                const overWindow = c.ready_at > endSec ? ` (+${Math.round((c.ready_at - endSec) / 3600)}h)` : '';
                barText = `${formatTctClock(c.ready_at)} / ${formatLocalShort(c.ready_at)}${overWindow}`;
                void startBase;
            } else {
                leftPct = 0;
                widthPct = 28;
                barText = `Recruiting (${c.filledSlots}/${c.totalSlots} slots)`;
            }

            return `
                <div class="gantt-row">
                    <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:0.78em; font-weight:700; color:var(--text-primary);">
                        <span style="color:#38bdf8;">[T${c.tier}]</span> ${escapeHtml(c.name)}
                    </div>
                    <div class="gantt-track">
                        ${midnightPct !== null ? `<div class="gantt-midnight-line" style="left:${midnightPct.toFixed(1)}%;" title="00:00 TCT Rollover"></div>` : ''}
                        <div class="gantt-pill ${cls}" style="left:${leftPct}%; width:${widthPct.toFixed(1)}%;" title="${escapeHtml(c.name)}: ${escapeHtml(barText)}">
                            ${escapeHtml(barText)}
                        </div>
                    </div>
                </div>`;
        }).join('');

        body.innerHTML = `
            <div class="gantt-axis">
                <span>Active Crime</span>
                <div class="gantt-ticks">${ticks.map(t => `<span>${t}</span>`).join('')}${midnightPct !== null ? `<span style="position:absolute; left:${midnightPct.toFixed(1)}%; top:-2px; color:#fbbf24; font-weight:800; transform:translateX(-50%);">00:00 TCT</span>` : ''}</div>
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

        let list = all.filter(c => {
            if (currentBoardTab === 'blocked') { if (!c.needsAttention) return false; }
            else if (currentBoardTab !== 'all') { if (c.phase !== currentBoardTab) return false; }

            if (safePreWarOnly && c.warOverlap) return false;

            if (tierFlt === '1-2' && c.tier > 2) return false;
            if (tierFlt === '3-4' && (c.tier < 3 || c.tier > 4)) return false;
            if (tierFlt === '5+' && c.tier < 5) return false;

            if (q) {
                const hay = [
                    c.name,
                    String(c.id),
                    ...(c.slots || []).map(s => `${s.position} ${s.position_info?.label || ''} ${s.user?.name || ''} ${s.user?.id || ''}`)
                ].join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        list.sort((a, b) => {
            if (sortBy === 'tier') return b.tier - a.tier || a.projectedEndSec - b.projectedEndSec;
            if (sortBy === 'ev') return b.estCash - a.estCash;
            if (sortBy === 'openslots') return b.emptySlots - a.emptySlots || b.tier - a.tier;
            // Soonest completion default (ready first, then planning ready_at, then recruiting)
            const orderA = a.phase === 'ready' ? 0 : (a.phase === 'planning' ? 1 : 2);
            const orderB = b.phase === 'ready' ? 0 : (b.phase === 'planning' ? 1 : 2);
            if (orderA !== orderB) return orderA - orderB;
            return a.projectedEndSec - b.projectedEndSec;
        });

        if (list.length === 0) {
            container.innerHTML = `
                <div class="oc-glass-panel" style="text-align:center; padding:34px;">
                    <div style="font-size:2em; margin-bottom:6px;">📋</div>
                    <strong style="font-size:1.05em;">No matching Organized Crimes</strong>
                    <div style="font-size:0.82em; color:var(--text-tertiary); margin-top:4px;">Adjust filters, tier range, or spawn new crimes from the Bench tab.</div>
                </div>`;
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
            const rem = Math.max(0, c.ready_at - nowSec);
            timerHtml = `<div class="timer-block"><div class="timer-big" style="color:#38bdf8;" data-ready="${c.ready_at}">${formatCountdown(rem)}</div><div class="timer-label">Until Ready (${formatTctClock(c.ready_at)})</div></div>`;
        } else if (c.expired_at) {
            const expRem = Math.max(0, c.expired_at - nowSec);
            timerHtml = `<div class="timer-block"><div class="timer-big" style="color:#fbbf24;" data-expired="${c.expired_at}">${formatCountdown(expRem)}</div><div class="timer-label">Recruit Window Left</div></div>`;
        }

        // Launch Readiness & Blocker / Stall Banners (Tools 2, 8, 9)
        const bannerParts = [];
        if (c.isLaunchBlocked) {
            const bNames = c.blockedCrew.map(b => `${escapeHtml(b.name)} (${escapeHtml(b.label)})`).join(', ');
            bannerParts.push(`
                <div class="oc-readiness-banner blocked">
                    <span>🔴 <strong>LAUNCH BLOCKED (All-Clear ETA: ${formatDurationShort(c.allClearEtaSec)})</strong> — Unavailable: ${bNames}</span>
                    <button class="oc-action-btn" onclick="event.stopPropagation(); copyBlockerPing('${c.id}')" style="padding:4px 9px;">🔔 Copy Blocker Ping</button>
                </div>`);
        } else if (c.phase === 'ready' || (c.phase === 'planning' && c.ready_at && (c.ready_at - nowSec) <= 7200)) {
            bannerParts.push(`
                <div class="oc-readiness-banner clear">
                    <span>🟢 ALL CREW OKAY IN TORN — ${c.phase === 'ready' ? 'READY TO INITIATE' : 'CLEAR FOR IMMINENT COMPLETION'}</span>
                    ${c.phase === 'ready' ? `<button class="oc-action-btn primary" onclick="event.stopPropagation(); pingReadyOC('${c.id}', this)" style="padding:4px 9px;">📢 Send Ready Discord Ping</button>` : ''}
                </div>`);
        }
        if (c.isHostageStall || c.isInactiveStall) {
            const stallMsg = c.isHostageStall
                ? `⚠️ STALL ALERT: ${c.filledSlots} Crew Waiting ${c.waitHours}h for ${c.emptySlots} Open Slot(s)`
                : `⚠️ STALL ALERT: ${c.inactiveCrew.map(x => `${escapeHtml(x.name)} Offline ${x.offlineHours}h`).join(', ')}`;
            bannerParts.push(`
                <div class="oc-readiness-banner stall">
                    <span>${stallMsg}</span>
                    <button class="oc-action-btn" onclick="event.stopPropagation(); toggleStallPopover('${c.id}')" style="padding:4px 9px;">🔄 Suggest 3 Ready Replacements</button>
                </div>
                <div id="stall-pop-${c.id}" style="display:none; padding:10px 18px; background:rgba(10,15,28,0.95); border-bottom:1px solid var(--oc-border-cyan); font-size:0.8em;"></div>`);
        }
        if (c.warOverlap) {
            bannerParts.push(`
                <div class="oc-readiness-banner stall">
                    <span>⚔️ <strong>War Window Overlap</strong> — Completes during Ranked War window (${formatTctDate(c.projectedEndSec)} ${formatTctClock(c.projectedEndSec)}). Verify Hospital/Flight availability before launch.</span>
                </div>`);
        }

        // Slot rows table (Tools 3 & 4)
        const slotsRows = (c.slots || []).map(slot => {
            const roleLabel = slot.position_info?.label || slot.position || 'Operative';
            const rawRole = slot.position || roleLabel;
            const cpr = Number(slot.checkpoint_pass_rate || 0);
            const item = slot.item_requirement;

            let itemHtml = '<span style="color:var(--text-tertiary);">None</span>';
            if (item) {
                const iName = escapeHtml(item.name || `Item #${item.id}`);
                const iCost = Number(item.market_value || 0);
                if (item.is_available) {
                    const keepTag = item.is_reusable ? '♻️ Reusable' : '🔥 Consumed';
                    itemHtml = `<span class="item-pill supplied" title="${keepTag}">🛠️ ${iName} ✓ Supplied</span>`;
                } else {
                    const armAvail = item.armory_available !== null && item.armory_available !== undefined ? `Armory: ${item.armory_available}` : 'Check Armory';
                    const isAssigned = Boolean(slot.user);
                    const clsPill = isAssigned ? 'missing' : 'supplied';
                    const styleExtra = isAssigned ? '' : 'style="background:rgba(245,158,11,0.1); border-color:rgba(245,158,11,0.35); color:#fde68a;"';
                    const prefixTxt = isAssigned ? '⚠️ Missing' : '🛠️ Needs';
                    itemHtml = `
                        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                            <span class="item-pill ${clsPill}" ${styleExtra}>${prefixTxt} ${iName} (~${fmtCompactMoney(iCost)})</span>
                            <a class="mini-icon-btn" href="https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${item.id}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">🛒 Market</a>
                            <button class="mini-icon-btn" onclick="event.stopPropagation(); checkArmoryStockToast('${item.id}', '${escapeHtml(iName)}', ${iCost})" title="Check Faction Armory stock">📦 ${armAvail}</button>
                        </div>`;
                }
            }

            if (!slot.user) {
                const fit = slot._suggestedFit;
                const fitHtml = fit
                    ? `<span class="status-pill" style="background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.4); color:#7dd3fc;">
                           ✨ Suggested Best Fit: <strong>${escapeHtml(fit.name)}</strong> (${fit.cpr}% CPR)
                       </span>`
                    : `<span style="color:var(--text-tertiary); font-style:italic;">OPEN SLOT — Awaiting available operative</span>`;
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
            const badgeCls = getCprBadgeClass(cpr, c.floor);

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
                    <td>
                        <span class="cpr-badge ${badgeCls}" title="Tier ${c.tier} Recommended Floor: ${c.floor}%">${cpr}% CPR</span>
                    </td>
                    <td>${itemHtml}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div class="oc-progress-mini"><div class="oc-progress-fill" style="width:${prog}%;"></div></div>
                            <span class="font-mono" style="font-size:0.85em; color:var(--text-secondary);">${prog}%</span>
                        </div>
                    </td>
                </tr>`;
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
                                <span class="diff-badge" style="background:rgba(16,185,129,0.12); color:#6ee7b7; border-color:rgba(16,185,129,0.35);">Avg CPR ${c.avgCpr}%</span>
                                <span class="diff-badge" style="background:rgba(245,158,11,0.12); color:#fcd34d; border-color:rgba(245,158,11,0.35);">Est. ${fmtCompactMoney(c.estCash)} • +${c.estRespect} Resp</span>
                            </div>
                        </div>
                    </div>
                    <div class="oc-header-right">
                        ${timerHtml}
                        ${statusPill}
                        <span class="collapse-arrow">▼</span>
                    </div>
                </div>
                ${bannerParts.join('')}
                <div class="oc-body" style="display:${isOpen ? 'block' : 'none'};">
                    <div class="slot-table-wrap">
                        <table class="oc-slot-table">
                            <thead>
                                <tr>
                                    <th>Role Slot</th>
                                    <th>Operative / Live Status</th>
                                    <th>CPR %</th>
                                    <th>Required Gear</th>
                                    <th>Planning Progress</th>
                                </tr>
                            </thead>
                            <tbody>${slotsRows}</tbody>
                        </table>
                    </div>
                </div>
                <div class="oc-card-footer">
                    <div style="font-size:0.74em; color:var(--text-tertiary); font-family:var(--font-mono);">
                        Stage Target: ${c.ready_at ? `${formatTctClock(c.ready_at)} (${formatTctDate(c.ready_at)})` : 'Awaiting full crew'}
                    </div>
                    <div class="oc-footer-actions">
                        <button class="oc-action-btn" onclick="openInSimulator('${c.id}')">🧪 Simulate Swap</button>
                        <button class="oc-action-btn" onclick="openInPayoutCalc('${c.id}')">💰 Preview Payout Split</button>
                        <button class="oc-action-btn" onclick="openBroadcastModal('${c.id}')">📢 Copy Slot Ping</button>
                        <a class="oc-action-btn primary" href="https://www.torn.com/factions.php?step=your#/tab=crimes" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">🔗 Open in Torn ↗</a>
                    </div>
                </div>
            </div>`;
    }

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
        if (stock) {
            showOcToast(`📦 Armory Stock for ${itemName}: ${stock.available} available (${stock.total} total, ${stock.loaned} loaned) • Market ~${fmtMoney(marketVal)}`);
        } else {
            showOcToast(`📦 ${itemName}: Not found in Armory utilities/tools stock (or Armory permission limited). Est. Market: ${fmtMoney(marketVal)}`);
        }
    };

    window.toggleStallPopover = function (crimeId) {
        const pop = document.getElementById(`stall-pop-${crimeId}`);
        if (!pop) return;
        if (pop.style.display !== 'none') {
            pop.style.display = 'none';
            return;
        }
        const crime = analytics.activeAnnotated.find(x => String(x.id) === String(crimeId));
        if (!crime) return;
        const top3 = analytics.bench.available.slice(0, 3);
        const pingTxt = top3.length
            ? `🔄 Need urgent OC backup for **${crime.name} [T${crime.tier}]**: ${top3.map(m => `@${m.name} [${m.id}]`).join(', ')} — open slots waiting in Faction Crimes!`
            : 'No available bench members online right now.';

        pop.style.display = 'block';
        pop.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div>
                    <strong style="color:#38bdf8;">Top 3 Ready Bench Replacements:</strong>
                    ${top3.length
                        ? top3.map(m => `<span class="badge" style="margin-left:6px; background:rgba(56,189,248,0.14); padding:2px 8px; border-radius:6px;">${escapeHtml(m.name)} (Lv ${m.level} • ~${m.estAvgCpr}% CPR)</span>`).join('')
                        : '<span style="color:var(--text-tertiary); margin-left:6px;">None available on bench</span>'}
                </div>
                <button class="oc-action-btn primary" onclick="copyStallPingText('${encodeURIComponent(pingTxt)}')" style="padding:4px 10px;">📋 Copy Replacement Ping</button>
            </div>`;
    };

    window.copyStallPingText = function (enc) {
        copyText(decodeURIComponent(enc), '✅ Replacement ping copied to clipboard!');
    };

    window.copyBlockerPing = function (crimeId) {
        const c = analytics.activeAnnotated.find(x => String(x.id) === String(crimeId));
        if (!c) return;
        const lines = c.blockedCrew.map(b => `@${b.name} [${b.id}] (${b.detail})`).join(', ');
        const msg = `🚨 **OC Launch Waiting [${c.name} T${c.tier}]** — All-clear ETA: ${formatDurationShort(c.allClearEtaSec)}. Unavailable: ${lines}. Please heal/return to Torn ASAP! https://www.torn.com/factions.php?step=your#/tab=crimes`;
        copyText(msg, `✅ Blocker ping copied for ${c.name}!`);
    };

    window.pingReadyOC = async function (crimeId, btnEl) {
        const c = analytics.activeAnnotated.find(x => String(x.id) === String(crimeId));
        if (!c) return;
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Sending...'; }
        try {
            const participants = (c.slots || []).map(s => s.user ? { id: s.user.id, name: s.user.name, position: s.position_info?.label || s.position } : null).filter(Boolean);
            const res = await fetch('/api/oc-ping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    // ─── View 2: Bench & Crew Matcher (Tools 1, 3, 10) ───
    function renderBenchView() {
        const sp = analytics.spawnPlan;
        const spCard = document.getElementById('spawn-architect-card');
        if (spCard) {
            spCard.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                    <div>
                        <h2 style="margin:0 0 4px 0; font-size:1.06em; font-weight:900;">🧬 Automated OC Spawn Architect (Tier Demand Calculator)</h2>
                        <div class="font-mono" style="font-size:0.82em; color:#38bdf8; margin-bottom:8px;">${escapeHtml(sp.formulaText)}</div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            ${sp.recommendations.length
                                ? sp.recommendations.map(r => `<span class="diff-badge" style="padding:5px 11px; font-size:0.8em;">Recommended Spawn: ${escapeHtml(r.label)}</span>`).join('')
                                : '<span class="status-pill pill-ready">🟢 Capacity Balanced — No Immediate Spawns Required</span>'}
                        </div>
                    </div>
                    <a class="oc-action-btn primary" href="https://www.torn.com/factions.php?step=your#/tab=crimes" target="_blank" rel="noopener noreferrer" style="text-decoration:none; padding:10px 16px;">🚀 Open Torn OC Spawn Control ↗</a>
                </div>`;
        }

        // Floors display
        const fLow = document.getElementById('floor-disp-low');
        const fHigh = document.getElementById('floor-disp-high');
        if (fLow) fLow.textContent = `${cprFloors.low}%`;
        if (fHigh) fHigh.textContent = `${cprFloors.high}%`;

        // Tool 3 Visual Two-Column Matcher
        const matcherEl = document.getElementById('smart-matcher-grid');
        if (matcherEl) {
            const matches = analytics.openSlotMatches;
            const leftHtml = matches.length
                ? matches.map(m => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.8em;">
                        <div>
                            <strong style="color:#38bdf8;">[T${m.tier}]</strong> <strong>${escapeHtml(m.crimeName)}</strong>
                            <div style="font-size:0.85em; color:var(--text-secondary);">Role: ${escapeHtml(m.role)} • Floor ${m.floor}%</div>
                        </div>
                        <span style="color:var(--text-tertiary);">→</span>
                    </div>`).join('')
                : '<div style="padding:18px; color:var(--text-tertiary); font-size:0.82em;">No open Recruiting slots currently available.</div>';

            const rightHtml = matches.length
                ? matches.map(m => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.8em;">
                        ${m.matched ? `
                            <div>
                                <strong>${escapeHtml(m.matched.name)}</strong> <span style="color:var(--text-tertiary);">[${m.matched.id}] Lv ${m.matched.level}</span>
                                <div style="font-size:0.84em; color:var(--text-secondary);">Assigned Fit for ${escapeHtml(m.role)}</div>
                            </div>
                            <span class="cpr-badge ${getCprBadgeClass(m.cpr, m.floor)}">${m.cpr}% CPR ${m.meetsFloor ? '✓' : '⚠️'}</span>
                        ` : `<span style="color:#fbbf24;">No available unassigned operative left on bench</span>`}
                    </div>`).join('')
                : '<div style="padding:18px; color:var(--text-tertiary); font-size:0.82em;">Recommended matches appear here when Recruiting slots open.</div>';

            matcherEl.innerHTML = `
                <div style="background:rgba(10,15,28,0.75); border:1px solid var(--oc-border-cyan); border-radius:10px; overflow:hidden;">
                    <div style="padding:9px 12px; font-size:0.76em; font-weight:800; text-transform:uppercase; color:var(--text-tertiary); border-bottom:1px solid var(--oc-border-cyan);">Open Recruiting Role Slots (${matches.length})</div>
                    ${leftHtml}
                </div>
                <div style="background:rgba(10,15,28,0.75); border:1px solid var(--oc-border-cyan); border-radius:10px; overflow:hidden;">
                    <div style="padding:9px 12px; font-size:0.76em; font-weight:800; text-transform:uppercase; color:var(--text-tertiary); border-bottom:1px solid var(--oc-border-cyan);">Recommended Unassigned Operatives</div>
                    ${rightHtml}
                </div>`;
        }

        // Tool 1 Bucket Tabs + Grid
        const b = analytics.bench;
        document.getElementById('bench-tab-all').textContent = `All Unassigned (${b.all.length})`;
        document.getElementById('bench-tab-available').textContent = `🟢 Available Now (${b.available.length})`;
        document.getElementById('bench-tab-blocked').textContent = `🟡 Temp Blocked (${b.blocked.length})`;
        document.getElementById('bench-tab-inactive').textContent = `⚫ Inactive / Exempt (${b.inactive.length})`;

        const q = (document.getElementById('bench-search-input')?.value || '').toLowerCase().trim();
        const pool = (b[benchBucket] || b.all).filter(m => !q || m.name.toLowerCase().includes(q) || String(m.id).includes(q));
        const grid = document.getElementById('bench-cards-container');
        if (!grid) return;

        if (!pool.length) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:24px; color:var(--text-tertiary);">No bench members match this filter.</div>';
            return;
        }

        const openSlotOpts = analytics.openSlotMatches.map(s => `<option value="${s.crimeId}:${escapeHtml(s.role)}">[T${s.tier}] ${escapeHtml(s.crimeName)} — ${escapeHtml(s.role)} (Est ${lookupEstimatedCpr(0, s.crimeName, s.rawRole, s.tier)}%)</option>`).join('');
        const nowSec = Math.floor(Date.now() / 1000);

        grid.innerHTML = pool.map(m => {
            const untilTs = Number(m.status?.until || 0);
            let stPill = '';
            if (m.bucket === 'available') {
                stPill = '<span class="status-pill pill-ready">🟢 Available Now</span>';
            } else if (m.bucket === 'blocked') {
                const isTimerState = (m.blocker.code === 'Hospital' || m.blocker.code === 'Jail') && untilTs > nowSec;
                const prefix = m.blocker.code === 'Hospital' ? '🏥 Hosp' : '⛓️ Jail';
                stPill = isTimerState
                    ? `<span class="status-pill pill-recruiting">${prefix} <span data-until="${untilTs}" data-prefix="${prefix}">${formatDurationShort(untilTs - nowSec)}</span></span>`
                    : `<span class="status-pill pill-recruiting">${escapeHtml(m.blocker.label)} (${escapeHtml(m.blocker.detail)})</span>`;
            } else {
                stPill = `<span class="status-pill" style="background:rgba(148,163,184,0.14); color:#94a3b8;">⚫ ${escapeHtml(m.exemptReason)}</span>`;
            }

            return `
                <div class="bench-card">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <div>
                            <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" rel="noopener noreferrer" style="font-weight:900; color:var(--text-primary); text-decoration:none; font-size:0.96em;">${escapeHtml(m.name)}</a>
                            <span style="font-size:0.75em; color:var(--text-tertiary); font-family:var(--font-mono);"> [${m.id}] • Lv ${m.level}</span>
                        </div>
                        ${stPill}
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:0.76em; color:var(--text-secondary);">
                        <span>Last Active: ${formatRelativeSec(m.last_action?.timestamp, nowSec)}</span>
                        <span>Last OC: ${m.daysSinceLastOc !== null ? `${m.daysSinceLastOc}d ago` : 'Unrecorded'}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.76em;">
                        <span class="diff-badge">${escapeHtml(m.estTier)} (~${m.estAvgCpr}% CPR)</span>
                        <select class="oc-select" style="font-size:0.92em; padding:4px 7px; max-width:155px;" onchange="assignBenchSlotAction('${m.id}', '${escapeHtml(m.name)}', this.value, this)">
                            <option value="">Assign to Open Slot...</option>
                            ${analytics.openSlotMatches.map(s => `<option value="${s.crimeId}::${escapeHtml(s.role)}">[T${s.tier}] ${escapeHtml(s.crimeName)} — ${escapeHtml(s.role)} (${lookupEstimatedCpr(m.id, s.crimeName, s.rawRole, s.tier)}%)</option>`).join('')}
                        </select>
                    </div>
                </div>`;
        }).join('');
        void openSlotOpts;
    }

    window.setBenchBucket = function (bucket) {
        benchBucket = bucket;
        document.querySelectorAll('#bench-bucket-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.id === `bench-tab-${bucket}`));
        renderBenchView();
    };

    window.assignBenchSlotAction = function (playerId, playerName, val, selEl) {
        if (!val) return;
        const [crimeId, role] = val.split('::');
        const c = analytics.activeAnnotated.find(x => String(x.id) === String(crimeId));
        const msg = `@${playerName} [${playerId}] — Please join **${c ? c.name : 'OC #' + crimeId}** in role **${role}**: https://www.torn.com/factions.php?step=your#/tab=crimes`;
        copyText(msg, `✅ Copied assignment ping for ${playerName} → ${role}!`);
        if (selEl) selEl.value = '';
    };

    window.copyAvailableBenchPings = function () {
        const list = analytics.bench.available;
        if (!list.length) return showOcToast('🟢 All active faction members are already assigned to an OC!');
        const msg = `📢 **Unassigned Active Members (${list.length}) — Please Join an Open OC:**\n` +
            list.map((m, i) => `${i + 1}. @${m.name} [${m.id}] — ${m.estTier} (~${m.estAvgCpr}% CPR)`).join('\n') +
            `\n👉 https://www.torn.com/factions.php?step=your#/tab=crimes`;
        copyText(msg, `✅ Copied Discord pings for ${list.length} available bench members!`);
    };

    window.openTornMailToBench = function () {
        const list = analytics.bench.available;
        if (!list.length) return showOcToast('No available bench members to message.');
        const names = list.map(m => `${m.name} [${m.id}]`).join(', ');
        copyText(names, `✅ Copied ${list.length} recipient(s) & opened Torn Mail!`);
        window.open(`https://www.torn.com/messages.php#/p=compose&XID=${encodeURIComponent(list[0].id)}`, '_blank', 'noopener,noreferrer');
    };

    window.copyMatcherPlan = function () {
        const matches = analytics.openSlotMatches.filter(m => m.matched);
        if (!matches.length) return showOcToast('No matched assignments to copy yet.');
        const lines = matches.map(m => `• **[T${m.tier}] ${m.crimeName}** — *${m.role}* → @${m.matched.name} [${m.matched.id}] (**${m.cpr}% CPR**)`).join('\n');
        copyText(`🧠 **Optimal OC Role Assignment Plan**\n${lines}\n👉 https://www.torn.com/factions.php?step=your#/tab=crimes`, '✅ Optimal assignment plan copied for Discord!');
    };

    // ─── View 3: Payouts & Split Ledger (Tool 5) ───
    function populatePayoutCrimeSelect() {
        const sel = document.getElementById('payout-crime-select');
        if (!sel) return;
        const activeOpts = analytics.activeAnnotated.map(c => `<option value="active:${c.id}">[ACTIVE T${c.tier}] ${escapeHtml(c.name)} (#${c.id}) — Est. ${fmtCompactMoney(c.estCash)}</option>`);
        const compOpts = (cmdData.completedCrimes || [])
            .filter(c => String(c.status || '').toLowerCase() === 'successful')
            .slice(0, 40)
            .map(c => `<option value="comp:${c.id}">[PAID/DONE T${c.difficulty}] ${escapeHtml(c.name)} (#${c.id}) — ${fmtCompactMoney(c.rewards?.gross_total || c.rewards?.money || 0)}</option>`);
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
            payoutState.rows = [
                { id: 1, name: 'Operative 1', role: 'Hacker', cpr: 85, itemCost: 0, itemName: '' },
                { id: 2, name: 'Operative 2', role: 'Muscle', cpr: 78, itemCost: 0, itemName: '' }
            ];
            payoutState.reimburseEnabled = {};
        } else {
            const isComp = key.startsWith('comp:');
            payoutState.cash = isComp ? Number(crime.rewards?.money || 0) : Number(crime.estCash || 0);
            payoutState.itemsVal = isComp ? Number(crime.rewards?.item_value_total || 0) : 0;
            payoutState.reimburseEnabled = {};
            payoutState.rows = (crime.slots || []).filter(s => s.user).map((s, idx) => {
                const itm = s.item_requirement;
                const usedOrNonReusable = itm && !itm.is_reusable && (s.user?.item_outcome?.owned_by !== 'faction');
                const cost = itm ? Number(itm.market_value || 0) : 0;
                const rKey = `${idx}_${s.user.id}`;
                payoutState.reimburseEnabled[rKey] = Boolean(usedOrNonReusable && cost > 0);
                return {
                    key: rKey,
                    id: s.user.id,
                    name: s.user.name || `ID:${s.user.id}`,
                    role: s.position_info?.label || s.position || 'Operative',
                    cpr: Number(s.checkpoint_pass_rate || 75),
                    itemCost: cost,
                    itemName: itm?.name || '',
                    isReusable: Boolean(itm?.is_reusable)
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
            el.innerHTML = '<div style="font-size:0.78em; color:var(--text-tertiary);">No consumable items required for this crew.</div>';
            return;
        }
        el.innerHTML = withItems.map(r => `
            <label style="display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:0.79em; padding:6px 10px; background:rgba(10,15,28,0.75); border:1px solid var(--border-subtle); border-radius:7px; cursor:pointer;">
                <span style="display:flex; align-items:center; gap:7px;">
                    <input type="checkbox" ${payoutState.reimburseEnabled[r.key] ? 'checked' : ''} onchange="toggleReimburseSlot('${r.key}', this.checked)">
                    <span><strong>${escapeHtml(r.name)}</strong> — ${escapeHtml(r.itemName)} ${r.isReusable ? '(Reusable)' : '(Consumed)'}</span>
                </span>
                <span class="font-mono" style="color:#fbbf24;">${fmtMoney(r.itemCost)}</span>
            </label>`).join('');
    }

    window.toggleReimburseSlot = function (k, checked) {
        payoutState.reimburseEnabled[k] = checked;
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
        payoutState.rows.forEach(r => {
            if (payoutState.reimburseEnabled[r.key]) totalReimburse += r.itemCost;
        });
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
        const totalWeight = rows.reduce((s, r) => {
            if (payoutState.mode === 'cpr') return s + Math.max(1, r.cpr);
            if (payoutState.mode === 'role') return s + getRoleDiffWeight(r.role);
            return s + 1;
        }, 0) || 1;

        const tbody = document.getElementById('payout-receipt-tbody');
        if (!tbody) return;
        tbody.innerHTML = rows.map(r => {
            const w = payoutState.mode === 'cpr' ? Math.max(1, r.cpr) : (payoutState.mode === 'role' ? getRoleDiffWeight(r.role) : 1);
            const sharePct = (w / totalWeight) * 100;
            const poolCash = Math.round(memberPool * (w / totalWeight));
            const reimbCash = payoutState.reimburseEnabled[r.key] ? r.itemCost : 0;
            const finalCash = poolCash + reimbCash;
            r._computedFinal = finalCash;
            r._computedSharePct = sharePct;
            r._computedReimb = reimbCash;

            return `
                <tr>
                    <td><strong>${escapeHtml(r.name)}</strong> <span style="font-size:0.8em; color:var(--text-tertiary);">[${r.id}]</span></td>
                    <td>${escapeHtml(r.role)}</td>
                    <td class="font-mono">${r.cpr}%</td>
                    <td class="font-mono" style="color:${reimbCash > 0 ? '#fbbf24' : 'var(--text-tertiary)'};">${fmtMoney(reimbCash)}</td>
                    <td class="font-mono">${sharePct.toFixed(1)}%</td>
                    <td class="font-mono" style="font-weight:900; color:#34d399;">${fmtMoney(finalCash)}</td>
                    <td>
                        <button class="oc-action-btn" onclick="payInFactionBank(${r.id}, '${escapeHtml(r.name)}', ${finalCash})" style="padding:4px 8px; font-size:0.88em;">💸 Pay in Faction Bank</button>
                    </td>
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
        const lines = payoutState.rows.map(r => `• **${r.name} [${r.id}]** (${r.role}, ${r.cpr}%): **${fmtMoney(r._computedFinal || 0)}**${r._computedReimb ? ` (incl. ${fmtMoney(r._computedReimb)} gear reimburse)` : ''}`).join('\n');
        const txt = `💰 **OC Payout Receipt (${payoutState.mode.toUpperCase()} Split • ${payoutState.vaultPct}% Vault Cut)**\n**Gross:** ${fmtMoney(gross)}\n${lines}`;
        copyText(txt, '✅ Discord payout receipt copied!');
    };

    function renderPayoutsView() {
        document.getElementById('payout-vault-slider').value = payoutState.vaultPct;
        document.getElementById('payout-vault-pct-label').textContent = `${payoutState.vaultPct}%`;
        ['equal', 'cpr', 'role'].forEach(m => document.getElementById(`mode-btn-${m}`)?.classList.toggle('active', m === payoutState.mode));
        populatePayoutCrimeSelect();
    }

    // ─── View 4: ROI & Crew Simulator (Tools 6 & 12) ───
    function renderRoiAndSimulatorView() {
        renderRoiMatrix();
        populateSimulatorSelect();
    }

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

        const baseCpr = roiState.avgCpr;
        const rows = (cmdData.catalog || []).map(cat => {
            const tierPenalty = Math.max(-12, (cat.difficulty - 3.5) * 4);
            const estWinPct = Math.max(12, Math.min(98, Math.round(baseCpr - tierPenalty)));
            const winRate = estWinPct / 100;
            const grossAvg = Number(cat.estCash || 0) + Number(cat.estItemValue || 0);
            const netEv = Math.round((winRate * Math.max(0, grossAvg - Number(cat.consumableCost || 0))) - ((1 - winRate) * Number(cat.failPenaltyCost || 250000)));
            const evPerMemberDay = Math.round(netEv / Math.max(1, cat.crewSize * cat.planningDays));
            const respectPerDay = Number(((winRate * Number(cat.estRespect || 0)) / Math.max(1, cat.planningDays)).toFixed(2));
            return { ...cat, winRate: estWinPct, grossAvg, netEv, evPerMemberDay, respectPerDay };
        });

        const sweetSpot = [...rows].sort((a, b) => b.evPerMemberDay - a.evPerMemberDay)[0] || null;
        rows.sort((a, b) => {
            const va = a[roiState.sortCol];
            const vb = b[roiState.sortCol];
            if (typeof va === 'string') return roiState.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            return roiState.sortAsc ? (va - vb) : (vb - va);
        });

        document.querySelectorAll('#roi-matrix-table thead th').forEach(th => th.classList.remove('sort-active'));
        ['difficulty', 'name', 'crewSize', 'winRate', 'consumableCost', 'netEv', 'evPerMemberDay', 'respectPerDay'].forEach(col => {
            const sp = document.getElementById(`roi-sind-${col}`);
            if (sp) {
                if (col === roiState.sortCol) {
                    sp.textContent = roiState.sortAsc ? '↑' : '↓';
                    sp.closest('th')?.classList.add('sort-active');
                } else {
                    sp.textContent = '↕';
                }
            }
        });

        // Dual-axis Horizontal Bar Comparison Chart (SVG)
        if (chartWrap) {
            const topChart = [...rows].sort((a, b) => b.evPerMemberDay - a.evPerMemberDay).slice(0, 8);
            const maxEv = Math.max(1, ...topChart.map(r => r.evPerMemberDay));
            const maxResp = Math.max(1, ...topChart.map(r => r.respectPerDay));
            chartWrap.innerHTML = `
                <div style="display:grid; gap:7px; padding:12px; background:rgba(10,15,28,0.8); border:1px solid var(--oc-border-cyan); border-radius:10px;">
                    <div style="display:flex; justify-content:space-between; font-size:0.72em; color:var(--text-tertiary);">
                        <span>Top 8 Crimes by $/Member/Day (Cyan) vs. Respect/Day (Purple)</span>
                        <span>★ Sweet Spot: <strong style="color:#22d3ee;">${sweetSpot ? escapeHtml(sweetSpot.name) : '—'}</strong></span>
                    </div>
                    ${topChart.map(r => `
                        <div style="display:grid; grid-template-columns:180px 1fr 140px; align-items:center; gap:10px; font-size:0.76em;">
                            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><strong>[T${r.difficulty}]</strong> ${escapeHtml(r.name)}</span>
                            <div style="display:flex; flex-direction:column; gap:3px;">
                                <div style="height:7px; border-radius:4px; background:linear-gradient(90deg,#06b6d4,#3b82f6); width:${Math.max(2, Math.round((r.evPerMemberDay / maxEv) * 100))}%;"></div>
                                <div style="height:5px; border-radius:4px; background:linear-gradient(90deg,#8b5cf6,#ec4899); width:${Math.max(2, Math.round((r.respectPerDay / maxResp) * 100))}%;"></div>
                            </div>
                            <span class="font-mono" style="text-align:right; white-space:nowrap;">${fmtCompactMoney(r.evPerMemberDay)}/d • +${r.respectPerDay}R/d</span>
                        </div>`).join('')}
                </div>`;
        }

        tbody.innerHTML = rows.map(r => {
            const isSweet = sweetSpot && sweetSpot.name === r.name;
            const histStr = r.observedCount > 0 ? `${r.observedWins}/${r.observedCount} Wins (${Math.round((r.observedWins / r.observedCount) * 100)}%)` : 'Catalog Est.';
            return `
                <tr class="${isSweet ? 'sweet-spot-row' : ''}">
                    <td><span class="diff-badge">T${r.difficulty}</span></td>
                    <td>
                        <strong>${escapeHtml(r.name)}</strong>
                        ${isSweet ? '<span class="sweet-spot-badge" style="margin-left:6px;">★ OPTIMAL FACTION SWEET SPOT</span>' : ''}
                    </td>
                    <td class="font-mono">${r.crewSize} crew / ${r.planningDays}d</td>
                    <td class="font-mono" style="color:${r.winRate >= 75 ? '#34d399' : '#fbbf24'};">${r.winRate}%</td>
                    <td class="font-mono">${fmtCompactMoney(r.consumableCost || 0)}</td>
                    <td class="font-mono">${fmtCompactMoney(r.netEv)}</td>
                    <td class="font-mono" style="font-weight:900; color:#22d3ee;">${fmtCompactMoney(r.evPerMemberDay)}</td>
                    <td class="font-mono" style="color:#c4b5fd;">+${r.respectPerDay}</td>
                    <td style="font-size:0.88em; color:var(--text-secondary);">${histStr}</td>
                </tr>`;
        }).join('');
    }

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
        window.switchOcView('roi');
        loadSimCrime(`active:${crimeId}`);
        document.getElementById('simulator-sandbox-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
                simState.slots = (c.slots || []).map(s => ({
                    role: s.position_info?.label || s.position || 'Operative',
                    rawRole: s.position || 'Operative',
                    playerId: s.user?.id || '',
                    cpr: Number(s.checkpoint_pass_rate || 70) || 70,
                    hasItem: s.item_requirement ? Boolean(s.item_requirement.is_available) : true,
                    needsItem: Boolean(s.item_requirement),
                    itemName: s.item_requirement?.name || ''
                }));
                simState.baselinePct = computeTeamSuccessProb(simState.slots);
                renderSimSandbox();
                return;
            }
        }
        const name = key.startsWith('cat:') ? key.slice(4) : key;
        const cat = (cmdData.catalog || []).find(x => x.name === name) || (cmdData.catalog || [])[0];
        if (cat) {
            simState.crimeName = cat.name;
            simState.difficulty = cat.difficulty;
            simState.planningDays = cat.planningDays;
            simState.estCash = (cat.estCash || 0) + (cat.estItemValue || 0);
            simState.estRespect = cat.estRespect;
            simState.slots = (cat.roles || ['Operative']).map((r, idx) => ({
                role: r,
                rawRole: r,
                playerId: '',
                cpr: 75,
                hasItem: true,
                needsItem: Boolean((cat.requiredItems || [])[idx]),
                itemName: (cat.requiredItems || [])[idx]?.name || ''
            }));
            simState.baselinePct = null;
        }
        renderSimSandbox();
    };

    function computeTeamSuccessProb(slots) {
        if (!slots.length) return 0;
        let geoProd = 1;
        let sum = 0;
        let penalty = 0;
        slots.forEach(s => {
            const p = Math.max(5, Math.min(99, Number(s.cpr || 50)));
            geoProd *= (p / 100);
            sum += p;
            if (p < 60) penalty += (60 - p) * 0.45;
            if (s.needsItem && !s.hasItem) penalty += 18;
        });
        const arith = sum / slots.length;
        const geoPct = Math.pow(geoProd, 1 / slots.length) * 100;
        const blended = (arith * 0.4 + geoPct * 0.6) - penalty;
        return Math.max(2, Math.min(99, Number(blended.toFixed(1))));
    }

    function renderSimSandbox() {
        const listEl = document.getElementById('sim-slots-list');
        const resEl = document.getElementById('sim-results-panel');
        if (!listEl || !resEl) return;

        const allMemOpts = analytics.memberProfiles
            .slice()
            .sort((a, b) => b.avgCpr - a.avgCpr)
            .map(m => `<option value="${m.playerId}">${escapeHtml(m.name)} (Lv ${m.level} • ~${m.avgCpr}%)</option>`).join('');

        listEl.innerHTML = simState.slots.map((s, idx) => `
            <div style="background:rgba(10,15,28,0.8); border:1px solid var(--oc-border-cyan); border-radius:9px; padding:11px 13px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:7px;">
                    <strong>Slot #${idx + 1}: ${escapeHtml(s.role)}</strong>
                    <select class="oc-select" style="max-width:220px;" onchange="simPickMember(${idx}, this.value)">
                        <option value="">-- Custom / Unassigned --</option>
                        ${allMemOpts}
                    </select>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:0.74em; color:var(--text-tertiary);">CPR:</span>
                    <input type="range" min="10" max="100" value="${s.cpr}" style="flex:1;" oninput="simSetSlotCpr(${idx}, this.value)">
                    <span class="cpr-badge ${getCprBadgeClass(s.cpr)}">${s.cpr}%</span>
                </div>
                ${s.needsItem ? `
                    <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.76em; margin-top:7px; cursor:pointer; color:var(--text-secondary);">
                        <input type="checkbox" ${s.hasItem ? 'checked' : ''} onchange="simToggleSlotItem(${idx}, this.checked)">
                        <span>Item Ready: ${escapeHtml(s.itemName || 'Required Gear')}</span>
                    </label>` : ''}
            </div>`).join('');

        // Preserve dropdown selected values
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

        const r = 64;
        const circ = 2 * Math.PI * r;
        const offset = circ - (prob / 100) * circ;
        const strokeColor = prob >= 80 ? '#10b981' : (prob >= 65 ? '#06b6d4' : (prob >= 50 ? '#f59e0b' : '#f43f5e'));

        resEl.innerHTML = `
            <div style="font-size:0.78em; font-weight:800; color:var(--text-tertiary); text-transform:uppercase;">Live Team Success Probability</div>
            <div class="sim-gauge-wrap">
                <svg class="sim-gauge-svg" viewBox="0 0 160 160">
                    <circle cx="80" cy="80" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12"/>
                    <circle cx="80" cy="80" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="12" stroke-linecap="round"
                        stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 80 80)"/>
                    <text x="80" y="76" text-anchor="middle" fill="#f8fafc" font-family="JetBrains Mono" font-size="26" font-weight="900">${prob}%</text>
                    <text x="80" y="98" text-anchor="middle" fill="#94a3b8" font-family="Inter" font-size="11" font-weight="700">PASS PROB</text>
                </svg>
                ${delta !== null ? `<div style="font-size:0.8em; font-weight:800; color:${delta >= 0 ? '#34d399' : '#fb7185'};">Delta vs Live Crew: ${delta >= 0 ? '+' : ''}${delta}%</div>` : ''}
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; text-align:left; font-size:0.8em;">
                <div class="oc-kpi-card" style="padding:9px;"><div class="oc-kpi-top">Jail / Crit Fail Risk</div><div class="oc-kpi-val" style="font-size:1.05em; color:#fb7185;">${failRisk}% (${critFailRisk}% Crit)</div></div>
                <div class="oc-kpi-card" style="padding:9px;"><div class="oc-kpi-top">Expected Net EV</div><div class="oc-kpi-val" style="font-size:1.05em; color:#34d399;">${fmtCompactMoney(expCash)} • +${expResp}R</div></div>
            </div>`;
    }

    window.simPickMember = function (idx, playerId) {
        const s = simState.slots[idx];
        if (!s) return;
        s.playerId = playerId;
        if (playerId) s.cpr = lookupEstimatedCpr(playerId, simState.crimeName, s.rawRole, simState.difficulty);
        renderSimSandbox();
    };
    window.simSetSlotCpr = function (idx, val) {
        if (!simState.slots[idx]) return;
        simState.slots[idx].cpr = Number(val || 50);
        const listEl = document.getElementById('sim-slots-list');
        const badges = listEl?.querySelectorAll('.cpr-badge');
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

    // ─── View 5: Operative Crime Leaderboard & Post-Mortems (Tools 13 & 14) ───
    function renderLeaderboardView() {
        renderLeaderboard();
        renderPostMortems();
    }

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

        const list = analytics.memberProfiles.filter(m => {
            if (rankFlt !== 'all' && m.rankKey !== rankFlt) return false;
            if (q && !m.name.toLowerCase().includes(q) && !String(m.playerId).includes(q)) return false;
            return true;
        });

        list.sort((a, b) => {
            if (lbState.sortCol === 'name') return lbState.sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
            if (lbState.sortCol === 'rank') return lbState.sortAsc ? a.rankLabel.localeCompare(b.rankLabel) : b.rankLabel.localeCompare(a.rankLabel);
            if (lbState.sortCol === 'activeOc') {
                const va = a.activeOcName || 'zzz';
                const vb = b.activeOcName || 'zzz';
                return lbState.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            const va = Number(a[lbState.sortCol] || 0);
            const vb = Number(b[lbState.sortCol] || 0);
            return lbState.sortAsc ? (va - vb) : (vb - va);
        });

        // Update arrows
        document.querySelectorAll('#oc-leaderboard-table thead th').forEach(th => th.classList.remove('sort-active'));
        ['name', 'rank', 'activeOc', 'completed', 'passRate', 'avgCpr', 'grossCash', 'respect', 'gearSupplied', 'reliability'].forEach(col => {
            const sp = document.getElementById(`lb-sind-${col}`);
            if (sp) {
                if (col === lbState.sortCol) {
                    sp.textContent = lbState.sortAsc ? '↑' : '↓';
                    sp.closest('th')?.classList.add('sort-active');
                } else sp.textContent = '↕';
            }
        });

        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:26px; color:var(--text-tertiary);">No faction operatives match filters.</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(m => `
            <tr style="cursor:pointer;" onclick="openOcDossier('${m.playerId}')" title="Open Operative Crime Dossier">
                <td class="sticky-col">
                    <strong>${escapeHtml(m.name)}</strong>
                    <div style="font-size:0.8em; color:var(--text-tertiary); font-family:var(--font-mono);">Lv ${m.level} • [${m.playerId}]</div>
                </td>
                <td><span class="status-pill" style="color:${m.rankColor}; border:1px solid ${m.rankColor};">${m.rankLabel}</span></td>
                <td>${m.activeOcName ? `<span style="color:#38bdf8; font-weight:700;">${escapeHtml(m.activeOcName)}</span><div style="font-size:0.8em; color:var(--text-tertiary);">${escapeHtml(m.activeOcRole || '')}</div>` : '<span style="color:#fbbf24;">On Bench</span>'}</td>
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

        // Build inline SVG sparkline for CPR history
        let sparkSvg = '<div style="font-size:0.78em; color:var(--text-tertiary);">No CPR trend points recorded yet.</div>';
        if (m.cprHistory.length > 1) {
            const pts = m.cprHistory.slice(-15);
            const w = 480, h = 72;
            const coords = pts.map((p, i) => {
                const x = Math.round((i / (pts.length - 1)) * (w - 20) + 10);
                const y = Math.round(h - 10 - ((Math.max(20, Math.min(100, p.cpr)) - 20) / 80) * (h - 20));
                return `${x},${y}`;
            }).join(' ');
            sparkSvg = `
                <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:72px; background:rgba(10,15,28,0.8); border-radius:8px; border:1px solid var(--oc-border-cyan);">
                    <polyline fill="none" stroke="#38bdf8" stroke-width="2.5" points="${coords}"/>
                </svg>`;
        }

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                    <h2 style="margin:0; font-size:1.25em; font-weight:900;">${escapeHtml(m.name)} <span style="color:var(--text-tertiary); font-size:0.78em;">[${m.playerId}]</span></h2>
                    <div style="font-size:0.8em; color:var(--text-secondary); margin-top:3px;">Level ${m.level} • ${m.rankLabel} • Reliability: <strong style="color:#38bdf8;">${m.reliability}%</strong></div>
                </div>
                <button class="oc-action-btn" onclick="closeOcDossier()">✕</button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px;">
                <div class="oc-kpi-card" style="padding:10px;"><div class="oc-kpi-top">Pass Rate</div><div class="oc-kpi-val" style="font-size:1.1em;">${m.hasHistory ? `${m.passRate}%` : '—'}</div><div class="oc-kpi-sub">${m.wins}W / ${m.fails}F</div></div>
                <div class="oc-kpi-card" style="padding:10px;"><div class="oc-kpi-top">Avg CPR</div><div class="oc-kpi-val" style="font-size:1.1em; color:#38bdf8;">${m.avgCpr}%</div><div class="oc-kpi-sub">Active: ${escapeHtml(m.activeOcName || 'Bench')}</div></div>
                <div class="oc-kpi-card" style="padding:10px;"><div class="oc-kpi-top">Generated</div><div class="oc-kpi-val" style="font-size:1.1em; color:#34d399;">${fmtCompactMoney(m.grossCash)}</div><div class="oc-kpi-sub">+${fmt(m.respect)} Resp</div></div>
            </div>
            ${m.deductions.length ? `<div class="oc-alert-strip" style="margin:0;"><strong>Reliability Deductions:</strong> ${m.deductions.map(escapeHtml).join(' • ')}</div>` : ''}
            <div>
                <div style="font-size:0.78em; font-weight:800; color:var(--text-tertiary); text-transform:uppercase; margin-bottom:6px;">Best Role CPR Ratings</div>
                ${m.roleBars.length ? m.roleBars.map(rb => `
                    <div style="margin-bottom:6px;">
                        <div style="display:flex; justify-content:space-between; font-size:0.78em; margin-bottom:2px;"><span>${escapeHtml(rb.role)}</span><strong class="font-mono">${rb.val}%</strong></div>
                        <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:4px;"><div style="height:100%; width:${rb.val}%; background:#38bdf8; border-radius:4px;"></div></div>
                    </div>`).join('') : '<div style="font-size:0.8em; color:var(--text-tertiary);">No role CPR samples yet.</div>'}
            </div>
            <div>
                <div style="font-size:0.78em; font-weight:800; color:var(--text-tertiary); text-transform:uppercase; margin-bottom:6px;">CPR History Trend</div>
                ${sparkSvg}
            </div>
            <div>
                <div style="font-size:0.78em; font-weight:800; color:var(--text-tertiary); text-transform:uppercase; margin-bottom:6px;">Recent Organized Crimes (${m.recentCrimes.length})</div>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    ${m.recentCrimes.slice(0, 10).map(rc => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:rgba(15,23,42,0.85); border:1px solid var(--border-subtle); border-radius:8px; font-size:0.78em;">
                            <div><strong>[T${rc.difficulty}] ${escapeHtml(rc.name)}</strong><div style="color:var(--text-tertiary);">${escapeHtml(rc.role)} (${rc.cpr}% CPR) • ${formatTctDate(rc.executedAt)}</div></div>
                            <span class="status-pill ${rc.status === 'Successful' ? 'pill-ready' : 'pill-recruiting'}">${rc.status === 'Successful' ? fmtCompactMoney(rc.rewardShare) : escapeHtml(rc.outcome)}</span>
                        </div>`).join('') || '<div style="font-size:0.8em; color:var(--text-tertiary);">No recent completed OCs found.</div>'}
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
            const c = pm.crime;
            const bn = pm.bottleneck;
            return `
                <div class="bench-card" style="border-color:rgba(244,63,94,0.38);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <div>
                            <strong style="color:#fda4af;">❌ [T${c.difficulty}] ${escapeHtml(c.name)}</strong>
                            <div style="font-size:0.75em; color:var(--text-tertiary);">#${c.id} • ${formatTctDate(c.executed_at || c.ready_at || 0)}</div>
                        </div>
                        <span class="cpr-badge cpr-risk">Avg ${pm.avgCpr}% CPR</span>
                    </div>
                    ${bn ? `<div style="font-size:0.79em;"><strong>Bottleneck Slot:</strong> ${escapeHtml(bn.position_info?.label || bn.position)} — ${escapeHtml(bn.user?.name || '')} (${bn.checkpoint_pass_rate}% CPR)</div>` : ''}
                    <div style="display:flex; gap:5px; flex-wrap:wrap;">
                        ${pm.recovery.map(r => `<span class="tag" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); padding:2px 7px; border-radius:5px; font-size:0.73em;">${escapeHtml(r.name)}: ${r.blocker.blocked ? r.blocker.label : '✅ Clear'}</span>`).join('')}
                    </div>
                    <div style="font-size:0.77em; color:#fde68a; background:rgba(245,158,11,0.08); padding:7px 9px; border-radius:6px; border:1px solid rgba(245,158,11,0.25);">
                        💡 ${escapeHtml(pm.tip)}
                    </div>
                </div>`;
        }).join('');
    }

    // ─── View 6: 30-Day OC Economics & CSV Export (Tool 15) ───
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

            const pKey = `${tier}:${c.name}`;
            if (!profitMap[pKey]) profitMap[pKey] = { name: c.name, tier, wins: 0, fails: 0, gross: 0, gear: 0, respect: 0 };
            const pm = profitMap[pKey];
            if (isWin) pm.wins++; else pm.fails++;

            let crimeGear = 0;
            (c.slots || []).forEach(s => {
                if (s.item_requirement && !s.item_requirement.is_reusable && s.user?.item_outcome?.outcome === 'used') {
                    crimeGear += Number(s.item_requirement.market_value || 0);
                }
            });
            reimbCost += crimeGear;
            pm.gear += crimeGear;

            if (isWin) {
                const m = Number(c.rewards?.money || 0);
                const iv = Number(c.rewards?.item_value_total || 0);
                const r = Number(c.rewards?.respect || 0);
                const vaultPct = c.rewards?.payout?.percentage !== undefined ? Math.max(0, 100 - Number(c.rewards.payout.percentage)) : payoutState.vaultPct;
                const vc = Math.round((m + iv) * (vaultPct / 100));

                grossCash += m;
                itemDropsVal += iv;
                vaultCutEst += vc;
                respect += r;
                pm.gross += m + iv;
                pm.respect += r;

                const day = formatTctDate(c.executed_at || c.ready_at || 0);
                if (!dailyMap[day]) dailyMap[day] = { day, cash: 0, items: 0, vault: 0 };
                dailyMap[day].cash += m;
                dailyMap[day].items += iv;
                dailyMap[day].vault += vc;

                (c.rewards?.items || []).forEach(it => {
                    dropRows.push({ day, crime: c.name, item: it.name || `Item #${it.id}`, qty: it.quantity || 1, val: it.total_value || 0 });
                });
            }
        });

        const banner = document.getElementById('econ-totals-banner');
        if (banner) {
            banner.textContent = `${crimes.length} Completed OCs • Cash: ${fmtCompactMoney(grossCash)} • Item Drops: ${fmtCompactMoney(itemDropsVal)} • Gear Used: ${fmtCompactMoney(reimbCost)} • Vault Retained: ${fmtCompactMoney(vaultCutEst)} • +${fmt(respect)} Respect`;
        }

        // Card 1: Daily Revenue SVG Stacked Bar Chart
        const revEl = document.getElementById('econ-revenue-chart');
        if (revEl) {
            const days = Object.values(dailyMap).sort((a, b) => a.day.localeCompare(b.day)).slice(-18);
            if (!days.length) {
                revEl.innerHTML = '<div style="padding:24px; color:var(--text-tertiary); font-size:0.82em;">No successful OCs in selected timeframe.</div>';
            } else {
                const mx = Math.max(1, ...days.map(d => d.cash + d.items));
                const barW = Math.max(12, Math.floor(460 / days.length) - 6);
                revEl.innerHTML = `
                    <svg viewBox="0 0 500 180" style="width:100%; height:180px;">
                        ${days.map((d, i) => {
                            const total = d.cash + d.items;
                            const totalH = Math.max(4, Math.round((total / mx) * 140));
                            const cashH = Math.round((d.cash / mx) * 140);
                            const itemH = Math.max(0, totalH - cashH);
                            const x = 14 + i * ((472) / days.length);
                            return `
                                <g>
                                    <rect x="${x.toFixed(1)}" y="${150 - cashH}" width="${barW}" height="${cashH}" rx="2" fill="#38bdf8"><title>${d.day}: Cash ${fmtMoney(d.cash)} | Drops ${fmtMoney(d.items)} | Vault ~${fmtMoney(d.vault)}</title></rect>
                                    ${itemH > 0 ? `<rect x="${x.toFixed(1)}" y="${150 - totalH}" width="${barW}" height="${itemH}" rx="2" fill="#a78bfa"/>` : ''}
                                    <text x="${(x + barW / 2).toFixed(1)}" y="168" text-anchor="middle" fill="#64748b" font-size="8" font-family="JetBrains Mono">${d.day.slice(5)}</text>
                                </g>`;
                        }).join('')}
                    </svg>
                    <div style="display:flex; gap:14px; font-size:0.74em; color:var(--text-secondary);">
                        <span>🟦 Gross Cash (${fmtCompactMoney(grossCash)})</span>
                        <span>🟪 Item Drops (${fmtCompactMoney(itemDropsVal)})</span>
                        <span>Vault Est.: ${fmtCompactMoney(vaultCutEst)}</span>
                    </div>`;
            }
        }

        // Card 2: Tier Success vs Failure Chart
        const tierEl = document.getElementById('econ-tier-chart');
        if (tierEl) {
            const tiers = Object.values(tierMap).sort((a, b) => a.tier - b.tier);
            tierEl.innerHTML = tiers.length ? tiers.map(t => {
                const tot = t.wins + t.fails;
                const winPct = Math.round((t.wins / tot) * 100);
                return `
                    <div style="margin-bottom:9px;">
                        <div style="display:flex; justify-content:space-between; font-size:0.78em; margin-bottom:3px;">
                            <strong>Tier ${t.tier}</strong>
                            <span class="font-mono">${t.wins}W / ${t.fails}F (${winPct}% Win)</span>
                        </div>
                        <div style="height:10px; border-radius:6px; background:rgba(244,63,94,0.45); overflow:hidden; display:flex;">
                            <div style="width:${winPct}%; background:linear-gradient(90deg,#10b981,#06b6d4);"></div>
                        </div>
                    </div>`;
            }).join('') : '<div style="padding:24px; color:var(--text-tertiary); font-size:0.82em;">No tier records in selected timeframe.</div>';
        }

        // Card 3: Item Drops Table
        const dropsBody = document.getElementById('econ-drops-tbody');
        if (dropsBody) {
            dropsBody.innerHTML = dropRows.length ? dropRows.slice(0, 30).map(r => `
                <tr>
                    <td class="font-mono">${r.day}</td>
                    <td>${escapeHtml(r.crime)}</td>
                    <td><strong>${escapeHtml(r.item)}</strong></td>
                    <td class="font-mono">${r.qty}</td>
                    <td class="font-mono" style="color:#a78bfa; font-weight:800;">${fmtMoney(r.val)}</td>
                </tr>`).join('') : '<tr><td colspan="5" style="text-align:center; padding:18px; color:var(--text-tertiary);">No item drops in selected window.</td></tr>';
        }

        // Card 4: Crime Profitability Leaderboard
        const profBody = document.getElementById('econ-profit-tbody');
        if (profBody) {
            const pRows = Object.values(profitMap).sort((a, b) => b.gross - a.gross);
            profBody.innerHTML = pRows.length ? pRows.map(p => `
                <tr>
                    <td><span class="diff-badge">T${p.tier}</span> <strong>${escapeHtml(p.name)}</strong></td>
                    <td class="font-mono">${p.wins} / ${p.fails}</td>
                    <td class="font-mono" style="color:#34d399; font-weight:800;">${fmtCompactMoney(p.gross)}</td>
                    <td class="font-mono" style="color:#fbbf24;">${fmtCompactMoney(p.gear)}</td>
                    <td class="font-mono" style="color:#c4b5fd;">+${fmt(p.respect)}</td>
                </tr>`).join('') : '<tr><td colspan="5" style="text-align:center; padding:18px; color:var(--text-tertiary);">No completed crimes in window.</td></tr>';
        }
    }

    window.exportOcLedgerCSV = function () {
        const crimes = getFilteredCompletedForEconomics();
        if (!crimes.length) return showOcToast('No completed OC records in selected window to export.');
        const headers = ['Crime ID', 'Date (TCT)', 'Crime Name', 'Tier', 'Status', 'Gross Cash', 'Item Drops Value', 'Consumable Cost', 'Vault %', 'Respect', 'Participants & Roles', 'Member Payout Splits'];
        const rows = crimes.map(c => {
            const dt = formatTctDate(c.executed_at || c.ready_at || 0);
            const slots = (c.slots || []).filter(s => s.user);
            const parts = slots.map(s => `${s.user.name || s.user.id} (${s.position_info?.label || s.position} ${s.checkpoint_pass_rate || 0}%)`).join('; ');
            let gearCost = 0;
            slots.forEach(s => {
                if (s.item_requirement && !s.item_requirement.is_reusable && s.user?.item_outcome?.outcome === 'used') {
                    gearCost += Number(s.item_requirement.market_value || 0);
                }
            });
            const gross = Number(c.rewards?.gross_total || ((c.rewards?.money || 0) + (c.rewards?.item_value_total || 0)));
            const payPct = c.rewards?.payout?.percentage !== undefined ? Number(c.rewards.payout.percentage) : (100 - payoutState.vaultPct);
            const vaultPct = Math.max(0, 100 - payPct);
            const netPool = Math.max(0, Math.round(gross * (payPct / 100)));
            const perMember = slots.length ? Math.round(netPool / slots.length) : 0;
            const splitsStr = String(c.status || '').toLowerCase() === 'successful'
                ? slots.map(s => `${s.user.name || s.user.id}: $${perMember.toLocaleString('en-US')}`).join('; ')
                : '$0 (Failed)';
            return [
                sanitizeCSVCell(c.id),
                sanitizeCSVCell(dt),
                sanitizeCSVCell(c.name),
                c.difficulty || 1,
                sanitizeCSVCell(c.status),
                Number(c.rewards?.money || 0),
                Number(c.rewards?.item_value_total || 0),
                gearCost,
                vaultPct,
                Number(c.rewards?.respect || 0),
                sanitizeCSVCell(parts),
                sanitizeCSVCell(splitsStr)
            ];
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

    // ─── Modals: Tool 11 Broadcast Studio & Tool 3 CPR Import ───
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
            if (!targetCrimes.length) {
                text = `${mention} No open Recruiting OC slots right now!`;
            } else {
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
            if (!targetCrimes.length) {
                text = 'OPEN OCs: All current recruiting slots filled!';
            } else {
                const compactParts = targetCrimes.map(c => {
                    const roles = (c.slots || []).filter(s => !s.user).map(s => `${s.position_info?.label || s.position} ${c.floor}%+`);
                    return `[${c.name}: Need ${roles.slice(0, 3).join(', ')}]`;
                });
                text = `📢 OPEN OCs: ${compactParts.join(' • ')} — Join Faction Crimes!`;
                if (text.length > 248) text = text.slice(0, 245) + '...';
            }
        }
        area.value = text;
        if (cntEl) cntEl.textContent = `${text.length}${broadcastTab === 'torn' ? ' / 250 max chars' : ' chars'}`;
    };
    window.copyBroadcastText = function () {
        const txt = document.getElementById('bc-preview-text')?.value || '';
        copyText(txt, '📢 Broadcast callout copied to clipboard!');
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
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tornStatsKey: rawTsKey, manualOverrides })
                });
                const d = await res.json();
                if (!res.ok || d.error) showOcToast(`⚠️ CPR Import notice: ${d.error}`);
                else {
                    cmdData.cprOverrides = d.overrides || cmdData.cprOverrides;
                    showOcToast(`✅ Saved floors & imported ${d.importedCount || 0} CPR entries!`);
                }
            } catch (e) {
                showOcToast(`⚠️ CPR Sync failed: ${e.message}`);
            }
        } else {
            showOcToast(`✅ Saved Safe Floors: Tiers 1–4 (${low}%), Tiers 5–8 (${high}%)`);
        }

        closeCprModal();
        recomputeCommandAnalytics();
        renderAllActiveViews();
    };

    // ─── Master Render + Live 1s Countdown Ticker ───
    function renderAllActiveViews() {
        renderKpisAndHeader();
        if (currentView === 'board') renderBoard();
        else if (currentView === 'bench') renderBenchView();
        else if (currentView === 'payouts') renderPayoutsView();
        else if (currentView === 'roi') renderRoiAndSimulatorView();
        else if (currentView === 'leaderboard') renderLeaderboardView();
        else if (currentView === 'economics') renderEconomicsView();
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
                const readyAt = Number(el.dataset.ready);
                const rem = readyAt - nowSec;
                if (rem <= 0) {
                    if (el.textContent !== 'READY!') {
                        el.textContent = 'READY!';
                        el.style.color = '#34d399';
                        needRecompute = true;
                    }
                } else {
                    el.textContent = formatCountdown(rem);
                }
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
                el.textContent = rem > 0 ? formatDurationShort(rem) : '0s (Refreshing)';
            });

            if (needRecompute && cmdData.crimes.length) {
                recomputeCommandAnalytics();
                renderAllActiveViews();
            }
        }, 1000);
    }

    // ─── Event Listeners & Bootstrap ───
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeOcDossier();
            closeBroadcastModal();
            closeCprModal();
            window.closeSettings();
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopProgressBar();
        else if (hasOcAccess()) window.fetchOCs(false);
    });

    document.addEventListener('DOMContentLoaded', () => {
        // Bind debounced real-time inputs
        const boardSearch = document.getElementById('oc-search-input');
        if (boardSearch) boardSearch.addEventListener('input', debounce(() => renderBoardCrimesOnly(), 150));

        const benchSearch = document.getElementById('bench-search-input');
        if (benchSearch) benchSearch.addEventListener('input', debounce(() => renderBenchView(), 150));

        const lbSearch = document.getElementById('lb-search-input');
        if (lbSearch) lbSearch.addEventListener('input', debounce(() => window.renderLeaderboard(), 150));

        document.getElementById('gantt-btn-24')?.classList.toggle('active', ganttWindowHours === 24);
        document.getElementById('gantt-btn-72')?.classList.toggle('active', ganttWindowHours === 72);

        // Route initial hash (#board, #bench, #payouts, #roi, #leaderboard, #economics, or legacy #ready/#planning/#recruiting)
        const rawHash = (window.location.hash || '').replace('#', '').toLowerCase();
        if (['bench', 'payouts', 'roi', 'leaderboard', 'economics', 'board'].includes(rawHash)) {
            currentView = rawHash;
            document.querySelectorAll('.oc-view-tab').forEach(b => b.classList.toggle('active', b.id === `view-tab-${rawHash}`));
            document.querySelectorAll('.oc-view-pane').forEach(p => p.classList.toggle('active', p.id === `pane-${rawHash}`));
        } else if (['recruiting', 'planning', 'ready'].includes(rawHash)) {
            currentView = 'board';
            currentBoardTab = rawHash;
            document.querySelectorAll('#board-status-pills .tab-btn').forEach(b => b.classList.toggle('active', b.id === `tab-${rawHash}`));
        }

        // Instant hydration from sessionStorage cache
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
