'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  F.R.I.D.A.Y — Retaliation Risk Engine v1.1.0
//  Autonomous background infrastructure for Torn retaliation risk analysis.
//
//  1. Continuous attack ingestion (rolling 90-day window)
//  2. Retal correlation (0–6h window, records retals & explicit no-retals)
//  3. Nightly aggregate rollups (per-target and per-faction stats)
//  4. Empirical Bayes shrinkage (k=7) with exponential recency decay (λ=0.05)
//  5. Cold-start scoring (Torn profile/personalstats + logistic regression)
//  6. Zero hardcoded credentials: all API keys passed dynamically via getters
// ═══════════════════════════════════════════════════════════════════════════

// ── Tuning Constants ────────────────────────────────────────────────────────
const K_SHRINKAGE          = 7;              // Empirical Bayes k — low-sample protection
const LAMBDA_DECAY         = 0.05;           // Exponential decay rate per day
const RETAL_WINDOW_SECS    = 6 * 3600;       // 6-hour retal correlation window
const PEACE_POLL_MS        = 30_000;         // 30s poll in peacetime (2 req/min, 2% of rate limit)
const WAR_POLL_MS          = 15_000;         // 15s poll during active war
const SWEEP_INTERVAL_MS    = 15 * 60 * 1000; // 15m un-correlated attack sweep
const ATTACK_LOG_TTL_DAYS  = 90;
const GLOBAL_MEAN_RATE     = 0.28;           // Prior when no faction data
const ROLLUP_HOUR_UTC      = 0;              // Nightly rollup at 00:xx UTC
const ROLLUP_MINUTE_UTC    = 15;
const MODEL_RETRAIN_DAY    = 0;              // Sunday (0=Sun per JS Date.getDay())
const MODEL_RETRAIN_HOUR   = 1;              // 01:00 UTC Sunday
const LR                   = 0.05;           // Logistic regression learning rate
const LR_EPOCHS            = 500;            // Gradient descent iterations
const COLD_FEATURES        = 5;              // 5 features for cold-start model
const DEDUP_CACHE_SIZE     = 3000;
const PERF_CACHE_TTL_MS    = 5 * 60 * 1000;  // 5-min in-memory score cache
const PROFILE_CACHE_TTL_MS = 15 * 60 * 1000; // 15-min in-memory profile cache

// Baseline logistic weights (calibrated for Torn combat dynamics prior to ML retrain)
// Features: [lifetime_ratio, online_val, level_age, bs_ratio, faction_at_war]
const DEFAULT_WEIGHTS = [-1.20, 0.85, 1.15, 0.40, 0.70, 1.30]; // [bias, w1..w5]
const DEFAULT_SCALING = {
    means: [0.50, 0.40, 0.45, 0.50, 0.30],
    stds:  [0.25, 0.35, 0.25, 0.30, 0.45]
};

// ── Module State ────────────────────────────────────────────────────────────
let _getApiKey      = null;      // () => string|null
let _db             = null;      // MongoDB Db instance
let _ourFactionId   = 52355;     // number — Spider-Verse (52355), updated dynamically if faction changes
let _lastIngestTs   = 0;         // unix seconds of last fetched attack
let _recentCodes    = new Set(); // dedup cache (last DEDUP_CACHE_SIZE attack codes)
let _alertedAttackCodes = new Set(); // in-memory dedup for alerts
let _onAttackAlertCallback = null;   // async callback (atkPayload) => void
let _isWarMode      = false;
let _modelWeights   = null;      // [bias, w1..w5]
let _modelScaling   = null;      // { means: number[], stds: number[] }
let _scoreCache     = new Map(); // target_id => { score, ts }
let _profileCache   = new Map(); // target_id => { data, ts }
let _lastRollupDay  = -1;
let _lastRetrainDay = -1;
let _lastSweepTs    = 0;
let _running        = false;

// ── Utility ─────────────────────────────────────────────────────────────────
const col = (name) => _db.collection(name);
const nowSecs = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function sigmoid(z) {
    if (z > 20) return 1.0;
    if (z < -20) return 0.0;
    return 1 / (1 + Math.exp(-z));
}

function decayWeight(ageMs) {
    const ageDays = ageMs / 86_400_000;
    return Math.exp(-LAMBDA_DECAY * ageDays);
}

function dayOfYear(d = new Date()) {
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86_400_000);
}

function estimateStatsFromLevel(level) {
    if (!level || level <= 0) return 1000;
    if (level <= 10) return Math.round(level * 3000);
    if (level <= 20) return Math.round(30000 + (level - 10) * 15000);
    if (level <= 35) return Math.round(180000 + (level - 20) * 80000);
    if (level <= 50) return Math.round(1380000 + (level - 35) * 400000);
    if (level <= 70) return Math.round(7380000 + (level - 50) * 2500000);
    if (level <= 85) return Math.round(57380000 + (level - 70) * 15000000);
    if (level <= 100) return Math.round(282380000 + (level - 85) * 50000000);
    return 1500000000;
}

// ── Ensure MongoDB Indexes ───────────────────────────────────────────────────
async function ensureIndexes() {
    try {
        const al = col('attack_log');
        await al.createIndex({ ingested_at: 1 }, { expireAfterSeconds: ATTACK_LOG_TTL_DAYS * 86400, background: true });
        await al.createIndex({ attacker_id: 1, timestamp: -1 }, { background: true });
        await al.createIndex({ defender_id: 1, timestamp: -1 }, { background: true });
        await al.createIndex({ attacker_faction_id: 1, timestamp: -1 }, { background: true });
        await al.createIndex({ defender_faction_id: 1, timestamp: -1 }, { background: true });
        await al.createIndex({ our_faction_id: 1, direction: 1, timestamp: -1 }, { background: true });

        const re = col('retal_events');
        await re.createIndex({ target_id: 1, outgoing_ts: -1 }, { background: true });
        await re.createIndex({ outgoing_attack_id: 1 }, { unique: true, background: true });
        await re.createIndex({ target_faction_id: 1, outgoing_ts: -1 }, { background: true });
        await re.createIndex({ retaliator_id: 1 }, { background: true });

        const ra = col('retal_aggregates');
        await ra.createIndex({ type: 1, entity_id: 1 }, { background: true });

        console.log('[RetalEngine] MongoDB indexes verified and ensured.');
    } catch(e) {
        console.warn('[RetalEngine] Index setup warning (non-fatal):', e.message);
    }
}

