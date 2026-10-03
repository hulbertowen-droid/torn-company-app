// ==UserScript==
// @name         Torn Chain Lineup HUD & Faction Chat Poster
// @namespace    https://torn-company-app-production.up.railway.app/
// @version      1.0.2
// @description  Live floating chain lineup HUD for Torn. Shows real-time hit queue updates and 1-click posts the lineup into Faction Chat without blocking or being covered by chat windows.
// @author       Spider-Verse
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      torn-company-app-production.up.railway.app
// @run-at       document-end
// @updateURL    https://torn-company-app-production.up.railway.app/torn-chain-lineup.user.js
// @downloadURL  https://torn-company-app-production.up.railway.app/torn-chain-lineup.user.js
// ==/UserScript==

(function() {
    'use strict';

    const SERVER_URL   = 'https://torn-company-app-production.up.railway.app';
    const POLL_MS      = 1500; // Poll server lineup every 1.5s

    // State
    let lineupData     = null;
    let lastVersion    = null;
    let lastUpName     = null;
    let isMinimized    = GM_getValue('torn_hud_minimized', false);
    let autoSendOnPost = GM_getValue('torn_hud_autosend', false);
    let soundEnabled   = GM_getValue('torn_hud_sound', true);

    // ── Inject CSS ─────────────────────────────────────────────────────
    const hudStyles = `
        #torn-chain-hud {
            position: fixed;
            z-index: 99999999;
            width: 290px;
            background: rgba(14, 18, 27, 0.96);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(46, 204, 113, 0.4);
            border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.65), 0 0 15px rgba(46, 204, 113, 0.15);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #f1f2f6;
            font-size: 13px;
            user-select: none;
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }

        #torn-chain-hud.hud-pulse {
            animation: hudPulseAnim 1.6s ease-in-out;
        }

        @keyframes hudPulseAnim {
            0% { border-color: rgba(46, 204, 113, 0.4); box-shadow: 0 8px 32px rgba(0,0,0,0.65); }
            30% { border-color: #2ecc71; box-shadow: 0 0 25px rgba(46, 204, 113, 0.8), 0 8px 32px rgba(0,0,0,0.8); }
            100% { border-color: rgba(46, 204, 113, 0.4); box-shadow: 0 8px 32px rgba(0,0,0,0.65); }
        }

        .hud-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.04);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 9px 9px 0 0;
            cursor: move;
        }

        .hud-title {
            display: flex;
            align-items: center;
            gap: 7px;
        }

        .hud-status-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 9px;
            font-weight: 800;
            padding: 2px 6px;
            border-radius: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            transition: all 0.25s ease;
            user-select: none;
        }

        .hud-status-pill.status-updated {
            background: rgba(46, 204, 113, 0.2);
            color: #2ecc71;
            border: 1px solid rgba(46, 204, 113, 0.5);
        }

        .hud-status-pill.status-same {
            background: rgba(113, 128, 150, 0.2);
            color: #a0aec0;
            border: 1px solid rgba(113, 128, 150, 0.4);
        }

        .hud-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            display: inline-block;
            transition: all 0.25s ease;
        }

        .hud-dot.dot-updated {
            background: #2ecc71;
            box-shadow: 0 0 8px #2ecc71, 0 0 3px #2ecc71;
            animation: dotPulse 1.4s infinite;
        }

        .hud-dot.dot-same {
            background: #718096;
            box-shadow: none;
            animation: none;
        }

        @keyframes dotPulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.25); opacity: 0.75; }
            100% { transform: scale(1); opacity: 1; }
        }

        .hud-full-title {
            display: inline-block;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: #e2e8f0;
        }

        .hud-min-up-text {
            display: none;
            font-size: 11px;
            font-weight: 800;
            color: #ffffff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 120px;
        }

        .hud-min-post-btn {
            display: none;
            background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
            color: #0b1d12;
            border: none;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 800;
            cursor: pointer;
            align-items: center;
            gap: 4px;
            transition: all 0.15s ease;
            box-shadow: 0 1px 6px rgba(46, 204, 113, 0.3);
            white-space: nowrap;
        }

        .hud-min-post-btn:hover {
            background: linear-gradient(135deg, #3ee083 0%, #2ecc71 100%);
            transform: translateY(-1px);
        }

        .hud-min-post-btn:active {
            transform: translateY(0);
        }

        .hud-controls {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .hud-ctrl-btn {
            background: transparent;
            border: none;
            color: #8892b0;
            cursor: pointer;
            padding: 2px 5px;
            font-size: 12px;
            border-radius: 4px;
            line-height: 1;
        }
        .hud-ctrl-btn:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }

        .hud-body {
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .hud-badge-updated {
            display: none;
            background: rgba(46, 204, 113, 0.2);
            border: 1px solid #2ecc71;
            color: #2ecc71;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 800;
            text-align: center;
            letter-spacing: 0.5px;
            animation: fadeInOut 4s forwards;
        }

        @keyframes fadeInOut {
            0% { opacity: 0; transform: translateY(-3px); }
            15% { opacity: 1; transform: translateY(0); }
            80% { opacity: 1; }
            100% { opacity: 0; }
        }

        .hud-slot-card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 6px;
            padding: 8px 10px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .hud-slot-card.up-card {
            background: rgba(46, 204, 113, 0.08);
            border-color: rgba(46, 204, 113, 0.35);
        }

        .hud-slot-meta {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .hud-slot-label {
            font-size: 9px;
            text-transform: uppercase;
            font-weight: 800;
            letter-spacing: 0.5px;
            color: #8892b0;
        }

        .hud-slot-card.up-card .hud-slot-label {
            color: #2ecc71;
        }

        .hud-slot-name {
            font-size: 14px;
            font-weight: 800;
            color: #ffffff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 170px;
        }

        .hud-hit-target {
            background: rgba(46, 204, 113, 0.2);
            color: #2ecc71;
            border: 1px solid rgba(46, 204, 113, 0.5);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
            font-family: monospace;
            white-space: nowrap;
        }

        .hud-queue-preview {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            font-size: 11px;
            color: #a0aec0;
            padding: 4px 6px;
            background: rgba(0, 0, 0, 0.25);
            border-radius: 4px;
        }

        .hud-post-btn {
            background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
            color: #0b1d12;
            border: none;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 800;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.15s ease;
            box-shadow: 0 2px 10px rgba(46, 204, 113, 0.3);
        }

        .hud-post-btn:hover {
            background: linear-gradient(135deg, #3ee083 0%, #2ecc71 100%);
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(46, 204, 113, 0.45);
        }

        .hud-post-btn:active {
            transform: translateY(0);
        }

        .hud-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 12px 8px 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            font-size: 10px;
            color: #718096;
        }

        .hud-footer a {
            color: #2ecc71;
            text-decoration: none;
        }
        .hud-footer a:hover {
            text-decoration: underline;
        }

        .hud-toast {
            position: absolute;
            bottom: -32px;
            left: 50%;
            transform: translateX(-50%);
            background: #10b981;
            color: #ffffff;
            font-size: 11px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease, transform 0.2s ease;
            z-index: 100000000;
        }
        .hud-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(4px);
        }

        /* Minimized State */
        #torn-chain-hud.minimized .hud-body,
        #torn-chain-hud.minimized .hud-footer {
            display: none;
        }
        #torn-chain-hud.minimized {
            width: auto;
            max-width: 440px;
            border-radius: 20px;
        }
        #torn-chain-hud.minimized .hud-header {
            border-radius: 20px;
            border-bottom: none;
            padding: 5px 10px;
            gap: 8px;
        }
        #torn-chain-hud.minimized .hud-full-title {
            display: none;
        }
        #torn-chain-hud.minimized .hud-min-up-text {
            display: inline-block;
        }
        #torn-chain-hud.minimized .hud-min-post-btn {
            display: inline-flex;
        }
    `;

    if (typeof GM_addStyle === 'function') {
        GM_addStyle(hudStyles);
    } else {
        const s = document.createElement('style');
        s.textContent = hudStyles;
        document.head.appendChild(s);
    }

    // ── Build HUD DOM ──────────────────────────────────────────────────
    const hud = document.createElement('div');
    hud.id = 'torn-chain-hud';
    if (isMinimized) hud.classList.add('minimized');

    // Restore saved position or default to top-right (well clear of bottom chat windows!)
    const savedTop = GM_getValue('torn_hud_pos_top', 88);
    const savedRight = GM_getValue('torn_hud_pos_right', 24);
    hud.style.top = `${savedTop}px`;
    hud.style.right = `${savedRight}px`;

    hud.innerHTML = `
        <div class="hud-header" id="torn-hud-handle">
            <div class="hud-title">
                <span class="hud-status-pill status-same" id="torn-hud-status-pill" title="Green: Updated | Grey: Same">
                    <span class="hud-dot dot-same" id="torn-hud-dot"></span>
                    <span id="torn-hud-status-text">SAME</span>
                </span>
                <span class="hud-full-title">Chain Lineup</span>
                <span class="hud-min-up-text" id="torn-hud-min-up-text">UP: Loading...</span>
            </div>
            <div class="hud-controls">
                <button class="hud-min-post-btn" id="torn-hud-min-post-btn" title="Post Lineup to Faction Chat">📋 Post</button>
                <button class="hud-ctrl-btn" id="torn-hud-min-btn" title="Minimize / Expand">${isMinimized ? '□' : '_'}</button>
                <button class="hud-ctrl-btn" id="torn-hud-close-btn" title="Hide HUD">✕</button>
            </div>
        </div>
        <div class="hud-body">
            <div class="hud-badge-updated" id="torn-hud-badge">⚡ LINEUP UPDATED!</div>
            
            <div class="hud-slot-card up-card">
                <div class="hud-slot-meta">
                    <span class="hud-slot-label">Currently Up</span>
                    <span class="hud-slot-name" id="torn-hud-up-name">Loading...</span>
                </div>
                <span class="hud-hit-target" id="torn-hud-target-time">3:00</span>
            </div>

            <div class="hud-slot-card">
                <div class="hud-slot-meta">
                    <span class="hud-slot-label">Next in Queue</span>
                    <span class="hud-slot-name" id="torn-hud-next-name" style="font-size:12px; color:#cbd5e0;">—</span>
                </div>
            </div>

            <div class="hud-queue-preview" id="torn-hud-queue-preview" style="display:none;"></div>

            <button class="hud-post-btn" id="torn-hud-post-btn" title="Insert formatted lineup into Torn Faction Chat">
                <span>📋</span>
                <span>Post to Faction Chat</span>
            </button>
        </div>
        <div class="hud-footer">
            <label style="display:flex; align-items:center; gap:4px; cursor:pointer;" title="Automatically press Enter when you click Post">
                <input type="checkbox" id="torn-hud-autosend-chk" ${autoSendOnPost ? 'checked' : ''} style="margin:0; cursor:pointer;" />
                <span>Auto-Send</span>
            </label>
            <a href="${SERVER_URL}/chain.html" target="_blank">Open Manager ↗</a>
        </div>
        <div class="hud-toast" id="torn-hud-toast"></div>
    `;

    document.body.appendChild(hud);

    // ── Toast Notification ─────────────────────────────────────────────
    let toastTimer = null;
    function showToast(msg, isErr) {
        const toast = document.getElementById('torn-hud-toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.style.background = isErr ? '#ef4444' : '#10b981';
        toast.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
    }

    // ── Drag & Drop Positioning ────────────────────────────────────────
    const handle = document.getElementById('torn-hud-handle');
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    handle.addEventListener('mousedown', e => {
        if (e.target.closest('.hud-controls')) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const rect = hud.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        hud.style.right = 'auto'; // switch to left/top positioning while dragging
        hud.style.left = `${initialLeft}px`;
        hud.style.top = `${initialTop}px`;
        document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', e => {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        const newLeft = Math.max(10, Math.min(window.innerWidth - hud.offsetWidth - 10, initialLeft + dx));
        const newTop = Math.max(10, Math.min(window.innerHeight - hud.offsetHeight - 10, initialTop + dy));
        hud.style.left = `${newLeft}px`;
        hud.style.top = `${newTop}px`;
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = '';
        const rect = hud.getBoundingClientRect();
        GM_setValue('torn_hud_pos_top', Math.round(rect.top));
        GM_setValue('torn_hud_pos_right', Math.round(window.innerWidth - rect.right));
    });

    // ── Minimize & Close Controls ──────────────────────────────────────
    const minBtn = document.getElementById('torn-hud-min-btn');
    minBtn.addEventListener('click', () => {
        isMinimized = !isMinimized;
        hud.classList.toggle('minimized', isMinimized);
        minBtn.textContent = isMinimized ? '□' : '_';
        GM_setValue('torn_hud_minimized', isMinimized);
    });

    const closeBtn = document.getElementById('torn-hud-close-btn');
    closeBtn.addEventListener('click', () => {
        hud.style.display = 'none';
    });

    const autoSendChk = document.getElementById('torn-hud-autosend-chk');
    autoSendChk.addEventListener('change', e => {
        autoSendOnPost = e.target.checked;
        GM_setValue('torn_hud_autosend', autoSendOnPost);
    });

    // ── Play Synthetic Beep ────────────────────────────────────────────
    function playUpdateChime() {
        if (!soundEnabled) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
        } catch(e) {}
    }

    // ── Live Indicator State (Green: Updated / Grey: Same) ─────────────
    let isLineupUpdated = false;

    function setUpdateStatus(updated) {
        isLineupUpdated = updated;
        const pill = document.getElementById('torn-hud-status-pill');
        const dot = document.getElementById('torn-hud-dot');
        const text = document.getElementById('torn-hud-status-text');
        const mainPostBtn = document.getElementById('torn-hud-post-btn');
        const minPostBtn = document.getElementById('torn-hud-min-post-btn');

        if (updated) {
            if (pill) {
                pill.className = 'hud-status-pill status-updated';
                pill.title = 'Updated! New hit landed or lineup changed';
            }
            if (dot) dot.className = 'hud-dot dot-updated';
            if (text) text.textContent = 'UPDATED';
            if (mainPostBtn) mainPostBtn.style.boxShadow = '0 0 15px rgba(46, 204, 113, 0.6)';
            if (minPostBtn) minPostBtn.style.boxShadow = '0 0 10px rgba(46, 204, 113, 0.6)';
        } else {
            if (pill) {
                pill.className = 'hud-status-pill status-same';
                pill.title = 'Same — Lineup has been posted or is unchanged';
            }
            if (dot) dot.className = 'hud-dot dot-same';
            if (text) text.textContent = 'SAME';
            if (mainPostBtn) mainPostBtn.style.boxShadow = '';
            if (minPostBtn) minPostBtn.style.boxShadow = '';
        }
    }

    // ── Update HUD UI ──────────────────────────────────────────────────
    function renderHUD(data, isNewUpdate) {
        if (!data) return;
        const upEl = document.getElementById('torn-hud-up-name');
        const nextEl = document.getElementById('torn-hud-next-name');
        const targetEl = document.getElementById('torn-hud-target-time');
        const queueEl = document.getElementById('torn-hud-queue-preview');
        const badgeEl = document.getElementById('torn-hud-badge');
        const minUpEl = document.getElementById('torn-hud-min-up-text');

        const lineup = data.lineup || [];
        const curUp = lineup.length >= 1 ? lineup[0].name : 'No members in lineup';
        const curNext = lineup.length >= 2 ? lineup[1].name : '—';
        const hitTime = data.targetHitTime || '3:00';

        if (upEl) upEl.textContent = curUp;
        if (nextEl) nextEl.textContent = curNext;
        if (targetEl) targetEl.textContent = hitTime ? `Hit at ${hitTime}` : 'Target';
        if (minUpEl) minUpEl.textContent = `UP: ${curUp}`;

        if (queueEl) {
            if (lineup.length > 2) {
                const rest = lineup.slice(2, 5).map((m, idx) => `${idx + 3}. ${m.name}`).join(' • ');
                const extra = lineup.length > 5 ? ` +${lineup.length - 5} more` : '';
                queueEl.textContent = rest + extra;
                queueEl.style.display = 'block';
            } else {
                queueEl.style.display = 'none';
            }
        }

        // Visual flash & badge on update
        if (isNewUpdate) {
            setUpdateStatus(true);
            hud.classList.remove('hud-pulse');
            void hud.offsetWidth; // trigger reflow
            hud.classList.add('hud-pulse');

            if (badgeEl) {
                badgeEl.style.display = 'block';
                badgeEl.textContent = `⚡ LINEUP ROTATED: ${curUp}`;
                badgeEl.classList.remove('active');
                void badgeEl.offsetWidth;
                badgeEl.classList.add('active');
            }

            playUpdateChime();
        }
    }

    // Helper to generate the regular vertical format
    function getFullLineupText(data) {
        if (data && data.formattedFull) return data.formattedFull;
        if (!data || !data.lineup || !data.lineup.length) return '';
        const lines = [];
        if (data.targetHitTime) lines.push(`HIT AT: ${data.targetHitTime}`);
        if (data.lineup.length >= 1) lines.push(`UP: ${data.lineup[0].name}`);
        if (data.lineup.length >= 2) lines.push(`NEXT: ${data.lineup[1].name}`);
        for (let i = 2; i < data.lineup.length; i++) {
            lines.push(`${i + 1}. ${data.lineup[i].name}`);
        }
        return lines.join('\n');
    }

    // ── Faction Chat Injection Logic (Regular Vertical Format) ────────
    function postToFactionChat() {
        const textToInsert = getFullLineupText(lineupData);
        if (!textToInsert) {
            showToast('No lineup data available yet.', true);
            return;
        }

        const chatRoot = document.querySelector('#chatRoot') || document.body;

        // Step 1: Open Faction Chat if minimized/closed
        let factionFound = false;
        const allBoxes = document.querySelectorAll('#chatRoot div[class*="chat-box"], #chatRoot [class*="chatBox"]');
        for (const box of allBoxes) {
            if (/faction/i.test(box.textContent || '')) {
                factionFound = true;
                break;
            }
        }

        if (!factionFound) {
            // Find and click the Faction chat dock tab
            const tabs = chatRoot.querySelectorAll('button, div[role="button"], [class*="tab"], [class*="chat-tab"]');
            for (const tab of tabs) {
                if (/faction/i.test(tab.textContent || '') || /faction/i.test(tab.getAttribute('aria-label') || '')) {
                    tab.click();
                    break;
                }
            }
        }

        // Step 2: Locate textarea and set value
        setTimeout(() => {
            const textareas = chatRoot.querySelectorAll('textarea, input[type="text"]');
            let targetInput = null;

            if (textareas.length === 1) {
                targetInput = textareas[0];
            } else if (textareas.length > 1) {
                for (const ta of textareas) {
                    const parent = ta.closest('div[class*="chat-box"], [class*="chatBox"]');
                    if (parent && /faction/i.test(parent.textContent || '')) {
                        targetInput = ta;
                        break;
                    }
                }
                if (!targetInput) targetInput = textareas[textareas.length - 1];
            }

            if (!targetInput) {
                // Fallback: Copy to clipboard
                navigator.clipboard.writeText(textToInsert);
                showToast('Faction chat input not open — copied to clipboard!', false);
                return;
            }

            // React native value setter
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
                                 Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) {
                nativeSetter.call(targetInput, textToInsert);
            } else {
                targetInput.value = textToInsert;
            }

            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            targetInput.focus();
            targetInput.setSelectionRange(textToInsert.length, textToInsert.length);

            // Immediately set status light to Grey (SAME)!
            setUpdateStatus(false);

            if (autoSendOnPost) {
                setTimeout(() => {
                    const parentBox = targetInput.closest('div[class*="chat-box"], [class*="chatBox"]');
                    const sendBtn = parentBox ? parentBox.querySelector('button[type="submit"], [class*="send"], [class*="submit"]') : null;
                    if (sendBtn) {
                        sendBtn.click();
                    } else {
                        targetInput.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
                        }));
                    }
                    showToast('✓ Sent to Faction Chat!', false);
                }, 80);
            } else {
                showToast('✓ Lineup inserted! Press Enter to send.', false);
            }
        }, 120);
    }

    const postBtn = document.getElementById('torn-hud-post-btn');
    if (postBtn) postBtn.addEventListener('click', postToFactionChat);

    const minPostBtn = document.getElementById('torn-hud-min-post-btn');
    if (minPostBtn) minPostBtn.addEventListener('click', postToFactionChat);

    // ── Polling Server Lineup ──────────────────────────────────────────
    function fetchLineup() {
        const fetchMethod = typeof GM_xmlhttpRequest === 'function' ? gmFetch : standardFetch;
        fetchMethod(`${SERVER_URL}/api/chain/lineup`, (err, data) => {
            if (err || !data || !data.ok) return;

            const payload = data.data || {};
            const curVersion = payload.version || 0;
            const curUp = (payload.lineup && payload.lineup[0]) ? payload.lineup[0].name : null;

            const isFirst = lastVersion === null;
            const hasChanged = !isFirst && (curVersion !== lastVersion || curUp !== lastUpName);

            lineupData = payload;
            lastVersion = curVersion;
            lastUpName = curUp;

            renderHUD(payload, hasChanged);
        });
    }

    function gmFetch(url, cb) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            timeout: 4000,
            onload: function(res) {
                try {
                    const json = JSON.parse(res.responseText);
                    cb(null, json);
                } catch(e) { cb(e); }
            },
            onerror: function(err) { cb(err); }
        });
    }

    function standardFetch(url, cb) {
        fetch(url, { signal: AbortSignal.timeout(4000) })
            .then(r => r.json())
            .then(d => cb(null, d))
            .catch(e => cb(e));
    }

    // Start Polling
    fetchLineup();
    setInterval(fetchLineup, POLL_MS);

})();
