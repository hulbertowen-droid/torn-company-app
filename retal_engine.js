'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  F.R.I.D.A.Y — Torn Retaliation Watcher v2.0
//  Pure real-time attack monitor for active 5-minute in-Torn retaliations.
//
//  1. Polls Torn faction attacks (25s peacetime / 12s active war)
//  2. Strictly filters for in-Torn retaliatable enemy hits (skips overseas,
//     stealthed, self-hits, internal sparring, and enemy losses/stalemates)
//  3. Tracks recent faction retal wins so duplicate/already-avenged alerts skip
//  4. Rotates across candidate faction API keys on paused/limited key errors
// ═══════════════════════════════════════════════════════════════════════════

const RETAL_WINDOW_SECS = 300; // 5-minute Torn retaliation window
const PEACE_POLL_MS = 25_000;
const WAR_POLL_MS = 12_000;
const DEDUP_CACHE_SIZE = 3000;

const RETALIATABLE_RESULTS = new Set([
    'attacked',
    'mugged',
    'hospitalized',
    'arrested'
]);

let _getApiKeysFn = null; // () => string | string[]
let _db = null;
let _ourFactionId = 52355;
let _alertedAttackCodes = new Set();
let _outgoingWinsByTarget = new Map(); // enemyPlayerId -> latest win unix ts
let _onAttackAlertCallback = null;
let _isWarMode = false;
let _backoffUntil = 0;
let _lastKeyErrorLogAt = 0;
let _running = false;
let _keyCursor = 0;

function setOurFactionId(facId) {
    if (facId && Number(facId) > 0) _ourFactionId = Number(facId);
}

function setOnAttackAlertCallback(fn) {
    _onAttackAlertCallback = fn;
}

function setApiKeysProvider(fn) {
    _getApiKeysFn = fn;
}

const nowSecs = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const col = (name) => _db.collection(name);

/**
 * Determine if a Torn attack happened overseas (1.25x overseas modifier).
 */
function isOverseasAttack(atk = {}) {
    if (!atk || typeof atk !== 'object') return false;
    if (atk.is_overseas === true || atk.overseas === true) return true;
    const osMod = Number(atk.modifiers?.overseas ?? atk.overseas_modifier ?? 1);
    return !Number.isNaN(osMod) && osMod > 1;
}

/**
 * In Torn City, a 5-minute 1.5x Retaliation window ONLY opens when an enemy
 * actually defeated/attacked our faction member (Attacked/Mugged/Hospitalized/Arrested).
 * Enemy losses, stalemates, escapes, assists, and timeouts do NOT open retals.
 */
function isRetaliatableResult(result) {
    const clean = String(result || '').trim().toLowerCase();
    if (!clean) return false;
    return RETALIATABLE_RESULTS.has(clean);
}

/**
 * Check whether a factionmate already landed a winning hit against targetId at or after atkTs.
 */
function hasRecentRetalWin(targetId, atkTs = 0) {
    const winTs = _outgoingWinsByTarget.get(Number(targetId));
    if (!winTs) return false;
    return winTs >= Number(atkTs || 0) && (nowSecs() - winTs) <= 900;
}

function getOrderedCandidateKeys() {
    if (typeof _getApiKeysFn !== 'function') return [];
    const raw = _getApiKeysFn();
    const list = (Array.isArray(raw) ? raw : [raw])
        .map(k => String(k || '').trim())
        .filter(Boolean);
    const unique = Array.from(new Set(list));
    if (unique.length <= 1) return unique;
    const start = _keyCursor % unique.length;
    _keyCursor = (_keyCursor + 1) % unique.length;
    return [...unique.slice(start), ...unique.slice(0, start)];
}

async function seedDedupCache() {
    if (!_db) return;
    try {
        const alerted = await col('attack_alerts')
            .find({}, { projection: { _id: 1, hex_code: 1, attack_id: 1, comp_key: 1 } })
            .sort({ alerted_at: -1 })
            .limit(2000)
            .toArray();

        for (const a of alerted) {
            if (a._id) _alertedAttackCodes.add(String(a._id));
            if (a.hex_code) _alertedAttackCodes.add(String(a.hex_code));
            if (a.attack_id) _alertedAttackCodes.add(String(a.attack_id));
            if (a.comp_key) _alertedAttackCodes.add(String(a.comp_key));
        }
        console.log(`[RetalWatcher] Seeded dedup cache with ${_alertedAttackCodes.size} alert keys.`);
    } catch (e) {
        console.warn('[RetalWatcher] Dedup seed warning:', e.message);
    }
}

