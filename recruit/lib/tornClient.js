'use strict';
const { getKeyWait, markKeyError } = require('./apiKeyPool');

const TORN_BASE = 'https://api.torn.com';

/**
 * Fetch a player's profile from the Torn API.
 * Uses the shared API key pool.
 * 
 * @param {number} playerId
 * @returns {object|null} Torn user profile, or null if not found / deleted
 */
async function fetchPlayer(playerId) {
    const key = await getKeyWait(15_000);
    if (!key) throw new Error('No API key available in pool');

    const url = `${TORN_BASE}/user/${playerId}?selections=profile,personalstats&key=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();

    if (data.error) {
        const msg = data.error.error || 'Unknown error';
        // Code 6 = ID not found (deleted/never existed) — not a key error
        if (data.error.code === 6) return null;
        // Code 2 = incorrect key — remove it from pool
        if (data.error.code === 2) markKeyError(key, 'Incorrect Key');
        throw new Error(`Torn API error [${data.error.code}]: ${msg}`);
    }

    return data;
}

/**
 * Fetch a faction's basic info + member list.
 * Uses a specific key (not the pool — called during registration).
 */
async function fetchFaction(factionId, apiKey) {
    const url = `${TORN_BASE}/faction/${factionId}?selections=basic&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (data.error) throw new Error(`Torn API error: ${data.error.error}`);
    return data;
}

/**
 * Verify an API key and return the user's profile + faction ID.
 * Used during registration.
 */
async function verifyKey(apiKey) {
    const url = `${TORN_BASE}/user/?selections=profile&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (data.error) throw new Error(`Invalid API key: ${data.error.error}`);
    return data;
}

/**
 * Parse a raw Torn user object into our Player schema shape.
 */
function parsePlayer(id, raw) {
    const factionId = raw.faction?.faction_id || 0;
    const lastActionTs = raw.last_action?.timestamp
        ? new Date(raw.last_action.timestamp * 1000)
        : null;

    const hoursSinceLast = lastActionTs
        ? (Date.now() - lastActionTs.getTime()) / 3_600_000
        : 9999;

    const nextRefreshAt = calcNextRefresh(factionId, hoursSinceLast);

    return {
        _id: id,
        name: raw.name || '',
        level: raw.level || 0,
        factionId,
        factionName: raw.faction?.faction_name || '',
        status: raw.status?.state || 'Okay',
        lastActionTs,
        lastActionRelative: raw.last_action?.relative || '',
        networth: raw.personalstats?.networth || 0,
        rank: raw.rank || '',
        awards: raw.awards || 0,
        donator: raw.donator === 1,
        daysInTorn: raw.age || 0,
        gender: raw.gender || '',
        life: raw.life?.current || 0,
        refreshedAt: new Date(),
        nextRefreshAt,
    };
}

/**
 * Determine when to next refresh this player based on their current state.
 */
function calcNextRefresh(factionId, hoursSinceLastAction) {
    const now = Date.now();

    if (factionId === 0) {
        // Factionless — keep very fresh
        if (hoursSinceLastAction < 1) return new Date(now + 20 * 60_000);      // 20 min
        if (hoursSinceLastAction < 12) return new Date(now + 60 * 60_000);     // 1 hour
        if (hoursSinceLastAction < 48) return new Date(now + 4 * 3_600_000);   // 4 hours
        return new Date(now + 24 * 3_600_000);                                   // 1 day
    } else {
        // In a faction — less urgent
        if (hoursSinceLastAction < 24) return new Date(now + 24 * 3_600_000);  // 24 hours
        if (hoursSinceLastAction < 168) return new Date(now + 3 * 86_400_000); // 3 days
        return new Date(now + 7 * 86_400_000);                                   // 1 week
    }
}

module.exports = { fetchPlayer, fetchFaction, verifyKey, parsePlayer, calcNextRefresh };
