// Fix corrupted emojis in all HTML sidebar nav sections
// and add the OC Manager link properly

const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

// The correct sidebar nav block for each page
function buildNav(activePage) {
    const links = [
        { href: '/', emoji: '📡', text: 'Live Warboard', page: 'index.html' },
        { href: '/chain.html', emoji: '🔗', text: 'Chain Watcher', page: 'chain.html' },
        { href: '/payout.html', emoji: '💰', text: 'Payouts', page: 'payout.html' },
        { href: '/dashboard.html', emoji: '🛡️', text: 'Dashboard', page: 'dashboard.html' },
        { href: '/recruitment.html', emoji: '🎯', text: 'Recruitment', page: 'recruitment.html' },
        { href: '/bazaar.html', emoji: '🛒', text: 'Bazaar Watcher', page: 'bazaar.html' },
        { href: '/discord.html', emoji: '📢', text: 'Discord Alerts', page: 'discord.html' },
        { href: '/admin.html', emoji: '👑', text: 'Admin Panel', page: 'admin.html' },
        { href: '/oc.html', emoji: '💼', text: 'OC Manager', page: 'oc.html' },
    ];

    let html = '';
    for (const link of links) {
        const isActive = (activePage === 'index.html' && link.href === '/') ||
                         (activePage !== 'index.html' && link.href === '/' + activePage);
        const cls = isActive ? 'nav-link active' : 'nav-link';
        html += `            <a href="${link.href}" class="${cls}">${link.emoji} <span class="nav-text">${link.text}</span></a>\n`;
    }
    return html;
}

for (const file of htmlFiles) {
    const filePath = path.join(publicDir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Find the nav-items div and replace its contents
    // Pattern: <div class="nav-items"> ... settings link ... </div>
    const navStart = content.indexOf('<div class="nav-items">');
    if (navStart === -1) {
        console.log(`Skipping ${file} - no nav-items found`);
        continue;
    }

    // Find the settings link (it's always the last nav item before </div>)
    const settingsPattern = /<a\s+onclick="openSettings\(\)"/;
    const settingsMatch = content.substring(navStart).match(settingsPattern);
    if (!settingsMatch) {
        console.log(`Skipping ${file} - no settings link found`);
        continue;
    }
    const settingsStart = navStart + settingsMatch.index;

    // Find the closing </div> for nav-items after the settings link
    const afterSettings = content.indexOf('</a>', settingsStart);
    const navEndSearch = content.indexOf('</div>', afterSettings);

    // Extract settings link (keep it as-is since it doesn't have emojis that broke)
    // Actually, the settings emoji may also be broken, let's rebuild it
    const settingsLink = `            <a onclick="openSettings()" class="nav-link" style="margin-top: 15px; border-top: 1px solid #2f3542; border-radius: 0; padding-top: 15px; cursor: pointer;">\n                ⚙️ <span class="nav-text">Settings</span>\n            </a>\n`;

    // Build the new nav content
    const navContent = buildNav(file);

    // Replace everything between <div class="nav-items"> and its closing </div>
    const before = content.substring(0, navStart);
    const after = content.substring(navEndSearch);

    content = before + '<div class="nav-items">\n' + navContent + settingsLink + '        ' + after;

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed ${file}`);
}

console.log('Done! All sidebar navs fixed with proper emojis and OC Manager link.');
