'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { connectDB } = require('../db/mongo');
const Player = require('../db/models/Player');
const WatchPool = require('../db/models/WatchPool');
const { fetchPlayer, parsePlayer } = require('../lib/tornClient');
const { poolSize } = require('../lib/apiKeyPool');
const mongoose = require('mongoose');

// Pacing — stay well under Torn's 100 req/min per key
// We share the rate limit with the refreshWorker, so use 1200ms (50/min)
// The refreshWorker uses the other ~35/min for re-refreshing known recruitables
const MS_PER_CALL = 1200;

let broadcastFn = null;
function setBroadcast(fn) { broadcastFn = fn; }

const CONFIG_COL = 'seeder_config';

async function startSeederWorker() {
    await connectDB();
    console.log('[WatchPool] Seeder started — monitoring known active players for recruitment opportunities');
    console.log('[GlobalScanner] Auto-scanner started — automatically scanning all Torn factions in background');
    watchLoop();
    globalFactionLoop();
}

/**
 * Core loop — pulls the highest-priority player from the WatchPool
 * and checks if they've gone factionless (recruitable).
 * 
 * Priority ordering:
 *   1. Players not checked in the last 4 hours (priority=0)
 *   2. Players not checked in the last 24 hours (priority=1)
 *   3. Players not checked in the last 7 days (priority=2+)
 */
