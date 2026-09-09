/**
 * F.R.I.D.A.Y. - User API Key Security Vault & Live Stats Engine
 * 
 * Provides:
 * - Military-grade AES-256-GCM authenticated encryption for user Torn Limited API keys.
 * - Secure persistence across local disk (`data/user_api_keys.json`) and MongoDB Atlas (`AppConfig`).
 * - Real-time Torn API live stats fetcher (energy, nerve, happy, life, cooldowns, travel, status).
 * - High-speed in-memory caching to respect Torn API rate limits (100 req/min).
 * - Automatic owner account resolution (Owen777 / master key).
 * - Natural conversation intent detection for account-specific questions.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TORN_BASE = 'https://api.torn.com';
const KEYS_FILE = path.join(__dirname, 'data', 'user_api_keys.json');

// Derive a 32-byte encryption key for AES-256-GCM
function getMasterEncryptionKey() {
    const rawSecret = process.env.APP_SECRET ||
                      process.env.ENCRYPTION_KEY ||
                      process.env.MONGODB_URI ||
                      process.env.GLOBAL_BOT_TOKEN ||
                      'friday-spider-verse-super-secret-key-2026';
    return crypto.scryptSync(rawSecret, 'salt-spider-verse-friday', 32);
}

// In-memory store: discordUserId => { tornId, playerName, ciphertext, iv, tag, linkedAt, isOwner }
const userKeysStore = new Map();

// In-memory cache for live user stats: apiKey => { data, timestamp }
const userStatsCache = new Map();
const STATS_CACHE_TTL_MS = 10000; // 10 seconds cache

// Owner metadata cached from primary API key
let ownerMeta = {
    tornId: 2658824, // Owen777's default Torn ID
    playerName: 'Owen777',
    discordId: ''
};

// Callback to trigger mongo save when available
let onSaveCallback = null;

function setMongoSaveCallback(cb) {
    onSaveCallback = cb;
}

/**
 * Encrypt an API key using AES-256-GCM.
 */
