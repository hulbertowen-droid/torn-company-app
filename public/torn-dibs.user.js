// ==UserScript==
// @name         Torn Dibs Integration (Render App)
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Integrates the Torn Company App Dibs system directly into the Torn Faction page.
// @author       Owen
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    let backendUrl = GM_getValue('backendUrl', 'https://spider-verse.net');
    let playerName = GM_getValue('playerName', 'MyName');

    function openSettings() {
        const url = prompt('Enter your App URL (e.g. https://spider-verse.net):', backendUrl);
        if (url !== null) {
            backendUrl = url.replace(/\/$/, '');
            GM_setValue('backendUrl', backendUrl);
        }
        
        const name = prompt('Enter your name (this will show when you claim targets):', playerName);
        if (name !== null) {
            playerName = name;
            GM_setValue('playerName', playerName);
        }
        
        alert('Dibs Settings Saved!\\nURL: ' + backendUrl + '\\nName: ' + playerName);
        fetchClaims();
    }

    // Tampermonkey menu
    GM_registerMenuCommand('⚙️ Dibs Settings', openSettings);

    // Inject Responsive CSS for PC and Mobile (Torn PDA)
    const style = document.createElement('style');
    style.innerHTML = `
        .dibs-btn-custom {
            margin-right: 6px;
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
        if (playerName === 'MyName' || !playerName) {
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
        // Floating button in bottom left so it is IMPOSSIBLE to miss on mobile
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

        // Use the Attack icon as the ultimate anchor point. 
        // This works on Mobile, PC, TWSE, Vanilla, Faction page, Search page, and Profile page!
        const attackLinks = document.querySelectorAll('a[href*="loader.php?sid=attack"]');
        
        attackLinks.forEach(attackLink => {
            const urlParams = new URLSearchParams(attackLink.href.split('?')[1]);
            const id = urlParams.get('user2ID');
            if (!id) return;

            let btn = document.querySelector('.dibs-btn-' + id);
            
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'dibs-btn-custom dibs-btn-' + id;
                
                // Inject immediately before the attack button
                if (attackLink.parentNode) {
                    attackLink.parentNode.insertBefore(btn, attackLink);
                    // Ensure the parent is a flex row so they sit next to each other nicely on mobile
                    if (window.getComputedStyle(attackLink.parentNode).display !== 'flex') {
                        attackLink.parentNode.style.display = 'flex';
                        attackLink.parentNode.style.alignItems = 'center';
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
    
    // Fallback: Run once when DOM is fully loaded just in case Torn PDA delays execution
    if (document.readyState === 'complete') {
        fetchClaims();
    } else {
        window.addEventListener('load', fetchClaims);
    }

})();
