'use strict';
const mongoose = require('mongoose');

/**
 * WatchPool — a priority queue of known Torn player IDs to actively monitor.
 * 
 * Instead of scanning random IDs, the seeder only checks players we KNOW are real
 * active Torn players (sourced from faction rosters, war history, attack logs, etc.)
 * 
 * Priority:
 *   0 = check ASAP (just flagged as potentially recruitable)
 *   1 = check soon (active, in faction — might leave)
 *   2 = normal (active but deeply embedded in faction)
 *   3 = low (inactive or just added, check rarely)
 */
const watchPoolSchema = new mongoose.Schema({
    _id: { type: Number },          // Torn player ID
    source: { type: String },        // 'faction_roster', 'war_history', 'attack_log', 'manual'
    sourceFactionId: { type: Number }, // Which faction they were sourced from
    priority: { type: Number, default: 1 },
    lastChecked: { type: Date, default: null },
    addedAt: { type: Date, default: Date.now },
    checkCount: { type: Number, default: 0 },
}, { _id: false });

// Index for efficient priority-queue pulls
watchPoolSchema.index({ priority: 1, lastChecked: 1 });
watchPoolSchema.index({ sourceFactionId: 1 });

module.exports = mongoose.model('WatchPool', watchPoolSchema);
