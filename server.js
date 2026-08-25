const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const conversationRoutes = require('./routes/conversationRoutes');
const chatRoutes = require('./routes/chatRoutes');

const app = express();

// Initialize MongoDB Connection
connectDB();

// Global exception protection for robust server uptime
process.on('uncaughtException', (err) => {
  console.error('[Global Uncaught Exception]:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Global Unhandled Rejection]:', reason?.message || reason);
});

// Core Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Body parser payload error handler
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ success: false, error: 'Attached file size is too large (maximum limit is 50MB).' });
  }
  if (err) {
    console.error('[Server Error Middleware]:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Server error processing request.' });
  }
  next();
});

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/chat', chatRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    app: 'ChatNest AI Platform',
    timestamp: new Date().toISOString(),
    provider: process.env.DEFAULT_LLM_PROVIDER || 'gemini'
  });
});

// Fallback route to serve index.html for SPA page loads
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 ChatNest AI Server is live on http://localhost:${PORT}`);
  console.log(`💬 Open your browser at http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
