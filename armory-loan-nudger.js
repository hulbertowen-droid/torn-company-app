'use strict';

/**
 * Package E: Auto-Quartermaster Armory Loan Nudger
 *
 * Scans loaned Weapons & Armor for borrowers inactive beyond thresholdHours (default 48h),
 * skips hospitalized / LOA / exempt members (respecting ocDmEngine exempt roles & IDs),
 * sends polite consolidated DMs on a 7-day cooldown, and posts a quartermaster digest.
 */

const fs = require('fs');
const path = require('path');

let UI = null;
try { UI = require('./friday-ui'); } catch (_) {}

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

function toItemList(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    return Object.entries(collection).map(([k, v]) => ({ id: v?.ID || v?.id || k, ...(v || {}) }));
}

function findOverdueLoanHolders(weaponsRaw, armorRaw, membersMap = {}, options = {}) {
    const thresholdHours = Math.max(6, Number(options.thresholdHours) || 48);
    const nowSec = Math.floor((Number(options.nowMs) || Date.now()) / 1000);
    const exemptTornSet = new Set(Array.isArray(options.exemptTornIds) ? options.exemptTornIds.map(String) : []);

    const byBorrower = new Map();

    const scanCategory = (itemsRaw, category) => {
        for (const item of toItemList(itemsRaw)) {
            const loanStr = String(item?.loaned_to || '').trim();
            if (!loanStr || loanStr === '0' || loanStr === 'null') continue;
            for (const rawId of loanStr.split(',')) {
                const pId = rawId.trim();
                if (!pId || pId === '0') continue;
                const m = membersMap[pId];
                if (!m) continue; // Member left faction or missing
                if (exemptTornSet.has(pId)) continue;

                const state = String(m.status?.state || 'Okay');
                const descLower = String(m.status?.description || '').toLowerCase();
                const posLower = String(m.position || '').toLowerCase();

                if (state === 'Hospital' || state === 'Federal' || state === 'Fallen') continue;
                if (descLower.includes('federal') || posLower.includes('leave') || posLower.includes('vacation')) continue;

                const lastActionTs = Number(m.last_action?.timestamp || 0);
                if (!lastActionTs) continue;
                const offlineHours = Math.floor(Math.max(0, nowSec - lastActionTs) / 3600);
                if (offlineHours < thresholdHours) continue;

                if (!byBorrower.has(pId)) {
                    byBorrower.set(pId, {
                        borrowerId: pId,
                        borrowerName: m.name || `Player [${pId}]`,
                        level: Number(m.level || 1),
                        offlineHours,
                        lastActionTs,
                        statusState: state,
                        items: []
                    });
                }
                byBorrower.get(pId).items.push({
                    id: String(item.ID || item.id || ''),
                    name: String(item.name || `Unknown ${category}`),
                    category
                });
            }
        }
    };

    scanCategory(weaponsRaw, 'Weapon');
    scanCategory(armorRaw, 'Armor');

    return Array.from(byBorrower.values()).sort((a, b) => b.offlineHours - a.offlineHours);
}

function buildBorrowerNudgeDmEmbed(holder, factionName = 'your faction', thresholdHours = 48) {
    const itemLines = (holder.items || []).map(it => `• **${it.name}** *(${it.category})*`);
    const title = `🔫 Armory Gear Return Reminder — ${factionName}`;
    const desc =
        `Hi **${holder.borrowerName}**, FactionOS noticed you have been inactive for **${holder.offlineHours}h+** ` +
        `(threshold: \`${thresholdHours}h\`) while holding loaned war gear from the Faction Armory:\n\n` +
        `${itemLines.join('\n')}\n\n` +
        `If you are taking a break, please return unused gear so active fighters can equip it for chains & wars!`;

    const embed = UI
        ? UI.warning(title, desc)
        : { title, description: desc, color: 0xF0B232, timestamp: new Date().toISOString() };

    embed.links = [{ label: '📦 Open Torn Armory', url: 'https://www.torn.com/factions.php?step=your#/tab=armoury' }];
    return embed;
}

