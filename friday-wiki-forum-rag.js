'use strict';

/**
 * F.R.I.D.A.Y. — Authoritative Torn Wiki & Multi-Forum Consensus Retrieval Engine
 *
 * Enforces strict two-tier Torn City factual grounding:
 *   Tier 1 (Primary): Official Torn City Wiki (wiki.torn.com) + Official Torn API Encyclopedia
 *                     (/torn/?selections=items,gyms,companies,education,merits,properties,stocks,factiontree & /v2/torn/crimes)
 *   Tier 2 (Fallback): Official Torn City Forums (torn.com/forums.php + /v2/forum/{threadId}/posts)
 *                      Aggregates MULTIPLE threads and MULTIPLE high-karma / upvoted replies to verify consensus!
 */

const fs = require('fs');
const path = require('path');

const ENCYCLOPEDIA_CACHE_FILE = path.join(__dirname, 'data', 'torn_encyclopedia_cache.json');
const FORUM_INDEX_CACHE_FILE = path.join(__dirname, 'data', 'torn_forum_guides_index.json');

// 30-minute LRU cache for grounded Wiki + Forum searches so repeated questions are instant & cost 0 quota
const evidenceCache = new Map();
const EVIDENCE_TTL_MS = 30 * 60 * 1000;

let encyclopedia = {
    lastSynced: 0,
    itemsByName: new Map(), // lowercase name -> item obj
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
    threads: [] // { id, title, forumId, forumName, rating, posts, views, author, karma, lastPostTime }
};

const STOP_WORDS = new Set([
    'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
    'does', 'do', 'did', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'can', 'could', 'should', 'would', 'will', 'shall',
    'may', 'might', 'must', 'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then',
    'than', 'that', 'this', 'these', 'those', 'for', 'from', 'with', 'without',
    'into', 'onto', 'about', 'above', 'below', 'under', 'over', 'between',
    'give', 'gives', 'get', 'gets', 'make', 'makes', 'take', 'takes', 'use',
    'best', 'good', 'better', 'much', 'many', 'most', 'more', 'less', 'some',
    'any', 'all', 'tell', 'know', 'explain', 'friday', 'hey', 'hi', 'please',
    'torn', 'city', 'game', 'work', 'works', 'need', 'worth', 'way', 'long'
]);

function stripHtmlAndBbcode(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<li>/gi, '• ')
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

