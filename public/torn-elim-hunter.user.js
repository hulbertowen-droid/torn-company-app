// ==UserScript==
// @name         Torn Elimination Target Hunter (1-Click Snipe)
// @namespace    https://spider-verse.net/
// @version      1.4.1
// @description  1-Click instant snipe button for Elimination. Automatically finds beatable enemies (not hosp, not flying, beatable FF tier) and redirects straight into their attack screen.
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
    const KEY_MY_ID = 'elim_hunter_my_id';
    const SESSION_QUEUE = 'elim_snipe_queue';

    let apiKey = getStored(KEY_API_KEY, '');
    let ffTierLimit = getStored(KEY_FF_TIER, 'manageable'); // easy, manageable, difficult, all
    let hideHosp = getStored(KEY_HIDE_HOSP, true);
    let hideFlying = getStored(KEY_HIDE_FLYING, true);
    let myTotalStats = Number(getStored(KEY_MY_STATS, 0));
    let myPlayerId = String(getStored(KEY_MY_ID, ''));

    const playerCache = new Map();
    let currentValidTargets = [];
    let scanTimeout = null;

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
        if (!apiKey) return;
        try {
            const url = `https://api.torn.com/user/?selections=profile,battlestats&key=${encodeURIComponent(apiKey)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data) {
                if (data.player_id) {
                    myPlayerId = String(data.player_id);
                    setStored(KEY_MY_ID, myPlayerId);
                }
                if (data.strength !== undefined) {
                    myTotalStats = (data.strength || 0) + (data.speed || 0) + (data.defense || 0) + (data.dexterity || 0);
                    setStored(KEY_MY_STATS, myTotalStats);
                }
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

        const uncached = playerIds.map(String).filter(id => id && !playerCache.has(id));
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
                                const id = String(p.player_id || p.id);
                                const bs = Number(p.bs_estimate || p.battlestats || 0);
                                let ff = p.fair_fight !== undefined ? Number(p.fair_fight) : (p.ff !== undefined ? Number(p.ff) : null);
                                if ((ff === null || isNaN(ff)) && bs > 0 && myTotalStats > 0) {
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
                            timeout: 8000,
                            onload: (res) => {
                                try { handleResponse(JSON.parse(res.responseText)); } catch(e) { resolve(); }
                            },
                            onerror: () => resolve(),
                            ontimeout: () => resolve()
                        });
                    } else {
                        fetch(url, { signal: AbortSignal.timeout(8000) })
                            .then(r => r.json())
                            .then(handleResponse)
                            .catch(() => resolve());
                    }
                });
            } catch (err) {}
        }
    }

    // ── Check Player Live Status (Hosp / Flying / Jail) ──
    function checkPlayerStatus(containerEl) {
        if (!containerEl) return { isHosp: false, isFlying: false, isJail: false };
        const text = (containerEl.innerText || '').toLowerCase();
        const html = (containerEl.innerHTML || '').toLowerCase();

        const isHosp = text.includes('hospital') || 
                       html.includes('hospital') || 
                       !!containerEl.querySelector('[class*="hospital" i], svg[class*="hospital" i], [title*="hospital" i], [aria-label*="hospital" i]');

        const isFlying = text.includes('traveling') || text.includes('abroad') || text.includes('foreign country') || text.includes('in flight') ||
                         html.includes('traveling') || html.includes('abroad') ||
                         !!containerEl.querySelector('[class*="travel" i], [class*="abroad" i], svg[class*="travel" i], svg[class*="abroad" i], [title*="travel" i], [title*="abroad" i], [aria-label*="travel" i], [aria-label*="abroad" i]');

        const isJail = text.includes('jail') || html.includes('jail') ||
                       !!containerEl.querySelector('[class*="jail" i], [title*="jail" i], [aria-label*="jail" i]');

        return { isHosp: !!isHosp, isFlying: !!isFlying, isJail: !!isJail };
    }

    // ── Universal Candidate Extractor (Works on Any Torn Page) ──
    function extractPageCandidates() {
        const links = document.querySelectorAll('a[href*="profiles.php?XID="], a[href*="profiles.php?xid="]');
        if (!links || links.length === 0) return [];

        const candidates = [];
        const seen = new Set();

        links.forEach(link => {
            const match = link.href.match(/xid=(\d+)/i);
            if (!match) return;
            const playerId = match[1];

            if ((myPlayerId && playerId === myPlayerId) || seen.has(playerId)) return;
            seen.add(playerId);

            let container = link.closest('li, tr, [role="row"], [class*="table-row"], [class*="tableRow"], [class*="member"], [class*="user-row"], [class*="player"]');
            if (!container) {
                let p = link.parentElement;
                for (let i = 0; i < 4 && p && p !== document.body; i++) {
                    if (p.querySelector('[class*="hospital" i], [class*="travel" i], [class*="status" i], svg')) {
                        container = p;
                        break;
                    }
                    p = p.parentElement;
                }
            }
            if (!container) container = link.parentElement;

            const { isHosp, isFlying, isJail } = checkPlayerStatus(container);

            if (hideHosp && isHosp) return;
            if (hideFlying && isFlying) return;
            if (isJail) return;

            const name = (link.innerText || `Player #${playerId}`).trim();
            candidates.push({ playerId, name, isHosp, isFlying });
        });

        return candidates;
    }

    // ── Scan Current Page Roster & Populate Snipe Queue ──
    async function scanAndQueueTargets() {
        const candidateList = extractPageCandidates();
        if (candidateList.length === 0) {
            updateSnipeButtonUI();
            return;
        }

        await fetchFFStats(candidateList.map(c => c.playerId));

        const valid = candidateList.filter(c => {
            const cached = playerCache.get(c.playerId);
            if (!cached) return ffTierLimit === 'all';
            return cached.ff !== null ? isWithinTierLimit(cached.ff) : (ffTierLimit === 'all');
        });

        valid.sort((a, b) => {
            const ffA = playerCache.get(a.playerId)?.ff ?? 99;
            const ffB = playerCache.get(b.playerId)?.ff ?? 99;
            return ffA - ffB;
        });

        currentValidTargets = valid;

        try {
            sessionStorage.setItem(SESSION_QUEUE, JSON.stringify(valid.map(v => v.playerId)));
        } catch(e) {}

        updateSnipeButtonUI();
    }

    // ── Live Active Target Finder (Works Anywhere on Torn & Pre-Elimination) ──
    async function findLiveActiveTarget() {
        if (!apiKey) return null;

        try {
            const res = await fetch(`https://api.torn.com/torn/?selections=bounties&key=${encodeURIComponent(apiKey)}`);
            const data = await res.json();
            let candidateIds = [];

            if (data && data.bounties) {
                for (const [k, v] of Object.entries(data.bounties)) {
                    const tid = (v && v.target_id) ? String(v.target_id) : String(k);
                    if (tid && tid !== '0' && tid !== myPlayerId) {
                        candidateIds.push(tid);
                    }
                }
            }

            if (candidateIds.length === 0) {
                candidateIds = ['4', '15', '16', '77', '100', '200']; // Duke NPC & early active targets
            }

            candidateIds = [...new Set(candidateIds)].slice(0, 30);
            await fetchFFStats(candidateIds);

            const valid = candidateIds.filter(id => {
                const cached = playerCache.get(id);
                if (!cached) return ffTierLimit === 'all';
                return cached.ff !== null ? isWithinTierLimit(cached.ff) : (ffTierLimit === 'all');
            });

            valid.sort((a, b) => {
                const ffA = playerCache.get(a)?.ff ?? 99;
                const ffB = playerCache.get(b)?.ff ?? 99;
                return ffA - ffB;
            });

            // Quick live status verification via profile endpoint
            for (const candId of valid.slice(0, 5)) {
                try {
                    const profRes = await fetch(`https://api.torn.com/user/${candId}?selections=profile&key=${encodeURIComponent(apiKey)}`);
                    const prof = await profRes.json();
                    if (prof && prof.status) {
                        const state = (prof.status.state || '').toLowerCase();
                        if (hideHosp && state === 'hospital') continue;
                        if (hideFlying && (state === 'traveling' || state === 'abroad')) continue;
                        if (state === 'jail' || state === 'federal') continue;
                        return { playerId: candId, name: prof.name || `Target #${candId}` };
                    }
                } catch(e) {}
            }

            if (valid.length > 0) {
                return { playerId: valid[0], name: `Target #${valid[0]}` };
            }

        } catch (err) {
            console.error('[Elim Hunter] Live target search error:', err);
        }

        return null;
    }

    // ── Auto-Sync Competition Rosters to Website Backend ──
    function autoSyncCompetitionRosters() {
        if (!window.location.href.includes('competition.php')) return;

        const profileLinks = document.querySelectorAll('a[href*="profiles.php?XID="], a[href*="profiles.php?xid="]');
        if (!profileLinks || profileLinks.length === 0) return;

        const members = [];
        const seen = new Set();
        profileLinks.forEach(link => {
            const m = link.href.match(/xid=(\d+)/i);
            if (m && !seen.has(m[1]) && m[1] !== myPlayerId) {
                seen.add(m[1]);
                members.push({ id: m[1], name: (link.innerText || '').trim() });
            }
        });

        if (members.length > 0) {
            fetch('https://spider-verse.net/api/elim/sync-roster', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teamName: 'elim_competition_pool', members })
            }).catch(() => {});
        }
    }

    // ── 1-CLICK INSTANT SNIPE ACTION (Connected to Website Backend) ──
    async function executeSnipe() {
        const snipeBtn = document.getElementById('elim-snipe-main-btn');
        if (!snipeBtn) return;

        if (!apiKey) {
            snipeBtn.innerText = '⚙️ Enter API Key First!';
            snipeBtn.style.background = '#e67e22';
            const drawer = document.getElementById('elim-snipe-drawer');
            if (drawer) {
                drawer.style.display = 'block';
                const input = document.getElementById('elim-input-key');
                if (input) {
                    input.focus();
                    input.style.borderColor = '#ff4757';
                }
            }
            return;
        }

        snipeBtn.innerText = '⚡ HUNTING TARGET...';
        snipeBtn.style.background = '#0984e3';

        try {
            // 1. Pop from session queue if chaining multiple attacks
            let queue = [];
            try {
                queue = JSON.parse(sessionStorage.getItem(SESSION_QUEUE) || '[]');
            } catch(e) { queue = []; }

            queue = queue.filter(id => id && String(id).length > 0);

            if (queue.length > 0) {
                const targetId = queue.shift();
                sessionStorage.setItem(SESSION_QUEUE, JSON.stringify(queue));
                launchAttack(targetId);
                return;
            }

            // 2. PRIMARY: Ask the website backend (spider-verse.net) to find the best beatable live target!
            let targetId = null;

            try {
                const queryParams = new URLSearchParams({
                    apiKey: apiKey,
                    tier: ffTierLimit,
                    hideHosp: hideHosp ? 'true' : 'false',
                    hideFlying: hideFlying ? 'true' : 'false',
                    myStats: myTotalStats ? String(myTotalStats) : '',
                    myId: myPlayerId ? String(myPlayerId) : ''
                });

                const res = await fetch(`https://spider-verse.net/api/elim/snipe?${queryParams.toString()}`, {
                    signal: AbortSignal.timeout(8000)
                });
                const data = await res.json();

                if (data && data.success && data.targetId) {
                    targetId = data.targetId;
                } else if (data && data.message) {
                    snipeBtn.innerText = `⚠️ ${data.message}`;
                    snipeBtn.style.background = '#e74c3c';
                    setTimeout(() => updateSnipeButtonUI(), 3000);
                    return;
                }
            } catch (backendErr) {
                console.warn('[Elim Hunter] Server fetch timed out or unavailable, using local fallback:', backendErr);
            }

            // 3. Fallback: If backend was unreachable, scan current page candidates
            if (!targetId) {
                const pageCandidates = extractPageCandidates();
                if (pageCandidates.length > 0) {
                    snipeBtn.innerText = `🔍 Checking ${pageCandidates.length} targets...`;
                    const ids = pageCandidates.map(c => c.playerId);
                    await fetchFFStats(ids);

                    const valid = pageCandidates.filter(c => {
                        const cached = playerCache.get(c.playerId);
                        if (!cached) return ffTierLimit === 'all';
                        return cached.ff !== null ? isWithinTierLimit(cached.ff) : (ffTierLimit === 'all');
                    });

                    valid.sort((a, b) => {
                        const ffA = playerCache.get(a.playerId)?.ff ?? 99;
                        const ffB = playerCache.get(b.playerId)?.ff ?? 99;
                        return ffA - ffB;
                    });

                    if (valid.length > 0) {
                        targetId = valid[0].playerId;
                        const rest = valid.slice(1).map(v => v.playerId);
                        sessionStorage.setItem(SESSION_QUEUE, JSON.stringify(rest));
                    }
                }
            }

            // 4. Emergency fallback: Query live bounties
            if (!targetId) {
                const liveTarget = await findLiveActiveTarget();
                if (liveTarget) targetId = liveTarget.playerId;
            }

            if (targetId) {
                launchAttack(targetId);
                return;
            }

            snipeBtn.innerText = '⚠️ No Match (Try Higher Tier)';
            snipeBtn.style.background = '#e74c3c';
            setTimeout(() => updateSnipeButtonUI(), 2500);

        } catch (err) {
            console.error('[Elim Hunter] Snipe error:', err);
            snipeBtn.innerText = '⚠️ Error Finding Target';
            snipeBtn.style.background = '#e74c3c';
            setTimeout(() => updateSnipeButtonUI(), 2500);
        }
    }

    function launchAttack(targetId) {
        const snipeBtn = document.getElementById('elim-snipe-main-btn');
        if (snipeBtn) {
            snipeBtn.innerText = '⚡ SNIPING...';
            snipeBtn.style.background = '#2ed573';
        }
        window.location.href = `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`;
    }

    // ── Update Button UI Text ──
    function updateSnipeButtonUI() {
        const snipeBtn = document.getElementById('elim-snipe-main-btn');
        if (!snipeBtn) return;

        const isAttackPage = window.location.href.includes('page.php?sid=attack') || window.location.href.includes('loader.php?sid=attack');
        let queueCount = 0;
        try {
            queueCount = JSON.parse(sessionStorage.getItem(SESSION_QUEUE) || '[]').length;
        } catch(e) {}

        const count = currentValidTargets.length || queueCount;

        if (isAttackPage) {
            snipeBtn.innerText = count > 0 ? `⚔️ NEXT TARGET (${count} left)` : `⚔️ NEXT TARGET`;
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

        drawer.querySelector('#elim-save-settings-btn').onclick = async () => {
            apiKey = document.querySelector('#elim-input-key').value.trim();
            ffTierLimit = document.querySelector('#elim-select-tier').value;
            hideHosp = document.querySelector('#elim-chk-hosp').checked;
            hideFlying = document.querySelector('#elim-chk-fly').checked;

            setStored(KEY_API_KEY, apiKey);
            setStored(KEY_FF_TIER, ffTierLimit);
            setStored(KEY_HIDE_HOSP, hideHosp);
            setStored(KEY_HIDE_FLYING, hideFlying);

            const saveBtn = drawer.querySelector('#elim-save-settings-btn');
            saveBtn.innerText = '⏳ Verifying Key...';

            await fetchMyBattleStats();

            saveBtn.innerText = '✅ Saved & Connected!';
            saveBtn.style.background = '#2ed573';
            setTimeout(() => {
                saveBtn.innerText = '💾 Save Settings';
                drawer.style.display = 'none';
            }, 1000);

            playerCache.clear();
            scanAndQueueTargets();
        };

        // Test Snipe Button: Demonstrates immediate redirect to attack page
        drawer.querySelector('#elim-test-snipe-btn').onclick = () => {
            drawer.style.display = 'none';
            // Pick Duke NPC (ID 4) for instant test
            window.location.href = `https://www.torn.com/page.php?sid=attack&user2ID=4`;
        };
    }

    function init() {
        createSnipeWidget();
        scanAndQueueTargets();
        autoSyncCompetitionRosters();

        const observer = new MutationObserver(() => {
            clearTimeout(scanTimeout);
            scanTimeout = setTimeout(() => {
                scanAndQueueTargets();
                autoSyncCompetitionRosters();
            }, 600);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 700);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(init, 700));
    }
})();
