/**
 * F.R.I.D.A.Y. - Spider-Verse Security Sentinel
 * Centralized Discord UI Design System
 * 
 * FRIDAY BOT UI STYLE GUIDE COMPLIANCE:
 * 1. ACCENT COLOR = STATE, NOT FEATURE (Gold: Pending, Blue: Info/Identity, Green: Success, Red: Locked/Danger, Teal: Report)
 * 2. ONE STRUCTURE PER EMBED CATEGORY (Action-request, Report, Onboarding/Info)
 * 3. FIXED ICON LEGEND (⏳, 🟢, 🔒, 🛡️, 👤, 🏠, 💰, 📋)
 * 4. ONE BRAND ICON (🕷️ everywhere)
 * 5. NO DUPLICATE DATA (Show user once per field: @Owen777 [3776908])
 * 6. LABEL EVERY NUMBER ("+3% since last update · 19.7% of total build")
 * 7. BUTTON HIERARCHY (Row 1 = primary actions max 2; Row 2 = secondary links)
 * 8. LOCKED FOOTER FORMAT ("F.R.I.D.A.Y • Spider-Verse Security Sentinel • Today at [time]")
 * 9. STATUS = COLOR + TEXT, ALWAYS ("🟢 Okay", "🔴 Hospital")
 */
'use strict';

// ── 1. ACCENT COLORS (STATE, NOT FEATURE) ───────────────────────────────────
const COLORS = Object.freeze({
    // Strict 5 state accent colors:
    GOLD:    0xF0B232, // 🟡 awaiting action / pending (#f0b232)
    AMBER:   0xF0B232, // 🟡
    BLUE:    0x3498DB, // 🔵 informational / identity
    GREEN:   0x2ECC71, // 🟢 success / completed
    RED:     0xE74C3C, // 🔴 locked / denied / danger
    TEAL:    0x1ABC9C, // 🟦 neutral data report (stats, logs)

    // Semantic aliases strictly mapping into the 5 state colors above:
    PENDING:   0xF0B232, // 🟡 awaiting action / pending
    AWAITING:  0xF0B232, // 🟡
    WARNING:   0xF0B232, // 🟡

    INFO:      0x3498DB, // 🔵 informational / identity
    IDENTITY:  0x3498DB, // 🔵

    SUCCESS:   0x2ECC71, // 🟢 success / completed
    COMPLETED: 0x2ECC71, // 🟢
    ONLINE:    0x2ECC71, // 🟢
    OKAY:      0x2ECC71, // 🟢

    LOCKED:    0xE74C3C, // 🔴 locked / denied / danger
    DENIED:    0xE74C3C, // 🔴
    DANGER:    0xE74C3C, // 🔴
    ERROR:     0xE74C3C, // 🔴
    BRAND:     0xE74C3C, // 🔴 Spider-Verse red (mapped to state RED)

    REPORT:    0x1ABC9C, // 🟦 neutral data report (stats, logs)
    STATS:     0x1ABC9C, // 🟦
    LOGS:      0x1ABC9C, // 🟦
    ECONOMY:   0x1ABC9C, // 🟦
    NEUTRAL:   0x1ABC9C, // 🟦
    SPECIAL:   0x3498DB, // 🔵
});

// ── 3 & 4. FIXED ICON LEGEND & BRAND ICON ───────────────────────────────────
const ICONS = Object.freeze({
    BRAND:        '🕷️', // 🕷️ One brand icon everywhere. Retire 🕸️.
    PENDING:      '⏳', // ⏳ pending
    OKAY:         '🟢', // 🟢 okay/online
    ONLINE:       '🟢', // 🟢 okay/online
    LOCKED:       '🔒', // 🔒 locked
    VERIFICATION: '🛡️', // 🛡️ verification
    USER:         '👤', // 👤 user
    VAULT:        '🏠', // 🏠 vault/treasury
    TREASURY:     '🏠', // 🏠 vault/treasury
    AMOUNT:       '💰', // 💰 amount
    STATUS:       '📋', // 📋 status
});

