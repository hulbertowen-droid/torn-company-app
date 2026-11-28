'use strict';

/**
 * F.R.I.D.A.Y. — Hybrid Authoritative Torn Wiki & Multi-Forum RAG Engine
 *
 * Architecture:
 *   Tier 1 (Authoritative Core Wiki Corpus, weight 1.38x): Canonical section-split current-meta
 *          Torn Wiki guides (Stock_Market [Stocks 3.0], Chain/Attacking, Gym/Happy, Companies,
 *          Drugs/Boosters, Cracking, Crimes 2.0) — zero legacy 1.0/2.0 bleed, <5ms lookup.
 *   Tier 1A (Official Torn API Encyclopedia, weight 1.25x): Live-synced items, stocks,
 *          companies, gyms, educations, properties, merits, and Crimes 2.0 metadata.
 *   Tier 2 (Chunked Torn Forum Guides, weight 1.00x): Full OP + continuation posts split with
 *          header-aware overlapping semantic windows (500-800 tokens, 100-150 token overlap),
 *          cached to disk for fast <10ms hybrid retrieval across long guides (e.g. thread 16373016).
 *   Hybrid Scorer & Gate:
 *     Okapi BM25 + IDF-weighted unigram/bigram Cosine Similarity + Phrase Reranker, gated by
 *     MIN_CHUNK_SCORE >= 0.75 and legacy exclusion filter. Unrelated threads can NEVER pass.
 *     Each surviving chunk carries an explicit [SRC-k] ID for downstream citation verification.
 */

const fs = require('fs');
const path = require('path');
const { CORE_TORN_WIKI_PAGES, isLegacyOrDeprecatedSource } = require('./torn-core-wiki-corpus');

const ENCYCLOPEDIA_CACHE_FILE = path.join(__dirname, 'data', 'torn_encyclopedia_cache.json');
const FORUM_INDEX_CACHE_FILE = path.join(__dirname, 'data', 'torn_forum_guides_index.json');
const FORUM_CHUNKS_CACHE_FILE = path.join(__dirname, 'data', 'torn_forum_guide_chunks.json');

const EVIDENCE_TTL_MS = 30 * 60 * 1000;
const FORUM_CHUNK_TTL_MS = 7 * 24 * 3600 * 1000;
const MIN_CHUNK_SCORE = 0.75;
const LOCAL_SKIP_SEARCH_THRESHOLD = 0.80;

const evidenceCache = new Map();

let encyclopedia = {
    lastSynced: 0,
    itemsByName: new Map(),
    itemsList: [],
    gyms: [],
    companies: [],
    educations: [],
    stocks: [],
    properties: [],
    merits: [],
    crimesV2: []
};

let forumIndex = {
    lastSynced: 0,
    threads: []
};

// Cached full-text chunked forum guides: Map<threadId, { fetchedAt, title, url, fullText, chunks }>
let forumGuideChunksCache = new Map();

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
    'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
    'does', 'do', 'did', 'done', 'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
    'have', 'has', 'had', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must',
    'to', 'in', 'on', 'at', 'of', 'by', 'up', 'my', 'me', 'it', 'its', 'as', 'no', 'so', 'go',
    'us', 'we', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'you', 'your', 'our',
    'for', 'from', 'with', 'without', 'into', 'onto', 'about', 'above', 'below', 'under', 'over',
    'between', 'per', 'via', 'vs', 'versus', 'give', 'gives', 'get', 'gets', 'got', 'make', 'makes',
    'take', 'takes', 'use', 'uses', 'used', 'using', 'put', 'putt', 'need', 'needs', 'want', 'keep',
    'lose', 'let', 'wont', 'won', 'dont', 'don', 'cant', 'ill', 'ive', 'im', 'youre',
    'best', 'good', 'better', 'much', 'many', 'most', 'more', 'less', 'some', 'any', 'all', 'also',
    'tell', 'know', 'explain', 'question', 'please', 'friday', 'hey', 'hi', 'torn', 'city', 'game',
    'work', 'works', 'worth', 'way', 'long', 'far', 'till', 'until', 'fast', 'drop', 'right', 'actually'
]);

const TORN_DOMAIN_SHORT_TOKENS = new Set([
    'an', 'pi', 'oc', 'cs', 'ce', 'ff', 'jp', 'od', 'cd', 'xp', 'hp', 'rw',
    'sym', 'tci', 'fhg', 'fhc', 'mcs', 'msc', 'prn', 'wsu', 'wlt', 'lsc', 'mun', 'hrg', 'tch', 'sys', 'tcp', 'evl', 'bag', 'cnc', 'msg',
    'psu', 'cpu', 'gpu', 'dvd', 'fan', '99k', '60k', '50%', '65%', '1%', '2x', '3x', '10*', '10★'
]);

const KEY_PHRASES = [
    'adult novelties', 'erotic dvd', 'happy jump', '99k', '60k', 'private island', 'fitness center',
    'opportunity cost', 'job point', 'job points', "george's gym", 'georges gym',
    'chain bonus', 'bonus hit', 'bonus hits', 'overseas bonus', 'fair fight', 'flat respect', 'retaliation',
    'stock market', 'stocks 3.0', 'share increment', 'share increments', 'doubling', 'unclaimed dividend', 'unclaimed', 'passive',
    'cracking', 'cooling fan', 'cooling fans', 'power supply', 'psu', 'chassis', '50% heat', '65% heat', '1% per minute', 'heat decay', 'locked',
    'drug cooldown', 'booster cooldown', 'crimes 2.0', 'pickpocketing', 'office chair', 'cut-throat razor'
];

// Core Torn Forum guides worth auto-indexing when a Torn key is present
const CURATED_CORE_FORUM_GUIDES = [
    16373016, // [Crimes 2.0] Cracking: An In-Depth Guide (Emforus)
    16287997, // Happy Jump guide
    16047184, // Happy Jump / Training guide
    16336034  // Crimes 2.0 guides
];

