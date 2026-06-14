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

// New cache for flight data
let flightCache = {};

function computeWarIntel(p, cache = {}) {
    let score = 0;
    if (p.state === "Okay") score += 120;
    if (p.state === "Hospital") score += 60;
    if (p.onlineStatus === "Online") score += 35;
    const est = manualStats[p.id]?.stats || cache[p.id]?.stats || p.estStats;
    if (est && typeof est === 'number') {
        if (est < 5e7) score += 80;
        else score += 40;
    }
    return Math.floor(score * (0.9 + Math.random() * 0.2));
}

// FF SCOUTER FLIGHT POLLING - FIXED ENDPOINT
setInterval(async () => {
    if (!statQueue.length || isProcessingQueue) return;
    isProcessingQueue = true;

    // We can only process one flight request at a time per API requirements
    const targetId = statQueue.shift();
    if (!targetId) { isProcessingQueue = false; return; }

    if (!FF_SCOUTER_KEY) {
        flightCache[targetId] = { landingTime: null, time: Date.now() };
        isProcessingQueue = false; return;
    }

    try {
        const res = await fetch(`https://ffscouter.com/api/v1/player-flights?key=${FF_SCOUTER_KEY}&target=${targetId}`);
        const data = await res.json();
        
        // Log to terminal for debugging
        console.log(`FF Scouter Flight Data for ${targetId}:`, JSON.stringify(data.current));

        if (data.current && data.current.latest_arrival_time) {
            flightCache[targetId] = { 
                landingTime: data.current.latest_arrival_time, 
                time: Date.now() 
            };
        } else {
            flightCache[targetId] = { landingTime: null, time: Date.now() };
        }
    } catch (err) { 
        console.error("FF Scouter Flight Error:", err);
    }
    
    isProcessingQueue = false;
}, 1500); // 1.5 seconds per request to respect rate limits

app.get('/api/warboard', async (req, res) => {
    try {
        const userKey = req.query.apiKey || TORN_API_KEY;
        let enemyId = req.query.enemyFaction || null;

        if (!userKey) return res.status(400).json({ error: "No API Key" });

        // Fetch basic faction data
        const myData = await fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`).then(r => r.json());
        
        // Auto-detect enemy if needed
        if (!enemyId && myData.ranked_wars) {
            const warId = Object.keys(myData.ranked_wars)[0];
            if (warId) enemyId = Object.keys(myData.ranked_wars[warId].factions).find(id => id !== myData.ID.toString());
        }

        const enemyDataResult = enemyId ? await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()) : { members: {} };

        // Queue IDs for flight tracking if they are currently traveling
        const allMembers = { ...myData.members, ...enemyDataResult.members };
        Object.entries(allMembers).forEach(([id, m]) => {
            if (m.status?.state === "Traveling" && !flightCache[id]) {
                if (!statQueue.includes(id)) statQueue.push(id);
            }
        });

        const parseMembers = (data, isEnemy = false) => {
            if (!data.members) return [];
            return Object.entries(data.members).map(([id, m]) => ({
                id,
                name: m.name,
                state: m.status?.state,
                until: m.status?.until || (m.status?.state === "Traveling" ? flightCache[id]?.landingTime : null),
                statusDescription: m.status?.description || "",
                onlineStatus: m.last_action?.status || "Offline",
                lastActionRelative: m.last_action?.relative || "Unknown",
                landingTime: flightCache[id]?.landingTime || null,
                claimedBy: isEnemy ? claims[id]?.playerName || null : null,
                needsBackup: isEnemy ? backups[id]?.playerName || null : null,
                estStats: 0, 
                intelScore: 0
            }));
        };

        res.json({ friendly: parseMembers(myData), enemy: parseMembers(enemyDataResult, true) });
    } catch (err) { res.status(500).json({ error: "failed" }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
