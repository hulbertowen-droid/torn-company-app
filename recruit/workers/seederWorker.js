'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Player = require('../db/models/Player');
const WatchPool = require('../db/models/WatchPool');
const { fetchPlayer, parsePlayer } = require('../lib/tornClient');
const { poolSize, getKeyWait } = require('../lib/apiKeyPool');
const mongoose = require('mongoose');

const TORN_BASE = 'https://api.torn.com';
const CONFIG_COL = 'seeder_config';

let broadcastFn = null;
function setBroadcast(fn) { broadcastFn = fn; }

async function startSeederWorker() {
    // DB connection is managed by the main app — no connectDB() needed here
    console.log('[WatchPool] Seeder started — monitoring known active players');
    console.log('[GlobalScanner] Auto-scanner started — scanning all Torn factions + detecting dying factions');
    console.log('[NewPlayerScanner] Rapid-progression scanner started — finding dedicated new players');
    console.log('[BountyBoard] Bounty board monitor started — checking every 30 minutes');
    watchLoop();
    globalFactionLoop();
    newPlayerLoop();
    bountyBoardLoop();
}

// ─────────────────────────────────────────────────────────────
// ENGINE 1: WatchPool Loop
// Checks known players for factionless status. Highest priority.
// ─────────────────────────────────────────────────────────────
async function watchLoop() {
    while (true) {
        if (poolSize() === 0) {
            await new Promise(r => setTimeout(r, 10_000));
            continue;
        }

        let watched = null;
        try {
            const cutoffs = [
                { priority: 0, since: new Date(Date.now() - 4 * 3_600_000) },
                { priority: 1, since: new Date(Date.now() - 24 * 3_600_000) },
                { priority: 2, since: new Date(Date.now() - 3 * 86_400_000) },
                { priority: 3, since: new Date(Date.now() - 7 * 86_400_000) },
            ];

            for (const { priority, since } of cutoffs) {
                watched = await WatchPool.findOneAndUpdate(
                    { priority, $or: [{ lastChecked: null }, { lastChecked: { $lt: since } }] },
                    { $set: { lastChecked: new Date() }, $inc: { checkCount: 1 } },
                    { sort: { lastChecked: 1 }, returnDocument: 'before' }
                ).lean();
                if (watched) break;
            }

            if (!watched) {
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            const playerId = watched._id;
            let raw;
            try {
                raw = await fetchPlayer(playerId);
            } catch (err) {
                const isRateLimit = err.message.includes('[5]') || err.message.includes('Too many');
                await new Promise(r => setTimeout(r, isRateLimit ? 4000 : 1500));
                continue;
            }

            if (raw === null) {
                await WatchPool.deleteOne({ _id: playerId });
                await Player.deleteOne({ _id: playerId });
                continue;
            }

            const parsed = parsePlayer(playerId, raw);
            const hoursSinceLast = parsed.lastActionTs
                ? (Date.now() - parsed.lastActionTs.getTime()) / 3_600_000
                : 9999;

            // Prune players inactive for > 5 days
            if (hoursSinceLast > 120) {
                await WatchPool.deleteOne({ _id: playerId });
                await Player.deleteOne({ _id: playerId });
                continue;
            }

            // Compute progression rate (levels per day) — free from existing data
            const progressionRate = parsed.daysInTorn > 0
                ? parseFloat((parsed.level / parsed.daysInTorn).toFixed(3))
                : 0;

            const isRecruitableNow = parsed.factionId === 0 && parsed.status === 'Okay';
            const isActive = hoursSinceLast < 72;

            const prev = await Player.findOneAndUpdate(
                { _id: playerId },
                { $set: { ...parsed, progressionRate } },
                { upsert: true, returnDocument: 'before' }
            ).lean();

            let newPriority;
            if (isRecruitableNow && isActive)        newPriority = 0;
            else if (hoursSinceLast < 24)             newPriority = 1;
            else if (hoursSinceLast < 168)            newPriority = 1;
            else if (hoursSinceLast < 720)            newPriority = 2;
            else                                      newPriority = 3;

            await WatchPool.updateOne({ _id: playerId }, { $set: { priority: newPriority } });

            if (broadcastFn && isRecruitableNow && isActive) {
                const wasRecruitable = prev && prev.factionId === 0 && prev.status === 'Okay';
                if (!wasRecruitable) broadcastFn({ type: 'player_available', player: { ...parsed, progressionRate } });
            } else if (broadcastFn && !isRecruitableNow) {
                const wasRecruitable = prev && prev.factionId === 0 && prev.status === 'Okay';
                if (wasRecruitable) broadcastFn({ type: 'player_gone', playerId });
            }

        } catch (err) {
            console.error('[WatchPool] Loop error:', err.message);
            await new Promise(r => setTimeout(r, 5000));
        }

        const keys = Math.max(1, poolSize());
        await new Promise(r => setTimeout(r, Math.max(800, 2000 / keys)));
    }
}

// ─────────────────────────────────────────────────────────────
// ENGINE 2: Global Faction Loop (Graveyard)
// Scans all factions, detects dying ones, prioritizes their members.
// ─────────────────────────────────────────────────────────────
async function globalFactionLoop() {
    const MAX_FACTION_ID = 55_000;

    while (true) {
        if (poolSize() === 0) {
            await new Promise(r => setTimeout(r, 15_000));
            continue;
        }

        let currentFid = 1;
        try {
            const doc = await mongoose.connection.db.collection(CONFIG_COL).findOne({ _id: 'global_faction' });
            currentFid = doc?.value || 1;
        } catch (err) {
            console.error('[GlobalScanner] Failed to read progress:', err.message);
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        try {
            const key = await getKeyWait(5_000);
            if (key) {
                const res = await fetch(`${TORN_BASE}/faction/${currentFid}?selections=basic&key=${key}`, {
                    signal: AbortSignal.timeout(10_000),
                });
                const data = await res.json();

                if (!data?.error && data?.members) {
                    const memberIds = Object.keys(data.members).map(Number).filter(id => id > 0);
                    const memberCount = memberIds.length;
                    const respect = data.respect || 0;

                    const isDying = respect < 10_000 || memberCount < 5;
                    const priority = isDying ? 0 : 1;

                    if (memberIds.length > 0) {
                        const ops = memberIds.map(id => ({
                            updateOne: {
                                filter: { _id: id },
                                update: {
                                    $setOnInsert: {
                                        _id: id,
                                        source: isDying ? 'graveyard' : 'global_scan',
                                        sourceFactionId: currentFid,
                                        priority,
                                        addedAt: new Date(),
                                        checkCount: 0,
                                    },
                                },
                                upsert: true,
                            }
                        }));
                        await WatchPool.bulkWrite(ops, { ordered: false });

                        if (isDying) {
                            await WatchPool.updateMany(
                                { _id: { $in: memberIds }, priority: { $gt: 0 } },
                                { $set: { priority: 0, source: 'graveyard' } }
                            );
                        }
                    }
                }
            }
        } catch (err) {
            // Log but don't retry — always advance cursor so we don't get stuck
            console.error(`[GlobalScanner] Error on faction ${currentFid}:`, err.message);
        }

        // Always advance cursor, even on error — never get stuck on one faction
        try {
            const nextFid = currentFid >= MAX_FACTION_ID ? 1 : currentFid + 1;
            await mongoose.connection.db.collection(CONFIG_COL).updateOne(
                { _id: 'global_faction' },
                { $set: { value: nextFid } },
                { upsert: true }
            );
        } catch (err) {
            console.error('[GlobalScanner] Failed to save progress:', err.message);
        }

        // Pace — uses leftover API budget
        const keys = Math.max(1, poolSize());
        await new Promise(r => setTimeout(r, Math.max(1000, 3000 / keys)));
    }
}

// ─────────────────────────────────────────────────────────────
// ENGINE 3: New Player Rapid Progression Scanner
// Scans recent signup IDs. Only saves players who are actively
// leveling fast — filters out 5-minute-old quitters.
// Progression Rate = level / daysInTorn. Minimum 1.0 to save.
// ─────────────────────────────────────────────────────────────
async function newPlayerLoop() {
    // Recent signup range — roughly 2 weeks to 3 months old accounts
    const SCAN_START = 3_100_000;
    const SCAN_END   = 3_400_000;
    const MIN_PROGRESSION_RATE = 1.0;  // Must average at least 1 level/day
    const MIN_AGE_DAYS = 3;            // Account must be at least 3 days old
    const MAX_INACTIVE_HOURS = 48;     // Must have been active in last 48 hours

    while (true) {
        if (poolSize() === 0) {
            await new Promise(r => setTimeout(r, 15_000));
            continue;
        }

        try {
            // Get/advance the new-player watermark
            const doc = await mongoose.connection.db.collection(CONFIG_COL).findOne({ _id: 'new_player_scan' });
            let currentId = doc?.value || SCAN_START;

            // Wrap around when we reach the end
            if (currentId > SCAN_END) currentId = SCAN_START;

            const raw = await fetchPlayer(currentId);

            if (raw !== null) {
                const daysInTorn = raw.age || 0;
                const level = raw.level || 1;
                const lastActionTs = raw.last_action?.timestamp
                    ? new Date(raw.last_action.timestamp * 1000)
                    : null;
                const hoursSinceLast = lastActionTs
                    ? (Date.now() - lastActionTs.getTime()) / 3_600_000
                    : 9999;
                const factionId = raw.faction?.faction_id || 0;
                const progressionRate = daysInTorn > 0
                    ? parseFloat((level / daysInTorn).toFixed(3))
                    : 0;

                // Apply the Rapid Progression Filter:
                // 1. Must be factionless
                // 2. Must be active within 48 hours
                // 3. Account must be at least 3 days old (not brand new)
                // 4. Must average at least 1 level per day (rapid progression)
                const passes =
                    factionId === 0 &&
                    hoursSinceLast < MAX_INACTIVE_HOURS &&
                    daysInTorn >= MIN_AGE_DAYS &&
                    progressionRate >= MIN_PROGRESSION_RATE;

                if (passes) {
                    const parsed = parsePlayer(currentId, raw);
                    parsed.progressionRate = progressionRate;

                    // Save to Player collection
                    await Player.findOneAndUpdate(
                        { _id: currentId },
                        { $set: { ...parsed, progressionRate } },
                        { upsert: true }
                    );

                    // Add to WatchPool at high priority — they are already factionless
                    await WatchPool.updateOne(
                        { _id: currentId },
                        {
                            $setOnInsert: {
                                _id: currentId,
                                source: 'new_player',
                                priority: 0,
                                addedAt: new Date(),
                                checkCount: 0,
                            }
                        },
                        { upsert: true }
                    );

                    if (broadcastFn) {
                        broadcastFn({ type: 'player_available', player: { ...parsed, progressionRate } });
                    }
                }
            }

            // Advance watermark
            await mongoose.connection.db.collection(CONFIG_COL).updateOne(
                { _id: 'new_player_scan' },
                { $set: { value: currentId + 1 } },
                { upsert: true }
            );

        } catch (err) {
            // Silently skip — rate limits or deleted IDs are expected
            const isRateLimit = err.message?.includes('[5]') || err.message?.includes('Too many');
            await new Promise(r => setTimeout(r, isRateLimit ? 5000 : 500));
        }

        // Slowest pace — uses whatever budget is left
        const keys = Math.max(1, poolSize());
        await new Promise(r => setTimeout(r, Math.max(2000, 6000 / keys)));
    }
}

// ─────────────────────────────────────────────────────────────
// ENGINE 4: Bounty Board Monitor
// Checks the live bounty board every 30 minutes.
// Everyone on the bounty board is confirmed currently active.
// ─────────────────────────────────────────────────────────────
async function bountyBoardLoop() {
    const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

    while (true) {
        if (poolSize() === 0) {
            await new Promise(r => setTimeout(r, 15_000));
            continue;
        }

        try {
            const key = await getKeyWait(5_000);
            if (!key) {
                await new Promise(r => setTimeout(r, INTERVAL_MS));
                continue;
            }

            const res = await fetch(`${TORN_BASE}/torn/?selections=bounties&key=${key}`, {
                signal: AbortSignal.timeout(10_000),
            });
            const data = await res.json();

            if (!data?.error && data?.bounties) {
                const bountyIds = Object.keys(data.bounties).map(Number).filter(id => id > 0);

                if (bountyIds.length > 0) {
                    // Add all bounty players to the WatchPool at priority 1
                    // The watchLoop will then check their faction status for free
                    const ops = bountyIds.map(id => ({
                        updateOne: {
                            filter: { _id: id },
                            update: {
                                $setOnInsert: {
                                    _id: id,
                                    source: 'bounty_board',
                                    priority: 1,
                                    addedAt: new Date(),
                                    checkCount: 0,
                                }
                            },
                            upsert: true,
                        }
                    }));
                    await WatchPool.bulkWrite(ops, { ordered: false });
                    console.log(`[BountyBoard] Added/refreshed ${bountyIds.length} players from bounty board`);
                }
            }
        } catch (err) {
            console.error('[BountyBoard] Error:', err.message);
        }

        await new Promise(r => setTimeout(r, INTERVAL_MS));
    }
}

module.exports = { startSeederWorker, setBroadcast };
