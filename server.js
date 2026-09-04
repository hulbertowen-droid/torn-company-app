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
            if (saved.discordConfig) {
                discordConfig = { ...discordConfig, ...saved.discordConfig };
                delete discordConfig.apiKey;
                delete discordConfig.myName;
                global.isNotificationsKilled = !!discordConfig.notificationsKilled;

                // CRITICAL REPAIR: Ensure channel IDs never contain a bot token
                if (discordConfig.globalChannelId && (discordConfig.globalChannelId.includes('.') || /[a-zA-Z]/.test(discordConfig.globalChannelId))) {
                    if (!discordConfig.globalBotToken && discordConfig.globalChannelId.length > 30) {
                        discordConfig.globalBotToken = discordConfig.globalChannelId.trim();
                    }
                    discordConfig.globalChannelId = "";
                }
                if (discordConfig.bankingChannelId && (discordConfig.bankingChannelId.includes('.') || /[a-zA-Z]/.test(discordConfig.bankingChannelId))) {
                    discordConfig.bankingChannelId = "";
                }
            }
            if (saved.companyConfig) companyConfig = { ...companyConfig, ...saved.companyConfig };
            if (saved.ocConfig) ocConfig = { ...ocConfig, ...saved.ocConfig };
            if (saved.marketConfig) marketConfig = { ...marketConfig, ...saved.marketConfig };
            if (saved.spyDatabase) spyDatabase = { ...spyDatabase, ...saved.spyDatabase };
            if (saved.userTracking) userTracking = { ...userTracking, ...saved.userTracking };
            if (saved.apiPoolConfig) apiPoolConfig = { ...apiPoolConfig, ...saved.apiPoolConfig };
            if (saved.inactivityAlerts) {
                inactivityAlertsMemory = {
                    alerts: { ...(inactivityAlertsMemory?.alerts || {}), ...(saved.inactivityAlerts.alerts || {}) },
                    initialized: saved.inactivityAlerts.initialized !== false
                };
                console.log(`[Mongo] Restored ${Object.keys(inactivityAlertsMemory.alerts).length} inactivity alerts from MongoDB Atlas.`);
            }
            if (saved.warFlightArchive) {
                warFlightArchive = { ...(warFlightArchive || {}), ...(saved.warFlightArchive || {}) };
                console.log(`[Mongo] Restored ${Object.keys(warFlightArchive).length} flight archive records from MongoDB Atlas.`);
            }
            if (saved.warAuditArchive) {
                warAuditArchive = { ...(warAuditArchive || {}), ...(saved.warAuditArchive || {}) };
                console.log(`[Mongo] Restored ${Object.keys(warAuditArchive).length} war audit archives from MongoDB Atlas.`);
            }
            if (saved.bankRequests) {
                bankRequests = { ...(bankRequests || {}), ...(saved.bankRequests || {}) };
                const ids = Object.keys(bankRequests).map(k => parseInt(k, 10)).filter(n => !isNaN(n));
                if (ids.length > 0) bankRequestCounter = Math.max(bankRequestCounter, ...ids);
                console.log(`[Mongo] Restored ${Object.keys(bankRequests).length} bank requests from MongoDB Atlas.`);
                checkExpiredBankRequests();
            }
            if (saved.lastWarboardPayload && (!lastGoodWarboardPayload || !lastGoodWarboardPayload.friendly || lastGoodWarboardPayload.friendly.length === 0)) {
                lastGoodWarboardPayload = saved.lastWarboardPayload;
                console.log(`[Mongo] Restored lastGoodWarboardPayload (${lastGoodWarboardPayload.friendly?.length || 0} members) from MongoDB Atlas.`);
            }
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
    maxAge: '1h',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
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

const factionWarState = {};

function getFactionWarState(facId) {
    const sId = String(facId || '52355');
    if (!factionWarState[sId]) {
        factionWarState[sId] = {
            activeWarId: null,
            activeWarEnd: 0,
            hasBackfilledWar: false,
            isBackfillingWar: false,
            processedAttackIds: new Set(),
            liveWarHits: {},
            liveOutsideHits: {},
            liveAssists: {},
            liveWarDefendsWon: {},
            liveOutsideDefendsWon: {},
            liveWarHitsTaken: {},
            liveOutsideHitsTaken: {},
            syncStatus: { isSyncing: false, percent: 100, totalHitsLoaded: 0, page: 0, message: "Ready" },
            claims: {},
            backups: {},
            manualStats: {}
        };
    }
    return factionWarState[sId];
}

function getActiveRankedWar(data) {
    if (!data || !data.rankedwars) return null;
    for (let warId in data.rankedwars) {
        let w = data.rankedwars[warId];
        if (w && w.war && (w.war.winner === 0 || !w.war.winner) && (!w.war.end || w.war.end === 0)) {
            return w;
        }
    }
    return null;
}

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
let lastGoodWarboardByFaction = {};
const WARBOARD_BACKUP_FILE = path.join(__dirname, 'data', 'last_warboard.json');
try {
    if (fs.existsSync(WARBOARD_BACKUP_FILE)) {
        lastGoodWarboardPayload = JSON.parse(fs.readFileSync(WARBOARD_BACKUP_FILE, 'utf8'));
        if (lastGoodWarboardPayload?.warInfo?.myFaction?.id) {
            lastGoodWarboardByFaction[lastGoodWarboardPayload.warInfo.myFaction.id.toString()] = lastGoodWarboardPayload;
        }
        lastGoodWarboardByFaction["52355"] = lastGoodWarboardPayload;
        console.log('[Warboard] Loaded persistent warboard cache from disk');
    }
} catch(e) {}
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
    bankingChannelId: "",
    bankerRoleId: "",
    targetOnline: false, 
    targetLanded: true, 
    targetOutHosp: false, 
    chainUnder90: true, 
    chainMilestone: true, 
    friendlyAttacked: false, 
    medOutSniper: true,
    travelWarnings: true,
    chainWarnings: true,
    inactivityTracker: true,
    inactivityRoleId: "",
    inactivityDays: 1,
    apiKey: "", 
    factionId: "",
    notificationsKilled: false
};
let marketConfig = { globalChannelId: "", autoDefense: false, sniperTargets: [] };
let marketMemory = { defense: {}, sniper: {} };
let ocConfig = { 
    globalChannelId: "", 
    roleId: "",
    alertPlanned: true,
    alertUpcoming: true,
    upcomingMinutes: 30,
    alertReady: true,
    alertDelayed: true,
    alertCompleted: true
};
let ocMemory = {};
 
let companyConfig = { globalChannelId: "", threshold: 0, alertedItems: {}, apiKey: "" };

let bankRequests = {};
let bankRequestCounter = 1000;

try { if (fs.existsSync('subscriptions.json')) subscriptions = JSON.parse(fs.readFileSync('subscriptions.json')); } catch (e) {}
try { if (fs.existsSync('discord_config.json')) discordConfig = { ...discordConfig, ...JSON.parse(fs.readFileSync('discord_config.json')) }; } catch(e) {}
global.isNotificationsKilled = !!discordConfig.notificationsKilled;
try { if (fs.existsSync('market_config.json')) marketConfig = { ...marketConfig, ...JSON.parse(fs.readFileSync('market_config.json')) }; } catch(e) {}
try { if (fs.existsSync('oc_config.json')) ocConfig = { ...ocConfig, ...JSON.parse(fs.readFileSync('oc_config.json')) }; } catch(e) {}

try {
    const bankFile = path.join(__dirname, 'data', 'bank_requests.json');
    if (fs.existsSync(bankFile)) {
        bankRequests = JSON.parse(fs.readFileSync(bankFile, 'utf8'));
        const ids = Object.keys(bankRequests).map(k => parseInt(k, 10)).filter(n => !isNaN(n));
        if (ids.length > 0) bankRequestCounter = Math.max(1000, ...ids);
    }
} catch(e) {
    console.error('[Bank] Error loading bank_requests.json:', e.message);
}

function saveBankRequests() {
    try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'bank_requests.json'), JSON.stringify(bankRequests, null, 2), 'utf8');
    } catch(e) {
        console.error('[Bank] Error saving bank_requests.json:', e.message);
    }
    saveToMongo();
}

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
                    bankRequests,
                    inactivityAlerts: inactivityAlertsMemory,
                    warFlightArchive,
                    warAuditArchive,
                    lastWarboardPayload: lastGoodWarboardPayload,
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

    // Emergency killswitch: instantly drop all automated notifications unless marked priority
    if (global.isNotificationsKilled && !priority) {
        return { success: false, error: "Notifications killed by emergency switch." };
    }

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

// ── Discord Interactive Component (ActionRow & Button) Builder ──
function buildDiscordComponents(embed, isWebhook = false) {
    if (!embed) return undefined;
    if (embed.components && Array.isArray(embed.components)) return embed.components;

    const rawButtons = [];

    // 1. Explicit buttons if passed
    if (Array.isArray(embed.buttons)) {
        for (const b of embed.buttons) {
            if (isWebhook && b.style !== 5 && !b.url) continue;
            rawButtons.push(b);
        }
    }

    // 2. Convert embed.links to Link buttons (style: 5)
    if (Array.isArray(embed.links)) {
        for (const link of embed.links) {
            if (link.label && link.url) {
                rawButtons.push({
                    type: 2, // Button
                    style: 5, // Link button
                    label: String(link.label).slice(0, 80),
                    url: String(link.url).trim()
                });
            }
        }
    }

    // 3. If embed has targetId and is a Bot (not webhook), add a Claim Target button if not already present
    if (!isWebhook && embed.targetId) {
        const tId = String(embed.targetId).trim().replace(/[^0-9]/g, '');
        if (tId) {
            const hasClaim = rawButtons.some(b => b.custom_id && b.custom_id.startsWith('claim_'));
            if (!hasClaim) {
                rawButtons.push({
                    type: 2, // Button
                    style: 3, // Success / Green
                    custom_id: `claim_${tId}`,
                    label: "🎯 Claim Target"
                });
            }
        }
    }

    if (rawButtons.length === 0) return undefined;

    // Discord allows max 5 buttons per ActionRow (type: 1), max 5 ActionRows per message
    const rows = [];
    for (let i = 0; i < rawButtons.length && rows.length < 5; i += 5) {
        rows.push({
            type: 1, // ActionRow
            components: rawButtons.slice(i, i + 5)
        });
    }
    return rows;
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
        const mentionId = cleanContent.replace(/[<@!&>]/g, '');
        if (!/^\d{15,22}$/.test(mentionId)) {
            cleanContent = "";
        }
    }

    const cleanEmbed = sanitizeEmbed(embed);
    const payload = cleanEmbed ? { embeds: [cleanEmbed] } : {};
    if (cleanContent) {
        payload.content = cleanContent;
        payload.allowed_mentions = { parse: ['roles', 'users', 'everyone'] };
    }

    // A. Webhook route
    if (webhookUrl) {
        console.log(`[Discord Webhook] Sending alert '${embed?.title || 'alert'}' to webhook...`);
        const webhookPayload = { ...payload };
        const webhookComponents = buildDiscordComponents(embed, true);
        if (webhookComponents && webhookComponents.length > 0) {
            webhookPayload.components = webhookComponents;
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            let res;
            try {
                res = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(webhookPayload),
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
    console.log(`[Discord Bot] Sending '${embed?.title || 'alert'}' to channel ${cleanChannelId}...`);
    const botPayload = { ...payload };
    const botComponents = buildDiscordComponents(embed, false);
    if (botComponents && botComponents.length > 0) {
        botPayload.components = botComponents;
    }

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
                body: JSON.stringify(botPayload),
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

            // Auto-recovery: if rejected due to components (e.g. 400 Bad Request on component validation), retry without components
            if (res.status === 400 && botPayload.components) {
                console.warn(`[Discord REST] Retrying '${embed?.title || 'alert'}' without button components...`);
                try {
                    const noCompRes = await fetch(`https://discord.com/api/v10/channels/${cleanChannelId}/messages`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bot ${cleanToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload),
                        signal: AbortSignal.timeout(8000)
                    });
                    if (noCompRes.ok) {
                        console.log(`[Discord Bot] '${embed?.title || 'alert'}' delivered without components.`);
                        return { success: true };
                    }
                } catch(e) {}
            }

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
            if (data.code === 50001) errMsg = "Missing Access (50001) — This channel is private or hidden. In Discord channel settings -> Permissions, add the bot (or 'SV Bot' role) and give it 'View Channel' and 'Send Messages' permissions.";
            if (data.code === 50013) errMsg = "Missing Permissions (50013) — Please ensure your bot role has 'Embed Links' and 'Send Messages' enabled in your Discord server.";
            if (data.code === 10003) errMsg = "Unknown Channel — verify your Alert Channel ID is correct.";
            if (res.status === 401) errMsg = "Unauthorized — your Bot Token is invalid. Please reset it in the Discord Developer Portal.";
            return { success: false, error: errMsg };
        }

        console.log(`[Discord Bot] '${embed?.title || 'alert'}' delivered to channel ${cleanChannelId}.`);
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
    
    let validKeys = activeKeys.filter(k => (globalApiUsage[k] || 0) < 30);
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
    const fState = getFactionWarState(myFactionId);
    const atkKey = atk.code || `${atk.attacker_id}_${atk.defender_id}_${atk.timestamp_ended}`;
    if (fState.processedAttackIds.has(atkKey)) return;
    
    const atkTime = atk.timestamp_ended || atk.timestamp_started || 0;
    if (warStart && atkTime < warStart) return;
    if (warEnd && warEnd > 0 && atkTime > warEnd) return;
    
    fState.processedAttackIds.add(atkKey);

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
            fState.liveAssists[aId] = (fState.liveAssists[aId] || 0) + 1;
        } else if (isWin) {
            const isEnemyHit = (enFac && dFac === enFac) || (atk.modifiers && atk.modifiers.war) || (atk.ranked_war === 1) || (atk.modifiers && atk.modifiers.fair_fight && dFac !== myFac);
            if (isEnemyHit || (!enFac && dFac !== myFac && dFac !== "0")) {
                fState.liveWarHits[aId] = (fState.liveWarHits[aId] || 0) + 1;
            } else {
                fState.liveOutsideHits[aId] = (fState.liveOutsideHits[aId] || 0) + 1;
            }
        }
    }

    // Friendly member was defended against / attacked
    if (dId && myFac && dFac === myFac) {
        if (isDefendWin) {
            const isEnemyDefend = (enFac && aFac === enFac) || (atk.modifiers && atk.modifiers.war);
            if (isEnemyDefend || (!enFac && aFac !== myFac && aFac !== "0")) {
                fState.liveWarDefendsWon[dId] = (fState.liveWarDefendsWon[dId] || 0) + 1;
            } else {
                fState.liveOutsideDefendsWon[dId] = (fState.liveOutsideDefendsWon[dId] || 0) + 1;
            }
        } else if (isWin) {
            const isEnemyAttack = (enFac && aFac === enFac) || (atk.modifiers && atk.modifiers.war);
            if (isEnemyAttack || (!enFac && aFac !== myFac && aFac !== "0")) {
                fState.liveWarHitsTaken[dId] = (fState.liveWarHitsTaken[dId] || 0) + 1;
            } else {
                fState.liveOutsideHitsTaken[dId] = (fState.liveOutsideHitsTaken[dId] || 0) + 1;
            }
        }
    }
}

