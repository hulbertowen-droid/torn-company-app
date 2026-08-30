const mongoose = require('mongoose');
const uri = "mongodb+srv://WarBoard:WarBoardPass123@cluster0.iwnnnj3.mongodb.net/?appName=Cluster0";

const recruitSchema = new mongoose.Schema({}, { strict: false });
const Recruit = mongoose.models.Recruit || mongoose.model('Recruit', recruitSchema);

async function check() {
    try {
        await mongoose.connect(uri);
        const count = await Recruit.countDocuments();
        console.log(`Total recruits in DB: ${count}`);
        
        const sample = await Recruit.find({}).limit(5).lean();
        console.log("Sample records:");
        console.log(JSON.stringify(sample, null, 2));
        
        const young = await Recruit.find({ age: { $lte: 50 } }).limit(5).lean();
        console.log(`Recruits with age <= 50: ${young.length}`);
        
    } catch (e) {
        console.log("Error:", e);
    }
    process.exit(0);
}
check();
