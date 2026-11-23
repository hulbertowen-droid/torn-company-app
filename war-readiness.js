'use strict';

/**
 * Package A: Pre-War Energy Stacking & Booster Readiness Engine
 *
 * Evaluates faction-wide stacked energy (1000e max stack, >=750e war ready, building, unstacked),
 * booster cooldown readiness (0:00), drug cooldown readiness, travel/hospital blockers,
 * and dangerous public Revive settings ("Everyone") ahead of Ranked Wars.
 */

const fs = require('fs');
const path = require('path');

let UI = null;
try { UI = require('./friday-ui'); } catch (_) {}

const DEFAULT_PREWAR_CHECKPOINTS = [12, 4, 1]; // T-12h, T-4h, T-1h

function formatDurationCompact(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    if (s <= 0) return '00:00';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const remS = s % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${String(m).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
}

function normalizeReviveSetting(rawVal, isRevivableBool = null) {
    if (typeof isRevivableBool === 'boolean' && rawVal === undefined) {
        return {
            setting: isRevivableBool ? 'Everyone' : 'No One',
            isPublic: isRevivableBool
        };
    }
    const str = String(rawVal ?? '').toLowerCase().trim();
    const num = (rawVal !== '' && rawVal !== null && rawVal !== undefined && !isNaN(rawVal)) ? Number(rawVal) : null;

    if (str === 'everyone' || str === '0' || num === 0) {
        return { setting: 'Everyone', isPublic: true };
    }
    if (str.includes('friend') || str.includes('faction') || str === '1' || num === 1) {
        return { setting: 'Friends & Faction', isPublic: false };
    }
    if (str === 'no one' || str === 'nobody' || str === 'none' || str === 'off' || str === '2' || num === 2) {
        return { setting: 'No One', isPublic: false };
    }
    if (isRevivableBool === true) {
        return { setting: 'Everyone', isPublic: true };
    }
    if (isRevivableBool === false) {
        return { setting: 'No One', isPublic: false };
    }
    return { setting: 'Unknown', isPublic: false };
}

function inferXanaxFallback(current, maximum) {
    const excess = Math.max(0, current - maximum);
    if (current <= maximum) return { isStacked: false, minXanaxFromEnergy: 0, exactBaseE: current };
    const minXan = Math.ceil(excess / 250);
    return {
        isStacked: true,
        minXanaxFromEnergy: minXan,
        exactBaseE: Math.max(0, current - minXan * 250)
    };
}

function evaluateMemberReadiness(memberInfo = {}, bRec = null, nowMs = Date.now(), options = {}) {
    const targetEnergy = Math.max(250, Number(options.targetEnergy) || 750);
    const computeFn = typeof options.computeEnergyXanaxInference === 'function'
        ? options.computeEnergyXanaxInference
        : null;

    const playerId = Number(memberInfo.id || memberInfo.playerId || bRec?.playerId || 0);
    const playerName = String(memberInfo.name || memberInfo.playerName || bRec?.playerName || `Player [${playerId}]`).trim();
    const level = Number(memberInfo.level || bRec?.level || 1);

    const statusObj = (memberInfo.status && typeof memberInfo.status === 'object')
        ? memberInfo.status
        : { state: memberInfo.state || 'Okay', description: memberInfo.statusDescription || memberInfo.state || 'Okay', until: memberInfo.until || 0 };

    const rawState = String(statusObj.state || 'Okay').trim();
    const descStr = String(statusObj.description || rawState || 'Okay').trim();
    const descLower = descStr.toLowerCase();

    let statusState = rawState || 'Okay';
    if (rawState === 'Traveling' || descLower.includes('traveling') || descLower.includes('returning to torn')) {
        statusState = 'Traveling';
    } else if (rawState === 'Abroad' || descLower.includes(' in ') && !descLower.includes('hospital') && !descLower.includes('jail')) {
        statusState = 'Abroad';
    } else if (rawState === 'Hospital' || descLower.includes('hospital')) {
        statusState = 'Hospital';
    } else if (rawState === 'Jail' || descLower.includes('jail')) {
        statusState = rawState === 'Federal' || descLower.includes('federal') ? 'Federal' : 'Jail';
    }

    const isAbroadOrTraveling = (statusState === 'Traveling' || statusState === 'Abroad');
    const isHospital = (statusState === 'Hospital');
    const statusUntil = Number(statusObj.until || 0);
    const onlineStatus = String(memberInfo.last_action?.status || memberInfo.onlineStatus || 'Offline');

    const reviveInfo = normalizeReviveSetting(memberInfo.revive_setting, memberInfo.is_revivable);

    const le = bRec?.liveEnergy || null;
    const hasValidEnergy = Boolean(le && (!le.status || le.status === 'ok') && typeof le.current === 'number');

    let energyCurrent = null;
    let energyMax = null;
    let excessEnergy = null;
    let minXanaxFromEnergy = null;
    let boosterCdSec = null;
    let boosterReady = null;
    let refillUsed = null;
    let trackingStatus = le?.status || 'unlinked';
    let lastCheckedAt = le?.lastCheckedAt || null;

    if (hasValidEnergy) {
        energyCurrent = Math.max(0, Number(le.current));
        energyMax = Math.max(50, Number(le.maximum) || 150);
        if (typeof le.boosterCooldownEndsAt === 'number') {
            boosterCdSec = le.boosterCooldownEndsAt > nowMs
                ? Math.max(1, Math.ceil((le.boosterCooldownEndsAt - nowMs) / 1000))
                : 0;
        } else if (typeof le.boosterCooldownSec === 'number') {
            const elapsed = le.lastCheckedAt ? Math.max(0, Math.floor((nowMs - le.lastCheckedAt) / 1000)) : 0;
            boosterCdSec = Math.max(0, Number(le.boosterCooldownSec) - elapsed);
        }
        boosterReady = (typeof boosterCdSec === 'number') ? (boosterCdSec === 0) : null;
        refillUsed = typeof le.refillUsed === 'boolean' ? le.refillUsed : null;

        const inf = computeFn
            ? computeFn(le, boosterCdSec, refillUsed)
            : inferXanaxFallback(energyCurrent, energyMax);
        excessEnergy = Math.max(0, energyCurrent - energyMax);
        minXanaxFromEnergy = inf.minXanaxFromEnergy ?? 0;
        trackingStatus = 'ok';
    }

    // Live Drug Cooldown calculation
    const dc = bRec?.drugCooldown || null;
    let drugCdSec = null;
    let drugReady = null;
    if (dc && typeof dc.lastCheckedAt === 'number') {
        if (dc.active && dc.cooldownEndsAt && dc.cooldownEndsAt > nowMs) {
            drugCdSec = Math.max(1, Math.ceil((dc.cooldownEndsAt - nowMs) / 1000));
            drugReady = false;
        } else {
            drugCdSec = 0;
            drugReady = true;
        }
    }

    let stackTier = 'untracked';
    if (hasValidEnergy) {
        if (energyCurrent >= 1000) {
            stackTier = 'max_stack';
        } else if (energyCurrent >= targetEnergy) {
            stackTier = 'war_ready';
        } else if (energyCurrent > energyMax) {
            stackTier = 'building';
        } else {
            stackTier = 'unstacked';
        }
    }

    // Determine actionable warnings
    const warnings = [];
    if (hasValidEnergy && energyCurrent < targetEnergy) {
        warnings.push(`Low Stack (${energyCurrent}e < ${targetEnergy}e)`);
    }
    if (isAbroadOrTraveling) {
        warnings.push(statusState === 'Abroad' ? 'Abroad' : 'Flying');
    }
    if (reviveInfo.isPublic) {
        warnings.push('Revives: Everyone');
    }
    if (isHospital) {
        warnings.push('In Hospital');
    }

    return {
        playerId,
        playerName,
        level,
        onlineStatus,
        statusState,
        statusDesc: descStr,
        statusUntil,
        isAbroadOrTraveling,
        isHospital,
        reviveSetting: reviveInfo.setting,
        revivesPublicWarning: reviveInfo.isPublic,
        tracked: hasValidEnergy,
        trackingStatus,
        stackTier,
        energyCurrent,
        energyMax,
        excessEnergy,
        minXanaxFromEnergy,
        boosterCdSec,
        boosterReady,
        drugCdSec,
        drugReady,
        refillUsed,
        lastCheckedAt,
        warnings
    };
}

function buildWarReadinessSummary(rosterMembers, battleStatsHistory = {}, upcomingWar = null, options = {}) {
    const nowMs = Number(options.nowMs) || Date.now();
    const targetEnergy = Math.max(250, Number(options.targetEnergy) || 750);
    const factionId = String(options.factionId || '').trim();
    const factionName = String(options.factionName || (factionId ? `Faction [${factionId}]` : 'Faction')).trim();

    const list = Array.isArray(rosterMembers)
        ? rosterMembers
        : Object.entries(rosterMembers || {}).map(([id, m]) => ({ id: Number(m?.id || id), ...(m || {}) }));

    const evaluated = [];
    const counts = {
        totalRoster: list.length,
        linkedTracked: 0,
        maxStack1000: 0,
        warReady750Plus: 0,
        building: 0,
        unstacked: 0,
        untracked: 0,
        boosterReady: 0,
        drugReady: 0,
        travelingOrAbroad: 0,
        inHospital: 0,
        revivesEveryone: 0
    };

    let totalStackedEnergy = 0;

    for (const rawM of list) {
        const pid = Number(rawM.id || rawM.playerId || 0);
        if (!pid) continue;
        const bRec = battleStatsHistory[String(pid)] || null;
        const m = evaluateMemberReadiness(rawM, bRec, nowMs, {
            targetEnergy,
            computeEnergyXanaxInference: options.computeEnergyXanaxInference
        });
        evaluated.push(m);

        if (m.tracked) {
            counts.linkedTracked++;
            totalStackedEnergy += m.energyCurrent;
            if (m.stackTier === 'max_stack') {
                counts.maxStack1000++;
                counts.warReady750Plus++;
            } else if (m.stackTier === 'war_ready') {
                counts.warReady750Plus++;
            } else if (m.stackTier === 'building') {
                counts.building++;
            } else {
                counts.unstacked++;
            }
            if (m.boosterReady === true) counts.boosterReady++;
            if (m.drugReady === true) counts.drugReady++;
        } else {
            counts.untracked++;
        }

        if (m.isAbroadOrTraveling) counts.travelingOrAbroad++;
        if (m.isHospital) counts.inHospital++;
        if (m.revivesPublicWarning) counts.revivesEveryone++;
    }

    const tierRank = { max_stack: 0, war_ready: 1, building: 2, unstacked: 3, untracked: 4 };
    evaluated.sort((a, b) => {
        const rDiff = (tierRank[a.stackTier] ?? 9) - (tierRank[b.stackTier] ?? 9);
        if (rDiff !== 0) return rDiff;
        const eDiff = (b.energyCurrent ?? -1) - (a.energyCurrent ?? -1);
        if (eDiff !== 0) return eDiff;
        return a.playerName.localeCompare(b.playerName);
    });

    const avgStackedEnergy = counts.linkedTracked > 0
        ? Math.round(totalStackedEnergy / counts.linkedTracked)
        : 0;

    const actionNeededMembers = evaluated.filter(m =>
        (m.tracked && m.energyCurrent < targetEnergy) || m.isAbroadOrTraveling || m.revivesPublicWarning
    );

    const readyPct = counts.linkedTracked > 0
        ? Math.round((counts.warReady750Plus / counts.linkedTracked) * 100)
        : 0;

    return {
        success: true,
        factionId,
        factionName,
        targetEnergy,
        generatedAt: nowMs,
        upcomingWar: upcomingWar || null,
        readyPct,
        totalStackedEnergy,
        avgStackedEnergy,
        counts,
        actionNeededCount: actionNeededMembers.length,
        members: evaluated
    };
}

function buildWarReadinessEmbed(summary, options = {}) {
    const c = summary.counts || {};
    const targetE = summary.targetEnergy || 750;
    const publicUrl = String(options.publicUrl || 'https://faction-os.duckdns.org').replace(/\/+$/, '');
    const war = summary.upcomingWar;

    let warStatusLine = '🛡️ **Peacetime Standby** — No scheduled Ranked War detected yet.';
    if (war && war.start) {
        const nowSec = Math.floor((summary.generatedAt || Date.now()) / 1000);
        const diffSec = war.start - nowSec;
        const enemyTag = war.enemyName ? ` vs **${war.enemyName}**` : '';
        if (diffSec > 0) {
            warStatusLine = `⚔️ **Upcoming Ranked War**${enemyTag} • Starts <t:${war.start}:R> (<t:${war.start}:F>)`;
        } else {
            warStatusLine = `🔥 **ACTIVE RANKED WAR**${enemyTag} • Started <t:${war.start}:R>`;
        }
    }

    const trackedDenom = Math.max(1, c.linkedTracked || 0);
    const barBlocks = Math.round(((c.warReady750Plus || 0) / trackedDenom) * 10);
    const progressBar = '🟩'.repeat(Math.max(0, Math.min(10, barBlocks))) + '⬛'.repeat(Math.max(0, 10 - Math.min(10, barBlocks)));

    const topStacked = (summary.members || [])
        .filter(m => m.tracked && m.energyCurrent >= targetE)
        .slice(0, 10)
        .map(m => {
            const boostTxt = m.boosterReady ? ' ⚡CanReady' : (typeof m.boosterCdSec === 'number' ? ` ⏳${formatDurationCompact(m.boosterCdSec)}` : '');
            const revWarn = m.revivesPublicWarning ? ' ⚠️RevAll' : '';
            const flyWarn = m.isAbroadOrTraveling ? ` ✈️${m.statusState}` : '';
            return `• **${m.playerName}** — \`${m.energyCurrent}e\` (${m.minXanaxFromEnergy ?? 0} Xan)${boostTxt}${flyWarn}${revWarn}`;
        });

    const needsAttention = (summary.members || [])
        .filter(m => (m.tracked && m.energyCurrent < targetE) || m.isAbroadOrTraveling || m.revivesPublicWarning)
        .slice(0, 12)
        .map(m => {
            const eStr = m.tracked ? `\`${m.energyCurrent}e\`` : '`Unlinked`';
            const tagStr = m.warnings.slice(0, 2).join(', ');
            return `• **${m.playerName}** (${eStr}) — ${tagStr}`;
        });

    const fields = [
        {
            name: `⚡ Stack Readiness (${c.warReady750Plus || 0} / ${c.linkedTracked || 0} Linked ≥${targetE}e)`,
            value:
                `${progressBar} **${summary.readyPct || 0}%**\n` +
                `🔥 **1,000e Hard Cap:** \`${c.maxStack1000 || 0}\`  •  ✅ **${targetE}e+ Ready:** \`${c.warReady750Plus || 0}\`\n` +
                `🔋 **Building:** \`${c.building || 0}\`  •  ⚠️ **Unstacked:** \`${c.unstacked || 0}\`  •  🔗 **Unlinked:** \`${c.untracked || 0}\``,
            inline: false
        },
        {
            name: '📊 Faction Firepower & Cooldowns',
            value:
                `💥 **Total Stacked E:** \`${(summary.totalStackedEnergy || 0).toLocaleString()}e\` (Avg \`${summary.avgStackedEnergy || 0}e\`)\n` +
                `🥤 **Booster CD 00:00:** \`${c.boosterReady || 0}\` members  •  💊 **Drug Clear:** \`${c.drugReady || 0}\` members\n` +
                `✈️ **Flying / Abroad:** \`${c.travelingOrAbroad || 0}\`  •  💉 **Revives Everyone:** \`${c.revivesEveryone || 0}\``,
            inline: false
        },
        {
            name: `🏆 War-Ready Stackers (${topStacked.length ? 'Top ' + topStacked.length : '0'})`,
            value: (topStacked.length > 0 ? topStacked.join('\n') : '*No linked members currently ≥' + targetE + 'e.*').slice(0, 1020),
            inline: false
        }
    ];

    if (needsAttention.length > 0) {
        fields.push({
            name: `🚨 Needs Action (${summary.actionNeededCount || needsAttention.length})`,
            value: needsAttention.join('\n').slice(0, 1020),
            inline: false
        });
    }

    const title = options.checkpointLabel
        ? `⏰ Pre-War Stack Check (${options.checkpointLabel}) — ${summary.factionName}`
        : `⚡ Pre-War Stack & Readiness — ${summary.factionName}`;

    const color = (c.revivesEveryone > 0 || (c.warReady750Plus || 0) === 0)
        ? (UI ? UI.COLORS.GOLD : 0xF0B232)
        : (UI ? UI.COLORS.GREEN : 0x2ECC71);

    const embed = UI
        ? UI.embed({
            color,
            title: UI.ensureBrand(title),
            description: warStatusLine,
            fields
        })
        : { title, description: warStatusLine, color, fields, timestamp: new Date().toISOString() };

    if (options.includeButtons !== false) {
        const dmBtnId = `warstack_dm_unstacked:${summary.factionId || 'default'}`;
        const warRoomUrl = `${publicUrl}/gym-stats.html#war`;
        embed.buttons = [
            {
                label: '📩 DM Unstacked / Flying',
                customId: dmBtnId,
                style: 1
            }
        ];
        embed.links = [
            {
                label: '⚡ Open War Room',
                url: warRoomUrl
            }
        ];
        embed.components = [
            {
                type: 1,
                components: [
                    {
                        type: 2,
                        style: 1,
                        label: '📩 DM Unstacked / Flying',
                        custom_id: dmBtnId
                    },
                    {
                        type: 2,
                        style: 5,
                        label: '⚡ Open War Room',
                        url: warRoomUrl
                    }
                ]
            }
        ];
    }
    return embed;
}

function createWarReadinessEngine(deps = {}) {
    const dataDir = deps.dataDir || path.join(__dirname, 'data');
    const stateFile = path.join(dataDir, 'war_readiness_state.json');

    let state = {
        sentCheckpoints: {} // { `${facId}_${warId}`: { '12h': ts, '4h': ts, '1h': ts } }
    };

    try {
        if (fs.existsSync(stateFile)) {
            const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            if (parsed && typeof parsed === 'object' && parsed.sentCheckpoints) {
                state.sentCheckpoints = parsed.sentCheckpoints;
            }
        }
    } catch (e) {
        console.warn('[WarReadiness] Could not load state file:', e.message);
    }

    function saveState() {
        try {
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
        } catch (e) {
            console.warn('[WarReadiness] Could not save state file:', e.message);
        }
        if (typeof deps.onStateChange === 'function') {
            try { deps.onStateChange(); } catch (_) {}
        }
    }

    function exportState() {
        return { sentCheckpoints: state.sentCheckpoints || {} };
    }

    function importState(saved) {
        if (saved && saved.sentCheckpoints && typeof saved.sentCheckpoints === 'object') {
            state.sentCheckpoints = { ...(state.sentCheckpoints || {}), ...saved.sentCheckpoints };
        }
    }

    function extractWarMeta(facData, myFactionId) {
        if (!facData || !facData.rankedwars) return null;
        const nowSec = Math.floor(Date.now() / 1000);
        let upcoming = null;
        let active = null;
        for (const [warId, w] of Object.entries(facData.rankedwars)) {
            if (!w || !w.war) continue;
            const ended = Boolean(w.war.winner && w.war.winner !== 0) || Boolean(w.war.end && w.war.end !== 0);
            if (ended) continue;
            let enemyName = null;
            let enemyId = null;
            if (w.factions) {
                for (const [fId, fObj] of Object.entries(w.factions)) {
                    if (String(fId) !== String(myFactionId)) {
                        enemyId = String(fId);
                        enemyName = fObj?.name || `Faction [${fId}]`;
                        break;
                    }
                }
            }
            const item = {
                warId: String(warId),
                start: Number(w.war.start || 0),
                target: Number(w.war.target || 0),
                enemyId,
                enemyName
            };
            if (item.start > nowSec) {
                if (!upcoming || item.start < upcoming.start) upcoming = item;
            } else if (item.start > 0 && item.start <= nowSec) {
                active = item;
            }
        }
        return upcoming || active || null;
    }

    async function fetchFactionRosterAndWar(factionId, apiKey, options = {}) {
        const fid = String(factionId || '').trim();
        let members = null;
        let factionName = null;
        let upcomingWar = null;

        const keyPool = [];
        if (apiKey) keyPool.push(apiKey);
        if (typeof deps.getCandidateKeys === 'function') {
            for (const k of (deps.getCandidateKeys(fid) || [])) {
                if (k && !keyPool.includes(k)) keyPool.push(k);
            }
        }
        const uniqueKeys = [...new Set(keyPool.filter(k => k && String(k).length >= 16))];

        for (const k of uniqueKeys) {
            try {
                const [v2Res, rwRes] = await Promise.allSettled([
                    fetch(`https://api.torn.com/v2/faction/${fid || ''}/members?striptags=true&key=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
                    fetch(`https://api.torn.com/faction/${fid || ''}?selections=basic,rankedwars&key=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json())
                ]);

                if (rwRes.status === 'fulfilled' && rwRes.value && !rwRes.value.error) {
                    const rwData = rwRes.value;
                    if (rwData.name) factionName = rwData.name;
                    upcomingWar = extractWarMeta(rwData, fid || rwData.ID);
                    if (!members && rwData.members) {
                        members = Object.entries(rwData.members).map(([id, m]) => ({ id: Number(id), ...m }));
                    }
                }
                if (v2Res.status === 'fulfilled' && v2Res.value && Array.isArray(v2Res.value.members) && v2Res.value.members.length > 0) {
                    members = v2Res.value.members;
                }
                if (members && members.length > 0) break;
            } catch (_) {}
        }

        // Cached warboard fallback when Torn API unreachable or offline
        if ((!members || members.length === 0) && typeof deps.getCachedWarboard === 'function') {
            const wb = deps.getCachedWarboard(fid);
            if (wb && Array.isArray(wb.friendly) && wb.friendly.length > 0) {
                members = wb.friendly.map(m => ({
                    id: Number(m.id || m.playerId),
                    name: m.name,
                    level: m.level,
                    status: {
                        state: m.state || 'Okay',
                        description: m.statusDescription || m.state || 'Okay',
                        until: m.until || 0
                    },
                    last_action: {
                        status: m.onlineStatus || 'Offline',
                        timestamp: m.lastActionTimestamp || 0
                    }
                }));
                factionName = factionName || wb.warInfo?.myFaction?.name || null;
            }
        }

        return { members: members || [], factionName, upcomingWar };
    }

    async function computeLiveReadiness(factionId, apiKey, options = {}) {
        const targetFacId = String(factionId || deps.getDefaultFactionId?.() || '52355').trim();
        if (options.refreshBars && typeof deps.pollConnectedXanaxAndCooldowns === 'function') {
            try {
                await Promise.race([
                    deps.pollConnectedXanaxAndCooldowns({ maxAgeMs: 0, force: true }),
                    new Promise(resolve => setTimeout(resolve, 4500))
                ]);
            } catch (_) {}
        }

        const { members, factionName, upcomingWar } = await fetchFactionRosterAndWar(targetFacId, apiKey, options);
        const bHistory = typeof deps.getBattleStatsHistory === 'function' ? deps.getBattleStatsHistory() : {};

        return buildWarReadinessSummary(members, bHistory, upcomingWar, {
            factionId: targetFacId,
            factionName: factionName || deps.getFactionName?.(targetFacId) || `Faction [${targetFacId}]`,
            targetEnergy: Number(options.targetEnergy) || 750,
            computeEnergyXanaxInference: deps.computeEnergyXanaxInference
        });
    }

    async function dmActionNeededMembers(summary, actorName = 'Leadership') {
        const targetE = summary.targetEnergy || 750;
        const candidates = (summary.members || []).filter(m =>
            (m.tracked && m.energyCurrent < targetE) || m.isAbroadOrTraveling || m.revivesPublicWarning
        );

        let sent = 0;
        let failed = 0;
        let unlinked = 0;

        for (const m of candidates) {
            let discordId = null;
            if (typeof deps.resolveMemberDiscord === 'function') {
                const res = await deps.resolveMemberDiscord(m.playerId, m.playerName).catch(() => null);
                discordId = res?.discordId || null;
            }
            if (!discordId) {
                unlinked++;
                continue;
            }

            const issues = [];
            if (m.tracked && m.energyCurrent < targetE) {
                issues.push(`⚡ **Energy Stack:** \`${m.energyCurrent}e\` (Target: **${targetE}e+**)`);
            }
            if (m.isAbroadOrTraveling) {
                issues.push(`✈️ **Travel:** Currently **${m.statusState}** — please fly home before war lock!`);
            }
            if (m.revivesPublicWarning) {
                issues.push(`💉 **Revives Setting:** Set to **Everyone** — switch to *No One* or *Friends & Faction* in Torn Settings!`);
            }

            const dmEmbed = UI
                ? UI.warning(
                    `⚡ Pre-War Readiness Check — ${summary.factionName}`,
                    `Hi **${m.playerName}**, leadership (**${actorName}**) flagged a pre-war preparation item for you:\n\n${issues.join('\n')}`
                )
                : {
                    title: `⚡ Pre-War Readiness Check`,
                    description: `Hi ${m.playerName},\n${issues.join('\n')}`,
                    color: 0xF0B232
                };

            let delivered = false;
            if (typeof deps.sendDirectMessage === 'function') {
                const dmRes = await deps.sendDirectMessage(discordId, dmEmbed).catch(() => ({ success: false }));
                delivered = Boolean(dmRes && dmRes.success);
            }
            if (delivered) sent++;
            else failed++;
        }

        return { total: candidates.length, sent, failed, unlinked };
    }

    async function evaluateAndDispatchPreWarAlerts() {
        const cfg = deps.getDiscordConfig?.() || {};
        if (!cfg.preWarStackAlertsEnabled) return { skipped: true, reason: 'disabled' };

        const fid = String(cfg.factionId || deps.getDefaultFactionId?.() || '52355').trim();
        const apiKey = cfg.apiKey || deps.getFallbackApiKey?.() || null;
        if (!apiKey) return { skipped: true, reason: 'no_api_key' };

        const channelId = cfg.warAlertChannelId || cfg.alertChannelId || cfg.channelId || null;
        if (!channelId) return { skipped: true, reason: 'no_channel' };

        const summary = await computeLiveReadiness(fid, apiKey, { refreshBars: false });
        const war = summary.upcomingWar;
        if (!war || !war.start) return { skipped: true, reason: 'no_upcoming_war' };

        const nowSec = Math.floor(Date.now() / 1000);
        const remHours = (war.start - nowSec) / 3600;
        if (remHours <= 0 || remHours > 12.1) return { skipped: true, reason: 'outside_window', remHours };

        const warKey = `${fid}_${war.warId}_${war.start}`;
        if (!state.sentCheckpoints[warKey]) state.sentCheckpoints[warKey] = {};

        let triggeredCheckpoint = null;
        for (const cp of DEFAULT_PREWAR_CHECKPOINTS) {
            const label = `${cp}h`;
            // Pick highest-urgency window currently entered (1h if <=1h, 4h if <=4h, 12h if <=12h)
            if (remHours <= cp && !state.sentCheckpoints[warKey][label]) {
                triggeredCheckpoint = cp;
            }
        }

        if (!triggeredCheckpoint) return { skipped: true, reason: 'already_dispatched' };

        // Mark checkpoint (and any larger missed ones) so we never double-ping T-12h after T-4h
        for (const cp of DEFAULT_PREWAR_CHECKPOINTS) {
            if (remHours <= cp) {
                state.sentCheckpoints[warKey][`${cp}h`] = Date.now();
            }
        }
        saveState();

        const embed = buildWarReadinessEmbed(summary, {
            checkpointLabel: `T-${triggeredCheckpoint}h`,
            publicUrl: deps.getPublicUrl?.() || 'https://faction-os.duckdns.org'
        });

        if (typeof deps.sendChannelMessage === 'function' && cfg.botToken) {
            await deps.sendChannelMessage(cfg.botToken, channelId, embed, '', false).catch(() => {});
        }

        let dmSummary = null;
        if (cfg.preWarDmUnstacked) {
            dmSummary = await dmActionNeededMembers(summary, 'F.R.I.D.A.Y. Pre-War Sentinel');
        }

        return { dispatched: true, checkpoint: `T-${triggeredCheckpoint}h`, dmSummary };
    }

    return {
        evaluateMemberReadiness,
        buildWarReadinessSummary,
        buildWarReadinessEmbed,
        computeLiveReadiness,
        dmActionNeededMembers,
        evaluateAndDispatchPreWarAlerts,
        exportState,
        importState
    };
}

module.exports = {
    formatDurationCompact,
    normalizeReviveSetting,
    evaluateMemberReadiness,
    buildWarReadinessSummary,
    buildWarReadinessEmbed,
    createWarReadinessEngine
};
