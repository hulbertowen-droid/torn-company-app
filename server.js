const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors()); 

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;

// 1. Render Health Check Endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// 2. Main Dashboard UI Endpoint
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. Secure Torn Company Endpoint Data Stream (Fetches both Profile and Employees)
app.get('/api/company', async (req, res) => {
    try {
        const response = await fetch(`https://api.torn.com/company/?selections=profile,employees&key=${TORN_API_KEY}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data from Torn' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
