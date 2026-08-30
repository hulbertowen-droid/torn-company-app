const fs = require('fs');
const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/server.js';
let content = fs.readFileSync(file, 'utf8');

const oldEndpoint = `app.get('/api/dashboard-data', async (req, res) => {
    const userKey = req.query.apiKey;
    const ffKey = req.query.ffKey || null;
    try {
        await verifySubscription(userKey);
        const isPremium = (ffKey && ffKey !== "null" && ffKey.trim().length > 10);

        const basicResp = await fetch(\`https://api.torn.com/faction/?selections=basic&key=\${userKey}\`);
        const basicData = await basicResp.json();
        if (basicData.error) return res.status(400).json({ error: basicData.error.error });

        if (basicData.members) {
            Object.keys(basicData.members).forEach(id => {
                if (!activityCache[id] || (Date.now() - activityCache[id].time) > 600000) {
                    if (isPremium && !activityQueue.has(id)) activityQueue.set(id, ffKey);
                }
            });
        }

        let loans = [];
        let armoryError = false;
        const armoryResp = await fetch(\`https://api.torn.com/faction/?selections=armor,weapons,temporary&key=\${userKey}\`);
        const armoryData = await armoryResp.json();

        if (armoryData.error) { armoryError = true; } 
        else {
            const findLoans = (obj, typeName) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.loaned_to) {
                    let loanStr = String(obj.loaned_to).trim();
                    if (loanStr !== "0" && loanStr !== "null" && loanStr !== "") {
                        loanStr.split(',').forEach(l => { loans.push({ name: obj.name || "Unknown Item", loaned_to: l.trim(), type: typeName }); });
                    }
                    return; 
                }
                Object.values(obj).forEach(val => findLoans(val, typeName));
            };
            findLoans(armoryData.armor, "Armor");
            findLoans(armoryData.weapons, "Weapon");
            findLoans(armoryData.temporary, "Temporary");
        }

        let parsedMembers = {};
        if (basicData.members) {
            Object.entries(basicData.members).forEach(([id, m]) => {
                parsedMembers[id] = { ...m, timeline: isPremium ? (activityCache[id]?.timeline || null) : null };
            });
        }

        res.json({ success: true, members: parsedMembers, loans: loans, armoryError, premiumActive: isPremium });
    } catch (err) { res.status(403).json({ error: err.message }); }
});`;

const newEndpoint = `app.get('/api/dashboard-data', async (req, res) => {
    const userKey = req.query.apiKey;
    const ffKey = req.query.ffKey || null;
    try {
        await verifySubscription(userKey);
        const isPremium = (ffKey && ffKey !== "null" && ffKey.trim().length > 10);

        const basicResp = await fetch(\`https://api.torn.com/faction/?selections=basic&key=\${userKey}\`);
        const basicData = await basicResp.json();
        if (basicData.error) return res.status(400).json({ error: basicData.error.error });

        if (basicData.members) {
            Object.keys(basicData.members).forEach(id => {
                if (!activityCache[id] || (Date.now() - activityCache[id].time) > 600000) {
                    if (isPremium && !activityQueue.has(id)) activityQueue.set(id, ffKey);
                }
            });
        }

        let loans = [];
        let armoryError = false;
        const armoryResp = await fetch(\`https://api.torn.com/faction/?selections=armor,weapons,temporary&key=\${userKey}\`);
        const armoryData = await armoryResp.json();

        if (armoryData.error) { armoryError = true; } 
        else {
            const findLoans = (obj, typeName) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.loaned_to) {
                    let loanStr = String(obj.loaned_to).trim();
                    if (loanStr !== "0" && loanStr !== "null" && loanStr !== "") {
                        loanStr.split(',').forEach(l => { loans.push({ name: obj.name || "Unknown Item", loaned_to: l.trim(), type: typeName }); });
                    }
                    return; 
                }
                Object.values(obj).forEach(val => findLoans(val, typeName));
            };
            findLoans(armoryData.armor, "Armor");
            findLoans(armoryData.weapons, "Weapon");
            findLoans(armoryData.temporary, "Temporary");
        }

        let parsedMembers = {};
        if (basicData.members) {
            Object.entries(basicData.members).forEach(([id, m]) => {
                parsedMembers[id] = { ...m, timeline: isPremium ? (activityCache[id]?.timeline || null) : null };
            });
        }

        // Fetch chain and ranked war data
        let chain = null;
        let activeWar = null;
        try {
            const chainResp = await fetch(\`https://api.torn.com/faction/?selections=chain,rankedwars&key=\${userKey}\`);
            const chainData = await chainResp.json();
            if (!chainData.error) {
                chain = chainData.chain || null;
                if (chainData.rankedwars) {
                    for (const [warId, warInfo] of Object.entries(chainData.rankedwars)) {
                        if (warInfo.war && warInfo.war.winner === 0) {
                            const facIds = Object.keys(warInfo.factions || {});
                            const myFacId = basicData.ID?.toString();
                            const enemyFacId = facIds.find(id => id !== myFacId);
                            const myFacData = warInfo.factions[myFacId] || {};
                            const enemyFacData = enemyFacId ? (warInfo.factions[enemyFacId] || {}) : {};
                            activeWar = {
                                warId,
                                myFaction: basicData.name || 'Your Faction',
                                enemyFaction: enemyFacData.name || 'Enemy Faction',
                                myScore: myFacData.score || 0,
                                enemyScore: enemyFacData.score || 0,
                                target: warInfo.war.target || 0,
                                start: warInfo.war.start
                            };
                            break;
                        }
                    }
                }
            }
        } catch(e) {}

        const faction = {
            name: basicData.name,
            ID: basicData.ID,
            tag: basicData.tag,
            level: basicData.level,
            age: basicData.age,
            respect: basicData.respect,
            best_chain: basicData.best_chain,
            capacity: basicData.capacity
        };

        res.json({ success: true, members: parsedMembers, loans, armoryError, premiumActive: isPremium, chain, activeWar, faction });
    } catch (err) { res.status(403).json({ error: err.message }); }
});`;

