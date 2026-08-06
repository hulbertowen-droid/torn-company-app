'use strict';
const express = require('express');
const router = express.Router();
const Player = require('../db/models/Player');
const Faction = require('../db/models/Faction');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/search
 * 
 * Instant search over the recruitable player pool.
 * All filters hit the partial index (only factionless + Okay players).
 * 
 * Query params:
 *   minLevel       (number, default 1)
 *   maxLevel       (number, default 100)
 *   minNetworth    (number, optional)
 *   maxLastActionH (number, optional) — max hours since last action
 *   minAwards      (number, optional)
 *   minAge         (number, optional) — min account age in days
 *   maxAge         (number, optional) — max account age in days
 *   donator        (boolean, optional) — true = donators only
 *   status         (string, optional) — Okay, Hospital, Traveling, Jail
 *   sort           (string) — level, networth, lastAction, awards (default: lastAction)
 *   order          (string) — asc, desc (default: desc)
 *   cursor         (string, optional) — cursor-based pagination (last seen _id)
 *   limit          (number, default 50, max 200)
 *   excludeFactions (comma-sep, optional) — faction IDs to exclude from results
 *   factionId      (number, optional) — auto-exclude this faction's members from results
 */
router.get('/', async (req, res) => {
    try {
        const {
            minLevel = 1,
            maxLevel = 100,
            minNetworth,
            maxLastActionH,
            minAwards,
            minAge,
            maxAge,
            donator,
            status = 'Okay',
            sort = 'lastActionTs',
            order = 'desc',
            cursor,
            limit: rawLimit = DEFAULT_LIMIT,
            excludeFactions,
            factionId,
        } = req.query;

        const limit = Math.min(parseInt(rawLimit) || DEFAULT_LIMIT, MAX_LIMIT);

        // Build the MongoDB query — always anchored to factionId=0 to hit partial index
        const query = {
            factionId: 0,
            status: status || 'Okay',
            level: { $gte: parseInt(minLevel) || 1, $lte: parseInt(maxLevel) || 100 },
        };

        if (minNetworth) query.networth = { $gte: parseInt(minNetworth) };
        if (minAwards)   query.awards   = { $gte: parseInt(minAwards) };
        if (donator === 'true') query.donator = true;

        if (maxLastActionH) {
            const cutoff = new Date(Date.now() - parseFloat(maxLastActionH) * 3_600_000);
            query.lastActionTs = { $gte: cutoff };
        }

        if (minAge || maxAge) {
            query.daysInTorn = {};
            if (minAge) query.daysInTorn.$gte = parseInt(minAge);
            if (maxAge) query.daysInTorn.$lte = parseInt(maxAge);
        }

        // Anti-poaching: exclude the requesting faction's own members
        const excludeIds = new Set();
        if (factionId) {
            const faction = await Faction.findById(parseInt(factionId)).lean();
            if (faction?.memberIds) faction.memberIds.forEach(id => excludeIds.add(id));
        }

        // Additional factions to exclude
        if (excludeFactions) {
            const facIds = excludeFactions.split(',').map(Number).filter(Boolean);
            if (facIds.length > 0) {
                const factions = await Faction.find({ _id: { $in: facIds } }, { memberIds: 1 }).lean();
                factions.forEach(f => f.memberIds?.forEach(id => excludeIds.add(id)));
            }
        }

        if (excludeIds.size > 0) {
            query._id = { $nin: Array.from(excludeIds) };
        }

        // Cursor-based pagination
        if (cursor) {
            const cursorNum = parseInt(cursor);
            if (!isNaN(cursorNum)) {
                const dir = order === 'asc' ? '$gt' : '$lt';
                query._id = { ...query._id, [dir]: cursorNum };
            }
        }

        // Sort mapping
        const sortMap = {
            level: 'level',
            networth: 'networth',
            lastAction: 'lastActionTs',
            lastActionTs: 'lastActionTs',
            awards: 'awards',
            age: 'daysInTorn',
        };
        const sortField = sortMap[sort] || 'lastActionTs';
        const sortDir = order === 'asc' ? 1 : -1;

        const players = await Player
            .find(query)
            .sort({ [sortField]: sortDir, _id: sortDir })
            .limit(limit + 1) // Fetch one extra to determine if there's a next page
            .lean();

        const hasMore = players.length > limit;
        if (hasMore) players.pop();

        const nextCursor = hasMore && players.length > 0
            ? players[players.length - 1]._id
            : null;

        // Calculate data freshness
        const staleThresholdMs = 4 * 3_600_000; // 4 hours
        const freshCount = players.filter(p =>
            p.refreshedAt && (Date.now() - new Date(p.refreshedAt).getTime()) < staleThresholdMs
        ).length;

        return res.json({
            success: true,
            count: players.length,
            hasMore,
            nextCursor,
            freshnessRate: players.length > 0 ? Math.round((freshCount / players.length) * 100) : 100,
            players: players.map(formatPlayer),
        });

    } catch (err) {
        console.error('[Search] Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * Format a player document for the client.
 * Strips internal fields and adds computed helpers.
 */
function formatPlayer(p) {
    const hoursSinceLast = p.lastActionTs
        ? Math.round((Date.now() - new Date(p.lastActionTs).getTime()) / 3_600_000)
        : null;

    return {
        id: p._id,
        name: p.name,
        level: p.level,
        status: p.status,
        lastAction: p.lastActionRelative || (hoursSinceLast !== null ? `${hoursSinceLast}h ago` : 'Unknown'),
        lastActionTs: p.lastActionTs,
        networth: p.networth,
        rank: p.rank,
        awards: p.awards,
        donator: p.donator,
        daysInTorn: p.daysInTorn,
        gender: p.gender,
        refreshedAt: p.refreshedAt,
        profileUrl: `https://www.torn.com/profiles.php?XID=${p._id}`,
        messageUrl: `https://www.torn.com/messages.php?action=send&XID=${p._id}`,
    };
}

module.exports = router;
