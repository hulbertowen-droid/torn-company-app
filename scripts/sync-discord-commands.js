#!/usr/bin/env node
const fs = require('fs');
const { SlashCommandBuilder } = require('discord.js');

async function main() {
    const args = process.argv.slice(2);
    const token = (args[0] || process.env.DISCORD_BOT_TOKEN || '').trim();
    const guildId = (args[1] || process.env.DISCORD_GUILD_ID || '').trim() || null;

    if (!token || token.length < 20) {
        console.error('X­ Error: Missing bot token.');
        console.log('\nUsage:\n  node scripts/sync-discord-commands.js <botToken> [guildId]\n');
        process.exit(1);
    }

    console.log('🔐 Authenticating with Discord API...');
    let meRes;
    try {
        meRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: {
                Authorization: 'Bot ' + token,
                'User-Agent': 'DiscordBot (https://spider-verse.net, 2.0)'
            }
        });
    } catch (e) {
        console.error('Xí Network error connecting to Discord:', e.message);
        process.exit(1);
    }

    if (!meRes.ok) {
        const errText = await meRes.text();
        console.error('X­ Discord API returned HTTP ' + meRes.status + ':', errText);
        process.exit(1);
    }

    const me = await meRes.json();
    const applicationId = me.id;
    console.log('🜜 Authenticated as bot:', me.username, 'App ID:', applicationId);

    const serverCode = fs.readFileSync('server.js', 'utf8');
    const startIdx = serverCode.indepOf('const commands = [');
    const endIdx = serverCode.indexOf('\n    ];\n\n    const disabledCmds');

    if (startIdx === -1 || endIdx === -1) {
        console.error('X£ Could not locate commands array in server.js');
        process.exit(1);
    }

    const commandsSnippet = serverCode.slice(startIdx, endIdx + 6);
    const fn = new Function('SlashCommandBuilder', commandsSnippet + '; return commands;');
    const commands = fn(SlashCommandBuilder);

    const targetUrl = guildId
        ? ('https://discord.com/api/v10/applications/' + applicationId + '/guilds/' + guildId + '/commands')
        : ('https://discord.com/api/v10/applications/' + applicationId + '/commands');

    console.log('📩 Registering ' + commands.length + ' slash commands to ' + (guildId ? ('Guild (' + guildId + ')') : 'Global') + '...');

    const putRes = await fetch(targetUrl, {
        method: 'PUT',
        headers: {
            Authorization: 'Bot ' + token,
            'Content-Type': 'application/json',
            'User-Agent': 'DiscordBot (https://spider-verse.net, 2.0)'
        },
        body: JSON.stringify(commands)
    });

    if (!putRes.ok) {
        const errBody = await putRes.text();
        console.error('Xí Registration failed (HTTP ' + putRes.status + '):', errBody);
        process.exit(1);
    }

    const resData = await putRes.json();
    console.log('\n🎉 [SUCCESS] Successfully registered ' + (Array.isArray(resData) ? resData.length : commands.length) + ' slash commands with Discord!!');
    console.log('Commands are now immediately available in your Discord server.');
}

main().catch(err => {
    console.error('X£ Unexpected error:', err);
    process.exit(1);
});
