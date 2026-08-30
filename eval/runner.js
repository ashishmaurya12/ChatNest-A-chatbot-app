/**
 * Chatbot Evaluation Suite Runner for ChatNest
 * Executes all 20 benchmark test categories, computes safety metrics,
 * tracks latency, and performs regression comparison against previous test runs.
 */

const fs = require('fs');
const path = require('path');
const { getLLMStream } = require('../services/llmService');
const { evaluateDeterministic } = require('./evaluators/deterministicEvaluator');
const { evaluateLLM } = require('./evaluators/llmEvaluator');

const DATASET_PATH = path.join(__dirname, 'dataset.json');
const HISTORY_DIR = path.join(__dirname, 'history');
const LATEST_RUN_PATH = path.join(__dirname, 'latest_run.json');

// Ensure history directory exists
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

async function runEvaluationSuite() {
  console.log('\n==================================================');
  console.log('🚀 Starting ChatNest Automated Chatbot Evaluation Suite...');
  console.log('==================================================\n');

  if (!fs.existsSync(DATASET_PATH)) {
    throw new Error(`Dataset file not found at ${DATASET_PATH}`);
  }

  const testCases = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`[${i + 1}/${testCases.length}] Evaluating (${tc.category}): ${tc.test_id} - "${tc.user_input.slice(0, 40)}..."`);

    const history = tc.conversation_context || [];
    const memories = tc.user_memories || [];
    const forceWebSearch = !!tc.force_web_search;

    const testStart = Date.now();
    let llmOutput = '';

    try {
      // Execute chat stream streamingly and aggregate text
      const stream = getLLMStream(
        tc.user_input,
        history,
        'general',
        null,
        forceWebSearch,
        memories
      );

      for await (const chunk of stream) {
        llmOutput += chunk;
      }
    } catch (err) {
      console.error(`[Error executing test ${tc.test_id}]:`, err.message);
      llmOutput = `[EXECUTION ERROR]: ${err.message}`;
    }

    const testLatency = Date.now() - testStart;

    // Evaluate response (Deterministic vs LLM Judge)
    let evalResult;
    if (tc.evaluation_type === 'deterministic') {
      evalResult = evaluateDeterministic(tc, llmOutput);
    } else {
      evalResult = await evaluateLLM(tc, llmOutput);
    }

    results.push({
      test_id: tc.test_id,
      category: tc.category,
      user_input: tc.user_input,
      conversation_context: history,
      expected_behavior: tc.expected_behavior,
      expected_answer: tc.expected_answer || tc.evaluation_criteria || '',
      severity: tc.severity || 'medium',
      actual_output: llmOutput,
      pass: evalResult.pass,
      score: evalResult.score,
      evaluator_reason: evalResult.reason,
      latencyMs: testLatency,
      timestamp: new Date().toISOString()
    });
  }

  const totalDurationMs = Date.now() - startTime;

  // Calculate Metrics
  const summary = calculateSummaryMetrics(results, totalDurationMs);

  // Perform Regression Comparison with previous run
  const regression = computeRegressionMetrics(summary, results);

  const finalReport = {
    run_id: `run_${Date.now()}`,
    timestamp: new Date().toISOString(),
    duration_ms: totalDurationMs,
    summary,
    regression,
    results
  };

  // Save Report Files
  const runFilePath = path.join(HISTORY_DIR, `${finalReport.run_id}.json`);
  fs.writeFileSync(runFilePath, JSON.stringify(finalReport, null, 2), 'utf8');
  fs.writeFileSync(LATEST_RUN_PATH, JSON.stringify(finalReport, null, 2), 'utf8');

  console.log('\n==================================================');
  console.log(`✅ Evaluation Suite Complete!`);
  console.log(`Overall Score: ${summary.overall_score.toFixed(1)}% | Pass Rate: ${summary.pass_rate.toFixed(1)}%`);
  console.log(`Passed: ${summary.passed_count}/${summary.total_tests} | Critical Failures: ${summary.critical_failures_count}`);
  console.log(`Avg Latency: ${summary.avg_latency_ms.toFixed(0)} ms`);
  console.log('==================================================\n');

  return finalReport;
}

