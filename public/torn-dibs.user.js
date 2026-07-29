// ==UserScript==
// @name         Torn Dibs Integration (Render App)
// @namespace    http://tampermonkey.net/
// @version      1.18
// @description  Integrates the Torn Company App Dibs system directly into the Torn Faction page.
// @author       Owen
// @match        https://www.torn.com/factions.php*
// @match        https://www.torn.com/profiles.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // ---- Settings, migrated transparently from the old localStorage keys ----
    function migrate(key) {
        const val = GM_getValue(key, '');
        if (val) return val;
        const old = localStorage.getItem(key);
        if (old) {
            GM_setValue(key, old);
            return old;
        }
        return '';
    }

    let backendUrl = migrate('dibs_backendUrl') || 'https://spider-verse.net';
    let playerName = migrate('dibs_playerName');
    let playerId = GM_getValue('dibs_playerId', '');

    // ---- Claim / connection state ----
    let activeClaims = {};
    let isFetching = false;
    let hasEverSucceeded = false;
    let consecutiveFailures = 0;
    let pollInterval = null;
    let injectInterval = null;

    const STALE_AFTER_FAILURES = 3; // ~7.5s of no successful contact at the 2.5s poll rate

    // ---- Styles ----
    const style = document.createElement('style');
    style.innerHTML = `
        .dibs-btn-custom {
            margin-left: 8px;
            margin-right: 4px;
            padding: 4px 16px;
            font-size: 13px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 900;
            text-transform: uppercase;
            vertical-align: middle;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: auto;
            min-height: 26px;
            line-height: normal;
            box-sizing: border-box;
            box-shadow: 0px 2px 4px rgba(0,0,0,0.6);
            transition: all 0.2s ease;
            flex-shrink: 0;
            white-space: normal;
            overflow: visible;
            word-break: break-word;
            z-index: 100;
        }

        .dibs-unclaimed {
            background: linear-gradient(180deg, #4b5261, #2f3640);
            color: #f5f6fa;
            border: 1px solid #111;
            text-shadow: none;
            opacity: 1;
        }

        .dibs-mine {
            background: linear-gradient(180deg, #2ed573, #22a055);
            color: #fff;
            border: 1px solid #1e8f4c;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.6);
            opacity: 1;
        }

        .dibs-claimed {
            background: linear-gradient(180deg, #ff4757, #cc3845);
            color: #fff;
            border: 1px solid #a32c37;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.6);
            opacity: 1;
        }

        .dibs-loading {
            background: linear-gradient(180deg, #3a3f4b, #262a33);
            color: #9aa0ac;
            border: 1px dashed #555;
            cursor: not-allowed;
            opacity: 0.85;
        }

        .dibs-stale {
            opacity: 0.7;
            border-style: dashed !important;
        }

        .dibs-settings-float {
            position: fixed;
            bottom: max(20px, env(safe-area-inset-bottom, 20px));
            left: max(20px, env(safe-area-inset-left, 20px));
            background: rgba(0,0,0,0.8);
            color: #fff;
            border: 2px solid #555;
            padding: 10px 16px;
            border-radius: 20px;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            z-index: 9999999;
            backdrop-filter: blur(4px);
            transition: background 0.3s, border-color 0.3s, opacity 0.3s;
        }

        .dibs-settings-float.dibs-offline {
            background: rgba(100,45,20,0.9);
            border-color: #e08a3d;
        }

        .dibs-toast {
            position: fixed;
            bottom: calc(72px + env(safe-area-inset-bottom, 0px));
            left: 50%;
            transform: translateX(-50%) translateY(12px);
            background: rgba(20,20,20,0.96);
            color: #fff;
            padding: 10px 18px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            z-index: 10000001;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s ease, transform 0.25s ease;
            max-width: min(320px, 85vw);
            text-align: center;
            box-shadow: 0px 4px 12px rgba(0,0,0,0.5);
            border: 1px solid #444;
        }

        .dibs-toast-visible {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        .dibs-toast-error {
            border-color: #a32c37;
            background: rgba(60,20,22,0.96);
        }

        .dibs-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            z-index: 10000000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 20px;
            box-sizing: border-box;
        }

        .dibs-modal-overlay.dibs-modal-open {
            display: flex;
        }

        .dibs-modal {
            background: #23262f;
            color: #f5f6fa;
            border-radius: 12px;
            border: 1px solid #444;
            padding: 20px;
            width: min(360px, 100%);
            box-shadow: 0px 10px 30px rgba(0,0,0,0.6);
            font-family: inherit;
            box-sizing: border-box;
        }

        .dibs-modal h3 {
            margin: 0 0 16px 0;
            font-size: 16px;
            font-weight: 700;
        }

        .dibs-modal label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            color: #9aa0ac;
            margin: 14px 0 6px 0;
        }

        .dibs-modal .dibs-optional {
            text-transform: none;
            font-weight: 400;
            color: #6b7280;
        }

        .dibs-modal input {
            width: 100%;
            box-sizing: border-box;
            background: #171920;
            border: 1px solid #444;
            color: #f5f6fa;
            border-radius: 6px;
            padding: 10px 12px;
            font-size: 14px;
            min-height: 40px;
        }

        .dibs-modal input:focus {
            outline: 2px solid #2ed573;
            outline-offset: 1px;
            border-color: #2ed573;
        }

        .dibs-modal-actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }

        .dibs-modal-btn {
            flex: 1;
            padding: 10px 14px;
            border-radius: 6px;
            font-weight: 700;
            font-size: 13px;
            cursor: pointer;
            border: 1px solid #444;
            min-height: 40px;
        }

        .dibs-modal-btn-secondary {
            background: #2f3640;
            color: #f5f6fa;
        }

        .dibs-modal-btn-primary {
            background: linear-gradient(180deg, #2ed573, #22a055);
            color: #fff;
            border-color: #1e8f4c;
        }

        @media (max-width: 768px) {
            .dibs-btn-custom {
                font-size: 13px;
                padding: 8px 14px;
                height: auto;
                min-height: 40px;
                line-height: normal;
                width: 100%;
                margin: 4px 0px;
                border-radius: 6px;
                box-shadow: 0px 2px 4px rgba(0,0,0,0.6);
                display: flex;
                align-items: center;
                justify-content: center;
                text-align: center;
            }
            .dibs-btn-container {
                width: 100%;
                display: block !important;
                padding: 4px 12px;
                box-sizing: border-box;
                clear: both;
            }
            .dibs-settings-float {
                padding: 12px 18px;
                font-size: 14px;
            }
        }
    \`;
    document.head.appendChild(style);

    // ---- Toast ----
    function showToast(message, isError) {
        let toast = document.getElementById('dibsToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'dibsToast';
            toast.className = 'dibs-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.toggle('dibs-toast-error', !!isError);
        toast.classList.add('dibs-toast-visible');
        clearTimeout(toast._dibsHideTimer);
        toast._dibsHideTimer = setTimeout(() => {
            toast.classList.remove('dibs-toast-visible');
        }, 2600);
    }

    // ---- Settings modal (replaces the old prompt()/alert() flow) ----
    function createModal() {
        if (document.getElementById('dibsModalOverlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'dibsModalOverlay';
        overlay.className = 'dibs-modal-overlay';
        overlay.innerHTML = \`
            <div class="dibs-modal" role="dialog" aria-modal="true" aria-labelledby="dibsModalTitle">
                <h3 id="dibsModalTitle">Dibs settings</h3>
                <label for="dibsUrlInput">App URL</label>
                <input type="text" id="dibsUrlInput" placeholder="https://your-app.onrender.com">
                <label for="dibsNameInput">Your name</label>
                <input type="text" id="dibsNameInput" placeholder="Shown to your faction when you claim">
                <label for="dibsIdInput">Your Torn ID <span class="dibs-optional">(optional)</span></label>
                <input type="text" id="dibsIdInput" placeholder="Hides Dibs buttons on your own profile">
                <div class="dibs-modal-actions">
                    <button type="button" id="dibsModalCancel" class="dibs-modal-btn dibs-modal-btn-secondary">Cancel</button>
                    <button type="button" id="dibsModalSave" class="dibs-modal-btn dibs-modal-btn-primary">Save settings</button>
                </div>
            </div>
        \`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeSettingsModal();
        });
        document.getElementById('dibsModalCancel').addEventListener('click', closeSettingsModal);
        document.getElementById('dibsModalSave').addEventListener('click', saveSettingsFromModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('dibs-modal-open')) {
                closeSettingsModal();
            }
        });
    }

    function showSettingsModal() {
        createModal();
        document.getElementById('dibsUrlInput').value = backendUrl || '';
        document.getElementById('dibsNameInput').value = playerName || '';
        document.getElementById('dibsIdInput').value = playerId || '';
        const overlay = document.getElementById('dibsModalOverlay');
        overlay.classList.add('dibs-modal-open');
        setTimeout(() => {
            const input = document.getElementById('dibsUrlInput');
            if (input) input.focus();
        }, 50);
    }

    function closeSettingsModal() {
        const overlay = document.getElementById('dibsModalOverlay');
        if (overlay) overlay.classList.remove('dibs-modal-open');
    }

    function saveSettingsFromModal() {
        const url = document.getElementById('dibsUrlInput').value.trim().replace(/\\/$/, '');
        const name = document.getElementById('dibsNameInput').value.trim();
        const id = document.getElementById('dibsIdInput').value.trim();

        if (!url || !name) {
            showToast('App URL and name are both required', true);
            return;
        }

        backendUrl = url;
        playerName = name;
        playerId = id;
        GM_setValue('dibs_backendUrl', backendUrl);
        GM_setValue('dibs_playerName', playerName);
        GM_setValue('dibs_playerId', playerId);

        closeSettingsModal();
        showToast('Dibs settings saved');

        // Re-run friendly-faction detection against the (possibly new) name/ID
        // instead of leaving already-scanned rows locked to the old decision.
        document.querySelectorAll('a.dibs-processed').forEach(link => link.classList.remove('dibs-processed'));
        fetchClaims();
        injectButtons();
    }

    // ---- Backend calls ----
    function fetchClaims() {
        if (!backendUrl || isFetching) return;

        const buttons = document.getElementsByClassName('dibs-btn-custom');
        const isEnemyFactionPage = window.location.href.includes('step=profile&ID=');

        if (buttons.length === 0 && !isEnemyFactionPage) return;

        isFetching = true;
        GM_xmlhttpRequest({
            method: 'GET',
            url: \`\${backendUrl}/api/claims\`,
            onload: function(response) {
                isFetching = false;
                let ok = false;
                if (response.status >= 200 && response.status < 300) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.success && data.claims) {
                            activeClaims = data.claims;
                            ok = true;
                        }
                    } catch (e) {}
                }
                if (ok) {
                    hasEverSucceeded = true;
                    consecutiveFailures = 0;
                } else {
                    consecutiveFailures++;
                }
                updateUI();
            },
            onerror: function() {
                isFetching = false;
                consecutiveFailures++;
                updateUI();
            }
        });
    }

    function claimTarget(enemyId) {
        if (!backendUrl) {
            showToast('Set your App URL first', true);
            return showSettingsModal();
        }
        if (!playerName) {
            showToast('Set your name first', true);
            return showSettingsModal();
        }

        GM_xmlhttpRequest({
            method: 'POST',
            url: \`\${backendUrl}/api/claim\`,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ enemyId: enemyId.toString(), playerName: playerName }),
            onload: function() { fetchClaims(); },
            onerror: function() {
                showToast('Could not reach the Dibs server', true);
                fetchClaims();
            }
        });
    }

    function unclaimTarget(enemyId) {
        GM_xmlhttpRequest({
            method: 'POST',
            url: \`\${backendUrl}/api/unclaim\`,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ enemyId: enemyId.toString(), playerName: playerName }),
            onload: function() { fetchClaims(); },
            onerror: function() {
                showToast('Could not reach the Dibs server', true);
                fetchClaims();
            }
        });
    }

    // ---- DOM injection ----
    function injectSettingsButton() {
        const isEnemyFactionPage = window.location.href.includes('step=profile&ID=');
        const settingsBtn = document.querySelector('.dibs-settings-float');

        if (isEnemyFactionPage) {
            if (!settingsBtn) {
                const btn = document.createElement('button');
                btn.className = 'dibs-settings-float';
                btn.innerText = '⚙️ Dibs Settings';
                btn.onclick = (e) => {
                    e.preventDefault();
                    showSettingsModal();
                };
                document.body.appendChild(btn);
            } else {
                settingsBtn.style.display = 'block';
            }
        } else if (settingsBtn) {
            settingsBtn.style.display = 'none';
        }
    }

    function injectButtons() {
        injectSettingsButton();

        const newLinks = document.querySelectorAll('a[href*="profiles.php?XID="]:not(.dibs-processed)');
        if (newLinks.length === 0) {
            updateUI();
            return;
        }

        let friendlyContainers = new Set();
        document.querySelectorAll('a[href*="profiles.php?XID="]').forEach(link => {
            const linkParams = new URLSearchParams(link.href.split('?')[1]);
            const linkId = linkParams.get('XID');
            const matchesId = !!playerId && linkId === playerId;
            const matchesName = !!playerName && link.innerText.trim().toLowerCase() === playerName.toLowerCase();
            if (matchesId || matchesName) {
                const container = link.closest('tbody') || link.closest('ul') || link.closest('.faction-info-wrap') || link.closest('.members-list') || link.closest('.table-body');
                if (container) friendlyContainers.add(container);
            }
        });

        newLinks.forEach(link => {
            if (link.innerText.trim().length === 0) return;
            if (link.closest('#sidebar') || link.closest('#header') || link.closest('#top-page-links') || link.closest('.user-info')) return;

            const row = link.closest('li') || link.closest('tr') || link.closest('.member-wrap') || link.closest('.table-row') || link.closest('.user-info-list-wrap');
            if (!row) return;

            let isFriendly = false;
            for (let container of friendlyContainers) {
                if (container.contains(row)) {
                    isFriendly = true;
                    break;
                }
            }

            // Mark processed either way. Previously only non-friendly links got
            // flagged, so the entire friendly roster was rescanned every 2s, forever.
            link.classList.add('dibs-processed');

            if (isFriendly) return;

            const urlParams = new URLSearchParams(link.href.split('?')[1]);
            const id = urlParams.get('XID');
            if (!id) return;

            let btn = document.querySelector('.dibs-btn-' + id);
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'dibs-btn-custom dibs-btn-' + id;
                btn.setAttribute('data-id', id);

                const attackLink = row.querySelector('a[href*="loader.php?sid=attack"]');

                if (attackLink && attackLink.parentNode) {
                    attackLink.parentNode.insertBefore(btn, attackLink);
                    if (window.getComputedStyle(attackLink.parentNode).display !== 'flex') {
                        attackLink.parentNode.style.display = 'flex';
                        attackLink.parentNode.style.alignItems = 'center';
                    }
                } else {
                    const wrap = link.closest('.user-info-list-wrap') || link.closest('.member-wrap') || link.closest('li') || row;
                    let btnContainer = wrap.querySelector('.dibs-btn-container');
                    if (!btnContainer) {
                        btnContainer = document.createElement('div');
                        btnContainer.className = 'dibs-btn-container';
                        wrap.appendChild(btnContainer);
                    }
                    btnContainer.appendChild(btn);
                }

                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (btn.disabled) return;

                    const claim = activeClaims[id];
                    if (claim) {
                        if (claim.playerName.toLowerCase() === playerName.toLowerCase()) {
                            btn.disabled = true;
                            btn.innerText = '...';
                            unclaimTarget(id);
                        } else {
                            showToast('Already claimed by ' + claim.playerName, true);
                        }
                    } else {
                        btn.disabled = true;
                        btn.innerText = '...';
                        claimTarget(id);
                    }
                });
            }
        });

        updateUI();
    }

    function updateSettingsButtonStatus(stale) {
        const settingsBtn = document.querySelector('.dibs-settings-float');
        if (!settingsBtn) return;
        if (stale) {
            settingsBtn.classList.add('dibs-offline');
            settingsBtn.innerText = '⚠️ Dibs (offline)';
        } else {
            settingsBtn.classList.remove('dibs-offline');
            settingsBtn.innerText = '⚙️ Dibs Settings';
        }
    }

    function updateUI() {
        const buttons = document.getElementsByClassName('dibs-btn-custom');
        const stale = hasEverSucceeded && consecutiveFailures >= STALE_AFTER_FAILURES;

        for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const id = btn.getAttribute('data-id');

            if (!hasEverSucceeded) {
                btn.innerText = '… loading';
                btn.className = 'dibs-btn-custom dibs-btn-' + id + ' dibs-loading';
                btn.disabled = true;
                continue;
            }

            let label, cls;
            const claim = activeClaims[id];
            if (claim) {
                const isMine = claim.playerName.toLowerCase() === playerName.toLowerCase();
                label = isMine ? '★ YOURS' : '👑 ' + claim.playerName;
                cls = isMine ? 'dibs-mine' : 'dibs-claimed';
            } else {
                label = '🎯 DIBS';
                cls = 'dibs-unclaimed';
            }

            if (stale) {
                label = '⚠ ' + label;
                cls += ' dibs-stale';
            }

            btn.innerText = label;
            btn.className = 'dibs-btn-custom dibs-btn-' + id + ' ' + cls;
            btn.disabled = false;
        }

        updateSettingsButtonStatus(stale);
    }

    // ---- Timers, paused while the tab/page is hidden ----
    function startTimers() {
        if (!pollInterval) {
            fetchClaims();
            pollInterval = setInterval(fetchClaims, 2500);
        }
        if (!injectInterval) {
            injectInterval = setInterval(() => requestAnimationFrame(injectButtons), 2000);
        }
    }

    function stopTimers() {
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
        if (injectInterval) { clearInterval(injectInterval); injectInterval = null; }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopTimers();
        } else {
            injectButtons();
            startTimers();
        }
    });

    function init() {
        injectButtons();
        if (!document.hidden) {
            startTimers();
        }
    }

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

})();
