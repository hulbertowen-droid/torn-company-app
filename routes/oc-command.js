'use strict';

/**
 * FactionOS OC 2.0 Command Center — Backend Aggregation & Analytics Route
 *
 * Powers all 15 Organized Crime tools in /oc.html:
 * - Active & historical Torn v2 faction crimes (multi-page completed history)
 * - Unassigned bench radar & smart role/CPR matching data
 * - Consumable item catalog prices & Faction Armory availability
 * - Ranked War & Chain overlap detection
 * - Operative reliability scores, post-mortems, and Tiers 1–8 EV/ROI matrix
 * - Optional TornStats CPR sync + per-faction manual CPR overrides
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', 'data');
const CPR_OVERRIDES_FILE = path.join(DATA_DIR, 'oc_cpr_overrides.json');
const ROLE_CPR_CACHE_FILE = path.join(DATA_DIR, 'oc_role_cpr_cache.json');
const PAYOUT_STATUS_FILE = path.join(DATA_DIR, 'oc_payout_status.json');
const CPR_FLOORS_FILE = path.join(DATA_DIR, 'oc_cpr_floors.json');

let deps = {
    cachedTornFetch: null,
    getUserFactionInfo: null,
    getFactionArmoryCandidateKeys: null,
    getDiscordConfig: () => ({}),
    getOcConfig: () => ({}),
    saveOcCprFloors: null,
    getOcMemberHistory: () => ({}),
    userKeys: null
};

function setDeps(d = {}) {
    deps = { ...deps, ...d };
}

function normalizeCrimeName(name) {
    return String(name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

// Per-faction in-memory caches
const commandCenterCache = new Map();
const completedHistoryCache = new Map();
const armoryStockCache = new Map();
const rankedWarsCache = new Map();
const userOcHarvestTimestamps = new Map();
let tornItemsMemoryCache = { ts: 0, items: {} };

// Load manual / TornStats CPR overrides, role CPR cache, batch payout settlement status, and per-level CPR floors
let cprOverridesByFaction = {};
let roleCprCacheByFaction = {};
let payoutStatusByFaction = {};
let cprFloorsByFaction = {};

function loadJsonSafe(filePath) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
    } catch (e) {
        console.warn(`[OC-Command] Failed loading ${path.basename(filePath)}:`, e.message);
    }
    return {};
}
function saveJsonSafe(filePath, data) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.warn(`[OC-Command] Failed saving ${path.basename(filePath)}:`, e.message);
    }
}

cprOverridesByFaction = loadJsonSafe(CPR_OVERRIDES_FILE);
roleCprCacheByFaction = loadJsonSafe(ROLE_CPR_CACHE_FILE);
payoutStatusByFaction = loadJsonSafe(PAYOUT_STATUS_FILE);
cprFloorsByFaction = loadJsonSafe(CPR_FLOORS_FILE);

function saveCprOverrides() { saveJsonSafe(CPR_OVERRIDES_FILE, cprOverridesByFaction); }
function saveRoleCprCache() { saveJsonSafe(ROLE_CPR_CACHE_FILE, roleCprCacheByFaction); }
function savePayoutStatus() { saveJsonSafe(PAYOUT_STATUS_FILE, payoutStatusByFaction); }
function saveCprFloors() { saveJsonSafe(CPR_FLOORS_FILE, cprFloorsByFaction); }

function sanitizeTierFloors(raw = {}, base = {}) {
    const out = { 1: 0, 2: 0, 3: 50, 4: 50, 5: 40, 6: 40, 7: 80, 8: 85, ...(base || {}) };
    for (let t = 1; t <= 8; t++) {
        const key = String(t);
        if (raw && raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
            const num = Number(raw[key]);
            if (!Number.isNaN(num)) out[key] = Math.max(0, Math.min(100, Math.round(num)));
        }
    }
    return out;
}

// Complete Torn OC 2.0 Tiers 1–8 Baseline Reference Catalog (enriched dynamically with live faction data)
const BASE_OC_CATALOG = [
    { name: 'Pet Project', difficulty: 1, crewSize: 3, planningDays: 3, roles: ['Kidnapper', 'Muscle', 'Picklock'], requiredItemIds: [1361, 1362, 1203], estCash: 630000, estRespect: 31, estItemValue: 0, failPenaltyCost: 120000 },
    { name: 'Mob Mentality', difficulty: 1, crewSize: 4, planningDays: 3, roles: ['Looter', 'Looter', 'Looter', 'Looter'], requiredItemIds: [568], estCash: 975000, estRespect: 44, estItemValue: 0, failPenaltyCost: 100000 },
    { name: 'First Aid and Abet', difficulty: 1, crewSize: 3, planningDays: 3, roles: ['Picklock', 'Decoy', 'Pickpocket'], requiredItemIds: [1203, 1217], estCash: 150000, estRespect: 33, estItemValue: 680000, failPenaltyCost: 110000 },
    { name: 'Cashless Society', difficulty: 1, crewSize: 3, planningDays: 3, roles: ['Thief', 'Lookout', 'Robber'], requiredItemIds: [1203], estCash: 680000, estRespect: 30, estItemValue: 0, failPenaltyCost: 100000 },

    { name: 'Best of the Lot', difficulty: 2, crewSize: 4, planningDays: 4, roles: ['Picklock', 'Car Thief', 'Muscle', 'Imitator'], requiredItemIds: [1203, 1350], estCash: 0, estRespect: 55, estItemValue: 2200000, failPenaltyCost: 220000 },
    { name: 'Cash Me if You Can', difficulty: 2, crewSize: 2, planningDays: 4, roles: ['Thief', 'Lookout'], requiredItemIds: [1381, 1379], estCash: 1285000, estRespect: 38, estItemValue: 0, failPenaltyCost: 180000 },
    { name: 'Thou Shalt Not Steal', difficulty: 2, crewSize: 3, planningDays: 4, roles: ['Picklock', 'Thief', 'Pickpocket'], requiredItemIds: [1203, 1313, 1096], estCash: 1160000, estRespect: 40, estItemValue: 0, failPenaltyCost: 190000 },
    { name: 'Disorderly Conduct', difficulty: 2, crewSize: 4, planningDays: 4, roles: ['Vandal', 'Arsonist', 'Muscle', 'Looter'], requiredItemIds: [858, 742, 394, 1353], estCash: 1450000, estRespect: 48, estItemValue: 0, failPenaltyCost: 200000 },

    { name: 'Market Forces', difficulty: 3, crewSize: 5, planningDays: 5, roles: ['Enforcer', 'Negotiator', 'Lookout', 'Arsonist', 'Muscle'], requiredItemIds: [172], estCash: 6980000, estRespect: 85, estItemValue: 0, failPenaltyCost: 350000 },
    { name: 'Smoke and Wing Mirrors', difficulty: 3, crewSize: 3, planningDays: 5, roles: ['Car Thief', 'Imitator', 'Hustler'], requiredItemIds: [1380, 1383], estCash: 0, estRespect: 73, estItemValue: 5400000, failPenaltyCost: 350000 },
    { name: 'Gaslight the Way', difficulty: 3, crewSize: 2, planningDays: 5, roles: ['Imitator', 'Looter'], requiredItemIds: [643, 1381], estCash: 0, estRespect: 107, estItemValue: 4950000, failPenaltyCost: 300000 },

    { name: 'Stage Fright', difficulty: 4, crewSize: 4, planningDays: 5, roles: ['Enforcer', 'Muscle', 'Lookout', 'Sniper'], requiredItemIds: [1258], estCash: 0, estRespect: 151, estItemValue: 11800000, failPenaltyCost: 480000 },
    { name: 'Plucking the Lotus Petal', difficulty: 4, crewSize: 4, planningDays: 5, roles: ['Robber', 'Hustler', 'Robber', 'Muscle'], requiredItemIds: [327], estCash: 8050000, estRespect: 93, estItemValue: 0, failPenaltyCost: 450000 },
    { name: 'Snow Blind', difficulty: 4, crewSize: 3, planningDays: 5, roles: ['Hustler', 'Imitator', 'Muscle'], requiredItemIds: [201], estCash: 9810000, estRespect: 98, estItemValue: 0, failPenaltyCost: 420000 },

    { name: 'No Reserve', difficulty: 5, crewSize: 3, planningDays: 6, roles: ['Car Thief', 'Techie', 'Engineer'], requiredItemIds: [159, 856, 576], estCash: 14500000, estRespect: 130, estItemValue: 0, failPenaltyCost: 650000 },
    { name: 'Honey Trap', difficulty: 5, crewSize: 2, planningDays: 6, roles: ['Enforcer', 'Muscle'], requiredItemIds: [1080], estCash: 11180000, estRespect: 98, estItemValue: 0, failPenaltyCost: 520000 },
    { name: 'Guardian Angels', difficulty: 5, crewSize: 3, planningDays: 6, roles: ['Enforcer', 'Hustler', 'Engineer'], requiredItemIds: [1331], estCash: 8870000, estRespect: 94, estItemValue: 0, failPenaltyCost: 550000 },
    { name: 'Counter Offer', difficulty: 5, crewSize: 5, planningDays: 6, roles: ['Robber', 'Looter', 'Hacker', 'Picklock', 'Engineer'], requiredItemIds: [1429, 70, 1203, 981], estCash: 0, estRespect: 169, estItemValue: 22500000, failPenaltyCost: 900000 },

    { name: 'Leave No Trace', difficulty: 6, crewSize: 3, planningDays: 6, roles: ['Techie', 'Negotiator', 'Imitator'], requiredItemIds: [1350], estCash: 24500000, estRespect: 145, estItemValue: 0, failPenaltyCost: 850000 },
    { name: 'Sneaky Git Grab', difficulty: 6, crewSize: 4, planningDays: 6, roles: ['Imitator', 'Pickpocket', 'Hacker', 'Techie'], requiredItemIds: [71, 579], estCash: 35800000, estRespect: 175, estItemValue: 0, failPenaltyCost: 1200000 },
    { name: 'Bidding War', difficulty: 6, crewSize: 3, planningDays: 6, roles: ['Robber', 'Driver', 'Bomber'], requiredItemIds: [568, 222, 1284, 190], estCash: 29000000, estRespect: 155, estItemValue: 0, failPenaltyCost: 950000 },
    { name: 'Dish It Out', difficulty: 6, crewSize: 4, planningDays: 6, roles: ['Assassin', 'Muscle', 'Saboteur', 'Engineer'], requiredItemIds: [1363, 159, 1461, 981], estCash: 26740000, estRespect: 121, estItemValue: 0, failPenaltyCost: 900000 },

    { name: 'Blast From the Past', difficulty: 7, crewSize: 5, planningDays: 7, roles: ['Picklock', 'Hacker', 'Engineer', 'Bomber', 'Muscle'], requiredItemIds: [71, 190, 1203], estCash: 68000000, estRespect: 320, estItemValue: 0, failPenaltyCost: 1800000 },
    { name: 'Clinical Precision', difficulty: 7, crewSize: 4, planningDays: 7, roles: ['Imitator', 'Assassin', 'Cleaner', 'Techie'], requiredItemIds: [576, 1380], estCash: 54000000, estRespect: 265, estItemValue: 0, failPenaltyCost: 1500000 },
    { name: 'Ace in the Hole', difficulty: 7, crewSize: 5, planningDays: 7, roles: ['Hacker', 'Driver', 'Muscle', 'Imitator', 'Lookout'], requiredItemIds: [70, 579, 1350], estCash: 75000000, estRespect: 350, estItemValue: 0, failPenaltyCost: 2000000 },

    { name: 'Break the Bank', difficulty: 8, crewSize: 6, planningDays: 8, roles: ['Robber', 'Muscle', 'Thief', 'Picklock', 'Hacker', 'Driver'], requiredItemIds: [71, 190, 1461, 1203], estCash: 145000000, estRespect: 580, estItemValue: 0, failPenaltyCost: 3000000 },
    { name: 'Stacking the Deck', difficulty: 8, crewSize: 4, planningDays: 8, roles: ['Imitator', 'Hacker', 'Cat Burglar', 'Driver'], requiredItemIds: [71, 1380, 1381, 327], estCash: 115000000, estRespect: 460, estItemValue: 0, failPenaltyCost: 2600000 }
];

async function fetchJsonWithTimeout(url, timeoutMs = 9000) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.json();
}

async function resolveCallerKeyAndFaction(req) {
    const userKey = String(req.userTornKey || req.headers['x-api-key'] || req.query.apiKey || '').trim();
    const hasValidKey = Boolean(userKey && userKey !== 'null' && userKey !== 'undefined' && userKey.length >= 10);
    let fid = (req.userSession?.factionId && String(req.userSession.factionId) !== '0')
        ? String(req.userSession.factionId)
        : (req.headers['x-faction-id'] && String(req.headers['x-faction-id']) !== '0' ? String(req.headers['x-faction-id']) : null);

    if (!fid && hasValidKey && typeof deps.getUserFactionInfo === 'function') {
        try {
            const info = await deps.getUserFactionInfo(userKey);
            if (info?.facId && String(info.facId) !== '0') fid = String(info.facId);
        } catch (_) {}
    }
    return { userKey: hasValidKey ? userKey : '', fid };
}

async function getItemsCatalog(apiKey) {
    const now = Date.now();
    if (tornItemsMemoryCache.ts && (now - tornItemsMemoryCache.ts) < 3600000 && Object.keys(tornItemsMemoryCache.items).length > 100) {
        return tornItemsMemoryCache.items;
    }
    try {
        let data = null;
        if (typeof deps.cachedTornFetch === 'function') {
            data = await deps.cachedTornFetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(apiKey)}`, 'torn_items_catalog', 3600000);
        } else {
            data = await fetchJsonWithTimeout(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(apiKey)}`, 10000);
        }
        if (data && data.items) {
            tornItemsMemoryCache = { ts: now, items: data.items };
            return data.items;
        }
    } catch (e) {}
    return tornItemsMemoryCache.items || {};
}

async function getArmoryStockMap(fid, candidateKeys) {
    const cached = armoryStockCache.get(fid);
    if (cached && (Date.now() - cached.ts) < 60000) {
        return cached.stockMap;
    }
    const stockMap = {};
    for (const k of candidateKeys) {
        if (!k) continue;
        try {
            const data = await fetchJsonWithTimeout(
                `https://api.torn.com/faction/${fid}?selections=temporary,boosters,medical,utilities&key=${encodeURIComponent(k)}`,
                8000
            );
            if (data && !data.error) {
                ['temporary', 'boosters', 'medical', 'utilities'].forEach(cat => {
                    const arr = data[cat];
                    if (Array.isArray(arr)) {
                        arr.forEach(item => {
                            const id = String(item.ID || item.id || '');
                            if (!id) return;
                            const avail = Number(item.available ?? item.quantity ?? 0);
                            const total = Number(item.quantity ?? avail ?? 0);
                            const loaned = Number(item.loaned ?? 0);
                            if (!stockMap[id]) {
                                stockMap[id] = { id: Number(id), name: item.name, available: avail, total, loaned, category: cat };
                            } else {
                                stockMap[id].available += avail;
                                stockMap[id].total += total;
                                stockMap[id].loaned += loaned;
                            }
                        });
                    }
                });
                armoryStockCache.set(fid, { ts: Date.now(), stockMap });
                return stockMap;
            }
        } catch (_) {}
    }
    return stockMap;
}

async function getCompletedCrimes(fid, crimeKey, force = false) {
    const cached = completedHistoryCache.get(fid);
    if (!force && cached && (Date.now() - cached.ts) < 60000) {
        return cached.crimes;
    }
    try {
        const offsets = [0, 100, 200];
        const pages = await Promise.all(
            offsets.map(offset =>
                fetchJsonWithTimeout(
                    `https://api.torn.com/v2/faction/${fid}/crimes?cat=completed&limit=100&offset=${offset}&key=${encodeURIComponent(crimeKey)}`,
                    9000
                ).catch(() => ({ crimes: [] }))
            )
        );
        const byId = new Map();
        for (const p of pages) {
            for (const c of (p?.crimes || [])) {
                if (c && c.id && !byId.has(c.id)) {
                    byId.set(c.id, c);
                }
            }
        }
        const merged = Array.from(byId.values()).sort((a, b) => (b.executed_at || b.ready_at || 0) - (a.executed_at || a.ready_at || 0));
        if (merged.length > 0) {
            completedHistoryCache.set(fid, { ts: Date.now(), crimes: merged });
        }
        return merged;
    } catch (e) {
        return cached?.crimes || [];
    }
}

async function getWarAndChainState(fid, apiKey) {
    const cached = rankedWarsCache.get(fid);
    if (cached && (Date.now() - cached.ts) < 30000) {
        return cached.state;
    }
    const state = { activeWar: null, nextScheduledWar: null, chain: null };
    try {
        const data = await fetchJsonWithTimeout(
            `https://api.torn.com/faction/${fid}?selections=chain,rankedwars&key=${encodeURIComponent(apiKey)}`,
            8000
        );
        if (data && !data.error) {
            if (data.chain) state.chain = data.chain;
            const nowSec = Math.floor(Date.now() / 1000);
            const wars = Object.entries(data.rankedwars || {}).map(([id, w]) => ({ id, ...(w.war || {}), factions: w.factions || {} }));
            const active = wars.find(w => w.start > 0 && w.start <= nowSec && (!w.end || w.end === 0) && (!w.winner || w.winner === 0));
            const upcoming = wars
                .filter(w => w.start > nowSec && (!w.end || w.end === 0))
                .sort((a, b) => a.start - b.start)[0] || null;
            state.activeWar = active || null;
            state.nextScheduledWar = upcoming;
            rankedWarsCache.set(fid, { ts: Date.now(), state });
        }
    } catch (_) {}
    return state;
}

function enrichCrimeItemSlot(slot, itemsCatalog, armoryStock) {
    if (!slot?.item_requirement?.id) return slot;
    const itemId = String(slot.item_requirement.id);
    const catalogMeta = itemsCatalog[itemId] || {};
    const armoryMeta = armoryStock[itemId] || null;
    return {
        ...slot,
        item_requirement: {
            ...slot.item_requirement,
            name: catalogMeta.name || `Item #${itemId}`,
            type: catalogMeta.type || 'Item',
            market_value: Number(catalogMeta.market_value || 0),
            armory_available: armoryMeta ? armoryMeta.available : null,
            armory_total: armoryMeta ? armoryMeta.total : null
        }
    };
}

function enrichCrimeRewards(rewards, itemsCatalog) {
    if (!rewards) return rewards;
    const money = Number(rewards.money || 0);
    const respect = Number(rewards.respect || 0);
    let itemValueTotal = 0;
    const enrichedItems = (Array.isArray(rewards.items) ? rewards.items : []).map(it => {
        const meta = itemsCatalog[String(it.id)] || {};
        const qty = Number(it.quantity || 1);
        const unitVal = Number(meta.market_value || 0);
        const totalVal = unitVal * qty;
        itemValueTotal += totalVal;
        return {
            ...it,
            name: meta.name || `Item #${it.id}`,
            type: meta.type || 'Item',
            market_value: unitVal,
            total_value: totalVal
        };
    });
    return {
        ...rewards,
        money,
        respect,
        items: enrichedItems,
        item_value_total: itemValueTotal,
        gross_total: money + itemValueTotal
    };
}

/**
 * GET /api/oc/command-center
 * Unified multi-source payload for all 15 Torn OC 2.0 Command Center tools.
 */
