const express = require('express');
const cors = require('cors');
const path = require('path');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TORN_API_KEY;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname))); 
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// ==========================================
// THE FIX: Render Health Check Endpoint
// ==========================================
app.get('/health', (req, res) => {
    // This tells Render "I am alive and working perfectly!"
    res.status(200).send('OK');
});
// Explicitly serve the index.html file for the main website address
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Main Faction Combat Data Endpoint
app.get('/api/faction', async (req, res) => {
    if (!API_KEY) {
        console.error("CRITICAL: TORN_API_KEY is missing from environment variables.");
        return res.status(500).json({ error: 'API key not configured on server.' });
    }

    try {
        const tornApiUrl = `https://api.torn.com/faction/?selections=basic,chain,rankedwars&key=${API_KEY}`;
        
        const response = await fetch(tornApiUrl);
        const data = await response.json();

        if (data.error) {
            console.error('Torn API Rejected Request:', data.error);
            return res.status(400).json({ success: false, error: data.error });
        }

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
