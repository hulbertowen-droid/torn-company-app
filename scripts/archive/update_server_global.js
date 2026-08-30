const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

// Update master config to accept global toggles
const masterConfigReplacer = `
app.post('/api/master-config', (req, res) => {
    const { apiKey, discordWebhook, companyWebhook, ocWebhook, myName, globalToggles } = req.body;
    
    // Save to discord config
    if (discordWebhook !== undefined) discordConfig.webhookUrl = discordWebhook;
    if (apiKey !== undefined) discordConfig.apiKey = apiKey;
    if (myName !== undefined) discordConfig.myName = myName; // Generic storage
    
    if (globalToggles) {
        discordConfig.chainUnder90 = globalToggles.chain;
        discordConfig.chainMilestone = globalToggles.chain;
        discordConfig.targetOnline = globalToggles.target;
        discordConfig.targetLanded = globalToggles.target;
        discordConfig.targetOutHosp = globalToggles.target;
        discordConfig.medOutSniper = globalToggles.sniper;
    }
    
    saveDiscordConfig();
`;
content = content.replace(/app\.post\('\/api\/master-config', \(req, res\) => \{\s*const \{ apiKey, discordWebhook, companyWebhook, ocWebhook, myName \} = req\.body;\s*\/\/ Save to discord config\s*if \(discordWebhook !== undefined\) discordConfig\.webhookUrl = discordWebhook;\s*if \(apiKey !== undefined\) discordConfig\.apiKey = apiKey;\s*if \(myName !== undefined\) discordConfig\.myName = myName; \/\/ Generic storage\s*saveDiscordConfig\(\);/, masterConfigReplacer.trim());

fs.writeFileSync(file, content);
console.log('Updated master-config to save global toggles');
