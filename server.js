const express = require('express');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";
const ADMIN_DISCORD_WEBHOOK = process.env.ADMIN_DISCORD_WEBHOOK || ""; 

const VIP_FACTIONS = (process.env.VIP_FACTIONS || "").split(',').map(id => id.trim());
const VIP_PLAYERS = (process.env.VIP_PLAYERS || "").split(',').map(id => id.trim());

let claims = {};
let backups = {}; 
let statsCache = {}; 
let manualStats = {}; 
let flightCache = {}; 
let activityCache = {}; 
let warScrapeCache = {}; 

// Upgraded to Maps to track which User Key requested which Target ID
let statQueue = new Map();
let flightQueue = new Map();
let activityQueue = new Map();

let isProcessingStats = false;
let isProcessingFlights = false;
let isProcessingActivity = false;

let apiKeyPool = new Set();
if (ADMIN_API_KEY) apiKeyPool.add(ADMIN_API_KEY);
if (TORN_API_KEY) apiKeyPool.add(TORN_API_KEY);

let liveAttacks = {};
let liveDefends = {}; 
let processedAttackIds = new Set();
let backfillCursor = Math.floor(Date.now() / 1000);
let backfillTarget = backfillCursor - (72 * 3600); 
let isBackfilling = true;

let bonusHits = {}; 
const BONUS_THRESHOLDS = new Set([10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]);

let subscriptions = {};
let adminFactionId = null;
let lastEventTimestamp = Math.floor(Date.now() / 1000);

let lastChainTimeoutAlertState = false;
let backgroundEnemyTrackingState = {};

let discordConfig = { webhookUrl: "", targetOnline: true, targetLanded: true, targetOutHosp: true, chainUnder90: true, chainMilestone: true, friendlyAttacked: true };
let marketConfig = { webhookUrl: "", autoDefense: false, sniperTargets: [] };
let marketMemory = { defense: {}, sniper: {} };
let vipConfig = { factions: [], players: [] }; 

try { if (fs.existsSync('subscriptions.json')) subscriptions = JSON.parse(fs.readFileSync('subscriptions.json')); } catch (e) {}
try { if (fs.existsSync('discord_config.json')) discordConfig = { ...discordConfig, ...JSON.parse(fs.readFileSync('discord_config.json')) }; } catch(e) {}
try { if (fs.existsSync('market_config.json')) marketConfig = { ...marketConfig, ...JSON.parse(fs.readFileSync('market_config.json')) }; } catch(e) {}
try { if (fs.existsSync('vip_config.json')) vipConfig = { ...vipConfig, ...JSON.parse(fs.readFileSync('vip_config.json')) }; } catch(e) {}

function saveSubs() { fs.writeFileSync('subscriptions.json', JSON.stringify(subscriptions)); }
function saveDiscordConfig() { fs.writeFileSync('discord_config.json', JSON.stringify(discordConfig)); }
function saveMarketConfig() { fs.writeFileSync('market_config.json', JSON.stringify(marketConfig)); }
function saveVipConfig() { fs.writeFileSync('vip_config.json', JSON.stringify(vipConfig)); }

if (ADMIN_API_KEY) {
    fetch(`https://api.torn.com/user/?selections=profile&key=${ADMIN_API_KEY}`)
        .then(r => r.json())
        .then(d => { if (d.faction) adminFactionId = d.faction.faction_id?.toString(); })
        .catch(e => console.error("Failed to load admin profile"));
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
                            
                            if (ADMIN_DISCORD_WEBHOOK) {
                                fetch(ADMIN_DISCORD_WEBHOOK, {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ content: `💰 **PAYMENT RECEIVED:** Faction \`${facId}\` paid ${qty}x Xanax for ${weeks} weeks of Warboard access!` })
                                }).catch(()=>{});
                            }
                        }
                    }
                }
            }
        }
    } catch (err) {}
}, 60000); 

