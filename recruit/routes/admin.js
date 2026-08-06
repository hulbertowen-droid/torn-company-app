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
 * POST /api/admin/import-ffscouter
 * 
 * Fetches factionless candidates from ffscouter.com and bulk-imports them
 * into MongoDB so the recruiter has real data to search immediately.
 * 
 * This seeds the database without waiting for the background scanner.
 * Query: { minLevel, maxLevel, pages } 
 */
router.post('/import-ffscouter', async (req, res) => {
    try {
        const { minLevel = 10, maxLevel = 100, pages = 5 } = req.body;

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });

        const send = (msg) => res.write(`data: ${JSON.stringify(msg)}\n\n`);
        send({ type: 'start', message: 'Starting ffscouter import...' });

        let totalImported = 0;
        let totalSkipped = 0;

        for (let page = 1; page <= pages; page++) {
            try {
                // ffscouter targets endpoint - search for factionless players
                const url = `https://www.ffscouter.com/api/targets?minlevel=${minLevel}&maxlevel=${maxLevel}&status=0&faction=none&page=${page}`;
                const resp = await fetch(url, {
                    headers: { 'User-Agent': 'TornRecruit/1.0' },
                    signal: AbortSignal.timeout(10000),
                });

                if (!resp.ok) {
                    send({ type: 'warn', message: `ffscouter page ${page} returned ${resp.status}` });
                    continue;
                }

                const data = await resp.json();
                const players = data?.data || data?.players || data?.targets || [];

                if (players.length === 0) {
                    send({ type: 'done', message: `No more data at page ${page}. Stopping.` });
                    break;
                }

                // Bulk upsert into MongoDB
                const ops = players.map(p => {
                    const playerId = parseInt(p.id || p.player_id || p.torn_id);
                    if (!playerId) return null;

                    const lastActionTs = p.last_action ? new Date(p.last_action * 1000) : null;
                    const hoursSinceLast = lastActionTs
                        ? (Date.now() - lastActionTs.getTime()) / 3_600_000
                        : 9999;

                    const calcDelay = () => {
                        if (hoursSinceLast < 1)  return 20 * 60_000;
                        if (hoursSinceLast < 12) return 60 * 60_000;
                        if (hoursSinceLast < 48) return 4 * 3_600_000;
                        return 24 * 3_600_000;
                    };

                    return {
                        updateOne: {
                            filter: { _id: playerId },
                            update: {
                                $set: {
                                    _id: playerId,
                                    name: p.name || p.player_name || '',
                                    level: parseInt(p.level) || 0,
                                    factionId: 0,
                                    factionName: '',
                                    status: 'Okay',
                                    lastActionTs,
                                    lastActionRelative: p.last_action_relative || '',
                                    networth: parseInt(p.networth || p.net_worth) || 0,
                                    rank: p.rank || '',
                                    awards: parseInt(p.awards) || 0,
                                    donator: p.donator === 1 || p.donator === true,
                                    daysInTorn: parseInt(p.age || p.days_in_torn) || 0,
                                    gender: p.gender || '',
                                    refreshedAt: new Date(),
                                    nextRefreshAt: new Date(Date.now() + calcDelay()),
                                }
                            },
                            upsert: true,
                        }
                    };
                }).filter(Boolean);

                if (ops.length > 0) {
                    await Player.bulkWrite(ops, { ordered: false });
                    totalImported += ops.length;
                }

                send({ type: 'progress', page, imported: ops.length, total: totalImported });
                
                // Small delay between pages to be polite
                await new Promise(r => setTimeout(r, 500));

            } catch (pageErr) {
                send({ type: 'warn', message: `Page ${page} error: ${pageErr.message}` });
            }
        }

        send({ type: 'complete', totalImported, message: `Import complete! ${totalImported} players added to the database.` });
        res.end();

    } catch (err) {
        console.error('[Admin] Import error:', err.message);
        if (!res.headersSent) {
            return res.status(500).json({ error: err.message });
        }
    }
});

module.exports = router;
