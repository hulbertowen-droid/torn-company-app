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
let enemyMembersCache = {};
let lastEnemyScrape = 0;

const BONUS_THRESHOLDS = new Set([10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]);


let dynamicFactionId = null; 
let lastEventTimestamp = Math.floor(Date.now() / 1000);

let lastChainTimeoutAlertState = false;
let backgroundEnemyTrackingState = {};

let discordConfig = { globalChannelId: "", targetOnline: true, targetLanded: true, targetOutHosp: true, chainUnder90: true, chainMilestone: true, friendlyAttacked: true, apiKey: "", factionId: "", medOutSniper: true };
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

function saveDiscordConfig() { fs.writeFileSync('discord_config.json', JSON.stringify(discordConfig)); }
function saveMarketConfig() { fs.writeFileSync('market_config.json', JSON.stringify(marketConfig)); }
function saveOcConfig() { fs.writeFileSync('oc_config.json', JSON.stringify(ocConfig)); }

function saveSpyDb() { fs.writeFileSync('spy_db.json', JSON.stringify(spyDatabase)); }
function saveTracking() { fs.writeFileSync('user_tracking.json', JSON.stringify(userTracking)); }
function saveApiPool() { fs.writeFileSync('api_pool.json', JSON.stringify(apiPoolConfig)); }
function saveCompanyConfig() { fs.writeFileSync('company_config.json', JSON.stringify(companyConfig)); }

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

