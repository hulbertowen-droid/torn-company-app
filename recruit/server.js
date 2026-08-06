'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const mongoose = require('mongoose');

const { connectDB } = require('./db/mongo');
const { addKey, poolSize } = require('./lib/apiKeyPool');
const { startRefreshWorker, setBroadcast } = require('./workers/refreshWorker');
const { startSeederWorker } = require('./workers/seederWorker');
const Faction = require('./db/models/Faction');

const authRoutes   = require('./routes/auth');
const searchRoutes = require('./routes/search');
const adminRoutes  = require('./routes/admin');

const PORT = parseInt(process.env.PORT || '4000');
const app = express();
const server = http.createServer(app);

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin',  adminRoutes);

// SPA fallback
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// ── WebSocket Server ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/live' });
const clients = new Set();

wss.on('connection', (ws, req) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'connected', message: 'Live feed active.' }));

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
});

/**
 * Broadcast a message to all connected WebSocket clients.
 */
function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of clients) {
        if (client.readyState === 1) client.send(msg);
    }
}

// Inject broadcast into the refresh worker
setBroadcast(broadcast);

// ── Startup ─────────────────────────────────────────────────────────────────
async function main() {
    console.log('[Recruit] Starting Torn Recruiting Platform...');

    await connectDB();

    // Reload all stored API keys from DB into the in-memory pool on startup
    const factions = await Faction.find({}, { _id: 1, apiKeys: 1 }).lean();
    let keysLoaded = 0;
    for (const faction of factions) {
        for (const key of faction.apiKeys || []) {
            addKey(key, faction._id, null);
            keysLoaded++;
        }
    }
    console.log(`[KeyPool] Reloaded ${keysLoaded} keys from ${factions.length} factions`);

    // Start background workers (only if we have keys to use)
    if (keysLoaded > 0) {
        await startRefreshWorker();
        await startSeederWorker();
    } else {
        console.warn('[Recruit] No API keys in pool yet — register a faction to start scanning.');
        // Start workers anyway so they are ready when keys arrive
        await startRefreshWorker();
        await startSeederWorker();
    }

    server.listen(PORT, () => {
        console.log(`[Recruit] Server running on http://localhost:${PORT}`);
        console.log(`[Recruit] WebSocket live feed on ws://localhost:${PORT}/live`);
    });
}

main().catch(err => {
    console.error('[Recruit] Fatal startup error:', err);
    process.exit(1);
});
