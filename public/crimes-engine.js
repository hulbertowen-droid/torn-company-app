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

    // Canonical Crimes 2.0 Registry (verified against Torn API v2 /v2/torn/crimes)
    const CRIMES_CATALOG = [
        {
            id: 1,
            key: 'search_for_cash',
            name: 'Search for Cash',
            icon: '🪙',
            tier: 1,
            avgNerve: 2,
            color: '#38bdf8',
            meritBucket: 'theft',
            meritLabel: 'Theft',
            psSkillKey: 'searchforcashskill',
            psKeys: ['search_for_cash', 'theft'],
            enhancerId: 564,
            enhancerName: 'Glasses',
            uniquesTotal: 34,
            keywords: ['search for cash', 'searching the trash', 'searching the subway', 'searching the beach', 'searching the bridge', 'searching the cemetery', 'searching the fountain', 'searching the junkyard', 'searching the park', 'searching the dumpster']
        },
        {
            id: 2,
            key: 'bootlegging',
            name: 'Bootlegging',
            icon: '💿',
            tier: 1,
            avgNerve: 2.2,
            color: '#60a5fa',
            meritBucket: 'counterfeiting',
            meritLabel: 'Counterfeiting',
            psSkillKey: 'bootleggingskill',
            psKeys: ['bootlegging', 'counterfeiting'],
            enhancerId: 565,
            enhancerName: 'High-Speed Drive',
            uniquesTotal: 4,
            keywords: ['bootlegging', 'copying', 'selling dvds', 'online store', 'blank dvd', 'burning', 'pirat', 'dvd']
        },
        {
            id: 3,
            key: 'graffiti',
            name: 'Graffiti',
            icon: '🎨',
            tier: 1,
            avgNerve: 3,
            color: '#f472b6',
            meritBucket: 'vandalism',
            meritLabel: 'Vandalism',
            psSkillKey: 'graffitiskill',
            psKeys: ['graffiti', 'vandalism'],
            enhancerId: 979,
            enhancerName: 'Paint Mask',
            uniquesTotal: 41,
            keywords: ['graffiti', 'spray', 'tagging', 'stencil', 'mural', 'east side', 'west side', 'red light', 'downtown', 'financial district']
        },
        {
            id: 4,
            key: 'shoplifting',
            name: 'Shoplifting',
            icon: '🛍️',
            tier: 2,
            avgNerve: 4,
            color: '#fb923c',
            meritBucket: 'theft',
            meritLabel: 'Theft',
            psSkillKey: 'shopliftingskill',
            psKeys: ['shoplifting', 'theft'],
            enhancerId: 566,
            enhancerName: 'Mountain Bike',
            uniquesTotal: 60,
            keywords: ['shoplift', 'sally', 'sweet shop', 'bits \'n\' bobs', 'cyber force', 'big al', 'jewelry store', 'pharmacy', 'clothing store', 'super store']
        },
        {
            id: 5,
            key: 'pickpocketing',
            name: 'Pickpocketing',
            icon: '🧤',
            tier: 2,
            avgNerve: 5,
            color: '#facc15',
            meritBucket: 'theft',
            meritLabel: 'Theft',
            psSkillKey: 'pickpocketingskill',
            psKeys: ['pickpocketing', 'theft'],
            enhancerId: 567,
            enhancerName: 'Cut-Throat Razor',
            uniquesTotal: 22,
            keywords: ['pickpocket', 'drunk man', 'homeless', 'junkie', 'elderly', 'classy lady', 'laborer', 'postal worker', 'cyclist', 'rich kid', 'businessman', 'mobster', 'police officer']
        },
        {
            id: 6,
            key: 'card_skimming',
            name: 'Card Skimming',
            icon: '💳',
            tier: 2,
            avgNerve: 5.2,
            color: '#2dd4bf',
            meritBucket: 'fraud',
            meritLabel: 'Fraud',
            psSkillKey: 'cardskimmingskill',
            psKeys: ['card_skimming', 'fraud'],
            enhancerId: 578,
            enhancerName: 'Duct Tape',
            uniquesTotal: 0,
            keywords: ['card skimm', 'skimmer', 'bus station', 'gas station', 'atm', 'subway', 'installing a skimmer', 'retrieving a skimmer', 'selling card details']
        },
        {
            id: 7,
            key: 'burglary',
            name: 'Burglary',
            icon: '🏚️',
            tier: 3,
            avgNerve: 3.3,
            color: '#a78bfa',
            meritBucket: 'theft',
            meritLabel: 'Theft',
            psSkillKey: 'burglaryskill',
            psKeys: ['burglary', 'theft'],
            enhancerId: 1351,
            enhancerName: 'Flashlight',
            uniquesTotal: 34,
            keywords: ['burglar', 'scouting', 'casing', 'tool shed', 'beach hut', 'cottage', 'apartment', 'suburban', 'farmhouse', 'warehouse', 'self storage', 'office', 'printing works', 'shipyard']
        },
        {
            id: 8,
            key: 'hustling',
            name: 'Hustling',
            icon: '🎲',
            tier: 2,
            avgNerve: 3.2,
            color: '#34d399',
            meritBucket: 'fraud',
            meritLabel: 'Fraud',
            psSkillKey: 'hustlingskill',
            psKeys: ['hustling', 'fraud'],
            enhancerId: 1353,
            enhancerName: 'Megaphone',
            uniquesTotal: 0,
            keywords: ['hustl', 'shell game', 'pick a cup', 'cornhole', 'three-card', 'monte', 'dice', 'gathering audience', 'demoing']
        },
        {
            id: 9,
            key: 'disposal',
            name: 'Disposal',
            icon: '☣️',
            tier: 3,
            avgNerve: 6.4,
            color: '#f87171',
            meritBucket: 'illicitservices',
            meritLabel: 'Illicit Services',
            psSkillKey: 'disposalskill',
            psKeys: ['disposal', 'illicitservices'],
            enhancerId: 633,
            enhancerName: 'Latex Gloves',
            uniquesTotal: 11,
            keywords: ['dispos', 'biological waste', 'body part', 'dead body', 'building debris', 'general waste', 'industrial waste', 'murder weapon', 'old furniture', 'vehicle', 'firearm', 'burying', 'burning', 'dissolving', 'sinking', 'abandoning']
        },
        {
            id: 10,
            key: 'cracking',
            name: 'Cracking',
            icon: '💻',
            tier: 3,
            avgNerve: 6.7,
            color: '#06b6d4',
            meritBucket: 'cybercrime',
            meritLabel: 'Cybercrime',
            psSkillKey: 'crackingskill',
            psKeys: ['cracking', 'cybercrime'],
            enhancerId: 1354,
            enhancerName: 'Office Chair',
            uniquesTotal: 0,
            keywords: ['crack', 'brute forc', 'rig', 'password', 'decrypt', 'server', 'cipher', 'wordlist', 'hash']
        },
        {
            id: 11,
            key: 'forgery',
            name: 'Forgery',
            icon: '🪪',
            tier: 4,
            avgNerve: 5,
            color: '#c084fc',
            meritBucket: 'counterfeiting',
            meritLabel: 'Counterfeiting',
            psSkillKey: 'forgeryskill',
            psKeys: ['forgery', 'counterfeiting'],
            enhancerId: 1346,
            enhancerName: 'Magnifying Glass',
            uniquesTotal: 0,
            keywords: ['forger', 'forging', 'parking permit', 'side door', 'id badge', 'bank check', 'prescription', 'driver', 'passport', 'police badge', 'birth certificate', 'diploma']
        },
        {
            id: 12,
            key: 'scamming',
            name: 'Scamming',
            icon: '📧',
            tier: 4,
            avgNerve: 6.5,
            color: '#fb7185',
            meritBucket: 'fraud',
            meritLabel: 'Fraud',
            psSkillKey: 'scammingskill',
            psKeys: ['scamming', 'fraud'],
            enhancerId: 571,
            enhancerName: 'Ergonomic Keyboard',
            uniquesTotal: 0,
            keywords: ['scam', 'phishing', 'spam', 'email', 'farm', 'mark', 'romance', 'lottery', 'delivery', 'tech support', 'investment', 'charity']
        },
        {
            id: 13,
            key: 'arson',
            name: 'Arson',
            icon: '🔥',
            tier: 4,
            avgNerve: 5,
            color: '#f97316',
            meritBucket: 'vandalism',
            meritLabel: 'Vandalism',
            psSkillKey: 'arsonskill',
            psKeys: ['arson', 'vandalism'],
            enhancerId: 544,
            enhancerName: 'Windproof Lighter',
            uniquesTotal: 16,
            keywords: ['arson', 'accelerant', 'ignite', 'torch', 'molotov', 'firebomb', 'burn down', 'flammab', 'warehouse fire']
        }
    ];

    const CRIME_BY_KEY = new Map(CRIMES_CATALOG.map(c => [c.key, c]));

    // 10k Crime Category Merit Buckets (verified against Torn /v2/torn/crimes & criminalrecord)
    const MERIT_CATEGORIES = [
        { key: 'theft', label: 'Theft', target: 10000, psKey: 'theft', crimeKeys: ['search_for_cash', 'shoplifting', 'pickpocketing', 'burglary'] },
        { key: 'counterfeiting', label: 'Counterfeiting', target: 10000, psKey: 'counterfeiting', crimeKeys: ['bootlegging', 'forgery'] },
        { key: 'fraud', label: 'Fraud', target: 10000, psKey: 'fraud', crimeKeys: ['card_skimming', 'hustling', 'scamming'] },
        { key: 'vandalism', label: 'Vandalism', target: 10000, psKey: 'vandalism', crimeKeys: ['graffiti', 'arson'] },
        { key: 'illicitservices', label: 'Illicit Services', target: 10000, psKey: 'illicitservices', crimeKeys: ['disposal'] },
        { key: 'cybercrime', label: 'Cybercrime', target: 10000, psKey: 'cybercrime', crimeKeys: ['cracking'] }
    ];

    // ── Nonlinear Crime Skill Curve Model ────────────────────────────────────
    // Calibrated against Torn Crimes 2.0 empirical progression (CS 1->75 ≈ 35% of effort, CS 85 ≈ 52%, CS 75->100 ≈ 65%).
    function crimeCurveFactor(cs) {
        const s = Math.max(1, Math.min(99.9, Number(cs) || 1));
        const early = 1 + 0.032 * s;
        const midBoost = s > 45 ? 0.0014 * Math.pow(s - 45, 2.15) : 0;
        const lateBoost = s > 72 ? 0.0068 * Math.pow(s - 72, 2.25) : 0;
        return early + midBoost + lateBoost;
    }

    function cumulativeCrimeCurveWeight(cs) {
        const s = Math.max(1, Math.min(100, Number(cs) || 1));
        if (s <= 1.01) return 0;
        const floor = Math.floor(s);
        let sum = 0;
        for (let l = 1; l < floor; l++) sum += crimeCurveFactor(l + 0.5);
        sum += (s - floor) * crimeCurveFactor(floor + 0.5);
        return sum;
    }

    // Baseline attempts per level at CS=1 (before crimeCurveFactor) if user has zero logged or v2 attempts
    function defaultBaseAttemptsPerLevel(crimeMeta) {
        if (crimeMeta?.key === 'card_skimming') return 3.2; // Passive skimmers yield larger CS jumps per collect
        const tierMult = { 1: 11.5, 2: 12.5, 3: 11.0, 4: 13.0 };
        return tierMult[crimeMeta?.tier || 2] || 12.0;
    }

    const CRIT_FAIL_LOG_IDS = new Set([9154, 9155, 9158, 9160, 9163, 9165, 9190, 9191]);
    const FAIL_LOG_IDS = new Set([5700, 5705, 5710, 5715, 9150]);
    const SUCCESS_LOG_IDS = new Set([5720, 5725, 5730, 5735, 9010, 9015, 9020, 9025, 9027, 9030, 9035, 9050, 9051, 9052, 9053, 9055, 9056, 9060, 9065, 9070, 9071, 9072, 9073]);
    const SKILL_CHANGE_LOG_IDS = new Set([9005, 9006]);
    const CRIME_SETUP_LOG_IDS = new Set([9000, 9300, 9301, 9302, 9303, 9304, 9305, 9306, 9308, 9309, 9310, 9350, 9351, 9361, 9362, 9365, 9366]);
    const ATTACK_RECEIVE_LOG_IDS = new Set([8101, 8106, 8111, 8116, 8141, 8151, 8156, 8161, 8166, 8170, 8180]);
    const GYM_TRAIN_LOG_IDS = new Set([5300, 5301, 5302, 5303]);

    function isCrimeSkillEvent(log) {
        const lid = Number(log?.log || 0);
        const title = String(log?.title || '').toLowerCase();
        return SKILL_CHANGE_LOG_IDS.has(lid) || title.includes('crime skill level');
    }

    function isCrimeAttemptLog(log) {
        if (!log || isCrimeSkillEvent(log)) return false;
        const lid = Number(log.log || 0);
        const title = String(log.title || '').toLowerCase();
        const cat = String(log.category || '').toLowerCase();
        if (CRIME_SETUP_LOG_IDS.has(lid)) return Number(log.data?.nerve || 0) > 0;
        if (SUCCESS_LOG_IDS.has(lid) || FAIL_LOG_IDS.has(lid) || CRIT_FAIL_LOG_IDS.has(lid)) return true;
        if (log.kind === 'crime' || cat === 'crimes' || title.startsWith('crime ')) {
            // Setup/reputation/migration notifications never spend nerve
            if (log.data?.nerve !== undefined) return Number(log.data.nerve) > 0;
            return title.includes('success') || title.includes('fail');
        }
        return false;
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

        // Disambiguate shared location words first (e.g. "installing a skimmer at a subway station" vs "searching the subway")
        if (haystack.includes('skimmer') || haystack.includes('card details') || haystack.includes('skimming')) return 'card_skimming';
        if (haystack.includes('searching the ') || haystack.includes('search for cash')) return 'search_for_cash';
        if (haystack.includes('counterfeit dvd') || haystack.includes('copying dvd') || haystack.includes('bootlegging') || haystack.includes('online store')) return 'bootlegging';
        if (haystack.includes('spraying graffiti') || haystack.includes('graffiti')) return 'graffiti';
        if (haystack.includes('shoplifting') || haystack.includes('shoplift')) return 'shoplifting';
        if (haystack.includes('pickpocketing') || haystack.includes('pickpocket')) return 'pickpocketing';
        if (haystack.includes('burgling') || haystack.includes('burglary') || haystack.includes('scouting for a residential')) return 'burglary';
        if (haystack.includes('hustling') || haystack.includes('shell game') || haystack.includes('three-card')) return 'hustling';
        if (haystack.includes('dispos') || haystack.includes('dumping') || haystack.includes('dissolv')) return 'disposal';
        if (haystack.includes('cracking') || haystack.includes('brute forc')) return 'cracking';
        if (haystack.includes('forging') || haystack.includes('forgery')) return 'forgery';
        if (haystack.includes('scamming') || haystack.includes('phishing') || haystack.includes('email farm')) return 'scamming';
        if (haystack.includes('arson') || haystack.includes('torching')) return 'arson';

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

        if (CRIT_FAIL_LOG_IDS.has(logId) || title.includes('critical fail') || d.outcome_type === 'critical_failure' || color === 'red') {
            return 'critical_failure';
        }
        if (FAIL_LOG_IDS.has(logId) || title.includes('fail') || d.outcome_type === 'failure' || color === 'orange' || color === 'yellow') {
            return 'failure';
        }
        if (SUCCESS_LOG_IDS.has(logId) || title.includes('success') || title.includes('gain') || d.outcome_type === 'success' || color === 'green') {
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
    // Calibrated equivalent "similar-level Leave attacks" required to advance from Level L -> L+1
    // (Matches Rush-to-15 ~145 Leave-equiv, Lvl 45 cum ~3,536 / step 220, Lvl 99->100 step ~885, total ~29.8k to Lvl 100)
    function baselineLevelThresholdXP(level) {
        const L = Math.max(1, Math.min(100, Number(level) || 1));
        if (L >= 100) return 0;
        if (L < 15) return Math.max(2, Math.round(1.5 + 0.9 * L + 0.06 * L * L));
        return Math.round(6 + 1.45 * L + 0.068 * Math.pow(L, 2.02));
    }

    function inferDefenderLevelFromAttack(atk, fallbackLevel) {
        const explicit = Number(atk?.defender_level || atk?.target_level || 0);
        if (explicit > 0) return explicit;
        // Infer from Torn's exact respect formula: baseRespect = (ln(L) + 1) / 4
        const rGain = Number(atk?.respect_gain ?? atk?.respect ?? 0);
        const m = atk?.modifiers || {};
        const resStr = String(atk?.result || '').toLowerCase();
        if (rGain > 0 && ['attacked', 'mugged', 'hospitalized'].includes(resStr)) {
            const mult = (Number(m.fair_fight) || 1) *
                (Number(m.war) || 1) *
                (Number(m.retaliation) || 1) *
                (Number(m.group_attack) || 1) *
                (Number(m.overseas) || 1) *
                (Number(m.chain_bonus) || 1);
            // Mugs yield ~75% of Leave/Hosp respect in Torn
            const outcomeRespectFactor = resStr === 'mugged' ? 0.75 : 1.0;
            const baseResp = rGain / Math.max(0.25, mult * outcomeRespectFactor);
            if (baseResp > 0.2 && baseResp < 2.0) {
                const estLvl = Math.round(Math.exp(4 * baseResp - 1));
                return Math.max(1, Math.min(100, estLvl));
            }
        }
        return Math.max(1, Number(fallbackLevel || 50));
    }

    function detectAttackOutcomeFromLog(log) {
        const lid = Number(log?.log || 0);
        const t = String(log?.title || '').toLowerCase();
        const r = String(log?.data?.result || log?.data?.outcome || '').toLowerCase();
        const combined = `${t} ${r}`;
        if (
            ATTACK_RECEIVE_LOG_IDS.has(lid) ||
            combined.includes('receive') ||
            combined.includes('lost') ||
            combined.includes('stalemate') ||
            combined.includes('timeout') ||
            combined.includes('escape') ||
            combined.includes('failed') ||
            combined.includes('defend')
        ) {
            return 'non_win';
        }
        if (combined.includes('assist') || lid === 8145) return 'assist';
        if (combined.includes('mug') || lid === 8155) return 'mug';
        if (combined.includes('hosp') || lid === 8160) return 'hospitalize';
        if (combined.includes('leave') || combined.includes('left') || combined.includes('attacked') || combined.includes('won') || combined.includes('arrest') || lid === 8150 || lid === 8165) return 'leave';
        return 'non_win';
    }

    // ── Master Computation Pipeline ──────────────────────────────────────────
    function computeAnalytics({ logs = [], snapshot = null, itemPrices = {}, itemNames = {}, timeframe = 'all', customFromTs = null, customToTs = null, crimeFilter = 'all', manualLevelUpTs = null }) {
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
        const psSnap = snapshot?.personalstats || {};
        const v2CrimesMap = snapshot?.v2Crimes || null;

        // Initialize per-crime buckets with authoritative live Torn CS
        const crimeMap = new Map();
        for (const meta of CRIMES_CATALOG) {
            let liveCS = 0;
            let hasAuthoritativeSkill = false;
            if (liveSkills[meta.key] !== undefined && !isNaN(Number(liveSkills[meta.key]))) {
                liveCS = Number(liveSkills[meta.key]);
                hasAuthoritativeSkill = true;
            } else if (v2CrimesMap?.[meta.key]?.skill !== undefined && !isNaN(Number(v2CrimesMap[meta.key].skill))) {
                liveCS = Number(v2CrimesMap[meta.key].skill);
                hasAuthoritativeSkill = true;
            } else if (meta.psSkillKey && psSnap[meta.psSkillKey] !== undefined && !isNaN(Number(psSnap[meta.psSkillKey]))) {
                liveCS = Number(psSnap[meta.psSkillKey]);
                hasAuthoritativeSkill = true;
            }
            crimeMap.set(meta.key, {
                key: meta.key,
                meta,
                currentSkill: liveCS,
                _hasAuthoritativeSkill: hasAuthoritativeSkill,
                progressionBonus: Number(v2CrimesMap?.[meta.key]?.progressionBonus || 0),
                attempts: 0,
                successes: 0,
                failures: 0,
                critFails: 0,
                totalNerve: 0,
                cashGained: 0,
                cashLost: 0,
                itemsGainedVal: 0,
                itemsUsedVal: 0,
                itemsTotalQty: 0,
                netProfit: 0,
                cashOnlyProfit: 0,
                uniquesFound: new Set(),
                uniquesUnlockedCount: 0,
                topRewardItems: [],
                _loggedItemQtyMap: new Map(),
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
        let totalCashGained = 0;
        let totalCashLost = 0;
        let totalItemsGainedVal = 0;
        let totalItemsCount = 0;

        const dailyMap = new Map(); // YYYY-MM-DD (UTC / TCT) -> { date, nerve, attempts, successes, failures, critFails, profit, cashProfit }
        const recent14dStart = nowSec - 14 * 86400;
        const recent30dStart = nowSec - 30 * 86400;
        let nerveLast14d = 0;
        let nerveLast30d = 0;
        const activeDays14d = new Set();
        const activeDays30d = new Set();
        let earliestLogTs14d = Infinity;
        let earliestLogTs30d = Infinity;

        for (const log of filteredLogs) {
            const isSkillEvt = isCrimeSkillEvent(log);
            const isAttemptEvt = isCrimeAttemptLog(log);
            if (!isSkillEvt && !isAttemptEvt) continue;

            const cKey = detectCrimeKeyFromLog(log);
            if (!cKey || !crimeMap.has(cKey)) continue;
            if (crimeFilter !== 'all' && crimeFilter !== cKey) continue;

            const st = crimeMap.get(cKey);
            const d = log.data || {};

            // Handle Torn CS Level Up / Down notifications (log 9005 / 9006) purely for CS progression tracking
            if (isSkillEvt) {
                const lvlCS = d.skill_level !== undefined ? Number(d.skill_level) : (d.crime_skill !== undefined ? Number(d.crime_skill) : null);
                if (lvlCS !== null && !isNaN(lvlCS)) {
                    if (Number(log.log) === 9006 && st._lastLoggedCS !== null && lvlCS < st._lastLoggedCS) {
                        st.critSkillLost += (st._lastLoggedCS - lvlCS);
                    }
                    const intLvl = Math.floor(lvlCS);
                    if (st._lastIntLvl === null) {
                        st._lastIntLvl = intLvl;
                        st._attemptsSinceLvl = 0;
                        st._nerveSinceLvl = 0;
                        st._critsSinceLvl = 0;
                        st.historyPoints.push({ cs: Number(lvlCS.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: log.timestamp });
                    } else if (intLvl > st._lastIntLvl) {
                        const spanLvls = intLvl - st._lastIntLvl;
                        const attPerLvl = st._attemptsSinceLvl / spanLvls;
                        const nervePerLvl = st._nerveSinceLvl / spanLvls;
                        // Only record transition when we actually saw attempts in the interval
                        if (st._attemptsSinceLvl > 0) {
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
                        }
                        st._lastIntLvl = intLvl;
                        st._attemptsSinceLvl = 0;
                        st._nerveSinceLvl = 0;
                        st._critsSinceLvl = 0;
                        st.historyPoints.push({ cs: Number(lvlCS.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: log.timestamp });
                    } else if (intLvl < st._lastIntLvl) {
                        st._lastIntLvl = intLvl;
                    }
                    st._lastLoggedCS = lvlCS;
                    if (!st._hasAuthoritativeSkill && lvlCS > st.currentSkill) {
                        st.currentSkill = lvlCS;
                    }
                }
                continue;
            }

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
            } else if (outcome === 'failure') {
                st.failures++;
                totalFailures++;
            } else {
                st.critFails++;
                totalCritFails++;
                st._critsSinceLvl++;
            }

            // Cash & Items Valuation (note: d.items_added on prep logs 9300/9301 is prep, never profit!)
            const mGain = Number(d.money_gained || d.cash_gained || 0);
            const mLoss = Number(d.money_lost || d.cash_lost || 0);
            const iGain = Number(d.items_gained_value ?? computeItemsValue(d.items_gained, itemPrices));
            const iUsed = Number(d.items_used_value ?? computeItemsValue(d.items_used || d.items_lost, itemPrices));
            const net = (mGain + iGain) - (mLoss + iUsed);
            const cashNet = mGain - mLoss;

            if (d.items_gained && typeof d.items_gained === 'object') {
                const entries = Array.isArray(d.items_gained)
                    ? d.items_gained.map(e => [String(e?.id || e?.item_id || ''), Number(e?.qty || e?.quantity || 1)])
                    : Object.entries(d.items_gained);
                for (const [idStr, qtyRaw] of entries) {
                    const q = Number(qtyRaw || 0);
                    if (!idStr || q <= 0) continue;
                    st.itemsTotalQty += q;
                    totalItemsCount += q;
                    st._loggedItemQtyMap.set(idStr, (st._loggedItemQtyMap.get(idStr) || 0) + q);
                }
            }

            st.cashGained += mGain;
            st.cashLost += mLoss;
            st.itemsGainedVal += iGain;
            st.itemsUsedVal += iUsed;
            st.netProfit += net;
            st.cashOnlyProfit += cashNet;
            totalCashGained += mGain;
            totalCashLost += mLoss;
            totalItemsGainedVal += iGain;
            totalNetProfit += net;

            // Unique Outcome Tracking
            if (d.unique) {
                const uLabel = typeof d.unique === 'string' && d.unique.length > 2 && d.unique !== '(unique)'
                    ? d.unique
                    : `${st.meta.name}: ${d.crime_action || log.title || 'Unique Outcome'}`;
                st.uniquesFound.add(uLabel);
            }

            // Daily Timeline Tracking (TCT / UTC calendar day)
            const dayStr = new Date(log.timestamp * 1000).toISOString().slice(0, 10);
            if (!dailyMap.has(dayStr)) {
                dailyMap.set(dayStr, { date: dayStr, nerve: 0, attempts: 0, successes: 0, failures: 0, critFails: 0, profit: 0, cashProfit: 0 });
            }
            const dayRow = dailyMap.get(dayStr);
            dayRow.nerve += nerve;
            dayRow.attempts++;
            if (outcome === 'success') dayRow.successes++;
            else if (outcome === 'failure') dayRow.failures++;
            else dayRow.critFails++;
            dayRow.profit += net;
            dayRow.cashProfit += cashNet;

            if (log.timestamp >= recent14dStart) {
                nerveLast14d += nerve;
                activeDays14d.add(dayStr);
                if (log.timestamp < earliestLogTs14d) earliestLogTs14d = log.timestamp;
            }
            if (log.timestamp >= recent30dStart) {
                nerveLast30d += nerve;
                activeDays30d.add(dayStr);
                if (log.timestamp < earliestLogTs30d) earliestLogTs30d = log.timestamp;
            }

            // Legacy / explicit crime_skill field if present on attempt log
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
                if (!st._hasAuthoritativeSkill && loggedCS > st.currentSkill) {
                    st.currentSkill = loggedCS;
                }
            } else if (outcome === 'critical_failure') {
                st.critFailPoints.push({ cs: Number(st.currentSkill.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: log.timestamp });
            }
        }

        // Build topRewardItems from logs (when in windowed mode or before v2 override)
        for (const st of crimeMap.values()) {
            if (st._loggedItemQtyMap.size > 0) {
                const scored = [];
                for (const [idStr, amt] of st._loggedItemQtyMap.entries()) {
                    const unitVal = Number(itemPrices[idStr] || 0);
                    scored.push({
                        id: Number(idStr),
                        name: (itemNames && itemNames[idStr]) || `Item #${idStr}`,
                        amount: amt,
                        unitValue: Math.round(unitVal),
                        totalValue: Math.round(amt * unitVal)
                    });
                }
                scored.sort((a, b) => b.totalValue - a.totalValue || b.amount - a.amount);
                st.topRewardItems = scored.slice(0, 15);
            }
        }

        // Hydrate / supplement per-crime lifetime totals from Torn API v2 (/v2/user/{1..13}/crimes)
        // Whenever timeframe is 'all' or 'c2' (or zero logs synced), v2Crimes gives exact lifetime Torn counts
        const useV2LifetimeTotals = Boolean(v2CrimesMap && (logs.length === 0 || timeframe === 'all' || timeframe === 'c2'));
        if (useV2LifetimeTotals) {
            totalAttempts = 0;
            totalSuccesses = 0;
            totalFailures = 0;
            totalCritFails = 0;
            totalNerve = 0;
            totalNetProfit = 0;
            totalCashGained = 0;
            totalCashLost = 0;
            totalItemsGainedVal = 0;
            totalItemsCount = 0;

            for (const st of crimeMap.values()) {
                const v2 = v2CrimesMap[st.key];
                if (v2 && (v2.attempts?.total || 0) >= st.attempts) {
                    st.attempts = Number(v2.attempts.total || 0);
                    st.successes = Number(v2.attempts.success || 0);
                    st.failures = Number(v2.attempts.fail || 0);
                    st.critFails = Number(v2.attempts.criticalFail || 0);
                    st.totalNerve = Number(v2.nerveSpent || 0);

                    let itemVal = Number(v2.itemRewardsValue || 0);
                    let qtyTotal = Number(v2.itemsTotalQty || 0);
                    let topScored = Array.isArray(v2.topItems) ? v2.topItems : [];

                    if (Array.isArray(v2.rawRewardItems) && itemPrices && Object.keys(itemPrices).length > 0) {
                        itemVal = 0;
                        qtyTotal = 0;
                        const rebuilt = [];
                        for (const it of v2.rawRewardItems) {
                            const idStr = String(it.id || '');
                            const amt = Number(it.amount || 0);
                            const unitVal = Number(itemPrices[idStr] || 0);
                            const totVal = amt * unitVal;
                            itemVal += totVal;
                            qtyTotal += amt;
                            if (amt > 0) {
                                rebuilt.push({
                                    id: Number(it.id),
                                    name: (itemNames && itemNames[idStr]) || `Item #${idStr}`,
                                    amount: amt,
                                    unitValue: Math.round(unitVal),
                                    totalValue: Math.round(totVal)
                                });
                            }
                        }
                        rebuilt.sort((a, b) => b.totalValue - a.totalValue || b.amount - a.amount);
                        topScored = rebuilt.slice(0, 15);
                    }
                    st.cashGained = Number(v2.cashRewards || 0);
                    st.itemsGainedVal = Math.round(itemVal);
                    st.itemsTotalQty = qtyTotal;
                    // Do not mix partial-window log losses into all-time Torn v2 rewards
                    st.netProfit = st.cashGained + st.itemsGainedVal;
                    st.cashOnlyProfit = st.cashGained;
                    st.uniquesUnlockedCount = Number(v2.uniquesCount || 0);
                    st.topRewardItems = topScored;
                    for (const uLabel of (v2.uniquesList || [])) {
                        st.uniquesFound.add(uLabel);
                    }
                }
                if (crimeFilter === 'all' || crimeFilter === st.key) {
                    totalAttempts += st.attempts;
                    totalSuccesses += st.successes;
                    totalFailures += st.failures;
                    totalCritFails += st.critFails;
                    totalNerve += st.totalNerve;
                    totalCashGained += st.cashGained;
                    totalCashLost += st.cashLost;
                    totalItemsGainedVal += st.itemsGainedVal;
                    totalItemsCount += st.itemsTotalQty;
                    totalNetProfit += st.netProfit;
                }
            }
        }

        // Compute average daily nerve spent (rolling 14d / 30d logs, or realistic NNB/lifetime pace)
        const nnb = Number(snapshot?.bars?.nerve?.maximum || 60);
        const naturalDailyNerve = Math.min(265, Math.max(96, Math.round(nnb * 3.9 + 30)));
        let dailyNerveAvg = naturalDailyNerve;
        let dailyNerveSource = `Est. active regen (${nnb} max nerve)`;
        if (activeDays14d.size >= 3 && nerveLast14d > 0) {
            const coveredSpan14 = Number.isFinite(earliestLogTs14d) ? Math.max(1, Math.ceil((nowSec - earliestLogTs14d) / 86400)) : activeDays14d.size;
            const denom14 = Math.min(14, Math.max(activeDays14d.size, coveredSpan14));
            dailyNerveAvg = Math.max(24, Math.round(nerveLast14d / denom14));
            dailyNerveSource = `14d rolling avg (${activeDays14d.size} active days)`;
        } else if (activeDays30d.size >= 3 && nerveLast30d > 0) {
            const coveredSpan30 = Number.isFinite(earliestLogTs30d) ? Math.max(1, Math.ceil((nowSec - earliestLogTs30d) / 86400)) : activeDays30d.size;
            const denom30 = Math.min(30, Math.max(activeDays30d.size, coveredSpan30));
            dailyNerveAvg = Math.max(24, Math.round(nerveLast30d / denom30));
            dailyNerveSource = `30d rolling avg (${activeDays30d.size} active days)`;
        } else if (dailyMap.size >= 2 && totalNerve > 0 && !useV2LifetimeTotals) {
            dailyNerveAvg = Math.max(24, Math.round(totalNerve / dailyMap.size));
            dailyNerveSource = `${dailyMap.size}d synced avg`;
        } else if (v2CrimesMap && Number(snapshot?.age || 0) > 14) {
            const allV2Nerve = Object.values(v2CrimesMap).reduce((s, c) => s + Number(c?.nerveSpent || 0), 0);
            const c2Days = Math.max(14, Math.min(Number(snapshot.age), Math.floor((nowSec - CRIMES_2_ERA_TS) / 86400)));
            const lifetimePace = Math.round(allV2Nerve / c2Days);
            if (lifetimePace > naturalDailyNerve) {
                dailyNerveAvg = Math.min(480, lifetimePace);
                dailyNerveSource = `Observed Crimes 2.0 pace (~${dailyNerveAvg} N/d)`;
            }
        }

        // Finalize per-crime nonlinear calibration, projections, crit-fail cost & confidence
        const crimesList = [];
        for (const st of crimeMap.values()) {
            const v2 = v2CrimesMap?.[st.key] || null;
            const v2AvgNerve = (v2 && v2.attempts?.total > 0 && v2.nerveSpent > 0)
                ? (v2.nerveSpent / v2.attempts.total)
                : null;
            const avgNerve = st.attempts > 0
                ? (st.totalNerve / st.attempts)
                : (v2AvgNerve || st.meta.avgNerve);
            st.avgNervePerAttempt = avgNerve;
            st.successRate = st.attempts > 0 ? (st.successes / st.attempts) * 100 : 0;
            st.failRate = st.attempts > 0 ? (st.failures / st.attempts) * 100 : 0;
            st.critFailRate = st.attempts > 0 ? (st.critFails / st.attempts) * 100 : 0;
            st.profitPerNerve = st.totalNerve > 0 ? (st.netProfit / st.totalNerve) : 0;
            st.cashProfitPerNerve = st.totalNerve > 0 ? (st.cashOnlyProfit / st.totalNerve) : 0;
            if (!st.uniquesUnlockedCount) st.uniquesUnlockedCount = st.uniquesFound.size;

            // Recency-weighted nonlinear calibration (Log transitions + Torn API v2 lifetime integral calibration)
            const recentTrans = st.transitions.slice(-5);
            const v2TotalAtt = Number(v2?.attempts?.total || 0);
            const cumWeight = cumulativeCrimeCurveWeight(st.currentSkill);
            const v2CalibratedBase = (v2TotalAtt >= 12 && st.currentSkill > 1.05 && cumWeight > 0.2)
                ? Math.max(1.2, v2TotalAtt / cumWeight)
                : null;

            let calibratedBaseRate = v2CalibratedBase ?? defaultBaseAttemptsPerLevel(st.meta);
            let recentAvgAttemptsPerLvl = Math.max(2, Math.round(calibratedBaseRate * crimeCurveFactor(Math.max(1, st.currentSkill))));
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
                calibratedBaseRate = v2CalibratedBase
                    ? Math.max(1.2, weightedBase * 0.75 + v2CalibratedBase * 0.25)
                    : Math.max(1.2, weightedBase);
                recentAvgAttemptsPerLvl = Math.max(2, Math.round(weightedRaw));

                if (recentTrans.length >= 5) {
                    confidence = 'High';
                    confidenceMath = `High Confidence: Weighted nonlinear curve calibrated on ${st.transitions.length} logged skill transitions (last 5 levels weighted 10%→30%, avg ${recentAvgAttemptsPerLvl} attempts/lvl).`;
                } else {
                    confidence = 'Medium';
                    confidenceMath = `Medium Confidence: Calibrated on ${recentTrans.length} logged skill transitions (avg ${recentAvgAttemptsPerLvl} attempts/lvl) + Crimes 2.0 nonlinear CS scaling.`;
                }
            } else if (v2CalibratedBase !== null) {
                calibratedBaseRate = v2CalibratedBase;
                recentAvgAttemptsPerLvl = Math.max(2, Math.round(calibratedBaseRate * crimeCurveFactor(Math.max(1, st.currentSkill))));
                if (v2TotalAtt >= 150 || st.currentSkill >= 100) {
                    confidence = 'High';
                    confidenceMath = `High Confidence: Calibrated directly on your Torn API v2 lifetime record (${v2TotalAtt.toLocaleString()} attempts, ${Number(v2.nerveSpent || 0).toLocaleString()} nerve to CS ${st.currentSkill.toFixed(2)}; ~${recentAvgAttemptsPerLvl} att/lvl at current CS).`;
                } else {
                    confidence = 'Medium';
                    confidenceMath = `Medium Confidence: Calibrated on your Torn API v2 record (${v2TotalAtt.toLocaleString()} attempts to CS ${st.currentSkill.toFixed(2)}) + Crimes 2.0 nonlinear scaling.`;
                }
            } else if (st.attempts >= 60) {
                confidence = 'Medium';
                calibratedBaseRate = defaultBaseAttemptsPerLevel(st.meta) * (1 + (st.critFailRate / 100) * 1.4);
                recentAvgAttemptsPerLvl = Math.max(2, Math.round(calibratedBaseRate * crimeCurveFactor(Math.max(1, st.currentSkill))));
                confidenceMath = `Medium Confidence: ${st.attempts} attempts logged; using Crimes 2.0 curve adjusted for your ${st.critFailRate.toFixed(1)}% crit-fail rate.`;
            } else {
                confidence = 'Low';
                confidenceMath = `Low Confidence: Fewer than 12 attempts recorded for ${st.meta.name} (CS ${st.currentSkill.toFixed(2)}); using baseline Crimes 2.0 difficulty curve.`;
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
                st.critRecoveryExtraAttempts = Math.max(3, Math.round(recentAvgAttemptsPerLvl * 0.42));
            }
            if (st.critSkillLost <= 0 && st.critFails > 0) {
                st.critSkillLost = Number((st.critFails * 0.38).toFixed(2));
            }

            // Build history trajectory points (use exact log points if available, else synthesize calibrated curve up to currentSkill)
            if (!st.historyPoints.length && st.currentSkill > 1 && st.attempts > 0) {
                const totW = Math.max(0.1, cumulativeCrimeCurveWeight(st.currentSkill));
                const step = st.currentSkill > 30 ? 5 : 2;
                st.historyPoints.push({ cs: 1, nerve: 0, attempts: 0, ts: nowSec });
                for (let lvl = step; lvl < st.currentSkill; lvl += step) {
                    const frac = cumulativeCrimeCurveWeight(lvl) / totW;
                    st.historyPoints.push({
                        cs: lvl,
                        nerve: Math.round(st.totalNerve * frac),
                        attempts: Math.round(st.attempts * frac),
                        ts: nowSec
                    });
                }
                st.historyPoints.push({ cs: Number(st.currentSkill.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: nowSec });
            } else if (!st.historyPoints.length && st.currentSkill > 0) {
                st.historyPoints.push({ cs: Number(st.currentSkill.toFixed(2)), nerve: Math.round(st.totalNerve), attempts: st.attempts, ts: nowSec });
            } else if (st.historyPoints.length && st.currentSkill !== st.historyPoints[st.historyPoints.length - 1].cs) {
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

        // 10k Crime Category Merits (cross-checked across personalstats, criminalrecord, and v2/logged successes)
        const ps = snapshot?.personalstats || {};
        const crimRec = snapshot?.criminalrecord || {};
        const merits = MERIT_CATEGORIES.map(mc => {
            const psVal = Number(ps[mc.psKey] || 0);
            const crVal = Number(crimRec[mc.psKey] || 0);
            const loggedSuccesses = mc.crimeKeys.reduce((sum, ck) => sum + (crimeMap.get(ck)?.successes || 0), 0);
            const count = Math.max(psVal, crVal, loggedSuccesses);
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
            useV2LifetimeTotals,
            kpis: {
                totalNerve,
                totalAttempts,
                totalSuccesses,
                totalFailures,
                totalCritFails,
                successRate: totalAttempts > 0 ? (totalSuccesses / totalAttempts) * 100 : 0,
                failRate: totalAttempts > 0 ? (totalFailures / totalAttempts) * 100 : 0,
                critFailRate: totalAttempts > 0 ? (totalCritFails / totalAttempts) * 100 : 0,
                totalNetProfit,
                totalCashGained,
                totalCashLost,
                totalItemsGainedVal,
                totalItemsCount,
                totalCashOnlyProfit: totalCashGained - (useV2LifetimeTotals ? 0 : totalCashLost),
                avgProfitPerNerve: totalNerve > 0 ? (totalNetProfit / totalNerve) : 0,
                avgCashPerNerve: totalNerve > 0 ? ((totalCashGained - (useV2LifetimeTotals ? 0 : totalCashLost)) / totalNerve) : 0,
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

        // Extract real player Level Up history from logs (exclude Crime Skill 9005/9006 logs from legacy IDB caches)
        const levelUpLogs = allSortedLogs
            .filter(l => (l.kind === 'level_up' || Number(l.log) === 5200) && !isCrimeSkillEvent(l))
            .map((l, idx) => ({
                timestamp: l.timestamp,
                levelReached: Number(l.data?.level || l.data?.new_level || 0) || null,
                title: l.title || 'Level up',
                idx
            }))
            .sort((a, b) => a.timestamp - b.timestamp);

        // Index snapshot attacks by timestamp_ended for defender level lookup when log lacks defender_level
        const attackLookupByTs = new Map();
        const myId = Number(snapshot?.userId || 0);
        if (snapshot?.attacks && typeof snapshot.attacks === 'object') {
            for (const atk of Object.values(snapshot.attacks)) {
                if (myId && atk.attacker_id && Number(atk.attacker_id) !== myId) continue;
                const ts = Number(atk.timestamp_ended || atk.timestamp_started || 0);
                if (ts > 0) attackLookupByTs.set(ts, atk);
            }
        }

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
            const intervalMetrics = tallyXPInRange(allSortedLogs, prev.timestamp, curr.timestamp, prev.levelReached || Math.max(1, currentLevel - 1), attackLookupByTs);
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
        const sinceMetrics = tallyXPInRange(allSortedLogs, effectiveStartTs, nowSec + 60, currentLevel, attackLookupByTs);

        // If user is on Limited Access (no full logs), supplement with snapshot recent attacks using exact respect-derived defender levels
        if (sinceMetrics.attacksTotal === 0 && snapshot?.attacks && Object.keys(snapshot.attacks).length > 0) {
            const myId = Number(snapshot.userId || 0);
            const myName = String(snapshot.name || '').toLowerCase();
            for (const atk of Object.values(snapshot.attacks)) {
                const ts = Number(atk.timestamp_ended || atk.timestamp_started || 0);
                if (ts < effectiveStartTs) continue;
                const isAttacker = (myId && Number(atk.attacker_id) === myId) ||
                    (!atk.attacker_id && myName && String(atk.defender_name || '').toLowerCase() !== myName);
                if (!isAttacker) continue;
                const resStr = String(atk.result || '').toLowerCase();
                if (!['attacked', 'mugged', 'hospitalized'].includes(resStr)) continue;
                const defLvl = inferDefenderLevelFromAttack(atk, currentLevel);
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

        // Threshold Estimation: Personal interval calibration if available, else calibrated Torn scaling curve
        let estimatedThresholdXP = baselineLevelThresholdXP(currentLevel);
        let calibrationMethod = 'Torn Calibrated Level XP Curve';

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

        // Secondary HoF / Lifetime Level-Holding Detection & Limited-Key Model
        let isLevelHolding = false;
        let levelHoldingReason = '';
        let hofNote = hofLevelRank > 0 ? `Level HoF Rank #${hofLevelRank.toLocaleString()}` : 'HoF Rank unavailable';

        const orgCrimesPS = Number(snapshot?.personalstats?.organisedcrimes || 0);
        const ageDays = Number(snapshot?.age || 0);
        let expectedCumXP = 0;
        for (let l = 1; l < currentLevel; l++) expectedCumXP += baselineLevelThresholdXP(l);
        const approxLifetimeXP = totalAttacksWonPS * 0.80 + totalCrimesPS * 0.095 + orgCrimesPS * 1.4 + ageDays * 0.35;

        if ((latestLevelUp || manualLevelUpTs) && currentLevel < 100 && rawPct >= 105) {
            isLevelHolding = true;
            levelHoldingReason = `Logged XP since last level-up is ~${Math.round(rawPct)}% of Level ${currentLevel + 1} threshold — you likely have an [Upgrade] button waiting or are Level Holding.`;
        } else if (currentLevel < 95 && totalAttacksWonPS > 150 && approxLifetimeXP > (expectedCumXP + estimatedThresholdXP) * 1.45) {
            isLevelHolding = true;
            levelHoldingReason = `Lifetime activity (${totalAttacksWonPS.toLocaleString()} attacks won, ${totalCrimesPS.toLocaleString()} crimes) significantly exceeds Level ${currentLevel} norms — possible Level Holder.`;
        }

        // If neither a logged Level Up nor a Manual Level-Up Date exists, estimate from lifetime XP residual + recent attack floor
        let isLimitedHeuristic = false;
        if (!latestLevelUp && !manualLevelUpTs && (totalAttacksWonPS > 0 || totalCrimesPS > 0) && currentLevel < 100) {
            isLimitedHeuristic = true;
            const residual = approxLifetimeXP - expectedCumXP;
            let estPct;
            if (isLevelHolding) {
                estPct = 99;
            } else if (residual >= 0 && residual <= estimatedThresholdXP * 1.2) {
                estPct = Math.min(95, Math.max(8, (residual / Math.max(10, estimatedThresholdXP)) * 100));
            } else {
                // Smooth fallback if player leveled primarily via high-FF Baldr targets or gym/missions
                const recentPct = Math.min(88, (sinceMetrics.xpTotal / Math.max(10, estimatedThresholdXP)) * 100);
                estPct = Math.max(12, recentPct > 5 ? recentPct : 35);
            }
            rawPct = estPct;
            calibrationMethod = 'Limited-Key Lifetime XP & HoF Model (set Manual Last Level-Up Date above or sync Full Logs for exact counter)';
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

    function tallyXPInRange(sortedLogs, startTs, endTs, userLevel, attackLookupByTs = null) {
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
                let defLvl = Number(l.data?.defender_level || l.data?.target_level || 0);
                if (!defLvl && attackLookupByTs && attackLookupByTs.size > 0) {
                    const matched = attackLookupByTs.get(l.timestamp) || attackLookupByTs.get(l.timestamp - 1) || attackLookupByTs.get(l.timestamp + 1) || attackLookupByTs.get(l.timestamp - 2) || attackLookupByTs.get(l.timestamp + 2);
                    if (matched) defLvl = inferDefenderLevelFromAttack(matched, userLevel);
                }
                if (!defLvl) defLvl = Number(userLevel || 50);
                const lvlScale = Math.max(0.35, Math.min(2.25, 0.45 + 0.55 * (defLvl / Math.max(1, userLevel || 50))));
                if (outcome === 'leave') { leaves++; xpAttacks += 1.0 * lvlScale; }
                else if (outcome === 'mug') { mugs++; xpAttacks += 0.57 * lvlScale; }
                else if (outcome === 'hospitalize') { hosps++; xpAttacks += 0.40 * lvlScale; }
                else if (outcome === 'assist') { xpAttacks += 0.25 * lvlScale; }
                attacksTotal++;
            } else if (l.kind === 'crime' && isCrimeAttemptLog(l)) {
                const outcome = detectCrimeOutcome(l);
                if (outcome === 'success') {
                    const nerve = Number(l.data?.nerve || 4);
                    crimesSuccess++;
                    xpCrimes += nerve * 0.042;
                }
            } else if (l.kind === 'gym') {
                const lid = Number(l.log || 0);
                const energy = Number(l.data?.energy_used || 0);
                if (!GYM_TRAIN_LOG_IDS.has(lid) && energy <= 0) continue;
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
                dailyNerveAvg: analytics.kpis.dailyNerveAvg,
                kpis: {
                    totalNerve: analytics.kpis.totalNerve,
                    totalAttempts: analytics.kpis.totalAttempts,
                    successRate: Number(analytics.kpis.successRate.toFixed(1)),
                    critFailRate: Number(analytics.kpis.critFailRate.toFixed(1)),
                    totalNetProfit: Math.round(analytics.kpis.totalNetProfit),
                    totalCashGained: Math.round(analytics.kpis.totalCashGained || 0),
                    totalItemsGainedVal: Math.round(analytics.kpis.totalItemsGainedVal || 0),
                    avgProfitPerNerve: Math.round(analytics.kpis.avgProfitPerNerve)
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
        buildDiscordMarkdownSummary,
        buildCsvExport
    };
})(window);