function encryptKey(rawKey) {
    const key = getMasterEncryptionKey();
    const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ciphertext = cipher.update(rawKey, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return {
        ciphertext,
        iv: iv.toString('hex'),
        tag
    };
}

/**
 * Decrypt an encrypted API key record using AES-256-GCM.
 */
function decryptKey(record) {
    try {
        if (!record || !record.ciphertext || !record.iv || !record.tag) return null;
        const key = getMasterEncryptionKey();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(record.tag, 'hex'));
        let decrypted = decipher.update(record.ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        console.error('[UserKeys] Decryption error:', err.message);
        return null;
    }
}

/**
 * Save in-memory encrypted keys to local disk.
 */
function saveKeysToDisk() {
    try {
        const dir = path.dirname(KEYS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const dataObj = {};
        for (const [discordId, record] of userKeysStore.entries()) {
            dataObj[discordId] = {
                tornId: record.tornId,
                playerName: record.playerName,
                ciphertext: record.ciphertext,
                iv: record.iv,
                tag: record.tag,
                linkedAt: record.linkedAt || Date.now()
            };
        }
        fs.writeFileSync(KEYS_FILE, JSON.stringify(dataObj, null, 2), 'utf8');
        if (typeof onSaveCallback === 'function') {
            onSaveCallback();
        }
    } catch (err) {
        console.error('[UserKeys] Error saving keys to disk:', err.message);
    }
}

/**
 * Load encrypted keys from local disk.
 */
function loadKeysFromDisk() {
    try {
        if (fs.existsSync(KEYS_FILE)) {
            const raw = fs.readFileSync(KEYS_FILE, 'utf8');
            const dataObj = JSON.parse(raw);
            let count = 0;
            for (const [discordId, record] of Object.entries(dataObj)) {
                if (record && record.ciphertext && record.iv && record.tag) {
                    userKeysStore.set(discordId, record);
                    count++;
                }
            }
            console.log(`[UserKeys] Loaded ${count} secure encrypted user keys from disk.`);
        }
    } catch (err) {
        console.error('[UserKeys] Error loading keys from disk:', err.message);
    }
}

/**
 * Export encrypted keys object for MongoDB Atlas persistence.
 */
function exportEncryptedForMongo() {
    const dataObj = {};
    for (const [discordId, record] of userKeysStore.entries()) {
        dataObj[discordId] = {
            tornId: record.tornId,
            playerName: record.playerName,
            ciphertext: record.ciphertext,
            iv: record.iv,
            tag: record.tag,
            linkedAt: record.linkedAt
        };
    }
    return dataObj;
}

/**
 * Restore encrypted keys from MongoDB Atlas.
 */
function importEncryptedFromMongo(saved) {
    if (!saved || typeof saved !== 'object') return;
    let count = 0;
    for (const [discordId, record] of Object.entries(saved)) {
        if (record && record.ciphertext && record.iv && record.tag) {
            userKeysStore.set(discordId, record);
            count++;
        }
    }
    if (count > 0) {
        console.log(`[UserKeys] Restored ${count} secure encrypted user keys from MongoDB Atlas.`);
        saveKeysToDisk();
    }
}

/**
 * Configure and cache owner details (from primary API key).
 */
async function syncOwnerDetails(primaryKey, personalDiscordId = '') {
    if (!primaryKey) return;
    try {
        const res = await fetch(`${TORN_BASE}/user/?selections=profile,discord&key=${primaryKey}`, { signal: AbortSignal.timeout(6000) });
        const data = await res.json();
        if (data && !data.error && data.player_id) {
            ownerMeta.tornId = data.player_id;
            ownerMeta.playerName = data.name || 'Owen777';
            ownerMeta.discordId = data.discord?.discordID || personalDiscordId || ownerMeta.discordId;
            console.log(`[UserKeys] Owner synced: ${ownerMeta.playerName} [${ownerMeta.tornId}], Discord ID: ${ownerMeta.discordId || 'none'}`);
        }
    } catch (err) {
        console.warn(`[UserKeys] Error syncing owner details:`, err.message);
    }
}

/**
 * Validate a candidate API key with Torn API and store it securely.
 * 
 * @param {string} discordUserId 
 * @param {string} rawKey 
 * @returns {Promise<{success: boolean, error?: string, playerName?: string, playerId?: number, bars?: object}>}
 */
async function linkUserApiKey(discordUserId, rawKey) {
    if (!discordUserId) return { success: false, error: 'Missing Discord User ID.' };
    const cleanKey = String(rawKey || '').trim();
    if (!cleanKey || cleanKey.length < 16) {
        return { success: false, error: 'Invalid API key format. Torn API keys are 16 alphanumeric characters.' };
    }

    try {
        // Query profile and bars to verify permissions
        const res = await fetch(`${TORN_BASE}/user/?selections=profile,bars&key=${cleanKey}`, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();

        if (data.error) {
            const errCode = data.error.code;
            const errMsg = data.error.error || 'Unknown Torn API error';
            if (errCode === 2) return { success: false, error: 'Incorrect or invalid API key.' };
            if (errCode === 7) return { success: false, error: 'Access level too low. Key must have at least Limited Access.' };
            return { success: false, error: `Torn API error [${errCode}]: ${errMsg}` };
        }

        if (!data.player_id || !data.bars) {
            return { success: false, error: 'Key permissions insufficient. Please ensure the key has Limited Access.' };
        }

        const encrypted = encryptKey(cleanKey);
        const record = {
            tornId: data.player_id,
            playerName: data.name,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            tag: encrypted.tag,
            linkedAt: Date.now()
        };

        userKeysStore.set(String(discordUserId), record);
        saveKeysToDisk();

        console.log(`[UserKeys] Successfully encrypted and linked key for ${data.name} [${data.player_id}] (Discord ${discordUserId})`);

        return {
            success: true,
            playerName: data.name,
            playerId: data.player_id,
            bars: data.bars
        };
    } catch (err) {
        return { success: false, error: `Connection error verifying key: ${err.message}` };
    }
}

/**
 * Unlink and permanently delete a user's API key.
 */
function unlinkUserApiKey(discordUserId) {
    if (!discordUserId) return false;
    const deleted = userKeysStore.delete(String(discordUserId));
    if (deleted) {
        saveKeysToDisk();
        console.log(`[UserKeys] Unlinked and deleted key for Discord ID: ${discordUserId}`);
    }
    return deleted;
}

/**
 * Check if a user is the bot owner (Owen).
 */
function isOwnerUser(discordUserId, authorName = '', authorUsername = '', verifiedPlayerId = null) {
    const dId = String(discordUserId || '');
    if (ownerMeta.discordId && dId && dId === String(ownerMeta.discordId)) return true;
    if (verifiedPlayerId && Number(verifiedPlayerId) === Number(ownerMeta.tornId)) return true;

    const nameClean = (authorName || '').toLowerCase();
    const userClean = (authorUsername || '').toLowerCase();
    if (nameClean.includes('owen') || userClean.includes('owen')) return true;

    return false;
}

/**
 * Resolve an active API key for a user (either from their secure vault, or master owner key).
 * 
 * @param {string} discordUserId 
 * @param {string} authorName 
 * @param {string} authorUsername 
 * @param {string} primaryOwnerKey 
 * @param {number|null} verifiedPlayerId 
 * @returns {{ key: string, playerName: string, playerId: number, isOwner: boolean } | null}
 */
function resolveUserApiKey(discordUserId, authorName = '', authorUsername = '', primaryOwnerKey = '', verifiedPlayerId = null) {
    const dId = String(discordUserId || '');

    // 1. Check user's encrypted vault
    if (userKeysStore.has(dId)) {
        const record = userKeysStore.get(dId);
        const decrypted = decryptKey(record);
        if (decrypted) {
            return {
                key: decrypted,
                playerName: record.playerName,
                playerId: record.tornId,
                isOwner: false
            };
        }
    }

    // 2. Check if user is the bot owner (Owen)
    if (primaryOwnerKey && isOwnerUser(dId, authorName, authorUsername, verifiedPlayerId)) {
        return {
            key: primaryOwnerKey,
            playerName: ownerMeta.playerName || 'Owen777',
            playerId: ownerMeta.tornId || 2658824,
            isOwner: true
        };
    }

    return null;
}

/**
 * Fetch live real-time user stats from Torn API with caching.
 * 
 * @param {string} apiKey 
 * @returns {Promise<object|null>}
 */
async function fetchUserLiveStats(apiKey) {
    if (!apiKey) return null;

    const now = Date.now();
    if (userStatsCache.has(apiKey)) {
        const cached = userStatsCache.get(apiKey);
        if (now - cached.timestamp < STATS_CACHE_TTL_MS) {
            return cached.data;
        }
    }

    try {
        const url = `${TORN_BASE}/user/?selections=profile,bars,cooldowns,travel&key=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
        const raw = await res.json();

        if (raw.error || !raw.player_id) {
            return null;
        }

        const b = raw.bars || {};
        const c = raw.cooldowns || {};
        const t = raw.travel || {};
        const p = raw.status || {};

        // Parse energy
        const energyCur = b.energy?.current ?? 0;
        const energyMax = b.energy?.maximum ?? 100;
        const energyFullSec = b.energy?.fulltime ?? 0;
        const energyFullMin = Math.ceil(energyFullSec / 60);
        const isEnergyFull = energyCur >= energyMax;

        // Parse nerve
        const nerveCur = b.nerve?.current ?? 0;
        const nerveMax = b.nerve?.maximum ?? 15;
        const nerveFullSec = b.nerve?.fulltime ?? 0;
        const nerveFullMin = Math.ceil(nerveFullSec / 60);

        // Parse happy & life
        const happyCur = b.happy?.current ?? 0;
        const happyMax = b.happy?.maximum ?? 100;
        const lifeCur = b.life?.current ?? 0;
        const lifeMax = b.life?.maximum ?? 100;

        // Cooldowns
        const drugSec = c.drug ?? 0;
        const boosterSec = c.booster ?? 0;
        const medSec = c.medical ?? 0;

        // Travel
        const destination = t.destination || 'Torn';
        const travelLeftSec = t.time_left ?? 0;
        const travelLeftMin = Math.ceil(travelLeftSec / 60);
        const isTraveling = travelLeftSec > 0;

        const data = {
            playerId: raw.player_id,
            playerName: raw.name,
            energy: {
                current: energyCur,
                maximum: energyMax,
                isFull: isEnergyFull,
                fulltimeSeconds: energyFullSec,
                fulltimeMinutes: energyFullMin
            },
            nerve: {
                current: nerveCur,
                maximum: nerveMax,
                isFull: nerveCur >= nerveMax,
                fulltimeSeconds: nerveFullSec,
                fulltimeMinutes: nerveFullMin
            },
            happy: {
                current: happyCur,
                maximum: happyMax
            },
            life: {
                current: lifeCur,
                maximum: lifeMax
            },
            cooldowns: {
                drug: drugSec,
                drugMinutes: Math.ceil(drugSec / 60),
                booster: boosterSec,
                boosterMinutes: Math.ceil(boosterSec / 60),
                medical: medSec,
                medicalMinutes: Math.ceil(medSec / 60)
            },
            travel: {
                destination,
                isTraveling,
                timeLeftSeconds: travelLeftSec,
                timeLeftMinutes: travelLeftMin
            },
            status: {
                state: p.state || 'Okay',
                description: p.description || 'Okay'
            }
        };

        userStatsCache.set(apiKey, { data, timestamp: now });
        return data;
    } catch (err) {
        console.warn(`[UserKeys] Error fetching live stats:`, err.message);
        return null;
    }
}

/**
 * Detect if a user message is asking for personal account stats.
 * 
 * @param {string} text 
 * @returns {'energy'|'nerve'|'happy'|'life'|'bars'|'cooldowns'|'travel'|'hospital'|null}
 */
function detectUserAccountIntent(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.toLowerCase().trim();

    // 1. Energy / "e"
    const isEnergy = /\b(?:how\s+much|what(?:'s|\s+is)|check|show)\s+(?:my\s+)?(?:e|energy)\b/i.test(clean) ||
                     /\bmy\s+(?:e|energy)\b/i.test(clean) ||
                     /\b(?:e|energy)\s*(?:count|level|status|check)\b/i.test(clean) ||
                     /\bdo\s+i\s+have\s+(?:any|enough|full)\s+(?:e|energy)\b/i.test(clean) ||
                     /\bhow\s+(?:much|long)\s+(?:until|till)\s+(?:my\s+)?(?:e|energy)\s+(?:is\s+)?full\b/i.test(clean);
    if (isEnergy) return 'energy';

    // 2. Nerve
    const isNerve = /\b(?:how\s+much|what(?:'s|\s+is)|check|show)\s+(?:my\s+)?nerve\b/i.test(clean) ||
                    /\bmy\s+nerve\b/i.test(clean) ||
                    /\bnerve\s*(?:count|level|status|check)\b/i.test(clean);
    if (isNerve) return 'nerve';

    // 3. Happy
    const isHappy = /\b(?:how\s+much|what(?:'s|\s+is)|check|show)\s+(?:my\s+)?happy\b/i.test(clean) ||
                    /\bmy\s+happy\b/i.test(clean);
    if (isHappy) return 'happy';

    // 4. Life / Health / HP
    const isLife = /\b(?:how\s+much|what(?:'s|\s+is)|check|show)\s+(?:my\s+)?(?:life|hp|health)\b/i.test(clean) ||
                   /\bmy\s+(?:life|hp|health)\b/i.test(clean);
    if (isLife) return 'life';

    // 5. General Bars
    const isBars = /\b(?:my\s+bars|check\s+bars|show\s+(?:my\s+)?bars)\b/i.test(clean) ||
                   /\bwhat\s+are\s+my\s+bars\b/i.test(clean);
    if (isBars) return 'bars';

    // 6. Cooldowns & Xanax readiness
    const isCooldowns = /\b(?:my\s+)?cooldowns?\b/i.test(clean) ||
                        /\b(?:drug|booster|medical)\s+cooldown\b/i.test(clean) ||
                        /\bcan\s+i\s+(?:take|use|pop)\s+(?:a\s+)?(?:xan|xanax|booster|candy|edvd|feathery)\b/i.test(clean) ||
                        /\bwhen\s+can\s+i\s+(?:take|use|pop)\s+(?:a\s+)?(?:xan|xanax|booster)\b/i.test(clean);
    if (isCooldowns) return 'cooldowns';

    // 7. Travel status
    const isTravel = /\b(?:where\s+am\s+i|am\s+i\s+(?:flying|traveling|abroad|in\s+torn)|my\s+travel|flight\s+time|when\s+do\s+i\s+land)\b/i.test(clean);
    if (isTravel) return 'travel';

    // 8. Hospital status
    const isHospital = /\b(?:am\s+i\s+in\s+hosp(?:ital)?|how\s+long\s+am\s+i\s+in\s+hosp(?:ital)?|my\s+status)\b/i.test(clean);
    if (isHospital) return 'hospital';

    return null;
}

/**
 * Format a deterministic witty response if Gemini is offline or slow.
 */
function formatDeterministicStatsReply(stats, invokerName, intent) {
    if (!stats) return `⚠️ I couldn't reach the Torn satellite for your stats right now, ${invokerName}. Try again in a second.`;

    if (intent === 'energy') {
        if (stats.energy.isFull) {
            return `⚡ You're sitting on a full **${stats.energy.current}/${stats.energy.maximum}** energy, ${invokerName}. Go burn it before you waste natural regen.`;
        }
        return `⚡ You're at **${stats.energy.current}/${stats.energy.maximum}** energy, ${invokerName}. It'll be completely full in about ${stats.energy.fulltimeMinutes} minutes.`;
    }

    if (intent === 'nerve') {
        if (stats.nerve.isFull) {
            return `💉 You have full **${stats.nerve.current}/${stats.nerve.maximum}** nerve, ${invokerName}. Faction OC or crimes await.`;
        }
        return `💉 You currently have **${stats.nerve.current}/${stats.nerve.maximum}** nerve, ${invokerName} (full in ~${stats.nerve.fulltimeMinutes}m).`;
    }

    if (intent === 'cooldowns') {
        const drug = stats.cooldowns.drug > 0 ? `💊 Drug: **${stats.cooldowns.drugMinutes}m**` : `💊 Drug: **Ready**`;
        const booster = stats.cooldowns.booster > 0 ? `🍬 Booster: **${stats.cooldowns.boosterMinutes}m**` : `🍬 Booster: **Ready**`;
        const med = stats.cooldowns.medical > 0 ? `💉 Med: **${stats.cooldowns.medicalMinutes}m**` : `💉 Med: **Ready**`;
        return `⏱️ **Cooldowns for ${invokerName}:** ${drug} | ${booster} | ${med}`;
    }

    if (intent === 'travel') {
        if (stats.travel.isTraveling) {
            return `✈️ You're in flight to **${stats.travel.destination}**, ${invokerName}. Landing in about **${stats.travel.timeLeftMinutes}** minutes. Watch out for muggers.`;
        }
        return `📍 You're currently grounded in **${stats.travel.destination}**, ${invokerName}.`;
    }

    // Default / All Bars
    return `📊 **Status for ${invokerName}:** ⚡ Energy: **${stats.energy.current}/${stats.energy.maximum}** | 💉 Nerve: **${stats.nerve.current}/${stats.nerve.maximum}** | 😊 Happy: **${stats.happy.current}** | ❤️ Life: **${stats.life.current}/${stats.life.maximum}**`;
}

// Initialize on require
loadKeysFromDisk();

module.exports = {
    encryptKey,
    decryptKey,
    linkUserApiKey,
    unlinkUserApiKey,
    resolveUserApiKey,
    fetchUserLiveStats,
    detectUserAccountIntent,
    formatDeterministicStatsReply,
    syncOwnerDetails,
    exportEncryptedForMongo,
    importEncryptedFromMongo,
    setMongoSaveCallback,
    userKeysStore
};
