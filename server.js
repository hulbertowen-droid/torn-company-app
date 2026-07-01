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

let bonusHits = {}; 
const BONUS_THRESHOLDS = new Set([10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]);

let subscriptions = {};
let adminFactionId = null;
let lastEventTimestamp = Math.floor(Date.now() / 1000);

let lastChainTimeoutAlertState = false;
let backgroundEnemyTrackingState = {};

let discordConfig = { webhookUrl: "", targetOnline: true, targetLanded: true, targetOutHosp: true, chainUnder90: true, chainMilestone: true, friendlyAttacked: true, apiKey: "", factionId: "" };
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
if (discordConfig.apiKey) apiKeyPool.add(discordConfig.apiKey);

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
                                    body: JSON.stringify({ content: `💰 **PAYMENT RECEIVED:** Faction \`${facId}\` sent ${qty}x Xanax for ${weeks} weeks of access!` })
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
    
    const res = await fetch(`https://api.torn.com/user/?selections=profile&key=${userKey}`);
    const data = await res.json();
    if (data.error) throw new Error("Invalid API Key.");

    const playerId = data.player_id?.toString();
    const facId = data.faction?.faction_id?.toString();

    if (ADMIN_API_KEY && userKey === ADMIN_API_KEY) return playerId;
    if (playerId && (VIP_PLAYERS.includes(playerId) || vipConfig.players.includes(playerId))) return playerId;
    
    if (!facId || facId === "0") throw new Error("You must be in a faction to use these tools.");

    if (adminFactionId && facId === adminFactionId) return playerId;
    if (VIP_FACTIONS.includes(facId) || vipConfig.factions.includes(facId)) return playerId;
    if (subscriptions[facId] && subscriptions[facId] > Date.now()) return playerId;

    throw new Error(`SUBSCRIPTION REQUIRED: Your faction's access has expired. Send 5x Xanax to Owen777 [3776908] to instantly unlock access for your entire faction for 1 week!`);
}

async function verifyFfScouterPremium(ffKey, testId) {
    if (!ffKey || ffKey === "null" || ffKey === "") return false;
    try {
        const res = await fetch(`https://ffscouter.com/api/v1/get-stats?key=${ffKey}&targets=${testId}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return true; 
        return false;
    } catch (e) {
        return false;
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

// ENGINE 4: LIVE DELTA SCRAPER (Wall Watcher & Chain Milestones)
setInterval(async () => {
    let watchFactionId = adminFactionId || discordConfig.factionId;
    if (apiKeyPool.size === 0 || !watchFactionId) return;
    
    const keys = Array.from(apiKeyPool);
    
    try {
        let liveKey = keys[Math.floor(Math.random() * keys.length)];
        const liveRes = await fetch(`https://api.torn.com/faction/?selections=attacks&key=${liveKey}`);
        const liveData = await liveRes.json();
        
        if (liveData.attacks) {
            for (let [atkId, atk] of Object.entries(liveData.attacks)) {
                if (processedAttackIds.has(atkId)) continue;
                processedAttackIds.add(atkId);
                
                // FRIENDLY IS ATTACKED (WALL WATCHER)
                if (atk.defender_faction && atk.defender_faction.toString() === watchFactionId) {
                    let uId = atk.defender_id.toString();
                    let attFacId = atk.attacker_faction ? atk.attacker_faction.toString() : "0";
                    if (!liveDefends[uId]) liveDefends[uId] = {};
                    liveDefends[uId][attFacId] = (liveDefends[uId][attFacId] || 0) + 1;
                    
                    if (discordConfig.friendlyAttacked && discordConfig.webhookUrl) {
                        let attackerName = atk.attacker_name || "Unknown";
                        let attackerId = atk.attacker_id;
                        let attackerFactionName = atk.attacker_faction_name || "None";
                        let defenderName = atk.defender_name || uId;

                        let discordMsg = `🛡️ **WALL WATCHER:** \`${defenderName}\` is getting hit by **${attackerName}**!\n🏢 **Enemy Faction:** \`${attackerFactionName}\`\n⚔️ **Retaliate:** https://www.torn.com/loader.php?sid=attack&user2ID=${attackerId}`;

                        fetch(discordConfig.webhookUrl, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content: discordMsg })
                        }).catch(() => {});
                    }
                }

                // FRIENDLY ATTACKS SOMEONE ELSE
                if (atk.attacker_faction && atk.attacker_faction.toString() === watchFactionId) {
                    let uId = atk.attacker_id.toString();
                    let defFacId = atk.defender_faction ? atk.defender_faction.toString() : "0";
                    if (!liveAttacks[uId]) liveAttacks[uId] = {};
                    liveAttacks[uId][defFacId] = (liveAttacks[uId][defFacId] || 0) + 1;

                    if (atk.chain && BONUS_THRESHOLDS.has(atk.chain)) {
                        if (discordConfig.chainMilestone && discordConfig.webhookUrl) {
                            fetch(discordConfig.webhookUrl, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ content: `🏆 **CHAIN MILESTONE:** Hit #**${atk.chain}** made by \`${atk.attacker_name || uId}\` (+${atk.respect_gain || 0} respect)!` })
                            }).catch(() => {});
                        }
                    }
                }
            }
        }
    } catch (err) {}
}, 20000); 

