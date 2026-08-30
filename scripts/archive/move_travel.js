const fs = require('fs');
const path = require('path');

const publicDir = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public';
const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

for (const file of htmlFiles) {
    let filePath = path.join(publicDir, file);
    let html = fs.readFileSync(filePath, 'utf8');
    
    // First remove it anywhere it exists (especially from company.html)
    html = html.replace(/<a href="(\/?)travel\.html" class="nav-link">.*?Travel.*?<\/a>\s*(<div class="nav-divider"><\/div>)?\s*/g, '');
    
    // Now insert it into the Faction Tools section before Bazaar Watcher
    if (!html.includes('travel.html')) {
        html = html.replace(/(<a href="\/bazaar\.html")/, '<a href="/travel.html" class="nav-link">✈️ <span class="nav-text">Travel Calculator</span></a>\n            $1');
    }
    
    fs.writeFileSync(filePath, html);
}
console.log('Travel link relocated');
