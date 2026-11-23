'use strict';

/**
 * Package D: Persistent Custom Sniper Watchlist (Peace & War Target Tracking)
 *
 * Allows fighters/leadership to pin arbitrary Torn targets outside active Ranked Wars
 * for instant alerts on flight landing, hospital discharge, or coming online.
 * Strictly isolated per factionId and persisted to disk + MongoDB.
 */

const fs = require('fs');
const path = require('path');

let UI = null;
try { UI = require('./friday-ui'); } catch (_) {}

const EVENT_COOLDOWN_MS = 3 * 60 * 1000;

function extractTornId(rawInput) {
    const str = String(rawInput || '').trim();
    if (!str) return null;
    const xidMatch = str.match(/XID=(\d{3,10})/i);
    if (xidMatch) return xidMatch[1];
    const bracketMatch = str.match(/\[(\d{3,10})\]/);
    if (bracketMatch) return bracketMatch[1];
    const digitsMatch = str.match(/\b(\d{3,10})\b/);
    if (digitsMatch) return digitsMatch[1];
    return null;
}

function classifyTornStatus(statusObj = {}) {
    const rawState = String(statusObj.state || 'Okay').trim();
    const desc = String(statusObj.description || rawState || 'Okay').trim();
    const descLower = desc.toLowerCase();
    let state = rawState || 'Okay';
    if (state === 'Traveling' || descLower.includes('traveling') || descLower.includes('returning to torn')) state = 'Traveling';
    else if (state === 'Abroad' || descLower.includes(' in ') && !descLower.includes('hospital') && !descLower.includes('jail')) state = 'Abroad';
    else if (state === 'Hospital' || descLower.includes('hospital')) state = 'Hospital';
    else if (state === 'Jail' || descLower.includes('jail')) state = 'Jail';
    else if (descLower.includes('federal')) state = 'Federal';
    return { state, description: desc, until: Number(statusObj.until || 0) };
}

function evaluateWatchTargetTransition(prevEntry = {}, liveProfile = {}, nowMs = Date.now()) {
    const st = classifyTornStatus(liveProfile.status || {});
    const online = String(liveProfile.last_action?.status || liveProfile.onlineStatus || 'Offline');
    const prevState = prevEntry.lastState || null;
    const prevOnline = prevEntry.lastOnline || null;
    const alertOn = Array.isArray(prevEntry.alertOn) && prevEntry.alertOn.length > 0
        ? prevEntry.alertOn
        : ['landed', 'out_hosp', 'online'];

    const events = [];
    const nextMeta = {
        lastState: st.state,
        lastDesc: st.description,
        lastUntil: st.until,
        lastOnline: online,
        lastCheckedAt: nowMs,
        lastLandedTs: prevEntry.lastLandedTs || 0,
        lastOutHospTs: prevEntry.lastOutHospTs || 0,
        lastOnlineTs: prevEntry.lastOnlineTs || 0
    };

    if (prevState) {
        // 1. Flight Landing (was Traveling or Abroad -> now Okay)
        const wasFlying = prevState === 'Traveling' || prevState === 'Abroad';
        if (wasFlying && st.state === 'Okay' && alertOn.includes('landed')) {
            if (nowMs - (prevEntry.lastLandedTs || 0) >= EVENT_COOLDOWN_MS) {
                nextMeta.lastLandedTs = nowMs;
                events.push({
                    kind: 'landed',
                    title: `🛬 Watchlist Target Landed: ${liveProfile.name || prevEntry.name}`,
                    desc: `Returned safely to **Torn** and is now **🟢 Okay** & attackable!`
                });
            }
        }

        // 2. Out of Hospital (was Hospital -> now Okay)
        if (prevState === 'Hospital' && st.state === 'Okay' && alertOn.includes('out_hosp')) {
            if (nowMs - (prevEntry.lastOutHospTs || 0) >= EVENT_COOLDOWN_MS) {
                nextMeta.lastOutHospTs = nowMs;
                events.push({
                    kind: 'out_hosp',
                    title: `🏥 Watchlist Target Out of Hospital: ${liveProfile.name || prevEntry.name}`,
                    desc: `Left hospital early/on timer — currently **🟢 Okay** & open to attack!`
                });
            }
        }

        // 3. Came Online while Okay
        const wasOffline = prevOnline === 'Offline' || prevOnline === 'Idle';
        if (wasOffline && online === 'Online' && st.state === 'Okay' && alertOn.includes('online')) {
            if (nowMs - (prevEntry.lastOnlineTs || 0) >= EVENT_COOLDOWN_MS) {
                nextMeta.lastOnlineTs = nowMs;
                events.push({
                    kind: 'online',
                    title: `🟢 Watchlist Target Came Online: ${liveProfile.name || prevEntry.name}`,
                    desc: `Status flipped to **Online** while in **🟢 Okay** state.`
                });
            }
        }
    }

    return { events, nextMeta };
}

