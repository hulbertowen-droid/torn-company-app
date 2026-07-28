// ==UserScript==
// @name         Torn Dibs Integration (Render App)
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Integrates the Torn Company App Dibs system directly into the Torn Faction page.
// @author       Owen
// @match        https://www.torn.com/factions.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    let backendUrl = GM_getValue('backendUrl', 'https://spider-verse.net');
    let playerName = GM_getValue('playerName', 'MyName');

    GM_registerMenuCommand('⚙️ Set Backend URL', () => {
        const url = prompt('Enter your Render App URL (e.g. https://spider-verse.net):', backendUrl);
        if (url) {
            backendUrl = url.replace(/\/$/, '');
            GM_setValue('backendUrl', backendUrl);
            alert('Backend URL saved!');
        }
    });

    GM_registerMenuCommand('👤 Set Player Name', () => {
        const name = prompt('Enter your name (this will show when you claim targets):', playerName);
        if (name) {
            playerName = name;
            GM_setValue('playerName', playerName);
            alert('Player Name saved!');
        }
    });

    // Inject Responsive CSS for PC and Mobile (Torn PDA)
    const style = document.createElement('style');
    style.innerHTML = `
        .dibs-btn-custom {
            margin-left: auto;
            margin-right: 8px;
            padding: 0px 8px;
            font-size: 11px;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            text-transform: uppercase;
            vertical-align: middle;
            display: inline-block;
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

        /* Mobile Adjustments for Torn PDA and small screens */
        @media (max-width: 768px) {
            .dibs-btn-custom {
                font-size: 9px;
                padding: 0px 4px;
                height: 18px;
                line-height: 16px;
                margin-right: 4px;
                max-width: 70px; /* Prevent breaking mobile rows */
            }
        }
    `;
    document.head.appendChild(style);

    let activeClaims = {};

    function fetchClaims() {
        if (!backendUrl || backendUrl === 'https://your-app.onrender.com') return;

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
                    console.error('Failed to parse claims:', e);
                }
            }
        });
    }

    function claimTarget(enemyId) {
        if (!backendUrl) return alert('Please set your Backend URL in the Tampermonkey menu first!');
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

    function updateUI() {
        const profileLinks = document.querySelectorAll('a[href*="profiles.php?XID="]');
        
        let friendlyContainers = new Set();
        profileLinks.forEach(link => {
            if (link.innerText.trim().toLowerCase() === playerName.toLowerCase()) {
                const container = link.closest('tbody') || link.closest('ul') || link.closest('.faction-info-wrap') || link.closest('.members-list');
                if (container) friendlyContainers.add(container);
            }
        });
        
        profileLinks.forEach(link => {
            if (link.innerText.trim().length === 0) return;
            
            const row = link.closest('li') || link.closest('tr') || link.closest('.member-wrap');
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
                
                if (row.tagName === 'TR') {
                    let targetCell = attackLink ? attackLink.closest('td') : row.lastElementChild;
                    if (targetCell) targetCell.insertBefore(btn, targetCell.firstChild);
                } else {
                    if (attackLink && attackLink.parentNode) {
                        attackLink.parentNode.insertBefore(btn, attackLink);
                    } else {
                        row.appendChild(btn);
                    }
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

            // Update button visual state
            if (activeClaims[id]) {
                const claimer = activeClaims[id].playerName;
                const isMine = claimer === playerName;
                
                // Keep text short for mobile support (CSS handles the max-width clipping)
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
    fetchClaims();

})();
