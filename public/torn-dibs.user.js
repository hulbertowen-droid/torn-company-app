// ==UserScript==
// @name         Torn Dibs Integration (Render App)
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  Integrates the Torn Company App Dibs system directly into the Torn Faction page.
// @author       Owen
// @match        https://www.torn.com/*
// @grant        none
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

    // Inject Responsive CSS for PC and Mobile (Torn PDA)
    const style = document.createElement('style');
    style.innerHTML = `
        .dibs-btn-custom {
            margin-right: 6px;
            margin-left: 6px;
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

        /* Mobile Adjustments for Torn PDA and small screens */
        @media (max-width: 768px) {
            .dibs-btn-custom {
                font-size: 9px;
                padding: 0px 4px;
                height: 20px;
                line-height: 18px;
                margin-right: 4px;
                max-width: 80px;
            }
        }
    `;
    document.head.appendChild(style);

    let activeClaims = {};

    function fetchClaims() {
        if (!backendUrl) return;

        fetch(`${backendUrl}/api/claims`)
            .then(res => res.json())
            .then(data => {
                if (data.success && data.claims) {
                    activeClaims = data.claims;
                    updateUI();
                }
            })
            .catch(e => {});
    }

    function claimTarget(enemyId) {
        if (!backendUrl) return alert('Please set your Backend URL in Dibs Settings!');
        if (!playerName || playerName === '') {
            alert('Please set your Player Name in Dibs Settings first!');
            return openSettings();
        }
        
        fetch(`${backendUrl}/api/claim`, {
            method: 'POST',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enemyId: enemyId.toString(), playerName: playerName })
        }).then(() => fetchClaims());
    }

    function unclaimTarget(enemyId) {
        fetch(`${backendUrl}/api/unclaim`, {
            method: 'POST',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enemyId: enemyId.toString(), playerName: playerName })
        }).then(() => fetchClaims());
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
                
                // Try to find the Attack button for ideal placement (PC/TWSE)
                const attackLink = row.querySelector('a[href*="loader.php?sid=attack"]');
                
                if (attackLink && attackLink.parentNode) {
                    attackLink.parentNode.insertBefore(btn, attackLink);
                    if (window.getComputedStyle(attackLink.parentNode).display !== 'flex') {
                        attackLink.parentNode.style.display = 'flex';
                        attackLink.parentNode.style.alignItems = 'center';
                    }
                } else if (link.nextSibling) {
                    // Fallback for Mobile: Put it directly next to the player's name!
                    link.parentNode.insertBefore(btn, link.nextSibling);
                } else {
                    link.parentNode.appendChild(btn);
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
