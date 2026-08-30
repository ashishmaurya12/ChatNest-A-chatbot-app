const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// Generate JWT token
const generateToken = (user) => {
  const secret = process.env.JWT_SECRET || 'chatnest_default_jwt_secret_key_2026';
  return jwt.sign(
    { id: user._id, email: user.email, name: user.name },
    secret,
    { expiresIn: '7d' }
  );
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide name, email, and password.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists.' });
    }

    // Create user
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password
    });

    const token = generateToken(user);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('[Auth Register Error]:', error);
    res.status(500).json({ success: false, error: 'Server error during registration.' });
  }
});

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide email and password.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid credentials. User not found.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Invalid credentials. Password incorrect.' });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('[Auth Login Error]:', error);
    res.status(500).json({ success: false, error: 'Server error during login.' });
  }
});

// @route   POST /api/auth/google
// @desc    Authenticate or register user with Google Account
// @access  Public
router.post('/google', async (req, res) => {
  try {
    const { credential, email, name } = req.body;

    let targetEmail = (email || '').toLowerCase();
    let targetName = name || 'Google User';

    // If Google ID token credential was sent, decode payload
    if (credential) {
      try {
        const base64Url = credential.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        const payload = JSON.parse(jsonPayload);
        if (payload.email) targetEmail = payload.email.toLowerCase();
        if (payload.name) targetName = payload.name;
      } catch (e) {
        console.warn('[Google Token Decode Warning]:', e.message);
      }
    }

    if (!targetEmail) {
      return res.status(400).json({ success: false, error: 'Google email is required.' });
    }

    // Find or create user
    let user = await User.findOne({ email: targetEmail });
    if (!user) {
      const randomPass = Math.random().toString(36).slice(-10) + 'A1!';
      user = await User.create({
        name: targetName,
        email: targetEmail,
        password: randomPass
      });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('[Google Auth Error]:', error);
    res.status(500).json({ success: false, error: 'Server error during Google Authentication.' });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, error: 'User profile not found.' });
    }
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('[Auth Me Error]:', error);
    res.status(500).json({ success: false, error: 'Server error fetching user profile.' });
  }
});

// @route   GET /api/auth/memories
// @desc    Get user's stored persistent memories
// @access  Private
router.get('/memories', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('memories');
    res.json({
      success: true,
      memories: user ? (user.memories || []) : []
    });
  } catch (error) {
    console.error('[Get Memories Error]:', error);
    res.status(500).json({ success: false, error: 'Server error fetching user memories.' });
  }
});

// @route   DELETE /api/auth/memories
// @desc    Clear user's stored persistent memories
// @access  Private
router.delete('/memories', authMiddleware, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { memories: [] });
    res.json({ success: true, message: 'All stored memories cleared successfully.' });
  } catch (error) {
    console.error('[Clear Memories Error]:', error);
    res.status(500).json({ success: false, error: 'Server error clearing memories.' });
  }
});

module.exports = router;