// ── Seed Dedup Cache from DB on Startup ──────────────────────────────────────
async function seedDedupCache() {
    try {
        const recent = await col('attack_log')
            .find({}, { projection: { _id: 1, timestamp: 1 } })
            .sort({ timestamp: -1 })
            .limit(DEDUP_CACHE_SIZE)
            .toArray();

        for (const r of recent) _recentCodes.add(r._id);
        if (recent.length > 0 && recent[0].timestamp) {
            _lastIngestTs = recent[0].timestamp;
        }
        console.log(`[RetalEngine] Seeded dedup cache with ${_recentCodes.size} codes. Last ingest ts: ${_lastIngestTs}`);
    } catch(e) {
        console.warn('[RetalEngine] Dedup cache seed warning:', e.message);
    }
}

// ── Load Model Weights from DB ───────────────────────────────────────────────
async function loadModelWeights() {
    try {
        const doc = await col('retal_aggregates').findOne({ _id: 'model_weights' });
        if (doc && doc.weights && doc.scaling) {
            _modelWeights = doc.weights;
            _modelScaling = doc.scaling;
            console.log('[RetalEngine] Loaded trained logistic model weights from MongoDB.');
        } else {
            _modelWeights = DEFAULT_WEIGHTS;
            _modelScaling = DEFAULT_SCALING;
            console.log('[RetalEngine] Initialized with calibrated baseline logistic weights.');
        }
    } catch(e) {
        _modelWeights = DEFAULT_WEIGHTS;
        _modelScaling = DEFAULT_SCALING;
        console.warn('[RetalEngine] Fallback to calibrated default weights:', e.message);
    }
}

// ── Attack Alert Dispatch & Backlog ──────────────────────────────────────────
function setOnAttackAlertCallback(fn) {
    _onAttackAlertCallback = fn;
}

async function dispatchAttackAlert(doc, atkRaw = {}) {
    if (typeof _onAttackAlertCallback !== 'function') return;
    const code = String(doc._id || doc.code || '');
    if (!code) return;

    if (_alertedAttackCodes.has(code)) return;

    try {
        if (_db) {
            const existing = await col('attack_alerts').findOne({ _id: code });
            if (existing) {
                _alertedAttackCodes.add(code);
                return;
            }
            // Mark as alerted in MongoDB
            await col('attack_alerts').insertOne({
                _id: code,
                timestamp: doc.timestamp,
                attacker_id: doc.attacker_id,
                defender_id: doc.defender_id,
                direction: doc.direction,
                alerted_at: new Date()
            }).catch(() => {});
        }
        _alertedAttackCodes.add(code);

        // Keep _alertedAttackCodes bounded
        if (_alertedAttackCodes.size > 5000) {
            const oldest = _alertedAttackCodes.values().next().value;
            _alertedAttackCodes.delete(oldest);
        }

        const payload = {
            code,
            attacker_id: doc.attacker_id,
            attacker_name: doc.attacker_name || atkRaw.attacker_name || '',
            attacker_faction: doc.attacker_faction_id || doc.attacker_faction || 0,
            attacker_faction_name: doc.attacker_faction_name || atkRaw.attacker_factionname || '',
            defender_id: doc.defender_id,
            defender_name: doc.defender_name || atkRaw.defender_name || '',
            defender_faction: doc.defender_faction_id || doc.defender_faction || 0,
            defender_faction_name: doc.defender_faction_name || atkRaw.defender_factionname || '',
            result: doc.result || atkRaw.result || 'Attacked',
            timestamp: doc.timestamp,
            respect: doc.respect || atkRaw.respect_gain || 0,
            modifiers: doc.modifiers || atkRaw.modifiers || {},
            direction: doc.direction
        };

        console.log(`[RetalEngine] Dispatching alert for attack ${code}: ${payload.defender_name || payload.defender_id} attacked by ${payload.attacker_name || payload.attacker_id} (${doc.direction})`);
        await _onAttackAlertCallback(payload);
    } catch(e) {
        console.warn('[RetalEngine] Alert dispatch error for attack', code, ':', e.message);
    }
}

async function checkPendingRecentAlerts() {
    if (typeof _onAttackAlertCallback !== 'function' || !_db) return;
    try {
        const cutoff = nowSecs() - 3600; // last 60 minutes
        const recentAttacks = await col('attack_log')
            .find({
                defender_faction_id: _ourFactionId,
                timestamp: { $gte: cutoff }
            })
            .sort({ timestamp: 1 })
            .toArray();

        if (recentAttacks.length > 0) {
            console.log(`[RetalEngine] Checking ${recentAttacks.length} recent attacks from last 60m for pending alerts...`);
            for (const doc of recentAttacks) {
                if (doc.attacker_id && doc.defender_id && doc.attacker_id === doc.defender_id) continue;
                await dispatchAttackAlert(doc);
            }
        }
    } catch(e) {
        console.warn('[RetalEngine] Backlog alert check error:', e.message);
    }
}