// Background Task 1: Wall Watcher & Scraper
setInterval(async () => {
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
                    
                    let friendlyMem = liveData.members ? liveData.members[uId] : null;
                    if (friendlyMem && friendlyMem.status.state !== "Traveling") {
                        if (!friendlyHitTracker[uId]) friendlyHitTracker[uId] = { count: 0, lastHit: 0, alertedAt: 0 };
                        let now = Date.now();
                        if (now - friendlyHitTracker[uId].lastHit > 15 * 60 * 1000) friendlyHitTracker[uId].count = 0;
                        friendlyHitTracker[uId].count++;
                        friendlyHitTracker[uId].lastHit = now;
                        
                        if (friendlyHitTracker[uId].count >= 3 && (now - friendlyHitTracker[uId].alertedAt > 30 * 60 * 1000)) {
                            friendlyHitTracker[uId].alertedAt = now;
                            friendlyHitTracker[uId].count = 0;
                            let dId = await getDiscordId(uId);
                            let pingStr = (dId && dId !== "none") ? `<@${dId}>` : "";
                            if (discordConfig.chainWarnings !== false) {
                                let embed = {
                                    title: "⚠️ CHAIN ATTACK WARNING",
                                    description: `**${friendlyMem.name}**, you have been hit 3 consecutive times in Torn! Log in and react!`,
                                    color: 16729943
                                };
                                if (discordConfig.globalBotToken && discordConfig.globalChannelId) {
                                    sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, embed, pingStr);
                                }
                            }
                        }
                    }
                    
                    if (hasBackfilledWar && discordConfig.friendlyAttacked && discordConfig.globalChannelId) {
                        let attackerName = atk.attacker_name || "Unknown"; 
                        let attackerFactionName = atk.attacker_faction_name || "None"; 
                        let defenderName = atk.defender_name || uId;

                        let enemyEst = (spyDatabase[attackerId] && spyDatabase[attackerId].total) ? spyDatabase[attackerId].total : (statsCache[attackerId]?.stats || manualStats[attackerId]?.stats || 0);
                        let statStr = enemyEst > 0 ? enemyEst.toLocaleString() : "Unknown";

                        let dId = await getDiscordId(uId);
                        let pingStr = (dId && dId !== "none") ? `<@${dId}>` : "";

                        if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { title: "🛡️ Wall Watcher: Friendly Attacked", description: `**${attackerName}** [${attackerId}] from \`${attackerFactionName}\` just attacked **${defenderName}**!`,
                            color: 16729943,
                            fields: [{ name: "Enemy Est. Stats", value: statStr, inline: true }],
                            links: [
                                { label: "⚔️ RETALIATE", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${attackerId}` },
                                { label: "Enemy Profile", url: `https://www.torn.com/profiles.php?XID=${attackerId}` }
                            ]
                        });
                    }
                }
                
                if (isWin && atk.attacker_faction && atk.attacker_faction.toString() === watchFactionId.toString()) {
                    let uId = atk.attacker_id.toString();
                    let defFacId = atk.defender_faction ? atk.defender_faction.toString() : "0";
                    if (!liveAttacks[uId]) liveAttacks[uId] = {};
                    liveAttacks[uId][defFacId] = (liveAttacks[uId][defFacId] || 0) + 1;

                    if (atk.chain && BONUS_THRESHOLDS.has(atk.chain)) {
                        if (hasBackfilledWar && discordConfig.chainMilestone && discordConfig.globalChannelId) {
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
            
            let enemyThreats = {}; 
            for (let [eId, eMem] of Object.entries(enemyMembersCache)) {
                let det = (eMem.status && eMem.status.details) ? eMem.status.details : "";
                if (det.includes("Traveling to ")) {
                    let country = COUNTRIES.find(c => det.includes(c));
                    if (country) {
                        if (!enemyThreats[country]) enemyThreats[country] = [];
                        enemyThreats[country].push(eMem.name);
                    }
                }
            }

            for (let [uId, fMem] of Object.entries(liveData.members)) {
                let det = (fMem.status && fMem.status.details) ? fMem.status.details : "";
                let fCountry = COUNTRIES.find(c => det.includes(c));
                if (fCountry && enemyThreats[fCountry] && enemyThreats[fCountry].length > 0) {
                    let lastAlert = travelAlerts[uId] || 0;
                    if (Date.now() - lastAlert > 15 * 60 * 1000) {
                        travelAlerts[uId] = Date.now();
                        let dId = await getDiscordId(uId);
                        let pingStr = (dId && dId !== "none") ? `<@${dId}>` : "";
                        if (discordConfig.travelWarnings !== false) {
                            let embed = {
                                title: "✈️ TRAVEL WARNING",
                                description: `**${fMem.name}**, an enemy (**${enemyThreats[fCountry][0]}**) is currently flying to **${fCountry}** where you are located (or heading)!\n\nFly away or return to Torn immediately!`,
                                color: 16729943
                            };
                            if (discordConfig.globalBotToken && discordConfig.globalChannelId) {
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
                        if (oldRecord.online !== "Online" && newRecord.online === "Online" && discordConfig.targetOnline) {
                            if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { title: "🟢 Target Online", description: `**${m.name}** [${id}] just established a connection and is Online!`, color: 3069299, links: [{ label: "⚔️ ATTACK", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }] });
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
                                if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { title: "🚨 MED-OUT SNIPER ENGAGED", description: `**${m.name}** [${id}] just used meds or received a revive to escape the hospital early and is currently ONLINE!`,
                                    color: 16729943,
                                    fields: [
                                        { name: "Target Est. Stats", value: statStr, inline: true },
                                        { name: "Tactical Assignment", value: `👉 **${bestMatchName}**, you have the stats to take them down!`, inline: false }
                                    ],
                                    links: [{ label: "⚔️ ATTACK NOW", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }]
                                });
                                
                            } else if (discordConfig.targetOutHosp && !leftEarly) {
                                if (discordConfig.globalBotToken) sendChannelMessage(discordConfig.globalBotToken, discordConfig.globalChannelId, { title: "🏥 Target Out of Hospital", description: `**${m.name}** [${id}] naturally finished their hospital time and is Okay!`, color: 16753922, links: [{ label: "⚔️ ATTACK", url: `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` }] }, pingStr);
                            } else if (discordConfig.targetLanded && (oldRecord.state === "Traveling" || (oldRecord.description && oldRecord.description.includes("Traveling")))) {
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
    if (discordConfig.globalBotToken) getDiscordClient(discordConfig.globalBotToken);
    res.json({ success: true }); 
});

app.get('/api/get-market-config', (req, res) => { res.json(marketConfig); });
app.post('/api/save-market-config', (req, res) => { marketConfig = { ...marketConfig, ...req.body }; saveMarketConfig(); res.json({ success: true }); });

app.post('/api/test-discord-alert', async (req, res) => {
    const { type, discordId, globalChannelId, globalBotToken } = req.body;
    let chanId = globalChannelId || discordConfig.globalChannelId;
    let botToken = globalBotToken || discordConfig.globalBotToken;
    
    if (!(botToken && chanId)) {
        return res.json({ success: false, error: "No Faction Bot Token or Channel ID provided." });
    }
    
    let pingStr = discordId ? `<@${discordId}>` : "";
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

    let result = await sendChannelMessage(botToken, chanId, embed, pingStr);
    if (!result.success) return res.json({ success: false, error: result.error });
    
    res.json({ success: true });
});

app.post('/api/discord-ping', async (req, res) => {
    return res.json({ success: false, error: "Deprecated endpoint. Use test-discord-alert." });
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
    const { apiKey } = req.query;
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

app.post('/api/generate-recruit-msg', async (req, res) => {
    const { playerName, score, attacks, efficiency, status, estStats, enemyFaction } = req.body;
    const factionless = status && status.toLowerCase().includes("factionless");
    const fallback = `Hey ${playerName}!\n\nI was checking the war report from our recent fight against ${enemyFaction || "your faction"} and your performance stood out — ${score} score across ${attacks} hits is seriously impressive.\n\n${factionless ? "I noticed you've since left your faction, so the timing seems perfect." : "I know you're still with your faction, but I wanted to reach out anyway."}\n\nWe run a tight, active crew focused on ranked wars and organized crimes. We'd love to have someone with your stats on our side. If you're ever looking for a change, hit me back — happy to chat.\n\nGood fight either way.\nOwen777 [3776908]`;

    if (!GEMINI_API_KEY) return res.json({ message: fallback, source: "template" });

    try {
        const prompt = `You are writing a Torn City (browser game) faction recruitment message. Keep it short (3-4 paragraphs max), casual, direct and personalized. Do NOT use generic filler like "I hope this message finds you well". Sound like a real player, not a robot.\n\nPlayer: ${playerName}\nWar stats: ${score} score, ${attacks} hits, ${efficiency} score/hit efficiency\nEst. Battle Stats: ${estStats || "Unknown"}\nCurrent faction status: ${status}\nEnemy faction they fought for: ${enemyFaction || "Unknown"}\n\nWrite a compelling recruitment message. Mention their specific war numbers. ${factionless ? "They are now factionless — emphasize this is a perfect time." : "Be respectful that they are still in a faction."} Sign off from Owen777 [3776908].`;

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
        
        let activeKey = userKey;
        let [myData, enemyDataResult] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })),
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
        marketConfig
    });
});

app.post('/api/master-config', (req, res) => {
    const { apiKey, discordWebhook, companyWebhook, ocWebhook, myName, globalToggles } = req.body;
    
    // Save to discord config
    if (discordWebhook !== undefined) discordConfig.globalChannelId = discordWebhook;
    if (apiKey !== undefined) discordConfig.apiKey = apiKey;
    if (myName !== undefined) discordConfig.myName = myName; // Generic storage
    
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
    
    // Also save API key to company config for redundancy if needed
    if (apiKey !== undefined) { companyConfig.apiKey = apiKey; saveCompanyConfig(); }
    
    res.json({ success: true });
});

app.post('/api/sync-configs', (req, res) => {
    // Restores configs from the client's browser (acting as a persistent database)
    const { company, discord, oc, market } = req.body;
    if (company) { companyConfig = { ...companyConfig, ...company }; saveCompanyConfig(); }
    if (discord) { discordConfig = { ...discordConfig, ...discord }; saveDiscordConfig(); }
    if (oc) { ocConfig = { ...ocConfig, ...oc }; saveOcConfig(); }
    if (market) { marketConfig = { ...marketConfig, ...market }; saveMarketConfig(); }
    res.json({ success: true });
});

app.get('/api/company-config', (req, res) => {
    res.json({ success: true, globalChannelId: companyConfig.globalChannelId, threshold: companyConfig.threshold });
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
    const { apiKey } = req.query;
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
async function getDiscordClient(token) {
    if (!token) return null;
    if (activeDiscordBots[token] && activeDiscordBots[token].isReady()) return activeDiscordBots[token];
    if (activeDiscordBots[token]) return null; 
    
    try {
        const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });
        activeDiscordBots[token] = client; 
        await client.login(token);
        console.log(`[Discord Bot] Logged in successfully for token ending in ...${token.slice(-4)}`);
        return client;
    } catch (e) {
        console.error(`[Discord Bot] Failed to login:`, e.message);
        delete activeDiscordBots[token];
        return null;
    }
}

if (discordConfig.globalBotToken) {
    getDiscordClient(discordConfig.globalBotToken);
}




// ---------------------------------------------

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