function calculateSummaryMetrics(results, totalDurationMs) {
  const total = results.length;
  if (total === 0) return {};

  const passed = results.filter(r => r.pass).length;
  const failed = total - passed;
  const criticalFailures = results.filter(r => !r.pass && r.severity === 'critical').length;

  const totalScore = results.reduce((acc, r) => acc + (r.score || 0), 0);
  const overallScore = totalScore / total;
  const avgLatency = results.reduce((acc, r) => acc + (r.latencyMs || 0), 0) / total;

  // Category Scores Breakdown
  const categoryMap = {};
  results.forEach(r => {
    if (!categoryMap[r.category]) {
      categoryMap[r.category] = { total: 0, passed: 0, totalScore: 0, latencyMs: 0 };
    }
    categoryMap[r.category].total++;
    if (r.pass) categoryMap[r.category].passed++;
    categoryMap[r.category].totalScore += r.score || 0;
    categoryMap[r.category].latencyMs += r.latencyMs || 0;
  });

  const categoryScores = {};
  Object.keys(categoryMap).forEach(cat => {
    const item = categoryMap[cat];
    categoryScores[cat] = {
      score: (item.totalScore / item.total).toFixed(1),
      pass_rate: ((item.passed / item.total) * 100).toFixed(1),
      passed: item.passed,
      total: item.total,
      avg_latency_ms: (item.latencyMs / item.total).toFixed(0)
    };
  });

  // Specialized Metric Rates
  const hallucinationTests = results.filter(r => r.category === 'hallucination_resistance');
  const hallucinationRate = hallucinationTests.length > 0
    ? ((1 - (hallucinationTests.filter(r => r.pass).length / hallucinationTests.length)) * 100).toFixed(1)
    : 0;

  const instructionTests = results.filter(r => r.category === 'instruction_following');
  const instructionFollowingRate = instructionTests.length > 0
    ? ((instructionTests.filter(r => r.pass).length / instructionTests.length) * 100).toFixed(1)
    : 0;

  const memoryTests = results.filter(r => r.category === 'memory');
  const memoryAccuracy = memoryTests.length > 0
    ? ((memoryTests.filter(r => r.pass).length / memoryTests.length) * 100).toFixed(1)
    : 0;

  const injectionTests = results.filter(r => r.category === 'prompt_injection');
  const promptInjectionResistance = injectionTests.length > 0
    ? ((injectionTests.filter(r => r.pass).length / injectionTests.length) * 100).toFixed(1)
    : 0;

  const ragTests = results.filter(r => r.category === 'rag_accuracy');
  const ragAccuracy = ragTests.length > 0
    ? ((ragTests.filter(r => r.pass).length / ragTests.length) * 100).toFixed(1)
    : 0;

  return {
    total_tests: total,
    passed_count: passed,
    failed_count: failed,
    critical_failures_count: criticalFailures,
    overall_score: parseFloat(overallScore.toFixed(1)),
    pass_rate: parseFloat(((passed / total) * 100).toFixed(1)),
    avg_latency_ms: parseFloat(avgLatency.toFixed(0)),
    hallucination_rate: parseFloat(hallucinationRate),
    instruction_following_rate: parseFloat(instructionFollowingRate),
    memory_accuracy: parseFloat(memoryAccuracy),
    prompt_injection_resistance: parseFloat(promptInjectionResistance),
    rag_accuracy: parseFloat(ragAccuracy),
    category_scores: categoryScores
  };
}

function computeRegressionMetrics(currentSummary, currentResults) {
  try {
    const historyFiles = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.startsWith('run_') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (historyFiles.length === 0) {
      return { status: 'baseline', message: 'First benchmark run established as baseline.' };
    }

    const previousRun = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, historyFiles[0]), 'utf8'));
    const prevSummary = previousRun.summary || {};
    const prevResultsMap = {};
    (previousRun.results || []).forEach(r => { prevResultsMap[r.test_id] = r; });

    const scoreDelta = (currentSummary.overall_score - (prevSummary.overall_score || 0)).toFixed(1);
    const newFailures = [];
    const resolvedFailures = [];

    currentResults.forEach(r => {
      const prev = prevResultsMap[r.test_id];
      if (prev) {
        if (prev.pass && !r.pass) {
          newFailures.push({ test_id: r.test_id, category: r.category, reason: r.evaluator_reason });
        } else if (!prev.pass && r.pass) {
          resolvedFailures.push({ test_id: r.test_id, category: r.category });
        }
      }
    });

    return {
      status: parseFloat(scoreDelta) >= 0 ? 'improved_or_stable' : 'regression_detected',
      previous_run_id: previousRun.run_id,
      previous_timestamp: previousRun.timestamp,
      score_delta: parseFloat(scoreDelta),
      pass_rate_delta: (currentSummary.pass_rate - (prevSummary.pass_rate || 0)).toFixed(1),
      new_failures_count: newFailures.length,
      resolved_failures_count: resolvedFailures.length,
      new_failures: newFailures,
      resolved_failures: resolvedFailures
    };

  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

function getLatestRunResults() {
  if (fs.existsSync(LATEST_RUN_PATH)) {
    return JSON.parse(fs.readFileSync(LATEST_RUN_PATH, 'utf8'));
  }
  return null;
}

function getRunHistory() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  const files = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.startsWith('run_') && f.endsWith('.json'))
    .sort()
    .reverse();

  return files.slice(0, 20).map(file => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8'));
      return {
        run_id: data.run_id,
        timestamp: data.timestamp,
        overall_score: data.summary?.overall_score,
        pass_rate: data.summary?.pass_rate,
        total_tests: data.summary?.total_tests,
        passed_count: data.summary?.passed_count,
        critical_failures: data.summary?.critical_failures_count,
        avg_latency_ms: data.summary?.avg_latency_ms
      };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

module.exports = {
  runEvaluationSuite,
  getLatestRunResults,
  getRunHistory
};

// Allow direct execution from CLI: node eval/runner.js
if (require.main === module) {
  runEvaluationSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Benchmark execution failed:', err);
      process.exit(1);
    });
}
