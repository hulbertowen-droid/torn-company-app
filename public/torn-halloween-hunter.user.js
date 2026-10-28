// ==UserScript==
// @name         Torn Halloween Target Hunter
// @namespace    https://faction-os.duckdns.org/
// @version      1.0.1
// @description  Zero-latency Halloween Treat Hunter for Torn City. Custom Fair Fight score selector, server-side 'Okay' status verification, hospital cycling, and in-combat spooky finishing weapon highlighter.
// @author       FactionOS
// @match        https://www.torn.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      faction-os.duckdns.org
// @connect      api.torn.com
// @connect      *
// @run-at       document-idle
// @updateURL    https://faction-os.duckdns.org/torn-halloween-hunter.meta.js
// @downloadURL  https://faction-os.duckdns.org/torn-halloween-hunter.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ── Device & Platform Detection ────────────────────────────────
    const isAndroid = /android/i.test(navigator.userAgent || navigator.vendor || '');
    const isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent || navigator.vendor || '');
    const isMobile  = isAndroid || isIOS || (typeof window !== 'undefined' && window.innerWidth <= 768);

    function getDefaultBottomOffset() {
        if (isAndroid) return 96;
        if (isIOS) return 70;
        return 62;
    }

    function sanitizeKey(k) {
        return String(k || '').replace(/[\s\r\n'"]/g, '').trim();
    }

    // ── Constants & Keys ───────────────────────────────────────────
    const BACKEND          = 'https://faction-os.duckdns.org';
    const KEY_API          = 'hw_api_key';
    const KEY_PRESET       = 'hw_preset';          // very_easy | easy | standard | challenging | custom
    const KEY_TARGET_FF    = 'hw_target_ff';       // e.g. 1.25
    const KEY_MIN_FF       = 'hw_min_ff';          // e.g. 1.00
    const KEY_MAX_FF       = 'hw_max_ff';          // e.g. 1.45
    const KEY_INACTIVE     = 'hw_inactive_only';   // true | false
    const KEY_FACTIONLESS  = 'hw_factionless';     // true | false
    const KEY_AUTOLAUNCH   = 'hw_auto_launch';     // true | false
    const KEY_SAMETAB      = 'hw_same_tab';        // true | false
    const KEY_POS_X        = 'hw_widget_pos_x';
    const KEY_POS_Y        = 'hw_widget_pos_y';
    const SESS_EXCL        = 'hw_exclude';
    const SESS_MYID        = 'hw_my_id';

    // Spooky weapons that trigger the "Here's Johnny" +10% treat finishing bonus
    const SPOOKY_WEAPONS = [
        'axe', 'blood spattered sickle', 'chainsaw', "devil's pitchfork",
        'golden broomstick', 'petrified humerus', 'wand of destruction',
        'meat hook', 'cleaver', 'bone saw', 'bonesaw', 'crystalline falcata',
        'scythe', 'rusty cleaver'
    ];

    // Presets for Fair Fight ranges
    const FF_PRESETS = {
        'very_easy':   { name: '🟢 Very Easy',  min: 1.00, max: 1.20, target: 1.10, desc: 'Easiest targets, virtually guaranteed wins' },
        'easy':        { name: '🟡 Easy',       min: 1.20, max: 1.45, target: 1.30, desc: 'Balanced easy targets with solid treat gain' },
        'standard':    { name: '🟠 Standard',   min: 1.45, max: 1.75, target: 1.55, desc: 'Closer fair fight, strong stats scaling' },
        'challenging': { name: '🔴 Challenging',min: 1.75, max: 2.50, target: 2.00, desc: 'Higher stat targets for maximum respect' },
        'custom':      { name: '⚙️ Custom',     min: 1.00, max: 2.00, target: 1.25, desc: 'User-specified min and max Fair Fight range' }
    };

    // ── Storage Helpers ────────────────────────────────────────────
    function load(key, def) {
        try {
            if (typeof GM_getValue === 'function') {
                const v = GM_getValue(key, null);
                if (v !== null && v !== undefined) return v;
            }
            const v = localStorage.getItem(key);
            return v !== null ? JSON.parse(v) : def;
        } catch (e) { return def; }
    }

    function save(key, val) {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(key, val);
            localStorage.setItem(key, JSON.stringify(val));
        } catch (e) {}
    }

    // ── Session Exclude List (Auto-expires after 3 minutes) ─────────
    function getExclude() {
        try {
            const raw = sessionStorage.getItem(SESS_EXCL);
            if (!raw) return [];
            const now = Date.now();
            const valid = [];
            for (const item of raw.split(',').filter(Boolean)) {
                const [id, ts] = item.split(':');
                if (id && (!ts || (now - Number(ts) < 180000))) {
                    valid.push(id);
                }
            }
            return valid;
        } catch (e) { return []; }
    }

    function addExclude(id) {
        if (!id || id === '0') return;
        try {
            const now = Date.now();
            const raw = sessionStorage.getItem(SESS_EXCL) || '';
            const map = new Map();
            for (const item of raw.split(',').filter(Boolean)) {
                const [eid, ets] = item.split(':');
                if (eid && (now - Number(ets || now) < 180000)) {
                    map.set(eid, Number(ets || now));
                }
            }
            map.set(String(id), now);
            const trimmed = Array.from(map.entries()).slice(-40);
            sessionStorage.setItem(SESS_EXCL, trimmed.map(([i, t]) => `${i}:${t}`).join(','));
        } catch (e) {}
    }

    function clearExclude() {
        try {
            sessionStorage.removeItem(SESS_EXCL);
        } catch (e) {}
    }

    // ── State ──────────────────────────────────────────────────────
    // Auto-reuse existing API key if user already linked via elimination hunter
    let apiKey       = sanitizeKey(load(KEY_API, '')) || sanitizeKey(load('elimv2_api_key', ''));
    let activePreset = load(KEY_PRESET, 'easy');
    let targetFF     = Number(load(KEY_TARGET_FF, FF_PRESETS[activePreset]?.target || 1.30));
    let minFF        = Number(load(KEY_MIN_FF, FF_PRESETS[activePreset]?.min || 1.20));
    let maxFF        = Number(load(KEY_MAX_FF, FF_PRESETS[activePreset]?.max || 1.45));
    let inactiveOnly = load(KEY_INACTIVE, true);
    let factionless  = load(KEY_FACTIONLESS, true);
    let autoLaunch   = load(KEY_AUTOLAUNCH, true);
    let sameTab      = load(KEY_SAMETAB, true);
    let myId         = '';
    let busy         = false;
    let bufferedTarget = null;
    let primingPromise = null;

    // ── Resolve Torn ID ────────────────────────────────────────────
    function getMyTornIdFromPage() {
        try {
            if (window.userID) return String(window.userID);
            if (window.user && window.user.id) return String(window.user.id);
            if (window.user && window.user.player_id) return String(window.user.player_id);
        } catch (e) {}
        try {
            const m = document.cookie.match(/(?:^|;\s*)uid=(\d+)/);
            if (m && m[1]) return m[1];
        } catch (e) {}
        try {
            const userLink = document.querySelector('#sidebarroot a[href*="profiles.php?XID="], .user-information a[href*="profiles.php?XID="], #barUser a[href*="profiles.php?XID="], [class*="menu-info_"] a[href*="profiles.php?XID="]');
            if (userLink) {
                const m = userLink.href.match(/xid=(\d+)/i);
                if (m && m[1]) return m[1];
            }
        } catch (e) {}
        return '';
    }

    async function resolveMyId() {
        if (myId) return myId;
        myId = sessionStorage.getItem(SESS_MYID) || sessionStorage.getItem('elimv2_my_id') || '';
        if (myId) return myId;

        myId = getMyTornIdFromPage();
        if (myId) {
            sessionStorage.setItem(SESS_MYID, myId);
            return myId;
        }

        if (!apiKey) return '';
        try {
            const r = await gmFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(apiKey)}`);
            const d = JSON.parse(r);
            if (d && d.player_id) {
                myId = String(d.player_id);
                sessionStorage.setItem(SESS_MYID, myId);
            }
        } catch (e) {}
        return myId;
    }

    // ── GM_xmlhttpRequest / fetch Wrapper (bypasses CORS) ───────────
    function gmFetch(url, opts = {}) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: opts.method || 'GET',
                    url,
                    headers: opts.headers || {},
                    data: opts.body || null,
                    timeout: 9000,
                    onload: (r) => resolve(r.responseText),
                    onerror: () => reject(new Error('GM_xmlhttpRequest error')),
                    ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout'))
                });
            } else {
                fetch(url, {
                    method: opts.method || 'GET',
                    headers: opts.headers || {},
                    body: opts.body,
                    signal: AbortSignal.timeout(9000)
                }).then(r => r.text()).then(resolve).catch(reject);
            }
        });
    }

    // ── Toast Notification ─────────────────────────────────────────
    function showToast(msg, isWarn = false) {
        const t = document.createElement('div');
        t.innerHTML = msg;
        t.style.cssText = `
            position: fixed; bottom: 74px; right: 16px; z-index: 2147483647;
            background: ${isWarn ? '#2d1418' : '#140f1d'};
            border: 1px solid ${isWarn ? '#e63946' : '#ff8a1f'};
            color: #f7ede2; padding: 8px 14px; border-radius: 8px; font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-weight: 600; opacity: 1; transition: opacity 0.4s ease;
            box-shadow: 0 4px 16px rgba(0,0,0,0.7); pointer-events: none;
        `;
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; }, 2600);
        setTimeout(() => { t.remove(); }, 3100);
    }

    // ── Background Pre-Fetch Pipeline (0ms latency target buffer) ──
    async function primeNextTarget(force = false) {
        if (primingPromise && !force) return primingPromise;
        if (bufferedTarget && !force) return bufferedTarget;

        primingPromise = (async () => {
            try {
                await resolveMyId();
                const exclude = getExclude();
                const curId = (window.location.href.match(/user2ID=(\d+)/i) || [])[1];
                if (curId && !exclude.includes(curId)) exclude.push(curId);

                const params = new URLSearchParams({
                    minFF: minFF.toFixed(2),
                    maxFF: maxFF.toFixed(2),
                    targetFF: targetFF.toFixed(2),
                    inactiveOnly: inactiveOnly ? '1' : '0',
                    factionless: factionless ? '1' : '0',
                    exclude: exclude.join(','),
                    myId: myId || ''
                });

                const reqHeaders = {};
                if (apiKey) reqHeaders['x-api-key'] = apiKey;
                if (myId) reqHeaders['x-torn-id'] = myId;

                const resRaw = await gmFetch(`${BACKEND}/api/halloween/snipe?${params.toString()}`, {
                    headers: reqHeaders
                });
                const data = JSON.parse(resRaw);

                if (data && data.success && data.target) {
                    bufferedTarget = data.target;
                    updateButtonDisplay();
                    return bufferedTarget;
                }
            } catch (e) {
                // Background prime failed silently
            } finally {
                primingPromise = null;
            }
            return null;
        })();

        return primingPromise;
    }

    // ── Report Hospitalized / Inactive Targets to Server ───────────
    function reportTargetStatus(targetId, status = 'Hospital', durationSec = 900) {
        if (!targetId) return;
        addExclude(targetId);
        gmFetch(`${BACKEND}/api/halloween/report-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetId, status, duration: durationSec })
        }).catch(() => {});
    }

    // ── Core Snipe Logic ───────────────────────────────────────────
    async function executeSnipe() {
        if (busy) {
            showToast('⏳ Snipe in progress, please wait...', true);
            return;
        }
        busy = true;

        // 1. If a target is already buffered in memory, launch immediately (0ms wait!)
        if (bufferedTarget && bufferedTarget.id) {
            const tgt = bufferedTarget;
            bufferedTarget = null;
            addExclude(tgt.id);
            launchAttack(tgt);
            busy = false;
            setTimeout(() => { primeNextTarget(true); }, 500);
            return;
        }

        setButtonState('hunting');

        try {
            await resolveMyId();

            if (!apiKey && myId) {
                try {
                    const stRaw = await gmFetch(`${BACKEND}/api/user/status`, {
                        headers: { 'x-torn-id': myId }
                    });
                    const st = JSON.parse(stRaw);
                    if (!st || !st.connected) {
                        openSettingsDrawer('Please connect your Torn API key first.');
                        setButtonState('needkey');
                        busy = false;
                        return;
                    }
                } catch (e) {
                    openSettingsDrawer('Please connect your Torn API key.');
                    setButtonState('needkey');
                    busy = false;
                    return;
                }
            } else if (!apiKey && !myId) {
                openSettingsDrawer('Please connect your Torn API key.');
                setButtonState('needkey');
                busy = false;
                return;
            }

            const exclude = getExclude();
            const curId = (window.location.href.match(/user2ID=(\d+)/i) || [])[1];
            if (curId && !exclude.includes(curId)) {
                exclude.push(curId);
                addExclude(curId);
            }

            const params = new URLSearchParams({
                minFF: minFF.toFixed(2),
                maxFF: maxFF.toFixed(2),
                targetFF: targetFF.toFixed(2),
                inactiveOnly: inactiveOnly ? '1' : '0',
                factionless: factionless ? '1' : '0',
                exclude: exclude.join(','),
                myId: myId || ''
            });

            const reqHeaders = {};
            if (apiKey) reqHeaders['x-api-key'] = apiKey;
            if (myId) reqHeaders['x-torn-id'] = myId;

            let data;
            try {
                const raw = await gmFetch(`${BACKEND}/api/halloween/snipe?${params.toString()}`, {
                    headers: reqHeaders
                });
                data = JSON.parse(raw);
            } catch (netErr) {
                showToast('⚠️ FactionOS backend unreachable. Check internet connection.', true);
                setButtonState('error', 'Server Error');
                busy = false;
                return;
            }

            if (data && (data.code === 'ACCOUNT_NOT_CONNECTED' || data.code === 'INVALID_API_KEY')) {
                openSettingsDrawer('Torn API Key rejected or not linked. Please save a valid key.');
                setButtonState('needkey');
                busy = false;
                return;
            }

            if (data && data.success && data.target) {
                addExclude(data.target.id);
                launchAttack(data.target);
                setTimeout(() => { primeNextTarget(true); }, 500);
            } else {
                const msg = data?.message || 'No Okay targets found in selected range. Retrying...';
                showToast(`⏳ ${msg}`, true);
                setButtonState('empty');
                setTimeout(() => { updateButtonDisplay(); }, 3500);
            }
        } catch (err) {
            showToast(`⚠️ Snipe error: ${err.message}`, true);
            setButtonState('error');
        } finally {
            busy = false;
        }
    }

    function launchAttack(target) {
        const url = `https://www.torn.com/page.php?sid=attack&user2ID=${target.id}`;
        showToast(`🎃 Launching: <b>${target.name}</b> [${target.id}] (Lvl ${target.level}, FF ${Number(target.ff).toFixed(2)})`);

        if (sameTab) {
            window.location.href = url;
        } else {
            window.open(url, '_blank');
            updateButtonDisplay();
        }
    }

    // ── Floating HUD Elements ──────────────────────────────────────
    let wrapEl = null;
    let rowEl = null;
    let btnEl = null;
    let cogBtn = null;
    let dragHandle = null;
    let drawerEl = null;
    let drawerOpen = false;

    function createFloatingHUD() {
        if (wrapEl && document.body.contains(wrapEl)) return;

        // Container wrapper
        wrapEl = document.createElement('div');
        wrapEl.id = 'torn-hw-wrap';
        const bOffset = getDefaultBottomOffset();

        const savedX = localStorage.getItem(KEY_POS_X);
        const savedY = localStorage.getItem(KEY_POS_Y);

        wrapEl.style.cssText = `
            position: fixed; z-index: 2147483640;
            display: flex; flex-direction: column;
            ${savedX && savedY ? `left:${savedX}px; top:${savedY}px;` : `right:14px; bottom:${bOffset}px;`}
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            user-select: none; -webkit-user-select: none;
        `;

        // Row containing drag handle, snipe button, and gear
        rowEl = document.createElement('div');
        rowEl.id = 'torn-hw-row';
        rowEl.style.cssText = 'display:flex; gap:6px; align-items:center;';

        // 1. Drag Handle
        dragHandle = document.createElement('div');
        dragHandle.id = 'hw-drag-handle';
        dragHandle.textContent = '⠿';
        dragHandle.title = 'Hold & drag anywhere on screen';
        dragHandle.style.cssText = `
            cursor: grab;
            padding: ${isMobile ? '8px 6px' : '6px 4px'};
            min-width: 20px;
            color: #ff8a1f;
            font-size: 18px;
            user-select: none;
            touch-action: none;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.8;
            transition: opacity 0.15s;
        `;
        dragHandle.onmouseover = () => { dragHandle.style.opacity = '1'; };
        dragHandle.onmouseout  = () => { dragHandle.style.opacity = '0.8'; };

        // 2. Main Snipe Button
        btnEl = document.createElement('button');
        btnEl.id = 'torn-hw-snipe-btn';
        btnEl.style.cssText = `
            background: linear-gradient(135deg, #181124 0%, #29153a 100%);
            border: 1.5px solid #ff8a1f; color: #ffffff;
            padding: 9px 16px; border-radius: 20px; font-size: 13px; font-weight: 800;
            cursor: pointer; display: flex; align-items: center; gap: 6px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.65), 0 0 10px rgba(255,138,31,0.25);
            transition: transform 0.1s ease, border-color 0.2s ease, box-shadow 0.2s ease;
            white-space: nowrap;
        `;
        btnEl.innerHTML = `<span>🎃</span> <span id="hw-pill-label">Snipe (FF ${targetFF.toFixed(2)})</span>`;
        btnEl.onmouseover = () => { if (!btnEl.disabled) btnEl.style.transform = 'scale(1.03)'; };
        btnEl.onmouseout  = () => { btnEl.style.transform = 'scale(1)'; };
        btnEl.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            executeSnipe();
        };

        // 3. Settings Gear Button
        cogBtn = document.createElement('button');
        cogBtn.id = 'torn-hw-cog-btn';
        cogBtn.title = 'Halloween Hunter Settings';
        cogBtn.style.cssText = `
            background: #181124; border: 1.5px solid #ff8a1f; color: #ff8a1f;
            width: 34px; height: 34px; border-radius: 50%; font-size: 14px;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5); transition: transform 0.15s ease;
            flex-shrink: 0;
        `;
        cogBtn.innerHTML = '⚙️';
        cogBtn.onmouseover = () => { cogBtn.style.transform = 'scale(1.08)'; };
        cogBtn.onmouseout  = () => { cogBtn.style.transform = 'scale(1)'; };
        cogBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSettingsDrawer();
        };

        // 4. Settings Drawer
        createSettingsDrawer();

        // Assemble
        rowEl.appendChild(dragHandle);
        rowEl.appendChild(btnEl);
        rowEl.appendChild(cogBtn);
        wrapEl.appendChild(drawerEl);
        wrapEl.appendChild(rowEl);
        document.body.appendChild(wrapEl);

        // Bind Dragging ONLY to dragHandle
        initDragAndDrop();

        updateButtonDisplay();
    }

    function initDragAndDrop() {
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let initialLeft = 0;
        let initialTop = 0;

        function startDrag(e) {
            isDragging = true;
            dragHandle.style.cursor = 'grabbing';
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            dragStartX = clientX;
            dragStartY = clientY;

            const rect = wrapEl.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            wrapEl.style.left = `${initialLeft}px`;
            wrapEl.style.top = `${initialTop}px`;
            wrapEl.style.bottom = 'auto';
            wrapEl.style.right = 'auto';

            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDrag);
            document.addEventListener('touchmove', onDrag, { passive: false });
            document.addEventListener('touchend', stopDrag);
        }

        function onDrag(e) {
            if (!isDragging) return;
            if (e.cancelable) e.preventDefault();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const deltaX = clientX - dragStartX;
            const deltaY = clientY - dragStartY;

            let newLeft = initialLeft + deltaX;
            let newTop = initialTop + deltaY;

            const vpW = window.visualViewport ? window.visualViewport.width : window.innerWidth;
            const vpH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            const bottomForbiddenZone = isAndroid ? 96 : (isIOS ? 70 : 55);

            const maxLeft = Math.max(5, vpW - wrapEl.offsetWidth - 8);
            const maxTop = Math.max(5, vpH - wrapEl.offsetHeight - bottomForbiddenZone);

            newLeft = Math.max(5, Math.min(newLeft, maxLeft));
            newTop = Math.max(5, Math.min(newTop, maxTop));

            wrapEl.style.left = `${newLeft}px`;
            wrapEl.style.top = `${newTop}px`;
        }

        function stopDrag() {
            if (!isDragging) return;
            isDragging = false;
            dragHandle.style.cursor = 'grab';

            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDrag);
            document.removeEventListener('touchmove', onDrag);
            document.removeEventListener('touchend', stopDrag);

            const rect = wrapEl.getBoundingClientRect();
            localStorage.setItem(KEY_POS_X, Math.round(rect.left));
            localStorage.setItem(KEY_POS_Y, Math.round(rect.top));
        }

        dragHandle.addEventListener('mousedown', startDrag);
        dragHandle.addEventListener('touchstart', startDrag, { passive: false });
    }

    function updateButtonDisplay() {
        if (!btnEl) return;
        const labelEl = btnEl.querySelector('#hw-pill-label');
        if (!labelEl) return;

        if (bufferedTarget) {
            btnEl.style.borderColor = '#5fd37a';
            btnEl.style.boxShadow = '0 4px 16px rgba(0,0,0,0.65), 0 0 12px rgba(95,211,122,0.4)';
            labelEl.innerHTML = `Hit ${bufferedTarget.name} <span style="font-size:11px;opacity:0.8;">(FF ${Number(bufferedTarget.ff).toFixed(2)})</span>`;
        } else {
            btnEl.style.borderColor = '#ff8a1f';
            btnEl.style.boxShadow = '0 4px 16px rgba(0,0,0,0.65), 0 0 10px rgba(255,138,31,0.25)';
            labelEl.textContent = `Snipe (FF ${targetFF.toFixed(2)})`;
        }
    }

    function setButtonState(state, customText) {
        if (!btnEl) return;
        const labelEl = btnEl.querySelector('#hw-pill-label');
        if (!labelEl) return;

        if (state === 'hunting') {
            btnEl.style.borderColor = '#9d4edd';
            labelEl.textContent = 'Searching FFScouter...';
        } else if (state === 'needkey') {
            btnEl.style.borderColor = '#e63946';
            labelEl.textContent = '🔑 Link API Key';
        } else if (state === 'empty') {
            btnEl.style.borderColor = '#e63946';
            labelEl.textContent = 'No Okay Targets';
        } else if (state === 'error') {
            btnEl.style.borderColor = '#e63946';
            labelEl.textContent = customText || 'Error';
        }
    }

    // ── Settings Drawer ────────────────────────────────────────────
    function toggleSettingsDrawer() {
        if (!drawerEl) createSettingsDrawer();
        drawerOpen = !drawerOpen;

        if (drawerOpen) {
            drawerEl.style.display = 'block';

            // Flip drawer direction based on widget vertical position
            if (wrapEl) {
                const rect = wrapEl.getBoundingClientRect();
                const vpH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                const isTopHalf = rect.top < vpH / 2;
                if (isTopHalf) {
                    wrapEl.style.flexDirection = 'column-reverse';
                    drawerEl.style.marginBottom = '0';
                    drawerEl.style.marginTop = '6px';
                } else {
                    wrapEl.style.flexDirection = 'column';
                    drawerEl.style.marginBottom = '6px';
                    drawerEl.style.marginTop = '0';
                }
            }
        } else {
            drawerEl.style.display = 'none';
        }
    }

    function openSettingsDrawer(msg) {
        if (!drawerOpen) toggleSettingsDrawer();
        if (msg) showToast(msg, true);
    }

    function createSettingsDrawer() {
        if (drawerEl) return;

        drawerEl = document.createElement('div');
        drawerEl.id = 'torn-hw-drawer';
        drawerEl.style.cssText = `
            width: 320px; max-width: calc(100vw - 28px); max-height: 75vh; overflow-y: auto;
            background: #15101f; border: 1.5px solid #ff8a1f; border-radius: 12px;
            color: #f7ede2; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.85); padding: 14px; display: none;
            box-sizing: border-box;
        `;

        drawerEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #322544; padding-bottom:8px; margin-bottom:12px;">
                <div style="font-weight:700; font-size:15px; color:#ff8a1f; display:flex; align-items:center; gap:6px;">
                    <span>🎃</span> Halloween Hunter Settings
                </div>
                <button id="hw-drawer-close" style="background:none; border:none; color:#a29bb0; font-size:18px; cursor:pointer; padding:2px 6px;">✖</button>
            </div>

            <div style="font-size:11px; color:#a29bb0; margin-bottom:12px;">
                Finds beatable targets with your chosen Fair Fight score, guarantees they are <b>Okay</b> in Torn, and highlights spooky weapons in combat.
            </div>

            <!-- Fair Fight Score Presets -->
            <div style="margin-bottom:12px;">
                <label style="font-size:12px; font-weight:700; color:#e0dbe8; display:block; margin-bottom:6px;">Fair Fight Range</label>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:8px;">
                    ${Object.entries(FF_PRESETS).map(([k, p]) => `
                        <button class="hw-preset-btn ${activePreset === k ? 'active' : ''}" data-preset="${k}" style="
                            background: ${activePreset === k ? '#ff8a1f' : '#231933'};
                            color: ${activePreset === k ? '#120d18' : '#f7ede2'};
                            border: 1px solid ${activePreset === k ? '#ff8a1f' : '#453260'};
                            padding: 6px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; text-align: left;
                        ">
                            ${p.name}
                        </button>
                    `).join('')}
                </div>
                <div id="hw-preset-desc" style="font-size:11px; color:#ffb46b; margin-bottom:8px;">
                    ${FF_PRESETS[activePreset]?.desc || ''}
                </div>
            </div>

            <!-- Custom FF Sliders/Inputs -->
            <div id="hw-custom-ff-box" style="display:${activePreset === 'custom' ? 'block' : 'none'}; background:#201630; padding:8px 10px; border-radius:6px; margin-bottom:12px; border:1px solid #3c2a52;">
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                    <span style="font-size:11px; color:#d6d0e0;">Min FF: <b id="hw-min-val">${minFF.toFixed(2)}</b></span>
                    <input id="hw-min-slider" type="range" min="1.0" max="2.5" step="0.05" value="${minFF}" style="width:140px; accent-color:#ff8a1f;">
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                    <span style="font-size:11px; color:#d6d0e0;">Max FF: <b id="hw-max-val">${maxFF.toFixed(2)}</b></span>
                    <input id="hw-max-slider" type="range" min="1.0" max="3.0" step="0.05" value="${maxFF}" style="width:140px; accent-color:#ff8a1f;">
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span style="font-size:11px; color:#d6d0e0;">Target FF: <b id="hw-tgt-val">${targetFF.toFixed(2)}</b></span>
                    <input id="hw-tgt-slider" type="range" min="1.0" max="2.5" step="0.05" value="${targetFF}" style="width:140px; accent-color:#ff8a1f;">
                </div>
            </div>

            <!-- Toggles -->
            <div style="margin-bottom:12px; font-size:12px; display:flex; flex-direction:column; gap:6px;">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input id="hw-opt-inactive" type="checkbox" ${inactiveOnly ? 'checked' : ''} style="accent-color:#ff8a1f;">
                    <span>Inactive players only (clean, easy treats)</span>
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input id="hw-opt-factionless" type="checkbox" ${factionless ? 'checked' : ''} style="accent-color:#ff8a1f;">
                    <span>Factionless only (no retaliation risk)</span>
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input id="hw-opt-autolaunch" type="checkbox" ${autoLaunch ? 'checked' : ''} style="accent-color:#ff8a1f;">
                    <span>Auto-launch attack on 1-click</span>
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input id="hw-opt-sametab" type="checkbox" ${sameTab ? 'checked' : ''} style="accent-color:#ff8a1f;">
                    <span>Open attack in same tab</span>
                </label>
            </div>

            <!-- API Key Section -->
            <div style="margin-bottom:12px; padding:8px; background:#1e142c; border-radius:6px; border:1px solid #36264d;">
                <label style="font-size:11px; font-weight:700; color:#d6d0e0; display:block; margin-bottom:4px;">Torn Limited API Key</label>
                <div style="display:flex; gap:6px;">
                    <input id="hw-key-input" type="password" placeholder="16-char Limited Key" value="${apiKey}" style="
                        flex:1; background:#0f0b17; border:1px solid #453260; color:#ffffff; padding:5px 8px; border-radius:5px; font-size:11px;
                    ">
                    <button id="hw-key-save" style="
                        background:#ff8a1f; border:none; color:#120d18; font-weight:700; padding:5px 10px; border-radius:5px; cursor:pointer; font-size:11px;
                    ">Save</button>
                </div>
            </div>

            <!-- Actions -->
            <div style="display:flex; gap:6px;">
                <button id="hw-btn-test-snipe" style="
                    flex:1; background:linear-gradient(135deg, #ff8a1f, #e63946); border:none; color:#ffffff; font-weight:700;
                    padding:8px; border-radius:6px; cursor:pointer; font-size:12px;
                ">🎃 Snipe Now</button>
                <button id="hw-btn-clear-cache" style="
                    background:#2c1d3f; border:1px solid #453260; color:#a29bb0; padding:8px 10px; border-radius:6px; cursor:pointer; font-size:11px;
                " title="Clear visited targets cache">🔄 Reset</button>
            </div>
        `;

        // Bind Drawer Events
        drawerEl.querySelector('#hw-drawer-close').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSettingsDrawer();
        };

        // Preset button clicks
        drawerEl.querySelectorAll('.hw-preset-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const pKey = btn.dataset.preset;
                activePreset = pKey;
                save(KEY_PRESET, activePreset);

                if (FF_PRESETS[pKey]) {
                    minFF = FF_PRESETS[pKey].min;
                    maxFF = FF_PRESETS[pKey].max;
                    targetFF = FF_PRESETS[pKey].target;
                    save(KEY_MIN_FF, minFF);
                    save(KEY_MAX_FF, maxFF);
                    save(KEY_TARGET_FF, targetFF);
                }

                drawerEl.querySelectorAll('.hw-preset-btn').forEach(b => {
                    const isCur = b.dataset.preset === activePreset;
                    b.style.background = isCur ? '#ff8a1f' : '#231933';
                    b.style.color = isCur ? '#120d18' : '#f7ede2';
                    b.style.borderColor = isCur ? '#ff8a1f' : '#453260';
                });

                const descEl = drawerEl.querySelector('#hw-preset-desc');
                if (descEl) descEl.textContent = FF_PRESETS[pKey]?.desc || '';

                const customBox = drawerEl.querySelector('#hw-custom-ff-box');
                if (customBox) customBox.style.display = activePreset === 'custom' ? 'block' : 'none';

                bufferedTarget = null;
                updateButtonDisplay();
                primeNextTarget(true);
            };
        });

        // Sliders
        const minSlider = drawerEl.querySelector('#hw-min-slider');
        const maxSlider = drawerEl.querySelector('#hw-max-slider');
        const tgtSlider = drawerEl.querySelector('#hw-tgt-slider');
        const minVal = drawerEl.querySelector('#hw-min-val');
        const maxVal = drawerEl.querySelector('#hw-max-val');
        const tgtVal = drawerEl.querySelector('#hw-tgt-val');

        if (minSlider) {
            minSlider.oninput = (e) => {
                minFF = parseFloat(e.target.value);
                if (minVal) minVal.textContent = minFF.toFixed(2);
                save(KEY_MIN_FF, minFF);
                bufferedTarget = null;
            };
            minSlider.onchange = () => primeNextTarget(true);
        }

        if (maxSlider) {
            maxSlider.oninput = (e) => {
                maxFF = parseFloat(e.target.value);
                if (maxVal) maxVal.textContent = maxFF.toFixed(2);
                save(KEY_MAX_FF, maxFF);
                bufferedTarget = null;
            };
            maxSlider.onchange = () => primeNextTarget(true);
        }

        if (tgtSlider) {
            tgtSlider.oninput = (e) => {
                targetFF = parseFloat(e.target.value);
                if (tgtVal) tgtVal.textContent = targetFF.toFixed(2);
                save(KEY_TARGET_FF, targetFF);
                updateButtonDisplay();
                bufferedTarget = null;
            };
            tgtSlider.onchange = () => primeNextTarget(true);
        }

        // Toggles
        drawerEl.querySelector('#hw-opt-inactive').onchange = (e) => {
            inactiveOnly = e.target.checked;
            save(KEY_INACTIVE, inactiveOnly);
            bufferedTarget = null;
            primeNextTarget(true);
        };

        drawerEl.querySelector('#hw-opt-factionless').onchange = (e) => {
            factionless = e.target.checked;
            save(KEY_FACTIONLESS, factionless);
            bufferedTarget = null;
            primeNextTarget(true);
        };

        drawerEl.querySelector('#hw-opt-autolaunch').onchange = (e) => {
            autoLaunch = e.target.checked;
            save(KEY_AUTOLAUNCH, autoLaunch);
        };

        drawerEl.querySelector('#hw-opt-sametab').onchange = (e) => {
            sameTab = e.target.checked;
            save(KEY_SAMETAB, sameTab);
        };

        // Key Save
        const keyInput = drawerEl.querySelector('#hw-key-input');
        const keySaveBtn = drawerEl.querySelector('#hw-key-save');
        keySaveBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const val = sanitizeKey(keyInput.value);
            if (!val || val.length < 16) {
                showToast('⚠️ Key must be at least 16 characters', true);
                return;
            }
            keySaveBtn.textContent = 'Saving...';
            apiKey = val;
            save(KEY_API, apiKey);

            try {
                await resolveMyId();
                await gmFetch(`${BACKEND}/api/user/link-key`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey, tornId: myId })
                });
            } catch (err) {}

            keySaveBtn.textContent = 'Saved!';
            showToast('✅ API Key successfully saved and linked!');
            setTimeout(() => { keySaveBtn.textContent = 'Save'; }, 2000);
            bufferedTarget = null;
            primeNextTarget(true);
        };

        // Test Snipe
        drawerEl.querySelector('#hw-btn-test-snipe').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            drawerEl.style.display = 'none';
            drawerOpen = false;
            executeSnipe();
        };

        // Reset
        drawerEl.querySelector('#hw-btn-clear-cache').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            clearExclude();
            bufferedTarget = null;
            showToast('🔄 Exclude cache cleared. Retrying all targets!');
            primeNextTarget(true);
        };
    }

    // ── Attack Page Assistant (Spooky Finishers) ────────────────────
    let attackPageChecked = false;
    let finishWeaponHighlighted = false;

    function initAttackPageAssistant() {
        if (!window.location.href.includes('page.php?sid=attack')) return;
        if (attackPageChecked && window.location.href === attackPageChecked) return;
        attackPageChecked = window.location.href;
        finishWeaponHighlighted = false;

        const targetId = (window.location.href.match(/user2ID=(\d+)/i) || [])[1];

        // 1. Check if the target is already in hospital upon landing
        setTimeout(() => {
            const bodyTxt = (document.body ? document.body.innerText || '' : '').toLowerCase();
            const hospTerms = ['currently in hospital', 'cannot be attacked', 'is in hospital', 'hospitalized', 'hospitalised'];
            if (hospTerms.some(t => bodyTxt.includes(t))) {
                if (targetId) {
                    reportTargetStatus(targetId, 'Hospital', 900);
                    showToast('⚠️ Target is in hospital. Auto-excluded from queue.', true);
                }
            }
        }, 800);

        // 2. Observe Combat for Low Defender HP (<20%) to highlight spooky finisher
        const attackObserver = new MutationObserver(() => {
            checkCombatForSpookyFinish(targetId);
        });

        const targetNode = document.querySelector('#attackroot, .attack-container, #body') || document.body;
        if (targetNode) {
            attackObserver.observe(targetNode, { childList: true, subtree: true, characterData: true });
        }
    }

    function checkCombatForSpookyFinish(targetId) {
        if (finishWeaponHighlighted) return;

        // Look for defender HP bar
        const defenderBars = document.querySelectorAll('[class*="defender"] [class*="bar"], [class*="defender"] [class*="health"], .user-bar, [class*="hp-bar"]');
        let defenderPct = null;

        for (const bar of defenderBars) {
            const w = bar.style.width;
            if (w && w.includes('%')) {
                const val = parseFloat(w);
                if (!isNaN(val)) {
                    defenderPct = val;
                    break;
                }
            }
        }

        // Also check raw text HP indicators
        if (defenderPct === null) {
            const hpTexts = document.querySelectorAll('[class*="defender"] [class*="hp"], [class*="defender"] [class*="value"]');
            for (const el of hpTexts) {
                const txt = el.textContent || '';
                const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
                if (m && Number(m[2]) > 0) {
                    defenderPct = (Number(m[1]) / Number(m[2])) * 100;
                    break;
                }
            }
        }

        // If defender is under 20% HP, highlight spooky finishing weapons
        if (defenderPct !== null && defenderPct > 0 && defenderPct <= 20) {
            highlightSpookyWeapons();
        }

        // Detect combat win/end
        const bodyTxt = (document.body ? document.body.innerText || '' : '').toLowerCase();
        if (bodyTxt.includes('hospitalize') || bodyTxt.includes('mug') || bodyTxt.includes('leave') || bodyTxt.includes('won the fight')) {
            if (targetId) {
                reportTargetStatus(targetId, 'Hospital', 900);
                finishWeaponHighlighted = true;
            }
        }
    }

    function highlightSpookyWeapons() {
        const weaponButtons = document.querySelectorAll('button[class*="weapon"], [class*="action-item"], [data-action="attack"], [class*="weaponSlot"], li[class*="weapon"]');
        let highlighted = false;

        weaponButtons.forEach(btn => {
            const txt = (btn.textContent || btn.getAttribute('aria-label') || btn.title || '').toLowerCase();
            const isSpooky = SPOOKY_WEAPONS.some(sw => txt.includes(sw));

            if (isSpooky) {
                btn.style.boxShadow = '0 0 16px #ff8a1f, 0 0 28px #9d4edd !important';
                btn.style.border = '2px solid #ff8a1f !important';
                btn.style.animation = 'hw-pulse 1s infinite alternate';

                if (!btn.querySelector('.hw-spooky-tag')) {
                    const tag = document.createElement('div');
                    tag.className = 'hw-spooky-tag';
                    tag.textContent = '🎃 +10% TREAT FINISHER';
                    tag.style.cssText = `
                        position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
                        background: #ff8a1f; color: #120d18; font-size: 9px; font-weight: 800;
                        padding: 1px 6px; border-radius: 4px; pointer-events: none; white-space: nowrap;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.6);
                    `;
                    btn.style.position = 'relative';
                    btn.appendChild(tag);
                }
                highlighted = true;
            }
        });

        if (highlighted && !finishWeaponHighlighted) {
            finishWeaponHighlighted = true;
            showToast('🎃 <b>FINISH WITH SPOOKY WEAPON!</b><br>Equip chainsaw/axe/falcata for +10% treat bonus!');
        }
    }

    // Add pulse keyframe animation
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        @keyframes hw-pulse {
            from { transform: scale(1); filter: brightness(1); }
            to { transform: scale(1.04); filter: brightness(1.25); }
        }
    `;
    document.head.appendChild(styleEl);

    // ── SPA Navigation Watcher ─────────────────────────────────────
    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            initAttackPageAssistant();
            updateButtonDisplay();
        }
    }, 500);

    // ── Initialize ─────────────────────────────────────────────────
    createFloatingHUD();
    initAttackPageAssistant();
    primeNextTarget(false);

})();
