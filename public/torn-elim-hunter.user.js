// ==UserScript==
// @name         Torn Elimination Target Hunter (FF Scouter)
// @namespace    https://spider-verse.net/
// @version      1.0.0
// @description  Finds beatable Elimination & Faction targets using FF Scouter battle stats. Automatically hides hospitalized, traveling, and high-stat players.
// @author       Spider-Verse
// @match        https://www.torn.com/competition.php*
// @match        https://www.torn.com/factions.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      ffscouter.com
// @run-at       document-idle
// @updateURL    https://spider-verse.net/torn-elim-hunter.user.js
// @downloadURL  https://spider-verse.net/torn-elim-hunter.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ── Safe Storage Helper (Supports Tampermonkey GM & standard localStorage) ──
    function getStored(key, def) {
        try {
            if (typeof GM_getValue === 'function') {
                const val = GM_getValue(key, def);
                if (val !== undefined && val !== null) return val;
            }
            const ls = localStorage.getItem(key);
            return ls !== null ? JSON.parse(ls) : def;
        } catch (e) {
            return def;
        }
    }

    function setStored(key, val) {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(key, val);
            localStorage.setItem(key, JSON.stringify(val));
        } catch (e) {}
    }

    const KEY_FF_API = 'elim_hunter_ff_key';
    const KEY_MAX_STAT = 'elim_hunter_max_stat';
    const KEY_HIDE_HOSP = 'elim_hunter_hide_hosp';
    const KEY_HIDE_FLYING = 'elim_hunter_hide_flying';

    let ffKey = getStored(KEY_FF_API, '');
    let maxStatThreshold = Number(getStored(KEY_MAX_STAT, 50000000)); // Default 50M
    let hideHosp = getStored(KEY_HIDE_HOSP, true);
    let hideFlying = getStored(KEY_HIDE_FLYING, true);

    const statsCache = new Map(); // Cache: PlayerID -> bs_estimate

    // ── Number Formatter (e.g. 2,500,000 -> 2.5M) ──
    function formatStat(num) {
        if (!num || isNaN(num)) return '?';
        if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(0) + 'k';
        return num.toLocaleString();
    }

    // ── Batch Fetch Battle Stats from FF Scouter ──
    async function fetchFFStats(playerIds) {
        if (!ffKey || !playerIds || playerIds.length === 0) return;

        const uncached = playerIds.filter(id => !statsCache.has(id));
        if (uncached.length === 0) return;

        // Batch up to 30 targets at a time
        for (let i = 0; i < uncached.length; i += 30) {
            const batch = uncached.slice(i, i + 30);
            try {
                await new Promise((resolve) => {
                    const url = `https://ffscouter.com/api/v1/get-stats?key=${encodeURIComponent(ffKey)}&targets=${batch.join(',')}`;

                    if (typeof GM_xmlhttpRequest === 'function') {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: url,
                            timeout: 9000,
                            onload: function(res) {
                                try {
                                    const data = JSON.parse(res.responseText);
                                    if (Array.isArray(data)) {
                                        data.forEach(p => {
                                            if (p.player_id) statsCache.set(String(p.player_id), p.bs_estimate || 0);
                                        });
                                    }
                                } catch(e) {}
                                resolve();
                            },
                            onerror: () => resolve(),
                            ontimeout: () => resolve()
                        });
                    } else {
                        fetch(url)
                            .then(r => r.json())
                            .then(data => {
                                if (Array.isArray(data)) {
                                    data.forEach(p => {
                                        if (p.player_id) statsCache.set(String(p.player_id), p.bs_estimate || 0);
                                    });
                                }
                                resolve();
                            })
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

        // Hospital Detection
        const isHosp = /hospital/i.test(text) || 
                       /hospital/i.test(html) || 
                       rowEl.querySelector('[class*="hospital"], svg[class*="hospital"], [title*="Hospital"], [aria-label*="Hospital"]');

        // Traveling / Flight Detection
        const isFlying = /traveling|abroad|in a foreign country/i.test(text) || 
                         /traveling|abroad/i.test(html) || 
                         rowEl.querySelector('[class*="traveling"], [class*="abroad"], svg[class*="traveling"], [title*="Traveling"], [title*="Abroad"]');

        return { isHosp: !!isHosp, isFlying: !!isFlying };
    }

    // ── Main Scan and Filter Execution ──
    async function scanAndFilterRoster() {
        const rows = document.querySelectorAll(
            'ul.member-list > li, .table-row, .members-list > li, [class*="memberList"] [class*="tableRow"], .user-info-list-wrap li'
        );

        if (!rows || rows.length === 0) return;

        const targetData = [];

        rows.forEach(row => {
            const profileLink = row.querySelector('a[href*="profiles.php?XID="]');
            if (!profileLink) return;

            const match = profileLink.href.match(/XID=(\d+)/);
            if (!match) return;

            const playerId = match[1];
            const { isHosp, isFlying } = checkPlayerStatus(row);

            targetData.push({ row, playerId, isHosp, isFlying });
        });

        if (targetData.length === 0) return;

        // Fetch stats from FF Scouter for IDs
        const idsToFetch = targetData.map(t => t.playerId);
        await fetchFFStats(idsToFetch);

        let visibleCount = 0;
        let hospHidden = 0;
        let flyHidden = 0;
        let statHidden = 0;

        targetData.forEach(({ row, playerId, isHosp, isFlying }) => {
            const estStat = statsCache.get(playerId) || 0;

            let shouldHide = false;

            if (hideHosp && isHosp) {
                shouldHide = true;
                hospHidden++;
            } else if (hideFlying && isFlying) {
                shouldHide = true;
                flyHidden++;
            } else if (ffKey && estStat > 0 && maxStatThreshold > 0 && estStat > maxStatThreshold) {
                shouldHide = true;
                statHidden++;
            }

            // Stat Badge
            let statBadge = row.querySelector('.elim-stat-badge');
            if (!statBadge) {
                statBadge = document.createElement('span');
                statBadge.className = 'elim-stat-badge';
                statBadge.style.cssText = 'display:inline-block; font-size:11px; font-weight:800; padding:2px 6px; border-radius:4px; margin-left:6px; vertical-align:middle;';
                const nameEl = row.querySelector('a[href*="profiles.php?XID="]');
                if (nameEl && nameEl.parentNode) nameEl.parentNode.appendChild(statBadge);
            }

            if (estStat > 0) {
                const isUnder = estStat <= maxStatThreshold;
                statBadge.innerText = `⚡ ~${formatStat(estStat)}`;
                statBadge.style.background = isUnder ? 'rgba(46, 213, 115, 0.2)' : 'rgba(255, 71, 87, 0.2)';
                statBadge.style.color = isUnder ? '#2ed573' : '#ff4757';
                statBadge.style.border = `1px solid ${isUnder ? '#2ed573' : '#ff4757'}`;
            } else {
                statBadge.innerText = ffKey ? '⚡ ?' : '⚡ No Key';
                statBadge.style.background = '#2f3542';
                statBadge.style.color = '#a4b0be';
                statBadge.style.border = '1px solid #57606f';
            }

            // 1-Tap Attack Button
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

        // Update HUD
        const counter = document.getElementById('elim-hud-counter');
        if (counter) {
            counter.innerHTML = `<span style="color:#2ed573; font-weight:bold; font-size:12px;">${visibleCount} Targets Available</span> ` +
                                `<div style="color:#747d8c; font-size:10px; margin-top:2px;">Hidden: Hosp ${hospHidden} · Flying ${flyHidden} · High-Stat ${statHidden}</div>`;
        }
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
            background: #1e222d;
            border: 1px solid #ff4757;
            border-radius: 10px;
            padding: 10px 14px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.8);
            color: #f1f2f6;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 12px;
            max-width: 90vw;
            min-width: 240px;
        `;

        hud.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-weight:bold; color:#ff4757; cursor:pointer;" id="elim-hud-title">🎯 Elim Target Hunter</span>
                <span id="elim-hud-toggle" style="font-size:11px; color:#70a1ff; cursor:pointer; padding:2px 4px;">⚙️ Settings</span>
            </div>
            <div id="elim-hud-counter" style="margin-bottom:6px; font-size:11px;">Scanning targets...</div>
            <div id="elim-hud-settings" style="display:none; border-top:1px solid #2f3542; padding-top:8px; margin-top:6px;">
                <label style="display:block; margin-bottom:6px; font-size:11px;">FF Scouter Key:
                    <input type="password" id="elim-cfg-ffkey" value="${ffKey}" placeholder="Paste FF Key" style="width:100%; box-sizing:border-box; background:#2f3542; border:1px solid #57606f; color:#fff; padding:4px 6px; border-radius:4px; font-size:11px; margin-top:3px;">
                </label>
                <label style="display:block; margin-bottom:6px; font-size:11px;">Max Stat Ceiling:
                    <select id="elim-cfg-maxstat" style="width:100%; box-sizing:border-box; background:#2f3542; border:1px solid #57606f; color:#fff; padding:4px 6px; border-radius:4px; font-size:11px; margin-top:3px;">
                        <option value="5000000" ${maxStatThreshold === 5000000 ? 'selected' : ''}>Under 5 Million (5M)</option>
                        <option value="15000000" ${maxStatThreshold === 15000000 ? 'selected' : ''}>Under 15 Million (15M)</option>
                        <option value="50000000" ${maxStatThreshold === 50000000 ? 'selected' : ''}>Under 50 Million (50M)</option>
                        <option value="100000000" ${maxStatThreshold === 100000000 ? 'selected' : ''}>Under 100 Million (100M)</option>
                        <option value="250000000" ${maxStatThreshold === 250000000 ? 'selected' : ''}>Under 250 Million (250M)</option>
                        <option value="500000000" ${maxStatThreshold === 50000000 ? 'selected' : ''}>Under 500 Million (500M)</option>
                        <option value="1000000000" ${maxStatThreshold === 1000000000 ? 'selected' : ''}>Under 1 Billion (1B)</option>
                        <option value="999999999999" ${maxStatThreshold >= 999999999999 ? 'selected' : ''}>No Stat Limit (All)</option>
                    </select>
                </label>
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:11px;">
                    <label style="cursor:pointer;"><input type="checkbox" id="elim-cfg-hosp" ${hideHosp ? 'checked' : ''}> Hide Hosp</label>
                    <label style="cursor:pointer;"><input type="checkbox" id="elim-cfg-fly" ${hideFlying ? 'checked' : ''}> Hide Flying</label>
                </div>
                <button id="elim-cfg-save" style="width:100%; background:#2ed573; border:none; color:#000; font-weight:bold; padding:6px; border-radius:4px; cursor:pointer;">💾 Save & Scan</button>
            </div>
        `;

        document.body.appendChild(hud);

        // Toggle settings panel
        const toggleBtn = document.getElementById('elim-hud-toggle');
        const titleBtn = document.getElementById('elim-hud-title');
        const settingsPanel = document.getElementById('elim-hud-settings');

        const toggleSettings = () => {
            settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
        };

        toggleBtn.onclick = toggleSettings;
        titleBtn.onclick = toggleSettings;

        // Save settings handler
        document.getElementById('elim-cfg-save').onclick = () => {
            ffKey = document.getElementById('elim-cfg-ffkey').value.trim();
            maxStatThreshold = Number(document.getElementById('elim-cfg-maxstat').value);
            hideHosp = document.getElementById('elim-cfg-hosp').checked;
            hideFlying = document.getElementById('elim-cfg-fly').checked;

            setStored(KEY_FF_API, ffKey);
            setStored(KEY_MAX_STAT, maxStatThreshold);
            setStored(KEY_HIDE_HOSP, hideHosp);
            setStored(KEY_HIDE_FLYING, hideFlying);

            settingsPanel.style.display = 'none';
            scanAndFilterRoster();
        };
    }

    // ── Observer to re-filter on dynamic page changes ──
    function init() {
        createHUD();
        scanAndFilterRoster();

        const observer = new MutationObserver(() => {
            scanAndFilterRoster();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 1000);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
    }
})();
