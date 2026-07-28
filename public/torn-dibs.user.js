// ==UserScript==
// @name         Torn Dibs Integration (Render App)
// @namespace    http://tampermonkey.net/
// @version      1.1
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
            backendUrl = url.replace(/\/$/, ''); // remove trailing slash
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
        // Use *= to match TWSE paths like /profiles.php?XID= or https://www.torn.com/profiles.php?XID=
        const profileLinks = document.querySelectorAll('a[href*="profiles.php?XID="]');
        
        profileLinks.forEach(link => {
            // Skip invisible links or icon links that TWSE generates aggressively
            if (link.innerText.trim().length === 0) return;
            
            const row = link.closest('li') || link.closest('tr') || link.closest('.member-wrap') || link.parentElement;
            if (!row) return;

            const urlParams = new URLSearchParams(link.href.split('?')[1]);
            const id = urlParams.get('XID');
            if (!id) return;

            // Search by class to avoid row scoping issues if TWSE moves elements around
            let btn = document.querySelector('.dibs-btn-' + id);
            
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'dibs-btn-' + id;
                
                // Super resilient styling for flexbox
                btn.style.marginLeft = '6px';
                btn.style.padding = '0px 6px';
                btn.style.fontSize = '10px';
                btn.style.borderRadius = '4px';
                btn.style.cursor = 'pointer';
                btn.style.fontWeight = '900';
                btn.style.border = '1px solid #000';
                btn.style.textTransform = 'uppercase';
                btn.style.verticalAlign = 'middle';
                btn.style.display = 'inline-block';
                btn.style.lineHeight = '16px';
                btn.style.height = '18px';
                btn.style.boxSizing = 'border-box';
                
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
                btn.style.border = 'none';
            } else {
                btn.innerText = 'Dibs';
                btn.style.backgroundColor = '#2f3640';
                btn.style.color = '#f5f6fa';
                btn.style.opacity = '1';
                btn.style.border = '1px solid #000';
            }
        });
    }

    setInterval(fetchClaims, 2500);
    setInterval(updateUI, 1000);
    fetchClaims();

})();
