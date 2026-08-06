'use strict';
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

let connection;
let playerRefreshQueue;
let playerSeedQueue;

function getConnection() {
    if (!connection) {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
        connection.on('connect', () => console.log('[Redis] Connected'));
        connection.on('error', (e) => console.error('[Redis] Error:', e.message));
    }
    return connection;
}

function getPlayerRefreshQueue() {
    if (!playerRefreshQueue) {
        playerRefreshQueue = new Queue('player-refresh', {
            connection: getConnection(),
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 50 },
            },
        });
    }
    return playerRefreshQueue;
}

function getPlayerSeedQueue() {
    if (!playerSeedQueue) {
        playerSeedQueue = new Queue('player-seed', {
            connection: getConnection(),
            defaultJobOptions: {
                attempts: 2,
                backoff: { type: 'fixed', delay: 2000 },
                removeOnComplete: { count: 10 },
                removeOnFail: { count: 20 },
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
    await q.add('refresh', { playerId }, {
        delay: delayMs,
        jobId: `player-${playerId}`,  // Prevents duplicate jobs for same player
        deduplication: { id: `player-${playerId}` },
    });
}

/**
 * Schedule seeding a batch of new Torn IDs to discover.
 * @param {number} startId
 * @param {number} endId
 */
async function scheduleSeedBatch(startId, endId) {
    const q = getPlayerSeedQueue();
    await q.add('seed', { startId, endId }, {
        jobId: `seed-${startId}-${endId}`,
    });
}

module.exports = {
    getConnection,
    getPlayerRefreshQueue,
    getPlayerSeedQueue,
    scheduleRefresh,
    scheduleSeedBatch,
};
