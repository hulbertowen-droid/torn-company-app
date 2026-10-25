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

// ── 10. SLEEK & CALM UI DESIGN SYSTEM (MATCHING REFERENCE SPEC) ─────────────
const FILLED_BLOCK = '■'; // \u25A0 Black Square (matches font metrics of EMPTY_BLOCK)
const EMPTY_BLOCK  = '□'; // \u25A1 White Square (matches font metrics of FILLED_BLOCK)

// Discord ANSI color constants (0;{color}m format required by Discord syntax highlighter)
const ANSI_RESET   = '\u001b[0m';
const ANSI_GRAY    = '\u001b[0;30m';
const ANSI_RED     = '\u001b[0;31m';
const ANSI_GREEN   = '\u001b[0;32m';
const ANSI_YELLOW  = '\u001b[0;33m';
const ANSI_BLUE    = '\u001b[0;34m';
const ANSI_MAGENTA = '\u001b[0;35m';
const ANSI_CYAN    = '\u001b[0;36m';
const ANSI_WHITE   = '\u001b[0;37m';

/**
 * Generates the 10-block ANSI bar chart for Battle Stats:
 * STR in Red (0;31m)
 * DEF in Blue (0;34m)
 * SPD in Yellow (0;33m)
 * DEX in Green (0;32m)
 * Empty track in Dark Gray (0;30m)
 * Monospace aligned numbers (0;37m) and build percentages (0;30m)
 */
function generateBattleStatsAnsi(stats) {
    if (!stats) stats = {};
    const str = Number(stats.str ?? stats.strength ?? 0);
    const def = Number(stats.def ?? stats.defense ?? 0);
    const spd = Number(stats.spd ?? stats.speed ?? 0);
    const dex = Number(stats.dex ?? stats.dexterity ?? 0);
    const total = Number(stats.total ?? (str + def + spd + dex));
    const maxStat = Math.max(str, def, spd, dex, 1);
    const safeTotal = Math.max(total, str + def + spd + dex, 1);

    const items = [
        { label: 'STR', val: str, color: ANSI_RED },
        { label: 'DEF', val: def, color: ANSI_BLUE },
        { label: 'SPD', val: spd, color: ANSI_YELLOW },
        { label: 'DEX', val: dex, color: ANSI_GREEN },
    ];

    const maxNumLen = Math.max(...items.map(i => i.val.toLocaleString('en-US').length));

    const lines = items.map(item => {
        const ratio = Math.min(1, Math.max(0, item.val / maxStat));
        const filledCount = Math.round(ratio * 10);
        const emptyCount = Math.max(0, 10 - filledCount);

        const filledBars = item.color + FILLED_BLOCK.repeat(filledCount);
        const emptyBars = ANSI_GRAY + EMPTY_BLOCK.repeat(emptyCount) + ANSI_RESET;

        const pct = ((item.val / safeTotal) * 100).toFixed(1) + '%';
        const numStr = item.val.toLocaleString('en-US').padStart(maxNumLen, ' ');
        const pctStr = pct.padStart(5, ' ');

        return `${item.color}${item.label}${ANSI_RESET} ${filledBars}${emptyBars}  ${ANSI_WHITE}${numStr}${ANSI_RESET}  ${ANSI_GRAY}${pctStr}${ANSI_RESET}`;
    });

    return '```ansi\n' + lines.join('\n') + '\n```';
}

/**
 * Generates the 10-block ANSI bar chart for Player Vitals (Energy, Nerve, Happy, Life):
 * NRG in Green (0;32m)
 * NRV in Yellow (0;33m)
 * HPY in Blue (0;34m)
 * LIF in Red (0;31m)
 * Empty track in Dark Gray (0;30m)
 */
