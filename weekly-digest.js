'use strict';

/**
 * Package G: Weekly Automated Faction Digest & Health Scorecard
 *
 * Synthesizes 7-day Gym Gainers & Xanax Leaders, OC 2.0 Net Cash/Respect & Pass Rate,
 * Overdue Armory Loan count, War/Chain summary, and F.R.I.D.A.Y. API Key Migration %,
 * firing automatically every Sunday at 00:05 TCT (and on-demand via /faction digest).
 */

const fs = require('fs');
const path = require('path');

let UI = null;
try { UI = require('./friday-ui'); } catch (_) {}

function findSnapshotNear(history = [], cutoffMs) {
    if (!Array.isArray(history) || history.length === 0) return null;
    const sorted = [...history].filter(h => h && typeof h.timestamp === 'number').sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.length === 0) return null;
    let bestBefore = null;
    for (const h of sorted) {
        if (h.timestamp <= cutoffMs) bestBefore = h;
    }
    return bestBefore || sorted[0];
}

function compute7dGymAndXanaxLeaders(battleStatsHistory = {}, rosterMembers = {}, nowMs = Date.now()) {
    const cutoffMs = nowMs - (7 * 24 * 3600 * 1000);
    const memberIds = Array.isArray(rosterMembers)
        ? rosterMembers.map(m => ({ id: String(m.id || m.playerId), name: m.name || m.playerName }))
        : Object.entries(rosterMembers || {}).map(([id, m]) => ({ id: String(m?.id || id), name: m?.name }));

    const gainers = [];
    const xanUsers = [];
    let totalGain7d = 0;
    let totalXanax7d = 0;

    for (const m of memberIds) {
        if (!m.id) continue;
        const rec = battleStatsHistory[m.id];
        if (!rec) continue;
        const name = m.name || rec.playerName || `Player [${m.id}]`;

        const curTotal = Number(rec.stats?.total ?? rec.history?.[0]?.total ?? 0);
        const curXan = Number(rec.personalStats?.xantaken ?? rec.xanaxDaily?.currentXanax ?? rec.stats?.xanax ?? 0);
        const baseSnap = findSnapshotNear(rec.history || [], cutoffMs);

        if (curTotal > 0 && baseSnap && Number(baseSnap.total || 0) > 0) {
            const delta = Math.max(0, curTotal - Number(baseSnap.total));
            if (delta > 0) {
                totalGain7d += delta;
                gainers.push({ playerId: m.id, playerName: name, gain7d: delta });
            }
        }

        if (curXan > 0 && baseSnap && typeof baseSnap.xantaken === 'number') {
            const dx = Math.max(0, curXan - Number(baseSnap.xantaken));
            if (dx > 0) {
                totalXanax7d += dx;
                xanUsers.push({ playerId: m.id, playerName: name, xanax7d: dx });
            }
        }
    }

    gainers.sort((a, b) => b.gain7d - a.gain7d);
    xanUsers.sort((a, b) => b.xanax7d - a.xanax7d);

    return {
        topGainers: gainers.slice(0, 5),
        topXanax: xanUsers.slice(0, 5),
        totalGain7d,
        totalXanax7d
    };
}

