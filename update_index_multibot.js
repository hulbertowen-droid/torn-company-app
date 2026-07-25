const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let html = fs.readFileSync(file, 'utf8');

// Inject the new inputs into the settings modal
const newInputs = `
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border);">
                    <h3 style="color: var(--blue); margin-top: 0;">Multi-Tenant Discord Bot</h3>
                    <p style="font-size: 0.85em; color: var(--text-dim); margin-bottom: 10px;">The server will spin up your personal bot to send Private DMs.</p>
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
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border);">
                    <h3 style="color: var(--gold); margin-top: 0;">Alert Toggles</h3>
                    <div style="display:flex; flex-direction:column; gap:8px; font-size:0.9em; margin-bottom:10px;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="toggle-attack" checked> Attack Alerts (Requires User ID)</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="toggle-undercut" checked> Undercut Alerts</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="toggle-chain" checked> Chain Timeout Alerts</label>
                    </div>
                </div>
`;

// Remove the old injection (if it was there from my previous attempt)
html = html.replace(/<div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var\(--border\);">[\s\S]*?<input type="number" id="attack-threshold"[^>]+>\s*<\/div>/, newInputs.trim());
// If it wasn't there (which it shouldn't be since I reset the frontend?), wait, I DID inject it previously!
// Let me just regex replace the exact block if it exists, otherwise insert it.
if (!html.includes('Multi-Tenant Discord Bot')) {
    if (html.includes('Personal Discord Bot Settings')) {
        html = html.replace(/<div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var\(--border\);">\s*<h3 style="color: var\(--blue\); margin-top: 0;">Personal Discord Bot Settings<\/h3>[\s\S]*?<input type="number" id="attack-threshold"[^>]+>\s*<\/div>/, newInputs.trim());
    } else {
        html = html.replace(/(<label>My Name<\/label>\s*<input type="text" id="my-name" placeholder="Your name for UI">\s*<\/div>)/, "$1\n" + newInputs);
    }
}

// Update load script
const loadInputs = `
    document.getElementById("api-key").value = localStorage.getItem("warboard_apikey") || "";
    document.getElementById("discord-userid").value = localStorage.getItem("warboard_discordId") || "";
    document.getElementById("discord-bottoken").value = localStorage.getItem("warboard_botToken") || "";
    document.getElementById("attack-threshold").value = localStorage.getItem("warboard_attackThreshold") || "";
    
    let tgs = JSON.parse(localStorage.getItem("warboard_alertToggles") || '{"attack":true,"undercut":true,"chain":true}');
    document.getElementById("toggle-attack").checked = tgs.attack;
    document.getElementById("toggle-undercut").checked = tgs.undercut;
    document.getElementById("toggle-chain").checked = tgs.chain;
`;
if (html.includes('document.getElementById("api-key").value = localStorage.getItem("warboard_apikey") || "";\n    document.getElementById("discord-userid").value = localStorage.getItem("warboard_discordId") || "";')) {
    html = html.replace(/document\.getElementById\("api-key"\)\.value = localStorage\.getItem\("warboard_apikey"\) \|\| "";[\s\S]*?document\.getElementById\("attack-threshold"\)\.value = localStorage\.getItem\("warboard_attackThreshold"\) \|\| "";/, loadInputs.trim());
} else {
    html = html.replace(/document\.getElementById\("api-key"\)\.value = localStorage\.getItem\("warboard_apikey"\) \|\| "";/, loadInputs);
}

// Update save script
const saveInputs = `
    let discordId = document.getElementById("discord-userid").value.trim();
    let botToken = document.getElementById("discord-bottoken").value.trim();
    let attackThreshold = document.getElementById("attack-threshold").value.trim() || "3";
    let alertToggles = {
        attack: document.getElementById("toggle-attack").checked,
        undercut: document.getElementById("toggle-undercut").checked,
        chain: document.getElementById("toggle-chain").checked
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
if (html.includes('let discordId = document.getElementById("discord-userid").value.trim();')) {
    html = html.replace(/let discordId = document\.getElementById\("discord-userid"\)\.value\.trim\(\);[\s\S]*?catch\(e\) \{\}/, saveInputs.trim());
} else {
    html = html.replace(/localStorage\.setItem\("warboard_cpm", cpm\);\n/, "localStorage.setItem(\"warboard_cpm\", cpm);\n" + saveInputs);
}

// Update profileFetch logic to handle the new toggles & token
const profileFetch = `
        const apiKeyForProfile = localStorage.getItem('warboard_apikey');
        if (apiKeyForProfile) {
            try {
                const pRes = await fetch('/api/get-user-profile?apiKey=' + apiKeyForProfile);
                const pData = await pRes.json();
                if (pData.discordId) localStorage.setItem('warboard_discordId', pData.discordId);
                if (pData.botToken) localStorage.setItem('warboard_botToken', pData.botToken);
                if (pData.attackThreshold) localStorage.setItem('warboard_attackThreshold', pData.attackThreshold);
                if (pData.alertToggles) localStorage.setItem('warboard_alertToggles', JSON.stringify(pData.alertToggles));
            } catch(e) {}
        }
`;
html = html.replace(/const apiKeyForProfile = localStorage\.getItem\('warboard_apikey'\);[\s\S]*?catch\(e\) \{\}\n        \}/, profileFetch.trim());

fs.writeFileSync(file, html);
console.log('Injected multi-bot settings into index.html');
