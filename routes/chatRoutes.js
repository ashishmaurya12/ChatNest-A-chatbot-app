const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimiter');
const { getLLMStream } = require('../services/llmService');
const { parseDocumentAttachment } = require('../services/docParser');

// @route   POST /api/chat/:conversationId
// @desc    Send a message to an AI persona in a conversation thread & stream response
// @access  Private
router.post('/:conversationId', authMiddleware, chatLimiter, async (req, res) => {
  const { conversationId } = req.params;
  const { message, persona, attachment, webSearch } = req.body;
  
  if ((!message || !message.trim()) && !attachment) {
    return res.status(400).json({ success: false, error: 'Message or attachment is required.' });
  }

  try {
    // Parse attached document/image if present
    const processedAttachment = attachment ? await parseDocumentAttachment(attachment) : null;

    // Verify conversation ownership
    let conversation = await Conversation.findOne({
      _id: conversationId,
      userId: req.user.id
    });

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation thread not found.' });
    }

    // Update persona if provided
    if (persona && persona !== conversation.persona) {
      conversation.persona = persona;
    }

    const rawMessage = (message || '').trim();

    // Auto-generate title if title is "New Chat"
    let newTitle = null;
    if (conversation.title === 'New Chat') {
      newTitle = (rawMessage || processedAttachment?.name || 'New Chat').slice(0, 30);
      if ((rawMessage || '').length > 30) newTitle += '...';
      conversation.title = newTitle;
    }

    conversation.updatedAt = Date.now();
    await conversation.save();

    // 1. Save User Message to Database with Document Text Context for Thread Memory
    let displayMessage = rawMessage;
    if (processedAttachment && processedAttachment.text) {
      displayMessage = `[Attached: ${processedAttachment.name}]\n[DOCUMENT CONTENT: ${processedAttachment.name}]\n${processedAttachment.text}\n[END DOCUMENT]\n\n${rawMessage || 'Analyze this attachment.'}`;
    } else if (processedAttachment) {
      displayMessage = `[Attached: ${processedAttachment.name}]\n${rawMessage || 'Analyze this attachment.'}`;
    }

    const userMsg = await Message.create({
      conversationId: conversation._id,
      role: 'user',
      content: displayMessage
    });

    // 2. Load recent conversation history (get MOST RECENT 20 messages, then reverse to chronological order)
    const historyDocs = await Message.find({
      conversationId: conversation._id,
      _id: { $ne: userMsg._id } // exclude current user message
    })
      .sort({ createdAt: -1 })
      .limit(20);

    // Reverse to chronological order (oldest to newest)
    historyDocs.reverse();

    const history = historyDocs.map(msg => {
      let cleanedContent = msg.content || '';
      // Truncate excessively long document dumps from historical prompts to save token context
      if (cleanedContent.includes('[DOCUMENT CONTENT:')) {
        cleanedContent = cleanedContent.replace(/\[DOCUMENT CONTENT:[\s\S]*?\[END DOCUMENT\]/gi, '[Document text processed]').trim();
      }
      return {
        role: msg.role,
        content: cleanedContent
      };
    });

    // 3. Configure SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering for instant delivery

    // Send metadata payload if title was updated
    if (newTitle) {
      res.write(`data: ${JSON.stringify({ meta: { title: newTitle, conversationId: conversation._id } })}\n\n`);
    }

    let fullAiResponse = '';

    // 4. Stream tokens from LLM Service with Web Search Grounding & Parsed Document support
    for await (const chunk of getLLMStream(displayMessage, history, conversation.persona, processedAttachment, !!webSearch)) {
      fullAiResponse += chunk;
      res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
    }

    // 5. Save complete AI Response to Database
    await Message.create({
      conversationId: conversation._id,
      role: 'assistant',
      content: fullAiResponse
    });

    // 6. Signal SSE completion
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('[Chat SSE Stream Error]:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Server error during chat streaming.' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Streaming interrupted due to a server error.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

module.exports = router;
