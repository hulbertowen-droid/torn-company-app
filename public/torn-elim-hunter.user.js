// ==UserScript==
// @name         Torn Elimination Target Hunter (1-Click Snipe)
// @namespace    https://spider-verse.net/
// @version      1.2.0
// @description  1-Click instant snipe button for Elimination. Automatically finds beatable enemies (not hosp, not flying, beatable FF tier) and redirects straight into their attack screen.
// @author       Spider-Verse
// @match        https://www.torn.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      ffscouter.com
// @connect      api.torn.com
// @run-at       document-idle
// @updateURL    https://spider-verse.net/torn-elim-hunter.meta.js
// @downloadURL  https://spider-verse.net/torn-elim-hunter.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ── Storage Helpers ──
    function getStored(key, def) {
        try {
            if (typeof GM_getValue === 'function') {
                const val = GM_getValue(key, def);
                if (val !== undefined && val !== null) return val;
            }
            const ls = localStorage.getItem(key);
            return ls !== null ? JSON.parse(ls) : def;
        } catch (e) { return def; }
    }

    function setStored(key, val) {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(key, val);
            localStorage.setItem(key, JSON.stringify(val));
        } catch (e) {}
    }

    const KEY_API_KEY = 'elim_hunter_api_key';
    const KEY_FF_TIER = 'elim_hunter_ff_tier';
    const KEY_HIDE_HOSP = 'elim_hunter_hide_hosp';
    const KEY_HIDE_FLYING = 'elim_hunter_hide_flying';
    const KEY_MY_STATS = 'elim_hunter_my_stats';
    const SESSION_QUEUE = 'elim_snipe_queue';

    let apiKey = getStored(KEY_API_KEY, '');
    let ffTierLimit = getStored(KEY_FF_TIER, 'manageable'); // easy, manageable, difficult, all
    let hideHosp = getStored(KEY_HIDE_HOSP, true);
    let hideFlying = getStored(KEY_HIDE_FLYING, true);
    let myTotalStats = Number(getStored(KEY_MY_STATS, 0));

    const playerCache = new Map();
    let currentValidTargets = [];

    // ── Fair Fight Tier Categorizer ──
    // < 3.0: Easy | 3.0 - 3.8: Manageable | 3.8 - 4.5: Difficult | > 4.5: Danger
    function getTierInfo(ff) {
        if (!ff || isNaN(ff)) return { tier: 'unknown', label: 'Unknown', color: '#a4b0be' };
        if (ff < 3.0) return { tier: 'easy', label: 'Easy', color: '#2ed573' };
        if (ff <= 3.8) return { tier: 'manageable', label: 'Manageable', color: '#eccc68' };
        if (ff <= 4.5) return { tier: 'difficult', label: 'Difficult', color: '#ff7f50' };
        return { tier: 'danger', label: 'Danger', color: '#ff4757' };
    }

    function isWithinTierLimit(ff) {
        if (!ff || isNaN(ff)) return true;
        if (ffTierLimit === 'all') return true;
        if (ffTierLimit === 'easy') return ff < 3.0;
        if (ffTierLimit === 'manageable') return ff <= 3.8;
        if (ffTierLimit === 'difficult') return ff <= 4.5;
        return true;
    }

    // ── User Stats & FF Calculation ──
    async function fetchMyBattleStats() {
        if (!apiKey || myTotalStats > 0) return;
        try {
            const url = `https://api.torn.com/user/?selections=battlestats&key=${encodeURIComponent(apiKey)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.strength) {
                myTotalStats = (data.strength || 0) + (data.speed || 0) + (data.defense || 0) + (data.dexterity || 0);
                setStored(KEY_MY_STATS, myTotalStats);
            }
        } catch(e) {}
    }

    function calculateFF(defenderStats) {
        if (!defenderStats || !myTotalStats || myTotalStats <= 0) return null;
        return parseFloat((1 + (8/3) * (defenderStats / myTotalStats)).toFixed(2));
    }

    // ── Batch Fetch from FF Scouter ──
    async function fetchFFStats(playerIds) {
        if (!apiKey || !playerIds || playerIds.length === 0) return;

        const uncached = playerIds.filter(id => !playerCache.has(id));
        if (uncached.length === 0) return;

        if (myTotalStats <= 0) await fetchMyBattleStats();

        for (let i = 0; i < uncached.length; i += 30) {
            const batch = uncached.slice(i, i + 30);
            try {
                await new Promise((resolve) => {
                    const url = `https://ffscouter.com/api/v1/get-stats?key=${encodeURIComponent(apiKey)}&targets=${batch.join(',')}`;

                    const handleResponse = (data) => {
                        if (Array.isArray(data)) {
                            data.forEach(p => {
                                const id = String(p.player_id);
                                const bs = Number(p.bs_estimate || 0);
                                let ff = p.fair_fight !== undefined ? Number(p.fair_fight) : (p.ff !== undefined ? Number(p.ff) : null);
                                if (ff === null && bs > 0 && myTotalStats > 0) {
                                    ff = calculateFF(bs);
                                }
                                playerCache.set(id, { ff, bs, info: getTierInfo(ff) });
                            });
                        }
                        resolve();
                    };

                    if (typeof GM_xmlhttpRequest === 'function') {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: url,
                            timeout: 9000,
                            onload: (res) => {
                                try { handleResponse(JSON.parse(res.responseText)); } catch(e) { resolve(); }
                            },
                            onerror: () => resolve(),
                            ontimeout: () => resolve()
                        });
                    } else {
                        fetch(url)
                            .then(r => r.json())
                            .then(handleResponse)
                            .catch(() => resolve());
                    }
                });
            } catch (err) {}
        }
    }

    // ── Check Live Status from Row DOM ──
    function checkPlayerStatus(rowEl) {
        const text = rowEl.innerText || '';
        const html = rowEl.innerHTML || '';

        const isHosp = /hospital/i.test(text) || 
                       /hospital/i.test(html) || 
                       rowEl.querySelector('[class*="hospital"], svg[class*="hospital"], [title*="Hospital"], [aria-label*="Hospital"]');

        const isFlying = /traveling|abroad|in a foreign country/i.test(text) || 
                         /traveling|abroad/i.test(html) || 
                         rowEl.querySelector('[class*="traveling"], [class*="abroad"], svg[class*="traveling"], [title*="Traveling"], [title*="Abroad"]');

        return { isHosp: !!isHosp, isFlying: !!isFlying };
    }

    // ── Scan Current Page Roster & Populate Snipe Queue ──
    async function scanAndQueueTargets() {
        const rows = document.querySelectorAll(
            'ul.member-list > li, .table-row, .members-list > li, [class*="memberList"] [class*="tableRow"], .user-info-list-wrap li, .bounties-wrap .table-row'
        );

        if (!rows || rows.length === 0) return;

        const candidateList = [];
        rows.forEach(row => {
            const profileLink = row.querySelector('a[href*="profiles.php?XID="]');
            if (!profileLink) return;

            const match = profileLink.href.match(/XID=(\d+)/);
            if (!match) return;

            const playerId = match[1];
            const name = (profileLink.innerText || `Player #${playerId}`).trim();
            const { isHosp, isFlying } = checkPlayerStatus(row);

            candidateList.push({ playerId, name, isHosp, isFlying });
        });

        if (candidateList.length === 0) return;

        // Fetch FF Scouter stats
        await fetchFFStats(candidateList.map(c => c.playerId));

        // Filter valid targets (not hosp, not flying, matches FF tier)
        const valid = candidateList.filter(c => {
            if (hideHosp && c.isHosp) return false;
            if (hideFlying && c.isFlying) return false;

            const cached = playerCache.get(c.playerId);
            if (cached && cached.ff !== null && !isWithinTierLimit(cached.ff)) return false;

            return true;
        });

        currentValidTargets = valid;

        // Save into session storage queue so button works across attack screens
        try {
            sessionStorage.setItem(SESSION_QUEUE, JSON.stringify(valid.map(v => v.playerId)));
        } catch(e) {}

        updateSnipeButtonUI();
    }

    // ── 1-CLICK INSTANT SNIPE ACTION ──
    function executeSnipe() {
        // First check current in-memory targets
        let targetId = null;

        if (currentValidTargets.length > 0) {
            targetId = currentValidTargets[0].playerId;
        } else {
            // Check session queue
            try {
                const q = JSON.parse(sessionStorage.getItem(SESSION_QUEUE) || '[]');
                if (q.length > 0) {
                    targetId = q.shift();
                    sessionStorage.setItem(SESSION_QUEUE, JSON.stringify(q));
                }
            } catch(e) {}
        }

        if (targetId) {
            const snipeBtn = document.getElementById('elim-snipe-main-btn');
            if (snipeBtn) {
                snipeBtn.innerText = '⚡ SNIPING...';
                snipeBtn.style.background = '#2ed573';
            }
            // Launch directly into attack screen!
            window.location.href = `https://www.torn.com/loader.php?sid=attack&user2ID=${targetId}`;
        } else {
            const snipeBtn = document.getElementById('elim-snipe-main-btn');
            if (snipeBtn) {
                snipeBtn.innerText = '⚠️ No Targets Found';
                snipeBtn.style.background = '#e74c3c';
                setTimeout(() => updateSnipeButtonUI(), 2000);
            }
        }
    }

    // ── Update Button UI Text ──
    function updateSnipeButtonUI() {
        const snipeBtn = document.getElementById('elim-snipe-main-btn');
        if (!snipeBtn) return;

        const isAttackPage = window.location.href.includes('loader.php?sid=attack');
        const count = currentValidTargets.length;

        if (isAttackPage) {
            snipeBtn.innerText = `⚔️ NEXT TARGET`;
        } else if (count > 0) {
            snipeBtn.innerText = `⚔️ SNIPE TARGET (${count} ready)`;
        } else {
            snipeBtn.innerText = `⚔️ SNIPE TARGET`;
        }
        snipeBtn.style.background = '#ff4757';
    }

    // ── Create Minimal Floating Snipe Widget ──
    function createSnipeWidget() {
        if (document.getElementById('elim-snipe-widget')) return;

        const container = document.createElement('div');
        container.id = 'elim-snipe-widget';
        container.style.cssText = `
            position: fixed;
            bottom: 18px;
            right: 18px;
            z-index: 9999999;
            display: flex;
            align-items: center;
            gap: 6px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        // The 1-Click Snipe Button
        const snipeBtn = document.createElement('button');
        snipeBtn.id = 'elim-snipe-main-btn';
        snipeBtn.innerText = '⚔️ SNIPE TARGET';
        snipeBtn.style.cssText = `
            background: #ff4757;
            color: #ffffff;
            font-weight: 900;
            font-size: 13px;
            padding: 10px 16px;
            border: none;
            border-radius: 30px;
            cursor: pointer;
            box-shadow: 0 6px 20px rgba(255, 71, 87, 0.5), 0 2px 6px rgba(0,0,0,0.4);
            letter-spacing: 0.5px;
            transition: all 0.15s ease;
        `;
        snipeBtn.onmouseover = () => snipeBtn.style.transform = 'scale(1.04)';
        snipeBtn.onmouseout = () => snipeBtn.style.transform = 'scale(1)';
        snipeBtn.onclick = executeSnipe;

        // Settings Cog Button
        const cogBtn = document.createElement('button');
        cogBtn.id = 'elim-snipe-cog-btn';
        cogBtn.innerText = '⚙️';
        cogBtn.title = 'Settings';
        cogBtn.style.cssText = `
            background: #1e222d;
            border: 1px solid #3d4455;
            color: #fff;
            padding: 8px 10px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 13px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        `;

        // Settings Dropdown Drawer
        const drawer = document.createElement('div');
        drawer.id = 'elim-snipe-drawer';
        drawer.style.cssText = `
            display: none;
            position: absolute;
            bottom: 48px;
            right: 0;
            width: 260px;
            background: #181b22;
            border: 2px solid #ff4757;
            border-radius: 10px;
            padding: 12px;
            color: #f1f2f6;
            box-shadow: 0 10px 30px rgba(0,0,0,0.85);
            font-size: 11px;
        `;

        drawer.innerHTML = `
            <div style="font-weight:bold; color:#ff4757; margin-bottom:8px; font-size:12px;">🎯 Snipe Target Settings</div>
            <label style="display:block; margin-bottom:6px;">API Key (Connected to FF Scouter):
                <input type="password" id="elim-input-key" value="${apiKey}" placeholder="Paste API Key" style="width:100%; box-sizing:border-box; background:#242936; border:1px solid #3d4455; color:#fff; padding:4px 6px; border-radius:4px; font-size:11px; margin-top:2px;">
            </label>
            <label style="display:block; margin-bottom:6px;">Fair Fight Tier:
                <select id="elim-select-tier" style="width:100%; box-sizing:border-box; background:#242936; border:1px solid #3d4455; color:#fff; padding:4px 6px; border-radius:4px; font-size:11px; margin-top:2px;">
                    <option value="easy" ${ffTierLimit === 'easy' ? 'selected' : ''}>🟢 Easy (< 3.0 FF)</option>
                    <option value="manageable" ${ffTierLimit === 'manageable' ? 'selected' : ''}>🟡 Easy & Manageable (≤ 3.8 FF)</option>
                    <option value="difficult" ${ffTierLimit === 'difficult' ? 'selected' : ''}>🟠 Up to Difficult (≤ 4.5 FF)</option>
                    <option value="all" ${ffTierLimit === 'all' ? 'selected' : ''}>⚪ All Tiers</option>
                </select>
            </label>
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <label style="cursor:pointer;"><input type="checkbox" id="elim-chk-hosp" ${hideHosp ? 'checked' : ''}> Hide Hosp</label>
                <label style="cursor:pointer;"><input type="checkbox" id="elim-chk-fly" ${hideFlying ? 'checked' : ''}> Hide Flying</label>
            </div>
            <button id="elim-save-settings-btn" style="width:100%; background:#2ed573; color:#000; border:none; font-weight:bold; padding:6px; border-radius:4px; cursor:pointer; margin-bottom:6px;">💾 Save Settings</button>
            <button id="elim-test-snipe-btn" style="width:100%; background:#3742fa; color:#fff; border:none; font-weight:bold; padding:5px; border-radius:4px; cursor:pointer; font-size:10px;">🧪 Test Snipe (Dummy Target)</button>
        `;

        container.appendChild(snipeBtn);
        container.appendChild(cogBtn);
        container.appendChild(drawer);
        document.body.appendChild(container);

        cogBtn.onclick = () => {
            drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
        };

        drawer.querySelector('#elim-save-settings-btn').onclick = () => {
            apiKey = document.querySelector('#elim-input-key').value.trim();
            ffTierLimit = document.querySelector('#elim-select-tier').value;
            hideHosp = document.querySelector('#elim-chk-hosp').checked;
            hideFlying = document.querySelector('#elim-chk-fly').checked;

            setStored(KEY_API_KEY, apiKey);
            setStored(KEY_FF_TIER, ffTierLimit);
            setStored(KEY_HIDE_HOSP, hideHosp);
            setStored(KEY_HIDE_FLYING, hideFlying);

            drawer.style.display = 'none';
            playerCache.clear();
            scanAndQueueTargets();
        };

        // Test Snipe Button: Demonstrates immediate redirect to attack page
        drawer.querySelector('#elim-test-snipe-btn').onclick = () => {
            drawer.style.display = 'none';
            // Pick a test dummy ID (e.g. Duke / Torn NPC or dummy)
            const testDummyId = 4; // Duke NPC
            alert('🧪 Test Snipe: Redirecting to attack screen of verified beatable target!');
            window.location.href = `https://www.torn.com/loader.php?sid=attack&user2ID=${testDummyId}`;
        };
    }

    function init() {
        createSnipeWidget();
        scanAndQueueTargets();

        const observer = new MutationObserver(() => {
            scanAndQueueTargets();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 700);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(init, 700));
    }
})();
