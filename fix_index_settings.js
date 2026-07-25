const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let content = fs.readFileSync(file, 'utf8');

// Remove global toggles from openSettings()
content = content.replace(/let globalTgs = JSON\.parse\(localStorage\.getItem\("warboard_globalToggles"\) \|\| '\{"chain":true,"target":true,"sniper":true\}'\);\s*document\.getElementById\("global-chain"\)\.checked = globalTgs\.chain;\s*document\.getElementById\("global-target"\)\.checked = globalTgs\.target;\s*document\.getElementById\("global-sniper"\)\.checked = globalTgs\.sniper;/, '');

// Remove global toggles from saveSettings()
content = content.replace(/let globalToggles = \{\s*chain: document\.getElementById\("global-chain"\)\.checked,\s*target: document\.getElementById\("global-target"\)\.checked,\s*sniper: document\.getElementById\("global-sniper"\)\.checked\s*\};\s*/, '');
content = content.replace(/localStorage\.setItem\("warboard_globalToggles", JSON\.stringify\(globalToggles\)\);\s*/, '');
content = content.replace(/globalToggles: globalToggles/, '');
content = content.replace(/,\s*\}/g, '}'); // clean up trailing comma from the JSON body if any

fs.writeFileSync(file, content);
console.log('Fixed index.html openSettings crashing');
