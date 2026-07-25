const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/index.html';
let html = fs.readFileSync(file, 'utf8');

// Inject user-profile fetch on DOMContentLoaded
const profileFetch = `
        const apiKeyForProfile = localStorage.getItem('warboard_apikey');
        if (apiKeyForProfile) {
            try {
                const pRes = await fetch('/api/get-user-profile?apiKey=' + apiKeyForProfile);
                const pData = await pRes.json();
                if (pData.discordId) localStorage.setItem('warboard_discordId', pData.discordId);
                if (pData.attackThreshold) localStorage.setItem('warboard_attackThreshold', pData.attackThreshold);
            } catch(e) {}
        }
`;

html = html.replace(/(if \(data\.discordConfig\)\s*\{)/, profileFetch + "\n        $1");

fs.writeFileSync(file, html);
console.log('Injected profile fetch into index.html DOMContentLoaded');
