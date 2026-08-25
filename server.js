const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Hardcoded MongoDB URI to bypass Render settings
process.env.MONGODB_URI = "mongodb+srv://WarBoard:WarBoardPass123@cluster0.iwnnnj3.mongodb.net/?appName=Cluster0";


const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
    _id: { type: String, default: 'master' },
    discordConfig: Object,
    companyConfig: Object,
    ocConfig: Object,
    marketConfig: Object,
    spyDatabase: Object,
    userTracking: Object,
    apiPoolConfig: Object,
    updatedAt: { type: Date, default: Date.now },
}, { strict: false });
const AppConfig = mongoose.model('AppConfig', configSchema, 'app_configs');

global.mongoConnectionError = null;
if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(async () => {
            console.log("Connected to MongoDB Atlas");
            await loadConfigFromMongo();
            await syncRecruitsToPlayers();
        })
        .catch(err => {
            console.log("MongoDB connection error:", err);
            global.mongoConnectionError = err.message || err.toString();
        });
}

const recruitSchema = new mongoose.Schema({
    id: { type: Number, unique: true },
    name: String,
    level: Number,
    donator: mongoose.Schema.Types.Mixed,
    last_action: Object,
    personalstats: Object,
    playtime: Number,
    xanax: Number,
    refills: Number,
    se: Number,
    estStats: mongoose.Schema.Types.Mixed,
    progIndex: Number
}, { strict: false });
const Recruit = mongoose.model('Recruit', recruitSchema);

async function loadConfigFromMongo() {
    try {
        const saved = await AppConfig.findById('master').lean();
        if (saved) {
            if (saved.discordConfig) discordConfig = { ...discordConfig, ...saved.discordConfig };
            if (saved.companyConfig) companyConfig = { ...companyConfig, ...saved.companyConfig };
            if (saved.ocConfig) ocConfig = { ...ocConfig, ...saved.ocConfig };
            if (saved.marketConfig) marketConfig = { ...marketConfig, ...saved.marketConfig };
            if (saved.spyDatabase) spyDatabase = { ...spyDatabase, ...saved.spyDatabase };
            if (saved.userTracking) userTracking = { ...userTracking, ...saved.userTracking };
            if (saved.apiPoolConfig) apiPoolConfig = { ...apiPoolConfig, ...saved.apiPoolConfig };
            console.log('[Mongo] Restored master configurations from MongoDB Atlas.');
            
            if (discordConfig.apiKey) {
                try {
                    const { addKey } = require('./recruit/lib/apiKeyPool');
                    addKey(discordConfig.apiKey, discordConfig.factionId || 0, null);
                } catch(e) {}
            }
        }
    } catch(e) {
        console.error('[Mongo] Config load error:', e.message);
    }
}

async function syncRecruitsToPlayers() {
    try {
        const Player = require('./recruit/db/models/Player');
        
        // 1. Purge dead / junk / sluggish accounts from the Player database
        await Player.deleteMany({
            $or: [
                { status: { $in: ['Fallen', 'Federal', 'Deleted'] } },
                { lastActionTs: { $lt: new Date(Date.now() - 7 * 86_400_000) } },
                { daysInTorn: { $gt: 30 }, level: { $lt: 10 } },
                { daysInTorn: { $gt: 90 }, level: { $lt: 15 } },
                { daysInTorn: { $gt: 365 }, level: { $lt: 25 } },
                { daysInTorn: { $gt: 730 }, level: { $lt: 35 } },
            ]
        }).catch(() => {});

        // 2. Filter and sync quality recruits into Player search pool
        const recruits = await Recruit.find({}).lean();
        if (recruits.length > 0) {
            const qualityRecruits = recruits.filter(r => {
                const state = r.status || 'Okay';
                if (state === 'Fallen' || state === 'Federal' || state === 'Deleted') return false;
                
                const lastActionTs = r.last_action?.timestamp
                    ? new Date(r.last_action.timestamp * 1000)
                    : new Date();
                const hoursSinceLast = (Date.now() - lastActionTs.getTime()) / 3_600_000;
                if (hoursSinceLast > 168) return false; // Inactive > 7 days

                const age = r.age || 1;
                const lvl = r.level || 1;

                // Discard low progression sluggish accounts (e.g. 500 days old lvl 5)
                if (age > 30 && lvl < 10) return false;
                if (age > 90 && lvl < 15) return false;
                if (age > 365 && lvl < 25) return false;
                if (age > 730 && lvl < 35) return false;

                return true;
            });

            if (qualityRecruits.length > 0) {
                const ops = qualityRecruits.map(r => {
                    const lastActionTs = r.last_action?.timestamp
                        ? new Date(r.last_action.timestamp * 1000)
                        : new Date();
                    const daysInTorn = r.age || 0;
                    const level = r.level || 1;
                    const progressionRate = daysInTorn > 0 ? parseFloat((level / daysInTorn).toFixed(3)) : 0;
                    
                    return {
                        updateOne: {
                            filter: { _id: r.id },
                            update: {
                                $set: {
                                    _id: r.id,
                                    name: r.name || '',
                                    level,
                                    factionId: 0,
                                    factionName: '',
                                    status: 'Okay',
                                    lastActionTs,
                                    lastActionRelative: r.last_action?.relative || '',
                                    donator: !!r.donator,
                                    daysInTorn,
                                    progressionRate,
                                    refreshedAt: new Date(),
                                    nextRefreshAt: new Date(Date.now() + 60 * 60_000),
                                }
                            },
                            upsert: true
                        }
                    };
                });
                await Player.bulkWrite(ops, { ordered: false });
                console.log(`[RecruitSync] Synced ${qualityRecruits.length} quality recruits into Player search pool.`);
            }
        }
    } catch(e) {
        console.error('[RecruitSync] Error syncing recruits to players:', e.message);
    }
}


const app = express();
global.isTurboMining = false;
global.turboInterval = null;
global.turboTimeout = null;
global.turboStats = { found: 0, checked: 0 };
app.use(cors());
app.use(express.json());

app.get('/recruitment.html', (req, res) => {
    res.redirect(301, '/recruit/');
});

app.use(express.static('public', {
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
})); 

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";
const ADMIN_DISCORD_WEBHOOK = process.env.ADMIN_DISCORD_WEBHOOK || "";
let adminFactionId = null; 



// Local Databases & Caches
let claims = {};
let backups = {}; 
let statsCache = {}; 
let manualStats = {}; 
let flightCache = {}; 
let activityCache = {};
let warScrapeCache = {};
let warScrapeCache_v2 = {}; 

let spyDatabase = {}; 
let subCache = {}; 

let userTracking = {}; 
let discordIdCache = {}; 
let apiPoolConfig = { keys: [] }; 

let statQueue = new Map();
let flightQueue = new Map();
let activityQueue = new Map();

let isProcessingStats = false;
let isProcessingFlights = false;
let isProcessingActivity = false;

let activeKeyIndex = 0;

let liveWarHits = {};
let liveOutsideHits = {};
let liveAssists = {};
let liveWarDefendsWon = {};
let liveOutsideDefendsWon = {};
let liveWarHitsTaken = {};
let liveOutsideHitsTaken = {};
let activeWarId = null;
let activeWarEnd = null;
let isBackfillingWar = false;
let hasBackfilledWar = false;
let processedAttackIds = new Set();
let lastGoodWarboardPayload = null;
let warSyncStatus = { isSyncing: false, percent: 100, totalHitsLoaded: 0, page: 0, message: "Ready" };
let friendlyHitTracker = {};
let travelAlerts = {};
let currentEnemyFacId = null;
let globalTornCache = {};
let enemyMembersCache = {};
let lastEnemyScrape = 0;

const BONUS_THRESHOLDS = new Set([10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]);

const playerNameCache = {};
function getPlayerName(id, fallback = null) {
    if (!id) return fallback || "Unknown";
    const sId = id.toString();
    if (playerNameCache[sId]) return playerNameCache[sId];
    if (spyDatabase[sId]?.name) {
        playerNameCache[sId] = spyDatabase[sId].name;
        return playerNameCache[sId];
    }
    if (statsCache[sId]?.name) {
        playerNameCache[sId] = statsCache[sId].name;
        return playerNameCache[sId];
    }
    return fallback || `Player #${sId}`;
}

let dynamicFactionId = null; 
let lastEventTimestamp = Math.floor(Date.now() / 1000);

let lastChainTimeoutAlertState = false;
let backgroundEnemyTrackingState = {};

let discordConfig = { 
    globalChannelId: "", 
    globalBotToken: "",
    personalDiscordId: "",
    guildId: "",
    targetOnline: false, 
    targetLanded: true, 
    targetOutHosp: false, 
    chainUnder90: true, 
    chainMilestone: true, 
    friendlyAttacked: false, 
    medOutSniper: true,
    travelWarnings: true,
    chainWarnings: true,
    apiKey: "", 
    factionId: "" 
};
let marketConfig = { globalChannelId: "", autoDefense: false, sniperTargets: [] };
let marketMemory = { defense: {}, sniper: {} };
let ocConfig = { globalChannelId: "", roleId: "" };
let ocMemory = {};
 
let companyConfig = { globalChannelId: "", threshold: 0, alertedItems: {}, apiKey: "" };

try { if (fs.existsSync('subscriptions.json')) subscriptions = JSON.parse(fs.readFileSync('subscriptions.json')); } catch (e) {}
try { if (fs.existsSync('discord_config.json')) discordConfig = { ...discordConfig, ...JSON.parse(fs.readFileSync('discord_config.json')) }; } catch(e) {}
try { if (fs.existsSync('market_config.json')) marketConfig = { ...marketConfig, ...JSON.parse(fs.readFileSync('market_config.json')) }; } catch(e) {}
try { if (fs.existsSync('oc_config.json')) ocConfig = { ...ocConfig, ...JSON.parse(fs.readFileSync('oc_config.json')) }; } catch(e) {}

try { if (fs.existsSync('spy_db.json')) spyDatabase = JSON.parse(fs.readFileSync('spy_db.json')); } catch(e) {}
try { if (fs.existsSync('user_tracking.json')) userTracking = JSON.parse(fs.readFileSync('user_tracking.json')); } catch(e) {}
try { if (fs.existsSync('api_pool.json')) apiPoolConfig = JSON.parse(fs.readFileSync('api_pool.json')); } catch(e) {}
try { if (fs.existsSync('company_config.json')) companyConfig = { ...companyConfig, ...JSON.parse(fs.readFileSync('company_config.json')) }; } catch(e) {}

function saveToMongo() {
    if (mongoose.connection.readyState === 1) {
        AppConfig.updateOne(
            { _id: 'master' },
            {
                $set: {
                    discordConfig,
                    companyConfig,
                    ocConfig,
                    marketConfig,
                    spyDatabase,
                    userTracking,
                    apiPoolConfig,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        ).catch(e => console.error('[Mongo] Config save error:', e.message));
    }
}

function saveDiscordConfig() { fs.writeFileSync('discord_config.json', JSON.stringify(discordConfig)); saveToMongo(); }
function saveMarketConfig() { fs.writeFileSync('market_config.json', JSON.stringify(marketConfig)); saveToMongo(); }
function saveOcConfig() { fs.writeFileSync('oc_config.json', JSON.stringify(ocConfig)); saveToMongo(); }

function saveSpyDb() { fs.writeFileSync('spy_db.json', JSON.stringify(spyDatabase)); saveToMongo(); }
function saveTracking() { fs.writeFileSync('user_tracking.json', JSON.stringify(userTracking)); saveToMongo(); }
function saveApiPool() { fs.writeFileSync('api_pool.json', JSON.stringify(apiPoolConfig)); saveToMongo(); }
function saveCompanyConfig() { fs.writeFileSync('company_config.json', JSON.stringify(companyConfig)); saveToMongo(); }

// --- CENTRALIZED DISCORD RATE-LIMIT QUEUE ---
let discordSendQueue = [];
let isProcessingDiscordQueue = false;
let lastDiscordSendTime = 0;

async function sendChannelMessage(token, channelId, embed, content = "", priority = false) {
    if (!token && !channelId) return { success: false, error: "Missing Discord Bot Token or Channel ID / Webhook URL." };

    return new Promise((resolve) => {
        const item = { token, channelId, embed, content, resolve, addedAt: Date.now() };
        if (priority) {
            discordSendQueue.unshift(item); // jump to front
        } else {
            discordSendQueue.push(item);
        }
        processDiscordQueue();
    });
}

async function processDiscordQueue() {
    if (isProcessingDiscordQueue) return;
    isProcessingDiscordQueue = true;

    while (discordSendQueue.length > 0) {
        // Enforce minimum 1200ms between sends to stay within Discord rate limits
        const elapsed = Date.now() - lastDiscordSendTime;
        if (elapsed < 1200) {
            await new Promise(r => setTimeout(r, 1200 - elapsed));
        }

        const item = discordSendQueue.shift();
        try {
            const result = await executeDiscordSend(item.token, item.channelId, item.embed, item.content);
            item.resolve(result);
        } catch (e) {
            item.resolve({ success: false, error: e.message });
        }
        lastDiscordSendTime = Date.now();
    }

    isProcessingDiscordQueue = false;
}

// Track global Discord rate limit (when the whole bot token is blocked)
let discordGlobalRateLimitUntil = 0;
const DISCORD_GLOBAL_BLOCK_CAP_MS = 30000; // max 30s self-block; Discord enforces the rest server-side

function formatEmbedAsMarkdown(embed, ping = "") {
    if (!embed) return ping || "";
    let lines = [];
    if (ping && ping.trim()) lines.push(ping.trim());
    if (embed.title) lines.push(`**${embed.title}**`);
    if (embed.description) lines.push(embed.description);
    if (embed.fields && Array.isArray(embed.fields)) {
        for (const f of embed.fields) {
            if (f.name && f.value) {
                lines.push(`> **${f.name}**: ${f.value}`);
            }
        }
    }
    if (embed.links && Array.isArray(embed.links)) {
        const linkStr = embed.links.map(l => `[${l.label}](${l.url})`).join(' • ');
        if (linkStr) lines.push(linkStr);
    }
    return lines.join('\n');
}

async function executeDiscordSend(token, channelId, embed, content = "") {
    if (!token && !channelId) return { success: false, error: "Missing Discord Bot Token or Channel ID / Webhook URL." };

    // Check global rate limit block first
    const now = Date.now();
    if (discordGlobalRateLimitUntil > now) {
        const waitSec = Math.ceil((discordGlobalRateLimitUntil - now) / 1000);
        console.warn(`[Discord] Globally rate limited. Blocked for ${waitSec}s more.`);
        return { success: false, error: `Discord is rate limited. Please wait ${waitSec} seconds before trying again.` };
    }

    // 1. Detect if channelId or token is a Webhook URL
    let webhookUrl = null;
    if (typeof channelId === 'string' && (channelId.startsWith('http://') || channelId.startsWith('https://') || channelId.includes('discord.com/api/webhooks'))) {
        webhookUrl = channelId.trim();
    } else if (typeof token === 'string' && (token.startsWith('http://') || token.startsWith('https://') || token.includes('discord.com/api/webhooks'))) {
        webhookUrl = token.trim();
    }

    // Detect if bot token was accidentally pasted into the channel ID field
    const channelStr = channelId ? String(channelId).trim() : "";
    const tokenStr = token ? String(token).trim() : "";
    if (!webhookUrl && channelStr && channelStr.includes('.') && channelStr.length > 40) {
        return { success: false, error: "It looks like your Bot Token was pasted into the Channel ID field. The Channel ID should be numbers only (e.g. 1521966816891502713). Alternatively, paste a Discord Webhook URL into the Bot Token field." };
    }
    if (!webhookUrl && tokenStr && /^\d{15,22}$/.test(tokenStr) && (!channelStr || channelStr.length > 40)) {
        return { success: false, error: "It looks like the Channel ID and Bot Token may be swapped. The Bot Token is a long string with dots (from Discord Developer Portal), and the Channel ID is numbers only." };
    }

    let cleanContent = content ? String(content).trim() : "";
    if (cleanContent.startsWith('<@') && cleanContent.endsWith('>')) {
        const mentionId = cleanContent.replace(/[<@!>]/g, '');
        if (!/^\d{17,20}$/.test(mentionId)) {
            cleanContent = "";
        }
    }

    const payload = { embeds: [embed] };
    if (cleanContent) payload.content = cleanContent;

    // A. Webhook route
    if (webhookUrl) {
        console.log(`[Discord Webhook] Sending alert '${embed.title || 'alert'}' to webhook...`);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            let res;
            try {
                res = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeout);
            }

            if (res.status === 429) {
                const retryAfterHeader = res.headers.get('retry-after');
                const isGlobal = res.headers.get('x-ratelimit-global') === 'true';
                const delayMs = retryAfterHeader ? Math.ceil(parseFloat(retryAfterHeader) * 1000) : 5000;
                discordGlobalRateLimitUntil = Date.now() + Math.min(delayMs + 1000, DISCORD_GLOBAL_BLOCK_CAP_MS);
                console.warn(`[Discord Webhook] ${isGlobal ? 'GLOBAL ' : ''}Rate limited (429). Blocking for ${delayMs}ms.`);
                return { success: false, error: `Discord rate limit hit. Please wait ${Math.ceil(delayMs/1000)} seconds.` };
            }

            if (!res.ok) {
                const ct = res.headers.get('content-type') || '';
                if (ct.includes('application/json')) {
                    const data = await res.json().catch(() => ({}));
                    return { success: false, error: data.message || `Webhook error (${res.status})` };
                }
                return { success: false, error: `Webhook returned HTTP ${res.status}` };
            }
            console.log(`[Discord Webhook] Alert delivered successfully.`);
            return { success: true };
        } catch (err) {
            if (err.name === 'AbortError') return { success: false, error: "Discord webhook request timed out after 8s." };
            return { success: false, error: err.message };
        }
    }

    // 2. Sanitize Channel ID
    let cleanChannelId = channelId ? String(channelId).trim() : "";
    const channelMatches = cleanChannelId.match(/\d{15,22}/g);
    if (channelMatches && channelMatches.length > 0) {
        cleanChannelId = channelMatches[channelMatches.length - 1];
    }

    if (!cleanChannelId) {
        return { success: false, error: "Invalid Discord Channel ID (must be a numeric channel ID, e.g. 123456789012345678, or a webhook URL)." };
    }

    const cleanToken = token ? String(token).trim() : "";
    if (!cleanToken) {
        return { success: false, error: "Missing Discord Bot Token." };
    }

    // 3. Direct Discord REST API Send
    console.log(`[Discord Bot] Sending '${embed.title || 'alert'}' to channel ${cleanChannelId}...`);
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let res;
        try {
            res = await fetch(`https://discord.com/api/v10/channels/${cleanChannelId}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${cleanToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (res.status === 429) {
            const retryAfterHeader = res.headers.get('retry-after');
            const isGlobal = res.headers.get('x-ratelimit-global') === 'true';
            const delayMs = retryAfterHeader ? Math.ceil(parseFloat(retryAfterHeader) * 1000) : 5000;
            discordGlobalRateLimitUntil = Date.now() + Math.min(delayMs + 1000, DISCORD_GLOBAL_BLOCK_CAP_MS);
            console.warn(`[Discord REST] ${isGlobal ? 'GLOBAL ' : ''}Rate limited (429). Blocking all sends for ${Math.ceil(delayMs/1000)}s.`);
            return { success: false, error: `Discord rate limit hit. Please wait ${Math.ceil(delayMs/1000)} seconds before trying again.` };
        }

        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            const raw = await res.text().catch(() => '');
            console.error(`[Discord REST] Non-JSON response [${res.status}]:`, raw.slice(0, 200));
            return { success: false, error: `Discord returned HTTP ${res.status}` };
        }

        const data = await res.json();
        if (!res.ok) {
            console.error(`[Discord API Error] Status ${res.status}:`, data);

            // Auto-fallback: if Discord rejects due to missing 'Embed Links' (50013),
            // immediately retry as clean Markdown formatted text so the alert is NEVER dropped!
            if (res.status === 403 && (data.code === 50013 || (data.message && data.message.includes('Missing Permissions'))) && embed) {
                console.warn(`[Discord REST] Missing 'Embed Links' permission (50013). Retrying as formatted Markdown text...`);
                const fallbackText = formatEmbedAsMarkdown(embed, cleanContent);
                try {
                    const fallbackRes = await fetch(`https://discord.com/api/v10/channels/${cleanChannelId}/messages`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bot ${cleanToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ content: fallbackText }),
                        signal: AbortSignal.timeout(8000)
                    });
                    if (fallbackRes.ok) {
                        console.log(`[Discord Bot] '${embed.title || 'alert'}' delivered as fallback Markdown text.`);
                        return { 
                            success: true, 
                            warning: "Delivered as plain text. To enable rich color cards, give your bot the 'Embed Links' permission in Discord server settings." 
                        };
                    }
                } catch(fbErr) {
                    console.error(`[Discord Bot] Fallback exception:`, fbErr.message);
                }
            }

            let errMsg = data.message || `Discord API error (${res.status})`;
            if (data.code === 50001) errMsg = "Missing Access — make sure your bot is invited to the server and has 'Send Messages' permission in that channel.";
            if (data.code === 50013) errMsg = "Missing Permissions — Please ensure your bot role has 'Embed Links' and 'Send Messages' enabled in your Discord server.";
            if (data.code === 10003) errMsg = "Unknown Channel — verify your Alert Channel ID is correct.";
            if (res.status === 401) errMsg = "Unauthorized — your Bot Token is invalid. Please reset it in the Discord Developer Portal.";
            return { success: false, error: errMsg };
        }

        console.log(`[Discord Bot] '${embed.title || 'alert'}' delivered to channel ${cleanChannelId}.`);
        return { success: true };
    } catch (err) {
        if (err.name === 'AbortError') {
            return { success: false, error: "Discord request timed out after 8s." };
        }
        console.error("[Discord REST Error]:", err.message);
        return { success: false, error: err.message };
    }
}


if (ADMIN_API_KEY) {
    fetch(`https://api.torn.com/user/?selections=profile&key=${ADMIN_API_KEY}`)
        .then(r => r.json())
        .then(d => { if (d.faction) adminFactionId = d.faction.faction_id?.toString(); })
        .catch(e => console.error("Failed to load admin profile"));
}

// API THROTTLING (Item 5)
let globalApiUsage = {};
setInterval(() => { globalApiUsage = {}; }, 60000);

function getNextApiKey() {
    let activeKeys = [];
    const now = Date.now();
    
    for (const [key, data] of Object.entries(subCache)) {
        if (data.expires > now) activeKeys.push(key);
    }
    
    if (ADMIN_API_KEY) activeKeys.push(ADMIN_API_KEY);
    if (TORN_API_KEY) activeKeys.push(TORN_API_KEY);
    if (discordConfig.apiKey) activeKeys.push(discordConfig.apiKey);
    if (apiPoolConfig.keys && apiPoolConfig.keys.length > 0) activeKeys.push(...apiPoolConfig.keys);
    
    activeKeys = [...new Set(activeKeys.filter(k => k && typeof k === 'string' && k.trim() !== ""))];
    
    let validKeys = activeKeys.filter(k => (globalApiUsage[k] || 0) < 90);
    if (validKeys.length === 0) return null; // All keys are throttled for the remainder of this minute
    
    let key = validKeys[activeKeyIndex % validKeys.length];
    activeKeyIndex++;
    globalApiUsage[key] = (globalApiUsage[key] || 0) + 1;
    return key;
}



async function getDiscordId(tornId) {
    if (!tornId) return null;
    const keyStr = tornId.toString();
    if (discordIdCache[keyStr]) {
        return discordIdCache[keyStr] === "none" ? null : discordIdCache[keyStr];
    }
    let key = getNextApiKey();
    if (!key) return null;
    try {
        let res = await fetch(`https://api.torn.com/user/${keyStr}?selections=discord&key=${key}`);
        let data = await res.json();
        // In Torn API, discordID / discord_id is the 17-20 digit Discord Snowflake.
        // data.discord.userID is the Torn player ID, which must NOT be used for Discord pings!
        const rawDiscordId = data.discord?.discordID || data.discord?.discordId || data.discord?.discord_id || "";
        const cleanDiscordId = rawDiscordId ? String(rawDiscordId).trim() : "";
        if (/^\d{17,20}$/.test(cleanDiscordId)) {
            discordIdCache[keyStr] = cleanDiscordId;
            return cleanDiscordId;
        }
        discordIdCache[keyStr] = "none"; 
        return null;
    } catch(e) { return null; }
}

setInterval(async () => {
    if (!ADMIN_API_KEY) return;
    try {
        const res = await fetch(`https://api.torn.com/user/?selections=events&key=${ADMIN_API_KEY}`);
        const data = await res.json();
        if (!data.events) return;
        let events = Object.entries(data.events).map(([id, ev]) => ({ id, ...ev }));
        events.sort((a, b) => a.timestamp - b.timestamp);

        for (let ev of events) {
            if (ev.timestamp <= lastEventTimestamp) continue;
            lastEventTimestamp = ev.timestamp;
            const text = ev.event;
            if (text.toLowerCase().includes('sent you') && text.toLowerCase().includes('xanax')) {
                const qtyMatch = text.match(/(\d+)\s*[xX]\s*Xanax/i) || text.match(/Xanax\s*[xX]\s*(\d+)/i);
                let qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                const idMatch = text.match(/XID=(\d+)/);

                if (idMatch) {
                    let senderId = idMatch[1];
                    let weeks = Math.floor(qty / 5);

                    if (weeks > 0) {
                        const senderRes = await fetch(`https://api.torn.com/user/${senderId}?selections=profile&key=${ADMIN_API_KEY}`);
                        const senderData = await senderRes.json();
                        const facId = senderData.faction?.faction_id;

                        if (facId && facId !== 0) {
                            let now = Date.now();
                            if (!subscriptions[facId] || subscriptions[facId] < now) subscriptions[facId] = now;
                            subscriptions[facId] += weeks * 7 * 24 * 60 * 60 * 1000;
                            saveSubs();
                            
                            fetch(ADMIN_DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [{ title: "💰 Payment Received", description: `Faction \`${facId}\` sent **${qty}x Xanax** for ${weeks} weeks of Warboard access!`, color: 3069299 }] }) }).catch(()=>{});
                        }
                    }
                }
            }
        }
    } catch (err) {}
}, 60000); 

setInterval(async () => {
    if (statQueue.size === 0 || isProcessingStats) return;
    isProcessingStats = true;
    let firstEntry = statQueue.entries().next().value;
    let ffKeyToUse = firstEntry[1];
    let batch = [];
    for (let [id, key] of statQueue.entries()) {
        if (key === ffKeyToUse && batch.length < 40) { batch.push(id); statQueue.delete(id); }
    }
    try {
        const res = await fetch(`https://ffscouter.com/api/v1/get-stats?key=${ffKeyToUse}&targets=${batch.join(',')}`);
        const data = await res.json();
        if (Array.isArray(data)) { data.forEach(p => { statsCache[p.player_id.toString()] = { stats: p.bs_estimate, time: Date.now() }; }); }
    } catch (err) {}
    isProcessingStats = false;
}, 4000);

setInterval(async () => {
    if (flightQueue.size === 0 || isProcessingFlights) return;
    isProcessingFlights = true;
    let [targetId, ffKeyToUse] = flightQueue.entries().next().value;
    flightQueue.delete(targetId);
    try {
        const res = await fetch(`https://ffscouter.com/api/v1/player-flights?key=${ffKeyToUse}&target=${targetId}`);
        const data = await res.json();
        if (data && data.current) {
            const cur = data.current;
            const earliest = Number(cur.earliest_arrival_time || cur.arrival_early || cur.arrival_min || 0);
            const latest = Number(cur.latest_arrival_time || cur.arrival_late || cur.arrival_max || 0);
            let midpoint = 0;
            if (earliest > 0 && latest > 0) midpoint = Math.round((earliest + latest) / 2);
            else if (latest > 0) midpoint = latest;
            else if (earliest > 0) midpoint = earliest;
            flightCache[targetId] = {
                midpoint,
                landingTime: midpoint || latest,
                earliest,
                latest,
                destination: cur.destination || "",
                origin: cur.origin || "",
                time: Date.now()
            };
        } else {
            flightCache[targetId] = { landingTime: null, midpoint: null, time: Date.now() };
        }
    } catch (err) {}
    isProcessingFlights = false;
}, 1000); 
 

setInterval(async () => {
    if (activityQueue.size === 0 || isProcessingActivity) return;
    isProcessingActivity = true;
    let [targetId, ffKeyToUse] = activityQueue.entries().next().value;
    activityQueue.delete(targetId);
    const end = Math.floor(Date.now() / 1000);
    const start = end - (72 * 3600); 
    try {
        const res = await fetch(`https://ffscouter.com/api/v1/activity/player?key=${ffKeyToUse}&target=${targetId}&start=${start}&end=${end}&bucket=3600`);
        const data = await res.json();
        if (data.code === 0 && Array.isArray(data.buckets)) { activityCache[targetId] = { timeline: data.buckets.map(b => b.activity_score), time: Date.now() }; } 
        else { activityCache[targetId] = { timeline: [], time: Date.now() }; }
    } catch (err) {}
    isProcessingActivity = false;
}, 1500); 