setInterval(async () => {
    if (!marketConfig.webhookUrl || apiKeyPool.size === 0) return;
    const keys = Array.from(apiKeyPool);
    const key = keys[Math.floor(Math.random() * keys.length)];

    try {
        if (marketConfig.autoDefense && ADMIN_API_KEY) {
            const userRes = await fetch(`https://api.torn.com/user/?selections=bazaar,profile&key=${ADMIN_API_KEY}`);
            const userData = await userRes.json();
            
            if (userData.bazaar && userData.bazaar.length > 0) {
                let myPrices = {};
                userData.bazaar.forEach(item => {
                    if (!myPrices[item.ID] || item.price < myPrices[item.ID].price) {
                        myPrices[item.ID] = { price: item.price, name: item.name };
                    }
                });

                for (let [itemId, myItem] of Object.entries(myPrices)) {
                    const mktRes = await fetch(`https://api.torn.com/market/${itemId}?selections=bazaar,itemmarket&key=${key}`);
                    const mktData = await mktRes.json();

                    if (mktData.bazaar || mktData.itemmarket) {
                        let lowestMarketPrice = Infinity;
                        const checkListings = (listings) => {
                            if (!listings) return;
                            Object.values(listings).forEach(listing => {
                                if (listing.cost < myItem.price && listing.cost < lowestMarketPrice) lowestMarketPrice = listing.cost;
                            });
                        };
                        checkListings(mktData.bazaar);
                        checkListings(mktData.itemmarket);

                        if (lowestMarketPrice < myItem.price) {
                            if (marketMemory.defense[itemId] !== lowestMarketPrice) {
                                marketMemory.defense[itemId] = lowestMarketPrice;
                                fetch(marketConfig.webhookUrl, {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ content: `📉 **MARKET ALERT:** Your \`${myItem.name}\` ($${myItem.price.toLocaleString()}) got undercut! New lowest: **$${lowestMarketPrice.toLocaleString()}**\n[Check Market](https://www.torn.com/imarket.php#/p=shop&step=shop&type=&searchname=${myItem.name})` })
                                }).catch(()=>{});
                            }
                        } else { delete marketMemory.defense[itemId]; }
                    }
                    await new Promise(r => setTimeout(r, 500)); 
                }
            }
        }
    } catch (err) {}
}, 45000); 

// ENGINE 6: BACKGROUND WAR SURVEILLANCE
setInterval(async () => {
    let watchKey = ADMIN_API_KEY || discordConfig.apiKey;
    let watchFactionId = adminFactionId || discordConfig.factionId;
    
    if (!watchKey || !watchFactionId) return;

    try {
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,chain,rankedwars&key=${watchKey}`);
        const facData = await facRes.json();
        if (facData.error) return;

        if (facData.chain && facData.chain.current >= 10) {
            let secondsLeft = facData.chain.timeout;
            if (secondsLeft <= 90 && secondsLeft > 0 && !lastChainTimeoutAlertState && discordConfig.chainUnder90 && discordConfig.webhookUrl) {
                fetch(discordConfig.webhookUrl, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: `⚠️ **CHAIN DROPPING!** Under 90s (${secondsLeft}s left)! Someone make a hit right now!` })
                }).catch(() => {});
                lastChainTimeoutAlertState = true;
            } else if (secondsLeft > 120) { lastChainTimeoutAlertState = false; }
        } else { lastChainTimeoutAlertState = false; }

        let activeEnemyId = autoDetectEnemyFaction(facData);
        if (activeEnemyId && discordConfig.webhookUrl) {
            const enemyRes = await fetch(`https://api.torn.com/faction/${activeEnemyId}?selections=basic&key=${watchKey}`);
            const enemyData = await enemyRes.json();
            
            if (enemyData.members) {
                Object.entries(enemyData.members).forEach(([id, m]) => {
                    let oldRecord = backgroundEnemyTrackingState[id];
                    let newRecord = { state: m.status?.state, online: m.last_action?.status, description: m.status?.description };
                    
                    if (oldRecord) {
                        if (oldRecord.online !== "Online" && newRecord.online === "Online" && discordConfig.targetOnline) {
                            fetch(discordConfig.webhookUrl, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ content: `🟢 **TARGET ONLINE:** ${m.name} [${id}] just came online!` })
                            }).catch(() => {});
                        }
                        if (oldRecord.state !== "Okay" && newRecord.state === "Okay") {
                            let oldDesc = oldRecord.description || "";
                            if ((oldRecord.state === "Traveling" || oldDesc.includes("Traveling") || oldDesc.includes("Abroad")) && discordConfig.targetLanded) {
                                fetch(discordConfig.webhookUrl, {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ content: `✈️ **TARGET LANDED:** ${m.name} [${id}] just landed in Torn!` })
                                }).catch(() => {});
                            } else if (oldRecord.state === "Hospital" && discordConfig.targetOutHosp) {
                                fetch(discordConfig.webhookUrl, {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ content: `🏥 **TARGET OUT OF HOSP:** ${m.name} [${id}] just left the hospital and is Okay!` })
                                }).catch(() => {});
                            }
                        }
                    }
                    backgroundEnemyTrackingState[id] = newRecord;
                });
            }
        }
    } catch (err) {}
}, 30000);

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