// ── 8. LOCKED FOOTER FORMAT ──────────────────────────────────────────────────
// Discord client natively appends " • Today at [time]" when timestamp is provided.
const FOOTER_TEXT = "F.R.I.D.A.Y • Spider-Verse Security Sentinel";
const FOOTER = Object.freeze({ text: FOOTER_TEXT });

function setFactionName(name) {
    // Locked footer text per Rule 8: do not change format.
    // Preserved for compatibility if called by server.js.
}

function embed(o) {
    return {
        footer: FOOTER,
        timestamp: new Date().toISOString(),
        ...(o || {})
    };
}

// State color helpers
function gold(title, desc, fields)    { return embed({ color: COLORS.GOLD,    title: ensureBrand(title), description: desc, fields: fields || [] }); }
function blue(title, desc, fields)    { return embed({ color: COLORS.BLUE,    title: ensureBrand(title), description: desc, fields: fields || [] }); }
function green(title, desc, fields)   { return embed({ color: COLORS.GREEN,   title: ensureBrand(title), description: desc, fields: fields || [] }); }
function red(title, desc, fields)     { return embed({ color: COLORS.RED,     title: ensureBrand(title), description: desc, fields: fields || [] }); }
function teal(title, desc, fields)    { return embed({ color: COLORS.TEAL,    title: ensureBrand(title), description: desc, fields: fields || [] }); }

// Semantic helpers mapping to the 5 state colors
function success(title, desc, fields) { return green(title, desc, fields); }
function error(title, desc, fields)   { return red(title, desc, fields); }
function warning(title, desc, fields) { return gold(title, desc, fields); }
function info(title, desc, fields)    { return blue(title, desc, fields); }
function brand(title, desc, fields)   { return red(title, desc, fields); }
function economy(title, desc, fields) { return teal(title, desc, fields); }
function special(title, desc, fields) { return blue(title, desc, fields); }
function neutral(title, desc, fields) { return teal(title, desc, fields); }

function loading(operation) {
    return embed({ color: COLORS.TEAL, title: `${ICONS.BRAND} Please Wait`, description: `_${operation || 'Processing request'}..._` });
}
function permission(requiredRole) {
    const desc = requiredRole
        ? `You don't have permission to use this command.\n\n**Required Role:** ${requiredRole}`
        : "You don't have permission to use this command.";
    return embed({ color: COLORS.RED, title: `${ICONS.LOCKED} Access Restricted`, description: desc });
}
function empty(noun, detail) {
    const desc = detail ? `There is no ${noun} available.\n\n_${detail}_` : `There is no ${noun} available at this time.`;
    return embed({ color: COLORS.TEAL, title: `${ICONS.BRAND} No ${noun}`, description: desc });
}
function apiError(context, tip) {
    const base = `The Torn API did not return the required data for **${context || 'this request'}**.`;
    const desc = tip ? `${base}\n\n${tip}` : `${base}\n\nPlease try again in a moment.`;
    return embed({ color: COLORS.RED, title: `${ICONS.BRAND} Request Failed`, description: desc });
}
function notConfigured(setting) {
    return embed({
        color: COLORS.GOLD,
        title: `${ICONS.BRAND} Setup Required`,
        description: `**${setting || 'Torn API Key'}** has not been configured. Ask a faction administrator to configure this in the dashboard.`
    });
}

// ── 4. BRAND ICON HELPER ─────────────────────────────────────────────────────
function ensureBrand(title) {
    if (!title) return `${ICONS.BRAND} F.R.I.D.A.Y`;
    // If title doesn't start with an emoji, prefix with brand icon 🕷️
    return title.startsWith('🕸') ? title.replace(/^🕸️?/, ICONS.BRAND) : title;
}

