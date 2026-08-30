const express = require('express');
const router = express.Router();
const { runEvaluationSuite, getLatestRunResults, getRunHistory } = require('../eval/runner');

let isRunning = false;

// @route   POST /api/eval/run
// @desc    Trigger full automated chatbot evaluation suite
// @access  Public (or authenticated)
router.post('/run', async (req, res) => {
  if (isRunning) {
    return res.status(429).json({
      success: false,
      error: 'An evaluation test suite is currently running. Please wait for it to complete.'
    });
  }

  try {
    isRunning = true;
    // Run evaluation suite asynchronously or synchronously
    const report = await runEvaluationSuite();
    isRunning = false;
    res.json({ success: true, report });
  } catch (error) {
    isRunning = false;
    console.error('[Eval API Error]:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to execute evaluation suite.' });
  }
});

// @route   GET /api/eval/latest
// @desc    Get metrics and test results for the latest benchmark run
// @access  Public
router.get('/latest', (req, res) => {
  try {
    const report = getLatestRunResults();
    if (!report) {
      return res.json({
        success: true,
        has_results: false,
        message: 'No benchmark runs found yet. Click "Run Benchmark Suite" to generate initial results.'
      });
    }
    res.json({ success: true, has_results: true, report, is_running: isRunning });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// @route   GET /api/eval/history
// @desc    Get historical benchmark runs for regression trend
// @access  Public
router.get('/history', (req, res) => {
  try {
    const history = getRunHistory();
    res.json({ success: true, history, count: history.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
