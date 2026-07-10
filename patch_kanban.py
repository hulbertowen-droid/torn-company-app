import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

kanban_html = """
        <div class="view-controls" style="display: flex; justify-content: flex-end; margin-bottom: 15px; gap: 10px;">
            <button class="btn btn-primary" onclick="toggleView('list')" id="btn-view-list">📝 List View</button>
            <button class="btn" onclick="toggleView('kanban')" id="btn-view-kanban">📋 Kanban View</button>
        </div>

        <div id="kanban-view" style="display: none; grid-template-columns: 1fr 1fr 1fr; gap: 20px;">
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
"""

kanban_css = """
        .kanban-col { min-height: 400px; display: flex; flex-direction: column; gap: 10px; }
        .kanban-cards { display: flex; flex-direction: column; gap: 10px; min-height: 100px; }
        .k-card { background: rgba(0,0,0,0.4); border: 1px solid var(--card-border); padding: 10px; border-radius: 8px; cursor: grab; }
        .k-card:active { cursor: grabbing; }
        #list-view-container { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; }
"""

kanban_js = """
// Kanban Logic
let currentView = 'list';
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
        // Claim action via websocket if dropped into Ready
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
    ready.innerHTML = ''; hosp.innerHTML = ''; away.innerHTML = '';
    
    lastEnemyData.forEach(e => {
        let card = document.createElement('div');
        card.className = 'k-card';
        card.id = 'kcard-' + e.id;
        card.draggable = true;
        card.ondragstart = drag;
        
        card.innerHTML = `<strong>${e.name} [${e.id}]</strong><br><small>${e.state}</small>`;
        
        if (e.state === 'Okay') ready.appendChild(card);
        else if (e.state === 'Hospital') hosp.appendChild(card);
        else away.appendChild(card);
    });
}
"""

if '<div class="chart-row">' in content:
    content = content.replace('<div class="chart-row">', kanban_html + '\n<div id="list-view-container">\n<div class="chart-row">')
    # close the list-view-container div
    # It wraps charts, watchlist, and member columns. We will put the closing div before the Settings Modal
    content = content.replace('<!-- Settings Modal -->', '</div>\n<!-- Settings Modal -->')
    
if '</style>' in content:
    content = content.replace('</style>', kanban_css + '</style>')

if 'function updateListDOM' in content:
    content = content.replace('function updateListDOM', kanban_js + '\nfunction updateListDOM')

# Also add the call to renderKanban inside the main data update loop
content = content.replace('updateListDOM(friendlyList, friendlyData);', 'updateListDOM(friendlyList, friendlyData);\n    if (currentView === "kanban") renderKanban();')

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(content)
print("Kanban applied")
