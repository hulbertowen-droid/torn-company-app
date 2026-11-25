/**
 * F.R.I.D.A.Y. - Faction Promotion Management Engine
 * 
 * Provides:
 * - Dynamic retrieval of actual faction roles from Torn API (excluding Leader, Co-leader, and unused phantom roles like empty Recruit).
 * - True progression hierarchy ordering & accurate rank movement calculations.
 * - Interactive Discord promotion menu, role-perk diffing, and modal submission.
 * - Leadership dispatch, notifications, 1-click Approve/Deny, and Deny-with-Reason feedback.
 * - Persistent storage across disk (data/promotion_requests.json) and MongoDB Atlas.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const UI = require('./friday-ui');

const PROMOTIONS_FILE = path.join(__dirname, 'data', 'promotion_requests.json');

// In-memory store: id => promotionRecord
const promotionsStore = new Map();

// Per-faction 5-minute cache for Torn faction data (positions + members)
const factionDataCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Short-lived token map for very long role names in modal customIds (> 95 chars encoded)
const modalRoleTokens = new Map();
let modalTokenCounter = 0;

// MongoDB collection reference
let promoCollection = null;

/**
 * Initialize storage and load existing promotion requests.
 */
function initPromotionManager(dbConnection) {
    if (dbConnection && dbConnection.collection) {
        try {
            promoCollection = dbConnection.collection('promotion_requests');
        } catch(e) {}
    }

    loadPromotionsFromDisk();
    syncWithMongo().catch(err => console.warn('[Promotions] Mongo sync warn:', err.message));
}

function loadPromotionsFromDisk() {
    try {
        const dir = path.dirname(PROMOTIONS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        if (fs.existsSync(PROMOTIONS_FILE)) {
            const raw = fs.readFileSync(PROMOTIONS_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item && item.id) {
                        promotionsStore.set(item.id, item);
                    }
                }
            } else if (typeof data === 'object') {
                for (const [id, item] of Object.entries(data)) {
                    if (item && item.id) {
                        promotionsStore.set(id, item);
                    }
                }
            }
            console.log(`[Promotions] Loaded ${promotionsStore.size} promotion requests from disk.`);
        }
    } catch(err) {
        console.error('[Promotions] Error loading from disk:', err.message);
    }
}