function processWarAttack(atk, myFactionId, enemyFactionId, warStart, warEnd = 0) {
    if (!atk || (!atk.code && !atk.timestamp_ended)) return;
    const atkKey = atk.code || `${atk.attacker_id}_${atk.defender_id}_${atk.timestamp_ended}`;
    if (processedAttackIds.has(atkKey)) return;
    
    const atkTime = atk.timestamp_ended || atk.timestamp_started || 0;
    if (warStart && atkTime < warStart) return;
    if (warEnd && warEnd > 0 && atkTime > warEnd) return;
    
    processedAttackIds.add(atkKey);

    if (atk.attacker_id && atk.attacker_name) playerNameCache[atk.attacker_id.toString()] = atk.attacker_name;
    if (atk.defender_id && atk.defender_name) playerNameCache[atk.defender_id.toString()] = atk.defender_name;

    const aId = atk.attacker_id ? atk.attacker_id.toString() : null;
    const dId = atk.defender_id ? atk.defender_id.toString() : null;
    const aFac = atk.attacker_faction ? atk.attacker_faction.toString() : "0";
    const dFac = atk.defender_faction ? atk.defender_faction.toString() : "0";
    const myFac = myFactionId ? myFactionId.toString() : null;
    const enFac = enemyFactionId ? enemyFactionId.toString() : null;

    const isWin = ["Hospitalized", "Mugged", "Arrested", "Looted", "Assist", "Attacked", "Special"].includes(atk.result);
    const isDefendWin = ["Lost", "Draw", "Escape", "Stalemate", "Timeout", "Interrupted"].includes(atk.result);

    // Friendly member made an attack / assist
    if (aId && myFac && aFac === myFac) {
        if (atk.result === "Assist") {
            liveAssists[aId] = (liveAssists[aId] || 0) + 1;
        } else if (isWin) {
            const isEnemyHit = (enFac && dFac === enFac) || (atk.modifiers && atk.modifiers.war) || (atk.ranked_war === 1) || (atk.modifiers && atk.modifiers.fair_fight && dFac !== myFac);
            if (isEnemyHit || (!enFac && dFac !== myFac && dFac !== "0")) {
                liveWarHits[aId] = (liveWarHits[aId] || 0) + 1;
            } else {
                liveOutsideHits[aId] = (liveOutsideHits[aId] || 0) + 1;
            }
        }
    }

    // Friendly member was defended against / attacked
    if (dId && myFac && dFac === myFac) {
        if (isDefendWin) {
            const isEnemyDefend = (enFac && aFac === enFac) || (atk.modifiers && atk.modifiers.war);
            if (isEnemyDefend || (!enFac && aFac !== myFac && aFac !== "0")) {
                liveWarDefendsWon[dId] = (liveWarDefendsWon[dId] || 0) + 1;
            } else {
                liveOutsideDefendsWon[dId] = (liveOutsideDefendsWon[dId] || 0) + 1;
            }
        } else if (isWin) {
            const isEnemyAttack = (enFac && aFac === enFac) || (atk.modifiers && atk.modifiers.war);
            if (isEnemyAttack || (!enFac && aFac !== myFac && aFac !== "0")) {
                liveWarHitsTaken[dId] = (liveWarHitsTaken[dId] || 0) + 1;
            } else {
                liveOutsideHitsTaken[dId] = (liveOutsideHitsTaken[dId] || 0) + 1;
            }
        }
    }
}

async function backfillWarDefends(watchKey, watchFactionId, warStart, enemyFactionId = null, warEnd = 0) {
    if (isBackfillingWar) return;
    isBackfillingWar = true;
    console.log(`[WarTracker] Backfilling attacks from war start: ${warStart} (end: ${warEnd || 'ongoing'})...`);

    let toTimestamp = Math.floor(Date.now() / 1000);
    if (warEnd && warEnd > 0) toTimestamp = warEnd;

    const totalTimeSpan = Math.max(1, toTimestamp - warStart);

    let keepScraping = true;
    let pageCount = 0;
    let totalProcessed = 0;

    warSyncStatus = {
        isSyncing: true,
        percent: 5,
        page: 1,
        totalHitsLoaded: totalProcessed,
        message: "Starting attack history scan..."
    };

    while (keepScraping && pageCount < 150) { 
        try {
            // Note: Torn API /faction/?selections=attacks MUST NOT include faction ID in path when using user's key
            const res = await fetch(`https://api.torn.com/faction/?selections=attacks&to=${toTimestamp}&key=${watchKey}`);
            const data = await res.json();
            if (data.error || !data.attacks) {
                console.error("[WarTracker] Backfill error:", data.error?.error || "No attacks returned");
                break;
            }
            
            let attacks = Object.values(data.attacks);
            if (attacks.length === 0) break;
            
            attacks.sort((a, b) => (b.timestamp_ended || b.timestamp_started || 0) - (a.timestamp_ended || a.timestamp_started || 0));
            let oldestTimeInBatch = toTimestamp;
            let foundOldAttack = false;

            for (let atk of attacks) {
                const atkTime = atk.timestamp_ended || atk.timestamp_started || 0;
                if (atkTime < oldestTimeInBatch) {
                    oldestTimeInBatch = atkTime;
                }
                
                if (atkTime < warStart) { 
                    keepScraping = false; 
                    foundOldAttack = true;
                    continue; 
                }
                
                processWarAttack(atk, watchFactionId, enemyFactionId, warStart, warEnd);
                totalProcessed++;
            }
            
            const timeCovered = Math.max(0, (warEnd && warEnd > 0 ? warEnd : Math.floor(Date.now()/1000)) - oldestTimeInBatch);
            const currentPct = Math.min(99, Math.max(10, Math.round((timeCovered / totalTimeSpan) * 100)));
            warSyncStatus = {
                isSyncing: true,
                percent: currentPct,
                page: pageCount + 1,
                totalHitsLoaded: totalProcessed,
                message: `Syncing attack history: ${currentPct}% (${totalProcessed} attacks processed)`
            };

            if (!foundOldAttack && oldestTimeInBatch < toTimestamp) {
                 toTimestamp = oldestTimeInBatch - 1;
                 pageCount++;
                 await new Promise(r => setTimeout(r, 250)); 
            } else {
                break;
            }
        } catch (e) { 
            console.error("[WarTracker] Backfill exception:", e.message);
            break; 
        }
    }
    hasBackfilledWar = true;
    isBackfillingWar = false;
    warSyncStatus = {
        isSyncing: false,
        percent: 100,
        page: pageCount + 1,
        totalHitsLoaded: totalProcessed,
        message: `War attack history fully loaded (${totalProcessed} attacks processed)`
    };
    console.log(`[WarTracker] Backfill complete. Processed ${totalProcessed} attacks across ${pageCount + 1} pages.`);
}


// Background Task 4: Global Recruitment Scanner
setInterval(async () => {
    if (global.isTurboMining) return;
    let watchKey = getNextApiKey();
    if (!watchKey) return; // Need an API key to scan

            const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
        const recruitsFile = path.join(__dirname, 'data', 'recruits.json');
    let cachedRecruits = [];
    try {
        if (fs.existsSync(recruitsFile)) {
            cachedRecruits = JSON.parse(fs.readFileSync(recruitsFile, 'utf8'));
        }
    } catch (e) {}

    // Only scan if we have less than 2000 recruits in database
    if (cachedRecruits.length > 2000) {
        // Rotate out the oldest 200 recruits
        cachedRecruits = cachedRecruits.slice(200);
    }

    const batchSize = 20;
    const randomIds = [];
    // Target newer/mid-level players usually found in ID ranges 2,500,000 to 3,400,000
    for (let i = 0; i < batchSize; i++) {
        const rand = Math.random();
            if (rand < 0.60) {
                // 60% chance for ultra-new players in 2026 (IDs 4.5M to 5.0M)
                randomIds.push(Math.floor(Math.random() * (5000000 - 4500000 + 1) + 4500000));
            } else if (rand < 0.90) {
                // 30% chance for mid players (IDs 3.0M to 4.5M)
                randomIds.push(Math.floor(Math.random() * (4500000 - 3000000 + 1) + 3000000));
            } else {
                // 10% chance for veterans (IDs 1.5M to 3.0M)
                randomIds.push(Math.floor(Math.random() * (3000000 - 1500000 + 1) + 1500000));
            }
    }

    try {
        const batchPromises = randomIds.map(async (id) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const userRes = await fetch(`https://api.torn.com/user/${id}?selections=profile,personalstats&key=${watchKey}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            const userData = await userRes.json();
            if (userData.error) return null;

            const profile = userData.profile || userData;
            const personalstats = userData.personalstats || {};
            
            // Only care about active players
            if (profile.status && (profile.status.state === "Federal" || profile.status.state === "Fallen")) return null;
            // Filter out players who haven't logged in for over 7 days
            if (profile.last_action && profile.last_action.timestamp) {
                const daysInactive = (Date.now() / 1000 - profile.last_action.timestamp) / 86400;
                if (daysInactive > 7) return null;
            }
            
            // Only care about Factionless players (No poaching rule!)
            if (profile.faction && profile.faction.faction_id !== 0) return null;

            const level = profile.level || 1;
            const playtimeSec = personalstats.useractivity || 0;
            const playtimeDays = parseFloat((playtimeSec / 86400).toFixed(1));
            const xanax = personalstats.xantaken || 0;
            const refills = personalstats.refills || 0;
            const se = personalstats.statenhancersused || 0;
            const estStats = "Not yet available";
            const donator = profile.donator === 1 || profile.donator === true;

            return {
                id,
                name: profile.name,
                level,
                        age: profile.age || 1,
                        playtime: playtimeDays,
                        xanax,
                        refills,
                        se,
                        estStats,
                        donator,
                status: profile.status ? `${profile.status.state} (${profile.status.description || ''})` : "Offline",
                faction: "Factionless"
            };
        });

        const batchResults = await Promise.all(batchPromises);
        const validRecruits = batchResults.filter(r => r !== null);
        
        if (validRecruits.length > 0) {
            // Deduplicate
            if (process.env.MONGODB_URI) {
                    const bulkOps = validRecruits.map(r => ({
                        updateOne: { filter: { id: r.id }, update: { $set: r }, upsert: true }
                    }));
                    try {
                        await Recruit.bulkWrite(bulkOps);
                        console.log(`[Cron] Upserted ${validRecruits.length} factionless recruits to MongoDB.`);
                    } catch(e) { console.log('MongoDB bulkWrite error', e); }
                } else {
                    const existingIds = new Set(cachedRecruits.map(r => r.id));
                    validRecruits.forEach(r => {
                        if (!existingIds.has(r.id)) cachedRecruits.push(r);
                    });
                    try { fs.writeFileSync(recruitsFile, JSON.stringify(cachedRecruits, null, 2)); } catch(e){}
                }
        }
    } catch (e) {
        // Silent fail for background tasks
    }
}, 120000); // Run every 2 minutes
// Background Task 1: Wall Watcher & Scraper
setInterval(async () => {
    if (global.isTurboMining) return;
    let watchFactionId = adminFactionId || discordConfig.factionId;
    let watchKey = discordConfig.apiKey || TORN_API_KEY;
    if (!watchKey || !watchFactionId) return;

    try {
        const liveRes = await fetch(`https://api.torn.com/faction/?selections=attacks,basic,rankedwars&key=${watchKey}`);
        const liveData = await liveRes.json();
        
        if (liveData.rankedwars) {
            let ongoingWar = Object.values(liveData.rankedwars).find(w => w.war && w.war.winner === 0);
            if (ongoingWar && ongoingWar.war) {
                let facIds = Object.keys(ongoingWar.factions || {});
                currentEnemyFacId = facIds.find(id => id !== watchFactionId.toString()) || null;
                let warStart = ongoingWar.war.start;
                let warEnd = ongoingWar.war.end || 0;

                if (activeWarId !== warStart) {
                    activeWarId = warStart;
                    activeWarEnd = warEnd;
                    liveWarHits = {};
                    liveOutsideHits = {};
                    liveAssists = {};
                    liveWarDefendsWon = {};
                    liveOutsideDefendsWon = {};
                    liveWarHitsTaken = {};
                    liveOutsideHitsTaken = {};
                    hasBackfilledWar = false;
                    processedAttackIds.clear();
                    friendlyHitTracker = {};
                    travelAlerts = {};
                    enemyMembersCache = {};
                    backfillWarDefends(watchKey, watchFactionId, activeWarId, currentEnemyFacId, activeWarEnd);
                } else if (!hasBackfilledWar && !isBackfillingWar) {
                    backfillWarDefends(watchKey, watchFactionId, activeWarId, currentEnemyFacId, activeWarEnd);
                }
            } else { 
                activeWarId = null; 
                activeWarEnd = null;
                hasBackfilledWar = false; 
            }
        }

        if (liveData.attacks && activeWarId) {
            let attacksToProcess = Object.entries(liveData.attacks);
            attacksToProcess.sort((a, b) => (a[1].timestamp_ended || 0) - (b[1].timestamp_ended || 0));

            for (let [atkId, atk] of attacksToProcess) {
                let wasAlreadyProcessed = processedAttackIds.has(atk.code);
                processWarAttack(atk, watchFactionId, currentEnemyFacId, activeWarId, activeWarEnd);
                
                if (wasAlreadyProcessed) continue;

                let isWin = ["Hospitalized", "Mugged", "Arrested", "Looted", "Assist", "Attacked", "Special"].includes(atk.result);
                if (isWin && atk.defender_faction && atk.defender_faction.toString() === watchFactionId.toString()) {
                    let uId = atk.defender_id.toString();
                    let attackerId = atk.attacker_id ? atk.attacker_id.toString() : "0";
                    let isRecent = atk.timestamp_ended > (Math.floor(Date.now() / 1000) - 180);
                    let friendlyMem = liveData.members ? liveData.members[uId] : null;

                    if (friendlyMem && friendlyMem.status?.state !== "Traveling") {
                        if (!friendlyHitTracker[uId]) friendlyHitTracker[uId] = { count: 0, lastHit: 0, alertedAt: 0 };
                        let now = Date.now();
                        if (now - friendlyHitTracker[uId].lastHit > 15 * 60 * 1000) friendlyHitTracker[uId].count = 0;
                        friendlyHitTracker[uId].count++;
                        friendlyHitTracker[uId].lastHit = now;
                        
                        let isOnline = friendlyMem.last_action && (friendlyMem.last_action.status === "Online" || friendlyMem.last_action.status === "Idle");
                        
                        if (hasBackfilledWar && isRecent && friendlyHitTracker[uId].count >= 3 && (now - friendlyHitTracker[uId].alertedAt > 30 * 60 * 1000) && !isOnline) {
                            friendlyHitTracker[uId].alertedAt = now;
                            friendlyHitTracker[uId].count = 0;
                            let dId = await getDiscordId(uId);
                            let pingStr = (dId && /^\d{17,20}$/.test(dId)) ? `<@${dId}>` : "";
                            if (discordConfig.chainWarnings !== false && discordConfig.globalChannelId) {
                                let embed = {
                                    title: "⚠️ CHAIN ATTACK WARNING",
                                    description: `**${friendlyMem.name}**, you have been hit 3 consecutive times in Torn! Log in and react!`,
                                    color: 16729943
                                };
                                if (discordConfig.globalBotToken) {
                                    sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, embed, pingStr);
                                }
                            }
                        }
                    }
                    
                    if (hasBackfilledWar && isRecent && discordConfig.friendlyAttacked === true && discordConfig.globalChannelId) {
                        let attackerName = atk.attacker_name || "Unknown"; 
                        let attackerFactionName = atk.attacker_faction_name || "None"; 
                        let defenderName = atk.defender_name || uId;

                        let rawEst = (spyDatabase[attackerId] && spyDatabase[attackerId].total) ? spyDatabase[attackerId].total : (statsCache[attackerId]?.stats || manualStats[attackerId]?.stats || 0);
                        let enemyEst = (typeof rawEst === 'number' && !isNaN(rawEst) && rawEst > 0) ? rawEst : 0;
                        let statStr = enemyEst > 0 ? `~${enemyEst.toLocaleString()}` : "Unknown";

                        let dId = await getDiscordId(uId);
                        let pingStr = (dId && /^\d{17,20}$/.test(dId)) ? `<@${dId}>` : "";

                        if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { 
                            title: "🛡️ Wall Watcher: Friendly Attacked", 
                            description: `**${attackerName}** [${attackerId}] from \`${attackerFactionName}\` just attacked **${defenderName}**!`,
                            color: 16729943,
                            fields: [{ name: "Enemy Est. Stats", value: statStr, inline: true }],
                            links: [
                                { label: "⚔️ RETALIATE", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${attackerId}` },
                                { label: "Enemy Profile", url: `https://www.torn.com/profiles.php?XID=${attackerId}` }
                            ]
                        }, pingStr);
                    }
                }
                
                if (isWin && atk.attacker_faction && atk.attacker_faction.toString() === watchFactionId.toString()) {
                    let uId = atk.attacker_id ? atk.attacker_id.toString() : "0";
                    let isRecent = atk.timestamp_ended > (Math.floor(Date.now() / 1000) - 180);
                    if (atk.chain && BONUS_THRESHOLDS.has(atk.chain)) {
                        if (hasBackfilledWar && isRecent && discordConfig.chainMilestone !== false && discordConfig.globalChannelId) {
                            if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { title: "🏆 Chain Milestone Secured", description: `Hit **#${atk.chain}** executed by \`${atk.attacker_name || uId}\` (+${atk.respect_gain || 0} respect)!`,
                                color: 16753922
                            });
                        }
                    }
                }
            }
        }

        if (currentEnemyFacId && Date.now() - lastEnemyScrape > 60000) {
            lastEnemyScrape = Date.now();
            try {
                const enemyRes = await fetch(`https://api.torn.com/faction/${currentEnemyFacId}?selections=basic&key=${watchKey}`);
                const enemyData = await enemyRes.json();
                if (enemyData.members) enemyMembersCache = enemyData.members;
            } catch(e) {}
        }

        if (liveData.members && Object.keys(enemyMembersCache).length > 0) {
            const COUNTRIES = ["Mexico", "Cayman Islands", "Canada", "Hawaii", "United Kingdom", "Argentina", "Switzerland", "Japan", "China", "UAE", "South Africa"];
            
            // Track which enemy IDs are currently traveling (key: `${enemyId}_${country}`)
            let currentTravelingEnemies = new Set();
            let enemyThreats = {}; 
            for (let [eId, eMem] of Object.entries(enemyMembersCache)) {
                let det = (eMem.status && eMem.status.details) ? eMem.status.details : "";
                if (det.includes("Traveling to ")) {
                    let country = COUNTRIES.find(c => det.includes(c));
                    if (country) {
                        let travelKey = `${eId}_${country}`;
                        currentTravelingEnemies.add(travelKey);
                        if (!enemyThreats[country]) enemyThreats[country] = [];
                        // Only add threat if this enemy just started traveling (not seen last cycle)
                        if (!travelAlerts[`enemy_${travelKey}`]) {
                            enemyThreats[country].push(eMem.name);
                        }
                    }
                }
            }

            // Update known traveling enemies for next cycle (prune arrived enemies)
            for (let key of Object.keys(travelAlerts)) {
                if (key.startsWith('enemy_') && !currentTravelingEnemies.has(key.replace('enemy_', ''))) {
                    delete travelAlerts[key];
                }
            }
            for (let travelKey of currentTravelingEnemies) {
                travelAlerts[`enemy_${travelKey}`] = Date.now();
            }

            for (let [uId, fMem] of Object.entries(liveData.members)) {
                let det = (fMem.status && fMem.status.details) ? fMem.status.details : "";
                let fCountry = COUNTRIES.find(c => det.includes(c));
                if (fCountry && enemyThreats[fCountry] && enemyThreats[fCountry].length > 0) {
                    let alertKey = `friendly_${uId}_${fCountry}`;
                    let lastAlert = travelAlerts[alertKey] || 0;
                    if (Date.now() - lastAlert > 30 * 60 * 1000) { // 30 min per friendly per country
                        travelAlerts[alertKey] = Date.now();
                        let dId = await getDiscordId(uId);
                        let pingStr = (dId && /^\d{17,20}$/.test(dId)) ? `<@${dId}>` : "";
                        if (discordConfig.travelWarnings !== false && discordConfig.globalChannelId) {
                            let embed = {
                                title: "✈️ TRAVEL WARNING",
                                description: `**${fMem.name}**, an enemy (**${enemyThreats[fCountry][0]}**) is currently flying to **${fCountry}** where you are located (or heading)!\n\nFly away or return to Torn immediately!`,
                                color: 16729943
                            };
                            if (discordConfig.globalBotToken) {
                                sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, embed, pingStr);
                            }
                        }
                    }
                }
            }
        }

    } catch (err) {}
}, 20000); 

// Background Task 2: Market Watcher
setInterval(async () => {
    if (global.isTurboMining) return;
    let watchKey = getNextApiKey();
    if (!marketConfig.globalChannelId || !watchKey) return;
    
    try {
        if (marketConfig.autoDefense) {
            let rootKey = discordConfig.apiKey || watchKey;
            const userRes = await fetch(`https://api.torn.com/user/?selections=bazaar,profile&key=${rootKey}`);
            const userData = await userRes.json();
            
            if (userData.bazaar && userData.bazaar.length > 0) {
                let myPrices = {};
                userData.bazaar.forEach(item => {
                    if (!myPrices[item.itemID] || item.price < myPrices[item.itemID].price) { myPrices[item.itemID] = { price: item.price, name: item.name }; }
                });

                for (let [itemId, myItem] of Object.entries(myPrices)) {
                    let rotationKey = getNextApiKey();
                    const mktRes = await fetch(`https://api.torn.com/market/${itemId}?selections=bazaar,itemmarket&key=${rotationKey}`);
                    const mktData = await mktRes.json();

                    if (mktData.bazaar || mktData.itemmarket) {
                        let lowestMarketPrice = Infinity;
                        const checkListings = (listings) => {
                            if (!listings) return;
                            Object.values(listings).forEach(listing => { if (listing.cost < myItem.price && listing.cost < lowestMarketPrice) lowestMarketPrice = listing.cost; });
                        };
                        checkListings(mktData.bazaar); checkListings(mktData.itemmarket);

                        if (lowestMarketPrice < myItem.price) {
                            if (marketMemory.defense[itemId] !== lowestMarketPrice) {
                                marketMemory.defense[itemId] = lowestMarketPrice;
                                
                                let embed = {
                                    title: "📉 Market Undercut Alert",
                                    description: `Your \`${myItem.name}\` ($${myItem.price.toLocaleString()}) was undercut!\nNew lowest price: **$${lowestMarketPrice.toLocaleString()}**`,
                                    color: 16729943,
                                    links: [{ label: "🔎 Check Market", url: `https://www.torn.com/imarket.php#/p=shop&step=shop&type=&searchname=${myItem.name}` }]
                                };
                                
                                if (marketConfig.globalChannelId && discordConfig.globalBotToken) {
                                    sendChannelMessage(discordConfig.globalBotToken, marketConfig.globalChannelId, embed);
                                }
                            }
                        } else { delete marketMemory.defense[itemId]; }
                    }
                    await new Promise(r => setTimeout(r, 500)); 
                }
            }
        }
    } catch (err) {}
}, 45000); 

// Intelligent Tactical Matcher: picks the best fighter who is Online/Idle IN TORN with matching battle stats
function findBestTacticalFighter(membersObj, enemyTarget, enemyId) {
    if (!membersObj || typeof membersObj !== 'object') return { name: 'Anyone available', id: null, enemyEst: 0 };

    const rawEnemyEst = (spyDatabase[enemyId]?.total) || (statsCache[enemyId]?.stats) || (manualStats[enemyId]?.stats) || 0;
    const enemyEst = (typeof rawEnemyEst === 'number' && Number.isFinite(rawEnemyEst) && rawEnemyEst > 0) ? rawEnemyEst : 0;
    const enemyLevel = Number(enemyTarget?.level || 1);

    // 1. Filter eligible friendly fighters (Must be in Torn, ready to fight, and Online/Idle)
    const candidates = [];
    for (const [id, m] of Object.entries(membersObj)) {
        if (id === String(enemyId) || !m || !m.name) continue;

        const state = (m.status?.state || '').trim();
        const desc = (m.status?.description || '').toLowerCase();
        const details = (m.status?.details || '').toLowerCase();
        const onlineStatus = (m.last_action?.status || 'Offline');

        // MUST be Online or Idle
        if (onlineStatus !== 'Online' && onlineStatus !== 'Idle') continue;

        // MUST NOT be traveling, abroad, in hospital, in jail, fallen, federal
        if (state === 'Hospital' || state === 'Jail' || state === 'Traveling' || state === 'Abroad' || state === 'Federal' || state === 'Fallen') continue;
        if (desc.includes('travel') || desc.includes('flying') || desc.includes('flight') || desc.includes('plane') || desc.includes('returning') || desc.includes('hospital') || desc.includes('jail') || desc.includes('abroad')) continue;
        if (details.includes('travel') || details.includes('flying') || details.includes('flight') || details.includes('plane') || details.includes('returning')) continue;

        const rawF = (spyDatabase[id]?.total) || (statsCache[id]?.stats) || (manualStats[id]?.stats) || 0;
        const fEst = (typeof rawF === 'number' && Number.isFinite(rawF) && rawF > 0) ? rawF : 0;
        const fLevel = Number(m.level || 1);

        // Power score for ranking
        const powerScore = fEst > 0 ? fEst : (fLevel * 100000);

        candidates.push({
            id,
            name: m.name,
            level: fLevel,
            stats: fEst,
            powerScore,
            isOnline: onlineStatus === 'Online'
        });
    }

    if (candidates.length === 0) {
        return { name: 'Anyone available', id: null, enemyEst };
    }

    // 2. Select the optimal fighter
    if (enemyEst > 0) {
        // Find friendlies with stats >= 0.85 * enemyEst (can win)
        const capable = candidates.filter(c => c.powerScore >= enemyEst * 0.85);
        if (capable.length > 0) {
            // Sort by:
            // 1. Online preferred over Idle
            // 2. Best Fair Fight multiplier (~1.2x to 2.5x enemy stats)
            capable.sort((a, b) => {
                if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
                const ratioA = a.powerScore / enemyEst;
                const ratioB = b.powerScore / enemyEst;
                const distA = Math.abs(ratioA - 1.6);
                const distB = Math.abs(ratioB - 1.6);
                return distA - distB;
            });
            return { name: capable[0].name, id: capable[0].id, enemyEst };
        }
    }

    // If enemy stats unknown OR no capable friendly found:
    // Pick the best available online fighter in Torn (ranked by battle stats / level)
    candidates.sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return b.powerScore - a.powerScore;
    });

    return { name: candidates[0].name, id: candidates[0].id, enemyEst };
}

// Background Task 3: Sniper & Target Status Watcher
setInterval(async () => {
    if (global.isTurboMining) return;
    let watchKey = getNextApiKey();
    let watchFactionId = adminFactionId || discordConfig.factionId;
    if (!watchKey || !watchFactionId) return;

    try {
        const facRes = await fetch(`https://api.torn.com/faction/${watchFactionId}?selections=basic,chain,rankedwars&key=${watchKey}`);
        const facData = await facRes.json();
        if (facData.error) return;

        if (facData.chain && facData.chain.current >= 10) {
            let secondsLeft = facData.chain.timeout;
            if (secondsLeft <= 90 && secondsLeft > 0 && !lastChainTimeoutAlertState && discordConfig.chainUnder90 && discordConfig.globalChannelId) {
                if (discordConfig.globalBotToken) {
                    sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, {
                        title: "⚠️ CHAIN DROPPING WARNING",
                        description: `Active chain is under 90 seconds (**${secondsLeft}s** left)! Someone needs to make a hit right now!`,
                        color: 16729943,
                        links: [{ label: "🔗 View Chain", url: `https://www.torn.com/factions.php?step=your#/tab=chains` }]
                    }, "@here");
                }
                lastChainTimeoutAlertState = true;
            } else if (secondsLeft > 120) { lastChainTimeoutAlertState = false; }
        } else { lastChainTimeoutAlertState = false; }

        let activeEnemyId = autoDetectEnemyFaction(facData);
        if (activeEnemyId && discordConfig.globalChannelId) {
            let rotationKey = getNextApiKey();
            const enemyRes = await fetch(`https://api.torn.com/faction/${activeEnemyId}?selections=basic&key=${rotationKey}`);
            const enemyData = await enemyRes.json();
            
            if (enemyData.members) {
                Object.entries(enemyData.members).forEach(async ([id, m]) => {
                    let oldRecord = backgroundEnemyTrackingState[id];
                    let newRecord = { state: m.status?.state, online: m.last_action?.status, description: m.status?.description, until: m.status?.until };
                    
                    if (oldRecord) {
                        // ── 1. TARGET ONLINE TRACKER ──
                        if (oldRecord.online !== "Online" && newRecord.online === "Online" && discordConfig.targetOnline === true) {
                            if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { title: "🟢 Target Online", description: `**${m.name}** [${id}] just established a connection and is Online!`, color: 3069299, links: [{ label: "⚔️ ATTACK", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }] });
                        }

                        // ── 2. LANDING TRACKER (FIXED: must be independent, not nested under Hospital) ──
                        const wasTravel = oldRecord.state === "Traveling" || (oldRecord.description && oldRecord.description.toLowerCase().includes("traveling"));
                        const notTravelNow = newRecord.state !== "Traveling";
                        if (wasTravel && notTravelNow && discordConfig.targetLanded !== false) {
                            if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { 
                                title: "✈️ Target Landed", 
                                description: `**${m.name}** [${id}] just landed back in Torn and is now attackable!`, 
                                color: 5809919, 
                                links: [{ label: "⚔️ ATTACK", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }] 
                            });
                        }
                        
                        // ── 3. HOSPITAL ALERTS (Natural Release + Med-Out Sniper) ──
                        if (oldRecord.state === "Hospital" && newRecord.state === "Okay") {
                            let now = Math.floor(Date.now() / 1000);
                            let leftEarly = oldRecord.until && (oldRecord.until > now + 60);

                            if (leftEarly && newRecord.online === "Online" && discordConfig.medOutSniper !== false) {
                                const { name: bestMatchName, id: bestMatchId, enemyEst } = findBestTacticalFighter(facData.members, m, id);

                                let pingStr = "";
                                if (bestMatchId) {
                                    let dId = await getDiscordId(bestMatchId);
                                    if (dId && /^\d{17,20}$/.test(dId)) pingStr = `<@${dId}>`;
                                }

                                let statStr = enemyEst > 0 ? `~${enemyEst.toLocaleString()}` : "Unknown";
                                if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { 
                                    title: "🚨 MED-OUT SNIPER ENGAGED", 
                                    description: `**${m.name}** [${id}] just used meds or received a revive to escape the hospital early and is currently ONLINE!`,
                                    color: 16729943,
                                    fields: [
                                        { name: "Target Est. Stats", value: statStr, inline: true },
                                        { name: "Tactical Assignment", value: `👉 **${bestMatchName}**, you have the stats to take them down!`, inline: false }
                                    ],
                                    links: [{ label: "⚔️ ATTACK NOW", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }]
                                }, pingStr);
                                
                            } else if (discordConfig.targetOutHosp === true && !leftEarly) {
                                if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { 
                                    title: "🏥 Target Out of Hospital", 
                                    description: `**${m.name}** [${id}] naturally finished their hospital time and is now Okay!`, 
                                    color: 16753922, 
                                    links: [{ label: "⚔️ ATTACK", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }] 
                                });
                            }
                        }
                    }
                    backgroundEnemyTrackingState[id] = newRecord;
                });

            }
        }
    } catch (err) {}
}, 30000);

