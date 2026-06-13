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
let statQueue = [];
let isProcessingQueue = false;

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
    if (data.wars && Object.keys(data.wars).length > 0) {
        return Object.keys(data.wars)[0];
    }
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

// NEW: Recursive Time-Travel Fetcher for Attacks
async function getRecentAttacks(apiKey, hours = 24) {
    let allAttacks = {};
    let toTimestamp = Math.floor(Date.now() / 1000);
    const limitTimestamp = toTimestamp - (hours * 3600);
    let pages = 0;
    let hasMore = true;
    let errorObj = null;

    // Max 15 pages (1,500 attacks) to protect API limits and prevent timeouts
    while (hasMore && pages < 15) { 
        pages++;
        try {
            const res = await fetch(`https://api.torn.com/faction/?selections=attacks&to=${toTimestamp}&key=${apiKey}`);
            const data = await res.json();
            
            if (data.error) {
                errorObj = data.error;
                break;
            }
            
            if (!data.attacks || Object.keys(data.attacks).length === 0) {
                break;
            }

            let oldestInBatch = toTimestamp;
            let foundAnyInRange = false;
            
            for (const [id, att] of Object.entries(data.attacks)) {
                if (att.timestamp >= limitTimestamp) {
                    allAttacks[id] = att;
                    foundAnyInRange = true;
                    if (att.timestamp < oldestInBatch) oldestInBatch = att.timestamp;
                }
            }
            
            // If we found valid attacks, set the 'to' timestamp just behind the oldest one to grab the next page
            if (foundAnyInRange && oldestInBatch < toTimestamp) {
                toTimestamp = oldestInBatch - 1; 
            } else {
                hasMore = false; // We hit attacks older than 24h
            }
        } catch (err) {
            break;
        }
    }
    return { attacks: allAttacks, error: errorObj };
}

setInterval(async () => {
    if (!statQueue.length || isProcessingQueue) return;
    isProcessingQueue = true;

    statQueue = [...new Set(statQueue)]; 
    const batch = statQueue.splice(0, 40);

    if (!FF_SCOUTER_KEY) {
        batch.forEach(id => { statsCache[id] = { stats: null, time: Date.now() }; });
        isProcessingQueue = false;
        return;
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
        } else {
            console.error("❌ FF Scouter API Error:", data);
            batch.forEach(id => { statsCache[id] = { stats: null, time: Date.now() }; });
        }
    } catch (err) { 
        statQueue.push(...batch); 
    }
    
    isProcessingQueue = false;
}, 4000);

app.get('/health', (req, res) => res.status(200).send("OK"));

app.post('/api/claim', (req, res) => {
    const { enemyId, playerName } = req.body;
    if (!enemyId || !playerName) return res.status(400).json({ error: "Missing data" });
    if (claims[enemyId] && claims[enemyId].playerName !== playerName) return res.status(400).json({ error: "Already claimed" });
    claims[enemyId] = { playerName, time: Date.now() };
    res.json({ success: true });
});

app.post('/api/unclaim', (req, res) => {
    const { enemyId, playerName } = req.body;
    if (claims[enemyId]?.playerName === playerName) {
        delete claims[enemyId];
        return res.json({ success: true });
    }
    res.status(400).json({ error: "Cannot unclaim" });
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

app.get('/api/warboard', async (req, res) => {
    try {
        const userKey = req.query.apiKey && req.query.apiKey !== "null" ? req.query.apiKey : TORN_API_KEY;
        let enemyId = req.query.enemyFaction && req.query.enemyFaction !== "null" && req.query.enemyFaction !== "" ? req.query.enemyFaction : null;

        if (!userKey) return res.status(400).json({ error: "No API Key provided" });

        // Run the basic fetch and the new recursive attack fetch at the same time
        let [myData, enemyDataResult, attacksData] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })),
            enemyId ? fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })) : Promise.resolve({ members: {} }),
            getRecentAttacks(userKey, 24) // <--- Plugs in here
        ]);

        if (myData.error) return res.status(400).json({ error: "Invalid API Key" });

        if (!enemyId) enemyId = autoDetectEnemyFaction(myData);
        
        if (enemyId && Object.keys(enemyDataResult.members || {}).length === 0) {
             enemyDataResult = await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} }));
        }

        const friendlyIds = new Set(Object.keys(myData.members || {}));
        const enemyIds = new Set(Object.keys(enemyDataResult.members || {}));

        [...friendlyIds, ...enemyIds].forEach(id => {
            if (!statsCache[id] || (Date.now() - statsCache[id].time) > 3600000) {
                if (!statQueue.includes(id)) statQueue.push(id);
            }
        });

        let hitsStats = {};
        friendlyIds.forEach(id => hitsStats[id] = { made: 0, received: 0, name: myData.members[id].name });

        const now = Math.floor(Date.now() / 1000);
        if (attacksData.attacks) {
            Object.values(attacksData.attacks).forEach(att => {
                if (att.timestamp > (now - 86400)) { 
                    const attacker = att.attacker_id ? att.attacker_id.toString() : null;
                    const defender = att.defender_id ? att.defender_id.toString() : null;

                    if (attacker && hitsStats[attacker]) hitsStats[attacker].made++;
                    if (defender && hitsStats[defender]) hitsStats[defender].received++;
                }
            });
        }

        let graphData = Object.values(hitsStats).filter(p => p.made > 0 || p.received > 0);
        graphData.sort((a, b) => b.made - a.made); 
        
        let attacksError = attacksData.error ? attacksData.error.error : null;

        const parseMembers = (data, isEnemy = false) => {
            if (!data.members) return [];
            return Object.entries(data.members).map(([id, m]) => {
                const hasCache = statsCache[id] !== undefined;
                const cachedStats = statsCache[id]?.stats; 
                const est = manualStats[id]?.stats !== undefined ? manualStats[id].stats : (hasCache ? cachedStats : "loading");
                const intelScore = isEnemy ? computeWarIntel({ id, state: m.status?.state, until: m.status?.until, onlineStatus: m.last_action?.status || "Offline", estStats: est }, statsCache) : null;
                
                if (isEnemy && backups[id] && m.status?.state === "Hospital") {
                    const timeLeft = m.status.until - Math.floor(Date.now() / 1000);
                    if (timeLeft > 1800) delete backups[id];
                }
                
                return { 
                    id, name: m.name, state: m.status?.state, until: m.status?.until, statusDescription: m.status?.description || "", 
                    onlineStatus: m.last_action?.status || "Offline", claimedBy: isEnemy ? claims[id]?.playerName || null : null, 
                    needsBackup: isEnemy ? backups[id]?.playerName || null : null, estStats: est, intelScore, isManual: !!manualStats[id] 
                };
            });
        };

        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true), detectedEnemyId: enemyId, graphData, attacksError });
    } catch (err) { 
        res.status(500).json({ error: "warboard failed" }); 
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
