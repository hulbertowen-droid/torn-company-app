const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors()); 

const PORT = process.env.PORT || 3000;
const TORN_API_KEY = process.env.TORN_API_KEY;

// This creates a secure URL route to get your company profile data
app.get('/api/company', async (req, res) => {
    try {
        const response = await fetch(`https://api.torn.com/company/?selections=profile,employees&key=${TORN_API_KEY}`);
        const data = await response.json();
        
        // Send the data back to whoever asked for it
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data from Torn' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
