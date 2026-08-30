const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

// Replace item.ID with item.itemID in the Market Watcher
content = content.replace(/myPrices\[item\.ID\]/g, "myPrices[item.itemID]");
content = content.replace(/myPrices\[item\.itemID\] = \{ price: item\.price/g, "myPrices[item.itemID] = { price: item.price");

// Double check the sniper watcher as well to ensure it's not broken
// marketConfig.sniperTargets is populated by the frontend which uses activeSelectedItem.id (which is the true itemID)

fs.writeFileSync(file, content);
console.log('Fixed bazaar watcher item ID mapping');
