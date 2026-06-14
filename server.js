const express = require('express');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;
const FF_SCOUTER_KEY = process.env.FF_SCOUTER_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

let claims = {};
let backups = {}; 
let statsCache = {}; 
let manualStats = {}; 
let flightCache = {}; 
let activityCache = {}; 
let warScrapeCache = {}; 

let statQueue = [];
let flightQueue = [];
let activityQueue = [];

let isProcessingStats = false;
let isProcessingFlights = false;
let isProcessingActivity = false;

// --- API KEY POOL FOR HEAVY SCRAPING ---
let apiKeyPool = new Set();
if (ADMIN_API_KEY) apiKeyPool.add(ADMIN_API_KEY);
if (TORN_API_KEY) apiKeyPool.add(TORN_API_KEY);

let liveDefends = {}; 
let lastScrapedAttackTime = Math.floor(Date.now() / 1000) - 3600; // Start looking 1 hour back on boot

// --- SUBSCRIPTION MANAGER ---
let subscriptions = {};
let adminFactionId = null;
let lastEventTimestamp = Math.floor(Date.now() / 1000);

try {
    if (fs.existsSync('subscriptions.json')) {
        subscriptions = JSON.parse(fs.readFileSync('subscriptions.json'));
    }
} catch (e) { console.error("Could not load subscriptions file", e); }

function saveSubs() {
    fs.writeFileSync('subscriptions.json', JSON.stringify(subscriptions));
}

if (ADMIN_API_KEY) {
    fetch(`https://api.torn.com/user/?selections=profile&key=${ADMIN_API_KEY}`)
        .then(r => r.json())
        .then(d => { if (d.faction) adminFactionId = d.faction.faction_id?.toString(); })
        .catch(e => console.error("Failed to load admin profile"));
}

setInterval(async () => {
    if (!ADMIN_API_KEY) return;
    try {
        const res = await fetch(`https://api.torn.com/user/?selections=events&key=${ADMIN_API_KEY}`);
        const data = await res.json();
        if (!data.events) return;

        let events = Object.entries(data.events).map(([id, ev]) => ({ id, ...ev }));
        events.sort((a, b) => a.timestamp - b.timestamp);

        for (let ev of events) {
            if (ev.timestamp <= lastEventTimestamp) continue;
            lastEventTimestamp = ev.timestamp;

            const text = ev.event;
            if (text.toLowerCase().includes('sent you') && text.toLowerCase().includes('xanax')) {
                const qtyMatch = text.match(/(\d+)\s*[xX]\s*Xanax/i) || text.match(/Xanax\s*[xX]\s*(\d+)/i);
                let qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                const idMatch = text.match(/XID=(\d+)/);

                if (idMatch) {
                    let senderId = idMatch[1];
                    let weeks = Math.floor(qty / 5);

                    if (weeks > 0) {
                        const senderRes = await fetch(`https://api.torn.com/user/${senderId}?selections=profile&key=${ADMIN_API_KEY}`);
                        const senderData = await senderRes.json();
                        const facId = senderData.faction?.faction_id;

                        if (facId && facId !== 0) {
                            let now = Date.now();
                            if (!subscriptions[facId] || subscriptions[facId] < now) subscriptions[facId] = now;
                            
                            subscriptions[facId] += weeks * 7 * 24 * 60 * 60 * 1000;
                            saveSubs();
                            console.log(`[PAYMENT RECEIVED] Credited Faction ${facId} with ${weeks} weeks of access!`);
                        }
                    }
                }
            }
        }
    } catch (err) { console.error("Event Poller Error:", err); }
}, 60000); 

