const fs = require('fs');
const path = require('path');

const makeNavItems = (active) => `        <div class="nav-items">
            <a href="/" class="nav-link ${active==='warboard'?'active':''}">📡 <span class="nav-text">Live Warboard</span></a>
            <a href="/simulator.html" class="nav-link ${active==='simulator'?'active':''}">🧠 <span class="nav-text">Combat Simulator</span></a>
            <a href="/weapons.html" class="nav-link ${active==='weapons'?'active':''}">💎 <span class="nav-text">RW Weapon Appraiser</span></a>
            <a href="/hitman.html" class="nav-link ${active==='hitman'?'active':''}">🎯 <span class="nav-text">Hitman &amp; Whale Radar</span></a>
            <a href="/forensics.html" class="nav-link ${active==='forensics'?'active':''}">🕵️ <span class="nav-text">Attack Forensics</span></a>
            <a href="/chain.html" class="nav-link ${active==='chain'?'active':''}">🔗 <span class="nav-text">Chain Watcher</span></a>
            <a href="/payout.html" class="nav-link ${active==='payout'?'active':''}">💰 <span class="nav-text">Payouts</span></a>
            <a href="/dashboard.html" class="nav-link ${active==='dashboard'?'active':''}">🛡️ <span class="nav-text">Dashboard</span></a>
            <a href="/members.html" class="nav-link ${active==='members'?'active':''}">👥 <span class="nav-text">Members</span></a>
            <a href="/recruit/" class="nav-link ${active==='recruit'?'active':''}">🎯 <span class="nav-text">Recruit Platform</span></a>
            <a href="/travel.html" class="nav-link ${active==='travel'?'active':''}">✈️ <span class="nav-text">Travel Calculator</span></a>
            <a href="/bazaar.html" class="nav-link ${active==='bazaar'?'active':''}">🛒 <span class="nav-text">Bazaar Watcher</span></a>
            <a href="/discord.html" class="nav-link ${active==='discord'?'active':''}">📢 <span class="nav-text">Discord Alerts</span></a>
            <a href="/oc.html" class="nav-link ${active==='oc'?'active':''}">💼 <span class="nav-text">OC Manager</span></a>
            <a href="/oc-optimizer.html" class="nav-link ${active==='oc-optimizer'?'active':''}">📊 <span class="nav-text">OC 2.0 Optimizer</span></a>
            <div style="margin-top: auto; padding: 0 4px;">
                <div style="height:1px; background:var(--border); margin: 10px 0;"></div>
                <div style="font-size:0.65em; color:var(--text-dim); text-transform:uppercase; letter-spacing:2px; padding:0 8px 6px; font-weight:700;">Company</div>
            </div>
            <a href="/company.html" class="nav-link ${active==='company'?'active':''}" style="background:rgba(0,206,201,0.08);border:1px solid rgba(0,206,201,0.25);color:var(--teal);">🏢 <span class="nav-text">Company Tools</span></a>
            <div style="padding: 0 4px; margin-top:8px;"><div style="height:1px; background:var(--border);"></div></div>
            <a href="/gamble.html" class="nav-link ${active==='gamble'?'active':''}">🎰 <span class="nav-text">Casino Tools</span></a>
            <a onclick="openSettings()" class="nav-link" style="cursor:pointer; margin-top:6px;">⚙️ <span class="nav-text">Settings</span></a>
        </div>`;

const filesMap = {
    'index.html': 'warboard',
    'chain.html': 'chain',
    'payout.html': 'payout',
    'dashboard.html': 'dashboard',
    'members.html': 'members',
    'travel.html': 'travel',
    'bazaar.html': 'bazaar',
    'discord.html': 'discord',
    'oc.html': 'oc',
    'company.html': 'company',
    'gamble.html': 'gamble',
    'simulator.html': 'simulator',
    'weapons.html': 'weapons',
    'hitman.html': 'hitman',
    'forensics.html': 'forensics',
    'oc-optimizer.html': 'oc-optimizer'
};

const pubDir = path.join(__dirname, '../public');

for (const [file, activeKey] of Object.entries(filesMap)) {
    const filePath = path.join(pubDir, file);
    if (!fs.existsSync(filePath)) continue;

    let content = fs.readFileSync(filePath, 'utf8');
    const regex = /<div class="nav-items">[\s\S]*?<\/div>\s*<\/nav>/i;
    const replacement = makeNavItems(activeKey) + '\n    </nav>';

    if (regex.test(content)) {
        content = content.replace(regex, replacement);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated nav in ${file}`);
    } else {
        console.log(`Could not find nav-items in ${file}`);
    }
}
console.log('Sidebar sync completed successfully.');
