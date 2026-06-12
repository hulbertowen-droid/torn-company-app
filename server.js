const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

// Tells Render to look inside the "public" folder for your website
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;
// Make sure this is set to the enemy faction's ID in Render!
const FACTION_ID = process.env.FACTION_ID || ''; 

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/api/warboard', async (req, res) => {
    try {
        // 1. Fetch your own faction (leaving the ID blank gets your own)
        const myFactionRes = await fetch(`https://api.torn.com/faction/?selections=basic&key=${TORN_API_KEY}`);
        const myData = await myFactionRes.json();

        // 2. Fetch the enemy faction
        let enemyData = { members: {} };
        if (FACTION_ID) {
            const enemyRes = await fetch(`https://api.torn.com/faction/${FACTION_ID}?selections=basic&key=${TORN_API_KEY}`);
            enemyData = await enemyRes.json();
        }

        // Helper function to extract and format members
        const parseMembers = (data) => {
            const list = [];
            if (data.members) {
                for (const [id, member] of Object.entries(data.members)) {
                    list.push({
                        id: id,
                        name: member.name,
                        state: member.status.state,
                        until: member.status.until
                    });
                }
            }
            return list;
        };

        // Send both lists back to the website
        res.json({ 
            friendly: parseMembers(myData), 
            enemy: parseMembers(enemyData) 
        });

    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: 'Failed to fetch data from Torn' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