router.get('/command-center', async (req, res) => {
    try {
        const { userKey, fid: initialFid } = await resolveCallerKeyAndFaction(req);
        if (!userKey && !req.userSession) {
            return res.status(401).json({ error: 'Authentication required. Connect your Torn API key in Settings.' });
        }

        let fid = initialFid;
        if (!fid && userKey) {
            const uData = await fetchJsonWithTimeout(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(userKey)}`, 8000);
            if (uData.error) return res.status(400).json({ error: `API Key Error: ${uData.error.error}`, code: uData.error.code });
            if (!uData.faction || !uData.faction.faction_id) {
                return res.status(400).json({ error: 'You are not currently in a faction, so you cannot view Organized Crimes.' });
            }
            fid = String(uData.faction.faction_id);
        }

        const keyDigest = crypto.createHash('sha256').update(`${userKey || 'sess'}:${req.userSession?.playerId || 0}`).digest('hex').slice(0, 10);
        const cacheKey = `${fid}:${keyDigest}`;
        const force = req.query.force === '1' || req.query.force === 'true';
        const cached = commandCenterCache.get(cacheKey);
        if (!force && cached && (Date.now() - cached.ts) < 15000) {
            return res.json(cached.payload);
        }

        const dCfg = deps.getDiscordConfig() || {};
        const hostFacId = String(dCfg.factionId || '52355');
        const isHostMember = Boolean(req.userSession?.isSpiderVerse && fid === hostFacId);
        const candidateKeys = (fid === hostFacId && typeof deps.getFactionArmoryCandidateKeys === 'function')
            ? deps.getFactionArmoryCandidateKeys(fid, userKey)
            : (userKey ? [userKey] : []);

        // Primary key for v2/faction/{fid}/crimes?cat=available
        let effectiveCrimeKey = userKey || (isHostMember ? candidateKeys[0] : '');
        if (!effectiveCrimeKey) {
            return res.status(401).json({ error: 'Torn API Key required. Open Settings to link your key.' });
        }

        let [crimeData, memberData] = await Promise.all([
            fetchJsonWithTimeout(`https://api.torn.com/v2/faction/${fid}/crimes?cat=available&key=${encodeURIComponent(effectiveCrimeKey)}`, 9000),
            fetchJsonWithTimeout(`https://api.torn.com/faction/${fid}?selections=basic&key=${encodeURIComponent(effectiveCrimeKey)}`, 9000)
        ]);

        // If a verified same-faction Spider-Verse member uses a Limited key without AA, try rotating faction AA keys
        if (crimeData.error && isHostMember) {
            const code = Number(crimeData.error.code || 0);
            const isPermErr = code === 7 || code === 16 || /permission|access level/i.test(crimeData.error.error || '');
            if (isPermErr) {
                for (const altKey of candidateKeys) {
                    if (!altKey || altKey === effectiveCrimeKey) continue;
                    const altRes = await fetchJsonWithTimeout(`https://api.torn.com/v2/faction/${fid}/crimes?cat=available&key=${encodeURIComponent(altKey)}`, 9000).catch(() => null);
                    if (altRes && !altRes.error) {
                        crimeData = altRes;
                        effectiveCrimeKey = altKey;
                        if (memberData.error) {
                            memberData = await fetchJsonWithTimeout(`https://api.torn.com/faction/${fid}?selections=basic&key=${encodeURIComponent(altKey)}`, 9000).catch(() => memberData);
                        }
                        break;
                    }
                }
            }
        }

        if (crimeData.error) {
            const errCode = Number(crimeData.error.code || 0);
            const isPermErr = errCode === 7 || errCode === 16 || /permission|access level/i.test(crimeData.error.error || '');
            return res.status(isPermErr ? 403 : 400).json({
                error: `Torn API Error: ${crimeData.error.error || JSON.stringify(crimeData.error)}`,
                code: errCode,
                permissionError: isPermErr,
                requiresAA: isPermErr
            });
        }

        // Parallel fetch: items catalog, 300 completed OCs, faction armory stock, ranked war + chain state
        const [itemsCatalog, completedRaw, armoryStock, warState] = await Promise.all([
            getItemsCatalog(effectiveCrimeKey),
            getCompletedCrimes(fid, effectiveCrimeKey, force),
            getArmoryStockMap(fid, [effectiveCrimeKey, ...candidateKeys]),
            getWarAndChainState(fid, effectiveCrimeKey)
        ]);

        // Member lookup from faction/basic
        const membersRaw = memberData?.members || {};
        const memberLookup = {};
        Object.entries(membersRaw).forEach(([id, m]) => {
            memberLookup[String(id)] = {
                id: Number(id),
                name: m.name || `Player [${id}]`,
                level: Number(m.level || 1),
                days_in_faction: Number(m.days_in_faction || 0),
                position: m.position || 'Member',
                status: m.status || { state: 'Okay', description: 'Okay', until: 0 },
                last_action: m.last_action || { timestamp: 0, relative: 'Unknown', status: 'Offline' }
            };
        });

        const enrichCrime = (c) => {
            const slots = (c.slots || []).map(slot => {
                const enrichedSlot = enrichCrimeItemSlot(slot, itemsCatalog, armoryStock);
                if (enrichedSlot.user && enrichedSlot.user.id) {
                    const mInfo = memberLookup[String(enrichedSlot.user.id)];
                    enrichedSlot.user = {
                        ...enrichedSlot.user,
                        name: mInfo?.name || enrichedSlot.user.name || `ID:${enrichedSlot.user.id}`,
                        level: mInfo?.level || 1,
                        status: mInfo?.status || null,
                        last_action: mInfo?.last_action || null,
                        days_in_faction: mInfo?.days_in_faction ?? null
                    };
                }
                return enrichedSlot;
            });
            return {
                ...c,
                slots,
                rewards: enrichCrimeRewards(c.rewards, itemsCatalog)
            };
        };

        const crimes = (crimeData.crimes || []).map(enrichCrime);
        const completedCrimes = (completedRaw || []).map(enrichCrime);

        // Merge observed faction empirical data into catalog (NFD-normalized to deduplicate "Guardian Ángels" etc.)
        const observedStats = {};
        completedCrimes.forEach(c => {
            const key = normalizeCrimeName(c.name);
            if (!key) return;
            if (!observedStats[key]) {
                observedStats[key] = {
                    name: c.name,
                    difficulty: Number(c.difficulty || 1),
                    count: 0,
                    wins: 0,
                    sumCash: 0,
                    sumItemValue: 0,
                    sumRespect: 0,
                    sumPlanDays: 0,
                    planSamples: 0,
                    roles: (c.slots || []).map(s => s.position || s.position_info?.label || 'Operative'),
                    requiredItemIds: Array.from(new Set((c.slots || []).map(s => s.item_requirement?.id).filter(Boolean))),
                    itemDropCount: 0
                };
            }
            const st = observedStats[key];
            st.count++;
            if (c.planning_at && c.ready_at && c.ready_at > c.planning_at) {
                st.sumPlanDays += (c.ready_at - c.planning_at) / 86400;
                st.planSamples++;
            }
            if (String(c.status || '').toLowerCase() === 'successful') {
                st.wins++;
                st.sumCash += Number(c.rewards?.money || 0);
                st.sumItemValue += Number(c.rewards?.item_value_total || 0);
                st.sumRespect += Number(c.rewards?.respect || 0);
                st.itemDropCount += (c.rewards?.items || []).length;
            }
        });

        const catalogByName = new Map();
        BASE_OC_CATALOG.forEach(entry => {
            catalogByName.set(normalizeCrimeName(entry.name), { ...entry, observedCount: 0, observedWins: 0 });
        });
        Object.entries(observedStats).forEach(([k, obs]) => {
            const base = catalogByName.get(k);
            const avgCash = obs.wins > 0 ? Math.round(obs.sumCash / obs.wins) : (base?.estCash || 0);
            const avgItemVal = obs.wins > 0 ? Math.round(obs.sumItemValue / obs.wins) : (base?.estItemValue || 0);
            const avgRespect = obs.wins > 0 ? Number((obs.sumRespect / obs.wins).toFixed(1)) : (base?.estRespect || 50);
            const planDays = obs.planSamples > 0 ? Number((obs.sumPlanDays / obs.planSamples).toFixed(1)) : (base?.planningDays || 4);
            const roles = obs.roles.length ? obs.roles : (base?.roles || []);
            const reqIds = obs.requiredItemIds.length ? obs.requiredItemIds : (base?.requiredItemIds || []);

            catalogByName.set(k, {
                name: base?.name || obs.name,
                difficulty: obs.difficulty || base?.difficulty || 1,
                crewSize: roles.length || base?.crewSize || 3,
                planningDays: planDays,
                roles,
                requiredItemIds: reqIds,
                estCash: avgCash > 0 || avgItemVal > 0 ? avgCash : (base?.estCash || 0),
                estItemValue: avgItemVal,
                estRespect: avgRespect || base?.estRespect || 50,
                failPenaltyCost: base?.failPenaltyCost || (obs.difficulty * 250000),
                observedCount: obs.count,
                observedWins: obs.wins
            });
        });

        // Harvest Priority 2 per-role CPR cache from live crimes & connected faction members (strictly scoped to fid)
        if (!roleCprCacheByFaction[fid]) roleCprCacheByFaction[fid] = {};
        const facRoleCache = roleCprCacheByFaction[fid];
        let roleCacheDirty = false;
        const nowMs = Date.now();

        const recordCachedCpr = (pId, roleName, cprVal, crimeName, tier, source) => {
            const pStr = String(pId);
            const rStr = String(roleName || '').trim();
            const num = Number(cprVal);
            if (!pStr || !rStr || Number.isNaN(num) || num <= 0 || num > 100) return;
            if (!facRoleCache[pStr]) facRoleCache[pStr] = {};
            const existing = facRoleCache[pStr][rStr];
            if (!existing || existing.cpr !== num || source === 'live' || source === 'user_key') {
                facRoleCache[pStr][rStr] = {
                    cpr: num,
                    crimeName: String(crimeName || ''),
                    tier: Number(tier || 1),
                    source,
                    updatedAt: nowMs
                };
                roleCacheDirty = true;
            }
        };

        // Always record exact live slotted CPRs into Priority 2 cache so members retain role history immediately
        crimes.forEach(c => {
            (c.slots || []).forEach(s => {
                if (s.user?.id && s.checkpoint_pass_rate > 0) {
                    recordCachedCpr(s.user.id, s.position || s.position_info?.label, s.checkpoint_pass_rate, c.name, c.difficulty, 'live');
                }
            });
        });

        // Harvest v2/user/organizedcrime for connected members of THIS faction (capped at 1.5s, 5m cooldown per user)
        const uKeysMod = deps.userKeys;
        if (uKeysMod && typeof uKeysMod.getAllConnectedMembers === 'function') {
            const connectedFacMembers = uKeysMod.getAllConnectedMembers()
                .filter(m => memberLookup[String(m.tornId)] && (!userOcHarvestTimestamps.get(String(m.tornId)) || (nowMs - userOcHarvestTimestamps.get(String(m.tornId))) > 300000))
                .slice(0, 6);
            if (connectedFacMembers.length > 0) {
                const harvestPromise = Promise.allSettled(connectedFacMembers.map(async (m) => {
                    userOcHarvestTimestamps.set(String(m.tornId), nowMs);
                    const uOc = await fetchJsonWithTimeout(`https://api.torn.com/v2/user/organizedcrime?key=${encodeURIComponent(m.key)}`, 4000).catch(() => null);
                    const ocObj = uOc?.organizedCrime;
                    if (ocObj && Array.isArray(ocObj.slots)) {
                        ocObj.slots.forEach(sl => {
                            if ((!sl.user || Number(sl.user.id) === Number(m.tornId)) && Number(sl.checkpoint_pass_rate || 0) > 0) {
                                recordCachedCpr(m.tornId, sl.position || sl.position_info?.label, sl.checkpoint_pass_rate, ocObj.name, ocObj.difficulty, 'user_key');
                            }
                        });
                    }
                }));
                await Promise.race([harvestPromise, new Promise(r => setTimeout(r, 1500))]);
            }
        }
        if (roleCacheDirty) saveRoleCprCache();

        const catalog = Array.from(catalogByName.values()).map(entry => {
            const requiredItems = (entry.requiredItemIds || []).map(id => {
                const meta = itemsCatalog[String(id)] || {};
                const stock = armoryStock[String(id)] || null;
                return {
                    id: Number(id),
                    name: meta.name || `Item #${id}`,
                    market_value: Number(meta.market_value || 0),
                    armory_available: stock ? stock.available : null
                };
            });
            const consumableCost = requiredItems.reduce((s, it) => s + it.market_value, 0);
            return { ...entry, requiredItems, consumableCost };
        }).sort((a, b) => a.difficulty - b.difficulty || a.name.localeCompare(b.name));

        // Build per-member CPR history & role CPR map (active + completed + saved overrides)
        const facOverrides = cprOverridesByFaction[fid] || {};
        const ocMemHist = deps.getOcMemberHistory() || {};

        const ocCfg = deps.getOcConfig() || {};
        const hostLevels = (String(fid) === String(hostFacId))
            ? (ocCfg.lowCprLevels || ocCfg.ocDm?.triggers?.low_cpr_dm?.tierFloors || {})
            : {};
        const mergedLevels = sanitizeTierFloors(cprFloorsByFaction[fid], hostLevels);
        const defaultFloors = {
            tier1to4: 70,
            tier5to8: 65,
            lowCprDefaultThreshold: ocCfg.lowCprDefaultThreshold ?? 40,
            lowCprLevels: mergedLevels
        };

        const payload = {
            success: true,
            factionId: fid,
            factionName: memberData?.name || req.userSession?.factionName || `Faction [${fid}]`,
            fetchedAt: Date.now(),
            crimes,
            completedCrimes,
            members: memberLookup,
            armoryStock,
            warState,
            catalog,
            cprOverrides: facOverrides,
            factionRoleCprCache: facRoleCache,
            payoutStatus: payoutStatusByFaction[fid] || {},
            ocMemberHistory: ocMemHist,
            cprFloors: defaultFloors
        };

        commandCenterCache.set(cacheKey, { ts: Date.now(), payload });
        res.json(payload);
    } catch (err) {
        console.error('[OC-Command] Error building command-center payload:', err);
        res.status(500).json({ error: err.message || 'Failed to load OC Command Center' });
    }
});

