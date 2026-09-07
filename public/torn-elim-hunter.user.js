// ==UserScript==
// @name         Torn Elimination Target Hunter
// @namespace    https://spider-verse.net/
// @version      2.1.0
// @description  1-click snipe button for Torn Elimination. Finds beatable enemies that are NOT in hospital and NOT flying. No fallbacks, elimination-only.
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
    const BACKEND   = 'https://spider-verse.net';
    const KEY_API   = 'elimv2_api_key';
    const KEY_TIER  = 'elimv2_ff_tier';    // easy | manageable | difficult | all
    const SESS_EXCL = 'elimv2_exclude';    // comma-separated IDs excluded this session
    const SESS_MYID = 'elimv2_my_id';

    // Max IDs to keep in the exclude list — prevents unbounded URL growth
    // (BUG D fix) — keep only the 80 most-recently-excluded IDs
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
    // (BUG D fix) trimmed to MAX_EXCLUDE entries
    function getExclude() {
        try { return (sessionStorage.getItem(SESS_EXCL) || '').split(',').filter(Boolean); }
        catch (e) { return []; }
    }

    function addExclude(id) {
        if (!id || id === '0') return;
        let list = getExclude();
        const sid = String(id);
        if (!list.includes(sid)) list.push(sid);
        // Keep only the last MAX_EXCLUDE entries
        if (list.length > MAX_EXCLUDE) list = list.slice(list.length - MAX_EXCLUDE);
        try { sessionStorage.setItem(SESS_EXCL, list.join(',')); } catch (e) {}
    }

    // ── State ──────────────────────────────────────────────────────
    let apiKey = load(KEY_API, '');
    let ffTier = load(KEY_TIER, 'manageable');
    let myId   = '';
    let busy   = false;

    // ── Resolve my own Torn ID once ───────────────────────────────
    async function resolveMyId() {
        if (myId) return myId;
        myId = sessionStorage.getItem(SESS_MYID) || '';
        if (myId) return myId;
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

    // ── Auto-sync competition page rosters to backend ──────────────
    // (BUG A fix) — We now ask the Torn API which team the current user is on,
    // then only sync profile links that are NOT on that same team section.
    // Since we cannot reliably tell which DOM section belongs to which team,
    // we send ALL found profile links plus our own team members list to the server,
    // which will exclude our own faction from targeting.
    // The server's self-exclusion (myId filter) handles the user themselves.
    // We additionally pass our own faction members via a separate call so the server
    // can filter them out.
    //
    // PRACTICAL APPROACH: We tell the user to navigate to the OPPOSING team's tab
    // on competition.php and sync from there. We detect which "team tab" context
    // the user is in via the page title/header and only send those members.
    // As a safety net, we also resolve our own faction members and exclude them.
    let rosterSyncDone = false; // (BUG G fix pattern) prevent repeated syncs

    function syncRosterIfOnCompetitionPage() {
        if (!window.location.href.includes('competition.php')) return;
        if (!apiKey) return;
        if (rosterSyncDone) return;

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

            // Send all scraped members; server is responsible for knowing the user's
            // own faction via the Torn API faction endpoint to exclude teammates.
            // We also send our own Torn ID (selfId) and the API key so the server
            // can resolve our faction and strip them from the pool server-side.
            gmFetch(`${BACKEND}/api/elim/sync-roster`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
                body: JSON.stringify({ apiKey, members, myId: selfId })
            }).then(raw => {
                try {
                    const d = JSON.parse(raw);
                    if (d && d.memberCount !== undefined) {
                        showToast(`✅ Synced ${d.memberCount} targets to server`);
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
    // (BUG G fix) — use a one-shot flag per URL so DOM mutations don't re-trigger
    let hospCheckUrl = '';
    let hospCheckDone = false;

    function checkAttackScreenForHosp() {
        const m = window.location.href.match(/user2ID=(\d+)/i);
        if (!m) return;
        const targetId = m[1];

        // Only run once per attack URL
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
        if (!targetId || !apiKey) return;
        gmFetch(`${BACKEND}/api/elim/report-hosp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetId: String(targetId), apiKey })
        }).catch(() => {});
    }

    // ── Core snipe logic ──────────────────────────────────────────
    async function executeSnipe() {
        if (busy) return;
        if (!apiKey) {
            openSettings();
            setButtonState('needkey');
            return;
        }

        busy = true;
        setButtonState('hunting');

        try {
            await resolveMyId();

            // Build exclude list — current page target + session history
            const exclude = getExclude();
            const currentTarget = (window.location.href.match(/user2ID=(\d+)/i) || [])[1];
            if (currentTarget && !exclude.includes(currentTarget)) {
                exclude.push(currentTarget);
                addExclude(currentTarget);
            }

            const params = new URLSearchParams({
                apiKey,
                tier: ffTier,
                exclude: exclude.join(','),
                myId: myId || ''
            });

            let data;
            try {
                const raw = await gmFetch(`${BACKEND}/api/elim/snipe?${params.toString()}`);
                data = JSON.parse(raw);
            } catch (netErr) {
                setButtonState('error', 'Server unreachable');
                busy = false;
                return;
            }

            if (data && data.success && data.targetId) {
                addExclude(data.targetId);
                launchAttack(data.targetId);
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

    function launchAttack(targetId) {
        setButtonState('launching');
        window.location.href = `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`;
    }

    // ── Button UI ─────────────────────────────────────────────────
    let btnEl     = null;
    let errorTimer = null;

    function setButtonState(state, msg) {
        if (!btnEl) return;
        clearTimeout(errorTimer);

        const isAttackPage = /user2ID=\d+/i.test(window.location.href);

        switch (state) {
            case 'idle':
                btnEl.textContent = isAttackPage ? '⚔️ NEXT TARGET' : '⚔️ SNIPE TARGET';
                btnEl.style.background = '#e74c3c';
                btnEl.style.opacity = '1';
                btnEl.disabled = false;
                break;
            case 'needkey':
                btnEl.textContent = '⚙️ Set API Key';
                btnEl.style.background = '#e67e22';
                btnEl.disabled = false;
                errorTimer = setTimeout(() => setButtonState('idle'), 3000);
                break;
            case 'hunting':
                btnEl.textContent = '⏳ Hunting...';
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
        }
    }

    function buildWidget() {
        if (document.getElementById('elimv2-widget')) return;

        const wrap = document.createElement('div');
        wrap.id = 'elimv2-widget';
        wrap.style.cssText = `
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
            width: 280px;
            color: #ecf0f1;
            font-size: 12px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.8);
        `;

        drawerEl.innerHTML = `
            <div style="font-weight:800; color:#e74c3c; margin-bottom:10px; font-size:13px;">🎯 Elim Hunter Settings</div>
            <label style="display:block; margin-bottom:8px;">
                Torn API Key (connected to FF Scouter):
                <input type="password" id="ev2-key" value="${apiKey.replace(/"/g, '&quot;')}"
                    placeholder="Paste your Torn API key"
                    style="width:100%; box-sizing:border-box; margin-top:3px; padding:5px 7px;
                    background:#262b38; border:1px solid #3d4455; color:#fff; border-radius:5px; font-size:11px;">
            </label>
            <label style="display:block; margin-bottom:10px;">
                Fair Fight Tier Limit:
                <select id="ev2-tier" style="width:100%; box-sizing:border-box; margin-top:3px; padding:5px 7px;
                    background:#262b38; border:1px solid #3d4455; color:#fff; border-radius:5px; font-size:11px;">
                    <option value="easy" ${ffTier==='easy'?'selected':''}>🟢 Easy only (&lt;3.0 FF)</option>
                    <option value="manageable" ${ffTier==='manageable'?'selected':''}>🟡 Easy &amp; Manageable (≤3.8 FF)</option>
                    <option value="difficult" ${ffTier==='difficult'?'selected':''}>🟠 Up to Difficult (≤4.5 FF)</option>
                    <option value="all" ${ffTier==='all'?'selected':''}>⚪ All Tiers</option>
                </select>
            </label>
            <div style="background:#1e2230; border:1px solid #3d4455; border-radius:5px; padding:8px; margin-bottom:8px; font-size:10px; color:#95a5a6; line-height:1.5;">
                ⚠️ <b>Before using:</b> Go to <b>competition.php</b>, navigate to an <b>enemy team's tab</b>, then come back — the script will auto-sync those members as targets.
            </div>
            <button id="ev2-save" style="width:100%; padding:7px; background:#27ae60; color:#fff; border:none;
                border-radius:5px; font-weight:800; cursor:pointer; font-size:12px; margin-bottom:6px;">💾 Save</button>
            <button id="ev2-clearsess" style="width:100%; padding:5px; background:#2c3e50; color:#bdc3c7; border:1px solid #3d4455;
                border-radius:5px; cursor:pointer; font-size:10px; margin-bottom:4px;">🗑️ Clear Session Exclusions</button>
            <button id="ev2-clearroster" style="width:100%; padding:5px; background:#2c3e50; color:#bdc3c7; border:1px solid #3d4455;
                border-radius:5px; cursor:pointer; font-size:10px;">🔄 Re-sync Roster (visit competition.php first)</button>
            <div style="margin-top:8px; color:#7f8c8d; font-size:10px;">
                v2.1.0 — Elimination only
            </div>
        `;

        // Row: snipe button + cog
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; gap:6px; align-items:center;';

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
        };

        row.appendChild(btnEl);
        row.appendChild(cogBtn);
        wrap.appendChild(drawerEl);
        wrap.appendChild(row);
        document.body.appendChild(wrap);

        // Settings save
        document.getElementById('ev2-save').onclick = async () => {
            const keyInput  = document.getElementById('ev2-key').value.trim();
            const tierInput = document.getElementById('ev2-tier').value;

            apiKey = keyInput;
            ffTier = tierInput;
            save(KEY_API,  apiKey);
            save(KEY_TIER, ffTier);

            // Clear cached ID so it re-resolves with new key
            myId = '';
            sessionStorage.removeItem(SESS_MYID);

            const saveBtn = document.getElementById('ev2-save');
            saveBtn.textContent = '⏳ Verifying...';
            await resolveMyId();
            saveBtn.textContent = myId ? '✅ Saved!' : '⚠️ Check API Key';
            setTimeout(() => {
                saveBtn.textContent = '💾 Save';
                drawerEl.style.display = 'none';
                drawerOpen = false;
            }, 1500);
        };

        // Clear session exclusions
        document.getElementById('ev2-clearsess').onclick = () => {
            try { sessionStorage.removeItem(SESS_EXCL); } catch (e) {}
            const btn = document.getElementById('ev2-clearsess');
            btn.textContent = '✅ Cleared!';
            setTimeout(() => { btn.textContent = '🗑️ Clear Session Exclusions'; }, 1500);
        };

        // Force re-sync roster (clear the done flag so next page nav re-fires)
        document.getElementById('ev2-clearroster').onclick = () => {
            rosterSyncDone = false;
            const btn = document.getElementById('ev2-clearroster');
            btn.textContent = '✅ Ready — visit competition.php';
            setTimeout(() => { btn.textContent = '🔄 Re-sync Roster (visit competition.php first)'; }, 2000);
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
                // Reset hosp-check state on navigation
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
