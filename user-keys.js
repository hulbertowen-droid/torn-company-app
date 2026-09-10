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
    tornId: 3776908, // Owen777's verified Torn ID
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
    const cleanKey = String(rawKey || '').trim().replace(/['"\s]/g, '');
    if (!cleanKey || cleanKey.length < 16) {
        return { success: false, error: 'Invalid API key format. Torn API keys are 16 alphanumeric characters.' };
    }

    try {
        // Query profile and bars to verify permissions
        // NOTE: Torn API v1 returns energy/nerve/happy/life at the TOP level, not inside data.bars
        const res = await fetch(`${TORN_BASE}/user/?selections=profile,bars&key=${cleanKey}`, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();

        if (data.error) {
            const errCode = data.error.code;
            const errMsg = data.error.error || 'Unknown Torn API error';
            if (errCode === 2) return { success: false, error: 'Incorrect or invalid API key.' };
            if (errCode === 7) return { success: false, error: 'Access level too low. Key must have at least Limited Access.' };
            return { success: false, error: `Torn API error [${errCode}]: ${errMsg}` };
        }

        if (!data.player_id || !data.energy) {
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

        // Build bars object from top-level fields for display after linking
        const bars = {
            energy: data.energy,
            nerve: data.nerve,
            happy: data.happy,
            life: data.life
        };

        return {
            success: true,
            playerName: data.name,
            playerId: data.player_id,
            bars
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

    const nameClean = (authorName || '').toLowerCase().trim();
    const userClean = (authorUsername || '').toLowerCase().trim();
    if (nameClean === 'owen777' || userClean === 'owen777' || nameClean === 'owen' || userClean === 'owen') return true;

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
 * Supports all user selections: profile, bars, cooldowns, travel, merits, perks,
 * battlestats, workstats, money, refills, education, personalstats, crimes, inventory.
 * 
 * @param {string} apiKey 
 * @param {string} userQuery
 * @returns {Promise<object|null>}
 */
async function fetchUserLiveStats(apiKey, userQuery = "") {
    if (!apiKey) return null;

    const queryLower = (userQuery || "").toLowerCase();
    const needsPersonalStats = /\b(?:personal\s*stats?|xanax|drugs?|overdose|od\b|attack|defend|revive|bount|jail|dump|travel\s*count)\b/i.test(queryLower);
    const needsCrimes = /\b(?:crimes?|criminal\s*record|offences?)\b/i.test(queryLower);
    const needsInventory = /\b(?:inventory|weapons?|armou?r|items?|gear)\b/i.test(queryLower);
    const needsProperties = /\b(?:properties|property|private\s*island|pi\b)\b/i.test(queryLower);
    const needsAttacks = /\b(?:who\s*attacked|recent\s*attacks?|last\s*fight)\b/i.test(queryLower);

    let selections = 'profile,bars,cooldowns,travel,merits,perks,battlestats,workstats,money,refills,education';
    if (needsPersonalStats) selections += ',personalstats';
    if (needsCrimes) selections += ',crimes';
    if (needsInventory) selections += ',inventory';
    if (needsProperties) selections += ',properties';
    if (needsAttacks) selections += ',attacks';

    const cacheKey = `${apiKey}_${selections}`;
    const now = Date.now();
    if (userStatsCache.has(cacheKey)) {
        const cached = userStatsCache.get(cacheKey);
        if (now - cached.timestamp < STATS_CACHE_TTL_MS) {
            return cached.data;
        }
    }

    try {
        const url = `${TORN_BASE}/user/?selections=${selections}&key=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const raw = await res.json();

        if (raw.error || !raw.player_id) {
            console.warn(`[UserKeys] Error fetching live stats:`, raw.error);
            return null;
        }

        // Parse energy, nerve, happy, life, cooldowns, travel, status
        const e = raw.energy || {};
        const n = raw.nerve || {};
        const h = raw.happy || {};
        const lf = raw.life || {};
        const c = raw.cooldowns || {};
        const t = raw.travel || {};
        const p = raw.status || {};

        const energyCur = e.current ?? 0;
        const energyMax = e.maximum ?? 100;
        const energyFullSec = e.fulltime ?? 0;
        const energyFullMin = Math.ceil(energyFullSec / 60);
        const isEnergyFull = energyFullSec === 0 && energyCur >= energyMax;

        const nerveCur = n.current ?? 0;
        const nerveMax = n.maximum ?? 15;
        const nerveFullSec = n.fulltime ?? 0;
        const nerveFullMin = Math.ceil(nerveFullSec / 60);

        const happyCur = h.current ?? 0;
        const happyMax = h.maximum ?? 100;
        const lifeCur = lf.current ?? 0;
        const lifeMax = lf.maximum ?? 100;

        const drugSec = c.drug ?? 0;
        const boosterSec = c.booster ?? 0;
        const medSec = c.medical ?? 0;

        const destination = t.destination || 'Torn';
        const travelLeftSec = t.time_left ?? 0;
        const travelLeftMin = Math.ceil(travelLeftSec / 60);
        const isTraveling = travelLeftSec > 0;

        const data = {
            playerId: raw.player_id,
            playerName: raw.name,
            level: raw.level ?? 1,
            rank: raw.rank || '',
            age: raw.age ?? 0,
            gender: raw.gender || '',
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
            },
            merits: raw.merits || {},
            battlestats: {
                strength: raw.strength ?? 0,
                defense: raw.defense ?? 0,
                speed: raw.speed ?? 0,
                dexterity: raw.dexterity ?? 0,
                total: raw.total ?? 0,
                modifiers: {
                    strength: raw.strength_modifier ?? 0,
                    defense: raw.defense_modifier ?? 0,
                    speed: raw.speed_modifier ?? 0,
                    dexterity: raw.dexterity_modifier ?? 0
                }
            },
            workstats: {
                manual_labor: raw.manual_labor ?? 0,
                intelligence: raw.intelligence ?? 0,
                endurance: raw.endurance ?? 0
            },
            money: {
                money_onhand: raw.money_onhand ?? 0,
                vault_amount: raw.vault_amount ?? 0,
                points: raw.points ?? 0,
                cayman_bank: raw.cayman_bank ?? 0,
                city_bank: raw.city_bank?.amount ?? 0,
                daily_networth: raw.daily_networth ?? 0
            },
            refills: {
                energy_refill_used: !!raw.refills?.energy_refill_used,
                nerve_refill_used: !!raw.refills?.nerve_refill_used,
                token_refill_used: !!raw.refills?.token_refill_used,
                special_refills_available: raw.refills?.special_refills_available ?? 0
            },
            education: {
                current_course: raw.education_current || 0,
                time_left_seconds: raw.education_timeleft || 0,
                time_left_formatted: raw.education_timeleft > 0 ? `${Math.ceil(raw.education_timeleft / 86400)} days (${Math.ceil(raw.education_timeleft / 3600)}h)` : 'None / Completed',
                completed_courses: Array.isArray(raw.education_completed) ? raw.education_completed.length : 0
            },
            job: {
                title: raw.job?.job || 'None',
                position: raw.job?.position || 'None',
                company_name: raw.job?.company_name || 'None',
                company_id: raw.job?.company_id || 0,
                company_type: raw.job?.company_type || 0
            },
            faction: {
                name: raw.faction?.faction_name || 'None',
                id: raw.faction?.faction_id || 0,
                position: raw.faction?.position || 'Member',
                days_in_faction: raw.faction?.days_in_faction || 0
            },
            perks: {
                faction_perks: raw.faction_perks || [],
                job_perks: raw.job_perks || [],
                property_perks: raw.property_perks || [],
                education_perks: raw.education_perks || [],
                merit_perks: raw.merit_perks || [],
                book_perks: raw.book_perks || []
            },
            personalstats: raw.personalstats || null,
            crimes: raw.criminalrecord || null,
            inventory: raw.inventory || null,
            properties: raw.properties || null,
            attacks: raw.attacks || null
        };

        userStatsCache.set(cacheKey, { data, timestamp: now });
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
 * @returns {'merits'|'battlestats'|'workstats'|'money'|'refills'|'education'|'job'|'personalstats'|'crimes'|'energy'|'nerve'|'happy'|'life'|'bars'|'cooldowns'|'travel'|'hospital'|'jump'|'general_account'|null}
 */
function detectUserAccountIntent(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.toLowerCase().trim();

    // 1. Merits (e.g. "how many merits do i have into hospitalization", "my merits")
    if (/\b(?:merits?|merit\s+points?|hospitali[zs]ing|hospitali[zs]ation|life\s+points|crit(?:ical\s+hit)?|education\s+length|awareness|bank\s+interest|looting|stealth|addiction\s+mitigation|employee\s+effectiveness|brawn|protection|sharpness|evasion|heavy\s+artillery|machine\s+gun|rifle|smg|shotgun|pistol|club|piercing|slashing|mechanical|temporary)\b/i.test(clean)) {
        return 'merits';
    }

    // 2. Work Stats (e.g. "my work stats", "manual labor", "intelligence", "endurance")
    if (/\b(?:work\s*stats?|working\s*stats?|manual\s*labor|intelligence|endurance)\b/i.test(clean)) {
        return 'workstats';
    }

    // 3. Personal stats / Lifetime records (xanax, overdoses, hits)
    if (/\b(?:personal\s*stats?|(?:xanax|drugs?)\s*(?:taken|count|total|stat)|(?:how\s+many|how\s+much)\s+(?:xanax|drugs|overdoses?|ods?|revives?|attacks?|defends?|dump\s*finds?)|xanax\b.*taken|overdosed?|ods?\b|attacks?\s*won|defends?\s*won|defends?\s*lost|revives?|bounties|jail\s*count|hosp\s*visits?|dump\s*finds?)\b/i.test(clean)) {
        return 'personalstats';
    }

    // 4. Battle Stats (e.g. "my strength", "battle stats", "what is my speed", "my dex", "my def")
    if (/\b(?:battle\s*stats?|stats?|strength|speed|dexterity|dex\b|defense|def\b|bsd|combat\s*stats?|total\s*stats?)\b/i.test(clean)) {
        return 'battlestats';
    }

    // 5. Money & Vault
    if (/\b(?:money|cash|wallet|vault|cayman|points|networth|wealth|funds|on\s*hand)\b/i.test(clean)) {
        return 'money';
    }

    // 6. Refills
    if (/\b(?:refills?|energy\s*refill|nerve\s*refill|token\s*refill|did\s*i\s*refill|can\s*i\s*refill)\b/i.test(clean)) {
        return 'refills';
    }

    // 7. Education
    if (/\b(?:education|course|class|studying|degree|uni|college)\b/i.test(clean)) {
        return 'education';
    }

    // 8. Job & Company
    if (/\b(?:job|position|company|salary|employee|director)\b/i.test(clean)) {
        return 'job';
    }

    // 9. Crimes
    if (/\b(?:crimes?|criminal\s*record|natural\s*nerve|cpr|crimes\s*2\.0)\b/i.test(clean)) {
        return 'crimes';
    }

    // 10. Energy / "e"
    const isEnergy = /\b(?:how\s+much|what(?:'s|\s+is)|check|show)\s+(?:my\s+)?(?:e|energy)\b/i.test(clean) ||
                     /\bmy\s+(?:e|energy)\b/i.test(clean) ||
                     /\b(?:e|energy)\s*(?:count|level|status|check)\b/i.test(clean) ||
                     /\bdo\s+i\s+have\s+(?:any|enough|full)\s+(?:e|energy)\b/i.test(clean) ||
                     /\bhow\s+(?:much|long)\s+(?:until|till)\s+(?:my\s+)?(?:e|energy)\s+(?:is\s+)?full\b/i.test(clean);
    if (isEnergy) return 'energy';

    // 11. Nerve
    const isNerve = /\b(?:how\s+much|what(?:'s|\s+is)|check|show)\s+(?:my\s+)?nerve\b/i.test(clean) ||
                    /\bmy\s+nerve\b/i.test(clean) ||
                    /\bnerve\s*(?:count|level|status|check)\b/i.test(clean);
    if (isNerve) return 'nerve';

    // 12. Happy
    const isHappy = /\b(?:how\s+much|what(?:'s|\s+is)|check|show)\s+(?:my\s+)?happy\b/i.test(clean) ||
                    /\bmy\s+happy\b/i.test(clean);
    if (isHappy) return 'happy';

    // 13. Life / Health / HP
    const isLife = /\b(?:how\s+much|what(?:'s|\s+is)|check|show)\s+(?:my\s+)?(?:life|hp|health)\b/i.test(clean) ||
                   /\bmy\s+(?:life|hp|health)\b/i.test(clean);
    if (isLife) return 'life';

    // 14. General Bars
    const isBars = /\b(?:my\s+bars|check\s+bars|show\s+(?:my\s+)?bars)\b/i.test(clean) ||
                   /\bwhat\s+are\s+my\s+bars\b/i.test(clean);
    if (isBars) return 'bars';

    // 15. Cooldowns & Xanax readiness
    const isCooldowns = /\b(?:my\s+)?cooldowns?\b/i.test(clean) ||
                        /\b(?:drug|booster|medical)\s+cooldown\b/i.test(clean) ||
                        /\bcan\s+i\s+(?:take|use|pop)\s+(?:a\s+)?(?:xan|xanax|booster|candy|edvd|feathery)\b/i.test(clean) ||
                        /\bwhen\s+can\s+i\s+(?:take|use|pop)\s+(?:a\s+)?(?:xan|xanax|booster)\b/i.test(clean);
    if (isCooldowns) return 'cooldowns';

    // 16. Travel status
    const isTravel = /\b(?:where\s+am\s+i|am\s+i\s+(?:flying|traveling|abroad|in\s+torn)|my\s+travel|flight\s+time|when\s+do\s+i\s+land)\b/i.test(clean);
    if (isTravel) return 'travel';

    // 17. Hospital status
    const isHospital = /\b(?:am\s+i\s+in\s+hosp(?:ital)?|how\s+long\s+am\s+i\s+in\s+hosp(?:ital)?|my\s+status)\b/i.test(clean);
    if (isHospital) return 'hospital';

    // 18. Happy Jumps & Candies
    const isJump = /\b(?:happy\s+jump|candy\s+jump|choco\s+jump|edvd\s+jump|jumping|jump)\b/i.test(clean) ||
                   (/\b(?:how\s+many|can\s+i|should\s+i)\b/i.test(clean) && /\b(?:candies|candy|truffles?|tootsies?|edvds?|jawbreakers?)\b/i.test(clean));
    if (isJump) return 'jump';

    // 19. Broad personal inquiry (e.g. "what do i have", "check my account", "tell me about my character")
    if (/\b(?:my|i|me|mine)\b/i.test(clean) && /\b(?:have|got|check|show|tell|what|how\s*many|how\s*much|status|info|am\s*i)\b/i.test(clean)) {
        return 'general_account';
    }

    return null;
}

/**
 * Format a deterministic witty response if Gemini is offline or slow.
 */
function formatDeterministicStatsReply(stats, invokerName, intent, rawQuery = "") {
    if (!stats) return `⚠️ I couldn't reach the Torn satellite for your stats right now, ${invokerName}. Try again in a second.`;

    const queryLower = (rawQuery || "").toLowerCase();

    // 1. Merits
    if (intent === 'merits' || /\bmerits?\b/i.test(queryLower)) {
        const meritsObj = stats.merits || {};
        const entries = Object.entries(meritsObj);

        // Check if query targets a specific merit
        let matchedMerit = null;
        if (/\bhosp/i.test(queryLower)) matchedMerit = entries.find(([k]) => /hosp/i.test(k));
        else if (/\bcrit/i.test(queryLower)) matchedMerit = entries.find(([k]) => /crit/i.test(k));
        else if (/\blife/i.test(queryLower)) matchedMerit = entries.find(([k]) => /life/i.test(k));
        else if (/\bnerve/i.test(queryLower)) matchedMerit = entries.find(([k]) => /nerve/i.test(k));
        else if (/\beducation/i.test(queryLower)) matchedMerit = entries.find(([k]) => /education/i.test(k));
        else if (/\bbank/i.test(queryLower)) matchedMerit = entries.find(([k]) => /bank/i.test(k));
        else if (/\bloot/i.test(queryLower)) matchedMerit = entries.find(([k]) => /loot/i.test(k));
        else if (/\bstealth/i.test(queryLower)) matchedMerit = entries.find(([k]) => /stealth/i.test(k));
        else if (/\baddict/i.test(queryLower)) matchedMerit = entries.find(([k]) => /addict/i.test(k));
        else if (/\bemploy/i.test(queryLower)) matchedMerit = entries.find(([k]) => /employ/i.test(k));
        else if (/\bbrawn/i.test(queryLower)) matchedMerit = entries.find(([k]) => /brawn/i.test(k));
        else if (/\bprotect/i.test(queryLower)) matchedMerit = entries.find(([k]) => /protect/i.test(k));
        else if (/\bsharp/i.test(queryLower)) matchedMerit = entries.find(([k]) => /sharp/i.test(k));
        else if (/\bevas/i.test(queryLower)) matchedMerit = entries.find(([k]) => /evas/i.test(k));

        if (matchedMerit) {
            const [name, level] = matchedMerit;
            return `🏅 You currently have **${level}** merit${level === 1 ? '' : 's'} invested in **${name}**, ${invokerName}.`;
        }

        // List non-zero merits
        const activeMerits = entries.filter(([, v]) => v > 0).map(([k, v]) => `${k}: **${v}**`);
        if (activeMerits.length > 0) {
            return `🏅 **Merits for ${invokerName}:** ${activeMerits.slice(0, 10).join(' | ')}${activeMerits.length > 10 ? ` *(+${activeMerits.length - 10} more)*` : ''}`;
        }
        return `🏅 You don't have any merit upgrades allocated yet, ${invokerName}.`;
    }

    // 2. Battle Stats
    if (intent === 'battlestats') {
        const bs = stats.battlestats || {};
        return `⚔️ **Battle Stats for ${invokerName}:** Strength: **${(bs.strength || 0).toLocaleString()}** | Defense: **${(bs.defense || 0).toLocaleString()}** | Speed: **${(bs.speed || 0).toLocaleString()}** | Dexterity: **${(bs.dexterity || 0).toLocaleString()}** | Total: **${(bs.total || 0).toLocaleString()}**`;
    }

    // 3. Work Stats
    if (intent === 'workstats') {
        const ws = stats.workstats || {};
        const job = stats.job || {};
        return `💼 **Work Stats for ${invokerName}:** Manual Labor: **${(ws.manual_labor || 0).toLocaleString()}** | Intelligence: **${(ws.intelligence || 0).toLocaleString()}** | Endurance: **${(ws.endurance || 0).toLocaleString()}** (${job.position || 'Working'} at ${job.company_name || 'Torn Company'})`;
    }

    // 4. Money & Vault
    if (intent === 'money') {
        const m = stats.money || {};
        return `💰 **Finances for ${invokerName}:** Cash on Hand: **$${(m.money_onhand || 0).toLocaleString()}** | Vault: **$${(m.vault_amount || 0).toLocaleString()}** | Points: **${(m.points || 0).toLocaleString()}**`;
    }

    // 5. Refills
    if (intent === 'refills') {
        const r = stats.refills || {};
        const eRefill = r.energy_refill_used ? 'Already Used' : 'Available / Ready';
        const nRefill = r.nerve_refill_used ? 'Already Used' : 'Available / Ready';
        return `🔄 **Refills for ${invokerName}:** Energy Refill: **${eRefill}** | Nerve Refill: **${nRefill}**`;
    }

    // 6. Education
    if (intent === 'education') {
        const ed = stats.education || {};
        if (ed.current_course > 0) {
            return `🎓 **Education for ${invokerName}:** Course #${ed.current_course} in progress (${ed.time_left_formatted} remaining). Completed ${ed.completed_courses} courses.`;
        }
        return `🎓 **Education for ${invokerName}:** No course actively in progress. You've completed ${ed.completed_courses} courses.`;
    }

    // 7. Job
    if (intent === 'job') {
        const job = stats.job || {};
        return `🏢 **Employment for ${invokerName}:** ${job.position || 'Employee'} at **${job.company_name || 'Torn Company'}** (${job.title || 'Staff'}).`;
    }

    // 8. Personal Stats (Xanax, Overdoses, Attacks)
    if (intent === 'personalstats') {
        const ps = stats.personalstats || {};
        return `📊 **Lifetime Stats for ${invokerName}:** Xanax Taken: **${ps.xantaken || 0}** | Overdoses: **${ps.overdosed || 0}** | Attacks Won: **${(ps.attackswon || 0).toLocaleString()}** | Defends Won: **${(ps.defendswon || 0).toLocaleString()}**`;
    }

    if (intent === 'jump') {
        try {
            const tornKnowledge = require('./torn-knowledge');
            return tornKnowledge.formatDeterministicTornAnswer(rawQuery || 'happy jump', stats, invokerName);
        } catch(e) {}
    }

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
