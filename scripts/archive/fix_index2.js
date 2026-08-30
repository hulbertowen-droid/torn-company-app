const fs = require('fs');

let file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let html = fs.readFileSync(file, 'utf8');

const danglingBrace = /function closeInspect\(\) \{\s*document\.getElementById\('inspect-modal'\)\.style\.display = "none";\s*\}\s*\}/;
const fixedBrace = `function closeInspect() {
    document.getElementById('inspect-modal').style.display = "none";
}`;
html = html.replace(danglingBrace, fixedBrace);

fs.writeFileSync(file, html);
console.log('Fixed extra brace in index.html');