// ── 1. Attack Ingestion Job ──────────────────────────────────────────────────
async function ingestAttacks() {
    if (typeof _getApiKey !== 'function') return;
    const apiKey = _getApiKey();
    if (!apiKey) return;

    try {
        // Query faction attacks & basic status with timeout
        const url = `https://api.torn.com/faction/?selections=attacks,basic&key=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
        const data = await res.json();

        if (data.error) {
            if (data.error.code !== 5) { // code 5 = rate limit, keep silent
                console.warn('[RetalEngine] Ingestion API error:', data.error.error);
            }
            return;
        }

        // Dynamically resolve our faction ID
        if (data.ID) {
            _ourFactionId = Number(data.ID);
        }

        // War mode detection
        const hasWar = data.ranked_wars && Object.keys(data.ranked_wars || {}).some(wid => {
            const w = data.ranked_wars[wid];
            return !w.war?.end;
        });
        _isWarMode = !!hasWar;

        const attacks = data.attacks || {};
        if (!Object.keys(attacks).length) return;

        const docs = [];
        const newOutgoing = [];
        const newIncoming = [];

        for (const [code, atk] of Object.entries(attacks)) {
            if (!atk.timestamp_ended) continue;

            const ts = Number(atk.timestamp_ended);
            const atkFac = Number(atk.attacker_faction || 0);
            const defFac = Number(atk.defender_faction || 0);
            const atkId = Number(atk.attacker_id || 0);
            const defId = Number(atk.defender_id || 0);

            let direction = null;
            if (_ourFactionId) {
                if (atkFac === _ourFactionId && defFac === _ourFactionId) direction = 'internal';
                else if (atkFac === _ourFactionId) direction = 'outgoing';
                else if (defFac === _ourFactionId) direction = 'incoming';
            }

            if (!direction) continue; // Skip attacks not involving our faction

            const attackerName = atk.attacker_name || data.members?.[atkId]?.name || '';
            const defenderName = atk.defender_name || data.members?.[defId]?.name || '';
            const attackerFactionName = atk.attacker_factionname || (atkFac === _ourFactionId ? (data.name || 'Spider-Verse') : '');
            const defenderFactionName = atk.defender_factionname || (defFac === _ourFactionId ? (data.name || 'Spider-Verse') : '');

            // Real-time alert check: if our faction member was attacked (not self-hit)
            if (defFac === _ourFactionId && atkId !== defId) {
                const isRecent = ts > (nowSecs() - 3600); // within last 60 mins
                if (isRecent) {
                    const tempDoc = {
                        _id: code,
                        attacker_id: atkId,
                        attacker_name: attackerName,
                        attacker_faction_id: atkFac,
                        attacker_faction_name: attackerFactionName,
                        defender_id: defId,
                        defender_name: defenderName,
                        defender_faction_id: defFac,
                        defender_faction_name: defenderFactionName,
                        timestamp: ts,
                        result: atk.result || 'unknown',
                        respect: Number(atk.respect_gain || atk.respect || 0),
                        modifiers: atk.modifiers || {},
                        direction
                    };
                    dispatchAttackAlert(tempDoc, atk).catch(err => console.warn('[RetalEngine] Alert dispatch error:', err.message));
                }
            }

            if (_recentCodes.has(code)) continue;

            const doc = {
                _id: code,
                attacker_id: atkId,
                attacker_name: attackerName,
                attacker_faction_id: atkFac,
                attacker_faction_name: attackerFactionName,
                defender_id: defId,
                defender_name: defenderName,
                defender_faction_id: defFac,
                defender_faction_name: defenderFactionName,
                timestamp: ts,
                result: atk.result || 'unknown',
                respect: Number(atk.respect_gain || atk.respect || 0),
                modifiers: atk.modifiers || {},
                direction,
                our_faction_id: _ourFactionId,
                ingested_at: new Date()
            };

            docs.push(doc);

            if (direction === 'outgoing') newOutgoing.push(doc);
            else if (direction === 'incoming') newIncoming.push(doc);

            // Maintain FIFO dedup cache
            if (_recentCodes.size >= DEDUP_CACHE_SIZE) {
                const oldest = _recentCodes.values().next().value;
                _recentCodes.delete(oldest);
            }
            _recentCodes.add(code);

            if (ts > _lastIngestTs) _lastIngestTs = ts;
        }

        if (docs.length === 0) return;

        // Bulk insert new attacks, ignore duplicates
        try {
            await col('attack_log').insertMany(docs, { ordered: false });
        } catch(e) {
            if (e.code !== 11000) throw e;
        }

        console.log(`[RetalEngine] Ingested ${docs.length} attacks (${newOutgoing.length} out / ${newIncoming.length} in)`);

        // Correlate new attacks immediately (internal hits skipped from correlation)
        if (newOutgoing.length > 0 || newIncoming.length > 0) {
            await runImmediateCorrelation(newOutgoing, newIncoming);
        }

    } catch(e) {
        console.warn('[RetalEngine] Ingest cycle error:', e.message);
    }
}

// ── 2. Retal Correlation Job ────────────────────────────────────────────────
async function runImmediateCorrelation(newOutgoing, newIncoming) {
    // A. For new outgoing attacks: look for incoming attacks within [ts, ts + 6h]
    for (const out of newOutgoing) {
        try {
            const existing = await col('retal_events').findOne({ outgoing_attack_id: out._id });
            if (existing) continue;

            const windowEnd = out.timestamp + RETAL_WINDOW_SECS;

            const retalAtk = await col('attack_log').findOne({
                direction: 'incoming',
                $or: [
                    { attacker_id: out.defender_id },
                    { attacker_faction_id: out.defender_faction_id }
                ],
                timestamp: { $gte: out.timestamp, $lte: windowEnd }
            }, { sort: { timestamp: 1 } });

            if (retalAtk) {
                const delta = retalAtk.timestamp - out.timestamp;
                const outcome = normalizeOutcome(retalAtk.result);

                await col('retal_events').insertOne({
                    _id: `retal_${out._id}`,
                    outgoing_attack_id: out._id,
                    incoming_attack_id: retalAtk._id,
                    outgoing_ts: out.timestamp,
                    incoming_ts: retalAtk.timestamp,
                    delta_seconds: Math.max(0, delta),
                    target_id: out.defender_id,
                    target_faction_id: out.defender_faction_id,
                    retaliator_id: retalAtk.attacker_id,
                    retaliator_faction_id: retalAtk.attacker_faction_id,
                    outcome,
                    is_retal: true,
                    created_at: new Date()
                }).catch(e => { if (e.code !== 11000) throw e; });

                _scoreCache.delete(out.defender_id);
            }
        } catch(e) {
            if (e.code !== 11000) console.warn('[RetalEngine] Outgoing correlation error:', e.message);
        }
    }

    // B. For new incoming attacks: look backward 0-6h for an outgoing hit from our faction
    for (const inc of newIncoming) {
        try {
            const windowStart = inc.timestamp - RETAL_WINDOW_SECS;

            const outAtk = await col('attack_log').findOne({
                direction: 'outgoing',
                $or: [
                    { defender_id: inc.attacker_id },
                    { defender_faction_id: inc.attacker_faction_id }
                ],
                timestamp: { $gte: windowStart, $lte: inc.timestamp }
            }, { sort: { timestamp: -1 } });

            if (outAtk) {
                const existing = await col('retal_events').findOne({ outgoing_attack_id: outAtk._id });
                if (!existing) {
                    const delta = inc.timestamp - outAtk.timestamp;
                    const outcome = normalizeOutcome(inc.result);

                    await col('retal_events').insertOne({
                        _id: `retal_${outAtk._id}`,
                        outgoing_attack_id: outAtk._id,
                        incoming_attack_id: inc._id,
                        outgoing_ts: outAtk.timestamp,
                        incoming_ts: inc.timestamp,
                        delta_seconds: Math.max(0, delta),
                        target_id: outAtk.defender_id,
                        target_faction_id: outAtk.defender_faction_id,
                        retaliator_id: inc.attacker_id,
                        retaliator_faction_id: inc.attacker_faction_id,
                        outcome,
                        is_retal: true,
                        created_at: new Date()
                    }).catch(e => { if (e.code !== 11000) throw e; });

                    _scoreCache.delete(outAtk.defender_id);
                }
            }
        } catch(e) {
            if (e.code !== 11000) console.warn('[RetalEngine] Incoming correlation error:', e.message);
        }
    }
}

function normalizeOutcome(result) {
    if (!result) return 'unknown';
    const r = String(result).toLowerCase();
    if (r.includes('hospital')) return 'hosp';
    if (r.includes('attacked') || r.includes('mugged') || r.includes('arrested')) return 'loss'; // enemy landed a hit on us
    if (r.includes('lost') || r.includes('defended') || r.includes('intercepted')) return 'win'; // we defended successfully
    if (r.includes('stalemate')) return 'stalemate';
    return r;
}

// ── Persistent No-Retal & Backfill Sweep (runs every 15 min) ────────────────
async function sweepUncorrelatedAttacks() {
    try {
        const now = nowSecs();
        const sixHoursAgo = now - RETAL_WINDOW_SECS;
        const ninetyDaysAgo = now - (ATTACK_LOG_TTL_DAYS * 86400);

        // Find outgoing attacks older than 6h that do not yet have an event in retal_events
        const pendingOut = await col('attack_log').find({
            direction: 'outgoing',
            timestamp: { $lte: sixHoursAgo, $gte: ninetyDaysAgo }
        }).sort({ timestamp: -1 }).limit(300).toArray();

        let resolvedRetals = 0;
        let resolvedNoRetals = 0;

        for (const out of pendingOut) {
            const existing = await col('retal_events').findOne({ outgoing_attack_id: out._id });
            if (existing) continue;

            const windowEnd = out.timestamp + RETAL_WINDOW_SECS;

            const matched = await col('attack_log').findOne({
                direction: 'incoming',
                $or: [
                    { attacker_id: out.defender_id },
                    { attacker_faction_id: out.defender_faction_id }
                ],
                timestamp: { $gte: out.timestamp, $lte: windowEnd }
            }, { sort: { timestamp: 1 } });

            if (matched) {
                const delta = matched.timestamp - out.timestamp;
                const outcome = normalizeOutcome(matched.result);

                await col('retal_events').insertOne({
                    _id: `retal_${out._id}`,
                    outgoing_attack_id: out._id,
                    incoming_attack_id: matched._id,
                    outgoing_ts: out.timestamp,
                    incoming_ts: matched.timestamp,
                    delta_seconds: Math.max(0, delta),
                    target_id: out.defender_id,
                    target_faction_id: out.defender_faction_id,
                    retaliator_id: matched.attacker_id,
                    retaliator_faction_id: matched.attacker_faction_id,
                    outcome,
                    is_retal: true,
                    created_at: new Date()
                }).catch(e => { if (e.code !== 11000) throw e; });
                resolvedRetals++;
            } else {
                // Outgoing attack with NO matching incoming attack in 0-6h window -> explicit no_retal
                await col('retal_events').insertOne({
                    _id: `noretal_${out._id}`,
                    outgoing_attack_id: out._id,
                    incoming_attack_id: null,
                    outgoing_ts: out.timestamp,
                    incoming_ts: null,
                    delta_seconds: null,
                    target_id: out.defender_id,
                    target_faction_id: out.defender_faction_id,
                    retaliator_id: null,
                    retaliator_faction_id: null,
                    outcome: 'no_retal',
                    is_retal: false,
                    created_at: new Date()
                }).catch(e => { if (e.code !== 11000) throw e; });
                resolvedNoRetals++;
            }
        }

        if (resolvedRetals > 0 || resolvedNoRetals > 0) {
            console.log(`[RetalEngine] Sweep resolved ${resolvedRetals} retals and ${resolvedNoRetals} no-retal data points.`);
            _scoreCache.clear();
        }
    } catch(e) {
        console.warn('[RetalEngine] Sweep error:', e.message);
    }
}

// ── 3. Nightly Rollup Job (Runs at 00:15 UTC) ────────────────────────────────
async function runNightlyRollup() {
    console.log('[RetalEngine] Starting nightly rollup calculation...');
    _scoreCache.clear();

    try {
        // Aggregate per-target player
        const playerPipeline = [
            { $match: { target_id: { $exists: true, $ne: null } } },
            { $group: {
                _id: '$target_id',
                n_hits: { $sum: 1 },
                n_retals: { $sum: { $cond: ['$is_retal', 1, 0] } },
                deltas: { $push: { $cond: ['$is_retal', '$delta_seconds', null] } },
                retaliators: { $push: { $cond: ['$is_retal', '$retaliator_id', null] } },
                outcomes: { $push: '$outcome' },
                timestamps: { $push: '$outgoing_ts' },
                target_faction_id: { $first: '$target_faction_id' },
                newest_hit_ts: { $max: '$outgoing_ts' },
                oldest_hit_ts: { $min: '$outgoing_ts' }
            }}
        ];

        const playerResults = await col('retal_events').aggregate(playerPipeline).toArray();

        for (const row of playerResults) {
            if (!row._id) continue;
            const agg = buildAggDoc('player', row);
            await col('retal_aggregates').updateOne(
                { _id: `player_${row._id}` },
                { $set: agg },
                { upsert: true }
            );
        }

        // Aggregate per enemy faction
        const facPipeline = [
            { $match: { target_faction_id: { $exists: true, $ne: null, $ne: 0 } } },
            { $group: {
                _id: '$target_faction_id',
                n_hits: { $sum: 1 },
                n_retals: { $sum: { $cond: ['$is_retal', 1, 0] } },
                deltas: { $push: { $cond: ['$is_retal', '$delta_seconds', null] } },
                retaliators: { $push: { $cond: ['$is_retal', '$retaliator_id', null] } },
                outcomes: { $push: '$outcome' },
                timestamps: { $push: '$outgoing_ts' },
                newest_hit_ts: { $max: '$outgoing_ts' },
                oldest_hit_ts: { $min: '$outgoing_ts' }
            }}
        ];

        const facResults = await col('retal_events').aggregate(facPipeline).toArray();

        for (const row of facResults) {
            if (!row._id) continue;
            const agg = buildAggDoc('faction', row);
            await col('retal_aggregates').updateOne(
                { _id: `faction_${row._id}` },
                { $set: agg },
                { upsert: true }
            );
        }

        console.log(`[RetalEngine] Nightly rollup complete: ${playerResults.length} players, ${facResults.length} enemy factions updated.`);
    } catch(e) {
        console.error('[RetalEngine] Rollup error:', e.message);
    }
}

function buildAggDoc(type, row) {
    const validDeltas = (row.deltas || []).filter(d => d !== null && d >= 0);
    const retaliatorCounts = {};

    for (const rid of (row.retaliators || [])) {
        if (!rid) continue;
        retaliatorCounts[rid] = (retaliatorCounts[rid] || 0) + 1;
    }

    const retaliator_pool = Object.entries(retaliatorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count]) => ({ id: Number(id), count }));

    const outcomes = row.outcomes || [];
    const hospRetals = outcomes.filter(o => o === 'hosp').length;
    const lossRetals = outcomes.filter(o => o === 'loss').length;
    const wonRetals  = outcomes.filter(o => o === 'win').length;

    // Win/loss ratio when enemy retaliates (from our perspective)
    const win_loss_ratio = (hospRetals + lossRetals) > 0
        ? parseFloat((wonRetals / (hospRetals + lossRetals)).toFixed(2))
        : wonRetals > 0 ? 99.0 : 0.0;

    const avg_response_seconds = validDeltas.length > 0
        ? Math.round(validDeltas.reduce((a, b) => a + b, 0) / validDeltas.length)
        : null;

    const sorted = [...validDeltas].sort((a, b) => a - b);
    const median_response_seconds = sorted.length > 0
        ? sorted[Math.floor(sorted.length / 2)]
        : null;

    const retal_rate = row.n_hits > 0 ? parseFloat((row.n_retals / row.n_hits).toFixed(4)) : 0;

    return {
        type,
        entity_id: Number(row._id),
        n_hits: row.n_hits,
        n_retals: row.n_retals,
        retal_rate,
        avg_response_seconds,
        median_response_seconds,
        retaliator_pool,
        win_loss_ratio,
        last_updated: new Date(),
        oldest_hit_ts: row.oldest_hit_ts,
        newest_hit_ts: row.newest_hit_ts
    };
}

// ── 4 & 5. Scoring & Cold-Start Inference ────────────────────────────────────

/**
 * Fetch profile + personalstats for cold-start feature extraction.
 * Cached in-memory to minimize Torn API calls.
 */
async function fetchTargetProfile(targetId) {
    const cached = _profileCache.get(targetId);
    if (cached && (Date.now() - cached.ts) < PROFILE_CACHE_TTL_MS) {
        return cached.data;
    }

    if (typeof _getApiKey !== 'function') return null;
    const apiKey = _getApiKey();
    if (!apiKey) return null;

    try {
        const url = `https://api.torn.com/user/${targetId}?selections=profile,personalstats&key=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        const data = await res.json();
        if (data.error) return null;

        _profileCache.set(targetId, { data, ts: Date.now() });
        return data;
    } catch(e) {
        return null;
    }
}

