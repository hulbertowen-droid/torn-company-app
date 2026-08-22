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

let persistentDefends = {};
let liveAttacks = {};
let activeWarId = null;
let hasBackfilledWar = false;
let processedAttackIds = new Set();
let friendlyHitTracker = {};
let travelAlerts = {};
let currentEnemyFacId = null;
let globalTornCache = {};
let enemyMembersCache = {};
let lastEnemyScrape = 0;

const BONUS_THRESHOLDS = new Set([10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]);


let dynamicFactionId = null; 
let lastEventTimestamp = Math.floor(Date.now() / 1000);

let lastChainTimeoutAlertState = false;
let backgroundEnemyTrackingState = {};

let discordConfig = { 
    globalChannelId: "", 
    globalBotToken: "",
    personalDiscordId: "",
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
            let errMsg = data.message || `Discord API error (${res.status})`;
            if (data.code === 50001) errMsg = "Missing Access — make sure your bot is invited to the server and has 'Send Messages' permission in that channel.";
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
        if (data.current && data.current.latest_arrival_time) { flightCache[targetId] = { landingTime: data.current.latest_arrival_time, time: Date.now() }; } 
        else { flightCache[targetId] = { landingTime: null, time: Date.now() }; }
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

async function backfillWarDefends(watchKey, watchFactionId, warStart) {
    let toTimestamp = Math.floor(Date.now() / 1000);
    let keepScraping = true;
    let pageCount = 0;
    
    while (keepScraping && pageCount < 50) { 
        try {
            const res = await fetch(`https://api.torn.com/faction/${watchFactionId}?selections=attacks&to=${toTimestamp}&key=${watchKey}`);
            const data = await res.json();
            if (data.error || !data.attacks) break;
            
            let attacks = Object.values(data.attacks);
            if (attacks.length === 0) break;
            
            let oldestTimeInBatch = toTimestamp;
            let foundOldAttack = false;

            for (let atk of attacks) {
                if (atk.timestamp_ended < oldestTimeInBatch) {
                    oldestTimeInBatch = atk.timestamp_ended;
                }
                
                if (atk.timestamp_ended < warStart) { 
                    keepScraping = false; 
                    foundOldAttack = true;
                    continue; 
                }
                
                if (!processedAttackIds.has(atk.code)) {
                    processedAttackIds.add(atk.code);
                    let isWin = ["Hospitalized", "Mugged", "Arrested", "Looted", "Assist", "Attacked", "Special"].includes(atk.result);
                    if (isWin && atk.defender_faction && atk.defender_faction.toString() === watchFactionId.toString()) {
                        let uId = atk.defender_id.toString();
                        let attFacId = atk.attacker_faction ? atk.attacker_faction.toString() : "0";
                        if (!persistentDefends[uId]) persistentDefends[uId] = {};
                        persistentDefends[uId][attFacId] = (persistentDefends[uId][attFacId] || 0) + 1;
                    }
                    if (isWin && atk.attacker_faction && atk.attacker_faction.toString() === watchFactionId.toString()) {
                        let uId = atk.attacker_id.toString();
                        let defFacId = atk.defender_faction ? atk.defender_faction.toString() : "0";
                        if (!liveAttacks[uId]) liveAttacks[uId] = {};
                        liveAttacks[uId][defFacId] = (liveAttacks[uId][defFacId] || 0) + 1;
                    }
                }
            }
            
            if (!foundOldAttack) {
                 toTimestamp = oldestTimeInBatch - 1;
                 pageCount++;
                 await new Promise(r => setTimeout(r, 500)); 
            }
            
        } catch (e) { break; }
    }
    hasBackfilledWar = true;
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
        const liveRes = await fetch(`https://api.torn.com/faction/${watchFactionId}?selections=attacks,basic,rankedwars&key=${watchKey}`);
        const liveData = await liveRes.json();
        
        if (liveData.rankedwars) {
            let ongoingWar = Object.values(liveData.rankedwars).find(w => w.war && w.war.winner === 0);
            if (ongoingWar) {
                if (activeWarId !== ongoingWar.war.start) {
                    activeWarId = ongoingWar.war.start;
                    persistentDefends = {}; liveAttacks = {}; hasBackfilledWar = false; processedAttackIds.clear();
                    friendlyHitTracker = {}; travelAlerts = {}; currentEnemyFacId = null; enemyMembersCache = {};
                    backfillWarDefends(watchKey, watchFactionId, activeWarId);
                }
            } else { activeWarId = null; hasBackfilledWar = false; }
        }

        if (liveData.attacks && activeWarId) {
            let attacksToProcess = Object.entries(liveData.attacks);
            attacksToProcess.sort((a, b) => a[1].timestamp_ended - b[1].timestamp_ended);

            for (let [atkId, atk] of attacksToProcess) {
                if (atk.timestamp_ended < activeWarId) continue; 
                if (processedAttackIds.has(atk.code)) continue;
                processedAttackIds.add(atk.code);
                
                let isWin = ["Hospitalized", "Mugged", "Arrested", "Looted", "Assist", "Attacked", "Special"].includes(atk.result);
                if (isWin && atk.defender_faction && atk.defender_faction.toString() === watchFactionId.toString()) {
                    let uId = atk.defender_id.toString();
                    let attFacId = atk.attacker_faction ? atk.attacker_faction.toString() : "0";
                    let attackerId = atk.attacker_id.toString();

                    if (!persistentDefends[uId]) persistentDefends[uId] = {};
                    persistentDefends[uId][attFacId] = (persistentDefends[uId][attFacId] || 0) + 1;
                    
                    let isRecent = atk.timestamp_ended > (Math.floor(Date.now() / 1000) - 180);
                    let friendlyMem = liveData.members ? liveData.members[uId] : null;
                    if (friendlyMem && friendlyMem.status.state !== "Traveling") {
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
                            let pingStr = (dId && /^\d{17,20}$/.test(dId)) ? `<@${dId}>` : (discordConfig.personalDiscordId ? `<@${discordConfig.personalDiscordId}>` : "");
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
                    let uId = atk.attacker_id.toString();
                    let defFacId = atk.defender_faction ? atk.defender_faction.toString() : "0";
                    if (!liveAttacks[uId]) liveAttacks[uId] = {};
                    liveAttacks[uId][defFacId] = (liveAttacks[uId][defFacId] || 0) + 1;

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
        if (activeWarId && liveData.rankedwars) {
            let ongoingWar = Object.values(liveData.rankedwars).find(w => w.war && w.war.start === activeWarId);
            if (ongoingWar && ongoingWar.factions) {
                let facIds = Object.keys(ongoingWar.factions);
                currentEnemyFacId = facIds.find(id => id !== watchFactionId.toString());
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
                        let pingStr = (dId && /^\d{17,20}$/.test(dId)) ? `<@${dId}>` : (discordConfig.personalDiscordId ? `<@${discordConfig.personalDiscordId}>` : "");
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
                        if (oldRecord.online !== "Online" && newRecord.online === "Online" && discordConfig.targetOnline === true) {
                            if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { title: "🟢 Target Online", description: `**${m.name}** [${id}] just established a connection and is Online!`, color: 3069299, links: [{ label: "⚔️ ATTACK", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }] });
                        }
                        
                        if (oldRecord.state === "Hospital" && newRecord.state === "Okay") {
                            let now = Math.floor(Date.now() / 1000);
                            let leftEarly = oldRecord.until && (oldRecord.until > now + 60);

                            if (leftEarly && newRecord.online === "Online" && discordConfig.medOutSniper !== false) {
                                let rawEst = (spyDatabase[id] && spyDatabase[id].total) ? spyDatabase[id].total : (statsCache[id]?.stats || manualStats[id]?.stats || 0);
                                let enemyEst = (typeof rawEst === 'number' && !isNaN(rawEst) && rawEst > 0) ? rawEst : 0;
                                let bestMatchName = "Anyone available";
                                let bestMatchId = null;
                                
                                if (facData.members) {
                                    let friendliesAvailable = Object.entries(facData.members).filter(([fid, fm]) => fid !== id && (fm.last_action?.status === "Online" || fm.last_action?.status === "Idle"));
                                    if (friendliesAvailable.length > 0) {
                                        if (enemyEst > 0) {
                                            let bestDiff = Infinity;
                                            for(let [fid, fm] of friendliesAvailable) {
                                                let rawF = (spyDatabase[fid] && spyDatabase[fid].total) ? spyDatabase[fid].total : (statsCache[fid]?.stats || manualStats[fid]?.stats || 0);
                                                let fEst = (typeof rawF === 'number' && !isNaN(rawF) && rawF > 0) ? rawF : 0;
                                                if (fEst >= enemyEst * 0.7) {
                                                    let diff = Math.abs(fEst - enemyEst);
                                                    if (diff < bestDiff) { bestDiff = diff; bestMatchName = fm.name; bestMatchId = fid; }
                                                }
                                            }
                                        }
                                        if (!bestMatchId && friendliesAvailable.length > 0) {
                                            bestMatchName = friendliesAvailable[0][1].name;
                                            bestMatchId = friendliesAvailable[0][0];
                                        }
                                    }
                                }

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
                                if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { title: "🏥 Target Out of Hospital", description: `**${m.name}** [${id}] naturally finished their hospital time and is Okay!`, color: 16753922, links: [{ label: "⚔️ ATTACK", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }] });
                            } else if (discordConfig.targetLanded !== false && (oldRecord.state === "Traveling" || (oldRecord.description && oldRecord.description.includes("Traveling")))) {
                                if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { title: "✈️ Target Landed", description: `**${m.name}** [${id}] just landed in Torn!`, color: 5809919, links: [{ label: "⚔️ ATTACK", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }] });
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
        if (!data.error) {
            globalTornCache[cacheKey] = { timestamp: now, data };
        }
        return data;
    } catch (e) {
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

// FIXED: Scraped the old apiKeyPool reference out of here as well
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
    
    res.json({ success: true });
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
            cachedTornFetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`, `my_faction_${userKey}`, 2500),
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
                let baseAttacks = warMemberData ? (warMemberData.attacks || 0) : 0;
                let score = warMemberData ? (warMemberData.score || 0) : 0;
                
                let liveAtk = 0;
                if (enemyId && liveAttacks[id]?.[enemyId]) { liveAtk = liveAttacks[id][enemyId]; }
                let attacks = Math.max(baseAttacks, liveAtk);

                let defends = 0;
                if (enemyId && persistentDefends[id]?.[enemyId]) { defends = persistentDefends[id][enemyId]; }

                let timeline = activityCache[id]?.timeline || null; let timelineTime = activityCache[id]?.time || null;

                return { id, name: m.name, level: m.level || 0, position: m.position || '', daysInFaction: m.days_in_faction || 0, state: m.status?.state, until: finalUntil, statusDescription: m.status?.description || "", onlineStatus: m.last_action?.status || "Offline", lastActionRelative: m.last_action?.relative || "Unknown", lastActionTimestamp: m.last_action?.timestamp || 0, landingTime: finalLandingTime, needsFfScouterForFlights, claimedBy: isEnemy ? claims[id]?.playerName || null : null, needsBackup: isEnemy ? backups[id]?.playerName || null : null, estStats: est, intelScore: isEnemy ? computeWarIntel({ id, state: m.status?.state, until: finalUntil, onlineStatus: m.last_action?.status || "Offline", estStats: typeof est === 'number' ? est : null }, statsCache) : null, isManual: !!manualStats[id], attacks, score, defends, timeline };
            });
        };
        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true), detectedEnemyId: enemyId, premiumActive: isPremium });
    } catch (err) { res.status(403).json({ error: err.message }); }
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


// --- MULTI-TENANT DISCORD BOTS & USERS ---
const { Client, GatewayIntentBits } = require('discord.js');
let activeDiscordBots = {}; 
let botLoginPromises = {};

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

// Gateway login removed — all Discord sends go via direct REST API, not gateway.




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
    startFrontierPipeline();
    startKeepAlive();
    
    // Boot up the integrated recruitment platform
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
