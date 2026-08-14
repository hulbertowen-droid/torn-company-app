'use strict';

/**
 * API Key Pool
 * 
 * Manages a shared pool of Torn API keys contributed by registered factions.
 * Handles round-robin selection and per-key rate limiting (100 req/min = ~1.67/s).
 * 
 * Keys are stored in memory only for runtime use. They are reloaded from DB on restart.
 * Keys are NEVER logged, never returned to clients, never exposed in error messages.
 */

// pool entry: { key, factionId, tornUserId, tokens, lastRefill }
const pool = [];

// Token bucket settings — Torn allows 100 calls/min per key
const MAX_TOKENS = 100;
const REFILL_INTERVAL_MS = 60_000; // 1 minute
const TOKENS_PER_REFILL = 100;

let roundRobinIndex = 0;

function makeEntry(apiKey, factionId, tornUserId) {
    return {
        key: apiKey,
        factionId,
        tornUserId,
        tokens: MAX_TOKENS,  // Start full
        lastRefill: Date.now(),
        lastError: null,
        callsThisMinute: 0,
    };
}

function refillTokens(entry) {
    const now = Date.now();
    const elapsed = now - entry.lastRefill;
    if (elapsed >= 600) {
        const newTokens = Math.floor(elapsed / 600); // 100 tokens per 60s = 1 token per 600ms
        entry.tokens = Math.min(MAX_TOKENS, entry.tokens + newTokens);
        entry.lastRefill = now;
    }
}

/**
 * Add a key to the pool. Does nothing if the key is already present.
 */
function addKey(apiKey, factionId, tornUserId) {
    if (!apiKey) return;
    const exists = pool.some(k => k.key === apiKey);
    if (!exists) {
        pool.push(makeEntry(apiKey, factionId, tornUserId));
        console.log(`[KeyPool] Added key for faction ${factionId}. Pool size: ${pool.length}`);
    }
}

/**
 * Remove a key from the pool (e.g. if it becomes invalid).
 */
function removeKey(apiKey) {
    const idx = pool.findIndex(k => k.key === apiKey);
    if (idx !== -1) {
        console.log(`[KeyPool] Removed invalid key for faction ${pool[idx].factionId}`);
        pool.splice(idx, 1);
    }
}

/**
 * Get the next available API key, respecting rate limits (token bucket).
 * Returns null if no key has tokens available right now.
 */
function getKey() {
    if (pool.length === 0) return null;

    // Try each key in round-robin order
    for (let i = 0; i < pool.length; i++) {
        const idx = (roundRobinIndex + i) % pool.length;
        const entry = pool[idx];

        refillTokens(entry);

        if (entry.tokens > 0) {
            entry.tokens--;
            entry.callsThisMinute++;
            roundRobinIndex = (idx + 1) % pool.length;
            return entry.key;
        }
    }

    return null; // All keys are exhausted right now
}

/**
 * Wait until a key is available, polling up to maxWaitMs.
 * Uses exponential backoff to avoid busy-looping.
 */
async function getKeyWait(maxWaitMs = 15_000) {
    const deadline = Date.now() + maxWaitMs;
    let delay = 100;

    while (Date.now() < deadline) {
        const key = getKey();
        if (key) return key;
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 1.5, 2000); // back off up to 2s
    }
    return null;
}

function poolSize() { return pool.length; }

function poolStats() {
    return pool.map(e => {
        refillTokens(e);
        return {
            factionId: e.factionId,
            tokensRemaining: e.tokens,
            callsThisMinute: e.callsThisMinute,
            lastError: e.lastError,
        };
    });
}

/**
 * Mark a key as errored (e.g. Torn returned error code 2 = incorrect key).
 * Automatically removes it from the pool if it's invalid.
 */
function markKeyError(apiKey, error) {
    const entry = pool.find(k => k.key === apiKey);
    if (entry) {
        entry.lastError = error;
        if (error === 'Incorrect Key') removeKey(apiKey);
    }
}

module.exports = { addKey, removeKey, getKey, getKeyWait, poolSize, poolStats, markKeyError };