/**
 * Extract the 5 cold-start features from user profile & personalstats.
 */
function extractColdFeaturesFromProfile(prof, attackerStats = null) {
    if (!prof) return [0.5, 0.4, 0.45, 0.5, 0.0];

    try {
        const pstats = prof.personalstats || {};

        // Feature 1: Lifetime attack activity ratio
        const won = Number(pstats.attackswon || 0);
        const lost = Number(pstats.attackslost || 0);
        const defWon = Number(pstats.defendswon || 0);
        const defLost = Number(pstats.defendslost || 0);
        const total = won + lost + defWon + defLost;
        const lifetime_ratio = total > 0
            ? Math.min(1.0, Math.max(0.0, (won + defWon) / (total + 1)))
            : 0.5;

        // Feature 2: Online status & recency
        const lastAct = prof.last_action || {};
        let online_val = 0.0;
        if (lastAct.status === 'Online') {
            online_val = 1.0;
        } else if (lastAct.status === 'Idle') {
            online_val = 0.6;
        } else {
            const diffSecs = nowSecs() - (lastAct.timestamp || nowSecs());
            online_val = Math.max(0.0, 1.0 - (diffSecs / 86400));
        }

        // Feature 3: Level & Account Age
        const lvl = Number(prof.level || 1);
        const age = Number(prof.age || 1);
        const level_age = Math.min(1.0, (Math.min(1, lvl / 100) * 0.5) + (Math.min(1, age / 2000) * 0.5));

        // Feature 4: Battle stats ratio vs attacker
        const targetBS = estimateStatsFromLevel(lvl);
        const myBS = attackerStats && attackerStats > 0 ? attackerStats : 2_000_000;
        const rawRatio = targetBS / myBS;
        const bs_ratio = Math.min(1.0, Math.max(0.0, rawRatio / (1 + rawRatio)));

        // Feature 5: Faction active war status
        const facId = prof.faction?.faction_id;
        const faction_at_war = (_isWarMode && facId) || (prof.status?.state === 'War') ? 1.0 : 0.0;

        return [lifetime_ratio, online_val, level_age, bs_ratio, faction_at_war];
    } catch(e) {
        return [0.5, 0.4, 0.45, 0.5, 0.0];
    }
}

