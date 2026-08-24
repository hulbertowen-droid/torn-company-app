const fs = require('fs');
const path = require('path');

const getSidebar = (active) => `
    <nav class="sidebar">
        <div class="sidebar-header">
            <div class="logo">
                <div class="logo-icon">⚔️</div>
                <div class="logo-text">
                    <span class="title">OWEN'S FACTION TOOLS</span>
                    <span class="subtitle">Elite Warfare Suite</span>
                </div>
            </div>
        </div>
        <div class="nav-items">
            <a href="/" class="nav-link ${active==='warboard'?'active':''}">📡 <span class="nav-text">Live Warboard</span></a>
            <a href="/simulator.html" class="nav-link ${active==='simulator'?'active':''}">🧠 <span class="nav-text">Combat Simulator</span></a>
            <a href="/weapons.html" class="nav-link ${active==='weapons'?'active':''}">💎 <span class="nav-text">RW Weapon Appraiser</span></a>
            <a href="/forensics.html" class="nav-link ${active==='forensics'?'active':''}">🕵️ <span class="nav-text">Attack Forensics</span></a>
            <a href="/chain.html" class="nav-link ${active==='chain'?'active':''}">🔗 <span class="nav-text">Chain Watcher</span></a>
            <a href="/payout.html" class="nav-link ${active==='payout'?'active':''}">💰 <span class="nav-text">Payouts</span></a>
            <a href="/dashboard.html" class="nav-link ${active==='dashboard'?'active':''}">🛡️ <span class="nav-text">Dashboard</span></a>
            <a href="/members.html" class="nav-link ${active==='members'?'active':''}">👥 <span class="nav-text">Members</span></a>
            <a href="/recruit/" class="nav-link ${active==='recruit'?'active':''}">🎯 <span class="nav-text">Recruit Platform</span></a>
            <a href="/travel.html" class="nav-link ${active==='travel'?'active':''}">✈️ <span class="nav-text">Travel Calculator</span></a>
            <a href="/bazaar.html" class="nav-link ${active==='bazaar'?'active':''}">🛒 <span class="nav-text">Bazaar Watcher</span></a>
            <a href="/discord.html" class="nav-link ${active==='discord'?'active':''}">📢 <span class="nav-text">Discord Alerts</span></a>
            <a href="/oc.html" class="nav-link ${active==='oc'?'active':''}">💼 <span class="nav-text">OC Manager</span></a>
            <a href="/oc-optimizer.html" class="nav-link ${active==='oc-optimizer'?'active':''}">📊 <span class="nav-text">OC 2.0 Optimizer</span></a>
            <div style="margin-top: auto; padding: 0 4px;">
                <div style="height:1px; background:var(--border); margin: 10px 0;"></div>
                <div style="font-size:0.65em; color:var(--text-dim); text-transform:uppercase; letter-spacing:2px; padding:0 8px 6px; font-weight:700;">Company</div>
            </div>
            <a href="/company.html" class="nav-link ${active==='company'?'active':''}" style="background:rgba(0,206,201,0.08);border:1px solid rgba(0,206,201,0.25);color:var(--teal);">🏢 <span class="nav-text">Company Tools</span></a>
            <div style="padding: 0 4px; margin-top:8px;"><div style="height:1px; background:var(--border);"></div></div>
            <a href="/gamble.html" class="nav-link ${active==='gamble'?'active':''}">🎰 <span class="nav-text">Casino Tools</span></a>
            <a onclick="openSettings()" class="nav-link" style="cursor:pointer; margin-top:6px;">⚙️ <span class="nav-text">Settings</span></a>
        </div>
    </nav>
`;

