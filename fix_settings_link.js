const fs = require('fs');
const path = require('path');

const publicDir = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public';

const redirectFiles = [
    'bazaar.html',
    'chain.html',
    'dashboard.html',
    'discord.html',
    'gamble.html',
    'payout.html',
    'recruitment.html',
    'travel.html'
];

redirectFiles.forEach(file => {
    let filePath = path.join(publicDir, file);
    if (!fs.existsSync(filePath)) return;
    
    let html = fs.readFileSync(filePath, 'utf8');
    
    // Replace all instances of onclick="openSettings()" with onclick="window.location.href='/'"
    // Also replace href="/index.html?openSettings=true" just in case
    html = html.replace(/onclick="openSettings\(\)"/g, 'onclick="window.location.href=\'/\'"');
    
    fs.writeFileSync(filePath, html);
});

console.log('Fixed Settings link on all subpages');
