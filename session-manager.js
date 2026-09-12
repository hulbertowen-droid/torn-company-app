'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const sessionsMemory = new Map();
const SESSIONS_COL = 'web_sessions';

/**
 * Initialize session store from MongoDB Atlas on startup
 */
async function initSessionStore() {
    try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            const col = mongoose.connection.db.collection(SESSIONS_COL);
            col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
            
            const activeDocs = await col.find({ expiresAt: { $gt: new Date() } }).toArray();
            let count = 0;
            for (const doc of activeDocs) {
                if (doc.token && doc.playerId) {
                    sessionsMemory.set(doc.token, {
                        token: doc.token,
                        playerId: doc.playerId,
                        playerName: doc.playerName,
                        level: doc.level || 1,
                        factionId: String(doc.factionId || '0'),
                        factionName: doc.factionName || 'None',
                        factionRole: doc.factionRole || '',
                        isSpiderVerse: String(doc.factionId || '') === '52355',
                        bars: doc.bars || null,
                        createdAt: doc.createdAt ? doc.createdAt.getTime() : Date.now(),
                        expiresAt: doc.expiresAt ? doc.expiresAt.getTime() : (Date.now() + SESSION_TTL_MS)
                    });
                    count++;
                }
            }
            if (count > 0) {
                console.log(`[SessionManager] Preloaded ${count} active web sessions from database.`);
            }
        }
    } catch (err) {
        console.warn('[SessionManager] DB init warning:', err.message);
    }
}

/**
 * Create a new cryptographically secure session for an authenticated Torn player
 */
async function createSession(userData) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;

    const session = {
        token,
        playerId: Number(userData.playerId),
        playerName: userData.playerName || `Player #${userData.playerId}`,
        level: userData.level || 1,
        factionId: String(userData.factionId || '0'),
        factionName: userData.factionName || 'None',
        factionRole: userData.factionRole || '',
        isSpiderVerse: String(userData.factionId || '') === '52355',
        bars: userData.bars || null,
        createdAt: now,
        expiresAt
    };

    sessionsMemory.set(token, session);

    try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            const col = mongoose.connection.db.collection(SESSIONS_COL);
            await col.updateOne(
                { token },
                {
                    $set: {
                        token,
                        playerId: session.playerId,
                        playerName: session.playerName,
                        level: session.level,
                        factionId: session.factionId,
                        factionName: session.factionName,
                        factionRole: session.factionRole,
                        isSpiderVerse: session.isSpiderVerse,
                        bars: session.bars,
                        createdAt: new Date(now),
                        expiresAt: new Date(expiresAt)
                    }
                },
                { upsert: true }
            );
        }
    } catch (e) {
        console.warn('[SessionManager] Error persisting session to DB:', e.message);
    }

    return session;
}

/**
 * Retrieve active session by token
 */
function getSession(token) {
    if (!token || typeof token !== 'string') return null;
    const clean = token.trim();
    if (!clean) return null;

    const sess = sessionsMemory.get(clean);
    if (!sess) return null;

    if (sess.expiresAt && sess.expiresAt < Date.now()) {
        deleteSession(clean);
        return null;
    }

    return sess;
}

/**
 * Invalidate and delete a session
 */
async function deleteSession(token) {
    if (!token) return false;
    const clean = String(token).trim();
    const deleted = sessionsMemory.delete(clean);

    try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            const col = mongoose.connection.db.collection(SESSIONS_COL);
            await col.deleteOne({ token: clean });
        }
    } catch (e) {}

    return deleted;
}

/**
 * Extract token from standard authorization headers or cookies
 */
function extractTokenFromRequest(req) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    const headerToken = req.headers['x-session-token'];
    if (headerToken) return String(headerToken).trim();

    if (req.cookies && req.cookies.sv_session_token) {
        return String(req.cookies.sv_session_token).trim();
    }
    return '';
}

/**
 * Express middleware to attach authenticated session and Torn API key to req
 */
function resolveSessionMiddleware(userKeys) {
    return function(req, res, next) {
        const token = extractTokenFromRequest(req);
        if (token) {
            const session = getSession(token);
            if (session) {
                req.userSession = session;
                const keyRec = userKeys.resolveUserApiKeyByTornId(session.playerId);
                if (keyRec && keyRec.key) {
                    req.userTornKey = keyRec.key;
                }
            }
        }

        // Backwards-compatible fallback for userscript or developer calls with direct x-api-key
        if (!req.userTornKey) {
            const directKey = (req.headers['x-api-key'] || req.query.apiKey || '').trim();
            if (directKey && directKey !== 'null' && directKey.length >= 16) {
                req.userTornKey = directKey;
            }
        }

        next();
    };
}

// Clean in-memory map periodically
setInterval(() => {
    const now = Date.now();
    for (const [token, sess] of sessionsMemory.entries()) {
        if (sess.expiresAt && sess.expiresAt < now) {
            sessionsMemory.delete(token);
        }
    }
}, 15 * 60 * 1000);

module.exports = {
    initSessionStore,
    createSession,
    getSession,
    deleteSession,
    revokeSession: deleteSession,
    extractTokenFromRequest,
    resolveSessionMiddleware
};