function extractSearchKeywords(query) {
    const cleaned = String(query || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s.+%-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
    return [...new Set(cleaned)];
}

/**
 * Determine whether a message in /conversation, /respond, or /ask is asking a Torn City question
 * that warrants Wiki + Forum lookup (as opposed to pure casual greetings/banter).
 */
function needsWikiOrForumLookup(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim();
    if (clean.length < 4) return false;
    const low = clean.toLowerCase();

    // Pure greetings / acknowledgements never need external search
    if (/^(?:hi|hey|hello|yo|sup|thanks|thank\s+you|ty|thx|gn|good\s+(?:morning|night|evening)|lol|lmao|nice|cool|ok|okay)\s*(?:friday|fri)?[!.,?]*$/i.test(low)) {
        return false;
    }

    // Explicit question structure OR Torn mechanics/strategy terms
    const hasQuestionCue = /\?|^(?:what|how|why|when|where|which|who|can|does|do|is|are|should|would|tell\s+me|explain|compare)\b/i.test(clean);
    const hasTornTopic = /\b(?:torn|wiki|forum|gym|train|happy|jump|xanax|edvd|fhc|booster|drug|overdose|od|rehab|addiction|nerve|crime|oc|organized\s+crime|cpr|burglary|shoplifting|pickpocketing|skimming|bootlegging|graffiti|hustling|disposal|cracking|forgery|scamming|arson|search\s+for\s+cash|merit|honor|medal|education|course|stock|block|bank|apr|company|director|special|job\s+point|property|private\s+island|vault|bazaar|item\s+market|mug|hosp|hospital|revive|blood\s+bag|morphine|sed|stat\s+enhancer|skateboard|parachute|boxing\s+gloves|dumbbells|book|travel|airstrip|wlt|bct|plushie|flower|museum|point|ranked\s+war|rw|cache|fair\s+fight|ff|retal|chain|respect|stealth|dexterity|defense|strength|speed|baldr|armor|weapon|bonus|ammo|racing|poker|casino|russian\s+roulette|bounty|jail|bust|bail|faction|steadfast|voracity|toleration|excursion)\b/i.test(low);

    return Boolean(hasTornTopic || (hasQuestionCue && clean.split(/\s+/).length >= 4));
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
} catch (_) {}

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
                fetch(`https://api.torn.com/torn/?selections=items,gyms,companies,education,merits,properties,stocks&key=${encodeURIComponent(tornApiKey)}`, {
                    signal: AbortSignal.timeout(12000)
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

function lookupEncyclopediaMatches(query) {
    const qLow = String(query || '').toLowerCase();
    const kws = extractSearchKeywords(query);
    if (!qLow) return '';

    const blocks = [];

    // 1. Exact / Phrase Item Matches (Books, Drugs, Boosters, Enhancers, Weapons, Caches, etc.)
    const matchedItems = [];
    for (const it of encyclopedia.itemsList) {
        const nm = it.name.toLowerCase();
        if (nm.length >= 3 && qLow.includes(nm)) {
            matchedItems.push({ it, score: nm.length + 20 });
        } else if (nm.length >= 6 && kws.length >= 2) {
            const hits = kws.filter(k => k.length >= 4 && nm.includes(k)).length;
            if (hits >= 2) matchedItems.push({ it, score: hits * 4 });
        }
    }
    matchedItems.sort((a, b) => b.score - a.score);
    for (const { it } of matchedItems.slice(0, 4)) {
        const parts = [`• **${it.name}** [ID ${it.id}, Type: ${it.type}${it.weaponType ? `/${it.weaponType}` : ''}]`];
        if (it.effect) parts.push(`Effect: ${it.effect}`);
        if (it.requirement) parts.push(`Requirement: ${it.requirement}`);
        if (it.damage !== null && it.damage !== undefined) parts.push(`Dmg: ${it.damage}, Acc: ${it.accuracy}`);
        if (it.armor !== null && it.armor !== undefined) parts.push(`Armor: ${it.armor}`);
        if (it.marketValue > 0) parts.push(`Market Value: $${it.marketValue.toLocaleString()}`);
        if (it.description && !it.effect) parts.push(`Desc: ${it.description}`);
        blocks.push(parts.join(' | '));
    }

    // 2. Stock Benefit Blocks (by acronym like WLT, TCB, SYM, FHG, MCS or name)
    for (const st of encyclopedia.stocks) {
        const acr = st.acronym.toLowerCase();
        const nm = st.name.toLowerCase();
        const acrRegex = acr ? new RegExp(`\\b${acr}\\b`, 'i') : null;
        if ((acrRegex && acrRegex.test(query)) || (nm.length >= 5 && qLow.includes(nm))) {
            const b = st.benefit;
            const reqShares = Number(b?.requirement || 0);
            const blockCost = reqShares && st.currentPrice ? `$${Math.round(reqShares * st.currentPrice).toLocaleString()}` : 'N/A';
            blocks.push(`• **Stock: ${st.name} (${st.acronym})** — Price: $${st.currentPrice} | Block Requirement: ${reqShares.toLocaleString()} shares (~${blockCost}) | Benefit (${b?.type || 'passive'}, ${b?.frequency || 0}d): ${b?.description || 'N/A'}`);
        }
    }

    // 3. Company Specials & Types
    for (const comp of encyclopedia.companies) {
        const nm = comp.name.toLowerCase();
        const hitSpecial = comp.specials.find(sp => sp.name.length >= 4 && qLow.includes(sp.name.toLowerCase()));
        if ((nm.length >= 4 && qLow.includes(nm)) || hitSpecial) {
            const spText = comp.specials
                .map(sp => `${sp.rating}★ ${sp.name} (${sp.cost ? `${sp.cost} JP` : 'Passive'}: ${sp.effect})`)
                .join(' ; ');
            blocks.push(`• **Company: ${comp.name}** — Specials: ${spText}`);
        }
    }

    // 4. Gyms (if gym name or specialist gyms asked)
    for (const g of encyclopedia.gyms) {
        const nm = g.name.toLowerCase();
        if (nm.length >= 4 && qLow.includes(nm)) {
            blocks.push(`• **Gym: ${g.name}** (Stage ${g.stage}, ${g.energy}E/click, Unlock $${(g.cost || 0).toLocaleString()}) — Dots: STR ${(g.strength / 10).toFixed(1)}, SPD ${(g.speed / 10).toFixed(1)}, DEF ${(g.defense / 10).toFixed(1)}, DEX ${(g.dexterity / 10).toFixed(1)}${g.note ? ` | Note: ${g.note}` : ''}`);
        }
    }

    // 5. Education Courses (if education/course/perk matches)
    if (/\b(?:edu|education|course|degree|biology|intravenous|blood\s+bag|sports\s+science|kick|self\s+defense|psychology|combat\s+training|history|museum|bachelor)\b/i.test(qLow)) {
        const eduHits = encyclopedia.educations.filter(ed => {
            const hay = `${ed.name} ${JSON.stringify(ed.results)}`.toLowerCase();
            return kws.some(k => k.length >= 4 && hay.includes(k));
        }).slice(0, 5);
        for (const ed of eduHits) {
            const days = ed.durationSec ? (ed.durationSec / 86400).toFixed(1) : '?';
            const perksStr = Object.entries(ed.results || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : v}`).join(' | ');
            blocks.push(`• **Education [${ed.code}]: ${ed.name}** (${days}d base) — Perks: ${perksStr}`);
        }
    }

    // 6. Properties
    for (const pr of encyclopedia.properties) {
        const nm = pr.name.toLowerCase();
        if (nm.length >= 5 && qLow.includes(nm)) {
            blocks.push(`• **Property: ${pr.name}** — Base Cost: $${(pr.cost || 0).toLocaleString()} | Base Happy: ${pr.happy} | Upkeep: $${(pr.upkeep || 0).toLocaleString()}/day`);
        }
    }

    // 7. Crimes 2.0 Official Metadata
    for (const cr of encyclopedia.crimesV2) {
        const nm = (cr.name || '').toLowerCase();
        if (nm && qLow.includes(nm)) {
            blocks.push(`• **Crimes 2.0: ${cr.name}** — Category: ${cr.category_name} | Enhancer Item: ${cr.enhancer_name} [ID ${cr.enhancer_id}] (+5% CE/CS gain) | Official Unique Outcomes: ${cr.unique_outcomes_count}`);
        }
    }

    if (!blocks.length) return '';
    return `═══ TIER 1A: OFFICIAL TORN API ENCYCLOPEDIA DATA (100% CANONICAL) ═══\n${blocks.slice(0, 8).join('\n')}\n═════════════════════════════════════════════════════════════════════\n\n`;
}

// ── LAYER 2: Torn Forum Guides Index & Multi-Thread Post Consensus Fetcher ───
let forumSyncInFlight = null;
async function ensureForumGuidesIndexSynced(tornApiKey) {
    if (!tornApiKey) return;
    const now = Date.now();
    if (forumIndex.threads.length > 30 && (now - forumIndex.lastSynced) < 2 * 3600 * 1000) {
        return;
    }
    if (forumSyncInFlight) return forumSyncInFlight;

    forumSyncInFlight = (async () => {
        try {
            // Pull top/recent threads across Tutorials & Guides (61), Questions & Answers (3), and Announcements (1)
            const urls = [
                [61, 'Tutorials & Guides', `https://api.torn.com/v2/forum/61/threads?limit=100&sort=DESC&key=${encodeURIComponent(tornApiKey)}`],
                [3, 'Questions & Answers', `https://api.torn.com/v2/forum/3/threads?limit=100&sort=DESC&key=${encodeURIComponent(tornApiKey)}`],
                [1, 'Announcements', `https://api.torn.com/v2/forum/1/threads?limit=50&sort=DESC&key=${encodeURIComponent(tornApiKey)}`]
            ];
            const batches = await Promise.all(
                urls.map(([fid, fname, u]) =>
                    fetch(u, { signal: AbortSignal.timeout(7000) })
                        .then(r => r.json())
                        .then(j => (j.threads || []).map(t => ({
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
                        })))
                        .catch(() => [])
                )
            );
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
    const ids = new Set(extraThreadIds.map(Number).filter(n => n > 1000));
    const kws = extractSearchKeywords(query);
    if (kws.length > 0 && forumIndex.threads.length > 0) {
        const scored = [];
        for (const t of forumIndex.threads) {
            const titleLow = t.title.toLowerCase();
            let hits = 0;
            for (const kw of kws) {
                if (titleLow.includes(kw)) hits += (kw.length >= 5 ? 2 : 1);
            }
            if (hits >= 2 || (kws.length === 1 && hits >= 1)) {
                const qualityBoost = (t.forumId === 61 ? 3 : 0) + (t.isSticky ? 4 : 0) + Math.min(3, Math.log10((t.views || 1) + 1));
                scored.push({ id: t.id, score: hits * 4 + qualityBoost });
            }
        }
        scored.sort((a, b) => b.score - a.score);
        for (const s of scored.slice(0, 3)) {
            if (ids.size >= 3) break;
            ids.add(s.id);
        }
    }
    return [...ids].slice(0, 3);
}

/**
 * Fetch multiple posts/replies from up to 3 Torn Forum threads via Official Torn API v2,
 * ranking replies by net community rating (likes - 2*dislikes) & author karma so F.R.I.D.A.Y.
 * verifies consensus across multiple independent Torn players!
 */
async function fetchMultiThreadForumConsensus(threadIds, tornApiKey) {
    if (!tornApiKey || !Array.isArray(threadIds) || threadIds.length === 0) {
        return { text: '', sources: [] };
    }

    const fetchedThreads = await Promise.all(
        threadIds.slice(0, 3).map(async (tid) => {
            try {
                const r = await fetch(`https://api.torn.com/v2/forum/${tid}/posts?offset=0&key=${encodeURIComponent(tornApiKey)}`, {
                    signal: AbortSignal.timeout(5500)
                });
                const j = await r.json();
                if (!Array.isArray(j.posts) || j.posts.length === 0) return null;
                return { tid, posts: j.posts };
            } catch (_) {
                return null;
            }
        })
    );

    const valid = fetchedThreads.filter(Boolean);
    if (!valid.length) return { text: '', sources: [] };

    const outBlocks = [];
    const sources = [];

    for (const { tid, posts } of valid) {
        const topicPost = posts.find(p => p.is_topic) || posts[0];
        const replies = posts.filter(p => p.id !== topicPost.id);

        // Score replies by community upvotes (likes - 2*dislikes), author karma, and substantive length
        const rankedReplies = replies
            .map(p => {
                const cleanBody = stripHtmlAndBbcode(p.content || '');
                const likes = Number(p.likes || 0);
                const dislikes = Number(p.dislikes || 0);
                const karma = Number(p.author?.karma || 0);
                const netScore = (likes - dislikes * 2) * 3 + Math.log10(Math.max(1, karma + 1)) * 2 + (cleanBody.length > 80 ? 2 : 0);
                return { p, cleanBody, likes, dislikes, karma, netScore };
            })
            .filter(x => x.cleanBody.length >= 25 && x.dislikes <= x.likes + 2)
            .sort((a, b) => b.netScore - a.netScore)
            .slice(0, 4);

        const knownMeta = forumIndex.threads.find(t => t.id === tid);
        const threadTitle = knownMeta?.title || `Torn Forum Thread #${tid}`;
        const threadUrl = `https://www.torn.com/forums.php#/p=threads&t=${tid}`;
        sources.push({ title: `Torn Forum: ${threadTitle}`, url: threadUrl });

        const opClean = stripHtmlAndBbcode(topicPost.content || '').slice(0, 1100);
        const opDate = topicPost.created_time ? new Date(topicPost.created_time * 1000).toISOString().slice(0, 10) : 'unknown';
        let block = `Thread #${tid} ("${threadTitle}") — ${threadUrl}\n`;
        block += `  [OP by ${topicPost.author?.username || 'Author'} | Karma: ${topicPost.author?.karma || 0} | 👍${topicPost.likes || 0}/👎${topicPost.dislikes || 0} | Date: ${opDate}]: ${opClean}\n`;

        for (const rep of rankedReplies) {
            const rDate = rep.p.created_time ? new Date(rep.p.created_time * 1000).toISOString().slice(0, 10) : '';
            block += `  [Reply by ${rep.p.author?.username || 'Player'} | Karma: ${rep.karma} | 👍${rep.likes}/👎${rep.dislikes} | ${rDate}]: ${rep.cleanBody.slice(0, 520)}\n`;
        }
        outBlocks.push(block);
    }

    return {
        text: `═══ TIER 2B: OFFICIAL TORN API v2 MULTI-THREAD / MULTI-REPLY FORUM POSTS ═══\n${outBlocks.join('\n')}\n════════════════════════════════════════════════════════════════════════════\n\n`,
        sources
    };
}

// ── LAYER 3: Google Search Grounding Scoped Strictly to Torn Wiki & Torn Forums ──
async function unwrapGroundingRedirectUrl(uri) {
    if (!uri || !uri.includes('grounding-api-redirect')) return uri;
    try {
        const r = await fetch(uri, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(2500)
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

/**
 * Perform two-tier grounded search using the free Gemini Search Grounding endpoint:
 *   1. Search site:wiki.torn.com FIRST.
 *   2. If Torn Wiki lacks a complete/clear answer, search site:torn.com/forums.php across multiple threads/replies.
 */
async function runTornWikiAndForumSearchPass(question, geminiKeys = []) {
    if (!Array.isArray(geminiKeys) || geminiKeys.length === 0) {
        return { groundedNotes: '', sources: [], discoveredThreadIds: [] };
    }

    const searchPrompt = `You are a strict Torn City research retriever. Answer ONLY using official Torn City sources in this exact order:
STEP 1 (PRIMARY — TORN WIKI): Search site:wiki.torn.com for: "${question}"
- Extract exact numbers, percentages, formulas, cooldowns, requirements, and the exact Torn Wiki page name(s).
- State WIKI_STATUS: COMPLETE if wiki.torn.com clearly and completely answers the question, or WIKI_STATUS: PARTIAL_OR_MISSING if wiki.torn.com does not clearly cover it (e.g. player strategy, meta comparisons, hidden formulas, Crimes 2.0 / OC 2.0 community research).

STEP 2 (FALLBACK — TORN FORUMS MULTI-ANSWER CONSENSUS): If WIKI_STATUS is PARTIAL_OR_MISSING (or to verify community formulas/meta), search site:torn.com/forums.php for: "${question}"
- Cross-check MULTIPLE forum threads, guides, and player answers (such as Tutorials & Guides f=61 and Questions & Answers f=3).
- Report what multiple distinct forum authors/guides agree on, note any post-patch changes, and include any forum thread IDs (t=XXXXXXX) or guide titles found.
- NEVER use non-Torn websites or guess.`;

    // Note: On Google AI Studio Free Tier, googleSearch tool quota is served on gemini-2.5-flash
    const searchModels = ['gemini-2.5-flash', 'gemini-4-hydrogen', 'gemini-3.5-flash-lite'];

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
                    signal: AbortSignal.timeout(9500)
                });
                const data = await res.json();
                if (data.error || !data.candidates?.length) continue;

                const cand = data.candidates[0];
                const text = (cand.content?.parts || []).map(p => p.text || '').join('').trim();
                const rawChunks = cand.groundingMetadata?.groundingChunks || [];

                // Unwrap redirect URLs in parallel and strictly retain ONLY wiki.torn.com & torn.com links
                const unwrapped = await Promise.all(
                    rawChunks.slice(0, 8).map(async (ch) => {
                        const rawUri = ch.web?.uri || '';
                        const finalUrl = await unwrapGroundingRedirectUrl(rawUri);
                        return {
                            title: ch.web?.title || 'Torn Reference',
                            rawUri,
                            url: finalUrl
                        };
                    })
                );

                const verifiedSources = [];
                const seenUrls = new Set();
                for (const item of unwrapped) {
                    const checkUrl = item.url;
                    const titleLow = (item.title || '').toLowerCase();
                    // Keep verified torn.com / wiki.torn.com URLs (or unresolved redirect if Google labelled domain torn.com)
                    const allowed = isOfficialTornDomain(checkUrl) ||
                        (checkUrl.includes('grounding-api-redirect') && (titleLow.includes('torn.com') || titleLow.includes('torn wiki')));
                    if (allowed && !seenUrls.has(checkUrl)) {
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
                }

                const discoveredThreadIds = extractForumThreadIdsFromTextAndUrls(
                    text,
                    verifiedSources.map(s => s.url)
                );

                return {
                    groundedNotes: text
                        ? `═══ TIER 1B / 2A: LIVE TORN WIKI (wiki.torn.com) & TORN FORUMS GROUNDED RESEARCH ═══\n${text}\n════════════════════════════════════════════════════════════════════════════════════\n\n`
                        : '',
                    sources: verifiedSources,
                    discoveredThreadIds,
                    wikiWasComplete: /WIKI_STATUS:\s*COMPLETE/i.test(text)
                };
            } catch (_) {
                // Try next model/key
            }
        }
    }

    return { groundedNotes: '', sources: [], discoveredThreadIds: [], wikiWasComplete: false };
}

/**
 * Master orchestrator called by /ask, /conversation, /respond, and Web Tactical AI:
 * Gathers:
 *   1. Canonical Torn API Encyclopedia facts
 *   2. Live Torn Wiki (wiki.torn.com) grounded search extract
 *   3. Multi-thread / multi-reply Torn Forums consensus via Official Torn API v2 (/v2/forum/{id}/posts)
 *      whenever Torn Wiki doesn't completely answer the question!
 */
async function gatherTornWikiAndForumEvidence(question, tornApiKey = '', geminiKeys = []) {
    if (!needsWikiOrForumLookup(question)) {
        return { contextBlock: '', sources: [], usedWikiOrForum: false };
    }

    const normKey = String(question || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 180);
    const cached = evidenceCache.get(normKey);
    if (cached && (Date.now() - cached.ts) < EVIDENCE_TTL_MS) {
        return cached.value;
    }

    // Kick off non-blocking background encyclopedia & forum index warmups (awaited briefly if cold)
    await Promise.race([
        Promise.all([
            ensureTornEncyclopediaSynced(tornApiKey),
            ensureForumGuidesIndexSynced(tornApiKey)
        ]),
        new Promise(r => setTimeout(r, 3000))
    ]).catch(() => {});

    const encyclopediaBlock = lookupEncyclopediaMatches(question);
    const searchRes = await runTornWikiAndForumSearchPass(question, geminiKeys);

    // Pull multi-reply Torn Forum posts via Torn API v2 if Wiki wasn't 100% complete OR forum threads were discovered
    let forumConsensus = { text: '', sources: [] };
    if (!searchRes.wikiWasComplete || searchRes.discoveredThreadIds.length > 0) {
        const threadIds = findMatchingForumThreadIds(question, searchRes.discoveredThreadIds);
        if (threadIds.length > 0) {
            forumConsensus = await fetchMultiThreadForumConsensus(threadIds, tornApiKey);
        }
    }

    // Deduplicate & order sources: Torn Wiki first, then Torn Forums
    const mergedSources = [];
    const seen = new Set();
    for (const s of [...searchRes.sources, ...forumConsensus.sources]) {
        if (s && s.url && !seen.has(s.url)) {
            seen.add(s.url);
            mergedSources.push(s);
        }
    }
    mergedSources.sort((a, b) => {
        const aWiki = a.url.includes('wiki.torn.com') || a.title.startsWith('Torn Wiki') ? 0 : 1;
        const bWiki = b.url.includes('wiki.torn.com') || b.title.startsWith('Torn Wiki') ? 0 : 1;
        return aWiki - bWiki;
    });

    const contextBlock = `${encyclopediaBlock}${searchRes.groundedNotes}${forumConsensus.text}`;
    const value = {
        contextBlock,
        sources: mergedSources.slice(0, 5),
        usedWikiOrForum: Boolean(contextBlock.trim())
    };

    if (value.usedWikiOrForum) {
        if (evidenceCache.size > 250) {
            const oldestKey = evidenceCache.keys().next().value;
            evidenceCache.delete(oldestKey);
        }
        evidenceCache.set(normKey, { ts: Date.now(), value });
    }

    return value;
}

module.exports = {
    needsWikiOrForumLookup,
    ensureTornEncyclopediaSynced,
    ensureForumGuidesIndexSynced,
    lookupEncyclopediaMatches,
    gatherTornWikiAndForumEvidence
};
