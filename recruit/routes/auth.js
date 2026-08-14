'use strict';
const express = require('express');
const router = express.Router();
const Faction = require('../db/models/Faction');
const Player = require('../db/models/Player');
const { verifyKey, fetchFaction } = require('../lib/tornClient');
const { addKey } = require('../lib/apiKeyPool');

/**
 * POST /api/auth/register
 * 
 * Registers a faction on the platform. Verifies the provided Torn API key,
 * fetches their faction info, and stores member IDs for anti-poaching.
 * 
 * Body: { apiKey: string }
 * Returns: { success, factionId, factionName, membersLoaded }
 */
router.post('/register', async (req, res) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey || apiKey.length < 10) {
            return res.status(400).json({ error: 'Valid Torn API key required.' });
        }

        // Verify the key and get the user's profile
        const profile = await verifyKey(apiKey);
        const tornUserId = profile.player_id;
        const factionId = profile.faction?.faction_id;

        if (!factionId) {
            return res.status(400).json({ error: 'You must be in a faction to register.' });
        }

        // Fetch the faction's member list
        const factionData = await fetchFaction(factionId, apiKey);
        const memberIds = Object.keys(factionData.members || {}).map(Number);
        const factionName = factionData.name || '';

        // Upsert faction into DB
        await Faction.findOneAndUpdate(
            { _id: factionId },
            {
                $set: {
                    name: factionName,
                    registeredBy: tornUserId,
                    memberIds,
                    updatedAt: new Date(),
                },
                $addToSet: { apiKeys: apiKey }, // Store plaintext key for pool reloading on restart
            },
            { upsert: true, returnDocument: 'after' }
        );

        // Add to live API key pool
        addKey(apiKey, factionId, tornUserId);

        // Ensure faction members are not accidentally in recruitable pool
        // (update them to mark as in-faction)
        if (memberIds.length > 0) {
            await Player.updateMany(
                { _id: { $in: memberIds }, factionId: 0 },
                { $set: { factionId, factionName } }
            );
        }

        console.log(`[Auth] Faction "${factionName}" (${factionId}) registered with ${memberIds.length} members.`);

        return res.json({
            success: true,
            factionId,
            factionName,
            membersLoaded: memberIds.length,
        });

    } catch (err) {
        console.error('[Auth] Register error:', err.message);
        return res.status(400).json({ error: err.message });
    }
});

/**
 * POST /api/auth/add-key
 * 
 * Allows a recruiter to contribute their own API key to the shared pool.
 * Does not require them to be a faction leader — any faction member can contribute.
 * 
 * Body: { apiKey: string }
 */
router.post('/add-key', async (req, res) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey || apiKey.length < 10) {
            return res.status(400).json({ error: 'Valid API key required.' });
        }

        const profile = await verifyKey(apiKey);
        const tornUserId = profile.player_id;
        const factionId = profile.faction?.faction_id;

        if (!factionId) {
            return res.status(400).json({ error: 'You must be in a registered faction.' });
        }

        // Check faction is registered
        const faction = await Faction.findById(factionId);
        if (!faction) {
            return res.status(400).json({ error: 'Your faction is not registered on this platform yet. Ask your leader to register first.' });
        }

        await Faction.updateOne(
            { _id: factionId },
            { $addToSet: { apiKeys: apiKey } }
        );

        addKey(apiKey, factionId, tornUserId);

        return res.json({ success: true, message: `API key added to pool. Thanks for contributing, ${profile.name}!` });

    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
});

module.exports = router;
