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
        name: 'get_faction_roster_and_leaderboard',
        description: 'Get OUR faction\'s own member roster, Leader & Co-leaders, and top members ranked by battle stats (FF Scouter / Warboard) and level. ALWAYS call this when someone asks who in the faction is the strongest, highest stats, highest level, leader, or asks "who is that?" about faction members.',
        parameters: {
            type: 'object',
            properties: {
                factionId: {
                    type: 'string',
                    description: 'Optional Torn faction ID (defaults to our faction)'
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
        name: 'get_user_crime_and_level_analytics',
        description: 'Get the user\'s REAL personal Crimes 2.0 skills (exact 2-decimal CS), Torn API v2 per-crime lifetime attempts/successes/fails/critical fails/nerve spent, optional 30-day Full Access log stats if available, and exact nonlinear Crimes 2.0 projection (attempts, nerve, days to Target CS, and extra days/attempts cost by critical failures). ALWAYS call this when asked about personal crime skills, attempts/days to CS 100, crit-fail cost, or level progress.',
        parameters: {
            type: 'object',
            properties: {
                crimeName: {
                    type: 'string',
                    description: 'Optional specific crime slug/name (e.g. burglary, cracking, shoplifting, pickpocketing, bootlegging, graffiti, search_for_cash, card_skimming, hustling, disposal, forgery, scamming, arson)'
                },
                targetSkill: {
                    type: 'number',
                    description: 'Target Crime Skill level (2-100, defaults to 100)'
                },
                dailyNerve: {
                    type: 'number',
                    description: 'User specified daily nerve budget (e.g. 120). If omitted, estimates from user NNB.'
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

const CRIMES_V2_LIST = [
    [1, 'search_for_cash', 'Search for Cash'],
    [2, 'bootlegging', 'Bootlegging'],
    [3, 'graffiti', 'Graffiti'],
    [4, 'shoplifting', 'Shoplifting'],
    [5, 'pickpocketing', 'Pickpocketing'],
    [6, 'card_skimming', 'Card Skimming'],
    [7, 'burglary', 'Burglary'],
    [8, 'hustling', 'Hustling'],
    [9, 'disposal', 'Disposal'],
    [10, 'cracking', 'Cracking'],
    [11, 'forgery', 'Forgery'],
    [12, 'scamming', 'Scamming'],
    [13, 'arson', 'Arson']
];

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

function createFreeroamToolExecutor(deps) {
    const {
        getTornApiKey,
        getUserTornKey,
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
            if (name === 'get_faction_roster_and_leaderboard') {
                if (!tornKey) return { error: 'No Torn API key available.' };
                const facData = await fetch(`https://api.torn.com/faction/${defaultFid}?selections=basic&key=${encodeURIComponent(tornKey)}`, {
                    signal: AbortSignal.timeout(6500)
                }).then(r => r.json()).catch(() => null);
                if (!facData || facData.error || !facData.members) {
                    return { error: facData?.error?.error || 'Failed to fetch faction roster.' };
                }

                const memberIds = Object.keys(facData.members);
                const ffMap = await getBatchFFStats(memberIds).catch(() => new Map());
                const wb = getCachedWarboard(defaultFid);
                const wbFriendlyMap = new Map((wb?.friendly || []).map(m => [String(m.id || m.playerId), m]));

                const roster = Object.entries(facData.members).map(([id, m]) => {
                    const ff = ffMap.get(id);
                    const wbM = wbFriendlyMap.get(id);
                    const estStats = Number(ff?.total || wbM?.stats || 0);
                    return {
                        id,
                        name: m.name,
                        level: Number(m.level || 1),
                        position: m.position || 'Member',
                        daysInFaction: Number(m.days_in_faction || 0),
                        estStats,
                        estStatsHuman: ff?.human || (estStats > 0 && formatCompactStats ? formatCompactStats(estStats) : 'unknown'),
                        status: m.status?.state || 'Okay'
                    };
                });

                const leadership = roster.filter(m => /leader/i.test(m.position));
                const topByStats = [...roster]
                    .filter(m => m.estStats > 0)
                    .sort((a, b) => b.estStats - a.estStats)
                    .slice(0, 8)
                    .map(m => `${m.name} [${m.id}] (${m.position}, Lvl ${m.level}, ~${m.estStatsHuman} stats)`);
                const topByLevel = [...roster]
                    .sort((a, b) => b.level - a.level)
                    .slice(0, 6)
                    .map(m => `${m.name} [${m.id}] (Lvl ${m.level}, ${m.position})`);

                return {
                    factionId: defaultFid,
                    factionName: facData.name,
                    memberCount: roster.length,
                    leadership: leadership.map(m => `${m.name} [${m.id}] — ${m.position} (Lvl ${m.level}, ~${m.estStatsHuman} stats)`),
                    topByBattleStats: topByStats,
                    topByLevel
                };
            }

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

            if (name === 'get_user_crime_and_level_analytics') {
                const callerKey = (typeof getUserTornKey === 'function' ? getUserTornKey() : '') || tornKey;
                if (!callerKey) return { error: 'User has not linked their Torn API key yet.' };

                const reqCrimeRaw = String(args.crimeName || '').toLowerCase().replace(/[\s-]+/g, '_');
                const matchedEntry = reqCrimeRaw
                    ? CRIMES_V2_LIST.find(([, slug, cname]) => slug === reqCrimeRaw || cname.toLowerCase().includes(reqCrimeRaw.replace(/_/g, ' ')))
                    : null;

                const [skillsRes, keyInfoRes, profRes] = await Promise.all([
                    fetch(`https://api.torn.com/user/?selections=skills&key=${encodeURIComponent(callerKey)}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json()).catch(() => ({})),
                    fetch(`https://api.torn.com/key/?selections=info&key=${encodeURIComponent(callerKey)}`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => ({})),
                    fetch(`https://api.torn.com/user/?selections=basic,bars&key=${encodeURIComponent(callerKey)}`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => ({}))
                ]);

                const ki = keyInfoRes?.info || keyInfoRes || {};
                const accessType = String(ki.access_type || 'Limited Access');
                const accessLevel = Number(ki.access_level ?? 3);
                const hasFullLogs = accessLevel >= 4 || accessType.toLowerCase().includes('full');

                const targetCrimes = matchedEntry ? [matchedEntry] : CRIMES_V2_LIST;
                const v2List = await Promise.all(
                    targetCrimes.map(([cid, slug, cname]) =>
                        fetch(`https://api.torn.com/v2/user/${cid}/crimes?key=${encodeURIComponent(callerKey)}`, { signal: AbortSignal.timeout(6000) })
                            .then(r => r.json())
                            .then(d => ({ cid, slug, cname, c: d?.crimes || null }))
                            .catch(() => ({ cid, slug, cname, c: null }))
                    )
                );

                // Optional 30-day Full Access log check if caller has a Full Access key linked
                let log30dSummary = null;
                if (hasFullLogs) {
                    const cutoff30d = Math.floor(Date.now() / 1000) - 30 * 86400;
                    const lRes = await fetch(`https://api.torn.com/user/?selections=log&cat=136&from=${cutoff30d}&key=${encodeURIComponent(callerKey)}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json()).catch(() => null);
                    if (lRes && lRes.log) {
                        const entries = Object.values(lRes.log);
                        log30dSummary = {
                            recentCrimeLogsFetched: entries.length,
                            note: '30-day Full Access /user/log entries fetched (oldest in latest 100-batch).'
                        };
                    }
                }

                const dailyNerve = Math.max(24, Number(args.dailyNerve || 0) || Math.min(265, Math.max(96, Math.round(Number(profRes?.nerve?.maximum || 60) * 3.9 + 30))));
                const targetSkill = Math.max(2, Math.min(100, Number(args.targetSkill || 100)));

                const crimeReports = [];
                for (const { slug, cname, c } of v2List) {
                    const exactCS = skillsRes && skillsRes[slug] !== undefined
                        ? Number(skillsRes[slug])
                        : Number(c?.skill || 0);
                    const totalAtt = Number(c?.attempts?.total || 0);
                    const successes = Number(c?.attempts?.success || 0);
                    const fails = Number(c?.attempts?.fail || 0);
                    const critFails = Number(c?.attempts?.critical_fail || 0);
                    const nerveSpent = Number(c?.nerve_spent || 0);
                    const avgNerve = totalAtt > 0 && nerveSpent > 0 ? (nerveSpent / totalAtt) : 4.0;
                    const cfRate = totalAtt > 0 ? (critFails / totalAtt) : 0;

                    const cumW = cumulativeCrimeCurveWeight(exactCS);
                    const baseRate = (totalAtt >= 12 && exactCS > 1.05 && cumW > 0.2)
                        ? Math.max(1.2, totalAtt / cumW)
                        : 11.5;

                    const curFloor = Math.floor(exactCS);
                    const partial = exactCS - curFloor;
                    let cleanAttemptsNeeded = 0;
                    if (exactCS < targetSkill) {
                        for (let lvl = curFloor; lvl < targetSkill; lvl++) {
                            const frac = lvl === curFloor ? Math.max(0.05, 1 - partial) : 1;
                            cleanAttemptsNeeded += Math.max(2, baseRate * crimeCurveFactor(lvl + 0.5)) * frac;
                        }
                    }

                    // Each critical failure in Crimes 2.0 sets back ~42% of a level's attempts at that CS.
                    // Because baseRate is calibrated on totalAtt (which ALREADY includes historical CF drag),
                    // calculate both: (a) crit-free baseline vs current-CF rate, and (b) extra days attributable to CF drag!
                    const cfDragMultiplier = 1 + cfRate * 3.5;
                    const attemptsWithCurrentCF = Math.ceil(cleanAttemptsNeeded);
                    const attemptsWithoutCF = Math.ceil(cleanAttemptsNeeded / cfDragMultiplier);
                    const extraAttemptsFromCF = Math.max(0, attemptsWithCurrentCF - attemptsWithoutCF);

                    const nerveNeeded = Math.ceil(attemptsWithCurrentCF * avgNerve);
                    const daysNeeded = Number((nerveNeeded / dailyNerve).toFixed(1));
                    const extraNerveFromCF = Math.ceil(extraAttemptsFromCF * avgNerve);
                    const extraDaysFromCF = Number((extraNerveFromCF / dailyNerve).toFixed(1));

                    crimeReports.push({
                        crime: cname,
                        slug,
                        currentSkill: Number(exactCS.toFixed(2)),
                        targetSkill,
                        lifetimeAttempts: totalAtt,
                        successes,
                        fails,
                        criticalFails: critFails,
                        critFailRatePct: Number((cfRate * 100).toFixed(2)),
                        lifetimeNerveSpent: nerveSpent,
                        observedAvgNervePerAttempt: Number(avgNerve.toFixed(2)),
                        dailyNerveAssumed: dailyNerve,
                        estAttemptsRemaining: attemptsWithCurrentCF,
                        estNerveRemaining: nerveNeeded,
                        estDaysRemaining: daysNeeded,
                        estExtraAttemptsFromCritFails: extraAttemptsFromCF,
                        estExtraDaysFromCritFails: extraDaysFromCF
                    });
                }

                return {
                    player: profRes?.name ? `${profRes.name} [${profRes.player_id}]` : 'Player',
                    keyAccessType: accessType,
                    hasFull30dLogs: hasFullLogs,
                    log30dSummary,
                    note: hasFullLogs
                        ? 'Calculated from your live Torn skills + v2 crime telemetry + Full Access log check.'
                        : 'Your linked key is Limited Access (which blocks /user/log 30-day filtering), so these exact projections are computed from your real Torn API v2 lifetime crime telemetry (/v2/user/{id}/crimes). You can also sync 30-day logs locally on https://faction-os.duckdns.org/crimes.html.',
                    crimeReports
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
                        if (travelData.pointMarketPrice) out.pointMarketPrice = travelData.pointMarketPrice;
                        if (travelData.bctMarketPrice) out.bctMarketPrice = travelData.bctMarketPrice;
                        out.dataSource = travelData.dataSource || 'yata+prom';
                        out.topTravelRuns = travelData.items
                            .filter(it => Number(it.stock || 0) > 0 && Number(it.profitPerHr || 0) > 0 && it.liquidityTier !== 'trap')
                            .sort((a, b) => Number(b.profitPerHr || 0) - Number(a.profitPerHr || 0))
                            .slice(0, 8)
                            .map(it => ({
                                name: it.name,
                                category: it.category,
                                liquidityTier: it.liquidityTier,
                                country: it.country,
                                stock: it.stock,
                                buyCost: it.cost,
                                marketSell: it.marketPrice,
                                profitPerItem: it.profit,
                                profitPerHourAt29Cap: Math.round(Number(it.profitPerHr || 0)),
                                roundTripMinsAirstrip: it.roundTrip
                            }));
                    }
                }
                return Object.keys(out).length ? out : { note: 'No matching live market/travel data available right now.' };
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