function generateVitalsAnsi(vitals) {
    if (!vitals) vitals = {};
    const parseBar = (val, maxFallback) => {
        if (typeof val === 'number') return { cur: val, max: maxFallback };
        if (val && typeof val === 'object') {
            const cur = Number(val.current ?? val.cur ?? 0);
            const max = Number(val.maximum ?? val.max ?? maxFallback);
            return { cur, max };
        }
        return { cur: 0, max: maxFallback };
    };

    const energy = parseBar(vitals.energy ?? vitals.nrg, vitals.maxEnergy ?? 150);
    const nerve  = parseBar(vitals.nerve ?? vitals.nrv,  vitals.maxNerve ?? 50);
    const happy  = parseBar(vitals.happy ?? vitals.hpy,  vitals.maxHappy ?? 5000);
    const life   = parseBar(vitals.life ?? vitals.lif,   vitals.maxLife ?? 5000);

    const items = [
        { label: 'NRG', cur: energy.cur, max: energy.max, color: ANSI_GREEN },
        { label: 'NRV', cur: nerve.cur,  max: nerve.max,  color: ANSI_YELLOW },
        { label: 'HPY', cur: happy.cur,  max: happy.max,  color: ANSI_BLUE },
        { label: 'LIF', cur: life.cur,   max: life.max,   color: ANSI_RED },
    ];

    const maxValLen = Math.max(...items.map(i => `${i.cur.toLocaleString('en-US')}/${i.max.toLocaleString('en-US')}`.length));

    const lines = items.map(item => {
        const ratio = Math.min(1, Math.max(0, item.cur / Math.max(item.max || 1, 1)));
        const filledCount = Math.round(ratio * 10);
        const emptyCount = Math.max(0, 10 - filledCount);

        const filledBars = item.color + FILLED_BLOCK.repeat(filledCount);
        const emptyBars = ANSI_GRAY + EMPTY_BLOCK.repeat(emptyCount) + ANSI_RESET;

        const valStr = `${item.cur.toLocaleString('en-US')}/${item.max.toLocaleString('en-US')}`.padStart(maxValLen, ' ');
        const pct = ((ratio * 100).toFixed(0) + '%').padStart(4, ' ');

        return `${item.color}${item.label}${ANSI_RESET} ${filledBars}${emptyBars}  ${ANSI_WHITE}${valStr}${ANSI_RESET}  ${ANSI_GRAY}${pct}${ANSI_RESET}`;
    });

    return '```ansi\n' + lines.join('\n') + '\n```';
}

/**
 * Generates the 10-block ANSI Tug-of-War chart:
 * Friendly faction in Green (0;32m)
 * Enemy faction in Red (0;31m)
 * Empty track in Dark Gray (0;30m)
 */
function generateWarTugAnsi(war) {
    if (!war) war = {};
    const ourScore = Number(war.ourScore ?? war.ourPoints ?? 0);
    const theirScore = Number(war.theirScore ?? war.enemyScore ?? war.enemyPoints ?? 0);
    const ourName = war.ourName ?? 'US';
    const theirName = war.theirName ?? war.enemyName ?? 'THEM';

    const total = Math.max(1, ourScore + theirScore);
    const ourRatio = ourScore / total;
    const theirRatio = theirScore / total;

    const ourBars = Math.round(ourRatio * 10);
    const theirBars = Math.max(0, 10 - ourBars);

    const maxLabelLen = Math.min(10, Math.max((ourName || 'US').length, (theirName || 'THEM').length, 4));
    const ourLabel = (ourName || 'US').slice(0, maxLabelLen).padEnd(maxLabelLen, ' ');
    const theirLabel = (theirName || 'THEM').slice(0, maxLabelLen).padEnd(maxLabelLen, ' ');

    const ourNum = ourScore.toLocaleString('en-US');
    const theirNum = theirScore.toLocaleString('en-US');
    const maxNumLen = Math.max(ourNum.length, theirNum.length);

    const ourBarFilled = ANSI_GREEN + FILLED_BLOCK.repeat(ourBars);
    const ourBarEmpty = ANSI_GRAY + EMPTY_BLOCK.repeat(10 - ourBars) + ANSI_RESET;
    const theirBarFilled = ANSI_RED + FILLED_BLOCK.repeat(theirBars);
    const theirBarEmpty = ANSI_GRAY + EMPTY_BLOCK.repeat(10 - theirBars) + ANSI_RESET;

    const line1 = `${ANSI_GREEN}${ourLabel}${ANSI_RESET} ${ourBarFilled}${ourBarEmpty}  ${ANSI_WHITE}${ourNum.padStart(maxNumLen, ' ')}${ANSI_RESET}  ${ANSI_GRAY}${((ourRatio * 100).toFixed(1) + '%').padStart(6, ' ')}${ANSI_RESET}`;
    const line2 = `${ANSI_RED}${theirLabel}${ANSI_RESET} ${theirBarFilled}${theirBarEmpty}  ${ANSI_WHITE}${theirNum.padStart(maxNumLen, ' ')}${ANSI_RESET}  ${ANSI_GRAY}${((theirRatio * 100).toFixed(1) + '%').padStart(6, ' ')}${ANSI_RESET}`;

    return '```ansi\n' + line1 + '\n' + line2 + '\n```';
}

