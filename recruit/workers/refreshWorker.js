'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { connectDB } = require('../db/mongo');
const Player = require('../db/models/Player');
const { fetchPlayer, parsePlayer } = require('../lib/tornClient');
const { scheduleRefresh, getPlayerRefreshQueue } = require('../queues/playerQueue');

// WebSocket broadcast — injected from server.js when running in-process
let broadcastFn = null;
function setBroadcast(fn) { broadcastFn = fn; }

async function startRefreshWorker() {
    await connectDB();

    const queue = getPlayerRefreshQueue();
    
    // Process jobs from Bull queue
    queue.process(8, async (job) => {
        const { playerId } = job.data;
        let raw;

        try {
            raw = await fetchPlayer(playerId);
        } catch (err) {
            // Rate limit / temp error — re-queue in 60s
            await scheduleRefresh(playerId, 60_000);
            throw err;
        }

        if (raw === null) {
            // Player doesn't exist — mark as gone, don't re-queue
            await Player.updateOne(
                { _id: playerId },
                { $set: { status: 'Deleted', factionId: -1, nextRefreshAt: new Date(Date.now() + 30 * 86_400_000) } }
            );
            return;
        }

        const parsed = parsePlayer(playerId, raw);
        const isRecruitableNow = parsed.factionId === 0 && parsed.status === 'Okay';
        const hoursSinceLast = parsed.lastActionTs
            ? (Date.now() - parsed.lastActionTs.getTime()) / 3_600_000
            : 9999;
        const isActive = hoursSinceLast < 72;

        // Upsert into players collection
        const prev = await Player.findOneAndUpdate(
            { _id: playerId },
            { $set: parsed },
            { upsert: true, new: false }
        ).lean();

        // Detect state changes for WebSocket broadcasts
        const wasRecruitable = prev && prev.factionId === 0 && prev.status === 'Okay';
        if (broadcastFn) {
            if (isRecruitableNow && isActive && !wasRecruitable) {
                // Player just became recruitable — broadcast to connected recruiters
                broadcastFn({ type: 'player_available', player: parsed });
            } else if (!isRecruitableNow && wasRecruitable) {
                // Player just became unavailable — tell clients to remove them
                broadcastFn({ type: 'player_gone', playerId });
            }
        }

        // Schedule the next refresh based on new state
        const delayMs = parsed.nextRefreshAt.getTime() - Date.now();
        await scheduleRefresh(playerId, Math.max(delayMs, 10_000));
    });

    queue.on('failed', (job, err) => {
        if (process.env.NODE_ENV !== 'production') {
            console.error(`[RefreshWorker] Job ${job?.id} failed:`, err.message);
        }
    });

    console.log('[RefreshWorker] Started (concurrency=8)');
}

module.exports = { startRefreshWorker, setBroadcast };
