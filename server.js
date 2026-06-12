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
let ffEstimates = {}; 

// ==========================================
// BACKGROUND STAT ESTIMATOR (NO TORNSTATS)
// ==========================================
let currentEnemyIndex = 0;

setInterval(async () => {
    if (enemyList.length === 0) return;

    const enemyId = enemyList[currentEnemyIndex];

    try {
        const res = await fetch(`https://api.torn.com/user/${enemyId}?selections=personalstats&key=${TORN_API_KEY}`);
        const data = await res.json();

        if (data && data.personalstats) {
            const ps = data.personalstats;
            
            // Advanced Estimation Algorithm based on late-game gym ratios
            // Xanax: ~80k-90k per pill late game
            // Refills: ~35k-40k per refill late game
            // Energy Drinks: ~5k per can
            const baseFromXanax = (ps.xantaken || 0) * 85000;
            const baseFromRefills = (ps.refills || 0) * 35000;
            const baseFromCans = (ps.energydrinkused || 0) * 5000;
            const baseFromBoosters = (ps.boostersused || 0) * 5000; // EDVDs for happy jumps
            
            let totalBase = baseFromXanax + baseFromRefills + baseFromCans + baseFromBoosters;

            // Stat Enhancers increase stats by exactly 1% per use, compounding.
            const statEnhancers = ps.statenhancersused || 0;
            const finalEstimate = totalBase * Math.pow(1.01, statEnhancers);
            
            // Lock the estimate into memory
            ffEstimates[enemyId] = finalEstimate;
        }
    } catch (e) {
        console.error(`Estimator failed for ID ${enemyId}`);
    }

    currentEnemyIndex++;
    if (currentEnemyIndex >= enemyList.length) {
        currentEnemyIndex = 0;
    }
}, 3000); // Runs once every 3 seconds to protect your API limits


// ==========================================
// WARBOARD ENDPOINTS
// ==========================================
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
                enemyList = Object.keys(enemyData.members);
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

                    list.push({
                        id: id,
                        name: member.name,
                        state: member.status.state,
                        until: member.status.until,
                        claimedBy: isEnemy && claims[id] ? claims[id].playerName : null,
                        onlineStatus: lastAction,
                        // Pulls strictly from the script's background estimator memory
                        estStats: isEnemy ? (ffEstimates[id] || null) : null 
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
        console.error("API Error:", error);
        res.status(500).json({ error: 'Failed to fetch data from Torn' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
