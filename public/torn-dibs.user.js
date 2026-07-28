// ==UserScript==
// @name         Torn Dibs Integration (Render App)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Integrates the Torn Company App Dibs system directly into the Torn Faction page.
// @author       Owen
// @match        https://www.torn.com/factions.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    let backendUrl = GM_getValue('backendUrl', 'https://torn-company-app.onrender.com');
    let playerName = GM_getValue('playerName', 'MyName');

    GM_registerMenuCommand('⚙️ Set Backend URL', () => {
        const url = prompt('Enter your Render App URL (e.g. https://torn-company-app.onrender.com):', backendUrl);
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
        
        // Pass 1: Identify friendly containers based on the player's name
        let friendlyContainers = new Set();
        profileLinks.forEach(link => {
            if (link.innerText.trim().toLowerCase() === playerName.toLowerCase()) {
                const container = link.closest('tbody') || link.closest('ul') || link.closest('.faction-info-wrap') || link.closest('.members-list');
                if (container) friendlyContainers.add(container);
            }
        });
        
        // Pass 2: Inject buttons only for enemies
        profileLinks.forEach(link => {
            if (link.innerText.trim().length === 0) return; // Skip icons
            
            const row = link.closest('li') || link.closest('tr') || link.closest('.member-wrap');
            if (!row) return;

            // Check if this row is inside a friendly container
            let isFriendly = false;
            for (let container of friendlyContainers) {
                if (container.contains(row)) {
                    isFriendly = true;
                    break;
                }
            }
            if (isFriendly) return; // Do not inject dibs on our own faction

            const urlParams = new URLSearchParams(link.href.split('?')[1]);
            const id = urlParams.get('XID');
            if (!id) return;

            let btn = document.querySelector('.dibs-btn-' + id);
            
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'dibs-btn-' + id;
                
                // Sleek, premium Torn-native styling
                btn.style.marginLeft = 'auto';
                btn.style.marginRight = '8px';
                btn.style.padding = '0px 8px';
                btn.style.fontSize = '11px';
                btn.style.borderRadius = '5px';
                btn.style.cursor = 'pointer';
                btn.style.fontWeight = 'bold';
                btn.style.textTransform = 'uppercase';
                btn.style.verticalAlign = 'middle';
                btn.style.display = 'inline-block';
                btn.style.lineHeight = '20px';
                btn.style.height = '22px';
                btn.style.boxSizing = 'border-box';
                btn.style.boxShadow = '0px 1px 3px rgba(0,0,0,0.5)';
                btn.style.transition = 'all 0.2s ease';
                btn.style.flexShrink = '0';
                
                // Smart injection for TWSE and Vanilla
                const attackLink = row.querySelector('a[href*="loader.php?sid=attack"]');
                
                if (row.tagName === 'TR') {
                    // Vanilla Torn table row
                    let targetCell = attackLink ? attackLink.closest('td') : row.lastElementChild;
                    if (targetCell) targetCell.insertBefore(btn, targetCell.firstChild);
                } else {
                    // TWSE Flexbox row
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
                            btn.innerText = 'Unclaiming...';
                            unclaimTarget(id);
                        } else {
                            alert('Already claimed by ' + activeClaims[id].playerName);
                        }
                    } else {
                        btn.innerText = 'Claiming...';
                        claimTarget(id);
                    }
                });
            }

            if (activeClaims[id]) {
                const claimer = activeClaims[id].playerName;
                const isMine = claimer === playerName;
                
                btn.innerText = isMine ? '★ DROP DIBS' : 'CLAIMED: ' + claimer;
                btn.style.background = isMine ? 'linear-gradient(180deg, #2ed573, #22a055)' : 'linear-gradient(180deg, #ff4757, #cc3845)';
                btn.style.color = '#fff';
                btn.style.border = isMine ? '1px solid #1e8f4c' : '1px solid #a32c37';
                btn.style.textShadow = '1px 1px 1px rgba(0,0,0,0.4)';
                btn.style.opacity = '1';
                
            } else {
                btn.innerText = '🎯 DIBS';
                btn.style.background = 'linear-gradient(180deg, #353b48, #2f3640)';
                btn.style.color = '#f5f6fa';
                btn.style.border = '1px solid #111';
                btn.style.textShadow = 'none';
                btn.style.opacity = '0.9';
            }
        });
    }

    setInterval(fetchClaims, 2500);
    setInterval(updateUI, 1000);
    fetchClaims();

})();
