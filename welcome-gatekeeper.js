'use strict';

const fs = require('fs');
const path = require('path');

const VALID_ACCESS_MODES = ['allow_all', 'separate_role', 'admin_approval'];

/**
 * Normalize access mode string cleanly to one of the 3 supported modes.
 */
function normalizeNonFactionAccessMode(raw) {
    const val = String(raw || '').trim().toLowerCase();
    if (val === 'separate_role' || val === 'separate' || val === 'guest_role') return 'separate_role';
    if (val === 'admin_approval' || val === 'approval' || val === 'require_admin' || val === 'admin') return 'admin_approval';
    return 'allow_all';
}

/**
 * Determine if a verified Torn player belongs to the website's configured faction.
 * When websiteFactionId is configured, perform a strict ID comparison so external
 * factions never falsely match on partial guild words.
 */
function checkFactionMembership({ playerFactionId, playerFactionName, websiteFactionId, guildName }) {
    const pFacStr = String(playerFactionId || '0').trim();
    const wFacStr = String(websiteFactionId || '').trim();

    if (wFacStr && wFacStr !== '0') {
        return pFacStr === wFacStr;
    }

    const facLower = String(playerFactionName || '').trim().toLowerCase();
    const gName = String(guildName || '').trim();
    const guildWord = gName.toLowerCase().replace(/the |server|initiative|faction|community/gi, '').trim();
    return Boolean(
        (guildWord.length >= 3 && facLower.includes(guildWord)) ||
        (gName && facLower === gName.toLowerCase())
    );
}

/**
 * Check whether the clicking/invoking member is a Server Administrator authorized
 * to authenticate non-faction joiners.
 */
function isServerAdminForApproval(interaction, cfg = {}) {
    if (!interaction || !interaction.user) return false;
    const uid = String(interaction.user.id || '');
    if (!uid) return false;

    if (uid === '992561850057240578') return true;
    if (cfg.personalDiscordId && uid === String(cfg.personalDiscordId)) return true;
    if (interaction.guild?.ownerId && String(interaction.guild.ownerId) === uid) return true;

    const member = interaction.member;
    if (member?.permissions) {
        try {
            if (typeof member.permissions.has === 'function' && member.permissions.has('Administrator')) {
                return true;
            }
            if (typeof member.permissions === 'string' && (BigInt(member.permissions) & 0x8n) === 0x8n) {
                return true;
            }
        } catch (_) {}
    }

    if (cfg.approvalAdminRoleId && member?.roles?.cache?.has?.(String(cfg.approvalAdminRoleId))) {
        return true;
    }

    return false;
}

/**
 * Persistent gatekeeper state & policy evaluator (per guild + discordUserId).
 */
