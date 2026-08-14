'use strict';
const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    _id: { type: Number },           // Torn player ID
    name: { type: String, default: '' },
    level: { type: Number, default: 0 },
    factionId: { type: Number, default: 0 },      // 0 = no faction
    factionName: { type: String, default: '' },
    status: { type: String, default: 'Okay' },     // Okay, Hospital, Traveling, Jail, Fallen
    lastActionTs: { type: Date, default: null },   // Last action timestamp
    lastActionRelative: { type: String, default: '' }, // '2 hours ago' etc.
    networth: { type: Number, default: 0 },
    rank: { type: String, default: '' },
    awards: { type: Number, default: 0 },
    donator: { type: Boolean, default: false },
    daysInTorn: { type: Number, default: 0 },      // Account age in days
    gender: { type: String, default: '' },
    life: { type: Number, default: 0 },
    progressionRate: { type: Number, default: 0 },  // level / daysInTorn
    
    // Combat & Activity Intel
    xanax: { type: Number, default: 0 },
    refills: { type: Number, default: 0 },
    se: { type: Number, default: 0 },
    playtime: { type: Number, default: 0 },
    estStats: { type: mongoose.Schema.Types.Mixed, default: null },
    scoutGrade: { type: String, default: 'C' },     // S, A, B, C, D, F
    recruitScore: { type: Number, default: 0 },

    // Dibs / Claims
    claimedBy: { type: String, default: '' },
    claimedAt: { type: Date, default: null },
    notes: { type: String, default: '' },

    // Refresh scheduling
    refreshedAt: { type: Date, default: null },
    nextRefreshAt: { type: Date, default: () => new Date() },
}, { _id: false, versionKey: false });

module.exports = mongoose.model('Player', playerSchema, 'players');
