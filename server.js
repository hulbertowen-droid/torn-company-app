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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

let claims = {};
let backups = {}; 
let statsCache = {}; 
let manualStats = {}; 
let flightCache = {}; 

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

// --- DROPDOWN LIST FOR PAST WARS ---
app.get('/api/war-list', async (req, res) => {
    const userKey = req.query.apiKey;
    if (!userKey) return res.status(400).json({ error: "Missing API Key" });

    try {
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
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch war list" });
    }
});

// --- DASHBOARD: ACTIVITY & ARMORY LOANS DEEP-SCAN ---
app.get('/api/dashboard-data', async (req, res) => {
    const userKey = req.query.apiKey;
    if (!userKey) return res.status(400).json({ error: "Missing API Key" });

    try {
        const basicResp = await fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`);
        const basicData = await basicResp.json();
        if (basicData.error) return res.status(400).json({ error: basicData.error.error });

        let loans = [];
        let armoryError = false;
        const armoryResp = await fetch(`https://api.torn.com/faction/?selections=armor,weapons,temporary&key=${userKey}`);
        const armoryData = await armoryResp.json();

        if (armoryData.error) {
            armoryError = true; 
        } else {
            // Recursive deep scan to find loaned_to regardless of Torn's random formatting
            const findLoans = (obj, typeName) => {
                if (!obj || typeof obj !== 'object') return;
                
                if (obj.loaned_to) {
                    let loanStr = String(obj.loaned_to).trim();
                    if (loanStr !== "0" && loanStr !== "null" && loanStr !== "") {
                        loanStr.split(',').forEach(l => {
                            loans.push({ name: obj.name || "Unknown Item", loaned_to: l.trim(), type: typeName });
                        });
                    }
                    return; 
                }
                Object.values(obj).forEach(val => findLoans(val, typeName));
            };

            findLoans(armoryData.armor, "Armor");
            findLoans(armoryData.weapons, "Weapon");
            findLoans(armoryData.temporary, "Temporary");
        }

        res.json({ success: true, members: basicData.members || {}, loans: loans, armoryError });
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
        const [facRes, userRes] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`).then(r => r.json()),
            fetch(`https://api.torn.com/user/?selections=profile&key=${userKey}`).then(r => r.json())
        ]);

        if (facRes.error) throw new Error("Torn API Error: " + facRes.error.error);
        if (userRes.error) throw new Error("Torn API Error: " + userRes.error.error);

        const myFacId = facRes.ID?.toString();
        const myUserId = userRes.player_id?.toString();
        
        let lastWarId = null;
        if (facRes.rankedwars) {
            const completedWars = Object.entries(facRes.rankedwars)
                .filter(([id, w]) => w.war && w.war.winner !== 0)
                .sort((a, b) => b[1].war.end - a[1].war.end);
            if (completedWars.length > 0) lastWarId = completedWars[0][0];
        }

        if (!lastWarId) throw new Error("No completed Ranked Wars found for your faction.");

        const reportRes = await fetch(`https://api.torn.com/torn/${lastWarId}?selections=rankedwarreport&key=${userKey}`);
        const reportData = await reportRes.json();
        
        let warStats = null;
        if (reportData.rankedwarreport && reportData.rankedwarreport.factions) {
            for (let [fId, fData] of Object.entries(reportData.rankedwarreport.factions)) {
                if (fData.members && fData.members[myUserId]) {
                    warStats = fData.members;
                    break;
                }
            }
            if (!warStats) warStats = reportData.rankedwarreport.factions[myFacId]?.members;
        }

        if (!warStats) throw new Error("Could not extract your faction's member data from the last war report.");

        let memberArray = Object.values(warStats).map(m => `Name: ${m.name}, Attacks: ${m.attacks}, Assists: ${m.assists}, Clears: ${m.clears}, Score: ${m.score}`);
        memberArray.sort((a, b) => b.score - a.score);
        const slimData = memberArray.slice(0, 20).join("\n");

        const prompt = `You are a strict, tactical military advisor for a gaming faction. Review the performance of the top 20 members in our latest war:\n\n${slimData}\n\nProvide 3 specific, actionable pieces of advice to improve our next war. Call out top performers, identify weak links, and be blunt but helpful. Do not use markdown headers, just bolding.`;

        // FIXED: Upgraded model to gemini-3.5-flash to replace the deprecated 1.5-flash model
        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const aiData = await aiRes.json();
        if (aiData.error) throw new Error("Gemini API Error: " + aiData.error.message);

        const analysis = aiData.candidates[0].content.parts[0].text;
        res.json({ success: true, analysis });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
        if (reportData.error) return res.status(400).json({ error: "Torn API Error: " + reportData.error.error });
        if (!reportData.rankedwarreport || !reportData.rankedwarreport.factions) return res.status(400).json({ error: "Invalid Report ID or no data found." });

        const myUserId = userData.player_id.toString();
        let correctFacId = null;
        for (let [facId, facData] of Object.entries(reportData.rankedwarreport.factions)) {
            if (facData.members && facData.members[myUserId]) { correctFacId = facId; break; }
        }
        if (!correctFacId) correctFacId = userData.faction?.faction_id?.toString();

        const myFactionWarData = reportData.rankedwarreport.factions[correctFacId];
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
                
                cachesWon.push({ name: itemInfo.name || (itemMarketData ? itemMarketData.name : "Unknown Item"), quantity: quantity, marketValue: marketValue, totalValue: lineTotal });
            }
        }

        const members = myFactionWarData.members || {};
        let formattedMembers = [];
        
        for (let [id, m] of Object.entries(members)) {
            if (m.attacks > 0 || m.score > 0) {
                formattedMembers.push({ id, name: m.name, attacks: m.attacks || 0, score: m.score || 0 });
            }
        }

        formattedMembers.sort((a, b) => b.score - a.score);

        res.json({ 
            success: true, members: formattedMembers,
            rewards: { totalCacheValue: totalCacheValue, caches: cachesWon, points: myFactionWarData.rewards?.points || 0, respect: myFactionWarData.rewards?.respect || 0 }
        });
    } catch (err) {
        res.status(500).json({ error: "Server error fetching past war data." });
    }
});

