'use strict';
const Queue = require('bull');

let playerRefreshQueue;
let playerSeedQueue;

function getRedisUrl() {
    return process.env.REDIS_URL || 'redis://localhost:6379';
}

function getPlayerRefreshQueue() {
    if (!playerRefreshQueue) {
        playerRefreshQueue = new Queue('player-refresh', getRedisUrl(), {
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: 100,
                removeOnFail: 50,
            },
        });
    }
    return playerRefreshQueue;
}

function getPlayerSeedQueue() {
    if (!playerSeedQueue) {
        playerSeedQueue = new Queue('player-seed', getRedisUrl(), {
            defaultJobOptions: {
                attempts: 2,
                backoff: { type: 'fixed', delay: 2000 },
                removeOnComplete: 10,
                removeOnFail: 20,
            },
        });
    }
    return playerSeedQueue;
}

/**
 * Schedule a player refresh job with a delay.
 * @param {number} playerId
 * @param {number} delayMs How long to wait before refreshing
 */
async function scheduleRefresh(playerId, delayMs = 0) {
    const q = getPlayerRefreshQueue();
    await q.add({ playerId }, {
        delay: delayMs,
        jobId: `player-${playerId}`,  // Prevents duplicate jobs for same player
    });
}

/**
 * Schedule seeding a batch of new Torn IDs to discover.
 * @param {number} startId
 * @param {number} endId
 */
async function scheduleSeedBatch(startId, endId) {
    const q = getPlayerSeedQueue();
    await q.add({ startId, endId }, {
        jobId: `seed-${startId}-${endId}`,
    });
}

module.exports = {
    getPlayerRefreshQueue,
    getPlayerSeedQueue,
    scheduleRefresh,
    scheduleSeedBatch,
};