function inferColdStart(features) {
    const weights = _modelWeights || DEFAULT_WEIGHTS;
    const scaling = _modelScaling || DEFAULT_SCALING;

    try {
        let z = weights[0]; // bias
        for (let f = 0; f < COLD_FEATURES; f++) {
            const mean = scaling.means[f] ?? 0.5;
            const std  = scaling.stds[f] || 1.0;
            const xNorm = (features[f] - mean) / std;
            z += weights[f + 1] * xNorm;
        }
        return Math.min(0.95, Math.max(0.05, sigmoid(z)));
    } catch(e) {
        return GLOBAL_MEAN_RATE;
    }
}

/**
 * Retrain logistic regression model using historical attack_log and retal_events.
 */
async function retrainModel() {
    console.log('[RetalEngine] Starting weekly logistic model retrain...');
    try {
        const events = await col('retal_events')
            .find({ is_retal: { $ne: null } })
            .limit(2000)
            .toArray();

        if (events.length < 20) {
            console.log('[RetalEngine] Insufficient labeled samples (<20). Retaining baseline weights.');
            return;
        }

        const trainingData = [];

        for (const ev of events) {
            const atk = await col('attack_log').findOne({ _id: ev.outgoing_attack_id });
            if (!atk) continue;

            const modifiers = atk.modifiers || {};
            const ff = Number(modifiers.fair_fight || modifiers.fairFight || 1.0);
            const approxRatio = Math.min(2.0, Math.max(0, (ff - 1) * 3 / 8));
            const bsNorm = approxRatio / (1 + approxRatio);

            const isWar = Number(modifiers.war || 0) > 0 ? 1.0 : 0.0;
            const features = [0.5, 0.5, 0.5, bsNorm, isWar];

            trainingData.push({
                features,
                label: ev.is_retal ? 1.0 : 0.0
            });
        }

        if (trainingData.length < 20) return;

        // Calculate means and stds
        const means = new Array(COLD_FEATURES).fill(0);
        const stds  = new Array(COLD_FEATURES).fill(1);

        for (let f = 0; f < COLD_FEATURES; f++) {
            const vals = trainingData.map(d => d.features[f]);
            means[f] = vals.reduce((a, b) => a + b, 0) / vals.length;
            const variance = vals.reduce((a, b) => a + (b - means[f]) ** 2, 0) / vals.length;
            stds[f] = Math.sqrt(variance) || 1.0;
        }

        const weights = [...DEFAULT_WEIGHTS];

        for (let epoch = 0; epoch < LR_EPOCHS; epoch++) {
            const grads = new Array(COLD_FEATURES + 1).fill(0);

            for (const sample of trainingData) {
                let z = weights[0];
                for (let f = 0; f < COLD_FEATURES; f++) {
                    const xNorm = (sample.features[f] - means[f]) / stds[f];
                    z += weights[f + 1] * xNorm;
                }
                const pred = sigmoid(z);
                const error = pred - sample.label;
                grads[0] += error;
                for (let f = 0; f < COLD_FEATURES; f++) {
                    grads[f + 1] += error * ((sample.features[f] - means[f]) / stds[f]);
                }
            }

            const n = trainingData.length;
            for (let i = 0; i < weights.length; i++) {
                weights[i] -= (LR / n) * grads[i];
            }
        }

        _modelWeights = weights;
        _modelScaling = { means, stds };

        await col('retal_aggregates').updateOne(
            { _id: 'model_weights' },
            { $set: { _id: 'model_weights', weights, scaling: { means, stds }, trained_at: new Date(), sample_count: trainingData.length } },
            { upsert: true }
        );

        console.log(`[RetalEngine] Retrained logistic model successfully on ${trainingData.length} combat samples.`);
    } catch(e) {
        console.error('[RetalEngine] Model retrain error:', e.message);
    }
}

