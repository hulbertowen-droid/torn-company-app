'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { connectDB } = require('../db/mongo');
const Player = require('../db/models/Player');
const { fetchPlayer, parsePlayer } = require('../lib/tornClient');
const { poolSize } = require('../lib/apiKeyPool');
const mongoose = require('mongoose');

const CONFIG_COL = 'seeder_config';

// How long to wait between each API call (milliseconds).
// 700ms = ~85 calls/min, safely under 100/min limit with 1 key.
// With 2 keys: can reduce to 350ms, etc.
const MS_PER_CALL = 700;

// Start scanning at recent Torn IDs — active new players are here
// Old IDs (1-2M) = 2004-2017 accounts, mostly inactive/dead
const DEFAULT_START_ID = 3_500_000;
const MAX_TORN_ID = 5_500_000;

let broadcastFn = null;
function setBroadcast(fn) { broadcastFn = fn; }

async function getWatermark() {
    const db = mongoose.connection.db;
    const doc = await db.collection(CONFIG_COL).findOne({ _id: 'watermark' });
    return doc?.value || DEFAULT_START_ID;
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
    console.log('[SeederWorker] Started — paced loop, 1 API call per 700ms');
    scanLoop();
}

/**
 * The main scan loop.
 * - Fetches one player ID at a time
 * - Waits MS_PER_CALL ms between each request
 * - Skips players that are in a faction AND inactive (not useful for recruiting)
 * - Wraps around from MAX_TORN_ID back to DEFAULT_START_ID
 */
async function scanLoop() {
    while (true) {
        // Pause if no API keys available
        if (poolSize() === 0) {
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        let currentId;
        try {
            currentId = await getWatermark();

            // Fetch the player
            let raw;
            try {
                raw = await fetchPlayer(currentId);
            } catch (err) {
                // API error — wait a bit longer and retry same ID
                const isRateLimit = err.message.includes('[5]') || err.message.includes('Too many');
                const delay = isRateLimit ? 2000 : 1000;
                await new Promise(r => setTimeout(r, delay));
                continue; // Don't advance watermark on error
            }

            if (raw !== null) {
                const parsed = parsePlayer(currentId, raw);
                const hoursSinceLast = parsed.lastActionTs
                    ? (Date.now() - parsed.lastActionTs.getTime()) / 3_600_000
                    : 9999;
                const daysSinceLast = hoursSinceLast / 24;
                const isRecruitableNow = parsed.factionId === 0 && parsed.status === 'Okay';
                const isActive = hoursSinceLast < 72;

                // Only store if: factionless OR recently active (last 30 days)
                // Skip in-faction + inactive — they're useless for recruiting
                if (isRecruitableNow || daysSinceLast < 30) {
                    const prev = await Player.findOneAndUpdate(
                        { _id: currentId },
                        { $set: parsed },
                        { upsert: true, returnDocument: 'before' }
                    ).lean();

                    // Broadcast live update if player just became recruitable
                    if (broadcastFn && isRecruitableNow && isActive) {
                        const wasRecruitable = prev && prev.factionId === 0 && prev.status === 'Okay';
                        if (!wasRecruitable) {
                            broadcastFn({ type: 'player_available', player: parsed });
                        }
                    }
                }
            }

            // Advance to next ID
            const nextId = currentId >= MAX_TORN_ID ? DEFAULT_START_ID : currentId + 1;
            await setWatermark(nextId);

            if (nextId === DEFAULT_START_ID) {
                console.log('[SeederWorker] Completed full scan cycle, restarting from', DEFAULT_START_ID);
            }

        } catch (err) {
            console.error('[SeederWorker] Loop error at ID', currentId, ':', err.message);
            await new Promise(r => setTimeout(r, 5000));
        }

        // Pace ourselves — wait between each API call
        await new Promise(r => setTimeout(r, MS_PER_CALL));
    }
}

module.exports = { startSeederWorker, setBroadcast };
