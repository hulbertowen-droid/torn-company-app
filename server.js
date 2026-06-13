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

// Auto-detect the enemy faction ID from the user's basic faction data
function autoDetectEnemyFaction(data) {
    if (!data || !data.ID) return null;
    const myId = data.ID.toString();

    // 1. Check Ranked Wars (Highest Priority)
    if (data.ranked_wars && Object.keys(data.ranked_wars).length > 0) {
        for (let warId in data.ranked_wars) {
            const factions = Object.keys(data.ranked_wars[warId].factions || {});
            const enemy = factions.find(id => id !== myId);
            if (enemy) return enemy;
        }
    }
    // 2. Check Standard Chains/Wars
    if (data.wars && Object.keys(data.wars).length > 0) {
        return Object.keys(data.wars)[0];
    }
    // 3. Check Raid Wars
    if (data.raid_wars && Object.keys(data.raid_wars).length > 0) {
        for (let warId in data.raid_wars) {
            const factions = Object.keys(data.raid_wars[warId].factions || {});
            const enemy = factions.find(id => id !== myId);
            if (enemy) return enemy;
        }
    }
    // 4. Check Territory Wars
    if (data.territory_wars && Object.keys(data.territory_wars).length > 0) {
        for (let warId in data.territory_wars) {
            const tw = data.territory_wars[warId];
            if (tw.assaulting_faction && tw.assaulting_faction.toString() !== myId) return tw.assaulting_faction.toString();
            if (tw.defending_faction && tw.defending_faction.toString() !== myId) return tw.defending_faction.toString();
        }
    }
    return null;
}

setInterval(async () => {
    if (!statQueue.length || isProcessingQueue) return;
    isProcessingQueue = true;

    statQueue = [...new Set(statQueue)]; // Deduplicate the queue
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

        // Step 1: Fetch the friendly faction data
        const myData = await fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`)
            .then(r => r.json()).catch(() => ({ members: {} }));

        if (myData.error) return res.status(400).json({ error: "Invalid API Key" });

        // Step 2: Auto-Detect Enemy Faction (If not manually overridden)
        if (!enemyId) {
            enemyId = autoDetectEnemyFaction(myData);
        }

        // Step 3: Fetch the enemy faction data
        let enemyDataResult = { members: {} };
        if (enemyId) {
            enemyDataResult = await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`)
                .then(r => r.json()).catch(() => ({ members: {} }));
        }

        const friendlyIds = new Set(Object.keys(myData.members || {}));
        const enemyIds = new Set(Object.keys(enemyDataResult.members || {}));

        [...friendlyIds, ...enemyIds].forEach(id => {
            if (!statsCache[id] || (Date.now() - statsCache[id].time) > 3600000) {
                if (!statQueue.includes(id)) statQueue.push(id);
            }
        });

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
                    id, 
                    name: m.name, 
                    state: m.status?.state, 
                    until: m.status?.until, 
                    statusDescription: m.status?.description || "", 
                    onlineStatus: m.last_action?.status || "Offline", 
                    claimedBy: isEnemy ? claims[id]?.playerName || null : null, 
                    needsBackup: isEnemy ? backups[id]?.playerName || null : null,
                    estStats: est, 
                    intelScore, 
                    isManual: !!manualStats[id] 
                };
            });
        };
        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true), detectedEnemyId: enemyId });
    } catch (err) { 
        res.status(500).json({ error: "warboard failed" }); 
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
