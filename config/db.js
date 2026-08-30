const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatnest';
    const conn = await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10, // Max concurrent connections in pool
      minPoolSize: 2   // Keep minimum connections warm
    });
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err) => {
      console.error('[Database] Runtime connection error:', err.message);
    });
    mongoose.connection.on('disconnected', () => {
      console.warn('[Database] MongoDB disconnected. Attempting to reconnect...');
    });
  } catch (error) {
    console.warn(`[Database Warning] Could not connect to MongoDB at ${process.env.MONGODB_URI}: ${error.message}`);
    console.warn(`[Database Warning] Operating with graceful fallback if database operations fail.`);
  }
};

module.exports = connectDB;
