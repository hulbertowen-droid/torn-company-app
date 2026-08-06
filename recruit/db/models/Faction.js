'use strict';
const mongoose = require('mongoose');

const factionSchema = new mongoose.Schema({
    _id: { type: Number },           // Torn faction ID
    name: { type: String, default: '' },
    registeredBy: { type: Number },  // Torn user ID of the registrar
    apiKeys: [{ type: String }],     // Hashed API keys contributed to the pool
    memberIds: [{ type: Number }],   // Current member IDs (for anti-poaching)
    noPoachList: [{ type: Number }], // Faction IDs this faction won't recruit from
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { _id: false, versionKey: false });

module.exports = mongoose.model('Faction', factionSchema, 'factions');