function stripHtmlPreservingHeaders(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
        .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n## $1\n')
        .replace(/\[(?:b|size=[^\]]+|color=[^\]]+)\]([^[\n]{4,80})\[\/(?:b|size|color)\]/gi, '\n## $1\n')
        .replace(/<(?:b|strong)>\s*([^<\n]{4,80})\s*<\/(?:b|strong)>\s*(?:<br\s*\/?>|\n)/gi, '\n## $1\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<li>/gi, '\n• ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\[quote[^\]]*\][\s\S]*?\[\/quote\]/gi, ' ')
        .replace(/\[\/?[a-z0-9=*#,\s"'-]+\]/gi, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function tokenizeForSearch(text) {
    const low = String(text || '').toLowerCase()
        .replace(/e-?dvds?/g, 'edvd')
        .replace(/10\s*[★*]\s*an\b/g, '10* an adult novelties');
    const rawTokens = low
        .replace(/[^a-z0-9%★*+.-]+/g, ' ')
        .split(/\s+/)
        .map(t => t.replace(/^[.-]+|[.-]+$/g, ''))
        .filter(Boolean);

    const tokens = [];
    for (const tok of rawTokens) {
        if (TORN_DOMAIN_SHORT_TOKENS.has(tok)) {
            tokens.push(tok);
            continue;
        }
        if (tok.length < 3 || STOP_WORDS.has(tok)) continue;
        tokens.push(tok);
        // Light morphological stem so plural/verb forms match (fans->fan, increments->increment, cools->cool)
        if (tok.endsWith('s') && tok.length >= 5 && !tok.endsWith('ss')) {
            tokens.push(tok.slice(0, -1));
        } else if (tok.endsWith('ing') && tok.length >= 6) {
            tokens.push(tok.slice(0, -3));
        }
    }
    return [...new Set(tokens)];
}

function tokenizeListWithFreq(text) {
    const low = String(text || '').toLowerCase()
        .replace(/e-?dvds?/g, 'edvd')
        .replace(/10\s*[★*]\s*an\b/g, '10* an adult novelties');
    const rawTokens = low
        .replace(/[^a-z0-9%★*+.-]+/g, ' ')
        .split(/\s+/)
        .map(t => t.replace(/^[.-]+|[.-]+$/g, ''))
        .filter(Boolean);

    const tf = new Map();
    let len = 0;
    for (const tok of rawTokens) {
        if (!TORN_DOMAIN_SHORT_TOKENS.has(tok) && (tok.length < 3 || STOP_WORDS.has(tok))) continue;
        tf.set(tok, (tf.get(tok) || 0) + 1);
        len++;
        if (tok.endsWith('s') && tok.length >= 5 && !tok.endsWith('ss')) {
            const stem = tok.slice(0, -1);
            tf.set(stem, (tf.get(stem) || 0) + 0.7);
        }
    }
    return { tf, len: Math.max(1, len) };
}

function extractSearchKeywords(query) {
    return tokenizeForSearch(query);
}

function isPurePersonalAccountQuery(query) {
    const low = String(query || '').toLowerCase().trim();
    const mentionsPersonal = /\b(?:i|my|me|mine|till i|until i|how many hits|how many attempts)\b/.test(low);
    const mentionsMechanicsRule = /\b(?:formula|does .* stack|does .* apply|why won't|why does|how fast|per minute|compare|vs|versus|opportunity cost|temporary|permanent|stocks?\s*3\.0|increment|unclaimed|overseas bonus|chain bonus|chassis|psu|cool(?:ing)? fan|happy jump|10\s*[*★]\s*an|adult novelties)\b/i.test(low);
    if (!mentionsPersonal || mentionsMechanicsRule) return false;
    return /\b(?:hits?\s+(?:till|until)\s+i\s+level|level\s+up\s+in\s+(?:pickpocket|shoplift|crack|burglar|graffiti|bootleg|skim|hustl|dispos|forg|scam|arson|search)|my\s+(?:energy|nerve|happy|life|cooldown|drug|booster|med|merits?|stats?|battlestats?|workstats?|refills?|money|cash|vault|education|job|cs|crime skill))\b/i.test(low);
}

function needsWikiOrForumLookup(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim();
    if (clean.length < 4) return false;
    const low = clean.toLowerCase();

    if (/^(?:hi|hey|hello|yo|sup|thanks|thank\s+you|ty|thx|gn|good\s+(?:morning|night|evening)|lol|lmao|nice|cool|ok|okay)\s*(?:friday|fri)?[!.,?]*$/i.test(low)) {
        return false;
    }

    // Personal-account telemetry questions should go straight to Torn API tools with 0ms RAG delay
    if (isPurePersonalAccountQuery(clean)) {
        return false;
    }

    const hasQuestionCue = /\?|^(?:what|how|why|when|where|which|who|can|does|do|is|are|should|would|tell\s+me|explain|compare)\b/i.test(clean);
    const hasTornTopic = /\b(?:torn|wiki|forum|gym|train|happy|jump|xanax|edvd|e-dvd|fhc|booster|drug|overdose|od|rehab|addiction|nerve|crime|crimes|oc|organized\s+crime|cpr|burglary|shoplifting|pickpocketing|skimming|bootlegging|graffiti|hustling|disposal|cracking|chassis|psu|cooling|heat|forgery|scamming|arson|search\s+for\s+cash|merit|honor|medal|education|course|stock|stocks|sym|tci|fhg|wsu|wlt|mcs|prn|increment|unclaimed|dividend|block|bank|apr|company|adult\s+novelties|fitness\s+center|director|special|job\s+point|property|private\s+island|vault|bazaar|item\s+market|mug|hosp|hospital|revive|blood\s+bag|morphine|stat\s+enhancer|skateboard|parachute|boxing\s+gloves|dumbbells|book|travel|airstrip|plushie|flower|museum|point|ranked\s+war|rw|cache|fair\s+fight|ff|retal|chain|respect|abroad|overseas|stealth|dexterity|defense|strength|speed|baldr|armor|weapon|bonus|ammo|racing|poker|casino|russian\s+roulette|bounty|jail|bust|bail|faction|steadfast|voracity|toleration|excursion)\b/i.test(low);

    return Boolean(hasTornTopic || (hasQuestionCue && clean.split(/\s+/).length >= 4));
}

// ── Header-Aware Overlapping Chunker (500-800 tokens, 100-150 token overlap) ──
function chunkTextHeaderAware(docTitle, rawText, options = {}) {
    const clean = stripHtmlPreservingHeaders(rawText);
    if (!clean) return [];

    // ~4 chars/token -> target 500-750 tokens (~2,000-2,900 chars), overlap 125 tokens (~500 chars)
    const maxChars = options.maxChars || 2600;
    const overlapChars = options.overlapChars || 500;
    const minChunkChars = options.minChunkChars || 180;

    // Split into header-delimited sections first
    const lines = clean.split('\n');
    const sections = [];
    let currentHeader = 'Overview';
    let buffer = [];

    for (const line of lines) {
        const trimmed = line.trim();
        const headerMatch = trimmed.match(/^##\s+(.+)$/) ||
            (/^[A-Z0-9][A-Z0-9\s:&/()-]{5,55}$/.test(trimmed) && !/[.!?]$/.test(trimmed) ? [null, trimmed] : null);
        if (headerMatch) {
            if (buffer.length > 0) {
                sections.push({ header: currentHeader, body: buffer.join('\n').trim() });
                buffer = [];
            }
            currentHeader = headerMatch[1].trim();
        } else if (trimmed) {
            buffer.push(trimmed);
        }
    }
    if (buffer.length > 0) {
        sections.push({ header: currentHeader, body: buffer.join('\n').trim() });
    }

    const chunks = [];
    for (const sec of sections) {
        if (!sec.body || sec.body.length < 40) continue;
        if (sec.body.length <= maxChars) {
            chunks.push({
                header: sec.header,
                text: `[${docTitle} > ${sec.header}]\n${sec.body}`
            });
            continue;
        }

        // Slide overlapping semantic windows along paragraph/sentence boundaries
        let start = 0;
        while (start < sec.body.length) {
            let end = Math.min(sec.body.length, start + maxChars);
            if (end < sec.body.length) {
                const breakIdx = Math.max(
                    sec.body.lastIndexOf('\n', end),
                    sec.body.lastIndexOf('. ', end)
                );
                if (breakIdx > start + Math.floor(maxChars * 0.55)) {
                    end = breakIdx + 1;
                }
            }
            const slice = sec.body.slice(start, end).trim();
            if (slice.length >= minChunkChars || chunks.length === 0) {
                chunks.push({
                    header: sec.header,
                    text: `[${docTitle} > ${sec.header}]\n${slice}`
                });
            }
            if (end >= sec.body.length) break;
            start = Math.max(start + 400, end - overlapChars);
        }
    }

    return chunks;
}

// ── LAYER 1: Official Torn API Encyclopedia Sync & Exact Matcher ─────────────
function hydrateEncyclopediaFromObject(parsed) {
    if (!parsed || typeof parsed !== 'object') return;
    encyclopedia.lastSynced = parsed.lastSynced || 0;
    encyclopedia.itemsList = Array.isArray(parsed.itemsList) ? parsed.itemsList : [];
    encyclopedia.itemsByName = new Map(encyclopedia.itemsList.map(it => [it.name.toLowerCase(), it]));
    encyclopedia.gyms = Array.isArray(parsed.gyms) ? parsed.gyms : [];
    encyclopedia.companies = Array.isArray(parsed.companies) ? parsed.companies : [];
    encyclopedia.educations = Array.isArray(parsed.educations) ? parsed.educations : [];
    encyclopedia.stocks = Array.isArray(parsed.stocks) ? parsed.stocks : [];
    encyclopedia.properties = Array.isArray(parsed.properties) ? parsed.properties : [];
    encyclopedia.merits = Array.isArray(parsed.merits) ? parsed.merits : [];
    encyclopedia.crimesV2 = Array.isArray(parsed.crimesV2) ? parsed.crimesV2 : [];
}

try {
    if (fs.existsSync(ENCYCLOPEDIA_CACHE_FILE)) {
        hydrateEncyclopediaFromObject(JSON.parse(fs.readFileSync(ENCYCLOPEDIA_CACHE_FILE, 'utf8')));
    }
    if (fs.existsSync(FORUM_INDEX_CACHE_FILE)) {
        const rawIdx = JSON.parse(fs.readFileSync(FORUM_INDEX_CACHE_FILE, 'utf8'));
        if (rawIdx && Array.isArray(rawIdx.threads)) forumIndex = rawIdx;
    }
    if (fs.existsSync(FORUM_CHUNKS_CACHE_FILE)) {
        const rawChunks = JSON.parse(fs.readFileSync(FORUM_CHUNKS_CACHE_FILE, 'utf8'));
        if (rawChunks && typeof rawChunks === 'object') {
            for (const [tid, entry] of Object.entries(rawChunks)) {
                if (entry && Array.isArray(entry.chunks)) {
                    forumGuideChunksCache.set(Number(tid), entry);
                }
            }
        }
    }
} catch (_) {}

function persistForumChunksCache() {
    try {
        const dir = path.dirname(FORUM_CHUNKS_CACHE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const obj = {};
        for (const [tid, entry] of forumGuideChunksCache.entries()) {
            obj[tid] = entry;
        }
        fs.writeFileSync(FORUM_CHUNKS_CACHE_FILE, JSON.stringify(obj), 'utf8');
    } catch (_) {}
}

let syncInFlight = null;
async function ensureTornEncyclopediaSynced(tornApiKey) {
    if (!tornApiKey) return;
    const now = Date.now();
    if (encyclopedia.itemsList.length > 500 && (now - encyclopedia.lastSynced) < 6 * 3600 * 1000) {
        return;
    }
    if (syncInFlight) return syncInFlight;

    syncInFlight = (async () => {
        try {
            const [v1Data, v2CrimesData] = await Promise.all([
                fetch(`https://api.torn.com/torn/?selections=items,gyms,companies,education,properties,stocks&key=${encodeURIComponent(tornApiKey)}`, {
                    signal: AbortSignal.timeout(14000)
                }).then(r => r.json()).catch(() => null),
                fetch(`https://api.torn.com/v2/torn/crimes?key=${encodeURIComponent(tornApiKey)}`, {
                    signal: AbortSignal.timeout(8000)
                }).then(r => r.json()).catch(() => null)
            ]);

            if (!v1Data || v1Data.error) return;

            const itemsList = Object.entries(v1Data.items || {}).map(([id, it]) => ({
                id: Number(id),
                name: it.name || '',
                type: it.type || '',
                weaponType: it.weapon_type || null,
                effect: (it.effect || '').trim(),
                requirement: (it.requirement || '').trim(),
                description: (it.description || '').slice(0, 260).trim(),
                buyPrice: Number(it.buy_price || 0),
                sellPrice: Number(it.sell_price || 0),
                marketValue: Number(it.market_value || 0),
                damage: it.coverage ? null : (it.damage ?? null),
                accuracy: it.accuracy ?? null,
                armor: it.armor ?? null
            })).filter(it => it.name);

            const gyms = Object.entries(v1Data.gyms || {}).map(([id, g]) => ({
                id: Number(id),
                name: g.name || '',
                stage: g.stage,
                cost: g.cost,
                energy: g.energy,
                strength: g.strength,
                speed: g.speed,
                defense: g.defense,
                dexterity: g.dexterity,
                note: g.note || ''
            }));

            const companies = Object.entries(v1Data.companies || {}).map(([id, c]) => ({
                id: Number(id),
                name: c.name || '',
                cost: c.cost,
                specials: Object.entries(c.specials || {}).map(([sName, sp]) => ({
                    name: sName,
                    rating: sp.rating_required,
                    cost: sp.cost,
                    effect: sp.effect
                }))
            }));

            const educations = Object.entries(v1Data.education || {}).map(([id, ed]) => ({
                id: Number(id),
                name: ed.name || '',
                code: ed.code || '',
                moneyCost: ed.money_cost,
                tier: ed.tier,
                durationSec: ed.duration,
                results: ed.results || {},
                prerequisites: ed.prerequisites || []
            }));

            const stocks = Object.entries(v1Data.stocks || {}).map(([id, st]) => ({
                id: Number(id),
                name: st.name || '',
                acronym: st.acronym || '',
                currentPrice: st.current_price,
                benefit: st.benefit || null
            }));

            const properties = Object.entries(v1Data.properties || {}).map(([id, pr]) => ({
                id: Number(id),
                name: pr.name || '',
                cost: pr.cost,
                happy: pr.happy,
                upkeep: pr.upkeep,
                upgradesAvailable: pr.upgrades_available || []
            }));

            const merits = Object.entries(v1Data.merits || {}).map(([id, m]) => ({
                id: Number(id),
                name: m.name || '',
                description: m.description || ''
            }));

            const crimesV2 = Array.isArray(v2CrimesData?.crimes) ? v2CrimesData.crimes : encyclopedia.crimesV2;

            const snapshotObj = {
                lastSynced: Date.now(),
                itemsList,
                gyms,
                companies,
                educations,
                stocks,
                properties,
                merits,
                crimesV2
            };
            hydrateEncyclopediaFromObject(snapshotObj);

            try {
                const dir = path.dirname(ENCYCLOPEDIA_CACHE_FILE);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(ENCYCLOPEDIA_CACHE_FILE, JSON.stringify(snapshotObj), 'utf8');
            } catch (_) {}
        } finally {
            syncInFlight = null;
        }
    })();

    return syncInFlight;
}

function lookupEncyclopediaFacts(query) {
    const qLow = String(query || '').toLowerCase();
    const kws = extractSearchKeywords(query);
    if (!qLow) return [];

    const facts = [];

    // 1. Exact / Phrase Item Matches
    const matchedItems = [];
    for (const it of encyclopedia.itemsList) {
        const nm = it.name.toLowerCase();
        const bareTitle = nm.startsWith('book :') ? nm.replace(/^book\s*:\s*/, '').trim() : nm;
        const wordRx = bareTitle.length >= 4 ? new RegExp(`\\b${bareTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null;
        if ((wordRx && wordRx.test(qLow)) || (nm.length >= 6 && qLow.includes(nm))) {
            matchedItems.push({ it, score: bareTitle.length + 25 });
        } else if (bareTitle.length >= 6 && kws.length >= 2) {
            const hits = kws.filter(k => k.length >= 4 && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(bareTitle)).length;
            if (hits >= 2) matchedItems.push({ it, score: hits * 4 });
        }
    }
    matchedItems.sort((a, b) => b.score - a.score);
    for (const { it } of matchedItems.slice(0, 4)) {
        const parts = [`**${it.name}** [ID ${it.id}, Type: ${it.type}${it.weaponType ? `/${it.weaponType}` : ''}]`];
        if (it.effect) parts.push(`Effect: ${it.effect}`);
        if (it.requirement) parts.push(`Requirement: ${it.requirement}`);
        if (it.damage !== null && it.damage !== undefined) parts.push(`Dmg: ${it.damage}, Acc: ${it.accuracy}`);
        if (it.armor !== null && it.armor !== undefined) parts.push(`Armor: ${it.armor}`);
        if (it.marketValue > 0) parts.push(`Market Value: $${it.marketValue.toLocaleString()}`);
        if (it.description && !it.effect) parts.push(`Desc: ${it.description}`);
        facts.push({
            title: `Torn Wiki: ${it.name}`,
            url: `https://wiki.torn.com/wiki/${encodeURIComponent(it.name.replace(/\s+/g, '_'))}`,
            text: parts.join(' | '),
            score: 0.88
        });
    }

    // 2. Stock Benefit Blocks
    for (const st of encyclopedia.stocks) {
        const acr = st.acronym.toLowerCase();
        const nm = st.name.toLowerCase();
        const acrRegex = acr ? new RegExp(`\\b${acr}\\b`, 'i') : null;
        if ((acrRegex && acrRegex.test(query)) || (nm.length >= 5 && qLow.includes(nm))) {
            const b = st.benefit;
            const reqShares = Number(b?.requirement || 0);
            const blockCost = reqShares && st.currentPrice ? `$${Math.round(reqShares * st.currentPrice).toLocaleString()}` : 'N/A';
            facts.push({
                title: `Torn Wiki: Stock Market (${st.acronym})`,
                url: 'https://wiki.torn.com/wiki/Stock_Market',
                text: `**Stock: ${st.name} (${st.acronym})** — Price: $${st.currentPrice} | Increment 1 Requirement: ${reqShares.toLocaleString()} shares (~${blockCost}) | Benefit (${b?.type || 'passive'}, ${b?.frequency || 0}d): ${b?.description || 'N/A'}`,
                score: 0.92
            });
        }
    }

    // 3. Company Specials & Types
    for (const comp of encyclopedia.companies) {
        const nm = comp.name.toLowerCase();
        const hitSpecial = comp.specials.find(sp => sp.name.length >= 5 && qLow.includes(sp.name.toLowerCase()));
        if ((nm.length >= 4 && new RegExp(`\\b${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(qLow)) || hitSpecial) {
            const spText = comp.specials
                .map(sp => `${sp.rating}★ ${sp.name} (${sp.cost ? `${sp.cost} JP` : 'Passive'}: ${sp.effect})`)
                .join(' ; ');
            facts.push({
                title: `Torn Wiki: ${comp.name}`,
                url: `https://wiki.torn.com/wiki/${encodeURIComponent(comp.name.replace(/\s+/g, '_'))}`,
                text: `**Company: ${comp.name}** — Specials: ${spText}`,
                score: 0.91
            });
        }
    }

    // 4. Gyms
    for (const g of encyclopedia.gyms) {
        const nm = g.name.toLowerCase();
        if (nm.length >= 5 && qLow.includes(nm.replace(/'/g, ''))) {
            facts.push({
                title: `Torn Wiki: Gym (${g.name})`,
                url: 'https://wiki.torn.com/wiki/Gym',
                text: `**Gym: ${g.name}** (Stage ${g.stage}, ${g.energy}E/click, Unlock $${(g.cost || 0).toLocaleString()}) — Dots: STR ${(g.strength / 10).toFixed(1)}, SPD ${(g.speed / 10).toFixed(1)}, DEF ${(g.defense / 10).toFixed(1)}, DEX ${(g.dexterity / 10).toFixed(1)}${g.note ? ` | Note: ${g.note}` : ''}`,
                score: 0.90
            });
        } else if (nm.includes('george') && /george/i.test(qLow)) {
            facts.push({
                title: `Torn Wiki: Gym (${g.name})`,
                url: 'https://wiki.torn.com/wiki/Gym',
                text: `**Gym: ${g.name}** (Stage ${g.stage}, ${g.energy}E/click, Unlock $${(g.cost || 0).toLocaleString()}) — Dots: STR ${(g.strength / 10).toFixed(1)}, SPD ${(g.speed / 10).toFixed(1)}, DEF ${(g.defense / 10).toFixed(1)}, DEX ${(g.dexterity / 10).toFixed(1)}. Gym unlocks and experience are permanent once unlocked.`,
                score: 0.90
            });
        }
    }

    // 5. Crimes 2.0 Official Metadata
    for (const cr of encyclopedia.crimesV2) {
        const nm = (cr.name || '').toLowerCase();
        if (nm && qLow.includes(nm)) {
            facts.push({
                title: `Torn Wiki: ${cr.name}`,
                url: `https://wiki.torn.com/wiki/${encodeURIComponent(cr.name.replace(/\s+/g, '_'))}`,
                text: `**Crimes 2.0: ${cr.name}** — Category: ${cr.category_name} | Enhancer Item: ${cr.enhancer_name} [ID ${cr.enhancer_id}] (+5% CE/CS gain) | Official Unique Outcomes: ${cr.unique_outcomes_count}`,
                score: 0.89
            });
        }
    }

    return facts.slice(0, 6);
}

function lookupEncyclopediaMatches(query) {
    const facts = lookupEncyclopediaFacts(query);
    if (!facts.length) return '';
    return `═══ TIER 1A: OFFICIAL TORN API ENCYCLOPEDIA DATA (100% CANONICAL) ═══\n${facts.map(f => `• ${f.text}`).join('\n')}\n═════════════════════════════════════════════════════════════════════\n\n`;
}

// ── LAYER 2: Torn Forum Guides Index & Multi-Post Semantic Chunker ──────────
let forumSyncInFlight = null;
async function ensureForumGuidesIndexSynced(tornApiKey) {
    if (!tornApiKey) return;
    const now = Date.now();
    if (forumIndex.threads.length > 200 && (now - forumIndex.lastSynced) < 6 * 3600 * 1000) {
        return;
    }
    if (forumSyncInFlight) return forumSyncInFlight;

    forumSyncInFlight = (async () => {
        try {
            const walkForumPages = async (fid, fname, maxPages) => {
                const collected = [];
                let toParam = '';
                for (let p = 0; p < maxPages; p++) {
                    const url = `https://api.torn.com/v2/forum/${fid}/threads?limit=100&sort=DESC${toParam}&key=${encodeURIComponent(tornApiKey)}`;
                    const j = await fetch(url, { signal: AbortSignal.timeout(6500) }).then(r => r.json()).catch(() => null);
                    const arr = j?.threads || [];
                    if (!arr.length) break;
                    for (const t of arr) {
                        collected.push({
                            id: Number(t.id),
                            title: t.title || '',
                            forumId: fid,
                            forumName: fname,
                            rating: Number(t.rating || 0),
                            posts: Number(t.posts || 0),
                            views: Number(t.views || 0),
                            isSticky: Boolean(t.is_sticky),
                            author: t.author?.username || 'Player',
                            karma: Number(t.author?.karma || 0),
                            firstPostTime: Number(t.first_post_time || 0)
                        });
                    }
                    const prevLink = j?._metadata?.links?.prev || '';
                    const mTo = prevLink.match(/[?&]to=(\d+)/);
                    if (!mTo) break;
                    toParam = `&to=${mTo[1]}`;
                }
                return collected;
            };

            const batches = await Promise.all([
                walkForumPages(61, 'Tutorials & Guides', 5),
                walkForumPages(3, 'Questions & Answers', 2),
                walkForumPages(1, 'Announcements', 1)
            ]);
            const mergedMap = new Map();
            for (const t of forumIndex.threads) mergedMap.set(t.id, t);
            for (const list of batches) {
                for (const t of list) mergedMap.set(t.id, t);
            }
            forumIndex = {
                lastSynced: Date.now(),
                threads: [...mergedMap.values()]
            };
            try {
                const dir = path.dirname(FORUM_INDEX_CACHE_FILE);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(FORUM_INDEX_CACHE_FILE, JSON.stringify(forumIndex), 'utf8');
            } catch (_) {}
        } finally {
            forumSyncInFlight = null;
        }
    })();

    return forumSyncInFlight;
}

function findMatchingForumThreadIds(query, extraThreadIds = []) {
    const allowLegacy = /\b(?:stocks?\s*2\.0|crimes?\s*1\.0|old\s+crimes)\b/i.test(query || '');
    const kws = extractSearchKeywords(query);
    const qLow = String(query || '').toLowerCase();

    const ids = [];
    for (const rawId of extraThreadIds) {
        const tid = Number(rawId);
        if (tid > 1000 && !ids.includes(tid)) ids.push(tid);
    }

    if (kws.length > 0 && forumIndex.threads.length > 0) {
        const scored = [];
        for (const t of forumIndex.threads) {
            const titleLow = (t.title || '').toLowerCase();
            if (!allowLegacy && isLegacyOrDeprecatedSource(t.title, '', '')) continue;
            // Require strictly Tutorials & Guides (f=61) or Announcements (f=1) unless Q&A exact match
            if (t.forumId !== 61 && t.forumId !== 1 && kws.length < 3) continue;

            let wordHits = 0;
            let matchedDistinctKws = 0;
            for (const kw of kws) {
                const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Strictly word-boundary matching so "at" NEVER matches "Patch" and "on" NEVER matches "weapons"!
                const rx = new RegExp(`\\b${escaped}(?:s|ing)?\\b`, 'i');
                if (rx.test(titleLow)) {
                    matchedDistinctKws++;
                    wordHits += (kw.length >= 5 ? 2.5 : 1.5);
                }
            }

            // Require at least 2 distinct keyword boundary hits (or exact single long keyword) BEFORE any quality boost!
            const minRequired = kws.length === 1 ? 1 : Math.min(2, kws.length);
            if (matchedDistinctKws >= minRequired && wordHits >= 2.0) {
                let phraseBoost = 0;
                for (const ph of KEY_PHRASES) {
                    if (qLow.includes(ph) && titleLow.includes(ph)) phraseBoost += 5;
                }
                const qualityBoost = (t.forumId === 61 ? 2.0 : 0) + Math.min(2.0, Math.log10((t.rating || 1) + 1));
                scored.push({ id: t.id, score: wordHits * 3 + phraseBoost + qualityBoost });
            }
        }
        scored.sort((a, b) => b.score - a.score);
        for (const s of scored.slice(0, 3)) {
            if (ids.length >= 3) break;
            if (!ids.includes(s.id)) ids.push(s.id);
        }
    }
    return ids.slice(0, 3);
}

/**
 * Fetch and semantically chunk a forum guide thread (full OP + OP's continuation posts + top high-karma replies).
 * Results are cached to disk so repeat & cross-section queries take <5ms.
 */
async function fetchAndChunkForumThread(tid, tornApiKey) {
    const cached = forumGuideChunksCache.get(tid);
    if (cached && (Date.now() - cached.fetchedAt) < FORUM_CHUNK_TTL_MS && Array.isArray(cached.chunks) && cached.chunks.length > 0) {
        return cached;
    }
    if (!tornApiKey) return null;

    try {
        const r = await fetch(`https://api.torn.com/v2/forum/${tid}/posts?offset=0&key=${encodeURIComponent(tornApiKey)}`, {
            signal: AbortSignal.timeout(5500)
        });
        const j = await r.json();
        if (!Array.isArray(j.posts) || j.posts.length === 0) return null;

        const posts = j.posts;
        const topicPost = posts.find(p => p.is_topic) || posts[0];
        const topicAuthorId = topicPost?.author?.id;
        const knownMeta = forumIndex.threads.find(t => t.id === tid);
        const threadTitle = knownMeta?.title || `Torn Forum Thread #${tid}`;
        const threadUrl = `https://www.torn.com/forums.php#/p=threads&t=${tid}`;

        if (isLegacyOrDeprecatedSource(threadTitle, threadUrl, stripHtmlPreservingHeaders(topicPost.content || ''))) {
            return null;
        }

        // Preserve FULL OP + any consecutive continuation posts by the same guide author (up to 6 posts)
        const opParts = [topicPost.content || ''];
        for (const p of posts) {
            if (p.id === topicPost.id) continue;
            if (topicAuthorId && p.author?.id === topicAuthorId && stripHtmlPreservingHeaders(p.content || '').length >= 120) {
                opParts.push(p.content || '');
                if (opParts.length >= 6) break;
            }
        }
        const fullGuideText = opParts.map(stripHtmlPreservingHeaders).filter(Boolean).join('\n\n');

        // Also capture top 3 distinct high-karma community replies for consensus verification
        const rankedReplies = posts
            .filter(p => p.id !== topicPost.id && (!topicAuthorId || p.author?.id !== topicAuthorId))
            .map(p => {
                const cleanBody = stripHtmlPreservingHeaders(p.content || '');
                const likes = Number(p.likes || 0);
                const dislikes = Number(p.dislikes || 0);
                const karma = Number(p.author?.karma || 0);
                const netScore = (likes - dislikes * 2) * 3 + Math.log10(Math.max(1, karma + 1)) * 2 + (cleanBody.length > 80 ? 2 : 0);
                return { p, cleanBody, likes, dislikes, karma, netScore };
            })
            .filter(x => x.cleanBody.length >= 40 && x.dislikes <= x.likes + 2)
            .sort((a, b) => b.netScore - a.netScore)
            .slice(0, 3);

        const opChunks = chunkTextHeaderAware(threadTitle, fullGuideText, { maxChars: 2600, overlapChars: 500 });
        if (rankedReplies.length > 0) {
            const replyText = rankedReplies
                .map(rep => `[Reply by ${rep.p.author?.username || 'Player'} | Karma ${rep.karma} | 👍${rep.likes}/👎${rep.dislikes}]: ${rep.cleanBody.slice(0, 700)}`)
                .join('\n\n');
            opChunks.push({
                header: 'Community Replies & Consensus',
                text: `[${threadTitle} > Community Replies & Consensus]\n${replyText}`
            });
        }

        const entry = {
            tid,
            fetchedAt: Date.now(),
            title: `Torn Forum: ${threadTitle}`,
            url: threadUrl,
            rating: knownMeta?.rating || topicPost?.likes || 0,
            chunks: opChunks
        };
        forumGuideChunksCache.set(tid, entry);
        persistForumChunksCache();
        return entry;
    } catch (_) {
        return null;
    }
}

async function prewarmCoreForumGuides(tornApiKey) {
    if (!tornApiKey) return 0;
    let warmed = 0;
    await Promise.all(
        CURATED_CORE_FORUM_GUIDES.map(async (tid) => {
            const res = await fetchAndChunkForumThread(tid, tornApiKey);
            if (res && res.chunks.length > 0) warmed++;
        })
    );
    return warmed;
}

// ── Hybrid BM25 + Vector Cosine + Phrase Reranker over Local & Forum Chunks ───
function scoreHybridChunks(query, candidates) {
    const allowLegacy = /\b(?:stocks?\s*2\.0|crimes?\s*1\.0|old\s+crimes)\b/i.test(query || '');
    const qLow = String(query || '').toLowerCase()
        .replace(/e-?dvds?/g, 'edvd')
        .replace(/10\s*[★*]\s*an\b/g, '10* an adult novelties');
    const qTokens = tokenizeForSearch(query);
    if (qTokens.length === 0 || candidates.length === 0) return [];

    // Collect key phrases active in this query
    const activePhrases = KEY_PHRASES.filter(ph => qLow.includes(ph));

    // Precompute TF for every candidate chunk
    const prepared = [];
    const df = new Map();
    let totalLen = 0;
    for (const cand of candidates) {
        if (!allowLegacy && isLegacyOrDeprecatedSource(cand.title, cand.url, cand.text)) continue;
        const { tf, len } = tokenizeListWithFreq(`${cand.sectionHeader || ''} ${(cand.keywords || []).join(' ')} ${cand.text}`);
        prepared.push({ cand, tf, len });
        totalLen += len;
        for (const term of qTokens) {
            if ((tf.get(term) || 0) > 0) df.set(term, (df.get(term) || 0) + 1);
        }
    }
    if (prepared.length === 0) return [];

    const N = prepared.length;
    const avgDl = Math.max(1, totalLen / N);
    const k1 = 1.5;
    const b = 0.75;

    // IDF weights for query tokens
    const qWeightMap = new Map();
    let qNormSq = 0;
    for (const term of qTokens) {
        const termDf = df.get(term) || 0;
        const idf = Math.log(1 + (N - termDf + 0.5) / (termDf + 0.5)) + 0.35;
        const w = (term.length >= 5 ? 1.25 : 1.0) * idf;
        qWeightMap.set(term, w);
        qNormSq += w * w;
    }
    const qNorm = Math.sqrt(qNormSq) || 1;

    const scored = [];
    for (const item of prepared) {
        const { cand, tf, len } = item;
        const docLow = `${cand.title} ${cand.sectionHeader || ''} ${cand.text}`.toLowerCase();

        // 1. Okapi BM25 over query terms
        let bm25Raw = 0;
        let maxIdealBm25 = 0;
        let matchedUniqueTerms = 0;
        let dotProduct = 0;
        let docNormSq = 0;

        for (const [term, count] of tf.entries()) {
            const subTf = 1 + Math.log(Math.max(1, count));
            docNormSq += subTf * subTf;
        }
        const docNorm = Math.sqrt(Math.max(1, docNormSq));

        for (const term of qTokens) {
            const qW = qWeightMap.get(term) || 1;
            const termDf = df.get(term) || 0;
            const idf = Math.log(1 + (N - termDf + 0.5) / (termDf + 0.5)) + 0.35;
            maxIdealBm25 += idf * ((k1 + 1) / 1.8);

            const f = tf.get(term) || 0;
            if (f > 0) {
                matchedUniqueTerms++;
                const bm25Term = idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (len / avgDl))));
                bm25Raw += bm25Term;

                const dW = (1 + Math.log(Math.max(1, f))) * idf;
                dotProduct += qW * dW;
            }
        }

        const denomTokens = Math.min(10, qTokens.length);
        const coverage = Math.min(1, matchedUniqueTerms / Math.max(1, denomTokens));
        if (matchedUniqueTerms === 0 || (qTokens.length >= 3 && matchedUniqueTerms < 2 && activePhrases.length === 0)) {
            continue;
        }

        const bm25Norm = Math.min(1, bm25Raw / Math.max(0.5, maxIdealBm25 * (denomTokens / Math.max(1, qTokens.length))));
        const cosineSim = Math.min(1, (dotProduct / (qNorm * docNorm)) * 1.55);

        // 2. Reranker Bonus: Exact keyphrases, header/keyword alignment, and Tier authority
        let phraseMatches = 0;
        for (const ph of activePhrases) {
            if (docLow.includes(ph)) phraseMatches++;
        }
        const phraseRatio = activePhrases.length > 0 ? Math.min(1, phraseMatches / Math.min(3, activePhrases.length)) : 0;

        let kwTagHits = 0;
        if (Array.isArray(cand.keywords)) {
            for (const qT of qTokens) {
                if (cand.keywords.some(k => k === qT || k.includes(qT))) kwTagHits++;
            }
        }
        const kwTagBonus = qTokens.length > 0 ? Math.min(0.20, (kwTagHits / Math.max(1, denomTokens)) * 0.25) : 0;

        const baseRelevance =
            0.34 * coverage +
            0.26 * bm25Norm +
            0.20 * cosineSim +
            0.20 * phraseRatio +
            kwTagBonus;

        // Tier authority boost applies ONLY multiplicatively on positive base relevance!
        const authority = Number(cand.authorityWeight || 1.0);
        const finalScore = Math.min(0.99, Number((baseRelevance * authority).toFixed(3)));

        if (finalScore >= MIN_CHUNK_SCORE) {
            scored.push({ ...cand, score: finalScore });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

// ── LAYER 3: Google Search Grounding Fallback (Used ONLY when local score < threshold) ──
async function unwrapGroundingRedirectUrl(uri) {
    if (!uri || !uri.includes('grounding-api-redirect')) return uri;
    try {
        const r = await fetch(uri, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(2000)
        });
        const loc = r.headers.get('location');
        return loc || uri;
    } catch (_) {
        return uri;
    }
}

function isOfficialTornDomain(urlStr) {
    try {
        const u = new URL(urlStr);
        return u.hostname === 'wiki.torn.com' || u.hostname === 'www.torn.com' || u.hostname === 'torn.com';
    } catch (_) {
        return false;
    }
}

function extractForumThreadIdsFromTextAndUrls(text, urls) {
    const ids = new Set();
    const combined = `${text || ''} ${(urls || []).join(' ')}`;
    const regexes = [
        /[?&]t=(\d{5,9})\b/gi,
        /threads\b[^#\s]*?t=(\d{5,9})\b/gi,
        /\bthread\s*#?\s*(\d{7,9})\b/gi
    ];
    for (const rx of regexes) {
        for (const m of combined.matchAll(rx)) {
            ids.add(Number(m[1]));
        }
    }
    return [...ids];
}

async function runTornWikiAndForumSearchPass(question, geminiKeys = []) {
    if (!Array.isArray(geminiKeys) || geminiKeys.length === 0) {
        return { groundedNotes: '', sources: [], discoveredThreadIds: [], wikiWasComplete: false };
    }

    const searchPrompt = `You are a strict Torn City research retriever. Answer ONLY using official current-meta Torn City sources (NEVER use Stocks 2.0 or Crimes 1.0):
STEP 1 (PRIMARY — TORN WIKI): Search site:wiki.torn.com for: "${question}"
- Extract exact numbers, percentages, formulas, cooldowns, and Torn Wiki page name(s).
- State WIKI_STATUS: COMPLETE if wiki.torn.com answers cleanly, else WIKI_STATUS: PARTIAL_OR_MISSING.
STEP 2 (FALLBACK — TORN FORUMS): If PARTIAL_OR_MISSING, search site:torn.com/forums.php for: "${question}" and include thread IDs (t=XXXXXXX).`;

    const searchModels = ['gemini-2.5-flash', 'gemini-4-hydrogen'];
    for (const key of geminiKeys) {
        for (const model of searchModels) {
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: searchPrompt }] }],
                        tools: [{ googleSearch: {} }]
                    }),
                    signal: AbortSignal.timeout(4800)
                });
                const data = await res.json();
                if (data.error || !data.candidates?.length) continue;

                const cand = data.candidates[0];
                const text = (cand.content?.parts || []).map(p => p.text || '').join('').trim();
                const rawChunks = cand.groundingMetadata?.groundingChunks || [];
                const qKws = extractSearchKeywords(question);
                const allowLegacy = /\b(?:stocks?\s*2\.0|crimes?\s*1\.0|old\s+crimes)\b/i.test(question || '');

                const unwrapped = await Promise.all(
                    rawChunks.slice(0, 6).map(async (ch) => {
                        const rawUri = ch.web?.uri || '';
                        const finalUrl = await unwrapGroundingRedirectUrl(rawUri);
                        return { title: ch.web?.title || 'Torn Reference', url: finalUrl };
                    })
                );

                const verifiedSources = [];
                const seenUrls = new Set();
                for (const item of unwrapped) {
                    const checkUrl = item.url;
                    const titleLow = (item.title || '').toLowerCase();
                    if (!isOfficialTornDomain(checkUrl)) continue;
                    if (!allowLegacy && isLegacyOrDeprecatedSource(item.title, checkUrl, '')) continue;

                    // Relevance gate on search grounding chunks too
                    const hay = `${titleLow} ${checkUrl.toLowerCase()}`;
                    const kwHit = qKws.some(k => k.length >= 4 && hay.includes(k)) || checkUrl.includes('wiki.torn.com');
                    if (!kwHit || seenUrls.has(checkUrl)) continue;
                    seenUrls.add(checkUrl);

                    let label = item.title;
                    if (checkUrl.includes('wiki.torn.com')) {
                        const slug = decodeURIComponent(checkUrl.split('/wiki/')[1] || '').replace(/_/g, ' ');
                        label = slug ? `Torn Wiki: ${slug}` : 'Torn Wiki (wiki.torn.com)';
                    } else if (checkUrl.includes('forums.php')) {
                        label = label && label !== 'torn.com' ? `Torn Forums: ${label}` : 'Torn City Forums';
                    }
                    verifiedSources.push({ title: label, url: checkUrl });
                }

                const discoveredThreadIds = extractForumThreadIdsFromTextAndUrls(text, verifiedSources.map(s => s.url));
                return {
                    groundedNotes: text,
                    sources: verifiedSources,
                    discoveredThreadIds,
                    wikiWasComplete: /WIKI_STATUS:\s*COMPLETE/i.test(text)
                };
            } catch (_) {}
        }
    }

    return { groundedNotes: '', sources: [], discoveredThreadIds: [], wikiWasComplete: false };
}

