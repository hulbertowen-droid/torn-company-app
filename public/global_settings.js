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
.global-status-box { padding: 10px 12px; background: rgba(0, 206, 201, 0.1); border: 1px solid rgba(0, 206, 201, 0.3); border-radius: 6px; font-size: 0.85em; margin-bottom: 15px; }
</style>
<div id="global-settings-modal" class="global-modal-overlay">
    <div class="global-modal-content" style="max-height: 90vh; overflow-y: auto;">
        <button class="global-close-btn" onclick="closeGlobalSettings()">&times;</button>
        <h2>Board Settings</h2>
        <div id="gs-account-status" class="global-status-box">
            <span>🔒 Account: </span><span id="gs-status-text">Checking...</span>
        </div>
        <div>
            <label for="gs-api-key">Torn API Key (Update Key / Switch Account)</label>
            <input type="password" id="gs-api-key" aria-label="Torn API Key" placeholder="Paste new Torn API Key to connect">
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
            <label for="gs-discord-webhook">Global Discord Webhook</label>
            <input type="text" id="gs-discord-webhook" aria-label="Discord Webhook URL" placeholder="Optional Discord Webhook URL">
        </div>
        <div>
            <label for="gs-api-cpm">API Calls Per Minute (Max 60)</label>
            <input type="number" id="gs-api-cpm" aria-label="API Calls Per Minute" min="1" max="60" placeholder="e.g. 12 calls/min">
        </div>
        <button class="global-btn-save" id="gs-btn-save" onclick="saveGlobalSettings()">Save Settings</button>
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
    document.getElementById('gs-api-key').value = "";
    document.getElementById('gs-ff-key').value = localStorage.getItem('warboard_ffkey') || "";
    document.getElementById('gs-ts-key').value = localStorage.getItem('warboard_tskey') || "";
    document.getElementById('gs-enemy-id').value = localStorage.getItem('warboard_enemyId') || "";
    document.getElementById('gs-my-name').value = localStorage.getItem('warboard_myname') || "";
    document.getElementById('gs-discord-webhook').value = localStorage.getItem('warboard_discord') || "";
    document.getElementById('gs-api-cpm').value = localStorage.getItem('warboard_cpm') || "12";

    const statusText = document.getElementById('gs-status-text');
    const token = localStorage.getItem('sv_session_token');
    if (token) {
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            if (data.authenticated && data.user) {
                statusText.innerHTML = `<strong>${data.user.playerName} [${data.user.playerId}]</strong> (${data.user.factionName || 'Factionless'})`;
            } else {
                statusText.textContent = 'Not connected (Enter Torn Key below)';
            }
        } catch(e) {
            statusText.textContent = 'Active Session';
        }
    } else {
        statusText.textContent = 'Not connected (Enter Torn Key below)';
    }
};

window.closeGlobalSettings = function() {
    const modal = document.getElementById('global-settings-modal');
    if (modal) modal.style.display = 'none';
};

window.saveGlobalSettings = async function() {
    const saveBtn = document.getElementById('gs-btn-save');
    const apiKey = document.getElementById('gs-api-key').value.trim();
    const ffKey = document.getElementById('gs-ff-key').value.trim();
    const tsKey = document.getElementById('gs-ts-key').value.trim();
    const enemyFacId = document.getElementById('gs-enemy-id').value.trim();
    const myName = document.getElementById('gs-my-name').value.trim();
    const discord = document.getElementById('gs-discord-webhook').value.trim();
    const cpm = document.getElementById('gs-api-cpm').value.trim() || "12";

    if (apiKey) {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Connecting Key...';
        }
        try {
            const res = await fetch('/api/auth/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey })
            });
            const data = await res.json();
            if (data.success && data.sessionToken) {
                localStorage.setItem('sv_session_token', data.sessionToken);
                sessionStorage.setItem('sv_user', JSON.stringify(data.user));
            } else {
                alert('API Key Error: ' + (data.error || 'Failed to authenticate key.'));
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save Settings';
                }
                return;
            }
        } catch(e) {
            alert('Failed to connect API key: ' + e.message);
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Settings';
            }
            return;
        }
    }

    // Save client preferences
    localStorage.setItem('warboard_ffkey', ffKey);
    localStorage.setItem('warboard_tskey', tsKey);
    localStorage.setItem('warboard_enemyId', enemyFacId);
    localStorage.setItem('warboard_myname', myName);
    localStorage.setItem('warboard_discord', discord);
    localStorage.setItem('warboard_cpm', cpm);

    closeGlobalSettings();
    window.location.reload();
};
