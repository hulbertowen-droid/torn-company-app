const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;
const FF_SCOUTER_KEY = process.env.FF_SCOUTER_KEY || "";

let claims = {};
let backups = {}; 
let statsCache = {}; 
let manualStats = {}; 
let flightCache = {}; // New cache dedicated just to flight landing times

let statQueue = [];
let flightQueue = [];
let isProcessingStats = false;
let isProcessingFlights = false;

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

    if (data.ranked_wars && Object.keys(data.ranked_wars).length > 0) {
        for (let warId in data.ranked_wars) {
            const factions = Object.keys(data.ranked_wars[warId].factions || {});
            const enemy = factions.find(id => id !== myId);
            if (enemy) return enemy;
        }
    }
    if (data.wars && Object.keys(data.wars).length > 0) return Object.keys(data.wars)[0];
    if (data.raid_wars && Object.keys(data.raid_wars).length > 0) {
        for (let warId in data.raid_wars) {
            const factions = Object.keys(data.raid_wars[warId].factions || {});
            const enemy = factions.find(id => id !== myId);
            if (enemy) return enemy;
        }
    }
    if (data.territory_wars && Object.keys(data.territory_wars).length > 0) {
        for (let warId in data.territory_wars) {
            const tw = data.territory_wars[warId];
            if (tw.assaulting_faction && tw.assaulting_faction.toString() !== myId) return tw.assaulting_faction.toString();
            if (tw.defending_faction && tw.defending_faction.toString() !== myId) return tw.defending_faction.toString();
        }
    }
    return null;
}

// ENGINE 1: BATTLE STATS (Checks 40 players at a time)
setInterval(async () => {
    if (!statQueue.length || isProcessingStats) return;
    isProcessingStats = true;

    statQueue = [...new Set(statQueue)]; 
    const batch = statQueue.splice(0, 40);

    if (!FF_SCOUTER_KEY) {
        batch.forEach(id => { statsCache[id] = { stats: null, time: Date.now() }; });
        isProcessingStats = false; return;
    }

    const targets = batch.join(',');

    try {
        const res = await fetch(`https://ffscouter.com/api/v1/get-stats?key=${FF_SCOUTER_KEY}&targets=${targets}`);
        const data = await res.json();

        if (Array.isArray(data)) {
            data.forEach(p => {
                const id = p.player_id.toString();
                statsCache[id] = { stats: p.bs_estimate, time: Date.now() };
            });
        }
    } catch (err) { 
        statQueue.push(...batch); 
    }
    
    isProcessingStats = false;
}, 4000);

// ENGINE 2: FLIGHT TRACKING (Checks 1 traveling player at a time)
setInterval(async () => {
    if (!flightQueue.length || isProcessingFlights) return;
    isProcessingFlights = true;

    flightQueue = [...new Set(flightQueue)]; 
    const targetId = flightQueue.shift();

    if (!FF_SCOUTER_KEY) {
        flightCache[targetId] = { landingTime: null, time: Date.now() };
        isProcessingFlights = false; return;
    }

    try {
        const res = await fetch(`https://ffscouter.com/api/v1/player-flights?key=${FF_SCOUTER_KEY}&target=${targetId}`);
        const data = await res.json();
        
        console.log(`FF Scouter Flight ETA for [${targetId}]:`, data.current ? data.current.latest_arrival_time : "No flight found");

        if (data.current && data.current.latest_arrival_time) {
            flightCache[targetId] = { landingTime: data.current.latest_arrival_time, time: Date.now() };
        } else {
            flightCache[targetId] = { landingTime: null, time: Date.now() };
        }
    } catch (err) { 
        console.error("FF Scouter Flight Error:", err);
        flightQueue.push(targetId); 
    }
    
    isProcessingFlights = false;
}, 1000); // Polls 1 person per second to easily stay under the 100/min limit

app.get('/health', (req, res) => res.status(200).send("OK"));

// --- LIVE WARBOARD ACTIONS ---
app.post('/api/claim', (req, res) => {
    const { enemyId, playerName } = req.body;
    if (!enemyId || !playerName) return res.status(400).json({ error: "Missing data" });
    claims[enemyId] = { playerName, time: Date.now() };
    res.json({ success: true });
});

app.post('/api/unclaim', (req, res) => {
    const { enemyId, playerName } = req.body;
    if (claims[enemyId]?.playerName === playerName) delete claims[enemyId];
    res.json({ success: true });
});