async function verifySubscription(userKey) {
    if (!userKey) throw new Error("No API Key provided.");
    if (ADMIN_API_KEY && userKey === ADMIN_API_KEY) return true; 

    const res = await fetch(`https://api.torn.com/user/?selections=profile&key=${userKey}`);
    const data = await res.json();
    if (data.error) throw new Error("Invalid API Key.");

    const facId = data.faction?.faction_id?.toString();
    if (!facId || facId === "0") throw new Error("You must be in a faction to use these tools.");

    if (adminFactionId && facId === adminFactionId) return true;
    if (subscriptions[facId] && subscriptions[facId] > Date.now()) return true;

    throw new Error(`SUBSCRIPTION REQUIRED: Your faction's access has expired or is not active. Send 5x Xanax to Owen777 [3776908] to instantly unlock access for your entire faction for 1 week!`);
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

// --- ENGINE 1: FF SCOUTER BATTLE STATS ---
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

// --- ENGINE 2: FF SCOUTER FLIGHTS ---
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

// --- ENGINE 3: FF SCOUTER TIMELINES ---
setInterval(async () => {
    if (!activityQueue.length || isProcessingActivity) return;
    isProcessingActivity = true;
    activityQueue = [...new Set(activityQueue)];
    const targetId = activityQueue.shift();

    if (!FF_SCOUTER_KEY || !targetId) { isProcessingActivity = false; return; }

    const end = Math.floor(Date.now() / 1000);
    const start = end - (12 * 3600); 

    try {
        const res = await fetch(`https://ffscouter.com/api/v1/activity/player?key=${FF_SCOUTER_KEY}&target=${targetId}&start=${start}&end=${end}&bucket=3600`);
        const data = await res.json();
        if (data.code === 0 && Array.isArray(data.buckets)) {
            const timeline = data.buckets.map(b => b.activity_score);
            activityCache[targetId] = { timeline: timeline, time: Date.now() };
        } else {
            activityCache[targetId] = { timeline: [], time: Date.now() };
        }
    } catch (err) { activityQueue.push(targetId); }
    isProcessingActivity = false;
}, 1500); 

// --- ENGINE 4: LIVE POOLED DEFEND SCRAPER ---
setInterval(async () => {
    if (apiKeyPool.size === 0 || !adminFactionId) return;

    // Grab a random key from the pool to spread the API load
    const keys = Array.from(apiKeyPool);
    const randomKey = keys[Math.floor(Math.random() * keys.length)];

    try {
        const res = await fetch(`https://api.torn.com/faction/?selections=attacks&key=${randomKey}`);
        const data = await res.json();
        
        if (data.attacks) {
            let attacks = Object.values(data.attacks);
            // Sort oldest to newest so we process in chronological order
            attacks.sort((a, b) => a.timestamp_ended - b.timestamp_ended);

            for (let atk of attacks) {
                if (atk.timestamp_ended <= lastScrapedAttackTime) continue;
                lastScrapedAttackTime = atk.timestamp_ended;

                // Check if our faction was the defender (they got hit)
                if (atk.defender_faction && atk.defender_faction.toString() === adminFactionId) {
                    let uId = atk.defender_id.toString();
                    if (!liveDefends[uId]) liveDefends[uId] = 0;
                    liveDefends[uId]++;
                }
            }
        }
    } catch (err) {
        console.error("Engine 4 Defend Scraper Error");
    }
}, 60000); // Runs every 60 seconds

app.get('/health', (req, res) => res.status(200).send("OK"));

// --- SECURED ROUTES ---
app.get('/api/war-list', async (req, res) => {
    const userKey = req.query.apiKey;
    try {
        await verifySubscription(userKey);
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
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.get('/api/dashboard-data', async (req, res) => {
    const userKey = req.query.apiKey;
    try {
        await verifySubscription(userKey);
        const basicResp = await fetch(`https://api.torn.com/faction/?selections=basic&key=${userKey}`);
        const basicData = await basicResp.json();
        if (basicData.error) return res.status(400).json({ error: basicData.error.error });

        if (basicData.members) {
            Object.keys(basicData.members).forEach(id => {
                if (!activityCache[id] || (Date.now() - activityCache[id].time) > 600000) {
                    if (!activityQueue.includes(id)) activityQueue.push(id);
                }
            });
        }

        let loans = [];
        let armoryError = false;
        const armoryResp = await fetch(`https://api.torn.com/faction/?selections=armor,weapons,temporary&key=${userKey}`);
        const armoryData = await armoryResp.json();

        if (armoryData.error) { armoryError = true; } 
        else {
            const findLoans = (obj, typeName) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.loaned_to) {
                    let loanStr = String(obj.loaned_to).trim();
                    if (loanStr !== "0" && loanStr !== "null" && loanStr !== "") {
                        loanStr.split(',').forEach(l => { loans.push({ name: obj.name || "Unknown Item", loaned_to: l.trim(), type: typeName }); });
                    }
                    return; 
                }
                Object.values(obj).forEach(val => findLoans(val, typeName));
            };
            findLoans(armoryData.armor, "Armor");
            findLoans(armoryData.weapons, "Weapon");
            findLoans(armoryData.temporary, "Temporary");
        }

        let parsedMembers = {};
        if (basicData.members) {
            Object.entries(basicData.members).forEach(([id, m]) => {
                parsedMembers[id] = { ...m, timeline: activityCache[id]?.timeline || null };
            });
        }

        res.json({ success: true, members: parsedMembers, loans: loans, armoryError });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.get('/api/scan-recruits', async (req, res) => {
    const { apiKey, reportId } = req.query;
    try {
        await verifySubscription(apiKey);
        const userRes = await fetch(`https://api.torn.com/user/?selections=profile&key=${apiKey}`);
        const userData = await userRes.json();
        if (userData.error) return res.status(400).json({ error: "Invalid API Key." });
        const myUserId = userData.player_id.toString();

        const reportRes = await fetch(`https://api.torn.com/torn/${reportId}?selections=rankedwarreport&key=${apiKey}`);
        const reportData = await reportRes.json();
        if (reportData.error) return res.status(400).json({ error: "Torn API Error: " + reportData.error.error });

        let myFacId = null;
        let enemyFacId = null;

        for (let [facId, facData] of Object.entries(reportData.rankedwarreport.factions)) {
            if (facData.members && facData.members[myUserId]) { myFacId = facId; } else { enemyFacId = facId; }
        }
        
        if (!myFacId) {
            myFacId = userData.faction?.faction_id?.toString();
            enemyFacId = Object.keys(reportData.rankedwarreport.factions).find(id => id !== myFacId);
        }

        if (!enemyFacId) return res.status(400).json({ error: "Could not identify the enemy faction." });

        const enemyWarData = reportData.rankedwarreport.factions[enemyFacId];
        const currentEnemyRes = await fetch(`https://api.torn.com/faction/${enemyFacId}?selections=basic&key=${apiKey}`);
        const currentEnemyData = await currentEnemyRes.json();
        const currentRoster = currentEnemyData.members || {};

        let potentialRecruits = [];

        for (let [id, m] of Object.entries(enemyWarData.members || {})) {
            if (m.score > 200 || m.attacks > 10) {
                if (!statQueue.includes(id) && !statsCache[id]) statQueue.push(id);

                let currentStatus = "Factionless / Left";
                let position = "None";
                let daysInFaction = 0;
                let isPoachable = true;

                if (currentRoster[id]) {
                    position = currentRoster[id].position;
                    daysInFaction = currentRoster[id].days_in_faction;
                    const role = position.toLowerCase();
                    if (role.includes('leader') || role.includes('co-leader') || role.includes('management') || role.includes('council')) {
                        isPoachable = false; 
                    } else {
                        currentStatus = `Member (${position})`;
                    }
                }

                if (isPoachable) {
                    let efficiency = m.attacks > 0 ? (m.score / m.attacks).toFixed(1) : 0;
                    let est = statsCache[id] ? statsCache[id].stats : "Scanning...";

                    potentialRecruits.push({
                        id, name: m.name, score: m.score, attacks: m.attacks, efficiency: efficiency,
                        status: currentStatus, days: daysInFaction, stillInFaction: !!currentRoster[id], estStats: est
                    });
                }
            }
        }

        potentialRecruits.sort((a, b) => b.score - a.score);
        res.json({ success: true, recruits: potentialRecruits, enemyName: enemyWarData.name });

    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.post('/api/generate-recruit-msg', async (req, res) => {
    const { playerName, score, attacks, status } = req.body;
    if (!GEMINI_API_KEY) return res.status(400).json({ error: "Server missing GEMINI_API_KEY." });

    try {
        const prompt = `You are a recruiter for a tactical gaming faction in Torn City. Write a direct, straightforward, and professional DM to a player named ${playerName}. 
        Context: They recently fought against us in a Ranked War, making ${attacks} attacks and scoring ${score} points. Their current status is: ${status}. 
        CRITICAL RULES: Do NOT flatter them excessively. Do NOT 'glaze' them or sound desperate. 
        State the facts: we saw their solid performance, we are recruiting capable hitters, and ask if they are open to joining our team. 
        Be concise, serious, and no-nonsense. Maximum 3 sentences. Do not use placeholder brackets like [Your Name].`;

        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const aiData = await aiRes.json();
        if (aiData.error) throw new Error("Gemini API Error: " + aiData.error.message);

        const message = aiData.candidates[0].content.parts[0].text;
        res.json({ success: true, message: message.trim() });
    } catch (err) { res.status(500).json({ error: "Failed to generate AI message." }); }
});

app.post('/api/ai-analyze', async (req, res) => {
    const userKey = req.query.apiKey;
    if (!GEMINI_API_KEY) return res.status(400).json({ error: "Server missing GEMINI_API_KEY in environment variables." });
    try {
        await verifySubscription(userKey);

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
            const completedWars = Object.entries(facRes.rankedwars).filter(([id, w]) => w.war && w.war.winner !== 0).sort((a, b) => b[1].war.end - a[1].war.end);
            if (completedWars.length > 0) lastWarId = completedWars[0][0];
        }
        if (!lastWarId) throw new Error("No completed Ranked Wars found for your faction.");

        const reportRes = await fetch(`https://api.torn.com/torn/${lastWarId}?selections=rankedwarreport&key=${userKey}`);
        const reportData = await reportRes.json();
        
        let warStats = null;
        if (reportData.rankedwarreport && reportData.rankedwarreport.factions) {
            for (let [fId, fData] of Object.entries(reportData.rankedwarreport.factions)) {
                if (fData.members && fData.members[myUserId]) { warStats = fData.members; break; }
            }
            if (!warStats) warStats = reportData.rankedwarreport.factions[myFacId]?.members;
        }

        if (!warStats) throw new Error("Could not extract your faction's member data from the last war report.");

        let memberArray = Object.values(warStats).map(m => `Name: ${m.name}, Attacks: ${m.attacks}, Assists: ${m.assists}, Clears: ${m.clears}, Score: ${m.score}`);
        memberArray.sort((a, b) => b.score - a.score);
        const slimData = memberArray.slice(0, 20).join("\n");

        const prompt = `You are a strict, tactical military advisor for a gaming faction. Review the performance of the top 20 members in our latest war:\n\n${slimData}\n\nProvide 3 specific, actionable pieces of advice to improve our next war. Call out top performers, identify weak links, and be blunt but helpful. Do not use markdown headers, just bolding.`;

        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const aiData = await aiRes.json();
        if (aiData.error) throw new Error("Gemini API Error: " + aiData.error.message);

        const analysis = aiData.candidates[0].content.parts[0].text;
        res.json({ success: true, analysis });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.post('/api/ai-analyze-ongoing', async (req, res) => {
    const userKey = req.query.apiKey;
    if (!GEMINI_API_KEY) return res.status(400).json({ error: "Server missing GEMINI_API_KEY in environment variables." });
    try {
        await verifySubscription(userKey);

        const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`).then(r => r.json());
        if (facRes.error) throw new Error("Torn API Error: " + facRes.error.error);

        const myFacId = facRes.ID?.toString();
        let ongoingWarId = null; let warData = null;

        if (facRes.rankedwars) {
            for (let [id, w] of Object.entries(facRes.rankedwars)) {
                if (w.war && w.war.winner === 0) { ongoingWarId = id; warData = w; break; }
            }
        }
        if (!ongoingWarId) throw new Error("You are not currently in an active Ranked War. Use the 'Analyze Last War' button instead.");

        const myFactionWarData = warData.factions[myFacId];
        if (!myFactionWarData) throw new Error("Could not extract your faction's live data from the ongoing war.");

        let enemyFacId = Object.keys(warData.factions).find(id => id !== myFacId);
        const enemyFactionWarData = enemyFacId ? warData.factions[enemyFacId] : null;
        
        let enemyName = enemyFactionWarData ? enemyFactionWarData.name : "the enemy";
        let myScore = myFactionWarData.score || 0;
        let enemyScore = enemyFactionWarData ? (enemyFactionWarData.score || 0) : 0;
        let targetScore = warData.war.target || 0;

        let memberArray = Object.values(myFactionWarData.members || {}).map(m => `Name: ${m.name}, Attacks: ${m.attacks || 0}, Score: ${m.score || 0}`);
        memberArray.sort((a, b) => (b.score || 0) - (a.score || 0));
        const slimData = memberArray.slice(0, 20).join("\n");

        const prompt = `You are a strict, tactical military advisor for a gaming faction. We are currently in a LIVE Ranked War against ${enemyName}. The current score is Us: ${myScore} vs Them: ${enemyScore} (Target to win: ${targetScore}). Review the live performance of our top 20 active members so far:\n\n${slimData}\n\nProvide 3 specific, urgent, actionable pieces of tactical advice on what we need to do RIGHT NOW to start winning or hold our lead. Identify if we lack hitters, if people are hitting low-value targets, and give an urgent battle command. Do not use markdown headers, just bolding.`;

        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const aiData = await aiRes.json();
        if (aiData.error) throw new Error("Gemini API Error: " + aiData.error.message);

        const analysis = aiData.candidates[0].content.parts[0].text;
        res.json({ success: true, analysis });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.get('/api/past-war', async (req, res) => {
    const { apiKey, reportId } = req.query;
    try {
        await verifySubscription(apiKey);

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
        
        const myUserId = userData.player_id.toString(); 
        let correctFacId = null;
        let enemyFacId = null;

        for (let [facId, facData] of Object.entries(reportData.rankedwarreport.factions)) {
            if (facData.members && facData.members[myUserId]) { correctFacId = facId; } 
            else { enemyFacId = facId; }
        }
        
        if (!correctFacId) {
            correctFacId = userData.faction?.faction_id?.toString();
            enemyFacId = Object.keys(reportData.rankedwarreport.factions).find(id => id !== correctFacId);
        }

        const myFactionWarData = reportData.rankedwarreport.factions[correctFacId];
        if (!myFactionWarData) return res.status(400).json({ error: "Your faction was not part of this Ranked War Report." });
        
        let totalCacheValue = 0; 
        let cachesWon = [];
        if (myFactionWarData.rewards && myFactionWarData.rewards.items) {
            for (let [itemId, itemInfo] of Object.entries(myFactionWarData.rewards.items)) {
                const itemMarketData = itemsData.items ? itemsData.items[itemId] : null;
                const marketValue = itemMarketData ? itemMarketData.market_value : 0;
                const quantity = itemInfo.quantity || 0;
                totalCacheValue += marketValue * quantity;
                cachesWon.push({ name: itemInfo.name || (itemMarketData ? itemMarketData.name : "Unknown Item"), quantity: quantity, marketValue: marketValue, totalValue: marketValue * quantity });
            }
        }

        let advancedStats = {};
        if (warScrapeCache[reportId]) {
            advancedStats = warScrapeCache[reportId];
        } else {
            let warStart = reportData.rankedwarreport.war.start;
            let warEnd = reportData.rankedwarreport.war.end || Math.floor(Date.now() / 1000);
            
            let toTimestamp = warEnd;
            let keepScraping = true;
            let pageCount = 0;
            
            while (keepScraping && pageCount < 30) { 
                const attackRes = await fetch(`https://api.torn.com/faction/?selections=attacks&to=${toTimestamp}&key=${apiKey}`);
                const attackData = await attackRes.json();
                
                if (attackData.error || !attackData.attacks) break;
                
                let attacks = Object.values(attackData.attacks);
                if (attacks.length === 0) break;
                
                let oldestTime = toTimestamp;
                
                for (let atk of attacks) {
                    if (atk.timestamp_ended < oldestTime) oldestTime = atk.timestamp_ended;
                    
                    if (atk.timestamp_ended < warStart) { keepScraping = false; continue; }
                    if (atk.timestamp_ended > warEnd) continue;
                    
                    if (atk.attacker_faction.toString() === correctFacId) {
                        let uId = atk.attacker_id.toString();
                        if (!advancedStats[uId]) advancedStats[uId] = { assists: 0, clears: 0 };
                        
                        if (atk.result === "Assist") advancedStats[uId].assists++;
                        if (atk.defender_faction.toString() !== enemyFacId) advancedStats[uId].clears++;
                    }
                }
                toTimestamp = oldestTime - 1;
                pageCount++;
                await new Promise(r => setTimeout(r, 250));
            }
            warScrapeCache[reportId] = advancedStats;
        }

        const members = myFactionWarData.members || {}; 
        let formattedMembers = [];
        
        for (let [id, m] of Object.entries(members)) {
            let playerAdvStats = advancedStats[id] || { assists: 0, clears: 0 };
            
            if (m.attacks > 0 || m.score > 0 || playerAdvStats.assists > 0 || playerAdvStats.clears > 0) { 
                formattedMembers.push({ 
                    id, name: m.name, attacks: m.attacks || 0, assists: playerAdvStats.assists, clears: playerAdvStats.clears, score: m.score || 0 
                }); 
            }
        }
        
        formattedMembers.sort((a, b) => b.score - a.score);
        
        res.json({ success: true, members: formattedMembers, rewards: { totalCacheValue: totalCacheValue, caches: cachesWon, points: myFactionWarData.rewards?.points || 0, respect: myFactionWarData.rewards?.respect || 0 } });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.post('/api/claim', (req, res) => { const { enemyId, playerName } = req.body; claims[enemyId] = { playerName, time: Date.now() }; res.json({ success: true }); });
app.post('/api/unclaim', (req, res) => { const { enemyId, playerName } = req.body; if (claims[enemyId]?.playerName === playerName) delete claims[enemyId]; res.json({ success: true }); });
app.post('/api/backup', (req, res) => { const { enemyId, playerName } = req.body; backups[enemyId] = { playerName, time: Date.now() }; res.json({ success: true }); });
app.post('/api/unbackup', (req, res) => { const { enemyId } = req.body; delete backups[enemyId]; res.json({ success: true }); });
app.post('/api/update-stats', (req, res) => { const { enemyId, stats } = req.body; manualStats[enemyId] = { stats: parseInt(stats), time: Date.now() }; res.json({ success: true }); });

// --- UPDATED LIVE WARBOARD ENDPOINT WITH API KEY HARVESTING ---
app.get('/api/warboard', async (req, res) => {
    try {
        const userKey = req.query.apiKey && req.query.apiKey !== "null" ? req.query.apiKey : TORN_API_KEY;
        await verifySubscription(userKey);

        // Harvest valid API keys for the scraping pool!
        if (userKey) apiKeyPool.add(userKey);

        let enemyId = req.query.enemyFaction && req.query.enemyFaction !== "null" && req.query.enemyFaction !== "" ? req.query.enemyFaction : null;
        
        let [myData, enemyDataResult] = await Promise.all([
            fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })),
            enemyId ? fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })) : Promise.resolve({ members: {} })
        ]);
        
        if (myData.error) return res.status(400).json({ error: "Invalid API Key" });
        if (!enemyId) enemyId = autoDetectEnemyFaction(myData);
        if (enemyId && Object.keys(enemyDataResult.members || {}).length === 0) { enemyDataResult = await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${userKey}`).then(r => r.json()).catch(() => ({ members: {} })); }
        
        let myFacId = myData.ID?.toString();
        let liveWarStats = {};
        if (myData.rankedwars) {
            for (let [id, w] of Object.entries(myData.rankedwars)) {
                if (w.war && w.war.winner === 0) {
                    if (w.factions[myFacId] && w.factions[myFacId].members) liveWarStats = w.factions[myFacId].members;
                    break;
                }
            }
        }

        const friendlyIds = new Set(Object.keys(myData.members || {}));
        const enemyIds = new Set(Object.keys(enemyDataResult.members || {}));
        
        [...friendlyIds, ...enemyIds].forEach(id => {
            if (!statsCache[id] || (Date.now() - statsCache[id].time) > 3600000) { if (!statQueue.includes(id)) statQueue.push(id); }
            const m = myData.members[id] || enemyDataResult.members[id];
            const isTraveling = m.status?.state === "Traveling" || (m.status?.description && m.status?.description.includes("Traveling"));
            if (isTraveling) { if (!flightCache[id] || (Date.now() - flightCache[id].time) > 30000) { if (!flightQueue.includes(id)) flightQueue.push(id); } }
        });

        const parseMembers = (data, isEnemy = false) => {
            if (!data.members) return [];
            return Object.entries(data.members).map(([id, m]) => {
                const est = manualStats[id]?.stats !== undefined ? manualStats[id].stats : (statsCache[id]?.stats !== undefined ? statsCache[id].stats : "loading");
                const isTraveling = m.status?.state === "Traveling" || (m.status?.description && m.status?.description.includes("Traveling"));
                let finalUntil = m.status?.until; let finalLandingTime = null;
                if (isTraveling) { finalLandingTime = flightCache[id]?.landingTime || null; finalUntil = finalLandingTime; }
                const intelScore = isEnemy ? computeWarIntel({ id, state: m.status?.state, until: finalUntil, onlineStatus: m.last_action?.status || "Offline", estStats: est }, statsCache) : null;
                if (isEnemy && backups[id] && m.status?.state === "Hospital") { const timeLeft = m.status.until - Math.floor(Date.now() / 1000); if (timeLeft > 1800) delete backups[id]; }
                
                let attacks = 0; let score = 0;
                let defends = liveDefends[id] || 0; // Grab the live defend count from Engine 4!

                if (!isEnemy && liveWarStats[id]) {
                    attacks = liveWarStats[id].attacks || 0;
                    score = liveWarStats[id].score || 0;
                }

                return { id, name: m.name, state: m.status?.state, until: finalUntil, statusDescription: m.status?.description || "", onlineStatus: m.last_action?.status || "Offline", lastActionRelative: m.last_action?.relative || "Unknown", landingTime: finalLandingTime, claimedBy: isEnemy ? claims[id]?.playerName || null : null, needsBackup: isEnemy ? backups[id]?.playerName || null : null, estStats: est, intelScore, isManual: !!manualStats[id], attacks, score, defends };
            });
        };
        res.json({ friendly: parseMembers(myData, false), enemy: parseMembers(enemyDataResult, true), detectedEnemyId: enemyId });
    } catch (err) { res.status(403).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