let companyHistory = [];
try { if (fs.existsSync('company_history.json')) companyHistory = JSON.parse(fs.readFileSync('company_history.json')); } catch(e) {}
function saveCompanyHistory() { fs.writeFileSync('company_history.json', JSON.stringify(companyHistory)); }

setInterval(async () => {
    if (!companyConfig.globalChannelId || !companyConfig.apiKey) return;
    try {
        const resp = await fetch(`https://api.torn.com/company/?selections=profile,detailed,stock&key=${companyConfig.apiKey}`);
        const data = await resp.json();
        
        // Log History (Once per day)
        const todayStr = new Date().toISOString().split('T')[0];
        const lastEntry = companyHistory[companyHistory.length - 1];
        if (!lastEntry || lastEntry.date !== todayStr) {
            const p = data.company || {};
            const d = data.company_detailed || {};
            if (p.name) {
                companyHistory.push({
                    date: todayStr,
                    profit: p.daily_profit || d.daily_profit || 0,
                    bank: d.company_bank || 0,
                    popularity: p.popularity || d.popularity || 0,
                    customers: p.daily_customers || d.daily_customers || 0
                });
                if (companyHistory.length > 30) companyHistory.shift(); // Keep 30 days
                saveCompanyHistory();
            }
        }
        
        const stockData = data.company_stock || data.stock;
        if (!stockData) return;
        
        let changed = false;
        Object.entries(stockData).forEach(([itemName, s]) => {
            const currentStock = s.in_stock || 0;
            if (currentStock <= companyConfig.threshold) {
                if (!companyConfig.alertedItems[itemName] || companyConfig.alertedItems[itemName] !== currentStock) {
                    if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, companyConfig.globalChannelId, { title: "📉 LOW STOCK ALERT", description: `**${itemName}** is running low!\nOnly **${currentStock.toLocaleString()}** remaining in stock.`,
                        color: 15158332,
                        fields: [
                            { name: "Daily Sales Rate", value: s.sold_amount ? s.sold_amount.toString() : "0", inline: true }
                        ]
                    });
                    companyConfig.alertedItems[itemName] = currentStock;
                    changed = true;
                }
            } else {
                if (companyConfig.alertedItems[itemName]) {
                    delete companyConfig.alertedItems[itemName];
                    changed = true;
                }
            }
        });
        if (changed) saveCompanyConfig();
    } catch(e) {}
}, 60000);

async function verifySubscription(userKey) {
    if (!userKey) throw new Error("No API Key provided.");
    const now = Date.now();
    
    if (subCache[userKey] && subCache[userKey].expires > now) {
        if (userTracking[subCache[userKey].playerId]) {
            userTracking[subCache[userKey].playerId].lastActive = now;
            saveTracking();
        }
        return subCache[userKey].playerId;
    }
    
    try {
        const res = await fetch(`https://api.torn.com/user/?selections=profile&key=${userKey}`);
        const data = await res.json();
        
        if (data.error) {
            if ([5, 8, 9].includes(data.error.code) && subCache[userKey]) { return subCache[userKey].playerId; }
            if (data.error.code === 2) throw new Error("Invalid API Key.");
            throw new Error(`Torn API Throttled: Retrying link...`);
        }

        const playerId = data.player_id?.toString();
        const facId = data.faction?.faction_id?.toString();

        if (data.name && playerId) {
            userTracking[playerId] = { name: data.name, lastActive: now };
            saveTracking();
        }

        // Track the user's faction if admin faction matches, otherwise just allow any valid key
        if (facId && facId !== "0") {
            if (adminFactionId && facId === adminFactionId) {
                if (!apiPoolConfig.keys.includes(userKey)) {
                    apiPoolConfig.keys.push(userKey);
                    saveApiPool();
                }
            }
        }

        subCache[userKey] = { playerId, expires: now + 300000 };
        return playerId;
    } catch (err) {
        if (subCache[userKey]) return subCache[userKey].playerId;
        throw err;
    }
}

function computeWarIntel(p, cache = {}) {
    let score = 0;
    if (p.state === "Okay") score += 120;
    if (p.state === "Hospital") score += 60;
    if (p.onlineStatus === "Online") score += 35;
    if (p.onlineStatus === "Idle") score += 15;
    if (p.state === "Hospital" && p.until) {
        const now = Math.floor(Date.now() / 1000);
        const remaining = p.until - now;
        if (remaining > 0) {
            if (remaining < 300) score += 120;
            else if (remaining < 900) score += 80;
            else if (remaining < 3600) score += 40;
            else score += 10;
        }
    }
    const est = manualStats[p.id]?.stats || cache[p.id]?.stats || p.estStats;
    if (est && typeof est === 'number') {
        if (est < 1e7) score += 120;
        else if (est < 5e7) score += 80;
        else if (est < 2e8) score += 40;
        else score += 10;
    }
    return score;
}


async function cachedTornFetch(url, cacheKey, ttlMs = 2500) {
    const now = Date.now();
    if (globalTornCache[cacheKey] && (now - globalTornCache[cacheKey].timestamp) < ttlMs) {
        return globalTornCache[cacheKey].data;
    }
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!data.error && data.members && Object.keys(data.members).length > 0) {
            globalTornCache[cacheKey] = { timestamp: now, data };
            return data;
        }
        if (globalTornCache[cacheKey]?.data?.members && Object.keys(globalTornCache[cacheKey].data.members).length > 0) {
            return globalTornCache[cacheKey].data;
        }
        if (!data.error) {
            globalTornCache[cacheKey] = { timestamp: now, data };
        }
        return data;
    } catch (e) {
        if (globalTornCache[cacheKey]?.data?.members) {
            return globalTornCache[cacheKey].data;
        }
        return { members: {} };
    }
}

function autoDetectEnemyFaction(data) {
    if (!data || !data.ID) return null;
    const myId = data.ID.toString();
    if (data.rankedwars && Object.keys(data.rankedwars).length > 0) {
        for (let warId in data.rankedwars) {
            let w = data.rankedwars[warId];
            if (w.war && w.war.winner === 0) { 
                const factions = Object.keys(w.factions || {});
                const enemy = factions.find(id => id !== myId);
                if (enemy) return enemy;
            }
        }
    }
    return null;
}

app.get('/health', (req, res) => res.status(200).send("OK"));


app.get('/api/get-discord-config', (req, res) => { res.json(discordConfig); });

app.post('/api/save-discord-config', async (req, res) => { 
    discordConfig = { ...discordConfig, ...req.body }; 
    if (discordConfig.apiKey) {
        try {
            const profileRes = await fetch(`https://api.torn.com/user/?selections=profile&key=${discordConfig.apiKey}`);
            const profileData = await profileRes.json();
            if (profileData.faction && profileData.faction.faction_id) {
                discordConfig.factionId = profileData.faction.faction_id.toString();
                if (!apiPoolConfig.keys.includes(discordConfig.apiKey)) {
                    apiPoolConfig.keys.push(discordConfig.apiKey);
                    saveApiPool();
                }
            }
        } catch(e) {}
    }
    saveDiscordConfig(); 

    // Auto-start slash command bot whenever a new bot token is saved
    if (discordConfig.globalBotToken && discordConfig.globalBotToken.trim().length > 20) {
        startSlashCommandBot(discordConfig.globalBotToken.trim()).catch(() => {});
    }

    res.json({ success: true }); 
});

app.get('/api/get-market-config', (req, res) => { res.json(marketConfig); });
app.post('/api/save-market-config', (req, res) => { marketConfig = { ...marketConfig, ...req.body }; saveMarketConfig(); res.json({ success: true }); });

app.post('/api/test-discord-alert', async (req, res) => {
    const { type, discordId, globalChannelId, globalBotToken } = req.body;
    let chanId = globalChannelId || discordConfig.globalChannelId;
    let botToken = globalBotToken || discordConfig.globalBotToken;
    
    console.log(`[Discord Test] Triggered test alert type='${type}' for channel='${chanId ? String(chanId).slice(0, 15) : "none"}'`);

    const isWebhook = (chanId && (chanId.startsWith('http') || chanId.includes('discord.com/api/webhooks'))) ||
                      (botToken && (botToken.startsWith('http') || botToken.includes('discord.com/api/webhooks')));

    if (!isWebhook && !(botToken && chanId)) {
        return res.json({ success: false, error: "Please provide your Faction Bot Token and Channel ID, or a Discord Webhook URL." });
    }
    
    let pingStr = (discordId && /^\d{17,20}$/.test(String(discordId).trim())) ? `<@${String(discordId).trim()}>` : "";
    let embed = {};
    
    if (type === 'travel') {
        embed = {
            title: "✈️ TRAVEL WARNING",
            description: `**[Your Name]**, an enemy (**[Test] EnemyName**) is currently flying to **Mexico** where you are located (or heading)!\n\nFly away or return to Torn immediately!`,
            color: 16729943
        };
    } else if (type === 'chain') {
        embed = {
            title: "⚠️ CHAIN ATTACK WARNING",
            description: `**[Your Name]**, you have been hit 3 consecutive times in Torn! Log in and react!`,
            color: 16729943
        };
    } else {
        return res.json({ success: false, error: "Unknown test type." });
    }

    let result = await executeDiscordSend(botToken, chanId, embed, pingStr);
    console.log(`[Discord Test] Result:`, result);
    if (!result.success) return res.json({ success: false, error: result.error });
    
    res.json({ success: true, warning: result.warning || null });
});


app.post('/api/discord-ping', async (req, res) => {
    return res.json({ success: false, error: "Deprecated endpoint. Use test-discord-alert." });
});


app.get('/api/war-list', async (req, res) => {
    const userKey = (req.headers['x-api-key'] || req.query.apiKey);
    try {
        await verifySubscription(userKey);
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`);
        const facData = await facRes.json();
        if (facData.error) return res.status(400).json({ error: facData.error.error });

        let wars = [];
        if (facData.rankedwars) {
            for (let [warId, warInfo] of Object.entries(facData.rankedwars)) {
                if (warInfo.war && warInfo.war.winner === 0) continue; 
                let enemyName = "Unknown Faction";
                for (let [fId, fInfo] of Object.entries(warInfo.factions)) {
                    if (fId !== facData.ID.toString()) enemyName = fInfo.name;
                }
                wars.push({ id: warId, enemy: enemyName, start: warInfo.war.start, end: warInfo.war.end });
            }
        }
        wars.sort((a, b) => b.start - a.start);
        res.json({ success: true, wars });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.get('/api/dashboard-data', async (req, res) => {
    const userKey = (req.headers['x-api-key'] || req.query.apiKey);
    const ffKey = (req.headers['x-ff-key'] || req.query.ffKey) || null;
    try {
        await verifySubscription(userKey);
        const isPremium = (ffKey && ffKey !== "null" && ffKey.trim().length > 10);

        const basicResp = await fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`);
        const basicData = await basicResp.json();
        if (basicData.error) return res.status(400).json({ error: basicData.error.error });

        if (basicData.members) {
            Object.keys(basicData.members).forEach(id => {
                if (!activityCache[id] || (Date.now() - activityCache[id].time) > 600000) {
                    if (isPremium && !activityQueue.has(id)) activityQueue.set(id, ffKey);
                }
            });
        }

        let loans = [];
        let armoryError = false;
        const armoryResp = await fetch(`https://api.torn.com/faction/?selections=armor,weapons,temporary&key=${userKey}`);
        const armoryData = await armoryResp.json();

        if (armoryData.error) { armoryError = true; } 
        else {
            const findLoans = (obj, typeName) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.loaned_to) {
                    let loanStr = String(obj.loaned_to).trim();
                    if (loanStr !== "0" && loanStr !== "null" && loanStr !== "") {
                        loanStr.split(',').forEach(l => { loans.push({ name: obj.name || "Unknown Item", loaned_to: l.trim(), type: typeName }); });
                    }
                    return; 
                }
                Object.values(obj).forEach(val => findLoans(val, typeName));
            };
            findLoans(armoryData.armor, "Armor");
            findLoans(armoryData.weapons, "Weapon");
            findLoans(armoryData.temporary, "Temporary");
        }

        let parsedMembers = {};
        if (basicData.members) {
            Object.entries(basicData.members).forEach(([id, m]) => {
                parsedMembers[id] = { ...m, timeline: isPremium ? (activityCache[id]?.timeline || null) : null, timelineTime: isPremium ? (activityCache[id]?.time || null) : null };
            });
        }

        // Fetch chain and ranked war data
        let chain = null;
        let activeWar = null;
        try {
            const chainResp = await fetch(`https://api.torn.com/faction/?selections=chain,rankedwars&key=${userKey}`);
            const chainData = await chainResp.json();
            if (!chainData.error) {
                chain = chainData.chain || null;
                if (chainData.rankedwars) {
                    for (const [warId, warInfo] of Object.entries(chainData.rankedwars)) {
                        if (warInfo.war && warInfo.war.winner === 0) {
                            const facIds = Object.keys(warInfo.factions || {});
                            const myFacId = basicData.ID?.toString();
                            const enemyFacId = facIds.find(id => id !== myFacId);
                            const myFacData = warInfo.factions[myFacId] || {};
                            const enemyFacData = enemyFacId ? (warInfo.factions[enemyFacId] || {}) : {};
                            activeWar = {
                                warId,
                                myFaction: basicData.name || 'Your Faction',
                                enemyFaction: enemyFacData.name || 'Enemy Faction',
                                myScore: myFacData.score || 0,
                                enemyScore: enemyFacData.score || 0,
                                target: warInfo.war.target || 0,
                                start: warInfo.war.start
                            };
                            break;
                        }
                    }
                }
            }
        } catch(e) {}

        const faction = {
            name: basicData.name,
            ID: basicData.ID,
            tag: basicData.tag,
            level: basicData.level,
            age: basicData.age,
            respect: basicData.respect,
            best_chain: basicData.best_chain,
            capacity: basicData.capacity
        };

        res.json({ success: true, members: parsedMembers, loans, armoryError, premiumActive: isPremium, chain, activeWar, faction });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.get('/api/company', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    try {
        await verifySubscription(apiKey);
        const resp = await fetch(`https://api.torn.com/company/?selections=profile,detailed,employees,stock&key=${apiKey}`);
        const data = await resp.json();
        
        if (data.error) {
            return res.status(400).json({ error: "Torn API Error: " + data.error.error });
        }
        
        res.json({ success: true, company: data });
    } catch (err) { 
        res.status(403).json({ error: err.message }); 
    }
});

