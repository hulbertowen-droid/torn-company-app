const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

// CRITICAL: This new line allows the server to understand data sent from the website
app.use(express.json()); 
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;
const FACTION_ID = process.env.FACTION_ID || ''; 

// Temporary server memory to hold target claims
// Format: { enemyId: { playerName: "Name", time: 123456789 } }
let claims = {};

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// NEW: Endpoint to claim a target
app.post('/api/claim', (req, res) => {
    const { enemyId, playerName } = req.body;
    
    if (!enemyId || !playerName) {
        return res.status(400).json({ error: "Missing data" });
    }

    // Check if someone else already claimed it
    if (claims[enemyId] && claims[enemyId].playerName !== playerName) {
        return res.status(400).json({ error: "Already claimed", claimedBy: claims[enemyId].playerName });
    }

    // Lock the claim
    claims[enemyId] = { playerName, time: Date.now() };
    res.json({ success: true });
});

// The Warboard Data Endpoint
app.get('/api/warboard', async (req, res) => {
    try {
        const myFactionRes = await fetch(`https://api.torn.com/faction/?selections=basic&key=${TORN_API_KEY}`);
        const myData = await myFactionRes.json();

        let enemyData = { members: {} };
        if (FACTION_ID) {
            const enemyRes = await fetch(`https://api.torn.com/faction/${FACTION_ID}?selections=basic&key=${TORN_API_KEY}`);
            enemyData = await enemyRes.json();
        }

        // Cleanup: Remove claims older than 5 minutes to prevent AFK locks
        const now = Date.now();
        for (const id in claims) {
            if (now - claims[id].time > 5 * 60 * 1000) {
                delete claims[id];
            }
        }

        const parseMembers = (data, isEnemy = false) => {
            const list = [];
            if (data.members) {
                for (const [id, member] of Object.entries(data.members)) {
                    
                    // If the enemy is in the hospital, automatically clear their claim
                    if (isEnemy && member.status.state !== 'Okay' && claims[id]) {
                        delete claims[id];
                    }

                    list.push({
                        id: id,
                        name: member.name,
                        state: member.status.state,
                        until: member.status.until,
                        // Attach the claim data if it exists
                        claimedBy: isEnemy && claims[id] ? claims[id].playerName : null
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