app.post('/api/backup', (req, res) => {
    const { enemyId, playerName } = req.body;
    if (!enemyId || !playerName) return res.status(400).json({ error: "Missing data" });
    backups[enemyId] = { playerName, time: Date.now() };
    res.json({ success: true });
});

app.post('/api/unbackup', (req, res) => {
    const { enemyId } = req.body;
    delete backups[enemyId]; 
    res.json({ success: true });
});

app.post('/api/update-stats', (req, res) => {
    const { enemyId, stats } = req.body;
    if (!enemyId || !stats) return res.status(400).json({ error: "Missing data" });
    manualStats[enemyId] = { stats: parseInt(stats), time: Date.now() };
    res.json({ success: true });
});

// --- FULL PAYOUT CALCULATOR LOGIC ---
app.get('/api/past-war', async (req, res) => {
    const { apiKey, reportId } = req.query;
    if (!apiKey || !reportId) return res.status(400).json({ error: "Missing API Key or Report ID" });

    try {
        const [userRes, reportRes, itemsRes] = await Promise.all([
            fetch(`https://api.torn.com/user/?selections=profile&key=${apiKey}`),
            fetch(`https://api.torn.com/torn/${reportId}?selections=rankedwarreport&key=${apiKey}`),
            fetch(`https://api.torn.com/torn/?selections=items&key=${apiKey}`)
        ]);

        const userData = await userRes.json();
        const reportData = await reportRes.json();
        const itemsData = await itemsRes.json();

        if (userData.error) return res.status(400).json({ error: "Invalid API Key." });
        const myFacId = userData.faction?.faction_id?.toString();
        if (!myFacId || myFacId === "0") return res.status(400).json({ error: "You are not currently in a faction." });

        if (reportData.error) return res.status(400).json({ error: "Torn API Error: " + reportData.error.error });
        if (!reportData.rankedwarreport || !reportData.rankedwarreport.factions) return res.status(400).json({ error: "Invalid Report ID or no data found." });

        const myFactionWarData = reportData.rankedwarreport.factions[myFacId];
        if (!myFactionWarData) return res.status(400).json({ error: "Your faction was not part of this Ranked War Report." });

        let totalCacheValue = 0;
        let cachesWon = [];

        if (myFactionWarData.rewards && myFactionWarData.rewards.items) {
            for (let [itemId, itemInfo] of Object.entries(myFactionWarData.rewards.items)) {
                const itemMarketData = itemsData.items ? itemsData.items[itemId] : null;
                const marketValue = itemMarketData ? itemMarketData.market_value : 0;
                const quantity = itemInfo.quantity || 0;
                
                const lineTotal = marketValue * quantity;
                totalCacheValue += lineTotal;
                
                cachesWon.push({
                    name: itemInfo.name || (itemMarketData ? itemMarketData.name : "Unknown Item"),
                    quantity: quantity,
                    marketValue: marketValue,
                    totalValue: lineTotal
                });
            }
        }

        const members = myFactionWarData.members || {};
        let formattedMembers = [];
        
        for (let [id, m] of Object.entries(members)) {
            if (m.attacks > 0 || m.score > 0) {
                formattedMembers.push({
                    id,
                    name: m.name,
                    attacks: m.attacks || 0,
                    assists: m.assists || 0,
                    retaliations: m.retaliations || 0,
                    score: m.score || 0
                });
            }
        }

        formattedMembers.sort((a, b) => b.score - a.score);

        res.json({ 
            success: true, 
            members: formattedMembers,
            rewards: {
                totalCacheValue: totalCacheValue,
                caches: cachesWon,
                points: myFactionWarData.rewards?.points || 0,
                respect: myFactionWarData.rewards?.respect || 0
            }
        });
    } catch (err) {
        res.status(500).json({ error: "Server error fetching past war data." });
    }
});

