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
let vipConfig = { factions: [], players: [] }; 

try { if (fs.existsSync('subscriptions.json')) subscriptions = JSON.parse(fs.readFileSync('subscriptions.json')); } catch (e) {}
try { if (fs.existsSync('discord_config.json')) discordConfig = { ...discordConfig, ...JSON.parse(fs.readFileSync('discord_config.json')) }; } catch(e) {}
try { if (fs.existsSync('market_config.json')) marketConfig = { ...marketConfig, ...JSON.parse(fs.readFileSync('market_config.json')) }; } catch(e) {}
try { if (fs.existsSync('vip_config.json')) vipConfig = { ...vipConfig, ...JSON.parse(fs.readFileSync('vip_config.json')) }; } catch(e) {}
try { if (fs.existsSync('spy_db.json')) spyDatabase = JSON.parse(fs.readFileSync('spy_db.json')); } catch(e) {}
try { if (fs.existsSync('user_tracking.json')) userTracking = JSON.parse(fs.readFileSync('user_tracking.json')); } catch(e) {}
try { if (fs.existsSync('api_pool.json')) apiPoolConfig = JSON.parse(fs.readFileSync('api_pool.json')); } catch(e) {}

function saveSubs() { fs.writeFileSync('subscriptions.json', JSON.stringify(subscriptions)); }
function saveDiscordConfig() { fs.writeFileSync('discord_config.json', JSON.stringify(discordConfig)); }
function saveMarketConfig() { fs.writeFileSync('market_config.json', JSON.stringify(marketConfig)); }
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

app.get('/health', (req, res) => res.status(200).send
