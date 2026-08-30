const fs = require('fs');
const path = require('path');

// 1. Update index.html
const indexFile = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let indexHtml = fs.readFileSync(indexFile, 'utf8');

indexHtml = indexHtml.replace(
    /<label>API Key \(Hidden for Privacy\)<\/label>/,
    '<label>API Key (Requires "Limited" Access & Faction Permissions)</label>'
);

fs.writeFileSync(indexFile, indexHtml);

// 2. Update global_settings.js
const gsFile = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/global_settings.js';
let gsContent = fs.readFileSync(gsFile, 'utf8');

gsContent = gsContent.replace(
    /<label>API Key \(Hidden for Privacy\)<\/label>/,
    '<label>API Key (Requires "Limited" Access & Faction Permissions)</label>'
);

fs.writeFileSync(gsFile, gsContent);

console.log('Added API key requirements label');
