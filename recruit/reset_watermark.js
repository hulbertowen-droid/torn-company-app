const mongoose = require('mongoose');

async function main() {
    await mongoose.connect('mongodb://localhost:27017/torn_recruit');
    
    // Jump to 3.5M — this is where recent, active Torn players live
    // Low IDs (1-1M) = players from 2004-2014, mostly inactive or dead accounts
    // High IDs (3M-5M) = players from 2020-2026, much more likely to be active
    await mongoose.connection.db.collection('seeder_config').updateOne(
        { _id: 'watermark' },
        { $set: { value: 3500000 } },
        { upsert: true }
    );
    
    // Also wipe the old inactive junk from the DB
    const result = await mongoose.connection.db.collection('players').deleteMany({
        factionId: 0,
        $or: [
            { lastActionTs: null },
            { lastActionTs: { $lt: new Date(Date.now() - 30 * 86400000) } }
        ]
    });
    
    console.log('Watermark set to 3,500,000 (recent active players)');
    console.log('Deleted', result.deletedCount, 'stale inactive factionless players from DB');
    
    await mongoose.disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
