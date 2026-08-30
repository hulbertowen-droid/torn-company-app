const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let html = fs.readFileSync(file, 'utf8');

const globalToggles = `
                <div>
                    <label>Faction Discord Webhook</label>
                    <input type="password" id="discord-webhook" placeholder="Paste your Faction's Discord Webhook URL">
                    <button class="test-btn" onclick="testDiscordWebhook()">Test Webhook</button>
                    <div id="discord-test-status" style="margin-top: 10px; font-size: 0.9em; text-align: center;"></div>
                </div>
                <div style="margin-bottom: 15px;">
                    <label>Global Faction Alerts (Sends to Webhook)</label>
                    <div style="display:flex; flex-direction:column; gap:8px; font-size:0.9em;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="global-chain" checked> Chain Timeout & Milestones</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="global-target" checked> Target Activity (Online, Landed, Hosp)</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" id="global-sniper" checked> Med-Out Sniper</label>
                    </div>
                </div>
`;

html = html.replace(/<div>\s*<label>Discord Webhook<\/label>\s*<input type="password" id="discord-webhook"[^>]+>\s*<button class="test-btn"[^>]+>Test Webhook<\/button>\s*<div id="discord-test-status"[^>]+><\/div>\s*<\/div>/, globalToggles.trim());

const loadToggles = `
    document.getElementById("discord-webhook").value = localStorage.getItem("warboard_discord") || "";
    let globalTgs = JSON.parse(localStorage.getItem("warboard_globalToggles") || '{"chain":true,"target":true,"sniper":true}');
    document.getElementById("global-chain").checked = globalTgs.chain;
    document.getElementById("global-target").checked = globalTgs.target;
    document.getElementById("global-sniper").checked = globalTgs.sniper;
`;
html = html.replace(/document\.getElementById\("discord-webhook"\)\.value = localStorage\.getItem\("warboard_discord"\) \|\| "";/, loadToggles.trim());

const saveToggles = `
    let discordWebhook = document.getElementById("discord-webhook").value.trim();
    let globalToggles = {
        chain: document.getElementById("global-chain").checked,
        target: document.getElementById("global-target").checked,
        sniper: document.getElementById("global-sniper").checked
    };
    localStorage.setItem("warboard_discord", discordWebhook);
    localStorage.setItem("warboard_globalToggles", JSON.stringify(globalToggles));

    fetch('/api/master-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            apiKey: myKey, 
            discordWebhook: discordWebhook, 
            ffKey: ffKey, 
            tsKey: tsKey, 
            enemyId: enemyFacId, 
            myName: myName,
            globalToggles: globalToggles
        })
    }).catch(()=>{});
`;
html = html.replace(/let discordWebhook = document\.getElementById\("discord-webhook"\)\.value\.trim\(\);[\s\S]*?body: JSON\.stringify\(\{ apiKey: myKey, discordWebhook: discordWebhook, ffKey: ffKey, tsKey: tsKey, enemyId: enemyFacId, myName: myName \}\)\n        \}\)\.catch\(\(\)=>{}\);/, saveToggles.trim());

fs.writeFileSync(file, html);
console.log('Injected global toggles into index.html');