function compute7dOcSummary(completedCrimes = [], memberMap = {}, nowMs = Date.now()) {
    const cutoffSec = Math.floor(nowMs / 1000) - (7 * 24 * 3600);
    const recent = (Array.isArray(completedCrimes) ? completedCrimes : []).filter(c => {
        const ts = Number(c?.executed_at || c?.ready_at || c?.expired_at || 0);
        return ts >= cutoffSec;
    });

    let totalCrimes = recent.length;
    let successes = 0;
    let totalCash = 0;
    let totalRespect = 0;
    const participantCounts = {};

    for (const c of recent) {
        const statusLower = String(c.status || '').toLowerCase();
        const isSuccess = statusLower === 'successful' || Boolean(c.rewards?.money > 0) || Boolean(c.rewards?.respect > 0);
        if (isSuccess) successes++;
        totalCash += Number(c.rewards?.money || 0);
        totalRespect += Number(c.rewards?.respect || 0);

        for (const slot of (Array.isArray(c.slots) ? c.slots : [])) {
            const pid = String(slot?.user?.id || slot?.user_id || '');
            if (!pid) continue;
            if (!participantCounts[pid]) {
                participantCounts[pid] = {
                    playerId: pid,
                    playerName: memberMap[pid]?.name || `Player [${pid}]`,
                    runs: 0,
                    wins: 0
                };
            }
            participantCounts[pid].runs++;
            if (isSuccess) participantCounts[pid].wins++;
        }
    }

    const passRatePct = totalCrimes > 0 ? Math.round((successes / totalCrimes) * 100) : 0;
    const topReliability = Object.values(participantCounts)
        .sort((a, b) => (b.wins - a.wins) || (b.runs - a.runs))
        .slice(0, 5);

    return {
        totalCrimes,
        successes,
        passRatePct,
        totalCash,
        totalRespect,
        topReliability
    };
}

function computeKeyMigrationHealth(rosterMembers = [], connectedTornIds = new Set()) {
    const ids = Array.isArray(rosterMembers)
        ? rosterMembers.map(m => String(m.id || m.playerId)).filter(Boolean)
        : Object.keys(rosterMembers || {});
    const linkedSet = connectedTornIds instanceof Set
        ? connectedTornIds
        : new Set(Array.from(connectedTornIds || []).map(String));

    const total = ids.length;
    const linked = ids.filter(id => linkedSet.has(id)).length;
    const pct = total > 0 ? Math.round((linked / total) * 100) : 0;
    return { linked, total, pct };
}

function isSundayDigestWindow(nowMs = Date.now()) {
    const d = new Date(nowMs);
    const utcDay = d.getUTCDay(); // 0 = Sunday
    const utcH = d.getUTCHours();
    const utcM = d.getUTCMinutes();
    if (utcDay !== 0) return { inWindow: false, weekKey: null };
    if (utcH === 0 && utcM >= 5 && utcM <= 35) {
        return { inWindow: true, weekKey: d.toISOString().slice(0, 10) };
    }
    return { inWindow: false, weekKey: null };
}

