'use strict';

/**
 * FactionOS OC 2.0 Personal DM Automations, Delivery Receipt Logger & Slash Command Engine.
 *
 * Extends F.R.I.D.A.Y. with:
 * 1. Four-way per-trigger delivery modes ('off' | 'channel_only' | 'dm_only' | 'both')
 *    for Low CPR, Unassigned Inactivity, Missing Required Items, and Ready Blockers.
 * 2. Tiered Torn <-> Discord resolution (saved links -> guild nickname [ID]/name scan -> Torn API).
 * 3. Persistent per-incident cooldowns, escalation grace timers, closed-DM (50007) fallback,
 *    and structured DM Delivery Receipt embeds + queryable history.
 * 4. Builders and interactive button handlers for /oc-items, /oc-lowcpr, /oc-bench,
 *    /oc-check, and /oc-link.
 */

const fs = require('fs');
const path = require('path');

const MAX_RECEIPTS = 200;
const GUILD_FETCH_TTL_MS = 60000;
const COMPLETED_OC_SEED_TTL_MS = 15 * 60 * 1000;
const REUSABLE_ITEM_IDS = new Set([1203, 1313, 1362, 1379, 1380, 1381, 1383, 1429]);

const DEFAULT_TEMPLATES = Object.freeze({
    low_cpr_dm:
        "Hi {player_name}, you joined **{crime_name} (Tier {tier})** in the **{role}** slot with a **{cpr}% CPR**, which is below the faction's **{min_cpr}%** minimum for this crime. Please leave this OC slot within **{grace_hours} hours** and join a lower-level OC (or a role where you meet the CPR floor), otherwise leadership will need to kick you from the crime so it doesn't fail.\n" +
        "Manage your OC here: https://www.torn.com/factions.php?step=your#/tab=crimes",
    inactive_oc_dm:
        "Hi {player_name}, you haven't joined an Organized Crime in **{hours_idle} hours**. Please head to the Faction Crimes tab and join an open OC that matches your CPR, or leadership may follow up.\n" +
        "Currently open Recruiting OCs: {open_ocs_summary}\n" +
        "Join here: https://www.torn.com/factions.php?step=your#/tab=crimes",
    missing_item_dm:
        "Hi {player_name}, your **{role}** slot in **{crime_name} (Tier {tier})** requires **{item_name}** (~${item_price} on Market), which is currently missing. Please acquire or borrow it before the crime executes ({time_remaining}) so the OC isn't delayed or failed.",
    ready_blocker_dm:
        "Hi {player_name}, your OC **{crime_name}** is ready to launch, and the crew is waiting on you (current status: **{status}**). Please return/med out when able so leadership can initiate!"
});

const TRIGGER_LABELS = Object.freeze({
    low_cpr_dm: 'Low CPR Warning',
    low_cpr_escalation: 'Low CPR Final Warning (Escalation)',
    inactive_oc_dm: 'OC Inactivity Reminder',
    missing_item_dm: 'Missing Role Item',
    ready_blocker_dm: 'Ready OC Blocker',
    manual_items_dm: 'Manual Manager DM (/oc-items)',
    manual_lowcpr_dm: 'Manual Manager DM (/oc-lowcpr)',
    manual_bench_dm: 'Manual Manager DM (/oc-bench)',
    test_dm: 'Admin Test DM'
});

const VALID_MODES = new Set(['off', 'channel_only', 'dm_only', 'both']);

function getDefaultOcDmConfig(existingOcConfig = {}) {
    const legacyMgrRole = String(existingOcConfig.ocManagerRoleId || '').replace(/[^0-9]/g, '');
    const defaultMin = Number(existingOcConfig.lowCprDefaultThreshold) || 70;
    const defaultLevels = (existingOcConfig.lowCprLevels && typeof existingOcConfig.lowCprLevels === 'object')
        ? { ...existingOcConfig.lowCprLevels }
        : { 1: 0, 2: 0, 3: 50, 4: 50, 5: 40, 6: 40, 7: 80, 8: 85 };

    return {
        enabled: false,
        fallbackChannelPingOnClosedDms: true,
        receiptsEnabled: true,
        receiptChannelId: '',
        ocManagerRoleIds: legacyMgrRole ? [legacyMgrRole] : [],
        exemptRoleIds: [],
        exemptTornIds: [],
        commandSettings: {
            'oc-items': { defaultEphemeral: false },
            'oc-lowcpr': { defaultEphemeral: false },
            'oc-bench': { defaultEphemeral: false },
            'oc-check': { defaultEphemeral: false },
            'oc-link': { defaultEphemeral: true }
        },
        triggers: {
            low_cpr_dm: {
                mode: 'off',
                globalMinCpr: defaultMin,
                tierFloors: defaultLevels,
                graceHours: 6,
                cooldownHours: 12,
                escalationEnabled: true,
                template: DEFAULT_TEMPLATES.low_cpr_dm
            },
            inactive_oc_dm: {
                mode: 'off',
                idleHours: Math.max(1, Math.round((Number(existingOcConfig.noParticipationDays) || 1) * 24)),
                cooldownHours: 48,
                offlineExemptDays: 7,
                exemptFedJailAndFallen: true,
                exemptOffline: true,
                exemptNewRecruits: true,
                exemptIdsAndRoles: true,
                template: DEFAULT_TEMPLATES.inactive_oc_dm
            },
            missing_item_dm: {
                mode: 'off',
                hoursBeforeExecution: 24,
                cooldownHours: 24,
                template: DEFAULT_TEMPLATES.missing_item_dm
            },
            ready_blocker_dm: {
                mode: 'off',
                withinMinutesBeforeReady: 60,
                cooldownHours: 4,
                template: DEFAULT_TEMPLATES.ready_blocker_dm
            }
        }
    };
}

function cleanIdArray(val) {
    const raw = Array.isArray(val)
        ? val
        : (typeof val === 'string' ? val.split(/[\s,;]+/) : []);
    return Array.from(new Set(
        raw.map(v => String(v || '').replace(/[^0-9]/g, '').trim()).filter(v => v.length >= 3)
    ));
}

function cleanSnowflakeArray(val) {
    return cleanIdArray(val).filter(v => /^\d{15,22}$/.test(v));
}

function mergeOcDmConfig(rawOcConfig = {}, incoming = null) {
    const base = getDefaultOcDmConfig(rawOcConfig);
    const saved = (rawOcConfig && rawOcConfig.ocDm && typeof rawOcConfig.ocDm === 'object') ? rawOcConfig.ocDm : {};
    const src = (incoming && typeof incoming === 'object') ? incoming : {};

    const pick = (k, def) => (src[k] !== undefined ? src[k] : (saved[k] !== undefined ? saved[k] : def));

    const mgrRoles = src.ocManagerRoleIds !== undefined
        ? cleanSnowflakeArray(src.ocManagerRoleIds)
        : (saved.ocManagerRoleIds !== undefined ? cleanSnowflakeArray(saved.ocManagerRoleIds) : base.ocManagerRoleIds);
    const legacyMgrRole = String(rawOcConfig.ocManagerRoleId || '').replace(/[^0-9]/g, '');
    if (legacyMgrRole && /^\d{15,22}$/.test(legacyMgrRole) && !mgrRoles.includes(legacyMgrRole)) {
        mgrRoles.unshift(legacyMgrRole);
    }

    const merged = {
        enabled: Boolean(pick('enabled', base.enabled)),
        fallbackChannelPingOnClosedDms: Boolean(pick('fallbackChannelPingOnClosedDms', base.fallbackChannelPingOnClosedDms)),
        receiptsEnabled: Boolean(pick('receiptsEnabled', base.receiptsEnabled)),
        receiptChannelId: String(pick('receiptChannelId', base.receiptChannelId) || '').replace(/[^0-9]/g, ''),
        ocManagerRoleIds: mgrRoles,
        exemptRoleIds: cleanSnowflakeArray(pick('exemptRoleIds', base.exemptRoleIds)),
        exemptTornIds: cleanIdArray(pick('exemptTornIds', base.exemptTornIds)),
        commandSettings: { ...base.commandSettings },
        triggers: { ...base.triggers }
    };

    const cmdSaved = saved.commandSettings || {};
    const cmdSrc = src.commandSettings || {};
    for (const cmdKey of Object.keys(base.commandSettings)) {
        const sVal = cmdSrc[cmdKey] || cmdSaved[cmdKey] || {};
        merged.commandSettings[cmdKey] = {
            defaultEphemeral: sVal.defaultEphemeral !== undefined
                ? Boolean(sVal.defaultEphemeral)
                : base.commandSettings[cmdKey].defaultEphemeral
        };
    }

    const trigSaved = saved.triggers || {};
    const trigSrc = src.triggers || {};

    for (const key of Object.keys(base.triggers)) {
        const bT = base.triggers[key];
        const svT = trigSaved[key] || {};
        const inT = trigSrc[key] || {};
        const rawMode = inT.mode ?? svT.mode ?? bT.mode;
        const mode = VALID_MODES.has(rawMode) ? rawMode : bT.mode;
        const tpl = (inT.template !== undefined ? String(inT.template) : (svT.template !== undefined ? String(svT.template) : bT.template)).trim() || bT.template;
        merged.triggers[key] = { ...bT, ...svT, ...inT, mode, template: tpl };
    }

    // Numeric clamping for safety
    const lc = merged.triggers.low_cpr_dm;
    lc.globalMinCpr = Math.max(1, Math.min(100, Number(lc.globalMinCpr) || Number(rawOcConfig.lowCprDefaultThreshold) || 70));
    lc.graceHours = Math.max(0.25, Math.min(168, Number(lc.graceHours) || 6));
    lc.cooldownHours = Math.max(0.25, Math.min(336, Number(lc.cooldownHours) || 12));
    lc.escalationEnabled = lc.escalationEnabled !== false;
    lc.tierFloors = { ...base.triggers.low_cpr_dm.tierFloors, ...(lc.tierFloors || {}) };

    const inact = merged.triggers.inactive_oc_dm;
    inact.idleHours = Math.max(1, Math.min(720, Number(inact.idleHours) || 24));
    inact.cooldownHours = Math.max(1, Math.min(336, Number(inact.cooldownHours) || 48));
    inact.offlineExemptDays = Math.max(1, Math.min(365, Number(inact.offlineExemptDays) || 7));
    inact.exemptFedJailAndFallen = inact.exemptFedJailAndFallen !== false;
    inact.exemptOffline = inact.exemptOffline !== false;
    inact.exemptNewRecruits = inact.exemptNewRecruits !== false;
    inact.exemptIdsAndRoles = inact.exemptIdsAndRoles !== false;

    const miss = merged.triggers.missing_item_dm;
    miss.hoursBeforeExecution = Math.max(0, Math.min(336, miss.hoursBeforeExecution !== undefined ? Number(miss.hoursBeforeExecution) : 24));
    miss.cooldownHours = Math.max(0.5, Math.min(168, Number(miss.cooldownHours) || 24));

    const blk = merged.triggers.ready_blocker_dm;
    blk.withinMinutesBeforeReady = Math.max(0, Math.min(1440, blk.withinMinutesBeforeReady !== undefined ? Number(blk.withinMinutesBeforeReady) : 60));
    blk.cooldownHours = Math.max(0.5, Math.min(168, Number(blk.cooldownHours) || 4));

    return merged;
}

