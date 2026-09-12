'use strict';

/**
 * Central Torn API Request Manager (TornAPIManager)
 * 
 * High-performance, intelligent rate-limiting, deduplicating, tiered-caching
 * request management engine for Torn City API requests.
 * 
 * Features:
 * - Single central point for all Torn API requests.
 * - Deep key health tracking (AVAILABLE, BUSY, RATE_LIMITED, QUARANTINE, DISABLED).
 * - Priority queue (CRITICAL, HIGH, NORMAL, LOW) — war requests never delayed by background jobs.
 * - In-flight request deduplication — identical concurrent requests coalesce into 1 API call.
 * - Aggressive tiered caching with Stale-While-Revalidate and graceful degradation.
 * - Multi-user data isolation (pool keys strictly separated from private user keys).
 * - Exponential backoff with jitter on rate limits.
 * - Dynamic hospital/event pre-fetching.
 * - Zero logging of raw API keys (redacted to key aliases).
 * - Comprehensive live metrics telemetry.
 */

const Priority = {
    CRITICAL: 0, // Active war attacks, live targets, chain, hospital escapes
    HIGH: 1,     // Target hunting, player status, recent war activity
    NORMAL: 2,   // Member stats, profiles, company, general faction info
    LOW: 3       // Background seeders, historical data, cosmetic info
};

const KeyState = {
    AVAILABLE: 'AVAILABLE',
    BUSY: 'BUSY',
    RATE_LIMITED: 'RATE_LIMITED',
    QUARANTINE: 'QUARANTINE',
    DISABLED: 'DISABLED'
};

const DEFAULT_TTLS = {
    // Volatility-based defaults in milliseconds
    WAR_STATE: 3000,        // Active ranked war attacks & scores
    CHAIN: 5000,            // Chain status and timers
    HOSPITAL_TARGET: 5000,  // Target hospital / okay status
    PLAYER_PROFILE: 60000,  // Player profile & combat stats
    FACTION_ROSTER: 120000, // Faction roster, basic members
    MARKET_ITEMS: 3600000,  // Item database & catalog (1 hour)
    HISTORICAL: 86400000    // Immutable war archives & logs (24 hours)
};

// Feature budgets (max requests per minute) to prevent starvation
const DEFAULT_FEATURE_BUDGETS = {
    warboard: 150,     // High priority
    targets: 40,      // Moderate
    recruitment: 30,  // Background
    dashboard: 40,    // On-demand
    travel: 20,       // Periodic
    general: 50       // Shared
};

