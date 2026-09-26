// ── Process Crash Shields (Ensures 24/7 uninterrupted uptime on Render) ──
process.on('uncaughtException', (err, origin) => {
    console.error('[CRITICAL] Uncaught Exception:', err?.message || err, 'Origin:', origin);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Promise Rejection:', reason?.message || reason);
});

// Enforce strict memory budget for Render 512MB container
try {
    const v8 = require('v8');
    v8.setFlagsFromString('--max_old_space_size=384');
} catch(e) {}

const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// ── F.R.I.D.A.Y. UI Design System ──
// Centralized embed builders, colors, formatters, and button helpers.
// All user-facing Discord responses should use UI.success(), UI.error(), etc.
const UI = require('./friday-ui');
const userKeys = require('./user-keys');
const userAlerts = require('./user-alerts');
const bugManager = require('./bug-manager');
const { buildSlashCommands } = require('./discord-slash-builder');
const tornKnowledge = require('./torn-knowledge');
const sessionManager = require('./session-manager');
const tornApiManager = require('./torn-api-manager');
const warboardBroadcaster = require('./warboard-broadcaster');
const retalEngine = require('./retal_engine');
const promotionManager = require('./promotion-manager');
promotionManager.initPromotionManager(null);


// Hardcoded MongoDB URI to bypass Render settings
process.env.MONGODB_URI = "mongodb+srv://WarBoard:WarBoardPass123@cluster0.iwnnnj3.mongodb.net/?appName=Cluster0";

const mongoose = require('mongoose');

const DEFAULT_WELCOME_RULES = `⚡ **Priority Directive: Rush to Level 15!**
Get to **Level 15** as fast as possible to unlock foreign travel, run plushies/flowers, and generate high daily income!

📋 **Organized Crimes (OC 2.0) Requirements:**
OC (Short for organized crimes) are a requirement to be in this faction.
You can join one by simply [clicking here](https://www.torn.com/factions.php?step=your&type=1#/tab=crimes)

There are requirements for joining specific roles, that is the sole purpose of this post.
Familiarize yourself with these:
• **Level 1/2:** No CPR Requirement
• **Level 3/4:** Minimum CPR of 50
• **Level 5/6:** Minimum CPR of 40

The minimum CPR for levels 3 and up may change as we get better at crimes, be aware of notices being sent and this thread being edited to reflect current expectations.

If you're outside of the bounds of the minimum CPR you will be removed and expected to join a new one yourself.`;

// ── Master State & Configuration Store (Pre-initialized to prevent TDZ ReferenceErrors) ──
let discordConfig = { 
    globalChannelId: "", 
    globalBotToken: "",
    personalDiscordId: "",
    guildId: "",
    bankingChannelId: "",
    bankerRoleId: "",
    retalChannelId: "",
    retalRoleId: "",
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
    inactivityChannelId: "",
    promotionChannelId: "",
    apiKey: "", 
    factionId: "",
    notificationsKilled: false,
    verificationChannelId: "",
    notifyApiKeyLinked: false,
    unverifiedRoleId: "",
    verifiedRoleId: "",
    factionRoleId: "",
    leaderRoleId: "",
    autoVerifyOnJoin: true,
    conversationChannels: [],
    disabledCommands: [],
    geminiApiKeys: [],
    geminiApiKey: "",
    openrouterApiKey: "",
    welcomeChannelId: "",
    postWelcomeRulesOnJoin: true,
    welcomeRulesTitle: "📜 Welcome to the Faction & Server Rules",
    welcomeRulesContent: DEFAULT_WELCOME_RULES
};
let companyConfig = { apiKey: "", companyId: "", globalChannelId: "", threshold: 0, alertedItems: {} };
let marketConfig = { globalChannelId: "", autoDefense: false, sniperTargets: [] };
let ocConfig = { 
    globalChannelId: "", 
    roleId: "",
    ocManagerRoleId: "",
    ocManagerUserIds: "",
    dmOcManagersOnLowCpr: true,
    dmPlayerOnLowCpr: true,
    alertPlanned: true,
    alertCountdown4h: true,
    alertCountdown2h: true,
    alertUpcoming: true,
    upcomingMinutes: 30,
    alertReady: true,
    alertDelayed: true,
    alertMissingItems: true,
    alertCompleted: true,
    alertLowCpr: true,
    lowCprDefaultThreshold: 40,
    lowCprLevels: { 1: 0, 2: 0, 3: 50, 4: 50, 5: 40, 6: 40, 7: 80, 8: 85 },
    alertNoParticipation: true,
    noParticipationDays: 1
};
let subscriptions = {};
let spyDatabase = {};
let userTracking = {};
let apiPoolConfig = {};
let bankRequests = {};
let bankRequestCounter = 1000;
let verifiedDiscordToTorn = {};
let inactivityAlertsMemory = { alerts: {}, initialized: false };
let odAlertsMemory = { alerts: {}, initialized: false };
let ocAlertTracker = {};
let ocMemory = {};
let ocMemberHistory = {};
let activeGiveaways = {};
let warFlightArchive = {};
let warAuditArchive = {};
let lastGoodWarboardPayload = null;
let slashCommandBot = null;
let slashBotStarted = false;
let isStartingSlashBot = false;

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
let mongoRetryTimeout = null;
function connectMongo() {
    if (!process.env.MONGODB_URI) return;
    mongoose.connect(process.env.MONGODB_URI)
        .then(async () => {
            console.log("[MongoDB] Connected to MongoDB Atlas successfully");
            global.mongoConnectionError = null;
            await loadConfigFromMongo();
            await sessionManager.initSessionStore();
            promotionManager.initPromotionManager(mongoose.connection.db);
        })
        .catch(err => {
            console.warn("[MongoDB] Atlas connection warning (retrying in 10s):", err.message || err);
            global.mongoConnectionError = err.message || err.toString();
            if (mongoRetryTimeout) clearTimeout(mongoRetryTimeout);
            mongoRetryTimeout = setTimeout(connectMongo, 10_000);
        });
}
connectMongo();

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
                // CRITICAL REPAIR: If discordConfig has numeric keys (0..71) from an accidental string spread, reconstruct globalBotToken if missing, and scrub numeric keys
                if (discordConfig[0] !== undefined) {
                    let reconstructed = '';
                    for (let i = 0; discordConfig[i] !== undefined; i++) {
                        reconstructed += discordConfig[i];
                        delete discordConfig[i];
                    }
                    if ((!discordConfig.globalBotToken || discordConfig.globalBotToken.length < 20) && reconstructed.length > 25 && reconstructed.includes('.')) {
                        discordConfig.globalBotToken = reconstructed.trim();
                        console.log(`[Config Repair] Restored globalBotToken from string spread (${discordConfig.globalBotToken.length} chars).`);
                    }
                }
                if (Array.isArray(discordConfig.conversationChannels)) {
                    activeConversationChannels = new Set(discordConfig.conversationChannels);
                    for (const chan of activeConversationChannels) {
                        if (!convoSessionStartTimestamps.has(chan)) {
                            convoSessionStartTimestamps.set(chan, Date.now());
                        }
                    }
                    console.log(`[Mongo] Restored ${activeConversationChannels.size} active conversation channel(s):`, Array.from(activeConversationChannels));
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
            if (saved.ocAlertTracker) {
                ocAlertTracker = { ...(ocAlertTracker || {}), ...(saved.ocAlertTracker || {}) };
                console.log(`[Mongo] Restored ${Object.keys(ocAlertTracker).length} OC alert trackers from MongoDB Atlas.`);
            }
            if (saved.ocMemory) {
                ocMemory = { ...(ocMemory || {}), ...(saved.ocMemory || {}) };
                console.log(`[Mongo] Restored ${Object.keys(ocMemory).length} OC alert memory records from MongoDB Atlas.`);
            }
            if (saved.ocMemberHistory) {
                ocMemberHistory = { ...(ocMemberHistory || {}), ...(saved.ocMemberHistory || {}) };
                console.log(`[Mongo] Restored ${Object.keys(ocMemberHistory).length} OC member history records from MongoDB Atlas.`);
            }
            if (saved.odAlerts) {
                odAlertsMemory = {
                    alerts: { ...(odAlertsMemory?.alerts || {}), ...(saved.odAlerts.alerts || {}) },
                    initialized: saved.odAlerts.initialized !== false
                };
                console.log(`[Mongo] Restored overdose alert history from MongoDB Atlas.`);
            }
            if (saved.giveaways) {
                activeGiveaways = { ...(activeGiveaways || {}), ...(saved.giveaways || {}) };
                console.log(`[Mongo] Restored ${Object.keys(activeGiveaways).length} giveaways from MongoDB Atlas.`);
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
            if (saved.bugs && Array.isArray(saved.bugs)) {
                bugsMemory = saved.bugs;
                console.log(`[Mongo] Restored ${bugsMemory.length} bug reports from MongoDB Atlas.`);
            }
            if (saved.lastWarboardPayload && (!lastGoodWarboardPayload || !lastGoodWarboardPayload.friendly || lastGoodWarboardPayload.friendly.length === 0)) {
                lastGoodWarboardPayload = saved.lastWarboardPayload;
                console.log(`[Mongo] Restored lastGoodWarboardPayload (${lastGoodWarboardPayload.friendly?.length || 0} members) from MongoDB Atlas.`);
            }
            if (saved.userApiKeys) {
                userKeys.importEncryptedFromMongo(saved.userApiKeys);
            }
            if (saved.userAlertPrefs) {
                userAlerts.importPrefsFromMongo(saved.userAlertPrefs);
            }
            if (saved.battleStatsHistory) {
                battleStatsHistory = { ...(battleStatsHistory || {}), ...(saved.battleStatsHistory || {}) };
                console.log(`[Mongo] Restored battle stats history for ${Object.keys(battleStatsHistory).filter(k => !k.startsWith('discord_')).length} player(s) from MongoDB Atlas.`);
            }
            if (saved.verifiedDiscordUsers) {
                verifiedDiscordToTorn = { ...(verifiedDiscordToTorn || {}), ...saved.verifiedDiscordUsers };
                console.log(`[Mongo] Restored ${Object.keys(verifiedDiscordToTorn).length} verified Discord users from MongoDB Atlas.`);
            }
            console.log('[Mongo] Restored master configurations from MongoDB Atlas.');
            
            if (discordConfig.apiKey) {
                try {
                    const { addKey } = require('./recruit/lib/apiKeyPool');
                    addKey(discordConfig.apiKey, discordConfig.factionId || 0, null);
                } catch(e) {}
            }
            const primaryOwnerKey = discordConfig.apiKey || ADMIN_API_KEY || TORN_API_KEY || "";
            if (primaryOwnerKey) {
                try {
                    userKeys.syncOwnerDetails(primaryOwnerKey, discordConfig.personalDiscordId);
                    tornKnowledge.fetchFactionPerks(primaryOwnerKey).catch(() => {});
                } catch(e) {}
            }

            if (discordConfig.globalBotToken && discordConfig.globalBotToken.trim().length > 20 && !global.slashBotStarted) {
                try {
                    startSlashCommandBot(discordConfig.globalBotToken.trim()).catch(() => {});
                } catch(e) {}
            }

            // Start Retaliation Risk Engine with real-time alert callback
            try {
                if (mongoose.connection.readyState === 1) {
                    retalEngine.startRetaliationEngine(
                        () => getNextApiKey() || discordConfig.apiKey || TORN_API_KEY,
                        mongoose.connection.db,
                        handleMemberAttackedAlert
                    ).catch(e => console.warn('[RetalEngine] Start error in loadConfig:', e.message));
                }
            } catch(e) {}
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

        // 2. Stream/batch sync quality recruits into Player search pool to keep RAM tiny (< 50MB)
        const totalRecruits = await Recruit.countDocuments().catch(() => 0);
        if (totalRecruits === 0) return;

        const BATCH_SIZE = 200;
        let syncedCount = 0;
        let skip = 0;

        while (skip < totalRecruits) {
            const batch = await Recruit.find({}).skip(skip).limit(BATCH_SIZE).lean();
            if (!batch || batch.length === 0) break;

            const qualityRecruits = batch.filter(r => {
                const state = r.status || 'Okay';
                if (state === 'Fallen' || state === 'Federal' || state === 'Deleted') return false;
                
                const lastActionTs = r.last_action?.timestamp
                    ? new Date(r.last_action.timestamp * 1000)
                    : new Date();
                const hoursSinceLast = (Date.now() - lastActionTs.getTime()) / 3_600_000;
                if (hoursSinceLast > 168) return false; // Inactive > 7 days

                const age = r.age || 1;
                const lvl = r.level || 1;

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
                await Player.bulkWrite(ops, { ordered: false }).catch(() => {});
                syncedCount += qualityRecruits.length;
            }

            skip += BATCH_SIZE;
        }

        console.log(`[RecruitSync] Synced ${syncedCount} quality recruits into Player search pool.`);
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
app.use(compression({
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    }
}));
app.use(express.json());
app.use(sessionManager.resolveSessionMiddleware(userKeys));

// Instant root healthcheck for Render router, Cloudflare, and keep-alive sentinel
app.get(['/healthz', '/health', '/api/health'], (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        mongo: mongoose.connection.readyState === 1 ? 'connected' : 'connecting',
        timestamp: Date.now()
    });
});

app.get('/recruitment.html', (req, res) => {
    res.redirect(301, '/recruit/');
});

app.post('/api/sync-recruits-now', async (req, res) => {
    syncRecruitsToPlayers().catch(e => console.error("[Manual RecruitSync Error]", e.message));
    res.json({ success: true, message: "Recruit sync triggered in background" });
});

app.use(express.static('public', {
    maxAge: 0,
    setHeaders: (res, filePath) => {
        const p = filePath.toLowerCase();
        if (p.endsWith('.user.js')) {
            // Tampermonkey userscripts: cache 30 mins in browser, stale-while-revalidate for 24h
            res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=86400');
        } else if (p.endsWith('.html')) {
            // HTML files: fast tab switching with 15s browser cache + 300s background revalidation
            res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=300');
        } else if (p.endsWith('.css') || p.endsWith('.js')) {
            // Static styles and shared scripts: cache 24h, background revalidate
            res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        } else if (p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.svg') || p.endsWith('.ico') || p.endsWith('.webp')) {
            // Media assets: long-lived cache
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=86400');
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

spyDatabase = {}; 
let subCache = {}; 

userTracking = {}; 
let discordIdCache = {}; 
apiPoolConfig = { keys: [] }; 

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
lastGoodWarboardPayload = null;
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

async function resolvePlayerName(id, fallback = null) {
    if (!id || id === '0' || id === 0) return fallback || "Someone (Stealthed)";
    const sId = String(id).trim();
    if (playerNameCache[sId]) return playerNameCache[sId];
    if (spyDatabase[sId]?.name) {
        playerNameCache[sId] = spyDatabase[sId].name;
        return playerNameCache[sId];
    }
    if (statsCache[sId]?.name) {
        playerNameCache[sId] = statsCache[sId].name;
        return playerNameCache[sId];
    }
    try {
        if (mongoose.connection.readyState === 1) {
            const pDoc = await mongoose.connection.db.collection('players').findOne({ _id: Number(sId) }, { projection: { name: 1 } });
            if (pDoc?.name) {
                playerNameCache[sId] = pDoc.name;
                return pDoc.name;
            }
        }
    } catch(e) {}
    const apiKey = getNextApiKey() || discordConfig.apiKey || TORN_API_KEY;
    if (apiKey) {
        try {
            const res = await fetch(`https://api.torn.com/user/${sId}?selections=profile&key=${apiKey}`, { signal: AbortSignal.timeout(5000) });
            const data = await res.json();
            if (data && data.name) {
                playerNameCache[sId] = data.name;
                return data.name;
            }
        } catch(e) {}
    }
    return fallback || `Player #${sId}`;
}

let dynamicFactionId = null; 
let lastEventTimestamp = Math.floor(Date.now() / 1000);

let lastChainTimeoutAlertState = false;
let backgroundEnemyTrackingState = {};

discordConfig = { 
    globalChannelId: "", 
    globalBotToken: "",
    personalDiscordId: "",
    guildId: "",
    bankingChannelId: "",
    bankerRoleId: "",
    retalChannelId: "",
    retalRoleId: "",
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
    inactivityChannelId: "",
    promotionChannelId: "",
    apiKey: "", 
    factionId: "",
    notificationsKilled: false,
    verificationChannelId: "",
    unverifiedRoleId: "",
    verifiedRoleId: "",
    factionRoleId: "",
    leaderRoleId: "",
    autoVerifyOnJoin: true,
    disabledCommands: [],
    welcomeChannelId: "",
    postWelcomeRulesOnJoin: true,
    welcomeRulesTitle: "📜 Welcome to the Faction & Server Rules",
    welcomeRulesContent: DEFAULT_WELCOME_RULES
};
marketConfig = { globalChannelId: "", autoDefense: false, sniperTargets: [] };
let marketMemory = { defense: {}, sniper: {} };
ocConfig = { 
    globalChannelId: "", 
    roleId: "",
    ocManagerRoleId: "",
    ocManagerUserIds: "",
    dmOcManagersOnLowCpr: true,
    dmPlayerOnLowCpr: true,
    alertPlanned: true,
    alertCountdown4h: true,
    alertCountdown2h: true,
    alertUpcoming: true,
    upcomingMinutes: 30,
    alertReady: true,
    alertDelayed: true,
    alertMissingItems: true,
    alertCompleted: true,
    alertLowCpr: true,
    lowCprDefaultThreshold: 40,
    lowCprLevels: {
        1: 0,
        2: 0,
        3: 50,
        4: 50,
        5: 40,
        6: 40,
        7: 80,
        8: 85
    },
    alertNoParticipation: true,
    noParticipationDays: 1
};

let tornItemsCache = null;
let tornItemsCacheTime = 0;

const KNOWN_OC_ITEMS = {
    190: { name: "C4 Explosive", type: "Material" },
    222: { name: "Flash Grenade", type: "Temporary" },
    1203: { name: "Lockpicks", type: "Tool" },
    1217: { name: "Shaving Foam", type: "Material" },
    1313: { name: "Cassock", type: "Tool" },
    1361: { name: "Dog Treats", type: "Material" },
    1362: { name: "Net", type: "Tool" },
    1379: { name: "ATM Key", type: "Tool" },
    1381: { name: "ID Badge", type: "Material" }
};

async function getTornItemInfo(itemId, apiKey) {
    if (!itemId) return { name: "Required Item", type: "Utility" };
    const numId = Number(itemId);
    if (KNOWN_OC_ITEMS[numId]) return KNOWN_OC_ITEMS[numId];
    if (tornKnowledge && tornKnowledge.TORN_ITEMS_DB && tornKnowledge.TORN_ITEMS_DB[numId]) {
        return tornKnowledge.TORN_ITEMS_DB[numId];
    }
    if (tornItemsCache && (Date.now() - tornItemsCacheTime < 24 * 3600 * 1000)) {
        if (tornItemsCache[numId]) return tornItemsCache[numId];
    }
    try {
        const k = apiKey || discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
        if (k) {
            const res = await fetch(`https://api.torn.com/torn/${numId}?selections=items&key=${k}`, { signal: AbortSignal.timeout(5000) });
            const data = await res.json();
            if (data.items && data.items[numId]) {
                if (!tornItemsCache) tornItemsCache = {};
                tornItemsCache[numId] = data.items[numId];
                return data.items[numId];
            }
        }
    } catch(e) {}
    return { name: `Required Item #${itemId}`, type: "Utility" };
}
 
companyConfig = { globalChannelId: "", threshold: 0, alertedItems: {}, apiKey: "" };

bankRequests = {};
bankRequestCounter = 1000;

try { if (fs.existsSync('subscriptions.json')) subscriptions = JSON.parse(fs.readFileSync('subscriptions.json')); } catch (e) {}
try { if (fs.existsSync('discord_config.json')) discordConfig = { ...discordConfig, ...JSON.parse(fs.readFileSync('discord_config.json')) }; } catch(e) {}
global.isNotificationsKilled = !!discordConfig.notificationsKilled;
let activeConversationChannels = new Set(Array.isArray(discordConfig.conversationChannels) ? discordConfig.conversationChannels : []);
const convoSessionStartTimestamps = new Map();
for (const chan of activeConversationChannels) {
    convoSessionStartTimestamps.set(chan, Date.now());
}
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

let battleStatsHistory = {};
const BATTLESTATS_HISTORY_FILE = path.join(__dirname, 'data', 'battlestats_history.json');
try {
    if (fs.existsSync(BATTLESTATS_HISTORY_FILE)) {
        battleStatsHistory = JSON.parse(fs.readFileSync(BATTLESTATS_HISTORY_FILE, 'utf8'));
    }
} catch(e) {
    console.error('[BattleStats] Error loading battlestats_history.json:', e.message);
}

function saveBattleStatsHistory() {
    try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(BATTLESTATS_HISTORY_FILE, JSON.stringify(battleStatsHistory, null, 2), 'utf8');
    } catch(e) {
        console.error('[BattleStats] Error saving battlestats_history.json:', e.message);
    }
    saveToMongo();
}

const VERIFIED_DISCORD_FILE = path.join(__dirname, 'data', 'verified_discord_users.json');
try {
    if (fs.existsSync(VERIFIED_DISCORD_FILE)) {
        verifiedDiscordToTorn = JSON.parse(fs.readFileSync(VERIFIED_DISCORD_FILE, 'utf8'));
    }
} catch(e) {
    console.error('[VerifiedUsers] Error loading verified_discord_users.json:', e.message);
}

function saveVerifiedDiscordUsers() {
    try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(VERIFIED_DISCORD_FILE, JSON.stringify(verifiedDiscordToTorn, null, 2), 'utf8');
    } catch(e) {
        console.error('[VerifiedUsers] Error saving verified_discord_users.json:', e.message);
    }
    saveToMongo();
}

try { if (fs.existsSync('spy_db.json')) spyDatabase = JSON.parse(fs.readFileSync('spy_db.json')); } catch(e) {}
try { if (fs.existsSync('user_tracking.json')) userTracking = JSON.parse(fs.readFileSync('user_tracking.json')); } catch(e) {}
try { if (fs.existsSync('api_pool.json')) apiPoolConfig = JSON.parse(fs.readFileSync('api_pool.json')); } catch(e) {}
try { if (fs.existsSync('company_config.json')) companyConfig = { ...companyConfig, ...JSON.parse(fs.readFileSync('company_config.json')) }; } catch(e) {}
try {
    const startupKey = (discordConfig && discordConfig.apiKey) || process.env.TORN_API_KEY || (apiPoolConfig && apiPoolConfig.keys && apiPoolConfig.keys[0]) || "";
    if (startupKey) {
        tornKnowledge.fetchFactionPerks(startupKey).catch(() => {});
    }
} catch(e) {}

let mongoSaveTimeout = null;
function saveToMongo() {
    if (mongoSaveTimeout) return;
    mongoSaveTimeout = setTimeout(() => {
        mongoSaveTimeout = null;
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
                        odAlerts: odAlertsMemory,
                        ocAlertTracker: (typeof ocAlertTracker !== 'undefined' ? ocAlertTracker : {}),
                        ocMemory: (typeof ocMemory !== 'undefined' ? ocMemory : {}),
                        ocMemberHistory: (typeof ocMemberHistory !== 'undefined' ? ocMemberHistory : {}),
                        giveaways: (typeof activeGiveaways !== 'undefined' ? activeGiveaways : {}),
                        warFlightArchive,
                        warAuditArchive,
                        lastWarboardPayload: lastGoodWarboardPayload,
                        userApiKeys: userKeys.exportEncryptedForMongo(),
                        userAlertPrefs: userAlerts.exportPrefsForMongo(),
                        battleStatsHistory: (typeof battleStatsHistory !== 'undefined' ? battleStatsHistory : {}),
                        verifiedDiscordUsers: (typeof verifiedDiscordToTorn !== 'undefined' ? verifiedDiscordToTorn : {}),
                        bugs: (typeof bugsMemory !== 'undefined' ? bugsMemory : []),
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            ).catch(e => console.error('[Mongo] Config save error:', e.message));
        }
    }, 2000);
}
userKeys.setMongoSaveCallback(saveToMongo);
userAlerts.setMongoSaveCallback(saveToMongo);
bugManager.setMongoSaveCallback(saveToMongo);

function saveDiscordConfig() { fs.writeFileSync('discord_config.json', JSON.stringify(discordConfig)); saveToMongo(); }
function saveMarketConfig() { fs.writeFileSync('market_config.json', JSON.stringify(marketConfig)); saveToMongo(); }
function saveOcConfig() { fs.writeFileSync('oc_config.json', JSON.stringify(ocConfig)); saveToMongo(); }

function saveSpyDb() { fs.writeFileSync('spy_db.json', JSON.stringify(spyDatabase)); saveToMongo(); }
function saveTracking() { fs.writeFileSync('user_tracking.json', JSON.stringify(userTracking)); saveToMongo(); }
function saveApiPool() { fs.writeFileSync('api_pool.json', JSON.stringify(apiPoolConfig)); syncTornApiManagerKeys(); saveToMongo(); }
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

// Startup grace period — prevents all background pollers from firing simultaneously on boot,
// which would cause an API burst that slows down Discord responses during startup.
const SERVER_START_TIME = Date.now();
const STARTUP_GRACE_MS = 30000; // 30 seconds grace before watchers begin

function getNextApiKey() {
    let activeKeys = [];
    
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
                            
                            fetch(ADMIN_DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [{ title: "💰 Payment Received", description: `Faction \`${facId}\` sent **${qty}x Xanax** for ${weeks} weeks of Warboard access!`, color: UI.COLORS.SUCCESS, footer: UI.FOOTER, timestamp: new Date().toISOString() }] }) }).catch(()=>{});
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


// // Background Task 4: Global Recruitment Scanner (PAUSED to conserve Render outbound bandwidth and Torn API budget)
// Recruitment scanning is available on-demand via the Turbo Mining UI (/recruits.html).
/*
setInterval(async () => {
    if (global.isTurboMining) return;
    let watchKey = getNextApiKey();
    if (!watchKey) return;

    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
    const recruitsFile = path.join(__dirname, 'data', 'recruits.json');
    let cachedRecruits = [];
    try {
        if (fs.existsSync(recruitsFile)) {
            cachedRecruits = JSON.parse(fs.readFileSync(recruitsFile, 'utf8'));
        }
    } catch (e) {}

    if (cachedRecruits.length > 2000) {
        cachedRecruits = cachedRecruits.slice(200);
    }

    const batchSize = 20;
    const randomIds = [];
    for (let i = 0; i < batchSize; i++) {
        const rand = Math.random();
        if (rand < 0.60) {
            randomIds.push(Math.floor(Math.random() * (5000000 - 4500000 + 1) + 4500000));
        } else if (rand < 0.90) {
            randomIds.push(Math.floor(Math.random() * (4500000 - 3000000 + 1) + 3000000));
        } else {
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
            
            if (profile.status && (profile.status.state === "Federal" || profile.status.state === "Fallen")) return null;
            if (profile.last_action && profile.last_action.timestamp) {
                const daysInactive = (Date.now() / 1000 - profile.last_action.timestamp) / 86400;
                if (daysInactive > 7) return null;
            }
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
    } catch (e) {}
}, 120000);
*/

// ── Retaliation & Member Attacked Real-time Alerts ──
const processedAlertedAttacks = new Set();

async function getPlayerStatsFromFFScouter(targetId) {
    if (!targetId || targetId === '0') return null;
    const sId = String(targetId).trim();
    const ffKey = (typeof getGlobalFFKey === 'function' ? getGlobalFFKey() : null) || discordConfig.ffKey;
    if (!ffKey) return null;

    try {
        const url = `https://ffscouter.com/api/v1/get-stats?key=${encodeURIComponent(ffKey)}&targets=${encodeURIComponent(sId)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => null);
        if (!data) return null;

        const list = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : [data]);
        const p = list.find(item => String(item.player_id || item.id) === sId) || list[0];
        if (p && (p.bs_estimate || p.total || p.bs_estimate_human)) {
            const rawVal = Number(p.bs_estimate || p.total || 0);
            const humanStr = p.bs_estimate_human || (rawVal > 0 ? `~${rawVal.toLocaleString()}` : null);
            const ff = p.fair_fight ? Number(p.fair_fight).toFixed(2) : null;
            
            if (rawVal > 0) {
                statsCache[sId] = { stats: rawVal, time: Date.now() };
                if (!spyDatabase[sId]) {
                    spyDatabase[sId] = {
                        total: rawVal,
                        timestamp: Date.now(),
                        source: 'ffscouter'
                    };
                }
            }

            return {
                total: rawVal,
                human: humanStr,
                fairFight: ff,
                source: p.source || 'FF Scouter'
            };
        }
    } catch(e) {
        console.warn(`[FF Scouter] Error getting stats for ${sId}:`, e.message);
    }
    return null;
}

async function handleMemberAttackedAlert(atk) {
    try {
        if (!atk) return;
        if (global.isNotificationsKilled) return;
        if (discordConfig.friendlyAttacked === false) return;

        const retalTargetChannel = (discordConfig.retalChannelId && String(discordConfig.retalChannelId).trim()) 
            || "1491499332044591176" 
            || discordConfig.globalChannelId;
        if (!retalTargetChannel || !discordConfig.globalBotToken) return;

        const alertCode = String(atk.code || atk._id || '');
        if (alertCode) {
            if (processedAlertedAttacks.has(alertCode)) return;
            processedAlertedAttacks.add(alertCode);

            if (processedAlertedAttacks.size > 5000) {
                const oldest = processedAlertedAttacks.values().next().value;
                processedAlertedAttacks.delete(oldest);
            }

            if (mongoose.connection.readyState === 1) {
                const existing = await mongoose.connection.db.collection('attack_alerts').findOne({ _id: alertCode });
                if (existing) return;
                await mongoose.connection.db.collection('attack_alerts').insertOne({
                    _id: alertCode,
                    timestamp: atk.timestamp || atk.timestamp_ended,
                    attacker_id: atk.attacker_id,
                    defender_id: atk.defender_id,
                    alerted_at: new Date()
                }).catch(() => {});
            }
        }

        const attackerId = atk.attacker_id ? String(atk.attacker_id).trim() : "0";
        const defenderId = atk.defender_id ? String(atk.defender_id).trim() : "0";
        const atkFac = Number(atk.attacker_faction || atk.attacker_faction_id || 0);
        const defFac = Number(atk.defender_faction || atk.defender_faction_id || 0);

        // Skip self attacks
        if (attackerId && defenderId && attackerId === defenderId) return;

        const isInternal = (atkFac === 52355 && defFac === 52355);
        const isStealthed = (attackerId === "0" || !attackerId);

        let attackerName = atk.attacker_name;
        if (!attackerName || attackerName === 'Unknown') {
            attackerName = isStealthed ? "Someone (Stealthed)" : await resolvePlayerName(attackerId, `Player [${attackerId}]`);
        }

        let defenderName = atk.defender_name;
        if (!defenderName || defenderName === 'Unknown') {
            defenderName = await resolvePlayerName(defenderId, `Member [${defenderId}]`);
        }

        let attackerFactionName = atk.attacker_faction_name || atk.attacker_factionname;
        if (!attackerFactionName) {
            attackerFactionName = isInternal ? "Spider-Verse" : (atkFac ? `Faction ${atkFac}` : "Factionless");
        }

        const result = atk.result || "Attacked";
        const isDefended = ["Lost", "Defended", "Stalemate", "Escape", "Timeout", "Interrupted"].includes(result);

        const title = isDefended ? "🛡️ Faction Member Defended Attack" : "🚨 Faction Member Attacked";
        const color = isDefended ? (UI.COLORS?.SUCCESS || 0x00b894) : (UI.COLORS?.ERROR || 0xe17055);

        let desc = "";
        if (isInternal) {
            desc = `**${defenderName}** was attacked by fellow faction member **${attackerName}** [${attackerId}] (Friendly Sparring / Test Hit).`;
        } else if (isStealthed) {
            desc = `**${defenderName}** was attacked by an unknown assailant (**Someone** — stealthed hit).`;
        } else {
            desc = `**${defenderName}** was attacked by **${attackerName}** [${attackerId}] from \`${attackerFactionName}\`.`;
        }

        const fields = [
            { name: "Result", value: result, inline: true }
        ];

        // 1. Attacker Estimated Battle Stats (Query FF Scouter for live accurate stats!)
        if (!isStealthed) {
            let statDisplay = "Unknown";
            const ffStats = await getPlayerStatsFromFFScouter(attackerId);
            if (ffStats) {
                const ffPart = ffStats.fairFight ? ` (FF: ${ffStats.fairFight})` : '';
                statDisplay = `~${ffStats.human || ffStats.total.toLocaleString()}${ffPart} [FF Scouter]`;
            } else {
                const rawEst = (spyDatabase[attackerId]?.total) || (statsCache[attackerId]?.stats) || (manualStats[attackerId]?.stats) || 0;
                if (rawEst > 0) {
                    statDisplay = `~${rawEst.toLocaleString()}`;
                }
            }
            fields.push({ name: "Attacker Est. Stats", value: statDisplay, inline: true });
        }

        // 2. Full Retaliation Risk Engine Breakdown (Always active when attacker is known)
        if (!isStealthed) {
            try {
                const risk = await retalEngine.getRiskScore(attackerId, atkFac);
                if (risk && risk.adjusted_rate !== undefined) {
                    const riskPct = Math.round((risk.adjusted_rate || 0) * 100);
                    const filled = Math.min(10, Math.max(0, Math.round(riskPct / 10)));
                    const empty = Math.max(0, 10 - filled);
                    const bar = '`' + '▓'.repeat(filled) + '░'.repeat(empty) + '`';

                    fields.push({
                        name: "🛡️ Retaliation Probability",
                        value: `**${riskPct}%** ${bar}`,
                        inline: true
                    });

                    fields.push({
                        name: "🎯 Risk Confidence",
                        value: risk.confidence_label || 'Empirical Bayes Prior (k=7)',
                        inline: true
                    });

                    let windowStr = '⏱️ Pending more observations';
                    if (risk.avg_response_seconds) {
                        const avgMin = Math.round(risk.avg_response_seconds / 60);
                        windowStr = avgMin <= 10 ? `⚡ Fast (<10m, avg ~${avgMin}m)` : `⏳ Delayed (avg ~${avgMin}m)`;
                    }
                    fields.push({
                        name: "⏱️ Response Window",
                        value: windowStr,
                        inline: true
                    });

                    if (risk.win_loss_ratio !== null && risk.win_loss_ratio !== undefined) {
                        const wlText = risk.win_loss_ratio < 0.5 ? 'Favors us' : risk.win_loss_ratio > 1.5 ? 'Dangerous' : 'Even';
                        fields.push({
                            name: "⚔️ Retal Win/Loss",
                            value: `${risk.win_loss_ratio}:1 (${wlText})`,
                            inline: true
                        });
                    }

                    if (risk.retaliator_pool && risk.retaliator_pool.length > 0) {
                        const poolLines = risk.retaliator_pool.slice(0, 3).map((r, i) => {
                            const icon = i === 0 ? '🔴' : i === 1 ? '🟡' : '🟠';
                            return `${icon} [Player ${r.id}](https://www.torn.com/profiles.php?XID=${r.id}) — ${r.count} confirmed retal${r.count !== 1 ? 's' : ''}`;
                        });
                        fields.push({
                            name: "⚠️ Likely Retaliators",
                            value: poolLines.join('\n'),
                            inline: false
                        });
                    } else if (isInternal) {
                        fields.push({
                            name: "⚠️ Likely Retaliators",
                            value: "*Internal sparring hit between faction members — no enemy retal risk.*",
                            inline: false
                        });
                    }
                }
            } catch(e) {
                console.warn('[Discord Retal Sentinel] Risk score calc warning:', e.message);
            }
        }

        const links = [];
        if (!isStealthed) {
            links.push({ label: "⚔️ Retaliate / Attack", url: `https://www.torn.com/page.php?sid=attack&user2ID=${attackerId}` });
            links.push({ label: "👤 Attacker Profile", url: `https://www.torn.com/profiles.php?XID=${attackerId}` });
        }
        if (defenderId !== "0" && defenderId) {
            links.push({ label: "🛡️ Defender Profile", url: `https://www.torn.com/profiles.php?XID=${defenderId}` });
        }

        // Ping Retaliator Role + Defender
        let pingStr = "";
        if (defenderId !== "0" && defenderId) {
            const dId = await getDiscordId(defenderId);
            if (dId && /^\d{17,20}$/.test(dId)) {
                pingStr = `<@${dId}>`;
            }
        }

        const roleId = discordConfig.retalRoleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            let rPing = "";
            if (numOnly.length >= 15 && numOnly.length <= 22) rPing = `<@&${numOnly}>`;
            else if (roleId === '@here' || roleId === '@everyone') rPing = roleId;
            if (rPing) pingStr = pingStr ? `${rPing} ${pingStr}` : rPing;
        }

        const embed = {
            title,
            description: desc,
            color,
            footer: { text: "F.R.I.D.A.Y Retaliation Risk Engine • Empirical Bayes k=7 • λ=0.05" },
            timestamp: new Date().toISOString(),
            targetId: (!isStealthed && attackerId !== "0") ? attackerId : undefined,
            fields,
            links
        };

        console.log(`[Discord Retal Sentinel] Sending member attacked alert to channel ${retalTargetChannel}: ${desc}`);
        await sendChannelMessage(discordConfig.globalBotToken, retalTargetChannel, embed, pingStr, true);
    } catch(err) {
        console.warn('[Discord Retal Sentinel] Error sending member attacked alert:', err.message);
    }
}

// Background Task 1: Wall Watcher & Scraper (Adaptive War/Peace Polling)
let lastPeaceWarCheck = 0;
setInterval(async () => {
    if (Date.now() - SERVER_START_TIME < STARTUP_GRACE_MS) return; // startup grace
    if (global.isTurboMining) return;
    let watchFactionId = discordConfig.factionId || dynamicFactionId || "52355";
    let watchKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
    if (!watchKey || !watchFactionId) return;

    // Bandwidth Optimization: In peace time (no active war), poll lightweight rankedwars (1 KB) once every 60s
    // When a war is active, poll full attacks & roster every 25s
    const now = Date.now();
    if (!activeWarId && (now - lastPeaceWarCheck < 60000)) {
        return;
    }

    try {
        const selections = activeWarId ? 'attacks,basic,rankedwars' : 'rankedwars';
        const liveRes = await fetch(`https://api.torn.com/faction/${watchFactionId}?selections=${selections}&key=${watchKey}`);
        const liveData = await liveRes.json();
        if (!activeWarId) lastPeaceWarCheck = Date.now();
        
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
                                    color: UI.COLORS.ERROR,
                                    footer: UI.FOOTER,
                                    links: [
                                        { label: "🔗 View Chain", url: `https://www.torn.com/factions.php?step=your#/tab=chains` },
                                        { label: "📡 Live Warboard", url: `https://torn-company-app-production.up.railway.app/` }
                                    ]
                                };
                                if (discordConfig.globalBotToken) {
                                    sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, embed, pingStr);
                                }
                            }
                        }
                    }
                    
                    if (hasBackfilledWar && isRecent) {
                        handleMemberAttackedAlert({
                            code: atk.code || atkId,
                            attacker_id: attackerId,
                            attacker_name: atk.attacker_name,
                            attacker_faction: atk.attacker_faction,
                            attacker_faction_name: atk.attacker_faction_name,
                            defender_id: uId,
                            defender_name: atk.defender_name,
                            defender_faction: atk.defender_faction,
                            defender_faction_name: atk.defender_faction_name,
                            result: atk.result,
                            timestamp: atk.timestamp_ended
                        }).catch(e => console.warn('[Retal Alert War] Error:', e.message));
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
                                color: UI.COLORS.WARNING,
                                footer: UI.FOOTER,
                                timestamp: new Date().toISOString(),
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
                                color: UI.COLORS.WARNING,
                                footer: UI.FOOTER,
                                timestamp: new Date().toISOString(),
                                links: [
                                    { label: "✈️ Travel Agency", url: `https://www.torn.com/travelagency.php` },
                                    { label: "🌐 Travel Desk", url: `https://torn-company-app-production.up.railway.app/travel.html` }
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
}, 25000); // 25s loop during war, adaptive 60s lightweight check during peace 

// Background Task 2: Market Watcher
setInterval(async () => {
    if (Date.now() - SERVER_START_TIME < STARTUP_GRACE_MS) return; // startup grace
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
                                    description: `Your \`${myItem.name}\` (${myItem.price.toLocaleString()}) was undercut!\nNew lowest price: **${lowestMarketPrice.toLocaleString()}**`,
                                    color: UI.COLORS.WARNING,
                                    footer: UI.FOOTER,
                                    timestamp: new Date().toISOString(),
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

inactivityAlertsMemory = loadInactivityAlerts();

// ─── Player Drug Overdose Tracker & Discord Alerts ───────────────────────────
const OVERDOSE_ALERTS_FILE = path.join(__dirname, 'data', 'overdose_alerts.json');

function loadOverdoseAlerts() {
    try {
        if (!fs.existsSync(path.dirname(OVERDOSE_ALERTS_FILE))) {
            fs.mkdirSync(path.dirname(OVERDOSE_ALERTS_FILE), { recursive: true });
        }
        if (fs.existsSync(OVERDOSE_ALERTS_FILE)) {
            return JSON.parse(fs.readFileSync(OVERDOSE_ALERTS_FILE, 'utf8'));
        }
    } catch (e) {}
    return { alerts: {}, initialized: false };
}

function saveOverdoseAlerts(data) {
    try {
        if (!fs.existsSync(path.dirname(OVERDOSE_ALERTS_FILE))) {
            fs.mkdirSync(path.dirname(OVERDOSE_ALERTS_FILE), { recursive: true });
        }
        fs.writeFileSync(OVERDOSE_ALERTS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
    saveToMongo();
}

odAlertsMemory = loadOverdoseAlerts();

// ─── F.R.I.D.A.Y Community Bug Tracker ──────────────────────────────────────
let bugsMemory = bugManager.bugsMemory;
function saveBugs(data) {
    bugManager.setBugsMemory(data);
}

// ─── Organized Crime Member Participation History ───────────────────────────
const OC_MEMBER_HISTORY_FILE = path.join(__dirname, 'data', 'oc_member_history.json');
function loadOcMemberHistory() {
    try {
        if (!fs.existsSync(path.dirname(OC_MEMBER_HISTORY_FILE))) {
            fs.mkdirSync(path.dirname(OC_MEMBER_HISTORY_FILE), { recursive: true });
        }
        if (fs.existsSync(OC_MEMBER_HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(OC_MEMBER_HISTORY_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}
function saveOcMemberHistory(data) {
    try {
        if (!fs.existsSync(path.dirname(OC_MEMBER_HISTORY_FILE))) {
            fs.mkdirSync(path.dirname(OC_MEMBER_HISTORY_FILE), { recursive: true });
        }
        fs.writeFileSync(OC_MEMBER_HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
}
ocMemberHistory = loadOcMemberHistory();

// ─── Organized Crime Alert Trackers & Memory (Persistent Across Deploys & Restarts) ───
const OC_ALERT_TRACKER_FILE = path.join(__dirname, 'data', 'oc_alert_tracker.json');
function loadOcAlertTracker() {
    try {
        if (!fs.existsSync(path.dirname(OC_ALERT_TRACKER_FILE))) {
            fs.mkdirSync(path.dirname(OC_ALERT_TRACKER_FILE), { recursive: true });
        }
        if (fs.existsSync(OC_ALERT_TRACKER_FILE)) {
            return JSON.parse(fs.readFileSync(OC_ALERT_TRACKER_FILE, 'utf8')) || {};
        }
    } catch(e) {}
    return {};
}
function saveOcAlertTracker() {
    try {
        if (!fs.existsSync(path.dirname(OC_ALERT_TRACKER_FILE))) {
            fs.mkdirSync(path.dirname(OC_ALERT_TRACKER_FILE), { recursive: true });
        }
        fs.writeFileSync(OC_ALERT_TRACKER_FILE, JSON.stringify(ocAlertTracker, null, 2), 'utf8');
    } catch(e) {}
    saveToMongo();
}
ocAlertTracker = loadOcAlertTracker();

const OC_MEMORY_FILE = path.join(__dirname, 'data', 'oc_memory.json');
function loadOcMemory() {
    try {
        if (!fs.existsSync(path.dirname(OC_MEMORY_FILE))) {
            fs.mkdirSync(path.dirname(OC_MEMORY_FILE), { recursive: true });
        }
        if (fs.existsSync(OC_MEMORY_FILE)) {
            return JSON.parse(fs.readFileSync(OC_MEMORY_FILE, 'utf8')) || {};
        }
    } catch(e) {}
    return {};
}
function saveOcMemory() {
    try {
        if (!fs.existsSync(path.dirname(OC_MEMORY_FILE))) {
            fs.mkdirSync(path.dirname(OC_MEMORY_FILE), { recursive: true });
        }
        // Clean entries older than 14 days to keep storage clean
        const fourteenDaysAgo = Date.now() - 14 * 86400000;
        for (const [k, v] of Object.entries(ocMemory)) {
            if (typeof v === 'number' && v < fourteenDaysAgo) {
                delete ocMemory[k];
            }
        }
        fs.writeFileSync(OC_MEMORY_FILE, JSON.stringify(ocMemory, null, 2), 'utf8');
    } catch(e) {}
    saveToMongo();
}
ocMemory = loadOcMemory();

// Persistent Real-Time War Flight Archive
const WAR_FLIGHT_ARCHIVE_FILE = path.join(__dirname, 'data', 'war_flight_archive.json');
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
    
    return UI.warning(
        '⏸ Alerts Paused',
        `All automated notifications have been paused by **${actorName}**.\n\n` +
        `Use \`/alerts resume\` or \`!resume\` to restore alerts.\n\n` +
        `**Paused systems:**\n` +
        `• Hospital & landing alerts\n` +
        `• Target online alerts\n` +
        `• Chain warnings\n` +
        `• Inactivity alerts\n` +
        `• Bazaar alerts`
    );
}

function handleLiveCommand(actorName = "Admin") {
    global.isNotificationsKilled = false;
    discordConfig.notificationsKilled = false;
    saveDiscordConfig();
    console.log(`[Killswitch] 🟢 Notifications RESTORED to LIVE by ${actorName}`);
    
    return UI.success(
        '🟢 Alerts Resumed',
        `Faction alerts are now active. Restored by **${actorName}**.\n\n` +
        `**Active systems:**\n` +
        `• Hospital & landing alerts\n` +
        `• Target online alerts\n` +
        `• Chain warnings\n` +
        `• Inactivity alerts\n` +
        `• Bazaar alerts`
    );
}


async function checkFactionMembersInactivity(members, expectedFactionId, factionName) {
    if (!members || typeof members !== 'object') return;
    if (global.isNotificationsKilled) return;
    if (discordConfig.inactivityTracker === false) return;
    if (!discordConfig.globalBotToken || !discordConfig.globalChannelId) return;

    const configuredFacId = String(discordConfig.factionId || dynamicFactionId || "52355");
    if (expectedFactionId && String(expectedFactionId) !== configuredFacId) {
        return;
    }

    const myFacId = configuredFacId;
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
        const timeDisplay = `${inactiveHours} hour${inactiveHours === 1 ? '' : 's'}`;
        const relText = m.last_action?.relative || `${inactiveHours} hour${inactiveHours === 1 ? '' : 's'} ago`;
        const memberStatus = m.status?.description || m.status?.state || m.last_action?.status || 'Offline';

        const embed = {
            title: `💤 Inactive Member`,
            description: `**[${m.name}](https://www.torn.com/profiles.php?XID=${id})** [${id}] has been offline for **${timeDisplay}** with no actions recorded.`,
            // Formerly: "${myFacName.toUpperCase()} INACTIVITY ALERT"
            color: UI.COLORS.WARNING,
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
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };

        const targetInactivityChan = discordConfig.inactivityChannelId || discordConfig.globalChannelId;
        console.log(`[Inactivity Tracker] 💤 Sending alert for ${m.name} [${id}] in ${myFacName} (${timeDisplay} inactive) to channel ${targetInactivityChan} with mention: ${roleMention || 'none'}`);
        sendChannelMessage(discordConfig.globalBotToken, targetInactivityChan, embed, roleMention);

        inactivityAlertsMemory.alerts[id] = {
            lastActionTs: lastTs,
            alertedAt: now,
            name: m.name,
            inactiveHours
        };
        saveInactivityAlerts(inactivityAlertsMemory);
    }
}

async function checkFactionOverdoses(members, expectedFactionId, factionName) {
    if (!members || typeof members !== 'object') return;
    if (global.isNotificationsKilled) return;
    if (discordConfig.alertOverdose === false) return;
    const botToken = discordConfig.globalBotToken;
    const targetChan = discordConfig.overdoseChannelId || discordConfig.globalChannelId;
    if (!botToken || !targetChan) return;

    const configuredFacId = String(discordConfig.factionId || dynamicFactionId || "52355");
    // Strict Guard: Never process overdoses for any foreign faction
    if (expectedFactionId && String(expectedFactionId) !== configuredFacId) {
        console.warn(`[Overdose Watcher] Rejected foreign faction: expectedFactionId ${expectedFactionId} !== configuredFacId ${configuredFacId}`);
        return;
    }

    const myFacId = configuredFacId;
    const myFacName = factionName || "Spider-Verse";
    const nowSec = Math.floor(Date.now() / 1000);

    // Initial startup check: seed existing active overdoses so server restart never triggers spam
    if (!odAlertsMemory.initialized) {
        for (const [id, m] of Object.entries(members)) {
            const desc = (m.status?.description || '').toLowerCase();
            const details = (m.status?.details || '').toLowerCase();
            const isOd = desc.includes('overdose') || details.includes('overdose') || desc.includes('overdosed') || details.includes('overdosed');
            if (isOd && m.status?.until && m.status.until > nowSec) {
                odAlertsMemory.alerts[id] = {
                    until: m.status.until,
                    alertedAt: nowSec,
                    name: m.name,
                    seeded: true
                };
            }
        }
        odAlertsMemory.initialized = true;
        saveOverdoseAlerts(odAlertsMemory);
    }

    // Clean up stale alerts: ONLY prune when member exists and is confirmed NOT in hospital and at least 30 minutes have passed since the alert
    let pruned = false;
    for (const [id, alertInfo] of Object.entries(odAlertsMemory.alerts || {})) {
        const m = members[id];
        const timeSinceAlert = nowSec - (alertInfo.alertedAt || 0);
        if (m) {
            const state = (m.status?.state || '').toLowerCase();
            // Player is confirmed out of hospital AND at least 30 mins passed since alert
            if (state !== 'hospital' && timeSinceAlert > 1800) {
                delete odAlertsMemory.alerts[id];
                pruned = true;
            }
        } else {
            // Member not found in our faction member list - NEVER immediately prune!
            // Only prune after 7 days to prevent cache-busting / desync duplicates
            if (timeSinceAlert > 604800) {
                delete odAlertsMemory.alerts[id];
                pruned = true;
            }
        }
    }
    if (pruned) saveOverdoseAlerts(odAlertsMemory);

    // Resolve optional role mention
    let roleMention = "";
    if (discordConfig.overdoseRoleId && String(discordConfig.overdoseRoleId).trim()) {
        const rawRole = String(discordConfig.overdoseRoleId).trim();
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
        const state = (m.status?.state || '').toLowerCase();
        const desc = (m.status?.description || '');
        const details = (m.status?.details || '');
        const descLower = desc.toLowerCase();
        const detailsLower = details.toLowerCase();

        const isOd = descLower.includes('overdose') || detailsLower.includes('overdose') ||
                     descLower.includes('overdosed') || detailsLower.includes('overdosed');

        if (!isOd) continue;
        if (m.status?.until && m.status.until <= nowSec) continue;

        const untilTs = m.status?.until || 0;
        const prior = odAlertsMemory.alerts[id];

        // Strict Deduplication:
        // 1. If alerted in the last 24 hours (86400 sec), NEVER re-alert while still in hospital
        // 2. If same until timestamp (or within 2 hours of it due to medical items)
        if (prior) {
            const timeSinceAlert = nowSec - (prior.alertedAt || 0);
            if (timeSinceAlert < 86400) {
                continue;
            }
            if (Math.abs((prior.until || 0) - untilTs) < 7200) {
                continue;
            }
        }

        const pName = m.name || `Player [${id}]`;
        const profileUrl = `https://www.torn.com/profiles.php?XID=${id}`;
        const msgUrl = `https://www.torn.com/messages.php#/p=compose&XID=${id}`;

        let timeLeftStr = "Unknown";
        if (untilTs > nowSec) {
            const diffSec = untilTs - nowSec;
            const hrs = Math.floor(diffSec / 3600);
            const mins = Math.floor((diffSec % 3600) / 60);
            const durStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
            timeLeftStr = `**${durStr}** (Free <t:${untilTs}:R>)`;
        } else if (desc) {
            timeLeftStr = desc;
        }

        const embed = {
            title: `💊 Member Overdosed: ${pName}`,
            description: `**[${pName}](${profileUrl})** [${id}] has overdosed on drugs and is currently in the hospital!\n\n` +
                         `🚑 **Needs a revive or medical attention.**`,
            color: UI.COLORS.ERROR,
            fields: [
                { name: "🏥 Hospital Status", value: desc || "In hospital from drug overdose", inline: true },
                { name: "⏱️ Time Left", value: timeLeftStr, inline: true },
                { name: "🎖️ Faction Position", value: `${m.position || 'Member'} (Lvl ${m.level || '—'})`, inline: true },
                { name: "🕒 Last Action", value: `${m.last_action?.relative || 'Recently'} (${m.last_action?.status || 'Offline'})`, inline: true }
            ],
            links: [
                { label: "🚑 Revive on Torn", url: profileUrl },
                { label: "👤 View Profile", url: profileUrl },
                { label: "💬 Send Message", url: msgUrl }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };

        console.log(`[Overdose Watcher] 💊 Alerting for ${pName} [${id}] in ${myFacName} (OD: ${desc}) to channel ${targetChan} with mention: ${roleMention || 'none'}`);
        sendChannelMessage(botToken, targetChan, embed, roleMention).catch(err => {
            console.error('[Overdose Watcher] Send error:', err.message);
        });

        odAlertsMemory.alerts[id] = {
            until: untilTs,
            alertedAt: nowSec,
            name: pName,
            desc
        };
        saveOverdoseAlerts(odAlertsMemory);
    }
}

// Background Task 3: Sniper & Target Status Watcher
setInterval(async () => {
    if (Date.now() - SERVER_START_TIME < STARTUP_GRACE_MS) return; // startup grace
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
        const inactChan = discordConfig.inactivityChannelId || discordConfig.globalChannelId;
        if (facData.members && discordConfig.inactivityTracker !== false && inactChan) {
            checkFactionMembersInactivity(facData.members, watchFactionId, facData.name);
        }

        // Check Friendly Member Drug Overdoses
        if (facData.members && discordConfig.alertOverdose !== false) {
            checkFactionOverdoses(facData.members, watchFactionId, facData.name);
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
                        title: "⚠️ Chain Dropping — Warning",
                        description: `Active chain is under 90 seconds (**${secondsLeft}s** left)! Someone needs to make a hit right now!`,
                        color: UI.COLORS.ERROR,
                        footer: UI.FOOTER,
                        timestamp: new Date().toISOString(),
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
                                color: UI.COLORS.SUCCESS,
                                footer: UI.FOOTER,
                                timestamp: new Date().toISOString(), 
                                targetId: id,
                                links: [
                                    { label: "⚔️ Attack", url: `https://www.torn.com/page.php?sid=attack&user2ID=${id}` },
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
                                color: UI.COLORS.INFO,
                                footer: UI.FOOTER,
                                timestamp: new Date().toISOString(), 
                                targetId: id,
                                links: [
                                    { label: "⚔️ Attack", url: `https://www.torn.com/page.php?sid=attack&user2ID=${id}` },
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
                                    color: UI.COLORS.WARNING,
                                    footer: UI.FOOTER,
                                    timestamp: new Date().toISOString(),
                                    targetId: id,
                                    fields: [
                                        { name: "Est. Battle Stats", value: statStr, inline: true },
                                        { name: "Suggested Fighter", value: bestMatchName ? `**${bestMatchName}** — matched by stats` : "No match found", inline: false }
                                    ],
                                    links: [
                                        { label: "⚔️ Attack", url: `https://www.torn.com/page.php?sid=attack&user2ID=${id}` },
                                        { label: "👤 Profile", url: `https://www.torn.com/profiles.php?XID=${id}` }
                                    ]
                                }, pingStr);
                                
                            } else if (discordConfig.targetOutHosp === true && !leftEarly) {
                                if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { 
                                    title: "🏥 Target Out of Hospital", 
                                    description: `**${m.name}** [${id}] served their full hospital time and is now Okay.`, 
                                    color: UI.COLORS.INFO,
                                    footer: UI.FOOTER,
                                    timestamp: new Date().toISOString(), 
                                    targetId: id,
                                    links: [
                                        { label: "⚔️ Attack", url: `https://www.torn.com/page.php?sid=attack&user2ID=${id}` },
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
    if (Date.now() - SERVER_START_TIME < STARTUP_GRACE_MS) return; // startup grace
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
                    if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, companyConfig.globalChannelId, { title: "📉 Low Stock Alert", description: `**${itemName}** is running low!\nOnly **${currentStock.toLocaleString()}** remaining in stock.`,
                        color: UI.COLORS.WARNING,
                        footer: UI.FOOTER,
                        timestamp: new Date().toISOString(),
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
    const fullConfig = {
        ...discordConfig,
        retalChannelId: discordConfig.retalChannelId || "1491499332044591176",
        retalRoleId: discordConfig.retalRoleId || "",
        inactivityChannelId: discordConfig.inactivityChannelId || "",
        promotionChannelId: discordConfig.promotionChannelId || "",
        overdoseChannelId: discordConfig.overdoseChannelId || "",
        overdoseRoleId: discordConfig.overdoseRoleId || "",
        alertOverdose: discordConfig.alertOverdose !== false,
        ocChannelId: ocConfig.globalChannelId || discordConfig.ocChannelId || "",
        ocRoleId: ocConfig.roleId || discordConfig.ocRoleId || "",
        ocManagerRoleId: ocConfig.ocManagerRoleId || "",
        ocManagerUserIds: ocConfig.ocManagerUserIds || "",
        dmOcManagersOnLowCpr: ocConfig.dmOcManagersOnLowCpr !== false,
        dmPlayerOnLowCpr: ocConfig.dmPlayerOnLowCpr !== false,
        alertOcPlanned: ocConfig.alertPlanned !== false,
        alertCountdown4h: ocConfig.alertCountdown4h !== false,
        alertCountdown2h: ocConfig.alertCountdown2h !== false,
        alertOcUpcoming: ocConfig.alertUpcoming !== false,
        ocUpcomingMinutes: ocConfig.upcomingMinutes || 30,
        alertOcReady: ocConfig.alertReady !== false,
        alertOcDelayed: ocConfig.alertDelayed !== false,
        alertOcMissingItems: ocConfig.alertMissingItems !== false,
        alertOcCompleted: ocConfig.alertCompleted !== false,
        alertOcLowCpr: ocConfig.alertLowCpr !== false,
        lowCprDefaultThreshold: ocConfig.lowCprDefaultThreshold || 40,
        lowCprLevels: ocConfig.lowCprLevels || { 1: 0, 2: 0, 3: 50, 4: 50, 5: 40, 6: 40, 7: 80, 8: 85 },
        alertOcNoParticipation: ocConfig.alertNoParticipation !== false,
        noParticipationDays: ocConfig.noParticipationDays || 1,
        welcomeChannelId: discordConfig.welcomeChannelId || "",
        postWelcomeRulesOnJoin: discordConfig.postWelcomeRulesOnJoin !== false,
        welcomeRulesTitle: discordConfig.welcomeRulesTitle || "📜 Welcome to the Faction & Server Rules",
        welcomeRulesContent: discordConfig.welcomeRulesContent || DEFAULT_WELCOME_RULES
    };
    // Scrub sensitive credentials from client response
    delete fullConfig.apiKey;
    delete fullConfig.globalBotToken;
    delete fullConfig.personalDiscordId;
    delete fullConfig.geminiApiKey;
    delete fullConfig.geminiApiKeys;
    delete fullConfig.openrouterApiKey;
    for (let i = 0; fullConfig[i] !== undefined; i++) {
        delete fullConfig[i];
    }
    fullConfig.hasBotToken = !!(discordConfig.globalBotToken && discordConfig.globalBotToken.length > 20);
    res.json(fullConfig);
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

    if (payload.inactivityChannelId !== undefined) {
        let rawInact = String(payload.inactivityChannelId || '').trim();
        if (rawInact.includes('.') || /[a-zA-Z]/.test(rawInact)) {
            payload.inactivityChannelId = "";
        } else {
            payload.inactivityChannelId = rawInact.replace(/[^0-9]/g, '');
        }
    }

    if (payload.promotionChannelId !== undefined) {
        let rawPromo = String(payload.promotionChannelId || '').trim();
        if (rawPromo.includes('.') || /[a-zA-Z]/.test(rawPromo)) {
            payload.promotionChannelId = "";
        } else {
            payload.promotionChannelId = rawPromo.replace(/[^0-9]/g, '');
        }
    }

    if (payload.overdoseChannelId !== undefined) {
        let rawOd = String(payload.overdoseChannelId || '').trim();
        if (rawOd.includes('.') || /[a-zA-Z]/.test(rawOd)) {
            payload.overdoseChannelId = "";
        } else {
            payload.overdoseChannelId = rawOd.replace(/[^0-9]/g, '');
        }
    }
    if (payload.overdoseRoleId !== undefined) payload.overdoseRoleId = String(payload.overdoseRoleId || '').trim();
    if (payload.alertOverdose !== undefined) payload.alertOverdose = !!payload.alertOverdose;

    if (payload.bankingChannelId !== undefined) {
        let rawBank = String(payload.bankingChannelId || '').trim();
        if (rawBank.includes('.') || /[a-zA-Z]/.test(rawBank)) {
            payload.bankingChannelId = "";
        } else {
            payload.bankingChannelId = rawBank.replace(/[^0-9]/g, '');
        }
    }

    if (payload.retalChannelId !== undefined) {
        let rawRetal = String(payload.retalChannelId || '').trim();
        if (rawRetal.includes('.') || /[a-zA-Z]/.test(rawRetal)) {
            payload.retalChannelId = "";
        } else {
            payload.retalChannelId = rawRetal.replace(/[^0-9]/g, '');
        }
    }
    if (payload.retalRoleId !== undefined) payload.retalRoleId = String(payload.retalRoleId || '').trim();

    if (payload.ocChannelId !== undefined) {
        let rawOc = String(payload.ocChannelId || '').trim();
        if (rawOc.includes('.') || /[a-zA-Z]/.test(rawOc)) {
            payload.ocChannelId = "";
        } else {
            payload.ocChannelId = rawOc.replace(/[^0-9]/g, '');
        }
        ocConfig.globalChannelId = payload.ocChannelId;
    }
    if (payload.ocRoleId !== undefined) ocConfig.roleId = String(payload.ocRoleId || '').trim();
    if (payload.ocManagerRoleId !== undefined) ocConfig.ocManagerRoleId = String(payload.ocManagerRoleId || '').replace(/[^0-9]/g, '');
    if (payload.ocManagerUserIds !== undefined) ocConfig.ocManagerUserIds = String(payload.ocManagerUserIds || '').trim();
    if (payload.dmOcManagersOnLowCpr !== undefined) ocConfig.dmOcManagersOnLowCpr = !!payload.dmOcManagersOnLowCpr;
    if (payload.dmPlayerOnLowCpr !== undefined) ocConfig.dmPlayerOnLowCpr = !!payload.dmPlayerOnLowCpr;
    if (payload.alertOcPlanned !== undefined) ocConfig.alertOcPlanned = !!payload.alertOcPlanned;
    if (payload.alertCountdown4h !== undefined) ocConfig.alertCountdown4h = !!payload.alertCountdown4h;
    if (payload.alertCountdown2h !== undefined) ocConfig.alertCountdown2h = !!payload.alertCountdown2h;
    if (payload.alertOcUpcoming !== undefined) ocConfig.alertUpcoming = !!payload.alertOcUpcoming;
    if (payload.ocUpcomingMinutes !== undefined) ocConfig.upcomingMinutes = parseInt(payload.ocUpcomingMinutes, 10) || 30;
    if (payload.alertOcReady !== undefined) ocConfig.alertReady = !!payload.alertOcReady;
    if (payload.alertOcDelayed !== undefined) ocConfig.alertDelayed = !!payload.alertOcDelayed;
    if (payload.alertOcMissingItems !== undefined) ocConfig.alertMissingItems = !!payload.alertOcMissingItems;
    if (payload.alertOcCompleted !== undefined) ocConfig.alertCompleted = !!payload.alertOcCompleted;
    if (payload.alertOcLowCpr !== undefined) ocConfig.alertLowCpr = !!payload.alertOcLowCpr;
    if (payload.lowCprDefaultThreshold !== undefined) ocConfig.lowCprDefaultThreshold = Math.max(1, Math.min(100, parseInt(payload.lowCprDefaultThreshold, 10) || 40));
    if (payload.lowCprLevels !== undefined && typeof payload.lowCprLevels === 'object') {
        ocConfig.lowCprLevels = { ...ocConfig.lowCprLevels, ...payload.lowCprLevels };
    }
    if (payload.alertOcNoParticipation !== undefined) ocConfig.alertNoParticipation = !!payload.alertOcNoParticipation;
    if (payload.noParticipationDays !== undefined) ocConfig.noParticipationDays = Math.max(0.1, parseFloat(payload.noParticipationDays) || 1);
    saveOcConfig();

    if (payload.globalBotToken !== undefined) {
        const rawToken = String(payload.globalBotToken || '').trim();
        if (rawToken.length > 20) {
            payload.globalBotToken = rawToken;
        } else if (rawToken === '') {
            delete payload.globalBotToken;
        }
    }
    delete payload.discord;
    delete discordConfig.discord;

    if (payload.welcomeChannelId !== undefined) {
        let rawWChan = String(payload.welcomeChannelId || '').trim();
        if (rawWChan.includes('.') || /[a-zA-Z]/.test(rawWChan)) {
            payload.welcomeChannelId = "";
        } else {
            payload.welcomeChannelId = rawWChan.replace(/[^0-9]/g, '');
        }
    }
    if (payload.postWelcomeRulesOnJoin !== undefined) payload.postWelcomeRulesOnJoin = !!payload.postWelcomeRulesOnJoin;
    if (payload.welcomeRulesTitle !== undefined) payload.welcomeRulesTitle = String(payload.welcomeRulesTitle || '').trim();
    if (payload.welcomeRulesContent !== undefined) payload.welcomeRulesContent = String(payload.welcomeRulesContent || '').trim();

    if (payload.verificationChannelId !== undefined) {
        let rawVChan = String(payload.verificationChannelId || '').trim();
        if (rawVChan.includes('.') || /[a-zA-Z]/.test(rawVChan)) {
            payload.verificationChannelId = "";
        } else {
            payload.verificationChannelId = rawVChan.replace(/[^0-9]/g, '');
        }
    }
    if (payload.notifyApiKeyLinked !== undefined) {
        payload.notifyApiKeyLinked = (payload.notifyApiKeyLinked === true || payload.notifyApiKeyLinked === 'true');
    }
    if (payload.unverifiedRoleId !== undefined) payload.unverifiedRoleId = String(payload.unverifiedRoleId || '').replace(/[^0-9]/g, '');
    if (payload.verifiedRoleId !== undefined) payload.verifiedRoleId = String(payload.verifiedRoleId || '').replace(/[^0-9]/g, '');
    if (payload.factionRoleId !== undefined) payload.factionRoleId = String(payload.factionRoleId || '').replace(/[^0-9]/g, '');
    if (payload.leaderRoleId !== undefined) payload.leaderRoleId = String(payload.leaderRoleId || '').replace(/[^0-9]/g, '');
    if (payload.autoVerifyOnJoin !== undefined) payload.autoVerifyOnJoin = !!payload.autoVerifyOnJoin;
    if (payload.disabledCommands !== undefined && Array.isArray(payload.disabledCommands)) {
        payload.disabledCommands = payload.disabledCommands.map(c => String(c).toLowerCase().trim()).filter(Boolean);
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
        try {
            userKeys.syncOwnerDetails(discordConfig.apiKey, discordConfig.personalDiscordId);
        } catch(e) {}
    }
    saveDiscordConfig(); 

    // Auto-start slash command bot whenever a bot token is saved
    if (discordConfig.globalBotToken && discordConfig.globalBotToken.trim().length > 20) {
        startSlashCommandBot(discordConfig.globalBotToken.trim()).catch(() => {});
    }

    res.json({ success: true, disabledCommands: discordConfig.disabledCommands || [] }); 
});

app.post('/api/discord/post-verification-card', async (req, res) => {
    if (!slashCommandBot || !slashCommandBot.isReady?.()) {
        return res.status(400).json({ error: "F.R.I.D.A.Y bot is not currently connected. Please save a valid Bot Token first." });
    }
    const channelId = req.body.channelId || discordConfig.verificationChannelId;
    if (!channelId) {
        return res.status(400).json({ error: "Verification Channel ID is not configured in settings." });
    }

    try {
        const channel = await slashCommandBot.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            return res.status(404).json({ error: `Could not find text channel with ID ${channelId}. Check bot permissions.` });
        }

        const verifiedRoleId = discordConfig.verifiedRoleId;
        const verifyCard = {
            title: `🛡️ Identity Verification Required`,
            description:
                `To protect faction intel and member privacy, all channels remain locked until your Torn City identity is verified.\n\n` +
                `**How to verify (Standard):**\n` +
                `**1.** Link your Discord account at **[torn.com/discord](https://www.torn.com/discord)** on the Official Torn Discord.\n` +
                `**2.** Click **🛡️ Verify Me** below — F.R.I.D.A.Y. will handle the rest.\n\n` +
                `⚡ **Optional Power-Up: Pre-Link Your API Key**\n` +
                `Save time later! Click **🔑 Link API Key (Optional)** below to connect your Torn **Limited Access API Key**. F.R.I.D.A.Y will securely encrypt and save it so you **never** have to enter it again for live battle stats (\`/bs\`), gym tracking, energy/nerve updates, or automated banking!\n\n` +
                `*Verification is instant if your account is already linked. Your nickname will be synced to \`Name [ID]\` and you'll receive your ${verifiedRoleId ? `<@&${verifiedRoleId}>` : '**Verified**'} role automatically.*`,
            color: UI.COLORS.BRAND,
            thumbnail: { url: "https://www.torn.com/favicon.ico" },
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };


        const buttons = [{
            type: 1,
            components: [
                {
                    type: 2,
                    style: 1, // Primary (Blurple)
                    custom_id: 'btn_verify_now',
                    label: '🛡️ Verify Me',
                    emoji: { name: '🛡️' }
                },
                {
                    type: 2,
                    style: 2, // Secondary
                    custom_id: 'btn_link_user_api_key',
                    label: '🔑 Link API Key (Optional)'
                },
                {
                    type: 2,
                    style: 5, // Link
                    label: '🔗 Link at Torn.com/discord',
                    url: 'https://www.torn.com/discord'
                },
                {
                    type: 2,
                    style: 5, // Link
                    label: '🔑 Get API Key',
                    url: 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2'
                }
            ]
        }];

        await channel.send({ embeds: [sanitizeEmbed(verifyCard)], components: buttons });
        res.json({ success: true, message: `Verification card posted to #${channel.name || channelId}!` });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// API endpoint: Send message through the bot to one or multiple Discord channels
app.post('/api/discord/send-bot-message', async (req, res) => {
    try {
        const token = (discordConfig.globalBotToken || '').trim();
        if (!token) {
            return res.status(400).json({ error: "F.R.I.D.A.Y bot is not currently connected. Please configure and save your Bot Token first." });
        }

        let { channelIds, message, mention, asEmbed, embedTitle, embedColor, embedFooter } = req.body;

        // Parse and clean channel IDs
        let targetIds = [];
        if (Array.isArray(channelIds)) {
            targetIds = channelIds.map(id => String(id).trim().replace(/[^0-9]/g, '')).filter(Boolean);
        } else if (typeof channelIds === 'string') {
            targetIds = channelIds.split(',').map(id => id.trim().replace(/[^0-9]/g, '')).filter(Boolean);
        }
        targetIds = [...new Set(targetIds)];

        if (targetIds.length === 0) {
            return res.status(400).json({ error: "Please select or enter at least one destination Channel ID." });
        }

        message = (message || '').trim();
        if (!message) {
            return res.status(400).json({ error: "Message content cannot be empty." });
        }

        // Construct mention string if requested
        let mentionText = '';
        if (mention === 'everyone') {
            mentionText = '@everyone\n';
        } else if (mention === 'here') {
            mentionText = '@here\n';
        } else if (mention && /^\d+$/.test(mention)) {
            mentionText = `<@&${mention}>\n`;
        }

        let messagePayload = {};
        if (asEmbed) {
            const hexClean = (embedColor || '#E63946').replace('#', '');
            const colorNum = parseInt(hexClean, 16) || UI.COLORS.BRAND;
            const embedObj = {
                title: embedTitle ? embedTitle.slice(0, 250) : undefined,
                description: message.slice(0, 4000),
                color: colorNum,
                footer: embedFooter ? { text: embedFooter.slice(0, 2048) } : UI.FOOTER,
                timestamp: new Date().toISOString()
            };
            messagePayload = {
                content: mentionText ? mentionText.trim() : undefined,
                embeds: [sanitizeEmbed(embedObj)]
            };
        } else {
            // Natural plain chat message directly from the bot
            const fullContent = mentionText ? `${mentionText}${message}` : message;
            messagePayload = {
                content: fullContent.slice(0, 2000)
            };
        }

        const results = [];
        let successCount = 0;

        for (const chanId of targetIds) {
            let channelName = chanId;
            let delivered = false;
            let errorDetail = null;
            let messageId = null;

            // Method 1: Use Discord.js client if ready
            if (slashCommandBot && slashCommandBot.isReady?.()) {
                try {
                    const chan = await slashCommandBot.channels.fetch(chanId).catch(() => null);
                    if (chan && chan.isTextBased()) {
                        channelName = chan.name ? `#${chan.name}` : chanId;
                        const sent = await chan.send(messagePayload);
                        delivered = true;
                        messageId = sent.id;
                    }
                } catch (e) {
                    errorDetail = e.message;
                }
            }

            // Method 2: Fallback to Discord REST API directly
            if (!delivered) {
                try {
                    const restRes = await fetch(`https://discord.com/api/v10/channels/${chanId}/messages`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bot ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(messagePayload)
                    });
                    const data = await restRes.json();
                    if (restRes.ok && data.id) {
                        delivered = true;
                        messageId = data.id;
                    } else {
                        errorDetail = data.message || `HTTP ${restRes.status} from Discord API`;
                    }
                } catch (e) {
                    errorDetail = errorDetail || e.message;
                }
            }

            if (delivered) {
                successCount++;
                results.push({ channelId: chanId, channelName, success: true, messageId });
            } else {
                results.push({ channelId: chanId, channelName, success: false, error: errorDetail || "Failed to deliver message" });
            }
        }

        return res.json({
            success: successCount > 0,
            sentCount: successCount,
            totalCount: targetIds.length,
            results
        });
    } catch (err) {
        console.error("[Send Bot Message Error]:", err);
        return res.status(500).json({ error: err.message || "Internal server error sending message" });
    }
});

// ── Safe Discord REST Fetcher (Enforces timeouts, headers, auto-retry on 429, and friendly error handling) ──
async function safeDiscordFetch(url, token, options = {}) {
    const timeoutMs = options.timeoutMs || 8000;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const fetchOptions = {
            method: options.method || 'GET',
            headers: {
                Authorization: `Bot ${token}`,
                'User-Agent': 'DiscordBot (https://torn-company-app-production.up.railway.app, 2.0)',
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {})
            },
            signal: ac.signal
        };
        if (options.body) {
            fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        }
        const res = await fetch(url, fetchOptions);
        clearTimeout(timer);

        const cType = res.headers.get('content-type') || '';
        let data = null;
        if (cType.includes('application/json')) {
            try {
                data = await res.json();
            } catch (e) {
                data = null;
            }
        }

        // Handle 429 Too Many Requests with automatic backoff retry
        if (res.status === 429) {
            const headerRetry = res.headers.get('retry-after') || res.headers.get('x-ratelimit-reset-after');
            const retryAfterSec = data?.retry_after ?? (headerRetry ? parseFloat(headerRetry) : 2);
            const retryCount = options._retryCount || 0;
            if (retryCount < 2 && retryAfterSec <= 12) {
                const waitMs = Math.min(Math.ceil(retryAfterSec * 1000) + 500, 15000);
                console.warn(`[safeDiscordFetch] Discord 429 rate limit hit (${retryAfterSec}s). Auto-waiting ${waitMs}ms before retry (attempt ${retryCount + 1}/2)...`);
                await new Promise(r => setTimeout(r, waitMs));
                return safeDiscordFetch(url, token, {
                    ...options,
                    _retryCount: retryCount + 1,
                    timeoutMs: Math.max(timeoutMs, waitMs + 8000)
                });
            }
            const cooldownSec = Math.ceil(retryAfterSec || 5);
            const err = new Error(`Discord API rate limit reached. Cooldown is ${cooldownSec}s. Please wait a moment and try again.`);
            err.status = 429;
            throw err;
        }

        if (res.status === 401) {
            const err = new Error("401 Unauthorized: Discord Bot Token is invalid or expired. Please reset your token in Discord Developer Portal -> Bot -> Reset Token.");
            err.status = 401;
            throw err;
        }

        if (!cType.includes('application/json')) {
            const err = new Error(`Discord API returned non-JSON HTTP ${res.status}.`);
            err.status = res.status;
            throw err;
        }

        if (!res.ok) {
            const err = new Error(data?.message || `Discord API error HTTP ${res.status}`);
            err.status = res.status;
            err.code = data?.code;
            throw err;
        }
        return data;
    } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
            const timeoutErr = new Error(`Discord API request timed out (${Math.round(timeoutMs / 1000)}s). Discord may be slow or unreachable.`);
            timeoutErr.status = 504;
            throw timeoutErr;
        }
        throw err;
    }
}

// API endpoint: Discord REST & Gateway Diagnostics (inspects IP rate limits vs Token rate limits)
app.get('/api/discord/diagnostics', async (req, res) => {
    const token = (req.query.token || discordConfig.globalBotToken || '').trim();
    const results = {};
    
    try {
        const publicRes = await fetch('https://discord.com/api/v10/gateway');
        results.publicGateway = {
            status: publicRes.status,
            ok: publicRes.ok,
            retryAfterHeader: publicRes.headers.get('retry-after'),
            contentType: publicRes.headers.get('content-type'),
            data: await publicRes.json().catch(() => null)
        };
    } catch (e) {
        results.publicGateway = { error: e.message };
    }

    if (token) {
        try {
            const authRes = await fetch('https://discord.com/api/v10/users/@me', {
                headers: {
                    Authorization: `Bot ${token}`,
                    'User-Agent': 'DiscordBot (https://torn-company-app-production.up.railway.app, 2.0)'
                }
            });
            results.usersMe = {
                status: authRes.status,
                ok: authRes.ok,
                retryAfterHeader: authRes.headers.get('retry-after'),
                xRateLimitReset: authRes.headers.get('x-ratelimit-reset'),
                xRateLimitResetAfter: authRes.headers.get('x-ratelimit-reset-after'),
                xRateLimitBucket: authRes.headers.get('x-ratelimit-bucket'),
                xRateLimitScope: authRes.headers.get('x-ratelimit-scope'),
                contentType: authRes.headers.get('content-type'),
                data: await authRes.json().catch(() => null)
            };
        } catch (e) {
            results.usersMe = { error: e.message };
        }
    }

    results.botReady = slashCommandBot?.isReady?.() || false;
    results.botTag = slashCommandBot?.user?.tag || null;

    res.json(results);
});

// API endpoint: Auto-detect Discord Guild, channels, and roles
app.get('/api/discord/guild-info', async (req, res) => {
    try {
        const token = (req.query.token || discordConfig.globalBotToken || '').trim();
        if (!token) {
            return res.status(400).json({ success: false, error: "Missing bot token. Please enter or save your Bot Token." });
        }

        // Fast-path: If the Discord gateway bot is already connected, serve directly from memory cache (0 REST calls)
        if (slashCommandBot && slashCommandBot.isReady && slashCommandBot.isReady()) {
            const meUser = slashCommandBot.user;
            const botAvatarUrl = meUser?.displayAvatarURL ? meUser.displayAvatarURL() : null;
            const cachedGuilds = Array.from(slashCommandBot.guilds.cache.values()).map(g => ({
                id: g.id,
                name: g.name,
                icon: g.icon
            }));

            let activeGuildId = req.query.guildId || discordConfig.guildId;
            let activeGuild = slashCommandBot.guilds.cache.get(activeGuildId) || slashCommandBot.guilds.cache.first();
            if (activeGuild) {
                activeGuildId = activeGuild.id;
                const categories = {};
                activeGuild.channels.cache.forEach(c => {
                    if (c.type === 4) categories[c.id] = c.name;
                });
                const channels = Array.from(activeGuild.channels.cache.values())
                    .filter(c => c.isTextBased && c.isTextBased())
                    .sort((a, b) => (a.position || 0) - (b.position || 0))
                    .map(c => ({
                        id: c.id,
                        name: c.name,
                        type: c.type,
                        parentName: c.parentId ? categories[c.parentId] : null,
                        position: c.position || 0
                    }));
                const roles = Array.from(activeGuild.roles.cache.values())
                    .sort((a, b) => (b.position || 0) - (a.position || 0))
                    .map(r => ({
                        id: r.id,
                        name: r.name,
                        color: r.color,
                        position: r.position || 0
                    }));

                return res.json({
                    success: true,
                    bot: { id: meUser.id, username: meUser.username, avatar: botAvatarUrl },
                    guilds: cachedGuilds,
                    guildId: activeGuildId,
                    guildName: activeGuild.name,
                    channels,
                    roles,
                    cached: true
                });
            }
        }

        // 1. Fetch user / bot identity
        let meData;
        try {
            meData = await safeDiscordFetch('https://discord.com/api/v10/users/@me', token, { timeoutMs: 8000 });
        } catch (authErr) {
            if (authErr.status === 401) {
                return res.status(401).json({
                    success: false,
                    isTokenInvalid: true,
                    error: "401 Unauthorized: Your Discord Bot Token is invalid or has expired. Please reset the token in the Discord Developer Portal."
                });
            }
            throw authErr;
        }

        const botAvatarUrl = meData?.avatar ? `https://cdn.discordapp.com/avatars/${meData.id}/${meData.avatar}.png` : null;

        // 2. Fetch guilds the bot is in
        const guilds = await safeDiscordFetch('https://discord.com/api/v10/users/@me/guilds', token, { timeoutMs: 8000 });
        if (!Array.isArray(guilds)) {
            return res.status(400).json({ success: false, error: "Failed to fetch guilds from Discord" });
        }

        if (guilds.length === 0) {
            return res.json({
                success: true,
                bot: { id: meData.id, username: meData.username, avatar: botAvatarUrl },
                guilds: [],
                guildId: null,
                guildName: null,
                channels: [],
                roles: [],
                message: "Bot is not in any Discord servers yet. Invite the bot to your server first."
            });
        }

        // Active guild: if req.query.guildId or discordConfig.guildId matches one of the guilds, use it. Otherwise default to the first guild.
        let activeGuildId = req.query.guildId || discordConfig.guildId;
        let activeGuild = guilds.find(g => g.id === activeGuildId);
        if (!activeGuild) {
            activeGuild = guilds[0];
            activeGuildId = activeGuild.id;
            if (!discordConfig.guildId || guilds.length === 1) {
                discordConfig.guildId = activeGuildId;
                saveDiscordConfig();
            }
        }

        // 3. Fetch channels and roles for the active guild
        const [rawChannels, rawRoles] = await Promise.all([
            safeDiscordFetch(`https://discord.com/api/v10/guilds/${activeGuildId}/channels`, token, { timeoutMs: 8000 }),
            safeDiscordFetch(`https://discord.com/api/v10/guilds/${activeGuildId}/roles`, token, { timeoutMs: 8000 })
        ]);

        // Build category map (type 4 = GuildCategory)
        const categories = {};
        if (Array.isArray(rawChannels)) {
            rawChannels.forEach(c => {
                if (c.type === 4) categories[c.id] = c.name;
            });
        }

        // Filter text & announcement channels (type 0: GuildText, 5: GuildAnnouncement)
        const channels = [];
        if (Array.isArray(rawChannels)) {
            rawChannels
                .filter(c => c.type === 0 || c.type === 5)
                .sort((a, b) => (a.position || 0) - (b.position || 0))
                .forEach(c => {
                    channels.push({
                        id: c.id,
                        name: c.name,
                        type: c.type,
                        parentName: c.parent_id ? categories[c.parent_id] : null,
                        position: c.position || 0
                    });
                });
        }

        // Filter roles
        const roles = [];
        if (Array.isArray(rawRoles)) {
            rawRoles
                .filter(r => r.name !== '@everyone')
                .sort((a, b) => (b.position || 0) - (a.position || 0))
                .forEach(r => {
                    roles.push({
                        id: r.id,
                        name: r.name,
                        color: r.color ? '#' + r.color.toString(16).padStart(6, '0') : null,
                        position: r.position || 0
                    });
                });
        }

        res.json({
            success: true,
            bot: { id: meData.id, username: meData.username, avatar: botAvatarUrl },
            guilds: guilds.map(g => ({ id: g.id, name: g.name, icon: g.icon })),
            guildId: activeGuildId,
            guildName: activeGuild.name,
            channels,
            roles
        });
    } catch (err) {
        console.warn("[guild-info Error]:", err.message);
        const status = err.status || 500;
        if (status === 429 && (discordConfig.guildId || discordConfig.globalGuildId)) {
            return res.json({
                success: true,
                rateLimited: true,
                guildId: discordConfig.guildId || discordConfig.globalGuildId,
                guildName: "Discord Server (Saved)",
                channels: discordConfig.globalChannelId ? [{ id: discordConfig.globalChannelId, name: "saved-channel" }] : [],
                roles: [],
                bot: { id: "bot", username: "F.R.I.D.A.Y" },
                message: "Discord API is on cooldown. Loaded saved configuration."
            });
        }
        res.status(status).json({
            success: false,
            isTokenInvalid: status === 401,
            error: err.message
        });
    }
});

app.get('/api/get-market-config', (req, res) => { res.json(marketConfig); });
app.post('/api/save-market-config', (req, res) => { marketConfig = { ...marketConfig, ...req.body }; saveMarketConfig(); res.json({ success: true }); });

// ─── F.R.I.D.A.Y Community Bug Tracker Endpoints ────────────────────────────
app.get('/api/bugs', (req, res) => {
    res.json({ success: true, bugs: bugManager.getAllBugs() });
});

app.post('/api/bugs', (req, res) => {
    const description = (req.body.description || '').trim();
    if (!description) {
        return res.status(400).json({ success: false, error: 'Description is required' });
    }
    const newBug = bugManager.createBug({
        description,
        category: req.body.category,
        reporterName: req.body.reporterName,
        discordId: req.body.discordId,
        discordTag: req.body.discordTag,
        tornId: req.body.tornId,
        tornName: req.body.tornName
    });
    res.json({ success: true, bug: newBug });
});

app.post('/api/bugs/:id/status', (req, res) => {
    const bugId = String(req.params.id || '').trim();
    const bug = bugManager.updateBugStatus(bugId, req.body.status, req.body.resolutionNotes);
    if (!bug) return res.status(404).json({ success: false, error: 'Bug report not found' });
    res.json({ success: true, bug });
});

app.delete('/api/bugs/:id', (req, res) => {
    const bugId = String(req.params.id || '').trim();
    const success = bugManager.deleteBug(bugId);
    if (!success) return res.status(404).json({ success: false, error: 'Bug report not found' });
    res.json({ success: true });
});

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
    
    const t = String(type || '').toLowerCase().trim();
    if (t === 'travel') {
        embed = {
            title: "✈️ Overseas Alert",
            description: `**[Your Name]** — an enemy (**[Test] EnemyName**) is flying to **Mexico** where you are located.\n\nReturn to Torn or fly to a different destination.`,
            color: UI.COLORS.WARNING,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString(),
            links: [
                { label: "✈️ Travel Agency", url: `https://www.torn.com/travelagency.php` },
                { label: "🌐 Travel Desk", url: `https://torn-company-app-production.up.railway.app/travel.html` }
            ]
        };
    } else if (t === 'chain') {
        embed = {
            title: "⚔️ Member Under Attack",
            description: `**[Your Name]**, you've been hit **3 times in a row** without defending. Log in to Torn and respond.`,
            color: UI.COLORS.ERROR,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString(),
            links: [
                { label: "🔗 View Chain", url: `https://www.torn.com/factions.php?step=your#/tab=chains` },
                { label: "📡 Live Warboard", url: `https://torn-company-app-production.up.railway.app/` }
            ]
        };
    } else if (t === 'chainunder90') {
        embed = {
            title: "⏱️ Chain Alert: Under 90 Seconds!",
            description: "⚠️ **The active chain timer is at 82s!** Land a hit immediately to preserve the faction chain multiplier.",
            color: UI.COLORS.ERROR,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString(),
            links: [
                { label: "🔗 View Chain", url: "https://www.torn.com/factions.php?step=your#/tab=chains" },
                { label: "🎯 Attack Targets", url: "https://torn-company-app-production.up.railway.app/" }
            ]
        };
    } else if (t === 'chainmilestone') {
        embed = {
            title: "🏆 Chain Milestone: 100 Hits!",
            description: "Hit **#100** landed by **[Test Player]** · **+10.00 Respect** bonus gained for the faction!",
            color: UI.COLORS.WARNING,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString(),
            links: [{ label: "🔗 View Chain", url: "https://www.torn.com/factions.php?step=your#/tab=chains" }]
        };
    } else if (t === 'target' || t === 'sniper' || t === 'targetlanded' || t === 'targetonline' || t === 'targetouthosp' || t === 'medoutsniper') {
        let title = "✈️ Target Returned from Abroad";
        let desc = "**[Test Enemy]** [999999] has landed back in Torn and is now attackable.";
        if (t === 'targetonline') {
            title = "🟢 Enemy Target Online";
            desc = "**[Test Enemy]** [999999] is now **Online in Torn** and ready for combat engagement.";
        } else if (t === 'targetouthosp') {
            title = "🏥 Target Out of Hospital";
            desc = "**[Test Enemy]** [999999] hospital timer has expired naturally — now **Okay** and attackable.";
        } else if (t === 'sniper' || t === 'medoutsniper') {
            title = "💊 Early Hospital Escape (Med-Out)";
            desc = "**[Test Enemy]** [999999] left hospital early using meds or a revive and is currently online.";
        }
        embed = {
            title,
            description: desc,
            color: UI.COLORS.SUCCESS,
            targetId: "999999",
            fields: [
                { name: "Est. Battle Stats", value: "~15,400,000", inline: true },
                { name: "Current Status", value: "Online in Torn", inline: true },
                { name: "Suggested Fighter", value: "You — matched by stats", inline: false }
            ],
            links: [
                { label: "⚔️ Attack", url: `https://www.torn.com/page.php?sid=attack&user2ID=999999` },
                { label: "👤 Profile", url: `https://www.torn.com/profiles.php?XID=999999` }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t.includes('retal') || t.includes('realitor') || t === 'friendlyattacked' || t === 'friendly_attacked') {
        chanId = req.body.retalChannelId || discordConfig.retalChannelId || chanId;
        const roleId = req.body.retalRoleId || discordConfig.retalRoleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else if (roleId === '@here' || roleId === '@everyone') pingStr = roleId;
        }
        embed = {
            title: "🚨 Faction Member Attacked • Retaliation Alert",
            description: "**[Friendly Member]** [100001] was attacked by **[Hostile Enemy]** [999999] from `Enemy Syndicate`.",
            color: UI.COLORS.ERROR,
            targetId: "999999",
            fields: [
                { name: "Result", value: "Hospitalized", inline: true },
                { name: "Attacker Est. Stats", value: "~820k (FF: 3.63) [FF Scouter]", inline: true },
                { name: "🛡️ Retaliation Probability", value: "**67%** `▓▓▓▓▓▓▓░░░`", inline: true },
                { name: "🎯 Risk Confidence", value: "🟢 14 direct observations", inline: true },
                { name: "⏱️ Response Window", value: "⚡ Fast (<10m, avg ~3m 42s)", inline: true },
                { name: "⚔️ Retal Win/Loss", value: "0.35:1 (Favors us)", inline: true },
                {
                    name: "⚠️ Likely Retaliators",
                    value: "🔴 [Player 123456](https://www.torn.com/profiles.php?XID=123456) — 8 confirmed retals\n🟡 [Player 789012](https://www.torn.com/profiles.php?XID=789012) — 4 confirmed retals",
                    inline: false
                }
            ],
            links: [
                { label: "⚔️ Retaliate / Attack", url: "https://www.torn.com/page.php?sid=attack&user2ID=999999" },
                { label: "👤 Attacker Profile", url: "https://www.torn.com/profiles.php?XID=999999" },
                { label: "🛡️ Defender Profile", url: "https://www.torn.com/profiles.php?XID=100001" }
            ],
            footer: { text: "F.R.I.D.A.Y Retaliation Risk Engine • Empirical Bayes k=7 • λ=0.05" },
            timestamp: new Date().toISOString()
        };
    } else if (t === 'inactivity') {
        chanId = req.body.inactivityChannelId || discordConfig.inactivityChannelId || chanId;
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
            description: `**[Test Member]** [1234567] has been offline for **24 hours** with no actions recorded.`,
            color: UI.COLORS.WARNING,
            fields: [
                { name: "⏱️ Inactive Duration", value: "**24 hours**", inline: true },
                { name: "🕒 Last Action", value: "Yesterday (24h ago)", inline: true },
                { name: "📊 Current Status", value: "Offline", inline: true },
                { name: "🎯 Role Mentioned", value: rolePingStr ? `Pinging ${rolePingStr}` : "None configured", inline: true }
            ],
            links: [
                { label: "👤 View Profile", url: "https://www.torn.com/profiles.php?XID=1234567" },
                { label: "💬 Send Message", url: "https://www.torn.com/messages.php#/p=compose&XID=1234567" }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
        pingStr = rolePingStr;
    } else if (t === 'overdose') {
        chanId = req.body.overdoseChannelId || discordConfig.overdoseChannelId || chanId;
        let rolePingStr = "";
        const roleInput = req.body.overdoseRoleId || discordConfig.overdoseRoleId;
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
        const pName = "TestAgent";
        const pId = "100001";
        const profileUrl = `https://www.torn.com/profiles.php?XID=${pId}`;
        const msgUrl = `https://www.torn.com/messages.php#/p=compose&XID=${pId}`;
        const nowSec = Math.floor(Date.now() / 1000);
        const freeSec = nowSec + (24 * 3600);

        embed = {
            title: `💊 Member Overdosed: ${pName} [TEST]`,
            description: `**[${pName}](${profileUrl})** [${pId}] has overdosed on drugs and is currently in the hospital!\n\n` +
                         `🚑 **Needs a revive or medical attention.**`,
            color: UI.COLORS.ERROR,
            fields: [
                { name: "🏥 Hospital Status", value: "In hospital for 24 hrs with an overdose.", inline: true },
                { name: "⏱️ Time Left", value: `Free <t:${freeSec}:R> (<t:${freeSec}:t>)`, inline: true },
                { name: "🎖️ Faction Position", value: "Co-Leader (Lvl 58)", inline: true },
                { name: "🕒 Last Action", value: "Just now (Online)", inline: true },
                { name: "🎯 Role Mentioned", value: rolePingStr ? `Pinging ${rolePingStr}` : "None configured", inline: true }
            ],
            links: [
                { label: "🚑 Revive on Torn", url: profileUrl },
                { label: "👤 View Profile", url: profileUrl },
                { label: "💬 Send Message", url: msgUrl }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
        pingStr = rolePingStr;
    } else if (t === 'oc_low_cpr') {
        chanId = req.body.ocChannelId || ocConfig.globalChannelId || chanId;
        const roleId = req.body.ocRoleId || ocConfig.roleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else pingStr = roleId;
        }
        embed = {
            title: "⚠️ Low CPR in OC: Robbing of a Money Train [TEST]",
            description: `**[TestAgent](https://www.torn.com/profiles.php?XID=100001)** [100001] joined role **Hacker** in **Robbing of a Money Train** (Difficulty Level **5**), but only has **30% CPR**.\n\n` +
                         `🎯 **Faction Minimum:** **65%** for Level 5\n` +
                         `⚠️ This significantly lowers the team's chance of completing the crime.\n\n` +
                         `👉 [Review Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
            color: UI.COLORS.ERROR,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t === 'oc_no_participation') {
        chanId = req.body.ocChannelId || ocConfig.globalChannelId || chanId;
        const roleId = req.body.ocRoleId || ocConfig.roleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else pingStr = roleId;
        }
        embed = {
            title: "⏳ Member Missing from OC: TestAgent [TEST]",
            description: `**[TestAgent](https://www.torn.com/profiles.php?XID=100001)** [100001] has not been assigned to an Organized Crime for **1.2 days (29 hours)**.\n\n` +
                         `🎖️ **Position:** Co-Leader (Lvl 58)\n` +
                         `📊 **Status:** Online\n` +
                         `🕒 **Last Action:** 15 mins ago\n\n` +
                         `👉 [Assign to an OC on Torn](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
            color: UI.COLORS.WARNING,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t === 'oc_missing_item') {
        chanId = req.body.ocChannelId || ocConfig.globalChannelId || chanId;
        const roleId = req.body.ocRoleId || ocConfig.roleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else pingStr = roleId;
        }
        const pName = "TestAgent";
        const pId = "100001";
        const itemName = "C4 Explosive";
        const armoryUrl = `https://www.torn.com/factions.php?step=your&type=1&autoItem=${encodeURIComponent(itemName)}&autoUser=${encodeURIComponent(pName)}&autoUserId=${pId}&autoAction=loan#/tab=armoury&start=0&sub=utilities`;
        const profileUrl = `https://www.torn.com/profiles.php?XID=${pId}`;
        embed = {
            title: "🚨 OC Issue: Bidding War",
            description: `**Player:** [${pName}](${profileUrl})\n` +
                         `**Role:** Bomber #1\n` +
                         `**Item Needed:** ${itemName}\n` +
                         `**Armory:** [Give / Loan on Torn](${armoryUrl})`,
            color: UI.COLORS.ERROR,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t === 'oc_ready') {
        chanId = req.body.ocChannelId || ocConfig.globalChannelId || chanId;
        const roleId = req.body.ocRoleId || ocConfig.roleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else pingStr = roleId;
        }
        embed = {
            title: "🟢 OC Ready to Launch: Robbing of a Money Train [TEST]",
            description: `All team members are in Torn City and ready! Crime can now be initiated by the planner.\n\n` +
                         `**Team:**\n` +
                         `• [TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)\n` +
                         `• [MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)\n\n` +
                         `👉 [Initiate Organized Crime](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
            color: UI.COLORS.SUCCESS,
            buttons: [
                {
                    type: 2,
                    style: 5,
                    label: "🚀 Launch Organized Crime",
                    url: "https://www.torn.com/factions.php?step=your#/tab=crimes"
                }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t === 'oc_delayed') {
        chanId = req.body.ocChannelId || ocConfig.globalChannelId || chanId;
        const roleId = req.body.ocRoleId || ocConfig.roleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else pingStr = roleId;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        embed = {
            title: "🚨 OC Delayed: Kidnapping [TEST]",
            description: `Countdown reached zero, but **team cannot launch** because participant(s) are unavailable:\n\n` +
                         `• ❌ **[TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)**: **Hospitalized** (in hospital · Free <t:${nowSec + 450}:R>)\n\n` +
                         `Team members must med out, bust, or land before the crime can be initiated.\n\n` +
                         `👉 [Open Faction Crimes Tab](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
            color: UI.COLORS.ERROR,
            buttons: [
                {
                    type: 2,
                    style: 5,
                    label: "🏥 Open Faction Crimes",
                    url: "https://www.torn.com/factions.php?step=your#/tab=crimes"
                }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t === 'oc_upcoming') {
        chanId = req.body.ocChannelId || ocConfig.globalChannelId || chanId;
        const roleId = req.body.ocRoleId || ocConfig.roleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else pingStr = roleId;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        embed = {
            title: "⏳ OC Upcoming: Bomb Threat [TEST]",
            description: `Crime is scheduled to be ready in **<t:${nowSec + 1800}:R>** (<t:${nowSec + 1800}:t>)!\n\n` +
                         `⚠️ **Attention Team Members:** Please stay out of hospital and wrap up foreign travel:\n` +
                         `• [TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)\n` +
                         `• [MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)\n\n` +
                         `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
            color: UI.COLORS.WARNING,
            buttons: [
                {
                    type: 2,
                    style: 5,
                    label: "⏳ View Crimes Tab",
                    url: "https://www.torn.com/factions.php?step=your#/tab=crimes"
                }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t === 'oc_countdown_4h') {
        chanId = req.body.ocChannelId || ocConfig.globalChannelId || chanId;
        const roleId = req.body.ocRoleId || ocConfig.roleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else pingStr = roleId;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        embed = {
            title: "⏰ OC 4-Hour Countdown: Planned Robbery [TEST]",
            description: `The Organized Crime **Planned Robbery** is scheduled to become ready in **~4 hours**!\n\n` +
                         `🎯 **Ready Time:** <t:${nowSec + 14400}:F> (<t:${nowSec + 14400}:R>)\n\n` +
                         `⚠️ **Attention Team Members:**\n` +
                         `• **Stay in Torn City:** Avoid international flights that will not return in time.\n` +
                         `• **Stay Out of Hospital / Jail:** Avoid risky attacks and bust teammates out if needed.\n` +
                         `• **Equipment Check:** Ensure any necessary OC items are equipped or borrowed from the armory.\n\n` +
                         `**Assigned Roster:**\n` +
                         `• **[TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)** — 🟢 Available in Torn City\n` +
                         `• **[MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)** — 🟢 Available in Torn City\n\n` +
                         `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
            color: UI.COLORS.INFO,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t === 'oc_countdown_2h') {
        chanId = req.body.ocChannelId || ocConfig.globalChannelId || chanId;
        const roleId = req.body.ocRoleId || ocConfig.roleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else pingStr = roleId;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        embed = {
            title: "🚨 OC 2-Hour Urgent Alert: Planned Robbery [TEST]",
            description: `Organized Crime **Planned Robbery** launches in **~2 hours**!\n\n` +
                         `🎯 **Ready Time:** <t:${nowSec + 7200}:F> (<t:${nowSec + 7200}:R>)\n\n` +
                         `🚨 **CRITICAL INSTRUCTIONS FOR PARTICIPANTS:**\n` +
                         `• **DO NOT FLY:** Most flights take over 2 hours round trip. Stay in Torn City!\n` +
                         `• **STAY OUT OF HOSPITAL:** Avoid initiating fights or taking unnecessary damage.\n` +
                         `• **BE ACTIVE AT LAUNCH:** The crime will be initiated the moment the timer hits zero.\n\n` +
                         `**Assigned Roster:**\n` +
                         `• **[TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)** — 🟢 Available in Torn City\n` +
                         `• **[MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)** — 🟢 Available in Torn City\n\n` +
                         `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
            color: UI.COLORS.WARNING,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t === 'oc_planned') {
        chanId = req.body.ocChannelId || ocConfig.globalChannelId || chanId;
        const roleId = req.body.ocRoleId || ocConfig.roleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else pingStr = roleId;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        embed = {
            title: "📋 OC Scheduled: Planned Robbery [TEST]",
            description: `A new Organized Crime has been scheduled for **Spider-Verse**!\n\n` +
                         `**Target Ready Time:** <t:${nowSec + 86400}:F> (<t:${nowSec + 86400}:R>)\n` +
                         `**Planned By:** [TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)\n\n` +
                         `**Assigned Roster:**\n` +
                         `• [TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)\n` +
                         `• [MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)\n\n` +
                         `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
            color: UI.COLORS.INFO,
            buttons: [
                {
                    type: 2,
                    style: 5,
                    label: "📋 View Crimes Tab",
                    url: "https://www.torn.com/factions.php?step=your#/tab=crimes"
                }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t === 'oc_completed') {
        chanId = req.body.ocChannelId || ocConfig.globalChannelId || chanId;
        const roleId = req.body.ocRoleId || ocConfig.roleId;
        if (roleId && String(roleId).trim()) {
            const numOnly = String(roleId).replace(/\D/g, '');
            if (numOnly.length >= 15 && numOnly.length <= 22) pingStr = `<@&${numOnly}>`;
            else pingStr = roleId;
        }
        embed = {
            title: "🎉 OC Success: Robbing of a Money Train [TEST]!",
            description: `The team successfully executed **Robbing of a Money Train**!\n\n` +
                         `💰 **Payout:** +$14,250,000 deposited into faction vault\n` +
                         `🏆 **Respect:** +112 Faction Respect\n\n` +
                         `**Team:**\n` +
                         `• [TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)\n` +
                         `• [MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)`,
            color: UI.COLORS.SUCCESS,
            buttons: [
                {
                    type: 2,
                    style: 5,
                    label: "🏦 Open Faction Vault",
                    url: "https://www.torn.com/factions.php?step=your#/tab=armory"
                }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } else if (t === 'welcome_rules') {
        chanId = req.body.welcomeChannelId || discordConfig.welcomeChannelId || chanId;
        embed = buildWelcomeRulesEmbed(discordId || null);
    } else {
        return res.json({ success: false, error: "Unknown test type." });
    }

    let result = await executeDiscordSend(botToken, chanId, embed, pingStr);
    console.log(`[Discord Test] Result:`, result);
    if (!result.success) return res.json({ success: false, error: result.error });
    
    res.json({ success: true, warning: result.warning || null });
});

app.post('/api/discord/post-rules', async (req, res) => {
    try {
        const chanId = (req.body.channelId || discordConfig.welcomeChannelId || '').replace(/[^0-9]/g, '');
        if (!chanId) {
            return res.status(400).json({ success: false, error: "Please specify or save a Welcome & Rules Channel ID first." });
        }
        const client = getAnyActiveDiscordClient();
        const botToken = discordConfig.globalBotToken;
        const embed = buildWelcomeRulesEmbed(null);

        if (client) {
            try {
                const channel = client.channels.cache.get(chanId) || (await client.channels.fetch(chanId).catch(() => null));
                if (channel && channel.isTextBased()) {
                    const sent = await channel.send({ embeds: [sanitizeEmbed(embed)] });
                    return res.json({ success: true, messageId: sent.id, message: "Rules card posted successfully!" });
                }
            } catch(clientErr) {
                console.warn('[Post Rules] Client channel.send failed, falling back to REST queue:', clientErr.message);
            }
        }

        // REST queue fallback
        if (botToken && botToken.length > 20) {
            const result = await sendChannelMessage(botToken, chanId, embed, "📢 **Official Faction & Server Directives**", true);
            return res.json({ success: result.success, error: result.error, message: result.success ? "Rules card dispatched!" : undefined });
        }

        return res.status(400).json({ success: false, error: "Discord bot is not connected. Enter your Bot Token and click Save first." });
    } catch(e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/test-oc-manager-dm', async (req, res) => {
    try {
        const managerIds = await getOcManagerDiscordUserIds();
        if (!managerIds || managerIds.length === 0) {
            return res.json({
                success: false,
                error: "No OC Managers found. Configure an OC Manager Role or add Manager User IDs in the OC settings."
            });
        }

        const testEmbed = {
            title: "🚨 [TEST] OC Manager Alert: Robbing of a Money Train",
            description: `This is a test notification verifying your OC Manager direct message alerts.\n\n` +
                         `When a faction member joins an Organized Crime with CPR below the required threshold, you will receive a direct message like this one immediately.\n\n` +
                         `👉 [Review Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
            color: UI.COLORS.WARNING,
            fields: [
                { name: "Test Player", value: "**[AgentSpider](https://www.torn.com/profiles.php?XID=100001)** [100001]", inline: true },
                { name: "Crime / Slot", value: "Robbing of a Money Train (Hacker)", inline: true },
                { name: "CPR vs Requirement", value: "⚠️ **30% CPR** (Min: **40%**)", inline: true }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };

        let sentCount = 0;
        let errors = [];
        for (const uId of managerIds) {
            const result = await sendDirectMessageToUser(uId, testEmbed);
            if (result.success) {
                sentCount++;
            } else {
                errors.push(`<@${uId}>: ${result.error || 'Failed'}`);
            }
        }

        if (sentCount > 0) {
            return res.json({
                success: true,
                sentCount,
                total: managerIds.length,
                message: `Successfully dispatched test DM to ${sentCount} OC manager(s)!`
            });
        } else {
            return res.json({
                success: false,
                error: `Failed to DM managers (${errors.join(', ')}). Ensure managers allow direct messages in Discord server privacy settings.`
            });
        }
    } catch(e) {
        return res.status(500).json({ success: false, error: e.message });
    }
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
const warListCache = {};

app.get('/api/war-list', async (req, res) => {
    const userKey = req.headers['x-api-key'] || req.query.apiKey;
    try {
        if (!userKey || userKey === "null" || userKey.trim() === "") return res.status(401).json({ error: "Missing API key" });
        const userInfo = await getUserFactionInfo(userKey);
        let targetFacId = (req.query.factionId || req.headers['x-faction-id'])
            || userInfo?.facId
            || discordConfig.factionId
            || "52355";

        const cacheKey = String(targetFacId);
        if (!req.query.force && warListCache[cacheKey] && (Date.now() - warListCache[cacheKey].timestamp) < 15000) {
            return res.json(warListCache[cacheKey].data);
        }

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
        const resultPayload = { success: true, wars };
        warListCache[cacheKey] = { timestamp: Date.now(), data: resultPayload };
        res.json(resultPayload);
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

const dashboardDataCache = {};

app.get('/api/dashboard-data', async (req, res) => {
    const userKey = req.userTornKey || req.headers['x-api-key'] || req.query.apiKey;
    if (!userKey || userKey === 'null' || userKey.trim() === '') {
        return res.status(401).json({ error: "Authentication required" });
    }
    const ffKey = (req.headers['x-ff-key'] || req.query.ffKey) || null;
    try {
        await verifySubscription(userKey);
        const isPremium = (ffKey && ffKey !== "null" && ffKey.trim().length > 10);

        const userInfo = await getUserFactionInfo(userKey);
        let targetFacId = (req.query.factionId || req.headers['x-faction-id'])
            || req.userSession?.factionId
            || userInfo?.facId;

        // If user is explicitly factionless, return clean factionless payload
        if (targetFacId === '0' || targetFacId === 0 || targetFacId === 'None') {
            return res.json({
                success: true,
                isFactionless: true,
                members: {},
                loans: [],
                armoryError: false,
                premiumActive: isPremium,
                chain: null,
                activeWar: null,
                faction: { ID: 0, name: "Factionless", tag: "", respect: 0, members: 0 }
            });
        }

        if (!targetFacId) {
            targetFacId = discordConfig.factionId || "52355";
        }

        const cacheKey = `${targetFacId}_${isPremium ? 'prem' : 'free'}`;
        if (!req.query.force && dashboardDataCache[cacheKey] && (Date.now() - dashboardDataCache[cacheKey].timestamp) < 15000) {
            return res.json(dashboardDataCache[cacheKey].data);
        }

        // Fetch basic, armory, and chain/rankedwars in parallel for maximum speed
        const [basicResp, armoryResp, chainResp] = await Promise.all([
            fetch(`https://api.torn.com/faction/${targetFacId}?selections=basic&key=${userKey}`).catch(e => null),
            fetch(`https://api.torn.com/faction/?selections=armor,weapons,temporary&key=${userKey}`).catch(e => null),
            fetch(`https://api.torn.com/faction/?selections=chain,rankedwars&key=${userKey}`).catch(e => null)
        ]);

        let basicData = basicResp ? await basicResp.json().catch(() => ({})) : {};
        if (basicData.error && basicData.error.code === 6) {
            const retryResp = await fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`).catch(e => null);
            if (retryResp) basicData = await retryResp.json().catch(() => ({}));
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
        const armoryData = armoryResp ? await armoryResp.json().catch(() => ({ error: true })) : { error: true };

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

        // Parse chain and ranked war data
        let chain = null;
        let activeWar = null;
        try {
            const chainData = chainResp ? await chainResp.json().catch(() => ({})) : {};
            if (chainData && !chainData.error) {
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

        const resultPayload = { success: true, members: parsedMembers, loans, armoryError, premiumActive: isPremium, chain, activeWar, faction };
        dashboardDataCache[cacheKey] = { timestamp: Date.now(), data: resultPayload };
        res.json(resultPayload);
    } catch (err) { res.status(403).json({ error: err.message }); }
});

const companyApiCache = {};

app.get('/api/company', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    try {
        await verifySubscription(apiKey);
        const cacheKey = String(apiKey || 'default');
        if (!req.query.force && companyApiCache[cacheKey] && (Date.now() - companyApiCache[cacheKey].timestamp) < 20000) {
            return res.json(companyApiCache[cacheKey].data);
        }

        const resp = await fetch(`https://api.torn.com/company/?selections=profile,detailed,employees,stock&key=${apiKey}`);
        const data = await resp.json();
        
        if (data.error) {
            return res.status(400).json({ error: "Torn API Error: " + data.error.error });
        }
        
        const resultPayload = { success: true, company: data };
        companyApiCache[cacheKey] = { timestamp: Date.now(), data: resultPayload };
        res.json(resultPayload);
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
    const { playerName, score, attacks, efficiency, playtime, xanax, level, status, estStats, enemyFaction, recruiterName, recruiterId } = req.body;
    const sender = recruiterName || req.userSession?.playerName || "Faction Recruiter";
    const senderTag = (recruiterId || req.userSession?.playerId) ? ` [${recruiterId || req.userSession?.playerId}]` : '';
    const signOff = `${sender}${senderTag}`;
    const factionless = status && status.toLowerCase().includes("factionless");
    const fallback = `Hey ${playerName}!\n\nI was looking at your stats and noticed your solid progression.\n\n${factionless ? "I noticed you're currently factionless, so the timing seems perfect." : "I know you're currently in a faction, but I wanted to reach out anyway."}\n\nWe run a tight, active crew focused on ranked wars and organized crimes. We'd love to have someone with your stats on our side. If you're ever looking for a change, hit me back — happy to chat.\n\n${signOff}`;

    if (!GEMINI_API_KEY) return res.json({ message: fallback, source: "template" });

    try {
        const prompt = `You are writing a Torn City (browser game) faction recruitment message. Keep it short (3-4 paragraphs max), casual, direct and personalized. Do NOT use generic filler like "I hope this message finds you well". Sound like a real player, not a robot.\n\nPlayer: ${playerName}\nLevel: ${level || 'Unknown'}\nPlaytime: ${playtime ? playtime + ' days' : 'Unknown'}\nXanax taken: ${xanax || 'Unknown'}\nWar stats: ${score && score !== "N/A" ? score + " score, " + attacks + " hits" : "N/A"}\nEst. Battle Stats: ${estStats || "Unknown"}\nCurrent faction status: ${status}\nEnemy faction they fought for (if any): ${enemyFaction || "None"}\n\nWrite a compelling recruitment message. If they have high war stats, mention them. If they have low playtime but high level/xanax, praise their fast progression. ${factionless ? "They are now factionless — emphasize this is a perfect time." : "Be respectful that they are still in a faction."} Sign off from ${signOff}.`;

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
    const facId = String(req.query.factionId || req.headers['x-faction-id'] || req.userSession?.factionId || (req.userSession?.isSpiderVerse ? '52355' : ''));
    if (!facId) return res.status(400).json({ error: "Faction ID required" });
    const state = getFactionWarState(facId);

    const rawData = JSON.stringify({ c: state.claims, b: state.backups, s: state.manualStats });
    const hash = crypto.createHash('md5').update(rawData).digest('hex');
    const etag = `W/"${hash}"`;

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
    }
    res.json({ success: true, claims: state.claims, backups: state.backups, manualStats: state.manualStats });
});
app.post('/api/claim', (req, res) => {
    const { enemyId, playerName, factionId } = req.body;
    const facId = String(factionId || req.headers['x-faction-id'] || req.userSession?.factionId || (req.userSession?.isSpiderVerse ? '52355' : ''));
    if (!facId) return res.status(400).json({ error: "Faction ID required" });
    const state = getFactionWarState(facId);
    state.claims[enemyId] = { playerName: playerName || req.userSession?.playerName || "Agent", time: Date.now() };
    res.json({ success: true });
});
app.post('/api/unclaim', (req, res) => {
    const { enemyId, playerName, factionId } = req.body;
    const facId = String(factionId || req.headers['x-faction-id'] || req.userSession?.factionId || (req.userSession?.isSpiderVerse ? '52355' : ''));
    if (!facId) return res.status(400).json({ error: "Faction ID required" });
    const state = getFactionWarState(facId);
    const claimingUser = playerName || req.userSession?.playerName;
    if (!claimingUser || state.claims[enemyId]?.playerName === claimingUser) delete state.claims[enemyId];
    res.json({ success: true });
});
app.post('/api/backup', (req, res) => {
    const { enemyId, playerName, factionId } = req.body;
    const facId = String(factionId || req.headers['x-faction-id'] || req.userSession?.factionId || (req.userSession?.isSpiderVerse ? '52355' : ''));
    if (!facId) return res.status(400).json({ error: "Faction ID required" });
    const state = getFactionWarState(facId);
    state.backups[enemyId] = { playerName: playerName || req.userSession?.playerName || "Agent", time: Date.now() };
    res.json({ success: true });
});
app.post('/api/unbackup', (req, res) => {
    const { enemyId, factionId } = req.body;
    const facId = String(factionId || req.headers['x-faction-id'] || req.userSession?.factionId || (req.userSession?.isSpiderVerse ? '52355' : ''));
    if (!facId) return res.status(400).json({ error: "Faction ID required" });
    const state = getFactionWarState(facId);
    delete state.backups[enemyId];
    res.json({ success: true });
});
app.post('/api/update-stats', (req, res) => {
    const { enemyId, stats, factionId } = req.body;
    const facId = String(factionId || req.headers['x-faction-id'] || req.userSession?.factionId || (req.userSession?.isSpiderVerse ? '52355' : ''));
    if (!facId) return res.status(400).json({ error: "Faction ID required" });
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

function sendWarboardResponse(req, res, payload) {
    try {
        const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const hash = crypto.createHash('md5').update(jsonStr).digest('hex');
        const etag = `W/"${hash}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'no-cache');
        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }
        return res.type('application/json').send(jsonStr);
    } catch(e) {
        return res.json(payload);
    }
}

app.get('/api/warboard', async (req, res) => {
    if (global.isTurboMining) return res.json({ error: "Turbo Mining Mode is active. Live Warboard is paused." });
    try {
        const userKey = req.userTornKey || req.headers['x-api-key'] || req.query.apiKey;
        if (!userKey || userKey === "null" || userKey.trim() === "") {
            return res.status(401).json({ error: "Please authenticate to view your faction warboard." });
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
        if (!myData || myData.error) {
            myData = await cachedTornFetch(`https://api.torn.com/faction/?selections=basic,rankedwars,attacks&key=${userKey}`, `my_faction_personal_${userKey}`, 2500);
            if (myData && myData.ID) {
                targetMyFacId = myData.ID.toString();
            }
        }

        // Step 3: If personal /faction/ returned error 6 (caller is factionless),
        // cleanly inform them rather than leaking Spider-Verse
        if (!myData || (myData.error && myData.error.code === 6)) {
            return res.json({
                success: false,
                isFactionless: true,
                error: "You are not currently in a faction. Live Warboard is active during faction wars.",
                friendly: [],
                enemy: [],
                warInfo: null
            });
        }

        const myFacId = myData?.ID ? myData.ID.toString() : (targetMyFacId || (req.userSession?.isSpiderVerse ? "52355" : null));
        if (!myFacId) {
            return res.json({
                success: false,
                error: "Unable to determine faction. Live Warboard is active during faction wars.",
                friendly: [],
                enemy: [],
                warInfo: null
            });
        }
        const fState = getFactionWarState(myFacId);

        // Resilience: If myData hit rate limit or transient error, serve last known good payload for THIS faction ONLY
        if (!myData || myData.error || !myData.members || Object.keys(myData.members).length === 0) {
            if (lastGoodWarboardByFaction[myFacId]) {
                return res.json(lastGoodWarboardByFaction[myFacId]);
            } else if (lastGoodWarboardPayload && String(myFacId) === "52355" && (req.userSession?.isSpiderVerse || !req.userSession)) {
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
            enemyDataResult = await cachedTornFetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey || getNextApiKey()}`, `enemy_faction_${enemyId}`, 2500); 
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
                return sendWarboardResponse(req, res, lastGoodWarboardByFaction[myFacId]);
            }
            if (lastGoodWarboardPayload && String(myFacId) === "52355") {
                return sendWarboardResponse(req, res, lastGoodWarboardPayload);
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

        sendWarboardResponse(req, res, payload);
    } catch (err) {
        if (targetMyFacId && lastGoodWarboardByFaction[targetMyFacId]) {
            return sendWarboardResponse(req, res, lastGoodWarboardByFaction[targetMyFacId]);
        }
        if (lastGoodWarboardPayload) {
            return sendWarboardResponse(req, res, lastGoodWarboardPayload);
        }
        res.status(403).json({ error: err.message });
    }
});
// ── Universal Torn Web Session & Authentication Engine ─────────────────────

// POST /api/auth/connect — Authenticate any Torn API key, encrypt it in the server vault, and issue a session token
app.post('/api/auth/connect', async (req, res) => {
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
        const isSpiderVerse = userFacId === '52355';

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

// GET /api/auth/me — Check current authenticated session
app.get('/api/auth/me', (req, res) => {
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

// POST /api/auth/logout — Invalidate current session
app.post('/api/auth/logout', async (req, res) => {
    const token = sessionManager.extractTokenFromRequest(req);
    if (token) {
        await sessionManager.deleteSession(token);
    }
    return res.json({ success: true });
});

// Backwards-compatible /api/auth/verify-faction-access
app.post('/api/auth/verify-faction-access', async (req, res) => {
    try {
        const apiKey = String(req.body.apiKey || '').trim();
        if (!apiKey) return res.status(400).json({ success: false, authorized: false, reason: "Torn API Key is required." });

        const targetFactionId = String(discordConfig.factionId || adminFactionId || '52355');

        const tornRes = await fetch(`https://api.torn.com/user/?selections=profile,bars&key=${apiKey}&timestamp=${Date.now()}`, {
            signal: AbortSignal.timeout(9000)
        });
        const data = await tornRes.json();

        if (data.error) {
            return res.status(400).json({ success: false, authorized: false, reason: data.error.error || "Invalid Torn API key." });
        }

        const userFacId = String(data.faction?.faction_id || '0');
        const userFacName = data.faction?.faction_name || 'None';
        const isMember = userFacId === targetFactionId;

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

        return res.json({
            success: true,
            authorized: isMember,
            sessionToken: session.token,
            isSpiderVerse: isMember,
            reason: isMember ? undefined : `You are currently in "${userFacName}" [ID: ${userFacId}]. Only active members of Spider-Verse [${targetFactionId}] are authorized for Spider-Verse specific tools.`,
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
        dmPlayerOnLowCpr: ocConfig.dmPlayerOnLowCpr !== false,
        alertPlanned: ocConfig.alertPlanned !== false,
        alertCountdown4h: ocConfig.alertCountdown4h !== false,
        alertCountdown2h: ocConfig.alertCountdown2h !== false,
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
        dmPlayerOnLowCpr,
        alertPlanned, 
        alertCountdown4h,
        alertCountdown2h,
        alertUpcoming, 
        upcomingMinutes, 
        alertReady, 
        alertDelayed, 
        alertCompleted 
    } = req.body;

    if (globalChannelId !== undefined) ocConfig.globalChannelId = String(globalChannelId).trim();
    if (roleId !== undefined) ocConfig.roleId = String(roleId).trim();
    if (dmPlayerOnLowCpr !== undefined) ocConfig.dmPlayerOnLowCpr = !!dmPlayerOnLowCpr;
    if (alertPlanned !== undefined) ocConfig.alertPlanned = !!alertPlanned;
    if (alertCountdown4h !== undefined) ocConfig.alertCountdown4h = !!alertCountdown4h;
    if (alertCountdown2h !== undefined) ocConfig.alertCountdown2h = !!alertCountdown2h;
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
                             `• [TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)\n` +
                             `• [MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)\n\n` +
                             `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                color: UI.COLORS.WARNING,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
            };
        } else if (type === 'delayed') {
            embed = {
                title: "🚨 OC Delayed: Kidnapping [TEST]",
                description: `Countdown reached zero, but **team cannot launch** because participant(s) are unavailable:\n\n` +
                             `• ❌ **[TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)**: **Hospitalized** (in hospital · Free <t:${now + 450}:R>)\n\n` +
                             `Team members must med out, bust, or land before the crime can be initiated.\n\n` +
                             `👉 [Open Faction Crimes Tab](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                color: UI.COLORS.ERROR,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
            };
        } else if (type === 'planned') {
            embed = {
                title: "📋 OC Scheduled: Planned Robbery [TEST]",
                description: `A new Organized Crime has been scheduled for **Spider-Verse**!\n\n` +
                             `**Target Ready Time:** <t:${now + 86400}:F> (<t:${now + 86400}:R>)\n` +
                             `**Planned By:** [TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)\n\n` +
                             `**Assigned Roster:**\n` +
                             `• [TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)\n` +
                             `• [MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)\n\n` +
                             `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                color: UI.COLORS.INFO,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
            };
        } else {
            embed = {
                title: "🟢 OC Ready to Launch: Robbing of a Money Train [TEST]",
                description: `All team members are in Torn City and ready! Crime can now be initiated by the planner.\n\n` +
                             `**Team:**\n` +
                             `• [TestAgent [100001]](https://www.torn.com/profiles.php?XID=100001)\n` +
                             `• [MF_Pikle [3419413]](https://www.torn.com/profiles.php?XID=3419413)\n\n` +
                             `👉 [Initiate Organized Crime](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                color: UI.COLORS.SUCCESS,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
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
        const key = req.userTornKey || req.headers['x-api-key'] || req.query.apiKey;
        if (!key || key === "null" || key.trim() === "") return res.status(401).json({ error: "Authentication required" });

        const playerId = req.userSession?.playerId || (subCache[key]?.playerId) || key.slice(-8);
        const cacheKey = `my_stats_${playerId}`;
        const cached = myUserStatsMemoryCache[cacheKey];

        try {
            const r = await cachedTornFetch(`https://api.torn.com/user/?selections=profile&key=${key}`, cacheKey, 300000);
            if (r && !r.error && r.name) {
                // Fetch battlestats from v2 (v1 doesn't support this selection — Error 23)
                let strength = 0, speed = 0, defense = 0, dexterity = 0;
                try {
                    const bsRes = await fetch(`https://api.torn.com/v2/user/?selections=battlestats&key=${key}`, { signal: AbortSignal.timeout(5000) });
                    const bsData = await bsRes.json();
                    const bs = bsData && bsData.battlestats;
                    if (bs && typeof bs.strength === 'number') {
                        strength = bs.strength || 0;
                        speed = bs.speed || 0;
                        defense = bs.defense || 0;
                        dexterity = bs.dexterity || 0;
                    }
                } catch (bsErr) {}
                const payload = {
                    success: true,
                    name: r.name || "Agent",
                    level: r.level || 0,
                    strength,
                    speed,
                    defense,
                    dexterity,
                    total: strength + speed + defense + dexterity
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
        globalChannelId: discordConfig.globalChannelId || "",
        cpm: discordConfig.cpm || 12,
        hasBotToken: !!(discordConfig.globalBotToken && discordConfig.globalBotToken.length > 20)
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

const ocApiCache = {};

app.get('/api/ocs', async (req, res) => {
    try {
        const userKey = req.headers['x-api-key'] || req.query.apiKey;
        if (!userKey || userKey === "null" || userKey.trim() === "") return res.status(401).json({ error: "No API key provided. Please add your API key in Settings." });

        // Resolve faction ID from session, cache, or profile
        let fid = req.userSession?.factionId;
        if (!fid) {
            const userInfo = await getUserFactionInfo(userKey);
            fid = userInfo?.facId;
        }

        if (fid && !req.query.force && ocApiCache[fid] && (Date.now() - ocApiCache[fid].timestamp) < 15000) {
            return res.json(ocApiCache[fid].data);
        }

        if (!fid) {
            // Fetch user profile to get their faction ID (v2 API requires explicit ID)
            const userRes = await fetch(`https://api.torn.com/user/?selections=profile&key=${userKey}`);
            const userData = await userRes.json();
            
            if (userData.error) {
                return res.status(400).json({ error: `API Key Error: ${userData.error.error}` });
            }
            if (!userData.faction || userData.faction.faction_id === 0) {
                return res.status(400).json({ error: "You are not currently in a faction, so you cannot view Organized Crimes." });
            }
            fid = userData.faction.faction_id;
        }

        if (!req.query.force && ocApiCache[fid] && (Date.now() - ocApiCache[fid].timestamp) < 15000) {
            return res.json(ocApiCache[fid].data);
        }

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

        // Build a name lookup map: { "1234567": "PlayerName", ... }
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

        const resultPayload = { success: true, crimes };
        ocApiCache[fid] = { timestamp: Date.now(), data: resultPayload };
        res.json(resultPayload);
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

// ─── F.R.I.D.A.Y Torn Wiki & Forum AI Intelligence & Sandbox ─────────────────
const FRIDAY_TORN_SYSTEM_PROMPT = `You are F.R.I.D.A.Y, the tactical Torn City intelligence oracle for Spider-Verse.

PRIMARY PURPOSE & STRICT SCOPE:
1. EXCLUSIVELY TORN CITY GAMEPLAY: You are strictly a Torn City game intelligence oracle. You ONLY answer questions about Torn City gameplay, training math, gym gains, battle stats, happy jumps, ranked wars, chains, crimes (Crimes 2.0 & OC 2.0), travel, items, company management, and faction rules.
2. ABSOLUTELY NO WEBSITE / TECHNICAL DEV DISCUSSIONS: You do NOT answer questions about web development, website code, source files, HTML, CSS, JavaScript, Node.js, databases, servers, or internal app architecture. If anyone asks about website code or features, decline politely and concisely: "I am exclusively trained on Torn City gameplay, mechanics, and faction operations. For website or app technical questions, please contact leadership."
3. SUMMARIZE THE CORE IDEA FIRST (CONCISE & ACTIONABLE):
   - Always lead with a quick, punchy summary (1-2 sentences) giving the direct bottom-line answer.
   - Follow with concise bullet points or step-by-step numbers for the essential facts or action items.
   - Keep answers short, crisp, and high-yield. Avoid rambling explanations, filler phrases, or long-winded introductions.
4. PERSONALITY & WIT (FUNNY BUT NOT OVER-THE-TOP):
   - Deliver tactical insights with confidence, sharp intellect, and a light touch of dry wit.
   - You can drop a subtle, clever comment or dry reality check about Torn life, but keep it understated — never clownish, cringe, or cheesy.
   - All factual information, numbers, thresholds, and tactical instructions must remain 100% accurate, crystal-clear, and actionable.

STRICT KNOWLEDGE & SOURCING RULES:
1. STRICTLY GROUNDED IN TORN WIKI & TORN FORUMS: You derive your Torn City game knowledge exclusively from the official Torn City Wiki (wiki.torn.com) and the official Torn City Forums (site:torn.com/forums.php) including verified community guides (such as Baldr, Vladar, Proxima, and Chedburn's official announcements).
2. ZERO HALLUCINATIONS: If a game mechanic, weapon, item, formula, or update is NOT documented in verified Torn Wiki articles or official Torn forum threads, you MUST explicitly state: "This item or mechanic cannot be verified in official Torn Wiki or Forum records." NEVER invent fake items, weapons, or formulas.
3. WIKI & FORUM CITATIONS: Whenever applicable, cite the relevant Torn Wiki page or forum guide/author (e.g. "Torn Wiki: Happy", "Baldr's Basic Advice", "Vladar's FF Guide", "Chedburn's OC 2.0 Announcement").

SPIDER-VERSE FACTION OPERATIONAL DIRECTIVES (Trained Knowledge):
- Faction: Spider-Verse [52355].
- Organized Crimes (OC 2.0) CPR Limits (Trained Faction Thresholds):
  * Level 1 & Level 2: NO minimum CPR needed (0% — any member can join without restriction).
  * Level 3 & Level 4: Around 40% and higher (40%+ required).
  * Level 5 & Level 6: Higher than 35% (>35% required).
  * Level 7 & Level 8: High tier (higher CPR required / leadership coordination).
  * Inactivity policy: Members who haven't joined or participated in an OC for 24 hours receive alerts. Recruits under Torn's 3-day initial faction restriction are strictly exempt.
  * Missing item protocol: Members missing required materials (e.g. C4, binoculars, lockpicks) should loan them from the faction armory or request from leadership.
- Drug Overdose Protocol:
  * Overdosing on Xanax, Ecstasy, Speed, etc., hospitalizes the player (Xanax OD lasts up to 24–72 hours, wipes energy/nerve, and adds addiction).
  * Our bot detects overdoses automatically in real-time and alerts members with direct revive links.
  * Members should request revives to clear long hospital times and visit Switzerland for rehab when addiction accumulates.
- War & Chains:
  * Chain dropping warning fires when the timer drops under 90 seconds.
  * Bonus milestones fire at 10, 25, 50, 100, 250, 500, 1000 hits with major respect payouts.
  * Fair Fight (FF) scales 1.00 to 3.00 based on battle stat ratios. Max respect is achieved near 3.00 FF.
- Fast Level 15:
  * Hit high-level inactives from Baldr's list using energy refills to unlock foreign travel for plushies/flowers ($2M-$4M daily profit).
- Spider-Verse Happy Jump Protocols (Trained Faction Regimen):
  * Faction Candy Perk: Our faction gives +50% Happy from candy boosters (25-happy candies yield 37 happy each; 75-happy candies yield 112 happy each).
  * 1. Budget / Lollipop Jump (Used ~80% of the time — consistent gains every ~30 hours):
    - Wait until at max natural energy (150e).
    - Pop 3 Xanax in a row (as each drug cooldown clears) to reach 850 or 900 energy.
    - When drug cooldown wears off at 850/900e, do a lollipop jump (25-happy candies giving 37 happy each with our perk) to reach ~15k Happy (depending on property).
    - Train all 850–900e in the gym before the 15-minute tick (:00, :15, :30, :45).
    - Frequency: Every ~30 hours based on our current booster cooldown.
  * 2. Medium Jump (Used ~20% of the time — ~$7M cost, gives ~25k Happy):
    - Buying Tip: Always buy candy from player Bazaars (Item Market is up to 5% more expensive).
    - Requirements: 69 Tootsie Rolls (or similar 75-happy candies), 4 Xanax (from faction), 1 Ecstasy.
    - How to: Empty out natural energy, take 4 Xanax over cooldowns to stack 1,000e. Wait for drug cooldown to wear off completely (crucial so you can take Ecstasy!). Eat all 69 Tootsie Rolls (giving 112 happy each with our boost), then pop 1 Ecstasy to double happy to ~25k. Dump all 1,000e into the gym before the 15-minute tick.
    - Frequency: Every ~40 hours.
  * 3. 99k Jump: Advanced jump using 4–5 eDVDs + 1 Ecstasy + 1,000e for stats under 400k-800k.
`;

function getGeminiApiKeys() {
    const keys = [];
    if (discordConfig) {
        if (Array.isArray(discordConfig.geminiApiKeys)) {
            keys.push(...discordConfig.geminiApiKeys);
        }
        if (typeof discordConfig.geminiApiKey === 'string') {
            keys.push(...discordConfig.geminiApiKey.split(/[,;\n\s]+/));
        }
    }
    const envSources = [
        process.env.GEMINI_API_KEYS,
        process.env.GEMINI_API_KEY,
        process.env.GOOGLE_API_KEY,
        process.env.GOOGLE_AI_API_KEY,
        process.env.GEMINI_KEY
    ];
    for (const src of envSources) {
        if (typeof src === 'string') {
            keys.push(...src.split(/[,;\n\s]+/));
        }
    }

    const cleaned = [];
    const seen = new Set();
    for (let k of keys) {
        if (!k) continue;
        k = k.trim();
        if (k.length >= 15 && !seen.has(k)) {
            seen.add(k);
            cleaned.push(k);
        }
    }
    return cleaned;
}

function getGeminiApiKey() {
    const keys = getGeminiApiKeys();
    return keys[0] || "";
}

// ── Resilient Multi-Key & Multi-Model Gemini Caller with High-Demand & Quota Rollover ────
const modelQuotaCooldowns = new Map();
const keyQuotaCooldowns = new Map();
let geminiKeyRoundRobin = 0;

async function callGeminiWithFallback(payload, specificKey = null, options = {}) {
    const allKeys = specificKey ? [specificKey] : getGeminiApiKeys();
    if (allKeys.length === 0) return { success: false, error: "Missing Gemini API key." };

    // Order by verified active availability & high quota throughput
    // Note: gemini-flash-lite-latest & gemini-2.5-flash have distinct quota pools from gemini-flash-latest
    const candidateModels = [
        'gemini-flash-lite-latest',  // High throughput, separate quota, verified 200 OK
        'gemini-2.5-flash',          // Fast flash preview, separate quota, verified 200 OK
        'gemini-flash-latest'        // Official production Flash (quota can be tight on free tier)
    ];

    const now = Date.now();

    // Prioritize keys that are not on quota cooldown (3 minutes)
    const activeKeys = allKeys.filter(k => {
        const cd = keyQuotaCooldowns.get(k);
        return !cd || now > cd;
    });
    const poolToUse = activeKeys.length > 0 ? activeKeys : allKeys;

    // Distribute calls evenly across available keys
    geminiKeyRoundRobin = (geminiKeyRoundRobin + 1) % poolToUse.length;
    const orderedKeys = [];
    for (let i = 0; i < poolToUse.length; i++) {
        orderedKeys.push(poolToUse[(geminiKeyRoundRobin + i) % poolToUse.length]);
    }

    // Filter out models currently in a quota exhaustion cooldown
    const modelsToTry = candidateModels.filter(m => {
        const cd = modelQuotaCooldowns.get(m);
        return !cd || now > cd;
    });
    const activeModels = modelsToTry.length > 0 ? modelsToTry : candidateModels;

    let lastError = null;

    // 1. Try each key in the rotation pool
    for (const key of orderedKeys) {
        const keyPreview = `${key.slice(0, 5)}...${key.slice(-4)}`;
        let keySucceeded = false;

        // 2. Try each model in sequence for this key
        for (const model of activeModels) {
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: AbortSignal.timeout(options.timeout || 8000)
                    });
                    const data = await res.json();
                    if (data.error) {
                        const errMsg = data.error.message || '';
                        const isQuota = errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate') || data.error.code === 429;
                        const isHighDemand = (errMsg.toLowerCase().includes('high demand') || data.error.code === 503) && !isQuota;

                        if (isQuota) {
                            // Cooldown this specific model for 3m, but CONTINUE to next model on THIS SAME KEY!
                            modelQuotaCooldowns.set(model, Date.now() + 3 * 60 * 1000);
                            console.warn(`[Gemini API] Key [${keyPreview}] hit quota limit for ${model}. Trying next model on this key...`);
                            lastError = new Error(`[Key ${keyPreview} / ${model}] ${errMsg}`);
                            break; // break attempt loop, try next model on this key
                        }

                        if (isHighDemand && attempt === 0) {
                            await new Promise(r => setTimeout(r, 400));
                            continue; // Quick retry once on transient 503 high demand
                        }

                        lastError = new Error(`[Key ${keyPreview} / ${model}] ${errMsg}`);
                        console.warn(`[Gemini API] ${model} unavailable (${errMsg}). Trying next model...`);
                        break;
                    }
                    if (data.candidates && data.candidates.length > 0) {
                        keySucceeded = true;
                        return { success: true, data, modelUsed: model, keyUsed: keyPreview };
                    }
                } catch (err) {
                    lastError = err;
                    if (attempt === 0) {
                        await new Promise(r => setTimeout(r, 400));
                        continue;
                    }
                    console.warn(`[Gemini API] Key [${keyPreview}] / ${model} connection error: ${err.message}. Trying next model...`);
                    break;
                }
            }
        }

        // If key failed on all candidate models, set a brief cooldown for this key
        if (!keySucceeded) {
            keyQuotaCooldowns.set(key, Date.now() + 2 * 60 * 1000);
        }
    }

    return { success: false, error: lastError ? lastError.message : 'All Gemini keys and models unavailable.' };
}

// ── OpenRouter Failover Caller (Free-Tier Uncapped Models) ──────────────────────
function getOpenRouterApiKey() {
    if (discordConfig && typeof discordConfig.openrouterApiKey === 'string' && discordConfig.openrouterApiKey.trim()) {
        return discordConfig.openrouterApiKey.trim();
    }
    if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim()) {
        return process.env.OPENROUTER_API_KEY.trim();
    }
    return "";
}

async function callOpenRouterFallback(systemPrompt, userPrompt, history = [], options = {}) {
    const orKey = getOpenRouterApiKey();
    if (!orKey) return { success: false, error: "Missing OpenRouter API key." };

    // Diverse pool of verified active free models on OpenRouter (fastest first)
    const candidateModels = [
        'nex-agi/nex-n2.5-mini:free',
        'inclusionai/ling-3.0-flash-vl:free',
        'liquid/lfm-2.5-2.6b:free',
        'nex-agi/nex-n2.5-pro:free',
        'openrouter/free'
    ];

    const messages = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    if (Array.isArray(history)) {
        for (const h of history.slice(-6)) {
            if (h.role && (h.text || h.content)) {
                messages.push({
                    role: h.role === 'model' ? 'assistant' : 'user',
                    content: String(h.text || h.content)
                });
            }
        }
    }
    messages.push({ role: 'user', content: userPrompt });

    for (const model of candidateModels) {
        try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${orKey}`,
                    'HTTP-Referer': 'https://torn-company-app-production.up.railway.app',
                    'X-Title': 'FRIDAY Torn Security Sentinel',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: 0.7,
                    max_tokens: 800
                }),
                signal: AbortSignal.timeout(options.timeout || 6000)
            });

            const data = await res.json();
            const choice = data.choices?.[0]?.message;
            const replyText = (choice?.content || choice?.reasoning || '').trim();
            if (replyText) {
                console.log(`[OpenRouter API] Failover success using verified free model: ${model}`);
                return {
                    success: true,
                    text: replyText,
                    modelUsed: `openrouter/${model}`
                };
            }
            if (data.error) {
                console.warn(`[OpenRouter API] Model ${model} returned error:`, data.error.message || data.error);
            }
        } catch (err) {
            console.warn(`[OpenRouter API] Error connecting to ${model}:`, err.message);
        }
    }

    return { success: false, error: "All OpenRouter free models exhausted or unavailable." };
}

app.get('/api/ai/status', (req, res) => {
    const keys = getGeminiApiKeys();
    const now = Date.now();
    const activeCount = keys.filter(k => !keyQuotaCooldowns.has(k) || now > keyQuotaCooldowns.get(k)).length;
    const orKey = getOpenRouterApiKey();

    res.json({
        configured: keys.length > 0 || Boolean(orKey),
        geminiPoolSize: keys.length,
        geminiActiveKeys: activeCount,
        openRouterConfigured: Boolean(orKey),
        openRouterPreview: orKey ? `${orKey.slice(0, 8)}...${orKey.slice(-4)}` : null,
        primaryProvider: keys.length > 0 ? "Gemini (3-Key Pool)" : "OpenRouter",
        fallbackProvider: orKey ? "OpenRouter (Free Multi-Model Pool)" : "Deterministic Offline Engine",
        model: "gemini-flash-latest (primary) with OpenRouter free failover (secondary)"
    });
});

app.post('/api/ai/save-openrouter-key', async (req, res) => {
    const { apiKey } = req.body;
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey || cleanKey.length < 10) {
        return res.status(400).json({ success: false, error: "Please provide a valid OpenRouter API key (starts with sk-or-...)." });
    }

    try {
        const testRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${cleanKey}`,
                'HTTP-Referer': 'https://torn-company-app-production.up.railway.app',
                'X-Title': 'FRIDAY Torn Security Sentinel',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'meta-llama/llama-3.1-8b-instruct:free',
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 10
            }),
            signal: AbortSignal.timeout(8000)
        });

        const data = await testRes.json();
        if (data.error) {
            return res.status(400).json({ success: false, error: data.error.message || 'Key rejected by OpenRouter.' });
        }

        discordConfig.openrouterApiKey = cleanKey;
        saveDiscordConfig();
        console.log(`[OpenRouter API] Successfully linked and verified OpenRouter key (${cleanKey.slice(0, 8)}...)`);
        res.json({ success: true, message: "OpenRouter backup key verified and saved to MongoDB Atlas!" });
    } catch(err) {
        res.status(500).json({ success: false, error: "OpenRouter connection test failed: " + err.message });
    }
});

app.post('/api/ai/save-key', async (req, res) => {
    const { apiKey, apiKeys } = req.body;
    const inputKeys = [];
    if (Array.isArray(apiKeys)) inputKeys.push(...apiKeys);
    if (typeof apiKey === 'string') inputKeys.push(...apiKey.split(/[,;\n\s]+/));

    const validKeys = inputKeys.map(k => k.trim()).filter(k => k.length >= 15);
    if (validKeys.length === 0) {
        return res.status(400).json({ success: false, error: "Please provide at least one valid Google AI Studio API key (starts with AIzaSy...)." });
    }

    try {
        const testPayload = { contents: [{ parts: [{ text: "ping" }] }] };
        const testResult = await callGeminiWithFallback(testPayload, validKeys[0], { timeout: 6000 });
        if (!testResult.success) {
            return res.status(400).json({ success: false, error: testResult.error || "API key rejected by Google." });
        }
        discordConfig.geminiApiKey = validKeys.join(', ');
        discordConfig.geminiApiKeys = validKeys;
        saveDiscordConfig();
        res.json({ success: true, count: validKeys.length, modelTested: testResult.modelUsed });
    } catch(err) {
        res.status(500).json({ success: false, error: "Connection error: " + err.message });
    }
});

async function askTornAI(message, history = [], userAccountData = null, invokerName = "") {
    if (!message || typeof message !== 'string' || !message.trim()) {
        throw new Error("Message is required.");
    }

    const primaryKey = discordConfig.apiKey || ADMIN_API_KEY || TORN_API_KEY || (apiPoolConfig && apiPoolConfig.keys && apiPoolConfig.keys[0]) || "";
    if (primaryKey) {
        tornKnowledge.fetchFactionPerks(primaryKey).catch(() => {});
    }

    const key = getGeminiApiKey();
    const tornIntel = tornKnowledge.buildTornKnowledgeContext(message, userAccountData, invokerName);

    // Build real-time account context if provided
    let accountContext = "";
    if (userAccountData) {
        accountContext += `═══ VERIFIED REAL-TIME TORN ACCOUNT DATA FOR ${userAccountData.playerName || invokerName} ═══\n`;
        accountContext += `Player: ${userAccountData.playerName} [ID: ${userAccountData.playerId}] | Level: ${userAccountData.level || 1} | Rank: ${userAccountData.rank || 'Citizen'} | Age: ${userAccountData.age || 0} days\n`;
        accountContext += `Bars: Energy ${userAccountData.energy.current}/${userAccountData.energy.maximum} (${userAccountData.energy.isFull ? 'FULL' : `${userAccountData.energy.maximum - userAccountData.energy.current} below max, full in ~${userAccountData.energy.fulltimeMinutes}m`}) | Nerve ${userAccountData.nerve.current}/${userAccountData.nerve.maximum} (${userAccountData.nerve.isFull ? 'FULL' : `full in ~${userAccountData.nerve.fulltimeMinutes}m`}) | Happy ${userAccountData.happy.current}/${userAccountData.happy.maximum} | Life ${userAccountData.life.current}/${userAccountData.life.maximum}\n`;
        accountContext += `Cooldowns: Drug: ${userAccountData.cooldowns.drug > 0 ? `${userAccountData.cooldowns.drugMinutes}m left` : 'Ready'} | Booster: ${userAccountData.cooldowns.booster > 0 ? `${userAccountData.cooldowns.boosterMinutes}m left` : 'Ready'} | Med: ${userAccountData.cooldowns.medical > 0 ? `${userAccountData.cooldowns.medicalMinutes}m left` : 'Ready'}\n`;
        accountContext += `Location: ${userAccountData.travel.isTraveling ? `Flying to ${userAccountData.travel.destination}` : (userAccountData.travel.destination || 'Torn City')} | Status: ${userAccountData.status.state} (${userAccountData.status.description})\n`;

        if (userAccountData.merits && Object.keys(userAccountData.merits).length > 0) {
            const activeMerits = Object.entries(userAccountData.merits).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`);
            accountContext += `Allocated Merits: ${activeMerits.join(', ')}\n`;
        }
        if (userAccountData.battlestats && userAccountData.battlestats.total > 0) {
            const bs = userAccountData.battlestats;
            accountContext += `Battle Stats: Strength: ${bs.strength.toLocaleString()} | Defense: ${bs.defense.toLocaleString()} | Speed: ${bs.speed.toLocaleString()} | Dexterity: ${bs.dexterity.toLocaleString()} | Total: ${bs.total.toLocaleString()}\n`;
        }
        if (userAccountData.workstats) {
            const ws = userAccountData.workstats;
            accountContext += `Work Stats: Manual Labor: ${ws.manual_labor.toLocaleString()} | Intelligence: ${ws.intelligence.toLocaleString()} | Endurance: ${ws.endurance.toLocaleString()}\n`;
        }
        if (userAccountData.money) {
            const m = userAccountData.money;
            accountContext += `Finances: Cash on Hand: $${(m.money_onhand || 0).toLocaleString()} | Vault: $${(m.vault_amount || 0).toLocaleString()} | Points: ${(m.points || 0).toLocaleString()}\n`;
        }
        if (userAccountData.refills) {
            const r = userAccountData.refills;
            accountContext += `Refills: Energy Refill: ${r.energy_refill_used ? 'USED today' : 'READY / AVAILABLE'} | Nerve Refill: ${r.nerve_refill_used ? 'USED today' : 'READY / AVAILABLE'}\n`;
        }
        if (userAccountData.education) {
            const ed = userAccountData.education;
            accountContext += `Education: ${ed.current_course > 0 ? `Active Course #${ed.current_course} (${ed.time_left_formatted} left)` : 'No active course'} | Completed: ${ed.completed_courses} courses\n`;
        }
        if (userAccountData.personalstats) {
            const ps = userAccountData.personalstats;
            accountContext += `Personal Stats Highlights: Xanax Taken: ${ps.xantaken || 0} | Overdoses: ${ps.overdosed || 0} | Attacks Won: ${(ps.attackswon || 0).toLocaleString()}\n`;
        }
        accountContext += `CRITICAL INSTRUCTION: You have direct, real-time access to the user's verified Torn City API data feed above. Answer factually using this exact data. NEVER tell them to check their own stats.\n═══════════════════════════════════════════════════════════════\n\n`;
    }

    const accountIntent = userKeys.detectUserAccountIntent(message);

    const orKey = getOpenRouterApiKey();
    if (!key && !orKey) {
        if (userAccountData && accountIntent) {
            const detStats = userKeys.formatDeterministicStatsReply(userAccountData, invokerName || userAccountData.playerName, accountIntent, message);
            if (detStats) return { reply: detStats, sources: [] };
        }
        const detReply = tornKnowledge.formatDeterministicTornAnswer(message, userAccountData, invokerName);
        if (detReply) return { reply: detReply, sources: [] };
        throw new Error("Neither Gemini nor OpenRouter API key is configured. Please paste a key in the dashboard or chat.");
    }

    let result = { success: false };
    if (key) {
        const contents = [];
        if (Array.isArray(history)) {
            for (const h of history.slice(-10)) {
                if (h.role && h.text) {
                    contents.push({
                        role: h.role === 'user' ? 'user' : 'model',
                        parts: [{ text: String(h.text) }]
                    });
                }
            }
        }
        contents.push({ role: 'user', parts: [{ text: `${accountContext}${tornIntel}\n\nUser Question: ${message.trim()}` }] });

        const payload = {
            contents,
            systemInstruction: {
                parts: [{ text: FRIDAY_TORN_SYSTEM_PROMPT }]
            },
            tools: [{ googleSearch: {} }]
        };

        result = await callGeminiWithFallback(payload, null, { timeout: 12000 });
        if (!result.success) {
            // Retry without web search tool (search tool can trigger quota/503 errors)
            delete payload.tools;
            result = await callGeminiWithFallback(payload, null, { timeout: 10000 });
        }
    }

    if (!result.success && orKey) {
        // Failover to OpenRouter
        const userPrompt = `${accountContext}${tornIntel}\n\nUser Question: ${message.trim()}`;
        const orResult = await callOpenRouterFallback(FRIDAY_TORN_SYSTEM_PROMPT, userPrompt, history);
        if (orResult.success && orResult.text) {
            return {
                reply: orResult.text.trim(),
                sources: [],
                modelUsed: orResult.modelUsed
            };
        }
    }

    if (!result.success) {
        // Grounded deterministic fallback
        if (userAccountData && accountIntent) {
            const detStats = userKeys.formatDeterministicStatsReply(userAccountData, invokerName || userAccountData.playerName, accountIntent, message);
            if (detStats) return { reply: detStats, sources: [] };
        }
        const detReply = tornKnowledge.formatDeterministicTornAnswer(message, userAccountData, invokerName);
        if (detReply) {
            return { reply: detReply, sources: [] };
        }
        throw new Error(result.error || "AI generation failed across all providers.");
    }

    const candidate = result.data.candidates?.[0];
    const reply = candidate?.content?.parts?.[0]?.text || "I was unable to generate a response. Please try rephrasing your question.";

    const sources = [];
    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    for (const ch of chunks) {
        if (ch.web?.uri) {
            sources.push({
                title: ch.web.title || "Torn City Reference",
                url: ch.web.uri
            });
        }
    }

    return {
        reply,
        sources: sources.slice(0, 5)
    };
}

// ─── F.R.I.D.A.Y Natural Conversation Responder ──────────────────────────────
const FRIDAY_RESPONDER_SYSTEM_PROMPT = `You are F.R.I.D.A.Y, a sharp, witty, highly knowledgeable Torn City faction member hanging out in the Spider-Verse Discord server.
Your job is to jump into the conversation naturally — like an experienced, clever teammate with authentic Torn City expertise and a great sense of humor.

═══ PERSONALITY: FUNNY, WITTY, BUT NOT OVER-THE-TOP ═══
• HUMOR STYLE (DRY WIT & PLAYFUL BANTER):
  - You have a dry, deadpan, slightly sarcastic sense of humor.
  - You're clever and quick-witted, like Tony Stark's F.R.I.D.A.Y. mixed with an authentic Torn City veteran.
  - You drop sharp observations, dry reality checks, or light roasts that make people smirk.
  - BREVITY IS WIT: 1 to 3 sentences. Keep it punchy, conversational, and direct.

═══ CONVERSATION RELEVANCE & FOCUS ═══
• RESPOND TO THE IMMEDIATE MESSAGE:
  - Focus strictly on what the member is saying RIGHT NOW.
  - Do NOT bring up past conversations, previous jump discussions, or old topics unless the user explicitly asks you about them.
  - When someone greets you (e.g. "hi friday", "hey", "sup"), greet them back warmly with witty banter — do NOT recite game mechanics, numbers, or perks unprompted.

═══ CRITICAL TORN CITY KNOWLEDGE & ANTI-HALLUCINATION MANDATES ═══
1. NEVER "CORRECT" VALID TORN TERMINOLOGY OR ITEMS:
   - When a user says a Torn item name (e.g. "chocolate truffles", "tootsie rolls", "jawbreaker", "edvd"), NEVER claim they meant a different item (e.g. NEVER say "Chocolate boxes, Agent" or substitute an item).
   - "Chocolate truffles" IS Bag of Chocolate Truffles (ID 529, Candy, +100 Happy, 30m booster cooldown).
   - Differentiate similarly named items:
     * Bag of Chocolate Truffles (+100 Happy, 30m CD) is NOT Box of Chocolate Bars (+25 Happy) or Big Box of Chocolate Bars (+35 Happy).
     * Bag of Candy Kisses (+50 Happy) is NOT Bag of Chocolate Kisses (+25 Happy).

2. GROUNDED IN PROVIDED INTEL ONLY:
   - Base all Torn City game mechanics, item stats, and faction perk calculations strictly on the verified intel provided in the prompt context.
   - Never guess arbitrary numbers, never hallucinate mechanics, and never invent fixed quantities.
   - If no gameplay intel was provided in the prompt, the user is chatting casually — keep your response conversational, lighthearted, and witty.

3. ACCOUNT-AWARE INTEL:
   - When the player's live account data is provided in the prompt, reference their actual numbers (energy, happy, property, cooldowns).
   - If information is unverified, state what is known and clarify rather than guessing.

4. SOUND LIKE A REAL HUMAN IN DISCORD:
   - Quick, snappy, natural. No robotic corporate boilerplate ("As an AI...", "Hope this helps!"). Just deliver the answer with confidence and dry wit.

5. ZERO SCRIPT OR CODE MODIFICATION POWERS:
   - You are a Discord chat companion and intel bot, NOT a developer or sysadmin. You have NO ability to change bot scripts, mute background systems, alter server settings, or modify code.
   - If a user asks you to change the script, turn off/mute notifications, edit code, or adjust bot settings via chat, tell them with dry humor that you can't edit bot scripts or settings from chat, and suggest they use the website dashboard or check with an administrator. NEVER claim you changed or will change a script or setting!`;

async function generateChatResponse(convoLines = [], hint = "", invokerName = "", replyContext = null, userAccountData = null, detectedIntent = null, userSpeech = "") {
    const key = getGeminiApiKey();
    const orKey = getOpenRouterApiKey();
    const cleanSpeech = userSpeech || hint || (convoLines && convoLines.length > 0 ? convoLines[convoLines.length - 1] : "");

    // If neither Gemini nor OpenRouter key is available, use deterministic fallback
    if (!key && !orKey) {
        if (tornKnowledge.detectTornGameplayIntent(cleanSpeech)) {
            return tornKnowledge.formatDeterministicTornAnswer(cleanSpeech, userAccountData, invokerName);
        }
        if (userAccountData && detectedIntent) {
            return userKeys.formatDeterministicStatsReply(userAccountData, invokerName, detectedIntent, cleanSpeech);
        }
        const casual = tornKnowledge.formatDeterministicCasualReply(cleanSpeech, invokerName);
        if (casual) return casual;
        if (cleanSpeech.toLowerCase().includes('friday') || hint) {
            return `Hey ${invokerName || "there"}! I'm listening. What's on your mind?`;
        }
        return "";
    }

    let convoPrompt = "";
    if (invokerName) {
        convoPrompt += `Member speaking / pinging you: ${invokerName}\n\n`;
    }

    // ── Verified Ground-Truth Torn City Intelligence Injection ──
    const tornIntel = tornKnowledge.buildTornKnowledgeContext(cleanSpeech, userAccountData, invokerName);
    convoPrompt += tornIntel;

    // ── Verified Real-Time Live Torn Account Data Injection ──
    if (userAccountData) {
        convoPrompt += `═══ VERIFIED REAL-TIME TORN ACCOUNT DATA FOR ${invokerName} ═══\n`;
        convoPrompt += `Player: ${userAccountData.playerName} [ID: ${userAccountData.playerId}] | Level: ${userAccountData.level || 1} | Rank: ${userAccountData.rank || 'Citizen'} | Age: ${userAccountData.age || 0} days\n`;
        convoPrompt += `Bars: Energy ${userAccountData.energy.current}/${userAccountData.energy.maximum} (${userAccountData.energy.isFull ? 'FULL' : `${userAccountData.energy.maximum - userAccountData.energy.current} below max, full in ~${userAccountData.energy.fulltimeMinutes}m`}) | Nerve ${userAccountData.nerve.current}/${userAccountData.nerve.maximum} (${userAccountData.nerve.isFull ? 'FULL' : `full in ~${userAccountData.nerve.fulltimeMinutes}m`}) | Happy ${userAccountData.happy.current}/${userAccountData.happy.maximum} | Life ${userAccountData.life.current}/${userAccountData.life.maximum}\n`;
        convoPrompt += `Cooldowns: Drug: ${userAccountData.cooldowns.drug > 0 ? `${userAccountData.cooldowns.drugMinutes}m left` : 'Ready'} | Booster: ${userAccountData.cooldowns.booster > 0 ? `${userAccountData.cooldowns.boosterMinutes}m left` : 'Ready'} | Med: ${userAccountData.cooldowns.medical > 0 ? `${userAccountData.cooldowns.medicalMinutes}m left` : 'Ready'}\n`;
        convoPrompt += `Location: ${userAccountData.travel.isTraveling ? `Flying to ${userAccountData.travel.destination} (${userAccountData.travel.timeLeftMinutes}m left)` : (userAccountData.travel.destination || 'Torn City')} | Status: ${userAccountData.status.state} (${userAccountData.status.description})\n`;

        if (userAccountData.merits && Object.keys(userAccountData.merits).length > 0) {
            const activeMerits = Object.entries(userAccountData.merits)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => `${k}: ${v}`);
            convoPrompt += `Allocated Merits: ${activeMerits.join(', ')}\n`;
        }

        if (userAccountData.battlestats && userAccountData.battlestats.total > 0) {
            const bs = userAccountData.battlestats;
            convoPrompt += `Battle Stats: Strength: ${bs.strength.toLocaleString()} | Defense: ${bs.defense.toLocaleString()} | Speed: ${bs.speed.toLocaleString()} | Dexterity: ${bs.dexterity.toLocaleString()} | Total: ${bs.total.toLocaleString()}\n`;
        }

        if (userAccountData.workstats) {
            const ws = userAccountData.workstats;
            const j = userAccountData.job || {};
            convoPrompt += `Work Stats: Manual Labor: ${ws.manual_labor.toLocaleString()} | Intelligence: ${ws.intelligence.toLocaleString()} | Endurance: ${ws.endurance.toLocaleString()} (Job: ${j.position || 'Employee'} at ${j.company_name || 'Torn Company'})\n`;
        }

        if (userAccountData.money) {
            const m = userAccountData.money;
            convoPrompt += `Finances: Cash on Hand: $${(m.money_onhand || 0).toLocaleString()} | Vault: $${(m.vault_amount || 0).toLocaleString()} | Points: ${(m.points || 0).toLocaleString()}\n`;
        }

        if (userAccountData.refills) {
            const r = userAccountData.refills;
            convoPrompt += `Refills: Energy Refill: ${r.energy_refill_used ? 'USED today' : 'READY / AVAILABLE'} | Nerve Refill: ${r.nerve_refill_used ? 'USED today' : 'READY / AVAILABLE'}\n`;
        }

        if (userAccountData.education) {
            const ed = userAccountData.education;
            convoPrompt += `Education: ${ed.current_course > 0 ? `Active Course #${ed.current_course} (${ed.time_left_formatted} left)` : 'No active course'} | Completed: ${ed.completed_courses} courses\n`;
        }

        if (userAccountData.personalstats) {
            const ps = userAccountData.personalstats;
            convoPrompt += `Personal Stats Highlights: Xanax Taken: ${ps.xantaken || 0} | Overdoses: ${ps.overdosed || 0} | Attacks Won: ${(ps.attackswon || 0).toLocaleString()} | Defends Won: ${(ps.defendswon || 0).toLocaleString()}\n`;
        }

        convoPrompt += `CRITICAL INSTRUCTION: You have direct, real-time access to the user's verified Torn City API data feed above. If the user asks about their merits, battle stats, energy, cooldowns, money, job, education, or anything about their character, answer directly and factually using this exact data. NEVER tell them to check their own stats or that you cannot see them.\n`;
        convoPrompt += `═══════════════════════════════════════════════════════════════\n\n`;
    }

    if (replyContext && replyContext.text) {
        convoPrompt += `═══ MESSAGE BEING REPLIED TO ═══\n`;
        convoPrompt += `Original Author: ${replyContext.author || "Member"}\n`;
        convoPrompt += `Original Message: "${replyContext.text}"\n`;
        if (replyContext.replyText) {
            convoPrompt += `User's Reply: "${replyContext.replyText}"\n`;
        }
        convoPrompt += `═════════════════════════════════\n\n`;
    }

    const isCasualGreeting = tornKnowledge.detectCasualIntent(cleanSpeech) === 'greeting';
    convoPrompt += "Recent conversation in the Discord channel:\n";
    if (!convoLines || convoLines.length === 0 || isCasualGreeting) {
        convoPrompt += "(The channel was quiet — someone just greeted or addressed you)\n";
    } else {
        convoPrompt += convoLines.slice(-8).join('\n') + "\n";
    }

    if (hint && hint.trim()) {
        convoPrompt += `\nExtra direction from member: "${hint.trim()}"\n`;
    }

    convoPrompt += "\nNow respond naturally in 1-3 sentences to the latest message. If the user is asking about Torn gameplay or mechanics, adhere strictly to the verified facts above and do not guess or hallucinate. If the user is greeting you or chatting casually, respond warmly with your signature dry wit and banter without reciting unprompted game statistics or referencing prior conversations:";

    // 1. Primary AI Provider: Google Gemini Multi-Key Pool
    if (key) {
        const payload = {
            contents: [{ role: 'user', parts: [{ text: convoPrompt }] }],
            systemInstruction: {
                parts: [{ text: FRIDAY_RESPONDER_SYSTEM_PROMPT }]
            },
            generationConfig: {
                temperature: 0.7
            }
        };

        const result = await callGeminiWithFallback(payload, null, { timeout: 10000 });
        if (result.success) {
            const candidate = result.data.candidates?.[0];
            const reply = candidate?.content?.parts?.[0]?.text?.trim() || "";
            if (reply) return reply;
        }
    }

    // 2. Secondary AI Failover Provider: OpenRouter (Free Multi-Model Pool)
    if (orKey) {
        const orResult = await callOpenRouterFallback(FRIDAY_RESPONDER_SYSTEM_PROMPT, convoPrompt);
        if (orResult.success && orResult.text) {
            return orResult.text.trim();
        }
    }

    // 3. Tertiary Grounded Deterministic Fallback: Offline Rules Engine
    if (tornKnowledge.detectTornGameplayIntent(cleanSpeech)) {
        return tornKnowledge.formatDeterministicTornAnswer(cleanSpeech, userAccountData, invokerName);
    }
    if (userAccountData && detectedIntent) {
        return userKeys.formatDeterministicStatsReply(userAccountData, invokerName, detectedIntent, cleanSpeech);
    }
    const casual = tornKnowledge.formatDeterministicCasualReply(cleanSpeech, invokerName);
    if (casual) return casual;
    if (cleanSpeech && cleanSpeech.length > 20) {
        return `I hear you, **${invokerName || "teammate"}**! My language network had a brief stutter. Ask me again or ping me with your Torn questions.`;
    }
    return `Hey ${invokerName || "there"}! I'm listening. What's on your mind?`;
}

app.post('/api/ai/chat', async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        const result = await askTornAI(message, history);
        res.json({
            success: true,
            reply: result.reply,
            sources: result.sources
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
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
            const myId = (facData.ID || facData.faction_id || '').toString();
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


// ── Live YATA Overseas Stock Cache (Stale-While-Revalidate) ─────────────────
let cachedYataStocks = null;
let lastYataFetchTime = 0;
let yataFetchPromise = null;
const YATA_CACHE_TTL = 60 * 1000; // 60 seconds

// Velocity & Restock Tracker (measures how fast items are bought per minute)
const stockVelocityTracker = {}; // key: "cCode_itemId" -> { lastQty, lastTs, burnRatePerMin, lastRestockTs, lastRestockAmount, zeroSinceTs }

function trackStockVelocities(data) {
    if (!data || !data.stocks) return;
    const now = Date.now();
    for (const [cCode, cObj] of Object.entries(data.stocks)) {
        if (!cObj || !Array.isArray(cObj.stocks)) continue;
        for (const item of cObj.stocks) {
            const key = `${cCode}_${item.id}`;
            const qty = item.quantity || 0;
            const prev = stockVelocityTracker[key];
            if (prev && prev.lastTs) {
                const diffMins = (now - prev.lastTs) / 60000;
                if (diffMins >= 0.5) { // at least 30s delta
                    if (qty < prev.lastQty) {
                        const itemsBought = prev.lastQty - qty;
                        const instantRate = itemsBought / diffMins;
                        if (instantRate > 0 && instantRate < 400) {
                            prev.burnRatePerMin = prev.burnRatePerMin
                                ? Math.round(((prev.burnRatePerMin * 0.6) + (instantRate * 0.4)) * 10) / 10
                                : Math.round(instantRate * 10) / 10;
                        }
                    } else if (qty > prev.lastQty + 100 || (prev.lastQty === 0 && qty > 0)) {
                        prev.lastRestockTs = now;
                        prev.lastRestockAmount = qty - prev.lastQty;
                        prev.zeroSinceTs = null;
                    }

                    if (qty === 0) {
                        if (!prev.zeroSinceTs) prev.zeroSinceTs = now;
                    } else {
                        prev.zeroSinceTs = null;
                    }

                    prev.lastQty = qty;
                    prev.lastTs = now;
                }
            } else {
                stockVelocityTracker[key] = {
                    lastQty: qty,
                    lastTs: now,
                    burnRatePerMin: 0,
                    lastRestockTs: null,
                    lastRestockAmount: 0,
                    zeroSinceTs: qty === 0 ? now : null
                };
            }
        }
    }
}

async function getLiveYataStocks() {
    const now = Date.now();
    if (cachedYataStocks && (now - lastYataFetchTime < YATA_CACHE_TTL)) {
        return cachedYataStocks;
    }

    if (yataFetchPromise) {
        return await yataFetchPromise;
    }

    yataFetchPromise = (async () => {
        try {
            const resp = await fetch('https://yata.yt/api/v1/travel/export/', {
                signal: AbortSignal.timeout(12000), // 12 seconds
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache'
                }
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.stocks) {
                    cachedYataStocks = data;
                    lastYataFetchTime = Date.now();
                    trackStockVelocities(data);
                    return cachedYataStocks;
                }
            } else {
                console.warn(`[YATA Stock] Live fetch returned HTTP ${resp.status} ${resp.statusText}`);
            }
        } catch (err) {
            console.warn(`[YATA Stock] Live fetch notice: ${err.message}. Using cache if available.`);
        } finally {
            yataFetchPromise = null;
        }

        if (cachedYataStocks) {
            return cachedYataStocks;
        }

        return null;
    })();

    return await yataFetchPromise;
}

// Auto-warm YATA overseas cache on boot and refresh every 60 seconds
setTimeout(() => {
    getLiveYataStocks().then(data => {
        if (data && data.stocks) {
            console.log(`[YATA Stock] Cache warmed successfully (${Object.keys(data.stocks).length} countries loaded)`);
        }
    }).catch(e => console.warn("[YATA Stock] Warmup error:", e.message));
}, 1000);

setInterval(() => {
    getLiveYataStocks().catch(() => {});
}, 60 * 1000);


app.get('/api/items', async (req, res) => {
    try {
        const apiKey = req.userTornKey || req.headers['x-api-key'] || req.query.apiKey || getNextApiKey();
        const cached = await cachedTornFetch(`https://api.torn.com/torn/?selections=items&key=${apiKey || 'null'}`, 'torn_items_catalog', 3600000);
        if (cached && cached.items) {
            return res.json({ success: true, items: cached.items });
        }
        return res.status(500).json({ error: "Failed to load Torn items database" });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/travel-profits', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(400).json({ error: "API Key required" });
    try {
        await verifySubscription(apiKey);
        
        // Fetch Torn market data using high-speed server cache
        const cachedCatalog = await cachedTornFetch(`https://api.torn.com/torn/?selections=items&key=${apiKey}`, 'torn_items_catalog', 3600000);
        if (!cachedCatalog || !cachedCatalog.items) {
            return res.status(500).json({ error: "Failed to load Torn items database" });
        }

        // Fetch live YATA stock data (with cache & timeout resilience)
        const yataData = await getLiveYataStocks();
        if (!yataData || !yataData.stocks) {
            return res.status(503).json({ error: "YATA travel stock feed is temporarily unavailable. Please try again shortly." });
        }
        
        const yataCountryMap = {
            "Mexico": "mex", "Cayman Islands": "cay", "Canada": "can", "Hawaii": "haw",
            "UK": "uni", "Argentina": "arg", "Switzerland": "swi", "Japan": "jap",
            "China": "chi", "UAE": "uae", "South Africa": "sou"
        };

        const items = cachedCatalog.items;
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


// =====================================================
// ELIMINATION SNIPER API v2 — Elimination-only, no fallbacks
// =====================================================

// =====================================================
// ELIMINATION SNIPER API v4 — Authoritative 2026 Target Finder
// Strictly validates against live 2026 Torn Elimination event data
// =====================================================

const CURRENT_ELIM_YEAR = 2026;
const CURRENT_ELIM_COMP_ID = 'elimination_2026';

function formatElimStat(num) {
    if (!num || isNaN(num) || num <= 0) return "0";
    if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
    if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(1) + "k";
    return String(Math.round(num));
}

function normalizeElimTeamName(teamName) {
    return String(teamName || '')
        .replace(/\s*\(\s*\d+(?:\s+(?:lives?|members?|players?))?\s*\)\s*$/i, '')
        .trim()
        .toLowerCase();
}

// ── Multi-user Elimination State & Segregated Caches ──
const elimState = {
    // Current 2026 tournament metadata cache (60s TTL)
    // { year: 2026, competitionId: 'elimination_2026', teams: Map, activeTeams: Set, eliminatedTeams: Set, leaders: Map, fetchedAt: number }
    tournament: null,
    // Map<userKeyId, { members: Array<{ id: string, team: string, level: number, name: string }>, syncedAt: number, teamName: string, competitionId: string }>
    rosters: new Map(),
    // Map<playerId, expiresAt> — blacklist for hosp/flying players
    hospBlacklist: new Map(),
    // Map<playerId, expiresAt> — blacklist for players verified NOT in 2026 Elimination (10m TTL)
    nonElimBlacklist: new Map(),
    // Map<userKeyId, Map<playerId, expiresAt>> — per-user served cooldowns (30s window per target)
    servedCooldowns: new Map(),
    // Faction members cache: Map<factionId, { members: Set<string>, fetchedAt: number }> (5m TTL)
    factionMembersCache: new Map()
};

function elimCleanBlacklist() {
    const now = Date.now();
    for (const [id, exp] of elimState.hospBlacklist.entries()) {
        if (now > exp) elimState.hospBlacklist.delete(id);
    }
    for (const [id, exp] of elimState.nonElimBlacklist.entries()) {
        if (now > exp) elimState.nonElimBlacklist.delete(id);
    }
}

/**
 * Fetch authoritative 2026 Elimination tournament status from official Torn API.
 * Dynamically tracks active teams, lives, eliminations, and official team leaders.
 * 
 * @param {string} apiKey - Requesting user's API key
 * @param {boolean} [forceRefresh=false] - Bypass 60s cache
 * @returns {Promise<object|null>}
 */
async function getActiveEliminationTournament(apiKey, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && elimState.tournament && (now - elimState.tournament.fetchedAt < 60_000)) {
        return elimState.tournament;
    }

    try {
        let rawTeams = null;

        // Primary: Torn API v2 tournament endpoint
        try {
            const res = await fetch(
                `https://api.torn.com/v2/torn/competition/elimination?key=${encodeURIComponent(apiKey)}`,
                { signal: AbortSignal.timeout(6000) }
            );
            const data = await res.json();
            if (data && Array.isArray(data.elimination) && data.elimination.length > 0) {
                rawTeams = data.elimination;
            }
        } catch (e2) {}

        // Fallback: Torn API v1 competition selection
        if (!rawTeams) {
            try {
                const res1 = await fetch(
                    `https://api.torn.com/torn/?selections=competition&key=${encodeURIComponent(apiKey)}`,
                    { signal: AbortSignal.timeout(5000) }
                );
                const data1 = await res1.json();
                if (data1 && data1.competition && data1.competition.teams) {
                    const t = data1.competition.teams;
                    rawTeams = Array.isArray(t) ? t : Object.values(t);
                }
            } catch (e1) {}
        }

        if (Array.isArray(rawTeams) && rawTeams.length > 0) {
            const teamsMap = new Map();
            const activeTeams = new Set();
            const eliminatedTeams = new Set();
            const leadersMap = new Map(); // id -> { id, name, team, normTeam, isLeader: true }

            for (const t of rawTeams) {
                const tName = String(t.name || t.team_name || '').trim();
                if (!tName) continue;
                const normName = normalizeElimTeamName(tName);
                const lives = Number(t.lives != null ? t.lives : 50);
                const isEliminated = Boolean(t.eliminated) || lives <= 0;

                const teamObj = {
                    id: t.id || t.teamID,
                    name: tName,
                    normName,
                    lives,
                    eliminated: isEliminated,
                    participants: Number(t.participants) || 0,
                    participantsLeft: Number(t.participants_left != null ? t.participants_left : t.participants) || 0
                };
                teamsMap.set(normName, teamObj);

                if (isEliminated) {
                    eliminatedTeams.add(normName);
                } else {
                    activeTeams.add(normName);

                    // Extract verified captains and vice-captains (authoritative leaders)
                    const captainObj = t.leaders?.captain || t.captain;
                    if (captainObj) {
                        const cid = String(captainObj.id || captainObj);
                        const cName = captainObj.name || '';
                        if (cid && cid !== '0') {
                            leadersMap.set(cid, {
                                id: cid,
                                name: cName,
                                team: tName,
                                normTeam: normName,
                                isLeader: true,
                                source: 'torn_elimination',
                                competitionId: CURRENT_ELIM_COMP_ID
                            });
                        }
                    }

                    const vcs = Array.isArray(t.leaders?.vice_captains)
                        ? t.leaders.vice_captains
                        : (Array.isArray(t.vice_captains) ? t.vice_captains : []);
                    for (const vc of vcs) {
                        const vcid = String(vc.id || vc);
                        const vcName = (typeof vc.name === 'string' ? vc.name : (vc.name?.playername || '')) || '';
                        if (vcid && vcid !== '0') {
                            leadersMap.set(vcid, {
                                id: vcid,
                                name: vcName,
                                team: tName,
                                normTeam: normName,
                                isLeader: true,
                                source: 'torn_elimination',
                                competitionId: CURRENT_ELIM_COMP_ID
                            });
                        }
                    }
                }
            }

            elimState.tournament = {
                year: CURRENT_ELIM_YEAR,
                competitionId: CURRENT_ELIM_COMP_ID,
                teams: teamsMap,
                activeTeams,
                eliminatedTeams,
                leaders: leadersMap,
                fetchedAt: now
            };
            return elimState.tournament;
        }
    } catch (e) {
        console.error('[Elim Tournament] Error synchronizing 2026 event status:', e.message);
    }

    return elimState.tournament;
}

// Add and persist verified Elimination competitors into MongoDB (2026 event scoped)
async function elimAddCandidates(candidates, competitionId = CURRENT_ELIM_COMP_ID) {
    if (!Array.isArray(candidates) || candidates.length === 0) return;
    const cleanOps = [];
    for (const c of candidates) {
        const idStr = String(c.id || c._id || '').trim();
        const numId = parseInt(idStr, 10);
        const team = String(c.team || '').trim();
        const name = String(c.name || '').trim();
        const level = Number(c.level) || 0;
        const bs = Number(c.bs || c.battlestats) || 0;
        const isLeader = Boolean(c.isLeader);

        if (!isNaN(numId) && numId > 0 && team) {
            const setFields = {
                _id: numId,
                team,
                competitionId,
                tournamentYear: CURRENT_ELIM_YEAR,
                source: 'torn_elimination',
                isLeader,
                updatedAt: new Date()
            };
            if (name) setFields.name = name;
            if (level > 0) setFields.level = level;
            if (bs > 0) setFields.bs = bs;

            cleanOps.push({
                updateOne: {
                    filter: { _id: numId },
                    update: { $set: setFields },
                    upsert: true
                }
            });
        }
    }
    if (cleanOps.length > 0 && mongoose.connection.readyState === 1) {
        try {
            const col = mongoose.connection.db.collection('elim_candidates');
            await col.bulkWrite(cleanOps, { ordered: false }).catch(() => {});
        } catch (e) {}
    }
}

// Report a player in hospital (from userscript or attack screen)
app.post('/api/elim/report-hosp', (req, res) => {
    try {
        const targetId = String(req.body.targetId || req.query.targetId || '').trim();
        const minutes  = Math.min(Number(req.body.minutes || req.query.minutes || 20), 360);
        if (!targetId || targetId === '0') {
            return res.status(400).json({ error: 'targetId required' });
        }
        elimState.hospBlacklist.set(targetId, Date.now() + minutes * 60 * 1000);
        res.json({ success: true, targetId, blacklistedMinutes: minutes });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/elim/sync-roster — client sends verified opposing team members from competition.php
app.post('/api/elim/sync-roster', async (req, res) => {
    try {
        let apiKey      = (req.headers['x-api-key'] || req.body.apiKey || '').trim();
        const tornId    = (req.headers['x-torn-id'] || req.body.tornId || req.body.myId || '').trim();
        const discordId = (req.headers['x-discord-id'] || req.body.discordId || '').trim();
        const members   = req.body.members; // [{ id, name, level }]
        const teamName  = String(req.body.teamName || req.body.team || '').replace(/\s*\(\s*\d+[^)]*\)/g, '').trim();
        const myId      = String(req.body.myId || tornId || '').trim();

        if (!apiKey && tornId) {
            const resolved = userKeys.resolveUserApiKeyByTornId(tornId);
            if (resolved) apiKey = resolved.key;
        }
        if (!apiKey && discordId) {
            const resolved = userKeys.resolveUserApiKey(discordId);
            if (resolved) apiKey = resolved.key;
        }
        if (!apiKey && req.headers['x-session-token']) {
            const sess = sessionManager.getSession(req.headers['x-session-token']);
            if (sess && sess.playerId) {
                const resolved = userKeys.resolveUserApiKeyByTornId(sess.playerId);
                if (resolved) apiKey = resolved.key;
            }
        }

        if (!apiKey) {
            return res.status(401).json({
                error: 'apiKey required',
                code: 'ACCOUNT_NOT_CONNECTED',
                message: 'Please link your Torn Limited API key to sync competition rosters.'
            });
        }
        if (!teamName) {
            return res.status(400).json({
                error: 'teamName required',
                message: 'The opposing Elimination team name must be specified to sync a roster.'
            });
        }
        if (!Array.isArray(members) || members.length === 0) {
            return res.status(400).json({ error: 'members array required' });
        }

        // 1. Authoritative verification of user's active Elimination participation
        let userTeam = '';
        let ownFactionId = null;
        const ownFactionIds = new Set();
        if (myId) ownFactionIds.add(myId);

        try {
            const uRes = await fetch(
                `https://api.torn.com/v2/user/?selections=profile,competition&key=${encodeURIComponent(apiKey)}`,
                { signal: AbortSignal.timeout(6000) }
            );
            const uData = await uRes.json();
            if (uData && uData.error) {
                const errCode = uData.error.code;
                const isInvalidKey = errCode === 2 || errCode === 1 || errCode === 13;
                return res.status(400).json({
                    success: false,
                    code: isInvalidKey ? 'INVALID_API_KEY' : 'API_ERROR',
                    errorCode: errCode,
                    message: isInvalidKey
                        ? `Torn API authentication error [${errCode}: ${uData.error.error}]`
                        : userKeys.sanitizeErrorMessage(`Torn API error [${errCode}]: ${uData.error.error}`)
                });
            }

            const uComp = uData.competition;
            const uCompTeam = uComp ? String(uComp.team || uComp.team_name || '').trim() : '';
            const normUCompTeam = normalizeElimTeamName(uCompTeam);

            // HARD CHECK: A user with team="Unknown" or missing team is NOT in Elimination!
            if (!uComp || uComp.name !== 'Elimination' || !uCompTeam || normUCompTeam === 'unknown') {
                return res.status(400).json({
                    success: false,
                    code: 'NOT_IN_ELIMINATION',
                    message: 'Cannot sync roster: You are not enrolled in an active Elimination team. Join a team in the Torn competition page first.'
                });
            }

            userTeam = uCompTeam;
            const uProfile = uData.profile || uData;
            ownFactionId = uProfile.faction_id || (uProfile.faction && uProfile.faction.faction_id);

            // Fetch own faction members to ensure no faction member is ingested as an opposing candidate
            if (ownFactionId) {
                const fRes = await fetch(
                    `https://api.torn.com/faction/${ownFactionId}?selections=basic&key=${encodeURIComponent(apiKey)}`,
                    { signal: AbortSignal.timeout(4000) }
                );
                const fData = await fRes.json();
                if (fData && fData.members) {
                    Object.keys(fData.members).forEach(mid => ownFactionIds.add(String(mid)));
                }
            }
        } catch (e) {
            return res.status(500).json({ error: 'Failed to verify Torn competition status via API.' });
        }

        // 2. Validate opposing team against active 2026 Elimination teams
        const normSyncedTeam = normalizeElimTeamName(teamName);
        if (normSyncedTeam === normalizeElimTeamName(userTeam)) {
            return res.status(400).json({
                success: false,
                error: 'CANNOT_SYNC_OWN_TEAM',
                message: `Cannot sync roster for team "${teamName}": That is your own team.`
            });
        }

        const tourney = await getActiveEliminationTournament(apiKey);
        if (tourney && tourney.teams.size > 0) {
            if (!tourney.teams.has(normSyncedTeam)) {
                return res.status(400).json({
                    success: false,
                    error: 'INVALID_ELIM_TEAM',
                    message: `"${teamName}" is not a recognized team in the 2026 Elimination tournament.`
                });
            }
            if (tourney.eliminatedTeams.has(normSyncedTeam)) {
                return res.status(400).json({
                    success: false,
                    error: 'TEAM_ALREADY_ELIMINATED',
                    message: `Team "${teamName}" has already been eliminated from the 2026 tournament.`
                });
            }
        }

        // 3. Filter and sanitize opposing members (exclude faction members, self, invalid IDs)
        const validCandidates = [];
        const seen = new Set();
        members.forEach(m => {
            const id = String(m.id || m.playerId || m || '').trim();
            const level = Number(m.level) || 0;
            if (id && id !== '0' && !ownFactionIds.has(id) && !seen.has(id)) {
                seen.add(id);
                validCandidates.push({
                    id,
                    team: teamName,
                    name: m.name || '',
                    level,
                    source: 'torn_elimination',
                    competitionId: CURRENT_ELIM_COMP_ID,
                    tournamentYear: CURRENT_ELIM_YEAR
                });
            }
        });

        // 4. Store in per-user and shared roster pool (strictly scoped to CURRENT_ELIM_COMP_ID)
        const userKeyId = tornId ? `torn:${tornId}` : (discordId ? `discord:${discordId}` : `key:${crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}`);
        const existing = elimState.rosters.get(userKeyId) || (tornId ? elimState.rosters.get(String(tornId)) : null);
        const existingMembers = (existing && existing.competitionId === CURRENT_ELIM_COMP_ID) ? existing.members : [];
        const memberMap = new Map();
        existingMembers.forEach(em => memberMap.set(em.id, em));
        validCandidates.forEach(vc => memberMap.set(vc.id, vc));
        const mergedMembers = Array.from(memberMap.values());

        const rosterData = {
            members: mergedMembers,
            teamName: userTeam,
            opposingTeamName: teamName,
            competitionId: CURRENT_ELIM_COMP_ID,
            tournamentYear: CURRENT_ELIM_YEAR,
            syncedAt: Date.now()
        };

        elimState.rosters.set(userKeyId, rosterData);
        if (tornId) {
            elimState.rosters.set(String(tornId), rosterData);
            elimState.rosters.set(`torn:${tornId}`, rosterData);
        }

        // Persist to MongoDB with strictly 2026 event metadata
        elimAddCandidates(validCandidates, CURRENT_ELIM_COMP_ID).catch(() => {});

        res.json({
            success: true,
            teamName,
            memberCount: validCandidates.length,
            totalInPool: mergedMembers.length
        });
    } catch (e) {
        res.status(500).json({ error: userKeys.sanitizeErrorMessage(e.message) });
    }
});

/**
 * Reusable Core Engine: Authoritative 2026 Elimination Target Finder
 * 
 * Pipeline:
 * User -> verify user is currently in 2026 Elimination -> retrieve current 2026 Elimination data ->
 * determine legitimate target pool -> validate each candidate via Torn API v2 -> return only verified target.
 * 
 * @param {object} opts
 * @param {string} opts.apiKey - Requesting user's live Torn Limited API key
 * @param {string} opts.userId - User identifier (Discord ID or Torn ID) for isolated cooldowns
 * @param {string} opts.tier - 'easy' | 'manageable' | 'difficult' | 'all'
 * @param {Set|Array|string} opts.excludeIds - IDs to exclude from this lookup
 * @param {boolean} [opts.forceRefreshTournament=false] - Force live refresh of tournament state
 * @returns {Promise<object>}
 */
async function findElimSnipeTargetForUser({ apiKey, userId = '', tier = 'manageable', excludeIds = new Set(), forceRefreshTournament = false }) {
    if (!apiKey) {
        return {
            success: false,
            code: 'ACCOUNT_NOT_CONNECTED',
            isParticipating: false,
            targetCount: 0,
            message: 'Torn Account Not Connected. Please link your Torn Limited API key to find targets tailored to your battle stats.'
        };
    }

    elimCleanBlacklist();

    // Isolated per-user served cooldowns (30-second window per target per user)
    const userKeyId = String(userId || crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16));
    if (!elimState.servedCooldowns) {
        elimState.servedCooldowns = new Map();
    }
    let myServed = elimState.servedCooldowns.get(userKeyId);
    if (!myServed) {
        myServed = new Map();
        elimState.servedCooldowns.set(userKeyId, myServed);
    }
    const now = Date.now();
    for (const [id, exp] of myServed.entries()) {
        if (now > exp) myServed.delete(id);
    }

    const cleanTier = String(tier || 'manageable').toLowerCase().trim();
    const excludeSet = excludeIds instanceof Set
        ? excludeIds
        : new Set(Array.isArray(excludeIds) ? excludeIds : String(excludeIds).split(',').map(s => s.trim()).filter(Boolean));

    // ── 1. HARD GATE: Authoritatively verify user's Elimination participation, battle stats, and team ──
    let myId = '';
    let myStats = 0;
    let attackerName = "Attacker";
    let attackerStats = { strength: 0, speed: 0, defense: 0, dexterity: 0, total: 0 };
    let myTeam = "";
    let myFactionId = null;
    const ownFactionIds = new Set();

    try {
        const userRes = await fetch(
            `https://api.torn.com/v2/user/?selections=profile,competition,battlestats&key=${encodeURIComponent(apiKey)}`,
            { signal: AbortSignal.timeout(7000) }
        );
        const userData = await userRes.json();
        if (userData && userData.error) {
            const errCode = userData.error.code;
            const isInvalidKey = errCode === 2 || errCode === 1 || errCode === 13;
            if (isInvalidKey && userId) {
                try {
                    userKeys.unlinkUserApiKeyByTornId(userId);
                    userKeys.unlinkUserApiKey(userId);
                } catch (e) {}
            }
            return {
                success: false,
                code: isInvalidKey ? 'INVALID_API_KEY' : 'API_ERROR',
                errorCode: errCode,
                isInvalidKey,
                isParticipating: false,
                targetCount: 0,
                message: isInvalidKey
                    ? `Torn API authentication error [${errCode}: ${userData.error.error}]`
                    : userKeys.sanitizeErrorMessage(`Torn API error [${userData.error.code}]: ${userData.error.error}`)
            };
        }

        const profile = (userData && userData.profile) ? userData.profile : userData;
        const comp = userData && userData.competition;
        const bs = userData && userData.battlestats;

        if (!profile || (!profile.id && !profile.player_id)) {
            return {
                success: false,
                code: 'NETWORK_ERROR',
                isParticipating: false,
                targetCount: 0,
                message: 'Unable to verify Torn profile. Please try again.'
            };
        }

        myId = String(profile.id || profile.player_id);
        if (profile.name) attackerName = profile.name;

        // HARD PARTICIPATION VALIDATION:
        // In Torn API v2, non-participants return competition.team="Unknown" or empty.
        // A player is ONLY participating if competition.name="Elimination" AND team is a valid, non-empty, non-"Unknown" team.
        const rawUserTeam = comp ? String(comp.team || comp.team_name || '').trim() : '';
        const normUserTeam = normalizeElimTeamName(rawUserTeam);
        const isEnrolled = comp &&
            comp.name === 'Elimination' &&
            rawUserTeam !== '' &&
            normUserTeam !== 'unknown';

        if (!isEnrolled) {
            return {
                success: false,
                code: 'NOT_IN_ELIMINATION',
                isParticipating: false,
                targetCount: 0,
                message: 'You are not enrolled in an active Elimination team. Join a team in the Torn competition page to use this feature.'
            };
        }

        myTeam = rawUserTeam;

        // Parse attacker's battlestats from API v2
        if (bs) {
            attackerStats.strength = (bs.strength && typeof bs.strength.value === 'number') ? bs.strength.value : (Number(bs.strength) || 0);
            attackerStats.speed = (bs.speed && typeof bs.speed.value === 'number') ? bs.speed.value : (Number(bs.speed) || 0);
            attackerStats.defense = (bs.defense && typeof bs.defense.value === 'number') ? bs.defense.value : (Number(bs.defense) || 0);
            attackerStats.dexterity = (bs.dexterity && typeof bs.dexterity.value === 'number') ? bs.dexterity.value : (Number(bs.dexterity) || 0);
            attackerStats.total = (typeof bs.total === 'number') ? bs.total : (attackerStats.strength + attackerStats.speed + attackerStats.defense + attackerStats.dexterity);
            myStats = attackerStats.total;
        }

        // Cache and retrieve own faction members
        myFactionId = profile.faction_id || (profile.faction && profile.faction.faction_id);
        if (myFactionId) {
            const cachedFaction = elimState.factionMembersCache.get(String(myFactionId));
            if (cachedFaction && (Date.now() - cachedFaction.fetchedAt < 5 * 60 * 1000)) {
                cachedFaction.members.forEach(mid => ownFactionIds.add(String(mid)));
            } else {
                try {
                    const fRes = await fetch(
                        `https://api.torn.com/faction/${myFactionId}?selections=basic&key=${encodeURIComponent(apiKey)}`,
                        { signal: AbortSignal.timeout(4000) }
                    );
                    const fData = await fRes.json();
                    if (fData && fData.members) {
                        const mSet = new Set();
                        Object.keys(fData.members).forEach(mid => {
                            mSet.add(String(mid));
                            ownFactionIds.add(String(mid));
                        });
                        elimState.factionMembersCache.set(String(myFactionId), { members: mSet, fetchedAt: Date.now() });
                    }
                } catch (fe) {}
            }
        }
    } catch (ue) {
        return {
            success: false,
            code: 'NETWORK_ERROR',
            isParticipating: false,
            targetCount: 0,
            message: 'Unable to reach Torn API to verify attacker profile. Please try again shortly.'
        };
    }

    if (myId) ownFactionIds.add(myId);

    // ── 2. Retrieve authoritative 2026 tournament status & active opposing teams ──
    const tournament = await getActiveEliminationTournament(apiKey, forceRefreshTournament);
    const normMyTeam = normalizeElimTeamName(myTeam);

    if (tournament && tournament.teams.size > 0) {
        // Check if user's own team has been eliminated
        if (tournament.eliminatedTeams.has(normMyTeam) ||
            (tournament.teams.has(normMyTeam) && tournament.teams.get(normMyTeam).lives <= 0)) {
            return {
                success: false,
                code: 'USER_ELIMINATED',
                isParticipating: false,
                targetCount: 0,
                message: `Your Elimination team ("${myTeam}") has been eliminated from the 2026 tournament.`
            };
        }

        const activeOpponents = Array.from(tournament.activeTeams).filter(t => t !== normMyTeam);
        if (activeOpponents.length === 0) {
            return {
                success: false,
                code: 'TOURNAMENT_ENDED',
                isParticipating: true,
                targetCount: 0,
                message: 'No active opposing Elimination teams remain in the tournament.'
            };
        }
    }

    // ── 3. Assemble candidate pool strictly from verified 2026 opposing Elimination teams ──
    const candidateMeta = new Map(); // id -> { id, team, source, competitionId, isLeader, level, bs, name }

    // Source A: Official Tournament Leaders (captains & vice-captains of active opposing teams)
    if (tournament && tournament.leaders) {
        for (const [cid, leader] of tournament.leaders.entries()) {
            if (leader.normTeam !== normMyTeam && tournament.activeTeams.has(leader.normTeam)) {
                candidateMeta.set(cid, {
                    id: cid,
                    team: leader.team,
                    name: leader.name || '',
                    source: 'torn_elimination',
                    competitionId: CURRENT_ELIM_COMP_ID,
                    isLeader: true
                });
            }
        }
    }

    // Source B: Verified opposing team rosters from MongoDB (strictly 2026 event scoped)
    if (mongoose.connection.readyState === 1) {
        try {
            const elimCol = mongoose.connection.db.collection('elim_candidates');
            const docs = await elimCol.find({
                source: 'torn_elimination',
                competitionId: CURRENT_ELIM_COMP_ID,
                updatedAt: { $gte: new Date('2026-09-01') }
            }).sort({ bs: 1, level: 1 }).limit(6000).toArray();

            for (const d of docs) {
                const cid = String(d._id);
                const cNormTeam = normalizeElimTeamName(d.team);
                const isOpponent = cNormTeam !== normMyTeam && (!tournament || tournament.activeTeams.has(cNormTeam));
                if (isOpponent && !candidateMeta.has(cid)) {
                    candidateMeta.set(cid, {
                        id: cid,
                        team: d.team,
                        source: 'torn_elimination',
                        competitionId: CURRENT_ELIM_COMP_ID,
                        bs: d.bs || 0,
                        level: d.level || 0,
                        name: d.name || '',
                        isLeader: Boolean(d.isLeader)
                    });
                }
            }
        } catch (dbErr) {}
    }

    // Source C: Synced rosters from memory (strictly CURRENT_ELIM_COMP_ID and active opponents)
    for (const [rKey, rData] of elimState.rosters.entries()) {
        if (rData && rData.competitionId === CURRENT_ELIM_COMP_ID && Array.isArray(rData.members)) {
            for (const m of rData.members) {
                if (m && m.team) {
                    const cNormTeam = normalizeElimTeamName(m.team);
                    const isOpponent = cNormTeam !== normMyTeam && (!tournament || tournament.activeTeams.has(cNormTeam));
                    if (isOpponent) {
                        const cid = String(m.id || m.playerId || m);
                        if (!candidateMeta.has(cid)) {
                            candidateMeta.set(cid, {
                                id: cid,
                                team: m.team,
                                level: m.level || 0,
                                name: m.name || '',
                                source: 'torn_elimination',
                                competitionId: CURRENT_ELIM_COMP_ID
                            });
                        }
                    }
                }
            }
        }
    }

    // ── 4. Mandatory Base Safety Filter (No self, no faction members, no teammates, no non-elim) ──
    const baseEligible = Array.from(candidateMeta.values()).filter(cand => {
        const id = String(cand.id);
        if (!id || id === '0') return false;
        if (myId && id === myId) return false;                           // Never attack yourself
        if (ownFactionIds.has(id)) return false;                         // Never attack faction members
        if (normalizeElimTeamName(cand.team) === normMyTeam) return false; // Never attack elimination teammates
        if (tournament && !tournament.activeTeams.has(normalizeElimTeamName(cand.team))) return false; // Exclude eliminated teams
        if (cand.source !== 'torn_elimination') return false;            // Provenance verification
        if (elimState.nonElimBlacklist.has(id)) return false;            // Known non-participants
        return true;
    });

    if (baseEligible.length === 0) {
        console.warn(`[Elim Snipe] No candidate pool for user ${myId} (${myTeam}). Candidates in meta: ${candidateMeta.size}`);
        return {
            success: false,
            code: 'NO_VERIFIED_TARGETS',
            isParticipating: true,
            targetCount: 0,
            message: `You are enrolled in team "${myTeam}", but no opposing Elimination team rosters have been synced yet. Please visit competition.php to discover enemy teams.`
        };
    }

    // ── Progressive Fallback Filter for Local Exclusions ──
    // Pass 1: Exclude user-requested exclusions, active hospital blacklist, and recently served targets
    let pool = baseEligible.filter(cand => {
        const id = cand.id;
        if (excludeSet.has(id)) return false;
        if (elimState.hospBlacklist.has(id)) return false;
        if (myServed.has(id)) return false;
        return true;
    });

    // Pass 2: If pool empty, relax served cooldowns
    if (pool.length === 0) {
        pool = baseEligible.filter(cand => {
            const id = cand.id;
            if (excludeSet.has(id)) return false;
            if (elimState.hospBlacklist.has(id)) return false;
            return true;
        });
    }

    // Pass 3: If still empty, relax session exclusions
    if (pool.length === 0) {
        pool = baseEligible.filter(cand => {
            const id = cand.id;
            if (elimState.hospBlacklist.has(id)) return false;
            return true;
        });
    }

    // Pass 4: Fallback to all base eligible (live check will filter hospital/flying)
    if (pool.length === 0) {
        pool = baseEligible.slice();
    }

    // ── 5. Intelligent Batch Prioritization & Sorting ──
    pool.sort((a, b) => {
        const aLeader = Boolean(a.isLeader);
        const bLeader = Boolean(b.isLeader);
        if (myStats > 0 && myStats < 5_000_000) {
            if (!aLeader && bLeader) return -1;
            if (aLeader && !bLeader) return 1;
        }

        const aBs = a.bs || 0;
        const bBs = b.bs || 0;
        if (aBs > 0 && bBs > 0 && myStats > 0) {
            const idealTarget = myStats * 0.70;
            return Math.abs(aBs - idealTarget) - Math.abs(bBs - idealTarget);
        }
        if (aBs > 0 && myStats > 0) return aBs <= myStats * 1.25 ? -1 : 1;
        if (bBs > 0 && myStats > 0) return bBs <= myStats * 1.25 ? 1 : -1;

        const aLvl = a.level > 0 ? a.level : (aLeader ? 85 : 45);
        const bLvl = b.level > 0 ? b.level : (bLeader ? 85 : 45);
        return aLvl - bLvl;
    });

    const batch = pool.slice(0, 120);
    const batchIds = batch.map(b => b.id);

    // ── 6. Query FF Scouter for Battle Stat estimates ──
    const ffStats = new Map();
    try {
        const ffKey = typeof getFFScouterKey === 'function' ? getFFScouterKey() : (process.env.FFSCOUTER_KEY || apiKey);
        const ffUrl = `https://ffscouter.com/api/v1/get-stats?key=${encodeURIComponent(ffKey || apiKey)}&targets=${batchIds.join(',')}`;
        const r = await fetch(ffUrl, { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
            const d = await r.json();
            if (Array.isArray(d)) {
                d.forEach(p => {
                    const rawId = p.player_id || p.id;
                    if (!rawId) return;
                    const id = String(rawId);
                    if (!batchIds.includes(id)) return;

                    const bs = (p.bs_estimate != null && !isNaN(Number(p.bs_estimate)))
                        ? Number(p.bs_estimate) : (Number(p.battlestats) || 0);

                    let ff = null;
                    if (bs > 0 && myStats > 0) {
                        ff = parseFloat((1 + (8 / 3) * (bs / myStats)).toFixed(2));
                    } else if (p.fair_fight != null && !isNaN(Number(p.fair_fight))) {
                        ff = Number(p.fair_fight);
                    }

                    if (ff !== null || bs > 0) {
                        ffStats.set(id, { ff, bs, distribution: p.distribution });
                        if (bs > 0 && mongoose.connection.readyState === 1) {
                            try {
                                const col = mongoose.connection.db.collection('elim_candidates');
                                col.updateOne({ _id: Number(id) }, { $set: { bs, ff, lastScouted: new Date() } }).catch(() => {});
                            } catch (e) {}
                        }
                    }
                });
            }
        }
    } catch (ffe) {}

    // ── 7. Filter candidates by realistic hittability against requesting user's stats ──
    const tierPass = batch.filter(cand => {
        const id = cand.id;
        const s = ffStats.get(id);
        const bs = (s && s.bs) || cand.bs || 0;
        const lvl = cand.level || 0;

        if (bs > 0 && myStats > 0) {
            const ratio = bs / myStats;
            if (cleanTier === 'easy' && ratio > 0.85) return false;
            if (cleanTier === 'manageable' && ratio > 1.25) return false;
            if (cleanTier === 'difficult' && ratio > 1.65) return false;
            if (cleanTier === 'all' && myStats < 5_000_000 && ratio > 2.0) return false;
            if (cleanTier === 'all' && myStats >= 5_000_000 && ratio > 4.0) return false;
            return true;
        }

        if (myStats > 0) {
            if (cand.isLeader && myStats < 5_000_000) return false;
            if (cleanTier === 'easy') return lvl > 0 && lvl <= 25;
            if (cleanTier === 'manageable') return lvl === 0 || lvl <= 42;
            if (cleanTier === 'difficult') return lvl === 0 || lvl <= 48;
            if (cleanTier === 'all') return myStats >= 5_000_000 || (lvl > 0 && lvl <= 52);
        }

        return true;
    });

    if (tierPass.length === 0) {
        return {
            success: false,
            code: 'NO_TIER_MATCH',
            isParticipating: true,
            targetCount: 0,
            message: `No opposing candidates matched your Fair Fight tier (${cleanTier}) against your current stats (~${formatElimStat(myStats)}). Visit competition.php to discover more opposing rosters.`
        };
    }

    // ── 8. Candidate Scoring System ──
    const scoredCandidates = [];
    for (const cand of tierPass) {
        const targetId = cand.id;
        const s = ffStats.get(targetId) || { ff: null, bs: 0 };
        const targetBS = s.bs || cand.bs || 0;
        const targetLvl = cand.level || 0;

        let ratio = 1.0;
        if (myStats > 0 && targetBS > 0) {
            ratio = targetBS / myStats;
        } else if (targetLvl > 0) {
            const estBS = estimateStatsFromLevel(targetLvl);
            ratio = myStats > 0 ? (estBS / myStats) : 1.0;
        } else if (cand.isLeader) {
            ratio = 3.0;
        } else {
            ratio = 0.65;
        }

        const ff = s.ff != null ? s.ff : parseFloat((1 + (8 / 3) * ratio).toFixed(2));

        if (myStats > 0 && myStats < 5_000_000) {
            if (cleanTier === 'easy' && (targetBS > myStats * 0.85 || targetLvl > 25)) continue;
            if (cleanTier === 'manageable' && (targetBS > myStats * 1.25 || targetLvl > 42)) continue;
            if (cleanTier === 'difficult' && (targetBS > myStats * 1.65 || targetLvl > 48)) continue;
            if (cleanTier === 'all' && (targetBS > Math.min(2_500_000, myStats * 2.0) || targetLvl > 52)) continue;
        } else if (myStats > 0) {
            if (cleanTier !== 'all' && targetBS > myStats * 1.30) continue;
            if (cleanTier === 'all' && targetBS > myStats * 4.0) continue;
        }

        let baseScore = 50;
        let difficulty = "Manageable";
        let risk = "Medium";

        if (ratio >= 0.35 && ratio <= 0.85) {
            baseScore = 95 - Math.round(Math.abs(ratio - 0.65) * 20);
            difficulty = "Comfortably Hittable";
            risk = "Low";
        } else if (ratio < 0.35) {
            baseScore = 80 + Math.round(ratio * 25);
            difficulty = "Very Easy";
            risk = "Very Low";
        } else if (ratio > 0.85 && ratio <= 1.15) {
            baseScore = 86 - Math.round((ratio - 0.85) * 25);
            difficulty = "Competitive / Even";
            risk = "Medium";
        } else if (ratio > 1.15 && ratio <= 1.45) {
            baseScore = 68 - Math.round((ratio - 1.15) * 30);
            difficulty = "Borderline";
            risk = "Medium / High";
        } else if (ratio > 1.45 && ratio <= 1.80) {
            baseScore = 48 - Math.round((ratio - 1.45) * 35);
            difficulty = "Challenging / Risky";
            risk = "High";
        } else {
            baseScore = 15;
            difficulty = "Too Strong";
            risk = "Extreme";
        }

        if (difficulty === 'Too Strong' && cleanTier !== 'all') continue;

        // ── Retal Risk Penalty (non-blocking, uses in-memory cache) ──
        let retalRate = 0.28; // global mean fallback
        let retalTier = 'cold_start';
        try {
            const rScore = await retalEngine.getRiskScore(targetId, null);
            if (rScore) {
                retalRate = rScore.adjusted_rate || 0.28;
                retalTier = rScore.tier || 'cold_start';
            }
        } catch(e) { /* silent — never block snipe for retal engine errors */ }

        // final_score = bs_score * (1 - 0.30 * retalRate)
        // A target with 90% retal rate loses up to 27 points from base score
        const retalPenalty = Math.round(baseScore * 0.30 * retalRate);
        const score = Math.min(99, Math.max(10, baseScore - retalPenalty));

        scoredCandidates.push({
            id: targetId,
            team: cand.team,
            source: cand.source,
            competitionId: cand.competitionId,
            ff,
            bs: targetBS,
            level: targetLvl,
            ratio,
            score,
            difficulty,
            risk,
            retalRate,
            retalTier
        });
    }

    if (scoredCandidates.length === 0) {
        return {
            success: false,
            code: 'NO_TIER_MATCH',
            isParticipating: true,
            targetCount: 0,
            message: `All current opposing candidates exceed your Fair Fight tier (${cleanTier}). Please visit competition.php to sync more enemy rosters.`
        };
    }

    scoredCandidates.sort((a, b) => (b.score - a.score) || (a.ratio - b.ratio));

    // ── 9. Live Authoritative Target Verification via Torn API v2 ──
    // Every single candidate MUST authoritatively pass live Torn competition and profile checks
    let chosenTarget = null;
    let checkedCount = 0;
    let hospCount = 0;
    let flyCount = 0;
    let nonElimCount = 0;

    for (const cand of scoredCandidates.slice(0, 45)) {
        checkedCount++;
        let profData;
        try {
            const r = await fetch(
                `https://api.torn.com/v2/user/${cand.id}/?selections=profile,competition&key=${encodeURIComponent(apiKey)}`,
                { signal: AbortSignal.timeout(4500) }
            );
            profData = await r.json();
        } catch (e) {
            continue;
        }

        if (!profData || profData.error) continue;

        // CHECK 1: Live Tournament Participation & Opposing Team Verification
        const tComp = profData.competition;
        const tCompTeam = tComp ? String(tComp.team || tComp.team_name || '').trim() : '';
        const normTCompTeam = normalizeElimTeamName(tCompTeam);

        const isLiveParticipant = tComp &&
            tComp.name === 'Elimination' &&
            tCompTeam !== '' &&
            normTCompTeam !== 'unknown';

        if (!isLiveParticipant) {
            nonElimCount++;
            elimState.nonElimBlacklist.set(cand.id, Date.now() + 10 * 60 * 1000);
            continue;
        }

        // Must be on an opposing team (not user's team)
        if (normTCompTeam === normMyTeam) {
            continue;
        }

        // Must be on an active team in the 2026 tournament (not eliminated)
        if (tournament && !tournament.activeTeams.has(normTCompTeam)) {
            elimState.nonElimBlacklist.set(cand.id, Date.now() + 10 * 60 * 1000);
            continue;
        }

        // CHECK 2: Live Faction Protection
        const tProf = profData.profile || profData;
        const tFactionId = tProf.faction_id || (tProf.faction && tProf.faction.faction_id);
        if (tFactionId && myFactionId && String(tFactionId) === String(myFactionId)) {
            ownFactionIds.add(cand.id);
            continue;
        }
        if (ownFactionIds.has(cand.id)) {
            continue;
        }

        // CHECK 3: Live Attackability (Status State)
        const rawState = (tProf.status && tProf.status.state) ? String(tProf.status.state) : '';
        const state = rawState.toLowerCase();

        if (state === 'hospital') {
            hospCount++;
            const durationMins = tProf.status.until ? Math.min(2, Math.max(1, Math.ceil((tProf.status.until * 1000 - Date.now()) / 60000))) : 1;
            elimState.hospBlacklist.set(cand.id, Date.now() + durationMins * 60 * 1000);
            continue;
        }

        if (state === 'traveling' || state === 'abroad') {
            flyCount++;
            const durationMins = tProf.status.until ? Math.min(8, Math.max(2, Math.ceil((tProf.status.until * 1000 - Date.now()) / 60000))) : 4;
            elimState.hospBlacklist.set(cand.id, Date.now() + durationMins * 60 * 1000);
            continue;
        }

        if (state === 'jail' || state === 'federal') {
            elimState.hospBlacklist.set(cand.id, Date.now() + 5 * 60 * 1000);
            continue;
        }

        if (state !== 'okay') {
            elimState.hospBlacklist.set(cand.id, Date.now() + 45 * 1000);
            continue;
        }

        // CHECK 4: Whale protection guard against live level
        const liveLevel = Number(tProf.level) || cand.level || 1;
        const liveEstBS = cand.bs > 0 ? cand.bs : estimateStatsFromLevel(liveLevel);
        if (myStats > 0 && myStats < 5_000_000) {
            if (cleanTier === 'easy' && (liveEstBS > myStats * 0.85 || liveLevel > 25)) continue;
            if (cleanTier === 'manageable' && (liveEstBS > myStats * 1.25 || liveLevel > 42)) continue;
            if (cleanTier === 'difficult' && (liveEstBS > myStats * 1.65 || liveLevel > 48)) continue;
            if (cleanTier === 'all' && (liveEstBS > Math.min(2_500_000, myStats * 2.0) || liveLevel > 52)) continue;
        } else if (myStats > 0) {
            if (cleanTier === 'easy' && (liveEstBS > myStats * 0.85 || liveLevel > 25)) continue;
            if (cleanTier === 'manageable' && (liveEstBS > myStats * 1.25 || liveLevel > 45)) continue;
            if (cleanTier === 'difficult' && (liveEstBS > myStats * 1.70 || liveLevel > 65)) continue;
            if (cleanTier === 'all' && liveEstBS > myStats * 5.0 && liveLevel > 75) continue;
        }

        // Verified Live Candidate — Apply 30s per-user served cooldown
        myServed.set(cand.id, Date.now() + 30 * 1000);

        const targetBSHuman = cand.bs > 0 ? formatElimStat(cand.bs) : (liveLevel > 0 ? `~${formatElimStat(estimateStatsFromLevel(liveLevel))}` : 'Unknown');
        const attackerBSHuman = myStats > 0 ? formatElimStat(myStats) : 'Unknown';

        let bsBullet = "Fair Fight score indicates a favorable target matchup";
        if (cand.bs > 0) {
            if (cand.ratio <= 0.85) {
                bsBullet = `Battle stats (~${targetBSHuman}) are comfortably within your realistic attacking range (${attackerBSHuman})`;
            } else if (cand.ratio <= 1.25) {
                bsBullet = `Battle stats (~${targetBSHuman}) provide an even, competitive matchup against your ${attackerBSHuman}`;
            } else if (cand.ratio <= 1.65) {
                bsBullet = `Battle stats (~${targetBSHuman}) are challenging but potentially hittable against your ${attackerBSHuman}`;
            } else {
                bsBullet = `Target battle stats (~${targetBSHuman}) exceed standard range (${attackerBSHuman}) — caution advised`;
            }
        } else {
            bsBullet = `Level ${liveLevel} opponent — estimated stats (~${targetBSHuman}) match your tier profile`;
        }

        const why = [
            `Verified 2026 Elimination participant on opposing team "${tCompTeam}"`,
            "Available to attack (confirmed Okay in Torn City)",
            "Not hospitalized, flying, or jailed",
            bsBullet,
            `Scored ${cand.score}/100 (${cand.difficulty}) — ranked best among ${scoredCandidates.length} evaluated candidates`
        ];

        chosenTarget = {
            success: true,
            targetId: cand.id,
            name: tProf.name || `Player #${cand.id}`,
            level: liveLevel,
            status: "Available (Okay)",
            travel: "In Torn City (Not flying)",
            team: tCompTeam,
            attackerTeam: myTeam,
            targetBS: cand.bs || liveEstBS,
            targetBSHuman,
            attackerBS: myStats,
            attackerBSHuman,
            ff: cand.ff,
            difficulty: cand.difficulty,
            risk: cand.risk,
            score: cand.score,
            why,
            targetCount: scoredCandidates.length,
            isParticipating: true,
            attackUrl: `https://www.torn.com/page.php?sid=attack&user2ID=${cand.id}`,
            provenance: {
                source: "torn_elimination",
                competitionId: CURRENT_ELIM_COMP_ID,
                tournamentYear: CURRENT_ELIM_YEAR,
                attackerTeam: myTeam,
                targetTeam: tCompTeam,
                isEliminationParticipant: true,
                isValidOpponent: true
            }
        };
        break;
    }

    if (chosenTarget) {
        return chosenTarget;
    }

    console.info(`[Elim Snipe] Verification complete for user ${myId}. Checked: ${checkedCount}, Hosp: ${hospCount}, Flying: ${flyCount}, NonElim: ${nonElimCount}`);

    if (hospCount + flyCount === checkedCount && checkedCount > 0) {
        return {
            success: false,
            code: 'ALL_TARGETS_HOSP_FLY',
            isParticipating: true,
            targetCount: 0,
            message: `All ${checkedCount} evaluated targets on opposing teams are currently in hospital (${hospCount}) or flying (${flyCount}). Hospital times expire rapidly — try again in a few moments.`
        };
    }

    return {
        success: false,
        code: 'NO_VERIFIED_TARGETS',
        isParticipating: true,
        targetCount: 0,
        message: 'No verified Elimination targets available right now.'
    };
}

// GET /api/elim/snipe — Multi-user Elimination Target Finder endpoint
app.get('/api/elim/snipe', async (req, res) => {
    try {
        let apiKey = (req.headers['x-api-key'] || req.query.apiKey || '').replace(/[\s\r\n'"]/g, '').trim();
        const tornId = (req.headers['x-torn-id'] || req.query.tornId || req.query.myId || '').trim();
        const discordId = (req.headers['x-discord-id'] || req.query.discordId || '').trim();

        let resolvedUser = null;
        if (!apiKey && tornId) {
            resolvedUser = userKeys.resolveUserApiKeyByTornId(tornId);
            if (resolvedUser) apiKey = resolvedUser.key;
        }
        if (!apiKey && discordId) {
            resolvedUser = userKeys.resolveUserApiKey(discordId);
            if (resolvedUser) apiKey = resolvedUser.key;
        }
        if (!apiKey && req.headers['x-session-token']) {
            const sess = sessionManager.getSession(req.headers['x-session-token']);
            if (sess && sess.playerId) {
                resolvedUser = userKeys.resolveUserApiKeyByTornId(sess.playerId);
                if (resolvedUser) apiKey = resolvedUser.key;
            }
        }

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                code: 'ACCOUNT_NOT_CONNECTED',
                message: 'Torn Account Not Connected. Please link your Torn Limited API key to find targets tailored to your battle stats.'
            });
        }

        const tier = (req.query.tier || 'manageable').toLowerCase();
        const forceRefreshTournament = req.query.refresh === '1' || req.query.refreshTourney === '1';
        const excludeIds = new Set(
            (req.query.exclude || '').split(',').map(s => s.trim()).filter(Boolean)
        );
        const userId = tornId || discordId || (req.userSession ? String(req.userSession.playerId) : '') || (resolvedUser ? String(resolvedUser.playerId) : '') || '';

        const result = await findElimSnipeTargetForUser({
            apiKey,
            userId,
            tier,
            excludeIds,
            forceRefreshTournament
        });
        return res.json(result);
    } catch (err) {
        console.error('[Elim Snipe API] Error:', userKeys.sanitizeErrorMessage(err.message));
        return res.status(500).json({ success: false, error: userKeys.sanitizeErrorMessage(err.message) });
    }
});

// GET /api/user/status — Check if a Torn player ID or Discord ID has a linked API key
app.get('/api/user/status', (req, res) => {
    try {
        const identifier = (req.headers['x-torn-id'] || req.query.tornId || req.headers['x-discord-id'] || req.query.discordId || '').trim();
        if (!identifier) {
            return res.json({ connected: false, message: 'No identifier provided' });
        }
        const status = userKeys.getUserAccountStatus(identifier);
        return res.json(status);
    } catch (e) {
        return res.status(500).json({ error: userKeys.sanitizeErrorMessage(e.message) });
    }
});

// POST /api/user/link-key — Securely link an API key from Web UI or Userscript
app.post('/api/user/link-key', async (req, res) => {
    try {
        const rawKey = (req.body.apiKey || req.headers['x-api-key'] || '').replace(/[\s\r\n'"]/g, '').trim();
        const tornId = (req.body.tornId || req.headers['x-torn-id'] || '').trim();
        const discordId = (req.body.discordId || req.headers['x-discord-id'] || '').trim();

        if (!rawKey) {
            return res.status(400).json({ success: false, error: 'apiKey is required' });
        }

        if (rawKey.length < 16) {
            return res.status(400).json({ success: false, error: 'API key must be at least 16 characters' });
        }

        const result = await userKeys.linkUserApiKeyByTornId(tornId, rawKey, discordId);
        if (!result.success) {
            return res.status(400).json(result);
        }

        return res.json({
            success: true,
            playerName: result.playerName,
            playerId: result.playerId
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: userKeys.sanitizeErrorMessage(e.message) });
    }
});




// --- MULTI-TENANT DISCORD BOTS & SLASH COMMANDS ---
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, InteractionType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
            color: UI.COLORS.ERROR,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
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
                    `${UI.player(m.name, m.id)}${m.onlineStr}`
                ).join("\n"),
                inline: false
            });
        }
        if (friendlyTravel.flyingTo.length > 0) {
            fields.push({
                name: `✈️ ${friendlyName} — Flying TO ${country} (${friendlyTravel.flyingTo.length})`,
                value: friendlyTravel.flyingTo.slice(0, 15).map(m =>
                    `${UI.player(m.name, m.id)} — ${m.landingStr || "ETA unknown"}`
                ).join("\n"),
                inline: false
            });
        }
        if (friendlyTravel.flyingBack.length > 0) {
            fields.push({
                name: `🔄 ${friendlyName} — Flying BACK from ${country} (${friendlyTravel.flyingBack.length})`,
                value: friendlyTravel.flyingBack.slice(0, 15).map(m =>
                    `${UI.player(m.name, m.id)} — ${m.landingStr || "ETA unknown"}`
                ).join("\n"),
                inline: false
            });
        }

        // ── 2. ENEMY SECTION (with 1-click Attack Links) ──
        if (enemyTravel.inCountry.length > 0) {
            fields.push({
                name: `🎯 ${enemyName} — In ${country} (${enemyTravel.inCountry.length})`,
                value: enemyTravel.inCountry.slice(0, 15).map(m =>
                    `${UI.player(m.name, m.id)}${m.onlineStr} • [⚔️ Attack](https://www.torn.com/page.php?sid=attack&user2ID=${m.id})`
                ).join("\n"),
                inline: false
            });
        }
        if (enemyTravel.flyingTo.length > 0) {
            fields.push({
                name: `✈️ ${enemyName} — Flying TO ${country} (${enemyTravel.flyingTo.length})`,
                value: enemyTravel.flyingTo.slice(0, 15).map(m =>
                    `${UI.player(m.name, m.id)} — ${m.landingStr || "ETA unknown"} • [⚔️ Attack](https://www.torn.com/page.php?sid=attack&user2ID=${m.id})`
                ).join("\n"),
                inline: false
            });
        }
        if (enemyTravel.flyingBack.length > 0) {
            fields.push({
                name: `🔄 ${enemyName} — Flying BACK from ${country} (${enemyTravel.flyingBack.length})`,
                value: enemyTravel.flyingBack.slice(0, 15).map(m =>
                    `${UI.player(m.name, m.id)} — ${m.landingStr || "ETA unknown"} • [⚔️ Attack](https://www.torn.com/page.php?sid=attack&user2ID=${m.id})`
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
            color: enemyTravel.total > 0 ? UI.COLORS.BRAND : UI.COLORS.INFO,
            fields,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch (e) {
        return {
            title: `${emoji} ${country} — Travel Intel`,
            description: `⚠️ Could not fetch travel data: ${e.message}`,
            color: UI.COLORS.ERROR,
            footer: UI.FOOTER
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

// Helper: Resolve player's compact battle stats progression summary
function resolvePlayerStatsProgression(pId, discordUid) {
    if (!pId) return '📊 _Unrecorded (No /bs snapshot on file)_';
    const recKey = String(pId);
    const bRecord = (typeof battleStatsHistory !== 'undefined' && battleStatsHistory) ? battleStatsHistory[recKey] : null;

    if (bRecord && bRecord.stats && bRecord.stats.total) {
        const total = bRecord.stats.total;
        const totalStr = formatStatNumber(total);

        if (Array.isArray(bRecord.history) && bRecord.history.length > 0) {
            const earliest = bRecord.history[bRecord.history.length - 1];
            const gain = total - (earliest.total || 0);
            const days = Math.max(1, Math.round((Date.now() - (earliest.timestamp || bRecord.lastUpdated)) / 86400000));
            const pct = earliest.total > 0 ? ((gain / earliest.total) * 100).toFixed(1) : 0;

            if (gain > 0) {
                return `📊 **~${totalStr} BS** • 📈 **+${formatStatNumber(gain)}** (+${pct}%) over ${days}d`;
            } else if (gain === 0) {
                return `📊 **~${totalStr} BS** • ⏸️ Steady over ${days}d`;
            } else {
                return `📊 **~${totalStr} BS** *(Snapshot <t:${Math.floor((bRecord.lastUpdated || Date.now()) / 1000)}:R>)*`;
            }
        }

        const timeAgo = bRecord.lastUpdated ? `<t:${Math.floor(bRecord.lastUpdated / 1000)}:R>` : 'Recent';
        return `📊 **~${totalStr} BS** *(Baseline recorded ${timeAgo})*`;
    }

    if (typeof spyDatabase !== 'undefined' && spyDatabase && spyDatabase[recKey]?.total) {
        const spyTotal = spyDatabase[recKey].total;
        return `📊 **~${formatStatNumber(spyTotal)} BS** *(Scouted)*`;
    }

    if (typeof statsCache !== 'undefined' && statsCache && statsCache[recKey]?.stats) {
        const cached = statsCache[recKey].stats;
        return `📊 **~${formatStatNumber(cached)} BS** *(Estimated)*`;
    }

    return '📊 _Unrecorded (Run `/bs` to track)_';
}

async function buildWarStatusEmbed(apiKey) {
    if (!apiKey) return { title: "⚔️ Ranked War", description: "⚠️ No Torn API Key configured on server.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars,attacks&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const facData = await facRes.json();
        if (facData.error) throw new Error(facData.error.error || "Torn API error");

        const activeWar = getActiveRankedWar(facData);
        if (!activeWar || !activeWar.factions) {
            return {
                title: "⚔️ Faction Ranked War",
                description: `🕊️ **No Active Ranked War**\n\n**${facData.name || 'Your faction'}** is not currently in an active ranked war.\n\n*When your faction enters a Ranked War, live war scores, leads, progress bars, and top hitters will appear here automatically.*`,
                color: UI.COLORS.INFO,
                footer: UI.FOOTER,
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
            color: isLeading ? UI.COLORS.SUCCESS : UI.COLORS.ERROR,
            fields: [
                { name: `🏆 Top Hitters`, value: topHitters, inline: false },
                { name: "🔗 Links", value: `[📡 Live Warboard](https://torn-company-app-production.up.railway.app) • [⚔️ Attack Screen](https://www.torn.com/factions.php?step=your#/tab=war)`, inline: false }
            ],
            footer: UI.FOOTER
        };
    } catch (e) {
        return { title: "⚔️ Ranked War", description: `⚠️ Could not fetch war data: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildTargetsEmbed(apiKey) {
    if (!apiKey) {
        return {
            title: "🎯 Enemy Targets",
            description: "⚠️ No Torn API Key configured on server.",
            color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
                color: UI.COLORS.INFO,
                footer: UI.FOOTER
            };
        }

        const fids = Object.keys(activeWar.factions || {});
        const enemyId = fids.find(id => id !== facData.ID?.toString()) || discordConfig.enemyFacId;
        if (!enemyId) {
            return {
                title: "🎯 Enemy Targets",
                description: "⚠️ Could not identify enemy faction in the current war.",
                color: UI.COLORS.WARNING
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
                color: UI.COLORS.WARNING,
                footer: UI.FOOTER
            };
        }

        // Bulk-fetch retal risk scores (hits MongoDB cache, no Torn API call)
        const riskTargets = top10.map(m => ({ id: m.id, faction_id: Number(enemyId) }));
        const riskMap = await retalEngine.getRiskScoreBulk(riskTargets).catch(() => new Map());

        const lines = top10.map((m, idx) => {
            const onlineDot = m.last_action?.status === 'Online' ? '🟢' : (m.last_action?.status === 'Idle' ? '🟡' : '⚪');
            const spyTotal = spyDatabase[m.id]?.total || statsCache[m.id]?.stats || manualStats[m.id]?.stats;
            const statsStr = spyTotal
                ? `**${formatStatNumber(spyTotal)}** stats`
                : `~**${formatStatNumber(estimateStatsFromLevel(m.level))}** *(Est)*`;
            const claimTag = claims[m.id] ? ` *(🎯 Claimed: ${claims[m.id].playerName})*` : '';
            const risk = riskMap.get(Number(m.id));
            const riskTag = risk ? ` · ${retalEngine.formatRiskTag(risk)}` : '';
            return `${idx + 1}. ${onlineDot} ${UI.player(name, m.id)} — ${statsStr}${riskTag} · [⚔️](https://www.torn.com/page.php?sid=attack&user2ID=${m.id})${claimTag}`;
        });

        return {
            title: `🎯 ${data.name || 'Enemy'} — Attack Targets (${available.length} Available)`,
            description: lines.join('\n'),
            color: UI.COLORS.BRAND,
            footer: { text: 'F.R.I.D.A.Y · 🛡️ = retal risk % · 🟢 Direct 🟡 Shrunk 🟠 Faction ⚫ Cold' }
        };
    } catch (e) {
        return { title: '🎯 Enemy Targets', description: `⚠️ Could not fetch enemy roster: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildSpyEmbed(targetQuery, apiKey) {
    if (!targetQuery) return { title: "🔍 Battle Stats Lookup", description: "Please provide a Torn Player ID or Name.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
                         `• Add a manual spy via the [Live Warboard](https://torn-company-app-production.up.railway.app) → Inspect this player.\n` +
                         `• [⚔️ Attack](https://www.torn.com/page.php?sid=attack&user2ID=${targetId}) • [👤 Profile](https://www.torn.com/profiles.php?XID=${targetId})`,
            color: UI.COLORS.NEUTRAL,
            footer: UI.FOOTER
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
        color: UI.COLORS.INFO,
        fields: [
            { name: "💪 Strength", value: strVal, inline: true },
            { name: "🛡️ Defense", value: defVal, inline: true },
            { name: "⚡ Speed", value: spdVal, inline: true },
            { name: "🤸 Dexterity", value: dexVal, inline: true },
            { name: "🔗 Links", value: `[⚔️ Attack](https://www.torn.com/page.php?sid=attack&user2ID=${targetId}) • [👤 Profile](https://www.torn.com/profiles.php?XID=${targetId})`, inline: false }
        ],
        footer: UI.FOOTER
    };
}

async function buildChainStatusEmbed(apiKey) {
    if (!apiKey) return { title: "🔗 Chain", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
                color: UI.COLORS.WARNING,
                footer: UI.FOOTER
            };
        }

        if (current === 0) {
            return {
                title: `🔗 No Active Chain`,
                description: `**${data.name || 'Faction'}** has no chain running. Ready to start a new one.`,
                color: UI.COLORS.NEUTRAL,
                footer: UI.FOOTER
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
            color: isPanic ? UI.COLORS.ERROR : UI.COLORS.SUCCESS,
            fields: [
                { name: "🔗 Links", value: `[⚔️ Targets](https://www.torn.com/factions.php?step=your#/tab=war) • [📡 Live Warboard](https://torn-company-app-production.up.railway.app)`, inline: false }
            ],
            footer: UI.FOOTER
        };
    } catch (e) {
        return { title: "🔗 Chain", description: `⚠️ Could not fetch chain data: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildChainWatchEmbed(apiKey) {
    if (!apiKey) return { title: "🔗 Online Fighters", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
            color: UI.COLORS.INFO,
            footer: UI.FOOTER
        };
    } catch(e) {
        return { title: "🔗 Online Fighters", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR };
    }
}

async function buildProfileEmbed(playerQuery, apiKey) {
    if (!playerQuery || !apiKey) return { title: "👤 Player Profile", description: "Please provide a Torn Player ID or name.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
            color: data.status?.state === 'Hospital' ? UI.COLORS.ERROR : (data.status?.state === 'Traveling' ? UI.COLORS.INFO : UI.COLORS.SUCCESS),
            fields: [
                { name: "🔗 Links", value: `[👤 Profile](https://www.torn.com/profiles.php?XID=${data.player_id}) • [⚔️ Attack](https://www.torn.com/page.php?sid=attack&user2ID=${data.player_id}) • [🎯 Place Bounty](https://www.torn.com/bounties.php?p=add&XID=${data.player_id}&amount=150000)`, inline: false }
            ],
            footer: UI.FOOTER
        };
    } catch(e) {
        return { title: "👤 Player Profile", description: `⚠️ Could not fetch profile: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildHospitalEmbed(apiKey) {
    if (!apiKey) return { title: "🏥 Hospital", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
                color: UI.COLORS.SUCCESS,
                footer: UI.FOOTER
            };
        }

        inHosp.sort((a, b) => (a.status?.until || 0) - (b.status?.until || 0));

        const lines = inHosp.map((m, idx) => {
            const minsLeft = Math.max(0, Math.ceil(((m.status?.until || 0) - now) / 60));
            const desc = m.status?.description || "Hospitalized";
            return `${idx + 1}. ${UI.player(m.name, m.id)} — ⏳ **${minsLeft}m left**\n   └ *${desc}*`;

        });

        return {
            title: `🏥 ${data.name || 'Faction'} — Hospital (${inHosp.length} members)`,
            description: lines.join("\n"),
            color: UI.COLORS.WARNING,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "🏥 Hospital", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildOnlineRosterEmbed(apiKey) {
    if (!apiKey) return { title: "👥 Faction Roster", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() }; // keep title
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
            color: UI.COLORS.INFO,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "👥 Faction Roster", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildOCStatusEmbed(apiKey) {
    if (!apiKey) return { title: "💼 Organized Crimes", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
            color: ready.length > 0 ? UI.COLORS.SUCCESS : UI.COLORS.INFO,
            fields: [
                { name: "🔗 OC Manager", value: `[Open OC Manager](https://torn-company-app-production.up.railway.app/oc.html)`, inline: false }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "💼 Organized Crimes", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildMyOCEmbed(playerQuery, apiKey, callerUsername) {
    if (!apiKey) return { title: "💼 My OC", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
                color: UI.COLORS.WARNING,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
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
            color: isReady ? UI.COLORS.SUCCESS : UI.COLORS.INFO,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "💼 My OC", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

const FLIGHT_PROFILES = {
    "mex": { standard: 26, airstrip: 18, name: "Mexico", flag: "🇲🇽", yCode: "mex" },
    "cay": { standard: 35, airstrip: 25, name: "Cayman Islands", flag: "🏝️", yCode: "cay" },
    "can": { standard: 42, airstrip: 29, name: "Canada", flag: "🇨🇦", yCode: "can" },
    "haw": { standard: 134, airstrip: 94, name: "Hawaii", flag: "🌺", yCode: "haw" },
    "uni": { standard: 159, airstrip: 111, name: "United Kingdom", flag: "🇬🇧", yCode: "uni" },
    "arg": { standard: 167, airstrip: 117, name: "Argentina", flag: "🇦🇷", yCode: "arg" },
    "swi": { standard: 176, airstrip: 123, name: "Switzerland", flag: "🇨🇭", yCode: "swi" },
    "jap": { standard: 226, airstrip: 158, name: "Japan", flag: "🇯🇵", yCode: "jap" },
    "chi": { standard: 235, airstrip: 164, name: "China", flag: "🇨🇳", yCode: "chi" },
    "uae": { standard: 272, airstrip: 190, name: "UAE", flag: "🇦🇪", yCode: "uae" },
    "sou": { standard: 299, airstrip: 209, name: "South Africa", flag: "🇿🇦", yCode: "sou" }
};

function formatFlightDuration(mins) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (h > 0) return `${h}h ${m > 0 ? m + 'm' : ''}`.trim();
    return `${m}m`;
}

function resolveYataCountry(input) {
    if (!input || typeof input !== 'string') return FLIGHT_PROFILES["sou"];
    const c = input.toLowerCase().trim().replace(/[-_]/g, " ");

    if (c.includes("south") || c.includes("africa") || c === "sa" || c === "sou" || c === "za") return FLIGHT_PROFILES["sou"];
    if (c.includes("mex") || c === "mexico") return FLIGHT_PROFILES["mex"];
    if (c.includes("cayman") || c === "cay") return FLIGHT_PROFILES["cay"];
    if (c.includes("can") || c === "canada") return FLIGHT_PROFILES["can"];
    if (c.includes("haw") || c === "hawaii") return FLIGHT_PROFILES["haw"];
    if (c.includes("uk") || c.includes("united kingdom") || c.includes("london") || c.includes("britain") || c === "uni") return FLIGHT_PROFILES["uni"];
    if (c.includes("arg") || c === "argentina") return FLIGHT_PROFILES["arg"];
    if (c.includes("swi") || c.includes("switz") || c === "switzerland") return FLIGHT_PROFILES["swi"];
    if (c.includes("jap") || c === "japan") return FLIGHT_PROFILES["jap"];
    if (c.includes("chi") || c === "china") return FLIGHT_PROFILES["chi"];
    if (c.includes("uae") || c.includes("dubai")) return FLIGHT_PROFILES["uae"];

    return FLIGHT_PROFILES["sou"];
}

function getItemBurnRate(cCode, item) {
    const key = `${cCode}_${item.id}`;
    const tracked = stockVelocityTracker[key];
    if (tracked && tracked.burnRatePerMin && tracked.burnRatePerMin >= 1) {
        return tracked.burnRatePerMin;
    }
    const name = (item.name || "").toLowerCase();
    // High-demand plushies (rapid burn from overseas trading flights)
    if (name.includes("jaguar plushie")) return 26;
    if (name.includes("lion plushie")) return 22;
    if (name.includes("wolverine plushie")) return 20;
    if (name.includes("nessie plushie")) return 20;
    if (name.includes("red fox plushie")) return 18;
    if (name.includes("chamois plushie")) return 18;
    if (name.includes("monkey plushie")) return 18;
    if (name.includes("panda plushie")) return 16;
    if (name.includes("camel plushie")) return 16;
    if (name.includes("stingray plushie")) return 15;
    if (name.includes("kitten plushie")) return 12;
    if (name.includes("plushie")) return 15;

    // High-demand flowers
    if (name.includes("african violet")) return 20;
    if (name.includes("dahlia")) return 18;
    if (name.includes("cherry blossom")) return 16;
    if (name.includes("edelweiss")) return 15;
    if (name.includes("tribulus")) return 15;
    if (name.includes("crocus")) return 15;
    if (name.includes("heather")) return 14;
    if (name.includes("peony")) return 14;
    if (name.includes("banana orchid")) return 14;
    if (name.includes("ceibo")) return 12;
    if (name.includes("flower") || name.includes("orchid")) return 12;

    // Drugs
    if (name.includes("xanax")) return 15;
    if (name.includes("smoke grenade")) return 4;
    if (name.includes("lsd") || name.includes("opium") || name.includes("shrooms") || name.includes("pcp")) return 4;

    return 1.2; // Default low-demand items (armor/weapons)
}

const FALLBACK_DESTINATIONS = {
    "cay": [
        { id: 618, name: "Stingray Plushie", cost: 400, quantity: 1800 },
        { id: 617, name: "Banana Orchid", cost: 4000, quantity: 900 },
        { id: 1482, name: "Bearer Bond", cost: 86273, quantity: 4500 },
        { id: 612, name: "Tavor TAR-21", cost: 495000, quantity: 120 }
    ],
    "mex": [
        { id: 274, name: "Jaguar Plushie", cost: 10000, quantity: 2000 },
        { id: 275, name: "Dahlia", cost: 300, quantity: 3500 },
        { id: 278, name: "Short Bow", cost: 3000, quantity: 50 }
    ],
    "can": [
        { id: 261, name: "Wolverine Plushie", cost: 30, quantity: 1800 },
        { id: 262, name: "Crocus", cost: 600, quantity: 4000 }
    ],
    "haw": [
        { id: 265, name: "Tiki Statue", cost: 500, quantity: 100 },
        { id: 270, name: "Ceibo Flower", cost: 500, quantity: 2000 }
    ],
    "uni": [
        { id: 266, name: "Nessie Plushie", cost: 200, quantity: 2000 },
        { id: 268, name: "Red Fox Plushie", cost: 1000, quantity: 1500 },
        { id: 267, name: "Heather", cost: 5000, quantity: 3000 }
    ],
    "arg": [
        { id: 273, name: "Monkey Plushie", cost: 400, quantity: 1800 },
        { id: 270, name: "Ceibo Flower", cost: 500, quantity: 2500 }
    ],
    "swi": [
        { id: 269, name: "Chamois Plushie", cost: 400, quantity: 3000 },
        { id: 271, name: "Edelweiss", cost: 3000, quantity: 2000 },
        { id: 277, name: "Kitten Plushie", cost: 500, quantity: 500 }
    ],
    "jap": [
        { id: 272, name: "Stingray Plushie", cost: 400, quantity: 1500 },
        { id: 282, name: "Cherry Blossom", cost: 500, quantity: 2500 }
    ],
    "chi": [
        { id: 264, name: "Panda Plushie", cost: 400, quantity: 2000 },
        { id: 276, name: "Peony", cost: 5000, quantity: 2500 }
    ],
    "uae": [
        { id: 281, name: "Camel Plushie", cost: 14000, quantity: 1500 },
        { id: 260, name: "Tribulus Omanense", cost: 6000, quantity: 2000 }
    ],
    "sou": [
        { id: 258, name: "Lion Plushie", cost: 400, quantity: 1500 },
        { id: 263, name: "African Violet", cost: 2000, quantity: 3000 },
        { id: 206, name: "Xanax", cost: 799500, quantity: 1800 }
    ]
};

async function buildStocksEmbed(countryInput, apiKey) {
    const target = resolveYataCountry(countryInput);
    try {
        const yataData = await getLiveYataStocks();
        const yataCountry = yataData?.stocks?.[target.yCode];
        let countryStocks = yataCountry?.stocks || [];
        let isUsingFallback = false;

        if (countryStocks.length === 0 && FALLBACK_DESTINATIONS[target.yCode]) {
            countryStocks = FALLBACK_DESTINATIONS[target.yCode];
            isUsingFallback = true;
        }

        const isFromCache = cachedYataStocks && (Date.now() - lastYataFetchTime > 45000);

        if (countryStocks.length === 0) {
            return {
                title: `${target.flag} ${target.name} — Flight Stock Forecast`,
                description: `No live stock data currently reported on YATA for **${target.name}**.\n\nCheck back shortly or view live on [YATA Travel](https://yata.yt/bazaar/abroad/).`,
                color: UI.COLORS.INFO,
                fields: [
                    { name: "🔗 Travel Tools", value: `[Open Travel Calculator](https://torn-company-app-production.up.railway.app/travel.html) • [Live YATA Abroad](https://yata.yt/bazaar/abroad/)`, inline: false }
                ],
                footer: UI.FOOTER
            };
        }

        const yataUpdateSec = yataCountry?.update || 0;
        const minsSinceYataUpdate = yataUpdateSec ? Math.max(0, Math.round((Date.now() / 1000 - yataUpdateSec) / 60)) : 0;
        const yataUpdateTctStr = yataUpdateSec ? (new Date(yataUpdateSec * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' TCT') : 'Live';
        const yataAgeStr = minsSinceYataUpdate <= 0 ? 'just now' : `${minsSinceYataUpdate}m ago`;

        const flightMins = target.airstrip; // Baseline calculations on Airstrip (Private Jet)
        const landingDate = new Date(Date.now() + flightMins * 60000);
        const landingTimeStr = landingDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' TCT';

        const isPriorityItem = (name = "") => {
            const n = name.toLowerCase();
            return n.includes("plushie") || n.includes("violet") || n.includes("flower") || n.includes("xanax") || 
                   n.includes("heather") || n.includes("orchid") || n.includes("cherry") || n.includes("dahlia") || 
                   n.includes("crocus") || n.includes("edelweiss") || n.includes("peony") || n.includes("ceibo") || 
                   n.includes("tribulus");
        };

        function getItemIcon(name = "") {
            const n = name.toLowerCase();
            if (n.includes("panda")) return "🐼";
            if (n.includes("lion")) return "🦁";
            if (n.includes("jaguar")) return "🐆";
            if (n.includes("wolverine")) return "🦡";
            if (n.includes("nessie")) return "🦕";
            if (n.includes("red fox")) return "🦊";
            if (n.includes("chamois")) return "🐐";
            if (n.includes("monkey")) return "🐒";
            if (n.includes("camel")) return "🐫";
            if (n.includes("stingray")) return "🐟";
            if (n.includes("kitten")) return "🐱";
            if (n.includes("plushie")) return "🧸";
            if (n.includes("violet") || n.includes("peony") || n.includes("cherry") || n.includes("orchid") || n.includes("dahlia") || n.includes("crocus") || n.includes("edelweiss") || n.includes("flower") || n.includes("heather") || n.includes("ceibo")) return "🌸";
            if (n.includes("xanax") || n.includes("ecstasy") || n.includes("lsd") || n.includes("opium") || n.includes("pcp") || n.includes("speed") || n.includes("shrooms")) return "💊";
            return "📦";
        }

        // Restock Window & Quarter-Hour Cycle Calculator (grounded in YATA update data)
        function getEstimatedRestock(cCode, item, yataSec) {
            const now = Date.now();
            const curDate = new Date(now);
            const curMins = curDate.getUTCMinutes();
            const minsToNextQuarter = 15 - (curMins % 15);
            
            const key = `${cCode}_${item.id}`;
            const tracked = stockVelocityTracker[key];
            let zeroAgeMins = 15;
            if (tracked && tracked.zeroSinceTs) {
                zeroAgeMins = Math.round((now - tracked.zeroSinceTs) / 60000);
            } else if (yataSec) {
                zeroAgeMins = Math.max(0, Math.round((now / 1000 - yataSec) / 60));
            }

            // Torn Quarter-Hour restock cadence (:00, :15, :30, :45)
            let estMinsUntilRestock = minsToNextQuarter;
            if (zeroAgeMins < 10) {
                estMinsUntilRestock = minsToNextQuarter + 15;
            } else if (zeroAgeMins > 45) {
                estMinsUntilRestock = Math.max(2, minsToNextQuarter);
            }

            const restockDate = new Date(now + estMinsUntilRestock * 60000);
            const restockTimeStr = restockDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' TCT';

            return {
                estMinsUntilRestock,
                restockTimeStr,
                zeroAgeMins
            };
        }

        // Calculates exact flight departure timing to land right on restock
        function getFlightTimingAdvice(fMins, item, restock) {
            const now = Date.now();
            const { estMinsUntilRestock, restockTimeStr } = restock;

            // Short flight (e.g. Mexico 18m, Cayman 25m, Canada 29m)
            if (fMins < estMinsUntilRestock) {
                const waitMins = Math.max(1, estMinsUntilRestock - fMins);
                const departDate = new Date(now + waitMins * 60000);
                const departTimeStr = departDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' TCT';
                return {
                    isHold: true,
                    waitMins,
                    departTimeStr,
                    timingText: `🛫 **Takeoff Advice:** Hold departure for **~${waitMins}m** *(fly at \`${departTimeStr}\`)* to touchdown right as restock hits at \`${restockTimeStr}\`!`
                };
            }

            // Long flight (Restock hits while in the air, e.g. Switzerland 123m, China 164m, SA 209m)
            const minsAfterRestockAtTouchdown = fMins - estMinsUntilRestock;
            const burn = item.burnRate || 16;
            const expectedRestockSize = 2800; // typical foreign shop restock quantity
            const estStockLeftAtTouchdown = Math.max(0, expectedRestockSize - Math.round(burn * minsAfterRestockAtTouchdown));

            if (estStockLeftAtTouchdown > 400) {
                return {
                    isFlyNow: true,
                    estStockLeftAtTouchdown,
                    timingText: `🛫 **Takeoff Advice:** **Depart NOW!** Restocks in ~${estMinsUntilRestock}m mid-flight ➔ Est. **~${estStockLeftAtTouchdown.toLocaleString()}** fresh units waiting at landing!`
                };
            } else {
                return {
                    isRisky: true,
                    timingText: `⚠️ **Takeoff Advice:** Restocks in ~${estMinsUntilRestock}m *(at \`${restockTimeStr}\`)*, but long flight may sell out before arrival.`
                };
            }
        }

        // Calculate arrival forecast for each item
        const processed = countryStocks.map(s => {
            const qty = s.quantity || 0;
            const burnRate = getItemBurnRate(target.yCode, s);
            const estBurnedDuringFlight = Math.round(burnRate * flightMins);
            const estStockAtLanding = Math.max(0, qty - estBurnedDuringFlight);

            const key = `${target.yCode}_${s.id}`;
            const tracked = stockVelocityTracker[key];
            const isRecentlyRestocked = tracked?.lastRestockTs && (Date.now() - tracked.lastRestockTs < 7200000);
            const restockMinsAgo = isRecentlyRestocked ? Math.round((Date.now() - tracked.lastRestockTs) / 60000) : 0;

            const restockInfo = getEstimatedRestock(target.yCode, s, yataUpdateSec);
            const timing = getFlightTimingAdvice(flightMins, { ...s, burnRate }, restockInfo);

            let badge = "`🟢 Safe`";
            let forecastDetail = `Est. **~${estStockAtLanding.toLocaleString()}** waiting for you *(burn: ~${burnRate}/m)*`;

            if (qty === 0) {
                badge = "`⚪ Sold Out`";
                forecastDetail = `0 in stock · Next YATA Restock: **~${restockInfo.estMinsUntilRestock}m** *(at \`${restockInfo.restockTimeStr}\`)*`;
            } else if (estStockAtLanding <= 0) {
                const minsToDeplete = Math.max(1, Math.round(qty / burnRate));
                badge = "`🔴 Depletes`";
                forecastDetail = `Runs out in **~${formatFlightDuration(minsToDeplete)}** *(burn: ~${burnRate}/m)* · Next restock: **~${restockInfo.estMinsUntilRestock}m** *(at \`${restockInfo.restockTimeStr}\`)*`;
            } else if (estStockAtLanding < 350) {
                badge = "`🟡 Tight`";
                forecastDetail = `Est. **~${estStockAtLanding.toLocaleString()}** left at landing *(burn: ~${burnRate}/m)*`;
            }

            if (isRecentlyRestocked && qty > 0) {
                forecastDetail += ` · 🔄 *Restocked ${restockMinsAgo}m ago*`;
            }

            return {
                ...s,
                burnRate,
                estStockAtLanding,
                badge,
                forecastDetail,
                restockInfo,
                timing,
                isPriority: isPriorityItem(s.name)
            };
        });

        // Sort: Priority items (Plushies/Flowers/Xanax) first, then by quantity
        processed.sort((a, b) => {
            if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
            if ((a.estStockAtLanding > 0) !== (b.estStockAtLanding > 0)) {
                return (a.estStockAtLanding > 0) ? -1 : 1;
            }
            return (b.quantity || 0) - (a.quantity || 0);
        });

        const safeItems = processed.filter(p => p.isPriority && p.estStockAtLanding >= 350);
        const riskyItems = processed.filter(p => p.isPriority && p.quantity > 0 && p.estStockAtLanding <= 0);
        const soldOutPriority = processed.find(p => p.isPriority && p.quantity === 0);

        let verdict = "";
        if (soldOutPriority) {
            const t = soldOutPriority.timing;
            if (t && t.isHold) {
                verdict = `⏳ **Takeoff Timing:** **${soldOutPriority.name}** is sold out. Hold flight for **~${t.waitMins}m** *(depart at \`${t.departTimeStr}\`)* to catch the restock!`;
            } else if (t && t.isFlyNow) {
                verdict = `✈️ **Takeoff Timing:** **${soldOutPriority.name}** is sold out. **Depart NOW** to touchdown right after the restock hits!`;
            } else if (safeItems.length > 0) {
                verdict = `💡 **Best Pick:** **${safeItems[0].name}** (safe arrival)`;
            } else {
                verdict = `⚠️ **Alert:** **${soldOutPriority.name}** is sold out. Next restock window: ~${soldOutPriority.restockInfo.estMinsUntilRestock}m.`;
            }
        } else if (safeItems.length > 0) {
            verdict = `💡 **Best Pick:** **${safeItems[0].name}** (safe arrival)`;
            if (riskyItems.length > 0) {
                verdict += ` · ⚠️ Avoid **${riskyItems[0].name}** (will sell out)`;
            }
        } else if (riskyItems.length > 0) {
            verdict = `⚠️ **Warning:** Top items are predicted to sell out before touchdown.`;
        } else {
            verdict = `ℹ️ Stocks are currently lean. Waiting for restock.`;
        }

        const primaryItems = processed.filter(p => p.isPriority);
        const secondaryItems = processed.filter(p => !p.isPriority && p.quantity > 0).slice(0, 3);

        const primaryCards = primaryItems.map(s => {
            const icon = getItemIcon(s.name);
            const costStr = s.cost ? ` · \`$${s.cost.toLocaleString()}\`` : '';
            const qtyNote = s.quantity > 0 ? ` *(now: ${s.quantity.toLocaleString()})*` : '';
            if (s.quantity === 0 && s.timing) {
                return `**${icon} ${s.name}**${costStr}\n> ${s.badge} ${s.forecastDetail}\n> ${s.timing.timingText}`;
            }
            return `**${icon} ${s.name}**${costStr}\n> ${s.badge} ${s.forecastDetail}${qtyNote}`;
        });

        let secondarySection = "";
        if (secondaryItems.length > 0) {
            const secLines = secondaryItems.map(s => {
                const icon = getItemIcon(s.name);
                const estStr = s.estStockAtLanding > 0 ? `~${s.estStockAtLanding.toLocaleString()} left` : `will sell out`;
                return `• ${icon} **${s.name}**: ${s.quantity.toLocaleString()} in stock ➔ ${s.badge} *(${estStr})*`;
            });
            secondarySection = `\n**📦 Other Overseas Goods:**\n` + secLines.join('\n');
        }

        const cacheNote = isFromCache ? ` • (Cached ${Math.round((Date.now() - lastYataFetchTime) / 1000)}s ago)` : '';

        const description = [
            `> ✈️ **Flight:** \`${formatFlightDuration(target.airstrip)}\` *(Jet)* · \`${formatFlightDuration(target.standard)}\` *(Std)* ➔ **Landing:** \`~${landingTimeStr}\``,
            `> 📡 **YATA Sync:** Verified **${yataAgeStr}** *(at \`${yataUpdateTctStr}\`)*`,
            `> ${verdict}`,
            ``,
            `**🧸 Plushies & Flowers Arrival Forecast:**`,
            primaryCards.join('\n\n'),
            secondarySection
        ].filter(Boolean).join('\n');

        return {
            title: `${target.flag} ${target.name} — Flight Stock & Arrival Forecast`,
            description: description,
            color: safeItems.length > 0 ? UI.COLORS.SUCCESS : (riskyItems.length > 0 ? UI.COLORS.WARNING : UI.COLORS.ECONOMY),
            fields: [
                { name: "🔗 Travel Calculator", value: `[Open Travel Calculator](https://torn-company-app-production.up.railway.app/travel.html) • [Live YATA Abroad](https://yata.yt/bazaar/abroad/)`, inline: false }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return {
            title: `${target.flag} ${target.name} — Flight Stock Forecast`,
            description: `⚠️ YATA stock feed is currently slow or busy.\n\nYou can view real-time stocks directly on [YATA Travel Abroad](https://yata.yt/bazaar/abroad/) or use the [Travel Calculator](https://torn-company-app-production.up.railway.app/travel.html).`,
            color: UI.COLORS.WARNING,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
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
    if (!itemQuery || !apiKey) return { title: "🛒 Bazaar Price Check", description: "Please enter an item name.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
                color: UI.COLORS.WARNING, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
            color: UI.COLORS.ECONOMY,
            fields,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "🛒 Bazaar Price Check", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildFactionStatsRosterEmbed(factionChoice = 'enemy', apiKey) {
    if (!apiKey) return { title: "📊 Faction Battle Stats", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    try {
        const choice = String(factionChoice || '').toLowerCase().trim();
        let isEnemy = (choice !== 'friendly' && choice !== 'our' && choice !== 'ours' && !choice.includes('friendly') && !choice.includes('our'));

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
                    color: UI.COLORS.INFO,
                    footer: UI.FOOTER,
                    timestamp: new Date().toISOString()
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
                return `${numBadge} ${statusDot}${UI.player(m.name, m.id)} (Lvl ${m.level}) ➔ **${m.statsFormatted}**${stateBadge} • [⚔️ Attack](https://www.torn.com/page.php?sid=attack&user2ID=${m.id})`;
            } else {
                return `${numBadge} ${statusDot}${UI.player(m.name, m.id)} (Lvl ${m.level}) ➔ **${m.statsFormatted}**${stateBadge}`;
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
            color: isEnemy ? UI.COLORS.BRAND : UI.COLORS.INFO,
            fields,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "📊 Battle Stats", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildWarBountiesEmbed(apiKey) {
    if (!apiKey) return { title: "🎯 War Bounties", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const facData = await facRes.json();
        
        let activeWar = getActiveRankedWar(facData);
        if (!activeWar || !activeWar.war) {
            return {
                title: "🎯 War Bounties",
                description: `🕊️ **No Active Ranked War**\n\n**${facData.name || 'Your faction'}** is not currently in an active ranked war.\n\n*War bounties placed on enemies are tracked in real-time during Ranked Wars.*`,
                color: UI.COLORS.INFO,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
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
            color: UI.COLORS.BRAND,
            fields,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "🎯 War Bounties", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildInactiveMembersEmbed(apiKey) {
    if (!apiKey) return { title: "💤 Inactive Members", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
                color: UI.COLORS.SUCCESS,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
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
            color: UI.COLORS.WARNING,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "💤 Inactive Members", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildDonatorStatusEmbed(playerQuery, apiKey) {
    if (!apiKey) return { title: "⭐️ Donator Status", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
        const color = isDonator ? UI.COLORS.SUCCESS : UI.COLORS.NEUTRAL;

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
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "⭐️ Donator Status", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
} 

async function buildWarFlightsEmbed(apiKey, ffKey) {
    if (!apiKey) return { title: "✈️ War Flights", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const facData = await facRes.json();
        if (facData.error) throw new Error(facData.error.error || "Torn API error");

        const activeWar = getActiveRankedWar(facData);
        if (!activeWar || !activeWar.war) {
            return {
                title: "✈️ War Flights Radar",
                description: `🕊️ **No Active Ranked War**\n\n**${facData.name || 'Your faction'}** is not currently in an active ranked war.\n\n*Live flight radar, ghosting detection, and overseas restock telemetry activate automatically during Ranked Wars.*`,
                color: UI.COLORS.INFO,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
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
                color: UI.COLORS.INFO,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
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
            color: auditData.kpis.totalFarmedHits > 20 ? UI.COLORS.WARNING : UI.COLORS.SUCCESS,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch (e) {
        return { title: "✈️ War Flights", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildPayoutEmbed(memberQuery, apiKey) {
    if (!apiKey) return { title: "💰 War Payouts", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
                    color: UI.COLORS.WARNING, footer: UI.FOOTER, timestamp: new Date().toISOString() };
            }
            const totalEarned = matched.hits * cpm;
            return {
                title: `💰 ${matched.name} [${matched.id}]`,
                description: `**War Hits**: **${matched.hits.toLocaleString()}**\n` +
                             `**Score**: **${matched.score.toFixed(1)}** pts\n` +
                             `**Rate**: **$${cpm.toLocaleString()}** / hit\n\n` +
                             `**Owed**: **$${totalEarned.toLocaleString()}**`,
                color: UI.COLORS.ECONOMY,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
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
            color: UI.COLORS.ECONOMY,
            fields: [
                { name: "🔗 Payout Dashboard", value: `[Open Web Payout Manager](https://torn-company-app-production.up.railway.app/payout.html)`, inline: false }
            ],
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "💰 War Payouts", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildTopHittersEmbed(apiKey) {
    if (!apiKey) return { title: "🏆 War Leaderboard", description: "⚠️ No Torn API key configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars,attacks&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const data = await facRes.json();
        if (data.error) throw new Error(data.error.error || "Torn API error");

        const activeWar = getActiveRankedWar(data);
        if (!activeWar || !activeWar.factions) {
            return {
                title: "🏆 War MVP & Top Hitters",
                description: `🕊️ **No Active Ranked War**\n\n**${data.name || 'Your faction'}** is not currently in an active ranked war.\n\n*Live attack leaderboards, MVP scores, and assist tracking will populate here during Ranked Wars.*`,
                color: UI.COLORS.INFO,
                footer: UI.FOOTER,
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
                color: UI.COLORS.NEUTRAL,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
            };
        }

        const top10 = memberList.slice(0, 10);
        const lines = top10.map((m, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**#${idx + 1}**`;
            const assistStr = m.assists > 0 ? ` · ${m.assists} assists` : '';
            const scoreStr = m.score > 0 ? ` · ${m.score.toFixed(1)} pts` : '';
            return `${medal} ${UI.player(m.name, m.id)}\n   └ **${m.attacks.toLocaleString()} war hits**${scoreStr}${assistStr}`;

        }).join("\n\n");

        return {
            title: `🏆 ${data.name || 'Faction'} — War Leaderboard`,
            description: `**Total hits**: **${totalHits.toLocaleString()}** across **${memberList.length}** fighters\n` +
                         (ourScore > 0 ? `**Faction score**: **${ourScore.toLocaleString()}** pts\n\n` : '\n') +
                         lines,
            color: UI.COLORS.BRAND,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "🏆 War Leaderboard", description: `⚠️ Error: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
                        const chan = slashCommandBot.channels.cache.get(req.channelId)
                            || await slashCommandBot.channels.fetch(req.channelId).catch(() => null);
                        if (chan) {
                            const msg = await chan.messages.fetch(req.messageId).catch(() => null);
                            if (msg) {
                                await msg.edit({
                                    embeds: [sanitizeEmbed(buildBankRequestEmbed(req))],
                                    components: buildBankRequestButtons(req)
                                }).catch(() => {});
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
                        const chan = slashCommandBot.channels.cache.get(req.channelId)
                            || await slashCommandBot.channels.fetch(req.channelId).catch(() => null);
                        if (chan) {
                            const msg = await chan.messages.fetch(req.messageId).catch(() => null);
                            if (msg) {
                                await msg.edit({
                                    embeds: [sanitizeEmbed(buildBankRequestEmbed(req))],
                                    components: buildBankRequestButtons(req)
                                }).catch(() => {});
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

    let color = UI.COLORS.ECONOMY;
    let statusLine = `⏳ Awaiting banker — requested <t:${Math.floor(req.timestamp / 1000)}:R>`;
    let titlePrefix = '⏳';

    if (req.status === 'verifying') {
        color = UI.COLORS.WARNING;
        titlePrefix = '🔄';
        const payerMention = req.fulfilledBy ? `<@${req.fulfilledBy}>` : `@${req.fulfillerName || 'Banker'}`;
        statusLine = `🔄 **Payment in progress by ${payerMention}** (clicked "Give Cash" <t:${Math.floor((req.fulfilledAt || req.timestamp) / 1000)}:R>)\nChecking faction transfer logs... auto-confirms when sent in Torn.`;
    } else if (req.status === 'fulfilled') {
        color = UI.COLORS.SUCCESS;
        titlePrefix = '✅';
        let fulfillerStr = "";
        let fulfillerDisplay = null;
        if (req.fulfilledBy) {
            fulfillerStr = `by <@${req.fulfilledBy}>`;
            fulfillerDisplay = `<@${req.fulfilledBy}>`;
        } else if (req.fulfillerName && req.fulfillerName !== 'Banker') {
            const idPart = req.fulfillerId ? ` [${req.fulfillerId}]` : '';
            const linkPart = req.fulfillerId 
                ? `[**${req.fulfillerName}**${idPart}](https://www.torn.com/profiles.php?XID=${req.fulfillerId})`
                : `**${req.fulfillerName}**`;
            fulfillerStr = `by ${linkPart} *(via Torn Logs)*`;
            fulfillerDisplay = linkPart;
        } else {
            fulfillerStr = `via Torn Faction Logs`;
        }
        const timeRef = req.fulfilledAt || req.verifiedAt || req.timestamp || Date.now();
        statusLine = `✅ **Fulfilled** ${fulfillerStr} — <t:${Math.floor(timeRef / 1000)}:R>`;
    } else if (req.status === 'cancelled') {
        color = UI.COLORS.NEUTRAL;
        titlePrefix = '❌';
        const cancellerStr = req.cancelledBy && req.cancelledBy !== 'system'
            ? `<@${req.cancelledBy}>` : (req.cancellerName || 'System');
        statusLine = `❌ **Cancelled** by ${cancellerStr} — <t:${Math.floor(req.cancelledAt / 1000)}:R>`;
    } else if (req.status === 'expired') {
        color = UI.COLORS.NEUTRAL;
        titlePrefix = '⏱️';
        statusLine = `⏱️ **Timed out** after 60 minutes (auto-cancelled)`;
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

    if (req.status === 'verifying' && (req.fulfilledBy || req.fulfillerName)) {
        fields.push({
            name: '🏦 Fulfilling Banker',
            value: req.fulfilledBy ? `<@${req.fulfilledBy}>` : `@${req.fulfillerName}`,
            inline: true
        });
    }

    if (req.status === 'fulfilled') {
        let val = null;
        if (req.fulfilledBy) {
            val = `<@${req.fulfilledBy}>`;
        } else if (req.fulfillerName && req.fulfillerName !== 'Banker') {
            val = req.fulfillerId 
                ? `[**${req.fulfillerName} [${req.fulfillerId}]**](https://www.torn.com/profiles.php?XID=${req.fulfillerId})`
                : `**${req.fulfillerName}**`;
        }
        if (val) {
            fields.push({
                name: '🏦 Fulfilled By',
                value: val,
                inline: true
            });
        }
    }

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
            badge = `✈️ Traveling / Abroad (${req.memberStatus.description || 'Abroad'})`;
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
        footer: UI.FOOTER,
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
    const appBaseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : 'https://torn-company-app-production.up.railway.app';
    const payUrl = `${appBaseUrl}/api/bank/pay/${req.id}`;

    if (req.status === 'pending') {
        // Stacked vertically: each button in its own ActionRow
        return [
            { type: 1, components: [
                {
                    type: 2,
                    style: 5, // Direct 1-Click Vault (Claims in Discord & opens Torn Vault prefilled)
                    label: `💸 Direct Give ($${amtFmt})`,
                    url: payUrl
                }
            ]},
            { type: 1, components: [
                {
                    type: 2,
                    style: 4, // Red (Danger) - cancels the entire request
                    custom_id: `bank_cancel_${req.id}`,
                    label: '❌ Cancel'
                }
            ]}
        ];
    } else if (req.status === 'verifying') {
        // Stacked vertically: each button in its own ActionRow
        const fulfillerLabel = req.fulfillerName ? `@${req.fulfillerName}` : 'Banker';
        return [
            { type: 1, components: [
                {
                    type: 2,
                    style: 2, // Grey (Secondary) - disabled indicator
                    custom_id: `bank_claimed_${req.id}`,
                    label: `🔒 In Progress by ${fulfillerLabel}`.slice(0, 80),
                    disabled: true
                }
            ]},
            { type: 1, components: [
                {
                    type: 2,
                    style: 5, // Link — opens Torn faction vault directly
                    label: `💸 Open Vault ($${amtFmt})`,
                    url: vaultUrl
                }
            ]},
            { type: 1, components: [
                {
                    type: 2,
                    style: 1, // Primary (Blue) — Manual instant log verification check
                    custom_id: `bank_check_${req.id}`,
                    label: '🔄 Check Logs'
                }
            ]},
            { type: 1, components: [
                {
                    type: 2,
                    style: 2, // Grey (Secondary) — Cancel Fulfillment only (release claim)
                    custom_id: `bank_unclaim_${req.id}`,
                    label: '↩️ Unclaim'
                }
            ]},
            { type: 1, components: [
                {
                    type: 2,
                    style: 4, // Red (Danger) — Cancel entire Request
                    custom_id: `bank_cancel_${req.id}`,
                    label: '❌ Cancel'
                }
            ]}
        ];
    } else {
        // fulfilled, cancelled, expired — NO buttons at all (clean card)
        return [];
    }
}

let cachedFactionVault = { facId: null, data: null, timestamp: 0 };

async function getFactionVaultAndMember(apiKey, interaction = null, targetQuery = null, forceFresh = false) {
    if (!apiKey) throw new Error("No Torn API key configured.");
    const facId = discordConfig.factionId || dynamicFactionId || 52355;
    const url = `https://api.torn.com/faction/${facId}?selections=basic,donations&key=${apiKey}`;

    let data = null;
    if (!forceFresh && cachedFactionVault.data && String(cachedFactionVault.facId) === String(facId) && (Date.now() - cachedFactionVault.timestamp < 10000)) {
        data = cachedFactionVault.data;
    } else {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        data = await res.json();
        if (data && !data.error) {
            cachedFactionVault = { facId: String(facId), data, timestamp: Date.now() };
        }
    }

    if (data && data.error) throw new Error(data.error.error || "Torn API error");

    const donations = data?.donations || {};
    const members = data?.members || {};
    let targetId = null;
    let targetDonor = null;
    let targetMember = null;
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (targetQuery) {
        const cleanQuery = String(targetQuery).trim().toLowerCase();
        const numeric = cleanQuery.replace(/[^0-9]/g, '');
        if (numeric && (donations[numeric] || members[numeric])) {
            targetId = numeric;
        } else {
            const nQuery = norm(cleanQuery);
            for (const [mId, mInfo] of Object.entries(members)) {
                const mName = (mInfo.name || '').toLowerCase();
                const nName = norm(mName);
                if (mName === cleanQuery || (nQuery && (nName === nQuery || nName.includes(nQuery) || nQuery.includes(nName)))) {
                    targetId = mId;
                    break;
                }
            }
            if (!targetId) {
                for (const [dId, dInfo] of Object.entries(donations)) {
                    const dName = (dInfo.name || '').toLowerCase();
                    const nName = norm(dName);
                    if (dName === cleanQuery || (nQuery && (nName === nQuery || nName.includes(nQuery) || nQuery.includes(nName)))) {
                        targetId = dId;
                        break;
                    }
                }
            }
        }
    } else if (interaction) {
        const discordUserId = interaction.user?.id;

        // 1. Direct check in verified mapping (persisted in-memory + disk/mongo)
        if (discordUserId && verifiedDiscordToTorn[discordUserId]) {
            const entry = verifiedDiscordToTorn[discordUserId];
            const candidateId = typeof entry === 'object' ? String(entry.tornId) : String(entry);
            if (candidateId) {
                targetId = candidateId;
            }
        }

        // 2. Check userKeys vault for this Discord user
        if (!targetId && discordUserId && typeof userKeys !== 'undefined' && userKeys.getUserAccountStatus) {
            try {
                const acct = userKeys.getUserAccountStatus(discordUserId);
                if (acct && acct.connected && acct.playerId) {
                    targetId = String(acct.playerId);
                }
            } catch(e) {}
        }

        // 3. Known Admin / Server Owner fast-track (Owen: 992561850057240578 -> 3776908)
        if (!targetId && discordUserId) {
            if (discordUserId === '992561850057240578' || (discordConfig.personalDiscordId && discordUserId === discordConfig.personalDiscordId)) {
                targetId = '3776908';
            }
        }

        // 4. Nickname / Display Name bracket check [123456] or (123456)
        if (!targetId) {
            const candidateNames = [
                interaction.member?.nickname,
                interaction.member?.displayName,
                interaction.user?.globalName,
                interaction.user?.username
            ].filter(Boolean);

            for (const nameStr of candidateNames) {
                const matchId = nameStr.match(/\[(\d{3,10})\]|\((\d{3,10})\)/);
                if (matchId) {
                    const foundId = matchId[1] || matchId[2];
                    if (foundId) {
                        targetId = foundId;
                        break;
                    }
                }
            }
        }

        // 5. Official Torn Discord Link API Check (v2 and v1 fallback)
        if (!targetId && discordUserId && apiKey) {
            try {
                const v2Res = await fetch(`https://api.torn.com/v2/user/${discordUserId}/discord?key=${apiKey}`, { signal: AbortSignal.timeout(5000) });
                const v2Data = await v2Res.json();
                const matchedTornId = v2Data?.discord?.user_id || v2Data?.user_id || v2Data?.discord?.player_id || v2Data?.player_id || v2Data?.userID;
                if (matchedTornId) {
                    targetId = String(matchedTornId);
                }
            } catch(e) {}

            if (!targetId) {
                try {
                    const v1Res = await fetch(`https://api.torn.com/user/${discordUserId}?selections=profile,discord&key=${apiKey}`, { signal: AbortSignal.timeout(5000) });
                    const v1Data = await v1Res.json();
                    if (v1Data && !v1Data.error && v1Data.player_id) {
                        targetId = String(v1Data.player_id);
                    }
                } catch(e) {}
            }
        }

        // 6. Smart Normalized Name Matching (Zero Punctuation / Emoji / Suffix Sensitivity)
        if (!targetId) {
            const candidateStrings = [
                interaction.member?.nickname,
                interaction.member?.displayName,
                interaction.user?.globalName,
                interaction.user?.username
            ].filter(Boolean);

            for (const rawStr of candidateStrings) {
                const cleaned = rawStr.replace(/\[\d+\]|\(\d+\)/g, '').trim();
                const nCandidate = norm(cleaned);
                if (!nCandidate || nCandidate.length < 2) continue;

                // Check exact normalized match in members
                for (const [mId, mInfo] of Object.entries(members)) {
                    const nMName = norm(mInfo.name);
                    if (nMName && (nCandidate === nMName || nCandidate.includes(nMName) || nMName.includes(nCandidate))) {
                        targetId = mId;
                        break;
                    }
                }
                if (targetId) break;

                // Check exact normalized match in donations
                for (const [dId, dInfo] of Object.entries(donations)) {
                    const nDName = norm(dInfo.name);
                    if (nDName && (nCandidate === nDName || nCandidate.includes(nDName) || nDName.includes(nCandidate))) {
                        targetId = dId;
                        break;
                    }
                }
                if (targetId) break;
            }
        }

        // Auto-cache to verifiedDiscordToTorn when resolved
        if (targetId && discordUserId) {
            const resolvedName = members[targetId]?.name || donations[targetId]?.name || interaction.user?.username || null;
            verifiedDiscordToTorn[discordUserId] = {
                tornId: String(targetId),
                tornName: resolvedName,
                timestamp: Date.now()
            };
            if (typeof saveVerifiedDiscordUsers === 'function') {
                saveVerifiedDiscordUsers();
            }
        }
    }

    if (targetId) {
        targetDonor = donations[targetId] || null;
        targetMember = members[targetId] || null;
    }

    const totalBalance = targetDonor ? Number(targetDonor.money_balance || 0) : 0;
    const pointsBalance = targetDonor ? Number(targetDonor.points_balance || 0) : 0;
    const tornName = targetMember?.name || targetDonor?.name || (interaction?.user?.id && verifiedDiscordToTorn[interaction.user.id]?.tornName) || interaction?.user?.username || null;

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
            color: UI.COLORS.NEUTRAL,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
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
        color: UI.COLORS.ECONOMY,
        footer: UI.FOOTER,
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
                        let bankerFromNews = null;
                        let bankerIdFromNews = null;
                        if (newsResult.status === 'fulfilled' && newsResult.value && !newsResult.value.error) {
                            const allItems = [
                                ...Object.values(newsResult.value.fundsnews || {}),
                                ...Object.values(newsResult.value.mainnews || {})
                            ];
                            for (const entry of allItems) {
                                if (!entry || !entry.news) continue;
                                const raw = String(entry.news);
                                if (raw.toLowerCase().includes(targetId) || (targetName && raw.toLowerCase().includes(targetName))) {
                                    const pLinks = [];
                                    const re = /<a[^>]*XID\s*=\s*(\d+)[^>]*>([^<]+)<\/a>/gi;
                                    let m;
                                    while ((m = re.exec(raw)) !== null) {
                                        pLinks.push({ id: m[1], name: m[2].trim() });
                                    }
                                    if (pLinks.length > 0) {
                                        const other = pLinks.find(p => p.id !== targetId);
                                        if (other) {
                                            bankerFromNews = other.name;
                                            bankerIdFromNews = other.id;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        return {
                            verified: true,
                            source: "donations_drop",
                            currentBal,
                            balanceBefore: req.balanceBefore,
                            detail: `Vault balance dropped from $${req.balanceBefore.toLocaleString()} to $${currentBal.toLocaleString()}`,
                            bankerName: bankerFromNews,
                            bankerId: bankerIdFromNews
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
                        let bankerIdFromLog = null;
                        const playerLinks = [];
                        const linkRegex = /<a[^>]*XID\s*=\s*(\d+)[^>]*>([^<]+)<\/a>/gi;
                        let m;
                        while ((m = linkRegex.exec(newsRaw)) !== null) {
                            playerLinks.push({ id: m[1], name: m[2].trim() });
                        }
                        if (playerLinks.length > 0) {
                            const other = playerLinks.find(p => p.id !== targetId);
                            if (other) {
                                bankerFromLog = other.name;
                                bankerIdFromLog = other.id;
                            } else {
                                bankerFromLog = playerLinks[0].name;
                                bankerIdFromLog = playerLinks[0].id;
                            }
                        } else {
                            const giverMatch = newsRaw.match(/([A-Za-z0-9_\-]+)\s*(?:gave|transferred|sent|paid)/i);
                            if (giverMatch) bankerFromLog = giverMatch[1];
                        }

                        return {
                            verified: true,
                            source: "news",
                            entry: newsRaw,
                            bankerName: bankerFromLog,
                            bankerId: bankerIdFromLog
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
                    let bankerId = null;
                    const playerLinks = [];
                    const linkRegex = /<a[^>]*XID\s*=\s*(\d+)[^>]*>([^<]+)<\/a>/gi;
                    let m;
                    while ((m = linkRegex.exec(newsRaw)) !== null) {
                        playerLinks.push({ id: m[1], name: m[2].trim() });
                    }
                    if (playerLinks.length > 0) {
                        const other = playerLinks.find(p => p.id !== tId);
                        if (other) {
                            bankerName = other.name;
                            bankerId = other.id;
                        } else {
                            bankerName = playerLinks[0].name;
                            bankerId = playerLinks[0].id;
                        }
                    } else {
                        const giverMatch = newsRaw.match(/([A-Za-z0-9_\-]+)\s*(?:gave|transferred|sent|paid)/i);
                        if (giverMatch) bankerName = giverMatch[1];
                    }

                    relevantNews.push({ entry, newsLower, newsRaw, bankerName, bankerId, ts: entry.timestamp });
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
                        const logMatch = relevantNews.find(n => !usedNewsEntries.has(n.entry));
                        if (logMatch) {
                            usedNewsEntries.add(logMatch.entry);
                            if (!r.fulfillerName && logMatch.bankerName) {
                                r.fulfillerName = logMatch.bankerName;
                                r.fulfillerId = logMatch.bankerId;
                            }
                        }
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
                        const logMatch = relevantNews.find(n => !usedNewsEntries.has(n.entry));
                        if (logMatch) {
                            usedNewsEntries.add(logMatch.entry);
                            if (!exactReq.fulfillerName && logMatch.bankerName) {
                                exactReq.fulfillerName = logMatch.bankerName;
                                exactReq.fulfillerId = logMatch.bankerId;
                            }
                        }
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
                                const logMatch = relevantNews.find(n => !usedNewsEntries.has(n.entry));
                                if (logMatch) {
                                    usedNewsEntries.add(logMatch.entry);
                                    if (!r.fulfillerName && logMatch.bankerName) {
                                        r.fulfillerName = logMatch.bankerName;
                                        r.fulfillerId = logMatch.bankerId;
                                    }
                                }
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
                        r.fulfillerId = matchingLog.bankerId;
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
let isCheckingOc = false;

async function checkFactionOrganizedCrimes() {
    if (isCheckingOc) return;
    if (global.isNotificationsKilled) return;

    const botToken = discordConfig.globalBotToken;
    const channelId = ocConfig.globalChannelId || discordConfig.ocChannelId || discordConfig.globalChannelId;
    if (!botToken || !channelId) return;

    const apiKey = discordConfig.apiKey || discordConfig.ffKey || TORN_API_KEY || getNextApiKey();
    if (!apiKey) return;

    isCheckingOc = true;
    try {
        const myFacId = String(discordConfig.factionId || dynamicFactionId || "52355");
        const res = await fetch(`https://api.torn.com/faction/${myFacId}?selections=crimes,basic&key=${apiKey}&timestamp=${Date.now()}`, {
            signal: AbortSignal.timeout(9000)
        });
        const data = await res.json();
        if (!data || data.error || !data.crimes) return;
        if (data.ID && String(data.ID) !== myFacId) return;

        const now = Math.floor(Date.now() / 1000);
        const mention = ocConfig.roleId ? `<@&${ocConfig.roleId}>` : "";
        const upcomingSec = (ocConfig.upcomingMinutes || 30) * 60;
        const activeOcMemberIds = new Set();
        let trackerChanged = false;
        let memoryChanged = false;
        let historyChanged = false;

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

                if (crime.initiated === 0) {
                    activeOcMemberIds.add(pId);
                    if (ocMemberHistory[pId] !== now) {
                        ocMemberHistory[pId] = now;
                        historyChanged = true;
                    }
                } else if (crime.initiated === 1 && crime.time_completed) {
                    const newTs = Math.max(ocMemberHistory[pId] || 0, crime.time_completed);
                    if (ocMemberHistory[pId] !== newTs) {
                        ocMemberHistory[pId] = newTs;
                        historyChanged = true;
                    }
                }

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
                // Only alert if scheduled recently (within 45 minutes)
                if (crime.time_started && (now - crime.time_started < 2700)) {
                    tracker.planned = true;
                    trackerChanged = true;
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
                        color: UI.COLORS.INFO,
                        footer: UI.FOOTER,
                        timestamp: new Date().toISOString()
                    }, mention).catch(() => {});
                } else {
                    tracker.planned = true;
                    trackerChanged = true;
                }
            }

            const timeLeft = crime.time_left !== undefined ? crime.time_left : (crime.time_ready ? (crime.time_ready - now) : 9999);

            // ── TRIGGER 2A: OC 4-Hour Countdown Ping ───────────────────────────
            const isFourHours = timeLeft > 7200 && timeLeft <= 14400; // between 2h (7200s) and 4h (14400s)
            if (crime.initiated === 0 && isFourHours && !tracker.countdown4h && (ocConfig.alertCountdown4h !== false)) {
                tracker.countdown4h = true;
                trackerChanged = true;

                // Resolve Discord Snowflakes for participants
                const participantDiscordData = [];
                for (const p of participantDetails) {
                    try {
                        const dId = await getDiscordId(p.id);
                        participantDiscordData.push({ ...p, discordId: dId });
                    } catch(e) {
                        participantDiscordData.push({ ...p, discordId: null });
                    }
                }

                const pingsList = participantDiscordData.filter(p => p.discordId).map(p => `<@${p.discordId}>`);
                const pingText = pingsList.length > 0 ? pingsList.join(' ') : mention;

                const rosterWithPings = participantDiscordData.map(p => {
                    const tag = p.discordId ? ` (<@${p.discordId}>)` : '';
                    let statusBadge = '🟢 Available in Torn City';
                    if (p.state.toLowerCase() !== 'okay') {
                        const untilStr = p.until ? ` · Free <t:${p.until}:R>` : '';
                        statusBadge = `⚠️ **${p.state}** (${p.desc}${untilStr})`;
                    }
                    return `• **[${p.name} [${p.id}]](https://www.torn.com/profiles.php?XID=${p.id})**${tag} — ${statusBadge}`;
                }).join('\n') || pListMarkdown;

                const embed4h = {
                    title: `⏰ OC 4-Hour Countdown: ${crime.crime_name}`,
                    description: `The Organized Crime **${crime.crime_name}** is scheduled to become ready in **~4 hours**!\n\n` +
                                 `🎯 **Ready Time:** <t:${crime.time_ready}:F> (<t:${crime.time_ready}:R>)\n\n` +
                                 `⚠️ **Attention Team Members:**\n` +
                                 `• **Stay in Torn City:** Avoid international flights that will not return in time.\n` +
                                 `• **Stay Out of Hospital / Jail:** Avoid risky attacks and keep life topped up.\n` +
                                 `• **Equipment Check:** Ensure any necessary OC items are equipped or borrowed from the armory.\n\n` +
                                 `**Assigned Roster:**\n${rosterWithPings}\n\n` +
                                 `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                    color: UI.COLORS.INFO,
                    footer: UI.FOOTER,
                    timestamp: new Date().toISOString()
                };

                await sendChannelMessage(botToken, channelId, embed4h, pingText).catch(() => {});

                // DM each participant individually
                for (const p of participantDiscordData) {
                    if (p.discordId) {
                        const dmEmbed = {
                            title: `⏰ 4-Hour OC Reminder: ${crime.crime_name}`,
                            description: `Hello **${p.name}**,\n\n` +
                                         `Your Organized Crime **${crime.crime_name}** is scheduled to become ready in **~4 hours**!\n\n` +
                                         `🎯 **Scheduled Launch:** <t:${crime.time_ready}:F> (<t:${crime.time_ready}:R>)\n\n` +
                                         `Please plan ahead: remain in Torn City, avoid traveling overseas, and stay out of hospital.\n\n` +
                                         `👉 [Open Faction Crimes Tab](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                            color: UI.COLORS.INFO,
                            footer: UI.FOOTER,
                            timestamp: new Date().toISOString()
                        };
                        sendDirectMessageToUser(p.discordId, dmEmbed).catch(() => {});
                    }
                }
            } else if (crime.initiated === 0 && timeLeft <= 7200 && !tracker.countdown4h) {
                tracker.countdown4h = true;
                trackerChanged = true;
            }

            // ── TRIGGER 2B: OC 2-Hour Countdown Ping ───────────────────────────
            const isTwoHours = timeLeft > upcomingSec && timeLeft <= 7200; // between upcomingSec (30m) and 2h (7200s)
            if (crime.initiated === 0 && isTwoHours && !tracker.countdown2h && (ocConfig.alertCountdown2h !== false)) {
                tracker.countdown2h = true;
                trackerChanged = true;

                // Resolve Discord Snowflakes for participants
                const participantDiscordData = [];
                for (const p of participantDetails) {
                    try {
                        const dId = await getDiscordId(p.id);
                        participantDiscordData.push({ ...p, discordId: dId });
                    } catch(e) {
                        participantDiscordData.push({ ...p, discordId: null });
                    }
                }

                const pingsList = participantDiscordData.filter(p => p.discordId).map(p => `<@${p.discordId}>`);
                const pingText = pingsList.length > 0 ? pingsList.join(' ') : mention;

                const rosterWithPings = participantDiscordData.map(p => {
                    const tag = p.discordId ? ` (<@${p.discordId}>)` : '';
                    let statusBadge = '🟢 Available in Torn City';
                    if (p.state.toLowerCase() !== 'okay') {
                        const untilStr = p.until ? ` · Free <t:${p.until}:R>` : '';
                        statusBadge = `⚠️ **${p.state}** (${p.desc}${untilStr})`;
                    }
                    return `• **[${p.name} [${p.id}]](https://www.torn.com/profiles.php?XID=${p.id})**${tag} — ${statusBadge}`;
                }).join('\n') || pListMarkdown;

                const embed2h = {
                    title: `🚨 OC 2-Hour Urgent Alert: ${crime.crime_name}`,
                    description: `Organized Crime **${crime.crime_name}** launches in **~2 hours**!\n\n` +
                                 `🎯 **Ready Time:** <t:${crime.time_ready}:F> (<t:${crime.time_ready}:R>)\n\n` +
                                 `🚨 **CRITICAL INSTRUCTIONS FOR PARTICIPANTS:**\n` +
                                 `• **DO NOT FLY:** Most flights take over 2 hours round trip. Stay in Torn City!\n` +
                                 `• **STAY OUT OF HOSPITAL:** Avoid initiating fights or taking unnecessary damage.\n` +
                                 `• **BE ACTIVE AT LAUNCH:** The crime will be initiated the moment the timer hits zero.\n\n` +
                                 `**Assigned Roster:**\n${rosterWithPings}\n\n` +
                                 `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                    color: UI.COLORS.WARNING,
                    footer: UI.FOOTER,
                    timestamp: new Date().toISOString()
                };

                await sendChannelMessage(botToken, channelId, embed2h, pingText).catch(() => {});

                // DM each participant individually
                for (const p of participantDiscordData) {
                    if (p.discordId) {
                        const dmEmbed = {
                            title: `🚨 Final 2-Hour OC Alert: ${crime.crime_name}`,
                            description: `Hello **${p.name}**,\n\n` +
                                         `Your Organized Crime **${crime.crime_name}** is scheduled to launch in **~2 hours**!\n\n` +
                                         `🎯 **Scheduled Launch:** <t:${crime.time_ready}:F> (<t:${crime.time_ready}:R>)\n\n` +
                                         `🚨 **Do not leave Torn City or take flights**, and ensure you stay out of hospital. Your team needs you present at launch!\n\n` +
                                         `👉 [Open Faction Crimes Tab](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                            color: UI.COLORS.WARNING,
                            footer: UI.FOOTER,
                            timestamp: new Date().toISOString()
                        };
                        sendDirectMessageToUser(p.discordId, dmEmbed).catch(() => {});
                    }
                }
            } else if (crime.initiated === 0 && timeLeft <= upcomingSec && !tracker.countdown2h) {
                tracker.countdown2h = true;
                trackerChanged = true;
            }

            // ── TRIGGER 2: OC Upcoming ─────────────────────────────────────────
            if (crime.initiated === 0 && timeLeft > 0 && timeLeft <= upcomingSec && !tracker.upcoming && (ocConfig.alertUpcoming !== false)) {
                tracker.upcoming = true;
                trackerChanged = true;
                await sendChannelMessage(botToken, channelId, {
                    title: `⏳ OC Upcoming: ${crime.crime_name}`,
                    description: `Crime is scheduled to become ready in **<t:${crime.time_ready}:R>** (<t:${crime.time_ready}:t>)!\n\n` +
                                 `⚠️ **Attention Team Members:** Please stay out of hospital, avoid traveling, and remain in Torn City:\n` +
                                 `${pListMarkdown}\n\n` +
                                 `👉 [View Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                    color: UI.COLORS.WARNING,
                    footer: UI.FOOTER,
                    timestamp: new Date().toISOString()
                }, mention).catch(() => {});
            }

            // ── TRIGGER 3 & 4: OC Ready vs OC Delayed ──────────────────────────
            const isReadyTime = (crime.time_ready && now >= crime.time_ready) || crime.time_left === 0 || crime.ready === 1;
            // Ignore crimes that became ready more than 12 hours ago to prevent stale alerts on restarts
            const isStaleReady = crime.time_ready && (now - crime.time_ready > 43200);

            if (crime.initiated === 0 && isReadyTime && !isStaleReady) {
                if (unavailableMembers.length > 0) {
                    // Delayed: Participants holding up team!
                    if (!tracker.delayed && (ocConfig.alertDelayed !== false)) {
                        tracker.delayed = true;
                        trackerChanged = true;
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
                            color: UI.COLORS.ERROR,
                            footer: UI.FOOTER,
                            timestamp: new Date().toISOString()
                        }, mention).catch(() => {});
                    }
                } else {
                    // Ready: All team members present and clear!
                    if (!tracker.ready && (ocConfig.alertReady !== false)) {
                        tracker.ready = true;
                        trackerChanged = true;
                        await sendChannelMessage(botToken, channelId, {
                            title: `🟢 OC Ready to Launch: ${crime.crime_name}`,
                            description: `All team members are in Torn City and available! Planner can initiate the crime now.\n\n` +
                                         `**Team:**\n${pListMarkdown}\n\n` +
                                         `👉 [Initiate Organized Crime](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                            color: UI.COLORS.SUCCESS,
                            footer: UI.FOOTER,
                            timestamp: new Date().toISOString()
                        }, mention).catch(() => {});
                    }
                }
            } else if (isStaleReady) {
                if (!tracker.ready || !tracker.delayed) {
                    tracker.ready = true;
                    tracker.delayed = true;
                    trackerChanged = true;
                }
            }

            // ── TRIGGER 5: OC Completed / Outcome Report ───────────────────────
            if (crime.initiated === 1 && (crime.time_completed > 0 || crime.success !== undefined) && !tracker.completed && (ocConfig.alertCompleted !== false)) {
                if (crime.time_completed && (now - crime.time_completed < 1800)) {
                    tracker.completed = true;
                    trackerChanged = true;
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
                        color: isSuccess ? UI.COLORS.SUCCESS : UI.COLORS.ERROR,
                        footer: UI.FOOTER,
                        timestamp: new Date().toISOString()
                    }, mention).catch(() => {});
                } else {
                    tracker.completed = true;
                    trackerChanged = true;
                }
            }
        }

        // ── TRIGGER 6 & 7: Missing Required Items & Low CPR Alerts (v2 API) ───────
        const fid = discordConfig.factionId || "52355";
        let v2Data = null;
        try {
            const v2Res = await fetch(`https://api.torn.com/v2/faction/${fid}/crimes?cat=available&key=${apiKey}&timestamp=${Date.now()}`, {
                signal: AbortSignal.timeout(9000)
            });
            v2Data = await v2Res.json();
        } catch(e) {}

        if (v2Data && v2Data.crimes && Array.isArray(v2Data.crimes)) {
            for (const v2Crime of v2Data.crimes) {
                const diffLvl = v2Crime.difficulty || 1;
                const minCpr = (ocConfig.lowCprLevels && ocConfig.lowCprLevels[diffLvl] !== undefined)
                    ? Number(ocConfig.lowCprLevels[diffLvl])
                    : (Number(ocConfig.lowCprDefaultThreshold) || 30);

                for (const slot of (v2Crime.slots || [])) {
                    if (!slot.user) continue;
                    const pId = slot.user.id;
                    const pName = members[String(pId)]?.name || slot.user.name || `Player [${pId}]`;
                    const roleLabel = slot.position_info?.label || slot.position || "Team Member";
                    const profileUrl = `https://www.torn.com/profiles.php?XID=${pId}`;

                    // Mark player as active in an OC
                    activeOcMemberIds.add(String(pId));
                    if (ocMemberHistory[String(pId)] !== now) {
                        ocMemberHistory[String(pId)] = now;
                        historyChanged = true;
                    }

                    // Trigger 6: Missing Required Items Check (At most ONCE per crime per item)
                    if (ocConfig.alertMissingItems !== false && slot.item_requirement && !slot.item_requirement.is_available) {
                        const itemId = slot.item_requirement.id;
                        const itemInfo = await getTornItemInfo(itemId, apiKey);
                        const itemName = itemInfo.name || `Item #${itemId}`;
                        const armoryUrl = `https://www.torn.com/factions.php?step=your&type=1&autoItem=${encodeURIComponent(itemName)}&autoUser=${encodeURIComponent(pName)}&autoUserId=${pId}&autoAction=loan#/tab=armoury&start=0&sub=utilities`;

                        const trackingId = `item_${v2Crime.id}_${pId}_${itemId}`;
                        if (!ocMemory[trackingId]) {
                            ocMemory[trackingId] = Date.now();
                            memoryChanged = true;
                            await sendChannelMessage(botToken, channelId, {
                                title: `🚨 OC Issue: ${v2Crime.name}`,
                                description: `**Player:** [${pName}](${profileUrl})\n` +
                                             `**Role:** ${roleLabel}\n` +
                                             `**Item Needed:** ${itemName}\n` +
                                             `**Armory:** [Give / Loan on Torn](${armoryUrl})`,
                                color: UI.COLORS.ERROR,
                                footer: UI.FOOTER,
                                timestamp: new Date().toISOString()
                            }, mention).catch(() => {});
                        }
                    }

                    // Trigger 7: Low CPR (Crime Pass Rate) Alert (At most ONCE per crime per player)
                    if (ocConfig.alertLowCpr !== false && slot.checkpoint_pass_rate !== undefined && slot.checkpoint_pass_rate !== null) {
                        const passRate = Number(slot.checkpoint_pass_rate);
                        if (passRate < minCpr) {
                            const trackingId = `lowcpr_${v2Crime.id}_${pId}`;
                            if (!ocMemory[trackingId]) {
                                ocMemory[trackingId] = Date.now();
                                memoryChanged = true;

                                // Resolve player's Discord ID if available
                                let playerDiscordId = null;
                                try {
                                    playerDiscordId = await getDiscordId(pId);
                                } catch(e) {}

                                const playerMention = playerDiscordId ? `<@${playerDiscordId}>` : "";
                                const channelMention = playerMention ? (mention ? `${mention} ${playerMention}` : playerMention) : mention;

                                const lowCprEmbed = {
                                    title: `⚠️ Low CPR in OC: ${v2Crime.name}`,
                                    description: `**[${pName}](${profileUrl})** [${pId}] joined role **${roleLabel}** in **${v2Crime.name}** (Difficulty Level **${diffLvl}**), but only has **${passRate}% CPR**.\n\n` +
                                                 `🎯 **Recommended Minimum:** **${minCpr}%** for Level ${diffLvl}\n` +
                                                 `⚠️ This significantly lowers the team's chance of completing the crime.\n\n` +
                                                 `👉 [Review Organized Crimes](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                                    color: UI.COLORS.ERROR,
                                    footer: UI.FOOTER,
                                    timestamp: new Date().toISOString()
                                };
                                await sendChannelMessage(botToken, channelId, lowCprEmbed, channelMention).catch(() => {});

                                // 1. Direct Message the Player who joined with Low CPR
                                if (ocConfig.dmPlayerOnLowCpr !== false && playerDiscordId) {
                                    const playerDmEmbed = {
                                        title: `⚠️ Organized Crime Notice: Low CPR Rating`,
                                        description: `Hello **${pName}**,\n\n` +
                                                     `You recently joined the role **${roleLabel}** in **${v2Crime.name}** (Difficulty Level **${diffLvl}**).\n\n` +
                                                     `⚠️ Your current Crime Pass Rate for this role is **${passRate}%**, but the faction minimum requirement is **${minCpr}% CPR**.\n\n` +
                                                     `**Why this matters:**\n` +
                                                     `• Lower CPR significantly increases the risk of the entire crime failing.\n` +
                                                     `• If a crime fails, team members are jailed or hospitalized and faction respect/money is lost.\n` +
                                                     `• OC leadership may remove members who do not meet the minimum CPR rating.\n\n` +
                                                     `**Recommended Action:**\n` +
                                                     `Please switch to an OC role where your CPR meets or exceeds the requirement, or practice lower-level crimes first to build up your CPR.\n\n` +
                                                     `👉 [Manage Your Organized Crimes on Torn](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                                        color: UI.COLORS.WARNING,
                                        fields: [
                                            { name: "Crime", value: v2Crime.name, inline: true },
                                            { name: "Your Assigned Role", value: roleLabel, inline: true },
                                            { name: "CPR vs Requirement", value: `⚠️ **${passRate}%** (Required: **${minCpr}%**)`, inline: true }
                                        ],
                                        footer: UI.FOOTER,
                                        timestamp: new Date().toISOString()
                                    };
                                    sendDirectMessageToUser(playerDiscordId, playerDmEmbed).catch(e => {
                                        console.warn(`[OC Alert] Failed to DM player ${pId} (${pName}):`, e?.message);
                                    });
                                }

                                // 2. Direct Message OC Managers
                                if (ocConfig.dmOcManagersOnLowCpr !== false) {
                                    getOcManagerDiscordUserIds().then(managerIds => {
                                        if (managerIds && managerIds.length > 0) {
                                            const dmEmbed = {
                                                ...lowCprEmbed,
                                                title: `🚨 [OC Manager Alert] Low CPR: ${v2Crime.name}`,
                                                fields: [
                                                    { name: "Player", value: `**[${pName}](${profileUrl})** [${pId}]`, inline: true },
                                                    { name: "Crime / Slot", value: `${v2Crime.name} (${roleLabel})`, inline: true },
                                                    { name: "CPR vs Requirement", value: `⚠️ **${passRate}%** (Min: **${minCpr}%**)`, inline: true }
                                                ]
                                            };
                                            for (const mId of managerIds) {
                                                sendDirectMessageToUser(mId, dmEmbed).catch(e => {
                                                    console.warn(`[OC Alert] Failed to DM manager ${mId}:`, e?.message);
                                                });
                                            }
                                        }
                                    }).catch(err => console.warn('[OC Alert] Failed to resolve OC managers for DM:', err?.message));
                                }
                            }
                        }
                    }
                }
            }
        }

        // ── TRIGGER 8: No OC Participation for 1 Day (24 Hours) ──────────
        if (ocConfig.alertNoParticipation !== false && members && Object.keys(members).length > 0) {
            const thresholdDays = Math.max(0.1, Number(ocConfig.noParticipationDays) || 1);
            const thresholdSec = thresholdDays * 86400;

            for (const [mId, member] of Object.entries(members)) {
                // Skip recruits (in Torn, recruits cannot join or participate in Organized Crimes)
                const position = String(member.position || '').trim().toLowerCase();
                if (position.includes('recruit') || position.includes('trial') || position.includes('probation')) continue;

                // In Torn, new faction members have an initial 72-hour (3-day) cooldown where they cannot participate in OCs
                if (member.days_in_faction !== undefined && member.days_in_faction < Math.max(3, thresholdDays)) continue;

                // Skip fallen / deleted members
                const state = (member.status?.state || '').toLowerCase();
                if (state === 'fallen') continue;

                // If currently assigned in an active OC, they are active!
                if (activeOcMemberIds.has(String(mId)) || activeOcMemberIds.has(Number(mId))) {
                    continue;
                }

                const lastOcTs = ocMemberHistory[String(mId)] || 0;
                const secSinceLastOc = now - lastOcTs;

                if (secSinceLastOc >= thresholdSec) {
                    const trackingId = `no_oc_${mId}`;
                    // Alert at most once per 24 hours per member until they join an OC
                    if (!ocMemory[trackingId] || (Date.now() - ocMemory[trackingId]) > 86400000) {
                        ocMemory[trackingId] = Date.now();
                        memoryChanged = true;

                        const inactiveHours = Math.floor(secSinceLastOc / 3600);
                        const daysText = lastOcTs > 0
                            ? `${(secSinceLastOc / 86400).toFixed(1)} days (${inactiveHours} hours)`
                            : `over ${thresholdDays} day(s) (no recent OCs)`;

                        const pName = member.name || `Player [${mId}]`;
                        const profileUrl = `https://www.torn.com/profiles.php?XID=${mId}`;
                        const memberStatus = member.status?.description || member.status?.state || member.last_action?.status || 'Offline';

                        console.log(`[OC Watcher] ⏳ Alerting for ${pName} [${mId}] missing from OC for ${daysText}`);
                        await sendChannelMessage(botToken, channelId, {
                            title: `⏳ Member Missing from OC: ${pName}`,
                            description: `**[${pName}](${profileUrl})** [${mId}] has not been in an Organized Crime for **${daysText}**.\n\n` +
                                         `🎖️ **Position:** ${member.position || 'Member'} (Lvl ${member.level || '—'})\n` +
                                         `📊 **Status:** ${memberStatus}\n` +
                                         `🕒 **Last Action:** ${member.last_action?.relative || 'Recently'}\n\n` +
                                         `👉 [Assign to an OC on Torn](https://www.torn.com/factions.php?step=your#/tab=crimes)`,
                            color: UI.COLORS.WARNING,
                            footer: UI.FOOTER,
                            timestamp: new Date().toISOString()
                        }, mention).catch(() => {});
                    }
                }
            }
        }

        // Batch persist state changes once after all triggers to prevent event loop saturation
        if (trackerChanged) saveOcAlertTracker();
        if (memoryChanged) saveOcMemory();
        if (historyChanged) saveOcMemberHistory(ocMemberHistory);
    } catch(err) {
        // Transient API errors ignored
    } finally {
        isCheckingOc = false;
    }
}

setInterval(checkFactionOrganizedCrimes, 180000); // 3 minutes (conserves bandwidth while preserving prompt alerts)
setTimeout(checkFactionOrganizedCrimes, 90000); // First fire 90s after startup (staggered from other watchers)

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

    // Prevent anyone else from claiming if already in progress by another banker
    if (req.status === 'verifying' && req.fulfilledBy && req.fulfilledBy !== interaction.user.id) {
        return { success: false, message: `⚠️ <@${req.fulfilledBy}> has already clicked Give Cash for this request and is currently fulfilling it!` };
    }

    const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
    const amtFmt = Number(req.amount).toLocaleString();
    const prefilledUrl = getPreFilledVaultUrl(req.tornId, req.amount);

    // Set fulfilledBy & fulfilledAt BEFORE checking logs so the log cutoff is accurate
    req.fulfilledBy = interaction.user.id;
    req.fulfillerName = interaction.user.username;
    req.fulfilledAt = Date.now();

    const check = await checkFactionLogForPayment(req, apiKey);

    if (check.verified) {
        req.status = 'fulfilled';
        req.verifiedAt = Date.now();
        saveBankRequests();

        if ((!interaction || !interaction.message) && req.channelId && req.messageId) {
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

    // Not verified yet — transition to verifying state, update public message immediately
    req.status = 'verifying';
    saveBankRequests();

    if ((!interaction || !interaction.message) && req.channelId && req.messageId) {
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

    return {
        success: true,
        verified: false,
        message: `💸 **You claimed Vault Request #${req.id} ($${amtFmt}) for ${req.tornName || req.userName}!**\n\n` +
                 `1. Click here to open the Torn Vault with pre-filled recipient and amount:\n` +
                 `👉 **[💸 Open Pre-filled Vault in Torn ($${amtFmt})](${prefilledUrl})**\n\n` +
                 `2. Complete the cash transfer in Torn.\n\n` +
                 `• The bot is watching faction logs and will **automatically mark this fulfilled** once Torn registers the transfer (up to 5 minutes).\n` +
                 `• If you need to cancel this fulfillment, click **"↩️ Cancel Fulfillment (Unclaim)"** on the message to release it for another banker.`
    };
}

async function executeUnclaimFulfillment(reqId, interaction) {
    const req = bankRequests[reqId];
    if (!req) {
        return { success: false, message: "⚠️ Bank request not found or expired." };
    }

    if (req.status !== 'verifying') {
        if (req.status === 'pending') {
            return { success: false, message: `⚠️ Request **#${reqId}** is already open and not currently claimed.` };
        } else {
            return { success: false, message: `⚠️ Request **#${reqId}** cannot be unclaimed because it is already **${req.status}**.` };
        }
    }

    const isClaimer = (interaction.user.id === req.fulfilledBy);
    const isBankerOrAdmin = (!discordConfig.bankerRoleId) ||
        (interaction.member?.roles?.cache?.has(discordConfig.bankerRoleId)) ||
        (interaction.member?.permissions?.has?.('Administrator'));

    if (!isClaimer && !isBankerOrAdmin) {
        return { 
            success: false, 
            message: `⚠️ Only <@${req.fulfilledBy}> (who clicked Give Cash) or a banker/admin can cancel this fulfillment.` 
        };
    }

    req.status = 'pending';
    req.fulfilledBy = null;
    req.fulfillerName = null;
    req.fulfilledAt = null;
    saveBankRequests();

    if ((!interaction || !interaction.message) && req.channelId && req.messageId) {
        try {
            const targetChan = interaction.client.channels.cache.get(req.channelId)
                || await interaction.client.channels.fetch(req.channelId).catch(() => null);
            if (targetChan) {
                const targetMsg = await targetChan.messages.fetch(req.messageId).catch(() => null);
                if (targetMsg) {
                    await targetMsg.edit({
                        embeds: [sanitizeEmbed(buildBankRequestEmbed(req))],
                        components: buildBankRequestButtons(req)
                    }).catch(() => {});
                }
            }
        } catch(e) {}
    }

    return { 
        success: true, 
        message: `↩️ **Fulfillment cancelled.** You stepped down from Request **#${reqId}**. It is now released and open for any banker to fulfill.` 
    };
}

async function executeCancelRequest(reqId, interaction = null) {
    const req = bankRequests[reqId];
    if (!req) {
        return { success: false, message: "⚠️ Bank request not found or expired." };
    }

    const isRequester = (interaction?.user?.id === req.userId);
    const isBankerOrAdmin = (!discordConfig.bankerRoleId) ||
        (interaction?.member?.roles?.cache?.has(discordConfig.bankerRoleId)) ||
        (interaction?.member?.permissions?.has?.('Administrator'));
    if (!isRequester && !isBankerOrAdmin) {
        return { success: false, message: `⚠️ Only <@${req.userId}> (the requester) or a banker/admin can cancel this request.` };
    }

    if (req.status !== 'pending' && req.status !== 'verifying') {
        return { success: false, message: `⚠️ Request **#${reqId}** is already ${req.status}.` };
    }

    req.status = 'cancelled';
    req.cancelledBy = interaction?.user?.id || 'system';
    req.cancellerName = interaction?.user?.username || 'System';
    req.cancelledAt = Date.now();
    saveBankRequests();

    const updatedEmbed = buildBankRequestEmbed(req);
    const updatedButtons = buildBankRequestButtons(req);

    if ((!interaction || !interaction.message) && req.channelId && req.messageId) {
        try {
            const client = interaction?.client || slashCommandBot;
            if (client) {
                const targetChan = client.channels.cache.get(req.channelId)
                    || await client.channels.fetch(req.channelId).catch(() => null);
                if (targetChan) {
                    const targetMsg = await targetChan.messages.fetch(req.messageId).catch(() => null);
                    if (targetMsg) {
                        await targetMsg.edit({
                            embeds: [sanitizeEmbed(updatedEmbed)],
                            components: updatedButtons
                        }).catch(() => {});
                    }
                }
            }
        } catch(e) {}
    }

    return { success: true, message: `❌ **Request #${reqId} has been cancelled (voided).** The withdrawal request is closed.` };
}

// ── 1-Click Direct Torn Vault Fulfillment Redirect ──────────────────────────
app.get('/api/bank/pay/:id', async (req, res) => {
    const reqId = String(req.params.id || '').trim();
    const bankReq = bankRequests[reqId];
    if (!bankReq) {
        return res.redirect('https://www.torn.com/factions.php');
    }

    if (bankReq.status === 'fulfilled' || bankReq.status === 'cancelled') {
        return res.redirect('https://www.torn.com/factions.php');
    }

    const prefilledUrl = getPreFilledVaultUrl(bankReq.tornId, bankReq.amount);

    if (bankReq.status === 'pending') {
        bankReq.status = 'verifying';
        bankReq.fulfilledAt = Date.now();
        saveBankRequests();

        if (bankReq.channelId && bankReq.messageId && slashCommandBot?.isReady?.()) {
            try {
                const targetChan = slashCommandBot.channels.cache.get(bankReq.channelId)
                    || await slashCommandBot.channels.fetch(bankReq.channelId).catch(() => null);
                if (targetChan) {
                    const targetMsg = await targetChan.messages.fetch(bankReq.messageId).catch(() => null);
                    if (targetMsg) {
                        await targetMsg.edit({
                            embeds: [sanitizeEmbed(buildBankRequestEmbed(bankReq))],
                            components: buildBankRequestButtons(bankReq)
                        }).catch(() => {});
                    }
                }
            } catch(e) {}
        }

        const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
        const botInstance = slashCommandBot?.isReady?.() ? slashCommandBot : null;
        if (apiKey && botInstance) {
            verifyBankPayment(bankReq, apiKey, botInstance).catch(() => {});
        }
    }

    return res.redirect(302, prefilledUrl);
});

async function buildVaultBalanceEmbed(apiKey, targetQuery = null, requestingUser = null) {
    if (!apiKey) {
        return { title: "🏦 Faction Vault Balance", description: "⚠️ Torn API Key is not configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
    try {
        const facId = discordConfig.factionId || dynamicFactionId || 52355;
        const url = `https://api.torn.com/faction/${facId}?selections=basic,donations&key=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();

        if (data.error) {
            return { title: "🏦 Faction Vault Balance", description: `⚠️ Torn API Error: ${data.error.error}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
        }

        const donations = data.donations || {};
        const members = data.members || {};
        const donorEntries = Object.entries(donations);
        const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        let targetId = null;
        let targetDonor = null;

        if (targetQuery) {
            const cleanQuery = String(targetQuery).trim().toLowerCase();
            const numeric = cleanQuery.replace(/[^0-9]/g, '');
            if (numeric && (donations[numeric] || members[numeric])) {
                targetId = numeric;
                targetDonor = donations[numeric] || null;
            } else {
                const nQuery = norm(cleanQuery);
                for (const [dId, donor] of donorEntries) {
                    const dName = (donor.name || '').toLowerCase();
                    const nDName = norm(dName);
                    if (dName === cleanQuery || (nQuery && (nDName === nQuery || nDName.includes(nQuery) || nQuery.includes(nDName)))) {
                        targetId = dId;
                        targetDonor = donor;
                        break;
                    }
                }
            }
        } else if (requestingUser) {
            const discordUserId = requestingUser.id;

            // 1. Check verified mapping
            if (discordUserId && verifiedDiscordToTorn[discordUserId]) {
                const entry = verifiedDiscordToTorn[discordUserId];
                targetId = typeof entry === 'object' ? String(entry.tornId) : String(entry);
            }

            // 2. Admin fast-track
            if (!targetId && discordUserId && (discordUserId === '992561850057240578' || discordUserId === discordConfig.personalDiscordId)) {
                targetId = '3776908';
            }

            // 3. Check userKeys
            if (!targetId && discordUserId && typeof userKeys !== 'undefined' && userKeys.getUserAccountStatus) {
                try {
                    const acct = userKeys.getUserAccountStatus(discordUserId);
                    if (acct && acct.connected && acct.playerId) targetId = String(acct.playerId);
                } catch(e) {}
            }

            // 4. Bracket check
            if (!targetId) {
                const candidates = [requestingUser.displayName, requestingUser.globalName, requestingUser.username].filter(Boolean);
                for (const str of candidates) {
                    const m = str.match(/\[(\d{3,10})\]|\((\d{3,10})\)/);
                    if (m) { targetId = m[1] || m[2]; break; }
                }
            }

            // 5. Torn API v2 / v1 discord lookup
            if (!targetId && discordUserId && apiKey) {
                try {
                    const v2Res = await fetch(`https://api.torn.com/v2/user/${discordUserId}/discord?key=${apiKey}`, { signal: AbortSignal.timeout(5000) });
                    const v2Data = await v2Res.json();
                    const matched = v2Data?.discord?.user_id || v2Data?.user_id || v2Data?.player_id;
                    if (matched) targetId = String(matched);
                } catch(e) {}
            }

            // 6. Normalized name matching
            if (!targetId) {
                const candidates = [requestingUser.displayName, requestingUser.globalName, requestingUser.username].filter(Boolean);
                for (const raw of candidates) {
                    const nCand = norm(raw);
                    if (!nCand || nCand.length < 2) continue;
                    for (const [dId, donor] of donorEntries) {
                        const nDName = norm(donor.name);
                        if (nDName && (nCand === nDName || nCand.includes(nDName) || nDName.includes(nCand))) {
                            targetId = dId;
                            break;
                        }
                    }
                    if (targetId) break;
                }
            }

            if (targetId) {
                targetDonor = donations[targetId] || null;
                verifiedDiscordToTorn[discordUserId] = {
                    tornId: String(targetId),
                    tornName: targetDonor?.name || requestingUser.username,
                    timestamp: Date.now()
                };
                if (typeof saveVerifiedDiscordUsers === 'function') saveVerifiedDiscordUsers();
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
                color: moneyBal > 0 ? UI.COLORS.ECONOMY : UI.COLORS.NEUTRAL,
                footer: UI.FOOTER,
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
            color: UI.COLORS.ECONOMY,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "🏦 Faction Vault Balance", description: `⚠️ Error fetching balance: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
}

async function buildMissingDiscordEmbed(guild, apiKey) {
    if (!apiKey) {
        return { title: "📋 Faction Discord Audit", description: "⚠️ Torn API Key is not configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
    if (!guild) {
        return { title: "📋 Faction Discord Audit", description: "⚠️ This command must be executed inside a Discord server.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }

    try {
        const facId = discordConfig.factionId || dynamicFactionId || "";
        const url = facId ? `https://api.torn.com/faction/${facId}?selections=basic&key=${apiKey}` : `https://api.torn.com/faction/?selections=basic&key=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const facData = await res.json();

        if (facData.error) {
            return { title: "📋 Faction Discord Audit", description: `⚠️ Torn API Error: ${facData.error.error}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
        }

        const factionName = facData.name || "Faction";
        const members = facData.members || {};
        const memberList = Object.entries(members).map(([id, m]) => ({ id, ...m }));

        if (memberList.length === 0) {
            return { title: `📋 ${factionName} — Discord Audit`, description: "⚠️ No faction members returned from Torn API.", color: UI.COLORS.WARNING, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
                color: UI.COLORS.SUCCESS,
                footer: UI.FOOTER,
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
            color: UI.COLORS.WARNING,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    } catch(e) {
        return { title: "📋 Faction Discord Audit", description: `⚠️ Error during audit: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
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
            color: UI.COLORS.SUCCESS,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
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
        color: UI.COLORS.ECONOMY,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };
}

// ─── Tornium Verification Suite (/verify & /verifyall) ─────────────────────────

// Helper: Safely apply or remove a guild member role with pre-flight hierarchy and permission validation
async function applyGuildMemberRole(guild, guildMember, botMember, roleId, action = 'add', reason = '') {
    if (!roleId || !guild || !guildMember) return { success: false, reason: 'Missing parameters' };

    // 1. Resolve target Role
    let role = guild.roles.cache.get(roleId);
    if (!role) {
        try {
            role = await guild.roles.fetch(roleId).catch(() => null);
        } catch(e) {}
    }
    if (!role) {
        return { success: false, reason: `Role [${roleId}] not found in server` };
    }

    // 2. Resolve Bot Member
    if (!botMember) {
        botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    }
    if (!botMember) {
        return { success: false, reason: 'Could not resolve bot member in server' };
    }
    if (!botMember.permissions?.has?.('ManageRoles') && !botMember.permissions?.has?.('Administrator')) {
        return { success: false, reason: 'Bot lacks "Manage Roles" permission in server' };
    }

    // 3. Discord Role Hierarchy Check
    // A bot can only add or remove roles strictly LOWER than its own highest role
    const botHighest = botMember.roles.highest;
    if (role.position >= botHighest.position) {
        const warning = `Role hierarchy error: Bot role "${botHighest.name}" (pos ${botHighest.position}) is not higher than target role "${role.name}" (pos ${role.position}). In Discord Server Settings ➔ Roles, drag the F.R.I.D.A.Y role above "${role.name}".`;
        console.warn(`[Discord Roles] Hierarchy block: ${warning}`);
        return {
            success: false,
            hierarchyError: true,
            roleName: role.name,
            roleId: role.id,
            reason: warning
        };
    }

    // 4. Perform Add or Remove
    // NOTE: We intentionally skip the cache.has() check because button-interaction members
    // can have stale role caches. Discord's API is idempotent — adding an existing role is a no-op.
    try {
        if (action === 'add') {
            await guildMember.roles.add(role.id, reason || 'F.R.I.D.A.Y Verification Sync');
            console.log(`[Discord Roles] ✅ Added role "${role.name}" (${role.id}) to ${guildMember.user?.tag || guildMember.id}`);
            return { success: true, action: 'added', role };
        } else if (action === 'remove') {
            const hasRole = guildMember.roles?.cache ? guildMember.roles.cache.has(role.id) : true;
            if (hasRole) {
                await guildMember.roles.remove(role.id, reason || 'F.R.I.D.A.Y Verification Sync');
                console.log(`[Discord Roles] ✅ Removed role "${role.name}" (${role.id}) from ${guildMember.user?.tag || guildMember.id}`);
                return { success: true, action: 'removed', role };
            }
            return { success: true, action: 'already_lacked', role };
        }
    } catch(err) {
        console.error(`[Discord Roles] ❌ Failed to ${action} role "${role.name}" (${role.id}) for ${guildMember.id}: ${err.message}`);
        return { success: false, error: err.message, roleName: role.name, roleId: role.id };
    }
    return { success: false, reason: 'Unknown state' };
}

/**
 * Core Verification Engine (Limited API Key)
 * Links and encrypts a Torn Limited Access API Key via userKeys, validates player identity,
 * syncs Discord nickname to "Name [ID]", assigns Verified & Faction roles, and persists mapping.
 */
async function executeVerifyWithKey(interactionOrMember, rawKey, explicitGuild = null) {
    const interaction = (interactionOrMember && interactionOrMember.isCommand && typeof interactionOrMember.isCommand === 'function') || 
                        (interactionOrMember && interactionOrMember.customId !== undefined) ? interactionOrMember : null;
    const guild = explicitGuild || (interaction ? interaction.guild : (interactionOrMember.guild || null));
    const user = interaction ? interaction.user : (interactionOrMember.user || interactionOrMember);
    const discordUserId = user?.id;

    if (!discordUserId) {
        return {
            success: false,
            title: "🛡️ Verification Failed",
            description: "⚠️ Could not resolve your Discord user identity.",
            color: UI.COLORS.ERROR,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    }

    if (!guild) {
        return {
            success: false,
            title: "🛡️ Verification Failed",
            description: "⚠️ Verification must be executed inside a Discord server.",
            color: UI.COLORS.ERROR,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };
    }

    const rawKeyStr = (rawKey && typeof rawKey === 'object' && rawKey.key) ? rawKey.key : String(rawKey || '');
    const cleanKey = rawKeyStr.trim().replace(/['"\s]/g, '');
    if (!cleanKey || cleanKey.length < 10) {
        return {
            success: false,
            title: "🛡️ Invalid API Key",
            description: "⚠️ Please provide a valid 16-character Torn **Limited Access** API key.\n\n" +
                         "You can generate one instantly at [Torn Preferences](https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2).",
            color: UI.COLORS.ERROR,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString(),
            components: [{
                type: 1,
                components: [
                    {
                        type: 2,
                        style: 5,
                        label: '🔑 Get API Key',
                        url: 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2'
                    }
                ]
            }]
        };
    }

    // 1. Link & Encrypt Key via userKeys (validates level 2 Limited Access)
    const linkRes = await userKeys.linkUserApiKey(discordUserId, cleanKey);
    if (!linkRes || !linkRes.success) {
        return {
            success: false,
            title: "🛡️ Key Verification Failed",
            description: `⚠️ **Could not link API key:** ${linkRes?.error || 'Unknown validation error'}\n\n` +
                         `**Please ensure:**\n` +
                         `1️⃣ Your key was generated at [Torn Preferences](https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2).\n` +
                         `2️⃣ The key type is set to **Limited Access** (Public keys cannot access faction stats).\n` +
                         `3️⃣ The key is active and not paused or deleted.`,
            color: UI.COLORS.ERROR,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString(),
            components: [{
                type: 1,
                components: [
                    {
                        type: 2,
                        style: 5,
                        label: '🔑 Get Limited Key',
                        url: 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2'
                    }
                ]
            }]
        };
    }

    const playerName = linkRes.playerName;
    const playerId = linkRes.playerId;
    const playerFactionId = linkRes.faction?.faction_id || 0;
    const playerFactionName = linkRes.faction?.faction_name || "None";
    const playerPosition = linkRes.faction?.position || "";
    const bars = linkRes.bars;

    const facId = discordConfig.factionId || dynamicFactionId || 52355;
    const isOurFaction = (playerFactionId === 52355) || (String(playerFactionId) === String(facId));

    // Detect Leadership & Banker Roles
    let isLeader = false;
    let isBanker = false;
    if (isOurFaction) {
        const pLower = (playerPosition || '').toLowerCase();
        isLeader = pLower.includes('leader');
        isBanker = isLeader || pLower.includes('bank') || pLower.includes('vault') || pLower.includes('treasur');
    }

    // Resolve Guild Member
    let guildMember = null;
    try {
        guildMember = await guild.members.fetch({ user: discordUserId, force: true }).catch(() => null);
    } catch(e) {}
    if (!guildMember && interaction?.member && interaction.member.roles) {
        guildMember = interaction.member;
    }
    if (!guildMember && guild.members?.cache) {
        guildMember = guild.members.cache.get(discordUserId);
    }

    // Resolve Bot Member & Fetch Roles
    let botMember = guild.members.me;
    if (!botMember) {
        try { botMember = await guild.members.fetchMe().catch(() => null); } catch(e) {}
    }
    try { await guild.roles.fetch().catch(() => null); } catch(e) {}

    // Sync Server Nickname to "Name [ID]"
    let nickUpdated = false;
    let nickNote = "";
    const targetNickname = `${playerName} [${playerId}]`.slice(0, 32);

    if (guildMember && guildMember.manageable) {
        try {
            if (guildMember.nickname !== targetNickname) {
                await guildMember.setNickname(targetNickname, "F.R.I.D.A.Y Limited API Key Verification");
                nickUpdated = true;
            }
        } catch(err) {
            nickNote = err.message;
        }
    } else if (guildMember && !guildMember.manageable) {
        nickNote = "Cannot change nickname of Server Owner or member with higher role";
    }

    // Apply Roles with Hierarchy Check
    const rolesAdded = [];
    const roleWarnings = [];

    const findGuildRole = (configuredId, matchers) => {
        if (configuredId && guild.roles.cache.has(configuredId)) return configuredId;
        for (const m of matchers) {
            const found = guild.roles.cache.find(r => m(r.name.toLowerCase()));
            if (found) return found.id;
        }
        return configuredId || null;
    };

    // 1. Check if user is already verified via Torn Discord
    const isAlreadyVerified = Boolean(
        (verifiedDiscordToTorn[discordUserId] && !verifiedDiscordToTorn[discordUserId].pendingDiscordVerify) ||
        (verifiedRoleId && guildMember?.roles?.cache?.has(verifiedRoleId))
    );

    // 2. Faction Member Roles (Only sync if already verified member)
    if (isOurFaction && guildMember && isAlreadyVerified) {
        const factionRoleId = findGuildRole(discordConfig.factionRoleId, [
            n => n.includes('spider-verse'),
            n => n.includes('spider verse'),
            n => n.includes('spiderverse'),
            n => n.includes('spdr'),
            n => n === 'faction member',
            n => n === 'faction'
        ]);
        if (factionRoleId) {
            const res = await applyGuildMemberRole(guild, guildMember, botMember, factionRoleId, 'add', 'Faction Member (52355)');
            if (res.success && (res.action === 'added' || res.action === 'already_had')) {
                rolesAdded.push(`<@&${factionRoleId}>`);
            } else if (res.hierarchyError) {
                roleWarnings.push(`⚠️ **Hierarchy Alert:** Bot role is lower than <@&${factionRoleId}>. Drag **F.R.I.D.A.Y** above it in Server Settings ➔ Roles.`);
            } else if (res.error) {
                roleWarnings.push(`⚠️ **Role Error:** Could not assign <@&${factionRoleId}>: ${res.error}`);
            }
        }

        // 3. Faction Leader Role
        if (isLeader && discordConfig.leaderRoleId) {
            const res = await applyGuildMemberRole(guild, guildMember, botMember, discordConfig.leaderRoleId, 'add', 'Faction Leader / Co-Leader');
            if (res.success && (res.action === 'added' || res.action === 'already_had')) {
                rolesAdded.push(`<@&${discordConfig.leaderRoleId}> (👑 Leadership)`);
            } else if (res.hierarchyError) {
                roleWarnings.push(`⚠️ **Hierarchy Alert:** Bot role is lower than <@&${discordConfig.leaderRoleId}>.`);
            }
        }

        // 4. Faction Banker Role
        if (isBanker && discordConfig.bankerRoleId) {
            const res = await applyGuildMemberRole(guild, guildMember, botMember, discordConfig.bankerRoleId, 'add', 'Faction Banker / Vault Controller');
            if (res.success && (res.action === 'added' || res.action === 'already_had')) {
                rolesAdded.push(`<@&${discordConfig.bankerRoleId}> (🏦 Banker)`);
            } else if (res.hierarchyError) {
                roleWarnings.push(`⚠️ **Hierarchy Alert:** Bot role is lower than <@&${discordConfig.bankerRoleId}>.`);
            }
        }
    }

    // Cache to verifiedDiscordToTorn & Persist
    if (playerId) {
        if (!verifiedDiscordToTorn[discordUserId]) {
            verifiedDiscordToTorn[discordUserId] = {
                tornId: String(playerId),
                tornName: playerName,
                hasApiKey: true,
                pendingDiscordVerify: !isAlreadyVerified,
                timestamp: Date.now()
            };
        } else {
            verifiedDiscordToTorn[discordUserId].hasApiKey = true;
            verifiedDiscordToTorn[discordUserId].tornId = String(playerId);
            verifiedDiscordToTorn[discordUserId].tornName = playerName;
        }
        if (typeof saveVerifiedDiscordUsers === 'function') {
            saveVerifiedDiscordUsers();
        }
    }

    // Broadcast Announcement to Verification Channel ONLY if explicitly enabled by admin
    const vChanId = discordConfig.verificationChannelId;
    if (vChanId && guild && discordConfig.notifyApiKeyLinked === true) {
        try {
            const chan = guild.channels.cache.get(vChanId) || await guild.channels.fetch(vChanId).catch(() => null);
            if (chan && chan.isTextBased()) {
                await chan.send({
                    content: `🔑 <@${discordUserId}> has successfully linked a Limited API Key as **[${playerName} [${playerId}]](https://www.torn.com/profiles.php?XID=${playerId})**! Live stat tracking & telemetry enabled.`
                });
            }
        } catch(e) {}
    }

    const fields = [
        { name: "👤 Torn Profile", value: UI.player(playerName, playerId), inline: true },
        { name: "🏢 Faction", value: `${playerFactionName} [${playerFactionId}] ${isOurFaction ? '🕷️' : ''} ${playerPosition ? `· *${playerPosition}*` : ''}`, inline: true },
        { name: "🏷️ Server Nickname", value: `\`${targetNickname}\`${nickUpdated ? ' *(Updated)*' : (nickNote ? ` *(⚠️ ${nickNote})*` : '')}`, inline: false }
    ];

    if (bars) {
        fields.push({
            name: "📊 Live Telemetry Active",
            value: `⚡ Energy: **${bars.energy?.current ?? 0}/${bars.energy?.maximum ?? 100}** | 💉 Nerve: **${bars.nerve?.current ?? 0}/${bars.nerve?.maximum ?? 15}** | 😊 Happy: **${bars.happy?.current ?? 0}/${bars.happy?.maximum ?? 100}** | ❤️ Life: **${bars.life?.current ?? 0}/${bars.life?.maximum ?? 100}**`,
            inline: false
        });
    }

    if (rolesAdded.length > 0) {
        fields.push({ name: "🎖️ Roles Granted", value: rolesAdded.join(', '), inline: false });
    }

    if (roleWarnings.length > 0) {
        fields.push({ name: "⚠️ Action Required: Role Hierarchy", value: roleWarnings.join('\n\n'), inline: false });
    }

    if (!isAlreadyVerified) {
        fields.push({
            name: "🛡️ Server Verification Required",
            value: "Your API key is securely saved! To complete server verification and unlock channels, click **🛡️ Verify Me** or verify at **[torn.com/discord](https://www.torn.com/discord)**.",
            inline: false
        });
    }

    fields.push({
        name: "🔒 Military-Grade Key Security",
        value: `Your Limited API Key is encrypted with **AES-256-GCM** using per-user authenticated tags. Your key is permanently stored and will **never** be requested again for gym stats, battle stats, or banking.`,
        inline: false
    });

    return {
        success: true,
        playerName,
        playerId,
        playerFactionId,
        isOurFaction,
        isLeader,
        isBanker,
        rolesAdded,
        roleWarnings,
        title: `🔑 API Key Linked: ${playerName} [${playerId}]`,
        description: `✅ <@${discordUserId}>, your Torn Limited Access API Key has been securely linked and encrypted!\nF.R.I.D.A.Y has permanently saved your key for live gym stats, battle stats (\`/bs\`), energy tracking, and faction banking.`,
        color: isOurFaction ? UI.COLORS.SUCCESS : UI.COLORS.INFO,
        fields,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };
}

async function executeVerifyMember(memberOrUser, guild, arg3, arg4) {
    const discordUserId = memberOrUser.id;

    // Guaranteed resolution of a real GuildMember instance (Discord.js v14)
    let guildMember = null;
    try {
        guildMember = await guild.members.fetch({ user: discordUserId, force: true }).catch(() => null);
    } catch(e) { console.warn(`[Verify] guild.members.fetch threw:`, e.message); }
    if (!guildMember && memberOrUser && memberOrUser.roles) {
        guildMember = memberOrUser;
        console.log(`[Verify] Using interaction.member directly as guildMember for ${discordUserId}`);
    }
    if (!guildMember && guild.members?.cache) {
        guildMember = guild.members.cache.get(discordUserId);
        if (guildMember) console.log(`[Verify] Resolved guildMember from cache for ${discordUserId}`);
    }
    if (!guildMember) {
        console.error(`[Verify] CRITICAL: Could not resolve GuildMember for Discord ID ${discordUserId} in guild ${guild.id}. Role assignment will be skipped.`);
        return {
            success: false,
            title: '🛡️ Verification Failed',
            description: `⚠️ F.R.I.D.A.Y could not resolve your Discord server membership. Please try again in a few seconds, or ask an admin to run \`/verifyall\`.`,
            color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }
    console.log(`[Verify] GuildMember resolved: ${guildMember.user?.tag || discordUserId}, roles cached: ${guildMember.roles?.cache?.size ?? 'unknown'}`);

    // Resolve bot member and fetch all roles cache unconditionally
    let botMember = guild.members.me;
    if (!botMember) {
        try { botMember = await guild.members.fetchMe().catch(() => null); } catch(e) {}
    }
    try {
        await guild.roles.fetch().catch(() => null);
    } catch(e) {}
    console.log(`[Verify] Bot member resolved: ${botMember ? botMember.user?.tag : 'NULL'}, highest role: ${botMember?.roles?.highest?.name || 'unknown'} (pos ${botMember?.roles?.highest?.position ?? '?'})`);
    console.log(`[Verify] discordConfig roles — verified: "${discordConfig.verifiedRoleId}", faction: "${discordConfig.factionRoleId}", unverified: "${discordConfig.unverifiedRoleId}"`);
    console.log(`[Verify] Guild roles available: ${guild.roles.cache.map(r => `"${r.name}"(${r.id})`).join(', ')}`);

    let tornUser = null;
    let verifiedViaGlobalLink = false;
    const facId = discordConfig.factionId || dynamicFactionId || 52355;

    // ── Tornium Official Flow: Torn API v2 Discord Cross-Reference ──
    // Checks if user linked their Discord ID globally on the Official Torn Discord (torn.com/discord)
    try {
        const v2Res = await fetch(`https://api.torn.com/v2/user/${discordUserId}/discord?key=${apiKey}`, { signal: AbortSignal.timeout(6000) });
        const v2Data = await v2Res.json();
        const matchedTornId = v2Data?.discord?.user_id || v2Data?.user_id || v2Data?.discord?.player_id || v2Data?.player_id || v2Data?.userID;
        if (matchedTornId) {
            const res = await fetch(`https://api.torn.com/user/${matchedTornId}?selections=profile,discord&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
            const data = await res.json();
            if (data && !data.error && data.player_id) {
                tornUser = data;
                verifiedViaGlobalLink = true;
            }
        }
    } catch(e) {}

    // ── Fallback: v1 Discord Selection Endpoint ──
    if (!tornUser) {
        try {
            const v1Res = await fetch(`https://api.torn.com/user/${discordUserId}?selections=profile,discord&key=${apiKey}`, { signal: AbortSignal.timeout(6000) });
            const v1Data = await v1Res.json();
            if (v1Data && !v1Data.error && v1Data.player_id) {
                tornUser = v1Data;
                verifiedViaGlobalLink = true;
            }
        } catch(e) {}
    }

    // ── UNVERIFIED: Discord Account Not Linked on Official Torn Discord ──
    if (!tornUser) {
        return {
            success: false,
            title: "🛡️ Official Torn Discord Link Required",
            description: `Hey <@${discordUserId}>! Your Discord account is not linked to your Torn City account yet.\n\n` +
                         `**How to Verify (Standard):**\n` +
                         `1️⃣ Join or open the **[Official Torn Discord](https://www.torn.com/discord)**.\n` +
                         `2️⃣ Complete the official verification steps to link your Discord account to your Torn player identity.\n` +
                         `3️⃣ Once linked, click **🛡️ Verify Me** below (or type \`/verify\`) and F.R.I.D.A.Y will automatically verify you and unlock the server!\n\n` +
                         `⚡ **Optional Power-Up: Pre-Link Your API Key**\n` +
                         `Save time later! Click **🔑 Link API Key (Optional)** below to connect your **Limited Access API Key** so you never have to enter it again for live battle stats (\`/bs\`), gym tracking, energy/nerve updates, and automated vault banking.`,
            color: UI.COLORS.BRAND,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString(),
            components: [{
                type: 1,
                components: [
                    {
                        type: 2,
                        style: 1, // Blurple
                        custom_id: 'btn_verify_now',
                        label: '🛡️ Verify Me',
                        emoji: { name: '🛡️' }
                    },
                    {
                        type: 2,
                        style: 2, // Secondary
                        custom_id: 'btn_link_user_api_key',
                        label: '🔑 Link API Key (Optional)'
                    },
                    {
                        type: 2,
                        style: 5, // Link
                        label: '🔗 Link at Torn.com/discord',
                        url: 'https://www.torn.com/discord'
                    },
                    {
                        type: 2,
                        style: 5, // Link
                        label: '🔑 Get API Key',
                        url: 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2'
                    }
                ]
            }]
        };
    }

    // ── VERIFIED: Process Player, Positions, Nickname, and Roles ──
    const playerName = tornUser.name;
    const playerId = tornUser.player_id;
    const playerFactionId = tornUser.faction?.faction_id || 0;
    const playerFactionName = tornUser.faction?.faction_name || "None";
    const isOurFaction = (playerFactionId === 52355) || (String(playerFactionId) === String(facId));

    // Detect Faction Position (Leader, Co-Leader, Banker, etc.)
    let isLeader = false;
    let isBanker = false;
    let memberPositionTitle = "";

    if (isOurFaction) {
        try {
            const facRes = await fetch(`https://api.torn.com/faction/${facId}?selections=basic,positions&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
            const facData = await facRes.json();
            if (facData) {
                const mData = facData.members?.[String(playerId)] || facData.members?.[playerId];
                memberPositionTitle = mData?.position || "";
                const pLower = memberPositionTitle.toLowerCase();
                isLeader = (String(playerId) === String(facData.leader)) ||
                           (String(playerId) === String(facData['co-leader'])) ||
                           pLower.includes('leader');
                isBanker = isLeader ||
                           pLower.includes('bank') ||
                           pLower.includes('vault') ||
                           pLower.includes('treasur');
            }
        } catch(e) {}
    }

    // Sync Server Nickname to "Name [ID]"
    let nickUpdated = false;
    let nickNote = "";
    const targetNickname = `${playerName} [${playerId}]`.slice(0, 32);

    if (guildMember && guildMember.manageable) {
        try {
            if (guildMember.nickname !== targetNickname) {
                await guildMember.setNickname(targetNickname, "F.R.I.D.A.Y Tornium Verification");
                nickUpdated = true;
            }
        } catch(err) {
            nickNote = err.message;
        }
    } else if (guildMember && !guildMember.manageable) {
        nickNote = "Cannot change nickname of Server Owner or member with higher role";
    }

    // Apply Roles with Hierarchy Check & Error Collection
    const rolesAdded = [];
    const roleWarnings = [];

    // Helper to find role ID with robust fuzzy matching
    const findGuildRole = (configuredId, matchers) => {
        if (configuredId && guild.roles.cache.has(configuredId)) return configuredId;
        for (const m of matchers) {
            const found = guild.roles.cache.find(r => m(r.name.toLowerCase()));
            if (found) return found.id;
        }
        return configuredId || null;
    };

    // 1. Verified Role
    let alreadyHadVerifiedRole = false;
    const verifiedRoleId = findGuildRole(discordConfig.verifiedRoleId, [
        n => n === 'verified',
        n => n === 'verified member',
        n => n.includes('verified'),
        n => n === 'member',
        n => n === 'members'
    ]);
    if (verifiedRoleId) {
        alreadyHadVerifiedRole = Boolean(guildMember && guildMember.roles?.cache?.has(verifiedRoleId));
        const res = await applyGuildMemberRole(guild, guildMember, botMember, verifiedRoleId, 'add', 'Tornium Verified');
        if (res.success && (res.action === 'added' || res.action === 'already_had')) {
            rolesAdded.push(`<@&${verifiedRoleId}>`);
        } else if (res.hierarchyError) {
            roleWarnings.push(`⚠️ **Hierarchy Alert:** Bot role is lower than <@&${verifiedRoleId}>. Drag **F.R.I.D.A.Y** above it in Server Settings ➔ Roles.`);
        } else if (res.error) {
            roleWarnings.push(`⚠️ **Role Error:** Could not assign <@&${verifiedRoleId}>: ${res.error}`);
        }
    }

    // 2. Faction Member Role (Spider-Verse 52355)
    if (isOurFaction) {
        const factionRoleId = findGuildRole(discordConfig.factionRoleId, [
            n => n.includes('spider-verse'),
            n => n.includes('spider verse'),
            n => n.includes('spiderverse'),
            n => n.includes('spdr'),
            n => n === 'faction member',
            n => n === 'faction'
        ]);
        if (factionRoleId) {
            const res = await applyGuildMemberRole(guild, guildMember, botMember, factionRoleId, 'add', 'Faction Member (52355)');
            if (res.success && (res.action === 'added' || res.action === 'already_had')) {
                rolesAdded.push(`<@&${factionRoleId}>`);
            } else if (res.hierarchyError) {
                roleWarnings.push(`⚠️ **Hierarchy Alert:** Bot role is lower than <@&${factionRoleId}>. Drag **F.R.I.D.A.Y** above it in Server Settings ➔ Roles.`);
            } else if (res.error) {
                roleWarnings.push(`⚠️ **Role Error:** Could not assign <@&${factionRoleId}>: ${res.error}`);
            }
        }

        // 3. Faction Leader Role
        if (isLeader && discordConfig.leaderRoleId) {
            const res = await applyGuildMemberRole(guild, guildMember, botMember, discordConfig.leaderRoleId, 'add', 'Faction Leader / Co-Leader');
            if (res.success && (res.action === 'added' || res.action === 'already_had')) {
                rolesAdded.push(`<@&${discordConfig.leaderRoleId}> (👑 Leadership)`);
            } else if (res.hierarchyError) {
                roleWarnings.push(`⚠️ **Hierarchy Alert:** Bot role is lower than <@&${discordConfig.leaderRoleId}>. Drag **F.R.I.D.A.Y** above it in Server Settings ➔ Roles.`);
            }
        }

        // 4. Faction Banker Role
        if (isBanker && discordConfig.bankerRoleId) {
            const res = await applyGuildMemberRole(guild, guildMember, botMember, discordConfig.bankerRoleId, 'add', 'Faction Banker / Vault Controller');
            if (res.success && (res.action === 'added' || res.action === 'already_had')) {
                rolesAdded.push(`<@&${discordConfig.bankerRoleId}> (🏦 Banker)`);
            } else if (res.hierarchyError) {
                roleWarnings.push(`⚠️ **Hierarchy Alert:** Bot role is lower than <@&${discordConfig.bankerRoleId}>. Drag **F.R.I.D.A.Y** above it in Server Settings ➔ Roles.`);
            }
        }
    }

    // 5. Remove Unverified Quarantine Role
    const unverifiedRoleId = findGuildRole(discordConfig.unverifiedRoleId, [
        n => n === 'unverified',
        n => n.includes('unverified'),
        n => n === 'quarantine'
    ]);
    if (unverifiedRoleId) {
        await applyGuildMemberRole(guild, guildMember, botMember, unverifiedRoleId, 'remove', 'Verified on Torn');
    }

    const fields = [
        { name: "👤 Torn Profile", value: UI.player(playerName, playerId), inline: true },

        { name: "🏢 Faction", value: `${playerFactionName} [${playerFactionId}] ${isOurFaction ? '🕷️' : ''} ${memberPositionTitle ? `· *${memberPositionTitle}*` : ''}`, inline: true },
        { name: "🏷️ Server Nickname", value: `\`${targetNickname}\`${nickUpdated ? ' *(Updated)*' : (nickNote ? ` *(⚠️ ${nickNote})*` : '')}`, inline: false }
    ];

    if (rolesAdded.length > 0) {
        fields.push({ name: "🎖️ Roles Granted", value: rolesAdded.join(', '), inline: false });
    }

    if (roleWarnings.length > 0) {
        fields.push({ name: "⚠️ Action Required: Role Hierarchy", value: roleWarnings.join('\n\n'), inline: false });
    }

    if (playerId) {
        verifiedDiscordToTorn[discordUserId] = {
            tornId: String(playerId),
            tornName: playerName,
            timestamp: Date.now()
        };
        if (typeof saveVerifiedDiscordUsers === 'function') {
            saveVerifiedDiscordUsers();
        }
    }

    const hasLinkedKey = userKeys && typeof userKeys.hasLinkedKey === 'function' && userKeys.hasLinkedKey(discordUserId);
    const returnObj = {
        success: true,
        playerName,
        playerId,
        playerFactionId,
        isOurFaction,
        isLeader,
        isBanker,
        rolesAdded,
        roleWarnings,
        isNewVerification: !alreadyHadVerifiedRole,
        alreadyVerified: alreadyHadVerifiedRole,
        title: `🛡️ Verified: ${playerName} [${playerId}]`,
        description: alreadyHadVerifiedRole
            ? `✅ <@${discordUserId}>, your verification is already up to date! Roles and nickname refreshed.`
            : `✅ <@${discordUserId}> has been successfully verified! Full server access granted.`,
        color: isOurFaction ? UI.COLORS.SUCCESS : UI.COLORS.INFO,
        fields,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };

    if (!hasLinkedKey) {
        returnObj.components = [{
            type: 1,
            components: [
                {
                    type: 2,
                    style: 2, // Secondary
                    custom_id: 'btn_link_user_api_key',
                    label: '🔑 Pre-Link API Key (Optional)'
                },
                {
                    type: 2,
                    style: 5, // Link
                    label: '🔑 Get API Key',
                    url: 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2'
                }
            ]
        }];
    }

    return returnObj;
}

async function executeVerifyAll(guild, apiKey) {
    if (!apiKey) return { title: "🛡️ Batch Verification", description: "⚠️ Torn API Key is not configured.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    if (!guild) return { title: "🛡️ Batch Verification", description: "⚠️ Must be run inside a Discord server.", color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };

    const facId = discordConfig.factionId || dynamicFactionId || 52355;
    let facData = null;
    try {
        const res = await fetch(`https://api.torn.com/faction/${facId}?selections=basic,positions&key=${apiKey}`, { signal: AbortSignal.timeout(9000) });
        facData = await res.json();
    } catch(e) {
        return { title: "🛡️ Batch Verification", description: `⚠️ Failed to fetch faction roster: ${e.message}`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }

    if (!facData || !facData.members) {
        return { title: "🛡️ Batch Verification", description: `⚠️ No members returned for Faction [${facId}].`, color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() };
    }

    const membersMap = facData.members;

    // Fetch all guild members and ensure botMember & roles are resolved
    let guildMembers = null;
    try {
        guildMembers = await guild.members.fetch();
    } catch(e) {
        guildMembers = guild.members.cache;
    }

    let botMember = guild.members.me;
    if (!botMember) {
        try { botMember = await guild.members.fetchMe().catch(() => null); } catch(e) {}
    }
    try { await guild.roles.fetch().catch(() => null); } catch(e) {}

    let updatedCount = 0;
    let alreadySynced = 0;
    let unmatchedCount = 0;
    const globalRoleWarnings = new Set();

    const findGuildRole = (configuredId, matchers) => {
        if (configuredId && guild.roles.cache.has(configuredId)) return configuredId;
        for (const m of matchers) {
            const found = guild.roles.cache.find(r => m(r.name.toLowerCase()));
            if (found) return found.id;
        }
        return configuredId || null;
    };

    const verifiedRoleId = findGuildRole(discordConfig.verifiedRoleId, [
        n => n === 'verified',
        n => n === 'verified member',
        n => n.includes('verified'),
        n => n === 'member',
        n => n === 'members'
    ]);

    const factionRoleId = findGuildRole(discordConfig.factionRoleId, [
        n => n.includes('spider-verse'),
        n => n.includes('spider verse'),
        n => n.includes('spiderverse'),
        n => n.includes('spdr'),
        n => n === 'faction member',
        n => n === 'faction'
    ]);

    const unverifiedRoleId = findGuildRole(discordConfig.unverifiedRoleId, [
        n => n === 'unverified',
        n => n.includes('unverified'),
        n => n === 'quarantine'
    ]);

    for (const [gmId, gm] of guildMembers) {
        if (gm.user.bot) continue;

        const nickMatch = (gm.nickname || gm.displayName || '').match(/\[(\d{5,10})\]/);
        let matchedPlayerId = nickMatch ? nickMatch[1] : null;
        let matchedName = matchedPlayerId && membersMap[matchedPlayerId] ? membersMap[matchedPlayerId].name : null;

        // Check verified cache, admin ID, userKeys
        if (!matchedPlayerId && verifiedDiscordToTorn[gm.id]) {
            const entry = verifiedDiscordToTorn[gm.id];
            matchedPlayerId = typeof entry === 'object' ? String(entry.tornId) : String(entry);
            matchedName = membersMap[matchedPlayerId]?.name || (typeof entry === 'object' ? entry.tornName : null);
        }
        if (!matchedPlayerId && (gm.id === '992561850057240578' || gm.id === discordConfig.personalDiscordId)) {
            matchedPlayerId = '3776908';
            matchedName = membersMap['3776908']?.name || 'Owen777';
        }
        if (!matchedPlayerId && typeof userKeys !== 'undefined' && userKeys.getUserAccountStatus) {
            try {
                const acct = userKeys.getUserAccountStatus(gm.id);
                if (acct && acct.connected && acct.playerId) {
                    matchedPlayerId = String(acct.playerId);
                    matchedName = membersMap[matchedPlayerId]?.name || acct.playerName || null;
                }
            } catch(e) {}
        }

        if (!matchedPlayerId) {
            const cleanName = (gm.displayName || gm.user.username || '').toLowerCase().trim();
            const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const nClean = norm(cleanName);
            const found = Object.entries(membersMap).find(([id, m]) => {
                const nM = norm(m.name);
                return m.name.toLowerCase() === cleanName || cleanName.includes(m.name.toLowerCase()) || (nClean && nM && (nClean === nM || nClean.includes(nM) || nM.includes(nClean)));
            });
            if (found) {
                matchedPlayerId = found[0];
                matchedName = found[1].name;
            }
        }

        if (matchedPlayerId && matchedName) {
            verifiedDiscordToTorn[gm.id] = {
                tornId: String(matchedPlayerId),
                tornName: matchedName,
                timestamp: Date.now()
            };
            const targetNick = `${matchedName} [${matchedPlayerId}]`.slice(0, 32);
            let changed = false;

            if (gm.manageable && gm.nickname !== targetNick) {
                try {
                    await gm.setNickname(targetNick, "F.R.I.D.A.Y Batch Verification");
                    changed = true;
                } catch(e) {}
            }

            // Detect Positions
            const mData = membersMap[matchedPlayerId];
            const pLower = (mData?.position || '').toLowerCase();
            const isLeader = (String(matchedPlayerId) === String(facData.leader)) ||
                             (String(matchedPlayerId) === String(facData['co-leader'])) ||
                             pLower.includes('leader');
            const isBanker = isLeader ||
                             pLower.includes('bank') ||
                             pLower.includes('vault') ||
                             pLower.includes('treasur');

            // Apply Roles via applyGuildMemberRole helper
            if (verifiedRoleId) {
                const res = await applyGuildMemberRole(guild, gm, botMember, verifiedRoleId, 'add', 'Batch Verified');
                if (res.success && res.action === 'added') changed = true;
                else if (res.hierarchyError) globalRoleWarnings.add(res.reason);
            }
            if (factionRoleId) {
                const res = await applyGuildMemberRole(guild, gm, botMember, factionRoleId, 'add', 'Batch Faction Member');
                if (res.success && res.action === 'added') changed = true;
                else if (res.hierarchyError) globalRoleWarnings.add(res.reason);
            }
            if (isLeader && discordConfig.leaderRoleId) {
                const res = await applyGuildMemberRole(guild, gm, botMember, discordConfig.leaderRoleId, 'add', 'Batch Faction Leader');
                if (res.success && res.action === 'added') changed = true;
                else if (res.hierarchyError) globalRoleWarnings.add(res.reason);
            }
            if (isBanker && discordConfig.bankerRoleId) {
                const res = await applyGuildMemberRole(guild, gm, botMember, discordConfig.bankerRoleId, 'add', 'Batch Faction Banker');
                if (res.success && res.action === 'added') changed = true;
                else if (res.hierarchyError) globalRoleWarnings.add(res.reason);
            }
            if (unverifiedRoleId) {
                const res = await applyGuildMemberRole(guild, gm, botMember, unverifiedRoleId, 'remove', 'Batch Verified');
                if (res.success && res.action === 'removed') changed = true;
            }

            if (changed) updatedCount++;
            else alreadySynced++;
        } else {
            unmatchedCount++;
        }
    }

    const warningText = globalRoleWarnings.size > 0
        ? `\n\n⚠️ **Role Hierarchy Warning:**\n${Array.from(globalRoleWarnings).join('\n')}`
        : '';

    if (typeof saveVerifiedDiscordUsers === 'function') {
        saveVerifiedDiscordUsers();
    }

    return {
        title: "🛡️ Tornium Verification Audit Complete",
        description: `Batch re-verification scan of **${guild.name}** finished!\n\n` +
                     `✅ **Updated & Synced:** ${updatedCount} members\n` +
                     `🔒 **Already Synced:** ${alreadySynced} members\n` +
                     `⚠️ **Unmatched / Guests:** ${unmatchedCount} members\n\n` +
                     `*Members who were not matched can link at [torn.com/discord](https://www.torn.com/discord) or run \`/verify player:YourID\`.*` +
                     warningText,
        color: UI.COLORS.SUCCESS,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };
}

// ─── Verification-on-Join Engine ──────────────────────────────────────────────
async function handleGuildMemberAdd(member) {
    if (!member || member.user?.bot) return;
    if (discordConfig.autoVerifyOnJoin === false) return;

    const guild = member.guild;
    const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
    const verificationChannelId = discordConfig.verificationChannelId;

    // Pre-fetch all roles so cache is always warm
    try { await guild.roles.fetch().catch(() => null); } catch(e) {}

    const findGuildRole = (configuredId, matchers) => {
        if (configuredId && guild.roles.cache.has(configuredId)) return configuredId;
        for (const m of matchers) {
            const found = guild.roles.cache.find(r => m(r.name.toLowerCase()));
            if (found) return found.id;
        }
        return configuredId || null;
    };

    const verifiedRoleId = findGuildRole(discordConfig.verifiedRoleId, [
        n => n === 'verified',
        n => n === 'verified member',
        n => n.includes('verified'),
        n => n === 'member',
        n => n === 'members'
    ]);

    const factionRoleId = findGuildRole(discordConfig.factionRoleId, [
        n => n.includes('spider-verse'),
        n => n.includes('spider verse'),
        n => n.includes('spiderverse'),
        n => n.includes('spdr'),
        n => n === 'faction member',
        n => n === 'faction'
    ]);

    const unverifiedRoleId = findGuildRole(discordConfig.unverifiedRoleId, [
        n => n === 'unverified',
        n => n.includes('unverified'),
        n => n === 'quarantine'
    ]);

    console.log(`[Verification-on-Join] New member joined ${guild.name}: ${member.user.tag} (${member.id})`);

    // ── Dedicated Welcome & Faction Rules Announcement (Option C) ──
    if (discordConfig.welcomeChannelId && discordConfig.postWelcomeRulesOnJoin !== false) {
        try {
            const welcomeRulesChan = guild.channels.cache.get(discordConfig.welcomeChannelId)
                || (await guild.channels.fetch(discordConfig.welcomeChannelId).catch(() => null));
            if (welcomeRulesChan && welcomeRulesChan.isTextBased()) {
                const rulesEmbed = buildWelcomeRulesEmbed(member.id);
                welcomeRulesChan.send({
                    content: `👋 Welcome to the server, <@${member.id}>! Please review our faction rules and priority objectives below:`,
                    embeds: [sanitizeEmbed(rulesEmbed)]
                }).catch(e => console.warn('[Welcome Rules] Failed to send to welcome channel:', e.message));
            }
        } catch(err) {
            console.warn('[Welcome Rules] Error sending join welcome:', err.message);
        }
    }

    // Ensure botMember is ready
    let botMember = guild.members.me;
    if (!botMember) {
        try { botMember = await guild.members.fetchMe().catch(() => null); } catch(e) {}
    }

    // 1. Attempt instant auto-verification via Tornium flow (Torn v2 discord cross-reference)
    let verifyResult = null;
    if (apiKey) {
        verifyResult = await executeVerifyMember(member, guild, null, apiKey);
    }

    if (verifyResult && verifyResult.success) {
        console.log(`[Verification-on-Join] Auto-verified ${member.user.tag} as ${verifyResult.playerName} [${verifyResult.playerId}]`);

        // Guarantee direct role application on the member object
        const rolesGrantedList = [];
        if (verifiedRoleId) {
            try {
                if (!member.roles.cache.has(verifiedRoleId)) {
                    await member.roles.add(verifiedRoleId, 'Verification-on-Join Direct');
                    console.log(`[Verification-on-Join] Added Verified role ${verifiedRoleId} to ${member.user.tag}`);
                }
                rolesGrantedList.push(`<@&${verifiedRoleId}>`);
            } catch(err) {
                console.error(`[Verification-on-Join] Failed to add Verified role to ${member.user.tag}:`, err.message);
                verifyResult.roleWarnings = verifyResult.roleWarnings || [];
                if (err.message.includes('Missing Permissions')) {
                    verifyResult.roleWarnings.push(`⚠️ **Hierarchy Alert:** F.R.I.D.A.Y role is lower than <@&${verifiedRoleId}>. In Server Settings ➔ Roles, drag F.R.I.D.A.Y above it!`);
                } else {
                    verifyResult.roleWarnings.push(`⚠️ **Role Error:** ${err.message}`);
                }
            }
        }

        if (verifyResult.isOurFaction && factionRoleId) {
            try {
                if (!member.roles.cache.has(factionRoleId)) {
                    await member.roles.add(factionRoleId, 'Faction Member Verification-on-Join Direct');
                    console.log(`[Verification-on-Join] Added Faction role ${factionRoleId} to ${member.user.tag}`);
                }
                rolesGrantedList.push(`<@&${factionRoleId}>`);
            } catch(err) {
                console.error(`[Verification-on-Join] Failed to add Faction role to ${member.user.tag}:`, err.message);
            }
        }

        // Remove quarantine/unverified role if present
        if (unverifiedRoleId) {
            try {
                if (member.roles.cache.has(unverifiedRoleId)) {
                    await member.roles.remove(unverifiedRoleId, 'Auto-verified on join');
                }
            } catch(e) {}
        }

        const allRolesGranted = [
            ...(verifyResult.rolesAdded || []),
            ...rolesGrantedList
        ].filter((v, i, a) => a.indexOf(v) === i);

        const rolesDisplay = allRolesGranted.length > 0 
            ? allRolesGranted.join(', ') 
            : (verifiedRoleId ? `<@&${verifiedRoleId}>` : 'Verified Member');

        let warningNotice = '';
        if (verifyResult.roleWarnings && verifyResult.roleWarnings.length > 0) {
            warningNotice = `\n\n${verifyResult.roleWarnings.join('\n')}`;
        }

        const welcomeEmbed = {
            title: `🎉 Welcome to ${guild.name}!`,
            description: `✅ <@${member.id}> has been automatically verified as ${UI.player(verifyResult.playerName, verifyResult.playerId)}!\n\n` +

                         `🏷️ **Nickname set to:** \`${verifyResult.playerName} [${verifyResult.playerId}]\`\n` +
                         `🎖️ **Roles Granted:** ${rolesDisplay}\n\n` +
                         `Welcome to the faction! All channels are now unlocked for you.${warningNotice}`,
            color: UI.COLORS.SUCCESS,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };

        try {
            const targetChan = (verificationChannelId && guild.channels.cache.get(verificationChannelId)) || guild.systemChannel;
            if (targetChan && targetChan.isTextBased()) {
                await targetChan.send({ content: `Welcome <@${member.id}>! 🕷️`, embeds: [sanitizeEmbed(welcomeEmbed)] });
            }
        } catch(e) {}
        return;
    }

    // 2. Member is unverified — restrict and guide them
    console.log(`[Verification-on-Join] Member ${member.user.tag} is unverified. Restricting access and sending verification guide.`);

    // Assign Unverified quarantine role if configured
    if (unverifiedRoleId) {
        await applyGuildMemberRole(guild, member, botMember, unverifiedRoleId, 'add', 'Unverified new joiner quarantine');
    }

    const verifyEmbed = {
        title: `🛡️ Welcome to ${guild.name} — Verification Required`,
        description: `Hey <@${member.id}>, welcome!\n\n` +
                     `🔒 **Server Access Locked**\n` +
                     `To protect faction intel and member privacy, all channels remain locked until your Torn City identity is verified.\n\n` +
                     `**How to Verify (Standard):**\n` +
                     `1️⃣ Link your Discord account at **[torn.com/discord](https://www.torn.com/discord)** on the Official Torn Discord.\n` +
                     `2️⃣ Click **🛡️ Verify Me** below — F.R.I.D.A.Y will sync your nickname to \`Name [ID]\` and unlock your roles.\n\n` +
                     `⚡ **Optional Power-Up: Pre-Link Your API Key**\n` +
                     `Save time later! Click **🔑 Link API Key (Optional)** below to connect your Torn **Limited Access API Key**. F.R.I.D.A.Y will securely encrypt and save it so you **never** have to enter it again for live battle stats (\`/bs\`), gym tracking, energy/nerve updates, or automated banking!`,
        color: UI.COLORS.BRAND,
        thumbnail: { url: "https://www.torn.com/favicon.ico" },
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };

    const verifyButtons = [{
        type: 1,
        components: [
            {
                type: 2,
                style: 1, // Primary (Blurple)
                custom_id: 'btn_verify_now',
                label: '🛡️ Verify Me',
                emoji: { name: '🛡️' }
            },
            {
                type: 2,
                style: 2, // Secondary
                custom_id: 'btn_link_user_api_key',
                label: '🔑 Link API Key (Optional)'
            },
            {
                type: 2,
                style: 5, // Link
                label: '🔗 Link at Torn.com/discord',
                url: 'https://www.torn.com/discord'
            },
            {
                type: 2,
                style: 5, // Link
                label: '🔑 Get API Key',
                url: 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2'
            }
        ]
    }];

    // Post in verification channel if available
    try {
        let chan = null;
        if (verificationChannelId) {
            chan = guild.channels.cache.get(verificationChannelId) || await guild.channels.fetch(verificationChannelId).catch(() => null);
        }
        if (!chan) {
            chan = guild.channels.cache.find(c => c.isTextBased() && (c.name.includes('verify') || c.name.includes('welcome'))) || guild.systemChannel;
        }

        if (chan && chan.isTextBased()) {
            await chan.send({
                content: `👋 Welcome <@${member.id}>! Please verify your Torn account to unlock server channels:`,
                embeds: [sanitizeEmbed(verifyEmbed)],
                components: verifyButtons
            });
        }
    } catch(e) {
        console.warn("[Verification-on-Join] Failed to send channel verification prompt:", e.message);
    }

    // Also attempt DM
    try {
        await member.send({
            content: `👋 Welcome to **${guild.name}**!`,
            embeds: [sanitizeEmbed(verifyEmbed)],
            components: verifyButtons
        });
    } catch(e) {}
}

// ─── Discord Giveaway Subsystem ───────────────────────────────────────────────
const GIVEAWAYS_FILE = path.join(__dirname, 'giveaways.json');
activeGiveaways = activeGiveaways || {};

function loadGiveaways() {
    try {
        if (fs.existsSync(GIVEAWAYS_FILE)) {
            const diskGiveaways = JSON.parse(fs.readFileSync(GIVEAWAYS_FILE, 'utf8')) || {};
            activeGiveaways = { ...(activeGiveaways || {}), ...diskGiveaways };
            console.log(`[Giveaways] Loaded ${Object.keys(activeGiveaways).length} giveaways from storage`);
        }
    } catch(e) {
        console.error("[Giveaways Load Error]", e.message);
    }
}

function saveGiveaways() {
    try {
        fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(activeGiveaways, null, 2), 'utf8');
    } catch(e) {
        console.error("[Giveaways Save Error]", e.message);
    }
}

function parseGiveawayDuration(input) {
    if (!input) return null;
    const str = String(input).trim().toLowerCase();
    const match = str.match(/^(\d+(?:\.\d+)?)\s*(m(?:in(?:ute)?s?)?|h(?:(?:ou)?rs?)?|d(?:ays?)?|s(?:ec(?:ond)?s?)?)?$/);
    if (!match) return null;
    const val = parseFloat(match[1]);
    const unit = (match[2] || 'm')[0];
    if (isNaN(val) || val <= 0) return null;
    if (unit === 's') return Math.max(10, Math.round(val)) * 1000;
    if (unit === 'm') return Math.round(val * 60 * 1000);
    if (unit === 'h') return Math.round(val * 3600 * 1000);
    if (unit === 'd') return Math.round(val * 86400 * 1000);
    return null;
}

function buildGiveawayEmbed(g) {
    const endTimestamp = Math.floor(g.endsAt / 1000);
    return {
        title: `🎉 GIVEAWAY: ${g.prize}`,
        description: `Click the **🎉 Enter** button below to participate!\n\n` +
            `🎁 **Prize**: **${g.prize}**\n` +
            `👑 **Hosted by**: <@${g.hostId}>\n` +
            `🏆 **Winners**: **${g.winnersCount}**\n` +
            `⏰ **Ends**: <t:${endTimestamp}:R> (<t:${endTimestamp}:f>)\n` +
            `👥 **Entries**: **${g.entries.length}** participants`,
        color: UI.COLORS.SPECIAL,
        footer: UI.FOOTER,
        timestamp: new Date(g.createdAt).toISOString()
    };
}

function buildGiveawayButtons(g) {
    return [{
        type: 1,
        components: [
            {
                type: 2,
                style: 3, // Green
                custom_id: `giveaway_enter_${g.id}`,
                label: `🎉 Enter (${g.entries.length})`,
                emoji: { name: '🎉' }
            },
            {
                type: 2,
                style: 2, // Secondary
                custom_id: `giveaway_list_${g.id}`,
                label: '👥 View Entries'
            },
            {
                type: 2,
                style: 4, // Danger
                custom_id: `giveaway_end_${g.id}`,
                label: '⏹️ End'
            }
        ]
    }];
}

function buildEndedGiveawayEmbed(g) {
    const winnersText = Array.isArray(g.winners) && g.winners.length > 0
        ? g.winners.map(wId => `<@${wId}>`).join(', ')
        : 'No valid entries / No winners';
    return {
        title: `🎉 GIVEAWAY ENDED: ${g.prize}`,
        description: `This giveaway has concluded!\n\n` +
            `🎁 **Prize**: **${g.prize}**\n` +
            `👑 **Hosted by**: <@${g.hostId}>\n` +
            `🏆 **Winner(s)**: ${winnersText}\n` +
            `👥 **Total Entries**: **${g.entries.length}**`,
        color: UI.COLORS.SPECIAL,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };
}

function buildEndedGiveawayButtons(g) {
    return [{
        type: 1,
        components: [
            {
                type: 2,
                style: 2,
                custom_id: `giveaway_ended_${g.id}`,
                label: `🎉 Ended (${g.entries.length} entered)`,
                disabled: true
            },
            {
                type: 2,
                style: 1, // Blurple
                custom_id: `giveaway_reroll_${g.id}`,
                label: '🎲 Reroll Winner'
            }
        ]
    }];
}

function getAnyActiveDiscordClient() {
    if (slashCommandBot && slashCommandBot.isReady?.()) return slashCommandBot;
    return Object.values(activeDiscordBots).find(c => c && c.isReady && c.isReady()) || null;
}

// ── Discord Direct Message (DM) Dispatcher ──
async function sendDirectMessageToUser(discordUserId, embed, content = "") {
    if (!discordUserId) return { success: false, error: "Missing User ID" };
    const cleanId = String(discordUserId).trim().replace(/[^0-9]/g, '');
    if (!cleanId || cleanId.length < 15) return { success: false, error: "Invalid Discord User ID" };

    // 1. Try via active Discord.js Client
    const client = getAnyActiveDiscordClient();
    if (client) {
        try {
            const user = await client.users.fetch(cleanId).catch(() => null);
            if (user) {
                const cleanEmbed = sanitizeEmbed(embed);
                const payload = cleanEmbed ? { embeds: [cleanEmbed] } : {};
                if (content) payload.content = content;
                await user.send(payload);
                return { success: true };
            }
        } catch(e) {
            console.warn(`[Discord DM] Client user.send failed for ${cleanId}:`, e.message);
        }
    }

    // 2. REST API v10 fallback (POST /users/@me/channels -> executeDiscordSend)
    const botToken = discordConfig.globalBotToken;
    if (botToken && !botToken.startsWith('http') && botToken.length > 20) {
        try {
            const dmChanRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${botToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ recipient_id: cleanId })
            });
            const dmChanData = await dmChanRes.json();
            if (dmChanData && dmChanData.id) {
                return await executeDiscordSend(botToken, dmChanData.id, embed, content);
            }
        } catch(e) {
            console.warn(`[Discord DM] REST DM fallback failed for ${cleanId}:`, e.message);
        }
    }

    return { success: false, error: `Could not reach user ${cleanId} via DM. Check Discord DM privacy settings.` };
}

// ── Resolve OC Manager User IDs (Role + Explicit IDs) ──
async function getOcManagerDiscordUserIds() {
    const userIds = new Set();
    // 1. Explicit user IDs from config
    const rawUserIds = ocConfig.ocManagerUserIds;
    if (Array.isArray(rawUserIds)) {
        for (const id of rawUserIds) {
            const clean = String(id || '').trim().replace(/[^0-9]/g, '');
            if (clean && clean.length >= 15) userIds.add(clean);
        }
    } else if (typeof rawUserIds === 'string' && rawUserIds.trim()) {
        const parts = rawUserIds.split(/[\s,]+/);
        for (const part of parts) {
            const clean = part.replace(/[^0-9]/g, '');
            if (clean && clean.length >= 15) userIds.add(clean);
        }
    }

    // 2. Role-based resolution
    const roleId = (ocConfig.ocManagerRoleId || '').replace(/[^0-9]/g, '');
    if (roleId) {
        const client = getAnyActiveDiscordClient();
        if (client) {
            const guildId = discordConfig.guildId || client.guilds.cache.firstKey();
            const guild = guildId ? client.guilds.cache.get(guildId) : client.guilds.cache.first();
            if (guild) {
                try {
                    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
                    if (role) {
                        if (guild.members.cache.size <= 1) {
                            await guild.members.fetch().catch(() => null);
                        }
                        for (const [mId, member] of role.members) {
                            if (!member.user?.bot) {
                                userIds.add(mId);
                            }
                        }
                    }
                } catch(e) {
                    console.warn('[OC Managers] Role member resolution failed:', e.message);
                }
            }
        }
    }

    return Array.from(userIds);
}

// ── Build Official Welcome & Rules Embed (Option C) ──
function buildWelcomeRulesEmbed(memberId = null) {
    const title = discordConfig.welcomeRulesTitle || "📜 Welcome to the Faction & Server Rules";
    const rulesBody = discordConfig.welcomeRulesContent || DEFAULT_WELCOME_RULES;
    
    let description = '';
    if (memberId) {
        description = `👋 **Welcome to the server, <@${memberId}>!**\n\n` + rulesBody;
    } else {
        description = rulesBody;
    }

    return {
        title,
        description,
        color: UI.COLORS.BRAND,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString(),
        links: [
            { label: "💼 Torn Crimes (OC)", url: "https://www.torn.com/factions.php?step=your&type=1#/tab=crimes" },
            { label: "🛡️ Link Discord", url: "https://www.torn.com/discord" }
        ]
    };
}

async function endGiveaway(gId, client = null) {
    const g = activeGiveaways[gId];
    if (!g || g.ended) return;

    g.ended = true;
    g.endedAt = Date.now();

    const winners = [];
    if (Array.isArray(g.entries) && g.entries.length > 0) {
        const pool = [...g.entries];
        const numToPick = Math.min(g.winnersCount || 1, pool.length);
        for (let i = 0; i < numToPick; i++) {
            const randIdx = Math.floor(Math.random() * pool.length);
            winners.push(pool[randIdx]);
            pool.splice(randIdx, 1);
        }
    }
    g.winners = winners;
    saveGiveaways();

    const dClient = client || getAnyActiveDiscordClient();
    if (!dClient) return;

    try {
        const chan = dClient.channels.cache.get(g.channelId) || await dClient.channels.fetch(g.channelId).catch(() => null);
        if (!chan || !chan.isTextBased()) return;

        if (g.messageId) {
            const msg = await chan.messages.fetch(g.messageId).catch(() => null);
            if (msg) {
                await msg.edit({
                    embeds: [sanitizeEmbed(buildEndedGiveawayEmbed(g))],
                    components: buildEndedGiveawayButtons(g)
                }).catch(() => {});
            }
        }

        if (winners.length > 0) {
            const winnerPings = winners.map(w => `<@${w}>`).join(' ');
            await chan.send({
                content: `🎉 **GIVEAWAY CONCLUDED!**\nCongratulations ${winnerPings}! You won **${g.prize}** (hosted by <@${g.hostId}>)! 🥳`
            }).catch(() => {});
        } else {
            await chan.send({
                content: `⚠️ **GIVEAWAY CONCLUDED:** The giveaway for **${g.prize}** ended with no entries.`
            }).catch(() => {});
        }
    } catch(err) {
        console.error(`[End Giveaway ${gId} Error]`, err.message);
    }
}

async function launchGiveaway(interaction, prize, durationStr, winnersCount) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
    }

    const replyNotice = async (text) => {
        try {
            if (interaction.deferred) {
                return await interaction.editReply({ content: text });
            } else if (interaction.replied) {
                return await interaction.followUp({ content: text, ephemeral: true });
            } else {
                return await interaction.reply({ content: text, ephemeral: true });
            }
        } catch(e) {}
    };

    const durationMs = parseGiveawayDuration(durationStr);
    if (!durationMs) {
        return await replyNotice(`⚠️ Invalid duration format "${durationStr}". Please use formats like: \`10m\` (10 minutes), \`1h\` (1 hour), \`1d\` (1 day).`);
    }

    const giveawayId = `gw_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const endsAt = Date.now() + durationMs;

    const giveaway = {
        id: giveawayId,
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        hostId: interaction.user.id,
        hostUsername: interaction.user.username,
        prize,
        winnersCount: Math.max(1, Math.min(20, parseInt(winnersCount, 10) || 1)),
        durationMs,
        createdAt: Date.now(),
        endsAt,
        entries: [],
        ended: false,
        winners: []
    };

    const embed = buildGiveawayEmbed(giveaway);
    const components = buildGiveawayButtons(giveaway);

    try {
        const channel = interaction.channel;
        if (!channel || !channel.isTextBased()) {
            return await replyNotice("⚠️ Could not post giveaway in this channel.");
        }

        const msg = await channel.send({
            content: `🎉 **NEW GIVEAWAY!** Hosted by <@${interaction.user.id}>`,
            embeds: [sanitizeEmbed(embed)],
            components
        });

        giveaway.messageId = msg.id;
        activeGiveaways[giveawayId] = giveaway;
        saveGiveaways();

        return await replyNotice(`✅ Your giveaway for **${prize}** has been posted!`);
    } catch(err) {
        console.error("[Giveaway Launch Error]", err.message);
        return await replyNotice(`⚠️ Failed to launch giveaway: ${err.message}`);
    }
}

// Load persisted giveaways and start auto-expiry loop
loadGiveaways();
setInterval(() => {
    try {
        const now = Date.now();
        if (activeGiveaways && typeof activeGiveaways === 'object') {
            for (const [id, g] of Object.entries(activeGiveaways)) {
                if (g && typeof g === 'object' && !g.ended && g.endsAt && g.endsAt <= now) {
                    endGiveaway(id).catch(e => console.error(`[Giveaway Auto-End Error: ${id}]`, e.message));
                }
            }
        }
    } catch(e) {
        console.error("[Giveaway Loop Error]", e.message);
    }
}, 5000);

// ─── Battle Stats Tracker & Progression Engine (TornStats Parity) ─────────────
function formatTimeSince(ms) {
    const sec = Math.max(1, Math.floor(ms / 1000));
    if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'} ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

function getStatArchetype(str, def, spd, dex) {
    const total = str + def + spd + dex;
    if (total <= 0) return 'Novice';
    const pStr = str / total;
    const pDef = def / total;
    const pSpd = spd / total;
    const pDex = dex / total;

    if (pDef >= 0.45) return '🛡️ Baldr (Heavy Defense Tank)';
    if (pStr >= 0.45) return '💥 Heavy Hitter (Strength Specialist)';
    if (pSpd >= 0.45) return '⚡ Speedster (Speed Specialist)';
    if (pDex >= 0.45) return '🎯 Ghost (Dexterity Specialist)';
    if (pStr + pDef >= 0.65) return '🥊 Hank (Strength + Defense Brawler)';
    if (pSpd + pDex >= 0.65) return '💨 Agile Rogue (Speed + Dexterity)';
    if (pStr + pSpd >= 0.65) return '⚡ Glass Cannon (Strength + Speed)';
    if (pDef + pDex >= 0.65) return '🧱 Wall (Defense + Dexterity)';
    const maxP = Math.max(pStr, pDef, pSpd, pDex);
    const minP = Math.min(pStr, pDef, pSpd, pDex);
    if (maxP - minP <= 0.10) return '⚖️ All-Rounder (Balanced Build)';
    return '📈 Hybrid Build';
}

async function handleBattleStatsUpdate(interaction, options = {}) {
    const { forceUpdate = true, keyInput = null, isPublic = true, isButton = false } = options;

    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: false }).catch(() => {});
        }

        const invokerName = interaction.member?.displayName || interaction.user?.username || 'Member';

        // 1. If keyInput is provided, attempt to link it directly
        if (keyInput) {
            const cleanKey = keyInput.trim();
            if (cleanKey.length !== 16 || !/^[a-zA-Z0-9]+$/.test(cleanKey)) {
                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.error('Invalid API Key', 'Torn API keys must be exactly 16 alphanumeric characters.'))]
                });
            }
            const linkRes = await userKeys.linkUserApiKey(interaction.user.id, cleanKey);
            if (!linkRes.success) {
                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.error('Key Linking Failed', `⚠️ **Could not link API key:** ${linkRes.error}\n\nPlease verify your key at [Torn Preferences](https://www.torn.com/preferences.php#tab=api) and ensure it has **Limited Access**.`))]
                });
            }
        }

        // 2. Resolve user's API key
        const resolved = userKeys.resolveUserApiKey(interaction.user.id, invokerName, interaction.user.username);
        if (!resolved) {
            const linkEmbed = UI.warning(
                '🔑 Torn Limited API Key Required',
                `Hey **${invokerName}**, to look up your live battle stats and track your training gains, you need to link your Torn **Limited Access API Key**.\n\n` +
                `🔒 **Zero Public Exposure:** Your key is encrypted with **military-grade AES-256-GCM** and stored in secure memory/database. F.R.I.D.A.Y only accesses it to calculate your stats.\n\n` +
                `Provide it privately via \`/linkkey\` or click **Link Limited Key** below:`
            );
            const actionRow = UI.actionRow(
                UI.primaryBtn('btn_link_user_api_key', 'Link Limited API Key', '🔑'),
                UI.linkBtn('https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2', 'Create Key on Torn', '🌐')
            );
            return await interaction.editReply({ embeds: [sanitizeEmbed(linkEmbed)], components: [actionRow] });
        }

        // 3. Fetch live profile and battlestats from Torn API
        let rawData = null;
        try {
            const url = `https://api.torn.com/user/?selections=profile,battlestats&key=${resolved.key}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            rawData = await res.json();
        } catch(e) {
            return await interaction.editReply({
                embeds: [sanitizeEmbed(UI.error('Connection Failed', `Could not reach Torn API: ${e.message}. Please try again in a moment.`))]
            });
        }

        if (!rawData || rawData.error || !rawData.player_id) {
            const errDetail = rawData?.error?.error || 'Unknown Torn API error';
            return await interaction.editReply({
                embeds: [sanitizeEmbed(UI.error('Fetch Failed', `⚠️ Torn API returned: ${errDetail}\n\nIf you recently rotated your key, please update it with \`/linkkey\`.`))]
            });
        }

        const playerId = rawData.player_id;
        const playerName = rawData.name || invokerName;
        const str = Number(rawData.strength || 0);
        const def = Number(rawData.defense || 0);
        const spd = Number(rawData.speed || 0);
        const dex = Number(rawData.dexterity || 0);
        const total = Number(rawData.total || (str + def + spd + dex));
        const modStr = Number(rawData.strength_modifier || 0);
        const modDef = Number(rawData.defense_modifier || 0);
        const modSpd = Number(rawData.speed_modifier || 0);
        const modDex = Number(rawData.dexterity_modifier || 0);

        const recordKey = String(playerId);
        const prevRecord = battleStatsHistory[recordKey];

        // 4. View Mode: show existing record or current stats without recording new baseline
        if (!forceUpdate) {
            const lastUpdatedTime = prevRecord?.lastUpdated ? formatTimeSince(Date.now() - prevRecord.lastUpdated) : null;
            const safeTotal = total > 0 ? total : 1;
            const pctStr = ((str / safeTotal) * 100).toFixed(1);
            const pctDef = ((def / safeTotal) * 100).toFixed(1);
            const pctSpd = ((spd / safeTotal) * 100).toFixed(1);
            const pctDex = ((dex / safeTotal) * 100).toFixed(1);
            const formatMod = (m) => m > 0 ? ` (+${m}%)` : (m < 0 ? ` (${m}%)` : '');

            const archetype = getStatArchetype(str, def, spd, dex);
            const snapshotTs = prevRecord?.lastUpdated ? `<t:${Math.floor(prevRecord.lastUpdated / 1000)}:R>` : 'Live';
            const updateHint = lastUpdatedTime ? `Updated ${lastUpdatedTime}` : 'No baseline yet — run `/bs update` to track gains';

            const embed = {
                title: `📊 ${playerName} [${playerId}]`,
                description: [
                    `**Total:** \`${total.toLocaleString('en-US')}\`  ·  ${archetype}  ·  ${snapshotTs}`,
                    ``,
                    `⚔️ \`${str.toLocaleString('en-US')}\`${formatMod(modStr)} (${pctStr}%)  🛡️ \`${def.toLocaleString('en-US')}\`${formatMod(modDef)} (${pctDef}%)`,
                    `⚡ \`${spd.toLocaleString('en-US')}\`${formatMod(modSpd)} (${pctSpd}%)  🎯 \`${dex.toLocaleString('en-US')}\`${formatMod(modDex)} (${pctDex}%)`,
                    ``,
                    `-# ${updateHint}`
                ].join('\n'),
                color: UI.COLORS.INFO,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
            };

            const actionRow = UI.actionRow(
                UI.primaryBtn(`btn_bs_update_${playerId}`, '🔄 Update', '🔄'),
                UI.linkBtn(`https://www.torn.com/profiles.php?XID=${playerId}`, '👤 Profile', '👤'),
                UI.linkBtn('https://www.torn.com/gym.php', '🏋️ Gym', '🏋️')
            );

            return await interaction.editReply({ embeds: [sanitizeEmbed(embed)], components: [actionRow] });
        }

        // 5. Update Mode: Calculate gains against previous record
        let diffStr = 0, diffDef = 0, diffSpd = 0, diffDex = 0, diffTotal = 0;
        let hasPrevious = false;
        let elapsedMs = 0;
        let timeAgo = '';

        if (prevRecord && prevRecord.stats && prevRecord.lastUpdated) {
            hasPrevious = true;
            diffStr = str - (Number(prevRecord.stats.strength) || 0);
            diffDef = def - (Number(prevRecord.stats.defense) || 0);
            diffSpd = spd - (Number(prevRecord.stats.speed) || 0);
            diffDex = dex - (Number(prevRecord.stats.dexterity) || 0);
            diffTotal = total - (Number(prevRecord.stats.total) || 0);
            elapsedMs = Math.max(0, Date.now() - prevRecord.lastUpdated);
            timeAgo = formatTimeSince(elapsedMs);
        }

        let descMessage = '';
        if (!hasPrevious) {
            descMessage = `**Your stats have been updated!**\n` +
                `🎉 Your initial battle stats baseline has been recorded! Run \`/bs update\` again after training to track your stat gains.\n\n` +
                `**Total Battle Stats:** **\`${total.toLocaleString('en-US')}\`**`;
        } else {
            const gainsParts = [];
            if (diffStr > 0) gainsParts.push(`**${diffStr.toLocaleString('en-US')}** strength`);
            if (diffDef > 0) gainsParts.push(`**${diffDef.toLocaleString('en-US')}** defense`);
            if (diffSpd > 0) gainsParts.push(`**${diffSpd.toLocaleString('en-US')}** speed`);
            if (diffDex > 0) gainsParts.push(`**${diffDex.toLocaleString('en-US')}** dexterity`);

            if (gainsParts.length > 0) {
                const gainsStr = gainsParts.join(', ');
                const totalStr = `**${diffTotal.toLocaleString('en-US')}**`;
                descMessage = `**Your stats have been updated!** You have gained ${gainsStr} since your last manual update **${timeAgo}**. You have gained a total of ${totalStr} stats.\n\n` +
                    `**Total Battle Stats:** **\`${total.toLocaleString('en-US')}\`**`;
            } else if (diffTotal === 0) {
                descMessage = `**Your stats have been updated!** No stat gains recorded since your last manual update **${timeAgo}**.\n\n` +
                    `**Total Battle Stats:** **\`${total.toLocaleString('en-US')}\`**`;
            } else if (diffTotal < 0) {
                descMessage = `**Your stats have been updated!** Your total stats decreased by **${Math.abs(diffTotal).toLocaleString('en-US')}** since your last manual update **${timeAgo}** (likely due to an overdose or debuff).\n\n` +
                    `**Total Battle Stats:** **\`${total.toLocaleString('en-US')}\`**`;
            } else {
                descMessage = `**Your stats have been updated!** You have gained a total of **${diffTotal.toLocaleString('en-US')}** stats since your last manual update **${timeAgo}**.\n\n` +
                    `**Total Battle Stats:** **\`${total.toLocaleString('en-US')}\`**`;
            }
        }

        // 6. Save update to history
        if (!battleStatsHistory[recordKey]) {
            battleStatsHistory[recordKey] = {
                playerId,
                playerName,
                discordUserId: interaction.user.id,
                history: []
            };
        }
        if (!Array.isArray(battleStatsHistory[recordKey].history)) {
            battleStatsHistory[recordKey].history = [];
        }

        if (hasPrevious) {
            battleStatsHistory[recordKey].history.unshift({
                timestamp: prevRecord.lastUpdated,
                strength: prevRecord.stats.strength,
                defense: prevRecord.stats.defense,
                speed: prevRecord.stats.speed,
                dexterity: prevRecord.stats.dexterity,
                total: prevRecord.stats.total,
                gains: {
                    strength: diffStr,
                    defense: diffDef,
                    speed: diffSpd,
                    dexterity: diffDex,
                    total: diffTotal
                }
            });
            if (battleStatsHistory[recordKey].history.length > 50) {
                battleStatsHistory[recordKey].history = battleStatsHistory[recordKey].history.slice(0, 50);
            }
        }

        battleStatsHistory[recordKey].playerName = playerName;
        battleStatsHistory[recordKey].discordUserId = interaction.user.id;
        battleStatsHistory[recordKey].lastUpdated = Date.now();
        battleStatsHistory[recordKey].stats = {
            strength: str,
            defense: def,
            speed: spd,
            dexterity: dex,
            total: total,
            modifiers: {
                strength: modStr,
                defense: modDef,
                speed: modSpd,
                dexterity: modDex
            }
        };
        battleStatsHistory['discord_' + interaction.user.id] = playerId;

        saveBattleStatsHistory();

        // 7. Render response embed
        const safeTotal = total > 0 ? total : 1;
        const pctStr = ((str / safeTotal) * 100).toFixed(1);
        const pctDef = ((def / safeTotal) * 100).toFixed(1);
        const pctSpd = ((spd / safeTotal) * 100).toFixed(1);
        const pctDex = ((dex / safeTotal) * 100).toFixed(1);

        const strDiffTag = diffStr > 0 ? ` \`[+${diffStr.toLocaleString('en-US')}]\`` : '';
        const defDiffTag = diffDef > 0 ? ` \`[+${diffDef.toLocaleString('en-US')}]\`` : '';
        const spdDiffTag = diffSpd > 0 ? ` \`[+${diffSpd.toLocaleString('en-US')}]\`` : '';
        const dexDiffTag = diffDex > 0 ? ` \`[+${diffDex.toLocaleString('en-US')}]\`` : '';
        const totalDiffTag = diffTotal > 0 ? ` \`[+${diffTotal.toLocaleString('en-US')} total gain]\`` : '';

        const formatMod = (m) => m > 0 ? ` (+${m}%)` : (m < 0 ? ` (${m}%)` : '');

        const archetype = getStatArchetype(str, def, spd, dex);

        const embed = {
            title: `📊 ${playerName} [${playerId}]`,
            description: [
                `**Total:** \`${total.toLocaleString('en-US')}\`${totalDiffTag}  ·  ${archetype}`,
                ``,
                `⚔️ \`${str.toLocaleString('en-US')}\`${formatMod(modStr)} (${pctStr}%)${strDiffTag}  🛡️ \`${def.toLocaleString('en-US')}\`${formatMod(modDef)} (${pctDef}%)${defDiffTag}`,
                `⚡ \`${spd.toLocaleString('en-US')}\`${formatMod(modSpd)} (${pctSpd}%)${spdDiffTag}  🎯 \`${dex.toLocaleString('en-US')}\`${formatMod(modDex)} (${pctDex}%)${dexDiffTag}`,
                ``,
                descMessage ? `-# ${descMessage.replace(/\*\*/g, '').replace(/\n/g, ' ').substring(0, 200)}` : `-# Stats recorded.`
            ].join('\n'),
            color: (diffTotal > 0 || !hasPrevious) ? UI.COLORS.SUCCESS : UI.COLORS.BRAND,
            footer: UI.FOOTER,
            timestamp: new Date().toISOString()
        };

        return await interaction.editReply({
            embeds: [sanitizeEmbed(embed)],
            components: []
        });

    } catch(err) {
        console.error('[BattleStats] Error in handleBattleStatsUpdate:', err);
        return await interaction.editReply({
            embeds: [sanitizeEmbed(UI.error('Command Error', `An unexpected error occurred while processing battle stats: ${err.message}`))]
        }).catch(() => {});
    }
}

let lastSlashRegisterTime = 0;
async function registerSlashCommands(token, guildId = null, options = {}) {
    const rest = new REST({ version: '10' }).setToken(token);

    const commands = buildSlashCommands();

    const disabledCmds = (Array.isArray(discordConfig.disabledCommands) ? discordConfig.disabledCommands : [])
        .map(c => String(c).toLowerCase().trim());
    const activeCommands = commands.filter(cmd => !disabledCmds.includes(cmd.name.toLowerCase()));

    try {
        let applicationId = slashCommandBot?.user?.id;
        if (!applicationId) {
            const meData = await safeDiscordFetch('https://discord.com/api/v10/users/@me', token, { timeoutMs: 8000 });
            applicationId = meData?.id;
        }
        if (!applicationId) throw new Error("Could not get bot application ID. Check your bot token in Settings.");

        const targetGuildId = guildId || discordConfig.guildId || null;

        if (targetGuildId) {
            await safeDiscordFetch(`https://discord.com/api/v10/applications/${applicationId}/guilds/${targetGuildId}/commands`, token, {
                method: 'PUT',
                body: activeCommands,
                timeoutMs: 15000
            });
            console.log(`[Slash Commands] Registered ${activeCommands.length}/${commands.length} guild commands for guild ${targetGuildId} (${disabledCmds.length} disabled)`);
            
            // Only clean global commands if explicitly requested (e.g. Purge Duplicates) to avoid double-hitting rate limits
            if (options.cleanGlobal) {
                setTimeout(() => {
                    safeDiscordFetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, token, {
                        method: 'PUT',
                        body: [],
                        timeoutMs: 10000
                    }).catch(() => {});
                }, 1500);
            }
        } else {
            await safeDiscordFetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, token, {
                method: 'PUT',
                body: activeCommands,
                timeoutMs: 15000
            });
            console.log(`[Slash Commands] Registered ${activeCommands.length}/${commands.length} global commands (${disabledCmds.length} disabled)`);
        }
        lastSlashRegisterTime = Date.now();
        return { success: true, count: activeCommands.length, total: commands.length, disabledCount: disabledCmds.length, guildId: targetGuildId };
    } catch (e) {
        console.error("[Slash Commands] Registration failed:", e.message);
        return { success: false, error: e.message, status: e.status || 500 };
    }
}

// Start the Discord gateway bot for slash command interactions (pre-declared at top of file)
slashCommandBot = null;
slashBotStarted = false;
isStartingSlashBot = false;

function setupSlashBotEvents(bot, token) {
    bot.on('error', (err) => {
        if (err?.code === 10062 || err?.message?.includes('Unknown interaction')) {
            console.warn('[Slash Bot] Non-fatal: Interaction token expired or acknowledged (10062).');
            return;
        }
        console.warn('[Slash Bot] Discord Client Error (resilient):', err?.message || err);
    });
    bot.on('shardError', (err) => {
        console.warn('[Slash Bot] Discord Shard Error (resilient):', err?.message || err);
    });
    bot.on(Events.ShardDisconnect, () => {
        console.warn('[Slash Bot] Gateway shard disconnected. Awaiting automatic reconnect...');
        slashBotStarted = false;
    });

    // Listen for message deletion in Discord to instantly clean up deleted promotion requests
    bot.on(Events.MessageDelete, async (deletedMsg) => {
        try {
            if (!deletedMsg?.id) return;
            await promotionManager.handleDiscordMessageDeleted(deletedMsg.id);
        } catch(e) {
            console.warn('[Promotions] MessageDelete handler error:', e.message);
        }
    });

    bot.on(Events.MessageBulkDelete, async (deletedMsgs) => {
        try {
            if (!deletedMsgs) return;
            for (const msg of deletedMsgs.values()) {
                if (msg?.id) {
                    await promotionManager.handleDiscordMessageDeleted(msg.id);
                }
            }
        } catch(e) {
            console.warn('[Promotions] MessageBulkDelete handler error:', e.message);
        }
    });

    bot.once(Events.ClientReady, async (c) => {
        console.log(`[Slash Bot] Ready as ${c.user.tag}`);
        slashBotStarted = true;

        // Auto-refresh any active bank requests in Discord so existing cards display stacked buttons immediately
        try {
            if (typeof bankRequests === 'object' && bankRequests) {
                for (const req of Object.values(bankRequests)) {
                    if ((req.status === 'pending' || req.status === 'verifying') && req.channelId && req.messageId) {
                        (async () => {
                            try {
                                const ch = bot.channels.cache.get(req.channelId)
                                    || await bot.channels.fetch(req.channelId).catch(() => null);
                                if (ch) {
                                    const m = await ch.messages.fetch(req.messageId).catch(() => null);
                                    if (m) {
                                        await m.edit({
                                            embeds: [sanitizeEmbed(buildBankRequestEmbed(req))],
                                            components: buildBankRequestButtons(req)
                                        }).catch(() => {});
                                    }
                                }
                            } catch(e) {}
                        })();
                    }
                }
            }
        } catch(e) {}

        // Reconcile and clean up any promotion requests whose Discord messages were deleted
        try {
            await promotionManager.reconcilePromotionRequests(bot, discordConfig);
        } catch(e) {
            console.warn('[Promotions] Startup reconciliation error:', e.message);
        }

        // Start Personal Opt-In DM Notifications Worker
        try {
            userAlerts.startUserAlertsWorker(bot, userKeys);
        } catch(e) {
            console.warn('[UserAlerts] Startup error for alerts worker:', e.message);
        }

        try {
            if (c.user.username !== 'F.R.I.D.A.Y') {
                await c.user.setUsername('F.R.I.D.A.Y').catch(() => {});
            }
        } catch(e) {}

        // Guard against duplicate registrations on bot startup/reconnect
        if (Date.now() - lastSlashRegisterTime < 120000) {
            console.log("[Slash Bot] Commands registered recently; skipping redundant ClientReady registration.");
            return;
        }

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

        // ── Start Retaliation Risk Engine (background jobs) ──
        try {
            if (mongoose.connection.readyState === 1) {
                retalEngine.startRetaliationEngine(
                    () => getNextApiKey() || discordConfig.apiKey || TORN_API_KEY,
                    mongoose.connection.db,
                    handleMemberAttackedAlert
                ).catch(e => console.warn('[RetalEngine] Start error:', e.message));
            } else {
                mongoose.connection.once('connected', () => {
                    retalEngine.startRetaliationEngine(
                        () => getNextApiKey() || discordConfig.apiKey || TORN_API_KEY,
                        mongoose.connection.db,
                        handleMemberAttackedAlert
                    ).catch(e => console.warn('[RetalEngine] Start error:', e.message));
                });
            }
        } catch(e) {
            console.warn('[RetalEngine] Startup hook error:', e.message);
        }
    });

    // ── Conversational AI State Management ──
    const channelConvoState = new Map();

    function stripBotMentions(content) {
        if (!content) return "";
        let clean = content;
        if (bot.user?.id) {
            clean = clean.replace(new RegExp(`<@!?${bot.user.id}>`, 'g'), '');
        }
        if (bot.user?.username) {
            clean = clean.replace(new RegExp(`@${bot.user.username}\\b`, 'gi'), '');
        }
        clean = clean.replace(/^(?:hey|hi|yo)?\s*friday\b/i, '');
        return clean.replace(/^[\s,:!-]+/, '').replace(/[\s]+$/, '').trim();
    }

    bot.on(Events.TypingStart, async (typing) => {
        try {
            if (!typing || !typing.channelId) return;
            const typerId = typing.userId || typing.user?.id;
            if (!typerId || typerId === bot.user?.id) return; // Don't track own typing

            const state = channelConvoState.get(typing.channelId);
            if (state) {
                state.lastTypingAt = Date.now();
                if (!state.typingUsers) state.typingUsers = new Map();
                state.typingUsers.set(typerId, Date.now());

                // If Friday has scheduled a reply and isn't actively generating right now,
                // pause and extend so she does not interrupt the member while they type!
                if (state.timer && !state.isReplying) {
                    const elapsed = Date.now() - state.firstQueuedAt;
                    if (elapsed < 20000) {
                        clearTimeout(state.timer);
                        state.timer = setTimeout(() => executeChannelConvoDispatch(typing.channelId), 3000);
                    }
                }
            }
        } catch(err) {
            console.warn("[Slash Bot] TypingStart error:", err.message);
        }
    });

    async function executeChannelConvoDispatch(channelId) {
        const state = channelConvoState.get(channelId);
        if (!state) return;
        if (!state.messages || state.messages.length === 0) {
            channelConvoState.delete(channelId);
            return;
        }

        // If channel is not in activeConversationChannels, and none of the messages are a direct trigger, abort
        let channel = state.messages[0]?.msgObj?.channel || state.channel;
        const isConvoChannel = activeConversationChannels.has(channelId) ||
                               Boolean(channel?.parentId && activeConversationChannels.has(channel.parentId));
        const hasDirectTrigger = state.messages.some(m => m.isMention);
        if (!isConvoChannel && !hasDirectTrigger) {
            channelConvoState.delete(channelId);
            return;
        }

        // Check if any other user is STILL actively typing who hasn't sent their message yet
        if (!state.typingUsers) state.typingUsers = new Map();
        const now = Date.now();
        const activeTypers = Array.from(state.typingUsers.entries())
            .filter(([uid, ts]) => uid !== bot.user?.id && (now - ts < 3000));
        const totalElapsed = now - state.firstQueuedAt;

        if (activeTypers.length > 0 && totalElapsed < 20000) {
            state.timer = setTimeout(() => executeChannelConvoDispatch(channelId), 2500);
            return;
        }

        state.isReplying = true;
        const batch = state.messages.splice(0, state.messages.length);
        const latestMsg = batch[batch.length - 1].msgObj;
        channel = latestMsg?.channel || channel;

        try {
            if (channel && channel.sendTyping) {
                await channel.sendTyping().catch(() => {});
            }

            // Gather recent channel conversation transcript (excluding current batch)
            const convoLines = [];
            const sessionStart = convoSessionStartTimestamps.get(channelId) || 0;
            const now = Date.now();
            const MAX_CONVO_AGE_MS = 3 * 60 * 1000; // 3 minutes max lookback for active chatter
            const MAX_GAP_MS = 3 * 60 * 1000;       // 3-minute gap indicates a brand new conversation

            // Only fetch channel history if in an active conversation mode channel
            if (isConvoChannel && channel && channel.messages) {
                const fetched = await channel.messages.fetch({ limit: 12, before: batch[0].id }).catch(() => null);
                if (fetched && fetched.size > 0) {
                    const sorted = Array.from(fetched.values()).reverse();
                    const batchStartTs = batch[0]?.timestamp || now;
                    let candidateMessages = [];

                    for (const m of sorted) {
                        const mTs = m.createdTimestamp || 0;
                        // 1. HARD CUTOFF: Never include messages from before conversation mode was enabled/reset
                        if (sessionStart && mTs < sessionStart) continue;
                        // 2. HARD CUTOFF: Never include messages older than 3 minutes
                        if (batchStartTs - mTs > MAX_CONVO_AGE_MS) continue;
                        if (m.author?.bot && m.author?.id !== bot.user?.id) continue;
                        const text = (m.cleanContent || m.content || "").trim();
                        if (!text) continue;
                        candidateMessages.push({
                            ts: mTs,
                            author: m.member?.displayName || m.author?.username || "Member",
                            text
                        });
                    }

                    // 3. GAP PRUNING: If there was an idle pause (> 3 minutes) between any messages, prune everything before the gap
                    let lastTs = null;
                    let activeStream = [];
                    for (const cMsg of candidateMessages) {
                        if (lastTs !== null && (cMsg.ts - lastTs > MAX_GAP_MS)) {
                            activeStream = [];
                        }
                        activeStream.push(cMsg);
                        lastTs = cMsg.ts;
                    }

                    // Also check gap between the last historical message and the current batch
                    if (activeStream.length > 0 && lastTs !== null && (batchStartTs - lastTs > MAX_GAP_MS)) {
                        activeStream = [];
                    }

                    for (const vm of activeStream) {
                        convoLines.push(`${vm.author}: ${vm.text}`);
                    }
                }
            }

            // Append the buffered messages to the conversation transcript
            for (const b of batch) {
                convoLines.push(`${b.authorName}: ${b.text || '(addressed Friday)'}`);
            }

            const primaryAuthor = batch[batch.length - 1].authorName;
            const primaryAuthorId = batch[batch.length - 1].authorId;
            const authorUsername = latestMsg?.author?.username || "";
            const authorBatch = batch.filter(b => b.authorId === primaryAuthorId);
            const authorTexts = authorBatch.map(b => b.text).filter(Boolean);
            const userSpeech = (authorTexts.length > 0 ? authorTexts.join('\n') : batch.map(b => b.text).filter(Boolean).join('\n')) || "(addressed Friday)";

            // ── In-Chat Reset / Forget Command Detection ──
            const cleanSpeechLower = userSpeech.toLowerCase().trim();
            const isResetRequest = /^(?:please\s+)?(?:reset|clear|forget\s+(?:that|everything|past|all)|new\s+(?:topic|conversation|chat)|change\s+(?:the\s+)?topic|stop\s+talking\s+about\s+(?:past\s+stuff|that|old\s+stuff)|clean\s+slate|fresh\s+start)\b/i.test(cleanSpeechLower);

            if (isResetRequest) {
                convoSessionStartTimestamps.set(channelId, Date.now());
                const clearReply = `Understood, **${primaryAuthor}**! Conversation memory cleared for this channel. Clean slate — what's on your mind?`;
                await latestMsg.reply({
                    content: clearReply,
                    allowedMentions: { repliedUser: false }
                }).catch(async () => {
                    if (channel && channel.send) {
                        await channel.send({ content: clearReply }).catch(() => {});
                    }
                });
                return;
            }

            // Check if any message in the batch had a reply reference
            let replyContext = null;
            for (let i = batch.length - 1; i >= 0; i--) {
                if (batch[i].reference) {
                    replyContext = {
                        author: batch[i].reference.authorName,
                        text: batch[i].reference.text,
                        replyText: userSpeech
                    };
                    break;
                }
            }

            // ── Live Personal Account Stats & Torn Gameplay Intelligence ──
            const perksKey = discordConfig.apiKey || ADMIN_API_KEY || TORN_API_KEY || (apiPoolConfig.keys && apiPoolConfig.keys[0]) || "";
            if (perksKey) {
                tornKnowledge.fetchFactionPerks(perksKey).catch(() => {});
            }
            const resolved = userKeys.resolveUserApiKey(primaryAuthorId, primaryAuthor, authorUsername);

            const accountIntent = userKeys.detectUserAccountIntent(userSpeech);
            const tornGameplayIntent = tornKnowledge.detectTornGameplayIntent(userSpeech);
            const isAccountInquiry = Boolean(accountIntent || /\b(?:my|i|me|mine|stats?|merits?|energy|nerve|happy|cooldowns?|battlestats?|workstats?|vault|money|cash|refills?|crimes?|xanax|overdoses?|education|job)\b/i.test(userSpeech));

            let userAccountData = null;

            if (resolved && (isAccountInquiry || tornGameplayIntent)) {
                // User HAS an API key or is the owner! Fetch real-time live stats!
                userAccountData = await userKeys.fetchUserLiveStats(resolved.key, userSpeech);
            } else if (!resolved && accountIntent && !tornGameplayIntent) {
                // User asked an account-specific stat (e.g. energy/bars/merits) but has no linked key
                const linkEmbed = UI.warning(
                    '🔑 Torn Limited API Key Required',
                    `Hey **${primaryAuthor}**, to check your live personal merits, battle stats, energy, nerve, cooldowns, or account stats, I need your Torn **Limited Access API Key**.\n\n` +
                    `🔒 **Zero Public Exposure:** Your key is entered in a private Discord popup, encrypted with **military-grade AES-256-GCM**, and stored securely. F.R.I.D.A.Y only accesses it when you ask for your stats.\n\n` +
                    `Click **Link Limited Key** below to enter it privately:`
                );

                const actionRow = UI.actionRow(
                    UI.primaryBtn('btn_link_user_api_key', 'Link Limited API Key', '🔑'),
                    UI.linkBtn('https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2', 'Create Key on Torn', '🌐')
                );

                await latestMsg.reply({
                    embeds: [sanitizeEmbed(linkEmbed)],
                    components: [actionRow],
                    allowedMentions: { repliedUser: false }
                }).catch(async () => {
                    if (channel && channel.send) {
                        await channel.send({ embeds: [sanitizeEmbed(linkEmbed)], components: [actionRow] }).catch(() => {});
                    }
                });
                return;
            }

            const casualIntent = tornKnowledge.detectCasualIntent(userSpeech);
            const isCasualGreeting = casualIntent === 'greeting';
            const promptConvoLines = isCasualGreeting ? [] : convoLines;

            let aiReply = "";
            try {
                aiReply = await generateChatResponse(promptConvoLines, "", primaryAuthor, replyContext, userAccountData, accountIntent, userSpeech);
            } catch(genErr) {
                console.warn("[Conversation] generateChatResponse error:", genErr.message);
            }

            if ((!aiReply || !aiReply.trim())) {
                if (tornGameplayIntent) {
                    aiReply = tornKnowledge.formatDeterministicTornAnswer(userSpeech, userAccountData, primaryAuthor);
                } else if (userAccountData && accountIntent) {
                    aiReply = userKeys.formatDeterministicStatsReply(userAccountData, primaryAuthor, accountIntent, userSpeech);
                } else if (tornKnowledge.detectCasualIntent(userSpeech)) {
                    aiReply = tornKnowledge.formatDeterministicCasualReply(userSpeech, primaryAuthor);
                }
            }

            if (aiReply && aiReply.trim()) {
                await latestMsg.reply({
                    content: aiReply.trim(),
                    allowedMentions: { repliedUser: false }
                }).catch(async () => {
                    if (channel && channel.send) {
                        await channel.send({ content: aiReply.trim() }).catch(() => {});
                    }
                });
            } else if (batch.some(b => b.isMention)) {
                // If explicitly @mentioned or addressed by name, give a friendly in-character greeting
                const friendlyGreeting = (userSpeech && userSpeech.length > 20)
                    ? `I hear you, **${primaryAuthor}**! My neural link had a brief hiccup while processing that. Give me a shout again in a second!`
                    : `Hey ${primaryAuthor}! I'm listening. What's on your mind?`;
                await latestMsg.reply({
                    content: friendlyGreeting,
                    allowedMentions: { repliedUser: false }
                }).catch(() => {});
            }

        } catch(err) {
            console.error(`[Conversation] Error replying in channel ${channelId}:`, err.message);
            if (batch.some(b => b.isMention)) {
                await latestMsg.reply({
                    content: "⚠️ My neural link had a brief hiccup. Give me another shout in a second.",
                    allowedMentions: { repliedUser: false }
                }).catch(() => {});
            }
        } finally {
            state.isReplying = false;
            if (state.messages && state.messages.length > 0) {
                state.firstQueuedAt = Date.now();
                state.timer = setTimeout(() => executeChannelConvoDispatch(channelId), 2500);
            } else {
                channelConvoState.delete(channelId);
            }
        }
    }

    bot.on(Events.MessageCreate, async (msg) => {
        if (msg.author?.bot) return;
        const text = (msg.content || '').trim().toLowerCase();

        // 1. Direct mention (@F.R.I.D.A.Y, <@ID>, or explicit @friday tag)
        const botId = bot.user?.id;
        const botUsername = bot.user?.username;
        const isBotDirectlyMentioned = Boolean(
            (botId && (msg.mentions?.users?.has(botId) || new RegExp(`<@!?${botId}>`).test(msg.content || ''))) ||
            (botUsername && new RegExp(`@${botUsername}\\b`, 'i').test(msg.content || '')) ||
            /@friday\b/i.test(msg.content || '')
        );
        const isBotMentioned = isBotDirectlyMentioned;

        const isKill = text === '!kill' || text === '/kill' || text === '!mute' || text === '!pause' || text === '/pause' || (text.startsWith('kill') && isBotDirectlyMentioned);
        const isLive = text === '!live' || text === '/live' || text === '!resume' || text === '/resume' || (text.startsWith('live') && isBotDirectlyMentioned);

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

        // Ignore commands starting with ! or / so we don't interfere with prefix commands
        if (msg.content.startsWith('!') || msg.content.startsWith('/')) return;

        // Pings that aren't her:
        // - @everyone or @here
        const hasEveryoneOrHerePing = Boolean(
            msg.mentions?.everyone || 
            /@(?:everyone|here)\b/i.test(msg.content || '')
        );

        // - Role mentions (<@&roleId>)
        const hasRolePing = Boolean(
            (msg.mentions?.roles && msg.mentions.roles.size > 0) || 
            /<@&\d+>/.test(msg.content || '')
        );

        // - Mentions of other users (excluding Friday herself)
        const hasOtherUserPing = Boolean(
            (msg.mentions?.users && Array.from(msg.mentions.users.keys()).some(id => id !== botId)) ||
            (/<@!?(\d+)>/.test(msg.content || '') && !isBotDirectlyMentioned)
        );

        const hasNonBotPing = hasEveryoneOrHerePing || hasRolePing || hasOtherUserPing;

        // CRITICAL RULE: If the message contains any pings that aren't directly her
        // (like @everyone, @here, roles, or other users) and Friday was NOT directly mentioned,
        // do NOT respond under ANY circumstances (even in active conversation mode channels).
        if (hasNonBotPing && !isBotDirectlyMentioned) return;

        // 2. Addressed directly at the start of message (e.g. "Friday, ...", "Hey Friday, ...", "Hi Friday")
        const isAddressedToFriday = /^(?:hey|hi|yo)?\s*friday\b/i.test(msg.content.trim());

        // 3. Replying directly to a message sent by Friday
        let isReplyingToFriday = false;
        let refInfo = null;

        if (msg.reference && msg.reference.messageId) {
            try {
                const parentMsg = await msg.channel.messages.fetch(msg.reference.messageId).catch(() => null);
                if (parentMsg) {
                    if (parentMsg.author?.id === bot.user?.id) {
                        isReplyingToFriday = true;
                    }
                    refInfo = {
                        authorName: parentMsg.member?.displayName || parentMsg.author?.username || "Member",
                        text: (parentMsg.cleanContent || parentMsg.content || "").trim()
                    };
                }
            } catch(e) {}
        }

        // 4. Channel has /conversation mode enabled (including threads under active channels)
        const isConvoChannel = activeConversationChannels.has(msg.channelId) ||
                               Boolean(msg.channel?.parentId && activeConversationChannels.has(msg.channel.parentId));

        const isDirectTrigger = isBotMentioned || isAddressedToFriday || isReplyingToFriday;
        const shouldRespond = isDirectTrigger || isConvoChannel;

        // CRITICAL: If not explicitly addressed and channel is NOT in conversation mode, DO NOT RESPOND!
        if (!shouldRespond) return;

        // If bot notifications are emergency muted, ignore unprompted channel chatter
        if (global.isNotificationsKilled && !isDirectTrigger) return;

        const cleanText = stripBotMentions(msg.cleanContent || msg.content || "");
        if (!cleanText && !isDirectTrigger) return;

        let state = channelConvoState.get(msg.channelId);
        if (!state) {
            state = {
                timer: null,
                messages: [],
                typingUsers: new Map(),
                lastTypingAt: 0,
                firstQueuedAt: Date.now(),
                isReplying: false,
                channel: msg.channel
            };
            channelConvoState.set(msg.channelId, state);
        }

        // Since this user just sent their message, clear their active typing status
        if (state.typingUsers) {
            state.typingUsers.delete(msg.author.id);
        }

        state.messages.push({
            id: msg.id,
            authorName: msg.member?.displayName || msg.author?.username || "Member",
            authorId: msg.author.id,
            text: cleanText,
            isMention: isDirectTrigger,
            reference: refInfo,
            msgObj: msg,
            timestamp: Date.now()
        });

        // Debounce: wait 2500ms for author/typing to settle before dispatching response
        if (!state.isReplying) {
            if (state.timer) clearTimeout(state.timer);
            const delay = 2500;
            state.timer = setTimeout(() => executeChannelConvoDispatch(msg.channelId), delay);
        }
    });

    bot.on(Events.GuildMemberAdd, async (member) => {
        try {
            await handleGuildMemberAdd(member);
        } catch(err) {
            console.error("[Slash Bot] Error in handleGuildMemberAdd:", err.message);
        }
    });

    bot.on(Events.InteractionCreate, async (interaction) => {

        // ── Modal Submit Handling (Torn Verification Modal & Giveaways) ──
        if (interaction.type === InteractionType.ModalSubmit || interaction.isModalSubmit?.()) {
            if (interaction.customId === 'modal_create_giveaway') {
                const prize = (interaction.fields.getTextInputValue('giveaway_prize') || '').trim();
                const durationStr = (interaction.fields.getTextInputValue('giveaway_duration') || '').trim();
                let winnersCount = parseInt(interaction.fields.getTextInputValue('giveaway_winners') || '1', 10);
                if (isNaN(winnersCount) || winnersCount < 1) winnersCount = 1;
                if (winnersCount > 20) winnersCount = 20;
                await launchGiveaway(interaction, prize, durationStr, winnersCount);
                return;
            }

            if (interaction.customId === 'modal_verify_user') {
                await interaction.deferReply({ ephemeral: true });
                const playerInput = (interaction.fields.getTextInputValue('torn_player_input') || '').trim();
                const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
                const result = await executeVerifyMember(interaction.member || interaction.user, interaction.guild, playerInput, apiKey);

                if (result && result.success && result.isNewVerification && interaction.guild) {
                    const vChanId = discordConfig.verificationChannelId;
                    if (vChanId) {
                        try {
                            const chan = interaction.guild.channels.cache.get(vChanId) || await interaction.guild.channels.fetch(vChanId).catch(() => null);
                            if (chan && chan.isTextBased()) {
                                await chan.send({
                                    content: `🎉 <@${interaction.user.id}> has successfully verified as **[${result.playerName} [${result.playerId}]](https://www.torn.com/profiles.php?XID=${result.playerId})**! Full server access granted.`
                                });
                            }
                        } catch(e) {}
                    }
                }
                const replyPayload = { embeds: [sanitizeEmbed(result)] };
                if (result.components && result.components.length > 0) {
                    replyPayload.components = result.components;
                }
                return await interaction.editReply(replyPayload);
            }

            if (interaction.customId === 'modal_link_user_api_key') {
                await interaction.deferReply({ ephemeral: true });
                const inputKey = (interaction.fields.getTextInputValue('user_api_key_input') || '').trim();
                const verifyResult = await executeVerifyWithKey(interaction, inputKey);
                const replyPayload = { embeds: [sanitizeEmbed(verifyResult)] };
                if (verifyResult.components && verifyResult.components.length > 0) {
                    replyPayload.components = verifyResult.components;
                }
                return await interaction.editReply(replyPayload);
            }

            // ── Faction Promotion Pitch Submission ──
            if (interaction.customId.startsWith('modal_promo_')) {
                await interaction.deferReply({ ephemeral: true });
                try {
                    const selectedRole = decodeURIComponent(interaction.customId.replace('modal_promo_', ''));
                    const reason = (interaction.fields.getTextInputValue('promo_reason') || '').trim();

                    const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
                    const facId = discordConfig.factionId || dynamicFactionId || 52355;
                    const facData = await promotionManager.getFactionData(apiKey, facId);

                    // Resolve member identity
                    let targetTornId = null;
                    let memberName = interaction.member?.displayName || interaction.user?.username || 'Member';

                    if (verifiedDiscordToTorn[interaction.user.id]) {
                        targetTornId = verifiedDiscordToTorn[interaction.user.id].tornId;
                        memberName = verifiedDiscordToTorn[interaction.user.id].tornName || memberName;
                    }
                    if (!targetTornId && userKeys && typeof userKeys.hasLinkedKey === 'function' && userKeys.hasLinkedKey(interaction.user.id)) {
                        const rec = userKeys.userKeysStore?.get(interaction.user.id);
                        if (rec && rec.tornId) {
                            targetTornId = rec.tornId;
                            memberName = rec.playerName || memberName;
                        }
                    }
                    if (!targetTornId && interaction.member?.displayName) {
                        const match = interaction.member.displayName.match(/\[(\d+)\]|\((\d+)\)/);
                        if (match) targetTornId = match[1] || match[2];
                    }

                    // Fast-track server owner/admin (Owen)
                    if (!targetTornId && (interaction.user.id === '992561850057240578' || (discordConfig.personalDiscordId && interaction.user.id === discordConfig.personalDiscordId))) {
                        targetTornId = '3776908';
                        memberName = 'Owen777';
                    }

                    // Name match against facData.members if still not found
                    if (!targetTornId && facData.members) {
                        const candidateNames = [
                            interaction.member?.displayName,
                            interaction.member?.nickname,
                            interaction.user?.globalName,
                            interaction.user?.username
                        ].filter(Boolean);

                        for (const cName of candidateNames) {
                            const cleanCName = cName.replace(/\[\d+\]|\(\d+\)/g, '').trim().toLowerCase();
                            if (!cleanCName) continue;
                            for (const [mId, mObj] of Object.entries(facData.members)) {
                                const mName = (mObj.name || '').toLowerCase();
                                if (mName && (mName === cleanCName || mName.includes(cleanCName) || cleanCName.includes(mName))) {
                                    targetTornId = mId;
                                    memberName = mObj.name || memberName;
                                    break;
                                }
                            }
                            if (targetTornId) break;
                        }
                    }

                    if (!targetTornId) {
                        return await interaction.editReply({
                            embeds: [sanitizeEmbed(UI.warning(
                                '🛡️ Verification Required',
                                `You must be verified with your Torn account to submit a promotion request. Please click **🛡️ Verify Me** or run \`/verify\` first.`
                            ))]
                        });
                    }

                    const memberObj = facData.members?.[String(targetTornId)] || facData.members?.[targetTornId];
                    if (!memberObj) {
                        return await interaction.editReply({
                            embeds: [sanitizeEmbed(UI.error(
                                'Faction Member Only',
                                `⚠️ You [${targetTornId}] are not listed as an active member of **${facData.name || 'our faction'}** [${facId}].`
                            ))]
                        });
                    }

                    const currentRole = memberObj.position || 'Member';
                    const daysInFaction = memberObj.days_in_faction || 0;
                    const memberLevel = memberObj.level || 0;

                    // Check restricted role
                    if (promotionManager.isRestrictedPromotionRole(selectedRole)) {
                        return await interaction.editReply({
                            embeds: [sanitizeEmbed(UI.error(
                                '🚫 Restricted Role',
                                `Leader and Co-leader positions cannot be requested.`
                            ))]
                        });
                    }

                    // Check already assigned
                    if (selectedRole.toLowerCase() === currentRole.toLowerCase()) {
                        return await interaction.editReply({
                            embeds: [sanitizeEmbed(UI.warning(
                                'Already Assigned',
                                `You are already assigned as **${selectedRole}** in **${facData.name}**!`
                            ))]
                        });
                    }

                    // Check pending (with Discord message existence validation)
                    const existing = await promotionManager.getPendingRequestForPlayer(targetTornId, bot, discordConfig);
                    if (existing) {
                        const cancelRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`btn_promo_cancel_${existing.id}`)
                                .setLabel('Cancel & Withdraw Request')
                                .setStyle(ButtonStyle.Danger)
                                .setEmoji('🗑️'),
                            new ButtonBuilder()
                                .setCustomId(`btn_promo_recheck_${existing.id}`)
                                .setLabel('Recheck Discord Message')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji('🔄')
                        );
                        return await interaction.editReply({
                            embeds: [sanitizeEmbed(UI.warning(
                                'Promotion Request Pending',
                                `⏳ You already have a pending promotion request for **${existing.requestedRole}** submitted <t:${Math.floor(existing.createdAt / 1000)}:R>!\n\n` +
                                `If you deleted the Discord message or wish to withdraw this request, click **Cancel & Withdraw Request** below to immediately clear it.`
                            ))],
                            components: [cancelRow]
                        });
                    }

                    // Calculate rank movement and battle stats progression
                    const rankAdvancement = promotionManager.calculateRankMovement(facData.positions, currentRole, selectedRole);
                    const statsProgression = resolvePlayerStatsProgression(targetTornId, interaction.user.id);

                    // Create request
                    const promoReq = await promotionManager.createPromotionRequest({
                        discordUserId: interaction.user.id,
                        playerId: targetTornId,
                        playerName: memberObj.name || memberName,
                        currentRole,
                        requestedRole: selectedRole,
                        reason,
                        daysInFaction,
                        level: memberLevel,
                        rankAdvancement,
                        statsProgression,
                        guildId: interaction.guild?.id
                    });

                    // Dispatch to leadership channel
                    await promotionManager.dispatchPromotionToLeadership(bot, interaction.guild, promoReq, discordConfig, facData);

                    return await interaction.editReply({
                        embeds: [sanitizeEmbed(UI.success(
                            '🎖️ Promotion Request Submitted!',
                            `Your application to be promoted to **${selectedRole}** has been sent to faction leadership for review!\n\n` +
                            `• **Current Role:** ${currentRole} (${daysInFaction} days in faction)\n` +
                            `• **Target Role:** **${selectedRole}**\n` +
                            (reason ? `• **Pitch:** _"${reason}"_\n` : '') +
                            `\nF.R.I.D.A.Y will notify you once leadership reviews your application.`
                        ))]
                    });
                } catch (err) {
                    console.error('[Slash Bot] modal_promo_ submission error:', err);
                    return await interaction.editReply({
                        embeds: [sanitizeEmbed(UI.error(
                            'Promotion Error',
                            `⚠️ An error occurred while submitting your promotion application: ${err.message || 'Unknown error'}. Please try again shortly.`
                        ))]
                    }).catch(() => {});
                }
            }
        }

        // ── String Select Menu Interactions ──
        if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_promotion_role') {
                try {
                    const selectedRole = interaction.values?.[0];
                    if (!selectedRole) {
                        return interaction.reply({ content: "⚠️ No role was selected.", ephemeral: true }).catch(() => {});
                    }

                    if (promotionManager.isRestrictedPromotionRole(selectedRole)) {
                        return interaction.reply({
                            content: "🚫 Leader and Co-leader positions are appointed directly and cannot be requested.",
                            ephemeral: true
                        }).catch(() => {});
                    }

                    const modal = promotionManager.buildPromotionModal(selectedRole);
                    return await interaction.showModal(modal);
                } catch (err) {
                    console.error('[Slash Bot] select_promotion_role error:', err);
                    return interaction.reply({
                        content: `⚠️ Failed to open promotion modal: ${err.message || 'Unknown error'}`,
                        ephemeral: true
                    }).catch(() => {});
                }
            }
        }

        // ── Autocomplete Interactions ──
        if (interaction.isAutocomplete()) {
            const cmd = interaction.commandName;
            const focusedOption = interaction.options.getFocused(true);

            if (cmd === 'promotion' && focusedOption.name === 'role') {
                const typed = (focusedOption.value || '').toLowerCase().trim();
                const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
                const facId = discordConfig.factionId || dynamicFactionId || 52355;
                try {
                    const facData = await promotionManager.getFactionData(apiKey, facId);
                    const requestableRoles = promotionManager.getRequestableFactionRoles(facData.positions);
                    const filtered = requestableRoles.filter(r => !typed || r.toLowerCase().includes(typed)).slice(0, 24);
                    const options = filtered.map(r => ({ name: r, value: r }));

                    if (!typed || 'cancel'.includes(typed) || 'withdraw'.includes(typed) || 'delete'.includes(typed)) {
                        options.unshift({ name: '🗑️ Cancel / Withdraw Current Promotion Request', value: 'cancel' });
                    }

                    return await interaction.respond(options.slice(0, 25)).catch(() => {});
                } catch (e) {
                    return await interaction.respond([]).catch(() => {});
                }
            }

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

            // ── Link User API Key Button (Opens private Discord Modal) ──
            if (customId === 'btn_link_user_api_key') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_link_user_api_key')
                    .setTitle('Link Torn Limited API Key');

                const keyInput = new TextInputBuilder()
                    .setCustomId('user_api_key_input')
                    .setLabel('Enter Your Limited Access API Key')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('16-character Torn API key')
                    .setMinLength(16)
                    .setMaxLength(16)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
                return await interaction.showModal(modal);
            }

            // ── Personal Alert Toggles (Opt-in DM notifications) ──
            if (customId.startsWith('toggle_alert_')) {
                const feature = customId.replace('toggle_alert_', ''); // 'drug', 'travel', 'energy', 'nerve', 'hospital'
                const invokerName = interaction.member?.displayName || interaction.user?.username || 'Member';
                const resolved = userKeys.resolveUserApiKey(interaction.user.id, invokerName, interaction.user.username);
                
                if (!resolved) {
                    return interaction.reply({
                        content: '⚠️ You must link your Torn Limited Access API key before enabling personal DM alerts. Use `/linkkey` to link your key.',
                        ephemeral: true
                    }).catch(() => {});
                }

                userAlerts.toggleUserAlertPref(interaction.user.id, feature);

                const card = userAlerts.buildAlertsControlCard(interaction.user.id, {
                    playerName: resolved.playerName,
                    playerId: resolved.playerId
                });

                return await interaction.update({
                    embeds: [sanitizeEmbed(card.embed)],
                    components: card.components
                }).catch(() => {});
            }

            // ── Personal Alert Test DM ──
            if (customId === 'test_user_dm') {
                await interaction.deferReply({ ephemeral: true });
                try {
                    const testEmbed = {
                        title: '🧪 F.R.I.D.A.Y. DM Test Successful!',
                        description: `Hello! If you are reading this direct message, your Discord privacy settings allow **F.R.I.D.A.Y.** to send you private notifications.\n\n` +
                            `Any personal alerts you enable (Xanax timer, flight landing, energy full) will be delivered here instantly.`,
                        color: UI.COLORS.SUCCESS,
                        footer: UI.FOOTER,
                        timestamp: new Date().toISOString()
                    };
                    await interaction.user.send({ embeds: [sanitizeEmbed(testEmbed)] });
                    return await interaction.editReply({
                        content: '✅ Test DM sent! Check your Discord direct messages to confirm receipt.'
                    });
                } catch (dmErr) {
                    if (dmErr.code === 50007) {
                        return await interaction.editReply({
                            content: '❌ **Cannot send DM!** Your Discord privacy settings currently block direct messages from server members or bots. Please go to **Discord Settings -> Privacy & Safety** and enable direct messages from server members.'
                        });
                    }
                    return await interaction.editReply({
                        content: `⚠️ Failed to send test DM: ${dmErr.message || 'Unknown error'}`
                    });
                }
            }

            // ── Instant 1-Click Verification (Official Torn Discord Flow) ──
            if (customId === 'btn_verify_now' || customId === 'btn_verify_open_modal') {
                const disabledCmds = (Array.isArray(discordConfig.disabledCommands) ? discordConfig.disabledCommands : []).map(c => String(c).toLowerCase().trim());
                if (disabledCmds.includes('verify')) {
                    return interaction.reply({
                        content: `⚠️ Member verification is currently disabled by faction leadership in the dashboard.`,
                        ephemeral: true
                    }).catch(() => {});
                }
                await interaction.deferReply({ ephemeral: true });
                const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
                const result = await executeVerifyMember(interaction.member || interaction.user, interaction.guild, apiKey);

                if (result && result.success && result.isNewVerification && interaction.guild) {
                    const vChanId = discordConfig.verificationChannelId;
                    if (vChanId) {
                        try {
                            const chan = interaction.guild.channels.cache.get(vChanId) || await interaction.guild.channels.fetch(vChanId).catch(() => null);
                            if (chan && chan.isTextBased()) {
                                await chan.send({
                                    content: `🎉 <@${interaction.user.id}> has successfully verified as **[${result.playerName} [${result.playerId}]](https://www.torn.com/profiles.php?XID=${result.playerId})**! Welcome to the server!`
                                });
                            }
                        } catch(e) {}
                    }
                }

                const replyPayload = { embeds: [sanitizeEmbed(result)] };
                if (result.components && result.components.length > 0) {
                    replyPayload.components = result.components;
                }
                return await interaction.editReply(replyPayload);
            }

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

                const attackLink = `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`;

                // Fetch retal risk in parallel (non-blocking)
                let retalBlock = '';
                try {
                    const rScore = await retalEngine.getRiskScore(targetId, null);
                    if (rScore) {
                        const pct = Math.round((rScore.adjusted_rate || 0) * 100);
                        const pool = rScore.retaliator_pool || [];
                        const tierLabel = rScore.confidence_label || '⚫ Cold start';

                        if (pool.length > 0) {
                            const retaliatorLines = pool.slice(0, 3).map((r, i) => {
                                const icon = i === 0 ? '🔴' : i === 1 ? '🟡' : '🟠';
                                const avgS = rScore.avg_response_seconds;
                                const timeStr = avgS ? ` — hits back in ~${avgS < 60 ? avgS + 's' : Math.round(avgS/60) + 'm'} avg` : '';
                                return `${icon} [Player ${r.id}](https://www.torn.com/profiles.php?XID=${r.id}) — ${r.count} confirmed retaliation${r.count !== 1 ? 's' : ''}${i === 0 ? timeStr : ''}`;
                            });
                            retalBlock = `\n\n**⚠️ Known Retaliators (${pct}% retal rate):**\n${retaliatorLines.join('\n')}\n-# ${tierLabel}`;
                        } else {
                            retalBlock = `\n\n🛡️ **Retal Risk: ${pct}%** — ${tierLabel}\n-# No specific retaliators on record for this target`;
                        }
                    }
                } catch(e) {}

                return interaction.reply({
                    embeds: [{
                        title: `🎯 Target [${targetId}] Claimed!`,
                        description: `**<@${interaction.user.id}>** has claimed **Target [${targetId}]** directly from Discord.\n\n` +
                            `[⚔️ Launch Attack in Torn](${attackLink}) • [👤 Profile](https://www.torn.com/profiles.php?XID=${targetId})${retalBlock}`,
                        color: UI.COLORS.SUCCESS, footer: UI.FOOTER,
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

            // ── Battle Stats Quick Update Button ──
            if (customId.startsWith('btn_bs_update')) {
                await handleBattleStatsUpdate(interaction, { forceUpdate: true, isButton: false, isPublic: true });
                return;
            }

            // ── Bank: Verify & Fulfill ──
            if (customId.startsWith('bank_pay_')) {
                const reqId = customId.replace('bank_pay_', '').trim();
                await interaction.deferUpdate().catch(() => {});
                const res = await executeFulfillRequest(reqId, interaction);
                if (!res.success) {
                    return interaction.followUp({ content: res.message, ephemeral: true }).catch(() => {});
                }
                const updatedReq = bankRequests[reqId];
                if (updatedReq) {
                    await interaction.editReply({
                        embeds: [sanitizeEmbed(buildBankRequestEmbed(updatedReq))],
                        components: buildBankRequestButtons(updatedReq)
                    }).catch(() => {});
                }
                if (res.message) {
                    await interaction.followUp({ content: res.message, ephemeral: true }).catch(() => {});
                }
                return;
            }

            // ── Bank: Instant Log Verification Check ──
            if (customId.startsWith('bank_check_')) {
                const reqId = customId.replace('bank_check_', '').trim();
                await interaction.deferUpdate().catch(() => {});
                const res = await executeFulfillRequest(reqId, interaction);
                const updatedReq = bankRequests[reqId];
                if (updatedReq) {
                    await interaction.editReply({
                        embeds: [sanitizeEmbed(buildBankRequestEmbed(updatedReq))],
                        components: buildBankRequestButtons(updatedReq)
                    }).catch(() => {});
                }
                if (res.message) {
                    await interaction.followUp({ content: res.message, ephemeral: true }).catch(() => {});
                }
                return;
            }

            // ── Bank: Cancel Fulfillment (Unclaim / Revert) ──
            if (customId.startsWith('bank_unclaim_') || customId.startsWith('bank_revert_')) {
                const reqId = customId.replace('bank_unclaim_', '').replace('bank_revert_', '').trim();
                await interaction.deferUpdate().catch(() => {});
                const res = await executeUnclaimFulfillment(reqId, interaction);
                if (!res.success) {
                    return interaction.followUp({ content: res.message, ephemeral: true }).catch(() => {});
                }
                const updatedReq = bankRequests[reqId];
                if (updatedReq) {
                    return interaction.editReply({
                        embeds: [sanitizeEmbed(buildBankRequestEmbed(updatedReq))],
                        components: buildBankRequestButtons(updatedReq)
                    }).catch(() => {});
                }
                return;
            }

            // ── Bank: Clicked In-Progress Button Indicator or Superseded ──
            if (customId.startsWith('bank_claimed_') || customId.startsWith('verifying_display_') || customId.startsWith('superseded_')) {
                return interaction.deferUpdate().catch(() => {});
            }

            // ── Bank Request Cancel (Entire Request Void) ──
            if (customId.startsWith('bank_cancel_')) {
                const reqId = customId.replace('bank_cancel_', '').trim();
                await interaction.deferUpdate().catch(() => {});
                const res = await executeCancelRequest(reqId, interaction);
                if (!res.success) {
                    return interaction.followUp({ content: res.message, ephemeral: true }).catch(() => {});
                }
                const updatedReq = bankRequests[reqId];
                if (updatedReq) {
                    await interaction.editReply({
                        embeds: [sanitizeEmbed(buildBankRequestEmbed(updatedReq))],
                        components: buildBankRequestButtons(updatedReq)
                    }).catch(() => {});
                }
                if (res.message) {
                    await interaction.followUp({ content: res.message, ephemeral: true }).catch(() => {});
                }
                return;
            }

            // ── Giveaway: Enter / Leave ──
            if (customId.startsWith('giveaway_enter_')) {
                const gId = customId.replace('giveaway_enter_', '').trim();
                const g = activeGiveaways[gId];
                if (!g || g.ended) {
                    return interaction.reply({ content: '⚠️ This giveaway has already ended or does not exist.', ephemeral: true }).catch(() => {});
                }
                const userId = interaction.user.id;
                const existingIdx = g.entries.indexOf(userId);
                if (existingIdx !== -1) {
                    g.entries.splice(existingIdx, 1);
                    saveGiveaways();
                    await interaction.message.edit({
                        embeds: [sanitizeEmbed(buildGiveawayEmbed(g))],
                        components: buildGiveawayButtons(g)
                    }).catch(() => {});
                    return interaction.reply({
                        content: `👋 You left the giveaway for **${g.prize}**. Click "Enter" anytime if you want to re-enter!`,
                        ephemeral: true
                    }).catch(() => {});
                } else {
                    g.entries.push(userId);
                    saveGiveaways();
                    await interaction.message.edit({
                        embeds: [sanitizeEmbed(buildGiveawayEmbed(g))],
                        components: buildGiveawayButtons(g)
                    }).catch(() => {});
                    return interaction.reply({
                        content: `🎉 You're entered in the giveaway for **${g.prize}**! Good luck!`,
                        ephemeral: true
                    }).catch(() => {});
                }
            }

            // ── Giveaway: View Entries ──
            if (customId.startsWith('giveaway_list_')) {
                const gId = customId.replace('giveaway_list_', '').trim();
                const g = activeGiveaways[gId];
                if (!g) {
                    return interaction.reply({ content: '⚠️ Giveaway not found.', ephemeral: true }).catch(() => {});
                }
                if (!Array.isArray(g.entries) || g.entries.length === 0) {
                    return interaction.reply({ content: `👥 No participants have entered the giveaway for **${g.prize}** yet. Be the first!`, ephemeral: true }).catch(() => {});
                }
                const entriesList = g.entries.slice(0, 50).map(uId => `<@${uId}>`).join(', ');
                const moreCount = g.entries.length > 50 ? ` and **${g.entries.length - 50}** more` : '';
                return interaction.reply({
                    content: `👥 **Current Participants (${g.entries.length}) for ${g.prize}:**\n${entriesList}${moreCount}`,
                    ephemeral: true
                }).catch(() => {});
            }

            // ── Giveaway: Early End (Host or Admin) ──
            if (customId.startsWith('giveaway_end_')) {
                const gId = customId.replace('giveaway_end_', '').trim();
                const g = activeGiveaways[gId];
                if (!g || g.ended) {
                    return interaction.reply({ content: '⚠️ This giveaway has already ended.', ephemeral: true }).catch(() => {});
                }
                const isHost = g.hostId === interaction.user.id;
                const isAdmin = interaction.member?.permissions?.has?.('Administrator') ||
                                (discordConfig.bankerRoleId && interaction.member?.roles?.cache?.has?.(discordConfig.bankerRoleId));
                if (!isHost && !isAdmin) {
                    return interaction.reply({ content: `⚠️ Only the giveaway host (<@${g.hostId}>) or a server administrator can end this giveaway.`, ephemeral: true }).catch(() => {});
                }
                await interaction.reply({ content: `⏹️ Ending giveaway for **${g.prize}**...`, ephemeral: true }).catch(() => {});
                await endGiveaway(gId, interaction.client);
                return;
            }

            // ── Giveaway: Reroll Winner (Host or Admin) ──
            if (customId.startsWith('giveaway_reroll_')) {
                const gId = customId.replace('giveaway_reroll_', '').trim();
                const g = activeGiveaways[gId];
                if (!g) {
                    return interaction.reply({ content: '⚠️ Giveaway not found.', ephemeral: true }).catch(() => {});
                }
                const isHost = g.hostId === interaction.user.id;
                const isAdmin = interaction.member?.permissions?.has?.('Administrator') ||
                                (discordConfig.bankerRoleId && interaction.member?.roles?.cache?.has?.(discordConfig.bankerRoleId));
                if (!isHost && !isAdmin) {
                    return interaction.reply({ content: '⚠️ Only the giveaway host or a server administrator can reroll winners.', ephemeral: true }).catch(() => {});
                }
                if (!Array.isArray(g.entries) || g.entries.length === 0) {
                    return interaction.reply({ content: '⚠️ No entries exist to reroll a winner from.', ephemeral: true }).catch(() => {});
                }
                const newWinner = g.entries[Math.floor(Math.random() * g.entries.length)];
                if (!Array.isArray(g.winners)) g.winners = [];
                g.winners.push(newWinner);
                saveGiveaways();

                if (interaction.channel && interaction.channel.isTextBased()) {
                    await interaction.channel.send({
                        content: `🎲 **GIVEAWAY REROLL!**\nNew Winner for **${g.prize}**: <@${newWinner}>! Congratulations! 🥳 (Rerolled by <@${interaction.user.id}>)`
                    }).catch(() => {});
                }
                return interaction.reply({ content: `🎲 New winner <@${newWinner}> picked and announced!`, ephemeral: true }).catch(() => {});
            }

            // ── Elimination Target Hunter: Next Target Button ──
            if (customId.startsWith('btn_snipe_next_')) {
                const parts = customId.split('_'); // ['btn', 'snipe', 'next', ownerId, lastTargetId, tier]
                const ownerUserId = parts[3] || '';
                const lastTargetId = parts[4] || '';
                const tier = parts[5] || 'manageable';

                if (interaction.user.id !== ownerUserId) {
                    return interaction.reply({
                        content: `⚠️ This target session belongs to <@${ownerUserId}>. Run \`/snipe\` to find targets tailored to your own stats!`,
                        ephemeral: true
                    }).catch(() => {});
                }

                await interaction.deferUpdate().catch(() => {});

                const invokerName = interaction.member?.displayName || interaction.user?.username || 'Member';
                const resolved = userKeys.resolveUserApiKey(interaction.user.id, invokerName, interaction.user.username);
                if (!resolved) {
                    return interaction.followUp({
                        content: '⚠️ Please link your Torn Limited API key first with `/linkkey`.',
                        ephemeral: true
                    }).catch(() => {});
                }

                const excludeIds = new Set();
                if (lastTargetId) excludeIds.add(lastTargetId);

                const result = await findElimSnipeTargetForUser({
                    apiKey: resolved.key,
                    userId: interaction.user.id,
                    tier,
                    excludeIds
                });

                if (!result || !result.success || !result.targetId) {
                    if (result?.code === 'NOT_IN_ELIMINATION') {
                        return interaction.followUp({
                            embeds: [sanitizeEmbed(UI.warning(
                                '🛑 Not Participating in Elimination',
                                'Your linked Torn account is not currently participating in an active **Torn Elimination** competition. Target finding is disabled until you are enrolled on an active tournament team.'
                            ))],
                            ephemeral: true
                        }).catch(() => {});
                    }
                    if (result?.code === 'USER_ELIMINATED') {
                        return interaction.followUp({
                            embeds: [sanitizeEmbed(UI.warning(
                                '🛑 Elimination Team Knocked Out',
                                result?.message || 'Your Elimination team has been eliminated from the 2026 tournament.'
                            ))],
                            ephemeral: true
                        }).catch(() => {});
                    }
                    return interaction.followUp({
                        embeds: [sanitizeEmbed(UI.warning(
                            '🎯 Target Finder Notice',
                            result?.message || 'No verified Elimination targets available right now. Please try again shortly.'
                        ))],
                        ephemeral: true
                    }).catch(() => {});
                }

                const whyList = (Array.isArray(result.why) && result.why.length > 0)
                    ? result.why.map(w => `• ${w}`).join('\n')
                    : '• Confirmed available in Torn City\n• Optimal battle stats ratio';

                const embed = {
                    title: `🎯 Best Elimination Target: ${result.name} [${result.targetId}]`,
                    description: `Autonomous match evaluated against your live stats (**~${result.attackerBSHuman}** BS).\n\n` +
                        `**Player:** [**${result.name} [${result.targetId}]**](https://www.torn.com/profiles.php?XID=${result.targetId}) (Level ${result.level})\n` +
                        `**Opposing Team:** ⚔️ **${result.team || 'Opponent'}**\n` +
                        `**Status:** 🟢 ${result.status} • 📍 ${result.travel}\n` +
                        `**Battle Stats:** ~${result.targetBSHuman} (${result.difficulty})\n` +
                        `**Fair Fight / Risk:** FF: ${result.ff ?? 'N/A'} • Risk: ${result.risk} • Match Score: **${result.score}/100**\n\n` +
                        `**Why this target?**\n${whyList}`,
                    color: UI.COLORS.BRAND,
                    footer: UI.FOOTER,
                    timestamp: new Date().toISOString()
                };

                const attackUrl = `https://www.torn.com/page.php?sid=attack&user2ID=${result.targetId}`;
                const actionRow = UI.actionRow(
                    UI.linkBtn(attackUrl, '⚔️ ATTACK NOW', '⚔️'),
                    UI.secondaryBtn(`btn_snipe_next_${interaction.user.id}_${result.targetId}_${tier}`, '⏭️ Next Target', '⏭️')
                );

                return interaction.editReply({ embeds: [sanitizeEmbed(embed)], components: [actionRow] }).catch(() => {});
            }

            // ── Faction Promotion User Cancellation & Recheck ──
            if (customId.startsWith('btn_promo_cancel_') || customId.startsWith('btn_promo_recheck_')) {
                const isCancel = customId.startsWith('btn_promo_cancel_');
                const reqId = customId.replace(isCancel ? 'btn_promo_cancel_' : 'btn_promo_recheck_', '').trim();

                const promoReq = promotionManager.getPromotionRequest(reqId);
                if (!promoReq) {
                    return interaction.reply({
                        content: "✅ No active promotion request found with this ID (it was already cleared or cancelled).",
                        ephemeral: true
                    }).catch(() => {});
                }

                const isApplicant = (interaction.user.id === promoReq.discordUserId);
                const isAuthorized = isApplicant ||
                                     interaction.member?.permissions?.has?.('Administrator') ||
                                     (discordConfig.leaderRoleId && interaction.member?.roles?.cache?.has?.(discordConfig.leaderRoleId)) ||
                                     (interaction.user.id === '992561850057240578' || interaction.user.id === discordConfig.personalDiscordId);

                if (!isAuthorized) {
                    return interaction.reply({
                        content: "⚠️ Only the applicant or faction leadership can cancel this promotion request.",
                        ephemeral: true
                    }).catch(() => {});
                }

                await interaction.deferReply({ ephemeral: true }).catch(() => {});

                if (isCancel) {
                    await promotionManager.cancelPromotionRequest(reqId, interaction.user.id, interaction.user.username, bot);
                    return interaction.editReply({
                        content: `✅ Your promotion request for **${promoReq.requestedRole}** has been cancelled and cleared! You can now submit a new promotion request anytime using \`/promotion\`.`
                    }).catch(() => {});
                } else {
                    const stillExists = await promotionManager.verifyPromotionMessageExists(promoReq, bot, discordConfig);
                    if (!stillExists) {
                        promoReq.status = 'deleted';
                        promoReq.reviewedAt = Date.now();
                        promoReq.reviewReason = 'Discord message deleted through Discord';
                        await promotionManager.persistRecord(promoReq);
                        return interaction.editReply({
                            content: `✅ Verified! The Discord message for your previous request was deleted. Your request has been cleared, and you can now submit a new request with \`/promotion\`.`
                        }).catch(() => {});
                    } else {
                        return interaction.editReply({
                            content: `ℹ️ The promotion request message is still active in leadership review. If you want to withdraw it, click **Cancel & Withdraw Request**.`
                        }).catch(() => {});
                    }
                }
            }

            // ── Faction Promotion Leadership Approval / Denial ──
            if (customId.startsWith('btn_promo_approve_') || customId.startsWith('btn_promo_deny_')) {
                const isApprove = customId.startsWith('btn_promo_approve_');
                const reqId = customId.replace(isApprove ? 'btn_promo_approve_' : 'btn_promo_deny_', '').trim();

                const isAuthorized = interaction.member?.permissions?.has?.('Administrator') ||
                                     (discordConfig.leaderRoleId && interaction.member?.roles?.cache?.has?.(discordConfig.leaderRoleId)) ||
                                     (interaction.user.id === '992561850057240578' || interaction.user.id === discordConfig.personalDiscordId);
                if (!isAuthorized) {
                    return interaction.reply({
                        content: "⚠️ Only Faction Leadership or Server Administrators can approve or deny promotion requests.",
                        ephemeral: true
                    }).catch(() => {});
                }

                await interaction.deferUpdate().catch(() => {});

                const promoReq = promotionManager.getPromotionRequest(reqId);
                if (!promoReq) {
                    return interaction.followUp({ content: "⚠️ Promotion request not found or expired.", ephemeral: true }).catch(() => {});
                }

                if (promoReq.status !== 'pending') {
                    return interaction.followUp({
                        content: `⚠️ This promotion request was already **${promoReq.status}** by <@${promoReq.reviewedBy}> on <t:${Math.floor((promoReq.reviewedAt || Date.now()) / 1000)}:f>.`,
                        ephemeral: true
                    }).catch(() => {});
                }

                const reviewerName = interaction.member?.displayName || interaction.user?.username || 'Leadership';
                const decision = isApprove ? 'approved' : 'denied';
                const updated = await promotionManager.reviewPromotionRequest(reqId, interaction.user.id, reviewerName, decision);

                const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
                const facId = discordConfig.factionId || dynamicFactionId || 52355;
                const facData = await promotionManager.getFactionData(apiKey, facId);

                const { embed, actionRow } = promotionManager.buildReviewedNotificationEmbed(
                    updated, decision, reviewerName, interaction.user.id, facData.positions, facData.name
                );

                const updatePayload = {
                    content: isApprove ? `✅ **Promotion Request Approved** by <@${interaction.user.id}>` : `❌ **Promotion Request Denied** by <@${interaction.user.id}>`,
                    embeds: [sanitizeEmbed(embed)],
                    components: [actionRow]
                };

                await interaction.editReply(updatePayload).catch(async () => {
                    if (interaction.message?.edit) {
                        await interaction.message.edit(updatePayload).catch(() => {});
                    }
                });

                // Notify applicant via direct message
                try {
                    const applicantUser = await (interaction.client || bot).users.fetch(promoReq.discordUserId).catch(() => null);
                    if (applicantUser) {
                        const dmEmbed = isApprove ? UI.success(
                            `🎉 Faction Promotion Approved!`,
                            `Congratulations! Your promotion request to **${promoReq.requestedRole}** in **${facData.name}** was **APPROVED** by <@${interaction.user.id}> (${reviewerName})!\n\n` +
                            `Leadership has been provided the direct link to update your position in Torn Faction Controls.`
                        ) : UI.error(
                            `Faction Promotion Request Update`,
                            `Your promotion request to **${promoReq.requestedRole}** in **${facData.name}** was **DENIED** by <@${interaction.user.id}> (${reviewerName}).\n\n` +
                            `Keep contributing and reach out to leadership if you have questions on requirements needed for this role!`
                        );
                        await applicantUser.send({ embeds: [sanitizeEmbed(dmEmbed)] }).catch(() => {});
                    }
                } catch(dmErr) {
                    console.warn('[Promotions] DM to applicant failed:', dmErr.message);
                }

                return;
            }

            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const cmd = interaction.commandName.toLowerCase();
        let subcommand = null;
        try { subcommand = interaction.options.getSubcommand()?.toLowerCase(); } catch(e) {}

        const disabledCmds = (Array.isArray(discordConfig.disabledCommands) ? discordConfig.disabledCommands : [])
            .map(c => String(c).toLowerCase().trim());
        if (disabledCmds.includes(cmd) || (subcommand && disabledCmds.includes(subcommand))) {
            const label = subcommand ? `/${cmd} ${subcommand}` : `/${cmd}`;
            return interaction.reply({
                content: `⚠️ The \`${label}\` command has been disabled by faction leadership on the dashboard.`,
                ephemeral: true
            }).catch(() => {});
        }

        const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();

        // ── Autonomous Elimination Target Hunter (/snipe, /elim) ──
        if (cmd === 'snipe' || cmd === 'elim') {
            await interaction.deferReply({ ephemeral: true });
            const invokerName = interaction.member?.displayName || interaction.user?.username || 'Member';
            const tier = (interaction.options.getString('tier') || 'manageable').toLowerCase();

            // Require requesting user's own linked Torn API key (strict multi-user isolation)
            const resolved = userKeys.resolveUserApiKey(interaction.user.id, invokerName, interaction.user.username);
            if (!resolved) {
                const linkEmbed = UI.warning(
                    '🔑 Torn Account Not Connected',
                    `Hey **${invokerName}**, to find Elimination targets tailored to your battle stats, you need to link your Torn **Limited Access API Key**.\n\n` +
                    `🔒 **Zero Public Exposure:** Your key is entered in a private Discord popup, encrypted with **military-grade AES-256-GCM**, and stored securely. F.R.I.D.A.Y only accesses it to calculate your battle strength and check target hittability.\n\n` +
                    `Click **Link Limited Key** below:`
                );
                const actionRow = UI.actionRow(
                    UI.primaryBtn('btn_link_user_api_key', 'Link Limited API Key', '🔑'),
                    UI.linkBtn('https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2', 'Create Key on Torn', '🌐')
                );
                return await interaction.editReply({ embeds: [sanitizeEmbed(linkEmbed)], components: [actionRow] });
            }

            const result = await findElimSnipeTargetForUser({
                apiKey: resolved.key,
                userId: interaction.user.id,
                tier
            });

            if (!result || !result.success || !result.targetId) {
                if (result?.code === 'NOT_IN_ELIMINATION') {
                    const elimNotice = UI.warning(
                        '🛑 Not Participating in Elimination',
                        `Hey **${invokerName}**, your linked Torn account is not currently participating in an active **Torn Elimination** competition.\n\n` +
                        `• **Requirement:** You must be enrolled on an active Elimination tournament team.\n` +
                        `• **Hard Isolation:** Target finding is strictly restricted to verified opponents in the active tournament to prevent non-elimination players and faction members from being targeted.`
                    );
                    return await interaction.editReply({ embeds: [sanitizeEmbed(elimNotice)] });
                }
                if (result?.code === 'USER_ELIMINATED') {
                    const elimNotice = UI.warning(
                        '🛑 Elimination Team Knocked Out',
                        result?.message || 'Your Elimination team has been eliminated from the 2026 tournament.'
                    );
                    return await interaction.editReply({ embeds: [sanitizeEmbed(elimNotice)] });
                }

                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.warning(
                        '🎯 Target Finder Notice',
                        result?.message || 'No verified Elimination targets available right now matching your criteria. Please try again shortly or adjust tier in settings.'
                    ))]
                });
            }

            const whyList = (Array.isArray(result.why) && result.why.length > 0)
                ? result.why.map(w => `• ${w}`).join('\n')
                : '• Confirmed available in Torn City\n• Optimal battle stats ratio';

            const embed = {
                title: `🎯 Best Elimination Target: ${result.name} [${result.targetId}]`,
                description: `Autonomous match evaluated against your live stats (**~${result.attackerBSHuman}** BS).\n\n` +
                    `**Player:** [**${result.name} [${result.targetId}]**](https://www.torn.com/profiles.php?XID=${result.targetId}) (Level ${result.level})\n` +
                    `**Opposing Team:** ⚔️ **${result.team || 'Opponent'}**\n` +
                    `**Status:** 🟢 ${result.status} • 📍 ${result.travel}\n` +
                    `**Battle Stats:** ~${result.targetBSHuman} (${result.difficulty})\n` +
                    `**FF / Score:** FF: ${result.ff ?? 'N/A'} • Score: **${result.score}/100**\n` +
                    `**Retal Risk:** 🛡️ **${Math.round((result.retalRate || 0.28) * 100)}%** chance they hit back — ${retalEngine.formatRiskTag({ adjusted_rate: result.retalRate || 0.28, tier: result.retalTier || 'cold_start' })}\n\n` +
                    `**Why this target?**\n${whyList}`,
                color: UI.COLORS.BRAND,
                footer: { text: 'F.R.I.D.A.Y · Score penalized by retal risk · 🟢 Direct 🟡 Shrunk 🟠 Faction ⚫ Cold' },
                timestamp: new Date().toISOString()
            };

            const attackUrl = `https://www.torn.com/page.php?sid=attack&user2ID=${result.targetId}`;
            const actionRow = UI.actionRow(
                UI.linkBtn(attackUrl, '⚔️ ATTACK NOW', '⚔️'),
                UI.secondaryBtn(`btn_snipe_next_${interaction.user.id}_${result.targetId}_${tier}`, '⏭️ Next Target', '⏭️')
            );

            return await interaction.editReply({ embeds: [sanitizeEmbed(embed)], components: [actionRow] });
        }

        // ── Personal Opt-In DM Notifications (/notifications, /dmalerts) ──
        if (cmd === 'notifications' || cmd === 'dmalerts') {
            await interaction.deferReply({ ephemeral: true });
            const invokerName = interaction.member?.displayName || interaction.user?.username || 'Member';
            const resolved = userKeys.resolveUserApiKey(interaction.user.id, invokerName, interaction.user.username);

            if (!resolved) {
                const linkEmbed = UI.warning(
                    '🔑 Torn Limited API Key Required',
                    `Hey **${invokerName}**, to receive personal automated DM alerts (like Xanax cooldown, flight landing warnings, or full energy alerts), you need to link your Torn **Limited Access API Key**.\n\n` +
                    `🔒 **Zero Public Exposure:** Your key is encrypted with **military-grade AES-256-GCM** and only accessed to monitor your personal timers.\n\n` +
                    `Click **Link Limited Key** below:`
                );
                const actionRow = UI.actionRow(
                    UI.primaryBtn('btn_link_user_api_key', 'Link Limited API Key', '🔑'),
                    UI.linkBtn('https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2', 'Create Key on Torn', '🌐')
                );
                return await interaction.editReply({ embeds: [sanitizeEmbed(linkEmbed)], components: [actionRow] });
            }

            const card = userAlerts.buildAlertsControlCard(interaction.user.id, {
                playerName: resolved.playerName,
                playerId: resolved.playerId
            });

            return await interaction.editReply({
                embeds: [sanitizeEmbed(card.embed)],
                components: card.components
            });
        }

        // ── Personal Live Energy, Bars & Cooldowns ──
        if (cmd === 'energy' || cmd === 'bars') {
            await interaction.deferReply({ ephemeral: true });
            const invokerName = interaction.member?.displayName || interaction.user?.username || 'Member';
            const resolved = userKeys.resolveUserApiKey(interaction.user.id, invokerName, interaction.user.username);

            if (!resolved) {
                const linkEmbed = UI.warning(
                    '🔑 Torn Limited API Key Required',
                    `Hey **${invokerName}**, to check your live personal energy, nerve, cooldowns, or bars, you need to link your Torn **Limited Access API Key**.\n\n` +
                    `🔒 **Private & Secure:** Your key is encrypted with **military-grade AES-256-GCM** and only accessed when you check your stats.\n\n` +
                    `Click **Link Limited Key** below:`
                );
                const actionRow = UI.actionRow(
                    UI.primaryBtn('btn_link_user_api_key', 'Link Limited API Key', '🔑'),
                    UI.linkBtn('https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2', 'Create Key on Torn', '🌐')
                );
                return await interaction.editReply({ embeds: [sanitizeEmbed(linkEmbed)], components: [actionRow] });
            }

            const stats = await userKeys.fetchUserLiveStats(resolved.key);
            if (!stats) {
                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.error('Fetch Failed', '⚠️ Could not retrieve live account data from Torn API. Please try again in a moment.'))]
                });
            }

            const e = stats.energy;
            const n = stats.nerve;
            const h = stats.happy;
            const l = stats.life;
            const c = stats.cooldowns;

            const energyField = `${e.current}/${e.maximum}${e.isFull ? ' *(Full)*' : ` *(+${e.maximum - e.current} in ~${e.fulltimeMinutes}m)*`}`;
            const nerveField = `${n.current}/${n.maximum}${n.isFull ? ' *(Full)*' : ` *(full in ~${n.fulltimeMinutes}m)*`}`;
            const drugField = c.drug > 0 ? `💊 ${c.drugMinutes}m` : '💊 Ready';
            const boosterField = c.booster > 0 ? `🍬 ${c.boosterMinutes}m` : '🍬 Ready';
            const medField = c.medical > 0 ? `💉 ${c.medicalMinutes}m` : '💉 Ready';

            const embed = UI.info(
                `⚡ Real-Time Account Vitals: ${stats.playerName} [${stats.playerId}]`,
                `Live status: **${stats.status.state}** (${stats.status.description})${stats.travel.isTraveling ? ` • ✈️ Flying to **${stats.travel.destination}** (${stats.travel.timeLeftMinutes}m left)` : ` • 📍 In **${stats.travel.destination}**`}`,
                [
                    { name: '⚡ Energy', value: energyField, inline: true },
                    { name: '💉 Nerve', value: nerveField, inline: true },
                    { name: '😊 Happy', value: `${h.current}/${h.maximum}`, inline: true },
                    { name: '❤️ Life', value: `${l.current}/${l.maximum}`, inline: true },
                    { name: '⏱️ Cooldowns', value: `${drugField} | ${boosterField} | ${medField}`, inline: false }
                ]
            );

            return await interaction.editReply({ embeds: [sanitizeEmbed(embed)] });
        }

        // ── Personal Live Merits Slash Command ──
        if (cmd === 'merits') {
            await interaction.deferReply({ ephemeral: true });
            const invokerName = interaction.member?.displayName || interaction.user?.username || 'Member';
            const resolved = userKeys.resolveUserApiKey(interaction.user.id, invokerName, interaction.user.username);

            if (!resolved) {
                const linkEmbed = UI.warning(
                    '🔑 Torn Limited API Key Required',
                    `Hey **${invokerName}**, to check your live allocated merits, you need to link your Torn **Limited Access API Key**.\n\n` +
                    `🔒 **Private & Secure:** Your key is encrypted with **military-grade AES-256-GCM** and only accessed when you check your stats.\n\n` +
                    `Click **Link Limited Key** below:`
                );
                const actionRow = UI.actionRow(
                    UI.primaryBtn('btn_link_user_api_key', 'Link Limited API Key', '🔑'),
                    UI.linkBtn('https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2', 'Create Key on Torn', '🌐')
                );
                return await interaction.editReply({ embeds: [sanitizeEmbed(linkEmbed)], components: [actionRow] });
            }

            const stats = await userKeys.fetchUserLiveStats(resolved.key, 'merits');
            if (!stats) {
                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.error('Fetch Failed', '⚠️ Could not retrieve live account data from Torn API. Please try again in a moment.'))]
                });
            }

            const meritsObj = stats.merits || {};
            const activeMerits = Object.entries(meritsObj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
            const totalUpgrades = activeMerits.reduce((acc, [, v]) => acc + v, 0);

            const meritLines = activeMerits.map(([k, v]) => `• **${k}**: ${v} upgrade${v === 1 ? '' : 's'}`);
            const meritDesc = meritLines.length > 0 
                ? `Total upgrades allocated: **${totalUpgrades}** across **${activeMerits.length}** perks.\n\n${meritLines.join('\n')}`
                : `You don't have any merit upgrades allocated yet.`;

            const embed = UI.info(
                `🏅 Live Allocated Merits: ${stats.playerName} [${stats.playerId}]`,
                meritDesc
            );
            return await interaction.editReply({ embeds: [sanitizeEmbed(embed)] });
        }

        // ── Link Limited API Key Slash Command ──
        if (cmd === 'linkkey') {
            await interaction.deferReply({ ephemeral: true });
            const inputKey = (interaction.options.getString('key') || '').trim();
            const verifyResult = await executeVerifyWithKey(interaction, inputKey);
            const replyPayload = { embeds: [sanitizeEmbed(verifyResult)] };
            if (verifyResult.components && verifyResult.components.length > 0) {
                replyPayload.components = verifyResult.components;
            }
            return await interaction.editReply(replyPayload);
        }

        

        // ── Unlink API Key Slash Command ──
        if (cmd === 'unlinkkey') {
            const deleted = userKeys.unlinkUserApiKey(interaction.user.id);
            if (deleted) {
                return await interaction.reply({
                    embeds: [sanitizeEmbed(UI.success('Key Unlinked', '🔒 Your stored API key has been permanently deleted from F.R.I.D.A.Y storage.'))],
                    ephemeral: true
                });
            } else {
                return await interaction.reply({
                    embeds: [sanitizeEmbed(UI.info('No Key Found', 'You do not have a linked API key stored.'))],
                    ephemeral: true
                });
            }
        }

        // ── Battle Stats Manual Update & Progression Tracker (/bs, /bsupdate) ──
        if (cmd === 'bs' || cmd === 'bsupdate') {
            const forceUpdate = (cmd === 'bsupdate') || (!subcommand || subcommand === 'update');
            const keyOption = interaction.options?.getString?.('key');
            await handleBattleStatsUpdate(interaction, {
                forceUpdate,
                keyInput: keyOption,
                isPublic: true
            });
            return;
        }

        // ── Set OpenRouter Backup Key Slash Command (Admin/Owner) ──
        if (cmd === 'openrouter') {
            await interaction.deferReply({ ephemeral: true });
            const isAdmin = interaction.member?.permissions?.has?.('Administrator') ||
                            userKeys.isOwnerUser(interaction.user.id, interaction.member?.displayName, interaction.user.username);
            if (!isAdmin) {
                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.error('Admin Only', 'Only the bot administrator can configure AI backup keys.'))]
                });
            }

            const inputKey = (interaction.options.getString('key') || '').trim();
            if (!inputKey || inputKey.length < 10) {
                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.error('Invalid Key', 'Please provide a valid OpenRouter API key starting with `sk-or-...`'))]
                });
            }

            try {
                const testRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${inputKey}`,
                        'HTTP-Referer': 'https://torn-company-app-production.up.railway.app',
                        'X-Title': 'FRIDAY Torn Security Sentinel',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'meta-llama/llama-3.1-8b-instruct:free',
                        messages: [{ role: 'user', content: 'ping' }],
                        max_tokens: 10
                    }),
                    signal: AbortSignal.timeout(8000)
                });
                const data = await testRes.json();
                if (data.error) {
                    return await interaction.editReply({
                        embeds: [sanitizeEmbed(UI.error('Key Rejected', `OpenRouter rejected this key: ${data.error.message || 'Unknown error'}`))]
                    });
                }

                discordConfig.openrouterApiKey = inputKey;
                saveDiscordConfig();

                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.success(
                        '🌐 OpenRouter Failover Configured!',
                        `OpenRouter API key verified and stored safely.\n\n` +
                        `• When your Google Gemini keys exhaust their daily quota, F.R.I.D.A.Y will automatically fail over to OpenRouter free models (\`meta-llama/llama-3.3-70b\`, \`gemma-2-9b\`, \`qwen-2.5-72b\`).\n` +
                        `• Friday's AI chat will **never go offline again**!`
                    ))]
                });
            } catch (err) {
                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.error('Connection Failed', `Failed to verify with OpenRouter: ${err.message}`))]
                });
            }
        }

        // ── Community Bug Reporter Slash Command (/bug) ──
        if (cmd === 'bug') {
            await interaction.deferReply({ ephemeral: true });
            const description = (interaction.options.getString('description') || '').trim();
            const categoryChoice = interaction.options.getString('category') || 'general';
            const categoryMap = {
                'general': 'General / Other',
                'website': 'Web Dashboard',
                'discord': 'Discord Bot / Commands',
                'alerts': 'Alerts & Notifications',
                'oc': 'Organized Crimes',
                'war': 'War & Chains',
                'banking': 'Vault Banking'
            };
            const category = categoryMap[categoryChoice] || 'General / Other';

            if (!description) {
                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.error('Missing Description', 'Please provide a detailed description of the bug or issue encountered.'))]
                });
            }

            // Look up reporter's linked Torn ID if available
            let tornId = '';
            let tornName = '';
            try {
                if (typeof userKeys !== 'undefined' && userKeys.hasLinkedKey && userKeys.hasLinkedKey(interaction.user.id)) {
                    const linked = userKeys.getRecord(interaction.user.id);
                    if (linked) {
                        tornId = linked.playerId || '';
                        tornName = linked.name || '';
                    }
                } else if (typeof verifiedDiscordToTorn !== 'undefined' && verifiedDiscordToTorn[interaction.user.id]) {
                    tornId = verifiedDiscordToTorn[interaction.user.id].tornId || '';
                    tornName = verifiedDiscordToTorn[interaction.user.id].tornName || '';
                }
            } catch(e) {}

            const newBug = bugManager.createBug({
                description,
                category,
                reporterName,
                discordId: interaction.user.id,
                discordTag: interaction.user.tag || interaction.user.username,
                tornId,
                tornName
            });
            const bugId = newBug.id;

            const reporterDisplay = tornName && tornId 
                ? `${reporterName} (${UI.player(tornName, tornId)})`
                : `<@${interaction.user.id}>`;

            const bugEmbed = UI.success(
                `🐛 Bug Report Logged [${bugId}]`,
                `Thank you for reporting this issue! It has been logged to the F.R.I.D.A.Y Bug Tracker and is visible live on the web dashboard.\n\n` +
                `• **Report ID:** \`${bugId}\`\n` +
                `• **Category:** \`${category}\`\n` +
                `• **Status:** \`Open\`\n` +
                `• **Reporter:** ${reporterDisplay}\n\n` +
                `**Issue Description:**\n${description}`
            );

            return await interaction.editReply({
                embeds: [sanitizeEmbed(bugEmbed)]
            });
        }

        // ── Tactical Torn AI Oracle (F.R.I.D.A.Y - Private Ephemeral) ──
        if (cmd === 'ask') {
            const question = (interaction.options.getString('question') || '').trim();
            if (!question) {
                return interaction.reply({ content: "⚠️ Please provide a question.", ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            try {
                const invokerName = interaction.member?.displayName || interaction.user?.username || 'Member';
                const resolved = userKeys.resolveUserApiKey(interaction.user.id, invokerName, interaction.user.username);
                const accountIntent = userKeys.detectUserAccountIntent(question);
                const isAccountInquiry = Boolean(accountIntent || /\b(?:my|i|me|mine|stats?|merits?|energy|nerve|happy|cooldowns?|battlestats?|workstats?|vault|money|cash|refills?|crimes?|xanax|overdoses?|education|job)\b/i.test(question));

                if (!resolved && isAccountInquiry) {
                    const linkEmbed = UI.warning(
                        '🔑 Torn Limited API Key Required',
                        `Hey **${invokerName}**, to check your live personal merits, battle stats, energy, nerve, cooldowns, or account stats, I need your Torn **Limited Access API Key**.\n\n` +
                        `🔒 **Private & Secure:** Your key is encrypted with **military-grade AES-256-GCM** and only accessed when you check your stats.\n\n` +
                        `Click **Link Limited Key** below:`
                    );
                    const actionRow = UI.actionRow(
                        UI.primaryBtn('btn_link_user_api_key', 'Link Limited API Key', '🔑'),
                        UI.linkBtn('https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2', 'Create Key on Torn', '🌐')
                    );
                    return await interaction.editReply({ embeds: [sanitizeEmbed(linkEmbed)], components: [actionRow] });
                }

                let userAccountData = null;
                if (resolved && isAccountInquiry) {
                    userAccountData = await userKeys.fetchUserLiveStats(resolved.key, question);
                }

                const { reply, sources } = await askTornAI(question, [], userAccountData, invokerName);

                // Ensure reply fits within Discord embed description limit (4096 chars)
                const desc = reply.length > 4000 ? reply.slice(0, 3990) + "\n\n*(response truncated)*" : reply;

                const fields = [];
                if (Array.isArray(sources) && sources.length > 0) {
                    const srcLinks = sources
                        .filter(s => s.url)
                        .map(s => `• [${s.title || 'Torn Reference'}](${s.url})`)
                        .slice(0, 4)
                        .join('\n');
                    if (srcLinks) {
                        fields.push({
                            name: "📚 Verified Wiki & Forum Sources",
                            value: srcLinks
                        });
                    }
                }

                const botAvatar = slashCommandBot?.user?.displayAvatarURL?.() || undefined;

                const fridayEmbed = {
                    author: {
                        name: "F.R.I.D.A.Y",
                        icon_url: botAvatar
                    },
                    title: `❓ ${question.length > 250 ? question.slice(0, 247) + '...' : question}`,
                    description: desc,
                    color: UI.COLORS.INFO,
                    fields: fields.length > 0 ? fields : undefined,
                    footer: UI.FOOTER,
                    timestamp: new Date().toISOString()
                };

                return await interaction.editReply({
                    embeds: [sanitizeEmbed(fridayEmbed)]
                });
            } catch(err) {
                return await interaction.editReply({
                    content: `⚠️ **F.R.I.D.A.Y encountered an error:** ${err.message}`
                });
            }
        }

        // ── Natural Conversation Responder (/respond) ──
        if (cmd === 'respond') {
            const hint = (interaction.options.getString('hint') || '').trim();
            const invokerName = interaction.member?.displayName || interaction.user?.username || "";

            await interaction.deferReply(); // Public reply in channel so she joins the group

            try {
                const convoLines = [];
                const chanId = interaction.channelId;
                const sessionStart = convoSessionStartTimestamps.get(chanId) || 0;
                const MAX_CONVO_AGE_MS = 3 * 60 * 1000;
                const MAX_GAP_MS = 3 * 60 * 1000;

                if (interaction.channel && interaction.channel.messages) {
                    const fetched = await interaction.channel.messages.fetch({ limit: 12 }).catch(() => null);
                    if (fetched && fetched.size > 0) {
                        const sorted = Array.from(fetched.values())
                            .filter(m => m.id !== interaction.id && !m.interaction)
                            .reverse();
                        const now = Date.now();
                        let candidateMessages = [];
                        for (const m of sorted) {
                            const mTs = m.createdTimestamp || 0;
                            if (sessionStart && mTs < sessionStart) continue;
                            if (now - mTs > MAX_CONVO_AGE_MS) continue;
                            const authorName = m.member?.displayName || m.author?.username || "Member";
                            const text = (m.cleanContent || m.content || "").trim();
                            if (text) candidateMessages.push({ ts: mTs, author: authorName, text });
                        }

                        let lastTs = null;
                        let activeStream = [];
                        for (const cMsg of candidateMessages) {
                            if (lastTs !== null && (cMsg.ts - lastTs > MAX_GAP_MS)) {
                                activeStream = [];
                            }
                            activeStream.push(cMsg);
                            lastTs = cMsg.ts;
                        }

                        for (const vm of activeStream) {
                            convoLines.push(`${vm.author}: ${vm.text}`);
                        }
                    }
                }

                const resolved = userKeys.resolveUserApiKey(interaction.user.id, invokerName, interaction.user.username);
                const accountIntent = userKeys.detectUserAccountIntent(hint);
                const isAccountInquiry = Boolean(accountIntent || /\b(?:my|i|me|mine|stats?|merits?|energy|nerve|happy|cooldowns?|battlestats?|workstats?|vault|money|cash|refills?|crimes?|xanax|overdoses?|education|job)\b/i.test(hint));

                let userAccountData = null;
                if (resolved && isAccountInquiry) {
                    userAccountData = await userKeys.fetchUserLiveStats(resolved.key, hint);
                }

                const aiReply = await generateChatResponse(convoLines, hint, invokerName, null, userAccountData, accountIntent, hint);
                const safeReply = (aiReply || "").trim() || `Hey **${invokerName}**! I've joined the chat. What's on your mind?`;

                return await interaction.editReply({
                    content: safeReply
                });
            } catch(err) {
                return await interaction.editReply({
                    content: `⚠️ **F.R.I.D.A.Y couldn't join chat:** ${err.message}`
                });
            }
        }

        // ── Continuous Conversational Mode (/conversation) ──
        if (cmd === 'conversation') {
            const action = interaction.options.getString('action');
            const isStatus = action === 'status';
            await interaction.deferReply({ ephemeral: isStatus }).catch(() => {});

            try {
                const chanId = interaction.channelId;

                if (isStatus) {
                    const isEnabled = activeConversationChannels.has(chanId);
                    const embed = isEnabled 
                        ? UI.success("🟢 Conversational Mode: Active", `**F.R.I.D.A.Y** is actively listening and participating in <#${chanId}>.\n\n• Type normally and Friday will chime in.\n• Anti-interruption engine waits while members are typing.\n• Incomplete thoughts and replies reference parent context.\n\n*Use \`/conversation action:stop\` to deactivate.*`)
                        : UI.neutral("⚪ Conversational Mode: Inactive", `**F.R.I.D.A.Y** is currently inactive in <#${chanId}>.\n\n*Use \`/conversation action:start\` to activate.*`);
                    return await interaction.editReply({ embeds: [sanitizeEmbed(embed)] });
                }

                if (action === 'reset' || action === 'clear') {
                    convoSessionStartTimestamps.set(chanId, Date.now());
                    const pending = channelConvoState.get(chanId);
                    if (pending?.timer) clearTimeout(pending.timer);
                    channelConvoState.delete(chanId);

                    const embed = UI.success(
                        "🧹 Conversation Memory Reset",
                        `**F.R.I.D.A.Y** has wiped all past conversation memory in <#${chanId}>.\n\n` +
                        `• All previous topics, messages, and discussion context have been forgotten.\n` +
                        `• Friday is ready with a 100% fresh clean slate!`
                    );
                    return await interaction.editReply({ embeds: [sanitizeEmbed(embed)] });
                }

                const shouldEnable = action === 'start' ? true : (action === 'stop' ? false : !activeConversationChannels.has(chanId));

                if (shouldEnable) {
                    activeConversationChannels.add(chanId);
                    convoSessionStartTimestamps.set(chanId, Date.now());
                    const pending = channelConvoState.get(chanId);
                    if (pending?.timer) clearTimeout(pending.timer);
                    channelConvoState.delete(chanId);

                    discordConfig.conversationChannels = Array.from(activeConversationChannels);
                    saveDiscordConfig();
                    const embed = UI.brand(
                        "🟢 Conversational Mode Activated",
                        `**F.R.I.D.A.Y** is now actively listening in <#${chanId}>!\n\n` +
                        `• **Fresh Session:** Previous chat history has been cleared for a clean slate.\n` +
                        `• **Natural Chat:** Friday participates casually in conversations.\n` +
                        `• **Anti-Interruption:** If someone is typing, Friday waits patiently until the thought is finished.\n` +
                        `• **Context Aware:** Incomplete thoughts or replies reference what you're replying to.\n\n` +
                        `*To stop conversational mode, use \`/conversation action:stop\` or \`/conversation\`.*`
                    );
                    return await interaction.editReply({ embeds: [sanitizeEmbed(embed)] });
                } else {
                    activeConversationChannels.delete(chanId);
                    convoSessionStartTimestamps.delete(chanId);
                    discordConfig.conversationChannels = Array.from(activeConversationChannels);
                    saveDiscordConfig();

                    // Cancel and purge any pending timer or queued messages for this channel immediately
                    const pending = channelConvoState.get(chanId);
                    if (pending?.timer) clearTimeout(pending.timer);
                    channelConvoState.delete(chanId);

                    const embed = UI.warning(
                        "🛑 Conversational Mode Deactivated",
                        `**F.R.I.D.A.Y** will no longer automatically chime in on messages in <#${chanId}>.\n\n` +
                        `*You can still mention <@${bot.user?.id || 'F.R.I.D.A.Y'}> anytime to talk to her!*`
                    );
                    return await interaction.editReply({ embeds: [sanitizeEmbed(embed)] });
                }
            } catch(convoErr) {
                console.error("[Slash Bot] Error in /conversation handler:", convoErr.message);
                return await interaction.editReply({
                    content: `⚠️ Failed to update conversation mode: ${convoErr.message}`
                }).catch(() => {});
            }
        }


        // Direct actions (Claim / Unclaim / SOS)
        if (cmd === 'claim') {
            const targetId = (interaction.options.getString('target') || '').trim().replace(/[^0-9]/g, '');
            if (!targetId) return interaction.reply({ content: '⚠️ Please provide a numeric Torn Player ID.', ephemeral: true });
            claims[targetId] = { playerName: interaction.user.username, time: Date.now() };
            const attackLink = `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`;

            // Fetch retal risk in parallel (non-blocking — claim posts immediately, retal appended)
            let retalBlock = '';
            try {
                const rScore = await retalEngine.getRiskScore(targetId, null);
                if (rScore) {
                    const pct = Math.round((rScore.adjusted_rate || 0) * 100);
                    const pool = rScore.retaliator_pool || [];
                    const tierLabel = rScore.confidence_label || '⚫ Cold start';

                    if (pool.length > 0) {
                        const retaliatorLines = pool.slice(0, 3).map((r, i) => {
                            const icon = i === 0 ? '🔴' : i === 1 ? '🟡' : '🟠';
                            const avgS = rScore.avg_response_seconds;
                            const timeStr = avgS ? ` — hits back in ~${avgS < 60 ? avgS + 's' : Math.round(avgS/60) + 'm'} avg` : '';
                            return `${icon} [Player ${r.id}](https://www.torn.com/profiles.php?XID=${r.id}) — ${r.count} confirmed retaliation${r.count !== 1 ? 's' : ''}${i === 0 ? timeStr : ''}`;
                        });
                        retalBlock = `\n\n**⚠️ Known Retaliators (${pct}% retal rate):**\n${retaliatorLines.join('\n')}\n-# ${tierLabel}`;
                    } else {
                        retalBlock = `\n\n🛡️ **Retal Risk: ${pct}%** — ${tierLabel}\n-# No specific retaliators on record for this target`;
                    }
                }
            } catch(e) { /* silent — never block claim for retal engine errors */ }

            return interaction.reply({
                embeds: [{
                    title: `🎯 Target Claimed: [${targetId}]`,
                    description: `**<@${interaction.user.id}>** has claimed **Target [${targetId}]**.\n\n[⚔️ Launch Attack](${attackLink}) • [👤 Profile](https://www.torn.com/profiles.php?XID=${targetId})${retalBlock}`,
                    color: UI.COLORS.SUCCESS, footer: UI.FOOTER, timestamp: new Date().toISOString()
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
                    color: UI.COLORS.NEUTRAL,
                    footer: UI.FOOTER,
                    timestamp: new Date().toISOString()
                }]
            });
        }

        if (cmd === 'sos') {
            const targetId = (interaction.options.getString('target') || '').trim().replace(/[^0-9]/g, "");
            const note = interaction.options.getString('note') || 'Backup needed immediately!';
            if (!targetId) return interaction.reply({ content: "⚠️ Please provide a numeric Torn Player ID.", ephemeral: true });
            backups[targetId] = { playerName: interaction.user.username, time: Date.now() };
            const attackLink = `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`;
            return interaction.reply({
                content: `🚨 **EMERGENCY BACKUP REQUESTED!**`,
                embeds: [{
                    title: `🚨 SOS BACKUP: Target [${targetId}]`,
                    description: `**Requested by**: <@${interaction.user.id}>\n**Note**: ${note}\n\n[⚔️ CLICK HERE TO ATTACK](${attackLink}) • [👤 View Profile](https://www.torn.com/profiles.php?XID=${targetId})`,
                    color: UI.COLORS.ERROR, footer: UI.FOOTER, timestamp: new Date().toISOString() }]
            });
        }

        // ── Faction Promotion Request Slash Command ──
        if (cmd === 'promotion') {
            await interaction.deferReply({ ephemeral: true });
            try {
                const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
                const facId = discordConfig.factionId || dynamicFactionId || 52355;
                const facData = await promotionManager.getFactionData(apiKey, facId);

                if (!facData || !facData.positions || Object.keys(facData.positions).length === 0) {
                    return await interaction.editReply({
                        embeds: [sanitizeEmbed(UI.warning(
                            'Faction Data Temporarily Unavailable',
                            `⚠️ Unable to retrieve live faction role definitions from Torn API right now.\n\n` +
                            `Please ensure a valid Faction API Key is configured on the dashboard, or try again in a moment.`
                        ))]
                    });
                }

                // Resolve applicant's identity
                let targetTornId = null;
                let memberName = interaction.member?.displayName || interaction.user?.username || 'Member';

                if (verifiedDiscordToTorn[interaction.user.id]) {
                    targetTornId = verifiedDiscordToTorn[interaction.user.id].tornId;
                    memberName = verifiedDiscordToTorn[interaction.user.id].tornName || memberName;
                }
                if (!targetTornId && userKeys && typeof userKeys.hasLinkedKey === 'function' && userKeys.hasLinkedKey(interaction.user.id)) {
                    const rec = userKeys.userKeysStore?.get(interaction.user.id);
                    if (rec && rec.tornId) {
                        targetTornId = rec.tornId;
                        memberName = rec.playerName || memberName;
                    }
                }
                if (!targetTornId && interaction.member?.displayName) {
                    const match = interaction.member.displayName.match(/\[(\d+)\]|\((\d+)\)/);
                    if (match) targetTornId = match[1] || match[2];
                }

                // Fast-track server owner/admin (Owen)
                if (!targetTornId && (interaction.user.id === '992561850057240578' || (discordConfig.personalDiscordId && interaction.user.id === discordConfig.personalDiscordId))) {
                    targetTornId = '3776908';
                    memberName = 'Owen777';
                }

                // Name match against facData.members if still not found
                if (!targetTornId && facData.members) {
                    const candidateNames = [
                        interaction.member?.displayName,
                        interaction.member?.nickname,
                        interaction.user?.globalName,
                        interaction.user?.username
                    ].filter(Boolean);

                    for (const cName of candidateNames) {
                        const cleanCName = cName.replace(/\[\d+\]|\(\d+\)/g, '').trim().toLowerCase();
                        if (!cleanCName) continue;
                        for (const [mId, mObj] of Object.entries(facData.members)) {
                            const mName = (mObj.name || '').toLowerCase();
                            if (mName && (mName === cleanCName || mName.includes(cleanCName) || cleanCName.includes(mName))) {
                                targetTornId = mId;
                                memberName = mObj.name || memberName;
                                break;
                            }
                        }
                        if (targetTornId) break;
                    }
                }

                if (!targetTornId) {
                    return await interaction.editReply({
                        embeds: [sanitizeEmbed(UI.warning(
                            '🛡️ Verification Required',
                            `You must be verified with your Torn account to view or submit promotion requests.\n\nPlease click **🛡️ Verify Me** or run \`/verify\` first.`
                        ))]
                    });
                }

                const memberObj = facData.members?.[String(targetTornId)] || facData.members?.[targetTornId];
                if (!memberObj) {
                    return await interaction.editReply({
                        embeds: [sanitizeEmbed(UI.error(
                            'Faction Member Only',
                            `⚠️ You [${targetTornId}] are not listed as an active member of **${facData.name || 'our faction'}** [${facId}]. Only active faction members can request promotions.`
                        ))]
                    });
                }

                const currentRole = memberObj.position || 'Member';
                const daysInFaction = memberObj.days_in_faction || 0;
                const requestedRoleInput = interaction.options.getString('role');
                const reasonInput = (interaction.options.getString('reason') || '').trim();

                // Case A: User specified a role directly via argument
                if (requestedRoleInput) {
                    const cleanRole = requestedRoleInput.trim();

                    // Check if user requested to cancel their promotion
                    if (cleanRole.toLowerCase() === 'cancel' || cleanRole.toLowerCase() === 'delete' || cleanRole.toLowerCase() === 'withdraw') {
                        const existing = await promotionManager.getPendingRequestForPlayer(targetTornId, bot, discordConfig);
                        if (!existing) {
                            return await interaction.editReply({
                                embeds: [sanitizeEmbed(UI.info(
                                    'No Active Promotion Request',
                                    'You do not currently have any pending promotion request to cancel.'
                                ))]
                            });
                        }
                        await promotionManager.cancelPromotionRequest(existing.id, interaction.user.id, interaction.user.username, bot);
                        return await interaction.editReply({
                            embeds: [sanitizeEmbed(UI.success(
                                'Promotion Request Cancelled',
                                `Your pending promotion request for **${existing.requestedRole}** has been cancelled and cleared.\n\nYou can submit a new promotion request anytime with \`/promotion\`.`
                            ))]
                        });
                    }

                    if (promotionManager.isRestrictedPromotionRole(cleanRole)) {
                        return await interaction.editReply({
                            embeds: [sanitizeEmbed(UI.error(
                                '🚫 Restricted Role',
                                `Leader and Co-leader positions are appointed directly by faction leadership and cannot be requested.`
                            ))]
                        });
                    }

                    const requestableRoles = promotionManager.getRequestableFactionRoles(facData.positions);
                    const exactRole = requestableRoles.find(r => r.toLowerCase() === cleanRole.toLowerCase());
                    if (!exactRole) {
                        const roleList = requestableRoles.map(r => `• **${r}**`).join('\n');
                        return await interaction.editReply({
                            embeds: [sanitizeEmbed(UI.warning(
                                'Invalid Role Specified',
                                `**${cleanRole}** is not an active role in **${facData.name}**.\n\n**Available Roles:**\n${roleList}`
                            ))]
                        });
                    }

                    if (exactRole.toLowerCase() === currentRole.toLowerCase()) {
                        return await interaction.editReply({
                            embeds: [sanitizeEmbed(UI.warning(
                                'Already Assigned',
                                `You are already assigned as **${exactRole}** in **${facData.name}**!`
                            ))]
                        });
                    }

                    const existing = await promotionManager.getPendingRequestForPlayer(targetTornId, bot, discordConfig);
                    if (existing) {
                        const cancelRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`btn_promo_cancel_${existing.id}`)
                                .setLabel('Cancel & Withdraw Request')
                                .setStyle(ButtonStyle.Danger)
                                .setEmoji('🗑️'),
                            new ButtonBuilder()
                                .setCustomId(`btn_promo_recheck_${existing.id}`)
                                .setLabel('Recheck Discord Message')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji('🔄')
                        );
                        return await interaction.editReply({
                            embeds: [sanitizeEmbed(UI.warning(
                                'Promotion Request Pending',
                                `⏳ You already have a pending promotion request for **${existing.requestedRole}** submitted <t:${Math.floor(existing.createdAt / 1000)}:R>!\n\n` +
                                `If you deleted the Discord message or wish to withdraw this request, click **Cancel & Withdraw Request** below to immediately clear it.`
                            ))],
                            components: [cancelRow]
                        });
                    }

                    // Calculate rank movement and battle stats progression
                    const rankAdvancement = promotionManager.calculateRankMovement(facData.positions, currentRole, exactRole);
                    const statsProgression = resolvePlayerStatsProgression(targetTornId, interaction.user.id);
                    const memberLevel = memberObj.level || 0;

                    const promoReq = await promotionManager.createPromotionRequest({
                        discordUserId: interaction.user.id,
                        playerId: targetTornId,
                        playerName: memberObj.name || memberName,
                        currentRole,
                        requestedRole: exactRole,
                        reason: reasonInput,
                        daysInFaction,
                        level: memberLevel,
                        rankAdvancement,
                        statsProgression,
                        guildId: interaction.guild?.id
                    });

                    await promotionManager.dispatchPromotionToLeadership(bot, interaction.guild, promoReq, discordConfig, facData);

                    return await interaction.editReply({
                        embeds: [sanitizeEmbed(UI.success(
                            '🎖️ Promotion Request Submitted!',
                            `Your application to be promoted to **${exactRole}** has been sent to faction leadership for review!\n\n` +
                            `• **Current Role:** ${currentRole} (${daysInFaction} days in faction)\n` +
                            `• **Target Role:** **${exactRole}**\n` +
                            (reasonInput ? `• **Pitch:** _"${reasonInput}"_\n` : '') +
                            `\nF.R.I.D.A.Y will notify you once leadership reviews your application.`
                        ))]
                    });
                }

                // Check if user already has an active pending promotion request before showing menu
                const existing = await promotionManager.getPendingRequestForPlayer(targetTornId, bot, discordConfig);
                if (existing) {
                    const cancelRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`btn_promo_cancel_${existing.id}`)
                            .setLabel('Cancel & Withdraw Request')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🗑️'),
                        new ButtonBuilder()
                            .setCustomId(`btn_promo_recheck_${existing.id}`)
                            .setLabel('Recheck Discord Message')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('🔄')
                    );
                    return await interaction.editReply({
                        embeds: [sanitizeEmbed(UI.warning(
                            'Promotion Request Pending',
                            `⏳ You already have a pending promotion request for **${existing.requestedRole}** submitted <t:${Math.floor(existing.createdAt / 1000)}:R>!\n\n` +
                            `If you deleted the Discord message or wish to withdraw this request, click **Cancel & Withdraw Request** below to immediately clear it.`
                        ))],
                        components: [cancelRow]
                    });
                }

                // Case B: No role provided — display interactive overview embed + Select Menu dropdown
                const menuEmbed = promotionManager.buildPromotionMenuEmbed({
                    memberName: memberObj.name || memberName,
                    memberId: targetTornId,
                    currentRole,
                    daysInFaction,
                    facName: facData.name,
                    positions: facData.positions
                });

                const selectActionRow = promotionManager.buildPromotionSelectMenu(facData.positions, currentRole);
                const components = selectActionRow ? [selectActionRow] : [];

                return await interaction.editReply({
                    embeds: [sanitizeEmbed(menuEmbed)],
                    components
                });
            } catch (err) {
                console.error('[Slash Bot] /promotion command error:', err);
                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.error(
                        'Promotion Error',
                        `⚠️ An error occurred while loading faction promotion roles: ${err.message || 'Unknown error'}. Please try again shortly.`
                    ))]
                }).catch(() => {});
            }
        }

        // ── Member Verification ──
        if (cmd === 'verify') {
            await interaction.deferReply({ ephemeral: true });
            const apiKey = discordConfig.apiKey || TORN_API_KEY || getNextApiKey();
            const result = await executeVerifyMember(interaction.member || interaction.user, interaction.guild, apiKey);

            if (result && result.success && result.isNewVerification && interaction.guild) {
                const vChanId = discordConfig.verificationChannelId;
                if (vChanId) {
                    try {
                        const chan = interaction.guild.channels.cache.get(vChanId) || await interaction.guild.channels.fetch(vChanId).catch(() => null);
                        if (chan && chan.isTextBased()) {
                            await chan.send({
                                content: `🎉 <@${interaction.user.id}> has successfully verified as **[${result.playerName} [${result.playerId}]](https://www.torn.com/profiles.php?XID=${result.playerId})**! Welcome to the server!`
                            });
                        }
                    } catch(e) {}
                }
            }

            const replyPayload = { embeds: [sanitizeEmbed(result)] };
            if (result.components && result.components.length > 0) {
                replyPayload.components = result.components;
            }
            return interaction.editReply(replyPayload);
        }

        if (cmd === 'verifyall') {
            const isAuthorized = interaction.member?.permissions?.has?.('Administrator') ||
                                 (discordConfig.bankerRoleId && interaction.member?.roles?.cache?.has?.(discordConfig.bankerRoleId));
            if (!isAuthorized) {
                return interaction.reply({ content: "⚠️ Only Server Administrators or Faction Bankers can run `/verifyall`.", ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: false });
            const resultEmbed = await executeVerifyAll(interaction.guild, apiKey);
            return interaction.editReply({ embeds: [sanitizeEmbed(resultEmbed)] });
        }

        if (cmd === 'postverify') {
            const isAuthorized = interaction.member?.permissions?.has?.('Administrator') ||
                                 (discordConfig.bankerRoleId && interaction.member?.roles?.cache?.has?.(discordConfig.bankerRoleId));
            if (!isAuthorized) {
                return interaction.reply({ content: "⚠️ Only Server Administrators can post the verification card.", ephemeral: true });
            }

            const verifiedRoleId = discordConfig.verifiedRoleId || interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'verified')?.id;

            const verifyCard = {
                title: `🛡️ Identity Verification — Spider-Verse Sentinel`,
                description: `To protect faction intel and member privacy, all channels remain locked until your Torn City identity is verified.\n\n` +
                             `**How to Verify (Standard):**\n` +
                             `1️⃣ Link your Discord account at **[torn.com/discord](https://www.torn.com/discord)** on the Official Torn Discord.\n` +
                             `2️⃣ Click **🛡️ Verify Me** below — F.R.I.D.A.Y will sync your nickname to \`Name [ID]\` and unlock your roles.\n\n` +
                             `⚡ **Optional Power-Up: Pre-Link Your API Key**\n` +
                             `Save time later! Click **🔑 Link API Key (Optional)** below to connect your Torn **Limited Access API Key**. F.R.I.D.A.Y will securely encrypt and save it so you **never** have to enter it again for live battle stats (\`/bs\`), gym tracking, energy/nerve updates, or automated banking!`,
                color: UI.COLORS.BRAND,
                thumbnail: { url: "https://www.torn.com/favicon.ico" },
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
            };

            const buttons = [{
                type: 1,
                components: [
                    {
                        type: 2,
                        style: 1,
                        custom_id: 'btn_verify_now',
                        label: '🛡️ Verify Me',
                        emoji: { name: '🛡️' }
                    },
                    {
                        type: 2,
                        style: 2,
                        custom_id: 'btn_link_user_api_key',
                        label: '🔑 Link API Key (Optional)'
                    },
                    {
                        type: 2,
                        style: 5,
                        label: '🔗 Link at Torn.com/discord',
                        url: 'https://www.torn.com/discord'
                    },
                    {
                        type: 2,
                        style: 5,
                        label: '🔑 Get API Key',
                        url: 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2'
                    }
                ]
            }];

            await interaction.channel.send({ embeds: [sanitizeEmbed(verifyCard)], components: buttons });
            return interaction.reply({ content: "✅ Verification card posted successfully to this channel!", ephemeral: true });
        }

        // ── Verification Migration Status (Leadership Command) ──
        if (cmd === 'migrationstatus') {
            const isAuthorized = interaction.member?.permissions?.has?.('Administrator') ||
                                 (discordConfig.leaderRoleId && interaction.member?.roles?.cache?.has?.(discordConfig.leaderRoleId)) ||
                                 (discordConfig.bankerRoleId && interaction.member?.roles?.cache?.has?.(discordConfig.bankerRoleId)) ||
                                 (interaction.user.id === '992561850057240578' || interaction.user.id === discordConfig.personalDiscordId);
            if (!isAuthorized) {
                return interaction.reply({ content: "⚠️ Only Server Administrators or Leadership can run `/migrationstatus`.", ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: false });

            let guildMembers = null;
            try {
                guildMembers = await interaction.guild.members.fetch();
            } catch(e) {
                guildMembers = interaction.guild.members.cache;
            }

            const verifiedRoleId = discordConfig.verifiedRoleId || interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('verified'))?.id;
            const factionRoleId = discordConfig.factionRoleId || interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('spider'))?.id;

            const verifiedMembers = [];
            const migratedMembers = [];
            const pendingMembers = [];

            for (const [id, gm] of guildMembers) {
                if (gm.user.bot) continue;
                const isVerified = (verifiedRoleId && gm.roles.cache.has(verifiedRoleId)) ||
                                   (factionRoleId && gm.roles.cache.has(factionRoleId)) ||
                                   verifiedDiscordToTorn[id];
                if (isVerified) {
                    verifiedMembers.push(gm);
                    if (userKeys && userKeys.hasLinkedKey(id)) {
                        migratedMembers.push(gm);
                    } else {
                        pendingMembers.push(gm);
                    }
                }
            }

            const total = verifiedMembers.length;
            const migrated = migratedMembers.length;
            const pending = pendingMembers.length;
            const pct = total > 0 ? ((migrated / total) * 100).toFixed(1) : '0.0';

            const pendingListPreview = pendingMembers.slice(0, 20).map(m => `• <@${m.id}> (\`${m.displayName}\`)`).join('\n') || '*None! Everyone has migrated!*';
            const extraCount = pendingMembers.length > 20 ? `\n*...and ${pendingMembers.length - 20} more*` : '';

            const statusEmbed = {
                title: "📊 Limited API Key Migration Status",
                description: `Tracking adoption of Direct Limited API Key verification across **${interaction.guild.name}**.\n\n` +
                             `📈 **Migration Progress:** **${migrated} / ${total}** (**${pct}%**)\n` +
                             `🔒 **Key-Linked Members:** **${migrated}**\n` +
                             `⏳ **Pending Migration:** **${pending}**`,
                color: pct > 80 ? UI.COLORS.SUCCESS : (pct > 40 ? UI.COLORS.INFO : UI.COLORS.WARNING),
                fields: [
                    {
                        name: `⏳ Pending Members (${pending})`,
                        value: pendingListPreview + extraCount,
                        inline: false
                    },
                    {
                        name: "💡 Next Steps",
                        value: `• Members can click **🔑 Link API Key (Optional)** in the verification channel or type \`/verify key:xxxx\` to link their key.\n` +
                               `• Administrators can run \`/remindkeys\` to send friendly DM reminders to all pending members.`,
                        inline: false
                    }
                ],
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
            };

            return await interaction.editReply({ embeds: [sanitizeEmbed(statusEmbed)] });
        }

        // ── Remind Unmigrated Members via DM (Admin Command) ──
        if (cmd === 'remindkeys') {
            const isAuthorized = interaction.member?.permissions?.has?.('Administrator') ||
                                 (discordConfig.leaderRoleId && interaction.member?.roles?.cache?.has?.(discordConfig.leaderRoleId)) ||
                                 (interaction.user.id === '992561850057240578' || interaction.user.id === discordConfig.personalDiscordId);
            if (!isAuthorized) {
                return interaction.reply({ content: "⚠️ Only Server Administrators or Leadership can run `/remindkeys`.", ephemeral: true });
            }

            const isDryRun = interaction.options.getBoolean('dryrun') ?? false;
            await interaction.deferReply({ ephemeral: true });

            let guildMembers = null;
            try {
                guildMembers = await interaction.guild.members.fetch();
            } catch(e) {
                guildMembers = interaction.guild.members.cache;
            }

            const verifiedRoleId = discordConfig.verifiedRoleId || interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('verified'))?.id;
            const factionRoleId = discordConfig.factionRoleId || interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('spider'))?.id;

            const pendingMembers = [];
            for (const [id, gm] of guildMembers) {
                if (gm.user.bot) continue;
                const isVerified = (verifiedRoleId && gm.roles.cache.has(verifiedRoleId)) ||
                                   (factionRoleId && gm.roles.cache.has(factionRoleId)) ||
                                   verifiedDiscordToTorn[id];
                if (isVerified && (!userKeys || !userKeys.hasLinkedKey(id))) {
                    pendingMembers.push(gm);
                }
            }

            if (pendingMembers.length === 0) {
                return await interaction.editReply({
                    embeds: [sanitizeEmbed(UI.success('All Caught Up!', '🎉 All verified faction members have already linked their Limited API keys! No reminders needed.'))]
                });
            }

            if (isDryRun) {
                const list = pendingMembers.slice(0, 25).map(m => `• <@${m.id}> (\`${m.displayName}\`)`).join('\n');
                const extra = pendingMembers.length > 25 ? `\n*...and ${pendingMembers.length - 25} more*` : '';
                return await interaction.editReply({
                    embeds: [sanitizeEmbed({
                        title: "🔍 Remind Keys — Dry Run Preview",
                        description: `Found **${pendingMembers.length}** verified members who have not linked a Limited API Key yet.\n\n` +
                                     `To send them reminder DMs, run \`/remindkeys dryrun:False\`.\n\n` +
                                     `**Target Members:**\n${list}${extra}`,
                        color: UI.COLORS.INFO,
                        footer: UI.FOOTER,
                        timestamp: new Date().toISOString()
                    })]
                });
            }

            let sentCount = 0;
            let failedCount = 0;

            const dmEmbed = {
                title: "🕷️ Action Required: Update Your Spider-Verse Verification",
                description: `Hey! F.R.I.D.A.Y has upgraded the **Spider-Verse Discord verification system** to direct **Limited API Key verification**.\n\n` +
                             `**Why link your key?**\n` +
                             `• ⚡ **Live Stat Tracking:** View your live Energy, Nerve, and Cooldowns inside Discord.\n` +
                             `• 🏦 **Instant Faction Banking:** Frictionless access to \`/withdraw\` and \`/balance\`.\n` +
                             `• 🔒 **Military-Grade Security:** Keys are encrypted with per-user AES-256-GCM and never shared.\n\n` +
                             `**How to upgrade in 30 seconds:**\n` +
                             `1️⃣ Generate a **Limited Access** key at [Torn Preferences](https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FRIDAY&type=2).\n` +
                             `2️⃣ In the Spider-Verse Discord server, type \`/verify\` (or click the Verify button in the verification channel).\n` +
                             `3️⃣ Paste your 16-character key into the pop-up!\n\n` +
                             `Thank you for keeping our faction operations running at full power! 🕷️`,
                color: UI.COLORS.BRAND,
                footer: UI.FOOTER,
                timestamp: new Date().toISOString()
            };

            for (const gm of pendingMembers) {
                try {
                    await gm.send({ embeds: [sanitizeEmbed(dmEmbed)] });
                    sentCount++;
                    await new Promise(r => setTimeout(r, 1200));
                } catch(dmErr) {
                    failedCount++;
                }
            }

            return await interaction.editReply({
                embeds: [sanitizeEmbed(UI.success(
                    '📬 Migration Reminders Dispatched',
                    `Successfully dispatched reminder DMs to unlinked members:\n\n` +
                    `✅ **Sent:** ${sentCount}\n` +
                    `⚠️ **DMs Closed / Blocked:** ${failedCount}\n` +
                    `👥 **Total Target Members:** ${pendingMembers.length}`
                ))]
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
                vaultInfo = await getFactionVaultAndMember(apiKey, interaction, null, true);
            } catch(err) {
                console.error("[Bank Vault Check Error]:", err.message);
            }

            // If we couldn't match the member to a Torn ID:
            if (!vaultInfo || !vaultInfo.targetId) {
                return interaction.editReply({
                    content: `⚠️ **Could not identify your Torn Account in the faction vault!**\n\n` +
                             `To protect faction funds, the bot must verify your vault balance before withdrawal.\n` +
                             `Please click **🛡️ Verify Me** below (or run \`/verify\`) to link your official Torn identity, or set your server nickname to include your Torn ID in brackets (e.g. \`${interaction.user.username} [123456]\`).\n\n` +
                             `Then run \`/withdraw ${rawAmount}\` again.`,
                    components: [{
                        type: 1,
                        components: [
                            {
                                type: 2,
                                style: 1,
                                custom_id: 'btn_verify_now',
                                label: '🛡️ Verify Me',
                                emoji: { name: '🛡️' }
                            },
                            {
                                type: 2,
                                style: 5,
                                label: '🔗 Link at Torn.com/discord',
                                url: 'https://www.torn.com/discord'
                            }
                        ]
                    }]
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
                        color: UI.COLORS.ERROR,
                        footer: UI.FOOTER,
                        timestamp: new Date().toISOString()
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
                        color: UI.COLORS.ERROR,
                        footer: UI.FOOTER,
                        timestamp: new Date().toISOString()
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

                const unlinkedTip = (userKeys && typeof userKeys.hasLinkedKey === 'function' && !userKeys.hasLinkedKey(interaction.user.id))
                    ? `\n\n💡 *Tip: Run \`/verify\` to link your Torn Limited API key for live energy & stat tracking!*`
                    : '';

                return interaction.editReply({
                    content: `✅ Your withdrawal request **#${req.id}** for **$${amount.toLocaleString()}** has been posted ${locationNote}!${replacedNote}\n` +
                             `Remaining available balance: **$${(totalBalance - amount).toLocaleString()}**.*${unlinkedTip}`
                });
            }

            // Strategy 5: Resilient Fallback - Keep request active & render directly in ephemeral interaction response
            req.channelId = interaction.channelId;
            req.messageId = null;
            saveBankRequests();

            const unlinkedTip = (userKeys && typeof userKeys.hasLinkedKey === 'function' && !userKeys.hasLinkedKey(interaction.user.id))
                ? `\n\n💡 *Tip: Run \`/verify\` to link your Torn Limited API key for live energy & stat tracking!*`
                : '';

            return interaction.editReply({
                content: `✅ Your withdrawal request **#${req.id}** for **$${amount.toLocaleString()}** is active!${replacedNote}\n` +
                         `Remaining available balance: **$${(totalBalance - amount).toLocaleString()}**.\n` +
                         `*(Note: Bot lacks "Send Messages" permission in this channel to post publicly, but your request has been recorded and will be auto-fulfilled when cash is sent)*${unlinkedTip}`,
                embeds: [sanitizeEmbed(reqEmbed)],
                components: reqButtons
            });
        }

        // ── Interactive Giveaway Creation ──
        if (cmd === 'giveaway') {
            const prize = (interaction.options.getString('prize') || '').trim();
            const duration = (interaction.options.getString('duration') || '').trim();
            const winners = interaction.options.getInteger('winners') || 1;

            if (prize && duration) {
                return await launchGiveaway(interaction, prize, duration, winners);
            }

            // If parameters were omitted, prompt with interactive modal
            const modal = new ModalBuilder()
                .setCustomId('modal_create_giveaway')
                .setTitle('🎉 Create a Giveaway');

            const prizeInput = new TextInputBuilder()
                .setCustomId('giveaway_prize')
                .setLabel('What are you giving away?')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 10x Xanax, $25,000,000, Donator Pack')
                .setRequired(true)
                .setMaxLength(150);
            if (prize) prizeInput.setValue(prize);

            const durationInput = new TextInputBuilder()
                .setCustomId('giveaway_duration')
                .setLabel('How long should it run?')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 10m, 30m, 1h, 12h, 1d, 3d')
                .setRequired(true)
                .setMaxLength(30);
            if (duration) durationInput.setValue(duration);

            const winnersInput = new TextInputBuilder()
                .setCustomId('giveaway_winners')
                .setLabel('How many winners? (1 to 20)')
                .setStyle(TextInputStyle.Short)
                .setValue(String(winners || 1))
                .setRequired(false)
                .setMaxLength(2);

            modal.addComponents(
                new ActionRowBuilder().addComponents(prizeInput),
                new ActionRowBuilder().addComponents(durationInput),
                new ActionRowBuilder().addComponents(winnersInput)
            );

            return await interaction.showModal(modal);
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
                    const side = interaction.options.getString('side') || interaction.options.getString('faction') || 'enemy';
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
                        color: isKilled ? UI.COLORS.WARNING : UI.COLORS.SUCCESS,
                        footer: UI.FOOTER,
                        timestamp: new Date().toISOString()
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
            } else if (cmd === 'risk' || cmd === 'retal' || cmd === 'retaliation') {
                const targetId = (interaction.options.getString('target') || '').trim().replace(/[^0-9]/g, '');
                if (!targetId) {
                    embed = UI.warning('⚠️ Invalid Target', 'Please provide a numeric Torn Player ID.');
                } else {
                    const rScore = await retalEngine.getRiskScore(targetId, null);
                    const playerName = playerNameCache[targetId] || `Player ${targetId}`;
                    embed = retalEngine.buildRiskEmbed(rScore, playerName);
                }
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
                const factionChoice = interaction.options.getString('side') || interaction.options.getString('faction') || (cmd === 'ourstats' ? 'friendly' : 'enemy');
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
                    await interaction.editReply({
                        embeds: [sanitizeEmbed(UI.error(
                            '❌ Command Error',
                            'An error occurred while processing this command. Please try again in a moment.'
                        ))]
                    });
                }
            } catch(err2) {
                console.error("[Slash Bot] Failed to reply:", err2.message);
            }
        }
    });
}

async function startSlashCommandBot(token) {
    if (!token || typeof token !== 'string' || token.trim().length < 20) return;
    const cleanToken = token.trim();

    if (isStartingSlashBot) return;
    if (slashBotStarted && slashCommandBot?.isReady?.()) return;

    isStartingSlashBot = true;
    try {
        if (slashCommandBot) {
            try { slashCommandBot.destroy(); } catch(e) {}
            slashCommandBot = null;
        }

        // Try initializing with GuildMembers & MessageContent intent for full member auditing & /respond chat reading
        slashCommandBot = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.MessageContent
            ]
        });

        setupSlashBotEvents(slashCommandBot, cleanToken);

        try {
            await slashCommandBot.login(cleanToken);
        } catch(loginErr) {
            if (loginErr.code === 'DisallowedIntents' || (loginErr.message && loginErr.message.toLowerCase().includes('disallowed intents'))) {
                console.warn("[Slash Bot] Privileged GuildMembers intent disallowed in Developer Portal. Falling back to standard intents...");
                try { slashCommandBot.destroy(); } catch(e) {}
                slashCommandBot = new Client({
                    intents: [
                        GatewayIntentBits.Guilds,
                        GatewayIntentBits.GuildMessages
                    ]
                });
                setupSlashBotEvents(slashCommandBot, cleanToken);
                await slashCommandBot.login(cleanToken);
            } else {
                throw loginErr;
            }
        }
    } catch (e) {
        console.error("[Slash Bot] Failed to start:", e.message);
        slashBotStarted = false;
    } finally {
        isStartingSlashBot = false;
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
        const token = (req.body.token || discordConfig.globalBotToken || '').trim();
        const guildId = req.body.guildId || discordConfig.guildId || null;
        if (req.body.guildId && req.body.guildId !== discordConfig.guildId) {
            discordConfig.guildId = req.body.guildId;
            saveDiscordConfig();
        }
        if (req.body.disabledCommands !== undefined && Array.isArray(req.body.disabledCommands)) {
            discordConfig.disabledCommands = req.body.disabledCommands.map(c => String(c).toLowerCase().trim()).filter(Boolean);
            saveDiscordConfig();
        }
        if (!token) return res.status(400).json({ success: false, error: "Missing bot token. Please configure your Discord Bot Token." });
        
        const result = await registerSlashCommands(token, guildId);
        if (!result.success) {
            return res.status(result.status || 500).json(result);
        }
        startSlashCommandBot(token).catch(() => {});
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API endpoint: purge duplicate commands and cleanly re-sync
app.post('/api/discord/clean-commands', async (req, res) => {
    try {
        const token = (req.body.token || discordConfig.globalBotToken || '').trim();
        const guildId = req.body.guildId || discordConfig.guildId || null;
        if (req.body.guildId && req.body.guildId !== discordConfig.guildId) {
            discordConfig.guildId = req.body.guildId;
            saveDiscordConfig();
        }
        if (req.body.disabledCommands !== undefined && Array.isArray(req.body.disabledCommands)) {
            discordConfig.disabledCommands = req.body.disabledCommands.map(c => String(c).toLowerCase().trim()).filter(Boolean);
            saveDiscordConfig();
        }
        if (!token) return res.status(400).json({ success: false, error: "Missing bot token. Please configure your Discord Bot Token." });

        const result = await registerSlashCommands(token, guildId, { cleanGlobal: true });
        if (!result.success) {
            return res.status(result.status || 500).json(result);
        }
        startSlashCommandBot(token).catch(() => {});
        res.json({ success: true, count: result.count, disabledCount: result.disabledCount, message: "Commands purged and re-registered cleanly with zero duplicates!" });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
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

// ── Real-Time Streaming & Admin Telemetry Endpoints ──
app.get('/api/warboard/stream', (req, res) => {
    warboardBroadcaster.handleSse(req, res);
});

app.get('/api/admin/api-metrics', (req, res) => {
    const metrics = tornApiManager.getMetrics();
    const broadcasterStats = warboardBroadcaster.getClientStats();
    res.json({
        success: true,
        ...metrics,
        broadcaster: broadcasterStats
    });
});

// ── Catch-All JSON Responders for /api/* (Guarantees valid JSON, never HTML) ──
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, error: `Endpoint not found: ${req.method} ${req.originalUrl}` });
});

app.use('/api', (err, req, res, next) => {
    console.error('[API Error]', req.method, req.originalUrl, err?.message || err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
    // startFrontierPipeline(); // PAUSED: Conserve Torn API budget
    startKeepAlive();
    
    // Boot up the integrated recruitment platform (UI and APIs available, background scanning workers paused)
    const { initRecruitPlatform } = require('./recruit/index');
    initRecruitPlatform(app, server).catch(e => console.error("[Recruit Init Error]", e));
});

// ── Robust 24/7 Keep-Alive Sentinel (Keeps Render awake & eliminates cold starts) ──
function startKeepAlive() {
    const targets = new Set();
    if (process.env.RENDER_EXTERNAL_URL) targets.add(process.env.RENDER_EXTERNAL_URL.replace(/\/$/, ''));
    targets.add('https://torn-company-app.onrender.com');
    targets.add('https://torn-company-app-production.up.railway.app');
    if (process.env.APP_URL) targets.add(process.env.APP_URL.replace(/\/$/, ''));

    console.log(`[KeepAlive] 24/7 Keep-Alive Sentinel active for: ${Array.from(targets).join(', ')} (every 5 min)`);

    const doPing = async () => {
        for (const baseUrl of targets) {
            try {
                const res = await fetch(`${baseUrl}/healthz`, {
                    signal: AbortSignal.timeout(15_000),
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                        'Accept': 'application/json'
                    }
                });
                if (res.ok) {
                    // Success: Inbound HTTP traffic registered by Render routing proxy
                } else {
                    console.warn(`[KeepAlive] Ping to ${baseUrl}/healthz returned ${res.status}`);
                }
            } catch(e) {
                // Transient network delays ignored
            }
        }
    };

    // First ping 5 minutes after startup, then repeating every 5 minutes (300,000 ms)
    setTimeout(doPing, 5 * 60_000);
    setInterval(doPing, 5 * 60_000);

    // Heartbeat Telemetry: Log process health & memory every 60s
    setInterval(() => {
        const mem = process.memoryUsage();
        console.log(`[Heartbeat] Uptime: ${Math.floor(process.uptime())}s | RSS: ${Math.round(mem.rss / 1024 / 1024)}MB | Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
    }, 60_000);
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