// ── Core Risk Scorer ─────────────────────────────────────────────────────────
async function computeRiskScore(targetId, targetFactionId, attackerStats = null) {
    const cached = _scoreCache.get(targetId);
    if (cached && (Date.now() - cached.ts) < PERF_CACHE_TTL_MS) return cached.score;

    try {
        const [playerAgg, factionAgg] = await Promise.all([
            col('retal_aggregates').findOne({ _id: `player_${targetId}` }),
            targetFactionId ? col('retal_aggregates').findOne({ _id: `faction_${targetFactionId}` }) : null
        ]);

        const factionRate = factionAgg?.retal_rate ?? GLOBAL_MEAN_RATE;
        const factionN    = factionAgg?.n_hits ?? 0;

        let adjustedRate, tier, confidence_label, n_hits;

        if (playerAgg && playerAgg.n_hits >= 1) {
            n_hits = playerAgg.n_hits;
            const rawRate = playerAgg.retal_rate;

            // Empirical Bayes shrinkage: (n_target * rate_target + k * faction_rate) / (n_target + k)
            const prior = factionN >= 3 ? factionRate : GLOBAL_MEAN_RATE;
            adjustedRate = (n_hits * rawRate + K_SHRINKAGE * prior) / (n_hits + K_SHRINKAGE);

            // Exponential recency decay over raw historical events
            const events = await col('retal_events')
                .find({ target_id: targetId })
                .sort({ outgoing_ts: -1 })
                .limit(50)
                .toArray();

            if (events.length >= 2) {
                const now = Date.now();
                let weightedSum = 0, weightTotal = 0;
                for (const ev of events) {
                    const ageMs = now - (ev.outgoing_ts * 1000);
                    const w = decayWeight(ageMs);
                    weightedSum += w * (ev.is_retal ? 1 : 0);
                    weightTotal += w;
                }
                const decayedRate = weightTotal > 0 ? (weightedSum / weightTotal) : adjustedRate;
                adjustedRate = (0.75 * decayedRate) + (0.25 * adjustedRate);
            }

            if (n_hits >= 12) {
                tier = 'direct';
                confidence_label = `🟢 ${n_hits} direct observations`;
            } else if (n_hits >= 3) {
                tier = 'faction_shrunk';
                confidence_label = `🟡 Faction prior applied (${n_hits} direct hits, shrinkage k=${K_SHRINKAGE})`;
            } else {
                tier = 'faction_only';
                confidence_label = `🟠 Faction prior (${n_hits} direct hit, limited sample)`;
            }

        } else if (factionAgg && factionN >= 3) {
            // Faction-only data
            n_hits = 0;
            adjustedRate = factionRate;
            tier = 'faction_only';
            confidence_label = `🟠 Enemy faction aggregate (${factionN} hits, no personal history)`;
        } else {
            // Cold start — fetch profile/stats and evaluate logistic regression model
            n_hits = 0;
            const prof = await fetchTargetProfile(targetId);
            const features = extractColdFeaturesFromProfile(prof, attackerStats);
            adjustedRate = inferColdStart(features);
            tier = 'cold_start';
            confidence_label = `⚫ Cold-start model (${prof?.name ? `${prof.name}, ` : ''}Level ${prof?.level || '?'}, ${prof?.last_action?.status || 'Unknown'})`;
        }

        const result = {
            target_id: targetId,
            target_faction_id: targetFactionId,
            adjusted_rate: parseFloat(Math.min(0.99, Math.max(0.01, adjustedRate)).toFixed(4)),
            tier,
            confidence_label,
            n_hits,
            avg_response_seconds: playerAgg?.avg_response_seconds ?? factionAgg?.avg_response_seconds ?? null,
            median_response_seconds: playerAgg?.median_response_seconds ?? factionAgg?.median_response_seconds ?? null,
            retaliator_pool: playerAgg?.retaliator_pool ?? factionAgg?.retaliator_pool ?? [],
            win_loss_ratio: playerAgg?.win_loss_ratio ?? factionAgg?.win_loss_ratio ?? null,
            last_updated: playerAgg?.last_updated ?? factionAgg?.last_updated ?? null
        };

        _scoreCache.set(targetId, { score: result, ts: Date.now() });
        return result;

    } catch(e) {
        console.warn('[RetalEngine] Risk score calculation error:', e.message);
        return _defaultScore(targetId, targetFactionId);
    }
}

