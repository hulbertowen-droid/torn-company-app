// ==UserScript==
// @name         Torn Dibs Integration (Render App)
// @namespace    http://tampermonkey.net/
// @version      1.0
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
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({ enemyId: enemyId.toString(), playerName: playerName }),
            onload: function(response) {
                fetchClaims();
            }
        });
    }

    function updateUI() {
        const profileLinks = document.querySelectorAll('a[href^="profiles.php?XID="]');
        
        profileLinks.forEach(link => {
            const row = link.closest('li') || link.closest('tr') || link.closest('.member-wrap') || link.parentElement;
            if (!row) return;

            const urlParams = new URLSearchParams(link.href.split('?')[1]);
            const id = urlParams.get('XID');
            if (!id) return;

            let btn = row.querySelector('.dibs-btn-' + id);
            
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'dibs-btn-' + id;
                btn.style.marginLeft = '10px';
                btn.style.padding = '2px 8px';
                btn.style.fontSize = '11px';
                btn.style.borderRadius = '3px';
                btn.style.cursor = 'pointer';
                btn.style.fontWeight = 'bold';
                btn.style.border = '1px solid #333';
                
                if (link.nextSibling) {
                    link.parentNode.insertBefore(btn, link.nextSibling);
                } else {
                    link.parentNode.appendChild(btn);
                }

                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (activeClaims[id]) {
                        alert('Already claimed by ' + activeClaims[id].playerName);
                    } else {
                        btn.innerText = 'Claiming...';
                        claimTarget(id);
                    }
                });
            }

            if (activeClaims[id]) {
                const claimer = activeClaims[id].playerName;
                btn.innerText = claimer === playerName ? '★ Yours' : 'Claimed: ' + claimer;
                btn.style.backgroundColor = claimer === playerName ? '#2ed573' : '#ff4757';
                btn.style.color = 'white';
                btn.style.opacity = claimer === playerName ? '1' : '0.6';
            } else {
                btn.innerText = 'Dibs';
                btn.style.backgroundColor = '#2f3640';
                btn.style.color = '#f5f6fa';
                btn.style.opacity = '1';
            }
        });
    }

    setInterval(fetchClaims, 2500);
    setInterval(updateUI, 1000);
    fetchClaims();

})();
