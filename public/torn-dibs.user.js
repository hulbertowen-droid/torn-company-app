// ==UserScript==
// @name         Torn Dibs Integration (Render App)
// @namespace    http://tampermonkey.net/
// @version      1.10
// @description  Integrates the Torn Company App Dibs system directly into the Torn Faction page.
// @author       Owen
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // We use localStorage for settings to ensure 100% PDA compatibility without crashing.
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
            padding: 0px 8px;
            font-size: 11px;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            text-transform: uppercase;
            vertical-align: middle;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            line-height: 20px;
            height: 22px;
            box-sizing: border-box;
            box-shadow: 0px 1px 3px rgba(0,0,0,0.5);
            transition: all 0.2s ease;
            flex-shrink: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 150px;
            z-index: 100;
        }
        
        .dibs-unclaimed {
            background: linear-gradient(180deg, #353b48, #2f3640);
            color: #f5f6fa;
            border: 1px solid #111;
            text-shadow: none;
            opacity: 0.9;
        }
        
        .dibs-mine {
            background: linear-gradient(180deg, #2ed573, #22a055);
            color: #fff;
            border: 1px solid #1e8f4c;
            text-shadow: 1px 1px 1px rgba(0,0,0,0.4);
            opacity: 1;
        }
        
        .dibs-claimed {
            background: linear-gradient(180deg, #ff4757, #cc3845);
            color: #fff;
            border: 1px solid #a32c37;
            text-shadow: 1px 1px 1px rgba(0,0,0,0.4);
            opacity: 1;
        }

        .dibs-settings-float {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(0,0,0,0.8);
            color: #fff;
            border: 2px solid #555;
            padding: 8px 12px;
            border-radius: 20px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            z-index: 9999999;
            box-shadow: 0px 4px 10px rgba(0,0,0,0.5);
            backdrop-filter: blur(4px);
        }

        @media (max-width: 768px) {
            .dibs-btn-custom {
                font-size: 9px;
                padding: 0px 6px;
                height: 18px;
                line-height: 16px;
                max-width: 80px;
                margin-top: 2px;
                margin-bottom: 2px;
            }
        }
    `;
    document.head.appendChild(style);

    let activeClaims = {};

    function fetchClaims() {
        if (!backendUrl) return;

        GM_xmlhttpRequest({
            method: 'GET',
            url: `${backendUrl}/api/claims`,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.success && data.claims) {
                        activeClaims = data.claims;
                        updateUI();
                    }
                } catch (e) {
                    // silent fail
                }
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
        if (!document.querySelector('.dibs-settings-float')) {
            const btn = document.createElement('button');
            btn.className = 'dibs-settings-float';
            btn.innerText = '⚙️ Dibs Settings';
            btn.onclick = (e) => {
                e.preventDefault();
                openSettings();
            };
            document.body.appendChild(btn);
        }
    }

    function updateUI() {
        injectSettingsButton();

        const profileLinks = document.querySelectorAll('a[href*="profiles.php?XID="]');
        
        let friendlyContainers = new Set();
        profileLinks.forEach(link => {
            if (link.innerText.trim().toLowerCase() === playerName.toLowerCase()) {
                const container = link.closest('tbody') || link.closest('ul') || link.closest('.faction-info-wrap') || link.closest('.members-list') || link.closest('.table-body');
                if (container) friendlyContainers.add(container);
            }
        });

        profileLinks.forEach(link => {
            if (link.innerText.trim().length === 0) return;

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

            let btn = document.querySelector('.dibs-btn-' + id);
            
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'dibs-btn-custom dibs-btn-' + id;
                
                const attackLink = row.querySelector('a[href*="loader.php?sid=attack"]');
                
                if (attackLink && attackLink.parentNode) {
                    // Ideal PC/TWSE placement
                    attackLink.parentNode.insertBefore(btn, attackLink);
                    if (window.getComputedStyle(attackLink.parentNode).display !== 'flex') {
                        attackLink.parentNode.style.display = 'flex';
                        attackLink.parentNode.style.alignItems = 'center';
                    }
                } else {
                    // Mobile fallback: append it AFTER the name/level container to avoid overlapping
                    const nameContainer = link.closest('div') || link.parentNode;
                    nameContainer.appendChild(btn);
                    nameContainer.style.display = 'flex';
                    nameContainer.style.alignItems = 'center';
                    nameContainer.style.flexWrap = 'wrap'; // Allow it to wrap underneath if screen is too small
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

    setInterval(fetchClaims, 2500);
    setInterval(updateUI, 1000);
    
    if (document.readyState === 'complete') {
        fetchClaims();
    } else {
        window.addEventListener('load', fetchClaims);
    }

})();
