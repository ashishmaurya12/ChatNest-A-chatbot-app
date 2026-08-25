const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatnest';
    const conn = await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000 // Fast timeout if MongoDB is not running locally
    });
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.warn(`[Database Warning] Could not connect to MongoDB at ${process.env.MONGODB_URI}: ${error.message}`);
    console.warn(`[Database Warning] Operating with graceful fallback if database operations fail.`);
  }
};

module.exports = connectDB;