// ── 5. NO DUPLICATE DATA (FORMAT USER ONCE PER FIELD) ─────────────────────────
function user(discordId, tornName, tornId) {
    if (discordId && tornId) {
        return `<@${discordId}> [${tornId}]`;
    }
    if (discordId) {
        return `<@${discordId}>`;
    }
    if (tornName && tornId) {
        return `[**${tornName}** [${tornId}]](https://www.torn.com/profiles.php?XID=${tornId})`;
    }
    if (tornName) return `**${tornName}**`;
    if (tornId) return `[Player ${tornId}](https://www.torn.com/profiles.php?XID=${tornId})`;
    return '_Unknown User_';
}

function player(name, id) {
    if (!name && !id) return '_Unknown Player_';
    if (!id) return `**${name}**`;
    return `**[${name}](https://www.torn.com/profiles.php?XID=${id})** \`[${id}]\``;
}
function playerShort(name, id) {
    if (!name && !id) return '_Unknown_';
    if (!id) return `**${name}**`;
    return `**${name}** \`[${id}]\``;
}
function tornProfileUrl(id) { return `https://www.torn.com/profiles.php?XID=${id}`; }
function tornAttackUrl(id)  { return `https://www.torn.com/page.php?sid=attack&user2ID=${id}`; }
function playerField(label, name, id, inline) {
    return { name: label, value: player(name, id), inline: inline !== false };
}

// ── 9. STATUS = COLOR + TEXT, ALWAYS ─────────────────────────────────────────
function statusBadge(state, detail) {
    if (!state) return `${ICONS.OKAY} Okay`;
    const s = String(state).toLowerCase();
    if (s.includes('hospital') || s.includes('hosp')) return `🔴 Hospital${detail ? ` · ${detail}` : ''}`;
    if (s.includes('jail')) return `🔴 Jail${detail ? ` · ${detail}` : ''}`;
    if (s.includes('travel') || s.includes('abroad')) return `✈️ Traveling${detail ? ` · ${detail}` : ''}`;
    if (s.includes('okay') || s.includes('online')) return `${ICONS.OKAY} Okay`;
    if (s.includes('pending')) return `${ICONS.PENDING} Pending${detail ? ` · ${detail}` : ''}`;
    if (s.includes('verifying')) return `🔄 Verifying${detail ? ` · ${detail}` : ''}`;
    if (s.includes('fulfilled') || s.includes('completed')) return `${ICONS.OKAY} Fulfilled${detail ? ` · ${detail}` : ''}`;
    if (s.includes('cancelled') || s.includes('denied')) return `🔴 Cancelled${detail ? ` · ${detail}` : ''}`;
    if (s.includes('expired')) return `🔴 Expired${detail ? ` · ${detail}` : ''}`;
    if (s.includes('idle')) return `🟡 Idle`;
    if (s.includes('offline')) return `⚪ Offline`;
    return `${ICONS.OKAY} ${state}`;
}

// ── 2. ONE STRUCTURE PER EMBED CATEGORY ──────────────────────────────────────
/**
 * Category A: Action-Request Cards (vault, trades)
 * Labeled fields only, max 5 fields, in fixed order:
 * 1. What
 * 2. Who
 * 3. Result
 * 4. Status
 */
function actionRequestCard({ id, what, who, result, status, state = 'pending', extraField }) {
    let sideColor = COLORS.GOLD;
    let icon = ICONS.PENDING;
    const s = String(state).toLowerCase();
    if (s === 'fulfilled' || s === 'completed' || s === 'success') {
        sideColor = COLORS.GREEN;
        icon = ICONS.OKAY;
    } else if (s === 'cancelled' || s === 'denied' || s === 'expired' || s === 'locked') {
        sideColor = COLORS.RED;
        icon = ICONS.LOCKED;
    }

    const fields = [
        { name: `${ICONS.VAULT} What`, value: String(what), inline: true },
        { name: `${ICONS.USER} Who`, value: String(who), inline: true }
    ];

    if (result) {
        fields.push({ name: `📋 Result`, value: String(result), inline: true });
    }

    if (extraField && fields.length < 4) {
        fields.push({ name: extraField.name, value: extraField.value, inline: extraField.inline !== false });
    }

    fields.push({ name: `${ICONS.STATUS} Status`, value: String(status), inline: false });

    return {
        title: `${ICONS.BRAND} Vault Request #${id}`,
        color: sideColor,
        fields: fields.slice(0, 5), // strict max 5 labeled fields
        footer: FOOTER,
        timestamp: new Date().toISOString()
    };
}

