const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove variables and constants
content = content.replace(/const VIP_FACTIONS = [^\n]+\n/, '');
content = content.replace(/const VIP_PLAYERS = [^\n]+\n/, '');
content = content.replace(/let subscriptions = \{\};\n/, '');
content = content.replace(/let vipConfig = \{ factions: \[\], players: \[\] \}; \n/, '');

// 2. Remove try/catches for vip_config
content = content.replace(/try \{ if \(fs\.existsSync\('vip_config\.json'\)\)[^\n]+\n/, '');
content = content.replace(/function saveVipConfig\(\) [^\n]+\n/, '');
content = content.replace(/function saveSubs\(\) [^\n]+\n/, '');

// 3. Remove /api/admin/* routes
content = content.replace(/app\.get\('\/api\/admin\/vips'[\s\S]*?\}\);\n/, '');
content = content.replace(/app\.post\('\/api\/admin\/vips'[\s\S]*?\}\);\n/, '');
content = content.replace(/app\.get\('\/api\/admin\/keys'[\s\S]*?\}\);\n/, '');
content = content.replace(/app\.post\('\/api\/admin\/keys'[\s\S]*?\}\);\n/, '');
content = content.replace(/app\.get\('\/api\/admin\/tracking'[\s\S]*?\}\);\n/, '');

// 4. Rewrite verifySubscription
const oldVerifyRegex = /async function verifySubscription\(userKey\) \{[\s\S]*?^\}/m;
const newVerify = `async function verifySubscription(userKey) {
    if (!userKey) throw new Error("No API Key provided.");
    const now = Date.now();
    
    if (subCache[userKey] && subCache[userKey].expires > now) {
        if (userTracking[subCache[userKey].playerId]) {
            userTracking[subCache[userKey].playerId].lastActive = now;
            saveTracking();
        }
        return subCache[userKey].playerId;
    }
    
    try {
        const res = await fetch(\`https://api.torn.com/user/?selections=profile&key=\${userKey}\`);
        const data = await res.json();
        
        if (data.error) {
            if ([5, 8, 9].includes(data.error.code) && subCache[userKey]) { return subCache[userKey].playerId; }
            if (data.error.code === 2) throw new Error("Invalid API Key.");
            throw new Error(\`Torn API Throttled: Retrying link...\`);
        }

        const playerId = data.player_id?.toString();
        const facId = data.faction?.faction_id?.toString();

        if (data.name && playerId) {
            userTracking[playerId] = { name: data.name, lastActive: now };
            saveTracking();
        }
        
        // Add all valid keys to the API pool for background tasks
        if (!apiPoolConfig.keys.includes(userKey)) {
            apiPoolConfig.keys.push(userKey);
            saveApiPool();
        }

        subCache[userKey] = { playerId, expires: now + 300000 };
        return playerId;
    } catch (err) {
        if (subCache[userKey]) return subCache[userKey].playerId;
        throw err;
    }
}`;
content = content.replace(oldVerifyRegex, newVerify);

fs.writeFileSync(file, content);
console.log('Removed VIP/Paywall and Admin routes from server.js');
