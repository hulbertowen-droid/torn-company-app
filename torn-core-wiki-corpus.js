'use strict';

/**
 * Authoritative Tier-1 Core Torn City Wiki Corpus (Current Meta: Stocks 3.0, Crimes 2.0, OC 2.0)
 *
 * Pre-indexed canonical section-level articles matching official wiki.torn.com pages
 * so F.R.I.D.A.Y. retrieves high-precision Torn mechanics in <5ms without hitting
 * Cloudflare-protected wiki.torn.com endpoints over raw HTTP.
 */

const LEGACY_BLOCK_PATTERNS = [
    /stocks?[_\s-]*2\.0/i,
    /stock_market_2/i,
    /crimes?[_\s-]*1\.0/i,
    /crimes?_\(old\)/i,
    /organized_crimes_1\.0/i,
    /\[crimes\s*1\.0\]/i,
    /\bold\s+stock\s+market\b/i,
    /\btcse\b.*?\b20(1\d|20)\b/i
];

function isLegacyOrDeprecatedSource(title = '', url = '', content = '') {
    const hay = `${title}\n${url}`;
    if (LEGACY_BLOCK_PATTERNS.some(rx => rx.test(hay))) return true;
    // Detect old forum/wiki guides talking exclusively about Stocks 2.0 / Crimes 1.0 era mechanics
    if (/\b(?:stocks?\s*2\.0|old\s+crimes?\s*1\.0|nerve\s+bar\s+arson\s+warehouse\s*1\.0)\b/i.test(content.slice(0, 800))) {
        return true;
    }
    return false;
}

