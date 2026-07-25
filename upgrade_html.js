const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

const cssToAdd = `
        /* Theme & Mobile Inject */
        body.light-mode {
            --bg: #f5f6fa; --card: #ffffff; --item: #f1f2f6; --bg2: #f5f6fa;
            --red: #e84118; --blue: #273c75; --gold: #e1b12c; --teal: #0097e6;
            --text-main: #2f3640; --text-dim: #718093; --text-faint: #dcdde1; --text: #2f3640;
            --border: #dcdde1; --border-light: #f5f6fa;
        }
        .light-mode .sidebar { border-color: #dcdde1; box-shadow: 2px 0 15px rgba(0,0,0,0.05); }
        .light-mode .sidebar-header, .light-mode .panel-header, .light-mode .top-bar { border-color: #dcdde1; background: #ffffff; }
        .light-mode .nav-link:hover { background: #f5f6fa; color: #2f3640; }
        .light-mode .dash-card, .light-mode .watchlist-box, .light-mode .faction-col, .light-mode .modal-content, .light-mode .toast, .light-mode .table-wrap, .light-mode .panel, .light-mode .kpi-card, .light-mode .stock-card { border-color: #dcdde1; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        .light-mode .watch-card, .light-mode .member-card, .light-mode .btn-filter, .light-mode .modal-content input, .light-mode thead { background: #f5f6fa; border-color: #dcdde1; color: #2f3640; }
        .light-mode th { border-color: #dcdde1; }
        .light-mode td { border-color: #f5f6fa; }

        @media (max-width: 768px) {
            body { flex-direction: column; }
            .sidebar { width: 100% !important; height: auto; border-right: none; border-bottom: 1px solid var(--border, #2f3542); z-index: 1000; }
            .sidebar.collapsed { width: 100% !important; }
            .sidebar-header { padding: 10px 20px; }
            .nav-items { display: none; flex-direction: row; flex-wrap: wrap; padding: 10px; justify-content: center; }
            .nav-items.mobile-open { display: flex; }
            .main-content { padding: 15px; height: auto; flex: 1; }
            .container, .chart-row, .grid-2 { grid-template-columns: 1fr !important; }
            .kpi-grid { grid-template-columns: 1fr 1fr !important; }
            .table-wrap, .watchlist-items { overflow-x: auto; }
        }
`;

const jsToAdd = `
<script>
    function toggleTheme() { 
        document.body.classList.toggle('light-mode'); 
        localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark'); 
    }
    if (localStorage.getItem('theme') === 'light') document.body.classList.add('light-mode');
    
    // Override toggleSidebar for mobile
    const originalToggle = typeof toggleSidebar === 'function' ? toggleSidebar : null;
    window.toggleSidebar = function() {
        if (window.innerWidth <= 768) {
            const nav = document.querySelector('.nav-items');
            if (nav) nav.classList.toggle('mobile-open');
        } else if (originalToggle) {
            originalToggle();
        } else {
            const s = document.querySelector('.sidebar');
            if(s) s.classList.toggle('collapsed');
        }
    }
</script>
`;

const themeBtn = `<button class="theme-toggle" onclick="toggleTheme()" title="Toggle Theme" style="background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 1.2em; display: flex; justify-content: center; align-items: center; width: 35px; height: 35px; border-radius: 6px; transition: 0.2s; margin-right: 10px;">🌗</button>`;

files.forEach(file => {
    let p = path.join(publicDir, file);
    let content = fs.readFileSync(p, 'utf8');
    
    // Add CSS
    if (!content.includes('body.light-mode')) {
        content = content.replace('</style>', cssToAdd + '\n</style>');
    }
    
    // Add JS
    if (!content.includes('function toggleTheme()')) {
        content = content.replace('</body>', jsToAdd + '\n</body>');
    }
    
    // Add button next to toggle-btn
    if (!content.includes('class="theme-toggle"')) {
        content = content.replace('<button class="toggle-btn"', themeBtn + '\n            <button class="toggle-btn"');
    }
    
    fs.writeFileSync(p, content);
    console.log('Updated ' + file);
});
