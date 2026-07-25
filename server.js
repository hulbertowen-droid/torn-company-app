const express = require('express');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
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

const VIP_FACTIONS = (process.env.VIP_FACTIONS || "").split(',').map(id => id.trim());
const VIP_PLAYERS = (process.env.VIP_PLAYERS || "").split(',').map(id => id.trim());

// Local Databases & Caches
let claims = {};
let backups = {}; 
let statsCache = {}; 
let manualStats = {}; 
let flightCache = {}; 
let activityCache = {}; 
let warScrapeCache = {}; 
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
let activeWarId = null;
let hasBackfilledWar = false;
let processedAttackIds = new Set();

const BONUS_THRESHOLDS = new Set([10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]);

let subscriptions = {};
let adminFactionId = null;
let dynamicFactionId = null; 
let lastEventTimestamp = Math.floor(Date.now() / 1000);

let lastChainTimeoutAlertState = false;
let backgroundEnemyTrackingState = {};

let discordConfig = { webhookUrl: "", targetOnline: true, targetLanded: true, targetOutHosp: true, chainUnder90: true, chainMilestone: true, friendlyAttacked: true, apiKey: "", factionId: "", medOutSniper: true };
let marketConfig = { webhookUrl: "", autoDefense: false, sniperTargets: [] };
let marketMemory = { defense: {}, sniper: {} };
let ocConfig = { webhookUrl: "", roleId: "" };
let ocMemory = {};
let vipConfig = { factions: [], players: [] }; 

try { if (fs.existsSync('subscriptions.json')) subscriptions = JSON.parse(fs.readFileSync('subscriptions.json')); } catch (e) {}
try { if (fs.existsSync('discord_config.json')) discordConfig = { ...discordConfig, ...JSON.parse(fs.readFileSync('discord_config.json')) }; } catch(e) {}
try { if (fs.existsSync('market_config.json')) marketConfig = { ...marketConfig, ...JSON.parse(fs.readFileSync('market_config.json')) }; } catch(e) {}
try { if (fs.existsSync('oc_config.json')) ocConfig = { ...ocConfig, ...JSON.parse(fs.readFileSync('oc_config.json')) }; } catch(e) {}
try { if (fs.existsSync('vip_config.json')) vipConfig = { ...vipConfig, ...JSON.parse(fs.readFileSync('vip_config.json')) }; } catch(e) {}
try { if (fs.existsSync('spy_db.json')) spyDatabase = JSON.parse(fs.readFileSync('spy_db.json')); } catch(e) {}
try { if (fs.existsSync('user_tracking.json')) userTracking = JSON.parse(fs.readFileSync('user_tracking.json')); } catch(e) {}
try { if (fs.existsSync('api_pool.json')) apiPoolConfig = JSON.parse(fs.readFileSync('api_pool.json')); } catch(e) {}

function saveSubs() { fs.writeFileSync('subscriptions.json', JSON.stringify(subscriptions)); }
function saveDiscordConfig() { fs.writeFileSync('discord_config.json', JSON.stringify(discordConfig)); }
function saveMarketConfig() { fs.writeFileSync('market_config.json', JSON.stringify(marketConfig)); }
function saveOcConfig() { fs.writeFileSync('oc_config.json', JSON.stringify(ocConfig)); }
function saveVipConfig() { fs.writeFileSync('vip_config.json', JSON.stringify(vipConfig)); }
function saveSpyDb() { fs.writeFileSync('spy_db.json', JSON.stringify(spyDatabase)); }
function saveTracking() { fs.writeFileSync('user_tracking.json', JSON.stringify(userTracking)); }
function saveApiPool() { fs.writeFileSync('api_pool.json', JSON.stringify(apiPoolConfig)); }