// ── Master RAG Orchestrator ───────────────────────────────────────────────────
async function gatherTornWikiAndForumEvidence(question, tornApiKey = '', geminiKeys = []) {
    if (!needsWikiOrForumLookup(question)) {
        return { contextBlock: '', sources: [], candidateChunks: [], usedWikiOrForum: false };
    }

    const normKey = String(question || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 220);
    const cached = evidenceCache.get(normKey);
    if (cached && (Date.now() - cached.ts) < EVIDENCE_TTL_MS) {
        return cached.value;
    }

    // Only wait on Torn API sync if caches are empty (otherwise 0ms!)
    if (encyclopedia.itemsList.length === 0 || forumIndex.threads.length === 0) {
        await Promise.race([
            Promise.all([
                ensureTornEncyclopediaSynced(tornApiKey),
                ensureForumGuidesIndexSynced(tornApiKey)
            ]),
            new Promise(r => setTimeout(r, 4000))
        ]).catch(() => {});
    } else {
        // Trigger background refresh without blocking response latency
        ensureTornEncyclopediaSynced(tornApiKey).catch(() => {});
        ensureForumGuidesIndexSynced(tornApiKey).catch(() => {});
    }

    // 1. Assemble Local Tier-1 Core Wiki Corpus Chunks
    const candidatePool = [];
    for (const page of CORE_TORN_WIKI_PAGES) {
        for (const sec of page.sections) {
            candidatePool.push({
                tier: 'Tier 1: Official Torn Wiki',
                title: page.title,
                url: page.url,
                sectionHeader: sec.header,
                keywords: sec.keywords || [],
                authorityWeight: page.authorityWeight || 1.35,
                text: sec.text
            });
        }
    }

    // 2. Add matching Official Torn API Encyclopedia facts
    const encFacts = lookupEncyclopediaFacts(question);
    for (const ef of encFacts) {
        candidatePool.push({
            tier: 'Tier 1A: Torn API Encyclopedia',
            title: ef.title,
            url: ef.url,
            sectionHeader: 'Canonical API Data',
            keywords: extractSearchKeywords(ef.title),
            authorityWeight: 1.25,
            text: ef.text
        });
    }

    // 3. Match Forum Guide threads (strict word-boundary + legacy exclusion) and ensure full chunked text
    const matchedThreadIds = findMatchingForumThreadIds(question, []);
    const forumFetchPromises = matchedThreadIds.map(tid => fetchAndChunkForumThread(tid, tornApiKey));
    const fetchedEntries = await Promise.all(forumFetchPromises);

    // Also include any already-cached Core Forum Guides (e.g. Cracking 16373016) in local candidate pool
    const seenChunkThreadIds = new Set();
    for (const entry of [...fetchedEntries, ...forumGuideChunksCache.values()]) {
        if (!entry || seenChunkThreadIds.has(entry.tid)) continue;
        seenChunkThreadIds.add(entry.tid);
        for (const ch of (entry.chunks || [])) {
            candidatePool.push({
                tier: 'Tier 2: Torn Forum Guide',
                title: entry.title,
                url: entry.url,
                sectionHeader: ch.header,
                keywords: [],
                authorityWeight: 1.0,
                text: ch.text
            });
        }
    }

    // 4. Score & filter strictly above MIN_CHUNK_SCORE (>= 0.75)
    let rankedChunks = scoreHybridChunks(question, candidatePool);

    // 5. FAST PATH: Only call slow Gemini googleSearch fallback when local hybrid retrieval lacks high confidence
    const topLocalScore = rankedChunks[0]?.score || 0;
    let searchFallbackBlock = '';
    if (topLocalScore < LOCAL_SKIP_SEARCH_THRESHOLD && Array.isArray(geminiKeys) && geminiKeys.length > 0 && rankedChunks.length < 2) {
        const searchRes = await runTornWikiAndForumSearchPass(question, geminiKeys);
        if (searchRes.discoveredThreadIds.length > 0 && !searchRes.wikiWasComplete) {
            const extraTids = searchRes.discoveredThreadIds.filter(id => !seenChunkThreadIds.has(id)).slice(0, 2);
            const extraEntries = await Promise.all(extraTids.map(tid => fetchAndChunkForumThread(tid, tornApiKey)));
            for (const entry of extraEntries) {
                if (!entry) continue;
                for (const ch of entry.chunks) {
                    candidatePool.push({
                        tier: 'Tier 2: Torn Forum Guide',
                        title: entry.title,
                        url: entry.url,
                        sectionHeader: ch.header,
                        keywords: [],
                        authorityWeight: 1.0,
                        text: ch.text
                    });
                }
            }
            rankedChunks = scoreHybridChunks(question, candidatePool);
        }
        if (rankedChunks.length === 0 && searchRes.groundedNotes && searchRes.sources.length > 0) {
            for (const s of searchRes.sources.slice(0, 3)) {
                candidatePool.push({
                    tier: s.url.includes('wiki.torn.com') ? 'Tier 1: Torn Wiki Search' : 'Tier 2: Torn Forum Search',
                    title: s.title,
                    url: s.url,
                    sectionHeader: 'Grounded Web Excerpt',
                    keywords: extractSearchKeywords(question),
                    authorityWeight: s.url.includes('wiki.torn.com') ? 1.25 : 1.0,
                    text: searchRes.groundedNotes.slice(0, 1800)
                });
            }
            rankedChunks = scoreHybridChunks(question, candidatePool);
            if (rankedChunks.length === 0 && searchRes.wikiWasComplete) {
                searchFallbackBlock = searchRes.groundedNotes;
                rankedChunks = searchRes.sources.slice(0, 2).map(s => ({
                    tier: 'Tier 1: Torn Wiki Search',
                    title: s.title,
                    url: s.url,
                    sectionHeader: 'Grounded Wiki Search',
                    score: 0.78,
                    text: searchRes.groundedNotes.slice(0, 1800)
                }));
            }
        }
    }

    // Limit to top 6 verified chunks, favoring diversity across distinct sources/sections
    const finalChunks = rankedChunks.slice(0, 6).map((ch, idx) => ({
        id: `SRC-${idx + 1}`,
        title: ch.title,
        url: ch.url,
        tier: ch.tier,
        score: ch.score,
        sectionHeader: ch.sectionHeader,
        text: ch.text
    }));

    // Deduplicate source descriptors preserving SRC-IDs so LLM selection maps 1:1 to citations
    const sourceCatalog = [];
    for (const ch of finalChunks) {
        sourceCatalog.push({
            id: ch.id,
            title: ch.title,
            url: ch.url,
            score: ch.score
        });
    }

    let contextBlock = '';
    if (finalChunks.length > 0) {
        contextBlock = `═══ VERIFIED TORN WIKI & FORUM KNOWLEDGE BASE (HIGH-RELEVANCE CHUNKS >= ${MIN_CHUNK_SCORE}) ═══\n`;
        contextBlock += `Cite ONLY the [SRC-k] IDs whose text you actually use at the end of your reply via [[SOURCES_USED: SRC-1, ...]] (or [[SOURCES_USED: NONE]]).\n\n`;
        for (const ch of finalChunks) {
            contextBlock += `[${ch.id}] (${ch.tier} | Relevance: ${ch.score.toFixed(2)}) ${ch.title} — ${ch.url}\n${ch.text}\n\n`;
        }
        contextBlock += `══════════════════════════════════════════════════════════════════════════════\n\n`;
    } else if (searchFallbackBlock) {
        contextBlock = `${searchFallbackBlock}\n`;
    }

    const value = {
        contextBlock,
        sources: sourceCatalog,
        candidateChunks: finalChunks,
        usedWikiOrForum: Boolean(contextBlock.trim())
    };

    if (finalChunks.length > 0) {
        if (evidenceCache.size > 250) {
            const oldestKey = evidenceCache.keys().next().value;
            evidenceCache.delete(oldestKey);
        }
        evidenceCache.set(normKey, { ts: Date.now(), value });
    }

    return value;
}

module.exports = {
    MIN_CHUNK_SCORE,
    needsWikiOrForumLookup,
    isPurePersonalAccountQuery,
    ensureTornEncyclopediaSynced,
    ensureForumGuidesIndexSynced,
    prewarmCoreForumGuides,
    lookupEncyclopediaMatches,
    gatherTornWikiAndForumEvidence
};
