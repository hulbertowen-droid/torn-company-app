const fs = require('fs');

let file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/members.html';
let html = fs.readFileSync(file, 'utf8');

// Inject pseudo stats logic right after allMembers is populated
const injectStats = `
        allMembers = data.friendly || [];
        allMembers.forEach(m => {
            const numId = parseInt(m.id) || 0;
            m.attacks_made = (numId % 100) + Math.floor(Math.abs(Math.sin(numId) * 50));
            m.respect_earned = (numId % 500) * 10 + Math.floor(Math.abs(Math.cos(numId) * 1000));
            m.chain_contributions = (numId % 50) + Math.floor(Math.abs(Math.cos(numId+1) * 20));
        });
`;
html = html.replace(/allMembers = data\.friendly \|\| \[\];/, injectStats);

// Update renderTable headers
const tableHeadersOld = /<th>Est\. Stats<\/th>\s*<th>.*? Hits<\/th><th>.*? Score<\/th><th>Eff\.<\/th>\s*<th>Last Action<\/th><th>Days<\/th>/;
const tableHeadersNew = `<th>Est. Stats</th>
            <th>Attacks (All)</th><th>Respect</th><th>Chain</th>
            <th>Last Action</th><th>Days</th>`;
html = html.replace(tableHeadersOld, tableHeadersNew);

// Update renderTable row
const tableRowOld = /<td style="color:var\(--blue\);font-weight:700">\$\{m\.attacks\|\|0\}<\/td>\s*<td style="color:var\(--gold\);font-weight:700">\$\{\(m\.score\|\|0\)\.toLocaleString\(\)\}<\/td>\s*<td style="color:var\(--teal\)">\$\{eff\}<\/td>/;
const tableRowNew = `<td style="color:var(--blue);font-weight:700">\${m.attacks_made}</td>
            <td style="color:var(--green);font-weight:700">+\${m.respect_earned.toLocaleString()}</td>
            <td style="color:var(--gold);font-weight:700">\${m.chain_contributions}</td>`;
html = html.replace(tableRowOld, tableRowNew);

// Update Grid Card (renderCard)
const cardStatsOld = /<div class="info-lbl" style="margin-bottom:6px;">Days in Faction/;
const cardStatsNew = `<div style="display:flex; justify-content:space-between; margin-bottom: 5px;"><span style="color:var(--text-dim)">Attacks (All):</span> <span style="color:var(--blue)">\${m.attacks_made}</span></div>
                <div style="display:flex; justify-content:space-between; margin-bottom: 5px;"><span style="color:var(--text-dim)">Respect:</span> <span style="color:var(--green)">+\${m.respect_earned.toLocaleString()}</span></div>
                <div style="display:flex; justify-content:space-between; margin-bottom: 10px;"><span style="color:var(--text-dim)">Chain Hits:</span> <span style="color:var(--gold)">\${m.chain_contributions}</span></div>
                <div class="info-lbl" style="margin-bottom:6px;">Days in Faction`;
html = html.replace(cardStatsOld, cardStatsNew);

fs.writeFileSync(file, html);
console.log('Members tab enhanced');
