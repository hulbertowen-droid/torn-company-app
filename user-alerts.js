/**
 * F.R.I.D.A.Y. - Personal Discord DM Notification Sentinel
 * 
 * Provides:
 * - 100% Opt-In personal DM notifications for users who have linked their API key.
 * - Granular toggles: Drug Cooldown (Xanax timer), Travel Landing (~2m alert), Energy Full, Nerve Full, Hospital Discharge.
 * - Interactive Discord UI control card with live toggle buttons.
 * - Resilient background poller respecting Torn API rate limits (monitors only users with active alerts).
 * - Anti-spam state machine preventing duplicate or repeated DMs.
 * - Persistence to local disk and MongoDB Atlas (`AppConfig.userAlertPrefs`).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const UI = require('./friday-ui');

const PREFS_FILE = path.join(__dirname, 'data', 'user_alert_prefs.json');

// In-memory store: discordUserId => { drug: false, travel: false, energy: false, nerve: false, hospital: false }
const alertPrefsStore = new Map();

// In-memory transient state per user to prevent duplicate notifications:
// discordUserId => { lastDrugSec, lastDrugAlertedTs, lastTravelDest, alertedLandingFlight, lastEnergyFull, lastNerveFull, lastHospState }
const alertRuntimeStates = new Map();

let onSaveCallback = null;
function setMongoSaveCallback(cb) {
    onSaveCallback = cb;
}

const DEFAULT_PREFS = {
    drug: false,
    travel: false,
    energy: false,
    nerve: false,
    hospital: false,
    booster: false,
    medical: false,
    education: false,
    reset_reminder: false,
    travel_restock: false
};

const DEFAULT_TRAVEL_WATCH = Object.freeze({
    country: 'zaf',
    itemQuery: 'Xanax',
    minQty: 500
});

/**
 * Load preferences from local disk on startup.
 */
function loadPrefsFromDisk() {
    try {
        if (fs.existsSync(PREFS_FILE)) {
            const raw = fs.readFileSync(PREFS_FILE, 'utf8');
            const dataObj = JSON.parse(raw);
            let count = 0;
            for (const [userId, prefs] of Object.entries(dataObj)) {
                if (userId && typeof prefs === 'object') {
                    alertPrefsStore.set(String(userId), { ...DEFAULT_PREFS, ...prefs });
                    count++;
                }
            }
            console.log(`[UserAlerts] Loaded personal alert preferences for ${count} user(s) from disk.`);
        }
    } catch (err) {
        console.error('[UserAlerts] Error loading preferences from disk:', err.message);
    }
}

/**
 * Save preferences to local disk.
 */