const CORE_TORN_WIKI_PAGES = [
    {
        slug: 'Stock_Market',
        title: 'Torn Wiki: Stock Market (Stocks 3.0)',
        url: 'https://wiki.torn.com/wiki/Stock_Market',
        authorityWeight: 1.38,
        sections: [
            {
                header: 'Stocks 3.0 Benefit Blocks & Doubling Share Increments',
                keywords: ['stock', 'stocks', 'stocks 3.0', 'sym', 'symbiotic', 'fhg', 'mcs', 'prn', 'msc', 'lsc', 'mun', 'hrg', 'block', 'blocks', 'increment', 'increments', 'double', 'doubling', 'shares', 'drug pack', 'stack', 'stacking', 'active'],
                text: `Torn Stock Market (Stocks 3.0) offers Stock Benefit Blocks divided into Active dividends (recurring payouts) and Passive bonuses.

ACTIVE BENEFIT BLOCKS STACK VIA DOUBLING SHARE INCREMENTS:
- Active dividend blocks can be upgraded across multiple increments (level 1, 2, 3, 4...).
- Each additional increment costs DOUBLE the shares of the previous increment (Increment N requires 2^(N-1) x Base Shares, so cumulative shares for N increments = (2^N - 1) x Base Shares).
- Example — Symbiotic Ltd. (SYM, pays 1x Drug Pack every 7 days, base requirement = 500,000 shares):
  • 1st Increment (1x Drug Pack / 7d): 500,000 shares.
  • 2nd Increment (+1,000,000 shares = 1,500,000 total shares): 2x Drug Packs / 7d.
  • 3rd Increment (+2,000,000 shares = 3,500,000 total shares): 3x Drug Packs / 7d.
  • 4th Increment (+4,000,000 shares = 7,500,000 total shares): 4x Drug Packs / 7d.
- Same doubling formula applies to all other Active blocks: Feathery Hotel Group (FHG, 2M base -> +4M -> +8M), Munasen (MUN, 5M base), Pron Corp (PRN, 1M base -> +2M -> +4M), Mc Smoogle Corp (MCS, 1.75M base -> +3.5M -> +7M), Lucky Shots Casino (LSC), Evil Ducks Candy Corp (EVL), Insane Stunts (IIL), Tell Group Plc (TGP).`
            },
            {
                header: 'Passive Stock Blocks Non-Stacking & Unclaimed Dividend Timer Pause',
                keywords: ['passive', 'tci', 'wsu', 'wlt', 'tch', 'sys', 'tcp', 'ist', 'bag', 'cnc', 'msg', 'stack', 'unclaimed', 'dividend', 'dividends', 'pause', 'pauses', 'timer', 'collect', 'inactive', 'temporary', 'sell'],
                text: `PASSIVE STOCK BLOCKS DO NOT STACK:
- Passive stock blocks only provide their benefit once at Increment 1. You CANNOT stack passive blocks for multiple bonuses, and buying extra shares above Increment 1 grants zero additional passive benefit.
- Key Passive Blocks: Torn City Investments (TCI, 1,500,000 shares: +10% bank investment interest — single non-stacking block), West Side University (WSU, 1,000,000 shares: -10% education course time), Wind Lines Travel (WLT, 9,000,000 shares: Private Jet access), Torn City Health (TCH, +10% medical item cooldown reduction/effectiveness), SYScore (SYS, firewall), TCP (+10% company profit/passive), Bagged (BAG), Communication (CNC).

UNCLAIMED ACTIVE DIVIDENDS PAUSE TIMER (DO NOT STACK):
- Active dividends (like SYM Drug Packs or FHG Coupons) do NOT accumulate or stack automatically while unclaimed.
- Each active block requires a full continuous maturity window (7 days or 31 days) to generate ONE payout.
- Once a dividend is ready to collect, the countdown timer PAUSES/HALTS until you manually click Collect on the Stock Market page.
- If you go inactive for 3 weeks while holding SYM, only 1 unclaimed payout waits for you; the remaining weeks do not queue extra dividends because the timer stopped when the first payout became ready.

TEMPORARY BENEFIT RULE:
- Stock block benefits are active-only (temporary) perks: if you sell shares below your current increment threshold, the benefit (or extra increment) vanishes immediately and your holding timer resets.`
            }
        ]
    },
    {
        slug: 'Chain',
        title: 'Torn Wiki: Chain & Attacking Respect Mechanics',
        url: 'https://wiki.torn.com/wiki/Chain',
        authorityWeight: 1.38,
        sections: [
            {
                header: 'Chain Bonus Hits Flat Respect & Chain Timer',
                keywords: ['chain', 'bonus', 'bonus hit', 'flat', 'respect', '10', '25', '50', '100', '250', '500', '1000', '2500', '5000', '10000', '25000', '50000', '100000', 'fair fight', 'ff', 'war', 'retal', 'overseas', 'multipliers'],
                text: `Torn Faction Chains track consecutive successful faction attacks within a 5-minute (300-second) decay window (warmup: first 10 hits within 5 minutes total).

CHAIN BONUS HITS AWARD FLAT RESPECT (UNAFFECTED BY MULTIPLIERS):
- Milestone bonus hits earn strictly FLAT fixed respect, completely UNAFFECTED by Fair Fight, Overseas (1.25x), War (2.0x), Retaliation (1.5x), Group, Chain Scale, Defender Level, or Leave vs Mug vs Hospitalize:
  • Hit #10 = +10 flat respect
  • Hit #25 = +20 flat respect
  • Hit #50 = +40 flat respect
  • Hit #100 = +80 flat respect
  • Hit #250 = +160 flat respect
  • Hit #500 = +320 flat respect
  • Hit #1,000 = +640 flat respect
  • Hit #2,500 = +1,280 flat respect
  • Hit #5,000 = +2,560 flat respect
  • Hit #10,000 = +5,120 flat respect
  • Hit #25,000 = +10,240 flat respect
  • Hit #50,000 = +20,480 flat respect
  • Hit #100,000 = +40,960 flat respect
- Strategy: Because bonus hits replace normal hit respect with flat milestone respect and do NOT multiply by 3.00x Fair Fight or 1.25x Overseas, you should NEVER burn a high-value 3.00x Fair Fight or War/Overseas target on a bonus hit number — hit any quick target for the bonus hit, and save 3.00x FF / War / Overseas targets for regular chain hits.`
            },
            {
                header: 'Regular Hit Respect Multipliers & Overseas Bonus Rule',
                keywords: ['overseas', '1.25', 'abroad', 'fair fight', 'ff', 'base respect', 'leave', 'mug', 'hospitalize', 'hosp', 'war', 'retal', 'retaliation', 'group', 'chain scale'],
                text: `REGULAR (NON-BONUS) CHAIN HIT RESPECT & OVERSEAS BONUS:
- Base Respect depends on defender level (approx (ln(level) + 1) / 4, e.g. ~1.40 at Level 100, ~1.00 at Level 20, 0.25 at Level 1).
- Regular hits multiply Base Respect by:
  • Fair Fight (1.00x to 3.00x): Scales with defender/attacker battle stat score ratio (1 + (8/3) x (DefenderBSScore / AttackerBSScore), capped at 3.00x).
  • Chain Scale: 1.00x at hit 10 scaling logarithmically up to 2.00x at 100,000 hits.
  • Ranked War / Raiding: 2.00x on war targets.
  • Retaliation: 1.50x when hospitalizing an enemy within 5 minutes of their successful attack on your faction.
  • Group Attack: Up to 1.50x depending on number of participants.
  • Overseas Bonus (1.25x): Strictly applies ONLY when attacking a target while ABROAD in a foreign destination (Mexico, Cayman Islands, Canada, Hawaii, UK, Argentina, Switzerland, Japan, China, UAE, South Africa). Attacking a target inside Torn City NEVER receives the 1.25x Overseas multiplier.
- Finish Type Multipliers on regular hits: Leave = 100% respect (and 100% max XP); Hospitalize = 100% respect (~40% XP, required for Retaliation bonus); Mug = 75% respect (-25% respect penalty, ~57% XP). Each attack costs 25 Energy.`
            }
        ]
    },
    {
        slug: 'Gym',
        title: 'Torn Wiki: Gym, Happy Jumps & Permanent vs Active Perks',
        url: 'https://wiki.torn.com/wiki/Gym',
        authorityWeight: 1.38,
        sections: [
            {
                header: 'Happy Jump Mechanics, 10★ Adult Novelties Math & 99k Threshold',
                keywords: ['happy', 'jump', 'happy jump', 'edvd', 'e-dvd', 'erotic dvd', 'ecstasy', 'xtc', 'xanax', '99k', '60k', 'pi', 'private island', 'adult novelties', 'an', '10*', '10★', 'indecent', 'booster', 'cooldown'],
                text: `Torn Gym gains scale with Energy spent per click, Gym Dots, current Happy (significant multiplier below ~400k per stat), and Faction Steadfast + Company + Education + Property perks.

PRIVATE ISLAND & EROTIC DVD HAPPY JUMP MATH:
- A maxed Private Island (PI) with Yacht/Airstrip/Full Staff gives 5,025 base maximum Happy (4,525 without Yacht).
- Normal Erotic DVD (Item 366): +2,500 Happy and +6 hours Booster Cooldown.
- In a 10★ Adult Novelties (AN) Company: The 10★ Indecent passive DOUBLES (+100%) Happy from Erotic DVDs to +5,000 Happy per E-DVD (active-only while employed in a 10★ AN).
- 5 E-DVDs + Ecstasy in a 10★ AN does NOT reach 99k Happy:
  • Starting Happy (maxed PI): 5,025
  • + 5 E-DVDs in 10★ AN (5 x 5,000): +25,000 Happy -> 30,025 Happy pre-Ecstasy (uses 30h booster CD, requiring at least +6h/12h faction booster CD perk beyond base 24h max).
  • + 1 Ecstasy (2x multiplier): 30,025 x 2 = 60,050 Happy (~60k Happy, NOT 99,999!).
  • Without AN perk (standard +2,500/DVD): (5,025 + 12,500) x 2 = 35,050 Happy.
- How to hit 99,999 Happy ("99k Jump") with E-DVDs in 10★ AN:
  • Reaching 99,999 requires >= 50,000 pre-Ecstasy Happy -> 9 E-DVDs from 5,025 PI: 5,025 + (9 x 5,000) = 50,025 -> Ecstasy x2 = 99,999 (capped).
  • Consuming 9 E-DVDs (54h total booster CD added) requires a 48h faction booster cooldown limit (use 8 DVDs = 48:00h CD, wait 1 minute for CD <= 47:59, eat the 9th DVD, then immediately take Ecstasy).
- Quarter-hour Happy Reset Warning: Temporary Happy above your Property maximum resets on :00, :15, :30, and :45 clock ticks — always take Ecstasy and finish training within the same 15-minute window!
- Overdose Risk: Taking Ecstasy after stacking 4x Xanax (1,000 Energy) carries ~4% overdose chance, which wipes BOTH Energy and Happy to 0.`
            },
            {
                header: 'Permanent Unlocks vs Temporary Active-Only Perks & Company Opportunity Cost',
                keywords: ['permanent', 'temporary', 'active', 'keep', 'lose', 'unlock', 'george', "george's", 'gym experience', 'fitness center', 'adult novelties', 'an', 'job points', 'jp', 'opportunity cost', 'upkeep', 'education', 'merits'],
                text: `PERMANENT VS TEMPORARY (ACTIVE-ONLY) PERKS WHEN CHANGING COMPANIES:
- PERMANENT (YOU KEEP FOREVER):
  • Unlocked Gyms & accumulated Gym Experience: Once you spend enough Energy to unlock a gym (such as George's Gym or Heavyweight/Specialist gyms), that gym unlock and your spent gym progress stay unlocked permanently even if you change companies, factions, or properties.
  • Completed Education Courses (e.g., Sports Science +1% all gym gains, Combat Training, Intravenous Therapy).
  • Allocated Merits (e.g., Gym XP, Critical Hit, Drug/Booster upgrades if faction vs personal merits like Awareness/Edu Length/Masterful Looting).
- TEMPORARY / ACTIVE-ONLY (YOU LOSE IMMEDIATELY UPON LEAVING):
  • Company Specials & Passives: Leaving a 10★ Adult Novelties (AN) for a 10★ Fitness Center IMMEDIATELY removes AN's 10★ +100% E-DVD Happy boost (E-DVDs drop back to +2,500) and stops your AN Job Point generation. Conversely, while in Fitness Center you gain its active +3% gym stat gains / company specials only while employed there. (Saved unused AN Job Points remain stored in Torn's AN job point bank if you ever rejoin an AN later, though you cannot redeem them outside an AN.)
  • Faction Perks: Steadfast gym % bonuses, Toleration addiction/OD reduction, Voracity booster cooldown (+up to 24h) & candy % vanish immediately if you leave the faction.
  • Stock Benefit Blocks: Selling below block share count removes the perk immediately.

OPPORTUNITY COST COMPARISON (10★ ADULT NOVELTIES VS FITNESS CENTER):
- 10★ Adult Novelties generates 10 Job Points (JP) per day. The 3★ Voyeur special trades 20 JP for 1 free Erotic DVD = 1 free E-DVD every 2 days (3.5 E-DVDs/week passive income worth several million/week to use or sell).
- Leaving 10★ AN sacrifices BOTH the doubled Happy jumps (+5,000 vs +2,500 per E-DVD) AND the ~3.5 free E-DVDs/week JP income, plus pays daily company/PI upkeep while active vs gaining +3% flat gym gains in a 10★ Fitness Center (which generally overtakes AN Happy Jump efficiency once individual battle stats exceed ~400k–800k per stat, or once you switch out of Happy Jumping to regular 3 Xanax/day training).`
            }
        ]
    },
    {
        slug: 'Drugs',
        title: 'Torn Wiki: Drugs, Boosters & Cooldown Separation',
        url: 'https://wiki.torn.com/wiki/Drug',
        authorityWeight: 1.35,
        sections: [
            {
                header: 'Drug Cooldown vs Booster Cooldown & Cooldown Durations',
                keywords: ['drug', 'drugs', 'booster', 'boosters', 'cooldown', 'xanax', 'ecstasy', 'fhc', 'feathery hotel coupon', 'candy', 'can', 'energy can', 'stack', '1000e', 'od', 'overdose', 'addiction', 'rehab'],
                text: `DRUG COOLDOWN VS BOOSTER COOLDOWN:
- Drug Cooldown and Booster Cooldown are TWO SEPARATE independent cooldown timers:
  • Xanax: +250 Energy (can stack above natural cap up to 1,000 Energy), +50 to -150 Happy variance (average slight happy loss), 6h to 8h Drug Cooldown (~2–2.5% base OD chance, high addiction).
  • Ecstasy: Doubles (2x) current Happy, 3h to 4h Drug Cooldown (~4% base OD chance). Cannot be taken while Drug Cooldown > 0 (must wait for final stacked Xanax drug cooldown to hit 00:00 before taking Ecstasy).
  • Erotic DVD (Booster): +2,500 Happy (+5,000 in 10★ AN), +6h Booster Cooldown.
  • Feathery Hotel Coupon (FHC, Booster): Refills Energy bar (+100E or +150E Donator), +6h Booster Cooldown.
  • Energy Cans (Booster): +5E to +30E base (+50% with Voracity/faction/company specials), +2h Booster Cooldown.
  • Candy (Booster): +25 to +150 Happy base (+faction Voracity % perk), +30m (0.5h) Booster Cooldown.
- Booster Cooldown Limit Mechanic: Base max Booster Cooldown is 24h (up to 48h with full Faction +24h Toleration/Voracity booster perk). Torn lets you consume one final booster as long as your current Booster Cooldown is strictly below the max (e.g., at 23:59/24:00 or 47:59/48:00), allowing the last item to push total cooldown above max (up to 29:59 or 53:59).`
            }
        ]
    },
    {
        slug: 'Companies',
        title: 'Torn Wiki: Companies & Adult Novelties Specials',
        url: 'https://wiki.torn.com/wiki/Companies',
        authorityWeight: 1.35,
        sections: [
            {
                header: 'Adult Novelties Specials, Job Points & Star Rating Income',
                keywords: ['company', 'companies', 'adult novelties', 'an', '10*', '10★', 'voyeur', 'indecent', 'blackmail', 'bondage', 'party supplies', 'job point', 'job points', 'jp', 'fitness center', 'music store', 'sweet shop', 'candle shop'],
                text: `Torn Player-Owned Companies grant Job Points (JP) each day equal to the company's current star rating (10★ company = 10 JP/day).
- Adult Novelties (AN) Specials:
  • 1★ Blackmail (1 JP): Money.
  • 3★ Voyeur (20 JP): 1x Erotic DVD (at 10★ = 10 JP/day -> 1 free E-DVD every 2 days, or 3.5 E-DVDs/week!).
  • 5★ Party Supplies (500 JP): Pack of Cuban Cigars / Alcohol / Drug pack.
  • 7★ Bondage (Passive): 25% enemy speed reduction in fights.
  • 10★ Indecent (Passive): +100% Happy gained from Erotic DVDs (+2,500 becomes +5,000 Happy).
- Fitness Center Specials:
  • 1★ Healthy Mind (1 JP): Education time reduction (or happiness/fitness perks); 10★ Physique (+3% gym stat gains passive).
- All company passives (such as 10★ Indecent or Fitness Center +3% gym gains) are active-only temporary perks and cease immediately upon leaving the company or dropping below the required star rating.`
            }
        ]
    },
    {
        slug: 'Cracking',
        title: 'Torn Wiki: Cracking (Crimes 2.0)',
        url: 'https://wiki.torn.com/wiki/Cracking',
        authorityWeight: 1.38,
        sections: [
            {
                header: 'Cracking Rig Hardware, Global PSU Power, Per-Chassis Cooling & Heat Lock',
                keywords: ['cracking', 'crack', 'rig', 'chassis', 'psu', 'power supply', 'watt', 'power', 'fan', 'fans', 'cooling', 'heat sink', 'water block', 'heat', 'decay', '1%', '50%', '65%', 'remove', 'locked', 'unlock', 'cpu', 'gpu', 'asic', 'mips', 'office chair'],
                text: `Cracking is a Crimes 2.0 crime (unlocked sequentially via Nerve progression; Enhancer: Office Chair for +5% CE/CS gain; Brute-force costs 7 Nerve, Manual character guessing costs 5 Nerve).

CRACKING RIG POWER VS COOLING ARCHITECTURE:
- Multi-Chassis Rigs: As Cracking Crime Skill rises, you unlock up to 3 Chassis to house CPUs, GPUs, ASICs, Power Supply Units (PSUs), and Cooling components (Cooling Fans, Heat Sinks, Water Blocks).
- PSUs SHARE POWER GLOBALLY ACROSS ALL CHASSIS: A Power Supply Unit (PSU) placed in Chassis 1 (or any chassis) supplies wattage to your ENTIRE rig across Chassis 1, 2, and 3 combined. You only need enough total PSU wattage for total rig draw.
- COOLING FANS ONLY COOL THEIR OWN CHASSIS: Cooling components (Cooling Fans, Heat Sinks, Water Blocks) are STRICTLY LOCAL to the individual chassis they are installed inside. Extra cooling fans in Chassis 1 do NOT cool hot CPUs/GPUs in Chassis 2 — each chassis must carry its own cooling!
- PASSIVE HEAT DECAY (1% PER MINUTE): Component heat passively decays at 1% per real-time minute (each percentage point drops every 1 minute).
- 50% HEAT REMOVAL LOCK: Any component currently above 50% heat (>50% heat, such as 65% heat) is LOCKED in its slot and CANNOT be removed, replaced, or unequipped until it cools down to 50% heat or below (<=50%). Waiting at 1%/min decay from 65% to 50% takes 15 minutes.`
            }
        ]
    },
    {
        slug: 'Crimes_2.0',
        title: 'Torn Wiki: Crimes 2.0 & Pickpocketing',
        url: 'https://wiki.torn.com/wiki/Crimes',
        authorityWeight: 1.32,
        sections: [
            {
                header: 'Crimes 2.0 Crime Skill, Pickpocketing, Enhancers & Critical Failures',
                keywords: ['crimes 2.0', 'crime', 'crimes', 'cs', 'crime skill', 'pickpocketing', 'pickpocket', 'razor', 'cut-throat razor', 'critical failure', 'crit fail', 'nerve', 'level up', '100', 'enhancer'],
                text: `Crimes 2.0 uses per-crime Crime Skill (CS) from Level 1.00 to 100.00 across individual crimes (Search for Cash, Bootlegging, Graffiti, Shoplifting, Pickpocketing, Card Skimming, Burglary, Hustling, Disposal, Cracking, Forgery, Scamming, Arson).
- Nonlinear Skill Curve: Early levels (CS 1–40) advance quickly on few attempts, while mid/late levels (CS 50–100) scale steeply in attempts required per CS level.
- Critical Failures reduce progress within the current skill level (each critical failure pushes back significant attempts within that CS tier, making green/lower-risk targets much more nerve-efficient for leveling CS).
- Enhancers (+5% Crime Experience & CS gain per item owned): e.g. Cut-Throat Razor (Pickpocketing), Office Chair (Cracking), Lockpicks (Burglary), Card Skimmer, Spray Can, Blank Tokens, etc.`
            }
        ]
    }
];

module.exports = {
    CORE_TORN_WIKI_PAGES,
    LEGACY_BLOCK_PATTERNS,
    isLegacyOrDeprecatedSource
};
