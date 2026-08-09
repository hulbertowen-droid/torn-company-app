'use strict';
const express = require('express');
const router = express.Router();
const Player = require('../db/models/Player');
const Faction = require('../db/models/Faction');
const { poolSize, poolStats } = require('../lib/apiKeyPool');
const { getPlayerRefreshQueue, scheduleRefresh } = require('../queues/playerQueue');
const { fetchPlayer, parsePlayer } = require('../lib/tornClient');

/**
 * GET /api/admin/status
 * Returns platform health stats.
 */
router.get('/status', async (req, res) => {
    try {
        const [totalPlayers, recruitable, factionCount, queueCounts] = await Promise.all([
            Player.estimatedDocumentCount(),
            Player.countDocuments({ factionId: 0, status: 'Okay' }),
            Faction.estimatedDocumentCount(),
            getPlayerRefreshQueue().getJobCounts(),
        ]);

        // Freshness: how many recruitable players were refreshed in the last 4 hours
        const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000);
        const freshRecruitables = await Player.countDocuments({
            factionId: 0,
            status: 'Okay',
            refreshedAt: { $gte: fourHoursAgo },
        });

        return res.json({
            success: true,
            database: {
                totalPlayers,
                recruitable,
                freshnessRate: recruitable > 0
                    ? `${Math.round((freshRecruitables / recruitable) * 100)}%`
                    : 'Building...',
                factions: factionCount,
            },
            queue: queueCounts,
            apiPool: {
                keyCount: poolSize(),
                keys: poolStats(),
            },
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/queue-player
 * Manually queue a specific player ID for immediate refresh.
 * Body: { playerId: number }
 */
router.post('/queue-player', async (req, res) => {
    try {
        const { playerId } = req.body;
        if (!playerId) return res.status(400).json({ error: 'playerId required' });
        await scheduleRefresh(parseInt(playerId), 0);
        return res.json({ success: true, message: `Player ${playerId} queued for immediate refresh.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/import-torn-api
 * 
 * Samples random recent Torn player IDs (3M-5M range) directly via the Torn API.
 * This gives us REAL, fresh activity data — not third-party stale data.
 * 
 * Uses the faction's registered API key from the pool.
 * Streams progress back via Server-Sent Events.
 * 
 * Body: { count: number (default 200), minActive: number hours (default 168 = 7 days) }
 */
router.post('/import-torn-api', async (req, res) => {
    try {
        const { count = 200, minActiveH = 168 } = req.body;
        const totalToFetch = Math.min(parseInt(count) || 200, 1000);
        const activeThresholdMs = (parseInt(minActiveH) || 168) * 3_600_000;

        // Need at least one key in pool
        if (poolSize() === 0) {
            return res.status(400).json({
                error: 'No API key registered. Register your faction first to add a key to the pool.'
            });
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });

        const send = (msg) => {
            try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch(e) {}
        };

        send({ type: 'start', message: `Scanning ${totalToFetch} random recent Torn IDs via API...` });

        // Recent Torn IDs — players created roughly 2018-2026
        // Torn has ~5.5M total IDs; most active players are in the 2M-5M range
        const MIN_ID = 2_000_000;
        const MAX_ID = 5_200_000;

        let fetched = 0;
        let stored = 0;
        let recruitable = 0;

        // Fetch in parallel batches of 5 (respects rate limit with 1 key)
        while (fetched < totalToFetch) {
            const batchSize = Math.min(5, totalToFetch - fetched);
            const batch = [];

            for (let i = 0; i < batchSize; i++) {
                const id = Math.floor(Math.random() * (MAX_ID - MIN_ID)) + MIN_ID;
                batch.push(id);
            }

            const results = await Promise.allSettled(
                batch.map(id => fetchPlayer(id))
            );

            const ops = [];
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (r.status !== 'fulfilled' || r.value === null) continue;

                const raw = r.value;
                const id = batch[i];
                const parsed = parsePlayer(id, raw);

                // Only store players who have been active recently
                const hoursSince = parsed.lastActionTs
                    ? (Date.now() - parsed.lastActionTs.getTime()) / 3_600_000
                    : 9999;
                const msAgo = hoursSince * 3_600_000;

                if (msAgo > activeThresholdMs) continue; // Skip inactive players

                ops.push({
                    updateOne: {
                        filter: { _id: id },
                        update: { $set: parsed },
                        upsert: true,
                    }
                });

                stored++;
                if (parsed.factionId === 0 && parsed.status === 'Okay') recruitable++;
            }

            if (ops.length > 0) {
                await Player.bulkWrite(ops, { ordered: false });
            }

            fetched += batchSize;
            send({
                type: 'progress',
                fetched,
                total: totalToFetch,
                stored,
                recruitable,
            });

            // Small pause to avoid overwhelming the API
            await new Promise(r => setTimeout(r, 500));
        }

        send({
            type: 'complete',
            stored,
            recruitable,
            message: `Done! Scanned ${totalToFetch} players, stored ${stored} active ones, found ${recruitable} factionless recruitables.`,
        });
        res.end();

    } catch (err) {
        console.error('[Admin] Import error:', err.message);
        if (!res.headersSent) {
            return res.status(500).json({ error: err.message });
        }
    }
});


module.exports = router;
