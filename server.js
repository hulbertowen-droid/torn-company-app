const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;
const FACTION_ID = process.env.FACTION_ID || "";
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

setInterval(async () => {
    if (!statQueue.length || isProcessingQueue) return;
    isProcessingQueue = true;

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

// Claim API
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

// Backup (SOS) API
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
        const [myData, enemyDataResult] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic&key=${TORN_API_KEY}`)
                .then(r => r.json()).catch(() => ({ members: {} })),
            FACTION_ID 
                ? fetch(`https://api.torn.com/faction/${FACTION_ID}?selections=basic&key=${TORN_API_KEY}`)
                    .then(r => r.json()).catch(() => ({ members: {} })) 
                : Promise.resolve({ members: {} })
        ]);

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
                
                const est = manualStats[id]?.stats !== undefined 
                    ? manualStats[id].stats 
                    : (hasCache ? cachedStats : "loading");

                const intelScore = isEnemy ? computeWarIntel({ id, state: m.status?.state, until: m.status?.until, onlineStatus: m.last_action?.status || "Offline", estStats: est }, statsCache) : null;
                
                // Clear SOS automatically if they go to the hospital
                if (isEnemy && m.status?.state === "Hospital" && backups[id]) {
                    delete backups[id];
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
        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true) });
    } catch (err) { 
        res.status(500).json({ error: "warboard failed" }); 
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