if (content.includes(oldEndpoint)) {
    content = content.replace(oldEndpoint, newEndpoint);
    fs.writeFileSync(file, content);
    console.log('Successfully updated /api/dashboard-data endpoint');
} else {
    console.log('Old endpoint string not found exactly — trying line-by-line...');
    // fallback: find and replace the res.json line directly
    const oldJson = `        res.json({ success: true, members: parsedMembers, loans: loans, armoryError, premiumActive: isPremium });
    } catch (err) { res.status(403).json({ error: err.message }); }
});`;
    const newJson = `        // Fetch chain and ranked war data
        let chain = null;
        let activeWar = null;
        try {
            const chainResp = await fetch(\`https://api.torn.com/faction/?selections=chain,rankedwars&key=\${userKey}\`);
            const chainData = await chainResp.json();
            if (!chainData.error) {
                chain = chainData.chain || null;
                if (chainData.rankedwars) {
                    for (const [warId, warInfo] of Object.entries(chainData.rankedwars)) {
                        if (warInfo.war && warInfo.war.winner === 0) {
                            const facIds = Object.keys(warInfo.factions || {});
                            const myFacId = basicData.ID?.toString();
                            const enemyFacId = facIds.find(id => id !== myFacId);
                            const myFacData = warInfo.factions[myFacId] || {};
                            const enemyFacData = enemyFacId ? (warInfo.factions[enemyFacId] || {}) : {};
                            activeWar = {
                                warId,
                                myFaction: basicData.name || 'Your Faction',
                                enemyFaction: enemyFacData.name || 'Enemy Faction',
                                myScore: myFacData.score || 0,
                                enemyScore: enemyFacData.score || 0,
                                target: warInfo.war.target || 0,
                                start: warInfo.war.start
                            };
                            break;
                        }
                    }
                }
            }
        } catch(e) {}

        const faction = {
            name: basicData.name,
            ID: basicData.ID,
            tag: basicData.tag,
            level: basicData.level,
            age: basicData.age,
            respect: basicData.respect,
            best_chain: basicData.best_chain,
            capacity: basicData.capacity
        };

        res.json({ success: true, members: parsedMembers, loans, armoryError, premiumActive: isPremium, chain, activeWar, faction });
    } catch (err) { res.status(403).json({ error: err.message }); }
});`;

    if (content.includes(oldJson)) {
        content = content.replace(oldJson, newJson);
        fs.writeFileSync(file, content);
        console.log('Fallback replacement worked!');
    } else {
        console.log('Fallback also failed.');
    }
}
