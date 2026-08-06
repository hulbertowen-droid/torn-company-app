'use strict';
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Player = require('../db/models/Player');
const Faction = require('../db/models/Faction');
const { poolSize, poolStats } = require('../lib/apiKeyPool');
const { getPlayerRefreshQueue, scheduleRefresh } = require('../queues/playerQueue');

/**
 * GET /api/admin/status
 * Returns platform health stats.
 */
router.get('/status', async (req, res) => {
    try {
        const db = mongoose.connection.db;

        const [totalPlayers, recruitable, factionCount, queueCounts] = await Promise.all([
            Player.estimatedDocumentCount(),
            Player.countDocuments({ factionId: 0, status: 'Okay' }),
            Faction.estimatedDocumentCount(),
            getPlayerRefreshQueue().getJobCounts('active', 'waiting', 'delayed', 'failed'),
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
                    : 'N/A',
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

module.exports = router;
