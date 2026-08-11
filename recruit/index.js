'use strict';
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const { ensureIndexes } = require('./db/mongo');
const { addKey } = require('./lib/apiKeyPool');
const { startRefreshWorker, setBroadcast: setRefreshBroadcast } = require('./workers/refreshWorker');
const { startSeederWorker, setBroadcast: setSeederBroadcast } = require('./workers/seederWorker');
const Faction = require('./db/models/Faction');

const authRoutes   = require('./routes/auth');
const searchRoutes = require('./routes/search');
const adminRoutes  = require('./routes/admin');

/**
 * Mounts the recruitment platform onto an existing Express app and HTTP server.
 */
async function initRecruitPlatform(app, server) {
    console.log('[Recruit] Mounting Torn Recruiting Platform...');

    // ── Middleware & Static Files ───────────────────────────────────────────
    app.use('/recruit', express.static(path.join(__dirname, 'public')));

    // ── Routes ──────────────────────────────────────────────────────────────
    app.use('/recruit-api/auth',   authRoutes);
    app.use('/recruit-api/search', searchRoutes);
    app.use('/recruit-api/admin',  adminRoutes);

    // ── WebSocket Server ────────────────────────────────────────────────────
    const wss = new WebSocketServer({ server, path: '/recruit-live' });
    const clients = new Set();

    wss.on('connection', (ws, req) => {
        clients.add(ws);
        ws.send(JSON.stringify({ type: 'connected', message: 'Live feed active.' }));

        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
    });

    function broadcast(data) {
        const msg = JSON.stringify(data);
        for (const client of clients) {
            if (client.readyState === 1) client.send(msg);
        }
    }

    setRefreshBroadcast(broadcast);
    setSeederBroadcast(broadcast);

    async function startRecruitEngine() {
        await ensureIndexes();

        const factions = await Faction.find({}, { _id: 1, apiKeys: 1 }).lean();
        let keysLoaded = 0;
        for (const faction of factions) {
            for (const key of faction.apiKeys || []) {
                addKey(key, faction._id, null);
                keysLoaded++;
            }
        }
        console.log(`[KeyPool] Reloaded ${keysLoaded} keys from ${factions.length} factions`);

        if (keysLoaded > 0) {
            startRefreshWorker().catch(e => console.error('[RefreshWorker] Error:', e));
            startSeederWorker().catch(e => console.error('[SeederWorker] Error:', e));
        } else {
            console.warn('[Recruit] No API keys in pool yet — register a faction to start scanning.');
            startRefreshWorker().catch(e => console.error('[RefreshWorker] Error:', e));
            startSeederWorker().catch(e => console.error('[SeederWorker] Error:', e));
        }
        console.log('[Recruit] Platform successfully mounted at /recruit');
    }

    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
        startRecruitEngine().catch(e => console.error('[Recruit Engine] Error:', e));
    } else {
        mongoose.connection.once('open', () => {
            console.log('[Recruit] Main app MongoDB connected, booting engines...');
            startRecruitEngine().catch(e => console.error('[Recruit Engine] Error:', e));
        });
    }
}

module.exports = { initRecruitPlatform };
