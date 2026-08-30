const fs = require('fs');
let file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let html = fs.readFileSync(file, 'utf8');

// Replace DOMContentLoaded config loader
const oldLoad = /window\.addEventListener\('DOMContentLoaded', \(\) => \{[\s\S]*?body: JSON\.stringify\(\{ discord: JSON\.parse\(factionSync\) \}\)\n        \}\)\n    \}\n\}\)/;
const newLoad = `window.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/master-config');
        const data = await res.json();
        
        if (data.discordConfig) {
            if (data.discordConfig.apiKey) localStorage.setItem('warboard_apikey', data.discordConfig.apiKey);
            if (data.discordConfig.webhookUrl) localStorage.setItem('warboard_discord', data.discordConfig.webhookUrl);
            if (data.discordConfig.myName) localStorage.setItem('warboard_myname', data.discordConfig.myName);
        }
    } catch(e) {}
    
    let factionSync = localStorage.getItem('master_faction_config');
    if (factionSync) {
        fetch('/api/sync-configs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discord: JSON.parse(factionSync) })
        })
    }
})`;

html = html.replace(oldLoad, newLoad);

// Replace saveSettings
const oldSave = /function saveSettings\(\) \{[\s\S]*?localStorage\.setItem\("warboard_cpm", cpm\);/;
const newSave = `async function saveSettings() {
    initAudio(); 
    myKey = document.getElementById("api-key").value.trim();
    ffKey = document.getElementById("ff-key").value.trim();
    tsKey = document.getElementById("ts-key").value.trim();
    enemyFacId = document.getElementById("enemy-id").value.trim();
    myName = document.getElementById("my-name").value.trim() || "Agent";
    discordWebhook = document.getElementById("discord-webhook").value.trim();
    
    let parsedCpm = parseInt(document.getElementById("api-cpm").value);
    cpm = (parsedCpm && parsedCpm > 0 && parsedCpm <= 60) ? parsedCpm : 12;
    
    localStorage.setItem("warboard_apikey", myKey);
    localStorage.setItem("warboard_ffkey", ffKey);
    localStorage.setItem("warboard_tskey", tsKey);
    localStorage.setItem("warboard_enemyId", enemyFacId);
    localStorage.setItem("warboard_myname", myName);
    localStorage.setItem("warboard_discord", discordWebhook);
    localStorage.setItem("warboard_cpm", cpm);

    try {
        await fetch('/api/master-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: myKey, discordWebhook: discordWebhook, myName: myName })
        });
    } catch(e) {}
`;

html = html.replace(oldSave, newSave);

// Also replace openSettings to pull from localStorage (which is now populated from backend)
const oldOpen = /function openSettings\(\) \{ \n    document\.getElementById\("discord-webhook"\)\.value = localStorage\.getItem\("warboard_discord"\) \|\| "";\n    document\.getElementById\("settings-modal"\)\.style\.display = "flex"; \n\}/;
const newOpen = `function openSettings() { 
    document.getElementById("api-key").value = localStorage.getItem("warboard_apikey") || "";
    document.getElementById("ff-key").value = localStorage.getItem("warboard_ffkey") || "";
    document.getElementById("ts-key").value = localStorage.getItem("warboard_tskey") || "";
    document.getElementById("enemy-id").value = localStorage.getItem("warboard_enemyId") || "";
    document.getElementById("my-name").value = localStorage.getItem("warboard_myname") || "";
    document.getElementById("discord-webhook").value = localStorage.getItem("warboard_discord") || "";
    document.getElementById("api-cpm").value = localStorage.getItem("warboard_cpm") || "12";
    document.getElementById("settings-modal").style.display = "flex"; 
}`;

html = html.replace(oldOpen, newOpen);

fs.writeFileSync(file, html);
console.log('Fixed index.html frontend config sync');
