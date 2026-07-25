const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

// Find the block using regex to handle \\r\\n or \\n
const regex = /\/\/ Background Task 3: Sniper & Target Status Watcher\r?\nsetInterval\(async \(\) => \{\r?\n\s*let watchKey = getNextApiKey\(\);\r?\n\s*let watchFactionId = adminFactionId \|\| discordConfig\.factionId \|\| dynamicFactionId;\r?\n\s*if \(!watchKey \|\| !watchFactionId\) return;\r?\n\r?\n\s*try \{\r?\n\s*const facRes = await fetch\(\`https:\/\/api\.torn\.com\/faction\/\?selections=basic,chain,rankedwars&key=\\\${watchKey}\`\);/;

const replacement = `// Background Task 3: Sniper & Target Status Watcher
setInterval(async () => {
    let watchKey = getNextApiKey();
    let watchFactionId = adminFactionId || discordConfig.factionId;
    if (!watchKey || !watchFactionId) return;

    try {
        const facRes = await fetch(\`https://api.torn.com/faction/\${watchFactionId}?selections=basic,chain,rankedwars&key=\${watchKey}\`);`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(file, content);
    console.log('Successfully updated Background Task 3 with regex');
} else {
    console.log('Regex did not match');
}
