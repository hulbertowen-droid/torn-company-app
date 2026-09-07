// ==UserScript==
// @name         Torn Elimination Target Hunter (FF Scouter Tiers)
// @namespace    https://spider-verse.net/
// @version      1.1.0
// @description  Finds beatable Elimination targets using FF Scouter Fair Fight tiers. Automatically filters out hospital, traveling, and high-FF opponents. Includes built-in test sandbox.
// @author       Spider-Verse
// @match        https://www.torn.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      ffscouter.com
// @connect      api.torn.com
// @run-at       document-idle
// @updateURL    https://spider-verse.net/torn-elim-hunter.user.js
// @downloadURL  https://spider-verse.net/torn-elim-hunter.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ── Safe Storage Helper ──
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

    // ── Configuration Keys ──
    const KEY_API_KEY = 'elim_hunter_api_key';
    const KEY_FF_TIER = 'elim_hunter_ff_tier'; // 'easy', 'manageable', 'difficult', 'all'
    const KEY_HIDE_HOSP = 'elim_hunter_hide_hosp';
    const KEY_HIDE_FLYING = 'elim_hunter_hide_flying';
    const KEY_MY_STATS = 'elim_hunter_my_stats';

    let apiKey = getStored(KEY_API_KEY, '');
    let ffTierLimit = getStored(KEY_FF_TIER, 'manageable'); // default: Easy & Manageable (<= 3.8)
    let hideHosp = getStored(KEY_HIDE_HOSP, true);
    let hideFlying = getStored(KEY_HIDE_FLYING, true);
    let myTotalStats = Number(getStored(KEY_MY_STATS, 0));

    // Cache: PlayerID -> { ff: number, bs: number, tier: string }
    const playerCache = new Map();

    // ── Fair Fight Tier Categorizer ──
    // Standard FF Scouter Tiers:
    // < 3.0: Easy
    // 3.0 - 3.8: Manageable
    // 3.8 - 4.5: Very Difficult
    // > 4.5: Almost Impossible / Danger
    function getTierInfo(ff) {
        if (!ff || isNaN(ff)) return { tier: 'unknown', label: 'Unknown', color: '#a4b0be', bg: '#2f3542' };
        if (ff < 3.0) return { tier: 'easy', label: 'Easy', color: '#2ed573', bg: 'rgba(46, 213, 115, 0.2)' };
        if (ff <= 3.8) return { tier: 'manageable', label: 'Manageable', color: '#eccc68', bg: 'rgba(236, 204, 104, 0.2)' };
        if (ff <= 4.5) return { tier: 'difficult', label: 'Difficult', color: '#ff7f50', bg: 'rgba(255, 127, 80, 0.2)' };
        return { tier: 'danger', label: 'Danger', color: '#ff4757', bg: 'rgba(255, 71, 87, 0.2)' };
    }

    function isWithinTierLimit(ff) {
        if (!ff || isNaN(ff)) return true; // keep if unknown so user can decide
        if (ffTierLimit === 'all') return true;
        if (ffTierLimit === 'easy') return ff < 3.0;
        if (ffTierLimit === 'manageable') return ff <= 3.8;
        if (ffTierLimit === 'difficult') return ff <= 4.5;
        return true;
    }

    function formatStat(num) {
        if (!num || isNaN(num)) return '?';
        if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(0) + 'k';
        return num.toLocaleString();
    }

    // ── Auto-fetch User's Own Battle Stats (To ensure 100% accurate FF calculation) ──
    async function fetchMyBattleStats() {
        if (!apiKey || myTotalStats > 0) return;
        try {
            const url = `https://api.torn.com/user/?selections=battlestats&key=${encodeURIComponent(apiKey)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.strength) {
                myTotalStats = (data.strength || 0) + (data.speed || 0) + (data.defense || 0) + (data.dexterity || 0);
                setStored(KEY_MY_STATS, myTotalStats);
                console.log('[ElimHunter] Loaded user battle stats:', myTotalStats);
            }
        } catch(e) {}
    }

    // ── Calculate FF Score from stats if FFScouter only returns bs_estimate ──
    function calculateFF(defenderStats) {
        if (!defenderStats || !myTotalStats || myTotalStats <= 0) return null;
        const ratio = defenderStats / myTotalStats;
        // Torn Fair Fight formula: 1 + (8/3) * ratio, capped between 1.0 and 3.0 officially,
        // but FF Scouter extends up to 4.5+ to indicate scale above you.
        const ff = parseFloat((1 + (8/3) * ratio).toFixed(2));
        return ff;
    }

    // ── Batch Fetch from FF Scouter using User's Key ──
    async function fetchFFStats(playerIds) {
        if (!apiKey || !playerIds || playerIds.length === 0) return;

        const uncached = playerIds.filter(id => !playerCache.has(id));
        if (uncached.length === 0) return;

        // Ensure we have user stats for fallback FF calculation
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

    // ── Detect Live Status from Player Row DOM ──
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

    // ── Main Scan and Filter ──
    async function scanAndFilter() {
        // Collect rows across Elimination competition, Factions, Bounties, and Mock Sandbox
        const rows = document.querySelectorAll(
            'ul.member-list > li, .table-row, .members-list > li, [class*="memberList"] [class*="tableRow"], .user-info-list-wrap li, .bounties-wrap .table-row, .elim-mock-row'
        );

        if (!rows || rows.length === 0) return;

        const targets = [];
        rows.forEach(row => {
            const profileLink = row.querySelector('a[href*="profiles.php?XID="]');
            if (!profileLink) return;

            const match = profileLink.href.match(/XID=(\d+)/);
            if (!match) return;

            const playerId = match[1];
            const { isHosp, isFlying } = checkPlayerStatus(row);
            targets.push({ row, playerId, isHosp, isFlying });
        });

        if (targets.length === 0) return;

        // Fetch FF Scouter data
        await fetchFFStats(targets.map(t => t.playerId));

        let visibleCount = 0;
        let hospHidden = 0;
        let flyHidden = 0;
        let tierHidden = 0;

        targets.forEach(({ row, playerId, isHosp, isFlying }) => {
            const data = playerCache.get(playerId) || {};
            const ff = data.ff;
            const tierInfo = data.info || getTierInfo(ff);

            let shouldHide = false;

            if (hideHosp && isHosp) {
                shouldHide = true;
                hospHidden++;
            } else if (hideFlying && isFlying) {
                shouldHide = true;
                flyHidden++;
            } else if (ff !== undefined && !isWithinTierLimit(ff)) {
                shouldHide = true;
                tierHidden++;
            }

            // Inject or update FF Badge
            let badge = row.querySelector('.elim-ff-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'elim-ff-badge';
                badge.style.cssText = 'display:inline-block; font-size:11px; font-weight:800; padding:2px 6px; border-radius:4px; margin-left:6px; vertical-align:middle;';
                const link = row.querySelector('a[href*="profiles.php?XID="]');
                if (link && link.parentNode) link.parentNode.appendChild(badge);
            }

            if (ff !== undefined && ff !== null) {
                badge.innerText = `🎯 FF ${ff.toFixed(1)} · ${tierInfo.label}`;
                badge.style.background = tierInfo.bg;
                badge.style.color = tierInfo.color;
                badge.style.border = `1px solid ${tierInfo.color}`;
            } else {
                badge.innerText = apiKey ? '🎯 FF ?' : '🎯 No Key';
                badge.style.background = '#2f3542';
                badge.style.color = '#a4b0be';
                badge.style.border = '1px solid #57606f';
            }

            // Inject Quick Attack Button
            let attackBtn = row.querySelector('.elim-quick-attack');
            if (!attackBtn) {
                attackBtn = document.createElement('a');
                attackBtn.className = 'elim-quick-attack';
                attackBtn.innerText = '⚔️ HIT';
                attackBtn.href = `/loader.php?sid=attack&user2ID=${playerId}`;
                attackBtn.target = '_blank';
                attackBtn.style.cssText = 'display:inline-block; background:#ff4757; color:#fff; font-size:11px; font-weight:800; padding:3px 8px; border-radius:4px; text-decoration:none; margin-left:8px; vertical-align:middle;';
                row.appendChild(attackBtn);
            }

            if (shouldHide) {
                row.style.display = 'none';
            } else {
                row.style.display = '';
                visibleCount++;
            }
        });

        // Update HUD counter
        const counter = document.getElementById('elim-hud-counter');
        if (counter) {
            counter.innerHTML = `<span style="color:#2ed573; font-weight:bold; font-size:12px;">${visibleCount} Targets Available</span> ` +
                                `<div style="color:#747d8c; font-size:10px; margin-top:2px;">Hidden: Hosp ${hospHidden} · Flying ${flyHidden} · High-FF ${tierHidden}</div>`;
        }
    }

    // ── Built-in Simulation Sandbox (Allows Instant Testing Right Now on ANY Torn Page) ──
    function toggleSandboxRoster() {
        let sandbox = document.getElementById('elim-sandbox-container');
        if (sandbox) {
            sandbox.remove();
            scanAndFilter();
            return;
        }

        sandbox = document.createElement('div');
        sandbox.id = 'elim-sandbox-container';
        sandbox.style.cssText = `
            margin: 15px auto;
            max-width: 780px;
            background: #191c24;
            border: 2px solid #ff4757;
            border-radius: 8px;
            padding: 12px;
            color: #fff;
            font-family: sans-serif;
            box-shadow: 0 4px 20px rgba(0,0,0,0.8);
            position: relative;
            z-index: 99999;
        `;

        sandbox.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #2f3542; padding-bottom:8px; margin-bottom:10px;">
                <span style="font-weight:bold; color:#ff4757;">🧪 Elimination Test Sandbox (Simulated Opposing Team)</span>
                <button id="elim-close-sandbox" style="background:#2f3542; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Close Sandbox</button>
            </div>
            <div style="font-size:11px; color:#a4b0be; margin-bottom:10px;">
                This simulated roster mimics live Elimination opponents with different statuses and FF tiers to test your filters immediately.
            </div>
            <div id="elim-sandbox-list" style="display:flex; flex-direction:column; gap:6px;"></div>
        `;

        // Pre-populate mock players with known mock FF stats
        const mockPlayers = [
            { id: 99901, name: 'Target_Easy_1', status: 'Okay', ff: 1.8, bs: 2500000 },
            { id: 99902, name: 'Target_Easy_2', status: 'Okay', ff: 2.4, bs: 8000000 },
            { id: 99903, name: 'Target_Manageable_1', status: 'Okay', ff: 3.2, bs: 18000000 },
            { id: 99904, name: 'Target_Manageable_2', status: 'Okay', ff: 3.6, bs: 32000000 },
            { id: 99905, name: 'Target_Difficult_1', status: 'Okay', ff: 4.1, bs: 75000000 },
            { id: 99906, name: 'Target_Danger_Beast', status: 'Okay', ff: 5.4, bs: 350000000 },
            { id: 99907, name: 'Target_In_Hospital_1', status: 'Hospital (24m)', ff: 2.1, bs: 5000000 },
            { id: 99908, name: 'Target_In_Hospital_2', status: 'Hospital (1h 12m)', ff: 3.1, bs: 15000000 },
            { id: 99909, name: 'Target_Flying_Mexico', status: 'Traveling to Mexico', ff: 2.0, bs: 4000000 },
            { id: 99910, name: 'Target_Abroad_Switz', status: 'In a foreign country', ff: 2.8, bs: 12000000 }
        ];

        // Seed mock player cache
        mockPlayers.forEach(p => {
            playerCache.set(String(p.id), { ff: p.ff, bs: p.bs, info: getTierInfo(p.ff) });
        });

        const list = sandbox.querySelector('#elim-sandbox-list');
        mockPlayers.forEach(p => {
            const isHosp = p.status.includes('Hospital');
            const isFly = p.status.includes('Traveling') || p.status.includes('foreign');
            const statusColor = isHosp ? '#ff4757' : (isFly ? '#70a1ff' : '#2ed573');

            const row = document.createElement('div');
            row.className = 'elim-mock-row';
            row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:#21252f; padding:8px 10px; border-radius:6px; border:1px solid #2f3542;';
            row.innerHTML = `
                <div>
                    <a href="/profiles.php?XID=${p.id}" style="color:#70a1ff; font-weight:bold; text-decoration:none;">${p.name}</a>
                    <span style="font-size:10px; color:${statusColor}; margin-left:8px;">[${p.status}]</span>
                </div>
            `;
            list.appendChild(row);
        });

        // Insert sandbox at the top of content
        const mainContent = document.querySelector('#mainContainer, .content-wrapper, body');
        if (mainContent) mainContent.insertBefore(sandbox, mainContent.firstChild);

        sandbox.querySelector('#elim-close-sandbox').onclick = () => {
            sandbox.remove();
            scanAndFilter();
        };

        scanAndFilter();
    }

    // ── Floating HUD ──
    function createHUD() {
        if (document.getElementById('elim-hunter-hud')) return;

        const hud = document.createElement('div');
        hud.id = 'elim-hunter-hud';
        hud.style.cssText = `
            position: fixed;
            bottom: 14px;
            right: 14px;
            z-index: 999999;
            background: #181b22;
            border: 1px solid #ff4757;
            border-radius: 10px;
            padding: 10px 14px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.85);
            color: #f1f2f6;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 12px;
            max-width: 90vw;
            min-width: 250px;
        `;

        hud.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-weight:bold; color:#ff4757; cursor:pointer;" id="elim-hud-title">🎯 Elim Target Hunter</span>
                <span id="elim-hud-toggle" style="font-size:11px; color:#70a1ff; cursor:pointer; padding:2px 4px;">⚙️ Settings</span>
            </div>
            <div id="elim-hud-counter" style="margin-bottom:6px; font-size:11px;">Scanning targets...</div>
            <button id="elim-sandbox-btn" style="width:100%; background:#3742fa; color:#fff; border:none; padding:5px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:11px; margin-bottom:6px;">🧪 Spawn Test Elimination Roster</button>
            <div id="elim-hud-settings" style="display:none; border-top:1px solid #2f3542; padding-top:8px; margin-top:6px;">
                <label style="display:block; margin-bottom:6px; font-size:11px;">Torn API Key (Connected to FF Scouter):
                    <input type="password" id="elim-cfg-key" value="${apiKey}" placeholder="Paste API Key" style="width:100%; box-sizing:border-box; background:#2f3542; border:1px solid #57606f; color:#fff; padding:4px 6px; border-radius:4px; font-size:11px; margin-top:3px;">
                </label>
                <label style="display:block; margin-bottom:6px; font-size:11px;">Fair Fight (FF) Tier Limit:
                    <select id="elim-cfg-tier" style="width:100%; box-sizing:border-box; background:#2f3542; border:1px solid #57606f; color:#fff; padding:4px 6px; border-radius:4px; font-size:11px; margin-top:3px;">
                        <option value="easy" ${ffTierLimit === 'easy' ? 'selected' : ''}>🟢 Easy Only (< 3.0 FF)</option>
                        <option value="manageable" ${ffTierLimit === 'manageable' ? 'selected' : ''}>🟡 Easy & Manageable (≤ 3.8 FF) [Recommended]</option>
                        <option value="difficult" ${ffTierLimit === 'difficult' ? 'selected' : ''}>🟠 Up to Difficult (≤ 4.5 FF)</option>
                        <option value="all" ${ffTierLimit === 'all' ? 'selected' : ''}>⚪ All Tiers (No FF Filter)</option>
                    </select>
                </label>
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:11px;">
                    <label style="cursor:pointer;"><input type="checkbox" id="elim-cfg-hosp" ${hideHosp ? 'checked' : ''}> Hide Hosp</label>
                    <label style="cursor:pointer;"><input type="checkbox" id="elim-cfg-fly" ${hideFlying ? 'checked' : ''}> Hide Flying</label>
                </div>
                <button id="elim-cfg-save" style="width:100%; background:#2ed573; border:none; color:#000; font-weight:bold; padding:6px; border-radius:4px; cursor:pointer;">💾 Save & Re-Scan</button>
            </div>
        `;

        document.body.appendChild(hud);

        const toggleBtn = document.getElementById('elim-hud-toggle');
        const titleBtn = document.getElementById('elim-hud-title');
        const settingsPanel = document.getElementById('elim-hud-settings');

        const toggleSettings = () => {
            settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
        };

        toggleBtn.onclick = toggleSettings;
        titleBtn.onclick = toggleSettings;

        document.getElementById('elim-sandbox-btn').onclick = () => {
            toggleSandboxRoster();
        };

        document.getElementById('elim-cfg-save').onclick = () => {
            apiKey = document.getElementById('elim-cfg-key').value.trim();
            ffTierLimit = document.getElementById('elim-cfg-tier').value;
            hideHosp = document.getElementById('elim-cfg-hosp').checked;
            hideFlying = document.getElementById('elim-cfg-fly').checked;

            setStored(KEY_API_KEY, apiKey);
            setStored(KEY_FF_TIER, ffTierLimit);
            setStored(KEY_HIDE_HOSP, hideHosp);
            setStored(KEY_HIDE_FLYING, hideFlying);

            settingsPanel.style.display = 'none';
            playerCache.clear();
            scanAndFilter();
        };
    }

    function init() {
        createHUD();
        scanAndFilter();

        const observer = new MutationObserver(() => {
            scanAndFilter();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 800);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
    }
})();