async function watchLoop() {
    while (true) {
        // Pause if no API keys registered yet
        if (poolSize() === 0) {
            await new Promise(r => setTimeout(r, 10_000));
            continue;
        }

        let watched = null;
        try {
            // Pull the next player to check — prioritize those we haven't checked recently
            const cutoffs = [
                { priority: 0, since: new Date(Date.now() - 4 * 3_600_000) },
                { priority: 1, since: new Date(Date.now() - 24 * 3_600_000) },
                { priority: 2, since: new Date(Date.now() - 3 * 86_400_000) },
                { priority: 3, since: new Date(Date.now() - 7 * 86_400_000) },
            ];

            for (const { priority, since } of cutoffs) {
                watched = await WatchPool.findOneAndUpdate(
                    {
                        priority,
                        $or: [
                            { lastChecked: null },
                            { lastChecked: { $lt: since } },
                        ]
                    },
                    { $set: { lastChecked: new Date() }, $inc: { checkCount: 1 } },
                    { sort: { lastChecked: 1 }, returnDocument: 'before' }
                ).lean();
                if (watched) break;
            }

            if (!watched) {
                // Nothing to check right now — wait before trying again
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            const playerId = watched._id;

            // Fetch fresh data from Torn API
            let raw;
            try {
                raw = await fetchPlayer(playerId);
            } catch (err) {
                const isRateLimit = err.message.includes('[5]') || err.message.includes('Too many');
                await new Promise(r => setTimeout(r, isRateLimit ? 3000 : 1500));
                continue;
            }

            if (raw === null) {
                // Player deleted — remove from watch pool entirely
                await WatchPool.deleteOne({ _id: playerId });
                await Player.updateOne({ _id: playerId }, { $set: { status: 'Deleted', factionId: -1 } });
                continue;
            }

            const parsed = parsePlayer(playerId, raw);
            const hoursSinceLast = parsed.lastActionTs
                ? (Date.now() - parsed.lastActionTs.getTime()) / 3_600_000
                : 9999;
            
            // Automatically prune players who have been inactive for > 5 days (120 hours)
            if (hoursSinceLast > 120) {
                await WatchPool.deleteOne({ _id: playerId });
                await Player.deleteOne({ _id: playerId });
                continue;
            }

            const isRecruitableNow = parsed.factionId === 0 && parsed.status === 'Okay';
            const isActive = hoursSinceLast < 72;

            // Update player record
            const prev = await Player.findOneAndUpdate(
                { _id: playerId },
                { $set: parsed },
                { upsert: true, returnDocument: 'before' }
            ).lean();

            // Update watch pool priority based on what we found
            let newPriority;
            if (isRecruitableNow && isActive) {
                newPriority = 0; // Check frequently — they just went factionless!
            } else if (hoursSinceLast < 24) {
                newPriority = 1; // Very active — might leave soon
            } else if (hoursSinceLast < 168) {
                newPriority = 1; // Active in last week
            } else if (hoursSinceLast < 720) {
                newPriority = 2; // Somewhat active
            } else {
                newPriority = 3; // Mostly inactive — low priority
            }

            await WatchPool.updateOne({ _id: playerId }, { $set: { priority: newPriority } });

            // Broadcast live update if newly recruitable
            if (broadcastFn && isRecruitableNow && isActive) {
                const wasRecruitable = prev && prev.factionId === 0 && prev.status === 'Okay';
                if (!wasRecruitable) {
                    broadcastFn({ type: 'player_available', player: parsed });
                }
            } else if (broadcastFn && !isRecruitableNow) {
                const wasRecruitable = prev && prev.factionId === 0 && prev.status === 'Okay';
                if (wasRecruitable) {
                    broadcastFn({ type: 'player_gone', playerId });
                }
            }

        } catch (err) {
            console.error('[WatchPool] Loop error:', err.message);
            await new Promise(r => setTimeout(r, 5000));
        }

        // Pace API calls dynamically based on key pool size
        const keys = Math.max(1, poolSize());
        const delay = Math.max(800, 2000 / keys); 
        await new Promise(r => setTimeout(r, delay));
    }
}

/**
 * Global Faction Scanner — continuously sweeps through all Torn factions
 * in the background, adding their members to the WatchPool.
 * This runs slowly and automatically so the user never has to manually scan.
 */
async function globalFactionLoop() {
    const MAX_FACTION_ID = 55_000;
    const { getKeyWait } = require('../lib/apiKeyPool');
    const TORN_BASE = 'https://api.torn.com';

    while (true) {
        if (poolSize() === 0) {
            await new Promise(r => setTimeout(r, 15_000));
            continue;
        }

        try {
            // Get current watermark
            const doc = await mongoose.connection.db.collection(CONFIG_COL).findOne({ _id: 'global_faction' });
            let currentFid = doc?.value || 1;

            // Fetch faction data
            const key = await getKeyWait(5_000);
            if (key) {
                const res = await fetch(`${TORN_BASE}/faction/${currentFid}?selections=basic&key=${key}`, {
                    signal: AbortSignal.timeout(10_000),
                });
                const data = await res.json();

                if (!data?.error && data?.members) {
                    const memberIds = Object.keys(data.members).map(Number).filter(id => id > 0);
                    if (memberIds.length > 0) {
                        const ops = memberIds.map(id => ({
                            updateOne: {
                                filter: { _id: id },
                                update: {
                                    $setOnInsert: { _id: id, source: 'global_scan', sourceFactionId: currentFid, priority: 1, addedAt: new Date(), checkCount: 0 },
                                },
                                upsert: true,
                            }
                        }));
                        await WatchPool.bulkWrite(ops, { ordered: false });
                    }
                }
            }

            // Advance watermark
            const nextFid = currentFid >= MAX_FACTION_ID ? 1 : currentFid + 1;
            await mongoose.connection.db.collection(CONFIG_COL).updateOne(
                { _id: 'global_faction' },
                { $set: { value: nextFid } },
                { upsert: true }
            );

        } catch (err) {
            // Ignore fetch errors, just pause slightly longer
            await new Promise(r => setTimeout(r, 5000));
        }

        // Pace global scanner — keep it very slow so it doesn't drain keys
        // If 1 key: 1 call per 4 seconds (15/min limit usage)
        // If 2 keys: 1 call per 2 seconds, etc.
        const keys = Math.max(1, poolSize());
        const delay = Math.max(1500, 4000 / keys);
        await new Promise(r => setTimeout(r, delay));
    }
}

module.exports = { startSeederWorker, setBroadcast };
