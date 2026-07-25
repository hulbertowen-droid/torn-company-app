const fs = require('fs');

const files = [
    'company.html',
    'discord.html',
    'oc.html',
    'admin.html'
];

files.forEach(fileName => {
    let file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/' + fileName;
    if (fs.existsSync(file)) {
        let html = fs.readFileSync(file, 'utf8');
        
        // Remove the old sync-configs POST
        const oldSync = /window\.addEventListener\('DOMContentLoaded', \(\) => \{[\s\S]*?body: JSON\.stringify\(\{ [\w]+: JSON\.parse\(s\) \}\) \}\)\.catch\(\(\) => \{\}\);\n\}\);/;
        
        const newSync = `window.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/master-config');
        const data = await res.json();
        if (data.discordConfig && data.discordConfig.apiKey) {
            localStorage.setItem('warboard_apikey', data.discordConfig.apiKey);
        }
        if (data.companyConfig) {
            localStorage.setItem('master_company_config', JSON.stringify(data.companyConfig));
        }
        if (data.ocConfig) {
            localStorage.setItem('master_oc_config', JSON.stringify(data.ocConfig));
        }
        if (data.discordConfig) {
            localStorage.setItem('master_faction_config', JSON.stringify(data.discordConfig));
        }
    } catch(e) {}
});`;

        html = html.replace(oldSync, newSync);
        
        // Let's also check if it has a specific openSettings function that needs to be tweaked.
        // Usually they just read from localStorage which is fine now because DOMContentLoaded populates it!
        
        fs.writeFileSync(file, html);
    }
});
console.log('Fixed DOMContentLoaded in sub-pages');
