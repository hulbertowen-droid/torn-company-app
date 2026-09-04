/**
 * F.R.I.D.A.Y Faction Gatekeeper
 * Restricts entire web portal exclusively to verified Spider-Verse [52355] members.
 */
(function() {
    const TARGET_FACTION_ID = '52355';
    const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

    // CSS styling for gatekeeper modal
    const gateStyles = `
    <style id="sv-auth-styles">
        body.sv-auth-locked > *:not(#sv-auth-overlay) {
            filter: blur(14px) !important;
            pointer-events: none !important;
            user-select: none !important;
        }
        #sv-auth-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(10, 12, 18, 0.94);
            backdrop-filter: blur(20px);
            z-index: 9999999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #fff;
            padding: 20px;
            box-sizing: border-box;
        }
        .sv-auth-card {
            background: linear-gradient(145deg, #151922, #0d1117);
            border: 1px solid rgba(0, 206, 201, 0.35);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 35px rgba(0, 206, 201, 0.15);
            border-radius: 16px;
            width: 100%;
            max-width: 480px;
            padding: 36px 32px;
            text-align: center;
            animation: svFadeIn 0.3s ease-out;
        }
        @keyframes svFadeIn {
            from { opacity: 0; transform: translateY(-15px) scale(0.97); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .sv-auth-avatar {
            width: 88px;
            height: 88px;
            border-radius: 50%;
            border: 2px solid #00cec9;
            box-shadow: 0 0 20px rgba(0, 206, 201, 0.4);
            margin: 0 auto 18px;
            display: block;
            object-fit: cover;
        }
        .sv-auth-title {
            font-size: 1.45rem;
            font-weight: 800;
            letter-spacing: 1px;
            color: #f1f2f6;
            margin: 0 0 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        .sv-auth-subtitle {
            font-size: 0.85rem;
            color: #00cec9;
            text-transform: uppercase;
            letter-spacing: 2px;
            font-weight: 700;
            margin-bottom: 22px;
        }
        .sv-auth-desc {
            font-size: 0.9rem;
            color: #a4b0be;
            line-height: 1.5;
            margin-bottom: 24px;
        }
        .sv-auth-input-group {
            text-align: left;
            margin-bottom: 20px;
        }
        .sv-auth-input-group label {
            display: block;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #747d8c;
            margin-bottom: 8px;
            font-weight: 700;
        }
        .sv-auth-input {
            width: 100%;
            padding: 13px 16px;
            background: #080a0f;
            border: 1px solid #2f3542;
            border-radius: 8px;
            color: #fff;
            font-size: 0.95rem;
            outline: none;
            box-sizing: border-box;
            transition: border-color 0.2s, box-shadow 0.2s;
            font-family: monospace;
        }
        .sv-auth-input:focus {
            border-color: #00cec9;
            box-shadow: 0 0 12px rgba(0, 206, 201, 0.3);
        }
        .sv-auth-btn {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #00cec9, #0984e3);
            border: none;
            border-radius: 8px;
            color: #fff;
            font-size: 1rem;
            font-weight: 700;
            letter-spacing: 0.5px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        .sv-auth-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0, 206, 201, 0.4);
        }
        .sv-auth-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .sv-auth-alert {
            margin-top: 18px;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 0.85rem;
            line-height: 1.4;
            display: none;
            text-align: left;
        }
        .sv-auth-alert.error {
            background: rgba(255, 71, 87, 0.15);
            border: 1px solid #ff4757;
            color: #ff6b81;
            display: block;
        }
        .sv-auth-alert.success {
            background: rgba(46, 213, 115, 0.15);
            border: 1px solid #2ed573;
            color: #2ed573;
            display: block;
        }
        .sv-auth-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(0, 206, 201, 0.1);
            border: 1px solid rgba(0, 206, 201, 0.3);
            color: #00cec9;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
        }
    </style>
    `;

    document.head.insertAdjacentHTML('beforeend', gateStyles);

    function getCachedSession() {
        try {
            const raw = localStorage.getItem('sv_session');
            if (!raw) return null;
            const session = JSON.parse(raw);
            if (Date.now() - session.timestamp < SESSION_EXPIRY_MS && session.factionId === TARGET_FACTION_ID) {
                return session;
            }
        } catch(e) {}
        return null;
    }

    function lockPortal() {
        document.body.classList.add('sv-auth-locked');
        if (document.getElementById('sv-auth-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'sv-auth-overlay';
        overlay.innerHTML = `
            <div class="sv-auth-card">
                <img src="/friday_avatar.jpg" alt="F.R.I.D.A.Y" class="sv-auth-avatar" onerror="this.src='/favicon.ico'">
                <div class="sv-auth-title">&#128375;&#65039; Spider-Verse Portal</div>
                <div class="sv-auth-subtitle">Restricted Faction Intelligence</div>
                <p class="sv-auth-desc">
                    This command portal is restricted exclusively to verified members of <strong>Spider-Verse [52355]</strong>. 
                    Please authenticate with your Torn API Key to proceed.
                </p>
                <div class="sv-auth-input-group">
                    <label>Torn API Key (Public / Read-Only is sufficient)</label>
                    <input type="password" id="sv-gate-key" class="sv-auth-input" placeholder="Enter your 16-character Torn API Key..." autocomplete="off">
                </div>
                <button id="sv-gate-btn" class="sv-auth-btn">
                    <span>&#128274; Authenticate Access</span>
                </button>
                <div id="sv-gate-alert" class="sv-auth-alert"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        const input = document.getElementById('sv-gate-key');
        const btn = document.getElementById('sv-gate-btn');
        const alertBox = document.getElementById('sv-gate-alert');

        // Pre-fill existing key if stored
        const existingKey = localStorage.getItem('warboard_apikey');
        if (existingKey) input.value = existingKey;

        async function verifyKey() {
            const key = input.value.trim();
            if (!key) {
                alertBox.className = 'sv-auth-alert error';
                alertBox.innerHTML = '&#9888;&#65039; Please enter your Torn API Key.';
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span>&#8987; Verifying Spider-Verse Credentials...</span>';
            alertBox.className = 'sv-auth-alert';
            alertBox.style.display = 'none';

            try {
                const res = await fetch('/api/auth/verify-faction-access', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey: key })
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    throw new Error(data.reason || 'Verification request failed');
                }

                if (!data.authorized) {
                    alertBox.className = 'sv-auth-alert error';
                    alertBox.innerHTML = `&#10060; <strong>ACCESS DENIED</strong><br>${data.reason}`;
                    btn.disabled = false;
                    btn.innerHTML = '<span>&#128274; Authenticate Access</span>';
                    return;
                }

                // Authorized Spider-Verse member!
                alertBox.className = 'sv-auth-alert success';
                alertBox.innerHTML = `&#9989; Welcome, <strong>${data.player.name}</strong>! Access granted to Spider-Verse [52355].`;
                
                // Store verified session & keys
                localStorage.setItem('sv_session', JSON.stringify({
                    timestamp: Date.now(),
                    playerId: data.player.id,
                    name: data.player.name,
                    role: data.player.role,
                    factionId: data.player.factionId,
                    factionName: data.player.factionName
                }));
                localStorage.setItem('warboard_apikey', key);

                setTimeout(() => {
                    unlockPortal();
                    // If page has a startPolling or init function, trigger it
                    if (typeof window.startPolling === 'function') window.startPolling();
                    if (typeof window.initPage === 'function') window.initPage();
                    if (typeof window.loadRoster === 'function') window.loadRoster();
                }, 800);

            } catch(err) {
                alertBox.className = 'sv-auth-alert error';
                alertBox.innerHTML = `&#9888;&#65039; ${err.message}`;
                btn.disabled = false;
                btn.innerHTML = '<span>&#128274; Authenticate Access</span>';
            }
        }

        btn.addEventListener('click', verifyKey);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyKey(); });
    }

    function unlockPortal() {
        document.body.classList.remove('sv-auth-locked');
        const overlay = document.getElementById('sv-auth-overlay');
        if (overlay) overlay.remove();
        injectUserBadge();
    }

    function injectUserBadge() {
        const session = getCachedSession();
        if (!session) return;

        // Try injecting badge into header or sidebar if exists
        const sidebar = document.querySelector('.sidebar-header') || document.querySelector('.header') || document.querySelector('header');
        if (sidebar && !document.getElementById('sv-user-badge')) {
            const badge = document.createElement('div');
            badge.id = 'sv-user-badge';
            badge.style.cssText = 'padding: 8px 12px; margin: 8px 10px; background: rgba(0,206,201,0.08); border: 1px solid rgba(0,206,201,0.25); border-radius: 8px; font-size: 0.78rem; display: flex; align-items: center; justify-content: space-between;';
            badge.innerHTML = `
                <div>
                    <div style="color: #00cec9; font-weight: 700;">&#128375;&#65039; ${session.name}</div>
                    <div style="color: #a4b0be; font-size: 0.7rem;">Spider-Verse [52355]</div>
                </div>
                <a href="#" id="sv-logout-btn" title="Log out / Switch Key" style="color: #ff6b81; text-decoration: none; font-size: 0.75rem; margin-left: 8px; padding: 2px 6px; border: 1px solid rgba(255,107,129,0.3); border-radius: 4px;">Logout</a>
            `;
            sidebar.appendChild(badge);

            document.getElementById('sv-logout-btn').addEventListener('click', (e) => {
                e.preventDefault();
                if (confirm('Log out of Spider-Verse portal?')) {
                    localStorage.removeItem('sv_session');
                    localStorage.removeItem('warboard_apikey');
                    location.reload();
                }
            });
        }
    }

    // Run check on DOM ready
    window.addEventListener('DOMContentLoaded', () => {
        const session = getCachedSession();
        if (session) {
            injectUserBadge();
        } else {
            // Verify existing key in background if present, else lock portal
            const existingKey = localStorage.getItem('warboard_apikey');
            if (existingKey) {
                fetch('/api/auth/verify-faction-access', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey: existingKey })
                })
                .then(r => r.json())
                .then(data => {
                    if (data.success && data.authorized) {
                        localStorage.setItem('sv_session', JSON.stringify({
                            timestamp: Date.now(),
                            playerId: data.player.id,
                            name: data.player.name,
                            role: data.player.role,
                            factionId: data.player.factionId,
                            factionName: data.player.factionName
                        }));
                        injectUserBadge();
                    } else {
                        lockPortal();
                    }
                })
                .catch(() => lockPortal());
            } else {
                lockPortal();
            }
        }
    });

    window.svLogout = function() {
        localStorage.removeItem('sv_session');
        localStorage.removeItem('warboard_apikey');
        location.reload();
    };
})();