function buildWatchlistAlertEmbed(targetEntry, eventInfo, bsInfo = null) {
    const tid = String(targetEntry.targetId);
    const name = targetEntry.name || `Player [${tid}]`;
    const attackUrl = `https://www.torn.com/loader.php?sid=attack&user2ID=${tid}`;
    const profileUrl = `https://www.torn.com/profiles.php?XID=${tid}`;

    const fields = [
        {
            name: '🎯 Target',
            value: `**[${name} [${tid}]](${profileUrl})**\nLv \`${targetEntry.level || '?'}\` • ${targetEntry.factionName || 'No Faction'}`,
            inline: true
        },
        {
            name: '📡 Live Status',
            value: `**${targetEntry.lastState || 'Okay'}** (${targetEntry.lastOnline || 'Unknown'})\n${targetEntry.note ? `📝 *${targetEntry.note}*` : 'No note'}`,
            inline: true
        }
    ];

    if (bsInfo && bsInfo.total > 0) {
        fields.push({
            name: '💪 Est. Battle Stats',
            value: `\`${Number(bsInfo.total).toLocaleString()}\` (${bsInfo.isConfirmed ? 'Verified' : 'Est.'})`,
            inline: true
        });
    }

    const color = eventInfo.kind === 'landed'
        ? (UI ? UI.COLORS.GOLD : 0xF0B232)
        : (UI ? UI.COLORS.RED : 0xE74C3C);

    const embed = UI
        ? UI.embed({
            color,
            title: UI.ensureBrand(eventInfo.title),
            description: eventInfo.desc,
            fields
        })
        : { title: eventInfo.title, description: eventInfo.desc, color, fields, timestamp: new Date().toISOString() };

    embed.links = [
        { label: '⚔️ Attack Now', url: attackUrl },
        { label: '👤 Torn Profile', url: profileUrl }
    ];
    embed.components = [{
        type: 1,
        components: [
            { type: 2, style: 5, label: '⚔️ Attack Now', url: attackUrl },
            { type: 2, style: 5, label: '👤 Torn Profile', url: profileUrl }
        ]
    }];
    return embed;
}

function buildWatchlistListEmbed(factionName, targets = []) {
    const title = `🎯 Custom Sniper Watchlist — ${factionName || 'Faction'} (${targets.length})`;
    if (!targets.length) {
        return UI
            ? UI.info(title, 'No targets are currently pinned to your faction watchlist.\nUse `/watch add target:<id> note:<text>` or the **Live Warboard** drawer to pin targets.')
            : { title, description: 'No pinned watchlist targets.', color: 0x3498DB };
    }

    const lines = targets.slice(0, 20).map(t => {
        const icon = t.lastState === 'Okay' ? '🟢' : (t.lastState === 'Hospital' ? '🔴' : (t.lastState === 'Traveling' || t.lastState === 'Abroad' ? '✈️' : '⚫'));
        const noteTxt = t.note ? ` — *${t.note}*` : '';
        return `${icon} **[${t.name || `Player [${t.targetId}]`} [${t.targetId}]](https://www.torn.com/loader.php?sid=attack&user2ID=${t.targetId})** (Lv ${t.level || '?'}) • \`${t.lastState || 'Pending'}\`${noteTxt}`;
    });

    const embed = UI
        ? UI.teal(title, lines.join('\n'))
        : { title, description: lines.join('\n'), color: 0x1ABC9C };
    embed.components = [{
        type: 1,
        components: [{ type: 2, style: 5, label: '🎯 Manage on Warboard', url: 'https://faction-os.duckdns.org/#watchlist-drawer' }]
    }];
    return embed;
}

