const fs = require('fs');
let file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

const danglingDeleteWar = /\s*try \{\s*fs\.writeFileSync\('war_history\.json', JSON\.stringify\(warHistory, null, 4\)\);\s*\} catch \(err\) \{\}\s*res\.json\(\{ success: true \}\);\s*\}\);/g;
content = content.replace(danglingDeleteWar, '');

fs.writeFileSync(file, content);
console.log('Fixed hanging delete war');
