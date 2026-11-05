// ==UserScript==
// @name         FactionOS Chain Manager (Standalone)
// @namespace    https://faction-os.duckdns.org/
// @version      3.0.0
// @description  Professional high-speed chain lineup manager for Torn. Multi-tier zero-latency hit detection (<500ms), native in-page attack & DOM observers, dynamic adaptive polling, smart savior attribution, clean 2-bar controls, streamlined queue rows, and live compact HUD timer.
// @author       FactionOS
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @connect      api.torn.com
// @connect      faction-os.duckdns.org
// @run-at       document-end
// @updateURL    https://faction-os.duckdns.org/torn-chain-lineup.user.js
// @downloadURL  https://faction-os.duckdns.org/torn-chain-lineup.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ══════════════════════════════════════════════════════════════
    //  CONSTANTS & LOCAL STORAGE KEYS
    // ══════════════════════════════════════════════════════════════
    const SERVER_BASE       = 'https://faction-os.duckdns.org';
    const LS_KEY_POS        = 'sv_chain_mgr_pos';
    const LS_KEY_APIKEY     = 'sv_chain_apikey';
    const LS_KEY_MEMBERS    = 'sv_chain_members_cache';
    const STATUS_POLL_MS    = 60000; // 60s for member online/offline status

    // Chain Respect Bonuses thresholds in Torn
    const CHAIN_BONUSES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

    // ══════════════════════════════════════════════════════════════
    //  STATE
    // ══════════════════════════════════════════════════════════════
    let apiKey          = GM_getValue('sv_apikey', '') || localStorage.getItem(LS_KEY_APIKEY) || '';
    let lineup          = [];          // [{name, id, hit, skipped}]
    let targetHitTime   = '2:30';
    let cycleNum        = 1;
    let loopMode        = true;
    let autoMode        = true;        // Auto-advance on confirmed hit
    let autoSendOnPost  = GM_getValue('sv_autosend', false);
    let soundEnabled    = GM_getValue('sv_sound', true);
    let chainTimeout    = 0;           // seconds left on timer
    let chainCount      = 0;           // current chain count
    let chainActive     = false;
    let factionMembers  = [];          // [{id, name, online, state, until, lastActionTs}]
    let memberStatuses  = {};          // id -> {online, state, until, lastActionTs}
    let processedAtkIds = new Set();
    let isFirstPoll      = true;       // snapshot initial attacks
    let hasAttacksAccess = true;       // true if key has Limited+ / Faction AA; false for Public keys
    let isMinimized      = GM_getValue('sv_min', false);
    let isHidden         = GM_getValue('sv_hidden', false);
    let searchQuery      = '';
    let suggestSelected  = -1;
    let isUpdated        = false;      // green/grey status light
    let warnedAt60       = false;      // audio warning at 1:00 threshold
    let showHospBanner   = false;      // interactive filter state

    // Dynamic Adaptive Polling State (Tier 3)
    let lastHitUnix       = 0;
    let adaptivePollTimer = null;
    let pollMembersTimer  = null;
    let timerInterval     = null;
    let lastProcessedHitSig = '';
    let lastProcessedHitTs  = 0;

    // ══════════════════════════════════════════════════════════════
    //  WEB AUDIO SYNTHESIZER (ZERO EXTERNAL DEPENDENCY)
    // ══════════════════════════════════════════════════════════════
    let audioCtx = null;
    function getAudioContext() {
        if (!soundEnabled) return null;
        try {
            if (!audioCtx) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) audioCtx = new AudioContextClass();
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
            return audioCtx;
        } catch(e) {
            return null;
        }
    }

    function playSuccessChime() {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            
            // Tone 1: 587.33 Hz (D5)
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(587.33, now);
            gain1.gain.setValueAtTime(0.12, now);
            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.start(now);
            osc1.stop(now + 0.18);

            // Tone 2: 880 Hz (A5)
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(880, now + 0.08);
            gain2.gain.setValueAtTime(0.15, now + 0.08);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start(now + 0.08);
            osc2.stop(now + 0.35);
        } catch(e) {}
    }

    function playPanicWarningBeep() {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, now);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.25);
        } catch(e) {}
    }

    // ══════════════════════════════════════════════════════════════
    //  CHAIN METRIC HELPERS: RESPECT & BONUS MILESTONES
    // ══════════════════════════════════════════════════════════════
    function getRespectMultiplier(count) {
        if (!count || count < 10) return '1.00x';
        if (count < 25) return '1.25x';
        if (count < 50) return '1.50x';
        if (count < 100) return '1.75x';
        if (count < 250) return '2.00x';
        if (count < 500) return '2.25x';
        if (count < 1000) return '2.50x';
        if (count < 2500) return '2.75x';
        if (count < 5000) return '3.00x';
        if (count < 10000) return '3.25x';
        if (count < 25000) return '3.50x';
        if (count < 50000) return '3.75x';
        return '4.00x';
    }

    function getNextBonus(count) {
        if (!count || count <= 0) return { next: 10, remaining: 10, text: '10 to 10' };
        for (const b of CHAIN_BONUSES) {
            if (count < b) {
                const rem = b - count;
                const bStr = b >= 1000 ? (b / 1000) + 'k' : String(b);
                return { next: b, remaining: rem, text: `${rem} to ${bStr}` };
            }
        }
        return { next: null, remaining: 0, text: 'MAX BONUS' };
    }

    // ══════════════════════════════════════════════════════════════
    //  CROSS-TAB SYNCHRONIZATION (BROADCASTCHANNEL + STORAGE)
    // ══════════════════════════════════════════════════════════════
    let broadcastChan = null;
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            broadcastChan = new BroadcastChannel('factionos_chain_sync');
            broadcastChan.onmessage = (e) => {
                if (e && e.data) handleIncomingBroadcast(e.data);
            };
        }
    } catch(e) {}

    window.addEventListener('storage', (e) => {
        if (e.key === 'sv_chain_sync_event' && e.newValue) {
            try {
                const payload = JSON.parse(e.newValue);
                handleIncomingBroadcast(payload);
            } catch(err) {}
        }
    });

    function broadcastHitEvent(payload) {
        // 1. Process locally in current tab immediately
        handleIncomingHit(payload);

        // 2. Broadcast to other open tabs (< 10ms)
        if (broadcastChan) {
            try { broadcastChan.postMessage(payload); } catch(e) {}
        }
        try {
            localStorage.setItem('sv_chain_sync_event', JSON.stringify({ ...payload, _ts: Date.now() }));
        } catch(e) {}
    }

    function handleIncomingBroadcast(payload) {
        if (!payload || !payload.type) return;
        if (payload.type === 'HIT_DETECTED' || payload.type === 'DOM_CHAIN_UPDATE') {
            handleIncomingHit(payload);
        } else if (payload.type === 'LINEUP_UPDATED' && payload.lineup) {
            lineup = payload.lineup;
            if (payload.cycleNum) cycleNum = payload.cycleNum;
            renderLineup();
            renderChainBar();
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  TIER 1: IN-PAGE DOM & NATIVE ATTACK OBSERVERS (< 50ms)
    // ══════════════════════════════════════════════════════════════
    function initTier1AttackObserver() {
        if (typeof unsafeWindow === 'undefined') return;

        // Hook window.fetch on attack pages & Torn loader
        const origFetch = unsafeWindow.fetch;
        if (origFetch) {
            unsafeWindow.fetch = async function(...args) {
                const response = await origFetch.apply(this, args);
                try {
                    const clone = response.clone();
                    const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';
                    if (url.includes('sid=attack') || url.includes('loader.php')) {
                        clone.json().then(data => handleNativeAttackResponse(data, url)).catch(() => {});
                    }
                } catch(e) {}
                return response;
            };
        }

        // Hook XMLHttpRequest
        if (unsafeWindow.XMLHttpRequest) {
            const origOpen = unsafeWindow.XMLHttpRequest.prototype.open;
            const origSend = unsafeWindow.XMLHttpRequest.prototype.send;
            unsafeWindow.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                this._sv_url = url;
                return origOpen.apply(this, [method, url, ...rest]);
            };
            unsafeWindow.XMLHttpRequest.prototype.send = function(...args) {
                this.addEventListener('load', function() {
                    try {
                        if (this._sv_url && (this._sv_url.includes('sid=attack') || this._sv_url.includes('loader.php'))) {
                            const data = JSON.parse(this.responseText);
                            handleNativeAttackResponse(data, this._sv_url);
                        }
                    } catch(e) {}
                });
                return origSend.apply(this, args);
            };
        }
    }

    function handleNativeAttackResponse(data, url) {
        if (!data) return;
        const isSuccess = data.success === true || data.status === 'success' || data.result === 'success';
        const hasChain = (data.chain !== undefined && data.chain > 0) || (data.data && data.data.chain > 0);
        const textLog = JSON.stringify(data);
        const isAttackFinish = /hospitalized|mugged|lefts+them|losts+to|stalemate|finished/i.test(textLog) ||
                               /respect/i.test(textLog) || (hasChain && isSuccess);

        if (isAttackFinish || hasChain) {
            const attackerName = data.attacker_name || (data.data && data.data.attacker_name) || '';
            const attackerId   = data.attacker_id || (data.data && data.data.attacker_id) || null;
            const chainVal     = data.chain || (data.data && data.data.chain) || null;
            const timeoutVal   = data.chainTimeout || (data.data && data.data.chainTimeout) || null;

            broadcastHitEvent({
                type: 'HIT_DETECTED',
                source: 'tier1_fetch',
                attackerId,
                attackerName,
                chain: chainVal,
                timeout: timeoutVal,
                timestamp: Date.now()
            });
        }
    }

    function initTier1HeaderDOMObserver() {
        let lastObservedChain = 0;

        function scanDOMChainCounter() {
            try {
                // Selector covering desktop and mobile chain bar, header widget, and faction war link
                const chainEl = document.querySelector('[class*="chain-bar"], [class*="chainBar"], [class*="bar-chain"], a[href*="factions.php?step=your#/war"], #sidebarroot');
                if (!chainEl) return;

                const text = chainEl.innerText || '';
                if (!text) return;

                // Match chain count e.g. "34 / 50" or "Chain: 34" or "35"
                const chainMatch = text.match(/(\d{1,6})\s*\/\s*(?:10|25|50|100|250|500|1k|2\.5k|5k|10k|25k|50k|100k|\d{2,6})/i) ||
                                   text.match(/chain\s*:?\s*(\d{1,6})/i);
                
                const timerMatch = text.match(/(\d{1,2}:\d{2})/);

                let parsedChain = null;
                let parsedTimer = null;

                if (chainMatch) parsedChain = parseInt(chainMatch[1], 10);
                if (timerMatch) parsedTimer = parseTimeToSecs(timerMatch[1]);

                if (parsedChain !== null && parsedChain > 0) {
                    if (parsedChain > chainCount) {
                        broadcastHitEvent({
                            type: 'HIT_DETECTED',
                            source: 'tier1_dom',
                            chain: parsedChain,
                            timeout: parsedTimer || 300,
                            timestamp: Date.now()
                        });
                    } else if (parsedChain === chainCount && parsedTimer !== null && parsedTimer !== chainTimeout) {
                        chainTimeout = parsedTimer;
                        renderChainBar();
                    }
                }
            } catch(e) {}
        }

        const observer = new MutationObserver(() => scanDOMChainCounter());

        function startObserving() {
            const root = document.querySelector('#sidebarroot') || document.querySelector('#top-page-links-list') || document.body;
            if (root) {
                observer.observe(root, { childList: true, subtree: true, characterData: true });
                scanDOMChainCounter();
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserving);
        } else {
            startObserving();
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  TIER 2: FACTION CHAT & WEBSOCKET SNIFFING (< 250ms)
    // ══════════════════════════════════════════════════════════════
    function initTier2WebSocketSniffer() {
        if (typeof unsafeWindow === 'undefined' || !unsafeWindow.WebSocket) return;

        const OriginalWS = unsafeWindow.WebSocket;
        unsafeWindow.WebSocket = new Proxy(OriginalWS, {
            construct(target, args) {
                const ws = new target(...args);
                try {
                    ws.addEventListener('message', function(event) {
                        try {
                            handleWebSocketRawMessage(event.data);
                        } catch(e) {}
                    });
                } catch(e) {}
                return ws;
            }
        });
    }

    function handleWebSocketRawMessage(raw) {
        if (typeof raw !== 'string') return;
        if (!raw.includes('respect') && !raw.includes('hospitalized') && !raw.includes('attacked') && !raw.includes('chain')) return;

        let text = raw;
        let attackerName = '';
        let attackerId = null;

        try {
            const parsed = JSON.parse(raw);
            const msgObj = parsed.data || parsed.message || parsed;
            text = typeof msgObj === 'string' ? msgObj : (msgObj.text || msgObj.message || msgObj.content || JSON.stringify(msgObj));
            attackerId = msgObj.senderId || msgObj.userId || msgObj.attacker_id || null;
            attackerName = msgObj.senderName || msgObj.userName || msgObj.attacker_name || '';
        } catch(e) {}

        // Match Torn log: "[Attacker] hospitalized [Target] for 1.25x respect"
        const logMatch = text.match(/(?:^|[>\s"'])(\b[a-zA-Z0-9_\-]{3,16}\b)\s+(?:hospitalized|attacked|mugged|left|finished)\s+.*?(?:for\s+([\d\.]+)x\s+respect|\+?([\d\.]+)\s+respect)/i);
        if (logMatch) {
            if (!attackerName) attackerName = logMatch[1];
            broadcastHitEvent({
                type: 'HIT_DETECTED',
                source: 'tier2_ws',
                attackerId,
                attackerName,
                chain: chainCount ? chainCount + 1 : null,
                timestamp: Date.now()
            });
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  SMART QUEUE ROTATION & SAVIOR HIT LOGIC
    // ══════════════════════════════════════════════════════════════
    function handleIncomingHit(evt) {
        if (!evt) return;

        const now = Date.now();
        const incomingChain = evt.chain || (chainCount + 1);
        const hitSig = `${evt.attackerId || evt.attackerName || 'hit'}_${incomingChain}`;

        // Deduplication: prevent processing the same hit within 1.2 seconds
        if (hitSig === lastProcessedHitSig && (now - lastProcessedHitTs) < 1200) {
            return;
        }
        lastProcessedHitSig = hitSig;
        lastProcessedHitTs  = now;

        // 1. Update Chain Counts & Live Timers
        if (incomingChain > chainCount) {
            chainCount = incomingChain;
        } else if (!chainCount) {
            chainCount = incomingChain;
        }
        chainTimeout = evt.timeout || 300;
        chainActive = true;
        warnedAt60 = false;

        const attackerId = evt.attackerId ? String(evt.attackerId) : null;
        const attackerName = (evt.attackerName || '').trim().toLowerCase();

        // 2. Identify Attacker vs Lineup
        if (!lineup.length) {
            playSuccessChime();
            flashStatus(`✓ Hit #${chainCount} registered! (Lineup is empty)`, false);
            setUpdated(true);
            renderChainBar();
            return;
        }

        const up = lineup[0];
        const upId = up.id ? String(up.id) : null;
        const upName = (up.name || '').trim().toLowerCase();

        const isAssignedHitter = Boolean(
            (attackerId && upId && attackerId === upId) ||
            (attackerName && upName && attackerName === upName) ||
            (!attackerName && !attackerId && evt.source === 'tier1_dom') // Native DOM increment during active window
        );

        if (isAssignedHitter) {
            // ── SCENARIO A: ASSIGNED PLAYER MADE THE HIT ──
            playSuccessChime();
            const [hitter] = lineup.splice(0, 1);
            hitter.hit = true;
            if (loopMode) {
                lineup.push(hitter);
            }
            cycleNum++;

            const nextUpName = lineup[0] ? lineup[0].name : 'Lineup Empty';
            flashStatus(`✅ Hit Confirmed! ${hitter.name} landed hit #${chainCount}! Next UP: ${nextUpName}`, false);
            setUpdated(true);
            save();
            renderLineup();
            renderChainBar();

            // Auto-Send callout to faction chat if enabled
            if (autoSendOnPost) {
                setTimeout(() => postToChat(), 200);
            }
        } else if (attackerName || attackerId) {
            // ── SCENARIO B: CHAIN SAVIOR / JUMP-IN HIT ──
            const saviorIdx = lineup.findIndex(m =>
                (m.id && attackerId && String(m.id) === attackerId) ||
                (m.name && m.name.trim().toLowerCase() === attackerName)
            );

            playSuccessChime();

            if (saviorIdx !== -1) {
                // Move Savior to the bottom of the queue for their contribution
                const [savior] = lineup.splice(saviorIdx, 1);
                savior.hit = true;
                if (loopMode) {
                    lineup.push(savior);
                }
                const displayName = savior.name;
                flashStatus(`⚡ Savior Hit! ${displayName} saved the chain (#${chainCount})! ${lineup[0].name} is still UP.`, false);
            } else {
                const displayName = evt.attackerName || 'Faction Savior';
                flashStatus(`⚡ Savior Hit! ${displayName} saved the chain (#${chainCount})! ${lineup[0].name} is still UP.`, false);
            }

            setUpdated(true);
            save();
            renderLineup();
            renderChainBar();
        } else {
            // Unattributed hit increment
            playSuccessChime();
            flashStatus(`✓ Chain incremented to #${chainCount}! Next UP: ${lineup[0].name}`, false);
            setUpdated(true);
            renderChainBar();
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  TIER 3: DYNAMIC ADAPTIVE API POLLING
    // ══════════════════════════════════════════════════════════════
    function scheduleAdaptivePoll() {
        if (adaptivePollTimer) clearTimeout(adaptivePollTimer);

        // Safe zone (> 3:00 / > 180s) -> poll every 10s
        // Critical zone (<= 2:30 / <= 150s) or within 30s of Hit at target -> accelerate to 2s
        const targetSecs = parseTimeToSecs(targetHitTime) || 150;
        const isCritical = chainTimeout > 0 && chainTimeout <= 150;
        const nearTarget = chainTimeout > 0 && Math.abs(chainTimeout - targetSecs) <= 30;

        const nextDelayMs = (isCritical || nearTarget) ? 2000 : 10000;

        adaptivePollTimer = setTimeout(() => {
            pollChainAndAttacks();
            scheduleAdaptivePoll();
        }, nextDelayMs);
    }

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

    function processAttacks(attacks) {
        if (!attacks || !attacks.length) return;
        const chainAtks = attacks
            .filter(a => a.chain && a.chain > 0)
            .sort((a, b) => (a.timestamp_ended || 0) - (b.timestamp_ended || 0));

        if (isFirstPoll) {
            for (const atk of chainAtks) {
                const id = atk.code || `${atk.attacker_id}_${atk.timestamp_ended}`;
                processedAtkIds.add(id);
                if (atk.timestamp_ended && atk.timestamp_ended > lastHitUnix) {
                    lastHitUnix = atk.timestamp_ended;
                }
            }
            isFirstPoll = false;
            renderChainBar();
            return;
        }

        for (const atk of chainAtks) {
            const id = atk.code || `${atk.attacker_id}_${atk.timestamp_ended}`;
            if (processedAtkIds.has(id)) continue;
            processedAtkIds.add(id);

            if (atk.timestamp_ended && atk.timestamp_ended > lastHitUnix) {
                lastHitUnix = atk.timestamp_ended;
            }

            if (processedAtkIds.size > 500) {
                const arr = [...processedAtkIds];
                processedAtkIds = new Set(arr.slice(arr.length - 250));
            }

            broadcastHitEvent({
                type: 'HIT_DETECTED',
                source: 'tier3_api',
                attackerId: atk.attacker_id,
                attackerName: atk.attacker_name,
                chain: atk.chain,
                timestamp: (atk.timestamp_ended || 0) * 1000
            });
        }
    }

    function pollBackendAttacks() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${SERVER_BASE}/api/chain/attacks`,
            headers: { 'x-api-key': apiKey || '' },
            timeout: 5000,
            onload(res) {
                try {
                    const d = JSON.parse(res.responseText);
                    if (d && d.attacks) processAttacks(d.attacks);
                } catch(e) {}
            },
            onerror() {}
        });
    }

    function pollBackendChainAndAttacks() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${SERVER_BASE}/api/chain/data`,
            timeout: 4000,
            onload(res) {
                try {
                    const d = JSON.parse(res.responseText);
                    if (d && d.chain) {
                        chainCount   = d.chain.current || 0;
                        chainTimeout = d.chain.timeout || 0;
                        chainActive  = chainCount > 0;
                    }
                } catch(e) {}
                renderChainBar();
            },
            onerror() {}
        });
        pollBackendAttacks();
    }

    function pollChainAndAttacks() {
        if (!apiKey) {
            pollBackendChainAndAttacks();
            return;
        }

        const cursorParam = lastHitUnix > 0 ? `&from=${lastHitUnix}` : '';

        if (hasAttacksAccess) {
            tornGet(`/faction/?selections=attacks,chain${cursorParam}`, (err, d) => {
                if (err) {
                    if (err.code === 16 || err.code === 7 || (err.error && /access|permission/i.test(err.error))) {
                        hasAttacksAccess = false;
                        tornGet('/faction/?selections=chain', (err2, d2) => {
                            if (!err2 && d2) handleChainResponse(d2);
                        });
                        pollBackendAttacks();
                    }
                    return;
                }
                if (!d) return;
                handleChainResponse(d);
            });
        } else {
            tornGet('/faction/?selections=chain', (err, d) => {
                if (!err && d) handleChainResponse(d);
            });
            pollBackendAttacks();
        }
    }

    function handleChainResponse(d) {
        const chain = d.chain || {};
        chainCount   = chain.current || 0;
        chainTimeout = chain.timeout || 0;
        chainActive  = chainCount > 0;

        if (d.attacks) {
            processAttacks(Object.values(d.attacks));
        } else {
            renderChainBar();
        }
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

    function fetchFactionMembers() {
        if (apiKey) {
            tornGet('/faction/?selections=basic', (err, d) => {
                if (err || !d || !d.members) {
                    fetchBackendMembers();
                    return;
                }
                handleMembersResponse(d);
            });
        } else {
            fetchBackendMembers();
        }
    }

    function fetchBackendMembers() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${SERVER_BASE}/api/chain/members`,
            headers: { 'x-api-key': apiKey || '' },
            timeout: 8000,
            onload(res) {
                try {
                    const d = JSON.parse(res.responseText);
                    if (d && d.members) handleMembersResponse(d);
                } catch(e) {}
            },
            onerror() {}
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  PERSISTENCE & STATE SYNC
    // ══════════════════════════════════════════════════════════════
    function save() {
        GM_setValue('sv_state', JSON.stringify({ lineup, targetHitTime, cycleNum, loopMode, autoMode, autoSendOnPost, soundEnabled }));
        GM_setValue('sv_autosend', autoSendOnPost);
        GM_setValue('sv_sound', soundEnabled);
        if (apiKey) syncToServer();

        // Broadcast updated lineup to other tabs
        if (broadcastChan) {
            try {
                broadcastChan.postMessage({ type: 'LINEUP_UPDATED', lineup, cycleNum });
            } catch(e) {}
        }
    }

    function load() {
        try {
            const raw = GM_getValue('sv_state', '{}');
            const d = JSON.parse(raw);
            if (d.lineup)                 lineup         = d.lineup;
            if (d.targetHitTime !== undefined) targetHitTime = d.targetHitTime;
            if (d.cycleNum)               cycleNum       = d.cycleNum;
            if (d.loopMode !== undefined) loopMode       = d.loopMode;
            if (d.autoMode !== undefined) autoMode       = d.autoMode;
            if (d.autoSendOnPost !== undefined) autoSendOnPost = d.autoSendOnPost;
            if (d.soundEnabled !== undefined) soundEnabled = d.soundEnabled;
        } catch(e) {}

        if (GM_getValue('sv_autosend', null) !== null) {
            autoSendOnPost = GM_getValue('sv_autosend', false);
        }

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
                url: `${SERVER_BASE}/api/chain/lineup`,
                headers: { 'Content-Type': 'application/json' },
                data: body,
                timeout: 3000,
                onerror: () => {}
            });
        } catch(e) {}
    }

    // ══════════════════════════════════════════════════════════════
    //  PLAYER READINESS
    // ══════════════════════════════════════════════════════════════
    function getMemberReadiness(id, name) {
        let st = id ? memberStatuses[String(id)] : null;
        if (!st && name && factionMembers.length) {
            const fm = factionMembers.find(m => m.name.toLowerCase() === name.toLowerCase());
            if (fm) {
                st = { online: fm.online, state: fm.state, until: fm.until || 0, lastActionTs: fm.lastActionTs || 0 };
            }
        }
        if (!st) {
            return {
                online: 'Online', state: 'Okay', isReady: true,
                statusText: 'ONLINE • READY',
                shortText: 'READY',
                dotColor: '#2ecc71',
                cls: 'st-ready'
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
                cls: 'st-hosp',
                hospMins
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
                shortText: 'READY',
                dotColor: '#2ecc71',
                cls: 'st-ready'
            };
        }

        if (online === 'Idle' && state === 'Okay') {
            return {
                online, state, isReady: true,
                statusText: 'IDLE • READY',
                shortText: 'IDLE',
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
        s.skipped = true;
        lineup.push(s);
        save();
        renderLineup();
        flashStatus(`Skipped ${s.name} (moved to bottom). Next UP: ${lineup[0] ? lineup[0].name : 'none'}`, false);
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
        save();
        renderLineup();
        flashStatus(`Advanced: ${s.name} moved to bottom.`, false);
    }

    function forceMarkHitAndRotate() {
        if (!lineup.length) return;
        const up = lineup[0];
        const prevName = up.name;
        const [hitter] = lineup.splice(0, 1);
        hitter.hit = true;
        lineup.push(hitter);
        cycleNum++;
        playSuccessChime();
        setUpdated(true);
        save();
        renderLineup();
        renderChainBar();
        const nextUp = lineup[0] ? lineup[0].name : 'Lineup Empty';
        flashStatus(`✅ Force Hit Confirmed! ${prevName} moved to bottom. Next UP: ${nextUp}`, false);
        if (autoSendOnPost) {
            setTimeout(() => postToChat(), 150);
        }
    }

    function resetHits() {
        lineup.forEach(m => { m.hit = false; m.skipped = false; });
        cycleNum = 1;
        save();
        renderLineup();
        flashStatus('Hit marks reset for new cycle.', false);
    }

    function clearAll() {
        if (!confirm('Remove all members from the queue?')) return;
        lineup = [];
        cycleNum = 1;
        save();
        renderLineup();
        flashStatus('Lineup cleared.', false);
    }

    function autoFill() {
        if (!factionMembers.length) {
            flashStatus('No faction members loaded. Click ↻ Refresh.', true);
            return;
        }

        const initialCount = lineup.length;
        lineup = lineup.filter(lm => {
            const mem = factionMembers.find(fm => (lm.id && fm.id === lm.id) || fm.name.toLowerCase() === lm.name.toLowerCase());
            if (!mem) {
                const st = lm.id ? memberStatuses[String(lm.id)] : null;
                if (!st) return false;
                return (st.state || 'Okay') === 'Okay' && ((st.online || 'Offline') === 'Online' || (st.online || 'Offline') === 'Idle');
            }
            return (mem.state || 'Okay') === 'Okay' && (mem.online === 'Online' || mem.online === 'Idle');
        });
        const purged = initialCount - lineup.length;

        for (const lm of lineup) {
            lm.hit = false;
            lm.skipped = false;
        }

        const capable = factionMembers.filter(m => {
            const state = m.state || 'Okay';
            const online = m.online || 'Offline';
            return state === 'Okay' && (online === 'Online' || online === 'Idle');
        });

        capable.sort((a, b) => {
            if (a.online === 'Online' && b.online !== 'Online') return -1;
            if (a.online !== 'Online' && b.online === 'Online') return 1;
            return (b.lastActionTs || 0) - (a.lastActionTs || 0);
        });

        let added = 0;
        for (const m of capable) {
            const exists = lineup.some(lm =>
                (lm.id && lm.id === m.id) ||
                lm.name.toLowerCase() === m.name.toLowerCase()
            );
            if (!exists) {
                lineup.push({ name: m.name, id: m.id, hit: false, skipped: false });
                added++;
            }
        }

        cycleNum = 1;
        save();
        renderLineup();
        flashStatus(`Auto-fill: Retained ${lineup.length - added}, added ${added} ready members.`, false);
    }

    // Interactive Action: Sort Ready members to top
    function sortReadyToTop() {
        if (lineup.length <= 1) return;
        const readyArr = [];
        const nonReadyArr = [];
        for (const m of lineup) {
            const r = getMemberReadiness(m.id, m.name);
            if (r.isReady) readyArr.push(m);
            else nonReadyArr.push(m);
        }
        lineup = [...readyArr, ...nonReadyArr];
        save();
        renderLineup();
        flashStatus(`✓ Sorted: ${readyArr.length} ready members moved to top of queue.`, false);
    }

    // Interactive Action: Auto-skip hospitalized members
    function autoSkipHospedMembers() {
        if (!lineup.length) return;
        let skippedCount = 0;
        const healthy = [];
        const hospitalized = [];

        for (const m of lineup) {
            const r = getMemberReadiness(m.id, m.name);
            if (r.state === 'Hospital') {
                m.skipped = true;
                hospitalized.push(m);
                skippedCount++;
            } else {
                healthy.push(m);
            }
        }

        if (!skippedCount) {
            flashStatus('✓ No queued members in hospital.', false);
            return;
        }

        lineup = [...healthy, ...hospitalized];
        showHospBanner = false;
        save();
        renderLineup();
        flashStatus(`✓ Auto-skipped ${skippedCount} hospitalized member(s) to bottom of queue.`, false);
    }

    // ══════════════════════════════════════════════════════════════
    //  TIMER & WATCHDOG
    // ══════════════════════════════════════════════════════════════
    function startLocalTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (chainActive && chainTimeout > 0) {
                chainTimeout--;

                // Audio warning at 1:00 threshold
                if (chainTimeout === 60 && !warnedAt60) {
                    warnedAt60 = true;
                    playPanicWarningBeep();
                } else if (chainTimeout > 65) {
                    warnedAt60 = false;
                }
            }
            renderChainBar();
            updateMinDisplay();
            checkAutoSkipWatchdog();
        }, 1000);
    }

    let lastAutoSkipTs = 0;
    function checkAutoSkipWatchdog() {
        if (!autoMode || !chainActive || !lineup.length) return;
        if (Date.now() - lastAutoSkipTs < 6000) return;

        const up = lineup[0];
        const readiness = getMemberReadiness(up.id, up.name);
        const targetSecs = parseTimeToSecs(targetHitTime) || 150;

        // Panic skip if timer reaches critical threshold (<= 35s)
        if (readiness.isReady) {
            if (chainTimeout > 0 && chainTimeout <= 35) {
                lastAutoSkipTs = Date.now();
                const [s] = lineup.splice(0, 1);
                s.skipped = true;
                lineup.push(s);
                save();
                renderLineup();
                flashStatus(`⚠️ Panic skip: ${s.name} missed hit window (timer at ${fmtSecs(chainTimeout)})!`, true);
            }
            return;
        }

        // Auto skip hospitalized/offline if in hit window
        if (!readiness.isReady) {
            if (chainTimeout > 0 && (chainTimeout <= targetSecs || chainTimeout <= 60)) {
                lastAutoSkipTs = Date.now();
                const [s] = lineup.splice(0, 1);
                s.skipped = true;
                lineup.push(s);
                save();
                renderLineup();
                flashStatus(`Auto-skipped ${s.name} (${readiness.shortText}) — hit window reached.`, false);
            }
        }
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

            if (autoSendOnPost) {
                setTimeout(() => {
                    const parentBox = target.closest('div[class*="chat-box"], [class*="chatBox"], [class*="dialogue"], [class*="chat"], form');
                    const sendBtn = parentBox ? parentBox.querySelector('button[type="submit"], [class*="send"], [class*="submit"], button[aria-label*="send" i], [class*="chat-box-button"]') : null;

                    if (sendBtn) {
                        sendBtn.click();
                    }

                    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                    target.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));

                    flashStatus('✓ Lineup posted & sent to Faction Chat!', false);
                }, 100);
            } else {
                flashStatus('✓ Lineup inserted — press Enter to send!', false);
            }
        }, 150);
    }

    function copyToClipboard(type) {
        const text = type === 'compact' ? _buildCompactText() : _buildFullText();
        if (!text) { flashStatus('Lineup is empty.', true); return; }
        navigator.clipboard.writeText(text).then(() => flashStatus('Copied to clipboard!', false)).catch(() => {
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
    //  RENDER: TOP 4 KPI METRICS TILES
    // ══════════════════════════════════════════════════════════════
    function renderChainBar() {
        const bar = document.getElementById('sv-chain-bar');
        if (!bar) return;

        const timerSecs = chainTimeout;
        const targetSecs = parseTimeToSecs(targetHitTime);
        const inWindow = targetHitTime && timerSecs > 0 && timerSecs <= targetSecs;

        // Color shifts:
        // > 2:30 (150s): Green
        // 1:30 - 2:30 (90s - 150s): Amber
        // < 1:30 (90s): Pulsing Red
        let timerColor = '#2ecc71';
        let timerClass = 'sv-timer-green';
        if (timerSecs > 0 && timerSecs <= 90) {
            timerColor = '#f85149';
            timerClass = 'sv-timer-pulse-red';
        } else if (timerSecs > 90 && timerSecs <= 150) {
            timerColor = '#e3b341';
            timerClass = 'sv-timer-amber';
        }

        const multiplier = getRespectMultiplier(chainCount);
        const nextBonus  = getNextBonus(chainCount);

        bar.innerHTML = `
            <div class="sv-stat-grid">
                <!-- 1. TIMER TILE -->
                <div class="sv-stat-box sv-stat-timer ${timerClass}" title="Live chain countdown timer">
                    <div class="sv-stat-num sv-timer-num" style="color:${timerColor};">${chainActive ? fmtSecs(timerSecs) : '0:00'}</div>
                    <div class="sv-stat-lbl">TIMER</div>
                </div>

                <!-- 2. CHAIN TILE -->
                <div class="sv-stat-box sv-stat-chain" title="Current chain length & respect multiplier">
                    <div class="sv-stat-num">${chainActive ? chainCount.toLocaleString() : '0'}</div>
                    <div class="sv-stat-lbl sv-chain-mult">${multiplier}</div>
                </div>

                <!-- 3. NEXT BONUS TILE -->
                <div class="sv-stat-box sv-stat-bonus" title="Hits remaining until next respect bonus milestone">
                    <div class="sv-stat-num sv-bonus-num">${nextBonus.text}</div>
                    <div class="sv-stat-lbl">NEXT BONUS</div>
                </div>

                <!-- 4. DISPATCH TARGET TILE -->
                <div class="sv-stat-box sv-stat-target ${inWindow ? 'sv-box-hit-now' : ''}" title="${inWindow ? 'Inside hit window — HIT NOW!' : 'Target hit timing threshold'}">
                    <div class="sv-stat-num ${inWindow ? 'sv-hit-now-txt' : ''}">${inWindow ? '🎯 HIT NOW' : (targetHitTime ? 'Hit at ' + targetHitTime : 'None')}</div>
                    <div class="sv-stat-lbl">DISPATCH TARGET</div>
                </div>
            </div>
        `;
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER: INTERACTIVE MEMBER STATUS FILTER CHIPS
    // ══════════════════════════════════════════════════════════════
    function renderLineupSummaryHtml() {
        if (!lineup.length) return '';

        let readyCount = 0;
        let onlineCount = 0;
        let idleCount = 0;
        let hospCount = 0;
        let offlineCount = 0;

        for (const m of lineup) {
            const r = getMemberReadiness(m.id, m.name);
            if (r.isReady) readyCount++;
            if (r.online === 'Online') onlineCount++;
            else if (r.online === 'Idle') idleCount++;
            else if (r.online === 'Offline') offlineCount++;
            if (r.state === 'Hospital') hospCount++;
        }

        let hospActionHtml = '';
        if (showHospBanner && hospCount > 0) {
            hospActionHtml = `
                <div class="sv-hosp-banner">
                    <span>🏥 <b>${hospCount}</b> member(s) currently in Hospital!</span>
                    <button class="sv-btn sv-btn-xs sv-btn-skip" data-action="auto-skip-hosp">⚡ Auto-Skip Hosped Members</button>
                </div>
            `;
        }

        return `
            <div class="sv-lineup-summary" title="Click chips to sort or manage readiness">
                <span class="sv-summary-chip sv-chip-ready" data-action="filter-ready" title="Click to sort ready members to top of queue">
                    <span class="sv-mini-dot sv-dot-green"></span>READY <b>${readyCount}</b>
                </span>
                <span class="sv-summary-chip sv-chip-online" title="Online members in lineup">
                    <span class="sv-mini-dot sv-dot-blue"></span>ONLINE <b>${onlineCount}</b>
                </span>
                <span class="sv-summary-chip sv-chip-idle" title="Idle members in lineup">
                    <span class="sv-mini-dot sv-dot-amber"></span>IDLE <b>${idleCount}</b>
                </span>
                <span class="sv-summary-chip sv-chip-hosp ${hospCount > 0 ? 'sv-chip-alert' : ''}" data-action="toggle-hosp-banner" title="Click to review & auto-skip hospitalized members">
                    <span class="sv-mini-dot sv-dot-red"></span>HOSP <b>${hospCount}</b>
                </span>
                <span class="sv-summary-chip sv-chip-off" title="Offline members in lineup">
                    <span class="sv-mini-dot sv-dot-gray"></span>OFFLINE <b>${offlineCount}</b>
                </span>
            </div>
            ${hospActionHtml}
        `;
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER: LINEUP QUEUE CARDS & STREAMLINED ROWS
    // ══════════════════════════════════════════════════════════════
    function renderLineup() {
        updateMinDisplay();

        const container = document.getElementById('sv-lineup-container');
        if (!container) return;

        if (!lineup.length) {
            container.innerHTML = `<div style="padding:16px 12px;text-align:center;color:#6e7681;font-size:11px;">Lineup is empty — click <b>⚡ Auto-Fill Ready</b> or search members below.</div>`;
            renderChainBar();
            return;
        }

        const targetSecs = parseTimeToSecs(targetHitTime);
        const inWindow   = targetHitTime && chainTimeout > 0 && chainTimeout <= targetSecs;

        let html = renderLineupSummaryHtml();

        // ── 1. CURRENTLY UP CARD (Position 0) ──
        const up = lineup[0];
        const rUp = getMemberReadiness(up.id, up.name);

        html += `
        <div class="sv-tier-card sv-up-card" draggable="true" data-idx="0">
            <div class="sv-tier-header">
                <div class="sv-badge-up-now">🎯 UP NOW</div>
                ${autoMode ? `<div class="sv-autoskip-txt" id="sv-autoskip-cd"></div>` : ''}
            </div>
            <div class="sv-tier-body">
                <div class="sv-player-row">
                    <span class="sv-drag-handle" title="Drag to reorder">⋮⋮</span>
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

                <!-- 1-Click Manual Override Button -->
                <div class="sv-up-primary-action">
                    <button class="sv-btn sv-btn-force-hit" data-action="force-hit" title="Manually confirm hit and rotate to next player">
                        ✅ Force Mark Hit & Rotate
                    </button>
                </div>

                <!-- Streamlined Sub-actions -->
                <div class="sv-tier-actions">
                    <div class="sv-actions-primary">
                        ${lineup.length > 1 ? `<button class="sv-btn sv-btn-xs" data-action="swap-top" title="Swap with Next player">⇄ Swap</button>` : ''}
                        ${lineup.length > 1 ? `<button class="sv-btn sv-btn-xs" data-action="move" data-from="0" data-to="1" title="Move down 1">▼ Down</button>` : ''}
                    </div>
                    <div class="sv-actions-secondary">
                        <button class="sv-btn sv-btn-xs sv-btn-skip" data-action="skip" data-idx="0" title="Skip this player (moves to bottom)">⏭ Skip</button>
                        <button class="sv-btn sv-btn-xs sv-btn-rm" data-action="remove" data-idx="0" title="Remove from queue">✕</button>
                    </div>
                </div>
            </div>
        </div>`;

        // ── 2. NEXT PLAYER CARD (Position 1) ──
        if (lineup.length >= 2) {
            const nx = lineup[1];
            const rNx = getMemberReadiness(nx.id, nx.name);

            html += `
            <div class="sv-tier-card sv-next-card" draggable="true" data-idx="1">
                <div class="sv-tier-header">
                    <div class="sv-tier-tag next-tag">NEXT</div>
                </div>
                <div class="sv-tier-body">
                    <div class="sv-player-row">
                        <span class="sv-drag-handle" title="Drag to reorder">⋮⋮</span>
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
                            <button class="sv-btn sv-btn-xs sv-btn-promote" data-action="make-current" data-idx="1" title="Promote to Currently Up">▲ Make Up</button>
                            <button class="sv-btn sv-btn-xs" data-action="swap-top" title="Swap with UP">⇄ Swap</button>
                            ${lineup.length > 2 ? `<button class="sv-btn sv-btn-xs" data-action="move" data-from="1" data-to="2" title="Move down 1">▼</button>` : ''}
                        </div>
                        <div class="sv-actions-secondary">
                            <button class="sv-btn sv-btn-xs sv-btn-skip" data-action="skip" data-idx="1" title="Skip this player">⏭ Skip</button>
                            <button class="sv-btn sv-btn-xs sv-btn-rm" data-action="remove" data-idx="1" title="Remove from queue">✕</button>
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
                const rM = getMemberReadiness(m.id, m.name);

                html += `
                <div class="sv-queue-row" draggable="true" data-idx="${i}">
                    <span class="sv-drag-handle" title="Drag to reorder">⋮⋮</span>
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
                        <button class="sv-btn sv-btn-xs" data-action="move" data-from="${i}" data-to="${i-1}" title="Move up 1 slot">▲</button>
                        <button class="sv-btn sv-btn-xs" data-action="move" data-from="${i}" data-to="${Math.min(lineup.length-1, i+1)}" title="Move down 1 slot">▼</button>
                        <button class="sv-btn sv-btn-xs sv-btn-skip" data-action="skip" data-idx="${i}" title="Skip to bottom of line">⏭ Skip</button>
                        <button class="sv-btn sv-btn-xs sv-btn-rm" data-action="remove" data-idx="${i}" title="Remove from queue">✕</button>
                    </div>
                </div>`;
            }
        }

        container.innerHTML = html;
        renderChainBar();
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER: COMPACT / MINIMIZED HUD BAR
    // ══════════════════════════════════════════════════════════════
    function updateMinDisplay() {
        const hud = document.getElementById('sv-chain-hud');
        if (!hud) return;

        const timerSecs = chainTimeout;
        let timerColor = '#2ecc71';
        let isPulsing = false;

        if (timerSecs > 0 && timerSecs <= 90) {
            timerColor = '#f85149';
            isPulsing = true;
        } else if (timerSecs > 90 && timerSecs <= 150) {
            timerColor = '#e3b341';
        }

        // Minimized Elements
        const minChain = document.getElementById('sv-min-chain');
        const minTimer = document.getElementById('sv-min-timer');
        const minUp    = document.getElementById('sv-min-up');

        if (minChain) {
            minChain.textContent = `⛓ ${chainActive ? chainCount : 0}`;
        }
        if (minTimer) {
            minTimer.textContent = `⏱ ${chainActive ? fmtSecs(timerSecs) : '0:00'}`;
            minTimer.style.color = timerColor;
            if (isPulsing) minTimer.classList.add('sv-min-pulse');
            else minTimer.classList.remove('sv-min-pulse');
        }
        if (minUp) {
            if (lineup.length > 0) {
                minUp.textContent = `🎯 UP: ${lineup[0].name}`;
                minUp.title = `Currently Up: ${lineup[0].name}${lineup.length > 1 ? ' | Next: ' + lineup[1].name : ''} (Click to copy)`;
                minUp.dataset.uid = lineup[0].id || '';
            } else {
                minUp.textContent = '🎯 UP: None';
                minUp.title = 'No lineup';
                minUp.dataset.uid = '';
            }
        }
    }

    function setUpdated(val) {
        isUpdated = val;
        const pill   = document.getElementById('sv-status-pill');
        const dot    = document.getElementById('sv-status-dot');
        const txt    = document.getElementById('sv-status-txt');
        const mainBtn= document.getElementById('sv-post-btn');
        const minBtn = document.getElementById('sv-min-post-btn');

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
    //  RENDER: SEARCH SUGGESTIONS
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
                const r = getMemberReadiness(m.id, m.name);
                let nameHtml = esc(m.name);
                if (val) {
                    nameHtml = nameHtml.replace(new RegExp(`(${escRe(val)})`, 'gi'), '<mark class="sv-mark">$1</mark>');
                }

                return `
                <div class="sv-suggest-item ${idx === suggestSelected ? 'sv-suggest-sel' : ''}"
                    data-action="add-suggest" data-name="${escAttr(m.name)}" data-id="${m.id}">
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

    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function escAttr(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/"/g,'&quot;').replace(/'/g,"&#39;"); }
    function escRe(s) { return s.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&'); }

    // ══════════════════════════════════════════════════════════════
    //  API KEY SETUP
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
                    if (d.members) handleMembersResponse(d);
                    scheduleAdaptivePoll();
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
    //  BUILD HUD DOM (EXPANDED & COMPACT HUD)
    // ══════════════════════════════════════════════════════════════
    function buildHUD() {
        const isMobile = window.innerWidth <= 600;
        let savedPos = GM_getValue(LS_KEY_POS, null);

        if (!savedPos) {
            savedPos = isMobile ? { top: 48, right: 6 } : { top: 80, right: 20 };
        } else {
            const hudEstWidth = isMobile ? 295 : 360;
            const maxRight = Math.max(4, window.innerWidth - hudEstWidth - 4);
            const maxTop = Math.max(4, window.innerHeight - 80);
            savedPos.right = Math.min(Math.max(4, savedPos.right || 0), maxRight);
            savedPos.top = Math.min(Math.max(4, savedPos.top || 0), maxTop);
        }

        const hud = document.createElement('div');
        hud.id = 'sv-chain-hud';
        if (isMinimized) hud.classList.add('sv-minimized');
        if (isHidden) hud.style.display = 'none';
        hud.style.top   = `${savedPos.top}px`;
        hud.style.right = `${savedPos.right}px`;

        hud.innerHTML = `
        <!-- HEADER / COMPACT BAR (IMAGE_2B460F.PNG UPGRADE) -->
        <div class="sv-header" id="sv-handle">
            <!-- Full Mode Title -->
            <div class="sv-title sv-full-only">
                <span class="sv-status-pill sv-same" id="sv-status-pill" title="Grey: Lineup unchanged | Green: Lineup updated">
                    <span class="sv-dot sv-dot-grey" id="sv-status-dot"></span>
                    <span id="sv-status-txt">SAME</span>
                </span>
                <span class="sv-title-text">⛓ FactionOS Chain Manager</span>
            </div>

            <!-- Redesigned Compact Bar Elements [ ⛓ 34 ] [ ⏱ 04:57 ] [ 🎯 UP: Djappe ] [ 📋 Post ] [ ⏭ Next ] [ 🗖 ] [ ✕ ] -->
            <div class="sv-min-bar-content sv-min-only">
                <span class="sv-min-badge sv-min-chain-badge" id="sv-min-chain" title="Current Chain Count">⛓ 0</span>
                <span class="sv-min-badge sv-min-timer-badge" id="sv-min-timer" title="Time Remaining on Chain">⏱ 0:00</span>
                <span class="sv-min-up-pill" id="sv-min-up" title="Currently Up (Click to copy)">🎯 UP: None</span>
                <button class="sv-min-action-btn sv-min-post-btn" id="sv-min-post-btn" title="Post Lineup to Faction Chat">📋 Post</button>
                <button class="sv-min-action-btn sv-min-next-btn" id="sv-min-next-btn" title="Advance to Next Player">⏭ Next</button>
            </div>

            <!-- Window Controls -->
            <div class="sv-hdr-controls">
                <button class="sv-ctrl-btn" id="sv-min-btn" title="Minimize / Expand overlay">${isMinimized ? '🗖' : '─'}</button>
                <button class="sv-ctrl-btn" id="sv-close-btn" title="Close overlay">✕</button>
            </div>
        </div>

        <!-- FULL BODY -->
        <div class="sv-body" id="sv-body">

            <!-- 1. TOP 4 KPI METRICS TILES -->
            <div id="sv-chain-bar" class="sv-chain-bar"></div>

            <!-- 2. RESTRUCTURED CONTROL BAR 1: TIMING & DISPATCH -->
            <div class="sv-ctrl-bar sv-ctrl-bar-1">
                <div class="sv-timing-wrap" title="Target chain timer threshold to hit">
                    <span class="sv-ctrl-icon">⏱️</span>
                    <span class="sv-ctrl-label">Hit at:</span>
                    <select id="sv-hit-time-sel" class="sv-select-timing">
                        <option value="">None</option>
                        <option value="3:30">3:30</option>
                        <option value="3:00">3:00</option>
                        <option value="2:30">2:30</option>
                        <option value="2:00">2:00</option>
                        <option value="1:30">1:30</option>
                        <option value="1:00">1:00</option>
                        <option value="custom">Custom…</option>
                    </select>
                    <input id="sv-hit-time-custom" class="sv-input-sm" type="text" placeholder="2:15" style="display:none;width:42px;" />
                </div>
                <div class="sv-dispatch-wrap">
                    <button class="sv-btn sv-btn-dispatch" id="sv-post-btn" title="Insert formatted lineup into Faction Chat">📋 Post Chat</button>
                    <button class="sv-btn sv-btn-icon-copy" id="sv-copy-btn" title="Copy full lineup (Shift-click for compact)">📋 Copy</button>
                </div>
            </div>

            <!-- 3. RESTRUCTURED CONTROL BAR 2: AUTOMATION & QUEUE ACTIONS -->
            <div class="sv-ctrl-bar sv-ctrl-bar-2">
                <div class="sv-pill-group">
                    <button class="sv-toggle-pill ${loopMode ? 'sv-pill-on' : ''}" id="sv-pill-loop" title="Toggle Loop (rotate hitters to bottom)">
                        🔄 Loop: <span class="sv-pill-status">${loopMode ? 'ON' : 'OFF'}</span>
                    </button>
                    <button class="sv-toggle-pill ${autoMode ? 'sv-pill-on' : ''}" id="sv-pill-auto" title="Toggle Auto-Advance (instant rotation on confirmed hit)">
                        ⚡ Auto: <span class="sv-pill-status">${autoMode ? 'ON' : 'OFF'}</span>
                    </button>
                    <button class="sv-toggle-pill ${autoSendOnPost ? 'sv-pill-on' : ''}" id="sv-pill-autosend" title="Toggle Auto-Send (immediately send message when Post Chat is clicked)">
                        💬 Auto-Send: <span class="sv-pill-status">${autoSendOnPost ? 'ON' : 'OFF'}</span>
                    </button>
                </div>
                <div class="sv-queue-actions-group">
                    <button class="sv-btn sv-btn-xs" id="sv-next-btn" title="Advance to next chainer">⏭ Next</button>
                    <span class="sv-action-dot">•</span>
                    <button class="sv-btn sv-btn-xs" id="sv-reset-btn" title="Clear all hit marks for new cycle">🔄 Reset Hits</button>
                    <span class="sv-action-dot">•</span>
                    <button class="sv-btn sv-btn-xs sv-btn-danger" id="sv-clear-btn" title="Clear entire queue">🗑️ Clear</button>
                </div>
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
                <div style="width:100%;font-size:10px;color:#e3b341;font-weight:700;">🔑 Torn API Key (Faction / Limited / Minimal)</div>
                <input id="sv-apikey-input" class="sv-input-sm" type="password" placeholder="Paste your Torn API key here…" value="${escAttr(apiKey)}" style="flex:1;min-width:0;" />
                <button class="sv-btn sv-btn-green" id="sv-apikey-save-btn">Save Key</button>
            </div>

        </div>
        `;

        document.body.appendChild(hud);
        _syncHitTimeUI();
        renderLineup();
        renderChainBar();
        updateMinDisplay();
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

        function startDrag(clientX, clientY, target) {
            if (target.closest('.sv-hdr-controls') || target.closest('.sv-min-action-btn') || target.closest('.sv-min-up-pill')) return;
            dragging = true;
            sx = clientX; sy = clientY;
            const r = hud.getBoundingClientRect();
            il = r.left; it = r.top;
            hud.style.right = 'auto';
            hud.style.left  = `${il}px`;
            hud.style.top   = `${it}px`;
            document.body.style.userSelect = 'none';
        }

        function moveDrag(clientX, clientY) {
            if (!dragging) return;
            const pad = 4;
            const maxL = Math.max(pad, window.innerWidth - hud.offsetWidth - pad);
            const maxT = Math.max(pad, window.innerHeight - hud.offsetHeight - pad);
            const nl = Math.max(pad, Math.min(maxL, il + (clientX - sx)));
            const nt = Math.max(pad, Math.min(maxT, it + (clientY - sy)));
            hud.style.left = `${nl}px`;
            hud.style.top  = `${nt}px`;
        }

        function endDrag() {
            if (!dragging) return;
            dragging = false;
            document.body.style.userSelect = '';
            const r = hud.getBoundingClientRect();
            GM_setValue(LS_KEY_POS, { top: Math.round(r.top), right: Math.max(0, Math.round(window.innerWidth - r.right)) });
        }

        handle.addEventListener('mousedown', e => startDrag(e.clientX, e.clientY, e.target));
        window.addEventListener('mousemove', e => moveDrag(e.clientX, e.clientY));
        window.addEventListener('mouseup', endDrag);

        handle.addEventListener('touchstart', e => {
            if (e.touches && e.touches.length === 1) {
                startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target);
            }
        }, { passive: true });

        window.addEventListener('touchmove', e => {
            if (dragging && e.touches && e.touches.length === 1) {
                if (e.cancelable) e.preventDefault();
                moveDrag(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: false });

        window.addEventListener('touchend', endDrag);
        window.addEventListener('touchcancel', endDrag);

        // Header minimize & close buttons
        document.getElementById('sv-min-btn').addEventListener('click', () => {
            isMinimized = !isMinimized;
            hud.classList.toggle('sv-minimized', isMinimized);
            document.getElementById('sv-min-btn').textContent = isMinimized ? '🗖' : '─';
            updateMinDisplay();
            GM_setValue('sv_min', isMinimized);
        });

        document.getElementById('sv-close-btn').addEventListener('click', () => {
            hud.style.display = 'none';
            isHidden = true;
            GM_setValue('sv_hidden', true);
        });

        // Minimized HUD quick actions
        document.getElementById('sv-min-post-btn').addEventListener('click', postToChat);
        document.getElementById('sv-min-next-btn').addEventListener('click', nextTurn);

        // Click on UP name in minimized bar (copies callout or opens profile)
        const minUpEl = document.getElementById('sv-min-up');
        if (minUpEl) {
            minUpEl.addEventListener('click', (e) => {
                if (e.ctrlKey || e.metaKey || e.altKey) {
                    const uid = minUpEl.dataset.uid;
                    if (uid) window.open(`https://www.torn.com/profiles.php?XID=${uid}`, '_blank');
                } else {
                    copyToClipboard('full');
                }
            });
        }

        // Control Bar 1: Post & Copy
        document.getElementById('sv-post-btn').addEventListener('click', postToChat);
        document.getElementById('sv-copy-btn').addEventListener('click', (e) => {
            if (e.shiftKey || e.altKey) copyToClipboard('compact');
            else copyToClipboard('full');
        });

        // Control Bar 2: Segmented Toggle Pills
        const pillLoop = document.getElementById('sv-pill-loop');
        pillLoop.addEventListener('click', () => {
            loopMode = !loopMode;
            pillLoop.classList.toggle('sv-pill-on', loopMode);
            pillLoop.querySelector('.sv-pill-status').textContent = loopMode ? 'ON' : 'OFF';
            save();
            flashStatus(`Loop Mode: ${loopMode ? 'ON (Hitter rotates to bottom)' : 'OFF'}`, false);
        });

        const pillAuto = document.getElementById('sv-pill-auto');
        pillAuto.addEventListener('click', () => {
            autoMode = !autoMode;
            pillAuto.classList.toggle('sv-pill-on', autoMode);
            pillAuto.querySelector('.sv-pill-status').textContent = autoMode ? 'ON' : 'OFF';
            save();
            renderLineup();
            flashStatus(`Auto-Advance: ${autoMode ? 'ON' : 'OFF'}`, false);
        });

        const pillAutoSend = document.getElementById('sv-pill-autosend');
        pillAutoSend.addEventListener('click', () => {
            autoSendOnPost = !autoSendOnPost;
            pillAutoSend.classList.toggle('sv-pill-on', autoSendOnPost);
            pillAutoSend.querySelector('.sv-pill-status').textContent = autoSendOnPost ? 'ON' : 'OFF';
            save();
            flashStatus(`Auto-Send: ${autoSendOnPost ? 'ON (Callouts dispatch immediately)' : 'OFF'}`, false);
        });

        // Control Bar 2: Queue Actions
        document.getElementById('sv-next-btn').addEventListener('click', nextTurn);
        document.getElementById('sv-reset-btn').addEventListener('click', resetHits);
        document.getElementById('sv-clear-btn').addEventListener('click', clearAll);

        // Hit time selector
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

        // Quick bottom buttons
        document.getElementById('sv-autofill-btn').addEventListener('click', autoFill);
        document.getElementById('sv-refresh-btn').addEventListener('click', () => {
            if (!apiKey) { flashStatus('Enter an API key first.', true); return; }
            flashStatus('Refreshing member list from Torn…', false);
            fetchFactionMembers();
        });

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

        const saveKeyBtn = document.getElementById('sv-apikey-save-btn');
        if (saveKeyBtn) saveKeyBtn.addEventListener('click', saveApiKey);

        const apiKeyInput = document.getElementById('sv-apikey-input');
        if (apiKeyInput) {
            apiKeyInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') saveApiKey();
            });
        }

        // Add member input
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

        document.addEventListener('click', e => {
            if (!e.target.closest('.sv-add-row')) {
                if (suggestBox) suggestBox.style.display = 'none';
            }
        });

        // Event delegation for cards, queue rows, interactive chips & force hit
        hud.addEventListener('click', e => {
            // Suggestion click
            const suggestItem = e.target.closest('[data-action="add-suggest"]');
            if (suggestItem) {
                const name = suggestItem.dataset.name;
                const id = parseInt(suggestItem.dataset.id, 10) || null;
                addFromSuggest(name, id);
                return;
            }

            // Interactive Summary Chip Clicks
            if (e.target.closest('[data-action="filter-ready"]')) {
                sortReadyToTop();
                return;
            }
            if (e.target.closest('[data-action="toggle-hosp-banner"]')) {
                showHospBanner = !showHospBanner;
                renderLineup();
                return;
            }
            if (e.target.closest('[data-action="auto-skip-hosp"]')) {
                autoSkipHospedMembers();
                return;
            }

            // Force Hit button
            if (e.target.closest('[data-action="force-hit"]')) {
                forceMarkHitAndRotate();
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

        // Drag and drop reordering
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
    //  PROFESSIONAL DARK CSS STYLES
    // ══════════════════════════════════════════════════════════════
    const css = `
    #sv-chain-hud {
        position: fixed;
        z-index: 99999999;
        width: 360px;
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
        transition: border-color 0.25s, box-shadow 0.25s, width 0.2s;
    }

    /* Minimized Compact Bar Mode */
    #sv-chain-hud.sv-minimized {
        width: auto;
        max-width: 540px;
        border-radius: 24px;
        max-height: none;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(46, 204, 113, 0.3);
    }
    #sv-chain-hud.sv-minimized .sv-body { display: none; }
    #sv-chain-hud.sv-minimized .sv-full-only { display: none !important; }
    #sv-chain-hud.sv-minimized .sv-min-only { display: flex !important; }
    #sv-chain-hud.sv-minimized .sv-header {
        border-radius: 24px;
        border-bottom: none;
        padding: 5px 10px;
        gap: 6px;
    }

    /* Header */
    .sv-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 7px 10px;
        background: rgba(22, 27, 34, 0.95);
        border-bottom: 1px solid rgba(48, 54, 61, 0.8);
        cursor: move;
        flex-shrink: 0;
        gap: 8px;
    }
    .sv-title { display: flex; align-items: center; gap: 6px; overflow: hidden; }
    .sv-title-text { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #f0f6fc; white-space: nowrap; }
    .sv-hdr-controls { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

    /* Redesigned Minimized Bar Items */
    .sv-min-only { display: none; }
    .sv-min-bar-content {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        overflow: hidden;
    }
    .sv-min-badge {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: 11px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 12px;
        white-space: nowrap;
    }
    .sv-min-chain-badge {
        background: rgba(56, 139, 253, 0.15);
        color: #58a6ff;
        border: 1px solid rgba(56, 139, 253, 0.35);
    }
    .sv-min-timer-badge {
        background: rgba(13, 17, 23, 0.9);
        border: 1px solid rgba(48, 54, 61, 0.8);
    }
    .sv-min-pulse {
        animation: svTimerPulse 0.9s infinite !important;
        background: rgba(248, 81, 73, 0.16) !important;
        border-color: rgba(248, 81, 73, 0.6) !important;
    }
    .sv-min-up-pill {
        font-size: 11px;
        font-weight: 800;
        color: #f0f6fc;
        background: rgba(35, 134, 54, 0.18);
        border: 1px solid rgba(46, 204, 113, 0.4);
        padding: 2px 8px;
        border-radius: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 140px;
        cursor: pointer;
    }
    .sv-min-up-pill:hover { background: rgba(35, 134, 54, 0.3); }
    .sv-min-action-btn {
        background: rgba(33, 38, 45, 0.9);
        border: 1px solid rgba(48, 54, 61, 0.85);
        color: #c9d1d9;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s;
    }
    .sv-min-post-btn {
        background: linear-gradient(135deg, #238636, #2ea043);
        color: #fff;
        border: none;
    }
    .sv-min-post-btn:hover { background: #2ea043; }
    .sv-min-next-btn:hover { background: rgba(56, 139, 253, 0.2); color: #58a6ff; }

    /* Status Pill */
    .sv-status-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: 800; letter-spacing: 0.5px; cursor: default; }
    .sv-updated { background: rgba(46, 204, 113, 0.16); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.4); }
    .sv-same    { background: rgba(110, 118, 129, 0.15); color: #8b949e; border: 1px solid rgba(110, 118, 129, 0.3); }
    .sv-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
    .sv-dot-green { background: #2ecc71; box-shadow: 0 0 6px #2ecc71; animation: svDotPulse 1.3s infinite; }
    .sv-dot-grey  { background: #8b949e; box-shadow: none; }
    @keyframes svDotPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.25);opacity:.7} }

    .sv-ctrl-btn { background: transparent; border: none; color: #8b949e; cursor: pointer; padding: 2px 4px; font-size: 11px; border-radius: 4px; }
    .sv-ctrl-btn:hover { color: #f0f6fc; background: rgba(255, 255, 255, 0.08); }

    .sv-body { overflow-y: auto; flex: 1; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.1) transparent; }
    .sv-body::-webkit-scrollbar { width: 4px; }
    .sv-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 2px; }

    /* ══════════════════════════════════════════════════════════════
       1. TOP 4 KPI METRICS TILES
       ══════════════════════════════════════════════════════════════ */
    .sv-chain-bar { padding: 8px 10px; background: rgba(18, 22, 29, 0.8); border-bottom: 1px solid rgba(48, 54, 61, 0.6); }
    .sv-stat-grid { display: grid; grid-template-columns: 1.25fr 1fr 1.15fr 1.15fr; gap: 6px; align-items: stretch; }
    .sv-stat-box {
        background: rgba(22, 27, 34, 0.7); border: 1px solid rgba(48, 54, 61, 0.6);
        border-radius: 6px; padding: 4px 6px; display: flex; flex-direction: column;
        justify-content: center; align-items: center; text-align: center;
        transition: all 0.2s ease;
    }
    .sv-stat-num { font-size: 14px; font-weight: 800; color: #f0f6fc; line-height: 1.1; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .sv-stat-lbl { font-size: 8px; font-weight: 700; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; line-height: 1; }

    /* Timer Tile Visual Priority */
    .sv-stat-timer { background: rgba(13, 17, 23, 0.9); border-color: rgba(56, 139, 253, 0.3); }
    .sv-timer-num { font-size: 20px; font-weight: 900; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; letter-spacing: 0.5px; }
    .sv-timer-pulse-red {
        border-color: rgba(248, 81, 73, 0.65) !important;
        background: rgba(248, 81, 73, 0.12) !important;
        animation: svTimerPulse 0.9s infinite;
    }
    @keyframes svTimerPulse { 0%,100%{box-shadow:inset 0 0 8px rgba(248, 81, 73, 0.2)} 50%{box-shadow:inset 0 0 16px rgba(248, 81, 73, 0.5)} }

    .sv-chain-mult { color: #58a6ff; font-weight: 800; }
    .sv-bonus-num { color: #f0f6fc; font-size: 12.5px; font-weight: 800; }

    .sv-stat-target { border-color: rgba(48, 54, 61, 0.7); }
    .sv-box-hit-now { background: rgba(46, 204, 113, 0.12); border-color: rgba(46, 204, 113, 0.5); }
    .sv-hit-now-txt { color: #2ecc71 !important; font-weight: 900; animation: svGlowText 1s infinite; }
    @keyframes svGlowText { 0%,100%{text-shadow:0 0 4px #2ecc71} 50%{text-shadow:0 0 10px #2ecc71} }

    /* ══════════════════════════════════════════════════════════════
       2. RESTRUCTURED 2-BAR CONTROL BAR
       ══════════════════════════════════════════════════════════════ */
    .sv-ctrl-bar { padding: 6px 10px; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .sv-ctrl-bar-1 { border-bottom: 1px solid rgba(48, 54, 61, 0.35); background: rgba(22, 27, 34, 0.5); }
    .sv-ctrl-bar-2 { border-bottom: 1px solid rgba(48, 54, 61, 0.5); background: rgba(18, 22, 29, 0.7); flex-wrap: wrap; }

    .sv-timing-wrap { display: flex; align-items: center; gap: 4px; }
    .sv-ctrl-icon { font-size: 12px; }
    .sv-ctrl-label { font-size: 10px; color: #8b949e; font-weight: 700; white-space: nowrap; }
    .sv-select-timing {
        background: #161b22; border: 1px solid rgba(48, 54, 61, 0.9); color: #c9d1d9;
        padding: 3px 6px; border-radius: 4px; font-size: 10.5px; font-weight: 700; outline: none;
    }
    .sv-dispatch-wrap { display: flex; align-items: center; gap: 4px; }
    .sv-btn-dispatch {
        background: linear-gradient(135deg, #238636, #2ea043) !important; color: #fff !important;
        font-weight: 800 !important; padding: 4px 10px !important; border: none !important;
        box-shadow: 0 0 10px rgba(46, 204, 113, 0.3);
    }
    .sv-btn-dispatch:hover { background: #2ea043 !important; }
    .sv-btn-icon-copy { padding: 4px 8px !important; }

    /* Control Bar 2: Segmented Pills */
    .sv-pill-group { display: flex; align-items: center; gap: 4px; }
    .sv-toggle-pill {
        background: rgba(33, 38, 45, 0.9);
        border: 1px solid rgba(48, 54, 61, 0.8);
        color: #8b949e;
        padding: 2px 6px;
        border-radius: 12px;
        font-size: 9.5px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;
    }
    .sv-toggle-pill:hover { color: #f0f6fc; border-color: rgba(110, 118, 129, 0.6); }
    .sv-pill-on {
        background: rgba(46, 204, 113, 0.15);
        border-color: rgba(46, 204, 113, 0.45);
        color: #2ecc71;
    }
    .sv-pill-status { font-weight: 900; }
    .sv-pill-on .sv-pill-status { color: #3ee083; }

    .sv-queue-actions-group { display: flex; align-items: center; gap: 3px; }
    .sv-action-dot { color: #484f58; font-size: 9px; }

    /* Button System */
    .sv-btn {
        background: rgba(33, 38, 45, 0.85); border: 1px solid rgba(48, 54, 61, 0.85); color: #c9d1d9;
        padding: 3px 7px; border-radius: 4px; font-size: 10.5px; font-weight: 700; cursor: pointer;
        transition: all 0.12s; white-space: nowrap; line-height: 1.2;
    }
    .sv-btn:hover { background: rgba(48, 54, 61, 0.9); color: #f0f6fc; }
    .sv-btn-xs { font-size: 9.5px; padding: 2px 6px; border-radius: 4px; }
    .sv-btn-green { background: rgba(35, 134, 54, 0.25); border-color: rgba(46, 204, 113, 0.45); color: #2ecc71; }
    .sv-btn-danger { background: rgba(218, 54, 51, 0.15); border-color: rgba(248, 81, 73, 0.35); color: #f85149; }
    .sv-btn-danger:hover { background: rgba(218, 54, 51, 0.28); }
    .sv-btn-skip { background: rgba(227, 179, 65, 0.12); border-color: rgba(227, 179, 65, 0.35); color: #e3b341; }
    .sv-btn-skip:hover { background: rgba(227, 179, 65, 0.22); }
    .sv-btn-rm { background: rgba(218, 54, 51, 0.1); border-color: rgba(248, 81, 73, 0.25); color: #f85149; }
    .sv-btn-rm:hover { background: rgba(218, 54, 51, 0.25); }
    .sv-btn-primary { background: rgba(56, 139, 253, 0.18); border-color: rgba(56, 139, 253, 0.4); color: #58a6ff; }
    .sv-btn-primary:hover { background: rgba(56, 139, 253, 0.3); color: #79c0ff; }
    .sv-btn-promote { background: rgba(56, 139, 253, 0.16); border-color: rgba(56, 139, 253, 0.4); color: #58a6ff; }
    .sv-btn-muted { color: #8b949e; font-weight: 600; }

    .sv-status-bar { padding: 2px 10px; min-height: 16px; font-size: 10px; }

    /* ══════════════════════════════════════════════════════════════
       3. INTERACTIVE SUMMARY CHIPS & HOSP BANNER
       ══════════════════════════════════════════════════════════════ */
    .sv-lineup-summary {
        display: flex; gap: 4px; padding: 4px 10px 6px; overflow-x: auto;
        border-bottom: 1px solid rgba(48, 54, 61, 0.3); margin-bottom: 4px;
    }
    .sv-summary-chip {
        display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px;
        background: rgba(22, 27, 34, 0.7); border: 1px solid rgba(48, 54, 61, 0.5);
        border-radius: 4px; font-size: 9px; font-weight: 700; color: #8b949e; white-space: nowrap;
        cursor: pointer; transition: all 0.15s;
    }
    .sv-summary-chip:hover { border-color: rgba(110, 118, 129, 0.8); color: #f0f6fc; }
    .sv-summary-chip b { color: #f0f6fc; }
    .sv-chip-alert { border-color: rgba(248, 81, 73, 0.4); color: #f85149; }
    .sv-mini-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .sv-dot-green { background: #2ecc71; }
    .sv-dot-blue  { background: #58a6ff; }
    .sv-dot-amber { background: #e3b341; }
    .sv-dot-red   { background: #f85149; }
    .sv-dot-gray  { background: #718096; }

    .sv-hosp-banner {
        display: flex; align-items: center; justify-content: space-between;
        margin: 2px 10px 6px; padding: 4px 8px; border-radius: 5px;
        background: rgba(218, 54, 51, 0.12); border: 1px solid rgba(248, 81, 73, 0.35);
        color: #f85149; font-size: 9.5px; font-weight: 700;
    }

    /* ══════════════════════════════════════════════════════════════
       4. CURRENTLY UP CARD & QUEUE ROWS
       ══════════════════════════════════════════════════════════════ */
    .sv-tier-card {
        margin: 4px 10px; border-radius: 6px; border: 1px solid rgba(48, 54, 61, 0.8);
        background: rgba(22, 27, 34, 0.85); overflow: hidden;
        transition: border-color 0.2s; cursor: grab;
    }
    .sv-up-card {
        background: rgba(35, 134, 54, 0.12);
        border: 1.5px solid #2ecc71;
        box-shadow: 0 0 14px rgba(46, 204, 113, 0.4), inset 0 0 8px rgba(46, 204, 113, 0.08);
    }
    .sv-next-card { background: rgba(56, 139, 253, 0.06); border-color: rgba(56, 139, 253, 0.35); }
    .sv-tier-card.sv-drag-over { border-color: #2ecc71; box-shadow: 0 0 0 1px rgba(46, 204, 113, 0.4); }
    .sv-tier-card.sv-dragging { opacity: 0.5; }

    .sv-tier-header { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 2px; }
    .sv-badge-up-now {
        font-size: 9.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px;
        color: #2ecc71; background: rgba(46, 204, 113, 0.18); padding: 1px 6px; border-radius: 4px;
        animation: svGlowBadge 1.2s infinite;
    }
    @keyframes svGlowBadge { 0%,100%{box-shadow:0 0 4px rgba(46, 204, 113, 0.4)} 50%{box-shadow:0 0 10px rgba(46, 204, 113, 0.8)} }
    .next-tag { font-size: 9px; font-weight: 800; color: #58a6ff; text-transform: uppercase; }

    .sv-tier-body { padding: 4px 8px 6px; }
    .sv-player-row { display: flex; align-items: center; gap: 6px; }
    .sv-drag-handle {
        color: #6e7681; font-size: 13px; cursor: grab; padding: 0 2px; line-height: 1; opacity: 0.6; transition: opacity 0.15s;
    }
    .sv-drag-handle:hover { opacity: 1; color: #c9d1d9; }
    .sv-pos-num {
        display: inline-flex; align-items: center; justify-content: center;
        width: 18px; height: 18px; border-radius: 50%; font-size: 9.5px;
        font-weight: 800; color: #8b949e; background: rgba(255, 255, 255, 0.06);
        flex-shrink: 0; cursor: pointer;
    }
    .sv-pos-up { background: rgba(46, 204, 113, 0.22); color: #2ecc71; }
    .sv-pos-next { background: rgba(56, 139, 253, 0.15); color: #58a6ff; }
    .sv-player-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .sv-player-name-row { display: flex; align-items: center; gap: 5px; }
    .sv-player-name { font-size: 13px; font-weight: 800; color: #f0f6fc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-hit-tag { font-size: 9px; font-weight: 800; color: #2ecc71; background: rgba(46, 204, 113, 0.15); padding: 1px 4px; border-radius: 3px; }
    .sv-hit-tag-sm { font-size: 9px; font-weight: 800; color: #2ecc71; }

    .sv-readiness-row { display: flex; align-items: center; gap: 4px; font-size: 9.5px; font-weight: 700; }
    .st-ready   { color: #2ecc71; }
    .st-idle    { color: #e3b341; }
    .st-offline { color: #8b949e; }
    .st-hosp    { color: #f85149; }
    .st-travel  { color: #58a6ff; }
    .st-jail    { color: #f85149; }
    .sv-readiness-txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .sv-hit-now-badge {
        font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 4px;
        background: rgba(46, 204, 113, 0.22); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.5);
        animation: svGlowText 1s infinite; white-space: nowrap;
    }

    .sv-up-primary-action { margin-top: 5px; }
    .sv-btn-force-hit {
        width: 100%;
        background: linear-gradient(135deg, rgba(35, 134, 54, 0.8), rgba(46, 204, 113, 0.85));
        border: 1px solid #2ecc71;
        color: #fff;
        font-weight: 800;
        font-size: 10.5px;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s;
    }
    .sv-btn-force-hit:hover {
        background: #2ea043;
        box-shadow: 0 0 10px rgba(46, 204, 113, 0.5);
    }

    .sv-tier-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; gap: 4px; }
    .sv-actions-primary { display: flex; gap: 3px; }
    .sv-actions-secondary { display: flex; gap: 3px; }

    /* Queue Rows */
    .sv-queue-header { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #8b949e; padding: 6px 10px 2px; }
    .sv-queue-row {
        display: flex; align-items: center; gap: 5px; padding: 4px 10px;
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

    .sv-suggest {
        position: absolute; bottom: calc(100% + 4px); left: 10px; right: 10px;
        background: #0d1117; border: 1px solid rgba(48, 54, 61, 0.9);
        border-radius: 6px; max-height: 220px; overflow-y: auto; z-index: 100000000;
        box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.85);
    }
    .sv-suggest-hdr { padding: 4px 8px; font-size: 8.5px; font-weight: 800; text-transform: uppercase; color: #8b949e; letter-spacing: 0.5px; border-bottom: 1px solid rgba(48, 54, 61, 0.4); }
    .sv-suggest-item {
        display: flex; align-items: center; justify-content: space-between;
        padding: 5px 8px; cursor: pointer; border-bottom: 1px solid rgba(48, 54, 61, 0.2);
    }
    .sv-suggest-item:hover, .sv-suggest-sel { background: rgba(56, 139, 253, 0.15); }
    .sv-suggest-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .sv-suggest-name { font-size: 11.5px; font-weight: 700; color: #f0f6fc; }
    .sv-suggest-status { display: flex; align-items: center; gap: 3px; font-size: 9px; font-weight: 700; }
    .sv-suggest-add-badge { font-size: 9px; font-weight: 700; color: #2ecc71; padding: 1px 4px; border: 1px solid rgba(46, 204, 113, 0.3); border-radius: 3px; margin-left: 6px; }
    .sv-mark { background: rgba(46, 204, 113, 0.25); color: #2ecc71; border-radius: 2px; padding: 0 1px; }

    .sv-quick-row { display: flex; gap: 4px; padding: 4px 10px 8px; align-items: center; }
    .sv-apikey-row {
        display: flex; align-items: center; gap: 5px; padding: 6px 10px 8px;
        background: rgba(227, 179, 65, 0.06); border-top: 1px solid rgba(227, 179, 65, 0.2);
        flex-wrap: wrap;
    }

    /* ══════════════════════════════════════════════════════════════
       MOBILE RESPONSIVENESS (< 600px)
       ══════════════════════════════════════════════════════════════ */
    @media (max-width: 600px) {
        #sv-chain-hud { width: min(310px, calc(100vw - 12px)); max-height: 80vh; }
        #sv-chain-hud.sv-minimized { max-width: 270px; }
        .sv-min-up-pill { max-width: 80px; font-size: 9.5px; }
        .sv-min-badge { font-size: 9.5px; padding: 1px 5px; }
        .sv-stat-num { font-size: 11px; }
        .sv-timer-num { font-size: 16px; }
        .sv-stat-lbl { font-size: 7px; }
        .sv-toggle-pill { font-size: 8.5px; padding: 1px 4px; }
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
    //  INITIALIZATION & BOOT
    // ══════════════════════════════════════════════════════════════
    // Initialize Tier 1 & Tier 2 observers across all pages
    initTier1AttackObserver();
    initTier1HeaderDOMObserver();
    initTier2WebSocketSniffer();

    load();
    const hud = buildHUD();
    wireEvents(hud);
    setUpdated(false);
    startLocalTimer();
    scheduleAdaptivePoll();
    fetchFactionMembers();

    // Fetch initial queue from FactionOS server if local queue is empty
    if (!lineup.length) {
        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${SERVER_BASE}/api/chain/lineup`,
                timeout: 4000,
                onload(res) {
                    try {
                        const d = JSON.parse(res.responseText);
                        if (d?.ok && d?.data?.lineup?.length && !lineup.length) {
                            lineup = d.data.lineup;
                            targetHitTime = d.data.targetHitTime || '2:30';
                            _syncHitTimeUI();
                            renderLineup();
                        }
                    } catch(e) {}
                },
                onerror() {}
            });
        } catch(e) {}
    }

    // Background refresh for members
    pollMembersTimer = setInterval(fetchFactionMembers, STATUS_POLL_MS);

})();
