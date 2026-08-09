require('dotenv').config({ path: require('path').join(__dirname, 'recruit', '.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

async function migrate() {
    try {
        console.log('Connecting to torn_recruit...');
        const recruitDb = await mongoose.createConnection('mongodb://127.0.0.1:27017/torn_recruit').asPromise();
        
        console.log('Connecting to torn_company...');
        const companyDb = await mongoose.createConnection('mongodb://127.0.0.1:27017/torn_company').asPromise();

        let oldRecruits = [];

        // 1. Get from torn_company DB
        try {
            const recruitCol = companyDb.collection('recruits');
            const dbRecruits = await recruitCol.find({}).toArray();
            if (dbRecruits.length > 0) {
                console.log(`Found ${dbRecruits.length} recruits in torn_company DB.`);
                oldRecruits = oldRecruits.concat(dbRecruits);
            }
        } catch (e) { console.log('No recruits collection found in torn_company'); }

        // 2. Get from data/recruits.json
        try {
            const file = path.join(__dirname, 'data', 'recruits.json');
            if (fs.existsSync(file)) {
                const fileRecruits = JSON.parse(fs.readFileSync(file, 'utf8'));
                console.log(`Found ${fileRecruits.length} recruits in data/recruits.json.`);
                oldRecruits = oldRecruits.concat(fileRecruits);
            }
        } catch (e) { console.log('No recruits.json found'); }

        if (oldRecruits.length === 0) {
            console.log('No old recruits to migrate.');
            process.exit(0);
        }

        // Deduplicate
        const uniqueRecruits = [];
        const seen = new Set();
        for (const r of oldRecruits) {
            if (r.id && !seen.has(r.id)) {
                seen.add(r.id);
                uniqueRecruits.push(r);
            }
        }
        console.log(`Total unique recruits to migrate: ${uniqueRecruits.length}`);

        const playersCol = recruitDb.collection('players');
        const watchCol = recruitDb.collection('watchpools');

        let migratedCount = 0;
        const BATCH = 500;
        
        for (let i = 0; i < uniqueRecruits.length; i += BATCH) {
            const batch = uniqueRecruits.slice(i, i + BATCH);
            const playerOps = [];
            const watchOps = [];

            for (const r of batch) {
                // Map to new schema
                const playerDoc = {
                    _id: r.id,
                    name: r.name || 'Unknown',
                    level: r.level || 1,
                    donator: r.donator || 0,
                    status: 'Okay',
                    factionId: 0, 
                    lastActionTs: r.last_action && r.last_action.timestamp ? new Date(r.last_action.timestamp * 1000) : new Date(),
                    personalstats: r.personalstats || {},
                    lastUpdated: new Date()
                };

                playerOps.push({
                    updateOne: {
                        filter: { _id: r.id },
                        update: { $set: playerDoc },
                        upsert: true
                    }
                });

                watchOps.push({
                    updateOne: {
                        filter: { _id: r.id },
                        update: { 
                            $setOnInsert: { 
                                _id: r.id, 
                                source: 'migration', 
                                priority: 0, 
                                addedAt: new Date(), 
                                checkCount: 0 
                            }
                        },
                        upsert: true
                    }
                });
            }

            await playersCol.bulkWrite(playerOps, { ordered: false });
            await watchCol.bulkWrite(watchOps, { ordered: false });
            migratedCount += batch.length;
            console.log(`Migrated ${migratedCount} / ${uniqueRecruits.length}`);
        }

        console.log('Migration complete!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
