'use strict';
const express = require('express');
const router = express.Router();
const Player = require('../db/models/Player');
const Faction = require('../db/models/Faction');
const WatchPool = require('../db/models/WatchPool');
const { poolSize, poolStats, getKeyWait } = require('../lib/apiKeyPool');
const { getPlayerRefreshQueue, scheduleRefresh } = require('../queues/playerQueue');
const { fetchPlayer, parsePlayer } = require('../lib/tornClient');

const TORN_BASE = 'https://api.torn.com';

// Helper to make a Torn API call with the key pool
async function tornGet(path) {
    const key = await getKeyWait(15_000);
    if (!key) throw new Error('No API key available');
    const res = await fetch(`${TORN_BASE}${path}&key=${key}`, {
        signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    if (data?.error) throw new Error(`Torn API [${data.error.code}]: ${data.error.error}`);
    return data;
}

/**
 * GET /api/admin/status
 */
router.get('/status', async (req, res) => {
    try {
        const [totalPlayers, recruitable, factionCount, queueCounts, watchPoolSize] = await Promise.all([
            Player.estimatedDocumentCount(),
            Player.countDocuments({ factionId: 0, status: 'Okay' }),
            Faction.estimatedDocumentCount(),
            getPlayerRefreshQueue().getJobCounts(),
            WatchPool.estimatedDocumentCount(),
        ]);

        const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000);
        const freshRecruitables = await Player.countDocuments({
            factionId: 0, status: 'Okay',
            refreshedAt: { $gte: fourHoursAgo },
        });

        const doc = await require('mongoose').connection.db.collection('seeder_config').findOne({ _id: 'global_faction' });
        const globalScannerProgress = doc?.value || 1;

        return res.json({
            success: true,
            database: {
                totalPlayers,
                recruitable,
                watchPoolSize,
                globalScannerProgress,
                freshnessRate: recruitable > 0
                    ? `${Math.round((freshRecruitables / recruitable) * 100)}%`
                    : 'Building...',
                factions: factionCount,
            },
            queue: queueCounts,
            apiPool: { keyCount: poolSize(), keys: poolStats() },
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/queue-player
 */
router.post('/queue-player', async (req, res) => {
    try {
        const { playerId } = req.body;
        if (!playerId) return res.status(400).json({ error: 'playerId required' });
        await scheduleRefresh(parseInt(playerId), 0);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/watch-faction
 * 
 * Fetches a faction's member list and adds all members to the WatchPool.
 * These are REAL, ACTIVE players — when any of them go factionless, they'll
 * appear instantly in search results.
 * 
 * Body: { factionId: number }
 */
router.post('/watch-faction', async (req, res) => {
    try {
        if (poolSize() === 0) {
            return res.status(400).json({ error: 'Register your faction first to get an API key.' });
        }

        const { factionId } = req.body;
        if (!factionId) return res.status(400).json({ error: 'factionId required' });

        const data = await tornGet(`/faction/${factionId}?selections=basic`);
        const members = data?.members || {};
        const memberIds = Object.keys(members).map(Number).filter(Boolean);

        if (memberIds.length === 0) {
            return res.status(404).json({ error: 'Faction not found or has no members' });
        }

        // Bulk upsert into WatchPool
        const ops = memberIds.map(id => ({
            updateOne: {
                filter: { _id: id },
                update: {
                    $setOnInsert: { _id: id, source: 'faction_roster', sourceFactionId: parseInt(factionId), priority: 1, addedAt: new Date(), checkCount: 0 },
                },
                upsert: true,
            }
        }));

        const result = await WatchPool.bulkWrite(ops, { ordered: false });
        const factionName = data?.name || `Faction ${factionId}`;

        return res.json({
            success: true,
            factionName,
            memberCount: memberIds.length,
            newlyAdded: result.upsertedCount,
            message: `Watching ${memberIds.length} members from "${factionName}". ${result.upsertedCount} new players added to monitor pool.`,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/seed-from-wars
 * 
 * Pulls war/attack history from the registered faction's Torn API key and adds
 * all opponents to the WatchPool. These are GUARANTEED to be active players.
 * 
 * Uses Server-Sent Events to stream progress.
 */
router.post('/seed-from-wars', async (req, res) => {
    try {
        if (poolSize() === 0) {
            return res.status(400).json({ error: 'Register your faction first.' });
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const send = (msg) => { try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch(e){} };

        send({ type: 'start', message: 'Fetching your faction\'s war history from Torn...' });

        // Get faction info + news (which contains attack/war records)
        const factionData = await tornGet('/faction/?selections=basic,wars,rankedwars,attacks');
        
        const playerIds = new Set();

        // Extract from ranked wars
        const rankedWars = factionData?.rankedwars || {};
        for (const war of Object.values(rankedWars)) {
            const factions = war?.factions || {};
            for (const [fId, fInfo] of Object.entries(factions)) {
                const members = fInfo?.members || {};
                for (const id of Object.keys(members)) {
                    playerIds.add(parseInt(id));
                }
            }
        }

        // Extract from regular wars
        const wars = factionData?.wars || {};
        for (const war of Object.values(wars)) {
            const members = war?.enemy?.members || {};
            for (const id of Object.keys(members)) {
                playerIds.add(parseInt(id));
            }
        }

        // Extract from attack log (most valuable — guaranteed active)
        const attacks = factionData?.attacks || {};
        for (const attack of Object.values(attacks)) {
            if (attack?.defender_id) playerIds.add(attack.defender_id);
            if (attack?.attacker_id) playerIds.add(attack.attacker_id);
        }

        send({ type: 'progress', message: `Found ${playerIds.size} unique player IDs from war/attack history` });

        if (playerIds.size === 0) {
            send({ type: 'warn', message: 'No war/attack history found. Try manually adding faction IDs to watch.' });
            res.end();
            return;
        }

        // Bulk add to WatchPool with high priority (these are known active players)
        const ids = [...playerIds].filter(id => id > 0);
        const ops = ids.map(id => ({
            updateOne: {
                filter: { _id: id },
                update: {
                    $setOnInsert: { _id: id, source: 'war_history', priority: 1, addedAt: new Date(), checkCount: 0 },
                },
                upsert: true,
            }
        }));

        const result = await WatchPool.bulkWrite(ops, { ordered: false });

        send({
            type: 'complete',
            total: ids.length,
            newlyAdded: result.upsertedCount,
            message: `Added ${result.upsertedCount} new active players to your watch pool. The seeder will now monitor these specifically and alert you when any go factionless.`,
        });
        res.end();

    } catch (err) {
        console.error('[Admin] Seed from wars error:', err.message);
        if (!res.headersSent) return res.status(500).json({ error: err.message });
        try { res.end(); } catch(e) {}
    }
});

/**
 * POST /api/admin/seed-faction-range
 * 
 * Scans a range of faction IDs, fetches member lists, adds all to WatchPool.
 * Much more efficient than random ID scanning — every call gives us 10-100 known players.
 * 
 * Body: { startFactionId, endFactionId }
 * Uses SSE for progress.
 */
router.post('/seed-faction-range', async (req, res) => {
    try {
        if (poolSize() === 0) {
            return res.status(400).json({ error: 'Register your faction first.' });
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const send = (msg) => { try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch(e){} };

        const { startFactionId = 1, endFactionId = 500 } = req.body;
        const start = Math.max(1, parseInt(startFactionId));
        const end = Math.min(start + 999, parseInt(endFactionId)); // Max 1000 factions per scan

        send({ type: 'start', message: `Scanning factions ${start}–${end} for member lists...` });

        let totalPlayersAdded = 0;
        let factionsScanned = 0;
        let factionsFound = 0;

        for (let fId = start; fId <= end; fId++) {
            try {
                const data = await tornGet(`/faction/${fId}?selections=basic`);
                const members = data?.members || {};
                const memberIds = Object.keys(members).map(Number).filter(id => id > 0);

                if (memberIds.length > 0) {
                    factionsFound++;
                    const ops = memberIds.map(id => ({
                        updateOne: {
                            filter: { _id: id },
                            update: {
                                $setOnInsert: { _id: id, source: 'faction_roster', sourceFactionId: fId, priority: 1, addedAt: new Date(), checkCount: 0 },
                            },
                            upsert: true,
                        }
                    }));
                    const result = await WatchPool.bulkWrite(ops, { ordered: false });
                    totalPlayersAdded += result.upsertedCount;
                }
            } catch (err) {
                // Skip factions that don't exist or error
            }

            factionsScanned++;

            // Report progress every 10 factions
            if (factionsScanned % 10 === 0) {
                send({
                    type: 'progress',
                    factionsScanned,
                    total: end - start + 1,
                    factionsFound,
                    totalPlayersAdded,
                });
            }

            // Pace API calls — one faction = one API call
            await new Promise(r => setTimeout(r, 700));
        }

        send({
            type: 'complete',
            factionsScanned,
            factionsFound,
            totalPlayersAdded,
            message: `Scanned ${factionsScanned} factions, found ${factionsFound} active ones, added ${totalPlayersAdded} unique players to the watch pool.`,
        });
        res.end();

    } catch (err) {
        console.error('[Admin] Faction range scan error:', err.message);
        if (!res.headersSent) return res.status(500).json({ error: err.message });
        try { res.end(); } catch(e) {}
    }
});

/**
 * GET /api/admin/watchpool-stats
 * Returns WatchPool breakdown by priority/source.
 */
router.get('/watchpool-stats', async (req, res) => {
    try {
        const stats = await WatchPool.aggregate([
            { $group: { _id: '$priority', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]);
        const bySource = await WatchPool.aggregate([
            { $group: { _id: '$source', count: { $sum: 1 } } },
        ]);
        const total = await WatchPool.estimatedDocumentCount();
        return res.json({ success: true, total, byPriority: stats, bySource });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
