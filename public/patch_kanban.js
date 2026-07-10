const fs = require('fs');

let content = fs.readFileSync('public/index.html', 'utf-8');

const kanbanHtml = `
        <div class="view-controls" style="display: flex; justify-content: flex-end; margin-bottom: 15px; gap: 10px; width: 100%; grid-column: 1 / -1;">
            <button class="btn btn-primary" onclick="toggleView('list')" id="btn-view-list">📝 List View</button>
            <button class="btn" onclick="toggleView('kanban')" id="btn-view-kanban">📋 Kanban View</button>
        </div>

        <div id="kanban-view" style="display: none; grid-template-columns: 1fr 1fr 1fr; gap: 20px; grid-column: 1 / -1;">
            <div class="kanban-col glass-card" id="col-ready" ondrop="drop(event)" ondragover="allowDrop(event)">
                <h3 style="color: var(--green); border-bottom: 2px solid var(--green); padding-bottom: 10px;">🟢 Ready to Hit</h3>
                <div class="kanban-cards"></div>
            </div>
            <div class="kanban-col glass-card" id="col-hosp" ondrop="drop(event)" ondragover="allowDrop(event)">
                <h3 style="color: var(--red); border-bottom: 2px solid var(--red); padding-bottom: 10px;">🏥 In Hospital</h3>
                <div class="kanban-cards"></div>
            </div>
            <div class="kanban-col glass-card" id="col-away" ondrop="drop(event)" ondragover="allowDrop(event)">
                <h3 style="color: var(--blue); border-bottom: 2px solid var(--blue); padding-bottom: 10px;">✈️ Traveling/Jail</h3>
                <div class="kanban-cards"></div>
            </div>
        </div>
`;

const kanbanCss = `
        .kanban-col { min-height: 400px; display: flex; flex-direction: column; gap: 10px; }
        .kanban-cards { display: flex; flex-direction: column; gap: 10px; min-height: 100px; }
        .k-card { background: rgba(0,0,0,0.4); border: 1px solid var(--card-border); padding: 10px; border-radius: 8px; cursor: grab; }
        .k-card:active { cursor: grabbing; }
        #list-view-container { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; grid-column: 1 / -1; }
`;

const kanbanJs = `
// Kanban Logic
let currentView = 'list';
let lastEnemyData = [];
function toggleView(view) {
    currentView = view;
    document.getElementById('list-view-container').style.display = view === 'list' ? 'grid' : 'none';
    document.getElementById('kanban-view').style.display = view === 'kanban' ? 'grid' : 'none';
    
    document.getElementById('btn-view-list').className = view === 'list' ? 'btn btn-primary' : 'btn';
    document.getElementById('btn-view-kanban').className = view === 'kanban' ? 'btn btn-primary' : 'btn';
    
    if (view === 'kanban') renderKanban();
}

function allowDrop(ev) { ev.preventDefault(); }
function drag(ev) { ev.dataTransfer.setData("text", ev.target.id); }
function drop(ev) {
    ev.preventDefault();
    var data = ev.dataTransfer.getData("text");
    let target = ev.target.closest('.kanban-col');
    if (target) {
        let enemyId = data.split('-')[1];
        if (target.id === 'col-ready') {
            claimTarget(enemyId);
        }
        target.querySelector('.kanban-cards').appendChild(document.getElementById(data));
    }
}

function renderKanban() {
    const ready = document.querySelector('#col-ready .kanban-cards');
    const hosp = document.querySelector('#col-hosp .kanban-cards');
    const away = document.querySelector('#col-away .kanban-cards');
    if(!ready || !hosp || !away) return;
    ready.innerHTML = ''; hosp.innerHTML = ''; away.innerHTML = '';
    
    lastEnemyData.forEach(e => {
        let card = document.createElement('div');
        card.className = 'k-card';
        card.id = 'kcard-' + e.id;
        card.draggable = true;
        card.ondragstart = drag;
        
        let estStr = e.estStats ? e.estStats.toLocaleString() : 'Unknown';
        card.innerHTML = '<strong>' + e.name + ' [' + e.id + ']</strong><br><small>' + e.state + ' • Est: ' + estStr + '</small>';
        
        if (e.state === 'Okay') ready.appendChild(card);
        else if (e.state === 'Hospital') hosp.appendChild(card);
        else away.appendChild(card);
    });
}
`;

if (content.includes('<div class="chart-row">')) {
    content = content.replace('<div class="chart-row">', kanbanHtml + '\n<div id="list-view-container">\n<div class="chart-row">');
    content = content.replace('<!-- Settings Modal -->', '</div>\n<!-- Settings Modal -->');
}

if (content.includes('</style>')) {
    content = content.replace('</style>', kanbanCss + '</style>');
}

if (content.includes('function updateListDOM')) {
    content = content.replace('function updateListDOM', kanbanJs + '\nfunction updateListDOM');
}

// Hook to capture enemy data
content = content.replace('updateListDOM(enemyList, enemyData);', 'lastEnemyData = enemyData;\n        updateListDOM(enemyList, enemyData);\n        if (currentView === "kanban") renderKanban();');

fs.writeFileSync('public/index.html', content, 'utf-8');
console.log("Kanban applied");
