const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

// CRITICAL: This line tells Render to look inside the "public" folder for your website
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;
const FACTION_ID = process.env.FACTION_ID || '';

// Render Health Check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// The Warboard Data Endpoint
app.get('/api/warboard', async (req, res) => {
    try {
        const response = await fetch(`https://api.torn.com/faction/${FACTION_ID}?selections=basic&key=${TORN_API_KEY}`);
        const data = await response.json();
        
        if (data.error) {
            return res.status(400).json({ error: data.error.error });
        }

        const ready = [];
        const hospitalized = [];

        if (data.members) {
            for (const [id, member] of Object.entries(data.members)) {
                if (member.status.state === 'Okay') {
                    ready.push({ name: member.name, id: id });
                } else if (member.status.state === 'Hospital') {
                    const date = new Date(member.status.until * 1000);
                    const outTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    hospitalized.push({ name: member.name, outTime: outTime });
                }
            }
        }
        res.json({ ready, hospitalized });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data from Torn' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
