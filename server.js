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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""; // NEW: AI Key

let claims = {};
let backups = {}; 
let statsCache = {}; 
let manualStats = {}; 
let flightCache = {}; 

let statQueue = [];
let flightQueue = [];
let isProcessingStats = false;
let isProcessingFlights = false;

// --- WAR INTEL & HELPERS ---
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
    return null;
}

// --- FF SCOUTER ENGINES ---
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
    } catch (err) { statQueue.push(...batch); }
    isProcessingStats = false;
}, 4000);

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
        if (data.current && data.current.latest_arrival_time) {
            flightCache[targetId] = { landingTime: data.current.latest_arrival_time, time: Date.now() };
        } else {
            flightCache[targetId] = { landingTime: null, time: Date.now() };
        }
    } catch (err) { flightQueue.push(targetId); }
    isProcessingFlights = false;
}, 1000); 

app.get('/health', (req, res) => res.status(200).send("OK"));

// --- DASHBOARD: ACTIVITY & ARMORY LOANS ---
app.get('/api/dashboard-data', async (req, res) => {
    const userKey = req.query.apiKey;
    if (!userKey) return res.status(400).json({ error: "Missing API Key" });

    try {
        // Fetch basic (for members) + armory selections
        const resp = await fetch(`https://api.torn.com/faction/?selections=basic,armor,weapons,temporary&key=${userKey}`);
        const data = await resp.json();

        if (data.error) return res.status(400).json({ error: data.error.error });

        let loans = [];
        
        // Helper to extract loans
        const extractLoans = (categoryData, typeName) => {
            if (!categoryData) return;
            Object.values(categoryData).forEach(items => {
                // The API groups by item ID, returning an array or object of specific items
                const itemList = Array.isArray(items) ? items : Object.values(items);
                itemList.forEach(item => {
                    if (item.loaned_to) {
                        loans.push({ name: item.name, loaned_to: item.loaned_to, type: typeName });
                    }
                });
            });
        };

        extractLoans(data.armor, "Armor");
        extractLoans(data.weapons, "Weapon");
        extractLoans(data.temporary, "Temporary");

        res.json({ success: true, members: data.members || {}, loans: loans });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch dashboard data." });
    }
});

// --- DASHBOARD: AI WAR ANALYST ---
app.post('/api/ai-analyze', async (req, res) => {
    const userKey = req.query.apiKey;
    if (!GEMINI_API_KEY) return res.status(400).json({ error: "Server missing GEMINI_API_KEY in environment variables." });
    if (!userKey) return res.status(400).json({ error: "Missing Torn API Key" });

    try {
        // 1. Get the latest Ranked War ID
        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`);
        const facData = await facRes.json();
        const myFacId = facData.ID?.toString();
        
        let lastWarId = null;
        if (facData.rankedwars) {
            // Get the most recent war by sorting the keys (IDs)
            const warIds = Object.keys(facData.rankedwars).sort((a, b) => b - a);
            lastWarId = warIds[0];
        }

        if (!lastWarId) return res.status(400).json({ error: "No past Ranked Wars found for your faction." });

        // 2. Fetch the actual War Report
        const reportRes = await fetch(`https://api.torn.com/torn/${lastWarId}?selections=rankedwarreport&key=${userKey}`);
        const reportData = await reportRes.json();
        
        const warStats = reportData.rankedwarreport?.factions[myFacId]?.members;
        if (!warStats) return res.status(400).json({ error: "Could not extract member data from the last war report." });

        // 3. Format data to feed the AI (Top 20 members to save tokens)
        let memberArray = Object.values(warStats).map(m => `Name: ${m.name}, Attacks: ${m.attacks}, Assists: ${m.assists}, Clears: ${m.clears}, Score: ${m.score}`);
        memberArray.sort((a, b) => b.score - a.score);
        const slimData = memberArray.slice(0, 20).join("\n");

        // 4. Call Gemini API
        const prompt = `You are a strict, tactical military advisor for a gaming faction. Review the performance of the top 20 members in our latest war:\n\n${slimData}\n\nProvide 3 specific, actionable pieces of advice to improve our next war. Call out top performers, identify weak links (e.g. high attacks but low score means hitting weak targets; low attacks means inactivity), and be blunt but helpful. Do not use markdown headers, just bolding.`;

        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const aiData = await aiRes.json();
        const analysis = aiData.candidates[0].content.parts[0].text;

        res.json({ success: true, analysis });
    } catch (err) {
        console.error("AI Error:", err);
        res.status(500).json({ error: "Failed to generate AI report." });
    }
});

// --- WARBOARD API ROUTES (Claim/Unclaim/Etc) ---
app.post('/api/claim', (req, res) => { const { enemyId, playerName } = req.body; claims[enemyId] = { playerName, time: Date.now() }; res.json({ success: true }); });
app.post('/api/unclaim', (req, res) => { const { enemyId, playerName } = req.body; if (claims[enemyId]?.playerName === playerName) delete claims[enemyId]; res.json({ success: true }); });
app.post('/api/backup', (req, res) => { const { enemyId, playerName } = req.body; backups[enemyId] = { playerName, time: Date.now() }; res.json({ success: true }); });
app.post('/api/unbackup', (req, res) => { const { enemyId } = req.body; delete backups[enemyId]; res.json({ success: true }); });
app.post('/api/update-stats', (req, res) => { const { enemyId, stats } = req.body; manualStats[enemyId] = { stats: parseInt(stats), time: Date.now() }; res.json({ success: true }); });

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

        [...friendlyIds, ...enemyIds].forEach(id => {
            if (!statsCache[id] || (Date.now() - statsCache[id].time) > 3600000) {
                if (!statQueue.includes(id)) statQueue.push(id);
            }
            const m = myData.members[id] || enemyDataResult.members[id];
            const isTraveling = m.status?.state === "Traveling" || (m.status?.description && m.status?.description.includes("Traveling"));
            if (isTraveling) {
                if (!flightCache[id] || (Date.now() - flightCache[id].time) > 30000) {
                    if (!flightQueue.includes(id)) flightQueue.push(id);
                }
            }
        });

        const parseMembers = (data, isEnemy = false) => {
            if (!data.members) return [];
            return Object.entries(data.members).map(([id, m]) => {
                const est = manualStats[id]?.stats !== undefined ? manualStats[id].stats : (statsCache[id]?.stats !== undefined ? statsCache[id].stats : "loading");
                const isTraveling = m.status?.state === "Traveling" || (m.status?.description && m.status?.description.includes("Traveling"));
                
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
                    id, name: m.name, state: m.status?.state, until: finalUntil, statusDescription: m.status?.description || "", 
                    onlineStatus: m.last_action?.status || "Offline", lastActionRelative: m.last_action?.relative || "Unknown", 
                    landingTime: finalLandingTime, claimedBy: isEnemy ? claims[id]?.playerName || null : null, 
                    needsBackup: isEnemy ? backups[id]?.playerName || null : null, estStats: est, intelScore, isManual: !!manualStats[id] 
                };
            });
        };

        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true), detectedEnemyId: enemyId });
    } catch (err) { res.status(500).json({ error: "warboard failed" }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
