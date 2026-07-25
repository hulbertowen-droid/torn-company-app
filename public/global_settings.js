
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
            <label>API Key (Hidden for Privacy)</label>
            <input type="password" id="gs-api-key" placeholder="Paste your Torn API Key here">
        </div>
        <div>
            <label>FF Scouter Premium Key</label>
            <input type="password" id="gs-ff-key" placeholder="Optional: Unlocks advanced stats & radar">
        </div>
        <div>
            <label>Torn Stats API Key</label>
            <input type="password" id="gs-ts-key" placeholder="Optional: Unlocks Global Spy Database">
        </div>
        <div>
            <label>Enemy Faction ID</label>
            <input type="text" id="gs-enemy-id" placeholder="Optional (Auto-detects usually)">
        </div>
        <div>
            <label>Your Name (For Targets)</label>
            <input type="text" id="gs-my-name" placeholder="E.g. Agent">
        </div>
        <div>
            <label>Global Discord Webhook (Auto-Pastes Everywhere)</label>
            <input type="text" id="gs-discord-webhook" placeholder="Paste Discord Webhook URL here">
        </div>
        <div>
            <label>API Calls Per Minute (Max 60)</label>
            <input type="number" id="gs-api-cpm" min="1" max="60" placeholder="e.g. 12 calls/min = 1 refresh every 5s">
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

window.openGlobalSettings = function() {
    injectGlobalSettings();
    document.getElementById('global-settings-modal').style.display = 'flex';
    document.getElementById('gs-api-key').value = localStorage.getItem('warboard_apikey') || "";
    document.getElementById('gs-ff-key').value = localStorage.getItem('warboard_ffkey') || "";
    document.getElementById('gs-ts-key').value = localStorage.getItem('warboard_tskey') || "";
    document.getElementById('gs-enemy-id').value = localStorage.getItem('warboard_enemyId') || "";
    document.getElementById('gs-my-name').value = localStorage.getItem('warboard_myname') || "";
    document.getElementById('gs-discord-webhook').value = localStorage.getItem('warboard_discord') || "";
    document.getElementById('gs-api-cpm').value = localStorage.getItem('warboard_cpm') || "12";
};

window.closeGlobalSettings = function() {
    document.getElementById('global-settings-modal').style.display = 'none';
};

window.saveGlobalSettings = function() {
    localStorage.setItem('warboard_apikey', document.getElementById('gs-api-key').value.trim());
    localStorage.setItem('warboard_ffkey', document.getElementById('gs-ff-key').value.trim());
    localStorage.setItem('warboard_tskey', document.getElementById('gs-ts-key').value.trim());
    localStorage.setItem('warboard_enemyId', document.getElementById('gs-enemy-id').value.trim());
    localStorage.setItem('warboard_myname', document.getElementById('gs-my-name').value.trim());
    localStorage.setItem('warboard_discord', document.getElementById('gs-discord-webhook').value.trim());
    localStorage.setItem('warboard_cpm', document.getElementById('gs-api-cpm').value.trim() || "12");

    try {
        fetch('/api/master-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                apiKey: document.getElementById('gs-api-key').value.trim(), 
                discordWebhook: document.getElementById('gs-discord-webhook').value.trim(), 
                ffKey: document.getElementById('gs-ff-key').value.trim(), 
                tsKey: document.getElementById('gs-ts-key').value.trim(), 
                enemyId: document.getElementById('gs-enemy-id').value.trim(), 
                myName: document.getElementById('gs-my-name').value.trim() 
            })
        });
    } catch(e) {}

    closeGlobalSettings();
    window.location.reload();
};
