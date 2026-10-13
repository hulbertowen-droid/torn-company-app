'use strict';

const express = require('express');
const router = express.Router();
const userKeys = require('../user-keys');
const sessionManager = require('../session-manager');

let targetFactionGetter = () => '';

function setTargetFactionGetter(fn) {
    if (typeof fn === 'function') targetFactionGetter = fn;
}

// GET /api/session (or /api/session/me, /api/auth/me) — Check current authenticated session
router.get(['/', '/me'], (req, res) => {
    if (!req.userSession) {
        return res.json({ authenticated: false, message: "No active session" });
    }
    return res.json({
        authenticated: true,
        user: {
            playerId: req.userSession.playerId,
            playerName: req.userSession.playerName,
            level: req.userSession.level,
            factionId: req.userSession.factionId,
            factionName: req.userSession.factionName,
            factionRole: req.userSession.factionRole,
            isSpiderVerse: req.userSession.isSpiderVerse,
            bars: req.userSession.bars
        }
    });
});

// POST /api/session/connect (or /api/auth/connect) — Authenticate Torn API key, encrypt in vault, issue session
router.post('/connect', async (req, res) => {
    try {
        const apiKey = String(req.body.apiKey || req.headers['x-api-key'] || '').trim().replace(/['"\s]/g, '');
        if (!apiKey || apiKey.length < 16) {
            return res.status(400).json({ success: false, error: "Valid Torn API Key required (16 characters)." });
        }

        const tornRes = await fetch(`https://api.torn.com/user/?selections=profile,bars&key=${apiKey}&timestamp=${Date.now()}`, {
            signal: AbortSignal.timeout(10000)
        });
        const data = await tornRes.json();

        if (data.error) {
            const errCode = data.error.code;
            const errMsg = data.error.error || "Unknown Torn API error";
            if (errCode === 2) return res.status(400).json({ success: false, error: "Incorrect or invalid Torn API key." });
            if (errCode === 7) return res.status(400).json({ success: false, error: "Access level too low. Key must have at least Public or Limited Access." });
            return res.status(400).json({ success: false, error: `Torn API error [${errCode}]: ${errMsg}` });
        }

        if (!data.player_id) {
            return res.status(400).json({ success: false, error: "Unable to retrieve player profile with this key." });
        }

        const playerId = data.player_id;
        const playerName = data.name || `Player #${playerId}`;
        const userFacId = String(data.faction?.faction_id || '0');
        const userFacName = data.faction?.faction_name || 'None';
        const userFacRole = data.faction?.position || '';
        const targetFaction = String(targetFactionGetter() || '');
        const isSpiderVerse = Boolean(targetFaction ? (userFacId === targetFaction) : (userFacId && userFacId !== '0'));

        // Securely encrypt and store the key in vault under torn:<id>
        await userKeys.linkUserApiKeyByTornId(playerId, apiKey);

        // Generate cryptographically secure session
        const session = await sessionManager.createSession({
            playerId,
            playerName,
            level: data.level || 1,
            factionId: userFacId,
            factionName: userFacName,
            factionRole: userFacRole,
            isSpiderVerse,
            bars: {
                energy: data.energy || null,
                nerve: data.nerve || null,
                happy: data.happy || null,
                life: data.life || null
            }
        });

        // Return session token and user info ONLY — NEVER return the raw API key!
        return res.json({
            success: true,
            sessionToken: session.token,
            user: {
                playerId,
                playerName,
                level: session.level,
                factionId: userFacId,
                factionName: userFacName,
                factionRole: userFacRole,
                isSpiderVerse,
                bars: session.bars
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/session/logout (or /api/auth/logout) — Invalidate current session
router.post('/logout', async (req, res) => {
    const token = sessionManager.extractTokenFromRequest(req);
    if (token) {
        await sessionManager.deleteSession(token);
    }
    return res.json({ success: true });
});

// POST /api/session/verify-faction-access (or /api/auth/verify-faction-access)
router.post('/verify-faction-access', async (req, res) => {
    try {
        const apiKey = String(req.body.apiKey || '').trim();
        if (!apiKey) return res.status(400).json({ success: false, authorized: false, reason: "Torn API Key is required." });

        const targetFactionId = String(targetFactionGetter() || '');

        const tornRes = await fetch(`https://api.torn.com/user/?selections=profile,bars&key=${apiKey}&timestamp=${Date.now()}`, {
            signal: AbortSignal.timeout(9000)
        });
        const data = await tornRes.json();

        if (data.error) {
            return res.status(400).json({ success: false, authorized: false, reason: data.error.error || "Invalid Torn API key." });
        }

        const userFacId = String(data.faction?.faction_id || '0');
        const userFacName = data.faction?.faction_name || 'None';
        const isMember = Boolean(targetFactionId ? (userFacId === targetFactionId) : (userFacId && userFacId !== '0'));

        // Automatically create and link session
        await userKeys.linkUserApiKeyByTornId(data.player_id, apiKey);
        const session = await sessionManager.createSession({
            playerId: data.player_id,
            playerName: data.name,
            level: data.level || 1,
            factionId: userFacId,
            factionName: userFacName,
            factionRole: data.faction?.position || '',
            isSpiderVerse: isMember,
            bars: { energy: data.energy, nerve: data.nerve, happy: data.happy, life: data.life }
        });

        res.json({
            success: true,
            authorized: isMember,
            sessionToken: session.token,
            isSpiderVerse: isMember,
            reason: isMember ? undefined : `You are currently in "${userFacName}" [ID: ${userFacId}]. Only active faction members are authorized for faction-specific tools.`,
            player: {
                id: data.player_id,
                name: data.name,
                level: data.level,
                role: data.faction?.position || 'Member',
                factionId: userFacId,
                factionName: userFacName,
                isMember
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, authorized: false, reason: err.message });
    }
});

module.exports = router;
module.exports.setTargetFactionGetter = setTargetFactionGetter;