async function backfillWarDefends(watchKey, watchFactionId, warStart, enemyFactionId = null, warEnd = 0) {
    const fState = getFactionWarState(watchFactionId);
    if (fState.isBackfillingWar) return;
    fState.isBackfillingWar = true;
    console.log(`[WarTracker:${watchFactionId}] Backfilling attacks from war start: ${warStart} (end: ${warEnd || 'ongoing'})...`);

    let toTimestamp = Math.floor(Date.now() / 1000);
    if (warEnd && warEnd > 0) toTimestamp = warEnd;

    const totalTimeSpan = Math.max(1, toTimestamp - warStart);

    let keepScraping = true;
    let pageCount = 0;
    let totalProcessed = 0;

    fState.syncStatus = {
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
                console.error(`[WarTracker:${watchFactionId}] Backfill error:`, data.error?.error || "No attacks returned");
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
            fState.syncStatus = {
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
            console.error(`[WarTracker:${watchFactionId}] Backfill exception:`, e.message);
            break; 
        }
    }
    fState.hasBackfilledWar = true;
    fState.isBackfillingWar = false;
    fState.syncStatus = {
        isSyncing: false,
        percent: 100,
        page: pageCount + 1,
        totalHitsLoaded: totalProcessed,
        message: `War attack history fully loaded (${totalProcessed} attacks processed)`
    };
    console.log(`[WarTracker:${watchFactionId}] Backfill complete. Processed ${totalProcessed} attacks across ${pageCount + 1} pages.`);
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
    let watchFactionId = discordConfig.factionId || dynamicFactionId || "52355";
    let watchKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
    if (!watchKey || !watchFactionId) return;

    try {
        const liveRes = await fetch(`https://api.torn.com/faction/${watchFactionId}?selections=attacks,basic,rankedwars&key=${watchKey}`);
        const liveData = await liveRes.json();
        
        let ongoingWar = getActiveRankedWar(liveData);
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
                backgroundEnemyTrackingState = {};
                backfillWarDefends(watchKey, watchFactionId, activeWarId, currentEnemyFacId, activeWarEnd);
            } else if (!hasBackfilledWar && !isBackfillingWar) {
                backfillWarDefends(watchKey, watchFactionId, activeWarId, currentEnemyFacId, activeWarEnd);
            }
        } else { 
            activeWarId = null; 
            activeWarEnd = null;
            hasBackfilledWar = false;
            currentEnemyFacId = null;
            enemyMembersCache = {};
            backgroundEnemyTrackingState = {};
            friendlyHitTracker = {};
            travelAlerts = {};
            liveWarHits = {};
            liveWarHitsTaken = {};
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
                                    title: "⚔️ Member Under Attack",
                                    description: `**${friendlyMem.name}**, you've been hit **3 times in a row** without defending. Log in to Torn and respond.`,
                                    color: 16729943,
                                    links: [
                                        { label: "🔗 View Chain", url: `https://www.torn.com/factions.php?step=your#/tab=chains` },
                                        { label: "📡 Live Warboard", url: `https://spider-verse.net/` }
                                    ]
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
                            title: "🚨 Faction Member Attacked", 
                            description: `**${defenderName}** was attacked by **${attackerName}** [${attackerId}] from \`${attackerFactionName}\`.`,
                            color: 16729943,
                            targetId: attackerId,
                            fields: [{ name: "Attacker Est. Stats", value: statStr, inline: true }],
                            links: [
                                { label: "⚔️ Attack Back", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${attackerId}` },
                                { label: "👤 Profile", url: `https://www.torn.com/profiles.php?XID=${attackerId}` }
                            ]
                        }, pingStr);
                    }
                }
                
                if (isWin && atk.attacker_faction && atk.attacker_faction.toString() === watchFactionId.toString()) {
                    let uId = atk.attacker_id ? atk.attacker_id.toString() : "0";
                    let isRecent = atk.timestamp_ended > (Math.floor(Date.now() / 1000) - 180);
                    if (atk.chain && BONUS_THRESHOLDS.has(atk.chain)) {
                        if (hasBackfilledWar && isRecent && discordConfig.chainMilestone !== false && discordConfig.globalChannelId) {
                            if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { 
                                title: "🏆 Chain Bonus", 
                                description: `Hit **#${atk.chain}** landed by **${atk.attacker_name || uId}** · +${atk.respect_gain || 0} respect`,
                                color: 16753922,
                                links: [{ label: "🔗 View Chain", url: `https://www.torn.com/factions.php?step=your#/tab=chains` }]
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
                                title: "✈️ Overseas Alert",
                                description: `**${fMem.name}** — an enemy (**${enemyThreats[fCountry][0]}**) is flying to **${fCountry}** where you are located.\n\nReturn to Torn or fly to a different destination.`,
                                color: 16729943,
                                links: [
                                    { label: "✈️ Travel Agency", url: `https://www.torn.com/travelagency.php` },
                                    { label: "🌐 Travel Desk", url: `https://spider-verse.net/travel.html` }
                                ]
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

// ─── Player Inactivity Tracker & Discord Alerts ──────────────────────────────
const INACTIVITY_ALERTS_FILE = path.join(__dirname, 'data', 'inactivity_alerts.json');

function loadInactivityAlerts() {
    try {
        if (!fs.existsSync(path.dirname(INACTIVITY_ALERTS_FILE))) {
            fs.mkdirSync(path.dirname(INACTIVITY_ALERTS_FILE), { recursive: true });
        }
        if (fs.existsSync(INACTIVITY_ALERTS_FILE)) {
            return JSON.parse(fs.readFileSync(INACTIVITY_ALERTS_FILE, 'utf8'));
        }
    } catch (e) {}
    return { alerts: {}, initialized: false };
}

function saveInactivityAlerts(data) {
    try {
        if (!fs.existsSync(path.dirname(INACTIVITY_ALERTS_FILE))) {
            fs.mkdirSync(path.dirname(INACTIVITY_ALERTS_FILE), { recursive: true });
        }
        fs.writeFileSync(INACTIVITY_ALERTS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
    saveToMongo();
}

let inactivityAlertsMemory = loadInactivityAlerts();

// Persistent Real-Time War Flight Archive
const WAR_FLIGHT_ARCHIVE_FILE = path.join(__dirname, 'data', 'war_flight_archive.json');
let warFlightArchive = {};
let warAuditArchive = {};
function loadWarFlightArchive() {
    try {
        if (!fs.existsSync(path.dirname(WAR_FLIGHT_ARCHIVE_FILE))) {
            fs.mkdirSync(path.dirname(WAR_FLIGHT_ARCHIVE_FILE), { recursive: true });
        }
        if (fs.existsSync(WAR_FLIGHT_ARCHIVE_FILE)) {
            warFlightArchive = JSON.parse(fs.readFileSync(WAR_FLIGHT_ARCHIVE_FILE, 'utf8'));
        }
    } catch (e) {}
}
function saveWarFlightArchive() {
    try {
        if (!fs.existsSync(path.dirname(WAR_FLIGHT_ARCHIVE_FILE))) {
            fs.mkdirSync(path.dirname(WAR_FLIGHT_ARCHIVE_FILE), { recursive: true });
        }
        fs.writeFileSync(WAR_FLIGHT_ARCHIVE_FILE, JSON.stringify(warFlightArchive), 'utf8');
    } catch (e) {}
    saveToMongo();
}
loadWarFlightArchive();

function handleKillCommand(actorName = "Admin") {
    global.isNotificationsKilled = true;
    discordConfig.notificationsKilled = true;
    discordSendQueue = []; // Instantly drop all queued notifications
    saveDiscordConfig();
    console.log(`[Killswitch] 🛑 Emergency Killswitch ACTIVATED by ${actorName}`);
    
    return {
        title: "⏸ Alerts Paused",
        description: `All Discord notifications have been paused by **${actorName}**.\n\n` +
            `• Hospital & landing alerts: paused\n` +
            `• Target online alerts: paused\n` +
            `• Chain warnings: paused\n` +
            `• Inactivity alerts: paused\n` +
            `• Bazaar alerts: paused\n\n` +
            `Use \`/resume\` or \`!resume\` to restore alerts.`,
        color: 16729930,
        footer: { text: "Owen's Faction Tools • Alerts" },
        timestamp: new Date().toISOString()
    };
}

function handleLiveCommand(actorName = "Admin") {
    global.isNotificationsKilled = false;
    discordConfig.notificationsKilled = false;
    saveDiscordConfig();
    console.log(`[Killswitch] 🟢 Notifications RESTORED to LIVE by ${actorName}`);
    
    return {
        title: "🟢 Alerts Resumed",
        description: `Faction alerts are now active again. Restored by **${actorName}**.\n\n` +
            `• Hospital & landing alerts: active\n` +
            `• Target online alerts: active\n` +
            `• Chain warnings: active\n` +
            `• Inactivity alerts: active\n` +
            `• Bazaar alerts: active`,
        color: 3069299,
        footer: { text: "Owen's Faction Tools • Alerts" },
        timestamp: new Date().toISOString()
    };
}

async function checkFactionMembersInactivity(members, expectedFactionId, factionName) {
    if (!members || typeof members !== 'object') return;
    if (global.isNotificationsKilled) return;
    if (discordConfig.inactivityTracker === false) return;
    if (!discordConfig.globalBotToken || !discordConfig.globalChannelId) return;

    const myFacId = String(expectedFactionId || discordConfig.factionId || dynamicFactionId || "52355");
    const myFacName = factionName || "Spider-Verse";

    // 1. Purge any rogue/stale alerts for members not belonging to this faction
    let pruned = false;
    for (const alertId of Object.keys(inactivityAlertsMemory.alerts || {})) {
        if (!members[alertId]) {
            delete inactivityAlertsMemory.alerts[alertId];
            pruned = true;
        }
    }
    if (pruned) saveInactivityAlerts(inactivityAlertsMemory);

    const thresholdDays = Math.max(1, Number(discordConfig.inactivityDays) || 1);
    const thresholdSec = thresholdDays * 86400;
    const now = Math.floor(Date.now() / 1000);

    // Initial startup check: if tracker is newly initialized or seeded,
    // seed ANY member who is ALREADY past the inactivity threshold (>= thresholdSec)
    // so we NEVER spam Discord on fresh server boots, deploys, or restarts.
    if (!inactivityAlertsMemory.initialized) {
        for (const [id, m] of Object.entries(members)) {
            const lastTs = m.last_action?.timestamp || 0;
            if (lastTs && (now - lastTs) >= thresholdSec) {
                inactivityAlertsMemory.alerts[id] = {
                    lastActionTs: lastTs,
                    alertedAt: now,
                    seeded: true
                };
            }
        }
        inactivityAlertsMemory.initialized = true;
        saveInactivityAlerts(inactivityAlertsMemory);
    }

    let roleMention = "";
    if (discordConfig.inactivityRoleId && String(discordConfig.inactivityRoleId).trim()) {
        const rawRole = String(discordConfig.inactivityRoleId).trim();
        const numOnly = rawRole.replace(/\D/g, '');
        if (numOnly.length >= 15 && numOnly.length <= 22) {
            roleMention = `<@&${numOnly}>`;
        } else if (rawRole.startsWith('<@&') && rawRole.endsWith('>')) {
            roleMention = rawRole;
        } else if (rawRole === "@here" || rawRole === "@everyone") {
            roleMention = rawRole;
        }
    }

    for (const [id, m] of Object.entries(members)) {
        const lastTs = m.last_action?.timestamp || 0;
        if (!lastTs) continue;

        const inactiveSec = now - lastTs;

        // If player is active (less than threshold), clear prior alert so future inactivity can alert
        if (inactiveSec < thresholdSec) {
            if (inactivityAlertsMemory.alerts[id]) {
                delete inactivityAlertsMemory.alerts[id];
                saveInactivityAlerts(inactivityAlertsMemory);
            }
            continue;
        }

        // Check if already alerted for this specific last_action timestamp
        const priorAlert = inactivityAlertsMemory.alerts[id];
        if (priorAlert && priorAlert.lastActionTs === lastTs) {
            continue; // Already alerted for this inactivity streak
        }

        const inactiveHours = Math.floor(inactiveSec / 3600);
        const inactiveDaysCount = Math.floor(inactiveSec / 86400);
        const daysText = inactiveDaysCount <= 1 ? '1 day' : `${inactiveDaysCount} days`;
        const timeDisplay = `${daysText} (${inactiveHours} hours)`;
        const relText = m.last_action?.relative || `${inactiveHours} hours ago`;
        const memberStatus = m.status?.description || m.status?.state || m.last_action?.status || 'Offline';

        const embed = {
            title: `💤 Inactive Member`,
            description: `**[${m.name}](https://www.torn.com/profiles.php?XID=${id})** [${id}] has been offline for **${timeDisplay}** with no actions recorded.`,
            // Formerly: "${myFacName.toUpperCase()} INACTIVITY ALERT"
            color: 16744272, // Warm Gold/Orange #ffa502
            fields: [
                { name: "⏱️ Inactive Duration", value: `**${timeDisplay}**`, inline: true },
                { name: "🕒 Last Action", value: `${relText}`, inline: true },
                { name: "📊 Current Status", value: `${memberStatus}`, inline: true },
                { name: "🎖️ Faction Position", value: `${m.position || 'Member'} (Lvl ${m.level || '—'})`, inline: true }
            ],
            links: [
                { label: "👤 View Profile", url: `https://www.torn.com/profiles.php?XID=${id}` },
                { label: "💬 Send Message", url: `https://www.torn.com/messages.php#/p=compose&XID=${id}` }
            ],
            footer: { text: `${myFacName} [${myFacId}] • Inactivity Watcher` },
            timestamp: new Date().toISOString()
        };

        console.log(`[Inactivity Tracker] 💤 Sending alert for ${m.name} [${id}] in ${myFacName} (${timeDisplay} inactive) with mention: ${roleMention || 'none'}`);
        sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, embed, roleMention);

        inactivityAlertsMemory.alerts[id] = {
            lastActionTs: lastTs,
            alertedAt: now,
            name: m.name,
            inactiveHours
        };
        saveInactivityAlerts(inactivityAlertsMemory);
    }
}

// Background Task 3: Sniper & Target Status Watcher
setInterval(async () => {
    if (global.isTurboMining) return;
    if (global.isNotificationsKilled) return;
    let watchKey = getNextApiKey();
    let watchFactionId = discordConfig.factionId || dynamicFactionId || "52355";
    if (!watchKey || !watchFactionId) return;

    try {
        const facRes = await fetch(`https://api.torn.com/faction/${watchFactionId}?selections=basic,chain,rankedwars&key=${watchKey}`);
        const facData = await facRes.json();
        if (facData.error) return;
        if (facData.ID && String(facData.ID) !== String(watchFactionId)) return;

        // Check Friendly Member Inactivity Tracker
        if (facData.members && discordConfig.inactivityTracker !== false && discordConfig.globalChannelId) {
            checkFactionMembersInactivity(facData.members, watchFactionId, facData.name);
        }

        // Continuous Real-Time War Flight Archiver
        if (facData.members) {
            const nowSec = Math.floor(Date.now() / 1000);
            let archiveChanged = false;
            for (const [mId, m] of Object.entries(facData.members)) {
                const state = (m.status?.state || "").trim();
                const desc = (m.status?.description || "").trim();
                const isFlying = state === "Traveling" || state === "Abroad" || desc.toLowerCase().includes("traveling") || desc.toLowerCase().includes("in ");
                if (isFlying) {
                    if (!warFlightArchive[mId]) warFlightArchive[mId] = [];
                    const list = warFlightArchive[mId];
                    const last = list[list.length - 1];
                    if (last && (nowSec - last.end) < 400) {
                        last.end = nowSec;
                        if (m.status?.until) last.until = m.status.until;
                        if (desc) last.dest = desc;
                    } else {
                        list.push({
                            start: nowSec,
                            end: nowSec,
                            until: m.status?.until || (nowSec + 3600),
                            dest: desc || state
                        });
                        if (list.length > 80) list.shift();
                    }
                    archiveChanged = true;
                }
            }
            if (archiveChanged) saveWarFlightArchive();
        }

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
        if (!activeEnemyId) {
            // No active war - purge enemy tracking state so NO old war alerts can fire
            backgroundEnemyTrackingState = {};
            currentEnemyFacId = null;
        } else if (discordConfig.globalChannelId) {
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
                            if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { 
                                title: "🟢 Target Online", 
                                description: `**${m.name}** [${id}] is now online in Torn and is attackable.`, 
                                color: 3069299, 
                                targetId: id,
                                links: [
                                    { label: "⚔️ Attack", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` },
                                    { label: "👤 Profile", url: `https://www.torn.com/profiles.php?XID=${id}` }
                                ] 
                            });
                        }

                        // ── 2. LANDING TRACKER (FIXED: must be independent, not nested under Hospital) ──
                        const wasTravel = oldRecord.state === "Traveling" || (oldRecord.description && oldRecord.description.toLowerCase().includes("traveling"));
                        const notTravelNow = newRecord.state !== "Traveling";
                        if (wasTravel && notTravelNow && discordConfig.targetLanded !== false) {
                            if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { 
                                title: "✈️ Target Returned from Abroad", 
                                description: `**${m.name}** [${id}] has landed back in Torn and is now attackable.`, 
                                color: 5809919, 
                                targetId: id,
                                links: [
                                    { label: "⚔️ Attack", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` },
                                    { label: "👤 Profile", url: `https://www.torn.com/profiles.php?XID=${id}` }
                                ] 
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
                                    title: "💊 Early Hospital Escape", 
                                    description: `**${m.name}** [${id}] left hospital early using meds or a revive and is now online.`,
                                    color: 16729943,
                                    targetId: id,
                                    fields: [
                                        { name: "Est. Battle Stats", value: statStr, inline: true },
                                        { name: "Suggested Fighter", value: bestMatchName ? `**${bestMatchName}** — matched by stats` : "No match found", inline: false }
                                    ],
                                    links: [
                                        { label: "⚔️ Attack", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` },
                                        { label: "👤 Profile", url: `https://www.torn.com/profiles.php?XID=${id}` }
                                    ]
                                }, pingStr);
                                
                            } else if (discordConfig.targetOutHosp === true && !leftEarly) {
                                if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { 
                                    title: "🏥 Target Out of Hospital", 
                                    description: `**${m.name}** [${id}] served their full hospital time and is now Okay.`, 
                                    color: 16753922, 
                                    targetId: id,
                                    links: [
                                        { label: "⚔️ Attack", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` },
                                        { label: "👤 Profile", url: `https://www.torn.com/profiles.php?XID=${id}` }
                                    ] 
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

const userFactionCache = {};

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
            if ([5, 8, 9, 14, 16].includes(data.error.code)) { 
                if (subCache[userKey]) return subCache[userKey].playerId;
                return "cached_user"; 
            }
            if (data.error.code === 2) throw new Error("Invalid API Key.");
            throw new Error(`Torn API Throttled: Retrying link...`);
        }

        const playerId = data.player_id?.toString();
        const rawFacId = data.faction?.faction_id;
        const facId = (rawFacId && rawFacId !== 0) ? rawFacId.toString() : null;
        const facName = data.faction?.faction_name || null;

        if (data.name && playerId) {
            userTracking[playerId] = { name: data.name, lastActive: now };
            saveTracking();
        }

        const userObj = {
            playerId,
            playerName: data.name,
            facId,
            facName,
            isFactionless: !facId,
            expires: now + 300000
        };

        subCache[userKey] = userObj;
        userFactionCache[userKey] = userObj;
        return playerId;
    } catch (err) {
        if (subCache[userKey]) return subCache[userKey].playerId;
        throw err;
    }
}

async function getUserFactionInfo(userKey) {
    if (!userKey) return null;
    const now = Date.now();
    if (userFactionCache[userKey] && userFactionCache[userKey].expires > now) {
        return userFactionCache[userKey];
    }
    if (subCache[userKey] && subCache[userKey].expires > now && subCache[userKey].facId !== undefined) {
        return subCache[userKey];
    }
    try {
        await verifySubscription(userKey);
        return subCache[userKey] || userFactionCache[userKey] || null;
    } catch(e) {
        return subCache[userKey] || userFactionCache[userKey] || null;
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

function autoDetectEnemyFaction(data, allowPeacetimeFallback = false) {
    if (!data || !data.ID) return null;
    const myId = data.ID.toString();
    if (data.rankedwars && Object.keys(data.rankedwars).length > 0) {
        const activeWar = getActiveRankedWar(data);
        if (activeWar && activeWar.factions) {
            const factions = Object.keys(activeWar.factions || {});
            const enemy = factions.find(id => id !== myId);
            if (enemy) return enemy;
        }
        if (allowPeacetimeFallback) {
            const sortedWars = Object.values(data.rankedwars).sort((a, b) => (b.war?.start || 0) - (a.war?.start || 0));
            if (sortedWars.length > 0) {
                const factions = Object.keys(sortedWars[0].factions || {});
                const enemy = factions.find(id => id !== myId);
                if (enemy) return enemy;
            }
        }
    }
    return null;
}

app.get('/health', (req, res) => res.status(200).send("OK"));


app.get('/api/get-discord-config', (req, res) => {
    // Safety check: ensure globalChannelId never leaks or stores a bot token
    if (discordConfig.globalChannelId && (discordConfig.globalChannelId.includes('.') || /[a-zA-Z]/.test(discordConfig.globalChannelId))) {
        if (!discordConfig.globalBotToken && discordConfig.globalChannelId.length > 30) {
            discordConfig.globalBotToken = discordConfig.globalChannelId.trim();
        }
        discordConfig.globalChannelId = "";
        saveDiscordConfig();
    }
    if (discordConfig.bankingChannelId && (discordConfig.bankingChannelId.includes('.') || /[a-zA-Z]/.test(discordConfig.bankingChannelId))) {
        discordConfig.bankingChannelId = "";
        saveDiscordConfig();
    }
    res.json(discordConfig);
});

app.post('/api/save-discord-config', async (req, res) => { 
    const payload = { ...req.body };

    // SANITIZATION: Protect against bot tokens being placed into channel ID fields
    if (payload.globalChannelId !== undefined) {
        let rawChan = String(payload.globalChannelId || '').trim();
        if (rawChan.includes('.') || /[a-zA-Z]/.test(rawChan)) {
            // It's a bot token! If globalBotToken wasn't passed, rescue it
            if ((!payload.globalBotToken || !payload.globalBotToken.includes('.')) && rawChan.length > 30) {
                payload.globalBotToken = rawChan;
            }
            payload.globalChannelId = "";
        } else {
            payload.globalChannelId = rawChan.replace(/[^0-9]/g, '');
        }
    }

    if (payload.bankingChannelId !== undefined) {
        let rawBank = String(payload.bankingChannelId || '').trim();
        if (rawBank.includes('.') || /[a-zA-Z]/.test(rawBank)) {
            payload.bankingChannelId = "";
        } else {
            payload.bankingChannelId = rawBank.replace(/[^0-9]/g, '');
        }
    }

    if (payload.globalBotToken !== undefined) {
        payload.globalBotToken = String(payload.globalBotToken || '').trim();
    }

    discordConfig = { ...discordConfig, ...payload }; 
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
            title: "✈️ Overseas Alert",
            description: `**[Your Name]** — an enemy (**[Test] EnemyName**) is flying to **Mexico** where you are located.\n\nReturn to Torn or fly to a different destination.`,
            color: 16729943,
            links: [
                { label: "✈️ Travel Agency", url: `https://www.torn.com/travelagency.php` },
                { label: "🌐 Travel Desk", url: `https://spider-verse.net/travel.html` }
            ]
        };
    } else if (type === 'chain') {
        embed = {
            title: "⚔️ Member Under Attack",
            description: `**[Your Name]**, you've been hit **3 times in a row** without defending. Log in to Torn and respond.`,
            color: 16729943,
            links: [
                { label: "🔗 View Chain", url: `https://www.torn.com/factions.php?step=your#/tab=chains` },
                { label: "📡 Live Warboard", url: `https://spider-verse.net/` }
            ]
        };
    } else if (type === 'target' || type === 'sniper') {
        embed = {
            title: type === 'sniper' ? "💊 Early Hospital Escape" : "✈️ Target Returned from Abroad",
            description: type === 'sniper'
                ? `**[Test Enemy]** [999999] left hospital early using meds or a revive and is now online.`
                : `**[Test Enemy]** [999999] has landed back in Torn and is now attackable.`,
            color: 3069299,
            targetId: "999999",
            fields: [
                { name: "Est. Battle Stats", value: "~15,400,000", inline: true },
                { name: "Current Status", value: "Online in Torn", inline: true },
                { name: "Suggested Fighter", value: "You — matched by stats", inline: false }
            ],
            links: [
                { label: "⚔️ Attack", url: `https://www.torn.com/loader.php?sid=attack&user2ID=999999` },
                { label: "👤 Profile", url: `https://www.torn.com/profiles.php?XID=999999` }
            ],
            footer: { text: "Owen's Faction Tools • Alert Test" },
            timestamp: new Date().toISOString()
        };
    } else if (type === 'inactivity') {
        let rolePingStr = "";
        const roleInput = req.body.inactivityRoleId || discordConfig.inactivityRoleId;
        if (roleInput && String(roleInput).trim()) {
            const rawRole = String(roleInput).trim();
            const numOnly = rawRole.replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) {
                rolePingStr = `<@&${numOnly}>`;
            } else if (rawRole.startsWith('<@&') && rawRole.endsWith('>')) {
                rolePingStr = rawRole;
            } else if (rawRole === "@here" || rawRole === "@everyone") {
                rolePingStr = rawRole;
            }
        }
        embed = {
            title: "💤 Inactive Member",
            description: `**[Test Member]** [1234567] has been offline for **1 day (24 hours)** with no actions recorded.`,
            color: 16744272,
            fields: [
                { name: "⏱️ Inactive Duration", value: "**1 day (24 hours)**", inline: true },
                { name: "🕒 Last Action", value: "Yesterday (24h ago)", inline: true },
                { name: "📊 Current Status", value: "Offline", inline: true },
                { name: "🎯 Role Mentioned", value: rolePingStr ? `Pinging ${rolePingStr}` : "None configured", inline: true }
            ],
            links: [
                { label: "👤 View Profile", url: "https://www.torn.com/profiles.php?XID=1234567" },
                { label: "💬 Send Message", url: "https://www.torn.com/messages.php#/p=compose&XID=1234567" }
            ],
            footer: { text: "Owen's Faction Tools • Inactivity Watcher Test" },
            timestamp: new Date().toISOString()
        };
        pingStr = rolePingStr;
    } else {
        return res.json({ success: false, error: "Unknown test type." });
    }

    let result = await executeDiscordSend(botToken, chanId, embed, pingStr);
    console.log(`[Discord Test] Result:`, result);
    if (!result.success) return res.json({ success: false, error: result.error });
    
    res.json({ success: true, warning: result.warning || null });
});

app.post('/api/discord/kill', (req, res) => {
    const actor = req.body?.actor || 'Web Dashboard';
    const embed = handleKillCommand(actor);
    if (discordConfig.globalBotToken && discordConfig.globalChannelId) {
        sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, embed, "", true);
    }
    res.json({ success: true, killed: true });
});

app.post('/api/discord/live', (req, res) => {
    const actor = req.body?.actor || 'Web Dashboard';
    const embed = handleLiveCommand(actor);
    if (discordConfig.globalBotToken && discordConfig.globalChannelId) {
        sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, embed, "", true);
    }
    res.json({ success: true, killed: false });
});

app.get('/api/discord/killswitch-status', (req, res) => {
    res.json({ killed: !!global.isNotificationsKilled });
});

app.get('/api/inactivity-tracker', async (req, res) => {
    const userKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!userKey || userKey === "null" || userKey.trim() === "") return res.status(401).json({ error: "API Key required" });

    try {
        const userInfo = await getUserFactionInfo(userKey);
        let watchFactionId = (req.query.factionId || req.headers['x-faction-id'])
            || userInfo?.facId
            || discordConfig.factionId
            || dynamicFactionId
            || "52355";
        let url = `https://api.torn.com/faction/${watchFactionId}?selections=basic&key=${userKey}`;
        let facData = await cachedTornFetch(url, `faction_inact_${watchFactionId}`, 10000);
        let members = facData?.members;

        // If targeted fetch hit error 6 (e.g. user in different faction), try /faction/
        if (!members || facData?.error?.code === 6) {
            facData = await cachedTornFetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`, `faction_inact_personal_${userKey}`, 10000);
            if (facData?.members) members = facData.members;
        }

        // If throttled or errored, fall back to cached friendly members
        if ((!members || Object.keys(members).length === 0) && lastGoodWarboardPayload?.friendly?.length > 0) {
            members = {};
            lastGoodWarboardPayload.friendly.forEach(m => {
                members[m.id] = {
                    name: m.name,
                    level: m.level,
                    position: m.position || 'Member',
                    status: { description: m.statusDescription || m.state || 'Okay', state: m.state || 'Okay' },
                    last_action: {
                        timestamp: m.lastActionTimestamp || (Math.floor(Date.now() / 1000) - 3600),
                        relative: m.lastActionRelative || 'Recently',
                        status: m.onlineStatus || 'Online'
                    }
                };
            });
        }

        if (!members || Object.keys(members).length === 0) {
            if (facData?.error) return res.status(400).json({ error: facData.error.error });
            return res.status(400).json({ error: "Failed to load faction members." });
        }
        const now = Math.floor(Date.now() / 1000);
        const thresholdDays = Math.max(1, Number(discordConfig.inactivityDays) || 1);
        const thresholdSec = thresholdDays * 86400;

        const inactiveList = [];
        let totalMembers = 0;

        for (const [id, m] of Object.entries(members)) {
            totalMembers++;
            const lastTs = m.last_action?.timestamp || 0;
            const diff = now - lastTs;
            const isInactive = diff >= thresholdSec;
            const hours = Math.floor(diff / 3600);
            const days = (diff / 86400).toFixed(1);

            if (isInactive) {
                inactiveList.push({
                    id,
                    name: m.name,
                    level: m.level,
                    position: m.position,
                    status: m.status?.description || m.status?.state || m.last_action?.status || 'Offline',
                    lastActionTimestamp: lastTs,
                    relative: m.last_action?.relative || `${hours}h ago`,
                    inactiveHours: hours,
                    inactiveDays: parseFloat(days),
                    alerted: !!(inactivityAlertsMemory.alerts[id] && inactivityAlertsMemory.alerts[id].lastActionTs === lastTs)
                });
            }
        }

        inactiveList.sort((a, b) => b.inactiveHours - a.inactiveHours);

        res.json({
            success: true,
            enabled: discordConfig.inactivityTracker !== false,
            roleId: discordConfig.inactivityRoleId || "",
            thresholdDays,
            totalMembers,
            inactiveCount: inactiveList.length,
            inactiveMembers: inactiveList
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


app.post('/api/discord-ping', async (req, res) => {
    return res.json({ success: false, error: "Deprecated endpoint. Use test-discord-alert." });
});


const warAuditCache = {};

app.get('/api/war-list', async (req, res) => {
    const userKey = req.headers['x-api-key'] || req.query.apiKey;
    try {
        if (!userKey || userKey === "null" || userKey.trim() === "") return res.status(401).json({ error: "Missing API key" });
        const userInfo = await getUserFactionInfo(userKey);
        let targetFacId = (req.query.factionId || req.headers['x-faction-id'])
            || userInfo?.facId
            || discordConfig.factionId
            || "52355";
        let facRes = await fetch(`https://api.torn.com/faction/${targetFacId}?selections=basic,rankedwars&key=${userKey}`, { signal: AbortSignal.timeout(8000) });
        let facData = await facRes.json();
        if (facData.error && facData.error.code === 6) {
            facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`, { signal: AbortSignal.timeout(8000) });
            facData = await facRes.json();
        }
        if (facData.error) return res.status(400).json({ error: facData.error.error });

        let wars = [];
        if (facData.rankedwars) {
            for (let [warId, warInfo] of Object.entries(facData.rankedwars)) {
                let enemyName = "Unknown Faction";
                let enemyId = null;
                let ourScore = 0;
                let theirScore = 0;
                for (let [fId, fInfo] of Object.entries(warInfo.factions || {})) {
                    if (fId !== facData.ID.toString()) {
                        enemyName = fInfo.name;
                        enemyId = fId;
                        theirScore = fInfo.score || 0;
                    } else {
                        ourScore = fInfo.score || 0;
                    }
                }
                const isOngoing = !warInfo.war?.winner || warInfo.war?.winner === 0;
                wars.push({
                    id: warId,
                    enemy: enemyName,
                    enemyId,
                    ourScore,
                    theirScore,
                    isOngoing,
                    winner: warInfo.war?.winner || 0,
                    start: warInfo.war?.start,
                    end: warInfo.war?.end || Math.floor(Date.now() / 1000)
                });
            }
        }
        wars.sort((a, b) => b.start - a.start);
        res.json({ success: true, wars });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/war-flight-audit', async (req, res) => {
    const userKey = req.headers['x-api-key'] || req.query.apiKey;
    const ffKey = (req.headers['x-ff-key'] || req.query.ffKey) || getGlobalFFKey() || discordConfig.ffKey;
    const reqWarId = req.query.warId;

    if (!userKey || userKey === "null" || userKey.trim() === "") return res.status(401).json({ error: "Missing Torn API Key" });

    try {
        // 1. Fetch faction info & ranked wars
        const userInfo = await getUserFactionInfo(userKey);
        let targetFacId = (req.query.factionId || req.headers['x-faction-id'])
            || userInfo?.facId
            || discordConfig.factionId
            || "52355";
        let facRes = await fetch(`https://api.torn.com/faction/${targetFacId}?selections=basic,rankedwars&key=${userKey}`, { signal: AbortSignal.timeout(8000) });
        let facData = await facRes.json();
        if (facData.error && facData.error.code === 6) {
            facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`, { signal: AbortSignal.timeout(8000) });
            facData = await facRes.json();
        }
        if (facData.error) return res.status(400).json({ error: facData.error.error });

        const myId = facData.ID.toString();
        const myFactionName = facData.name || "Our Faction";
        const members = facData.members || {};
        const rankedWars = facData.rankedwars || {};

        if (!rankedWars || Object.keys(rankedWars).length === 0) {
            return res.status(400).json({ error: "No ranked wars found in faction records." });
        }

        // 2. Resolve selected war
        let targetWarId = reqWarId;
        let selectedWarInfo = null;

        if (targetWarId && rankedWars[targetWarId]) {
            selectedWarInfo = rankedWars[targetWarId];
        } else {
            const sorted = Object.entries(rankedWars).sort((a, b) => (b[1].war?.start || 0) - (a[1].war?.start || 0));
            targetWarId = sorted[0][0];
            selectedWarInfo = sorted[0][1];
        }

        if (!selectedWarInfo || !selectedWarInfo.war) {
            return res.status(400).json({ error: "Selected war data not found." });
        }

        const now = Math.floor(Date.now() / 1000);
        const warStart = selectedWarInfo.war.start || 0;
        const isOngoing = !selectedWarInfo.war.winner || selectedWarInfo.war.winner === 0;
        const warEnd = isOngoing ? now : (selectedWarInfo.war.end || now);
        const warDuration = Math.max(1, warEnd - warStart);

        let enemyId = null;
        let enemyName = "Enemy Faction";
        let ourScore = 0;
        let theirScore = 0;

        for (const [fId, fInfo] of Object.entries(selectedWarInfo.factions || {})) {
            if (fId !== myId) {
                enemyId = fId;
                enemyName = fInfo.name || "Enemy Faction";
                theirScore = fInfo.score || 0;
            } else {
                ourScore = fInfo.score || 0;
            }
        }

        // Check cache (fast return if already audited with latest logic version)
        const AUDIT_VERSION = 5;
        const cacheKey = `${targetWarId}_${ffKey ? ffKey.substring(0, 6) : 'none'}`;
        if (!isOngoing && !req.query.force && warAuditArchive[targetWarId] && warAuditArchive[targetWarId].v === AUDIT_VERSION) {
            return res.json(warAuditArchive[targetWarId]);
        }
        if (warAuditCache[cacheKey] && !req.query.force && warAuditCache[cacheKey].v === AUDIT_VERSION && (Date.now() - warAuditCache[cacheKey].timestamp) < (isOngoing ? 30000 : 3600000)) {
            return res.json(warAuditCache[cacheKey].data);
        }

        // 3. Initialize memberStats with ALL current members
        const memberStats = {};
        for (const [mId, mInfo] of Object.entries(members)) {
            memberStats[mId] = {
                id: mId,
                name: mInfo.name,
                level: mInfo.level || '—',
                hitsMade: 0,
                respectEarned: 0,
                timesHit: 0,
                warHitsTaken: 0,
                outsideHitsTaken: 0,
                timesBeaten: 0,
                timesDefended: 0,
                timesFarmed: 0,
                totalDefends: 0,
                defendedSuccessfully: 0,
                respectLeaked: 0,
                flightSec: 0,
                flightTrips: 0,
                overseasHits: 0,
                overseasTimestamps: [],
                flightDestinations: []
            };
        }

        // Add any member from rankedwarreport who isn't currently in the faction
        try {
            const repRes = await fetch(`https://api.torn.com/torn/${targetWarId}?selections=rankedwarreport&key=${userKey}`, { signal: AbortSignal.timeout(6000) });
            const repData = await repRes.json();
            if (repData.rankedwarreport?.factions?.[myId]?.members) {
                const repMembers = repData.rankedwarreport.factions[myId].members;
                for (const [mId, rM] of Object.entries(repMembers)) {
                    if (!memberStats[mId]) {
                        memberStats[mId] = {
                            id: mId,
                            name: rM.name || `Member #${mId}`,
                            level: rM.level || '—',
                            hitsMade: 0,
                            respectEarned: 0,
                            timesHit: 0,
                            timesBeaten: 0,
                            timesDefended: 0,
                            timesFarmed: 0,
                            totalDefends: 0,
                            defendedSuccessfully: 0,
                            respectLeaked: 0,
                            flightSec: 0,
                            flightTrips: 0,
                            overseasHits: 0,
                            overseasTimestamps: [],
                            flightDestinations: []
                        };
                    }
                    memberStats[mId].hitsMade = Number(rM.attacks || 0);
                    memberStats[mId].respectEarned = Number(rM.score || 0);
                }
            }
        } catch (repErr) {
            console.warn("[War Audit] rankedwarreport warning:", repErr.message);
        }

        // 4. Paginate through ALL war attacks from warStart to warEnd
        let fromTs = warStart;
        let attacksScanned = 0;
        const MAX_ATK_PAGES = 40; // up to 4,000 attacks
        let pages = 0;

        while (fromTs < warEnd && pages < MAX_ATK_PAGES) {
            try {
                const atkRes = await fetch(
                    `https://api.torn.com/faction/?selections=attacks&from=${fromTs}&to=${warEnd}&key=${userKey}`,
                    { signal: AbortSignal.timeout(8000) }
                );
                const atkData = await atkRes.json();
                const atks = Object.values(atkData.attacks || {});
                if (!atks.length) break;
                pages++;
                attacksScanned += atks.length;

                let maxTs = fromTs;
                for (const atk of atks) {
                    const ts = atk.timestamp_ended || atk.timestamp_started || 0;
                    if (ts > maxTs) maxTs = ts;
                    if (ts < warStart || ts > warEnd) continue;

                    const defId = atk.defender_id?.toString();
                    const atkId = atk.attacker_id?.toString();

                    // Track overseas combat presence (Torn API modifier: 1 = local in Torn, 1.25 = abroad overseas)
                    const isOverseas = atk.modifiers && Number(atk.modifiers.overseas) > 1;
                    if (isOverseas) {
                        if (atk.attacker_faction == myId && atkId) {
                            if (!memberStats[atkId]) {
                                memberStats[atkId] = { id: atkId, name: atk.attacker_name || `Member #${atkId}`, level: '—', hitsMade: 0, respectEarned: 0, timesHit: 0, timesBeaten: 0, timesDefended: 0, timesFarmed: 0, totalDefends: 0, defendedSuccessfully: 0, respectLeaked: 0, flightSec: 0, flightTrips: 0, overseasHits: 0, overseasTimestamps: [], flightDestinations: [] };
                            }
                            memberStats[atkId].overseasHits++;
                            memberStats[atkId].overseasTimestamps.push(ts);
                        }
                        if (atk.defender_faction == myId && defId) {
                            if (!memberStats[defId]) {
                                memberStats[defId] = { id: defId, name: atk.defender_name || `Member #${defId}`, level: '—', hitsMade: 0, respectEarned: 0, timesHit: 0, timesBeaten: 0, timesDefended: 0, timesFarmed: 0, totalDefends: 0, defendedSuccessfully: 0, respectLeaked: 0, flightSec: 0, flightTrips: 0, overseasHits: 0, overseasTimestamps: [], flightDestinations: [] };
                            }
                            memberStats[defId].overseasHits++;
                            memberStats[defId].overseasTimestamps.push(ts);
                        }
                    }

                    // Defense check: Capture ALL attacks on our members during the war window (ranked war + outside/bounties)
                    if (atk.defender_faction == myId && defId) {
                        if (!memberStats[defId]) {
                            memberStats[defId] = { id: defId, name: atk.defender_name || `Member #${defId}`, level: '—', hitsMade: 0, respectEarned: 0, timesHit: 0, warHitsTaken: 0, outsideHitsTaken: 0, timesBeaten: 0, timesDefended: 0, timesFarmed: 0, totalDefends: 0, defendedSuccessfully: 0, respectLeaked: 0, flightSec: 0, flightTrips: 0, overseasHits: 0, overseasTimestamps: [], flightDestinations: [] };
                        }
                        memberStats[defId].timesHit++;
                        memberStats[defId].totalDefends++;

                        const isEnemyWarAttack = (atk.ranked_war == 1 || atk.ranked_war === true);
                        if (isEnemyWarAttack) {
                            memberStats[defId].warHitsTaken = (memberStats[defId].warHitsTaken || 0) + 1;
                        } else {
                            memberStats[defId].outsideHitsTaken = (memberStats[defId].outsideHitsTaken || 0) + 1;
                        }

                        const result = atk.result || "";
                        if (result === "Lost" || result === "Stalemate") {
                            memberStats[defId].timesDefended++;
                            memberStats[defId].defendedSuccessfully++;
                        } else {
                            memberStats[defId].timesBeaten++;
                            if (isEnemyWarAttack) {
                                memberStats[defId].respectLeaked += Number(atk.respect_gain || 0);
                            }
                        }
                        // Total times farmed/hit in logs
                        memberStats[defId].timesFarmed = memberStats[defId].timesHit;
                    }

                    // Fallback for hitsMade if rankedwarreport was not available
                    if (atk.attacker_faction == myId && atk.defender_faction == enemyId) {
                        if (atkId && memberStats[atkId] && memberStats[atkId].hitsMade === 0) {
                            if (!atk.result?.includes("Lost") && !atk.result?.includes("Stalemate")) {
                                memberStats[atkId].hitsMade++;
                                memberStats[atkId].respectEarned += Number(atk.respect_gain || 0);
                            }
                        }
                    }
                }

                if (maxTs <= fromTs) fromTs = fromTs + 1;
                else fromTs = maxTs + 1;
                if (fromTs >= warEnd) break;
                await new Promise(r => setTimeout(r, 120));
            } catch (err) {
                console.warn("[War Audit] Attacks fetch error:", err.message);
                break;
            }
        }

        // 5a. Match flights from persistent background sentinel archive
        for (const mId of Object.keys(memberStats)) {
            const archiveList = warFlightArchive[mId] || [];
            for (const session of archiveList) {
                const sStart = Number(session.start) || 0;
                const sEnd = Math.max(Number(session.end) || 0, Number(session.until) || 0);
                if (sStart && sEnd) {
                    const oStart = Math.max(warStart, sStart);
                    const oEnd = Math.min(warEnd, sEnd);
                    if (oEnd > oStart) {
                        memberStats[mId].flightSec += (oEnd - oStart);
                        memberStats[mId].flightTrips++;
                        if (session.dest) memberStats[mId].flightDestinations.push(session.dest);
                    }
                }
            }
        }

        // 5b. Match flights from FF Scouter if valid key provided
        let ffScouterEnabled = false;
        let ffScouterPremium = false;
        let ffError = null;

        const isSameAsTornKey = ffKey && userKey && ffKey.trim() === userKey.trim();
        if (ffKey && String(ffKey).trim().length > 5 && ffKey !== "null" && ffKey !== "undefined" && !isSameAsTornKey) {
            ffScouterEnabled = true;
            const memberIds = Object.keys(memberStats);
            const CHUNK_SIZE = 5;
            for (let i = 0; i < memberIds.length; i += CHUNK_SIZE) {
                const chunk = memberIds.slice(i, i + CHUNK_SIZE);
                await Promise.all(chunk.map(async (mId) => {
                    if (ffError) return;
                    try {
                        const ffUrl = `https://ffscouter.com/api/v1/player-flights?key=${encodeURIComponent(ffKey)}&target=${encodeURIComponent(mId)}`;
                        const fRes = await fetch(ffUrl, { signal: AbortSignal.timeout(5000), headers: { 'Accept': 'application/json' } });
                        const fData = await fRes.json();
                        if (fData.error) {
                            if (fData.code === 19) ffError = "Active premium subscription required to use this endpoint";
                            else ffError = fData.error;
                            return;
                        }
                        ffScouterPremium = true;
                        const allFlights = (fData.recent_flights || []).concat(fData.current ? [fData.current] : []);
                        for (const fl of allFlights) {
                            let takeoff = Number(fl.takeoff_time) || 0;
                            let landing = Number(fl.approx_landing_time || fl.latest_arrival_time || fl.earliest_arrival_time || 0);
                            if (!takeoff && landing) takeoff = landing - 7200;
                            if (takeoff && !landing) landing = takeoff + 7200;
                            if (takeoff > 0 && landing > 0) {
                                const oStart = Math.max(warStart, takeoff);
                                const oEnd = Math.min(warEnd, landing);
                                if (oEnd > oStart) {
                                    memberStats[mId].flightSec += (oEnd - oStart);
                                    memberStats[mId].flightTrips++;
                                    if (fl.status_description) memberStats[mId].flightDestinations.push(fl.status_description);
                                }
                            }
                        }
                    } catch (e) {}
                }));
                if (ffError) break;
                if (i + CHUNK_SIZE < memberIds.length) await new Promise(r => setTimeout(r, 120));
            }
        }

        // 5c. Accurate Trip Clustering from Complete Overseas Attack Timestamps
        for (const m of Object.values(memberStats)) {
            if (m.overseasTimestamps && m.overseasTimestamps.length > 0) {
                m.overseasTimestamps.sort((a, b) => a - b);
                let trips = 0;
                let flightSec = 0;
                let tripStart = m.overseasTimestamps[0];
                let lastTs = m.overseasTimestamps[0];

                for (let i = 1; i < m.overseasTimestamps.length; i++) {
                    const cur = m.overseasTimestamps[i];
                    if (cur - lastTs > 4 * 3600) {
                        const tripDuration = (lastTs - tripStart) + (3 * 3600); // 3h round-trip flight buffer
                        flightSec += Math.min(tripDuration, 8 * 3600); // realistic max 8h per foreign trip
                        trips++;
                        tripStart = cur;
                    }
                    lastTs = cur;
                }
                const tripDuration = (lastTs - tripStart) + (3 * 3600);
                flightSec += Math.min(tripDuration, 8 * 3600);
                trips++;

                // Logical sanity check: if a player was hit dozens of times on the ground in Torn City,
                // their flight time cannot logically exceed the remaining free time in the war.
                const groundCombatDowntime = (m.timesHit || 0) * 900; // at least 15m ground presence per hit taken
                const maxPossibleAirtime = Math.max(0, warDuration - groundCombatDowntime);
                flightSec = Math.min(flightSec, maxPossibleAirtime);

                if (flightSec > m.flightSec) {
                    m.flightSec = Math.min(flightSec, warDuration);
                    m.flightTrips = Math.max(m.flightTrips, trips);
                    m.flightDestinations.push("Overseas Operations");
                }
            }
        }

        // 6. Grade and finalize member list
        const processedMembers = Object.values(memberStats).map(m => {
            const airHours = (m.flightSec / 3600).toFixed(1);
            const airMins = Math.round(m.flightSec / 60);
            const hoursPart = Math.floor(airMins / 60);
            const minsPart = airMins % 60;
            const airtimeFormatted = hoursPart > 0 ? `${hoursPart}h ${minsPart}m` : `${minsPart}m`;
            const flightPct = Math.min(100, Math.round((m.flightSec / warDuration) * 100));
            const netScore = parseFloat((m.respectEarned - m.respectLeaked).toFixed(1));

            // Grading algorithm based on actual war performance, net respect impact, and survival
            let grade = 'B';
            let gradeLabel = 'Active Combatant';
            let gradeColor = '#00cec9';

            if (m.hitsMade === 0 && m.timesHit === 0 && m.flightSec === 0) {
                grade = '—';
                gradeLabel = 'Sat Out';
                gradeColor = '#747d8c';
            } else if (netScore > 0) {
                // USER RULE: Any positive net impact is AT LEAST Grade B!
                if (m.timesHit <= 4 && (flightPct >= 15 || m.hitsMade >= 15)) {
                    grade = 'S';
                    gradeLabel = 'Ghost MVP';
                    gradeColor = '#2ed573';
                } else if (netScore >= 200 || m.hitsMade >= 50) {
                    grade = 'A';
                    gradeLabel = 'War Carry';
                    gradeColor = '#2ed573';
                } else if (netScore >= 50 || m.timesHit <= 10) {
                    grade = 'A';
                    gradeLabel = 'Net-Positive';
                    gradeColor = '#2ed573';
                } else {
                    grade = 'B';
                    gradeLabel = 'Positive Asset';
                    gradeColor = '#00cec9';
                }
            } else {
                // Negative or zero net impact
                if (m.timesHit === 0) {
                    if (flightPct > 0) {
                        grade = 'A';
                        gradeLabel = 'Safe Pilot';
                        gradeColor = '#2ed573';
                    } else {
                        grade = '—';
                        gradeLabel = 'Non-Combatant';
                        gradeColor = '#747d8c';
                    }
                } else if (m.timesHit <= 5 && netScore >= -30) {
                    grade = 'B';
                    gradeLabel = 'Light Target';
                    gradeColor = '#ffa502';
                } else if (m.timesHit <= 15) {
                    grade = 'C';
                    gradeLabel = 'Combat Defender';
                    gradeColor = '#ff7f50';
                } else if (m.timesHit <= 30 && m.hitsMade > 0) {
                    grade = 'D';
                    gradeLabel = 'Frequent Target';
                    gradeColor = '#ff6348';
                } else {
                    grade = 'F';
                    gradeLabel = 'Heavily Farmed';
                    gradeColor = '#ff4757';
                }
            }

            return {
                ...m,
                airHours: parseFloat(airHours),
                airtimeFormatted,
                flightPct,
                netScore,
                respectLeaked: parseFloat(m.respectLeaked.toFixed(1)),
                respectEarned: parseFloat(m.respectEarned.toFixed(1)),
                grade,
                gradeLabel,
                gradeColor
            };
        });

        // Sort: Least hit first, then highest airtime, then highest hits made
        processedMembers.sort((a, b) => {
            if (a.timesHit !== b.timesHit) return a.timesHit - b.timesHit;
            if (b.flightPct !== a.flightPct) return b.flightPct - a.flightPct;
            return b.hitsMade - a.hitsMade;
        });

        // 7. KPIs
        let totalAirtimeSec = 0;
        let ghostCount = 0;
        let totalFarmedHits = 0;
        let totalWarHitsTaken = 0;
        let totalOutsideHitsTaken = 0;
        let totalRespectLeaked = 0;
        let totalHitsMade = 0;
        let totalRespectEarned = 0;

        for (const m of processedMembers) {
            totalAirtimeSec += m.flightSec;
            if (m.timesHit <= 10 && (m.airHours >= 15 || m.grade === 'S')) ghostCount++;
            totalFarmedHits += m.timesHit;
            totalWarHitsTaken += (m.warHitsTaken || 0);
            totalOutsideHitsTaken += (m.outsideHitsTaken || 0);
            totalRespectLeaked += m.respectLeaked;
            totalHitsMade += m.hitsMade;
            totalRespectEarned += m.respectEarned;
        }

        const totalAirHours = parseFloat((totalAirtimeSec / 3600).toFixed(1));
        const durationHours = parseFloat((warDuration / 3600).toFixed(1));
        const netWarScore = parseFloat((totalRespectEarned - totalRespectLeaked).toFixed(1));
        const totalWarActions = totalHitsMade + totalFarmedHits;

        const responsePayload = {
            success: true,
            v: AUDIT_VERSION,
            war: {
                id: targetWarId,
                enemyName,
                enemyId,
                ourScore,
                theirScore,
                start: warStart,
                end: warEnd,
                durationHours: parseFloat(durationHours),
                isOngoing,
                winner: selectedWarInfo.war.winner || 0
            },
            kpis: {
                totalAirHours: parseFloat(totalAirHours),
                ghostCount,
                totalFarmedHits,
                totalWarHitsTaken,
                totalOutsideHitsTaken,
                totalRespectLeaked: parseFloat(totalRespectLeaked.toFixed(1)),
                totalHitsMade,
                totalRespectEarned: parseFloat(totalRespectEarned.toFixed(1)),
                netWarScore,
                totalWarActions
            },
            ffScouter: {
                enabled: ffScouterEnabled,
                premium: ffScouterPremium,
                error: ffError
            },
            members: processedMembers
        };

        warAuditCache[cacheKey] = {
            timestamp: Date.now(),
            data: responsePayload
        };

        if (!isOngoing) {
            warAuditArchive[targetWarId] = responsePayload;
            saveToMongo();
        }

        res.json(responsePayload);
    } catch (e) {
        console.error("[War Flight Audit Error]:", e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/dashboard-data', async (req, res) => {
    const userKey = (req.headers['x-api-key'] || req.query.apiKey);
    const ffKey = (req.headers['x-ff-key'] || req.query.ffKey) || null;
    try {
        await verifySubscription(userKey);
        const isPremium = (ffKey && ffKey !== "null" && ffKey.trim().length > 10);

        const userInfo = await getUserFactionInfo(userKey);
        let targetFacId = (req.query.factionId || req.headers['x-faction-id'])
            || userInfo?.facId
            || discordConfig.factionId
            || "52355";
        let basicResp = await fetch(`https://api.torn.com/faction/${targetFacId}?selections=basic&key=${userKey}`);
        let basicData = await basicResp.json();
        if (basicData.error && basicData.error.code === 6) {
            basicResp = await fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`);
            basicData = await basicResp.json();
        }
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
            correctFacId = userData.faction?.faction_id ? userData.faction.faction_id.toString() : null;
            if (correctFacId && reportData.rankedwarreport.factions[correctFacId]) {
                enemyFacId = Object.keys(reportData.rankedwarreport.factions).find(id => id !== correctFacId);
            }
        }

        let myFactionWarData = correctFacId ? reportData.rankedwarreport?.factions[correctFacId] : null;
        if (!myFactionWarData) {
            const facKeys = Object.keys(reportData.rankedwarreport?.factions || {});
            if (facKeys.length >= 2) {
                correctFacId = facKeys[0];
                enemyFacId = facKeys[1];
                myFactionWarData = reportData.rankedwarreport.factions[correctFacId];
            }
        }
        if (!myFactionWarData) return res.status(400).json({ error: "War Report factions data unavailable." });

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

app.get('/api/claims', (req, res) => {
    const facId = req.query.factionId || req.headers['x-faction-id'] || '52355';
    const state = getFactionWarState(facId);
    res.json({ success: true, claims: state.claims, backups: state.backups, manualStats: state.manualStats });
});
app.post('/api/claim', (req, res) => {
    const { enemyId, playerName, factionId } = req.body;
    const facId = factionId || req.headers['x-faction-id'] || '52355';
    const state = getFactionWarState(facId);
    state.claims[enemyId] = { playerName, time: Date.now() };
    res.json({ success: true });
});
app.post('/api/unclaim', (req, res) => {
    const { enemyId, playerName, factionId } = req.body;
    const facId = factionId || req.headers['x-faction-id'] || '52355';
    const state = getFactionWarState(facId);
    if (state.claims[enemyId]?.playerName === playerName) delete state.claims[enemyId];
    res.json({ success: true });
});
app.post('/api/backup', (req, res) => {
    const { enemyId, playerName, factionId } = req.body;
    const facId = factionId || req.headers['x-faction-id'] || '52355';
    const state = getFactionWarState(facId);
    state.backups[enemyId] = { playerName, time: Date.now() };
    res.json({ success: true });
});
app.post('/api/unbackup', (req, res) => {
    const { enemyId, factionId } = req.body;
    const facId = factionId || req.headers['x-faction-id'] || '52355';
    const state = getFactionWarState(facId);
    delete state.backups[enemyId];
    res.json({ success: true });
});
app.post('/api/update-stats', (req, res) => {
    const { enemyId, stats, factionId } = req.body;
    const facId = factionId || req.headers['x-faction-id'] || '52355';
    const state = getFactionWarState(facId);
    state.manualStats[enemyId] = { stats: parseInt(stats), time: Date.now() };
    res.json({ success: true });
});

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
        const userKey = req.headers['x-api-key'] || req.query.apiKey;
        if (!userKey || userKey === "null" || userKey.trim() === "") {
            return res.status(401).json({ error: "Please enter your Torn API Key in Settings (⚙) to view your faction warboard." });
        }
        const ffKey = (req.headers['x-ff-key'] || req.query.ffKey) && (req.headers['x-ff-key'] || req.query.ffKey) !== "null" && (req.headers['x-ff-key'] || req.query.ffKey) !== "" ? (req.headers['x-ff-key'] || req.query.ffKey) : null;
        await verifySubscription(userKey);

        const isPremium = (ffKey && ffKey !== "null" && ffKey.trim().length > 10);
        const requestedFacId = req.headers['x-faction-id'] || req.query.myFactionId;
        const userInfo = await getUserFactionInfo(userKey);
        let myData = null;
        let targetMyFacId = null;

        // Step 1: If user explicitly requested a faction ID (via header or query), fetch that
        if (requestedFacId) {
            targetMyFacId = requestedFacId.toString();
            myData = await cachedTornFetch(`https://api.torn.com/faction/${targetMyFacId}?selections=basic,rankedwars,attacks&key=${userKey}`, `my_faction_${targetMyFacId}_${userKey}`, 2500);
            if (myData && myData.error && (myData.error.code === 6 || myData.error.code === 7)) {
                myData = await cachedTornFetch(`https://api.torn.com/faction/${targetMyFacId}?selections=basic,rankedwars&key=${userKey}`, `my_faction_basic_${targetMyFacId}_${userKey}`, 2500);
            }
        }

        // Step 2: If no explicit faction requested or fetch failed, query user's personal /faction/ endpoint.
        // Torn API will ALWAYS return the faction that this specific user belongs to!
        if (!myData || myData.error) {
            myData = await cachedTornFetch(`https://api.torn.com/faction/?selections=basic,rankedwars,attacks&key=${userKey}`, `my_faction_personal_${userKey}`, 2500);
            if (myData && myData.ID) {
                targetMyFacId = myData.ID.toString();
            }
        }

        // Step 3: If personal /faction/ returned error 6 (caller is factionless),
        // fallback to server default faction (Spider-Verse 52355)
        if (!myData || (myData.error && myData.error.code === 6)) {
            targetMyFacId = discordConfig.factionId || "52355";
            myData = await cachedTornFetch(`https://api.torn.com/faction/${targetMyFacId}?selections=basic,rankedwars,attacks&key=${userKey}`, `my_faction_${targetMyFacId}_${userKey}`, 2500);
            if (myData && myData.error && (myData.error.code === 6 || myData.error.code === 7)) {
                myData = await cachedTornFetch(`https://api.torn.com/faction/${targetMyFacId}?selections=basic,rankedwars&key=${userKey}`, `my_faction_basic_${targetMyFacId}_${userKey}`, 2500);
            }
        }

        const myFacId = myData?.ID ? myData.ID.toString() : (targetMyFacId || "52355");
        const fState = getFactionWarState(myFacId);

        // Resilience: If myData hit rate limit or transient error, serve last known good payload for THIS faction ONLY
        if (!myData || myData.error || !myData.members || Object.keys(myData.members).length === 0) {
            if (lastGoodWarboardByFaction[myFacId]) {
                return res.json(lastGoodWarboardByFaction[myFacId]);
            } else if (lastGoodWarboardPayload && String(myFacId) === "52355") {
                return res.json(lastGoodWarboardPayload);
            } else {
                return res.status(500).json({ error: "Unable to retrieve faction data. Please verify your API key has faction access." });
            }
        }

        // Cache valid responses for THIS faction ID
        if (myData && myData.members && Object.keys(myData.members).length > 0 && myData.ID) {
            lastGoodWarboardByFaction[myFacId] = myData;
        }

        let enemyId = (req.headers['x-enemy-id'] || req.query.enemyFaction) || null;
        if (!enemyId) enemyId = autoDetectEnemyFaction(myData);
        let enemyDataResult = { members: {} };
        if (enemyId) { 
            enemyDataResult = await cachedTornFetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${getNextApiKey()||userKey}`, `enemy_faction_${enemyId}`, 2500); 
        }

        let activeWar = null;
        if (myData.rankedwars) {
            activeWar = Object.values(myData.rankedwars).find(w => w.war && w.war.winner === 0);
        }
        let myWarMembers = activeWar && myData.ID ? (activeWar.factions[myData.ID.toString()]?.members || {}) : {};
        let enemyWarMembers = activeWar && enemyId ? (activeWar.factions[enemyId]?.members || {}) : {};

        // Peacetime: Extract most recent completed ranked war
        let recentWarInfo = null;
        let recentWarMembers = {};
        if (!activeWar && myData.rankedwars) {
            const sortedWars = Object.entries(myData.rankedwars)
                .map(([wId, wData]) => ({ id: wId, ...wData }))
                .sort((a, b) => (b.war?.start || 0) - (a.war?.start || 0));

            if (sortedWars.length > 0) {
                const rw = sortedWars[0];
                const rwFactions = Object.keys(rw.factions || {});
                const enemyIdFromWar = rwFactions.find(f => f !== myFacId) || (rwFactions[0] !== myFacId ? rwFactions[0] : rwFactions[1]);

                const ourScore = rw.factions[myFacId]?.score || 0;
                const theirScore = (enemyIdFromWar && rw.factions[enemyIdFromWar]) ? (rw.factions[enemyIdFromWar].score || 0) : 0;
                const winner = rw.war?.winner || 0;
                const isWon = winner === Number(myFacId) || ourScore > theirScore;
                recentWarMembers = rw.factions[myFacId]?.members || {};

                recentWarInfo = {
                    id: rw.id,
                    enemyName: enemyDataResult?.name || (enemyIdFromWar && rw.factions[enemyIdFromWar]?.name ? rw.factions[enemyIdFromWar].name : 'Enemy Faction'),
                    enemyId: enemyIdFromWar,
                    ourScore,
                    theirScore,
                    winner,
                    isWon,
                    start: rw.war?.start || 0,
                    end: rw.war?.end || 0,
                    target: rw.war?.target || 0,
                    margin: Math.abs(ourScore - theirScore)
                };

                if (warAuditArchive[rw.id]) {
                    recentWarInfo.audited = true;
                    recentWarInfo.totalHitsMade = warAuditArchive[rw.id].kpis?.totalHitsMade || 0;
                    recentWarInfo.totalFarmedHits = warAuditArchive[rw.id].kpis?.totalFarmedHits || 0;
                    recentWarInfo.totalWarHitsTaken = warAuditArchive[rw.id].kpis?.totalWarHitsTaken || warAuditArchive[rw.id].kpis?.totalFarmedHits || 0;
                    recentWarInfo.totalOutsideHitsTaken = warAuditArchive[rw.id].kpis?.totalOutsideHitsTaken || 0;
                    recentWarInfo.netWarScore = warAuditArchive[rw.id].kpis?.netWarScore || 0;
                }
            }
        }

        // If war is active, trigger backfill from exact start if needed, and process incoming attack logs
        if (activeWar && activeWar.war && myData.ID) {
            let warStart = activeWar.war.start;
            let warEnd = activeWar.war.end || 0;

            if (fState.activeWarId !== warStart) {
                fState.activeWarId = warStart;
                fState.activeWarEnd = warEnd;
                fState.liveWarHits = {};
                fState.liveOutsideHits = {};
                fState.liveAssists = {};
                fState.liveWarDefendsWon = {};
                fState.liveOutsideDefendsWon = {};
                fState.liveWarHitsTaken = {};
                fState.liveOutsideHitsTaken = {};
                fState.hasBackfilledWar = false;
                fState.processedAttackIds.clear();
                backfillWarDefends(userKey, myFacId, warStart, enemyId, warEnd);
            } else if (!fState.hasBackfilledWar && !fState.isBackfillingWar) {
                backfillWarDefends(userKey, myFacId, warStart, enemyId, warEnd);
            }

            if (myData.attacks && typeof myData.attacks === 'object') {
                for (let atk of Object.values(myData.attacks)) {
                    processWarAttack(atk, myFacId, enemyId, warStart, warEnd);
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
                let est = (spyDatabase[id] && spyDatabase[id].total) ? spyDatabase[id].total : (fState.manualStats[id]?.stats !== undefined ? fState.manualStats[id].stats : (statsCache[id]?.stats !== undefined ? statsCache[id].stats : (isPremium ? "Scanning..." : "🔒 Requires FF Scouter")));
                
                const isTraveling = m.status?.state === "Traveling" || m.status?.description?.includes("Traveling");
                let finalUntil = m.status?.until; let finalLandingTime = null; let needsFfScouterForFlights = false;
                if (isTraveling) { if (flightCache[id]?.landingTime) { finalLandingTime = flightCache[id].landingTime; finalUntil = finalLandingTime; } else { if (!isPremium) needsFfScouterForFlights = true; } }
                
                let warMemberData = isEnemy ? enemyWarMembers[id] : (activeWar ? myWarMembers[id] : recentWarMembers[id]);
                let baseWarAttacks = warMemberData ? (warMemberData.attacks || 0) : 0;
                let score = warMemberData ? (warMemberData.score || 0) : 0;
                let baseAssists = warMemberData ? (warMemberData.assists || 0) : 0;
                
                // Peacetime combat audit enrichment for friendly roster
                let auditMember = (!isEnemy && !activeWar && recentWarInfo?.id && warAuditArchive[recentWarInfo.id]?.members)
                    ? warAuditArchive[recentWarInfo.id].members.find(am => am.id.toString() === id.toString())
                    : null;

                let warAttacks = activeWar ? Math.max(baseWarAttacks, fState.liveWarHits[id] || 0) : (auditMember ? auditMember.hitsMade : baseWarAttacks);
                let assists = Math.max(baseAssists, fState.liveAssists[id] || 0);
                let outsideAttacks = fState.liveOutsideHits[id] || 0;

                let warHitsTaken = activeWar ? (fState.liveWarHitsTaken[id] || 0) : (auditMember ? (auditMember.warHitsTaken || auditMember.timesHit || 0) : 0);
                let outsideHitsTaken = activeWar ? (fState.liveOutsideHitsTaken[id] || 0) : (auditMember ? (auditMember.outsideHitsTaken || 0) : 0);
                let hitsTaken = warHitsTaken + outsideHitsTaken;

                let warDefendsWon = activeWar ? (fState.liveWarDefendsWon[id] || 0) : (auditMember ? (auditMember.timesDefended || 0) : 0);
                let outsideDefendsWon = fState.liveOutsideDefendsWon[id] || 0;
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
                    claimedBy: isEnemy ? fState.claims[id]?.playerName || null : null, 
                    needsBackup: isEnemy ? fState.backups[id]?.playerName || null : null, 
                    estStats: est, 
                    intelScore: isEnemy ? computeWarIntel({ id, state: m.status?.state, until: finalUntil, onlineStatus: m.last_action?.status || "Offline", estStats: typeof est === 'number' ? est : null }, statsCache) : null, 
                    isManual: !!fState.manualStats[id], 
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

        if (friendlyMembers.length === 0) {
            if (lastGoodWarboardByFaction[myFacId]) {
                return res.json(lastGoodWarboardByFaction[myFacId]);
            }
            if (lastGoodWarboardPayload && String(myFacId) === "52355") {
                return res.json(lastGoodWarboardPayload);
            }
        }

        const payload = {
            friendly: friendlyMembers,
            enemy: enemyMembers,
            detectedEnemyId: enemyId,
            premiumActive: isPremium,
            syncStatus: fState.syncStatus,
            warInfo: activeWar ? {
                active: true,
                start: activeWar.war?.start || 0,
                end: activeWar.war?.end || 0,
                target: activeWar.war?.target || 0,
                myFaction: {
                    id: myData?.ID || myFacId,
                    name: myData?.name || (myData?.ID ? "Faction #" + myData.ID : "Spider-Verse"),
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
                    id: myData?.ID || myFacId,
                    name: myData?.name || (myData?.ID ? "Faction #" + myData.ID : "Spider-Verse"),
                    chain: myData?.chain?.current || 0,
                    chainMax: myData?.chain?.maximum || 100,
                    chainTimeout: myData?.chain?.timeout || 0,
                    chainModifier: myData?.chain?.modifier || 1
                },
                recentWar: recentWarInfo,
                scoutedEnemy: enemyId ? {
                    id: enemyId,
                    name: enemyDataResult?.name || "Opponent Faction",
                    memberCount: Object.keys(enemyDataResult?.members || {}).length
                } : null
            }
        };

        if (friendlyMembers.length > 0) {
            lastGoodWarboardByFaction[myFacId] = payload;
            if (String(myFacId) === "52355") {
                lastGoodWarboardPayload = payload;
                try {
                    fs.writeFileSync(WARBOARD_BACKUP_FILE, JSON.stringify(payload));
                } catch(e) {}
            }
        }

        res.json(payload);
    } catch (err) {
        if (targetMyFacId && lastGoodWarboardByFaction[targetMyFacId]) {
            return res.json(lastGoodWarboardByFaction[targetMyFacId]);
        }
        if (lastGoodWarboardPayload) {
            return res.json(lastGoodWarboardPayload);
        }
        res.status(403).json({ error: err.message });
    }
});
// ── Faction Portal Access Control ──────────────────────────────────────────
app.post('/api/auth/verify-faction-access', async (req, res) => {
    try {
        const apiKey = (req.body.apiKey || '').trim();
        if (!apiKey) return res.status(400).json({ success: false, authorized: false, reason: "Torn API Key is required." });

        const targetFactionId = String(discordConfig.factionId || adminFactionId || '52355');

        const tornRes = await fetch(`https://api.torn.com/user/?selections=profile&key=${apiKey}&timestamp=${Date.now()}`, {
            signal: AbortSignal.timeout(9000)
        });
        const data = await tornRes.json();

        if (data.error) {
            return res.status(400).json({ success: false, authorized: false, reason: data.error.error || "Invalid Torn API key." });
        }

        const userFacId = String(data.faction?.faction_id || '0');
        const userFacName = data.faction?.faction_name || 'None';
        const isMember = userFacId === targetFactionId;

        if (!isMember) {
            return res.json({
                success: true,
                authorized: false,
                reason: `You are currently in "${userFacName}" [ID: ${userFacId}]. Only active members of Spider-Verse [${targetFactionId}] are authorized to enter.`,
                player: {
                    id: data.player_id,
                    name: data.name,
                    factionName: userFacName,
                    factionId: userFacId
                }
            });
        }

        return res.json({
            success: true,
            authorized: true,
            player: {
                id: data.player_id,
                name: data.name,
                level: data.level,
                role: data.faction?.position || 'Member',
                factionId: userFacId,
                factionName: userFacName
            }
        });
    } catch(err) {
        return res.status(500).json({ success: false, authorized: false, reason: err.message });
    }
});

// ── Organized Crime (OC) Configuration & Testing ────────────────────────────
app.get('/api/oc-config', (req, res) => {
    res.json({
        globalChannelId: ocConfig.globalChannelId || "",
        roleId: ocConfig.roleId || "",
        alertPlanned: ocConfig.alertPlanned !== false,
        alertUpcoming: ocConfig.alertUpcoming !== false,
        upcomingMinutes: ocConfig.upcomingMinutes || 30,
        alertReady: ocConfig.alertReady !== false,
        alertDelayed: ocConfig.alertDelayed !== false,
        alertCompleted: ocConfig.alertCompleted !== false
    });
});

app.post('/api/save-oc-config', (req, res) => {
    const { 
        globalChannelId, 
        roleId, 
        alertPlanned, 
        alertUpcoming, 
        upcomingMinutes, 
        alertReady, 
        alertDelayed, 
        alertCompleted 
    } = req.body;

    if (globalChannelId !== undefined) ocConfig.globalChannelId = String(globalChannelId).trim();
    if (roleId !== undefined) ocConfig.roleId = String(roleId).trim();
    if (alertPlanned !== undefined) ocConfig.alertPlanned = !!alertPlanned;
    if (alertUpcoming !== undefined) ocConfig.alertUpcoming = !!alertUpcoming;
    if (upcomingMinutes !== undefined) ocConfig.upcomingMinutes = Math.max(5, parseInt(upcomingMinutes, 10) || 30);
    if (alertReady !== undefined) ocConfig.alertReady = !!alertReady;
    if (alertDelayed !== undefined) ocConfig.alertDelayed = !!alertDelayed;
    if (alertCompleted !== undefined) ocConfig.alertCompleted = !!alertCompleted;

    saveOcConfig();
    res.json({ success: true, ocConfig });
});

app.post('/api/test-oc-alert', async (req, res) => {
    try {
        const { type, channelId } = req.body;
        const targetChan = channelId || ocConfig.globalChannelId || discordConfig.globalChannelId;
        const token = discordConfig.globalBotToken;

        if (!targetChan) return res.status(400).json({ error: "No Discord channel configured for OC alerts." });
        if (!token) return res.status(400).json({ error: "No Discord Bot Token configured." });

        let embed = null;
        let mention = ocConfig.roleId ? `<@&${ocConfig.roleId}>` : "";
        const now = Math.floor(Date.now() / 1000);

        if (type === 'upcoming') {
            embed = {
                title: "⏳ OC Upcoming: Bomb Threat [TEST]",
                description: `Crime is scheduled to be ready in **<t:${now + 1800}:R>** (<t:${now + 1800}:t>)!\n\n` +
                             `⚠️ **Attention Team Members:** Please stay out of hospital and wrap up foreign travel:\n` +
                             `• [Owen777 [3490493]](https://www.torn.com/profiles.php?XID=3490493)\n` +
                             `• [MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)\n\n` +
                             `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                color: 0xffa502,
                footer: { text: "F.R.I.D.A.Y • Organized Crime Intelligence" }
            };
        } else if (type === 'delayed') {
            embed = {
                title: "🚨 OC Delayed: Kidnapping [TEST]",
                description: `Countdown reached zero, but **team cannot launch** because participant(s) are unavailable:\n\n` +
                             `• ❌ **[Owen777 [3490493]](https://www.torn.com/profiles.php?XID=3490493)**: **Hospitalized** (in hospital · Free <t:${now + 450}:R>)\n\n` +
                             `Team members must med out, bust, or land before the crime can be initiated.\n\n` +
                             `👉 [Open Faction Crimes Tab](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                color: 0xff4757,
                footer: { text: "F.R.I.D.A.Y • Organized Crime Intelligence" }
            };
        } else if (type === 'planned') {
            embed = {
                title: "📋 OC Scheduled: Planned Robbery [TEST]",
                description: `A new Organized Crime has been scheduled for **Spider-Verse**!\n\n` +
                             `**Target Ready Time:** <t:${now + 86400}:F> (<t:${now + 86400}:R>)\n` +
                             `**Planned By:** [Owen777 [3490493]](https://www.torn.com/profiles.php?XID=3490493)\n\n` +
                             `**Assigned Roster:**\n` +
                             `• [Owen777 [3490493]](https://www.torn.com/profiles.php?XID=3490493)\n` +
                             `• [MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)\n\n` +
                             `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                color: 0x70a1ff,
                footer: { text: "F.R.I.D.A.Y • Organized Crime Intelligence" }
            };
        } else {
            embed = {
                title: "🟢 OC Ready to Launch: Robbing of a Money Train [TEST]",
                description: `All team members are in Torn City and ready! Crime can now be initiated by the planner.\n\n` +
                             `**Team:**\n` +
                             `• [Owen777 [3490493]](https://www.torn.com/profiles.php?XID=3490493)\n` +
                             `• [MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)\n\n` +
                             `👉 [Initiate Organized Crime](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                color: 0x2ed573,
                footer: { text: "F.R.I.D.A.Y • Organized Crime Intelligence" }
            };
        }

        const sendResult = await sendChannelMessage(token, targetChan, embed, mention);
        if (sendResult && !sendResult.success) {
            return res.status(400).json({ error: sendResult.error || "Failed to deliver message to Discord." });
        }
        res.json({ success: true, message: `Test ${type || 'ready'} alert sent to channel ${targetChan}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
        const key = req.headers['x-api-key'] || req.query.apiKey;
        if (!key || key === "null" || key.trim() === "") return res.status(401).json({ error: "Missing API key" });

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
        globalBotToken: discordConfig.globalBotToken || "",
        globalChannelId: discordConfig.globalChannelId || "",
        cpm: discordConfig.cpm || 12
    });
});

app.post('/api/master-config', (req, res) => {
    const { discordWebhook, globalToggles, enemyId } = req.body;
    
    // Save to discord config safely: only set globalChannelId if numeric, not if it's a bot token
    if (discordWebhook !== undefined && typeof discordWebhook === 'string') {
        const clean = discordWebhook.trim();
        if (/^\d{15,22}$/.test(clean)) {
            discordConfig.globalChannelId = clean;
        } else if (clean.includes('.') && clean.length > 30) {
            if (!discordConfig.globalBotToken) discordConfig.globalBotToken = clean;
        } else if (clean.startsWith('http')) {
            discordConfig.webhookUrl = clean;
        }
    }
    if (enemyId !== undefined) discordConfig.enemyFacId = enemyId;
    
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
    
    res.json({ success: true });
});

app.post('/api/sync-configs', (req, res) => {
    const { company, discord, oc, market, apiKey, globalBotToken, globalChannelId, ffKey, tsKey, enemyFacId, myName, cpm } = req.body;
    if (company) { companyConfig = { ...companyConfig, ...company }; saveCompanyConfig(); }
    if (discord) {
        const safeDiscord = { ...discord };
        if (safeDiscord.globalChannelId && (safeDiscord.globalChannelId.includes('.') || /[a-zA-Z]/.test(safeDiscord.globalChannelId))) {
            delete safeDiscord.globalChannelId;
        }
        discordConfig = { ...discordConfig, ...safeDiscord };
        saveDiscordConfig();
    }
    if (oc) { ocConfig = { ...ocConfig, ...oc }; saveOcConfig(); }
    if (market) { marketConfig = { ...marketConfig, ...market }; saveMarketConfig(); }
    
    if (globalBotToken) discordConfig.globalBotToken = String(globalBotToken).trim();
    if (globalChannelId) {
        const cleanChan = String(globalChannelId).trim();
        if (/^\d{15,22}$/.test(cleanChan)) {
            discordConfig.globalChannelId = cleanChan;
        }
    }
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
        const userKey = req.headers['x-api-key'] || req.query.apiKey;
        if (!userKey || userKey === "null" || userKey.trim() === "") return res.status(401).json({ error: "No API key provided. Please add your API key in Settings." });

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

app.get('/api/weav3r-price/:itemId', async (req, res) => {
    const { itemId } = req.params;
    if (!itemId) return res.status(400).json({ error: "Item ID is required" });
    try {
        const data = await fetchWeav3rMarketplace(itemId);
        if (!data) return res.status(404).json({ error: "Could not fetch marketplace data from Weav3r.dev" });
        res.json({ success: true, data });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── War Bounty Tracker ────────────────────────────────────────────────────────
const WAR_BOUNTIES_FILE = path.join(__dirname, 'data', 'war_bounties.json');

function loadWarBountiesHistory() {
    try {
        if (!fs.existsSync(path.dirname(WAR_BOUNTIES_FILE))) {
            fs.mkdirSync(path.dirname(WAR_BOUNTIES_FILE), { recursive: true });
        }
        if (fs.existsSync(WAR_BOUNTIES_FILE)) {
            return JSON.parse(fs.readFileSync(WAR_BOUNTIES_FILE, 'utf8'));
        }
    } catch(e) {}
    return { events: {} };
}

function saveWarBountiesHistory(data) {
    try {
        if (!fs.existsSync(path.dirname(WAR_BOUNTIES_FILE))) {
            fs.mkdirSync(path.dirname(WAR_BOUNTIES_FILE), { recursive: true });
        }
        fs.writeFileSync(WAR_BOUNTIES_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch(e) {}
}

app.get('/api/war-bounties', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey || apiKey === "null" || apiKey.trim() === "") return res.status(401).json({ error: "API Key required" });

    try {
        // 1. Fetch current ranked war details
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const facData = await facRes.json();
        
        let warStart = 0;
        let warEnd = 0;
        let activeWar = null;

        if (facData.rankedwars) {
            activeWar = Object.values(facData.rankedwars).find(w => w.war && (w.war.winner === 0 || !w.war.end || w.war.end === 0));
            if (!activeWar) {
                const sorted = Object.values(facData.rankedwars).filter(w => w.war && w.war.start).sort((a, b) => (b.war.start || 0) - (a.war.start || 0));
                activeWar = sorted[0];
            }
            if (activeWar && activeWar.war) {
                warStart = activeWar.war.start || 0;
                warEnd = activeWar.war.end || 0;
            }
        }

        let enemyName = "Enemy Faction";
        if (activeWar && activeWar.factions) {
            const myId = (facData.ID || facData.faction_id || 52355).toString();
            const enemyEntry = Object.entries(activeWar.factions).find(([fid]) => fid.toString() !== myId);
            if (enemyEntry && enemyEntry[1]?.name) enemyName = enemyEntry[1].name;
        }
        const isOngoingWar = !!activeWar && (!activeWar.war?.winner || activeWar.war?.winner === 0);
        const warTitle = isOngoingWar ? `vs ${enemyName} (Active War)` : `vs ${enemyName} (Last War)`;

        if (!warStart) warStart = Math.floor(Date.now() / 1000) - (7 * 86400);

        // 2. Fetch personalstats (lifetime counts)
        const userRes = await fetch(`https://api.torn.com/user/?selections=basic,personalstats&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const userData = await userRes.json();
        if (userData.error) throw new Error(userData.error.error || "Torn API error");

        // 3. Load stored history
        const bountyHistory = loadWarBountiesHistory();
        if (!bountyHistory.events) bountyHistory.events = {};
        if (!bountyHistory.placed) bountyHistory.placed = {};

        // Helper: parse a single event text for bounty claim or placement
        function parseBountyEvent(eId, ev) {
            const text = ev.event || ev.message || ev.text || '';
            const ts = ev.timestamp || 0;
            if (!text || ts < warStart || (warEnd && ts > warEnd)) return;

            const isClaim = text.includes('bounty reward');
            const isPlaced = /placed a?\s*\$[0-9,]+\s+bounty/i.test(text) ||
                             /you placed a?\s*bounty/i.test(text) ||
                             (text.toLowerCase().includes('bounty') && text.toLowerCase().includes('placed'));

            const amountMatch = text.match(/\$([0-9,]+)\s+bounty/i);
            const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, '')) : 0;
            const playerLinks = [...text.matchAll(/profiles\.php\?XID=(\d+)[^>]*>([^<]+)<\/a>/g)];

            if (isClaim) {
                let targetName = 'Unknown Target', targetId = null;
                let hunterName = 'Someone (Anonymous)', hunterId = null;
                if (playerLinks.length === 2) {
                    hunterId = playerLinks[0][1]; hunterName = playerLinks[0][2];
                    targetId = playerLinks[1][1]; targetName = playerLinks[1][2];
                } else if (playerLinks.length === 1) {
                    targetId = playerLinks[0][1]; targetName = playerLinks[0][2];
                }
                if (targetName && targetId) playerNameCache[targetId.toString()] = targetName;
                const key = `${ts}_${targetId}_${amount}`;
                bountyHistory.events[key] = { key, eventId: eId, timestamp: ts, date: new Date(ts * 1000).toISOString(), hunterName, hunterId, targetName, targetId, amount, rawText: text };
            }

            if (isPlaced) {
                let targetName = 'Unknown', targetId = null;
                if (playerLinks.length > 0) {
                    targetId = playerLinks[playerLinks.length - 1][1];
                    targetName = playerLinks[playerLinks.length - 1][2];
                }
                const key = `placed_${ts}_${targetId}_${amount}`;
                bountyHistory.placed[key] = { key, eventId: eId, timestamp: ts, targetName, targetId, amount, rawText: text };
            }
        }

        // 4. Paginate Torn API v2 events (works with Limited Access & returns up to 100 events per page)
        let toTs = Math.floor(Date.now() / 1000);
        let pagesScanned = 0;
        let totalScanned = 0;
        const MAX_EVENT_PAGES = 10;
        let reachedWarStart = false;

        while (pagesScanned < MAX_EVENT_PAGES && !reachedWarStart) {
            try {
                const v2Url = `https://api.torn.com/v2/user/events?key=${apiKey}&to=${toTs}`;
                const evRes = await fetch(v2Url, { signal: AbortSignal.timeout(8000) });
                const evData = await evRes.json();
                const evList = evData.events || [];
                if (!evList.length) break;

                let oldestTs = toTs;
                for (const ev of evList) {
                    const ts = Number(ev.timestamp) || 0;
                    if (ts < oldestTs) oldestTs = ts;
                    totalScanned++;
                    parseBountyEvent(ev.id, ev);
                }

                pagesScanned++;
                if (oldestTs <= warStart || evList.length < 40) {
                    reachedWarStart = true;
                    break;
                }
                toTs = oldestTs - 1;
                await new Promise(r => setTimeout(r, 150));
            } catch (err) {
                break;
            }
        }

        // Fallback to v1 events if v2 returned nothing
        if (pagesScanned === 0) {
            try {
                const evRes = await fetch(`https://api.torn.com/user/?selections=events&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
                const evData = await evRes.json();
                for (const [eId, ev] of Object.entries(evData.events || {})) {
                    parseBountyEvent(eId, ev);
                }
            } catch(e) {}
        }

        // Save accumulated history
        saveWarBountiesHistory(bountyHistory);

        // 6. Compile results
        const placedInWar = Object.values(bountyHistory.placed).filter(e =>
            e.timestamp >= warStart && (!warEnd || e.timestamp <= warEnd)
        );
        placedInWar.sort((a, b) => b.timestamp - a.timestamp);

        const warEvents = Object.values(bountyHistory.events).filter(e =>
            e.timestamp >= warStart && (!warEnd || e.timestamp <= warEnd)
        );
        warEvents.sort((a, b) => b.timestamp - a.timestamp);

        // Placed-on leaderboard
        const placedOnMap = {};
        placedInWar.forEach(e => {
            const k = e.targetName || `Target #${e.targetId}`;
            if (!placedOnMap[k]) placedOnMap[k] = { name: e.targetName, id: e.targetId, count: 0, totalSpent: 0 };
            placedOnMap[k].count++;
            placedOnMap[k].totalSpent += e.amount || 0;
        });
        const placedOnLeaderboard = Object.values(placedOnMap).sort((a, b) => b.count - a.count || b.totalSpent - a.totalSpent);

        // Claims metrics
        let totalCashSpent = 0;
        const targetMap = {}, hunterMap = {};
        warEvents.forEach(e => {
            totalCashSpent += e.amount || 0;
            const tKey = e.targetName || `Target #${e.targetId}`;
            if (!targetMap[tKey]) targetMap[tKey] = { name: e.targetName, id: e.targetId, count: 0, totalAmount: 0 };
            targetMap[tKey].count++;
            targetMap[tKey].totalAmount += e.amount || 0;
            const hKey = e.hunterName || 'Anonymous';
            if (!hunterMap[hKey]) hunterMap[hKey] = { name: e.hunterName, id: e.hunterId, count: 0, totalEarned: 0 };
            hunterMap[hKey].count++;
            hunterMap[hKey].totalEarned += e.amount || 0;
        });
        const topTargets = Object.values(targetMap).sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);

        // Active bounties from v2
        let activeBounties = [];
        try {
            const v2Res = await fetch(`https://api.torn.com/v2/user/bounties?key=${apiKey}`, { signal: AbortSignal.timeout(5000) });
            const v2Data = await v2Res.json();
            if (v2Data && Array.isArray(v2Data.bounties)) activeBounties = v2Data.bounties;
        } catch(e) {}

        // --- ACCURATE PLACED COUNT ---
        // "Bounties placed this war" = bounties already claimed/paid out + bounties still active (not yet claimed)
        // This is the only fully accurate approach since Torn logs don't expose placement events reliably.
        const claimedCount = warEvents.length;          // Already hospitalized via your bounty
        const activeCount = activeBounties.length;      // Still live, waiting to be claimed
        const finalPlacedCount = claimedCount + activeCount;

        // Merge active bounties into placed-on list (with "(Active)" tag)
        activeBounties.forEach(b => {
            const targetName = b.name || b.target || `Player #${b.target_id || b.id}`;
            const targetId = (b.target_id || b.id || '').toString();
            const amount = b.reward || b.bounty || 0;
            const k = targetName;
            if (!placedOnMap[k]) placedOnMap[k] = { name: targetName, id: targetId, count: 0, totalSpent: 0, hasActive: true };
            placedOnMap[k].count++;
            placedOnMap[k].totalSpent += amount;
            placedOnMap[k].hasActive = true;
        });
        // Also build from claims if placedOnMap is still empty (log parsing found nothing)
        if (Object.keys(placedOnMap).length === 0) {
            warEvents.forEach(e => {
                const k = e.targetName || `Target #${e.targetId}`;
                if (!placedOnMap[k]) placedOnMap[k] = { name: e.targetName, id: e.targetId, count: 0, totalSpent: 0 };
                placedOnMap[k].count++;
                placedOnMap[k].totalSpent += e.amount || 0;
            });
        }
        const finalPlacedOnLeaderboard = Object.values(placedOnMap).sort((a, b) => b.count - a.count || b.totalSpent - a.totalSpent);

        res.json({
            success: true,
            warStart,
            warEnd,
            warActive: isOngoingWar,
            enemyName,
            warTitle,
            totalBountiesClaimed: claimedCount,
            totalCashSpent,
            bountiesPlacedInWar: finalPlacedCount,
            activeBountiesCount: activeCount,
            placedOnLeaderboard: finalPlacedOnLeaderboard,
            recentPlaced: placedInWar.slice(0, 10),
            activeBounties,
            topTargets,
            recentClaims: warEvents.slice(0, 30),
            lifetimePlaced: userData.personalstats?.bountiesplaced || 0,
            lifetimeCollected: userData.personalstats?.bountiescollected || 0,
            logPagesScanned: pagesScanned,
            totalLogEntriesScanned: totalScanned
        });
    } catch(err) {
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

    let factionId = discordConfig.factionId || dynamicFactionId || "52355";
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

        // 2. Determine Enemy Faction ID (only if actively in war)
        let enemyId = currentEnemyFacId || (getActiveRankedWar(facData) ? (discordConfig.enemyFacId || autoDetectEnemyFaction(facData)) : null);
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
    delete sanitized.links;
    delete sanitized.buttons;
    delete sanitized.targetId;
    delete sanitized.components;
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
    if (!apiKey) return { title: "⚔️ Ranked War", description: "⚠️ No Torn API Key configured on server.", color: 0xff4757 };
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars,attacks&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const facData = await facRes.json();
        if (facData.error) throw new Error(facData.error.error || "Torn API error");

        const activeWar = getActiveRankedWar(facData);
        if (!activeWar || !activeWar.factions) {
            return {
                title: "⚔️ Faction Ranked War",
                description: `🕊️ **No Active Ranked War**\n\n**${facData.name || 'Your faction'}** is not currently in an active ranked war.\n\n*When your faction enters a Ranked War, live war scores, leads, progress bars, and top hitters will appear here automatically.*`,
                color: 0x2ed573,
                footer: { text: "Spider-Verse Faction Tools • Ranked War" },
                timestamp: new Date().toISOString()
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
            title: `⚔️ ${ourName} vs ${enemyName}`,
            description: `**Started**: ${startTime} ${targetProgressStr}\n\n` +
                         `**${ourName}**: **${ourScore.toLocaleString()}** pts (${totalFriendlyHits > 0 ? `${totalFriendlyHits.toLocaleString()} hits across ${friendlyMembers.length} fighters` : `${ourScore.toLocaleString()} pts`})\n` +
                         `**${enemyName}**: **${enemyScore.toLocaleString()}** pts\n` +
                         `**Lead**: **${lead >= 0 ? '+' : ''}${lead.toLocaleString()}** pts (${isLeading ? '🟢 Winning' : '🔴 Trailing'})\n\n` +
                         `${bar} (${(ourPct * 100).toFixed(1)}%)\n`,
            color: isLeading ? 0x2ed573 : 0xff4757,
            fields: [
                { name: `🏆 Top Hitters`, value: topHitters, inline: false },
                { name: "🔗 Links", value: `[📡 Live Warboard](https://spider-verse.net) • [⚔️ Attack Screen](https://www.torn.com/factions.php?step=your#/tab=war)`, inline: false }
            ],
            footer: { text: `Ranked War • ${new Date().toUTCString()}` }
        };
    } catch (e) {
        return { title: "⚔️ Ranked War", description: `⚠️ Could not fetch war data: ${e.message}`, color: 0xff4757 };
    }
}

async function buildTargetsEmbed(apiKey) {
    if (!apiKey) {
        return {
            title: "🎯 Enemy Targets",
            description: "⚠️ No Torn API Key configured on server.",
            color: 0xff4757
        };
    }
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const facData = await facRes.json();
        if (facData.error) throw new Error(facData.error.error || "Torn API error");

        const activeWar = getActiveRankedWar(facData);
        if (!activeWar || !activeWar.factions) {
            return {
                title: "🎯 Enemy Targets",
                description: `🕊️ **No Active Ranked War**\n\n**${facData.name || 'Your faction'}** is not currently in an active ranked war.\n\n*Enemy priority targets, snipers, and hosp-releases activate automatically when a Ranked War begins.*`,
                color: 0x2ed573,
                footer: { text: "Spider-Verse Faction Tools • Enemy Targets" }
            };
        }

        const fids = Object.keys(activeWar.factions || {});
        const enemyId = fids.find(id => id !== facData.ID?.toString()) || discordConfig.enemyFacId;
        if (!enemyId) {
            return {
                title: "🎯 Enemy Targets",
                description: "⚠️ Could not identify enemy faction in the current war.",
                color: 0xffa502
            };
        }

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
                title: `🎯 ${data.name || 'Enemy'} — No Targets Available`,
                description: `All enemy members are currently in hospital, traveling, or offline.`,
                color: 0xffa502,
                footer: { text: "Enemy Target Roster" }
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
            title: `🎯 ${data.name || 'Enemy'} — Attack Targets (${available.length} Available)`,
            description: lines.join("\n"),
            color: 0xff4757,
            footer: { text: `Enemy Target Roster • ${new Date().toUTCString()}` }
        };
    } catch (e) {
        return { title: "🎯 Enemy Targets", description: `⚠️ Could not fetch enemy roster: ${e.message}`, color: 0xff4757 };
    }
}

async function buildSpyEmbed(targetQuery, apiKey) {
    if (!targetQuery) return { title: "🔍 Battle Stats Lookup", description: "Please provide a Torn Player ID or Name.", color: 0xff4757 };
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
            title: `🔍 ${playerName} — No Stats on Record`,
            description: `No spy data found in FF Scouter or the database for **${playerName}**.\n\n` +
                         `• Add a manual spy via the [Live Warboard](https://spider-verse.net) → Inspect this player.\n` +
                         `• [⚔️ Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${targetId}) • [👤 Profile](https://www.torn.com/profiles.php?XID=${targetId})`,
            color: 0xffa502,
            footer: { text: "Battle Stats Database" }
        };
    }

    const spiedTime = spy.timestamp ? `<t:${Math.floor(spy.timestamp / 1000)}:R>` : "Verified";
    const strVal = spy.strength ? Number(spy.strength).toLocaleString() : "Unknown";
    const defVal = spy.defense ? Number(spy.defense).toLocaleString() : "Unknown";
    const spdVal = spy.speed ? Number(spy.speed).toLocaleString() : "Unknown";
    const dexVal = spy.dexterity ? Number(spy.dexterity).toLocaleString() : "Unknown";

    return {
        title: `🔍 ${playerName} — Battle Stats`,
        description: `**Total**: **${formatStatNumber(spy.total || 0)}** (${(spy.total || 0).toLocaleString()})\n**Verified**: ${spiedTime}`,
        color: 0x58a6ff,
        fields: [
            { name: "💪 Strength", value: strVal, inline: true },
            { name: "🛡️ Defense", value: defVal, inline: true },
            { name: "⚡ Speed", value: spdVal, inline: true },
            { name: "🤸 Dexterity", value: dexVal, inline: true },
            { name: "🔗 Links", value: `[⚔️ Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${targetId}) • [👤 Profile](https://www.torn.com/profiles.php?XID=${targetId})`, inline: false }
        ],
        footer: { text: "Battle Stats Database • FF Scouter" }
    };
}

async function buildChainStatusEmbed(apiKey) {
    if (!apiKey) return { title: "🔗 Chain", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
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
                title: `🔗 Chain on Cooldown`,
                description: `**${data.name || 'Faction'}** chain is on cooldown for **${Math.ceil(cooldown / 60)} more minutes**.`,
                color: 0xffa502,
                footer: { text: "Chain Watcher" }
            };
        }

        if (current === 0) {
            return {
                title: `🔗 No Active Chain`,
                description: `**${data.name || 'Faction'}** has no chain running. Ready to start a new one.`,
                color: 0x8b949e,
                footer: { text: "Chain Watcher" }
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
            title: `🔗 Chain: ${current.toLocaleString()} / ${max.toLocaleString()} hits${isPanic ? ' — ⚠️ Timer Low' : ''}`,
            description: `${isPanic ? '**Timer below 90 seconds — hit now to keep the chain alive.**\n\n' : ''}` +
                         `**Count**: **${current.toLocaleString()}** / ${max.toLocaleString()} hits\n` +
                         `**Timer**: **${timeStr}**\n` +
                         `**Bonus Multiplier**: **${modifier}x**\n\n` +
                         `${bar} (${Math.round(pct * 100)}%)\n`,
            color: isPanic ? 0xff4757 : 0x2ed573,
            fields: [
                { name: "🔗 Links", value: `[⚔️ Targets](https://www.torn.com/factions.php?step=your#/tab=war) • [📡 Live Warboard](https://spider-verse.net)`, inline: false }
            ],
            footer: { text: `Chain Watcher • ${new Date().toUTCString()}` }
        };
    } catch (e) {
        return { title: "🔗 Chain", description: `⚠️ Could not fetch chain data: ${e.message}`, color: 0xff4757 };
    }
}

async function buildChainWatchEmbed(apiKey) {
    if (!apiKey) return { title: "🔗 Online Fighters", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
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
            title: `🔗 Online & Ready in Torn (${onlineInTorn.length} members)`,
            description: `**Chain**: ${current} hits • **Timer**: ${Math.floor(timeout/60)}m ${timeout%60}s\n\n` + list,
            color: 0x58a6ff,
            footer: { text: "Chain Watcher" }
        };
    } catch(e) {
        return { title: "🔗 Online Fighters", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildProfileEmbed(playerQuery, apiKey) {
    if (!playerQuery || !apiKey) return { title: "👤 Player Profile", description: "Please provide a Torn Player ID or name.", color: 0xff4757 };
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
                         `**Revivable**: ${reviveStr} • **Awards**: ${awards}\n`,
            color: data.status?.state === 'Hospital' ? 0xff4757 : (data.status?.state === 'Traveling' ? 0x58a6ff : 0x2ed573),
            fields: [
                { name: "🔗 Links", value: `[👤 Profile](https://www.torn.com/profiles.php?XID=${data.player_id}) • [⚔️ Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${data.player_id}) • [🎯 Place Bounty](https://www.torn.com/bounties.php?p=add&XID=${data.player_id}&amount=150000)`, inline: false }
            ],
            footer: { text: "Player Profile" }
        };
    } catch(e) {
        return { title: "👤 Player Profile", description: `⚠️ Could not fetch profile: ${e.message}`, color: 0xff4757 };
    }
}

async function buildHospitalEmbed(apiKey) {
    if (!apiKey) return { title: "🏥 Hospital", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const res = await fetch(`https://api.torn.com/faction/?selections=basic&key=${apiKey}`, { signal: AbortSignal.timeout(7000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const now = Math.floor(Date.now() / 1000);
        const members = Object.entries(data.members || {}).map(([id, m]) => ({ id, ...m }));
        const inHosp = members.filter(m => m.status?.state === 'Hospital');

        if (inHosp.length === 0) {
            return {
                title: `🏥 ${data.name || 'Faction'} — No Members in Hospital`,
                description: `All members are currently out of hospital and available.`,
                color: 0x2ed573,
                footer: { text: "Hospital Roster" }
            };
        }

        inHosp.sort((a, b) => (a.status?.until || 0) - (b.status?.until || 0));

        const lines = inHosp.map((m, idx) => {
            const minsLeft = Math.max(0, Math.ceil(((m.status?.until || 0) - now) / 60));
            const desc = m.status?.description || "Hospitalized";
            return `${idx + 1}. [**${m.name}** [${m.id}]](https://www.torn.com/profiles.php?XID=${m.id}) — ⏳ **${minsLeft}m left**\n   └ *${desc}*`;
        });

        return {
            title: `🏥 ${data.name || 'Faction'} — Hospital (${inHosp.length} members)`,
            description: lines.join("\n"),
            color: 0xff4757,
            footer: { text: `Hospital Roster • ${new Date().toUTCString()}` }
        };
    } catch(e) {
        return { title: "🏥 Hospital", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildOnlineRosterEmbed(apiKey) {
    if (!apiKey) return { title: "👥 Faction Roster", description: "⚠️ No Torn API key configured.", color: 0xff4757 }; // keep title
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
            title: `👥 ${data.name || 'Faction'} — Roster (${total} members)`,
            description: `**Respect**: **${(data.respect || 0).toLocaleString()}** • **Rank**: **${data.rank?.name || 'Unranked'}**\n\n` +
                         `🟢 **Online**: **${online}** (${Math.round(online/total*100)}%)\n` +
                         `🟡 **Idle**: **${idle}**\n` +
                         `⚪ **Offline**: **${offline}**\n\n` +
                         `🛡️ **In Torn**: **${okayInTorn}** available\n` +
                         `🏥 **Hospital**: **${hosp}**\n` +
                         `✈️ **Traveling / Abroad**: **${traveling}**\n`,
            color: 0x58a6ff,
            footer: { text: `Faction Roster • ${new Date().toUTCString()}` }
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
            title: `💼 Organized Crimes (${ready.length} ready, ${inPlanning.length} planning)`,
            description: `**Ready to Launch (${ready.length})**\n${readyList}\n\n` +
                         `**In Planning (${inPlanning.length})**\n${planList}\n`,
            color: ready.length > 0 ? 0x2ed573 : 0x58a6ff,
            fields: [
                { name: "🔗 OC Manager", value: `[Open OC Manager](https://spider-verse.net/oc.html)`, inline: false }
            ],
            footer: { text: "Organized Crimes" }
        };
    } catch(e) {
        return { title: "💼 Organized Crimes", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildMyOCEmbed(playerQuery, apiKey, callerUsername) {
    if (!apiKey) return { title: "💼 My OC", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
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
                title: "💼 My OC — Not Found",
                description: `No active OC assignment found for **${playerQuery || callerUsername}**.\n\nMake sure your name matches your Torn character name, or use \`/myoc player:<Your Torn ID>\`.`,
                color: 0xffa502,
                footer: { text: "Organized Crimes" }
            };
        }

        const c = matchedCrime.crime;
        const isReady = c.ready === 1 || (c.time_ready && c.time_ready <= now);
        const timeStr = isReady ? "🟢 **Ready to initiate**" : `⏳ Ready in **${Math.ceil((c.time_ready - now)/3600)} hours** (<t:${c.time_ready}:R>)`;
        
        const teammates = (c.participants || []).map(p => {
            const pId = (p.player_id || Object.keys(p)[0] || '').toString();
            const pObj = p[pId] || p;
            return `• **${pObj.name || `Player #${pId}`}** [${pId}]`;
        }).join("\n");

        return {
            title: `💼 ${c.crime_name}`,
            description: `**Status**: ${timeStr}\n\n**Team**:\n${teammates}`,
            color: isReady ? 0x2ed573 : 0x58a6ff,
            footer: { text: "Organized Crimes" }
        };
    } catch(e) {
        return { title: "💼 My OC", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
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
                title: `✈️ ${country} — No Stock Data`,
                description: `No live stock data available for **${country}** right now.`,
                color: 0x58a6ff
            };
        }

        const lines = countryStocks.slice(0, 10).map(s => {
            const stockIcon = s.quantity > 500 ? '🟢' : (s.quantity > 50 ? '🟡' : '🔴');
            return `${stockIcon} **${s.name}**: **${(s.quantity || 0).toLocaleString()}** in stock · $${(s.cost || 0).toLocaleString()}`;
        });

        return {
            title: `✈️ ${country} — Overseas Stock`,
            description: lines.join("\n"),
            color: 0x00cec9,
            fields: [
                { name: "🔗 Travel Calculator", value: `[Open Travel Calculator](https://spider-verse.net/travel.html)`, inline: false }
            ],
            footer: { text: `Foreign Stock • YATA • ${new Date().toUTCString()}` }
        };
    } catch(e) {
        return { title: `✈️ ${country} — Overseas Stock`, description: `⚠️ Error fetching stocks: ${e.message}`, color: 0xff4757 };
    }
}

async function fetchWeav3rMarketplace(itemId) {
    if (!itemId) return null;
    try {
        const res = await fetch(`https://weav3r.dev/api/marketplace/${itemId}`, {
            signal: AbortSignal.timeout(6000),
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (res.status === 200) {
            return await res.json();
        }
    } catch(e) {
        console.warn(`[Weav3r.dev] Error fetching marketplace for #${itemId}:`, e.message);
    }
    return null;
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

        // Fetch live lowest market listings & bazaar average directly from weav3r.dev!
        const weav3rData = await fetchWeav3rMarketplace(match.id);

        // Fallback to Torn API if weav3r is unreachable
        let lowestBazaars = [];
        let lowestItemMarket = [];
        if (!weav3rData) {
            try {
                const marketRes = await fetch(`https://api.torn.com/market/${match.id}?selections=bazaar,itemmarket&key=${apiKey}`, { signal: AbortSignal.timeout(6000) });
                const marketData = await marketRes.json();
                if (marketData && !marketData.error) {
                    if (Array.isArray(marketData.bazaar)) lowestBazaars = marketData.bazaar;
                    if (Array.isArray(marketData.itemmarket)) lowestItemMarket = marketData.itemmarket;
                }
            } catch(e) {}
        }

        const marketPrice = weav3rData?.market_price || match.market_value || 0;
        const bazaarAvg = weav3rData?.bazaar_average || 0;
        const listings = weav3rData?.listings || [];

        const marketValStr = marketPrice > 0 ? `$${Number(marketPrice).toLocaleString()}` : 'N/A';
        const bazaarAvgStr = bazaarAvg > 0 ? `$${Number(bazaarAvg).toLocaleString()}` : null;
        
        let cheapestBazaar = null;
        let bazaarLines = "No live bazaar listings currently recorded.";

        if (listings.length > 0) {
            cheapestBazaar = `$${Number(listings[0].price).toLocaleString()}`;
            bazaarLines = listings.slice(0, 5).map((l, idx) => {
                const sellerName = l.player_name || getPlayerName(l.player_id, `Player #${l.player_id}`);
                const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${idx + 1}**`;
                return `${medal} **$${Number(l.price).toLocaleString()}** (Qty: **${(l.quantity || 1).toLocaleString()}**) • [🛒 ${sellerName}'s Bazaar](https://www.torn.com/bazaar.php?userId=${l.player_id})`;
            }).join("\n");
        } else if (lowestBazaars.length > 0) {
            cheapestBazaar = `$${Number(lowestBazaars[0].cost).toLocaleString()}`;
            bazaarLines = lowestBazaars.slice(0, 4).map((b, idx) => {
                const sellerName = getPlayerName(b.player_id, `Player #${b.player_id}`);
                return `**#${idx + 1}** • **$${Number(b.cost).toLocaleString()}** (Qty: **${(b.quantity || 1).toLocaleString()}**) • [🛒 ${sellerName}'s Bazaar](https://www.torn.com/bazaar.php?userId=${b.player_id})`;
            }).join("\n");
        }

        const fields = [
            { name: `📦 Cheapest Live Bazaars (Best: ${cheapestBazaar || marketValStr})`, value: bazaarLines, inline: false }
        ];

        if (lowestItemMarket.length > 0) {
            const itemMarketLines = lowestItemMarket.slice(0, 3).map((im, idx) => {
                return `**#${idx + 1}** • **$${Number(im.cost).toLocaleString()}** (Qty: **${(im.quantity || 1).toLocaleString()}**)`;
            }).join("\n");
            fields.push({ name: `🏪 Lowest Item Market`, value: itemMarketLines, inline: false });
        }

        fields.push({
            name: "🔗 Quick Links",
            value: `[🛒 Item Market](https://www.torn.com/imarket.php#/p=shop&type=${match.id}) • [📦 Bazaar Search](https://www.torn.com/bazaar.php) • [🌐 View on Weav3r.dev](https://weav3r.dev/marketplace/${match.id})`,
            inline: false
        });

        return {
            title: `🛒 ${match.name}`,
            description: `**Category**: ${match.type} • **Circulation**: ${(match.circulation || 0).toLocaleString()}\n\n` +
                         `**Market Value**: **${marketValStr}**` +
                         (bazaarAvgStr ? ` • **Bazaar Avg**: **${bazaarAvgStr}**` : '') +
                         (cheapestBazaar ? `\n**Cheapest Listed**: **${cheapestBazaar}**` : '') +
                         (match.description ? `\n\n*${match.description}*` : ''),
            thumbnail: { url: match.image },
            color: 0x00cec9,
            fields,
            footer: { text: `Market Prices • Weav3r.dev & Torn • ${new Date().toUTCString()}` }
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
            const activeWar = getActiveRankedWar(ourData);
            let detectedEnemy = null;
            if (activeWar && activeWar.factions) {
                const fids = Object.keys(activeWar.factions);
                detectedEnemy = fids.find(id => id !== ourData.ID?.toString());
            } else if (discordConfig.enemyFacId) {
                detectedEnemy = discordConfig.enemyFacId;
            }
            if (!detectedEnemy) {
                return {
                    title: "📊 Enemy Battle Stats",
                    description: "🕊️ **No Active Ranked War**\n\nYour faction is not currently in a ranked war, and no enemy faction is configured.\n\n*Enemy battle stats and scout records are automatically pulled when a Ranked War begins.*",
                    color: 0x2ed573,
                    footer: { text: "Spider-Verse Faction Tools • Battle Stats" }
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
            let numBadge = `\`${(idx + 1).toString().padStart(2, '0')}.\``;
            if (idx === 0) numBadge = '🥇';
            else if (idx === 1) numBadge = '🥈';
            else if (idx === 2) numBadge = '🥉';

            const statusDot = m.status === 'Online' ? '🟢 ' : (m.status === 'Idle' ? '🟡 ' : '');
            const stateBadge = m.state === 'Hospital' ? ' 🏥' : (m.state === 'Traveling' || m.state === 'Abroad' ? ' ✈️' : '');
            
            if (isEnemy) {
                return `${numBadge} ${statusDot}[**${m.name}**](https://www.torn.com/profiles.php?XID=${m.id}) (Lvl ${m.level}) ➔ **${m.statsFormatted}**${stateBadge} • [⚔️ Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${m.id})`;
            } else {
                return `${numBadge} ${statusDot}[**${m.name}**](https://www.torn.com/profiles.php?XID=${m.id}) (Lvl ${m.level}) ➔ **${m.statsFormatted}**${stateBadge}`;
            }
        });

        const fields = [];
        const chunkSize = 11;
        for (let i = 0; i < lines.length; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize);
            const start = i + 1;
            const end = Math.min(i + chunkSize, lines.length);

            let sectionTitle = `⚔️ Main Battle Line (#${start} - #${end})`;
            if (i === 0) {
                sectionTitle = `👑 Heavyweights & Top Hitters (#1 - #${end})`;
            } else if (i + chunkSize >= lines.length) {
                sectionTitle = `🛡️ Support & Reserves (#${start} - #${end})`;
            }

            fields.push({
                name: sectionTitle,
                value: chunk.join('\n'),
                inline: false
            });
        }

        const respectStr = Number(facData.respect || 0).toLocaleString();
        const rankStr = facData.rank?.name || 'Unranked';
        const intelNote = ffKey 
            ? `🛡️ **Intel**: FF Scouter & Spy DB (**${verifiedCount} / ${members.length}** verified)`
            : `⚠️ **Notice**: FF Scouter key not connected — using level baseline estimates. Connect FF Scouter in Dashboard Settings for live accuracy.`;

        return {
            title: isEnemy 
                ? `📊 ${facData.name || 'Enemy'} — Battle Stats (${members.length} members)`
                : `📊 ${facData.name || 'Faction'} — Battle Stats (${members.length} members)`,
            description: `**Rank**: **${rankStr}** • **Respect**: **${respectStr}**\n` +
                         `**Total Stats**: **${formatStatNumber(totalStatsSum)}** • **Avg per member**: **${formatStatNumber(avgStat)}**\n` +
                         `${intelNote}\n`,
            color: isEnemy ? 0xff4757 : 0x00cec9,
            fields,
            footer: { text: `Battle Stats • FF Scouter & Spy DB • ${new Date().toUTCString()}` }
        };
    } catch(e) {
        return { title: "📊 Battle Stats", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildWarBountiesEmbed(apiKey) {
    if (!apiKey) return { title: "🎯 War Bounties", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const facData = await facRes.json();
        
        let activeWar = getActiveRankedWar(facData);
        if (!activeWar || !activeWar.war) {
            return {
                title: "🎯 War Bounties",
                description: `🕊️ **No Active Ranked War**\n\n**${facData.name || 'Your faction'}** is not currently in an active ranked war.\n\n*War bounties placed on enemies are tracked in real-time during Ranked Wars.*`,
                color: 0x2ed573,
                footer: { text: "Spider-Verse Faction Tools • War Bounties" }
            };
        }
        const warStart = activeWar.war.start || (Math.floor(Date.now() / 1000) - (7 * 86400));
        const warEnd = activeWar.war.end || 0;

        const userRes = await fetch(`https://api.torn.com/user/?selections=events,basic,personalstats&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const userData = await userRes.json();
        if (userData.error) throw new Error(userData.error.error || "Torn API error");

        const bountyHistory = loadWarBountiesHistory();
        if (!bountyHistory.events) bountyHistory.events = {};

        const events = Object.entries(userData.events || {});
        for (const [eId, ev] of events) {
            const text = ev.event || '';
            const ts = ev.timestamp || 0;
            if (ts >= warStart && (!warEnd || ts <= warEnd)) {
                if (text.includes('bounty reward') || text.includes('bounty') || text.includes('bounties')) {
                    const amountMatch = text.match(/\$([0-9,]+)\s+bounty/i);
                    const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, '')) : 0;
                    
                    let targetName = 'Unknown Target';
                    let targetId = null;
                    let hunterName = 'Someone (Anonymous)';
                    let hunterId = null;
                    
                    const playerLinks = [...text.matchAll(/profiles\.php\?XID=(\d+)[^>]*>([^<]+)<\/a>/g)];
                    if (playerLinks.length === 2) {
                        hunterId = playerLinks[0][1];
                        hunterName = playerLinks[0][2];
                        targetId = playerLinks[1][1];
                        targetName = playerLinks[1][2];
                    } else if (playerLinks.length === 1) {
                        targetId = playerLinks[0][1];
                        targetName = playerLinks[0][2];
                        hunterName = text.startsWith('Someone') ? 'Someone (Anonymous)' : 'Hunter';
                    }

                    if (targetName) playerNameCache[targetId?.toString()] = targetName;

                    const key = `${ts}_${targetId}_${amount}`;
                    bountyHistory.events[key] = {
                        key,
                        eventId: eId,
                        timestamp: ts,
                        date: new Date(ts * 1000).toISOString(),
                        hunterName,
                        hunterId,
                        targetName,
                        targetId,
                        amount,
                        rawText: text
                    };
                }
            }
        }
        saveWarBountiesHistory(bountyHistory);

        const warEvents = Object.values(bountyHistory.events).filter(e => e.timestamp >= warStart && (!warEnd || e.timestamp <= warEnd));
        warEvents.sort((a, b) => b.timestamp - a.timestamp);

        let totalCashSpent = 0;
        const targetMap = {};
        warEvents.forEach(e => {
            totalCashSpent += e.amount || 0;
            const tKey = e.targetName || `Target #${e.targetId}`;
            if (!targetMap[tKey]) {
                targetMap[tKey] = { name: e.targetName, id: e.targetId, count: 0, totalAmount: 0 };
            }
            targetMap[tKey].count++;
            targetMap[tKey].totalAmount += e.amount || 0;
        });

        const topTargets = Object.values(targetMap).sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);

        const fields = [];
        if (topTargets.length > 0) {
            const topLines = topTargets.slice(0, 8).map((t, idx) => {
                const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `**#${idx + 1}**`));
                return `${medal} **[${t.name}](https://www.torn.com/profiles.php?XID=${t.id})** — **${t.count}** bounties ($${t.totalAmount.toLocaleString()})`;
            }).join('\n');
            fields.push({ name: "🏥 Most Hospitalized Targets", value: topLines, inline: false });
        }

        if (warEvents.length > 0) {
            const recentLines = warEvents.slice(0, 6).map(e => {
                const timeStr = `<t:${e.timestamp}:R>`;
                const hunterStr = e.hunterId ? `[${e.hunterName}](https://www.torn.com/profiles.php?XID=${e.hunterId})` : e.hunterName;
                return `• **[${e.targetName}](https://www.torn.com/profiles.php?XID=${e.targetId})** hospitalized by ${hunterStr} — $${(e.amount || 0).toLocaleString()} (${timeStr})`;
            }).join('\n');
            fields.push({ name: "🕐 Recent Claims", value: recentLines, inline: false });
        }

        fields.push({
            name: "📊 Lifetime",
            value: `**${(userData.personalstats?.bountiesplaced || 0).toLocaleString()}** total bounties placed`,
            inline: false
        });

        const warStatusStr = (activeWar && (!activeWar.war?.winner || activeWar.war?.winner === 0))
            ? `**Ranked War Active** (Started <t:${warStart}:R>)`
            : `**War Period Tracked** (Started <t:${warStart}:D>)`;

        return {
            title: "🎯 War Bounties",
            description: `${warStatusStr}\n\n` +
                         `**Total spent on bounties**: $${totalCashSpent.toLocaleString()}\n` +
                         `**Enemies hospitalized via bounty**: ${warEvents.length}\n`,
            color: 0xff4757,
            fields,
            footer: { text: `War Bounties • ${new Date().toUTCString()}` }
        };
    } catch(e) {
        return { title: "🎯 War Bounties", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildInactiveMembersEmbed(apiKey) {
    if (!apiKey) return { title: "💤 Inactive Members", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        let watchFactionId = discordConfig.factionId || dynamicFactionId || "52355";
        const url = `https://api.torn.com/faction/${watchFactionId}?selections=basic&key=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const members = data.members || {};
        const now = Math.floor(Date.now() / 1000);
        const thresholdDays = Math.max(1, Number(discordConfig.inactivityDays) || 1);
        const thresholdSec = thresholdDays * 86400;

        const list = [];
        for (const [id, m] of Object.entries(members)) {
            const lastTs = m.last_action?.timestamp || 0;
            const diff = now - lastTs;
            if (diff >= thresholdSec) {
                const hours = Math.floor(diff / 3600);
                const days = Math.floor(diff / 86400);
                list.push({
                    id,
                    name: m.name,
                    level: m.level,
                    hours,
                    days,
                    relative: m.last_action?.relative || `${hours}h ago`,
                    status: m.status?.description || m.status?.state || m.last_action?.status || 'Offline'
                });
            }
        }

        list.sort((a, b) => b.hours - a.hours);

        if (list.length === 0) {
            return {
                title: "💤 Inactive Members",
                description: `All faction members are active. No one has been offline for ${thresholdDays}+ day${thresholdDays > 1 ? 's' : ''}.`,
                color: 0x2ed573,
                footer: { text: "Inactivity Tracker" }
            };
        }

        const count = list.length;
        const topList = list.slice(0, 15);
        const lines = topList.map(m => {
            const dur = m.days >= 1 ? `${m.days}d (${m.hours}h)` : `${m.hours}h`;
            return `• **[${m.name}](https://www.torn.com/profiles.php?XID=${m.id})** [${m.id}] (Lvl ${m.level || '—'}) — **${dur}** inactive • *${m.status}*`;
        });

        if (list.length > 15) {
            lines.push(`*...and ${list.length - 15} more*`);
        }

        return {
            title: `💤 Inactive Members (${count})`,
            description: `Members offline for **${thresholdDays}+ day${thresholdDays > 1 ? 's' : ''}**:\n\n${lines.join('\n')}`,
            color: 0xffa502,
            footer: { text: `${Object.keys(members).length} total members • ${count} inactive` },
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "💤 Inactive Members", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildDonatorStatusEmbed(playerQuery, apiKey) {
    if (!apiKey) return { title: "⭐️ Donator Status", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        let url = `https://api.torn.com/user/?selections=profile,bars&key=${apiKey}`;
        let isSelf = true;

        if (playerQuery && String(playerQuery).trim()) {
            let clean = String(playerQuery).trim();
            const idMatch = clean.match(/\d{3,10}/);
            let targetId = idMatch ? idMatch[0] : null;

            if (!targetId) {
                const lower = clean.toLowerCase();
                for (const [id, name] of Object.entries(playerNameCache)) {
                    if (name && (name.toLowerCase() === lower || name.toLowerCase().includes(lower))) {
                        targetId = id;
                        break;
                    }
                }
            }

            if (targetId) {
                url = `https://api.torn.com/user/${targetId}?selections=profile,bars&key=${apiKey}`;
                isSelf = false;
            }
        }

        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        if (data.error) throw new Error(data.error.error || "Player not found");

        const name = data.name || "Unknown";
        const id = data.player_id || "—";
        const isDonator = data.donator === 1 || data.donator === true || Boolean(data.donator);
        const daysLeft = data.donatordays || data.donator_days || null;
        const level = data.level || "—";
        const age = data.age || 0;
        const statusDesc = data.status?.description || data.status?.state || (data.last_action?.status || "Offline");

        const energyMax = isDonator ? 150 : 100;
        const energyCurrent = data.energy?.current !== undefined ? `${data.energy.current}/${energyMax}` : `${energyMax} max`;

        const title = `⭐️ ${name} [${id}] — Donator Status`;
        const color = isDonator ? 0x2ed573 : 0xff4757;

        let statusText = isDonator
            ? `🟢 **Active Donator / Subscriber**`
            : `🔴 **Non-Donator**`;

        let desc = `**Player**: **[${name}](https://www.torn.com/profiles.php?XID=${id})** [${id}]\n` +
                   `**Status**: ${statusText}\n`;

        if (daysLeft !== null && daysLeft !== undefined && daysLeft > 0) {
            desc += `⏳ **Days Remaining**: **${daysLeft} days**\n`;
        } else if (isDonator) {
            desc += `⏳ **Status Type**: **Active Monthly Subscriber or Donator**\n`;
        } else {
            desc += `⚠️ **Status**: No active Donator Pack or Subscription\n`;
        }

        desc += `📊 **Level**: **${level}** • **Age**: **${age.toLocaleString()} days**\n` +
                `🕒 **Activity**: ${statusDesc}`;

        const fields = [
            {
                name: "⚡ Energy Capacity",
                value: `**${energyCurrent}**\n${isDonator ? '✨ +50 Bonus Cap' : '⚠️ Base 100 Cap'}`,
                inline: true
            },
            {
                name: "⏱️ Energy Regeneration",
                value: isDonator ? "**5 Energy / 10 mins**\n(30 Energy / hr)" : "**5 Energy / 15 mins**\n(20 Energy / hr)",
                inline: true
            },
            {
                name: "📈 Daily Energy Potential",
                value: isDonator ? "**720 Energy / day**\n(+50% natural gain)" : "**480 Energy / day**\n(Standard gain)",
                inline: true
            },
            {
                name: isDonator ? "🎁 Active Benefits" : "❌ Missing Benefits",
                value: isDonator
                    ? "• **150 Max Energy** (+50 bonus bar)\n• **50% Faster Energy Regen** (10m vs 15m)\n• **+240 extra natural energy every single day**\n• Advanced Torn Search filters"
                    : "• Missing **+50 Max Energy**\n• Missing **240 extra energy every day**\n• Slower 15-minute regeneration\n• Use a **Donator Pack** from Bazaar/Item Market to activate!",
                inline: false
            }
        ];

        return {
            title,
            description: desc,
            color,
            fields,
            links: [
                { label: "👤 View Profile", url: `https://www.torn.com/profiles.php?XID=${id}` },
                { label: "📦 Buy Donator Pack", url: `https://www.torn.com/imarket.php#/p=shop&step=shop&type=&searchname=Donator+Pack` },
                { label: "💳 Official Subscription", url: `https://www.torn.com/donator.php` }
            ],
            footer: { text: `Torn Donator Intelligence • ${isSelf ? "Your Account" : "Player Lookup"}` },
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "⭐️ Donator Status", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
} 

async function buildWarFlightsEmbed(apiKey, ffKey) {
    if (!apiKey) return { title: "✈️ War Flights", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const facData = await facRes.json();
        if (facData.error) throw new Error(facData.error.error || "Torn API error");

        const activeWar = getActiveRankedWar(facData);
        if (!activeWar || !activeWar.war) {
            return {
                title: "✈️ War Flights Radar",
                description: `🕊️ **No Active Ranked War**\n\n**${facData.name || 'Your faction'}** is not currently in an active ranked war.\n\n*Live flight radar, ghosting detection, and overseas restock telemetry activate automatically during Ranked Wars.*`,
                color: 0x2ed573,
                footer: { text: "Spider-Verse Faction Tools • War Flights" }
            };
        }

        const myId = facData.ID.toString();
        let enemyName = "Enemy Faction";
        for (const [fId, fInfo] of Object.entries(activeWar.factions || {})) {
            if (fId !== myId) enemyName = fInfo.name;
        }
        const warId = Object.keys(facData.rankedwars || {}).find(k => facData.rankedwars[k] === activeWar) || activeWar.war.start;

        const cacheKey = `${warId}_${ffKey ? ffKey.substring(0, 6) : 'none'}`;
        let auditData = warAuditCache[cacheKey]?.data;

        if (!auditData) {
            const auditRes = await fetch(`http://127.0.0.1:${PORT || 3000}/api/war-flight-audit?apiKey=${apiKey}&ffKey=${ffKey || ''}&warId=${warId}`).catch(() => null);
            if (auditRes) auditData = await auditRes.json().catch(() => null);
        }

        if (!auditData || !auditData.members) {
            return {
                title: `✈️ War Flights — vs ${enemyName}`,
                description: `Analyzing war flights and attack logs. Run the command again in a few seconds, or check the Dashboard.`,
                color: 0x00cec9
            };
        }

        const topSafe = auditData.members.filter(m => m.timesFarmed === 0 && (m.flightPct > 0 || m.hitsMade > 0)).slice(0, 5);
        const mostFarmed = auditData.members.filter(m => m.timesFarmed > 0).sort((a, b) => b.timesFarmed - a.timesFarmed).slice(0, 5);

        const safeLines = topSafe.map(m => `• **${m.name}** [${m.id}]: **${m.airtimeFormatted}** in air (${m.flightPct}%) • 0 times farmed • ${m.hitsMade} hits`).join('\n') || "None recorded";
        const farmedLines = mostFarmed.map(m => `• **${m.name}** [${m.id}]: **${m.timesFarmed}x farmed** • -${m.respectLeaked} pts • ${m.airtimeFormatted} in air`).join('\n') || "No members were farmed this war.";

        return {
            title: `✈️ War Flights — vs ${enemyName}`,
            description: `**Duration**: **${auditData.war.durationHours}h** • **Total Airtime**: **${auditData.kpis.totalAirHours}h**\n` +
                         `**Members abroad during war**: **${auditData.kpis.ghostCount}** • **Farmed hits conceded**: **${auditData.kpis.totalFarmedHits}** (-${auditData.kpis.totalRespectLeaked} pts)\n\n` +
                         `**Not farmed while flying**:\n${safeLines}\n\n` +
                         `**Most farmed**:\n${farmedLines}`,
            color: auditData.kpis.totalFarmedHits > 20 ? 0xff4757 : 0x2ed573,
            footer: { text: "War Flight Audit • FF Scouter & Torn API" },
            timestamp: new Date().toISOString()
        };
    } catch (e) {
        return { title: "✈️ War Flights", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildPayoutEmbed(memberQuery, apiKey) {
    if (!apiKey) return { title: "💰 War Payouts", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
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
                    title: `💰 ${memberQuery} — No Hits on Record`,
                    description: `No recorded war hits found for **${memberQuery}** in this war.\n\n**Rate**: $${cpm.toLocaleString()} per hit.`,
                    color: 0xffa502
                };
            }
            const totalEarned = matched.hits * cpm;
            return {
                title: `💰 ${matched.name} [${matched.id}]`,
                description: `**War Hits**: **${matched.hits.toLocaleString()}**\n` +
                             `**Score**: **${matched.score.toFixed(1)}** pts\n` +
                             `**Rate**: **$${cpm.toLocaleString()}** / hit\n\n` +
                             `**Owed**: **$${totalEarned.toLocaleString()}**`,
                color: 0x2ed573,
                footer: { text: "War Payouts" }
            };
        }

        const top5 = memberHitsMap.slice(0, 5);
        let totalFactionHits = 0;
        memberHitsMap.forEach(m => totalFactionHits += m.hits);
        const totalFactionPayout = totalFactionHits * cpm;

        const lines = top5.map((m, idx) => {
            const owed = m.hits * cpm;
            return `${idx + 1}. **${m.name}**: **${m.hits} hits** → **$${owed.toLocaleString()}**`;
        }).join("\n") || "No war hit records found.";

        return {
            title: `💰 War Payouts ($${cpm.toLocaleString()} / hit)`,
            description: `**Total hits**: **${totalFactionHits.toLocaleString()}** across **${memberHitsMap.length}** fighters\n` +
                         `**Total pot**: **$${totalFactionPayout.toLocaleString()}**\n\n` +
                         `**Top Earners**:\n${lines}\n\nUse \`/payout member:<name or ID>\` to look up a specific member.`,
            color: 0x2ed573,
            fields: [
                { name: "🔗 Payout Dashboard", value: `[Open Web Payout Manager](https://spider-verse.net/payout.html)`, inline: false }
            ],
            footer: { text: "War Payouts" }
        };
    } catch(e) {
        return { title: "💰 War Payouts", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

async function buildTopHittersEmbed(apiKey) {
    if (!apiKey) return { title: "🏆 War Leaderboard", description: "⚠️ No Torn API key configured.", color: 0xff4757 };
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars,attacks&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const data = await facRes.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const activeWar = getActiveRankedWar(data);
        if (!activeWar || !activeWar.factions) {
            return {
                title: "🏆 War MVP & Top Hitters",
                description: `🕊️ **No Active Ranked War**\n\n**${data.name || 'Your faction'}** is not currently in an active ranked war.\n\n*Live attack leaderboards, MVP scores, and assist tracking will populate here during Ranked Wars.*`,
                color: 0x2ed573,
                footer: { text: "Spider-Verse Faction Tools • Ranked War" },
                timestamp: new Date().toISOString()
            };
        }

        const ourFid = data.ID?.toString();
        const ourInfo = activeWar.factions?.[ourFid] || Object.values(activeWar.factions || {})[0];
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
                title: `🏆 ${data.name || 'Faction'} — War Leaderboard`,
                description: "No war attack records found yet.",
                color: 0x8b949e
            };
        }

        const top10 = memberList.slice(0, 10);
        const lines = top10.map((m, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${idx + 1}**`;
            const assistStr = m.assists > 0 ? ` · ${m.assists} assists` : '';
            const scoreStr = m.score > 0 ? ` · ${m.score.toFixed(1)} pts` : '';
            return `${medal} [**${m.name}** [${m.id}]](https://www.torn.com/profiles.php?XID=${m.id})\n   └ **${m.attacks.toLocaleString()} war hits**${scoreStr}${assistStr}`;
        }).join("\n\n");

        return {
            title: `🏆 ${data.name || 'Faction'} — War Leaderboard`,
            description: `**Total hits**: **${totalHits.toLocaleString()}** across **${memberList.length}** fighters\n` +
                         (ourScore > 0 ? `**Faction score**: **${ourScore.toLocaleString()}** pts\n\n` : '\n') +
                         lines,
            color: 0xffa502,
            footer: { text: "War Leaderboard" }
        };
    } catch(e) {
        return { title: "🏆 War Leaderboard", description: `⚠️ Error: ${e.message}`, color: 0xff4757 };
    }
}

// ─── Bank & Faction Audit Embed Builders ─────────────────────────────────────
function parseAmount(input) {
    if (typeof input === 'number') {
        if (!isNaN(input) && input > 0) return Math.floor(input);
        return null;
    }
    if (!input || typeof input !== 'string') return null;
    const clean = input.trim().toLowerCase().replace(/[\$,\s]/g, '');
    let multiplier = 1;
    let numStr = clean;

    if (clean.endsWith('k') || clean.endsWith('kilo')) {
        multiplier = 1e3;
        numStr = clean.replace(/kilo|k/, '');
    } else if (clean.endsWith('m') || clean.endsWith('mil') || clean.endsWith('million')) {
        multiplier = 1e6;
        numStr = clean.replace(/million|mil|m/, '');
    } else if (clean.endsWith('b') || clean.endsWith('bil') || clean.endsWith('billion')) {
        multiplier = 1e9;
        numStr = clean.replace(/billion|bil|b/, '');
    }

    const val = parseFloat(numStr);
    if (isNaN(val) || val <= 0) return null;
    const finalVal = Math.floor(val * multiplier);
    if (finalVal <= 0 || finalVal > 100000000000) return null; // safety cap at 100 Billion
    return finalVal;
}

function checkExpiredBankRequests() {
    const now = Date.now();
    const EXPIRY_MS = 60 * 60 * 1000; // 60 minutes auto-expiration (Tornium anti-mug security)
    let changed = false;

    for (const req of Object.values(bankRequests)) {
        if (req.status === 'pending' && (now - req.timestamp > EXPIRY_MS)) {
            req.status = 'expired';
            req.expiredAt = now;
            changed = true;

            if (req.channelId && req.messageId && slashCommandBot?.isReady?.()) {
                (async () => {
                    try {
                        const chan = slashCommandBot.channels.cache.get(req.channelId);
                        if (chan) {
                            const msg = await chan.messages.fetch(req.messageId);
                            if (msg) {
                                await msg.edit({
                                    embeds: [sanitizeEmbed(buildBankRequestEmbed(req))],
                                    components: buildBankRequestButtons(req)
                                });
                            }
                        }
                    } catch(e) {}
                })();
            }
        } else if (req.status === 'verifying' && (now - (req.fulfilledAt || req.timestamp) > 3.5 * 60 * 1000)) {
            // Safety timeout: if left in verifying for >3.5m (e.g. server restart during loop), revert to pending
            req.status = 'pending';
            req.fulfilledBy = null;
            req.fulfillerName = null;
            req.fulfilledAt = null;
            changed = true;

            if (req.channelId && req.messageId && slashCommandBot?.isReady?.()) {
                (async () => {
                    try {
                        const chan = slashCommandBot.channels.cache.get(req.channelId);
                        if (chan) {
                            const msg = await chan.messages.fetch(req.messageId);
                            if (msg) {
                                await msg.edit({
                                    embeds: [sanitizeEmbed(buildBankRequestEmbed(req))],
                                    components: buildBankRequestButtons(req)
                                });
                            }
                        }
                    } catch(e) {}
                })();
            }
        }
    }
    if (changed) saveBankRequests();
}

// Run expiry check every 2 minutes
setInterval(checkExpiredBankRequests, 2 * 60 * 1000);

function buildBankRequestEmbed(req) {
    const formattedAmount = `$${Number(req.amount).toLocaleString()}`;
    const requesterMention = `<@${req.userId}>`;
    const tornProfile = req.tornId
        ? `[${req.tornName || 'Unknown'} [${req.tornId}]](https://www.torn.com/profiles.php?XID=${req.tornId})`
        : null;

    let color = 0xffa502;
    let statusLine = `⏳ Awaiting banker — requested <t:${Math.floor(req.timestamp / 1000)}:R>`;
    let footerText = 'F.R.I.D.A.Y • Faction Vault Banking';
    let titlePrefix = '⏳';

    if (req.status === 'verifying') {
        color = 0xf9ca24; // Yellow
        titlePrefix = '🔄';
        const payerMention = req.fulfilledBy ? `<@${req.fulfilledBy}>` : `@${req.fulfillerName || 'Banker'}`;
        statusLine = `🔄 **Verifying payment** — ${payerMention} clicked "Give Cash" <t:${Math.floor((req.fulfilledAt || req.timestamp) / 1000)}:R>\nChecking faction logs... auto-confirms within 3 minutes.`;
        footerText = `Payment initiated by @${req.fulfillerName || 'Banker'} · Verifying via Torn Logs`;
    } else if (req.status === 'fulfilled') {
        color = 0x2ed573;
        titlePrefix = '✅';
        let fulfillerStr = "";
        if (req.fulfilledBy) {
            fulfillerStr = `by <@${req.fulfilledBy}>`;
        } else if (req.fulfillerName && req.fulfillerName !== 'Banker') {
            fulfillerStr = `by **@${req.fulfillerName}**`;
        } else {
            fulfillerStr = `via Torn Faction Logs`;
        }
        const timeRef = req.fulfilledAt || req.verifiedAt || req.timestamp || Date.now();
        statusLine = `✅ **Fulfilled** ${fulfillerStr} — <t:${Math.floor(timeRef / 1000)}:R>`;
        footerText = `Fulfilled · F.R.I.D.A.Y Vault Banking`;
    } else if (req.status === 'cancelled') {
        color = 0x57606f;
        titlePrefix = '❌';
        const cancellerStr = req.cancelledBy && req.cancelledBy !== 'system'
            ? `<@${req.cancelledBy}>` : (req.cancellerName || 'System');
        statusLine = `❌ **Cancelled** by ${cancellerStr} — <t:${Math.floor(req.cancelledAt / 1000)}:R>`;
        footerText = `Cancelled · F.R.I.D.A.Y Faction AI`;
    } else if (req.status === 'expired') {
        color = 0x4f545c;
        titlePrefix = '⏱️';
        statusLine = `⏱️ **Timed out** after 60 minutes (auto-cancelled)`;
        footerText = `Timed out · F.R.I.D.A.Y Faction AI`;
    }

    const fields = [
        {
            name: '💵 Amount',
            value: `**${formattedAmount}**`,
            inline: true
        },
        {
            name: '👤 Requested By',
            value: tornProfile ? `${requesterMention}\n└ ${tornProfile}` : requesterMention,
            inline: true
        }
    ];

    if (req.remainingBalance !== undefined && req.remainingBalance >= 0) {
        fields.push({
            name: '🏦 Vault After',
            value: `$${Number(req.remainingBalance).toLocaleString()}`,
            inline: true
        });
    }

    // In-game status (only show on pending/verifying)
    if (req.memberStatus && (req.status === 'pending' || req.status === 'verifying')) {
        let badge = `🟢 In Torn City (${req.memberStatus.state || 'Okay'})`;
        const state = (req.memberStatus.state || '').toLowerCase();
        if (state.includes('travel') || state.includes('abroad')) {
            badge = `✈️ Traveling abroad — ⚠️ *Cannot receive vault transfer while in transit!*`;
        } else if (state.includes('hospital')) {
            badge = `🏥 In Hospital (${req.memberStatus.description || 'Medical'})`;
        } else if (state.includes('jail')) {
            badge = `🚨 In Jail (${req.memberStatus.description || 'Federal'})`;
        }
        fields.push({ name: '🚦 In-Game Status', value: badge, inline: false });
    }

    fields.push({ name: '📋 Status', value: statusLine, inline: false });

    return {
        title: `${titlePrefix}  Vault Request #${req.id}`,
        color,
        fields,
        footer: { text: footerText },
        timestamp: new Date(req.timestamp).toISOString()
    };
}

function getPreFilledVaultUrl(tornId, amount) {
    const id = String(tornId || '').trim();
    const amt = parseInt(amount, 10) || 0;
    return `https://www.torn.com/factions.php?step=your&option=give-to-user&giveMoneyTo=${id}&addMoneyTo=${id}&money=${amt}#/tab=controls&option=give-to-user&giveMoneyTo=${id}&addMoneyTo=${id}&money=${amt}`;
}

function buildBankRequestButtons(req) {
    const vaultUrl = getPreFilledVaultUrl(req.tornId, req.amount);
    const amtFmt = Number(req.amount).toLocaleString();

    if (req.status === 'pending') {
        // Only 2 buttons: Give Cash (direct link to Torn vault) and Cancel
        return [{ type: 1, components: [
            {
                type: 2,
                style: 5, // Link — opens pre-filled Torn faction vault page
                label: `💸 Give Cash in Torn ($${amtFmt})`,
                url: vaultUrl
            },
            {
                type: 2,
                style: 4, // Red
                custom_id: `bank_cancel_${req.id}`,
                label: '❌ Cancel'
            }
        ]}];
    } else if (req.status === 'verifying') {
        return [{ type: 1, components: [
            {
                type: 2,
                style: 2, // Grey disabled — status indicator
                custom_id: `verifying_display_${req.id}`,
                label: `⏳ Verifying payment...`,
                disabled: true
            },
            {
                type: 2,
                style: 5, // Link — open Torn vault if they haven't paid yet
                label: '💸 Give Cash in Torn',
                url: vaultUrl
            },
            {
                type: 2,
                style: 4, // Red — revert if they mis-clicked
                custom_id: `bank_revert_${req.id}`,
                label: '↩️ Revert'
            }
        ]}];
    } else {
        // fulfilled, cancelled, expired — NO buttons at all (clean card)
        return [];
    }
}

async function getFactionVaultAndMember(apiKey, interaction = null, targetQuery = null) {
    if (!apiKey) throw new Error("No Torn API key configured.");
    const facId = discordConfig.factionId || dynamicFactionId || "";
    const url = facId 
        ? `https://api.torn.com/faction/${facId}?selections=basic,donations&key=${apiKey}` 
        : `https://api.torn.com/faction/?selections=basic,donations&key=${apiKey}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (data.error) throw new Error(data.error.error || "Torn API error");

    const donations = data.donations || {};
    const members = data.members || {};
    let targetId = null;
    let targetDonor = null;
    let targetMember = null;

    if (targetQuery) {
        const cleanQuery = String(targetQuery).trim().toLowerCase();
        const numeric = cleanQuery.replace(/[^0-9]/g, '');
        if (numeric && (donations[numeric] || members[numeric])) {
            targetId = numeric;
        } else {
            for (const [mId, mInfo] of Object.entries(members)) {
                const mName = (mInfo.name || '').toLowerCase();
                if (mName === cleanQuery || mName.includes(cleanQuery) || cleanQuery.includes(mName)) {
                    targetId = mId;
                    break;
                }
            }
            if (!targetId) {
                for (const [dId, dInfo] of Object.entries(donations)) {
                    const dName = (dInfo.name || '').toLowerCase();
                    if (dName === cleanQuery || dName.includes(cleanQuery) || cleanQuery.includes(dName)) {
                        targetId = dId;
                        break;
                    }
                }
            }
        }
    } else if (interaction) {
        const dName = interaction.member?.displayName || interaction.user?.username || '';
        const matchId = dName.match(/\[(\d{3,10})\]|\((\d{3,10})\)/);
        if (matchId && (donations[matchId[1] || matchId[2]] || members[matchId[1] || matchId[2]])) {
            targetId = matchId[1] || matchId[2];
        }

        if (!targetId) {
            const cleanDName = dName.replace(/\[\d+\]|\(\d+\)/g, '').trim().toLowerCase();
            const uName = (interaction.user?.username || '').toLowerCase();
            for (const [mId, mInfo] of Object.entries(members)) {
                const mName = (mInfo.name || '').toLowerCase().trim();
                if (mName && (cleanDName === mName || uName === mName || cleanDName.includes(mName) || mName.includes(cleanDName))) {
                    targetId = mId;
                    break;
                }
            }
        }

        if (!targetId) {
            for (const [dId, dInfo] of Object.entries(donations)) {
                const dNameClean = (dInfo.name || '').toLowerCase().trim();
                const cleanDName = dName.replace(/\[\d+\]|\(\d+\)/g, '').trim().toLowerCase();
                if (dNameClean && (cleanDName === dNameClean || cleanDName.includes(dNameClean))) {
                    targetId = dId;
                    break;
                }
            }
        }
    }

    if (targetId) {
        targetDonor = donations[targetId] || null;
        targetMember = members[targetId] || null;
    }

    const totalBalance = targetDonor ? Number(targetDonor.money_balance || 0) : 0;
    const pointsBalance = targetDonor ? Number(targetDonor.points_balance || 0) : 0;
    const tornName = targetMember?.name || targetDonor?.name || null;

    // Calculate existing active pending requests for this user
    let activePendingTotal = 0;
    const activePendingReqs = [];
    let bankStateModified = false;
    for (const r of Object.values(bankRequests)) {
        if (r.status === 'pending') {
            const matchesDiscord = interaction && (r.userId === interaction.user?.id);
            const matchesTorn = targetId && (r.tornId === targetId);
            if (matchesDiscord || matchesTorn) {
                // If this pending request exceeds total balance, it is an impossible overdraft: auto-cancel it!
                if (totalBalance > 0 && Number(r.amount || 0) > totalBalance) {
                    r.status = 'cancelled';
                    r.cancelledBy = 'system';
                    r.cancellerName = 'System (Overdraft Purged)';
                    r.cancelledAt = Date.now();
                    bankStateModified = true;
                    continue;
                }
                activePendingTotal += Number(r.amount || 0);
                activePendingReqs.push(r);
            }
        }
    }
    if (bankStateModified) saveBankRequests();

    const availableBalance = Math.max(0, totalBalance - activePendingTotal);

    return {
        factionName: data.name || "Faction",
        targetId,
        tornName,
        targetDonor,
        targetMember,
        totalBalance,
        pointsBalance,
        activePendingTotal,
        activePendingReqs,
        availableBalance,
        memberStatus: targetMember?.status || null,
        donations,
        members
    };
}

function buildBankHistoryEmbed(targetMember = null) {
    const list = Object.values(bankRequests).sort((a, b) => b.timestamp - a.timestamp);
    let filtered = list;
    if (targetMember) {
        const clean = String(targetMember).toLowerCase().trim().replace(/[^0-9a-z]/g, '');
        filtered = list.filter(r => 
            (r.tornId && r.tornId === clean) ||
            (r.tornName && r.tornName.toLowerCase().includes(clean)) ||
            (r.userName && r.userName.toLowerCase().includes(clean))
        );
    }

    if (filtered.length === 0) {
        return {
            title: "📜 Faction Vault Banking History",
            description: targetMember 
                ? `No banking history found matching **"${targetMember}"**.`
                : "No vault withdrawal requests have been recorded yet.",
            color: 0x8b949e,
            footer: { text: "Spider-Verse Faction Tools • Faction Banking History" }
        };
    }

    const recent = filtered.slice(0, 15);
    const lines = recent.map(r => {
        const icon = r.status === 'fulfilled' ? '✅' : r.status === 'pending' ? '⏳' : r.status === 'verifying' ? '🔄' : r.status === 'expired' ? '⏱️' : '❌';
        const formattedAmount = `$${Number(r.amount).toLocaleString()}`;
        const timeAgo = `<t:${Math.floor(r.timestamp / 1000)}:R>`;
        const fulfillerInfo = r.status === 'fulfilled' ? ` (fulfilled by @${r.fulfillerName})` : '';
        const cancellerInfo = r.status === 'cancelled' ? ` (cancelled by @${r.cancellerName})` : '';
        return `${icon} **Req #${r.id}**: **${formattedAmount}** by <@${r.userId}> [${r.tornName || 'Player'}] — ${r.status}${fulfillerInfo}${cancellerInfo} (${timeAgo})`;
    }).join('\n');

    return {
        title: `📜 Faction Vault Banking History (${filtered.length} total)`,
        description: lines + `\n\n👉 [Open Faction Vault in Torn](https://www.torn.com/factions.php?step=your#/tab=controls&option=give-to-user)`,
        color: 0x2ed573,
        footer: { text: "Showing most recent vault requests" },
        timestamp: new Date().toISOString()
    };
}

// ── Faction Log & Balance Verification for Vault Payments ───────────────────
async function checkFactionLogForPayment(req, apiKey) {
    if (!apiKey) return { verified: false, reason: "no_api_key" };
    const facId = discordConfig.factionId || dynamicFactionId || "";
    const requiredAmount = Number(req.amount);
    const targetId = String(req.tornId || "").trim();
    const targetName = (req.tornName || "").trim().toLowerCase();

    // Cache-busting parameter forces Torn's CDN to bypass its 30-second cache
    // and query live fresh database balances immediately!
    const cacheBuster = Date.now();
    const donUrl = facId
        ? `https://api.torn.com/faction/${facId}?selections=donations&timestamp=${cacheBuster}&key=${apiKey}`
        : `https://api.torn.com/faction/?selections=donations&timestamp=${cacheBuster}&key=${apiKey}`;
    const newsUrl = facId
        ? `https://api.torn.com/faction/${facId}?selections=fundsnews,mainnews&timestamp=${cacheBuster}&key=${apiKey}`
        : `https://api.torn.com/faction/?selections=fundsnews,mainnews&timestamp=${cacheBuster}&key=${apiKey}`;

    try {
        // Fetch both donations & news simultaneously in parallel for maximum speed
        const [donResult, newsResult] = await Promise.allSettled([
            fetch(donUrl, { signal: AbortSignal.timeout(6000) }).then(r => r.json()),
            fetch(newsUrl, { signal: AbortSignal.timeout(6000) }).then(r => r.json())
        ]);

        // ── Strategy 1: Verify via Faction Donations (Vault Balance Drop) ──
        if (donResult.status === 'fulfilled') {
            const donData = donResult.value;
            if (donData && !donData.error && donData.donations && targetId && donData.donations[targetId]) {
                const donor = donData.donations[targetId];
                const currentBal = Number(donor.money_balance ?? donor.money ?? 0);

                if (req.balanceBefore !== undefined && req.balanceBefore > 0) {
                    const expectedMax = req.balanceBefore - requiredAmount;
                    if (currentBal <= expectedMax) {
                        return {
                            verified: true,
                            source: "donations_drop",
                            currentBal,
                            balanceBefore: req.balanceBefore,
                            detail: `Vault balance dropped from $${req.balanceBefore.toLocaleString()} to $${currentBal.toLocaleString()}`
                        };
                    }
                }
            }
        }

        // ── Strategy 2: Check Faction News Logs (fundsnews & mainnews) ──
        if (newsResult.status === 'fulfilled') {
            const newsData = newsResult.value;
            if (newsData && !newsData.error) {
                // STRICT CUTOFF: Log must have occurred AFTER the request was made!
                // Allow only up to 5 seconds before request timestamp for clock skew
                const cutoff = Math.floor((req.timestamp - 5000) / 1000);

                const newsItems = [
                    ...Object.values(newsData.fundsnews || {}),
                    ...Object.values(newsData.mainnews || {})
                ];

                for (const entry of newsItems) {
                    if (!entry || !entry.timestamp) continue;
                    if (entry.timestamp < cutoff) continue;

                    const newsRaw = String(entry.news || "");
                    const newsLower = newsRaw.toLowerCase();

                    // Must mention target by ID or name
                    const idMatched = targetId && (
                        newsLower.includes(targetId) ||
                        newsLower.includes(`xid=${targetId}`) ||
                        newsLower.includes(`[${targetId}]`) ||
                        (entry.id && String(entry.id) === targetId)
                    );
                    const nameMatched = targetName && targetName.length > 2 && newsLower.includes(targetName);

                    if (!idMatched && !nameMatched) continue;

                    // Must mention the amount
                    const amtFormatted = requiredAmount.toLocaleString();
                    const amtRaw = String(requiredAmount);
                    const amountMatched =
                        newsLower.includes(amtFormatted.toLowerCase()) ||
                        newsLower.includes(`$${amtFormatted.toLowerCase()}`) ||
                        newsLower.includes(amtRaw) ||
                        newsLower.includes(`$${amtRaw}`);

                    if (!amountMatched) continue;

                    // Action keywords
                    const isGiveAction =
                        newsLower.includes("gave") ||
                        newsLower.includes("give") ||
                        newsLower.includes("transfer") ||
                        newsLower.includes("sent") ||
                        newsLower.includes("withdr") ||
                        newsLower.includes("paid");

                    if (isGiveAction) {
                        let bankerFromLog = null;
                        const giverMatch = newsRaw.match(/<a[^>]*href=[^>]*XID=(\d+)[^>]*>([^<]+)<\/a>\s*(?:gave|transferred|sent|paid)/i);
                        if (giverMatch) {
                            bankerFromLog = giverMatch[2];
                        }

                        return {
                            verified: true,
                            source: "news",
                            entry: newsRaw,
                            bankerName: bankerFromLog
                        };
                    }
                }
            }
        }

        return { verified: false, reason: "not_found" };
    } catch(err) {
        return { verified: false, reason: err.message };
    }
}

// ── Background Polling for Log Verification ────────────────────────────────
async function verifyBankPayment(req, apiKey, botClient) {
    const maxWait = 5 * 60 * 1000;  // 5-minute window to find the payment in logs
    const pollInterval = 3500;      // high-speed 3.5s poller
    const startedAt = Date.now();

    const updateMsg = async () => {
        if (!req.channelId || !req.messageId) return;
        try {
            const chan = botClient.channels.cache.get(req.channelId)
                || await botClient.channels.fetch(req.channelId).catch(() => null);
            if (!chan) return;
            const msg = await chan.messages.fetch(req.messageId).catch(() => null);
            if (msg) await msg.edit({
                embeds: [sanitizeEmbed(buildBankRequestEmbed(req))],
                components: buildBankRequestButtons(req)
            }).catch(() => {});
        } catch(e) {}
    };

    while (Date.now() - startedAt < maxWait) {
        await new Promise(r => setTimeout(r, pollInterval));
        if (req.status !== 'verifying') return; // Cancelled, fulfilled, or reverted manually

        try {
            const check = await checkFactionLogForPayment(req, apiKey);
            if (check.verified) {
                req.status = 'fulfilled';
                req.verifiedAt = Date.now();
                if (!req.fulfilledAt) req.fulfilledAt = Date.now();
                if (!req.fulfillerName && check.bankerName) {
                    req.fulfillerName = check.bankerName;
                }
                saveBankRequests();
                await updateMsg();

                // DM requester
                try {
                    const user = await botClient.users.fetch(req.userId).catch(() => null);
                    if (user) await user.send(`✅ Your vault withdrawal of **$${Number(req.amount).toLocaleString()}** has been confirmed by @${req.fulfillerName || 'a Banker'}! Spend or deposit quickly to stay safe!`).catch(() => {});
                } catch(e) {}
                return;
            }
        } catch(e) {}
    }

    // 5 minutes elapsed and still not verified — revert to pending
    if (req.status === 'verifying') {
        const bankerId = req.fulfilledBy;
        req.status = 'pending';
        req.fulfilledBy = null;
        req.fulfillerName = null;
        req.fulfilledAt = null;
        saveBankRequests();
        await updateMsg();

        if (bankerId) {
            try {
                const bankerUser = await botClient.users.fetch(bankerId).catch(() => null);
                if (bankerUser) {
                    await bankerUser.send(
                        `⚠️ **Faction Vault Alert:** Request **#${req.id}** (\$${Number(req.amount).toLocaleString()} for **${req.tornName || 'member'}**) was **not found in Torn faction logs after 5 minutes** and has been reverted to pending.\n\nIf you already gave the cash in Torn, the payment may have been sent to the wrong person or the logs were not matching. Please check Torn and re-fulfill if needed.`
                    ).catch(() => {});
                }
            } catch(e) {}
        }
    }
}

// ── Continuous High-Speed Background Watcher for ALL Bank Requests ─────────
// Automatically monitors Torn logs & vault balances for ANY active request (pending or verifying).
// Accurately handles MULTIPLE withdrawals per user:
// - If user has $10k and $5k requests, and banker sends $10k: only the $10k request is fulfilled, $5k stays pending.
// - If banker sends $15k in one transfer: both $10k and $5k get fulfilled!
// - If banker sends $5k: only the $5k request is fulfilled!
let isAutoCheckingBank = false;
async function autoCheckActiveBankRequests() {
    if (isAutoCheckingBank) return;
    if (!slashCommandBot?.isReady?.()) return;

    const activeReqs = Object.values(bankRequests).filter(r => r.status === 'pending' || r.status === 'verifying');
    if (activeReqs.length === 0) return;

    isAutoCheckingBank = true;
    try {
        const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
        if (!apiKey) return;

        const facId = discordConfig.factionId || dynamicFactionId || "";
        const cacheBuster = Date.now();
        const donUrl = facId
            ? `https://api.torn.com/faction/${facId}?selections=donations&timestamp=${cacheBuster}&key=${apiKey}`
            : `https://api.torn.com/faction/?selections=donations&timestamp=${cacheBuster}&key=${apiKey}`;
        const newsUrl = facId
            ? `https://api.torn.com/faction/${facId}?selections=fundsnews,mainnews&timestamp=${cacheBuster}&key=${apiKey}`
            : `https://api.torn.com/faction/?selections=fundsnews,mainnews&timestamp=${cacheBuster}&key=${apiKey}`;

        // Single parallel fetch for the entire faction per cycle (saves API calls & runs in 200ms)
        const [donResult, newsResult] = await Promise.allSettled([
            fetch(donUrl, { signal: AbortSignal.timeout(6000) }).then(r => r.json()),
            fetch(newsUrl, { signal: AbortSignal.timeout(6000) }).then(r => r.json())
        ]);

        const donData = (donResult.status === 'fulfilled' && !donResult.value?.error) ? donResult.value : null;
        const newsData = (newsResult.status === 'fulfilled' && !newsResult.value?.error) ? newsResult.value : null;

        // Group active requests by target Torn ID
        const reqsByTornId = {};
        for (const req of activeReqs) {
            const tId = String(req.tornId || 'unknown');
            if (!reqsByTornId[tId]) reqsByTornId[tId] = [];
            reqsByTornId[tId].push(req);
        }

        const fulfilledToNotify = [];
        const usedNewsEntries = new Set();

        for (const [tId, userReqs] of Object.entries(reqsByTornId)) {
            // Sort oldest request first
            userReqs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

            const donor = donData?.donations?.[tId];
            const currentBal = (donor && donor.money_balance !== undefined) ? Number(donor.money_balance) : null;
            const targetName = (userReqs[0].tornName || '').trim().toLowerCase();

            // Extract relevant news entries for this player
            // STRICT: Must have occurred at or after the request was created!
            const minReqTsSec = Math.floor((Math.min(...userReqs.map(r => r.timestamp || Date.now())) - 5000) / 1000);
            const relevantNews = [];
            if (newsData) {
                const allNews = [
                    ...Object.values(newsData.fundsnews || {}),
                    ...Object.values(newsData.mainnews || {})
                ];
                for (const entry of allNews) {
                    if (!entry || !entry.timestamp || !entry.news) continue;

                    // STRICT: Discard any news entries that happened before the request was created!
                    if (entry.timestamp < minReqTsSec) continue;

                    const newsRaw = String(entry.news);
                    const newsLower = newsRaw.toLowerCase();

                    const idMatched = tId && tId !== 'unknown' && (
                        newsLower.includes(tId) ||
                        newsLower.includes(`xid=${tId}`) ||
                        newsLower.includes(`[${tId}]`) ||
                        (entry.id && String(entry.id) === tId)
                    );
                    const nameMatched = targetName && targetName.length > 2 && newsLower.includes(targetName);
                    if (!idMatched && !nameMatched) continue;

                    const isGiveAction =
                        newsLower.includes("gave") ||
                        newsLower.includes("give") ||
                        newsLower.includes("transfer") ||
                        newsLower.includes("sent") ||
                        newsLower.includes("withdr") ||
                        newsLower.includes("paid");
                    if (!isGiveAction) continue;

                    let bankerName = null;
                    const giverMatch = newsRaw.match(/<a[^>]*href=[^>]*XID=(\d+)[^>]*>([^<]+)<\/a>\s*(?:gave|transferred|sent|paid)/i);
                    if (giverMatch) bankerName = giverMatch[2];

                    relevantNews.push({ entry, newsLower, newsRaw, bankerName, ts: entry.timestamp });
                }
            }

            // ── Multi-request balance drop logic ──
            if (currentBal !== null) {
                const totalRequested = userReqs.reduce((sum, r) => sum + Number(r.amount || 0), 0);
                const baseline = Math.max(...userReqs.map(r => Number(r.balanceBefore || 0)));
                const totalPaidOut = (baseline > 0 && currentBal < baseline) ? (baseline - currentBal) : 0;

                if (totalPaidOut >= totalRequested && totalRequested > 0) {
                    // Banker paid enough to satisfy ALL pending requests! (e.g. sent 15k for 10k + 5k requests)
                    for (const r of userReqs) {
                        r.status = 'fulfilled';
                        r.verifiedAt = Date.now();
                        if (!r.fulfilledAt) r.fulfilledAt = Date.now();
                        fulfilledToNotify.push(r);
                    }
                } else if (totalPaidOut > 0) {
                    // Banker paid a partial amount.
                    // Case 1: Does totalPaidOut match ANY single request's exact amount?
                    const exactReq = userReqs.find(r => Number(r.amount) === totalPaidOut);
                    if (exactReq) {
                        exactReq.status = 'fulfilled';
                        exactReq.verifiedAt = Date.now();
                        if (!exactReq.fulfilledAt) exactReq.fulfilledAt = Date.now();
                        fulfilledToNotify.push(exactReq);

                        // For all remaining unfulfilled requests of this user, update balanceBefore to currentBal
                        for (const r of userReqs) {
                            if (r.status !== 'fulfilled') {
                                r.balanceBefore = currentBal;
                            }
                        }
                    } else {
                        // Case 2: Greedily satisfy from oldest to newest with remaining paid-out
                        let remainingPaid = totalPaidOut;
                        for (const r of userReqs) {
                            const amt = Number(r.amount || 0);
                            if (remainingPaid >= amt && amt > 0) {
                                r.status = 'fulfilled';
                                r.verifiedAt = Date.now();
                                if (!r.fulfilledAt) r.fulfilledAt = Date.now();
                                remainingPaid -= amt;
                                fulfilledToNotify.push(r);
                            } else {
                                r.balanceBefore = currentBal;
                            }
                        }
                    }
                }
            }

            // ── Cross-check News Logs for any remaining pending requests ──
            for (const r of userReqs) {
                if (r.status === 'fulfilled') continue; // already fulfilled above

                const reqAmt = Number(r.amount || 0);
                const amtFormatted = reqAmt.toLocaleString();
                const amtRaw = String(reqAmt);
                const reqTsSec = Math.floor(((r.timestamp || Date.now()) - 5000) / 1000);

                // Find a matching news log that hasn't been used AND occurred after request creation
                const matchingLog = relevantNews.find(n => {
                    if (usedNewsEntries.has(n.entry)) return false;
                    if (n.ts < reqTsSec) return false; // STRICT: log timestamp must be >= request creation timestamp
                    const amtMatched =
                        n.newsLower.includes(amtFormatted.toLowerCase()) ||
                        n.newsLower.includes(`$${amtFormatted.toLowerCase()}`) ||
                        n.newsLower.includes(amtRaw) ||
                        n.newsLower.includes(`$${amtRaw}`);
                    return amtMatched;
                });

                if (matchingLog) {
                    usedNewsEntries.add(matchingLog.entry);
                    r.status = 'fulfilled';
                    r.verifiedAt = Date.now();
                    if (!r.fulfilledAt) r.fulfilledAt = Date.now();
                    if (!r.fulfillerName && matchingLog.bankerName) {
                        r.fulfillerName = matchingLog.bankerName;
                    }
                    fulfilledToNotify.push(r);

                    // Update baseline for other pending requests
                    if (currentBal !== null) {
                        for (const other of userReqs) {
                            if (other.status !== 'fulfilled') other.balanceBefore = currentBal;
                        }
                    }
                }
            }
        }

        // Save state if any requests were fulfilled
        if (fulfilledToNotify.length > 0) {
            saveBankRequests();

            // Update Discord embeds & send DMs
            for (const req of fulfilledToNotify) {
                if (req.channelId && req.messageId) {
                    try {
                        const chan = slashCommandBot.channels.cache.get(req.channelId)
                            || await slashCommandBot.channels.fetch(req.channelId).catch(() => null);
                        if (chan) {
                            const msg = await chan.messages.fetch(req.messageId).catch(() => null);
                            if (msg) {
                                await msg.edit({
                                    embeds: [sanitizeEmbed(buildBankRequestEmbed(req))],
                                    components: buildBankRequestButtons(req) // Returns [] (no buttons)
                                }).catch(() => {});
                            }
                        }
                    } catch(e) {}
                }

                try {
                    const user = await slashCommandBot.users.fetch(req.userId).catch(() => null);
                    if (user) {
                        const bankerLabel = req.fulfillerName ? `@${req.fulfillerName}` : 'a Banker';
                        await user.send(`✅ Your vault withdrawal of **$${Number(req.amount).toLocaleString()}** has been confirmed by ${bankerLabel}! Spend or deposit quickly to stay safe!`).catch(() => {});
                    }
                } catch(e) {}
            }
        }
    } catch(err) {
        // Ignore transient errors
    } finally {
        isAutoCheckingBank = false;
    }
}

// Check every 3.5 seconds for instant near-realtime detection
setInterval(autoCheckActiveBankRequests, 3500);

// ── Automated F.R.I.D.A.Y Organized Crime (OC) Background Watcher ─────────────
let ocAlertTracker = {};
let isCheckingOc = false;

async function checkFactionOrganizedCrimes() {
    if (isCheckingOc) return;
    if (global.isNotificationsKilled) return;

    const botToken = discordConfig.globalBotToken;
    const channelId = ocConfig.globalChannelId || discordConfig.globalChannelId;
    if (!botToken || !channelId) return;

    const apiKey = discordConfig.apiKey || discordConfig.ffKey || TORN_API_KEY || getNextApiKey();
    if (!apiKey) return;

    isCheckingOc = true;
    try {
        const res = await fetch(`https://api.torn.com/faction/?selections=crimes,basic&key=${apiKey}&timestamp=${Date.now()}`, {
            signal: AbortSignal.timeout(9000)
        });
        const data = await res.json();
        if (!data || data.error || !data.crimes) return;

        const members = data.members || {};
        const now = Math.floor(Date.now() / 1000);
        const mention = ocConfig.roleId ? `<@&${ocConfig.roleId}>` : "";
        const upcomingSec = (ocConfig.upcomingMinutes || 30) * 60;

        for (const [crimeId, crime] of Object.entries(data.crimes)) {
            if (!crime) continue;
            if (!ocAlertTracker[crimeId]) {
                ocAlertTracker[crimeId] = {};
            }
            const tracker = ocAlertTracker[crimeId];

            // Resolve participant details and unavailable members
            const participantDetails = [];
            let unavailableMembers = [];

            for (const p of (crime.participants || [])) {
                let pId = null;
                if (p && typeof p === 'object') {
                    pId = p.player_id || Object.keys(p)[0];
                } else if (p) {
                    pId = String(p);
                }
                if (!pId) continue;
                pId = String(pId);

                const memberObj = members[pId];
                const pName = memberObj?.name || `Player [${pId}]`;
                const pState = memberObj?.status?.state || 'Okay';
                const pDesc = memberObj?.status?.description || '';
                const pUntil = memberObj?.status?.until ? Math.floor(memberObj.status.until) : null;

                participantDetails.push({ id: pId, name: pName, state: pState, desc: pDesc, until: pUntil });

                if (pState.toLowerCase() !== 'okay') {
                    unavailableMembers.push({ id: pId, name: pName, state: pState, desc: pDesc, until: pUntil });
                }
            }

            const pListMarkdown = participantDetails.map(p => `• [${p.name} [${p.id}]](https://www.torn.com/profiles.php?XID=${p.id})`).join('\n') || '• *Slots filling...*';

            // ── TRIGGER 1: OC Planned ──────────────────────────────────────────
            if (crime.initiated === 0 && !tracker.planned && (ocConfig.alertPlanned !== false)) {
                if (crime.time_started && (now - crime.time_started < 7200)) {
                    tracker.planned = true;
                    const plannerObj = members[String(crime.planned_by)];
                    const plannerName = plannerObj?.name ? `${plannerObj.name} [${crime.planned_by}]` : `Player [${crime.planned_by}]`;
                    const readyTimeStr = crime.time_ready ? `<t:${crime.time_ready}:F> (<t:${crime.time_ready}:R>)` : "Unknown";

                    await sendChannelMessage(botToken, channelId, {
                        title: `📋 OC Scheduled: ${crime.crime_name}`,
                        description: `A new Organized Crime has been scheduled for **Spider-Verse**!\n\n` +
                                     `**Target Ready Time:** ${readyTimeStr}\n` +
                                     `**Planned By:** [${plannerName}](https://www.torn.com/profiles.php?XID=${crime.planned_by})\n\n` +
                                     `**Assigned Roster:**\n${pListMarkdown}\n\n` +
                                     `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                        color: 0x70a1ff,
                        footer: { text: "F.R.I.D.A.Y • Organized Crime Intelligence" }
                    }, mention).catch(() => {});
                } else {
                    tracker.planned = true;
                }
            }

            // ── TRIGGER 2: OC Upcoming ─────────────────────────────────────────
            const timeLeft = crime.time_left !== undefined ? crime.time_left : (crime.time_ready ? (crime.time_ready - now) : 9999);
            if (crime.initiated === 0 && timeLeft > 0 && timeLeft <= upcomingSec && !tracker.upcoming && (ocConfig.alertUpcoming !== false)) {
                tracker.upcoming = true;
                await sendChannelMessage(botToken, channelId, {
                    title: `⏳ OC Upcoming: ${crime.crime_name}`,
                    description: `Crime is scheduled to become ready in **<t:${crime.time_ready}:R>** (<t:${crime.time_ready}:t>)!\n\n` +
                                 `⚠️ **Attention Team Members:** Please stay out of hospital, avoid traveling, and remain in Torn City:\n` +
                                 `${pListMarkdown}\n\n` +
                                 `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                    color: 0xffa502,
                    footer: { text: "F.R.I.D.A.Y • Organized Crime Intelligence" }
                }, mention).catch(() => {});
            }

            // ── TRIGGER 3 & 4: OC Ready vs OC Delayed ──────────────────────────
            const isReadyTime = (crime.time_ready && now >= crime.time_ready) || crime.time_left === 0 || crime.ready === 1;

            if (crime.initiated === 0 && isReadyTime) {
                if (unavailableMembers.length > 0) {
                    // Delayed: Participants holding up team!
                    if (!tracker.delayed && (ocConfig.alertDelayed !== false)) {
                        tracker.delayed = true;
                        const delayLines = unavailableMembers.map(u => {
                            const untilStr = u.until ? ` · Free <t:${u.until}:R>` : '';
                            return `• ❌ **[${u.name} [${u.id}]](https://www.torn.com/profiles.php?XID=${u.id})**: **${u.state}** (${u.desc}${untilStr})`;
                        }).join('\n');

                        await sendChannelMessage(botToken, channelId, {
                            title: `🚨 OC Delayed: ${crime.crime_name}`,
                            description: `Crime countdown reached zero, but **team cannot launch** because participant(s) are unavailable:\n\n` +
                                         `${delayLines}\n\n` +
                                         `Team members must med out, bust, or land before the crime can be initiated.\n\n` +
                                         `👉 [Open Faction Crimes Tab](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                            color: 0xff4757,
                            footer: { text: "F.R.I.D.A.Y • Organized Crime Intelligence" }
                        }, mention).catch(() => {});
                    }
                } else {
                    // Ready: All team members present and clear!
                    if (!tracker.ready && (ocConfig.alertReady !== false)) {
                        tracker.ready = true;
                        await sendChannelMessage(botToken, channelId, {
                            title: `🟢 OC Ready to Launch: ${crime.crime_name}`,
                            description: `All team members are in Torn City and available! Planner can initiate the crime now.\n\n` +
                                         `**Team:**\n${pListMarkdown}\n\n` +
                                         `👉 [Initiate Organized Crime](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                            color: 0x2ed573,
                            footer: { text: "F.R.I.D.A.Y • Organized Crime Intelligence" }
                        }, mention).catch(() => {});
                    }
                }
            }

            // ── TRIGGER 5: OC Completed / Outcome Report ───────────────────────
            if (crime.initiated === 1 && (crime.time_completed > 0 || crime.success !== undefined) && !tracker.completed && (ocConfig.alertCompleted !== false)) {
                if (crime.time_completed && (now - crime.time_completed < 3600)) {
                    tracker.completed = true;
                    const isSuccess = crime.success === 1;
                    const moneyGain = crime.money_gain ? `$${Number(crime.money_gain).toLocaleString()}` : '$0';
                    const respectGain = crime.respect_gain || 0;

                    await sendChannelMessage(botToken, channelId, {
                        title: isSuccess ? `🎉 OC Success: ${crime.crime_name}!` : `💥 OC Failed: ${crime.crime_name}`,
                        description: isSuccess
                            ? `The team successfully executed **${crime.crime_name}**!\n\n` +
                              `💰 **Payout:** +${moneyGain} deposited into faction vault\n` +
                              `🏆 **Respect:** +${respectGain} Faction Respect\n\n` +
                              `**Team:**\n${pListMarkdown}`
                            : `The team failed **${crime.crime_name}**.\n\n` +
                              `Participants may have been sent to jail or hospital.\n\n` +
                              `**Team:**\n${pListMarkdown}`,
                        color: isSuccess ? 0x2ed573 : 0xff4757,
                        footer: { text: "F.R.I.D.A.Y • Organized Crime Intelligence" }
                    }, mention).catch(() => {});
                } else {
                    tracker.completed = true;
                }
            }
        }
    } catch(err) {
        // Transient API errors ignored
    } finally {
        isCheckingOc = false;
    }
}

setInterval(checkFactionOrganizedCrimes, 30000);
setTimeout(checkFactionOrganizedCrimes, 15000);

// ── Render Free-Tier Keepalive Pinger ──────────────────────────────────────
// Pings the public endpoint every 9 minutes to prevent Render's free tier
// from spinning down into a 50-second cold-boot slumber during inactivity!
setInterval(async () => {
    try {
        const pingUrl = process.env.RENDER_EXTERNAL_URL
            ? `${process.env.RENDER_EXTERNAL_URL}/api/discord/killswitch-status`
            : `https://spider-verse.net/api/discord/killswitch-status`;
        await fetch(pingUrl, { signal: AbortSignal.timeout(6000) });
    } catch(e) {}
}, 9 * 60 * 1000);

async function executeFulfillRequest(reqId, interaction) {
    const req = bankRequests[reqId];
    if (!req) {
        return { success: false, message: "⚠️ Bank request not found or expired." };
    }

    // Check banker role permission if configured
    if (discordConfig.bankerRoleId && interaction.member?.roles?.cache) {
        const hasRole = interaction.member.roles.cache.has(discordConfig.bankerRoleId) ||
                        interaction.member.permissions?.has?.('Administrator');
        if (!hasRole) {
            return { success: false, message: `⚠️ Only members with the <@&${discordConfig.bankerRoleId}> role can fulfill bank requests.` };
        }
    }

    // Check status
    if (req.status !== 'pending' && req.status !== 'verifying') {
        if (req.status === 'fulfilled') {
            return { success: false, message: `⚠️ Request **#${reqId}** was already fulfilled by <@${req.fulfilledBy}> (<t:${Math.floor(req.fulfilledAt / 1000)}:R>).` };
        } else {
            return { success: false, message: `⚠️ Request **#${reqId}** is no longer pending (status: **${req.status}**).` };
        }
    }

    const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();

    // Set fulfilledBy & fulfilledAt BEFORE checking logs so the log cutoff is accurate
    // (the banker clicks Fulfill, then we look back in logs — we need this timestamp)
    req.fulfilledBy = interaction.user.id;
    req.fulfillerName = interaction.user.username;
    req.fulfilledAt = Date.now();

    const check = await checkFactionLogForPayment(req, apiKey);

    if (check.verified) {
        req.status = 'fulfilled';
        req.verifiedAt = Date.now();
        saveBankRequests();

        if (req.channelId && req.messageId) {
            try {
                const targetChan = interaction.client.channels.cache.get(req.channelId)
                    || await interaction.client.channels.fetch(req.channelId).catch(() => null);
                const targetMsg = targetChan && await targetChan.messages.fetch(req.messageId).catch(() => null);
                if (targetMsg) {
                    await targetMsg.edit({
                        embeds: [sanitizeEmbed(buildBankRequestEmbed(req))],
                        components: buildBankRequestButtons(req)
                    }).catch(() => {});
                }
            } catch(e) {}
        }

        try {
            const user = await interaction.client.users.fetch(req.userId).catch(() => null);
            if (user) await user.send(`✅ Your vault withdrawal of **$${Number(req.amount).toLocaleString()}** has been confirmed by @${req.fulfillerName}! Spend or deposit quickly to stay safe!`).catch(() => {});
        } catch(e) {}

        return {
            success: true,
            verified: true,
            message: `✅ **Verified in Torn Faction Logs!**\nPayment of **$${Number(req.amount).toLocaleString()}** to **${req.tornName || req.userName} [${req.tornId}]** confirmed. Request **#${req.id}** is now fulfilled.`
        };
    }

    // Not verified yet — transition to verifying state, start background poller
    req.status = 'verifying';
    saveBankRequests();

    if (req.channelId && req.messageId) {
        try {
            const targetChan = interaction.client.channels.cache.get(req.channelId)
                || await interaction.client.channels.fetch(req.channelId).catch(() => null);
            const targetMsg = targetChan && await targetChan.messages.fetch(req.messageId).catch(() => null);
            if (targetMsg) {
                await targetMsg.edit({
                    embeds: [sanitizeEmbed(buildBankRequestEmbed(req))],
                    components: buildBankRequestButtons(req)
                }).catch(() => {});
            }
        } catch(e) {}
    }

    // Start background poller (5 minutes)
    verifyBankPayment(req, apiKey, interaction.client).catch(() => {});

    const prefilledUrl = getPreFilledVaultUrl(req.tornId, req.amount);
    return {
        success: true,
        verified: false,
        message: `⏳ **Payment not detected in Torn faction logs yet.**\n\n` +
                 `• If you haven't given the cash yet, please go give it in Torn now: [💸 Open Pre-filled Vault](${prefilledUrl})\n` +
                 `• The bot is watching faction logs and will **automatically mark this fulfilled** once Torn registers the transfer (up to 5 minutes).\n` +
                 `• If no payment appears after 5 minutes, it will revert to pending.`
    };
}

async function executeCancelRequest(reqId, interaction) {
    const req = bankRequests[reqId];
    if (!req) {
        return { success: false, message: "⚠️ Bank request not found or expired." };
    }

    const isRequester = (interaction.user.id === req.userId);
    const isBankerOrAdmin = (discordConfig.bankerRoleId && interaction.member?.roles?.cache?.has(discordConfig.bankerRoleId)) ||
                            interaction.member?.permissions?.has?.('Administrator');
    if (!isRequester && !isBankerOrAdmin) {
        return { success: false, message: `⚠️ Only <@${req.userId}> or a banker/admin can cancel this request.` };
    }

    if (req.status !== 'pending') {
        return { success: false, message: `⚠️ Request **#${reqId}** is already ${req.status}.` };
    }

    req.status = 'cancelled';
    req.cancelledBy = interaction.user.id;
    req.cancellerName = interaction.user.username;
    req.cancelledAt = Date.now();
    saveBankRequests();

    const updatedEmbed = buildBankRequestEmbed(req);
    const updatedButtons = buildBankRequestButtons(req);

    if (req.channelId && req.messageId) {
        try {
            const targetChan = interaction.client.channels.cache.get(req.channelId)
                || await interaction.client.channels.fetch(req.channelId).catch(() => null);
            if (targetChan) {
                const targetMsg = await targetChan.messages.fetch(req.messageId).catch(() => null);
                if (targetMsg) {
                    await targetMsg.edit({
                        embeds: [sanitizeEmbed(updatedEmbed)],
                        components: updatedButtons
                    }).catch(() => {});
                }
            }
        } catch(e) {}
    }

    return { success: true, message: `✅ Request **#${reqId}** has been cancelled.` };
}

async function buildVaultBalanceEmbed(apiKey, targetQuery = null, requestingUser = null) {
    if (!apiKey) {
        return { title: "🏦 Faction Vault Balance", description: "⚠️ Torn API Key is not configured.", color: 0xff4757 };
    }
    try {
        const facId = discordConfig.factionId || dynamicFactionId || "";
        const url = facId ? `https://api.torn.com/faction/${facId}?selections=basic,donations&key=${apiKey}` : `https://api.torn.com/faction/?selections=basic,donations&key=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();

        if (data.error) {
            return { title: "🏦 Faction Vault Balance", description: `⚠️ Torn API Error: ${data.error.error}`, color: 0xff4757 };
        }

        const donations = data.donations || {};
        const members = data.members || {};
        const donorEntries = Object.entries(donations);

        let targetId = null;
        let targetDonor = null;

        if (targetQuery) {
            const cleanQuery = String(targetQuery).trim().toLowerCase();
            const numeric = cleanQuery.replace(/[^0-9]/g, '');
            if (numeric && donations[numeric]) {
                targetId = numeric;
                targetDonor = donations[numeric];
            } else {
                for (const [dId, donor] of donorEntries) {
                    const dName = (donor.name || '').toLowerCase();
                    if (dName.includes(cleanQuery) || cleanQuery.includes(dName)) {
                        targetId = dId;
                        targetDonor = donor;
                        break;
                    }
                }
            }
        } else if (requestingUser) {
            // Try to match requesting discord user
            const uName = (requestingUser.username || requestingUser.displayName || '').toLowerCase();
            for (const [dId, donor] of donorEntries) {
                const dName = (donor.name || '').toLowerCase();
                if (dName && (uName.includes(dName) || dName.includes(uName))) {
                    targetId = dId;
                    targetDonor = donor;
                    break;
                }
            }
        }

        const vaultControlsLink = "https://www.torn.com/factions.php?step=your#/tab=controls";

        if (targetDonor && targetId) {
            const moneyBal = Number(targetDonor.money_balance || 0);
            const pointsBal = Number(targetDonor.points_balance || 0);
            return {
                title: `🏦 Vault Balance — ${targetDonor.name} [${targetId}]`,
                description: `**Faction:** ${data.name || 'Faction'}\n` +
                             `**Player:** [**${targetDonor.name}** [${targetId}]](https://www.torn.com/profiles.php?XID=${targetId})\n\n` +
                             `💵 **Money Balance:** **$${moneyBal.toLocaleString()}**\n` +
                             `✨ **Points Balance:** **${pointsBal.toLocaleString()}** pts\n\n` +
                             `👉 [Open Faction Vault in Torn](${vaultControlsLink})`,
                color: moneyBal > 0 ? 0x2ed573 : 0x747d8c,
                footer: { text: "Owen's Faction Tools • Faction Vault" },
                timestamp: new Date().toISOString()
            };
        }

        // Summary of top vault balances
        const topBalances = donorEntries
            .map(([dId, d]) => ({ id: dId, name: d.name, money: Number(d.money_balance || 0), points: Number(d.points_balance || 0) }))
            .filter(d => d.money > 0 || d.points > 0)
            .sort((a, b) => b.money - a.money)
            .slice(0, 10);

        const lines = topBalances.map((d, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${idx + 1}**`;
            return `${medal} [**${d.name}** [${d.id}]](https://www.torn.com/profiles.php?XID=${d.id}) — **$${d.money.toLocaleString()}** (${d.points.toLocaleString()} pts)`;
        }).join('\n');

        return {
            title: `🏦 ${data.name || 'Faction'} — Vault Balances`,
            description: (targetQuery ? `⚠️ Member **"${targetQuery}"** not found in faction donations.\n\n` : '') +
                         `**Top Member Vault Balances:**\n\n` +
                         (lines || "*No member vault deposits recorded.*") +
                         `\n\n👉 [Open Faction Vault in Torn](${vaultControlsLink})`,
            color: 0x2ed573,
            footer: { text: "Use /balance <member> to check a specific player" }
        };
    } catch(e) {
        return { title: "🏦 Faction Vault Balance", description: `⚠️ Error fetching balance: ${e.message}`, color: 0xff4757 };
    }
}

async function buildMissingDiscordEmbed(guild, apiKey) {
    if (!apiKey) {
        return { title: "📋 Faction Discord Audit", description: "⚠️ Torn API Key is not configured.", color: 0xff4757 };
    }
    if (!guild) {
        return { title: "📋 Faction Discord Audit", description: "⚠️ This command must be executed inside a Discord server.", color: 0xff4757 };
    }

    try {
        const facId = discordConfig.factionId || dynamicFactionId || "";
        const url = facId ? `https://api.torn.com/faction/${facId}?selections=basic&key=${apiKey}` : `https://api.torn.com/faction/?selections=basic&key=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const facData = await res.json();

        if (facData.error) {
            return { title: "📋 Faction Discord Audit", description: `⚠️ Torn API Error: ${facData.error.error}`, color: 0xff4757 };
        }

        const factionName = facData.name || "Faction";
        const members = facData.members || {};
        const memberList = Object.entries(members).map(([id, m]) => ({ id, ...m }));

        if (memberList.length === 0) {
            return { title: `📋 ${factionName} — Discord Audit`, description: "⚠️ No faction members returned from Torn API.", color: 0xffa502 };
        }

        // Fetch Discord guild members
        let guildMembers = null;
        try {
            guildMembers = await guild.members.fetch();
        } catch(err) {
            console.warn("[Discord Audit] guild.members.fetch() failed, using cache:", err.message);
            guildMembers = guild.members.cache;
        }

        const discordMemberData = [];
        for (const [gmId, gm] of guildMembers) {
            discordMemberData.push({
                id: gmId,
                displayName: (gm.displayName || '').toLowerCase(),
                nickname: (gm.nickname || '').toLowerCase(),
                username: (gm.user?.username || '').toLowerCase(),
                globalName: (gm.user?.globalName || '').toLowerCase(),
                rawName: gm.displayName || gm.user?.username || ''
            });
        }

        const matched = [];
        const missing = [];

        for (const m of memberList) {
            const mId = String(m.id);
            const mName = (m.name || '').toLowerCase();
            const idRegex = new RegExp(`\\[\\s*${mId}\\s*\\]|\\(\\s*${mId}\\s*\\)|\\b${mId}\\b`);

            const foundGm = discordMemberData.find(gm => {
                if (idRegex.test(gm.displayName) || idRegex.test(gm.nickname) || idRegex.test(gm.username) || idRegex.test(gm.globalName)) {
                    return true;
                }
                if (gm.displayName === mName || gm.nickname === mName || gm.username === mName || gm.globalName === mName) {
                    return true;
                }
                const cleanedDisp = gm.displayName.replace(/[^a-z0-9]/g, ' ').split(' ')[0];
                if (cleanedDisp && cleanedDisp === mName) {
                    return true;
                }
                return false;
            });

            if (foundGm) {
                matched.push({ ...m, discordTag: foundGm.rawName });
            } else {
                missing.push(m);
            }
        }

        const total = memberList.length;
        const matchedPct = Math.round((matched.length / total) * 100);
        const missingPct = Math.round((missing.length / total) * 100);

        if (missing.length === 0) {
            return {
                title: `🎉 ${factionName} — 100% In Discord!`,
                description: `All **${total}** members of **${factionName}** were detected in this Discord server!\n\n` +
                             `✅ **In Discord:** **${matched.length}** / **${total}** (100%)\n` +
                             `⚠️ **Missing:** **0**`,
                color: 0x2ed573,
                footer: { text: "Spider-Verse Faction Tools • Discord Member Audit" },
                timestamp: new Date().toISOString()
            };
        }

        // Sort missing members by days in faction descending
        missing.sort((a, b) => (b.days_in_faction || 0) - (a.days_in_faction || 0));

        const missingLines = missing.map(m => {
            const lastAct = m.last_action?.relative || m.last_action?.status || 'Unknown';
            const days = m.days_in_faction ? `${m.days_in_faction}d in fac` : '';
            const lvl = m.level ? `Lvl ${m.level}` : '';
            const meta = [lvl, days, lastAct].filter(Boolean).join(' · ');
            return `• [**${m.name}** [${m.id}]](https://www.torn.com/profiles.php?XID=${m.id}) (${meta})`;
        });

        // Chunk missing members into clean fields so Discord embed limits are respected
        const fields = [];
        let currentChunk = [];
        let currentLength = 0;
        let fieldIndex = 1;

        for (const line of missingLines) {
            if (fields.length >= 24) {
                currentChunk.push(`*...and ${missingLines.length - missing.indexOf(line)} more members*`);
                break;
            }
            if (currentLength + line.length + 1 > 950) {
                fields.push({
                    name: fieldIndex === 1 ? `⚠️ Missing Members (${missing.length})` : `⚠️ Missing Members (Cont.)`,
                    value: currentChunk.join('\n'),
                    inline: false
                });
                currentChunk = [line];
                currentLength = line.length;
                fieldIndex++;
            } else {
                currentChunk.push(line);
                currentLength += line.length + 1;
            }
        }
        if (currentChunk.length > 0 && fields.length < 25) {
            fields.push({
                name: fieldIndex === 1 ? `⚠️ Missing Members (${missing.length})` : `⚠️ Missing Members (Cont.)`,
                value: currentChunk.join('\n'),
                inline: false
            });
        }

        const intentWarning = guildMembers.size < 5 && total > 10
            ? "\n\n*💡 Tip: Enable 'Server Members Intent' in the Discord Developer Portal so the bot can fetch all server members accurately.*"
            : "";

        return {
            title: `📋 ${factionName} — Discord Member Audit`,
            description: `**Faction Audit Summary:**\n` +
                         `👥 **Total Faction Members:** **${total}**\n` +
                         `✅ **Present in Discord:** **${matched.length}** (${matchedPct}%)\n` +
                         `⚠️ **Missing from Discord:** **${missing.length}** (${missingPct}%)${intentWarning}`,
            fields: fields.slice(0, 25),
            color: 0xffa502,
            footer: { text: "Spider-Verse Faction Tools • Discord Member Audit" },
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "📋 Faction Discord Audit", description: `⚠️ Error during audit: ${e.message}`, color: 0xff4757 };
    }
}

function buildPendingRequestsEmbed() {
    const pendingList = Object.values(bankRequests)
        .filter(r => r.status === 'pending')
        .sort((a, b) => b.timestamp - a.timestamp);

    if (pendingList.length === 0) {
        return {
            title: "🏦 Pending Vault Requests",
            description: "✅ There are currently **no pending vault requests**.\n\nFaction members can request funds with `/withdraw <amount> [reason]`.",
            color: 0x2ed573,
            footer: { text: "Owen's Faction Tools • Faction Vault Banking" }
        };
    }

    const lines = pendingList.map(r => {
        const timeAgo = `<t:${Math.floor(r.timestamp / 1000)}:R>`;
        const reasonStr = r.reason ? ` · "${r.reason}"` : '';
        return `• **Request #${r.id}**: **$${Number(r.amount).toLocaleString()}** by <@${r.userId}> (${timeAgo})${reasonStr}`;
    }).slice(0, 20).join('\n\n');

    return {
        title: `🏦 Pending Vault Requests (${pendingList.length})`,
        description: lines + `\n\n👉 [Open Faction Vault in Torn](https://www.torn.com/factions.php?step=your#/tab=controls&option=give-to-user)`,
        color: 0xffa502,
        footer: { text: "Bankers can fulfill requests using the buttons on the request messages" }
    };
}

// ─── Register Slash Commands with Discord ─────────────────────────────────────
async function registerSlashCommands(token, guildId = null) {
    const rest = new REST({ version: '10' }).setToken(token);

    const commands = [
        // 1. Vault Banking
        new SlashCommandBuilder().setName('withdraw').setDescription('Request money from the faction vault (with overdraft protection)')
            .addStringOption(opt => opt.setName('amount').setDescription('Amount to request (e.g. 10m, 500k, 25000000)').setRequired(true).setAutocomplete(true)).toJSON(),

        new SlashCommandBuilder().setName('balance').setDescription('Check faction vault balance and donations')
            .addStringOption(opt => opt.setName('member').setDescription('Member name or ID (leave blank for yourself or leaderboard)')).toJSON(),

        // 2. Faction Discord Member Audit
        new SlashCommandBuilder().setName('notindiscord').setDescription('Audit faction members: list who is not in this Discord server').toJSON(),

        // 3. War & Combat Intelligence
        new SlashCommandBuilder().setName('war').setDescription('Show live ranked war status, scores, lead, and top war hitters').toJSON(),
        new SlashCommandBuilder().setName('targets').setDescription('List priority enemy targets attackable in Torn right now').toJSON(),
        new SlashCommandBuilder().setName('spy').setDescription('Look up battle stats & spy records for a player')
            .addStringOption(opt => opt.setName('target').setDescription('Torn Player ID or Name').setRequired(true)).toJSON(),

        // 4. Chain Management
        new SlashCommandBuilder().setName('chain').setDescription('Check live faction chain status, timer, and multiplier').toJSON(),
        new SlashCommandBuilder().setName('oc').setDescription('Check live Organized Crimes status, ready teams, and delayed members').toJSON(),

        // 5. Player Intelligence
        new SlashCommandBuilder().setName('profile').setDescription('View comprehensive player profile, status, and stats')
            .addStringOption(opt => opt.setName('player').setDescription('Torn Player ID or Name').setRequired(true)).toJSON(),

        // 6. Consolidated Faction Management Suite
        new SlashCommandBuilder().setName('faction').setDescription('Faction intelligence, readiness, and management suite')
            .addSubcommand(sub => sub.setName('roster').setDescription('Live faction readiness breakdown (Online, Traveling, Hospital)'))
            .addSubcommand(sub => sub.setName('hospital').setDescription('List friendly faction members currently hospitalized'))
            .addSubcommand(sub => sub.setName('inactive').setDescription('List faction members inactive for 1+ days'))
            .addSubcommand(sub => sub.setName('notindiscord').setDescription('List faction members not in this Discord server'))
            .addSubcommand(sub => sub.setName('oc').setDescription('Summary of Organized Crimes status and ready teams'))
            .addSubcommand(sub => sub.setName('payout').setDescription('Check member war payout balance')
                .addStringOption(opt => opt.setName('member').setDescription('Member name or ID (optional)')))
            .addSubcommand(sub => sub.setName('mvp').setDescription('Leaderboard of top war hitters'))
            .addSubcommand(sub => sub.setName('stats').setDescription('Battle stats roster comparison')
                .addStringOption(opt => opt.setName('side').setDescription('Select faction').addChoices(
                    { name: '🎯 Enemy Faction', value: 'enemy' },
                    { name: '🛡️ Our Faction', value: 'friendly' }
                )))
            .addSubcommand(sub => sub.setName('bounties').setDescription('Track active war bounties placed and claimed'))
            .addSubcommand(sub => sub.setName('flights').setDescription('Audit war flight uptime and travel sentinel')).toJSON(),

        // 7. Travel & Item Stocks
        new SlashCommandBuilder().setName('travel').setDescription('Overseas destination status & item stock (Plushies & Flowers)')
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

        // 8. Bazaar & Market
        new SlashCommandBuilder().setName('bazaar').setDescription('Check lowest Torn market price & bazaar stats for an item')
            .addStringOption(opt => opt.setName('item').setDescription('Item name or ID').setRequired(true)).toJSON(),

        // 9. Alert Controls
        new SlashCommandBuilder().setName('alerts').setDescription('Manage automated Discord faction alert notifications')
            .addSubcommand(sub => sub.setName('status').setDescription('Check alert notifications status'))
            .addSubcommand(sub => sub.setName('pause').setDescription('Temporarily pause all automated alerts'))
            .addSubcommand(sub => sub.setName('resume').setDescription('Resume automated alerts')).toJSON()
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
            // Wipe global commands so Discord doesn't display duplicate entries in this guild
            await rest.put(Routes.applicationCommands(applicationId), { body: [] }).catch(() => {});
            if (slashCommandBot?.isReady?.()) {
                for (const gId of slashCommandBot.guilds.cache.keys()) {
                    if (gId !== guildId) {
                        await rest.put(Routes.applicationGuildCommands(applicationId, gId), { body: [] }).catch(() => {});
                    }
                }
            }
        } else {
            await rest.put(Routes.applicationCommands(applicationId), { body: commands });
            console.log(`[Slash Commands] Registered ${commands.length} global commands`);
            // Wipe guild commands from known guilds so Discord doesn't display duplicate entries
            if (discordConfig.guildId) {
                await rest.put(Routes.applicationGuildCommands(applicationId, discordConfig.guildId), { body: [] }).catch(() => {});
            }
            if (slashCommandBot?.isReady?.()) {
                for (const gId of slashCommandBot.guilds.cache.keys()) {
                    await rest.put(Routes.applicationGuildCommands(applicationId, gId), { body: [] }).catch(() => {});
                }
            }
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

function setupSlashBotEvents(bot, token) {
    bot.once(Events.ClientReady, async (c) => {
        console.log(`[Slash Bot] Ready as ${c.user.tag}`);
        slashBotStarted = true;

        try {
            if (c.user.username !== 'F.R.I.D.A.Y') {
                await c.user.setUsername('F.R.I.D.A.Y').catch(() => {});
            }
        } catch(e) {}

        // Automatically register slash commands without duplicates
        try {
            const targetGuild = discordConfig.guildId;
            if (targetGuild) {
                console.log(`[Slash Bot] Registering guild slash commands for server ${targetGuild}...`);
                await registerSlashCommands(token, targetGuild);
            } else {
                const guilds = Array.from(c.guilds.cache.keys());
                if (guilds.length === 1) {
                    console.log(`[Slash Bot] Single server detected (${guilds[0]}). Registering guild commands for instant availability...`);
                    await registerSlashCommands(token, guilds[0]);
                } else {
                    console.log(`[Slash Bot] Registering global slash commands across ${guilds.length} server(s)...`);
                    await registerSlashCommands(token, null);
                }
            }
            console.log(`[Slash Bot] Slash commands auto-registered successfully with no duplicates!`);
        } catch(e) {
            console.warn("[Slash Bot] Startup registration error:", e.message);
        }
    });

    bot.on(Events.MessageCreate, async (msg) => {
        if (msg.author?.bot) return;
        const text = (msg.content || '').trim().toLowerCase();
        const isKill = text === '!kill' || text === '/kill' || text === '!mute' || text === '!pause' || text === '/pause' || (text.startsWith('kill') && msg.mentions?.has?.(bot.user));
        const isLive = text === '!live' || text === '/live' || text === '!resume' || text === '/resume' || (text.startsWith('live') && msg.mentions?.has?.(bot.user));

        if (isKill) {
            const actor = msg.author?.username || "Admin";
            const embed = handleKillCommand(actor);
            return msg.reply({ embeds: [sanitizeEmbed(embed)] }).catch(() => {});
        }
        if (isLive) {
            const actor = msg.author?.username || "Admin";
            const embed = handleLiveCommand(actor);
            return msg.reply({ embeds: [sanitizeEmbed(embed)] }).catch(() => {});
        }
    });

    bot.on(Events.InteractionCreate, async (interaction) => {

        // ── Amount Autocomplete for /withdraw ──
        if (interaction.isAutocomplete()) {
            const cmd = interaction.commandName;
            const focusedOption = interaction.options.getFocused(true);
            if (cmd === 'withdraw' && focusedOption.name === 'amount') {
                const typed = (focusedOption.value || '').replace(/[$,\s]/g, '');
                const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();

                // Build smart preset suggestions based on vault balance if possible
                let userBalance = null;
                try {
                    const vaultInfo = await getFactionVaultAndMember(apiKey, interaction);
                    if (vaultInfo && vaultInfo.totalBalance > 0) userBalance = vaultInfo.totalBalance;
                } catch(e) {}

                // Generate nicely formatted amount suggestions
                const formatAmt = (n) => {
                    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}b`;
                    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m`;
                    if (n >= 1_000) return `$${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 0)}k`;
                    return `$${n.toLocaleString()}`;
                };

                let suggestions = [];

                // If user has a balance, offer smart presets
                if (userBalance) {
                    const presets = [
                        userBalance,
                        Math.floor(userBalance * 0.75),
                        Math.floor(userBalance * 0.5),
                        Math.floor(userBalance * 0.25),
                        5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000
                    ].filter((n, i, arr) => n > 0 && n <= userBalance && arr.indexOf(n) === i)
                     .sort((a, b) => b - a)
                     .slice(0, 9);

                    suggestions = presets.map(n => ({
                        name: `${formatAmt(n)} ($${n.toLocaleString()})${n === userBalance ? ' ← Full Balance' : ''}`,
                        value: String(n)
                    }));
                } else {
                    // Fallback generic presets
                    suggestions = [
                        { name: '$500,000', value: '500000' },
                        { name: '$1,000,000 (1m)', value: '1000000' },
                        { name: '$2,500,000 (2.5m)', value: '2500000' },
                        { name: '$5,000,000 (5m)', value: '5000000' },
                        { name: '$10,000,000 (10m)', value: '10000000' },
                        { name: '$25,000,000 (25m)', value: '25000000' },
                        { name: '$50,000,000 (50m)', value: '50000000' },
                        { name: '$100,000,000 (100m)', value: '100000000' },
                        { name: '$250,000,000 (250m)', value: '250000000' }
                    ];
                }

                // If the user is typing a number, filter and show a live-formatted match at top
                if (typed && /^\d/.test(typed)) {
                    const parsed = parseInt(typed.replace(/[^0-9]/g, ''), 10);
                    if (!isNaN(parsed) && parsed > 0) {
                        const liveEntry = {
                            name: `$${parsed.toLocaleString()} (${formatAmt(parsed)})`,
                            value: String(parsed)
                        };
                        suggestions = [liveEntry, ...suggestions.filter(s => s.value !== String(parsed))].slice(0, 25);
                    }
                }

                return interaction.respond(suggestions.slice(0, 25)).catch(() => {});
            }
            return interaction.respond([]).catch(() => {});
        }

        // ── Interactive Button Click Handler ──
        if (interaction.isButton()) {

            const customId = interaction.customId || '';

            // Warboard Target Claim
            if (customId.startsWith('claim_')) {
                const targetId = customId.replace('claim_', '').trim().replace(/[^0-9]/g, '');
                if (!targetId) {
                    return interaction.reply({ content: "⚠️ Target ID not found.", ephemeral: true }).catch(() => {});
                }

                const claimerName = interaction.user.username;
                const now = Date.now();
                const facId = discordConfig.factionId || dynamicFactionId || "52355";
                const fState = getFactionWarState(facId);
                const existingClaim = fState.claims[targetId] || claims[targetId];

                if (existingClaim && existingClaim.playerName && existingClaim.playerName !== claimerName && (now - existingClaim.time < 15 * 60 * 1000)) {
                    return interaction.reply({
                        content: `⚠️ Target **[${targetId}]** is already claimed by **${existingClaim.playerName}** (${Math.round((now - existingClaim.time)/1000)}s ago)!`,
                        ephemeral: true
                    }).catch(() => {});
                }

                fState.claims[targetId] = { playerName: claimerName, time: now, discordId: interaction.user.id };
                claims[targetId] = { playerName: claimerName, time: now, discordId: interaction.user.id };

                const attackLink = `https://www.torn.com/loader.php?sid=attack&user2ID=${targetId}`;
                return interaction.reply({
                    embeds: [{
                        title: `🎯 Target [${targetId}] Claimed!`,
                        description: `**<@${interaction.user.id}>** has claimed **Target [${targetId}]** directly from Discord.\n\n` +
                            `[⚔️ Launch Attack in Torn](${attackLink}) • [👤 Profile](https://www.torn.com/profiles.php?XID=${targetId})`,
                        color: 0x2ed573,
                        footer: { text: "Owen's Faction Tools • Live Warboard Sync" },
                        timestamp: new Date().toISOString()
                    }]
                }).catch(() => {});
            }

            // Warboard Target Unclaim
            if (customId.startsWith('unclaim_')) {
                const targetId = customId.replace('unclaim_', '').trim().replace(/[^0-9]/g, '');
                const facId = discordConfig.factionId || dynamicFactionId || "52355";
                const fState = getFactionWarState(facId);
                delete fState.claims[targetId];
                delete claims[targetId];
                return interaction.reply({
                    content: `🔓 Target **[${targetId}]** is now released and unclaimed.`,
                    ephemeral: true
                }).catch(() => {});
            }

            // ── Bank: Verify & Fulfill ──
            if (customId.startsWith('bank_pay_')) {
                const reqId = customId.replace('bank_pay_', '').trim();
                await interaction.deferReply({ ephemeral: true });
                const res = await executeFulfillRequest(reqId, interaction);
                return interaction.editReply({ content: res.message }).catch(() => {});
            }

            // ── Bank: Revert to Pending ──
            if (customId.startsWith('bank_revert_')) {
                const reqId = customId.replace('bank_revert_', '').trim();
                const req = bankRequests[reqId];
                if (!req) return interaction.reply({ content: '⚠️ Request not found.', ephemeral: true }).catch(() => {});

                const isBankerOrAdmin = !discordConfig.bankerRoleId ||
                    interaction.member?.roles?.cache?.has(discordConfig.bankerRoleId) ||
                    interaction.member?.permissions?.has?.('Administrator');
                if (!isBankerOrAdmin) return interaction.reply({ content: `⚠️ Only bankers can revert payments.`, ephemeral: true }).catch(() => {});

                req.status = 'pending';
                req.fulfilledBy = null;
                req.fulfillerName = null;
                req.fulfilledAt = null;
                saveBankRequests();

                if (req.channelId && req.messageId) {
                    try {
                        const chan = interaction.client.channels.cache.get(req.channelId)
                            || await interaction.client.channels.fetch(req.channelId).catch(() => null);
                        const msg = chan && await chan.messages.fetch(req.messageId).catch(() => null);
                        if (msg) await msg.edit({ embeds: [sanitizeEmbed(buildBankRequestEmbed(req))], components: buildBankRequestButtons(req) }).catch(() => {});
                    } catch(e) {}
                }
                return interaction.reply({ content: `↩️ Request **#${reqId}** has been reverted to pending.`, ephemeral: true }).catch(() => {});
            }

            // ── Bank Request Cancel ──

            if (customId.startsWith('bank_cancel_')) {
                const reqId = customId.replace('bank_cancel_', '').trim();
                const res = await executeCancelRequest(reqId, interaction);
                return interaction.reply({ content: res.message, ephemeral: true }).catch(() => {});
            }

            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const cmd = interaction.commandName.toLowerCase();
        const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
        let subcommand = null;
        try { subcommand = interaction.options.getSubcommand(); } catch(e) {}

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

        // Direct handling for /withdraw with STRICT OVERDRAFT PROTECTION
        if (cmd === 'withdraw') {
            const rawAmount = interaction.options.getString('amount');
            const amount = parseAmount(rawAmount);

            if (!amount) {
                return interaction.reply({
                    content: `⚠️ Invalid withdrawal amount: **"${rawAmount || ''}"**.\n\nPlease specify a valid numeric amount, e.g. \`10m\`, \`500k\`, \`1.5b\`, or \`25,000,000\`.`,
                    ephemeral: true
                });
            }

            checkExpiredBankRequests();

            // Defer ephemerally while checking Torn API balance and preventing overdrafts
            await interaction.deferReply({ ephemeral: true });

            let vaultInfo = null;
            try {
                vaultInfo = await getFactionVaultAndMember(apiKey, interaction);
            } catch(err) {
                console.error("[Bank Vault Check Error]:", err.message);
            }

            // If we couldn't match the member to a Torn ID:
            if (!vaultInfo || !vaultInfo.targetId) {
                return interaction.editReply({
                    content: `⚠️ **Could not identify your Torn Account in the faction vault!**\n\n` +
                             `To protect faction funds, the bot must verify your vault balance before withdrawal.\n` +
                             `Please change your server nickname to include your Torn ID in brackets, e.g.:\n` +
                             `\`${interaction.user.username} [123456]\`\n\n` +
                             `Then run \`/withdraw ${rawAmount}\` again.`
                });
            }

            const { targetId, tornName, totalBalance, activePendingTotal, activePendingReqs, availableBalance, memberStatus } = vaultInfo;

            // ── ZERO BALANCE CHECK ──
            if (totalBalance <= 0) {
                return interaction.editReply({
                    embeds: [{
                        title: "❌ Insufficient Vault Balance",
                        description: `You currently have **$0** deposited in the faction vault for **${vaultInfo.factionName}**.\n\n` +
                                     `Player: [**${tornName || 'You'}** [${targetId}]](https://www.torn.com/profiles.php?XID=${targetId})\n\n` +
                                     `You cannot withdraw funds without a positive vault balance.`,
                        color: 0xff4757,
                        footer: { text: "Spider-Verse Faction Tools • Faction Banking" }
                    }]
                });
            }

            // ── OVERDRAFT PREVENTION CHECK ──
            if (amount > totalBalance) {
                return interaction.editReply({
                    embeds: [{
                        title: "❌ Overdraft Prevention — Request Denied",
                        description: `You cannot withdraw **$${amount.toLocaleString()}** because it exceeds your total faction vault balance of **$${totalBalance.toLocaleString()}**!\n\n` +
                                     `💵 **Total Vault Balance:** **$${totalBalance.toLocaleString()}**\n` +
                                     `🚫 **Attempted Request:** **$${amount.toLocaleString()}**\n\n` +
                                     `*Please reduce your request amount to $${totalBalance.toLocaleString()} or less.*`,
                        color: 0xff4757,
                        footer: { text: "Faction Banking • Overdraft Protection Active" }
                    }]
                });
            }

            // Build request object
            const reqId = String(++bankRequestCounter);

            // Automatically supersede (replace) any previous pending request(s) from this member
            let replacedNote = "";
            if (activePendingReqs.length > 0) {
                const oldIds = activePendingReqs.map(r => `#${r.id}`).join(', ');
                for (const oldReq of activePendingReqs) {
                    oldReq.status = 'cancelled';
                    oldReq.cancelledBy = interaction.user.id;
                    oldReq.cancellerName = `${interaction.user.username} (Superseded by #${reqId})`;
                    oldReq.cancelledAt = Date.now();
                    if (oldReq.channelId && oldReq.messageId) {
                        try {
                            const chan = interaction.client.channels.cache.get(oldReq.channelId);
                            if (chan) {
                                chan.messages.fetch(oldReq.messageId).then(m => {
                                    if (m) {
                                        m.edit({
                                            embeds: [sanitizeEmbed(buildBankRequestEmbed(oldReq))],
                                            components: [{
                                                type: 1,
                                                components: [{
                                                    type: 2,
                                                    style: 2,
                                                    custom_id: `superseded_${oldReq.id}`,
                                                    label: `🔄 Replaced by #${reqId} ($${amount.toLocaleString()})`,
                                                    disabled: true
                                                }]
                                            }]
                                        }).catch(() => {});
                                    }
                                }).catch(() => {});
                            }
                        } catch(e) {}
                    }
                }
                replacedNote = `\n*(Previous pending request ${oldIds} was automatically replaced)*`;
            }

            const req = {
                id: reqId,
                userId: interaction.user.id,
                userName: interaction.user.username,
                tornId: targetId,
                tornName: tornName,
                amount,
                timestamp: Date.now(),
                status: 'pending',
                balanceBefore: totalBalance,
                remainingBalance: totalBalance - amount,
                memberStatus: memberStatus
            };
            bankRequests[reqId] = req;
            saveBankRequests();

            const reqEmbed = buildBankRequestEmbed(req);
            const reqButtons = buildBankRequestButtons(req);
            const pingContent = discordConfig.bankerRoleId 
                ? `🔔 <@&${discordConfig.bankerRoleId}> — New vault withdrawal request from **${req.tornName || req.userName}** for **$${amount.toLocaleString()}**!`
                : undefined;

            // Resolve potential target channels (with cache + fetch fallback)
            const bankingChanId = discordConfig.bankingChannelId;
            let bankingChan = null;
            if (bankingChanId) {
                try {
                    bankingChan = interaction.client.channels.cache.get(bankingChanId) 
                        || await interaction.client.channels.fetch(bankingChanId).catch(() => null);
                } catch(e) {}
            }

            const globalChanId = discordConfig.globalChannelId;
            let globalChan = null;
            if (globalChanId && globalChanId !== bankingChanId) {
                try {
                    globalChan = interaction.client.channels.cache.get(globalChanId) 
                        || await interaction.client.channels.fetch(globalChanId).catch(() => null);
                } catch(e) {}
            }

            let chanMsg = null;
            let postedChan = null;

            // Strategy 1: Try dedicated banking channel
            if (bankingChan) {
                try {
                    chanMsg = await bankingChan.send({
                        content: pingContent,
                        embeds: [sanitizeEmbed(reqEmbed)],
                        components: reqButtons
                    });
                    postedChan = bankingChan;
                } catch(err) {
                    console.warn(`[Bank Request] Could not send to bankingChannel (${bankingChanId}):`, err.message);
                }
            }

            // Strategy 2: Try current interaction channel
            if (!chanMsg && interaction.channel) {
                try {
                    chanMsg = await interaction.channel.send({
                        content: pingContent,
                        embeds: [sanitizeEmbed(reqEmbed)],
                        components: reqButtons
                    });
                    postedChan = interaction.channel;
                } catch(err) {
                    console.warn(`[Bank Request] Could not send to interaction channel (${interaction.channelId}):`, err.message);
                }
            }

            // Strategy 3: Try global alert channel (where bot has confirmed permissions)
            if (!chanMsg && globalChan) {
                try {
                    chanMsg = await globalChan.send({
                        content: pingContent,
                        embeds: [sanitizeEmbed(reqEmbed)],
                        components: reqButtons
                    });
                    postedChan = globalChan;
                } catch(err) {
                    console.warn(`[Bank Request] Could not send to globalChannel (${globalChanId}):`, err.message);
                }
            }

            // Strategy 4: Try interaction followUp (uses interaction webhook token)
            if (!chanMsg) {
                try {
                    chanMsg = await interaction.followUp({
                        content: pingContent,
                        embeds: [sanitizeEmbed(reqEmbed)],
                        components: reqButtons,
                        ephemeral: false
                    });
                    postedChan = interaction.channel;
                } catch(err) {
                    console.warn("[Bank Request] Could not send via followUp:", err.message);
                }
            }

            // If successfully posted to any public channel:
            if (chanMsg) {
                req.channelId = postedChan?.id || interaction.channelId;
                req.messageId = chanMsg.id;
                saveBankRequests();

                const locationNote = (postedChan && postedChan.id !== interaction.channelId)
                    ? `in <#${postedChan.id}>`
                    : `below`;

                return interaction.editReply({
                    content: `✅ Your withdrawal request **#${req.id}** for **$${amount.toLocaleString()}** has been posted ${locationNote}!${replacedNote}\n` +
                             `Remaining available balance: **$${(totalBalance - amount).toLocaleString()}**.`
                });
            }

            // Strategy 5: Resilient Fallback - Keep request active & render directly in ephemeral interaction response
            req.channelId = interaction.channelId;
            req.messageId = null;
            saveBankRequests();

            return interaction.editReply({
                content: `✅ Your withdrawal request **#${req.id}** for **$${amount.toLocaleString()}** is active!${replacedNote}\n` +
                         `Remaining available balance: **$${(totalBalance - amount).toLocaleString()}**.\n` +
                         `*(Note: Bot lacks "Send Messages" permission in this channel to post publicly, but your request has been recorded and will be auto-fulfilled when cash is sent)*`,
                embeds: [sanitizeEmbed(reqEmbed)],
                components: reqButtons
            });
        }

        // Defer reply for commands that make API calls
        try { await interaction.deferReply(); } catch (e) { return; }

        let embed = null;

        try {
            // ── Banking & Discord Audit ──
            if (cmd === 'balance') {
                const member = interaction.options.getString('member');
                embed = await buildVaultBalanceEmbed(apiKey, member, interaction.user);
            } else if (cmd === 'notindiscord' || (cmd === 'faction' && subcommand === 'notindiscord')) {
                embed = await buildMissingDiscordEmbed(interaction.guild, apiKey);
            }
            // ── Faction Management Suite ──
            else if (cmd === 'faction') {
                if (subcommand === 'roster') {
                    embed = await buildOnlineRosterEmbed(apiKey);
                } else if (subcommand === 'hospital') {
                    embed = await buildHospitalEmbed(apiKey);
                } else if (subcommand === 'inactive') {
                    embed = await buildInactiveMembersEmbed(apiKey);
                } else if (subcommand === 'oc') {
                    embed = await buildOCStatusEmbed(apiKey);
                } else if (subcommand === 'payout') {
                    const member = interaction.options.getString('member');
                    embed = await buildPayoutEmbed(member, apiKey);
                } else if (subcommand === 'mvp') {
                    embed = await buildTopHittersEmbed(apiKey);
                } else if (subcommand === 'stats') {
                    const side = interaction.options.getString('side') || 'enemy';
                    embed = await buildFactionStatsRosterEmbed(side, apiKey);
                } else if (subcommand === 'bounties') {
                    embed = await buildWarBountiesEmbed(apiKey);
                } else if (subcommand === 'flights') {
                    const ffKey = getGlobalFFKey() || discordConfig.ffKey;
                    embed = await buildWarFlightsEmbed(apiKey, ffKey);
                }
            }
            // ── Alert Bot Controls ──
            else if (cmd === 'alerts') {
                if (subcommand === 'pause') {
                    const actor = interaction.user?.username || "Admin";
                    embed = handleKillCommand(actor);
                } else if (subcommand === 'resume') {
                    const actor = interaction.user?.username || "Admin";
                    embed = handleLiveCommand(actor);
                } else {
                    const isKilled = global.isNotificationsKilled;
                    embed = {
                        title: "📢 Discord Alerts Status",
                        description: isKilled 
                            ? "⏸ Automated notifications are currently **PAUSED**.\nUse `/alerts resume` in Discord to re-enable."
                            : "🟢 Automated notifications are currently **ACTIVE** and broadcasting.\nUse `/alerts pause` to silence.",
                        color: isKilled ? 0xff4757 : 0x2ed573,
                        footer: { text: "Owen's Faction Tools • Alert Controls" }
                    };
                }
            }
            // ── War & Intel Commands & Legacy Backward Compatibility ──
            else if (cmd === 'war' || cmd === 'warboard') {
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
            } else if (cmd === 'bounties' || cmd === 'bounty') {
                embed = await buildWarBountiesEmbed(apiKey);
            } else if (cmd === 'inactive' || cmd === 'inactivity') {
                embed = await buildInactiveMembersEmbed(apiKey);
            } else if (cmd === 'donator' || cmd === 'subscriber' || cmd === 'sub') {
                const player = interaction.options.getString('player');
                embed = await buildDonatorStatusEmbed(player, apiKey);
            } else if (cmd === 'warflights' || cmd === 'warflight' || cmd === 'flights') {
                const ffKey = getGlobalFFKey() || discordConfig.ffKey;
                embed = await buildWarFlightsEmbed(apiKey, ffKey);
            } else if (cmd === 'kill' || cmd === 'mute' || cmd === 'stop' || cmd === 'pause') {
                const actor = interaction.user?.username || "Admin";
                embed = handleKillCommand(actor);
            } else if (cmd === 'live' || cmd === 'resume' || cmd === 'start') {
                const actor = interaction.user?.username || "Admin";
                embed = handleLiveCommand(actor);
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

    bot.on('error', (e) => {
        console.error("[Slash Bot] Client error:", e.message);
        slashBotStarted = false;
    });
}

async function startSlashCommandBot(token) {
    if (slashBotStarted && slashCommandBot?.isReady?.()) return;
    slashBotStarted = false;

    try {
        if (slashCommandBot) {
            try { slashCommandBot.destroy(); } catch(e) {}
        }

        // Try initializing with GuildMembers intent for full member auditing
        slashCommandBot = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMembers
            ]
        });

        setupSlashBotEvents(slashCommandBot, token);

        try {
            await slashCommandBot.login(token);
        } catch(loginErr) {
            if (loginErr.code === 'DisallowedIntents' || (loginErr.message && loginErr.message.toLowerCase().includes('disallowed intents'))) {
                console.warn("[Slash Bot] Privileged GuildMembers intent disallowed in Developer Portal. Falling back to standard intents...");
                try { slashCommandBot.destroy(); } catch(e) {}
                slashCommandBot = new Client({
                    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
                });
                setupSlashBotEvents(slashCommandBot, token);
                await slashCommandBot.login(token);
            } else {
                throw loginErr;
            }
        }
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

// API endpoint: purge duplicate commands and cleanly re-sync
app.post('/api/discord/clean-commands', async (req, res) => {
    try {
        const token = req.body.token || discordConfig.globalBotToken;
        const guildId = req.body.guildId || discordConfig.guildId || null;
        if (!token) return res.status(400).json({ error: "Missing bot token" });

        const rest = new REST({ version: '10' }).setToken(token.trim());
        const botRes = await fetch(`https://discord.com/api/v10/users/@me`, {
            headers: { Authorization: `Bot ${token.trim()}` }
        });
        const botData = await botRes.json();
        const applicationId = botData.id;
        if (!applicationId) throw new Error("Could not retrieve application ID. Check your bot token.");

        // Clear global
        await rest.put(Routes.applicationCommands(applicationId), { body: [] }).catch(() => {});

        // Clear target guild and all known guilds
        if (guildId) {
            await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] }).catch(() => {});
        }
        if (slashCommandBot?.isReady?.()) {
            for (const gId of slashCommandBot.guilds.cache.keys()) {
                await rest.put(Routes.applicationGuildCommands(applicationId, gId), { body: [] }).catch(() => {});
            }
        }

        // Re-register clean commands
        const result = await registerSlashCommands(token.trim(), guildId);
        if (result.success) {
            startSlashCommandBot(token.trim()).catch(() => {});
        }
        res.json({ success: true, count: result.count, message: "Commands purged and re-registered cleanly with zero duplicates!" });
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

// ── Graceful Shutdown Handler for Fast Render Deploys ───────────────────────
// Responds immediately to Render's SIGTERM signal when deploying new code,
// preventing Render from waiting its 30-60 second timeout before force-killing.
process.on('SIGTERM', () => {
    console.log('[Process] SIGTERM received from Render. Exiting immediately for fast deploy...');
    process.exit(0);
});
process.on('SIGINT', () => {
    process.exit(0);
});

