const fs = require('fs');
const path = require('path');

// 1. Clean server.js
let serverJsPath = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let serverJs = fs.readFileSync(serverJsPath, 'utf8');

// Remove war-history and save-war endpoints
serverJs = serverJs.replace(/app\.get\('\/api\/war-history'[\s\S]*?\}\);/g, '');
serverJs = serverJs.replace(/app\.post\('\/api\/save-war'[\s\S]*?\}\);/g, '');

// Remove faction-report endpoint
serverJs = serverJs.replace(/app\.get\('\/api\/faction-report'[\s\S]*?\}\);/g, '');

// Remove auto archiver loop from wall watcher
const archiverRegex = /else \{ \s*if \(activeWarId\) \{[\s\S]*?activeWarId = null; hasBackfilledWar = false; \s*\}/;
serverJs = serverJs.replace(archiverRegex, 'else { activeWarId = null; hasBackfilledWar = false; }');

fs.writeFileSync(serverJsPath, serverJs);

// 2. Clean HTML sidebars
const publicDir = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public';
const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html') && f !== 'report.html' && f !== 'warhistory.html');

for (const file of htmlFiles) {
    let filePath = path.join(publicDir, file);
    let html = fs.readFileSync(filePath, 'utf8');
    
    // Remove Activity Report link
    html = html.replace(/<a href="\/report\.html" class="nav-link">.*?Activity Report.*?<\/a>/g, '');
    
    // Remove War History link
    html = html.replace(/<a href="\/warhistory\.html" class="nav-link">.*?War History.*?<\/a>/g, '');

    // Add Casino Tools link (replace old War History or Activity Report place or add after Company Tools)
    if (!html.includes('gamble.html')) {
        // Insert it right before Settings
        html = html.replace(/(<a onclick="openSettings\(\)")/, '<a href="/gamble.html" class="nav-link">🎰 <span class="nav-text">Casino Tools</span></a>\n            $1');
    }
    
    fs.writeFileSync(filePath, html);
}

// 3. Remove index.html save war button
let indexHtmlPath = path.join(publicDir, 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
indexHtml = indexHtml.replace(/<button[^>]*onclick="openSaveWarModal\(\)"[^>]*>Save War to Archive<\/button>/g, '');
indexHtml = indexHtml.replace(/function openSaveWarModal\(\) \{[\s\S]*?function closeSaveWarModal\(\) \{[\s\S]*?async function saveWarToArchive\(\) \{[\s\S]*?\}/, '');
fs.writeFileSync(indexHtmlPath, indexHtml);

console.log('Cleanup complete');
