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

    // ── Browser-Only Full Access Key Storage ─────────────────────────────────
    function getBrowserFullKey() {
        try {
            const v = (localStorage.getItem(FULL_KEY_STORAGE) || '').trim();
            if (v && v.length >= 16) return v;
        } catch (_) {}
        return '';
    }

    function setBrowserFullKey(key) {
        try {
            const clean = String(key || '').trim();
            if (!clean) localStorage.removeItem(FULL_KEY_STORAGE);
            else localStorage.setItem(FULL_KEY_STORAGE, clean);
        } catch (_) {}
    }

    // ── Log Classification for IndexedDB Tagging ─────────────────────────────
    function classifyRawLogKind(entry) {
        if (!entry || typeof entry !== 'object') return 'other';
        const title = String(entry.title || '').toLowerCase();
        const cat = String(entry.category || '').toLowerCase();
        const logId = Number(entry.log || entry.id || 0);

        if (title === 'level up' || title.includes('level up') || logId === 5500) {
            return 'level_up';
        }
        if (
            cat === 'crimes' ||
            cat.includes('crime') ||
            title.startsWith('crime ') ||
            (logId >= 9000 && logId <= 9299) ||
            (entry.data && (entry.data.crime || entry.data.crime_action || entry.data.crime_skill !== undefined))
        ) {
            return 'crime';
        }
        if (
            cat === 'attacking' ||
            cat.includes('attack') ||
            title.startsWith('attack ') ||
            title.includes('attacked ') ||
            title.includes('mugged ') ||
            title.includes('hospitalized ') ||
            title.includes('left ') ||
            (logId >= 8100 && logId <= 8299)
        ) {
            return 'attack';
        }
        if (
            cat === 'gym' ||
            title.startsWith('gym ') ||
            title.includes('gym train') ||
            (logId >= 5300 && logId <= 5399)
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
        let crimeLogs = 0;
        let attackLogs = 0;
        let levelLogs = 0;
        let gymLogs = 0;

        for (const l of logs) {
            if (minTs === null || l.timestamp < minTs) minTs = l.timestamp;
            if (maxTs === null || l.timestamp > maxTs) maxTs = l.timestamp;
            if (l.kind === 'crime') crimeLogs++;
            else if (l.kind === 'attack') attackLogs++;
            else if (l.kind === 'level_up') levelLogs++;
            else if (l.kind === 'gym') gymLogs++;
        }

        const updated = {
            ...base,
            userId: String(userId),
            minTs,
            maxTs,
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

    async function fetchDirectSnapshot(apiKey) {
        const [profile, skillsData, hofData, attacksData] = await Promise.all([
            fetchTornDirect('user/?selections=basic,profile,bars,personalstats', apiKey, 2),
            fetchTornDirect('user/?selections=skills', apiKey, 1).catch(() => ({})),
            fetchTornDirect('user/?selections=hof', apiKey, 1).catch(() => ({})),
            fetchTornDirect('user/?selections=attacks', apiKey, 1).catch(() => ({}))
        ]);

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
            skills: normalizeSkillsPayload(skillsData),
            personalstats: profile.personalstats || {},
            hof: hofData.halloffame || profile.halloffame || {},
            attacks: attacksData.attacks || {}
        };
    }

    function normalizeSkillsPayload(raw) {
        if (!raw || typeof raw !== 'object') return {};
        const src = raw.skills || raw;
        const out = {};
        for (const [k, v] of Object.entries(src)) {
            if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)))) {
                out[k.toLowerCase()] = Number(v);
            } else if (v && typeof v === 'object' && v.slug && v.level !== undefined) {
                out[String(v.slug).toLowerCase()] = Number(v.level);
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

        /**
         * mode: 'incremental' (fetch newest down to maxTs) | 'backfill' (walk older before minTs)
         * scope: 'all' (full log feed: crimes+levels+attacks+gym) | 'crimes_only' (cat=136 fast crime-only)
         */
        async run({ apiKey, userId, mode = 'incremental', scope = 'all', maxPages = 30 }) {
            if (this.isRunning) return null;
            this.isRunning = true;
            this.isPaused = false;
            this.abortFlag = false;

            const uid = String(userId);
            const meta = await getUserMeta(uid);
            const catQuery = scope === 'crimes_only' ? '&cat=136' : '';
            let cursorTo = mode === 'backfill' && meta.minTs ? (meta.minTs - 1) : Math.floor(Date.now() / 1000);
            const stopAtFrom = mode === 'incremental' && meta.maxTs ? (meta.maxTs + 1) : null;

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
                    ? 'Walking backward through older Torn logs...'
                    : 'Checking Torn for new logs since last sync...'
            });

            try {
                while (pagesFetched < maxPages && !this.abortFlag) {
                    await this.waitIfPaused();
                    if (this.abortFlag) break;

                    let q = `user/?selections=log${catQuery}&to=${cursorTo}`;
                    if (stopAtFrom && mode === 'incremental') {
                        q += `&from=${stopAtFrom}`;
                    }

                    const data = await fetchTornDirect(q, apiKey, 3);
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
                        cursorTo = res.minTs - 1;
                    }
                    if (res.maxTs !== null) {
                        if (meta.maxTs === null || res.maxTs > meta.maxTs) meta.maxTs = res.maxTs;
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

                // When running fast crimes_only mode, also make 1 tiny call for Level Up (log=5500) history!
                if (!this.abortFlag && scope === 'crimes_only') {
                    try {
                        await sleep(this.throttleMs);
                        const lvlData = await fetchTornDirect('user/?selections=log&log=5500', apiKey, 2);
                        if (lvlData && lvlData.log && Object.keys(lvlData.log).length > 0) {
                            const lvRes = await saveLogsBatch(uid, lvlData.log);
                            totalAdded += lvRes.added;
                        }
                    } catch (_) {}
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
                        : `Sync complete • ${finalState.meta.totalLogs.toLocaleString()} total logs cached locally.`
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
