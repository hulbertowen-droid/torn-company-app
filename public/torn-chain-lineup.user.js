// ==UserScript==
// @name         Spider-Verse Chain Manager (Standalone)
// @namespace    https://torn-company-app-production.up.railway.app/
// @version      2.1.0
// @description  Professional standalone chain lineup manager on Torn. Direct API hits, intelligent readiness detection, auto-advance, 1-click faction chat posting. Runs on faction pages only.
// @author       Spider-Verse
// @match        https://www.torn.com/factions.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      api.torn.com
// @connect      torn-company-app-production.up.railway.app
// @run-at       document-end
// @updateURL    https://torn-company-app-production.up.railway.app/torn-chain-lineup.user.js
// @downloadURL  https://torn-company-app-production.up.railway.app/torn-chain-lineup.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ══════════════════════════════════════════════════════════════
    //  STRICT PAGE FILTER: ONLY RUN ON FACTION PAGES
    // ══════════════════════════════════════════════════════════════
    if (!window.location.pathname.includes('factions.php')) {
        return;
    }

    // ══════════════════════════════════════════════════════════════
    //  CONSTANTS & STATE
    // ══════════════════════════════════════════════════════════════
    const LS_KEY_POS      = 'sv_chain_mgr_pos';
    const LS_KEY_APIKEY   = 'sv_chain_apikey';
    const LS_KEY_MEMBERS  = 'sv_chain_members_cache';
    const FAST_POLL_MS    = 1000;  // 1-second unified poll for attacks & chain
    const STATUS_POLL_MS  = 60000; // 60s for member online/offline status

    let apiKey         = GM_getValue('sv_apikey', '') || localStorage.getItem(LS_KEY_APIKEY) || '';
    let lineup         = [];          // [{name, id, hit, skipped}]
    let targetHitTime  = '3:00';
    let cycleNum       = 1;
    let loopMode       = true;
    let autoMode       = false;
    let chainTimeout   = 0;          // seconds left on timer
    let chainCount     = 0;          // current chain count
    let chainActive    = false;
    let factionMembers = [];         // [{id, name, online, state, until, lastActionTs}]
    let memberStatuses = {};         // id -> {online, state, until, lastActionTs}
    let processedAtkIds = new Set();
    let isFirstPoll     = true;      // snapshot initial attacks
    let autoSkipTimer   = null;
    let autoSkipLeft    = 0;
    let isMinimized     = GM_getValue('sv_min', false);
    let searchQuery     = '';
    let suggestSelected = -1;
    let isUpdated       = false;     // green/grey light
    let timerInterval   = null;

    let pollInterval        = null;
    let pollMembersInterval = null;

    // ══════════════════════════════════════════════════════════════
    //  PERSISTENCE
    // ══════════════════════════════════════════════════════════════
    function save() {
        GM_setValue('sv_state', JSON.stringify({ lineup, targetHitTime, cycleNum, loopMode, autoMode }));
        if (apiKey) {
            syncToServer();
        }
    }

    function load() {
        try {
            const raw = GM_getValue('sv_state', '{}');
            const d = JSON.parse(raw);
            if (d.lineup)                 lineup        = d.lineup;
            if (d.targetHitTime !== undefined) targetHitTime = d.targetHitTime;
            if (d.cycleNum)               cycleNum      = d.cycleNum;
            if (d.loopMode !== undefined) loopMode      = d.loopMode;
            if (d.autoMode !== undefined) autoMode      = d.autoMode;
        } catch(e) {}

        try {
            const cm = localStorage.getItem(LS_KEY_MEMBERS) || GM_getValue(LS_KEY_MEMBERS, '[]');
            factionMembers = JSON.parse(cm) || [];
            for (const m of factionMembers) {
                memberStatuses[String(m.id)] = {
                    online: m.online,
                    state: m.state,
                    until: m.until || 0,
                    lastActionTs: m.lastActionTs || 0
                };
            }
        } catch(e) {}
    }

    function syncToServer() {
        const full = _buildFullText();
        const compact = _buildCompactText();
        try {
            const body = JSON.stringify({ lineup, targetHitTime, cycle: cycleNum, formattedFull: full, formattedCompact: compact });
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://torn-company-app-production.up.railway.app/api/chain/lineup',
                headers: { 'Content-Type': 'application/json' },
                data: body,
                timeout: 3000,
                onerror: () => {}
            });
        } catch(e) {}
    }

    // ══════════════════════════════════════════════════════════════
    //  TORN API (LIGHTNING FAST 1.0s UNIFIED CALL)
    // ══════════════════════════════════════════════════════════════
    function tornGet(path, cb) {
        if (!apiKey) return cb(new Error('No API key'), null);
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.torn.com${path}&key=${apiKey}`,
            timeout: 6000,
            onload(res) {
                try {
                    const d = JSON.parse(res.responseText);
                    if (d && d.error) return cb(d.error, null);
                    cb(null, d);
                } catch(e) { cb(e, null); }
            },
            onerror(e) { cb(e, null); }
        });
    }

    function handleMembersResponse(d) {
        if (!d || !d.members) return;
        factionMembers = Object.entries(d.members).map(([id, m]) => ({
            id: parseInt(id, 10),
            name: m.name,
            online: (m.last_action || {}).status || 'Offline',
            state: (m.status || {}).state || 'Okay',
            until: (m.status || {}).until || 0,
            lastActionTs: (m.last_action || {}).timestamp || 0
        })).sort((a, b) => a.name.localeCompare(b.name));

        try {
            localStorage.setItem(LS_KEY_MEMBERS, JSON.stringify(factionMembers));
            GM_setValue(LS_KEY_MEMBERS, JSON.stringify(factionMembers));
        } catch(e) {}

        for (const m of factionMembers) {
            memberStatuses[String(m.id)] = {
                online: m.online,
                state: m.state,
                until: m.until || 0,
                lastActionTs: m.lastActionTs || 0
            };
        }
        renderSuggest();
        renderLineup();
    }

    // Verify if an attacker matches the player currently UP (slot 0)
    function isCurrentUp(atk) {
        if (!lineup.length) return false;
        const up = lineup[0];
        const upId = up.id ? String(up.id) : null;
        const atkId = atk.attacker_id ? String(atk.attacker_id) : null;
        if (upId && atkId && upId === atkId) return true;

        const upName = (up.name || '').trim().toLowerCase();
        const atkName = (atk.attacker_name || '').trim().toLowerCase();
        if (upName && atkName && upName === atkName) return true;

        return false;
    }

    // Unified 1.0s Polling: both attacks and chain in a single API call
    function pollChainAndAttacks() {
        if (!apiKey) return;

        tornGet('/faction/?selections=attacks,chain', (err, d) => {
            if (err || !d) return;

            // 1. Process Live Chain Status
            const chain = d.chain || {};
            chainCount   = chain.current || 0;
            chainTimeout = chain.timeout || 0;
            chainActive  = chainCount > 0;

            // 2. Process Attacks
            if (d.attacks) {
                const rawAtks = Object.values(d.attacks);
                const chainAtks = rawAtks
                    .filter(a => a.chain && a.chain > 0)
                    .sort((a, b) => (b.timestamp_ended || 0) - (a.timestamp_ended || 0));

                if (isFirstPoll) {
                    for (const atk of chainAtks) {
                        const id = atk.code || `${atk.attacker_id}_${atk.timestamp_ended}`;
                        processedAtkIds.add(id);
                    }
                    isFirstPoll = false;
                    renderChainBar();
                    return;
                }

                let orderChanged = false;

                for (const atk of chainAtks) {
                    const id = atk.code || `${atk.attacker_id}_${atk.timestamp_ended}`;
                    if (processedAtkIds.has(id)) continue;
                    processedAtkIds.add(id);

                    if (processedAtkIds.size > 500) {
                        const arr = [...processedAtkIds];
                        processedAtkIds = new Set(arr.slice(arr.length - 250));
                    }

                    // STRICT VERIFICATION: ONLY currently UP player advances lineup
                    if (isCurrentUp(atk)) {
                        const [hitter] = lineup.splice(0, 1);
                        hitter.hit = true;
                        lineup.push(hitter);
                        orderChanged = true;
                        cycleNum++;

                        flashStatus(`✓ ${atk.attacker_name} landed hit #${atk.chain}! Next UP: ${lineup[0].name}`, false);
                        clearAutoSkip();
                        if (autoMode) startAutoSkip();
                    } else {
                        // Someone else hit (e.g. John 2 hit while John 1 was UP)
                        // John 1 STAYS UP! Lineup does NOT rotate!
                        const attackerId = atk.attacker_id ? String(atk.attacker_id) : null;
                        const attackerName = (atk.attacker_name || '').trim().toLowerCase();

                        const otherIdx = lineup.findIndex((m, idx) => idx > 0 && (
                            (m.id && attackerId && String(m.id) === attackerId) ||
                            (m.name && m.name.trim().toLowerCase() === attackerName)
                        ));

                        if (otherIdx !== -1) {
                            lineup[otherIdx].hit = true;
                        }

                        if (lineup.length > 0) {
                            flashStatus(`Hit #${atk.chain} by ${atk.attacker_name} (${lineup[0].name} is still UP)`, false);
                        }
                    }
                }

                if (orderChanged) {
                    setUpdated(true);
                    save();
                    renderLineup();
                } else {
                    renderChainBar();
                }
            } else {
                renderChainBar();
            }
        });
    }

    function fetchFactionMembers() {
        tornGet('/faction/?selections=basic', (err, d) => {
            if (err || !d) return;
            handleMembersResponse(d);
        });
    }

    function startBackgroundPolling() {
        if (!apiKey) return;
        if (pollInterval) clearInterval(pollInterval);
        if (pollMembersInterval) clearInterval(pollMembersInterval);

        pollChainAndAttacks();
        fetchFactionMembers();

        pollInterval = setInterval(pollChainAndAttacks, FAST_POLL_MS);
        pollMembersInterval = setInterval(fetchFactionMembers, STATUS_POLL_MS);
    }

    // ══════════════════════════════════════════════════════════════
    //  PLAYER READINESS HELPER (GROUNDED IN TORN DATA)
    // ══════════════════════════════════════════════════════════════
    function getMemberReadiness(id) {
        const st = memberStatuses[String(id)];
        if (!st) {
            return {
                online: 'Offline', state: 'Okay', isReady: false,
                statusText: 'OFFLINE • UNAVAILABLE',
                shortText: 'OFFLINE',
                dotColor: '#718096',
                cls: 'st-offline'
            };
        }

        const online = st.online || 'Offline';
        const state  = st.state || 'Okay';
        const until  = st.until || 0;
        const now    = Math.floor(Date.now() / 1000);

        let hospMins = 0;
        if (state === 'Hospital' && until > now) {
            hospMins = Math.ceil((until - now) / 60);
        }

        if (state === 'Hospital') {
            const timeStr = hospMins > 0 ? ` (${hospMins}m)` : '';
            return {
                online, state, isReady: false,
                statusText: `HOSPITAL${timeStr} • UNAVAILABLE`,
                shortText: `HOSP${timeStr}`,
                dotColor: '#f85149',
                cls: 'st-hosp'
            };
        }

        if (state === 'Traveling' || state === 'Abroad') {
            return {
                online, state, isReady: false,
                statusText: 'TRAVELING • UNAVAILABLE',
                shortText: 'TRAVELING',
                dotColor: '#58a6ff',
                cls: 'st-travel'
            };
        }

        if (state === 'Jail' || state === 'Federal') {
            return {
                online, state, isReady: false,
                statusText: 'JAIL • UNAVAILABLE',
                shortText: 'JAIL',
                dotColor: '#f85149',
                cls: 'st-jail'
            };
        }

        if (online === 'Online' && state === 'Okay') {
            return {
                online, state, isReady: true,
                statusText: 'ONLINE • READY',
                shortText: 'ONLINE • READY',
                dotColor: '#2ecc71',
                cls: 'st-ready'
            };
        }

        if (online === 'Idle' && state === 'Okay') {
            return {
                online, state, isReady: true,
                statusText: 'ONLINE • IDLE • READY',
                shortText: 'IDLE • READY',
                dotColor: '#e3b341',
                cls: 'st-idle'
            };
        }

        return {
            online: 'Offline', state: 'Okay', isReady: false,
            statusText: 'OFFLINE • UNAVAILABLE',
            shortText: 'OFFLINE',
            dotColor: '#718096',
            cls: 'st-offline'
        };
    }

    // ══════════════════════════════════════════════════════════════
    //  API KEY SAVING & VALIDATION
    // ══════════════════════════════════════════════════════════════
    function saveApiKey() {
        const inp = document.getElementById('sv-apikey-input');
        const val = (inp?.value || '').trim();
        if (!val) {
            flashStatus('Please enter an API key.', true);
            return;
        }

        flashStatus('Validating API key with Torn...', false);
        const saveBtn = document.getElementById('sv-apikey-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.torn.com/faction/?selections=basic&key=${val}`,
            timeout: 9000,
            onload(res) {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save Key';
                }
                try {
                    const d = JSON.parse(res.responseText);
                    if (d && d.error) {
                        flashStatus(`Error (${d.error.code}): ${d.error.error}`, true);
                        return;
                    }

                    apiKey = val;
                    GM_setValue('sv_apikey', apiKey);
                    try { localStorage.setItem(LS_KEY_APIKEY, apiKey); } catch(e) {}

                    const row = document.getElementById('sv-apikey-row');
                    if (row) row.style.display = 'none';

                    flashStatus(`✓ Connected to ${d.name || 'Faction'}!`, false);

                    if (d.members) {
                        handleMembersResponse(d);
                    }
                    startBackgroundPolling();

                } catch(err) {
                    flashStatus('Invalid response from Torn API.', true);
                }
            },
            onerror() {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save Key';
                }
                flashStatus('Network error verifying key.', true);
            }
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  TEXT GENERATORS
    // ══════════════════════════════════════════════════════════════
    function _buildFullText() {
        if (!lineup.length) return '';
        const lines = [];
        if (targetHitTime) lines.push(`HIT AT: ${targetHitTime}`);
        if (lineup.length >= 1) lines.push(`UP: ${lineup[0].name}`);
        if (lineup.length >= 2) lines.push(`NEXT: ${lineup[1].name}`);
        for (let i = 2; i < lineup.length; i++) lines.push(`${i + 1}. ${lineup[i].name}`);
        return lines.join('\n');
    }

    function _buildCompactText() {
        if (!lineup.length) return '';
        const parts = [];
        if (targetHitTime) parts.push(`[HIT AT ${targetHitTime}]`);
        if (lineup.length >= 1) parts.push(`UP: ${lineup[0].name}`);
        if (lineup.length >= 2) parts.push(`NEXT: ${lineup[1].name}`);
        for (let i = 2; i < lineup.length; i++) parts.push(`${i + 1}. ${lineup[i].name}`);
        return parts.join(' | ');
    }

    // ══════════════════════════════════════════════════════════════
    //  LINEUP OPERATIONS
    // ══════════════════════════════════════════════════════════════
    function addMember(name, id) {
        name = (name || '').trim();
        if (!name) return;
        if (lineup.some(m => m.name.toLowerCase() === name.toLowerCase())) {
            flashStatus(`${name} is already in the lineup.`, true);
            return;
        }
        lineup.push({ name, id: id || null, hit: false, skipped: false });
        save();
        renderLineup();
        flashStatus(`Added ${name}.`, false);
    }

    function removeMember(idx) {
        if (idx < 0 || idx >= lineup.length) return;
        const [r] = lineup.splice(idx, 1);
        save();
        renderLineup();
        flashStatus(`Removed ${r.name}.`, false);
    }

    function moveMember(from, to) {
        if (from === to || from < 0 || to < 0 || from >= lineup.length || to >= lineup.length) return;
        const item = lineup.splice(from, 1)[0];
        lineup.splice(to, 0, item);
        save();
        renderLineup();
    }

    function promptMove(idx) {
        const m = lineup[idx];
        if (!m) return;
        const raw = prompt(`Move "${m.name}" to position (1-${lineup.length}):`, String(idx + 1));
        if (!raw) return;
        const pos = parseInt(raw, 10) - 1;
        if (isNaN(pos) || pos < 0 || pos >= lineup.length) return;
        moveMember(idx, pos);
    }

    function skipMember(idx) {
        if (idx < 0 || idx >= lineup.length) return;
        const [s] = lineup.splice(idx, 1);
        lineup.push(s);
        save();
        renderLineup();
        clearAutoSkip();
        if (autoMode) startAutoSkip();
        flashStatus(`Skipped ${s.name}.`, false);
    }

    function makeCurrent(idx) {
        if (idx <= 0 || idx >= lineup.length) return;
        const item = lineup.splice(idx, 1)[0];
        lineup.unshift(item);
        save();
        renderLineup();
        flashStatus(`${item.name} moved to Currently Up.`, false);
    }

    function swapTopTwo() {
        if (lineup.length < 2) return;
        [lineup[0], lineup[1]] = [lineup[1], lineup[0]];
        save();
        renderLineup();
        flashStatus(`Swapped ${lineup[0].name} and ${lineup[1].name}.`, false);
    }

    function nextTurn() {
        if (!lineup.length) return;
        const [s] = lineup.splice(0, 1);
        lineup.push(s);
        clearAutoSkip();
        if (autoMode) startAutoSkip();
        save();
        renderLineup();
        flashStatus(`Advanced: ${s.name} moved to bottom.`, false);
    }

    function resetHits() {
        lineup.forEach(m => { m.hit = false; m.skipped = false; });
        cycleNum = 1;
        save();
        renderLineup();
        clearAutoSkip();
        if (autoMode) startAutoSkip();
        flashStatus('Hit marks cleared for new cycle.', false);
    }

    function clearAll() {
        if (!confirm('Remove all members from the lineup?')) return;
        lineup = [];
        cycleNum = 1;
        save();
        renderLineup();
        clearAutoSkip();
        flashStatus('Lineup cleared.', false);
    }

    // ══════════════════════════════════════════════════════════════
    //  INTELLIGENT AUTO-FILL
    //  Prioritizes: Online+Okay (most recent) > Idle+Okay (most recent)
    // ══════════════════════════════════════════════════════════════
    function autoFill() {
        if (!factionMembers.length) {
            flashStatus('No faction members loaded. Click ↻ Refresh.', true);
            return;
        }

        // Filter only members who are actually capable of participating
        const capable = factionMembers.filter(m => {
            const state = m.state || 'Okay';
            const online = m.online || 'Offline';
            return state === 'Okay' && (online === 'Online' || online === 'Idle');
        });

        if (!capable.length) {
            flashStatus('No ready (Online/Idle + Okay) members found.', true);
            return;
        }

        // Sort: Online first, then Idle; break ties by most recently active
        capable.sort((a, b) => {
            if (a.online === 'Online' && b.online !== 'Online') return -1;
            if (a.online !== 'Online' && b.online === 'Online') return 1;
            return (b.lastActionTs || 0) - (a.lastActionTs || 0);
        });

        let added = 0;
        let onlineCount = 0;
        let idleCount = 0;

        for (const m of capable) {
            const exists = lineup.some(lm =>
                (lm.id && lm.id === m.id) ||
                lm.name.toLowerCase() === m.name.toLowerCase()
            );
            if (!exists) {
                lineup.push({ name: m.name, id: m.id, hit: false, skipped: false });
                added++;
                if (m.online === 'Online') onlineCount++;
                else idleCount++;
            }
        }

        save();
        renderLineup();

        if (added > 0) {
            flashStatus(`Auto-filled ${added} ready members (${onlineCount} Online, ${idleCount} Idle).`, false);
        } else {
            flashStatus('All capable faction members are already in the lineup.', false);
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  AUTO-SKIP TIMER
    // ══════════════════════════════════════════════════════════════
    const AUTO_SKIP_SECS = 45;
    function startAutoSkip() {
        clearAutoSkip();
        autoSkipLeft = AUTO_SKIP_SECS;
        autoSkipTimer = setInterval(() => {
            autoSkipLeft--;
            updateAutoSkipDisplay();
            if (autoSkipLeft <= 0) {
                clearAutoSkip();
                if (lineup.length > 0) {
                    skipMember(0);
                    flashStatus(`Auto-skipped ${lineup[lineup.length-1].name} (timeout).`, false);
                }
            }
        }, 1000);
    }

    function clearAutoSkip() {
        if (autoSkipTimer) { clearInterval(autoSkipTimer); autoSkipTimer = null; }
        autoSkipLeft = 0;
        updateAutoSkipDisplay();
    }

    function updateAutoSkipDisplay() {
        const el = document.getElementById('sv-autoskip-cd');
        if (el) el.textContent = autoSkipLeft > 0 ? `auto-skip in ${autoSkipLeft}s` : '';
    }

    // ══════════════════════════════════════════════════════════════
    //  STATUS LIGHT (UPDATED / SAME) & MINIMIZED PILL UP TEXT
    // ══════════════════════════════════════════════════════════════
    function updateMinDisplay() {
        const minUp = document.getElementById('sv-min-up');
        if (!minUp) return;
        if (lineup.length > 0) {
            minUp.textContent = `UP: ${lineup[0].name}`;
            minUp.title = `Currently Up: ${lineup[0].name}${lineup.length > 1 ? ' | Next: ' + lineup[1].name : ''}`;
        } else {
            minUp.textContent = 'No lineup';
            minUp.title = '';
        }
    }

    function setUpdated(val) {
        isUpdated = val;
        const pill   = document.getElementById('sv-status-pill');
        const dot    = document.getElementById('sv-status-dot');
        const txt    = document.getElementById('sv-status-txt');
        const minBtn = document.getElementById('sv-min-post-btn');
        const mainBtn= document.getElementById('sv-post-btn');

        updateMinDisplay();

        if (val) {
            if (pill) { pill.className = 'sv-status-pill sv-updated'; pill.title = 'Lineup updated! New hit detected.'; }
            if (dot)  dot.className = 'sv-dot sv-dot-green';
            if (txt)  txt.textContent = 'UPDATED';
            if (mainBtn) mainBtn.style.boxShadow = '0 0 14px rgba(46,204,113,0.65)';
            if (minBtn)  minBtn.style.boxShadow  = '0 0 10px rgba(46,204,113,0.65)';
        } else {
            if (pill) { pill.className = 'sv-status-pill sv-same'; pill.title = 'Lineup unchanged since last post.'; }
            if (dot)  dot.className = 'sv-dot sv-dot-grey';
            if (txt)  txt.textContent = 'SAME';
            if (mainBtn) mainBtn.style.boxShadow = '';
            if (minBtn)  minBtn.style.boxShadow  = '';
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  STATUS MESSAGE FLASH
    // ══════════════════════════════════════════════════════════════
    let _statusTimer = null;
    function flashStatus(msg, isError) {
        const el = document.getElementById('sv-status-msg');
        if (!el) return;
        el.textContent = msg;
        el.style.color = isError ? '#f85149' : '#2ecc71';
        if (_statusTimer) clearTimeout(_statusTimer);
        _statusTimer = setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
    }

    // ══════════════════════════════════════════════════════════════
    //  LOCAL TIMER DISPLAY
    // ══════════════════════════════════════════════════════════════
    function startLocalTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (chainActive && chainTimeout > 0) chainTimeout--;
            renderChainBar();
        }, 1000);
    }

    function fmtSecs(s) {
        if (!s || s <= 0) return '0:00';
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${String(sec).padStart(2, '0')}`;
    }

    function parseTimeToSecs(str) {
        if (!str) return 0;
        const p = str.split(':');
        return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
    }

    // ══════════════════════════════════════════════════════════════
    //  FACTION CHAT POSTING
    // ══════════════════════════════════════════════════════════════
    function postToChat() {
        const text = _buildFullText();
        if (!text) { flashStatus('Lineup is empty.', true); return; }

        const chatRoot = document.querySelector('#chatRoot') || document.body;

        const tabs = chatRoot.querySelectorAll('button, div[role="button"], [class*="tab"], [class*="chat-tab"]');
        for (const tab of tabs) {
            if (/faction/i.test(tab.textContent || '') || /faction/i.test(tab.getAttribute('aria-label') || '')) {
                tab.click();
                break;
            }
        }

        setTimeout(() => {
            const inputs = chatRoot.querySelectorAll('textarea, input[type="text"]');
            let target = null;
            if (inputs.length === 1) {
                target = inputs[0];
            } else if (inputs.length > 1) {
                for (const inp of inputs) {
                    const box = inp.closest('div[class*="chat-box"], [class*="chatBox"]');
                    if (box && /faction/i.test(box.textContent || '')) { target = inp; break; }
                }
                if (!target) target = inputs[inputs.length - 1];
            }

            if (!target) {
                navigator.clipboard.writeText(text).catch(() => {});
                flashStatus('Chat not open — copied to clipboard!', false);
                return;
            }

            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
                           Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(target, text);
            else target.value = text;

            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            target.focus();
            target.setSelectionRange(text.length, text.length);

            setUpdated(false);
            flashStatus('✓ Lineup inserted — press Enter to send!', false);
        }, 150);
    }

    function copyToClipboard(type) {
        const text = type === 'compact' ? _buildCompactText() : _buildFullText();
        if (!text) { flashStatus('Lineup is empty.', true); return; }
        navigator.clipboard.writeText(text).then(() => flashStatus('Copied!', false)).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            flashStatus('Copied!', false);
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER: TOP CHAIN STATUS AREA (CLEAR HIERARCHY)
    // ══════════════════════════════════════════════════════════════
    function renderChainBar() {
        const bar = document.getElementById('sv-chain-bar');
        if (!bar) return;

        const timerSecs = chainTimeout;
        const targetSecs = parseTimeToSecs(targetHitTime);
        const inWindow = targetHitTime && timerSecs > 0 && timerSecs <= targetSecs;
        const pctDanger = timerSecs > 0 && timerSecs <= 54;
        const pctWarning = timerSecs > 54 && timerSecs <= 90;

        let timerColor = '#2ecc71';
        if (pctDanger) timerColor = '#f85149';
        else if (pctWarning) timerColor = '#e3b341';

        bar.innerHTML = `
            <div class="sv-stat-grid">
                <!-- TIMER (Primary Focus) -->
                <div class="sv-stat-box sv-stat-timer ${pctDanger ? 'sv-timer-danger' : ''}" title="Time remaining on current chain hit">
                    <div class="sv-stat-num sv-timer-num" style="color:${timerColor};">${chainActive ? fmtSecs(timerSecs) : '0:00'}</div>
                    <div class="sv-stat-lbl">TIMER</div>
                </div>

                <!-- CHAIN COUNT -->
                <div class="sv-stat-box sv-stat-chain" title="Current chain length">
                    <div class="sv-stat-num">${chainActive ? chainCount.toLocaleString() : '0'}</div>
                    <div class="sv-stat-lbl">CHAIN</div>
                </div>

                <!-- TARGET HIT NOW -->
                <div class="sv-stat-box sv-stat-target ${inWindow ? 'sv-box-hit-now' : ''}" title="${inWindow ? 'Chain is inside the hit window — HIT NOW!' : 'Target window threshold'}">
                    <div class="sv-stat-num ${inWindow ? 'sv-hit-now-txt' : ''}">${inWindow ? 'HIT NOW' : (targetHitTime || '—')}</div>
                    <div class="sv-stat-lbl">${inWindow ? '🎯 TARGET' : 'TARGET'}</div>
                </div>

                <!-- INTERVAL & CYCLE -->
                <div class="sv-stat-box sv-stat-meta" title="Hit Interval & Cycle number">
                    <div class="sv-stat-num sv-meta-num">${targetHitTime || 'None'}</div>
                    <div class="sv-stat-lbl">INT • C${cycleNum}</div>
                </div>
            </div>
        `;
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER: LINEUP READINESS SUMMARY
    // ══════════════════════════════════════════════════════════════
    function renderLineupSummaryHtml() {
        if (!lineup.length) return '';

        let readyCount = 0;
        let onlineCount = 0;
        let idleCount = 0;
        let hospCount = 0;
        let offlineCount = 0;

        for (const m of lineup) {
            const r = getMemberReadiness(m.id);
            if (r.isReady) readyCount++;
            if (r.online === 'Online') onlineCount++;
            else if (r.online === 'Idle') idleCount++;
            else if (r.online === 'Offline') offlineCount++;

            if (r.state === 'Hospital') hospCount++;
        }

        return `
            <div class="sv-lineup-summary" title="Lineup readiness breakdown based on live Torn data">
                <span class="sv-summary-chip sv-chip-ready"><span class="sv-mini-dot sv-dot-green"></span>READY <b>${readyCount}</b></span>
                <span class="sv-summary-chip sv-chip-online"><span class="sv-mini-dot sv-dot-blue"></span>ONLINE <b>${onlineCount}</b></span>
                <span class="sv-summary-chip sv-chip-idle"><span class="sv-mini-dot sv-dot-amber"></span>IDLE <b>${idleCount}</b></span>
                <span class="sv-summary-chip sv-chip-hosp"><span class="sv-mini-dot sv-dot-red"></span>HOSP <b>${hospCount}</b></span>
                <span class="sv-summary-chip sv-chip-off"><span class="sv-mini-dot sv-dot-gray"></span>OFFLINE <b>${offlineCount}</b></span>
            </div>
        `;
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER: LINEUP CARDS & QUEUE
    // ══════════════════════════════════════════════════════════════
    function renderLineup() {
        updateMinDisplay();

        const container = document.getElementById('sv-lineup-container');
        if (!container) return;

        if (!lineup.length) {
            container.innerHTML = `<div style="padding:16px 12px;text-align:center;color:#6e7681;font-size:11px;">Lineup is empty — use <b>Auto-Fill Ready</b> or search members below.</div>`;
            renderChainBar();
            return;
        }

        const targetSecs = parseTimeToSecs(targetHitTime);
        const inWindow   = targetHitTime && chainTimeout > 0 && chainTimeout <= targetSecs;

        let html = renderLineupSummaryHtml();

        // ── 1. CURRENTLY UP CARD (Position 0) ──
        const up = lineup[0];
        const rUp = getMemberReadiness(up.id);

        html += `
        <div class="sv-tier-card sv-up-card" draggable="true" data-idx="0">
            <div class="sv-tier-header">
                <div class="sv-tier-tag up-tag">CURRENTLY UP</div>
                ${autoMode ? `<div class="sv-autoskip-txt" id="sv-autoskip-cd">${autoSkipLeft > 0 ? `auto-skip in ${autoSkipLeft}s` : ''}</div>` : ''}
            </div>
            <div class="sv-tier-body">
                <div class="sv-player-row">
                    <span class="sv-pos-num sv-pos-up" data-action="prompt-move" data-idx="0" title="Click to jump position">1</span>
                    <div class="sv-player-meta">
                        <div class="sv-player-name-row">
                            <span class="sv-player-name">${esc(up.name)}</span>
                            ${up.hit ? '<span class="sv-hit-tag">✓ HIT</span>' : ''}
                        </div>
                        <div class="sv-readiness-row ${rUp.cls}">
                            <span class="sv-mini-dot" style="background:${rUp.dotColor};"></span>
                            <span class="sv-readiness-txt">${rUp.statusText}</span>
                        </div>
                    </div>
                    ${inWindow ? `<span class="sv-hit-now-badge">🎯 HIT NOW</span>` : ''}
                </div>
                <div class="sv-tier-actions">
                    <div class="sv-actions-primary">
                        ${lineup.length > 1 ? `<button class="sv-btn sv-btn-xs" data-action="swap-top" title="Swap with Next player">⇄ Swap</button>` : ''}
                        ${lineup.length > 1 ? `<button class="sv-btn sv-btn-xs" data-action="move" data-from="0" data-to="1" title="Move down to Next">▼ Down</button>` : ''}
                        ${lineup.length > 2 ? `<button class="sv-btn sv-btn-xs" data-action="move" data-from="0" data-to="${lineup.length-1}" title="Send to back of queue">⏬ Bottom</button>` : ''}
                    </div>
                    <div class="sv-actions-secondary">
                        <button class="sv-btn sv-btn-xs sv-btn-skip" data-action="skip" data-idx="0" title="Skip this player (moves to bottom)">Skip</button>
                        <button class="sv-btn sv-btn-xs sv-btn-rm" data-action="remove" data-idx="0" title="Remove from lineup">✕</button>
                    </div>
                </div>
            </div>
        </div>`;

        // ── 2. NEXT PLAYER CARD (Position 1) ──
        if (lineup.length >= 2) {
            const nx = lineup[1];
            const rNx = getMemberReadiness(nx.id);

            html += `
            <div class="sv-tier-card sv-next-card" draggable="true" data-idx="1">
                <div class="sv-tier-header">
                    <div class="sv-tier-tag next-tag">NEXT</div>
                </div>
                <div class="sv-tier-body">
                    <div class="sv-player-row">
                        <span class="sv-pos-num sv-pos-next" data-action="prompt-move" data-idx="1" title="Click to jump position">2</span>
                        <div class="sv-player-meta">
                            <div class="sv-player-name-row">
                                <span class="sv-player-name">${esc(nx.name)}</span>
                                ${nx.hit ? '<span class="sv-hit-tag">✓ HIT</span>' : ''}
                            </div>
                            <div class="sv-readiness-row ${rNx.cls}">
                                <span class="sv-mini-dot" style="background:${rNx.dotColor};"></span>
                                <span class="sv-readiness-txt">${rNx.statusText}</span>
                            </div>
                        </div>
                    </div>
                    <div class="sv-tier-actions">
                        <div class="sv-actions-primary">
                            <button class="sv-btn sv-btn-xs sv-btn-promote" data-action="make-current" data-idx="1" title="Promote immediately to Currently Up">▲ Make Up</button>
                            <button class="sv-btn sv-btn-xs" data-action="swap-top" title="Swap with Currently Up">⇄ Swap Up</button>
                            ${lineup.length > 2 ? `<button class="sv-btn sv-btn-xs" data-action="move" data-from="1" data-to="2" title="Move down 1">▼ Down</button>` : ''}
                        </div>
                        <div class="sv-actions-secondary">
                            <button class="sv-btn sv-btn-xs sv-btn-skip" data-action="skip" data-idx="1" title="Skip this player">Skip</button>
                            <button class="sv-btn sv-btn-xs sv-btn-rm" data-action="remove" data-idx="1" title="Remove from lineup">✕</button>
                        </div>
                    </div>
                </div>
            </div>`;
        }

        // ── 3. QUEUE ROWS (Position 2+) ──
        if (lineup.length > 2) {
            html += `<div class="sv-queue-header">Queue (${lineup.length - 2})</div>`;
            for (let i = 2; i < lineup.length; i++) {
                const m = lineup[i];
                const rM = getMemberReadiness(m.id);

                html += `
                <div class="sv-queue-row" draggable="true" data-idx="${i}">
                    <span class="sv-q-pos" data-action="prompt-move" data-idx="${i}" title="Click to jump position">${i + 1}</span>
                    <div class="sv-q-meta">
                        <div class="sv-q-name-row">
                            <span class="sv-q-name">${esc(m.name)}</span>
                            ${m.hit ? '<span class="sv-hit-tag-sm">✓</span>' : ''}
                        </div>
                        <div class="sv-q-readiness ${rM.cls}">
                            <span class="sv-mini-dot" style="background:${rM.dotColor};"></span>
                            <span class="sv-q-readiness-txt">${rM.shortText}</span>
                        </div>
                    </div>
                    <div class="sv-q-actions">
                        <button class="sv-btn sv-btn-xs" data-action="make-current" data-idx="${i}" title="Promote to Currently Up">▲▲</button>
                        <button class="sv-btn sv-btn-xs" data-action="move" data-from="${i}" data-to="${i-1}" title="Move up 1">▲</button>
                        <button class="sv-btn sv-btn-xs" data-action="move" data-from="${i}" data-to="${Math.min(lineup.length-1, i+1)}" title="Move down 1">▼</button>
                        <button class="sv-btn sv-btn-xs sv-btn-skip" data-action="skip" data-idx="${i}" title="Skip">Skip</button>
                        <button class="sv-btn sv-btn-xs sv-btn-rm" data-action="remove" data-idx="${i}" title="Remove">✕</button>
                    </div>
                </div>`;
            }
        }

        container.innerHTML = html;
        renderChainBar();
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER: SEARCH SUGGESTIONS WITH LIVE READINESS
    // ══════════════════════════════════════════════════════════════
    function renderSuggest() {
        const box = document.getElementById('sv-suggest');
        if (!box || box.style.display === 'none') return;

        const val = searchQuery.toLowerCase().trim();
        const available = factionMembers.filter(m =>
            !lineup.some(lm => (lm.id && lm.id === m.id) || lm.name.toLowerCase() === m.name.toLowerCase())
        );

        let matches = [];
        if (!val) {
            // Default top suggestions: ready members first
            matches = available.slice(0, 15);
        } else {
            const sw = [], has = [];
            for (const m of available) {
                const l = m.name.toLowerCase();
                if (l.startsWith(val)) sw.push(m);
                else if (l.includes(val)) has.push(m);
            }
            matches = [...sw, ...has].slice(0, 20);
        }

        if (!matches.length) {
            box.innerHTML = `<div style="padding:8px 12px;color:#6e7681;font-size:11px;font-style:italic;">No matching members found</div>`;
            return;
        }

        box.innerHTML = `<div class="sv-suggest-hdr">Faction Members (${matches.length})</div>` +
            matches.map((m, idx) => {
                const r = getMemberReadiness(m.id);
                let nameHtml = esc(m.name);
                if (val) {
                    nameHtml = nameHtml.replace(new RegExp(`(${escRe(val)})`, 'gi'), '<mark class="sv-mark">$1</mark>');
                }

                return `
                <div class="sv-suggest-item ${idx === suggestSelected ? 'sv-suggest-sel' : ''}"
                    data-action="add-suggest" data-name="${escAttr(m.name)}" data-id="${m.id}" data-sidx="${idx}">
                    <div class="sv-suggest-info">
                        <span class="sv-suggest-name">${nameHtml}</span>
                        <span class="sv-suggest-status ${r.cls}">
                            <span class="sv-mini-dot" style="background:${r.dotColor};"></span>
                            ${r.statusText}
                        </span>
                    </div>
                    <span class="sv-suggest-add-badge">+ Add</span>
                </div>`;
            }).join('');
    }

    function addFromInput() {
        const inp = document.getElementById('sv-add-input');
        if (!inp) return;
        const val = inp.value.trim();
        if (!val) return;

        const box = document.getElementById('sv-suggest');
        const items = box ? box.querySelectorAll('.sv-suggest-item') : [];
        if (items.length && suggestSelected >= 0 && items[suggestSelected]) {
            const name = items[suggestSelected].dataset.name;
            const id = parseInt(items[suggestSelected].dataset.id, 10) || null;
            addMember(name, id);
        } else {
            const match = factionMembers.find(m => m.name.toLowerCase() === val.toLowerCase()) ||
                          factionMembers.find(m => m.name.toLowerCase().startsWith(val.toLowerCase()));
            addMember(match ? match.name : val, match ? match.id : null);
        }

        inp.value = '';
        if (box) box.style.display = 'none';
        suggestSelected = -1;
        searchQuery = '';
    }

    function addFromSuggest(name, id) {
        addMember(name, id);
        const inp = document.getElementById('sv-add-input');
        if (inp) { inp.value = ''; inp.focus(); }
        const box = document.getElementById('sv-suggest');
        if (box) box.style.display = 'none';
        suggestSelected = -1;
        searchQuery = '';
    }

    // ══════════════════════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════════════════════
    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function escAttr(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/"/g,'&quot;').replace(/'/g,"&#39;"); }
    function escRe(s) { return s.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&'); }

    // ══════════════════════════════════════════════════════════════
    //  BUILD HUD DOM
    // ══════════════════════════════════════════════════════════════
    function buildHUD() {
        const savedPos = GM_getValue(LS_KEY_POS, { top: 80, right: 20 });
        const hud = document.createElement('div');
        hud.id = 'sv-chain-hud';
        if (isMinimized) hud.classList.add('sv-minimized');
        hud.style.top   = `${savedPos.top}px`;
        hud.style.right = `${savedPos.right}px`;

        hud.innerHTML = `
        <!-- HEADER -->
        <div class="sv-header" id="sv-handle">
            <div class="sv-title">
                <span class="sv-status-pill sv-same" id="sv-status-pill" title="Grey: Lineup unchanged | Green: Lineup updated">
                    <span class="sv-dot sv-dot-grey" id="sv-status-dot"></span>
                    <span id="sv-status-txt">SAME</span>
                </span>
                <span class="sv-title-text">⛓ Chain Manager</span>
                <span class="sv-min-up" id="sv-min-up">${lineup.length ? 'UP: ' + esc(lineup[0].name) : 'No lineup'}</span>
            </div>
            <div class="sv-hdr-controls">
                <button class="sv-min-post-btn" id="sv-min-post-btn" title="Post Lineup to Faction Chat">📋 Post</button>
                <button class="sv-ctrl-btn" id="sv-min-btn" title="Minimize / Expand overlay">${isMinimized ? '□' : '─'}</button>
                <button class="sv-ctrl-btn" id="sv-close-btn" title="Close overlay">✕</button>
            </div>
        </div>

        <!-- BODY -->
        <div class="sv-body" id="sv-body">

            <!-- 1. TOP CHAIN STATUS BAR -->
            <div id="sv-chain-bar" class="sv-chain-bar"></div>

            <!-- 2. CONTROLS ROW 1: INTERVAL & POST -->
            <div class="sv-controls-row">
                <div class="sv-hit-time-row" title="Target chain timer threshold to hit">
                    <span class="sv-ctrl-label">Hit at:</span>
                    <select id="sv-hit-time-sel" class="sv-select">
                        <option value="">None</option>
                        <option value="3:30">3:30</option>
                        <option value="3:00">3:00</option>
                        <option value="2:30">2:30</option>
                        <option value="2:00">2:00</option>
                        <option value="1:30">1:30</option>
                        <option value="1:00">1:00</option>
                        <option value="custom">Custom…</option>
                    </select>
                    <input id="sv-hit-time-custom" class="sv-input-sm" type="text" placeholder="2:15" style="display:none;width:44px;" />
                </div>
                <button class="sv-btn sv-btn-green sv-btn-glow" id="sv-post-btn" title="Insert formatted lineup into Faction Chat">📋 Post Chat</button>
                <button class="sv-btn" id="sv-copy-btn" title="Copy full vertical lineup">Copy</button>
                <button class="sv-btn" id="sv-copy-compact-btn" title="Copy compact single-line lineup">Compact</button>
            </div>

            <!-- 3. CONTROLS ROW 2: ADVANCE & MODES -->
            <div class="sv-controls-row sv-controls-row2">
                <button class="sv-btn" id="sv-next-btn" title="Advance currently up player to bottom of queue">Next ▶</button>
                <button class="sv-btn" id="sv-reset-btn" title="Clear all hit marks for a new cycle">Reset Hits</button>
                <button class="sv-btn sv-btn-danger" id="sv-clear-btn" title="Remove all members from the lineup">Clear All</button>
                <label class="sv-toggle-lbl" title="Loop: players rotate to bottom of queue when they hit">
                    <input type="checkbox" id="sv-loop-chk" ${loopMode ? 'checked' : ''} />
                    Loop
                </label>
                <label class="sv-toggle-lbl" title="Auto: automatically advances when a hit from the player UP is detected">
                    <input type="checkbox" id="sv-auto-chk" ${autoMode ? 'checked' : ''} />
                    Auto
                </label>
            </div>

            <!-- 4. STATUS FEEDBACK BAR -->
            <div class="sv-status-bar"><span id="sv-status-msg"></span></div>

            <!-- 5. LINEUP CARDS CONTAINER -->
            <div id="sv-lineup-container"></div>

            <!-- 6. ADD MEMBER SEARCH ROW -->
            <div class="sv-add-row" style="position:relative;">
                <input id="sv-add-input" class="sv-add-input" placeholder="Type to search faction members…" autocomplete="off" />
                <button class="sv-add-btn" id="sv-add-btn" title="Add member to lineup">+ Add</button>
                <div id="sv-suggest" class="sv-suggest" style="display:none;"></div>
            </div>

            <!-- 7. BOTTOM ACTION CONTROLS -->
            <div class="sv-quick-row">
                <button class="sv-btn sv-btn-primary" id="sv-autofill-btn" title="Intelligently prioritize active, ready faction members into the lineup">⚡ Auto-Fill Ready</button>
                <button class="sv-btn" id="sv-refresh-btn" title="Refresh member readiness from Torn API">↻ Refresh</button>
                <div style="flex:1;"></div>
                <button class="sv-btn sv-btn-muted" id="sv-key-toggle-btn" title="Configure or update Torn API Key">⚙ Settings / Key</button>
            </div>

            <!-- 8. API KEY SETUP ROW (COLLAPSIBLE) -->
            <div id="sv-apikey-row" class="sv-apikey-row" style="${apiKey ? 'display:none;' : ''}">
                <div style="width:100%;font-size:10px;color:#e3b341;font-weight:700;">🔑 Torn API Key (Faction / Minimal)</div>
                <input id="sv-apikey-input" class="sv-input-sm" type="password" placeholder="Paste your Torn API key here…" value="${escAttr(apiKey)}" style="flex:1;min-width:0;" />
                <button class="sv-btn sv-btn-green" id="sv-apikey-save-btn">Save Key</button>
            </div>

        </div>
        `;

        document.body.appendChild(hud);
        _syncHitTimeUI();
        renderLineup();
        renderChainBar();
        return hud;
    }

    function _syncHitTimeUI() {
        const sel = document.getElementById('sv-hit-time-sel');
        const custom = document.getElementById('sv-hit-time-custom');
        if (!sel) return;
        const known = ['', '3:30', '3:00', '2:30', '2:00', '1:30', '1:00'];
        if (known.includes(targetHitTime)) {
            sel.value = targetHitTime;
            if (custom) custom.style.display = 'none';
        } else if (targetHitTime) {
            sel.value = 'custom';
            if (custom) { custom.style.display = 'inline-block'; custom.value = targetHitTime; }
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  EVENT LISTENERS & DELEGATION
    // ══════════════════════════════════════════════════════════════
    function wireEvents(hud) {
        // Dragging HUD handle
        const handle = document.getElementById('sv-handle');
        let dragging = false, sx = 0, sy = 0, il = 0, it = 0;

        handle.addEventListener('mousedown', e => {
            if (e.target.closest('.sv-hdr-controls')) return;
            dragging = true;
            sx = e.clientX; sy = e.clientY;
            const r = hud.getBoundingClientRect();
            il = r.left; it = r.top;
            hud.style.right = 'auto';
            hud.style.left  = `${il}px`;
            hud.style.top   = `${it}px`;
            document.body.style.userSelect = 'none';
        });

        window.addEventListener('mousemove', e => {
            if (!dragging) return;
            const nl = Math.max(8, Math.min(window.innerWidth  - hud.offsetWidth  - 8, il + (e.clientX - sx)));
            const nt = Math.max(8, Math.min(window.innerHeight - hud.offsetHeight - 8, it + (e.clientY - sy)));
            hud.style.left = `${nl}px`;
            hud.style.top  = `${nt}px`;
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.userSelect = '';
            const r = hud.getBoundingClientRect();
            GM_setValue(LS_KEY_POS, { top: Math.round(r.top), right: Math.round(window.innerWidth - r.right) });
        });

        // Header minimize & close buttons
        document.getElementById('sv-min-btn').addEventListener('click', () => {
            isMinimized = !isMinimized;
            hud.classList.toggle('sv-minimized', isMinimized);
            document.getElementById('sv-min-btn').textContent = isMinimized ? '□' : '─';
            updateMinDisplay();
            GM_setValue('sv_min', isMinimized);
        });

        document.getElementById('sv-close-btn').addEventListener('click', () => {
            hud.style.display = 'none';
        });

        document.getElementById('sv-post-btn').addEventListener('click', postToChat);
        document.getElementById('sv-min-post-btn').addEventListener('click', postToChat);

        // Copy buttons
        document.getElementById('sv-copy-btn').addEventListener('click', () => copyToClipboard('full'));
        document.getElementById('sv-copy-compact-btn').addEventListener('click', () => copyToClipboard('compact'));

        // Control buttons
        document.getElementById('sv-next-btn').addEventListener('click', nextTurn);
        document.getElementById('sv-reset-btn').addEventListener('click', resetHits);
        document.getElementById('sv-clear-btn').addEventListener('click', clearAll);

        // Checkboxes
        document.getElementById('sv-loop-chk').addEventListener('change', e => {
            loopMode = e.target.checked;
            save();
        });

        document.getElementById('sv-auto-chk').addEventListener('change', e => {
            autoMode = e.target.checked;
            if (!autoMode) clearAutoSkip();
            else startAutoSkip();
            save();
            renderLineup();
        });

        // Hit time dropdown & custom
        const hitSel = document.getElementById('sv-hit-time-sel');
        const customInp = document.getElementById('sv-hit-time-custom');
        hitSel.addEventListener('change', () => {
            if (hitSel.value === 'custom') {
                customInp.style.display = 'inline-block';
                customInp.focus();
            } else {
                customInp.style.display = 'none';
                targetHitTime = hitSel.value;
                save();
                renderLineup();
                renderChainBar();
            }
        });
        customInp.addEventListener('change', () => {
            targetHitTime = customInp.value.trim();
            save();
            renderLineup();
            renderChainBar();
        });

        // Quick actions
        document.getElementById('sv-autofill-btn').addEventListener('click', autoFill);
        document.getElementById('sv-refresh-btn').addEventListener('click', () => {
            if (!apiKey) { flashStatus('Enter an API key first.', true); return; }
            flashStatus('Refreshing member list from Torn…', false);
            fetchFactionMembers();
        });

        // Toggle API key row
        document.getElementById('sv-key-toggle-btn').addEventListener('click', () => {
            const row = document.getElementById('sv-apikey-row');
            if (!row) return;
            const isHidden = row.style.display === 'none';
            row.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) {
                const inp = document.getElementById('sv-apikey-input');
                if (inp) inp.focus();
            }
        });

        // Save API key
        const saveKeyBtn = document.getElementById('sv-apikey-save-btn');
        if (saveKeyBtn) saveKeyBtn.addEventListener('click', saveApiKey);

        const apiKeyInput = document.getElementById('sv-apikey-input');
        if (apiKeyInput) {
            apiKeyInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') saveApiKey();
            });
        }

        // Add Member search input & button
        const addInp = document.getElementById('sv-add-input');
        const addBtn = document.getElementById('sv-add-btn');
        const suggestBox = document.getElementById('sv-suggest');

        addBtn.addEventListener('click', addFromInput);

        addInp.addEventListener('focus', () => {
            suggestBox.style.display = 'block';
            if (!factionMembers.length && apiKey) fetchFactionMembers();
            renderSuggest();
        });

        addInp.addEventListener('input', e => {
            searchQuery = e.target.value;
            suggestSelected = -1;
            suggestBox.style.display = 'block';
            if (!factionMembers.length && apiKey) fetchFactionMembers();
            renderSuggest();
        });

        addInp.addEventListener('keydown', e => {
            const items = suggestBox ? suggestBox.querySelectorAll('.sv-suggest-item') : [];
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                suggestSelected = Math.min(suggestSelected + 1, items.length - 1);
                renderSuggest();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                suggestSelected = Math.max(suggestSelected - 1, -1);
                renderSuggest();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (suggestSelected >= 0 && items[suggestSelected]) {
                    const name = items[suggestSelected].dataset.name;
                    const id = parseInt(items[suggestSelected].dataset.id, 10) || null;
                    addFromSuggest(name, id);
                } else {
                    addFromInput();
                }
            } else if (e.key === 'Escape') {
                suggestBox.style.display = 'none';
            }
        });

        // Close suggestions on outside click
        document.addEventListener('click', e => {
            if (!e.target.closest('.sv-add-row')) {
                if (suggestBox) suggestBox.style.display = 'none';
            }
        });

        // ── EVENT DELEGATION for Lineup Card Buttons & Suggest items ──
        hud.addEventListener('click', e => {
            // Suggestion click
            const suggestItem = e.target.closest('[data-action="add-suggest"]');
            if (suggestItem) {
                const name = suggestItem.dataset.name;
                const id = parseInt(suggestItem.dataset.id, 10) || null;
                addFromSuggest(name, id);
                return;
            }

            // Card / Queue action buttons
            const actBtn = e.target.closest('[data-action]');
            if (!actBtn) return;

            const action = actBtn.dataset.action;
            const idx    = parseInt(actBtn.dataset.idx, 10);
            const from   = parseInt(actBtn.dataset.from, 10);
            const to     = parseInt(actBtn.dataset.to, 10);

            if (action === 'skip' && !isNaN(idx)) {
                skipMember(idx);
            } else if (action === 'remove' && !isNaN(idx)) {
                removeMember(idx);
            } else if (action === 'swap-top') {
                swapTopTwo();
            } else if (action === 'make-current' && !isNaN(idx)) {
                makeCurrent(idx);
            } else if (action === 'move' && !isNaN(from) && !isNaN(to)) {
                moveMember(from, to);
            } else if (action === 'prompt-move' && !isNaN(idx)) {
                promptMove(idx);
            }
        });

        // ── DRAG AND DROP REORDERING DELEGATION ──
        hud.addEventListener('dragstart', e => {
            const card = e.target.closest('[data-idx]');
            if (card) {
                e.dataTransfer.setData('text/plain', card.dataset.idx);
                card.classList.add('sv-dragging');
            }
        });

        hud.addEventListener('dragend', e => {
            const card = e.target.closest('[data-idx]');
            if (card) card.classList.remove('sv-dragging');
        });

        hud.addEventListener('dragover', e => {
            const card = e.target.closest('[data-idx]');
            if (card) {
                e.preventDefault();
                card.classList.add('sv-drag-over');
            }
        });

        hud.addEventListener('dragleave', e => {
            const card = e.target.closest('[data-idx]');
            if (card) card.classList.remove('sv-drag-over');
        });

        hud.addEventListener('drop', e => {
            const card = e.target.closest('[data-idx]');
            if (card) {
                e.preventDefault();
                card.classList.remove('sv-drag-over');
                const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
                const toIdx   = parseInt(card.dataset.idx, 10);
                if (!isNaN(fromIdx) && !isNaN(toIdx) && fromIdx !== toIdx) {
                    moveMember(fromIdx, toIdx);
                }
            }
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  PROFESSIONAL DARK TORN-COMPATIBLE CSS
    // ══════════════════════════════════════════════════════════════
    const css = `
    #sv-chain-hud {
        position: fixed;
        z-index: 99999999;
        width: 350px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        background: rgba(13, 17, 23, 0.98);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(48, 54, 61, 0.85);
        border-radius: 10px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75), 0 0 1px rgba(255, 255, 255, 0.1);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 11px;
        color: #c9d1d9;
        user-select: none;
        overflow: hidden;
        transition: border-color 0.25s, box-shadow 0.25s;
    }
    #sv-chain-hud.sv-minimized { width: auto; max-width: 480px; border-radius: 20px; max-height: none; }
    #sv-chain-hud.sv-minimized .sv-body { display: none; }
    #sv-chain-hud.sv-minimized .sv-header { border-radius: 20px; border-bottom: none; padding: 5px 12px; }
    #sv-chain-hud.sv-minimized .sv-title-text { display: none; }
    #sv-chain-hud.sv-minimized .sv-min-up { display: inline-block; font-size: 11px; font-weight: 800; color: #f0f6fc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
    #sv-chain-hud.sv-minimized .sv-min-post-btn { display: inline-flex; }

    /* Header */
    .sv-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        background: rgba(22, 27, 34, 0.95);
        border-bottom: 1px solid rgba(48, 54, 61, 0.8);
        cursor: move;
        flex-shrink: 0;
        gap: 8px;
    }
    .sv-title { display: flex; align-items: center; gap: 6px; overflow: hidden; }
    .sv-title-text { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #f0f6fc; white-space: nowrap; }
    .sv-min-up { display: none; }
    .sv-hdr-controls { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

    .sv-status-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: 800; letter-spacing: 0.5px; cursor: default; transition: all 0.2s; }
    .sv-updated { background: rgba(46, 204, 113, 0.16); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.4); }
    .sv-same    { background: rgba(110, 118, 129, 0.15); color: #8b949e; border: 1px solid rgba(110, 118, 129, 0.3); }
    .sv-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; transition: all 0.2s; }
    .sv-dot-green { background: #2ecc71; box-shadow: 0 0 6px #2ecc71; animation: svDotPulse 1.3s infinite; }
    .sv-dot-grey  { background: #8b949e; box-shadow: none; animation: none; }
    @keyframes svDotPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.25);opacity:.7} }

    .sv-min-post-btn {
        display: none; background: linear-gradient(135deg, #238636, #2ea043); color: #fff;
        border: none; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700;
        cursor: pointer; gap: 4px; align-items: center; white-space: nowrap; transition: all 0.15s;
    }
    .sv-min-post-btn:hover { background: #2ea043; }

    .sv-ctrl-btn { background: transparent; border: none; color: #8b949e; cursor: pointer; padding: 2px 4px; font-size: 11px; border-radius: 4px; }
    .sv-ctrl-btn:hover { color: #f0f6fc; background: rgba(255, 255, 255, 0.08); }

    .sv-body { overflow-y: auto; flex: 1; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.1) transparent; }
    .sv-body::-webkit-scrollbar { width: 4px; }
    .sv-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 2px; }

    /* 1. Top Chain Status Area (Clear Hierarchy) */
    .sv-chain-bar { padding: 8px 10px; background: rgba(18, 22, 29, 0.8); border-bottom: 1px solid rgba(48, 54, 61, 0.6); }
    .sv-stat-grid { display: grid; grid-template-columns: 1.35fr 1fr 1.15fr 0.9fr; gap: 6px; align-items: stretch; }
    .sv-stat-box {
        background: rgba(22, 27, 34, 0.7); border: 1px solid rgba(48, 54, 61, 0.6);
        border-radius: 6px; padding: 4px 6px; display: flex; flex-direction: column;
        justify-content: center; align-items: center; text-align: center;
        transition: all 0.2s ease;
    }
    .sv-stat-num { font-size: 14px; font-weight: 800; color: #f0f6fc; line-height: 1.1; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .sv-stat-lbl { font-size: 8.5px; font-weight: 700; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; line-height: 1; }
    
    /* Timer Primary Visual Importance */
    .sv-stat-timer { background: rgba(13, 17, 23, 0.85); border-color: rgba(56, 139, 253, 0.3); }
    .sv-timer-num { font-size: 21px; font-weight: 900; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; letter-spacing: 0.5px; }
    .sv-timer-danger { border-color: rgba(248, 81, 73, 0.55); background: rgba(248, 81, 73, 0.08); animation: svTimerPulse 0.9s infinite; }
    @keyframes svTimerPulse { 0%,100%{box-shadow:inset 0 0 8px rgba(248, 81, 73, 0.2)} 50%{box-shadow:inset 0 0 16px rgba(248, 81, 73, 0.45)} }

    .sv-stat-target { border-color: rgba(48, 54, 61, 0.7); }
    .sv-box-hit-now { background: rgba(46, 204, 113, 0.12); border-color: rgba(46, 204, 113, 0.5); }
    .sv-hit-now-txt { color: #2ecc71 !important; font-weight: 900; animation: svGlowText 1s infinite; }
    @keyframes svGlowText { 0%,100%{text-shadow:0 0 4px #2ecc71} 50%{text-shadow:0 0 10px #2ecc71} }
    .sv-meta-num { font-size: 11px; font-weight: 700; color: #8b949e; }

    /* Controls Rows */
    .sv-controls-row { display: flex; align-items: center; gap: 4px; padding: 6px 10px; flex-wrap: wrap; }
    .sv-controls-row2 { padding-top: 0; padding-bottom: 5px; border-bottom: 1px solid rgba(48, 54, 61, 0.5); }
    .sv-hit-time-row { display: flex; align-items: center; gap: 4px; }
    .sv-ctrl-label { font-size: 10px; color: #8b949e; font-weight: 600; white-space: nowrap; }

    .sv-btn {
        background: rgba(33, 38, 45, 0.85); border: 1px solid rgba(48, 54, 61, 0.85); color: #c9d1d9;
        padding: 3px 7px; border-radius: 4px; font-size: 10.5px; font-weight: 700; cursor: pointer;
        transition: all 0.12s; white-space: nowrap; line-height: 1.2;
    }
    .sv-btn:hover { background: rgba(48, 54, 61, 0.9); color: #f0f6fc; }
    .sv-btn-green { background: rgba(35, 134, 54, 0.25); border-color: rgba(46, 204, 113, 0.45); color: #2ecc71; }
    .sv-btn-green:hover { background: rgba(35, 134, 54, 0.4); color: #3ee083; }
    .sv-btn-glow { box-shadow: 0 0 6px rgba(46, 204, 113, 0.2); }
    .sv-btn-danger { background: rgba(218, 54, 51, 0.15); border-color: rgba(248, 81, 73, 0.35); color: #f85149; }
    .sv-btn-danger:hover { background: rgba(218, 54, 51, 0.28); }
    .sv-btn-skip { background: rgba(227, 179, 65, 0.12); border-color: rgba(227, 179, 65, 0.35); color: #e3b341; }
    .sv-btn-skip:hover { background: rgba(227, 179, 65, 0.22); }
    .sv-btn-rm { background: rgba(218, 54, 51, 0.1); border-color: rgba(248, 81, 73, 0.25); color: #f85149; padding: 2px 5px; }
    .sv-btn-rm:hover { background: rgba(218, 54, 51, 0.25); }
    .sv-btn-primary { background: rgba(56, 139, 253, 0.18); border-color: rgba(56, 139, 253, 0.4); color: #58a6ff; }
    .sv-btn-primary:hover { background: rgba(56, 139, 253, 0.3); color: #79c0ff; }
    .sv-btn-promote { background: rgba(56, 139, 253, 0.16); border-color: rgba(56, 139, 253, 0.4); color: #58a6ff; }
    .sv-btn-promote:hover { background: rgba(56, 139, 253, 0.28); color: #fff; }
    .sv-btn-muted { color: #8b949e; font-weight: 600; }
    .sv-btn-muted:hover { color: #c9d1d9; }
    .sv-btn-xs { font-size: 9.5px; padding: 2px 5px; }

    .sv-select, .sv-input-sm {
        background: #161b22; border: 1px solid rgba(48, 54, 61, 0.9); color: #c9d1d9;
        padding: 2px 5px; border-radius: 4px; font-size: 10.5px; outline: none;
    }
    .sv-select option { background: #0d1117; color: #c9d1d9; }

    .sv-toggle-lbl { display: flex; align-items: center; gap: 3px; font-size: 10px; color: #8b949e; cursor: pointer; font-weight: 600; }
    .sv-toggle-lbl input { cursor: pointer; margin: 0; accent-color: #2ecc71; }

    .sv-status-bar { padding: 2px 10px; min-height: 16px; font-size: 10.5px; }

    /* Lineup Summary Strip */
    .sv-lineup-summary {
        display: flex; gap: 4px; padding: 4px 10px 6px; overflow-x: auto;
        border-bottom: 1px solid rgba(48, 54, 61, 0.3); margin-bottom: 4px;
    }
    .sv-summary-chip {
        display: inline-flex; align-items: center; gap: 4px; padding: 1px 5px;
        background: rgba(22, 27, 34, 0.7); border: 1px solid rgba(48, 54, 61, 0.5);
        border-radius: 4px; font-size: 9px; font-weight: 700; color: #8b949e; white-space: nowrap;
    }
    .sv-summary-chip b { color: #f0f6fc; }
    .sv-mini-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .sv-dot-green { background: #2ecc71; }
    .sv-dot-blue  { background: #58a6ff; }
    .sv-dot-amber { background: #e3b341; }
    .sv-dot-red   { background: #f85149; }
    .sv-dot-gray  { background: #718096; }

    /* Tier Cards (Currently Up & Next) */
    .sv-tier-card {
        margin: 4px 10px; border-radius: 6px; border: 1px solid rgba(48, 54, 61, 0.8);
        background: rgba(22, 27, 34, 0.85); overflow: hidden;
        transition: border-color 0.2s; cursor: grab;
    }
    .sv-up-card { background: rgba(35, 134, 54, 0.08); border-color: rgba(46, 204, 113, 0.45); }
    .sv-next-card { background: rgba(56, 139, 253, 0.06); border-color: rgba(56, 139, 253, 0.35); }
    .sv-tier-card.sv-drag-over { border-color: #2ecc71; box-shadow: 0 0 0 1px rgba(46, 204, 113, 0.4); }
    .sv-tier-card.sv-dragging { opacity: 0.5; }

    .sv-tier-header { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 2px; }
    .sv-tier-tag { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
    .up-tag { color: #2ecc71; }
    .next-tag { color: #58a6ff; }
    .sv-autoskip-txt { font-size: 9px; color: #e3b341; font-weight: 700; }

    .sv-tier-body { padding: 4px 8px 6px; }
    .sv-player-row { display: flex; align-items: center; gap: 8px; }
    .sv-pos-num {
        display: inline-flex; align-items: center; justify-content: center;
        width: 18px; height: 18px; border-radius: 50%; font-size: 9.5px;
        font-weight: 800; color: #8b949e; background: rgba(255, 255, 255, 0.06);
        flex-shrink: 0; cursor: pointer;
    }
    .sv-pos-up { background: rgba(46, 204, 113, 0.18); color: #2ecc71; }
    .sv-pos-next { background: rgba(56, 139, 253, 0.15); color: #58a6ff; }
    .sv-pos-num:hover { transform: scale(1.1); }

    .sv-player-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .sv-player-name-row { display: flex; align-items: center; gap: 5px; }
    .sv-player-name { font-size: 13px; font-weight: 800; color: #f0f6fc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-hit-tag { font-size: 9px; font-weight: 800; color: #2ecc71; background: rgba(46, 204, 113, 0.15); padding: 1px 4px; border-radius: 3px; }
    .sv-hit-tag-sm { font-size: 9px; font-weight: 800; color: #2ecc71; }

    .sv-readiness-row { display: flex; align-items: center; gap: 4px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.3px; }
    .st-ready   { color: #2ecc71; }
    .st-idle    { color: #e3b341; }
    .st-offline { color: #8b949e; }
    .st-hosp    { color: #f85149; }
    .st-travel  { color: #58a6ff; }
    .st-jail    { color: #f85149; }
    .sv-readiness-txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .sv-hit-now-badge {
        font-size: 9.5px; font-weight: 800; padding: 2px 6px; border-radius: 4px;
        background: rgba(46, 204, 113, 0.22); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.5);
        animation: svGlowText 1s infinite; white-space: nowrap;
    }

    .sv-tier-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; gap: 4px; }
    .sv-actions-primary { display: flex; gap: 3px; flex-wrap: wrap; }
    .sv-actions-secondary { display: flex; gap: 3px; flex-shrink: 0; }

    /* Queue Header & Rows */
    .sv-queue-header { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #8b949e; padding: 6px 10px 2px; }
    .sv-queue-row {
        display: flex; align-items: center; gap: 6px; padding: 4px 10px;
        border-bottom: 1px solid rgba(48, 54, 61, 0.35); cursor: grab;
        transition: background 0.1s;
    }
    .sv-queue-row:hover { background: rgba(255, 255, 255, 0.025); }
    .sv-queue-row.sv-drag-over { background: rgba(46, 204, 113, 0.08); border-color: rgba(46, 204, 113, 0.4); }
    .sv-queue-row.sv-dragging { opacity: 0.4; }
    .sv-q-pos {
        display: inline-flex; align-items: center; justify-content: center;
        width: 16px; height: 16px; border-radius: 50%; background: rgba(255, 255, 255, 0.05);
        font-size: 9px; font-weight: 800; color: #8b949e; flex-shrink: 0; cursor: pointer;
    }
    .sv-q-pos:hover { background: rgba(46, 204, 113, 0.2); color: #2ecc71; }
    .sv-q-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .sv-q-name-row { display: flex; align-items: center; gap: 4px; }
    .sv-q-name { font-size: 11.5px; font-weight: 700; color: #c9d1d9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-q-readiness { display: flex; align-items: center; gap: 3px; font-size: 8.5px; font-weight: 700; }
    .sv-q-readiness-txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-q-actions { display: flex; gap: 2px; flex-shrink: 0; margin-left: auto; }

    /* Add Member Row */
    .sv-add-row { display: flex; gap: 4px; padding: 6px 10px 4px; align-items: center; }
    .sv-add-input {
        flex: 1; background: #161b22; border: 1px solid rgba(48, 54, 61, 0.9);
        color: #f0f6fc; padding: 4px 8px; border-radius: 4px; font-size: 11px;
        outline: none; min-width: 0;
    }
    .sv-add-input:focus { border-color: rgba(56, 139, 253, 0.6); }
    .sv-add-input::placeholder { color: #6e7681; }
    .sv-add-btn {
        background: rgba(35, 134, 54, 0.2); border: 1px solid rgba(46, 204, 113, 0.4);
        color: #2ecc71; padding: 4px 9px; border-radius: 4px; font-size: 11px;
        font-weight: 800; cursor: pointer; white-space: nowrap;
    }
    .sv-add-btn:hover { background: rgba(35, 134, 54, 0.35); color: #3ee083; }

    /* Search Suggest Dropdown */
    .sv-suggest {
        position: absolute; bottom: calc(100% + 4px); left: 10px; right: 10px;
        background: #0d1117; border: 1px solid rgba(48, 54, 61, 0.9);
        border-radius: 6px; max-height: 220px; overflow-y: auto; z-index: 100000000;
        box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.85);
        scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }
    .sv-suggest::-webkit-scrollbar { width: 4px; }
    .sv-suggest::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 2px; }
    .sv-suggest-hdr { padding: 4px 8px; font-size: 8.5px; font-weight: 800; text-transform: uppercase; color: #8b949e; letter-spacing: 0.5px; border-bottom: 1px solid rgba(48, 54, 61, 0.4); }
    .sv-suggest-item {
        display: flex; align-items: center; justify-content: space-between;
        padding: 5px 8px; cursor: pointer; border-bottom: 1px solid rgba(48, 54, 61, 0.2);
        transition: background 0.1s;
    }
    .sv-suggest-item:hover, .sv-suggest-sel { background: rgba(56, 139, 253, 0.15); }
    .sv-suggest-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .sv-suggest-name { font-size: 11.5px; font-weight: 700; color: #f0f6fc; }
    .sv-suggest-status { display: flex; align-items: center; gap: 3px; font-size: 9px; font-weight: 700; }
    .sv-suggest-add-badge { font-size: 9px; font-weight: 700; color: #2ecc71; padding: 1px 4px; border: 1px solid rgba(46, 204, 113, 0.3); border-radius: 3px; margin-left: 6px; }
    .sv-mark { background: rgba(46, 204, 113, 0.25); color: #2ecc71; border-radius: 2px; padding: 0 1px; }

    /* Bottom Quick Action Row */
    .sv-quick-row { display: flex; gap: 4px; padding: 4px 10px 8px; align-items: center; }

    /* API Key Collapsible Row */
    .sv-apikey-row {
        display: flex; align-items: center; gap: 5px; padding: 6px 10px 8px;
        background: rgba(227, 179, 65, 0.06); border-top: 1px solid rgba(227, 179, 65, 0.2);
        flex-wrap: wrap;
    }
    `;

    if (typeof GM_addStyle === 'function') {
        GM_addStyle(css);
    } else {
        const s = document.createElement('style');
        s.textContent = css;
        document.head.appendChild(s);
    }

    // ══════════════════════════════════════════════════════════════
    //  BOOT
    // ══════════════════════════════════════════════════════════════
    load();
    const hud = buildHUD();
    wireEvents(hud);
    setUpdated(false);
    startLocalTimer();

    if (apiKey) {
        startBackgroundPolling();
    }

    // Seed from Railway server if local queue is empty
    if (!lineup.length) {
        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://torn-company-app-production.up.railway.app/api/chain/lineup',
                timeout: 4000,
                onload(res) {
                    try {
                        const d = JSON.parse(res.responseText);
                        if (d?.ok && d?.data?.lineup?.length && !lineup.length) {
                            lineup = d.data.lineup;
                            targetHitTime = d.data.targetHitTime || '3:00';
                            _syncHitTimeUI();
                            renderLineup();
                        }
                    } catch(e) {}
                },
                onerror() {}
            });
        } catch(e) {}
    }

})();