function _defaultScore(targetId, targetFactionId) {
    return {
        target_id: targetId,
        target_faction_id: targetFactionId,
        adjusted_rate: GLOBAL_MEAN_RATE,
        tier: 'cold_start',
        confidence_label: '⚫ Cold start — baseline prior',
        n_hits: 0,
        avg_response_seconds: null,
        median_response_seconds: null,
        retaliator_pool: [],
        win_loss_ratio: null,
        last_updated: null
    };
}

// ── Scheduler Loop ───────────────────────────────────────────────────────────
async function schedulerLoop() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMin  = now.getUTCMinutes();
    const doy     = dayOfYear(now);
    const dow     = now.getUTCDay();

    // Nightly rollup at 00:15 UTC
    if (utcHour === ROLLUP_HOUR_UTC && utcMin >= ROLLUP_MINUTE_UTC && _lastRollupDay !== doy) {
        _lastRollupDay = doy;
        await runNightlyRollup();
    }

    // Weekly retrain on Sunday 01:00 UTC
    if (dow === MODEL_RETRAIN_DAY && utcHour === MODEL_RETRAIN_HOUR && _lastRetrainDay !== doy) {
        _lastRetrainDay = doy;
        await retrainModel();
    }

    // Uncorrelated sweep every 15 minutes
    if (Date.now() - _lastSweepTs >= SWEEP_INTERVAL_MS) {
        _lastSweepTs = Date.now();
        await sweepUncorrelatedAttacks();
    }
}