function buildQuartermasterSummaryEmbed(factionName, holders = [], thresholdHours = 48, dmResults = null) {
    const title = `🛡️ Armory Loan Overdue Audit (${holders.length} Holder${holders.length === 1 ? '' : 's'}) — ${factionName}`;
    if (holders.length === 0) {
        return UI
            ? UI.success(title, `✅ All loaned weapons & armor are currently held by active members (<${thresholdHours}h offline).`)
            : { title, description: 'No overdue armory loans detected.', color: 0x2ECC71 };
    }

    const lines = holders.slice(0, 15).map(h => {
        const gearList = h.items.map(i => i.name).slice(0, 3).join(', ') + (h.items.length > 3 ? ` +${h.items.length - 3}` : '');
        return `• **[${h.borrowerName} [${h.borrowerId}]](https://www.torn.com/profiles.php?XID=${h.borrowerId})** — \`${h.offlineHours}h\` offline • *${gearList}*`;
    });

    const fields = [
        {
            name: `📋 Overdue Holders (Offline ≥ ${thresholdHours}h)`,
            value: lines.join('\n').slice(0, 1020),
            inline: false
        }
    ];

    if (dmResults) {
        fields.push({
            name: '📩 Automated Borrower DM Nudges',
            value: `✅ Sent: **${dmResults.sent}** • ⏳ Cooldown Skipped: **${dmResults.cooldownSkipped}** • 🔒 Exempt: **${dmResults.exemptSkipped}**`,
            inline: false
        });
    }

    const embed = UI
        ? UI.embed({
            color: UI.COLORS.GOLD,
            title: UI.ensureBrand(title),
            description: `Loaned faction weapons/armor held by offline members (hospitalized & LOA members are excluded).`,
            fields
        })
        : { title, color: 0xF0B232, fields, timestamp: new Date().toISOString() };

    embed.links = [
        { label: '📦 Torn Armory', url: 'https://www.torn.com/factions.php?step=your#/tab=armoury' },
        { label: '🔧 FactionOS Armory', url: 'https://faction-os.duckdns.org/armory.html' }
    ];
    return embed;
}

