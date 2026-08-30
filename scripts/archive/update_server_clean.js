const fs = require('fs');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

// Remove the admin routes using regex
content = content.replace(/app\.get\('\/api\/admin\/vips'[\s\S]*?\}\);\n/, '');
content = content.replace(/app\.post\('\/api\/admin\/vips'[\s\S]*?\}\);\n/, '');
content = content.replace(/app\.get\('\/api\/admin\/keys'[\s\S]*?\}\);\n/, '');
content = content.replace(/app\.post\('\/api\/admin\/keys'[\s\S]*?\}\);\n/, '');
content = content.replace(/app\.get\('\/api\/admin\/tracking'[\s\S]*?\}\);\n/, '');

// Remove the payment watcher loop
const paymentWatcherStart = content.indexOf('// --- [ ADMIN PAYMENT WATCHER ] ---');
if (paymentWatcherStart !== -1) {
    // Find the end of this setInterval
    const endMatch = content.indexOf('}, 60000);', paymentWatcherStart);
    if (endMatch !== -1) {
        content = content.substring(0, paymentWatcherStart) + content.substring(endMatch + 11);
    }
} else {
    // Alternatively just remove the setInterval that has ADMIN_API_KEY and events
    const reg = /setInterval\(async \(\) => \{\n\s*if \(!ADMIN_API_KEY\) return;[\s\S]*?\}, 60000\);\n/;
    content = content.replace(reg, '');
}

// Remove ADMIN_API_KEY constants
content = content.replace(/const ADMIN_API_KEY = [^\n]+\n/, '');
content = content.replace(/const ADMIN_DISCORD_WEBHOOK = [^\n]+\n/, '');
content = content.replace(/if \(ADMIN_API_KEY\) \{\s*fetch[\s\S]*?\}\n/m, '');
content = content.replace(/if \(ADMIN_API_KEY\) activeKeys\.push\(ADMIN_API_KEY\);\n/, '');
content = content.replace(/let rootKey = ADMIN_API_KEY \|\| discordConfig\.apiKey \|\| watchKey;/, 'let rootKey = discordConfig.apiKey || watchKey;');

fs.writeFileSync(file, content);
console.log('Removed remaining admin/payment logic');
