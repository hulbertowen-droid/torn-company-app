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
const TORNSTATS_API_KEY = process.env.TORNSTATS_API_KEY || ''; 

let claims = {};
let enemyList = []; 
let ffEstimates = {}; 

// ==========================================
// BACKGROUND FF SCOUTER (THE "SLOW DRIP")
// ==========================================
let currentEnemyIndex = 0;

setInterval(async () => {
    // If there is no enemy faction loaded, do nothing
    if (enemyList.length === 0) return;

    // Grab the next enemy in the list
    const enemyId = enemyList[currentEnemyIndex];

    try {
        // Fetch their personal stats
        const res = await fetch(`https://api.torn.com/user/${enemyId}?selections=personalstats&key=${TORN_API_KEY}`);
        const data = await res.json();

        if (data && data.personalstats) {
            const ps = data.personalstats;
            
            // 1. Calculate approximate total lifetime energy used
            const energyFromXanax = (ps.xantaken || 0) * 250;
            const energyFromRefills = (ps.refills || 0) * 150;
            const energyFromCans = (ps.energydrinkused || 0) * 30;
            const totalEnergy = energyFromXanax + energyFromRefills + energyFromCans;

            let baseStats = 0;
            
            // 2. Progressive Scaling: The more energy you use, the higher your gains get
            if (totalEnergy <= 50000) {
                baseStats = totalEnergy * 2000;
            } else if (totalEnergy <= 150000) {
                baseStats = (50000 * 2000) + ((totalEnergy - 50000) * 15000);
            } else if (totalEnergy <= 300000) {
                baseStats = (50000 * 2000) + (100000 * 15000) + ((totalEnergy - 150000) * 45000);
            } else {
                baseStats = (50000 * 2000) + (100000 * 15000) + (150000 * 45000) + ((totalEnergy - 300000) * 85000);
            }

            // 3. Stat Enhancers compound exponentially (~1% per SE)
            const statEnhancers = ps.statenhancersused || 0;
            const totalEstimate = baseStats * Math.pow(1.01, statEnhancers);
            
            // Lock the better estimate into memory
            ffEstimates[enemyId] = totalEstimate;
        }
    } catch (e) {
        console.error(`FF Scouter failed for ID ${enemyId}`);
    }

    // Move to the next enemy in the list, loop back to 0 if at the end
    currentEnemyIndex++;
    if (currentEnemyIndex >= enemyList.length) {
        currentEnemyIndex = 0;
    }

}, 3000); // Runs once every 3 seconds (20 API calls per minute)


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
            
            // Update the background scanner's list with the live enemy IDs
            if (enemyData.members) {
                enemyList = Object.keys(enemyData.members);
            }
        }

        let spyData = {};
        if (TORNSTATS_API_KEY && FACTION_ID) {
            try {
                const tsRes = await fetch(`https://www.tornstats.com/api/v2/${TORNSTATS_API_KEY}/spy/faction/${FACTION_ID}`);
                const tsData = await tsRes.json();
                
                if (tsData.status) {
                    const members = tsData.faction.members || tsData.faction;
                    for (const [key, member] of Object.entries(members)) {
                        const playerId = member.id || member.player_id || key;
                        if (member.spy) {
                            let total = member.spy.total || (member.spy.strength + member.spy.speed + member.spy.defense + member.spy.dexterity) || 0;
                            if (total > 0) spyData[playerId.toString()] = total;
                        }
                    }
                }
            } catch (e) {
                console.error("TornStats fetch failed.");
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

                    // Smart Fallback: Use TornStats if it exists, otherwise use the new FF Scouter estimate!
                    let finalStats = null;
                    if (isEnemy) {
                        finalStats = spyData[id] || ffEstimates[id] || null;
                    }

                    list.push({
                        id: id,
                        name: member.name,
                        state: member.status.state,
                        until: member.status.until,
                        claimedBy: isEnemy && claims[id] ? claims[id].playerName : null,
                        onlineStatus: lastAction,
                        estStats: finalStats 
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
