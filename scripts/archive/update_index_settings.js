const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let html = fs.readFileSync(file, 'utf8');

// Inject the new inputs into the settings modal
const newInputs = `
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border);">
                    <h3 style="color: var(--blue); margin-top: 0;">Personal Discord Bot Settings</h3>
                    <p style="font-size: 0.85em; color: var(--text-dim); margin-bottom: 10px;">The server bot will DM you if you are online and getting attacked.</p>
                    <label>Your Discord User ID</label>
                    <input type="text" id="discord-userid" placeholder="e.g. 123456789012345678">
                </div>
                <div>
                    <label>Attack Alert Threshold</label>
                    <input type="number" id="attack-threshold" placeholder="Alert after X losses in 15 mins (Default: 3)">
                </div>
`;

html = html.replace(/(<label>My Name<\/label>\s*<input type="text" id="my-name" placeholder="Your name for UI">\s*<\/div>)/, "$1\n" + newInputs);

// Update openSettings to load the new values
const loadInputs = `
    document.getElementById("api-key").value = localStorage.getItem("warboard_apikey") || "";
    document.getElementById("discord-userid").value = localStorage.getItem("warboard_discordId") || "";
    document.getElementById("attack-threshold").value = localStorage.getItem("warboard_attackThreshold") || "";
`;
html = html.replace(/document\.getElementById\("api-key"\)\.value = localStorage\.getItem\("warboard_apikey"\) \|\| "";/, loadInputs);

// Update saveSettings to save the new values and POST to /api/save-user-profile
const saveInputs = `
    let discordId = document.getElementById("discord-userid").value.trim();
    let attackThreshold = document.getElementById("attack-threshold").value.trim() || "3";
    localStorage.setItem("warboard_discordId", discordId);
    localStorage.setItem("warboard_attackThreshold", attackThreshold);
    
    try {
        fetch('/api/save-user-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: myKey, discordId: discordId, attackThreshold: attackThreshold })
        });
    } catch(e) {}
`;
html = html.replace(/localStorage\.setItem\("warboard_cpm", cpm\);/, "localStorage.setItem(\"warboard_cpm\", cpm);\n" + saveInputs);

fs.writeFileSync(file, html);
console.log('Injected personal bot settings into index.html');
