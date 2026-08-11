'use strict';
const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
    if (isConnected) return;
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/torn_recruit';
    await mongoose.connect(uri);
    isConnected = true;
    console.log('[MongoDB] Connected →', uri.replace(/\/\/.*@/, '//***@'));
    await ensureIndexes();
}

async function ensureIndexes() {
    const db = mongoose.connection.db;
    if (!db) {
        console.warn('[MongoDB] recruit/db/mongo: Database not connected yet.');
        return;
    }

    const col = db.collection('players');

    // Unique ID index
    await col.createIndex({ _id: 1 }, { unique: true }).catch(() => {});

    // Refresh queue index — workers poll nextRefreshAt ascending
    await col.createIndex({ nextRefreshAt: 1 }).catch(() => {});

    // ── The "Golden" partial index ──────────────────────────────────────────
    // Only indexes documents where factionId === 0 AND status === 'Okay'.
    // This is the in-memory dataset recruiters actually search.
    // Because it's partial, it's tiny even if the full collection has millions.
    await col.createIndex(
        { level: -1, lastActionTs: -1, networth: -1, awards: -1, daysInTorn: -1 },
        {
            partialFilterExpression: { factionId: 0, status: 'Okay' },
            name: 'recruitable_partial'
        }
    ).catch(() => {});

    // Index for the faction collection
    const facCol = db.collection('factions');
    await facCol.createIndex({ _id: 1 }, { unique: true }).catch(() => {});
    await facCol.createIndex({ memberIds: 1 }).catch(() => {});

    console.log('[MongoDB] Recruit indexes ensured');
}

module.exports = { ensureIndexes };
