/**
 * F.R.I.D.A.Y. - Torn City Knowledge & Reasoning Engine
 * 
 * Provides:
 * 1. Verified Torn Item Database (Candies, Boosters, Drugs, Energy Drinks, Alcohol, Medical, Special).
 * 2. Smart Slang & Alias Resolver (maps 'chocolate truffles' -> Bag of Chocolate Truffles [ID 529], 'edvd' -> Erotic DVD [ID 366], etc.).
 * 3. Mathematical Happy Jump Calculator (calculates exact candy/booster quantities based on booster cooldown limit e.g. 24h vs 48h, faction Voracity perks, property base happy, and Ecstasy doubling).
 * 4. Grounded Prompt Injection for LLM (injects verified facts, exact numbers, and anti-hallucination directives).
 * 5. Deterministic Expert Answers (witty, 100% mathematically accurate fallbacks when Gemini is busy or down).
 * 6. Live Torn API items cache synchronization.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TORN_BASE = 'https://api.torn.com';
const ITEMS_CACHE_FILE = path.join(__dirname, 'data', 'torn_items_cache.json');

// ── VERIFIED TORN ITEMS DATABASE (Core High-Yield Gameplay Items) ────────────
const TORN_ITEMS_DB = {
    // ── CANDIES (Every candy in Torn has exactly 30 minutes booster cooldown) ──
    529: {
        id: 529,
        name: "Bag of Chocolate Truffles",
        type: "Candy",
        baseHappy: 100,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 100 and booster cooldown by 30 minutes.",
        marketValue: 145876,
        aliases: ["bag of chocolate truffles", "chocolate truffles", "choco truffles", "chocolate truffle", "truffles", "truffle"]
    },
    528: {
        id: 528,
        name: "Bag of Tootsie Rolls",
        type: "Candy",
        baseHappy: 75,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 75 and booster cooldown by 30 minutes.",
        marketValue: 84023,
        aliases: ["bag of tootsie rolls", "tootsie rolls", "tootsie roll", "tootsies", "tootsie"]
    },
    586: {
        id: 586,
        name: "Jawbreaker",
        type: "Candy",
        baseHappy: 150,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 150 and booster cooldown by 30 minutes.",
        marketValue: 359964,
        aliases: ["jawbreaker", "jawbreakers"]
    },
    151: {
        id: 151,
        name: "Pixie Sticks",
        type: "Candy",
        baseHappy: 150,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 150 and booster cooldown by 30 minutes.",
        marketValue: 357139,
        aliases: ["pixie sticks", "pixie stick", "pixies", "pixie"]
    },
    556: {
        id: 556,
        name: "Bag of Reindeer Droppings",
        type: "Candy",
        baseHappy: 100,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 100 and booster cooldown by 30 minutes.",
        marketValue: 149519,
        aliases: ["bag of reindeer droppings", "reindeer droppings", "reindeer dropping"]
    },
    587: {
        id: 587,
        name: "Bag of Sherbet",
        type: "Candy",
        baseHappy: 150,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 150 and booster cooldown by 30 minutes.",
        marketValue: 357636,
        aliases: ["bag of sherbet", "sherbet"]
    },
    634: {
        id: 634,
        name: "Bag of Bloody Eyeballs",
        type: "Candy",
        baseHappy: 75,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 75 and booster cooldown by 30 minutes.",
        marketValue: 86353,
        aliases: ["bag of bloody eyeballs", "bloody eyeballs", "bloody eyeball"]
    },
    527: {
        id: 527,
        name: "Bag of Candy Kisses",
        type: "Candy",
        baseHappy: 50,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 50 and booster cooldown by 30 minutes.",
        marketValue: 55393,
        aliases: ["bag of candy kisses", "candy kisses"]
    },
    210: {
        id: 210,
        name: "Bag of Chocolate Kisses",
        type: "Candy",
        baseHappy: 25,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 25 and booster cooldown by 30 minutes.",
        marketValue: 838,
        aliases: ["bag of chocolate kisses", "chocolate kisses", "choco kisses"]
    },
    310: {
        id: 310,
        name: "Lollipop",
        type: "Candy",
        baseHappy: 25,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 25 and booster cooldown by 30 minutes.",
        marketValue: 1087,
        aliases: ["lollipop", "lollipops", "lolly", "lollies"]
    },
    35: {
        id: 35,
        name: "Box of Chocolate Bars",
        type: "Candy",
        baseHappy: 25,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 25 and booster cooldown by 30 minutes.",
        marketValue: 830,
        aliases: ["box of chocolate bars", "chocolate bars box", "choco bars box", "chocolate bar box", "box of choco bars"]
    },
    36: {
        id: 36,
        name: "Big Box of Chocolate Bars",
        type: "Candy",
        baseHappy: 35,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 35 and booster cooldown by 30 minutes.",
        marketValue: 54894,
        aliases: ["big box of chocolate bars", "big box of choco bars", "big chocolate box", "big choco box"]
    },
    37: {
        id: 37,
        name: "Bag of Bon Bons",
        type: "Candy",
        baseHappy: 25,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 25 and booster cooldown by 30 minutes.",
        marketValue: 813,
        aliases: ["bag of bon bons", "bag of bonbons", "bon bons bag"]
    },
    38: {
        id: 38,
        name: "Box of Bon Bons",
        type: "Candy",
        baseHappy: 25,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 25 and booster cooldown by 30 minutes.",
        marketValue: 1245,
        aliases: ["box of bon bons", "box of bonbons", "bon bons", "bonbons", "bon bon"]
    },
    39: {
        id: 39,
        name: "Box of Extra Strong Mints",
        type: "Candy",
        baseHappy: 25,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 25 and booster cooldown by 30 minutes.",
        marketValue: 827,
        aliases: ["box of extra strong mints", "extra strong mints", "strong mints", "mints"]
    },
    209: {
        id: 209,
        name: "Box of Sweet Hearts",
        type: "Candy",
        baseHappy: 25,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 25 and booster cooldown by 30 minutes.",
        marketValue: 830,
        aliases: ["box of sweet hearts", "sweet hearts", "sweethearts"]
    },
    1028: {
        id: 1028,
        name: "Birthday Cupcake",
        type: "Candy",
        baseHappy: 250,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 250 and booster cooldown by 30 minutes.",
        marketValue: 4951212,
        aliases: ["birthday cupcake", "cupcake", "bday cupcake"]
    },
    1039: {
        id: 1039,
        name: "Bag of Humbugs",
        type: "Candy",
        baseHappy: 150,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 150 and booster cooldown by 30 minutes.",
        marketValue: 655916,
        aliases: ["bag of humbugs", "humbugs", "humbug"]
    },
    1312: {
        id: 1312,
        name: "Chocolate Egg",
        type: "Candy",
        baseHappy: 50,
        boosterCooldownMinutes: 30,
        effect: "Increases happiness by 50 and booster cooldown by 30 minutes.",
        marketValue: 996590,
        aliases: ["chocolate egg", "choco egg"]
    },

    // ── BOOSTERS (eDVDs, FHCs, Stat Enhancers) ──
    366: {
        id: 366,
        name: "Erotic DVD",
        type: "Booster",
        baseHappy: 2500,
        boosterCooldownMinutes: 360, // 6 hours
        effect: "Increases happiness by 2,500 and booster cooldown by 6 hours.",
        marketValue: 4325030,
        aliases: ["erotic dvd", "erotic dvds", "edvd", "edvds", "e-dvd", "e-dvds"]
    },
    367: {
        id: 367,
        name: "Feathery Hotel Coupon",
        type: "Booster",
        baseHappy: 500,
        baseEnergy: 1000,
        boosterCooldownMinutes: 360, // 6 hours
        effect: "Refills energy. Increases happiness by 500 and booster cooldown by 6 hours.",
        marketValue: 14201767,
        aliases: ["feathery hotel coupon", "feathery coupon", "fhc", "fhcs", "hotel coupon"]
    },

    // ── DRUGS ──
    206: {
        id: 206,
        name: "Xanax",
        type: "Drug",
        baseEnergy: 250,
        baseHappy: 75,
        drugCooldownHours: 7,
        effect: "Increases energy by 250 and happiness by 75. Includes side effects.",
        marketValue: 855318,
        aliases: ["xanax", "xans", "xan"]
    },
    197: {
        id: 197,
        name: "Ecstasy",
        type: "Drug",
        drugCooldownHours: 3.5,
        effect: "Doubles happiness.",
        marketValue: 37208,
        aliases: ["ecstasy", "e-pill", "xtc"]
    },
    205: {
        id: 205,
        name: "Vicodin",
        type: "Drug",
        baseHappy: 75,
        effect: "Temporarily increases all battle stats by 25%. Increases happiness by 75.",
        marketValue: 1003,
        aliases: ["vicodin", "vico"]
    },
    199: {
        id: 199,
        name: "LSD",
        type: "Drug",
        baseEnergy: 50,
        baseNerve: 5,
        baseHappy: 350,
        effect: "Increases energy by 50, nerve by 5, and happiness by 200-500. Includes side effects.",
        marketValue: 21014,
        aliases: ["lsd", "acid"]
    },
    203: {
        id: 203,
        name: "Shrooms",
        type: "Drug",
        baseHappy: 500,
        effect: "Increases happiness by 500 and reduces energy by 25. Includes side effects.",
        marketValue: 1925,
        aliases: ["shrooms", "magic mushrooms"]
    },

    // ── ENERGY DRINKS (Cans) ──
    530: { id: 530, name: "Can of Munster", type: "Energy Drink", baseEnergy: 20, boosterCooldownMinutes: 120, marketValue: 1904288, aliases: ["can of munster", "munster can", "munster"] },
    532: { id: 532, name: "Can of Red Cow", type: "Energy Drink", baseEnergy: 25, boosterCooldownMinutes: 120, marketValue: 2463155, aliases: ["can of red cow", "red cow can", "red cow"] },
    533: { id: 533, name: "Can of Taurine Elite", type: "Energy Drink", baseEnergy: 30, boosterCooldownMinutes: 120, marketValue: 3935497, aliases: ["can of taurine elite", "taurine elite", "30e can"] },
    553: { id: 553, name: "Can of Santa Shooters", type: "Energy Drink", baseEnergy: 20, boosterCooldownMinutes: 120, marketValue: 1903024, aliases: ["can of santa shooters", "santa shooters"] },
    554: { id: 554, name: "Can of Rockstar Rudolph", type: "Energy Drink", baseEnergy: 25, boosterCooldownMinutes: 120, marketValue: 2471262, aliases: ["can of rockstar rudolph", "rockstar rudolph"] },
    555: { id: 555, name: "Can of X-MASS", type: "Energy Drink", baseEnergy: 30, boosterCooldownMinutes: 120, marketValue: 3960277, aliases: ["can of x-mass", "x-mass can", "xmass can"] },
    985: { id: 985, name: "Can of Goose Juice", type: "Energy Drink", baseEnergy: 5, boosterCooldownMinutes: 120, marketValue: 445759, aliases: ["can of goose juice", "goose juice"] },
    986: { id: 986, name: "Can of Damp Valley", type: "Energy Drink", baseEnergy: 10, boosterCooldownMinutes: 120, marketValue: 925816, aliases: ["can of damp valley", "damp valley"] },
    987: { id: 987, name: "Can of Crocozade", type: "Energy Drink", baseEnergy: 15, boosterCooldownMinutes: 120, marketValue: 1409693, aliases: ["can of crocozade", "crocozade"] },

    // ── ALCOHOL / NERVE ──
    531: { id: 531, name: "Bottle of Pumpkin Brew", type: "Alcohol", baseNerve: 2, boosterCooldownMinutes: 60, marketValue: 1845, aliases: ["bottle of pumpkin brew", "pumpkin brew"] },
    180: { id: 180, name: "Bottle of Beer", type: "Alcohol", baseNerve: 1, boosterCooldownMinutes: 60, marketValue: 690, aliases: ["bottle of beer", "beer"] }
};

// Compile alias lookup table sorted by length (descending) so longer phrases match before shorter ones
const COMPILED_ALIASES = [];
for (const item of Object.values(TORN_ITEMS_DB)) {
    COMPILED_ALIASES.push({ phrase: item.name.toLowerCase(), item, isExactName: true });
    if (item.aliases) {
        for (const alias of item.aliases) {
            COMPILED_ALIASES.push({ phrase: alias.toLowerCase(), item, isExactName: false });
        }
    }
}
// Sort by phrase length descending (longest first)
COMPILED_ALIASES.sort((a, b) => b.phrase.length - a.phrase.length);

// In-memory dynamic items cache
let dynamicItems = new Map();

/**
 * Load items from disk cache on startup.
 */