function createWelcomeGatekeeper({ dataDir, onPersist } = {}) {
    const storeFile = dataDir ? path.join(dataDir, 'nonfaction_gatekeeper.json') : null;
    let state = {
        pendingApprovals: {}, // `${guildId}:${discordUserId}` -> record
        approvedUsers: {}     // `${guildId}:${discordUserId}` -> approval record
    };

    function loadFromDisk() {
        if (!storeFile) return;
        try {
            if (fs.existsSync(storeFile)) {
                const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
                if (parsed && typeof parsed === 'object') {
                    state.pendingApprovals = (parsed.pendingApprovals && typeof parsed.pendingApprovals === 'object') ? parsed.pendingApprovals : {};
                    state.approvedUsers = (parsed.approvedUsers && typeof parsed.approvedUsers === 'object') ? parsed.approvedUsers : {};
                }
            }
        } catch (err) {
            console.warn('[WelcomeGatekeeper] Failed loading state:', err.message);
        }
    }

    function saveState() {
        if (storeFile) {
            try {
                const dir = path.dirname(storeFile);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(storeFile, JSON.stringify(state, null, 2), 'utf8');
            } catch (err) {
                console.warn('[WelcomeGatekeeper] Failed saving state:', err.message);
            }
        }
        if (typeof onPersist === 'function') {
            try { onPersist(); } catch (_) {}
        }
    }

    function exportState() {
        return {
            pendingApprovals: { ...state.pendingApprovals },
            approvedUsers: { ...state.approvedUsers }
        };
    }

    function importState(saved) {
        if (!saved || typeof saved !== 'object') return;
        if (saved.pendingApprovals && typeof saved.pendingApprovals === 'object') {
            state.pendingApprovals = { ...state.pendingApprovals, ...saved.pendingApprovals };
        }
        if (saved.approvedUsers && typeof saved.approvedUsers === 'object') {
            state.approvedUsers = { ...state.approvedUsers, ...saved.approvedUsers };
        }
    }

    function makeKey(guildId, discordUserId) {
        return `${String(guildId || 'global').trim()}:${String(discordUserId || '').trim()}`;
    }

    function getApprovedRecord(guildId, discordUserId) {
        return state.approvedUsers[makeKey(guildId, discordUserId)] || null;
    }

    function getPendingApproval(guildId, discordUserId) {
        return state.pendingApprovals[makeKey(guildId, discordUserId)] || null;
    }

    function setApprovedRecord(guildId, discordUserId, record) {
        const key = makeKey(guildId, discordUserId);
        state.approvedUsers[key] = {
            ...record,
            guildId: String(guildId || 'global'),
            discordUserId: String(discordUserId),
            approvedAt: record?.approvedAt || Date.now()
        };
        if (state.pendingApprovals[key]) {
            state.pendingApprovals[key] = {
                ...state.pendingApprovals[key],
                status: record?.grantMode === 'verified' ? 'approved_verified' : 'approved_guest',
                reviewedBy: record?.approvedBy || null,
                reviewedByName: record?.approvedByName || null,
                reviewedAt: Date.now(),
                updatedAt: Date.now()
            };
        }
        saveState();
        return state.approvedUsers[key];
    }

    function upsertPendingApproval({
        guildId,
        discordUserId,
        discordTag,
        discordCreatedAt,
        playerId,
        playerName,
        playerLevel,
        playerAge,
        playerFactionId,
        playerFactionName,
        playerPosition,
        verificationSource
    }) {
        const key = makeKey(guildId, discordUserId);
        const existing = state.pendingApprovals[key];
        const now = Date.now();
        const isStillSamePending = existing &&
            existing.status === 'pending' &&
            String(existing.playerId || '') === String(playerId || '');

        state.pendingApprovals[key] = {
            id: key,
            guildId: String(guildId || 'global'),
            discordUserId: String(discordUserId),
            discordTag: String(discordTag || discordUserId),
            discordCreatedAt: Number(discordCreatedAt || 0),
            playerId: String(playerId || ''),
            playerName: String(playerName || 'Unknown'),
            playerLevel: Number(playerLevel || 0),
            playerAge: Number(playerAge || 0),
            playerFactionId: String(playerFactionId || '0'),
            playerFactionName: String(playerFactionName || 'None'),
            playerPosition: String(playerPosition || ''),
            verificationSource: String(verificationSource || 'Torn Verification'),
            status: 'pending',
            messageId: isStillSamePending ? (existing.messageId || null) : null,
            channelId: isStillSamePending ? (existing.channelId || null) : null,
            createdAt: isStillSamePending ? existing.createdAt : now,
            updatedAt: now
        };
        saveState();
        return {
            record: state.pendingApprovals[key],
            alreadyNotified: Boolean(isStillSamePending && existing?.messageId)
        };
    }

    function attachApprovalMessage(guildId, discordUserId, channelId, messageId) {
        const key = makeKey(guildId, discordUserId);
        if (!state.pendingApprovals[key]) return;
        state.pendingApprovals[key].channelId = String(channelId || '');
        state.pendingApprovals[key].messageId = String(messageId || '');
        state.pendingApprovals[key].updatedAt = Date.now();
        saveState();
    }

    function markDeniedOrKicked(guildId, discordUserId, status, reviewerId, reviewerName) {
        const key = makeKey(guildId, discordUserId);
        delete state.approvedUsers[key];
        const existing = state.pendingApprovals[key] || {
            id: key,
            guildId: String(guildId || 'global'),
            discordUserId: String(discordUserId)
        };
        state.pendingApprovals[key] = {
            ...existing,
            status,
            reviewedBy: String(reviewerId || ''),
            reviewedByName: String(reviewerName || 'Server Admin'),
            reviewedAt: Date.now(),
            updatedAt: Date.now()
        };
        saveState();
        return state.pendingApprovals[key];
    }

    function clearApprovalState(guildId, discordUserId) {
        const key = makeKey(guildId, discordUserId);
        let changed = false;
        if (state.approvedUsers[key]) { delete state.approvedUsers[key]; changed = true; }
        if (state.pendingApprovals[key]) { delete state.pendingApprovals[key]; changed = true; }
        if (changed) saveState();
    }

    /**
     * Evaluate exact role & gatekeeping action for a verified Torn identity.
     */
    function evaluateNonFactionPolicy({ cfg = {}, guildId, discordUserId, playerId, isOurFaction, isExplicitAdminAction = false }) {
        const mode = normalizeNonFactionAccessMode(cfg.nonFactionAccessMode);
        if (isOurFaction) {
            return {
                allowed: true,
                requiresAdminApproval: false,
                mode,
                grantFactionRoles: true,
                grantVerifiedRole: true,
                grantNonFactionRole: false,
                reason: 'faction_member'
            };
        }

        if (mode === 'allow_all') {
            return {
                allowed: true,
                requiresAdminApproval: false,
                mode,
                grantFactionRoles: false,
                grantVerifiedRole: true,
                grantNonFactionRole: false,
                reason: 'allow_all'
            };
        }

        if (mode === 'separate_role') {
            return {
                allowed: true,
                requiresAdminApproval: false,
                mode,
                grantFactionRoles: false,
                grantVerifiedRole: Boolean(cfg.nonFactionAlsoGrantVerified),
                grantNonFactionRole: true,
                reason: 'separate_role'
            };
        }

        // mode === 'admin_approval'
        if (isExplicitAdminAction) {
            const hasGuestRole = Boolean(cfg.nonFactionRoleId);
            return {
                allowed: true,
                requiresAdminApproval: false,
                mode,
                grantFactionRoles: false,
                grantVerifiedRole: !hasGuestRole || Boolean(cfg.nonFactionAlsoGrantVerified),
                grantNonFactionRole: hasGuestRole,
                reason: 'admin_override'
            };
        }

        const approved = getApprovedRecord(guildId, discordUserId);
        if (approved && (!approved.playerId || !playerId || String(approved.playerId) === String(playerId))) {
            const isVerifiedGrant = approved.grantMode === 'verified';
            return {
                allowed: true,
                requiresAdminApproval: false,
                mode,
                grantFactionRoles: false,
                grantVerifiedRole: isVerifiedGrant || Boolean(cfg.nonFactionAlsoGrantVerified),
                grantNonFactionRole: !isVerifiedGrant,
                approvedRecord: approved,
                reason: isVerifiedGrant ? 'admin_approved_verified' : 'admin_approved_guest'
            };
        }

        return {
            allowed: false,
            requiresAdminApproval: true,
            mode,
            grantFactionRoles: false,
            grantVerifiedRole: false,
            grantNonFactionRole: false,
            reason: 'pending_admin_approval'
        };
    }

    function buildAdminApprovalEmbed(record, cfg = {}, guildName = 'Server') {
        const facDisplay = (record.playerFactionId && record.playerFactionId !== '0')
            ? `${record.playerFactionName} [${record.playerFactionId}]${record.playerPosition ? ` · *${record.playerPosition}*` : ''}`
            : 'None (Factionless)';
        const discAgeStr = record.discordCreatedAt
            ? `<t:${Math.floor(record.discordCreatedAt / 1000)}:R>`
            : 'Unknown';
        const websiteFacDisplay = cfg.factionName
            ? `${cfg.factionName}${cfg.factionId ? ` [${cfg.factionId}]` : ''}`
            : (cfg.factionId ? `Faction [${cfg.factionId}]` : 'Configured Faction');

        return {
            title: `🔐 Non-Faction Join Approval Required`,
            description:
                `<@${record.discordUserId}> verified their Torn account, but is **not a member of ${websiteFacDisplay}**.\n` +
                `Because **Admin Authentication Mode** is enabled for **${guildName}**, their roles remain locked until a Server Administrator approves entry.`,
            color: 0xf59e0b,
            fields: [
                {
                    name: '👤 Torn Player',
                    value: `**[${record.playerName}](https://www.torn.com/profiles.php?XID=${record.playerId})** \`[${record.playerId}]\``,
                    inline: true
                },
                {
                    name: '🏢 Player Faction',
                    value: facDisplay,
                    inline: true
                },
                {
                    name: '📊 Level / Age',
                    value: `Lv ${record.playerLevel || '?'} · ${Number(record.playerAge || 0).toLocaleString('en-US')}d`,
                    inline: true
                },
                {
                    name: '💬 Discord User',
                    value: `<@${record.discordUserId}> (\`${record.discordTag}\`)`,
                    inline: true
                },
                {
                    name: '🕒 Discord Created',
                    value: discAgeStr,
                    inline: true
                },
                {
                    name: '🔎 Verification Source',
                    value: record.verificationSource || 'Torn Identity',
                    inline: true
                }
            ],
            footer: { text: `F.R.I.D.A.Y. Welcome Gatekeeper · ID: ${record.discordUserId}` },
            timestamp: new Date().toISOString()
        };
    }

    function buildAdminApprovalButtons(guildId, discordUserId, cfg = {}) {
        const hasSeparateRole = Boolean(cfg.nonFactionRoleId);
        const g = String(guildId);
        const u = String(discordUserId);
        const buttons = [];

        if (hasSeparateRole) {
            buttons.push({
                type: 2,
                style: 3,
                custom_id: `nf_approve_guest:${g}:${u}`,
                label: 'Approve (Guest Role)',
                emoji: { name: '🪪' }
            });
            buttons.push({
                type: 2,
                style: 1,
                custom_id: `nf_approve_verified:${g}:${u}`,
                label: 'Approve (Full Verified)',
                emoji: { name: '🛡️' }
            });
        } else {
            buttons.push({
                type: 2,
                style: 3,
                custom_id: `nf_approve_verified:${g}:${u}`,
                label: 'Approve Access',
                emoji: { name: '✅' }
            });
        }

        buttons.push({
            type: 2,
            style: 2,
            custom_id: `nf_deny:${g}:${u}`,
            label: 'Deny',
            emoji: { name: '❌' }
        });
        buttons.push({
            type: 2,
            style: 4,
            custom_id: `nf_kick:${g}:${u}`,
            label: 'Deny & Kick',
            emoji: { name: '🥾' }
        });

        return [{ type: 1, components: buttons.slice(0, 5) }];
    }

    function buildReviewedApprovalEmbed(record, decision, adminUserId, rolesAssigned = [], extraNote = '') {
        const isApproved = decision === 'approved_guest' || decision === 'approved_verified';
        const isKick = decision === 'kicked';
        const statusLabel = decision === 'approved_guest'
            ? 'APPROVED — NON-FACTION / GUEST ROLE'
            : decision === 'approved_verified'
                ? 'APPROVED — FULL VERIFIED ACCESS'
                : isKick
                    ? 'DENIED & REMOVED FROM SERVER'
                    : 'DENIED — REMAINS QUARANTINED';

        const color = isApproved ? 0x10b981 : 0xef4444;
        const fields = [
            {
                name: '👤 Torn Player',
                value: record.playerId
                    ? `**[${record.playerName}](https://www.torn.com/profiles.php?XID=${record.playerId})** \`[${record.playerId}]\``
                    : `<@${record.discordUserId}>`,
                inline: true
            },
            {
                name: '🏢 Player Faction',
                value: (record.playerFactionId && record.playerFactionId !== '0')
                    ? `${record.playerFactionName} [${record.playerFactionId}]`
                    : 'None (Factionless)',
                inline: true
            },
            {
                name: '⚖️ Decision',
                value: `**${statusLabel}** by <@${adminUserId}>`,
                inline: false
            }
        ];

        if (rolesAssigned.length > 0) {
            fields.push({ name: '🎖️ Roles Granted', value: rolesAssigned.join(', '), inline: false });
        }
        if (extraNote) {
            fields.push({ name: '📝 Note', value: extraNote, inline: false });
        }

        return {
            title: `${isApproved ? '✅' : '⛔'} Join Request ${isApproved ? 'Approved' : (isKick ? 'Denied & Kicked' : 'Denied')}`,
            description: `Reviewed <@${record.discordUserId}>'s external join request.`,
            color,
            fields,
            footer: { text: `F.R.I.D.A.Y. Welcome Gatekeeper · ID: ${record.discordUserId}` },
            timestamp: new Date().toISOString()
        };
    }

    loadFromDisk();

    return {
        getApprovedRecord,
        getPendingApproval,
        setApprovedRecord,
        upsertPendingApproval,
        attachApprovalMessage,
        markDeniedOrKicked,
        clearApprovalState,
        evaluateNonFactionPolicy,
        buildAdminApprovalEmbed,
        buildAdminApprovalButtons,
        buildReviewedApprovalEmbed,
        exportState,
        importState
    };
}

module.exports = {
    VALID_ACCESS_MODES,
    normalizeNonFactionAccessMode,
    checkFactionMembership,
    isServerAdminForApproval,
    createWelcomeGatekeeper
};
