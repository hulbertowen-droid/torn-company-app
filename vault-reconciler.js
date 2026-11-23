'use strict';

/**
 * Package B: Auto-Reconciled War & OC Payouts + Personal Vault Ledger Engine
 *
 * Parses Torn `faction/?selections=fundsnews`, reconciles banker payouts against
 * War Payout Ledger rows and OC settlements, persists auto-verified paid receipts
 * per faction, and builds strictly player-scoped Personal Vault Statements.
 */

const fs = require('fs');
const path = require('path');

let UI = null;
try { UI = require('./friday-ui'); } catch (_) {}

function stripHtmlTags(raw) {
    return String(raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractPlayerLinks(raw) {
    const links = [];
    const regex = /<a[^>]*XID\s*=\s*(\d+)[^>]*>([^<]+)<\/a>/gi;
    let m;
    while ((m = regex.exec(String(raw || ''))) !== null) {
        links.push({ id: String(m[1]), name: String(m[2]).trim() });
    }
    return links;
}

function parseDollarAmount(cleanText) {
    const match = String(cleanText || '').match(/\$([\d,]+)/);
    if (!match) return 0;
    const val = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(val) ? val : 0;
}

function parseFundsNewsEntry(entry, newsKey = '') {
    if (!entry) return null;
    const rawHtml = String(entry.news || entry.text || '');
    const cleanText = stripHtmlTags(rawHtml);
    if (!cleanText) return null;

    const links = extractPlayerLinks(rawHtml);
    const amount = parseDollarAmount(cleanText);
    const timestamp = Number(entry.timestamp || 0);
    const lower = cleanText.toLowerCase();

    let type = 'other';
    let actorId = links[0]?.id || null;
    let actorName = links[0]?.name || null;
    let recipientId = null;
    let recipientName = null;

    if (lower.includes('was given') || lower.includes('was paid') || lower.includes('received')) {
        type = 'payout';
        recipientId = links[0]?.id || null;
        recipientName = links[0]?.name || null;
        actorId = links[1]?.id || null;
        actorName = links[1]?.name || 'Faction Vault';
    } else if (lower.includes('gave') || lower.includes('paid ') || lower.includes('sent ') || lower.includes('transfer')) {
        type = 'payout';
        actorId = links[0]?.id || null;
        actorName = links[0]?.name || null;
        recipientId = links[1]?.id || links[0]?.id || null;
        recipientName = links[1]?.name || links[0]?.name || null;
    } else if (lower.includes('deposited') || lower.includes('donated')) {
        type = 'deposit';
        actorId = links[0]?.id || null;
        actorName = links[0]?.name || null;
        recipientId = 'vault';
        recipientName = 'Faction Vault';
    } else if (lower.includes('withdrew')) {
        type = 'withdrawal';
        actorId = links[0]?.id || null;
        actorName = links[0]?.name || null;
        recipientId = links[0]?.id || null;
        recipientName = links[0]?.name || null;
    } else if (lower.includes('organized crime') || lower.includes('crime')) {
        type = 'oc_income';
    }

    const fallbackId = `${timestamp}_${amount}_${actorId || '0'}_${recipientId || '0'}`;
    return {
        txId: String(newsKey || entry.ID || entry.id || fallbackId),
        timestamp,
        type,
        amount,
        actorId,
        actorName,
        recipientId,
        recipientName,
        rawText: cleanText
    };
}

function parseFundsNewsFeed(fundsnewsObj = {}) {
    const out = [];
    for (const [k, entry] of Object.entries(fundsnewsObj || {})) {
        const parsed = parseFundsNewsEntry(entry, k);
        if (parsed) out.push(parsed);
    }
    out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return out;
}

function amountsRoughlyMatch(expectedAmt, actualAmt) {
    const exp = Math.round(Number(expectedAmt) || 0);
    const act = Math.round(Number(actualAmt) || 0);
    if (exp <= 0 || act <= 0) return false;
    if (exp === act) return true;
    // Allow 1% or $1,000 rounding slack for manual Torn banking truncation
    const tol = Math.max(1000, Math.round(exp * 0.01));
    return Math.abs(exp - act) <= tol;
}

function reconcilePayoutsAgainstFundsNews(rows = [], parsedNews = [], options = {}) {
    const sinceTsSec = Math.max(0, Number(options.sinceTsSec) || 0);
    const eligibleTx = parsedNews.filter(tx =>
        (tx.type === 'payout' || tx.type === 'withdrawal') &&
        tx.amount > 0 &&
        tx.timestamp >= sinceTsSec &&
        tx.recipientId
    );

    const usedTxIds = new Set();
    const matched = [];
    const unmatched = [];
    let totalMatchedAmt = 0;

    for (const row of rows) {
        const pid = String(row.playerId || row.id || '').trim();
        const playerName = String(row.playerName || row.name || `Player [${pid}]`).trim();
        const expectedAmount = Math.max(0, Math.round(Number(row.expectedAmount ?? row.finalPayout ?? 0)));
        if (!pid || expectedAmount <= 0) continue;

        // 1. Exact or near single-transaction match
        let hit = eligibleTx.find(tx =>
            !usedTxIds.has(tx.txId) &&
            String(tx.recipientId) === pid &&
            tx.amount === expectedAmount
        );
        let matchMode = 'exact';

        if (!hit) {
            hit = eligibleTx.find(tx =>
                !usedTxIds.has(tx.txId) &&
                String(tx.recipientId) === pid &&
                amountsRoughlyMatch(expectedAmount, tx.amount)
            );
            matchMode = 'tolerance';
        }

        if (hit) {
            usedTxIds.add(hit.txId);
            totalMatchedAmt += hit.amount;
            matched.push({
                playerId: Number(pid),
                playerName,
                expectedAmount,
                paidAmount: hit.amount,
                matchMode,
                txId: hit.txId,
                txTimestamp: hit.timestamp,
                bankerName: hit.actorName || 'Banker',
                rawText: hit.rawText
            });
            continue;
        }

        // 2. Cumulative multi-transfer match (e.g., paid in 2 transactions)
        const playerTxs = eligibleTx.filter(tx => !usedTxIds.has(tx.txId) && String(tx.recipientId) === pid);
        if (playerTxs.length >= 2) {
            let sum = 0;
            const combo = [];
            for (const tx of playerTxs) {
                sum += tx.amount;
                combo.push(tx);
                if (amountsRoughlyMatch(expectedAmount, sum)) {
                    combo.forEach(c => usedTxIds.add(c.txId));
                    totalMatchedAmt += sum;
                    matched.push({
                        playerId: Number(pid),
                        playerName,
                        expectedAmount,
                        paidAmount: sum,
                        matchMode: 'split_sum',
                        txId: combo.map(c => c.txId).join(','),
                        txTimestamp: combo[0].timestamp,
                        bankerName: combo[0].actorName || 'Banker',
                        rawText: `${combo.length} transfers totaling $${sum.toLocaleString()}`
                    });
                    hit = combo[0];
                    break;
                }
            }
        }

        if (!hit) {
            unmatched.push({
                playerId: Number(pid),
                playerName,
                expectedAmount
            });
        }
    }

    return {
        matched,
        unmatched,
        matchedCount: matched.length,
        unmatchedCount: unmatched.length,
        totalMatchedAmt
    };
}

function buildMemberVaultLedger(parsedNews = [], bankRequestsObj = {}, targetPlayerId, targetFactionId = null) {
    const pid = String(targetPlayerId || '').trim();
    if (!pid) {
        return {
            entries: [],
            pendingRequests: [],
            totals: { deposited: 0, payoutsReceived: 0, withdrawn: 0, netBalanceImpact: 0 }
        };
    }

    const entries = [];
    let deposited = 0;
    let payoutsReceived = 0;
    let withdrawn = 0;

    for (const tx of parsedNews) {
        const isActor = String(tx.actorId || '') === pid;
        const isRecipient = String(tx.recipientId || '') === pid;
        if (!isActor && !isRecipient) continue;

        let direction = 'info';
        let label = tx.type;
        if (tx.type === 'deposit' && isActor) {
            direction = 'in';
            label = 'Vault Deposit';
            deposited += tx.amount;
        } else if (tx.type === 'payout' && isRecipient) {
            direction = 'out_paid';
            label = `Vault Payout${tx.actorName ? ` (by ${tx.actorName})` : ''}`;
            payoutsReceived += tx.amount;
        } else if (tx.type === 'withdrawal' && isActor) {
            direction = 'out_self';
            label = 'Personal Withdrawal';
            withdrawn += tx.amount;
        } else {
            continue;
        }

        entries.push({
            id: tx.txId,
            timestamp: tx.timestamp * 1000,
            direction,
            label,
            amount: tx.amount,
            counterparty: isRecipient ? (tx.actorName || 'Faction Vault') : (tx.recipientName || 'Faction Vault'),
            source: 'torn_fundsnews',
            rawText: tx.rawText
        });
    }

    const pendingRequests = [];
    for (const reqItem of Object.values(bankRequestsObj || {})) {
        if (!reqItem) continue;
        if (targetFactionId && reqItem.factionId && String(reqItem.factionId) !== String(targetFactionId)) continue;
        const reqPid = String(reqItem.requesterTornId || reqItem.tornId || reqItem.playerId || '').trim();
        if (reqPid !== pid) continue;

        const st = String(reqItem.status || 'pending').toLowerCase();
        const tsMs = Number(reqItem.completedAt || reqItem.timestamp || reqItem.createdAt || 0);
        const amt = Number(reqItem.amount || 0);
        if (st === 'pending' || st === 'claimed') {
            pendingRequests.push({
                id: String(reqItem.id || ''),
                status: st,
                amount: amt,
                timestamp: tsMs,
                claimedBy: reqItem.claimedBy || null
            });
        } else {
            entries.push({
                id: `req_${reqItem.id}`,
                timestamp: tsMs,
                direction: st === 'completed' ? 'out_request' : 'request_void',
                label: `Banker Request (${st})`,
                amount: amt,
                counterparty: reqItem.fulfilledBy || reqItem.claimedBy || 'Faction Banker',
                source: 'discord_bank_request',
                rawText: `${reqItem.requesterName || 'Member'} requested $${amt.toLocaleString()} via /withdraw (${st})`
            });
        }
    }

    entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return {
        entries: entries.slice(0, 100),
        pendingRequests,
        totals: {
            deposited,
            payoutsReceived,
            withdrawn,
            netBalanceImpact: deposited - withdrawn
        }
    };
}

function buildPayoutSummaryDiscordEmbed(payload = {}, options = {}) {
    const warId = String(payload.warId || 'Latest').trim();
    const enemyName = String(payload.enemyName || 'Enemy Faction').trim();
    const factionName = String(payload.factionName || 'Faction').trim();
    const memberPool = Math.round(Number(payload.memberPool) || 0);
    const deductions = Math.round(Number(payload.deductions) || 0);
    const cacheSales = Math.round(Number(payload.cacheSales) || 0);
    const totalHits = Number(payload.totalHits || 0);
    const effectivePph = String(payload.effectivePph || '$0');
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const publicUrl = String(options.publicUrl || 'https://faction-os.duckdns.org').replace(/\/+$/, '');

    const paidRows = rows.filter(r => r.isPaid).length;
    const topLines = rows.slice(0, 12).map((r, idx) => {
        const icon = r.isPaid ? '✅' : '⏳';
        const autoTag = r.autoVerified ? ' *(Vault Verified)*' : '';
        return `${icon} **#${idx + 1} ${r.name || r.playerName}** — \`$${Math.round(Number(r.finalPayout) || 0).toLocaleString()}\` (${r.warH ?? 0} hits)${autoTag}`;
    });

    const fields = [
        {
            name: '💰 Financial Summary',
            value:
                `📦 **Cache Revenue:** \`$${cacheSales.toLocaleString()}\`\n` +
                `📉 **Deductions & Reimbursements:** \`$${deductions.toLocaleString()}\`\n` +
                `🏦 **Net Member Pool:** \`$${memberPool.toLocaleString()}\`\n` +
                `⚔️ **Adj. Hits:** \`${totalHits}\` • **Effective PPH:** \`${effectivePph}\` • **Disbursed:** \`${paidRows}/${rows.length}\``,
            inline: false
        },
        {
            name: `🏆 Payout Ledger (${topLines.length ? `Top ${topLines.length}` : '0'})`,
            value: (topLines.length ? topLines.join('\n') : '*No payout rows included.*').slice(0, 1020),
            inline: false
        }
    ];

    const title = `💸 Ranked War Payout Summary (#${warId}) — ${factionName}`;
    const desc = `⚔️ **Opponent:** ${enemyName}\nCheck your personal vault receipts on FactionOS Payout Calculator.`;
    const embed = UI
        ? UI.embed({
            color: paidRows === rows.length && rows.length > 0 ? UI.COLORS.GREEN : UI.COLORS.TEAL,
            title: UI.ensureBrand(title),
            description: desc,
            fields
        })
        : { title, description: desc, color: 0x1ABC9C, fields, timestamp: new Date().toISOString() };

    embed.links = [{ label: '💰 Open Payout Ledger', url: `${publicUrl}/payout.html` }];
    embed.components = [{
        type: 1,
        components: [{ type: 2, style: 5, label: '💰 Open Payout Ledger', url: `${publicUrl}/payout.html` }]
    }];
    return embed;
}

function createVaultReconcilerEngine(deps = {}) {
    const dataDir = deps.dataDir || path.join(__dirname, 'data');
    const verifiedFile = path.join(dataDir, 'war_payout_verified.json');
    const newsCache = new Map(); // facId -> { ts, parsedNews }
    const NEWS_CACHE_TTL_MS = 45 * 1000;

    let verifiedByFaction = {}; // { [facId]: { [warId]: { [playerId]: matchObj } } }
    try {
        if (fs.existsSync(verifiedFile)) {
            verifiedByFaction = JSON.parse(fs.readFileSync(verifiedFile, 'utf8')) || {};
        }
    } catch (e) {
        console.warn('[VaultReconciler] Failed loading verified file:', e.message);
    }

    function saveVerified() {
        try {
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(verifiedFile, JSON.stringify(verifiedByFaction, null, 2), 'utf8');
        } catch (e) {
            console.warn('[VaultReconciler] Failed saving verified file:', e.message);
        }
        if (typeof deps.onStateChange === 'function') {
            try { deps.onStateChange(); } catch (_) {}
        }
    }

    function exportState() {
        return verifiedByFaction;
    }

    function importState(saved) {
        if (saved && typeof saved === 'object') {
            verifiedByFaction = { ...verifiedByFaction, ...saved };
        }
    }

    async function fetchParsedFundsNews(factionId, callerKey = null, force = false) {
        const fid = String(factionId || '52355').trim();
        const now = Date.now();
        if (!force && newsCache.has(fid)) {
            const cached = newsCache.get(fid);
            if (now - cached.ts < NEWS_CACHE_TTL_MS) {
                return { ok: true, parsedNews: cached.parsedNews, cached: true };
            }
        }

        const keyCandidates = [];
        if (callerKey) keyCandidates.push(callerKey);
        if (typeof deps.getFactionKeys === 'function') {
            for (const k of (deps.getFactionKeys(fid, callerKey) || [])) {
                if (k && !keyCandidates.includes(k)) keyCandidates.push(k);
            }
        }
        const uniqueKeys = [...new Set(keyCandidates.filter(k => k && String(k).length >= 16))];
        if (uniqueKeys.length === 0) {
            return { ok: false, error: 'No Torn API key available with Faction News permissions for this faction.', parsedNews: [] };
        }

        let lastErr = 'Failed to fetch faction fundsnews';
        for (const k of uniqueKeys) {
            try {
                const url = `https://api.torn.com/faction/${fid}?selections=fundsnews&timestamp=${now}&key=${encodeURIComponent(k)}`;
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                const data = await res.json();
                if (data && !data.error && data.fundsnews) {
                    const parsedNews = parseFundsNewsFeed(data.fundsnews);
                    newsCache.set(fid, { ts: now, parsedNews });
                    return { ok: true, parsedNews, cached: false };
                }
                if (data?.error) lastErr = data.error.error || `Torn error ${data.error.code}`;
            } catch (e) {
                lastErr = e.message;
            }
        }
        return { ok: false, error: lastErr, parsedNews: [] };
    }

    function getVerifiedMap(factionId, warId) {
        const fid = String(factionId || '52355').trim();
        const wid = String(warId || 'default').trim();
        return verifiedByFaction?.[fid]?.[wid] || {};
    }

    async function reconcileWarPayouts(factionId, warId, rows, callerKey = null, options = {}) {
        const fid = String(factionId || '52355').trim();
        const wid = String(warId || 'default').trim();
        const newsRes = await fetchParsedFundsNews(fid, callerKey, Boolean(options.force));
        if (!newsRes.ok) {
            return { success: false, error: newsRes.error, matched: [], unmatched: [], verifiedMap: getVerifiedMap(fid, wid) };
        }

        const result = reconcilePayoutsAgainstFundsNews(rows, newsRes.parsedNews, {
            sinceTsSec: options.sinceTsSec || 0
        });

        if (!verifiedByFaction[fid]) verifiedByFaction[fid] = {};
        if (!verifiedByFaction[fid][wid]) verifiedByFaction[fid][wid] = {};

        for (const m of result.matched) {
            verifiedByFaction[fid][wid][String(m.playerId)] = {
                ...m,
                verifiedAt: Date.now()
            };
        }
        if (result.matched.length > 0) saveVerified();

        return {
            success: true,
            factionId: fid,
            warId: wid,
            ...result,
            verifiedMap: verifiedByFaction[fid][wid]
        };
    }

    return {
        parseFundsNewsEntry,
        parseFundsNewsFeed,
        reconcilePayoutsAgainstFundsNews,
        buildMemberVaultLedger,
        buildPayoutSummaryDiscordEmbed,
        fetchParsedFundsNews,
        reconcileWarPayouts,
        getVerifiedMap,
        exportState,
        importState
    };
}

module.exports = {
    parseFundsNewsEntry,
    parseFundsNewsFeed,
    reconcilePayoutsAgainstFundsNews,
    buildMemberVaultLedger,
    buildPayoutSummaryDiscordEmbed,
    createVaultReconcilerEngine
};