function renderTemplate(templateStr, vars = {}) {
    return String(templateStr || '').replace(/\{([a-z0-9_]+)\}/gi, (_, k) => {
        const val = vars[k];
        return val !== undefined && val !== null ? String(val) : '';
    });
}

function formatTctTimestamp(ms = Date.now()) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} TCT`;
}

function formatDurationCompact(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return 'Now / Ready';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${Math.max(1, m)}m`;
}

function isReusableOcItem(itemRequirement, itemInfo = {}) {
    if (!itemRequirement) return false;
    if (typeof itemRequirement.is_reusable === 'boolean') return itemRequirement.is_reusable;
    const id = Number(itemRequirement.id || 0);
    if (REUSABLE_ITEM_IDS.has(id)) return true;
    return String(itemInfo.type || '').toLowerCase() === 'tool';
}

function createOcDmEngine(injectedDeps = {}) {
    const deps = {
        dataDir: path.join(__dirname, 'data'),
        getOcConfig: () => ({}),
        saveOcConfig: () => {},
        getDiscordConfig: () => ({}),
        getClient: () => null,
        getVerifiedDiscordMap: () => ({}),
        saveVerifiedDiscordMap: () => {},
        userKeys: null,
        getNextApiKey: () => null,
        getTornItemInfo: async () => ({ name: 'Required Item', market_value: 0, type: 'Utility' }),
        sendChannelMessage: async () => ({ success: false }),
        sendDirectMessageToUser: async () => ({ success: false }),
        getOcMemberHistory: () => ({}),
        saveOcMemberHistory: () => {},
        discordIdCache: {},
        UI: null,
        sanitizeEmbed: e => e,
        saveToMongo: () => {},
        ...injectedDeps
    };

    const STATE_FILE = path.join(deps.dataDir, 'oc_dm_state.json');

    let state = {
        incidents: {},
        receipts: [],
        manualLinks: {}
    };

    let lastGuildMemberFetchTs = 0;
    let guildFetchInFlight = null;
    let lastCompletedSeedTs = 0;
    let cachedCompletedSeedFac = '';
    let itemsCatalogCache = { ts: 0, items: {} };

    async function resolveItemDetails(itemId, slotReq = {}, apiKey = null) {
        const idNum = Number(itemId || 0);
        const now = Date.now();
        let catalogEntry = itemsCatalogCache.items?.[idNum] || null;
        if ((!catalogEntry || (now - itemsCatalogCache.ts) > 3600000) && apiKey && !slotReq.market_value) {
            try {
                if ((now - itemsCatalogCache.ts) > 3600000 || !itemsCatalogCache.items?.[idNum]) {
                    const res = await fetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(8000) });
                    const data = await res.json();
                    if (data?.items) {
                        itemsCatalogCache = { ts: now, items: data.items };
                        catalogEntry = data.items[idNum] || null;
                    }
                }
            } catch (_) {}
        }
        const fallbackInfo = await deps.getTornItemInfo(idNum, apiKey).catch(() => ({}));
        const itemName = catalogEntry?.name || fallbackInfo?.name || slotReq.name || `Item #${idNum}`;
        const marketPrice = Number(catalogEntry?.market_value || slotReq.market_value || fallbackInfo?.market_value || 0);
        const reusable = isReusableOcItem(slotReq, catalogEntry || fallbackInfo);
        return {
            itemName,
            marketPrice,
            itemPriceFmt: marketPrice > 0 ? marketPrice.toLocaleString('en-US') : 'Market',
            reusable
        };
    }

    function loadState() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
                if (parsed && typeof parsed === 'object') {
                    state.incidents = (parsed.incidents && typeof parsed.incidents === 'object') ? parsed.incidents : {};
                    state.receipts = Array.isArray(parsed.receipts) ? parsed.receipts.slice(0, MAX_RECEIPTS) : [];
                    state.manualLinks = (parsed.manualLinks && typeof parsed.manualLinks === 'object') ? parsed.manualLinks : {};
                }
            }
        } catch (e) {
            console.warn('[OC-DM Engine] Could not load oc_dm_state.json:', e.message);
        }
        return state;
    }

    function saveState() {
        try {
            if (!fs.existsSync(deps.dataDir)) fs.mkdirSync(deps.dataDir, { recursive: true });
            state.receipts = (state.receipts || []).slice(0, MAX_RECEIPTS);
            fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
        } catch (e) {
            console.warn('[OC-DM Engine] Could not persist oc_dm_state.json:', e.message);
        }
        try {
            if (typeof deps.saveToMongo === 'function') deps.saveToMongo();
        } catch (_) {}
    }

    function importFromMongo(mongoState) {
        if (!mongoState || typeof mongoState !== 'object') return;
        if (mongoState.incidents && typeof mongoState.incidents === 'object') {
            state.incidents = { ...state.incidents, ...mongoState.incidents };
        }
        if (mongoState.manualLinks && typeof mongoState.manualLinks === 'object') {
            state.manualLinks = { ...state.manualLinks, ...mongoState.manualLinks };
        }
        if (Array.isArray(mongoState.receipts)) {
            const seen = new Set(state.receipts.map(r => r.id));
            for (const r of mongoState.receipts) {
                if (r && r.id && !seen.has(r.id)) {
                    state.receipts.push(r);
                    seen.add(r.id);
                }
            }
            state.receipts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            state.receipts = state.receipts.slice(0, MAX_RECEIPTS);
        }
    }

    function exportForMongo() {
        return {
            incidents: state.incidents,
            receipts: state.receipts.slice(0, MAX_RECEIPTS),
            manualLinks: state.manualLinks
        };
    }

    loadState();

    function getConfig() {
        const ocCfg = deps.getOcConfig() || {};
        return mergeOcDmConfig(ocCfg);
    }

    function getActiveGuild(explicitGuild = null) {
        if (explicitGuild) return explicitGuild;
        const client = typeof deps.getClient === 'function' ? deps.getClient() : null;
        if (!client || !client.guilds) return null;
        const dCfg = deps.getDiscordConfig() || {};
        const targetId = String(dCfg.guildId || '').trim();
        return (targetId && client.guilds.cache.get(targetId)) || client.guilds.cache.first() || null;
    }

    async function ensureGuildMembers(guild, forceFetch = false) {
        if (!guild || !guild.members) return null;
        const cache = guild.members.cache;
        if (!forceFetch && (Date.now() - lastGuildMemberFetchTs) < GUILD_FETCH_TTL_MS) {
            return cache || null;
        }
        if (!forceFetch && cache && cache.size > 10) {
            lastGuildMemberFetchTs = Date.now();
            return cache;
        }
        if (guildFetchInFlight) {
            await guildFetchInFlight;
            return guild.members.cache || null;
        }
        lastGuildMemberFetchTs = Date.now();
        guildFetchInFlight = Promise.race([
            guild.members.fetch().catch(() => null),
            new Promise(resolve => setTimeout(() => resolve(null), 3000))
        ]).finally(() => {
            lastGuildMemberFetchTs = Date.now();
            guildFetchInFlight = null;
        });
        await guildFetchInFlight;
        return guild.members.cache || null;
    }

    function getConfiguredManagerRoleIds(ocDm) {
        const dCfg = deps.getDiscordConfig() || {};
        const ocCfg = deps.getOcConfig() || {};
        const set = new Set(cleanSnowflakeArray(ocDm?.ocManagerRoleIds));
        if (ocCfg.ocManagerRoleId && /^\d{15,22}$/.test(String(ocCfg.ocManagerRoleId).trim())) {
            set.add(String(ocCfg.ocManagerRoleId).trim());
        }
        if (dCfg.leaderRoleId && /^\d{15,22}$/.test(String(dCfg.leaderRoleId).trim())) {
            set.add(String(dCfg.leaderRoleId).trim());
        }
        return Array.from(set);
    }

    function isMemberOcManager(member, userId, guild = null) {
        const dCfg = deps.getDiscordConfig() || {};
        const ocCfg = deps.getOcConfig() || {};
        const ocDm = getConfig();
        const uid = String(userId || '').trim();

        if (!uid) return false;
        if (uid === '992561850057240578' || (dCfg.personalDiscordId && uid === String(dCfg.personalDiscordId).trim())) {
            return true;
        }
        if (member?.permissions?.has?.('Administrator')) return true;

        const explicitIds = cleanSnowflakeArray(ocCfg.ocManagerUserIds);
        if (explicitIds.includes(uid)) return true;

        const mgrRoles = getConfiguredManagerRoleIds(ocDm);
        if (mgrRoles.length > 0 && member?.roles?.cache) {
            for (const rId of mgrRoles) {
                if (member.roles.cache.has(rId)) return true;
            }
        }

        // Also check cached guild member if interaction.member wasn't full
        const activeGuild = guild || getActiveGuild();
        const gMember = activeGuild?.members?.cache?.get?.(uid);
        if (gMember) {
            if (gMember.permissions?.has?.('Administrator')) return true;
            if (mgrRoles.some(rId => gMember.roles?.cache?.has?.(rId))) return true;
        }
        return false;
    }

    function saveLink(tornId, discordId, tornName = '', source = 'manual', linkedBy = 'Admin') {
        const cleanTorn = String(tornId || '').replace(/[^0-9]/g, '');
        const cleanDisc = String(discordId || '').replace(/[^0-9]/g, '');
        if (!cleanTorn || !/^\d{15,22}$/.test(cleanDisc)) {
            throw new Error('Valid numeric Torn ID and 15-22 digit Discord User ID are required.');
        }

        state.manualLinks[cleanTorn] = {
            tornId: cleanTorn,
            discordId: cleanDisc,
            tornName: tornName || state.manualLinks[cleanTorn]?.tornName || '',
            source,
            linkedBy,
            linkedAt: Date.now()
        };

        const verifiedMap = deps.getVerifiedDiscordMap();
        if (verifiedMap && typeof verifiedMap === 'object') {
            // Remove stale mappings claiming the same tornId on a different Discord account if explicit override
            if (source === 'manual' || source === 'slash_oc_link') {
                for (const [dKey, entry] of Object.entries(verifiedMap)) {
                    if (String(entry?.tornId || '') === cleanTorn && dKey !== cleanDisc) {
                        delete verifiedMap[dKey];
                    }
                }
            }
            const existing = verifiedMap[cleanDisc] || {};
            verifiedMap[cleanDisc] = {
                ...existing,
                tornId: cleanTorn,
                tornName: tornName || existing.tornName || `Player [${cleanTorn}]`,
                timestamp: Date.now()
            };
            if (typeof deps.saveVerifiedDiscordMap === 'function') {
                deps.saveVerifiedDiscordMap();
            }
        }
        if (deps.discordIdCache) {
            deps.discordIdCache[cleanTorn] = cleanDisc;
        }
        saveState();
        return state.manualLinks[cleanTorn];
    }

    async function resolveMemberDiscord(tornId, tornName = '', options = {}) {
        const tornStr = String(tornId || '').replace(/[^0-9]/g, '');
        if (!tornStr) return { discordId: null, source: null, member: null };

        const guild = getActiveGuild(options.guild || null);
        const membersCache = guild ? await ensureGuildMembers(guild, Boolean(options.forceScan)) : null;
        const pickGuildMember = (dId) => (membersCache && dId ? membersCache.get(dId) || null : null);

        // 1. Saved mapping table (/oc-link, manual overrides, verified map, encrypted userKeys)
        const manual = state.manualLinks[tornStr];
        if (manual && /^\d{15,22}$/.test(String(manual.discordId || ''))) {
            return { discordId: manual.discordId, source: manual.source || 'manual_link', member: pickGuildMember(manual.discordId) };
        }

        const verifiedMap = deps.getVerifiedDiscordMap() || {};
        for (const [dId, val] of Object.entries(verifiedMap)) {
            const vTorn = String(val?.tornId || val || '');
            if (vTorn === tornStr && /^\d{15,22}$/.test(dId)) {
                return { discordId: dId, source: 'verified_map', member: pickGuildMember(dId) };
            }
        }

        if (deps.userKeys && typeof deps.userKeys.getAllConnectedMembers === 'function') {
            try {
                const connected = deps.userKeys.getAllConnectedMembers() || [];
                const hit = connected.find(m => String(m?.tornId || '') === tornStr && /^\d{15,22}$/.test(String(m?.discordUserId || '')));
                if (hit) {
                    return { discordId: String(hit.discordUserId), source: 'user_keys', member: pickGuildMember(String(hit.discordUserId)) };
                }
            } catch (_) {}
        }

        // 2. Fallback auto-match via Discord guild nicknames/displayNames (`[TornID]` or exact Torn name)
        if (membersCache && membersCache.size > 0) {
            const cleanName = String(tornName || '').trim().toLowerCase();
            let idMatch = null;
            let nameMatch = null;

            for (const [dId, gm] of membersCache) {
                if (gm.user?.bot) continue;
                const display = String(gm.displayName || gm.nickname || gm.user?.globalName || gm.user?.username || '');
                const bracketMatch = display.match(/\[(\d{3,10})\]/);
                if (bracketMatch && bracketMatch[1] === tornStr) {
                    idMatch = { discordId: dId, gm };
                    break;
                }
                if (!nameMatch && cleanName) {
                    const stripped = display.replace(/\[[^\]]+\]/g, '').trim().toLowerCase();
                    const uname = String(gm.user?.username || '').trim().toLowerCase();
                    if (stripped === cleanName || uname === cleanName) {
                        nameMatch = { discordId: dId, gm };
                    }
                }
            }

            const chosen = idMatch || nameMatch;
            if (chosen) {
                saveLink(tornStr, chosen.discordId, tornName, 'nickname_scan', 'Auto-Scan');
                return { discordId: chosen.discordId, source: 'nickname_scan', member: chosen.gm };
            }
        }

        // 3. Torn API discord linkage fallback if cached or allowed
        const cachedId = deps.discordIdCache?.[tornStr];
        if (cachedId && cachedId !== 'none' && /^\d{15,22}$/.test(cachedId)) {
            return { discordId: cachedId, source: 'torn_api_cache', member: pickGuildMember(cachedId) };
        }
        if (options.allowTornApiFallback !== false && cachedId !== 'none') {
            const k = options.apiKey || (typeof deps.getNextApiKey === 'function' ? deps.getNextApiKey() : null);
            if (k) {
                try {
                    const res = await fetch(`https://api.torn.com/user/${tornStr}?selections=discord&key=${encodeURIComponent(k)}`, {
                        signal: AbortSignal.timeout(5000)
                    });
                    const data = await res.json();
                    const rawD = String(data?.discord?.discordID || data?.discord?.discordId || data?.discord?.discord_id || '').trim();
                    if (/^\d{15,22}$/.test(rawD)) {
                        saveLink(tornStr, rawD, tornName, 'torn_api', 'Torn Discord Sync');
                        return { discordId: rawD, source: 'torn_api', member: pickGuildMember(rawD) };
                    }
                    if (deps.discordIdCache) deps.discordIdCache[tornStr] = 'none';
                } catch (_) {}
            }
        }

        return { discordId: null, source: null, member: null };
    }

    async function scanGuildNicknamesForLinks(factionMembers = {}, options = {}) {
        const guild = getActiveGuild(options.guild || null);
        const membersCache = guild ? await ensureGuildMembers(guild, true) : null;
        if (!membersCache || membersCache.size === 0) {
            return { scannedGuildMembers: 0, newlyLinked: 0, matched: [] };
        }

        const byTornId = {};
        const byLowerName = {};
        for (const [tid, m] of Object.entries(factionMembers || {})) {
            byTornId[String(tid)] = { id: String(tid), name: m?.name || `Player [${tid}]` };
            if (m?.name) byLowerName[String(m.name).trim().toLowerCase()] = String(tid);
        }

        const matched = [];
        let newlyLinked = 0;
        const verifiedMap = deps.getVerifiedDiscordMap() || {};

        for (const [dId, gm] of membersCache) {
            if (gm.user?.bot) continue;
            const display = String(gm.displayName || gm.nickname || gm.user?.globalName || gm.user?.username || '');
            let foundTid = null;
            const bMatch = display.match(/\[(\d{3,10})\]/);
            if (bMatch && (Object.keys(byTornId).length === 0 || byTornId[bMatch[1]])) {
                foundTid = bMatch[1];
            } else {
                const stripped = display.replace(/\[[^\]]+\]/g, '').trim().toLowerCase();
                const uname = String(gm.user?.username || '').trim().toLowerCase();
                foundTid = byLowerName[stripped] || byLowerName[uname] || null;
            }
            if (foundTid) {
                const already = (state.manualLinks[foundTid]?.discordId === dId) || (String(verifiedMap[dId]?.tornId || '') === foundTid);
                const tName = byTornId[foundTid]?.name || display.replace(/\[[^\]]+\]/g, '').trim();
                saveLink(foundTid, dId, tName, 'nickname_scan', 'Guild Scan');
                if (!already) newlyLinked++;
                matched.push({ tornId: foundTid, tornName: tName, discordId: dId, displayName: display });
            }
        }

        return { scannedGuildMembers: membersCache.size, newlyLinked, matched };
    }

    async function getFactionMemberLinkStatus(factionMembers = {}) {
        const guild = getActiveGuild();
        await ensureGuildMembers(guild, false);
        const rows = [];
        for (const [tid, m] of Object.entries(factionMembers || {})) {
            const resolved = await resolveMemberDiscord(tid, m?.name || '', { allowTornApiFallback: false, guild });
            rows.push({
                tornId: String(tid),
                playerName: m?.name || `Player [${tid}]`,
                position: m?.position || 'Member',
                level: Number(m?.level || 0),
                daysInFaction: m?.days_in_faction ?? null,
                discordId: resolved.discordId,
                source: resolved.source,
                linked: Boolean(resolved.discordId),
                discordTag: resolved.member?.displayName || resolved.member?.user?.username || null
            });
        }
        rows.sort((a, b) => Number(a.linked) - Number(b.linked) || a.playerName.localeCompare(b.playerName));
        return rows;
    }

    function recordReceipt(entry) {
        const rec = {
            id: `ocdm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
            tctTime: formatTctTimestamp(Date.now()),
            tornId: String(entry.tornId || ''),
            playerName: String(entry.playerName || 'Unknown'),
            discordId: entry.discordId || null,
            triggerType: entry.triggerType || 'unknown',
            triggerLabel: entry.triggerLabel || TRIGGER_LABELS[entry.triggerType] || entry.triggerType || 'OC Notice',
            context: String(entry.context || ''),
            status: entry.status || 'DELIVERED', // DELIVERED | FAILED_50007 | UNLINKED | FAILED_ERROR | ESCALATION | CHANNEL_ONLY
            errorCode: entry.errorCode || null,
            errorMessage: entry.errorMessage || null,
            messagePreview: String(entry.messagePreview || '').slice(0, 1200),
            fallbackPinged: Boolean(entry.fallbackPinged),
            nextEligibleAt: entry.nextEligibleAt || null,
            escalated: Boolean(entry.escalated),
            source: entry.source || 'auto'
        };
        state.receipts.unshift(rec);
        state.receipts = state.receipts.slice(0, MAX_RECEIPTS);
        saveState();
        return rec;
    }

    async function postReceiptEmbed(receipt) {
        const ocDm = getConfig();
        const dCfg = deps.getDiscordConfig() || {};
        if (!ocDm.receiptsEnabled || !ocDm.receiptChannelId || !dCfg.globalBotToken) return null;

        let borderColor = 0x10b981; // Emerald Delivered
        let titleText = '✅ DM Delivered';
        let statusText = 'Delivered';

        if (receipt.status === 'FAILED_50007') {
            borderColor = 0xf59e0b;
            titleText = receipt.fallbackPinged
                ? '⚠️ DM Failed (DMs Closed — Fallback Pinged)'
                : '⚠️ DM Failed (User Has Server DMs Disabled)';
            statusText = 'Failed (Error 50007)';
        } else if (receipt.status === 'UNLINKED') {
            borderColor = 0xef4444;
            titleText = '❌ Delivery Failed (Discord Account Unlinked)';
            statusText = 'Unlinked';
        } else if (receipt.status === 'ESCALATION') {
            borderColor = 0xf59e0b;
            titleText = '⚠️ Escalation — Kick Eligible';
            statusText = receipt.escalated ? 'Escalated to Leadership' : 'Escalation';
        } else if (receipt.status === 'FAILED_ERROR') {
            borderColor = 0xef4444;
            titleText = '❌ DM Delivery Error';
            statusText = receipt.errorMessage ? `Failed (${receipt.errorMessage})` : 'Failed';
        } else if (receipt.status === 'CHANNEL_ONLY') {
            borderColor = 0x38bdf8;
            titleText = '📢 Channel Alert Posted';
            statusText = 'Channel Only';
        }

        const recipientVal = receipt.discordId
            ? `${receipt.playerName} [${receipt.tornId}] — <@${receipt.discordId}>`
            : `${receipt.playerName} [${receipt.tornId}] — Unlinked`;

        const quoteLines = String(receipt.messagePreview || '—')
            .split('\n')
            .map(l => `> ${l}`)
            .join('\n')
            .slice(0, 980);

        const nowUnix = Math.floor((receipt.timestamp || Date.now()) / 1000);
        const nextLine = receipt.nextEligibleAt
            ? ` | Next eligible: <t:${Math.floor(receipt.nextEligibleAt / 1000)}:R>`
            : '';

        const receiptEmbed = {
            title: titleText,
            color: borderColor,
            fields: [
                { name: 'Recipient', value: recipientVal, inline: true },
                { name: 'Trigger', value: receipt.triggerLabel, inline: true },
                { name: 'Status', value: statusText, inline: true },
                { name: 'Context', value: receipt.context || 'Active OC Check', inline: false },
                { name: 'Message Sent', value: quoteLines, inline: false },
                { name: 'Timing', value: `${receipt.tctTime} (<t:${nowUnix}:R>)${nextLine}`, inline: false }
            ],
            footer: { text: `F.R.I.D.A.Y • OC DM Audit Receipt • ${receipt.tctTime}` },
            timestamp: new Date(receipt.timestamp || Date.now()).toISOString()
        };

        return deps.sendChannelMessage(dCfg.globalBotToken, ocDm.receiptChannelId, receiptEmbed, '', true).catch(() => null);
    }

    async function dispatchTrackedOcDm({
        tornId,
        playerName,
        explicitDiscordId = null,
        triggerType,
        triggerLabel,
        context,
        messageText,
        embedTitle,
        embedColor = 0xf59e0b,
        cooldownMs = 12 * 3600000,
        allowFallbackPing = true,
        source = 'auto'
    }) {
        const ocDm = getConfig();
        const dCfg = deps.getDiscordConfig() || {};
        const ocCfg = deps.getOcConfig() || {};
        const ocChannelId = ocCfg.globalChannelId || dCfg.ocChannelId || dCfg.globalChannelId;

        let resolved = explicitDiscordId
            ? { discordId: String(explicitDiscordId).replace(/[^0-9]/g, ''), source: 'explicit' }
            : await resolveMemberDiscord(tornId, playerName, { allowTornApiFallback: true });

        const nextEligibleAt = cooldownMs > 0 ? Date.now() + cooldownMs : null;

        if (!resolved.discordId) {
            let fallbackPinged = false;
            if (allowFallbackPing && ocDm.fallbackChannelPingOnClosedDms && ocChannelId && dCfg.globalBotToken) {
                const fbEmbed = {
                    title: `⚠️ OC Notice (Discord Account Unlinked): ${playerName} [${tornId}]`,
                    description: `${messageText}\n\n💡 *Link your Discord to F.R.I.D.A.Y via \`/oc-link torn_id:${tornId}\` to receive these privately via DM.*`,
                    color: 0xef4444,
                    timestamp: new Date().toISOString()
                };
                const chRes = await deps.sendChannelMessage(dCfg.globalBotToken, ocChannelId, fbEmbed, `${playerName} [${tornId}]`).catch(() => null);
                fallbackPinged = Boolean(chRes?.success);
            }

            const receipt = recordReceipt({
                tornId,
                playerName,
                discordId: null,
                triggerType,
                triggerLabel,
                context,
                status: 'UNLINKED',
                errorCode: 'UNLINKED',
                errorMessage: 'No Discord User ID mapped to this Torn ID',
                messagePreview: messageText,
                fallbackPinged,
                nextEligibleAt,
                source
            });
            await postReceiptEmbed(receipt);
            return { success: false, status: 'UNLINKED', receipt };
        }

        const dmEmbed = {
            title: embedTitle || `💼 OC Notice: ${triggerLabel || TRIGGER_LABELS[triggerType] || 'Action Required'}`,
            description: messageText,
            color: embedColor,
            fields: [
                { name: 'Context', value: context || 'Faction Organized Crimes 2.0', inline: false }
            ],
            footer: { text: `F.R.I.D.A.Y • Personal OC Assistant • ${formatTctTimestamp()}` },
            timestamp: new Date().toISOString()
        };

        const dmResult = await deps.sendDirectMessageToUser(resolved.discordId, dmEmbed);

        if (dmResult?.success) {
            const receipt = recordReceipt({
                tornId,
                playerName,
                discordId: resolved.discordId,
                triggerType,
                triggerLabel,
                context,
                status: 'DELIVERED',
                messagePreview: messageText,
                fallbackPinged: false,
                nextEligibleAt,
                source
            });
            await postReceiptEmbed(receipt);
            return { success: true, status: 'DELIVERED', discordId: resolved.discordId, receipt };
        }

        const isClosedDms = Number(dmResult?.code) === 50007 || dmResult?.closedDms === true || String(dmResult?.error || '').includes('50007');
        let fallbackPinged = false;

        if (isClosedDms && allowFallbackPing && ocDm.fallbackChannelPingOnClosedDms && ocChannelId && dCfg.globalBotToken) {
            const fbEmbed = {
                title: `📬 OC Reminder (Closed DMs Fallback): ${playerName}`,
                description: `${messageText}\n\n🔒 *Could not DM <@${resolved.discordId}> directly (Server DMs disabled).*`,
                color: 0xf59e0b,
                timestamp: new Date().toISOString()
            };
            const fbRes = await deps.sendChannelMessage(dCfg.globalBotToken, ocChannelId, fbEmbed, `<@${resolved.discordId}>`).catch(() => null);
            fallbackPinged = Boolean(fbRes?.success);
        }

        const receipt = recordReceipt({
            tornId,
            playerName,
            discordId: resolved.discordId,
            triggerType,
            triggerLabel,
            context,
            status: isClosedDms ? 'FAILED_50007' : 'FAILED_ERROR',
            errorCode: isClosedDms ? 50007 : (dmResult?.code || 'SEND_ERROR'),
            errorMessage: dmResult?.error || 'DM dispatch failed',
            messagePreview: messageText,
            fallbackPinged,
            nextEligibleAt,
            source
        });
        await postReceiptEmbed(receipt);
        return {
            success: false,
            status: receipt.status,
            errorCode: receipt.errorCode,
            discordId: resolved.discordId,
            fallbackPinged,
            receipt
        };
    }

    function getTierMinCpr(tierNum, ocDm, rawOcConfig) {
        const tierKey = String(tierNum || 1);
        const dmFloors = ocDm?.triggers?.low_cpr_dm?.tierFloors;
        if (dmFloors && dmFloors[tierKey] !== undefined && dmFloors[tierKey] !== null && dmFloors[tierKey] !== '') {
            return Number(dmFloors[tierKey]);
        }
        const cfgFloors = rawOcConfig?.lowCprLevels;
        if (cfgFloors && cfgFloors[tierKey] !== undefined && cfgFloors[tierKey] !== null && cfgFloors[tierKey] !== '') {
            return Number(cfgFloors[tierKey]);
        }
        return Number(ocDm?.triggers?.low_cpr_dm?.globalMinCpr ?? rawOcConfig?.lowCprDefaultThreshold ?? 70);
    }

    async function seedOcHistoryFromCompleted(fid, apiKey) {
        if (!fid || !apiKey) return;
        if (cachedCompletedSeedFac === String(fid) && (Date.now() - lastCompletedSeedTs) < COMPLETED_OC_SEED_TTL_MS) return;
        try {
            const res = await fetch(`https://api.torn.com/v2/faction/${fid}/crimes?cat=completed&limit=100&key=${encodeURIComponent(apiKey)}`, {
                signal: AbortSignal.timeout(8000)
            });
            const data = await res.json();
            const crimes = Array.isArray(data?.crimes) ? data.crimes : [];
            const hist = deps.getOcMemberHistory() || {};
            let changed = false;
            for (const c of crimes) {
                const ts = Number(c.executed_at || c.ready_at || c.created_at || 0);
                if (!ts) continue;
                for (const s of (c.slots || [])) {
                    const pid = s?.user?.id;
                    if (!pid) continue;
                    const key = String(pid);
                    if ((hist[key] || 0) < ts) {
                        hist[key] = ts;
                        changed = true;
                    }
                }
            }
            if (changed && typeof deps.saveOcMemberHistory === 'function') {
                deps.saveOcMemberHistory(hist);
            }
            cachedCompletedSeedFac = String(fid);
            lastCompletedSeedTs = Date.now();
        } catch (_) {}
    }

    function buildOpenOcsSummary(v2Crimes = []) {
        const recruiting = [];
        for (const c of (v2Crimes || [])) {
            if (String(c.status || '').toLowerCase() !== 'recruiting') continue;
            const emptyCount = (c.slots || []).filter(s => !s.user).length;
            if (emptyCount > 0) {
                recruiting.push(`T${c.difficulty || '?'} ${c.name} (${emptyCount} open)`);
            }
        }
        if (recruiting.length === 0) return 'None open right now (ask leadership to spawn an OC)';
        return recruiting.slice(0, 4).join(', ') + (recruiting.length > 4 ? ` +${recruiting.length - 4} more` : '');
    }

    async function processOcMonitoringTick({
        fid,
        apiKey,
        v1Crimes = {},
        v2Crimes = [],
        members = {},
        activeOcMemberIds = new Set(),
        channelId = '',
        mention = '',
        botToken = ''
    }) {
        const ocDm = getConfig();
        const ocCfg = deps.getOcConfig() || {};
        const dCfg = deps.getDiscordConfig() || {};
        const nowSec = Math.floor(Date.now() / 1000);
        const nowMs = Date.now();

        if (fid && apiKey) {
            await seedOcHistoryFromCompleted(fid, apiKey);
        }

        // Reconcile active incidents so resolved issues auto-clear immediately
        let stateChanged = false;
        const activeLowCprKeys = new Set();
        const activeMissingKeys = new Set();
        const activeBlockerKeys = new Set();

        for (const c of (v2Crimes || [])) {
            const tier = Number(c.difficulty || 1);
            const minCpr = getTierMinCpr(tier, ocDm, ocCfg);
            const isPlanningOrReady = String(c.status || '').toLowerCase() === 'planning' || (c.ready_at && c.ready_at <= nowSec + 3600);
            for (const slot of (c.slots || [])) {
                if (!slot?.user?.id) continue;
                const pid = String(slot.user.id);
                if (slot.checkpoint_pass_rate !== undefined && Number(slot.checkpoint_pass_rate) < minCpr) {
                    activeLowCprKeys.add(`low_cpr_dm:${pid}:${c.id}`);
                }
                if (slot.item_requirement && !slot.item_requirement.is_available) {
                    activeMissingKeys.add(`missing_item_dm:${pid}:${c.id}:${slot.item_requirement.id}`);
                }
                const mState = String(members[pid]?.status?.state || 'Okay').toLowerCase();
                if (isPlanningOrReady && mState !== 'okay') {
                    activeBlockerKeys.add(`ready_blocker_dm:${pid}:${c.id}`);
                }
            }
        }

        for (const [k, inc] of Object.entries(state.incidents)) {
            if (inc.triggerType === 'low_cpr_dm' && !activeLowCprKeys.has(k)) {
                delete state.incidents[k];
                stateChanged = true;
            } else if (inc.triggerType === 'inactive_oc_dm' && activeOcMemberIds.has(String(inc.tornId))) {
                delete state.incidents[k];
                stateChanged = true;
            } else if (inc.triggerType === 'missing_item_dm' && !activeMissingKeys.has(k)) {
                delete state.incidents[k];
                stateChanged = true;
            } else if (inc.triggerType === 'ready_blocker_dm' && !activeBlockerKeys.has(k)) {
                delete state.incidents[k];
                stateChanged = true;
            }
        }

        if (!ocDm.enabled) {
            if (stateChanged) saveState();
            return {
                handledLowCpr: false,
                handledMissingItems: false,
                handledInactive: false,
                handledReadyBlocker: false
            };
        }

        const lowCfg = ocDm.triggers.low_cpr_dm;
        const inactCfg = ocDm.triggers.inactive_oc_dm;
        const missCfg = ocDm.triggers.missing_item_dm;
        const blkCfg = ocDm.triggers.ready_blocker_dm;

        const handledLowCpr = lowCfg.mode !== 'off';
        const handledMissingItems = missCfg.mode !== 'off';
        const handledInactive = inactCfg.mode !== 'off';
        const handledReadyBlocker = blkCfg.mode !== 'off';

        const effectiveChannelId = channelId || ocCfg.globalChannelId || dCfg.ocChannelId || dCfg.globalChannelId;
        const guild = getActiveGuild();
        const guildMembersCache = guild ? await ensureGuildMembers(guild, false) : null;

        // ── Trigger A & C & D across v2 active crimes ──
        for (const v2Crime of (v2Crimes || [])) {
            const tier = Number(v2Crime.difficulty || 1);
            const minCpr = getTierMinCpr(tier, ocDm, ocCfg);
            const statusLower = String(v2Crime.status || '').toLowerCase();
            const timeLeftSec = v2Crime.ready_at ? (Number(v2Crime.ready_at) - nowSec) : null;

            for (const slot of (v2Crime.slots || [])) {
                if (!slot?.user?.id) continue;
                const pId = String(slot.user.id);
                const memberObj = members[pId] || {};
                const pName = memberObj.name || slot.user.name || `Player [${pId}]`;
                const roleLabel = slot.position_info?.label || slot.position || 'Team Member';
                const profileUrl = `https://www.torn.com/profiles.php?XID=${pId}`;

                // ── Trigger A: Low CPR Slot Entry Warning + Grace Escalation ──
                if (handledLowCpr && slot.checkpoint_pass_rate !== undefined && slot.checkpoint_pass_rate !== null) {
                    const cpr = Number(slot.checkpoint_pass_rate);
                    if (cpr < minCpr) {
                        const incKey = `low_cpr_dm:${pId}:${v2Crime.id}`;
                        const existing = state.incidents[incKey];
                        const cooldownMs = lowCfg.cooldownHours * 3600000;
                        const graceMs = lowCfg.graceHours * 3600000;
                        const ctxStr = `${v2Crime.name} (T${tier}) • Slot: ${roleLabel} • CPR: ${cpr}% (Min: ${minCpr}%)`;

                        if (!existing) {
                            const dmText = renderTemplate(lowCfg.template, {
                                player_name: pName,
                                crime_name: v2Crime.name,
                                tier,
                                role: roleLabel,
                                cpr,
                                min_cpr: minCpr,
                                grace_hours: lowCfg.graceHours
                            });

                            if ((lowCfg.mode === 'channel_only' || lowCfg.mode === 'both') && effectiveChannelId && botToken) {
                                const resolved = await resolveMemberDiscord(pId, pName, { allowTornApiFallback: false });
                                const pMention = resolved.discordId ? `<@${resolved.discordId}>` : '';
                                const chMention = pMention ? (mention ? `${mention} ${pMention}` : pMention) : mention;
                                await deps.sendChannelMessage(botToken, effectiveChannelId, {
                                    title: `⚠️ Low CPR in OC: ${v2Crime.name} (Tier ${tier})`,
                                    description: `**[${pName}](${profileUrl})** [${pId}] joined **${roleLabel}** with **${cpr}% CPR** (Min: **${minCpr}%**).\n\n${dmText}`,
                                    color: 0xef4444,
                                    timestamp: new Date().toISOString()
                                }, chMention).catch(() => {});
                            }

                            if (lowCfg.mode === 'dm_only' || lowCfg.mode === 'both') {
                                await dispatchTrackedOcDm({
                                    tornId: pId,
                                    playerName: pName,
                                    triggerType: 'low_cpr_dm',
                                    triggerLabel: TRIGGER_LABELS.low_cpr_dm,
                                    context: ctxStr,
                                    messageText: dmText,
                                    embedTitle: `⚠️ Low CPR Warning — ${v2Crime.name} (T${tier})`,
                                    embedColor: 0xf59e0b,
                                    cooldownMs
                                });
                            }

                            state.incidents[incKey] = {
                                key: incKey,
                                tornId: pId,
                                playerName: pName,
                                triggerType: 'low_cpr_dm',
                                crimeId: String(v2Crime.id),
                                crimeName: v2Crime.name,
                                tier,
                                role: roleLabel,
                                cpr,
                                minCpr,
                                firstDetectedAt: nowMs,
                                lastSentAt: nowMs,
                                escalatedAt: null,
                                lastContext: ctxStr
                            };
                            stateChanged = true;
                        } else if (lowCfg.escalationEnabled && !existing.escalatedAt && (nowMs - existing.firstDetectedAt) >= graceMs) {
                            const finalText = `FINAL WARNING: You are still slotted in **${v2Crime.name} (Tier ${tier})** as **${roleLabel}** with **${cpr}% CPR** (Min: **${minCpr}%**) after the **${lowCfg.graceHours}h** grace window. Leadership has been notified that this slot is eligible for removal.`;
                            if (lowCfg.mode === 'dm_only' || lowCfg.mode === 'both') {
                                await dispatchTrackedOcDm({
                                    tornId: pId,
                                    playerName: pName,
                                    triggerType: 'low_cpr_escalation',
                                    triggerLabel: TRIGGER_LABELS.low_cpr_escalation,
                                    context: `${ctxStr} • Grace ${lowCfg.graceHours}h Expired`,
                                    messageText: finalText,
                                    embedTitle: `🚨 Final Warning — Kick Eligible: ${v2Crime.name}`,
                                    embedColor: 0xef4444,
                                    cooldownMs
                                });
                            }

                            const adminAlertChannel = ocDm.receiptChannelId || effectiveChannelId;
                            if (adminAlertChannel && botToken) {
                                const kickEmbed = {
                                    title: `⚠️ Leadership Action Required — Kick Eligible`,
                                    description: `**[${pName}](${profileUrl})** [${pId}] is still in **${v2Crime.name} (Tier ${tier})** (**${roleLabel}**) with **${cpr}% CPR** (Min: **${minCpr}%**) after the **${lowCfg.graceHours}h** grace period expired.\n\n👉 [Manage Faction OCs](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                                    color: 0xef4444,
                                    timestamp: new Date().toISOString()
                                };
                                await deps.sendChannelMessage(botToken, adminAlertChannel, kickEmbed, mention).catch(() => {});
                            }

                            const escReceipt = recordReceipt({
                                tornId: pId,
                                playerName: pName,
                                triggerType: 'low_cpr_escalation',
                                triggerLabel: 'Low CPR Escalation',
                                context: `${ctxStr} • Grace Expired (${lowCfg.graceHours}h)`,
                                status: 'ESCALATION',
                                messagePreview: finalText,
                                escalated: true
                            });
                            await postReceiptEmbed(escReceipt);

                            existing.escalatedAt = nowMs;
                            existing.lastSentAt = nowMs;
                            stateChanged = true;
                        }
                    }
                }

                // ── Trigger C: Missing Required Role Item Reminder ──
                if (handledMissingItems && slot.item_requirement && !slot.item_requirement.is_available) {
                    const thresholdSec = missCfg.hoursBeforeExecution * 3600;
                    const isWithinWindow = missCfg.hoursBeforeExecution <= 0
                        || (timeLeftSec !== null && timeLeftSec <= thresholdSec)
                        || (statusLower === 'recruiting' && (v2Crime.slots || []).filter(s => s.user).length >= Math.max(1, (v2Crime.slots || []).length - 1));

                    if (isWithinWindow) {
                        const itemId = slot.item_requirement.id;
                        const incKey = `missing_item_dm:${pId}:${v2Crime.id}:${itemId}`;
                        const existing = state.incidents[incKey];
                        const cooldownMs = missCfg.cooldownHours * 3600000;

                        if (!existing || (nowMs - existing.lastSentAt) >= cooldownMs) {
                            const { itemName, itemPriceFmt } = await resolveItemDetails(itemId, slot.item_requirement, apiKey);
                            const timeRemaining = timeLeftSec !== null
                                ? formatDurationCompact(Math.max(0, timeLeftSec))
                                : 'Recruiting / Soon';
                            const dmText = renderTemplate(missCfg.template, {
                                player_name: pName,
                                role: roleLabel,
                                crime_name: v2Crime.name,
                                tier,
                                item_name: itemName,
                                item_price: itemPriceFmt,
                                time_remaining: timeRemaining
                            });
                            const ctxStr = `${v2Crime.name} (T${tier}) • Slot: ${roleLabel} • Needs: ${itemName}`;

                            if ((missCfg.mode === 'channel_only' || missCfg.mode === 'both') && effectiveChannelId && botToken) {
                                const armoryUrl = `https://www.torn.com/factions.php?step=your&type=1&autoItem=${encodeURIComponent(itemName)}&autoUser=${encodeURIComponent(pName)}&autoUserId=${pId}&autoAction=loan#/tab=armoury&start=0&sub=utilities`;
                                await deps.sendChannelMessage(botToken, effectiveChannelId, {
                                    title: `🛠️ Missing OC Item: ${itemName} (${v2Crime.name})`,
                                    description: `**[${pName}](${profileUrl})** (${roleLabel}) is missing **${itemName}** (~$${itemPriceFmt}) • Window: **${timeRemaining}**\n👉 [Loan from Armory](${armoryUrl})`,
                                    color: 0xf59e0b,
                                    timestamp: new Date().toISOString()
                                }, mention).catch(() => {});
                            }

                            if (missCfg.mode === 'dm_only' || missCfg.mode === 'both') {
                                await dispatchTrackedOcDm({
                                    tornId: pId,
                                    playerName: pName,
                                    triggerType: 'missing_item_dm',
                                    triggerLabel: TRIGGER_LABELS.missing_item_dm,
                                    context: ctxStr,
                                    messageText: dmText,
                                    embedTitle: `🛠️ Missing OC Item: ${itemName}`,
                                    embedColor: 0xf59e0b,
                                    cooldownMs
                                });
                            }

                            state.incidents[incKey] = {
                                key: incKey,
                                tornId: pId,
                                playerName: pName,
                                triggerType: 'missing_item_dm',
                                crimeId: String(v2Crime.id),
                                firstDetectedAt: existing?.firstDetectedAt || nowMs,
                                lastSentAt: nowMs,
                                lastContext: ctxStr
                            };
                            stateChanged = true;
                        }
                    }
                }

                // ── Trigger D: Ready OC Blocker Reminder (v2 Ready or within X min of ready) ──
                if (handledReadyBlocker) {
                    const withinSec = blkCfg.withinMinutesBeforeReady * 60;
                    const isReadyOrImminent = statusLower === 'ready' || (statusLower === 'planning' && timeLeftSec !== null && timeLeftSec <= withinSec);
                    const memberStatusState = String(memberObj?.status?.state || 'Okay');
                    const stateLower = memberStatusState.toLowerCase();
                    if (isReadyOrImminent && stateLower !== 'okay') {
                        const incKey = `ready_blocker_dm:${pId}:${v2Crime.id}`;
                        const existing = state.incidents[incKey];
                        const cooldownMs = blkCfg.cooldownHours * 3600000;

                        if (!existing || (nowMs - existing.lastSentAt) >= cooldownMs) {
                            const statusDisplay = memberObj?.status?.description || memberStatusState;
                            const dmText = renderTemplate(blkCfg.template, {
                                player_name: pName,
                                crime_name: v2Crime.name,
                                tier,
                                role: roleLabel,
                                status: statusDisplay
                            });
                            const ctxStr = `${v2Crime.name} (T${tier}) • Status: ${statusDisplay}`;

                            if ((blkCfg.mode === 'channel_only' || blkCfg.mode === 'both') && effectiveChannelId && botToken) {
                                await deps.sendChannelMessage(botToken, effectiveChannelId, {
                                    title: `🚦 Ready OC Blocker: ${v2Crime.name}`,
                                    description: `**[${pName}](${profileUrl})** is blocking **${v2Crime.name}** launch (**${statusDisplay}**).`,
                                    color: 0xf59e0b,
                                    timestamp: new Date().toISOString()
                                }, mention).catch(() => {});
                            }

                            if (blkCfg.mode === 'dm_only' || blkCfg.mode === 'both') {
                                await dispatchTrackedOcDm({
                                    tornId: pId,
                                    playerName: pName,
                                    triggerType: 'ready_blocker_dm',
                                    triggerLabel: TRIGGER_LABELS.ready_blocker_dm,
                                    context: ctxStr,
                                    messageText: dmText,
                                    embedTitle: `🚦 OC Launch Blocker — ${v2Crime.name}`,
                                    embedColor: 0xf59e0b,
                                    cooldownMs
                                });
                            }

                            state.incidents[incKey] = {
                                key: incKey,
                                tornId: pId,
                                playerName: pName,
                                triggerType: 'ready_blocker_dm',
                                crimeId: String(v2Crime.id),
                                firstDetectedAt: existing?.firstDetectedAt || nowMs,
                                lastSentAt: nowMs,
                                lastContext: ctxStr
                            };
                            stateChanged = true;
                        }
                    }
                }
            }
        }

        // ── Trigger B: Unassigned Bench / OC Inactivity Reminder ──
        if (handledInactive && members && Object.keys(members).length > 0) {
            const idleThresholdSec = inactCfg.idleHours * 3600;
            const cooldownMs = inactCfg.cooldownHours * 3600000;
            const offlineLimitSec = inactCfg.offlineExemptDays * 86400;
            const hist = deps.getOcMemberHistory() || {};
            const openSummary = buildOpenOcsSummary(v2Crimes);
            const exemptIdsSet = new Set(cleanIdArray(ocDm.exemptTornIds));
            const exemptRolesSet = new Set(cleanSnowflakeArray(ocDm.exemptRoleIds));

            for (const [mId, member] of Object.entries(members)) {
                const tidStr = String(mId);
                if (activeOcMemberIds.has(tidStr) || activeOcMemberIds.has(Number(mId))) continue;

                const posLower = String(member.position || '').trim().toLowerCase();
                const stateLower = String(member.status?.state || '').toLowerCase();
                const descLower = String(member.status?.description || '').toLowerCase();

                if (inactCfg.exemptFedJailAndFallen && (stateLower === 'fallen' || stateLower === 'federal' || descLower.includes('federal'))) continue;
                if (inactCfg.exemptNewRecruits && (posLower.includes('recruit') || posLower.includes('trial') || posLower.includes('probation') || (member.days_in_faction !== undefined && Number(member.days_in_faction) < 3))) continue;
                if (inactCfg.exemptOffline && member.last_action?.timestamp && (nowSec - Number(member.last_action.timestamp)) > offlineLimitSec) continue;

                if (inactCfg.exemptIdsAndRoles) {
                    if (exemptIdsSet.has(tidStr)) continue;
                    if (exemptRolesSet.size > 0) {
                        const resolved = await resolveMemberDiscord(tidStr, member.name || '', { allowTornApiFallback: false });
                        const gm = resolved.member || (guildMembersCache && resolved.discordId ? guildMembersCache.get(resolved.discordId) : null);
                        if (gm && Array.from(exemptRolesSet).some(rId => gm.roles?.cache?.has?.(rId))) {
                            continue;
                        }
                    }
                }

                const lastOcTs = Number(hist[tidStr] || 0);
                const secSinceLastOc = lastOcTs > 0 ? Math.max(0, nowSec - lastOcTs) : (idleThresholdSec + 1);
                if (secSinceLastOc < idleThresholdSec) continue;

                const incKey = `inactive_oc_dm:${tidStr}`;
                const existing = state.incidents[incKey];
                if (existing && (nowMs - existing.lastSentAt) < cooldownMs) continue;

                const hoursIdle = lastOcTs > 0 ? Math.max(1, Math.floor(secSinceLastOc / 3600)) : `${inactCfg.idleHours}+`;
                const pName = member.name || `Player [${tidStr}]`;
                const dmText = renderTemplate(inactCfg.template, {
                    player_name: pName,
                    hours_idle: hoursIdle,
                    open_ocs_summary: openSummary
                });
                const ctxStr = `Idle ${hoursIdle}h • Status: ${member.status?.state || 'Okay'}`;

                if ((inactCfg.mode === 'channel_only' || inactCfg.mode === 'both') && effectiveChannelId && botToken) {
                    await deps.sendChannelMessage(botToken, effectiveChannelId, {
                        title: `⏳ Member Missing from OC: ${pName}`,
                        description: `**[${pName}](https://www.torn.com/profiles.php?XID=${tidStr})** [${tidStr}] has not been in an OC for **${hoursIdle}h**.\nOpen OCs: ${openSummary}`,
                        color: 0xf59e0b,
                        timestamp: new Date().toISOString()
                    }, mention).catch(() => {});
                }

                if (inactCfg.mode === 'dm_only' || inactCfg.mode === 'both') {
                    await dispatchTrackedOcDm({
                        tornId: tidStr,
                        playerName: pName,
                        triggerType: 'inactive_oc_dm',
                        triggerLabel: TRIGGER_LABELS.inactive_oc_dm,
                        context: ctxStr,
                        messageText: dmText,
                        embedTitle: `⏳ Organized Crime Reminder (${hoursIdle}h Idle)`,
                        embedColor: 0x38bdf8,
                        cooldownMs
                    });
                }

                state.incidents[incKey] = {
                    key: incKey,
                    tornId: tidStr,
                    playerName: pName,
                    triggerType: 'inactive_oc_dm',
                    firstDetectedAt: existing?.firstDetectedAt || nowMs,
                    lastSentAt: nowMs,
                    lastContext: ctxStr
                };
                stateChanged = true;
            }
        }

        if (stateChanged) saveState();
        return {
            handledLowCpr,
            handledMissingItems,
            handledInactive,
            handledReadyBlocker
        };
    }

    // ── Shared Live OC Fetcher for Slash Commands & Button Refreshes ──
    async function fetchLiveOcContext(apiKey) {
        const dCfg = deps.getDiscordConfig() || {};
        const fallbackKey = dCfg.apiKey || (typeof deps.getNextApiKey === 'function' ? deps.getNextApiKey() : null);
        const primaryKey = apiKey || fallbackKey;
        if (!primaryKey) throw new Error('No Torn API key available. Connect a key in Dashboard Settings or /linkkey.');

        let fid = String(dCfg.factionId || '').trim();
        if (!fid) {
            const profRes = await fetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(primaryKey)}`, { signal: AbortSignal.timeout(7000) });
            const profData = await profRes.json();
            if (profData.error) throw new Error(profData.error.error || 'Torn API error');
            fid = String(profData?.faction?.faction_id || '');
        }
        if (!fid || fid === '0') throw new Error('Faction ID could not be resolved from API key.');

        const candidateKeys = Array.from(new Set([primaryKey, fallbackKey, (typeof deps.getNextApiKey === 'function' ? deps.getNextApiKey() : null)].filter(Boolean)));
        let lastErr = null;
        for (const k of candidateKeys) {
            const [v2Res, facRes] = await Promise.all([
                fetch(`https://api.torn.com/v2/faction/${fid}/crimes?cat=available&key=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(9000) }),
                fetch(`https://api.torn.com/faction/${fid}?selections=basic&key=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(9000) })
            ]);
            const v2Data = await v2Res.json();
            const facData = await facRes.json();
            if (!v2Data.error && !facData.error) {
                return {
                    fid,
                    apiKey: k,
                    factionName: facData.name || dCfg.factionName || `Faction [${fid}]`,
                    v2Crimes: Array.isArray(v2Data.crimes) ? v2Data.crimes : [],
                    members: facData.members || {}
                };
            }
            lastErr = v2Data.error?.error || facData.error?.error || 'Torn API error';
        }
        throw new Error(lastErr || 'Torn OC API error');
    }

    async function collectMissingItemsData(apiKey, statusFilter = 'all') {
        const ctx = await fetchLiveOcContext(apiKey);
        const nowSec = Math.floor(Date.now() / 1000);
        const rows = [];

        for (const c of ctx.v2Crimes) {
            const cStatus = String(c.status || '').toLowerCase();
            const targetTs = Number(c.ready_at || c.expired_at || 0);
            const timeLeftSec = targetTs > 0 ? Math.max(0, targetTs - nowSec) : null;

            if (statusFilter === 'recruiting' && cStatus !== 'recruiting') continue;
            if (statusFilter === 'planning' && cStatus !== 'planning') continue;
            if (statusFilter === 'urgent') {
                const isUrgent = cStatus === 'ready' || (timeLeftSec !== null && timeLeftSec <= 86400);
                if (!isUrgent) continue;
            }

            for (const slot of (c.slots || [])) {
                if (!slot?.user?.id || !slot.item_requirement || slot.item_requirement.is_available) continue;
                const pId = String(slot.user.id);
                const pName = ctx.members[pId]?.name || slot.user.name || `Player [${pId}]`;
                const itemId = Number(slot.item_requirement.id);
                const { itemName, marketPrice: price, reusable } = await resolveItemDetails(itemId, slot.item_requirement, ctx.apiKey);
                const resolved = await resolveMemberDiscord(pId, pName, { allowTornApiFallback: false });

                rows.push({
                    tornId: pId,
                    playerName: pName,
                    discordId: resolved.discordId,
                    crimeId: String(c.id),
                    crimeName: c.name,
                    tier: Number(c.difficulty || 1),
                    crimeStatus: c.status,
                    role: slot.position_info?.label || slot.position || 'Slot',
                    itemId,
                    itemName,
                    price,
                    reusable,
                    targetTs,
                    timeLeftSec,
                    sortTs: targetTs > 0 ? targetTs : (nowSec + 9999999)
                });
            }
        }

        rows.sort((a, b) => a.sortTs - b.sortTs || b.tier - a.tier);
        return { ctx, rows };
    }

    async function buildOcItemsReport(apiKey, statusFilter = 'all') {
        const UI = deps.UI;
        const { ctx, rows } = await collectMissingItemsData(apiKey, statusFilter);
        const totalCost = rows.reduce((s, r) => s + (r.price || 0), 0);

        const lines = rows.slice(0, 15).map((r, idx) => {
            const discTag = r.discordId ? `<@${r.discordId}>` : `*Unlinked*`;
            const reuseTag = r.reusable ? '`Reusable`' : '`Consumable`';
            const priceText = r.price > 0 ? `~$${r.price.toLocaleString('en-US')}` : 'Market N/A';
            const etaText = r.targetTs > 0 ? `<t:${r.targetTs}:R>` : r.crimeStatus;
            return `**${idx + 1}. ${r.playerName} [${r.tornId}]** (${discTag})\n` +
                   `• Item: **${r.itemName}** (${reuseTag} • ${priceText})\n` +
                   `• Crime: **${r.crimeName} (T${r.tier})** — *${r.role}* (${etaText})`;
        });

        const filterLabel = statusFilter === 'urgent' ? 'Urgent <=24h' : statusFilter.toUpperCase();
        const desc = rows.length === 0
            ? `✅ All active slotted OC members (**${filterLabel}**) currently have their required role items!`
            : lines.join('\n\n') + (rows.length > 15 ? `\n\n*...and ${rows.length - 15} more missing item(s).*` : '');

        const embed = {
            title: `🛠️ OC Missing Items Report (${rows.length} Missing)`,
            description: desc.slice(0, 4000),
            color: rows.length > 0 ? 0xf59e0b : 0x2ecc71,
            fields: [
                { name: 'Filter', value: `\`${filterLabel}\``, inline: true },
                { name: 'Missing Count', value: `**${rows.length}** item(s)`, inline: true },
                { name: 'Combined Est. Cost', value: `**$${totalCost.toLocaleString('en-US')}**`, inline: true }
            ],
            footer: { text: `${ctx.factionName} • Total ${rows.length} missing • Est. $${totalCost.toLocaleString('en-US')}` },
            timestamp: new Date().toISOString()
        };

        const rowBtns = [
            { type: 2, style: 1, custom_id: `ocitems_dm_all:${statusFilter}`, label: 'DM All Listed Members', emoji: { name: '📩' }, disabled: rows.length === 0 },
            { type: 2, style: 2, custom_id: `ocitems_refresh:${statusFilter}`, label: 'Refresh', emoji: { name: '🔄' } }
        ];
        const linkBtns = UI?.linkBtn
            ? [UI.linkBtn('https://www.torn.com/factions.php?step=your#/tab=armoury', 'Faction Armory', '📦')]
            : [{ type: 2, style: 5, url: 'https://www.torn.com/factions.php?step=your#/tab=armoury', label: 'Faction Armory' }];

        return {
            embeds: [deps.sanitizeEmbed(embed)],
            components: [
                { type: 1, components: rowBtns },
                { type: 1, components: linkBtns }
            ],
            rows
        };
    }

    async function collectLowCprData(apiKey) {
        const ctx = await fetchLiveOcContext(apiKey);
        const ocDm = getConfig();
        const ocCfg = deps.getOcConfig() || {};
        const lowCfg = ocDm.triggers.low_cpr_dm;
        const graceMs = lowCfg.graceHours * 3600000;
        const nowMs = Date.now();
        const rows = [];

        for (const c of ctx.v2Crimes) {
            const tier = Number(c.difficulty || 1);
            const minCpr = getTierMinCpr(tier, ocDm, ocCfg);
            for (const slot of (c.slots || [])) {
                if (!slot?.user?.id || slot.checkpoint_pass_rate === undefined || slot.checkpoint_pass_rate === null) continue;
                const cpr = Number(slot.checkpoint_pass_rate);
                if (cpr >= minCpr) continue;
                const pId = String(slot.user.id);
                const pName = ctx.members[pId]?.name || slot.user.name || `Player [${pId}]`;
                const inc = state.incidents[`low_cpr_dm:${pId}:${c.id}`] || null;
                const resolved = await resolveMemberDiscord(pId, pName, { allowTornApiFallback: false });
                const kickEligible = Boolean(inc && (nowMs - inc.firstDetectedAt) >= graceMs);

                rows.push({
                    tornId: pId,
                    playerName: pName,
                    discordId: resolved.discordId,
                    crimeId: String(c.id),
                    crimeName: c.name,
                    tier,
                    role: slot.position_info?.label || slot.position || 'Slot',
                    cpr,
                    minCpr,
                    dmedAt: inc?.lastSentAt || null,
                    kickEligible
                });
            }
        }
        rows.sort((a, b) => Number(b.kickEligible) - Number(a.kickEligible) || (a.cpr - a.minCpr) - (b.cpr - b.minCpr));
        return { ctx, rows, lowCfg };
    }

    async function buildOcLowCprReport(apiKey) {
        const { ctx, rows, lowCfg } = await collectLowCprData(apiKey);
        const lines = rows.slice(0, 15).map((r, i) => {
            const dmNote = r.dmedAt ? `📩 DMed <t:${Math.floor(r.dmedAt / 1000)}:R>` : '🆕 Unwarned';
            const kickBadge = r.kickEligible ? ' • 🚨 **Kick Eligible**' : '';
            const discTag = r.discordId ? `<@${r.discordId}>` : '*Unlinked*';
            return `**${i + 1}. ${r.playerName} [${r.tornId}]** (${discTag})\n` +
                   `• **${r.crimeName} (T${r.tier})** — *${r.role}*\n` +
                   `• CPR: **${r.cpr}%** vs Min **${r.minCpr}%** • ${dmNote}${kickBadge}`;
        });

        const unwarnedCount = rows.filter(r => !r.dmedAt).length;
        const kickCount = rows.filter(r => r.kickEligible).length;

        const embed = {
            title: `⚠️ Low CPR Audit & Kick Prep (${rows.length} Flagged)`,
            description: (rows.length === 0
                ? '✅ All active OC crew slots meet your configured minimum CPR thresholds.'
                : lines.join('\n\n')).slice(0, 4000),
            color: kickCount > 0 ? 0xef4444 : (rows.length > 0 ? 0xf59e0b : 0x2ecc71),
            fields: [
                { name: 'Unwarned', value: `**${unwarnedCount}**`, inline: true },
                { name: 'Kick Eligible', value: `**${kickCount}** (>${lowCfg.graceHours}h grace)`, inline: true },
                { name: 'Global Floor', value: `**${lowCfg.globalMinCpr}%**`, inline: true }
            ],
            footer: { text: `${ctx.factionName} • Low CPR Sentinel` },
            timestamp: new Date().toISOString()
        };

        return {
            embeds: [deps.sanitizeEmbed(embed)],
            components: [
                {
                    type: 1,
                    components: [
                        { type: 2, style: 1, custom_id: 'oclowcpr_dm_all', label: `DM All Unwarned (${unwarnedCount})`, emoji: { name: '📩' }, disabled: unwarnedCount === 0 },
                        { type: 2, style: 5, url: 'https://www.torn.com/factions.php?step=your#/tab=crimes', label: 'Open Torn Crimes', emoji: { name: '🔗' } }
                    ]
                }
            ],
            rows
        };
    }

    async function collectBenchData(apiKey) {
        const ctx = await fetchLiveOcContext(apiKey);
        const ocDm = getConfig();
        const inactCfg = ocDm.triggers.inactive_oc_dm;
        const hist = deps.getOcMemberHistory() || {};
        const nowSec = Math.floor(Date.now() / 1000);

        await seedOcHistoryFromCompleted(ctx.fid, ctx.apiKey);

        const activeSet = new Set();
        let openRecruitingSlots = 0;
        for (const c of ctx.v2Crimes) {
            const isRec = String(c.status || '').toLowerCase() === 'recruiting';
            for (const s of (c.slots || [])) {
                if (s?.user?.id) activeSet.add(String(s.user.id));
                else if (isRec) openRecruitingSlots++;
            }
        }

        const available = [];
        const blocked = [];
        const exempt = [];
        const exemptIdsSet = new Set(cleanIdArray(ocDm.exemptTornIds));
        const exemptRolesSet = new Set(cleanSnowflakeArray(ocDm.exemptRoleIds));
        const guild = getActiveGuild();
        const guildMembersCache = guild ? await ensureGuildMembers(guild, false) : null;
        const offlineLimitSec = inactCfg.offlineExemptDays * 86400;

        for (const [mId, member] of Object.entries(ctx.members || {})) {
            const tid = String(mId);
            if (activeSet.has(tid)) continue;

            const lastOcTs = Number(hist[tid] || 0);
            const hoursUnassigned = lastOcTs > 0 ? Math.max(0, Math.floor((nowSec - lastOcTs) / 3600)) : null;
            const resolved = await resolveMemberDiscord(tid, member.name || '', { allowTornApiFallback: false });
            const item = {
                tornId: tid,
                playerName: member.name || `Player [${tid}]`,
                discordId: resolved.discordId,
                hoursUnassigned,
                statusState: member.status?.state || 'Okay',
                statusDesc: member.status?.description || 'Okay',
                position: member.position || 'Member'
            };

            const posLower = item.position.toLowerCase();
            const stateLower = item.statusState.toLowerCase();
            const descLower = item.statusDesc.toLowerCase();

            let isExemptReason = null;
            if (stateLower === 'fallen' || stateLower === 'federal' || descLower.includes('federal')) {
                isExemptReason = 'Fed/Fallen';
            } else if (posLower.includes('recruit') || posLower.includes('trial') || (member.days_in_faction !== undefined && Number(member.days_in_faction) < 3)) {
                isExemptReason = 'Recruit/<3d';
            } else if (inactCfg.exemptOffline && member.last_action?.timestamp && (nowSec - Number(member.last_action.timestamp)) > offlineLimitSec) {
                isExemptReason = `Offline >${inactCfg.offlineExemptDays}d`;
            } else if (exemptIdsSet.has(tid)) {
                isExemptReason = 'Whitelisted';
            } else if (exemptRolesSet.size > 0 && resolved.discordId && guildMembersCache) {
                const gm = resolved.member || guildMembersCache.get(resolved.discordId);
                if (gm && Array.from(exemptRolesSet).some(rId => gm.roles?.cache?.has?.(rId))) {
                    isExemptReason = 'Exempt Role';
                }
            }

            if (isExemptReason) {
                exempt.push({ ...item, reason: isExemptReason });
            } else if (stateLower !== 'okay') {
                blocked.push(item);
            } else {
                available.push(item);
            }
        }

        available.sort((a, b) => (b.hoursUnassigned ?? 9999) - (a.hoursUnassigned ?? 9999));
        return { ctx, available, blocked, exempt, openRecruitingSlots, openSummary: buildOpenOcsSummary(ctx.v2Crimes) };
    }

    async function buildOcBenchReport(apiKey) {
        const { ctx, available, blocked, exempt, openRecruitingSlots } = await collectBenchData(apiKey);
        const fmtList = (arr, limit = 12) => arr.slice(0, limit).map(m => {
            const hrs = m.hoursUnassigned !== null ? `${m.hoursUnassigned}h idle` : 'Unknown idle';
            const extra = m.reason ? ` • *${m.reason}*` : (m.statusState !== 'Okay' ? ` • *${m.statusState}*` : '');
            return `• **${m.playerName} [${m.tornId}]** — ${hrs}${extra}`;
        }).join('\n') + (arr.length > limit ? `\n*...and ${arr.length - limit} more*` : '');

        const embed = {
            title: `🪑 OC Bench Report — Unassigned Members`,
            description: `Open Recruiting Slots: **${openRecruitingSlots}**\n\n` +
                         `🟢 **Available Now (${available.length}):**\n${available.length ? fmtList(available, 15) : '*None*'}\n\n` +
                         `✈️/🏥 **Blocked — Flying / Hosp / Jail (${blocked.length}):**\n${blocked.length ? fmtList(blocked, 8) : '*None*'}\n\n` +
                         `🛡️ **Exempt (${exempt.length}):**\n${exempt.length ? fmtList(exempt, 6) : '*None*'}`,
            color: available.length > 0 ? 0xf59e0b : 0x2ecc71,
            footer: { text: `${ctx.factionName} • ${openRecruitingSlots} Open Recruiting Slots` },
            timestamp: new Date().toISOString()
        };

        return {
            embeds: [deps.sanitizeEmbed(embed)],
            components: [
                {
                    type: 1,
                    components: [
                        { type: 2, style: 1, custom_id: 'ocbench_dm_all', label: `DM Available Idle Members (${available.length})`, emoji: { name: '📩' }, disabled: available.length === 0 },
                        { type: 2, style: 5, url: 'https://www.torn.com/factions.php?step=your#/tab=crimes', label: 'Open Torn Crimes', emoji: { name: '🔗' } }
                    ]
                }
            ],
            available
        };
    }

    async function buildOcCheckReport(query, apiKey, fallbackDiscordId = null) {
        const ctx = await fetchLiveOcContext(apiKey);
        const ocDm = getConfig();
        const ocCfg = deps.getOcConfig() || {};
        const verifiedMap = deps.getVerifiedDiscordMap() || {};
        const raw = String(query || '').trim();
        const mentionMatch = raw.match(/<@!?(\d{15,22})>/);
        let targetTornId = null;
        let targetName = '';

        if (mentionMatch) {
            const dId = mentionMatch[1];
            targetTornId = String(verifiedMap[dId]?.tornId || '') || Object.values(state.manualLinks).find(l => l.discordId === dId)?.tornId || null;
        } else if (/^\d{15,22}$/.test(raw)) {
            targetTornId = String(verifiedMap[raw]?.tornId || '') || Object.values(state.manualLinks).find(l => l.discordId === raw)?.tornId || null;
        } else if (/^\d{3,10}$/.test(raw)) {
            targetTornId = raw;
        } else if (raw) {
            const qLow = raw.toLowerCase();
            const found = Object.entries(ctx.members).find(([id, m]) => String(m?.name || '').toLowerCase() === qLow || String(m?.name || '').toLowerCase().includes(qLow));
            if (found) targetTornId = String(found[0]);
        } else if (fallbackDiscordId) {
            targetTornId = String(verifiedMap[fallbackDiscordId]?.tornId || '') || Object.values(state.manualLinks).find(l => l.discordId === fallbackDiscordId)?.tornId || null;
        }

        if (!targetTornId) {
            return {
                embeds: [deps.sanitizeEmbed({
                    title: '🔍 /oc-check — Member Not Found',
                    description: `Could not resolve **${raw || 'your account'}** to a Torn faction member.\nUse \`/oc-link torn_id:<id>\` or pass a Torn Name/ID.`,
                    color: 0xef4444,
                    timestamp: new Date().toISOString()
                })],
                components: []
            };
        }

        const mObj = ctx.members[targetTornId] || {};
        targetName = mObj.name || `Player [${targetTornId}]`;
        const resolved = await resolveMemberDiscord(targetTornId, targetName, { allowTornApiFallback: true });

        let assigned = null;
        for (const c of ctx.v2Crimes) {
            for (const slot of (c.slots || [])) {
                if (slot?.user?.id && String(slot.user.id) === targetTornId) {
                    assigned = { crime: c, slot };
                    break;
                }
            }
            if (assigned) break;
        }

        const fields = [
            { name: 'Member', value: `**[${targetName}](https://www.torn.com/profiles.php?XID=${targetTornId})** [${targetTornId}]`, inline: true },
            { name: 'Discord Link', value: resolved.discordId ? `<@${resolved.discordId}> (\`${resolved.source}\`)` : '❌ Unlinked', inline: true },
            { name: 'Torn Status', value: mObj.status?.description || mObj.status?.state || 'Okay', inline: true }
        ];

        if (assigned) {
            const { crime, slot } = assigned;
            const tier = Number(crime.difficulty || 1);
            const minCpr = getTierMinCpr(tier, ocDm, ocCfg);
            const cpr = slot.checkpoint_pass_rate !== undefined ? Number(slot.checkpoint_pass_rate) : null;
            const cprStr = cpr !== null ? `**${cpr}%** (Min ${minCpr}%${cpr < minCpr ? ' ⚠️ BELOW FLOOR' : ' ✅'})` : 'N/A';

            let itemStr = 'None required';
            if (slot.item_requirement) {
                const { itemName, marketPrice: price } = await resolveItemDetails(slot.item_requirement.id, slot.item_requirement, ctx.apiKey);
                itemStr = slot.item_requirement.is_available
                    ? `✅ ${itemName}`
                    : `❌ **Missing ${itemName}** (~$${price.toLocaleString('en-US')})`;
            }

            fields.push(
                { name: 'Current OC', value: `**${crime.name}** (Tier ${tier} • ${crime.status})`, inline: true },
                { name: 'Role & CPR', value: `*${slot.position_info?.label || slot.position}* — ${cprStr}`, inline: true },
                { name: 'Item Status', value: itemStr, inline: true }
            );
        } else {
            const hist = deps.getOcMemberHistory() || {};
            const lastTs = Number(hist[targetTornId] || 0);
            const idleStr = lastTs > 0 ? `<t:${lastTs}:R>` : 'Unknown';
            fields.push({ name: 'Current OC', value: `🪑 Unassigned (Last OC seen: ${idleStr})`, inline: false });
        }

        const userReceipts = state.receipts.filter(r => String(r.tornId) === targetTornId).slice(0, 3);
        const recText = userReceipts.length > 0
            ? userReceipts.map(r => `• <t:${Math.floor(r.timestamp / 1000)}:R> — **${r.triggerLabel}** (\`${r.status}\`): ${r.context}`).join('\n')
            : '*No automated OC DMs recorded for this member yet.*';

        fields.push({ name: 'Last 3 OC DM Receipts', value: recText.slice(0, 1020), inline: false });

        return {
            embeds: [deps.sanitizeEmbed({
                title: `📋 OC & DM Dossier: ${targetName}`,
                color: assigned ? 0x38bdf8 : 0xf59e0b,
                fields,
                footer: { text: `${ctx.factionName} • OC Inspector` },
                timestamp: new Date().toISOString()
            })],
            components: []
        };
    }

    async function sendBatchManualDms(items, builderFn, triggerType, actorName) {
        let sent = 0;
        let failed = 0;
        let unlinked = 0;
        for (const item of items) {
            const { context, messageText, embedTitle } = builderFn(item);
            const res = await dispatchTrackedOcDm({
                tornId: item.tornId,
                playerName: item.playerName,
                explicitDiscordId: item.discordId,
                triggerType,
                triggerLabel: TRIGGER_LABELS[triggerType] || 'Manual Manager DM',
                context: `${context} • By ${actorName}`,
                messageText,
                embedTitle,
                embedColor: 0xf59e0b,
                cooldownMs: 3600000,
                allowFallbackPing: true,
                source: 'slash_button'
            });
            if (res.status === 'DELIVERED') sent++;
            else if (res.status === 'UNLINKED') unlinked++;
            else failed++;
            await new Promise(r => setTimeout(r, 250));
        }
        return { sent, failed, unlinked, total: items.length };
    }

    function queryReceipts({ status = 'all', limit = 100 } = {}) {
        const sLower = String(status || 'all').toLowerCase();
        const filtered = state.receipts.filter(r => {
            if (sLower === 'delivered') return r.status === 'DELIVERED';
            if (sLower === 'failed') return r.status === 'FAILED_50007' || r.status === 'FAILED_ERROR';
            if (sLower === 'unlinked') return r.status === 'UNLINKED';
            return true;
        });
        return filtered.slice(0, Math.min(MAX_RECEIPTS, Number(limit) || 100));
    }

    return {
        DEFAULT_TEMPLATES,
        TRIGGER_LABELS,
        getDefaultOcDmConfig,
        mergeOcDmConfig,
        renderTemplate,
        getConfig,
        loadState,
        saveState,
        importFromMongo,
        exportForMongo,
        isMemberOcManager,
        saveLink,
        resolveMemberDiscord,
        scanGuildNicknamesForLinks,
        getFactionMemberLinkStatus,
        recordReceipt,
        postReceiptEmbed,
        dispatchTrackedOcDm,
        processOcMonitoringTick,
        fetchLiveOcContext,
        collectMissingItemsData,
        buildOcItemsReport,
        collectLowCprData,
        buildOcLowCprReport,
        collectBenchData,
        buildOcBenchReport,
        buildOcCheckReport,
        sendBatchManualDms,
        queryReceipts
    };
}

module.exports = {
    DEFAULT_TEMPLATES,
    TRIGGER_LABELS,
    getDefaultOcDmConfig,
    mergeOcDmConfig,
    renderTemplate,
    createOcDmEngine
};