// ── Background Poll Loop ─────────────────────────────────────────────────────
async function pollLoop() {
    while (_running) {
        await ingestAttacks();
        await schedulerLoop();

        const delay = _isWarMode ? WAR_POLL_MS : PEACE_POLL_MS;
        await sleep(delay);
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the Retaliation Risk Engine.
 * @param {Function} getApiKeyFn — () => string|null, dynamically invoked for each request
 * @param {Object} mongoDb — MongoDB Db instance
 * @param {Function} onAttackAlertFn — async (atkPayload) => void, optional alert callback
 */
async function startRetaliationEngine(getApiKeyFn, mongoDb, onAttackAlertFn = null) {
    if (onAttackAlertFn) _onAttackAlertCallback = onAttackAlertFn;
    if (_running) return;
    _getApiKey = getApiKeyFn;
    _db = mongoDb;
    _running = true;

    console.log('[RetalEngine] Starting Retaliation Risk Engine...');
    await ensureIndexes();
    await seedDedupCache();
    await loadModelWeights();

    // Check recent backlog attacks on boot so no attacks miss alerts
    checkPendingRecentAlerts().catch(e => console.warn('[RetalEngine] Backlog check error:', e));

    // Kick off background loop
    pollLoop().catch(e => console.error('[RetalEngine] Fatal poll loop error:', e));
    console.log('[RetalEngine] Engine running in background (30s peace / 15s war interval).');
}

/**
 * Get retal risk score for a single target.
 */
async function getRiskScore(targetId, targetFactionId = null, attackerStats = null) {
    if (!_db) return _defaultScore(targetId, targetFactionId);
    return computeRiskScore(Number(targetId), targetFactionId ? Number(targetFactionId) : null, attackerStats);
}

/**
 * Get retal risk scores for multiple targets in bulk (parallel, cached).
 * @param {Array} targets — [{ id, faction_id }]
 * @returns {Map} targetId => scoreObject
 */
async function getRiskScoreBulk(targets) {
    if (!targets?.length) return new Map();
    if (!_db) {
        const map = new Map();
        for (const t of targets) {
            map.set(Number(t.id), _defaultScore(t.id, t.faction_id));
        }
        return map;
    }
    const results = await Promise.allSettled(
        targets.map(t => computeRiskScore(Number(t.id), t.faction_id ? Number(t.faction_id) : null))
    );
    const map = new Map();
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const r = results[i];
        if (r.status === 'fulfilled') {
            map.set(Number(t.id), r.value);
        } else {
            map.set(Number(t.id), _defaultScore(t.id, t.faction_id));
        }
    }
    return map;
}

/**
 * Fetch top retaliator pool for a target faction.
 */
async function getRetaliatorPool(targetFactionId) {
    if (!_db || !targetFactionId) return [];
    try {
        const doc = await col('retal_aggregates').findOne({
            type: 'faction',
            entity_id: Number(targetFactionId)
        });
        return doc?.retaliator_pool || [];
    } catch(e) {
        return [];
    }
}

/**
 * Build compact inline risk tag for embed rows (e.g. "🛡️ 34% 🟢").
 */
function formatRiskTag(score) {
    if (!score) return '';
    const pct = Math.round((score.adjusted_rate || 0) * 100);
    const tierIcon = score.tier === 'direct' ? '🟢' :
                     score.tier === 'faction_shrunk' ? '🟡' :
                     score.tier === 'faction_only' ? '🟠' : '⚫';
    return `🛡️ **${pct}%** ${tierIcon}`;
}

/**
 * Build rich Discord embed from retal risk score.
 */
function buildRiskEmbed(score, playerName = null) {
    const pct = Math.round((score.adjusted_rate || 0) * 100);
    const bar = buildRateBar(score.adjusted_rate);
    const avgTime = formatDuration(score.avg_response_seconds);
    const medTime = formatDuration(score.median_response_seconds);
    const timeStr = score.avg_response_seconds
        ? `Avg ${avgTime} · Median ${medTime}`
        : 'Unknown (insufficient data)';

    const winLoss = score.win_loss_ratio !== null
        ? `${score.win_loss_ratio}:1 (${score.win_loss_ratio < 0.5 ? 'Favors us' : score.win_loss_ratio > 1.5 ? 'Dangerous' : 'Even'})`
        : 'Insufficient sample';

    const responseWindow = score.avg_response_seconds && score.avg_response_seconds < 600
        ? '⚡ Typically responds within 10 minutes or not at all.'
        : score.avg_response_seconds
            ? `⏳ Average response time ~${avgTime} — delayed retaliator.`
            : '⏱️ Response window pending more observations.';

    let retaliatorBlock = '';
    if (score.retaliator_pool?.length > 0) {
        const lines = score.retaliator_pool.slice(0, 3).map((r, i) => {
            const icon = i === 0 ? '🔴' : i === 1 ? '🟡' : '🟠';
            return `${icon} [Player ${r.id}](https://www.torn.com/profiles.php?XID=${r.id}) — ${r.count} confirmed retaliation${r.count !== 1 ? 's' : ''}`;
        });
        retaliatorBlock = `\n\n**⚠️ Likely Retaliators:**\n${lines.join('\n')}`;
    } else if (score.tier !== 'cold_start') {
        retaliatorBlock = '\n\n*No specific retaliators identified — distributed or passive enemy pool.*';
    }

    const staleness = score.last_updated
        ? `-# Data aggregated <t:${Math.floor(new Date(score.last_updated).getTime() / 1000)}:R>`
        : `-# ${score.tier === 'cold_start' ? 'Inferred via logistic model (personalstats & combat profile)' : 'Faction prior applied'}`;

    const color = pct >= 65 ? 0xe17055 : pct >= 35 ? 0xfdcb6e : 0x00b894;

    return {
        title: `🛡️ Retaliation Risk: ${playerName || `Player ${score.target_id}`} [${score.target_id}]`,
        description: [
            `**Retaliation Probability:** ${pct}%  ${bar}`,
            `**Confidence:** ${score.confidence_label}`,
            `**Response Window:** ${timeStr}`,
            `**Win/Loss Ratio (on Retals):** ${winLoss}`,
            responseWindow,
            retaliatorBlock,
            ``,
            staleness
        ].join('\n'),
        color,
        footer: { text: 'F.R.I.D.A.Y Retaliation Risk Engine · Empirical Bayes k=7 · λ=0.05' },
        timestamp: new Date().toISOString()
    };
}

function buildRateBar(rate) {
    const filled = Math.round((rate || 0) * 10);
    const empty  = 10 - filled;
    return '`' + '▓'.repeat(filled) + '░'.repeat(empty) + '`';
}

function formatDuration(seconds) {
    if (!seconds) return 'N/A';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

module.exports = {
    startRetaliationEngine,
    setOnAttackAlertCallback,
    getRiskScore,
    getRiskScoreBulk,
    getRetaliatorPool,
    buildRiskEmbed,
    formatRiskTag
};
