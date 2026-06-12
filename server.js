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
        // 1. Fetch Torn Data
        const myFactionRes = await fetch(`https://api.torn.com/faction/?selections=basic&key=${TORN_API_KEY}`);
        const myData = await myFactionRes.json();

        let enemyData = { members: {} };
        if (FACTION_ID) {
            const enemyRes = await fetch(`https://api.torn.com/faction/${FACTION_ID}?selections=basic&key=${TORN_API_KEY}`);
            enemyData = await enemyRes.json();
        }

        // 2. Fetch TornStats Estimated Spy Data
        let spyData = {};
        if (TORNSTATS_API_KEY && FACTION_ID) {
            try {
                const tsRes = await fetch(`https://www.tornstats.com/api/v2/${TORNSTATS_API_KEY}/spy/faction/${FACTION_ID}`);
                const tsData = await tsRes.json();
                
                // === UNIVERSAL SPY EXTRACTOR ===
                // Recursively searches the entire response for spy stats, ignoring folder names
                function extractSpies(obj) {
                    for (const key in obj) {
                        if (obj[key] !== null && typeof obj[key] === 'object') {
                            
                            // If we find the spy data...
                            if (obj[key].spy && obj[key].spy.total) {
                                // Grab the ID from whatever property TornStats decided to use
                                const playerId = obj[key].id || obj[key].player_id || (isNaN(key) ? null : key);
                                
                                if (playerId) {
                                    // Lock it into our map using the exact ID
                                    spyData[playerId.toString()] = obj[key].spy.total;
                                }
                            } else {
                                // If not found, keep digging deeper
                                extractSpies(obj[key]);
                            }
                        }
                    }
                }
                
                if (tsData.status) {
                    extractSpies(tsData);
                }
            } catch (e) {
                console.error("TornStats fetch failed. Skipping spy data this cycle.");
            }
        }

        // Cleanup stale claims
        const now = Date.now();
        for (const id in claims) {
            if (now - claims[id].time > 15 * 60 * 1000) delete claims[id];
        }

        // 3. Merge Data Together
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
                        // Perfect match: Attaches the spy data if the player's ID was found
                        estStats: isEnemy ? (spyData[id] || null) : null
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