if (ADMIN_API_KEY) {
    fetch(`https://api.torn.com/user/?selections=profile&key=${ADMIN_API_KEY}`)
        .then(r => r.json())
        .then(d => { if (d.faction) adminFactionId = d.faction.faction_id?.toString(); })
        .catch(e => console.error("Failed to load admin profile"));
}

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
    if (activeKeys.length === 0) return null;
    
    let key = activeKeys[activeKeyIndex % activeKeys.length];
    activeKeyIndex++;
    return key;
}

async function sendDiscordEmbed(webhookUrl, { pingText, title, description, color, fields, links }) {
    if (!webhookUrl) return;
    
    let payload = {
        content: pingText || null, 
        embeds: [{
            title: title,
            description: description,
            color: color,
            fields: fields || [],
            footer: { text: "Owen's Faction Tools • " + new Date().toISOString().replace('T', ' ').substring(0, 19) + " UTC" }
        }]
    };

    if (links && links.length > 0) {
        let components = [];
        links.forEach(l => { components.push({ type: 2, style: 5, label: l.label, url: l.url }); });
        payload.components = [{ type: 1, components: components }];
    }

    try { await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } 
    catch(e) { console.error("Discord webhook failed", e); }
}

async function getDiscordId(tornId) {
    if (discordIdCache[tornId]) return discordIdCache[tornId];
    let key = getNextApiKey();
    if (!key) return null;
    try {
        let res = await fetch(`https://api.torn.com/user/${tornId}?selections=discord&key=${key}`);
        let data = await res.json();
        if (data.discord && data.discord.userID) {
            discordIdCache[tornId] = data.discord.userID;
            return data.discord.userID;
        }
        discordIdCache[tornId] = "none"; 
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
                            
                            sendDiscordEmbed(ADMIN_DISCORD_WEBHOOK, {
                                title: "💰 Payment Received",
                                description: `Faction \`${facId}\` sent **${qty}x Xanax** for ${weeks} weeks of Warboard access!`,
                                color: 3069299
                            });
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
            const res = await fetch(`https://api.torn.com/faction/?selections=attacks&to=${toTimestamp}&key=${watchKey}`);
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
                    if (atk.defender_faction && atk.defender_faction.toString() === watchFactionId.toString()) {
                        let uId = atk.defender_id.toString();
                        let attFacId = atk.attacker_faction ? atk.attacker_faction.toString() : "0";
                        if (!persistentDefends[uId]) persistentDefends[uId] = {};
                        persistentDefends[uId][attFacId] = (persistentDefends[uId][attFacId] || 0) + 1;
                    }
                    if (atk.attacker_faction && atk.attacker_faction.toString() === watchFactionId.toString()) {
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

// Background Task 1: Wall Watcher & Scraper
setInterval(async () => {
    let watchKey = getNextApiKey();
    let watchFactionId = adminFactionId || discordConfig.factionId || dynamicFactionId;
    if (!watchKey || !watchFactionId) return;

    try {
        const liveRes = await fetch(`https://api.torn.com/faction/?selections=attacks,basic,rankedwars&key=${watchKey}`);
        const liveData = await liveRes.json();
        
        if (liveData.rankedwars) {
            let ongoingWar = Object.values(liveData.rankedwars).find(w => w.war && w.war.winner === 0);
            if (ongoingWar) {
                if (activeWarId !== ongoingWar.war.start) {
                    activeWarId = ongoingWar.war.start;
                    persistentDefends = {}; liveAttacks = {}; hasBackfilledWar = false; processedAttackIds.clear(); 
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
                
                if (atk.defender_faction && atk.defender_faction.toString() === watchFactionId.toString()) {
                    let uId = atk.defender_id.toString();
                    let attFacId = atk.attacker_faction ? atk.attacker_faction.toString() : "0";
                    let attackerId = atk.attacker_id.toString();

                    if (!persistentDefends[uId]) persistentDefends[uId] = {};
                    persistentDefends[uId][attFacId] = (persistentDefends[uId][attFacId] || 0) + 1;
                    
                    if (hasBackfilledWar && discordConfig.friendlyAttacked && discordConfig.webhookUrl) {
                        let attackerName = atk.attacker_name || "Unknown"; 
                        let attackerFactionName = atk.attacker_faction_name || "None"; 
                        let defenderName = atk.defender_name || uId;

                        let enemyEst = (spyDatabase[attackerId] && spyDatabase[attackerId].total) ? spyDatabase[attackerId].total : (statsCache[attackerId]?.stats || manualStats[attackerId]?.stats || 0);
                        let statStr = enemyEst > 0 ? enemyEst.toLocaleString() : "Unknown";

                        let dId = await getDiscordId(uId);
                        let pingStr = (dId && dId !== "none") ? `<@${dId}>` : "";

                        sendDiscordEmbed(discordConfig.webhookUrl, {
                            pingText: pingStr,
                            title: "🛡️ Wall Watcher: Friendly Attacked",
                            description: `**${attackerName}** [${attackerId}] from \`${attackerFactionName}\` just attacked **${defenderName}**!`,
                            color: 16729943,
                            fields: [{ name: "Enemy Est. Stats", value: statStr, inline: true }],
                            links: [
                                { label: "⚔️ RETALIATE", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${attackerId}` },
                                { label: "Enemy Profile", url: `https://www.torn.com/profiles.php?XID=${attackerId}` }
                            ]
                        });
                    }
                }
                
                if (atk.attacker_faction && atk.attacker_faction.toString() === watchFactionId.toString()) {
                    let uId = atk.attacker_id.toString();
                    let defFacId = atk.defender_faction ? atk.defender_faction.toString() : "0";
                    if (!liveAttacks[uId]) liveAttacks[uId] = {};
                    liveAttacks[uId][defFacId] = (liveAttacks[uId][defFacId] || 0) + 1;

                    if (atk.chain && BONUS_THRESHOLDS.has(atk.chain)) {
                        if (hasBackfilledWar && discordConfig.chainMilestone && discordConfig.webhookUrl) {
                            sendDiscordEmbed(discordConfig.webhookUrl, {
                                title: "🏆 Chain Milestone Secured",
                                description: `Hit **#${atk.chain}** executed by \`${atk.attacker_name || uId}\` (+${atk.respect_gain || 0} respect)!`,
                                color: 16753922
                            });
                        }
                    }
                }
            }
        }
    } catch (err) {}
}, 20000); 

// Background Task 2: Market Watcher
setInterval(async () => {
    let watchKey = getNextApiKey();
    if (!marketConfig.webhookUrl || !watchKey) return;
    
    try {
        if (marketConfig.autoDefense) {
            let rootKey = ADMIN_API_KEY || discordConfig.apiKey || watchKey;
            const userRes = await fetch(`https://api.torn.com/user/?selections=bazaar,profile&key=${rootKey}`);
            const userData = await userRes.json();
            
            if (userData.bazaar && userData.bazaar.length > 0) {
                let myPrices = {};
                userData.bazaar.forEach(item => {
                    if (!myPrices[item.ID] || item.price < myPrices[item.ID].price) { myPrices[item.ID] = { price: item.price, name: item.name }; }
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
                                sendDiscordEmbed(marketConfig.webhookUrl, {
                                    title: "📉 Market Undercut Alert",
                                    description: `Your \`${myItem.name}\` ($${myItem.price.toLocaleString()}) was undercut!\nNew lowest price: **$${lowestMarketPrice.toLocaleString()}**`,
                                    color: 16729943,
                                    links: [{ label: "🛒 Check Market", url: `https://www.torn.com/imarket.php#/p=shop&step=shop&type=&searchname=${myItem.name}` }]
                                });
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
    let watchKey = getNextApiKey();
    let watchFactionId = adminFactionId || discordConfig.factionId || dynamicFactionId;
    if (!watchKey || !watchFactionId) return;

    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,chain,rankedwars&key=${watchKey}`);
        const facData = await facRes.json();
        if (facData.error) return;

        if (facData.chain && facData.chain.current >= 10) {
            let secondsLeft = facData.chain.timeout;
            if (secondsLeft <= 90 && secondsLeft > 0 && !lastChainTimeoutAlertState && discordConfig.chainUnder90 && discordConfig.webhookUrl) {
                sendDiscordEmbed(discordConfig.webhookUrl, {
                    pingText: "@here",
                    title: "⚠️ CHAIN DROPPING WARNING",
                    description: `Active chain is under 90 seconds (**${secondsLeft}s** left)! Someone needs to make a hit right now!`,
                    color: 16729943,
                    links: [{ label: "🔗 View Chain", url: `https://www.torn.com/factions.php?step=your#/tab=chains` }]
                });
                lastChainTimeoutAlertState = true;
            } else if (secondsLeft > 120) { lastChainTimeoutAlertState = false; }
        } else { lastChainTimeoutAlertState = false; }

        let activeEnemyId = autoDetectEnemyFaction(facData);
        if (activeEnemyId && discordConfig.webhookUrl) {
            let rotationKey = getNextApiKey();
            const enemyRes = await fetch(`https://api.torn.com/faction/${activeEnemyId}?selections=basic&key=${rotationKey}`);
            const enemyData = await enemyRes.json();
            
            if (enemyData.members) {
                Object.entries(enemyData.members).forEach(async ([id, m]) => {
                    let oldRecord = backgroundEnemyTrackingState[id];
                    let newRecord = { state: m.status?.state, online: m.last_action?.status, description: m.status?.description, until: m.status?.until };
                    
                    if (oldRecord) {
                        if (oldRecord.online !== "Online" && newRecord.online === "Online" && discordConfig.targetOnline) {
                            sendDiscordEmbed(discordConfig.webhookUrl, {
                                title: "🟢 Target Online",
                                description: `**${m.name}** [${id}] just established a connection and is Online!`,
                                color: 3069299,
                                links: [{ label: "⚔️ ATTACK", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }]
                            });
                        }
                        
                        if (oldRecord.state === "Hospital" && newRecord.state === "Okay") {
                            let now = Math.floor(Date.now() / 1000);
                            let leftEarly = oldRecord.until && (oldRecord.until > now + 60);

                            if (leftEarly && newRecord.online === "Online" && discordConfig.medOutSniper) {
                                let enemyEst = (spyDatabase[id] && spyDatabase[id].total) ? spyDatabase[id].total : (statsCache[id]?.stats || manualStats[id]?.stats || 0);
                                let bestMatchName = "Anyone available";
                                let bestMatchId = null;
                                
                                if (facData.members) {
                                    let friendliesAvailable = Object.entries(facData.members).filter(([fid, fm]) => fid !== id && (fm.last_action?.status === "Online" || fm.last_action?.status === "Idle"));
                                    if (friendliesAvailable.length > 0 && enemyEst > 0) {
                                        let bestDiff = Infinity;
                                        for(let [fid, fm] of friendliesAvailable) {
                                            let fEst = (spyDatabase[fid] && spyDatabase[fid].total) ? spyDatabase[fid].total : (statsCache[fid]?.stats || manualStats[fid]?.stats || 0);
                                            if (fEst >= enemyEst * 0.7) {
                                                let diff = Math.abs(fEst - enemyEst);
                                                if (diff < bestDiff) { bestDiff = diff; bestMatchName = fm.name; bestMatchId = fid; }
                                            }
                                        }
                                    }
                                }

                                let pingStr = "";
                                if (bestMatchId) {
                                    let dId = await getDiscordId(bestMatchId);
                                    if (dId && dId !== "none") pingStr = `<@${dId}>`;
                                }

                                let statStr = enemyEst > 0 ? `~${enemyEst.toLocaleString()}` : "Unknown";
                                sendDiscordEmbed(discordConfig.webhookUrl, {
                                    pingText: pingStr,
                                    title: "🚨 MED-OUT SNIPER ENGAGED",
                                    description: `**${m.name}** [${id}] just used meds or received a revive to escape the hospital early and is currently ONLINE!`,
                                    color: 16729943,
                                    fields: [
                                        { name: "Target Est. Stats", value: statStr, inline: true },
                                        { name: "Tactical Assignment", value: `👉 **${bestMatchName}**, you have the stats to take them down!`, inline: false }
                                    ],
                                    links: [{ label: "⚔️ ATTACK NOW", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }]
                                });
                                
                            } else if (discordConfig.targetOutHosp && !leftEarly) {
                                sendDiscordEmbed(discordConfig.webhookUrl, {
                                    title: "🏥 Target Out of Hospital",
                                    description: `**${m.name}** [${id}] naturally finished their hospital time and is Okay!`,
                                    color: 16753922,
                                    links: [{ label: "⚔️ ATTACK", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }]
                                });
                            } else if (discordConfig.targetLanded && (oldRecord.state === "Traveling" || (oldRecord.description && oldRecord.description.includes("Traveling")))) {
                                sendDiscordEmbed(discordConfig.webhookUrl, {
                                    title: "✈️ Target Landed",
                                    description: `**${m.name}** [${id}] just landed in Torn!`,
                                    color: 5809919,
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

        if (ADMIN_API_KEY && userKey === ADMIN_API_KEY) return playerId;
        if (playerId && (VIP_PLAYERS.includes(playerId) || vipConfig.players.includes(playerId))) return playerId;
        if (!facId || facId === "0") throw new Error("You must be in a faction to use these tools.");
        
        // FIXED: Using apiPoolConfig instead of the removed apiKeyPool
        if (adminFactionId && facId === adminFactionId) {
            dynamicFactionId = facId; 
            if (!apiPoolConfig.keys.includes(userKey)) {
                apiPoolConfig.keys.push(userKey);
                saveApiPool();
            }
        } else if (VIP_FACTIONS.includes(facId) || vipConfig.factions.includes(facId) || (subscriptions[facId] && subscriptions[facId] > Date.now())) {
            dynamicFactionId = facId; 
            if (!apiPoolConfig.keys.includes(userKey)) {
                apiPoolConfig.keys.push(userKey);
                saveApiPool();
            }
        } else {
            throw new Error(`SUBSCRIPTION REQUIRED: Your access has expired. Send 5x Xanax to Owen777 [3776908] to unlock!`);
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

app.get('/api/admin/keys', (req, res) => {
    if (req.query.apiKey !== ADMIN_API_KEY || !ADMIN_API_KEY) return res.status(403).json({error: "Access Denied."});
    res.json(apiPoolConfig);
});
app.post('/api/admin/keys', (req, res) => {
    if (req.body.apiKey !== ADMIN_API_KEY || !ADMIN_API_KEY) return res.status(403).json({error: "Access Denied."});
    apiPoolConfig.keys = req.body.keys || [];
    saveApiPool();
    res.json({ success: true });
});

app.get('/api/admin/tracking', (req, res) => {
    if (req.query.apiKey !== ADMIN_API_KEY || !ADMIN_API_KEY) return res.status(403).json({error: "Access Denied."});
    res.json(userTracking);
});

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

app.post('/api/discord-ping', async (req, res) => {
    const { webhookUrl, message } = req.body;
    if (!webhookUrl || !message) return res.status(400).json({ error: "Missing data" });
    try {
        await sendDiscordEmbed(webhookUrl, {
            title: "📡 Connection Diagnostic Confirmation",
            description: message,
            color: 3069299 
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed to ping Discord" }); }
});

app.get('/api/war-list', async (req, res) => {
    const userKey = req.query.apiKey;
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
    const userKey = req.query.apiKey;
    const ffKey = req.query.ffKey || null;
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
                parsedMembers[id] = { ...m, timeline: isPremium ? (activityCache[id]?.timeline || null) : null };
            });
        }

        res.json({ success: true, members: parsedMembers, loans: loans, armoryError, premiumActive: isPremium });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.get('/api/scan-recruits', async (req, res) => {
    const { apiKey, reportId, ffKey } = req.query;
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

        let potentialRecruits = [];
        for (let [id, m] of Object.entries(enemyWarData.members || {})) {
            if (m.score > 200 || m.attacks > 10) {
                if (isPremium && !statQueue.has(id) && !statsCache[id]) statQueue.set(id, ffKey);
                let currentStatus = "Factionless / Left"; let position = "None"; let daysInFaction = 0; let isPoachable = true;

                if (currentRoster[id]) {
                    position = currentRoster[id].position; daysInFaction = currentRoster[id].days_in_faction;
                    if (position.toLowerCase().match(/(leader|management|council|co-leader)/)) { isPoachable = false; } 
                    else { currentStatus = `Member (${position})`; }
                }

                if (isPoachable) {
                    let efficiency = m.attacks > 0 ? (m.score / m.attacks).toFixed(1) : 0;
                    let est = statsCache[id] ? statsCache[id].stats : (isPremium ? "Scanning..." : "🔒 FF Scouter Req.");
                    potentialRecruits.push({ id, name: m.name, score: m.score, attacks: m.attacks, efficiency, status: currentStatus, days: daysInFaction, stillInFaction: !!currentRoster[id], estStats: est });
                }
            }
        }
        potentialRecruits.sort((a, b) => b.score - a.score);
        res.json({ success: true, recruits: potentialRecruits, enemyName: enemyWarData.name });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.get('/api/past-war', async (req, res) => {
    const { apiKey, reportId } = req.query;
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
        if (warScrapeCache[reportId]) {
            advancedStats = warScrapeCache[reportId];
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
                    
                    if (atk.attacker_faction && atk.attacker_faction.toString() === correctFacId) {
                        let uId = atk.attacker_id.toString();
                        if (!advancedStats[uId]) advancedStats[uId] = { assists: 0, clears: 0 };
                        
                        if (atk.result === "Assist") {
                            advancedStats[uId].assists++;
                        } else if (atk.defender_faction !== undefined && atk.defender_faction.toString() !== enemyFacId) {
                            if (["Attacked", "Mugged", "Hospitalized", "Arrested", "Special"].includes(atk.result)) {
                                advancedStats[uId].clears++;
                            }
                        }
                    }
                }
                toTimestamp = oldestTime - 1;
                pageCount++;
                await new Promise(r => setTimeout(r, 250)); 
            }
            warScrapeCache[reportId] = advancedStats;
        }

        let formattedMembers = [];
        const members = myFactionWarData.members || {};
        for (let [id, m] of Object.entries(members)) {
            let pStats = advancedStats[id] || { assists: 0, clears: 0 };
            formattedMembers.push({
                id,
                name: m.name,
                attacks: m.attacks || 0,
                assists: pStats.assists,
                clears: pStats.clears,
                score: m.score || 0
            });
        }

        res.json({ success: true, members: formattedMembers, rewards: { totalCacheValue, caches: cachesWon, points: myFactionWarData?.rewards?.points||0, respect: myFactionWarData?.rewards?.respect||0 } });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.post('/api/claim', (req, res) => { const { enemyId, playerName } = req.body; claims[enemyId] = { playerName, time: Date.now() }; res.json({ success: true }); });
app.post('/api/unclaim', (req, res) => { const { enemyId, playerName } = req.body; if (claims[enemyId]?.playerName === playerName) delete claims[enemyId]; res.json({ success: true }); });
app.post('/api/backup', (req, res) => { const { enemyId, playerName } = req.body; backups[enemyId] = { playerName, time: Date.now() }; res.json({ success: true }); });
app.post('/api/unbackup', (req, res) => { const { enemyId } = req.body; delete backups[enemyId]; res.json({ success: true }); });
app.post('/api/update-stats', (req, res) => { const { enemyId, stats } = req.body; manualStats[enemyId] = { stats: parseInt(stats), time: Date.now() }; res.json({ success: true }); });

app.get('/api/inspect', async (req, res) => {
    const { apiKey, targetId, tsKey } = req.query;
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
    try {
        const userKey = req.query.apiKey && req.query.apiKey !== "null" ? req.query.apiKey : TORN_API_KEY;
        const ffKey = req.query.ffKey && req.query.ffKey !== "null" && req.query.ffKey !== "" ? req.query.ffKey : null;
        await verifySubscription(userKey);

        const isPremium = (ffKey && ffKey !== "null" && ffKey.trim().length > 10);
        let enemyId = req.query.enemyFaction || null;
        
        let activeKey = getNextApiKey() || userKey;
        let [myData, enemyDataResult] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${activeKey}`).then(r => r.json()).catch(() => ({ members: {} })),
            enemyId ? fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${getNextApiKey()||userKey}`).then(r => r.json()).catch(() => ({ members: {} })) : Promise.resolve({ members: {} })
        ]);
        
        if (!enemyId) enemyId = autoDetectEnemyFaction(myData);
        if (enemyId && Object.keys(enemyDataResult.members || {}).length === 0) { 
            enemyDataResult = await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${getNextApiKey()||userKey}`).then(r => r.json()).catch(() => ({ members: {} })); 
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

                let timeline = activityCache[id]?.timeline || null;

                return { id, name: m.name, state: m.status?.state, until: finalUntil, statusDescription: m.status?.description || "", onlineStatus: m.last_action?.status || "Offline", lastActionRelative: m.last_action?.relative || "Unknown", landingTime: finalLandingTime, needsFfScouterForFlights, claimedBy: isEnemy ? claims[id]?.playerName || null : null, needsBackup: isEnemy ? backups[id]?.playerName || null : null, estStats: est, intelScore: isEnemy ? computeWarIntel({ id, state: m.status?.state, until: finalUntil, onlineStatus: m.last_action?.status || "Offline", estStats: typeof est === 'number' ? est : null }, statsCache) : null, isManual: !!manualStats[id], attacks, score, defends, timeline };
            });
        };
        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true), detectedEnemyId: enemyId, premiumActive: isPremium });
    } catch (err) { res.status(403).json({ error: err.message }); }
});
app.post('/api/save-oc-config', (req, res) => {
    const { webhookUrl, roleId } = req.body;
    if (webhookUrl !== undefined) ocConfig.webhookUrl = webhookUrl;
    if (roleId !== undefined) ocConfig.roleId = roleId;
    saveOcConfig();
    res.json({ success: true });
});

app.get('/api/ocs', async (req, res) => {
    try {
        const userKey = req.query.apiKey && req.query.apiKey !== "null" ? req.query.apiKey : TORN_API_KEY;
        if (!userKey) return res.status(400).json({ error: "No API key provided. Please add your API key in Settings." });

        // Fetch OC crimes AND faction members in parallel using the user's own key
        const [crimeRes, memberRes] = await Promise.all([
            fetch(`https://api.torn.com/v2/faction/crimes?cat=available&key=${userKey}`),
            fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`)
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
        if (ocConfig.webhookUrl) {
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
                            sendDiscordEmbed(ocConfig.webhookUrl, {
                                pingText: mention,
                                title: `🚨 OC Issue: ${crime.name}`,
                                description: `**Player:** [${pName}](https://www.torn.com/profiles.php?XID=${pId})\n**Role:** ${slot.position_info?.label || slot.position}\n**Issue:** ${issueMessage}`,
                                color: 16733695
                            });
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
