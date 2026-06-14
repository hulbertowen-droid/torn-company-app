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

// =====================
// NEW: FLIGHT CACHE
// =====================
let flightCache = {};

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
    return null;
}

// =====================
// FF SCOUTER POLLING
// =====================
setInterval(async () => {
    if (!statQueue.length || isProcessingQueue) return;
    isProcessingQueue = true;

    statQueue = [...new Set(statQueue)];
    const batch = statQueue.splice(0, 40);

    if (!FF_SCOUTER_KEY) {
        batch.forEach(id => {
            statsCache[id] = { stats: null, landingTime: null, time: Date.now() };
        });
        isProcessingQueue = false;
        return;
    }

    const targets = batch.join(',');

    try {
        const res = await fetch(`https://ffscouter.com/api/v1/get-stats?key=${FF_SCOUTER_KEY}&targets=${targets}`);
        const data = await res.json();

        console.log("================================");
        console.log(`Checking ${batch.length} targets with FF Scouter...`);
        console.log("FF SCOUTER RAW RESPONSE:", JSON.stringify(data).substring(0, 400)); 
        console.log("================================");

        // =====================
        // STATS PARSE (UNCHANGED)
        // =====================
        if (Array.isArray(data)) {
            data.forEach(p => {
                const id = p.player_id.toString();
                const landing = p.estimated_landing || p.landing_eta || p.landing_time || p.travel_time || null;

                statsCache[id] = {
                    stats: p.bs_estimate,
                    landingTime: landing,
                    time: Date.now()
                };
            });
        }

        // =====================
        // NEW: FLIGHT DATA FETCH
        // =====================
        await Promise.all(
            batch.map(id =>
                fetch(`https://ffscouter.com/api/v1/player-flights?key=${FF_SCOUTER_KEY}&target=${id}`)
                    .then(r => r.json())
                    .then(f => {
                        if (!f || !f.player_id) return;

                        const current = f.current || null;

                        flightCache[id] = {
                            landingTime:
                                current?.latest_arrival_time ||
                                current?.earliest_arrival_time ||
                                null,
                            travelMethod: current?.travel_method || null,
                            status: current?.status_description || null,
                            time: Date.now()
                        };
                    })
                    .catch(() => null)
            )
        );

    } catch (err) { 
        console.error("FF Scouter API Error:", err);
        statQueue.push(...batch); 
    }
    
    isProcessingQueue = false;
}, 4000);

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

// --- WARBOARD ---
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

                const cachedStats = statsCache[id]?.stats;
                const manual = manualStats[id]?.stats;

                const landingTime =
                    statsCache[id]?.landingTime ||
                    flightCache[id]?.landingTime ||
                    null;

                const est = manual ?? cachedStats ?? "loading";

                const intelScore = isEnemy
                    ? computeWarIntel({
                        id,
                        state: m.status?.state,
                        until: m.status?.until,
                        onlineStatus: m.last_action?.status || "Offline",
                        estStats: est
                    }, statsCache)
                    : null;

                return {
                    id,
                    name: m.name,
                    state: m.status?.state,
                    until: m.status?.until,
                    statusDescription: m.status?.description || "",
                    onlineStatus: m.last_action?.status || "Offline",
                    lastActionRelative: m.last_action?.relative || "Unknown",
                    landingTime,
                    claimedBy: isEnemy ? claims[id]?.playerName || null : null,
                    needsBackup: isEnemy ? backups[id]?.playerName || null : null,
                    estStats: est,
                    intelScore,
                    isManual: !!manualStats[id]
                };
            });
        };

        res.json({
            friendly: parseMembers(myData, false),
            enemy: parseMembers(enemyDataResult, true),
            detectedEnemyId: enemyId
        });

    } catch (err) {
        res.status(500).json({ error: "warboard failed" });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
