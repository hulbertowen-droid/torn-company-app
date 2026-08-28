
const globalSettingsHTML = `
<style>
.global-modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 100000; justify-content: center; align-items: center; backdrop-filter: blur(4px); }
.global-modal-content { background: var(--card, #11141d); border: 1px solid var(--border, #2f3542); padding: 25px; border-radius: 12px; width: 450px; max-width: 90vw; color: white; position: relative; }
.global-close-btn { position: absolute; right: 15px; top: 15px; color: var(--text-dim, #a1aab5); font-size: 1.5em; cursor: pointer; border: none; background: none; }
.global-modal-content h2 { margin-top: 0; color: var(--blue, #58a6ff); border-bottom: 1px solid var(--border, #2f3542); padding-bottom: 10px; }
.global-modal-content div { margin-bottom: 15px; }
.global-modal-content label { display: block; font-size: 0.85em; color: var(--text-dim, #a1aab5); font-weight: bold; margin-bottom: 5px; text-transform: uppercase; }
.global-modal-content input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid var(--border, #30363d); background: #0b0d13; color: white; font-size: 1em; }
.global-btn-save { background: var(--blue, #58a6ff); color: #000; border: none; padding: 12px; width: 100%; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1em; text-transform: uppercase; }
</style>
<div id="global-settings-modal" class="global-modal-overlay">
    <div class="global-modal-content" style="max-height: 90vh; overflow-y: auto;">
        <button class="global-close-btn" onclick="closeGlobalSettings()">&times;</button>
        <h2>Board Settings</h2>
        <div>
            <label for="gs-api-key">API Key (Requires "Limited" Access & Faction Permissions)</label>
            <input type="password" id="gs-api-key" aria-label="Torn API Key" placeholder="Paste your Torn API Key here">
        </div>
        <div>
            <label for="gs-ff-key">FF Scouter Premium Key</label>
            <input type="password" id="gs-ff-key" aria-label="FF Scouter Premium Key" placeholder="Optional: Unlocks advanced stats & radar">
        </div>
        <div>
            <label for="gs-ts-key">Torn Stats API Key</label>
            <input type="password" id="gs-ts-key" aria-label="Torn Stats API Key" placeholder="Optional: Unlocks Global Spy Database">
        </div>
        <div>
            <label for="gs-enemy-id">Enemy Faction ID</label>
            <input type="text" id="gs-enemy-id" aria-label="Enemy Faction ID" placeholder="Optional (Auto-detects usually)">
        </div>
        <div>
            <label for="gs-my-name">Your Name (For Targets)</label>
            <input type="text" id="gs-my-name" aria-label="Your Name" placeholder="E.g. Agent">
        </div>
        <div>
            <label for="gs-discord-webhook">Global Discord Webhook (Auto-Pastes Everywhere)</label>
            <input type="text" id="gs-discord-webhook" aria-label="Discord Webhook URL" placeholder="Paste Discord Webhook URL here">
        </div>
        <div>
            <label for="gs-api-cpm">API Calls Per Minute (Max 60)</label>
            <input type="number" id="gs-api-cpm" aria-label="API Calls Per Minute" min="1" max="60" placeholder="e.g. 12 calls/min = 1 refresh every 5s">
        </div>
        <button class="global-btn-save" onclick="saveGlobalSettings()">Save Settings</button>
    </div>
</div>
`;

function injectGlobalSettings() {
    if (document.getElementById('global-settings-modal')) return;
    const div = document.createElement('div');
    div.innerHTML = globalSettingsHTML;
    document.body.appendChild(div);
}

window.openGlobalSettings = async function() {
    injectGlobalSettings();
    document.getElementById('global-settings-modal').style.display = 'flex';
    document.getElementById('gs-api-key').value = localStorage.getItem('warboard_apikey') || "";
    document.getElementById('gs-ff-key').value = localStorage.getItem('warboard_ffkey') || "";
    document.getElementById('gs-ts-key').value = localStorage.getItem('warboard_tskey') || "";
    document.getElementById('gs-enemy-id').value = localStorage.getItem('warboard_enemyId') || "";
    document.getElementById('gs-my-name').value = localStorage.getItem('warboard_myname') || "";
    document.getElementById('gs-discord-webhook').value = localStorage.getItem('warboard_discord') || "";
    document.getElementById('gs-api-cpm').value = localStorage.getItem('warboard_cpm') || "12";

    if (!document.getElementById('gs-api-key').value) {
        try {
            const res = await fetch('/api/master-config');
            const data = await res.json();
            if (data.apiKey) {
                document.getElementById('gs-api-key').value = data.apiKey;
                localStorage.setItem('warboard_apikey', data.apiKey);
            }
            if (data.ffKey) document.getElementById('gs-ff-key').value = data.ffKey;
            if (data.tsKey) document.getElementById('gs-ts-key').value = data.tsKey;
            if (data.enemyFacId) document.getElementById('gs-enemy-id').value = data.enemyFacId;
            if (data.myName) document.getElementById('gs-my-name').value = data.myName;
            if (data.globalChannelId) document.getElementById('gs-discord-webhook').value = data.globalChannelId;
        } catch(e) {}
    }
};

window.closeGlobalSettings = function() {
    document.getElementById('global-settings-modal').style.display = 'none';
};

window.saveGlobalSettings = function() {
    const apiKey = document.getElementById('gs-api-key').value.trim();
    const ffKey = document.getElementById('gs-ff-key').value.trim();
    const tsKey = document.getElementById('gs-ts-key').value.trim();
    const enemyFacId = document.getElementById('gs-enemy-id').value.trim();
    const myName = document.getElementById('gs-my-name').value.trim();
    const discord = document.getElementById('gs-discord-webhook').value.trim();
    const cpm = document.getElementById('gs-api-cpm').value.trim() || "12";

    localStorage.setItem('warboard_apikey', apiKey);
    localStorage.setItem('warboard_ffkey', ffKey);
    localStorage.setItem('warboard_tskey', tsKey);
    localStorage.setItem('warboard_enemyId', enemyFacId);
    localStorage.setItem('warboard_myname', myName);
    localStorage.setItem('warboard_discord', discord);
    localStorage.setItem('warboard_cpm', cpm);
    localStorage.setItem('master_faction_config', JSON.stringify({ apiKey, ffKey, tsKey, enemyFacId, myName, discord, cpm }));

    try {
        fetch('/api/master-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                apiKey, 
                discordWebhook: discord, 
                ffKey, 
                tsKey, 
                enemyId: enemyFacId, 
                myName 
            })
        });
    } catch(e) {}

    closeGlobalSettings();
    window.location.reload();
};
