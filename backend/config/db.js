const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/playngrow';
  try {
    await mongoose.connect(uri);
    const databaseTarget = uri.startsWith('mongodb+srv://') ? 'MongoDB Atlas' : 'MongoDB';
    console.log(`[db] connected -> ${databaseTarget}`);
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
