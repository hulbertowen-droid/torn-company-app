// ==UserScript==
// @name         Spider-Verse Chain Manager (Standalone)
// @namespace    https://torn-company-app-production.up.railway.app/
// @version      2.0.1
// @description  Fully standalone chain lineup manager on Torn. Direct API hits, faction member search, auto-advance on hits, 1-click faction chat posting. No external server needed.
// @author       Spider-Verse
// @match        https://www.torn.com/*
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
    //  CONSTANTS & STATE
    // ══════════════════════════════════════════════════════════════
    const LS_KEY_POS      = 'sv_chain_mgr_pos';
    const LS_KEY_APIKEY   = 'sv_chain_apikey';
    const LS_KEY_MEMBERS  = 'sv_chain_members_cache';
    const HIT_POLL_MS     = 1500;
    const STATUS_POLL_MS  = 60000;
    const CHAIN_POLL_MS   = 2000;

    let apiKey         = GM_getValue('sv_apikey', '') || localStorage.getItem(LS_KEY_APIKEY) || '';
    let lineup         = [];          // [{name, id, hit, skipped}]
    let targetHitTime  = '3:00';
    let cycleNum       = 1;
    let loopMode       = true;
    let autoMode       = false;
    let chainTimeout   = 0;          // seconds left on timer
    let chainCount     = 0;          // current chain count
    let chainActive    = false;
    let factionMembers = [];         // [{id, name, online, state, lastActionTs}]
    let memberStatuses = {};         // id -> {online, state}
    let processedAtkIds = new Set();
    let lastChainCount  = 0;
    let autoSkipTimer   = null;
    let autoSkipLeft    = 0;
    let isMinimized     = GM_getValue('sv_min', false);
    let searchQuery     = '';
    let suggestSelected = -1;
    let isUpdated       = false;     // green/grey light
    let timerInterval   = null;

    let pollAtkInterval     = null;
    let pollChainInterval   = null;
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
                memberStatuses[String(m.id)] = { online: m.online, state: m.state };
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
    //  TORN API
    // ══════════════════════════════════════════════════════════════
    function tornGet(path, cb) {
        if (!apiKey) return cb(new Error('No API key'), null);
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.torn.com${path}&key=${apiKey}`,
            timeout: 7000,
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
            id: parseInt(id),
            name: m.name,
            online: (m.last_action || {}).status || 'Offline',
            state: (m.status || {}).state || 'Okay',
            lastActionTs: (m.last_action || {}).timestamp || 0
        })).sort((a, b) => a.name.localeCompare(b.name));

        try {
            localStorage.setItem(LS_KEY_MEMBERS, JSON.stringify(factionMembers));
            GM_setValue(LS_KEY_MEMBERS, JSON.stringify(factionMembers));
        } catch(e) {}

        for (const m of factionMembers) {
            memberStatuses[String(m.id)] = { online: m.online, state: m.state };
        }
        renderSuggest();
        renderLineup();
    }

    function fetchChain() {
        tornGet('/faction/?selections=chain', (err, d) => {
            if (err || !d) return;
            const chain = d.chain || {};
            const prev = chainCount;
            chainCount   = chain.current || 0;
            chainTimeout = chain.timeout || 0;
            chainActive  = chainCount > 0;

            if (chainCount > prev && prev > 0) {
                pollAttacks();
            }
            lastChainCount = chainCount;
            renderChainBar();
        });
    }

    function pollAttacks() {
        tornGet('/faction/?selections=attacks', (err, d) => {
            if (err || !d || !d.attacks) return;
            const attacks = Object.values(d.attacks)
                .filter(a => a.chain && a.chain > 0)
                .sort((a, b) => b.timestamp_ended - a.timestamp_ended);

            let stateChanged = false;
            for (const atk of attacks) {
                const id = atk.code || (atk.attacker_id + '_' + atk.timestamp_ended);
                if (processedAtkIds.has(id)) continue;
                processedAtkIds.add(id);
                if (processedAtkIds.size > 400) {
                    const arr = [...processedAtkIds];
                    processedAtkIds = new Set(arr.slice(arr.length - 200));
                }

                const attackerId = String(atk.attacker_id || '');
                if (!attackerId) continue;

                const idx = lineup.findIndex(m => String(m.id) === attackerId || m.name === atk.attacker_name);
                if (idx === -1) continue;

                const [hit] = lineup.splice(idx, 1);
                hit.hit = true;
                lineup.push(hit);
                stateChanged = true;

                clearAutoSkip();
                if (autoMode) startAutoSkip();
            }

            if (stateChanged) {
                cycleNum++;
                setUpdated(true);
                save();
                renderLineup();
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
        if (pollAtkInterval) clearInterval(pollAtkInterval);
        if (pollChainInterval) clearInterval(pollChainInterval);
        if (pollMembersInterval) clearInterval(pollMembersInterval);

        pollAtkInterval = setInterval(pollAttacks, HIT_POLL_MS);
        pollChainInterval = setInterval(fetchChain, CHAIN_POLL_MS);
        pollMembersInterval = setInterval(fetchFactionMembers, STATUS_POLL_MS);
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
                    fetchChain();
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
        flashStatus('Hit marks cleared.', false);
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

    function autoFill() {
        const eligible = factionMembers.filter(m => {
            const st = memberStatuses[String(m.id)];
            return st && st.online === 'Online' && st.state === 'Okay';
        });
        if (!eligible.length) {
            flashStatus('No eligible (Online + Okay) members found.', true);
            return;
        }
        let added = 0;
        for (const m of eligible) {
            if (!lineup.some(lm => lm.name.toLowerCase() === m.name.toLowerCase())) {
                lineup.push({ name: m.name, id: m.id, hit: false, skipped: false });
                added++;
            }
        }
        save();
        renderLineup();
        flashStatus(added > 0 ? `Added ${added} eligible member${added > 1 ? 's' : ''}.` : 'All eligible already in lineup.', false);
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
    //  STATUS LIGHT (UPDATED / SAME)
    // ══════════════════════════════════════════════════════════════
    function setUpdated(val) {
        isUpdated = val;
        const pill   = document.getElementById('sv-status-pill');
        const dot    = document.getElementById('sv-status-dot');
        const txt    = document.getElementById('sv-status-txt');
        const minUp  = document.getElementById('sv-min-up');
        const minBtn = document.getElementById('sv-min-post-btn');
        const mainBtn= document.getElementById('sv-post-btn');

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
        if (minUp) minUp.textContent = lineup.length ? `UP: ${lineup[0].name}` : 'No lineup';
    }

    // ══════════════════════════════════════════════════════════════
    //  STATUS MESSAGE FLASH
    // ══════════════════════════════════════════════════════════════
    let _statusTimer = null;
    function flashStatus(msg, isError) {
        const el = document.getElementById('sv-status-msg');
        if (!el) return;
        el.textContent = msg;
        el.style.color = isError ? '#e74c3c' : '#2ecc71';
        if (_statusTimer) clearTimeout(_statusTimer);
        _statusTimer = setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
    }

    // ══════════════════════════════════════════════════════════════
    //  LOCAL TIMER
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
    //  RENDER: CHAIN BAR
    // ══════════════════════════════════════════════════════════════
    function renderChainBar() {
        const bar = document.getElementById('sv-chain-bar');
        if (!bar) return;

        const timerSecs = chainTimeout;
        const targetSecs = parseTimeToSecs(targetHitTime);
        const inWindow = targetHitTime && timerSecs > 0 && timerSecs <= targetSecs;
        const pct90 = timerSecs > 0 && timerSecs <= 54;

        let timerColor = '#2ecc71';
        if (pct90) timerColor = '#e74c3c';
        else if (timerSecs <= 90) timerColor = '#f39c12';

        bar.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <div style="display:flex;flex-direction:column;align-items:center;">
                    <div style="font-size:22px;font-weight:900;color:${timerColor};font-family:monospace;line-height:1;${pct90 ? 'animation:sv-blink 0.8s infinite;' : ''}">${chainActive ? fmtSecs(timerSecs) : '—'}</div>
                    <div style="font-size:9px;color:#718096;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Timer</div>
                </div>
                <div style="width:1px;height:30px;background:rgba(255,255,255,0.08);"></div>
                <div style="display:flex;flex-direction:column;align-items:center;">
                    <div style="font-size:22px;font-weight:900;color:#e2e8f0;font-family:monospace;line-height:1;">${chainActive ? chainCount.toLocaleString() : '—'}</div>
                    <div style="font-size:9px;color:#718096;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Chain</div>
                </div>
                ${targetHitTime ? `
                <div style="width:1px;height:30px;background:rgba(255,255,255,0.08);"></div>
                <div style="display:flex;flex-direction:column;align-items:center;">
                    <div style="font-size:12px;font-weight:800;color:${inWindow ? '#2ecc71' : '#a0aec0'};${inWindow ? 'animation:sv-glow 1s infinite;' : ''}">${inWindow ? '🎯 HIT NOW' : `Hit at ${targetHitTime}`}</div>
                    <div style="font-size:9px;color:#718096;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Target</div>
                </div>` : ''}
                <div style="margin-left:auto;font-size:9px;color:#4a5568;">Cycle ${cycleNum}</div>
            </div>
        `;
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER: LINEUP
    // ══════════════════════════════════════════════════════════════
    function statusPillHtml(id) {
        const st = memberStatuses[String(id)];
        if (!st) return '';
        const online = st.online;
        const state  = st.state;
        let cls = 'sv-pill-offline', lbl = 'Offline';
        if (state === 'Hospital') { cls = 'sv-pill-hosp'; lbl = 'Hospital'; }
        else if (state === 'Traveling') { cls = 'sv-pill-travel'; lbl = 'Traveling'; }
        else if (online === 'Online' && state === 'Okay') { cls = 'sv-pill-online'; lbl = 'Online'; }
        else if (online === 'Idle') { cls = 'sv-pill-idle'; lbl = 'Idle'; }
        return `<span class="sv-pill ${cls}">${lbl}</span>`;
    }

    function renderLineup() {
        const container = document.getElementById('sv-lineup-container');
        if (!container) return;

        if (!lineup.length) {
            container.innerHTML = `<div style="padding:20px;text-align:center;color:#4a5568;font-style:italic;font-size:12px;">No members in lineup yet — add faction members below.</div>`;
            renderChainBar();
            return;
        }

        const targetSecs = parseTimeToSecs(targetHitTime);
        const inWindow   = targetHitTime && chainTimeout > 0 && chainTimeout <= targetSecs;

        let html = '';

        // CURRENTLY UP (0)
        const up = lineup[0];
        html += `
        <div class="sv-tier-card sv-up-card" draggable="true" data-idx="0">
            <div class="sv-tier-label">
                <span>Currently Up</span>
                ${autoMode ? `<span style="font-size:9px;color:#f39c12;" id="sv-autoskip-cd">${autoSkipLeft > 0 ? `auto-skip in ${autoSkipLeft}s` : ''}</span>` : ''}
            </div>
            <div class="sv-tier-body">
                <span class="sv-pos sv-pos-clickable" data-action="prompt-move" data-idx="0" title="Click to jump position">1</span>
                <span class="sv-name">${esc(up.name)}</span>
                ${up.hit ? '<span style="color:#2ecc71;font-size:11px;font-weight:900;">✓ HIT</span>' : ''}
                ${statusPillHtml(up.id)}
                ${targetHitTime ? `<span class="sv-hit-badge ${inWindow ? 'sv-hit-now' : ''}">${inWindow ? `🎯 HIT NOW` : `Hit at ${targetHitTime}`}</span>` : ''}
                <div class="sv-tier-actions">
                    ${lineup.length > 1 ? `<button class="sv-btn" data-action="swap-top" title="Swap with Next">⇄ Swap</button>` : ''}
                    ${lineup.length > 1 ? `<button class="sv-btn" data-action="move" data-from="0" data-to="1">▼ Down</button>` : ''}
                    ${lineup.length > 2 ? `<button class="sv-btn" data-action="move" data-from="0" data-to="${lineup.length-1}">⏬ Bottom</button>` : ''}
                    <button class="sv-btn sv-btn-skip" data-action="skip" data-idx="0">Skip</button>
                    <button class="sv-btn sv-btn-rm" data-action="remove" data-idx="0">✕</button>
                </div>
            </div>
        </div>`;

        // NEXT (1)
        if (lineup.length >= 2) {
            const nx = lineup[1];
            html += `
            <div class="sv-tier-card sv-next-card" draggable="true" data-idx="1">
                <div class="sv-tier-label"><span>Next</span></div>
                <div class="sv-tier-body">
                    <span class="sv-pos sv-pos-clickable" data-action="prompt-move" data-idx="1" title="Click to jump position">2</span>
                    <span class="sv-name">${esc(nx.name)}</span>
                    ${nx.hit ? '<span style="color:#2ecc71;font-size:11px;font-weight:900;">✓</span>' : ''}
                    ${statusPillHtml(nx.id)}
                    <div class="sv-tier-actions">
                        <button class="sv-btn" data-action="make-current" data-idx="1">▲ Make Up</button>
                        <button class="sv-btn" data-action="swap-top" title="Swap with UP">⇄ Swap Up</button>
                        ${lineup.length > 2 ? `<button class="sv-btn" data-action="move" data-from="1" data-to="2">▼ Down</button>` : ''}
                        <button class="sv-btn sv-btn-skip" data-action="skip" data-idx="1">Skip</button>
                        <button class="sv-btn sv-btn-rm" data-action="remove" data-idx="1">✕</button>
                    </div>
                </div>
            </div>`;
        }

        // QUEUE (2+)
        if (lineup.length > 2) {
            html += `<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:#4a5568;padding:6px 12px 2px 12px;">Queue (${lineup.length - 2})</div>`;
            for (let i = 2; i < lineup.length; i++) {
                const m = lineup[i];
                html += `
                <div class="sv-queue-row" draggable="true" data-idx="${i}">
                    <span class="sv-q-pos sv-pos-clickable" data-action="prompt-move" data-idx="${i}" title="Click to jump position">${i + 1}</span>
                    <span class="sv-q-name">${esc(m.name)}</span>
                    ${m.hit ? '<span style="color:#2ecc71;font-size:10px;font-weight:900;">✓</span>' : ''}
                    ${statusPillHtml(m.id)}
                    <div class="sv-q-actions">
                        <button class="sv-btn sv-btn-xs" data-action="make-current" data-idx="${i}" title="Make Currently Up">▲▲</button>
                        <button class="sv-btn sv-btn-xs" data-action="move" data-from="${i}" data-to="${i-1}" title="Move up one">▲</button>
                        <button class="sv-btn sv-btn-xs" data-action="move" data-from="${i}" data-to="${Math.min(lineup.length-1, i+1)}" title="Move down one">▼</button>
                        <button class="sv-btn sv-btn-xs sv-btn-skip" data-action="skip" data-idx="${i}">Skip</button>
                        <button class="sv-btn sv-btn-xs sv-btn-rm" data-action="remove" data-idx="${i}">✕</button>
                    </div>
                </div>`;
            }
        }

        container.innerHTML = html;
        renderChainBar();
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER: SEARCH SUGGESTIONS
    // ══════════════════════════════════════════════════════════════
    function renderSuggest() {
        const box = document.getElementById('sv-suggest');
        if (!box || box.style.display === 'none') return;

        const val = searchQuery.toLowerCase().trim();
        const available = factionMembers.filter(m =>
            !lineup.some(lm => lm.name.toLowerCase() === m.name.toLowerCase())
        );

        let matches = [];
        if (!val) {
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
            box.innerHTML = `<div style="padding:8px 12px;color:#4a5568;font-style:italic;font-size:12px;">No matching members found</div>`;
            return;
        }

        box.innerHTML = `<div style="padding:4px 10px 2px;font-size:9px;font-weight:800;text-transform:uppercase;color:#4a5568;letter-spacing:0.5px;">Faction Members (${matches.length})</div>` +
            matches.map((m, idx) => {
                const st = memberStatuses[String(m.id)];
                const online = st ? st.online : 'Offline';
                const state  = st ? st.state  : 'Okay';
                let dotColor = '#4a5568';
                if (online === 'Online' && state === 'Okay') dotColor = '#2ecc71';
                else if (online === 'Idle') dotColor = '#f39c12';

                let nameHtml = esc(m.name);
                if (val) {
                    nameHtml = nameHtml.replace(new RegExp(`(${escRe(val)})`, 'gi'), '<mark style="background:rgba(46,204,113,0.25);color:#2ecc71;border-radius:2px;padding:0 1px;">$1</mark>');
                }

                const pillHtml = statusPillHtml(m.id);
                return `<div class="sv-suggest-item ${idx === suggestSelected ? 'sv-suggest-sel' : ''}"
                    data-action="add-suggest" data-name="${escAttr(m.name)}" data-id="${m.id}" data-sidx="${idx}">
                    <span style="width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block;flex-shrink:0;"></span>
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nameHtml}</span>
                    ${pillHtml}
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
                <span class="sv-status-pill sv-same" id="sv-status-pill" title="Grey: same, Green: updated">
                    <span class="sv-dot sv-dot-grey" id="sv-status-dot"></span>
                    <span id="sv-status-txt">SAME</span>
                </span>
                <span class="sv-title-text">⛓ Chain Manager</span>
                <span class="sv-min-up" id="sv-min-up">${lineup.length ? 'UP: ' + esc(lineup[0].name) : 'No lineup'}</span>
            </div>
            <div class="sv-hdr-controls">
                <button class="sv-min-post-btn" id="sv-min-post-btn" title="Post to Faction Chat">📋 Post</button>
                <button class="sv-ctrl-btn" id="sv-min-btn" title="Minimize / Expand">${isMinimized ? '□' : '─'}</button>
                <button class="sv-ctrl-btn" id="sv-close-btn" title="Close">✕</button>
            </div>
        </div>

        <!-- BODY -->
        <div class="sv-body" id="sv-body">

            <!-- CHAIN BAR -->
            <div id="sv-chain-bar" class="sv-chain-bar"></div>

            <!-- CONTROLS ROW 1 -->
            <div class="sv-controls-row">
                <div class="sv-hit-time-row">
                    <span style="font-size:10px;color:#718096;white-space:nowrap;">Hit at:</span>
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
                    <input id="sv-hit-time-custom" class="sv-input-sm" type="text" placeholder="2:15" style="display:none;width:48px;" />
                </div>
                <button class="sv-btn sv-btn-green" id="sv-post-btn" title="Post vertical lineup to Faction Chat">📋 Post Chat</button>
                <button class="sv-btn" id="sv-copy-btn" title="Copy lineup (vertical)">Copy</button>
                <button class="sv-btn" id="sv-copy-compact-btn" title="Copy compact one-liner">Compact</button>
            </div>

            <!-- CONTROLS ROW 2 -->
            <div class="sv-controls-row sv-controls-row2">
                <button class="sv-btn" id="sv-next-btn" title="Advance to next manually">Next ▶</button>
                <button class="sv-btn" id="sv-reset-btn" title="Clear all hit marks">Reset</button>
                <button class="sv-btn sv-btn-danger" id="sv-clear-btn" title="Remove all members">Clear All</button>
                <label class="sv-toggle-lbl" title="Loop queue after everyone hits">
                    <input type="checkbox" id="sv-loop-chk" ${loopMode ? 'checked' : ''} />
                    Loop
                </label>
                <label class="sv-toggle-lbl" title="Auto-detect hits and rotate lineup automatically">
                    <input type="checkbox" id="sv-auto-chk" ${autoMode ? 'checked' : ''} />
                    Auto
                </label>
            </div>

            <!-- STATUS MSG BAR -->
            <div class="sv-status-bar"><span id="sv-status-msg"></span></div>

            <!-- LINEUP CARDS -->
            <div id="sv-lineup-container"></div>

            <!-- ADD MEMBER ROW -->
            <div class="sv-add-row" style="position:relative;">
                <input id="sv-add-input" class="sv-add-input" placeholder="Type to search faction members…" autocomplete="off" />
                <button class="sv-add-btn" id="sv-add-btn">+ Add</button>
                <div id="sv-suggest" class="sv-suggest" style="display:none;"></div>
            </div>

            <!-- QUICK ACTIONS ROW -->
            <div class="sv-quick-row">
                <button class="sv-btn sv-btn-sm" id="sv-autofill-btn" title="Add all Online + Okay members">Auto-Fill</button>
                <button class="sv-btn sv-btn-sm" id="sv-refresh-btn" title="Refresh faction member list from Torn API">↻ Refresh Members</button>
                <button class="sv-btn sv-btn-sm" id="sv-key-toggle-btn" title="View or change Torn API Key" style="margin-left:auto;">⚙ Key</button>
            </div>

            <!-- API KEY SETUP ROW -->
            <div id="sv-apikey-row" class="sv-apikey-row" style="${apiKey ? 'display:none;' : ''}">
                <div style="width:100%;font-size:11px;color:#f39c12;margin-bottom:2px;font-weight:700;">🔑 Enter Torn API Key (Faction / Minimal)</div>
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
    //  EVENT LISTENERS & DELEGATION (NO INLINE ONCLICK)
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

        // Header buttons
        document.getElementById('sv-min-btn').addEventListener('click', () => {
            isMinimized = !isMinimized;
            hud.classList.toggle('sv-minimized', isMinimized);
            document.getElementById('sv-min-btn').textContent = isMinimized ? '□' : '─';
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
    //  CSS STYLES
    // ══════════════════════════════════════════════════════════════
    const css = `
    #sv-chain-hud {
        position: fixed;
        z-index: 99999999;
        width: 360px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        background: rgba(10, 14, 23, 0.97);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(46,204,113,0.35);
        border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.7), 0 0 20px rgba(46,204,113,0.1);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        font-size: 12px;
        color: #e2e8f0;
        user-select: none;
        overflow: hidden;
        transition: border-color 0.3s, box-shadow 0.3s;
    }
    #sv-chain-hud.sv-minimized { width: auto; max-width: 460px; border-radius: 24px; max-height: none; }
    #sv-chain-hud.sv-minimized .sv-body { display: none; }
    #sv-chain-hud.sv-minimized .sv-header { border-radius: 24px; border-bottom: none; }
    #sv-chain-hud.sv-minimized .sv-title-text { display: none; }
    #sv-chain-hud.sv-minimized .sv-min-up { display: inline-block; }
    #sv-chain-hud.sv-minimized .sv-min-post-btn { display: inline-flex; }

    .sv-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: rgba(255,255,255,0.035);
        border-bottom: 1px solid rgba(255,255,255,0.06);
        cursor: move;
        flex-shrink: 0;
        gap: 8px;
    }
    .sv-title { display: flex; align-items: center; gap: 7px; overflow: hidden; }
    .sv-title-text { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #e2e8f0; white-space: nowrap; }
    .sv-min-up { display: none; font-size: 11px; font-weight: 800; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
    .sv-hdr-controls { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }

    .sv-status-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 12px; font-size: 9px; font-weight: 800; letter-spacing: 0.5px; cursor: default; transition: all 0.2s; }
    .sv-updated { background: rgba(46,204,113,0.2); color: #2ecc71; border: 1px solid rgba(46,204,113,0.45); }
    .sv-same    { background: rgba(113,128,150,0.18); color: #a0aec0; border: 1px solid rgba(113,128,150,0.35); }
    .sv-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; transition: all 0.2s; }
    .sv-dot-green { background: #2ecc71; box-shadow: 0 0 7px #2ecc71; animation: svDotPulse 1.3s infinite; }
    .sv-dot-grey  { background: #718096; box-shadow: none; animation: none; }
    @keyframes svDotPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.3);opacity:.7} }
    @keyframes sv-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
    @keyframes sv-glow { 0%,100%{text-shadow:0 0 4px #2ecc71} 50%{text-shadow:0 0 12px #2ecc71,0 0 3px #2ecc71} }

    .sv-min-post-btn {
        display: none; background: linear-gradient(135deg,#2ecc71,#27ae60); color: #081a0a;
        border: none; padding: 3px 9px; border-radius: 5px; font-size: 11px; font-weight: 800;
        cursor: pointer; gap: 4px; align-items: center; white-space: nowrap; transition: all 0.15s;
    }
    .sv-min-post-btn:hover { background: linear-gradient(135deg,#3ee083,#2ecc71); transform: translateY(-1px); }

    .sv-ctrl-btn { background: transparent; border: none; color: #718096; cursor: pointer; padding: 2px 5px; font-size: 12px; border-radius: 4px; }
    .sv-ctrl-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }

    .sv-body { overflow-y: auto; flex: 1; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
    .sv-body::-webkit-scrollbar { width: 4px; }
    .sv-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }

    .sv-chain-bar { padding: 10px 14px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }

    .sv-controls-row { display: flex; align-items: center; gap: 5px; padding: 6px 10px; flex-wrap: wrap; }
    .sv-controls-row2 { padding-top: 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .sv-hit-time-row { display: flex; align-items: center; gap: 5px; }

    .sv-btn {
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e0;
        padding: 3px 8px; border-radius: 5px; font-size: 11px; font-weight: 700; cursor: pointer;
        transition: all 0.12s; white-space: nowrap;
    }
    .sv-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .sv-btn-green { background: rgba(46,204,113,0.18); border-color: rgba(46,204,113,0.4); color: #2ecc71; }
    .sv-btn-green:hover { background: rgba(46,204,113,0.28); color: #3ee083; }
    .sv-btn-danger { background: rgba(231,76,60,0.15); border-color: rgba(231,76,60,0.35); color: #e74c3c; }
    .sv-btn-danger:hover { background: rgba(231,76,60,0.25); }
    .sv-btn-skip { background: rgba(243,156,18,0.12); border-color: rgba(243,156,18,0.3); color: #f39c12; }
    .sv-btn-rm { background: rgba(231,76,60,0.12); border-color: rgba(231,76,60,0.3); color: #e74c3c; padding: 3px 6px; }
    .sv-btn-xs { font-size: 10px; padding: 2px 5px; }
    .sv-btn-sm { font-size: 11px; }

    .sv-select, .sv-input-sm {
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #e2e8f0;
        padding: 3px 6px; border-radius: 5px; font-size: 11px; outline: none;
    }
    .sv-select option { background: #0e1217; }

    .sv-toggle-lbl { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #a0aec0; cursor: pointer; }
    .sv-toggle-lbl input { cursor: pointer; margin: 0; accent-color: #2ecc71; }

    .sv-status-bar { padding: 3px 12px; min-height: 18px; font-size: 11px; }

    /* Cards */
    .sv-tier-card {
        margin: 6px 10px 0; border-radius: 8px; border: 1px solid rgba(255,255,255,0.07);
        background: rgba(255,255,255,0.03); overflow: hidden;
        transition: border-color 0.2s; cursor: grab;
    }
    .sv-up-card { background: rgba(46,204,113,0.07); border-color: rgba(46,204,113,0.3); }
    .sv-next-card { background: rgba(52,152,219,0.06); border-color: rgba(52,152,219,0.25); }
    .sv-tier-card.sv-drag-over { border-color: #2ecc71; box-shadow: 0 0 0 1px rgba(46,204,113,0.3); }
    .sv-tier-card.sv-dragging { opacity: 0.5; }
    .sv-tier-label { display: flex; justify-content: space-between; align-items: center; padding: 4px 10px 0; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #718096; }
    .sv-up-card .sv-tier-label { color: #2ecc71; }
    .sv-next-card .sv-tier-label { color: #3498db; }
    .sv-tier-body { display: flex; align-items: center; gap: 6px; padding: 6px 10px 8px; flex-wrap: wrap; }
    .sv-pos { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.06); font-size: 10px; font-weight: 800; color: #718096; flex-shrink: 0; }
    .sv-pos-clickable { cursor: pointer; }
    .sv-pos-clickable:hover { background: rgba(46,204,113,0.2); color: #2ecc71; }
    .sv-name { font-size: 14px; font-weight: 800; color: #fff; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .sv-hit-badge { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: rgba(46,204,113,0.12); color: #a0aec0; border: 1px solid rgba(255,255,255,0.08); }
    .sv-hit-now { background: rgba(46,204,113,0.25); color: #2ecc71; border-color: rgba(46,204,113,0.4); animation: sv-glow 1s infinite; }
    .sv-tier-actions { display: flex; gap: 4px; flex-wrap: wrap; width: 100%; margin-top: 4px; }

    /* Queue rows */
    .sv-queue-row {
        display: flex; align-items: center; gap: 6px; padding: 5px 10px;
        border-bottom: 1px solid rgba(255,255,255,0.04); cursor: grab;
        transition: background 0.1s;
    }
    .sv-queue-row:hover { background: rgba(255,255,255,0.03); }
    .sv-queue-row.sv-drag-over { background: rgba(46,204,113,0.08); border-color: rgba(46,204,113,0.3); }
    .sv-queue-row.sv-dragging { opacity: 0.4; }
    .sv-q-pos { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: rgba(255,255,255,0.05); font-size: 9px; font-weight: 800; color: #718096; flex-shrink: 0; cursor: pointer; }
    .sv-q-pos:hover { background: rgba(46,204,113,0.2); color: #2ecc71; }
    .sv-q-name { font-size: 12px; font-weight: 700; color: #cbd5e0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-q-actions { display: flex; gap: 3px; margin-left: auto; flex-shrink: 0; }

    /* Status pills */
    .sv-pill { display: inline-flex; align-items: center; padding: 1px 5px; border-radius: 8px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; }
    .sv-pill-online  { background: rgba(46,204,113,0.15); color: #2ecc71; border: 1px solid rgba(46,204,113,0.3); }
    .sv-pill-idle    { background: rgba(243,156,18,0.15); color: #f39c12; border: 1px solid rgba(243,156,18,0.3); }
    .sv-pill-offline { background: rgba(113,128,150,0.12); color: #718096; border: 1px solid rgba(113,128,150,0.2); }
    .sv-pill-hosp    { background: rgba(231,76,60,0.15); color: #e74c3c; border: 1px solid rgba(231,76,60,0.3); }
    .sv-pill-travel  { background: rgba(52,152,219,0.15); color: #3498db; border: 1px solid rgba(52,152,219,0.3); }

    /* Add row */
    .sv-add-row { display: flex; gap: 5px; padding: 8px 10px 4px; align-items: center; }
    .sv-add-input { flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #e2e8f0; padding: 5px 9px; border-radius: 6px; font-size: 12px; outline: none; min-width: 0; }
    .sv-add-input:focus { border-color: rgba(46,204,113,0.5); }
    .sv-add-input::placeholder { color: #4a5568; }
    .sv-add-btn { background: rgba(46,204,113,0.18); border: 1px solid rgba(46,204,113,0.4); color: #2ecc71; padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: 800; cursor: pointer; white-space: nowrap; }
    .sv-add-btn:hover { background: rgba(46,204,113,0.28); color: #3ee083; }

    /* Suggest box */
    .sv-suggest {
        position: absolute; bottom: calc(100% + 6px); left: 0; right: 0;
        background: rgba(10,14,23,0.99); border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px; max-height: 260px; overflow-y: auto; z-index: 100000000;
        box-shadow: 0 -8px 24px rgba(0,0,0,0.7);
        scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent;
    }
    .sv-suggest::-webkit-scrollbar { width: 4px; }
    .sv-suggest::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
    .sv-suggest-item { display: flex; align-items: center; gap: 7px; padding: 6px 12px; cursor: pointer; font-size: 12px; color: #cbd5e0; transition: background 0.1s; }
    .sv-suggest-item:hover, .sv-suggest-sel { background: rgba(46,204,113,0.12); }

    /* Quick actions */
    .sv-quick-row { display: flex; gap: 5px; padding: 4px 10px 8px; align-items: center; }

    /* API key row */
    .sv-apikey-row {
        display: flex; align-items: center; gap: 6px; padding: 8px 10px;
        background: rgba(243,156,18,0.08); border-top: 1px solid rgba(243,156,18,0.25);
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
        fetchChain();
        fetchFactionMembers();
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
