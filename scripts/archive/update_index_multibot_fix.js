const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let html = fs.readFileSync(file, 'utf8');

const newInputs = `
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #2f3542;">
                    <h3 style="color: #00cec9; margin-top: 0;">Multi-Tenant Discord Bot</h3>
                    <p style="font-size: 0.85em; color: #57606f; margin-bottom: 10px;">The server will spin up your personal bot to send Private DMs.</p>
                    <label>Your Discord User ID</label>
                    <input type="text" id="discord-userid" placeholder="e.g. 123456789012345678">
                </div>
                <div>
                    <label>Your Discord Bot Token</label>
                    <input type="password" id="discord-bottoken" placeholder="Optional: To receive Private DMs">
                </div>
                <div>
                    <label>Attack Alert Threshold</label>
                    <input type="number" id="attack-threshold" placeholder="Alert after X losses in 15 mins (Default: 3)">
                </div>
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #2f3542;">
                    <h3 style="color: #ffa502; margin-top: 0;">Alert Toggles</h3>
                    <div style="display:flex; flex-direction:column; gap:8px; font-size:0.9em; margin-bottom:10px;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="toggle-attack" checked> Attack Alerts (Requires User ID)</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="toggle-undercut" checked> Undercut Alerts</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="toggle-chain" checked> Chain Timeout Alerts</label>
                    </div>
                </div>
`;

// Insert after my-name div
const myNameDivRegex = /(<label>Your Name \(For Targets\)<\/label>\s*<input type="text" id="my-name" placeholder="E\.g\. Agent">\s*<\/div>)/;
if (!html.includes('Multi-Tenant Discord Bot')) {
    html = html.replace(myNameDivRegex, "$1\n" + newInputs);
}

// Load script update
const loadRegex = /document\.getElementById\("api-key"\)\.value = localStorage\.getItem\("warboard_apikey"\) \|\| "";/;
const loadReplacement = `
    document.getElementById("api-key").value = localStorage.getItem("warboard_apikey") || "";
    if (document.getElementById("discord-userid")) document.getElementById("discord-userid").value = localStorage.getItem("warboard_discordId") || "";
    if (document.getElementById("discord-bottoken")) document.getElementById("discord-bottoken").value = localStorage.getItem("warboard_botToken") || "";
    if (document.getElementById("attack-threshold")) document.getElementById("attack-threshold").value = localStorage.getItem("warboard_attackThreshold") || "";
    
    let tgs = JSON.parse(localStorage.getItem("warboard_alertToggles") || '{"attack":true,"undercut":true,"chain":true}');
    if (document.getElementById("toggle-attack")) document.getElementById("toggle-attack").checked = tgs.attack;
    if (document.getElementById("toggle-undercut")) document.getElementById("toggle-undercut").checked = tgs.undercut;
    if (document.getElementById("toggle-chain")) document.getElementById("toggle-chain").checked = tgs.chain;
`;
if (!html.includes('document.getElementById("discord-userid")')) {
    html = html.replace(loadRegex, loadReplacement.trim());
}

// Save script update
const saveRegex = /let myName = document\.getElementById\("my-name"\)\.value\.trim\(\);/;
const saveReplacement = `
    let myName = document.getElementById("my-name").value.trim();
    
    let discordId = document.getElementById("discord-userid") ? document.getElementById("discord-userid").value.trim() : "";
    let botToken = document.getElementById("discord-bottoken") ? document.getElementById("discord-bottoken").value.trim() : "";
    let attackThreshold = document.getElementById("attack-threshold") ? (document.getElementById("attack-threshold").value.trim() || "3") : "3";
    let alertToggles = {
        attack: document.getElementById("toggle-attack") ? document.getElementById("toggle-attack").checked : true,
        undercut: document.getElementById("toggle-undercut") ? document.getElementById("toggle-undercut").checked : true,
        chain: document.getElementById("toggle-chain") ? document.getElementById("toggle-chain").checked : true
    };

    localStorage.setItem("warboard_discordId", discordId);
    localStorage.setItem("warboard_botToken", botToken);
    localStorage.setItem("warboard_attackThreshold", attackThreshold);
    localStorage.setItem("warboard_alertToggles", JSON.stringify(alertToggles));
    
    try {
        fetch('/api/save-user-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: myKey, discordId, botToken, attackThreshold, alertToggles })
        });
    } catch(e) {}
`;
if (!html.includes('fetch(\'/api/save-user-profile\'')) {
    html = html.replace(saveRegex, saveReplacement.trim());
}

fs.writeFileSync(file, html);
console.log('Fixed index.html multi-bot injection');
