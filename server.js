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
        const myFactionRes = await fetch(`https://api.torn.com/faction/?selections=basic&key=${TORN_API_KEY}`);
        const myData = await myFactionRes.json();

        let enemyData = { members: {} };
        if (FACTION_ID) {
            const enemyRes = await fetch(`https://api.torn.com/faction/${FACTION_ID}?selections=basic&key=${TORN_API_KEY}`);
            enemyData = await enemyRes.json();
        }

        let spyData = {};
        let tsDebug = "Did not run."; // This will capture exactly what happens with TornStats

        if (TORNSTATS_API_KEY && FACTION_ID) {
            try {
                const tsRes = await fetch(`https://www.tornstats.com/api/v2/${TORNSTATS_API_KEY}/spy/faction/${FACTION_ID}`);
                const tsData = await tsRes.json();
                
                // Save the raw response to send straight to your browser
                tsDebug = tsData; 

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
                tsDebug = "TornStats fetch crashed: " + e.message;
            }
        } else {
            tsDebug = `Missing Keys! TORNSTATS_API_KEY set? ${!!TORNSTATS_API_KEY} | FACTION_ID set? ${!!FACTION_ID}`;
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
                        estStats: isEnemy ? (spyData[id] || null) : null
                    });
                }
            }
            return list;
        };

        res.json({ 
            friendly: parseMembers(myData), 
            enemy: parseMembers(enemyData, true),
            debug_tornstats: tsDebug // We added the debug payload here
        });

    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: 'Failed to fetch data from Torn' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
