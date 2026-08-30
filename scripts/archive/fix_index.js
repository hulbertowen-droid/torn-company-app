const fs = require('fs');

let file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let html = fs.readFileSync(file, 'utf8');

const danglingBlock = /\s*try \{\s*const res = await fetch\('\/api\/save-war', \{[\s\S]*?showToast\("Network error while saving war\.", "red"\);\s*\}/;
html = html.replace(danglingBlock, '');

fs.writeFileSync(file, html);
console.log('Fixed index.html syntax error');