app.post('/api/claim', (req, res) => { const { enemyId, playerName } = req.body; claims[enemyId] = { playerName, time: Date.now() }; res.json({ success: true }); });
app.post('/api/unclaim', (req, res) => { const { enemyId, playerName } = req.body; if (claims[enemyId]?.playerName === playerName) delete claims[enemyId]; res.json({ success: true }); });
app.post('/api/backup', (req, res) => { const { enemyId, playerName } = req.body; backups[enemyId] = { playerName, time: Date.now() }; res.json({ success: true }); });
app.post('/api/unbackup', (req, res) => { const { enemyId } = req.body; delete backups[enemyId]; res.json({ success: true }); });
app.post('/api/update-stats', (req, res) => { const { enemyId, stats } = req.body; manualStats[enemyId] = { stats: parseInt(stats), time: Date.now() }; res.json({ success: true }); });

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
            if (!statsCache[id] || (Date.now() - statsCache[id].time) > 3600000) { if (!statQueue.includes(id)) statQueue.push(id); }
            const m = myData.members[id] || enemyDataResult.members[id];
            const isTraveling = m.status?.state === "Traveling" || (m.status?.description && m.status?.description.includes("Traveling"));
            if (isTraveling) {
                if (!flightCache[id] || (Date.now() - flightCache[id].time) > 30000) { if (!flightQueue.includes(id)) flightQueue.push(id); }
            }
        });

        const parseMembers = (data, isEnemy = false) => {
            if (!data.members) return [];
            return Object.entries(data.members).map(([id, m]) => {
                const est = manualStats[id]?.stats !== undefined ? manualStats[id].stats : (statsCache[id]?.stats !== undefined ? statsCache[id].stats : "loading");
                const isTraveling = m.status?.state === "Traveling" || (m.status?.description && m.status?.description.includes("Traveling"));
                
                let finalUntil = m.status?.until;
                let finalLandingTime = null;
                if (isTraveling) { finalLandingTime = flightCache[id]?.landingTime || null; finalUntil = finalLandingTime; }

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
