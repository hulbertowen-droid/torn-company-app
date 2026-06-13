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

let claims = {};
let statsCache = {};
let manualStats = {}; 
let statQueue = [];
let isProcessingQueue = false;

function calculateEstimatedStats(pstats) {
    if (!pstats) return 0;
    const energyUsed = pstats.energyused || 0;
    const xanax = pstats.xantaken || 0;
    const refills = pstats.refills || 0;
    const cans = pstats.energydrinkused || 0;
    const ageDays = Math.max(pstats.age || 1, 1);
    const consumableEnergy = (xanax * 250) + (refills * 150) + (cans * 30);
    const passiveEnergy = ageDays * 120;
    let activityScore = energyUsed + consumableEnergy + passiveEnergy;
    let stats = Math.pow(activityScore, 1.18) * 3.2;
    stats *= Math.log10(ageDays + 10);
    stats *= (1 + Math.min(xanax / 2000, 0.25));
    stats = Math.max(5000, Math.min(stats, 5e9));
    return Math.floor(stats);
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
    if (est) {
        if (est < 1e7) score += 120;
        else if (est < 5e7) score += 80;
        else if (est < 2e8) score += 40;
        else score += 10;
    }
    return Math.floor(score * (0.9 + Math.random() * 0.2));
}

setInterval(async () => {
    if (!statQueue.length || isProcessingQueue || !TORN_API_KEY) return;
    isProcessingQueue = true;
    const id = statQueue.shift();
    try {
        const res = await fetch(`https://api.torn.com/user/${id}?selections=personalstats&key=${TORN_API_KEY}`);
        const data = await res.json();
        if (data?.personalstats) {
            statsCache[id] = { 
                stats: calculateEstimatedStats(data.personalstats), 
                hits: data.personalstats.attackswon || 0, 
                time: Date.now(), 
                retries: 0 
            };
        } else if (data?.error && (data.error.code === 2 || data.error.code === 5)) {
            const prev = statsCache[id]?.retries || 0;
            if (prev < 3) {
                statQueue.push(id);
                statsCache[id] = { ...statsCache[id], retries: prev + 1 };
            }
        }
    } catch (err) { console.error("Queue error:", err.message); }
    isProcessingQueue = false;
}, 1500);

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

app.post('/api/update-stats', (req, res) => {
    const { enemyId, stats } = req.body;
    if (!enemyId || !stats) return res.status(400).json({ error: "Missing data" });
    manualStats[enemyId] = { stats: parseInt(stats), time: Date.now() };
    res.json({ success: true });
});

app.get('/api/warboard', async (req, res) => {
    try {
        const [myData, enemyDataResult, attacksData] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic&key=${TORN_API_KEY}`).then(r => r.json()),
            FACTION_ID ? fetch(`https://api.torn.com/faction/${FACTION_ID}?selections=basic&key=${TORN_API_KEY}`).then(r => r.json()) : { members: {} },
            fetch(`https://api.torn.com/faction/?selections=attacks&key=${TORN_API_KEY}`).then(r => r.json())
        ]);

        const now = Math.floor(Date.now() / 1000);
        [...Object.keys(myData.members || {}), ...Object.keys(enemyDataResult.members || {})].forEach(id => {
            if (!statsCache[id] || now - (statsCache[id].time / 1000) > 1200) {
                if (!statQueue.includes(id)) statQueue.push(id);
            }
        });

        let hitsCount = {};
        if (attacksData.attacks) {
            Object.values(attacksData.attacks).forEach(att => {
                if(att.attacker_id && att.timestamp > (now - 86400)) {
                    hitsCount[att.attacker_id] = (hitsCount[att.attacker_id] || 0) + 1;
                }
            });
        }

        const parseMembers = (data, isEnemy = false) => {
            if (!data.members) return [];
            return Object.entries(data.members).map(([id, m]) => {
                const est = manualStats[id]?.stats || statsCache[id]?.stats || null;
                const intelScore = isEnemy ? computeWarIntel({ id, state: m.status?.state, until: m.status?.until, onlineStatus: m.last_action?.status || "Offline", estStats: est }, statsCache) : null;
                return { 
                    id, 
                    name: m.name, 
                    state: m.status?.state, 
                    until: m.status?.until, 
                    onlineStatus: m.last_action?.status || "Offline", 
                    claimedBy: isEnemy ? claims[id]?.playerName || null : null, 
                    estStats: est, 
                    hits: statsCache[id]?.hits || hitsCount[id] || 0, 
                    intelScore, 
                    isManual: !!manualStats[id] 
                };
            });
        };
        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true) });
    } catch (err) { console.error(err); res.status(500).json({ error: "warboard failed" }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
