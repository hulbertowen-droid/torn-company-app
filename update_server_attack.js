const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

const userDbLogic = `
let userDatabase = {};
try { if (fs.existsSync('user_database.json')) userDatabase = JSON.parse(fs.readFileSync('user_database.json')); } catch(e) {}
function saveUserDatabase() { fs.writeFileSync('user_database.json', JSON.stringify(userDatabase)); }

app.post('/api/save-user-profile', async (req, res) => {
    const { apiKey, discordId, attackThreshold } = req.body;
    if (!apiKey) return res.status(400).json({ error: "Missing API Key" });

    if (!apiPoolConfig.keys.includes(apiKey)) {
        apiPoolConfig.keys.push(apiKey);
        saveApiPool();
    }

    userDatabase[apiKey] = {
        discordId: discordId || "",
        attackThreshold: parseInt(attackThreshold) || 3,
        lastAttackAlert: 0
    };
    saveUserDatabase();
    res.json({ success: true });
});

app.get('/api/get-user-profile', (req, res) => {
    const key = req.query.apiKey;
    if (!key || !userDatabase[key]) return res.json({});
    res.json(userDatabase[key]);
});

// Attack Watcher Background Task
let lastKnownAttackId = {};
setInterval(async () => {
    if (!botConfig.token || !discordClient.isReady()) return;

    for (let [apiKey, profile] of Object.entries(userDatabase)) {
        if (!profile.discordId) continue;
        
        // Cooldown: Don't alert more than once every 30 minutes
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

                sendPrivateDM(profile.discordId, {
                    title: "🚨 UNDER ATTACK IN TORN",
                    description: \`You are currently online but have suffered **\${recentLosses}** defeats in the last 15 minutes!\\n\\nYou might want to hospitalize yourself, travel, or equip better armor!\`,
                    color: 16711680,
                    timestamp: new Date().toISOString()
                });
            }
        } catch(e) { console.error("Attack watcher error:", e.message); }
        
        await new Promise(r => setTimeout(r, 1000)); 
    }
}, 60000);
`;

content = content.replace(/(app\.listen\([^\)]+\);)/, userDbLogic + "\n$1");

fs.writeFileSync(file, content);
console.log('Injected Attack Watcher logic into server.js');