/**
 * Category B: Report Cards (stats, logs)
 * Compact single-line summary + one stat row. No paragraphs.
 * Accent color = TEAL (neutral data report) or RED (if in danger state).
 */
function reportCard({ title, summaryLine, statRow, extraStats, state = 'report' }) {
    const isDanger = state === 'danger' || state === 'error' || state === 'panic';
    const sideColor = isDanger ? COLORS.RED : COLORS.TEAL;

    const fields = [];
    if (statRow && Array.isArray(statRow) && statRow.length > 0) {
        statRow.slice(0, 3).forEach(stat => {
            fields.push({ name: stat.name, value: stat.value, inline: true });
        });
    }

    if (extraStats && Array.isArray(extraStats)) {
        extraStats.slice(0, 3).forEach(stat => {
            fields.push({ name: stat.name, value: stat.value, inline: true });
        });
    }

    return {
        title: ensureBrand(title),
        description: summaryLine ? String(summaryLine).slice(0, 300) : '',
        color: sideColor,
        fields,
        footer: FOOTER,
        timestamp: new Date().toISOString()
    };
}

/**
 * Category C: Onboarding / Info Cards
 * Short bulleted steps, never dense paragraphs. If > 3 sentences, split into labeled fields.
 * Accent color = BLUE (informational/identity) or GOLD (awaiting action).
 */
function onboardingCard({ title, steps = [], fields = [], awaitingAction = false }) {
    const sideColor = awaitingAction ? COLORS.GOLD : COLORS.BLUE;
    const desc = steps.length > 0 ? steps.map(s => `• ${s}`).join('\n') : '';

    return {
        title: ensureBrand(title),
        description: desc,
        color: sideColor,
        fields: fields || [],
        footer: FOOTER,
        timestamp: new Date().toISOString()
    };
}

/**
 * Category C (Special Onboarding): Welcome & Verification Card
 * Preserves 100% of explanatory detail while strictly enforcing UI rules:
 * - Color: RED (0xE74C3C / LOCKED) when access is restricted, GOLD (0xF1C40F / AWAITING) when awaiting user action
 * - Intro: Short 1-2 sentence explanation of why access is locked (intel & privacy protection)
 * - Numbered list for standard verification path via torn.com/discord
 * - Sync details: Nickname synced to `Name [ID]` and roles unlocked
 * - Separated "Optional Power-Up" block for API Key integration (BS, gym, banking, alerts, AES-256 encryption)
 * - Troubleshooting / No Torn account guidance & Admin manual override command
 * - Strict button hierarchy: Action buttons on Row 1 (max 2), External links on Row 2
 */