class TornAPIManager {
    constructor() {
        this.Priority = Priority;
        this.KeyState = KeyState;

        // Key Pool: Map of keyString -> KeyEntry
        this.keyPool = new Map();
        this.keyCounter = 0;

        // Cache: Map of cacheKey -> CacheEntry
        this.cache = new Map();

        // In-flight deduplication: Map of cacheKey -> Promise
        this.inFlight = new Map();

        // Priority Request Queue
        this.queue = [];
        this.isProcessingQueue = false;
        this.maxConcurrentRequests = 8;
        this.currentActiveRequests = 0;

        // Dynamic State: Normal Mode vs War Mode
        this.isWarActive = false;
        this.warModeFactionId = null;

        // Feature rate budgeting counters (reset every 60s)
        this.featureUsage = new Map();

        // Telemetry & Metrics
        this.metrics = {
            totalRequests: 0,
            cacheHits: 0,
            staleWhileRevalidateHits: 0,
            deduplicatedRequests: 0,
            networkRequests: 0,
            failedRequests: 0,
            rateLimitEvents: 0,
            quarantineEvents: 0,
            latencies: [],
            requestsPerMinute: 0,
            minuteHistory: [],
            endpointCounts: {},
            featureCounts: {},
            startedAt: Date.now()
        };

        // Reset minute buckets every 60 seconds
        this.minuteInterval = setInterval(() => {
            this.metrics.minuteHistory.push({
                ts: Date.now(),
                requests: this.metrics.requestsPerMinute
            });
            if (this.metrics.minuteHistory.length > 60) this.metrics.minuteHistory.shift();
            this.metrics.requestsPerMinute = 0;
            this.featureUsage.clear();

            // Refill token buckets
            const now = Date.now();
            for (const keyEntry of this.keyPool.values()) {
                keyEntry.requestsThisMinute = 0;
                keyEntry.tokens = Math.min(100, keyEntry.tokens + 100);
            }
        }, 60000);

        // Cache cleanup interval (every 5 minutes)
        this.cacheCleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [k, v] of this.cache.entries()) {
                if (v.staleUntil < now) {
                    this.cache.delete(k);
                }
            }
        }, 5 * 60 * 1000);
    }

    // ─────────────────────────────────────────────────────────────
    // Key Management & Health Tracking
    // ─────────────────────────────────────────────────────────────

    /**
     * Add an API key to the authorized background pool
     */
    addPoolKey(apiKey, factionId = null, owner = 'System') {
        if (!apiKey || typeof apiKey !== 'string') return null;
        const cleanKey = apiKey.trim();
        if (cleanKey.length < 16) return null;

        if (this.keyPool.has(cleanKey)) {
            const existing = this.keyPool.get(cleanKey);
            if (factionId && !existing.factionId) existing.factionId = factionId;
            return existing.id;
        }

        this.keyCounter++;
        const keyId = `pool-key-${String(this.keyCounter).padStart(2, '0')}`;
        const entry = {
            id: keyId,
            key: cleanKey,
            owner,
            factionId: factionId ? String(factionId) : null,
            state: KeyState.AVAILABLE,
            tokens: 100, // Token bucket: Torn allows 100 req/min
            lastRefill: Date.now(),
            requestsThisMinute: 0,
            requestsTotal: 0,
            consecutiveErrors: 0,
            lastRequestTs: 0,
            lastSuccessTs: 0,
            activeConcurrent: 0,
            quarantineUntil: 0,
            rateLimitedUntil: 0
        };

        this.keyPool.set(cleanKey, entry);
        console.log(`[TornAPIManager] Registered ${keyId} (Owner: ${owner}). Pool size: ${this.keyPool.size}`);
        return keyId;
    }

    /**
     * Remove an API key from the pool
     */
    removePoolKey(apiKey) {
        if (!apiKey) return false;
        const clean = apiKey.trim();
        const entry = this.keyPool.get(clean);
        if (entry) {
            this.keyPool.delete(clean);
            console.log(`[TornAPIManager] Removed ${entry.id} from pool.`);
            return true;
        }
        return false;
    }

    /**
     * Populate pool from an array of keys
     */
    syncPoolKeys(keys = []) {
        if (!Array.isArray(keys)) return;
        for (const k of keys) {
            if (k) this.addPoolKey(k, null, 'ConfigPool');
        }
    }

    /**
     * Refill token bucket for a specific key
     */
    _refillTokens(keyEntry) {
        const now = Date.now();
        const elapsed = now - keyEntry.lastRefill;
        if (elapsed >= 600) {
            const added = Math.floor(elapsed / 600);
            keyEntry.tokens = Math.min(100, keyEntry.tokens + added);
            keyEntry.lastRefill = now;
        }
    }

    /**
     * Select best available healthy key from pool
     */
    _selectBestKey() {
        const now = Date.now();
        const candidates = [];

        for (const entry of this.keyPool.values()) {
            this._refillTokens(entry);

            // Recover from quarantine if time elapsed
            if (entry.state === KeyState.QUARANTINE && now >= entry.quarantineUntil) {
                entry.state = KeyState.AVAILABLE;
                entry.consecutiveErrors = 0;
            }

            // Recover from rate limit if time elapsed
            if (entry.state === KeyState.RATE_LIMITED && now >= entry.rateLimitedUntil) {
                entry.state = KeyState.AVAILABLE;
            }

            if (entry.state === KeyState.AVAILABLE && entry.tokens > 0 && entry.activeConcurrent < 3) {
                candidates.push(entry);
            }
        }

        if (candidates.length === 0) return null;

        // Sort by least active concurrency, then most tokens, then least recently used
        candidates.sort((a, b) => {
            if (a.activeConcurrent !== b.activeConcurrent) return a.activeConcurrent - b.activeConcurrent;
            if (b.tokens !== a.tokens) return b.tokens - a.tokens;
            return a.lastRequestTs - b.lastRequestTs;
        });

        return candidates[0];
    }

    /**
     * Mark a key as having experienced a rate limit (Code 5 / HTTP 429)
     */
    _markRateLimit(keyEntry, delayMs = 15000) {
        keyEntry.state = KeyState.RATE_LIMITED;
        keyEntry.rateLimitedUntil = Date.now() + delayMs;
        keyEntry.tokens = 0;
        this.metrics.rateLimitEvents++;
        console.warn(`[TornAPIManager] ${keyEntry.id} rate-limited. Throttling for ${Math.round(delayMs / 1000)}s.`);
    }

    /**
     * Mark key error with exponential backoff & quarantine
     */
    _markKeyError(keyEntry, errCode, errMsg) {
        keyEntry.consecutiveErrors++;
        const isFatal = (errCode === 2 || errCode === 13 || errCode === 18); // Invalid/inactive key

        if (isFatal) {
            keyEntry.state = KeyState.DISABLED;
            console.error(`[TornAPIManager] ${keyEntry.id} permanently disabled: ${errMsg}`);
            return;
        }

        if (errCode === 5) {
            this._markRateLimit(keyEntry, 15000);
            return;
        }

        if (keyEntry.consecutiveErrors >= 3) {
            const quarantineSecs = Math.min(300, 10 * Math.pow(2, keyEntry.consecutiveErrors - 3));
            keyEntry.state = KeyState.QUARANTINE;
            keyEntry.quarantineUntil = Date.now() + (quarantineSecs * 1000);
            this.metrics.quarantineEvents++;
            console.warn(`[TornAPIManager] ${keyEntry.id} entered quarantine for ${quarantineSecs}s (${errMsg}).`);
        }
    }

    /**
     * Mark key request success
     */
    _markKeySuccess(keyEntry) {
        keyEntry.consecutiveErrors = 0;
        keyEntry.lastSuccessTs = Date.now();
        if (keyEntry.state === KeyState.BUSY || keyEntry.state === KeyState.QUARANTINE) {
            keyEntry.state = KeyState.AVAILABLE;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Core Central Request Pipeline
    // ─────────────────────────────────────────────────────────────

    /**
     * The ONE Central Torn API Request Method
     * 
     * @param {Object} options
     * @param {string} options.endpoint - 'faction', 'user', 'torn', 'market', 'company', 'v2/...'
     * @param {string|number} [options.id] - Optional ID (player ID, faction ID, item ID)
     * @param {string} [options.selections] - Torn API selections (comma-separated)
     * @param {string} [options.cat] - Optional v2 cat filter
     * @param {number} [options.priority] - Priority.CRITICAL (0), HIGH (1), NORMAL (2), LOW (3)
     * @param {string} [options.feature] - Feature tag for budgeting ('warboard', 'targets', etc.)
     * @param {number} [options.ttlMs] - Custom cache TTL in ms
     * @param {boolean} [options.staleWhileRevalidate=true] - Return stale cache if available
     * @param {string} [options.userKey] - Dedicated user Torn API key for private user data
     * @param {boolean} [options.forceRefresh=false] - Bypass cache read (still updates cache)
     * @param {string} [options.scope='faction'] - 'user' (strictly requires userKey) or 'faction'/'public'
     */
    async request(options) {
        const {
            endpoint,
            id = '',
            selections = '',
            cat = '',
            priority = Priority.NORMAL,
            feature = 'general',
            ttlMs = null,
            staleWhileRevalidate = true,
            userKey = null,
            forceRefresh = false,
            scope = 'faction'
        } = options;

        this.metrics.totalRequests++;
        this.metrics.featureCounts[feature] = (this.metrics.featureCounts[feature] || 0) + 1;
        this.metrics.endpointCounts[endpoint] = (this.metrics.endpointCounts[endpoint] || 0) + 1;

        // 1. MULTI-USER ISOLATION MANDATE
        // If private user data is requested, it MUST use userKey and NEVER borrow pool keys.
        if (scope === 'user') {
            if (!userKey || typeof userKey !== 'string' || userKey.trim().length < 16) {
                throw new Error('[TornAPIManager] Access Denied: User-scoped request requires caller\'s authenticated Torn API key.');
            }
        }

        // 2. Compute canonical cache key
        const cleanId = id ? String(id).trim() : '';
        const cleanSel = selections ? selections.split(',').map(s => s.trim().toLowerCase()).sort().join(',') : '';
        const userScopeTag = (scope === 'user') ? `_usr:${this.redactKey(userKey)}` : '';
        const cacheKey = `${endpoint}:${cleanId}:${cleanSel}:${cat}${userScopeTag}`;

        // 3. Resolve TTL based on endpoint/selections volatility if not explicitly provided
        const effectiveTTL = ttlMs !== null ? ttlMs : this._resolveDefaultTTL(endpoint, selections);
        const staleGraceMs = effectiveTTL * 2; // Stale window is 2x TTL

        // 4. Check Tiered Cache
        const now = Date.now();
        if (!forceRefresh && this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (now < cached.expiresAt) {
                this.metrics.cacheHits++;
                return cached.data;
            }

            // Stale-While-Revalidate: Return cached immediately, trigger background refresh
            if (staleWhileRevalidate && now < cached.staleUntil) {
                this.metrics.staleWhileRevalidateHits++;
                // Background refresh without blocking caller
                this._enqueueRequest(options, cacheKey, effectiveTTL, staleGraceMs).catch(() => {});
                return cached.data;
            }
        }

        // 5. Check In-Flight Request Deduplication
        // If an identical request is already running, join that Promise!
        if (this.inFlight.has(cacheKey)) {
            this.metrics.deduplicatedRequests++;
            return await this.inFlight.get(cacheKey);
        }

        // 6. Enqueue & Execute Request
        const executePromise = this._enqueueRequest(options, cacheKey, effectiveTTL, staleGraceMs);
        this.inFlight.set(cacheKey, executePromise);

        try {
            const result = await executePromise;
            return result;
        } finally {
            this.inFlight.delete(cacheKey);
        }
    }

    /**
     * Internal request execution through Priority Queue
     */
    _enqueueRequest(options, cacheKey, effectiveTTL, staleGraceMs) {
        return new Promise((resolve, reject) => {
            const task = {
                options,
                cacheKey,
                effectiveTTL,
                staleGraceMs,
                priority: options.priority !== undefined ? options.priority : Priority.NORMAL,
                feature: options.feature || 'general',
                enqueuedAt: Date.now(),
                retries: 0,
                resolve,
                reject
            };

            // In War Mode, bump warboard feature priority automatically
            if (this.isWarActive && (options.feature === 'warboard' || options.endpoint === 'faction')) {
                task.priority = Math.min(task.priority, Priority.CRITICAL);
            }

            this._insertSortedQueue(task);
            this._processQueue();
        });
    }

    _insertSortedQueue(task) {
        // Strict Priority insertion: lower number = higher priority
        let inserted = false;
        for (let i = 0; i < this.queue.length; i++) {
            if (task.priority < this.queue[i].priority) {
                this.queue.splice(i, 0, task);
                inserted = true;
                break;
            }
        }
        if (!inserted) this.queue.push(task);
    }

    async _processQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        try {
            while (this.queue.length > 0 && this.currentActiveRequests < this.maxConcurrentRequests) {
                const task = this.queue.shift();

                // Feature budgeting check for non-critical requests
                if (task.priority > Priority.CRITICAL) {
                    const budget = DEFAULT_FEATURE_BUDGETS[task.feature] || 50;
                    const used = this.featureUsage.get(task.feature) || 0;
                    if (used >= budget) {
                        // Throttled: delay by 1000ms
                        setTimeout(() => {
                            this._insertSortedQueue(task);
                            this._processQueue();
                        }, 1000);
                        continue;
                    }
                }

                this.currentActiveRequests++;
                this._executeTask(task).finally(() => {
                    this.currentActiveRequests--;
                    this._processQueue();
                });
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    async _executeTask(task) {
        const { options, cacheKey, effectiveTTL, staleGraceMs } = task;
        const startTime = Date.now();

        // 1. Select Key
        let keyEntry = null;
        let apiKeyToUse = null;

        if (options.scope === 'user') {
            apiKeyToUse = options.userKey;
        } else if (options.userKey) {
            apiKeyToUse = options.userKey;
        } else {
            keyEntry = this._selectBestKey();
            if (!keyEntry) {
                // If all pool keys are busy, re-queue with exponential delay if retries left
                if (task.retries < 5) {
                    task.retries++;
                    const waitDelay = Math.min(3000, 200 * Math.pow(1.5, task.retries));
                    setTimeout(() => {
                        this._insertSortedQueue(task);
                        this._processQueue();
                    }, waitDelay);
                    return;
                }

                // If cache exists, degrade gracefully
                if (this.cache.has(cacheKey)) {
                    const cached = this.cache.get(cacheKey);
                    return task.resolve({ ...cached.data, _isStale: true, _staleReason: 'Key pool capacity exhausted' });
                }
                return task.reject(new Error('[TornAPIManager] API key pool capacity temporarily exhausted.'));
            }

            apiKeyToUse = keyEntry.key;
            keyEntry.tokens--;
            keyEntry.requestsThisMinute++;
            keyEntry.requestsTotal++;
            keyEntry.activeConcurrent++;
            keyEntry.lastRequestTs = Date.now();
        }

        // Feature budget tracking
        const currentFeatUsage = this.featureUsage.get(task.feature) || 0;
        this.featureUsage.set(task.feature, currentFeatUsage + 1);
        this.metrics.networkRequests++;
        this.metrics.requestsPerMinute++;

        // 2. Build URL
        const url = this._buildUrl(options, apiKeyToUse);

        try {
            const controller = new AbortController();
            const timeoutMs = (task.priority === Priority.CRITICAL) ? 7000 : 10000;
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            const data = await res.json();
            const latency = Date.now() - startTime;
            this._recordLatency(latency);

            // Handle Torn API Level Errors
            if (data && data.error) {
                const errCode = Number(data.error.code);
                const errMsg = data.error.error || 'Unknown Torn error';

                if (keyEntry) {
                    this._markKeyError(keyEntry, errCode, errMsg);
                }

                // Code 5: Too Many Requests (Rate limit)
                if (errCode === 5 && task.retries < 3) {
                    task.retries++;
                    const jitter = Math.floor(Math.random() * 500);
                    const backoff = Math.min(10000, (1000 * Math.pow(2, task.retries)) + jitter);
                    console.warn(`[TornAPIManager] Rate limit hit. Backing off ${backoff}ms (Attempt ${task.retries}).`);
                    setTimeout(() => {
                        this._insertSortedQueue(task);
                        this._processQueue();
                    }, backoff);
                    return;
                }

                // If cache exists, degrade gracefully instead of crashing caller
                if (this.cache.has(cacheKey)) {
                    const cached = this.cache.get(cacheKey);
                    return task.resolve({ ...cached.data, _isStale: true, _staleReason: errMsg });
                }

                throw new Error(`[Torn API Error ${errCode}]: ${errMsg}`);
            }

            // Success!
            if (keyEntry) {
                this._markKeySuccess(keyEntry);
            }

            // Save to tiered cache
            const expiresAt = Date.now() + effectiveTTL;
            const staleUntil = Date.now() + staleGraceMs;
            this.cache.set(cacheKey, {
                data,
                expiresAt,
                staleUntil,
                fetchTs: Date.now()
            });

            // Safe log (redacted)
            const keyLabel = keyEntry ? keyEntry.id : `user-key-${this.redactKey(apiKeyToUse)}`;
            // Optional: log at trace level
            // console.log(`[TornAPIManager] 200 OK | ${keyLabel} | ${options.endpoint} | ${latency}ms`);

            task.resolve(data);

        } catch (err) {
            this.metrics.failedRequests++;

            if (keyEntry) {
                this._markKeyError(keyEntry, 0, err.message);
            }

            // Retry on transient network/timeout error
            if (task.retries < 2 && (err.name === 'AbortError' || err.message.includes('fetch'))) {
                task.retries++;
                const backoff = 500 * Math.pow(2, task.retries);
                setTimeout(() => {
                    this._insertSortedQueue(task);
                    this._processQueue();
                }, backoff);
                return;
            }

            // Fall back to stale cache if available
            if (this.cache.has(cacheKey)) {
                const cached = this.cache.get(cacheKey);
                console.warn(`[TornAPIManager] Network failure for ${options.endpoint}; serving stale cached data.`);
                return task.resolve({ ...cached.data, _isStale: true, _staleReason: err.message });
            }

            task.reject(err);
        } finally {
            if (keyEntry) {
                keyEntry.activeConcurrent = Math.max(0, keyEntry.activeConcurrent - 1);
            }
        }
    }

    _buildUrl(options, apiKey) {
        const { endpoint, id, selections, cat } = options;
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
        const idPart = id ? `/${id}` : '';
        const params = new URLSearchParams();

        if (selections) params.append('selections', selections);
        if (cat) params.append('cat', cat);
        params.append('key', apiKey);

        return `https://api.torn.com/${cleanEndpoint}${idPart}?${params.toString()}`;
    }

    _resolveDefaultTTL(endpoint, selections = '') {
        const sel = selections.toLowerCase();
        if (endpoint === 'faction') {
            if (sel.includes('attacks') || sel.includes('rankedwars')) return DEFAULT_TTLS.WAR_STATE;
            if (sel.includes('chain')) return DEFAULT_TTLS.CHAIN;
            if (sel.includes('basic')) return DEFAULT_TTLS.FACTION_ROSTER;
        }
        if (endpoint === 'user') {
            if (sel.includes('profile') || sel.includes('battlestats')) return DEFAULT_TTLS.PLAYER_PROFILE;
            if (sel.includes('bars')) return 15000;
        }
        if (endpoint === 'torn') {
            if (sel.includes('items')) return DEFAULT_TTLS.MARKET_ITEMS;
            if (sel.includes('rankedwarreport')) return DEFAULT_TTLS.HISTORICAL;
        }
        return 10000;
    }

    _recordLatency(ms) {
        this.metrics.latencies.push(ms);
        if (this.metrics.latencies.length > 100) this.metrics.latencies.shift();
    }

    // ─────────────────────────────────────────────────────────────
    // Dynamic War Mode & Smart Pre-fetching
    // ─────────────────────────────────────────────────────────────

    setWarMode(isActive, factionId = null) {
        if (this.isWarActive !== isActive) {
            this.isWarActive = isActive;
            this.warModeFactionId = factionId;
            console.log(`[TornAPIManager] Operational mode switched to: ${isActive ? '⚡ WAR MODE' : '🕊️ NORMAL MODE'}`);
        }
    }

    /**
     * Compute optimized refresh delay for a hospital countdown.
     * Prevents polling every 2s for a player who is hospitalized for 30 minutes!
     * 
     * @param {number} hospitalUntilUnixSeconds - Target's 'until' timestamp
     * @returns {number} Suggested poll delay in milliseconds
     */
    computeHospitalPollDelay(hospitalUntilUnixSeconds) {
        const nowSec = Math.floor(Date.now() / 1000);
        const remainingSec = hospitalUntilUnixSeconds - nowSec;

        if (remainingSec <= 0) return 3000;         // Already okay / just out -> check in 3s
        if (remainingSec <= 15) return 2000;        // Within 15s -> check every 2s
        if (remainingSec <= 60) return 10000;       // Within 1 minute -> check in 10s
        if (remainingSec <= 300) return 30000;      // Within 5 minutes -> check in 30s
        if (remainingSec <= 1800) return 60000;     // Within 30 minutes -> check in 60s
        return 120000;                              // Long hospitalization -> check in 2 mins
    }

    // ─────────────────────────────────────────────────────────────
    // Security & Utility
    // ─────────────────────────────────────────────────────────────

    redactKey(key) {
        if (!key || typeof key !== 'string') return 'none';
        if (key.length < 8) return '***';
        return `${key.slice(0, 3)}***${key.slice(-3)}`;
    }

    sanitizeError(message) {
        if (!message || typeof message !== 'string') return message;
        return message.replace(/[a-zA-Z0-9]{16,64}/g, match => this.redactKey(match));
    }

    // ─────────────────────────────────────────────────────────────
    // Live Admin Metrics Telemetry
    // ─────────────────────────────────────────────────────────────

    getMetrics() {
        const totalCacheHandled = this.metrics.cacheHits + this.metrics.staleWhileRevalidateHits;
        const totalQueries = this.metrics.totalRequests || 1;
        const cacheHitRate = ((totalCacheHandled / totalQueries) * 100).toFixed(1) + '%';
        const avgLatency = this.metrics.latencies.length > 0
            ? Math.round(this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length)
            : 0;

        const poolStatus = [];
        for (const entry of this.keyPool.values()) {
            poolStatus.push({
                keyId: entry.id,
                owner: entry.owner,
                factionId: entry.factionId,
                state: entry.state,
                tokensRemaining: entry.tokens,
                requestsThisMinute: entry.requestsThisMinute,
                requestsTotal: entry.requestsTotal,
                consecutiveErrors: entry.consecutiveErrors,
                activeConcurrent: entry.activeConcurrent
            });
        }

        return {
            mode: this.isWarActive ? 'WAR_MODE' : 'NORMAL_MODE',
            warFactionId: this.warModeFactionId,
            poolSize: this.keyPool.size,
            healthyPoolKeys: poolStatus.filter(k => k.state === KeyState.AVAILABLE).length,
            queueDepth: this.queue.length,
            activeConcurrentRequests: this.currentActiveRequests,
            totalRequestsProcessed: this.metrics.totalRequests,
            networkRequestsSent: this.metrics.networkRequests,
            requestsPreventedByCache: totalCacheHandled,
            requestsPreventedByDedup: this.metrics.deduplicatedRequests,
            cacheHitRate,
            averageLatencyMs: avgLatency,
            rateLimitEvents: this.metrics.rateLimitEvents,
            quarantineEvents: this.metrics.quarantineEvents,
            failedRequests: this.metrics.failedRequests,
            requestsThisMinute: this.metrics.requestsPerMinute,
            endpointBreakdown: this.metrics.endpointCounts,
            featureBreakdown: this.metrics.featureCounts,
            keyPoolDetails: poolStatus
        };
    }
}

// Global Singleton Instance
const tornApiManager = new TornAPIManager();

module.exports = tornApiManager;