app.get('/api/get-discord-config', (req, res) => { res.json(discordConfig); });

app.post('/api/save-discord-config', async (req, res) => { 
    discordConfig = { ...discordConfig, ...req.body }; 
    
    if (discordConfig.apiKey) {
        try {
            const profileRes = await fetch(`https://api.torn.com/user/?selections=profile&key=${discordConfig.apiKey}`);
            const profileData = await profileRes.json();
            if (profileData.faction && profileData.faction.faction_id) {
                discordConfig.factionId = profileData.faction.faction_id.toString();
                apiKeyPool.add(discordConfig.apiKey);
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
        await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: message }) });
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

app.post('/api/generate-recruit-msg', async (req, res) => {
    const { playerName, score, attacks, status } = req.body;
    if (!GEMINI_API_KEY) return res.status(400).json({ error: "Server missing GEMINI_API_KEY." });
    try {
        const prompt = `You are a recruiter for a tactical gaming faction in Torn City. Write a direct, professional DM to a player named ${playerName}. Context: They recently fought against us in a Ranked War, making ${attacks} attacks and scoring ${score} points. Status: ${status}. Max 3 sentences. No brackets.`;
        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const aiData = await aiRes.json();
        res.json({ success: true, message: aiData.candidates[0].content.parts[0].text.trim() });
    } catch (err) { res.status(500).json({ error: "Failed to generate AI message." }); }
});

app.post('/api/ai-analyze', async (req, res) => {
    const userKey = req.query.apiKey;
    if (!GEMINI_API_KEY) return res.status(400).json({ error: "Missing AI Key." });
    try {
        await verifySubscription(userKey);
        const [facRes, userRes] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`).then(r => r.json()),
            fetch(`https://api.torn.com/user/?selections=profile&key=${userKey}`).then(r => r.json())
        ]);
        let lastWarId = null;
        if (facRes.rankedwars) {
            const completedWars = Object.entries(facRes.rankedwars).filter(([id, w]) => w.war && w.war.winner !== 0).sort((a, b) => b[1].war.end - a[1].war.end);
            if (completedWars.length > 0) lastWarId = completedWars[0][0];
        }
        if (!lastWarId) throw new Error("No wars found.");
        const reportData = await fetch(`https://api.torn.com/torn/${lastWarId}?selections=rankedwarreport&key=${userKey}`).then(r => r.json());
        let warStats = reportData.rankedwarreport?.factions[facRes.ID?.toString()]?.members || {};
        let slimData = Object.values(warStats).slice(0, 20).map(m => `Name: ${m.name}, Score: ${m.score}`).join("\n");
        
        const prompt = `Review performance:\n${slimData}\nProvide 3 blunt tactical advice. No headers, use bolding.`;
        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const aiData = await aiRes.json();
        res.json({ success: true, analysis: aiData.candidates[0].content.parts[0].text });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.post('/api/ai-analyze-ongoing', async (req, res) => {
    const userKey = req.query.apiKey;
    if (!GEMINI_API_KEY) return res.status(400).json({ error: "Missing AI Key." });
    try {
        await verifySubscription(userKey);
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`).then(r => r.json());
        let ongoingWarId = null; let warData = null;
        if (facRes.rankedwars) {
            for (let [id, w] of Object.entries(facRes.rankedwars)) { if (w.war && w.war.winner === 0) { ongoingWarId = id; warData = w; break; } }
        }
        if (!ongoingWarId) throw new Error("No active war.");
        let slimData = Object.values(warData.factions[facRes.ID?.toString()]?.members || {}).slice(0, 20).map(m => `Name: ${m.name}, Score: ${m.score}`).join("\n");
        
        const prompt = `LIVE War analysis:\n${slimData}\nProvide 3 urgent actions. Bold text only.`;
        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const aiData = await aiRes.json();
        res.json({ success: true, analysis: aiData.candidates[0].content.parts[0].text });
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
            if (facData.members && facData.members[myUserId]) {
                correctFacId = facId;
            } else {
                enemyFacId = facId;
            }
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

app.get('/api/warboard', async (req, res) => {
    try {
        const userKey = req.query.apiKey && req.query.apiKey !== "null" ? req.query.apiKey : TORN_API_KEY;
        const ffKey = req.query.ffKey && req.query.ffKey !== "null" && req.query.ffKey !== "" ? req.query.ffKey : null;
        await verifySubscription(userKey);
        if (userKey) apiKeyPool.add(userKey);

        const isPremium = (ffKey && ffKey !== "null" && ffKey.trim().length > 10);
        let enemyId = req.query.enemyFaction || null;
        
        let [myData, enemyDataResult] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })),
            enemyId ? fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })) : Promise.resolve({ members: {} })
        ]);
        if (!enemyId) enemyId = autoDetectEnemyFaction(myData);
        if (enemyId && Object.keys(enemyDataResult.members || {}).length === 0) { 
            enemyDataResult = await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })); 
        }

        const friendlyIds = new Set(Object.keys(myData.members || {}));
        const enemyIds = new Set(Object.keys(enemyDataResult.members || {}));
        
        [...friendlyIds, ...enemyIds].forEach(id => {
            if (!statsCache[id] || (Date.now() - statsCache[id].time) > 3600000) { 
                if (isPremium && !statQueue.has(id)) statQueue.set(id, ffKey); 
            }
            const m = myData.members[id] || enemyDataResult.members[id];
            const isTraveling = m.status?.state === "Traveling" || m.status?.description?.includes("Traveling");
            if (isTraveling) { if (!flightCache[id] || (Date.now() - flightCache[id].time) > 30000) { if (isPremium && !flightQueue.has(id)) flightQueue.set(id, ffKey); } }
        });

        const parseMembers = (data, isEnemy = false) => {
            if (!data.members) return [];
            return Object.entries(data.members).map(([id, m]) => {
                const est = manualStats[id]?.stats !== undefined ? manualStats[id].stats : (statsCache[id]?.stats !== undefined ? statsCache[id].stats : (isPremium ? "Scanning..." : "🔒 Requires FF Scouter"));
                const isTraveling = m.status?.state === "Traveling" || m.status?.description?.includes("Traveling");
                let finalUntil = m.status?.until; let finalLandingTime = null; let needsFfScouterForFlights = false;
                if (isTraveling) { if (flightCache[id]?.landingTime) { finalLandingTime = flightCache[id].landingTime; finalUntil = finalLandingTime; } else { if (!isPremium) needsFfScouterForFlights = true; } }
                
                let attacks = 0; let score = 0; let defends = 0;
                if (enemyId) {
                    if (liveAttacks[id]?.[enemyId]) attacks = liveAttacks[id][enemyId];
                    if (liveDefends[id]?.[enemyId]) defends = liveDefends[id][enemyId];
                }
                return { id, name: m.name, state: m.status?.state, until: finalUntil, statusDescription: m.status?.description || "", onlineStatus: m.last_action?.status || "Offline", lastActionRelative: m.last_action?.relative || "Unknown", landingTime: finalLandingTime, needsFfScouterForFlights, claimedBy: isEnemy ? claims[id]?.playerName || null : null, needsBackup: isEnemy ? backups[id]?.playerName || null : null, estStats: est, intelScore: isEnemy ? computeWarIntel({ id, state: m.status?.state, until: finalUntil, onlineStatus: m.last_action?.status || "Offline", estStats: typeof est === 'number' ? est : null }, statsCache) : null, isManual: !!manualStats[id], attacks, score, defends };
            });
        };
        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true), detectedEnemyId: enemyId, premiumActive: isPremium });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
