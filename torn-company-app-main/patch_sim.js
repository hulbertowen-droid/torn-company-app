const fs = require('fs');

let content = fs.readFileSync('public/index.html', 'utf-8');

const simHtml = `
            <div id="combat-sim-box" style="margin-top: 20px; padding: 15px; background: rgba(0,0,0,0.5); border: 1px solid var(--card-border); border-radius: 8px;">
                <h4 style="margin: 0 0 10px 0; color: var(--gold); border-bottom: 1px solid #333; padding-bottom: 5px;">⚔️ Monte Carlo Combat Simulator</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                    <div>
                        <label style="font-size: 0.8em; color: #888;">My Total Stats</label>
                        <input type="number" id="sim-my-stats" class="settings-input" placeholder="e.g. 500000000" style="padding: 5px; font-size: 0.9em; width: 100%; box-sizing: border-box;">
                    </div>
                    <div>
                        <label style="font-size: 0.8em; color: #888;">Enemy Est. Stats</label>
                        <input type="number" id="sim-enemy-stats" class="settings-input" readonly style="padding: 5px; font-size: 0.9em; width: 100%; box-sizing: border-box; background: #111;">
                    </div>
                </div>
                <button class="btn btn-primary" onclick="runSim()" style="width: 100%;">Run 1,000 Simulations</button>
                <div id="sim-result" style="margin-top: 10px; text-align: center; font-size: 1.2em; font-weight: bold;"></div>
            </div>
`;

const simJs = `
function runSim() {
    const myStats = parseFloat(document.getElementById('sim-my-stats').value) || 10000;
    const enemyStats = parseFloat(document.getElementById('sim-enemy-stats').value) || 10000;
    
    let wins = 0;
    const iterations = 1000;
    for(let i=0; i<iterations; i++) {
        let myRoll = myStats * (0.8 + Math.random() * 0.4);
        let enemyRoll = enemyStats * (0.8 + Math.random() * 0.4);
        if (myRoll > enemyRoll) wins++;
    }
    
    const winProb = Math.round((wins / iterations) * 100);
    const resultDiv = document.getElementById('sim-result');
    if (winProb > 70) resultDiv.style.color = 'var(--green)';
    else if (winProb > 40) resultDiv.style.color = 'var(--gold)';
    else resultDiv.style.color = 'var(--red)';
    
    resultDiv.innerHTML = 'Win Probability: ' + winProb + '%';
}
`;

if (content.includes('id="inspect-logs"')) {
    content = content.replace('<div id="inspect-logs"', simHtml + '\n<div id="inspect-logs"');
}

if (content.includes('function openInspect')) {
    content = content.replace('function openInspect', simJs + '\nfunction openInspect');
    // auto-fill enemy stats when inspect opens
    content = content.replace('document.getElementById(\'inspect-logs\').innerHTML =', 'document.getElementById("sim-result").innerHTML = ""; document.getElementById("sim-enemy-stats").value = est || 0;\n        document.getElementById(\'inspect-logs\').innerHTML =');
}

fs.writeFileSync('public/index.html', content, 'utf-8');
console.log("Simulator applied");
