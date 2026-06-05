const express = require('express');
const cors = require('cors');
const path = require('path');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TORN_API_KEY;

// Middleware
app.use(cors());
// This serves your index.html and any other frontend files from the root directory
app.use(express.static(path.join(__dirname))); 

// Main Faction Combat Data Endpoint
app.get('/api/faction', async (req, res) => {
    // Failsafe if the API key isn't loaded
    if (!API_KEY) {
        console.error("CRITICAL: TORN_API_KEY is missing from environment variables.");
        return res.status(500).json({ error: 'API key not configured on server.' });
    }

    try {
        // Pinging the Torn API for live Chain and Ranked War data
        // https://api.torn.com/faction/?selections=basic,chain,rankedwars&key=YOUR_KEY
        const tornApiUrl = `https://api.torn.com/faction/?selections=basic,chain,rankedwars&key=${API_KEY}`;
        
        // Native fetch works out of the box in Node 18+ (which Render uses)
        const response = await fetch(tornApiUrl);
        const data = await response.json();

        // Check if Torn kicked back an error (like an invalid key)
        if (data.error) {
            console.error('Torn API Rejected Request:', data.error);
            return res.status(400).json({ success: false, error: data.error });
        }

        // Send the raw combat data straight to your index.html frontend
        res.json({ success: true, faction: data });

    } catch (error) {
        console.error('Arachnid Network Backend Failure:', error);
        res.status(500).json({ success: false, error: 'Internal server failure communicating with Torn.' });
    }
});

// Boot the Server
app.listen(PORT, () => {
    console.log(`🕷️ ARACHNID WAR NETWORK ONLINE: Listening on port ${PORT}`);
    if (!API_KEY) {
        console.log("⚠️ WARNING: No API Key detected in environment!");
    } else {
        console.log("✅ API Key loaded securely.");
    }
});
