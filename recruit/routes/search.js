'use strict';
const express = require('express');
const router = express.Router();
const Player = require('../db/models/Player');
const Faction = require('../db/models/Faction');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Compute Scout Grade and Recruit Score from player stats
 */
function computeScoutGrade(p) {
    const age = p.daysInTorn || 1;
    const level = p.level || 1;
    const xanax = p.xanax || 0;
    const refills = p.refills || 0;
    const se = p.se || 0;
    const velocity = parseFloat((level / age).toFixed(4));
    const xanPerDay = parseFloat((xanax / age).toFixed(3));
    const refillsPerDay = parseFloat((refills / age).toFixed(3));
    const sePerDay = parseFloat((se / age).toFixed(3));

    let score = 0;
    score += (velocity * 100);
    score += (xanPerDay * 18);
    score += (refillsPerDay * 8);
    score += (sePerDay * 5);

    if (p.lastActionTs) {
        const hoursInactive = (Date.now() - new Date(p.lastActionTs).getTime()) / 3_600_000;
        if (hoursInactive < 6) score += 50;
        else if (hoursInactive < 24) score += 30;
        else if (hoursInactive < 72) score += 10;
    }

    if (p.awards) score += Math.min(p.awards * 0.4, 40);
    if (p.donator) score += 25;

    if (level < 20) {
        if (level < age * 0.5) score -= 80;
        else if (level > age * 2.0) score += 35;
    }

    const recruitScore = Math.max(0, parseFloat(score.toFixed(1)));
    let scoutGrade = 'F';
    if (recruitScore >= 140) scoutGrade = 'S';
    else if (recruitScore >= 100) scoutGrade = 'A';
    else if (recruitScore >= 65) scoutGrade = 'B';
    else if (recruitScore >= 35) scoutGrade = 'C';
    else if (recruitScore >= 15) scoutGrade = 'D';

    return { recruitScore, scoutGrade, velocity, xanPerDay };
}

/**
 * GET /api/search
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
            minProgressionRate,
            donator,
            status = 'All',
            targetType = 'Factionless',
            sort = 'lastActionTs',
            order = 'desc',
            cursor,
            limit: rawLimit = DEFAULT_LIMIT,
            excludeFactions,
            factionId,
            searchQuery,
        } = req.query;

        const limit = Math.min(parseInt(rawLimit) || DEFAULT_LIMIT, MAX_LIMIT);

        const query = {
            level: { $gte: parseInt(minLevel) || 1, $lte: parseInt(maxLevel) || 100 },
        };

        // Faction targeting filter
        if (targetType === 'Factionless') {
            query.factionId = 0;
        } else if (targetType === 'Member') {
            query.factionId = { $gt: 0 };
        }

        // Status filter
        if (status && status !== 'All') {
            query.status = status;
        } else {
            // Exclude Fallen/Federal by default
            query.status = { $nin: ['Fallen', 'Federal', 'Deleted'] };
        }

        if (searchQuery && searchQuery.trim().length > 0) {
            const clean = searchQuery.trim();
            if (/^\d+$/.test(clean)) {
                query._id = parseInt(clean);
            } else {
                query.name = { $regex: clean, $options: 'i' };
            }
        }

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

        if (minProgressionRate) {
            query.progressionRate = { $gte: parseFloat(minProgressionRate) };
        }

        // Anti-poaching: exclude requesting faction's own members
        const excludeIds = new Set();
        if (factionId) {
            const faction = await Faction.findById(parseInt(factionId)).lean();
            if (faction?.memberIds) faction.memberIds.forEach(id => excludeIds.add(id));
        }

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

        // Cursor pagination
        if (cursor) {
            const cursorNum = parseInt(cursor);
            if (!isNaN(cursorNum)) {
                const dir = order === 'asc' ? '$gt' : '$lt';
                query._id = { ...query._id, [dir]: cursorNum };
            }
        }

        const sortMap = {
            level: 'level',
            networth: 'networth',
            lastAction: 'lastActionTs',
            lastActionTs: 'lastActionTs',
            awards: 'awards',
            age: 'daysInTorn',
            progression: 'progressionRate',
            score: 'recruitScore',
        };
        const sortField = sortMap[sort] || 'lastActionTs';
        const sortDir = order === 'asc' ? 1 : -1;

        const players = await Player
            .find(query)
            .sort({ [sortField]: sortDir, _id: sortDir })
            .limit(limit + 1)
            .lean();

        const hasMore = players.length > limit;
        if (hasMore) players.pop();

        const nextCursor = hasMore && players.length > 0
            ? players[players.length - 1]._id
            : null;

        const staleThresholdMs = 4 * 3_600_000;
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

function formatPlayer(p) {
    const hoursSinceLast = p.lastActionTs
        ? Math.round((Date.now() - new Date(p.lastActionTs).getTime()) / 3_600_000)
        : null;

    const { recruitScore, scoutGrade, velocity, xanPerDay } = computeScoutGrade(p);

    return {
        id: p._id,
        name: p.name,
        level: p.level,
        status: p.status,
        factionId: p.factionId || 0,
        factionName: p.factionName || (p.factionId === 0 ? 'Factionless' : 'In Faction'),
        lastAction: p.lastActionRelative || (hoursSinceLast !== null ? `${hoursSinceLast}h ago` : 'Unknown'),
        lastActionTs: p.lastActionTs,
        networth: p.networth,
        rank: p.rank,
        awards: p.awards,
        donator: p.donator,
        daysInTorn: p.daysInTorn,
        progressionRate: p.progressionRate || velocity || 0,
        gender: p.gender,
        xanax: p.xanax || 0,
        refills: p.refills || 0,
        se: p.se || 0,
        playtime: p.playtime || 0,
        estStats: p.estStats || 'Not yet available',
        scoutGrade: p.scoutGrade || scoutGrade,
        recruitScore: p.recruitScore || recruitScore,
        claimedBy: p.claimedBy || '',
        claimedAt: p.claimedAt || null,
        notes: p.notes || '',
        refreshedAt: p.refreshedAt,
        profileUrl: `https://www.torn.com/profiles.php?XID=${p._id}`,
        messageUrl: `https://www.torn.com/messages.php?action=send&XID=${p._id}`,
        attackUrl: `https://www.torn.com/loader.php?sid=attack&user2ID=${p._id}`,
    };
}

module.exports = router;
