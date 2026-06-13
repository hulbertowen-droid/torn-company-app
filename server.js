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

/* ---------------- STAT CACHE SYSTEM (UNCHANGED) ---------------- */

setInterval(async () => {
    if (!statQueue.length || isProcessingQueue) return;
    isProcessingQueue = true;

    statQueue = [...new Set(statQueue)]; 
    const batch = statQueue.splice(0, 40);

    if (!FF_SCOUTER_KEY) {
        batch.forEach(id => { statsCache[id] = { stats: null, time: Date.now() }; });
        isProcessingQueue = false; return;
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
            batch.forEach(id => { statsCache[id] = { stats: null, time: Date.now() }; });
        }
    } catch (err) {
        statQueue.push(...batch);
    }

    isProcessingQueue = false;
}, 4000);

/* ---------------- BASIC ROUTES (UNCHANGED) ---------------- */

app.get('/health', (req, res) => res.status(200).send("OK"));

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

/* ---------------- FF SCOUTER LEVEL WAR ENGINE ---------------- */

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
        if (!myFacId) return res.status(400).json({ error: "Not in faction." });

        const myFactionWarData = reportData.rankedwarreport?.factions?.[myFacId];
        if (!myFactionWarData) return res.status(400).json({ error: "No war data." });

        /* ---------------- REWARDS (UNCHANGED) ---------------- */

        let totalCacheValue = 0;
        let cachesWon = [];

        if (myFactionWarData.rewards?.items) {
            for (let [itemId, itemInfo] of Object.entries(myFactionWarData.rewards.items)) {
                const itemMarketData = itemsData.items?.[itemId];
                const marketValue = itemMarketData?.market_value || 0;
                const quantity = itemInfo.quantity || 0;

                const total = marketValue * quantity;
                totalCacheValue += total;

                cachesWon.push({
                    name: itemInfo.name || itemMarketData?.name || "Unknown",
                    quantity,
                    marketValue,
                    totalValue: total
                });
            }
        }

        /* ---------------- FF SCOUTER LEVEL ENGINE ---------------- */

        let detailedHits = {};
        const members = myFactionWarData.members || {};

        // seed
        for (const [id, m] of Object.entries(members)) {
            if (m.attacks > 0 || m.score > 0) {
                detailedHits[id] = {
                    assists: 0,
                    retails: 0,
                    full: 0,
                    attacks: m.attacks || 0,
                    score: m.score || 0
                };
            }
        }

        try {
            const attacksRes = await fetch(`https://api.torn.com/faction/?selections=attacks&key=${apiKey}`);
            const attacksData = await attacksRes.json();

            if (attacksData.attacks) {

                const warStart = reportData.rankedwarreport.war.start;
                const warEnd = reportData.rankedwarreport.war.end || Math.floor(Date.now() / 1000);

                let attacks = Object.values(attacksData.attacks)
                    .filter(a => a.timestamp_ended >= warStart && a.timestamp_ended <= warEnd)
                    .sort((a, b) => a.timestamp_ended - b.timestamp_ended);

                let lastByTarget = {};
                let recent = {};

                for (const a of attacks) {
                    const attackerId = a.attacker_id?.toString();
                    if (!attackerId || !detailedHits[attackerId]) continue;

                    const ts = a.timestamp_ended;
                    const result = (a.result || "").toLowerCase();
                    const target = a.defender_id?.toString();

                    if (!recent[attackerId]) recent[attackerId] = [];
                    recent[attackerId].push(ts);
                    recent[attackerId] = recent[attackerId].filter(t => ts - t < 600);

                    // FULL
                    if (
                        result.includes("hospital") ||
                        result.includes("mug") ||
                        result.includes("leave") ||
                        result.includes("killed")
                    ) {
                        detailedHits[attackerId].full++;
                    }

                    // ASSIST (behavioral)
                    if (
                        result.includes("stalemate") ||
                        result.includes("escape") ||
                        recent[attackerId].length >= 3
                    ) {
                        detailedHits[attackerId].assists++;
                    }

                    // RETALIATION (chain logic)
                    if (target && lastByTarget[target]) {
                        const last = lastByTarget[target];
                        if (last.attacker === target && ts - last.ts < 300) {
                            detailedHits[attackerId].retails++;
                        }
                    }

                    if (target) {
                        lastByTarget[target] = {
                            attacker: attackerId,
                            ts
                        };
                    }
                }
            }
        } catch (e) {
            console.log("Attack parsing failed");
        }

        /* ---------------- RESPONSE BUILD ---------------- */

        let formattedMembers = [];

        for (const [id, m] of Object.entries(members)) {
            if (m.attacks > 0 || m.score > 0) {
                const d = detailedHits[id] || { assists: 0, retails: 0, full: m.attacks };

                formattedMembers.push({
                    id,
                    name: m.name,
                    attacks: m.attacks,
                    score: m.score,
                    assists: d.assists,
                    retails: d.retails,
                    standard: d.full,
                    logsFound: true
                });
            }
        }

        formattedMembers.sort((a, b) => b.score - a.score);

        res.json({
            success: true,
            members: formattedMembers,
            rewards: {
                totalCacheValue,
                caches: cachesWon,
                points: myFactionWarData.rewards?.points || 0,
                respect: myFactionWarData.rewards?.respect || 0
            }
        });

    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

/* ---------------- WARBOARD (UNCHANGED) ---------------- */

app.get('/api/warboard', async (req, res) => {
    try {
        const userKey = req.query.apiKey || TORN_API_KEY;

        let myData = await fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`).then(r => r.json());
        if (myData.error) return res.status(400).json({ error: "Invalid API Key" });

        res.json({
            friendly: [],
            enemy: [],
            detectedEnemyId: null,
            graphData: [],
            isRankedWar: false
        });

    } catch {
        res.status(500).json({ error: "warboard failed" });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
