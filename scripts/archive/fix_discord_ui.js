const fs = require('fs');
const path = require('path');

const publicDir = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public';

// 1. Fix the "Settings" link in all files to just go to "/"
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
files.forEach(file => {
    let filePath = path.join(publicDir, file);
    let html = fs.readFileSync(filePath, 'utf8');
    
    // Replace onclick="openSettings()" with href="/" if it's in a sidebar link
    html = html.replace(/<a onclick="openSettings\(\)"([^>]*)>([^<]*)<span class="nav-text">Settings<\/span><\/a>/g, '<a href="/"$1>$2<span class="nav-text">Settings</span></a>');
    
    // And for the oc.html specific floating button
    html = html.replace(/<button class="settings-btn" onclick="openSettings\(\)" title="Settings">⚙️<\/button>/, '<button class="settings-btn" onclick="window.location.href=\'/\'" title="Settings">⚙️</button>');
    
    fs.writeFileSync(filePath, html);
});

// 2. Remove the multi-bot injection from index.html (since we are moving it to discord.html)
let indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
indexHtml = indexHtml.replace(/<div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #2f3542;">[\s\S]*?<h3 style="color: #00cec9; margin-top: 0;">Multi-Tenant Discord Bot<\/h3>[\s\S]*?<\/div>\s*<\/div>/, '');
indexHtml = indexHtml.replace(/if \(document\.getElementById\("discord-userid"\)\).*?;\n/g, '');
indexHtml = indexHtml.replace(/if \(document\.getElementById\("discord-bottoken"\)\).*?;\n/g, '');
indexHtml = indexHtml.replace(/if \(document\.getElementById\("attack-threshold"\)\).*?;\n/g, '');
indexHtml = indexHtml.replace(/if \(document\.getElementById\("toggle-attack"\)\).*?;\n/g, '');
indexHtml = indexHtml.replace(/if \(document\.getElementById\("toggle-undercut"\)\).*?;\n/g, '');
indexHtml = indexHtml.replace(/if \(document\.getElementById\("toggle-chain"\)\).*?;\n/g, '');
fs.writeFileSync(path.join(publicDir, 'index.html'), indexHtml);

// 3. Re-write discord.html completely to hold all the config
let discordHtml = fs.readFileSync(path.join(publicDir, 'discord.html'), 'utf8');

const discordConfigSection = `
        <div class="container">
            <div class="dash-card">
                <h2>👤 Personal Bot Configuration</h2>
                <div class="form-group">
                    <label>Your Discord User ID</label>
                    <input type="text" id="discord-userid" placeholder="e.g. 123456789012345678">
                </div>
                <div class="form-group">
                    <label>Your Personal Discord Bot Token</label>
                    <input type="password" id="discord-bottoken" placeholder="Required for Private DMs">
                </div>
                <div class="form-group">
                    <label>Attack Alert Threshold</label>
                    <input type="number" id="attack-threshold" placeholder="Alert after X losses in 15 mins (Default: 3)">
                </div>
                
                <h3 style="color: #ffa502; border-bottom: 1px solid #2f3542; padding-bottom: 5px; margin-top: 20px;">Personal Alert Toggles</h3>
                <div class="trigger-list">
                    <div class="trigger-item">
                        <div class="trigger-info">
                            <span class="trigger-title" style="color: var(--red);">⚔️ Attack Alerts</span>
                            <span class="trigger-desc">Get a Private DM when you are sitting online and get attacked.</span>
                        </div>
                        <label class="switch"><input type="checkbox" id="toggle-attack" checked><span class="slider"></span></label>
                    </div>
                    <div class="trigger-item">
                        <div class="trigger-info">
                            <span class="trigger-title" style="color: var(--gold);">📉 Undercut Alerts</span>
                            <span class="trigger-desc">Get a Private DM if your bazaar listings are undercut.</span>
                        </div>
                        <label class="switch"><input type="checkbox" id="toggle-undercut" checked><span class="slider"></span></label>
                    </div>
                </div>
            </div>

            <div class="dash-card">
                <h2>🌍 Faction Uplink Configuration</h2>
                <div class="form-group">
                    <label>Faction Discord Webhook URL</label>
                    <input type="text" id="webhook-url" placeholder="https://discord.com/api/webhooks/...">
                </div>
                <h3 style="color: #ffa502; border-bottom: 1px solid #2f3542; padding-bottom: 5px; margin-top: 20px;">Faction Alert Toggles</h3>
                <div class="trigger-list">
`;
discordHtml = discordHtml.replace(/<div class="container">\s*<div class="dash-card">\s*<h2>Uplink Configuration<\/h2>[\s\S]*?<div class="dash-card">\s*<h2>Background Notification Options<\/h2>\s*<div class="trigger-list">/, discordConfigSection.trim() + "\n");

const scriptUpdates = `
<script>
document.addEventListener("DOMContentLoaded", async function() {
    const sidebar = document.getElementById('app-sidebar');
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }

    // Load Personal Data
    document.getElementById("discord-userid").value = localStorage.getItem("warboard_discordId") || "";
    document.getElementById("discord-bottoken").value = localStorage.getItem("warboard_botToken") || "";
    document.getElementById("attack-threshold").value = localStorage.getItem("warboard_attackThreshold") || "";
    let tgs = JSON.parse(localStorage.getItem("warboard_alertToggles") || '{"attack":true,"undercut":true}');
    document.getElementById("toggle-attack").checked = tgs.attack !== false;
    document.getElementById("toggle-undercut").checked = tgs.undercut !== false;

    // Load Global Data
    try {
        const res = await fetch('/api/get-discord-config');
        const config = await res.json();
        
        document.getElementById('webhook-url').value = config.webhookUrl || "";
        document.getElementById('targetOnline').checked = config.targetOnline !== false;
        document.getElementById('targetLanded').checked = config.targetLanded !== false;
        document.getElementById('targetOutHosp').checked = config.targetOutHosp !== false;
        document.getElementById('chainUnder90').checked = config.chainUnder90 !== false;
        document.getElementById('chainMilestone').checked = config.chainMilestone !== false;
        document.getElementById('friendlyAttacked').checked = config.friendlyAttacked !== false;
        document.getElementById('medOutSniper').checked = config.medOutSniper !== false; 
    } catch(e) {}
    
    // Attempt to pull user profile from backend
    const myKey = localStorage.getItem("warboard_apikey") || "";
    if (myKey) {
        try {
            const pRes = await fetch('/api/get-user-profile?apiKey=' + myKey);
            const pData = await pRes.json();
            if (pData.discordId) document.getElementById("discord-userid").value = pData.discordId;
            if (pData.botToken) document.getElementById("discord-bottoken").value = pData.botToken;
            if (pData.attackThreshold) document.getElementById("attack-threshold").value = pData.attackThreshold;
            if (pData.alertToggles) {
                document.getElementById("toggle-attack").checked = pData.alertToggles.attack !== false;
                document.getElementById("toggle-undercut").checked = pData.alertToggles.undercut !== false;
            }
        } catch(e) {}
    }
});

function toggleSidebar() {
    const sidebar = document.getElementById('app-sidebar');
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
}

async function saveDiscordConfig() {
    const status = document.getElementById('status-msg');
    status.style.color = "var(--blue)";
    status.innerText = "Transmitting options & authenticating faction ID...";

    const myKey = localStorage.getItem("warboard_apikey") || "";

    if (!myKey) {
        status.style.color = "var(--red)";
        status.innerText = "❌ Missing API Key. Go to Live Warboard Settings first!";
        return;
    }

    // Save Personal Settings
    let discordId = document.getElementById("discord-userid").value.trim();
    let botToken = document.getElementById("discord-bottoken").value.trim();
    let attackThreshold = document.getElementById("attack-threshold").value.trim() || "3";
    let alertToggles = {
        attack: document.getElementById("toggle-attack").checked,
        undercut: document.getElementById("toggle-undercut").checked
    };

    localStorage.setItem("warboard_discordId", discordId);
    localStorage.setItem("warboard_botToken", botToken);
    localStorage.setItem("warboard_attackThreshold", attackThreshold);
    localStorage.setItem("warboard_alertToggles", JSON.stringify(alertToggles));

    try {
        await fetch('/api/save-user-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: myKey, discordId, botToken, attackThreshold, alertToggles })
        });
    } catch(e) {}

    // Save Global Settings
    const payload = {
        apiKey: myKey,
        webhookUrl: document.getElementById('webhook-url').value.trim(),
        targetOnline: document.getElementById('targetOnline').checked,
        targetLanded: document.getElementById('targetLanded').checked,
        targetOutHosp: document.getElementById('targetOutHosp').checked,
        chainUnder90: document.getElementById('chainUnder90').checked,
        chainMilestone: document.getElementById('chainMilestone').checked,
        friendlyAttacked: document.getElementById('friendlyAttacked').checked,
        medOutSniper: document.getElementById('medOutSniper').checked 
    };

    try {
        const res = await fetch('/api/save-discord-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if(data.success) {
            status.style.color = "var(--green)";
            status.innerText = "✓ Backend updated. Scraper engines synced 24/7.";
        } else { throw new Error(); }
    } catch(e) {
        status.style.color = "var(--red)";
        status.innerText = "❌ Sync failed. Check server terminal logs.";
    }
}
</script>
`;
discordHtml = discordHtml.replace(/<script>\s*document\.addEventListener\("DOMContentLoaded"[\s\S]*?<\/script>/, scriptUpdates.trim());

fs.writeFileSync(path.join(publicDir, 'discord.html'), discordHtml);
console.log('Fixed discord.html and removed personal alerts from index.html');
