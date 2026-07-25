const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

const replacements = [
    [/const VIP_FACTIONS = \([^)]+\)\.split\([^)]+\)\.map\([^)]+\);\n/, ''],
    [/const VIP_PLAYERS = \([^)]+\)\.split\([^)]+\)\.map\([^)]+\);\n/, ''],
    [/let subscriptions = \{\};\n/, ''],
    [/let vipConfig = \{ factions: \[\], players: \[\] \}; \n/, ''],
    [/const ADMIN_API_KEY = process\.env\.ADMIN_API_KEY \|\| "";\n/, ''],
    [/const ADMIN_DISCORD_WEBHOOK = process\.env\.ADMIN_DISCORD_WEBHOOK \|\| ""; \n/, ''],
    [/try \{ if \(fs\.existsSync\('vip_config\.json'\)\)[^\n]+\n/, ''],
    [/function saveVipConfig\(\) [^\n]+\n/, ''],
    [/function saveSubs\(\) [^\n]+\n/, ''],
    [/let adminFactionId = null;\n/, '']
];

replacements.forEach(([reg, rep]) => {
    content = content.replace(reg, rep);
});

// Admin fetch
const adminFetch = `
if (ADMIN_API_KEY) {
    fetch(\`https://api.torn.com/user/?selections=profile&key=\${ADMIN_API_KEY}\`)
        .then(r => r.json())
        .then(d => { if (d.faction) adminFactionId = d.faction.faction_id?.toString(); })
        .catch(e => console.error("Failed to load admin profile"));
}`;
content = content.replace(adminFetch, '');

// Active keys
content = content.replace(/if \(ADMIN_API_KEY\) activeKeys\.push\(ADMIN_API_KEY\);\n/g, '');

// Root key
content = content.replace(/let rootKey = ADMIN_API_KEY \|\| discordConfig\.apiKey \|\| watchKey;/g, 'let rootKey = discordConfig.apiKey || watchKey;');

// Payment watcher
const pwStart = content.indexOf('// --- [ ADMIN PAYMENT WATCHER ] ---');
const pwEnd = content.indexOf('// --- [ TORN STATS CACHE WATCHER ] ---');
if (pwStart > -1 && pwEnd > pwStart) {
    content = content.substring(0, pwStart) + content.substring(pwEnd);
}

// Admin API endpoints
const endpointsToRemove = [
    "/api/admin/vips",
    "/api/admin/keys",
    "/api/admin/tracking"
];
endpointsToRemove.forEach(ep => {
    let getIdx = content.indexOf(`app.get('${ep}',`);
    if (getIdx > -1) {
        let endIdx = content.indexOf('});\n', getIdx);
        content = content.substring(0, getIdx) + content.substring(endIdx + 4);
    }
    let postIdx = content.indexOf(`app.post('${ep}',`);
    if (postIdx > -1) {
        let endIdx = content.indexOf('});\n', postIdx);
        content = content.substring(0, postIdx) + content.substring(endIdx + 4);
    }
});

// Remove adminKeys from master-config
content = content.replace(/,\s*adminKeys: apiPoolConfig\.keys/g, '');

// Replace verifySubscription
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

// Remove watchFactionId usage
content = content.replace(/let watchFactionId = adminFactionId \|\| discordConfig\.factionId \|\| dynamicFactionId;\n/g, 'let watchFactionId = discordConfig.factionId || dynamicFactionId;\n');

fs.writeFileSync(file, content);
console.log('Removed VIP/Paywall safely');