function createSniperWatchlistEngine(deps = {}) {
    const dataDir = deps.dataDir || path.join(__dirname, 'data');
    const storeFile = path.join(dataDir, 'sniper_watchlist.json');

    let byFaction = {}; // { [facId]: { [targetId]: entry } }
    try {
        if (fs.existsSync(storeFile)) {
            byFaction = JSON.parse(fs.readFileSync(storeFile, 'utf8')) || {};
        }
    } catch (e) {
        console.warn('[SniperWatchlist] Failed loading watchlist file:', e.message);
    }

    function save() {
        try {
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(storeFile, JSON.stringify(byFaction, null, 2), 'utf8');
        } catch (e) {
            console.warn('[SniperWatchlist] Failed saving watchlist file:', e.message);
        }
        if (typeof deps.onStateChange === 'function') {
            try { deps.onStateChange(); } catch (_) {}
        }
    }

    function exportState() {
        return byFaction;
    }

    function importState(saved) {
        if (saved && typeof saved === 'object') {
            byFaction = { ...byFaction, ...saved };
        }
    }

    function listTargets(factionId) {
        const fid = String(factionId || '52355').trim();
        const map = byFaction[fid] || {};
        const arr = Object.values(map).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        return arr.map(t => {
            const bs = typeof deps.resolvePlayerBattleStats === 'function'
                ? deps.resolvePlayerBattleStats(t.targetId, t.level || 0)
                : null;
            return {
                ...t,
                estStats: bs?.total || t.estStats || 0,
                statsConfirmed: Boolean(bs?.isConfirmed)
            };
        });
    }

    async function addTarget(factionId, rawTarget, options = {}, apiKey = null) {
        const fid = String(factionId || '52355').trim();
        const tid = extractTornId(rawTarget);
        if (!tid) {
            throw new Error('Provide a valid numeric Torn Player ID or XID link (e.g. 3776908).');
        }

        if (!byFaction[fid]) byFaction[fid] = {};
        const existing = byFaction[fid][tid] || {};
        let liveProfile = null;

        const keyToUse = apiKey || deps.getFallbackApiKey?.(fid) || null;
        if (keyToUse) {
            try {
                const res = await fetch(`https://api.torn.com/user/${tid}?selections=profile&key=${encodeURIComponent(keyToUse)}`, {
                    signal: AbortSignal.timeout(6000)
                });
                const json = await res.json();
                if (json && json.player_id) liveProfile = json;
            } catch (_) {}
        }

        const st = liveProfile ? classifyTornStatus(liveProfile.status || {}) : null;
        const entry = {
            targetId: tid,
            name: liveProfile?.name || existing.name || options.name || `Player [${tid}]`,
            level: Number(liveProfile?.level || existing.level || options.level || 0),
            factionName: liveProfile?.faction?.faction_name || existing.factionName || '',
            note: options.note !== undefined ? String(options.note).slice(0, 120).trim() : (existing.note || ''),
            alertOn: Array.isArray(options.alertOn) && options.alertOn.length > 0
                ? options.alertOn
                : (existing.alertOn || ['landed', 'out_hosp', 'online']),
            addedBy: options.addedBy || existing.addedBy || 'Faction Member',
            addedAt: existing.addedAt || Date.now(),
            lastState: st?.state || existing.lastState || null,
            lastDesc: st?.description || existing.lastDesc || null,
            lastUntil: st?.until || existing.lastUntil || 0,
            lastOnline: liveProfile?.last_action?.status || existing.lastOnline || null,
            lastCheckedAt: liveProfile ? Date.now() : (existing.lastCheckedAt || 0),
            lastLandedTs: existing.lastLandedTs || 0,
            lastOutHospTs: existing.lastOutHospTs || 0,
            lastOnlineTs: existing.lastOnlineTs || 0
        };

        byFaction[fid][tid] = entry;
        save();
        return entry;
    }

    function removeTarget(factionId, rawTarget) {
        const fid = String(factionId || '52355').trim();
        const tid = extractTornId(rawTarget) || String(rawTarget || '').trim();
        if (!tid || !byFaction[fid] || !byFaction[fid][tid]) return false;
        const removed = byFaction[fid][tid];
        delete byFaction[fid][tid];
        save();
        return removed;
    }

    let isPolling = false;
    async function pollAllWatchlists() {
        if (isPolling) return { skipped: true };
        if (typeof deps.isNotificationsPaused === 'function' && deps.isNotificationsPaused()) {
            return { skipped: true, reason: 'paused' };
        }
        isPolling = true;
        let checked = 0;
        let alertsSent = 0;

        try {
            for (const [fid, targetMap] of Object.entries(byFaction)) {
                const entries = Object.values(targetMap || {});
                if (entries.length === 0) continue;

                const apiKey = deps.getFactionApiKey?.(fid) || deps.getFallbackApiKey?.(fid) || null;
                if (!apiKey) continue;

                for (const entry of entries) {
                    try {
                        const res = await fetch(`https://api.torn.com/user/${entry.targetId}?selections=profile&key=${encodeURIComponent(apiKey)}`, {
                            signal: AbortSignal.timeout(6000)
                        });
                        const live = await res.json();
                        if (!live || live.error || !live.player_id) continue;

                        entry.name = live.name || entry.name;
                        entry.level = Number(live.level || entry.level);
                        if (live.faction?.faction_name !== undefined) entry.factionName = live.faction.faction_name || '';

                        const { events, nextMeta } = evaluateWatchTargetTransition(entry, live, Date.now());
                        Object.assign(entry, nextMeta);
                        checked++;

                        if (events.length > 0 && typeof deps.dispatchWatchAlert === 'function') {
                            const bs = typeof deps.resolvePlayerBattleStats === 'function'
                                ? deps.resolvePlayerBattleStats(entry.targetId, entry.level)
                                : null;
                            for (const ev of events) {
                                const embed = buildWatchlistAlertEmbed(entry, ev, bs);
                                await deps.dispatchWatchAlert(fid, embed, ev, entry).catch(() => {});
                                alertsSent++;
                            }
                        }
                    } catch (_) {}
                    await new Promise(r => setTimeout(r, 120));
                }
            }
            if (checked > 0) save();
            return { skipped: false, checked, alertsSent };
        } finally {
            isPolling = false;
        }
    }

    return {
        extractTornId,
        evaluateWatchTargetTransition,
        buildWatchlistAlertEmbed,
        buildWatchlistListEmbed,
        listTargets,
        addTarget,
        removeTarget,
        pollAllWatchlists,
        exportState,
        importState
    };
}

module.exports = {
    extractTornId,
    classifyTornStatus,
    evaluateWatchTargetTransition,
    buildWatchlistAlertEmbed,
    buildWatchlistListEmbed,
    createSniperWatchlistEngine
};
