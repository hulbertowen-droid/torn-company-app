const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json()); 
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;
const FACTION_ID = process.env.FACTION_ID || ''; 

let claims = {};
let enemyList = []; 

// ==========================================
// MATH ESTIMATOR LOGIC & QUEUE
// ==========================================
let statsCache = {}; 
let statQueue = [];
let isProcessingQueue = false;

function calculateEstimatedStats(pstats) {
    if (!pstats) return 0;
    
    const xanax = pstats.xantaken || 0;
    const refills = pstats.refills || 0;
    const cans = pstats.energydrinkused || 0;
    const se = pstats.statenhancersused || 0;
    const ageDays = pstats.age || 1; 

    // Total Energy: Consumables + Passive Regen (480/day)
    let totalEnergyUsed = (xanax * 250) + (refills * 150) + (cans * 30) + (ageDays * 480);
    
    // Account Age Multiplier
    let multiplier = 800; 
    if (ageDays > 500) multiplier = 1200;
    if (ageDays > 1000) multiplier = 2000;
    if (ageDays > 1500) multiplier = 3500;

    // Scaling Curve
    if (totalEnergyUsed > 500000) multiplier *= 1.5;
    if (totalEnergyUsed > 2000000) multiplier *= 2.0;

    let baseStats = totalEnergyUsed * multiplier;
    
    // Stat Enhancer Compound
    if (se > 0) {
        baseStats = baseStats * Math.pow(1.02, se);
    }

    return Math.floor(Math.max(baseStats, 10000)); 
}

// Background loop to slowly fetch personal stats
setInterval(async () => {
    if (statQueue.length === 0 || isProcessingQueue || !TORN_API_KEY) return;
    
    isProcessingQueue = true;
    const id = statQueue.shift();
    
    try {
        const res = await fetch(`https://api.torn.com/user/${id}?selections=personalstats&key=${TORN_API_KEY}`);
        const data = await res.json();
        
        if (data && data.personalstats) {
            const calculatedStats = calculateEstimatedStats(data.personalstats);
            statsCache[id] = { stats: calculatedStats, time: Date.now() };
        } else if (data && data.error && (data.error.code === 2 || data.error.code === 5)) {
            statQueue.unshift(id);
        }
    } catch (e) {
        console.error("Error fetching personal stats:", e.message);
    }
    
    isProcessingQueue = false;
}, 1500); 

// ==========================================
// WARBOARD ENDPOINTS
// ==========================================

// Health check for Render
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.post('/api/claim', (req, res) => {
    const { enemyId, playerName } = req.body;
    if (!enemyId || !playerName) return res.status(400).json({ error: "Missing data" });
    if (claims[enemyId] && claims[enemyId].playerName !== playerName) {
        return res.status(400).json({ error: "Already claimed", claimedBy: claims[enemyId].playerName });
    }
    claims[enemyId] = { playerName, time: Date.now() };
    res.json({ success: true });
});

app.post('/api/unclaim', (req, res) => {
    const { enemyId, playerName } = req.body;
    if (claims[enemyId] && claims[enemyId].playerName === playerName) {
        delete claims[enemyId];
        return res.json({ success: true });
    }
    res.status(400).json({ error: "You cannot unclaim this target." });
});

app.get('/api/warboard', async (req, res) => {
    try {
        const myFactionRes = await fetch(`https://api.torn.com/faction/?selections=basic&key=${TORN_API_KEY}`);
        const myData = await myFactionRes.json();

        let enemyData = { members: {} };
        if (FACTION_ID) {
            const enemyRes = await fetch(`https://api.torn.com/faction/${FACTION_ID}?selections=basic&key=${TORN_API_KEY}`);
            enemyData = await enemyRes.json();
            
            if (enemyData.members) {
                const now = Date.now();
                for (const id of Object.keys(enemyData.members)) {
                    const cached = statsCache[id];
                    if (!cached || (now - cached.time > 24 * 60 * 60 * 1000)) {
                        if (!statQueue.includes(id)) statQueue.push(id);
                    }
                }
            }
        }

        const now = Date.now();
        for (const id in claims) {
            if (now - claims[id].time > 15 * 60 * 1000) delete claims[id];
        }

        const parseMembers = (data, isEnemy = false) => {
            const list = [];
            if (data.members) {
                for (const [id, member] of Object.entries(data.members)) {
                    let lastAction = member.last_action && member.last_action.status ? member.last_action.status : 'Offline';
                    let statVal = null;
                    if (isEnemy && statsCache[id]) statVal = statsCache[id].stats;

                    list.push({
                        id: id,
                        name: member.name,
                        state: member.status.state,
                        until: member.status.until,
                        claimedBy: isEnemy && claims[id] ? claims[id].playerName : null,
                        onlineStatus: lastAction,
                        estStats: statVal
                    });
                }
            }
            return list;
        };

        res.json({ 
            friendly: parseMembers(myData), 
            enemy: parseMembers(enemyData, true)
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
