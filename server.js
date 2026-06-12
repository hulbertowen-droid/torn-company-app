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
const FFSCOUTER_API_KEY = process.env.FFSCOUTER_API_KEY || ''; // Your FF Scouter / YATA Key

let claims = {};
let enemyList = []; 
let ffEstimates = {}; 

// ==========================================
// BACKGROUND FF SCOUTER (API DATABASE PULL)
// ==========================================
let currentEnemyIndex = 0;

setInterval(async () => {
    // If no faction is loaded or no API key is provided, skip the loop
    if (enemyList.length === 0 || !FFSCOUTER_API_KEY) return;

    const enemyId = enemyList[currentEnemyIndex];

    try {
        // We use the YATA/FFScouter standard target endpoint. 
        // This pulls from the crowdsourced attack log database instead of guessing with math.
        const res = await fetch(`https://yata.yt/api/v1/targets/${enemyId}/?key=${FFSCOUTER_API_KEY}`);
        
        if (res.ok) {
            const data = await res.json();
            
            // If the crowdsourced database has a battle score for them, lock it in!
            if (data && data.target && data.target.battle_score) {
                // Battle scores are the square root of stats, so we square it back to get the raw estimate
                const rawStats = Math.pow(data.target.battle_score, 2);
                ffEstimates[enemyId] = rawStats;
            }
        }
    } catch (e) {
        console.error(`FF Scouter API failed for ID ${enemyId}`);
    }

    currentEnemyIndex++;
    if (currentEnemyIndex >= enemyList.length) {
        currentEnemyIndex = 0;
    }
}, 3000); // 1 enemy every 3 seconds to stay under rate limits


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
                        // Pulls strictly from the crowdsourced FF database!
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