function verificationCard(options = {}) {
    const {
        memberId = null,
        factionName = 'Spider-Verse',
        verifiedRoleId = null,
        isAwaitingAction = false
    } = options;

    const roleMention = verifiedRoleId ? `<@&${verifiedRoleId}>` : '`Verified`';
    const userIntro = memberId ? `Hey <@${memberId}>!\n\n` : '';

    return {
        title: `${ICONS.BRAND} Identity Verification — ${factionName} Sentinel`,
        description:
            `${userIntro}${ICONS.LOCKED} **Server Access Locked**\n` +
            `To protect faction intelligence, armory vaults, and member privacy, all channels remain locked until your Torn City identity is verified.`,
        color: isAwaitingAction ? COLORS.GOLD : COLORS.RED,
        thumbnail: { url: "https://www.torn.com/favicon.ico" },
        fields: [
            {
                name: `${ICONS.VERIFICATION} Standard Verification (Required)`,
                value:
                    `1️⃣ **Link Discord Account:** Open the **[Official Torn Discord](https://www.torn.com/discord)** and link your Discord account to Torn.\n` +
                    `2️⃣ **Confirm Verification:** Click **🛡️ Verify Me** below. F.R.I.D.A.Y will sync your server nickname to \`Name [ID]\` and automatically grant your ${roleMention} role and faction channel access.`,
                inline: false
            },
            {
                name: `⚡ Optional Power-Up: Pre-Link Your API Key`,
                value:
                    `Save time and unlock automated sentinel features! Click **🔑 Link API Key (Optional)** below to connect your Torn **Limited Access API Key**:\n` +
                    `• **Live Battle Stats:** On-demand stat audits and progress tracking with \`/bs\`.\n` +
                    `• **Gym & Travel Intelligence:** Real-time energy, nerve, and drug cooldown monitoring.\n` +
                    `• **Automated Vault Banking:** Instant withdrawal requests and balance tracking.\n` +
                    `🔒 **Security Guarantee:** Your key is encrypted with AES-256 in MongoDB, never shared or shown publicly, and never needs to be re-entered.`,
                inline: false
            },
            {
                name: `${ICONS.STATUS} Need Assistance or No Torn Account?`,
                value:
                    `• **New to Torn?** Create an account at **[torn.com](https://www.torn.com)** first.\n` +
                    `• **Admin Manual Override:** Server leadership can verify you manually using:\n` +
                    `  \`/verify user:${memberId ? `<@${memberId}>` : '@member'} player:YourTornID\`\n` +
                    `• **Questions?** Contact faction leadership or ask in the reception channel.`,
                inline: false
            }
        ],
        footer: FOOTER,
        timestamp: new Date().toISOString()
    };
}

function verificationButtons() {
    return buttonLayout(
        [
            primaryBtn('btn_verify_now', 'Verify Me', ICONS.VERIFICATION),
            secondaryBtn('btn_link_user_api_key', 'Link API Key (Optional)', '🔑')
        ],
        [
            linkBtn('https://www.torn.com/discord', 'Link at Torn.com/discord', ICONS.BRAND),
            linkBtn('https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2', 'Get API Key', '🔑')
        ]
    );
}

// ── 7. BUTTON HIERARCHY ──────────────────────────────────────────────────────
/**
 * Button Hierarchy Layout:
 * Row 1 = Primary actions only (max 2, e.g. Confirm / Cancel).
 * Row 2 = Secondary / External links, visually separated.
 * Never mix a primary action button and a link button in the same row.
 */
function buttonLayout(primaryActions = [], secondaryLinks = []) {
    const rows = [];
    if (primaryActions && primaryActions.length > 0) {
        // max 2 primary actions on Row 1
        rows.push({
            type: 1,
            components: primaryActions.slice(0, 2)
        });
    }
    if (secondaryLinks && secondaryLinks.length > 0) {
        // secondary or link buttons on Row 2 (up to 5)
        rows.push({
            type: 1,
            components: secondaryLinks.slice(0, 5)
        });
    }
    return rows;
}

// ── Formatting Utilities ─────────────────────────────────────────────────────
function num(n) {
    if (n === null || n === undefined || isNaN(n)) return '--';
    return Number(n).toLocaleString('en-US');
}
function money(n) {
    if (n === null || n === undefined || isNaN(n)) return '$--';
    return '$' + Number(n).toLocaleString('en-US');
}
function stat(n) {
    if (!n || isNaN(n)) return '--';
    n = Number(n);
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return n.toLocaleString();
}

