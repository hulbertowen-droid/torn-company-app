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
        <button class="global-close-btn" aria-label="Close settings" onclick="closeGlobalSettings()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2>⚙️ Operations & API Settings</h2>
        
        <div id="gs-account-status" class="global-status-box">
            <span class="auth-indicator">🔒 Authentication:</span>
            <span id="gs-status-text" style="font-family:var(--font-mono, monospace); font-size:0.95em;">Checking...</span>
        </div>

        <div class="global-form-row">
            <label for="gs-api-key">Torn API Key (Connect / Switch Account)</label>
            <input type="password" id="gs-api-key" aria-label="Torn API Key" placeholder="Paste Torn API Key to authenticate">
            <div class="helper-text">Saved securely for session & tactical warboard tools.</div>
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
            <label for="gs-discord-webhook">Personal Discord Webhook (Alerts)</label>
            <input type="text" id="gs-discord-webhook" aria-label="Discord Webhook URL" placeholder="https://discord.com/api/webhooks/...">
        </div>

        <div class="global-form-row">
            <label for="gs-api-cpm">API Calls Per Minute Pacing</label>
            <input type="number" id="gs-api-cpm" aria-label="API Calls Per Minute" min="1" max="60" placeholder="12 calls/min">
        </div>

        <button class="global-btn-save" id="gs-btn-save" onclick="saveGlobalSettings()">Save Preferences</button>
        <button type="button" class="global-btn-logout" id="gs-btn-logout" onclick="window.svAuth ? window.svAuth.logout() : (window.svLogout ? window.svLogout() : location.reload())" style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.45); color: #ef4444; padding: 11px; width: 100%; border-radius: var(--radius-sm, 6px); cursor: pointer; font-weight: 800; font-size: 0.88em; text-transform: uppercase; letter-spacing: 0.8px; margin-top: 8px; transition: all 0.15s; font-family: inherit;">🚪 Disconnect Account &amp; Log Out</button>
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


