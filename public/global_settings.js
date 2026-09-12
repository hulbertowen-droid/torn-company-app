/**
 * Torn Operations Portal — Global Settings Modal (v3.0)
 * Seamlessly manages session authentication, external API keys, and tactical preferences.
 */
const globalSettingsHTML = `
<style>
.global-modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(7, 9, 14, 0.85);
    z-index: 100000;
    justify-content: center;
    align-items: center;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    padding: 20px;
    box-sizing: border-box;
}
.global-modal-content {
    background: var(--bg-surface, #0c1017);
    border: 1px solid var(--border-default, rgba(255, 255, 255, 0.12));
    padding: 28px;
    border-radius: var(--radius-lg, 14px);
    width: 500px;
    max-width: 95vw;
    max-height: 90vh;
    overflow-y: auto;
    color: var(--text-primary, #f8fafc);
    position: relative;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 0, 0, 0.5);
    animation: gsModalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    font-family: var(--font-sans, system-ui, sans-serif);
}
@keyframes gsModalIn {
    from { opacity: 0; transform: scale(0.96) translateY(-8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}
.global-close-btn {
    position: absolute;
    right: 20px;
    top: 20px;
    color: var(--text-tertiary, #64748b);
    font-size: 1.4em;
    cursor: pointer;
    border: none;
    background: none;
    padding: 4px;
    border-radius: 6px;
    transition: all 0.15s;
    line-height: 1;
}
.global-close-btn:hover {
    color: var(--text-primary, #f8fafc);
    background: var(--bg-elevated, #121824);
}
.global-modal-content h2 {
    margin: 0 0 16px;
    font-size: 1.15em;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    padding-bottom: 14px;
    color: var(--text-primary, #f8fafc);
    display: flex;
    align-items: center;
    gap: 8px;
}
.global-status-box {
    padding: 12px 14px;
    background: rgba(59, 130, 246, 0.08);
    border: 1px solid rgba(59, 130, 246, 0.25);
    border-radius: var(--radius-sm, 6px);
    font-size: 0.85em;
    margin-bottom: 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}
.global-status-box .auth-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
}
.global-form-row {
    margin-bottom: 16px;
}
.global-form-row label {
    display: block;
    font-size: 0.74em;
    color: var(--text-secondary, #94a3b8);
    font-weight: 800;
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
}
.global-form-row input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    border-radius: var(--radius-sm, 6px);
    border: 1px solid var(--border-default, rgba(255, 255, 255, 0.12));
    background: var(--bg-elevated, #121824);
    color: #ffffff;
    font-size: 0.92em;
    font-family: inherit;
    transition: all 0.15s;
}
.global-form-row input:focus {
    outline: none;
    border-color: var(--accent-cobalt, #3b82f6);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    background: var(--bg-surface, #0c1017);
}
.global-form-row .helper-text {
    font-size: 0.72em;
    color: var(--text-tertiary, #64748b);
    margin-top: 4px;
}
.global-btn-save {
    background: var(--accent-cobalt, #3b82f6);
    color: #ffffff;
    border: none;
    padding: 12px;
    width: 100%;
    border-radius: var(--radius-sm, 6px);
    cursor: pointer;
    font-weight: 800;
    font-size: 0.9em;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    transition: all 0.15s;
    margin-top: 6px;
    box-shadow: 0 2px 10px rgba(59, 130, 246, 0.3);
    font-family: inherit;
}
.global-btn-save:hover {
    background: #4f94fc;
    box-shadow: 0 4px 16px rgba(59, 130, 246, 0.4);
    transform: translateY(-1px);
}
.global-btn-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
}
</style>
<div id="global-settings-modal" class="global-modal-overlay">
    <div class="global-modal-content">
        <button class="global-close-btn" onclick="closeGlobalSettings()">&times;</button>
        <h2>⚙️ Operations & API Settings</h2>
        
        <div id="gs-account-status" class="global-status-box">
            <span class="auth-indicator">🔒 Authentication:</span>
            <span id="gs-status-text" style="font-family:var(--font-mono, monospace); font-size:0.95em;">Checking...</span>
        </div>

        <div class="global-form-row">
            <label for="gs-api-key">Torn API Key (Connect / Switch Account)</label>
            <input type="password" id="gs-api-key" aria-label="Torn API Key" placeholder="Paste Torn API Key to authenticate">
            <div class="helper-text">Encrypted AES-256 server-side. Zero client storage.</div>
        </div>

        <div class="global-form-row">
            <label for="gs-ff-key">FF Scouter Premium Key</label>
            <input type="password" id="gs-ff-key" aria-label="FF Scouter Premium Key" placeholder="Optional: Unlocks real-time Fair Fight radar">
        </div>

        <div class="global-form-row">
            <label for="gs-ts-key">Torn Stats API Key</label>
            <input type="password" id="gs-ts-key" aria-label="Torn Stats API Key" placeholder="Optional: Unlocks faction spy database">
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="global-form-row">
                <label for="gs-enemy-id">Enemy Faction ID</label>
                <input type="text" id="gs-enemy-id" aria-label="Enemy Faction ID" placeholder="Auto-detected in war">
            </div>
            <div class="global-form-row">
                <label for="gs-my-name">Your Callsign</label>
                <input type="text" id="gs-my-name" aria-label="Your Name" placeholder="e.g. Sentinel">
            </div>
        </div>

        <div class="global-form-row">
            <label for="gs-discord-webhook">Global Discord Webhook</label>
            <input type="text" id="gs-discord-webhook" aria-label="Discord Webhook URL" placeholder="https://discord.com/api/webhooks/...">
        </div>

        <div class="global-form-row">
            <label for="gs-api-cpm">API Calls Per Minute Pacing</label>
            <input type="number" id="gs-api-cpm" aria-label="API Calls Per Minute" min="1" max="60" placeholder="12 calls/min">
        </div>

        <button class="global-btn-save" id="gs-btn-save" onclick="saveGlobalSettings()">Save & Synchronize</button>
    </div>
</div>
`;

function injectGlobalSettings() {
    if (document.getElementById('global-settings-modal')) return;
    const div = document.createElement('div');
    div.innerHTML = globalSettingsHTML;
    document.body.appendChild(div);

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeGlobalSettings();
    });

    // Close on backdrop click
    const modal = document.getElementById('global-settings-modal');
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeGlobalSettings();
    });
}

window.openGlobalSettings = async function() {
    injectGlobalSettings();
    const modal = document.getElementById('global-settings-modal');
    modal.style.display = 'flex';
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
                statusText.innerHTML = `<strong style="color:var(--accent-emerald, #10b981);">${data.user.playerName} [${data.user.playerId}]</strong> (${data.user.factionName || 'Factionless'})`;
            } else {
                statusText.innerHTML = '<span style="color:var(--accent-amber, #f59e0b);">Unauthenticated</span>';
            }
        } catch(e) {
            statusText.textContent = 'Active Session';
        }
    } else {
        statusText.innerHTML = '<span style="color:var(--text-tertiary, #64748b);">Not connected (Enter Key below)</span>';
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
            saveBtn.textContent = 'Authenticating Key...';
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
                    saveBtn.textContent = 'Save & Synchronize';
                }
                return;
            }
        } catch(e) {
            alert('Failed to connect API key: ' + e.message);
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save & Synchronize';
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
