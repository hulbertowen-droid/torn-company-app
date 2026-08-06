'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { connectDB } = require('../db/mongo');
const Player = require('../db/models/Player');
const { scheduleRefresh, scheduleSeedBatch, getPlayerSeedQueue } = require('../queues/playerQueue');
const mongoose = require('mongoose');

const CONFIG_COL = 'seeder_config';
const BATCH_SIZE = 100; // IDs per seed batch
const MAX_TORN_ID = 5_000_000; // Torn IDs go up to roughly this range

async function getWatermark() {
    const db = mongoose.connection.db;
    const doc = await db.collection(CONFIG_COL).findOne({ _id: 'watermark' });
    return doc?.value || 1;
}

async function setWatermark(value) {
    const db = mongoose.connection.db;
    await db.collection(CONFIG_COL).updateOne(
        { _id: 'watermark' },
        { $set: { value } },
        { upsert: true }
    );
}

async function startSeederWorker() {
    await connectDB();

    const queue = getPlayerSeedQueue();

    queue.process(1, async (job) => {
        const { startId, endId } = job.data;

        // Find which IDs in this range we DON'T already have in the DB
        const existing = await Player.find(
            { _id: { $gte: startId, $lte: endId } },
            { _id: 1 }
        ).lean();
        const existingSet = new Set(existing.map(p => p._id));

        for (let id = startId; id <= endId; id++) {
            if (!existingSet.has(id)) {
                // Schedule an immediate refresh for this new ID
                await scheduleRefresh(id, 0);
            }
        }

        // Update watermark
        await setWatermark(endId + 1);
    });

    queue.on('failed', (job, err) => {
        console.error(`[SeederWorker] Batch failed:`, err.message);
    });

    console.log('[SeederWorker] Started');

    // Kick off continuous seeding loop
    seedLoop();
}

/**
 * Continuously schedule seed batches, advancing the watermark forward.
 * When we reach MAX_TORN_ID, wrap back to 1 (re-verify old players).
 */
async function seedLoop() {
    while (true) {
        try {
            const watermark = await getWatermark();
            const startId = watermark;
            const endId = Math.min(startId + BATCH_SIZE - 1, MAX_TORN_ID);
            
            await scheduleSeedBatch(startId, endId);

            // Wait for the batch to likely be processed before scheduling next
            // This keeps us from flooding the queue with millions of batch jobs
            await new Promise(r => setTimeout(r, 5000));

            if (endId >= MAX_TORN_ID) {
                console.log('[SeederWorker] Reached max ID, restarting from 1');
                await setWatermark(1);
            }
        } catch (e) {
            console.error('[SeederWorker] Loop error:', e.message);
            await new Promise(r => setTimeout(r, 10_000));
        }
    }
}

module.exports = { startSeederWorker };
