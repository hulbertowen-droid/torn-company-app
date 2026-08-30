const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

// Split into lines
let lines = content.split(/\r?\n/);

// Let's verify line contents first to make sure they are what we expect
console.log('Line 456:', lines[455]);
console.log('Line 460:', lines[459]);

if (lines[455].includes('dynamicFactionId') && lines[459].includes('torn.com/faction/')) {
    // Replace them
    lines[455] = '    let watchFactionId = adminFactionId || discordConfig.factionId;';
    lines[459] = '        const facRes = await fetch(`https://api.torn.com/faction/${watchFactionId}?selections=basic,chain,rankedwars&key=${watchKey}`);';
    
    fs.writeFileSync(file, lines.join('\n'));
    console.log('Successfully replaced background watcher by line numbers');
} else {
    console.log('Line contents did not match expected values. Search dynamically instead.');
    
    // Fallback: search and replace line-by-line
    let modified = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('let watchFactionId = adminFactionId || discordConfig.factionId || dynamicFactionId;')) {
            lines[i] = '    let watchFactionId = adminFactionId || discordConfig.factionId;';
            modified = true;
        }
        if (lines[i].includes('const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,chain,rankedwars&key=${watchKey}`);')) {
            lines[i] = '        const facRes = await fetch(`https://api.torn.com/faction/${watchFactionId}?selections=basic,chain,rankedwars&key=${watchKey}`);';
            modified = true;
        }
    }
    if (modified) {
        fs.writeFileSync(file, lines.join('\n'));
        console.log('Successfully replaced background watcher dynamically');
    } else {
        console.log('Dynamic search also failed.');
    }
}