/**
 * Generates the 10-block ANSI Chain Tracker chart:
 * Hits in Green (0;32m)
 * Timer in Red/Yellow/Green based on remaining seconds
 * Empty track in Dark Gray (0;30m)
 */
function generateChainAnsi({ current = 0, max = 250, timeoutSec = 300, multiplier = 1.0 }) {
    const chainRatio = Math.min(1, Math.max(0, current / Math.max(max, 1)));
    const chainBars = Math.round(chainRatio * 10);

    const timerRatio = Math.min(1, Math.max(0, timeoutSec / 300));
    const timerBars = Math.round(timerRatio * 10);
    const timerColor = timeoutSec < 60 ? ANSI_RED : (timeoutSec < 120 ? ANSI_YELLOW : ANSI_GREEN);

    const m = Math.floor(Math.max(0, timeoutSec) / 60);
    const s = Math.floor(Math.max(0, timeoutSec) % 60);
    const timerStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const hitsStr = `${current.toLocaleString('en-US')}/${max.toLocaleString('en-US')}`;

    const maxValLen = Math.max(hitsStr.length, timerStr.length);

    const chainBarFilled = ANSI_GREEN + FILLED_BLOCK.repeat(chainBars);
    const chainBarEmpty = ANSI_GRAY + EMPTY_BLOCK.repeat(10 - chainBars) + ANSI_RESET;

    const timerBarFilled = timerColor + FILLED_BLOCK.repeat(timerBars);
    const timerBarEmpty = ANSI_GRAY + EMPTY_BLOCK.repeat(10 - timerBars) + ANSI_RESET;

    const line1 = `${ANSI_GREEN}HITS ${ANSI_RESET} ${chainBarFilled}${chainBarEmpty}  ${ANSI_WHITE}${hitsStr.padStart(maxValLen, ' ')}${ANSI_RESET}  ${ANSI_CYAN}${Number(multiplier).toFixed(2)}x${ANSI_RESET}`;
    const line2 = `${timerColor}TIME ${ANSI_RESET} ${timerBarFilled}${timerBarEmpty}  ${ANSI_WHITE}${timerStr.padStart(maxValLen, ' ')}${ANSI_RESET}  ${ANSI_GRAY}cooldown${ANSI_RESET}`;

    return '```ansi\n' + line1 + '\n' + line2 + '\n```';
}

/**
 * Generates the 10-block ANSI Vault Withdrawal chart:
 * PAYOUT in Yellow/Green (0;33m / 0;32m)
 * VAULT remaining in Blue/Cyan (0;34m / 0;36m)
 * Empty track in Dark Gray (0;30m)
 * Aligned currency amounts in White (0;37m)
 */
