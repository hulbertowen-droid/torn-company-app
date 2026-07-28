// ==UserScript==
// @name         Torn Dibs Integration (Render App)
// @namespace    http://tampermonkey.net/
// @version      1.13
// @description  Integrates the Torn Company App Dibs system directly into the Torn Faction page.
// @author       Owen
// @match        https://www.torn.com/factions.php*
// @match        https://www.torn.com/profiles.php*
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    let backendUrl = localStorage.getItem('dibs_backendUrl') || 'https://spider-verse.net';
    let playerName = localStorage.getItem('dibs_playerName') || '';

    function openSettings() {
        const url = prompt('Enter your App URL (e.g. https://spider-verse.net):', backendUrl);
        if (url !== null) {
            backendUrl = url.replace(/\/$/, '');
            localStorage.setItem('dibs_backendUrl', backendUrl);
        }
        
        const name = prompt('Enter your name (this will show when you claim targets):', playerName);
        if (name !== null) {
            playerName = name;
            localStorage.setItem('dibs_playerName', playerName);
        }
        
        alert('Dibs Settings Saved!\\nURL: ' + backendUrl + '\\nName: ' + playerName);
        fetchClaims();
    }

    const style = document.createElement('style');
    style.innerHTML = `
        .dibs-btn-custom {
            margin-left: 8px;
            margin-right: 4px;
            padding: 0px 12px;
            font-size: 13px; /* Increased from 11px */
            border-radius: 6px;
            cursor: pointer;
            font-weight: 900; /* Made bolder */
            text-transform: uppercase;
            vertical-align: middle;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            line-height: 24px;
            height: 26px; /* Increased from 22px */
            box-sizing: border-box;
            box-shadow: 0px 2px 4px rgba(0,0,0,0.6);
            transition: all 0.2s ease;
            flex-shrink: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 180px; /* Increased from 150px */
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

        .dibs-settings-float {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(0,0,0,0.8);
            color: #fff;
            border: 2px solid #555;
            padding: 10px 16px; /* Bigger settings button */
            border-radius: 20px;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            z-index: 9999999;
            backdrop-filter: blur(4px);
            transition: opacity 0.3s;
        }
        .dibs-settings-float:hover {
            background: rgba(0,0,0,1);
            border-color: #888;
        }

        @media (max-width: 768px) {
            .dibs-btn-custom {
                font-size: 11px; /* Increased from 9px */
                padding: 2px 10px; /* Increased from 0px 6px */
                height: 24px; /* Increased from 18px */
                line-height: 20px;
                max-width: 120px; /* Increased from 80px */
                margin-top: 4px;
                margin-bottom: 4px;
                box-shadow: 0px 2px 5px rgba(0,0,0,0.7);
            }
        }
    `;
    document.head.appendChild(style);

    let activeClaims = {};
    let isFetching = false;

    function fetchClaims() {
        if (!backendUrl || isFetching) return;
        
        const hasButtons = document.querySelectorAll('.dibs-btn-custom').length > 0;
        const isEnemyFactionPage = window.location.href.includes('step=profile&ID=');
        
        if (!hasButtons && !isEnemyFactionPage) return;

        isFetching = true;
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${backendUrl}/api/claims`,
            onload: function(response) {
                isFetching = false;
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.success && data.claims) {
                        activeClaims = data.claims;
                        updateUI();
                    }
                } catch (e) {}
            },
            onerror: function() {
                isFetching = false;
            }
        });
    }

    function claimTarget(enemyId) {
        if (!backendUrl) return alert('Please set your Backend URL in Dibs Settings!');
        if (!playerName || playerName === '') {
            alert('Please set your Player Name in Dibs Settings first!');
            return openSettings();
        }
        
        GM_xmlhttpRequest({
            method: 'POST',
            url: `${backendUrl}/api/claim`,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ enemyId: enemyId.toString(), playerName: playerName }),
            onload: function() { fetchClaims(); }
        });
    }

    function unclaimTarget(enemyId) {
        GM_xmlhttpRequest({
            method: 'POST',
            url: `${backendUrl}/api/unclaim`,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ enemyId: enemyId.toString(), playerName: playerName }),
            onload: function() { fetchClaims(); }
        });
    }

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
                    openSettings();
                };
                document.body.appendChild(btn);
            } else {
                settingsBtn.style.display = 'block';
            }
        } else if (settingsBtn) {
            settingsBtn.style.display = 'none';
        }
    }

    let injectTimeout = null;
    function requestInject() {
        if (injectTimeout) return;
        injectTimeout = setTimeout(() => {
            injectButtons();
            injectTimeout = null;
        }, 150); // Increased debounce to 150ms for smoother performance
    }

    function injectButtons() {
        injectSettingsButton();

        // High-performance query: Native C++ filtering of already processed links instantly!
        const profileLinks = document.querySelectorAll('a[href*="profiles.php?XID="]:not(.dibs-processed)');
        
        if (profileLinks.length === 0) return; // Exit immediately if no new links exist!

        let friendlyContainers = new Set();
        // Check ALL links (even processed ones) to find friendly containers efficiently
        document.querySelectorAll('a[href*="profiles.php?XID="]').forEach(link => {
            if (link.innerText.trim().toLowerCase() === playerName.toLowerCase()) {
                const container = link.closest('tbody') || link.closest('ul') || link.closest('.faction-info-wrap') || link.closest('.members-list') || link.closest('.table-body');
                if (container) friendlyContainers.add(container);
            }
        });

        profileLinks.forEach(link => {
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
            if (isFriendly) return;

            const urlParams = new URLSearchParams(link.href.split('?')[1]);
            const id = urlParams.get('XID');
            if (!id) return;

            // Mark as processed permanently so the browser never checks this link again
            link.classList.add('dibs-processed');

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
                        btnContainer.style.width = '100%';
                        btnContainer.style.display = 'flex';
                        btnContainer.style.justifyContent = 'flex-end';
                        btnContainer.style.paddingTop = '6px';
                        btnContainer.style.paddingRight = '10px';
                        wrap.appendChild(btnContainer);
                    }
                    btnContainer.appendChild(btn);
                }

                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (activeClaims[id]) {
                        if (activeClaims[id].playerName === playerName) {
                            btn.innerText = '...';
                            unclaimTarget(id);
                        } else {
                            alert('Already claimed by ' + activeClaims[id].playerName);
                        }
                    } else {
                        btn.innerText = '...';
                        claimTarget(id);
                    }
                });
            }
        });

        updateUI();
    }

    function updateUI() {
        const buttons = document.querySelectorAll('.dibs-btn-custom');
        buttons.forEach(btn => {
            const id = btn.getAttribute('data-id');
            if (activeClaims[id]) {
                const claimer = activeClaims[id].playerName;
                const isMine = claimer === playerName;
                btn.innerText = isMine ? '★ YOURS' : '👑 ' + claimer;
                btn.className = 'dibs-btn-custom dibs-btn-' + id + (isMine ? ' dibs-mine' : ' dibs-claimed');
            } else {
                btn.innerText = '🎯 DIBS';
                btn.className = 'dibs-btn-custom dibs-btn-' + id + ' dibs-unclaimed';
            }
        });
    }

    const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (let m of mutations) {
            // Highly optimized filter: Only trigger injection if actual elements (not just text like clocks/chat) were added
            if (m.addedNodes.length > 0) {
                for (let i = 0; i < m.addedNodes.length; i++) {
                    const node = m.addedNodes[i];
                    if (node.nodeType === 1) { // 1 == ELEMENT_NODE
                        // If it's a list item, table row, or contains links, trigger an update!
                        if (node.tagName === 'LI' || node.tagName === 'TR' || node.tagName === 'UL' || node.tagName === 'A' || node.querySelector?.('a')) {
                            shouldUpdate = true;
                            break;
                        }
                    }
                }
            }
            if (shouldUpdate) break;
        }
        if (shouldUpdate) requestInject();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(fetchClaims, 2500);
    
    if (document.readyState === 'complete') {
        fetchClaims();
        requestInject();
    } else {
        window.addEventListener('load', () => {
            fetchClaims();
            requestInject();
        });
    }

})();