app.get('/api/scan-recruits', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const ffKey = req.headers['x-ff-key'] || req.query.ffKey;
    const { reportId, minLevel, maxLevel, donatorFilter, maxAge, maxLastActionHours } = req.query;
    try {
        const myUserId = await verifySubscription(apiKey);
        const isPremium = (ffKey && ffKey !== "null" && ffKey.trim().length > 10);

        const reportRes = await fetch(`https://api.torn.com/torn/${reportId}?selections=rankedwarreport&key=${apiKey}`);
        const reportData = await reportRes.json();
        if (reportData.error) return res.status(400).json({ error: "Torn API Error: " + reportData.error.error });

        let myFacId = null; let enemyFacId = null;
        for (let [facId, facData] of Object.entries(reportData.rankedwarreport.factions)) {
            if (facData.members && facData.members[myUserId]) { myFacId = facId; } else { enemyFacId = facId; }
        }
        if (!myFacId) {
            const userRes = await fetch(`https://api.torn.com/user/?selections=profile&key=${apiKey}`);
            const userData = await userRes.json();
            myFacId = userData.faction?.faction_id?.toString();
            enemyFacId = Object.keys(reportData.rankedwarreport.factions).find(id => id !== myFacId);
        }
        if (!enemyFacId) return res.status(400).json({ error: "Could not identify the enemy faction." });

        const enemyWarData = reportData.rankedwarreport.factions[enemyFacId];
        const currentEnemyRes = await fetch(`https://api.torn.com/faction/${enemyFacId}?selections=basic&key=${apiKey}`);
        const currentEnemyData = await currentEnemyRes.json();
        const currentRoster = currentEnemyData.members || {};

        // Collect meaningful combatants (score > 50 OR attacks > 3 — lower threshold, let filters handle it)
        let candidates = [];
        for (let [id, m] of Object.entries(enemyWarData.members || {})) {
            if (m.score <= 50 && m.attacks <= 3) continue;
            let currentStatus = "Factionless"; let position = "None"; let daysInFaction = 0; let isPoachable = true;
            if (currentRoster[id]) {
                position = currentRoster[id].position || "Member"; daysInFaction = currentRoster[id].days_in_faction || 0;
                if (position.toLowerCase().match(/(leader|management|council|co-leader)/)) { isPoachable = false; }
                else { currentStatus = `Member (${position})`; }
            }
            if (isPoachable) {
                const efficiency = m.attacks > 0 ? parseFloat((m.score / m.attacks).toFixed(1)) : 0;
                candidates.push({ id, name: m.name, score: m.score, attacks: m.attacks, efficiency, status: currentStatus, days: daysInFaction, stillInFaction: !!currentRoster[id] });
            }
        }

        // Batch-fetch profiles for level/age/donator/last_action data (batches of 5 to stay under rate limits)
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        const profileBatchSize = 5;
        for (let i = 0; i < candidates.length; i += profileBatchSize) {
            const batch = candidates.slice(i, i + profileBatchSize);
            await Promise.all(batch.map(async (c) => {
                try {
                    const useKey = getNextApiKey() || apiKey;
                    const pRes = await fetch(`https://api.torn.com/user/${c.id}?selections=profile,personalstats&key=${useKey}`);
                    const pData = await pRes.json();
                    if (pData.error) return;
                    const profile = pData.profile || pData;
                    const ps = pData.personalstats || {};
                    c.level = profile.level || 1;
                    c.age = profile.age || 1;
                    c.playtime = parseFloat(((ps.useractivity || 0) / 86400).toFixed(1));
                    c.xanax = ps.xantaken || 0;
                    c.refills = ps.refills || 0;
                    c.se = ps.statenhancersused || 0;
                    c.awards = profile.awards || 0;
                    c.donator = profile.donator === 1 || profile.donator === true;
                    c.last_action_timestamp = (profile.last_action && profile.last_action.timestamp) ? profile.last_action.timestamp : 0;
                    c.velocity = parseFloat((c.level / c.age).toFixed(4));
                    c.xanPerDay = parseFloat((c.xanax / c.age).toFixed(3));
                    c.refillsPerDay = parseFloat((c.refills / c.age).toFixed(3));

                    // Compute recruit grade for war targets too
                    let score = 0;
                    const fm = 1.0;
                    score += (c.velocity * 100);
                    score += (c.xanPerDay * 18);
                    score += c.refillsPerDay * 8;
                    if (c.last_action_timestamp) {
                        const h = (Date.now() / 1000 - c.last_action_timestamp) / 3600;
                        if (h < 6) score += 50; else if (h < 24) score += 30; else if (h < 72) score += 10;
                    }
                    if (c.awards) score += Math.min(c.awards * 0.4, 40);
                    if (c.donator) score += 25;
                    // Also factor in war performance
                    score += Math.min(c.score / 100, 50);
                    score += Math.min(c.efficiency * 2, 30);
                    c.recruitScore = parseFloat(score.toFixed(1));
                    if (score >= 150) c.scoutGrade = "S";
                    else if (score >= 110) c.scoutGrade = "A";
                    else if (score >= 70) c.scoutGrade = "B";
                    else if (score >= 35) c.scoutGrade = "C";
                    else if (score > 10) c.scoutGrade = "D";
                    else c.scoutGrade = "F";
                    c.estStats = statsCache[c.id] ? statsCache[c.id].stats : (isPremium ? "Scanning..." : "—");
                } catch(e) {}
            }));
            if (i + profileBatchSize < candidates.length) await delay(300);
        }

        // Apply filters
        let filtered = candidates.filter(c => {
            if (c.level === undefined) return true; // profile fetch failed, keep it
            if (minLevel && c.level < parseInt(minLevel)) return false;
            if (maxLevel && c.level > parseInt(maxLevel)) return false;
            if (maxAge && c.age > parseInt(maxAge)) return false;
            if (donatorFilter === "donator" && !c.donator) return false;
            if (donatorFilter === "nondonator" && c.donator) return false;
            if (maxLastActionHours && c.last_action_timestamp) {
                const h = (Date.now()/1000 - c.last_action_timestamp) / 3600;
                if (h > parseFloat(maxLastActionHours)) return false;
            }
            return true;
        });

        // Bulk FFScouter
        const ffKeyToUse = (ffKey && ffKey !== "null" && ffKey.trim().length > 5) ? ffKey : (global.marketConfig && global.marketConfig.ffscouterKey ? global.marketConfig.ffscouterKey : "");
        if (ffKeyToUse && filtered.length > 0) {
            try {
                const batchIds = filtered.map(r => r.id).join(',');
                const ffRes = await fetch(`https://ffscouter.com/api/v1/get-stats?key=${ffKeyToUse}&targets=${batchIds}`);
                const ffData = await ffRes.json();
                if (Array.isArray(ffData)) {
                    const sm = {};
                    ffData.forEach(p => { sm[p.player_id.toString()] = p.bs_estimate; });
                    filtered.forEach(r => { if (sm[r.id.toString()]) r.estStats = sm[r.id.toString()]; });
                }
            } catch(e) {}
        }

        filtered.sort((a, b) => (b.recruitScore || b.score) - (a.recruitScore || a.score));
        res.json({ success: true, recruits: filtered, enemyName: enemyWarData.name });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

// --- NEW RECRUITMENT SCANNING ENDPOINTS ---

function calculateProgIndex(level, xanax, playtimeDays, weightPlaytime, weightLevel) {
    const activeDays = playtimeDays || 0.1;
    const levelProg = level / (activeDays + 1);
    const xanaxProg = xanax / (activeDays + 1);
    const wp = parseFloat(weightPlaytime) || 1.0;
    const wl = parseFloat(weightLevel) || 1.0;
    return parseFloat(((levelProg * wl) + (xanaxProg * 0.1) - (playtimeDays * wp * 0.01)).toFixed(2));
}

app.post('/api/analyze-player-list', async (req, res) => {
    const { apiKey, playerIds, donatorFilter, maxPlaytime, weightPlaytime, weightLevel, ffKey } = req.body;
    if (!playerIds || !Array.isArray(playerIds) || playerIds.length === 0) return res.status(400).json({ error: "Missing player IDs" });
    
    try {
        const results = [];
        const batchSize = 10;
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        for (let i = 0; i < playerIds.length; i += batchSize) {
            const batchIds = playerIds.slice(i, i + batchSize);
            const batchPromises = batchIds.map(async (id) => {
                const useKey = getNextApiKey() || apiKey;
                try {
                    const userRes = await fetch(`https://api.torn.com/user/${id}?selections=profile,personalstats&key=${useKey}`);
                    const userData = await userRes.json();
                    if (userData.error) return null;

                    const profile = userData.profile || userData;
                    const personalstats = userData.personalstats || {};
                    const playtimeSec = personalstats.useractivity || 0;
                    const playtimeDays = parseFloat((playtimeSec / 86400).toFixed(1));
                    const xanax = personalstats.xantaken || 0;
                    const refills = personalstats.refills || 0;
                    const se = personalstats.statenhancersused || 0;
                    const donator = profile.donator === 1 || profile.donator === true;
                    const age = profile.age || 1;
                    const level = profile.level || 1;
                    const lastActionTs = (profile.last_action && profile.last_action.timestamp) ? profile.last_action.timestamp : 0;

                    if (profile.status && (profile.status.state === "Federal" || profile.status.state === "Fallen")) return null;

                    if (donatorFilter === "donator" && !donator) return null;
                    if (donatorFilter === "nondonator" && donator) return null;
                    if (maxPlaytime && playtimeDays > parseFloat(maxPlaytime)) return null;

                    const velocity = parseFloat((level / age).toFixed(4));
                    const xanPerDay = parseFloat((xanax / age).toFixed(3));
                    const refillsPerDay = parseFloat((refills / age).toFixed(3));
                    const sePerDay = parseFloat((se / age).toFixed(3));
                    const fm = parseFloat(weightLevel) || 1.0;

                    // Compute recruit score (same formula as DB scan)
                    let score = 0;
                    score += (velocity * 100) * (fm > 1 ? fm * 1.2 : 1.0);
                    score += (xanPerDay * 18) * (fm < 1.5 ? 1.2 : 0.6);
                    score += refillsPerDay * 8;
                    score += sePerDay * 5;
                    if (lastActionTs) {
                        const hoursInactive = (Date.now() / 1000 - lastActionTs) / 3600;
                        if (hoursInactive < 6)  score += 50;
                        else if (hoursInactive < 24) score += 30;
                        else if (hoursInactive < 72) score += 10;
                    }
                    if (profile.awards) score += Math.min(profile.awards * 0.4, 40);
                    if (donator) score += 25;
                    if (level < 20) {
                        if (level < age * 0.5) score -= 80;
                        else if (level > age * 2.0) score += 35;
                    }
                    const recruitScore = parseFloat(score.toFixed(1));
                    let scoutGrade = "F";
                    if (score >= 150) scoutGrade = "S";
                    else if (score >= 110) scoutGrade = "A";
                    else if (score >= 70) scoutGrade = "B";
                    else if (score >= 35) scoutGrade = "C";
                    else if (score > 10) scoutGrade = "D";

                    const factionName = profile.faction && profile.faction.faction_id && profile.faction.faction_id !== 0 
                        ? profile.faction.faction_name || "In Faction"
                        : "Factionless";

                    return {
                        id: id.toString(),
                        name: profile.name,
                        level,
                        age,
                        playtime: playtimeDays,
                        xanax,
                        refills,
                        se,
                        estStats: "Not yet available",
                        donator,
                        awards: profile.awards || 0,
                        last_action_timestamp: lastActionTs,
                        status: profile.status ? `${profile.status.state} (${profile.status.description || ''})` : "Offline",
                        faction: factionName,
                        velocity,
                        xanPerDay,
                        refillsPerDay,
                        sePerDay,
                        progIndex: recruitScore,
                        recruitScore,
                        scoutGrade,
                        score_breakdown: `Lvl/Day: ${velocity} | Xan/Day: ${xanPerDay} | Active: ${lastActionTs ? Math.floor((Date.now()/1000-lastActionTs)/3600)+'h ago' : '?'}`
                    };
                } catch (e) {
                    return null;
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.filter(r => r !== null));
            if (i + batchSize < playerIds.length) await delay(200);
        }

        // Sort by recruit score descending
        results.sort((a, b) => b.recruitScore - a.recruitScore);

        // Bulk FFScouter stats if key provided
        const ffKeyToUse = ffKey && ffKey !== "null" ? ffKey : (global.marketConfig && global.marketConfig.ffscouterKey ? global.marketConfig.ffscouterKey : "");
        if (ffKeyToUse && ffKeyToUse.length > 5 && results.length > 0) {
            try {
                const batchIds = results.map(r => r.id).join(',');
                const ffRes = await fetch(`https://ffscouter.com/api/v1/get-stats?key=${ffKeyToUse}&targets=${batchIds}`);
                const ffData = await ffRes.json();
                if (Array.isArray(ffData)) {
                    const statsMap = {};
                    ffData.forEach(p => { statsMap[p.player_id.toString()] = p.bs_estimate; });
                    results.forEach(r => {
                        if (statsMap[r.id.toString()]) r.estStats = statsMap[r.id.toString()];
                    });
                }
            } catch(e) { console.error("FFScouter import bulk:", e.message); }
        }

        // Save good recruits to pipeline automatically
        if (typeof pipeline !== 'undefined' && pipeline.prospects) {
            let addedCount = 0;
            const existingIds = new Set(pipeline.prospects.map(p => p.id));
            
            for (let r of results) {
                if (r.scoutGrade === 'S' || r.scoutGrade === 'A' || r.scoutGrade === 'B' || r.recruitScore >= 50) {
                    if (!existingIds.has(r.id)) {
                        pipeline.prospects.push(r);
                        existingIds.add(r.id);
                        addedCount++;
                    }
                }
            }
            if (addedCount > 0) {
                savePipeline();
                console.log(`Saved ${addedCount} imported recruits to database.`);
            }
        }

        res.json({ success: true, recruits: results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/scan-random-players', async (req, res) => {
    const { minLevel, maxLevel, donatorFilter, maxPlaytime, maxAge, minAwards, maxLastActionHours, weightLevel, ffKey } = req.query;
    
    try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
        const recruitsFile = path.join(__dirname, 'data', 'recruits.json');
        let cachedRecruits = [];
        if (process.env.MONGODB_URI) {
            if (mongoose.connection.readyState !== 1) { // 1 = connected
                throw new Error("MongoDB Connection Failed! Reason: " + (global.mongoConnectionError || "Still trying to connect... check IP whitelist."));
            }
            cachedRecruits = await Recruit.find({}).lean();
        } else {
            if (fs.existsSync(recruitsFile)) {
                cachedRecruits = JSON.parse(fs.readFileSync(recruitsFile, 'utf8'));
            }
        }
        
        if (typeof pipeline !== 'undefined' && pipeline.prospects && Array.isArray(pipeline.prospects)) {
            const existingIds = new Set(cachedRecruits.map(r => r.id));
            for (let r of pipeline.prospects) {
                if (!existingIds.has(r.id)) {
                    cachedRecruits.push(r);
                    existingIds.add(r.id);
                }
            }
        }

        // Filter the cached database
        let results = cachedRecruits.filter(profile => {
            const level = profile.level;
            if (minLevel && level < parseInt(minLevel)) return false;
            if (maxLevel && level > parseInt(maxLevel)) return false;
            
            if (donatorFilter === "donator" && !profile.donator) return false;
            if (donatorFilter === "nondonator" && profile.donator) return false;
            
            if (maxPlaytime && parseFloat(profile.playtime) > parseFloat(maxPlaytime)) return false;
            if (maxAge && parseFloat(profile.age) > parseFloat(maxAge)) return false;
            
            if (minAwards && (profile.awards || 0) < parseInt(minAwards)) return false;
            
            if (maxLastActionHours && profile.last_action_timestamp) {
                const hoursInactive = (Date.now() / 1000 - profile.last_action_timestamp) / 3600;
                if (hoursInactive > parseFloat(maxLastActionHours)) return false;
            }
            
            return true;
        });

        // Calculate Composite Recruit Score
        const focusMultiplier = parseFloat(weightLevel) || 1.0;
        
        results = results.map(r => {
            if (!r.estStats) r.estStats = "Not yet available";
            const age = r.age || 1;
            const playtime = r.playtime || 0.1;
            r.xanPerDay = parseFloat((r.xanax / age).toFixed(3));
            r.refillsPerDay = parseFloat(((r.refills || 0) / age).toFixed(3));
            r.sePerDay = parseFloat(((r.se || 0) / age).toFixed(3));
            // velocity = levels gained per account day (stored for sorting)
            r.velocity = parseFloat((r.level / age).toFixed(4));
            
            let score = 0;
            const levelPerAge = r.level / age;
            const fm = focusMultiplier;

            // Core: progression speed weighted by focus slider
            // Growth mode (fm>1) rewards level/age velocity more
            // Balanced mode rewards xanax consumption equally
            score += (levelPerAge * 100) * (fm > 1 ? fm * 1.2 : 1.0);
            score += (r.xanPerDay * 18) * (fm < 1.5 ? 1.2 : 0.6);

            // Supplemental activity signals
            score += r.refillsPerDay * 8;
            score += r.sePerDay * 5;

            // Activity recency bonus — strong incentive to find active players
            if (r.last_action_timestamp) {
                const hoursInactive = (Date.now() / 1000 - r.last_action_timestamp) / 3600;
                if (hoursInactive < 6)  score += 50;
                else if (hoursInactive < 24) score += 30;
                else if (hoursInactive < 72) score += 10;
            }

            // Awards — strong signal of engagement
            if (r.awards) score += Math.min(r.awards * 0.4, 40);

            // Donator/subscriber is a commitment signal
            if (r.donator) score += 25;

            // Fast starter bonus/penalty
            if (r.level < 20) {
                if (r.level < r.age * 0.5) score -= 80; // very slow for age
                else if (r.level > r.age * 2.0) score += 35; // blazing fast
            }

            r.recruitScore = parseFloat(score.toFixed(1));

            // Grade thresholds (tuned for new formula)
            if (score >= 150) r.scoutGrade = "S";
            else if (score >= 110) r.scoutGrade = "A";
            else if (score >= 70)  r.scoutGrade = "B";
            else if (score >= 35)  r.scoutGrade = "C";
            else if (score > 10)   r.scoutGrade = "D";
            else r.scoutGrade = "F";

            // Score breakdown for tooltip
            r.score_breakdown = `Lvl/Day: ${levelPerAge.toFixed(3)} | Xan/Day: ${r.xanPerDay} | Refills/Day: ${r.refillsPerDay} | Active: ${r.last_action_timestamp ? Math.floor((Date.now()/1000-r.last_action_timestamp)/3600)+'h ago' : '?'}`;

            return r;
        });

        // Sort by composite score
        results.sort((a, b) => b.recruitScore - a.recruitScore);
        
        let finalRecruits = results.slice(0, 100);
        
        // BULK FETCH FF SCOUTER STATS
        const keyToUse = ffKey && ffKey !== "null" ? ffKey : (global.marketConfig && global.marketConfig.ffscouterKey ? global.marketConfig.ffscouterKey : "");
        if (keyToUse && keyToUse.length > 5) {
            try {
                const batchIds = finalRecruits.map(r => r.id).join(',');
                if (batchIds.length > 0) {
                    const ffRes = await fetch(`https://ffscouter.com/api/v1/get-stats?key=${keyToUse}&targets=${batchIds}`);
                    const ffData = await ffRes.json();
                    if (Array.isArray(ffData)) {
                        const statsMap = {};
                        ffData.forEach(p => { statsMap[p.player_id.toString()] = p.bs_estimate; });
                        finalRecruits = finalRecruits.map(r => {
                            if (statsMap[r.id.toString()]) r.estStats = statsMap[r.id.toString()];
                            else r.estStats = "Not yet available";
                            return r;
                        });
                    }
                }
            } catch(e) { console.error("FFScouter Bulk Error", e); }
        }
        
        res.json({ success: true, recruits: finalRecruits });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/generate-recruit-msg', async (req, res) => {
    const { playerName, score, attacks, efficiency, playtime, xanax, level, status, estStats, enemyFaction } = req.body;
    const factionless = status && status.toLowerCase().includes("factionless");
    const fallback = `Hey ${playerName}!\n\nI was looking at your stats and noticed your solid progression.\n\n${factionless ? "I noticed you're currently factionless, so the timing seems perfect." : "I know you're currently in a faction, but I wanted to reach out anyway."}\n\nWe run a tight, active crew focused on ranked wars and organized crimes. We'd love to have someone with your stats on our side. If you're ever looking for a change, hit me back — happy to chat.\n\nOwen777 [3776908]`;

    if (!GEMINI_API_KEY) return res.json({ message: fallback, source: "template" });

    try {
        const prompt = `You are writing a Torn City (browser game) faction recruitment message. Keep it short (3-4 paragraphs max), casual, direct and personalized. Do NOT use generic filler like "I hope this message finds you well". Sound like a real player, not a robot.\n\nPlayer: ${playerName}\nLevel: ${level || 'Unknown'}\nPlaytime: ${playtime ? playtime + ' days' : 'Unknown'}\nXanax taken: ${xanax || 'Unknown'}\nWar stats: ${score && score !== "N/A" ? score + " score, " + attacks + " hits" : "N/A"}\nEst. Battle Stats: ${estStats || "Unknown"}\nCurrent faction status: ${status}\nEnemy faction they fought for (if any): ${enemyFaction || "None"}\n\nWrite a compelling recruitment message. If they have high war stats, mention them. If they have low playtime but high level/xanax, praise their fast progression. ${factionless ? "They are now factionless — emphasize this is a perfect time." : "Be respectful that they are still in a faction."} Sign off from Owen777 [3776908].`;

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const geminiData = await geminiRes.json();
        const message = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!message) throw new Error("Empty response");
        res.json({ message, source: "ai" });
    } catch (e) {
        res.json({ message: fallback, source: "template" });
    }
});



app.get('/api/past-war', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const reportId = req.query.reportId;
    try {
        await verifySubscription(apiKey);
        const [userRes, reportRes, itemsRes] = await Promise.all([
            fetch(`https://api.torn.com/user/?selections=profile&key=${apiKey}`),
            fetch(`https://api.torn.com/torn/${reportId}?selections=rankedwarreport&key=${apiKey}`),
            fetch(`https://api.torn.com/torn/?selections=items&key=${apiKey}`)
        ]);
        const userData = await userRes.json(); const reportData = await reportRes.json(); const itemsData = await itemsRes.json();
        if (userData.error) return res.status(400).json({ error: "Invalid API Key." });
        if (reportData.error) return res.status(400).json({ error: "Torn API Error: " + reportData.error.error });

        let correctFacId = null;
        let enemyFacId = null;
        const myUserId = userData.player_id.toString();

        for (let [facId, facData] of Object.entries(reportData.rankedwarreport.factions)) {
            if (facData.members && facData.members[myUserId]) { correctFacId = facId; } else { enemyFacId = facId; }
        }

        if (!correctFacId) {
            correctFacId = userData.faction?.faction_id?.toString();
            enemyFacId = Object.keys(reportData.rankedwarreport.factions).find(id => id !== correctFacId);
        }

        const myFactionWarData = reportData.rankedwarreport?.factions[correctFacId];
        if (!myFactionWarData) return res.status(400).json({ error: "Your faction was not part of this Ranked War Report." });

        let totalCacheValue = 0; let cachesWon = [];
        if (myFactionWarData?.rewards?.items) {
            for (let [itemId, itemInfo] of Object.entries(myFactionWarData.rewards.items)) {
                const iv = itemsData.items?.[itemId]?.market_value || 0;
                totalCacheValue += iv * itemInfo.quantity;
                cachesWon.push({ name: itemInfo.name || "Cache", quantity: itemInfo.quantity, marketValue: iv, totalValue: iv * itemInfo.quantity });
            }
        }

        let advancedStats = {};
        if (warScrapeCache_v2[reportId]) {
            advancedStats = warScrapeCache_v2[reportId];
        } else {
            let warStart = reportData.rankedwarreport.war.start;
            let warEnd = reportData.rankedwarreport.war.end || Math.floor(Date.now() / 1000);
            
            let toTimestamp = warEnd;
            let keepScraping = true;
            let pageCount = 0;
            
            while (keepScraping && pageCount < 200) { 
                const attackRes = await fetch(`https://api.torn.com/faction/?selections=attacks&to=${toTimestamp}&key=${apiKey}`);
                const attackData = await attackRes.json();
                
                if (attackData.error || !attackData.attacks) break;
                
                let attacks = Object.values(attackData.attacks);
                if (attacks.length === 0) break;
                
                let oldestTime = toTimestamp;
                
                for (let atk of attacks) {
                    if (atk.timestamp_ended < oldestTime) oldestTime = atk.timestamp_ended;
                    
                    if (atk.timestamp_ended < warStart) { keepScraping = false; continue; }
                    if (atk.timestamp_ended > warEnd) continue;
                    
                    let isWin = ["Hospitalized", "Mugged", "Arrested", "Looted", "Assist", "Attacked", "Special"].includes(atk.result);
                    if (isWin && atk.attacker_faction && atk.attacker_faction.toString() === correctFacId) {
                        let uId = atk.attacker_id.toString();
                        if (!advancedStats[uId]) advancedStats[uId] = { hits: [] };
                        
                        let isEnemy = (atk.defender_faction !== undefined && atk.defender_faction.toString() === enemyFacId);
                        advancedStats[uId].hits.push({
                            t: atk.timestamp_ended,
                            r: atk.result,
                            ff: atk.modifiers?.fair_fight || 1.0,
                            ret: atk.modifiers?.retaliation || 1.0,
                            os: atk.modifiers?.overseas || 1.0,
                            res: atk.respect || 0,
                            tgt: isEnemy ? 1 : 0
                        });
                    }
                }
                toTimestamp = oldestTime - 1;
                pageCount++;
                await new Promise(r => setTimeout(r, 250)); 
            }
            warScrapeCache_v2[reportId] = advancedStats;
        }

        let formattedMembers = [];
        const members = myFactionWarData.members || {};
        for (let [id, m] of Object.entries(members)) {
            let pStats = advancedStats[id] || { hits: [] };
            formattedMembers.push({
                id,
                name: m.name,
                attacks: m.attacks || 0,
                score: m.score || 0,
                hits: pStats.hits
            });
        }

        res.json({ success: true, members: formattedMembers, rewards: { totalCacheValue, caches: cachesWon, points: myFactionWarData?.rewards?.points||0, respect: myFactionWarData?.rewards?.respect||0 } });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.get('/api/claims', (req, res) => { res.json({ success: true, claims, backups, manualStats }); });
app.post('/api/claim', (req, res) => { const { enemyId, playerName } = req.body; claims[enemyId] = { playerName, time: Date.now() }; res.json({ success: true }); });
app.post('/api/unclaim', (req, res) => { const { enemyId, playerName } = req.body; if (claims[enemyId]?.playerName === playerName) delete claims[enemyId]; res.json({ success: true }); });
app.post('/api/backup', (req, res) => { const { enemyId, playerName } = req.body; backups[enemyId] = { playerName, time: Date.now() }; res.json({ success: true }); });
app.post('/api/unbackup', (req, res) => { const { enemyId } = req.body; delete backups[enemyId]; res.json({ success: true }); });
app.post('/api/update-stats', (req, res) => { const { enemyId, stats } = req.body; manualStats[enemyId] = { stats: parseInt(stats), time: Date.now() }; res.json({ success: true }); });

app.get('/api/inspect', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const tsKey = req.headers['x-ts-key'] || req.query.tsKey;
    const targetId = req.query.targetId;
    try {
        await verifySubscription(apiKey);
        const r = await fetch(`https://api.torn.com/user/${targetId}?selections=profile,personalstats,bazaar,display&key=${apiKey}`);
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: data.error.error });

        let loadoutClues = [];
        const checkItems = (items) => {
            if (!items) return;
            items.forEach(item => {
                if (item.type === "Primary" || item.type === "Secondary" || item.type === "Melee" || item.type === "Armor") {
                    loadoutClues.push({ name: item.name, type: item.type, price: item.price || item.market_value || 0 });
                }
            });
        };
        checkItems(data.bazaar); checkItems(data.display);
        loadoutClues.sort((a, b) => b.price - a.price);
        loadoutClues = loadoutClues.slice(0, 5);

        let tsData = null;
        if (tsKey && tsKey !== 'null' && tsKey !== '') {
            try {
                const tsRes = await fetch(`https://www.tornstats.com/api/v2/${tsKey}/spy/user/${targetId}`);
                const tsJson = await tsRes.json();
                if (tsJson.status && tsJson.spy) { tsData = tsJson.spy; }
            } catch(e) {}
        }

        let manualSpy = spyDatabase[targetId] || null;

        res.json({ success: true, data, loadoutClues, tsData, manualSpy });
    } catch(err) { res.status(403).json({ error: err.message }); }
});

app.post('/api/save-spy', async (req, res) => {
    const { apiKey, targetId, spyText } = req.body;
    try {
        await verifySubscription(apiKey);
        if (!targetId || !spyText) return res.status(400).json({error: "Missing data"});
        
        const extract = (regex) => {
            const match = spyText.match(regex);
            return match ? parseInt(match[1].replace(/,/g, '')) : 0;
        };

        const strength = extract(/Strength:\s*([\d,]+)/i);
        const defense = extract(/Defense:\s*([\d,]+)/i);
        const speed = extract(/Speed:\s*([\d,]+)/i);
        const dexterity = extract(/Dexterity:\s*([\d,]+)/i);
        const total = extract(/Total:\s*([\d,]+)/i);

        if (total === 0 && strength === 0 && defense === 0) {
            return res.status(400).json({error: "Could not parse spy report. Make sure you copied the exact text."});
        }

        spyDatabase[targetId] = { strength, defense, speed, dexterity, total, timestamp: Date.now() };
        saveSpyDb();
        manualStats[targetId] = { stats: total, time: Date.now() };

        res.json({success: true, data: spyDatabase[targetId]});
    } catch(err) { res.status(403).json({ error: err.message }); }
});

app.get('/api/warboard', async (req, res) => {
    if (global.isTurboMining) return res.json({ error: "Turbo Mining Mode is active. Live Warboard is paused." });
    try {
        const userKey = (req.headers['x-api-key'] || req.query.apiKey) && (req.headers['x-api-key'] || req.query.apiKey) !== "null" ? (req.headers['x-api-key'] || req.query.apiKey) : TORN_API_KEY;
        const ffKey = (req.headers['x-ff-key'] || req.query.ffKey) && (req.headers['x-ff-key'] || req.query.ffKey) !== "null" && (req.headers['x-ff-key'] || req.query.ffKey) !== "" ? (req.headers['x-ff-key'] || req.query.ffKey) : null;
        await verifySubscription(userKey);

        const isPremium = (ffKey && ffKey !== "null" && ffKey.trim().length > 10);
        let enemyId = (req.headers['x-enemy-id'] || req.query.enemyFaction) || null;
        
        let activeKey = userKey;
        let [myData, enemyDataResult] = await Promise.all([
            cachedTornFetch(`https://api.torn.com/faction/?selections=basic,rankedwars,attacks&key=${userKey}`, `my_faction_${userKey}`, 2500),
            enemyId ? cachedTornFetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${getNextApiKey()||userKey}`, `enemy_faction_${enemyId}`, 2500) : Promise.resolve({ members: {} })
        ]);
        
        if (!enemyId) enemyId = autoDetectEnemyFaction(myData);
        if (enemyId && Object.keys(enemyDataResult.members || {}).length === 0) { 
            enemyDataResult = await cachedTornFetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${getNextApiKey()||userKey}`, `enemy_faction_${enemyId}`, 2500); 
        }

        if (myData && myData.ID) dynamicFactionId = myData.ID.toString();

        let activeWar = null;
        if (myData.rankedwars) {
            activeWar = Object.values(myData.rankedwars).find(w => w.war && w.war.winner === 0);
        }
        let myWarMembers = activeWar && myData.ID ? (activeWar.factions[myData.ID.toString()]?.members || {}) : {};
        let enemyWarMembers = activeWar && enemyId ? (activeWar.factions[enemyId]?.members || {}) : {};

        // If war is active, trigger backfill from exact start if needed, and process incoming attack logs
        if (activeWar && activeWar.war && myData.ID) {
            let warStart = activeWar.war.start;
            let warEnd = activeWar.war.end || 0;
            currentEnemyFacId = enemyId;

            if (activeWarId !== warStart) {
                activeWarId = warStart;
                activeWarEnd = warEnd;
                liveWarHits = {};
                liveOutsideHits = {};
                liveAssists = {};
                liveWarDefendsWon = {};
                liveOutsideDefendsWon = {};
                liveWarHitsTaken = {};
                liveOutsideHitsTaken = {};
                hasBackfilledWar = false;
                processedAttackIds.clear();
                backfillWarDefends(userKey, myData.ID, warStart, enemyId, warEnd);
            } else if (!hasBackfilledWar && !isBackfillingWar) {
                backfillWarDefends(userKey, myData.ID, warStart, enemyId, warEnd);
            }

            if (myData.attacks && typeof myData.attacks === 'object') {
                for (let atk of Object.values(myData.attacks)) {
                    processWarAttack(atk, myData.ID, enemyId, warStart, warEnd);
                }
            }
        }

        const friendlyIds = new Set(Object.keys(myData.members || {}));
        const enemyIds = new Set(Object.keys(enemyDataResult.members || {}));
        
        [...friendlyIds, ...enemyIds].forEach(id => {
            if (!statsCache[id] || (Date.now() - statsCache[id].time) > 3600000) { if (isPremium && !statQueue.has(id)) statQueue.set(id, ffKey); }
            if (!activityCache[id] || (Date.now() - activityCache[id].time) > 3600000) { if (isPremium && !activityQueue.has(id)) activityQueue.set(id, ffKey); }
            const m = myData.members[id] || enemyDataResult.members[id];
            const isTraveling = m.status?.state === "Traveling" || m.status?.description?.includes("Traveling");
            if (isTraveling) { if (!flightCache[id] || (Date.now() - flightCache[id].time) > 30000) { if (isPremium && !flightQueue.has(id)) flightQueue.set(id, ffKey); } }
        });

        const parseMembers = (data, isEnemy = false) => {
            if (!data.members) return [];
            return Object.entries(data.members).map(([id, m]) => {
                let est = (spyDatabase[id] && spyDatabase[id].total) ? spyDatabase[id].total : (manualStats[id]?.stats !== undefined ? manualStats[id].stats : (statsCache[id]?.stats !== undefined ? statsCache[id].stats : (isPremium ? "Scanning..." : "🔒 Requires FF Scouter")));
                
                const isTraveling = m.status?.state === "Traveling" || m.status?.description?.includes("Traveling");
                let finalUntil = m.status?.until; let finalLandingTime = null; let needsFfScouterForFlights = false;
                if (isTraveling) { if (flightCache[id]?.landingTime) { finalLandingTime = flightCache[id].landingTime; finalUntil = finalLandingTime; } else { if (!isPremium) needsFfScouterForFlights = true; } }
                
                let warMemberData = isEnemy ? enemyWarMembers[id] : myWarMembers[id];
                let baseWarAttacks = warMemberData ? (warMemberData.attacks || 0) : 0;
                let score = warMemberData ? (warMemberData.score || 0) : 0;
                let baseAssists = warMemberData ? (warMemberData.assists || 0) : 0;
                
                let warAttacks = Math.max(baseWarAttacks, liveWarHits[id] || 0);
                let assists = Math.max(baseAssists, liveAssists[id] || 0);
                let outsideAttacks = liveOutsideHits[id] || 0;

                let warHitsTaken = liveWarHitsTaken[id] || 0;
                let outsideHitsTaken = liveOutsideHitsTaken[id] || 0;
                let hitsTaken = warHitsTaken + outsideHitsTaken;

                let warDefendsWon = liveWarDefendsWon[id] || 0;
                let outsideDefendsWon = liveOutsideDefendsWon[id] || 0;
                let defendsWon = warDefendsWon + outsideDefendsWon;

                let attacks = warAttacks + outsideAttacks;
                let defends = defendsWon;

                let timeline = activityCache[id]?.timeline || null; let timelineTime = activityCache[id]?.time || null;

                return { 
                    id, 
                    name: m.name, 
                    level: m.level || 0, 
                    position: m.position || '', 
                    daysInFaction: m.days_in_faction || 0, 
                    state: m.status?.state, 
                    until: finalUntil, 
                    statusDescription: m.status?.description || "", 
                    onlineStatus: m.last_action?.status || "Offline", 
                    lastActionRelative: m.last_action?.relative || "Unknown", 
                    lastActionTimestamp: m.last_action?.timestamp || 0, 
                    landingTime: finalLandingTime, 
                    needsFfScouterForFlights, 
                    claimedBy: isEnemy ? claims[id]?.playerName || null : null, 
                    needsBackup: isEnemy ? backups[id]?.playerName || null : null, 
                    estStats: est, 
                    intelScore: isEnemy ? computeWarIntel({ id, state: m.status?.state, until: finalUntil, onlineStatus: m.last_action?.status || "Offline", estStats: typeof est === 'number' ? est : null }, statsCache) : null, 
                    isManual: !!manualStats[id], 
                    attacks, 
                    warAttacks,
                    outsideAttacks,
                    assists,
                    defends, 
                    defendsWon,
                    warDefendsWon,
                    outsideDefendsWon,
                    hitsTaken,
                    warHitsTaken,
                    outsideHitsTaken,
                    score, 
                    timeline 
                };
            });
        };
        const friendlyMembers = parseMembers(myData, false);
        const enemyMembers = parseMembers(enemyDataResult, true);

        if (friendlyMembers.length === 0 && lastGoodWarboardPayload) {
            return res.json(lastGoodWarboardPayload);
        }

        const payload = {
            friendly: friendlyMembers,
            enemy: enemyMembers,
            detectedEnemyId: enemyId,
            premiumActive: isPremium,
            syncStatus: warSyncStatus,
            warInfo: activeWar ? {
                active: true,
                start: activeWar.war?.start || 0,
                end: activeWar.war?.end || 0,
                target: activeWar.war?.target || 0,
                myFaction: {
                    id: myData?.ID || null,
                    name: myData?.name || "Friendly Faction",
                    score: (activeWar.factions && myData.ID && activeWar.factions[myData.ID.toString()]) ? (activeWar.factions[myData.ID.toString()].score || 0) : 0,
                    chain: (activeWar.factions && myData.ID && activeWar.factions[myData.ID.toString()]) ? (activeWar.factions[myData.ID.toString()].chain || 0) : 0
                },
                enemyFaction: {
                    id: enemyId,
                    name: enemyDataResult?.name || "Enemy Faction",
                    score: (activeWar.factions && enemyId && activeWar.factions[enemyId.toString()]) ? (activeWar.factions[enemyId.toString()].score || 0) : 0,
                    chain: (activeWar.factions && enemyId && activeWar.factions[enemyId.toString()]) ? (activeWar.factions[enemyId.toString()].chain || 0) : 0
                }
            } : {
                active: false,
                myFaction: {
                    id: myData?.ID || null,
                    name: myData?.name || "Friendly Faction"
                }
            }
        };

        if (friendlyMembers.length > 0) {
            lastGoodWarboardPayload = payload;
        }

        res.json(payload);
    } catch (err) {
        if (lastGoodWarboardPayload) {
            return res.json(lastGoodWarboardPayload);
        }
        res.status(403).json({ error: err.message });
    }
});
app.post('/api/save-oc-config', (req, res) => {
    const { globalChannelId, roleId } = req.body;
    if (globalChannelId !== undefined) ocConfig.globalChannelId = globalChannelId;
    if (roleId !== undefined) ocConfig.roleId = roleId;
    saveOcConfig();
    res.json({ success: true });
});

app.post('/api/save-company-config', (req, res) => {
    const { globalChannelId, threshold, apiKey } = req.body;
    if (globalChannelId !== undefined) companyConfig.globalChannelId = globalChannelId;
    if (threshold !== undefined) companyConfig.threshold = parseInt(threshold) || 0;
    if (apiKey !== undefined) companyConfig.apiKey = apiKey;
    saveCompanyConfig();
    res.json({ success: true });
});

// --- MY USER BATTLE STATS (RESILIENT CACHED) ---
let myUserStatsMemoryCache = {};

app.get('/api/my-stats', async (req, res) => {
    try {
        const key = req.headers['x-api-key'] || req.query.apiKey || discordConfig.apiKey || TORN_API_KEY;
        if (!key) return res.status(400).json({ error: "Missing API key" });

        const cacheKey = key.slice(-8);
        const cached = myUserStatsMemoryCache[cacheKey];

        try {
            const r = await cachedTornFetch(`https://api.torn.com/user/?selections=battlestats,profile&key=${key}`, `my_stats_${cacheKey}`, 300000);
            if (r && !r.error && (r.strength || r.name)) {
                const payload = {
                    success: true,
                    name: r.name || "Agent",
                    level: r.level || 0,
                    strength: r.strength || 0,
                    speed: r.speed || 0,
                    defense: r.defense || 0,
                    dexterity: r.dexterity || 0,
                    total: (r.strength || 0) + (r.speed || 0) + (r.defense || 0) + (r.dexterity || 0)
                };
                myUserStatsMemoryCache[cacheKey] = payload;
                return res.json(payload);
            }
        } catch (e) {}

        if (cached) {
            return res.json({ ...cached, fromCache: true });
        }

        res.status(429).json({ error: "Torn API rate limited. Please wait a few moments." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

function parseStatValue(val) {
    if (!val && val !== 0) return 0;
    if (typeof val === 'number') return Math.max(0, Math.round(val));
    if (typeof val === 'string') {
        const cleaned = val.trim().toLowerCase().replace(/,/g, '');
        if (cleaned.includes('requires') || cleaned.includes('scanning')) return 0;
        if (cleaned.endsWith('b')) return Math.round(parseFloat(cleaned) * 1e9);
        if (cleaned.endsWith('m')) return Math.round(parseFloat(cleaned) * 1e6);
        if (cleaned.endsWith('k')) return Math.round(parseFloat(cleaned) * 1e3);
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : Math.round(num);
    }
    return 0;
}



app.get('/api/master-config', (req, res) => {
    res.json({
        discordConfig,
        companyConfig,
        ocConfig,
        marketConfig,
        apiKey: discordConfig.apiKey || companyConfig.apiKey || TORN_API_KEY || "",
        globalBotToken: discordConfig.globalBotToken || "",
        globalChannelId: discordConfig.globalChannelId || "",
        myName: discordConfig.myName || "Agent",
        enemyFacId: discordConfig.enemyFacId || "",
        ffKey: discordConfig.ffKey || "",
        tsKey: discordConfig.tsKey || "",
        cpm: discordConfig.cpm || 12
    });
});

app.post('/api/master-config', (req, res) => {
    const { apiKey, discordWebhook, companyWebhook, ocWebhook, myName, globalToggles, ffKey, tsKey, enemyId } = req.body;
    
    // Save to discord config
    if (discordWebhook !== undefined) discordConfig.globalChannelId = discordWebhook;
    if (apiKey !== undefined && apiKey !== '') discordConfig.apiKey = apiKey;
    if (myName !== undefined) discordConfig.myName = myName;
    if (enemyId !== undefined) discordConfig.enemyFacId = enemyId;
    if (ffKey !== undefined) discordConfig.ffKey = ffKey;
    if (tsKey !== undefined) discordConfig.tsKey = tsKey;
    
    if (globalToggles) {
        discordConfig.chainUnder90 = globalToggles.chain;
        discordConfig.chainMilestone = globalToggles.chain;
        discordConfig.targetOnline = globalToggles.target;
        discordConfig.targetLanded = globalToggles.target;
        discordConfig.targetOutHosp = globalToggles.target;
        discordConfig.medOutSniper = globalToggles.sniper;
        if (globalToggles.travelWarnings !== undefined) discordConfig.travelWarnings = globalToggles.travelWarnings;
        if (globalToggles.chainWarnings !== undefined) discordConfig.chainWarnings = globalToggles.chainWarnings;
    }
    
    saveDiscordConfig();
    
    if (apiKey !== undefined && apiKey !== '') {
        companyConfig.apiKey = apiKey;
        saveCompanyConfig();
        try {
            const { addKey } = require('./recruit/lib/apiKeyPool');
            addKey(apiKey, discordConfig.factionId || 0, null);
        } catch(e) {}
    }
    
    res.json({ success: true });
});

app.post('/api/sync-configs', (req, res) => {
    const { company, discord, oc, market, apiKey, globalBotToken, globalChannelId, ffKey, tsKey, enemyFacId, myName, cpm } = req.body;
    if (company) { companyConfig = { ...companyConfig, ...company }; saveCompanyConfig(); }
    if (discord) { discordConfig = { ...discordConfig, ...discord }; saveDiscordConfig(); }
    if (oc) { ocConfig = { ...ocConfig, ...oc }; saveOcConfig(); }
    if (market) { marketConfig = { ...marketConfig, ...market }; saveMarketConfig(); }
    
    // Handle flat payload from localStorage master_faction_config
    if (apiKey) {
        discordConfig.apiKey = apiKey;
        companyConfig.apiKey = apiKey;
        try {
            const { addKey } = require('./recruit/lib/apiKeyPool');
            addKey(apiKey, discordConfig.factionId || 0, null);
        } catch(e) {}
    }
    if (globalBotToken) discordConfig.globalBotToken = globalBotToken;
    if (globalChannelId) discordConfig.globalChannelId = globalChannelId;
    if (myName) discordConfig.myName = myName;
    if (enemyFacId) discordConfig.enemyFacId = enemyFacId;
    if (ffKey) discordConfig.ffKey = ffKey;
    if (tsKey) discordConfig.tsKey = tsKey;
    if (cpm) discordConfig.cpm = cpm;
    
    saveDiscordConfig();
    res.json({ success: true });
});

app.get('/api/company-config', (req, res) => {
    res.json({ success: true, globalChannelId: companyConfig.globalChannelId, threshold: companyConfig.threshold });
});

// Debug endpoint: test FF Scouter API live and see exact raw response
app.get('/api/debug-ffscouter', async (req, res) => {
    const targetId = req.query.target || req.query.id;
    const ffKey = req.query.key || getGlobalFFKey();
    if (!ffKey) return res.json({ error: "No FF Scouter key configured. Add it in Settings.", savedKey: discordConfig.ffKey || "(none)" });
    if (!targetId) return res.json({ error: "Add ?target=PLAYER_ID to the URL", ffKeyPresent: !!ffKey, ffKeyPreview: ffKey.substring(0, 4) + "****" });

    const url = `https://ffscouter.com/api/v1/player-flights?key=${encodeURIComponent(ffKey)}&target=${encodeURIComponent(targetId)}`;
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'Accept': 'application/json' } });
        const text = await r.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch(e) { parsed = null; }
        res.json({
            url: url.replace(encodeURIComponent(ffKey), "FF_KEY_HIDDEN"),
            httpStatus: r.status,
            rawText: text.substring(0, 2000),
            parsed,
            ffKeyPreview: ffKey.substring(0, 4) + "****",
            ffKeyLength: ffKey.length
        });
    } catch(e) {
        res.json({ error: e.message, url: url.replace(encodeURIComponent(ffKey), "FF_KEY_HIDDEN") });
    }
});

app.get('/api/ocs', async (req, res) => {
    try {
        const userKey = (req.headers['x-api-key'] || req.query.apiKey) && (req.headers['x-api-key'] || req.query.apiKey) !== "null" ? (req.headers['x-api-key'] || req.query.apiKey) : TORN_API_KEY;
        if (!userKey) return res.status(400).json({ error: "No API key provided. Please add your API key in Settings." });

        // 1. Fetch user profile to get their faction ID (v2 API requires explicit ID)
        const userRes = await fetch(`https://api.torn.com/user/?selections=profile&key=${userKey}`);
        const userData = await userRes.json();
        
        if (userData.error) {
            return res.status(400).json({ error: `API Key Error: ${userData.error.error}` });
        }
        if (!userData.faction || userData.faction.faction_id === 0) {
            return res.status(400).json({ error: "You are not currently in a faction, so you cannot view Organized Crimes." });
        }
        
        const fid = userData.faction.faction_id;

        // 2. Fetch OC crimes AND faction members explicitly by faction ID
        const [crimeRes, memberRes] = await Promise.all([
            fetch(`https://api.torn.com/v2/faction/${fid}/crimes?cat=available&key=${userKey}`),
            fetch(`https://api.torn.com/faction/${fid}?selections=basic&key=${userKey}`)
        ]);
        const crimeData = await crimeRes.json();
        const memberData = await memberRes.json();

        if (crimeData.error) {
            return res.status(400).json({ error: `Torn API Error: ${crimeData.error.error || JSON.stringify(crimeData.error)}` });
        }

        // Build a name lookup map: { "1234567": "Owen777", ... }
        const memberNames = {};
        if (memberData.members) {
            Object.entries(memberData.members).forEach(([id, m]) => {
                memberNames[id] = m.name;
            });
        }

        // Inject names into every crime slot
        const crimes = (crimeData.crimes || []).map(crime => {
            const slots = (crime.slots || []).map(slot => {
                if (slot.user && slot.user.id) {
                    slot.user.name = memberNames[slot.user.id.toString()] || `ID:${slot.user.id}`;
                }
                return slot;
            });
            return { ...crime, slots };
        });

        // Discord alerts for missing items
        if (ocConfig.globalChannelId) {
            crimes.forEach(crime => {
                (crime.slots || []).forEach(slot => {
                    if (!slot.user) return;
                    let pId = slot.user.id;
                    let pName = slot.user.name || pId;
                    let issueMessage = null;
                    if (slot.item_requirement && !slot.item_requirement.is_available) {
                        issueMessage = `Missing required item for their role`;
                    } else if (slot.user.outcome && (slot.user.outcome.toLowerCase() === 'hospitalized' || slot.user.outcome.toLowerCase() === 'jailed')) {
                        issueMessage = `Currently ${slot.user.outcome}`;
                    }
                    if (issueMessage) {
                        const trackingId = crime.id + "_" + pId + "_" + issueMessage;
                        if (!ocMemory[trackingId] || (Date.now() - ocMemory[trackingId]) > 3600000 * 12) {
                            ocMemory[trackingId] = Date.now();
                            let mention = ocConfig.roleId ? `<@&${ocConfig.roleId}>` : "";
                            if (discordConfig.globalBotToken) {
                                sendChannelMessage(discordConfig.globalBotToken, ocConfig.globalChannelId, {
                                    title: `🚨 OC Issue: ${crime.name}`,
                                    description: `**Player:** [${pName}](https://www.torn.com/profiles.php?XID=${pId})\n**Role:** ${slot.position_info?.label || slot.position}\n**Issue:** ${issueMessage}`, 
                                    color: 16733695
                                }, mention);
                            }
                        }
                    }
                });
            });
        }

        res.json({ success: true, crimes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/company-history', (req, res) => {
    res.json({ success: true, history: companyHistory });
});

app.post('/api/company-advisor', async (req, res) => {
    try {
        const { company, employees, stock, history } = req.body;
        
        const prompt = `You are an expert Torn City Company Director advisor. 
I am giving you the raw data for my company. Please analyze it and give me 3-5 short, actionable insights on how to improve my company's performance, profitability, and employee efficiency.

Company Info:
Name: ${company.name || 'Unknown'}
Daily Profit: $${(company.daily_profit || 0).toLocaleString()}
Popularity: ${company.popularity || 0}
Customers: ${company.daily_customers || 0}

Stock Data:
${JSON.stringify(stock, null, 2)}

Employee Data:
${JSON.stringify(employees, null, 2)}

Keep your advice specific to the data provided. Be concise, punchy, and use emojis. Do not output markdown code blocks, just raw text formatted nicely.`;

        // We will invoke Gemini API
        // Wait, the backend doesn't have the Gemini API configured.
        // To make it easy, we will just use the official Gemini API if an API key is provided, 
        // or for this mockup, I'll return a simulated response if we don't have a Gemini API key.
        
        let advisorKey = process.env.GEMINI_API_KEY;
        if (!advisorKey) {
            return res.json({ success: true, advice: "🧠 **AI Advisor Simulated Response**\n\n1. **Stock Warning:** You don't have a Gemini API Key configured on the server (`GEMINI_API_KEY`). \n2. **Employee Analysis:** I need a real API key to parse this data!\n3. **Action:** Have your developer add a Gemini API key to your environment variables!" });
        }

        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${advisorKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        
        const gData = await gRes.json();
        const advice = gData.candidates?.[0]?.content?.parts?.[0]?.text || "Failed to generate advice.";
        
        res.json({ success: true, advice });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/travel-profits', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(400).json({ error: "API Key required" });
    try {
        await verifySubscription(apiKey);
        
        // Fetch Torn market data
        const resp = await fetch(`https://api.torn.com/torn/?selections=items&key=${apiKey}`);
        const data = await resp.json();
        if (data.error) return res.status(400).json({ error: "Torn API Error: " + data.error.error });

        // Fetch live YATA stock data
        const yataResp = await fetch('https://yata.yt/api/v1/travel/export/');
        const yataData = await yataResp.json();
        
        const yataCountryMap = {
            "Mexico": "mex", "Cayman Islands": "cay", "Canada": "can", "Hawaii": "haw",
            "UK": "uni", "Argentina": "arg", "Switzerland": "swi", "Japan": "jap",
            "China": "chi", "UAE": "uae", "South Africa": "sou"
        };

        const items = data.items;
        const foreignItems = [
            { id: 261, name: "Wolverine Plushie", country: "Canada", cost: 30, flightTimeMins: 29 },
            { id: 274, name: "Jaguar Plushie", country: "Mexico", cost: 10000, flightTimeMins: 18 },
            { id: 266, name: "Nessie Plushie", country: "UK", cost: 200, flightTimeMins: 111 },
            { id: 268, name: "Red Fox Plushie", country: "UK", cost: 1000, flightTimeMins: 111 },
            { id: 273, name: "Monkey Plushie", country: "Argentina", cost: 400, flightTimeMins: 117 },
            { id: 269, name: "Chamois Plushie", country: "Switzerland", cost: 400, flightTimeMins: 123 },
            { id: 277, name: "Kitten Plushie", country: "Switzerland", cost: 500, flightTimeMins: 123 },
            { id: 272, name: "Stingray Plushie", country: "Japan", cost: 400, flightTimeMins: 158 },
            { id: 264, name: "Panda Plushie", country: "China", cost: 400, flightTimeMins: 164 },
            { id: 258, name: "Lion Plushie", country: "South Africa", cost: 400, flightTimeMins: 209 },
            { id: 281, name: "Camel Plushie", country: "UAE", cost: 14000, flightTimeMins: 190 },
            { id: 260, name: "Tribulus Omanense", country: "UAE", cost: 6000, flightTimeMins: 190 },
            { id: 263, name: "African Violet", country: "South Africa", cost: 2000, flightTimeMins: 209 },
            { id: 267, name: "Heather", country: "UK", cost: 5000, flightTimeMins: 111 },
            { id: 271, name: "Edelweiss", country: "Switzerland", cost: 3000, flightTimeMins: 123 },
            { id: 276, name: "Peony", country: "China", cost: 5000, flightTimeMins: 164 },
            { id: 282, name: "Cherry Blossom", country: "Japan", cost: 500, flightTimeMins: 158 },
            { id: 270, name: "Ceibo Flower", country: "Argentina", cost: 500, flightTimeMins: 117 },
            { id: 275, name: "Dahlia", country: "Mexico", cost: 300, flightTimeMins: 18 },
            { id: 262, name: "Crocus", country: "Canada", cost: 600, flightTimeMins: 29 },
            { id: 259, name: "Orchid", country: "Hawaii", cost: 700, flightTimeMins: 94 },
            
            // High Value / Drugs
            { id: 206, name: "Xanax", country: "South Africa", cost: 808000, flightTimeMins: 209 },
            { id: 226, name: "Smoke Grenade", country: "South Africa", cost: 20000, flightTimeMins: 209 },
            { id: 242, name: "Flash Grenade", country: "UAE", cost: 24000, flightTimeMins: 190 },
            { id: 254, name: "Tear Gas", country: "China", cost: 30000, flightTimeMins: 164 }
        ];

        let results = [];
        for (let item of foreignItems) {
            let marketPrice = items[item.id] ? items[item.id].market_value : 0;
            let cost = item.cost;
            let stock = 0;
            
            let yCode = yataCountryMap[item.country];
            if (yCode && yataData.stocks && yataData.stocks[yCode]) {
                let s = yataData.stocks[yCode].stocks.find(i => i.id === item.id);
                if (s) {
                    cost = s.cost;
                    stock = s.quantity;
                }
            }
            
            let profit = marketPrice - cost;
            let roundTrip = item.flightTimeMins * 2;
            let profitPerMin = roundTrip > 0 ? profit / roundTrip : 0;
            let profitPerHr = profitPerMin * 60;
            
            results.push({
                ...item,
                cost,
                stock,
                marketPrice,
                profit,
                profitPerMin,
                profitPerHr,
                roundTrip
            });
        }
        
        // Sort by Profit / Hour by default
        results.sort((a, b) => b.profitPerHr - a.profitPerHr);
        res.json({ success: true, items: results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// --- MULTI-TENANT DISCORD BOTS & SLASH COMMANDS ---
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, InteractionType } = require('discord.js');
let activeDiscordBots = {}; 
let botLoginPromises = {};

// =====================================================
// TRAVEL LOOKUP: /country Discord Slash Commands
// =====================================================
const TORN_COUNTRIES = [
    "Mexico", "Cayman Islands", "Canada", "Hawaii",
    "United Kingdom", "Argentina", "Switzerland",
    "Japan", "China", "UAE", "South Africa"
];

const COUNTRY_EMOJIS = {
    "Mexico": "🇲🇽", "Cayman Islands": "🏝️", "Canada": "🇨🇦", "Hawaii": "🌺",
    "United Kingdom": "🇬🇧", "Argentina": "🇦🇷", "Switzerland": "🇨🇭",
    "Japan": "🇯🇵", "China": "🇨🇳", "UAE": "🇦🇪", "South Africa": "🇿🇦"
};

// Official Torn City one-way flight times with exact midpoints
const COUNTRY_FLIGHT_DATA = {
    "Mexico":         { standardMins: 26,  airstripMins: 18,  midpointSec: 1320, standardSec: 1560, airstripSec: 1080 },
    "Cayman Islands": { standardMins: 35,  airstripMins: 25,  midpointSec: 1800, standardSec: 2100, airstripSec: 1500 },
    "Canada":         { standardMins: 41,  airstripMins: 29,  midpointSec: 2100, standardSec: 2460, airstripSec: 1740 },
    "Hawaii":         { standardMins: 134, airstripMins: 94,  midpointSec: 6840, standardSec: 8040, airstripSec: 5640 },
    "United Kingdom": { standardMins: 159, airstripMins: 111, midpointSec: 8100, standardSec: 9540, airstripSec: 6660 },
    "Argentina":      { standardMins: 167, airstripMins: 117, midpointSec: 8520, standardSec: 10020, airstripSec: 7020 },
    "Switzerland":    { standardMins: 175, airstripMins: 123, midpointSec: 8940, standardSec: 10500, airstripSec: 7380 },
    "Japan":          { standardMins: 225, airstripMins: 158, midpointSec: 11490, standardSec: 13500, airstripSec: 9480 },
    "China":          { standardMins: 242, airstripMins: 169, midpointSec: 12330, standardSec: 14520, airstripSec: 10140 },
    "UAE":            { standardMins: 271, airstripMins: 190, midpointSec: 13830, standardSec: 16260, airstripSec: 11400 },
    "South Africa":   { standardMins: 297, airstripMins: 208, midpointSec: 15150, standardSec: 17820, airstripSec: 12480 }
};


// Normalise country name from slash command name
function slashNameToCountry(name) {
    if (!name) return null;
    const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const map = {
        "southafrica": "South Africa", "sa": "South Africa",
        "mexico": "Mexico", "mex": "Mexico",
        "caymanislands": "Cayman Islands", "cayman": "Cayman Islands", "ci": "Cayman Islands",
        "canada": "Canada", "can": "Canada",
        "hawaii": "Hawaii", "hi": "Hawaii",
        "unitedkingdom": "United Kingdom", "uk": "United Kingdom", "britain": "United Kingdom", "england": "United Kingdom",
        "argentina": "Argentina", "arg": "Argentina",
        "switzerland": "Switzerland", "swiss": "Switzerland", "ch": "Switzerland",
        "japan": "Japan", "jp": "Japan",
        "china": "China", "cn": "China",
        "uae": "UAE", "dubai": "UAE", "emirates": "UAE"
    };
    return map[clean] || map[name.toLowerCase()] || null;
}

// Format duration in human-readable Torn style: e.g. ~1 hour and 36 minutes, ~24 minutes
function formatHumanDuration(totalMins) {
    const minsNum = Number(totalMins);
    if (!Number.isFinite(minsNum) || minsNum <= 0) return "Landing now";
    if (minsNum < 60) {
        return `~${minsNum} minute${minsNum !== 1 ? 's' : ''}`;
    }
    const hrs = Math.floor(minsNum / 60);
    const remainingMins = minsNum % 60;
    const hrStr = `${hrs} hour${hrs !== 1 ? 's' : ''}`;
    if (remainingMins === 0) return `~${hrStr}`;
    const minStr = `${remainingMins} minute${remainingMins !== 1 ? 's' : ''}`;
    return `~${hrStr} and ${minStr}`;
}

// Helper to get active FF Scouter API key
let lastFFScouterError = null;

function getGlobalFFKey() {
    const key = (discordConfig && discordConfig.ffKey) || 
                (global.marketConfig && (global.marketConfig.ffscouterKey || global.marketConfig.ffKey)) || 
                (marketConfig && (marketConfig.ffscouterKey || marketConfig.ffKey)) ||
                process.env.FF_SCOUTER_KEY || 
                process.env.FF_KEY || 
                process.env.FFSCOUTER_KEY ||
                "";
    return key ? key.trim() : "";
}

function estimateStatsFromLevel(level) {
    if (!level || isNaN(level)) return 10000;
    level = Number(level);
    if (level <= 10) return Math.round(level * 3000);
    if (level <= 20) return Math.round(30000 + (level - 10) * 15000);
    if (level <= 35) return Math.round(180000 + (level - 20) * 80000);
    if (level <= 50) return Math.round(1380000 + (level - 35) * 400000);
    if (level <= 70) return Math.round(7380000 + (level - 50) * 2500000);
    if (level <= 85) return Math.round(57380000 + (level - 70) * 15000000);
    if (level <= 100) return Math.round(282380000 + (level - 85) * 50000000);
    return 1500000000;
}

async function fetchBulkFFScouterStats(playerIds, ffKey) {
    if (!ffKey || !playerIds || playerIds.length === 0) return {};
    const results = {};
    const chunks = [];
    const chunkSize = 40;
    for (let i = 0; i < playerIds.length; i += chunkSize) {
        chunks.push(playerIds.slice(i, i + chunkSize));
    }

    for (const chunk of chunks) {
        try {
            const batchStr = chunk.join(',');
            const res = await fetch(`https://ffscouter.com/api/v1/get-stats?key=${encodeURIComponent(ffKey)}&targets=${batchStr}`, {
                signal: AbortSignal.timeout(6000),
                headers: { 'Accept': 'application/json' }
            });
            const data = await res.json().catch(() => null);
            if (!data) continue;

            if (Array.isArray(data)) {
                data.forEach(p => {
                    const id = (p.player_id || p.id || '').toString();
                    const statVal = Number(p.bs_estimate || p.total || p.stats || p.estimate || 0);
                    if (id && statVal > 0) {
                        results[id] = statVal;
                        statsCache[id] = { stats: statVal, time: Date.now() };
                        if (!spyDatabase[id]) {
                            spyDatabase[id] = {
                                total: statVal,
                                strength: p.strength || 0,
                                defense: p.defense || 0,
                                speed: p.speed || 0,
                                dexterity: p.dexterity || 0,
                                timestamp: Date.now()
                            };
                        }
                    }
                });
            } else if (typeof data === 'object') {
                const entries = Array.isArray(data.data) ? data.data : Object.entries(data);
                for (const item of entries) {
                    if (Array.isArray(item)) {
                        const [id, p] = item;
                        const statVal = Number(p?.bs_estimate || p?.total || p?.stats || p || 0);
                        if (statVal > 0) {
                            const sId = id.toString();
                            results[sId] = statVal;
                            statsCache[sId] = { stats: statVal, time: Date.now() };
                            if (!spyDatabase[sId]) spyDatabase[sId] = { total: statVal, timestamp: Date.now() };
                        }
                    } else if (item && item.player_id) {
                        const id = item.player_id.toString();
                        const statVal = Number(item.bs_estimate || item.total || item.stats || 0);
                        if (statVal > 0) {
                            results[id] = statVal;
                            statsCache[id] = { stats: statVal, time: Date.now() };
                            if (!spyDatabase[id]) spyDatabase[id] = { total: statVal, timestamp: Date.now() };
                        }
                    }
                }
            }
        } catch (e) {
            console.error("[FF Scouter Stats] Batch error:", e.message);
        }
    }
    return results;
}

// Fetch flight data directly from FF Scouter API and calculate midpoint arrival
async function getPlayerFlightFromFFScouter(targetId, ffKey) {
    if (!ffKey || !targetId) return null;
    const now = Math.floor(Date.now() / 1000);
    if (flightCache[targetId] && (Date.now() - flightCache[targetId].time) < 15000 && Number(flightCache[targetId].midpoint) > 0) {
        return flightCache[targetId];
    }
    try {
        const url = `https://ffscouter.com/api/v1/player-flights?key=${encodeURIComponent(ffKey)}&target=${encodeURIComponent(targetId)}`;
        const res = await fetch(url, {
            signal: AbortSignal.timeout(7000),
            headers: { 'Accept': 'application/json' }
        });
        const raw = await res.json().catch(err => {
            console.error(`[FF Scouter Parse Error] ${targetId}:`, err.message);
            return null;
        });

        console.log(`[FF Scouter] Target ${targetId} -> HTTP ${res.status}:`, JSON.stringify(raw));

        if (raw) {
            if (raw.error) {
                lastFFScouterError = raw.error;
                console.warn(`[FF Scouter API Error] Target ${targetId}:`, raw.error);
                return null;
            }
            lastFFScouterError = null;

            const cur = raw.current || raw.flight || raw.data || (Array.isArray(raw) ? raw[0] : (raw.flights ? raw.flights[0] : raw[targetId])) || raw;
            if (cur && typeof cur === 'object') {
                // Check relative seconds (e.g. time_left, time_remaining, seconds_left)
                const timeLeft = Number(cur.time_left || cur.time_remaining || cur.seconds_left || cur.timeLeft || raw.time_left || 0);
                if (timeLeft > 0 && timeLeft < 86400 * 2) {
                    const landingTime = now + timeLeft;
                    const entry = {
                        earliest: landingTime,
                        latest: landingTime,
                        midpoint: landingTime,
                        landingTime,
                        destination: cur.destination || cur.to || "",
                        origin: cur.origin || cur.from || "",
                        time: Date.now()
                    };
                    flightCache[targetId] = entry;
                    return entry;
                }

                // Check absolute timestamps
                const earliest = Number(cur.earliest_arrival_time || cur.earliest_arrival || cur.arrival_earliest || cur.min_arrival_time || cur.arrival_min || cur.arrival_early || cur.arrival_start || cur.earliest || 0);
                const latest = Number(cur.latest_arrival_time || cur.latest_arrival || cur.arrival_latest || cur.max_arrival_time || cur.arrival_max || cur.arrival_late || cur.arrival_end || cur.latest || cur.arrival_time || cur.landing_time || cur.arrival || 0);

                let midpoint = 0;
                if (earliest > 0 && latest > 0) {
                    midpoint = Math.round((earliest + latest) / 2);
                } else if (latest > 0) {
                    midpoint = latest;
                } else if (earliest > 0) {
                    midpoint = earliest;
                }

                if (midpoint > 0) {
                    const entry = {
                        earliest,
                        latest,
                        midpoint,
                        landingTime: midpoint || latest,
                        destination: cur.destination || cur.to || "",
                        origin: cur.origin || cur.from || "",
                        time: Date.now()
                    };
                    flightCache[targetId] = entry;
                    return entry;
                }
            }
        }
    } catch(e) {
        console.error(`[FF Scouter Fetch Error] Target ${targetId}:`, e.message);
    }
    return null;
}



// Resolve flight duration using ONLY FF Scouter API (or Torn API) - No custom guessing math
function resolveFlightDuration(m, id, now, ffFlightMap = {}) {
    // 1. Live FF Scouter API response (the exact midpoint between earliest and latest arrival)
    const ffFlight = ffFlightMap[id] || flightCache[id];
    const arrivalTarget = Number(ffFlight?.midpoint || ffFlight?.landingTime || 0);

    if (arrivalTarget > 0) {
        if (arrivalTarget > now) {
            const diffMins = Math.max(1, Math.ceil((arrivalTarget - now) / 60));
            return { landingStr: formatHumanDuration(diffMins), until: arrivalTarget };
        } else {
            return { landingStr: "Landing now!", until: arrivalTarget };
        }
    }

    // 2. Direct Torn API status.until timestamp (if available)
    const until = Number(m.status?.until || 0);
    if (until > 0) {
        if (until > now) {
            const diffMins = Math.max(1, Math.ceil((until - now) / 60));
            return { landingStr: formatHumanDuration(diffMins), until };
        } else {
            return { landingStr: "Landing now!", until };
        }
    }

    // 3. No estimates available from FF Scouter or Torn API — no guessing math
    return { landingStr: "Flight in progress", until: 0 };
}






// Robust member travel classifier for a specific country
function categorizeTravelers(membersObj, country, now, ffFlightMap = {}) {
    const cLower = country.toLowerCase();
    const inCountry = [];
    const flyingTo = [];
    const flyingBack = [];

    if (!membersObj || typeof membersObj !== 'object') {
        return { inCountry, flyingTo, flyingBack, total: 0 };
    }

    for (const [id, m] of Object.entries(membersObj)) {
        if (!m || !m.name) continue;
        const state = (m.status?.state || "").trim();
        const desc = (m.status?.description || "").toLowerCase();
        const details = (m.status?.details || "").toLowerCase();
        const fullStatus = `${state.toLowerCase()} ${desc} ${details}`;

        // Must match the country query
        if (!fullStatus.includes(cLower)) continue;

        const { landingStr, until } = resolveFlightDuration(m, id, now, ffFlightMap, country);

        const isTraveling = state === "Traveling" || 
                            desc.includes("travel") || 
                            desc.includes("plane") || 
                            desc.includes("flight") || 
                            desc.includes("flying") || 
                            desc.includes("returning");

        const isAbroad = (state === "Abroad" || desc.startsWith("in ") || desc.startsWith("at ")) && !isTraveling;

        // 1. In Country (at destination, not flying)
        if (isAbroad && (desc.includes(cLower) || details.includes(cLower))) {
            const onlineStr = m.last_action?.status === "Online" ? " 🟢" : (m.last_action?.status === "Idle" ? " 🟡" : " ⚫");
            inCountry.push({ name: m.name, id, onlineStr, status: m.last_action?.status || "Offline" });
            continue;
        }

        const ffFlight = ffFlightMap[id] || flightCache[id];
        const ffDest = (ffFlight?.destination || "").toLowerCase();
        const ffOrig = (ffFlight?.origin || "").toLowerCase();

        if (isTraveling) {
            // Check FF Scouter direct flight data first if available
            let isTo = false;
            let isBack = false;

            if (ffDest.includes(cLower)) {
                isTo = true;
            } else if (ffOrig.includes(cLower) || (ffDest === "torn" && (desc.includes(cLower) || details.includes(cLower)))) {
                isBack = true;
            } else {
                // Parse Torn status descriptions
                isTo = (desc.includes("to " + cLower) && !desc.includes("to torn")) ||
                       (desc.includes("traveling to") && (desc.includes(cLower) || details.includes(cLower)) && !desc.includes("torn")) ||
                       (desc.includes("flying to") && (desc.includes(cLower) || details.includes(cLower))) ||
                       (desc.includes("heading to") && (desc.includes(cLower) || details.includes(cLower)));

                isBack = desc.includes("from " + cLower) ||
                         desc.includes("returning to torn") ||
                         desc.includes("in a plane from " + cLower) ||
                         desc.includes("returning from " + cLower) ||
                         desc.includes("back from " + cLower) ||
                         desc.includes("leaving " + cLower) ||
                         (desc.includes("returning") && (desc.includes(cLower) || details.includes(cLower)));
            }

            if (isTo && !isBack) {
                flyingTo.push({ name: m.name, id, landingStr, until });
                continue;
            } else if (isBack) {
                flyingBack.push({ name: m.name, id, landingStr, until });
                continue;
            } else if (desc.includes(cLower) || details.includes(cLower)) {
                if (desc.includes("to ") && !desc.includes("torn")) {
                    flyingTo.push({ name: m.name, id, landingStr, until });
                } else {
                    flyingBack.push({ name: m.name, id, landingStr, until });
                }
                continue;
            }
        }

    }

    flyingTo.sort((a, b) => (a.until || 9999999) - (b.until || 9999999));
    flyingBack.sort((a, b) => (a.until || 9999999) - (b.until || 9999999));

    return {
        inCountry,
        flyingTo,
        flyingBack,
        total: inCountry.length + flyingTo.length + flyingBack.length
    };
}



// Build comprehensive travel status embed (Both Friendly & Enemy Factions)
async function buildCountryStatusEmbed(country, apiKey) {
    const emoji = COUNTRY_EMOJIS[country] || "✈️";
    const now = Math.floor(Date.now() / 1000);

    let factionId = adminFactionId || discordConfig.factionId;
    if (!factionId || !apiKey) {
        return {
            title: `${emoji} ${country} — Travel Intel`,
            description: "⚠️ Bot not configured: missing API key or faction ID. Visit the Discord Alerts page to set up.",
            color: 16729943
        };
    }

    try {
        const ffKey = getGlobalFFKey();

        // 1. Fetch Friendly Faction
        const facRes = await fetch(`https://api.torn.com/faction/${factionId}?selections=basic,rankedwars&key=${apiKey}`, {
            signal: AbortSignal.timeout(8000)
        });
        const facData = await facRes.json();
        if (facData.error) throw new Error(facData.error.error || "Torn API error");

        const friendlyName = facData.name || "Our Faction";

        // 2. Determine Enemy Faction ID
        let enemyId = currentEnemyFacId || discordConfig.enemyFacId || autoDetectEnemyFaction(facData);
        let enemyName = "Enemy Faction";
        let enemyData = null;

        if (enemyId && enemyId.toString() !== factionId.toString()) {
            try {
                let rotKey = getNextApiKey() || apiKey;
                const enemyRes = await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${rotKey}`, {
                    signal: AbortSignal.timeout(6000)
                });
                enemyData = await enemyRes.json();
                if (enemyData.members) {
                    enemyName = enemyData.name || `Enemy [${enemyId}]`;
                    enemyMembersCache = enemyData.members;
                }
            } catch(e) {
                if (enemyMembersCache && Object.keys(enemyMembersCache).length > 0) {
                    enemyData = { members: enemyMembersCache, name: enemyName };
                }
            }
        }

        // 3. Collect traveling members for FF Scouter lookup
        const travelingIds = [];
        const cLower = country.toLowerCase();

        for (const [id, m] of Object.entries(facData.members || {})) {
            const full = `${m.status?.state || ''} ${m.status?.description || ''} ${m.status?.details || ''}`.toLowerCase();
            if (full.includes(cLower) && (m.status?.state === 'Traveling' || full.includes('travel') || full.includes('plane') || full.includes('flight') || full.includes('returning'))) {
                travelingIds.push(id);
            }
        }
        if (enemyData?.members) {
            for (const [id, m] of Object.entries(enemyData.members)) {
                const full = `${m.status?.state || ''} ${m.status?.description || ''} ${m.status?.details || ''}`.toLowerCase();
                if (full.includes(cLower) && (m.status?.state === 'Traveling' || full.includes('travel') || full.includes('plane') || full.includes('flight') || full.includes('returning'))) {
                    travelingIds.push(id);
                }
            }
        }

        // 4. Fetch FF Scouter estimates in parallel
        const ffFlightMap = {};
        if (ffKey && travelingIds.length > 0) {
            await Promise.all(
                travelingIds.slice(0, 25).map(async (id) => {
                    const fl = await getPlayerFlightFromFFScouter(id, ffKey);
                    if (fl) ffFlightMap[id] = fl;
                })
            );
        }



        const friendlyTravel = categorizeTravelers(facData.members, country, now, ffFlightMap);
        const enemyTravel = enemyData?.members ? categorizeTravelers(enemyData.members, country, now, ffFlightMap) : { inCountry: [], flyingTo: [], flyingBack: [], total: 0 };


        const fields = [];

        // ── 1. FRIENDLY SECTION ──
        if (friendlyTravel.inCountry.length > 0) {
            fields.push({
                name: `🛡️ ${friendlyName} — In ${country} (${friendlyTravel.inCountry.length})`,
                value: friendlyTravel.inCountry.slice(0, 15).map(m =>
                    `[${m.name}](https://www.torn.com/profiles.php?XID=${m.id})${m.onlineStr}`
                ).join("\n"),
                inline: false
            });
        }
        if (friendlyTravel.flyingTo.length > 0) {
            fields.push({
                name: `✈️ ${friendlyName} — Flying TO ${country} (${friendlyTravel.flyingTo.length})`,
                value: friendlyTravel.flyingTo.slice(0, 15).map(m =>
                    `[${m.name}](https://www.torn.com/profiles.php?XID=${m.id}) — ${m.landingStr || "ETA unknown"}`
                ).join("\n"),
                inline: false
            });
        }
        if (friendlyTravel.flyingBack.length > 0) {
            fields.push({
                name: `🔄 ${friendlyName} — Flying BACK from ${country} (${friendlyTravel.flyingBack.length})`,
                value: friendlyTravel.flyingBack.slice(0, 15).map(m =>
                    `[${m.name}](https://www.torn.com/profiles.php?XID=${m.id}) — ${m.landingStr || "ETA unknown"}`
                ).join("\n"),
                inline: false
            });
        }

        // ── 2. ENEMY SECTION (with 1-click Attack Links) ──
        if (enemyTravel.inCountry.length > 0) {
            fields.push({
                name: `🎯 ${enemyName} — In ${country} (${enemyTravel.inCountry.length})`,
                value: enemyTravel.inCountry.slice(0, 15).map(m =>
                    `**${m.name}** [${m.id}]${m.onlineStr} • [⚔️ Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${m.id}) • [Profile](https://www.torn.com/profiles.php?XID=${m.id})`
                ).join("\n"),
                inline: false
            });
        }
        if (enemyTravel.flyingTo.length > 0) {
            fields.push({
                name: `✈️ ${enemyName} — Flying TO ${country} (${enemyTravel.flyingTo.length})`,
                value: enemyTravel.flyingTo.slice(0, 15).map(m =>
                    `**${m.name}** [${m.id}] — ${m.landingStr || "ETA unknown"} • [⚔️ Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${m.id})`
                ).join("\n"),
                inline: false
            });
        }
        if (enemyTravel.flyingBack.length > 0) {
            fields.push({
                name: `🔄 ${enemyName} — Flying BACK from ${country} (${enemyTravel.flyingBack.length})`,
                value: enemyTravel.flyingBack.slice(0, 15).map(m =>
                    `**${m.name}** [${m.id}] — ${m.landingStr || "ETA unknown"} • [⚔️ Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${m.id})`
                ).join("\n"),
                inline: false
            });
        }

        const grandTotal = friendlyTravel.total + enemyTravel.total;
        let desc = "";
        if (grandTotal === 0) {
            desc = `No friendly members or enemy targets are currently in or traveling to/from **${country}**.`;
        } else {
            const summaryParts = [];
            if (friendlyTravel.total > 0) summaryParts.push(`**${friendlyTravel.total}** friendly member${friendlyTravel.total !== 1 ? 's' : ''}`);
            if (enemyTravel.total > 0) summaryParts.push(`**${enemyTravel.total}** enemy target${enemyTravel.total !== 1 ? 's' : ''}`);
            desc = summaryParts.join(' and ') + ` detected for **${country}**.`;
        }

        if (!ffKey) {
            desc += `\n⚠️ *FF Scouter key is not configured on the server. Connect your FF Scouter key in Dashboard Settings for live flight ETAs.*`;
        } else if (lastFFScouterError) {
            desc += `\n⚠️ **FF Scouter Key Error**: ${lastFFScouterError}. *(Make sure to use your key from ffscouter.com, not your Torn API key).*`;
        }

        return {
            title: `${emoji} ${country} — Live Travel Intel`,
            description: desc,
            color: enemyTravel.total > 0 ? 16729943 : 5793266, // Red if enemies present, green otherwise
            fields,
            footer: { text: `Torn Travel Intel • ${new Date().toUTCString()}` }
        };
    } catch (e) {
        return {
            title: `${emoji} ${country} — Travel Intel`,
            description: `⚠️ Could not fetch travel data: ${e.message}`,
            color: 16729943
        };
    }
}

// ─── Slash Command Embed Builders ─────────────────────────────────────────────
function sanitizeEmbed(embed) {
    if (!embed) return embed;
    const sanitized = { ...embed };
    if (sanitized.title && sanitized.title.length > 250) {
        sanitized.title = sanitized.title.slice(0, 247) + "...";
    }
    if (sanitized.description && sanitized.description.length > 4000) {
        sanitized.description = sanitized.description.slice(0, 3990) + "...";
    }
    if (Array.isArray(sanitized.fields)) {
        sanitized.fields = sanitized.fields.slice(0, 25).map(f => ({
            name: String(f.name || 'Field').slice(0, 250),
            value: String(f.value || '-').slice(0, 1020),
            inline: !!f.inline
        }));
    }
    return sanitized;
}

function formatStatNumber(num) {
    if (!num || isNaN(num)) return "Unknown";
    num = Number(num);
    if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(1) + "k";
    return num.toLocaleString();
}

async function buildWarStatusEmbed(apiKey) {
    if (!apiKey) return { title: "⚔️ Ranked War Status", description: "⚠️ No Torn API Key configured on server.", color: 0xff4757 };
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars,attacks&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const facData = await facRes.json();
        if (facData.error) throw new Error(facData.error.error || "Torn API error");

        const rankedWars = facData.rankedwars || {};
        // Find ongoing war first (winner === 0 or no end time)
        let activeWar = Object.values(rankedWars).find(w => w.war && (w.war.winner === 0 || !w.war.end || w.war.end === 0));
        if (!activeWar) {
            // If none active, pick the most recent war by start time
            const sortedWars = Object.values(rankedWars).filter(w => w.war && w.war.start).sort((a, b) => (b.war.start || 0) - (a.war.start || 0));
            activeWar = sortedWars[0];
        }

        if (!activeWar || !activeWar.factions) {
            return {
                title: "🕊️ Ranked War Status",
                description: `**${facData.name || 'Your faction'}** is not currently in an active Ranked War.`,
                color: 0x2ed573,
                footer: { text: "Torn Warfare Suite" }
            };
        }

        const fids = Object.keys(activeWar.factions || {});
        const fid1 = fids[0];
        const fid2 = fids[1];

        const ourFid = (fid1.toString() === facData.ID?.toString()) ? fid1 : fid2;
        const enemyFid = (ourFid === fid1) ? fid2 : fid1;
        const ourInfo = activeWar.factions?.[ourFid] || {};
        const enemyInfo = activeWar.factions?.[enemyFid] || {};

        const ourScore = ourInfo.score || 0;
        const enemyScore = enemyInfo.score || 0;
        const targetScore = activeWar.war?.target || 0;
        const lead = ourScore - enemyScore;
        const isLeading = lead >= 0;

        const totalScore = ourScore + enemyScore;
        const ourPct = totalScore > 0 ? (ourScore / totalScore) : 0.5;
        const filled = Math.max(0, Math.min(15, Math.round(ourPct * 15)));
        const bar = "🟩".repeat(filled) + "🟥".repeat(15 - filled);

        const startTime = activeWar.war?.start ? `<t:${activeWar.war.start}:R>` : "In Progress";
        const enemyName = enemyInfo.name || `Faction #${enemyFid}`;
        const ourName = ourInfo.name || facData.name || "Our Faction";

        // Aggregate member hit totals
        let friendlyMembers = [];

        // 1. If ourInfo.members exists (archived war)
        if (ourInfo.members && Object.keys(ourInfo.members).length > 0) {
            friendlyMembers = Object.entries(ourInfo.members).map(([id, m]) => ({
                id,
                name: m.name || `Player #${id}`,
                attacks: Number(m.attacks || 0),
                score: Number(m.score || 0),
                assists: Number(m.assists || 0)
            })).filter(m => m.attacks > 0 || m.score > 0);
        }

        // 2. If liveWarHits has data, map with facData.members
        if (friendlyMembers.length === 0 && Object.keys(liveWarHits).length > 0) {
            friendlyMembers = Object.entries(liveWarHits).map(([id, hits]) => ({
                id,
                name: facData.members?.[id]?.name || `Player #${id}`,
                attacks: Number(hits || 0),
                score: 0,
                assists: Number(liveAssists[id] || 0)
            })).filter(m => m.attacks > 0 || m.assists > 0);
        }

        // 3. Fallback to facData.attacks
        if (friendlyMembers.length === 0 && facData.attacks) {
            const hitterCounts = {};
            for (const atkId in facData.attacks) {
                const atk = facData.attacks[atkId];
                if (atk.attacker_faction == ourFid && atk.result && !atk.result.includes("Lost") && !atk.result.includes("Stalemate")) {
                    const id = (atk.attacker_id || "").toString();
                    const name = atk.attacker_name || `Player #${id}`;
                    if (!hitterCounts[id]) hitterCounts[id] = { id, name, attacks: 0, score: 0, assists: 0 };
                    if (atk.result === "Assist") hitterCounts[id].assists++;
                    else hitterCounts[id].attacks++;
                    hitterCounts[id].score += Number(atk.respect_gain || 0);
                }
            }
            friendlyMembers = Object.values(hitterCounts);
        }

        let totalFriendlyHits = friendlyMembers.reduce((sum, m) => sum + m.attacks, 0);

        friendlyMembers.sort((a, b) => b.attacks - a.attacks || b.score - a.score);

        const topHitters = friendlyMembers
            .slice(0, 3)
            .map((m, idx) => {
                const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
                const assistStr = m.assists > 0 ? ` • ${m.assists} assists` : '';
                return `${medal} **${m.name}**: **${m.attacks.toLocaleString()} hits**${assistStr}`;
            })
            .join("\n") || "No attack records yet";

        const targetProgressStr = targetScore > 0 ? `• **Target**: **${targetScore.toLocaleString()}** pts (${((ourScore / targetScore) * 100).toFixed(1)}%)` : '';

        return {
            title: `⚔️ Ranked War: ${ourName} vs ${enemyName}`,
            description: `**Started**: ${startTime} ${targetProgressStr}\n\n` +
                         `**${ourName}**: **${ourScore.toLocaleString()}** pts (${totalFriendlyHits > 0 ? `${totalFriendlyHits.toLocaleString()} recorded hits across ${friendlyMembers.length} fighters` : `${ourScore.toLocaleString()} pts`})\n` +
                         `**${enemyName}**: **${enemyScore.toLocaleString()}** pts\n` +
                         `**Lead**: **${lead >= 0 ? '+' : ''}${lead.toLocaleString()}** pts (${isLeading ? '🟢 WINNING' : '🔴 TRAILING'})\n\n` +
                         `${bar} (${(ourPct * 100).toFixed(1)}%)\n`,
            color: isLeading ? 0x2ed573 : 0xff4757,
            fields: [
                { name: `🏆 Top War Hitters`, value: topHitters, inline: false },
                { name: "🔗 Quick Links", value: `[📡 Open Live Warboard](https://spider-verse.net) • [⚔️ Attack Screen](https://www.torn.com/factions.php?step=your#/tab=war)`, inline: false }
            ],
            footer: { text: `Official Torn Ranked War Stats • ${new Date().toUTCString()}` }
        };
    } catch (e) {
        return { title: "⚔️ Ranked War Status", description: `⚠️ Could not fetch war data: ${e.message}`, color: 0xff4757 };
    }
}

async function buildTargetsEmbed(apiKey) {
    const enemyId = discordConfig.enemyFacId;
    if (!apiKey || !enemyId) {
        return {
            title: "🎯 Priority Enemy Targets",
            description: "⚠️ Enemy Faction ID is not configured. Set Enemy Faction ID in Dashboard Settings.",
            color: 0xff4757
        };
    }
    try {
        const res = await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const members = Object.entries(data.members || {}).map(([id, m]) => ({ id, ...m }));

        for (const m of members) {
            if (m.name) playerNameCache[m.id.toString()] = m.name;
        }

        // Bulk sync stats from FF Scouter if key is present
        const ffKey = getGlobalFFKey() || discordConfig.ffKey;
        if (ffKey && members.length > 0) {
            const unscouted = members.map(m => m.id).filter(id => !spyDatabase[id]?.total && !statsCache[id]?.stats);
            if (unscouted.length > 0) {
                await fetchBulkFFScouterStats(unscouted, ffKey);
            }
        }

        const available = members.filter(m => {
            const state = m.status?.state || '';
            const desc = (m.status?.description || '').toLowerCase();
            const isHosp = state === 'Hospital' || desc.includes('hospital');
            const isJail = state === 'Jail' || desc.includes('jail');
            const isAbroad = state === 'Abroad' || desc.includes('abroad') || desc.includes('in ');
            if (isHosp || isJail || isAbroad) return false;
            return true;
        });

        available.sort((a, b) => {
            const scoreA = a.last_action?.status === 'Online' ? 3 : (a.last_action?.status === 'Idle' ? 2 : 1);
            const scoreB = b.last_action?.status === 'Online' ? 3 : (b.last_action?.status === 'Idle' ? 2 : 1);
            if (scoreB !== scoreA) return scoreB - scoreA;
            return (b.level || 0) - (a.level || 0);
        });

        const top10 = available.slice(0, 10);
        if (top10.length === 0) {
            return {
                title: `🎯 ${data.name || 'Enemy'} Targets`,
                description: `No enemy targets are currently attackable in Torn (all in hospital, traveling, or offline).`,
                color: 0xffa502,
                footer: { text: "Torn Warfare Suite" }
            };
        }

        const lines = top10.map((m, idx) => {
            const onlineDot = m.last_action?.status === 'Online' ? '🟢' : (m.last_action?.status === 'Idle' ? '🟡' : '⚪');
            const spyTotal = spyDatabase[m.id]?.total || statsCache[m.id]?.stats || manualStats[m.id]?.stats;
            const statsStr = spyTotal 
                ? `**${formatStatNumber(spyTotal)}** stats` 
                : `~**${formatStatNumber(estimateStatsFromLevel(m.level))}** *(Est)*`;
            const claimTag = claims[m.id] ? ` *(🎯 Claimed: ${claims[m.id].playerName})*` : '';
            const name = getPlayerName(m.id, m.name);
            return `${idx + 1}. ${onlineDot} [**${name}**](https://www.torn.com/loader.php?sid=attack&user2ID=${m.id}) — ${statsStr} • [⚔️ Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${m.id})${claimTag}`;
        });

        return {
            title: `🎯 ${data.name || 'Enemy'} — Priority Attack Targets (${available.length} Okay)`,
            description: lines.join("\n"),
            color: 0xff4757,
            fields: [
                { name: "💡 Quick Tip", value: "Click [⚔️ Attack] to open the battle screen. Use `/claim <target>` to lock a target.", inline: false }
            ],
            footer: { text: `Live Enemy Targets • ${new Date().toUTCString()}` }
        };
    } catch (e) {
        return { title: "🎯 Priority Enemy Targets", description: `⚠️ Could not fetch enemy roster: ${e.message}`, color: 0xff4757 };
    }
}

async function buildSpyEmbed(targetQuery, apiKey) {
    if (!targetQuery) return { title: "🕵️ Spy Report", description: "Please provide a Torn Player ID or Name.", color: 0xff4757 };
    const targetId = targetQuery.toString().trim().replace(/[^0-9]/g, "");
    const ffKey = getGlobalFFKey() || discordConfig.ffKey;
    
    // Fetch stats from FF Scouter if not in local cache
    if (targetId && (!spyDatabase[targetId] || !spyDatabase[targetId].total) && ffKey) {
        await fetchBulkFFScouterStats([targetId], ffKey);
    }

    let spy = spyDatabase[targetId] || (statsCache[targetId]?.stats ? { total: statsCache[targetId].stats } : null);
    let playerName = getPlayerName(targetId, `Target #${targetId}`);

    if (apiKey && targetId && (!playerName || playerName.startsWith("Target #") || playerName.startsWith("Player #"))) {
        try {
            const userRes = await fetch(`https://api.torn.com/user/${targetId}?selections=profile&key=${apiKey}`, { signal: AbortSignal.timeout(6000) });
            const userData = await userRes.json();
            if (userData.name) {
                playerName = userData.name;
                playerNameCache[targetId] = userData.name;
            }
        } catch(e) {}
    }

    if (!spy) {
        return {
            title: `🕵️ Spy Report: ${playerName}`,
            description: `⚠️ No spy records found in FF Scouter or database for **${playerName}**.\n\n` +
                         `• You can enter a manual spy on the [Live Warboard](https://spider-verse.net) by clicking **Inspect** on this player.\n` +
                         `• [⚔️ Attack ${playerName}](https://www.torn.com/loader.php?sid=attack&user2ID=${targetId}) • [👤 View Profile](https://www.torn.com/profiles.php?XID=${targetId})`,
            color: 0xffa502,
            footer: { text: "Torn Spy Intelligence" }
        };
    }

    const spiedTime = spy.timestamp ? `<t:${Math.floor(spy.timestamp / 1000)}:R>` : "Verified";
    const strVal = spy.strength ? Number(spy.strength).toLocaleString() : "Unknown";
    const defVal = spy.defense ? Number(spy.defense).toLocaleString() : "Unknown";
    const spdVal = spy.speed ? Number(spy.speed).toLocaleString() : "Unknown";
    const dexVal = spy.dexterity ? Number(spy.dexterity).toLocaleString() : "Unknown";

    return {
        title: `🕵️ Battle Stats Spy: ${playerName}`,
        description: `**Total Battle Stats**: **${formatStatNumber(spy.total || 0)}** (${(spy.total || 0).toLocaleString()})\n**Spied / Verified**: ${spiedTime}`,
        color: 0x58a6ff,
        fields: [
            { name: "💪 Strength", value: strVal, inline: true },
            { name: "🛡️ Defense", value: defVal, inline: true },
            { name: "⚡ Speed", value: spdVal, inline: true },
            { name: "🤸 Dexterity", value: dexVal, inline: true },
            { name: "⚔️ Actions", value: `[⚔️ Launch Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${targetId}) • [👤 Profile](https://www.torn.com/profiles.php?XID=${targetId})`, inline: false }
        ],
        footer: { text: "Torn Warfare Suite • FF Scouter & Spy DB" }
    };
}

async function buildChainStatusEmbed(apiKey) {
    if (!apiKey) return { title: "🔗 Chain Status", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const res = await fetch(`https://api.torn.com/faction/?selections=chain,basic&key=${apiKey}`, { signal: AbortSignal.timeout(7000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const chain = data.chain || {};
        const current = chain.current || 0;
        const max = chain.max || 10;
        const timeout = chain.timeout || 0;
        const modifier = Number(chain.modifier || 1.0).toFixed(2);
        const cooldown = chain.cooldown || 0;

        if (cooldown > 0) {
            return {
                title: `🔗 Chain on Cooldown: ${data.name || 'Faction'}`,
                description: `The faction chain is currently on cooldown for **${Math.ceil(cooldown / 60)} minutes**.`,
                color: 0xffa502,
                footer: { text: "Torn Chain Intelligence" }
            };
        }

        if (current === 0) {
            return {
                title: `🔗 Chain Inactive: ${data.name || 'Faction'}`,
                description: `No active chain running right now. Ready to start next chain!`,
                color: 0x8b949e,
                footer: { text: "Torn Chain Intelligence" }
            };
        }

        const pct = Math.min(1, current / max);
        const filled = Math.round(pct * 10);
        const bar = "🟩".repeat(filled) + "⬛".repeat(10 - filled);

        const mins = Math.floor(timeout / 60);
        const secs = timeout % 60;
        const timeStr = `${mins}m ${secs.toString().padStart(2, '0')}s`;
        const isPanic = timeout > 0 && timeout <= 90;

        return {
            title: `🔗 Chain Status: ${current} / ${max} Hits ${isPanic ? '🚨 DANGER!' : ''}`,
            description: `${isPanic ? '⚠️ **CHAIN IN DANGER OF DROPPING! HIT NOW!**\n\n' : ''}` +
                         `**Current Count**: **${current.toLocaleString()}** / ${max.toLocaleString()} hits\n` +
                         `**Timer Remaining**: **${timeStr}**\n` +
                         `**Respect Bonus**: **${modifier}x**\n\n` +
                         `${bar} (${Math.round(pct * 100)}%)\n`,
            color: isPanic ? 0xff4757 : 0x2ed573,
            fields: [
                { name: "⚔️ Attack Links", value: `[🎯 Targets Screen](https://www.torn.com/factions.php?step=your#/tab=war) • [📡 Live Warboard](https://spider-verse.net)`, inline: false }
            ],
            footer: { text: `Chain Watcher • ${new Date().toUTCString()}` }
        };
    } catch (e) {
        return { title: "🔗 Chain Status", description: `⚠️ Could not fetch chain data: ${e.message}`, color: 0xff4757 };
    }
}

async function buildChainWatchEmbed(apiKey) {
    if (!apiKey) return { title: "🔗 Chain Watchers", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const res = await fetch(`https://api.torn.com/faction/?selections=basic,chain&key=${apiKey}`, { signal: AbortSignal.timeout(7000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const members = Object.entries(data.members || {}).map(([id, m]) => ({ id, ...m }));
        const onlineInTorn = members.filter(m => {
            const state = m.status?.state || '';
            const desc = (m.status?.description || '').toLowerCase();
            const inTorn = state === 'Okay' || desc.includes('in torn');
            const isHosp = state === 'Hospital' || desc.includes('hospital');
            const isJail = state === 'Jail' || desc.includes('jail');
            const isAbroad = state === 'Abroad' || desc.includes('abroad') || desc.includes('in ');
            const isOnline = m.last_action?.status === 'Online' || m.last_action?.status === 'Idle';
            return inTorn && !isHosp && !isJail && !isAbroad && isOnline;
        });

        const list = onlineInTorn.map(m => {
            const dot = m.last_action?.status === 'Online' ? '🟢' : '🟡';
            return `${dot} **${m.name}** [${m.id}] (Lvl ${m.level}) • [Profile](https://www.torn.com/profiles.php?XID=${m.id})`;
        }).join("\n") || "No online members in Torn right now!";

        const timeout = data.chain?.timeout || 0;
        const current = data.chain?.current || 0;

        return {
            title: `🔗 Chain Watchers — Online & Ready in Torn (${onlineInTorn.length})`,
            description: `**Chain Count**: ${current} hits • **Time Left**: ${Math.floor(timeout/60)}m ${timeout%60}s\n\n` + list,
            color: 0x58a6ff,
            footer: { text: "Chain Watcher Engine" }
        };
    } catch(e) {
        return { title: "🔗 Chain Watchers", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildProfileEmbed(playerQuery, apiKey) {
    if (!playerQuery || !apiKey) return { title: "👤 Player Profile", description: "Please provide a Player ID.", color: 0xff4757 };
    const id = playerQuery.toString().trim().replace(/[^0-9]/g, "");
    try {
        const res = await fetch(`https://api.torn.com/user/${id}?selections=profile,crimes,discord&key=${apiKey}`, { signal: AbortSignal.timeout(7000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Player not found");

        const status = data.status?.description || data.status?.state || "Unknown";
        const factionStr = data.faction?.faction_name ? `[${data.faction.faction_name}](https://www.torn.com/factions.php?step=profile&ID=${data.faction.faction_id}) (${data.faction.position || 'Member'})` : "None (Factionless)";
        const reviveStr = data.revivable === 1 ? "🟢 Enabled" : "🔴 Disabled";
        const lastAction = data.last_action?.relative || "Unknown";
        const awards = data.awards || 0;
        const rank = data.rank || "Unknown";

        return {
            title: `👤 ${data.name} [${data.player_id}]`,
            description: `**Level**: **${data.level}** • **Rank**: **${rank}** • **Age**: **${(data.age || 0).toLocaleString()} days**\n` +
                         `**Status**: **${status}**\n` +
                         `**Last Active**: **${data.last_action?.status || 'Offline'}** (${lastAction})\n` +
                         `**Faction**: ${factionStr}\n` +
                         `**Revives**: ${reviveStr} • **Awards**: ${awards}\n`,
            color: data.status?.state === 'Hospital' ? 0xff4757 : (data.status?.state === 'Traveling' ? 0x58a6ff : 0x2ed573),
            fields: [
                { name: "🔗 Profile Links", value: `[👤 Torn Profile](https://www.torn.com/profiles.php?XID=${data.player_id}) • [⚔️ Attack Player](https://www.torn.com/loader.php?sid=attack&user2ID=${data.player_id}) • [🎯 Place Bounty](https://www.torn.com/bounties.php?p=add&XID=${data.player_id}&amount=150000)`, inline: false }
            ],
            footer: { text: "Torn Player Intelligence" }
        };
    } catch(e) {
        return { title: "👤 Player Profile", description: `⚠️ Could not fetch profile: ${e.message}`, color: 0xff4757 };
    }
}

async function buildHospitalEmbed(apiKey) {
    if (!apiKey) return { title: "🏥 Hospital Roster", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const res = await fetch(`https://api.torn.com/faction/?selections=basic&key=${apiKey}`, { signal: AbortSignal.timeout(7000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const now = Math.floor(Date.now() / 1000);
        const members = Object.entries(data.members || {}).map(([id, m]) => ({ id, ...m }));
        const inHosp = members.filter(m => m.status?.state === 'Hospital');

        if (inHosp.length === 0) {
            return {
                title: `🏥 ${data.name || 'Faction'} Hospital Roster (0 Hospitalized)`,
                description: `🎉 All friendly members are out of hospital and ready for action!`,
                color: 0x2ed573,
                footer: { text: "Torn Medical Intelligence" }
            };
        }

        inHosp.sort((a, b) => (a.status?.until || 0) - (b.status?.until || 0));

        const lines = inHosp.map((m, idx) => {
            const minsLeft = Math.max(0, Math.ceil(((m.status?.until || 0) - now) / 60));
            const desc = m.status?.description || "Hospitalized";
            return `${idx + 1}. [**${m.name}** [${m.id}]](https://www.torn.com/profiles.php?XID=${m.id}) — ⏳ **${minsLeft}m left**\n   └ *${desc}*`;
        });

        return {
            title: `🏥 ${data.name || 'Faction'} Hospital Roster (${inHosp.length} in Hospital)`,
            description: lines.join("\n"),
            color: 0xff4757,
            footer: { text: `Hospital Tracker • ${new Date().toUTCString()}` }
        };
    } catch(e) {
        return { title: "🏥 Hospital Roster", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildOnlineRosterEmbed(apiKey) {
    if (!apiKey) return { title: "👥 Faction Roster", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const res = await fetch(`https://api.torn.com/faction/?selections=basic&key=${apiKey}`, { signal: AbortSignal.timeout(7000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const members = Object.entries(data.members || {}).map(([id, m]) => ({ id, ...m }));
        const total = members.length;

        let online = 0, idle = 0, offline = 0, hosp = 0, traveling = 0, okayInTorn = 0;
        members.forEach(m => {
            const state = m.status?.state || '';
            const action = m.last_action?.status || 'Offline';
            if (state === 'Hospital') hosp++;
            else if (state === 'Traveling' || state === 'Abroad') traveling++;
            else okayInTorn++;

            if (action === 'Online') online++;
            else if (action === 'Idle') idle++;
            else offline++;
        });

        return {
            title: `👥 ${data.name || 'Faction'} — Live Readiness Status (${total} Members)`,
            description: `**Respect**: **${(data.respect || 0).toLocaleString()}** • **Rank**: **${data.rank?.name || 'Unranked'}**\n\n` +
                         `🟢 **Online**: **${online}** (${Math.round(online/total*100)}%)\n` +
                         `🟡 **Idle**: **${idle}**\n` +
                         `⚪ **Offline**: **${offline}**\n\n` +
                         `🛡️ **Okay in Torn**: **${okayInTorn}** fighters ready\n` +
                         `🏥 **Hospital**: **${hosp}** members\n` +
                         `✈️ **Traveling / Abroad**: **${traveling}** members\n`,
            color: 0x58a6ff,
            footer: { text: "Faction Roster Analytics" }
        };
    } catch(e) {
        return { title: "👥 Faction Roster", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildOCStatusEmbed(apiKey) {
    if (!apiKey) return { title: "💼 Organized Crimes", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const res = await fetch(`https://api.torn.com/faction/?selections=crimes&key=${apiKey}`, { signal: AbortSignal.timeout(7000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const crimes = Object.entries(data.crimes || {}).map(([id, c]) => ({ id, ...c }));
        const now = Math.floor(Date.now() / 1000);

        const ready = [];
        const inPlanning = [];

        crimes.forEach(c => {
            if (c.initiated === 1) return;
            if (c.ready === 1 || (c.time_ready && c.time_ready <= now)) {
                ready.push(c);
            } else if (c.time_ready && c.time_ready > now) {
                inPlanning.push(c);
            }
        });

        const readyList = ready.slice(0, 5).map(c => `🟢 **${c.crime_name}** — **Ready to Initiate!** (${c.participants?.length || 0} members)`).join("\n") || "No crimes currently ready to launch.";
        const planList = inPlanning.slice(0, 5).map(c => {
            const hours = Math.ceil((c.time_ready - now) / 3600);
            return `⏳ **${c.crime_name}** — Ready in **${hours}h** (<t:${c.time_ready}:R>)`;
        }).join("\n") || "No crimes in planning.";

        return {
            title: `💼 Organized Crimes Status (${ready.length} Ready, ${inPlanning.length} Planning)`,
            description: `**🟢 Ready To Launch (${ready.length})**\n${readyList}\n\n` +
                         `**⏳ In Planning (${inPlanning.length})**\n${planList}\n`,
            color: ready.length > 0 ? 0x2ed573 : 0x58a6ff,
            fields: [
                { name: "💼 OC Manager", value: `[Open Web OC Manager](https://spider-verse.net/oc.html)`, inline: false }
            ],
            footer: { text: "Organized Crime Intelligence" }
        };
    } catch(e) {
        return { title: "💼 Organized Crimes", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildMyOCEmbed(playerQuery, apiKey, callerUsername) {
    if (!apiKey) return { title: "💼 My OC Status", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const res = await fetch(`https://api.torn.com/faction/?selections=crimes,basic&key=${apiKey}`, { signal: AbortSignal.timeout(7000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const targetSearch = (playerQuery || callerUsername || '').toLowerCase().trim();
        const crimes = Object.entries(data.crimes || {}).map(([id, c]) => ({ id, ...c }));
        const now = Math.floor(Date.now() / 1000);

        let matchedCrime = null;
        for (const c of crimes) {
            if (c.initiated === 1) continue;
            for (const p of (c.participants || [])) {
                const pId = (p.player_id || Object.keys(p)[0] || '').toString();
                const pObj = p[pId] || p;
                const pName = (pObj.name || '').toLowerCase();
                if (pId === targetSearch || (pName && pName.includes(targetSearch))) {
                    matchedCrime = { crime: c, participant: pObj, playerId: pId };
                    break;
                }
            }
            if (matchedCrime) break;
        }

        if (!matchedCrime) {
            return {
                title: "💼 My Organized Crime",
                description: `Could not find an active OC assignment matching **${playerQuery || callerUsername}**.\n\nMake sure your name matches your Torn character name or use \`/myoc player:<Your Torn ID>\`.`,
                color: 0xffa502,
                footer: { text: "Organized Crime Intelligence" }
            };
        }

        const c = matchedCrime.crime;
        const isReady = c.ready === 1 || (c.time_ready && c.time_ready <= now);
        const timeStr = isReady ? "🟢 **READY TO INITIATE!**" : `⏳ Ready in **${Math.ceil((c.time_ready - now)/3600)} hours** (<t:${c.time_ready}:R>)`;
        
        const teammates = (c.participants || []).map(p => {
            const pId = (p.player_id || Object.keys(p)[0] || '').toString();
            const pObj = p[pId] || p;
            return `• **${pObj.name || `Player #${pId}`}** [${pId}]`;
        }).join("\n");

        return {
            title: `💼 OC Assignment: ${c.crime_name}`,
            description: `**Status**: ${timeStr}\n\n**👥 Team Members**:\n${teammates}`,
            color: isReady ? 0x2ed573 : 0x58a6ff,
            footer: { text: "Organized Crime Intelligence" }
        };
    } catch(e) {
        return { title: "💼 My OC Status", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildStocksEmbed(country, apiKey) {
    try {
        const yataCountryMap = {
            "Mexico": "mex", "Cayman Islands": "cay", "Canada": "can", "Hawaii": "haw",
            "United Kingdom": "uni", "Argentina": "arg", "Switzerland": "swi", "Japan": "jap",
            "China": "chi", "UAE": "uae", "South Africa": "sou"
        };
        const yCode = yataCountryMap[country] || "mex";
        const yataRes = await fetch(`https://yata.yt/api/v1/travel/export/`, { signal: AbortSignal.timeout(6000) });
        const yataData = await yataRes.json();
        
        const countryStocks = yataData.stocks?.[yCode]?.stocks || [];
        if (countryStocks.length === 0) {
            return {
                title: `✈️ Overseas Stock: ${country}`,
                description: `No live stock data found for **${country}** right now.`,
                color: 0x58a6ff
            };
        }

        const lines = countryStocks.slice(0, 10).map(s => {
            const stockIcon = s.quantity > 500 ? '🟢' : (s.quantity > 50 ? '🟡' : '🔴');
            return `${stockIcon} **${s.name}**: **${(s.quantity || 0).toLocaleString()} in stock** (Cost: $${(s.cost || 0).toLocaleString()})`;
        });

        return {
            title: `✈️ Live Overseas Stock: ${country}`,
            description: lines.join("\n"),
            color: 0x00cec9,
            fields: [
                { name: "🧮 Travel Calculator", value: `[Open Travel Calculator](https://spider-verse.net/travel.html)`, inline: false }
            ],
            footer: { text: `Live Foreign Stock • Powered by YATA • ${new Date().toUTCString()}` }
        };
    } catch(e) {
        return { title: `✈️ Overseas Stock: ${country}`, description: `⚠️ Error fetching stocks: ${e.message}`, color: 0xff4757 };
    }
}

async function buildBazaarEmbed(itemQuery, apiKey) {
    if (!itemQuery || !apiKey) return { title: "🛒 Bazaar Price Check", description: "Please enter an item name.", color: 0xff4757 };
    try {
        const itemsRes = await fetch(`https://api.torn.com/torn/?selections=items&key=${apiKey}`, { signal: AbortSignal.timeout(7000) });
        const itemsData = await itemsRes.json();
        if (itemsData.error) throw new Error(itemsData.error.error || "Torn API error");

        const q = itemQuery.toLowerCase().trim();
        const items = Object.entries(itemsData.items || {}).map(([id, i]) => ({ id, ...i }));
        
        let match = items.find(i => i.id.toString() === q || i.name.toLowerCase() === q);
        if (!match) match = items.find(i => i.name.toLowerCase().includes(q));

        if (!match) {
            return {
                title: "🛒 Bazaar Price Check",
                description: `No item found matching **"${itemQuery}"**.`,
                color: 0xffa502
            };
        }

        // Fetch live lowest market listings for this specific item
        let lowestBazaars = [];
        let lowestItemMarket = [];
        try {
            const marketRes = await fetch(`https://api.torn.com/market/${match.id}?selections=bazaar,itemmarket&key=${apiKey}`, { signal: AbortSignal.timeout(7000) });
            const marketData = await marketRes.json();
            if (marketData && !marketData.error) {
                if (Array.isArray(marketData.bazaar)) lowestBazaars = marketData.bazaar;
                if (Array.isArray(marketData.itemmarket)) lowestItemMarket = marketData.itemmarket;
            }
        } catch(e) {}

        const marketVal = match.market_value ? `$${Number(match.market_value).toLocaleString()}` : 'N/A';
        const bestBazaar = lowestBazaars.length > 0 ? `$${Number(lowestBazaars[0].cost).toLocaleString()}` : null;
        const bestMarket = lowestItemMarket.length > 0 ? `$${Number(lowestItemMarket[0].cost).toLocaleString()}` : null;

        let bazaarLines = "No live bazaar listings currently available.";
        if (lowestBazaars.length > 0) {
            bazaarLines = lowestBazaars.slice(0, 4).map((b, idx) => {
                const sellerName = getPlayerName(b.player_id, `Player #${b.player_id}`);
                return `**#${idx + 1}** • **$${Number(b.cost).toLocaleString()}** (Qty: **${(b.quantity || 1).toLocaleString()}**) • [🛒 ${sellerName}'s Bazaar](https://www.torn.com/bazaar.php?userId=${b.player_id})`;
            }).join("\n");
        }

        let itemMarketLines = "";
        if (lowestItemMarket.length > 0) {
            itemMarketLines = lowestItemMarket.slice(0, 3).map((im, idx) => {
                return `**#${idx + 1}** • **$${Number(im.cost).toLocaleString()}** (Qty: **${(im.quantity || 1).toLocaleString()}**)`;
            }).join("\n");
        }

        const fields = [
            { name: `📦 Lowest Live Bazaars (Cheapest: ${bestBazaar || marketVal})`, value: bazaarLines, inline: false }
        ];

        if (itemMarketLines) {
            fields.push({ name: `🏪 Lowest Item Market (Cheapest: ${bestMarket || marketVal})`, value: itemMarketLines, inline: false });
        }

        fields.push({
            name: "🔗 Quick Links",
            value: `[🛒 Item Market](https://www.torn.com/imarket.php#/p=shop&type=${match.id}) • [📦 Bazaar Search](https://www.torn.com/bazaar.php)`,
            inline: false
        });

        return {
            title: `🛒 ${match.name} [Item #${match.id}]`,
            description: `**Category**: ${match.type} • **Circulation**: ${(match.circulation || 0).toLocaleString()}\n\n` +
                         `💰 **Average Market Value**: **${marketVal}**\n` +
                         (bestBazaar ? `🏷️ **Cheapest Bazaar**: **${bestBazaar}**\n` : '') +
                         (bestMarket ? `🏪 **Cheapest Item Market**: **${bestMarket}**\n` : '') +
                         `\n*${match.description || ''}*`,
            thumbnail: { url: match.image },
            color: 0x00cec9,
            fields,
            footer: { text: `Live Torn Market Intelligence • ${new Date().toUTCString()}` }
        };
    } catch(e) {
        return { title: "🛒 Bazaar Price Check", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildFactionStatsRosterEmbed(factionChoice = 'enemy', apiKey) {
    if (!apiKey) return { title: "📊 Faction Battle Stats", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        let isEnemy = (factionChoice !== 'friendly' && factionChoice !== 'our');

        const ourRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const ourData = await ourRes.json();
        if (ourData.error) throw new Error(ourData.error.error || "Torn API error");

        let facId = null;
        if (isEnemy) {
            let detectedEnemy = currentEnemyFacId || discordConfig.enemyFacId || autoDetectEnemyFaction(ourData);
            if (!detectedEnemy && ourData.rankedwars) {
                let activeWar = Object.values(ourData.rankedwars).find(w => w.war && (w.war.winner === 0 || !w.war.end || w.war.end === 0));
                if (activeWar && activeWar.factions) {
                    const fids = Object.keys(activeWar.factions);
                    detectedEnemy = fids.find(id => id !== ourData.ID?.toString());
                }
            }
            if (!detectedEnemy) {
                return {
                    title: "🎯 Enemy Battle Stats Roster",
                    description: "⚠️ No enemy faction currently detected or configured. Set Enemy Faction ID in Settings or enter a Ranked War.",
                    color: 0xffa502
                };
            }
            facId = detectedEnemy;
        } else {
            facId = ourData.ID;
        }

        let facData = ourData;
        if (isEnemy) {
            const enemyRes = await fetch(`https://api.torn.com/faction/${facId}?selections=basic&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
            facData = await enemyRes.json();
            if (facData.error) throw new Error(facData.error.error || "Torn API error fetching enemy faction");
        }

        for (const [id, m] of Object.entries(facData.members || {})) {
            if (m.name) playerNameCache[id.toString()] = m.name;
        }

        const ffKey = getGlobalFFKey() || discordConfig.ffKey;
        const memberIds = Object.keys(facData.members || {});
        
        // If we have an FF Scouter key, fetch all unscouted members in bulk right now!
        if (ffKey && memberIds.length > 0) {
            const unscouted = memberIds.filter(id => !spyDatabase[id]?.total && !statsCache[id]?.stats);
            if (unscouted.length > 0) {
                await fetchBulkFFScouterStats(unscouted, ffKey);
            }
        }

        const members = Object.entries(facData.members || {}).map(([id, m]) => {
            const rawStat = spyDatabase[id]?.total || statsCache[id]?.stats || manualStats[id]?.stats || null;
            let numericStat = typeof rawStat === 'number' ? rawStat : (rawStat ? Number(rawStat) : 0);
            let isEstimated = false;
            if (!numericStat || isNaN(numericStat) || numericStat <= 0) {
                numericStat = estimateStatsFromLevel(m.level);
                isEstimated = true;
            }
            return {
                id,
                name: m.name || `Player #${id}`,
                level: m.level || 0,
                position: m.position || '',
                daysInFaction: m.days_in_faction || 0,
                status: m.last_action?.status || 'Offline',
                state: m.status?.state || 'Okay',
                stats: numericStat,
                isEstimated,
                statsFormatted: `${formatStatNumber(numericStat)}${isEstimated ? ' *(Est)*' : ''}`
            };
        });

        members.sort((a, b) => b.stats - a.stats || b.level - a.level);

        let totalStatsSum = 0;
        let verifiedCount = 0;
        members.forEach(m => {
            totalStatsSum += m.stats;
            if (!m.isEstimated) verifiedCount++;
        });
        const avgStat = members.length > 0 ? totalStatsSum / members.length : 0;

        const lines = members.map((m, idx) => {
            const onlineDot = m.status === 'Online' ? '🟢' : (m.status === 'Idle' ? '🟡' : '⚪');
            const hospTag = m.state === 'Hospital' ? ' 🏥' : (m.state === 'Traveling' || m.state === 'Abroad' ? ' ✈️' : '');
            const statsBadge = `**${m.statsFormatted}** stats`;
            const actionLink = isEnemy
                ? `[⚔️ Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${m.id})`
                : `[👤 Profile](https://www.torn.com/profiles.php?XID=${m.id})`;
            return `\`${(idx + 1).toString().padStart(2, '0')}.\` ${onlineDot} [**${m.name}**](https://www.torn.com/profiles.php?XID=${m.id}) (Lvl ${m.level}) — ${statsBadge}${hospTag} • ${actionLink}`;
        });

        const fields = [];
        let currentFieldLines = [];
        let currentFieldLen = 0;
        let partNumber = 1;

        for (let idx = 0; idx < lines.length; idx++) {
            const line = lines[idx];
            // Discord max field value is 1024 characters; keep under 950 for safety
            if (currentFieldLen + line.length + 1 > 950 || currentFieldLines.length >= 10) {
                if (currentFieldLines.length > 0) {
                    fields.push({
                        name: fields.length === 0 ? `📋 Team Roster (Sorted by Stats)` : `📋 Team Roster (Part ${partNumber})`,
                        value: currentFieldLines.join('\n'),
                        inline: false
                    });
                    partNumber++;
                    currentFieldLines = [];
                    currentFieldLen = 0;
                }
            }
            currentFieldLines.push(line);
            currentFieldLen += line.length + 1;
        }

        if (currentFieldLines.length > 0) {
            fields.push({
                name: fields.length === 0 ? `📋 Team Roster (Sorted by Stats)` : `📋 Team Roster (Part ${partNumber})`,
                value: currentFieldLines.join('\n'),
                inline: false
            });
        }

        const intelNote = ffKey 
            ? `🛡️ **Intel Source**: FF Scouter & Spy DB (**${verifiedCount} / ${members.length}** verified)`
            : `⚠️ **Notice**: FF Scouter key not connected — using level baseline estimates. Connect FF Scouter in Dashboard Settings for live accuracy.`;

        return {
            title: `📊 ${facData.name || 'Faction'} — Battle Stats Roster (${members.length} Members)`,
            description: `**Faction Respect**: **${(facData.respect || 0).toLocaleString()}** • **Rank**: **${facData.rank?.name || 'Unranked'}**\n` +
                         `**Total Team Stats**: **${formatStatNumber(totalStatsSum)}**\n` +
                         `**Average Stats**: **${formatStatNumber(avgStat)}** / member\n` +
                         `${intelNote}\n`,
            color: isEnemy ? 0xff4757 : 0x2ed573,
            fields,
            footer: { text: `Torn Battle Stats Intel • FF Scouter & Spy DB • ${new Date().toUTCString()}` }
        };
    } catch(e) {
        return { title: "📊 Faction Battle Stats", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildPayoutEmbed(memberQuery, apiKey) {
    if (!apiKey) return { title: "💰 War Payout Calculator", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const cpm = Number(discordConfig.cpm) || 150000;
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars,attacks&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const data = await facRes.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const q = (memberQuery || '').toLowerCase().trim();
        const rankedWars = data.rankedwars || {};
        let activeWar = Object.values(rankedWars).find(w => w.war && (w.war.winner === 0 || !w.war.end || w.war.end === 0));
        if (!activeWar) {
            const sortedWars = Object.values(rankedWars).filter(w => w.war && w.war.start).sort((a, b) => (b.war.start || 0) - (a.war.start || 0));
            activeWar = sortedWars[0];
        }

        const ourFid = data.ID?.toString();
        const ourInfo = activeWar ? (activeWar.factions?.[ourFid] || Object.values(activeWar.factions || {})[0]) : null;
        let memberHitsMap = [];

        if (ourInfo && ourInfo.members && Object.keys(ourInfo.members).length > 0) {
            memberHitsMap = Object.entries(ourInfo.members).map(([id, m]) => ({
                id,
                name: m.name || `Player #${id}`,
                hits: Number(m.attacks || 0),
                score: Number(m.score || 0)
            })).filter(m => m.hits > 0 || m.score > 0);
        } else if (Object.keys(liveWarHits).length > 0) {
            memberHitsMap = Object.entries(liveWarHits).map(([id, hits]) => ({
                id,
                name: data.members?.[id]?.name || `Player #${id}`,
                hits: Number(hits || 0),
                score: 0
            })).filter(m => m.hits > 0);
        } else {
            const hitterCounts = {};
            if (data.attacks) {
                for (const atkId in data.attacks) {
                    const atk = data.attacks[atkId];
                    if (atk.attacker_faction == data.ID && atk.result && !atk.result.includes("Lost") && !atk.result.includes("Stalemate")) {
                        const id = (atk.attacker_id || "").toString();
                        const name = atk.attacker_name || `Player #${id}`;
                        if (!hitterCounts[id]) hitterCounts[id] = { name, id, hits: 0, score: 0 };
                        hitterCounts[id].hits++;
                        hitterCounts[id].score += Number(atk.respect_gain || 0);
                    }
                }
            }
            memberHitsMap = Object.values(hitterCounts);
        }

        memberHitsMap.sort((a, b) => b.hits - a.hits || b.score - a.score);

        if (q) {
            const matched = memberHitsMap.find(m => m.id.toString() === q || m.name.toLowerCase().includes(q));
            if (!matched) {
                return {
                    title: `💰 Payout Check: ${memberQuery}`,
                    description: `No recorded war hits found for **${memberQuery}** in this war.\n\n**Current CPM Rate**: $${cpm.toLocaleString()} per hit.`,
                    color: 0xffa502
                };
            }
            const totalEarned = matched.hits * cpm;
            return {
                title: `💰 War Payout: ${matched.name} [${matched.id}]`,
                description: `**Total War Hits**: **${matched.hits.toLocaleString()}** hits\n` +
                             `**Score Generated**: **${matched.score.toFixed(1)}** pts\n` +
                             `**Rate**: **$${cpm.toLocaleString()}** / hit\n\n` +
                             `💵 **Total Payout**: **$${totalEarned.toLocaleString()}**`,
                color: 0x2ed573,
                footer: { text: "Faction Payout System" }
            };
        }

        const top5 = memberHitsMap.slice(0, 5);
        let totalFactionHits = 0;
        memberHitsMap.forEach(m => totalFactionHits += m.hits);
        const totalFactionPayout = totalFactionHits * cpm;

        const lines = top5.map((m, idx) => {
            const owed = m.hits * cpm;
            return `${idx + 1}. **${m.name}**: **${m.hits} hits** ➔ **$${owed.toLocaleString()}**`;
        }).join("\n") || "No war hit records found.";

        return {
            title: `💰 Faction War Payouts (Rate: $${cpm.toLocaleString()} / hit)`,
            description: `**Total War Hits**: **${totalFactionHits.toLocaleString()}** hits across **${memberHitsMap.length}** fighters\n` +
                         `**Total Faction Pot**: **$${totalFactionPayout.toLocaleString()}**\n\n` +
                         `**🏆 Top Earners**:\n${lines}\n\nUse \`/payout member:<name or ID>\` to check a specific member.`,
            color: 0x2ed573,
            fields: [
                { name: "💰 Payout Dashboard", value: `[Open Web Payout Manager](https://spider-verse.net/payout.html)`, inline: false }
            ],
            footer: { text: "Faction Payout System" }
        };
    } catch(e) {
        return { title: "💰 War Payout Calculator", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildTopHittersEmbed(apiKey) {
    if (!apiKey) return { title: "🏆 War MVP Leaderboard", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars,attacks&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const data = await facRes.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const rankedWars = data.rankedwars || {};
        let activeWar = Object.values(rankedWars).find(w => w.war && (w.war.winner === 0 || !w.war.end || w.war.end === 0));
        if (!activeWar) {
            const sortedWars = Object.values(rankedWars).filter(w => w.war && w.war.start).sort((a, b) => (b.war.start || 0) - (a.war.start || 0));
            activeWar = sortedWars[0];
        }

        const ourFid = data.ID?.toString();
        const ourInfo = activeWar ? (activeWar.factions?.[ourFid] || Object.values(activeWar.factions || {})[0]) : null;
        const ourScore = ourInfo?.score || 0;

        let memberList = [];

        // 1. Check if ourInfo.members exists (archived war report)
        if (ourInfo && ourInfo.members && Object.keys(ourInfo.members).length > 0) {
            memberList = Object.entries(ourInfo.members).map(([id, m]) => ({
                id,
                name: m.name || `Player #${id}`,
                attacks: Number(m.attacks || 0),
                score: Number(m.score || 0),
                assists: Number(m.assists || 0)
            })).filter(m => m.attacks > 0 || m.score > 0);
        }

        // 2. Otherwise use liveWarHits (the full aggregated war attack history)
        if (memberList.length === 0 && Object.keys(liveWarHits).length > 0) {
            memberList = Object.entries(liveWarHits).map(([id, hits]) => {
                const name = data.members?.[id]?.name || `Player #${id}`;
                const assists = Number(liveAssists[id] || 0);
                return {
                    id,
                    name,
                    attacks: Number(hits || 0),
                    score: 0,
                    assists
                };
            }).filter(m => m.attacks > 0 || m.assists > 0);
        }

        // 3. Fallback to data.attacks if neither has data
        if (memberList.length === 0 && data.attacks) {
            const hitterCounts = {};
            for (const atkId in data.attacks) {
                const atk = data.attacks[atkId];
                if (atk.attacker_faction == data.ID && atk.result && !atk.result.includes("Lost") && !atk.result.includes("Stalemate")) {
                    const id = (atk.attacker_id || "").toString();
                    const name = atk.attacker_name || `Player #${id}`;
                    if (!hitterCounts[id]) hitterCounts[id] = { id, name, attacks: 0, score: 0, assists: 0 };
                    if (atk.result === "Assist") hitterCounts[id].assists++;
                    else hitterCounts[id].attacks++;
                    hitterCounts[id].score += Number(atk.respect_gain || 0);
                }
            }
            memberList = Object.values(hitterCounts);
        }

        memberList.sort((a, b) => b.attacks - a.attacks || b.score - a.score);

        let totalHits = 0;
        memberList.forEach(m => totalHits += m.attacks);

        if (memberList.length === 0) {
            return {
                title: `🏆 ${data.name || 'Faction'} — War MVP Leaderboard`,
                description: "No war attack records found yet.",
                color: 0x8b949e
            };
        }

        const top10 = memberList.slice(0, 10);
        const lines = top10.map((m, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${idx + 1}**`;
            const assistStr = m.assists > 0 ? ` • ${m.assists} assists` : '';
            const scoreStr = m.score > 0 ? ` • ${m.score.toFixed(1)} pts` : '';
            return `${medal} [**${m.name}** [${m.id}]](https://www.torn.com/profiles.php?XID=${m.id})\n   └ **${m.attacks.toLocaleString()} total war hits**${scoreStr}${assistStr}`;
        }).join("\n\n");

        return {
            title: `🏆 ${data.name || 'Faction'} — Top Total War Hitters & MVPs`,
            description: `**Total War Hits**: **${totalHits.toLocaleString()}** hits across **${memberList.length}** fighters\n` +
                         (ourScore > 0 ? `**Faction War Score**: **${ourScore.toLocaleString()}** pts\n\n` : '\n') +
                         lines,
            color: 0xffa502,
            footer: { text: "Faction War MVP Analytics" }
        };
    } catch(e) {
        return { title: "🏆 War Leaderboard", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

// ─── Register Slash Commands with Discord ─────────────────────────────────────
async function registerSlashCommands(token, guildId = null) {
    const rest = new REST({ version: '10' }).setToken(token);

    const commands = [
        // 1. War & Combat Intelligence
        new SlashCommandBuilder().setName('war').setDescription('Show live ranked war status, scores, lead, and top war hitters').toJSON(),
        new SlashCommandBuilder().setName('targets').setDescription('List priority enemy targets attackable in Torn right now').toJSON(),
        new SlashCommandBuilder().setName('spy').setDescription('Look up battle stats & spy records for a player')
            .addStringOption(opt => opt.setName('target').setDescription('Torn Player ID or Name').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('claim').setDescription('Claim an enemy target in the live warboard')
            .addStringOption(opt => opt.setName('target').setDescription('Torn Player ID').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('unclaim').setDescription('Release your claim on an enemy target')
            .addStringOption(opt => opt.setName('target').setDescription('Torn Player ID').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('sos').setDescription('Request urgent backup on a tough target')
            .addStringOption(opt => opt.setName('target').setDescription('Torn Player ID').setRequired(true))
            .addStringOption(opt => opt.setName('note').setDescription('Reason / notes (optional)')).toJSON(),

        // 2. Chain Management
        new SlashCommandBuilder().setName('chain').setDescription('Check live faction chain status, timer, and multiplier').toJSON(),
        new SlashCommandBuilder().setName('chainwatch').setDescription('List online faction members in Torn ready to hit/save chain').toJSON(),

        // 3. Faction & Member Commands
        new SlashCommandBuilder().setName('profile').setDescription('View comprehensive player profile, status, and stats')
            .addStringOption(opt => opt.setName('player').setDescription('Torn Player ID or Name').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('hospital').setDescription('List all friendly faction members currently in hospital').toJSON(),
        new SlashCommandBuilder().setName('roster').setDescription('Live faction readiness breakdown (Online, Traveling, Hospitalized)').toJSON(),

        // 4. Organized Crimes (OC)
        new SlashCommandBuilder().setName('oc').setDescription('Summary of faction Organized Crimes status, ready OCs, and countdowns').toJSON(),
        new SlashCommandBuilder().setName('myoc').setDescription('Check your assigned Organized Crime and time remaining')
            .addStringOption(opt => opt.setName('player').setDescription('Torn Player ID or Name (optional)')).toJSON(),

        // 5. Travel & Economy
        new SlashCommandBuilder().setName('travel').setDescription('Look up friendly and enemy travel status for any destination')
            .addStringOption(opt => opt.setName('country').setDescription('Select country').setRequired(true)
                .addChoices(
                    { name: '🇲🇽 Mexico', value: 'Mexico' },
                    { name: '🏝️ Cayman Islands', value: 'Cayman Islands' },
                    { name: '🇨🇦 Canada', value: 'Canada' },
                    { name: '🌺 Hawaii', value: 'Hawaii' },
                    { name: '🇬🇧 United Kingdom', value: 'United Kingdom' },
                    { name: '🇦🇷 Argentina', value: 'Argentina' },
                    { name: '🇨🇭 Switzerland', value: 'Switzerland' },
                    { name: '🇯🇵 Japan', value: 'Japan' },
                    { name: '🇨🇳 China', value: 'China' },
                    { name: '🇦🇪 UAE', value: 'UAE' },
                    { name: '🇿🇦 South Africa', value: 'South Africa' }
                )
            ).toJSON(),
        new SlashCommandBuilder().setName('stocks').setDescription('Check live overseas item stock (Plushies & Flowers)')
            .addStringOption(opt => opt.setName('country').setDescription('Select country').setRequired(true)
                .addChoices(
                    { name: '🇲🇽 Mexico', value: 'Mexico' },
                    { name: '🏝️ Cayman Islands', value: 'Cayman Islands' },
                    { name: '🇨🇦 Canada', value: 'Canada' },
                    { name: '🌺 Hawaii', value: 'Hawaii' },
                    { name: '🇬🇧 United Kingdom', value: 'United Kingdom' },
                    { name: '🇦🇷 Argentina', value: 'Argentina' },
                    { name: '🇨🇭 Switzerland', value: 'Switzerland' },
                    { name: '🇯🇵 Japan', value: 'Japan' },
                    { name: '🇨🇳 China', value: 'China' },
                    { name: '🇦🇪 UAE', value: 'UAE' },
                    { name: '🇿🇦 South Africa', value: 'South Africa' }
                )
            ).toJSON(),
        new SlashCommandBuilder().setName('bazaar').setDescription('Check lowest Torn market price & bazaar stats for an item')
            .addStringOption(opt => opt.setName('item').setDescription('Item name or ID').setRequired(true)).toJSON(),

        // 6. War Payouts & Leaderboard
        new SlashCommandBuilder().setName('payout').setDescription('Check war hits and payout balance based on faction CPM')
            .addStringOption(opt => opt.setName('member').setDescription('Member name or ID (optional)')).toJSON(),
        new SlashCommandBuilder().setName('mvp').setDescription('Leaderboard of top total war hitters and MVPs').toJSON(),

        // 7. Team & Enemy Battle Stats Roster
        new SlashCommandBuilder().setName('stats').setDescription('Full battle stats roster for enemy faction or friendly faction')
            .addStringOption(opt => opt.setName('faction').setDescription('Select faction to inspect')
                .addChoices(
                    { name: '🎯 Enemy Faction', value: 'enemy' },
                    { name: '🛡️ Our Faction', value: 'friendly' }
                )
            ).toJSON(),
    ];

    try {
        const botRes = await fetch(`https://discord.com/api/v10/users/@me`, {
            headers: { Authorization: `Bot ${token}` }
        });
        const botData = await botRes.json();
        const applicationId = botData.id;
        if (!applicationId) throw new Error("Could not get bot application ID. Check your bot token.");

        if (guildId) {
            await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: commands });
            console.log(`[Slash Commands] Registered ${commands.length} guild commands for guild ${guildId}`);
        } else {
            await rest.put(Routes.applicationCommands(applicationId), { body: commands });
            console.log(`[Slash Commands] Registered ${commands.length} global commands`);
        }
        return { success: true, count: commands.length };
    } catch (e) {
        console.error("[Slash Commands] Registration failed:", e.message);
        return { success: false, error: e.message };
    }
}

// Start the Discord gateway bot for slash command interactions
let slashCommandBot = null;
let slashBotStarted = false;

async function startSlashCommandBot(token) {
    if (slashBotStarted && slashCommandBot?.isReady?.()) return;
    slashBotStarted = false;

    try {
        if (slashCommandBot) {
            try { slashCommandBot.destroy(); } catch(e) {}
        }

        slashCommandBot = new Client({
            intents: [GatewayIntentBits.Guilds]
        });

        slashCommandBot.once(Events.ClientReady, async (c) => {
            console.log(`[Slash Bot] Ready as ${c.user.tag}`);
            slashBotStarted = true;
        });

        slashCommandBot.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            const cmd = interaction.commandName.toLowerCase();
            const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();

            // Direct actions (Claim / Unclaim / SOS)
            if (cmd === 'claim') {
                const targetId = (interaction.options.getString('target') || '').trim().replace(/[^0-9]/g, "");
                if (!targetId) return interaction.reply({ content: "⚠️ Please provide a numeric Torn Player ID.", ephemeral: true });
                claims[targetId] = { playerName: interaction.user.username, time: Date.now() };
                const attackLink = `https://www.torn.com/loader.php?sid=attack&user2ID=${targetId}`;
                return interaction.reply({
                    embeds: [{
                        title: `🎯 Target Claimed: [${targetId}]`,
                        description: `**<@${interaction.user.id}>** has claimed **Target [${targetId}]**.\n\n[⚔️ Launch Attack](${attackLink}) • [👤 Profile](https://www.torn.com/profiles.php?XID=${targetId})`,
                        color: 0x2ed573
                    }]
                });
            }

            if (cmd === 'unclaim') {
                const targetId = (interaction.options.getString('target') || '').trim().replace(/[^0-9]/g, "");
                if (!targetId) return interaction.reply({ content: "⚠️ Please provide a numeric Torn Player ID.", ephemeral: true });
                delete claims[targetId];
                return interaction.reply({
                    embeds: [{
                        title: `🔓 Claim Released: [${targetId}]`,
                        description: `Target **[${targetId}]** is now unclaimed and available for anyone.`,
                        color: 0x8b949e
                    }]
                });
            }

            if (cmd === 'sos') {
                const targetId = (interaction.options.getString('target') || '').trim().replace(/[^0-9]/g, "");
                const note = interaction.options.getString('note') || 'Backup needed immediately!';
                if (!targetId) return interaction.reply({ content: "⚠️ Please provide a numeric Torn Player ID.", ephemeral: true });
                backups[targetId] = { playerName: interaction.user.username, time: Date.now() };
                const attackLink = `https://www.torn.com/loader.php?sid=attack&user2ID=${targetId}`;
                return interaction.reply({
                    content: `🚨 **EMERGENCY BACKUP REQUESTED!**`,
                    embeds: [{
                        title: `🚨 SOS BACKUP: Target [${targetId}]`,
                        description: `**Requested by**: <@${interaction.user.id}>\n**Note**: ${note}\n\n[⚔️ CLICK HERE TO ATTACK](${attackLink}) • [👤 View Profile](https://www.torn.com/profiles.php?XID=${targetId})`,
                        color: 0xff4757
                    }]
                });
            }

            // Defer reply for commands that make API calls
            try { await interaction.deferReply(); } catch (e) { return; }

            let embed = null;

            try {
                if (cmd === 'war' || cmd === 'warboard') {
                    embed = await buildWarStatusEmbed(apiKey);
                } else if (cmd === 'targets' || cmd === 'snipers') {
                    embed = await buildTargetsEmbed(apiKey);
                } else if (cmd === 'spy') {
                    const target = interaction.options.getString('target');
                    embed = await buildSpyEmbed(target, apiKey);
                } else if (cmd === 'chain') {
                    embed = await buildChainStatusEmbed(apiKey);
                } else if (cmd === 'chainwatch') {
                    embed = await buildChainWatchEmbed(apiKey);
                } else if (cmd === 'profile') {
                    const player = interaction.options.getString('player');
                    embed = await buildProfileEmbed(player, apiKey);
                } else if (cmd === 'hosp' || cmd === 'hospital') {
                    embed = await buildHospitalEmbed(apiKey);
                } else if (cmd === 'online' || cmd === 'roster') {
                    embed = await buildOnlineRosterEmbed(apiKey);
                } else if (cmd === 'oc') {
                    embed = await buildOCStatusEmbed(apiKey);
                } else if (cmd === 'myoc') {
                    const player = interaction.options.getString('player');
                    embed = await buildMyOCEmbed(player, apiKey, interaction.user.username);
                } else if (cmd === 'stocks') {
                    const country = interaction.options.getString('country');
                    embed = await buildStocksEmbed(country, apiKey);
                } else if (cmd === 'bazaar') {
                    const item = interaction.options.getString('item');
                    embed = await buildBazaarEmbed(item, apiKey);
                } else if (cmd === 'payout') {
                    const member = interaction.options.getString('member');
                    embed = await buildPayoutEmbed(member, apiKey);
                } else if (cmd === 'top' || cmd === 'mvp') {
                    embed = await buildTopHittersEmbed(apiKey);
                } else if (cmd === 'stats' || cmd === 'enemystats' || cmd === 'ourstats') {
                    const factionChoice = interaction.options.getString('faction') || (cmd === 'ourstats' ? 'friendly' : 'enemy');
                    embed = await buildFactionStatsRosterEmbed(factionChoice, apiKey);
                } else {
                    // Travel lookup fallback (e.g. /travel, /south-africa, /mexico, /sa, /uk, etc.)
                    let country = slashNameToCountry(cmd);
                    if (!country && cmd === 'travel') {
                        const countryOpt = interaction.options.getString('country');
                        if (countryOpt) country = slashNameToCountry(countryOpt) || countryOpt;
                    }
                    if (country) {
                        embed = await buildCountryStatusEmbed(country, apiKey);
                    }
                }

                if (!embed) {
                    return await interaction.editReply({ content: "⚠️ Command not recognized." });
                }

                const safeEmbed = sanitizeEmbed(embed);
                await interaction.editReply({ embeds: [safeEmbed] });
            } catch (e) {
                try {
                    if (embed) {
                        const fallbackText = formatEmbedAsMarkdown(embed);
                        const safeText = fallbackText.length > 1950 ? (fallbackText.slice(0, 1940) + "\n*...[truncated]*") : fallbackText;
                        await interaction.editReply({ content: safeText });
                    } else {
                        const errText = `⚠️ Error executing command: ${e.message}`.slice(0, 1950);
                        await interaction.editReply({ content: errText });
                    }
                } catch(err2) {
                    console.error("[Slash Bot] Failed to reply:", err2.message);
                }
            }
        });

        slashCommandBot.on('error', (e) => {
            console.error("[Slash Bot] Client error:", e.message);
            slashBotStarted = false;
        });

        await slashCommandBot.login(token);
    } catch (e) {
        console.error("[Slash Bot] Failed to start:", e.message);
        slashBotStarted = false;
    }
}

// Auto-start slash bot if we have a token
setTimeout(() => {
    if (discordConfig.globalBotToken && discordConfig.globalBotToken.trim().length > 20) {
        startSlashCommandBot(discordConfig.globalBotToken.trim()).catch(() => {});
    }
}, 5000);


// API endpoint: register slash commands
app.post('/api/discord/register-slash-commands', async (req, res) => {
    try {
        const token = req.body.token || discordConfig.globalBotToken;
        const guildId = req.body.guildId || null;
        if (!token) return res.status(400).json({ error: "Missing bot token" });
        const result = await registerSlashCommands(token.trim(), guildId);
        if (result.success) {
            // Also (re)start the slash command bot
            startSlashCommandBot(token.trim()).catch(() => {});
        }
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API endpoint: live country travel lookup (used by web UI too)
app.get('/api/discord/travel-lookup/:country', async (req, res) => {
    try {
        const country = TORN_COUNTRIES.find(c =>
            c.toLowerCase() === decodeURIComponent(req.params.country).toLowerCase()
        );
        if (!country) return res.status(404).json({ error: "Unknown country" });
        const apiKey = getNextApiKey() || discordConfig.apiKey;
        const embed = await buildCountryStatusEmbed(country, apiKey);
        res.json({ success: true, country, embed });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function getDiscordClient(token) {
    if (!token || typeof token !== 'string' || token.trim().startsWith('http')) return null;
    const cleanToken = token.trim();
    if (activeDiscordBots[cleanToken] && activeDiscordBots[cleanToken].isReady && activeDiscordBots[cleanToken].isReady()) {
        return activeDiscordBots[cleanToken];
    }
    if (botLoginPromises[cleanToken]) return botLoginPromises[cleanToken];
    
    botLoginPromises[cleanToken] = (async () => {
        try {
            const client = new Client({ intents: [GatewayIntentBits.Guilds] });
            activeDiscordBots[cleanToken] = client; 
            await client.login(cleanToken);
            console.log(`[Discord Bot] Logged in successfully for token ending in ...${cleanToken.slice(-4)}`);
            return client;
        } catch (e) {
            console.error(`[Discord Bot] Failed to login:`, e.message);
            delete activeDiscordBots[cleanToken];
            return null;
        } finally {
            delete botLoginPromises[cleanToken];
        }
    })();

    return botLoginPromises[cleanToken];
}





// ---------------------------------------------

// ==========================================
// FRONTIER PIPELINE (UNIFIED POLLING LOOP)
// ==========================================
const pipelineFile = path.join(__dirname, 'data', 'pipeline.json');
let pipeline = { watermark: 0, searchHigh: 0, searchLow: 1, searchPhase: 'doubling', candidates: {}, prospects: [] };

try {
    if (fs.existsSync(pipelineFile)) {
        pipeline = Object.assign(pipeline, JSON.parse(fs.readFileSync(pipelineFile, 'utf8')));
    }
} catch (e) { console.error("Error loading pipeline:", e); }

function savePipeline() {
    try {
        fs.writeFileSync(pipelineFile, JSON.stringify(pipeline, null, 2));
    } catch (e) { console.error("Error saving pipeline:", e); }
}

let isPipelineRunning = false;
let pipelineInterval = null;

app.get('/api/turbo/status', (req, res) => {
    res.json({ 
        active: !!global.isTurboMining, 
        stats: global.turboStats || {found: 0, checked: 0}, 
        logs: global.scannerCallLog || [] 
    });
});

// Overwrite the scan-recruits route to read from pipeline prospects
app.post('/api/scan-recruits', async (req, res) => {
    const { minLevel, maxLevel, donatorFilter, maxPlaytime, maxAge, weightLevel, weightPlaytime, minAwards, maxLastActionHours } = req.body;
    let results = pipeline.prospects.filter(p => p.active_polling !== false);
    
    // Apply filters
    results = results.filter(profile => {
        if (minLevel && profile.level < parseInt(minLevel)) return false;
        if (maxLevel && profile.level > parseInt(maxLevel)) return false;
        
        const donator = profile.donator;
        if (donatorFilter === "donator" && !donator) return false;
        if (donatorFilter === "nondonator" && donator) return false;
        
        if (maxPlaytime && profile.playtime > parseFloat(maxPlaytime)) return false;
        if (maxAge && profile.age > parseFloat(maxAge)) return false;
        if (minAwards && profile.awards < parseInt(minAwards)) return false;
        
        if (maxLastActionHours && profile.last_action_timestamp) {
            const hoursInactive = (Date.now() / 1000 - profile.last_action_timestamp) / 3600;
            if (hoursInactive > parseFloat(maxLastActionHours)) return false;
        }
        return true;
    });
    
    // Scoring
    const focusMultiplier = parseFloat(weightLevel) || 1.0;
    results = results.map(r => {
        if (!r.estStats) r.estStats = "Not yet available";
        r.xanPerDay = (r.xanax / (r.age || 1)).toFixed(2);
        
        let score = 0;
        let breakdown = [];
        const levelPerAge = r.level / (r.age || 1);
        
        let lvlAgePts = Math.floor((levelPerAge * 100) * (focusMultiplier > 1 ? 1.5 : (focusMultiplier < 1 ? 0.5 : 1)));
        score += lvlAgePts;
        breakdown.push(`Lvl/Age: +${lvlAgePts}`);
        
        let xanPts = Math.floor((r.xanPerDay * 15) * (focusMultiplier < 1 ? 1.5 : (focusMultiplier > 1 ? 0.5 : 1)));
        if (xanPts > 0) { score += xanPts; breakdown.push(`Xanax: +${xanPts}`); }
        
        if (r.last_action_timestamp) {
            const hoursInactive = (Date.now() / 1000 - r.last_action_timestamp) / 3600;
            if (hoursInactive < 24) { score += 30; breakdown.push(`Active <24h: +30`); }
            else if (hoursInactive < 72) { score += 10; breakdown.push(`Active <72h: +10`); }
        }
        if (r.awards) {
            if (r.awards > 50) { score += 20; breakdown.push(`Awards >50: +20`); }
            else if (r.awards > 20) { score += 10; breakdown.push(`Awards >20: +10`); }
        }
        if (r.donator) { score += 15; breakdown.push(`Donator: +15`); }
        
        if (r.velocity) {
            let velPts = Math.floor(r.velocity * 50);
            score += velPts; 
            breakdown.push(`Velocity (${r.velocity.toFixed(2)}): +${velPts}`);
        }
        
        if (r.level < 15 && r.age > 14 && levelPerAge < 0.2) { score -= 40; breakdown.push(`Low Lvl/Old Penalty: -40`); }
        else if (r.level < 15 && r.age < 7 && levelPerAge > 1.5) { score += 30; breakdown.push(`Young Talent Bonus: +30`); }
        
        r.recruitScore = Math.max(0, score);
        r.score_breakdown = breakdown.join(' | ');
        
        if (r.recruitScore >= 120) r.scoutGrade = 'S';
        else if (r.recruitScore >= 80) r.scoutGrade = 'A';
        else if (r.recruitScore >= 50) r.scoutGrade = 'B';
        else if (r.recruitScore >= 25) r.scoutGrade = 'C';
        else r.scoutGrade = 'D';
        
        return r;
    });
    
    results.sort((a, b) => b.recruitScore - a.recruitScore);

    res.json({ success: true, recruits: results.slice(0, 500) });
});


// Start Server and Pipeline

// ==========================================
// HEADHUNTER PROTOCOL (MANUAL LIVE SCANNER)
// ==========================================
app.post('/api/turbo/start', (req, res) => {
    if (isPipelineRunning) {
        // Just return success, but log it. We don't want to stop the autonomous pipeline.
        // Actually, we can run a parallel turbo interval that scans completely random IDs heavily.
        if (global.isTurboMining) return res.json({ success: true, msg: "Already running" });
        
        global.turboMinLevel = parseInt(req.body.minLevel) || 1;
        global.turboMaxLevel = parseInt(req.body.maxLevel) || 100;
        global.turboMaxAge = parseInt(req.body.maxAge) || 500;
        global.isTurboMining = true;
        global.turboStats = { found: 0, checked: 0 };
        global.scannerCallLog = [];

        // Uses same API limit logic but explicitly checks random IDs across the DB
        global.turboInterval = setInterval(async () => {
            let watchKey = getNextApiKey();
            if (!watchKey) return;

            let id = Math.floor(Math.random() * (5000000 - 1500000 + 1) + 1500000);
            global.turboStats.checked++;

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);
                const userRes = await fetch(`https://api.torn.com/user/${id}?selections=profile,personalstats&key=${watchKey}`, { signal: controller.signal });
                clearTimeout(timeoutId);
                const userData = await userRes.json();
                
                if (userData && !userData.error) {
                    const profile = userData.profile || userData;
                    const personalstats = userData.personalstats || {};
                    
                    global.scannerCallLog.unshift(`[${new Date().toLocaleTimeString()}] Checked [${id}] ${profile.name || 'Unknown'}`);
                    if (global.scannerCallLog.length > 30) global.scannerCallLog.pop();

                    let isValid = true;
                    if (profile.status && (profile.status.state === "Federal" || profile.status.state === "Fallen")) isValid = false;
                    if (profile.faction && profile.faction.faction_id !== 0) isValid = false;
                    
                    if (isValid) {
                        const level = profile.level || 1;
                        if (level < global.turboMinLevel || level > global.turboMaxLevel) isValid = false;
                    }
                    
                    if (isValid) {
                        const level = profile.level || 1;
                        const playtimeSec = personalstats.useractivity || 0;
                        const playtimeDays = parseFloat((playtimeSec / 86400).toFixed(1));
                        
                        if ((profile.age || 1) > global.turboMaxAge) isValid = false;
                        
                        if (isValid) {
                            const _age = profile.age || 1;
                            const _playtimeDays2 = playtimeDays;
                            const _xanax = personalstats.xantaken || 0;
                            const _refills = personalstats.refills || 0;
                            const _se = personalstats.statenhancersused || 0;
                            const r = {
                                id, name: profile.name, level,
                                age: _age, playtime: _playtimeDays2,
                                xanax: _xanax, refills: _refills,
                                se: _se, estStats: "Not yet available",
                                donator: profile.donator === 1 || profile.donator === true,
                                awards: profile.awards || 0,
                                last_action_timestamp: (profile.last_action && profile.last_action.timestamp) ? profile.last_action.timestamp : 0,
                                status: profile.status ? `${profile.status.state} (${profile.status.description || ''})` : "Offline",
                                faction: "Factionless", last_checked: Date.now()/1000, active_polling: true,
                                velocity: parseFloat((level / _age).toFixed(4)),
                                xanPerDay: parseFloat((_xanax / _age).toFixed(3)),
                                refillsPerDay: parseFloat((_refills / _age).toFixed(3)),
                                sePerDay: parseFloat((_se / _age).toFixed(3))
                            };
                        pipeline.prospects.push(r);
                        savePipeline();
                        global.turboStats.found++;
                    }
                }
                }
            } catch(e) {}
        }, 650);
        return res.json({ success: true });
    }
});
app.post('/api/turbo/stop', (req, res) => {
    global.isTurboMining = false;
    if (global.turboInterval) clearInterval(global.turboInterval);
    if (global.turboTimeout) clearTimeout(global.turboTimeout);
    res.json({ success: true, msg: "Turbo stopped" });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
    // startFrontierPipeline(); // PAUSED: Conserve Torn API budget
    startKeepAlive();
    
    // Boot up the integrated recruitment platform (UI and APIs available, background scanning workers paused)
    const { initRecruitPlatform } = require('./recruit/index');
    initRecruitPlatform(app, server).catch(e => console.error("[Recruit Init Error]", e));
});

// ── Keep-Alive Self-Ping (Ensures 24/7 scanning on Render even when computer is turned off) ──
function startKeepAlive() {
    const appUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
    if (appUrl) {
        console.log(`[KeepAlive] 24/7 Self-Ping active for ${appUrl} (pings every 10 min)`);
        setInterval(async () => {
            try {
                const res = await fetch(`${appUrl}/recruit-api/admin/health`, { signal: AbortSignal.timeout(10_000) });
                if (res.ok) console.log('[KeepAlive] Heartbeat ping OK — Render kept awake');
            } catch(e) {
                console.warn('[KeepAlive] Ping:', e.message);
            }
        }, 10 * 60_000);
    }
}

async function startFrontierPipeline() {
    if (isPipelineRunning) return;
    isPipelineRunning = true;
    
    console.log("Starting Unified Frontier Pipeline (650ms tick)...");
    
    // Safety fallback: if pipeline gets stuck in galloping, force a restart from 1
    if (!pipeline.watermark && !pipeline.searchPhase) {
        pipeline.searchPhase = 'doubling';
        pipeline.searchLow = 1;
        pipeline.searchHigh = 0;
    }

    pipelineInterval = setInterval(async () => {
        let watchKey = getNextApiKey();
        if (!watchKey) return;
        
        const now = Date.now() / 1000;
        
        // 1. WATERMARK DISCOVERY (Galloping Search)
        if (!pipeline.watermark) {
            let testId = pipeline.searchPhase === 'doubling' ? (pipeline.searchLow === 1 ? 1 : pipeline.searchLow * 2) : 
                         Math.floor((pipeline.searchLow + pipeline.searchHigh) / 2);
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);
                const userRes = await fetch(`https://api.torn.com/user/${testId}?selections=profile&key=${watchKey}`, { signal: controller.signal });
                clearTimeout(timeoutId);
                const userData = await userRes.json();
                
                if (userData.error && userData.error.code === 6) { // Incorrect ID (Doesn't exist yet)
                    if (pipeline.searchPhase === 'doubling') {
                        pipeline.searchHigh = testId;
                        pipeline.searchPhase = 'binary';
                    } else {
                        pipeline.searchHigh = testId - 1; // Narrow down
                    }
                } else if (!userData.error) { // Exists
                    if (pipeline.searchPhase === 'doubling') {
                        pipeline.searchLow = testId;
                    } else {
                        pipeline.searchLow = testId + 1; // Narrow up
                    }
                }
                
                if (pipeline.searchPhase === 'binary' && pipeline.searchLow > pipeline.searchHigh) {
                    // Found the exact edge!
                    pipeline.watermark = Math.max(1, pipeline.searchHigh - 200); // Start 200 IDs back for safety
                    console.log(`[Frontier] Edge discovered! Starting watermark at ${pipeline.watermark}`);
                }
                savePipeline();
            } catch(e) { }
            return; // Skip rest of pipeline until watermark is found
        }
        
        // 2. TICK ROUTER
        const tickRand = Math.random();
        
        // Prospect Re-check (50%)
        if (tickRand < 0.50 && pipeline.prospects.length > 0) {
            // Find oldest checked active prospect
            const activeProspects = pipeline.prospects.filter(p => p.active_polling !== false);
            if (activeProspects.length > 0) {
                const target = activeProspects.sort((a,b) => (a.last_checked || 0) - (b.last_checked || 0))[0];
                if ((now - (target.last_checked || 0)) > 3600) { // Only check if older than 1 hour
                    await fetchAndProcess(target.id, watchKey, 'prospect');
                    return;
                }
            }
        }
        
        // Candidate Re-check (25%)
        const candidateKeys = Object.keys(pipeline.candidates);
        if (tickRand < 0.75 && candidateKeys.length > 0) {
            // Find a candidate older than 24 hours
            const targetId = candidateKeys.find(id => (now - pipeline.candidates[id].initTimestamp) > 86400);
            if (targetId) {
                await fetchAndProcess(targetId, watchKey, 'candidate');
                return;
            }
        }
        
        // Frontier Discovery (25% or fallback)
        await fetchAndProcess(pipeline.watermark + 1, watchKey, 'frontier');
        
    }, 650); // Exactly ~92 requests per minute
}

async function fetchAndProcess(id, watchKey, mode) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const userRes = await fetch(`https://api.torn.com/user/${id}?selections=profile,personalstats&key=${watchKey}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        const userData = await userRes.json();
        const now = Date.now() / 1000;
        
        if (userData.error) {
            if (userData.error.code === 6 && mode === 'frontier') {
                // We reached the absolute edge. Do not increment watermark.
                return;
            }
            if (mode === 'prospect') {
                const p = pipeline.prospects.find(x => x.id == id);
                if (p) { p.last_checked = now; savePipeline(); }
            }
            return;
        }

        const profile = userData.profile || userData;
        const stats = userData.personalstats || {};
        
        const isFederal = profile.status && (profile.status.state === "Federal" || profile.status.state === "Fallen");
        const hasFaction = profile.faction && profile.faction.faction_id !== 0;
        const daysInactive = profile.last_action && profile.last_action.timestamp ? (now - profile.last_action.timestamp) / 86400 : 0;
        
        if (mode === 'frontier') {
            pipeline.watermark = Math.max(pipeline.watermark, parseInt(id));
            if (!isFederal && !hasFaction) {
                pipeline.candidates[id] = {
                    initLevel: profile.level || 1,
                    initXanax: stats.xantaken || 0,
                    initAwards: profile.awards || 0,
                    initTimestamp: now,
                    lastAction: profile.last_action ? profile.last_action.timestamp : 0
                };
            }
            savePipeline();
        } 
        else if (mode === 'candidate') {
            const c = pipeline.candidates[id];
            const newLastAction = profile.last_action ? profile.last_action.timestamp : 0;
            
            // Check for real movement
            const isFederalOrFaction = isFederal || hasFaction;
            const isInactive = daysInactive > 3;
            // Strict evaluation: only promote if they have definitively proven activity
            const levelGained = profile.level > c.initLevel;
            const xanaxGained = (stats.xantaken || 0) > (c.initXanax || 0);
            const actionChanged = newLastAction !== (c.lastAction || 0);
            const hasMoved = levelGained || xanaxGained || actionChanged;

            if (isFederalOrFaction || isInactive || !hasMoved) {
                // No change, joined faction, or inactive -> Drop candidate
                delete pipeline.candidates[id];
            } else {
                // Movement detected! Promote to prospect
                const playtimeDays = parseFloat(((stats.useractivity || 0) / 86400).toFixed(1));
                const p = {
                    id: parseInt(id), name: profile.name, level: profile.level || 1, age: profile.age || 1,
                    playtime: playtimeDays, xanax: stats.xantaken || 0, refills: stats.refills || 0, 
                    se: stats.statenhancersused || 0, estStats: "Not yet available", donator: profile.donator === 1 || profile.donator === true,
                    awards: profile.awards || 0, last_action_timestamp: newLastAction,
                    status: profile.status ? `${profile.status.state} (${profile.status.description || ''})` : "Offline",
                    faction: "Factionless",
                    last_checked: now,
                    active_polling: true,
                    velocity: (profile.level - c.initLevel) / ((now - c.initTimestamp) / 86400) // Levels per day during candidate phase
                };
                pipeline.prospects.push(p);
                delete pipeline.candidates[id];
            }
            savePipeline();
        }
        else if (mode === 'prospect') {
            const pIdx = pipeline.prospects.findIndex(x => x.id == id);
            if (pIdx === -1) return;
            const p = pipeline.prospects[pIdx];
            
            if (isFederal || hasFaction || daysInactive > 7) {
                pipeline.prospects.splice(pIdx, 1); // Permanently remove from saved database
            } else {
                // Update stats and calculate new velocity based on changes since last check
                const daysSinceCheck = (now - p.last_checked) / 86400;
                if (daysSinceCheck > 0 && profile.level > p.level) {
                    p.velocity = (profile.level - p.level) / daysSinceCheck;
                } else if (daysSinceCheck > 1) {
                    // Decay velocity if no levels gained over a full day
                    p.velocity = (p.velocity || 0) * 0.5;
                }
                
                p.level = profile.level || p.level;
                p.age = profile.age || p.age;
                p.playtime = parseFloat(((stats.useractivity || 0) / 86400).toFixed(1));
                p.xanax = stats.xantaken || p.xanax;
                p.awards = profile.awards || p.awards;
                p.last_action_timestamp = profile.last_action ? profile.last_action.timestamp : p.last_action_timestamp;
                p.status = profile.status ? `${profile.status.state} (${profile.status.description || ''})` : "Offline";
            }
            p.last_checked = now;
            savePipeline();
        }
    } catch(e) { }
}
