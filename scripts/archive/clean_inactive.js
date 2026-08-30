require('dotenv').config({ path: require('path').join(__dirname, 'recruit', '.env') });
const mongoose = require('mongoose');
const Player = require('./recruit/db/models/Player');
const WatchPool = require('./recruit/db/models/WatchPool');
const { connectDB } = require('./recruit/db/mongo');

async function cleanInactive() {
    await connectDB();
    console.log('Connected to DB');

    const cutoffDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

    // Find players where lastActionTs is less than (older than) cutoffDate
    const inactivePlayers = await Player.find({ lastActionTs: { $lt: cutoffDate } }).select('_id').lean();
    const idsToDelete = inactivePlayers.map(p => p._id);

    console.log(`Found ${idsToDelete.length} players inactive for > 5 days.`);

    if (idsToDelete.length > 0) {
        const playerRes = await Player.deleteMany({ _id: { $in: idsToDelete } });
        console.log(`Deleted ${playerRes.deletedCount} from Players collection.`);

        const watchRes = await WatchPool.deleteMany({ _id: { $in: idsToDelete } });
        console.log(`Deleted ${watchRes.deletedCount} from WatchPool collection.`);
    }

    console.log('Cleanup complete.');
    process.exit(0);
}

cleanInactive().catch(console.error);
