const fs = require('fs');
const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let content = fs.readFileSync(file, 'utf8');

// Replace everything from `let discordId = document.getElementById("discord-userid").value.trim();` up to `} catch(e) {}` where it calls `/api/save-user-profile`

const regex = /let discordId = document\.getElementById\("discord-userid"\)\.value\.trim\(\);[\s\S]*?fetch\('\/api\/save-user-profile'[\s\S]*?\}\s*catch\(e\) \{\}/m;
content = content.replace(regex, '');

fs.writeFileSync(file, content);
console.log('Fixed saveSettings in index.html');
