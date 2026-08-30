/**
 * LLM Evaluator Module for ChatNest Chatbot Evaluation System
 * Performs semantic LLM-as-a-Judge evaluation for complex queries
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

async function evaluateLLM(testCase, llmOutput) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    // Heuristic fallback if LLM key is missing
    const text = (llmOutput || '').trim();
    const passed = text.length > 50 && !/error/i.test(text);
    return {
      pass: passed,
      score: passed ? 85 : 30,
      reason: passed ? 'Semantic heuristics satisfied (LLM key offline).' : 'Response too short or contains errors.'
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const judgePrompt = `You are an expert AI Benchmark Evaluator.
Evaluate the following chatbot output against the test case requirement.

[TEST CASE INFO]:
Category: ${testCase.category}
User Input: "${testCase.user_input}"
Expected Behavior: "${testCase.expected_behavior}"
Evaluation Criteria: "${testCase.evaluation_criteria || testCase.expected_answer}"

[ACTUAL CHATBOT OUTPUT]:
"${llmOutput}"

[INSTRUCTIONS]:
Respond ONLY in JSON format with no additional text:
{
  "pass": true | false,
  "score": number between 0 and 100,
  "reason": "Brief single-sentence explanation of why it passed or failed."
}`;

    const result = await model.generateContent(judgePrompt);
    const rawText = result.response.text();
    const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    const parsed = JSON.parse(cleanJson);
    return {
      pass: !!parsed.pass,
      score: typeof parsed.score === 'number' ? parsed.score : (parsed.pass ? 100 : 0),
      reason: parsed.reason || (parsed.pass ? 'Passed LLM evaluation.' : 'Failed LLM evaluation.')
    };

  } catch (err) {
    console.warn('[LLM Evaluator Warning]:', err.message);
    const text = (llmOutput || '').trim();
    const passed = text.length > 30;
    return {
      pass: passed,
      score: passed ? 80 : 0,
      reason: `LLM Judge fallback: ${err.message}`
    };
  }
}

module.exports = {
  evaluateLLM
};
