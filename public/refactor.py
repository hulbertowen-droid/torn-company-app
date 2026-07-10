import os
import re

directory = r'C:\Users\hulbe\.gemini\antigravity\scratch\torn-company-app\public'
files_to_process = [f for f in os.listdir(directory) if f.endswith('.html')]

sidebar_css_patterns = [
    r':root\s*\{[^}]+\}',
    r'body\s*\{[^}]+\}',
    r'::-webkit-scrollbar\s*\{[^}]+\}',
    r'::-webkit-scrollbar-[^{]+\{[^}]+\}',
    r'\.sidebar\s*\{[^}]+\}',
    r'\.sidebar\.collapsed\s*\{[^}]+\}',
    r'\.sidebar-header\s*\{[^}]+\}',
    r'\.sidebar-logo\s*\{[^}]+\}',
    r'\.toggle-btn\s*\{[^}]+\}',
    r'\.toggle-btn:hover\s*\{[^}]+\}',
    r'\.nav-items\s*\{[^}]+\}',
    r'\.nav-link\s*\{[^}]+\}',
    r'\.nav-link:hover\s*\{[^}]+\}',
    r'\.nav-link\.active\s*\{[^}]+\}',
    r'\.nav-text\s*\{[^}]+\}',
    r'\.main-content\s*\{[^}]+\}',
    r'#toast-container\s*\{[^}]+\}',
    r'\.toast\s*\{[^}]+\}',
    r'\.toast\.[a-z]+\s*\{[^}]+\}',
    r'@keyframes slideIn\s*\{[^}]+\}',
    r'@keyframes fadeOut\s*\{[^}]+\}',
    r'\.modal-overlay\s*\{[^}]+\}',
    r'\.modal\s*\{[^}]+\}',
    r'\.modal-header\s*\{[^}]+\}',
    r'\.modal-close\s*\{[^}]+\}',
    r'\.modal-close:hover\s*\{[^}]+\}',
    r'/\*\s*---\s*SIDEBAR LAYOUT CSS\s*---\s*\*/',
    r'/\*\s*Sidebar Container\s*\*/',
    r'/\*\s*Navigation Links\s*\*/',
    r'/\*\s*Main Content Area\s*\*/',
    r'/\*\s*TOAST NOTIFICATIONS\s*\*/',
    r'/\*\s*SETTINGS MODAL\s*\*/'
]

js_patterns = [
    r'function toggleSidebar\(\)\s*\{[\s\S]*?\}',
    r'function showToast\([^)]+\)\s*\{[\s\S]*?setTimeout\(\(\)\s*=>\s*\{\s*toast\.remove\(\);\s*\},\s*300\);\s*\}, duration\);\s*\}',
    r'function openSettings\(\)\s*\{[\s\S]*?\}',
    r'function closeSettings\(\)\s*\{[\s\S]*?\}',
]

def clean_html(content):
    # Remove sidebar div
    content = re.sub(r'<div class="sidebar">.*?<!-- Main Content -->', '<!-- Main Content -->', content, flags=re.DOTALL)
    content = re.sub(r'<div class="sidebar">.*?<div class="main-content">', '<div class="main-content">', content, flags=re.DOTALL)
    
    # Inject shared css and js
    if 'shared.css' not in content:
        content = content.replace('</head>', '    <link rel="stylesheet" href="shared.css">\n</head>')
    if 'shared.js' not in content:
        content = content.replace('</body>', '    <script src="shared.js"></script>\n</body>')
        
    # Remove duplicated CSS
    for p in sidebar_css_patterns:
        content = re.sub(p, '', content, flags=re.DOTALL)
        
    # Remove duplicated JS
    for p in js_patterns:
        # We use a bit of a lazy approach, but let's see. For showToast the regex is specific.
        # Actually a safer way is to just let regex do its best, and we can manually fix if needed.
        pass
        
    # Remove showToast specifically as it varies slightly
    content = re.sub(r'function showToast\(.*?\n\s*\}\n', '', content, flags=re.DOTALL | re.MULTILINE)
    content = re.sub(r'function toggleSidebar\(\) \{.*?\n\}\n', '', content, flags=re.DOTALL)
    content = re.sub(r'function openSettings\(\) \{.*?\n\}\n', '', content, flags=re.DOTALL)
    content = re.sub(r'function closeSettings\(\) \{.*?\n\}\n', '', content, flags=re.DOTALL)
    
    return content

for file_name in files_to_process:
    path = os.path.join(directory, file_name)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_content = clean_html(content)
    
    # Fix the missing definition in index.html for sendDiscordPing
    if file_name == 'index.html':
        if 'function sendDiscordPing' not in new_content:
            ping_code = """
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
"""
            new_content = new_content.replace('function requestBackup(enemyId, playerName) {', ping_code + '\nfunction requestBackup(enemyId, playerName) {')
            
            # Also fix XSS in name
            new_content = new_content.replace('onclick="requestBackup(\'${r.id}\', \'${r.name}\')"', 'onclick="requestBackup(\'${r.id}\', \'${r.name.replace(/\'/g, "\\\\\'")}\')"')
    
    if file_name == 'recruitment.html':
        new_content = new_content.replace('onclick="openMsgModal(\'${r.id}\', \'${r.name}\'', 'onclick="openMsgModal(\'${r.id}\', \'${r.name.replace(/\'/g, "\\\\\'")}\'')
        
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
        
print("Refactoring complete.")
