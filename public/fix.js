const fs = require('fs');
let html = fs.readFileSync('C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html', 'utf8');

const badPartRegex = /catch\(e\) \{\s*return \{ fullClass: [\s\S]*?async function saveManualSpy\(targetId\) \{[\s\S]*?catch\(e\) \{\s*status\.style\.color = "var\(--red\)";\s*status\.innerText = ".*?Server communication failed\.";\s*\}\s*\}/;

if (badPartRegex.test(html)) {
    html = html.replace(badPartRegex, 'catch(e) {\n        status.style.color = "var(--red)";\n        status.innerText = "❌ Server communication failed.";\n    }\n}');
    fs.writeFileSync('C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html', html);
    console.log('Fixed syntax error and removed duplication.');
} else {
    console.log('Could not find the duplicated block.');
}
