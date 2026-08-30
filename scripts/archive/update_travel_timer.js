const fs = require('fs');
let file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/travel.html';
let html = fs.readFileSync(file, 'utf8');

// Inject timer HTML
html = html.replace('<h2>Profits <button', '<h2>Profits <span id="restock-timer" style="margin-left: 20px; font-size: 0.6em; background: rgba(88, 166, 255, 0.1); padding: 5px 12px; border-radius: 20px; border: 1px solid var(--accent); color: var(--accent); font-weight: 700; letter-spacing: 1px;">Calculating Restock...</span> <button');

// Inject timer JS
const timerScript = `
    function updateRestockTimer() {
        let now = new Date();
        let mins = now.getUTCMinutes();
        let nextQuarter = Math.ceil((mins + 1) / 15) * 15;
        if (nextQuarter === 60) nextQuarter = 60;
        
        let target = new Date(now);
        target.setUTCMinutes(nextQuarter, 0, 0);
        
        let diff = target - now;
        let m = Math.floor(diff / 60000);
        let s = Math.floor((diff % 60000) / 1000);
        
        let mStr = m.toString().padStart(2, '0');
        let sStr = s.toString().padStart(2, '0');
        
        let text = \`NEXT RESTOCK IN \${mStr}m \${sStr}s\`;
        let el = document.getElementById('restock-timer');
        if (el) {
            el.innerText = text;
            if (m === 0) {
                el.style.color = "var(--gold)";
                el.style.borderColor = "var(--gold)";
                el.style.background = "rgba(240, 194, 57, 0.1)";
            } else {
                el.style.color = "var(--accent)";
                el.style.borderColor = "var(--accent)";
                el.style.background = "rgba(88, 166, 255, 0.1)";
            }
        }
    }
    setInterval(updateRestockTimer, 1000);
    updateRestockTimer();
`;

html = html.replace('window.onload = loadProfits;', 'window.onload = loadProfits;\n' + timerScript);

fs.writeFileSync(file, html);
console.log('Injected restock timer into travel.html');