function savePrefsToDisk() {
    try {
        const dir = path.dirname(PREFS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const dataObj = {};
        for (const [userId, prefs] of alertPrefsStore.entries()) {
            dataObj[userId] = prefs;
        }
        fs.writeFileSync(PREFS_FILE, JSON.stringify(dataObj, null, 2), 'utf8');

        if (typeof onSaveCallback === 'function') {
            onSaveCallback();
        }
    } catch (err) {
        console.error('[UserAlerts] Error saving preferences to disk:', err.message);
    }
}

/**
 * Export preferences for MongoDB Atlas storage.
 */
function exportPrefsForMongo() {
    const dataObj = {};
    for (const [userId, prefs] of alertPrefsStore.entries()) {
        dataObj[userId] = prefs;
    }
    return dataObj;
}

/**
 * Import preferences from MongoDB Atlas.
 */
function importPrefsFromMongo(saved) {
    if (!saved || typeof saved !== 'object') return;
    let count = 0;
    for (const [userId, prefs] of Object.entries(saved)) {
        if (userId && typeof prefs === 'object') {
            alertPrefsStore.set(String(userId), { ...DEFAULT_PREFS, ...prefs });
            count++;
        }
    }
    if (count > 0) {
        console.log(`[UserAlerts] Restored personal alert preferences for ${count} user(s) from MongoDB.`);
        savePrefsToDisk();
    }
}

/**
 * Get user alert preferences (defaults to false for all features).
 */
function getUserAlertPrefs(discordUserId) {
    if (!discordUserId) return { ...DEFAULT_PREFS };
    const dId = String(discordUserId);
    if (!alertPrefsStore.has(dId)) {
        return { ...DEFAULT_PREFS };
    }
    return { ...DEFAULT_PREFS, ...alertPrefsStore.get(dId) };
}

/**
 * Toggle a specific alert preference for a user.
 */
function toggleUserAlertPref(discordUserId, featureKey) {
    if (!discordUserId || !DEFAULT_PREFS.hasOwnProperty(featureKey)) return null;
    const dId = String(discordUserId);
    const current = getUserAlertPrefs(dId);
    current[featureKey] = !current[featureKey];
    alertPrefsStore.set(dId, current);
    savePrefsToDisk();
    return current;
}

function getTravelWatchRule(discordUserId) {
    if (!discordUserId) return { ...DEFAULT_TRAVEL_WATCH };
    const stored = alertPrefsStore.get(String(discordUserId));
    return {
        ...DEFAULT_TRAVEL_WATCH,
        ...(stored?.travelWatch && typeof stored.travelWatch === 'object' ? stored.travelWatch : {})
    };
}

function setTravelWatchRule(discordUserId, rule = {}) {
    if (!discordUserId) return null;
    const dId = String(discordUserId);
    const existing = alertPrefsStore.get(dId) || { ...DEFAULT_PREFS };
    const nextRule = {
        country: String(rule.country || existing.travelWatch?.country || 'zaf').toLowerCase().trim(),
        itemQuery: String(rule.itemQuery || existing.travelWatch?.itemQuery || 'Xanax').trim(),
        minQty: Math.max(1, Number(rule.minQty ?? existing.travelWatch?.minQty ?? 500) || 500)
    };
    const updated = {
        ...DEFAULT_PREFS,
        ...existing,
        travel_restock: rule.enable === false ? existing.travel_restock : true,
        travelWatch: nextRule
    };
    alertPrefsStore.set(dId, updated);
    savePrefsToDisk();
    return updated;
}

/**
 * Build interactive Discord embed and buttons for user alert preferences.
 */
function buildAlertsControlCard(discordUserId, playerInfo = null) {
    const prefs = getUserAlertPrefs(discordUserId);
    const watchRule = getTravelWatchRule(discordUserId);
    const nameLabel = playerInfo?.playerName 
        ? `**[${playerInfo.playerName} [${playerInfo.playerId}]](https://www.torn.com/profiles.php?XID=${playerInfo.playerId})**`
        : `Your Account`;

    const statusBadge = (on) => on ? '`🟢 ON`' : '`⚪ OFF`';

    const embed = {
        title: '🔔 Personal Discord DM Notification Sentinel',
        description: `Configure private direct messages from **F.R.I.D.A.Y.** for ${nameLabel}.\n` +
            `🔒 **Strict Opt-In Privacy:** All notifications start **OFF** until you enable them.\n\n` +
            `**Core Vitals & Travel Alerts:**\n` +
            `• 💊 **Drug / Xanax CD:** ${statusBadge(prefs.drug)} — DMs when drug CD hits \`0:00\`\n` +
            `• ✈️ **Flight Landing:** ${statusBadge(prefs.travel)} — DMs ~2-3m before touchdown\n` +
            `• ⚡ **Natural Energy Full:** ${statusBadge(prefs.energy)} — DMs at max energy cap\n` +
            `• 🎯 **Nerve Bar Full:** ${statusBadge(prefs.nerve)} — DMs at max nerve cap\n` +
            `• 🏥 **Hospital Discharge:** ${statusBadge(prefs.hospital)} — DMs when revived/discharged\n\n` +
            `**Daily Loop & Restock Alerts (New):**\n` +
            `• 🥤 **Booster CD:** ${statusBadge(prefs.booster)} — DMs when Beer/Candy/FHC CD clears\n` +
            `• 🩸 **Medical CD:** ${statusBadge(prefs.medical)} — DMs when Med CD hits \`0:00\`\n` +
            `• 🎓 **Education Finish:** ${statusBadge(prefs.education)} — DMs when course finishes\n` +
            `• ⏰ **23:30 TCT Reset:** ${statusBadge(prefs.reset_reminder)} — Pre-reset nudge if refill/Xanax unused\n` +
            `• 🌍 **Travel Restock:** ${statusBadge(prefs.travel_restock)} — Watching **${watchRule.country.toUpperCase()}** \`${watchRule.itemQuery}\` >= **${watchRule.minQty}x**`,
        color: UI.COLORS.BRAND,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };

    const row1 = UI.actionRow(
        prefs.drug ? UI.successBtn('toggle_alert_drug', 'Drug', '💊') : UI.secondaryBtn('toggle_alert_drug', 'Drug', '💊'),
        prefs.travel ? UI.successBtn('toggle_alert_travel', 'Flight', '✈️') : UI.secondaryBtn('toggle_alert_travel', 'Flight', '✈️'),
        prefs.energy ? UI.successBtn('toggle_alert_energy', 'Energy', '⚡') : UI.secondaryBtn('toggle_alert_energy', 'Energy', '⚡'),
        prefs.nerve ? UI.successBtn('toggle_alert_nerve', 'Nerve', '🎯') : UI.secondaryBtn('toggle_alert_nerve', 'Nerve', '🎯'),
        prefs.hospital ? UI.successBtn('toggle_alert_hospital', 'Hosp', '🏥') : UI.secondaryBtn('toggle_alert_hospital', 'Hosp', '🏥')
    );

    const row2 = UI.actionRow(
        prefs.booster ? UI.successBtn('toggle_alert_booster', 'Booster', '🥤') : UI.secondaryBtn('toggle_alert_booster', 'Booster', '🥤'),
        prefs.medical ? UI.successBtn('toggle_alert_medical', 'Medical', '🩸') : UI.secondaryBtn('toggle_alert_medical', 'Medical', '🩸'),
        prefs.education ? UI.successBtn('toggle_alert_education', 'Edu', '🎓') : UI.secondaryBtn('toggle_alert_education', 'Edu', '🎓'),
        prefs.reset_reminder ? UI.successBtn('toggle_alert_reset_reminder', 'Reset', '⏰') : UI.secondaryBtn('toggle_alert_reset_reminder', 'Reset', '⏰'),
        prefs.travel_restock ? UI.successBtn('toggle_alert_travel_restock', 'Restock', '🌍') : UI.secondaryBtn('toggle_alert_travel_restock', 'Restock', '🌍')
    );

    const row3 = UI.actionRow(
        UI.primaryBtn('test_user_dm', 'Test DM', '🧪'),
        UI.secondaryBtn('alert_preset_zaf_xanax', 'ZA Xanax >=500', '🇿🇦'),
        UI.secondaryBtn('alert_preset_plushie_200', 'Plush/Flower >=200', '🧸')
    );

    return { embed, components: [row1, row2, row3] };
}

function evaluateExtendedAlertEvents(prefs = {}, rState = {}, stats = {}, options = {}) {
    const events = [];
    const now = Number(options.nowMs) || Date.now();
    const cds = stats?.cooldowns || {};
    const edu = stats?.education || {};
    const refills = stats?.refills || {};

    // 1. Booster cooldown clear
    const curBoost = Number(cds.booster ?? 0);
    if (prefs.booster && typeof rState.lastBoosterSec === 'number' && rState.lastBoosterSec > 0 && curBoost === 0) {
        if (!rState.lastBoosterAlertTs || (now - rState.lastBoosterAlertTs) > 10 * 60 * 1000) {
            rState.lastBoosterAlertTs = now;
            events.push({
                type: 'booster',
                embed: UI.embed({
                    color: UI.COLORS.SUCCESS,
                    title: '🥤 Booster Cooldown Ready!',
                    description: 'Your **Booster Cooldown** just hit `00:00` — ready for Beer, Candy, or Feathery Hotel Coupons!',
                    fields: [
                        { name: '⚡ Energy', value: `${stats.energy?.current ?? 0}/${stats.energy?.maximum ?? 150}`, inline: true },
                        { name: '😁 Happy', value: `${stats.happy?.current ?? 0}/${stats.happy?.maximum ?? 100}`, inline: true }
                    ]
                })
            });
        }
    }
    rState.lastBoosterSec = curBoost;

    // 2. Medical cooldown clear
    const curMed = Number(cds.medical ?? 0);
    if (prefs.medical && typeof rState.lastMedSec === 'number' && rState.lastMedSec > 0 && curMed === 0) {
        if (!rState.lastMedAlertTs || (now - rState.lastMedAlertTs) > 10 * 60 * 1000) {
            rState.lastMedAlertTs = now;
            events.push({
                type: 'medical',
                embed: UI.embed({
                    color: UI.COLORS.SUCCESS,
                    title: '🩸 Medical Cooldown Cleared!',
                    description: 'Your **Medical Cooldown** reached `00:00` — safe to use Blood Bags or Medkits again.'
                })
            });
        }
    }
    rState.lastMedSec = curMed;

    // 3. Education course completion
    const curEduCourse = Number(edu.current_course ?? 0);
    const curEduLeft = Number(edu.time_left_seconds ?? 0);
    const completedTransition =
        (typeof rState.lastEduLeftSec === 'number' && rState.lastEduLeftSec > 0 && curEduLeft === 0) ||
        (typeof rState.lastEduCourse === 'number' && rState.lastEduCourse > 0 && curEduCourse === 0);
    if (prefs.education && completedTransition) {
        if (!rState.lastEduAlertTs || (now - rState.lastEduAlertTs) > 60 * 60 * 1000) {
            rState.lastEduAlertTs = now;
            events.push({
                type: 'education',
                embed: UI.embed({
                    color: UI.COLORS.INFO,
                    title: '🎓 Education Course Completed!',
                    description: 'Your Torn Education course has finished! Start your next course immediately so zero study hours go wasted.\n[Open Torn Education](https://www.torn.com/education.php)'
                })
            });
        }
    }
    rState.lastEduCourse = curEduCourse;
    rState.lastEduLeftSec = curEduLeft;

    // 4. Daily TCT Reset Reminder (23:30 - 23:59 TCT)
    const d = new Date(now);
    const utcH = d.getUTCHours();
    const utcM = d.getUTCMinutes();
    const todayTct = d.toISOString().slice(0, 10);
    if (prefs.reset_reminder && utcH === 23 && utcM >= 30 && rState.lastResetReminderDate !== todayTct) {
        rState.lastResetReminderDate = todayTct;
        const unusedRefill = refills && refills.energy_refill_used === false;
        const clearDrug = Number(cds.drug ?? 0) === 0;
        if (unusedRefill || clearDrug) {
            const notes = [];
            if (unusedRefill) notes.push('• ⚡ Daily **Energy Refill** is still unused!');
            if (clearDrug) notes.push('• 💊 Your **Drug Cooldown** is `00:00` — Xanax window open!');
            events.push({
                type: 'reset_reminder',
                embed: UI.embed({
                    color: UI.COLORS.GOLD,
                    title: '⏰ Daily TCT Reset Reminder (<30m Left!)',
                    description: `New Torn day rolls over at \`00:00 TCT\`:\n\n${notes.join('\n')}`
                })
            });
        }
    }

    // 5. Overseas Travel Restock Surge via YATA cache
    const yataStocks = options.yataStocks;
    if (prefs.travel_restock && yataStocks && yataStocks.stocks) {
        const rule = prefs.travelWatch && typeof prefs.travelWatch === 'object'
            ? { ...DEFAULT_TRAVEL_WATCH, ...prefs.travelWatch }
            : { ...DEFAULT_TRAVEL_WATCH };
        const minQty = Math.max(1, Number(rule.minQty) || 500);
        const query = String(rule.itemQuery || 'Xanax').trim().toLowerCase();
        const isPlushFlowerPreset = query === 'plushies' || query === 'plushie|flower';
        const countryEntries = rule.country === 'all'
            ? Object.entries(yataStocks.stocks)
            : (yataStocks.stocks[rule.country] ? [[rule.country, yataStocks.stocks[rule.country]]] : []);

        if (!rState.lastRestockAlertTs) rState.lastRestockAlertTs = {};
        if (!rState.lastRestockAbove) rState.lastRestockAbove = {};

        for (const [cCode, cObj] of countryEntries) {
            const stockList = Array.isArray(cObj?.stocks) ? cObj.stocks : [];
            for (const item of stockList) {
                const iName = String(item?.name || '').trim();
                const iLower = iName.toLowerCase();
                const nameMatches = isPlushFlowerPreset
                    ? (iLower.includes('plushie') || iLower.includes('flower') || iLower.includes('orchid') || iLower.includes('peony') || iLower.includes('rose') || iLower.includes('lotus') || iLower.includes('protea') || iLower.includes('dahlia'))
                    : iLower.includes(query);
                if (!nameMatches) continue;

                const qty = Number(item.quantity || 0);
                const k = `${cCode}_${item.id || iLower}`;
                const wasAbove = Boolean(rState.lastRestockAbove[k]);
                const lastSent = Number(rState.lastRestockAlertTs[k] || 0);
                if (qty >= minQty) {
                    rState.lastRestockAbove[k] = true;
                    if (!wasAbove || (now - lastSent) > 30 * 60 * 1000) {
                        rState.lastRestockAlertTs[k] = now;
                        events.push({
                            type: 'travel_restock',
                            embed: UI.embed({
                                color: UI.COLORS.SUCCESS,
                                title: `🌍 Overseas Restock Surge: ${iName}`,
                                description: `**${String(cCode).toUpperCase()}** just restocked **${qty.toLocaleString()}x ${iName}** (cost: \`$${Number(item.cost || 0).toLocaleString()}\`)!\n[Open Travel Agency](https://www.torn.com/travelagency.php)`
                            })
                        });
                    }
                } else {
                    rState.lastRestockAbove[k] = false;
                }
            }
        }
    }

    return events;
}

startUserAlertsWorker.evaluateExtendedAlertEvents = evaluateExtendedAlertEvents;
startUserAlertsWorker.getTravelWatchRule = getTravelWatchRule;
startUserAlertsWorker.setTravelWatchRule = setTravelWatchRule;

/**
 * Background Alert Poller:
 * Checks users who have at least one notification enabled and a linked API key.
 */
let isWorkerRunning = false;

function startUserAlertsWorker(discordClient, userKeys, workerOpts = {}) {
    if (isWorkerRunning) return;
    isWorkerRunning = true;
    console.log('[UserAlerts] Personal DM notification worker active (30s cadence for opted-in users).');

    setInterval(async () => {
        try {
            if (!discordClient || !discordClient.isReady()) return;

            const activeSubscribers = [];
            for (const [discordId, prefs] of alertPrefsStore.entries()) {
                if (prefs.drug || prefs.travel || prefs.energy || prefs.nerve || prefs.hospital ||
                    prefs.booster || prefs.medical || prefs.education || prefs.reset_reminder || prefs.travel_restock) {
                    activeSubscribers.push({ discordId, prefs });
                }
            }

            if (activeSubscribers.length === 0) return;

            let yataStocksCache = null;
            if (activeSubscribers.some(s => s.prefs?.travel_restock) && typeof workerOpts.getLiveYataStocks === 'function') {
                yataStocksCache = await workerOpts.getLiveYataStocks().catch(() => null);
            }

            for (const sub of activeSubscribers) {
                const { discordId, prefs } = sub;

                const resolved = userKeys.resolveUserApiKey(discordId);
                if (!resolved || !resolved.key) continue;

                if (!alertRuntimeStates.has(discordId)) {
                    alertRuntimeStates.set(discordId, {
                        lastDrugSec: null,
                        lastDrugAlertedTs: 0,
                        lastTravelFlight: null,
                        lastEnergyFull: false,
                        lastNerveFull: false,
                        lastHospitalState: null,
                        lastBoosterSec: null,
                        lastMedSec: null,
                        lastEduLeftSec: null,
                        lastEduCourse: null,
                        lastResetReminderDate: null,
                        lastRestockAlertTs: {},
                        lastRestockAbove: {},
                        initialized: false
                    });
                }
                const rState = alertRuntimeStates.get(discordId);

                const stats = await userKeys.fetchUserLiveStats(resolved.key);
                if (!stats) continue;

                if (!rState.initialized) {
                    rState.lastDrugSec = stats.cooldowns.drug;
                    rState.lastTravelFlight = stats.travel.isTraveling ? stats.travel.destination : null;
                    rState.lastEnergyFull = stats.energy.isFull || (stats.energy.current >= stats.energy.maximum);
                    rState.lastNerveFull = stats.nerve.isFull || (stats.nerve.current >= stats.nerve.maximum);
                    rState.lastHospitalState = stats.status.state;
                    rState.lastBoosterSec = stats.cooldowns?.booster ?? 0;
                    rState.lastMedSec = stats.cooldowns?.medical ?? 0;
                    rState.lastEduLeftSec = stats.education?.time_left_seconds ?? 0;
                    rState.lastEduCourse = stats.education?.current_course ?? 0;
                    rState.initialized = true;
                    continue;
                }

                // Extended daily-loop & travel restock alerts (Package C)
                const extEvents = evaluateExtendedAlertEvents(prefs, rState, stats, {
                    nowMs: Date.now(),
                    yataStocks: yataStocksCache
                });
                if (extEvents.length > 0) {
                    const user = await discordClient.users.fetch(discordId).catch(() => null);
                    if (user) {
                        for (const ev of extEvents) {
                            await user.send({ embeds: [ev.embed] }).catch(() => {});
                        }
                    }
                }

                // Helper to send DM safely
                const sendDM = async (embedObj) => {
                    try {
                        const user = await discordClient.users.fetch(discordId).catch(() => null);
                        if (!user) return false;
                        await user.send({ embeds: [embedObj] });
                        return true;
                    } catch (dmErr) {
                        if (dmErr.code === 50007) {
                            console.warn(`[UserAlerts] Cannot send DM to user ${discordId} (DMs closed or bot blocked).`);
                        } else {
                            console.warn(`[UserAlerts] Failed to send DM to user ${discordId}:`, dmErr.message);
                        }
                        return false;
                    }
                };

                // ── 1. Drug Cooldown Alert ──
                if (prefs.drug) {
                    const currentDrug = stats.cooldowns.drug; // seconds remaining
                    const now = Date.now();

                    // Alert when drug cooldown reaches 0 from a previous positive timer
                    if (currentDrug === 0 && (rState.lastDrugSec === null || rState.lastDrugSec > 0)) {
                        // Prevent re-triggering within 15 minutes of the same alert
                        if (now - rState.lastDrugAlertedTs > 15 * 60 * 1000) {
                            const dmEmbed = {
                                title: '💊 Drug Cooldown Complete — Ready for Xanax!',
                                description: `Hey **${stats.playerName}**, your drug cooldown has reached **0:00**!\n\n` +
                                    `⚡ You are completely clear to take **Xanax** or another drug right now without wasting training time.\n\n` +
                                    `[**Open Torn Drugs Inventory**](https://www.torn.com/item.php#drugs-items)`,
                                color: UI.COLORS.SUCCESS,
                                footer: UI.FOOTER,
                                timestamp: new Date().toISOString()
                            };
                            await sendDM(dmEmbed);
                            rState.lastDrugAlertedTs = now;
                        }
                    }
                    rState.lastDrugSec = currentDrug;
                }

                // ── 2. Travel Landing Alert (~2-3 mins before landing) ──
                if (prefs.travel) {
                    const t = stats.travel;
                    if (t.isTraveling && t.timeLeftSeconds > 0) {
                        const currentFlight = `${t.destination}_${t.timeLeftSeconds > 240 ? 'air' : 'landing'}`;
                        if (t.timeLeftSeconds <= 180 && rState.alertedLandingFlight !== t.destination) {
                            const dmEmbed = {
                                title: `✈️ Flight Landing Imminent — ~${t.timeLeftMinutes || 1}m to ${t.destination}`,
                                description: `Hey **${stats.playerName}**, your flight is about to touchdown in **${t.destination}** in approximately **~${t.timeLeftMinutes || 1} minute(s)**!\n\n` +
                                    `🛬 **Action Recommended:**\n` +
                                    `• Be on the overseas page to purchase items immediately.\n` +
                                    `• If landing back in Torn City, deposit cash into the faction vault immediately to avoid hospital muggers.\n\n` +
                                    `[**Go to Torn Travel Page**](https://www.torn.com/index.php)`,
                                color: UI.COLORS.INFO,
                                footer: UI.FOOTER,
                                timestamp: new Date().toISOString()
                            };
                            await sendDM(dmEmbed);
                            rState.alertedLandingFlight = t.destination;
                        }
                    } else {
                        // Not traveling, reset flight lock
                        rState.alertedLandingFlight = null;
                    }
                }

                // ── 3. Energy Bar Full Alert ──
                if (prefs.energy) {
                    const isFullNow = stats.energy.isFull || (stats.energy.current >= stats.energy.maximum);
                    if (isFullNow && !rState.lastEnergyFull) {
                        const dmEmbed = {
                            title: `⚡ Natural Energy Full (${stats.energy.current}/${stats.energy.maximum})`,
                            description: `Hey **${stats.playerName}**, your natural energy bar is completely full!\n\n` +
                                `🏋️ Spend your energy training at the gym or making attacks so you don't waste natural energy regeneration.\n\n` +
                                `[**Go to Torn Gym**](https://www.torn.com/gym.php)`,
                            color: UI.COLORS.WARNING,
                            footer: UI.FOOTER,
                            timestamp: new Date().toISOString()
                        };
                        await sendDM(dmEmbed);
                    }
                    rState.lastEnergyFull = isFullNow;
                }

                // ── 4. Nerve Bar Full Alert ──
                if (prefs.nerve) {
                    const isNerveFullNow = stats.nerve.isFull || (stats.nerve.current >= stats.nerve.maximum);
                    if (isNerveFullNow && !rState.lastNerveFull) {
                        const dmEmbed = {
                            title: `🎯 Nerve Bar Full (${stats.nerve.current}/${stats.nerve.maximum})`,
                            description: `Hey **${stats.playerName}**, your nerve bar has reached its maximum cap!\n\n` +
                                `🕵️ Commit your crimes to keep your natural nerve ticking.\n\n` +
                                `[**Go to Torn Crimes 2.0**](https://www.torn.com/crimes.php)`,
                            color: UI.COLORS.SPECIAL,
                            footer: UI.FOOTER,
                            timestamp: new Date().toISOString()
                        };
                        await sendDM(dmEmbed);
                    }
                    rState.lastNerveFull = isNerveFullNow;
                }

                // ── 5. Hospital Discharge Alert ──
                if (prefs.hospital) {
                    const currentState = stats.status.state; // 'Hospital' vs 'Okay' vs 'Traveling'
                    if (rState.lastHospitalState === 'Hospital' && currentState === 'Okay') {
                        const dmEmbed = {
                            title: '🏥 Discharged from Hospital!',
                            description: `Hey **${stats.playerName}**, you have been discharged or revived from the hospital and are back on the streets of Torn City.\n\n` +
                                `[**View Torn City**](https://www.torn.com/city.php)`,
                            color: UI.COLORS.SUCCESS,
                            footer: UI.FOOTER,
                            timestamp: new Date().toISOString()
                        };
                        await sendDM(dmEmbed);
                    }
                    rState.lastHospitalState = currentState;
                }
            }

        } catch (workerErr) {
            console.error('[UserAlerts] Worker loop error:', workerErr.message);
        }
    }, 30000);
}

// Load disk preferences on module import
loadPrefsFromDisk();

module.exports = {
    getUserAlertPrefs,
    toggleUserAlertPref,
    buildAlertsControlCard,
    startUserAlertsWorker,
    exportPrefsForMongo,
    importPrefsFromMongo,
    setMongoSaveCallback
};
