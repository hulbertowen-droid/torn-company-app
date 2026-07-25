const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Fix the warboard endpoint (around line 1115) to use the client's own userKey instead of activeKey (rotated key)
// Look for:
// let activeKey = getNextApiKey() || userKey;
// let [myData, enemyDataResult] = await Promise.all([
//     fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${activeKey}`).then(r => r.json()).catch(() => ({ members: {} })),

content = content.replace(
    /let activeKey = getNextApiKey\(\) \|\| userKey;\s*let \[myData, enemyDataResult\] = await Promise\.all\(\[\s*fetch\(`https:\/\/api\.torn\.com\/faction\/\?selections=basic,rankedwars&key=\${activeKey}`\)/,
    'let activeKey = userKey;\n        let [myData, enemyDataResult] = await Promise.all([\n            fetch(`https://api.torn.com/faction/?selections=basic,rankedwars&key=${userKey}`)'
);

// 2. Fix the runBackgroundWarboardWatcher to use discordConfig.apiKey and include watchFactionId in the URL
// Old code:
//     let watchKey = getNextApiKey();
//     let watchFactionId = adminFactionId || discordConfig.factionId || dynamicFactionId;
//     if (!watchKey || !watchFactionId) return;
// 
//     try {
//         const liveRes = await fetch(`https://api.torn.com/faction/?selections=attacks,basic,rankedwars&key=${watchKey}`);

content = content.replace(
    /let watchKey = getNextApiKey\(\);\s*let watchFactionId = adminFactionId \|\| discordConfig\.factionId \|\| dynamicFactionId;\s*if \(!watchKey \|\| !watchFactionId\) return;\s*try \{\s*const liveRes = await fetch\(`https:\/\/api\.torn\.com\/faction\/\?selections=attacks,basic,rankedwars&key=\${watchKey}`\);/,
    `let watchFactionId = adminFactionId || discordConfig.factionId;
    let watchKey = discordConfig.apiKey || TORN_API_KEY;
    if (!watchKey || !watchFactionId) return;

    try {
        const liveRes = await fetch(\`https://api.torn.com/faction/\${watchFactionId}?selections=attacks,basic,rankedwars&key=\${watchKey}\`);`
);

// Also backfillWarDefends inside runBackgroundWarboardWatcher
content = content.replace(
    /const res = await fetch\(`https:\/\/api\.torn\.com\/faction\/\?selections=attacks&to=\${toTimestamp}&key=\${watchKey}`\);/,
    'const res = await fetch(`https://api.torn.com/faction/${watchFactionId}?selections=attacks&to=${toTimestamp}&key=${watchKey}`);'
);


// 3. Fix the runBackgroundFactionWatcher to use watchFactionId in the URL and remove dynamicFactionId dependency
// Old code:
//     let watchKey = getNextApiKey();
//     let watchFactionId = adminFactionId || discordConfig.factionId || dynamicFactionId;
//     if (!watchKey || !watchFactionId) return;
// 
//     try {
//         const facRes = await fetch(`https://api.torn.com/faction/?selections=basic,chain,rankedwars&key=${watchKey}`);

content = content.replace(
    /async function runBackgroundFactionWatcher\(\) \{\s*let watchKey = getNextApiKey\(\);\s*let watchFactionId = adminFactionId \|\| discordConfig\.factionId \|\| dynamicFactionId;\s*if \(!watchKey \|\| !watchFactionId\) return;\s*try \{\s*const facRes = await fetch\(\`https:\/\/api\.torn\.com\/faction\/\?selections=basic,chain,rankedwars&key=\\ watchKey\}\`\);/,
    `async function runBackgroundFactionWatcher() {
    let watchKey = getNextApiKey();
    let watchFactionId = adminFactionId || discordConfig.factionId;
    if (!watchKey || !watchFactionId) return;

    try {
        const facRes = await fetch(\`https://api.torn.com/faction/\${watchFactionId}?selections=basic,chain,rankedwars&key=\${watchKey}\`);`
);

// Fallback regex match for Faction Watcher if formatting slightly differed
const oldWatcherBlock = `let watchKey = getNextApiKey();
    let watchFactionId = adminFactionId || discordConfig.factionId || dynamicFactionId;
    if (!watchKey || !watchFactionId) return;

    try {
        const facRes = await fetch(\`https://api.torn.com/faction/?selections=basic,chain,rankedwars&key=\${watchKey}\`);`;

const newWatcherBlock = `let watchKey = getNextApiKey();
    let watchFactionId = adminFactionId || discordConfig.factionId;
    if (!watchKey || !watchFactionId) return;

    try {
        const facRes = await fetch(\`https://api.torn.com/faction/\${watchFactionId}?selections=basic,chain,rankedwars&key=\${watchKey}\`);`;

if (content.includes(oldWatcherBlock)) {
    content = content.replace(oldWatcherBlock, newWatcherBlock);
}

fs.writeFileSync(file, content);
console.log('Fixed security and privacy leaks');
