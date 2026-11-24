/**
 * FactionOS — Crime & Level Analytics Predictive Engines (v1.0)
 *
 * Engine 1: Nonlinear Crime Skill Level Estimator (Crimes 2.0 CS -> CS+1 & Target CS up to 100)
 * Engine 2: Regular In-Game Level Progress Estimator (Logs + Personal Calibration + HoF Bounds)
 * Also provides: torn.report aggregations, 10k merit tracking, realistic demo generator,
 * Discord Markdown summary exporter, CSV/JSON exporters, and F.R.I.D.A.Y. Co-Pilot intel bridge.
 */
(function (global) {
    'use strict';

    const CRIMES_2_ERA_TS = 1686700800; // June 14, 2023 (Crimes 2.0 launch)

    // Canonical Crimes 2.0 Registry (all 13 live Crimes 2.0 disciplines)
    const CRIMES_CATALOG = [
        {
            key: 'search_for_cash',
            name: 'Search for Cash',
            icon: '🪙',
            tier: 1,
            avgNerve: 2,
            color: '#38bdf8',
            meritBucket: 'search_for_cash',
            meritLabel: 'Search for Cash',
            psKeys: ['search_for_cash', 'vandalism'],
            uniquesTotal: 12,
            keywords: ['search for cash', 'searching the trash', 'searching the subway', 'searching the beach', 'searching the bridge', 'searching the cemetery', 'searching the fountain', 'searching the junkyard', 'searching the park', 'searching the dumpster']
        },
        {
            key: 'bootlegging',
            name: 'Bootlegging',
            icon: '💿',
            tier: 1,
            avgNerve: 2,
            color: '#60a5fa',
            meritBucket: 'bootlegging',
            meritLabel: 'Bootlegging',
            psKeys: ['bootlegging', 'counterfeiting'],
            uniquesTotal: 11,
            keywords: ['bootlegging', 'copying', 'selling dvds', 'online store', 'blank dvd', 'burning', 'pirat', 'dvd']
        },
        {
            key: 'graffiti',
            name: 'Graffiti',
            icon: '🎨',
            tier: 1,
            avgNerve: 3,
            color: '#f472b6',
            meritBucket: 'graffiti',
            meritLabel: 'Graffiti',
            psKeys: ['graffiti', 'vandalism'],
            uniquesTotal: 10,
            keywords: ['graffiti', 'spray', 'tagging', 'stencil', 'mural', 'east side', 'west side', 'red light', 'downtown', 'financial district']
        },
        {
            key: 'shoplifting',
            name: 'Shoplifting',
            icon: '🛍️',
            tier: 2,
            avgNerve: 4,
            color: '#fb923c',
            meritBucket: 'shoplifting',
            meritLabel: 'Shoplifting',
            psKeys: ['shoplifting', 'theft'],
            uniquesTotal: 14,
            keywords: ['shoplift', 'sally', 'sweet shop', 'bits \'n\' bobs', 'cyber force', 'big al', 'jewelry store', 'pharmacy', 'clothing store', 'super store']
        },
        {
            key: 'pickpocketing',
            name: 'Pickpocketing',
            icon: '🧤',
            tier: 2,
            avgNerve: 5,
            color: '#facc15',
            meritBucket: 'pickpocketing',
            meritLabel: 'Pickpocketing',
            psKeys: ['pickpocketing', 'theft'],
            uniquesTotal: 14,
            keywords: ['pickpocket', 'drunk man', 'homeless', 'junkie', 'elderly', 'classy lady', 'laborer', 'postal worker', 'cyclist', 'rich kid', 'businessman', 'mobster', 'police officer']
        },
        {
            key: 'card_skimming',
            name: 'Card Skimming',
            icon: '💳',
            tier: 2,
            avgNerve: 4,
            color: '#2dd4bf',
            meritBucket: 'card_skimming',
            meritLabel: 'Card Skimming',
            psKeys: ['card_skimming', 'fraud'],
            uniquesTotal: 10,
            keywords: ['card skimm', 'skimmer', 'bus station', 'gas station', 'atm', 'subway', 'installing a skimmer', 'retrieving a skimmer', 'selling card details']
        },
        {
            key: 'burglary',
            name: 'Burglary',
            icon: '🏚️',
            tier: 3,
            avgNerve: 6,
            color: '#a78bfa',
            meritBucket: 'burglary',
            meritLabel: 'Burglary',
            psKeys: ['burglary', 'theft'],
            uniquesTotal: 15,
            keywords: ['burglar', 'scouting', 'casing', 'tool shed', 'beach hut', 'cottage', 'apartment', 'suburban', 'farmhouse', 'warehouse', 'self storage', 'office', 'printing works', 'shipyard']
        },
        {
            key: 'hustling',
            name: 'Hustling',
            icon: '🎲',
            tier: 2,
            avgNerve: 2,
            color: '#34d399',
            meritBucket: 'hustling',
            meritLabel: 'Hustling',
            psKeys: ['hustling', 'fraud'],
            uniquesTotal: 12,
            keywords: ['hustl', 'shell game', 'pick a cup', 'cornhole', 'three-card', 'monte', 'dice', 'gathering audience', 'demoing']
        },
        {
            key: 'disposal',
            name: 'Disposal',
            icon: '☣️',
            tier: 3,
            avgNerve: 8,
            color: '#f87171',
            meritBucket: 'disposal',
            meritLabel: 'Disposal',
            psKeys: ['disposal', 'illicitservices'],
            uniquesTotal: 12,
            keywords: ['dispos', 'biological waste', 'body part', 'dead body', 'building debris', 'general waste', 'industrial waste', 'murder weapon', 'old furniture', 'vehicle', 'firearm', 'burying', 'burning', 'dissolving', 'sinking', 'abandoning']
        },
        {
            key: 'cracking',
            name: 'Cracking',
            icon: '💻',
            tier: 3,
            avgNerve: 5,
            color: '#06b6d4',
            meritBucket: 'cracking',
            meritLabel: 'Cracking',
            psKeys: ['cracking', 'cybercrime'],
            uniquesTotal: 12,
            keywords: ['crack', 'brute forc', 'rig', 'password', 'decrypt', 'server', 'cipher', 'wordlist', 'hash']
        },
        {
            key: 'forgery',
            name: 'Forgery',
            icon: '🪪',
            tier: 4,
            avgNerve: 5,
            color: '#c084fc',
            meritBucket: 'forgery',
            meritLabel: 'Forgery',
            psKeys: ['forgery', 'counterfeiting'],
            uniquesTotal: 12,
            keywords: ['forger', 'forging', 'parking permit', 'side door', 'id badge', 'bank check', 'prescription', 'driver', 'passport', 'police badge', 'birth certificate', 'diploma']
        },
        {
            key: 'scamming',
            name: 'Scamming',
            icon: '📧',
            tier: 4,
            avgNerve: 4,
            color: '#fb7185',
            meritBucket: 'scamming',
            meritLabel: 'Scamming',
            psKeys: ['scamming', 'fraud'],
            uniquesTotal: 12,
            keywords: ['scam', 'phishing', 'spam', 'email', 'farm', 'mark', 'romance', 'lottery', 'delivery', 'tech support', 'investment', 'charity']
        },
        {
            key: 'arson',
            name: 'Arson',
            icon: '🔥',
            tier: 4,
            avgNerve: 6,
            color: '#f97316',
            meritBucket: 'arson',
            meritLabel: 'Arson',
            psKeys: ['arson', 'vandalism'],
            uniquesTotal: 12,
            keywords: ['arson', 'accelerant', 'ignite', 'torch', 'molotov', 'firebomb', 'burn down', 'flammab', 'warehouse fire']
        }
    ];

    const CRIME_BY_KEY = new Map(CRIMES_CATALOG.map(c => [c.key, c]));

    // 10k Crime Category Merit Buckets (Crimes 2.0 + Classic Merit Structure)
    const MERIT_CATEGORIES = [
        { key: 'theft', label: 'Theft', target: 10000, psKey: 'theft', crimeKeys: ['shoplifting', 'pickpocketing', 'burglary'] },
        { key: 'counterfeiting', label: 'Counterfeiting', target: 10000, psKey: 'counterfeiting', crimeKeys: ['bootlegging', 'forgery'] },
        { key: 'fraud', label: 'Fraud', target: 10000, psKey: 'fraud', crimeKeys: ['card_skimming', 'hustling', 'scamming'] },
        { key: 'vandalism', label: 'Vandalism', target: 10000, psKey: 'vandalism', crimeKeys: ['search_for_cash', 'graffiti', 'arson'] },
        { key: 'illicitservices', label: 'Illicit Services', target: 10000, psKey: 'illicitservices', crimeKeys: ['disposal'] },
        { key: 'cybercrime', label: 'Cybercrime', target: 10000, psKey: 'cybercrime', crimeKeys: ['cracking'] }
    ];

    // ── Nonlinear Crime Skill Curve Model ────────────────────────────────────
    // Empirical Torn Crimes 2.0 difficulty multiplier per skill level (1 -> 100).
    // Low levels fly by quickly; CS 75 -> 100 scales steeply (often 4x-8x attempts/level vs CS 15).
    function crimeCurveFactor(cs) {
        const s = Math.max(1, Math.min(99.9, Number(cs) || 1));
        const linear = 1 + 0.022 * s;
        const lateBoost = s > 50 ? 0.00055 * Math.pow(s - 50, 2.2) : 0;
        const endgameBoost = s > 75 ? 0.0018 * Math.pow(s - 75, 2.1) : 0;
        return linear + lateBoost + endgameBoost;
    }

    // Baseline attempts per level at CS=1 (before crimeCurveFactor) if user has zero logged transitions
    function defaultBaseAttemptsPerLevel(crimeMeta) {
        const tierMult = { 1: 4.2, 2: 5.0, 3: 5.8, 4: 6.6 };
        return tierMult[crimeMeta?.tier || 2] || 5.0;
    }

    function detectCrimeKeyFromLog(log) {
        const d = log.data || {};
        const explicitRaw = String(d.crime || d.crime_type || d.crime_slug || '').toLowerCase().replace(/[\s-]+/g, '_');
        if (explicitRaw && CRIME_BY_KEY.has(explicitRaw)) return explicitRaw;

        const haystack = [
            d.crime,
            d.crime_name,
            d.crime_action,
            d.action,
            d.subcrime,
            log.title
        ].filter(Boolean).join(' ').toLowerCase();

        if (!haystack) return null;
        for (const c of CRIMES_CATALOG) {
            if (haystack.includes(c.name.toLowerCase()) || haystack.includes(c.key)) return c.key;
        }
        for (const c of CRIMES_CATALOG) {
            for (const kw of c.keywords) {
                if (haystack.includes(kw)) return c.key;
            }
        }
        return null;
    }

    function detectCrimeOutcome(log) {
        const title = String(log.title || '').toLowerCase();
        const color = String(log.params?.color || '').toLowerCase();
        const logId = Number(log.log || 0);
        const d = log.data || {};

        if (title.includes('critical fail') || d.outcome_type === 'critical_failure' || color === 'red' || logId === 9005 || logId === 9055) {
            return 'critical_failure';
        }
        if (title.includes('fail') || d.outcome_type === 'failure' || color === 'orange' || color === 'yellow' || logId === 9015) {
            return 'failure';
        }
        if (title.includes('success') || title.includes('gain') || d.outcome_type === 'success' || color === 'green' || logId === 9010 || logId === 9020) {
            return 'success';
        }
        return 'success';
    }

    function computeItemsValue(itemsObj, itemPricesMap) {
        if (!itemsObj || typeof itemsObj !== 'object') return 0;
        let total = 0;
        if (Array.isArray(itemsObj)) {
            for (const entry of itemsObj) {
                const id = String(entry?.id || entry?.item_id || '');
                const qty = Number(entry?.qty || entry?.quantity || 1);
                const px = Number(entry?.market_value || (itemPricesMap && itemPricesMap[id]) || 0);
                total += qty * px;
            }
        } else {
            for (const [id, qty] of Object.entries(itemsObj)) {
                const q = Number(qty || 0);
                const px = Number((itemPricesMap && itemPricesMap[String(id)]) || 0);
                total += q * px;
            }
        }
        return total;
    }

    // ── Project Attempts & Nerve from currentCS to targetCS ──────────────────
    function projectCrimeSkillRange(crimeStat, targetLevel, dailyNerveAvg) {
        const curCS = Math.max(0, Math.min(100, Number(crimeStat.currentSkill || 0)));
        const tgt = Math.max(Math.min(100, Math.ceil(curCS + 0.001)), Math.min(100, Math.round(Number(targetLevel || 100))));

        if (curCS >= 100 || tgt <= curCS) {
            return {
                targetLevel: Math.min(100, tgt),
                attemptsRemaining: 0,
                nerveRemaining: 0,
                hoursRemaining: 0,
                daysRemaining: 0,
                forecastPoints: []
            };
        }

        const baseRate = crimeStat.calibratedBaseRate;
        const avgNerve = crimeStat.avgNervePerAttempt || crimeStat.meta.avgNerve || 4;
        const curFloor = Math.floor(curCS);
        const partialDone = curCS - curFloor;

        let totalAttempts = 0;
        const forecastPoints = [];
        let cumNerve = crimeStat.totalNerve;
        let cumAttempts = crimeStat.attempts;
        forecastPoints.push({ cs: Number(curCS.toFixed(2)), nerve: Math.round(cumNerve), attempts: cumAttempts });

        for (let lvl = curFloor; lvl < tgt; lvl++) {
            const fullLvlAttempts = Math.max(2, baseRate * crimeCurveFactor(lvl + 0.5));
            const frac = (lvl === curFloor) ? Math.max(0.05, 1 - partialDone) : 1;
            const need = fullLvlAttempts * frac;
            totalAttempts += need;
            cumAttempts += need;
            cumNerve += need * avgNerve;
            if ((lvl + 1) === curFloor + 1 || (lvl + 1) === tgt || (lvl + 1) % 5 === 0) {
                forecastPoints.push({
                    cs: lvl + 1,
                    nerve: Math.round(cumNerve),
                    attempts: Math.round(cumAttempts)
                });
            }
        }

        const attemptsRemaining = Math.ceil(totalAttempts);
        const nerveRemaining = Math.ceil(attemptsRemaining * avgNerve);
        const effDailyNerve = Math.max(24, Number(dailyNerveAvg || 120));
        const daysRemaining = nerveRemaining / effDailyNerve;
        const hoursRemaining = daysRemaining * 24;

        return {
            targetLevel: tgt,
            attemptsRemaining,
            nerveRemaining,
            daysRemaining,
            hoursRemaining,
            forecastPoints
        };
    }

    // ── Torn Regular Level XP Threshold Curve ────────────────────────────────
    // Estimated equivalent "similar-level Leave attacks" required to advance from Level L -> L+1
    function baselineLevelThresholdXP(level) {
        const L = Math.max(1, Math.min(100, Number(level) || 1));
        if (L >= 100) return 0;
        return Math.round(12 + 3.6 * L + 0.145 * Math.pow(L, 2.05));
    }

    function detectAttackOutcomeFromLog(log) {
        const t = String(log.title || '').toLowerCase();
        const r = String(log.data?.result || log.data?.outcome || '').toLowerCase();
        const combined = `${t} ${r}`;
        if (combined.includes('lost') || combined.includes('stalemate') || combined.includes('escape') || combined.includes('defend') || combined.includes('assist')) {
            if (combined.includes('assist')) return 'assist';
            return 'non_win';
        }
        if (combined.includes('mug')) return 'mug';
        if (combined.includes('hosp')) return 'hospitalize';
        if (combined.includes('leave') || combined.includes('left') || combined.includes('attacked') || combined.includes('won')) return 'leave';
        return 'leave';
    }

    // ── Master Computation Pipeline ──────────────────────────────────────────
    function computeAnalytics({ logs = [], snapshot = null, itemPrices = {}, timeframe = 'all', customFromTs = null, customToTs = null, crimeFilter = 'all', manualLevelUpTs = null }) {
        const nowSec = Math.floor(Date.now() / 1000);
        let minFilterTs = 0;
        let maxFilterTs = nowSec + 86400;

        if (timeframe === 'c2') minFilterTs = CRIMES_2_ERA_TS;
        else if (timeframe === '90d') minFilterTs = nowSec - 90 * 86400;
        else if (timeframe === '30d') minFilterTs = nowSec - 30 * 86400;
        else if (timeframe === '7d') minFilterTs = nowSec - 7 * 86400;
        else if (timeframe === 'custom') {
            if (customFromTs) minFilterTs = Number(customFromTs);
            if (customToTs) maxFilterTs = Number(customToTs) + 86399;
        }

        const allSorted = [...logs].sort((a, b) => a.timestamp - b.timestamp);
        const filteredLogs = allSorted.filter(l => l.timestamp >= minFilterTs && l.timestamp <= maxFilterTs);
        const liveSkills = snapshot?.skills || {};

        // Initialize per-crime buckets
        const crimeMap = new Map();
        for (const meta of CRIMES_CATALOG) {
            const liveCS = Number(liveSkills[meta.key] ?? 0);
            crimeMap.set(meta.key, {
                key: meta.key,
                meta,
                currentSkill: liveCS,
                attempts: 0,
                successes: 0,
                failures: 0,
                critFails: 0,
                totalNerve: 0,
                cashGained: 0,
                cashLost: 0,
                itemsGainedVal: 0,
                itemsUsedVal: 0,
                netProfit: 0,
                uniquesFound: new Set(),
                transitions: [], // { fromLvl, toLvl, attempts, nerve, critFailsInSpan, timestamp }
                historyPoints: [], // { cs, nerve, attempts, ts }
                critFailPoints: [], // { cs, nerve, attempts, ts }
                critSkillLost: 0,
                critRecoveryExtraAttempts: 0,
                _lastLoggedCS: null,
                _lastIntLvl: null,
                _attemptsSinceLvl: 0,
                _nerveSinceLvl: 0,
                _critsSinceLvl: 0
            });
        }

        // Global KPI & Daily Timeline accumulators
        let totalAttempts = 0;
        let totalSuccesses = 0;
        let totalFailures = 0;
        let totalCritFails = 0;
        let totalNerve = 0;
        let totalNetProfit = 0;
        let currentStreak = 0;
        let longestStreak = 0;
        let crimeChain = 0;
        let maxCrimeChain = 0;

        const dailyMap = new Map(); // YYYY-MM-DD -> { date, nerve, attempts, successes, failures, critFails, profit }
        const recent14dStart = nowSec - 14 * 86400;
        const recent30dStart = nowSec - 30 * 86400;
        let nerveLast14d = 0;
        let nerveLast30d = 0;
        const activeDays14d = new Set();
        const activeDays30d = new Set();

        for (const log of filteredLogs) {
            if (log.kind !== 'crime') continue;
            const cKey = detectCrimeKeyFromLog(log);
            if (!cKey || !crimeMap.has(cKey)) continue;
            if (crimeFilter !== 'all' && crimeFilter !== cKey) continue;

            const st = crimeMap.get(cKey);
            const d = log.data || {};
            const outcome = detectCrimeOutcome(log);
            const nerve = Number(d.nerve ?? st.meta.avgNerve ?? 3);

            st.attempts++;
            st.totalNerve += nerve;
            st._attemptsSinceLvl++;
            st._nerveSinceLvl += nerve;

            totalAttempts++;
            totalNerve += nerve;

            if (outcome === 'success') {
                st.successes++;
                totalSuccesses++;
                currentStreak++;
                if (currentStreak > longestStreak) longestStreak = currentStreak;
                crimeChain++;
                if (crimeChain > maxCrimeChain) maxCrimeChain = crimeChain;
            } else if (outcome === 'failure') {
                st.failures++;
                totalFailures++;
                currentStreak = 0;
                crimeChain = Math.floor(crimeChain / 2);
            } else {
                st.critFails++;
                totalCritFails++;
                st._critsSinceLvl++;
                currentStreak = 0;
                crimeChain = 0;
            }

            // Cash & Items Valuation
            const mGain = Number(d.money_gained || d.cash_gained || 0);
            const mLoss = Number(d.money_lost || d.cash_lost || 0);
            const iGain = Number(d.items_gained_value ?? computeItemsValue(d.items_gained || d.items_added, itemPrices));
            const iUsed = Number(d.items_used_value ?? computeItemsValue(d.items_used || d.items_lost, itemPrices));
            const net = (mGain + iGain) - (mLoss + iUsed);

            st.cashGained += mGain;
            st.cashLost += mLoss;
            st.itemsGainedVal += iGain;
            st.itemsUsedVal += iUsed;
            st.netProfit += net;
            totalNetProfit += net;

            // Unique Outcome Tracking
            if (d.unique) {
                const uLabel = typeof d.unique === 'string' && d.unique.length > 2 && d.unique !== '(unique)'
                    ? d.unique
                    : `${st.meta.name}: ${d.crime_action || log.title || 'Unique Outcome'}`;
                st.uniquesFound.add(uLabel);
            }

            // Daily Timeline Tracking
            const dayStr = new Date(log.timestamp * 1000).toISOString().slice(0, 10);
            if (!dailyMap.has(dayStr)) {
                dailyMap.set(dayStr, { date: dayStr, nerve: 0, attempts: 0, successes: 0, failures: 0, critFails: 0, profit: 0 });
            }
            const dayRow = dailyMap.get(dayStr);
            dayRow.nerve += nerve;
            dayRow.attempts++;
            if (outcome === 'success') dayRow.successes++;
            else if (outcome === 'failure') dayRow.failures++;
            else dayRow.critFails++;
            dayRow.profit += net;

            if (log.timestamp >= recent14dStart) {
                nerveLast14d += nerve;
                activeDays14d.add(dayStr);
            }
            if (log.timestamp >= recent30dStart) {
                nerveLast30d += nerve;
                activeDays30d.add(dayStr);
            }

            // Skill Level Progression & Critical Failure Tracking
            const loggedCS = d.crime_skill !== undefined && d.crime_skill !== null
                ? Number(d.crime_skill)
                : (d.skill_after !== undefined ? Number(d.skill_after) : null);

            if (loggedCS !== null && !isNaN(loggedCS)) {
                if (st._lastLoggedCS !== null && loggedCS < st._lastLoggedCS - 0.01 && outcome === 'critical_failure') {
                    st.critSkillLost += (st._lastLoggedCS - loggedCS);
                }
                const intLvl = Math.floor(loggedCS);
                if (st._lastIntLvl === null) {
                    st._lastIntLvl = intLvl;
                    st._attemptsSinceLvl = 0;
                    st._nerveSinceLvl = 0;
                    st._critsSinceLvl = 0;
                    st.historyPoints.push({ cs: Number(loggedCS.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: log.timestamp });
                } else if (intLvl > st._lastIntLvl) {
                    const spanLvls = intLvl - st._lastIntLvl;
                    const attPerLvl = st._attemptsSinceLvl / spanLvls;
                    const nervePerLvl = st._nerveSinceLvl / spanLvls;
                    for (let step = 0; step < spanLvls; step++) {
                        st.transitions.push({
                            fromLvl: st._lastIntLvl + step,
                            toLvl: st._lastIntLvl + step + 1,
                            attempts: Math.round(attPerLvl),
                            nerve: Math.round(nervePerLvl),
                            critFailsInSpan: step === 0 ? st._critsSinceLvl : 0,
                            timestamp: log.timestamp
                        });
                    }
                    st._lastIntLvl = intLvl;
                    st._attemptsSinceLvl = 0;
                    st._nerveSinceLvl = 0;
                    st._critsSinceLvl = 0;
                    st.historyPoints.push({ cs: Number(loggedCS.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: log.timestamp });
                } else if (st.attempts % 25 === 0) {
                    st.historyPoints.push({ cs: Number(loggedCS.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: log.timestamp });
                }

                if (outcome === 'critical_failure') {
                    st.critFailPoints.push({ cs: Number(loggedCS.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: log.timestamp });
                }
                st._lastLoggedCS = loggedCS;
                if (loggedCS > st.currentSkill) st.currentSkill = loggedCS;
            } else if (outcome === 'critical_failure') {
                st.critFailPoints.push({ cs: Number(st.currentSkill.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: log.timestamp });
            }
        }

        // Compute average daily nerve spent (rolling 14d / 30d with sane natural regen floor)
        const nnb = Number(snapshot?.bars?.nerve?.maximum || 60);
        const naturalDailyNerve = Math.round(288 * 0.85 + Math.min(100, nnb * 0.8)); // ~280-330/day typical active player
        let dailyNerveAvg = naturalDailyNerve;
        let dailyNerveSource = 'Estimated from NNB';
        if (activeDays14d.size >= 3 && nerveLast14d > 0) {
            dailyNerveAvg = Math.max(24, Math.round(nerveLast14d / Math.min(14, Math.max(activeDays14d.size, 7))));
            dailyNerveSource = `14d rolling avg (${activeDays14d.size} active days)`;
        } else if (activeDays30d.size >= 3 && nerveLast30d > 0) {
            dailyNerveAvg = Math.max(24, Math.round(nerveLast30d / Math.min(30, Math.max(activeDays30d.size, 10))));
            dailyNerveSource = `30d rolling avg (${activeDays30d.size} active days)`;
        } else if (dailyMap.size >= 2 && totalNerve > 0) {
            dailyNerveAvg = Math.max(24, Math.round(totalNerve / dailyMap.size));
            dailyNerveSource = `${dailyMap.size}d synced avg`;
        }

        // Finalize per-crime nonlinear calibration, projections, crit-fail cost & confidence
        const crimesList = [];
        for (const st of crimeMap.values()) {
            const avgNerve = st.attempts > 0 ? (st.totalNerve / st.attempts) : st.meta.avgNerve;
            st.avgNervePerAttempt = avgNerve;
            st.successRate = st.attempts > 0 ? (st.successes / st.attempts) * 100 : 0;
            st.failRate = st.attempts > 0 ? (st.failures / st.attempts) * 100 : 0;
            st.critFailRate = st.attempts > 0 ? (st.critFails / st.attempts) * 100 : 0;
            st.profitPerNerve = st.totalNerve > 0 ? (st.netProfit / st.totalNerve) : 0;

            // Recency-weighted nonlinear calibration over last 3-5 skill transitions
            const recentTrans = st.transitions.slice(-5);
            let calibratedBaseRate = defaultBaseAttemptsPerLevel(st.meta);
            let recentAvgAttemptsPerLvl = Math.round(calibratedBaseRate * crimeCurveFactor(Math.max(1, st.currentSkill)));
            let confidence = 'Low';
            let confidenceMath = '';

            if (recentTrans.length >= 2) {
                const weights = [0.10, 0.15, 0.20, 0.25, 0.30].slice(-recentTrans.length);
                const wSum = weights.reduce((a, b) => a + b, 0);
                let weightedBase = 0;
                let weightedRaw = 0;
                recentTrans.forEach((tr, idx) => {
                    const w = weights[idx] / wSum;
                    const cf = crimeCurveFactor(tr.fromLvl + 0.5);
                    weightedBase += (tr.attempts / cf) * w;
                    weightedRaw += tr.attempts * w;
                });
                calibratedBaseRate = Math.max(1.8, weightedBase);
                recentAvgAttemptsPerLvl = Math.round(weightedRaw);

                if (recentTrans.length >= 5) {
                    confidence = 'High';
                    confidenceMath = `High Confidence: Weighted nonlinear curve calibrated on ${st.transitions.length} logged skill transitions (last 5 levels weighted 10%→30%, avg ${recentAvgAttemptsPerLvl} attempts/lvl).`;
                } else {
                    confidence = 'Medium';
                    confidenceMath = `Medium Confidence: Calibrated on ${recentTrans.length} logged skill transitions (avg ${recentAvgAttemptsPerLvl} attempts/lvl) + Crimes 2.0 nonlinear CS scaling.`;
                }
            } else if (st.attempts >= 60) {
                confidence = 'Medium';
                // Blend default curve slightly using observed crit-fail drag
                calibratedBaseRate = defaultBaseAttemptsPerLevel(st.meta) * (1 + (st.critFailRate / 100) * 1.4);
                recentAvgAttemptsPerLvl = Math.round(calibratedBaseRate * crimeCurveFactor(Math.max(1, st.currentSkill)));
                confidenceMath = `Medium Confidence: ${st.attempts} attempts logged (1 or fewer level transitions in window); using Crimes 2.0 curve adjusted for your ${st.critFailRate.toFixed(1)}% crit-fail rate.`;
            } else {
                confidence = 'Low';
                confidenceMath = `Low Confidence: Fewer than 2 skill-level transitions cached for ${st.meta.name}. Sync Full Access logs to calibrate with your personal attempt rate.`;
            }

            st.calibratedBaseRate = calibratedBaseRate;
            st.recentAvgAttemptsPerLvl = recentAvgAttemptsPerLvl;
            st.confidence = confidence;
            st.confidenceMath = confidenceMath;

            // Crit-Fail Recovery Cost Analysis
            const cleanTrans = st.transitions.filter(t => t.critFailsInSpan === 0);
            const critTrans = st.transitions.filter(t => t.critFailsInSpan > 0);
            if (cleanTrans.length >= 1 && critTrans.length >= 1) {
                const avgClean = cleanTrans.reduce((s, t) => s + t.attempts / crimeCurveFactor(t.fromLvl + 0.5), 0) / cleanTrans.length;
                const avgCrit = critTrans.reduce((s, t) => s + t.attempts / crimeCurveFactor(t.fromLvl + 0.5), 0) / critTrans.length;
                const avgCrits = critTrans.reduce((s, t) => s + t.critFailsInSpan, 0) / critTrans.length;
                const extraBase = Math.max(0.5, (avgCrit - avgClean) / Math.max(1, avgCrits));
                st.critRecoveryExtraAttempts = Math.round(extraBase * crimeCurveFactor(Math.max(1, st.currentSkill)));
            } else {
                // Empirical Torn Crimes 2.0 setback (~35-55% of a level's attempts at current CS)
                st.critRecoveryExtraAttempts = Math.max(3, Math.round(recentAvgAttemptsPerLvl * 0.42));
            }
            if (st.critSkillLost <= 0 && st.critFails > 0) {
                st.critSkillLost = Number((st.critFails * 0.38).toFixed(2));
            }

            // Ensure at least current endpoint exists in historyPoints for charting
            if (!st.historyPoints.length && st.currentSkill > 0) {
                st.historyPoints.push({ cs: Number(st.currentSkill.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: nowSec });
            } else if (st.historyPoints.length && st.currentSkill > st.historyPoints[st.historyPoints.length - 1].cs) {
                st.historyPoints.push({ cs: Number(st.currentSkill.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: nowSec });
            }

            // Compute Next Level (CS + 1) and CS 100 projections
            const nextTarget = Math.min(100, Math.floor(st.currentSkill) + 1);
            st.nextLevelProj = projectCrimeSkillRange(st, nextTarget, dailyNerveAvg);
            st.cs100Proj = projectCrimeSkillRange(st, 100, dailyNerveAvg);
            st.uniquesList = [...st.uniquesFound];

            crimesList.push(st);
        }

        // Build Daily Timeline Array
        const dailyTimeline = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

        // 10k Crime Category Merits
        const ps = snapshot?.personalstats || {};
        const merits = MERIT_CATEGORIES.map(mc => {
            const psVal = Number(ps[mc.psKey] || 0);
            const loggedSuccesses = mc.crimeKeys.reduce((sum, ck) => sum + (crimeMap.get(ck)?.successes || 0), 0);
            const count = Math.max(psVal, loggedSuccesses);
            const pct = Math.min(100, (count / mc.target) * 100);
            return {
                ...mc,
                count,
                pct,
                remaining: Math.max(0, mc.target - count),
                completed: count >= mc.target
            };
        });

        // ── ENGINE 2: Regular In-Game Level Progress Estimator ───────────────
        const levelEstimate = computeRegularLevelEstimate({
            allSortedLogs: allSorted,
            snapshot,
            manualLevelUpTs,
            dailyNerveAvg
        });

        // Smart "Best Next Crime" Recommendations
        const activePool = crimesList.filter(c => c.currentSkill < 100);
        const recommendations = {
            fastest: [...activePool].sort((a, b) => (a.cs100Proj.nerveRemaining || 9e9) - (b.cs100Proj.nerveRemaining || 9e9)).slice(0, 3),
            profit: [...crimesList].filter(c => c.attempts > 0 || c.profitPerNerve > 0).sort((a, b) => b.profitPerNerve - a.profitPerNerve).slice(0, 3),
            safest: [...activePool].filter(c => c.attempts > 0).sort((a, b) => a.critFailRate - b.critFailRate || b.successRate - a.successRate).slice(0, 3)
        };
        if (!recommendations.profit.length) recommendations.profit = crimesList.slice(0, 3);
        if (!recommendations.safest.length) recommendations.safest = activePool.slice(0, 3);

        const result = {
            generatedAt: Date.now(),
            timeframe,
            crimeFilter,
            kpis: {
                totalNerve,
                totalAttempts,
                totalSuccesses,
                totalFailures,
                totalCritFails,
                successRate: totalAttempts > 0 ? (totalSuccesses / totalAttempts) * 100 : 0,
                failRate: totalAttempts > 0 ? (totalFailures / totalAttempts) * 100 : 0,
                critFailRate: totalAttempts > 0 ? (totalCritFails / totalAttempts) * 100 : 0,
                currentStreak,
                longestStreak,
                crimeChain,
                maxCrimeChain,
                totalNetProfit,
                avgProfitPerNerve: totalNerve > 0 ? (totalNetProfit / totalNerve) : 0,
                dailyNerveAvg,
                dailyNerveSource
            },
            crimes: crimesList,
            dailyTimeline,
            merits,
            recommendations,
            levelEstimate
        };

        // Publish compact summary for F.R.I.D.A.Y. Site Co-Pilot across all pages
        publishFridayCrimeIntel(result, snapshot);
        return result;
    }

    function computeRegularLevelEstimate({ allSortedLogs, snapshot, manualLevelUpTs, dailyNerveAvg }) {
        const nowSec = Math.floor(Date.now() / 1000);
        const currentLevel = Number(snapshot?.level || 1);
        const hofLevelRank = Number(snapshot?.hof?.level?.rank || 0);
        const hofLevelVal = Number(snapshot?.hof?.level?.value || currentLevel);
        const totalAttacksWonPS = Number(snapshot?.personalstats?.attackswon || 0);
        const totalCrimesPS = Number(snapshot?.personalstats?.criminaloffenses || 0);

        // Extract Level Up history from logs
        const levelUpLogs = allSortedLogs
            .filter(l => l.kind === 'level_up')
            .map((l, idx) => ({
                timestamp: l.timestamp,
                levelReached: Number(l.data?.level || l.data?.new_level || 0) || null,
                title: l.title || 'Level up',
                idx
            }))
            .sort((a, b) => a.timestamp - b.timestamp);

        // Infer levelReached backwards from currentLevel if Torn log omits explicit level integer
        if (levelUpLogs.length > 0 && currentLevel > 1) {
            for (let i = levelUpLogs.length - 1; i >= 0; i--) {
                if (!levelUpLogs[i].levelReached) {
                    const offsetFromLatest = (levelUpLogs.length - 1) - i;
                    levelUpLogs[i].levelReached = Math.max(2, currentLevel - offsetFromLatest);
                }
            }
        }

        // Build historical intervals between consecutive Level Ups
        const historicalIntervals = [];
        for (let i = 1; i < levelUpLogs.length; i++) {
            const prev = levelUpLogs[i - 1];
            const curr = levelUpLogs[i];
            const intervalMetrics = tallyXPInRange(allSortedLogs, prev.timestamp, curr.timestamp, prev.levelReached || Math.max(1, currentLevel - 1));
            const daysSpent = Math.max(0.1, (curr.timestamp - prev.timestamp) / 86400);
            historicalIntervals.push({
                fromLevel: prev.levelReached || (curr.levelReached ? curr.levelReached - 1 : '?'),
                toLevel: curr.levelReached || '?',
                startTs: prev.timestamp,
                endTs: curr.timestamp,
                daysSpent,
                ...intervalMetrics
            });
        }
        // Also add single earliest level-up date entry if only 1 level-up exists
        const latestLevelUp = levelUpLogs.length ? levelUpLogs[levelUpLogs.length - 1] : null;
        const effectiveStartTs = manualLevelUpTs
            ? Number(manualLevelUpTs)
            : (latestLevelUp ? latestLevelUp.timestamp : (allSortedLogs.length ? allSortedLogs[0].timestamp : nowSec - 30 * 86400));
        const startSource = manualLevelUpTs
            ? 'Manual Level-Up Date'
            : (latestLevelUp ? `Logged Level Up (${new Date(latestLevelUp.timestamp * 1000).toLocaleDateString()})` : 'Earliest Synced Data / HoF Heuristic');

        // Count XP actions since last level-up (logs + supplement with recent snapshot attacks if logs sparse)
        const sinceMetrics = tallyXPInRange(allSortedLogs, effectiveStartTs, nowSec + 60, currentLevel);

        // If user is on Limited Access (no full logs), supplement with snapshot recent attacks!
        if (sinceMetrics.attacksTotal === 0 && snapshot?.attacks && Object.keys(snapshot.attacks).length > 0) {
            const myId = Number(snapshot.userId || 0);
            for (const atk of Object.values(snapshot.attacks)) {
                const ts = Number(atk.timestamp_ended || atk.timestamp_started || 0);
                if (ts < effectiveStartTs) continue;
                if (myId && Number(atk.attacker_id) !== myId) continue;
                const resStr = String(atk.result || '').toLowerCase();
                if (!['attacked', 'mugged', 'hospitalized'].includes(resStr)) continue;
                const defLvl = Number(atk.defender_level || currentLevel);
                const lvlMult = Math.max(0.35, Math.min(2.25, 0.45 + 0.55 * (defLvl / Math.max(1, currentLevel))));
                if (resStr === 'attacked') {
                    sinceMetrics.leaves++;
                    sinceMetrics.xpAttacks += 1.0 * lvlMult;
                } else if (resStr === 'mugged') {
                    sinceMetrics.mugs++;
                    sinceMetrics.xpAttacks += 0.57 * lvlMult;
                } else {
                    sinceMetrics.hosps++;
                    sinceMetrics.xpAttacks += 0.40 * lvlMult;
                }
                sinceMetrics.attacksTotal++;
            }
            sinceMetrics.xpTotal = sinceMetrics.xpAttacks + sinceMetrics.xpCrimes + sinceMetrics.xpGym;
        }

        // Threshold Estimation: Personal interval calibration if available, else Torn scaling curve
        let estimatedThresholdXP = baselineLevelThresholdXP(currentLevel);
        let calibrationMethod = 'Torn Community Level Scaling Curve';

        if (historicalIntervals.length >= 1) {
            const lastInt = historicalIntervals[historicalIntervals.length - 1];
            if (lastInt.xpTotal >= 15) {
                const prevBase = baselineLevelThresholdXP(Math.max(1, currentLevel - 1));
                const currBase = baselineLevelThresholdXP(currentLevel);
                const scaleRatio = prevBase > 0 ? (currBase / prevBase) : 1.06;
                estimatedThresholdXP = Math.round(lastInt.xpTotal * scaleRatio);
                calibrationMethod = `Calibrated from your Lvl ${lastInt.fromLevel}→${lastInt.toLevel} interval (${Math.round(lastInt.xpTotal)} XP equiv)`;
            }
        }

        let rawPct = currentLevel >= 100
            ? 100
            : (estimatedThresholdXP > 0 ? (sinceMetrics.xpTotal / estimatedThresholdXP) * 100 : 0);

        // Secondary HoF / Lifetime Level-Holding Detection
        let isLevelHolding = false;
        let levelHoldingReason = '';
        let hofNote = hofLevelRank > 0 ? `Level HoF Rank #${hofLevelRank.toLocaleString()}` : 'HoF Rank unavailable';

        // Heuristic: cumulative XP for currentLevel vs lifetime attackswon + crimes
        let expectedLifetimeLeaves = 0;
        for (let l = 1; l < currentLevel; l++) expectedLifetimeLeaves += baselineLevelThresholdXP(l) * 0.65;
        const approxLifetimeXP = totalAttacksWonPS * 0.78 + totalCrimesPS * 0.14;

        if (currentLevel < 100 && rawPct >= 105) {
            isLevelHolding = true;
            levelHoldingReason = `Logged XP since last level-up is ~${Math.round(rawPct)}% of Level ${currentLevel + 1} threshold — you likely have an [Upgrade] button waiting or are Level Holding.`;
        } else if (currentLevel < 95 && totalAttacksWonPS > 150 && approxLifetimeXP > expectedLifetimeLeaves * 1.65) {
            isLevelHolding = true;
            levelHoldingReason = `Lifetime activity (${totalAttacksWonPS.toLocaleString()} attacks won, ${totalCrimesPS.toLocaleString()} crimes) significantly exceeds Level ${currentLevel} norms — possible Level Holder.`;
        }

        // If no log data at all (Limited Access cold start), provide bounded HoF/lifetime estimate
        let isLimitedHeuristic = false;
        if (!latestLevelUp && !manualLevelUpTs && sinceMetrics.xpTotal < 3 && totalAttacksWonPS > 0 && currentLevel < 100) {
            isLimitedHeuristic = true;
            const prevCum = expectedLifetimeLeaves;
            const nextStep = baselineLevelThresholdXP(currentLevel) * 0.7;
            const residual = Math.max(0, approxLifetimeXP - prevCum);
            rawPct = Math.min(96, Math.max(8, (residual / Math.max(10, nextStep)) * 100));
            calibrationMethod = 'Limited-Key Lifetime Activity & HoF Heuristic (sync Full Access logs for exact tracking)';
        }

        const progressPct = currentLevel >= 100 ? 100 : Math.max(0, Math.min(100, rawPct));
        const effectiveXP = isLimitedHeuristic
            ? Number((estimatedThresholdXP * (progressPct / 100)).toFixed(1))
            : sinceMetrics.xpTotal;
        const xpRemaining = currentLevel >= 100 ? 0 : Math.max(0, estimatedThresholdXP - effectiveXP);

        // Concrete remaining actions
        const leavesRemaining = Math.ceil(xpRemaining); // 1.0 XP unit = 1 similar-level Leave attack
        const mugsRemaining = Math.ceil(xpRemaining / 0.57);
        const hospsRemaining = Math.ceil(xpRemaining / 0.40);
        const avgCrimeXP = 0.042 * 4.5; // ~0.189 Leave-equiv per mid-tier crime (~4.5N)
        const crimesRemaining = Math.ceil(xpRemaining / avgCrimeXP);

        // Daily XP pace over last 30d (or since last level-up)
        const elapsedDays = Math.max(1, (nowSec - effectiveStartTs) / 86400);
        const observedDailyLeaves = Math.max(0, sinceMetrics.attacksTotal / elapsedDays);
        const defaultDailyLeaves = observedDailyLeaves >= 0.5 ? Number(observedDailyLeaves.toFixed(1)) : 6;
        const dailyXP = defaultDailyLeaves * 0.85 + (dailyNerveAvg * 0.042);
        const estDaysToLevel = dailyXP > 0 && xpRemaining > 0 ? (xpRemaining / dailyXP) : 0;

        return {
            currentLevel,
            nextLevel: Math.min(100, currentLevel + 1),
            progressPct: Number(progressPct.toFixed(1)),
            rawPct: Number(rawPct.toFixed(1)),
            xpAccumulated: Number(effectiveXP.toFixed(1)),
            estimatedThresholdXP,
            xpRemaining: Number(xpRemaining.toFixed(1)),
            leavesRemaining,
            mugsRemaining,
            hospsRemaining,
            crimesRemaining,
            avgCrimeXP,
            estDaysToLevel: Number(estDaysToLevel.toFixed(1)),
            defaultDailyLeaves,
            defaultDailyNerve: dailyNerveAvg,
            effectiveStartTs,
            startSource,
            calibrationMethod,
            isLimitedHeuristic,
            hofLevelRank,
            hofLevelVal,
            hofNote,
            isLevelHolding,
            levelHoldingReason,
            breakdown: {
                xpAttacks: Number(sinceMetrics.xpAttacks.toFixed(1)),
                xpCrimes: Number(sinceMetrics.xpCrimes.toFixed(1)),
                xpGym: Number(sinceMetrics.xpGym.toFixed(1)),
                leaves: sinceMetrics.leaves,
                mugs: sinceMetrics.mugs,
                hosps: sinceMetrics.hosps,
                attacksTotal: sinceMetrics.attacksTotal,
                crimesSuccess: sinceMetrics.crimesSuccess,
                gymTrains: sinceMetrics.gymTrains,
                gymEnergy: sinceMetrics.gymEnergy
            },
            levelUpHistory: levelUpLogs.slice().reverse(),
            historicalIntervals: historicalIntervals.slice().reverse()
        };
    }

    function tallyXPInRange(sortedLogs, startTs, endTs, userLevel) {
        let xpAttacks = 0;
        let xpCrimes = 0;
        let xpGym = 0;
        let leaves = 0;
        let mugs = 0;
        let hosps = 0;
        let attacksTotal = 0;
        let crimesSuccess = 0;
        let gymTrains = 0;
        let gymEnergy = 0;

        for (const l of sortedLogs) {
            if (l.timestamp <= startTs || l.timestamp > endTs) continue;
            if (l.kind === 'attack') {
                const outcome = detectAttackOutcomeFromLog(l);
                if (outcome === 'non_win') continue;
                const defLvl = Number(l.data?.defender_level || l.data?.target_level || userLevel || 50);
                const lvlScale = Math.max(0.35, Math.min(2.25, 0.45 + 0.55 * (defLvl / Math.max(1, userLevel || 50))));
                if (outcome === 'leave') { leaves++; xpAttacks += 1.0 * lvlScale; }
                else if (outcome === 'mug') { mugs++; xpAttacks += 0.57 * lvlScale; }
                else if (outcome === 'hospitalize') { hosps++; xpAttacks += 0.40 * lvlScale; }
                else if (outcome === 'assist') { xpAttacks += 0.25 * lvlScale; }
                attacksTotal++;
            } else if (l.kind === 'crime') {
                const outcome = detectCrimeOutcome(l);
                if (outcome === 'success') {
                    const nerve = Number(l.data?.nerve || 4);
                    crimesSuccess++;
                    xpCrimes += nerve * 0.042;
                }
            } else if (l.kind === 'gym') {
                const energy = Number(l.data?.energy_used || l.data?.energy || 10);
                gymTrains++;
                gymEnergy += energy;
                xpGym += energy * 0.0045;
            }
        }

        return {
            xpAttacks,
            xpCrimes,
            xpGym,
            xpTotal: xpAttacks + xpCrimes + xpGym,
            leaves,
            mugs,
            hosps,
            attacksTotal,
            crimesSuccess,
            gymTrains,
            gymEnergy
        };
    }

    // ── Publish Read-Only Summary for F.R.I.D.A.Y. Site Co-Pilot ─────────────
    function publishFridayCrimeIntel(analytics, snapshot) {
        try {
            const compactCrimes = {};
            for (const c of analytics.crimes) {
                compactCrimes[c.key] = {
                    key: c.key,
                    name: c.meta.name,
                    icon: c.meta.icon,
                    currentSkill: Number(c.currentSkill.toFixed(1)),
                    attempts: c.attempts,
                    successRate: Number(c.successRate.toFixed(1)),
                    critFailRate: Number(c.critFailRate.toFixed(1)),
                    avgNerve: Number(c.avgNervePerAttempt.toFixed(2)),
                    profitPerNerve: Math.round(c.profitPerNerve),
                    netProfit: Math.round(c.netProfit),
                    recentAvgAttemptsPerLvl: c.recentAvgAttemptsPerLvl,
                    calibratedBaseRate: Number(c.calibratedBaseRate.toFixed(3)),
                    confidence: c.confidence,
                    nextAttempts: c.nextLevelProj.attemptsRemaining,
                    nextNerve: c.nextLevelProj.nerveRemaining,
                    nextDays: Number(c.nextLevelProj.daysRemaining.toFixed(1)),
                    cs100Attempts: c.cs100Proj.attemptsRemaining,
                    cs100Nerve: c.cs100Proj.nerveRemaining,
                    cs100Days: Number(c.cs100Proj.daysRemaining.toFixed(1))
                };
            }

            const summary = {
                updatedAt: Date.now(),
                playerName: snapshot?.name || 'Operative',
                isDemo: Boolean(snapshot?.source === 'demo'),
                dailyNerveAvg: analytics.kpis.dailyNerveAvg,
                kpis: {
                    totalNerve: analytics.kpis.totalNerve,
                    totalAttempts: analytics.kpis.totalAttempts,
                    successRate: Number(analytics.kpis.successRate.toFixed(1)),
                    critFailRate: Number(analytics.kpis.critFailRate.toFixed(1)),
                    totalNetProfit: Math.round(analytics.kpis.totalNetProfit),
                    avgProfitPerNerve: Math.round(analytics.kpis.avgProfitPerNerve),
                    crimeChain: analytics.kpis.crimeChain,
                    longestStreak: analytics.kpis.longestStreak
                },
                crimes: compactCrimes,
                topProfitCrime: analytics.recommendations.profit[0]?.key || null,
                fastestTo100Crime: analytics.recommendations.fastest[0]?.key || null,
                safestCrime: analytics.recommendations.safest[0]?.key || null,
                levelEstimate: {
                    currentLevel: analytics.levelEstimate.currentLevel,
                    nextLevel: analytics.levelEstimate.nextLevel,
                    progressPct: analytics.levelEstimate.progressPct,
                    leavesRemaining: analytics.levelEstimate.leavesRemaining,
                    crimesRemaining: analytics.levelEstimate.crimesRemaining,
                    estDaysToLevel: analytics.levelEstimate.estDaysToLevel,
                    isLevelHolding: analytics.levelEstimate.isLevelHolding,
                    hofLevelRank: analytics.levelEstimate.hofLevelRank
                }
            };

            global.FactionOSCrimeIntel = summary;
            global.FactionOSCrimeIntelProject = (crimeKey, targetSkill) => {
                const c = compactCrimes[crimeKey];
                if (!c) return null;
                return projectCrimeSkillRange(
                    {
                        currentSkill: c.currentSkill,
                        calibratedBaseRate: c.calibratedBaseRate,
                        avgNervePerAttempt: c.avgNerve,
                        totalNerve: 0,
                        attempts: c.attempts,
                        meta: CRIME_BY_KEY.get(crimeKey) || { avgNerve: c.avgNerve }
                    },
                    targetSkill,
                    summary.dailyNerveAvg
                );
            };
            localStorage.setItem('factionos_crime_intel_summary_v1', JSON.stringify(summary));
        } catch (_) {}
    }

    // ── Realistic Preview Demo Dataset Generator ─────────────────────────────
    function generateDemoDataset() {
        const nowSec = Math.floor(Date.now() / 1000);
        const demoSpecs = [
            { key: 'search_for_cash', startCS: 94.0, endCS: 100.0, attempts: 145, cfRate: 0.008, failRate: 0.04, avgProfit: 2250, uniques: ['Subway Lucky Coin', 'Beach Metal Detector'] },
            { key: 'bootlegging',     startCS: 82.0, endCS: 91.4,  attempts: 210, cfRate: 0.012, failRate: 0.06, avgProfit: 4100, uniques: ['Viral Bootleg Batch', 'Rare Film Master'] },
            { key: 'graffiti',        startCS: 68.0, endCS: 76.2,  attempts: 135, cfRate: 0.015, failRate: 0.08, avgProfit: 3400, uniques: ['Downtown Masterpiece'] },
            { key: 'shoplifting',     startCS: 54.0, endCS: 65.5,  attempts: 165, cfRate: 0.022, failRate: 0.09, avgProfit: 11200, uniques: ['Big Al Display Jacket', 'Sweet Shop Vault'] },
            { key: 'pickpocketing',   startCS: 49.0, endCS: 62.8,  attempts: 195, cfRate: 0.026, failRate: 0.11, avgProfit: 18500, uniques: ['Businessman Rolex', 'Cyclist Stash'] },
            { key: 'card_skimming',   startCS: 61.0, endCS: 72.1,  attempts: 150, cfRate: 0.014, failRate: 0.07, avgProfit: 16800, uniques: ['Bus Station Jackpot'] },
            { key: 'burglary',        startCS: 64.0, endCS: 74.6,  attempts: 225, cfRate: 0.024, failRate: 0.10, avgProfit: 42500, uniques: ['Farmhouse Safe', 'Shipyard Crate', 'Printing Works Stash'] },
            { key: 'hustling',        startCS: 38.0, endCS: 49.5,  attempts: 115, cfRate: 0.018, failRate: 0.12, avgProfit: 5600, uniques: ['High-Roller Shell Win'] },
            { key: 'disposal',        startCS: 52.0, endCS: 63.2,  attempts: 130, cfRate: 0.021, failRate: 0.08, avgProfit: 54000, uniques: ['Abandoned Vehicle Bounty', 'Bio-Waste Payoff'] },
            { key: 'cracking',        startCS: 55.0, endCS: 67.4,  attempts: 190, cfRate: 0.016, failRate: 0.07, avgProfit: 47200, uniques: ['Encrypted Offshore Wallet', 'Bank Brute-Force'] },
            { key: 'forgery',         startCS: 31.0, endCS: 44.3,  attempts: 140, cfRate: 0.025, failRate: 0.11, avgProfit: 31400, uniques: ['Embassy Passport Run'] },
            { key: 'scamming',        startCS: 19.0, endCS: 32.7,  attempts: 120, cfRate: 0.029, failRate: 0.14, avgProfit: 28900, uniques: ['Whale Investment Mark'] },
            { key: 'arson',           startCS: 10.0, endCS: 21.4,  attempts: 95,  cfRate: 0.036, failRate: 0.15, avgProfit: 36000, uniques: ['Old Warehouse Insurance Job'] }
        ];

        // Deterministic PRNG so Demo mode renders smoothly & reproducibly
        let seed = 421337;
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            return seed / 4294967296;
        };

        const logs = [];
        const skills = {};
        const spanSec = 88 * 86400;

        for (const sp of demoSpecs) {
            const meta = CRIME_BY_KEY.get(sp.key);
            skills[sp.key] = sp.endCS;
            let cs = sp.startCS;
            const totalCSDelta = sp.endCS - sp.startCS;

            for (let i = 0; i < sp.attempts; i++) {
                const frac = i / Math.max(1, sp.attempts - 1);
                const ts = Math.floor(nowSec - spanSec + frac * spanSec + (rand() - 0.5) * 3600);
                const roll = rand();
                let outcome = 'success';
                let title = 'Crime success';
                let color = 'green';
                let profit = Math.round(sp.avgProfit * (0.55 + rand() * 0.95));

                if (roll < sp.cfRate) {
                    outcome = 'critical_failure';
                    title = 'Crime critical failure';
                    color = 'red';
                    profit = -Math.round(sp.avgProfit * 0.35);
                    cs = Math.max(sp.startCS, cs - 0.42);
                } else if (roll < sp.cfRate + sp.failRate) {
                    outcome = 'failure';
                    title = 'Crime failure';
                    color = 'orange';
                    profit = 0;
                } else {
                    const stepGain = (totalCSDelta / Math.max(1, sp.attempts * (1 - sp.failRate - sp.cfRate))) * (0.85 + rand() * 0.3);
                    cs = Math.min(sp.endCS, cs + stepGain);
                }

                const uniqueHit = (i === Math.floor(sp.attempts * 0.35) && sp.uniques[0])
                    ? sp.uniques[0]
                    : (i === Math.floor(sp.attempts * 0.78) && sp.uniques[1] ? sp.uniques[1] : null);

                logs.push({
                    pk: `demo:c_${sp.key}_${i}`,
                    userId: 'demo',
                    timestamp: ts,
                    log: outcome === 'success' ? 9010 : (outcome === 'failure' ? 9015 : 9005),
                    title,
                    category: 'Crimes',
                    kind: 'crime',
                    data: {
                        crime: sp.key,
                        crime_action: meta.keywords[0] || meta.name,
                        nerve: meta.avgNerve,
                        crime_skill: Number(cs.toFixed(2)),
                        outcome_type: outcome,
                        money_gained: profit > 0 ? Math.round(profit * 0.55) : 0,
                        items_gained_value: profit > 0 ? Math.round(profit * 0.45) : 0,
                        money_lost: profit < 0 ? Math.abs(profit) : 0,
                        unique: uniqueHit || undefined
                    },
                    params: { color }
                });
            }
        }

        // Historical Level Ups (Level 60 -> 61 -> 62 -> 63) + Attacks + Gym Trains
        const lvl61Ts = nowSec - 72 * 86400;
        const lvl62Ts = nowSec - 43 * 86400;
        const lvl63Ts = nowSec - 17 * 86400;
        logs.push({ pk: 'demo:lvl61', userId: 'demo', timestamp: lvl61Ts, log: 5500, title: 'Level up', category: 'Level', kind: 'level_up', data: { level: 61 } });
        logs.push({ pk: 'demo:lvl62', userId: 'demo', timestamp: lvl62Ts, log: 5500, title: 'Level up', category: 'Level', kind: 'level_up', data: { level: 62 } });
        logs.push({ pk: 'demo:lvl63', userId: 'demo', timestamp: lvl63Ts, log: 5500, title: 'Level up', category: 'Level', kind: 'level_up', data: { level: 63 } });

        // Generate ~1,400 attacks across the 88d window (leaves, mugs, hosps)
        for (let a = 0; a < 1420; a++) {
            const ts = Math.floor(nowSec - spanSec + (a / 1420) * spanSec);
            const r = rand();
            const res = r < 0.62 ? 'Leave' : (r < 0.80 ? 'Mug' : 'Hospitalize');
            const defLvl = Math.round(52 + rand() * 34);
            logs.push({
                pk: `demo:atk_${a}`,
                userId: 'demo',
                timestamp: ts,
                log: 8150,
                title: `Attack ${res.toLowerCase()}`,
                category: 'Attacking',
                kind: 'attack',
                data: { result: res, defender_level: defLvl }
            });
        }

        // Generate gym sessions
        for (let g = 0; g < 360; g++) {
            const ts = Math.floor(nowSec - spanSec + (g / 360) * spanSec);
            logs.push({
                pk: `demo:gym_${g}`,
                userId: 'demo',
                timestamp: ts,
                log: 5300,
                title: 'Gym train',
                category: 'Gym',
                kind: 'gym',
                data: { energy_used: 250 }
            });
        }

        const snapshot = {
            source: 'demo',
            fetchedAt: Date.now(),
            userId: 'demo',
            name: 'Demo Operative (Preview)',
            level: 63,
            rank: 'Elite Hitman',
            age: 942,
            bars: { nerve: { current: 58, maximum: 75 }, energy: { current: 150, maximum: 150 } },
            skills,
            personalstats: {
                attackswon: 4180,
                criminaloffenses: 38420,
                theft: 9420,
                counterfeiting: 6180,
                fraud: 5210,
                vandalism: 10450,
                illicitservices: 3120,
                cybercrime: 4040
            },
            hof: { level: { value: 63, rank: 24810 } },
            attacks: {}
        };

        return { logs, snapshot };
    }

    // ── Discord Markdown Share Generator & CSV/JSON Exporters ────────────────
    function buildDiscordMarkdownSummary(analytics, snapshot) {
        const lvl = analytics.levelEstimate;
        const k = analytics.kpis;
        const topProfit = analytics.recommendations.profit[0];
        const fastest = analytics.recommendations.fastest[0];
        const top3Focus = analytics.crimes
            .filter(c => c.currentSkill < 100 && (c.attempts > 0 || c.currentSkill > 0))
            .sort((a, b) => b.currentSkill - a.currentSkill)
            .slice(0, 5);

        const lines = [
            `🕵️ **FactionOS Crime & Level Report — ${snapshot?.name || 'Operative'} (Lvl ${lvl.currentLevel})**`,
            `> **Regular Level Progress:** Lvl **${lvl.currentLevel} → ${lvl.nextLevel}** (~**${lvl.progressPct}%**) | Est. **${lvl.leavesRemaining.toLocaleString()} Leaves** or **${lvl.crimesRemaining.toLocaleString()} Crimes** left (~${lvl.estDaysToLevel}d)`,
            `> **Crimes Summary (${analytics.timeframe.toUpperCase()}):** ${k.totalAttempts.toLocaleString()} attempts • ${k.totalNerve.toLocaleString()} nerve • **${k.successRate.toFixed(1)}%** S / ${k.failRate.toFixed(1)}% F / ${k.critFailRate.toFixed(1)}% CF • Net **$${Math.round(k.totalNetProfit).toLocaleString()}** (**$${Math.round(k.avgProfitPerNerve).toLocaleString()}/N**)`,
            ''
        ];
        if (top3Focus.length) {
            lines.push('**Active Crime Skill ETAs:**');
            for (const c of top3Focus) {
                lines.push(`• ${c.meta.icon} **${c.meta.name}** (CS ${c.currentSkill.toFixed(1)}/100): ~${c.nextLevelProj.attemptsRemaining} att (${c.nextLevelProj.nerveRemaining}N) to CS ${c.nextLevelProj.targetLevel} | ~${c.cs100Proj.attemptsRemaining.toLocaleString()} att (~${c.cs100Proj.daysRemaining.toFixed(1)}d) to CS 100`);
            }
        }
        if (topProfit) lines.push(`\n💰 **Best $/Nerve:** ${topProfit.meta.name} ($${Math.round(topProfit.profitPerNerve).toLocaleString()}/N)`);
        if (fastest) lines.push(`🚀 **Fastest to CS 100:** ${fastest.meta.name} (~${fastest.cs100Proj.daysRemaining.toFixed(1)} days)`);
        lines.push(`-# Generated by FactionOS Crime & Level Analytics`);
        return lines.join('\n');
    }

    function buildCsvExport(analytics) {
        const headers = [
            'Crime', 'CurrentSkill', 'Attempts', 'Successes', 'Failures', 'CritFails',
            'SuccessPct', 'CritFailPct', 'TotalNerve', 'AvgNervePerAttempt',
            'NetProfit', 'ProfitPerNerve', 'AvgAttemptsPerLevelRecent',
            'EstAttemptsNextLvl', 'EstNerveNextLvl', 'EstAttemptsCS100', 'EstNerveCS100', 'EstDaysCS100',
            'LoggedTransitions', 'Confidence'
        ];
        const rows = [headers.join(',')];
        for (const c of analytics.crimes) {
            rows.push([
                `"${c.meta.name}"`,
                c.currentSkill.toFixed(2),
                c.attempts,
                c.successes,
                c.failures,
                c.critFails,
                c.successRate.toFixed(2),
                c.critFailRate.toFixed(2),
                Math.round(c.totalNerve),
                c.avgNervePerAttempt.toFixed(2),
                Math.round(c.netProfit),
                Math.round(c.profitPerNerve),
                c.recentAvgAttemptsPerLvl,
                c.nextLevelProj.attemptsRemaining,
                c.nextLevelProj.nerveRemaining,
                c.cs100Proj.attemptsRemaining,
                c.cs100Proj.nerveRemaining,
                c.cs100Proj.daysRemaining.toFixed(2),
                c.transitions.length,
                c.confidence
            ].join(','));
        }
        return rows.join('\n');
    }

    global.FactionOSCrimesEngine = {
        CRIMES_2_ERA_TS,
        CRIMES_CATALOG,
        CRIME_BY_KEY,
        MERIT_CATEGORIES,
        crimeCurveFactor,
        baselineLevelThresholdXP,
        projectCrimeSkillRange,
        computeAnalytics,
        generateDemoDataset,
        buildDiscordMarkdownSummary,
        buildCsvExport
    };
})(window);