async function dispatchAttackAlert(doc, atkRaw = {}) {
    if (typeof _onAttackAlertCallback !== 'function') return;

    const hexCode = String(atkRaw.code || doc.code || doc.hex_code || '').trim();
    const idCode = String(doc.attack_id || doc._id || '').trim();
    const primaryCode = hexCode || idCode;
    if (!primaryCode) return;

    const atkTs = Number(doc.timestamp || atkRaw.timestamp_ended || 0);
    if (atkTs > 0 && (nowSecs() - atkTs >= RETAL_WINDOW_SECS)) {
        return; // 5-minute window expired
    }

    if (isOverseasAttack(doc) || isOverseasAttack(atkRaw)) {
        return; // Overseas hit — strictly skipped
    }

    if (!isRetaliatableResult(doc.result || atkRaw.result)) {
        return; // Not a retaliatable enemy hit
    }

    if (hasRecentRetalWin(doc.attacker_id, atkTs)) {
        return; // Already retaliated by a faction member
    }

    const compKey = `hit_${doc.attacker_id}_${doc.defender_id}_${atkTs}`;
    if (_alertedAttackCodes.has(compKey) ||
        (hexCode && _alertedAttackCodes.has(hexCode)) ||
        (idCode && _alertedAttackCodes.has(idCode))) {
        return;
    }

    if (_db) {
        try {
            const orQueries = [
                { comp_key: compKey },
                ...(hexCode ? [{ _id: hexCode }, { hex_code: hexCode }, { code: hexCode }] : []),
                ...(idCode ? [{ _id: idCode }, { attack_id: idCode }] : [])
            ];
            const existing = await col('attack_alerts').findOne({ $or: orQueries, sent: true });
            if (existing) {
                _alertedAttackCodes.add(compKey);
                if (hexCode) _alertedAttackCodes.add(hexCode);
                if (idCode) _alertedAttackCodes.add(idCode);
                return;
            }
        } catch (_) {}
    }

    _alertedAttackCodes.add(compKey);
    if (hexCode) _alertedAttackCodes.add(hexCode);
    if (idCode) _alertedAttackCodes.add(idCode);
    while (_alertedAttackCodes.size > DEDUP_CACHE_SIZE) {
        const oldest = _alertedAttackCodes.values().next().value;
        _alertedAttackCodes.delete(oldest);
    }

    const payload = {
        code: hexCode || idCode,
        attack_id: idCode,
        _id: idCode,
        attacker_id: doc.attacker_id,
        attacker_name: doc.attacker_name || atkRaw.attacker_name || '',
        attacker_faction: doc.attacker_faction_id || doc.attacker_faction || atkRaw.attacker_faction || 0,
        attacker_faction_name: doc.attacker_faction_name || atkRaw.attacker_factionname || atkRaw.attacker_faction_name || '',
        defender_id: doc.defender_id,
        defender_name: doc.defender_name || atkRaw.defender_name || '',
        defender_faction: doc.defender_faction_id || doc.defender_faction || atkRaw.defender_faction || 0,
        defender_faction_name: doc.defender_faction_name || atkRaw.defender_factionname || atkRaw.defender_faction_name || '',
        result: doc.result || atkRaw.result || 'Attacked',
        timestamp: atkTs,
        respect: Number(doc.respect ?? atkRaw.respect_gain ?? atkRaw.respect ?? 0),
        chain: Number(doc.chain ?? atkRaw.chain ?? 0),
        modifiers: doc.modifiers || atkRaw.modifiers || {},
        direction: 'incoming'
    };

    try {
        await _onAttackAlertCallback(payload);
    } catch (e) {
        console.warn(`[RetalWatcher] Alert callback error (${primaryCode}):`, e.message);
    }
}

