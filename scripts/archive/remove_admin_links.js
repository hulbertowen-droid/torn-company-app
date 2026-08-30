const fs = require('fs');
const path = require('path');

const publicDir = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public';
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

files.forEach(file => {
    let filePath = path.join(publicDir, file);
    let html = fs.readFileSync(filePath, 'utf8');
    
    // Remove admin link lines (works with /admin.html)
    const modifiedHtml = html.replace(/<a[^>]*href="\/admin\.html"[^>]*>.*?<\/a>\s*/gi, '');
    
    if (html !== modifiedHtml) {
        fs.writeFileSync(filePath, modifiedHtml);
        console.log(`Removed admin links from ${file}`);
    }
});