function buildWeeklyDigestEmbed(report, options = {}) {
    const publicUrl = String(options.publicUrl || 'https://faction-os.duckdns.org').replace(/\/+$/, '');
    const facName = report.factionName || 'Faction';
    const g = report.gym || {};
    const oc = report.oc || {};
    const km = report.keyMigration || { linked: 0, total: 0, pct: 0 };

    const gainLines = (g.topGainers || []).length > 0
        ? g.topGainers.map((x, i) => `**#${i + 1}** ${x.playerName} — \`+${Math.round(x.gain7d).toLocaleString()}\``).join('\n')
        : '*No 7-day baseline deltas recorded yet.*';

    const xanLines = (g.topXanax || []).length > 0
        ? g.topXanax.map((x, i) => `**#${i + 1}** ${x.playerName} — \`${x.xanax7d} Xanax\``).join('\n')
        : '*No 7-day Xanax deltas recorded yet.*';

    const ocReliableLines = (oc.topReliability || []).length > 0
        ? oc.topReliability.map(r => `• **${r.playerName}** — \`${r.wins}/${r.runs}\` OCs`).join('\n')
        : '*No completed OCs in the last 7 days.*';

    const migBlocks = Math.round((km.pct / 100) * 10);
    const migBar = '🟩'.repeat(Math.max(0, Math.min(10, migBlocks))) + '⬛'.repeat(Math.max(0, 10 - Math.min(10, migBlocks)));

    const fields = [
        {
            name: `💪 Top 7-Day Gym Gainers (Faction Total: +${Math.round(g.totalGain7d || 0).toLocaleString()})`,
            value: gainLines.slice(0, 1020),
            inline: true
        },
        {
            name: `💊 7-Day Xanax Leaders (Total: ${g.totalXanax7d || 0} used)`,
            value: xanLines.slice(0, 1020),
            inline: true
        },
        {
            name: '💼 OC 2.0 Weekly Performance (7d)',
            value:
                `📋 **Completed:** \`${oc.totalCrimes || 0}\` (${oc.successes || 0} succeeded • **${oc.passRatePct || 0}% Pass Rate**)\n` +
                `💰 **Cash Earned:** \`$${Math.round(oc.totalCash || 0).toLocaleString()}\`  •  ⭐ **Respect:** \`+${Math.round(oc.totalRespect || 0).toLocaleString()}\`\n` +
                ocReliableLines,
            inline: false
        },
        {
            name: '🛡️ Faction Health, Armory & Key Migration',
            value:
                `🔫 **Overdue Armory Loans (48h+):** \`${report.overdueLoansCount ?? 0}\` holder(s)\n` +
                `⚔️ **Active War Attacks Logged (7d):** \`${report.recentWarHits ?? 0}\` hits\n` +
                `🔑 **F.R.I.D.A.Y. Key Migration:** ${migBar} **${km.linked} / ${km.total} (${km.pct}%)**`,
            inline: false
        }
    ];

    const title = `📊 Weekly Faction Health Digest — ${facName}`;
    const desc = `🗓️ Rolling 7-Day Intelligence Scorecard • Generated <t:${Math.floor((report.generatedAt || Date.now()) / 1000)}:F>`;

    const embed = UI
        ? UI.embed({
            color: UI.COLORS.TEAL,
            title: UI.ensureBrand(title),
            description: desc,
            fields
        })
        : { title, description: desc, color: 0x1ABC9C, fields, timestamp: new Date().toISOString() };

    embed.links = [
        { label: '🏋️ Gym Tracker', url: `${publicUrl}/gym-stats.html` },
        { label: '💼 OC Manager', url: `${publicUrl}/oc.html` },
        { label: '🔫 Armory', url: `${publicUrl}/armory.html` }
    ];
    embed.components = [{
        type: 1,
        components: [
            { type: 2, style: 5, label: '🏋️ Gym Tracker', url: `${publicUrl}/gym-stats.html` },
            { type: 2, style: 5, label: '💼 OC Manager', url: `${publicUrl}/oc.html` },
            { type: 2, style: 5, label: '🔫 Armory', url: `${publicUrl}/armory.html` }
        ]
    }];
    return embed;
}

