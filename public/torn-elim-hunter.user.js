// ==UserScript==
// @name         Torn Elimination Target Hunter
// @namespace    https://spider-verse.net/
// @version      2.4.0
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
// @run-at       document-idle
// @updateURL    https://spider-verse.net/torn-elim-hunter.meta.js
// @downloadURL  https://spider-verse.net/torn-elim-hunter.user.js
// ==/UserScript==

(function () {
    'use strict';

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
    let apiKey     = load(KEY_API, '');
    let ffTier     = load(KEY_TIER, 'manageable');
    let autoLaunch = load(KEY_AUTOLAUNCH, false);
    let myId       = '';
    let busy       = false;

    // ── Get My Torn ID directly from page DOM/cookies ───────────────
    function getMyTornIdFromPage() {
        try {
            const m = document.cookie.match(/(?:^|;\s*)uid=(\d+)/);
            if (m && m[1]) return m[1];
        } catch (e) {}
        try {
            const el = document.querySelector('a[href*="profiles.php?XID="], a[href*="profiles.php?xid="]');
            if (el) {
                const m = el.href.match(/xid=(\d+)/i);
                if (m && m[1]) return m[1];
            }
        } catch (e) {}
        try {
            if (window.userID) return String(window.userID);
            if (window.user && window.user.id) return String(window.user.id);
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
    let rosterSyncDone = false;

    function syncRosterIfOnCompetitionPage() {
        if (!window.location.href.includes('competition.php')) return;
        if (!apiKey) return;
        if (rosterSyncDone) return;

        // Verify that this is the Elimination competition view
        const pageText = (document.body ? document.body.innerText || '' : '').toLowerCase();
        if (!pageText.includes('elimination')) return;

        // Try to identify the active opposing team name from tab or header
        let teamName = '';
        const activeTabEl = document.querySelector('.active-tab, .ui-tabs-active, .tab-active, [class*="teamTitle"], [class*="teamName"], .team-info h4, .team-name');
        if (activeTabEl) {
            teamName = (activeTabEl.innerText || activeTabEl.textContent || '').trim();
        }
        if (!teamName) {
            const h4s = Array.from(document.querySelectorAll('h4, h3, h2, .title'));
            for (const h of h4s) {
                const t = (h.innerText || '').trim();
                if (t && !t.toLowerCase().includes('competition') && !t.toLowerCase().includes('elimination') && t.length < 35) {
                    teamName = t;
                    break;
                }
            }
        }

        // If team name could not be identified, do not sync arbitrary members
        if (!teamName) return;

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

            rosterSyncDone = true;

            gmFetch(`${BACKEND}/api/elim/sync-roster`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
                body: JSON.stringify({ apiKey, members, teamName, myId: selfId })
            }).then(raw => {
                try {
                    const d = JSON.parse(raw);
                    if (d && d.success && d.memberCount !== undefined) {
                        showToast(`✅ Synced ${d.memberCount} competitors from team "${teamName}"`);
                    } else if (d && d.code === 'NOT_IN_ELIMINATION') {
                        // User not enrolled in Elimination
                        setButtonState('not_in_elim');
                    }
                } catch (e) {}
            }).catch(() => {});
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

            if (data && (data.code === 'ACCOUNT_NOT_CONNECTED' || data.error === 'apiKey required')) {
                renderNotConnectedCard();
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
    function renderNotConnectedCard() {
        if (!cardEl) {
            cardEl = document.createElement('div');
            cardEl.id = 'elim-target-card';
            cardEl.style.cssText = `
                background: #1a1d27;
                border: 2px solid #e74c3c;
                border-radius: 10px;
                padding: 14px;
                width: 310px;
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
            <div style="font-size:11.5px; color:#bdc3c7; line-height:1.45; margin-bottom:10px;">
                To evaluate targets tailored to your battle strength and verify hittability, please connect your Torn Limited API Key.
            </div>
            <div style="margin-bottom:10px;">
                <input type="password" id="ev2-quick-key" placeholder="Paste 16-character Limited Key"
                    style="width:100%; box-sizing:border-box; padding:7px 9px; background:#262b38; border:1px solid #3d4455; color:#fff; border-radius:5px; font-size:11px;">
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

        const connBtn = document.getElementById('ev2-quick-connect');
        if (connBtn) {
            connBtn.onclick = async () => {
                const input = (document.getElementById('ev2-quick-key')?.value || '').trim();
                if (!input || input.length < 16) {
                    showToast('⚠️ Please enter a valid 16-character Torn API key');
                    return;
                }
                connBtn.disabled = true;
                connBtn.textContent = '⏳ Linking...';
                try {
                    const linkResRaw = await gmFetch(`${BACKEND}/api/user/link-key`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ apiKey: input, tornId: myId })
                    });
                    const linkRes = JSON.parse(linkResRaw);
                    if (linkRes.success) {
                        apiKey = input;
                        save(KEY_API, apiKey);
                        if (linkRes.playerId) {
                            myId = String(linkRes.playerId);
                            sessionStorage.setItem(SESS_MYID, myId);
                        }
                        showToast(`✅ Linked as ${linkRes.playerName || 'Player'}!`);
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
        wrapEl.style.cssText = `
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 6px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        `;

        // Settings drawer
        drawerEl = document.createElement('div');
        drawerEl.style.cssText = `
            display: none;
            background: #1a1d27;
            border: 2px solid #e74c3c;
            border-radius: 10px;
            padding: 14px;
            width: 290px;
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
                <input type="password" id="ev2-key" value="${apiKey.replace(/"/g, '&quot;')}"
                    placeholder="Paste your Torn API key"
                    style="width:100%; box-sizing:border-box; margin-top:3px; padding:5px 7px;
                    background:#262b38; border:1px solid #3d4455; color:#fff; border-radius:5px; font-size:11px;">
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
            <div style="background:#1e2230; border:1px solid #3d4455; border-radius:5px; padding:8px; margin-bottom:8px; font-size:10px; color:#bdc3c7; line-height:1.4;">
                ✨ <b>Autonomous Targeting:</b> Finds and ranks viable targets from any Torn page. Visiting competition.php adds fresh competitors to the shared pool.
            </div>
            <button id="ev2-save" style="width:100%; padding:7px; background:#27ae60; color:#fff; border:none;
                border-radius:5px; font-weight:800; cursor:pointer; font-size:12px; margin-bottom:6px;">💾 Save</button>
            <button id="ev2-open-comp" style="width:100%; padding:6px; background:#2980b9; color:#fff; border:none;
                border-radius:5px; font-weight:700; cursor:pointer; font-size:11px; margin-bottom:6px;">🏆 Open Competition Page</button>
            <button id="ev2-clearsess" style="width:100%; padding:5px; background:#2c3e50; color:#bdc3c7; border:1px solid #3d4455;
                border-radius:5px; cursor:pointer; font-size:10px; margin-bottom:4px;">🗑️ Clear Session Exclusions</button>
            <button id="ev2-clearroster" style="width:100%; padding:5px; background:#2c3e50; color:#bdc3c7; border:1px solid #3d4455;
                border-radius:5px; cursor:pointer; font-size:10px;">🔄 Re-sync Roster (visit competition.php)</button>
            <div style="margin-top:8px; color:#7f8c8d; font-size:10px;">
                v2.3.0 — Autonomous Elimination Target Finder
            </div>
        `;

        // Row: snipe button + cog
        rowEl = document.createElement('div');
        rowEl.style.cssText = 'display:flex; gap:6px; align-items:center;';

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

        rowEl.appendChild(btnEl);
        rowEl.appendChild(cogBtn);
        wrapEl.appendChild(drawerEl);
        wrapEl.appendChild(rowEl);
        document.body.appendChild(wrapEl);

        // Settings events
        document.getElementById('ev2-settings-close').onclick = () => {
            drawerEl.style.display = 'none';
            drawerOpen = false;
        };

        document.getElementById('ev2-open-comp').onclick = () => {
            window.location.href = 'https://www.torn.com/competition.php';
        };

        document.getElementById('ev2-save').onclick = async () => {
            const keyInput   = document.getElementById('ev2-key').value.trim();
            const tierInput  = document.getElementById('ev2-tier').value;
            const launchInput= document.getElementById('ev2-autolaunch').checked;

            apiKey = keyInput;
            ffTier = tierInput;
            autoLaunch = launchInput;
            save(KEY_API, apiKey);
            save(KEY_TIER, ffTier);
            save(KEY_AUTOLAUNCH, autoLaunch);

            myId = '';
            sessionStorage.removeItem(SESS_MYID);

            const saveBtn = document.getElementById('ev2-save');
            saveBtn.textContent = '⏳ Verifying...';
            await resolveMyId();

            if (apiKey && apiKey.length >= 16) {
                // Sync key securely to backend AES-256 vault
                gmFetch(`${BACKEND}/api/user/link-key`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey, tornId: myId })
                }).catch(() => {});
            }

            saveBtn.textContent = myId ? '✅ Saved!' : (apiKey ? '⚠️ Check Key' : '✅ Settings Saved');
            setTimeout(() => {
                saveBtn.textContent = '💾 Save';
                drawerEl.style.display = 'none';
                drawerOpen = false;
            }, 1500);
        };

        document.getElementById('ev2-clearsess').onclick = () => {
            try { sessionStorage.removeItem(SESS_EXCL); } catch (e) {}
            const btn = document.getElementById('ev2-clearsess');
            btn.textContent = '✅ Cleared!';
            setTimeout(() => { btn.textContent = '🗑️ Clear Session Exclusions'; }, 1500);
        };

        document.getElementById('ev2-clearroster').onclick = () => {
            rosterSyncDone = false;
            const btn = document.getElementById('ev2-clearroster');
            btn.textContent = '✅ Ready — visit competition.php';
            setTimeout(() => { btn.textContent = '🔄 Re-sync Roster (visit competition.php)'; }, 2000);
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
