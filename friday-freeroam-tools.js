'use strict';

/**
 * F.R.I.D.A.Y. — Autonomous Freeroam Tool Suite
 *
 * Gives F.R.I.D.A.Y. (Discord /ask, /conversation, /respond, and Web Tactical AI)
 * full autonomous read-only access to:
 *   1. FactionOS Live Warboard, Ranked Wars & Enemy Roster + FF Scouter stat estimates
 *   2. Any Torn Player or Faction public profile + battle stat estimates
 *   3. Faction OC 2.0 & Armory stock/readiness
 *   4. Live Torn Market prices, Points Market, Stocks & Foreign Travel Profit runs
 *   5. Official Torn Wiki (wiki.torn.com) & Torn API Encyclopedia
 *   6. Multi-thread / Multi-reply Torn Forums Consensus (Tutorials & Guides, Q&A)
 *   7. Read-only Public Torn API Explorer for any public torn/, market/, user/{id}, faction/{id} query
 */

const fridayWikiForumRag = require('./friday-wiki-forum-rag');

const FUNCTION_DECLARATIONS = [
    {
        name: 'get_faction_war_and_roster',
        description: 'Get live Ranked War status (active or upcoming war, enemy faction ID/name, start countdown, scores, target), enemy faction roster with FF Scouter battle-stat estimates, and best targets matched to the user stats. Use this whenever asked about wars, upcoming war, enemy faction, war targets, or war strategy.',
        parameters: {
            type: 'object',
            properties: {
                factionId: {
                    type: 'string',
                    description: 'Optional Torn faction ID (defaults to the user/configured faction)'
                },
                userTotalStats: {
                    type: 'number',
                    description: 'Optional user total battle stats to match optimal Fair Fight (2.5-3.0) enemy targets'
                }
            }
        }
    },
    {
        name: 'inspect_torn_player_or_faction',
        description: 'Look up any Torn City player (by numeric Torn ID) or any Torn faction (by numeric Faction ID) including public profile, level, status, faction, personalstats highlights, and FF Scouter battle stat estimate.',
        parameters: {
            type: 'object',
            properties: {
                playerId: {
                    type: 'string',
                    description: 'Numeric Torn player ID to inspect'
                },
                factionId: {
                    type: 'string',
                    description: 'Numeric Torn faction ID to inspect (basic info, members count, ranked wars, respect)'
                }
            }
        }
    },
    {
        name: 'get_faction_oc_and_armory',
        description: 'Get live Organized Crimes 2.0 (recruiting/planning/ready OCs and open slots) and Faction Armory stock (medical items, drugs, boosters) for the faction.',
        parameters: {
            type: 'object',
            properties: {
                factionId: {
                    type: 'string',
                    description: 'Optional Torn faction ID'
                }
            }
        }
    },
    {
        name: 'get_torn_market_and_travel',
        description: 'Get live Torn City market prices (items by name, Points Market price, stock prices/benefits) and live top foreign travel profit runs from YATA/Prometheus.',
        parameters: {
            type: 'object',
            properties: {
                itemQuery: {
                    type: 'string',
                    description: 'Optional item name or stock acronym (e.g. Xanax, Erotic DVD, WLT, Points) to look up live price'
                },
                includeTravelTop: {
                    type: 'boolean',
                    description: 'Set true to return top live foreign travel profit runs (country, item, stock, profit/hr)'
                }
            }
        }
    },
    {
        name: 'lookup_torn_wiki_and_encyclopedia',
        description: 'Search the Official Torn City Wiki (wiki.torn.com) and Official Torn API Encyclopedia (items, books, company specials, gyms, education courses, stocks, properties, Crimes 2.0). Always use this FIRST for Torn game mechanics.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Specific Torn item, mechanic, company, book, or wiki topic to search'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'search_and_read_torn_forums',
        description: 'Search Torn City Forums (Tutorials & Guides, Questions & Answers, Announcements) and read multiple top-rated / high-karma player replies across threads. Use when Torn Wiki lacks a clear answer (strategy, meta, hidden formulas) or to verify community consensus.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Topic or keywords to search on Torn Forums'
                },
                threadId: {
                    type: 'string',
                    description: 'Optional specific numeric Torn forum thread ID to read directly'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'fetch_torn_public_endpoint',
        description: 'Freeroam read-only Torn API v1/v2 query for any public Torn data not covered by other tools (e.g., torn/?selections=stocks,gyms,properties,territory; market/{itemId}?selections=itemmarket; v2/torn/crimes; user/{id}?selections=profile,personalstats; faction/{id}?selections=basic,rankedwars,upgrades). Private log/key endpoints are blocked.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Relative Torn API path without key, e.g. "torn/?selections=bank" or "v2/torn/calendar" or "faction/52355?selections=upgrades"'
                }
            },
            required: ['path']
        }
    }
];

