const fs = require('fs');
const path = require('path');

const files = [
    'chain.html', 'payout.html', 'members.html', 'recruitment.html', 
    'travel.html', 'bazaar.html', 'oc.html', 'gamble.html', 'company.html'
];

const publicDir = path.join(__dirname, 'public');

for (const file of files) {
    const filePath = path.join(publicDir, file);
    if (!fs.existsSync(filePath)) continue;

    let html = fs.readFileSync(filePath, 'utf8');

    // Inject global.css if not present
    if (!html.includes('global.css')) {
        html = html.replace('<style>', '<link rel="stylesheet" href="/global.css">\n    <style>');
    }

    // Remove redundant blocks
    // 1. :root and scrollbars
    html = html.replace(/\s*:root\s*\{[\s\S]*?::-webkit-scrollbar-thumb:hover\s*\{[^\}]+\}/, '');
    
    // 2. body
    html = html.replace(/\s*body\s*\{[^}]+\}/, '');

    // 3. sidebar
    html = html.replace(/\s*\.sidebar\s*\{[\s\S]*?\.sidebar\.collapsed\s*\.nav-text\s*\{[^\}]+\}/, '');

    // 4. theme inject at bottom
    html = html.replace(/\s*\/\*\s*Theme\s*&\s*Mobile\s*Inject\s*\*\/[\s\S]*?\}\s*<\/style>/, '\n    </style>');

    fs.writeFileSync(filePath, html, 'utf8');
    console.log('Fixed', file);
}