async function pollFactionAttacks() {
    if (Date.now() < _backoffUntil) return;
    const keys = getOrderedCandidateKeys();
    if (!keys.length) return;

    let data = null;
    let workingKey = null;
    for (const k of keys) {
        try {
            const url = _ourFactionId
                ? `https://api.torn.com/faction/${_ourFactionId}?selections=attacks,basic&key=${encodeURIComponent(k)}`
                : `https://api.torn.com/faction/?selections=attacks,basic&key=${encodeURIComponent(k)}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
            const json = await res.json();
            if (json && !json.error) {
                data = json;
                workingKey = k;
                break;
            }
            const errCode = Number(json?.error?.code || 0);
            if (errCode === 7 || errCode === 16 || errCode === 18 || errCode === 2) {
                continue; // Try next key in pool on permission/paused/invalid error
            }
            if (errCode === 5) {
                _backoffUntil = Date.now() + 60_000;
                return;
            }
        } catch (_) {}
    }

    if (!data) {
        const nowMs = Date.now();
        if (nowMs - _lastKeyErrorLogAt > 5 * 60_000) {
            _lastKeyErrorLogAt = nowMs;
            console.warn('[RetalWatcher] No active faction attack API key succeeded this cycle (paused or lacking faction access).');
        }
        _backoffUntil = Date.now() + 60_000;
        return;
    }

    if (data.ID) {
        const returnedFacId = Number(data.ID);
        if (_ourFactionId && returnedFacId !== _ourFactionId) return;
        _ourFactionId = returnedFacId;
    }

    const wars = data.rankedwars || data.ranked_wars || {};
    _isWarMode = Object.values(wars).some(w => !w?.war?.end || w?.war?.winner === 0);

    const attacks = data.attacks || {};
    const entries = Object.entries(attacks);
    if (!entries.length) return;

    const now = nowSecs();
    // Pass 1: Record any winning outgoing retal hits in the last 15m so already-avenged hits skip cleanly
    for (const [, atk] of entries) {
        const ts = Number(atk.timestamp_ended || 0);
        if (!ts || (now - ts) > 900) continue;
        const atkFac = Number(atk.attacker_faction || 0);
        const defFac = Number(atk.defender_faction || 0);
        const atkId = Number(atk.attacker_id || 0);
        const defId = Number(atk.defender_id || 0);
        const isOurAtk = (_ourFactionId && atkFac === _ourFactionId) || Boolean(data.members?.[atkId]);
        const isOurDef = (_ourFactionId && defFac === _ourFactionId) || Boolean(data.members?.[defId]);
        if (isOurAtk && !isOurDef && defId > 0 && isRetaliatableResult(atk.result)) {
            const prev = _outgoingWinsByTarget.get(defId) || 0;
            if (ts > prev) _outgoingWinsByTarget.set(defId, ts);
        }
    }
    // Prune stale outgoing win markers
    for (const [tid, ts] of _outgoingWinsByTarget.entries()) {
        if ((now - ts) > 1200) _outgoingWinsByTarget.delete(tid);
    }

    // Pass 2: Dispatch real-time alerts only for active (<5m), in-Torn, non-internal, retaliatable enemy hits
    const recentIncoming = [];
    for (const [code, atk] of entries) {
        const ts = Number(atk.timestamp_ended || 0);
        if (!ts || (now - ts) >= RETAL_WINDOW_SECS) continue;
        if (isOverseasAttack(atk)) continue;
        if (!isRetaliatableResult(atk.result)) continue;

        const atkFac = Number(atk.attacker_faction || 0);
        const defFac = Number(atk.defender_faction || 0);
        const atkId = Number(atk.attacker_id || 0);
        const defId = Number(atk.defender_id || 0);
        if (atkId <= 0 || atkId === defId) continue; // Skip stealth / self-hits

        const isOurDef = (_ourFactionId && defFac === _ourFactionId) || Boolean(data.members?.[defId]);
        const isOurAtk = (_ourFactionId && atkFac === _ourFactionId) || Boolean(data.members?.[atkId]);
        if (!isOurDef || isOurAtk) continue; // Only external attackers hitting our members

        recentIncoming.push({ code, atk, ts, atkFac, defFac, atkId, defId });
    }

    // Oldest -> newest so channel order is chronological
    recentIncoming.sort((a, b) => a.ts - b.ts);
    for (const item of recentIncoming) {
        const { code, atk, ts, atkFac, defFac, atkId, defId } = item;
        await dispatchAttackAlert({
            _id: code,
            attack_id: code,
            code: atk.code || code,
            attacker_id: atkId,
            attacker_name: atk.attacker_name || '',
            attacker_faction_id: atkFac,
            attacker_faction_name: atk.attacker_factionname || atk.attacker_faction_name || '',
            defender_id: defId,
            defender_name: atk.defender_name || data.members?.[defId]?.name || '',
            defender_faction_id: defFac || _ourFactionId,
            defender_faction_name: atk.defender_factionname || atk.defender_faction_name || data.name || '',
            timestamp: ts,
            result: atk.result || 'Attacked',
            respect: Number(atk.respect_gain || atk.respect || 0),
            chain: Number(atk.chain || 0),
            modifiers: atk.modifiers || {},
            workingApiKey: workingKey
        }, atk);
    }
}

async function pollLoop() {
    while (_running) {
        await pollFactionAttacks().catch(e => console.warn('[RetalWatcher] Cycle error:', e.message));
        await sleep(_isWarMode ? WAR_POLL_MS : PEACE_POLL_MS);
    }
}

async function startRetalWatcher(getApiKeysFn, mongoDb, onAttackAlertFn = null) {
    if (onAttackAlertFn) _onAttackAlertCallback = onAttackAlertFn;
    if (getApiKeysFn) _getApiKeysFn = getApiKeysFn;
    if (mongoDb) _db = mongoDb;
    if (_running) return;
    _running = true;

    console.log('[RetalWatcher] Starting Torn Retaliation Watcher (In-Torn only, overseas excluded)...');
    await seedDedupCache();
    pollLoop().catch(e => console.error('[RetalWatcher] Fatal loop error:', e.message));
}

module.exports = {
    startRetalWatcher,
    startRetaliationEngine: startRetalWatcher,
    pollOnce: pollFactionAttacks,
    setOurFactionId,
    setOnAttackAlertCallback,
    setApiKeysProvider,
    isOverseasAttack,
    isRetaliatableResult,
    hasRecentRetalWin,
    _recordOutgoingWinForTest: (targetId, ts) => _outgoingWinsByTarget.set(Number(targetId), Number(ts))
};
