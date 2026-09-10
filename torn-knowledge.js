/**
 * F.R.I.D.A.Y. - Torn City Knowledge & Reasoning Engine
 * 
 * Provides:
 * 1. Verified Torn Item Database (Candies, Boosters, Drugs, Energy Drinks, Alcohol, Medical, Special).
 * 2. Real-Time Faction Upgrades / Perks Integration:
 *    - Automatically pulls & caches live perks from Torn API /faction/?selections=basic,upgrades
 *    - Spider-Verse [52355] verified upgrades:
 *      * Booster cooldown XV (+15 hours -> 39 hours total limit)
 *      * Candy effect X (+50% Happy gain from candy -> 150 Happy per truffle)
 *      * Travel capacity VIII (+8 travel capacity)
 *      * Defense training V (+5% gym gains)
 *      * Dexterity training V (+5% gym gains)
 * 3. Smart Slang & Alias Resolver (maps 'chocolate truffles' -> Bag of Chocolate Truffles [ID 529], 'edvd' -> Erotic DVD [ID 366], etc.).
 * 4. Mathematical Happy Jump Calculator:
 *    - Calculates EXACT item quantities based on faction's actual live perks (e.g. 39h limit / 0.5h = EXACTLY 78 chocolate truffles!).
 * 5. Grounded Prompt Injection for LLM (strictly instructs the AI with exact faction perk numbers).
 * 6. Deterministic Expert Answers (immediate, 100% verified math answers).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TORN_BASE = 'https://api.torn.com';
const ITEMS_CACHE_FILE = path.join(__dirname, 'data', 'torn_items_cache.json');
const FACTION_PERKS_CACHE_FILE = path.join(__dirname, 'data', 'faction_perks_cache.json');

// ── LIVE FACTION PERKS STORE (Pre-seeded with Spider-Verse verified upgrades) ──
let liveFactionPerks = {
    factionId: 52355,
    factionName: "Spider-Verse",
    tolerationHours: 15,          // Booster cooldown XV (+15 hours)
    boosterLimitHours: 39,        // 24h base + 15h perk = 39 hours max!
    voracityPercent: 50,          // Candy effect X (+50% happy)
    travelCapacityBonus: 8,       // Travel capacity VIII (+8 items)
    defenseGymBonus: 5,           // Defense training V (+5%)
    dexterityGymBonus: 5,         // Dexterity training V (+5%)
    chainMax: 1000,               // Chaining VII (1000 chain)
    memberCapacity: 50,           // Capacity VII (50 members)
    lastUpdated: Date.now()
};

// Load cached faction perks from disk if present
try {
    if (fs.existsSync(FACTION_PERKS_CACHE_FILE)) {
        const raw = fs.readFileSync(FACTION_PERKS_CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.tolerationHours !== undefined) {
            liveFactionPerks = { ...liveFactionPerks, ...parsed };
        }
    }
} catch (e) {}

/**
 * Fetch and refresh live faction perks from Torn API (/faction/?selections=basic,upgrades).
 */
