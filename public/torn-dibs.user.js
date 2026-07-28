// ==UserScript==
// @name         Torn Dibs Integration (Responsive)
// @namespace    http://tampermonkey.net/
// @version      1.18
// @description  Integrates a faction dibs system into Torn profile/faction pages.
// @author       Owen
// @match        https://www.torn.com/factions.php*
// @match        https://www.torn.com/profiles.php*
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_URL = 'dibs_backendUrl';
  const STORAGE_NAME = 'dibs_playerName';
  const DEFAULT_URL = 'https://spider-verse.net';

  let backendUrl = (localStorage.getItem(STORAGE_URL) || DEFAULT_URL).replace(/\/$/, '');
  let playerName = localStorage.getItem(STORAGE_NAME) || '';
  let activeClaims = {};
  let fetching = false;
  let refreshTimer = null;
  let observer = null;

  const css = `
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
      transition: transform .12s ease, opacity .12s ease, background .12s ease;
      white-space: nowrap;
      min-height: 28px;
      flex: 0 0 auto;
    }

    .dibs-btn-custom:active {
      transform: scale(0.98);
    }

    .dibs-unclaimed {
      background: linear-gradient(180deg, #4b5261, #2f3640);
      color: #f5f6fa;
    }

    .dibs-mine {
      background: linear-gradient(180deg, #2ed573, #22a055);
      color: #fff;
    }

    .dibs-claimed {
      background: linear-gradient(180deg, #ff4757, #cc3845);
      color: #fff;
    }

    .dibs-settings-float {
      position: fixed;
      bottom: 16px;
      left: 16px;
      z-index: 9999999;
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

    @media (max-width: 768px) {
      .dibs-btn-custom {
        width: 100%;
        margin: 4px 0;
        padding: 8px 12px;
        font-size: 13px;
        justify-content: center;
      }

      .dibs-btn-container {
        display: block;
        width: 100%;
      }

      .dibs-settings-float {
        bottom: 12px;
        left: 12px;
        right: auto;
      }
    }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function saveSettings() {
    localStorage.setItem(STORAGE_URL, backendUrl);
    localStorage.setItem(STORAGE_NAME, playerName);
  }

  function openSettings() {
    const url = prompt('Enter your App URL (example: https://spider-verse.net):', backendUrl);
    if (url !== null) backendUrl = url.replace(/\/$/, '');

    const name = prompt('Enter your name (shown when you claim targets):', playerName);
    if (name !== null) playerName = name.trim();

    saveSettings();
    alert(\`Dibs settings saved.\\nURL: \${backendUrl}\\nName: \${playerName || '(blank)'}\`);
    fetchClaims();
    renderAll();
  }

  function isEnemyPage() {
    return window.location.href.includes('step=profile&ID=');
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
    if (!backendUrl || fetching) return;
    fetching = true;

    request(
      'GET',
      \`\${backendUrl}/api/claims\`,
      null,
      function (res) {
        fetching = false;
        try {
          const data = JSON.parse(res.responseText);
          activeClaims = data && data.success && data.claims ? data.claims : {};
          renderAll();
        } catch (e) {}
      },
      function () {
        fetching = false;
      }
    );
  }

  function claimTarget(enemyId) {
    if (!backendUrl) return alert('Please set your Backend URL first.');
    if (!playerName) {
      alert('Please set your Player Name first.');
      return openSettings();
    }

    request('POST', \`\${backendUrl}/api/claim\`, {
      enemyId: String(enemyId),
      playerName
    }, function () {
      fetchClaims();
    });
  }

  function unclaimTarget(enemyId) {
    request('POST', \`\${backendUrl}/api/unclaim\`, {
      enemyId: String(enemyId),
      playerName
    }, function () {
      fetchClaims();
    });
  }

  function getProfileLinks() {
    return [...document.querySelectorAll('a[href*="profiles.php?XID="]')].filter(a => {
      const text = (a.textContent || '').trim();
      return text.length > 0 && !a.classList.contains('dibs-processed');
    });
  }

  function getEnemyIdFromLink(link) {
    try {
      const href = new URL(link.href, location.origin);
      return href.searchParams.get('XID');
    } catch {
      return null;
    }
  }

  function getRow(link) {
    return link.closest('li, tr, .member-wrap, .table-row, .user-info-list-wrap, tbody') || link.parentElement;
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
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openSettings();
      });
      document.body.appendChild(btn);
    }
  }

  function ensureButton(link, id, row) {
    const existing = document.querySelector(\`.dibs-btn-\${CSS.escape(id)}\`);
    if (existing) return existing;

    const btn = document.createElement('button');
    btn.className = \`dibs-btn-custom dibs-btn-\${id}\`;
    btn.setAttribute('data-id', id);
    btn.textContent = '🎯 DIBS';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const claim = activeClaims[id];
      if (claim) {
        if (claim.playerName === playerName) {
          btn.textContent = '...';
          unclaimTarget(id);
        } else {
          alert(\`Already claimed by \${claim.playerName}\`);
        }
      } else {
        btn.textContent = '...';
        claimTarget(id);
      }
    });

    const insertTarget = getInsertTarget(link, row);
    if (insertTarget) {
      if (window.getComputedStyle(insertTarget).display !== 'flex' && insertTarget.querySelector('a[href*="loader.php?sid=attack"]')) {
        insertTarget.style.display = 'flex';
        insertTarget.style.alignItems = 'center';
        insertTarget.style.gap = '6px';
      }
      insertTarget.appendChild(btn);
    }

    return btn;
  }

  function renderAll() {
    ensureSettingsButton();

    const links = getProfileLinks();
    links.forEach(link => {
      const id = getEnemyIdFromLink(link);
      if (!id) return;

      const row = getRow(link);
      if (!row) return;

      link.classList.add('dibs-processed');
      ensureButton(link, id, row);
    });

    updateButtons();
  }

  function updateButtons() {
    document.querySelectorAll('.dibs-btn-custom').forEach(btn => {
      const id = btn.getAttribute('data-id');
      const claim = activeClaims[id];

      if (claim) {
        const mine = claim.playerName === playerName;
        btn.textContent = mine ? '★ YOURS' : \`👑 \${claim.playerName}\`;
        btn.classList.remove('dibs-unclaimed', 'dibs-mine', 'dibs-claimed');
        btn.classList.add(mine ? 'dibs-mine' : 'dibs-claimed');
      } else {
        btn.textContent = '🎯 DIBS';
        btn.classList.remove('dibs-mine', 'dibs-claimed');
        btn.classList.add('dibs-unclaimed');
      }
    });
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(renderAll, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function startPolling() {
    setInterval(fetchClaims, 3000);
  }

  function init() {
    renderAll();
    fetchClaims();
    startObserver();
    startPolling();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
