const fs = require('fs');

let file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/travel.html';
let html = fs.readFileSync(file, 'utf8');

// The exact old renderTable to replace
const oldRender = /function renderTable\(\) \{[\s\S]*?\}\n\n    window\.onload = loadProfits;/;

const newRender = `function renderTable() {
        const tbody = document.getElementById("profits-tbody");
        if (itemsData.length === 0) return;

        let cap = parseInt(capacityInput.value) || 29;

        // Calculate total profit and sort by Profit/Hr
        let sorted = [...itemsData].map(item => {
            let totalProfit = item.profit * cap;
            let profitPerHr = item.roundTrip > 0 ? (totalProfit / (item.roundTrip / 60)) : 0;
            return {
                ...item,
                totalProfit,
                displayProfitPerHr: profitPerHr
            };
        });
        
        // Push out of stock to bottom, then sort by Profit/Hr
        sorted.sort((a, b) => {
            if (a.stock === 0 && b.stock > 0) return 1;
            if (b.stock === 0 && a.stock > 0) return -1;
            return b.displayProfitPerHr - a.displayProfitPerHr;
        });

        tbody.innerHTML = "";
        for (let item of sorted) {
            let tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid var(--border, #2f3542)";
            tr.style.transition = "background 0.2s";
            tr.onmouseover = () => tr.style.background = "rgba(255,255,255,0.05)";
            tr.onmouseout = () => tr.style.background = "transparent";
            
            let stockColor = item.stock === 0 ? "var(--red, #ff4757)" : (item.stock < cap ? "var(--gold, #ffa502)" : "inherit");
            let stockText = item.stock === 0 ? "Out of Stock" : item.stock.toLocaleString();
            let flightText = item.roundTrip ? \`\${Math.floor(item.roundTrip/60)}h \${item.roundTrip%60}m\` : "Unknown";
            
            let htmlStr = \`
                <td style="padding: 12px 10px; font-weight: bold; border-left: 3px solid \${item.stock === 0 ? 'var(--red)' : 'var(--blue)'};">\${item.name}</td>
                <td style="padding: 12px 10px; color: var(--blue, #3742fa);">\${item.country}</td>
                <td style="padding: 12px 10px; color:\${stockColor}; font-weight:bold;">\${stockText}</td>
                <td style="padding: 12px 10px; color:var(--text-dim);">\${flightText}</td>
                <td style="padding: 12px 10px; color:var(--green, #2ecc71);">\${formatMoney(item.profit)}</td>
                <td style="padding: 12px 10px; color:var(--green, #2ecc71); font-weight:bold;">\${formatMoney(item.totalProfit)}</td>
                <td style="padding: 12px 10px; color:var(--gold, #ffa502); font-weight:bold; font-size: 1.1em; text-shadow: 0 0 5px rgba(255,165,2,0.2);">\${formatMoney(Math.floor(item.displayProfitPerHr))}</td>
            \`;
            
            tr.innerHTML = htmlStr;
            tbody.appendChild(tr);
        }
    }

    window.onload = loadProfits;`;

html = html.replace(oldRender, newRender);

fs.writeFileSync(file, html);
console.log('Fixed renderTable in travel.html');