function createWeeklyDigestEngine(deps = {}) {
    const dataDir = deps.dataDir || path.join(__dirname, 'data');
    const stateFile = path.join(dataDir, 'weekly_digest_state.json');

    let state = {
        lastDispatchedSunday: {} // { [facId]: 'YYYY-MM-DD' }
    };

    try {
        if (fs.existsSync(stateFile)) {
            const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            if (parsed && parsed.lastDispatchedSunday) state.lastDispatchedSunday = parsed.lastDispatchedSunday;
        }
    } catch (e) {
        console.warn('[WeeklyDigest] Could not load state:', e.message);
    }

    function save() {
        try {
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
        } catch (e) {
            console.warn('[WeeklyDigest] Could not save state:', e.message);
        }
        if (typeof deps.onStateChange === 'function') {
            try { deps.onStateChange(); } catch (_) {}
        }
    }

    function exportState() {
        return state;
    }

    function importState(saved) {
        if (saved && saved.lastDispatchedSunday && typeof saved.lastDispatchedSunday === 'object') {
            state.lastDispatchedSunday = { ...state.lastDispatchedSunday, ...saved.lastDispatchedSunday };
        }
    }

    async function generateReport(factionId, apiKey) {
        const fid = String(factionId || deps.getDefaultFactionId?.() || '52355').trim();
        let membersMap = {};
        let facName = deps.getFactionName?.(fid) || `Faction [${fid}]`;
        let completedCrimes = [];
        let overdueLoansCount = 0;

        if (apiKey) {
            const [basicRes, crimesRes] = await Promise.allSettled([
                fetch(`https://api.torn.com/faction/${fid}?selections=basic&key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
                fetch(`https://api.torn.com/v2/faction/${fid}/crimes?cat=completed&key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json())
            ]);
            if (basicRes.status === 'fulfilled' && basicRes.value && !basicRes.value.error) {
                if (basicRes.value.name) facName = basicRes.value.name;
                if (basicRes.value.members) membersMap = basicRes.value.members;
            }
            if (crimesRes.status === 'fulfilled' && crimesRes.value && Array.isArray(crimesRes.value.crimes)) {
                completedCrimes = crimesRes.value.crimes;
            }
        }

        if (Object.keys(membersMap).length === 0 && typeof deps.getCachedMembers === 'function') {
            membersMap = deps.getCachedMembers(fid) || {};
        }

        if (typeof deps.getOverdueLoansCount === 'function') {
            overdueLoansCount = await deps.getOverdueLoansCount(fid, apiKey).catch(() => 0);
        }

        const nowMs = Date.now();
        const bHistory = deps.getBattleStatsHistory?.() || {};
        const connectedIds = deps.getConnectedTornIds?.() || new Set();
        const gym = compute7dGymAndXanaxLeaders(bHistory, membersMap, nowMs);
        const oc = compute7dOcSummary(completedCrimes, membersMap, nowMs);
        const keyMigration = computeKeyMigrationHealth(Object.keys(membersMap), connectedIds);

        return {
            factionId: fid,
            factionName: facName,
            generatedAt: nowMs,
            gym,
            oc,
            overdueLoansCount,
            recentWarHits: Number(deps.getRecentWarHitsCount?.(fid) || 0),
            keyMigration
        };
    }

    async function tickWeeklyDigest(options = {}) {
        const cfg = deps.getDiscordConfig?.() || {};
        if (!options.force && !cfg.weeklyDigestEnabled) {
            return { skipped: true, reason: 'disabled' };
        }
        if (typeof deps.isNotificationsPaused === 'function' && deps.isNotificationsPaused() && !options.force) {
            return { skipped: true, reason: 'paused' };
        }

        const nowMs = Number(options.nowMs) || Date.now();
        const win = isSundayDigestWindow(nowMs);
        const fid = String(cfg.factionId || deps.getDefaultFactionId?.() || '52355').trim();

        if (!options.force) {
            if (!win.inWindow) return { skipped: true, reason: 'outside_sunday_window' };
            if (state.lastDispatchedSunday[fid] === win.weekKey) return { skipped: true, reason: 'already_sent_this_sunday' };
        }

        const apiKey = cfg.apiKey || deps.getFallbackApiKey?.(fid);
        const report = await generateReport(fid, apiKey);
        const embed = buildWeeklyDigestEmbed(report, { publicUrl: deps.getPublicUrl?.() });

        const chanId = cfg.digestChannelId || cfg.alertChannelId || cfg.channelId;
        if (!chanId || !cfg.botToken) {
            return { skipped: true, reason: 'no_channel_or_token', report, embed };
        }

        if (typeof deps.sendChannelMessage === 'function') {
            await deps.sendChannelMessage(cfg.botToken, chanId, embed, '', false);
        }

        if (!options.force && win.weekKey) {
            state.lastDispatchedSunday[fid] = win.weekKey;
            save();
        }
        return { dispatched: true, factionId: fid, report, embed };
    }

    return {
        compute7dGymAndXanaxLeaders,
        compute7dOcSummary,
        computeKeyMigrationHealth,
        isSundayDigestWindow,
        buildWeeklyDigestEmbed,
        generateReport,
        tickWeeklyDigest,
        exportState,
        importState
    };
}

module.exports = {
    compute7dGymAndXanaxLeaders,
    compute7dOcSummary,
    computeKeyMigrationHealth,
    isSundayDigestWindow,
    buildWeeklyDigestEmbed,
    createWeeklyDigestEngine
};