function showGlobalToast(message) {
    let toast = document.getElementById('global-toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'global-toast-notification';
        toast.style.cssText = 'position:fixed;bottom:28px;right:28px;padding:12px 20px;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;font-family:sans-serif;font-size:0.9em;font-weight:700;border-radius:8px;box-shadow:0 10px 25px rgba(0,0,0,0.5),0 0 15px rgba(16,185,129,0.3);z-index:1000000;display:flex;align-items:center;gap:10px;transition:all 0.3s cubic-bezier(0.16,1,0.3,1);transform:translateY(20px);opacity:0;pointer-events:none;';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    setTimeout(() => {
        toast.style.transform = 'translateY(20px)';
        toast.style.opacity = '0';
    }, 2500);
}

window.openGlobalSettings = async function() {
    injectGlobalSettings();
    const modal = document.getElementById('global-settings-modal');
    modal.style.display = 'flex';

    // Client-side preferences only — never auto-populated with server credentials
    const hasAccess = typeof window.hasTornAccess === 'function' ? window.hasTornAccess() : Boolean(localStorage.getItem('sv_session_token'));
    const ffKey = typeof window.getFFScouterKey === 'function' ? window.getFFScouterKey() : (localStorage.getItem('warboard_ffkey') || "");
    const tsKey = typeof window.getTornStatsKey === 'function' ? window.getTornStatsKey() : (localStorage.getItem('warboard_tskey') || "");
    let enemyFacId = localStorage.getItem('warboard_enemyId') || "";
    const myName = localStorage.getItem('warboard_myname') || "";
    const discord = localStorage.getItem('warboard_discord') || "";
    const cpm = localStorage.getItem('warboard_cpm') || "12";

    // SECURITY ENFORCEMENT: Never display raw API keys in input values
    const keyInput = document.getElementById('gs-api-key');
    if (keyInput) keyInput.value = "";

    document.getElementById('gs-ff-key').value = ffKey;
    document.getElementById('gs-ts-key').value = tsKey;
    document.getElementById('gs-enemy-id').value = enemyFacId;
    document.getElementById('gs-my-name').value = myName;
    document.getElementById('gs-discord-webhook').value = discord;
    document.getElementById('gs-api-cpm').value = cpm;

    const statusText = document.getElementById('gs-status-text');
    const logoutBtn = document.getElementById('gs-btn-logout');

    // Immediately show connected badge if a verified session exists in storage (prevents stuck "Verifying connection...")
    let cachedUser = null;
    try {
        const rawU = sessionStorage.getItem('sv_user');
        if (rawU) cachedUser = JSON.parse(rawU);
    } catch (_) {}
    const cachedName = cachedUser?.playerName || localStorage.getItem('warboard_myname') || '';
    const cachedPid = cachedUser?.playerId || localStorage.getItem('warboard_myPlayerId') || '';
    const cachedFid = cachedUser?.factionId || localStorage.getItem('warboard_myFactionId') || '';
    const cachedFname = cachedUser?.factionName || localStorage.getItem('warboard_myFactionName') || 'Faction';

    if (hasAccess && cachedName) {
        const facLabel = cachedFid && String(cachedFid) !== '0' ? `${cachedFname} [${cachedFid}]` : 'Factionless';
        if (keyInput) keyInput.placeholder = `•••••••••••••••• (Connected: ${cachedName} — paste new key to switch)`;
        if (statusText) {
            statusText.innerHTML = `<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.35); padding:4px 8px; border-radius:4px; font-weight:700;">🟢 Connected: ${cachedName}${cachedPid ? ` [${cachedPid}]` : ''} — ${facLabel}</span>`;
        }
        if (logoutBtn) logoutBtn.style.display = 'block';
    } else if (statusText) {
        statusText.innerHTML = '<span style="color:var(--text-secondary, #94a3b8); font-size:0.85em;">⏳ Verifying connection...</span>';
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
        const [verifyRes, gsRes] = await Promise.all([
            fetch('/api/auth/verify', { signal: ctrl.signal }).catch(() => null),
            fetch('/api/global-settings', { signal: ctrl.signal }).catch(() => null)
        ]);
        clearTimeout(timer);

        let gsData = null;
        if (gsRes && gsRes.ok) {
            gsData = await gsRes.json().catch(() => null);
        }
        const detectedEnemy = String((gsData && (gsData.detectedEnemyFacId || gsData.enemyFacId)) || '').trim();
        const enemyInput = document.getElementById('gs-enemy-id');

        if (verifyRes) {
            const data = await verifyRes.json().catch(() => ({}));
            if (verifyRes.ok && data && data.connected) {
                const liveEnemy = String(data.detectedEnemyFacId || detectedEnemy || '').trim();
                // Auto-populate active war opponent whenever warboard detects one (overriding stale hardcoded 49708 or empty field)
                if (liveEnemy && (!enemyFacId || enemyFacId === '49708' || (data.detectedEnemyFacId && enemyFacId !== data.detectedEnemyFacId))) {
                    enemyFacId = liveEnemy;
                    if (enemyInput) {
                        enemyInput.value = liveEnemy;
                        enemyInput.placeholder = `Auto-detected war opponent (${liveEnemy})`;
                    }
                    try { localStorage.setItem('warboard_enemyId', liveEnemy); } catch(e) {}
                }
                const facDisplay = data.faction_id && String(data.faction_id) !== '0'
                    ? `${data.faction_name || 'Faction'} [${data.faction_id}]`
                    : 'Factionless';
                if (keyInput) keyInput.placeholder = `•••••••••••••••• (Connected: ${data.name} — paste new key to switch)`;
                if (statusText) {
                    statusText.innerHTML = `<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.35); padding:4px 8px; border-radius:4px; font-weight:700;">🟢 Connected: ${data.name} [${data.player_id}] — ${facDisplay}</span>`;
                }
                if (logoutBtn) logoutBtn.style.display = 'block';
                return;
            }
            const errMsg = data?.error || (hasAccess ? 'Validation failed' : 'No API Key configured');
            if (keyInput) keyInput.placeholder = "Paste Torn API Key to authenticate";
            if (statusText) {
                statusText.innerHTML = `<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.35); padding:4px 8px; border-radius:4px; font-weight:700;">🔴 Invalid API Key: ${errMsg}</span>`;
            }
            if (logoutBtn) logoutBtn.style.display = hasAccess ? 'block' : 'none';
            return;
        }
        throw new Error('Authentication endpoint unreachable');
    } catch(e) {
        clearTimeout(timer);
        if (keyInput) keyInput.placeholder = "Paste Torn API Key to authenticate";
        if (statusText) {
            const msg = e?.name === 'AbortError' ? 'Torn API validation timed out' : (e?.message || 'Unable to verify API Key');
            statusText.innerHTML = `<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.35); padding:4px 8px; border-radius:4px; font-weight:700;">🔴 Invalid API Key: ${msg}</span>`;
        }
        if (logoutBtn) logoutBtn.style.display = hasAccess ? 'block' : 'none';
    }
};

window.closeGlobalSettings = function() {
    const modal = document.getElementById('global-settings-modal');
    if (modal) modal.style.display = 'none';
};

window.saveGlobalSettings = async function() {
    const saveBtn = document.getElementById('gs-btn-save');
    const statusText = document.getElementById('gs-status-text');
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
            saveBtn.textContent = 'Validating Key with Torn...';
        }
        if (statusText) {
            statusText.innerHTML = '<span style="color:var(--text-secondary, #94a3b8); font-size:0.85em;">⏳ Validating with Torn API...</span>';
        }
        try {
            const vRes = await fetch('/api/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey })
            });
            const vData = await vRes.json().catch(() => ({}));
            if (!vRes.ok || !vData.connected) {
                const errMsg = vData.error || 'Key rejected by Torn API';
                if (statusText) {
                    statusText.innerHTML = `<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.35); padding:4px 8px; border-radius:4px; font-weight:700;">🔴 Invalid API Key: ${errMsg}</span>`;
                }
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save Preferences';
                }
                return;
            }
            const res = await fetch('/api/auth/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey })
            });
            const data = await res.json();
            if (data.success && data.sessionToken) {
                localStorage.setItem('sv_session_token', data.sessionToken);
                if (window.svAuth && typeof window.svAuth.persistProfile === 'function') {
                    window.svAuth.persistProfile(data.user);
                } else {
                    sessionStorage.setItem('sv_user', JSON.stringify(data.user));
                    localStorage.setItem('sv_user', JSON.stringify(data.user));
                }
                if (statusText) {
                    const facDisplay = vData.faction_id && String(vData.faction_id) !== '0'
                        ? `${vData.faction_name || 'Faction'} [${vData.faction_id}]`
                        : 'Factionless';
                    statusText.innerHTML = `<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.35); padding:4px 8px; border-radius:4px; font-weight:700;">🟢 Connected: ${vData.name} [${vData.player_id}] — ${facDisplay}</span>`;
                }
            } else if (data.error) {
                if (statusText) {
                    statusText.innerHTML = `<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.35); padding:4px 8px; border-radius:4px; font-weight:700;">🔴 Invalid API Key: ${data.error}</span>`;
                }
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save Preferences';
                }
                return;
            }
        } catch(e) {
            console.warn('Failed to connect API key to session vault:', e.message);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Preferences';
            }
        }
    }

    // Ensure raw plaintext API keys are never left in client localStorage
    try {
        localStorage.removeItem('warboard_apikey');
        localStorage.removeItem('torn_api_key');
        localStorage.removeItem('tornApiKey');
        localStorage.removeItem('factionos_api_key');
        localStorage.removeItem('apiKey');
    } catch(e) {}

    // Save canonical client preferences locally
    if (ffKey) localStorage.setItem('warboard_ffkey', ffKey); else localStorage.removeItem('warboard_ffkey');
    if (tsKey) localStorage.setItem('warboard_tskey', tsKey); else localStorage.removeItem('warboard_tskey');
    if (enemyFacId) localStorage.setItem('warboard_enemyId', enemyFacId); else localStorage.removeItem('warboard_enemyId');
    if (myName) localStorage.setItem('warboard_myname', myName); else localStorage.removeItem('warboard_myname');
    if (discord) localStorage.setItem('warboard_discord', discord); else localStorage.removeItem('warboard_discord');
    if (cpm) localStorage.setItem('warboard_cpm', cpm);

    showGlobalToast('✅ Settings Saved Successfully!');
    closeGlobalSettings();
    setTimeout(() => { window.location.reload(); }, 600);
};

// Automatically activate Instant Navigation Prefetcher on all pages
(function() {
    if (!document.querySelector('script[src*="instant-nav.js"]')) {
        const s = document.createElement('script');
        s.src = '/instant-nav.js?v=3.2.2';
        s.defer = true;
        document.head.appendChild(s);
    }
})();
