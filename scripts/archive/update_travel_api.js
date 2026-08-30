const fs = require('fs');
const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

const regex = /app\.get\('\/api\/travel-profits'[\s\S]*?res\.status\(500\)\.json\(\{ error: err\.message \}\);\s*\}\s*\}\);/;

const newApi = `app.get('/api/travel-profits', async (req, res) => {
    const { apiKey } = req.query;
    if (!apiKey) return res.status(400).json({ error: "API Key required" });
    try {
        await verifySubscription(apiKey);
        
        // Fetch Torn market data
        const resp = await fetch(\`https://api.torn.com/torn/?selections=items&key=\${apiKey}\`);
        const data = await resp.json();
        if (data.error) return res.status(400).json({ error: "Torn API Error: " + data.error.error });

        // Fetch live YATA stock data
        const yataResp = await fetch('https://yata.yt/api/v1/travel/export/');
        const yataData = await yataResp.json();
        
        const yataCountryMap = {
            "Mexico": "mex", "Cayman Islands": "cay", "Canada": "can", "Hawaii": "haw",
            "UK": "uni", "Argentina": "arg", "Switzerland": "swi", "Japan": "jap",
            "China": "chi", "UAE": "uae", "South Africa": "sou"
        };

        const items = data.items;
        const foreignItems = [
            { id: 261, name: "Wolverine Plushie", country: "Canada", cost: 30, flightTimeMins: 29 },
            { id: 274, name: "Jaguar Plushie", country: "Mexico", cost: 10000, flightTimeMins: 18 },
            { id: 266, name: "Nessie Plushie", country: "UK", cost: 200, flightTimeMins: 111 },
            { id: 268, name: "Red Fox Plushie", country: "UK", cost: 1000, flightTimeMins: 111 },
            { id: 273, name: "Monkey Plushie", country: "Argentina", cost: 400, flightTimeMins: 117 },
            { id: 269, name: "Chamois Plushie", country: "Switzerland", cost: 400, flightTimeMins: 123 },
            { id: 277, name: "Kitten Plushie", country: "Switzerland", cost: 500, flightTimeMins: 123 },
            { id: 272, name: "Stingray Plushie", country: "Japan", cost: 400, flightTimeMins: 158 },
            { id: 264, name: "Panda Plushie", country: "China", cost: 400, flightTimeMins: 164 },
            { id: 258, name: "Lion Plushie", country: "South Africa", cost: 400, flightTimeMins: 209 },
            { id: 281, name: "Camel Plushie", country: "UAE", cost: 14000, flightTimeMins: 190 },
            { id: 260, name: "Tribulus Omanense", country: "UAE", cost: 6000, flightTimeMins: 190 },
            { id: 263, name: "African Violet", country: "South Africa", cost: 2000, flightTimeMins: 209 },
            { id: 267, name: "Heather", country: "UK", cost: 5000, flightTimeMins: 111 },
            { id: 271, name: "Edelweiss", country: "Switzerland", cost: 3000, flightTimeMins: 123 },
            { id: 276, name: "Peony", country: "China", cost: 5000, flightTimeMins: 164 },
            { id: 282, name: "Cherry Blossom", country: "Japan", cost: 500, flightTimeMins: 158 },
            { id: 270, name: "Ceibo Flower", country: "Argentina", cost: 500, flightTimeMins: 117 },
            { id: 275, name: "Dahlia", country: "Mexico", cost: 300, flightTimeMins: 18 },
            { id: 262, name: "Crocus", country: "Canada", cost: 600, flightTimeMins: 29 },
            { id: 259, name: "Orchid", country: "Hawaii", cost: 700, flightTimeMins: 94 },
            
            // High Value / Drugs
            { id: 206, name: "Xanax", country: "South Africa", cost: 808000, flightTimeMins: 209 },
            { id: 226, name: "Smoke Grenade", country: "South Africa", cost: 20000, flightTimeMins: 209 },
            { id: 242, name: "Flash Grenade", country: "UAE", cost: 24000, flightTimeMins: 190 },
            { id: 254, name: "Tear Gas", country: "China", cost: 30000, flightTimeMins: 164 }
        ];

        let results = [];
        for (let item of foreignItems) {
            let marketPrice = items[item.id] ? items[item.id].market_value : 0;
            let cost = item.cost;
            let stock = 0;
            
            let yCode = yataCountryMap[item.country];
            if (yCode && yataData.stocks && yataData.stocks[yCode]) {
                let s = yataData.stocks[yCode].stocks.find(i => i.id === item.id);
                if (s) {
                    cost = s.cost;
                    stock = s.quantity;
                }
            }
            
            let profit = marketPrice - cost;
            let roundTrip = item.flightTimeMins * 2;
            let profitPerMin = roundTrip > 0 ? profit / roundTrip : 0;
            let profitPerHr = profitPerMin * 60;
            
            results.push({
                ...item,
                cost,
                stock,
                marketPrice,
                profit,
                profitPerMin,
                profitPerHr,
                roundTrip
            });
        }
        
        // Sort by Profit / Hour by default
        results.sort((a, b) => b.profitPerHr - a.profitPerHr);
        res.json({ success: true, items: results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});`;

content = content.replace(regex, newApi);
fs.writeFileSync(file, content);
console.log("Replaced /api/travel-profits in server.js");
