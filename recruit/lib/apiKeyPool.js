'use strict';

/**
 * API Key Pool
 * 
 * Manages a shared pool of Torn API keys contributed by registered factions.
 * Handles round-robin selection and per-key rate limiting (100 req/min = ~1.67/s).
 * 
 * All keys are stored in plaintext in memory only — they are NEVER logged,
 * never written to disk in plaintext, and never returned to the client.
 */

// pool: [{ key, factionId, tornUserId, calls: [], lastError: null }]
const pool = [];

// How many calls allowed per minute per key
const RATE_LIMIT = 100;
const WINDOW_MS = 60_000;

let roundRobinIndex = 0;

/**
 * Add a key to the pool. Does nothing if the key is already present.
 */
function addKey(apiKey, factionId, tornUserId) {
    const exists = pool.some(k => k.key === apiKey);
    if (!exists) {
        pool.push({ key: apiKey, factionId, tornUserId, calls: [], lastError: null });
        console.log(`[KeyPool] Added key for faction ${factionId}. Pool size: ${pool.length}`);
    }
}

/**
 * Remove a key from the pool (e.g. if it becomes invalid).
 */
function removeKey(apiKey) {
    const idx = pool.findIndex(k => k.key === apiKey);
    if (idx !== -1) pool.splice(idx, 1);
}

/**
 * Get the next available API key, respecting rate limits.
 * Returns null if no key is available right now.
 */
function getKey() {
    if (pool.length === 0) return null;

    const now = Date.now();

    // Try each key in round-robin order
    for (let i = 0; i < pool.length; i++) {
        const idx = (roundRobinIndex + i) % pool.length;
        const entry = pool[idx];

        // Purge calls older than 1 minute
        entry.calls = entry.calls.filter(t => now - t < WINDOW_MS);

        if (entry.calls.length < RATE_LIMIT) {
            entry.calls.push(now);
            roundRobinIndex = (idx + 1) % pool.length;
            return entry.key;
        }
    }

    return null; // All keys are rate-limited right now
}

/**
 * Wait until a key is available, polling up to maxWaitMs.
 */
async function getKeyWait(maxWaitMs = 10_000) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        const key = getKey();
        if (key) return key;
        await new Promise(r => setTimeout(r, 200));
    }
    return null;
}

function poolSize() { return pool.length; }

function poolStats() {
    const now = Date.now();
    return pool.map(e => ({
        factionId: e.factionId,
        callsLastMinute: e.calls.filter(t => now - t < WINDOW_MS).length,
        lastError: e.lastError,
    }));
}

/**
 * Mark a key as errored (e.g. Torn returned error code 2 = incorrect key).
 * Automatically removes it from the pool after too many errors.
 */
function markKeyError(apiKey, error) {
    const entry = pool.find(k => k.key === apiKey);
    if (entry) {
        entry.lastError = error;
        if (error === 'Incorrect Key') removeKey(apiKey);
    }
}

module.exports = { addKey, removeKey, getKey, getKeyWait, poolSize, poolStats, markKeyError };