/**
 * POST /api/oc/cpr-import
 * Import CPR ratings via TornStats API key OR manual/JSON overrides for this caller's faction.
 */
router.post('/cpr-import', async (req, res) => {
    try {
        const { userKey, fid: initialFid } = await resolveCallerKeyAndFaction(req);
        if (!userKey && !req.userSession) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const fid = initialFid || '52355';
        const { tornStatsKey, manualOverrides } = req.body || {};

        if (!cprOverridesByFaction[fid]) cprOverridesByFaction[fid] = {};
        let importedCount = 0;

        if (tornStatsKey && String(tornStatsKey).trim().length >= 8) {
            const cleanTs = String(tornStatsKey).trim();
            try {
                const tsData = await fetchJsonWithTimeout(`https://www.tornstats.com/api/v2/${encodeURIComponent(cleanTs)}/faction/cpr`, 9000);
                if (tsData && tsData.status !== false && tsData.members && typeof tsData.members === 'object') {
                    Object.entries(tsData.members).forEach(([pId, roles]) => {
                        if (!cprOverridesByFaction[fid][String(pId)]) cprOverridesByFaction[fid][String(pId)] = {};
                        if (roles && typeof roles === 'object') {
                            Object.entries(roles).forEach(([roleKey, val]) => {
                                const num = Number(val);
                                if (!Number.isNaN(num) && num >= 0 && num <= 100) {
                                    cprOverridesByFaction[fid][String(pId)][roleKey] = num;
                                    importedCount++;
                                }
                            });
                        }
                    });
                } else if (tsData?.message) {
                    return res.status(400).json({ success: false, error: `TornStats: ${tsData.message}` });
                }
            } catch (e) {
                return res.status(502).json({ success: false, error: `TornStats unreachable: ${e.message}` });
            }
        }

        if (manualOverrides && typeof manualOverrides === 'object') {
            Object.entries(manualOverrides).forEach(([pId, roles]) => {
                if (!cprOverridesByFaction[fid][String(pId)]) cprOverridesByFaction[fid][String(pId)] = {};
                if (roles && typeof roles === 'object') {
                    Object.entries(roles).forEach(([roleKey, val]) => {
                        const num = Number(val);
                        if (!Number.isNaN(num) && num >= 0 && num <= 100) {
                            cprOverridesByFaction[fid][String(pId)][roleKey] = num;
                            importedCount++;
                        }
                    });
                }
            });
        }

        if (importedCount > 0) {
            saveCprOverrides();
            // Clear cached command center payloads for this faction
            for (const key of commandCenterCache.keys()) {
                if (key.startsWith(`${fid}:`)) commandCenterCache.delete(key);
            }
        }

        res.json({ success: true, importedCount, overrides: cprOverridesByFaction[fid] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/oc/payout-status
 * Persist Paid / Unpaid settlement flags for completed crimes per faction.
 */
router.post('/payout-status', async (req, res) => {
    try {
        const { userKey, fid: initialFid } = await resolveCallerKeyAndFaction(req);
        if (!userKey && !req.userSession) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const fid = initialFid || '52355';
        const { crimeIds, paid } = req.body || {};
        if (!Array.isArray(crimeIds) || crimeIds.length === 0) {
            return res.status(400).json({ success: false, error: 'crimeIds array is required' });
        }
        if (!payoutStatusByFaction[fid]) payoutStatusByFaction[fid] = {};
        const now = Date.now();
        const actor = req.userSession?.playerName || 'Leadership';
        crimeIds.forEach(cid => {
            const idStr = String(cid).trim();
            if (!idStr) return;
            if (paid) {
                payoutStatusByFaction[fid][idStr] = { paid: true, paidAt: now, paidBy: actor };
            } else {
                payoutStatusByFaction[fid][idStr] = { paid: false, updatedAt: now, updatedBy: actor };
            }
        });
        savePayoutStatus();
        for (const key of commandCenterCache.keys()) {
            if (key.startsWith(`${fid}:`)) commandCenterCache.delete(key);
        }
        res.json({ success: true, payoutStatus: payoutStatusByFaction[fid] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/oc/cpr-floors
 * Persist per-OC-level (Tiers 1–8) minimum CPR thresholds for this faction and sync host OC DM bot config.
 */
router.post('/cpr-floors', async (req, res) => {
    try {
        const { userKey, fid: initialFid } = await resolveCallerKeyAndFaction(req);
        if (!userKey && !req.userSession) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const dCfg = deps.getDiscordConfig() || {};
        const hostFacId = String(dCfg.factionId || '52355');
        const fid = initialFid || hostFacId;
        const { lowCprLevels } = req.body || {};
        if (!lowCprLevels || typeof lowCprLevels !== 'object') {
            return res.status(400).json({ success: false, error: 'lowCprLevels object (keys 1..8) is required' });
        }

        const existing = cprFloorsByFaction[fid] || (String(fid) === hostFacId ? (deps.getOcConfig()?.lowCprLevels || {}) : {});
        const cleanLevels = sanitizeTierFloors(lowCprLevels, existing);
        cprFloorsByFaction[fid] = cleanLevels;
        saveCprFloors();

        if (String(fid) === hostFacId && typeof deps.saveOcCprFloors === 'function') {
            deps.saveOcCprFloors(cleanLevels);
        }

        for (const key of commandCenterCache.keys()) {
            if (key.startsWith(`${fid}:`)) commandCenterCache.delete(key);
        }
        res.json({ success: true, factionId: fid, lowCprLevels: cleanLevels });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = {
    router,
    setDeps,
    BASE_OC_CATALOG
};
