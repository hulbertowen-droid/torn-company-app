/**
 * F.R.I.D.A.Y. - Faction Promotion Management Engine
 * 
 * Provides:
 * - Dynamic retrieval of actual faction roles from Torn API (excluding Leader and Co-leader).
 * - Interactive Discord promotion menu and modal submission.
 * - Leadership dispatch, notifications, and 1-click Approve/Deny buttons.
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

// 5-minute cache for Torn faction data (positions + members)
let cachedFactionData = null;
let cachedFactionTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

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
        let added = 0;
        for (const doc of docs) {
            if (doc && doc.id && !promotionsStore.has(doc.id)) {
                promotionsStore.set(doc.id, doc);
                added++;
            }
        }
        if (added > 0) {
            savePromotionsToDisk();
            console.log(`[Promotions] Synced ${added} requests from MongoDB.`);
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
 * Format key perks/powers of a Torn faction position.
 */
function formatPositionPerks(posObj) {
    if (!posObj || typeof posObj !== 'object') return 'Standard member permissions';
    const perks = [];

    if (posObj.canUseEnergyRefill || posObj.canUseNerveRefill) perks.push('⚡ Energy/Nerve Refills');
    if (posObj.canLoanDragItem) perks.push('💊 Drug Armory Loans');
    if (posObj.canLoanBoosterItem) perks.push('💉 Booster Armory Loans');
    if (posObj.canManageOC2) perks.push('🎯 OC 2.0 Management');
    if (posObj.canManageWars) perks.push('⚔️ War Controls');
    if (posObj.canGiveMoney || posObj.canAdjustMemberBalance) perks.push('🏦 Vault Access');
    if (posObj.canManageApplications) perks.push('📋 Recruit Processing');
    if (posObj.canAccessFactionApi) perks.push('🔑 Faction API');
    if (posObj.canRetrieveLoanedArmory) perks.push('🛡️ Armory Retrieval');
    if (posObj.canSendNewsletter) perks.push('📬 Newsletters');

    if (perks.length === 0) {
        if (posObj.canLoanWeaponAndArmory) perks.push('⚔️ Weapon/Armory Loans');
        if (posObj.canUseMedicalItem) perks.push('🩹 Medical Armory Access');
    }

    return perks.length > 0 ? perks.join(' • ') : 'Basic Faction Access';
}

/**
 * Fetch live faction positions & members from Torn API (cached for 5 min).
 */
async function getFactionData(apiKey, facId = 52355, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedFactionData && (now - cachedFactionTimestamp < CACHE_TTL_MS)) {
        return cachedFactionData;
    }

    if (!apiKey) {
        return cachedFactionData || { name: 'Faction', id: facId, positions: {}, members: {} };
    }

    try {
        const res = await fetch(`https://api.torn.com/faction/${facId}?selections=basic,positions&key=${apiKey}`, {
            signal: AbortSignal.timeout(8000)
        });
        const data = await res.json();
        if (data && !data.error && data.positions) {
            cachedFactionData = {
                name: data.name || 'Spider-Verse',
                id: data.ID || facId,
                positions: data.positions || {},
                members: data.members || {}
            };
            cachedFactionTimestamp = now;
            return cachedFactionData;
        }
    } catch(err) {
        console.warn('[Promotions] Error fetching faction data from Torn API:', err.message);
    }

    return cachedFactionData || { name: 'Faction', id: facId, positions: {}, members: {} };
}

/**
 * Get all requestable roles (excluding Leader and Co-leader).
 */
function getRequestableFactionRoles(positionsObj) {
    if (!positionsObj || typeof positionsObj !== 'object') return [];
    return Object.keys(positionsObj).filter(roleName => !isRestrictedPromotionRole(roleName));
}

/**
 * Sort faction roles into an ordered progression hierarchy:
 * 1. Default role (default: 1) is entry base rank (Rank 1).
 * 2. Roles with fewer permissions come before roles with higher permissions.
 * 3. Ties preserve faction API order.
 */
function getRoleHierarchy(positionsObj) {
    if (!positionsObj || typeof positionsObj !== 'object') return [];
    const roles = getRequestableFactionRoles(positionsObj);

    return [...roles].sort((a, b) => {
        const posA = positionsObj[a] || {};
        const posB = positionsObj[b] || {};

        const isDefA = Boolean(posA.default == 1 || posA.default === true);
        const isDefB = Boolean(posB.default == 1 || posB.default === true);
        if (isDefA && !isDefB) return -1;
        if (!isDefA && isDefB) return 1;

        const countA = Object.keys(posA).filter(k => k !== 'title' && k !== 'default' && (posA[k] === 1 || posA[k] === true)).length;
        const countB = Object.keys(posB).filter(k => k !== 'title' && k !== 'default' && (posB[k] === 1 || posB[k] === true)).length;

        if (countA !== countB) return countA - countB;
        const keys = Object.keys(positionsObj);
        return keys.indexOf(a) - keys.indexOf(b);
    });
}

/**
 * Calculate how many ranks up/down a requested promotion moves the user.
 */