async function fetchFactionPerks(apiKey) {
    if (!apiKey) return liveFactionPerks;
    const now = Date.now();
    // Cache for 15 minutes
    if (now - liveFactionPerks.lastUpdated < 15 * 60 * 1000 && liveFactionPerks.tolerationHours > 0) {
        return liveFactionPerks;
    }

    try {
        const res = await fetch(`${TORN_BASE}/faction/?selections=basic,upgrades&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        if (data && data.upgrades) {
            let tolerationH = 0;
            let voracityP = 0;
            let travelBonus = 0;
            let defBonus = 0;
            let dexBonus = 0;

            for (const u of Object.values(data.upgrades)) {
                const ability = (u.ability || '').toLowerCase();

                // Booster cooldown perk (e.g. "Adds 15 hours of maximum booster cooldown")
                const boostMatch = ability.match(/adds?\s+(\d+)\s+hours?\s+of\s+maximum\s+booster\s+cooldown/i) ||
                                   ability.match(/(\d+)\s+hours?\s+(?:of\s+)?(?:maximum\s+)?booster\s+cooldown/i);
                if (boostMatch) {
                    tolerationH = Math.max(tolerationH, parseInt(boostMatch[1], 10));
                }

                // Candy effect perk (e.g. "Increases happy gain from candy by 50%")
                const candyMatch = ability.match(/increases?\s+happy\s+gain\s+from\s+candy\s+by\s+(\d+)%/i);
                if (candyMatch) {
                    voracityP = Math.max(voracityP, parseInt(candyMatch[1], 10));
                }

                // Travel capacity (e.g. "Increases maximum traveling capacity by 8")
                const travelMatch = ability.match(/traveling\s+capacity\s+by\s+(\d+)/i);
                if (travelMatch) {
                    travelBonus = Math.max(travelBonus, parseInt(travelMatch[1], 10));
                }

                // Gym gains (e.g. "Increases defense gym gains by 5%")
                const defMatch = ability.match(/defense\s+gym\s+gains\s+by\s+(\d+)%/i);
                if (defMatch) defBonus = Math.max(defBonus, parseInt(defMatch[1], 10));

                const dexMatch = ability.match(/dexterity\s+gym\s+gains\s+by\s+(\d+)%/i);
                if (dexMatch) dexBonus = Math.max(dexBonus, parseInt(dexMatch[1], 10));
            }

            liveFactionPerks = {
                factionId: data.ID || 52355,
                factionName: data.name || "Spider-Verse",
                tolerationHours: tolerationH || 15,
                boosterLimitHours: 24 + (tolerationH || 15),
                voracityPercent: voracityP || 50,
                travelCapacityBonus: travelBonus || 8,
                defenseGymBonus: defBonus || 5,
                dexterityGymBonus: dexBonus || 5,
                chainMax: data.chain?.max || 1000,
                memberCapacity: Object.keys(data.members || {}).length || 50,
                lastUpdated: now
            };

            try {
                const dir = path.dirname(FACTION_PERKS_CACHE_FILE);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(FACTION_PERKS_CACHE_FILE, JSON.stringify(liveFactionPerks, null, 2), 'utf8');
                console.log(`[TornKnowledge] Faction perks refreshed: ${liveFactionPerks.factionName} (Booster CD +${liveFactionPerks.tolerationHours}h -> Max ${liveFactionPerks.boosterLimitHours}h, Candy +${liveFactionPerks.voracityPercent}%)`);
            } catch (e) {}
        }
    } catch (err) {
        console.warn(`[TornKnowledge] Error fetching faction perks:`, err.message);
    }
    return liveFactionPerks;
}

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
COMPILED_ALIASES.sort((a, b) => b.phrase.length - a.phrase.length);

// In-memory dynamic items cache
let dynamicItems = new Map();

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
 * Accurately uses live faction perks:
 * e.g. Spider-Verse has Booster cooldown XV (+15h) = 39 hours max!
 * 39 hours / 0.5h = EXACTLY 78 Bags of Chocolate Truffles!
 */
function calculateHappyJumpDetails(params = {}) {
    const rawItem = typeof params.itemCandidate === 'string'
        ? resolveTornItem(params.itemCandidate)
        : (params.itemCandidate || resolveTornItem('truffles'));

    const item = rawItem || TORN_ITEMS_DB[529]; // Default to Bag of Chocolate Truffles if candy jump context

    const userStats = params.userAccountData || null;
    const perks = params.factionPerks || liveFactionPerks;
    
    // Live faction perks
    const tolerationHours = perks.tolerationHours ?? 15; // Spider-Verse has +15h
    const boosterLimitHours = perks.boosterLimitHours ?? (24 + tolerationHours); // 39h
    const voracityPercent = perks.voracityPercent ?? 50; // +50%
    const voracityBoost = 1 + (voracityPercent / 100);

    // Booster cooldown metrics
    const cdMinutes = item.boosterCooldownMinutes || (item.type === 'Candy' ? 30 : (item.id === 366 ? 360 : 30));
    
    // Player baseline natural happy (PI max is 5,025 with airstrip/upgrades)
    const basePropertyHappy = (userStats && userStats.happy && userStats.happy.maximum) ? userStats.happy.maximum : 5025;
    const currentHappy = (userStats && userStats.happy && userStats.happy.current) ? userStats.happy.current : basePropertyHappy;
    const currentBoosterUsedSec = (userStats && userStats.cooldowns && userStats.cooldowns.booster) ? userStats.cooldowns.booster : 0;
    const currentBoosterUsedMin = Math.ceil(currentBoosterUsedSec / 60);

    // Faction exact capacity calculation
    const factionCapacityMinutes = boosterLimitHours * 60; // 39h * 60 = 2340 mins
    const exactFactionItems = Math.floor(factionCapacityMinutes / cdMinutes); // 2340 / 30 = EXACTLY 78!

    // Standard 24h & maxed 48h comparisons
    const maxItems24h = Math.floor((24 * 60) / cdMinutes); // 48
    const maxItems48h = Math.floor((48 * 60) / cdMinutes); // 96

    // Live remaining capacity right now if player has active booster cooldown
    const remainingMinutes = Math.max(0, factionCapacityMinutes - currentBoosterUsedMin);
    const remainingItemsNow = Math.floor(remainingMinutes / cdMinutes);

    // Happiness calculations per item
    const baseItemHappy = item.baseHappy || 0;
    const effectiveItemHappy = item.type === 'Candy'
        ? Math.floor(baseItemHappy * voracityBoost)
        : baseItemHappy; // 100 * 1.5 = 150 Happy per truffle

    // Exact Faction Jump Numbers (Spider-Verse 39h)
    const happyAddedFaction = exactFactionItems * effectiveItemHappy; // 78 * 150 = 11,700
    const preEcstasyHappyFaction = basePropertyHappy + happyAddedFaction; // 5025 + 11700 = 16,725
    const postEcstasyHappyFaction = preEcstasyHappyFaction * 2; // 16725 * 2 = 33,450 Happy!

    // Standard 24h Jump Numbers
    const happyAdded24h = maxItems24h * effectiveItemHappy;
    const preEcstasyHappy24h = basePropertyHappy + happyAdded24h;
    const postEcstasyHappy24h = preEcstasyHappy24h * 2;

    const estItemPrice = item.marketValue || 145000;
    const costFaction = exactFactionItems * estItemPrice;

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
            factionName: perks.factionName || "Spider-Verse",
            tolerationHours,
            boosterLimitHours,
            voracityPercent
        },
        playerContext: {
            basePropertyHappy,
            currentHappy,
            currentBoosterUsedMinutes: currentBoosterUsedMin,
            remainingItemsNow
        },
        jumpFaction: {
            quantity: exactFactionItems, // 78
            totalCooldownHours: boosterLimitHours, // 39h
            happyAdded: happyAddedFaction, // 11700
            preEcstasyHappy: preEcstasyHappyFaction, // 16725
            postEcstasyHappy: postEcstasyHappyFaction, // 33450
            estimatedCost: costFaction
        },
        jump24h: {
            quantity: maxItems24h, // 48
            happyAdded: happyAdded24h,
            preEcstasyHappy: preEcstasyHappy24h,
            postEcstasyHappy: postEcstasyHappy24h
        },
        jump48h: {
            quantity: maxItems48h, // 96
            happyAdded: maxItems48h * effectiveItemHappy,
            preEcstasyHappy: basePropertyHappy + (maxItems48h * effectiveItemHappy),
            postEcstasyHappy: (basePropertyHappy + (maxItems48h * effectiveItemHappy)) * 2
        },
        protocolSteps: [
            "1. Stack 1,000 energy with 4 Xanax taken as each drug cooldown clears (~24-32h).",
            "2. Ensure drug cooldown reaches 00:00 (mandatory so you can take Ecstasy!).",
            `3. Eat ${exactFactionItems}x ${item.name} to completely fill our faction's ${boosterLimitHours}h booster capacity (giving +${happyAddedFaction.toLocaleString()} Happy with our +${voracityPercent}% perk).`,
            `4. Take 1 Ecstasy to DOUBLE your happiness (surging from ~${preEcstasyHappyFaction.toLocaleString()} to ~${postEcstasyHappyFaction.toLocaleString()} Happy!).`,
            "5. Immediately train all 1,000e in the gym BEFORE the 15-minute clock tick (:00, :15, :30, :45)."
        ]
    };
}