function savePromotionsToDisk() {
    try {
        const dir = path.dirname(PROMOTIONS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const list = Array.from(promotionsStore.values());
        fs.writeFileSync(PROMOTIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch(err) {
        console.error('[Promotions] Error saving to disk:', err.message);
    }
}

async function syncWithMongo() {
    if (!promoCollection) return;
    try {
        const docs = await promoCollection.find({}).toArray();
        let synced = 0;
        for (const doc of docs) {
            if (doc && doc.id) {
                promotionsStore.set(doc.id, doc);
                synced++;
            }
        }
        if (synced > 0) {
            savePromotionsToDisk();
            console.log(`[Promotions] Synced ${synced} requests from MongoDB.`);
        }
    } catch(e) {
        console.warn('[Promotions] Mongo sync error:', e.message);
    }
}

async function persistRecord(record) {
    promotionsStore.set(record.id, record);
    savePromotionsToDisk();
    if (promoCollection) {
        try {
            await promoCollection.updateOne(
                { id: record.id },
                { $set: record },
                { upsert: true }
            );
        } catch(e) {
            console.warn('[Promotions] Mongo save error:', e.message);
        }
    }
}

/**
 * Check if a role is Leader or Co-Leader (cannot be requested).
 */
function isRestrictedPromotionRole(roleName) {
    if (!roleName) return true;
    const lower = String(roleName).toLowerCase().trim();
    return (
        lower === 'leader' ||
        lower === 'co-leader' ||
        lower === 'co-lead' ||
        lower === 'coleader' ||
        lower.includes('co-leader') ||
        lower.includes('colead')
    );
}

/**
 * Count enabled permission flags in a Torn v1 position object.
 */
function countEnabledPermissions(posObj) {
    if (!posObj || typeof posObj !== 'object') return 0;
    return Object.keys(posObj).filter(k =>
        k !== 'title' &&
        k !== 'default' &&
        (posObj[k] === 1 || posObj[k] === true)
    ).length;
}

/**
 * Detect Torn's phantom/unused positions (most notably the legacy "Recruit" slot
 * returned by Torn API v1 with 0 permissions, default: 0, and 0 active members).
 */
function isPhantomUnusedRole(roleName, posObj, positionsObj = {}, membersObj = null) {
    if (!roleName || !posObj || typeof posObj !== 'object') return true;
    const isDefault = Boolean(posObj.default == 1 || posObj.default === true);
    if (isDefault) return false;

    const permCount = countEnabledPermissions(posObj);
    if (permCount > 0) return false;

    if (membersObj && typeof membersObj === 'object') {
        const lowerRole = roleName.toLowerCase();
        const heldByMember = Object.values(membersObj).some(
            m => m && (m.position || '').toLowerCase() === lowerRole
        );
        if (heldByMember) return false;
        // 0 permissions, not default, and 0 members hold it -> unused phantom slot
        return true;
    }

    // Without membersObj, Torn's built-in "Recruit" with 0 perms when another default role exists is phantom
    if (roleName.toLowerCase().trim() === 'recruit') {
        const hasOtherDefault = Object.entries(positionsObj || {}).some(
            ([name, p]) => name.toLowerCase().trim() !== 'recruit' && Boolean(p && (p.default == 1 || p.default === true))
        );
        if (hasOtherDefault) return true;
    }

    return false;
}

const PERMISSION_LABELS = [
    // Leadership & Vault
    { key: 'canManageWars', label: '⚔️ War Controls', weight: 10 },
    { key: 'canManageApplications', label: '📋 Recruit Processing', weight: 9 },
    { key: 'canKickMembers', label: '🥾 Kick Members', weight: 10 },
    { key: 'canAdjustMemberBalance', label: '⚖️ Balance Adjustments', weight: 9 },
    { key: 'canGiveMoney', label: '🏦 Vault Payouts', weight: 8 },
    { key: 'canGiveItem', label: '📦 Give Items', weight: 7 },
    { key: 'canGivePoints', label: '🪙 Give Points', weight: 7 },
    { key: 'canManageUpgrades', label: '🌳 Faction Upgrades', weight: 9 },
    { key: 'canManageOC2', label: '🎯 OC 2.0 Management', weight: 7 },
    { key: 'canAccessFactionApi', label: '🔑 Faction API', weight: 6 },
    { key: 'canRetrieveLoanedArmory', label: '🛡️ Armory Retrieval', weight: 6 },
    { key: 'canManageForum', label: '💬 Forum Management', weight: 5 },
    { key: 'canSendNewsletter', label: '📬 Newsletters', weight: 4 },
    { key: 'canChangeAnnouncement', label: '📢 Announcements', weight: 5 },
    { key: 'canChangeDescription', label: '📝 Faction Description', weight: 5 },
    // Refills & Armory Loans
    { key: 'canUseEnergyRefill', label: '⚡ Energy Refills', weight: 4 },
    { key: 'canUseNerveRefill', label: '🔥 Nerve Refills', weight: 4 },
    { key: 'canLoanDragItem', label: '💊 Drug Loans', weight: 4 }, // Torn API v1 typo: canLoanDragItem
    { key: 'canLoanBoosterItem', label: '💉 Booster Loans', weight: 3 },
    { key: 'canLoanMedicalItem', label: '🩹 Med Loans', weight: 3 },
    { key: 'canLoanConsumableItem', label: '🍬 Consumable Loans', weight: 2 },
    { key: 'canLoanUtilityItem', label: '🔧 Utility Loans', weight: 2 },
    // Basic Member Usage
    { key: 'canUseDrugItem', label: '💊 Drug Usage', weight: 2 },
    { key: 'canLoanTemporaryItem', label: '💣 Temp Loans', weight: 1 },
    { key: 'canLoanWeaponAndArmory', label: '⚔️ Weapon/Armor Loans', weight: 1 },
    { key: 'canUseMedicalItem', label: '🩹 Med Usage', weight: 1 },
    { key: 'canUseBoosterItem', label: '💉 Booster Usage', weight: 1 },
    { key: 'canUseConsumableItem', label: '🍬 Consumable Usage', weight: 1 }
];

/**
 * Format key perks/powers of a Torn faction position concisely.
 */
function formatPositionPerks(posObj, maxItems = 6) {
    if (!posObj || typeof posObj !== 'object') return 'Standard member permissions';

    const enabled = PERMISSION_LABELS.filter(p => posObj[p.key] === 1 || posObj[p.key] === true);
    if (enabled.length === 0) return 'No special armory or admin permissions';

    // Combine Energy + Nerve refills cleanly when both are enabled
    const labels = [];
    const hasEnergy = posObj.canUseEnergyRefill === 1 || posObj.canUseEnergyRefill === true;
    const hasNerve = posObj.canUseNerveRefill === 1 || posObj.canUseNerveRefill === true;
    let combinedRefillAdded = false;

    for (const p of enabled) {
        if ((p.key === 'canUseEnergyRefill' || p.key === 'canUseNerveRefill') && hasEnergy && hasNerve) {
            if (!combinedRefillAdded) {
                labels.push('⚡ Energy/Nerve Refills');
                combinedRefillAdded = true;
            }
            continue;
        }
        labels.push(p.label);
    }

    if (labels.length > maxItems) {
        const shown = labels.slice(0, maxItems);
        return `${shown.join(' • ')} *(+${labels.length - maxItems} more)*`;
    }
    return labels.join(' • ');
}

/**
 * Compute newly unlocked (and lost, if any) permissions between currentRole and requestedRole.
 */
function getPositionPermissionDiff(positionsObj, currentRole, requestedRole) {
    if (!positionsObj || typeof positionsObj !== 'object') {
        return { gained: [], lost: [] };
    }
    const currKey = Object.keys(positionsObj).find(k => k.toLowerCase() === (currentRole || '').toLowerCase());
    const reqKey = Object.keys(positionsObj).find(k => k.toLowerCase() === (requestedRole || '').toLowerCase());
    const currPos = currKey ? (positionsObj[currKey] || {}) : {};
    const reqPos = reqKey ? (positionsObj[reqKey] || {}) : {};

    const gained = [];
    const lost = [];
    for (const p of PERMISSION_LABELS) {
        const had = currPos[p.key] === 1 || currPos[p.key] === true;
        const has = reqPos[p.key] === 1 || reqPos[p.key] === true;
        if (!had && has) gained.push(p.label);
        if (had && !has) lost.push(p.label);
    }
    return { gained, lost };
}

/**
 * Format newly unlocked permissions into a single scannable string.
 */
function formatNewPerksUnlocked(positionsObj, currentRole, requestedRole, maxItems = 6) {
    const { gained, lost } = getPositionPermissionDiff(positionsObj, currentRole, requestedRole);
    const parts = [];
    if (gained.length > 0) {
        const shown = gained.slice(0, maxItems).map(l => `+${l}`).join(' • ');
        parts.push(gained.length > maxItems ? `${shown} (+${gained.length - maxItems} more)` : shown);
    }
    if (lost.length > 0) {
        const shownLost = lost.slice(0, 3).map(l => `-${l}`).join(' • ');
        parts.push(lost.length > 3 ? `⚠️ Lost: ${shownLost} (+${lost.length - 3} more)` : `⚠️ Lost: ${shownLost}`);
    }
    if (parts.length === 0) return 'Same permission set (title/tier change only)';
    return parts.join('\n');
}

/**
 * Fetch live faction positions & members from Torn API (cached per faction for 5 min).
 * Automatically cross-checks Torn API v2 /positions to drop phantom legacy roles (e.g. unused "Recruit").
 */
async function getFactionData(apiKey, facId = null, forceRefresh = false) {
    const cacheKey = String(facId || 'default');
    const now = Date.now();
    const existingCache = factionDataCache.get(cacheKey);
    if (!forceRefresh && existingCache && (now - existingCache.ts < CACHE_TTL_MS)) {
        return existingCache.data;
    }

    if (!apiKey) {
        return existingCache?.data || { name: 'Faction', id: facId, positions: {}, members: {} };
    }

    try {
        const v1Url = facId
            ? `https://api.torn.com/faction/${facId}?selections=basic,positions&key=${apiKey}`
            : `https://api.torn.com/faction/?selections=basic,positions&key=${apiKey}`;
        const v2Url = facId
            ? `https://api.torn.com/v2/faction/${facId}/positions?key=${apiKey}`
            : `https://api.torn.com/v2/faction/positions?key=${apiKey}`;

        const [v1Res, v2Res] = await Promise.allSettled([
            fetch(v1Url, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
            fetch(v2Url, { signal: AbortSignal.timeout(6000) }).then(r => r.json()).catch(() => null)
        ]);

        const data = v1Res.status === 'fulfilled' ? v1Res.value : null;
        const v2Data = v2Res.status === 'fulfilled' ? v2Res.value : null;

        if (data && !data.error && data.positions) {
            const members = data.members || {};
            const v2Names = Array.isArray(v2Data?.positions)
                ? new Set(v2Data.positions.map(p => String(p.name || '').toLowerCase()))
                : null;

            // Keep only real, active positions (drop phantom unused v1-only roles like empty "Recruit")
            const cleanPositions = {};
            for (const [roleName, posObj] of Object.entries(data.positions)) {
                const lower = roleName.toLowerCase();
                const inV2 = v2Names ? v2Names.has(lower) : true;
                const isPhantom = isPhantomUnusedRole(roleName, posObj, data.positions, members);

                if (!inV2 && !isRestrictedPromotionRole(roleName) && countEnabledPermissions(posObj) === 0) {
                    const heldByMember = Object.values(members).some(m => (m?.position || '').toLowerCase() === lower);
                    if (!heldByMember) continue;
                }
                if (isPhantom) continue;

                cleanPositions[roleName] = posObj;
            }

            const facRecord = {
                name: data.name || 'Faction',
                id: data.ID || facId,
                positions: cleanPositions,
                members
            };
            factionDataCache.set(cacheKey, { data: facRecord, ts: now });
            if (facRecord.id && String(facRecord.id) !== cacheKey) {
                factionDataCache.set(String(facRecord.id), { data: facRecord, ts: now });
            }
            return facRecord;
        }
    } catch(err) {
        console.warn('[Promotions] Error fetching faction data from Torn API:', err.message);
    }

    return existingCache?.data || { name: 'Faction', id: facId, positions: {}, members: {} };
}

/**
 * Compute power score tiebreaker for sorting positions of equal permission count.
 */
function getPositionPowerScore(posObj) {
    if (!posObj || typeof posObj !== 'object') return 0;
    let score = 0;
    for (const p of PERMISSION_LABELS) {
        if (posObj[p.key] === 1 || posObj[p.key] === true) {
            score += p.weight;
        }
    }
    return score;
}

/**
 * Sort faction roles into an ordered progression hierarchy (Rank 1 -> Rank N):
 * 1. Excludes Leader / Co-leader and phantom unused roles (e.g. empty Recruit).
 * 2. Default role (default: 1) is entry base rank (Rank 1).
 * 3. Roles with fewer permissions come before roles with higher permissions.
 * 4. Ties break by power weight, then faction API order.
 */
function getRoleHierarchy(positionsObj, membersObj = null) {
    if (!positionsObj || typeof positionsObj !== 'object') return [];
    const rawKeys = Object.keys(positionsObj);
    const activeRoles = rawKeys.filter(roleName =>
        !isRestrictedPromotionRole(roleName) &&
        !isPhantomUnusedRole(roleName, positionsObj[roleName], positionsObj, membersObj)
    );

    return [...activeRoles].sort((a, b) => {
        const posA = positionsObj[a] || {};
        const posB = positionsObj[b] || {};

        const isDefA = Boolean(posA.default == 1 || posA.default === true);
        const isDefB = Boolean(posB.default == 1 || posB.default === true);
        if (isDefA && !isDefB) return -1;
        if (!isDefA && isDefB) return 1;

        const countA = countEnabledPermissions(posA);
        const countB = countEnabledPermissions(posB);
        if (countA !== countB) return countA - countB;

        const powerA = getPositionPowerScore(posA);
        const powerB = getPositionPowerScore(posB);
        if (powerA !== powerB) return powerA - powerB;

        return rawKeys.indexOf(a) - rawKeys.indexOf(b);
    });
}

/**
 * Get all requestable roles sorted in true progression order (Rank 1 -> Rank N),
 * excluding Leader, Co-leader, and unused phantom roles.
 */
function getRequestableFactionRoles(positionsObj, membersObj = null) {
    return getRoleHierarchy(positionsObj, membersObj);
}

/**
 * Get a role's 1-based rank index within the active hierarchy.
 */
function getRoleRankInfo(positionsObj, roleName, membersObj = null) {
    const hierarchy = getRoleHierarchy(positionsObj, membersObj);
    const idx = hierarchy.findIndex(r => r.toLowerCase() === (roleName || '').toLowerCase());
    return {
        rank: idx !== -1 ? idx + 1 : null,
        totalRanks: hierarchy.length,
        hierarchy
    };
}

/**
 * Calculate how many ranks up/down a requested promotion moves the user.
 */
function calculateRankMovement(positionsObj, currentRole, requestedRole, membersObj = null) {
    const hierarchy = getRoleHierarchy(positionsObj, membersObj);
    const currIdx = hierarchy.findIndex(r => r.toLowerCase() === (currentRole || '').toLowerCase());
    const targetIdx = hierarchy.findIndex(r => r.toLowerCase() === (requestedRole || '').toLowerCase());

    if (targetIdx === -1) {
        return `⭐ **Role Change** *(${currentRole || 'Current'} ➔ ${requestedRole})*`;
    }

    if (currIdx === -1) {
        // Handle Leader/Co-leader or unlisted current role cleanly without fabricating Rank 1
        if (isRestrictedPromotionRole(currentRole)) {
            return `⬇️ **Step Down from Leadership** *(${currentRole} ➔ Rank ${targetIdx + 1})*`;
        }
        return `🎯 **Target: Rank ${targetIdx + 1}** *(${currentRole || 'Unlisted'} ➔ ${requestedRole})*`;
    }

    const currRank = currIdx + 1;
    const targetRank = targetIdx + 1;
    const delta = targetRank - currRank;

    if (delta > 0) {
        return `⬆️ **+${delta} Rank${delta === 1 ? '' : 's'} Up** *(Rank ${currRank} ➔ Rank ${targetRank})*`;
    } else if (delta === 0) {
        return `➡️ **Lateral Move** *(Same tier: Rank ${currRank})*`;
    } else {
        const down = Math.abs(delta);
        return `⬇️ **${down} Rank${down === 1 ? '' : 's'} Down** *(Rank ${currRank} ➔ Rank ${targetRank})*`;
    }
}

/**
 * Get past promotion request summary for a Torn player.
 */
function getPlayerRequestHistory(playerId) {
    const numId = Number(playerId);
    if (!numId) return [];
    return Array.from(promotionsStore.values())
        .filter(r => Number(r.playerId) === numId)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function formatPastHistorySummary(playerId) {
    const history = getPlayerRequestHistory(playerId).filter(r => r.status !== 'deleted');
    if (history.length === 0) return 'First request on record';
    const approved = history.filter(r => r.status === 'approved').length;
    const denied = history.filter(r => r.status === 'denied').length;
    const cancelled = history.filter(r => r.status === 'cancelled').length;
    const latest = history[0];
    const parts = [];
    if (approved) parts.push(`${approved} approved`);
    if (denied) parts.push(`${denied} denied`);
    if (cancelled) parts.push(`${cancelled} cancelled`);
    const summary = parts.length > 0 ? parts.join(', ') : `${history.length} previous`;
    const lastTs = latest?.createdAt ? ` (last <t:${Math.floor(latest.createdAt / 1000)}:R>)` : '';
    return `${summary}${lastTs}`;
}

/**
 * Build the interactive Promotion Overview embed listing all active faction roles in rank order.
 */
function buildPromotionMenuEmbed({ memberName, memberId, currentRole, daysInFaction, facName, positions, members = null }) {
    const hierarchy = getRoleHierarchy(positions, members);
    const currIdx = hierarchy.findIndex(r => r.toLowerCase() === (currentRole || '').toLowerCase());
    const currRankText = currIdx !== -1 ? ` (Rank ${currIdx + 1}/${hierarchy.length})` : '';

    // Count members currently in each position if member roster is provided
    const roleCounts = {};
    if (members && typeof members === 'object') {
        for (const m of Object.values(members)) {
            if (m && m.position) {
                const key = m.position.toLowerCase();
                roleCounts[key] = (roleCounts[key] || 0) + 1;
            }
        }
    }

    let fields = hierarchy.slice(0, 25).map((role, idx) => {
        const rankNum = idx + 1;
        const isCurrent = (role.toLowerCase() === (currentRole || '').toLowerCase());
        const perks = formatPositionPerks(positions[role], 5);
        const count = roleCounts[role.toLowerCase()];
        const countBadge = (typeof count === 'number') ? ` · ${count} member${count === 1 ? '' : 's'}` : '';

        let stepTag = '';
        if (!isCurrent && currIdx !== -1) {
            const delta = idx - currIdx;
            if (delta > 0) stepTag = ` (+${delta} Rank${delta === 1 ? '' : 's'})`;
            else if (delta < 0) stepTag = ` (${delta} Rank${Math.abs(delta) === 1 ? '' : 's'})`;
        }

        let valueLines = [`• **Perks:** ${perks}`];
        if (!isCurrent && currIdx !== -1 && idx > currIdx) {
            const { gained } = getPositionPermissionDiff(positions, currentRole, role);
            if (gained.length > 0) {
                const shown = gained.slice(0, 4).map(l => `+${l}`).join(' • ');
                valueLines.push(`• **Unlocks:** ${shown}${gained.length > 4 ? ` *(+${gained.length - 4} more)*` : ''}`);
            }
        }

        return {
            name: `${isCurrent ? '📌' : '⭐'} Rank ${rankNum}: ${role}${isCurrent ? ' *(Current Role)*' : stepTag}${countBadge}`.slice(0, 250),
            value: valueLines.join('\n').slice(0, 1020),
            inline: false
        };
    });

    if (fields.length === 0) {
        fields = [{
            name: 'No Promotional Roles Available',
            value: 'All current faction positions are leadership roles or no promotional roles are currently defined.',
            inline: false
        }];
    }

    const historyLine = memberId ? `\n📜 **Your Request History:** ${formatPastHistorySummary(memberId)}` : '';

    return {
        title: `🎖️ ${facName} — Faction Promotion Request`,
        description: `Hey **${memberName}**! You are currently assigned as **${currentRole || 'Member'}**${currRankText} in **${facName}**${daysInFaction ? ` (${daysInFaction} days in faction)` : ''}.${historyLine}\n\n` +
                     `Below are our **${hierarchy.length} faction ranks** ordered from entry tier up to senior non-command positions. Pick a role from the dropdown below to submit your application!\n\n` +
                     `👑 **Note:** *Leader and Co-leader positions are appointed directly and cannot be requested.*`,
        color: UI.COLORS.BRAND,
        fields,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };
}

/**
 * Build the StringSelectMenu listing requestable roles in rank order (excluding currentRole).
 */
function buildPromotionSelectMenu(positions, currentRole, members = null) {
    const hierarchy = getRoleHierarchy(positions, members);
    const currIdx = hierarchy.findIndex(r => r.toLowerCase() === (currentRole || '').toLowerCase());

    const options = [];
    for (let idx = 0; idx < hierarchy.length; idx++) {
        const role = hierarchy[idx];
        const isCurrent = (role.toLowerCase() === (currentRole || '').toLowerCase());
        if (isCurrent) continue;

        const rankNum = idx + 1;
        const delta = currIdx !== -1 ? idx - currIdx : null;
        const deltaLabel = delta === null ? '' : (delta > 0 ? ` (+${delta} Rank${delta === 1 ? '' : 's'})` : ` (${delta} Rank${Math.abs(delta) === 1 ? '' : 's'})`);
        const label = `Rank ${rankNum}: ${role}${deltaLabel}`.slice(0, 100);

        let descText;
        if (currIdx !== -1 && idx > currIdx) {
            const { gained } = getPositionPermissionDiff(positions, currentRole, role);
            descText = gained.length > 0
                ? 'Unlocks: ' + gained.map(l => l.replace(/[^\x20-\x7E]/g, '').trim()).filter(Boolean).join(', ')
                : 'Higher tier role (same permissions)';
        } else {
            const rawPerks = formatPositionPerks(positions[role], 4).replace(/[•*]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
            descText = rawPerks ? `Perks: ${rawPerks}` : 'Official faction role';
        }
        if (!descText) descText = 'Official faction role';
        if (descText.length > 95) descText = descText.slice(0, 92) + '...';

        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel(label)
                .setValue(role)
                .setDescription(descText)
                .setEmoji(delta !== null && delta > 0 ? '⬆️' : '⭐')
        );
    }

    if (options.length === 0) return null;

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_promotion_role')
        .setPlaceholder('Select the faction role you want to apply for...')
        .addOptions(options.slice(0, 25));

    return new ActionRowBuilder().addComponents(selectMenu);
}

/**
 * Safely encode/resolve selected role in modal customId without hitting Discord's 100-char limit.
 */
function buildPromotionModal(selectedRole) {
    const fullRole = String(selectedRole || '').trim();
    const encoded = encodeURIComponent(fullRole);
    let customId = `modal_promo_${encoded}`;
    if (customId.length > 95) {
        modalTokenCounter = (modalTokenCounter + 1) % 1000000;
        const tok = `tok_${Date.now().toString(36)}_${modalTokenCounter}`;
        modalRoleTokens.set(tok, fullRole);
        customId = `modal_promo_${tok}`;
    }

    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(`Promotion: ${fullRole}`.slice(0, 45));

    const reasonInput = new TextInputBuilder()
        .setCustomId('promo_reason')
        .setLabel('Why should you receive this promotion?')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Highlight your activity, war hits, OC reliability, armory needs, or contributions...')
        .setRequired(false)
        .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return modal;
}

function resolveModalRole(customId) {
    const raw = String(customId || '').replace('modal_promo_', '');
    if (raw.startsWith('tok_') && modalRoleTokens.has(raw)) {
        const resolved = modalRoleTokens.get(raw);
        modalRoleTokens.delete(raw);
        return resolved;
    }
    try {
        return decodeURIComponent(raw);
    } catch (_) {
        return raw;
    }
}

/**
 * Build modal for leadership Deny-with-Reason feedback.
 */
function buildDenyReasonModal(reqId) {
    const modal = new ModalBuilder()
        .setCustomId(`modal_promo_deny_${reqId}`)
        .setTitle('Deny Promotion Request');

    const reasonInput = new TextInputBuilder()
        .setCustomId('deny_reason')
        .setLabel('Reason / feedback for the applicant')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('e.g., Need more war hits, donator status required, spend a bit more time at current rank...')
        .setRequired(true)
        .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return modal;
}

/**
 * Build the notification embed posted in the leadership channel.
 */
function buildLeadershipNotificationEmbed(promoReq, positions, facName) {
    const posObj = (positions && positions[promoReq.requestedRole]) || null;
    const perks = formatPositionPerks(posObj, 8);
    const unlockedPerks = formatNewPerksUnlocked(positions, promoReq.currentRole, promoReq.requestedRole, 6);
    const tenure = promoReq.daysInFaction ? `**${promoReq.daysInFaction}d** in faction` : 'New member';
    const levelStr = promoReq.level ? `**Level ${promoReq.level}**` : 'Level ?';
    const lastActionStr = promoReq.lastAction ? ` · Active ${promoReq.lastAction}` : '';

    const fields = [
        {
            name: "👤 Applicant",
            value: `${UI.player(promoReq.playerName, promoReq.playerId)} (<@${promoReq.discordUserId}>)`,
            inline: true
        },
        {
            name: "🎖️ Level & Tenure",
            value: `${levelStr} · ${tenure}${lastActionStr}`,
            inline: true
        },
        {
            name: "📈 Rank Advancement",
            value: promoReq.rankAdvancement || '⬆️ +1 Rank Up',
            inline: true
        },
        {
            name: "📌 Current Role",
            value: `**${promoReq.currentRole}**`,
            inline: true
        },
        {
            name: "⭐ Requested Promotion",
            value: `**${promoReq.requestedRole}**`,
            inline: true
        },
        {
            name: "📜 Prior Promo History",
            value: promoReq.pastHistorySummary || 'First request on record',
            inline: true
        },
        {
            name: "💪 Battle Stats Progression",
            value: promoReq.statsProgression || '📊 _Unrecorded_',
            inline: false
        },
        {
            name: "🆕 New Perks Unlocked",
            value: unlockedPerks,
            inline: false
        },
        {
            name: "⚡ Full Target Role Permissions",
            value: perks,
            inline: false
        },
        {
            name: "📝 Applicant's Pitch",
            value: promoReq.reason ? `>>> ${promoReq.reason}` : '_No specific pitch provided._',
            inline: false
        },
        {
            name: "⏰ Submitted",
            value: `<t:${Math.floor(promoReq.createdAt / 1000)}:f> (<t:${Math.floor(promoReq.createdAt / 1000)}:R>)`,
            inline: true
        },
        {
            name: "📊 Status",
            value: '⏳ **Pending Leadership Review**',
            inline: true
        }
    ];

    const embed = {
        title: `🎖️ New Promotion Request: ${promoReq.playerName} [${promoReq.playerId}]`,
        description: `A faction member has requested a promotion from **${promoReq.currentRole}** to **${promoReq.requestedRole}** in **${facName || 'the faction'}**. Leadership can review below:`,
        color: UI.COLORS.BRAND,
        fields,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`btn_promo_approve_${promoReq.id}`)
            .setLabel('Approve Promotion')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId(`btn_promo_deny_${promoReq.id}`)
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌'),
        new ButtonBuilder()
            .setCustomId(`btn_promo_denynote_${promoReq.id}`)
            .setLabel('Deny w/ Reason')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📝'),
        new ButtonBuilder()
            .setLabel('Torn Faction Controls')
            .setStyle(ButtonStyle.Link)
            .setURL('https://www.torn.com/factions.php?step=your#/tab=controls')
            .setEmoji('🌐')
    );

    return { embed, actionRow };
}

/**
 * Build the reviewed notification embed after decision.
 */
function buildReviewedNotificationEmbed(promoReq, decision, reviewerName, reviewerId, positions, facName) {
    const isApproved = (decision === 'approved');
    const posObj = (positions && positions[promoReq.requestedRole]) || null;
    const perks = formatPositionPerks(posObj, 8);
    const tenure = promoReq.daysInFaction ? `**${promoReq.daysInFaction}d** in faction` : 'New member';
    const levelStr = promoReq.level ? `**Level ${promoReq.level}**` : 'Level ?';

    const fields = [
        {
            name: "👤 Applicant",
            value: `${UI.player(promoReq.playerName, promoReq.playerId)} (<@${promoReq.discordUserId}>)`,
            inline: true
        },
        {
            name: "🎖️ Level & Tenure",
            value: `${levelStr} · ${tenure}`,
            inline: true
        },
        {
            name: "📈 Rank Advancement",
            value: promoReq.rankAdvancement || '—',
            inline: true
        },
        {
            name: "📌 Current Role",
            value: `**${promoReq.currentRole}**`,
            inline: true
        },
        {
            name: "⭐ Requested Promotion",
            value: `**${promoReq.requestedRole}**`,
            inline: true
        },
        {
            name: "💪 Battle Stats Progression",
            value: promoReq.statsProgression || '📊 _Unrecorded_',
            inline: false
        },
        {
            name: "⚡ Role Permissions",
            value: perks,
            inline: false
        },
        {
            name: "📝 Applicant's Pitch",
            value: promoReq.reason ? `>>> ${promoReq.reason}` : '_No specific pitch provided._',
            inline: false
        },
        {
            name: "⚖️ Leadership Decision",
            value: isApproved 
                ? `✅ **Approved** by <@${reviewerId}> (${reviewerName})\n` +
                  `🔗 **Action Required:** Update position in [Torn Faction Controls](https://www.torn.com/factions.php?step=your#/tab=controls)`
                : `❌ **Denied** by <@${reviewerId}> (${reviewerName})` +
                  (promoReq.reviewReason ? `\n💬 **Reason:** _${promoReq.reviewReason}_` : ''),
            inline: false
        }
    ];

    const embed = {
        title: isApproved 
            ? `✅ Promotion Approved: ${promoReq.playerName} ➔ ${promoReq.requestedRole}`
            : `❌ Promotion Denied: ${promoReq.playerName} [${promoReq.playerId}]`,
        description: isApproved
            ? `🎉 <@${promoReq.discordUserId}>'s promotion to **${promoReq.requestedRole}** was approved by leadership on <t:${Math.floor((promoReq.reviewedAt || Date.now()) / 1000)}:f>!`
            : `<@${promoReq.discordUserId}>'s promotion request to **${promoReq.requestedRole}** was denied on <t:${Math.floor((promoReq.reviewedAt || Date.now()) / 1000)}:f>.`,
        color: isApproved ? UI.COLORS.SUCCESS : UI.COLORS.ERROR,
        fields,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Torn Faction Controls')
            .setStyle(ButtonStyle.Link)
            .setURL('https://www.torn.com/factions.php?step=your#/tab=controls')
            .setEmoji('🌐')
    );

    return { embed, actionRow };
}

/**
 * Verify whether the Discord message for a promotion request still exists in Discord.
 * Returns true if message exists, false if confirmed deleted.
 */
async function verifyPromotionMessageExists(record, bot, discordConfig = null) {
    if (!bot || !record) return true;

    // Case 1: Specific messageId and channelId are tracked
    if (record.channelId && record.messageId) {
        try {
            let chan = bot.channels.cache.get(record.channelId);
            if (!chan) {
                chan = await bot.channels.fetch(record.channelId).catch(err => {
                    if (err && (err.code === 10003 || err.code === 10008 || err.status === 404)) return null;
                    return undefined;
                });
            }
            if (chan === null) {
                return false; // Channel itself confirmed deleted
            }
            if (chan && chan.isTextBased()) {
                const msg = await chan.messages.fetch(record.messageId).catch(err => {
                    // Discord 10008 = Unknown Message (deleted in Discord), 404 = Not Found
                    if (err && (err.code === 10008 || err.status === 404)) return null;
                    return undefined;
                });
                if (msg === null) {
                    return false; // Confirmed deleted from Discord
                }
                if (msg) {
                    return true; // Confirmed exists
                }
            }
        } catch (e) {
            console.warn('[Promotions] Message verification check error:', e.message);
        }
    }

    // Case 2: channelId or messageId missing (e.g. unlinked legacy record)
    const targetChanId = record.channelId || (discordConfig && (discordConfig.promotionChannelId || discordConfig.leaderChannelId || discordConfig.leadershipChannelId || discordConfig.globalChannelId));
    if (targetChanId) {
        try {
            const chan = bot.channels.cache.get(targetChanId) || await bot.channels.fetch(targetChanId).catch(() => null);
            if (chan && chan.isTextBased()) {
                const recent = await chan.messages.fetch({ limit: 50 }).catch(() => null);
                if (recent && recent.size > 0) {
                    const matchingMsg = recent.find(m => {
                        const hasButton = m.components?.some(row => 
                            row.components?.some(btn => btn.customId && btn.customId.includes(record.id))
                        );
                        if (hasButton) return true;
                        const hasPendingEmbed = m.embeds?.some(e =>
                            e.title &&
                            e.title.includes('New Promotion Request:') &&
                            e.title.includes(String(record.playerId))
                        );
                        return hasPendingEmbed;
                    });

                    if (matchingMsg) {
                        record.messageId = matchingMsg.id;
                        record.channelId = chan.id;
                        await persistRecord(record);
                        return true;
                    } else {
                        // Request is not found in the channel and was created > 30s ago
                        if (Date.now() - record.createdAt > 30000) {
                            return false;
                        }
                    }
                }
            }
        } catch (e) {}
    }

    // If no messageId could be found and the request is older than 60 seconds, consider it deleted
    if (!record.messageId && (Date.now() - record.createdAt > 60000)) {
        return false;
    }

    return true;
}

/**
 * Check if user already has an active pending promotion request.
 * If Discord bot is provided, verifies if the Discord message still exists.
 * If the message was deleted in Discord, marks the request as deleted automatically.
 */
async function getPendingRequestForPlayer(playerId, bot = null, discordConfig = null) {
    if (!playerId) return null;
    const numId = Number(playerId);
    for (const record of promotionsStore.values()) {
        if (record.playerId === numId && record.status === 'pending') {
            if (bot) {
                const alive = await verifyPromotionMessageExists(record, bot, discordConfig);
                if (!alive) {
                    record.status = 'deleted';
                    record.reviewedAt = Date.now();
                    record.reviewReason = 'Discord message deleted through Discord';
                    await persistRecord(record);
                    console.log(`[Promotions] Cleared deleted promotion request ${record.id} for player ${numId} (Discord message was deleted).`);
                    continue;
                }
            }
            return record;
        }
    }
    return null;
}

/**
 * Event handler triggered when a message is deleted in Discord.
 * If the message corresponds to a pending promotion request, mark it deleted immediately.
 */
async function handleDiscordMessageDeleted(messageId) {
    if (!messageId) return false;
    let found = false;
    for (const record of promotionsStore.values()) {
        if (record.messageId === messageId && record.status === 'pending') {
            record.status = 'deleted';
            record.reviewedAt = Date.now();
            record.reviewReason = 'Discord message deleted through Discord';
            await persistRecord(record);
            console.log(`[Promotions] Promotion request ${record.id} for player ${record.playerId} was automatically cleared because its Discord message ${messageId} was deleted.`);
            found = true;
        }
    }
    return found;
}

/**
 * Sweep all pending requests on startup / ready and clean up any requests whose Discord messages are gone.
 */
async function reconcilePromotionRequests(bot, discordConfig = null) {
    if (!bot) return;
    try {
        let cleaned = 0;
        for (const record of promotionsStore.values()) {
            if (record.status === 'pending') {
                const alive = await verifyPromotionMessageExists(record, bot, discordConfig);
                if (!alive) {
                    record.status = 'deleted';
                    record.reviewedAt = Date.now();
                    record.reviewReason = 'Discord message deleted through Discord';
                    await persistRecord(record);
                    cleaned++;
                    console.log(`[Promotions] Reconciled: Cleared orphan promotion request ${record.id} for player ${record.playerId} (message deleted).`);
                }
            }
        }
        if (cleaned > 0) {
            console.log(`[Promotions] Reconciled ${cleaned} deleted/orphan promotion requests.`);
        }
    } catch (err) {
        console.warn('[Promotions] Error during reconciliation:', err.message);
    }
}

/**
 * Cancel and withdraw a promotion request.
 */
async function cancelPromotionRequest(id, reviewerId, reviewerName, bot = null) {
    const record = promotionsStore.get(id);
    if (!record) return null;

    record.status = 'cancelled';
    record.reviewedBy = String(reviewerId);
    record.reviewedByName = String(reviewerName);
    record.reviewedAt = Date.now();
    record.reviewReason = 'Cancelled by ' + (String(reviewerId) === record.discordUserId ? 'applicant' : 'leadership');

    // Try deleting Discord message if it still exists
    if (bot && record.channelId && record.messageId) {
        try {
            const chan = bot.channels.cache.get(record.channelId) || await bot.channels.fetch(record.channelId).catch(() => null);
            if (chan && chan.isTextBased()) {
                const msg = await chan.messages.fetch(record.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            }
        } catch(e) {}
    }

    await persistRecord(record);
    return record;
}

/**
 * Manually delete/clear all pending requests for a player.
 */
async function deletePendingRequestsForPlayer(playerId, reason = 'Manually cleared') {
    if (!playerId) return 0;
    const numId = Number(playerId);
    let count = 0;
    for (const record of promotionsStore.values()) {
        if (record.playerId === numId && record.status === 'pending') {
            record.status = 'deleted';
            record.reviewedAt = Date.now();
            record.reviewReason = reason;
            await persistRecord(record);
            count++;
        }
    }
    return count;
}

/**
 * Create and persist a new promotion request.
 */
async function createPromotionRequest({
    discordUserId,
    playerId,
    playerName,
    currentRole,
    requestedRole,
    reason,
    daysInFaction,
    guildId,
    level,
    rankAdvancement,
    statsProgression,
    lastAction = '',
    pastHistorySummary = ''
}) {
    const id = `promo_${Date.now()}_${playerId}`;
    const resolvedHistory = pastHistorySummary || formatPastHistorySummary(playerId);
    const record = {
        id,
        discordUserId: String(discordUserId),
        playerId: Number(playerId),
        playerName: String(playerName),
        currentRole: String(currentRole || 'Member'),
        requestedRole: String(requestedRole),
        daysInFaction: Number(daysInFaction) || 0,
        level: Number(level) || 0,
        lastAction: String(lastAction || ''),
        pastHistorySummary: String(resolvedHistory || 'First request on record'),
        rankAdvancement: String(rankAdvancement || ''),
        statsProgression: String(statsProgression || ''),
        reason: String(reason || '').trim(),
        guildId: String(guildId || ''),
        status: 'pending',
        createdAt: Date.now(),
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
        reviewReason: null,
        channelId: null,
        messageId: null
    };

    await persistRecord(record);
    return record;
}

/**
 * Review (approve or deny) a promotion request.
 */
async function reviewPromotionRequest(id, reviewerId, reviewerName, decision, reviewReason = '') {
    const record = promotionsStore.get(id);
    if (!record) return null;

    record.status = decision;
    record.reviewedBy = String(reviewerId);
    record.reviewedByName = String(reviewerName);
    record.reviewedAt = Date.now();
    record.reviewReason = reviewReason || '';

    await persistRecord(record);
    return record;
}

function getPromotionRequest(id) {
    return promotionsStore.get(id) || null;
}

/**
 * Dispatch notification of a new promotion request to the designated leadership channel.
 */
async function dispatchPromotionToLeadership(bot, guild, promoReq, discordConfig, facData) {
    if (!guild && !bot) return false;
    const targetChanId = discordConfig.promotionChannelId || discordConfig.leaderChannelId || discordConfig.leadershipChannelId || discordConfig.globalChannelId;
    if (!targetChanId) return false;

    try {
        const chan = guild
            ? (guild.channels.cache.get(targetChanId) || await guild.channels.fetch(targetChanId).catch(() => null))
            : (await bot.channels.fetch(targetChanId).catch(() => null));
        if (chan && chan.isTextBased()) {
            const { embed, actionRow } = buildLeadershipNotificationEmbed(promoReq, facData.positions, facData.name);
            const ping = discordConfig.leaderRoleId ? `<@&${discordConfig.leaderRoleId}>` : '';
            const msg = await chan.send({
                content: ping ? `${ping} 🎖️ **New Faction Promotion Request!**` : `🎖️ **New Faction Promotion Request!**`,
                embeds: [embed],
                components: [actionRow]
            });
            promoReq.messageId = msg.id;
            promoReq.channelId = chan.id;
            await persistRecord(promoReq);
            return true;
        }
    } catch(err) {
        console.warn('[Promotions] Error dispatching to leadership channel:', err.message);
    }
    return false;
}

module.exports = {
    initPromotionManager,
    getFactionData,
    isRestrictedPromotionRole,
    isPhantomUnusedRole,
    countEnabledPermissions,
    formatPositionPerks,
    getPositionPermissionDiff,
    formatNewPerksUnlocked,
    getRequestableFactionRoles,
    getRoleHierarchy,
    getRoleRankInfo,
    calculateRankMovement,
    getPlayerRequestHistory,
    formatPastHistorySummary,
    buildPromotionMenuEmbed,
    buildPromotionSelectMenu,
    buildPromotionModal,
    resolveModalRole,
    buildDenyReasonModal,
    buildLeadershipNotificationEmbed,
    buildReviewedNotificationEmbed,
    getPendingRequestForPlayer,
    verifyPromotionMessageExists,
    handleDiscordMessageDeleted,
    reconcilePromotionRequests,
    cancelPromotionRequest,
    deletePendingRequestsForPlayer,
    createPromotionRequest,
    reviewPromotionRequest,
    getPromotionRequest,
    dispatchPromotionToLeadership,
    persistRecord,
    promotionsStore
};
