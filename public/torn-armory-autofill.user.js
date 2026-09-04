// ==UserScript==
// @name         Spider-Verse Faction Armory Auto-Filler
// @namespace    https://spider-verse.net/
// @version      1.0.0
// @description  Automatically selects the item, opens the loan/give drawer, and prefills the faction member name and quantity when clicking links from Discord alerts.
// @author       Spider-Verse
// @match        https://www.torn.com/factions.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Parse URL query or hash parameters
    function getParam(key) {
        const url = new URL(window.location.href);
        if (url.searchParams.has(key)) return url.searchParams.get(key);
        // Also check hash query params like #/tab=armoury&...&autoItem=...
        const hash = window.location.hash;
        if (hash.includes(key + '=')) {
            const m = hash.match(new RegExp('[#&?]' + key + '=([^&]+)'));
            if (m) return decodeURIComponent(m[1]);
        }
        return null;
    }

    const autoItem = getParam('autoItem');
    const autoUser = getParam('autoUser');
    const autoUserId = getParam('autoUserId');
    const autoAction = (getParam('autoAction') || 'loan').toLowerCase(); // 'loan' or 'give'
    const autoQty = getParam('autoQty') || '1';

    if (!autoItem || (!autoUser && !autoUserId)) return;

    console.log('[SV Armory Auto-Filler] Detected parameters:', { autoItem, autoUser, autoUserId, autoAction, autoQty });

    let attempted = false;

    function runAutoFill() {
        if (attempted) return;

        // Locate armory items in the table
        const rows = document.querySelectorAll('li[data-item], tr[data-item], .item-row, .table-row, .armory-item, ul.items-list > li');
        let targetRow = null;

        const cleanSearchName = autoItem.toLowerCase().trim();

        // 1. Find the row matching autoItem name
        for (const row of rows) {
            const text = (row.innerText || row.textContent || '').toLowerCase();
            if (text.includes(cleanSearchName)) {
                targetRow = row;
                break;
            }
        }

        // Fallback search across any element containing item title if list items haven't fully rendered
        if (!targetRow) {
            const allElements = document.querySelectorAll('.title, .name, .desc');
            for (const el of allElements) {
                if ((el.textContent || '').toLowerCase().trim() === cleanSearchName) {
                    targetRow = el.closest('li') || el.closest('tr') || el.parentElement;
                    break;
                }
            }
        }

        if (!targetRow) return;

        // 2. Find the action button ('Loan' or 'Give')
        const actionLinks = targetRow.querySelectorAll('a, button, span.link');
        let actionBtn = null;

        for (const btn of actionLinks) {
            const label = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            if (label === autoAction || (autoAction === 'loan' && label.includes('loan')) || (autoAction === 'give' && label.includes('give'))) {
                actionBtn = btn;
                break;
            }
        }

        if (!actionBtn) return;

        attempted = true;
        console.log('[SV Armory Auto-Filler] Clicking action button:', actionBtn);
        actionBtn.click();

        // 3. Wait for the popup/drawer inputs to appear
        let inputAttempts = 0;
        const inputTimer = setInterval(() => {
            inputAttempts++;
            if (inputAttempts > 50) { clearInterval(inputTimer); return; }

            // Find parent drawer/form or row
            const formContainer = targetRow.parentElement.querySelector('.loan-wrap, .give-wrap, .form-wrap, .action-wrap, tr.expanded, .details-wrap') || targetRow;

            // Search for quantity and member inputs
            const qtyInput = formContainer.querySelector('input[name*="qty"], input[name*="amount"], input.quantity, input[type="number"]') ||
                             document.querySelector('input.quantity');

            const memberInput = formContainer.querySelector('input[placeholder*="member"], input[placeholder*="name"], input.user-search, input.input-text, input[name*="user"]') ||
                                document.querySelector('input[placeholder*="member"], input.user-search');

            if (memberInput) {
                clearInterval(inputTimer);

                // Fill quantity
                if (qtyInput) {
                    qtyInput.value = autoQty;
                    qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
                    qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // Fill member
                const targetFillValue = autoUserId ? `${autoUser ? autoUser + ' ' : ''}[${autoUserId}]` : autoUser;
                memberInput.focus();
                memberInput.value = targetFillValue;
                memberInput.dispatchEvent(new Event('input', { bubbles: true }));
                memberInput.dispatchEvent(new Event('change', { bubbles: true }));
                memberInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));

                // Highlight the confirm button
                const confirmBtn = formContainer.querySelector('button[type="submit"], input[type="submit"], .btn-loan, .btn-give, a.confirm') ||
                                   document.querySelector('button.btn-loan, button.btn-give');

                if (confirmBtn) {
                    confirmBtn.style.boxShadow = '0 0 15px #2ed573';
                    confirmBtn.style.transform = 'scale(1.05)';
                    confirmBtn.style.transition = 'all 0.3s ease';
                }

                // Show floating helper badge
                const toast = document.createElement('div');
                toast.style.position = 'fixed';
                toast.style.bottom = '20px';
                toast.style.right = '20px';
                toast.style.background = '#11141d';
                toast.style.color = '#2ed573';
                toast.style.border = '2px solid #2ed573';
                toast.style.borderRadius = '8px';
                toast.style.padding = '12px 18px';
                toast.style.zIndex = '999999';
                toast.style.fontWeight = 'bold';
                toast.style.boxShadow = '0 4px 20px rgba(0,0,0,0.6)';
                toast.innerHTML = `🕷️ <b>F.R.I.D.A.Y Armory Auto-Filler:</b><br>Prefilled for <b>${targetFillValue}</b> with <b>${autoItem} x${autoQty}</b>! Click LOAN to confirm.`;
                document.body.appendChild(toast);
                setTimeout(() => { toast.remove(); }, 8000);
            }
        }, 100);
    }

    // Run on initial load and observe DOM changes
    setTimeout(runAutoFill, 1200);
    const observer = new MutationObserver(() => {
        if (!attempted) runAutoFill();
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