function calculateRankMovement(positionsObj, currentRole, requestedRole) {
    const hierarchy = getRoleHierarchy(positionsObj);
    const currIdx = hierarchy.findIndex(r => r.toLowerCase() === (currentRole || '').toLowerCase());
    const targetIdx = hierarchy.findIndex(r => r.toLowerCase() === (requestedRole || '').toLowerCase());

    const currRank = currIdx !== -1 ? currIdx + 1 : 1;
    const targetRank = targetIdx !== -1 ? targetIdx + 1 : currRank;
    const delta = targetRank - currRank;

    if (delta > 0) {
        return `⬆️ **+${delta} Rank${delta === 1 ? '' : 's'} Up** *(Rank ${currRank} ➔ Rank ${targetRank})*`;
    } else if (delta === 0) {
        return `➡️ **Lateral Move** *(Same tier: Rank ${currRank})*`;
    } else {
        return `⬇️ **${delta} Rank${Math.abs(delta) === 1 ? '' : 's'}** *(Rank ${currRank} ➔ Rank ${targetRank})*`;
    }
}

/**
 * Build the interactive Promotion Overview embed listing all actual faction roles.
 */
function buildPromotionMenuEmbed({ memberName, memberId, currentRole, daysInFaction, facName, positions }) {
    const requestableRoles = getRequestableFactionRoles(positions);

    const fields = requestableRoles.map(role => {
        const perks = formatPositionPerks(positions[role]);
        const isCurrent = (role.toLowerCase() === (currentRole || '').toLowerCase());
        return {
            name: `${isCurrent ? '📌' : '⭐'} ${role}${isCurrent ? ' *(Your Current Role)*' : ''}`,
            value: `• ${perks}`,
            inline: false
        };
    });

    return {
        title: `🎖️ ${facName} — Faction Promotion Request`,
        description: `Hey **${memberName}**! You are currently assigned as **${currentRole || 'Member'}** in **${facName}**${daysInFaction ? ` (${daysInFaction} days in faction)` : ''}.\n\n` +
                     `Below are the **official faction roles** currently active in our faction. You can request a promotion to any role below, and faction leadership will review your application.\n\n` +
                     `👑 **Note:** *Leader and Co-leader positions cannot be requested.*`,
        color: UI.COLORS.BRAND,
        fields,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };
}

/**
 * Build the StringSelectMenu listing requestable roles.
 */
function buildPromotionSelectMenu(positions, currentRole) {
    const requestableRoles = getRequestableFactionRoles(positions);

    const options = requestableRoles.map(role => {
        const posObj = positions[role];
        const perks = formatPositionPerks(posObj).replace(/[•*]/g, '').slice(0, 95);
        const isCurrent = (role.toLowerCase() === (currentRole || '').toLowerCase());
        let desc = (isCurrent ? 'Current Role: ' : 'Perks: ') + perks.replace(/[•*]/g, '');
        if (desc.length > 95) desc = desc.slice(0, 92) + '...';

        return new StringSelectMenuOptionBuilder()
            .setLabel(role.slice(0, 100))
            .setValue(role)
            .setDescription(desc)
            .setEmoji(isCurrent ? '📌' : '🎖️');
    });

    if (options.length === 0) return null;

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_promotion_role')
        .setPlaceholder('Select an official faction role to request...')
        .addOptions(options);

    return new ActionRowBuilder().addComponents(selectMenu);
}

/**
 * Build the modal for submitting the promotion pitch.
 */
function buildPromotionModal(selectedRole) {
    const cleanRole = String(selectedRole || '').slice(0, 40);
    const modal = new ModalBuilder()
        .setCustomId(`modal_promo_${encodeURIComponent(cleanRole)}`)
        .setTitle(`Promotion: ${cleanRole}`.slice(0, 45));

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

/**
 * Build the notification embed posted in the leadership channel.
 */
function buildLeadershipNotificationEmbed(promoReq, positions, facName) {
    const posObj = (positions && positions[promoReq.requestedRole]) || null;
    const perks = formatPositionPerks(posObj);
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
        description: `A faction member has requested a promotion to **${promoReq.requestedRole}** in **${facName || 'Spider-Verse'}**. Leadership can approve or deny below:`,
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
    const perks = formatPositionPerks(posObj);
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
                : `❌ **Denied** by <@${reviewerId}> (${reviewerName})`,
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
 * Check if user already has an active pending promotion request.
 */
function getPendingRequestForPlayer(playerId) {
    if (!playerId) return null;
    const numId = Number(playerId);
    for (const record of promotionsStore.values()) {
        if (record.playerId === numId && record.status === 'pending') {
            return record;
        }
    }
    return null;
}

/**
 * Create and persist a new promotion request.
 */
async function createPromotionRequest({ discordUserId, playerId, playerName, currentRole, requestedRole, reason, daysInFaction, guildId, level, rankAdvancement, statsProgression }) {
    const id = `promo_${Date.now()}_${playerId}`;
    const record = {
        id,
        discordUserId: String(discordUserId),
        playerId: Number(playerId),
        playerName: String(playerName),
        currentRole: String(currentRole || 'Member'),
        requestedRole: String(requestedRole),
        daysInFaction: Number(daysInFaction) || 0,
        level: Number(level) || 0,
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
        const chan = guild ? (guild.channels.cache.get(targetChanId) || await guild.channels.fetch(targetChanId).catch(() => null)) : (await bot.channels.fetch(targetChanId).catch(() => null));
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
            promotionsStore.set(promoReq.id, promoReq);
            savePromotionsToDisk();
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
    formatPositionPerks,
    getRequestableFactionRoles,
    getRoleHierarchy,
    calculateRankMovement,
    buildPromotionMenuEmbed,
    buildPromotionSelectMenu,
    buildPromotionModal,
    buildLeadershipNotificationEmbed,
    buildReviewedNotificationEmbed,
    getPendingRequestForPlayer,
    createPromotionRequest,
    reviewPromotionRequest,
    getPromotionRequest,
    dispatchPromotionToLeadership,
    promotionsStore
};
