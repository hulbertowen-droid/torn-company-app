/**
 * F.R.I.D.A.Y. - Spider-Verse Security Sentinel
 * Centralized Discord UI Design System
 */
'use strict';

const COLORS = {
    BRAND:   0xE63946,
    SUCCESS: 0x2ECC71,
    ERROR:   0xE74C3C,
    WARNING: 0xF39C12,
    INFO:    0x3498DB,
    ECONOMY: 0x1ABC9C,
    SPECIAL: 0x9B59B6,
    NEUTRAL: 0x2C2F33,
};

const FOOTER = { text: "F.R.I.D.A.Y. • Spider-Verse Security Sentinel" };

function embed(o) {
    return { footer: FOOTER, timestamp: new Date().toISOString(), ...(o || {}) };
}

function success(title, desc, fields) { return embed({ color: COLORS.SUCCESS, title, description: desc, fields: fields || [] }); }
function error(title, desc)           { return embed({ color: COLORS.ERROR,   title, description: desc }); }
function warning(title, desc, fields) { return embed({ color: COLORS.WARNING, title, description: desc, fields: fields || [] }); }
function info(title, desc, fields)    { return embed({ color: COLORS.INFO,    title, description: desc, fields: fields || [] }); }
function brand(title, desc, fields)   { return embed({ color: COLORS.BRAND,   title, description: desc, fields: fields || [] }); }
function economy(title, desc, fields) { return embed({ color: COLORS.ECONOMY, title, description: desc, fields: fields || [] }); }
function special(title, desc, fields) { return embed({ color: COLORS.SPECIAL, title, description: desc, fields: fields || [] }); }
function neutral(title, desc, fields) { return embed({ color: COLORS.NEUTRAL, title, description: desc, fields: fields || [] }); }

function loading(operation) {
    return embed({ color: COLORS.NEUTRAL, title: 'Please Wait', description: '_' + (operation || 'Processing request') + '..._' });
}
function permission(requiredRole) {
    const desc = requiredRole
        ? "You don't have permission to use this command.\n\n**Required Role:** " + requiredRole
        : "You don't have permission to use this command.";
    return embed({ color: COLORS.ERROR, title: 'Access Restricted', description: desc });
}
function empty(noun, detail) {
    const desc = detail ? 'There is no ' + noun + ' available.\n\n_' + detail + '_' : 'There is no ' + noun + ' available at this time.';
    return embed({ color: COLORS.NEUTRAL, title: 'No ' + noun, description: desc });
}
function apiError(context, tip) {
    const base = 'The Torn API did not return the required data for **' + (context || 'this request') + '**.';
    const desc = tip ? base + '\n\n' + tip : base + '\n\nPlease try again in a moment.';
    return embed({ color: COLORS.ERROR, title: 'Request Failed', description: desc });
}
function notConfigured(setting) {
    return embed({
        color: COLORS.WARNING,
        title: 'Setup Required',
        description: '**' + (setting || 'Torn API Key') + '** has not been configured. Ask a faction administrator to configure this in the F.R.I.D.A.Y. dashboard.'
    });
}

function player(name, id) {
    if (!name && !id) return '_Unknown Player_';
    if (!id) return '**' + name + '**';
    return '**[' + name + '](https://www.torn.com/profiles.php?XID=' + id + ')** `[' + id + ']`';
}
function playerShort(name, id) {
    if (!name && !id) return '_Unknown_';
    if (!id) return '**' + name + '**';
    return '**' + name + '** `[' + id + ']`';
}
function tornProfileUrl(id) { return 'https://www.torn.com/profiles.php?XID=' + id; }
function tornAttackUrl(id)  { return 'https://www.torn.com/page.php?sid=attack&user2ID=' + id; }
function playerField(label, name, id, inline) {
    return { name: label, value: player(name, id), inline: inline !== false };
}

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

function tsRelative(s) { return s ? '<t:' + Math.floor(s) + ':R>' : '--'; }
function tsShort(s)    { return s ? '<t:' + Math.floor(s) + ':f>' : '--'; }
function tsTime(s)     { return s ? '<t:' + Math.floor(s) + ':t>' : '--'; }
function msToUnix(ms)  { return Math.floor(ms / 1000); }
function dateToUnix(d) { return Math.floor(new Date(d).getTime() / 1000); }

function sep()        { return String.fromCharCode(0x2501).repeat(16); }
function blankField() { return { name: '\u200b', value: '\u200b', inline: true }; }

function primaryBtn(cid, label, emoji)   { const b = { type: 2, style: 1, custom_id: cid, label }; if (emoji) b.emoji = typeof emoji === 'string' ? { name: emoji } : emoji; return b; }
function secondaryBtn(cid, label, emoji) { const b = { type: 2, style: 2, custom_id: cid, label }; if (emoji) b.emoji = typeof emoji === 'string' ? { name: emoji } : emoji; return b; }
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
    const pinfo = { type: 2, style: 2, custom_id: 'page_info', label: 'Page ' + page + ' of ' + total, disabled: true };
    if (page <= 1)    prev.disabled = true;
    if (page >= total) next.disabled = true;
    return actionRow(prev, pinfo, next);
}

module.exports = {
    COLORS, FOOTER,
    embed, success, error, warning, info, brand, economy, special, neutral,
    loading, permission, empty, apiError, notConfigured,
    player, playerShort, playerField, tornProfileUrl, tornAttackUrl,
    num, money, stat,
    tsRelative, tsShort, tsTime, msToUnix, dateToUnix,
    sep, blankField,
    primaryBtn, secondaryBtn, dangerBtn, linkBtn, actionRow, paginator,
};
