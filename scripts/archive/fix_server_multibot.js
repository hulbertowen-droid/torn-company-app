const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

const multiBotLogic = `
// --- MULTI-TENANT DISCORD BOTS & USERS ---
const { Client, GatewayIntentBits } = require('discord.js');
let activeDiscordBots = {}; 
let userDatabase = {};

try { if (fs.existsSync('user_database.json')) userDatabase = JSON.parse(fs.readFileSync('user_database.json')); } catch(e) {}
function saveUserDatabase() { fs.writeFileSync('user_database.json', JSON.stringify(userDatabase)); }

async function getDiscordClient(token) {
    if (!token) return null;
    if (activeDiscordBots[token] && activeDiscordBots[token].isReady()) return activeDiscordBots[token];
    if (activeDiscordBots[token]) return null; 
    
    try {
        const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });
        activeDiscordBots[token] = client; 
        await client.login(token);
        console.log(\`[Discord Bot] Logged in successfully for token ending in ...\${token.slice(-4)}\`);
        return client;
    } catch (e) {
        console.error(\`[Discord Bot] Failed to login:\`, e.message);
        delete activeDiscordBots[token];
        return null;
    }
}

Object.values(userDatabase).forEach(profile => {
    if (profile.botToken) getDiscordClient(profile.botToken);
});

async function sendPrivateDM(token, userId, embedData) {
    const client = await getDiscordClient(token);
    if (!client) return;
    try {
        const user = await client.users.fetch(userId);
        if (user) await user.send({ embeds: [embedData] });
    } catch (e) {
        console.error(\`[Discord Bot] Failed to send DM to \${userId}:\`, e.message);
    }
}

app.post('/api/save-user-profile', (req, res) => {
    const { apiKey, discordId, botToken, attackThreshold, alertToggles } = req.body;
    if (!apiKey) return res.status(400).json({ error: "Missing API Key" });

    if (!apiPoolConfig.keys.includes(apiKey)) {
        apiPoolConfig.keys.push(apiKey);
        saveApiPool();
    }

    userDatabase[apiKey] = {
        discordId: discordId || "",
        botToken: botToken || "",
        attackThreshold: parseInt(attackThreshold) || 3,
        alertToggles: alertToggles || { attack: true, undercut: true, chain: true },
        lastAttackAlert: userDatabase[apiKey]?.lastAttackAlert || 0
    };
    saveUserDatabase();
    
    if (botToken) getDiscordClient(botToken);

    res.json({ success: true });
});

app.get('/api/get-user-profile', (req, res) => {
    const key = req.query.apiKey;
    if (!key || !userDatabase[key]) return res.json({});
    res.json(userDatabase[key]);
});

let lastKnownAttackId = {};
setInterval(async () => {
    for (let [apiKey, profile] of Object.entries(userDatabase)) {
        if (!profile.botToken || !profile.discordId || !profile.alertToggles?.attack) continue;
        
        if (Date.now() - (profile.lastAttackAlert || 0) < 30 * 60 * 1000) continue;

        try {
            const res = await fetch(\`https://api.torn.com/user/?selections=attacks,profile&key=\${apiKey}\`);
            const data = await res.json();
            
            if (data.error || !data.attacks) continue;
            
            let isSitting = (data.profile && (data.profile.status.state === "Online" || data.profile.status.state === "Idle"));
            if (!isSitting) continue; 

            let recentLosses = 0;
            let fifteenMinsAgo = (Date.now() / 1000) - (15 * 60);
            let latestAttackId = 0;

            for (let [attackId, attack] of Object.entries(data.attacks)) {
                let aIdNum = parseInt(attackId);
                if (aIdNum > latestAttackId) latestAttackId = aIdNum;

                if (attack.defender_id === data.profile.player_id && attack.timestamp_ended > fifteenMinsAgo) {
                    if (attack.result === "Hospitalized" || attack.result === "Lost" || attack.result === "Mugged" || attack.result === "Escape") {
                        recentLosses++;
                    }
                }
            }

            if (!lastKnownAttackId[apiKey]) {
                lastKnownAttackId[apiKey] = latestAttackId;
                continue; 
            }

            if (recentLosses >= profile.attackThreshold && latestAttackId > lastKnownAttackId[apiKey]) {
                lastKnownAttackId[apiKey] = latestAttackId;
                profile.lastAttackAlert = Date.now();
                saveUserDatabase();

                sendPrivateDM(profile.botToken, profile.discordId, {
                    title: "🚨 UNDER ATTACK IN TORN",
                    description: \`You are currently online but have suffered **\${recentLosses}** defeats in the last 15 minutes!\\n\\nYou might want to hospitalize yourself, travel, or equip better armor!\`,
                    color: 16711680,
                    timestamp: new Date().toISOString()
                });
            }
        } catch(e) {}
        
        await new Promise(r => setTimeout(r, 1000));
    }
}, 60000);
// ---------------------------------------------
`;

// Insert the multi-bot logic immediately before the final app.listen call
if (!content.includes('/api/save-user-profile')) {
    const listenIndex = content.lastIndexOf('app.listen');
    content = content.substring(0, listenIndex) + multiBotLogic + "\n" + content.substring(listenIndex);
}

// Ensure undercut alerting triggers Discord Bot if enabled
const undercutReplace = `
                        if (lowestMarketPrice < myItem.price) {
                            if (marketMemory.defense[itemId] !== lowestMarketPrice) {
                                marketMemory.defense[itemId] = lowestMarketPrice;
                                
                                let embed = {
                                    title: "📉 Market Undercut Alert",
                                    description: \`Your \\\`\${myItem.name}\\\` ($$\${myItem.price.toLocaleString()}) was undercut!\\nNew lowest price: **$$\${lowestMarketPrice.toLocaleString()}**\`,
                                    color: 16729943,
                                    links: [{ label: "🛒 Check Market", url: \`https://www.torn.com/imarket.php#/p=shop&step=shop&type=&searchname=\${myItem.name}\` }]
                                };
                                
                                let profile = userDatabase[rootKey];
                                if (profile && profile.botToken && profile.discordId && profile.alertToggles?.undercut) {
                                    sendPrivateDM(profile.botToken, profile.discordId, embed);
                                } else if (marketConfig.webhookUrl) {
                                    sendDiscordEmbed(marketConfig.webhookUrl, embed);
                                }
                            }
                        }
`;

// Replace the old undercut block
const oldUndercutRegex = /if \(lowestMarketPrice < myItem\.price\) \{[\s\S]*?sendDiscordEmbed\(marketConfig\.webhookUrl, \{[\s\S]*?\}\);\s*\}\s*\}/m;
if (!content.includes('sendPrivateDM(profile.botToken')) {
    content = content.replace(oldUndercutRegex, undercutReplace.trim());
}

fs.writeFileSync(file, content);
console.log('Fixed missing daemon in server.js');
