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

const dns = require('dns').promises;

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const GMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@(gmail|googlemail)\.com$/i;

// Verify if an email domain has active MX (Mail Exchange) DNS records
async function verifyRealEmailDomain(email) {
  try {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) return false;

    const domain = cleanEmail.split('@')[1];
    if (!domain) return false;

    // Block obvious fake/disposable email domains
    const DISPOSABLE_DOMAINS = [
      'test.com', 'example.com', 'tempmail.com', 'mailinator.com', 'dispostable.com',
      '10minutemail.com', 'asdf.com', 'qwerty.com', 'fake.com', 'dummy.com', 'trashmail.com'
    ];
    if (DISPOSABLE_DOMAINS.includes(domain)) return false;

    // Fast-track common popular real domains
    const TRUSTED_DOMAINS = [
      'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'outlook.com',
      'hotmail.com', 'icloud.com', 'protonmail.com', 'proton.me', 'live.com', 'zoho.com'
    ];
    if (TRUSTED_DOMAINS.includes(domain)) return true;

    // Live DNS MX Lookup for custom domains
    const mxRecords = await dns.resolveMx(domain);
    return Array.isArray(mxRecords) && mxRecords.length > 0;
  } catch (e) {
    return false;
  }
}

// @route   POST /api/auth/check-email
// @desc    Check if email exists and is valid (ChatGPT / Gemini style 2-step auth)
// @access  Public
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    const isRealEmail = await verifyRealEmailDomain(cleanEmail);
    if (!isRealEmail) {
      return res.status(400).json({ success: false, error: 'This email domain does not exist or is inactive. Please use a real email address (e.g. name@gmail.com).' });
    }

    const user = await User.findOne({ email: cleanEmail });
    return res.json({
      success: true,
      exists: !!user,
      authProvider: user ? user.authProvider : null,
      email: cleanEmail
    });
  } catch (error) {
    console.error('[Check Email Error]:', error);
    res.status(500).json({ success: false, error: 'Server error checking email.' });
  }
});

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide name, email, and password.' });
    }

    if (!EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ success: false, error: 'Invalid email format. Please enter a valid email address.' });
    }

    const isRealEmail = await verifyRealEmailDomain(email);
    if (!isRealEmail) {
      return res.status(400).json({ success: false, error: 'This email domain does not exist or is invalid. Please use a real email address (e.g. name@gmail.com).' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    // Check if user already exists
    let user = await User.findOne({ email: email.toLowerCase().trim() });
    if (user) {
      // Update password so user can log in via manual password as well
      user.password = password;
      if (name && name.trim()) user.name = name.trim();
      user.authProvider = 'local';
      await user.save();
    } else {
      user = await User.create({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password,
        authProvider: 'local'
      });
    }

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

    if (!EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ success: false, error: 'Invalid email format.' });
    }

    const isRealEmail = await verifyRealEmailDomain(email);
    if (!isRealEmail) {
      return res.status(400).json({ success: false, error: 'Invalid or inactive email domain.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(400).json({ success: false, error: 'No account found with this email address. Please click "Continue with Google" or Create an Account.' });
    }

    let isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        error: 'Incorrect password. Please try again or reset your password.',
        allowReset: true
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
    console.error('[Auth Login Error]:', error);
    res.status(500).json({ success: false, error: 'Server error during login.' });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Update password for registered user
// @access  Public
router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(400).json({ success: false, error: 'Account not found.' });
    }

    user.password = newPassword;
    user.authProvider = 'local';
    await user.save();

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
    console.error('[Reset Password Error]:', error);
    res.status(500).json({ success: false, error: 'Server error resetting password.' });
  }
});

// @route   POST /api/auth/google
// @desc    Authenticate or register user with Google Account
// @access  Public
router.post('/google', async (req, res) => {
  try {
    const { credential, email, name } = req.body;

    let targetEmail = (email || '').trim().toLowerCase();
    let targetName = (name || '').trim() || 'Google User';

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
        if (payload.email) targetEmail = payload.email.trim().toLowerCase();
        if (payload.name) targetName = payload.name;
      } catch (e) {
        console.warn('[Google Token Decode Warning]:', e.message);
      }
    }

    if (!targetEmail || !GMAIL_REGEX.test(targetEmail)) {
      return res.status(400).json({ success: false, error: 'Invalid Gmail address. Please enter a valid @gmail.com account.' });
    }

    const isRealEmail = await verifyRealEmailDomain(targetEmail);
    if (!isRealEmail) {
      return res.status(400).json({ success: false, error: 'This Gmail address is invalid or non-existent.' });
    }

    // Find or create user
    let user = await User.findOne({ email: targetEmail });
    if (!user) {
      const randomPass = Math.random().toString(36).slice(-10) + 'A1!';
      user = await User.create({
        name: targetName,
        email: targetEmail,
        password: randomPass,
        authProvider: 'google'
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