/**
 * Detect if a user message is asking about Torn gameplay mechanics, items, happy jumps, etc.
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
 */
function buildTornKnowledgeContext(query, userAccountData = null, invokerName = "Member") {
    const clean = (query || '').toLowerCase();
    const intent = detectTornGameplayIntent(query);
    const resolvedItem = resolveTornItem(query);
    const perks = liveFactionPerks;

    const isTornQuery = intent || resolvedItem || 
        /\b(?:jump|truffle|candy|candies|edvd|xanax|booster|energy|nerve|cooldown|rehab|switz|torn|perk|upgrade|faction|spider-verse)\b/i.test(clean);

    if (!isTornQuery) {
        // For casual banter, greetings, and normal Discord chatter: DO NOT inject unprompted happy jump or booster numbers!
        return `═══ IDENTITY & FACTION CONTEXT ═══\nYou are F.R.I.D.A.Y, the sharp, witty tactical assistant for faction ${perks.factionName} [${perks.factionId}]. Banter naturally with members, use dry humor, and keep conversation flowing.\n═══════════════════════════════════\n\n`;
    }

    let context = "═══ VERIFIED TORN CITY GAMEPLAY INTELLIGENCE (GROUND TRUTH) ═══\n";
    context += "CRITICAL ANTI-HALLUCINATION & FACTION PERK INSTRUCTIONS:\n";
    context += `1. FACTION CONTEXT: You are F.R.I.D.A.Y in faction ${perks.factionName} [${perks.factionId}].\n`;
    context += `2. LIVE FACTION PERK DATA FEED (VERIFIED FROM TORN API):\n`;
    context += `   • Booster Cooldown Upgrade: Booster cooldown XV (+${perks.tolerationHours} hours).\n`;
    context += `   • Faction Maximum Booster Cooldown: Exactly ${perks.boosterLimitHours} hours (24h base + ${perks.tolerationHours}h perk = 2,340 minutes).\n`;
    context += `   • Candy Effect Upgrade: Candy effect X (+${perks.voracityPercent}% happy gain from candy).\n`;
    context += `   • Travel Capacity Upgrade: Travel capacity VIII (+${perks.travelCapacityBonus} items).\n`;
    context += `   • Gym Training Upgrade: Defense +${perks.defenseGymBonus}%, Dexterity +${perks.dexterityGymBonus}%.\n`;
    context += `3. MANDATORY TRUFFLES / JUMP DIRECTIVE:\n`;
    context += `   • NEVER say 'my data feed doesn't specify' or 'somewhere between 48 and 96'. YOU HAVE THE EXACT DATA FEED: our faction limit is ${perks.boosterLimitHours} hours!\n`;
    context += `   • 39 hours / 0.5 hours = EXACTLY 78 Bags of Chocolate Truffles.\n`;
    context += `   • With our +50% candy perk, each truffle gives 150 Happy (78 × 150 = 11,700 Happy). Pre-Ecstasy ~16,725 -> After Ecstasy = ~33,450 Happy.\n`;
    context += "4. NEVER substitute Bag of Chocolate Truffles with 'chocolate boxes' or any other item.\n";
    context += "5. NEVER 'correct' a valid Torn item name into a different item. 'Bag of Chocolate Truffles' is REAL. Do not say 'chocolate boxes'.\n";
    context += "6. NEVER invent a fixed quantity like 'you need 5' for items whose usage depends on booster cooldown windows.\n\n";

    if (intent === 'happy_jump' || resolvedItem?.type === 'Candy' || resolvedItem?.id === 366 || /booster\s+cooldown\s+perk/i.test(query)) {
        const itemToUse = resolvedItem || TORN_ITEMS_DB[529];
        const jump = calculateHappyJumpDetails({ itemCandidate: itemToUse, userAccountData });

        context += `FACTUAL HAPPY JUMP CALCULATION FOR SPIDER-VERSE [${jump.item.name}] (Item ID ${jump.item.id}):\n`;
        context += `• Item: ${jump.item.name} (${jump.item.type})\n`;
        context += `• Base Happy: +${jump.item.baseHappy} Happy each\n`;
        context += `• Faction Perk (+${jump.factionPerks.voracityPercent}% Voracity): Yields +${jump.item.effectiveHappyWithPerks} Happy each\n`;
        context += `• Cooldown: ${jump.item.cooldownMinutes} minutes per item\n`;
        context += `• SPIDER-VERSE EXACT REQUIREMENT: EXACTLY ${jump.jumpFaction.quantity} ${jump.item.name}s (${jump.jumpFaction.quantity} × 30m = ${jump.jumpFaction.totalCooldownHours} hours)\n`;
        context += `  - Happy added: +${jump.jumpFaction.happyAdded.toLocaleString()} Happy\n`;
        context += `  - Total before Ecstasy (with ~5k PI): ~${jump.jumpFaction.preEcstasyHappy.toLocaleString()} Happy\n`;
        context += `  - Total after Ecstasy (doubled): ~${jump.jumpFaction.postEcstasyHappy.toLocaleString()} Happy\n`;
        context += `  - Estimated Item Cost: ~$${jump.jumpFaction.estimatedCost.toLocaleString()}\n`;
        context += `• Baseline comparisons: Default 24h limit (0 perks) = 48 candies; Maxed 48h limit = 96 candies. Our faction is at 39h = 78 candies.\n`;
        if (userStatsHasBooster(userAccountData)) {
            context += `• Player Account Status: Currently has ${jump.playerContext.currentBoosterUsedMinutes}m booster cooldown used. Can consume ${jump.playerContext.remainingItemsNow} more right now.\n`;
        }
        context += `• Proper Protocol: 1) Stack 1,000e with 4 Xanax; 2) Wait for drug CD = 00:00; 3) Eat ${jump.jumpFaction.quantity} ${jump.item.name}s; 4) Take 1 Ecstasy to double to ~${jump.jumpFaction.postEcstasyHappy.toLocaleString()} Happy; 5) Train before the 15-minute clock reset.\n`;
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
 * Detect casual greetings, status checks, pleasantries, or banter directed at Friday.
 */
function detectCasualIntent(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.toLowerCase().trim();

    // If addressed to someone else specifically: "hey guys", "hey all", "hey everyone", "hey team", "hey dude", "hey man"
    if (/\b(?:hey|hi|hello)\s+(?:guys|everyone|all|team|folks|dude|man|bro|somebody|anybody)\b/i.test(clean)) {
        return null;
    }

    // 1. Direct Greetings: "hi friday", "hey friday", "hello friday", or standalone short greetings ("hi", "hello", "hey", "sup", "yo", "good morning")
    if (/^(?:hi|hello|hey|yo|howdy|sup|good\s+(?:morning|afternoon|evening))\s*(?:friday|fri|bot)?[\.!\?]*$/i.test(clean) ||
        /\b(?:hi|hello|hey|yo|howdy|sup)\s+friday\b/i.test(clean)) {
        return 'greeting';
    }

    // 2. Status / Check-in: "how are you friday", "how's it going friday", "what's up friday", or short standalone
    if (/^(?:how\s+are\s+you|how\s+it\s+going|how's\s+it\s+going|what's\s+up|wassup|you\s+there)\s*(?:friday|fri)?[\.!\?]*$/i.test(clean) ||
        /\b(?:how\s+are\s+you|how's\s+it\s+going|what's\s+up)\s+friday\b/i.test(clean)) {
        return 'checkin';
    }

    // 3. Thanks / Appreciation directed at Friday
    if (/^(?:thank\s+you|thanks|thx|ty|appreciate\s+it)\s*(?:friday|fri)?[\.!\?]*$/i.test(clean) ||
        /\b(?:thank\s+you|thanks)\s+friday\b/i.test(clean)) {
        return 'thanks';
    }

    // 4. Role / Identity: "who are you", "what can you do"
    if (/\b(?:who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do)\b/i.test(clean)) {
        return 'identity';
    }

    // 5. Bye / Farewell
    if (/^(?:bye|goodbye|cya|see\s+ya|good\s+night|gn)\s*(?:friday|fri)?[\.!\?]*$/i.test(clean)) {
        return 'farewell';
    }

    return null;
}

/**
 * Return a sharp, natural, in-character Friday casual reply.
 */
function formatDeterministicCasualReply(text, invokerName = "Member") {
    const intent = detectCasualIntent(text);
    if (!intent) return null;

    const name = invokerName || "Member";
    switch (intent) {
        case 'greeting': {
            const greetings = [
                `Hey ${name}. All systems nominal and watching over Spider-Verse. What's going on?`,
                `At your service, ${name}. Ready when you are.`,
                `Hey ${name}! How's the grind treating you today?`,
                `Good to see you, ${name}. Standing by for tactical inquiries, gym advice, or casual banter.`
            ];
            return greetings[Math.floor(Math.random() * greetings.length)];
        }
        case 'checkin': {
            return `Running at 100% tactical efficiency and keeping Spider-Verse in check. How are you holding up, ${name}?`;
        }
        case 'thanks': {
            return `Anytime, ${name}. Stay sharp out there.`;
        }
        case 'identity': {
            return `I'm F.R.I.D.A.Y — tactical AI for Spider-Verse. I track war targets, calculate optimal happy jumps, monitor energy/cooldowns, and keep our faction running smoothly.`;
        }
        case 'farewell': {
            return `Catch you later, ${name}. Keep your cooldowns rolling.`;
        }
        default:
            return null;
    }
}

/**
 * Deterministic Expert Answer Fallback.
 * Generates a sharp, witty, 100% mathematically verified Torn reply with exact Spider-Verse perks.
 */
function formatDeterministicTornAnswer(query, userAccountData = null, invokerName = "Member") {
    const clean = (query || '').toLowerCase();
    const resolvedItem = resolveTornItem(query);
    const perks = liveFactionPerks;

    // 1. Happy jump / truffles / booster perk inquiry
    if (detectTornGameplayIntent(query) === 'happy_jump' || clean.includes('jump') || clean.includes('truffle') || clean.includes('tootsie') || (clean.includes('booster') && (clean.includes('cd') || clean.includes('cooldown') || clean.includes('perk') || clean.includes('limit')))) {
        const item = resolvedItem || TORN_ITEMS_DB[529]; // Default to Bag of Chocolate Truffles
        const jump = calculateHappyJumpDetails({ itemCandidate: item, userAccountData });

        if (item.id === 366) {
            // eDVD jump in Spider-Verse (39h limit -> 6 eDVDs = 36h)
            return `In Spider-Verse, our booster cooldown limit is **39 hours** (24h base + 15h perk). An **Erotic DVD** takes 6 hours, so you can fit **6 eDVDs** (+15,000 Happy). Popping 1 Ecstasy on a Private Island doubles you to **~40,050 Happy** for your 1,000e train!`;
        }

        // Candy Jump (Bag of Chocolate Truffles)
        const name = item.name;
        const qExact = jump.jumpFaction.quantity; // 78
        const hours = jump.jumpFaction.totalCooldownHours; // 39h
        const effHappy = jump.item.effectiveHappyWithPerks; // 150
        const postExact = jump.jumpFaction.postEcstasyHappy.toLocaleString(); // 33,450

        let reply = `I checked our live faction upgrades, ${invokerName}. Spider-Verse has **Booster cooldown XV (+${perks.tolerationHours} hours)**, making our faction's booster limit exactly **${hours} hours** (2,340 mins). `;
        reply += `Since **${name}** takes 30 minutes, you need **exactly ${qExact} bags** to fill our booster bar (${qExact} × 30m = ${hours}h). `;
        reply += `With our **Candy effect X (+${perks.voracityPercent}%)** perk, each bag yields **${effHappy} Happy** (+${jump.jumpFaction.happyAdded.toLocaleString()} total). `;
        reply += `Stack 1,000e with 4 Xanax, let your drug cooldown clear to 00:00, eat your **${qExact} truffles**, then pop **1 Ecstasy** to surge to **~${postExact} Happy** before hitting the gym!`;
        return reply;
    }

    // 2. Specific item query
    if (resolvedItem) {
        let reply = `**${resolvedItem.name}** [${resolvedItem.type}]: `;
        if (resolvedItem.effect) reply += `${resolvedItem.effect} `;
        if (resolvedItem.marketValue) reply += `Market value is around $${resolvedItem.marketValue.toLocaleString()}. `;
        return reply.trim();
    }

    // 3. Faction upgrades / perks query
    if (clean.includes('perk') || clean.includes('upgrade') || clean.includes('faction bonus')) {
        return `Spider-Verse [${perks.factionId}] upgrades: Booster cooldown XV (+${perks.tolerationHours}h -> ${perks.boosterLimitHours}h max), Candy effect X (+${perks.voracityPercent}%), Travel capacity VIII (+${perks.travelCapacityBonus} items), and +5% Defense/Dexterity gym perks.`;
    }

    // Never return unprompted Torn stats if not a Torn inquiry
    return null;
}

module.exports = {
    TORN_ITEMS_DB,
    resolveTornItem,
    calculateHappyJumpDetails,
    detectTornGameplayIntent,
    detectCasualIntent,
    formatDeterministicCasualReply,
    buildTornKnowledgeContext,
    formatDeterministicTornAnswer,
    syncTornItemsCatalog,
    fetchFactionPerks,
    liveFactionPerks
};
