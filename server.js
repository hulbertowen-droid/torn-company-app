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

// [Live Warboard logic remains the same...]
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

// Payout API Endpoint
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
        
        if (reportData.error) return res.status(400).json({ error: "Torn API Error: " + reportData.error.error });
        if (!reportData.rankedwarreport || !reportData.rankedwarreport.factions) return res.status(400).json({ error: "Invalid Report ID." });

        const myFactionWarData = reportData.rankedwarreport.factions[myFacId];
        if (!myFactionWarData) return res.status(400).json({ error: "Your faction was not part of this war." });

        // Calculate Gross Value
        let totalCacheValue = 0;
        let cachesWon = [];
        if (myFactionWarData.rewards && myFactionWarData.rewards.items) {
            for (let [itemId, itemInfo] of Object.entries(myFactionWarData.rewards.items)) {
                const itemMarketData = itemsData.items ? itemsData.items[itemId] : null;
                const marketValue = itemMarketData ? itemMarketData.market_value : 0;
                const quantity = itemInfo.quantity || 0;
                totalCacheValue += (marketValue * quantity);
                cachesWon.push({ name: itemInfo.name, quantity, marketValue, totalValue: marketValue * quantity });
            }
        }

        // Direct Extraction from Report (No rolling logs needed)
        let formattedMembers = [];
        const members = myFactionWarData.members || {};
        for (let [id, m] of Object.entries(members)) {
            formattedMembers.push({
                id,
                name: m.name,
                attacks: m.attacks || 0,
                assists: m.assists || 0,
                retaliations: m.retaliations || 0,
                score: m.score || 0
            });
        }

        formattedMembers.sort((a, b) => b.score - a.score);

        res.json({ 
            success: true, 
            members: formattedMembers,
            rewards: {
                totalCacheValue: totalCacheValue,
                caches: cachesWon,
                points: myFactionWarData.rewards?.points || 0,
                respect: myFactionWarData.rewards?.respect || 0
            }
        });
    } catch (err) {
        res.status(500).json({ error: "Server error fetching report." });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
