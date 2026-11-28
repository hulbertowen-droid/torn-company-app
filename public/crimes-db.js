/**
 * FactionOS — Crime & Level Analytics Client-Side IndexedDB & Torn Log Syncer
 *
 * Privacy-first torn.report-style architecture:
 * - Full Access API keys stay strictly inside the user's browser and talk directly to api.torn.com.
 * - All fetched personal logs are cached in IndexedDB keyed by Torn User ID so history is never re-downloaded.
 * - Supports incremental forward sync, pauseable/resumable historical backfill, and rate-limit backoff.
 */
(function (global) {
    'use strict';

    const DB_NAME = 'FactionOS_CrimeIntel_v1';
    const DB_VERSION = 1;
    const LOGS_STORE = 'logs';
    const META_STORE = 'meta';

    const FULL_KEY_STORAGE = 'factionos_crimes_full_key';
    const INTEL_SUMMARY_STORAGE = 'factionos_crime_intel_summary_v1';

    let dbPromise = null;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                return reject(new Error('IndexedDB is unavailable in this browser.'));
            }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(LOGS_STORE)) {
                    const store = db.createObjectStore(LOGS_STORE, { keyPath: 'pk' });
                    store.createIndex('userId', 'userId', { unique: false });
                    store.createIndex('userId_ts', ['userId', 'timestamp'], { unique: false });
                    store.createIndex('userId_kind', ['userId', 'kind'], { unique: false });
                }
                if (!db.objectStoreNames.contains(META_STORE)) {
                    db.createObjectStore(META_STORE, { keyPath: 'userId' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
        });
        return dbPromise;
    }

    // ── Browser-Only Full Access Key Storage (localStorage + IndexedDB mirror) ─
    const DEVICE_KEY_META_ID = '__device_full_key__';

    function getBrowserFullKey() {
        try {
            const v = (localStorage.getItem(FULL_KEY_STORAGE) || '').trim();
            if (v && v.length >= 16) return v;
        } catch (_) {}
        return '';
    }

    function setBrowserFullKey(key) {
        const clean = String(key || '').trim();
        try {
            if (!clean) localStorage.removeItem(FULL_KEY_STORAGE);
            else localStorage.setItem(FULL_KEY_STORAGE, clean);
        } catch (_) {}
        openDB().then(db => {
            const tx = db.transaction([META_STORE], 'readwrite');
            const store = tx.objectStore(META_STORE);
            if (!clean) store.delete(DEVICE_KEY_META_ID);
            else store.put({ userId: DEVICE_KEY_META_ID, apiKey: clean, savedAt: Date.now() });
        }).catch(() => {});
    }

    async function hydrateBrowserFullKey() {
        const existing = getBrowserFullKey();
        if (existing) return existing;
        try {
            const db = await openDB();
            const rec = await new Promise((resolve) => {
                const tx = db.transaction([META_STORE], 'readonly');
                const req = tx.objectStore(META_STORE).get(DEVICE_KEY_META_ID);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
            const restored = String(rec?.apiKey || '').trim();
            if (restored.length >= 16) {
                try { localStorage.setItem(FULL_KEY_STORAGE, restored); } catch (_) {}
                return restored;
            }
        } catch (_) {}
        return '';
    }

    // ── Log Classification for IndexedDB Tagging ─────────────────────────────
    const ATTACK_RECEIVE_IDS = new Set([8101, 8106, 8111, 8116, 8141, 8151, 8156, 8161, 8166, 8170, 8180]);
    const GYM_TRAIN_IDS = new Set([5300, 5301, 5302, 5303]);

    function classifyRawLogKind(entry) {
        if (!entry || typeof entry !== 'object') return 'other';
        const title = String(entry.title || '').toLowerCase().trim();
        const cat = String(entry.category || '').toLowerCase().trim();
        const logId = Number(entry.log || entry.id || 0);

        // Distinguish player Level Up (log 5200 / category Level up) from Crime skill level up (log 9005/9006)
        if (logId === 9005 || logId === 9006 || title.includes('crime skill level')) {
            return 'crime_skill';
        }
        if (logId === 5200 || logId === 5500 || (title === 'level up' && !cat.includes('crime'))) {
            return 'level_up';
        }
        if (
            cat === 'crimes' ||
            cat.includes('crime') ||
            title.startsWith('crime ') ||
            (logId >= 9000 && logId <= 9399) ||
            (logId >= 5700 && logId <= 5739) ||
            (entry.data && (entry.data.crime || entry.data.crime_action || entry.data.crime_skill !== undefined))
        ) {
            return 'crime';
        }
        if (
            ATTACK_RECEIVE_IDS.has(logId) ||
            title.includes('receive') ||
            cat.includes('incoming')
        ) {
            return 'other';
        }
        if (
            cat === 'attacking' ||
            cat === 'attacks outgoing' ||
            title.startsWith('attack ') ||
            (logId >= 8100 && logId <= 8299)
        ) {
            return 'attack';
        }
        if (
            GYM_TRAIN_IDS.has(logId) ||
            (cat === 'gym' && title.startsWith('gym train') && !title.includes('addict') && Number(entry.data?.energy_used || 0) > 0)
        ) {
            return 'gym';
        }
        return 'other';
    }

    // ── IndexedDB CRUD Operations ────────────────────────────────────────────
    async function saveLogsBatch(userId, rawLogMap) {
        const uid = String(userId || 'unknown');
        const entries = Array.isArray(rawLogMap)
            ? rawLogMap.map((v, idx) => [String(v.id || v.log_id || `${v.timestamp}_${idx}`), v])
            : Object.entries(rawLogMap || {});

        if (!entries.length) {
            return { added: 0, minTs: null, maxTs: null };
        }

        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([LOGS_STORE], 'readwrite');
            const store = tx.objectStore(LOGS_STORE);
            let minTs = Infinity;
            let maxTs = 0;
            let processed = 0;

            for (const [logKey, raw] of entries) {
                if (!raw || typeof raw !== 'object') continue;
                const ts = Number(raw.timestamp || 0);
                if (!ts) continue;
                if (ts < minTs) minTs = ts;
                if (ts > maxTs) maxTs = ts;
                const kind = classifyRawLogKind(raw);
                const record = {
                    pk: `${uid}:${logKey}`,
                    logKey: String(logKey),
                    userId: uid,
                    timestamp: ts,
                    log: Number(raw.log || raw.type || 0),
                    title: String(raw.title || ''),
                    category: String(raw.category || ''),
                    kind,
                    data: raw.data || {},
                    params: raw.params || {}
                };
                store.put(record);
                processed++;
            }

            tx.oncomplete = () => resolve({
                added: processed,
                minTs: Number.isFinite(minTs) ? minTs : null,
                maxTs: maxTs > 0 ? maxTs : null
            });
            tx.onerror = () => reject(tx.error || new Error('IndexedDB batch write failed'));
        });
    }

    async function getUserLogs(userId) {
        const uid = String(userId || 'unknown');
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([LOGS_STORE], 'readonly');
            const idx = tx.objectStore(LOGS_STORE).index('userId');
            const req = idx.getAll(IDBKeyRange.only(uid));
            req.onsuccess = () => {
                const rows = req.result || [];
                rows.sort((a, b) => a.timestamp - b.timestamp);
                resolve(rows);
            };
            req.onerror = () => reject(req.error || new Error('Failed to read logs from IndexedDB'));
        });
    }

    async function getUserMeta(userId) {
        const uid = String(userId || 'unknown');
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([META_STORE], 'readonly');
            const req = tx.objectStore(META_STORE).get(uid);
            req.onsuccess = () => resolve(req.result || {
                userId: uid,
                minTs: null,
                maxTs: null,
                totalLogs: 0,
                crimeLogs: 0,
                attackLogs: 0,
                levelLogs: 0,
                gymLogs: 0,
                lastSyncTs: null,
                backfillComplete: false,
                manualLevelUpTs: null,
                profileSnapshot: null
            });
            req.onerror = () => reject(req.error || new Error('Failed to read sync metadata'));
        });
    }

    async function saveUserMeta(meta) {
        if (!meta || !meta.userId) return;
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([META_STORE], 'readwrite');
            tx.objectStore(META_STORE).put({ ...meta, userId: String(meta.userId) });
            tx.oncomplete = () => resolve(meta);
            tx.onerror = () => reject(tx.error || new Error('Failed to save sync metadata'));
        });
    }

    async function recomputeUserMetaFromLogs(userId, existingMeta = null) {
        const logs = await getUserLogs(userId);
        const base = existingMeta || await getUserMeta(userId);
        let minTs = null;
        let maxTs = null;
        let crimeMinTs = null;
        let crimeMaxTs = null;
        let crimeLogs = 0;
        let attackLogs = 0;
        let levelLogs = 0;
        let gymLogs = 0;

        for (const l of logs) {
            // Dynamically re-classify in case cached rows predated classifier fixes
            const kind = classifyRawLogKind(l);
            if (minTs === null || l.timestamp < minTs) minTs = l.timestamp;
            if (maxTs === null || l.timestamp > maxTs) maxTs = l.timestamp;
            if (kind === 'crime') {
                // Exclude non-attempt setup/migration rows from displayed crime count when clearly non-attempt
                const d = l.data || {};
                const lid = Number(l.log || 0);
                if (d.nerve !== undefined || (lid >= 9010 && lid <= 9199) || (lid >= 5700 && lid <= 5739)) {
                    crimeLogs++;
                }
                if (crimeMinTs === null || l.timestamp < crimeMinTs) crimeMinTs = l.timestamp;
                if (crimeMaxTs === null || l.timestamp > crimeMaxTs) crimeMaxTs = l.timestamp;
            } else if (kind === 'crime_skill') {
                if (crimeMinTs === null || l.timestamp < crimeMinTs) crimeMinTs = l.timestamp;
                if (crimeMaxTs === null || l.timestamp > crimeMaxTs) crimeMaxTs = l.timestamp;
            } else if (kind === 'attack') attackLogs++;
            else if (kind === 'level_up') levelLogs++;
            else if (kind === 'gym') gymLogs++;
        }

        const updated = {
            ...base,
            userId: String(userId),
            minTs,
            maxTs,
            crimeMinTs,
            crimeMaxTs,
            totalLogs: logs.length,
            crimeLogs,
            attackLogs,
            levelLogs,
            gymLogs
        };
        await saveUserMeta(updated);
        return { meta: updated, logs };
    }

    async function clearUserData(userId) {
        const uid = String(userId || 'unknown');
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([LOGS_STORE, META_STORE], 'readwrite');
            const store = tx.objectStore(LOGS_STORE);
            const idx = store.index('userId');
            const cursorReq = idx.openKeyCursor(IDBKeyRange.only(uid));
            cursorReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    cursor.continue();
                }
            };
            tx.objectStore(META_STORE).delete(uid);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('Failed to clear local IndexedDB data'));
        });
    }

    async function clearAllCachedData() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([LOGS_STORE, META_STORE], 'readwrite');
            tx.objectStore(LOGS_STORE).clear();
            tx.objectStore(META_STORE).clear();
            tx.oncomplete = () => {
                try { localStorage.removeItem(INTEL_SUMMARY_STORAGE); } catch (_) {}
                resolve(true);
            };
            tx.onerror = () => reject(tx.error || new Error('Failed to wipe database'));
        });
    }

    // ── Torn API Direct Browser Requests (With Rate-Limit Backoff) ───────────
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function fetchTornDirect(pathWithQuery, apiKey, retries = 3) {
        const sep = pathWithQuery.includes('?') ? '&' : '?';
        const url = `https://api.torn.com/${pathWithQuery.replace(/^\//, '')}${sep}key=${encodeURIComponent(apiKey)}`;
        let backoff = 2200;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const resp = await fetch(url, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                });
                if (!resp.ok) {
                    if (resp.status === 429 || resp.status >= 500) {
                        if (attempt < retries) {
                            await sleep(backoff);
                            backoff *= 1.8;
                            continue;
                        }
                    }
                    throw new Error(`Torn API HTTP ${resp.status}`);
                }
                const data = await resp.json();
                if (data && data.error) {
                    const code = Number(data.error.code || 0);
                    // 5 = Too many requests, 8 = IP block, 9 = API disabled, 17 = Backend error
                    if ([5, 8, 9, 17].includes(code) && attempt < retries) {
                        await sleep(code === 5 ? Math.max(backoff, 3500) : backoff);
                        backoff *= 2;
                        continue;
                    }
                    const err = new Error(data.error.error || `Torn API Error #${code}`);
                    err.tornCode = code;
                    throw err;
                }
                return data;
            } catch (err) {
                if (err.tornCode && ![5, 8, 9, 17].includes(err.tornCode)) throw err;
                if (attempt >= retries) throw err;
                await sleep(backoff);
                backoff *= 1.7;
            }
        }
        throw new Error('Torn API request failed after retries.');
    }

    async function inspectKeyAccess(apiKey) {
        const data = await fetchTornDirect('key/?selections=info', apiKey, 1);
        const info = data.info || data;
        const accessType = String(info.access_type || 'Unknown');
        const accessLevel = Number(info.access_level ?? 0);
        const userSels = Array.isArray(info.selections?.user)
            ? info.selections.user
            : Object.keys(info.selections || {}).filter(k => info.selections[k]);
        const hasLogAccess = accessLevel >= 4 ||
            accessType.toLowerCase().includes('full') ||
            userSels.includes('log') ||
            info.selections?.log === 1;

        return {
            accessType,
            accessLevel,
            hasLogAccess,
            userId: info.user_id ? String(info.user_id) : null,
            keyName: info.name || ''
        };
    }

    const V2_CRIME_ID_MAP = [
        [1, 'search_for_cash', 'searchforcashskill'],
        [2, 'bootlegging', 'bootleggingskill'],
        [3, 'graffiti', 'graffitiskill'],
        [4, 'shoplifting', 'shopliftingskill'],
        [5, 'pickpocketing', 'pickpocketingskill'],
        [6, 'card_skimming', 'cardskimmingskill'],
        [7, 'burglary', 'burglaryskill'],
        [8, 'hustling', 'hustlingskill'],
        [9, 'disposal', 'disposalskill'],
        [10, 'cracking', 'crackingskill'],
        [11, 'forgery', 'forgeryskill'],
        [12, 'scamming', 'scammingskill'],
        [13, 'arson', 'arsonskill']
    ];

    async function fetchDirectSnapshot(apiKey, itemPrices = {}, itemNames = {}) {
        const [profile, skillsData, v2SkillsData, hofData, attacksData] = await Promise.all([
            fetchTornDirect('user/?selections=basic,profile,bars,personalstats,crimes', apiKey, 2),
            fetchTornDirect('user/?selections=skills', apiKey, 1).catch(() => ({})),
            fetchTornDirect('v2/user/skills', apiKey, 1).catch(() => ({})),
            fetchTornDirect('user/?selections=hof', apiKey, 1).catch(() => ({})),
            fetchTornDirect('user/?selections=attacks', apiKey, 1).catch(() => ({}))
        ]);

        const ps = profile.personalstats || {};
        const skills = normalizeSkillsPayload(skillsData, v2SkillsData, ps);

        // Fetch Torn v2 per-crime lifetime telemetry (/v2/user/{1..13}/crimes) directly in browser
        let v2Crimes = null;
        try {
            const perCrimeRaw = await Promise.all(
                V2_CRIME_ID_MAP.map(([cid, slug]) =>
                    fetchTornDirect(`v2/user/${cid}/crimes`, apiKey, 1)
                        .then(d => [slug, d?.crimes || null])
                        .catch(() => [slug, null])
                )
            );
            const built = {};
            let anyV2 = false;
            for (const [slug, c] of perCrimeRaw) {
                if (!c || typeof c !== 'object') continue;
                anyV2 = true;
                if (skills[slug] === undefined && c.skill !== undefined && !isNaN(Number(c.skill))) {
                    skills[slug] = Number(c.skill);
                }
                const cashRewards = Number(c.rewards?.money || 0);
                let itemRewardsValue = 0;
                let itemsTotalQty = 0;
                const rewardItemsScored = [];
                for (const it of (c.rewards?.items || [])) {
                    const idStr = String(it.id || '');
                    const amt = Number(it.amount || 0);
                    const unitVal = Number(itemPrices[idStr] || 0);
                    const totalVal = amt * unitVal;
                    itemRewardsValue += totalVal;
                    itemsTotalQty += amt;
                    if (amt > 0) {
                        rewardItemsScored.push({
                            id: Number(it.id),
                            name: itemNames[idStr] || `Item #${idStr}`,
                            amount: amt,
                            unitValue: Math.round(unitVal),
                            totalValue: Math.round(totalVal)
                        });
                    }
                }
                rewardItemsScored.sort((a, b) => b.totalValue - a.totalValue);
                const uniquesRaw = Array.isArray(c.uniques) ? c.uniques : [];
                const uniquesFormatted = uniquesRaw.map((u, idx) => {
                    const uMoney = Number(u?.rewards?.money || 0);
                    const uItems = (u?.rewards?.items || []).map(ui => {
                        const nm = itemNames[String(ui.id)] || `Item #${ui.id}`;
                        return `${ui.amount}× ${nm}`;
                    });
                    const parts = [];
                    if (uMoney > 0) parts.push(`$${uMoney.toLocaleString()}`);
                    if (uItems.length) parts.push(uItems.join(', '));
                    return parts.length ? `Unique #${u.id || (idx + 1)}: ${parts.join(' + ')}` : `Unique #${u.id || (idx + 1)}`;
                });

                built[slug] = {
                    skill: Number(c.skill || 0),
                    progressionBonus: Number(c.progression_bonus || 0),
                    nerveSpent: Number(c.nerve_spent || 0),
                    attempts: {
                        total: Number(c.attempts?.total || 0),
                        success: Number(c.attempts?.success || 0),
                        fail: Number(c.attempts?.fail || 0),
                        criticalFail: Number(c.attempts?.critical_fail || 0),
                        subcrimes: Array.isArray(c.attempts?.subcrimes) ? c.attempts.subcrimes : []
                    },
                    cashRewards,
                    itemRewardsValue: Math.round(itemRewardsValue),
                    itemsTotalQty,
                    rawRewardItems: c.rewards?.items || [],
                    topItems: rewardItemsScored.slice(0, 15),
                    uniquesCount: uniquesRaw.length,
                    uniquesList: uniquesFormatted,
                    misc: c.miscellaneous || null
                };
            }
            if (anyV2) v2Crimes = built;
        } catch (_) {}

        return {
            source: 'direct_browser',
            fetchedAt: Date.now(),
            userId: String(profile.player_id || ''),
            name: profile.name || 'Operative',
            level: Number(profile.level || 1),
            rank: profile.rank || '',
            age: Number(profile.age || 0),
            bars: profile.bars || {
                nerve: profile.nerve || { current: 0, maximum: 60 },
                energy: profile.energy || { current: 0, maximum: 150 }
            },
            skills,
            v2Crimes,
            criminalrecord: profile.criminalrecord || {},
            personalstats: ps,
            hof: hofData.halloffame || profile.halloffame || {},
            attacks: attacksData.attacks || {}
        };
    }

    function normalizeSkillsPayload(rawV1, rawV2 = null, ps = {}) {
        const out = {};
        if (rawV1 && typeof rawV1 === 'object' && !rawV1.error) {
            const src = (rawV1.skills && !Array.isArray(rawV1.skills)) ? rawV1.skills : rawV1;
            for (const [k, v] of Object.entries(src)) {
                const lk = k.toLowerCase();
                if (lk === 'player_id') continue;
                if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))) {
                    out[lk] = Number(v);
                } else if (v && typeof v === 'object' && v.slug && v.level !== undefined) {
                    out[String(v.slug).toLowerCase()] = Number(v.level);
                }
            }
        }
        if (Array.isArray(rawV2?.skills)) {
            for (const entry of rawV2.skills) {
                const slug = String(entry?.slug || '').toLowerCase();
                if (slug && out[slug] === undefined && entry.level !== undefined && !isNaN(Number(entry.level))) {
                    out[slug] = Number(entry.level);
                }
            }
        }
        if (ps && typeof ps === 'object') {
            for (const [, slug, psKey] of V2_CRIME_ID_MAP) {
                if (out[slug] === undefined && ps[psKey] !== undefined && !isNaN(Number(ps[psKey]))) {
                    out[slug] = Number(ps[psKey]);
                }
            }
        }
        return out;
    }

    // ── Pauseable / Resumable Rate-Limited Sync Controller ───────────────────
    class TornLogSyncer {
        constructor(options = {}) {
            this.throttleMs = options.throttleMs || 1350; // Safe ~44 req/min cap
            this.isRunning = false;
            this.isPaused = false;
            this.abortFlag = false;
            this.onProgress = options.onProgress || (() => {});
        }

        pause() {
            this.isPaused = true;
            this.onProgress({ status: 'paused', message: 'Sync paused by user.' });
        }

        resume() {
            this.isPaused = false;
            this.onProgress({ status: 'running', message: 'Resuming log sync...' });
        }

        stop() {
            this.abortFlag = true;
            this.isPaused = false;
        }

        async waitIfPaused() {
            while (this.isPaused && !this.abortFlag) {
                await sleep(250);
            }
        }

        async fetchLogPage({ apiKey, useSessionProxy = false, cat = '', logType = '', toTs = null, fromTs = null }) {
            if (apiKey) {
                const params = new URLSearchParams({ selections: 'log' });
                if (cat) params.set('cat', String(cat));
                if (logType) params.set('log', String(logType));
                if (toTs) params.set('to', String(toTs));
                if (fromTs) params.set('from', String(fromTs));
                return fetchTornDirect(`user/?${params.toString()}`, apiKey, 3);
            }
            if (!useSessionProxy) {
                throw new Error('No Full Access API key configured.');
            }
            const params = new URLSearchParams();
            if (cat) params.set('cat', String(cat));
            if (logType) params.set('log', String(logType));
            if (toTs) params.set('to', String(toTs));
            if (fromTs) params.set('from', String(fromTs));
            let backoff = 2200;
            for (let attempt = 0; attempt <= 3; attempt++) {
                const resp = await fetch(`/api/crimes/logs?${params.toString()}`);
                const data = await resp.json().catch(() => ({}));
                if (resp.ok && data && !data.error) return data;
                const code = Number(data?.tornCode || 0);
                if ((resp.status === 429 || [5, 8, 9, 17].includes(code)) && attempt < 3) {
                    await sleep(code === 5 ? Math.max(backoff, 3500) : backoff);
                    backoff *= 1.8;
                    continue;
                }
                const err = new Error(data?.error || `Log sync HTTP ${resp.status}`);
                err.tornCode = code;
                throw err;
            }
            throw new Error('Session log sync failed after retries.');
        }

        /**
         * mode: 'incremental' (fetch newest down to maxTs) | 'backfill' (walk older before minTs)
         * scope: 'crimes_smart' (cat=136 + LevelUps + Attacks + Gym) | 'crimes_only' (cat=136 + LevelUps) | 'all' (unfiltered feed)
         */
        async run({ apiKey = '', useSessionProxy = false, userId, mode = 'incremental', scope = 'crimes_smart', maxPages = 30 }) {
            if (this.isRunning) return null;
            this.isRunning = true;
            this.isPaused = false;
            this.abortFlag = false;

            const uid = String(userId);
            const meta = await getUserMeta(uid);
            const isAllFeed = scope === 'all';
            const crimeStreamCat = isAllFeed ? '' : '136';

            const refMin = isAllFeed ? meta.minTs : (meta.crimeMinTs ?? meta.minTs);
            const refMax = isAllFeed ? meta.maxTs : (meta.crimeMaxTs ?? null);

            let cursorTo = mode === 'backfill' && refMin ? (refMin - 1) : Math.floor(Date.now() / 1000);
            const stopAtFrom = mode === 'incremental' && refMax ? (refMax + 1) : null;

            let pagesFetched = 0;
            let totalAdded = 0;
            let reachedBoundary = false;

            this.onProgress({
                status: 'running',
                mode,
                pagesFetched: 0,
                maxPages,
                totalAdded: 0,
                message: mode === 'backfill'
                    ? `Walking backward through older Torn ${isAllFeed ? 'activity' : 'crime'} logs...`
                    : `Syncing latest Torn ${isAllFeed ? 'activity' : 'crime'} logs...`
            });

            try {
                while (pagesFetched < maxPages && !this.abortFlag) {
                    await this.waitIfPaused();
                    if (this.abortFlag) break;

                    const data = await this.fetchLogPage({
                        apiKey,
                        useSessionProxy,
                        cat: crimeStreamCat,
                        toTs: cursorTo,
                        fromTs: (stopAtFrom && mode === 'incremental') ? stopAtFrom : null
                    });
                    const logMap = data.log || {};
                    const keys = Object.keys(logMap);
                    pagesFetched++;

                    if (keys.length === 0) {
                        reachedBoundary = true;
                        if (mode === 'backfill') meta.backfillComplete = true;
                        break;
                    }

                    const res = await saveLogsBatch(uid, logMap);
                    totalAdded += res.added;

                    if (res.minTs !== null) {
                        if (meta.minTs === null || res.minTs < meta.minTs) meta.minTs = res.minTs;
                        if (!isAllFeed && (meta.crimeMinTs === null || res.minTs < meta.crimeMinTs)) meta.crimeMinTs = res.minTs;
                        cursorTo = res.minTs - 1;
                    }
                    if (res.maxTs !== null) {
                        if (meta.maxTs === null || res.maxTs > meta.maxTs) meta.maxTs = res.maxTs;
                        if (!isAllFeed && (meta.crimeMaxTs === null || res.maxTs > meta.crimeMaxTs)) meta.crimeMaxTs = res.maxTs;
                    }

                    this.onProgress({
                        status: 'running',
                        mode,
                        pagesFetched,
                        maxPages,
                        totalAdded,
                        oldestSeenTs: res.minTs,
                        newestSeenTs: res.maxTs,
                        message: `Page ${pagesFetched}/${maxPages} • +${totalAdded.toLocaleString()} logs cached${res.minTs ? ' • Reached ' + new Date(res.minTs * 1000).toLocaleDateString() : ''}`
                    });

                    // Torn returns at most 100 entries per page; fewer than 95 means we hit the end of the range
                    if (keys.length < 95) {
                        reachedBoundary = true;
                        if (mode === 'backfill') meta.backfillComplete = true;
                        break;
                    }
                    if (stopAtFrom && res.minTs !== null && res.minTs <= stopAtFrom) {
                        reachedBoundary = true;
                        break;
                    }

                    await sleep(this.throttleMs);
                }

                // When running targeted crime modes, also pull canonical Level Ups (cat=123), and in Smart mode recent Outgoing Attacks (cat=181) & Gym (cat=125)
                if (!this.abortFlag && !isAllFeed) {
                    const auxStreams = scope === 'crimes_smart'
                        ? [{ cat: '123', label: 'Level-Up' }, { cat: '181', label: 'Attacks' }, { cat: '125', label: 'Gym' }]
                        : [{ cat: '123', label: 'Level-Up' }];
                    for (const aux of auxStreams) {
                        if (this.abortFlag) break;
                        try {
                            await sleep(this.throttleMs);
                            const auxData = await this.fetchLogPage({ apiKey, useSessionProxy, cat: aux.cat });
                            if (auxData && auxData.log && Object.keys(auxData.log).length > 0) {
                                const auxRes = await saveLogsBatch(uid, auxData.log);
                                totalAdded += auxRes.added;
                            }
                        } catch (_) {}
                    }
                }

                meta.lastSyncTs = Math.floor(Date.now() / 1000);
                const finalState = await recomputeUserMetaFromLogs(uid, meta);
                this.onProgress({
                    status: this.abortFlag ? 'stopped' : 'done',
                    mode,
                    pagesFetched,
                    maxPages,
                    totalAdded,
                    reachedBoundary,
                    meta: finalState.meta,
                    message: this.abortFlag
                        ? `Sync stopped (${totalAdded.toLocaleString()} logs saved).`
                        : `Sync complete • ${(finalState.meta.crimeLogs || 0).toLocaleString()} crime logs (${finalState.meta.totalLogs.toLocaleString()} total cached).`
                });
                return finalState;
            } catch (err) {
                meta.lastSyncTs = Math.floor(Date.now() / 1000);
                await recomputeUserMetaFromLogs(uid, meta).catch(() => {});
                this.onProgress({
                    status: 'error',
                    error: err.message || 'Log sync failed',
                    tornCode: err.tornCode || 0,
                    message: `Sync error: ${err.message || 'Unknown error'}`
                });
                throw err;
            } finally {
                this.isRunning = false;
                this.isPaused = false;
            }
        }
    }

    global.FactionOSCrimesDB = {
        DB_NAME,
        FULL_KEY_STORAGE,
        INTEL_SUMMARY_STORAGE,
        openDB,
        getBrowserFullKey,
        setBrowserFullKey,
        hydrateBrowserFullKey,
        classifyRawLogKind,
        saveLogsBatch,
        getUserLogs,
        getUserMeta,
        saveUserMeta,
        recomputeUserMetaFromLogs,
        clearUserData,
        clearAllCachedData,
        fetchTornDirect,
        inspectKeyAccess,
        fetchDirectSnapshot,
        normalizeSkillsPayload,
        TornLogSyncer
    };
})(window);
