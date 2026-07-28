// ==UserScript==
// @name         Torn Dibs Integration (PDA Safe)
// @namespace    http://tampermonkey.net/
// @version      1.19
// @description  Dibs system for Torn faction targets, mobile and desktop safe.
// @author       Owen
// @match        *://torn.com/factions.php*
// @match        *://www.torn.com/factions.php*
// @match        *://torn.com/profiles.php*
// @match        *://www.torn.com/profiles.php*
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_URL = 'https://spider-verse.net';
  const STORAGE_URL = 'dibs_backendUrl';
  const STORAGE_NAME = 'dibs_playerName';

  let backendUrl = DEFAULT_URL;
  let playerName = '';
  let activeClaims = {};
  let busy = false;
  let observer = null;
  let statusEl = null;
  let modalEl = null;

  try {
    backendUrl = (localStorage.getItem(STORAGE_URL) || DEFAULT_URL).replace(/\/$/, '');
    playerName = localStorage.getItem(STORAGE_NAME) || '';
  } catch (e) {}

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_URL, backendUrl);
      localStorage.setItem(STORAGE_NAME, playerName);
    } catch (e) {}
  }

  function isEnemyPage() {
    return location.href.includes('step=profile&ID=');
  }

  function showStatus(text, tone) {
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.style.cssText = [
        'position:fixed',
        'top:12px',
        'left:12px',
        'z-index:99999999',
        'padding:8px 12px',
        'border-radius:10px',
        'font:700 13px/1.2 Arial,sans-serif',
        'color:#fff',
        'background:rgba(0,0,0,.85)',
        'box-shadow:0 4px 12px rgba(0,0,0,.35)',
        'max-width:70vw'
      ].join(';');
      document.body.appendChild(statusEl);
    }
    const bg = tone === 'good' ? '#1f8f4c' : tone === 'bad' ? '#b8323a' : '#2d3748';
    statusEl.style.background = bg;
    statusEl.textContent = text;
  }

  function ensureStyles() {
    if (document.getElementById('dibs-style')) return;
    const s = document.createElement('style');
    s.id = 'dibs-style';
    s.textContent = `
      .dibs-btn-custom {
        margin: 4px 6px 4px 0;
        padding: 6px 12px;
        font-size: 12px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 800;
        text-transform: uppercase;
        line-height: 1;
        box-sizing: border-box;
        border: 1px solid #111;
        box-shadow: 0 2px 4px rgba(0,0,0,.35);
        transition: transform .12s ease, opacity .12s ease;
        white-space: nowrap;
        min-height: 28px;
        flex: 0 0 auto;
      }
      .dibs-btn-custom:active { transform: scale(0.98); }
      .dibs-unclaimed { background: linear-gradient(180deg, #4b5261, #2f3640); color: #f5f6fa; }
      .dibs-mine { background: linear-gradient(180deg, #2ed573, #22a055); color: #fff; }
      .dibs-claimed { background: linear-gradient(180deg, #ff4757, #cc3845); color: #fff; }
      .dibs-settings-float {
        position: fixed;
        bottom: 16px;
        left: 16px;
        z-index: 99999999;
        background: rgba(0,0,0,.82);
        color: #fff;
        border: 2px solid #555;
        padding: 10px 14px;
        border-radius: 18px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
        backdrop-filter: blur(4px);
      }
      .dibs-btn-container {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        width: 100%;
        margin-top: 4px;
      }
      .dibs-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 99999998;
        background: rgba(0,0,0,.65);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .dibs-modal {
        width: min(92vw, 420px);
        background: #111827;
        color: #fff;
        border: 1px solid #374151;
        border-radius: 14px;
        padding: 16px;
        box-shadow: 0 10px 30px rgba(0,0,0,.5);
        font-family: Arial, sans-serif;
      }
      .dibs-modal h3 { margin: 0 0 12px 0; font-size: 18px; }
      .dibs-modal label { display:block; font-size: 13px; margin: 10px 0 6px; }
      .dibs-modal input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid #4b5563;
        background: #0b1220;
        color: #fff;
      }
      .dibs-modal-actions {
        display:flex;
        gap:10px;
        margin-top: 14px;
      }
      .dibs-modal-actions button {
        flex: 1;
        padding: 10px 12px;
        border-radius: 8px;
        border: 0;
        font-weight: 800;
        cursor: pointer;
      }
      .dibs-save { background: #22c55e; color: #fff; }
      .dibs-cancel { background: #374151; color: #fff; }

      @media (max-width: 768px) {
        .dibs-btn-custom {
          width: 100%;
          margin: 4px 0;
          padding: 8px 12px;
          font-size: 13px;
          justify-content: center;
        }
        .dibs-btn-container { display: block; width: 100%; }
        .dibs-settings-float { bottom: 12px; left: 12px; }
      }
    \`;
    document.head.appendChild(s);
  }

  function request(method, url, data, onload, onerror) {
    GM_xmlhttpRequest({
      method,
      url,
      headers: { 'Content-Type': 'application/json' },
      data: data ? JSON.stringify(data) : undefined,
      onload,
      onerror: onerror || function () {}
    });
  }

  function fetchClaims() {
    if (!backendUrl || busy) return;
    busy = true;
    request('GET', \`\${backendUrl}/api/claims\`, null, function (res) {
      busy = false;
      try {
        const data = JSON.parse(res.responseText);
        activeClaims = data && data.success && data.claims ? data.claims : {};
        updateButtons();
      } catch (e) {}
    }, function () {
      busy = false;
      showStatus('Dibs: backend request failed', 'bad');
    });
  }

  function claimTarget(enemyId) {
    if (!backendUrl) return showStatus('Set backend URL first', 'bad');
    if (!playerName) return openSettingsModal();

    request('POST', \`\${backendUrl}/api/claim\`, {
      enemyId: String(enemyId),
      playerName
    }, function () {
      fetchClaims();
      showStatus(\`Claimed \${enemyId}\`, 'good');
    }, function () {
      showStatus('Claim failed', 'bad');
    });
  }

  function unclaimTarget(enemyId) {
    request('POST', \`\${backendUrl}/api/unclaim\`, {
      enemyId: String(enemyId),
      playerName
    }, function () {
      fetchClaims();
      showStatus(\`Released \${enemyId}\`, 'good');
    }, function () {
      showStatus('Unclaim failed', 'bad');
    });
  }

  function openSettingsModal() {
    if (modalEl) modalEl.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'dibs-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'dibs-modal';
    modal.innerHTML = \`
      <h3>Dibs Settings</h3>
      <label>Backend URL</label>
      <input id="dibs-url" type="text" value="\${backendUrl.replace(/"/g, '&quot;')}" />
      <label>Player Name</label>
      <input id="dibs-name" type="text" value="\${playerName.replace(/"/g, '&quot;')}" />
      <div class="dibs-modal-actions">
        <button class="dibs-cancel" type="button">Cancel</button>
        <button class="dibs-save" type="button">Save</button>
      </div>
    \`;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    modalEl = backdrop;

    const urlInput = modal.querySelector('#dibs-url');
    const nameInput = modal.querySelector('#dibs-name');
    const cancelBtn = modal.querySelector('.dibs-cancel');
    const saveBtn = modal.querySelector('.dibs-save');

    cancelBtn.onclick = () => backdrop.remove();

    saveBtn.onclick = () => {
      backendUrl = (urlInput.value || '').trim().replace(/\\/$/, '');
      playerName = (nameInput.value || '').trim();
      saveSettings();
      backdrop.remove();
      showStatus('Dibs settings saved', 'good');
      fetchClaims();
      renderAll();
    };

    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) backdrop.remove();
    });
  }

  function getProfileLinks() {
    return [...document.querySelectorAll('a[href*="profiles.php?XID="]')].filter(a => {
      const text = (a.textContent || '').trim();
      return text && !a.classList.contains('dibs-processed');
    });
  }

  function getRow(link) {
    return link.closest('li, tr, .member-wrap, .table-row, .user-info-list-wrap, tbody') || link.parentElement;
  }

  function getEnemyIdFromLink(link) {
    try {
      const href = new URL(link.href, location.origin);
      return href.searchParams.get('XID');
    } catch (e) {
      return null;
    }
  }

  function getInsertTarget(link, row) {
    const attackLink = row ? row.querySelector('a[href*="loader.php?sid=attack"]') : null;
    if (attackLink && attackLink.parentElement) return attackLink.parentElement;
    return row || link.parentElement;
  }

  function ensureSettingsButton() {
    if (!isEnemyPage()) {
      const old = document.querySelector('.dibs-settings-float');
      if (old) old.remove();
      return;
    }
    let btn = document.querySelector('.dibs-settings-float');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'dibs-settings-float';
      btn.textContent = '⚙️ Dibs Settings';
      btn.onclick = function (e) {
        e.preventDefault();
        openSettingsModal();
      };
      document.body.appendChild(btn);
    }
  }

  function ensureButton(link, id, row) {
    if (document.querySelector('.dibs-btn-' + id)) return;
    const btn = document.createElement('button');
    btn.className = 'dibs-btn-custom dibs-btn-' + id;
    btn.setAttribute('data-id', id);
    btn.textContent = '🎯 DIBS';

    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      const claim = activeClaims[id];
      if (claim) {
        if (claim.playerName === playerName) {
          btn.textContent = '...';
          unclaimTarget(id);
        } else {
          showStatus('Already claimed by ' + claim.playerName, 'bad');
        }
      } else {
        btn.textContent = '...';
        claimTarget(id);
      }
    };

    const insertTarget = getInsertTarget(link, row);
    if (insertTarget) {
      if (window.getComputedStyle(insertTarget).display !== 'flex' && insertTarget.querySelector('a[href*="loader.php?sid=attack"]')) {
        insertTarget.style.display = 'flex';
        insertTarget.style.alignItems = 'center';
        insertTarget.style.gap = '6px';
      }
      insertTarget.appendChild(btn);
    }
  }

  function updateButtons() {
    document.querySelectorAll('.dibs-btn-custom').forEach(btn => {
      const id = btn.getAttribute('data-id');
      const claim = activeClaims[id];
      if (claim) {
        const mine = claim.playerName === playerName;
        btn.textContent = mine ? '★ YOURS' : '👑 ' + claim.playerName;
        btn.classList.remove('dibs-unclaimed', 'dibs-mine', 'dibs-claimed');
        btn.classList.add(mine ? 'dibs-mine' : 'dibs-claimed');
      } else {
        btn.textContent = '🎯 DIBS';
        btn.classList.remove('dibs-mine', 'dibs-claimed');
        btn.classList.add('dibs-unclaimed');
      }
    });
  }

  function renderAll() {
    ensureStyles();
    ensureSettingsButton();

    getProfileLinks().forEach(link => {
      const id = getEnemyIdFromLink(link);
      if (!id) return;
      const row = getRow(link);
      if (!row) return;
      link.classList.add('dibs-processed');
      ensureButton(link, id, row);
    });

    updateButtons();
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(window.__dibs_timer);
      window.__dibs_timer = setTimeout(renderAll, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    showStatus('Dibs loaded', 'good');
    renderAll();
    fetchClaims();
    startObserver();
    setInterval(fetchClaims, 3000);
  }

  setTimeout(init, 200);
})();
