const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

// Optional but recommended: This line tells Express to serve your index.html 
// file if you put it inside a folder named "public"
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;

// You can add this to your .env file. Leave it blank to track your own faction,
// or put an enemy faction's ID here to track them during a war.
const FACTION_ID = process.env.FACTION_ID || '';

// 1. Render Health Check Endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// 2. Secure Faction Warboard Endpoint
// This replaces your company endpoint and feeds the index.html file
app.get('/api/warboard', async (req, res) => {
    try {
        // Fetch faction data from Torn
        const response = await fetch(`https://api.torn.com/faction/${FACTION_ID}?selections=basic&key=${TORN_API_KEY}`);
        const data = await response.json();
        
        // Catch API errors (like an invalid key or rate limits)
        if (data.error) {
            console.error("Torn API Error:", data.error.error);
            return res.status(400).json({ error: data.error.error });
        }

        // Create empty arrays to hold our sorted data
        const ready = [];
        const hospitalized = [];

        // Loop through the raw data and sort the members
        if (data.members) {
            for (const [id, member] of Object.entries(data.members)) {
                if (member.status.state === 'Okay') {
                    
                    ready.push({ name: member.name, id: id });
                    
                } else if (member.status.state === 'Hospital') {
                    
                    // Convert Torn's Unix timestamp to a readable 12/24 hour time
                    const date = new Date(member.status.until * 1000);
                    const outTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    
                    hospitalized.push({ name: member.name, outTime: outTime });
                    
                }
            }
        }

        // Send the formatted JSON back to the index.html frontend
        res.json({ ready, hospitalized });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: 'Failed to fetch data from Torn' });
    }
});

app.listen(PORT, () => {
    console.log(`Warboard server running smoothly on port ${PORT}`);
});
