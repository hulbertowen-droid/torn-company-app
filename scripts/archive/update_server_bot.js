const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

const botLogic = `
// --- Discord Bot Integration ---
const { Client, GatewayIntentBits } = require('discord.js');
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });

let botConfig = { token: process.env.DISCORD_BOT_TOKEN || "" };
try { if (fs.existsSync('bot_config.json')) botConfig = { ...botConfig, ...JSON.parse(fs.readFileSync('bot_config.json')) }; } catch(e) {}
function saveBotConfig() { fs.writeFileSync('bot_config.json', JSON.stringify(botConfig)); }

discordClient.on('ready', () => {
    console.log(\`[Discord Bot] Logged in as \${discordClient.user.tag}!\`);
});

if (botConfig.token) {
    discordClient.login(botConfig.token).catch(e => console.log("[Discord Bot] Failed to login:", e.message));
}

async function sendPrivateDM(userId, embedData) {
    if (!botConfig.token || !discordClient.isReady()) return;
    try {
        const user = await discordClient.users.fetch(userId);
        if (user) {
            await user.send({ embeds: [embedData] });
        }
    } catch (e) {
        console.error(\`[Discord Bot] Failed to send DM to \${userId}:\`, e.message);
    }
}
// -------------------------------
`;

// Insert after the required packages
content = content.replace(/(const fetch = require\('node-fetch'\);)/, "$1\n" + botLogic);

fs.writeFileSync(file, content);
console.log('Injected Discord bot logic into server.js');
