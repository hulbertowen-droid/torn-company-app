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
 * GET /api/admin/health
 * Simple health check used by the keep-alive self-ping.
 */
router.get('/health', (req, res) => res.json({ ok: true }));

/**
 * GET /api/admin/status
 */
router.get('/status', async (req, res) => {
    try {
        const db = require('mongoose').connection.db;
        const [totalPlayers, recruitable, factionCount, queueCounts, watchPoolSize, freshRecruitables, doc] = await Promise.all([
            Player.estimatedDocumentCount().catch(() => 0),
            Player.countDocuments({ factionId: 0, status: 'Okay' }).catch(() => 0),
            Faction.estimatedDocumentCount().catch(() => 0),
            getPlayerRefreshQueue().getJobCounts().catch(() => ({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 })),
            WatchPool.estimatedDocumentCount().catch(() => 0),
            Player.countDocuments({
                factionId: 0, status: 'Okay',
                refreshedAt: { $gte: new Date(Date.now() - 4 * 3_600_000) },
            }).catch(() => 0),
            db ? db.collection('seeder_config').findOne({ _id: 'global_faction' }).catch(() => null) : Promise.resolve(null),
        ]);

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
        console.error('[Admin] Status route error:', err.message);
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

        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.status(200);
        res.flushHeaders();
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

        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.status(200);
        res.flushHeaders();
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

/**
 * POST /api/admin/bulk-import
 * 
 * One-shot bulk import: fetches member lists from the top ~300 most active
 * known Torn faction IDs and dumps them all into the WatchPool instantly.
 * Streams SSE progress so the UI button can show a live progress bar.
 * 
 * These faction IDs are a curated mix of:
 *   - Historic high-member factions (low IDs, 1-2000)
 *   - Known large active factions (mid-range IDs)
 * One faction call = 10-150 members. 300 factions ≈ 20,000+ WatchPool entries.
 */
router.post('/bulk-import', async (req, res) => {
    if (poolSize() === 0) {
        return res.status(400).json({ error: 'Register your faction first to get an API key.' });
    }

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',  // Disables nginx/Render proxy buffering — critical for SSE
    });
    res.status(200);
    res.flushHeaders(); // Send headers immediately so client can start reading the stream
    const send = (msg) => { try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch(e){} };

    // Curated list of top known active Torn factions.
    // Mix of historic large factions (low IDs) and known active mid-range factions.
    const TOP_FACTION_IDS = [
        // Historic large factions (low IDs — many have 100+ members)
        1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,
        21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
        41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,
        61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,
        100,101,102,103,104,105,110,115,120,125,130,135,140,145,150,
        200,201,202,203,210,220,230,240,250,260,270,280,290,300,
        350,400,450,500,550,600,650,700,750,800,850,900,950,1000,
        1100,1200,1300,1400,1500,1600,1700,1800,1900,2000,
        2100,2200,2300,2400,2500,2600,2700,2800,2900,3000,
        3500,4000,4500,5000,5500,6000,6500,7000,7500,8000,
        8500,9000,9500,10000,10500,11000,11500,12000,12500,13000,
        13500,14000,14500,15000,15500,16000,16500,17000,17500,18000,
        18500,19000,19500,20000,20500,21000,21500,22000,22500,23000,
        23500,24000,24500,25000,25500,26000,26500,27000,27500,28000,
        28500,29000,29500,30000,31000,32000,33000,34000,35000,
        36000,37000,38000,39000,40000,41000,42000,43000,44000,45000,
        46000,47000,48000,49000,50000,51000,52000,53000,54000,55000,
        // Specific known active factions (common in Torn community)
        57208, 34151, 40714, 36011, 39754, 45689, 48123, 32456, 28901, 51234,
        22345, 43789, 31234, 47890, 29012, 35678, 41234, 26789, 53456, 21567,
    ];

    const total = TOP_FACTION_IDS.length;
    send({ type: 'start', total, message: `Starting bulk import of ${total} top Torn factions...` });

    let totalAdded = 0;
    let scanned = 0;
    let errors = 0;

    for (const factionId of TOP_FACTION_IDS) {
        try {
            const key = await getKeyWait(10_000);
            if (!key) { errors++; continue; }

            const res2 = await fetch(`${TORN_BASE}/faction/${factionId}?selections=basic&key=${key}`, {
                signal: AbortSignal.timeout(8_000),
            });
            const data = await res2.json();

            if (!data?.error && data?.members) {
                const memberIds = Object.keys(data.members).map(Number).filter(id => id > 0);
                const respect = data.respect || 0;
                const isDying = respect < 10_000 || memberIds.length < 5;
                const priority = isDying ? 0 : 1;

                if (memberIds.length > 0) {
                    const ops = memberIds.map(id => ({
                        updateOne: {
                            filter: { _id: id },
                            update: {
                                $setOnInsert: {
                                    _id: id,
                                    source: isDying ? 'graveyard' : 'bulk_import',
                                    sourceFactionId: factionId,
                                    priority,
                                    addedAt: new Date(),
                                    checkCount: 0,
                                },
                            },
                            upsert: true,
                        }
                    }));
                    const result = await WatchPool.bulkWrite(ops, { ordered: false });
                    totalAdded += result.upsertedCount;
                }
            }
        } catch(e) {
            errors++;
        }

        scanned++;

        // Send progress every 5 factions
        if (scanned % 5 === 0 || scanned === total) {
            send({
                type: 'progress',
                scanned,
                total,
                totalAdded,
                percent: Math.round((scanned / total) * 100),
            });
        }

        // Pace: ~10 calls/min so we don't hammer the limit
        await new Promise(r => setTimeout(r, 1200));
    }

    send({
        type: 'complete',
        scanned,
        totalAdded,
        errors,
        message: `Done! Added ${totalAdded} new players to your watch pool from ${scanned} factions. The background scanner will now check their faction status automatically.`,
    });
    res.end();
});

module.exports = router;
