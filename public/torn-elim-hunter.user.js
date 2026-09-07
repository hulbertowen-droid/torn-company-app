// ==UserScript==
// @name         Torn Elimination Target Hunter (FF Scouter Tiers)
// @namespace    https://spider-verse.net/
// @version      1.1.1
// @description  Finds beatable Elimination targets using FF Scouter Fair Fight tiers. Automatically filters out hospital, traveling, and high-FF opponents. Includes built-in interactive test sandbox.
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
        if (!ff || isNaN(ff)) return true;
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

    // ── Auto-fetch User's Own Battle Stats ──
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
        const ratio = defenderStats / myTotalStats;
        return parseFloat((1 + (8/3) * ratio).toFixed(2));
    }

    // ── Batch Fetch from FF Scouter using User's Key ──
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

    // ── Main Scan and Filter for Real Torn Pages ──
    async function scanAndFilter() {
        const rows = document.querySelectorAll(
            'ul.member-list > li, .table-row, .members-list > li, [class*="memberList"] [class*="tableRow"], .user-info-list-wrap li, .bounties-wrap .table-row'
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

        const counter = document.getElementById('elim-hud-counter');
        if (counter) {
            counter.innerHTML = `<span style="color:#2ed573; font-weight:bold; font-size:12px;">${visibleCount} Targets Available</span> ` +
                                `<div style="color:#747d8c; font-size:10px; margin-top:2px;">Hidden: Hosp ${hospHidden} · Flying ${flyHidden} · High-FF ${tierHidden}</div>`;
        }
    }

    // ── MOCK DATA FOR INSTANT SANDBOX TESTING ──
    const MOCK_OPPONENTS = [
        { id: 99901, name: 'Target_Easy_1', status: 'Okay', ff: 1.8, note: 'Weak opponent' },
        { id: 99902, name: 'Target_Easy_2', status: 'Okay', ff: 2.4, note: 'Low stat target' },
        { id: 99903, name: 'Target_Manageable_1', status: 'Okay', ff: 3.2, note: 'Even fair fight' },
        { id: 99904, name: 'Target_Manageable_2', status: 'Okay', ff: 3.6, note: 'Manageable match' },
        { id: 99905, name: 'Target_Difficult_1', status: 'Okay', ff: 4.1, note: 'Tough enemy' },
        { id: 99906, name: 'Target_Danger_Beast', status: 'Okay', ff: 5.4, note: 'Outmatches you' },
        { id: 99907, name: 'Target_In_Hospital_1', status: 'Hospital (18m)', ff: 2.2, note: 'Currently hosp' },
        { id: 99908, name: 'Target_In_Hospital_2', status: 'Hospital (55m)', ff: 3.1, note: 'Currently hosp' },
        { id: 99909, name: 'Target_Flying_Mexico', status: 'Traveling to Mexico', ff: 1.9, note: 'In flight' },
        { id: 99910, name: 'Target_Abroad_Switz', status: 'In Switzerland', ff: 2.7, note: 'Abroad overseas' }
    ];

    // Seed mock data into playerCache
    MOCK_OPPONENTS.forEach(p => {
        playerCache.set(String(p.id), { ff: p.ff, bs: 1000000, info: getTierInfo(p.ff) });
    });

    // ── Render Sandbox Modal (Opens Centered on Mobile & Desktop) ──
    function renderSandboxModal() {
        const modal = document.getElementById('elim-sandbox-modal');
        if (!modal) return;

        const list = modal.querySelector('#elim-modal-list');
        list.innerHTML = '';

        let readyCount = 0;
        let hiddenCount = 0;

        MOCK_OPPONENTS.forEach(p => {
            const isHosp = p.status.includes('Hospital');
            const isFly = p.status.includes('Traveling') || p.status.includes('Switzerland') || p.status.includes('Abroad');
            const tierInfo = getTierInfo(p.ff);

            let isFiltered = false;
            let filterReason = '';

            if (hideHosp && isHosp) {
                isFiltered = true;
                filterReason = 'Hospitalized';
            } else if (hideFlying && isFly) {
                isFiltered = true;
                filterReason = 'Flying / Abroad';
            } else if (!isWithinTierLimit(p.ff)) {
                isFiltered = true;
                filterReason = `FF ${p.ff.toFixed(1)} exceeds limit`;
            }

            if (isFiltered) {
                hiddenCount++;
            } else {
                readyCount++;
            }

            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: ${isFiltered ? '#15181f' : '#222734'};
                border: 1px solid ${isFiltered ? '#2c313d' : '#3d4455'};
                opacity: ${isFiltered ? '0.45' : '1'};
                padding: 8px 12px;
                border-radius: 6px;
                transition: all 0.2s ease;
            `;

            const statusColor = isHosp ? '#ff4757' : (isFly ? '#70a1ff' : '#2ed573');
            const filterBadge = isFiltered ? `<span style="font-size:10px; background:#ff4757; color:#fff; padding:1px 5px; border-radius:3px; margin-left:6px;">🚫 ${filterReason}</span>` : '';

            row.innerHTML = `
                <div>
                    <div style="font-weight:bold; font-size:12px; color:#fff;">
                        ${p.name}
                        ${filterBadge}
                    </div>
                    <div style="font-size:11px; margin-top:2px;">
                        <span style="color:${statusColor}; font-weight:600;">[${p.status}]</span>
                        <span style="display:inline-block; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:4px; margin-left:6px; background:${tierInfo.bg}; color:${tierInfo.color}; border:1px solid ${tierInfo.color};">
                            🎯 FF ${p.ff.toFixed(1)} · ${tierInfo.label}
                        </span>
                    </div>
                </div>
                <div>
                    ${isFiltered ? 
                        `<span style="font-size:11px; color:#747d8c; font-style:italic;">Filtered</span>` : 
                        `<a href="/loader.php?sid=attack&user2ID=${p.id}" target="_blank" style="background:#ff4757; color:#fff; font-size:11px; font-weight:800; padding:4px 10px; border-radius:4px; text-decoration:none;">⚔️ HIT</a>`
                    }
                </div>
            `;
            list.appendChild(row);
        });

        // Update modal summary banner
        const summary = modal.querySelector('#elim-modal-summary');
        if (summary) {
            summary.innerHTML = `
                <span style="color:#2ed573; font-weight:bold;">✅ ${readyCount} Targets Ready to Hit</span>
                <span style="color:#747d8c; margin-left:8px;">(${hiddenCount} Filtered Out)</span>
            `;
        }
    }

    // ── Toggle Sandbox Modal Window ──
    function toggleSandboxRoster() {
        let backdrop = document.getElementById('elim-sandbox-backdrop');
        let modal = document.getElementById('elim-sandbox-modal');
        const spawnBtn = document.getElementById('elim-sandbox-btn');

        if (modal) {
            modal.remove();
            if (backdrop) backdrop.remove();
            if (spawnBtn) {
                spawnBtn.innerText = '🧪 Spawn Test Elimination Roster';
                spawnBtn.style.background = '#3742fa';
            }
            return;
        }

        // Change button style
        if (spawnBtn) {
            spawnBtn.innerText = '❌ Close Test Roster';
            spawnBtn.style.background = '#ff4757';
        }

        // Backdrop
        backdrop = document.createElement('div');
        backdrop.id = 'elim-sandbox-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.75);
            z-index: 99999998;
        `;
        backdrop.onclick = toggleSandboxRoster;
        document.body.appendChild(backdrop);

        // Modal
        modal = document.createElement('div');
        modal.id = 'elim-sandbox-modal';
        modal.style.cssText = `
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 92vw;
            max-width: 620px;
            max-height: 85vh;
            background: #181b22;
            border: 2px solid #ff4757;
            border-radius: 12px;
            box-shadow: 0 12px 36px rgba(0,0,0,0.9);
            z-index: 99999999;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #f1f2f6;
        `;

        modal.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#202532; padding:12px 16px; border-bottom:1px solid #2f3542;">
                <div>
                    <div style="font-weight:bold; font-size:14px; color:#ff4757;">🧪 Elimination Team Target Simulator</div>
                    <div style="font-size:11px; color:#a4b0be; margin-top:2px;">Simulated opposing team with live filter controls</div>
                </div>
                <button id="elim-modal-close-btn" style="background:#2f3542; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-weight:bold;">✕</button>
            </div>

            <!-- Live Filter Controls Inside Modal -->
            <div style="background:#1c202b; padding:10px 16px; border-bottom:1px solid #2f3542; display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between;">
                <div style="display:flex; gap:12px; font-size:11px;">
                    <label style="cursor:pointer; display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="elim-modal-hosp" ${hideHosp ? 'checked' : ''}> Hide Hosp
                    </label>
                    <label style="cursor:pointer; display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="elim-modal-fly" ${hideFlying ? 'checked' : ''}> Hide Flying
                    </label>
                </div>
                <div style="display:flex; align-items:center; gap:6px; font-size:11px;">
                    <span>FF Tier:</span>
                    <select id="elim-modal-tier" style="background:#2f3542; border:1px solid #57606f; color:#fff; padding:3px 6px; border-radius:4px; font-size:11px;">
                        <option value="easy" ${ffTierLimit === 'easy' ? 'selected' : ''}>🟢 Easy (< 3.0)</option>
                        <option value="manageable" ${ffTierLimit === 'manageable' ? 'selected' : ''}>🟡 Easy & Manageable (≤ 3.8)</option>
                        <option value="difficult" ${ffTierLimit === 'difficult' ? 'selected' : ''}>🟠 Up to Difficult (≤ 4.5)</option>
                        <option value="all" ${ffTierLimit === 'all' ? 'selected' : ''}>⚪ All Tiers</option>
                    </select>
                </div>
            </div>

            <div id="elim-modal-summary" style="padding:8px 16px; background:#161921; font-size:11px; border-bottom:1px solid #242936;"></div>

            <!-- Scrollable Target List -->
            <div id="elim-modal-list" style="padding:12px 16px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; flex:1;"></div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#elim-modal-close-btn').onclick = toggleSandboxRoster;

        // Interactive Filter Controls inside Modal
        const hospCheck = modal.querySelector('#elim-modal-hosp');
        const flyCheck = modal.querySelector('#elim-modal-fly');
        const tierSelect = modal.querySelector('#elim-modal-tier');

        const updateFilters = () => {
            hideHosp = hospCheck.checked;
            hideFlying = flyCheck.checked;
            ffTierLimit = tierSelect.value;

            setStored(KEY_HIDE_HOSP, hideHosp);
            setStored(KEY_HIDE_FLYING, hideFlying);
            setStored(KEY_FF_TIER, ffTierLimit);

            // Sync HUD inputs
            const hudHosp = document.getElementById('elim-cfg-hosp');
            const hudFly = document.getElementById('elim-cfg-fly');
            const hudTier = document.getElementById('elim-cfg-tier');
            if (hudHosp) hudHosp.checked = hideHosp;
            if (hudFly) hudFly.checked = hideFlying;
            if (hudTier) hudTier.value = ffTierLimit;

            renderSandboxModal();
            scanAndFilter();
        };

        hospCheck.onchange = updateFilters;
        flyCheck.onchange = updateFilters;
        tierSelect.onchange = updateFilters;

        renderSandboxModal();
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
            <button id="elim-sandbox-btn" style="width:100%; background:#3742fa; color:#fff; border:none; padding:6px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:11px; margin-bottom:6px;">🧪 Spawn Test Elimination Roster</button>
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
