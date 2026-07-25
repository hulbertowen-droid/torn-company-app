const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/travel.html';
let html = fs.readFileSync(file, 'utf8');

// Replace table headers
html = html.replace(/<th style="padding: 10px;">Cost<\/th>[\s\S]*?<th style="padding: 10px;">Total Profit<\/th>/, 
    `<th style="padding: 10px;">Stock (YATA)</th>
                        <th style="padding: 10px;">Flight (RT)</th>
                        <th style="padding: 10px;">Profit / Item</th>
                        <th style="padding: 10px;">Total Profit</th>
                        <th style="padding: 10px;">Profit / Hr</th>`);

// Replace renderTable function
const oldRender = /function renderTable\(\) \{[\s\S]*?\}\s*\}\s*<\/script>/;
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
            
            let stockColor = item.stock === 0 ? "var(--red, #ff4757)" : (item.stock < cap ? "var(--gold, #ffa502)" : "inherit");
            let stockText = item.stock === 0 ? "Out of Stock" : item.stock.toLocaleString();
            
            let htmlStr = \`
                <td style="padding: 10px;">\${item.name}</td>
                <td style="padding: 10px;">\${item.country}</td>
                <td style="padding: 10px; color:\${stockColor}; font-weight:bold;">\${stockText}</td>
                <td style="padding: 10px; color:var(--text-dim);">\${Math.floor(item.roundTrip/60)}h \${item.roundTrip%60}m</td>
                <td style="padding: 10px; color:var(--green, #2ecc71);">\${formatMoney(item.profit)}</td>
                <td style="padding: 10px; color:var(--green, #2ecc71); font-weight:bold;">\${formatMoney(item.totalProfit)}</td>
                <td style="padding: 10px; color:var(--gold, #ffa502); font-weight:bold;">\${formatMoney(Math.floor(item.displayProfitPerHr))}</td>
            \`;
            
            tr.innerHTML = htmlStr;
            tbody.appendChild(tr);
        }
    }
</script>`;

html = html.replace(oldRender, newRender);

// Also fix the colspan in the loading/error states (from 6 to 7)
html = html.replace(/colspan="6"/g, 'colspan="7"');
html = html.replace(/colspan=\\"6\\"/g, 'colspan=\\"7\\"');

fs.writeFileSync(file, html);
console.log("Updated travel.html");
