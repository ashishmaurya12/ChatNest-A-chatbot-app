const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');

// Protect all conversation routes
router.use(authMiddleware);

// @route   GET /api/conversations
// @desc    Get all conversations for the logged in user
// @access  Private
router.get('/', async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user.id })
      .sort({ updatedAt: -1 });

    res.json({
      success: true,
      count: conversations.length,
      conversations
    });
  } catch (error) {
    console.error('[Get Conversations Error]:', error);
    res.status(500).json({ success: false, error: 'Server error fetching conversations.' });
  }
});

// @route   POST /api/conversations
// @desc    Create a new conversation thread
// @access  Private
router.post('/', async (req, res) => {
  try {
    const { title, persona } = req.body;

    const conversation = await Conversation.create({
      userId: req.user.id,
      title: title || 'New Chat',
      persona: persona || 'general'
    });

    res.status(201).json({
      success: true,
      conversation
    });
  } catch (error) {
    console.error('[Create Conversation Error]:', error);
    res.status(500).json({ success: false, error: 'Server error creating conversation.' });
  }
});

// @route   GET /api/conversations/:id/messages
// @desc    Get message history for a specific conversation
// @access  Private
router.get('/:id/messages', async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation thread not found.' });
    }

    const messages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 });

    res.json({
      success: true,
      conversation,
      messages
    });
  } catch (error) {
    console.error('[Get Messages Error]:', error);
    res.status(500).json({ success: false, error: 'Server error loading messages.' });
  }
});

// @route   PATCH /api/conversations/:id
// @desc    Update conversation (e.g. title or persona)
// @access  Private
router.patch('/:id', async (req, res) => {
  try {
    const { title, persona } = req.body;
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (persona !== undefined) updateData.persona = persona;
    updateData.updatedAt = Date.now();

    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: updateData },
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation thread not found.' });
    }

    res.json({
      success: true,
      conversation
    });
  } catch (error) {
    console.error('[Update Conversation Error]:', error);
    res.status(500).json({ success: false, error: 'Server error updating conversation.' });
  }
});

// @route   DELETE /api/conversations/:id
// @desc    Delete a conversation and its messages
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation thread not found.' });
    }

    // Delete all messages in thread
    await Message.deleteMany({ conversationId: conversation._id });
    // Delete thread document
    await Conversation.deleteOne({ _id: conversation._id });

    res.json({
      success: true,
      message: 'Conversation and all messages deleted successfully.'
    });
  } catch (error) {
    console.error('[Delete Conversation Error]:', error);
    res.status(500).json({ success: false, error: 'Server error deleting conversation.' });
  }
});

module.exports = router;
