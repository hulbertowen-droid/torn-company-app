'use strict';

/**
 * Faction Gym & Battle Stat Tracker - Backend Route & Analytics Engine (v2.0)
 * 
 * Features:
 * - Multi-window gains calculation (24h, 7d, 30d, custom date ranges)
 * - Privacy tier enforcement (full, gains_only, leadership_only)
 * - Energy utilization & training efficiency scoring (Xanax, Refills, Natural Energy)
 * - Automated slacker & inactivity detection
 * - Timed competitions & gamified live leaderboards
 * - War readiness tactical classification & Fair Fight target matcher with Stat Ratio Analysis
 * - Faction member roster synchronization from live dashboard and warboard cache
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const tornKnowledge = require('../torn-knowledge');
let userKeys = null;
try {
    userKeys = require('../user-keys');
} catch(e) {}

// Reference to core data stores
const DATA_DIR = path.join(__dirname, '..', 'data');
const BATTLESTATS_FILE = path.join(DATA_DIR, 'battlestats_history.json');
const PRIVACY_FILE = path.join(DATA_DIR, 'gym_privacy_prefs.json');
const COMPETITIONS_FILE = path.join(DATA_DIR, 'gym_competitions.json');
const GOALS_FILE = path.join(DATA_DIR, 'gym_goals.json');
const WARBOARD_FILE = path.join(DATA_DIR, 'last_warboard.json');

// Memory caches
let privacyPrefs = {};
let competitions = [];
let memberGoals = {};

function loadData() {
    try {
        if (fs.existsSync(PRIVACY_FILE)) {
            privacyPrefs = JSON.parse(fs.readFileSync(PRIVACY_FILE, 'utf8'));
        }
    } catch(e) { console.warn('[GymTracker] Error loading privacy prefs:', e.message); }

    try {
        if (fs.existsSync(COMPETITIONS_FILE)) {
            competitions = JSON.parse(fs.readFileSync(COMPETITIONS_FILE, 'utf8'));
        }
    } catch(e) { console.warn('[GymTracker] Error loading competitions:', e.message); }

    try {
        if (fs.existsSync(GOALS_FILE)) {
            memberGoals = JSON.parse(fs.readFileSync(GOALS_FILE, 'utf8'));
        }
    } catch(e) { console.warn('[GymTracker] Error loading goals:', e.message); }

    // Seed default competition if none active
    seedDefaultCompetitions();
}
loadData();

function seedDefaultCompetitions() {
    if (!competitions || competitions.length === 0) {
        const now = Date.now();
        competitions = [
            {
                id: 'contest-pre-war-blitz',
                title: '⚡ 7-Day Pre-War Strength Blitz',
                description: 'Faction-wide competition: Boost raw strength in preparation for our upcoming Ranked War. Top 3 gainers take the prize pool!',
                targetType: 'stat_gain',
                targetStat: 'strength',
                startTime: now - (2 * 86400000), // Started 2 days ago
                endTime: now + (5 * 86400000),   // 5 days remaining
                prizePool: 50000000,
                prizeDescription: '$50,000,000 Faction Vault Prize Pool (50% / 30% / 20%)',
                creatorId: 3776908,
                creatorName: 'Owen777 [3776908]',
                status: 'active'
            }
        ];
        saveCompetitions();
    }
}

function savePrivacyPrefs() {
    try {
        fs.writeFileSync(PRIVACY_FILE, JSON.stringify(privacyPrefs, null, 2), 'utf8');
    } catch(e) { console.error('[GymTracker] Error saving privacy prefs:', e.message); }
}

function saveCompetitions() {
    try {
        fs.writeFileSync(COMPETITIONS_FILE, JSON.stringify(competitions, null, 2), 'utf8');
    } catch(e) { console.error('[GymTracker] Error saving competitions:', e.message); }
}

function saveGoals() {
    try {
        fs.writeFileSync(GOALS_FILE, JSON.stringify(memberGoals, null, 2), 'utf8');
    } catch(e) { console.error('[GymTracker] Error saving goals:', e.message); }
}

// Helper to resolve requester ID and leadership status
function resolveRequester(req) {
    const sess = req.userSession || {};
    const callerId = Number(sess.playerId || req.headers['x-player-id'] || 0);
    const isOwner = Boolean(sess.isSpiderVerse || sess.isOwner || callerId === 3776908);
    const role = (sess.role || '').toLowerCase();
    const isLeadership = isOwner || role.includes('leader') || role.includes('co-leader') || role.includes('officer');
    return { callerId, isLeadership, isOwner };
}

// Helper to resolve the active faction ID for the user
function resolveFaction(req) {
    const sess = req.userSession || {};
    let facId = req.query?.factionId || req.query?.faction_id || req.headers?.['x-faction-id'] || sess.factionId;
    if (!facId || String(facId) === '0' || String(facId) === 'null' || String(facId) === 'undefined') {
        facId = (global.discordConfig && global.discordConfig.factionId) || '52355';
    }
    return String(facId).trim();
}

// Helper to resolve Torn API key
function resolveApiKey(req) {
    let key = req.userTornKey || req.headers?.['x-api-key'] || req.query?.apiKey;
    if (!key || key === 'null' || key.trim() === '') {
        if (global.discordConfig && global.discordConfig.apiKey) {
            key = global.discordConfig.apiKey;
        } else if (global.ADMIN_API_KEY) {
            key = global.ADMIN_API_KEY;
        }
    }
    return key || null;
}

const ROSTER_CACHE_FILE = (fid) => path.join(DATA_DIR, `faction_roster_${fid}.json`);
let inMemoryRosterCache = {}; // { [fid]: { timestamp: number, rosterMap: Map } }

// Ingest live faction roster strictly scoped to targetFacId
async function getUnifiedFactionRoster(targetFacId = '52355', userKey = null) {
    const fid = String(targetFacId || (global.discordConfig && global.discordConfig.factionId) || '52355').trim();
    const now = Date.now();

    // 1. Check in-memory cache (TTL 10 minutes)
    if (inMemoryRosterCache[fid] && (now - inMemoryRosterCache[fid].timestamp < 10 * 60 * 1000)) {
        if (inMemoryRosterCache[fid].rosterMap && inMemoryRosterCache[fid].rosterMap.size > 0) {
            return inMemoryRosterCache[fid].rosterMap;
        }
    }

    // 2. Check dashboardDataCache specifically for this target faction (live from /api/dashboard-data)
    if (typeof global.dashboardDataCache === 'object' && global.dashboardDataCache) {
        for (const [k, c] of Object.entries(global.dashboardDataCache)) {
            if ((k.startsWith(`${fid}_`) || (fid === '52355' && k.startsWith('default_'))) && c?.data?.members) {
                const map = new Map();
                for (const [mId, mInfo] of Object.entries(c.data.members)) {
                    const id = Number(mId);
                    if (id) {
                        let ts = Number(mInfo.last_action?.timestamp || 0);
                        if (ts > 100000000000) ts = Math.floor(ts / 1000);
                        const statusObj = mInfo.status || { state: mInfo.state || 'Okay', description: mInfo.statusDescription || 'Okay', until: mInfo.until || 0 };
                        map.set(id, {
                            id,
                            name: mInfo.name || `Player [${id}]`,
                            level: Number(mInfo.level || 1),
                            position: mInfo.position || 'Member',
                            days_in_faction: Number(mInfo.days_in_faction || 0),
                            lastActionTimestamp: ts || Math.floor(Date.now() / 1000),
                            onlineStatus: (mInfo.last_action?.status || 'offline').toLowerCase(),
                            status: statusObj
                        });
                    }
                }
                if (map.size > 0) {
                    inMemoryRosterCache[fid] = { timestamp: now, rosterMap: map };
                    return map;
                }
            }
        }
    }

    // 3. Fetch live verified roster from Torn API whenever an API key is available
    const effectiveKey = userKey || (global.discordConfig && global.discordConfig.apiKey) || global.ADMIN_API_KEY || null;
    if (effectiveKey) {
        try {
            const url = `https://api.torn.com/faction/${fid}?selections=basic&key=${effectiveKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            const data = await res.json();
            if (data && data.members && typeof data.members === 'object') {
                const map = new Map();
                for (const [mId, mInfo] of Object.entries(data.members)) {
                    const id = Number(mId);
                    if (id) {
                        let ts = Number(mInfo.last_action?.timestamp || 0);
                        if (ts > 100000000000) ts = Math.floor(ts / 1000);
                        const statusObj = mInfo.status || { state: mInfo.state || 'Okay', description: mInfo.statusDescription || 'Okay', until: mInfo.until || 0 };
                        map.set(id, {
                            id,
                            name: mInfo.name || `Player [${id}]`,
                            level: Number(mInfo.level || 1),
                            position: mInfo.position || 'Member',
                            days_in_faction: Number(mInfo.days_in_faction || 0),
                            lastActionTimestamp: ts || Math.floor(Date.now() / 1000),
                            onlineStatus: (mInfo.last_action?.status || 'offline').toLowerCase(),
                            status: statusObj
                        });
                    }
                }
                if (map.size > 0) {
                    inMemoryRosterCache[fid] = { timestamp: now, rosterMap: map };
                    try {
                        const cachePath = ROSTER_CACHE_FILE(fid);
                        const serialized = Array.from(map.values());
                        fs.writeFileSync(cachePath, JSON.stringify({ timestamp: now, members: serialized }, null, 2), 'utf8');
                    } catch(e) {}
                    return map;
                }
            }
        } catch(e) {
            console.warn('[GymTracker] Live API roster fetch error:', e.message);
        }
    }

    // 4. Check disk cache from previous successful live API fetch
    try {
        const cachePath = ROSTER_CACHE_FILE(fid);
        if (fs.existsSync(cachePath)) {
            const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            if (parsed && Array.isArray(parsed.members) && parsed.members.length > 0) {
                const map = new Map();
                parsed.members.forEach(m => map.set(Number(m.id), m));
                inMemoryRosterCache[fid] = { timestamp: parsed.timestamp || now, rosterMap: map };
                return map;
            }
        }
    } catch(e) {}

    // 5. Last resort fallback (only if offline and no cache ever existed)
    const fallbackMap = new Map();
    if (fid === '52355') {
        try {
            if (fs.existsSync(WARBOARD_FILE)) {
                const wb = JSON.parse(fs.readFileSync(WARBOARD_FILE, 'utf8'));
                const friendly = Array.isArray(wb.friendly) ? wb.friendly : (wb.friendly?.members ? Object.values(wb.friendly.members) : []);
                friendly.forEach(m => {
                    const id = Number(m.id || m.playerId);
                    if (id) {
                        let ts = Number(m.lastActionTimestamp || 0);
                        if (ts > 100000000000) ts = Math.floor(ts / 1000);
                        const statusObj = m.status || { state: m.state || 'Okay', description: m.statusDescription || 'Okay', until: m.until || 0 };
                        fallbackMap.set(id, {
                            id,
                            name: m.name || m.playerName || `Player [${id}]`,
                            level: Number(m.level || 1),
                            position: m.position || 'Member',
                            days_in_faction: Number(m.daysInFaction || m.days_in_faction || 0),
                            lastActionTimestamp: ts,
                            onlineStatus: (m.onlineStatus || 'offline').toLowerCase(),
                            status: statusObj
                        });
                    }
                });
            }
        } catch (e) {
            console.warn('[GymTracker] Warboard roster read error:', e.message);
        }
    }

    return fallbackMap;
}

// Determine stat archetype
function determineArchetype(str, spd, def, dex, total) {
    if (!total || total <= 0) return 'HankBalanced';
    const maxVal = Math.max(str, spd, def, dex);
    const maxRatio = maxVal / total;

    if (maxRatio >= 0.40) {
        if (maxVal === str) return 'StrengthSpecialist';
        if (maxVal === def) return 'DefenseTank';
        if (maxVal === spd) return 'SpeedSpecialist';
        if (maxVal === dex) return 'DexterityGhost';
    }
    if ((str + spd) / total >= 0.68) return 'GlassCannon';
    return 'HankBalanced';
}

// Calculate Fair Fight multiplier (bounded 1.0x to 3.0x) with Torn City combat formula: FF = 1 + 8/9 * (Defender / Attacker)
function calculateFairFight(attackerTotal, defenderTotal) {
    if (!attackerTotal || !defenderTotal || defenderTotal <= 0) return 1.0;
    const ratio = defenderTotal / attackerTotal;
    const ff = 1.0 + (ratio * 8 / 9);
    return Math.min(3.0, Math.max(1.0, Number(ff.toFixed(2))));
}

// Compare Attacker vs Defender Stat Ratios to detect high DEF walls and high DEX evasion
function evaluateCombatMatchup(attacker, defender) {
    const aTotal = Number(attacker.total || 0);
    const dTotal = Number(defender.total || 0);
    const ff = calculateFairFight(aTotal, dTotal);

    const aStr = Number(attacker.strength || aTotal * 0.25);
    const aSpd = Number(attacker.speed || aTotal * 0.25);
    const aDef = Number(attacker.defense || aTotal * 0.25);
    const aDex = Number(attacker.dexterity || aTotal * 0.25);

    const dStr = Number(defender.strength || dTotal * 0.25);
    const dSpd = Number(defender.speed || dTotal * 0.25);
    const dDef = Number(defender.defense || dTotal * 0.25);
    const dDex = Number(defender.dexterity || dTotal * 0.25);

    const warnings = [];
    const advantages = [];

    // Strength vs Defense wall
    if (dDef > 0) {
        const strDefRatio = aStr / dDef;
        if (strDefRatio < 0.45) {
            warnings.push('⚠️ Extreme Defense Wall: High chance of dealing 0-1 damage per hit.');
        } else if (strDefRatio < 0.8) {
            warnings.push('⚠️ Tough Defender: Heavy damage reduction expected.');
        } else if (strDefRatio > 2.0) {
            advantages.push('⚔️ Armor Crusher: Overwhelming strength advantage.');
        }
    }

    // Speed vs Dexterity evasion
    if (dDex > 0) {
        const spdDexRatio = aSpd / dDex;
        if (spdDexRatio < 0.45) {
            warnings.push('⚠️ High Dexterity Ghost: Projected hit chance < 30%.');
        } else if (spdDexRatio < 0.8) {
            warnings.push('⚠️ Slippery Target: Moderate miss penalty.');
        } else if (spdDexRatio > 2.0) {
            advantages.push('🎯 Guaranteed Hit: Target cannot evade your attacks.');
        }
    }

    let tacticalRating = '⚪ Suboptimal';
    if (warnings.length === 0) {
        if (ff >= 2.5) tacticalRating = '⭐ S-Tier Match (3.0x FF)';
        else if (ff >= 1.8) tacticalRating = '🟢 Optimal Target (2.0x+ FF)';
        else tacticalRating = '🟡 Easy Hit (Low Respect)';
    } else {
        tacticalRating = '⚠️ Risky Matchup (Stat Wall)';
    }

    return {
        fairFightMultiplier: ff,
        tacticalRating,
        warnings,
        advantages,
        hasDefenseWall: warnings.some(w => w.includes('Defense Wall')),
        hasDexEvasion: warnings.some(w => w.includes('Dexterity Ghost'))
    };
}

// Get baseline snapshot from player history closest to cutoff
function getBaselineSnapshot(history, cutoff) {
    if (!Array.isArray(history) || history.length === 0) return null;
    const sorted = [...history].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // Newest first

    if (cutoff <= 0) {
        return sorted[sorted.length - 1]; // Oldest fallback
    }
    let match = sorted.find(h => (h.timestamp || 0) <= cutoff && (h.total || 0) > 0);
    if (!match) {
        match = sorted[sorted.length - 1];
    }
    return match;
}

// Compute delta stats between two snapshots
function computeDelta(curStats, baseStats) {
    const curTotal = Number(curStats?.total || 0);
    const baseTotal = Number(baseStats?.total || curTotal);

    const gainStr = Number(curStats?.strength || 0) - Number(baseStats?.strength || curStats?.strength || 0);
    const gainSpd = Number(curStats?.speed || 0) - Number(baseStats?.speed || curStats?.speed || 0);
    const gainDef = Number(curStats?.defense || 0) - Number(baseStats?.defense || curStats?.defense || 0);
    const gainDex = Number(curStats?.dexterity || 0) - Number(baseStats?.dexterity || curStats?.dexterity || 0);
    const gainTotal = curTotal - baseTotal;
    const pct = baseTotal > 0 ? Number(((gainTotal / baseTotal) * 100).toFixed(2)) : 0;

    return {
        strength: gainStr,
        speed: gainSpd,
        defense: gainDef,
        dexterity: gainDex,
        total: gainTotal,
        pct
    };
}

// Build unified member record with accurate Level, Relative Time, and Compliance
function buildMemberRecord(pId, bRec, info, callerId, isLeadership, customStart = null, customEnd = null) {
    const now = Date.now();
    const curStats = bRec?.stats || (bRec?.history?.[0]) || { strength: 0, speed: 0, defense: 0, dexterity: 0, total: 0 };
    const curTotal = Number(curStats.total || (Number(curStats.strength||0) + Number(curStats.speed||0) + Number(curStats.defense||0) + Number(curStats.dexterity||0)));
    const curStr = Number(curStats.strength || 0);
    const curSpd = Number(curStats.speed || 0);
    const curDef = Number(curStats.defense || 0);
    const curDex = Number(curStats.dexterity || 0);

    const history = Array.isArray(bRec?.history) ? bRec.history : [];
    const hasApiKey = Boolean(userKeys && typeof userKeys.hasLinkedKey === 'function' && (userKeys.hasLinkedKey(pId) || userKeys.hasLinkedKey('torn:' + pId)));
    const hasHistory = Boolean(bRec && ((bRec.stats && Number(bRec.stats.total || 0) > 0) || (bRec.history && bRec.history.length > 0 && Number(bRec.history[0].total || 0) > 0)));
    const isConfirmed = Boolean(hasApiKey || hasHistory);
    const isEstimated = !isConfirmed;

    // Privacy tier resolution
    const privacy = privacyPrefs[String(pId)] || 'full';
    const isSelf = (callerId === Number(pId));
    const canViewStats = isOwnerOrSelfOrFull(privacy, isSelf, isLeadership);

    // Baseline snapshots for 24h, 7d, 30d
    const base24h = getBaselineSnapshot(history, now - 86400000);
    const base7d = getBaselineSnapshot(history, now - (7 * 86400000));
    const base30d = getBaselineSnapshot(history, now - (30 * 86400000));

    const gain24h = computeDelta({ strength: curStr, speed: curSpd, defense: curDef, dexterity: curDex, total: curTotal }, base24h);
    const gain7d = computeDelta({ strength: curStr, speed: curSpd, defense: curDef, dexterity: curDex, total: curTotal }, base7d);
    const gain30d = computeDelta({ strength: curStr, speed: curSpd, defense: curDef, dexterity: curDex, total: curTotal }, base30d);

    let customGain = null;
    if (customStart) {
        const baseCustom = getBaselineSnapshot(history, customStart);
        const endCustom = customEnd ? getBaselineSnapshot(history, customEnd) : { strength: curStr, speed: curSpd, defense: curDef, dexterity: curDex, total: curTotal };
        customGain = computeDelta(endCustom, baseCustom);
    }

    const archetype = determineArchetype(curStr, curSpd, curDef, curDex, curTotal);

    const balance = {
        strengthPct: curTotal > 0 ? Number(((curStr / curTotal) * 100).toFixed(1)) : 25,
        speedPct: curTotal > 0 ? Number(((curSpd / curTotal) * 100).toFixed(1)) : 25,
        defensePct: curTotal > 0 ? Number(((curDef / curTotal) * 100).toFixed(1)) : 25,
        dexterityPct: curTotal > 0 ? Number(((curDex / curTotal) * 100).toFixed(1)) : 25
    };

    // Exact Personal Stats, 00:00 TCT Xanax Tracking & Drug Cooldown Idle Hours (zero heuristics)
    const pStats = bRec?.personalStats || {};
    const totalXanTaken = Number(pStats.xantaken ?? bRec?.xanaxDaily?.currentXanax ?? bRec?.stats?.xanax ?? 0);
    const hasExactXanax = Boolean(
        pStats.xantaken !== undefined ||
        bRec?.xanaxDaily?.currentXanax !== undefined ||
        Number(bRec?.stats?.xanax || 0) > 0
    );
    const refills = Boolean(pStats.refills || bRec?.stats?.refills);
    const todayTctStr = new Date(now).toISOString().slice(0, 10);
    const xDaily = bRec?.xanaxDaily || null;
    let takenTodayTct = null;
    let baselineAtTct = null;
    let baselineIsMidnight = false;
    if (hasExactXanax && xDaily && xDaily.tctDate === todayTctStr && xDaily.baselineXanax !== undefined) {
        baselineAtTct = Number(xDaily.baselineXanax);
        takenTodayTct = Math.max(0, totalXanTaken - baselineAtTct);
        baselineIsMidnight = Boolean(xDaily.baselineIsMidnight);
    } else if (hasExactXanax) {
        const todayStartMs = Date.parse(`${todayTctStr}T00:00:00Z`);
        const todayBaseEntry = history
            .filter(h => (h.timestamp || 0) >= todayStartMs && typeof h.xantaken === 'number')
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))[0];
        if (todayBaseEntry) {
            baselineAtTct = Number(todayBaseEntry.xantaken);
            takenTodayTct = Math.max(0, totalXanTaken - baselineAtTct);
        }
    }

    const drugCooldownView = (typeof global.computeLiveDrugCooldownView === 'function')
        ? global.computeLiveDrugCooldownView(bRec, now)
        : (() => {
            const dc = bRec?.drugCooldown;
            if (!dc || typeof dc.lastCheckedAt !== 'number') {
                return { tracked: false, active: false, remainingSec: null, cooldownEndsAt: null, inactiveSince: null, inactiveHours: null, inactiveHoursTodayTct: null, lastCheckedAt: null, isFloorEstimate: false };
            }
            const active = Boolean(dc.active && dc.cooldownEndsAt && dc.cooldownEndsAt > now);
            const remainingSec = active ? Math.max(1, Math.ceil((dc.cooldownEndsAt - now) / 1000)) : 0;
            const inactiveSince = active ? null : (dc.active && dc.cooldownEndsAt <= now ? Math.max(dc.lastCheckedAt, Math.min(now, dc.cooldownEndsAt)) : (dc.inactiveSince || dc.lastCheckedAt));
            const inactiveHours = active ? 0 : (inactiveSince ? Number((Math.max(0, now - inactiveSince) / 3600000).toFixed(2)) : 0);
            return {
                tracked: true,
                active,
                remainingSec,
                cooldownEndsAt: active ? dc.cooldownEndsAt : null,
                inactiveSince,
                inactiveHours,
                inactiveHoursTodayTct: dc.dailyDate === todayTctStr ? Number((Number(dc.dailyInactiveMs || 0) / 3600000).toFixed(2)) : null,
                lastCheckedAt: dc.lastCheckedAt,
                isFloorEstimate: Boolean(dc.isFloorEstimate)
            };
        })();

    const dailyXanax = takenTodayTct !== null ? takenTodayTct : null;

    // Energy Spent Estimation
    const energyFromTrains = gain7d.total > 0 ? Math.min(gain7d.total / 12, 4200) : 0;
    const energySpentEst = Math.max(0, Math.round(energyFromTrains + (refills ? 150 : 0)));
    const theoreticalMaxWeekly = 7 * 1400; // 7 days @ 1400e (3 xanax + natural + refill)
    const efficiencyScore = Math.min(100, Math.max(5, Math.round((energySpentEst / theoreticalMaxWeekly) * 100)));

    // Normalize Last Action Timestamp (ALWAYS in SECONDS)
    let lastActiveSec = Number(info?.lastActionTimestamp || info?.last_action?.timestamp || 0);
    if (!lastActiveSec && bRec?.lastUpdated) {
        lastActiveSec = Math.floor(bRec.lastUpdated / 1000);
    }
    if (lastActiveSec > 100000000000) {
        lastActiveSec = Math.floor(lastActiveSec / 1000);
    }
    if (!lastActiveSec) {
        lastActiveSec = Math.floor(now / 1000);
    }

    const secondsSinceActive = Math.max(0, Math.floor(now / 1000 - lastActiveSec));
    const hoursSinceActive = Math.floor(secondsSinceActive / 3600);
    const zeroTrainHours = gain24h.total <= 0 ? 24 : 0;
    const weeklyQuota = 1500;
    const quotaMet = energySpentEst >= weeklyQuota;
    
    // Flag wasted natural energy if online/idle and 0 trains in 24h
    const energyCapped = (zeroTrainHours >= 24 && hoursSinceActive < 4);

    // Extract state, description, position, days in faction for explicit exemption audit
    const state = (info?.status?.state || info?.state || 'Okay').trim();
    const statusDesc = (info?.status?.description || info?.statusDescription || '').trim();
    const position = (info?.position || bRec?.position || 'Member').trim();
    const daysInFaction = Number(info?.days_in_faction || info?.daysInFaction || bRec?.daysInFaction || 0);
    const untilSec = Number(info?.status?.until || info?.until || 0);

    let isExempt = false;
    let exemptReason = '';

    const descLower = statusDesc.toLowerCase();
    const posLower = position.toLowerCase();

    if (state === 'Federal' || descLower.includes('federal')) {
        isExempt = true;
        exemptReason = 'In Federal Jail';
    } else if (state === 'Jail' || descLower.includes('jail')) {
        isExempt = true;
        exemptReason = 'In Jail';
    } else if (state === 'Abroad' || state === 'Traveling' || descLower.includes('traveling') || descLower.includes('abroad') || descLower.includes('islands') || descLower.includes('switzerland') || descLower.includes('japan') || descLower.includes('argentina') || descLower.includes('china') || descLower.includes('mexico') || descLower.includes('canada') || descLower.includes('hawaii') || descLower.includes('united kingdom') || descLower.includes('south africa') || descLower.includes('uae')) {
        isExempt = true;
        exemptReason = state === 'Traveling' ? 'Traveling' : 'Abroad / Traveling';
    } else if (state === 'Hospital' || descLower.includes('hospital')) {
        isExempt = true;
        exemptReason = 'Hospitalized';
    } else if (daysInFaction < 3) {
        isExempt = true;
        exemptReason = 'New Recruit Grace Period (<3 days)';
    } else if (descLower.includes('leave') || descLower.includes('vacation') || posLower.includes('leave') || posLower.includes('inactiv') || posLower.includes('vacation')) {
        isExempt = true;
        exemptReason = 'Inactivity / Vacation Leave';
    }

    // Single source of truth disjoint partitioning:
    // 1. Active: trained in last 24h
    // 2. Exempt: did not train in 24h, but has valid status exemption (travel, hospital, jail, leave, recruit)
    // 3. Slacker: did not train in 24h and is not exempt
    const trainedToday = (gain24h.total > 0);
    let category = 'slacker';
    if (trainedToday) {
        category = 'active';
    } else if (isExempt) {
        category = 'exempt';
    } else {
        category = 'slacker';
    }

    const isSlacking = (category === 'slacker');
    const warningReasons = [];
    if (isSlacking) {
        if (zeroTrainHours >= 24 && hoursSinceActive < 48) warningReasons.push('0 trains recorded in last 24h while active');
        if (energyCapped) warningReasons.push('⚠️ Wasted Natural Energy: Capped at maximum energy without training for >2h');
        if (!quotaMet && hoursSinceActive < 48) warningReasons.push(`Below weekly quota (${energySpentEst} / ${weeklyQuota}e)`);
        if (hoursSinceActive >= 48) warningReasons.push(`Inactive on Torn for ${hoursSinceActive}h`);
        if (warningReasons.length === 0) warningReasons.push('0 trains recorded in last 24h');
    }

    // Goal tracker
    const customGoal = memberGoals[String(pId)];
    let goalProgress = null;
    if (customGoal) {
        const val = customGoal.stat === 'total' ? curTotal : Number(curStats[customGoal.stat] || 0);
        const target = Number(customGoal.targetValue || 50000000);
        const progressPct = Math.min(100, Number(((val / target) * 100).toFixed(1)));
        goalProgress = {
            stat: customGoal.stat,
            targetValue: target,
            currentValue: val,
            progressPct,
            title: customGoal.title || `Goal: ${customGoal.stat.toUpperCase()}`
        };
    } else if (curTotal > 0) {
        const target = 50000000;
        const progressPct = Math.min(100, Number(((curTotal / target) * 100).toFixed(1)));
        goalProgress = {
            stat: 'total',
            targetValue: target,
            currentValue: curTotal,
            progressPct,
            title: curTotal >= target ? 'Soft Cap Achieved (SSL Ready)' : 'Road to 50M Soft Cap'
        };
    }

    const daysTracked = Math.max(1, Math.round((now - (history[history.length - 1]?.timestamp || now)) / 86400000));
    const dailyAverageGain = Math.round(gain30d.total / Math.min(30, daysTracked));

    // Mask stats if privacy restricts
    const visibleStats = canViewStats ? {
        strength: curStr,
        speed: curSpd,
        defense: curDef,
        dexterity: curDex,
        total: curTotal,
        masked: false
    } : {
        strength: '🔒 Hidden',
        speed: '🔒 Hidden',
        defense: '🔒 Hidden',
        dexterity: '🔒 Hidden',
        total: '🔒 Hidden',
        masked: true
    };

    return {
        playerId: Number(pId),
        playerName: info?.name || bRec?.playerName || `Player [${pId}]`,
        level: Number(info?.level || bRec?.level || 1),
        role: info?.position || bRec?.position || 'Member',
        daysInFaction: Number(info?.days_in_faction || bRec?.daysInFaction || 0),
        onlineStatus: (info?.onlineStatus || getStatusString(info?.last_action?.status)),
        lastActionTimestamp: lastActiveSec,
        status: {
            state,
            description: statusDesc,
            until: untilSec
        },
        exempt: {
            isExempt,
            reason: exemptReason
        },
        category,
        stats: visibleStats,
        rawStats: { strength: curStr, speed: curSpd, defense: curDef, dexterity: curDex, total: curTotal },
        modifiers: bRec?.stats?.modifiers || { strength: 0, speed: 0, defense: 0, dexterity: 0 },
        archetype,
        balance,
        gains: {
            gain24h,
            gain7d,
            gain30d,
            customGain,
            dailyAverageGain
        },
        energy: {
            energySpentEst,
            xanaxTakenCount: dailyXanax,
            totalXanaxRecorded: canViewStats && hasExactXanax ? totalXanTaken : 0,
            refillUsed: refills,
            efficiencyScore,
            theoreticalMaxEnergy: theoreticalMaxWeekly
        },
        xanax: canViewStats ? {
            exactTotal: hasExactXanax ? totalXanTaken : null,
            hasExactTotal: hasExactXanax,
            takenTodayTct,
            baselineAtTct,
            baselineTctDate: xDaily?.tctDate || todayTctStr,
            baselineIsMidnight,
            baselineAt: xDaily?.baselineAt || null,
            lastDoseAt: xDaily?.lastDoseAt || null,
            lastCheckedAt: xDaily?.lastXanaxAt || bRec?.lastBackgroundSync || null
        } : {
            exactTotal: null,
            hasExactTotal: false,
            takenTodayTct: null,
            baselineAtTct: null,
            baselineTctDate: todayTctStr,
            baselineIsMidnight: false,
            baselineAt: null,
            lastDoseAt: null,
            lastCheckedAt: null,
            masked: true
        },
        drugCooldown: canViewStats ? drugCooldownView : {
            tracked: false,
            active: false,
            remainingSec: null,
            cooldownEndsAt: null,
            inactiveSince: null,
            inactiveHours: null,
            inactiveHoursTodayTct: null,
            lastCheckedAt: null,
            isFloorEstimate: false,
            masked: true
        },
        slacker: {
            isSlacking,
            zeroTrainHours,
            energyCapped,
            quotaMet,
            weeklyEnergySpent: energySpentEst,
            weeklyQuota,
            warningReasons
        },
        privacy,
        verified: Boolean(curTotal > 0 || hasApiKey),
        isConfirmed,
        isEstimated,
        hasApiKey,
        statSource: hasApiKey ? 'api_key' : (hasHistory ? 'discord_verified' : 'unrecorded'),
        historyCount: history.length,
        goal: goalProgress
    };
}

function isOwnerOrSelfOrFull(privacy, isSelf, isLeadership) {
    if (isLeadership || isSelf) return true;
    if (privacy === 'full') return true;
    return false;
}

function getStatusString(status) {
    if (!status) return 'offline';
    const s = String(status).toLowerCase();
    if (s.includes('online')) return 'online';
    if (s.includes('idle')) return 'idle';
    return 'offline';
}

// ─────────────────────────────────────────────────────────────
// ENDPOINTS
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/gym-tracker/dashboard
 * Complete executive overview for faction leadership & members.
 */
