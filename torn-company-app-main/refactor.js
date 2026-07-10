const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, 'public');
const filesToProcess = fs.readdirSync(directory).filter(f => f.endsWith('.html'));

const sidebarCssPatterns = [
    /:root\s*\{[^}]+\}/g,
    /body\s*\{[^}]+\}/g,
    /::-webkit-scrollbar\s*\{[^}]+\}/g,
    /::-webkit-scrollbar-[^{]+\{[^}]+\}/g,
    /\.sidebar\s*\{[^}]+\}/g,
    /\.sidebar\.collapsed\s*\{[^}]+\}/g,
    /\.sidebar-header\s*\{[^}]+\}/g,
    /\.sidebar-logo\s*\{[^}]+\}/g,
    /\.toggle-btn\s*\{[^}]+\}/g,
    /\.toggle-btn:hover\s*\{[^}]+\}/g,
    /\.nav-items\s*\{[^}]+\}/g,
    /\.nav-link\s*\{[^}]+\}/g,
    /\.nav-link:hover\s*\{[^}]+\}/g,
    /\.nav-link\.active\s*\{[^}]+\}/g,
    /\.nav-text\s*\{[^}]+\}/g,
    /\.main-content\s*\{[^}]+\}/g,
    /#toast-container\s*\{[^}]+\}/g,
    /\.toast\s*\{[^}]+\}/g,
    /\.toast\.[a-z]+\s*\{[^}]+\}/g,
    /@keyframes slideIn\s*\{[^}]+\}/g,
    /@keyframes fadeOut\s*\{[^}]+\}/g,
    /\.modal-overlay\s*\{[^}]+\}/g,
    /\.modal\s*\{[^}]+\}/g,
    /\.modal-header\s*\{[^}]+\}/g,
    /\.modal-close\s*\{[^}]+\}/g,
    /\.modal-close:hover\s*\{[^}]+\}/g,
    /\/\*\s*---\s*SIDEBAR LAYOUT CSS\s*---\s*\*\//g,
    /\/\*\s*Sidebar Container\s*\*\//g,
    /\/\*\s*Navigation Links\s*\*\//g,
    /\/\*\s*Main Content Area\s*\*\//g,
    /\/\*\s*TOAST NOTIFICATIONS\s*\*\//g,
    /\/\*\s*SETTINGS MODAL\s*\*\//g
];

function cleanHtml(content) {
    // Remove sidebar div
    content = content.replace(/<div class="sidebar">[\s\S]*?<!-- Main Content -->/g, '<!-- Main Content -->');
    content = content.replace(/<div class="sidebar">[\s\S]*?<div class="main-content">/g, '<div class="main-content">');
    
    // Inject shared css and js
    if (!content.includes('shared.css')) {
        content = content.replace('</head>', '    <link rel="stylesheet" href="shared.css">\n</head>');
    }
    if (!content.includes('shared.js')) {
        content = content.replace('</body>', '    <script src="shared.js"></script>\n</body>');
    }
        
    // Remove duplicated CSS
    for (const p of sidebarCssPatterns) {
        content = content.replace(p, '');
    }
        
    // Remove showToast specifically as it varies slightly
    content = content.replace(/function showToast\([\s\S]*?\n\}\n/g, '');
    content = content.replace(/function toggleSidebar\(\) \{[\s\S]*?\n\}\n/g, '');
    content = content.replace(/function openSettings\(\) \{[\s\S]*?\n\}\n/g, '');
    content = content.replace(/function closeSettings\(\) \{[\s\S]*?\n\}\n/g, '');
    
    return content;
}

for (const fileName of filesToProcess) {
    const filePath = path.join(directory, fileName);
    let content = fs.readFileSync(filePath, 'utf-8');
    
    let newContent = cleanHtml(content);
    
    // Fix the missing definition in index.html for sendDiscordPing
    if (fileName === 'index.html') {
        if (!newContent.includes('function sendDiscordPing')) {
            const pingCode = `
async function sendDiscordPing() {
    const webhookUrl = document.getElementById("webhook-url")?.value || "";
    if (!webhookUrl) return showToast("Discord Webhook URL not configured in settings.", "error");
    try {
        await apiCall('/api/discord-ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhookUrl, message: "SOS Backup Requested!" })
        });
        showToast("Backup request sent via Discord!", "success");
    } catch (e) {
        showToast("Failed to send Discord ping.", "error");
    }
}
`;
            newContent = newContent.replace('function requestBackup(enemyId, playerName) {', pingCode + '\nfunction requestBackup(enemyId, playerName) {');
            
            // Also fix XSS in name
            newContent = newContent.replace(/onclick="requestBackup\('\$\{r\.id\}', '\$\{r\.name\}'\)"/g, 'onclick="requestBackup(\'${r.id}\', \'${r.name.replace(/\\\'/g, \\\\\\\')}\')"');
        }
    }
    
    if (fileName === 'recruitment.html') {
        newContent = newContent.replace(/onclick="openMsgModal\('\$\{r\.id\}', '\$\{r\.name\}'/g, 'onclick="openMsgModal(\'${r.id}\', \'${r.name.replace(/\\\'/g, \\\\\\\')}\'');
    }
        
    fs.writeFileSync(filePath, newContent, 'utf-8');
}
console.log("Refactoring complete.");
