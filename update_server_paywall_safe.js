const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove variables and constants
const varsToRemove = [
    /const VIP_FACTIONS = \([^)]+\)\.split\([^)]+\)\.map\([^)]+\);\n/,
    /const VIP_PLAYERS = \([^)]+\)\.split\([^)]+\)\.map\([^)]+\);\n/,
    /let subscriptions = \{\};\n/,
    /let vipConfig = \{ factions: \[\], players: \[\] \}; \n/
];
varsToRemove.forEach(reg => { content = content.replace(reg, ''); });

// 2. Remove try/catches for vip_config
content = content.replace(/try \{ if \(fs\.existsSync\('vip_config\.json'\)\)[^\n]+\n/, '');
content = content.replace(/function saveVipConfig\(\) [^\n]+\n/, '');
content = content.replace(/function saveSubs\(\) [^\n]+\n/, '');

// 3. Remove /api/admin/* routes manually using exact string replacement
const adminVipsGet = `app.get('/api/admin/vips', (req, res) => {
    if (req.query.apiKey !== ADMIN_API_KEY || !ADMIN_API_KEY) return res.status(403).json({error: "Access Denied."});
    res.json(vipConfig);
});`;
content = content.replace(adminVipsGet, '');

const adminVipsPost = `app.post('/api/admin/vips', (req, res) => {
    if (req.body.apiKey !== ADMIN_API_KEY || !ADMIN_API_KEY) return res.status(403).json({error: "Access Denied."});
    vipConfig = { factions: req.body.factions || [], players: req.body.players || [] };
    saveVipConfig();
    res.json({ success: true });
});`;
content = content.replace(adminVipsPost, '');

const adminKeysGet = `app.get('/api/admin/keys', (req, res) => {
    if (req.query.apiKey !== ADMIN_API_KEY || !ADMIN_API_KEY) return res.status(403).json({error: "Access Denied."});
    res.json(apiPoolConfig);
});`;
content = content.replace(adminKeysGet, '');

const adminKeysPost = `app.post('/api/admin/keys', (req, res) => {
    if (req.body.apiKey !== ADMIN_API_KEY || !ADMIN_API_KEY) return res.status(403).json({error: "Access Denied."});
    apiPoolConfig.keys = req.body.keys || [];
    saveApiPool();
    res.json({ success: true });
});`;
content = content.replace(adminKeysPost, '');

const adminTrackingGet = `app.get('/api/admin/tracking', (req, res) => {
    if (req.query.apiKey !== ADMIN_API_KEY || !ADMIN_API_KEY) return res.status(403).json({error: "Access Denied."});
    res.json(userTracking);
});`;
content = content.replace(adminTrackingGet, '');

// Also remove admin keys from /api/master-config response
content = content.replace(/,\s*adminKeys: apiPoolConfig\.keys/, '');

// 4. Rewrite verifySubscription
const oldVerifyStart = 'async function verifySubscription(userKey) {';
const oldVerifyEnd = `    } catch (err) {
        if (subCache[userKey]) return subCache[userKey].playerId;
        throw err;
    }
}`;
const verifyStartIndex = content.indexOf(oldVerifyStart);
const verifyEndIndex = content.indexOf(oldVerifyEnd) + oldVerifyEnd.length;

if (verifyStartIndex > -1 && verifyEndIndex > verifyStartIndex) {
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
    content = content.substring(0, verifyStartIndex) + newVerify + content.substring(verifyEndIndex);
}

fs.writeFileSync(file, content);
console.log('Removed VIP/Paywall and Admin routes from server.js safely');
