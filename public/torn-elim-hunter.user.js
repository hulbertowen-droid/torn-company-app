// ==UserScript==
// @name         Torn Elimination Target Hunter
// @namespace    https://spider-verse.net/
// @version      2.4.7
// @description  Autonomous 1-click snipe button for Torn Elimination. Finds beatable enemies that are NOT in hospital and NOT flying from ANY page.
// @author       Spider-Verse
// @match        https://www.torn.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      spider-verse.net
// @connect      ffscouter.com
// @connect      api.torn.com
// @connect      *
// @run-at       document-idle
// @updateURL    https://spider-verse.net/torn-elim-hunter.meta.js
// @downloadURL  https://spider-verse.net/torn-elim-hunter.user.js
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

    // ── Constants ──────────────────────────────────────────────────
    const BACKEND       = 'https://spider-verse.net';
    const KEY_API       = 'elimv2_api_key';
    const KEY_TIER      = 'elimv2_ff_tier';       // easy | manageable | difficult | all
    const KEY_AUTOLAUNCH= 'elimv2_auto_launch';   // true | false
    const SESS_EXCL     = 'elimv2_exclude';       // comma-separated IDs excluded this session
    const SESS_MYID     = 'elimv2_my_id';
    const SESS_BGSYNC   = 'elimv2_bg_synced';

    // Max IDs to keep in the exclude list — prevents unbounded URL growth
    const MAX_EXCLUDE = 80;

    // ── Storage ────────────────────────────────────────────────────
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

    // ── Session exclude list ───────────────────────────────────────
    function getExclude() {
        try { return (sessionStorage.getItem(SESS_EXCL) || '').split(',').filter(Boolean); }
        catch (e) { return []; }
    }

    function addExclude(id) {
        if (!id || id === '0') return;
        let list = getExclude();
        const sid = String(id);
        if (!list.includes(sid)) list.push(sid);
        if (list.length > MAX_EXCLUDE) list = list.slice(list.length - MAX_EXCLUDE);
        try { sessionStorage.setItem(SESS_EXCL, list.join(',')); } catch (e) {}
    }

    // ── State ──────────────────────────────────────────────────────
    let apiKey     = sanitizeKey(load(KEY_API, ''));
    let ffTier     = load(KEY_TIER, 'manageable');
    let autoLaunch = load(KEY_AUTOLAUNCH, false);
    let myId       = '';
    let busy       = false;

    // ── Get My Torn ID directly from page DOM/cookies ───────────────
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
            // Restrict DOM extraction strictly to sidebar / user navigation to avoid matching target profiles on profiles.php or competition.php
            const userLink = document.querySelector('#sidebarroot a[href*="profiles.php?XID="], .user-information a[href*="profiles.php?XID="], #barUser a[href*="profiles.php?XID="], [class*="menu-info_"] a[href*="profiles.php?XID="]');
            if (userLink) {
                const m = userLink.href.match(/xid=(\d+)/i);
                if (m && m[1]) return m[1];
            }
        } catch (e) {}
        return '';
    }

    // ── Resolve my own Torn ID ─────────────────────────────────────
    async function resolveMyId() {
        if (myId) return myId;
        myId = sessionStorage.getItem(SESS_MYID) || '';
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

    // ── GM_xmlhttpRequest wrapper (bypasses CORS) ──────────────────
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

    // ── Auto-sync competition page rosters to backend (Elimination only) ──
    const syncedTeams = new Set();
    let rosterSyncInFlight = false;

    function syncRosterIfOnCompetitionPage() {
        if (!window.location.href.includes('competition.php')) return;
        if (!apiKey) return;
        if (rosterSyncInFlight) return;

        // Verify that this is the Elimination competition view
        const pageText = (document.body ? document.body.innerText || '' : '').toLowerCase();
        if (!pageText.includes('elimination')) return;

        // Try to identify the active opposing team name from tab or header
        let rawTeam = '';
        const activeTabEl = document.querySelector('.active-tab, .ui-tabs-active, .tab-active, [class*="teamTitle"], [class*="teamName"], .team-info h4, .team-name');
        if (activeTabEl) {
            rawTeam = (activeTabEl.innerText || activeTabEl.textContent || '').trim();
        }
        if (!rawTeam) {
            const h4s = Array.from(document.querySelectorAll('h4, h3, h2, .title'));
            for (const h of h4s) {
                const t = (h.innerText || '').trim();
                if (t && !t.toLowerCase().includes('competition') && !t.toLowerCase().includes('elimination') && t.length < 35) {
                    rawTeam = t;
                    break;
                }
            }
        }

        // Sanitize team name (strip lives/parentheticals, e.g. "Desert Eagles (142 lives)" -> "Desert Eagles")
        const teamName = rawTeam.replace(/\s*\(\s*\d+[^)]*\)/g, '').trim();
        if (!teamName) return;

        const teamKey = teamName.toLowerCase();
        if (syncedTeams.has(teamKey)) return;

        const links = document.querySelectorAll('a[href*="profiles.php?XID="], a[href*="profiles.php?xid="]');
        if (!links || links.length === 0) return;

        resolveMyId().then((selfId) => {
            const members = [];
            const seen = new Set();
            links.forEach(link => {
                const m = link.href.match(/xid=(\d+)/i);
                if (!m) return;
                const id = m[1];
                if (seen.has(id) || id === selfId) return;
                seen.add(id);
                members.push({ id, name: (link.innerText || '').trim() });
            });

            if (members.length === 0) return;

            rosterSyncInFlight = true;
            syncedTeams.add(teamKey);

            gmFetch(`${BACKEND}/api/elim/sync-roster`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'x-torn-id': selfId },
                body: JSON.stringify({ apiKey, members, teamName, myId: selfId })
            }).then(raw => {
                try {
                    const d = JSON.parse(raw);
                    if (d && d.success && d.memberCount !== undefined) {
                        showToast(`✅ Synced ${d.memberCount} competitors from team "${teamName}"`);
                    } else if (d && d.code === 'NOT_IN_ELIMINATION') {
                        // User not enrolled in Elimination
                        setButtonState('not_in_elim');
                    } else if (d && d.error === 'CANNOT_SYNC_OWN_TEAM') {
                        // User's own team — keep in syncedTeams to prevent re-attempts
                    }
                } catch (e) {}
            }).catch(() => {
                syncedTeams.delete(teamKey);
            }).finally(() => { rosterSyncInFlight = false; });
        });
    }

    // Show a brief non-intrusive toast notification
    function showToast(msg) {
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = `
            position: fixed; bottom: 70px; right: 16px; z-index: 2147483647;
            background: #1a1d27; border: 1px solid #e74c3c; color: #ecf0f1;
            padding: 6px 12px; border-radius: 6px; font-size: 11px;
            font-family: -apple-system, sans-serif; opacity: 1;
            transition: opacity 0.5s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.6);
        `;
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; }, 2500);
        setTimeout(() => { t.remove(); }, 3100);
    }

    // ── Detect if current attack page target is in hospital ────────
    let hospCheckUrl = '';
    let hospCheckDone = false;

    function checkAttackScreenForHosp() {
        const m = window.location.href.match(/user2ID=(\d+)/i);
        if (!m) return;
        const targetId = m[1];

        if (window.location.href === hospCheckUrl && hospCheckDone) return;
        hospCheckUrl = window.location.href;
        hospCheckDone = false;

        setTimeout(() => {
            if (hospCheckDone) return;
            hospCheckDone = true;

            const text = (document.body ? document.body.innerText || '' : '').toLowerCase();
            const hospIndicators = [
                'currently in hospital',
                'cannot be attacked',
                'is in hospital',
                'hospitalised',
                'hospitalized',
                'is hospitalized',
            ];
            const inHosp = hospIndicators.some(h => text.includes(h));
            if (inHosp) {
                addExclude(targetId);
                reportHospToServer(targetId);
                setButtonState('hosp');
            }
        }, 1800);
    }

    function reportHospToServer(targetId) {
        if (!targetId) return;
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['x-api-key'] = apiKey;
        if (myId) headers['x-torn-id'] = myId;
        gmFetch(`${BACKEND}/api/elim/report-hosp`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ targetId: String(targetId), apiKey, myId })
        }).catch(() => {});
    }

    // ── Core snipe logic ──────────────────────────────────────────
    async function executeSnipe() {
        if (busy) return;

        busy = true;
        setButtonState('hunting');

        try {
            await resolveMyId();

            // Check if account is connected locally or on backend
            if (!apiKey) {
                if (myId) {
                    try {
                        const stRaw = await gmFetch(`${BACKEND}/api/user/status`, {
                            headers: { 'x-torn-id': myId }
                        });
                        const st = JSON.parse(stRaw);
                        if (!st || !st.connected) {
                            renderNotConnectedCard();
                            setButtonState('needkey');
                            busy = false;
                            return;
                        }
                    } catch (e) {
                        renderNotConnectedCard();
                        setButtonState('needkey');
                        busy = false;
                        return;
                    }
                } else {
                    renderNotConnectedCard();
                    setButtonState('needkey');
                    busy = false;
                    return;
                }
            }

            // Build exclude list — current page target + session history
            const exclude = getExclude();
            const currentTarget = (window.location.href.match(/user2ID=(\d+)/i) || [])[1];
            if (currentTarget && !exclude.includes(currentTarget)) {
                exclude.push(currentTarget);
                addExclude(currentTarget);
            }

            const params = new URLSearchParams({
                tier: ffTier,
                exclude: exclude.join(','),
                myId: myId || ''
            });

            const reqHeaders = {};
            if (apiKey) reqHeaders['x-api-key'] = apiKey;
            if (myId) reqHeaders['x-torn-id'] = myId;

            let data;
            try {
                const raw = await gmFetch(`${BACKEND}/api/elim/snipe?${params.toString()}`, {
                    headers: reqHeaders
                });
                data = JSON.parse(raw);
            } catch (netErr) {
                setButtonState('error', 'Server unreachable');
                busy = false;
                return;
            }

            if (data && (
                data.code === 'ACCOUNT_NOT_CONNECTED' ||
                data.error === 'apiKey required' ||
                data.code === 'INVALID_API_KEY' ||
                data.isInvalidKey ||
                data.errorCode === 2 ||
                data.errorCode === 1 ||
                (data.code === 'API_ERROR' && (data.errorCode === 2 || /\[2[:\]]/.test(String(data.message || '')) || String(data.message || '').toLowerCase().includes('incorrect key')))
            )) {
                apiKey = '';
                save(KEY_API, '');
                renderNotConnectedCard(data.message || 'Torn API rejected your key (Error 2: Incorrect Key). Please enter a valid Limited API key.');
                setButtonState('needkey');
                busy = false;
                return;
            }

            if (data && (data.code === 'NOT_IN_ELIMINATION' || data.code === 'USER_ELIMINATED')) {
                try { sessionStorage.removeItem(SESS_EXCL); } catch (e) {}
                renderNotInElimCard(data.message);
                setButtonState('not_in_elim');
                busy = false;
                return;
            }

            if (data && data.success && data.targetId) {
                addExclude(data.targetId);
                setButtonState('idle', null, data.targetCount);

                if (autoLaunch) {
                    launchAttack(data.targetId, data.provenance);
                } else {
                    renderTargetCard(data);
                }
            } else {
                const msg = (data && data.message) ? data.message : 'No targets available';
                setButtonState('error', msg);
            }
        } catch (err) {
            setButtonState('error', 'Unexpected error');
        } finally {
            busy = false;
        }
    }

    function launchAttack(targetId, provenance) {
        // HARD PROVENANCE GUARD: Block attack if target cannot be proven as an active Elimination opponent
        if (!provenance || provenance.source !== 'torn_elimination' || !provenance.isValidOpponent) {
            showToast('🚫 Attack blocked: Target is not a verified Elimination opponent');
            setButtonState('error', 'Unverified target rejected');
            return;
        }
        setButtonState('launching');
        window.location.href = `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`;
    }

    // ── Torn Account Not Connected Card Display ───────────────────
    function renderNotConnectedCard(customMsg = '') {
        if (!cardEl) {
            cardEl = document.createElement('div');
            cardEl.id = 'elim-target-card';
            cardEl.style.cssText = `
                background: #1a1d27;
                border: 2px solid #e74c3c;
                border-radius: 10px;
                padding: 14px;
                width: 310px;
                max-width: calc(100vw - 24px);
                box-sizing: border-box;
                color: #ecf0f1;
                font-size: 12px;
                box-shadow: 0 10px 32px rgba(0,0,0,0.85);
                text-align: left;
                display: none;
                margin-bottom: 4px;
            `;
            if (wrapEl && rowEl) {
                wrapEl.insertBefore(cardEl, rowEl);
            }
        }

        if (drawerEl) {
            drawerEl.style.display = 'none';
            drawerOpen = false;
        }

        cardEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #3d4455; padding-bottom:7px; margin-bottom:10px;">
                <span style="font-weight:900; font-size:13px; color:#e74c3c; display:flex; align-items:center; gap:5px;">
                    🔑 Connect Torn Account
                </span>
                <span id="ev2-card-close" style="cursor:pointer; color:#95a5a6; font-size:13px; font-weight:bold;" title="Close">✖</span>
            </div>
            ${customMsg ? `
                <div style="background:rgba(231,76,60,0.18); border:1px solid #e74c3c; border-radius:6px; padding:8px 10px; margin-bottom:10px; font-size:11px; color:#ff7675; line-height:1.4;">
                    ⚠️ ${customMsg}
                </div>
            ` : `
                <div style="font-size:11.5px; color:#bdc3c7; line-height:1.45; margin-bottom:10px;">
                    To evaluate targets tailored to your battle strength and verify hittability, please connect your Torn Limited API Key.
                </div>
            `}
            <div style="display:flex; gap:6px; margin-bottom:10px; align-items:center;">
                <input type="password" id="ev2-quick-key" placeholder="Paste 16-character Limited Key"
                    style="flex:1; box-sizing:border-box; padding:7px 9px; background:#262b38; border:1px solid #3d4455; color:#fff; border-radius:5px; font-size:11px;">
                <button type="button" id="ev2-quick-eye" style="padding:6px 8px; background:#262b38; border:1px solid #3d4455; color:#bdc3c7; border-radius:5px; cursor:pointer; font-size:12px;" title="Show/Hide Key">👁️</button>
            </div>
            <div style="display:flex; gap:6px; margin-bottom:10px;">
                <button id="ev2-quick-connect" style="flex:2; padding:7px 10px; background:#27ae60; color:#fff; border:none; border-radius:5px; font-weight:900; font-size:11.5px; cursor:pointer;">
                    ⚡ Connect &amp; Snipe
                </button>
                <a href="https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2" target="_blank"
                    style="flex:1; padding:7px 8px; background:#2980b9; color:#fff; text-decoration:none; border-radius:5px; font-weight:700; font-size:11px; text-align:center; display:flex; align-items:center; justify-content:center;">
                    🌐 Get Key
                </a>
            </div>
            <div style="font-size:10px; color:#7f8c8d; text-align:center;">
                🔒 Encrypted with military-grade AES-256-GCM. Never shared.
            </div>
        `;

        cardEl.style.display = 'block';

        const closeBtn = document.getElementById('ev2-card-close');
        if (closeBtn) closeBtn.onclick = () => { cardEl.style.display = 'none'; };

        const quickEye = document.getElementById('ev2-quick-eye');
        const quickInput = document.getElementById('ev2-quick-key');
        if (quickEye && quickInput) {
            quickEye.onclick = () => {
                quickInput.type = quickInput.type === 'password' ? 'text' : 'password';
            };
        }

        const connBtn = document.getElementById('ev2-quick-connect');
        if (connBtn) {
            connBtn.onclick = async () => {
                const rawVal = document.getElementById('ev2-quick-key')?.value || '';
                const input = sanitizeKey(rawVal);
                if (!input || input.length < 16) {
                    showToast('⚠️ Please enter a valid 16-character Torn API key');
                    return;
                }
                connBtn.disabled = true;
                connBtn.textContent = '⏳ Verifying with Torn...';

                let verifiedId = '';
                let verifiedName = '';
                try {
                    const checkRaw = await gmFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(input)}`);
                    const checkData = JSON.parse(checkRaw);
                    if (checkData && checkData.error) {
                        showToast(`❌ Torn API error [${checkData.error.code}]: ${checkData.error.error}`);
                        connBtn.disabled = false;
                        connBtn.textContent = '⚡ Connect & Snipe';
                        return;
                    }
                    if (checkData && checkData.player_id) {
                        verifiedId = String(checkData.player_id);
                        verifiedName = checkData.name || '';
                    }
                } catch (err1) {}

                connBtn.textContent = '⏳ Linking...';
                try {
                    const linkResRaw = await gmFetch(`${BACKEND}/api/user/link-key`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ apiKey: input, tornId: verifiedId || myId })
                    });
                    const linkRes = JSON.parse(linkResRaw);
                    if (linkRes.success) {
                        apiKey = input;
                        save(KEY_API, apiKey);
                        const finalId = verifiedId || (linkRes.playerId ? String(linkRes.playerId) : myId);
                        if (finalId) {
                            myId = finalId;
                            sessionStorage.setItem(SESS_MYID, myId);
                        }
                        showToast(`✅ Linked as ${linkRes.playerName || verifiedName || 'Player'}!`);
                        cardEl.style.display = 'none';
                        executeSnipe();
                    } else {
                        showToast(`⚠️ ${linkRes.error || 'Failed to link key'}`);
                        connBtn.disabled = false;
                        connBtn.textContent = '⚡ Connect & Snipe';
                    }
                } catch (e) {
                    showToast('⚠️ Connection error linking key');
                    connBtn.disabled = false;
                    connBtn.textContent = '⚡ Connect & Snipe';
                }
            };
        }
    }

    // ── Not In Elimination Card Display ──────────────────────────
    function renderNotInElimCard(customMsg) {
        if (!cardEl) {
            cardEl = document.createElement('div');
            cardEl.id = 'elim-target-card';
            cardEl.style.cssText = `
                background: #1a1d27;
                border: 2px solid #57606f;
                border-radius: 10px;
                padding: 14px;
                width: 310px;
                max-width: calc(100vw - 24px);
                box-sizing: border-box;
                color: #ecf0f1;
                font-size: 12px;
                box-shadow: 0 10px 32px rgba(0,0,0,0.85);
                text-align: left;
                display: none;
                margin-bottom: 4px;
            `;
            if (wrapEl && rowEl) {
                wrapEl.insertBefore(cardEl, rowEl);
            }
        }

        if (drawerEl) {
            drawerEl.style.display = 'none';
            drawerOpen = false;
        }

        const info = customMsg || 'No active Elimination competition found for your account. Target finding is disabled until you are enrolled on an active tournament team.';

        cardEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #3d4455; padding-bottom:7px; margin-bottom:10px;">
                <span style="font-weight:900; font-size:13px; color:#e67e22; display:flex; align-items:center; gap:5px;">
                    🛑 Not Enrolled in Elimination
                </span>
                <span id="ev2-card-close" style="cursor:pointer; color:#95a5a6; font-size:13px; font-weight:bold;" title="Close">✖</span>
            </div>
            <div style="font-size:11.5px; color:#bdc3c7; line-height:1.45; margin-bottom:12px;">
                ${info}
            </div>
            <div style="background:#1e2230; border:1px solid #3d4455; border-radius:6px; padding:8px; margin-bottom:12px; font-size:10.5px; color:#95a5a6; line-height:1.4;">
                🔒 <b>Zero Non-Elimination Targets:</b> To protect against attacking faction members or non-event players, target finding is strictly restricted to active tournament participants.
            </div>
            <div style="display:flex; gap:6px;">
                <button id="ev2-comp-link" style="width:100%; padding:7px 10px; background:#2980b9; color:#fff; border:none; border-radius:5px; font-weight:700; font-size:11.5px; cursor:pointer;">
                    🏆 View Competition Page
                </button>
            </div>
        `;

        cardEl.style.display = 'block';

        const closeBtn = document.getElementById('ev2-card-close');
        if (closeBtn) closeBtn.onclick = () => { cardEl.style.display = 'none'; };

        const compBtn = document.getElementById('ev2-comp-link');
        if (compBtn) compBtn.onclick = () => { window.location.href = 'https://www.torn.com/competition.php'; };
    }

    // ── Target Card Display ───────────────────────────────────────
    let cardEl = null;

    function renderTargetCard(data) {
        if (!cardEl) {
            cardEl = document.createElement('div');
            cardEl.id = 'elim-target-card';
            cardEl.style.cssText = `
                background: #1a1d27;
                border: 2px solid #e74c3c;
                border-radius: 10px;
                padding: 12px 14px;
                width: 300px;
                max-width: calc(100vw - 24px);
                box-sizing: border-box;
                color: #ecf0f1;
                font-size: 12px;
                box-shadow: 0 10px 32px rgba(0,0,0,0.85);
                text-align: left;
                display: none;
                margin-bottom: 4px;
            `;
            if (wrapEl && rowEl) {
                wrapEl.insertBefore(cardEl, rowEl);
            }
        }

        // Hide settings if open
        if (drawerEl) {
            drawerEl.style.display = 'none';
            drawerOpen = false;
        }

        const whyList = (Array.isArray(data.why) && data.why.length > 0)
            ? data.why.map(w => `<li style="margin-bottom:3px;">${w}</li>`).join('')
            : '<li>Confirmed available in Torn City</li><li>Optimal battle stats ratio</li>';

        const targetTeam = data.team || (data.provenance && data.provenance.targetTeam) || 'Opponent';

        cardEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #3d4455; padding-bottom:7px; margin-bottom:8px;">
                <span style="font-weight:900; font-size:12.5px; color:#e74c3c; display:flex; align-items:center; gap:5px;">
                    🎯 Best Elimination Target
                </span>
                <span id="ev2-card-close" style="cursor:pointer; color:#95a5a6; font-size:13px; font-weight:bold; padding:0 3px;" title="Close">✖</span>
            </div>
            <div style="margin-bottom:8px; font-size:12px;">
                <span style="color:#7f8c8d; font-size:10px; text-transform:uppercase; letter-spacing:0.5px;">Player:</span><br>
                <a href="https://www.torn.com/profiles.php?XID=${data.targetId}" target="_blank" style="color:#3498db; font-weight:800; text-decoration:none; font-size:14px;">
                    ${data.name} [${data.targetId}]
                </a>
                <span style="color:#bdc3c7; font-size:11px; margin-left:4px;">(Lvl ${data.level})</span>
                <div style="margin-top:2px; font-size:10.5px; color:#e67e22; font-weight:700;">⚔️ Team: ${targetTeam}</div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px; font-size:11px;">
                <div style="background:#262b38; padding:5px 7px; border-radius:4px; border:1px solid #3d4455;">
                    <div style="color:#7f8c8d; font-size:9px; text-transform:uppercase;">Status</div>
                    <div style="color:#2ecc71; font-weight:700;">🟢 ${data.status || 'Available'}</div>
                </div>
                <div style="background:#262b38; padding:5px 7px; border-radius:4px; border:1px solid #3d4455;">
                    <div style="color:#7f8c8d; font-size:9px; text-transform:uppercase;">Travel</div>
                    <div style="color:#f1c40f; font-weight:700;">📍 ${data.travel || 'In Torn City'}</div>
                </div>
                <div style="background:#262b38; padding:5px 7px; border-radius:4px; border:1px solid #3d4455;">
                    <div style="color:#7f8c8d; font-size:9px; text-transform:uppercase;">Battle Strength</div>
                    <div style="color:#ecf0f1; font-weight:700;">~${data.targetBSHuman || 'Unknown'} <span style="font-size:9.5px; color:#95a5a6;">(${data.difficulty || 'Manageable'})</span></div>
                </div>
                <div style="background:#262b38; padding:5px 7px; border-radius:4px; border:1px solid #3d4455;">
                    <div style="color:#7f8c8d; font-size:9px; text-transform:uppercase;">Risk / Score</div>
                    <div><span style="color:#e67e22; font-weight:700;">${data.risk || 'Low'}</span> &bull; <span style="color:#2ecc71; font-weight:900;">${data.score || 90}/100</span></div>
                </div>
            </div>
            <div style="margin-bottom:10px; background:#1e2230; padding:7px 9px; border-radius:6px; border:1px solid #2d3243;">
                <div style="font-weight:700; color:#e74c3c; font-size:10.5px; margin-bottom:3px;">Why this target?</div>
                <ul style="margin:0; padding-left:15px; font-size:10px; color:#bdc3c7; line-height:1.4;">
                    ${whyList}
                </ul>
            </div>
            <div style="display:flex; gap:6px;">
                <button id="ev2-card-attack" style="flex:2; padding:7px 10px; background:#27ae60; color:#fff; border:none; border-radius:5px; font-weight:900; font-size:12px; cursor:pointer; box-shadow:0 3px 10px rgba(39,174,96,0.4); display:flex; align-items:center; justify-content:center; gap:4px;">
                    ⚔️ ATTACK NOW
                </button>
                <button id="ev2-card-next" style="flex:1; padding:7px 8px; background:#34495e; color:#ecf0f1; border:1px solid #4a5568; border-radius:5px; font-weight:700; font-size:11px; cursor:pointer;">
                    ⏭️ Next
                </button>
            </div>
        `;

        cardEl.style.display = 'block';

        const closeBtn = document.getElementById('ev2-card-close');
        if (closeBtn) closeBtn.onclick = () => { cardEl.style.display = 'none'; };

        const attackBtn = document.getElementById('ev2-card-attack');
        if (attackBtn) attackBtn.onclick = () => { launchAttack(data.targetId, data.provenance); };

        const nextBtn = document.getElementById('ev2-card-next');
        if (nextBtn) nextBtn.onclick = () => { executeSnipe(); };
    }

    // ── Button UI ─────────────────────────────────────────────────
    let wrapEl    = null;
    let rowEl     = null;
    let btnEl     = null;
    let errorTimer = null;

    function setButtonState(state, msg, count) {
        if (!btnEl) return;
        clearTimeout(errorTimer);

        const isAttackPage = /user2ID=\d+/i.test(window.location.href);

        switch (state) {
            case 'idle':
                if (count !== undefined && count !== null && count > 0) {
                    btnEl.textContent = isAttackPage ? `⚔️ NEXT TARGET (${count} left)` : `⚔️ SNIPE TARGET (${count} ready)`;
                } else {
                    btnEl.textContent = isAttackPage ? '⚔️ NEXT TARGET' : '⚔️ SNIPE TARGET';
                }
                btnEl.style.background = '#e74c3c';
                btnEl.style.opacity = '1';
                btnEl.disabled = false;
                break;
            case 'not_in_elim':
                btnEl.textContent = '🛑 ELIM: Not Enrolled';
                btnEl.style.background = '#4b5563';
                btnEl.style.opacity = '0.9';
                btnEl.disabled = false;
                break;
            case 'needkey':
                btnEl.textContent = '⚙️ Set API Key';
                btnEl.style.background = '#e67e22';
                btnEl.disabled = false;
                errorTimer = setTimeout(() => setButtonState('idle'), 3000);
                break;
            case 'hunting':
                btnEl.textContent = '⏳ Analyzing Opponents...';
                btnEl.style.background = '#2980b9';
                btnEl.style.opacity = '0.85';
                btnEl.disabled = true;
                break;
            case 'launching':
                btnEl.textContent = '⚡ Launching...';
                btnEl.style.background = '#27ae60';
                btnEl.disabled = true;
                break;
            case 'hosp':
                btnEl.textContent = '⚔️ NEXT TARGET';
                btnEl.style.background = '#e74c3c';
                btnEl.style.opacity = '1';
                btnEl.disabled = false;
                break;
            case 'error':
                btnEl.textContent = msg ? `⚠️ ${msg.substring(0, 32)}` : '⚠️ Error';
                btnEl.style.background = '#c0392b';
                btnEl.disabled = false;
                errorTimer = setTimeout(() => setButtonState('idle'), 4000);
                break;
        }
    }

    // ── Settings drawer ────────────────────────────────────────────
    let drawerEl  = null;
    let drawerOpen = false;

    function openSettings() {
        if (drawerEl) {
            drawerEl.style.display = 'block';
            drawerOpen = true;
            if (cardEl) cardEl.style.display = 'none';
        }
    }

    function buildWidget() {
        if (document.getElementById('elimv2-widget')) return;

        wrapEl = document.createElement('div');
        wrapEl.id = 'elimv2-widget';

        // Retrieve saved custom coordinates or default to comfortably floating ABOVE the bottom chat dock
        const savedLeft = localStorage.getItem('elim_widget_pos_x');
        const savedTop  = localStorage.getItem('elim_widget_pos_y');

        const defBottom = getDefaultBottomOffset();
        const defRight  = isAndroid ? 12 : (isIOS ? 14 : 18);
        let positionStyles = `bottom: ${defBottom}px; right: ${defRight}px;`;

        if (savedLeft !== null && savedTop !== null) {
            const x = parseInt(savedLeft, 10);
            const y = parseInt(savedTop, 10);
            const vpW = window.visualViewport ? window.visualViewport.width : window.innerWidth;
            const vpH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            const bottomForbidden = isAndroid ? 96 : (isIOS ? 70 : 55);

            if (!isNaN(x) && !isNaN(y) && x >= 5 && x <= (vpW - 70) && y >= 5 && y <= (vpH - bottomForbidden - 35)) {
                positionStyles = `left: ${x}px; top: ${y}px; bottom: auto; right: auto;`;
            } else {
                localStorage.removeItem('elim_widget_pos_x');
                localStorage.removeItem('elim_widget_pos_y');
            }
        }

        wrapEl.style.cssText = `
            position: fixed;
            ${positionStyles}
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 6px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            user-select: none;
        `;

        // Settings drawer
        drawerEl = document.createElement('div');
        drawerEl.style.cssText = `
            display: none;
            background: #1a1d27;
            border: 2px solid #e74c3c;
            border-radius: 10px;
            padding: 14px;
            width: 295px;
            max-width: calc(100vw - 24px);
            box-sizing: border-box;
            color: #ecf0f1;
            font-size: 12px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.8);
            margin-bottom: 4px;
        `;

        drawerEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <div style="font-weight:800; color:#e74c3c; font-size:13px;">🎯 Elim Hunter Settings</div>
                <span id="ev2-settings-close" style="cursor:pointer; color:#95a5a6; font-size:13px; font-weight:bold;" title="Close">✖</span>
            </div>
            <label style="display:block; margin-bottom:8px;">
                Torn API Key (connected to FF Scouter):
                <div style="display:flex; gap:6px; margin-top:3px; align-items:center;">
                    <input type="password" id="ev2-key" value="${apiKey.replace(/"/g, '&quot;')}"
                        placeholder="Paste your Torn API key"
                        style="flex:1; box-sizing:border-box; padding:6px 8px;
                        background:#262b38; border:1px solid #3d4455; color:#fff; border-radius:5px; font-size:11px;">
                    <button type="button" id="ev2-key-eye" style="padding:5px 8px; background:#262b38; border:1px solid #3d4455; color:#bdc3c7; border-radius:5px; cursor:pointer; font-size:12px;" title="Show/Hide Key">👁️</button>
                </div>
            </label>
            <label style="display:block; margin-bottom:8px;">
                Fair Fight Tier Limit:
                <select id="ev2-tier" style="width:100%; box-sizing:border-box; margin-top:3px; padding:5px 7px;
                    background:#262b38; border:1px solid #3d4455; color:#fff; border-radius:5px; font-size:11px;">
                    <option value="easy" ${ffTier==='easy'?'selected':''}>🟢 Easy only (&lt;3.0 FF)</option>
                    <option value="manageable" ${ffTier==='manageable'?'selected':''}>🟡 Easy &amp; Manageable (≤3.8 FF)</option>
                    <option value="difficult" ${ffTier==='difficult'?'selected':''}>🟠 Up to Difficult (≤4.5 FF)</option>
                    <option value="all" ${ffTier==='all'?'selected':''}>⚪ All Tiers</option>
                </select>
            </label>
            <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px; cursor:pointer; font-size:11px; color:#bdc3c7;">
                <input type="checkbox" id="ev2-autolaunch" ${autoLaunch ? 'checked' : ''} style="cursor:pointer;">
                <span>⚡ Auto-launch attack page directly</span>
            </label>
            <div style="margin-bottom:8px;">
                <div style="font-size:10px; color:#7f8c8d; text-transform:uppercase; margin-bottom:5px; font-weight:700;">Widget Position Presets:</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px;">
                    <button id="ev2-pos-br" type="button" style="padding:6px 7px; background:#262b38; border:1px solid #3d4455; color:#ecf0f1; border-radius:4px; font-size:10px; font-weight:700; cursor:pointer;">↘️ Bottom Right (Default)</button>
                    <button id="ev2-pos-tr" type="button" style="padding:6px 7px; background:#262b38; border:1px solid #3d4455; color:#ecf0f1; border-radius:4px; font-size:10px; font-weight:700; cursor:pointer;">↗️ Top Right (Clear)</button>
                    <button id="ev2-pos-bl" type="button" style="padding:6px 7px; background:#262b38; border:1px solid #3d4455; color:#ecf0f1; border-radius:4px; font-size:10px; font-weight:700; cursor:pointer;">↙️ Bottom Left</button>
                    <button id="ev2-pos-tl" type="button" style="padding:6px 7px; background:#262b38; border:1px solid #3d4455; color:#ecf0f1; border-radius:4px; font-size:10px; font-weight:700; cursor:pointer;">↖️ Top Left</button>
                </div>
            </div>
            <div style="background:#1e2230; border:1px solid #3d4455; border-radius:5px; padding:8px; margin-bottom:8px; font-size:10px; color:#bdc3c7; line-height:1.4;">
                ✨ <b>Autonomous Targeting:</b> Drag anywhere with ⠿ grip so it never blocks chat. Click — to minimize to a tiny button.
            </div>
            <button id="ev2-save" style="width:100%; padding:7px; background:#27ae60; color:#fff; border:none;
                border-radius:5px; font-weight:800; cursor:pointer; font-size:12px; margin-bottom:6px;">💾 Save</button>
            <button id="ev2-open-comp" style="width:100%; padding:6px; background:#2980b9; color:#fff; border:none;
                border-radius:5px; font-weight:700; cursor:pointer; font-size:11px; margin-bottom:6px;">🏆 Open Competition Page</button>
            <button id="ev2-resetpos" style="width:100%; padding:5px; background:#34495e; color:#ecf0f1; border:1px solid #4a5568;
                border-radius:5px; cursor:pointer; font-size:10px; margin-bottom:4px;">📍 Reset Position to Above Chat</button>
            <button id="ev2-clearsess" style="width:100%; padding:5px; background:#2c3e50; color:#bdc3c7; border:1px solid #3d4455;
                border-radius:5px; cursor:pointer; font-size:10px; margin-bottom:4px;">🗑️ Clear Session Exclusions</button>
            <button id="ev2-clearroster" style="width:100%; padding:5px; background:#2c3e50; color:#bdc3c7; border:1px solid #3d4455;
                border-radius:5px; cursor:pointer; font-size:10px;">🔄 Re-sync Roster (visit competition.php)</button>
            <div style="margin-top:8px; color:#7f8c8d; font-size:10px;">
                v2.4.4 — Autonomous Elimination Target Finder
            </div>
        `;

        // Row: drag grip + snipe button + cog + minimize
        rowEl = document.createElement('div');
        rowEl.id = 'ev2-main-row';
        rowEl.style.cssText = 'display:flex; gap:5px; align-items:center;';

        // Drag handle grip
        const dragHandle = document.createElement('div');
        dragHandle.id = 'ev2-drag-handle';
        dragHandle.textContent = '⠿';
        dragHandle.title = 'Hold & drag anywhere on screen';
        dragHandle.style.cssText = `
            cursor: grab;
            padding: ${isMobile ? '8px 10px' : '6px 4px'};
            min-width: 24px;
            min-height: 24px;
            color: #7f8c8d;
            font-size: 18px;
            user-select: none;
            touch-action: none;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s;
        `;
        dragHandle.onmouseover = () => { dragHandle.style.color = '#fff'; };
        dragHandle.onmouseout  = () => { dragHandle.style.color = '#7f8c8d'; };

        btnEl = document.createElement('button');
        btnEl.id = 'ev2-snipe-btn';
        btnEl.textContent = '⚔️ SNIPE TARGET';
        btnEl.style.cssText = `
            background: #e74c3c;
            color: #fff;
            font-weight: 900;
            font-size: 13px;
            padding: 10px 18px;
            border: none;
            border-radius: 30px;
            cursor: pointer;
            box-shadow: 0 4px 18px rgba(231,76,60,0.55), 0 2px 6px rgba(0,0,0,0.4);
            letter-spacing: 0.4px;
            transition: transform 0.1s, opacity 0.15s;
            white-space: nowrap;
        `;
        btnEl.onmouseover = () => { if (!btnEl.disabled) btnEl.style.transform = 'scale(1.05)'; };
        btnEl.onmouseout  = () => { btnEl.style.transform = 'scale(1)'; };
        btnEl.onclick = executeSnipe;

        const cogBtn = document.createElement('button');
        cogBtn.textContent = '⚙️';
        cogBtn.title = 'Settings';
        cogBtn.style.cssText = `
            background: #1a1d27;
            border: 1px solid #3d4455;
            color: #fff;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 14px;
            box-shadow: 0 3px 10px rgba(0,0,0,0.5);
            flex-shrink: 0;
        `;
        cogBtn.onclick = () => {
            drawerOpen = !drawerOpen;
            drawerEl.style.display = drawerOpen ? 'block' : 'none';
            if (drawerOpen && cardEl) cardEl.style.display = 'none';
        };

        const minBtn = document.createElement('button');
        minBtn.textContent = '—';
        minBtn.title = 'Minimize widget (keeps chats clear)';
        minBtn.style.cssText = `
            background: #1a1d27;
            border: 1px solid #3d4455;
            color: #95a5a6;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            box-shadow: 0 3px 10px rgba(0,0,0,0.4);
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s, color 0.15s;
        `;
        minBtn.onmouseover = () => { minBtn.style.background = '#2c3e50'; minBtn.style.color = '#fff'; };
        minBtn.onmouseout  = () => { minBtn.style.background = '#1a1d27'; minBtn.style.color = '#95a5a6'; };

        const miniEl = document.createElement('div');
        miniEl.id = 'ev2-mini-pill';
        miniEl.textContent = '⚔️';
        miniEl.title = 'Click to expand Torn Elim Hunter';
        miniEl.style.cssText = `
            display: none;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: #e74c3c;
            border: 2px solid #fff;
            color: #fff;
            font-size: 16px;
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(0,0,0,0.6);
            align-items: center;
            justify-content: center;
            transition: transform 0.15s;
        `;
        miniEl.onmouseover = () => { miniEl.style.transform = 'scale(1.1)'; };
        miniEl.onmouseout  = () => { miniEl.style.transform = 'scale(1)'; };

        minBtn.onclick = () => {
            rowEl.style.display = 'none';
            if (drawerEl) drawerEl.style.display = 'none';
            if (cardEl) cardEl.style.display = 'none';
            miniEl.style.display = 'flex';
            localStorage.setItem('elim_widget_minimized', 'true');
        };

        miniEl.onclick = () => {
            miniEl.style.display = 'none';
            rowEl.style.display = 'flex';
            localStorage.setItem('elim_widget_minimized', 'false');
        };

        if (localStorage.getItem('elim_widget_minimized') === 'true') {
            rowEl.style.display = 'none';
            miniEl.style.display = 'flex';
        }

        // ── Drag & Drop implementation ──
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
            const vpH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            const bottomForbiddenZone = isAndroid ? 96 : (isIOS ? 70 : 55);

            if (rect.top <= (vpH - bottomForbiddenZone - 35)) {
                localStorage.setItem('elim_widget_pos_x', Math.round(rect.left));
                localStorage.setItem('elim_widget_pos_y', Math.round(rect.top));
            } else {
                resetWidgetPosition('bottom-right');
            }
        }

        dragHandle.addEventListener('mousedown', startDrag);
        dragHandle.addEventListener('touchstart', startDrag, { passive: false });

        rowEl.appendChild(dragHandle);
        rowEl.appendChild(btnEl);
        rowEl.appendChild(cogBtn);
        rowEl.appendChild(minBtn);
        wrapEl.appendChild(drawerEl);
        wrapEl.appendChild(miniEl);
        wrapEl.appendChild(rowEl);
        document.body.appendChild(wrapEl);

        function resetWidgetPosition(preset = 'bottom-right') {
            localStorage.removeItem('elim_widget_pos_x');
            localStorage.removeItem('elim_widget_pos_y');
            wrapEl.style.left = 'auto';
            wrapEl.style.top = 'auto';
            wrapEl.style.bottom = 'auto';
            wrapEl.style.right = 'auto';

            const dBottom = getDefaultBottomOffset();
            const dRight = isAndroid ? 12 : (isIOS ? 14 : 18);

            if (preset === 'top-right') {
                wrapEl.style.top = isAndroid ? '60px' : '50px';
                wrapEl.style.right = `${dRight}px`;
                showToast('📍 Position: Top Right');
            } else if (preset === 'top-left') {
                wrapEl.style.top = isAndroid ? '60px' : '50px';
                wrapEl.style.left = '12px';
                showToast('📍 Position: Top Left');
            } else if (preset === 'bottom-left') {
                wrapEl.style.bottom = `${dBottom}px`;
                wrapEl.style.left = '12px';
                showToast('📍 Position: Bottom Left');
            } else {
                wrapEl.style.bottom = `${dBottom}px`;
                wrapEl.style.right = `${dRight}px`;
                showToast('📍 Position: Bottom Right (Default)');
            }
        }

        // Settings events
        document.getElementById('ev2-settings-close').onclick = () => {
            drawerEl.style.display = 'none';
            drawerOpen = false;
        };

        const keyEyeBtn = document.getElementById('ev2-key-eye');
        const keyField = document.getElementById('ev2-key');
        if (keyEyeBtn && keyField) {
            keyEyeBtn.onclick = () => {
                keyField.type = keyField.type === 'password' ? 'text' : 'password';
            };
        }

        document.getElementById('ev2-pos-br').onclick = () => resetWidgetPosition('bottom-right');
        document.getElementById('ev2-pos-tr').onclick = () => resetWidgetPosition('top-right');
        document.getElementById('ev2-pos-bl').onclick = () => resetWidgetPosition('bottom-left');
        document.getElementById('ev2-pos-tl').onclick = () => resetWidgetPosition('top-left');
        document.getElementById('ev2-resetpos').onclick = () => resetWidgetPosition('bottom-right');

        document.getElementById('ev2-open-comp').onclick = () => {
            window.location.href = 'https://www.torn.com/competition.php';
        };

        document.getElementById('ev2-save').onclick = async () => {
            const rawVal     = document.getElementById('ev2-key').value;
            const keyInput   = sanitizeKey(rawVal);
            const tierInput  = document.getElementById('ev2-tier').value;
            const launchInput= document.getElementById('ev2-autolaunch').checked;
            const saveBtn    = document.getElementById('ev2-save');

            if (keyInput && keyInput.length < 16) {
                showToast('⚠️ Torn API keys must be at least 16 characters.');
                saveBtn.textContent = '⚠️ Key too short';
                setTimeout(() => { saveBtn.textContent = '💾 Save'; }, 2000);
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = '⏳ Verifying with Torn...';

            let verifiedName = '';
            let verifiedId = '';

            if (keyInput) {
                try {
                    const checkRaw = await gmFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(keyInput)}`);
                    const checkData = JSON.parse(checkRaw);
                    if (checkData && checkData.error) {
                        const errCode = checkData.error.code;
                        const errMsg = checkData.error.error || 'Unknown error';
                        showToast(`❌ Torn API rejected key [${errCode}: ${errMsg}]`);
                        saveBtn.textContent = `❌ Invalid Key [${errCode}]`;
                        saveBtn.disabled = false;
                        setTimeout(() => { saveBtn.textContent = '💾 Save'; }, 2500);
                        return;
                    }
                    if (checkData && checkData.player_id) {
                        verifiedId = String(checkData.player_id);
                        verifiedName = checkData.name || '';
                    }
                } catch (netErr) {
                    try {
                        const linkResRaw = await gmFetch(`${BACKEND}/api/user/link-key`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ apiKey: keyInput, tornId: myId })
                        });
                        const linkRes = JSON.parse(linkResRaw);
                        if (!linkRes.success) {
                            showToast(`❌ ${linkRes.error || 'Invalid API Key'}`);
                            saveBtn.textContent = '❌ Invalid Key';
                            saveBtn.disabled = false;
                            setTimeout(() => { saveBtn.textContent = '💾 Save'; }, 2500);
                            return;
                        }
                        if (linkRes.playerId) verifiedId = String(linkRes.playerId);
                        if (linkRes.playerName) verifiedName = linkRes.playerName;
                    } catch (e2) {}
                }
            }

            apiKey = keyInput;
            ffTier = tierInput;
            autoLaunch = launchInput;
            save(KEY_API, apiKey);
            save(KEY_TIER, ffTier);
            save(KEY_AUTOLAUNCH, autoLaunch);

            if (verifiedId) {
                myId = verifiedId;
                sessionStorage.setItem(SESS_MYID, myId);
            } else if (!apiKey) {
                myId = '';
                sessionStorage.removeItem(SESS_MYID);
            }

            if (apiKey && apiKey.length >= 16) {
                try {
                    await gmFetch(`${BACKEND}/api/user/link-key`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ apiKey, tornId: myId })
                    });
                } catch (e) {}
            }

            saveBtn.textContent = verifiedName ? `✅ Saved as ${verifiedName}!` : '✅ Saved!';
            saveBtn.disabled = false;
            setButtonState('idle');

            setTimeout(() => {
                saveBtn.textContent = '💾 Save';
                drawerEl.style.display = 'none';
                drawerOpen = false;
            }, 1200);
        };

        document.getElementById('ev2-clearsess').onclick = () => {
            try { sessionStorage.removeItem(SESS_EXCL); } catch (e) {}
            const btn = document.getElementById('ev2-clearsess');
            btn.textContent = '✅ Cleared!';
            setTimeout(() => { btn.textContent = '🗑️ Clear Session Exclusions'; }, 1500);
        };

        document.getElementById('ev2-clearroster').onclick = () => {
            syncedTeams.clear();
            rosterSyncInFlight = false;
            const btn = document.getElementById('ev2-clearroster');
            btn.textContent = '✅ Cleared — click any team tab';
            setTimeout(() => { btn.textContent = '🔄 Re-sync Rosters (visit competition.php)'; }, 2000);
            syncRosterIfOnCompetitionPage();
        };

        setButtonState('idle');
    }

    // ── MutationObserver for SPA navigation ───────────────────────
    let navTimer = null;
    let lastUrl  = window.location.href;

    function onPageChange() {
        clearTimeout(navTimer);
        navTimer = setTimeout(() => {
            const newUrl = window.location.href;
            if (newUrl !== lastUrl) {
                lastUrl = newUrl;
                hospCheckDone = false;
            }
            setButtonState('idle');
            syncRosterIfOnCompetitionPage();
            checkAttackScreenForHosp();
        }, 800);
    }

    // ── Init ───────────────────────────────────────────────────────
    function init() {
        buildWidget();
        syncRosterIfOnCompetitionPage();
        checkAttackScreenForHosp();

        const obs = new MutationObserver(onPageChange);
        obs.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 600);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(init, 600));
    }
})();