function generateWithdrawAnsi(req) {
    if (!req) req = {};
    const amount = Number(req.amount || 0);
    let vaultAfter = 0;
    if (req.remainingBalance !== undefined && req.remainingBalance !== null && Number(req.remainingBalance) >= 0) {
        vaultAfter = Number(req.remainingBalance);
    } else if (req.balanceAfter !== undefined && req.balanceAfter !== null) {
        vaultAfter = Number(req.balanceAfter);
    } else if (req.vaultAfter !== undefined && req.vaultAfter !== null) {
        vaultAfter = Number(req.vaultAfter);
    } else if (req.balanceBefore !== undefined && req.balanceBefore !== null) {
        vaultAfter = (req.status === 'cancelled' || req.status === 'expired')
            ? Number(req.balanceBefore)
            : Math.max(0, Number(req.balanceBefore) - amount);
    }

    const totalBefore = Math.max(
        amount + vaultAfter,
        Number(req.balanceBefore || 0),
        amount,
        1
    );

    const payoutRatio = Math.min(1, Math.max(0, amount / totalBefore));
    const vaultRatio = Math.min(1, Math.max(0, vaultAfter / totalBefore));

    const payoutBars = Math.round(payoutRatio * 10);
    const vaultBars = Math.round(vaultRatio * 10);

    const amtStr = `$${amount.toLocaleString('en-US')}`;
    const vaultStr = `$${vaultAfter.toLocaleString('en-US')}`;
    const maxValLen = Math.max(amtStr.length, vaultStr.length);

    let payoutColor = ANSI_YELLOW;
    let vaultColor = ANSI_BLUE;
    let payoutDesc = `${((payoutRatio * 100).toFixed(1) + '% of vault').padStart(15, ' ')}`;
    let vaultDesc = `${((vaultRatio * 100).toFixed(1) + '% remaining').padStart(15, ' ')}`;

    if (req.status === 'fulfilled') {
        payoutColor = ANSI_GREEN;
        payoutDesc = 'Paid in Torn'.padStart(15, ' ');
        vaultDesc = 'Current Vault'.padStart(15, ' ');
    } else if (req.status === 'cancelled' || req.status === 'expired') {
        payoutColor = ANSI_RED;
        payoutDesc = 'Cancelled'.padStart(15, ' ');
        vaultDesc = 'Preserved'.padStart(15, ' ');
    }

    const payoutFilled = payoutColor + FILLED_BLOCK.repeat(payoutBars);
    const payoutEmpty = ANSI_GRAY + EMPTY_BLOCK.repeat(10 - payoutBars) + ANSI_RESET;

    const vaultFilled = vaultColor + FILLED_BLOCK.repeat(vaultBars);
    const vaultEmpty = ANSI_GRAY + EMPTY_BLOCK.repeat(10 - vaultBars) + ANSI_RESET;

    const line1 = `${payoutColor}PAYOUT ${ANSI_RESET} ${payoutFilled}${payoutEmpty}  ${ANSI_WHITE}${amtStr.padStart(maxValLen, ' ')}${ANSI_RESET}  ${ANSI_GRAY}${payoutDesc}${ANSI_RESET}`;
    const line2 = `${vaultColor}VAULT  ${ANSI_RESET} ${vaultFilled}${vaultEmpty}  ${ANSI_WHITE}${vaultStr.padStart(maxValLen, ' ')}${ANSI_RESET}  ${ANSI_GRAY}${vaultDesc}${ANSI_RESET}`;

    return '```ansi\n' + line1 + '\n' + line2 + '\n```';
}

/**
 * Sleek Card Builder strictly matching the reference screenshot:
 * - Left accent line (Green for success/gains, Blue for view/info, Amber for warning, Red for danger)
 * - Author: Player [ID] with avatar and profile URL
 * - Title: Single emoji + clean title
 * - Large Discord H1 header (# <Value>)
 * - Subtitle / Badge pill (`+18,050` ⚖️ Archetype)
 * - ANSI block (dark inner card with 10-block colored bars)
 * - Note below: calm, muted sentence
 * - NO top-right thumbnail (guaranteed!)
 * - Locked footer + timestamp
 */
function sleekCard({
    color = COLORS.GREEN,
    authorName,
    authorIcon,
    authorUrl,
    title,
    heroValue,
    subtitle,
    ansiBlock,
    body,
    note,
    fields
}) {
    const descParts = [];
    if (heroValue) {
        descParts.push(`# ${heroValue}`);
    }
    if (subtitle) {
        descParts.push(subtitle);
    }
    if (descParts.length > 0) {
        descParts.push('');
    }
    if (ansiBlock) {
        descParts.push(ansiBlock);
    }
    if (body) {
        descParts.push(body);
    }
    if (note) {
        if (ansiBlock || body) descParts.push('');
        descParts.push(note);
    }

    const card = {
        color: typeof color === 'number' ? color : (COLORS[color] || COLORS.GREEN),
        title: title ? ensureBrand(title) : undefined,
        description: descParts.join('\n'),
        fields: fields || undefined,
        footer: FOOTER,
        timestamp: new Date().toISOString()
    };

    if (authorName) {
        card.author = {
            name: authorName,
            icon_url: authorIcon || undefined,
            url: authorUrl || undefined
        };
    }

    return card;
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
    FILLED_BLOCK, EMPTY_BLOCK, ANSI_RESET, ANSI_GRAY, ANSI_RED, ANSI_GREEN, ANSI_YELLOW, ANSI_BLUE, ANSI_MAGENTA, ANSI_CYAN, ANSI_WHITE,
    generateBattleStatsAnsi, generateVitalsAnsi, generateWarTugAnsi, generateChainAnsi, generateWithdrawAnsi, sleekCard
};
