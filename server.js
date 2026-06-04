const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors()); // Allows your dashboard interface to safely read this server's data

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;

// 1. Render Health Check Endpoint
// Render will periodically message this path to verify your server is running perfectly
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// 2. Secure Torn Company Endpoint
// Fetches live profiles and employee data using your private key hidden in the cloud
app.get('/api/company', async (req, res) => {
    try {
        const response = await fetch(`https://api.torn.com/company/?selections=profile,employees&key=${TORN_API_KEY}`);
        const data = await response.json();
        
        // Returns clean JSON data back to your application browser
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data from Torn' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
