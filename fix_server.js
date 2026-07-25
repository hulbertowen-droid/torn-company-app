const fs = require('fs');

let file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

// Replace the hanging block
const hangingBlock = /\s*try \{\s*const facRes = await fetch\(`https:\/\/api\.torn\.com\/faction\/\?selections=basic,stats&key=\$\{userKey\}`\);[\s\S]*?res\.status\(500\)\.json\(\{ error: "Failed to fetch faction report" \}\);\s*\}\s*\}\);/g;
content = content.replace(hangingBlock, '');

// Verify if there are other hanging blocks
const hangingSaveWar = /\s*let warHistory = \[\];[\s\S]*?fs\.writeFileSync\('war_history\.json', JSON\.stringify\(warHistory, null, 2\)\);\s*res\.json\(\{ success: true \}\);\s*\} catch \(e\) \{\s*res\.status\(500\)\.json\(\{ error: 'Failed to save war to archive' \}\);\s*\}\s*\}\);/g;
content = content.replace(hangingSaveWar, '');

const hangingWarHistory = /\s*let warHistory = \[\];[\s\S]*?res\.json\(\{ warHistory \}\);\s*\}\);/g;
content = content.replace(hangingWarHistory, '');

fs.writeFileSync(file, content);
console.log('Fixed server.js hanging blocks');
