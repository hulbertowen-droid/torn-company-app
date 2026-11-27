// ==UserScript==
// @name         FactionOS Chain Command
// @namespace    https://faction-os.duckdns.org/
// @version      4.3.0
// @description  FactionOS Tactical Chain HUD — persistent Auto-Call med-out broadcaster (works minimized & without Send ON), sub-second uncached hit detection, wall-clock chain timer, Torn Chat 3.0/2.0 auto-posting, and verified Enemy Med-Out / Revive alerts.
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

    // Never mount inside embedded iframes or raw JSON documents
    if (window.top !== window.self) return;
    if (document.contentType && !document.contentType.includes('html')) return;

    // ══════════════════════════════════════════════════════════════
    //  CONSTANTS & STORAGE KEYS
    // ══════════════════════════════════════════════════════════════
    const SERVER_BASE      = 'https://faction-os.duckdns.org';
    const LS_KEY_POS       = 'sv_chain_mgr_pos_v4';
    const LS_KEY_APIKEY    = 'sv_chain_apikey';
    const LS_KEY_MEMBERS   = 'sv_chain_members_cache';
    const LS_KEY_AUTOCALL  = 'sv_autocall_medout';
    const LS_KEY_AUTOCALL_INIT = 'sv_autocall_v43_init';
    const STATUS_POLL_MS   = 45000;
    const CHAIN_BONUSES    = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

    function getStoredAutoCallMedOut() {
        try {
            if (!GM_getValue(LS_KEY_AUTOCALL_INIT, false)) {
                GM_setValue(LS_KEY_AUTOCALL_INIT, true);
                GM_setValue(LS_KEY_AUTOCALL, true);
                try { localStorage.setItem(LS_KEY_AUTOCALL, 'true'); } catch (e) {}
                return true;
            }
            const gmVal = GM_getValue(LS_KEY_AUTOCALL, undefined);
            if (typeof gmVal === 'boolean') return gmVal;
            const lsVal = localStorage.getItem(LS_KEY_AUTOCALL);
            if (lsVal === 'true') return true;
            if (lsVal === 'false') return false;
        } catch (e) {}
        return true;
    }

    function setStoredAutoCallMedOut(val) {
        const b = Boolean(val);
        try { GM_setValue(LS_KEY_AUTOCALL_INIT, true); } catch (e) {}
        try { GM_setValue(LS_KEY_AUTOCALL, b); } catch (e) {}
        try { localStorage.setItem(LS_KEY_AUTOCALL, b ? 'true' : 'false'); } catch (e) {}
        return b;
    }

    // ══════════════════════════════════════════════════════════════
    //  STATE
    // ══════════════════════════════════════════════════════════════
    let apiKey           = GM_getValue('sv_apikey', '') || localStorage.getItem(LS_KEY_APIKEY) || '';
    let customEnemyFacId = GM_getValue('sv_enemy_fac_id', '') || '';
    let autoEnemyFacId   = '';
    let enemyFacName     = 'Enemy Faction';
    let lineup           = []; // [{ name, id, hit, skipped, hitsSession }]
    let targetHitTime    = '2:30';
    let cycleNum         = 1;
    let loopMode         = true;
    let autoMode         = true;
    let autoSendOnPost   = GM_getValue('sv_autosend', false);
    let soundEnabled     = GM_getValue('sv_sound', true);
    let autoCallMedOut   = getStoredAutoCallMedOut();
    let runOnAllPages    = GM_getValue('sv_all_pages', true);
    let isMinimized      = GM_getValue('sv_min', false);
    let isHidden         = false;
    let activeTab        = 'lineup'; // 'lineup' | 'radar' | 'hits'

    let chainTimeout     = 0;
    let chainCount       = 0;
    let chainActive      = false;
    let chainCooldown    = 0;

    let factionMembers   = [];
    let memberStatuses   = {}; // id -> { online, state, until, lastActionTs }
    let processedAtkIds  = new Set();
    let liveHits         = []; // [{ chain, attackerName, attackerId, timestamp }]
    let isFirstPoll      = true;
    let hasAttacksAccess = true;

    let searchQuery      = '';
    let suggestSelected  = -1;
    let isDirtyLineup    = false;
    let warnedAt60       = false;
    let warnedEmergency  = 0;
    let showHospBanner   = false;
    let showSettings     = !apiKey;

    // Server Sync Versioning & Wall-Clock Chain State
    let myFactionId         = GM_getValue('sv_my_fac_id', '') || '';
    let myFactionName       = GM_getValue('sv_my_fac_name', '') || '';
    let serverLineupVersion = 0;
    let isSavingToServer    = false;
    let localMutationSeq    = 0;
    let pendingUrgentPoll   = null;

    let chainDeadlineMs       = 0;
    let cooldownDeadlineMs    = 0;
    let currentChainStart     = 0;
    let highestConfirmedChain = 0;
    let lastLocalChainBumpMs  = 0;
    let lastProcessedChain    = 0;
    let lastDirectEnemySnapTs = 0;
    const pendingHitVerify    = new Set();

    // Adaptive Polling & Timers
    let adaptivePollTimer   = null;
    let enemyPollTimer      = null;
    let pollMembersTimer    = null;
    let timerInterval       = null;
    let lastProcessedHitSig = '';
    let lastProcessedHitTs  = 0;

    function persistChainCursor() {
        try {
            GM_setValue('sv_chain_cursor_v4', JSON.stringify({
                lastProcessedChain,
                chainStart: currentChainStart,
                savedAt: Date.now()
            }));
        } catch (e) {}
    }
    function loadChainCursor() {
        try {
            const c = JSON.parse(GM_getValue('sv_chain_cursor_v4', '{}'));
            if (c && c.savedAt && (Date.now() - c.savedAt) < 15 * 60 * 1000) {
                if (c.lastProcessedChain) lastProcessedChain = Number(c.lastProcessedChain) || 0;
                if (c.chainStart) currentChainStart = Number(c.chainStart) || 0;
            }
        } catch (e) {}
    }

    // Enemy Med-Out / Revive Sniper State
    let localEnemyHospMap   = {};   // id -> { state, until, online, name, level }
    let enemyMedOuts        = [];   // [{ id, playerId, playerName, level, onlineStatus, escapeType, secondsSaved, timeSavedStr, detectedAt, attackUrl }]
    let upcomingHospExits   = [];   // [{ playerId, playerName, level, onlineStatus, until, secondsLeft, attackUrl }]
    let seenMedOutIds       = new Set();
    let activeMedAlert      = null; // Most recent alert banner inside HUD
    let activeMedBannerTimer = null;
    let lastAutoCalledPlayer = new Map(); // playerId -> timestamp

    // ══════════════════════════════════════════════════════════════
    //  TACTICAL WEB AUDIO ENGINE
    // ══════════════════════════════════════════════════════════════
    let audioCtx = null;
    function getAudioContext() {
        if (!soundEnabled) return null;
        try {
            if (!audioCtx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (AC) audioCtx = new AC();
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
            return audioCtx;
        } catch (e) {
            return null;
        }
    }

    function playTone(freq, startOffset, duration, type = 'sine', peakGain = 0.12) {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime + startOffset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(peakGain, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.02);
    }

    function playSuccessChime() {
        try {
            playTone(587.33, 0, 0.16, 'sine', 0.11);
            playTone(880, 0.08, 0.28, 'sine', 0.13);
        } catch (e) {}
    }

    function playPanicWarningBeep() {
        try {
            playTone(440, 0, 0.18, 'triangle', 0.13);
            playTone(440, 0.22, 0.18, 'triangle', 0.13);
        } catch (e) {}
    }

    function playMedOutSniperAlert() {
        try {
            // Distinct sharp triple-chirp sniper alert (impossible to confuse with hit chime)
            playTone(1046.5, 0, 0.11, 'sawtooth', 0.11);
            playTone(1318.5, 0.12, 0.11, 'sawtooth', 0.13);
            playTone(1567.98, 0.24, 0.24, 'triangle', 0.15);
        } catch (e) {}
    }

    // ══════════════════════════════════════════════════════════════
    //  CHAIN & TIME HELPERS
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
        if (!count || count <= 0) return { prev: 0, next: 10, remaining: 10, pct: 0, text: 'Start Chain' };
        let prev = 0;
        for (const b of CHAIN_BONUSES) {
            if (count < b) {
                const rem = b - count;
                const bStr = b >= 1000 ? (b / 1000) + 'k' : String(b);
                const pct = Math.min(100, Math.max(0, ((count - prev) / (b - prev)) * 100));
                return { prev, next: b, remaining: rem, pct, text: `${rem} to ${bStr}` };
            }
            prev = b;
        }
        return { prev: 100000, next: null, remaining: 0, pct: 100, text: 'MAX 100k' };
    }

    function fmtSecs(s) {
        if (!s || s <= 0) return '0:00';
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${String(sec).padStart(2, '0')}`;
    }

    function fmtSavedTime(secs) {
        const s = Math.max(0, Math.round(Number(secs) || 0));
        if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
        if (s >= 60) {
            const m = Math.floor(s / 60);
            const r = s % 60;
            return r > 0 ? `${m}m ${r}s` : `${m}m`;
        }
        return `${s}s`;
    }

    function fmtAgo(tsMs) {
        const secs = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
        if (secs < 60) return `${secs}s ago`;
        const m = Math.floor(secs / 60);
        if (m < 60) return `${m}m ago`;
        return `${Math.floor(m / 60)}h ago`;
    }

    function parseTimeToSecs(str) {
        if (!str) return 0;
        const p = str.split(':');
        return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
    }

    function getActiveEnemyFactionId() {
        return (customEnemyFacId || autoEnemyFacId || '').trim();
    }

    function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function escAttr(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function escRe(s) { return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'); }

    // ══════════════════════════════════════════════════════════════
    //  CROSS-TAB SYNCHRONIZATION
    // ══════════════════════════════════════════════════════════════
    const _TAB_ID = Math.random().toString(36).slice(2);
    let broadcastChan = null;
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            broadcastChan = new BroadcastChannel('factionos_chain_sync_v4');
            broadcastChan.onmessage = (e) => {
                if (e && e.data && e.data._tabId !== _TAB_ID) handleIncomingBroadcast(e.data);
            };
        }
    } catch (e) {}

    function broadcastHitEvent(payload) {
        handleIncomingHit(payload);
        if (broadcastChan) {
            try { broadcastChan.postMessage({ ...payload, _tabId: _TAB_ID }); } catch (e) {}
        }
    }

    function broadcastMedOutEvent(ev) {
        handleDetectedMedOut(ev, true);
        if (broadcastChan) {
            try { broadcastChan.postMessage({ type: 'MEDOUT_DETECTED', event: ev, _tabId: _TAB_ID }); } catch (e) {}
        }
    }

    function broadcastSettingsUpdate() {
        if (broadcastChan) {
            try {
                broadcastChan.postMessage({
                    type: 'SETTINGS_UPDATED',
                    loopMode,
                    autoMode,
                    autoSendOnPost,
                    autoCallMedOut,
                    soundEnabled,
                    _tabId: _TAB_ID
                });
            } catch (e) {}
        }
    }

    if (typeof GM_addValueChangeListener === 'function') {
        try {
            GM_addValueChangeListener(LS_KEY_AUTOCALL, (_name, _oldVal, newVal, remote) => {
                if (!remote && newVal === autoCallMedOut) return;
                autoCallMedOut = Boolean(newVal);
                syncTogglePillsUI();
            });
        } catch (e) {}
    }

    window.addEventListener('storage', (e) => {
        if (e && e.key === LS_KEY_AUTOCALL && (e.newValue === 'true' || e.newValue === 'false')) {
            autoCallMedOut = e.newValue === 'true';
            syncTogglePillsUI();
        }
    });

    function handleIncomingBroadcast(payload) {
        if (!payload || !payload.type) return;
        if (payload.type === 'HIT_DETECTED' || payload.type === 'DOM_CHAIN_UPDATE') {
            handleIncomingHit(payload);
        } else if (payload.type === 'MEDOUT_DETECTED' && payload.event) {
            handleDetectedMedOut(payload.event, false);
        } else if (payload.type === 'SETTINGS_UPDATED') {
            if (payload.loopMode !== undefined) loopMode = Boolean(payload.loopMode);
            if (payload.autoMode !== undefined) autoMode = Boolean(payload.autoMode);
            if (payload.autoSendOnPost !== undefined) autoSendOnPost = Boolean(payload.autoSendOnPost);
            if (payload.autoCallMedOut !== undefined) autoCallMedOut = Boolean(payload.autoCallMedOut);
            if (payload.soundEnabled !== undefined) soundEnabled = Boolean(payload.soundEnabled);
            syncTogglePillsUI();
        } else if (payload.type === 'LINEUP_UPDATED' && payload.lineup) {
            lineup = payload.lineup;
            if (payload.cycleNum) cycleNum = payload.cycleNum;
            if (payload.loopMode !== undefined) loopMode = payload.loopMode;
            if (payload.autoMode !== undefined) autoMode = payload.autoMode;
            if (payload.autoSendOnPost !== undefined) autoSendOnPost = payload.autoSendOnPost;
            if (payload.autoCallMedOut !== undefined) autoCallMedOut = payload.autoCallMedOut;
            if (payload.soundEnabled !== undefined) soundEnabled = payload.soundEnabled;
            if (payload.targetHitTime !== undefined) {
                targetHitTime = payload.targetHitTime;
                _syncHitTimeUI();
            }
            syncTogglePillsUI();
            renderLineup();
            renderChainBar();
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  TIER 1: NATIVE ATTACK & DOM CHAIN OBSERVERS
    // ══════════════════════════════════════════════════════════════
    function initTier1AttackObserver() {
        if (typeof unsafeWindow === 'undefined') return;

        const origFetch = unsafeWindow.fetch;
        if (origFetch) {
            unsafeWindow.fetch = async function (...args) {
                const response = await origFetch.apply(this, args);
                try {
                    const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';
                    if (url.includes('sid=attack') || (url.includes('loader.php') && url.includes('attack'))) {
                        const clone = response.clone();
                        clone.json().then(data => handleNativeAttackResponse(data)).catch(() => {});
                    }
                } catch (e) {}
                return response;
            };
        }

        if (unsafeWindow.XMLHttpRequest) {
            const origOpen = unsafeWindow.XMLHttpRequest.prototype.open;
            const origSend = unsafeWindow.XMLHttpRequest.prototype.send;
            unsafeWindow.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                this._sv_url = url;
                return origOpen.apply(this, [method, url, ...rest]);
            };
            unsafeWindow.XMLHttpRequest.prototype.send = function (...args) {
                this.addEventListener('load', function () {
                    try {
                        if (this._sv_url && (this._sv_url.includes('sid=attack') || (this._sv_url.includes('loader.php') && this._sv_url.includes('attack')))) {
                            const data = JSON.parse(this.responseText);
                            handleNativeAttackResponse(data);
                        }
                    } catch (e) {}
                });
                return origSend.apply(this, args);
            };
        }
    }

    function getLoggedInTornPlayer() {
        try {
            const wsEl = document.getElementById('websocketConnectionData');
            if (wsEl && wsEl.textContent) {
                const parsed = JSON.parse(wsEl.textContent);
                if (parsed && parsed.userID) {
                    return { id: String(parsed.userID), name: parsed.playername || '' };
                }
            }
        } catch (e) {}
        try {
            const profLink = document.querySelector('a[href*="profiles.php?XID="]');
            const m = profLink?.getAttribute('href')?.match(/XID=(\d+)/);
            if (m) return { id: m[1], name: (profLink.textContent || '').trim() };
        } catch (e) {}
        return { id: null, name: '' };
    }

    function handleNativeAttackResponse(data) {
        if (!data || typeof data !== 'object') return;
        const db = data.DB || data.data || {};
        const textLog = JSON.stringify(data);
        // Never trigger on losses, stalemates, or escapes
        if (/\b(lost\s+to|stalemate|escaped|defeated\s+you)\b/i.test(textLog)) return;

        const respectVal = Number(data.respect_gain || db.respect_gain || db.respectGain || data.respect || db.respect || 0);
        const chainVal = Number(data.chain || db.chain || 0);
        const fightRes = String(db.fightResult || data.result || '');
        const hasWinAction = /\b(hospitalized|mugged|left|won)\b/i.test(fightRes) ||
            /\b(you\s+hospitalized|you\s+mugged|you\s+left|hospitalized\s+them|mugged\s+them)\b/i.test(textLog);
        const isConfirmedWin = (respectVal > 0) || (chainVal > Math.max(chainCount, highestConfirmedChain) && chainVal > 0) || (hasWinAction && (data.success === true || data.status === 'success' || Boolean(db.attackerUser)));

        if (!isConfirmedWin) return;

        const selfPlayer = getLoggedInTornPlayer();
        const attackerName = data.attacker_name || db.attackerUser?.playername || db.attacker_name || selfPlayer.name || '';
        const attackerId = data.attacker_id || db.attackerUser?.userID || db.attacker_id || selfPlayer.id || null;
        const timeoutVal = data.chainTimeout || db.chainTimeout || 300;

        broadcastHitEvent({
            type: 'HIT_DETECTED',
            source: 'tier1_fetch',
            attackerId,
            attackerName,
            chain: chainVal > 0 ? chainVal : (chainCount ? chainCount + 1 : null),
            timeout: timeoutVal,
            timestamp: Date.now()
        });
    }

    function initTier1HeaderDOMObserver() {
        let debounceTimer = null;

        function scanDOMChainCounter() {
            try {
                const chainEl = document.querySelector('[class*="chain-bar"], [class*="chainBar"], [class*="bar-chain"], a[href*="step=your#/war/chain"], a[aria-label*="Chain" i]');
                if (!chainEl) return;

                const text = chainEl.innerText || '';
                if (!text) return;

                const chainMatch = text.match(/(\d{1,6})\s*\/\s*(?:10|25|50|100|250|500|1k|2\.5k|5k|10k|25k|50k|100k|\d{2,6})/i) ||
                    text.match(/chain\s*:?\s*(\d{1,6})/i);
                const timerMatch = text.match(/(?:^|[^\d:])([0-5]?\d:\d{2})(?![:\d])/);

                const parsedChain = chainMatch ? parseInt(chainMatch[1], 10) : null;
                const parsedTimerRaw = timerMatch ? parseTimeToSecs(timerMatch[1]) : null;
                const parsedTimer = (parsedTimerRaw !== null && parsedTimerRaw <= 305) ? parsedTimerRaw : null;

                if (parsedChain !== null && parsedChain > 0 && chainCooldown === 0) {
                    const knownBest = Math.max(chainCount, highestConfirmedChain);
                    if (parsedChain > knownBest) {
                        // tier1_dom notifies chain increment & triggers immediate v1/v2 API verification WITHOUT blindly rotating lineup[0]
                        broadcastHitEvent({
                            type: 'HIT_DETECTED',
                            source: 'tier1_dom',
                            chain: parsedChain,
                            timeout: parsedTimer || 300,
                            timestamp: Date.now()
                        });
                    } else if (parsedChain === chainCount && parsedTimer !== null && Math.abs(parsedTimer - chainTimeout) > 3) {
                        chainDeadlineMs = Date.now() + (parsedTimer * 1000);
                        chainTimeout = parsedTimer;
                        renderChainBar();
                        updateMinDisplay();
                    }
                }
            } catch (e) {}
        }

        function debouncedScan() {
            if (debounceTimer) return;
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                scanDOMChainCounter();
            }, 35);
        }

        const observer = new MutationObserver(() => debouncedScan());
        function startObserving() {
            const root = document.querySelector('[class*="chain-bar"], [class*="chainBar"]') ||
                document.querySelector('#top-page-links-list') ||
                document.body;
            if (root) {
                observer.observe(root, { childList: true, subtree: true, characterData: true });
                scanDOMChainCounter();
            }
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserving);
        else startObserving();
    }

    // ══════════════════════════════════════════════════════════════
    //  TIER 2: WEBSOCKET FACTION LOG SNIFFER
    // ══════════════════════════════════════════════════════════════
    function initTier2WebSocketSniffer() {
        if (typeof unsafeWindow === 'undefined' || !unsafeWindow.WebSocket) return;
        try {
            const OriginalWS = unsafeWindow.WebSocket;
            unsafeWindow.WebSocket = new Proxy(OriginalWS, {
                construct(target, args) {
                    let ws;
                    try { ws = new target(...args); } catch (e) { return new target(...args); }
                    try {
                        ws.addEventListener('message', function (event) {
                            try { handleWebSocketRawMessage(event.data); } catch (e) {}
                        });
                    } catch (e) {}
                    return ws;
                }
            });
        } catch (e) {}
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
        } catch (e) {}

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
    //  SMART QUEUE ROTATION & HIT ATTRIBUTION
    // ══════════════════════════════════════════════════════════════
    function verifyHitWithRetry(targetChain) {
        if (!targetChain || pendingHitVerify.has(targetChain)) return;
        pendingHitVerify.add(targetChain);
        const delays = [30, 500, 1250];
        delays.forEach((ms, idx) => {
            setTimeout(() => {
                if (lastProcessedChain >= targetChain) {
                    pendingHitVerify.delete(targetChain);
                    return;
                }
                // Fast uncached backend pull (works even with NO personal API key!)
                syncBackendTelemetry(true, targetChain);
                if (apiKey && hasAttacksAccess) {
                    const fromSec = Math.floor(Date.now() / 1000) - 360;
                    tornGet(`/faction/?selections=attacks,chain,timestamp&from=${fromSec}`, (err, d) => {
                        if (!err && d) {
                            if (d.chain) applyChainStateFromApi(d.chain, d.timestamp);
                            if (d.attacks) processAttacks(Object.values(d.attacks));
                        }
                    });
                }
                if (idx === delays.length - 1) {
                    setTimeout(() => pendingHitVerify.delete(targetChain), 600);
                }
            }, ms);
        });
    }

    function recordLiveHit(chainVal, name, id, tsSec) {
        if (!chainVal) return;
        if (liveHits.some(h => h.chain === chainVal && h.attackerName === name)) return;
        liveHits.unshift({
            chain: chainVal,
            attackerName: name || 'Faction Member',
            attackerId: id || null,
            timestamp: (tsSec || Math.floor(Date.now() / 1000)) * 1000
        });
        if (liveHits.length > 40) liveHits.pop();
        renderTabBadges();
        if (activeTab === 'hits') renderHitsTab();
    }

    function handleIncomingHit(evt) {
        if (!evt) return;

        const now = Date.now();
        const incomingChain = Number(evt.chain || (chainCount + 1));
        const hitSig = evt.chain ? `chain_${evt.chain}_${evt.attackerId || evt.attackerName || 'dom'}` : `ts_${Math.floor(now / 1800)}`;

        if (hitSig === lastProcessedHitSig && (now - lastProcessedHitTs) < 1200) return;
        lastProcessedHitSig = hitSig;
        lastProcessedHitTs = now;

        const isNewChainStep = incomingChain > Math.max(chainCount, highestConfirmedChain);
        if (incomingChain > chainCount || !chainCount) {
            chainCount = incomingChain;
        }
        if (incomingChain > highestConfirmedChain) {
            highestConfirmedChain = incomingChain;
            lastLocalChainBumpMs = now;
        }
        if (evt.timeout && evt.timeout > 0 && evt.timeout <= 305) {
            chainTimeout = evt.timeout;
            chainDeadlineMs = now + (evt.timeout * 1000);
        } else if (isNewChainStep && (evt.source === 'tier1_dom' || evt.source === 'tier2_ws' || evt.source === 'tier1_fetch')) {
            chainTimeout = 300;
            chainDeadlineMs = now + 300000;
        }
        chainActive = true;
        cooldownDeadlineMs = 0;
        chainCooldown = 0;
        warnedAt60 = false;

        const attackerId = evt.attackerId ? String(evt.attackerId) : null;
        const attackerName = (evt.attackerName || '').trim().toLowerCase();

        // Unattributed DOM counter increments NEVER rotate lineup[0] blindly; trigger dual-bucket verification instead
        if (evt.source === 'tier1_dom' && !attackerId && !attackerName) {
            playSuccessChime();
            renderChainBar();
            updateMinDisplay();
            flashStatus(`⚡ Chain #${incomingChain} detected — verifying hitter...`, false);
            verifyHitWithRetry(incomingChain);
            return;
        }

        if (evt.attackerName) {
            recordLiveHit(incomingChain, evt.attackerName, evt.attackerId, Math.floor((evt.timestamp || now) / 1000));
        }

        // Idempotency guard: if this exact chain # was already rotated by server or another tier, skip double rotation
        if (evt.chain && incomingChain <= lastProcessedChain) {
            renderChainBar();
            updateMinDisplay();
            return;
        }
        lastProcessedChain = Math.max(lastProcessedChain, incomingChain);
        persistChainCursor();

        if (!lineup.length) {
            playSuccessChime();
            flashStatus(`✓ Hit #${incomingChain} by ${evt.attackerName || 'Member'}`, false);
            setDirty(true);
            renderChainBar();
            updateMinDisplay();
            return;
        }

        const up = lineup[0];
        const upId = up.id ? String(up.id) : null;
        const upName = (up.name || '').trim().toLowerCase();

        const isAssignedHitter = Boolean(
            (attackerId && upId && attackerId === upId) ||
            (attackerName && upName && attackerName === upName)
        );

        if (isAssignedHitter) {
            playSuccessChime();
            if (autoMode) {
                const [hitter] = lineup.splice(0, 1);
                hitter.hit = true;
                hitter.hitsSession = (hitter.hitsSession || 0) + 1;
                if (loopMode) lineup.push(hitter);
                cycleNum++;
                const nextUpName = lineup[0] ? lineup[0].name : 'Lineup Empty';
                flashStatus(`✅ ${hitter.name} landed #${incomingChain}! Next UP: ${nextUpName}`, false);
                save(incomingChain);
                if (autoSendOnPost) setTimeout(() => postToChat(), 200);
            } else {
                up.hit = true;
                up.hitsSession = (up.hitsSession || 0) + 1;
                flashStatus(`✅ ${up.name} landed #${incomingChain} (Auto-Rotate OFF — click Hit & Next to rotate)`, false);
                save(incomingChain);
            }
            setDirty(true);
            renderLineup();
            renderChainBar();
        } else if (attackerName || attackerId) {
            const saviorIdx = lineup.findIndex(m =>
                (m.id && attackerId && String(m.id) === attackerId) ||
                (m.name && m.name.trim().toLowerCase() === attackerName)
            );
            playSuccessChime();

            if (saviorIdx !== -1) {
                const targetM = lineup[saviorIdx];
                targetM.hit = true;
                targetM.hitsSession = (targetM.hitsSession || 0) + 1;
                if (autoMode) {
                    const [savior] = lineup.splice(saviorIdx, 1);
                    if (loopMode) lineup.push(savior);
                    flashStatus(`⚡ Jump-in hit #${incomingChain} by ${savior.name}! ${lineup[0] ? lineup[0].name : ''} stays UP.`, false);
                } else {
                    flashStatus(`⚡ Jump-in hit #${incomingChain} by ${targetM.name}!`, false);
                }
                save(incomingChain);
                renderLineup();
            } else {
                const displayName = evt.attackerName || 'Faction Savior';
                flashStatus(`⚡ Savior hit #${incomingChain} by ${displayName}! ${lineup[0].name} stays UP.`, false);
            }
            setDirty(true);
            renderChainBar();
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  INSTANT ENEMY MED-OUT & REVIVE SNIPER
    // ══════════════════════════════════════════════════════════════
    const LS_KEY_AUTOCALLED_MAP = 'sv_autocalled_medids_v43';
    let pendingMedOutAutoCalls = []; // [{ ev, queuedAt }]

    function getAutoCallEventKey(ev) {
        if (!ev) return '';
        if (ev.id) return String(ev.id);
        return `${ev.playerId}_${Math.floor((ev.detectedAt || Date.now()) / 20000)}`;
    }

    function readAutoCalledMap() {
        let map = {};
        try {
            const raw = GM_getValue(LS_KEY_AUTOCALLED_MAP, '') || localStorage.getItem(LS_KEY_AUTOCALLED_MAP) || '{}';
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (parsed && typeof parsed === 'object') map = parsed;
        } catch (e) {}
        const cutoff = Date.now() - 10 * 60 * 1000;
        const clean = {};
        for (const [k, ts] of Object.entries(map)) {
            if (Number(ts) > cutoff) clean[k] = Number(ts);
        }
        return clean;
    }

    function writeAutoCalledMap(map) {
        try { GM_setValue(LS_KEY_AUTOCALLED_MAP, JSON.stringify(map)); } catch (e) {}
        try { localStorage.setItem(LS_KEY_AUTOCALLED_MAP, JSON.stringify(map)); } catch (e) {}
    }

    function hasMedOutBeenAutoCalled(ev) {
        const key = getAutoCallEventKey(ev);
        if (!key) return false;
        const map = readAutoCalledMap();
        if (map[key]) return true;
        const pidStr = String(ev.playerId || '');
        const lastCall = lastAutoCalledPlayer.get(pidStr) || 0;
        return (Date.now() - lastCall) <= 15000;
    }

    function claimMedOutAutoCall(ev) {
        const key = getAutoCallEventKey(ev);
        const pidStr = String(ev?.playerId || '');
        const map = readAutoCalledMap();
        if (key && map[key]) return false;
        const now = Date.now();
        if (pidStr && (now - (lastAutoCalledPlayer.get(pidStr) || 0)) <= 15000) return false;
        if (key) {
            map[key] = now;
            writeAutoCalledMap(map);
        }
        if (pidStr) lastAutoCalledPlayer.set(pidStr, now);
        return true;
    }

    function releaseMedOutAutoCallClaim(ev) {
        const key = getAutoCallEventKey(ev);
        const pidStr = String(ev?.playerId || '');
        if (key) {
            const map = readAutoCalledMap();
            if (map[key]) {
                delete map[key];
                writeAutoCalledMap(map);
            }
        }
        if (pidStr) lastAutoCalledPlayer.delete(pidStr);
    }

    function enqueuePendingAutoCall(ev) {
        if (!ev || !ev.playerId) return;
        const key = getAutoCallEventKey(ev);
        if (pendingMedOutAutoCalls.some(x => getAutoCallEventKey(x.ev) === key)) return;
        pendingMedOutAutoCalls.push({ ev, queuedAt: Date.now() });
        if (pendingMedOutAutoCalls.length > 8) pendingMedOutAutoCalls = pendingMedOutAutoCalls.slice(-8);
    }

    function attemptAutoCallMedOut(ev) {
        autoCallMedOut = getStoredAutoCallMedOut();
        syncTogglePillsUI();
        if (!autoCallMedOut || !ev || !ev.playerId) return;
        if (hasMedOutBeenAutoCalled(ev)) return;
        if (!claimMedOutAutoCall(ev)) return;

        callOutMedOutToChat(ev, (sentOk) => {
            if (!sentOk) {
                releaseMedOutAutoCallClaim(ev);
                if ((Date.now() - (ev.detectedAt || Date.now())) < 90000) {
                    enqueuePendingAutoCall(ev);
                }
            }
        });
    }

    function flushPendingMedOutAutoCalls() {
        if (!pendingMedOutAutoCalls.length) return;
        autoCallMedOut = getStoredAutoCallMedOut();
        if (!autoCallMedOut) {
            pendingMedOutAutoCalls = [];
            return;
        }
        const now = Date.now();
        pendingMedOutAutoCalls = pendingMedOutAutoCalls.filter(item =>
            (now - item.queuedAt) < 90000 && !hasMedOutBeenAutoCalled(item.ev)
        );
        if (!pendingMedOutAutoCalls.length) return;
        const next = pendingMedOutAutoCalls.shift();
        if (next && next.ev) attemptAutoCallMedOut(next.ev);
    }

    function handleDetectedMedOut(ev, reportToServer = false) {
        if (!ev || !ev.playerId) return;
        const pidStr = String(ev.playerId);
        const dedupKey = ev.id || `${pidStr}_${Math.floor((ev.detectedAt || Date.now()) / 20000)}`;
        if (seenMedOutIds.has(dedupKey)) return;
        seenMedOutIds.add(dedupKey);
        if (seenMedOutIds.size > 200) {
            seenMedOutIds = new Set([...seenMedOutIds].slice(-100));
        }

        const ageMs = Date.now() - (ev.detectedAt || Date.now());
        enemyMedOuts = [ev, ...enemyMedOuts.filter(x => x.id !== ev.id && String(x.playerId) !== pidStr)].slice(0, 25);
        renderTabBadges();
        if (activeTab === 'radar') renderRadarTab();

        if (ageMs < 65000) {
            activeMedAlert = ev;
            playMedOutSniperAlert();
            renderMedOutBanner();
            updateMinDisplay();

            // Refresh persistent flag so another tab toggling or saving never turns Auto-Call off silently
            autoCallMedOut = getStoredAutoCallMedOut();
            syncTogglePillsUI();
            if (autoCallMedOut && !hasMedOutBeenAutoCalled(ev)) {
                if (document.hidden) {
                    // Prefer an active visible Torn tab if one exists; otherwise execute right here even while minimized
                    setTimeout(() => attemptAutoCallMedOut(ev), 180);
                } else {
                    attemptAutoCallMedOut(ev);
                }
            }

            if (activeMedBannerTimer) clearTimeout(activeMedBannerTimer);
            activeMedBannerTimer = setTimeout(() => {
                if (activeMedAlert && activeMedAlert.id === ev.id) {
                    activeMedAlert = null;
                    renderMedOutBanner();
                    updateMinDisplay();
                }
            }, 45000);
        }

        if (reportToServer) {
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${SERVER_BASE}/api/chain/medout-report`,
                    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey || '' },
                    data: JSON.stringify({
                        playerId: ev.playerId,
                        playerName: ev.playerName,
                        level: ev.level,
                        factionId: ev.factionId || getActiveEnemyFactionId(),
                        factionName: ev.factionName || enemyFacName,
                        onlineStatus: ev.onlineStatus,
                        secondsSaved: ev.secondsSaved,
                        until: ev.oldUntil,
                        hospSnapTs: ev.hospSnapTs || 0
                    }),
                    timeout: 4000,
                    onerror() {}
                });
            } catch (e) {}
        }
    }

    function processDirectEnemyMembers(membersObj, facId, facName, snapTs = 0) {
        if (!membersObj || typeof membersObj !== 'object') return;
        const sTs = Number(snapTs) || 0;
        if (sTs > 0 && lastDirectEnemySnapTs > 0 && sTs < lastDirectEnemySnapTs) return;
        if (sTs > lastDirectEnemySnapTs) lastDirectEnemySnapTs = sTs;

        const nowSec = sTs || Math.floor(Date.now() / 1000);
        const soon = [];
        let radarDirty = false;

        for (const [id, m] of Object.entries(membersObj)) {
            if (!m) continue;
            const st = m.status?.state || 'Okay';
            const until = Number(m.status?.until || 0);
            const online = m.last_action?.status || 'Offline';
            const oldRec = localEnemyHospMap[id];

            // Purge any player back in Hospital / Jail / Traveling from HUD alerts immediately
            if (st !== 'Okay') {
                const prevLen = enemyMedOuts.length;
                enemyMedOuts = enemyMedOuts.filter(x => String(x.playerId) !== String(id));
                if (enemyMedOuts.length !== prevLen) radarDirty = true;
                if (activeMedAlert && String(activeMedAlert.playerId) === String(id)) {
                    activeMedAlert = null;
                    renderMedOutBanner();
                    updateMinDisplay();
                }
            }

            if (st === 'Hospital' && until > nowSec && (until - nowSec) <= 300) {
                soon.push({
                    playerId: String(id),
                    playerName: m.name || `Enemy [${id}]`,
                    level: m.level || 0,
                    onlineStatus: online,
                    until,
                    secondsLeft: until - nowSec,
                    attackUrl: `https://www.torn.com/page.php?sid=attack&user2ID=${id}`
                });
            }

            if (oldRec && oldRec.state === 'Hospital' && st === 'Okay') {
                const monotonicOk = !sTs || !oldRec.hospSnapTs || sTs >= oldRec.hospSnapTs;
                const leftEarly = monotonicOk && oldRec.until && (oldRec.until > nowSec + 20);
                if (leftEarly && apiKey) {
                    const capturedOld = { ...oldRec };
                    const capturedId = String(id);
                    const capturedName = m.name || capturedOld.name || `Enemy [${capturedId}]`;
                    const capturedLvl = m.level || capturedOld.level || 0;
                    // Verify live uncached user profile before raising any alert
                    tornGet(`/user/${capturedId}?selections=profile,timestamp`, (err, u) => {
                        if (err || !u || !u.status) return;
                        const liveSt = u.status.state || 'Okay';
                        const liveTs = Number(u.timestamp) || Math.floor(Date.now() / 1000);
                        if (liveSt !== 'Okay') {
                            localEnemyHospMap[capturedId] = {
                                state: liveSt,
                                until: Number(u.status.until || 0),
                                online: u.last_action?.status || online,
                                name: u.name || capturedName,
                                level: u.level || capturedLvl,
                                hospSnapTs: liveSt === 'Hospital' ? liveTs : 0
                            };
                            return;
                        }
                        if (capturedOld.hospSnapTs && liveTs < capturedOld.hospSnapTs) return;
                        if (!capturedOld.until || capturedOld.until <= liveTs + 20) return;

                        const liveOnline = u.last_action?.status || online;
                        const lastActTs = Number(u.last_action?.timestamp || 0);
                        const isSelfMed = liveOnline === 'Online' && lastActTs > 0 && (liveTs - lastActTs) <= 120;
                        const saved = Math.max(0, capturedOld.until - liveTs);
                        broadcastMedOutEvent({
                            id: `med_${capturedId}_${liveTs}`,
                            playerId: capturedId,
                            playerName: u.name || capturedName,
                            level: u.level || capturedLvl,
                            factionId: String(facId || ''),
                            factionName: facName || enemyFacName,
                            onlineStatus: liveOnline,
                            escapeType: isSelfMed ? 'MEDDED OUT' : 'REVIVED',
                            secondsSaved: saved,
                            oldUntil: capturedOld.until,
                            hospSnapTs: capturedOld.hospSnapTs || 0,
                            timeSavedStr: fmtSavedTime(saved),
                            detectedAt: Date.now(),
                            attackUrl: `https://www.torn.com/page.php?sid=attack&user2ID=${capturedId}`,
                            profileUrl: `https://www.torn.com/profiles.php?XID=${capturedId}`
                        });
                    });
                }
            }

            localEnemyHospMap[id] = {
                state: st,
                until,
                online,
                name: m.name,
                level: m.level,
                hospSnapTs: st === 'Hospital' ? ((oldRec?.state === 'Hospital' && oldRec.hospSnapTs) ? oldRec.hospSnapTs : sTs) : 0
            };
        }

        soon.sort((a, b) => a.until - b.until);
        upcomingHospExits = soon.slice(0, 10);
        if (radarDirty) renderTabBadges();
        if (activeTab === 'radar') renderRadarTab();
    }

    function callOutMedOutToChat(ev, onResult = null) {
        if (!ev) {
            if (typeof onResult === 'function') onResult(false);
            return;
        }
        const msg = `🚨 ${ev.escapeType}: ${ev.playerName} [${ev.playerId}] (Lv.${ev.level || '?'}, ${ev.onlineStatus}) just left hospital ${ev.timeSavedStr} early! Attack: ${ev.attackUrl}`;
        // Always forceAutoSend=true for med-out callouts so Send OFF never blocks them
        postToChat(msg, true, onResult);
    }

    // ══════════════════════════════════════════════════════════════
    //  TIER 3: ADAPTIVE POLLING + BACKEND MED-OUT & VERSION SYNC
    // ══════════════════════════════════════════════════════════════
    function scheduleAdaptivePoll() {
        if (adaptivePollTimer) clearTimeout(adaptivePollTimer);
        const targetSecs = parseTimeToSecs(targetHitTime) || 150;
        const isCritical = chainTimeout > 0 && chainTimeout <= 150;
        const nearTarget = chainTimeout > 0 && Math.abs(chainTimeout - targetSecs) <= 30;
        const nextDelayMs = (isCritical || nearTarget) ? 1100 : (chainActive ? 1400 : 2500);

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
                } catch (e) { cb(e, null); }
            },
            onerror(e) { cb(e, null); }
        });
    }

    function normalizeAttackItem(a) {
        if (!a) return null;
        const chainNum = Number(a.chain || 0);
        if (!chainNum || chainNum <= 0) return null;
        const atkFac = String(a.attacker_faction ?? a.attacker?.faction?.id ?? '').trim();
        const defFac = String(a.defender_faction ?? a.defender?.faction?.id ?? '').trim();
        if (myFactionId) {
            if (atkFac && atkFac !== '0' && atkFac !== String(myFactionId)) return null;
            if (defFac && defFac === String(myFactionId)) return null;
        }
        const atkId = a.attacker_id ?? a.attacker?.id ?? null;
        const atkName = String(a.attacker_name ?? a.attacker?.name ?? '').trim();
        const tsEnd = Number(a.timestamp_ended ?? a.ended ?? 0);
        const code = String(a.code || a.id || `${atkId || 0}_${tsEnd}_${chainNum}`);
        return { code, attacker_id: atkId, attacker_name: atkName, timestamp_ended: tsEnd, chain: chainNum };
    }

    function processAttacks(rawAttacks) {
        if (!rawAttacks || !rawAttacks.length) return;
        const chainAtks = rawAttacks
            .map(normalizeAttackItem)
            .filter(Boolean)
            .sort((a, b) => (a.chain - b.chain) || (a.timestamp_ended - b.timestamp_ended));
        if (!chainAtks.length) return;

        const nowSec = Math.floor(Date.now() / 1000);

        if (isFirstPoll) {
            isFirstPoll = false;
            const unseenFresh = [];
            for (const atk of chainAtks) {
                processedAtkIds.add(atk.code);
                // If we persisted lastProcessedChain across page navigation, do not swallow newer hits!
                if (lastProcessedChain > 0 && atk.chain > lastProcessedChain && (!atk.timestamp_ended || (nowSec - atk.timestamp_ended) <= 90)) {
                    unseenFresh.push(atk);
                }
            }
            if (!lastProcessedChain && chainAtks.length) {
                lastProcessedChain = chainAtks[chainAtks.length - 1].chain;
                persistChainCursor();
            }
            liveHits = chainAtks.slice(-15).reverse().map(a => ({
                chain: a.chain,
                attackerName: a.attacker_name || 'Operative',
                attackerId: a.attacker_id || null,
                timestamp: (a.timestamp_ended || 0) * 1000
            }));
            renderTabBadges();
            renderChainBar();
            for (const atk of unseenFresh) {
                handleIncomingHit({
                    type: 'HIT_DETECTED',
                    source: 'tier3_api',
                    attackerId: atk.attacker_id,
                    attackerName: atk.attacker_name,
                    chain: atk.chain,
                    timestamp: (atk.timestamp_ended || nowSec) * 1000
                });
            }
            return;
        }

        for (const atk of chainAtks) {
            if (processedAtkIds.has(atk.code)) continue;
            processedAtkIds.add(atk.code);
            if (processedAtkIds.size > 600) {
                processedAtkIds = new Set([...processedAtkIds].slice(-300));
            }

            handleIncomingHit({
                type: 'HIT_DETECTED',
                source: 'tier3_api',
                attackerId: atk.attacker_id,
                attackerName: atk.attacker_name,
                chain: atk.chain,
                timestamp: (atk.timestamp_ended || nowSec) * 1000
            });
        }
    }

    function applyChainStateFromApi(chainObj, apiSnapTs = 0) {
        if (!chainObj || typeof chainObj !== 'object') return;
        const nowMs = Date.now();
        const snapSec = Number(apiSnapTs || chainObj.snapshotTs) || Math.floor(nowMs / 1000);
        const cStart = Number(chainObj.start || 0);
        const cCur = Number(chainObj.current || 0);
        const cCd = Number(chainObj.cooldown || 0);
        const cTo = Number(chainObj.timeout || 0);
        const cEnd = Number(chainObj.end || 0);

        if (cStart && currentChainStart && cStart !== currentChainStart) {
            highestConfirmedChain = 0;
            lastProcessedChain = 0;
            persistChainCursor();
        }
        if (cStart) currentChainStart = cStart;

        // Stale-API guard: ignore older cached Torn snapshots that lag behind a recent DOM/fetch hit
        if (cCd === 0 && highestConfirmedChain > 0 && (nowMs - lastLocalChainBumpMs) < 35000 && cCur < highestConfirmedChain) {
            return;
        }

        if (cCd > 0) {
            const cdTargetEnd = Number(chainObj.cooldownEndsAtMs || 0) || ((snapSec + cCd) * 1000);
            if (!cooldownDeadlineMs || Math.abs(cdTargetEnd - cooldownDeadlineMs) > 2500) {
                cooldownDeadlineMs = cdTargetEnd;
            }
            chainDeadlineMs = 0;
            chainCooldown = Math.max(0, Math.round((cooldownDeadlineMs - nowMs) / 1000));
            chainTimeout = 0;
            chainActive = false;
            chainCount = cCur;
            highestConfirmedChain = 0;
        } else if (cCur > 0) {
            cooldownDeadlineMs = 0;
            chainCooldown = 0;
            chainActive = true;
            if (cCur > highestConfirmedChain) highestConfirmedChain = cCur;
            chainCount = Math.max(cCur, highestConfirmedChain);

            const targetEndMs = Number(chainObj.expiresAtMs || 0) ||
                (cEnd > snapSec ? cEnd * 1000 : (snapSec + cTo) * 1000);
            if (!chainDeadlineMs || Math.abs(targetEndMs - chainDeadlineMs) > 2500) {
                chainDeadlineMs = targetEndMs;
            }
            chainTimeout = Math.max(0, Math.round((chainDeadlineMs - nowMs) / 1000));
        } else {
            chainActive = false;
            chainCount = 0;
            chainTimeout = 0;
            chainCooldown = 0;
            chainDeadlineMs = 0;
            cooldownDeadlineMs = 0;
            highestConfirmedChain = 0;
        }
    }

    function applyServerLineupPayload(dataObj, seqAtStart) {
        if (!dataObj || !Array.isArray(dataObj.lineup)) return false;
        if (seqAtStart !== localMutationSeq || isSavingToServer) return false;
        const incomingVer = dataObj.version || 0;
        if (dataObj.lastProcessedChain) {
            lastProcessedChain = Math.max(lastProcessedChain, Number(dataObj.lastProcessedChain) || 0);
            persistChainCursor();
        }
        if (incomingVer > serverLineupVersion || (!lineup.length && dataObj.lineup.length)) {
            serverLineupVersion = incomingVer;
            lineup = dataObj.lineup;
            if (dataObj.targetHitTime !== undefined) targetHitTime = dataObj.targetHitTime;
            if (dataObj.cycle) cycleNum = dataObj.cycle;
            if (dataObj.loopMode !== undefined) loopMode = dataObj.loopMode;
            if (dataObj.autoMode !== undefined) autoMode = dataObj.autoMode;
            // Never let a secondary tab or server lineup overwrite persistent local Auto-Call setting
            autoCallMedOut = getStoredAutoCallMedOut();
            GM_setValue('sv_state', JSON.stringify({ lineup, targetHitTime, cycleNum, loopMode, autoMode, autoSendOnPost, soundEnabled, autoCallMedOut, customEnemyFacId, runOnAllPages }));
            _syncHitTimeUI();
            syncTogglePillsUI();
            renderLineup();
            renderChainBar();
            return true;
        }
        return false;
    }

    function fetchServerLineupSnapshot() {
        if (isSavingToServer) return;
        const seqAtStart = localMutationSeq;
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${SERVER_BASE}/api/chain/lineup`,
            timeout: 4000,
            onload(res) {
                try {
                    const d = JSON.parse(res.responseText);
                    if (d?.ok && d?.data) applyServerLineupPayload(d.data, seqAtStart);
                } catch (e) {}
            },
            onerror() {}
        });
    }

    function syncBackendTelemetry(updateChainFields = true, minChain = 0) {
        const params = [];
        if (customEnemyFacId) params.push(`enemyFactionId=${encodeURIComponent(customEnemyFacId)}`);
        if (minChain > 0) params.push(`minChain=${encodeURIComponent(minChain)}`);
        const qs = params.length ? `?${params.join('&')}` : '';
        const seqAtStart = localMutationSeq;

        GM_xmlhttpRequest({
            method: 'GET',
            url: `${SERVER_BASE}/api/chain/data${qs}`,
            headers: { 'x-api-key': apiKey || '' },
            timeout: 4500,
            onload(res) {
                try {
                    const d = JSON.parse(res.responseText);
                    if (!d) return;
                    if (d.factionId) {
                        myFactionId = String(d.factionId);
                        GM_setValue('sv_my_fac_id', myFactionId);
                    }
                    if (d.factionName) {
                        myFactionName = String(d.factionName);
                        GM_setValue('sv_my_fac_name', myFactionName);
                    }
                    if (updateChainFields && d.chain) {
                        applyChainStateFromApi(d.chain, d.chain.snapshotTs);
                        renderChainBar();
                        updateMinDisplay();
                    }
                    if (Array.isArray(d.recentAttacks) && d.recentAttacks.length) {
                        processAttacks(d.recentAttacks);
                    }
                    if (d.enemyFaction && d.enemyFaction.id) {
                        autoEnemyFacId = String(d.enemyFaction.id);
                        enemyFacName = d.enemyFaction.name || enemyFacName;
                        updateEnemyBadgeUI();
                    }
                    if (Array.isArray(d.enemyMedOuts)) {
                        const validIds = new Set(d.enemyMedOuts.map(ev => String(ev.playerId)));
                        enemyMedOuts = enemyMedOuts.filter(ev => validIds.has(String(ev.playerId)));
                        if (activeMedAlert && !validIds.has(String(activeMedAlert.playerId))) {
                            activeMedAlert = null;
                            renderMedOutBanner();
                            updateMinDisplay();
                        }
                        for (const ev of [...d.enemyMedOuts].reverse()) {
                            handleDetectedMedOut(ev, false);
                        }
                        renderTabBadges();
                        if (activeTab === 'radar') renderRadarTab();
                    }
                    if (Array.isArray(d.upcomingHospExits)) {
                        upcomingHospExits = d.upcomingHospExits;
                        if (activeTab === 'radar') renderRadarTab();
                    }
                    if (d.lastProcessedChain && Number(d.lastProcessedChain) > lastProcessedChain) {
                        lastProcessedChain = Number(d.lastProcessedChain);
                        persistChainCursor();
                    }
                    // Apply inline lineupData immediately without a 2nd round-trip
                    if (d.lineupData && d.lineupVersion > serverLineupVersion && !isSavingToServer) {
                        const applied = applyServerLineupPayload(d.lineupData, seqAtStart);
                        if (applied && d.lastHitEvent && (Date.now() - d.lastHitEvent.ts) < 12000 && d.lastHitEvent.attackerName) {
                            flashStatus(`✅ ${d.lastHitEvent.attackerName} landed #${d.lastHitEvent.chain}!${d.lastHitEvent.nextUp ? ' Next UP: ' + d.lastHitEvent.nextUp : ''}`, false);
                        }
                    } else if (d.lineupVersion && d.lineupVersion > serverLineupVersion && !isSavingToServer) {
                        fetchServerLineupSnapshot();
                        if (d.lastHitEvent && (Date.now() - d.lastHitEvent.ts) < 12000 && d.lastHitEvent.attackerName) {
                            flashStatus(`✅ ${d.lastHitEvent.attackerName} landed #${d.lastHitEvent.chain}!${d.lastHitEvent.nextUp ? ' Next UP: ' + d.lastHitEvent.nextUp : ''}`, false);
                        }
                    }
                } catch (e) {}
            },
            onerror() {}
        });
    }

    function pollBackendAttacks(minChain = 0) {
        const qs = minChain > 0 ? `?minChain=${encodeURIComponent(minChain)}` : '';
        const seqAtStart = localMutationSeq;
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${SERVER_BASE}/api/chain/attacks${qs}`,
            headers: { 'x-api-key': apiKey || '' },
            timeout: 5000,
            onload(res) {
                try {
                    const d = JSON.parse(res.responseText);
                    if (d?.factionId) {
                        myFactionId = String(d.factionId);
                        GM_setValue('sv_my_fac_id', myFactionId);
                    }
                    if (d && d.attacks) processAttacks(d.attacks);
                    if (d?.lineupData && d.lineupVersion > serverLineupVersion && !isSavingToServer) {
                        applyServerLineupPayload(d.lineupData, seqAtStart);
                    } else if (d?.lineupVersion && d.lineupVersion > serverLineupVersion && !isSavingToServer) {
                        fetchServerLineupSnapshot();
                    }
                } catch (e) {}
            },
            onerror() {}
        });
    }

    function pollDirectEnemyFaction() {
        const targetFac = getActiveEnemyFactionId();
        if (!apiKey || !targetFac) return;
        tornGet(`/faction/${targetFac}?selections=basic,timestamp`, (err, d) => {
            if (!err && d && d.members) {
                enemyFacName = d.name || enemyFacName;
                updateEnemyBadgeUI();
                processDirectEnemyMembers(d.members, targetFac, enemyFacName, Number(d.timestamp) || 0);
            }
        });
    }

    function pollChainAndAttacks() {
        const targetMin = Math.max(chainCount, highestConfirmedChain);
        // Single unified uncached backend poll (chain + recent attacks + med-outs + inline lineup)
        syncBackendTelemetry(true, targetMin > lastProcessedChain ? targetMin : 0);

        // Optional personal uncached direct Torn poll when member has an API key & attacks need catching up
        if (apiKey && hasAttacksAccess && chainActive && targetMin > lastProcessedChain) {
            const fromSec = Math.floor(Date.now() / 1000) - 360;
            tornGet(`/faction/?selections=basic,attacks,chain,timestamp&from=${fromSec}`, (err, d) => {
                if (err) {
                    if (err.code === 16 || err.code === 7 || (err.error && /access|permission/i.test(err.error))) {
                        hasAttacksAccess = false;
                    }
                    return;
                }
                if (d) handleChainResponse(d);
            });
        }
    }

    function handleChainResponse(d) {
        if (d.ID) {
            myFactionId = String(d.ID);
            GM_setValue('sv_my_fac_id', myFactionId);
        }
        if (d.name) {
            myFactionName = String(d.name);
            GM_setValue('sv_my_fac_name', myFactionName);
        }
        applyChainStateFromApi(d.chain, d.timestamp);

        if (d.attacks) processAttacks(Object.values(d.attacks));
        renderChainBar();
        updateMinDisplay();
    }

    function handleMembersResponse(d) {
        if (!d || !d.members) return;
        const facIdVal = d.ID || d.factionId;
        if (facIdVal) {
            myFactionId = String(facIdVal);
            GM_setValue('sv_my_fac_id', myFactionId);
        }
        const facNameVal = d.name || d.factionName;
        if (facNameVal) {
            myFactionName = String(facNameVal);
            GM_setValue('sv_my_fac_name', myFactionName);
        }

        // Auto-detect active ranked war enemy if present
        if (d.rankedwars && !customEnemyFacId) {
            const myId = d.ID ? String(d.ID) : null;
            const wars = Object.values(d.rankedwars);
            const active = wars.find(w => w?.war && (!w.war.winner || w.war.winner === 0) && (!w.war.end || w.war.end === 0));
            if (active && active.factions && myId) {
                const opp = Object.keys(active.factions).find(id => String(id) !== myId);
                if (opp) {
                    autoEnemyFacId = opp;
                    enemyFacName = active.factions[opp]?.name || enemyFacName;
                    updateEnemyBadgeUI();
                }
            }
        }

        factionMembers = Object.entries(d.members).map(([id, m]) => ({
            id: parseInt(id, 10),
            name: m.name,
            online: (m.last_action || {}).status || 'Offline',
            state: (m.status || {}).state || 'Okay',
            until: (m.status || {}).until || 0,
            lastActionTs: (m.last_action || {}).timestamp || 0
        })).sort((a, b) => a.name.localeCompare(b.name));

        // Backfill missing IDs in existing lineup entries
        for (const lm of lineup) {
            if (!lm.id && lm.name) {
                const found = factionMembers.find(fm => fm.name.toLowerCase() === lm.name.toLowerCase());
                if (found) lm.id = found.id;
            }
        }

        try {
            localStorage.setItem(LS_KEY_MEMBERS, JSON.stringify(factionMembers));
            GM_setValue(LS_KEY_MEMBERS, JSON.stringify(factionMembers));
        } catch (e) {}

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
            tornGet('/faction/?selections=basic,rankedwars', (err, d) => {
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
                } catch (e) {}
            },
            onerror() {}
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  PERSISTENCE & SERVER SYNC
    // ══════════════════════════════════════════════════════════════
    function save(hitChain = 0) {
        localMutationSeq++;
        GM_setValue('sv_state', JSON.stringify({
            lineup, targetHitTime, cycleNum, loopMode, autoMode,
            autoSendOnPost, soundEnabled, autoCallMedOut, customEnemyFacId, runOnAllPages
        }));
        GM_setValue('sv_autosend', autoSendOnPost);
        GM_setValue('sv_sound', soundEnabled);
        setStoredAutoCallMedOut(autoCallMedOut);
        GM_setValue('sv_enemy_fac_id', customEnemyFacId);
        GM_setValue('sv_all_pages', runOnAllPages);

        syncToServer(hitChain);

        if (broadcastChan) {
            try {
                broadcastChan.postMessage({
                    type: 'LINEUP_UPDATED',
                    lineup,
                    cycleNum,
                    loopMode,
                    autoMode,
                    autoSendOnPost,
                    autoCallMedOut,
                    soundEnabled,
                    targetHitTime,
                    _tabId: _TAB_ID
                });
            } catch (e) {}
        }
    }

    function load() {
        loadChainCursor();
        try {
            const raw = GM_getValue('sv_state', '{}');
            const d = JSON.parse(raw);
            if (d.lineup) lineup = d.lineup;
            if (d.targetHitTime !== undefined) targetHitTime = d.targetHitTime;
            if (d.cycleNum) cycleNum = d.cycleNum;
            if (d.loopMode !== undefined) loopMode = d.loopMode;
            if (d.autoMode !== undefined) autoMode = d.autoMode;
            if (d.autoSendOnPost !== undefined) autoSendOnPost = d.autoSendOnPost;
            if (d.soundEnabled !== undefined) soundEnabled = d.soundEnabled;
            if (d.customEnemyFacId !== undefined) customEnemyFacId = d.customEnemyFacId;
            if (d.runOnAllPages !== undefined) runOnAllPages = d.runOnAllPages;
        } catch (e) {}
        // Dedicated key is always authoritative over sv_state so stale tabs never disable Auto-Call
        autoCallMedOut = getStoredAutoCallMedOut();

        try {
            const cm = localStorage.getItem(LS_KEY_MEMBERS) || GM_getValue(LS_KEY_MEMBERS, '[]');
            factionMembers = JSON.parse(cm) || [];
            for (const m of factionMembers) {
                memberStatuses[String(m.id)] = {
                    online: m.online, state: m.state, until: m.until || 0, lastActionTs: m.lastActionTs || 0
                };
            }
        } catch (e) {}
    }

    function syncToServer(hitChain = 0) {
        const full = _buildFullText();
        const compact = _buildCompactText();
        isSavingToServer = true;
        try {
            const body = JSON.stringify({
                lineup,
                targetHitTime,
                cycle: cycleNum,
                loopMode,
                autoMode,
                autoCallMedOut,
                formattedFull: full,
                formattedCompact: compact,
                hitChain: hitChain || 0,
                chainStart: currentChainStart || 0
            });
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${SERVER_BASE}/api/chain/lineup`,
                headers: { 'Content-Type': 'application/json' },
                data: body,
                timeout: 3500,
                onload(res) {
                    isSavingToServer = false;
                    try {
                        const d = JSON.parse(res.responseText);
                        if (d && d.alreadyRotated && d.data && Array.isArray(d.data.lineup)) {
                            serverLineupVersion = d.version || serverLineupVersion;
                            lineup = d.data.lineup;
                            if (d.data.cycle) cycleNum = d.data.cycle;
                            renderLineup();
                            renderChainBar();
                        } else if (d && d.version) {
                            serverLineupVersion = d.version;
                        }
                    } catch (e) {}
                },
                onerror() { isSavingToServer = false; }
            });
        } catch (e) { isSavingToServer = false; }
    }

    // ══════════════════════════════════════════════════════════════
    //  PLAYER READINESS
    // ══════════════════════════════════════════════════════════════
    function getMemberReadiness(id, name) {
        let st = id ? memberStatuses[String(id)] : null;
        if (!st && name && factionMembers.length) {
            const fm = factionMembers.find(m => m.name.toLowerCase() === name.toLowerCase());
            if (fm) st = { online: fm.online, state: fm.state, until: fm.until || 0, lastActionTs: fm.lastActionTs || 0 };
        }
        if (!st) {
            return { online: 'Online', state: 'Okay', isReady: true, statusText: 'READY', shortText: 'READY', dotColor: '#10b981', cls: 'st-ready' };
        }

        const online = st.online || 'Offline';
        const state  = st.state || 'Okay';
        const until  = st.until || 0;
        const now    = Math.floor(Date.now() / 1000);

        let hospMins = 0;
        if (state === 'Hospital' && until > now) hospMins = Math.ceil((until - now) / 60);

        if (state === 'Hospital') {
            const timeStr = hospMins > 0 ? ` ${hospMins}m` : '';
            return { online, state, isReady: false, statusText: `HOSP${timeStr}`, shortText: `HOSP${timeStr}`, dotColor: '#ef4444', cls: 'st-hosp', hospMins };
        }
        if (state === 'Traveling' || state === 'Abroad') {
            return { online, state, isReady: false, statusText: 'TRAVELING', shortText: 'TRAVEL', dotColor: '#38bdf8', cls: 'st-travel' };
        }
        if (state === 'Jail' || state === 'Federal') {
            return { online, state, isReady: false, statusText: 'JAIL', shortText: 'JAIL', dotColor: '#ef4444', cls: 'st-jail' };
        }
        if (online === 'Online') {
            return { online, state, isReady: true, statusText: 'ONLINE', shortText: 'ONLINE', dotColor: '#10b981', cls: 'st-ready' };
        }
        if (online === 'Idle') {
            return { online, state, isReady: true, statusText: 'IDLE', shortText: 'IDLE', dotColor: '#f59e0b', cls: 'st-idle' };
        }
        return { online: 'Offline', state, isReady: false, statusText: 'OFFLINE', shortText: 'OFFLINE', dotColor: '#64748b', cls: 'st-offline' };
    }

    // ══════════════════════════════════════════════════════════════
    //  LINEUP MUTATIONS
    // ══════════════════════════════════════════════════════════════
    function addMember(name, id) {
        name = (name || '').trim();
        if (!name) return;
        if (lineup.some(m => m.name.toLowerCase() === name.toLowerCase())) {
            flashStatus(`${name} is already in queue.`, true);
            return;
        }
        lineup.push({ name, id: id || null, hit: false, skipped: false, hitsSession: 0 });
        save();
        renderLineup();
        flashStatus(`Added ${name} to queue.`, false);
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
        flashStatus(`Skipped ${s.name}. UP: ${lineup[0] ? lineup[0].name : 'none'}`, false);
    }

    function makeCurrent(idx) {
        if (idx <= 0 || idx >= lineup.length) return;
        const item = lineup.splice(idx, 1)[0];
        lineup.unshift(item);
        save();
        renderLineup();
        flashStatus(`${item.name} promoted to UP NOW.`, false);
    }

    function swapTopTwo() {
        if (lineup.length < 2) return;
        [lineup[0], lineup[1]] = [lineup[1], lineup[0]];
        save();
        renderLineup();
        flashStatus(`Swapped ${lineup[0].name} & ${lineup[1].name}.`, false);
    }

    function nextTurn() {
        if (!lineup.length) return;
        const [s] = lineup.splice(0, 1);
        lineup.push(s);
        save();
        renderLineup();
        flashStatus(`Rotated: ${s.name} -> bottom.`, false);
    }

    function forceMarkHitAndRotate() {
        if (!lineup.length) return;
        const [hitter] = lineup.splice(0, 1);
        hitter.hit = true;
        hitter.hitsSession = (hitter.hitsSession || 0) + 1;
        if (loopMode) lineup.push(hitter);
        cycleNum++;
        playSuccessChime();
        setDirty(true);
        save();
        renderLineup();
        renderChainBar();
        const nextUp = lineup[0] ? lineup[0].name : 'Queue Empty';
        flashStatus(`✅ ${hitter.name} hit! Next UP: ${nextUp}`, false);
        if (autoSendOnPost) setTimeout(() => postToChat(), 150);
    }

    function resetHits() {
        lineup.forEach(m => { m.hit = false; m.skipped = false; m.hitsSession = 0; });
        cycleNum = 1;
        save();
        renderLineup();
        flashStatus('Session hit marks reset.', false);
    }

    function clearAll() {
        if (!confirm('Clear all hitters from the chain lineup?')) return;
        lineup = [];
        cycleNum = 1;
        save();
        renderLineup();
        flashStatus('Lineup cleared.', false);
    }

    function autoFill() {
        if (!factionMembers.length) {
            flashStatus('Loading faction roster...', false);
            fetchFactionMembers();
            return;
        }
        lineup = lineup.filter(lm => {
            const mem = factionMembers.find(fm => (lm.id && fm.id === lm.id) || fm.name.toLowerCase() === lm.name.toLowerCase());
            if (!mem) return false;
            return (mem.state || 'Okay') === 'Okay' && (mem.online === 'Online' || mem.online === 'Idle');
        });
        for (const lm of lineup) { lm.hit = false; lm.skipped = false; }

        const capable = factionMembers
            .filter(m => (m.state || 'Okay') === 'Okay' && (m.online === 'Online' || m.online === 'Idle'))
            .sort((a, b) => {
                if (a.online === 'Online' && b.online !== 'Online') return -1;
                if (a.online !== 'Online' && b.online === 'Online') return 1;
                return (b.lastActionTs || 0) - (a.lastActionTs || 0);
            });

        let added = 0;
        for (const m of capable) {
            if (!lineup.some(lm => (lm.id && lm.id === m.id) || lm.name.toLowerCase() === m.name.toLowerCase())) {
                lineup.push({ name: m.name, id: m.id, hit: false, skipped: false, hitsSession: 0 });
                added++;
            }
        }
        cycleNum = 1;
        save();
        renderLineup();
        flashStatus(`⚡ Filled ${lineup.length} ready hitters (+${added} new).`, false);
    }

    function sortReadyToTop() {
        if (lineup.length <= 1) return;
        const ready = [], other = [];
        for (const m of lineup) (getMemberReadiness(m.id, m.name).isReady ? ready : other).push(m);
        lineup = [...ready, ...other];
        save();
        renderLineup();
        flashStatus(`Sorted ${ready.length} ready hitter(s) to top.`, false);
    }

    function autoSkipUnavailMembers() {
        if (!lineup.length) return;
        let skippedCount = 0;
        const ready = [], unavail = [];
        for (const m of lineup) {
            if (!getMemberReadiness(m.id, m.name).isReady) {
                m.skipped = true;
                unavail.push(m);
                skippedCount++;
            } else ready.push(m);
        }
        if (!skippedCount) return;
        lineup = [...ready, ...unavail];
        showHospBanner = false;
        save();
        renderLineup();
        flashStatus(`Moved ${skippedCount} unavailable hitter(s) to bottom.`, false);
    }

    // ══════════════════════════════════════════════════════════════
    //  WALL-CLOCK TIMER & SMART WATCHDOG
    // ══════════════════════════════════════════════════════════════
    function tickWallClockTimers() {
        const nowMs = Date.now();
        if (cooldownDeadlineMs > 0) {
            chainCooldown = Math.max(0, Math.round((cooldownDeadlineMs - nowMs) / 1000));
            chainTimeout = 0;
            if (chainCooldown === 0) cooldownDeadlineMs = 0;
        } else if (chainActive && chainDeadlineMs > 0) {
            chainCooldown = 0;
            chainTimeout = Math.max(0, Math.round((chainDeadlineMs - nowMs) / 1000));
            if (chainTimeout === 60 && !warnedAt60) {
                warnedAt60 = true;
                playPanicWarningBeep();
            } else if (chainTimeout > 65) {
                warnedAt60 = false;
            }
        }
        if (upcomingHospExits.length) {
            const nowSec = Math.floor(nowMs / 1000);
            upcomingHospExits = upcomingHospExits
                .map(x => ({ ...x, secondsLeft: Math.max(0, x.until - nowSec) }))
                .filter(x => x.secondsLeft > 0);
        }
        renderChainBar();
        updateMinDisplay();
        if (activeTab === 'radar') renderRadarTab();
        checkAutoSkipWatchdog();
    }

    function startLocalTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(tickWallClockTimers, 1000);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                tickWallClockTimers();
                syncBackendTelemetry(false);
            }
        });
    }

    let lastAutoSkipTs = 0;
    function checkAutoSkipWatchdog() {
        if (!autoMode || !chainActive || !lineup.length) return;
        const up = lineup[0];
        const readiness = getMemberReadiness(up.id, up.name);
        const targetSecs = parseTimeToSecs(targetHitTime) || 150;

        // If the UP hitter IS ready and chain timer is critical (< 45s), sound alarm instead of scrambling queue!
        if (readiness.isReady) {
            if (chainTimeout > 0 && chainTimeout <= 45 && (Date.now() - warnedEmergency > 8000)) {
                warnedEmergency = Date.now();
                playPanicWarningBeep();
                flashStatus(`🚨 EMERGENCY: ${up.name} — HIT NOW (${fmtSecs(chainTimeout)} left)!`, true);
            }
            return;
        }

        // Only auto-skip UNAVAILABLE player if someone ready exists further down!
        if (Date.now() - lastAutoSkipTs < 6000) return;
        const firstReadyIdx = lineup.findIndex((m, i) => i > 0 && getMemberReadiness(m.id, m.name).isReady);
        if (firstReadyIdx === -1) return;

        if (chainTimeout > 0 && (chainTimeout <= targetSecs || chainTimeout <= 60)) {
            lastAutoSkipTs = Date.now();
            const [unavail] = lineup.splice(0, 1);
            unavail.skipped = true;
            lineup.push(unavail);
            if (firstReadyIdx > 1) {
                const newReadyIdx = firstReadyIdx - 1;
                const [readyNext] = lineup.splice(newReadyIdx, 1);
                lineup.unshift(readyNext);
            }
            save();
            renderLineup();
            flashStatus(`⏭ Skipped ${unavail.name} (${readiness.shortText}) -> UP: ${lineup[0].name}`, false);
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  FACTION CHAT POSTING (BUG FIX #7 — REACT SAFE + FACTION-ONLY)
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

    function getChatRootEl() {
        return document.querySelector('#chatRoot, [id*="chatRoot" i], [class*="chat-app" i], [class*="chatRoot" i]');
    }

    function isElementHiddenByCSS(el, stopAt) {
        let cur = el;
        while (cur && cur !== document.documentElement) {
            if (cur.hidden) return true;
            const cs = window.getComputedStyle(cur);
            if (cs.display === 'none' || cs.visibility === 'hidden') return true;
            if (stopAt && cur === stopAt) break;
            cur = cur.parentElement;
        }
        return false;
    }

    function getVisibleChatInputs(root) {
        if (!root) return [];
        const raw = root.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""], [role="textbox"], input[type="text"]');
        const out = [];
        const docHidden = Boolean(document.hidden);
        for (const el of raw) {
            if (el.closest('#sv-chain-hud')) continue;
            const ph = `${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`;
            if (/\b(search|filter|find\s+player|add\s+person)\b/i.test(ph)) continue;
            if (isElementHiddenByCSS(el, root)) continue;
            if (!docHidden) {
                const rect = el.getBoundingClientRect();
                if (rect.width < 20 || rect.height < 10) continue;
            }
            out.push(el);
        }
        return out;
    }

    function isolateChatPanel(inp, allInputs, root) {
        let cur = inp.parentElement;
        let best = inp.parentElement || root;
        while (cur && cur !== root && cur !== document.body) {
            const contained = allInputs.filter(o => cur.contains(o)).length;
            if (contained > 1) break;
            best = cur;
            cur = cur.parentElement;
        }
        return best;
    }

    function isNonFactionRoomLabel(txt) {
        return /^\s*(global|trade|newbies|hospital|jail|poker|politics|elimination|official|travel)\b/i.test((txt || '').trim());
    }

    function matchesFactionRoomLabel(txt) {
        const s = (txt || '').trim();
        if (!s) return false;
        if (/\bfaction\b/i.test(s)) return true;
        if (myFactionName && s.toLowerCase().includes(myFactionName.toLowerCase())) return true;
        return false;
    }

    function getPanelHeaderText(panel) {
        if (!panel) return '';
        const panelRect = panel.getBoundingClientRect();
        const parts = [];
        if (panel.getAttribute('aria-label')) parts.push(panel.getAttribute('aria-label'));
        const labeled = panel.querySelectorAll('[class*="header" i], [class*="title" i], [class*="name" i], [aria-selected="true"], [data-state="active"], [class*="active" i]');
        for (const el of labeled) {
            const t = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.trim();
            if (t && t.length < 80) parts.push(t);
        }
        // Scan elements positioned in the top 70px header bar of the chat panel
        const topEls = panel.querySelectorAll('div, span, button, p, h1, h2, h3, h4, a');
        for (const el of topEls) {
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.top >= panelRect.top - 4 && r.top <= panelRect.top + 65 && r.bottom <= panelRect.top + 98) {
                const t = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.trim();
                if (t && t.length < 60) parts.push(t);
            }
        }
        return parts.join(' | ');
    }

    function findFactionChatInput() {
        const chatRoot = getChatRootEl();
        if (!chatRoot) return null;

        const inputs = getVisibleChatInputs(chatRoot);
        if (!inputs.length) return null;

        // Pass 1: Explicit Faction label match inside each isolated chat panel (works across Chat 2.0, Chat 3.0, PDA)
        for (const inp of inputs) {
            const panel = isolateChatPanel(inp, inputs, chatRoot);
            const inpMeta = `${inp.getAttribute('placeholder') || ''} ${inp.getAttribute('aria-label') || ''}`;
            const headerTxt = `${getPanelHeaderText(panel)} | ${inpMeta}`;
            if (matchesFactionRoomLabel(headerTxt)) {
                return { target: inp, box: panel };
            }
        }

        // Pass 2: Single-panel Chat 3.0 fallback (e.g. tabbed chat dock with a single active textarea)
        if (inputs.length === 1) {
            const panel = isolateChatPanel(inputs[0], inputs, chatRoot);
            const activeTabs = chatRoot.querySelectorAll('[aria-selected="true"], [data-state="active"], [class*="active" i]');
            let sawExplicitNonFaction = false;
            for (const t of activeTabs) {
                if (t.contains(inputs[0])) continue;
                const lbl = `${t.textContent || ''} ${t.getAttribute('aria-label') || ''} ${t.getAttribute('title') || ''}`.trim();
                if (matchesFactionRoomLabel(lbl)) return { target: inputs[0], box: panel };
                if (isNonFactionRoomLabel(lbl)) sawExplicitNonFaction = true;
            }
            if (!sawExplicitNonFaction) {
                const headerTxt = getPanelHeaderText(panel);
                if (!isNonFactionRoomLabel(headerTxt)) {
                    return { target: inputs[0], box: panel };
                }
            }
        }

        return null;
    }

    function triggerMouseClick(el, win) {
        if (!el) return;
        const w = win || el.ownerDocument?.defaultView || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
        try {
            if (typeof w.PointerEvent === 'function') {
                el.dispatchEvent(new w.PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: w, pointerId: 1 }));
            }
            el.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: w, buttons: 1 }));
            if (typeof w.PointerEvent === 'function') {
                el.dispatchEvent(new w.PointerEvent('pointerup', { bubbles: true, cancelable: true, view: w, pointerId: 1 }));
            }
            el.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: w, buttons: 1 }));
            el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w, buttons: 1 }));
            if (typeof el.click === 'function') el.click();
        } catch (e) {
            try { el.click(); } catch (_) {}
        }
    }

    function dispatchPageEnterKey(target, win) {
        const w = win || target.ownerDocument?.defaultView || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
        for (const type of ['keydown', 'keypress', 'keyup']) {
            try {
                const ev = new w.KeyboardEvent(type, {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    charCode: 13,
                    shiftKey: false,
                    ctrlKey: false,
                    altKey: false,
                    metaKey: false,
                    bubbles: true,
                    cancelable: true,
                    composed: true
                });
                // Lock keyCode/which/charCode across Tampermonkey unsafeWindow wrappers for React 18 listeners
                for (const prop of ['keyCode', 'which', 'charCode']) {
                    try {
                        if (ev[prop] !== 13) Object.defineProperty(ev, prop, { get: () => 13 });
                    } catch (_) {}
                }
                target.dispatchEvent(ev);
            } catch (_) {}
        }
    }

    function getChatInputRemaining(target, isCE) {
        return (isCE ? (target.textContent || '') : (target.value || '')).trim();
    }

    function findFooterSendButton(target, box) {
        const scope = box || target.parentElement?.parentElement || target.parentElement;
        if (!scope) return null;
        const boxRect = scope.getBoundingClientRect();

        // 1. Semantic send button match inside panel footer
        const semantic = scope.querySelectorAll('button[type="submit"], button[aria-label*="send" i], button[title*="send" i], [class*="send" i], [data-testid*="send" i]');
        for (const btn of semantic) {
            if (btn.disabled || btn === target || btn.closest('#sv-chain-hud')) continue;
            const cs = window.getComputedStyle(btn);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const r = btn.getBoundingClientRect();
            if (!document.hidden && (r.width === 0 || r.height === 0)) continue;
            if (!boxRect.height || document.hidden || r.top >= boxRect.top + 30) {
                return btn;
            }
        }

        // 2. Structural proximity match: footer SVG action button next to the input
        const inpRow = target.parentElement?.parentElement || target.parentElement;
        if (inpRow) {
            const btns = inpRow.querySelectorAll('button, [role="button"]');
            const candidates = [];
            for (const btn of btns) {
                if (btn.disabled || btn === target || btn.contains(target)) continue;
                const meta = `${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''} ${btn.className || ''}`;
                if (/(close|minim|collapse|emoji|smile|attach|file|upload|setting|clear|trash|mute|search)/i.test(meta)) continue;
                if (btn.querySelector('svg') || btn.getAttribute('type') === 'submit') {
                    candidates.push(btn);
                }
            }
            if (candidates.length) {
                return candidates[candidates.length - 1];
            }
        }
        return null;
    }

    function triggerChatSubmit(target, box, win, isCE) {
        const btn = findFooterSendButton(target, box);
        if (btn) triggerMouseClick(btn, win);
        if (getChatInputRemaining(target, isCE).length > 0) {
            dispatchPageEnterKey(target, win);
        }
        if (getChatInputRemaining(target, isCE).length > 0 && target.form) {
            try {
                if (typeof target.form.requestSubmit === 'function') target.form.requestSubmit();
                else target.form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
            } catch (_) {}
        }
    }

    function openMinimizedFactionChatTab(chatRoot) {
        if (!chatRoot) return false;
        const openInputs = getVisibleChatInputs(chatRoot);
        const openFactionPanels = openInputs
            .map(i => isolateChatPanel(i, openInputs, chatRoot))
            .filter(p => matchesFactionRoomLabel(getPanelHeaderText(p)));
        const candidates = [];
        const nodes = chatRoot.querySelectorAll('button, a, [role="button"], [role="tab"], [class*="tab" i], [class*="minimized" i], [class*="channel" i], [class*="room" i], [class*="dock" i], [class*="item" i], [class*="header" i]');
        for (const el of nodes) {
            if (el.closest('#sv-chain-hud') || isElementHiddenByCSS(el, chatRoot)) continue;
            if (el.closest('[class*="message" i], [class*="history" i], [class*="scroll" i], [class*="feed" i], textarea, [contenteditable]')) continue;
            if (openFactionPanels.some(p => p.contains(el))) continue;
            const meta = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
            if (/\b(close|dismiss|setting|mute|search)\b/i.test(meta)) continue;
            const rawLbl = `${el.textContent || ''} ${meta}`.trim();
            if (!rawLbl || rawLbl.length > 50 || isNonFactionRoomLabel(rawLbl)) continue;
            if (matchesFactionRoomLabel(rawLbl)) {
                candidates.push({ el, len: rawLbl.length });
            }
        }
        if (!candidates.length) return false;
        // Prefer the tightest label element first, then click both it and its clickable dock wrapper
        candidates.sort((a, b) => a.len - b.len);
        const picked = candidates[0].el;
        const wrapper = picked.closest('button, [role="button"], [role="tab"], [class*="minimized" i], [class*="tab" i], [class*="channel" i], [class*="item" i]');
        triggerMouseClick(picked);
        if (wrapper && wrapper !== picked && !openFactionPanels.some(p => p.contains(wrapper))) {
            triggerMouseClick(wrapper);
        }
        return true;
    }

    function injectAndSendChatText(target, box, fullText, compactText, customText, shouldSend) {
        const win = target.ownerDocument?.defaultView || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
        navigator.clipboard?.writeText(fullText).catch(() => {});
        try { target.focus(); } catch (_) {}

        const isCE = Boolean(target.isContentEditable || target.getAttribute('contenteditable') !== null);
        if (isCE) {
            const chatStr = customText || compactText || fullText.replace(/\n+/g, ' | ');
            try {
                const sel = win.getSelection();
                const range = document.createRange();
                range.selectNodeContents(target);
                sel.removeAllRanges();
                sel.addRange(range);
                const ok = document.execCommand('insertText', false, chatStr);
                if (!ok || !(target.textContent || '').trim()) {
                    try {
                        const dt = new win.DataTransfer();
                        dt.setData('text/plain', chatStr);
                        target.dispatchEvent(new win.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
                    } catch (_) {}
                    if (!(target.textContent || '').trim()) {
                        target.textContent = chatStr;
                    }
                    target.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: chatStr }));
                }
            } catch (_) {
                target.textContent = chatStr;
                target.dispatchEvent(new win.Event('input', { bubbles: true }));
            }
        } else {
            const prevVal = target.value || '';
            const proto = Object.getPrototypeOf(target);
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
                Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement?.prototype || HTMLTextAreaElement.prototype, 'value')?.set ||
                Object.getOwnPropertyDescriptor(win.HTMLInputElement?.prototype || HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(target, fullText);
            else target.value = fullText;
            if (target._valueTracker) {
                try { target._valueTracker.setValue(prevVal); } catch (_) {}
            }
            try {
                target.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: fullText }));
            } catch (_) {
                target.dispatchEvent(new win.Event('input', { bubbles: true }));
            }
            target.dispatchEvent(new win.Event('change', { bubbles: true }));
            try { target.setSelectionRange(fullText.length, fullText.length); } catch (_) {}
        }

        if (!customText) setDirty(false);

        if (shouldSend) {
            // Execute synchronously first (critical when browser tab is minimized & timers are throttled)
            Promise.resolve().then(() => {
                triggerChatSubmit(target, box, win, isCE);
            });
            setTimeout(() => {
                if (getChatInputRemaining(target, isCE).length > 0) {
                    triggerChatSubmit(target, box, win, isCE);
                }
            }, 45);
            setTimeout(() => {
                if (getChatInputRemaining(target, isCE).length > 0) {
                    triggerChatSubmit(target, box, win, isCE);
                }
            }, 125);
            flashStatus(customText ? '🚨 Sent med-out callout to Faction Chat!' : '✓ Lineup sent to Faction Chat!', false);
        } else {
            flashStatus('✓ Inserted in Faction Chat — press Enter to send!', false);
        }
    }

    function postToChat(customText = null, forceAutoSend = false, onResult = null) {
        const fullText = customText || _buildFullText();
        const compactText = customText || _buildCompactText();
        if (!fullText) {
            flashStatus('Lineup is empty.', true);
            if (typeof onResult === 'function') onResult(false);
            return;
        }

        const shouldSend = Boolean(forceAutoSend === true || autoSendOnPost === true);
        const chatRoot = getChatRootEl();
        if (!chatRoot) {
            navigator.clipboard?.writeText(fullText).catch(() => {});
            flashStatus('📋 Faction Chat unavailable here — copied to clipboard!', false);
            if (typeof onResult === 'function') onResult(false);
            return;
        }

        // Check immediately BEFORE clicking any dock/tab button so an open Faction panel is never minimized!
        const immediate = findFactionChatInput();
        if (immediate && immediate.target) {
            injectAndSendChatText(immediate.target, immediate.box, fullText, compactText, customText, shouldSend);
            if (typeof onResult === 'function') onResult(true);
            return;
        }

        // Un-minimize Faction Chat dock tab when collapsed
        openMinimizedFactionChatTab(chatRoot);

        let done = false;
        let attempts = 0;
        const finishAttempt = () => {
            if (done) return;
            const found = findFactionChatInput();
            if (found && found.target) {
                done = true;
                clearInterval(tryFindTimer);
                injectAndSendChatText(found.target, found.box, fullText, compactText, customText, shouldSend);
                if (typeof onResult === 'function') onResult(true);
                return;
            }
            attempts++;
            if (attempts === 4 || attempts === 8) {
                openMinimizedFactionChatTab(chatRoot);
            }
            if (attempts >= 14) {
                done = true;
                clearInterval(tryFindTimer);
                navigator.clipboard?.writeText(fullText).catch(() => {});
                flashStatus('📋 Open Faction Chat tab to auto-send — copied to clipboard!', false);
                if (typeof onResult === 'function') onResult(false);
            }
        };

        // Fast micro-check in case Torn mounts the chat box immediately after click, plus polling fallback
        setTimeout(finishAttempt, 25);
        const tryFindTimer = setInterval(finishAttempt, 90);
    }

    function copyToClipboard(type) {
        const text = type === 'compact' ? _buildCompactText() : _buildFullText();
        if (!text) { flashStatus('Lineup is empty.', true); return; }
        navigator.clipboard.writeText(text).then(() => flashStatus('Copied lineup to clipboard!', false)).catch(() => {});
    }

    // ══════════════════════════════════════════════════════════════
    //  UI RENDERING
    // ══════════════════════════════════════════════════════════════
    function renderChainBar() {
        const bar = document.getElementById('sv-chain-bar');
        if (!bar) return;

        const timerSecs = chainCooldown > 0 ? chainCooldown : chainTimeout;
        const targetSecs = parseTimeToSecs(targetHitTime);
        const inWindow = chainCooldown === 0 && targetHitTime && timerSecs > 0 && timerSecs <= targetSecs;

        let timerColor = '#10b981';
        let timerStateCls = 'sv-timer-safe';
        if (chainCooldown > 0) {
            timerColor = '#94a3b8';
            timerStateCls = 'sv-timer-cooldown';
        } else if (timerSecs > 0 && timerSecs <= 90) {
            timerColor = '#ef4444';
            timerStateCls = 'sv-timer-critical';
        } else if (timerSecs > 90 && timerSecs <= 150) {
            timerColor = '#f59e0b';
            timerStateCls = 'sv-timer-warn';
        }

        const mult = getRespectMultiplier(chainCount);
        const bonus = getNextBonus(chainCount);

        bar.innerHTML = `
            <div class="sv-hero-card ${timerStateCls}">
                <div class="sv-hero-top">
                    <div class="sv-hero-chain">
                        <div class="sv-hero-chain-row">
                            <span class="sv-chain-num">${chainCooldown > 0 ? 'COOLDOWN' : (chainActive ? chainCount.toLocaleString() : '0')}</span>
                            ${chainCooldown === 0 ? `<span class="sv-mult-badge">${mult}</span>` : ''}
                        </div>
                        <div class="sv-hero-sub">${chainCooldown > 0 ? 'Chain recovery' : `${bonus.text} milestone`}</div>
                    </div>
                    <div class="sv-hero-timer-wrap">
                        <div class="sv-hero-timer" style="color:${timerColor};">${chainActive || chainCooldown > 0 ? fmtSecs(timerSecs) : '0:00'}</div>
                        <div class="sv-hero-timer-sub">
                            ${inWindow ? '<span class="sv-hit-now-pill">🎯 HIT NOW</span>' : (targetHitTime ? `Hit at ${targetHitTime}` : 'No target')}
                        </div>
                    </div>
                </div>
                <div class="sv-progress-track" title="${bonus.pct.toFixed(0)}% to next milestone">
                    <div class="sv-progress-fill" style="width:${bonus.pct.toFixed(1)}%;"></div>
                </div>
            </div>
        `;
    }

    function renderMedOutBanner() {
        const slot = document.getElementById('sv-medout-alert-slot');
        if (!slot) return;
        if (!activeMedAlert) {
            slot.innerHTML = '';
            slot.style.display = 'none';
            return;
        }
        const ev = activeMedAlert;
        const statusDot = ev.onlineStatus === 'Online' ? '🟢' : (ev.onlineStatus === 'Idle' ? '🟡' : '⚫');
        slot.style.display = 'block';
        slot.innerHTML = `
            <div class="sv-medout-banner">
                <div class="sv-medout-top">
                    <span class="sv-medout-pill">🚨 ${esc(ev.escapeType || 'MEDDED OUT')}</span>
                    <span class="sv-medout-saved">Saved ${esc(ev.timeSavedStr || 'Early')}</span>
                    <button class="sv-medout-dismiss" data-action="dismiss-medalert" title="Dismiss">✕</button>
                </div>
                <div class="sv-medout-body">
                    <div class="sv-medout-target">
                        <strong>${esc(ev.playerName)}</strong> <span class="sv-id-muted">[${esc(ev.playerId)}]</span>
                        <div class="sv-medout-meta">${statusDot} ${esc(ev.onlineStatus || 'Online')}${ev.level ? ` • Lv.${ev.level}` : ''}</div>
                    </div>
                    <div class="sv-medout-btns">
                        <a class="sv-btn sv-btn-attack" href="${escAttr(ev.attackUrl)}" target="_blank" rel="noopener">⚔️ Attack</a>
                        <button class="sv-btn sv-btn-call" data-action="call-medout" data-medid="${escAttr(ev.id)}" title="Post to Faction Chat">💬 Call</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderTabBadges() {
        const lTab = document.getElementById('sv-tab-lineup');
        const rTab = document.getElementById('sv-tab-radar');
        const hTab = document.getElementById('sv-tab-hits');
        if (lTab) lTab.textContent = `🎯 Lineup (${lineup.length})`;
        if (rTab) {
            const recentFresh = enemyMedOuts.filter(m => (Date.now() - m.detectedAt) < 120000).length;
            rTab.innerHTML = `💊 Med Radar${recentFresh ? ` <span class="sv-tab-hot">${recentFresh}</span>` : ` (${enemyMedOuts.length})`}`;
        }
        if (hTab) hTab.textContent = `⚡ Hits (${liveHits.length})`;
    }

    function renderLineupSummaryHtml() {
        if (!lineup.length) return '';
        let ready = 0, hosp = 0, offline = 0;
        for (const m of lineup) {
            const r = getMemberReadiness(m.id, m.name);
            if (r.isReady) ready++;
            if (r.state === 'Hospital') hosp++;
            if (r.online === 'Offline') offline++;
        }
        const unavail = lineup.length - ready;
        return `
            <div class="sv-summary-row">
                <button class="sv-chip sv-chip-ok" data-action="filter-ready" title="Sort ready hitters to top">🟢 Ready <b>${ready}</b></button>
                ${unavail > 0 ? `<button class="sv-chip sv-chip-danger" data-action="auto-skip-unavail" title="Move unavailable hitters (Hosp/Travel/Offline) to bottom">⏭ Skip Unavail (${unavail})</button>` : '<span class="sv-chip">🏥 Hosp <b>0</b></span>'}
                <span class="sv-chip">⚫ Off <b>${offline}</b></span>
            </div>
        `;
    }

    function renderLineup() {
        updateMinDisplay();
        renderTabBadges();
        const container = document.getElementById('sv-lineup-container');
        if (!container || activeTab !== 'lineup') return;

        if (!lineup.length) {
            container.innerHTML = `
                <div class="sv-empty-state">
                    <div style="font-size:20px;margin-bottom:4px;">⚡</div>
                    <div>No hitters in queue</div>
                    <div class="sv-empty-sub">Click <b>⚡ Auto-Fill Ready</b> or search below to start.</div>
                </div>
            `;
            renderChainBar();
            return;
        }

        const up = lineup[0];
        const rUp = getMemberReadiness(up.id, up.name);
        let html = renderLineupSummaryHtml();

        html += `
        <div class="sv-up-card ${!rUp.isReady ? 'sv-up-warn' : ''}" draggable="true" data-idx="0">
            <div class="sv-up-top">
                <span class="sv-up-tag">🎯 UP NOW</span>
                <div class="sv-readiness-pill ${rUp.cls}">
                    <span class="sv-dot-mini" style="background:${rUp.dotColor};"></span>${rUp.statusText}
                </div>
            </div>
            <div class="sv-up-main">
                <span class="sv-pos-pill sv-pos-1" data-action="prompt-move" data-idx="0" title="Click to move">#1</span>
                <span class="sv-up-name">${esc(up.name)}</span>
                ${up.hitsSession ? `<span class="sv-hit-badge">${up.hitsSession} hit${up.hitsSession > 1 ? 's' : ''}</span>` : ''}
            </div>
            <div class="sv-up-actions">
                <button class="sv-btn sv-btn-hit" data-action="force-hit" title="Confirm hit & rotate to next">✅ Hit & Next</button>
                <button class="sv-btn sv-btn-warn" data-action="skip" data-idx="0" title="Skip to bottom">⏭ Skip</button>
                ${lineup.length > 1 ? `<button class="sv-btn" data-action="swap-top" title="Swap with #2">⇄</button>` : ''}
                <button class="sv-btn sv-btn-del" data-action="remove" data-idx="0" title="Remove">✕</button>
            </div>
        </div>`;

        if (lineup.length > 1) {
            html += `<div class="sv-queue-list">`;
            for (let i = 1; i < lineup.length; i++) {
                const m = lineup[i];
                const rM = getMemberReadiness(m.id, m.name);
                html += `
                <div class="sv-q-row ${i === 1 ? 'sv-q-next' : ''}" draggable="true" data-idx="${i}">
                    <span class="sv-q-idx ${i === 1 ? 'sv-q-idx-next' : ''}" data-action="prompt-move" data-idx="${i}" title="Move position">${i === 1 ? 'NEXT' : '#' + (i + 1)}</span>
                    <div class="sv-q-info">
                        <span class="sv-q-name">${esc(m.name)}</span>
                        <span class="sv-q-state ${rM.cls}"><span class="sv-dot-mini" style="background:${rM.dotColor};"></span>${rM.shortText}</span>
                    </div>
                    ${m.hitsSession ? `<span class="sv-hit-mini">${m.hitsSession}✓</span>` : ''}
                    <div class="sv-q-btns">
                        <button class="sv-btn-ico" data-action="make-current" data-idx="${i}" title="Promote to UP NOW">▲</button>
                        <button class="sv-btn-ico sv-btn-del" data-action="remove" data-idx="${i}" title="Remove">✕</button>
                    </div>
                </div>`;
            }
            html += `</div>`;
        }

        container.innerHTML = html;
        renderChainBar();
    }

    function renderRadarTab() {
        const container = document.getElementById('sv-lineup-container');
        if (!container || activeTab !== 'radar') return;
        const enemyId = getActiveEnemyFactionId();

        let html = `
            <div class="sv-radar-hdr">
                <span>🎯 Tracking: <b>${enemyId ? esc(enemyFacName) + ' [' + esc(enemyId) + ']' : 'Auto-Detect (No Active War)'}</b></span>
                <button class="sv-btn sv-btn-xs" data-action="open-enemy-set">${enemyId ? 'Change' : 'Set Target'}</button>
            </div>
        `;

        if (enemyMedOuts.length) {
            html += `<div class="sv-sec-lbl">🚨 Recent Med-Outs & Revives (${enemyMedOuts.length})</div>`;
            html += enemyMedOuts.slice(0, 12).map(ev => `
                <div class="sv-radar-row sv-radar-medout">
                    <div class="sv-radar-info">
                        <div class="sv-radar-name">
                            <strong>${esc(ev.playerName)}</strong> <span class="sv-id-muted">[${esc(ev.playerId)}]</span>
                            <span class="sv-medout-tag">${esc(ev.escapeType)}</span>
                        </div>
                        <div class="sv-radar-meta">
                            ${ev.onlineStatus === 'Online' ? '🟢' : ev.onlineStatus === 'Idle' ? '🟡' : '⚫'} ${esc(ev.onlineStatus)} • Saved <b>${esc(ev.timeSavedStr)}</b> • ${fmtAgo(ev.detectedAt)}
                        </div>
                    </div>
                    <div class="sv-radar-acts">
                        <a class="sv-btn sv-btn-attack sv-btn-xs" href="${escAttr(ev.attackUrl)}" target="_blank" rel="noopener">⚔️ Attack</a>
                        <button class="sv-btn sv-btn-xs" data-action="call-medout" data-medid="${escAttr(ev.id)}" title="Post to Faction Chat">💬</button>
                    </div>
                </div>
            `).join('');
        } else {
            html += `<div class="sv-empty-mini">No early hospital escapes detected yet. Polling every 3s for med-outs & revives.</div>`;
        }

        if (upcomingHospExits.length) {
            html += `<div class="sv-sec-lbl" style="margin-top:6px;">🏥 Exiting Hospital &lt; 5m (${upcomingHospExits.length})</div>`;
            html += upcomingHospExits.slice(0, 6).map(ex => `
                <div class="sv-radar-row">
                    <div class="sv-radar-info">
                        <div class="sv-radar-name"><strong>${esc(ex.playerName)}</strong> <span class="sv-id-muted">[${esc(ex.playerId)}]</span></div>
                        <div class="sv-radar-meta">${ex.onlineStatus === 'Online' ? '🟢 Online' : '⚫ ' + esc(ex.onlineStatus)} • Free in <b style="color:#f59e0b;">${fmtSecs(ex.secondsLeft)}</b></div>
                    </div>
                    <a class="sv-btn sv-btn-xs" href="${escAttr(ex.attackUrl)}" target="_blank" rel="noopener">⚔️ Prep</a>
                </div>
            `).join('');
        }

        container.innerHTML = html;
    }

    function renderHitsTab() {
        const container = document.getElementById('sv-lineup-container');
        if (!container || activeTab !== 'hits') return;
        if (!liveHits.length) {
            container.innerHTML = `<div class="sv-empty-mini" style="padding:18px;">No recent chain hits recorded yet.</div>`;
            return;
        }
        container.innerHTML = `
            <div class="sv-hits-list">
                ${liveHits.slice(0, 20).map(h => `
                    <div class="sv-hit-row">
                        <span class="sv-hit-num">#${h.chain}</span>
                        <span class="sv-hit-player">${esc(h.attackerName)}</span>
                        <span class="sv-hit-age">${fmtAgo(h.timestamp)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderActiveTabView() {
        if (activeTab === 'lineup') renderLineup();
        else if (activeTab === 'radar') renderRadarTab();
        else renderHitsTab();
    }

    function updateEnemyBadgeUI() {
        const badge = document.getElementById('sv-enemy-badge');
        if (!badge) return;
        const eid = getActiveEnemyFactionId();
        if (eid) {
            badge.style.display = 'inline-flex';
            badge.textContent = `🎯 vs ${eid}`;
            badge.title = `Tracking Med-Outs: ${enemyFacName} [${eid}]`;
        } else {
            badge.style.display = 'none';
        }
    }

    function updateMinDisplay() {
        const timerSecs = chainCooldown > 0 ? chainCooldown : chainTimeout;
        let timerColor = '#10b981';
        let isPulsing = false;
        if (chainCooldown > 0) timerColor = '#94a3b8';
        else if (timerSecs > 0 && timerSecs <= 90) { timerColor = '#ef4444'; isPulsing = true; }
        else if (timerSecs > 90 && timerSecs <= 150) { timerColor = '#f59e0b'; }

        const minChain = document.getElementById('sv-min-chain');
        const minTimer = document.getElementById('sv-min-timer');
        const minUp    = document.getElementById('sv-min-up');
        const minMed   = document.getElementById('sv-min-med');

        if (minChain) minChain.textContent = `⚡ ${chainActive ? chainCount : 0}`;
        if (minTimer) {
            minTimer.textContent = `⏱ ${chainActive || chainCooldown > 0 ? fmtSecs(timerSecs) : '0:00'}`;
            minTimer.style.color = timerColor;
            minTimer.classList.toggle('sv-min-pulse', isPulsing);
        }
        if (minUp) {
            minUp.textContent = lineup.length ? `UP: ${lineup[0].name}` : 'UP: —';
        }
        if (minMed) {
            if (activeMedAlert) {
                minMed.style.display = 'inline-flex';
                minMed.textContent = `🚨 ${activeMedAlert.playerName}`;
                minMed.href = activeMedAlert.attackUrl;
            } else {
                minMed.style.display = 'none';
            }
        }
    }

    function setDirty(val) {
        isDirtyLineup = val;
        const dot = document.getElementById('sv-sync-dot');
        if (dot) {
            dot.className = val ? 'sv-sync-dot sv-dot-live' : 'sv-sync-dot sv-dot-synced';
            dot.title = val ? 'Lineup updated — ready to post to Faction Chat' : 'Synced';
        }
    }

    function syncTogglePillsUI() {
        const map = [
            ['sv-pill-loop', loopMode, 'Loop'],
            ['sv-pill-auto', autoMode, 'Auto'],
            ['sv-pill-autosend', autoSendOnPost, 'Send'],
            ['sv-pill-autocall', autoCallMedOut, 'Auto-Call 💊']
        ];
        for (const [id, val, lbl] of map) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.classList.toggle('sv-pill-on', Boolean(val));
            const st = el.querySelector('.sv-pill-st');
            if (st) st.textContent = val ? 'ON' : 'OFF';
        }
        const muteBtn = document.getElementById('sv-mute-btn');
        if (muteBtn) {
            muteBtn.textContent = soundEnabled ? '🔊' : '🔇';
            muteBtn.title = soundEnabled ? 'Mute tactical alerts' : 'Unmute tactical alerts';
        }
    }

    let _statusTimer = null;
    function flashStatus(msg, isError) {
        const el = document.getElementById('sv-status-msg');
        if (!el) return;
        el.textContent = msg;
        el.style.color = isError ? '#f87171' : '#34d399';
        if (_statusTimer) clearTimeout(_statusTimer);
        _statusTimer = setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
    }

    // ══════════════════════════════════════════════════════════════
    //  SUGGESTION DROPDOWN & SETTINGS
    // ══════════════════════════════════════════════════════════════
    function renderSuggest() {
        const box = document.getElementById('sv-suggest');
        if (!box || box.style.display === 'none') return;
        const val = searchQuery.toLowerCase().trim();
        const available = factionMembers.filter(m => !lineup.some(lm => (lm.id && lm.id === m.id) || lm.name.toLowerCase() === m.name.toLowerCase()));
        let matches = !val ? available.slice(0, 12) : available.filter(m => m.name.toLowerCase().includes(val)).slice(0, 16);

        if (!matches.length) {
            box.innerHTML = `<div class="sv-suggest-empty">No matching faction members</div>`;
            return;
        }
        box.innerHTML = matches.map((m, idx) => {
            const r = getMemberReadiness(m.id, m.name);
            let nameHtml = esc(m.name);
            if (val) nameHtml = nameHtml.replace(new RegExp(`(${escRe(val)})`, 'gi'), '<mark class="sv-mark">$1</mark>');
            return `
            <div class="sv-suggest-item ${idx === suggestSelected ? 'sv-suggest-sel' : ''}" data-action="add-suggest" data-name="${escAttr(m.name)}" data-id="${m.id}">
                <span class="sv-suggest-name">${nameHtml}</span>
                <span class="sv-q-state ${r.cls}"><span class="sv-dot-mini" style="background:${r.dotColor};"></span>${r.shortText}</span>
            </div>`;
        }).join('');
    }

    function addFromInput() {
        const inp = document.getElementById('sv-add-input');
        if (!inp) return;
        const val = inp.value.trim();
        if (!val) return;
        const match = factionMembers.find(m => m.name.toLowerCase() === val.toLowerCase()) ||
            factionMembers.find(m => m.name.toLowerCase().startsWith(val.toLowerCase()));
        addMember(match ? match.name : val, match ? match.id : null);
        inp.value = '';
        const box = document.getElementById('sv-suggest');
        if (box) box.style.display = 'none';
        searchQuery = '';
        suggestSelected = -1;
    }

    function saveApiKey() {
        const inp = document.getElementById('sv-apikey-input');
        const val = (inp?.value || '').trim();
        if (!val) { flashStatus('Enter your Torn API key first.', true); return; }
        flashStatus('Verifying API key...', false);
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.torn.com/faction/?selections=basic,rankedwars&key=${val}`,
            timeout: 8000,
            onload(res) {
                try {
                    const d = JSON.parse(res.responseText);
                    if (d && d.error) { flashStatus(`API Error: ${d.error.error}`, true); return; }
                    apiKey = val;
                    GM_setValue('sv_apikey', apiKey);
                    try { localStorage.setItem(LS_KEY_APIKEY, apiKey); } catch (e) {}
                    if (d.members) handleMembersResponse(d);
                    flashStatus(`✓ Connected to ${d.name || 'Faction'}!`, false);
                    pollChainAndAttacks();
                    pollDirectEnemyFaction();
                } catch (e) { flashStatus('Invalid Torn API response.', true); }
            },
            onerror() { flashStatus('Network error.', true); }
        });
    }

    function saveEnemyTargetFromHUD() {
        const inp = document.getElementById('sv-enemy-fac-input');
        const raw = (inp?.value || '').trim();
        if (raw && !/^\d+$/.test(raw)) {
            flashStatus('Enemy Faction ID must be numeric.', true);
            return;
        }
        customEnemyFacId = raw;
        localEnemyHospMap = {};
        save();
        updateEnemyBadgeUI();
        GM_xmlhttpRequest({
            method: 'POST',
            url: `${SERVER_BASE}/api/chain/target`,
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey || '' },
            data: JSON.stringify({ enemyFactionId: raw || null }),
            timeout: 5000,
            onload() {
                if (raw) pollDirectEnemyFaction();
                syncBackendTelemetry(false);
                flashStatus(raw ? `🎯 Tracking Enemy Faction [${raw}]` : 'Returned to auto-war detection.', false);
                if (activeTab === 'radar') renderRadarTab();
            },
            onerror() {}
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  HUD BUILD & EVENTS
    // ══════════════════════════════════════════════════════════════
    function _injectReopenTab(hud) {
        if (document.getElementById('sv-reopen-tab')) return;
        const tab = document.createElement('div');
        tab.id = 'sv-reopen-tab';
        tab.title = 'Re-open FactionOS Chain Command';
        tab.textContent = '⚡ Chain';
        tab.addEventListener('click', () => {
            hud.style.display = '';
            isHidden = false;
            tab.remove();
            updateMinDisplay();
        });
        document.body.appendChild(tab);
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

    function buildHUD() {
        const isMobile = window.innerWidth <= 600;
        let savedPos = GM_getValue(LS_KEY_POS, null);
        if (!savedPos) savedPos = isMobile ? { top: 48, right: 6 } : { top: 76, right: 18 };
        else {
            const hudW = isMobile ? 305 : 352;
            savedPos.right = Math.min(Math.max(4, savedPos.right || 0), Math.max(4, window.innerWidth - hudW - 4));
            savedPos.top = Math.min(Math.max(4, savedPos.top || 0), Math.max(4, window.innerHeight - 64));
        }

        const hud = document.createElement('div');
        hud.id = 'sv-chain-hud';
        if (isMinimized) hud.classList.add('sv-minimized');
        hud.style.top = `${savedPos.top}px`;
        hud.style.right = `${savedPos.right}px`;

        hud.innerHTML = `
        <div class="sv-header" id="sv-handle">
            <div class="sv-title sv-full-only">
                <span class="sv-sync-dot sv-dot-synced" id="sv-sync-dot"></span>
                <span class="sv-title-text">CHAIN COMMAND</span>
                <span class="sv-enemy-badge" id="sv-enemy-badge" style="display:none;"></span>
            </div>

            <div class="sv-min-bar sv-min-only">
                <span class="sv-min-chip sv-min-chain" id="sv-min-chain">⚡ 0</span>
                <span class="sv-min-chip sv-min-timer" id="sv-min-timer">⏱ 0:00</span>
                <span class="sv-min-up" id="sv-min-up" title="Click to copy lineup">UP: —</span>
                <a class="sv-min-med" id="sv-min-med" href="#" target="_blank" rel="noopener" style="display:none;">🚨 MED</a>
                <button class="sv-min-btn sv-min-post" id="sv-min-post-btn" title="Post to Faction Chat">📢</button>
                <button class="sv-min-btn" id="sv-min-next-btn" title="Rotate Next">⏭</button>
            </div>

            <div class="sv-hdr-controls">
                <button class="sv-ctrl-btn sv-full-only" id="sv-mute-btn" title="Mute / Unmute">${soundEnabled ? '🔊' : '🔇'}</button>
                <button class="sv-ctrl-btn sv-full-only" id="sv-settings-btn" title="Settings & API Key">⚙</button>
                <button class="sv-ctrl-btn" id="sv-min-btn" title="Minimize / Expand">${isMinimized ? '▢' : '─'}</button>
                <button class="sv-ctrl-btn" id="sv-close-btn" title="Hide">${'✕'}</button>
            </div>
        </div>

        <div class="sv-body" id="sv-body">
            <div id="sv-chain-bar"></div>
            <div id="sv-medout-alert-slot" style="display:none;"></div>

            <!-- Action & Timing Strip -->
            <div class="sv-toolbar">
                <div class="sv-timing-grp">
                    <span class="sv-lbl">Hit at</span>
                    <select id="sv-hit-time-sel" class="sv-select">
                        <option value="">None</option>
                        <option value="3:30">3:30</option>
                        <option value="3:00">3:00</option>
                        <option value="2:30">2:30</option>
                        <option value="2:00">2:00</option>
                        <option value="1:30">1:30</option>
                        <option value="1:00">1:00</option>
                        <option value="custom">Custom</option>
                    </select>
                    <input id="sv-hit-time-custom" class="sv-input-xs" type="text" placeholder="2:15" style="display:none;width:42px;" />
                </div>
                <div class="sv-dispatch-grp">
                    <button class="sv-btn sv-btn-chat" id="sv-post-btn" title="Post lineup to Faction Chat">📢 Post Chat</button>
                    <button class="sv-btn" id="sv-copy-btn" title="Copy (Shift+Click for 1-liner)">📋</button>
                </div>
            </div>

            <!-- Mode Pills -->
            <div class="sv-pill-bar">
                <button class="sv-pill ${loopMode ? 'sv-pill-on' : ''}" id="sv-pill-loop" title="Rotate hitter back to bottom">Loop <span class="sv-pill-st">${loopMode ? 'ON' : 'OFF'}</span></button>
                <button class="sv-pill ${autoMode ? 'sv-pill-on' : ''}" id="sv-pill-auto" title="Auto-rotate when confirmed hit arrives">Auto <span class="sv-pill-st">${autoMode ? 'ON' : 'OFF'}</span></button>
                <button class="sv-pill ${autoSendOnPost ? 'sv-pill-on' : ''}" id="sv-pill-autosend" title="Press Enter immediately after filling Faction Chat">Send <span class="sv-pill-st">${autoSendOnPost ? 'ON' : 'OFF'}</span></button>
                <button class="sv-pill ${autoCallMedOut ? 'sv-pill-on' : ''}" id="sv-pill-autocall" title="Auto-post enemy med-outs to Faction Chat">Auto-Call 💊 <span class="sv-pill-st">${autoCallMedOut ? 'ON' : 'OFF'}</span></button>
            </div>

            <!-- Navigation Tabs -->
            <div class="sv-tabs">
                <button class="sv-tab sv-tab-active" id="sv-tab-lineup" data-tab="lineup">🎯 Lineup (0)</button>
                <button class="sv-tab" id="sv-tab-radar" data-tab="radar">💊 Med Radar (0)</button>
                <button class="sv-tab" id="sv-tab-hits" data-tab="hits">⚡ Hits (0)</button>
            </div>

            <div id="sv-status-msg" class="sv-status-msg"></div>
            <div id="sv-lineup-container" class="sv-tab-content"></div>

            <!-- Add Member + Quick Actions -->
            <div class="sv-footer">
                <div class="sv-add-row" style="position:relative;">
                    <input id="sv-add-input" class="sv-input" placeholder="Search faction member to add..." autocomplete="off" />
                    <button class="sv-btn sv-btn-add" id="sv-add-btn">+ Add</button>
                    <div id="sv-suggest" class="sv-suggest" style="display:none;"></div>
                </div>
                <div class="sv-quick-bar">
                    <button class="sv-btn sv-btn-primary" id="sv-autofill-btn">⚡ Auto-Fill Ready</button>
                    <button class="sv-btn" id="sv-refresh-btn" title="Refresh faction roster">↻</button>
                    <button class="sv-btn" id="sv-reset-btn" title="Reset hit marks">Reset</button>
                    <button class="sv-btn sv-btn-del" id="sv-clear-btn" title="Clear lineup">Clear</button>
                </div>
            </div>

            <!-- Collapsible Settings Drawer -->
            <div id="sv-settings-drawer" class="sv-settings-drawer" style="${showSettings ? 'display:flex;' : 'display:none;'}">
                <div class="sv-set-row">
                    <label>🔑 Torn API Key (Faction / Limited)</label>
                    <div class="sv-set-flex">
                        <input id="sv-apikey-input" class="sv-input" type="password" placeholder="Paste Torn API key..." value="${escAttr(apiKey)}" />
                        <button class="sv-btn sv-btn-hit" id="sv-apikey-save-btn">Save</button>
                    </div>
                </div>
                <div class="sv-set-row">
                    <label>🎯 Enemy Faction ID (optional outside Ranked War)</label>
                    <div class="sv-set-flex">
                        <input id="sv-enemy-fac-input" class="sv-input" type="text" placeholder="e.g. 12345 (blank = auto war)" value="${escAttr(customEnemyFacId)}" />
                        <button class="sv-btn sv-btn-primary" id="sv-enemy-save-btn">Track</button>
                    </div>
                </div>
                <div class="sv-set-row sv-set-inline">
                    <label style="margin:0;">🌐 Show HUD across all Torn pages</label>
                    <input id="sv-allpages-chk" type="checkbox" ${runOnAllPages ? 'checked' : ''} />
                </div>
            </div>
        </div>`;

        document.body.appendChild(hud);
        _syncHitTimeUI();
        syncTogglePillsUI();
        updateEnemyBadgeUI();
        renderChainBar();
        renderMedOutBanner();
        renderActiveTabView();
        updateMinDisplay();
        return hud;
    }

    function wireEvents(hud) {
        const handle = document.getElementById('sv-handle');
        let dragging = false, sx = 0, sy = 0, il = 0, it = 0;

        function startDrag(cx, cy, target) {
            if (target.closest('.sv-hdr-controls') || target.closest('.sv-min-btn') || target.closest('.sv-min-up') || target.closest('.sv-min-med')) return;
            dragging = true; sx = cx; sy = cy;
            const r = hud.getBoundingClientRect();
            il = r.left; it = r.top;
            hud.style.right = 'auto';
            hud.style.left = `${il}px`;
            hud.style.top = `${it}px`;
            document.body.style.userSelect = 'none';
        }
        function moveDrag(cx, cy) {
            if (!dragging) return;
            const maxL = Math.max(4, window.innerWidth - hud.offsetWidth - 4);
            const maxT = Math.max(4, window.innerHeight - hud.offsetHeight - 4);
            hud.style.left = `${Math.max(4, Math.min(maxL, il + (cx - sx)))}px`;
            hud.style.top = `${Math.max(4, Math.min(maxT, it + (cy - sy)))}px`;
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
        handle.addEventListener('touchstart', e => { if (e.touches?.[0]) startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target); }, { passive: true });
        window.addEventListener('touchmove', e => { if (dragging && e.touches?.[0]) { if (e.cancelable) e.preventDefault(); moveDrag(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
        window.addEventListener('touchend', endDrag);

        document.getElementById('sv-min-btn').addEventListener('click', () => {
            isMinimized = !isMinimized;
            hud.classList.toggle('sv-minimized', isMinimized);
            document.getElementById('sv-min-btn').textContent = isMinimized ? '▢' : '─';
            updateMinDisplay();
            GM_setValue('sv_min', isMinimized);
            // Re-clamp inside viewport when expanding near edges
            requestAnimationFrame(() => {
                const r = hud.getBoundingClientRect();
                if (r.right > window.innerWidth - 4 || r.left < 4) {
                    hud.style.left = 'auto';
                    hud.style.right = `${Math.max(4, Math.min(window.innerWidth - hud.offsetWidth - 4, window.innerWidth - r.right))}px`;
                }
            });
        });
        document.getElementById('sv-close-btn').addEventListener('click', () => {
            hud.style.display = 'none';
            isHidden = true;
            _injectReopenTab(hud);
        });
        document.getElementById('sv-mute-btn').addEventListener('click', () => {
            soundEnabled = !soundEnabled;
            save();
            broadcastSettingsUpdate();
            syncTogglePillsUI();
            flashStatus(soundEnabled ? '🔊 Sound alerts ON' : '🔇 Sound muted', false);
        });
        document.getElementById('sv-settings-btn').addEventListener('click', () => {
            showSettings = !showSettings;
            const d = document.getElementById('sv-settings-drawer');
            if (d) d.style.display = showSettings ? 'flex' : 'none';
        });

        document.getElementById('sv-min-post-btn').addEventListener('click', () => postToChat());
        document.getElementById('sv-min-next-btn').addEventListener('click', nextTurn);
        document.getElementById('sv-min-up').addEventListener('click', () => copyToClipboard('full'));

        document.getElementById('sv-post-btn').addEventListener('click', () => postToChat());
        document.getElementById('sv-copy-btn').addEventListener('click', e => copyToClipboard(e.shiftKey ? 'compact' : 'full'));

        document.getElementById('sv-pill-loop').addEventListener('click', () => { loopMode = !loopMode; save(); broadcastSettingsUpdate(); syncTogglePillsUI(); });
        document.getElementById('sv-pill-auto').addEventListener('click', () => { autoMode = !autoMode; save(); broadcastSettingsUpdate(); syncTogglePillsUI(); renderLineup(); });
        document.getElementById('sv-pill-autosend').addEventListener('click', () => { autoSendOnPost = !autoSendOnPost; save(); broadcastSettingsUpdate(); syncTogglePillsUI(); });
        document.getElementById('sv-pill-autocall').addEventListener('click', () => {
            autoCallMedOut = !autoCallMedOut;
            setStoredAutoCallMedOut(autoCallMedOut);
            save();
            broadcastSettingsUpdate();
            syncTogglePillsUI();
            flashStatus(autoCallMedOut ? '💊 Auto-Call Med-Outs ON' : 'Auto-Call Med-Outs OFF', false);
        });

        // Tabs
        hud.querySelectorAll('.sv-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                hud.querySelectorAll('.sv-tab').forEach(b => b.classList.toggle('sv-tab-active', b === btn));
                renderActiveTabView();
            });
        });

        const hitSel = document.getElementById('sv-hit-time-sel');
        const customInp = document.getElementById('sv-hit-time-custom');
        hitSel.addEventListener('change', () => {
            if (hitSel.value === 'custom') { customInp.style.display = 'inline-block'; customInp.focus(); }
            else { customInp.style.display = 'none'; targetHitTime = hitSel.value; save(); renderChainBar(); }
        });
        customInp.addEventListener('change', () => { targetHitTime = customInp.value.trim(); save(); renderChainBar(); });

        document.getElementById('sv-autofill-btn').addEventListener('click', autoFill);
        document.getElementById('sv-refresh-btn').addEventListener('click', () => { fetchFactionMembers(); syncBackendTelemetry(false); flashStatus('Refreshing roster...', false); });
        document.getElementById('sv-reset-btn').addEventListener('click', resetHits);
        document.getElementById('sv-clear-btn').addEventListener('click', clearAll);

        document.getElementById('sv-apikey-save-btn').addEventListener('click', saveApiKey);
        document.getElementById('sv-enemy-save-btn').addEventListener('click', saveEnemyTargetFromHUD);
        document.getElementById('sv-allpages-chk').addEventListener('change', e => {
            runOnAllPages = Boolean(e.target.checked);
            save();
            flashStatus(runOnAllPages ? 'HUD enabled across all Torn pages' : 'HUD restricted to Faction page after reload', false);
        });

        const addInp = document.getElementById('sv-add-input');
        const suggestBox = document.getElementById('sv-suggest');
        document.getElementById('sv-add-btn').addEventListener('click', addFromInput);
        addInp.addEventListener('focus', () => { suggestBox.style.display = 'block'; if (!factionMembers.length) fetchFactionMembers(); renderSuggest(); });
        addInp.addEventListener('input', e => { searchQuery = e.target.value; suggestSelected = -1; suggestBox.style.display = 'block'; renderSuggest(); });
        addInp.addEventListener('keydown', e => {
            const items = suggestBox.querySelectorAll('.sv-suggest-item');
            if (e.key === 'ArrowDown') { e.preventDefault(); suggestSelected = Math.min(suggestSelected + 1, items.length - 1); renderSuggest(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); suggestSelected = Math.max(suggestSelected - 1, -1); renderSuggest(); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (suggestSelected >= 0 && items[suggestSelected]) {
                    addMember(items[suggestSelected].dataset.name, parseInt(items[suggestSelected].dataset.id, 10) || null);
                    addInp.value = ''; suggestBox.style.display = 'none'; suggestSelected = -1; searchQuery = '';
                } else addFromInput();
            } else if (e.key === 'Escape') suggestBox.style.display = 'none';
        });
        document.addEventListener('click', e => { if (!e.target.closest('.sv-add-row')) suggestBox.style.display = 'none'; });

        hud.addEventListener('click', e => {
            const sug = e.target.closest('[data-action="add-suggest"]');
            if (sug) {
                addMember(sug.dataset.name, parseInt(sug.dataset.id, 10) || null);
                addInp.value = ''; suggestBox.style.display = 'none'; searchQuery = ''; suggestSelected = -1;
                return;
            }
            const act = e.target.closest('[data-action]');
            if (!act) return;
            const action = act.dataset.action;
            const idx = parseInt(act.dataset.idx, 10);

            if (action === 'force-hit') forceMarkHitAndRotate();
            else if (action === 'skip' && !isNaN(idx)) skipMember(idx);
            else if (action === 'remove' && !isNaN(idx)) removeMember(idx);
            else if (action === 'swap-top') swapTopTwo();
            else if (action === 'make-current' && !isNaN(idx)) makeCurrent(idx);
            else if (action === 'prompt-move' && !isNaN(idx)) promptMove(idx);
            else if (action === 'filter-ready') sortReadyToTop();
            else if (action === 'auto-skip-hosp' || action === 'auto-skip-unavail') autoSkipUnavailMembers();
            else if (action === 'dismiss-medalert') { activeMedAlert = null; renderMedOutBanner(); updateMinDisplay(); }
            else if (action === 'call-medout') {
                const ev = enemyMedOuts.find(x => x.id === act.dataset.medid) || activeMedAlert;
                if (ev) callOutMedOutToChat(ev);
            } else if (action === 'open-enemy-set') {
                showSettings = true;
                const d = document.getElementById('sv-settings-drawer');
                if (d) { d.style.display = 'flex'; document.getElementById('sv-enemy-fac-input')?.focus(); }
            }
        });

        hud.addEventListener('dragstart', e => {
            const card = e.target.closest('[data-idx]');
            if (card) { e.dataTransfer.setData('text/plain', card.dataset.idx); card.classList.add('sv-dragging'); }
        });
        hud.addEventListener('dragend', e => { e.target.closest('[data-idx]')?.classList.remove('sv-dragging'); });
        hud.addEventListener('dragover', e => { const c = e.target.closest('[data-idx]'); if (c) { e.preventDefault(); c.classList.add('sv-drag-over'); } });
        hud.addEventListener('dragleave', e => { e.target.closest('[data-idx]')?.classList.remove('sv-drag-over'); });
        hud.addEventListener('drop', e => {
            const c = e.target.closest('[data-idx]');
            if (c) {
                e.preventDefault(); c.classList.remove('sv-drag-over');
                const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                const to = parseInt(c.dataset.idx, 10);
                if (!isNaN(from) && !isNaN(to) && from !== to) moveMember(from, to);
            }
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  MODERN GLASSMORPHIC HUD STYLES
    // ══════════════════════════════════════════════════════════════
    const css = `
    #sv-chain-hud {
        position: fixed; z-index: 99999999; width: 352px; max-height: 88vh;
        display: flex; flex-direction: column;
        background: rgba(11, 15, 25, 0.96);
        backdrop-filter: blur(14px);
        border: 1px solid rgba(56, 189, 248, 0.24);
        border-radius: 12px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.78), 0 0 24px rgba(14, 165, 233, 0.08);
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px; color: #e2e8f0; user-select: none; overflow: visible;
    }
    #sv-chain-hud:not(.sv-minimized) .sv-min-only { display: none !important; }
    #sv-chain-hud.sv-minimized {
        width: auto; max-width: calc(100vw - 16px); border-radius: 999px; max-height: none;
        border-color: rgba(56, 189, 248, 0.35); overflow: hidden;
    }
    #sv-chain-hud.sv-minimized .sv-body, #sv-chain-hud.sv-minimized .sv-full-only { display: none !important; }
    #sv-chain-hud.sv-minimized .sv-min-only { display: flex !important; }
    #sv-chain-hud.sv-minimized .sv-header { border-bottom: none; border-radius: 999px; padding: 5px 10px; }

    .sv-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; cursor: move; flex-shrink: 0; gap: 6px;
        background: linear-gradient(180deg, rgba(30, 41, 59, 0.85), rgba(15, 23, 42, 0.85));
        border-bottom: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 12px 12px 0 0;
    }
    .sv-title { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; overflow: hidden; }
    .sv-title-text { font-size: 10.5px; font-weight: 800; letter-spacing: 0.9px; color: #f8fafc; white-space: nowrap; }
    .sv-sync-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .sv-dot-synced { background: #38bdf8; box-shadow: 0 0 6px #38bdf8; }
    .sv-dot-live { background: #10b981; box-shadow: 0 0 8px #10b981; animation: svPulse 1.2s infinite; }
    .sv-enemy-badge { font-size: 9px; font-weight: 700; color: #fca5a5; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); padding: 1px 6px; border-radius: 999px; white-space: nowrap; max-width: 112px; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1; }
    .sv-hdr-controls { display: flex; align-items: center; gap: 2px; flex-shrink: 0; margin-left: auto; }
    .sv-ctrl-btn { background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 2px 5px; font-size: 11px; border-radius: 5px; }
    .sv-ctrl-btn:hover { color: #f8fafc; background: rgba(255,255,255,0.08); }

    /* Minimized Pill */
    .sv-min-only { display: none; }
    .sv-min-bar { align-items: center; gap: 5px; min-width: 0; overflow: hidden; }
    .sv-min-chip { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.22); }
    .sv-min-chain { color: #38bdf8; }
    .sv-min-pulse { animation: svCrit 0.9s infinite; border-color: rgba(239, 68, 68, 0.7) !important; }
    .sv-min-up { font-weight: 700; color: #a7f3d0; background: rgba(16, 185, 129, 0.14); border: 1px solid rgba(16, 185, 129, 0.35); padding: 2px 8px; border-radius: 999px; max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .sv-min-med { font-weight: 800; font-size: 10px; color: #fff; background: linear-gradient(135deg, #dc2626, #ea580c); padding: 2px 8px; border-radius: 999px; text-decoration: none; animation: svPulse 0.9s infinite; }
    .sv-min-btn { background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(148, 163, 184, 0.22); color: #e2e8f0; padding: 2px 7px; border-radius: 999px; cursor: pointer; font-size: 10px; font-weight: 700; }
    .sv-min-post { background: #10b981; color: #052e16; border: none; }

    .sv-body { overflow: visible; flex: 1; min-height: 0; display: flex; flex-direction: column; }

    /* Hero Card */
    .sv-hero-card {
        margin: 8px 10px 6px; padding: 9px 11px; border-radius: 10px;
        background: linear-gradient(145deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.65));
        border: 1px solid rgba(148, 163, 184, 0.16);
    }
    .sv-hero-card.sv-timer-critical { border-color: rgba(239, 68, 68, 0.65); background: linear-gradient(145deg, rgba(69, 10, 10, 0.55), rgba(15, 23, 42, 0.95)); animation: svCrit 1s infinite; }
    .sv-hero-card.sv-timer-warn { border-color: rgba(245, 158, 11, 0.45); }
    .sv-hero-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sv-hero-chain-row { display: flex; align-items: center; gap: 6px; }
    .sv-chain-num { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 20px; font-weight: 900; font-variant-numeric: tabular-nums; color: #f8fafc; line-height: 1.1; }
    .sv-mult-badge { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 10px; font-weight: 800; color: #38bdf8; background: rgba(56, 189, 248, 0.14); border: 1px solid rgba(56, 189, 248, 0.35); padding: 1px 6px; border-radius: 6px; }
    .sv-hero-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; font-weight: 600; }
    .sv-hero-timer-wrap { text-align: right; }
    .sv-hero-timer { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 22px; font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1.05; }
    .sv-hero-timer-sub { font-size: 9.5px; color: #94a3b8; font-weight: 700; margin-top: 2px; }
    .sv-hit-now-pill { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.45); padding: 1px 6px; border-radius: 6px; font-weight: 800; }
    .sv-progress-track { height: 4px; background: rgba(15, 23, 42, 0.9); border-radius: 999px; overflow: hidden; margin-top: 8px; }
    .sv-progress-fill { height: 100%; background: linear-gradient(90deg, #0ea5e9, #10b981); transition: width 0.4s ease; }

    /* Instant Med-Out Banner */
    .sv-medout-banner {
        margin: 0 10px 6px; padding: 8px 10px; border-radius: 9px;
        background: linear-gradient(135deg, rgba(185, 28, 28, 0.28), rgba(194, 65, 12, 0.24));
        border: 1px solid rgba(248, 113, 113, 0.7);
        box-shadow: 0 0 18px rgba(239, 68, 68, 0.28);
        animation: svCrit 1.1s infinite;
    }
    .sv-medout-top { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
    .sv-medout-pill { font-size: 9.5px; font-weight: 900; color: #fef2f2; background: #dc2626; padding: 1px 6px; border-radius: 4px; letter-spacing: 0.4px; }
    .sv-medout-saved { font-size: 10px; font-weight: 800; color: #fcd34d; }
    .sv-medout-dismiss { margin-left: auto; background: none; border: none; color: #cbd5e1; cursor: pointer; font-size: 11px; }
    .sv-medout-body { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sv-medout-target { font-size: 11.5px; color: #fff; min-width: 0; }
    .sv-medout-meta { font-size: 9.5px; color: #cbd5e1; margin-top: 1px; }
    .sv-medout-btns { display: flex; gap: 4px; flex-shrink: 0; }
    .sv-btn-attack { background: linear-gradient(135deg, #ef4444, #dc2626) !important; border: none !important; color: #fff !important; font-weight: 800 !important; text-decoration: none; display: inline-flex; align-items: center; }
    .sv-btn-call { background: rgba(245, 158, 11, 0.2) !important; border-color: rgba(245, 158, 11, 0.5) !important; color: #fcd34d !important; }
    .sv-id-muted { color: #94a3b8; font-size: 9.5px; font-family: ui-monospace, monospace; }

    /* Toolbars & Pills */
    .sv-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px; gap: 6px; }
    .sv-timing-grp, .sv-dispatch-grp { display: flex; align-items: center; gap: 4px; }
    .sv-lbl { font-size: 10px; color: #94a3b8; font-weight: 700; }
    .sv-select, .sv-input-xs { background: #0f172a; border: 1px solid rgba(148, 163, 184, 0.24); color: #e2e8f0; padding: 3px 6px; border-radius: 6px; font-size: 10.5px; font-weight: 700; outline: none; }
    .sv-pill-bar { display: flex; gap: 4px; padding: 3px 10px 6px; flex-wrap: wrap; }
    .sv-pill { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(148, 163, 184, 0.2); color: #94a3b8; padding: 2px 7px; border-radius: 999px; font-size: 9.5px; font-weight: 700; cursor: pointer; }
    .sv-pill-on { background: rgba(16, 185, 129, 0.14); border-color: rgba(16, 185, 129, 0.45); color: #34d399; }

    /* Tabs */
    .sv-tabs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; padding: 4px 10px; border-top: 1px solid rgba(148, 163, 184, 0.12); border-bottom: 1px solid rgba(148, 163, 184, 0.12); background: rgba(15, 23, 42, 0.7); }
    .sv-tab { background: transparent; border: 1px solid transparent; color: #94a3b8; padding: 4px 4px; border-radius: 6px; font-size: 9.5px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 3px; white-space: nowrap; }
    .sv-tab:hover { color: #f8fafc; background: rgba(255,255,255,0.04); }
    .sv-tab-active { background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.35); color: #38bdf8; }
    .sv-tab-hot { background: #ef4444; color: #fff; padding: 0 5px; border-radius: 999px; font-size: 9px; font-weight: 800; }

    .sv-status-msg { padding: 3px 10px 0; min-height: 14px; font-size: 10px; font-weight: 600; }
    .sv-tab-content { padding: 4px 10px 6px; max-height: 290px; overflow-y: auto; }

    /* Summary & UP Card */
    .sv-summary-row { display: flex; gap: 5px; margin-bottom: 6px; flex-wrap: wrap; }
    .sv-chip { background: rgba(30, 41, 59, 0.75); border: 1px solid rgba(148, 163, 184, 0.18); color: #cbd5e1; padding: 2px 7px; border-radius: 6px; font-size: 9.5px; font-weight: 700; cursor: default; }
    .sv-chip-ok, .sv-chip-danger { cursor: pointer; }
    .sv-chip-danger { background: rgba(239, 68, 68, 0.14); border-color: rgba(239, 68, 68, 0.4); color: #fca5a5; }

    .sv-up-card {
        padding: 9px 10px; border-radius: 9px; margin-bottom: 6px; cursor: grab;
        background: linear-gradient(135deg, rgba(6, 78, 59, 0.36), rgba(15, 23, 42, 0.9));
        border: 1.5px solid rgba(16, 185, 129, 0.65);
    }
    .sv-up-card.sv-up-warn { border-color: rgba(245, 158, 11, 0.7); background: linear-gradient(135deg, rgba(120, 53, 15, 0.3), rgba(15, 23, 42, 0.9)); }
    .sv-up-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
    .sv-up-tag { font-size: 9.5px; font-weight: 900; color: #34d399; letter-spacing: 0.6px; }
    .sv-readiness-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 9.5px; font-weight: 800; padding: 1px 6px; border-radius: 999px; background: rgba(15, 23, 42, 0.8); }
    .sv-up-main { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
    .sv-pos-pill { font-family: ui-monospace, monospace; font-size: 10px; font-weight: 900; padding: 2px 6px; border-radius: 5px; background: rgba(16, 185, 129, 0.22); color: #34d399; cursor: pointer; }
    .sv-up-name { font-size: 13.5px; font-weight: 800; color: #f8fafc; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-hit-badge { font-size: 9.5px; font-weight: 800; color: #38bdf8; background: rgba(56, 189, 248, 0.15); padding: 1px 6px; border-radius: 5px; }
    .sv-up-actions { display: flex; gap: 4px; }
    .sv-btn-hit { flex: 1; background: linear-gradient(135deg, #10b981, #059669) !important; border: none !important; color: #fff !important; font-weight: 800 !important; }

    /* Compact Queue Rows */
    .sv-queue-list { display: flex; flex-direction: column; gap: 3px; }
    .sv-q-row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 7px; background: rgba(30, 41, 59, 0.52); border: 1px solid rgba(148, 163, 184, 0.1); cursor: grab; }
    .sv-q-row.sv-q-next { border-color: rgba(56, 189, 248, 0.35); background: rgba(14, 165, 233, 0.08); }
    .sv-q-row:hover { border-color: rgba(148, 163, 184, 0.28); }
    .sv-q-idx { font-family: ui-monospace, monospace; font-size: 9.5px; font-weight: 800; color: #94a3b8; min-width: 28px; cursor: pointer; }
    .sv-q-idx-next { color: #38bdf8; }
    .sv-q-info { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .sv-q-name { font-size: 11.5px; font-weight: 700; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv-q-state { display: inline-flex; align-items: center; gap: 4px; font-size: 9.5px; font-weight: 700; flex-shrink: 0; }
    .sv-dot-mini { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
    .sv-hit-mini { font-size: 9.5px; color: #34d399; font-weight: 800; }
    .sv-q-btns { display: flex; gap: 2px; }
    .sv-btn-ico { background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.2); color: #cbd5e1; border-radius: 4px; padding: 2px 5px; font-size: 9.5px; cursor: pointer; }
    .sv-btn-ico:hover { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }

    /* Radar & Hits */
    .sv-radar-hdr { display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: #cbd5e1; padding: 4px 6px; background: rgba(30, 41, 59, 0.6); border-radius: 6px; margin-bottom: 6px; }
    .sv-sec-lbl { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin: 4px 0; }
    .sv-radar-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 8px; border-radius: 7px; background: rgba(30, 41, 59, 0.55); border: 1px solid rgba(148, 163, 184, 0.14); margin-bottom: 4px; }
    .sv-radar-medout { border-color: rgba(248, 113, 113, 0.45); background: rgba(127, 29, 29, 0.22); }
    .sv-radar-info { min-width: 0; flex: 1; }
    .sv-radar-name { font-size: 11px; color: #f8fafc; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .sv-medout-tag { font-size: 8.5px; font-weight: 900; color: #fca5a5; background: rgba(239, 68, 68, 0.2); padding: 1px 4px; border-radius: 4px; }
    .sv-radar-meta { font-size: 9.5px; color: #cbd5e1; margin-top: 2px; }
    .sv-radar-acts { display: flex; gap: 3px; flex-shrink: 0; }
    .sv-hits-list { display: flex; flex-direction: column; gap: 3px; }
    .sv-hit-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; background: rgba(30, 41, 59, 0.5); border-radius: 6px; font-size: 10.5px; }
    .sv-hit-num { font-family: ui-monospace, monospace; font-weight: 800; color: #38bdf8; min-width: 40px; }
    .sv-hit-player { flex: 1; font-weight: 700; color: #f8fafc; }
    .sv-hit-age { color: #94a3b8; font-size: 9.5px; }

    /* Shared Buttons & Footer */
    .sv-btn { background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(148, 163, 184, 0.22); color: #e2e8f0; padding: 4px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .sv-btn:hover { background: rgba(51, 65, 85, 0.95); }
    .sv-btn-xs { padding: 2px 6px; font-size: 9.5px; }
    .sv-btn-chat { background: linear-gradient(135deg, #0ea5e9, #0284c7); border: none; color: #fff; font-weight: 800; }
    .sv-btn-primary { background: rgba(56, 189, 248, 0.16); border-color: rgba(56, 189, 248, 0.4); color: #38bdf8; }
    .sv-btn-warn { background: rgba(245, 158, 11, 0.16); border-color: rgba(245, 158, 11, 0.4); color: #fbbf24; }
    .sv-btn-del { color: #fca5a5; border-color: rgba(239, 68, 68, 0.3); }
    .sv-btn-del:hover { background: rgba(239, 68, 68, 0.22); color: #fff; }
    .sv-btn-add { background: rgba(16, 185, 129, 0.18); border-color: rgba(16, 185, 129, 0.4); color: #34d399; }

    .sv-footer { padding: 6px 10px 8px; border-top: 1px solid rgba(148, 163, 184, 0.12); background: rgba(15, 23, 42, 0.7); border-radius: 0 0 12px 12px; }
    .sv-add-row { display: flex; gap: 5px; margin-bottom: 5px; }
    .sv-input { flex: 1; min-width: 0; background: #0f172a; border: 1px solid rgba(148, 163, 184, 0.24); color: #f8fafc; padding: 5px 8px; border-radius: 6px; font-size: 11px; outline: none; }
    .sv-input:focus { border-color: #38bdf8; }
    .sv-quick-bar { display: flex; gap: 4px; align-items: center; }
    .sv-quick-bar .sv-btn-primary { flex: 1; }
    .sv-suggest { position: absolute; bottom: calc(100% + 4px); left: 0; right: 0; background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 8px; max-height: 200px; overflow-y: auto; z-index: 100000001; box-shadow: 0 -10px 28px rgba(0,0,0,0.85); }
    .sv-suggest-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; cursor: pointer; border-bottom: 1px solid rgba(148, 163, 184, 0.1); }
    .sv-suggest-item:hover, .sv-suggest-sel { background: rgba(56, 189, 248, 0.15); }
    .sv-suggest-empty { padding: 10px; color: #94a3b8; font-size: 10.5px; text-align: center; }
    .sv-mark { background: rgba(56, 189, 248, 0.28); color: #7dd3fc; border-radius: 2px; }

    .sv-settings-drawer { flex-direction: column; gap: 8px; padding: 9px 10px; border-top: 1px solid rgba(245, 158, 11, 0.25); background: rgba(15, 23, 42, 0.96); }
    .sv-set-row label { display: block; font-size: 9.5px; font-weight: 700; color: #cbd5e1; margin-bottom: 3px; }
    .sv-set-flex { display: flex; gap: 5px; }
    .sv-set-inline { display: flex; align-items: center; justify-content: space-between; }

    .st-ready { color: #34d399; } .st-idle { color: #fbbf24; } .st-offline { color: #94a3b8; } .st-hosp { color: #f87171; } .st-travel { color: #38bdf8; } .st-jail { color: #f87171; }
    .sv-empty-state, .sv-empty-mini { text-align: center; color: #94a3b8; padding: 14px 8px; font-size: 11px; }
    .sv-empty-sub { font-size: 10px; color: #64748b; margin-top: 2px; }
    .sv-drag-over { outline: 1.5px solid #38bdf8; }
    .sv-dragging { opacity: 0.45; }

    #sv-reopen-tab { position: fixed; z-index: 99999998; bottom: 86px; right: 0; background: #0f172a; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.45); border-right: none; border-radius: 8px 0 0 8px; padding: 7px 11px; font-size: 11px; font-weight: 800; cursor: pointer; box-shadow: -4px 0 14px rgba(0,0,0,0.55); }
    @keyframes svPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
    @keyframes svCrit { 0%,100% { box-shadow: 0 0 12px rgba(239, 68, 68, 0.25); } 50% { box-shadow: 0 0 22px rgba(239, 68, 68, 0.6); } }
    `;

    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }

    // ══════════════════════════════════════════════════════════════
    //  BOOT (BUG FIX #8: MOUNT ACROSS TORN PAGES)
    // ══════════════════════════════════════════════════════════════
    load();
    initTier1AttackObserver();
    initTier1HeaderDOMObserver();
    initTier2WebSocketSniffer();

    const _isFactionPage = window.location.href.includes('factions.php');
    if (!runOnAllPages && !_isFactionPage) return;

    const hud = buildHUD();
    wireEvents(hud);
    setDirty(false);
    startLocalTimer();
    scheduleAdaptivePoll();
    fetchFactionMembers();
    syncBackendTelemetry(true);
    fetchServerLineupSnapshot();

    pollMembersTimer = setInterval(fetchFactionMembers, STATUS_POLL_MS);
    enemyPollTimer = setInterval(pollDirectEnemyFaction, 3500);
    setInterval(flushPendingMedOutAutoCalls, 2000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) flushPendingMedOutAutoCalls();
    });
    window.addEventListener('focus', flushPendingMedOutAutoCalls);
})();