// --- FULL LIVE WARBOARD LOGIC ---
app.get('/api/warboard', async (req, res) => {
    try {
        const userKey = req.query.apiKey && req.query.apiKey !== "null" ? req.query.apiKey : TORN_API_KEY;
        let enemyId = req.query.enemyFaction && req.query.enemyFaction !== "null" && req.query.enemyFaction !== "" ? req.query.enemyFaction : null;

        if (!userKey) return res.status(400).json({ error: "No API Key provided" });

        let [myData, enemyDataResult] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })),
            enemyId ? fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })) : Promise.resolve({ members: {} })
        ]);

        if (myData.error) return res.status(400).json({ error: "Invalid API Key" });

        if (!enemyId) enemyId = autoDetectEnemyFaction(myData);
        
        if (enemyId && Object.keys(enemyDataResult.members || {}).length === 0) {
             enemyDataResult = await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} }));
        }

        const friendlyIds = new Set(Object.keys(myData.members || {}));
        const enemyIds = new Set(Object.keys(enemyDataResult.members || {}));

        // Queue processing
        [...friendlyIds, ...enemyIds].forEach(id => {
            // Queue for Battle Stats (Refreshes once an hour)
            if (!statsCache[id] || (Date.now() - statsCache[id].time) > 3600000) {
                if (!statQueue.includes(id)) statQueue.push(id);
            }

            // Check if player is flying
            const m = myData.members[id] || enemyDataResult.members[id];
            const isTraveling = m.status?.state === "Traveling" || (m.status?.description && m.status?.description.includes("Traveling"));
            
            // Queue for Flight Info (Refreshes every 30 seconds ONLY if they are flying)
            if (isTraveling) {
                if (!flightCache[id] || (Date.now() - flightCache[id].time) > 30000) {
                    if (!flightQueue.includes(id)) flightQueue.push(id);
                }
            }
        });

        let hitsStats = {};
        friendlyIds.forEach(id => hitsStats[id] = { made: 0, score: 0, name: myData.members[id].name });
        let isRankedWar = false;

        if (myData.ranked_wars && Object.keys(myData.ranked_wars).length > 0) {
            const warId = Object.keys(myData.ranked_wars)[0];
            const rw = myData.ranked_wars[warId];
            const myFacId = myData.ID.toString();

            if (rw.factions && rw.factions[myFacId] && rw.factions[myFacId].members) {
                isRankedWar = true;
                const membersData = rw.factions[myFacId].members;
                for (const [memberId, stats] of Object.entries(membersData)) {
                    if (hitsStats[memberId]) {
                        hitsStats[memberId].made = stats.attacks || 0;
                        hitsStats[memberId].score = stats.score || 0;
                    }
                }
            }
        }

        let graphData = isRankedWar ? Object.values(hitsStats).filter(p => p.made > 0 || p.score > 0) : [];
        graphData.sort((a, b) => b.score - a.score);

        const parseMembers = (data, isEnemy = false) => {
            if (!data.members) return [];
            return Object.entries(data.members).map(([id, m]) => {
                const hasCache = statsCache[id] !== undefined;
                const cachedStats = statsCache[id]?.stats; 
                const est = manualStats[id]?.stats !== undefined ? manualStats[id].stats : (hasCache ? cachedStats : "loading");
                
                const isTraveling = m.status?.state === "Traveling" || (m.status?.description && m.status?.description.includes("Traveling"));
                
                // If they are flying, use FF Scouter's flightCache timestamp
                let finalUntil = m.status?.until;
                let finalLandingTime = null;

                if (isTraveling) {
                    finalLandingTime = flightCache[id]?.landingTime || null;
                    finalUntil = finalLandingTime; 
                }

                const intelScore = isEnemy ? computeWarIntel({ id, state: m.status?.state, until: finalUntil, onlineStatus: m.last_action?.status || "Offline", estStats: est }, statsCache) : null;
                
                if (isEnemy && backups[id] && m.status?.state === "Hospital") {
                    const timeLeft = m.status.until - Math.floor(Date.now() / 1000);
                    if (timeLeft > 1800) delete backups[id];
                }
                
                return { 
                    id, 
                    name: m.name, 
                    state: m.status?.state, 
                    until: finalUntil, 
                    statusDescription: m.status?.description || "", 
                    onlineStatus: m.last_action?.status || "Offline", 
                    lastActionRelative: m.last_action?.relative || "Unknown", 
                    landingTime: finalLandingTime, 
                    claimedBy: isEnemy ? claims[id]?.playerName || null : null, 
                    needsBackup: isEnemy ? backups[id]?.playerName || null : null, 
                    estStats: est, 
                    intelScore, 
                    isManual: !!manualStats[id] 
                };
            });
        };

        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true), detectedEnemyId: enemyId, graphData, isRankedWar });
    } catch (err) { 
        res.status(500).json({ error: "warboard failed" }); 
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