// 1. SIMULATOR.HTML
const simulatorHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Combat Simulator | Owen's Faction Tools</title>
    <link rel="stylesheet" href="/global.css">
    <style>
        .main-content { flex-grow: 1; overflow-y: auto; padding: 25px 35px; height: 100vh; box-sizing: border-box; }
        .sim-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
        @media (max-width: 900px) { .sim-grid { grid-template-columns: 1fr; } }
        .stat-input-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label { font-size: 0.76em; color: var(--text-dim); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
        .form-group input, .form-group select { background: var(--item); border: 1px solid var(--border); color: var(--text-main); padding: 9px 12px; border-radius: 8px; font-family: inherit; font-size: 0.9em; transition: 0.2s; }
        .form-group input:focus, .form-group select:focus { outline: none; border-color: var(--blue); box-shadow: 0 0 0 3px rgba(88,166,255,0.15); }
        .btn-sim { background: linear-gradient(135deg, #ff4757, #ff6b81); color: white; border: none; padding: 14px 28px; border-radius: 10px; font-size: 1.05em; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 20px rgba(255,71,87,0.35); display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; font-family: inherit; }
        .btn-sim:hover { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(255,71,87,0.5); }
        .res-hero { background: linear-gradient(135deg, rgba(13,17,23,0.95), rgba(22,27,34,0.95)); border: 1px solid var(--border); border-radius: 14px; padding: 24px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-around; flex-wrap: wrap; gap: 20px; }
        .win-rate-badge { font-size: 3.5em; font-weight: 900; line-height: 1; }
        .win-rate-badge.danger { color: var(--red); text-shadow: 0 0 25px rgba(255,71,87,0.4); }
        .win-rate-badge.moderate { color: var(--gold); text-shadow: 0 0 25px rgba(255,165,2,0.4); }
        .win-rate-badge.safe { color: var(--green); text-shadow: 0 0 25px rgba(46,213,115,0.4); }
        .kpi-stat-box { background: var(--item); border: 1px solid var(--border); border-radius: 10px; padding: 14px 20px; min-width: 140px; text-align: center; }
        .kpi-stat-box .kpi-num { font-size: 1.6em; font-weight: 900; color: var(--text-main); margin-top: 4px; }
        .kpi-stat-box .kpi-lbl { font-size: 0.72em; color: var(--text-dim); text-transform: uppercase; font-weight: 700; }
        .advice-card { background: rgba(88,166,255,0.06); border: 1px solid rgba(88,166,255,0.25); border-radius: 10px; padding: 16px 20px; }
        .advice-title { font-weight: 800; font-size: 0.9em; color: var(--blue); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
        .advice-item { font-size: 0.85em; color: var(--text-main); margin-bottom: 6px; display: flex; align-items: flex-start; gap: 8px; line-height: 1.5; }
    </style>
</head>
<body>
    ${getSidebar('simulator')}
    <main class="main-content">
        <div class="page-header" style="margin-bottom:20px;">
            <div class="page-title">
                <div class="live-dot" style="background:var(--blue);box-shadow:0 0 10px var(--blue);"></div>
                🧠 AI Combat Simulator &amp; 1v1 Odds Engine
            </div>
            <div style="font-size:0.8em;color:var(--text-dim);">Simulate 500 rounds of combat with weapons, temp items, and armor mitigation</div>
        </div>

        <div class="sim-grid">
            <!-- ATTACKER -->
            <div class="card">
                <div class="card-header" style="border-bottom:1px solid rgba(88,166,255,0.2);display:flex;justify-content:space-between;align-items:center;padding:14px 20px;">
                    <div class="card-title" style="color:var(--blue);font-weight:800;text-transform:uppercase;">⚔️ Attacker (You)</div>
                    <button onclick="loadMyProfileStats()" style="background:rgba(88,166,255,0.1);border:1px solid var(--blue);color:var(--blue);padding:4px 10px;border-radius:6px;font-size:0.72em;font-weight:700;cursor:pointer;font-family:inherit;">Fetch My Stats</button>
                </div>
                <div class="card-body" style="padding:18px 22px;">
                    <div class="stat-input-grid">
                        <div class="form-group"><label>💪 Strength</label><input type="number" id="a-str" value="25000000"></div>
                        <div class="form-group"><label>⚡ Speed</label><input type="number" id="a-spd" value="30000000"></div>
                        <div class="form-group"><label>🛡️ Defense</label><input type="number" id="a-def" value="20000000"></div>
                        <div class="form-group"><label>🎯 Dexterity</label><input type="number" id="a-dex" value="25000000"></div>
                    </div>
                    <div class="stat-input-grid" style="margin-top:14px;">
                        <div class="form-group"><label>🔫 Weapon DMG</label><input type="number" id="a-wep-dmg" value="68"></div>
                        <div class="form-group"><label>🎯 Weapon ACC</label><input type="number" id="a-wep-acc" value="58"></div>
                        <div class="form-group"><label>💣 Temp Weapon</label>
                            <select id="a-temp">
                                <option value="None">None</option>
                                <option value="Smoke Grenade">Smoke Grenade (-50% Spd/Dex)</option>
                                <option value="Flashbang">Flashbang (-50% Str/Dex)</option>
                                <option value="Tear Gas">Tear Gas (-75% Def/Dex)</option>
                                <option value="Pepper Spray">Pepper Spray (Blind/Stun)</option>
                            </select>
                        </div>
                        <div class="form-group"><label>🛡️ Armor Set</label>
                            <select id="a-armor">
                                <option value="Combat">Combat Armor (25% Red.)</option>
                                <option value="Riot">Riot Armor (35% Red.)</option>
                                <option value="Dune">Dune Armor (40% Red.)</option>
                                <option value="Assault">Assault Armor (48% Red.)</option>
                                <option value="Leather">Leather Armor (12% Red.)</option>
                                <option value="None">No Armor (0% Red.)</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <!-- DEFENDER -->
            <div class="card">
                <div class="card-header" style="border-bottom:1px solid rgba(255,71,87,0.2);display:flex;justify-content:space-between;align-items:center;padding:14px 20px;">
                    <div class="card-title" style="color:var(--red);font-weight:800;text-transform:uppercase;">🎯 Defender (Target)</div>
                    <div style="display:flex;gap:6px;">
                        <input type="text" id="target-id-input" placeholder="Torn ID" style="width:90px;padding:3px 8px;font-size:0.75em;background:var(--item);border:1px solid var(--border);color:white;border-radius:4px;font-family:inherit;">
                        <button onclick="fetchTargetSpy()" style="background:rgba(255,71,87,0.1);border:1px solid var(--red);color:var(--red);padding:4px 8px;border-radius:6px;font-size:0.72em;font-weight:700;cursor:pointer;font-family:inherit;">Spy Lookup</button>
                    </div>
                </div>
                <div class="card-body" style="padding:18px 22px;">
                    <div class="stat-input-grid">
                        <div class="form-group"><label>💪 Strength</label><input type="number" id="d-str" value="20000000"></div>
                        <div class="form-group"><label>⚡ Speed</label><input type="number" id="d-spd" value="20000000"></div>
                        <div class="form-group"><label>🛡️ Defense</label><input type="number" id="d-def" value="20000000"></div>
                        <div class="form-group"><label>🎯 Dexterity</label><input type="number" id="d-dex" value="20000000"></div>
                    </div>
                    <div class="stat-input-grid" style="margin-top:14px;">
                        <div class="form-group"><label>🔫 Weapon DMG</label><input type="number" id="d-wep-dmg" value="62"></div>
                        <div class="form-group"><label>🎯 Weapon ACC</label><input type="number" id="d-wep-acc" value="52"></div>
                        <div class="form-group"><label>💣 Temp Weapon</label>
                            <select id="d-temp">
                                <option value="None">None</option>
                                <option value="Smoke Grenade">Smoke Grenade (-50% Spd/Dex)</option>
                                <option value="Flashbang">Flashbang (-50% Str/Dex)</option>
                                <option value="Tear Gas">Tear Gas (-75% Def/Dex)</option>
                                <option value="Pepper Spray">Pepper Spray (Blind/Stun)</option>
                            </select>
                        </div>
                        <div class="form-group"><label>🛡️ Armor Set</label>
                            <select id="d-armor">
                                <option value="Combat">Combat Armor (25% Red.)</option>
                                <option value="Riot">Riot Armor (35% Red.)</option>
                                <option value="Dune">Dune Armor (40% Red.)</option>
                                <option value="Assault">Assault Armor (48% Red.)</option>
                                <option value="Leather">Leather Armor (12% Red.)</option>
                                <option value="None">No Armor (0% Red.)</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <button class="btn-sim" onclick="runSimulation()">⚡ Run 500-Round AI Combat Simulation</button>

        <div id="sim-results" style="display:none;margin-top:28px;">
            <div class="res-hero">
                <div style="text-align:center;">
                    <div style="font-size:0.75em;color:var(--text-dim);text-transform:uppercase;font-weight:700;letter-spacing:1px;margin-bottom:6px;">Estimated Win Probability</div>
                    <div id="res-win-rate" class="win-rate-badge safe">85.4%</div>
                </div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
                    <div class="kpi-stat-box"><div class="kpi-lbl">Avg Turns to Win</div><div id="res-turns-win" class="kpi-num" style="color:var(--green);">3.2</div></div>
                    <div class="kpi-stat-box"><div class="kpi-lbl">Avg DMG per Hit</div><div id="res-dmg-hit" class="kpi-num" style="color:var(--blue);">842</div></div>
                    <div class="kpi-stat-box"><div class="kpi-lbl">Your Hit Accuracy</div><div id="res-hit-acc" class="kpi-num" style="color:var(--gold);">78.4%</div></div>
                    <div class="kpi-stat-box"><div class="kpi-lbl">Target DMG to You</div><div id="res-def-dmg" class="kpi-num" style="color:var(--red);">310</div></div>
                </div>
            </div>

            <div class="advice-card">
                <div class="advice-title">🎯 Tactical Loadout &amp; Strategy Recommendations</div>
                <div id="res-advice-list"></div>
            </div>
        </div>
    </main>

    <script>
        async function runSimulation() {
            const payload = {
                attackerStr: document.getElementById('a-str').value,
                attackerSpd: document.getElementById('a-spd').value,
                attackerDef: document.getElementById('a-def').value,
                attackerDex: document.getElementById('a-dex').value,
                attackerWeaponDmg: document.getElementById('a-wep-dmg').value,
                attackerWeaponAcc: document.getElementById('a-wep-acc').value,
                attackerTemp: document.getElementById('a-temp').value,
                attackerArmor: document.getElementById('a-armor').value,
                defenderStr: document.getElementById('d-str').value,
                defenderSpd: document.getElementById('d-spd').value,
                defenderDef: document.getElementById('d-def').value,
                defenderDex: document.getElementById('d-dex').value,
                defenderWeaponDmg: document.getElementById('d-wep-dmg').value,
                defenderWeaponAcc: document.getElementById('d-wep-acc').value,
                defenderTemp: document.getElementById('d-temp').value,
                defenderArmor: document.getElementById('d-armor').value,
                rounds: 500
            };

            try {
                const res = await fetch('/api/simulate-combat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!data.success) return alert('Simulation error: ' + (data.error || 'Unknown'));

                document.getElementById('sim-results').style.display = 'block';
                const winEl = document.getElementById('res-win-rate');
                winEl.innerText = data.winRate + '%';
                winEl.className = data.winRate >= 80 ? 'win-rate-badge safe' : (data.winRate >= 50 ? 'win-rate-badge moderate' : 'win-rate-badge danger');

                document.getElementById('res-turns-win').innerText = data.avgTurnsWin || '—';
                document.getElementById('res-dmg-hit').innerText = (data.avgAtkDmgPerHit || 0).toLocaleString();
                document.getElementById('res-hit-acc').innerText = (data.atkHitAcc || 0) + '%';
                document.getElementById('res-def-dmg').innerText = (data.avgDefDmgPerHit || 0).toLocaleString();

                const adviceList = document.getElementById('res-advice-list');
                adviceList.innerHTML = (data.tacticalAdvice || []).map(adv => \`<div class="advice-item">\${adv}</div>\`).join('');
                document.getElementById('sim-results').scrollIntoView({ behavior: 'smooth' });
            } catch (e) {
                alert('Simulation request failed: ' + e.message);
            }
        }

        async function fetchTargetSpy() {
            const tId = document.getElementById('target-id-input').value.trim();
            if (!tId) return alert('Please enter a target ID.');
            try {
                const res = await fetch('/api/spy/' + tId);
                const data = await res.json();
                if (data.data && data.data.total) {
                    const str = data.data.strength || Math.round(data.data.total / 4);
                    const spd = data.data.speed || Math.round(data.data.total / 4);
                    const def = data.data.defense || Math.round(data.data.total / 4);
                    const dex = data.data.dexterity || Math.round(data.data.total / 4);
                    document.getElementById('d-str').value = str;
                    document.getElementById('d-spd').value = spd;
                    document.getElementById('d-def').value = def;
                    document.getElementById('d-dex').value = dex;
                    alert('Loaded spy stats for ' + (data.data.name || tId) + ' (Total: ' + data.data.total.toLocaleString() + ')');
                } else {
                    alert('No exact spy report found for [' + tId + ']. You can input estimated stats manually.');
                }
            } catch (e) {
                alert('Spy lookup error: ' + e.message);
            }
        }

        async function loadMyProfileStats() {
            const key = localStorage.getItem('warboard_apikey');
            if (!key) return alert('Please configure your API key in Settings first.');
            try {
                const res = await fetch('https://api.torn.com/user/?selections=battlestats,profile&key=' + key);
                const d = await res.json();
                if (d.error) return alert('Torn API error: ' + d.error.error);
                if (d.strength) document.getElementById('a-str').value = d.strength;
                if (d.speed) document.getElementById('a-spd').value = d.speed;
                if (d.defense) document.getElementById('a-def').value = d.defense;
                if (d.dexterity) document.getElementById('a-dex').value = d.dexterity;
                alert('Loaded battle stats for ' + d.name + '! Total: ' + ((d.strength||0)+(d.speed||0)+(d.defense||0)+(d.dexterity||0)).toLocaleString());
            } catch (e) {
                alert('Failed to fetch user battle stats: ' + e.message);
            }
        }
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, '../public/simulator.html'), simulatorHtml);
console.log('Created public/simulator.html');

// 2. WEAPONS.HTML (Ranked War Weapon Appraiser & Cache EV Matrix)
const weaponsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RW Weapon Appraiser | Owen's Faction Tools</title>
    <link rel="stylesheet" href="/global.css">
    <style>
        .main-content { flex-grow: 1; overflow-y: auto; padding: 25px 35px; height: 100vh; box-sizing: border-box; }
        .appraise-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 24px; margin-bottom: 24px; }
        @media (max-width: 900px) { .appraise-grid { grid-template-columns: 1fr; } }
        .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
        .form-group label { font-size: 0.76em; color: var(--text-dim); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
        .form-group input, .form-group select { background: var(--item); border: 1px solid var(--border); color: var(--text-main); padding: 9px 12px; border-radius: 8px; font-family: inherit; font-size: 0.9em; transition: 0.2s; }
        .form-group input:focus, .form-group select:focus { outline: none; border-color: var(--gold); box-shadow: 0 0 0 3px rgba(255,165,2,0.15); }
        .btn-appraise { background: linear-gradient(135deg, #ffa502, #ffd43b); color: #000; border: none; padding: 14px 28px; border-radius: 10px; font-size: 1.05em; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 20px rgba(255,165,2,0.35); display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; font-family: inherit; }
        .btn-appraise:hover { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(255,165,2,0.5); }
        
        .val-badge-wrap { background: linear-gradient(135deg, rgba(255,165,2,0.08), rgba(255,212,59,0.04)); border: 1px solid rgba(255,165,2,0.3); border-radius: 14px; padding: 22px; text-align: center; margin-bottom: 18px; }
        .val-amount { font-size: 3.2em; font-weight: 900; color: var(--gold); text-shadow: 0 0 20px rgba(255,165,2,0.3); line-height: 1.1; }
        .tier-tag { display: inline-block; padding: 4px 14px; border-radius: 6px; font-weight: 900; font-size: 0.9em; text-transform: uppercase; margin-top: 8px; }
        .tier-tag.s { background: rgba(255,71,87,0.15); color: var(--red); border: 1px solid var(--red); }
        .tier-tag.a { background: rgba(88,166,255,0.15); color: var(--blue); border: 1px solid var(--blue); }
        .tier-tag.b { background: rgba(46,213,115,0.15); color: var(--green); border: 1px solid var(--green); }

        .cache-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .cache-table th, .cache-table td { padding: 12px 14px; border-bottom: 1px solid var(--border); font-size: 0.85em; text-align: left; }
        .cache-table th { color: var(--text-dim); text-transform: uppercase; font-size: 0.75em; }
    </style>
</head>
<body>
    ${getSidebar('weapons')}
    <main class="main-content">
        <div class="page-header" style="margin-bottom:20px;">
            <div class="page-title">
                <div class="live-dot" style="background:var(--gold);box-shadow:0 0 10px var(--gold);"></div>
                💎 Ranked War (RW) Weapon Appraiser &amp; Cache EV
            </div>
            <div style="font-size:0.8em;color:var(--text-dim);">Evaluate market value, combat tiers, and expected cache returns</div>
        </div>

        <div class="appraise-grid">
            <!-- INPUT CARD -->
            <div class="card">
                <div class="card-header" style="padding:14px 20px;border-bottom:1px solid rgba(255,165,2,0.2);">
                    <div class="card-title" style="color:var(--gold);font-weight:800;text-transform:uppercase;">⚙️ Weapon Specifications</div>
                </div>
                <div class="card-body" style="padding:18px 22px;">
                    <div class="form-group">
                        <label>Weapon Base Model</label>
                        <input type="text" id="w-name" value="ArmaLite M-15A2" placeholder="e.g. ArmaLite, BT MP9, Kodachi">
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div class="form-group">
                            <label>Quality Grade</label>
                            <select id="w-quality">
                                <option value="Yellow">Yellow (1 Bonus)</option>
                                <option value="Orange" selected>Orange (2 Bonuses)</option>
                                <option value="Red">Red (2 Bonuses - High Roll)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Slot Category</label>
                            <select id="w-category">
                                <option value="Primary" selected>Primary</option>
                                <option value="Secondary">Secondary</option>
                                <option value="Melee">Melee</option>
                            </select>
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div class="form-group">
                            <label>Damage (Base DMG)</label>
                            <input type="number" id="w-dmg" value="68.4" step="0.1">
                        </div>
                        <div class="form-group">
                            <label>Accuracy (Base ACC)</label>
                            <input type="number" id="w-acc" value="58.2" step="0.1">
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-top:6px;">
                        <div class="form-group">
                            <label>Primary Bonus Type</label>
                            <select id="w-b1">
                                <option value="Bloodlust" selected>Bloodlust (Life Steal)</option>
                                <option value="Warlord">Warlord (Respect %)</option>
                                <option value="Revitalize">Revitalize (Energy Gain)</option>
                                <option value="Specialist">Specialist (DMG Boost)</option>
                                <option value="Expose">Expose (Crit Chance)</option>
                                <option value="Execute">Execute (Insta-Finish)</option>
                                <option value="Eviscerate">Eviscerate (Hosp Time)</option>
                                <option value="Powerful">Powerful (Flat DMG)</option>
                                <option value="Quicken">Quicken (Speed Buff)</option>
                                <option value="Penetrate">Penetrate (Armor Pierce)</option>
                                <option value="Deadeye">Deadeye (Crit DMG)</option>
                                <option value="Plunder">Plunder (Mug Bonus)</option>
                                <option value="Freeze">Freeze (Enemy Slow)</option>
                                <option value="Double-Edged">Double-Edged</option>
                                <option value="Disarm">Disarm</option>
                                <option value="Irradiated">Irradiated</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Bonus 1 % Roll</label>
                            <input type="number" id="w-b1-val" value="28">
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:12px;">
                        <div class="form-group">
                            <label>Secondary Bonus Type</label>
                            <select id="w-b2">
                                <option value="None">None</option>
                                <option value="Powerful" selected>Powerful (Flat DMG)</option>
                                <option value="Quicken">Quicken (Speed Buff)</option>
                                <option value="Penetrate">Penetrate (Armor Pierce)</option>
                                <option value="Deadeye">Deadeye (Crit DMG)</option>
                                <option value="Execute">Execute (Insta-Finish)</option>
                                <option value="Warlord">Warlord (Respect %)</option>
                                <option value="Revitalize">Revitalize (Energy Gain)</option>
                                <option value="Specialist">Specialist (DMG Boost)</option>
                                <option value="Expose">Expose (Crit Chance)</option>
                                <option value="Plunder">Plunder (Mug Bonus)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Bonus 2 % Roll</label>
                            <input type="number" id="w-b2-val" value="18">
                        </div>
                    </div>

                    <button class="btn-appraise" onclick="appraiseWeapon()">💎 Appraise Weapon Value</button>
                </div>
            </div>

            <!-- RESULT CARD -->
            <div class="card">
                <div class="card-header" style="padding:14px 20px;border-bottom:1px solid var(--border);">
                    <div class="card-title" style="text-transform:uppercase;font-weight:800;">📊 Appraisal Report</div>
                </div>
                <div class="card-body" style="padding:18px 22px;">
                    <div class="val-badge-wrap">
                        <div style="font-size:0.75em;color:var(--text-dim);text-transform:uppercase;font-weight:700;letter-spacing:1px;margin-bottom:6px;">Estimated Fair Market Value</div>
                        <div class="val-amount" id="res-val">$320M</div>
                        <div id="res-tier-tag" class="tier-tag s">👑 Tier S+ (God Roll)</div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
                        <div style="background:var(--item);padding:12px 14px;border-radius:8px;border:1px solid var(--border);text-align:center;">
                            <div style="font-size:0.72em;color:var(--text-dim);text-transform:uppercase;font-weight:700;">Quick Sell / Bargain Price</div>
                            <div id="res-bargain" style="font-size:1.3em;font-weight:900;color:var(--green);margin-top:4px;">$256M</div>
                        </div>
                        <div style="background:var(--item);padding:12px 14px;border-radius:8px;border:1px solid var(--border);text-align:center;">
                            <div style="font-size:0.72em;color:var(--text-dim);text-transform:uppercase;font-weight:700;">Premium Asking Price</div>
                            <div id="res-premium" style="font-size:1.3em;font-weight:900;color:var(--gold);margin-top:4px;">$400M</div>
                        </div>
                    </div>

                    <div style="background:rgba(255,255,255,0.02);padding:14px;border-radius:8px;border:1px solid var(--border);margin-bottom:16px;">
                        <div style="font-size:0.85em;font-weight:800;color:var(--text-main);margin-bottom:6px;" id="res-b1-title">Bonus 1: Bloodlust (+28%)</div>
                        <div style="font-size:0.8em;color:var(--text-dim);line-height:1.4;" id="res-b1-desc">Restores life on hit. God-tier sustain in long ranked wars.</div>
                    </div>

                    <div style="background:rgba(255,255,255,0.02);padding:14px;border-radius:8px;border:1px solid var(--border);">
                        <div style="font-size:0.85em;font-weight:800;color:var(--text-main);margin-bottom:6px;" id="res-b2-title">Bonus 2: Powerful (+18%)</div>
                        <div style="font-size:0.8em;color:var(--text-dim);line-height:1.4;" id="res-b2-desc">Flat percentage boost to all outgoing damage.</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- CACHE EV MATRIX -->
        <div class="card" style="margin-top:24px;">
            <div class="card-header" style="padding:14px 20px;border-bottom:1px solid var(--border);">
                <div class="card-title" style="text-transform:uppercase;font-weight:800;color:var(--blue);">📦 Ranked War Cache Expected Value (EV) Matrix</div>
            </div>
            <div class="card-body" style="padding:14px 20px;">
                <table class="cache-table">
                    <thead>
                        <tr>
                            <th>Cache Type</th>
                            <th>Market Cost</th>
                            <th>Yellow Chance</th>
                            <th>Orange Chance</th>
                            <th>Red Chance</th>
                            <th>Expected Value (EV)</th>
                            <th>ROI Rating</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>Small Arms Cache</strong></td>
                            <td>$38,000,000</td>
                            <td>72%</td>
                            <td>24%</td>
                            <td>4%</td>
                            <td style="color:var(--green);font-weight:700;">$48,500,000</td>
                            <td><span style="background:rgba(46,213,115,0.15);color:var(--green);padding:2px 8px;border-radius:4px;font-weight:700;">+27.6% (Profitable)</span></td>
                        </tr>
                        <tr>
                            <td><strong>Medium Arms Cache</strong></td>
                            <td>$75,000,000</td>
                            <td>68%</td>
                            <td>26%</td>
                            <td>6%</td>
                            <td style="color:var(--green);font-weight:700;">$98,000,000</td>
                            <td><span style="background:rgba(46,213,115,0.15);color:var(--green);padding:2px 8px;border-radius:4px;font-weight:700;">+30.6% (Top EV)</span></td>
                        </tr>
                        <tr>
                            <td><strong>Heavy Arms Cache</strong></td>
                            <td>$110,000,000</td>
                            <td>65%</td>
                            <td>28%</td>
                            <td>7%</td>
                            <td style="color:var(--gold);font-weight:700;">$135,000,000</td>
                            <td><span style="background:rgba(255,165,2,0.15);color:var(--gold);padding:2px 8px;border-radius:4px;font-weight:700;">+22.7% (Solid)</span></td>
                        </tr>
                        <tr>
                            <td><strong>Melee Cache</strong></td>
                            <td>$42,000,000</td>
                            <td>75%</td>
                            <td>21%</td>
                            <td>4%</td>
                            <td style="color:var(--red);font-weight:700;">$39,000,000</td>
                            <td><span style="background:rgba(255,71,87,0.15);color:var(--red);padding:2px 8px;border-radius:4px;font-weight:700;">-7.1% (Negative EV)</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </main>

    <script>
        async function appraiseWeapon() {
            const payload = {
                weaponName: document.getElementById('w-name').value,
                quality: document.getElementById('w-quality').value,
                category: document.getElementById('w-category').value,
                damage: document.getElementById('w-dmg').value,
                accuracy: document.getElementById('w-acc').value,
                bonus1: document.getElementById('w-b1').value,
                bonus1Val: document.getElementById('w-b1-val').value,
                bonus2: document.getElementById('w-b2').value,
                bonus2Val: document.getElementById('w-b2-val').value
            };

            try {
                const res = await fetch('/api/weapon-valuator', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!data.success) return alert('Appraisal error: ' + (data.error || 'Unknown'));

                document.getElementById('res-val').innerText = '$' + data.estimatedValueMillions + 'M';
                document.getElementById('res-bargain').innerText = '$' + data.bargainPriceMillions + 'M';
                document.getElementById('res-premium').innerText = '$' + data.premiumPriceMillions + 'M';

                const tierEl = document.getElementById('res-tier-tag');
                tierEl.innerText = data.verdict;
                tierEl.className = data.overallTier.startsWith('S') ? 'tier-tag s' : (data.overallTier === 'A' ? 'tier-tag a' : 'tier-tag b');

                document.getElementById('res-b1-title').innerText = 'Bonus 1: ' + data.bonus1Details.name + ' (+' + data.bonus1Details.value + '%)';
                document.getElementById('res-b1-desc').innerText = data.bonus1Details.desc;

                if (data.bonus2Details.name !== 'None') {
                    document.getElementById('res-b2-title').innerText = 'Bonus 2: ' + data.bonus2Details.name + ' (+' + data.bonus2Details.value + '%)';
                    document.getElementById('res-b2-desc').innerText = data.bonus2Details.desc;
                } else {
                    document.getElementById('res-b2-title').innerText = 'Bonus 2: None';
                    document.getElementById('res-b2-desc').innerText = 'No secondary roll on this weapon.';
                }
            } catch (e) {
                alert('Appraisal failed: ' + e.message);
            }
        }
        window.addEventListener('DOMContentLoaded', appraiseWeapon);
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, '../public/weapons.html'), weaponsHtml);
console.log('Created public/weapons.html');



// 4. FORENSICS.HTML (Stealth Attack Unmasker)
const forensicsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Combat Forensics &amp; Stealth Unmasker | Owen's Faction Tools</title>
    <link rel="stylesheet" href="/global.css">
    <style>
        .main-content { flex-grow: 1; overflow-y: auto; padding: 25px 35px; height: 100vh; box-sizing: border-box; }
        .forensic-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 24px; }
        @media (max-width: 900px) { .forensic-grid { grid-template-columns: 1fr; } }
        .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
        .form-group label { font-size: 0.76em; color: var(--text-dim); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
        .form-group input, .form-group select { background: var(--item); border: 1px solid var(--border); color: var(--text-main); padding: 9px 12px; border-radius: 8px; font-family: inherit; font-size: 0.9em; transition: 0.2s; }
        .btn-unmask { background: linear-gradient(135deg, #a55eea, #8854d0); color: white; border: none; padding: 14px 28px; border-radius: 10px; font-size: 1.05em; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 20px rgba(165,94,234,0.35); display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; font-family: inherit; }
        .btn-unmask:hover { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(165,94,234,0.5); }
        .suspect-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--item); border-radius: 8px; margin-bottom: 8px; }
    </style>
</head>
<body>
    ${getSidebar('forensics')}
    <main class="main-content">
        <div class="page-header" style="margin-bottom:20px;">
            <div class="page-title">
                <div class="live-dot" style="background:#a55eea;box-shadow:0 0 10px #a55eea;"></div>
                🕵️ Combat Forensics &amp; Stealth Attacker Unmasker
            </div>
            <div style="font-size:0.8em;color:var(--text-dim);">Reverse-engineer stealth damage logs to identify hidden attackers</div>
        </div>

        <div class="forensic-grid">
            <div class="card">
                <div class="card-header" style="padding:14px 20px;border-bottom:1px solid rgba(165,94,234,0.2);">
                    <div class="card-title" style="color:#a55eea;font-weight:800;text-transform:uppercase;">📝 Combat Log Entry</div>
                </div>
                <div class="card-body" style="padding:18px 22px;">
                    <div class="form-group">
                        <label>💥 Damage Dealt to You in Log</label>
                        <input type="number" id="f-dmg" value="780" placeholder="e.g. 780">
                    </div>
                    <div class="form-group">
                        <label>🔫 Weapon Used by Attacker</label>
                        <select id="f-wep">
                            <option value="68">ArmaLite M-15A2 (68 DMG)</option>
                            <option value="65">BT MP9 (65 DMG)</option>
                            <option value="62">Enfield SA-80 (62 DMG)</option>
                            <option value="72">Kodachi Melee (72 DMG)</option>
                            <option value="75">Diamond Bludgeon (75 DMG)</option>
                            <option value="58">Dual MP5s (58 DMG)</option>
                            <option value="60">Custom / Standard Weapon (60 DMG)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>🛡️ Your Defense Stat at Time of Hit</label>
                        <input type="number" id="f-def" value="15000000">
                    </div>
                    <div class="form-group">
                        <label>🛡️ Armor Set You Were Wearing</label>
                        <select id="f-armor">
                            <option value="Combat">Combat Armor (25% Red.)</option>
                            <option value="Riot">Riot Armor (35% Red.)</option>
                            <option value="Dune">Dune Armor (40% Red.)</option>
                            <option value="Assault">Assault Armor (48% Red.)</option>
                            <option value="None">No Armor (0% Red.)</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex-direction:row;align-items:center;gap:8px;">
                        <input type="checkbox" id="f-crit" style="width:auto;">
                        <label for="f-crit" style="margin:0;cursor:pointer;">Was this a Critical Hit in the log?</label>
                    </div>

                    <button class="btn-unmask" onclick="unmaskAttacker()">🕵️ Unmask Hidden Attacker</button>
                </div>
            </div>

            <div class="card">
                <div class="card-header" style="padding:14px 20px;border-bottom:1px solid var(--border);">
                    <div class="card-title" style="text-transform:uppercase;font-weight:800;">🔍 Forensics Analysis &amp; Suspects</div>
                </div>
                <div class="card-body" style="padding:18px 22px;">
                    <div style="background:rgba(165,94,234,0.06);border:1px solid rgba(165,94,234,0.3);border-radius:10px;padding:16px 20px;margin-bottom:16px;text-align:center;">
                        <div style="font-size:0.72em;color:var(--text-dim);text-transform:uppercase;font-weight:700;">Calculated Attacker Strength Bracket</div>
                        <div id="res-str-bracket" style="font-size:2em;font-weight:900;color:#a55eea;margin-top:4px;">18.5M - 33.2M</div>
                    </div>

                    <div style="font-size:0.8em;color:var(--text-dim);font-weight:700;text-transform:uppercase;margin-bottom:10px;">Matching Suspects in Spy Database</div>
                    <div id="suspects-list">
                        <div style="color:var(--text-dim);font-style:italic;font-size:0.85em;">Enter combat log data and click Unmask to scan suspects.</div>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <script>
        async function unmaskAttacker() {
            const payload = {
                damageDealt: document.getElementById('f-dmg').value,
                weaponDmg: document.getElementById('f-wep').value,
                defenderDefense: document.getElementById('f-def').value,
                defenderArmor: document.getElementById('f-armor').value,
                isCritical: document.getElementById('f-crit').checked
            };

            try {
                const res = await fetch('/api/unmask-attack', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!data.success) return alert('Forensics error: ' + (data.error || 'Unknown'));

                document.getElementById('res-str-bracket').innerText = (data.estStrMin/1000000).toFixed(1) + 'M — ' + (data.estStrMax/1000000).toFixed(1) + 'M Str';
                
                const list = document.getElementById('suspects-list');
                if (!data.suspects || data.suspects.length === 0) {
                    list.innerHTML = '<div style="color:var(--text-dim);font-size:0.85em;">No exact spy report matches found in this bracket. Attacker estimated at ~' + (data.estStrMid/1000000).toFixed(1) + 'M Strength.</div>';
                    return;
                }

                list.innerHTML = data.suspects.map(s => \`
                    <div class="suspect-row">
                        <div>
                            <div style="font-weight:800;color:var(--text-main);"><a href="https://www.torn.com/profiles.php?XID=\${s.id}" target="_blank" style="color:inherit;text-decoration:none;">\${s.name}</a></div>
                            <div style="font-size:0.75em;color:var(--text-dim);">Est. Str: \${(s.strength/1000000).toFixed(1)}M | Total: \${(s.totalStats/1000000).toFixed(1)}M</div>
                        </div>
                        <div style="text-align:right;">
                            <span style="background:rgba(165,94,234,0.15);color:#a55eea;padding:3px 8px;border-radius:4px;font-weight:800;font-size:0.75em;">\${s.matchConfidence}% Match</span>
                        </div>
                    </div>
                \`).join('');
            } catch (e) {
                alert('Forensics failed: ' + e.message);
            }
        }
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, '../public/forensics.html'), forensicsHtml);
console.log('Created public/forensics.html');

// 5. OC-OPTIMIZER.HTML (Organized Crime 2.0 Optimizer)
const ocOptimizerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OC 2.0 Optimizer | Owen's Faction Tools</title>
    <link rel="stylesheet" href="/global.css">
    <style>
        .main-content { flex-grow: 1; overflow-y: auto; padding: 25px 35px; height: 100vh; box-sizing: border-box; }
        .oc-team-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; transition: 0.2s; }
        .oc-team-card:hover { border-color: var(--teal); }
        .oc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
        .member-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .member-chip { background: var(--item); border: 1px solid var(--border); padding: 5px 12px; border-radius: 6px; font-size: 0.8em; font-weight: 700; }
    </style>
</head>
<body>
    ${getSidebar('oc-optimizer')}
    <main class="main-content">
        <div class="page-header" style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
            <div>
                <div class="page-title">
                    <div class="live-dot" style="background:var(--teal);box-shadow:0 0 10px var(--teal);"></div>
                    📊 Organized Crime (OC 2.0) Team Optimizer
                </div>
                <div style="font-size:0.8em;color:var(--text-dim);">Automated team formation for 99% success rate and maximum respect/cash</div>
            </div>
            <button onclick="fetchOptimization()" style="background:var(--teal);color:#000;border:none;padding:8px 18px;border-radius:8px;font-weight:800;cursor:pointer;">⟳ Re-Optimize Teams</button>
        </div>

        <div id="oc-summary" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:14px;margin-bottom:24px;"></div>
        <div id="teams-list"></div>
    </main>

    <script>
        async function fetchOptimization() {
            try {
                const res = await fetch('/api/oc-optimize');
                const data = await res.json();
                if (!data.success) return alert('OC optimization error: ' + (data.error || 'Unknown'));

                document.getElementById('oc-summary').innerHTML = \`
                    <div class="card" style="padding:16px;text-align:center;"><div style="font-size:0.75em;color:var(--text-dim);text-transform:uppercase;font-weight:700;">Total Members</div><div style="font-size:1.8em;font-weight:900;color:var(--blue);margin-top:4px;">\${data.totalMembers}</div></div>
                    <div class="card" style="padding:16px;text-align:center;"><div style="font-size:0.75em;color:var(--text-dim);text-transform:uppercase;font-weight:700;">Assigned to Teams</div><div style="font-size:1.8em;font-weight:900;color:var(--green);margin-top:4px;">\${data.assignedMembers}</div></div>
                    <div class="card" style="padding:16px;text-align:center;"><div style="font-size:0.75em;color:var(--text-dim);text-transform:uppercase;font-weight:700;">Formed Crime Teams</div><div style="font-size:1.8em;font-weight:900;color:var(--gold);margin-top:4px;">\${data.recommendedTeams.length}</div></div>
                \`;

                document.getElementById('teams-list').innerHTML = data.recommendedTeams.map((t, idx) => \`
                    <div class="oc-team-card">
                        <div class="oc-header">
                            <div>
                                <span style="font-weight:900;color:var(--text-main);font-size:1.1em;">\${idx+1}. \${t.crimeName}</span>
                                <span style="font-size:0.75em;color:var(--green);background:rgba(46,213,115,0.12);padding:2px 8px;border-radius:4px;font-weight:800;margin-left:8px;">\${t.successProb}% Success Prob</span>
                            </div>
                            <div style="font-size:0.85em;color:var(--gold);font-weight:800;">
                                +$\${(t.estPayout/1000000).toFixed(1)}M | +\${t.estRespect} Respect
                            </div>
                        </div>
                        <div style="font-size:0.75em;color:var(--text-dim);text-transform:uppercase;font-weight:700;margin-bottom:8px;">Assigned Team Members (\${t.members.length}/\${t.slots}):</div>
                        <div class="member-chips">
                            \${t.members.map(m => \`<div class="member-chip">👤 \${m.name} <span style="color:var(--text-dim);font-size:0.85em;">(Lvl \${m.level})</span></div>\`).join('')}
                        </div>
                    </div>
                \`).join('');
            } catch (e) {
                console.error(e);
            }
        }
        window.addEventListener('DOMContentLoaded', fetchOptimization);
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, '../public/oc-optimizer.html'), ocOptimizerHtml);
console.log('Created public/oc-optimizer.html');

console.log('ALL NEW PAGES GENERATED SUCCESSFULLY!');