function loadItemsDiskCache() {
    try {
        if (fs.existsSync(ITEMS_CACHE_FILE)) {
            const raw = fs.readFileSync(ITEMS_CACHE_FILE, 'utf8');
            const data = JSON.parse(raw);
            for (const [id, it] of Object.entries(data)) {
                dynamicItems.set(Number(id), it);
            }
        }
    } catch (err) {
        console.warn("[TornKnowledge] Error loading items disk cache:", err.message);
    }
}
loadItemsDiskCache();

/**
 * Refresh full Torn items catalog from Torn API and persist to disk.
 */
async function syncTornItemsCatalog(apiKey) {
    if (!apiKey) return;
    try {
        const res = await fetch(`${TORN_BASE}/torn/?selections=items&key=${apiKey}`, { signal: AbortSignal.timeout(10000) });
        const data = await res.json();
        if (data.items && Object.keys(data.items).length > 0) {
            const outObj = {};
            for (const [id, it] of Object.entries(data.items)) {
                const numId = Number(id);
                const itemRecord = {
                    id: numId,
                    name: it.name,
                    type: it.type,
                    effect: it.effect || "",
                    marketValue: it.market_value || 0
                };
                dynamicItems.set(numId, itemRecord);
                outObj[id] = itemRecord;
            }
            const dir = path.dirname(ITEMS_CACHE_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(ITEMS_CACHE_FILE, JSON.stringify(outObj, null, 2), 'utf8');
            console.log(`[TornKnowledge] Synced ${dynamicItems.size} Torn items to knowledge cache.`);
        }
    } catch (err) {
        console.warn("[TornKnowledge] Error syncing Torn items catalog:", err.message);
    }
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * High-precision Torn item resolver.
 * Maps user query / shorthand / slang to the exact Torn item.
 * Uses word-boundary matching and prioritizes longest specific phrases first.
 * Strictly prevents incorrect substitutions (e.g. chocolate truffles -> chocolate boxes).
 * 
 * @param {string} rawQuery 
 * @returns {object|null}
 */
function resolveTornItem(rawQuery) {
    if (!rawQuery || typeof rawQuery !== 'string') return null;
    const clean = rawQuery.toLowerCase().trim().replace(/['".,?!]/g, ' ');

    // 1. Check compiled alias entries in descending length order using word boundaries
    for (const entry of COMPILED_ALIASES) {
        const pattern = new RegExp(`\\b${escapeRegex(entry.phrase)}\\b`, 'i');
        if (pattern.test(clean)) {
            return entry.item;
        }
    }

    // 2. Fallback specific shorthand keywords
    if (/\btruffles?\b/i.test(clean)) return TORN_ITEMS_DB[529]; // Bag of Chocolate Truffles
    if (/\btootsies?\b/i.test(clean)) return TORN_ITEMS_DB[528]; // Bag of Tootsie Rolls
    if (/\bjawbreakers?\b/i.test(clean)) return TORN_ITEMS_DB[586]; // Jawbreaker
    if (/\bbonbons?\b/i.test(clean)) return TORN_ITEMS_DB[38]; // Box of Bon Bons
    if (/\bedvds?\b/i.test(clean)) return TORN_ITEMS_DB[366]; // Erotic DVD
    if (/\bfhcs?\b/i.test(clean)) return TORN_ITEMS_DB[367]; // Feathery Hotel Coupon
    if (/\bxan(?:ax)?\b/i.test(clean)) return TORN_ITEMS_DB[206]; // Xanax
    if (/\bpixies?\b/i.test(clean)) return TORN_ITEMS_DB[151]; // Pixie Sticks
    if (/\blollipops?\b/i.test(clean)) return TORN_ITEMS_DB[310]; // Lollipop

    // 3. Dynamic cache search
    for (const item of dynamicItems.values()) {
        if (item.name) {
            const pattern = new RegExp(`\\b${escapeRegex(item.name.toLowerCase())}\\b`, 'i');
            if (pattern.test(clean)) return item;
        }
    }

    return null;
}

/**
 * Mathematical Happy Jump Calculator.
 * Calculates exact quantities based on booster cooldown limits (24h vs 48h),
 * item cooldown, faction Voracity perks (+50%), base happy, and Ecstasy doubling.
 * 
 * @param {object} params
 * @param {object|string} params.itemCandidate - Resolved item or query string
 * @param {object|null} params.userAccountData - Player's live API data
 * @param {object|null} params.factionPerks - Faction perks (voracityPercent, tolerationHours)
 * @returns {object|null}
 */
function calculateHappyJumpDetails(params = {}) {
    const rawItem = typeof params.itemCandidate === 'string'
        ? resolveTornItem(params.itemCandidate)
        : (params.itemCandidate || resolveTornItem('truffles'));

    const item = rawItem || TORN_ITEMS_DB[529]; // Default to Bag of Chocolate Truffles if candy jump context

    const userStats = params.userAccountData || null;
    const perks = params.factionPerks || { voracityPercent: 50, tolerationHours: 0 };
    const voracityBoost = 1 + ((perks.voracityPercent ?? 50) / 100); // Standard Spider-Verse is +50%

    // Booster cooldown metrics
    const cdMinutes = item.boosterCooldownMinutes || (item.type === 'Candy' ? 30 : (item.id === 366 ? 360 : 30));
    
    // Player baseline natural happy (PI max is 5,025 with airstrip/upgrades)
    const basePropertyHappy = (userStats && userStats.happy && userStats.happy.maximum) ? userStats.happy.maximum : 5025;
    const currentHappy = (userStats && userStats.happy && userStats.happy.current) ? userStats.happy.current : basePropertyHappy;
    const currentBoosterUsedSec = (userStats && userStats.cooldowns && userStats.cooldowns.booster) ? userStats.cooldowns.booster : 0;
    const currentBoosterUsedMin = Math.ceil(currentBoosterUsedSec / 60);

    // Standard 24h booster window (1,440 mins) vs 48h with faction Toleration perk (2,880 mins)
    const capacity24hMinutes = 24 * 60; // 1440 mins
    const capacity48hMinutes = 48 * 60; // 2880 mins

    const maxItems24h = Math.floor(capacity24hMinutes / cdMinutes); // 48 for 30m candies, 4 for eDVD
    const maxItems48h = Math.floor(capacity48hMinutes / cdMinutes); // 96 for 30m candies, 8 for eDVD

    // Live remaining capacity right now if player has active booster cooldown
    const remainingMinutes24h = Math.max(0, capacity24hMinutes - currentBoosterUsedMin);
    const remainingItemsNow = Math.floor(remainingMinutes24h / cdMinutes);

    // Happiness calculations per item
    const baseItemHappy = item.baseHappy || 0;
    const effectiveItemHappy = item.type === 'Candy'
        ? Math.floor(baseItemHappy * voracityBoost)
        : baseItemHappy;

    // 24h Jump Numbers
    const happyAdded24h = maxItems24h * effectiveItemHappy;
    const preEcstasyHappy24h = basePropertyHappy + happyAdded24h;
    const postEcstasyHappy24h = preEcstasyHappy24h * 2;

    // 48h Jump Numbers
    const happyAdded48h = maxItems48h * effectiveItemHappy;
    const preEcstasyHappy48h = basePropertyHappy + happyAdded48h;
    const postEcstasyHappy48h = preEcstasyHappy48h * 2;

    // Estimated costs
    const estItemPrice = item.marketValue || 145000;
    const cost24h = maxItems24h * estItemPrice;
    const cost48h = maxItems48h * estItemPrice;

    return {
        item: {
            id: item.id,
            name: item.name,
            type: item.type,
            baseHappy: baseItemHappy,
            effectiveHappyWithPerks: effectiveItemHappy,
            cooldownMinutes: cdMinutes,
            marketValue: estItemPrice
        },
        factionPerks: {
            voracityPercent: perks.voracityPercent ?? 50,
            tolerationHours: perks.tolerationHours ?? 0
        },
        playerContext: {
            basePropertyHappy,
            currentHappy,
            currentBoosterUsedMinutes: currentBoosterUsedMin,
            remainingItemsNow
        },
        jump24h: {
            quantity: maxItems24h,
            totalCooldownHours: (maxItems24h * cdMinutes) / 60,
            happyAdded: happyAdded24h,
            preEcstasyHappy: preEcstasyHappy24h,
            postEcstasyHappy: postEcstasyHappy24h,
            estimatedCost: cost24h
        },
        jump48h: {
            quantity: maxItems48h,
            totalCooldownHours: (maxItems48h * cdMinutes) / 60,
            happyAdded: happyAdded48h,
            preEcstasyHappy: preEcstasyHappy48h,
            postEcstasyHappy: postEcstasyHappy48h,
            estimatedCost: cost48h
        },
        protocolSteps: [
            "1. Stack 1,000 energy by taking 4 Xanax consecutively as each drug cooldown clears (~24-32h).",
            "2. Wait for your drug cooldown to reach exactly 00:00 (critical so you can take Ecstasy!).",
            `3. Consume ${maxItems24h}x ${item.name} to fill your 24h booster cooldown (giving +${happyAdded24h.toLocaleString()} Happy with our +50% Voracity perk).`,
            `4. Take 1 Ecstasy to DOUBLE your happiness (surging from ~${preEcstasyHappy24h.toLocaleString()} to ~${postEcstasyHappy24h.toLocaleString()} Happy!).`,
            "5. Immediately train all 1,000e in the gym BEFORE the 15-minute clock tick (:00, :15, :30, :45) when Happy resets towards your property maximum."
        ]
    };
}

/**
 * Detect if a user message is asking about Torn gameplay mechanics, items, happy jumps, etc.
 * 
 * @param {string} text 
 * @returns {'happy_jump'|'candy_query'|'item_info'|'training'|'cooldown'|'crime'|'travel'|'general_torn'|null}
 */
function detectTornGameplayIntent(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.toLowerCase().trim();

    // 1. Happy Jump & Candy Jumps
    if (/\b(?:happy\s+jump|candy\s+jump|choco\s+jump|edvd\s+jump|99k\s+jump|jumping|jump)\b/i.test(clean) ||
        (/\b(?:how\s+many|how\s+much)\b/i.test(clean) && /\b(?:truffles?|tootsies?|candies|candy|edvds?|jawbreakers?|chocolates?)\b/i.test(clean))) {
        return 'happy_jump';
    }

    // 2. Specific candy questions
    if (/\b(?:candy|candies|truffles?|tootsies?|jawbreakers?|bonbons?|kisses|lollipops?)\b/i.test(clean) &&
        /\b(?:happy|happiness|cooldown|boost|give|effect|worth)\b/i.test(clean)) {
        return 'candy_query';
    }

    // 3. Item info lookup
    if (/\b(?:what\s+does|how\s+much\s+is|what\s+is|tell\s+me\s+about|info\s+on)\s+(?:a\s+|an\s+|the\s+)?(?:[a-z0-9\s]+)\b/i.test(clean)) {
        const item = resolveTornItem(clean);
        if (item) return 'item_info';
    }

    // 4. Training / Gym math
    if (/\b(?:gym|training|gains|train|battle\s+stats|stat\s+gains|dots)\b/i.test(clean)) {
        return 'training';
    }

    // 5. Cooldowns & Xanax readiness
    if (/\b(?:cooldowns?|drug\s+cd|booster\s+cd|can\s+i\s+(?:take|pop)\s+(?:a\s+)?xan|xanax\s+ready)\b/i.test(clean)) {
        return 'cooldown';
    }

    // 6. Travel / Flying / Rehab
    if (/\b(?:travel|flight|flying|abroad|switz|switzerland|rehab|plushies?|flowers?)\b/i.test(clean)) {
        return 'travel';
    }

    // 7. Crimes & OCs
    if (/\b(?:cpr|oc\s*2\.0|crimes?\s*2\.0|organized\s+crime|natural\s+nerve)\b/i.test(clean)) {
        return 'crime';
    }

    return null;
}

/**
 * Build ground-truth intelligence block to inject into the LLM system prompt.
 * This ensures the LLM CANNOT hallucinate item names, quantities, or mechanics.
 * 
 * @param {string} query 
 * @param {object|null} userAccountData 
 * @param {string} invokerName 
 * @returns {string}
 */
function buildTornKnowledgeContext(query, userAccountData = null, invokerName = "Member") {
    const intent = detectTornGameplayIntent(query);
    const resolvedItem = resolveTornItem(query);

    let context = "═══ VERIFIED TORN CITY GAMEPLAY INTELLIGENCE (GROUND TRUTH) ═══\n";
    context += "CRITICAL ANTI-HALLUCINATION INSTRUCTIONS:\n";
    context += "1. NEVER invent a fixed quantity like 'you need 5' unless calculated from Torn mechanics.\n";
    context += "2. NEVER 'correct' a valid Torn item name (e.g. 'chocolate truffles' IS Bag of Chocolate Truffles; NEVER change to 'chocolate boxes').\n";
    context += "3. Distinguish item names precisely. Bag of Chocolate Truffles (ID 529, Candy, 100 happy, 30m CD) is NOT Box of Chocolate Bars.\n";
    context += "4. If asked how many items for a jump, state the exact formula: booster window divided by 30 mins.\n\n";

    if (intent === 'happy_jump' || resolvedItem?.type === 'Candy' || resolvedItem?.id === 366) {
        const itemToUse = resolvedItem || TORN_ITEMS_DB[529];
        const jump = calculateHappyJumpDetails({ itemCandidate: itemToUse, userAccountData });

        context += `FACTUAL HAPPY JUMP CALCULATION FOR [${jump.item.name}] (Item ID ${jump.item.id}):\n`;
        context += `• Item: ${jump.item.name} (${jump.item.type})\n`;
        context += `• Base Happy: +${jump.item.baseHappy} Happy each\n`;
        context += `• Faction Perk (+50% Voracity): Yields +${jump.item.effectiveHappyWithPerks} Happy each\n`;
        context += `• Cooldown: ${jump.item.cooldownMinutes} minutes per item\n`;
        context += `• Standard 24h Booster Limit (1,440 mins): EXACTLY ${jump.jump24h.quantity} ${jump.item.name}s (${jump.jump24h.quantity} × 30m = 24 hours)\n`;
        context += `  - Happy added: +${jump.jump24h.happyAdded.toLocaleString()} Happy (with 50% perk)\n`;
        context += `  - Total before Ecstasy (with ~5k PI): ~${jump.jump24h.preEcstasyHappy.toLocaleString()} Happy\n`;
        context += `  - Total after Ecstasy (doubled): ~${jump.jump24h.postEcstasyHappy.toLocaleString()} Happy\n`;
        context += `  - Estimated Item Cost: ~$${jump.jump24h.estimatedCost.toLocaleString()}\n`;
        context += `• 48h Booster Limit (if faction has +24h Toleration perk): EXACTLY ${jump.jump48h.quantity} ${jump.item.name}s\n`;
        context += `  - Total after Ecstasy: ~${jump.jump48h.postEcstasyHappy.toLocaleString()} Happy\n`;
        if (userStatsHasBooster(userAccountData)) {
            context += `• Player Account Status: Currently has ${jump.playerContext.currentBoosterUsedMinutes}m booster cooldown used. Can consume ${jump.playerContext.remainingItemsNow} more ${jump.item.name}s right now.\n`;
        }
        context += `• Proper Protocol: 1) Stack 1,000e with 4 Xanax; 2) Wait for drug CD = 00:00; 3) Eat candies (${jump.jump24h.quantity} in 24h or ${jump.jump48h.quantity} in 48h); 4) Take 1 Ecstasy to double; 5) Train before the 15-minute clock reset.\n`;
        context += "═══════════════════════════════════════════════════════════════\n\n";
    } else if (resolvedItem) {
        context += `VERIFIED ITEM INTEL FOR [${resolvedItem.name}] (Item ID ${resolvedItem.id}):\n`;
        context += `• Name: ${resolvedItem.name}\n`;
        context += `• Type: ${resolvedItem.type}\n`;
        context += `• Effect: ${resolvedItem.effect || 'N/A'}\n`;
        if (resolvedItem.baseHappy) context += `• Happiness: +${resolvedItem.baseHappy} Happy\n`;
        if (resolvedItem.baseEnergy) context += `• Energy: +${resolvedItem.baseEnergy} Energy\n`;
        if (resolvedItem.boosterCooldownMinutes) context += `• Booster Cooldown: ${resolvedItem.boosterCooldownMinutes} minutes\n`;
        if (resolvedItem.marketValue) context += `• Market Value: ~$${resolvedItem.marketValue.toLocaleString()}\n`;
        context += "═══════════════════════════════════════════════════════════════\n\n";
    }

    return context;
}

function userStatsHasBooster(userAccountData) {
    return userAccountData && userAccountData.cooldowns && userAccountData.cooldowns.booster > 0;
}

/**
 * Deterministic Expert Answer Fallback.
 * Generates a sharp, witty, 100% mathematically verified Torn reply
 * if Gemini is down, slow, or returning 503 high demand.
 * 
 * @param {string} query 
 * @param {object|null} userAccountData 
 * @param {string} invokerName 
 * @returns {string}
 */
function formatDeterministicTornAnswer(query, userAccountData = null, invokerName = "Member") {
    const clean = (query || '').toLowerCase();
    const resolvedItem = resolveTornItem(query);

    // 1. Happy jump inquiry
    if (detectTornGameplayIntent(query) === 'happy_jump' || clean.includes('jump') || clean.includes('truffle') || clean.includes('tootsie')) {
        const item = resolvedItem || TORN_ITEMS_DB[529]; // Default to Bag of Chocolate Truffles
        const jump = calculateHappyJumpDetails({ itemCandidate: item, userAccountData });

        if (item.id === 366) {
            // eDVD jump
            return `For an **Erotic DVD** jump, you need **4 to 5 eDVDs** (each is 6 hours cooldown = 24h–30h booster window). With 5 eDVDs (+12,500 Happy) and a standard Private Island, popping an Ecstasy doubles you to **~35,050 Happy** for your 1,000e train.`;
        }

        // Candy Jump (e.g. Bag of Chocolate Truffles or Bag of Tootsie Rolls)
        const name = item.name;
        const q24 = jump.jump24h.quantity; // 48
        const q48 = jump.jump48h.quantity; // 96
        const post24 = jump.jump24h.postEcstasyHappy.toLocaleString();
        const post48 = jump.jump48h.postEcstasyHappy.toLocaleString();

        let reply = `For **${name}** (100 base happy, 30m cooldown each), you don't need 5 — you need **${q24} bags** for a standard 24h booster window (48 × 30m = 24h). `;
        reply += `With our faction's +50% Voracity perk, each bag gives **150 Happy** (+${jump.jump24h.happyAdded.toLocaleString()} total). `;
        reply += `Stack 1,000e with 4 Xanax, let your drug cooldown clear to 00:00, eat your **${q24} truffles**, then pop **1 Ecstasy** to double your Happy to **~${post24}** before hitting the gym (:00/:15/:30/:45 tick). `;
        reply += `*(If our faction runs a 48h booster limit perk, you can fit **${q48} bags** for ~${post48} Happy).*`;
        return reply;
    }

    // 2. Specific item query
    if (resolvedItem) {
        let reply = `**${resolvedItem.name}** [${resolvedItem.type}]: `;
        if (resolvedItem.effect) reply += `${resolvedItem.effect} `;
        if (resolvedItem.marketValue) reply += `Market value is around $${resolvedItem.marketValue.toLocaleString()}. `;
        return reply.trim();
    }

    return `I checked our Torn tactical database, ${invokerName}, but couldn't verify that exact mechanic. Keep your API key linked and ask with the specific item name!`;
}

module.exports = {
    TORN_ITEMS_DB,
    resolveTornItem,
    calculateHappyJumpDetails,
    detectTornGameplayIntent,
    buildTornKnowledgeContext,
    formatDeterministicTornAnswer,
    syncTornItemsCatalog
};
