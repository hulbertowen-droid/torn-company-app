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
    hospital: false
};

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

/**
 * Build interactive Discord embed and buttons for user alert preferences.
 */
function buildAlertsControlCard(discordUserId, playerInfo = null) {
    const prefs = getUserAlertPrefs(discordUserId);
    const nameLabel = playerInfo?.playerName 
        ? `**[${playerInfo.playerName} [${playerInfo.playerId}]](https://www.torn.com/profiles.php?XID=${playerInfo.playerId})**`
        : `Your Account`;

    const statusBadge = (on) => on ? '`🟢 ENABLED`' : '`⚪ DISABLED`';

    const embed = {
        title: '🔔 Personal Discord DM Notification Sentinel',
        description: `Configure personal direct messages from **F.R.I.D.A.Y.** for ${nameLabel}.\n\n` +
            `🔒 **Strict Opt-In Privacy:** All notifications are **disabled by default**. Only features you explicitly turn on below will send you private direct messages.\n\n` +
            `**Your Current Alert Settings:**\n` +
            `• 💊 **Drug / Xanax Cooldown:** ${statusBadge(prefs.drug)}\n` +
            `  *Alerts the second your drug cooldown expires so you can take Xanax with zero downtime.*\n\n` +
            `• ✈️ **Flight Landing Imminent:** ${statusBadge(prefs.travel)}\n` +
            `  *Alerts ~2-3 minutes before touchdown abroad or back in Torn so you never get mugged.*\n\n` +
            `• ⚡ **Natural Energy Full:** ${statusBadge(prefs.energy)}\n` +
            `  *Alerts when natural energy bar hits max cap (100/150) so regen isn't wasted.*\n\n` +
            `• 🎯 **Nerve Bar Full:** ${statusBadge(prefs.nerve)}\n` +
            `  *Alerts when nerve bar is maxed so you can commit crimes without wasting ticks.*\n\n` +
            `• 🏥 **Hospital Discharge:** ${statusBadge(prefs.hospital)}\n` +
            `  *Alerts the moment you leave the hospital or get revived.*\n\n` +
            `_Click the buttons below to toggle each notification on or off:_`,
        color: UI.COLORS.BRAND,
        footer: UI.FOOTER,
        timestamp: new Date().toISOString()
    };

    // Button rows
    const row1 = UI.actionRow(
        prefs.drug ? UI.successBtn('toggle_alert_drug', 'Drug: ON', '💊') : UI.secondaryBtn('toggle_alert_drug', 'Drug: OFF', '💊'),
        prefs.travel ? UI.successBtn('toggle_alert_travel', 'Flight: ON', '✈️') : UI.secondaryBtn('toggle_alert_travel', 'Flight: OFF', '✈️'),
        prefs.energy ? UI.successBtn('toggle_alert_energy', 'Energy: ON', '⚡') : UI.secondaryBtn('toggle_alert_energy', 'Energy: OFF', '⚡')
    );

    const row2 = UI.actionRow(
        prefs.nerve ? UI.successBtn('toggle_alert_nerve', 'Nerve: ON', '🎯') : UI.secondaryBtn('toggle_alert_nerve', 'Nerve: OFF', '🎯'),
        prefs.hospital ? UI.successBtn('toggle_alert_hospital', 'Hosp: ON', '🏥') : UI.secondaryBtn('toggle_alert_hospital', 'Hosp: OFF', '🏥'),
        UI.primaryBtn('test_user_dm', 'Test DM', '🧪')
    );

    return { embed, components: [row1, row2] };
}

/**
 * Background Alert Poller:
 * Checks users who have at least one notification enabled and a linked API key.
 */
let isWorkerRunning = false;

function startUserAlertsWorker(discordClient, userKeys) {
    if (isWorkerRunning) return;
    isWorkerRunning = true;
    console.log('[UserAlerts] Personal DM notification worker active (30s cadence for opted-in users).');

    setInterval(async () => {
        try {
            if (!discordClient || !discordClient.isReady()) return;

            // Find all users who have at least one alert turned ON
            const activeSubscribers = [];
            for (const [discordId, prefs] of alertPrefsStore.entries()) {
                if (prefs.drug || prefs.travel || prefs.energy || prefs.nerve || prefs.hospital) {
                    activeSubscribers.push({ discordId, prefs });
                }
            }

            if (activeSubscribers.length === 0) return;

            for (const sub of activeSubscribers) {
                const { discordId, prefs } = sub;

                // Resolve user's API key
                const resolved = userKeys.resolveUserApiKey(discordId);
                if (!resolved || !resolved.key) continue;

                // Get or initialize runtime state
                if (!alertRuntimeStates.has(discordId)) {
                    alertRuntimeStates.set(discordId, {
                        lastDrugSec: null,
                        lastDrugAlertedTs: 0,
                        lastTravelFlight: null,
                        lastEnergyFull: false,
                        lastNerveFull: false,
                        lastHospitalState: null,
                        initialized: false
                    });
                }
                const rState = alertRuntimeStates.get(discordId);

                // Fetch live stats (respects 10s memory cache)
                const stats = await userKeys.fetchUserLiveStats(resolved.key);
                if (!stats) continue;

                // If first time seeing user this session, initialize states without false alerts
                if (!rState.initialized) {
                    rState.lastDrugSec = stats.cooldowns.drug;
                    rState.lastTravelFlight = stats.travel.isTraveling ? stats.travel.destination : null;
                    rState.lastEnergyFull = stats.energy.isFull || (stats.energy.current >= stats.energy.maximum);
                    rState.lastNerveFull = stats.nerve.isFull || (stats.nerve.current >= stats.nerve.maximum);
                    rState.lastHospitalState = stats.status.state;
                    rState.initialized = true;
                    continue;
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
