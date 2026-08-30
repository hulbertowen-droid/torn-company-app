const fs = require('fs');

let file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

// We will inject a /api/master-config endpoint
const masterConfigApi = `
app.get('/api/master-config', (req, res) => {
    res.json({
        discordConfig,
        companyConfig,
        ocConfig,
        marketConfig,
        adminKeys: apiPoolConfig.keys
    });
});

app.post('/api/master-config', (req, res) => {
    const { apiKey, discordWebhook, companyWebhook, ocWebhook, myName } = req.body;
    
    // Save to discord config
    if (discordWebhook !== undefined) discordConfig.webhookUrl = discordWebhook;
    if (apiKey !== undefined) discordConfig.apiKey = apiKey;
    if (myName !== undefined) discordConfig.myName = myName; // Generic storage
    saveDiscordConfig();
    
    // Also save API key to company config for redundancy if needed
    if (apiKey !== undefined) { companyConfig.apiKey = apiKey; saveCompanyConfig(); }
    
    res.json({ success: true });
});
`;

// Insert it right before the sync-configs endpoint
content = content.replace(/app\.post\('\/api\/sync-configs',/, masterConfigApi + '\napp.post(\'/api/sync-configs\',');

fs.writeFileSync(file, content);
console.log('Injected master-config endpoint to server.js');