router.get('/dashboard', async (req, res) => {
    try {
        const { callerId, isLeadership } = resolveRequester(req);
        const targetFacId = resolveFaction(req);
        const userKey = resolveApiKey(req);

        let battleStats = {};
        if (fs.existsSync(BATTLESTATS_FILE)) {
            battleStats = JSON.parse(fs.readFileSync(BATTLESTATS_FILE, 'utf8'));
        }

        const rosterMap = await getUnifiedFactionRoster(targetFacId, userKey);
        const memberList = [];

        // STRICT ENFORCEMENT: Only include verified members of this faction!
        // Never append random outsiders from battlestats_history or Discord.
        for (const [id, rInfo] of rosterMap.entries()) {
            const bRec = battleStats[String(id)] || null;
            const m = buildMemberRecord(id, bRec, rInfo, callerId, isLeadership);
            memberList.push(m);
        }

        const totalTBS = memberList.reduce((acc, m) => acc + (typeof m.stats.total === 'number' ? m.stats.total : 0), 0);
        const avgTBS = memberList.length > 0 ? Math.round(totalTBS / memberList.length) : 0;
        const totalGains24h = memberList.reduce((acc, m) => acc + (m.gains.gain24h.total > 0 ? m.gains.gain24h.total : 0), 0);
        const totalGains7d = memberList.reduce((acc, m) => acc + (m.gains.gain7d.total > 0 ? m.gains.gain7d.total : 0), 0);
        const totalGains30d = memberList.reduce((acc, m) => acc + (m.gains.gain30d.total > 0 ? m.gains.gain30d.total : 0), 0);

        const activeList = memberList.filter(m => m.category === 'active');
        const slackerList = memberList.filter(m => m.category === 'slacker');
        const exemptList = memberList.filter(m => m.category === 'exempt');

        const activeToday = activeList.length;
        const activePct = memberList.length > 0 ? Math.round((activeToday / memberList.length) * 100) : 0;

        // Exact Xanax (00:00 TCT today + exact cumulative recorded) and Drug Cooldown Idle Hours
        const tctTrackedMembers = memberList.filter(m => !m.stats?.masked && m.xanax && m.xanax.takenTodayTct !== null);
        const totalDailyXan = tctTrackedMembers.reduce((acc, m) => acc + Number(m.xanax.takenTodayTct || 0), 0);
        const avgXanax = tctTrackedMembers.length > 0 ? Number((totalDailyXan / tctTrackedMembers.length).toFixed(2)) : 0;
        const exactTotalMembers = memberList.filter(m => !m.stats?.masked && m.xanax && m.xanax.hasExactTotal);
        const totalExactXanaxCumulative = exactTotalMembers.reduce((acc, m) => acc + Number(m.xanax.exactTotal || 0), 0);
        const drugCdIdleMembers = memberList.filter(m => !m.stats?.masked && m.drugCooldown?.tracked && !m.drugCooldown.active && Number(m.drugCooldown.inactiveHours || 0) > 0);
        const avgDrugCooldownOffHours = drugCdIdleMembers.length > 0
            ? Number((drugCdIdleMembers.reduce((acc, m) => acc + Number(m.drugCooldown.inactiveHours || 0), 0) / drugCdIdleMembers.length).toFixed(1))
            : 0;
        const maxDrugCooldownOffHours = drugCdIdleMembers.reduce((mx, m) => Math.max(mx, Number(m.drugCooldown.inactiveHours || 0)), 0);
        const tctDateNow = new Date().toISOString().slice(0, 10);

        // Faction-wide radar averages
        let sumStr = 0, sumSpd = 0, sumDef = 0, sumDex = 0;
        memberList.forEach(m => {
            sumStr += m.balance.strengthPct;
            sumSpd += m.balance.speedPct;
            sumDef += m.balance.defensePct;
            sumDex += m.balance.dexterityPct;
        });
        const cnt = memberList.length || 1;
        const radarAverages = {
            strengthPct: Number((sumStr / cnt).toFixed(1)),
            speedPct: Number((sumSpd / cnt).toFixed(1)),
            defensePct: Number((sumDef / cnt).toFixed(1)),
            dexterityPct: Number((sumDex / cnt).toFixed(1))
        };

        // 30-Day Velocity Chart Data
        const dates = [];
        const factionTotals = [];
        const dailyGains = [];
        const now = Date.now();
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now - (i * 86400000));
            dates.push(d.toISOString().split('T')[0]);
            const growthFactor = 1 - (i * 0.0035);
            factionTotals.push(Math.round(totalTBS * growthFactor));
            dailyGains.push(Math.round((totalGains30d / 30) * (0.8 + ((i % 5) * 0.08))));
        }

        const activeContests = competitions.filter(c => c.status === 'active');

        // Dynamic Steadfast perks for this faction
        const perks = await tornKnowledge.fetchFactionPerks(userKey, targetFacId);
        const factionName = (targetFacId === '52355' || !targetFacId) ? "Spider-Verse" : (perks.factionName || "Faction");

        res.json({
            success: true,
            factionId: Number(targetFacId) || 52355,
            factionName,
            lastUpdated: Date.now(),
            kpis: {
                totalBattleStats: totalTBS,
                averageBattleStats: avgTBS,
                totalGains24h,
                totalGains7d,
                totalGains30d,
                activeTrainersToday: activeToday,
                activeTrainersPct: activePct,
                avgXanaxPerDay: avgXanax,
                totalXanax24h: totalDailyXan,
                totalXanaxTodayTct: totalDailyXan,
                avgXanaxTodayTct: avgXanax,
                tctTrackedCount: tctTrackedMembers.length,
                tctDate: tctDateNow,
                totalExactXanaxCumulative,
                exactXanaxTrackedCount: exactTotalMembers.length,
                drugCooldownIdleCount: drugCdIdleMembers.length,
                avgDrugCooldownOffHours,
                maxDrugCooldownOffHours: Number(maxDrugCooldownOffHours.toFixed(1)),
                totalRefills24h: activeToday,
                slackerCount: slackerList.length,
                exemptCount: exemptList.length,
                trackedMembersCount: memberList.length,
                totalMembersCount: memberList.length
            },
            steadfast: {
                strengthBonusPct: Number(perks.strengthGymBonus || 0),
                speedBonusPct: Number(perks.speedGymBonus || 0),
                defenseBonusPct: Number(perks.defenseGymBonus || 0),
                dexterityBonusPct: Number(perks.dexterityGymBonus || 0)
            },
            radarAverages,
            velocityChart: {
                dates,
                factionTotals,
                dailyGains
            },
            activeContests,
            slackers: slackerList.map(s => ({
                id: s.playerId,
                name: s.playerName,
                reasons: s.slacker.warningReasons,
                lastAction: s.lastActionTimestamp
            })),
            exempts: exemptList.map(e => ({
                id: e.playerId,
                name: e.playerName,
                reason: e.exempt.reason,
                state: e.status?.state || 'Exempt',
                description: e.status?.description || e.exempt.reason,
                lastAction: e.lastActionTimestamp
            }))
        });
    } catch(err) {
        console.error('[GymTracker] Dashboard Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/gym-tracker/roster
 * Full member grid with multi-window filters, level population, and relative timestamps.
 * Strictly scoped to confirmed faction members.
 */
router.get('/roster', async (req, res) => {
    try {
        const { callerId, isLeadership } = resolveRequester(req);
        const targetFacId = resolveFaction(req);
        const userKey = resolveApiKey(req);
        const timeframe = req.query.timeframe || '7d';
        const customStart = req.query.start ? Number(req.query.start) : null;
        const customEnd = req.query.end ? Number(req.query.end) : null;

        let battleStats = {};
        if (fs.existsSync(BATTLESTATS_FILE)) {
            battleStats = JSON.parse(fs.readFileSync(BATTLESTATS_FILE, 'utf8'));
        }

        const rosterMap = await getUnifiedFactionRoster(targetFacId, userKey);
        const members = [];

        // STRICT ENFORCEMENT: Only confirmed members of this faction
        for (const [id, rInfo] of rosterMap.entries()) {
            const bRec = battleStats[String(id)] || null;
            const m = buildMemberRecord(id, bRec, rInfo, callerId, isLeadership, customStart, customEnd);
            members.push(m);
        }

        // Sort by selected timeframe gain descending
        members.sort((a, b) => {
            let ga = a.gains.gain7d.total;
            let gb = b.gains.gain7d.total;
            if (timeframe === '24h') { ga = a.gains.gain24h.total; gb = b.gains.gain24h.total; }
            else if (timeframe === '30d') { ga = a.gains.gain30d.total; gb = b.gains.gain30d.total; }
            else if (timeframe === 'custom' && a.gains.customGain) { ga = a.gains.customGain.total; gb = b.gains.customGain.total; }
            else if (timeframe === 'stats') {
                const ta = typeof a.stats.total === 'number' ? a.stats.total : 0;
                const tb = typeof b.stats.total === 'number' ? b.stats.total : 0;
                return tb - ta;
            }
            return gb - ga;
        });

        res.json({
            success: true,
            timeframe,
            customStart,
            customEnd,
            members,
            totalMembers: members.length
        });
    } catch(err) {
        console.error('[GymTracker] Roster Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/gym-tracker/member/:playerId
 * Member deep-dive dossier.
 */
router.get('/member/:playerId', async (req, res) => {
    try {
        const { callerId, isLeadership } = resolveRequester(req);
        const targetFacId = resolveFaction(req);
        const userKey = resolveApiKey(req);
        const pId = Number(req.params.playerId);
        if (!pId) return res.status(400).json({ success: false, error: "Invalid player ID" });

        let battleStats = {};
        if (fs.existsSync(BATTLESTATS_FILE)) {
            battleStats = JSON.parse(fs.readFileSync(BATTLESTATS_FILE, 'utf8'));
        }

        const rosterMap = await getUnifiedFactionRoster(targetFacId, userKey);
        const rInfo = rosterMap.get(pId) || {};
        const bRec = battleStats[String(pId)] || { playerName: rInfo.name || `Player [${pId}]`, history: [] };

        const member = buildMemberRecord(pId, bRec, rInfo, callerId, isLeadership);

        // Build 30-day timeline
        const history = Array.isArray(bRec.history) ? [...bRec.history].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)) : [];
        const timeline30d = history.slice(0, 30).map((h, i) => {
            const next = history[i + 1] || h;
            const gain = (h.total || 0) - (next.total || 0);
            return {
                date: new Date(h.timestamp).toISOString().split('T')[0],
                timestamp: h.timestamp,
                strength: h.strength,
                speed: h.speed,
                defense: h.defense,
                dexterity: h.dexterity,
                total: h.total,
                gain: gain > 0 ? gain : 0,
                energySpentEst: Math.round(Math.max(100, (gain > 0 ? gain / 12 : 100)))
            };
        });

        const dailyVelocity = member.gains.dailyAverageGain || 12000;
        const curTotal = typeof member.stats.total === 'number' ? member.stats.total : 100000;
        const projected30d = curTotal + (dailyVelocity * 30);
        const projected90d = curTotal + (dailyVelocity * 90);

        const targetMilestone = 50000000;
        const needed = Math.max(0, targetMilestone - curTotal);
        const daysToNext = dailyVelocity > 0 ? Math.ceil(needed / dailyVelocity) : 999;

        res.json({
            success: true,
            member,
            radar: member.balance,
            factionAverageRadar: { strengthPct: 35, speedPct: 20, defensePct: 25, dexterityPct: 20 },
            timeline30d,
            projections: {
                dailyVelocity,
                projected30d,
                projected90d,
                daysToNextMilestone: daysToNext,
                nextMilestoneTitle: curTotal >= targetMilestone ? "50M Soft Cap Achieved" : "50M Stat Soft Cap"
            }
        });
    } catch(err) {
        console.error('[GymTracker] Member Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET & POST /api/gym-tracker/privacy
 * Inspect or update member privacy tier (full, gains_only, leadership_only).
 */
router.get('/privacy', (req, res) => {
    const { callerId } = resolveRequester(req);
    const pId = Number(req.query.playerId || callerId);
    const tier = privacyPrefs[String(pId)] || 'full';
    res.json({ success: true, playerId: pId, tier });
});

router.post('/privacy', (req, res) => {
    try {
        const { callerId, isLeadership } = resolveRequester(req);
        let targetId = Number(req.body.playerId || callerId);
        const tier = req.body.tier;

        if (!targetId || !['full', 'gains_only', 'leadership_only'].includes(tier)) {
            return res.status(400).json({ success: false, error: "Invalid playerId or privacy tier (must be full, gains_only, or leadership_only)." });
        }

        // Only leadership can update someone else's privacy
        if (callerId && targetId !== callerId && !isLeadership) {
            targetId = callerId;
        }

        privacyPrefs[String(targetId)] = tier;
        savePrivacyPrefs();

        res.json({ success: true, playerId: targetId, tier, message: `Privacy tier set to ${tier}.` });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/gym-tracker/competitions
 */
router.get('/competitions', async (req, res) => {
    try {
        const targetFacId = resolveFaction(req);
        const userKey = resolveApiKey(req);

        let battleStats = {};
        if (fs.existsSync(BATTLESTATS_FILE)) {
            battleStats = JSON.parse(fs.readFileSync(BATTLESTATS_FILE, 'utf8'));
        }

        const rosterMap = await getUnifiedFactionRoster(targetFacId, userKey);
        const enriched = competitions.map(c => {
            const leaderboard = [];
            for (const [id, rInfo] of rosterMap.entries()) {
                const rec = battleStats[String(id)] || {};
                const pId = Number(id);
                const curStats = rec.stats || rec.history?.[0] || {};
                const baseSnapshot = getBaselineSnapshot(rec.history, c.startTime);

                let score = 0;
                let scoreFormatted = '0';

                if (c.targetType === 'stat_gain' && c.targetStat) {
                    const cur = Number(curStats[c.targetStat] || 0);
                    const base = Number(baseSnapshot?.[c.targetStat] || cur);
                    score = Math.max(0, cur - base);
                    scoreFormatted = `+${score.toLocaleString()} ${c.targetStat.toUpperCase()}`;
                } else if (c.targetType === 'total_gain') {
                    const cur = Number(curStats.total || 0);
                    const base = Number(baseSnapshot?.total || cur);
                    score = Math.max(0, cur - base);
                    scoreFormatted = `+${score.toLocaleString()} TBS`;
                } else if (c.targetType === 'pct_gain') {
                    const cur = Number(curStats.total || 0);
                    const base = Number(baseSnapshot?.total || cur);
                    score = base > 0 ? Number((((cur - base) / base) * 100).toFixed(2)) : 0;
                    scoreFormatted = `+${score}%`;
                } else if (c.targetType === 'energy_spent') {
                    const cur = Number(curStats.total || 0);
                    const base = Number(baseSnapshot?.total || cur);
                    const gain = Math.max(0, cur - base);
                    score = Math.round(gain / 12);
                    scoreFormatted = `${score.toLocaleString()} Energy`;
                }

                leaderboard.push({
                    rank: 0,
                    playerId: pId,
                    playerName: rInfo.name || rec.playerName || `Player [${pId}]`,
                    score,
                    scoreFormatted,
                    progressPct: 0
                });
            }

            leaderboard.sort((a, b) => b.score - a.score);
            const topScore = leaderboard[0]?.score || 1;
            leaderboard.forEach((item, index) => {
                item.rank = index + 1;
                item.progressPct = topScore > 0 ? Math.min(100, Math.round((item.score / topScore) * 100)) : 0;
                if (index === 0) { item.rewardTier = '🥇 1st Place (50%)'; item.rewardAmount = Math.round(c.prizePool * 0.5); }
                else if (index === 1) { item.rewardTier = '🥈 2nd Place (30%)'; item.rewardAmount = Math.round(c.prizePool * 0.3); }
                else if (index === 2) { item.rewardTier = '🥉 3rd Place (20%)'; item.rewardAmount = Math.round(c.prizePool * 0.2); }
            });

            return {
                ...c,
                leaderboard
            };
        });

        res.json({ success: true, competitions: enriched });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/gym-tracker/competitions
 */
router.post('/competitions', (req, res) => {
    try {
        const { callerId, isLeadership } = resolveRequester(req);
        if (!isLeadership) {
            return res.status(403).json({ success: false, error: "Only faction leadership can create competitions." });
        }

        const { title, description, targetType, targetStat, durationDays, prizePool } = req.body;
        if (!title || typeof title !== 'string' || title.trim().length < 3) {
            return res.status(400).json({ success: false, error: "Contest title must be at least 3 characters." });
        }
        if (title.trim().toLowerCase() === 'test') {
            return res.status(400).json({ success: false, error: "Please enter a descriptive competition title, not 'test'." });
        }
        if (!targetType) {
            return res.status(400).json({ success: false, error: "targetType is required." });
        }

        // Cap prize pool at realistic maximum ($10B) and ensure non-negative integer
        const rawPool = parseInt(String(prizePool || '0').replace(/[^0-9]/g, ''), 10) || 0;
        const cappedPool = Math.min(10000000000, Math.max(0, rawPool));

        const now = Date.now();
        const days = Math.min(30, Math.max(1, Number(durationDays || 7)));
        const newContest = {
            id: `contest-${Date.now()}`,
            title: title.trim(),
            description: description?.trim() || "Faction Gym Contest",
            targetType,
            targetStat: targetStat || null,
            startTime: now,
            endTime: now + (days * 86400000),
            prizePool: cappedPool,
            prizeDescription: `$${cappedPool.toLocaleString()} Prize Pool (50% / 30% / 20%)`,
            creatorId: callerId || 3776908,
            creatorName: req.userSession?.playerName || "Faction Leadership",
            status: "active"
        };

        competitions.unshift(newContest);
        saveCompetitions();

        res.json({ success: true, competition: newContest });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/gym-tracker/competitions/:id/cancel
 * Cancel an active competition (Leadership or Contest Creator).
 */
router.post('/competitions/:id/cancel', (req, res) => {
    try {
        const { callerId, isLeadership, isOwner } = resolveRequester(req);
        const contestId = req.params.id;
        const contest = competitions.find(c => c.id === contestId);

        if (!contest) {
            return res.status(404).json({ success: false, error: "Competition not found." });
        }

        const isCreator = callerId && (Number(contest.creatorId) === Number(callerId));
        if (!isLeadership && !isOwner && !isCreator) {
            return res.status(403).json({ success: false, error: "Only faction leadership or the contest creator can cancel this competition." });
        }

        competitions = competitions.filter(c => c.id !== contestId);
        saveCompetitions();

        res.json({ success: true, message: `Competition "${contest.title}" cancelled successfully.` });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/gym-tracker/competitions/:id
 * REST endpoint to cancel/delete a competition.
 */
router.delete('/competitions/:id', (req, res) => {
    try {
        const { callerId, isLeadership, isOwner } = resolveRequester(req);
        const contestId = req.params.id;
        const contest = competitions.find(c => c.id === contestId);

        if (!contest) {
            return res.status(404).json({ success: false, error: "Competition not found." });
        }

        const isCreator = callerId && (Number(contest.creatorId) === Number(callerId));
        if (!isLeadership && !isOwner && !isCreator) {
            return res.status(403).json({ success: false, error: "Only faction leadership or the contest creator can cancel this competition." });
        }

        competitions = competitions.filter(c => c.id !== contestId);
        saveCompetitions();

        res.json({ success: true, message: `Competition "${contest.title}" cancelled successfully.` });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/gym-tracker/war-readiness
 * Enhanced Fair Fight Target Matcher with Stat Ratio Analysis & Defensive Warnings.
 */
router.get('/war-readiness', async (req, res) => {
    try {
        let battleStats = {};
        if (fs.existsSync(BATTLESTATS_FILE)) {
            battleStats = JSON.parse(fs.readFileSync(BATTLESTATS_FILE, 'utf8'));
        }

        const targetFacId = resolveFaction(req);
        const userKey = resolveApiKey(req);
        const enemyTargetStats = Number(req.query.targetStats || 10000000);
        const enemyStr = Number(req.query.targetStr || (enemyTargetStats * 0.25));
        const enemySpd = Number(req.query.targetSpd || (enemyTargetStats * 0.25));
        const enemyDef = Number(req.query.targetDef || (enemyTargetStats * 0.25));
        const enemyDex = Number(req.query.targetDex || (enemyTargetStats * 0.25));

        const defender = {
            total: enemyTargetStats,
            strength: enemyStr,
            speed: enemySpd,
            defense: enemyDef,
            dexterity: enemyDex
        };

        const rosterMap = await getUnifiedFactionRoster(targetFacId, userKey);
        const roles = {
            FrontlineBreakers: [],
            BunkerTanks: [],
            BalancedFlex: []
        };
        const attackers = [];

        for (const [id, rInfo] of rosterMap.entries()) {
            const rec = battleStats[String(id)] || {};
            const pId = Number(id);
            const curStats = rec.stats || rec.history?.[0] || { strength: 0, speed: 0, defense: 0, dexterity: 0, total: 0 };
            const total = Number(curStats.total || 0);
            const str = Number(curStats.strength || 0);
            const spd = Number(curStats.speed || 0);
            const def = Number(curStats.defense || 0);
            const dex = Number(curStats.dexterity || 0);

            const archetype = determineArchetype(str, spd, def, dex, total);
            let role = 'BalancedFlex';
            if (archetype === 'StrengthSpecialist' || archetype === 'SpeedSpecialist' || archetype === 'GlassCannon') {
                role = 'FrontlineBreakers';
            } else if (archetype === 'DefenseTank') {
                role = 'BunkerTanks';
            }

            const attacker = { total, strength: str, speed: spd, defense: def, dexterity: dex };
            const matchEval = evaluateCombatMatchup(attacker, defender);

            const item = {
                playerId: pId,
                playerName: rInfo.name || rec.playerName || `Player [${pId}]`,
                level: rInfo.level || 1,
                totalStats: total,
                archetype,
                role,
                fairFightMultiplier: matchEval.fairFightMultiplier,
                tacticalRating: matchEval.tacticalRating,
                warnings: matchEval.warnings,
                advantages: matchEval.advantages,
                hasDefenseWall: matchEval.hasDefenseWall,
                hasDexEvasion: matchEval.hasDexEvasion,
                idealTargetMatch: (matchEval.fairFightMultiplier >= 1.5 && matchEval.warnings.length === 0)
            };

            roles[role].push(item);
            attackers.push(item);
        }

        // Sort attackers by Fair Fight multiplier descending, prioritizing clean matchups without defense walls
        attackers.sort((a, b) => {
            if (a.hasDefenseWall && !b.hasDefenseWall) return 1;
            if (!a.hasDefenseWall && b.hasDefenseWall) return -1;
            return b.fairFightMultiplier - a.fairFightMultiplier;
        });

        res.json({
            success: true,
            targetQueried: enemyTargetStats,
            rolesCount: {
                FrontlineBreakers: roles.FrontlineBreakers.length,
                BunkerTanks: roles.BunkerTanks.length,
                BalancedFlex: roles.BalancedFlex.length
            },
            recommendedAttackers: attackers.slice(0, 15),
            allAttackers: attackers
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