function createArmoryLoanNudger(deps = {}) {
    const dataDir = deps.dataDir || path.join(__dirname, 'data');
    const stateFile = path.join(dataDir, 'armory_loan_nudges.json');

    let state = {
        sentNudges: {} // { `${facId}_${borrowerId}`: { ts, itemsSig } }
    };

    try {
        if (fs.existsSync(stateFile)) {
            const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            if (parsed && parsed.sentNudges) state.sentNudges = parsed.sentNudges;
        }
    } catch (e) {
        console.warn('[ArmoryNudger] Could not load state:', e.message);
    }

    function save() {
        try {
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
        } catch (e) {
            console.warn('[ArmoryNudger] Could not save state:', e.message);
        }
        if (typeof deps.onStateChange === 'function') {
            try { deps.onStateChange(); } catch (_) {}
        }
    }

    function exportState() {
        return state;
    }

    function importState(saved) {
        if (saved && saved.sentNudges && typeof saved.sentNudges === 'object') {
            state.sentNudges = { ...state.sentNudges, ...saved.sentNudges };
        }
    }

    async function runAudit(options = {}) {
        const cfg = deps.getDiscordConfig?.() || {};
        if (!options.force && !cfg.armoryLoanOverdueAlert) {
            return { skipped: true, reason: 'disabled' };
        }
        if (typeof deps.isNotificationsPaused === 'function' && deps.isNotificationsPaused() && !options.force) {
            return { skipped: true, reason: 'paused' };
        }

        const facId = String(cfg.factionId || deps.getDefaultFactionId?.() || '52355').trim();
        const apiKey = cfg.apiKey || deps.getFallbackApiKey?.(facId);
        if (!apiKey) return { skipped: true, reason: 'no_api_key' };

        const thresholdHours = Math.max(6, Number(cfg.armoryLoanThresholdHours) || 48);
        const ocDmCfg = deps.getOcDmConfig?.() || {};
        const exemptTornIds = Array.isArray(ocDmCfg.exemptTornIds) ? ocDmCfg.exemptTornIds : [];
        const exemptRoleIds = new Set(Array.isArray(ocDmCfg.exemptRoleIds) ? ocDmCfg.exemptRoleIds.map(String) : []);

        const url = `https://api.torn.com/faction/${facId}?selections=basic,weapons,armor&key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
        const data = await res.json();
        if (!data || data.error) {
            return { skipped: true, reason: data?.error?.error || 'torn_api_error' };
        }

        const holders = findOverdueLoanHolders(data.weapons, data.armor, data.members || {}, {
            thresholdHours,
            exemptTornIds
        });

        let sent = 0;
        let cooldownSkipped = 0;
        let exemptSkipped = 0;
        const now = Date.now();
        const dmEligibleHolders = [];

        for (const h of holders) {
            const key = `${facId}_${h.borrowerId}`;
            const sig = h.items.map(i => `${i.category}:${i.name}`).sort().join('|');
            const prev = state.sentNudges[key];
            if (prev && prev.itemsSig === sig && (now - prev.ts) < SEVEN_DAYS_MS && !options.ignoreCooldown) {
                cooldownSkipped++;
                continue;
            }

            let discordInfo = null;
            if (typeof deps.resolveMemberDiscord === 'function') {
                discordInfo = await deps.resolveMemberDiscord(h.borrowerId, h.borrowerName).catch(() => null);
            }
            if (discordInfo?.member?.roles?.cache && exemptRoleIds.size > 0) {
                const hasExemptRole = Array.from(exemptRoleIds).some(rId => discordInfo.member.roles.cache.has(rId));
                if (hasExemptRole) {
                    exemptSkipped++;
                    continue;
                }
            }

            dmEligibleHolders.push({ holder: h, discordId: discordInfo?.discordId || null, key, sig });
        }

        const facName = data.name || cfg.factionName || `Faction [${facId}]`;
        if (!options.dryRun) {
            for (const item of dmEligibleHolders) {
                if (item.discordId && cfg.armoryLoanDmBorrowers !== false && typeof deps.sendDirectMessage === 'function') {
                    const dmEmbed = buildBorrowerNudgeDmEmbed(item.holder, facName, thresholdHours);
                    const dmRes = await deps.sendDirectMessage(item.discordId, dmEmbed).catch(() => ({ success: false }));
                    if (dmRes && dmRes.success) {
                        sent++;
                        state.sentNudges[item.key] = { ts: now, itemsSig: item.sig };
                    }
                }
            }
            if (sent > 0) save();

            const chanId = cfg.alertChannelId || cfg.channelId;
            if (chanId && cfg.botToken && typeof deps.sendChannelMessage === 'function' && (holders.length > 0 || options.force)) {
                const summaryEmbed = buildQuartermasterSummaryEmbed(facName, holders, thresholdHours, {
                    sent, cooldownSkipped, exemptSkipped
                });
                await deps.sendChannelMessage(cfg.botToken, chanId, summaryEmbed, '', false).catch(() => {});
            }
        }

        return {
            skipped: false,
            factionId: facId,
            factionName: facName,
            thresholdHours,
            overdueHoldersCount: holders.length,
            holders,
            dmSummary: { sent, cooldownSkipped, exemptSkipped }
        };
    }

    return {
        findOverdueLoanHolders,
        buildBorrowerNudgeDmEmbed,
        buildQuartermasterSummaryEmbed,
        runAudit,
        exportState,
        importState
    };
}

module.exports = {
    findOverdueLoanHolders,
    buildBorrowerNudgeDmEmbed,
    buildQuartermasterSummaryEmbed,
    createArmoryLoanNudger
};
