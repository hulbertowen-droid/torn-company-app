// Adds "Recruit Platform" nav link to all HTML pages in public/
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

const insertAfter = `href="/recruitment.html" class="nav-link"`;
const newLink = `\n            <a href="http://localhost:4000" target="_blank" class="nav-link" style="background:rgba(0,206,201,0.08);border:1px solid rgba(0,206,201,0.2);color:var(--teal);">🎯 <span class="nav-text">Recruit Platform</span></a>`;

let count = 0;
for (const file of files) {
    const fp = path.join(publicDir, file);
    let content = fs.readFileSync(fp, 'utf8');

    // Skip if already added
    if (content.includes('Recruit Platform')) {
        console.log(`[SKIP] ${file} — already has Recruit Platform link`);
        continue;
    }

    // Find the recruitment.html nav link and insert after the closing </a>
    const marker = `href="/recruitment.html"`;
    const idx = content.indexOf(marker);
    if (idx === -1) {
        console.log(`[SKIP] ${file} — no recruitment nav found`);
        continue;
    }

    // Find closing </a> after the marker
    const closeTag = content.indexOf('</a>', idx);
    if (closeTag === -1) continue;

    content = content.slice(0, closeTag + 4) + newLink + content.slice(closeTag + 4);
    fs.writeFileSync(fp, content, 'utf8');
    console.log(`[DONE] ${file}`);
    count++;
}

console.log(`\nAdded Recruit Platform nav link to ${count} files.`);