async function verifySubscription(userKey) {
    if (!userKey) throw new Error("No API Key provided.");
    if (ADMIN_API_KEY && userKey === ADMIN_API_KEY) return true; 

    const res = await fetch(`https://api.torn.com/user/?selections=profile&key=${userKey}`);
    const data = await res.json();
    if (data.error) throw new Error("Invalid API Key.");

    const playerId = data.player_id?.toString();
    if (playerId && (VIP_PLAYERS.includes(playerId) || vipConfig.players.includes(playerId))) return true;

    const facId = data.faction?.faction_id?.toString();
    if (!facId || facId === "0") throw new Error("You must be in a faction to use these tools.");

    if (adminFactionId && facId === adminFactionId) return true;
    if (VIP_FACTIONS.includes(facId) || vipConfig.factions.includes(facId)) return true;
    if (subscriptions[facId] && subscriptions[facId] > Date.now()) return true;

    throw new Error(`SUBSCRIPTION REQUIRED: Your faction's access has expired. Send 5x Xanax to Owen777 [3776908] to instantly unlock access for your entire faction for 1 week!`);
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
    return Math.floor(score * (0.9 + Math.random() * 0.2));
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

// --- ENGINE 1: FF SCOUTER BATTLE STATS (USER-KEYED) ---
setInterval(async () => {
    if (statQueue.size === 0 || isProcessingStats) return;
    isProcessingStats = true;
    
    let firstEntry = statQueue.entries().next().value;
    let ffKeyToUse = firstEntry[1];
    let batch = [];
    
    for (let [id, key] of statQueue.entries()) {
        if (key === ffKeyToUse && batch.length < 40) {
            batch.push(id);
            statQueue.delete(id);
        }
    }
    
    try {
        const res = await fetch(`https://ffscouter.com/api/v1/get-stats?key=${ffKeyToUse}&targets=${batch.join(',')}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            data.forEach(p => { statsCache[p.player_id.toString()] = { stats: p.bs_estimate, time: Date.now() }; });
        }
    } catch (err) {}
    isProcessingStats = false;
}, 4000);

// --- ENGINE 2: FF SCOUTER FLIGHTS (USER-KEYED) ---
setInterval(async () => {
    if (flightQueue.size === 0 || isProcessingFlights) return;
    isProcessingFlights = true;
    
    let [targetId, ffKeyToUse] = flightQueue.entries().next().value;
    flightQueue.delete(targetId);
    
    try {
        const res = await fetch(`https://ffscouter.com/api/v1/player-flights?key=${ffKeyToUse}&target=${targetId}`);
        const data = await res.json();
        if (data.current && data.current.latest_arrival_time) {
            flightCache[targetId] = { landingTime: data.current.latest_arrival_time, time: Date.now() };
        } else {
            flightCache[targetId] = { landingTime: null, time: Date.now() };
        }
    } catch (err) {}
    isProcessingFlights = false;
}, 1000); 

// --- ENGINE 3: FF SCOUTER TIMELINES (USER-KEYED) ---
setInterval(async () => {
    if (activityQueue.size === 0 || isProcessingActivity) return;
    isProcessingActivity = true;
    
    let [targetId, ffKeyToUse] = activityQueue.entries().next().value;
    activityQueue.delete(targetId);

    const end = Math.floor(Date.now() / 1000);
    const start = end - (12 * 3600); 

    try {
        const res = await fetch(`https://ffscouter.com/api/v1/activity/player?key=${ffKeyToUse}&target=${targetId}&start=${start}&end=${end}&bucket=3600`);
        const data = await res.json();
        if (data.code === 0 && Array.isArray(data.buckets)) {
            const timeline = data.buckets.map(b => b.activity_score);
            activityCache[targetId] = { timeline: timeline, time: Date.now() };
        } else {
            activityCache[targetId] = { timeline: [], time: Date.now() };
        }
    } catch (err) {}
    isProcessingActivity = false;
}, 1500); 

// --- ENGINE 4: DEEP LOG BACKFILL & LIVE DELTA SCRAPER ---
setInterval(async () => {
    if (apiKeyPool.size === 0 || !adminFactionId) return;
    const keys = Array.from(apiKeyPool);
    
    try {
        let liveKey = keys[Math.floor(Math.random() * keys.length)];
        const liveRes = await fetch(`https://api.torn.com/faction/?selections=attacks&key=${liveKey}`);
        const liveData = await liveRes.json();
        
        if (liveData.attacks) {
            for (let [atkId, atk] of Object.entries(liveData.attacks)) {
                if (processedAttackIds.has(atkId)) continue;
                processedAttackIds.add(atkId);
                
                if (atk.defender_faction && atk.defender_faction.toString() === adminFactionId) {
                    let uId = atk.defender_id.toString();
                    let attFacId = atk.attacker_faction ? atk.attacker_faction.toString() : "0";
                    if (!liveDefends[uId]) liveDefends[uId] = {};
                    liveDefends[uId][attFacId] = (liveDefends[uId][attFacId] || 0) + 1;
                }
                if (atk.attacker_faction && atk.attacker_faction.toString() === adminFactionId) {
                    let uId = atk.attacker_id.toString();
                    let defFacId = atk.defender_faction ? atk.defender_faction.toString() : "0";
                    if (!liveAttacks[uId]) liveAttacks[uId] = {};
                    liveAttacks[uId][defFacId] = (liveAttacks[uId][defFacId] || 0) + 1;
                }
            }
        }
    } catch (err) {}
}, 20000); 

// --- ADMIN API ROUTES ---
app.get('/api/admin/vips', (req, res) => {
    if (req.query.apiKey !== ADMIN_API_KEY || !ADMIN_API_KEY) return res.status(403).json({error: "Access Denied."});
    res.json(vipConfig);
});

app.post('/api/admin/vips', (req, res) => {
    if (req.body.apiKey !== ADMIN_API_KEY || !ADMIN_API_KEY) return res.status(403).json({error: "Access Denied."});
    vipConfig = { factions: req.body.factions || [], players: req.body.players || [] };
    saveVipConfig();
    res.json({ success: true });
});

app.get('/api/get-discord-config', (req, res) => { res.json(discordConfig); });
app.post('/api/save-discord-config', (req, res) => { discordConfig = { ...discordConfig, ...req.body }; saveDiscordConfig(); res.json({ success: true }); });
app.get('/api/get-market-config', (req, res) => { res.json(marketConfig); });
app.post('/api/save-market-config', (req, res) => { marketConfig = { ...marketConfig, ...req.body }; saveMarketConfig(); res.json({ success: true }); });

// --- MAIN WARBOARD ROUTE ---
app.get('/api/warboard', async (req, res) => {
    try {
        const userKey = req.query.apiKey && req.query.apiKey !== "null" ? req.query.apiKey : TORN_API_KEY;
        const ffKey = req.query.ffKey && req.query.ffKey !== "null" && req.query.ffKey !== "" ? req.query.ffKey : null;
        
        await verifySubscription(userKey);
        if (userKey) apiKeyPool.add(userKey);

        let enemyId = req.query.enemyFaction && req.query.enemyFaction !== "null" && req.query.enemyFaction !== "" ? req.query.enemyFaction : null;
        
        let [myData, enemyDataResult] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })),
            enemyId ? fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })) : Promise.resolve({ members: {} })
        ]);
        
        if (myData.error) return res.status(400).json({ error: "Invalid API Key" });
        if (!adminFactionId && myData.ID) adminFactionId = myData.ID.toString();
        
        if (!enemyId) enemyId = autoDetectEnemyFaction(myData);
        if (enemyId && Object.keys(enemyDataResult.members || {}).length === 0) { 
            enemyDataResult = await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })); 
        }
        
        let myFacId = myData.ID?.toString();
        let liveWarStats = {};
        if (myData.rankedwars) {
            for (let [id, w] of Object.entries(myData.rankedwars)) {
                if (w.war && w.war.winner === 0) {
                    if (w.factions[myFacId] && w.factions[myFacId].members) liveWarStats = w.factions[myFacId].members;
                    break;
                }
            }
        }

        const friendlyIds = new Set(Object.keys(myData.members || {}));
        const enemyIds = new Set(Object.keys(enemyDataResult.members || {}));
        
        [...friendlyIds, ...enemyIds].forEach(id => {
            if (!statsCache[id] || (Date.now() - statsCache[id].time) > 3600000) { 
                if (ffKey && !statQueue.has(id)) statQueue.set(id, ffKey); 
            }
            const m = myData.members[id] || enemyDataResult.members[id];
            const isTraveling = m.status?.state === "Traveling" || (m.status?.description && m.status?.description.includes("Traveling"));
            if (isTraveling) { 
                if (!flightCache[id] || (Date.now() - flightCache[id].time) > 30000) { 
                    if (ffKey && !flightQueue.has(id)) flightQueue.set(id, ffKey); 
                } 
            }
        });

        const parseMembers = (data, isEnemy = false) => {
            if (!data.members) return [];
            return Object.entries(data.members).map(([id, m]) => {
                
                const est = manualStats[id]?.stats !== undefined ? manualStats[id].stats : 
                            (statsCache[id]?.stats !== undefined ? statsCache[id].stats : 
                            (ffKey ? "Scanning..." : "🔒 Requires FF Scouter"));

                const isTraveling = m.status?.state === "Traveling" || (m.status?.description && m.status?.description.includes("Traveling"));
                
                let finalUntil = m.status?.until; 
                let finalLandingTime = null;
                let needsFfScouterForFlights = false;

                if (isTraveling) { 
                    if (flightCache[id]?.landingTime) {
                        finalLandingTime = flightCache[id].landingTime;
                        finalUntil = finalLandingTime;
                    } else {
                        if (!ffKey) needsFfScouterForFlights = true;
                    }
                }

                const intelScore = isEnemy ? computeWarIntel({ id, state: m.status?.state, until: finalUntil, onlineStatus: m.last_action?.status || "Offline", estStats: typeof est === 'number' ? est : null }, statsCache) : null;
                
                if (isEnemy && backups[id] && m.status?.state === "Hospital") { const timeLeft = m.status.until - Math.floor(Date.now() / 1000); if (timeLeft > 1800) delete backups[id]; }
                
                let attacks = 0; let score = 0; let defends = 0; 
                if (enemyId) {
                    if (liveAttacks[id] && liveAttacks[id][enemyId]) attacks = liveAttacks[id][enemyId];
                    if (liveDefends[id] && liveDefends[id][enemyId]) defends = liveDefends[id][enemyId];
                }
                if (!isEnemy && liveWarStats[id]) {
                    attacks = Math.max(attacks, liveWarStats[id].attacks || 0); 
                    score = liveWarStats[id].score || 0;
                }

                return { 
                    id, name: m.name, state: m.status?.state, until: finalUntil, 
                    statusDescription: m.status?.description || "", onlineStatus: m.last_action?.status || "Offline", 
                    lastActionRelative: m.last_action?.relative || "Unknown", 
                    landingTime: finalLandingTime, needsFfScouterForFlights,
                    claimedBy: isEnemy ? claims[id]?.playerName || null : null, 
                    needsBackup: isEnemy ? backups[id]?.playerName || null : null, 
                    estStats: est, intelScore, isManual: !!manualStats[id], attacks, score, defends 
                };
            });
        };
        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true), detectedEnemyId: enemyId });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.post('/api/update-stats', (req, res) => { const { enemyId, stats } = req.body; manualStats[enemyId] = { stats: parseInt(stats), time: Date.now() }; res.json({ success: true }); });
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