function isSafePublicTornPath(rawPath) {
    const clean = String(rawPath || '').trim().replace(/^https?:\/\/api\.torn\.com\//i, '').replace(/^\/+/, '');
    if (!clean || clean.includes('..') || clean.includes('@')) return null;
    // Strip any accidental key= param
    const noKey = clean.replace(/([?&])key=[^&]*/gi, '$1').replace(/[?&]$/, '');
    const low = noKey.toLowerCase();

    // Block private personal logs, events, messages, money, or key info
    if (/\b(log|events|newevents|messages|newmessages|inventory|money|networth|key\/|api)\b/.test(low)) {
        return null;
    }
    const allowedPrefix = /^(v2\/)?(torn|market|company|property|user\/\d+|faction\/\d+)/i;
    if (!allowedPrefix.test(low)) return null;
    return noKey;
}

function summarizeBracket(statsNum) {
    if (!statsNum || statsNum <= 0) return 'unknown';
    if (statsNum < 250000) return '<250k';
    if (statsNum < 1000000) return '250k-1M';
    if (statsNum < 10000000) return '1M-10M';
    if (statsNum < 100000000) return '10M-100M';
    if (statsNum < 1000000000) return '100M-1B';
    return '1B+';
}

function createFreeroamToolExecutor(deps) {
    const {
        getTornApiKey,
        getGeminiApiKeys,
        getDefaultFactionId,
        getCachedWarboard,
        getBatchFFStats,
        getSingleFFStats,
        getCachedTravelItems,
        formatCompactStats,
        userFactionId = '',
        userTotalStats = 0
    } = deps;

    const collectedSources = [];
    const seenUrls = new Set();
    const addSource = (title, url) => {
        if (url && !seenUrls.has(url)) {
            seenUrls.add(url);
            collectedSources.push({ title, url });
        }
    };

    async function executeTool(name, args = {}) {
        const tornKey = getTornApiKey();
        const gemKeys = getGeminiApiKeys();
        const defaultFid = String(args.factionId || userFactionId || getDefaultFactionId() || '52355').replace(/\D+/g, '') || '52355';

        try {
            if (name === 'get_faction_war_and_roster') {
                if (!tornKey) return { error: 'No Torn API key available on server.' };

                const facData = await fetch(`https://api.torn.com/faction/${defaultFid}?selections=basic,rankedwars,chain&key=${encodeURIComponent(tornKey)}`, {
                    signal: AbortSignal.timeout(7000)
                }).then(r => r.json()).catch(() => null);

                if (!facData || facData.error) {
                    return { error: facData?.error?.error || 'Failed to fetch faction war data.' };
                }

                const nowSec = Math.floor(Date.now() / 1000);
                const rws = Object.entries(facData.rankedwars || {}).map(([id, w]) => ({ id, ...w }));
                // Prefer active or upcoming war (winner === 0 or end === 0)
                rws.sort((a, b) => (b.war?.start || 0) - (a.war?.start || 0));
                const activeOrNext = rws.find(w => !w.war?.winner && (!w.war?.end || w.war.end > nowSec)) || rws[0] || null;

                let warSummary = { status: 'No active or scheduled Ranked War found', recentWar: null };
                let enemyFactionData = null;
                let enemyTargetsMatched = [];
                let enemyBracketCounts = {};

                if (activeOrNext) {
                    const fEntries = Object.entries(activeOrNext.factions || {});
                    const myEntry = fEntries.find(([fid]) => String(fid) === defaultFid);
                    const enemyEntry = fEntries.find(([fid]) => String(fid) !== defaultFid);
                    const startTs = Number(activeOrNext.war?.start || 0);
                    const endTs = Number(activeOrNext.war?.end || 0);
                    const winner = Number(activeOrNext.war?.winner || 0);

                    let phase = 'unknown';
                    if (winner > 0 || (endTs > 0 && endTs <= nowSec)) phase = 'completed';
                    else if (startTs > nowSec) phase = `upcoming (starts in ${((startTs - nowSec) / 3600).toFixed(1)}h at ${new Date(startTs * 1000).toUTCString()})`;
                    else phase = 'LIVE ACTIVE WAR';

                    warSummary = {
                        warId: activeOrNext.id,
                        phase,
                        targetScore: activeOrNext.war?.target || 0,
                        myFaction: myEntry ? { id: myEntry[0], ...myEntry[1] } : { id: defaultFid, name: facData.name },
                        enemyFaction: enemyEntry ? { id: enemyEntry[0], ...enemyEntry[1] } : null
                    };

                    // If war is upcoming or live, inspect the enemy faction roster + FF Scouter estimates!
                    if (enemyEntry && (phase === 'LIVE ACTIVE WAR' || phase.startsWith('upcoming'))) {
                        const enemyId = String(enemyEntry[0]);
                        enemyFactionData = await fetch(`https://api.torn.com/faction/${enemyId}?selections=basic&key=${encodeURIComponent(tornKey)}`, {
                            signal: AbortSignal.timeout(7000)
                        }).then(r => r.json()).catch(() => null);

                        if (enemyFactionData && enemyFactionData.members) {
                            const memberEntries = Object.entries(enemyFactionData.members).map(([mid, m]) => ({
                                id: mid,
                                name: m.name,
                                level: Number(m.level || 1),
                                status: m.status?.state || 'Okay',
                                desc: m.status?.description || '',
                                lastAction: m.last_action?.relative || ''
                            }));

                            const ffMap = await getBatchFFStats(memberEntries.map(m => m.id)).catch(() => new Map());
                            const myStats = Number(args.userTotalStats || userTotalStats || 0);

                            const enriched = memberEntries.map(m => {
                                const ff = ffMap.get(m.id);
                                const bs = ff?.total || 0;
                                const br = summarizeBracket(bs);
                                enemyBracketCounts[br] = (enemyBracketCounts[br] || 0) + 1;
                                return { ...m, estStats: bs, estStatsHuman: ff?.human || 'unknown' };
                            });

                            if (myStats > 0) {
                                // Sweet spot for good FF (~2.0 to 3.0) and beatable wins: ~0.45x to 1.45x user stats
                                enemyTargetsMatched = enriched
                                    .filter(m => m.estStats > 0 && m.estStats >= myStats * 0.35 && m.estStats <= myStats * 1.45)
                                    .sort((a, b) => Math.abs(a.estStats - myStats * 0.95) - Math.abs(b.estStats - myStats * 0.95))
                                    .slice(0, 10)
                                    .map(m => `${m.name} [${m.id}] (Lvl ${m.level}, ~${m.estStatsHuman}, ${m.status})`);
                            } else {
                                enemyTargetsMatched = enriched
                                    .filter(m => m.estStats > 0)
                                    .sort((a, b) => a.estStats - b.estStats)
                                    .slice(0, 10)
                                    .map(m => `${m.name} [${m.id}] (Lvl ${m.level}, ~${m.estStatsHuman}, ${m.status})`);
                            }
                        }
                    }
                }

                // Also inspect cached Warboard summary if available
                const wb = getCachedWarboard(defaultFid);
                const wbSummary = wb ? {
                    builtAgoSec: wb._builtAt ? Math.round((Date.now() - wb._builtAt) / 1000) : null,
                    friendlyCount: (wb.friendly || []).length,
                    friendlyOnline: (wb.friendly || []).filter(m => m.lastActionStatus === 'Online').length,
                    enemyCount: (wb.enemy || []).length,
                    enemyOkay: (wb.enemy || []).filter(m => m.state === 'Okay').length,
                    enemyHosp: (wb.enemy || []).filter(m => m.state === 'Hospital').length,
                    enemyAbroad: (wb.enemy || []).filter(m => m.state === 'Traveling' || m.state === 'Abroad').length
                } : null;

                return {
                    faction: { id: defaultFid, name: facData.name, respect: facData.respect, memberCount: Object.keys(facData.members || {}).length },
                    chain: facData.chain || null,
                    warSummary,
                    enemyRosterSummary: enemyFactionData ? {
                        enemyName: enemyFactionData.name,
                        enemyId: enemyFactionData.ID,
                        enemyRespect: enemyFactionData.respect,
                        enemyMemberCount: Object.keys(enemyFactionData.members || {}).length,
                        statBrackets: enemyBracketCounts,
                        recommendedTargets: enemyTargetsMatched
                    } : null,
                    liveWarboardCache: wbSummary
                };
            }

            if (name === 'inspect_torn_player_or_faction') {
                if (!tornKey) return { error: 'No Torn API key available.' };
                const out = {};
                if (args.playerId && /^\d+$/.test(String(args.playerId).trim())) {
                    const pid = String(args.playerId).trim();
                    const [prof, ff] = await Promise.all([
                        fetch(`https://api.torn.com/user/${pid}?selections=profile,personalstats&key=${encodeURIComponent(tornKey)}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json()).catch(() => null),
                        getSingleFFStats(pid).catch(() => null)
                    ]);
                    if (prof && !prof.error) {
                        const ps = prof.personalstats || {};
                        out.player = {
                            id: prof.player_id,
                            name: prof.name,
                            level: prof.level,
                            rank: prof.rank,
                            age: prof.age,
                            status: prof.status,
                            lastAction: prof.last_action,
                            faction: prof.faction,
                            job: prof.job,
                            estimatedBattleStats: ff || null,
                            highlights: {
                                attacksWon: ps.attackswon,
                                defendsWon: ps.defendswon,
                                xanaxTaken: ps.xantaken,
                                refills: ps.refills,
                                seUsed: ps.statenhancersused,
                                networth: ps.networth,
                                criminalOffenses: ps.criminaloffenses
                            }
                        };
                    } else {
                        out.playerError = prof?.error?.error || 'Player not found';
                    }
                }
                if (args.factionId && /^\d+$/.test(String(args.factionId).trim())) {
                    const fid = String(args.factionId).trim();
                    const fac = await fetch(`https://api.torn.com/faction/${fid}?selections=basic,rankedwars&key=${encodeURIComponent(tornKey)}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json()).catch(() => null);
                    if (fac && !fac.error) {
                        const members = Object.entries(fac.members || {});
                        out.faction = {
                            id: fac.ID,
                            name: fac.name,
                            tag: fac.tag,
                            respect: fac.respect,
                            memberCount: members.length,
                            leader: fac.leader,
                            coLeader: fac['co-leader'],
                            rankedWarsCount: Object.keys(fac.rankedwars || {}).length,
                            topLevelMembers: members
                                .map(([id, m]) => ({ id, name: m.name, level: m.level, status: m.status?.state }))
                                .sort((a, b) => b.level - a.level)
                                .slice(0, 8)
                        };
                    } else {
                        out.factionError = fac?.error?.error || 'Faction not found';
                    }
                }
                return out;
            }

            if (name === 'get_faction_oc_and_armory') {
                if (!tornKey) return { error: 'No Torn API key available.' };
                const [ocRes, medRes, drugRes, boostRes] = await Promise.all([
                    fetch(`https://api.torn.com/v2/faction/${defaultFid}/crimes?cat=available&key=${encodeURIComponent(tornKey)}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json()).catch(() => null),
                    fetch(`https://api.torn.com/faction/${defaultFid}?selections=medical,drugs,boosters&key=${encodeURIComponent(tornKey)}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json()).catch(() => null)
                ]);
                const crimes = Array.isArray(ocRes?.crimes) ? ocRes.crimes : [];
                const ocSummary = crimes.slice(0, 12).map(c => ({
                    id: c.id,
                    name: c.name,
                    difficulty: c.difficulty,
                    status: c.status,
                    readyAt: c.ready_at ? new Date(c.ready_at * 1000).toUTCString() : null,
                    openSlots: (c.slots || []).filter(s => !s.user).map(s => `${s.position} (req ${s.checkpoint_pass_rate || 0}%+)`)
                }));
                return {
                    factionId: defaultFid,
                    ocAvailableCount: crimes.length,
                    ocList: ocSummary,
                    armory: {
                        medical: (medRes?.medical || []).slice(0, 10),
                        drugs: (medRes?.drugs || []).slice(0, 10),
                        boosters: (medRes?.boosters || []).slice(0, 10)
                    }
                };
            }

            if (name === 'get_torn_market_and_travel') {
                const out = {};
                if (args.itemQuery) {
                    const encMatch = fridayWikiForumRag.lookupEncyclopediaMatches(args.itemQuery);
                    if (encMatch) out.encyclopediaMatch = encMatch;
                    if (tornKey && /point/i.test(args.itemQuery)) {
                        const pm = await fetch(`https://api.torn.com/market/?selections=pointsmarket&key=${encodeURIComponent(tornKey)}`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null);
                        if (pm && pm.pointsmarket) {
                            const listings = Object.values(pm.pointsmarket).sort((a, b) => a.cost - b.cost);
                            out.pointsMarketLowest = listings[0] || null;
                        }
                    }
                }
                if (args.includeTravelTop !== false && typeof getCachedTravelItems === 'function') {
                    const travelData = await getCachedTravelItems().catch(() => null);
                    if (travelData && Array.isArray(travelData.items)) {
                        out.topTravelRuns = travelData.items
                            .filter(it => it.stock > 0 && it.profitPerHour > 0)
                            .sort((a, b) => b.profitPerHour - a.profitPerHour)
                            .slice(0, 6)
                            .map(it => ({
                                name: it.name,
                                country: it.country,
                                stock: it.stock,
                                buyCost: it.cost,
                                marketSell: it.marketPrice,
                                profitPerItem: it.profitPerItem,
                                profitPerHourAt29Cap: it.profitPerHour
                            }));
                    }
                }
                return out;
            }

            if (name === 'lookup_torn_wiki_and_encyclopedia') {
                const ev = await fridayWikiForumRag.gatherTornWikiAndForumEvidence(args.query || '', tornKey, gemKeys);
                for (const s of (ev.sources || [])) addSource(s.title, s.url);
                return {
                    evidence: ev.contextBlock || 'No exact Torn Wiki or Encyclopedia match found.',
                    sources: ev.sources || []
                };
            }

            if (name === 'search_and_read_torn_forums') {
                const ev = await fridayWikiForumRag.gatherTornWikiAndForumEvidence(
                    args.threadId ? `${args.query || ''} t=${args.threadId}` : (args.query || ''),
                    tornKey,
                    gemKeys
                );
                for (const s of (ev.sources || [])) addSource(s.title, s.url);
                return {
                    forumEvidence: ev.contextBlock || 'No matching Torn Forum threads found.',
                    sources: ev.sources || []
                };
            }

            if (name === 'fetch_torn_public_endpoint') {
                if (!tornKey) return { error: 'No Torn API key available.' };
                const safePath = isSafePublicTornPath(args.path);
                if (!safePath) return { error: 'Path blocked or invalid. Only read-only public torn/, market/, company/, property/, user/{id}, faction/{id} paths are allowed.' };
                const sep = safePath.includes('?') ? '&' : '?';
                const url = `https://api.torn.com/${safePath}${sep}key=${encodeURIComponent(tornKey)}`;
                const data = await fetch(url, { signal: AbortSignal.timeout(7000) }).then(r => r.json()).catch(e => ({ error: e.message }));
                // Truncate huge responses safely so context stays crisp
                const rawStr = JSON.stringify(data);
                if (rawStr.length > 6500) {
                    return { truncated: true, dataPreview: rawStr.slice(0, 6500) };
                }
                return data;
            }

            return { error: `Unknown tool: ${name}` };
        } catch (err) {
            return { error: err.message || 'Tool execution error' };
        }
    }

    return {
        executeTool,
        getCollectedSources: () => collectedSources.slice(0, 5)
    };
}

module.exports = {
    FUNCTION_DECLARATIONS,
    createFreeroamToolExecutor
};