function tsRelative(s) { return s ? `<t:${Math.floor(s)}:R>` : '--'; }
function tsShort(s)    { return s ? `<t:${Math.floor(s)}:f>` : '--'; }
function tsTime(s)     { return s ? `<t:${Math.floor(s)}:t>` : '--'; }
function msToUnix(ms)  { return Math.floor(ms / 1000); }
function dateToUnix(d) { return Math.floor(new Date(d).getTime() / 1000); }

function sep()        { return String.fromCharCode(0x2501).repeat(16); }
function blankField() { return { name: '\u200b', value: '\u200b', inline: true }; }

function primaryBtn(cid, label, emoji)   { const b = { type: 2, style: 1, custom_id: cid, label }; if (emoji) b.emoji = typeof emoji === 'string' ? { name: emoji } : emoji; return b; }
function secondaryBtn(cid, label, emoji) { const b = { type: 2, style: 2, custom_id: cid, label }; if (emoji) b.emoji = typeof emoji === 'string' ? { name: emoji } : emoji; return b; }
function successBtn(cid, label, emoji)   { const b = { type: 2, style: 3, custom_id: cid, label }; if (emoji) b.emoji = typeof emoji === 'string' ? { name: emoji } : emoji; return b; }
function dangerBtn(cid, label, emoji)    { const b = { type: 2, style: 4, custom_id: cid, label }; if (emoji) b.emoji = typeof emoji === 'string' ? { name: emoji } : emoji; return b; }
function linkBtn(url, label, emoji)      { const b = { type: 2, style: 5, url, label };             if (emoji) b.emoji = typeof emoji === 'string' ? { name: emoji } : emoji; return b; }
function actionRow() {
    const btns = [].concat.apply([], Array.from(arguments));
    return { type: 1, components: btns };
}
function paginator(page, total, baseId) {
    baseId = baseId || 'page';
    const prev  = secondaryBtn(baseId + '_' + (page - 1), 'Previous', '⬅️');
    const next  = secondaryBtn(baseId + '_' + (page + 1), 'Next', '➡️');
    const pinfo = { type: 2, style: 2, custom_id: 'page_info', label: `Page ${page} of ${total}`, disabled: true };
    if (page <= 1)     prev.disabled = true;
    if (page >= total) next.disabled = true;
    return actionRow(prev, pinfo, next);
}

function formatTimeAgo(dateOrMs) {
    if (!dateOrMs) return 'just now';
    const ms = typeof dateOrMs === 'number'
        ? (dateOrMs > 1e11 ? Date.now() - dateOrMs : dateOrMs)
        : Date.now() - new Date(dateOrMs).getTime();
    const elapsed = Math.max(1, Math.floor(Math.abs(ms) / 1000));

    if (elapsed < 60) {
        return `${elapsed} second${elapsed === 1 ? '' : 's'} ago`;
    }
    const mins = Math.floor(elapsed / 60);
    if (mins < 60) {
        return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    }
    const hours = Math.floor(mins / 60);
    if (hours < 24) {
        return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

module.exports = {
    COLORS, ICONS, FOOTER, FOOTER_TEXT, setFactionName,
    embed, gold, blue, green, red, teal,
    success, error, warning, info, brand, economy, special, neutral,
    loading, permission, empty, apiError, notConfigured,
    ensureBrand, user, formatUser: user, player, playerShort, playerField, tornProfileUrl, tornAttackUrl,
    statusBadge, formatStatus: statusBadge,
    actionRequestCard, reportCard, onboardingCard, verificationCard, verificationButtons, buttonLayout,
    num, money, stat,
    tsRelative, tsShort, tsTime, msToUnix, dateToUnix, formatTimeAgo, timeAgo: formatTimeAgo,
    sep, blankField,
    primaryBtn, secondaryBtn, successBtn, dangerBtn, linkBtn, actionRow, paginator,
};
