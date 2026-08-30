const fs = require('fs');
const path = require('path');

const publicDir = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public';
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

files.forEach(file => {
    if (file === 'index.html') return;

    let filePath = path.join(publicDir, file);
    let html = fs.readFileSync(filePath, 'utf8');

    // Replace the exact string
    html = html.replace(/onclick="window\.location\.href='\/'"/g, 'onclick="openGlobalSettings()"');
    
    // Also handle the edge case where it might just say onclick="openSettings()" from a failed previous pass
    html = html.replace(/<a onclick="openSettings\(\)"/g, '<a onclick="openGlobalSettings()"');

    fs.writeFileSync(filePath, html);
});

console.log('Fixed Settings link string replacement');
